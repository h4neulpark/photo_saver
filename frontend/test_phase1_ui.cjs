'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse the established five-root DOM fixture without modifying its contract.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, jobDismissKey, dismissResult, isResultDismissed, loadDismissedResults,
      loadDeviceUploadHistory, recordDeviceUploadHistory, deviceUploadEntry, mergedJobEntries, loadJobs,
      refreshDeviceUpload, startIncomingUpload, incomingResultSection, resultBanner, loadCatalog,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, storage, context, doc, win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeManaged } = vm.runInContext('({ createHarness, flushMicrotasks, makeManaged })', context);
const plain = object => JSON.parse(JSON.stringify(object));
const job = (id = 1, overrides = {}) => ({ id, kind: 'move', lane: 'local', status: 'done', createdAt: `2026-11-25T00:00:${String(id).padStart(2, '0')}Z`, finishedAt: '2026-11-25T00:01:00Z', result: { moved: 1, items: [{ path: 'photo.jpg', status: 'moved' }] }, ...overrides });
const response = data => ({ ok: true, status: 200, json: async () => data });
function jobsPage(h, items = [job()]) {
  h.view.connecting = false; h.view.jobs.items = items; h.view.jobs.loadedOnce = true;
  h.win.location.hash = '#jobs'; h.render();
}
function timers(h) {
  const pending = new Map(); let next = 0;
  h.win.setTimeout = (fn, ms) => { pending.set(++next, { fn, ms }); return next; };
  h.win.clearTimeout = id => pending.delete(id);
  return pending;
}
function catalog(h) {
  h.view.catalog = { summary: { files: 1, attempts: 2, remoteTotal: 3 }, folders: [], remoteFolders: [], rows: [], total: 0, page: 1, pages: 1 };
  h.win.location.hash = '#catalog'; h.render();
}

test('dismiss keys resist reused IDs and active jobs cannot be hidden', () => {
  const h = createHarness(), first = job(), second = job(1, { createdAt: 'later' });
  h.dismissResult(h.jobDismissKey(first));
  assert.equal(h.isResultDismissed(first), true);
  assert.equal(h.isResultDismissed(second), false);
  assert.equal(h.isResultDismissed({ ...first, status: 'running' }), false);
  assert.equal(h.jobDismissKey(null), '');
  assert.equal(h.jobDismissKey({ id: 1, finishedAt: 'end' }), '1:end');
  assert.equal(h.jobDismissKey({ id: 1, kind: 'move', status: 'done' }), '1:move:done');
});

test('dismiss persistence is FIFO bounded and storage errors retain memory', () => {
  const h = createHarness();
  for (let n = 0; n < 105; n++) h.dismissResult(`key-${n}`);
  assert.equal(h.view.dismissedResults.size, 100);
  assert.equal(h.view.dismissedResults.has('key-4'), false);
  assert.deepEqual([...h.loadDismissedResults()], [...h.view.dismissedResults]);
  h.context.localStorage.setItem = () => { throw new Error('quota'); };
  h.dismissResult('memory-only');
  assert.equal(h.view.dismissedResults.has('memory-only'), true);
  h.context.localStorage.getItem = () => { throw new Error('blocked'); };
  assert.equal(h.loadDismissedResults().size, 0);
});

test('corrupt or incompatible storage safely falls back', () => {
  const h = createHarness();
  for (const value of ['bad', 'null', '{"version":2,"keys":["x"]}', '{"version":1,"keys":42}']) {
    h.storage.set('photo-saver-dismissed-results-v1', value);
    assert.equal(h.loadDismissedResults().size, 0);
    h.storage.set('photo-saver-upload-history-v1', value);
    assert.equal(h.loadDeviceUploadHistory().length, 0);
  }
});

test('reset clears dismissals, browser history and pending search', () => {
  const h = createHarness(), pending = timers(h); catalog(h);
  const input = h.page.querySelector('#catalog-query'); input.value = 'query';
  input.dispatchEvent({ type: 'input', target: input });
  h.dismissResult('x'); h.recordDeviceUploadHistory(job('device', { source: 'device' }));
  assert.equal(pending.size, 1);
  h.clearCatalogViews();
  assert.equal(pending.size, 0); assert.equal(h.view.dismissedResults.size, 0); assert.equal(h.view.deviceUploadHistory.length, 0);
  assert.equal(h.storage.has('photo-saver-dismissed-results-v1'), false);
  assert.equal(h.storage.has('photo-saver-upload-history-v1'), false);
});

test('incoming result banner sits below scan and honors manual details close', () => {
  const h = createHarness(); h.win.location.hash = '#incoming';
  h.state.latestIncomingResult = job(1, { result: { review: 1, items: [{ status: 'review', path: '<unsafe>' }] } }); h.render();
  const main = h.page.querySelector('main');
  assert.ok(main.children.indexOf(h.page.querySelector('#incoming-scan-strip')) < main.children.indexOf(h.page.querySelector('#incoming-result-slot')));
  assert.ok(h.page.querySelector('.result-banner-warn'));
  const details = h.page.querySelector('#incoming-result-items'); assert.notEqual(details.getAttribute('open'), null);
  details.open = false; h.render(); assert.equal(h.page.querySelector('#incoming-result-items').getAttribute('open'), null);
  h.actions['dismiss-result'](h.jobDismissKey(h.state.latestIncomingResult)); h.render();
  assert.equal(h.page.querySelector('.incoming-result'), null);
});

test('terminal banners use severity, default details and never hide history', () => {
  const h = createHarness();
  assert.match(h.resultBanner(job(), '결과'), /result-banner-ok/);
  assert.match(h.resultBanner(job(1, { status: 'failed', result: { error: '<error>' } }), '실패'), /role="alert"/);
  assert.match(h.resultBanner(job(1, { status: 'cancelled' }), '중지'), /result-banner-warn/);
  h.dismissResult(h.jobDismissKey(job())); jobsPage(h);
  assert.equal(h.page.querySelectorAll('.job-card').length, 1);
});

test('upload dismissal clears summary but preserves browser history and active progress', () => {
  const h = createHarness();
  Object.assign(h.view.deviceUpload, { batchId: 2, running: true, totalFiles: 1, totalBytes: 10, results: [{ status: 'done' }] });
  h.actions['dismiss-upload-result'](); assert.equal(h.view.deviceUpload.totalFiles, 1);
  h.view.deviceUpload.running = false; h.actions['dismiss-upload-result']();
  assert.equal(h.view.deviceUpload.dismissedBatchId, 2); assert.equal(h.view.deviceUpload.totalFiles, 0); assert.equal(h.view.deviceUpload.results.length, 0);
});

test('device history caps batches and prioritizes exceptions, cancellation and renames', () => {
  const h = createHarness();
  const items = Array.from({ length: 110 }, (_, id) => ({ name: `${id}.jpg`, status: 'done' }));
  items.push({ name: 'bad', status: 'failed' }, { name: 'stop', status: 'cancelled' }, { name: 'rename', status: 'done', result: { renamed: true } });
  for (let n = 0; n < 22; n++) h.recordDeviceUploadHistory(job(`device-${n}`, { source: 'device', result: { items } }));
  assert.equal(h.view.deviceUploadHistory.length, 20);
  const entry = h.view.deviceUploadHistory[0];
  assert.equal(entry.itemsTotal, 113); assert.equal(entry.itemsTruncated, true); assert.equal(entry.result.items.length, 100);
  assert.deepEqual(plain(entry.result.items.slice(0, 3)), items.slice(-3));
  assert.equal(h.loadDeviceUploadHistory().length, 20);
});

test('jobs shell and unchanged details DOM survive polling and keep manual expansion', () => {
  const h = createHarness(); jobsPage(h);
  const main = h.page.querySelector('main'), card = h.page.querySelector('.job-card'), details = card.querySelector('details');
  details.open = true; details.dispatchEvent({ type: 'toggle', target: details }); h.render();
  assert.equal(h.page.querySelector('main'), main); assert.equal(h.page.querySelector('.job-card'), card); assert.equal(card.querySelector('details'), details); assert.equal(details.open, true);
  h.view.jobs.items[0].result.items.push({ status: 'review', path: 'new' }); h.render();
  assert.equal(card.querySelector('details').open, true);
});

test('jobs filters include browser entries and active overlay progress', () => {
  const h = createHarness(); jobsPage(h, [job(1, { kind: 'upload', lane: 'remote', status: 'running', result: {} })]);
  h.state.activeJobs.remote = job(1, { kind: 'upload', lane: 'remote', status: 'running', result: { totalFiles: 10, completedFiles: 5 } });
  h.render(); assert.equal(h.page.querySelector('.job-card progress').getAttribute('value'), '50');
  Object.assign(h.view.deviceUpload, { running: true, startedAt: '2026-11-25T12:00:00Z', totalFiles: 4, completedFiles: 2 }); h.refreshDeviceUpload();
  assert.equal(h.page.querySelectorAll('.job-card').length, 2); assert.ok(h.page.querySelector('.job-source-tag'));
  assert.match(h.doc.getElementById('navigation').textContent, /2/);
  h.view.jobs.laneFilter = 'device'; h.render(); assert.equal(h.page.querySelectorAll('.job-card').length, 1);
  h.view.jobs.statusFilter = 'done'; h.render(); assert.equal(h.page.querySelectorAll('.job-card').length, 0);
});

test('jobs load request sequencing prevents stale filters overwriting current results', async () => {
  const h = createHarness(), resolvers = []; jobsPage(h, []);
  h.setFetch(() => new Promise(resolve => resolvers.push(resolve)));
  const first = h.loadJobs({ reset: true }); h.view.jobs.statusFilter = 'attention'; const second = h.loadJobs({ reset: true });
  resolvers[1](response({ jobs: [job(2, { status: 'failed' })], summary: {}, hasMore: false, nextBeforeId: null })); await second;
  resolvers[0](response({ jobs: [job(1)], summary: {}, hasMore: false, nextBeforeId: null })); await first;
  assert.equal(h.view.jobs.items[0].id, 2); assert.equal(h.view.jobs.busy, false);
});

test('load more and silent refresh preserve older pages and cursor', async () => {
  const h = createHarness(); jobsPage(h, [job(3)]); h.view.jobs.hasMore = true; h.view.jobs.nextBeforeId = 3;
  h.setFetch(async url => { assert.match(url, /before_id=3/); return response({ jobs: [job(2)], summary: { total: 3 }, hasMore: true, nextBeforeId: 2 }); });
  await h.loadJobs({ more: true });
  h.setFetch(async () => response({ jobs: [job(4)], summary: { total: 4 }, hasMore: true, nextBeforeId: 4 }));
  await h.loadJobs({ silent: true, preserveLoaded: true });
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [4, 3, 2]); assert.equal(h.view.jobs.nextBeforeId, 2);
});

test('silent refresh removes completed active-filter jobs when a successor occupies the lane', async () => {
  const h = createHarness(), old = job(10, { status: 'running' }), next = job(11, { status: 'running' });
  jobsPage(h, [old]); h.view.jobs.statusFilter = 'active';
  h.state.jobs.local = next; h.state.activeJobs.local = next;
  h.setFetch(async () => response({ jobs: [next], summary: { active: 1 }, hasMore: false, nextBeforeId: null }));
  await h.loadJobs({ silent: true, preserveLoaded: true });
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [11]);
  assert.deepEqual(plain(h.mergedJobEntries().map(item => item.id)), [11]);
  assert.equal(h.page.querySelectorAll('.job-card').length, 1);
  await h.actions['refresh-jobs']();
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [11]);
});

test('refresh reveals more history when the first page grows beyond its previous terminal cursor', async () => {
  const h = createHarness(); jobsPage(h, [job(30)]);
  Object.assign(h.view.jobs, { loadedOnce: true, hasMore: false, nextBeforeId: null });
  const firstPage = Array.from({ length: 30 }, (_, index) => job(31 - index));
  h.setFetch(async () => response({ jobs: firstPage, summary: { total: 31 }, hasMore: true, nextBeforeId: 2 }));
  await h.actions['refresh-jobs']();
  assert.equal(h.view.jobs.hasMore, true); assert.equal(h.view.jobs.nextBeforeId, 2);
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), firstPage.map(item => item.id));
  assert.ok(h.page.querySelector('[data-action="load-more-jobs"]'));
});

test('refresh replaces its first-page window and updates the cursor when no older page remains', async () => {
  const h = createHarness(); jobsPage(h, [job(31), job(30)]);
  Object.assign(h.view.jobs, { loadedOnce: true, hasMore: false, nextBeforeId: null });
  h.setFetch(async () => response({ jobs: [job(33), job(32)], summary: { total: 33 }, hasMore: true, nextBeforeId: 32 }));
  await h.actions['refresh-jobs']();
  assert.equal(h.view.jobs.hasMore, false); assert.equal(h.view.jobs.nextBeforeId, null);
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [33, 32, 31, 30]);
  h.setFetch(async () => response({ jobs: [job(34), job(33)], summary: { total: 34 }, hasMore: true, nextBeforeId: 33 }));
  h.view.jobs.items = [job(35)];
  await h.actions['refresh-jobs']();
  assert.equal(h.view.jobs.hasMore, true); assert.equal(h.view.jobs.nextBeforeId, 33);
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [34, 33]);
});

test('refresh reaching the end removes stale entries and clears the old pagination cursor', async () => {
  const h = createHarness(); jobsPage(h, [job(10), job(9)]);
  Object.assign(h.view.jobs, { hasMore: true, nextBeforeId: 9 });
  h.setFetch(async () => response({ jobs: [job(11)], summary: { total: 1 }, hasMore: false, nextBeforeId: null }));
  await h.actions['refresh-jobs']();
  assert.deepEqual(plain(h.view.jobs.items.map(item => item.id)), [11]);
  assert.equal(h.view.jobs.hasMore, false); assert.equal(h.view.jobs.nextBeforeId, null);
  assert.equal(h.page.querySelector('[data-action="load-more-jobs"]'), null);
});

test('incoming followup actions precede history and the final dismiss button', () => {
  const h = createHarness(); h.win.location.hash = '#incoming';
  h.state.latestIncomingResult = job(1, { result: { moved: 1, review: 1, items: [{ status: 'review', path: 'a.jpg' }] } });
  h.render();
  const controls = h.page.querySelector('.incoming-next-actions').children;
  assert.deepEqual(plain([...controls].map(el => el.dataset.action || el.getAttribute('href'))), ['open-unassigned', 'rescan-incoming', '#jobs', 'dismiss-result']);
});

test('incoming details do not inherit manual closure when a new job reuses its numeric ID', () => {
  const h = createHarness(); h.win.location.hash = '#incoming';
  h.state.latestIncomingResult = job(1, { result: { review: 1, items: [{ status: 'review' }] } }); h.render();
  h.page.querySelector('#incoming-result-items').open = false;
  h.state.latestIncomingResult = job(1, { createdAt: '2026-11-25T01:00:00Z', result: { review: 1, items: [{ status: 'review' }] } }); h.render();
  assert.notEqual(h.page.querySelector('#incoming-result-items').getAttribute('open'), null);
});

test('mixed timestamp formats sort chronologically and equal instants use finite stable ID ordering', () => {
  const h = createHarness(); jobsPage(h, [job(9, { createdAt: '2026-11-25T00:00:00+00:00' }), job(10, { createdAt: '2026-11-25T00:00:00.000Z' })]);
  h.view.deviceUploadHistory = [job('device-b', { source: 'device', createdAt: '2026-11-25T00:00:00.123Z' }), job('device-a', { source: 'device', createdAt: '2026-11-25T00:00:00.123+00:00' })];
  assert.deepEqual(plain(h.mergedJobEntries().map(item => item.id)), ['device-b', 'device-a', 10, 9]);
  h.view.deviceUploadHistory[0].createdAt = '2026-11-25T00:00:00.000Z';
  h.view.deviceUploadHistory[1].createdAt = 'invalid';
  assert.deepEqual(plain(h.mergedJobEntries().map(item => item.id)), ['device-b', 10, 9, 'device-a']);
});

test('jobs API errors preserve loaded cards and present retry', async () => {
  const h = createHarness(); jobsPage(h); h.setFetch(async () => { throw new Error('offline'); });
  await h.loadJobs({ silent: true, preserveLoaded: true });
  assert.equal(h.page.querySelectorAll('.job-card').length, 1); assert.ok(h.page.querySelector('#jobs-error [role="alert"]')); assert.equal(h.view.jobs.busy, false);
});

test('completed snapshots remove stale active cards under the active filter', () => {
  const h = createHarness(); jobsPage(h, [job(1, { status: 'running' })]); h.view.jobs.statusFilter = 'active';
  h.state.jobs.local = job(1); h.state.activeJobs.local = null; h.render();
  assert.equal(h.page.querySelectorAll('.job-card').length, 0);
});

test('jobs polling fetches only for new active IDs or completion transitions', async () => {
  const h = createHarness(); jobsPage(h, [job()]);
  const snapshots = { timezone: 'Asia/Seoul', incoming: [], managed: [], events: [], pendingXmp: [], scan: null, jobs: {}, activeJobs: {} };
  let count = 0;
  h.setFetch(async url => {
    if (url === '/api/state') return response(snapshots);
    count++; return response({ jobs: [job(), job(2, { status: 'running' })], summary: {}, hasMore: false, nextBeforeId: null });
  });
  await h.syncState(); assert.equal(count, 0);
  snapshots.jobs.local = snapshots.activeJobs.local = job(2, { status: 'running' });
  await h.syncState(); assert.equal(count, 1);
  await h.syncState(); assert.equal(count, 1);
  snapshots.jobs.local = job(2); snapshots.activeJobs.local = null;
  await h.syncState(); assert.equal(count, 2);
});

test('completed device batches record history in finally without a server job', async () => {
  const h = createHarness(); h.view.connecting = false; h.view.deviceUpload.autoScan = false;
  await h.startIncomingUpload([{ name: 'unsupported.dng', size: 10 }]);
  assert.equal(h.view.deviceUploadHistory.length, 1);
  assert.equal(h.view.deviceUploadHistory[0].result.items[0].status, 'skipped');
  assert.ok(h.view.deviceUpload.startedAt); assert.equal(h.view.deviceUpload.running, false);
});

test('truncated history details explain bounds and escape API content', () => {
  const h = createHarness(); jobsPage(h, [job(1, { result: { items: [{ path: '<script>', status: 'review' }] }, resultMeta: { itemsTotal: 120, itemsTruncated: true } })]);
  assert.match(h.page.textContent, /총 120건 중 1건 표시/); assert.equal(h.page.querySelector('script'), null);
});

test('events has one confirm primary action and secondary create for existing events', () => {
  const h = createHarness(); h.state.events = [{ id: 'ev1', name: 'Trip', parent: null }]; h.state.managed = [makeManaged('one')]; h.view.eventId = 'ev1'; h.view.eventSelection.add('one'); h.render();
  assert.equal(h.page.querySelectorAll('[data-action="confirm-event"]').length, 1);
  assert.match(h.page.querySelector('[data-action="confirm-event"]').textContent, /선택 1개 분류 확정/);
  assert.equal(h.page.querySelector('[data-action="new-event"]').classList.contains('primary'), false);
});

test('catalog has semantic counted tabs and keyboard navigation', async () => {
  const h = createHarness(); catalog(h); h.setFetch(async () => response(h.view.catalog));
  assert.equal(h.page.querySelectorAll('[role="tab"]').length, 3); assert.equal(h.page.querySelector('[role="tab"].primary'), null);
  const tab = h.page.querySelector('#catalog-tab-files'); tab.dispatchEvent({ type: 'keydown', key: 'End', target: tab }); await flushMicrotasks();
  assert.equal(h.view.catalogTab, 'remote'); assert.equal(h.doc.activeElement.id, 'catalog-tab-remote');
  assert.equal(h.page.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'), 'catalog-tab-remote');
});

test('catalog debounce waits for IME, uses 280ms, immediate clear, and cancels on route', async () => {
  const h = createHarness(), pending = timers(h); catalog(h);
  const input = h.page.querySelector('#catalog-query');
  input.dispatchEvent({ type: 'compositionstart', target: input }); input.value = '한'; input.dispatchEvent({ type: 'input', target: input, isComposing: true }); assert.equal(pending.size, 0);
  input.dispatchEvent({ type: 'compositionend', target: input }); assert.equal([...pending.values()][0].ms, 280);
  input.value = ''; input.dispatchEvent({ type: 'input', target: input }); assert.equal(pending.size, 1); assert.equal([...pending.values()][0].ms, 0);
  h.win.location.hash = '#incoming'; h.loadRoute(); assert.equal(pending.size, 0);
});

test('catalog scope loads immediately and soft requests retain visible results', async () => {
  const h = createHarness(); catalog(h); h.setFetch(() => new Promise(() => {}));
  const scope = h.page.querySelector('#catalog-scope'); scope.value = 'managed'; scope.dispatchEvent({ type: 'change', target: scope });
  assert.equal(h.view.catalogScope, 'managed'); assert.equal(h.view.catalogPage, 1); assert.ok(h.fetchCalls.some(call => call.url.includes('scope=managed')));
  assert.ok(h.page.querySelector('.catalog-results.is-loading')); assert.equal(h.page.querySelector('.catalog-results').getAttribute('aria-busy'), 'true');
  assert.ok(h.page.querySelector('[data-action="reset-catalog-filters"]'));
});
