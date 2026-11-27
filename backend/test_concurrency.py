"""Lane constraints and real worker/file races; all remote I/O stays in a temp tree."""
import json
import sqlite3
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

import api
import catalog
import media
import offload
import settings
import test_offload
import worker


class ConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_offload.OffloadAndArchiveModelTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.transfer = self.fixture.fixture
        self.root = self.fixture.root
        self.managed = self.transfer.managed
        self.incoming = self.root / 'incoming'
        self.incoming.mkdir()
        patcher = patch.object(settings, 'DATA', catalog.DATA)
        patcher.start()
        self.addCleanup(patcher.stop)

    def queue(self, kind, payload=None):
        with catalog.database(write=True) as db:
            return catalog.queue_job(db, kind, payload or {})

    def complete(self, job_id):
        with catalog.database(write=True) as db:
            worker.finish(db, job_id, {})

    def status(self, job_id):
        with catalog.database() as db:
            return db.execute('SELECT status FROM jobs WHERE id=?', (job_id,)).fetchone()[0]

    def backup(self, name='backup.sqlite3'):
        path = self.root / name
        with catalog.database() as db:
            destination = sqlite3.connect(path)
            try:
                db.backup(destination)
            finally:
                destination.close()
        return path

    def test_legacy_db_migration_replaces_one_active_job_and_backfills_lanes(self):
        legacy = self.root / 'legacy-data'
        legacy.mkdir()
        with sqlite3.connect(legacy / 'catalog.sqlite3') as db:
            db.executescript("""CREATE TABLE jobs (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
                payload TEXT NOT NULL DEFAULT '{}', result TEXT, created_at TEXT NOT NULL, finished_at TEXT);
                CREATE UNIQUE INDEX one_active_job ON jobs ((1)) WHERE status IN ('queued','running');
                INSERT INTO jobs(kind,status,created_at) VALUES ('scan','done','x'),('upload','running','x'),('old-kind','done','x');""")
        with patch.object(catalog, 'DATA', legacy):
            catalog.initialize()
            catalog.initialize()  # Idempotent with an active job.
            with catalog.database() as db:
                self.assertEqual([row[0] for row in db.execute('SELECT lane FROM jobs ORDER BY id')], ['local', 'remote', 'exclusive'])
                indexes = {row[1] for row in db.execute('PRAGMA index_list(jobs)')}
                self.assertNotIn('one_active_job', indexes)
                self.assertIn('one_active_job_per_lane', indexes)
                self.assertEqual(db.execute('PRAGMA busy_timeout').fetchone()[0], 30000)
            self.queue('scan')

    def test_unknown_job_kind_rejected_fail_closed(self):
        with self.assertRaisesRegex(ValueError, '알 수 없는 작업 종류'):
            self.queue('typo')
        with catalog.database() as db:
            self.assertFalse(catalog.has_active_jobs(db))

    def test_db_triggers_block_direct_sql_exclusive_coexistence(self):
        with catalog.database(write=True) as db:
            for first, second in [('local', 'exclusive'), ('exclusive', 'remote')]:
                db.execute('DELETE FROM jobs')
                db.execute("INSERT INTO jobs(kind,lane,created_at) VALUES ('scan',?,'x')", (first,))
                with self.assertRaisesRegex(sqlite3.IntegrityError, 'exclusive job conflict'):
                    db.execute("INSERT INTO jobs(kind,lane,created_at) VALUES ('reset-all',?,'x')", (second,))
                db.execute("INSERT INTO jobs(kind,lane,status,created_at) VALUES ('reset-all',?,'done','x')", (second,))
                with self.assertRaisesRegex(sqlite3.IntegrityError, 'exclusive job conflict'):
                    db.execute("UPDATE jobs SET status='running' WHERE status='done'")
                if first == 'local':
                    db.execute("INSERT INTO jobs(kind,lane,created_at) VALUES ('upload','remote','x')")
                    with self.assertRaisesRegex(sqlite3.IntegrityError, 'exclusive job conflict'):
                        db.execute("UPDATE jobs SET lane='exclusive' WHERE lane='remote'")

    def test_local_and_remote_allowed_concurrently_same_lane_rejected(self):
        for local in ('scan', 'move', 'delete', 'xmp-link', 'duplicate-cleanup', 'thumbnails-local'):
            for remote in ('upload', 'offload', 'remote-index', 'thumbnails-remote'):
                with self.subTest(local=local, remote=remote):
                    a, b = self.queue(local), self.queue(remote)
                    for kind, lane in [(local, 'local'), (remote, 'remote')]:
                        with self.assertRaises(catalog.JobConflictError) as error:
                            self.queue(kind)
                        self.assertEqual(error.exception.conflict_lane, lane)
                    with catalog.database() as db:
                        self.assertEqual(set(lane for lane, job in catalog.active_jobs_by_lane(db).items() if job), {'local', 'remote'})
                    self.complete(a)
                    self.complete(b)

    def test_offload_refuses_a_managed_keeper_while_duplicate_cleanup_is_active(self):
        cleanup = self.queue('duplicate-cleanup', {'files': [{'keeper': {'kind': 'managed', 'id': 'one'}}]})
        with self.assertRaises(HTTPException) as error:
            api.offload_files(offload.OffloadRequest(ids=['one']))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('보존할 로컬 원본', error.exception.detail)
        self.complete(cleanup)
        with catalog.database() as db:
            self.assertEqual(catalog.active_duplicate_keeper_ids(db), set())

    def test_latest_incoming_result_survives_a_new_scan(self):
        cleanup = self.queue('duplicate-cleanup')
        self.complete(cleanup)
        scan = self.queue('scan')
        self.complete(scan)
        snapshot = api.state()
        self.assertEqual(snapshot['jobs']['local']['id'], scan)
        self.assertEqual(snapshot['latestIncomingResult']['id'], cleanup)

    def test_duplicate_video_plan_and_queue_use_the_local_worker(self):
        keeper = self.managed / 'one/clip.MP4'
        duplicate = self.incoming / 'copy.MP4'
        duplicate.write_bytes(keeper.read_bytes())
        sha, info = media.hash_file(self.incoming, duplicate.name)
        scan = self.queue('scan')
        self.complete(scan)
        with catalog.database(write=True) as db:
            db.execute(
                """INSERT INTO scan_files (scan_id,id,path,sha,size,fingerprint,status,reason)
                   VALUES (?,?,?,?,?,?,'duplicate','managed의 one/clip.MP4와 동일')""",
                (scan, 'duplicate-video', duplicate.name, sha, info.st_size, media.fingerprint(info)),
            )
        client = TestClient(api.app)
        response = client.post('/api/incoming/duplicates/plan', json={'ids': ['duplicate-video']})
        self.assertEqual(response.status_code, 200)
        plan = response.json()
        self.assertEqual(plan['groups'][0]['files'][0]['id'], 'duplicate-video')
        copy = plan['groups'][0]['keepers'][0]
        self.assertEqual((copy['kind'], copy['id']), ('managed', 'one'))
        response = client.post('/api/jobs/duplicate-cleanup', json={'items': [
            {'id': 'duplicate-video', 'keeperKind': copy['kind'], 'keeperId': copy['id']},
        ]})
        self.assertEqual(response.status_code, 202)
        queued = response.json()
        self.assertEqual(queued['lane'], 'local')
        coordinator = worker.WorkerCoordinator(self.incoming, self.managed)
        coordinator.dispatch_once()
        coordinator.running['local'].join(timeout=5)
        result = api.state()['latestIncomingResult']
        self.assertEqual((result['id'], result['status'], result['result']['cleaned']), (queued['id'], 'done', 1))
        self.assertFalse(duplicate.exists())
        self.assertTrue(keeper.is_file())

    def test_duplicate_cleanup_http_rejects_invalid_selections_and_incoming_keeper_targets(self):
        scan = self.queue('scan')
        self.complete(scan)
        sha = 'same-video-sha'
        with catalog.database(write=True) as db:
            db.executemany(
                """INSERT INTO scan_files (scan_id,id,path,sha,size,fingerprint,status)
                   VALUES (?,?,?,?,?,?,?)""",
                [(scan, file_id, file_id + '.MP4', sha, 7, 'snapshot', status)
                 for file_id, status in [('ready', 'ready'), ('first', 'duplicate'), ('second', 'duplicate')]],
            )
        client = TestClient(api.app)
        self.assertEqual(client.post('/api/incoming/duplicates/plan', json={'ids': []}).status_code, 422)
        for file_id in ('ready', 'nonexistent'):
            response = client.post('/api/incoming/duplicates/plan', json={'ids': [file_id]})
            self.assertEqual(response.status_code, 409)
            self.assertIn('검사 결과가 변경', response.json()['detail'])
        plan = client.post('/api/incoming/duplicates/plan', json={'ids': ['first', 'second']})
        self.assertEqual(plan.status_code, 200)
        keeper = next(item for item in plan.json()['groups'][0]['keepers'] if item['id'] == 'first')
        first = {'id': 'first', 'keeperKind': keeper['kind'], 'keeperId': keeper['id']}
        second = {**first, 'id': 'second'}
        response = client.post('/api/jobs/duplicate-cleanup', json={'items': [second, second]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('중복으로 선택', response.json()['detail'])
        response = client.post('/api/jobs/duplicate-cleanup', json={'items': [first, second]})
        self.assertEqual(response.status_code, 409)
        self.assertIn('정리 대상에서 제외', response.json()['detail'])
        with catalog.database() as db:
            self.assertFalse(catalog.has_active_jobs(db))

    def test_exclusive_mutual_exclusion_both_directions(self):
        for kind in catalog.JOB_LANES:
            job_id = self.queue(kind)
            with self.assertRaises(catalog.JobConflictError):
                self.queue('reset-all')
            self.complete(job_id)
        exclusive = self.queue('reset-all')
        for kind in catalog.JOB_LANES:
            with self.assertRaises(catalog.JobConflictError) as error:
                self.queue(kind)
            self.assertEqual(error.exception.conflict_lane, 'exclusive')
        self.complete(exclusive)

    def test_worker_coordinator_runs_local_while_remote_blocks(self):
        entered, release, local_done = threading.Event(), threading.Event(), threading.Event()
        observations = []

        def remote(job, *_):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('remote release')
            self.complete(job['id'])

        def local(job, *_):
            observations.append((job['status'], self.status(remote_id)))
            self.complete(job['id'])
            local_done.set()

        remote_id = self.queue('upload')
        coordinator = worker.WorkerCoordinator(handlers={'scan': local, 'upload': remote}, poll_interval=0.01)
        thread = threading.Thread(target=coordinator.run)
        thread.start()
        try:
            self.assertTrue(entered.wait(3))
            local_id = self.queue('scan')
            coordinator.wake_event.set()
            self.assertTrue(local_done.wait(3))
            self.assertEqual(observations, [('running', 'running')])
            self.assertEqual(self.status(local_id), 'done')
            self.assertEqual(self.status(remote_id), 'running')
            coordinator.stop()
            thread.join(0.05)
            self.assertTrue(thread.is_alive(), 'shutdown must wait for the active remote handler')
        finally:
            release.set()
            coordinator.stop()
            thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(self.status(remote_id), 'done')

    def test_worker_coordinator_exclusive_barrier_and_recovery(self):
        local, remote = self.queue('scan'), self.queue('upload')
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='running'")
        coordinator = worker.WorkerCoordinator(handlers={})
        coordinator.recover_stale_jobs()
        self.assertEqual([self.status(local), self.status(remote)], ['queued', 'queued'])
        self.complete(local)
        self.complete(remote)
        exclusive = self.queue('reset-all')
        started = []
        coordinator.handlers['reset-all'] = lambda job, *_: (started.append(job['lane']), self.complete(job['id']))
        # A finishing lane thread is a barrier even before reap removes it.
        release = threading.Event()
        blocker = threading.Thread(target=release.wait)
        blocker.start()
        coordinator.running['local'] = blocker
        try:
            coordinator.dispatch_once()
            self.assertEqual(self.status(exclusive), 'queued')
        finally:
            release.set()
            blocker.join(2)
        coordinator.dispatch_once()
        self.assertEqual(started, ['exclusive'])
        self.assertEqual(self.status(exclusive), 'done')
        queued = self.queue('scan')
        coordinator.stop()
        coordinator.dispatch_once()
        self.assertEqual(self.status(queued), 'queued')
        with catalog.database(write=True) as db:
            db.execute("UPDATE jobs SET status='cancelled' WHERE id=?", (queued,))
            worker.finish(db, queued, {'should': 'not overwrite'})
        self.assertEqual(self.status(queued), 'cancelled')

    def test_scan_during_offload_does_not_clobber_archived_or_xmp(self):
        # Change status after scan captured its snapshot, before its missing-file UPDATE.
        for operation in (worker.index_managed, worker.index_managed_xmp):
            with catalog.database(write=True) as db:
                db.execute("UPDATE media SET status='available' WHERE id='one'")
            with catalog.database() as db:
                before = dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone())

            def scan(*_):
                with catalog.database(write=True) as db:
                    db.execute("UPDATE media SET status='archived' WHERE id='one'")
                return iter([])

            with patch.object(worker, 'scan_tree', side_effect=scan):
                operation(self.managed)
            with catalog.database() as db:
                after = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
                self.assertEqual(after['status'], 'archived')
                self.assertEqual(after['xmp_path'], before['xmp_path'])
                self.assertEqual(after['xmp_sha'], before['xmp_sha'])

    def test_store_analysis_does_not_resurrect_offloading_or_archived(self):
        path = self.managed / 'one/clip.MP4'
        for status in ('offloading', 'archived'):
            with catalog.database(write=True) as db:
                db.execute("UPDATE media SET status=? WHERE id='one'", (status,))
            worker.store_analysis('replacement', 'one/clip.MP4', 'changed', path.stat(), ('photo', {}, None, None, '', False, None))
            with catalog.database() as db:
                row = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
                self.assertEqual(row['status'], status)
                self.assertNotEqual(row['sha'], 'changed')
                self.assertIsNotNone(row['xmp_path'])

    def test_scan_skips_new_or_changed_xmp_for_active_offload(self):
        self.fixture.upload_all()
        coordinator = worker.WorkerCoordinator(self.incoming, self.managed)
        for new_xmp in (False, True):
            with self.subTest(new_xmp=new_xmp):
                with catalog.database(write=True) as db:
                    if new_xmp:
                        db.execute("UPDATE media SET xmp_path=NULL,xmp_sha=NULL,xmp_metadata=NULL WHERE id='one'")
                    else:
                        db.execute("UPDATE media SET xmp_metadata=? WHERE id='one'", (json.dumps({'title': '기존 정보'}),))
                    before = dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone())
                remote = api.offload_files(offload.OffloadRequest(ids=['one']))['id']
                sidecar = self.managed / 'one/clip.xmp'
                sidecar.write_text('<xmp xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>변경된 정보</dc:title></xmp>')
                if new_xmp:
                    # Both sidecars match the same free owner; a rejected association
                    # must consume that owner so the second sidecar cannot retry it.
                    sidecar.with_name('clip.MP4.xmp').write_bytes(sidecar.read_bytes())
                local = self.queue('scan')
                with catalog.database() as db:
                    job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (local,)).fetchone())
                with patch.object(worker, 'associate_xmp', wraps=worker.associate_xmp) as associate:
                    with self.assertLogs(worker.log, level='WARNING') as warnings:
                        coordinator._run_job('local', job)
                self.assertEqual(self.status(local), 'done')
                self.assertEqual(self.status(remote), 'queued')
                self.assertEqual(associate.call_count, 1)
                self.assertTrue(any('XMP 연결을 건너뜁니다' in warning for warning in warnings.output))
                with catalog.database() as db:
                    after = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
                    for field in ('status', 'xmp_path', 'xmp_sha', 'xmp_metadata'):
                        self.assertEqual(after[field], before[field], field)
                self.complete(remote)

    def test_scan_skips_xmp_when_owner_is_archived_after_lookup(self):
        self.fixture.upload_all()
        remote = api.offload_files(offload.OffloadRequest(ids=['one']))['id']
        (self.managed / 'one/clip.xmp').write_text('<changed/>')
        with catalog.database() as db:
            before = dict(db.execute("SELECT * FROM media WHERE id='one'").fetchone())
        read_xmp = worker.read_xmp

        def finish_offload_after_lookup(*args):
            sidecar = read_xmp(*args)
            with catalog.database(write=True) as db:
                db.execute("UPDATE media SET status='archived' WHERE id='one'")
                worker.finish(db, remote, {})
            return sidecar

        local = self.queue('scan')
        with catalog.database() as db:
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (local,)).fetchone())
        coordinator = worker.WorkerCoordinator(self.incoming, self.managed)
        with patch.object(worker, 'read_xmp', side_effect=finish_offload_after_lookup):
            with self.assertLogs(worker.log, level='WARNING') as warnings:
                coordinator._run_job('local', job)
        self.assertEqual(self.status(local), 'done')
        self.assertTrue(any('상태가 변경' in warning for warning in warnings.output))
        with catalog.database() as db:
            after = db.execute("SELECT * FROM media WHERE id='one'").fetchone()
            self.assertEqual(after['status'], 'archived')
            for field in ('xmp_path', 'xmp_sha', 'xmp_metadata'):
                self.assertEqual(after[field], before[field], field)

    def test_upload_with_followup_reserves_media_for_xmp_and_duplicate_cleanup(self):
        job = self.transfer.queue([{'id': 'one'}, {'id': 'one', 'kind': 'xmp'}], offload_after_upload=True)
        with catalog.database() as db:
            self.assertEqual(catalog.active_offload_media_ids(db), {'one'})
        sidecar = {'path': 'new.xmp', 'sha': 'new', 'metadata': {}}
        scan = self.queue('scan')
        with catalog.database(write=True) as db:
            worker.finish(db, scan, {})
            db.execute("INSERT INTO scan_xmp(id,scan_id,file,candidates) VALUES ('x',?,?,'[\"one\"]')", (scan, json.dumps(sidecar)))
        with self.assertRaises(HTTPException) as error:
            api.link_xmp(api.XmpSelection(links=[{'id': 'x', 'media_id': 'one'}]))
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(OSError):
            worker.retain_xmp(self.incoming, self.managed, 'one', sidecar)
        duplicate = self.incoming / 'copy.MP4'
        duplicate.write_bytes((self.managed / 'one/clip.MP4').read_bytes())
        sha, info = media.hash_file(self.incoming, duplicate.name)
        with catalog.database(write=True) as db:
            db.execute("""INSERT INTO scan_files(scan_id,id,path,sha,size,fingerprint,status,reason)
                VALUES (?,'copy','copy.MP4',?,?,?,'duplicate','managed의 one/clip.MP4와 동일')""", (scan, sha, info.st_size, media.fingerprint(info)))
        with self.assertRaises(HTTPException) as error:
            api.clean_incoming_duplicates(api.DuplicateCleanupSelection(items=[{'id': 'copy', 'keeperKind': 'managed', 'keeperId': 'one'}]))
        self.assertEqual(error.exception.status_code, 409)
        self.complete(job['id'])
        with catalog.database() as db:
            self.assertEqual(catalog.active_offload_media_ids(db), set())

    def test_xmp_link_and_offload_race_blocked(self):
        self.fixture.upload_all()
        queued = api.offload_files(offload.OffloadRequest(ids=['one']))
        with catalog.database() as db:
            job = dict(db.execute('SELECT * FROM jobs WHERE id=?', (queued['id'],)).fetchone())
        sidecar = {'path': 'new.xmp', 'sha': 'new', 'metadata': {}}
        with self.assertRaisesRegex(OSError, '비우기가 진행 중'):
            worker.retain_xmp(self.incoming, self.managed, 'one', sidecar)
        with catalog.database(write=True) as db:
            with self.assertRaisesRegex(OSError, '비우기가 진행 중'):
                worker.associate_xmp(db, 'one', 'new.xmp', sidecar)
        scan = self.queue('scan')
        with catalog.database(write=True) as db:
            worker.finish(db, scan, {})
            db.execute("INSERT INTO scan_xmp(id,scan_id,file,candidates) VALUES ('x',?,?,'[\"one\"]')", (scan, json.dumps(sidecar)))
        with self.assertRaises(HTTPException) as error:
            api.link_xmp(api.XmpSelection(links=[{'id': 'x', 'media_id': 'one'}]))
        self.assertEqual(error.exception.status_code, 409)
        item = json.loads(job['payload'])['files'][0]
        original_verify = offload.verify_remote_asset

        def change_catalog(*args):
            original_verify(*args)
            with catalog.database(write=True) as db:
                db.execute("UPDATE media SET xmp_sha='changed' WHERE id='one'")

        with patch.object(offload, 'verify_remote_asset', side_effect=change_catalog):
            with self.assertRaises(HTTPException) as error:
                offload.offload_file(self.transfer.sftp, self.transfer.config, self.managed, item)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn('카탈로그', error.exception.detail)
        self.assertTrue((self.managed / item['local']).exists())
        self.assertTrue((self.managed / item['xmp']['local']).exists())

    def test_delete_thumbnail_ref_preserves_offloading_media(self):
        with catalog.database(write=True) as db:
            sha = db.execute("SELECT sha FROM media WHERE id='one'").fetchone()[0]
            thumb = media.thumbnail_path(sha)
            thumb.write_bytes(b'thumb')
            db.execute("UPDATE media SET status='offloading',thumbnail=? WHERE id='one'", (thumb.name,))
        worker.refresh_deleted_group(self.managed, sha)
        self.assertTrue(thumb.exists())

    def test_real_offload_allows_scan_move_and_delete_in_local_lane(self):
        from PIL import Image
        self.fixture.upload_all()
        Image.new('RGB', (8, 8), 'red').save(self.incoming / 'move.JPG')
        Image.new('RGB', (8, 8), 'blue').save(self.incoming / 'delete.JPG')
        entered, release = threading.Event(), threading.Event()
        original = offload.verify_remote_asset

        def block_remote(*args):
            entered.set()
            if not release.wait(5):
                raise TimeoutError('offload release')
            return original(*args)

        remote = api.offload_files(offload.OffloadRequest(ids=['one']))['id']
        coordinator = worker.WorkerCoordinator(self.incoming, self.managed, poll_interval=0.01)
        with patch.object(offload, 'verify_remote_asset', side_effect=block_remote):
            coordinator.dispatch_once()
            try:
                self.assertTrue(entered.wait(3))

                def run_local(kind, payload):
                    job_id = self.queue(kind, payload)
                    coordinator.dispatch_once()
                    coordinator.running['local'].join(3)
                    self.assertFalse(coordinator.running['local'].is_alive())
                    self.assertEqual(self.status(job_id), 'done')
                    self.assertEqual(self.status(remote), 'running')

                run_local('scan', {})
                with catalog.database() as db:
                    scanned = {row['path']: row['id'] for row in db.execute('SELECT * FROM scan_files')}
                run_local('move', {'ids': [scanned['move.JPG']]})
                self.assertFalse((self.incoming / 'move.JPG').exists())
                run_local('delete', {'ids': [scanned['delete.JPG']]})
                self.assertFalse((self.incoming / 'delete.JPG').exists())
            finally:
                release.set()
                coordinator.stop()
                for thread in coordinator.running.values():
                    thread.join(5)
        self.assertEqual(self.status(remote), 'done')
        with catalog.database() as db:
            row = db.execute("SELECT status,xmp_path FROM media WHERE id='one'").fetchone()
            self.assertEqual(row['status'], 'archived')
            self.assertIsNotNone(row['xmp_path'])

    def test_xmp_association_failure_restores_moved_sidecar(self):
        with catalog.database(write=True) as db:
            db.execute("UPDATE media SET xmp_path=NULL,xmp_sha=NULL WHERE id='one'")
        source = self.incoming / 'new.xmp'
        source.write_bytes(b'<xmp/>')
        from companions import read_xmp
        sidecar = read_xmp(self.incoming, 'new.xmp', media.fingerprint(source.stat()))
        original_move = worker.move_file

        def change_after_move(*args, **kwargs):
            original_move(*args, **kwargs)
            if args[0] == self.incoming:
                with catalog.database(write=True) as db:
                    db.execute("UPDATE media SET status='archived' WHERE id='one'")

        with patch.object(worker, 'move_file', side_effect=change_after_move):
            with self.assertRaisesRegex(OSError, '상태가 변경'):
                worker.retain_xmp(self.incoming, self.managed, 'one', sidecar)
        self.assertEqual(source.read_bytes(), b'<xmp/>')
        self.assertFalse((self.managed / 'one/new.xmp').exists())

    def test_sqlite_concurrent_write_stress(self):
        a, b = self.queue('scan'), self.queue('upload')
        failures = []
        barrier = threading.Barrier(2)

        def writes(job_id):
            try:
                barrier.wait(timeout=3)
                for i in range(80):
                    with catalog.database(write=True) as db:
                        db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps({'i': i}), job_id))
            except BaseException as exc:
                failures.append(exc)

        threads = [threading.Thread(target=writes, args=(job_id,)) for job_id in (a, b)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertFalse(any(t.is_alive() for t in threads))
        self.assertEqual(failures, [])
        with catalog.database() as db:
            self.assertEqual([json.loads(row[0])['i'] for row in db.execute('SELECT result FROM jobs')], [79, 79])

    def test_backup_and_restore_reject_active_local_or_remote_job(self):
        backup = self.backup()
        for kind in ('scan', 'upload', 'reset-all'):
            job_id = self.queue(kind)
            before = {p.name for p in catalog.DATA.iterdir()}
            for action in (settings.backup_catalog, lambda: settings.restore_catalog_file(backup)):
                with self.assertRaises(HTTPException) as error:
                    action()
                self.assertEqual(error.exception.status_code, 409)
            self.assertEqual({p.name for p in catalog.DATA.iterdir()}, before)
            self.complete(job_id)

    def test_backup_restore_blocks_concurrent_queue_job_and_accepts_legacy_jobs_schema(self):
        backup = self.backup('legacy.sqlite3')
        with sqlite3.connect(backup) as db:
            db.execute('DROP TRIGGER jobs_enforce_exclusive_insert')
            db.execute('DROP TRIGGER jobs_enforce_exclusive_update')
            db.execute('DROP INDEX one_active_job_per_lane')
            db.execute('DROP INDEX jobs_by_lane_status')
            db.execute('ALTER TABLE jobs DROP COLUMN lane')
            db.execute("INSERT INTO jobs(kind,status,created_at) VALUES ('upload','running','x')")
        db.close()  # Flush the WAL before restore opens this portable backup as immutable.
        entered, release, attempted, queued = (threading.Event() for _ in range(4))
        errors = []
        original_idle = settings.ensure_catalog_idle

        def hold(connection):
            original_idle(connection)
            entered.set()
            if not release.wait(4):
                raise TimeoutError('catalog barrier')

        def enqueue():
            try:
                attempted.set()
                self.queue('scan')
                queued.set()
            except BaseException as exc:
                errors.append(exc)

        for action in (settings.backup_catalog, lambda: settings.restore_catalog_file(backup)):
            entered.clear()
            release.clear()
            attempted.clear()
            queued.clear()
            results = []

            def operation():
                try:
                    results.append(action())
                except BaseException as exc:
                    errors.append(exc)

            with patch.object(settings, 'ensure_catalog_idle', side_effect=hold):
                owner = threading.Thread(target=operation)
                owner.start()
                self.assertTrue(entered.wait(3))
                contender = threading.Thread(target=enqueue)
                contender.start()
                try:
                    self.assertTrue(attempted.wait(3))
                    self.assertFalse(queued.wait(0.05))
                finally:
                    release.set()
                    owner.join(5)
                    contender.join(5)
            self.assertFalse(owner.is_alive() or contender.is_alive())
            self.assertTrue(queued.is_set())
            with catalog.database(write=True) as db:
                db.execute("UPDATE jobs SET status='done' WHERE kind='scan'")
            for response in results:
                if response:
                    Path(response.path).unlink(missing_ok=True)
        self.assertEqual(errors, [])
        with catalog.database() as db:
            restored = db.execute("SELECT lane,status FROM jobs WHERE kind='upload'").fetchone()
            self.assertEqual(tuple(restored), ('remote', 'failed'))

    def test_state_exposes_both_active_lanes_and_compat_job(self):
        remote = self.queue('upload')
        local = self.queue('scan')
        snapshot = api.state()
        self.assertEqual(snapshot['activeJobs']['local']['id'], local)
        self.assertEqual(snapshot['activeJobs']['remote']['id'], remote)
        self.assertEqual(snapshot['job']['id'], local)
        self.complete(local)
        self.assertEqual(api.state()['job']['id'], remote)
        self.complete(remote)
        self.assertEqual(api.state()['job']['id'], local)
        exclusive = self.queue('reset-all')
        self.assertEqual(api.state()['job']['id'], exclusive)
        self.assertEqual(api.state()['job']['lane'], 'exclusive')


if __name__ == '__main__':
    unittest.main()
