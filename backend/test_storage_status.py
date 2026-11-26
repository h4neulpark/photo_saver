import asyncio
import json
import threading
import subprocess
import sys
import time
import ssl
import socket
import os
import urllib.error
from contextlib import ExitStack
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import storage_status
import storage_wake
import storage_wake_io


class StatusTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.clock = 1800000000
        self.mono = 100
        self.calls = []
        self.config = dict(url='http://ha.invalid', token='private', sensor='binary_sensor.omv_running', reason=None)
        self.result = dict(status='ok', state='on', last_reported=self.iso())
        self.service = storage_status.StatusService(self.run_io, lambda: dict(self.config), lambda: self.clock, lambda: self.mono, ssh_address=lambda: None)

    def iso(self, offset=0):
        return datetime.fromtimestamp(self.clock + offset, timezone.utc).isoformat()

    def run_io(self, request, control):
        self.calls.append(request)
        control()
        return dict(self.result)

    async def test_freshness_table(self):
        for state, offset, expected, reason in [
            ('on', 0, 'running', None), ('off', 0, 'no_response', None),
            ('on', -300, 'running', None), ('on', -3600, 'running', None),
            ('off', -86400, 'no_response', None), ('on', 30, 'running', None),
            ('on', 31, 'stale', 'report_time_future'),
            ('unknown', -999, 'unknown', 'sensor_unknown'),
            ('unavailable', 0, 'unknown', 'sensor_unavailable')]:
            with self.subTest(state=state, offset=offset):
                p = self.service.project((dict(state=state, last_reported=self.iso(offset)), self.iso()))
                self.assertEqual((p['status'], p['reasonCode']), (expected, reason))

    async def test_timestamp_presence_and_redaction(self):
        for bad in [None, 'SECRET', 5, '2026-01-01T00:00:00', {}, 'x' * 200]:
            p = self.service.project((dict(state='on', last_reported_present=True,
                last_reported=bad, last_updated=self.iso()), self.iso()))
            self.assertEqual(p['reasonCode'], 'report_time_invalid')
            self.assertNotIn('SECRET', json.dumps(p))
        p = self.service.project((dict(state='off', last_updated=self.iso()), self.iso()))
        self.assertEqual(p['reportedAtSource'], 'last_updated')
        p = self.service.project((dict(state='on', last_reported=self.iso(), last_updated=self.iso(-999)), self.iso()))
        self.assertEqual(p['status'], 'running')

    async def test_cache_force_expiry_history(self):
        self.service.stale_seconds = 90
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'PHOTO_SAVER_HA_STALE_SECONDS': '90'}).start()
        a = await self.service.get()
        self.clock += 91
        self.mono += 1
        b = await self.service.get(True)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(b['fetchedAt'], a['fetchedAt'])
        self.assertEqual(b['status'], 'stale')
        self.mono += 5
        self.result = dict(status='unreachable')
        c = await self.service.get(True)
        self.assertEqual(c['status'], 'unknown')
        self.assertEqual(c['lastKnown']['rawState'], 'on')
        self.mono += 29
        await self.service.get()
        self.assertEqual(len(self.calls), 2)
        self.mono += 1
        await self.service.get()
        self.assertEqual(len(self.calls), 3)

    async def test_success_ttl_and_private_token_revision(self):
        a = await self.service.get()
        self.mono += 14
        await self.service.get()
        self.assertEqual(len(self.calls), 1)
        self.mono += 1
        await self.service.get()
        self.assertEqual(len(self.calls), 2)
        self.config['token'] = 'another-private'
        b = await self.service.get()
        self.assertEqual(len(self.calls), 3)
        self.assertNotEqual(a['sourceRevision'], b['sourceRevision'])
        self.assertNotIn('private', json.dumps(b))

    async def test_single_flight_cancellation_and_eventloop(self):
        entered, release = threading.Event(), threading.Event()
        def slow(request, control):
            self.calls.append(request)
            entered.set()
            release.wait(2)
            return self.result
        self.service.runner = slow
        tasks = [asyncio.create_task(self.service.get(True)) for _ in range(12)]
        await asyncio.to_thread(entered.wait, 1)
        await asyncio.sleep(.01)
        self.assertEqual(len(self.calls), 1)
        tasks[0].cancel()
        release.set()
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        self.assertTrue(all(r['status'] == 'running' for r in responses[1:]))
        self.assertTrue(all(r['cached'] is False for r in responses[1:]))
        self.assertIsNone(self.service.task)
        self.assertEqual(self.calls[0]['operation'], 'get')
        self.assertTrue(self.calls[0]['statusProjection'])

    async def test_config_swap_during_io_discards_history(self):
        entered, release = threading.Event(), threading.Event()
        def slow(request, control):
            entered.set()
            release.wait(2)
            return self.result
        self.service.runner = slow
        task = asyncio.create_task(self.service.get())
        await asyncio.to_thread(entered.wait, 1)
        self.config['token'] = 'changed'
        release.set()
        response = await task
        self.assertEqual(response['reasonCode'], 'config_changed')
        self.assertIsNone(response['lastKnown'])
        self.assertIsNone(self.service.record)

    async def test_failures_allowlisted_and_exception_cleanup(self):
        for code, expected in [('ha_http_401', 'ha_auth_error'), ('ha_http_403', 'ha_auth_error'),
                               ('ha_http_404', 'sensor_missing'), ('ha_tls_error', 'ha_tls_error'),
                               ('ha_http_503', 'ha_http_5xx'), ('ha_http_302', 'ha_redirect_blocked'),
                               ('ha_dns_error', 'ha_dns_error'), ('ha_timeout', 'ha_timeout'),
                               ('SECRET', 'ha_response_invalid')]:
            self.result = dict(status='ha_error', code=code)
            self.mono += 6
            response = await self.service.get(True)
            self.assertEqual(response['reasonCode'], expected)
            self.assertNotIn('SECRET', json.dumps(response))
        def fail(*args):
            raise RuntimeError('SECRET')
        self.service.runner = fail
        self.mono += 6
        response = await self.service.get(True)
        self.assertEqual(response['reasonCode'], 'ha_unreachable')
        self.assertIsNone(self.service.task)

    async def test_unconfigured_never_calls_runner(self):
        self.config['reason'] = 'ha_not_configured'
        self.assertEqual((await self.service.get())['status'], 'unconfigured')
        self.assertEqual(self.calls, [])

    async def test_opt_in_staleness_and_invalid_environment(self):
        for value, expected in [('0', 'running'), ('90', 'stale'), ('-1', 'running'), ('bad', 'running')]:
            with patch.dict(os.environ, {'PHOTO_SAVER_HA_STALE_SECONDS': value}):
                self.service.source(self.config)
                p = self.service.project((dict(state='on', last_reported=self.iso(-300)), self.iso()))
                self.assertEqual(p['status'], expected)
                self.assertEqual(p['freshForSeconds'], 0 if value == '90' else None)

    async def test_two_layer_matrix_and_polling(self):
        cases = [('on','reachable','running',None,15), ('on','unconfigured','running',None,15),
                 ('on','unreachable','booting','ssh_unreachable',5), ('off','reachable','running','ha_lagging',15),
                 ('off','unreachable','no_response',None,15), ('off','unconfigured','no_response',None,15),
                 ('unconfigured','reachable','running',None,15), ('unconfigured','unreachable','no_response',None,15),
                 ('unconfigured','unconfigured','unconfigured','ha_not_configured',60),
                 ('stale','reachable','running',None,15), ('stale','unreachable','stale','report_time_invalid',30),
                 ('stale','unconfigured','stale','report_time_invalid',30),
                 ('unknown','reachable','running','sensor_unknown',15), ('unknown','unreachable','unknown','sensor_unknown',30),
                 ('error','reachable','running','ha_dns_error',15), ('error','unconfigured','unknown','ha_dns_error',30)]
        for ha, ssh, status, reason, poll in cases:
            with self.subTest(ha=ha, ssh=ssh):
                obs = dict(state=ha, last_reported=self.iso(), last_changed=self.iso(-100))
                if ha == 'unconfigured': obs = dict(reason='ha_not_configured')
                if ha == 'stale': obs = dict(state='on', last_reported='invalid')
                if ha == 'error': obs = dict(reason='ha_dns_error')
                obs['ssh'] = dict(configured=ssh != 'unconfigured', status=ssh, latencyMs=1 if ssh == 'reachable' else None)
                p = self.service.project((obs, self.iso()))
                self.assertEqual((p['status'], p['reasonCode'], p['nextPollInSeconds']), (status, reason, poll))
        self.assertEqual(self.service.project((dict(reason='config_changed'), None))['nextPollInSeconds'], 1)

    async def test_ssh_only_probe_and_address_policy_revision(self):
        self.config['reason'] = 'ha_not_configured'
        self.service.ssh_address = lambda: '192.0.2.1'
        calls = []
        def probe(req, control):
            calls.append(req)
            return dict(status='reachable', latencyMs=2)
        self.service.ssh_probe = probe
        a = await self.service.get()
        self.assertEqual(a['status'], 'running')
        self.assertEqual(calls[0]['operation'], 'ssh_banner')
        self.assertEqual(self.calls, [])
        self.service.ssh_address = lambda: '192.0.2.2'
        b = await self.service.get()
        self.assertNotEqual(a['sourceRevision'], b['sourceRevision'])
        with patch.dict(os.environ, {'PHOTO_SAVER_HA_STALE_SECONDS': '90'}):
            c = await self.service.get()
            self.assertNotEqual(c['sourceRevision'], b['sourceRevision'])

    async def test_async_http_followers_leave_health_responsive_and_touch_no_storage(self):
        import api
        import httpx
        import catalog
        import settings
        import archive
        entered, release = threading.Event(), threading.Event()
        def slow(request, control):
            self.calls.append(request)
            entered.set()
            release.wait(2)
            control()
            return self.result
        self.service.runner = slow
        with ExitStack() as stack:
            stack.enter_context(patch.object(storage_status, 'service', self.service))
            for module, name in [(api, 'database'), (catalog, 'database'), (settings, 'read_setting'),
                                 (storage_wake, 'snapshot'), (storage_wake, 'admit'),
                                 (archive, 'archive_config'), (archive, 'archive_connection')]:
                stack.enter_context(patch.object(module, name, side_effect=AssertionError('storage side effect')))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url='http://test') as client:
                requests = [asyncio.create_task(client.get('/api/storage/status?refresh=true')) for _ in range(48)]
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 1))
                    health = await asyncio.wait_for(client.get('/api/health'), .75)
                    self.assertEqual(health.json(), {'status': 'ok'})
                    bad = await asyncio.wait_for(client.get('/api/storage/status?refresh=bad'), .75)
                    self.assertEqual(bad.status_code, 422)
                    self.assertEqual(len(self.calls), 1)
                finally:
                    release.set()
                responses = await asyncio.gather(*requests)
                self.assertTrue(all(r.status_code == 200 and r.json()['status'] == 'running' for r in responses))
                self.assertTrue(all(r.headers['cache-control'] == 'no-store' for r in responses))
                self.assertEqual(len(self.calls), 1)
                self.assertNotIn('private', json.dumps([r.json() for r in responses]))

    async def test_config_incarnation_prevents_aba_result_publish(self):
        entered, release = threading.Event(), threading.Event()
        def slow(request, control):
            entered.set()
            release.wait(2)
            return self.result
        self.service.runner = slow
        old = asyncio.create_task(self.service.get())
        await asyncio.to_thread(entered.wait, 1)
        self.config['token'] = 'second'
        self.service.source(self.config)
        self.config['token'] = 'private'
        self.service.source(self.config)
        release.set()
        self.assertEqual((await old)['reasonCode'], 'config_changed')
        self.assertIsNone(self.service.record)


class BaseAndHelperTests(unittest.TestCase):
    def test_helper_get_transport_projection_and_bad_responses(self):
        request = dict(operation='get', statusProjection=True, deadline=time.time()+4,
                       entity='binary_sensor.omv_running', ha=dict(url='https://ha.invalid', token='sentinel-secret'))
        class Response:
            def __init__(self, raw): self.raw = raw
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                assert size == 65537
                return self.raw
        valid = dict(entity_id=request['entity'], state='on', attributes={'secret': 'sentinel-secret'}, last_reported='secret-invalid')
        for raw, status in [(json.dumps(valid).encode(), 'ok'), (b'[]', 'invalid_response'),
                            (b'{broken', 'invalid_response'), (b'x'*65537, 'invalid_response'),
                            (b'{"entity_id":"wrong"}', 'invalid_response'),
                            (json.dumps(dict(valid, state='secret-state')).encode(), 'invalid_response')]:
            with self.subTest(status=status, length=len(raw)):
                with patch.object(storage_wake_io.urllib.request, 'build_opener') as build:
                    build.return_value.open.return_value = Response(raw)
                    result = storage_wake_io.operation(request)
                    self.assertEqual(result['status'], status)
                    self.assertNotIn('secret', json.dumps(result))
                    handlers = build.call_args.args
                    self.assertEqual(handlers[0].proxies, {})
                    self.assertIsInstance(handlers[1], storage_wake_io.NoRedirect)
                    req = build.return_value.open.call_args.args[0]
                    self.assertEqual(req.get_method(), 'GET')
                    self.assertEqual(req.full_url, 'https://ha.invalid/api/states/binary_sensor.omv_running')
                    self.assertLessEqual(build.return_value.open.call_args.kwargs['timeout'], 5)
        for code in (401, 403, 404, 500, 302):
            with patch.object(storage_wake_io.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = urllib.error.HTTPError('hidden', code, 'secret', {}, None)
                result = storage_wake_io.operation(request)
                self.assertEqual(result['code'], 'ha_http_5xx' if code >= 500 else 'ha_redirect_blocked' if code == 302 else 'ha_http_' + str(code))
                self.assertNotIn('secret', json.dumps(result))
        with patch.object(storage_wake_io.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = urllib.error.URLError(ssl.SSLError('secret'))
            self.assertEqual(storage_wake_io.operation(request)['code'], 'ha_tls_error')

    def test_status_helper_hard_budget_kills_reaps_and_keeps_secrets_private(self):
        original = subprocess.Popen
        children = []
        def popen(argv, **kwargs):
            self.assertNotIn('sentinel-secret', json.dumps(argv))
            self.assertNotIn('PHOTO_SAVER_HA_TOKEN', kwargs['env'])
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            child = original([sys.executable, '-c', 'import time; time.sleep(30)'], **kwargs)
            children.append(child)
            return child
        config = dict(url='http://ha.invalid', token='sentinel-secret', sensor='binary_sensor.omv_running', reason=None)
        service = storage_status.StatusService(config=lambda: config)
        start = time.monotonic()
        with patch.dict('os.environ', {'PHOTO_SAVER_HA_TOKEN': 'sentinel-secret'}), patch('subprocess.Popen', side_effect=popen):
            try:
                service.read(config)
            except storage_wake.Interrupted:
                pass
        self.assertLess(time.monotonic()-start, 5)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].returncode)
    def test_monitor_independent_of_wake_validation(self):
        with patch.dict('os.environ', {'PHOTO_SAVER_HA_URL': 'http://ha.invalid',
                'PHOTO_SAVER_HA_TOKEN': 'private', 'PHOTO_SAVER_HA_SCRIPT_ENTITY': 'bad',
                'PHOTO_SAVER_WAKE_TIMEOUT_SECONDS': 'bad'}, clear=True):
            self.assertIsNone(storage_wake.base_configuration()['reason'])
            self.assertEqual(storage_wake.configuration()['reason'], 'ha_config_invalid')

    def test_base_validation(self):
        for url, token in [('http://u:p@ha.invalid', 'a'), ('http://ha.invalid/api', 'a'),
                           ('http://ha.invalid:bad', 'a'), ('http://ha.invalid', 'a\nb')]:
            with patch.dict('os.environ', {'PHOTO_SAVER_HA_URL': url, 'PHOTO_SAVER_HA_TOKEN': token}, clear=True):
                self.assertEqual(storage_wake.base_configuration()['reason'], 'ha_config_invalid')

    def test_banner_probe_and_transport_error_classification(self):
        from unittest.mock import Mock
        request = dict(operation='ssh_banner', address='192.0.2.1', deadline=time.time()+10)
        for banner, expected in [(b'SSH-2.0-OpenSSH\r\n', 'reachable'), (b'HTTP/1.1\r\n', 'unreachable'), (b'', 'unreachable')]:
            connection = Mock()
            connection.__enter__ = Mock(return_value=connection)
            connection.__exit__ = Mock(return_value=False)
            connection.recv.return_value = banner
            with patch.object(socket, 'create_connection', return_value=connection) as connect:
                result = storage_wake_io.operation(request)
            self.assertEqual(result['status'], expected)
            connect.assert_called_once_with(('192.0.2.1', 22), timeout=1.5)
            connection.recv.assert_called_once_with(256)
            connection.__exit__.assert_called_once()
        for error in [TimeoutError(), ConnectionRefusedError()]:
            with patch.object(socket, 'create_connection', side_effect=error):
                self.assertEqual(storage_wake_io.operation(request)['status'], 'unreachable')
        for error, code in [(socket.gaierror('private'), 'ha_dns_error'), (TimeoutError(), 'ha_timeout'), (ssl.SSLError(), 'ha_tls_error')]:
            with patch.object(storage_wake_io.urllib.request, 'build_opener') as build:
                build.return_value.open.side_effect = urllib.error.URLError(error)
                result = storage_wake_io.operation(dict(operation='get', deadline=time.time()+2,
                    ha=dict(url='http://ha.invalid', token='private'), entity='binary_sensor.omv_running'))
            self.assertEqual(result['code'], code)

    def test_opt_in_projection_preserves_legacy(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size):
                return json.dumps(dict(entity_id='binary_sensor.omv_running', state='on',
                                       last_reported=None, last_updated='2026-11-26T00:00:00Z')).encode()
        class Opener:
            def open(self, *args, **kwargs): return Response()
        request = dict(operation='get', deadline=9999999999,
                       ha=dict(url='http://ha.invalid', token='private'), entity='binary_sensor.omv_running')
        with patch.object(storage_wake_io.urllib.request, 'build_opener', return_value=Opener()):
            legacy = storage_wake_io.operation(request)
            extended = storage_wake_io.operation(dict(request, statusProjection=True))
        self.assertEqual(legacy, dict(status='ok', state='on', last_updated='2026-11-26T00:00:00+00:00'))
        self.assertTrue(extended['last_reported_present'])
        self.assertNotIn('last_reported', extended)
