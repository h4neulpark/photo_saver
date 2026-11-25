"""Job history is read-only, bounded, filterable, and safe for legacy results."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
import catalog


class JobsApiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        patcher = patch.object(catalog, 'DATA', Path(temporary.name))
        patcher.start()
        self.addCleanup(patcher.stop)
        catalog.initialize()
        self.client = TestClient(api.app)
        self.addCleanup(self.client.close)

    def add(self, kind='scan', lane='local', status='done', result=None, raw=False):
        with catalog.database(write=True) as db:
            return db.execute(
                'INSERT INTO jobs(kind,lane,status,result,payload,created_at,finished_at) VALUES (?,?,?,?,?,?,?)',
                (kind, lane, status, result if raw else json.dumps(result or {}),
                 '{"secret":"private-payload"}', '2026-11-25T00:00:00+00:00', None if status in ('queued', 'running') else '2026-11-25T00:01:00+00:00'),
            ).lastrowid

    def query(self, **params):
        response = self.client.get('/api/jobs', params=params)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn('private-payload', response.text)
        self.assertTrue(all('payload' not in job for job in response.json()['jobs']))
        return response.json()

    def test_empty_summary_and_cursor(self):
        self.assertEqual(self.query(), {'jobs': [], 'summary': {'total': 0, 'active': 0, 'attention': 0, 'done': 0}, 'nextBeforeId': None, 'hasMore': False})

    def test_cursor_is_descending_and_stable_with_new_jobs(self):
        ids = [self.add() for _ in range(5)]
        first = self.query(limit=2)
        self.assertEqual([j['id'] for j in first['jobs']], ids[-2:][::-1])
        self.assertTrue(first['hasMore'])
        self.add()
        second = self.query(limit=2, before_id=first['nextBeforeId'])
        last = self.query(limit=2, before_id=second['nextBeforeId'])
        self.assertEqual([j['id'] for j in second['jobs'] + last['jobs']], ids[:3][::-1])
        self.assertFalse(last['hasMore'])
        self.assertIsNone(last['nextBeforeId'])

    def test_filters_and_global_summary(self):
        self.add(result={'review': 1})
        self.add('upload', 'remote', 'failed')
        self.add('move', status='cancelled')
        active = self.add('upload', 'remote', 'running', {'failed': 1})
        for params, count in [({'status': 'attention'}, 3), ({'status': 'active'}, 1), ({'status': 'done'}, 1), ({'status': 'failed'}, 1), ({'status': 'cancelled'}, 1), ({'lane': 'remote'}, 2), ({'kind': 'move'}, 1), ({'lane': 'remote', 'kind': 'upload', 'status': 'active'}, 1)]:
            with self.subTest(params=params):
                result = self.query(**params)
                self.assertEqual(len(result['jobs']), count)
                self.assertEqual(result['summary'], {'total': 4, 'active': 1, 'attention': 3, 'done': 1})
        self.assertEqual(self.query(status='active')['jobs'][0]['id'], active)
        self.assertEqual(self.query(before_id=1)['summary']['total'], 4)

    def test_attention_signals_match_python_and_sql(self):
        for result in ({'error': 'problem'}, {'failed': 1}, {'review': 1}, {'companionReview': 1}):
            self.add(result=result)
        self.add(result={'failed': None, 'review': 0})
        jobs = self.query(status='attention')['jobs']
        self.assertEqual(len(jobs), 4)
        self.assertTrue(all(j['hasAttention'] for j in jobs))
        self.assertEqual(self.query()['summary']['attention'], 4)

    def test_active_partial_failures_are_not_attention(self):
        for status in ('queued', 'running'):
            with self.subTest(status=status):
                job_id = self.add(status=status, result={'failed': 1})
                data = self.query()
                self.assertIs(data['jobs'][0]['hasAttention'], False)
                self.assertEqual(data['summary']['attention'], 0)
                self.assertEqual(self.query(status='attention')['jobs'], [])
                self.assertEqual(self.query(status='active')['jobs'][0]['id'], job_id)
                with catalog.database(write=True) as db:
                    db.execute('DELETE FROM jobs')

    def test_malformed_null_and_non_object_results(self):
        for raw in (None, '', '{bad', 'null', '[]', '"string"', '42'):
            self.add(result=raw, raw=True)
        data = self.query()
        self.assertTrue(all(job['result'] == {} and not job['hasAttention'] for job in data['jobs']))
        self.assertEqual(data['summary']['attention'], 0)
        self.assertEqual(self.query(status='attention')['jobs'], [])

    def test_created_at_and_metadata_always_present(self):
        self.add()
        job = self.query()['jobs'][0]
        self.assertEqual(job['createdAt'], '2026-11-25T00:00:00+00:00')
        for name in ('items', 'errors'):
            self.assertEqual(job['resultMeta'][name + 'Total'], 0)
            self.assertEqual(job['resultMeta'][name + 'Shown'], 0)
            self.assertIs(job['resultMeta'][name + 'Truncated'], False)

    def test_truncation_prioritizes_attention_and_does_not_mutate_db(self):
        items = [{'status': 'moved', 'id': n} for n in range(120)] + [{'status': 'review', 'id': 'priority'}, 'legacy-item']
        self.add(result={'items': items, 'errors': ['error'] * 101, 'unmatchedCompanions': list(range(102))})
        job = self.query()['jobs'][0]
        self.assertEqual(job['result']['items'][:2], items[-2:])
        for name, total in (('items', 122), ('errors', 101), ('unmatchedCompanions', 102)):
            self.assertEqual(len(job['result'][name]), 100)
            self.assertEqual(job['resultMeta'][name + 'Total'], total)
            self.assertTrue(job['resultMeta'][name + 'Truncated'])
        with catalog.database() as db:
            self.assertEqual(len(json.loads(db.execute('SELECT result FROM jobs').fetchone()[0])['items']), 122)

    def test_lists_at_limit_are_not_truncated(self):
        self.add(result={'items': list(range(100)), 'errors': []})
        self.assertFalse(self.query()['jobs'][0]['resultMeta']['itemsTruncated'])

    def test_invalid_query_parameters_rejected(self):
        for params in ({'limit': 0}, {'limit': 101}, {'limit': 'bad'}, {'before_id': 0}, {'lane': 'device'}, {'status': 'running'}, {'kind': 'unknown'}, {'lane': "local' OR 1=1 --"}):
            with self.subTest(params=params):
                self.assertEqual(self.client.get('/api/jobs', params=params).status_code, 422)


if __name__ == '__main__':
    unittest.main()
