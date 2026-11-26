'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;

let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, startStorageWake, reconcileWakeRequest, reconcileWakeArchive,
      adoptWakeSettings, browseArchive, resetArchiveConnection, storageWakeButton, storageWakeStatus,
      wakeFacts, loadWakePending, saveWakePending, jobMessage, wakeRequestId, maybeAutoConnectArchive, catalogTime, storageMonitor, wakeStep, deriveStorageViewModel,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context); vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', context);
const revision = 'a'.repeat(64);
const settings = (extra = {}) => ({ storageWake: { available: true, targetRevision: revision, timeoutSeconds: 180 }, ...extra });
const response = data => ({ ok: true, status: 200, json: async () => data });
const archive = marker => ({ root: '/NAS', path: '', entries: [], marker });
const job = (status = 'running', extra = {}) => ({ id: 41, kind: 'storage-wake', lane: 'remote', status,
  createdAt: '2026-11-26T01:00:00Z', result: { targetRevision: revision, requestedAt: '2026-11-26T01:00:00Z',
    phase: '서버 응답 대기 중', timeoutSeconds: 180, attemptState: 'unknown', archiveState: 'settings_required',
    serverState: 'unknown', ...extra } });
function route(h, name) { h.view.connecting = false; h.win.location.hash = `#${name}`; h.render(); }
function harness() {
  const h = createHarness(); h.context.crypto = crypto;
  const storage = new Map();
  h.context.sessionStorage = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  h.view.settings = settings();
  h.setFetch(async url => {
    if (url === '/api/settings') return response(h.view.settings);
    if (url === '/api/state') return response({ ...h.state });
    if (url.startsWith('/api/storage/wake?')) return response({ job: null });
    return response({});
  });
  return h;
}
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);

test('archive and settings use HA availability independently of SSH and local activity', () => {
  const h = harness();
  h.state.activeJobs.local = { id: 2, kind: 'scan', status: 'running', lane: 'local', result: {} };
  for (const page of ['archive', 'settings']) {
    route(h, page); assert.equal(action(h, 'start-storage-wake').disabled, false);
  }
  h.state.activeJobs.remote = { id: 3, kind: 'upload', status: 'running', lane: 'remote', result: {} };
  h.render(); assert.equal(action(h, 'start-storage-wake').disabled, true);
  h.state.activeJobs.remote = null; h.view.settings.storageWake.available = false;
  h.render(); assert.equal(action(h, 'start-storage-wake').disabled, true);
  assert.match(h.storageWakeStatus(), /설정 열기/);
});

test('active startup uses exact stop ID globally and history has non-file details', async () => {
  const h = harness(); const wake = job();
  h.state.latestStorageWake = wake; h.state.activeJobs.remote = wake; h.state.jobs.remote = wake;
  h.state.job = h.state.activeJobs.local = { id: 99, kind: 'scan', lane: 'local', status: 'running', result: {} };
  route(h, 'jobs');
  const card = h.page.querySelector('.job-card');
  assert.match(card.textContent, /OMV 시작 확인|서버 응답 대기/);
  assert.doesNotMatch(card.textContent, /0 \/ 0|가져왔|%/);
  assert.equal(card.querySelector('progress'), null);
  assert.match(card.textContent, /켜기 요청|서버 응답|아카이브 접근/);
  h.setFetch(async (url, options) => {
    if (url === '/api/storage/wake/41/cancel') return response({ job: { ...wake, result: { ...wake.result, cancelRequested: true } } });
    if (url === '/api/state') return response({ ...h.state });
    throw new Error(url);
  });
  await h.actions['cancel-storage-wake']('41');
  assert.ok(h.fetchCalls.some(c => c.url === '/api/storage/wake/41/cancel' && c.opts.method === 'POST'));
  assert.ok(!h.fetchCalls.some(c => c.url.includes('/99/cancel')));
});

test('immediate double click sends one POST and accepted request clears pending binding', async () => {
  const h = harness(); route(h, 'archive');
  let release; const gate = new Promise(resolve => { release = resolve; });
  const submitted = [];
  h.setFetch(async (url, options) => {
    if (url === '/api/settings') { await gate; return response(settings()); }
    if (url === '/api/storage/wake') {
      submitted.push(JSON.parse(options.body));
      return response({ id: 41, kind: 'storage-wake', lane: 'remote', status: 'queued', requestedAt: job().createdAt, targetRevision: revision });
    }
    if (url === '/api/state') return response({ ...h.state });
    throw new Error(url);
  });
  const first = h.startStorageWake(); const second = h.startStorageWake();
  assert.equal(action(h, 'start-storage-wake').disabled, true);
  release(); await Promise.all([first, second]);
  assert.equal(submitted.length, 1); assert.match(submitted[0].requestId, /^[0-9a-f-]{36}$/);
  assert.equal(h.view.wakePending, null);
});

test('lost response preserves UUID and reconciliation/navigation never automatically POST', async () => {
  const h = harness(); route(h, 'archive'); const bodies = [];
  h.setFetch(async (url, options) => {
    if (url === '/api/settings') return response(settings());
    if (url === '/api/storage/wake') { bodies.push(JSON.parse(options.body)); throw new Error('lost'); }
    if (url.startsWith('/api/storage/wake?')) return response({ job: null });
    if (url === '/api/state') return response({ ...h.state });
    return response({});
  });
  await h.startStorageWake();
  const request = h.view.wakePending;
  assert.ok(request); assert.equal(h.loadWakePending().requestId, request.requestId);
  await h.reconcileWakeRequest(); h.loadRoute(); await flushMicrotasks();
  assert.equal(bodies.length, 1); assert.match(h.storageWakeStatus(), /요청 결과 확인 중/);
  await h.startStorageWake();
  assert.equal(bodies.length, 2); assert.equal(bodies[0].requestId, bodies[1].requestId);
});

test('reload binds pending UUID through GET to terminal result even after lane superseded', async () => {
  const h = harness(); const pending = { requestId: crypto.randomUUID(), targetRevision: revision };
  h.saveWakePending(pending); h.view.wakePending = h.loadWakePending();
  const terminal = job('done', { outcome: 'server_responding_settings_required', serverState: 'ha_reported_on' });
  h.setFetch(async url => response({ job: terminal }));
  await h.reconcileWakeRequest();
  assert.equal(h.view.wakePending, null); assert.equal(h.state.latestStorageWake.id, 41);
  h.state.jobs.remote = { id: 42, kind: 'upload', status: 'done', result: {} };
  route(h, 'archive'); assert.match(h.page.textContent, /HA에서 응답 보고/);
  assert.equal(action(h, 'upload-archive').disabled, true);
  assert.ok(h.fetchCalls.filter(c => c.url.includes('/storage/wake')).every(c => c.opts.method === 'GET'));
});

test('terminal cold snapshot refreshes current archive once and never initiates uploads', async () => {
  const h = harness(); route(h, 'archive');
  h.state.latestStorageWake = job('done', { outcome: 'archive_ready', archiveState: 'ready' });
  h.setFetch(async url => response(url === '/api/settings' ? settings() : archive('fresh')));
  await h.reconcileWakeArchive(); await h.reconcileWakeArchive();
  assert.equal(h.view.archive.marker, 'fresh');
  assert.equal(h.fetchCalls.filter(c => c.url === '/api/archive?path=').length, 1);
  assert.ok(h.fetchCalls.every(c => !c.opts.method || c.opts.method === 'GET'));
});

test('wake refresh waits for an old browse and supersedes its result after settlement', async () => {
  const h = harness(); route(h, 'archive'); let release;
  let reads = 0;
  h.setFetch(async url => {
    if (url === '/api/settings') return response(settings());
    if (url.startsWith('/api/archive?')) {
      reads++;
      if (reads === 1) return new Promise(resolve => { release = () => resolve(response(archive('before'))); });
      return response(archive('after'));
    }
    throw new Error(url);
  });
  const before = h.browseArchive('old');
  h.state.latestStorageWake = job('done', { outcome: 'archive_ready', archiveState: 'ready' });
  await h.reconcileWakeArchive(); assert.equal(reads, 1);
  release(); await before;
  assert.equal(reads, 2); assert.equal(h.view.archive.marker, 'after');
});

test('changed target invalidates pending refresh and ignores late old browse', async () => {
  const h = harness(); route(h, 'archive'); let release;
  h.setFetch(async url => url === '/api/settings' ? response(settings()) : new Promise(resolve => { release = () => resolve(response(archive('old'))); }));
  const before = h.browseArchive('');
  h.state.latestStorageWake = job('done', { outcome: 'archive_ready', archiveState: 'ready' });
  await h.reconcileWakeArchive();
  const replacement = settings({ storageWake: { available: true, targetRevision: 'b'.repeat(64) } });
  h.adoptWakeSettings(replacement); h.setFetch(async () => response(replacement));
  release(); await before; await h.reconcileWakeArchive();
  assert.equal(h.view.archive, null);
  assert.equal(h.fetchCalls.filter(c => c.url.startsWith('/api/archive?')).length, 1);
});

test('completion while away defers GET browse until archive entry and checks settings again', async () => {
  const h = harness(); route(h, 'incoming');
  h.state.latestStorageWake = job('done', { outcome: 'archive_ready', archiveState: 'ready' });
  h.setFetch(async url => response(url === '/api/settings' ? settings() : archive('on-entry')));
  await h.reconcileWakeArchive();
  assert.equal(h.fetchCalls.filter(c => c.url.startsWith('/api/archive?')).length, 0);
  route(h, 'archive'); await h.reconcileWakeArchive({ fresh: true });
  assert.equal(h.view.archive.marker, 'on-entry');
});

test('catalog reset clears pending recovery and old wake; unavailable storage retains in-memory UUID', () => {
  const h = harness(); const value = { requestId: crypto.randomUUID(), targetRevision: revision };
  h.context.sessionStorage.setItem = () => { throw new Error('disabled'); };
  h.saveWakePending(value); assert.equal(h.view.wakePending, value);
  h.state.latestStorageWake = job(); h.clearCatalogViews();
  assert.equal(h.view.wakePending, null); assert.equal(h.state.latestStorageWake, null);
  assert.doesNotMatch(h.wakeFacts(job('done', { arbitrary: '<script>secret</script>' })), /secret/);
});

test('secure UUID fallback works on HTTP LAN without randomUUID', () => {
  const h = harness(); h.context.crypto = { getRandomValues: array => crypto.getRandomValues(array) };
  assert.match(h.wakeRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('settings discovery enables OMV button before the slow SSH browse settles', async () => {
  const h = harness(); h.view.settings = null; route(h, 'archive');
  let release;
  h.setFetch(async url => {
    if (url === '/api/settings') return response(settings({ addressConfigured:true, storageRootConfigured:true, accountConfigured:true, keyGenerated:true, hostKeyTrusted:true }));
    if (url.startsWith('/api/archive?')) return new Promise(resolve => { release = resolve; });
    return response({});
  });
  const pending = h.maybeAutoConnectArchive(); await flushMicrotasks();
  assert.equal(h.view.archiveBusy, true);
  assert.equal(action(h, 'start-storage-wake').disabled, false);
  release(response(archive('ready'))); await pending;
});

test('offline empty state has one connection action and wake error appears only in the inline banner', () => {
  const h = harness(); h.storageMonitor.snapshot = { status: 'no_response' };
  h.view.wakeError = '시작 요청 실패'; route(h, 'archive');
  assert.match(h.page.textContent, /꺼져 있거나 응답하지 않습니다/);
  assert.equal(h.page.querySelectorAll('[data-action="connect-archive"]').length, 1);
  const errors = h.page.querySelectorAll('[role="alert"]').filter(node => node.textContent.includes('시작 요청 실패'));
  assert.equal(errors.length, 1); assert.equal(errors[0].closest('#archive-wake-banner').id, 'archive-wake-banner');
});

test('wake history uses local catalog time and running inline stepper preserves the file tree', () => {
  const h = harness(); h.state.latestStorageWake = job('done', { outcome: 'archive_blocked' }); route(h, 'archive');
  assert.ok(h.storageWakeStatus().includes(h.catalogTime(job().createdAt)));
  assert.ok(!h.storageWakeStatus().includes(job().createdAt));
  h.state.latestStorageWake = h.state.activeJobs.remote = job(); h.render();
  const destination = h.page.querySelector('.archive-destination'); destination.scrollTop = 90;
  const trigger = h.page.querySelector('[data-action="storage-disclosure"]'); trigger.focus();
  h.state.latestStorageWake.result.phaseCode = 'waiting_mount'; h.render();
  assert.equal(h.page.querySelector('.archive-destination'), destination);
  assert.equal(destination.scrollTop, 90); assert.equal(h.doc.activeElement, trigger);
  assert.equal(h.page.querySelector('#archive-wake-banner ol').children.length, 3);
  const stop = h.page.querySelector('#archive-wake-banner [data-action="cancel-storage-wake"]');
  assert.equal(stop.dataset.value, '41'); assert.equal(stop.closest('#archive-storage-detail'), null);
  stop.focus(); h.state.latestStorageWake.result.phase = '마운트 준비를 기다리는 중'; h.render();
  assert.equal(h.doc.activeElement, stop);
  assert.equal(h.page.querySelector('#archive-wake-banner [data-action="cancel-storage-wake"]'), stop);
});

test('cold startup step and status stay on server startup until server evidence arrives', () => {
  for (const page of ['archive', 'settings']) {
    const h = harness();
    const wake = job('running', { attemptState: 'accepted', attemptCount: 1, phaseCode: 'checking_archive', serverState: 'unknown' });
    h.state.latestStorageWake = h.state.activeJobs.remote = wake;
    route(h, page);
    const steps = () => h.page.querySelectorAll('#archive-wake-banner li');
    const currentStep = () => steps().findIndex(node => node.getAttribute('aria-current') === 'step');
    const stop = h.page.querySelector('#archive-wake-banner [data-action="cancel-storage-wake"]'); stop.focus();
    for (const phaseCode of ['checking_archive', 'waiting_server', 'checking_archive', 'waiting_server']) {
      wake.result.phaseCode = phaseCode; h.render();
      assert.equal(currentStep(), 1, `${page}: ${phaseCode}`);
      assert.equal(steps()[1].classList.contains('complete'), false);
      assert.equal(h.deriveStorageViewModel().label, '켜는 중');
      assert.equal(h.doc.activeElement, stop);
    }
    wake.result.serverState = 'ha_reported_on'; wake.result.phaseCode = 'checking_archive'; h.render();
    assert.equal(currentStep(), 2); assert.equal(h.deriveStorageViewModel().label, '아카이브 확인 중');
    wake.result.phaseCode = 'waiting_server'; h.render(); assert.equal(currentStep(), 2);
    wake.result.serverState = 'unknown'; wake.result.phaseCode = 'waiting_mount'; h.render();
    assert.equal(currentStep(), 2); assert.equal(h.deriveStorageViewModel().label, '마운트 대기 중');
    assert.equal(h.wakeStep({ phaseCode: 'requesting', attemptState: 'intent', attemptCount: 1 }), 0);
    for (const attemptState of ['accepted', 'unknown', 'observing_existing', 'not_needed']) assert.equal(h.wakeStep({ attemptState }), 1);
    wake.status = 'done'; Object.assign(wake.result, { phaseCode: 'complete', outcome: 'archive_blocked', serverState: 'ssh_responding', archiveState: 'path_missing', review: 1 });
    h.render();
    assert.equal(h.wakeStep(wake.result), 2);
    assert.equal(steps()[0].classList.contains('complete'), true);
    assert.equal(steps()[1].classList.contains('complete'), true);
    assert.equal(steps()[2].classList.contains('complete'), false);
  }
});
