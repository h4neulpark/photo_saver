'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, normalizeStorageStatus, storageMonitor, storageCurrent, storageLabel, deriveStorageViewModel, requestStorageStatus, resumeStorageStatus, patchStorageStatus, actions,');
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
fixture = fixture.replace("'media-preview', 'notice'", "'media-preview', 'notice', 'storage-summary'");
fixture = fixture.replace('    querySelectorAll(sel)', '    querySelector(sel) { return this.body.querySelector(sel); },\n    querySelectorAll(sel)');
const scope = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(scope); vm.runInContext(fixture, scope);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', scope);
const response = data => ({ ok: true, json: async () => data });
const snapshot = (extra = {}) => ({ status: 'running', reasonCode: null, rawState: 'on', sourceRevision: 'source-one',
  cached: false, checkedAt: '2026-11-26T00:00:00Z', reportedAtSource: 'last_reported', lastKnown: null, freshForSeconds: 80, nextPollInSeconds: 15, refreshAvailableInSeconds: 0, fetchedAt: '2026-11-26T00:00:00Z', reportedAt: '2026-11-26T00:00:00Z', ...extra });
async function harness() {
  const h = createHarness(url => url.startsWith('/api/storage/status') ? Promise.resolve(response(snapshot())) : new Promise(() => {}));
  await h.storageMonitor.promise;
  h.time = 10000;
  h.context.performance = { now: () => h.time };
  h.timers = new Map(); let serial = 100;
  h.context.setTimeout = (fn, delay) => { h.timers.set(++serial, { fn, delay }); return serial; };
  h.context.clearTimeout = id => h.timers.delete(id);
  h.storageMonitor.expiry = h.time + 80000;
  h.storageMonitor.cooldown = 0;
  h.view.connecting = false; h.win.location.hash = '#archive'; h.render();
  return h;
}
test('cold lookup starts without wake history; mounts and job render do not fetch', async () => {
  const h = await harness();
  assert.equal(h.fetchCalls.filter(c => c.url.startsWith('/api/storage/status')).length, 1);
  assert.equal(h.state.latestStorageWake, null);
  h.render(); h.win.location.hash = '#settings'; h.render();
  assert.equal(h.fetchCalls.filter(c => c.url.startsWith('/api/storage/status')).length, 1);
  assert.equal(h.page.querySelector('[data-storage-label]').textContent, '작동 중');
  assert.ok(h.fetchCalls.every(c => !c.opts.method || c.opts.method === 'GET'));
});
test('scoped patches preserve disclosure, focused refresh, folder and preview nodes', async () => {
  const h = await harness(); h.actions['storage-disclosure']();
  const trigger = h.page.querySelector('[data-action="storage-disclosure"]');
  const refresh = h.page.querySelector('[data-action="refresh-storage-status"]');
  const folder = h.page.querySelector('.archive-destination');
  const preview = h.page.querySelector('#archive-preview-slot');
  refresh.focus(); h.storageMonitor.snapshot = snapshot({ status: 'unknown', reasonCode: 'ha_unreachable' }); h.patchStorageStatus();
  assert.equal(h.doc.activeElement, refresh);
  assert.equal(h.page.querySelector('[data-action="storage-disclosure"]'), trigger);
  assert.equal(h.page.querySelector('.archive-destination'), folder);
  assert.equal(h.page.querySelector('#archive-preview-slot'), preview);
  assert.equal(h.page.querySelector('#archive-storage-detail').hidden, false);
  h.render(); assert.equal(h.page.querySelector('#archive-storage-detail').hidden, false);
  assert.equal(h.doc.activeElement.dataset.action, 'refresh-storage-status');
});
test('single-flight manual requests use GET; error removes current green and cooldown blocks forces', async () => {
  const h = await harness(); let release;
  h.setFetch(() => new Promise(resolve => { release = resolve; }));
  const a = h.requestStorageStatus(true), b = h.requestStorageStatus(true);
  assert.equal(a, b);
  release(response({})); await a;
  assert.equal(h.storageCurrent().status, 'unknown');
  const count = h.fetchCalls.length; await h.requestStorageStatus(true);
  assert.equal(h.fetchCalls.length, count);
  assert.ok(h.fetchCalls.every(c => !c.opts.method || c.opts.method === 'GET'));
});
test('local monotonic expiry applies while request hangs and hidden resume deduplicates', async () => {
  const h = await harness(); h.setFetch(() => new Promise(() => {}));
  h.storageMonitor.expiry = h.time + 100;
  const p = h.requestStorageStatus(); h.time += 101; h.patchStorageStatus();
  assert.equal(h.storageCurrent().status, 'stale');
  h.doc.hidden = true; h.resumeStorageStatus(); assert.equal(h.timers.has(h.storageMonitor.timer), false);
  const count = h.fetchCalls.length;
  h.doc.hidden = false; h.resumeStorageStatus(); h.resumeStorageStatus();
  assert.equal(h.fetchCalls.length, count); assert.equal(h.storageMonitor.promise, p);
});
test('timeout settles store; late response cannot replace newer source', async () => {
  const h = await harness(); let release;
  h.setFetch(() => new Promise(resolve => { release = resolve; }));
  const pending = h.requestStorageStatus();
  [...h.timers.values()].find(t => t.delay === 6500).fn(); await pending;
  assert.equal(h.storageCurrent().status, 'unknown');
  h.time += 6000;
  h.setFetch(async () => response(snapshot({ sourceRevision: 'new-source', status: 'no_response', rawState: 'off' })));
  await h.requestStorageStatus(true);
  release(response(snapshot())); await flushMicrotasks();
  assert.equal(h.storageMonitor.snapshot.sourceRevision, 'new-source');
  assert.equal(h.storageCurrent().status, 'no_response');
});
test('exact stop remains outside closed details and historical wake cannot supply live status', async () => {
  const h = await harness();
  const job = { id: 41, kind: 'storage-wake', lane: 'remote', status: 'running', result: {} };
  h.state.latestStorageWake = h.state.activeJobs.remote = job;
  h.storageMonitor.snapshot = snapshot({ status: 'unknown', reasonCode: 'ha_unreachable' }); h.render();
  const stop = h.page.querySelector('.archive-destination [data-action="cancel-storage-wake"]');
  assert.equal(stop.dataset.value, '41');
  assert.equal(stop.closest('#archive-storage-detail'), null);
  assert.equal(h.page.querySelector('#archive-storage-detail').hidden, true);
  job.status = 'done'; job.result.archiveState = 'ready'; h.render();
  assert.equal(h.storageCurrent().status, 'unknown');
  assert.match(h.page.querySelector('#archive-storage-detail').textContent, /이전 작업 기록/);
});
test('meaningful state announcements occur once, pause hidden, and report changed state on return', async () => {
  const h = await harness(); let changes = 0, text = '';
  const live = { get textContent() { return text; }, set textContent(value) { text = value; ++changes; } };
  h.doc.querySelector = selector => selector === '#storage-announcement' ? live : null;
  h.storageMonitor.announced = ''; h.patchStorageStatus(); h.patchStorageStatus();
  assert.equal(changes, 1);
  h.storageMonitor.snapshot = snapshot({ fetchedAt: '2026-11-26T00:00:15Z' }); h.patchStorageStatus();
  assert.equal(changes, 1);
  h.doc.hidden = true; h.storageMonitor.snapshot = snapshot({ status: 'no_response' }); h.patchStorageStatus();
  assert.equal(changes, 1);
  h.doc.hidden = false; h.patchStorageStatus(); h.patchStorageStatus();
  assert.equal(changes, 2); assert.match(text, /응답 없음/);
});

test('summary reveal happens after route scroll reset and ordinary navigation still resets', async () => {
  const h = await harness(); const events = [];
  h.win.scrollTo = () => events.push('reset');
  h.win.location.hash = '#settings'; h.render(); events.length = 0;
  h.storageMonitor.open = true; h.storageMonitor.reveal = true;
  const original = h.page.querySelector.bind(h.page);
  h.page.querySelector = selector => {
    const node = original(selector);
    if (selector === '[data-action="storage-disclosure"]' && node) {
      node.focus = () => events.push('focus'); node.scrollIntoView = () => events.push('reveal');
    }
    return node;
  };
  h.win.location.hash = '#archive'; h.render();
  assert.deepEqual(events, ['reset', 'focus', 'reveal']);
  events.length = 0; h.win.location.hash = '#settings'; h.render();
  assert.deepEqual(events, ['reset']);
});
test('malformed live contract table rejects missing, inconsistent, unsafe and impossible fields', async () => {
  const h = await harness();
  const invalid = [
    ...Object.keys(snapshot()).map(key => { const v = snapshot(); delete v[key]; return v; }),
    ...[{ reasonCode: '<unsafe>' }, { reportedAt: '2026-02-30T00:00:00Z' },
      { reportedAt: '2026-11-26T00:00:00' }, { fetchedAt: 123 }, { reportedAtSource: 'last_changed' },
      { freshForSeconds: Infinity }, { freshForSeconds: -1 }, { nextPollInSeconds: 100 },
      { refreshAvailableInSeconds: 6 }, { sourceRevision: '<unsafe>' }, { cached: 'false' },
      { lastKnown: { rawState: 'on' } }].map(extra => snapshot(extra))
  ];
  for (const value of invalid) assert.throws(() => h.normalizeStorageStatus(value), JSON.stringify(value));
  h.storageMonitor.snapshot = { status: 'loading' };
  h.setFetch(async () => response({ status: 'running', sourceRevision: 'probe', freshForSeconds: 80, nextPollInSeconds: 15, refreshAvailableInSeconds: 0 }));
  await h.requestStorageStatus();
  assert.equal(h.storageCurrent().status, 'unknown');
  assert.equal(h.storageCurrent().reasonCode, 'api_unreachable');
  assert.equal(h.storageCurrent().lastKnown, undefined);
});
test('valid on/off, cached fallback, diagnostic stale, unknown and nullable errors normalize', async () => {
  const h = await harness();
  const history = { rawState: 'off', reportedAt: snapshot().reportedAt, fetchedAt: snapshot().fetchedAt };
  const empty = { rawState: null, reportedAt: null, reportedAtSource: null, freshForSeconds: 0 };
  const cases = [snapshot(), snapshot({ status: 'no_response', rawState: 'off' }),
    snapshot({ cached: true, reportedAtSource: 'last_updated', lastKnown: history }),
    ...['report_stale', 'report_time_future', 'report_time_invalid'].map(reasonCode => snapshot({ status: 'stale', reasonCode, freshForSeconds: 0, ...(reasonCode === 'report_time_invalid' ? { reportedAt: null, reportedAtSource: null } : {}) })),
    snapshot({ status: 'unknown', reasonCode: 'sensor_unknown', rawState: 'unknown', freshForSeconds: 0, reportedAt: null, reportedAtSource: null }),
    ...['ha_unreachable', 'ha_config_invalid', 'status_busy', 'config_changed'].map(reasonCode => snapshot({ ...empty, status: 'unknown', reasonCode, fetchedAt: null, lastKnown: history, nextPollInSeconds: 30 })),
    snapshot({ ...empty, status: 'unconfigured', reasonCode: 'ha_not_configured', fetchedAt: null })];
  for (const value of cases) {
    const normalized = h.normalizeStorageStatus({ ...value, secret: 'discard' });
    assert.equal(normalized.status, value.status); assert.equal(normalized.secret, undefined);
    assert.equal(normalized.reportedAt, value.reportedAt);
  }
});

test('freshness subtracts full RTT on monotonic clock and valid failure history survives', async () => {
  const h = await harness(); let release;
  h.setFetch(() => new Promise(resolve => { release = resolve; }));
  const request = h.requestStorageStatus(); h.time += 2000;
  release(response(snapshot({ freshForSeconds: 3 }))); await request;
  assert.equal(h.storageMonitor.expiry, h.time + 1000);
  h.time += 1001; assert.equal(h.storageCurrent().status, 'stale');
  h.setFetch(async () => response({})); await h.requestStorageStatus();
  assert.equal(h.storageCurrent().status, 'unknown');
  assert.equal(h.storageCurrent().lastKnown.rawState, 'on');
  assert.equal(h.storageCurrent().lastKnown.reportedAt, snapshot().reportedAt);
});


test('same-route summary consumes reveal and the next job poll preserves chosen focus', async () => {
  const h = await harness();
  const job = { id: 41, kind: 'storage-wake', lane: 'remote', status: 'running', result: {} };
  h.setFetch(async () => response({ incoming: [], managed: [], events: [], pendingXmp: [],
    jobs: { remote: job }, activeJobs: { remote: job }, latestStorageWake: job }));
  h.win.setTimeout = h.context.setTimeout; h.win.clearTimeout = h.context.clearTimeout;
  await h.syncState(); h.render();
  h.doc.querySelector('#storage-summary').dispatchEvent({ type: 'click' });
  assert.equal(h.storageMonitor.open, true);
  assert.equal(h.storageMonitor.reveal, false);
  assert.equal(h.doc.activeElement.dataset.action, 'storage-disclosure');
  assert.equal(h.page.querySelector('#archive-storage-detail').hidden, false);
  h.page.querySelector('[data-action="refresh-storage-status"]').focus();
  const poll = [...h.timers.values()].find(timer => timer.delay === 650);
  const tree = h.page.querySelector('.archive-destination');
  const refresh = h.doc.activeElement;
  tree.scrollTop = 123;
  assert.ok(poll, 'active job schedules the ordinary 650ms poll');
  await poll.fn();
  assert.equal(h.storageMonitor.reveal, false);
  assert.equal(h.doc.activeElement.dataset.action, 'refresh-storage-status');
  assert.equal(h.doc.activeElement, refresh);
  assert.equal(h.page.querySelector('.archive-destination'), tree);
  assert.equal(tree.scrollTop, 123);
});

test('two layer normalization preserves booting, nullable freshness and future safe diagnostics', async () => {
  const h = await harness();
  const value = snapshot({ status: 'booting', reasonCode: 'ssh_unreachable', freshForSeconds: null,
    changedAt: snapshot().reportedAt,
    ha: { configured: true, status: 'on', reasonCode: null, reportedAt: snapshot().reportedAt, changedAt: snapshot().reportedAt },
    ssh: { configured: true, status: 'unreachable', latencyMs: null } });
  const p = h.normalizeStorageStatus(value);
  assert.equal(p.changedAt, value.changedAt); assert.equal(p.ha.status, 'on'); assert.equal(p.ssh.status, 'unreachable');
  h.setFetch(async () => response({ ...value, status: 'running', reasonCode: 'new_diagnostic_42' }));
  await h.requestStorageStatus();
  assert.equal(h.storageMonitor.expiry, Infinity);
  assert.equal(h.storageMonitor.snapshot.reasonCode, 'new_diagnostic_42');
  assert.doesNotMatch(h.page.textContent, /api_unreachable/);
});

test('unified view gives active wake then connected archive priority over monitoring failures', async () => {
  const h = await harness();
  h.storageMonitor.snapshot = snapshot({ status: 'unknown', reasonCode: 'ha_dns_error' });
  h.view.archive = { root: '/NAS', path: '', entries: [] };
  assert.equal(h.deriveStorageViewModel().tone, 'connected');
  h.state.latestStorageWake = { id: 1, kind: 'storage-wake', status: 'running', result: { phaseCode: 'waiting_mount' } };
  assert.equal(h.deriveStorageViewModel().label, '마운트 대기 중');
  h.state.latestStorageWake.status = 'done';
  assert.equal(h.deriveStorageViewModel().label, '연결됨');
  h.view.archive = null;
  h.storageMonitor.snapshot = snapshot({ status: 'booting' });
  assert.equal(h.deriveStorageViewModel().label, '부팅 중 · SSH 대기');
  h.storageMonitor.snapshot = snapshot({ ssh: { status: 'reachable' } });
  assert.equal(h.deriveStorageViewModel().label, '작동 중 · 연결 가능');
});

test('server poll recommendations 1 5 15 30 60 are respected and short focus does not fetch', async () => {
  const h = await harness();
  for (const seconds of [1,5,15,30,60]) {
    h.setFetch(async () => response(snapshot({ freshForSeconds: null, nextPollInSeconds: seconds })));
    await h.requestStorageStatus();
    assert.equal(h.storageMonitor.nextPoll, h.time+seconds*1000);
  }
  let count = h.fetchCalls.length;
  h.time += 1000; h.resumeStorageStatus(); h.resumeStorageStatus();
  assert.equal(h.fetchCalls.length, count);
  h.doc.hidden = true; h.resumeStorageStatus(); h.time += 9999;
  h.doc.hidden = false; h.resumeStorageStatus();
  assert.equal(h.fetchCalls.length, count);
  h.doc.hidden = true; h.resumeStorageStatus(); h.time += 10000;
  h.doc.hidden = false; h.resumeStorageStatus(); await h.storageMonitor.promise;
  assert.equal(h.fetchCalls.length, count+1);
});

test('manual refresh queued during automatic poll gets one fresh read after cooldown', async () => {
  const h = await harness(); let release; let reads = 0;
  h.setFetch(async () => {
    if (++reads === 1) return new Promise(resolve => { release = resolve; });
    return response(snapshot({ freshForSeconds: null }));
  });
  const pending = h.requestStorageStatus();
  h.requestStorageStatus(true); h.requestStorageStatus(true);
  release(response(snapshot({ refreshAvailableInSeconds: 2 })));
  await pending;
  assert.equal(reads, 1); assert.equal(h.storageMonitor.pendingManualRefresh, true);
  h.time += 2000;
  [...h.timers.values()].find(timer => timer.delay === 2000).fn();
  await h.storageMonitor.promise;
  assert.equal(reads, 2);
  assert.equal(h.fetchCalls.at(-1).url, '/api/storage/status?refresh=true');
});

test('wake terminal transition immediately refreshes monitor and settings DOM survives polls', async () => {
  const h = await harness();
  const job = { id: 41, kind: 'storage-wake', lane: 'remote', status: 'running', result: {} };
  h.state.latestStorageWake = h.state.jobs.remote = h.state.activeJobs.remote = job;
  h.win.location.hash = '#settings'; h.render();
  const card = h.page.querySelector('.storage-settings-card');
  const refresh = h.page.querySelector('[data-action="refresh-storage-status"]'); refresh.focus();
  h.render(); assert.equal(h.page.querySelector('.storage-settings-card'), card);
  assert.equal(h.doc.activeElement, refresh);
  h.setFetch(async url => response(url.startsWith('/api/storage/status') ? snapshot() : {
    ...h.state, jobs: { remote: { ...job, status: 'done' } }, activeJobs: { remote: null }, latestStorageWake: { ...job, status: 'done' } }));
  await h.syncState(); await h.storageMonitor.promise;
  assert.ok(h.fetchCalls.some(c => c.url === '/api/storage/status?refresh=true'));
});

test('API failures preserve valid HA history for SSH-only or degraded-HA running states', async () => {
  for (const [rawState, haStatus, reasonCode] of [[null, 'unconfigured', 'ha_not_configured'], [null, 'error', 'ha_dns_error'], ['unknown', 'unknown', 'sensor_unknown']]) {
    for (const history of [null, { rawState: 'on', reportedAt: snapshot().reportedAt, fetchedAt: snapshot().fetchedAt }]) {
      const h = await harness();
      const previous = snapshot({ status: 'running', rawState, reasonCode,
        reportedAt: null, reportedAtSource: null, freshForSeconds: null, lastKnown: history,
        ha: { configured: haStatus !== 'unconfigured', status: haStatus, reasonCode, reportedAt: null, changedAt: null },
        ssh: { configured: true, status: 'reachable', latencyMs: 2 } });
      h.setFetch(async () => response(previous)); await h.requestStorageStatus();
      const retained = h.storageMonitor.snapshot.lastKnown;
      h.setFetch(async () => { throw new Error('temporary API failure'); }); await h.requestStorageStatus();
      assert.equal(h.storageMonitor.snapshot.reasonCode, 'api_unreachable');
      assert.equal(h.storageMonitor.snapshot.lastKnown, retained);
      if (!history) assert.doesNotMatch(h.page.querySelector('[data-storage-diagnostics]').textContent, /마지막 확인:/);
      else assert.equal(h.storageMonitor.snapshot.lastKnown.rawState, 'on');
    }
  }
});
