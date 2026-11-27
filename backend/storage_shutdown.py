"""Explicit HA shutdown commands with a durable, at-most-once intent ledger."""
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

import catalog
import settings
from storage_wake import (Interrupted, _control_budget, base_configuration, control_budget,
                          database, digest, isolated_io, safe_object, snapshot_lock, observation_freshness)


def configuration():
    base = base_configuration()
    script = os.environ.get('PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY', '').strip()
    wake_script = os.environ.get('PHOTO_SAVER_HA_SCRIPT_ENTITY', '').strip() or 'script.wake_omv'
    mode = 'switch' if base['power_switch'] else 'script'
    reason = base['reason'] or (None if mode == 'switch' or script else 'ha_shutdown_not_configured')
    timeout = 300
    try:
        timeout = int(os.environ.get('PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS', '') or '300')
        if not 30 <= timeout <= 1200 or mode == 'script' and script and (not re.fullmatch(r'script\.[a-z0-9_]+', script) or script == wake_script):
            reason = base['reason'] or 'ha_config_invalid'
    except (ValueError, TypeError):
        reason = base['reason'] or 'ha_config_invalid'
    return dict(base, script=script, timeout=timeout, reason=reason, mode=mode,
                control_entity=base['power_switch'] or script,
                service='switch/turn_off' if mode == 'switch' else 'script/turn_on')


def snapshot():
    with snapshot_lock():
        address = settings.read_setting(settings.ADDRESS_FILE).strip()
        ha = configuration()
        storage = digest({'address': address})
        config = digest(dict(url=ha['url'], sensor=ha['sensor'], script=ha['script'] if ha['mode'] == 'script' else None,
                             mode=ha['mode'], control_entity=ha['control_entity'], service=ha['service'],
                             timeout=ha['timeout'], storage=storage))
        return dict(ha=ha, address=address, storageRevision=storage, configRevision=config,
                    targetRevision=digest(dict(kind='storage-shutdown', config=config)),
                    sshConfiguredAtAdmission=bool(address))


def public_configuration():
    try:
        snap = snapshot()
    except (HTTPException, OSError):
        return dict(available=False, reasonCode='settings_busy', message='설정을 읽는 중입니다. 잠시 후 다시 확인하세요.',
                    timeoutSeconds=configuration()['timeout'], targetRevision=None, mode=configuration()['mode'])
    ha = snap['ha']
    messages = {
        'ha_not_configured': 'Home Assistant 주소와 토큰이 설정되지 않았습니다. .env를 설정한 뒤 api와 worker를 다시 생성하세요.',
        'ha_shutdown_not_configured': 'OMV 전원 스위치 또는 레거시 종료 스크립트를 .env에 설정하세요.',
        'ha_config_invalid': 'Home Assistant 종료 설정을 확인하세요. 전원 스위치 또는 레거시 스크립트와 타임아웃(30~1200초)을 점검하세요.'}
    return dict(available=ha['reason'] is None, reasonCode=ha['reason'], message=messages.get(ha['reason']) or (
                'Home Assistant 전원 스위치를 끄고 전원 차단까지 확인합니다.' if ha['mode'] == 'switch' else 'Home Assistant의 기존 OMV 종료 스크립트를 사용합니다.'),
                timeoutSeconds=ha['timeout'], targetRevision=snap['targetRevision'], mode=ha['mode'])


class ShutdownRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requestId: UUID
    targetRevision: str = Field(pattern=r'^[0-9a-f]{64}$')


def latest_job(db):
    return db.execute("SELECT * FROM jobs WHERE kind='storage-shutdown' ORDER BY id DESC LIMIT 1").fetchone()


def get_job_by_request_id(db, request_id):
    for row in db.execute("SELECT * FROM jobs WHERE kind='storage-shutdown' ORDER BY id DESC"):
        p = safe_object(row['payload'])
        aliases = p.get('aliases', [])
        if str(request_id) == p.get('requestId') or isinstance(aliases, list) and str(request_id) in aliases:
            return row
    return None


def valid_payload(p):
    try:
        assert isinstance(p['requestId'], str)
        UUID(p['requestId'])
        assert isinstance(p['aliases'], list) and len(p['aliases']) <= 128
        for alias in p['aliases']:
            assert isinstance(alias, str)
            UUID(alias)
        assert all(isinstance(p[k], str) and re.fullmatch(r'[0-9a-f]{64}', p[k]) for k in ('targetRevision', 'configRevision', 'storageRevision'))
        assert type(p['sshConfiguredAtAdmission']) is bool
        assert type(p['timeoutSeconds']) is int and 30 <= p['timeoutSeconds'] <= 1200
        start, end = (datetime.fromisoformat(p[k]) for k in ('requestedAt', 'deadlineAt'))
        assert start.tzinfo and end.tzinfo and 0 < (end-start).total_seconds() <= p['timeoutSeconds']
        a = p['attempt']
        assert a['state'] in ('not_started', 'not_needed', 'observing_existing', 'intent', 'accepted', 'rejected', 'unknown')
        assert type(a['count']) is int and a['count'] == int(a['state'] in ('intent', 'accepted', 'rejected', 'unknown'))
        if a['count']:
            assert datetime.fromisoformat(a['intentAt']).tzinfo
        else:
            assert a['intentAt'] is None and a['receiptAt'] is None
        if a['state'] == 'intent':
            assert a['receiptAt'] is None
        elif a['receiptAt'] is not None:
            assert datetime.fromisoformat(a['receiptAt']).tzinfo
        if a['state'] in ('accepted', 'rejected'):
            assert a['receiptAt'] is not None
        return True
    except (KeyError, TypeError, ValueError, AssertionError):
        return False


def initial_result(p):
    return dict(phaseCode='queued', phase='시작 대기', message='OMV 종료 확인 대기 중입니다.',
                outcome=None, code=None, detailCode=None, error=None, review=0, cancelRequested=False,
                attemptState='not_started', attemptCount=0, intentAt=None, receiptAt=None,
                haState='unknown', haFresh=False, haScriptState='unknown', sshState='unknown',
                controlMode=configuration()['mode'], haPowerState='unknown', haPowerFresh=False,
                haRunningState='unknown', haRunningFresh=False,
                sshConfigured=p['sshConfiguredAtAdmission'], everSshStoppedAfterAttempt=False,
                startedAt=p['requestedAt'], checkedAt=None, elapsedSeconds=0,
                **{k: p[k] for k in ('targetRevision', 'requestedAt', 'deadlineAt', 'timeoutSeconds')})


def admit(request):
    snap = snapshot()  # Local settings only: admission must never perform I/O to HA or SSH.
    with database(write=True) as db:
        row = get_job_by_request_id(db, request.requestId)
        if row:
            p = safe_object(row['payload'])
            if not valid_payload(p):
                raise HTTPException(409, 'invalid_operation')
            if request.targetRevision != p['targetRevision']:
                raise HTTPException(409, 'target_changed')
            return row
        if request.targetRevision != snap['targetRevision']:
            raise HTTPException(409, 'target_changed')
        if snap['ha']['reason']:
            raise HTTPException(409, snap['ha']['reason'])
        row = db.execute("SELECT * FROM jobs WHERE lane IN ('remote','exclusive') AND status IN ('queued','running')").fetchone()
        if row:
            if row['kind'] != 'storage-shutdown':
                raise HTTPException(409, 'remote_busy')
            p = safe_object(row['payload'])
            if not valid_payload(p):
                raise HTTPException(409, 'invalid_operation')
            if p['targetRevision'] != request.targetRevision:
                raise HTTPException(409, 'target_changed')
            if len(p['aliases']) >= 128:
                raise HTTPException(429, 'shutdown_request_limit')
            p['aliases'].append(str(request.requestId))
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(p), row['id']))
        else:
            if catalog.has_active_remote_duplicate_cleanup(db):
                raise HTTPException(409, 'remote_cleanup_busy')
            stamp = datetime.now(timezone.utc)
            p = {k: snap[k] for k in ('targetRevision', 'storageRevision', 'configRevision', 'sshConfiguredAtAdmission')}
            p.update(requestId=str(request.requestId), aliases=[], requestedAt=stamp.isoformat(),
                     deadlineAt=(stamp + timedelta(seconds=snap['ha']['timeout'])).isoformat(), timeoutSeconds=snap['ha']['timeout'],
                     attempt=dict(state='not_started', count=0, intentAt=None, receiptAt=None))
            job_id = catalog.queue_job(db, 'storage-shutdown', p)
            db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(initial_result(p)), job_id))
            row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        return row


MESSAGES = {
    'powered_off': 'OMV 전원이 꺼졌습니다.', 'already_off': 'OMV가 이미 꺼져 있습니다.',
    'ssh_stopped_ha_unconfirmed': 'SSH 응답은 중단되었지만 Home Assistant에서 전원 꺼짐을 확인하지 못했습니다. 서버 상태를 직접 확인하세요.',
    'ha_request_failed': 'Home Assistant 종료 요청에 실패했습니다. 연결 설정을 확인하세요.',
    'server_not_ready': 'OMV가 아직 시작 중이거나 SSH에 응답하지 않아 안전하게 종료할 수 없습니다.',
    'response_unconfirmed': '서버 실행 상태를 확인하지 못해 종료 요청을 보내지 않았습니다.',
    'remote_cleanup_busy': '원격 사본을 검증하는 중복 정리가 진행 중입니다. 정리 완료 후 다시 시도하세요.',
    'shutdown_timeout': '제한 시간 내 OMV 종료를 확인하지 못했습니다. 서버 상태를 직접 확인하세요.',
    'request_unknown': '종료 요청의 처리 여부를 확인하지 못했습니다. 서버 상태를 직접 확인하세요.',
    'cancelled': '대기를 중지했습니다. 이미 전달된 종료 요청은 취소되지 않으며 서버에서 계속 진행될 수 있습니다.',
    'config_changed': '설정이 변경되어 확인을 중지했습니다. 이미 전달된 종료 요청은 취소되지 않습니다.',
    'interrupted': '워커 종료로 확인을 중단했습니다. 이미 전달된 종료 요청은 취소되지 않습니다.',
    'invalid_operation': '저장된 종료 요청을 확인할 수 없습니다.'}
DETAIL_MESSAGES = {
    'ha_http_401': 'Home Assistant 토큰 인증에 실패했습니다. .env의 HA 토큰을 확인하세요.',
    'ha_http_403': 'Home Assistant 접근 권한이 없습니다. 토큰 권한을 확인하세요.',
    'ha_http_404': 'Home Assistant 전원 스위치·스크립트 또는 실행 센서를 찾을 수 없습니다. 엔티티 이름을 확인하세요.',
    'ha_redirect_blocked': 'Home Assistant 주소가 다른 주소로 이동합니다. 최종 주소를 설정하세요.',
    'ha_http_5xx': 'Home Assistant 서버 오류입니다. 잠시 후 다시 시도하세요.',
    'ha_dns_error': 'Home Assistant 주소를 찾을 수 없습니다. Docker에서는 .local 대신 LAN IP를 사용하세요.',
    'ha_tls_error': 'Home Assistant 보안 연결을 확인할 수 없습니다. 인증서를 확인하세요.',
    'ha_timeout': 'Home Assistant 응답 시간이 초과되었습니다. 주소와 네트워크를 확인하세요.',
    'ha_unreachable': 'Home Assistant에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.'}


def transition(job_id, changes, *, attempt=None, status=None):
    with database(write=True) as db:
        row = db.execute("SELECT * FROM jobs WHERE id=? AND kind='storage-shutdown'", (job_id,)).fetchone()
        if not row or row['status'] not in ('queued', 'running'):
            return None
        p, r = safe_object(row['payload']), safe_object(row['result'])
        cancelled = r.get('cancelRequested', False)
        if cancelled and status == 'done':
            status = 'cancelled'
            changes = dict(changes, outcome='cancelled', phaseCode='cancelled', phase='대기 중지',
                           code='cancelled', message=MESSAGES['cancelled'], review=1)
        if attempt is not None:
            if cancelled:
                raise Interrupted('cancelled')
            if not valid_payload(p) or attempt['state'] == 'intent' and p['attempt']['state'] != 'not_started':
                raise Interrupted('invalid_operation')
            old_state = p['attempt']['state']
            allowed = {'not_started': {'not_started', 'intent', 'not_needed', 'observing_existing'},
                       'intent': {'unknown', 'accepted', 'rejected'}}
            if attempt['state'] not in allowed.get(old_state, {old_state}):
                raise Interrupted('invalid_operation')
            # The queue guard and intent commit share one write transaction.
            if attempt['state'] == 'intent' and catalog.has_active_remote_duplicate_cleanup(db):
                raise Interrupted('remote_cleanup_busy')
            p['attempt'] = attempt
            r.update(attemptState=attempt['state'], attemptCount=attempt['count'], intentAt=attempt['intentAt'], receiptAt=attempt['receiptAt'])
        r.update(changes, cancelRequested=cancelled)
        db.execute('UPDATE jobs SET payload=?,result=?,status=?,finished_at=? WHERE id=?',
                   (json.dumps(p), json.dumps(r), status or row['status'], catalog.now() if status else None, job_id))
        return r


def cancel(job_id):
    with database(write=True) as db:
        row = db.execute("SELECT * FROM jobs WHERE id=? AND kind='storage-shutdown'", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, '작업을 찾을 수 없습니다.')
        if row['status'] in ('queued', 'running'):
            r = safe_object(row['result'])
            r['cancelRequested'] = True
            if row['status'] == 'queued':
                r.update(outcome='cancelled', phaseCode='cancelled', phase='대기 중지', message=MESSAGES['cancelled'], review=1, code='cancelled')
                db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=?", (catalog.now(), job_id))
            db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(r), job_id))
        return db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()


def run_storage_shutdown(job, incoming=None, managed=None, *, stop_event=None, runner=isolated_io):
    stop_event = stop_event or threading.Event()
    p = safe_object(job['payload'])
    if not valid_payload(p):
        transition(job['id'], dict(outcome='invalid_operation', code='invalid_operation', phaseCode='failed',
                                 message=MESSAGES['invalid_operation'], error=MESSAGES['invalid_operation'], review=1), status='failed')
        return
    deadline = datetime.fromisoformat(p['deadlineAt']).timestamp()
    with control_budget(stop_event, deadline, job['id']):
        _run(job, p, deadline, stop_event, runner)


def _run(job, p, deadline, stop_event, runner):
    job_id = job['id']
    attempt = p['attempt']
    mono_deadline = time.monotonic() + max(0, deadline-time.time())
    checking_started = time.monotonic()
    ever_stopped = bool(safe_object(job['result']).get('everSshStoppedAfterAttempt'))
    ha_off = False
    uncertain_initial = True
    errors = 0

    def control():
        if stop_event.is_set():
            raise Interrupted('interrupted')
        if time.time() >= deadline or time.monotonic() >= mono_deadline:
            raise Interrupted('deadline')
        with database() as db:
            row = db.execute('SELECT status,result FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['status'] not in ('queued', 'running') or safe_object(row['result']).get('cancelRequested'):
                raise Interrupted('cancelled')
        snap = snapshot()
        if snap['configRevision'] != p['configRevision'] or snap['ha']['reason']:
            raise Interrupted('config_changed')
        if attempt['state'] == 'not_started' and time.monotonic()-checking_started >= 15:
            raise Interrupted('response_unconfirmed' if uncertain_initial else 'server_not_ready')

    def finish(outcome, status='failed', detail=None):
        message = DETAIL_MESSAGES.get(detail, MESSAGES[outcome])
        # Final persistence must remain possible after cancel/deadline/stop.
        token = _control_budget.set(None)
        try:
            transition(job_id, dict(outcome=outcome, code=outcome if status != 'done' else None, detailCode=detail,
                                   phaseCode='complete' if status == 'done' else status,
                                   phase='확인 완료' if status == 'done' else '대기 종료', message=message,
                                   error=message if status == 'failed' else None,
                                   review=int(outcome not in ('powered_off', 'already_off'))), status=status)
        finally:
            _control_budget.reset(token)

    def io(operation, **kwargs):
        control()
        io_deadline = min(deadline, time.time()+max(0, mono_deadline-time.monotonic()))
        if attempt['state'] == 'not_started':
            io_deadline = min(io_deadline, time.time()+max(0, 15-(time.monotonic()-checking_started)))
        value = runner(dict(operation=operation, deadline=io_deadline, **kwargs), control)
        control()
        return value

    try:
        control()
        if attempt['state'] == 'intent':
            attempt = dict(attempt, state='unknown')
        transition(job_id, {}, attempt=attempt)
        if attempt['state'] == 'rejected':
            finish('ha_request_failed')
            return
        while True:
            control()
            if attempt['state'] == 'not_started':
                with database() as db:
                    if catalog.has_active_remote_duplicate_cleanup(db):
                        raise Interrupted('remote_cleanup_busy')
                transition(job_id, dict(phaseCode='checking_server', phase='서버 상태 확인 중'))
            snap = snapshot()
            ha = snap['ha']
            ssh = io('ssh_banner', address=snap['address']) if p['sshConfiguredAtAdmission'] else dict(status='unconfigured')
            switch_mode = ha['mode'] == 'switch'
            script = io('get', ha=ha, entity=ha['control_entity'], statusProjection=True)
            sensor = io('get', ha=ha, entity=ha['sensor'], statusProjection=True)
            _, fresh = observation_freshness(sensor, time.time())
            _, power_fresh = observation_freshness(script, time.time())
            ha_state = sensor.get('state', 'unknown')
            ha_off = script.get('state') == 'off' and power_fresh if switch_mode else ha_state == 'off' and fresh
            ssh_stopped = ssh['status'] == 'unreachable'
            if attempt['state'] in ('accepted', 'unknown', 'observing_existing') and ssh_stopped:
                ever_stopped = True
            phase = 'checking_server' if attempt['state'] == 'not_started' else 'waiting_power_off' if ssh_stopped or not p['sshConfiguredAtAdmission'] else 'waiting_shutdown'
            transition(job_id, dict(haState=ha_state, haFresh=fresh, haScriptState=script.get('state', 'unknown'),
                                   controlMode=ha['mode'], haPowerState=script.get('state', 'unknown') if switch_mode else 'unknown',
                                   haPowerFresh=power_fresh if switch_mode else False,
                                   haRunningState=ha_state, haRunningFresh=fresh,
                                   sshState=ssh['status'], sshConfigured=p['sshConfiguredAtAdmission'],
                                   everSshStoppedAfterAttempt=ever_stopped, checkedAt=catalog.now(),
                                   elapsedSeconds=max(0, int(time.time()-datetime.fromisoformat(p['requestedAt']).timestamp())),
                                   phaseCode=phase, phase={'checking_server': '서버 상태 확인 중', 'waiting_shutdown': '서비스 종료 확인 중', 'waiting_power_off': '전원 차단 확인 중'}[phase]))
            if ha_off and (ssh_stopped or not p['sshConfiguredAtAdmission']):
                if attempt['state'] == 'not_started':
                    transition(job_id, {}, attempt=dict(attempt, state='not_needed'))
                    finish('already_off', 'done')
                else:
                    finish('powered_off', 'done')
                return
            if attempt['state'] == 'not_started':
                permanent = next((v.get('code') or 'ha_unreachable' for v in (script, sensor)
                                  if (v.get('status') == 'ha_error' or v.get('code') == 'ha_redirect_blocked')
                                  and not (switch_mode and v is sensor and v.get('code') == 'ha_http_404')), None)
                if permanent:
                    finish('ha_request_failed', detail=permanent)
                    return
                if not switch_mode and script.get('state') == 'on':
                    attempt = dict(attempt, state='observing_existing')
                    transition(job_id, {}, attempt=attempt)
                    if ssh_stopped:
                        ever_stopped = True
                        transition(job_id, dict(everSshStoppedAfterAttempt=True))
                elif ((script.get('state') == 'on' and power_fresh) if switch_mode else script.get('state') == 'off') and (
                        ssh['status'] == 'reachable' or not p['sshConfiguredAtAdmission'] and (
                            ha_state == 'on' and fresh or switch_mode and sensor.get('code') == 'ha_http_404')):
                    control()
                    attempt = dict(attempt, state='intent', count=1, intentAt=catalog.now())
                    transition(job_id, dict(phaseCode='requesting', phase='종료 요청 중'), attempt=attempt)
                    response = io('post', ha=ha, service=ha['service'], entity=ha['control_entity'])
                    # A 5xx response cannot prove the script did not run. Keep the
                    # remote lane reserved and observe unknown outcomes until deadline.
                    rejected = response['status'] == 'rejected' or response.get('code') == 'ha_redirect_blocked'
                    attempt = dict(attempt, state='rejected' if rejected else 'accepted' if response['status'] == 'accepted' else 'unknown', receiptAt=catalog.now())
                    transition(job_id, {}, attempt=attempt)
                    if rejected:
                        finish('ha_request_failed', detail=response.get('code'))
                        return
                else:
                    if switch_mode:
                        server_not_ready = ssh_stopped if p['sshConfiguredAtAdmission'] else ha_state == 'off' and fresh
                        uncertain_initial = not (script.get('state') == 'on' and power_fresh and server_not_ready)
                    else:
                        uncertain_initial = script.get('state') != 'off' or not (ha_state == 'on' and fresh and ssh_stopped)
                    if time.monotonic()-checking_started >= 15:
                        finish('response_unconfirmed' if uncertain_initial else 'server_not_ready')
                        return
            errors = min(errors+1, 2) if sensor.get('status') != 'ok' else 0
            until = min(time.monotonic()+2+errors, mono_deadline)
            if attempt['state'] == 'not_started':
                until = min(until, checking_started+15)
            while time.monotonic() < until:
                control()
                stop_event.wait(min(.25, max(0, until-time.monotonic())))
    except Interrupted as exc:
        if exc.reason == 'deadline':
            if ever_stopped and not ha_off:
                finish('ssh_stopped_ha_unconfirmed', 'done')
            else:
                finish('response_unconfirmed' if attempt['state'] == 'not_started' else 'request_unknown' if attempt['state'] in ('intent', 'unknown') else 'shutdown_timeout')
        else:
            reason = 'interrupted' if exc.reason == 'shutdown' else exc.reason
            finish(reason, 'cancelled' if reason == 'cancelled' else 'failed')
