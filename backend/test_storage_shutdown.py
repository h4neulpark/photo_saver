"""Shutdown admission, safety interlocks and deterministic offline state-machine tests."""
import json
import os
import threading
import time
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

import api
import catalog
import incoming_cleanup
import settings
import storage_shutdown as shutdown
import storage_wake as wake
import test_storage_wake as fixtures
from fastapi import HTTPException


class ShutdownTests(unittest.TestCase):
    def setUp(self):
        fixtures.WakeApiTests.setUp(self)
        p = patch.dict(os.environ, {'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': 'script.shutdown_omv',
                                   'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': '30', 'PHOTO_SAVER_HA_STALE_SECONDS': '0'})
        p.start()
        self.addCleanup(p.stop)

    def body(self):
        return dict(requestId=str(uuid4()), targetRevision=shutdown.snapshot()['targetRevision'])

    def submit(self, body=None):
        r = self.client.post('/api/storage/shutdown', json=body or self.body())
        self.assertEqual(r.status_code, 202, r.text)
        self.assertEqual(r.headers['cache-control'], 'no-store')
        return r.json()['job']

    def job(self, ssh=True):
        if ssh:
            settings.ADDRESS_FILE.write_text('192.0.2.10')
        result = self.submit()
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (result['id'],))
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (result['id'],)).fetchone())

    def latest(self):
        return self.client.get('/api/storage/shutdown').json()['job']

    def run_job(self, job, probes, post=None, hook=None):
        clock = SimpleNamespace(value=time.time(), mono=0)
        stop = threading.Event()
        def wait(duration):
            clock.value += duration
            clock.mono += duration
        stop.wait = wait
        cycles, calls, phases = [0], [], []
        def runner(request, control):
            calls.append(request['operation'])
            if hook:
                hook(request, control)
            with catalog.database() as db:
                r = json.loads(db.execute('SELECT result FROM jobs WHERE id=?', (job['id'],)).fetchone()[0])
                phases.append(r.get('phaseCode'))
            probe = probes[min(cycles[0], len(probes)-1)]
            if request['operation'] == 'post':
                cycles[0] += 1
                return post or dict(status='accepted')
            if request['operation'] == 'ssh_banner':
                return dict(status=probe[0])
            if request['entity'].startswith(('script.', 'switch.')):
                script = probe[2] if len(probe)>2 else 'off'
                return script if isinstance(script, dict) else dict(status='ok', state=script, last_reported=datetime.fromtimestamp(clock.value, timezone.utc).isoformat())
            cycles[0] += 1
            if isinstance(probe[1], dict):
                return probe[1]
            return dict(status='ok', state=probe[1], last_reported=datetime.fromtimestamp(clock.value, timezone.utc).isoformat())
        fake_time = SimpleNamespace(time=lambda: clock.value, monotonic=lambda: clock.mono)
        with patch.object(shutdown, 'time', fake_time):
            shutdown.run_storage_shutdown(job, stop_event=stop, runner=runner)
        return self.latest(), calls, phases

    def test_configuration_validation_and_independence(self):
        cases = [({'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': ''}, 'ha_shutdown_not_configured'),
                 ({'PHOTO_SAVER_HA_TOKEN': ''}, 'ha_not_configured'),
                 ({'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': 'script.wake_omv'}, 'ha_config_invalid'),
                 ({'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': 'switch.omv'}, 'ha_config_invalid'),
                 ({'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': 'x'}, 'ha_config_invalid'),
                 ({'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': '29'}, 'ha_config_invalid'),
                 ({'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': '1201'}, 'ha_config_invalid')]
        for env, reason in cases:
            with self.subTest(env=env), patch.dict(os.environ, env):
                self.assertEqual(shutdown.configuration()['reason'], reason)
                r = self.client.post('/api/storage/shutdown', json=self.body())
                self.assertEqual((r.status_code, r.json()['detail']), (409, reason))
                self.assertEqual(r.headers['cache-control'], 'no-store')
        with patch.dict(os.environ, {'PHOTO_SAVER_WAKE_TIMEOUT_SECONDS': 'bad'}):
            self.assertIsNone(shutdown.configuration()['reason'])
        with patch.dict(os.environ, {'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': 'bad'}):
            self.assertIsNone(wake.configuration()['reason'])
            import storage_status
            self.assertIsNone(storage_status.base_configuration()['reason'])

    def test_snapshot_no_token_and_exact_revision(self):
        snap = shutdown.snapshot()
        self.assertEqual(snap['storageRevision'], wake.digest({'address': ''}))
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_TOKEN': 'another-secret'}):
            self.assertEqual(snap['configRevision'], shutdown.snapshot()['configRevision'])
        self.assertNotIn('sentinel-secret', json.dumps(shutdown.public_configuration()))

    def test_admission_zero_io_alias_replay_schema_and_no_secrets(self):
        with patch.object(wake, 'isolated_io', side_effect=AssertionError('admission network')), patch('subprocess.Popen', side_effect=AssertionError('admission subprocess')):
            body = self.body()
            first = self.submit(body)
            self.assertEqual(self.submit(body)['id'], first['id'])
            alias = self.body()
            self.assertEqual(self.submit(alias)['id'], first['id'])
        for request_id in (body['requestId'], alias['requestId']):
            self.assertEqual(self.client.get('/api/storage/shutdown', params={'request_id': request_id}).json()['job']['id'], first['id'])
        self.assertIsNone(self.client.get('/api/storage/shutdown', params={'request_id': str(uuid4())}).json()['job'])
        for bad in ({**body, 'extra': 1}, {**body, 'requestId': 'bad'}, {**body, 'targetRevision': 'bad'}):
            r = self.client.post('/api/storage/shutdown', json=bad)
            self.assertEqual(r.status_code, 422)
            self.assertEqual(r.headers['cache-control'], 'no-store')
        r = self.client.post('/api/storage/shutdown', json={**body, 'targetRevision': '0'*64})
        self.assertEqual(r.json()['detail'], 'target_changed')
        for route in ('/api/settings', '/api/state', '/api/jobs?kind=storage-shutdown', '/api/storage/shutdown'):
            self.assertNotIn('sentinel-secret', self.client.get(route).text)
        self.assertEqual(self.client.get('/api/state').json()['latestStorageShutdown']['id'], first['id'])
        for _ in range(2):
            self.assertEqual(self.client.post(f"/api/storage/shutdown/{first['id']}/cancel").json()['job']['status'], 'cancelled')
        self.assertEqual(self.submit(alias)['status'], 'cancelled')
        self.assertEqual(self.client.post('/api/storage/shutdown/999/cancel').status_code, 404)

    def test_alias_limit_and_concurrent_admission(self):
        body = self.body()
        def admit(_):
            return shutdown.admit(shutdown.ShutdownRequest(**{**body, 'requestId': str(uuid4())}))['id']
        with ThreadPoolExecutor(max_workers=6) as pool:
            ids = list(pool.map(admit, range(6)))
        self.assertEqual(len(set(ids)), 1)
        with catalog.database(write=True) as db:
            row = shutdown.latest_job(db)
            p = json.loads(row['payload'])
            p['aliases'] = [str(uuid4()) for _ in range(128)]
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(p), row['id']))
        self.assertEqual(self.client.post('/api/storage/shutdown', json=body).status_code, 429)

    def test_remote_exclusive_conflicts_and_local_coexistence(self):
        for kind in ('upload', 'offload', 'remote-index', 'thumbnails-remote', 'storage-wake', 'reset-all'):
            with self.subTest(kind=kind):
                with catalog.database(write=True) as db:
                    job_id = catalog.queue_job(db, kind, {})
                r = self.client.post('/api/storage/shutdown', json=self.body())
                self.assertEqual((r.status_code, r.json()['detail']), (409, 'remote_busy'))
                with catalog.database(write=True) as db:
                    db.execute("UPDATE jobs SET status='done' WHERE id=?", (job_id,))
        with catalog.database(write=True) as db:
            catalog.queue_job(db, 'scan', {})
        self.submit()
        self.assertEqual(self.client.delete('/api/settings/ssh-host-key').status_code, 409)

    def test_duplicate_cleanup_bidirectional_and_local_only(self):
        with catalog.database(write=True) as db:
            cleanup = catalog.queue_job(db, 'duplicate-cleanup', {'files': [{'keeper': {'kind': 'remote'}}]})
        r = self.client.post('/api/storage/shutdown', json=self.body())
        self.assertEqual(r.json()['detail'], 'remote_cleanup_busy')
        with catalog.database(write=True) as db:
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps({'files': [{'keeper': {'kind': 'managed'}}]}), cleanup))
        self.submit()
        with catalog.database(write=True) as db:
            with self.assertRaises(HTTPException) as error:
                incoming_cleanup.queue_duplicate_cleanup(db, [{'id': 'x', 'keeperKind': 'remote', 'keeperId': 'r'}])
            self.assertEqual(error.exception.detail, 'storage_shutdown_active')

    def test_normal_two_layer_shutdown(self):
        job = self.job()
        result, calls, phases = self.run_job(job, [('reachable', 'on'), ('unreachable', 'on'), ('unreachable', 'on'), ('unreachable', 'off')])
        self.assertEqual(result['result']['outcome'], 'powered_off')
        self.assertEqual(result['result']['review'], 0)
        self.assertEqual(calls.count('post'), 1)
        self.assertIn('waiting_power_off', phases)
        self.assertNotIn('ssh', calls)

    def test_ha_only_shutdown(self):
        result, calls, _ = self.run_job(self.job(False), [('unconfigured', 'on'), ('unconfigured', 'on'), ('unconfigured', 'off')])
        self.assertEqual(result['result']['outcome'], 'powered_off')
        self.assertEqual(calls.count('post'), 1)
        self.assertNotIn('ssh_banner', calls)

    def test_already_off_never_posts(self):
        result, calls, _ = self.run_job(self.job(), [('unreachable', 'off')])
        self.assertEqual(result['result']['outcome'], 'already_off')
        self.assertEqual(result['result']['attemptState'], 'not_needed')
        self.assertNotIn('post', calls)

    def test_observe_existing_never_posts(self):
        result, calls, _ = self.run_job(self.job(), [('reachable', 'on', 'on'), ('unreachable', 'off')])
        self.assertEqual(result['result']['outcome'], 'powered_off')
        self.assertEqual(result['result']['attemptState'], 'observing_existing')
        self.assertNotIn('post', calls)

    def test_booting_guard_and_grace_recovery(self):
        for probes, expected in [([('unreachable', 'on')], 'server_not_ready'),
                                 ([('unreachable', 'on'), ('reachable', 'on'), ('reachable', 'on'), ('unreachable', 'off')], 'powered_off'),
                                 ([('unreachable', 'on'), ('unreachable', 'off')], 'already_off')]:
            with self.subTest(expected=expected):
                result, calls, _ = self.run_job(self.job(), probes)
                self.assertEqual(result['result']['outcome'], expected)
                self.assertEqual(calls.count('post'), int(expected == 'powered_off'))

    def test_partial_confirmation_latches_ssh_stop(self):
        result, calls, _ = self.run_job(self.job(), [('reachable', 'on'), ('unreachable', 'on'), ('unreachable', 'on'), ('reachable', 'on')])
        self.assertEqual((result['status'], result['result']['outcome'], result['result']['review']), ('done', 'ssh_stopped_ha_unconfirmed', 1))
        self.assertEqual(calls.count('post'), 1)

    def test_sensor_off_alone_does_not_complete(self):
        result, _, _ = self.run_job(self.job(), [('reachable', 'on'), ('reachable', 'off')])
        self.assertEqual(result['result']['outcome'], 'shutdown_timeout')

    def test_intent_restart_no_repost_success_or_unknown(self):
        for ssh, ha, outcome in [('unreachable', 'off', 'powered_off'), ('reachable', 'on', 'request_unknown')]:
            job = self.job()
            p = json.loads(job['payload'])
            p['attempt'] = dict(state='intent', count=1, intentAt=catalog.now(), receiptAt=None)
            job['payload'] = json.dumps(p)
            with catalog.database(write=True) as db:
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
            result, calls, _ = self.run_job(job, [(ssh, ha)])
            self.assertEqual(result['result']['outcome'], outcome)
            self.assertEqual(result['result']['attemptState'], 'unknown')
            self.assertNotIn('post', calls)

    def test_preflight_permanent_errors_never_post(self):
        for code in ('ha_http_400', 'ha_http_401', 'ha_http_403', 'ha_http_404', 'ha_dns_error', 'ha_tls_error', 'ha_redirect_blocked'):
            result, calls, _ = self.run_job(self.job(), [('reachable', dict(status='unreachable' if code == 'ha_redirect_blocked' else 'ha_error', code=code))])
            self.assertEqual(result['result']['outcome'], 'ha_request_failed')
            self.assertEqual(result['result']['detailCode'], code)
            self.assertNotIn('post', calls)

    def test_preflight_temporary_error_and_stale_block_blind_post(self):
        for sensor in (dict(status='unreachable', code='ha_timeout'), dict(status='ok', state='on', last_reported='bad')):
            result, calls, _ = self.run_job(self.job(), [('unreachable', sensor)])
            self.assertEqual(result['result']['outcome'], 'response_unconfirmed')
            self.assertNotIn('post', calls)

    def test_post_error_classification(self):
        for response, outcome in [(dict(status='rejected', code='ha_http_401'), 'ha_request_failed'),
                                  (dict(status='unknown', code='ha_redirect_blocked'), 'ha_request_failed'),
                                  (dict(status='unknown', code='ha_http_5xx'), 'request_unknown'),
                                  (dict(status='unknown', code='ha_timeout'), 'request_unknown')]:
            result, calls, _ = self.run_job(self.job(), [('reachable', 'on')], post=response)
            self.assertEqual(result['result']['outcome'], outcome)
            self.assertEqual(calls.count('post'), 1)
            if outcome == 'request_unknown':
                self.assertEqual(result['result']['attemptState'], 'unknown')
                self.assertEqual(result['result']['review'], 1)
                self.assertEqual(result['result']['message'], shutdown.MESSAGES['request_unknown'])

    def test_post_5xx_keeps_lane_until_power_off_or_partial_confirmation(self):
        for sensor, outcome in [('off', 'powered_off'), ('on', 'ssh_stopped_ha_unconfirmed')]:
            with self.subTest(outcome=outcome):
                job = self.job()
                observed_unknown = []
                def hook(request, control):
                    with catalog.database() as db:
                        row = db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone()
                        if json.loads(row['payload'])['attempt']['state'] == 'unknown':
                            self.assertEqual(row['status'], 'running')
                            self.assertTrue(catalog.has_active_storage_shutdown(db))
                            observed_unknown.append(True)
                result, calls, _ = self.run_job(job, [('reachable', 'on'), ('reachable', 'on'), ('unreachable', sensor)],
                                               post=dict(status='unknown', code='ha_http_5xx'), hook=hook)
                self.assertEqual(result['status'], 'done')
                self.assertEqual(result['result']['outcome'], outcome)
                self.assertEqual(result['result']['attemptState'], 'unknown')
                self.assertTrue(observed_unknown)
                self.assertEqual(calls.count('post'), 1)

    def test_script_preflight_permanent_errors_block_before_intent(self):
        for code in ('ha_dns_error', 'ha_tls_error', 'ha_http_400'):
            with self.subTest(code=code):
                result, calls, _ = self.run_job(self.job(), [('reachable', 'on', dict(status='ha_error', code=code))])
                self.assertEqual(result['result']['outcome'], 'ha_request_failed')
                self.assertEqual(result['result']['detailCode'], code)
                self.assertEqual(result['result']['attemptState'], 'not_started')
                self.assertEqual(calls.count('get'), 2)
                self.assertNotIn('post', calls)

    def test_script_state_must_be_confirmed_off_before_post(self):
        for script in (dict(status='unreachable', code='ha_timeout'), 'unavailable', 'unknown'):
            with self.subTest(script=script):
                result, calls, _ = self.run_job(self.job(), [('reachable', 'on', script)])
                self.assertEqual(result['result']['outcome'], 'response_unconfirmed')
                self.assertEqual(result['result']['attemptState'], 'not_started')
                self.assertEqual(result['result']['attemptCount'], 0)
                self.assertGreater(calls.count('get'), 2)
                self.assertNotIn('post', calls)

    def test_temporary_script_lookup_recovers_within_preflight(self):
        result, calls, _ = self.run_job(self.job(), [('reachable', 'on', dict(status='unreachable', code='ha_timeout')),
                                                    ('reachable', 'on', 'off'), ('reachable', 'on'), ('unreachable', 'off')])
        self.assertEqual(result['result']['outcome'], 'powered_off')
        self.assertEqual(calls.count('post'), 1)

    def test_cancel_wins_completion_with_consistent_phase_and_code(self):
        job = self.job()
        shutdown.cancel(job['id'])
        shutdown.transition(job['id'], dict(outcome='powered_off', phaseCode='complete', phase='확인 완료', code=None), status='done')
        result = self.latest()
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(result['result']['outcome'], 'cancelled')
        self.assertEqual(result['result']['phase'], '대기 중지')
        self.assertEqual(result['result']['code'], 'cancelled')

    def test_pre_attempt_cleanup_recheck(self):
        job = self.job()
        with catalog.database(write=True) as db:
            catalog.queue_job(db, 'duplicate-cleanup', {'files': [{'keeper': {'kind': 'remote'}}]})
        result, calls, _ = self.run_job(job, [('reachable', 'on')])
        self.assertEqual(result['result']['outcome'], 'remote_cleanup_busy')
        self.assertNotIn('post', calls)

    def test_cancel_config_change_stop_and_corruption(self):
        for action, expected in [('cancel', 'cancelled'), ('config', 'config_changed'), ('stop', 'interrupted')]:
            job = self.job()
            def hook(request, control):
                if action == 'cancel':
                    shutdown.cancel(job['id'])
                elif action == 'config':
                    settings.ADDRESS_FILE.write_text('192.0.2.11')
                else:
                    raise wake.Interrupted('interrupted')
                control()
            result, calls, _ = self.run_job(job, [('reachable', 'on')], hook=hook)
            self.assertEqual(result['result']['outcome'], expected)
            self.assertNotIn('post', calls)
        job = self.job()
        job['payload'] = '{}'
        shutdown.run_storage_shutdown(job, runner=lambda *_: self.fail('corrupt payload I/O'))
        self.assertEqual(self.latest()['result']['outcome'], 'invalid_operation')

    def test_stop_event_prevents_io(self):
        job = self.job()
        stop = threading.Event()
        stop.set()
        shutdown.run_storage_shutdown(job, stop_event=stop, runner=lambda *_: self.fail('stop I/O'))
        self.assertEqual(self.latest()['result']['outcome'], 'interrupted')

    def test_post_intent_is_durable_and_cancel_during_observation(self):
        job = self.job()
        posted = [False]
        def hook(request, control):
            if request['operation'] == 'post':
                with catalog.database() as db:
                    payload = json.loads(db.execute('SELECT payload FROM jobs WHERE id=?', (job['id'],)).fetchone()[0])
                self.assertEqual(payload['attempt']['state'], 'intent')
                self.assertEqual(payload['attempt']['count'], 1)
                self.assertEqual(request['ha']['script'], 'script.shutdown_omv')
                posted[0] = True
            elif request['operation'] == 'ssh_banner' and posted[0]:
                cancelled = shutdown.cancel(job['id'])
                self.assertEqual(cancelled['status'], 'running')
                control()
        result, calls, _ = self.run_job(job, [('reachable', 'on')], hook=hook)
        self.assertEqual((result['status'], result['result']['outcome']), ('cancelled', 'cancelled'))
        self.assertEqual(result['result']['attemptState'], 'accepted')
        self.assertEqual(calls.count('post'), 1)
        self.assertIn('취소되지', result['result']['message'])

    def test_config_change_after_intent_never_posts(self):
        job = self.job()
        original = shutdown.transition
        def transition(*args, **kwargs):
            result = original(*args, **kwargs)
            if kwargs.get('attempt', {}).get('state') == 'intent':
                settings.ADDRESS_FILE.write_text('192.0.2.12')
            return result
        with patch.object(shutdown, 'transition', side_effect=transition):
            result, calls, _ = self.run_job(job, [('reachable', 'on')])
        self.assertEqual(result['result']['outcome'], 'config_changed')
        self.assertNotIn('post', calls)

    def test_cleanup_inserted_after_probes_blocks_intent(self):
        job = self.job()
        def hook(request, control):
            if request['operation'] == 'get' and request['entity'].startswith('binary_sensor.'):
                with catalog.database(write=True) as db:
                    catalog.queue_job(db, 'duplicate-cleanup', {'files': [{'keeper': {'kind': 'remote'}}]})
        result, calls, _ = self.run_job(job, [('reachable', 'on')], hook=hook)
        self.assertEqual(result['result']['outcome'], 'remote_cleanup_busy')
        self.assertNotIn('post', calls)

    def test_expired_request_and_wrong_kind_cancel(self):
        job = self.job()
        p = json.loads(job['payload'])
        p.update(requestedAt='2000-01-01T00:00:00+00:00', deadlineAt='2000-01-01T00:00:30+00:00')
        job['payload'] = json.dumps(p)
        with catalog.database(write=True) as db:
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
            scan = catalog.queue_job(db, 'scan', {})
        shutdown.run_storage_shutdown(job, runner=lambda *_: self.fail('expired request I/O'))
        self.assertEqual(self.latest()['result']['outcome'], 'response_unconfirmed')
        self.assertEqual(self.client.post(f'/api/storage/shutdown/{scan}/cancel').status_code, 404)

    def test_attempt_ledger_cannot_be_rewound(self):
        job = self.job()
        original = json.loads(job['payload'])['attempt']
        shutdown.transition(job['id'], {}, attempt=dict(original, state='intent', count=1, intentAt=catalog.now()))
        with self.assertRaises(wake.Interrupted):
            shutdown.transition(job['id'], {}, attempt=original)


    def test_switch_configuration_timeout_boundaries_and_fail_closed(self):
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': 'switch.omv_power',
                                    'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': '', 'PHOTO_SAVER_HA_SCRIPT_ENTITY': 'bad'}):
            for timeout in ('', '29', '30', '300', '1200', '1201'):
                with patch.dict(os.environ, {'PHOTO_SAVER_SHUTDOWN_TIMEOUT_SECONDS': timeout}):
                    cfg = shutdown.public_configuration()
                    self.assertEqual(cfg['available'], timeout not in ('29', '1201'))
                    self.assertEqual(cfg['mode'], 'switch')
                    if cfg['available']:
                        self.assertEqual(cfg['timeoutSeconds'], int(timeout or '300'))
                        job = self.submit()
                        with catalog.database() as db:
                            p = json.loads(db.execute('SELECT payload FROM jobs WHERE id=?', (job['id'],)).fetchone()[0])
                        self.assertTrue(shutdown.valid_payload(p))
                        shutdown.cancel(job['id'])
            cfg = shutdown.configuration()
            self.assertEqual((cfg['control_entity'], cfg['service']), ('switch.omv_power', 'switch/turn_off'))
            revision = shutdown.snapshot()['configRevision']
            with patch.dict(os.environ, {'PHOTO_SAVER_HA_SHUTDOWN_SCRIPT_ENTITY': 'bad-ignored-script'}):
                self.assertEqual(revision, shutdown.snapshot()['configRevision'])
        for entity in ('script.omv_power', 'switch.BAD!'):
            with patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': entity}):
                self.assertEqual(shutdown.configuration()['reason'], 'ha_config_invalid')

    def test_switch_waits_for_smart_plug_after_ssh_stops(self):
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': 'switch.omv_power'}):
            job = self.job()
            seen = []
            def inspect(request, control):
                if request['operation'] == 'post':
                    self.assertEqual((request['entity'], request['service']), ('switch.omv_power', 'switch/turn_off'))
                with catalog.database() as db:
                    row = db.execute('SELECT status,result FROM jobs WHERE id=?', (job['id'],)).fetchone()
                    seen.append((row['status'], json.loads(row['result'])))
            final, calls, phases = self.run_job(job, [('reachable', 'on', 'on'), ('unreachable', 'off', 'on'),
                                                        ('unreachable', 'off', 'on'), ('unreachable', 'off', 'off')], hook=inspect)
        self.assertEqual(calls.count('post'), 1)
        self.assertIn('waiting_power_off', phases)
        self.assertTrue(any(status == 'running' and r.get('phaseCode') == 'waiting_power_off' and r.get('haPowerState') == 'on' and r.get('haRunningState') == 'off' for status, r in seen))
        self.assertEqual((final['status'], final['result']['outcome'], final['result']['review']), ('done', 'powered_off', 0))
        self.assertTrue(final['result']['haPowerFresh'])
        self.assertEqual(final['result']['controlMode'], 'switch')

    def test_switch_preflight_already_off_safety_and_missing_sensor(self):
        cases = [([('unreachable', 'off', 'off')], True, 'already_off', 0),
                 ([('unreachable', 'off', 'on')], True, 'server_not_ready', 0),
                 ([('unconfigured', 'off', 'on')], False, 'server_not_ready', 0),
                 ([('reachable', 'on', 'unknown')], True, 'response_unconfirmed', 0),
                 ([('reachable', 'on', 'unavailable')], True, 'response_unconfirmed', 0),
                 ([('reachable', 'on', dict(status='ok', state='on', last_reported='bad'))], True, 'response_unconfirmed', 0),
                 ([('unconfigured', dict(status='ha_error', code='ha_http_404'), 'on'), ('unconfigured', 'off', 'off')], False, 'powered_off', 1)]
        for probes, ssh, outcome, posts in cases:
            with self.subTest(outcome=outcome, probes=probes), patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': 'switch.omv_power'}):
                settings.ADDRESS_FILE.unlink(missing_ok=True)
                final, calls, _ = self.run_job(self.job(ssh), probes)
                self.assertEqual(final['result']['outcome'], outcome)
                self.assertEqual(calls.count('post'), posts)

    def test_switch_post_attempt_unavailable_does_not_mean_off(self):
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': 'switch.omv_power'}):
            final, calls, phases = self.run_job(self.job(), [('reachable', 'on', 'on'), ('unreachable', 'off', 'unavailable')])
        self.assertEqual(calls.count('post'), 1)
        self.assertIn('waiting_power_off', phases)
        self.assertEqual(final['result']['outcome'], 'ssh_stopped_ha_unconfirmed')
        self.assertEqual(final['result']['review'], 1)
        self.assertFalse(final['result']['haPowerState'] == 'off')

    def test_switch_permanent_preflight_errors_never_post(self):
        for position in (1, 2):
            for code in ('ha_http_401', 'ha_dns_error', 'ha_tls_error', 'ha_redirect_blocked', 'ha_http_404'):
                if position == 1 and code == 'ha_http_404': continue
                probes = ['reachable', 'on', 'on']
                probes[position] = dict(status='ha_error', code=code)
                with self.subTest(position=position, code=code), patch.dict(os.environ, {'PHOTO_SAVER_HA_POWER_SWITCH_ENTITY': 'switch.omv_power'}):
                    final, calls, _ = self.run_job(self.job(), [tuple(probes)])
                    self.assertEqual(final['result']['outcome'], 'ha_request_failed')
                    self.assertEqual(calls.count('post'), 0)
                    self.assertNotIn('sentinel-secret', json.dumps(final))


if __name__ == '__main__':
    unittest.main()
