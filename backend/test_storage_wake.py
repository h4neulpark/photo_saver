"""Isolated HTTP admission and durable request bindings; never use live HA."""
import json
import os
from pathlib import Path
import tempfile
import unittest
import threading
import fcntl
import time
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
import api
import catalog
import settings
import storage_wake as wake


class WakeApiTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        for name, value in [('SETTINGS_DIR', root), ('ADDRESS_FILE', root/'address'),
                            ('STORAGE_ROOT_FILE', root/'remote-root'), ('KEY_FILE', root/'key'),
                            ('PUBLIC_KEY', root/'key.pub')]:
            p = patch.object(settings, name, value)
            p.start()
            self.addCleanup(p.stop)
        (root/'settings.lock').touch()
        p = patch.object(catalog, 'DATA', root)
        p.start()
        self.addCleanup(p.stop)
        p = patch.dict(os.environ, {'PHOTO_SAVER_HA_URL': 'http://ha.local:8123',
                                   'PHOTO_SAVER_HA_TOKEN': 'sentinel-secret'})
        p.start()
        self.addCleanup(p.stop)
        catalog.initialize()
        self.client = TestClient(api.app)
        self.addCleanup(self.client.close)

    def body(self):
        return dict(requestId=str(uuid4()), targetRevision=wake.snapshot()['targetRevision'])

    def test_ha_only_alias_terminal_replay_and_no_secrets(self):
        body = self.body()
        first = self.client.post('/api/storage/wake', json=body)
        self.assertEqual(first.status_code, 202, first.text)
        alias = self.body()
        second = self.client.post('/api/storage/wake', json=alias)
        self.assertEqual(second.json()['id'], first.json()['id'])
        stopped = self.client.post('/api/storage/wake/%s/cancel' % first.json()['id'])
        self.assertEqual(stopped.json()['job']['status'], 'cancelled')
        replay = self.client.post('/api/storage/wake', json=alias)
        self.assertEqual(replay.json()['status'], 'cancelled')
        response = self.client.get('/api/storage/wake', params={'request_id': alias['requestId']})
        self.assertEqual(response.json()['job']['id'], first.json()['id'])
        with catalog.database() as db:
            row = db.execute('SELECT * FROM jobs').fetchone()
            self.assertNotIn('sentinel-secret', json.dumps(dict(row)))
        self.assertNotIn('sentinel-secret', response.text)

    def test_validation_config_and_remote_conflict(self):
        body = self.body()
        self.assertEqual(self.client.post('/api/storage/wake', json={**body, 'extra': 1}).status_code, 422)
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_TOKEN': ''}):
            self.assertEqual(self.client.post('/api/storage/wake', json=body).status_code, 503)
        with catalog.database(write=True) as db:
            catalog.queue_job(db, 'upload', {})
        self.assertEqual(self.client.post('/api/storage/wake', json=body).status_code, 409)

    def test_local_coexists_and_read_only_routes(self):
        with catalog.database(write=True) as db:
            catalog.queue_job(db, 'scan', {})
        response = self.client.post('/api/storage/wake', json=self.body())
        self.assertEqual(response.status_code, 202)
        for url in ('/api/storage/wake', '/api/state', '/api/jobs?kind=storage-wake', '/api/settings', '/api/health'):
            self.assertEqual(self.client.get(url).status_code, 200, url)
        self.assertEqual(self.client.get('/api/state').json()['latestStorageWake']['id'], response.json()['id'])

    def test_expired_operation_never_launches_io(self):
        response = self.client.post('/api/storage/wake', json=self.body())
        with catalog.database(write=True) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (response.json()['id'],)).fetchone()
            payload = json.loads(row['payload'])
            payload['requestedAt'] = '2000-01-01T00:00:00+00:00'
            payload['deadlineAt'] = '2000-01-01T00:03:00+00:00'
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), row['id']))
            job = dict(row, payload=json.dumps(payload))
        def forbidden(*args):
            self.fail('expired job launched I/O')
        wake.run_storage_wake(job, runner=forbidden)
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['result']['outcome'], 'expired')

    def job(self):
        response = self.client.post('/api/storage/wake', json=self.body())
        self.assertEqual(response.status_code, 202, response.text)
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (response.json()['id'],))
            return dict(db.execute('SELECT * FROM jobs WHERE id=?', (response.json()['id'],)).fetchone())

    def sensor(self, state='on'):
        return dict(status='ok', state=state, last_reported=datetime.now(timezone.utc).isoformat())

    def test_true_concurrent_same_uuid_and_distinct_alias_admission(self):
        body = self.body()
        barrier = threading.Barrier(8)
        # Separate HTTP clients and database connections; do not run lifespan against production paths.
        def submit(index):
            client = TestClient(api.app)
            try:
                barrier.wait()
                response = client.post('/api/storage/wake', json=body if index < 4 else {**body, 'requestId': str(uuid4())})
                self.assertEqual(response.status_code, 202, response.text)
                return response.json()['id']
            finally:
                client.close()
        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(submit, range(8)))
        self.assertEqual(len(set(ids)), 1)
        with catalog.database() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)
            self.assertEqual(len(json.loads(db.execute('SELECT payload FROM jobs').fetchone()[0])['requests']), 5)

    def test_restart_after_intent_never_posts(self):
        job = self.job()
        payload = json.loads(job['payload'])
        payload['attempt'] = dict(state='intent', count=1, intentAt=catalog.now(), receiptAt=None)
        with catalog.database(write=True) as db:
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), job['id']))
        job['payload'] = json.dumps(payload)
        def runner(request, control):
            self.assertEqual(request['operation'], 'get')
            return self.sensor('off' if request['entity'].startswith('script.') else 'on')
        wake.run_storage_wake(job, runner=runner)
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['status'], 'done')
        self.assertEqual(result['result']['attemptState'], 'unknown')
        self.assertEqual(result['result']['attemptCount'], 1)

    def test_graceful_stop_inflight_receipt_recovers_observation_only(self):
        job = self.job()
        stop = threading.Event()
        posts = []
        def runner(request, control):
            if request['operation'] == 'post':
                posts.append(request)
                stop.set()
                return {'status': 'accepted'}
            return self.sensor('off')
        wake.run_storage_wake(job, stop_event=stop, runner=runner)
        with catalog.database() as db:
            recovered = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone())
        self.assertEqual(recovered['status'], 'running')
        self.assertEqual(json.loads(recovered['payload'])['attempt']['state'], 'intent')
        def observe(request, control):
            self.assertNotEqual(request['operation'], 'post')
            return self.sensor('off' if request['entity'].startswith('script.') else 'on')
        wake.run_storage_wake(recovered, runner=observe)
        self.assertEqual(len(posts), 1)
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['attemptState'], 'unknown')

    def test_cancel_during_io_keeps_lane_until_runner_stopped_and_db_unlocked(self):
        job = self.job()
        entered = threading.Event()
        stopped = threading.Event()
        def runner(request, control):
            entered.set()
            try:
                while True:
                    control()
                    time.sleep(.01)
            finally:
                stopped.set()
        thread = threading.Thread(target=wake.run_storage_wake, args=(job,), kwargs={'runner': runner})
        thread.start()
        self.assertTrue(entered.wait(2))
        with catalog.database(write=True) as db:
            catalog.queue_job(db, 'scan', {})
        result = self.client.post('/api/storage/wake/%s/cancel' % job['id'])
        self.assertTrue(result.json()['job']['result']['cancelRequested'])
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertTrue(stopped.is_set())
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['status'], 'cancelled')

    def test_settings_change_before_effect_and_token_revision_privacy(self):
        job = self.job()
        public = wake.snapshot()['targetRevision']
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_TOKEN': 'replacement-secret'}):
            self.assertEqual(wake.snapshot()['targetRevision'], public)
            wake.run_storage_wake(job, runner=lambda *args: self.fail('changed target launched IO'))
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['outcome'], 'config_changed')

    def test_corrupt_ledger_fails_closed(self):
        job = self.job()
        for malformed in ('not-json', '[]', '{"schemaVersion":1}'):
            job['payload'] = malformed
            wake.run_storage_wake(job, runner=lambda *args: self.fail('invalid job launched IO'))
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['outcome'], 'invalid_operation')

    def test_actual_child_watchdog_exits_harmless_blocking_operation(self):
        code = ('import storage_wake_io as m,time; '
                'm.operation=lambda request: time.sleep(30); m.main()')
        started = time.monotonic()
        child = subprocess.run([sys.executable, '-c', code],
                               input=json.dumps({'deadline': time.time()+.3})+'\n',
                               text=True, capture_output=True, timeout=2)
        self.assertEqual(child.returncode, 124)
        self.assertLess(time.monotonic()-started, 1.5)

    def test_supervisor_cancel_kills_and_reaps_child_and_keeps_token_off_argv(self):
        original = subprocess.Popen
        children = []
        def popen(argv, **kwargs):
            self.assertNotIn('sentinel-secret', json.dumps(argv))
            self.assertNotIn('PHOTO_SAVER_HA_TOKEN', kwargs['env'])
            child = original([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)
            children.append(child)
            return child
        ticks = []
        def control():
            ticks.append(1)
            if len(ticks) > 1:
                raise wake.Interrupted('cancelled')
        with patch('subprocess.Popen', side_effect=popen):
            with self.assertRaises(wake.Interrupted):
                wake.isolated_io(dict(operation='post', deadline=time.time()+2,
                                      ha={'token': 'sentinel-secret'}), control)
        self.assertIsNotNone(children[0].returncode)

    def test_invalid_urls_never_expose_values(self):
        for url in ('http://user:password@host', 'http://host/api', 'http://host/?token=secret',
                    'https://host/#secret', 'http://host/a/../b', 'http://host:bad'):
            with patch.dict(os.environ, {'PHOTO_SAVER_HA_URL': url}):
                value = wake.public_configuration()
                self.assertFalse(value['available'])
                self.assertEqual(value['reasonCode'], 'ha_config_invalid')
                self.assertNotIn(url, json.dumps(value))

    def test_settings_lock_wait_cancellation_is_bounded(self):
        job = self.job()
        with (settings.SETTINGS_DIR/'settings.lock').open('r') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            thread = threading.Thread(target=wake.run_storage_wake, args=(job,),
                                      kwargs={'runner': lambda *args: self.fail('locked settings launched IO')})
            thread.start()
            time.sleep(.05)
            self.client.post('/api/storage/wake/%s/cancel' % job['id'])
            thread.join(1)
            self.assertFalse(thread.is_alive())
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['status'], 'cancelled')

    def test_db_writer_wait_stops_with_worker_shutdown(self):
        job = self.job()
        stop = threading.Event()
        interrupted = []
        def writer():
            token = wake._control_budget.set((stop, time.time()+10, time.monotonic()+10, job['id']))
            try:
                wake.transition(job['id'], {'phase': '확인 중'})
            except wake.Interrupted as exc:
                interrupted.append(exc.reason)
            finally:
                wake._control_budget.reset(token)
        with catalog.database(write=True):
            thread = threading.Thread(target=writer)
            thread.start()
            time.sleep(.05)
            stop.set()
            thread.join(1)
            self.assertFalse(thread.is_alive())
        self.assertEqual(interrupted, ['shutdown'])
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['status'], 'running')

    def test_terminal_save_cannot_erase_concurrent_cancel_or_revive_terminal(self):
        job = self.job()
        self.client.post('/api/storage/wake/%s/cancel' % job['id'])
        wake.transition(job['id'], {'cancelRequested': False, 'outcome': 'archive_ready'}, status='done')
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['status'], 'cancelled')
        self.assertTrue(result['result']['cancelRequested'])
        self.assertIsNone(wake.transition(job['id'], {}, status='running'))

    def test_unknown_script_does_not_mean_off_and_stale_sensor_does_not_prove_ready(self):
        job = self.job()
        stop = threading.Event()
        samples = []
        def runner(request, control):
            self.assertNotEqual(request['operation'], 'post')
            samples.append(request)
            if len(samples) == 2:
                stop.set()
            return dict(status='ok', state='unknown' if request['entity'].startswith('script.') else 'on',
                        last_changed=catalog.now())
        wake.run_storage_wake(job, stop_event=stop, runner=runner)
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['result']['attemptCount'], 0)
        self.assertNotEqual(result['result']['archiveState'], 'ready')

    def test_initial_ssh_ready_skips_ha_and_blocked_is_not_boot_failure(self):
        for state in ('ready', 'auth_failed', 'host_key_error', 'path_missing', 'permission_denied', 'not_directory', 'sftp_error'):
            job = self.job()
            payload = json.loads(job['payload'])
            payload['archiveConfiguredAtAdmission'] = True
            job['payload'] = json.dumps(payload)
            with catalog.database(write=True) as db:
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
            def runner(request, control):
                self.assertEqual(request['operation'], 'ssh')
                return {'status': state, 'revision': 'a'*64}
            wake.run_storage_wake(job, runner=runner)
            result = self.client.get('/api/storage/wake').json()['job']
            self.assertEqual(result['status'], 'done')
            self.assertEqual(result['result']['attemptState'], 'not_needed')
            self.assertEqual(result['result']['outcome'], 'archive_ready' if state == 'ready' else 'archive_blocked')

    def test_worker_recovery_keeps_ledger_and_local_lane_progresses(self):
        from worker import WorkerCoordinator
        job = self.job()
        payload = json.loads(job['payload'])
        payload['attempt'] = dict(state='accepted', count=1, intentAt=catalog.now(), receiptAt=catalog.now())
        with catalog.database(write=True) as db:
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), job['id']))
            local_id = catalog.queue_job(db, 'scan', {})
        entered = threading.Event()
        release = threading.Event()
        def runner(request, control):
            self.assertEqual(request['operation'], 'get')
            entered.set()
            while not release.wait(.01):
                control()
            return self.sensor('off' if request['entity'].startswith('script.') else 'on')
        def local(job, *_):
            with catalog.database(write=True) as db:
                db.execute("UPDATE jobs SET status='done' WHERE id=?", (job['id'],))
        coordinator = WorkerCoordinator(handlers={'storage-wake': lambda job, *_: wake.run_storage_wake(job, runner=runner), 'scan': local})
        coordinator.recover_stale_jobs()
        coordinator.dispatch_once()
        self.assertTrue(entered.wait(2))
        for _ in range(100):
            with catalog.database() as db:
                done = db.execute('SELECT status FROM jobs WHERE id=?', (local_id,)).fetchone()[0] == 'done'
            if done:
                break
            time.sleep(.01)
        self.assertTrue(done)
        release.set()
        for thread in coordinator.running.values():
            thread.join(2)
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['status'], 'done')
        self.assertEqual(result['result']['attemptState'], 'accepted')

    def test_request_receipt_and_deadline_outcomes_are_distinct(self):
        class DeadlineEvent(threading.Event):
            def wait(self, timeout=None):
                raise wake.Interrupted('deadline')
        cases = [('off', 'accepted', 'startup_timeout', 1),
                 ('off', 'unknown', 'request_unknown', 1),
                 ('off', 'rejected', 'ha_error', 1),
                 ('on', None, 'startup_timeout', 0),
                 ('unknown', None, 'response_unconfirmed', 0)]
        for script, receipt, outcome, count in cases:
            with self.subTest(script=script, receipt=receipt):
                job = self.job()
                posts = []
                def runner(request, control):
                    if request['operation'] == 'post':
                        posts.append(1)
                        return {'status': receipt}
                    return self.sensor(script if request['entity'].startswith('script.') else 'off')
                wake.run_storage_wake(job, runner=runner, stop_event=DeadlineEvent())
                result = self.client.get('/api/storage/wake').json()['job']
                self.assertEqual(result['result']['outcome'], outcome)
                self.assertEqual(result['result']['attemptCount'], count)
                self.assertEqual(len(posts), count)

    def test_ha_helper_exact_post_contract_and_safe_state_projection(self):
        import storage_wake_io as helper
        from io import BytesIO
        class Response(BytesIO):
            status = 200
        class Opener:
            def __init__(self, body):
                self.body = body
                self.requests = []
            def open(self, request, timeout):
                self.requests.append(request)
                return Response(self.body)
        ha = wake.configuration()
        opener = Opener(b'[{"attributes":{"secret":"never-return"}}]')
        with patch('urllib.request.build_opener', return_value=opener):
            result = helper.operation(dict(operation='post', deadline=time.time()+2, ha=ha))
        self.assertEqual(result, {'status': 'accepted'})
        request = opener.requests[0]
        self.assertEqual(json.loads(request.data), {'entity_id': 'script.wake_omv'})
        self.assertEqual(request.full_url, 'http://ha.local:8123/api/services/script/turn_on')
        opener = Opener(json.dumps({'entity_id': ha['sensor'], 'state': 'on', 'last_updated': catalog.now(),
                                   'attributes': {'secret': 'never-return'}}).encode())
        with patch('urllib.request.build_opener', return_value=opener):
            result = helper.operation(dict(operation='get', entity=ha['sensor'], deadline=time.time()+2, ha=ha))
        self.assertEqual(result['state'], 'on')
        self.assertNotIn('never-return', json.dumps(result))
        opener = Opener(json.dumps({'entity_id': ha['sensor'], 'state': 'sentinel-secret',
                                   'last_reported': 'sentinel-secret', 'last_updated': '2026-11-26T00:00:00'}).encode())
        with patch('urllib.request.build_opener', return_value=opener):
            result = helper.operation(dict(operation='get', entity=ha['sensor'], deadline=time.time()+2, ha=ha))
        self.assertEqual(result, {'status': 'ok', 'state': 'unknown'})

    def test_ha_helper_redirects_tls_and_large_response_are_safe(self):
        import storage_wake_io as helper
        import urllib.error
        import ssl
        from io import BytesIO
        request = dict(operation='post', deadline=time.time()+2, ha=wake.configuration())
        self.assertIsNone(helper.NoRedirect().redirect_request(None, None, None, None, None))
        errors = [urllib.error.HTTPError('secret', 302, 'secret', {}, None),
                  urllib.error.HTTPError('secret', 500, 'secret', {}, None),
                  urllib.error.URLError(ssl.SSLError('secret'))]
        for error in errors:
            opener = unittest.mock.Mock()
            opener.open.side_effect = error
            with patch('urllib.request.build_opener', return_value=opener):
                result = helper.operation(request)
            self.assertEqual(result['status'], 'unknown')
            self.assertNotIn('secret', json.dumps(result))
        response = BytesIO(b'x'*65537)
        opener = unittest.mock.Mock()
        opener.open.return_value = response
        with patch('urllib.request.build_opener', return_value=opener):
            result = helper.operation(dict(request, operation='get', entity='binary_sensor.omv_running'))
        self.assertEqual(result['status'], 'unreachable')

    def test_config_change_after_intent_never_retargets_or_reposts(self):
        job = self.job()
        calls = []
        def runner(request, control):
            calls.append(request['operation'])
            if request['operation'] == 'post':
                os.environ['PHOTO_SAVER_HA_TOKEN'] = 'changed-after-intent'
                return {'status': 'accepted'}
            return self.sensor('off')
        wake.run_storage_wake(job, runner=runner)
        result = self.client.get('/api/storage/wake').json()['job']
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(result['result']['outcome'], 'config_changed')
        self.assertEqual(calls.count('post'), 1)
        self.assertEqual(result['result']['attemptCount'], 1)

    def test_stale_on_grace_does_not_mean_off_and_can_attempt_after_grace(self):
        class DeadlineEvent(threading.Event):
            def wait(self, timeout=None):
                raise wake.Interrupted('deadline')
        for age, expected in [(0, 0), (36, 1)]:
            job = self.job()
            payload = json.loads(job['payload'])
            payload['requestedAt'] = (datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat()
            payload['deadlineAt'] = (datetime.fromisoformat(payload['requestedAt'])+timedelta(seconds=180)).isoformat()
            job['payload'] = json.dumps(payload)
            with catalog.database(write=True) as db:
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
            posts = []
            def runner(request, control):
                if request['operation'] == 'post':
                    posts.append(1)
                    return {'status': 'accepted'}
                return dict(status='ok', state='off' if request['entity'].startswith('script.') else 'on',
                            last_updated='2000-01-01T00:00:00Z')
            with patch.dict(os.environ, {'PHOTO_SAVER_HA_STALE_SECONDS': '90'}):
                wake.run_storage_wake(job, runner=runner, stop_event=DeadlineEvent())
            result = self.client.get('/api/storage/wake').json()['job']
            self.assertEqual(len(posts), expected)
            self.assertEqual(result['result']['haState'], 'on')
            self.assertTrue(result['result']['haStateStale'])
            self.assertNotEqual(result['result']['serverState'], 'ha_reported_on')

    def test_ssh_helper_empty_readable_root_and_one_listing_only(self):
        import archive
        import storage_wake_io as helper
        from contextlib import nullcontext
        from unittest.mock import Mock
        import stat
        sftp = Mock()
        sftp.normalize.return_value = '/NAS'
        sftp.stat.return_value.st_mode = stat.S_IFDIR | 0o700
        class Listing:
            closed = False
            reads = 0
            def __next__(self):
                self.reads += 1
                raise StopIteration
            def close(self):
                self.closed = True
        listing = Listing()
        sftp.listdir_iter.return_value = listing
        config = {'root': '/NAS', 'address': '192.0.2.1'}
        settings.known_host_file(config['address']).touch()
        revision = wake.snapshot()['storageRevision']
        with patch.object(archive, 'archive_config', return_value=config), patch.object(archive, 'archive_connection', return_value=nullcontext((sftp, config))):
            result = helper.operation(dict(operation='ssh', storageRevision=revision, deadline=time.time()+2))
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(listing.reads, 1)
        self.assertTrue(listing.closed)
        sftp.listdir_iter.assert_called_once_with('/NAS', read_aheads=1)

    def test_ssh_helper_does_not_claim_ready_without_directory_read_permission(self):
        import archive
        import storage_wake_io as helper
        from contextlib import nullcontext
        from unittest.mock import Mock
        from fastapi import HTTPException
        import stat
        sftp = Mock()
        sftp.normalize.return_value = '/NAS'
        sftp.stat.return_value.st_mode = stat.S_IFDIR | 0o700
        sftp.listdir_iter.side_effect = HTTPException(403, 'fixed safe permission error')
        config = {'root': '/NAS', 'address': '192.0.2.1'}
        settings.known_host_file(config['address']).touch()
        revision = wake.snapshot()['storageRevision']
        with patch.object(archive, 'archive_config', return_value=config), patch.object(archive, 'archive_connection', return_value=nullcontext((sftp, config))):
            result = helper.operation(dict(operation='ssh', storageRevision=revision, deadline=time.time()+2))
        self.assertEqual(result['status'], 'permission_denied')

    def test_crlf_token_and_missing_lock_files(self):
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_TOKEN': '\r\n private-token \r\n'}):
            self.assertEqual(wake.base_configuration()['token'], 'private-token')
            self.assertIsNone(wake.base_configuration()['reason'])
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_TOKEN': 'a\nb'}):
            self.assertEqual(wake.base_configuration()['reason'], 'ha_config_invalid')
        (catalog.DATA/'catalog.lock').unlink()
        with self.assertRaises(api.HTTPException) as error:
            with wake.database(): pass
        self.assertEqual((error.exception.status_code, error.exception.detail), (409, 'settings_busy'))
        (settings.SETTINGS_DIR/'settings.lock').unlink()
        with self.assertRaises(api.HTTPException) as error:
            with wake.snapshot_lock(): pass
        self.assertEqual(error.exception.detail, 'settings_busy')

    def test_ssh_network_does_not_hold_snapshot_lock(self):
        import archive
        import storage_wake_io as helper
        from contextlib import contextmanager
        held = []
        @contextmanager
        def lock(**kwargs):
            self.assertEqual(kwargs['timeout'], .5)
            held.append(True)
            try: yield
            finally: held.pop()
        @contextmanager
        def connection(config):
            self.assertFalse(held)
            raise api.HTTPException(403, 'safe')
            yield
        config = dict(root='/NAS', address='192.0.2.1')
        settings.known_host_file(config['address']).touch()
        revision = wake.snapshot()['storageRevision']
        with patch.object(wake, 'snapshot_lock', lock), patch.object(archive, 'archive_config', return_value=config), patch.object(archive, 'archive_connection', connection):
            result = helper.operation(dict(operation='ssh', storageRevision=revision, deadline=time.time()+12))
        self.assertEqual(result['status'], 'permission_denied')

    def test_isolated_io_operation_budgets(self):
        from unittest.mock import Mock
        for op, expected in [('ssh',12), ('ssh_banner',2.5), ('get',5), ('post',5)]:
            child = Mock(returncode=0)
            child.poll.return_value = 0
            child.communicate.return_value = ('{"status":"ok"}', '')
            with patch('subprocess.Popen', return_value=child), patch.object(wake.time, 'time', return_value=100):
                wake.isolated_io(dict(operation=op, deadline=200), lambda: None)
            payload = json.loads(child.communicate.call_args_list[0].kwargs['input'])
            self.assertEqual(payload['deadline'], 100+expected)

    def test_finish_preserves_ha_error_details(self):
        for code in ('ha_http_401', 'ha_http_403', 'ha_http_404', 'ha_dns_error'):
            job = self.job()
            wake.run_storage_wake(job, runner=lambda *_: dict(status='ha_error', code=code))
            r = self.client.get('/api/storage/wake').json()['job']['result']
            self.assertEqual(r['code'], code)
            self.assertEqual(r['outcome'], 'ha_error')
            self.assertNotIn('sentinel-secret', json.dumps(r))

    def test_transient_ha_transport_errors_retry_until_recovery_or_deadline(self):
        import storage_wake_io as helper
        import urllib.error
        for error, code in [(TimeoutError(), 'ha_timeout'), (OSError(), 'ha_unreachable')]:
            for recover in (True, False):
                with self.subTest(code=code, recover=recover):
                    job = self.job()
                    ticks = [time.time(), time.monotonic()]
                    calls, waiting = [], []
                    outer = self
                    class ClockEvent(threading.Event):
                        def wait(self, timeout=None):
                            current = outer.client.get('/api/storage/wake').json()['job']
                            waiting.append(current['status'])
                            ticks[0] += timeout
                            ticks[1] += timeout
                    def runner(request, control):
                        self.assertEqual(request['operation'], 'get')
                        calls.append(request)
                        if recover and len(calls) > 2:
                            return self.sensor('off' if request['entity'].startswith('script.') else 'on')
                        with patch('urllib.request.build_opener') as build:
                            build.return_value.open.side_effect = urllib.error.URLError(error)
                            result = helper.operation(request)
                        self.assertEqual(result, dict(status='unreachable', code=code))
                        return result
                    with patch.object(wake.time, 'time', side_effect=lambda: ticks[0]), patch.object(wake.time, 'monotonic', side_effect=lambda: ticks[1]):
                        wake.run_storage_wake(job, runner=runner, stop_event=ClockEvent())
                    final = self.client.get('/api/storage/wake').json()['job']
                    self.assertGreater(len(calls), 2)
                    self.assertTrue(waiting)
                    self.assertEqual(set(waiting), {'running'})
                    self.assertEqual(final['result']['attemptCount'], 0)
                    self.assertEqual(final['result']['outcome'], 'server_responding_settings_required' if recover else 'response_unconfirmed')
                    self.assertEqual(final['status'], 'done' if recover else 'failed')
                    if not recover:
                        self.assertGreaterEqual(ticks[0], datetime.fromisoformat(json.loads(job['payload'])['deadlineAt']).timestamp())

    def test_deterministic_ha_transport_errors_fail_before_retry_and_post_is_unknown(self):
        import socket
        import ssl
        import storage_wake_io as helper
        for error, code in [(ssl.SSLError(), 'ha_tls_error'), (socket.gaierror(), 'ha_dns_error')]:
            with self.subTest(code=code):
                self.assertEqual(helper.transport_error(error, False), dict(status='ha_error', code=code))
                job = self.job()
                wake.run_storage_wake(job, runner=lambda *_: helper.transport_error(error, False))
                final = self.client.get('/api/storage/wake').json()['job']
                self.assertEqual(final['status'], 'failed')
                self.assertEqual(final['result']['code'], code)
        for error, code in [(TimeoutError(), 'ha_timeout'), (OSError(), 'ha_unreachable')]:
            self.assertEqual(helper.transport_error(error, True), dict(status='unknown', code=code))

    def prepared_archive_job(self, attempt='accepted'):
        job = self.job()
        payload = json.loads(job['payload'])
        payload['archiveConfiguredAtAdmission'] = True
        payload['attempt'] = dict(state=attempt, count=1 if attempt == 'accepted' else 0,
                                  intentAt=catalog.now() if attempt == 'accepted' else None,
                                  receiptAt=catalog.now() if attempt == 'accepted' else None)
        job['payload'] = json.dumps(payload)
        with catalog.database(write=True) as db:
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
        return job

    def test_mount_grace_recovers_and_expires(self):
        for failure, recover in [('path_missing', True), ('sftp_error', True), ('path_missing', False), ('sftp_error', False)]:
            with self.subTest(failure=failure, recover=recover):
                job = self.prepared_archive_job()
                ticks = [time.time(), time.monotonic()]
                started = ticks[1]
                phases, ssh_calls = [], []
                outer = self
                class ClockEvent(threading.Event):
                    def wait(self, timeout=None):
                        phases.append(outer.client.get('/api/storage/wake').json()['job']['result']['phaseCode'])
                        ticks[0] += timeout
                        ticks[1] += timeout
                def runner(request, control):
                    if request['operation'] == 'ssh':
                        ssh_calls.append(1)
                        return dict(status='ready' if recover and len(ssh_calls) >= 3 else failure)
                    return self.sensor('off')
                with patch.object(wake.time, 'time', side_effect=lambda: ticks[0]), patch.object(wake.time, 'monotonic', side_effect=lambda: ticks[1]):
                    wake.run_storage_wake(job, runner=runner, stop_event=ClockEvent())
                r = self.client.get('/api/storage/wake').json()['job']['result']
                self.assertEqual(r['outcome'], 'archive_ready' if recover else 'archive_blocked')
                self.assertIn('waiting_mount', phases)
                self.assertGreater(len(ssh_calls), 1)
                if not recover:
                    self.assertAlmostEqual(ticks[1] - started, 30)

    def test_already_booting_not_needed_waits_for_mount(self):
        for failure in ('path_missing', 'sftp_error'):
            for recover in (True, False):
                with self.subTest(failure=failure, recover=recover):
                    job = self.prepared_archive_job(attempt='not_started')
                    ticks = [time.time(), time.monotonic()]
                    started = ticks[1]
                    calls, observations = [], []
                    outer = self
                    class ClockEvent(threading.Event):
                        def wait(self, timeout=None):
                            result = outer.client.get('/api/storage/wake').json()['job']['result']
                            observations.append((result['attemptState'], result['phaseCode']))
                            ticks[0] += timeout
                            ticks[1] += timeout
                    def runner(request, control):
                        self.assertNotEqual(request['operation'], 'post')
                        if request['operation'] == 'ssh':
                            calls.append(request)
                            if len(calls) == 1: return dict(status='unreachable')
                            return dict(status='ready' if recover and len(calls) >= 3 else failure)
                        return self.sensor('off' if request['entity'].startswith('script.') else 'on')
                    with patch.object(wake.time, 'time', side_effect=lambda: ticks[0]), patch.object(wake.time, 'monotonic', side_effect=lambda: ticks[1]):
                        wake.run_storage_wake(job, runner=runner, stop_event=ClockEvent())
                    result = self.client.get('/api/storage/wake').json()['job']['result']
                    self.assertIn(('not_needed', 'waiting_mount'), observations)
                    self.assertEqual(result['attemptState'], 'not_needed')
                    self.assertEqual(result['attemptCount'], 0)
                    self.assertEqual(result['outcome'], 'archive_ready' if recover else 'archive_blocked')
                    if not recover:
                        self.assertAlmostEqual(ticks[1] - started, 35)

    def test_ever_on_latches_across_later_off(self):
        job = self.prepared_archive_job()
        ticks = [time.time(), time.monotonic()]
        sensors = []
        class ClockEvent(threading.Event):
            def wait(self, timeout=None):
                ticks[0] += timeout
                ticks[1] += timeout
                if len(sensors) >= 2: raise wake.Interrupted('deadline')
        def runner(request, control):
            if request['operation'] == 'ssh': return dict(status='unreachable')
            if request['entity'].startswith('script.'): return self.sensor('off')
            sensors.append(1)
            return self.sensor('on' if len(sensors) == 1 else 'off')
        with patch.object(wake.time, 'time', side_effect=lambda: ticks[0]), patch.object(wake.time, 'monotonic', side_effect=lambda: ticks[1]):
            wake.run_storage_wake(job, runner=runner, stop_event=ClockEvent())
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['outcome'], 'archive_unconfirmed')

    def test_mount_grace_bounds_slow_probe_and_survives_disconnect(self):
        job = self.prepared_archive_job()
        ticks = [time.time(), time.monotonic()]
        calls = []
        class ClockEvent(threading.Event):
            def wait(self, timeout=None):
                ticks[0] += timeout
                ticks[1] += timeout
        def runner(request, control):
            if request['operation'] == 'ssh':
                calls.append(request)
                if len(calls) == 1: return dict(status='path_missing')
                self.assertLessEqual(request['deadline'], ticks[0]+25.01)
                ticks[0] += 26
                ticks[1] += 26
                return dict(status='unreachable')
            return self.sensor('off')
        with patch.object(wake.time, 'time', side_effect=lambda: ticks[0]), patch.object(wake.time, 'monotonic', side_effect=lambda: ticks[1]):
            wake.run_storage_wake(job,runner=runner,stop_event=ClockEvent())
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['outcome'],'archive_blocked')
        self.assertEqual(len(calls),2)

    def test_old_on_with_failed_ssh_allows_one_wake_after_grace(self):
        class DeadlineEvent(threading.Event):
            def wait(self, timeout=None): raise wake.Interrupted('deadline')
        for elapsed, count in [(0,0),(36,1)]:
            job = self.prepared_archive_job(attempt='not_started')
            p = json.loads(job['payload'])
            p['requestedAt'] = (datetime.now(timezone.utc)-timedelta(seconds=elapsed)).isoformat()
            p['deadlineAt'] = (datetime.fromisoformat(p['requestedAt'])+timedelta(seconds=180)).isoformat()
            job['payload'] = json.dumps(p)
            with catalog.database(write=True) as db:
                db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'],job['id']))
            posts = []
            def runner(request, control):
                if request['operation'] == 'ssh': return dict(status='unreachable')
                if request['operation'] == 'post': posts.append(1); return dict(status='accepted')
                return dict(status='ok',state='off' if request['entity'].startswith('script.') else 'on',
                            last_reported=(datetime.now(timezone.utc)-timedelta(seconds=3600)).isoformat())
            wake.run_storage_wake(job,runner=runner,stop_event=DeadlineEvent())
            r = self.client.get('/api/storage/wake').json()['job']['result']
            self.assertEqual(len(posts),count)
            self.assertFalse(r['haStateStale'])

    def test_stable_ha_on_without_ssh_finishes_without_waking(self):
        for age in (300,3600,86400):
            job = self.job()
            def runner(request, control):
                self.assertEqual(request['operation'],'get')
                return dict(status='ok',state='off' if request['entity'].startswith('script.') else 'on',
                            last_reported=(datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat())
            wake.run_storage_wake(job,runner=runner)
            r = self.client.get('/api/storage/wake').json()['job']['result']
            self.assertEqual(r['outcome'],'server_responding_settings_required')
            self.assertEqual(r['attemptCount'],0)

    def test_api_wrong_kind_cancel_mismatch_and_alias_limit(self):
        body = self.body()
        first = self.client.post('/api/storage/wake', json=body).json()
        self.assertEqual(self.client.post('/api/storage/wake', json={**body, 'targetRevision': 'b'*64}).status_code, 409)
        with catalog.database(write=True) as db:
            local_id = catalog.queue_job(db, 'scan', {})
            row = db.execute('SELECT payload FROM jobs WHERE id=?', (first['id'],)).fetchone()
            payload = json.loads(row['payload'])
            payload['requests'] += [dict(id=str(uuid4()), targetRevision=body['targetRevision']) for _ in range(127)]
            db.execute('UPDATE jobs SET payload=? WHERE id=?', (json.dumps(payload), first['id']))
        self.assertEqual(self.client.post('/api/storage/wake/%s/cancel' % local_id).status_code, 404)
        self.assertEqual(self.client.post('/api/storage/wake', json=self.body()).status_code, 429)
        self.assertEqual(self.client.delete('/api/settings/ssh-host-key').status_code, 409)

    def test_restore_active_wake_is_failed_and_never_runs(self):
        from worker import WorkerCoordinator
        job = self.job()
        backup = catalog.DATA/'backup.sqlite3'
        import sqlite3
        source = catalog.open_db()
        with sqlite3.connect(backup) as target:
            source.backup(target)
        source.close()
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='cancelled' WHERE id=?", (job['id'],))
        with patch.object(settings, 'DATA', catalog.DATA):
            settings.restore_catalog_file(backup)
        coordinator = WorkerCoordinator(handlers={'storage-wake': lambda *args: self.fail('restored wake executed')})
        coordinator.recover_stale_jobs()
        coordinator.dispatch_once()
        self.assertFalse(coordinator.running)
        self.assertEqual(self.client.get('/api/storage/wake').json()['job']['status'], 'failed')


    def test_malformed_saved_payloads_fail_closed_through_recovery_and_admission(self):
        from worker import WorkerCoordinator
        base = json.loads(self.job()['payload'])
        cases = []
        def variant(**updates):
            value = json.loads(json.dumps(base))
            value.update(updates)
            cases.append(value)
        for state in ('not_started', 'not_needed', 'observing_existing'):
            for key in ('intentAt', 'receiptAt'):
                attempt = dict(base['attempt'], state=state)
                attempt[key] = catalog.now()
                variant(attempt=attempt)
        variant(attempt=dict(base['attempt'], intentAt=catalog.now(), receiptAt=catalog.now()))
        for receipt in ('bad', '2026-01-01T00:00:00', 123, [], {}):
            variant(attempt=dict(state='accepted', count=1, intentAt=catalog.now(), receiptAt=receipt))
        variant(attempt=dict(state='intent', count=1, intentAt=catalog.now(), receiptAt=catalog.now()))
        variant(attempt=dict(state='accepted', count=1, intentAt=catalog.now(), receiptAt=None))
        variant(attempt=dict(state='unknown', count=1, intentAt='bad', receiptAt=None))
        for schema in (True, 1.0, '1', None, [], {}):
            variant(schemaVersion=schema)
        for value in (123, None, [], {}):
            variant(requests=[dict(base['requests'][0], id=value)])
        for key in ('attempt', 'requests', 'targetRevision', 'storageRevision', 'configRevision'):
            variant(**{key: []})
        cases.extend([[], None, 'bad'])
        for value in cases:
            with self.subTest(payload=value):
                self.assertFalse(wake.valid_payload(value))
                job = self.job()
                job['payload'] = json.dumps(value)
                with catalog.database(write=True) as db:
                    db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
                if isinstance(value, dict) and value.get('requests') == base['requests']:
                    response = self.client.post('/api/storage/wake', json=dict(requestId=base['requests'][0]['id'], targetRevision=base['targetRevision']))
                    self.assertEqual(response.status_code, 409)
                coordinator = WorkerCoordinator()
                coordinator.recover_stale_jobs()
                with catalog.database() as db:
                    recovered = dict(db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone())
                wake.run_storage_wake(recovered, runner=lambda *args: self.fail('invalid payload launched I/O'))
                self.assertEqual(self.client.get('/api/storage/wake').json()['job']['result']['outcome'], 'invalid_operation')

    def test_real_archive_banner_failure_retries_until_ready_without_resending(self):
        import archive
        import storage_wake_io as helper
        from unittest.mock import MagicMock
        import stat
        for attempted in (False, True):
            with self.subTest(attempted=attempted):
                job = self.job()
                payload = json.loads(job['payload'])
                payload['archiveConfiguredAtAdmission'] = True
                if attempted:
                    payload['attempt'] = dict(state='intent', count=1, intentAt=catalog.now(), receiptAt=None)
                job['payload'] = json.dumps(payload)
                with catalog.database(write=True) as db:
                    db.execute('UPDATE jobs SET payload=? WHERE id=?', (job['payload'], job['id']))
                config = dict(address='192.0.2.1', account='test', root='/archive')
                settings.known_host_file(config['address']).touch()
                calls = []
                def runner(request, control):
                    calls.append(request['operation'])
                    if request['operation'] != 'ssh':
                        return self.sensor('off') if request['operation'] == 'get' else dict(status='accepted')
                    result = helper.operation(request)
                    if calls.count('ssh') == 1:
                        self.assertEqual(result['status'], 'unreachable')
                        current = self.client.get('/api/storage/wake').json()['job']
                        self.assertNotEqual(current['result'].get('serverState'), 'ssh_responding')
                    return result
                with patch.object(archive, 'archive_config', return_value=config), patch.object(archive.paramiko, 'HostKeys') as hosts, patch.object(archive.paramiko, 'SSHClient') as ssh:
                    hosts.return_value.lookup.return_value = {'ssh-ed25519': MagicMock()}
                    client = ssh.return_value.__enter__.return_value
                    client.connect.side_effect = [archive.paramiko.SSHException('Error reading SSH protocol banner'), None]
                    sftp = client.open_sftp.return_value.__enter__.return_value
                    sftp.normalize.return_value = '/archive'
                    sftp.stat.return_value.st_mode = stat.S_IFDIR | 0o700
                    sftp.listdir_iter.return_value = MagicMock()
                    wake.run_storage_wake(job, runner=runner)
                final = self.client.get('/api/storage/wake').json()['job']
                self.assertEqual(final['result']['outcome'], 'archive_ready')
                self.assertEqual(calls.count('ssh'), 2)
                self.assertEqual(calls.count('post'), 0 if attempted else 1)


    def test_attempt_receipts_match_real_transition_states(self):
        payload = json.loads(self.job()['payload'])
        for state in ('intent', 'accepted', 'rejected', 'unknown'):
            for receipt in (None, catalog.now()):
                payload['attempt'] = dict(state=state, count=1, intentAt=catalog.now(), receiptAt=receipt)
                expected = (receipt is None if state == 'intent' else receipt is not None if state in ('accepted', 'rejected') else True)
                self.assertEqual(wake.valid_payload(payload), expected)

    def test_real_archive_sftp_protocol_error_has_typed_evidence(self):
        import archive
        import storage_wake_io as helper
        from unittest.mock import MagicMock
        revision = wake.snapshot()['storageRevision']
        config = dict(address='192.0.2.1', account='test', root='/archive')
        settings.known_host_file(config['address']).touch()
        with patch.object(archive, 'archive_config', return_value=config), patch.object(archive.paramiko, 'HostKeys') as hosts, patch.object(archive.paramiko, 'SSHClient') as ssh:
            hosts.return_value.lookup.return_value = {'ssh-ed25519': MagicMock()}
            ssh.return_value.__enter__.return_value.open_sftp.side_effect = archive.paramiko.SFTPError('Incompatible sftp protocol')
            result = helper.operation(dict(operation='ssh', storageRevision=revision, deadline=time.time()+2))
        self.assertEqual(result['status'], 'sftp_error')


if __name__ == '__main__':
    unittest.main()
