"""Optional, explicit OMV startup commands. No network I/O during admission."""
import fcntl
import hashlib
import json
import os
import re
import time
import sqlite3
from contextvars import ContextVar
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

import settings
import catalog
from catalog import now, queue_job


_control_budget = ContextVar('wake_control_budget', default=None)


@contextmanager
def control_budget(stop_event, deadline, job_id):
    """Share bounded lock acquisition with other storage power operations."""
    token = _control_budget.set((stop_event, deadline,
                                 time.monotonic() + max(0, deadline - time.time()), job_id))
    try:
        yield
    finally:
        _control_budget.reset(token)


def lock_tick(deadline):
    budget = _control_budget.get()
    if budget:
        stop, wall, mono, job_id = budget
        if stop.is_set():
            raise Interrupted('shutdown')
        if time.time() >= wall or time.monotonic() >= mono:
            raise Interrupted('deadline')
        connection = sqlite3.connect(catalog.DATA / 'catalog.sqlite3', timeout=0)
        try:
            row = connection.execute('SELECT status,result FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row and (row[0] not in ('queued', 'running') or safe_object(row[1]).get('cancelRequested')):
                raise Interrupted('cancelled')
        except sqlite3.OperationalError:
            pass
        finally:
            connection.close()
    if time.monotonic() >= deadline:
        raise HTTPException(409, 'settings_busy')


@contextmanager
def database(write=False):
    """Wake operations never inherit the catalog's 30-second busy wait."""
    budget = _control_budget.get()
    deadline = budget[2] if budget else time.monotonic() + 1
    try:
        lock = (catalog.DATA / 'catalog.lock').open('r')
    except FileNotFoundError:
        raise HTTPException(409, 'settings_busy') from None
    with lock:
        while True:
            lock_tick(deadline)
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                time.sleep(.025)
        connection = sqlite3.connect(catalog.DATA / 'catalog.sqlite3', timeout=0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute('PRAGMA foreign_keys=ON')
            while True:
                lock_tick(deadline)
                try:
                    connection.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
                    break
                except sqlite3.OperationalError as exc:
                    if 'locked' not in str(exc):
                        raise
                    time.sleep(.025)
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def base_configuration():
    url = os.environ.get('PHOTO_SAVER_HA_URL', '').strip().rstrip('/')
    token = os.environ.get('PHOTO_SAVER_HA_TOKEN', '').strip()
    sensor = os.environ.get('PHOTO_SAVER_HA_RUNNING_ENTITY', '').strip() or 'binary_sensor.omv_running'
    reason = None
    try:
        parsed = urlsplit(url)
        valid = (parsed.scheme in ('http', 'https') and parsed.hostname and
                 not parsed.username and not parsed.password and not parsed.query and not parsed.fragment and
                 not any(ord(c) <= 32 for c in url) and '%' not in parsed.path and
                 not any(p in ('.', '..', 'api') for p in parsed.path.split('/')) and
                 '//' not in parsed.path and
                 not any(ord(c) < 32 or ord(c) == 127 for c in token) and
                 re.fullmatch(r'binary_sensor\.[a-z0-9_]+', sensor))
        _ = parsed.port
        if not valid:
            reason = 'ha_config_invalid'
    except (ValueError, TypeError):
        reason = 'ha_config_invalid'
    if not url or not token:
        reason = 'ha_not_configured'
    return dict(url=url, token=token, sensor=sensor, reason=reason)


def stale_seconds():
    try:
        return max(0, int(os.environ.get('PHOTO_SAVER_HA_STALE_SECONDS', '0')))
    except (ValueError, TypeError):
        return 0


def configuration():
    base = base_configuration()
    script = os.environ.get('PHOTO_SAVER_HA_SCRIPT_ENTITY', '').strip() or 'script.wake_omv'
    timeout = 180
    reason = base['reason']
    try:
        timeout = int(os.environ.get('PHOTO_SAVER_WAKE_TIMEOUT_SECONDS', '') or '180')
        if not 30 <= timeout <= 600 or not re.fullmatch(r'script\.[a-z0-9_]+', script):
            reason = reason or 'ha_config_invalid'
    except (ValueError, TypeError):
        reason = reason or 'ha_config_invalid'
    return dict(base, script=script, timeout=timeout, reason=reason)


@contextmanager
def snapshot_lock(timeout=1.0):
    budget = _control_budget.get()
    deadline = budget[2] if budget else time.monotonic() + timeout
    try:
        lock = (settings.SETTINGS_DIR / 'settings.lock').open('r')
    except FileNotFoundError:
        raise HTTPException(409, 'settings_busy') from None
    with lock:
        while True:
            lock_tick(deadline)
            try:
                fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise HTTPException(409, 'settings_busy') from None
                time.sleep(min(.025, max(0, deadline - time.monotonic())))
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def snapshot():
    with snapshot_lock():
        return unlocked_snapshot()


def unlocked_snapshot():
    import archive
    address = settings.read_setting(settings.ADDRESS_FILE).strip()
    paths = [settings.ADDRESS_FILE, settings.STORAGE_ROOT_FILE,
             settings.SETTINGS_DIR / 'storage-id', settings.KEY_FILE, settings.PUBLIC_KEY]
    if address:
        paths.append(settings.known_host_file(address))
    material = [p.read_bytes().hex() if p.is_file() else None for p in paths]
    storage = digest([material, os.environ.get('PHOTO_SAVER_STORAGE_USER', '')])
    try:
        config = archive.archive_config()
    except HTTPException:
        config = None
    ha = configuration()
    public = digest([address, settings.read_setting(settings.STORAGE_ROOT_FILE),
                     settings.read_storage_id(), settings.read_setting(settings.PUBLIC_KEY),
                     settings.read_setting(settings.known_host_file(address)) if address else None,
                     archive.archive_revision(config) if config else None,
                     ha['url'], ha['script'], ha['sensor']])
    return dict(ha=ha, storageRevision=storage, configRevision=digest([storage, ha]),
                targetRevision=public, archiveConfiguredAtAdmission=config is not None)


def public_configuration():
    try:
        snap = snapshot()
    except (HTTPException, OSError):
        return dict(available=False, reasonCode='settings_busy',
                    message='설정을 읽는 중입니다. 잠시 후 다시 확인하세요.',
                    timeoutSeconds=configuration()['timeout'], targetRevision=None)
    ha = snap['ha']
    return dict(available=ha['reason'] is None, reasonCode=ha['reason'],
                message=('Home Assistant 연결이 설정되지 않았습니다. .env에 HA 주소·토큰을 등록하고 앱을 재시작하세요.'
                         if ha['reason'] else 'Home Assistant의 기존 OMV 켜기 스크립트를 사용합니다.'),
                timeoutSeconds=ha['timeout'], targetRevision=snap['targetRevision'])


class WakeRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    requestId: UUID
    targetRevision: str = Field(pattern=r'^[0-9a-f]{64}$')


def latest(db, request_id=None):
    for row in db.execute("SELECT * FROM jobs WHERE kind='storage-wake' ORDER BY id DESC"):
        if request_id is None:
            return row
        payload = safe_object(row['payload'])
        bindings = payload.get('requests', [])
        if any(isinstance(item, dict) and item.get('id') == str(request_id)
               for item in (bindings if isinstance(bindings, list) else [])):
            return row
    return None


def safe_object(raw):
    try:
        value = json.loads(raw)
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def valid_payload(p):
    try:
        assert isinstance(p, dict)
        a = p['attempt']
        assert isinstance(a, dict)
        assert type(p['schemaVersion']) is int and p['schemaVersion'] == 1 and isinstance(p['archiveConfiguredAtAdmission'], bool)
        assert all(isinstance(p[k], str) and re.fullmatch('[0-9a-f]{64}', p[k]) for k in ('targetRevision', 'storageRevision', 'configRevision'))
        assert isinstance(p['requests'], list) and 1 <= len(p['requests']) <= 128
        for binding in p['requests']:
            assert isinstance(binding, dict) and isinstance(binding['id'], str)
            UUID(binding['id'])
            assert isinstance(binding['targetRevision'], str)
            assert re.fullmatch('[0-9a-f]{64}', binding['targetRevision'])
        assert type(p['timeoutSeconds']) is int and 30 <= p['timeoutSeconds'] <= 600
        assert isinstance(p['requestedAt'], str) and isinstance(p['deadlineAt'], str)
        start = datetime.fromisoformat(p['requestedAt'])
        end = datetime.fromisoformat(p['deadlineAt'])
        assert start.tzinfo and end.tzinfo and 0 < (end-start).total_seconds() <= p['timeoutSeconds']
        assert isinstance(a['state'], str)
        assert a['state'] in ('not_started', 'not_needed', 'observing_existing', 'intent', 'accepted', 'rejected', 'unknown')
        assert type(a['count']) is int and a['count'] == (1 if a['state'] in ('intent', 'accepted', 'rejected', 'unknown') else 0)
        assert 'receiptAt' in a and 'intentAt' in a
        if not a['count']:
            assert a['intentAt'] is None and a['receiptAt'] is None
        else:
            assert isinstance(a['intentAt'], str) and datetime.fromisoformat(a['intentAt']).utcoffset() is not None
            receipt = a['receiptAt']
            if receipt is not None:
                assert isinstance(receipt, str) and datetime.fromisoformat(receipt).utcoffset() is not None
            if a['state'] == 'intent':
                assert receipt is None
            if a['state'] in ('accepted', 'rejected'):
                assert receipt is not None
        return True
    except (KeyError, TypeError, ValueError, AssertionError):
        return False


def admit(request):
    snap = snapshot()
    binding = dict(id=str(request.requestId), targetRevision=request.targetRevision)
    with database(write=True) as db:
        row = latest(db, request.requestId)
        reused = row is not None
        if row:
            payload = safe_object(row['payload'])
            if not valid_payload(payload):
                raise HTTPException(409, 'invalid_operation')
            if binding not in payload['requests']:
                raise HTTPException(409, 'wake_request_mismatch')
        else:
            if request.targetRevision != snap['targetRevision']:
                raise HTTPException(409, 'wake_target_changed')
            if snap['ha']['reason']:
                raise HTTPException(503, snap['ha']['reason'])
            row = db.execute("SELECT * FROM jobs WHERE lane IN ('remote','exclusive') AND status IN ('queued','running')").fetchone()
            if row:
                if row['kind'] != 'storage-wake':
                    raise HTTPException(409, 'remote_busy')
                payload = safe_object(row['payload'])
                if not valid_payload(payload):
                    raise HTTPException(409, 'invalid_operation')
                if payload['configRevision'] != snap['configRevision']:
                    raise HTTPException(409, 'wake_target_changed')
                if len(payload['requests']) >= 128:
                    raise HTTPException(429, 'wake_request_limit')
                payload['requests'].append(binding)
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), row['id']))
                reused = True
            else:
                stamp = datetime.now(timezone.utc)
                payload = {k: v for k, v in snap.items() if k != 'ha'}
                payload.update(schemaVersion=1, requests=[binding], requestedAt=stamp.isoformat(),
                               deadlineAt=(stamp + timedelta(seconds=snap['ha']['timeout'])).isoformat(),
                               timeoutSeconds=snap['ha']['timeout'],
                               attempt=dict(state='not_started', count=0, intentAt=None, receiptAt=None))
                job_id = queue_job(db, 'storage-wake', payload)
                db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(initial_result(payload)), job_id))
                row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        return dict(id=row['id'], kind='storage-wake', lane='remote', status=row['status'], reused=reused,
                    **{k: payload[k] for k in ('targetRevision', 'requestedAt', 'deadlineAt')})


def initial_result(payload):
    return dict(schemaVersion=1, phaseCode='queued', phase='시작 대기',
                **{k: payload[k] for k in ('targetRevision', 'requestedAt', 'deadlineAt', 'timeoutSeconds')},
                elapsedSeconds=0, attemptState='not_started', attemptCount=0, intentAt=None, receiptAt=None,
                serverState='unknown', serverObservedAt=None, serverEvidenceAt=None,
                haState='unknown', haStateStale=True,
                archiveState='checking' if payload['archiveConfiguredAtAdmission'] else 'settings_required',
                archiveObservedAt=None, archiveConnectionVersion=None, cancelRequested=False,
                outcome=None, message='OMV 시작 확인 대기 중입니다.', code=None, review=0)


def cancel(job_id):
    with database(write=True) as db:
        row = db.execute("SELECT * FROM jobs WHERE id=? AND kind='storage-wake'", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, '작업을 찾을 수 없습니다.')
        if row['status'] in ('queued', 'running'):
            result = safe_object(row['result'])
            result['cancelRequested'] = True
            if row['status'] == 'queued':
                result.update(phaseCode='cancelled', outcome='cancelled', phase='대기 중지',
                              error='시작 확인 대기를 중지했습니다.',
                              message='대기를 중지했습니다. 이미 보낸 켜기 요청은 취소되지 않습니다.')
                db.execute("UPDATE jobs SET status='cancelled', finished_at=? WHERE id=?", (now(), job_id))
            db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(result), job_id))
        return db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()


def transition(job_id, changes, *, attempt=None, status=None):
    """Merge controls from the current row; terminal rows are never revived."""
    with database(write=True) as db:
        row = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not row or row['status'] not in ('queued', 'running'):
            return None
        result = safe_object(row['result'])
        cancelled = result.get('cancelRequested', False)
        if cancelled and status == 'done':
            status = 'cancelled'
            changes = dict(changes, outcome='cancelled', phaseCode='cancelled', phase='대기 중지',
                           message='대기를 중지했습니다. 이미 보낸 켜기 요청은 취소되지 않습니다.',
                           review=1, error='시작 확인 대기를 중지했습니다.')
        result.update(changes)
        result['cancelRequested'] = cancelled
        payload = safe_object(row['payload'])
        if attempt is not None:
            if cancelled:
                raise Interrupted('cancelled')
            if not valid_payload(payload):
                raise Interrupted('invalid_operation')
            old = payload['attempt']
            if attempt['state'] == 'intent' and old['state'] != 'not_started':
                raise Interrupted('invalid_operation')
            payload['attempt'] = attempt
            result.update(attemptState=attempt['state'], attemptCount=attempt['count'],
                          intentAt=attempt['intentAt'], receiptAt=attempt['receiptAt'])
        db.execute('UPDATE jobs SET payload=?,result=?,status=?,finished_at=? WHERE id=?',
                   (json.dumps(payload), json.dumps(result), status or row['status'],
                    now() if status else None, job_id))
        return result


class Interrupted(Exception):
    def __init__(self, reason):
        self.reason = reason


def isolated_io(request, control):
    import subprocess
    import sys
    from pathlib import Path
    max_slice = {'ssh': 12.0, 'ssh_banner': 2.5}.get(request['operation'], 5.0)
    cap = min(request['deadline'], time.time() + max_slice)
    request = dict(request, deadline=cap)
    env = {k: v for k, v in os.environ.items() if not k.startswith('PHOTO_SAVER_HA_')}
    child = subprocess.Popen([sys.executable, str(Path(__file__).with_name('storage_wake_io.py'))],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, env=env)
    data = json.dumps(request) + '\n'
    try:
        while True:
            control()
            remaining = cap - time.time()
            if remaining <= 0:
                return {'status': 'unknown' if request['operation'] == 'post' else 'unreachable', 'code': 'ha_timeout'}
            try:
                output, _ = child.communicate(input=data, timeout=min(.25, remaining))
                if child.returncode:
                    return {'status': 'unknown' if request['operation'] == 'post' else 'unreachable',
                            'code': 'ha_timeout' if child.returncode == 124 else 'ha_unreachable'}
                try:
                    value = json.loads(output)
                    if isinstance(value, dict) and isinstance(value.get('status'), str):
                        return value
                except (ValueError, TypeError):
                    pass
                return {'status': 'unknown' if request['operation'] == 'post' else 'unreachable'}
            except subprocess.TimeoutExpired:
                data = None
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate()


def run_storage_wake(job, incoming=None, managed=None, *, stop_event=None, runner=isolated_io):
    import threading
    stop_event = stop_event or threading.Event()
    p = safe_object(job['payload'])
    token = None
    if valid_payload(p):
        deadline = datetime.fromisoformat(p['deadlineAt']).timestamp()
        token = _control_budget.set((stop_event, deadline, time.monotonic()+max(0, deadline-time.time()), job['id']))
    try:
        return _run_storage_wake(job, stop_event=stop_event, runner=runner)
    finally:
        if token is not None:
            _control_budget.reset(token)


def _run_storage_wake(job, *, stop_event, runner):
    import threading
    stop_event = stop_event or threading.Event()
    job_id = job['id']
    try:
        payload = json.loads(job['payload'])
        assert valid_payload(payload)
        attempt = payload['attempt']
        assert attempt['state'] in ('not_started', 'not_needed', 'observing_existing', 'intent', 'accepted', 'rejected', 'unknown')
        assert attempt['count'] in (0, 1)
        deadline = datetime.fromisoformat(payload['deadlineAt']).timestamp()
        start = datetime.fromisoformat(payload['requestedAt']).timestamp()
        monotonic_deadline = time.monotonic() + max(0, deadline - time.time())
        target = payload['configRevision']
        assert payload['storageRevision'] and payload['targetRevision']
    except (ValueError, KeyError, TypeError, AssertionError):
        transition(job_id, dict(outcome='invalid_operation', phaseCode='failed', phase='요청 확인 실패',
                               error='저장된 시작 요청을 확인할 수 없습니다.', code='invalid_operation',
                               message='저장된 시작 요청을 확인할 수 없습니다.', review=1), status='failed')
        return

    def control():
        if stop_event.is_set():
            raise Interrupted('shutdown')
        with database() as db:
            row = db.execute('SELECT status,result FROM jobs WHERE id=?', (job_id,)).fetchone()
            if not row or row['status'] not in ('queued', 'running') or json.loads(row['result']).get('cancelRequested'):
                raise Interrupted('cancelled')
        if time.time() >= deadline or time.monotonic() >= monotonic_deadline:
            raise Interrupted('deadline')
        if snapshot()['configRevision'] != target:
            raise Interrupted('config_changed')

    def finish(outcome, status='done', message=None, detail_code=None):
        detail_messages = {
            'ha_http_401': 'Home Assistant 토큰 인증에 실패했습니다. .env의 HA 토큰을 확인하세요.',
            'ha_http_403': 'Home Assistant 접근 권한이 없습니다. 토큰 권한을 확인하세요.',
            'ha_http_404': 'Home Assistant 스크립트 또는 센서를 찾을 수 없습니다. 엔티티 이름을 확인하세요.',
            'ha_dns_error': 'Home Assistant 주소를 찾을 수 없습니다. Docker에서는 .local 대신 LAN IP를 사용하세요.',
            'ha_tls_error': 'Home Assistant 보안 연결을 확인할 수 없습니다. 인증서를 확인하세요.',
            'ha_timeout': 'Home Assistant 응답 시간이 초과되었습니다. 주소와 네트워크를 확인하세요.',
            'ha_redirect_blocked': 'Home Assistant 주소가 다른 주소로 이동합니다. 최종 주소를 설정하세요.',
            'ha_http_5xx': 'Home Assistant 서버 오류입니다. 잠시 후 다시 시도하세요.',
            'ha_unreachable': 'Home Assistant에 연결할 수 없습니다. 주소와 네트워크를 확인하세요.'}
        message = message or detail_messages.get(detail_code)
        token = _control_budget.set(None)
        try:
            transition(job_id, dict(outcome=outcome, phaseCode='complete' if status == 'done' else status,
                               phase='확인 완료' if status == 'done' else '대기 종료',
                               message=message or {'archive_ready': '아카이브에 접근할 수 있습니다.',
                                   'server_responding_settings_required': 'HA에서 OMV 응답을 보고했습니다. 아카이브 이용에는 SSH 설정이 필요합니다.',
                                   'archive_blocked': '서버가 응답했지만 아카이브 접근이 제한되었습니다. SSH 인증·호스트 키·경로·권한을 확인하세요.',
                                   'archive_unconfirmed': 'HA에서 서버 응답을 보고했지만 아카이브 접근은 확인하지 못했습니다.',
                                   'request_unknown': '켜기 요청의 처리 여부를 확인할 수 없습니다. 서버 상태를 확인한 뒤 다시 시도하세요.',
                                   'response_unconfirmed': '서버 응답을 확인할 수 없습니다. Home Assistant와 SSH 설정을 확인하세요.',
                                   'expired': '시작 요청의 대기 시간이 지나 켜기 요청을 보내지 않았습니다.',
                                   'cancelled': '대기를 중지했습니다. 이미 보낸 켜기 요청은 취소되지 않습니다.',
                                   'config_changed': '설정이 변경되어 대기를 중지했습니다. 이미 보낸 켜기 요청은 취소되지 않습니다.'}.get(outcome, 'OMV 시작 상태를 확인하지 못했습니다. 서버와 설정을 확인하세요.'),
                               code=detail_code or (outcome if status != 'done' else None),
                               **({'error': message or '시작 확인 대기가 종료되었습니다.'} if status != 'done' else {}),
                               review=int(outcome != 'archive_ready')), status=status)
        finally:
            _control_budget.reset(token)

    observed = False

    def io(operation, **kwargs):
        nonlocal observed
        control()
        observed = True
        io_deadline = min(deadline, time.time() + max(0, monotonic_deadline-time.monotonic()))
        if mount_wait_started is not None:
            io_deadline = min(io_deadline, time.time() + max(0, 30 - (time.monotonic() - mount_wait_started)))
        response = runner(dict(operation=operation, deadline=io_deadline, **kwargs), control)
        control()
        return response

    ever_ha_on = False
    previous_ha_state = None
    mount_wait_started = None
    try:
        control()
        if attempt['state'] == 'intent':
            attempt = dict(attempt, state='unknown')
        transition(job_id, {}, attempt=attempt)
        while True:
            control()
            if mount_wait_started is not None and time.monotonic() - mount_wait_started >= 30:
                finish('archive_blocked')
                return
            snap = snapshot()
            if payload['archiveConfiguredAtAdmission']:
                transition(job_id, dict(phaseCode='checking_archive', phase='아카이브 접근 확인 중'))
                probe = io('ssh', storageRevision=payload['storageRevision'])
                state = probe['status']
                transition(job_id, dict(archiveState=state if state in ('ready', 'auth_failed', 'host_key_error', 'path_missing', 'permission_denied', 'not_directory', 'sftp_error') else 'unreachable', archiveObservedAt=now()))
                if state == 'ready':
                    if attempt['state'] == 'not_started':
                        attempt = dict(attempt, state='not_needed')
                        transition(job_id, {}, attempt=attempt)
                    transition(job_id, dict(serverState='archive_ready', serverObservedAt=now(), archiveConnectionVersion=probe.get('revision')))
                    finish('archive_ready')
                    return
                waiting_mount = ((state in ('path_missing', 'sftp_error') or
                                  mount_wait_started is not None and state == 'unreachable') and
                                 attempt['state'] != 'not_started')
                if waiting_mount:
                    if mount_wait_started is None:
                        mount_wait_started = time.monotonic()
                    transition(job_id, dict(serverState='ssh_responding', serverObservedAt=now(),
                                            phaseCode='waiting_mount', phase='스토리지 마운트 대기 중'))
                    if time.monotonic() - mount_wait_started >= 30:
                        finish('archive_blocked')
                        return
                else:
                    mount_wait_started = None
                if not waiting_mount and state in ('auth_failed', 'host_key_error', 'path_missing', 'permission_denied', 'not_directory', 'sftp_error'):
                    if attempt['state'] == 'not_started':
                        attempt = dict(attempt, state='not_needed')
                        transition(job_id, {}, attempt=attempt)
                    transition(job_id, dict(serverState='ssh_responding', serverObservedAt=now()))
                    finish('archive_blocked')
                    return
            ha = snap['ha']
            script = io('get', ha=ha, entity=ha['script'])
            sensor = io('get', ha=ha, entity=ha['sensor'])
            if attempt['state'] == 'not_started' and (
                script['status'] == 'ha_error' or
                (sensor['status'] == 'ha_error' and sensor.get('code') != 'ha_http_404')
            ):
                finish('ha_error', 'failed', detail_code=script.get('code') or sensor.get('code') or 'ha_error')
                return
            evidence = sensor.get('last_reported') or sensor.get('last_updated')
            try:
                age = time.time() - datetime.fromisoformat(evidence.replace('Z', '+00:00')).timestamp()
                fresh = age >= -30 and (not stale_seconds() or age <= stale_seconds())
            except (AttributeError, ValueError, TypeError):
                fresh = False
            state = 'missing' if sensor.get('code') == 'ha_http_404' else sensor.get('state', 'unreachable')
            if state not in ('on', 'off', 'unknown', 'unavailable', 'missing'):
                state = 'unreachable'
            ha_on = state == 'on' and fresh
            ambiguous_on = (attempt['state'] == 'not_started' and payload['archiveConfiguredAtAdmission'] and
                            state == 'on' and fresh and age > 60 and previous_ha_state != 'off')
            if ha_on and not ambiguous_on:
                ever_ha_on = True
            previous_ha_state = state
            transition(job_id, dict(haState=state, haStateStale=not fresh, serverEvidenceAt=evidence,
                                   serverState='ssh_responding' if mount_wait_started is not None else 'ha_reported_on' if ha_on else 'unknown',
                                   serverObservedAt=now() if ha_on or mount_wait_started is not None else None,
                                   phaseCode='waiting_mount' if mount_wait_started is not None else 'waiting_server',
                                   phase='스토리지 마운트 대기 중' if mount_wait_started is not None else '서버 응답 대기 중',
                                   elapsedSeconds=min(payload['timeoutSeconds'], max(0, int(time.time()-start)))))
            if attempt['state'] == 'not_started':
                if script.get('state') == 'on' or (ha_on and not ambiguous_on):
                    attempt = dict(attempt, state='not_needed' if ha_on and not ambiguous_on else 'observing_existing')
                    transition(job_id, {}, attempt=attempt)
                elif script['status'] == 'ha_error':
                    finish('ha_error', 'failed', detail_code=script.get('code'))
                    return
                elif script.get('state') == 'off' and not (state == 'on' and (ambiguous_on or not fresh) and time.time()-start < 35):
                    control()
                    attempt = dict(attempt, state='intent', count=1, intentAt=now())
                    transition(job_id, dict(phaseCode='requesting', phase='켜기 요청 중'), attempt=attempt)
                    response = io('post', ha=ha)
                    attempt = dict(attempt, state=response['status'] if response['status'] in ('accepted', 'rejected') else 'unknown', receiptAt=now())
                    transition(job_id, {}, attempt=attempt)
                    if attempt['state'] == 'rejected':
                        finish('ha_error', 'failed', detail_code=response.get('code'))
                        return
            if ha_on and not payload['archiveConfiguredAtAdmission']:
                finish('server_responding_settings_required')
                return
            until = min(time.monotonic()+5, monotonic_deadline)
            if mount_wait_started is not None:
                until = min(until, mount_wait_started + 30)
            while time.monotonic() < until:
                control()
                stop_event.wait(min(.25, max(0, until-time.monotonic())))
    except Interrupted as exc:
        if exc.reason == 'shutdown':
            return
        if exc.reason == 'invalid_operation':
            finish('invalid_operation', 'failed')
        elif exc.reason in ('cancelled', 'config_changed'):
            finish(exc.reason, 'cancelled')
        elif ever_ha_on:
            finish('archive_unconfirmed')
        else:
            outcome = (('response_unconfirmed' if observed else 'expired') if attempt['state'] == 'not_started' else
                       'request_unknown' if attempt['state'] in ('intent', 'unknown') else 'startup_timeout')
            finish(outcome, 'failed')
