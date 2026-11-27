'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;

let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, confirmStorageShutdown, startStorageShutdown, cancelStorageShutdown,
      reconcileShutdownRequest, storageShutdownButton, shutdownFacts, storageMonitor, shutdownStep,
      saveShutdownPending, loadShutdownPending, deriveStorageViewModel, applyShutdownJob, startStorageWake,
      storageShutdownStatus, catalogTime,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context); vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', context);
const revision = 'a'.repeat(64);
const response = data => ({ ok: true, status: 200, json: async () => data });
const job = (status = 'running', extra = {}) => ({ id: 51, kind: 'storage-shutdown', lane: 'remote', status,
  createdAt: new Date().toISOString(), result: { phaseCode: 'checking_server', phase: '서버 상태 확인 중',
    requestedAt: new Date().toISOString(), timeoutSeconds: 180, attemptState: 'not_started', sshConfigured: true, ...extra } });
function harness() {
  const h = createHarness(); h.context.crypto = crypto;
  const storage = new Map();
  h.context.sessionStorage = { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  h.view.settings = { storageWake: { available: true, targetRevision: revision }, storageShutdown: { available: true, targetRevision: revision } };
  h.storageMonitor.snapshot = { status: 'running' }; h.storageMonitor.expiry = Infinity; h.storageMonitor.promise = null;
  h.setFetch(async url => {
    if (url === '/api/settings') return response(h.view.settings);
    if (url === '/api/state') return response({ ...h.state });
    return response({ job: null });
  });
  return h;
}
function route(h, page) { h.view.connecting = false; h.win.location.hash = `#${page}`; h.render(); }
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);

test('shutdown button full status matrix in archive and settings', () => {
  for (const page of ['archive', 'settings']) {
    const h = harness();
    for (const status of ['unconfigured', 'no_response', 'booting', 'loading', 'stale', 'unknown', 'running']) {
      h.storageMonitor.snapshot = { status }; route(h, page);
      assert.equal(action(h, 'confirm-storage-shutdown').disabled, status !== 'running', `${page}: ${status}`);
    }
    h.storageMonitor.snapshot = { status: 'unknown' }; h.view.archive = { root: '/NAS', entries: [] }; h.render();
    assert.equal(action(h, 'confirm-storage-shutdown').disabled, false);
    h.state.activeJobs.local = { id: 4, kind: 'scan', lane: 'local', status: 'running', result: {} }; h.render();
    assert.equal(action(h, 'confirm-storage-shutdown').disabled, false);
    h.view.shutdownPending = { requestId: crypto.randomUUID(), targetRevision: revision }; h.view.archive = null; h.render();
    assert.equal(action(h, 'confirm-storage-shutdown').disabled, false);
    assert.match(action(h, 'confirm-storage-shutdown').textContent, /같은 요청 다시 확인/);
    for (const kind of ['upload', 'offload', 'remote-index', 'thumbnails-remote', 'storage-wake']) {
      h.state.activeJobs.remote = { id: 8, kind, lane: 'remote', status: 'running', result: {} }; h.render();
      assert.equal(action(h, 'confirm-storage-shutdown').disabled, true);
    }
    h.state.activeJobs.remote = null; h.view.settings.storageShutdown.available = false; h.view.settings.storageShutdown.message = '종료 설정 필요'; h.render();
    assert.equal(action(h, 'confirm-storage-shutdown').disabled, true);
    assert.equal(action(h, 'confirm-storage-shutdown').getAttribute('title'), '종료 설정 필요');
  }
});

test('confirmation protects focus and warns about browsing, downloads and uncancellable scripts', async () => {
  const h = harness(); route(h, 'archive'); h.view.archiveBusy = true;
  h.confirmStorageShutdown();
  assert.equal(h.dialog.open, true);
  assert.match(h.dialog.textContent, /OMV 서버를 끄시겠습니까/);
  assert.match(h.dialog.textContent, /다운로드.*중단/);
  assert.match(h.dialog.textContent, /목록을 불러오는 중/);
  assert.match(h.dialog.textContent, /상태 확인만 중단/);
  assert.ok(h.dialog.querySelector('[data-action="close-dialog"][autofocus]'));
  assert.ok(h.dialog.querySelector('.button.primary.danger[type="submit"]'));
  assert.equal(h.fetchCalls.filter(c => c.opts.method === 'POST').length, 0);
  h.dialog.close();
  assert.equal(h.fetchCalls.filter(c => c.opts.method === 'POST').length, 0);
  h.confirmStorageShutdown();
  h.setFetch(async (url, opts) => url === '/api/storage/shutdown' ? response({ job: job('queued') }) : url === '/api/settings' ? response(h.view.settings) : response({ ...h.state }));
  h.dialog.querySelector('form').dispatchEvent({ type: 'submit', target: h.dialog.querySelector('form'), currentTarget: h.dialog.querySelector('form') });
  await flushMicrotasks();
  assert.equal(h.fetchCalls.filter(c => c.url === '/api/storage/shutdown' && c.opts.method === 'POST').length, 1);
});

test('three shutdown steps and amber tone preserve archive and focused stop through polls', () => {
  const h = harness(); const shutdown = job();
  h.state.latestStorageShutdown = h.state.activeJobs.remote = h.state.jobs.remote = shutdown;
  route(h, 'archive');
  const destination = h.page.querySelector('.archive-destination'); destination.scrollTop = 100;
  const stop = h.page.querySelector('#archive-wake-banner [data-action="cancel-storage-shutdown"]'); stop.focus();
  const states = [ ['checking_server', 'not_started', 'reachable', 0], ['waiting_shutdown', 'accepted', 'reachable', 1], ['waiting_power_off', 'accepted', 'unreachable', 2] ];
  for (const [phaseCode, attemptState, sshState, expected] of states) {
    Object.assign(shutdown.result, { phaseCode, attemptState, sshState }); h.render();
    const steps = h.page.querySelectorAll('#archive-wake-banner li');
    assert.equal(steps.length, 3);
    assert.equal(steps.findIndex(el => el.getAttribute('aria-current') === 'step'), expected);
    assert.equal(h.deriveStorageViewModel().tone, 'shutting_down');
    assert.equal(h.page.querySelector('.archive-destination'), destination);
    assert.equal(destination.scrollTop, 100); assert.equal(h.doc.activeElement, stop);
  }
  shutdown.result.cancelRequested = true; h.render(); assert.equal(stop.disabled, true);
  route(h, 'settings');
  const input = h.page.querySelector('input'); input.value = 'draft'; input.focus();
  shutdown.result.phase = '전원 대기'; h.render();
  assert.equal(h.page.querySelector('input'), input); assert.equal(input.value, 'draft'); assert.equal(h.doc.activeElement, input);
});

test('lost POST response keeps UUID and manual retry uses same binding, reload GET recovers', async () => {
  const h = harness(); route(h, 'archive'); const bodies = [];
  h.setFetch(async (url, opts) => {
    if (url === '/api/settings') return response(h.view.settings);
    if (url === '/api/state') return response({ ...h.state });
    if (url === '/api/storage/shutdown') { bodies.push(JSON.parse(opts.body)); throw new Error('lost'); }
    return response({ job: null });
  });
  await h.startStorageShutdown();
  const pending = h.loadShutdownPending(); assert.ok(pending);
  assert.equal(h.context.sessionStorage.getItem('photoSaver.storageShutdownPending') !== null, true);
  await h.reconcileShutdownRequest(); assert.equal(bodies.length, 1);
  await h.startStorageShutdown(); assert.equal(bodies.length, 2); assert.equal(bodies[0].requestId, bodies[1].requestId);
  h.setFetch(async () => response({ job: job() })); await h.reconcileShutdownRequest();
  assert.equal(h.state.latestStorageShutdown.id, 51); assert.equal(h.view.shutdownPending, null);
});

test('double submission guard sends only one request', async () => {
  const h = harness(); route(h, 'archive'); let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.setFetch(async url => {
    if (url === '/api/settings') { await gate; return response(h.view.settings); }
    if (url === '/api/storage/shutdown') return response({ job: job('queued') });
    return response({ ...h.state });
  });
  const first = h.startStorageShutdown(), second = h.startStorageShutdown();
  release(); await Promise.all([first, second]);
  assert.equal(h.fetchCalls.filter(c => c.url === '/api/storage/shutdown' && c.opts.method === 'POST').length, 1);
});

test('shutdown terminal polling resets archive and forces fresh storage status', async () => {
  for (const outcome of ['powered_off', 'already_off', 'ssh_stopped_ha_unconfirmed', 'shutdown_timeout']) {
    const h = harness(); route(h, 'archive');
    h.view.archive = { root: '/NAS', entries: [] }; h.view.archivePath = 'old'; h.view.sourceSelection.add('old');
    const active = job(); h.state.latestStorageShutdown = h.state.activeJobs.remote = h.state.jobs.remote = active;
    const terminal = job(outcome === 'shutdown_timeout' ? 'failed' : 'done', { outcome });
    h.setFetch(async url => url === '/api/state' ? response({ ...h.state, latestStorageShutdown: terminal, activeJobs: { local: null, remote: null, exclusive: null }, jobs: { local: null, remote: terminal, exclusive: null }, job: terminal }) : response({}));
    await h.syncState();
    await flushMicrotasks();
    assert.equal(h.view.archive === null, outcome !== 'shutdown_timeout');
    if (outcome !== 'shutdown_timeout') { assert.equal(h.view.archivePath, ''); assert.equal(h.view.sourceSelection.size, 0); }
    assert.ok(h.fetchCalls.some(c => c.url === '/api/storage/status?refresh=true'));
  }
});

test('shutdown job cards contain power facts and status link without unsafe retry', async () => {
  const h = harness(); const shutdown = job(); h.state.latestStorageShutdown = h.state.activeJobs.remote = h.state.jobs.remote = shutdown;
  route(h, 'jobs');
  const card = h.page.querySelector('.job-card');
  assert.match(card.textContent, /OMV 종료 확인/); assert.match(card.textContent, /종료 요청|HA 전원 센서|SSH 응답/);
  assert.equal(card.querySelector('progress'), null); assert.doesNotMatch(card.textContent, /0 \/ 0|다시 시도/);
  h.setFetch(async url => url.endsWith('/cancel') ? response({ job: job('running', { cancelRequested: true }) }) : response({ ...h.state }));
  await h.cancelStorageShutdown('51');
  assert.ok(h.fetchCalls.some(c => c.url === '/api/storage/shutdown/51/cancel' && c.opts.method === 'POST'));
  h.state.activeJobs.remote = null; h.state.latestStorageShutdown = h.state.jobs.remote = h.state.job = job('done', { outcome: 'ssh_stopped_ha_unconfirmed', review: 1 }); h.render();
  assert.match(h.page.textContent, /아카이브에서 상태 확인/);
  assert.doesNotMatch(h.shutdownFacts(job('done', { arbitrary: '<script>secret</script>' })), /secret/);
});

test('catalog reset clears shutdown pending recovery, errors and old history', () => {
  const h = harness(); h.saveShutdownPending({ requestId: crypto.randomUUID(), targetRevision: revision });
  h.state.latestStorageShutdown = job(); h.view.shutdownError = 'error'; h.clearCatalogViews();
  assert.equal(h.view.shutdownPending, null); assert.equal(h.loadShutdownPending(), null);
  assert.equal(h.state.latestStorageShutdown, null); assert.equal(h.view.shutdownError, '');
});

test('partial shutdown warning remains visible after polling and completion clears selection', () => {
  const h = harness();
  h.state.latestStorageShutdown = job('done', { outcome: 'ssh_stopped_ha_unconfirmed', review: 1, message: 'SSH 응답 중단, HA 미확인 · 서버 상태를 직접 확인하세요.' });
  h.view.sourceSelection.add('existing-local-file');
  h.applyShutdownJob(h.state.latestStorageShutdown);
  assert.equal(h.view.sourceSelection.size, 0);
  route(h, 'archive'); h.render();
  assert.match(h.page.querySelector('#archive-wake-banner').textContent, /서버 상태를 직접 확인/);
  assert.equal(h.page.querySelector('#archive-wake-banner [data-action="confirm-storage-shutdown"]'), null);
});

test('terminal shutdown banner shows a fixed catalog timestamp through later polls', () => {
  for (const status of ['failed', 'cancelled', 'done']) {
    const h = harness();
    const terminal = job(status, { outcome: status === 'done' ? 'ssh_stopped_ha_unconfirmed' : status, review: 1 });
    terminal.createdAt = '2026-11-27T02:00:00Z';
    terminal.result.requestedAt = terminal.createdAt;
    h.state.latestStorageShutdown = terminal; route(h, 'archive');
    const time = h.page.querySelector('#archive-wake-banner [data-wake-elapsed]');
    assert.equal(time.textContent, h.catalogTime(terminal.createdAt));
    assert.doesNotMatch(time.textContent, /경과/);
    vm.runInContext('Date.now = () => 1999999999999', h.context);
    h.render(); h.render();
    assert.equal(h.page.querySelector('#archive-wake-banner [data-wake-elapsed]'), time);
    assert.equal(time.textContent, h.catalogTime(terminal.createdAt));
  }
});

test('active wake takes banner priority over older shutdown error and pending request', () => {
  for (const pending of [false, true]) {
    const h = harness();
    h.view.shutdownError = '이전 종료 요청 실패';
    if (pending) h.saveShutdownPending({ requestId: crypto.randomUUID(), targetRevision: revision });
    const wake = { ...job(), id: 52, kind: 'storage-wake', result: { phaseCode: 'waiting_server', phase: '서버 응답 대기 중', attemptState: 'accepted' } };
    h.state.latestStorageWake = h.state.activeJobs.remote = h.state.jobs.remote = wake;
    route(h, 'archive');
    const banner = h.page.querySelector('#archive-wake-banner');
    assert.ok(banner.querySelector('[data-action="cancel-storage-wake"]'));
    assert.equal(banner.querySelector('.is-shutdown'), null);
    assert.doesNotMatch(banner.textContent, /이전 종료 요청 실패/);
  }
});

test('successful shutdown hides older failed wake attention until a new wake request', () => {
  const h = harness();
  h.state.latestStorageWake = { ...job('failed'), id: 40, kind: 'storage-wake', result: { outcome: 'startup_timeout', message: '과거 켜기 실패', review: 1 } };
  h.state.latestStorageShutdown = job('done', { outcome: 'powered_off', review: 0 });
  route(h, 'archive'); h.render();
  assert.equal(h.page.querySelector('#archive-wake-banner').textContent, '');
  h.view.wakeError = '새 켜기 요청 오류'; h.render();
  assert.match(h.page.querySelector('#archive-wake-banner').textContent, /새 켜기 요청 오류/);
  h.state.latestStorageShutdown = job('done', { outcome: 'ssh_stopped_ha_unconfirmed', review: 1 }); h.render();
  assert.match(h.page.querySelector('#archive-wake-banner').textContent, /새 켜기 요청 오류/);
});

test('starting either power operation clears the other operation error', async () => {
  const wakeHarness = harness(); route(wakeHarness, 'archive'); wakeHarness.view.shutdownError = '과거 종료 오류';
  wakeHarness.setFetch(async url => url === '/api/settings' ? response(wakeHarness.view.settings) : url === '/api/storage/wake'
    ? response({ id: 52, kind: 'storage-wake', lane: 'remote', status: 'queued' }) : response({ ...wakeHarness.state }));
  await wakeHarness.startStorageWake();
  assert.equal(wakeHarness.view.shutdownError, '');
  const shutdownHarness = harness(); route(shutdownHarness, 'archive'); shutdownHarness.view.wakeError = '과거 켜기 오류';
  shutdownHarness.setFetch(async url => url === '/api/settings' ? response(shutdownHarness.view.settings) : url === '/api/storage/shutdown'
    ? response({ job: job('queued') }) : response({ ...shutdownHarness.state }));
  await shutdownHarness.startStorageShutdown();
  assert.equal(shutdownHarness.view.wakeError, '');
});

test('shutdown history links to archive only in settings', () => {
  const h = harness(); h.state.latestStorageShutdown = job('done', { outcome: 'powered_off' });
  assert.doesNotMatch(h.storageShutdownStatus(), /href="#archive"/);
  assert.match(h.storageShutdownStatus(true), /href="#archive"/);
  route(h, 'archive');
  assert.equal(h.page.querySelector('[data-storage-history] a[href="#archive"]'), null);
  route(h, 'settings');
  assert.ok(h.page.querySelector('[data-storage-history] a[href="#archive"]'));
});
