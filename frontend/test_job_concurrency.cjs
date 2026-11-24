'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse the existing DOM fixture without running its tests or changing that file.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, normalizeJobs, localBusy, remoteBusy, anyJobActive, setOptimisticJob,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, makeIncoming, makeManaged } = vm.runInContext('({ createHarness, makeIncoming, makeManaged })', context);

function job(id, kind, status = 'running', result = {}) { return { id, kind, status, result }; }
function snapshot(h, local = null, remote = null, exclusive = null) {
  const jobs = { local, remote, exclusive };
  const activeJobs = Object.fromEntries(Object.entries(jobs).map(([lane, item]) => [lane, ['queued', 'running'].includes(item?.status) ? item : null]));
  return { timezone: 'Asia/Seoul', incoming: h.state.incoming, managed: h.state.managed, events: h.state.events, pendingXmp: [], scan: null, jobs, activeJobs, job: exclusive || local || remote };
}
function setJobs(h, local, remote, exclusive) {
  const snap = snapshot(h, local, remote, exclusive);
  Object.assign(h.state, snap, h.normalizeJobs(snap));
}
function ready() {
  const h = createHarness();
  h.view.connecting = false;
  h.state.incoming = [makeIncoming('i1'), makeIncoming('i2')];
  h.view.incomingSelection.add('i1');
  h.state.managed = [makeManaged('m1', { confirmed: true, canOffload: true, remotePaths: ['m1.mp4'] })];
  h.view.eventSelection.add('m1');
  h.view.eventId = 'all';
  h.view.settings = { hostKeyTrusted: true, keyGenerated: true, keyCopied: true };
  h.view.devices = [{ source: 'Sony', name: 'Sony' }];
  h.view.restoreFile = {};
  h.view.archive = { path: '', entries: [], connection: 'fixture' };
  h.view.sourceSelection.add('m1:primary');
  return h;
}
function route(h, hash) { h.win.location.hash = `#${hash}`; h.render(); }
function disabled(h, action) {
  const node = h.page.querySelector(`[data-action="${action}"]`);
  assert.ok(node, `missing ${action}`);
  return node.disabled;
}

test('remote upload leaves Incoming local actions enabled and locks remote/catalog settings', () => {
  const h = ready();
  setJobs(h, null, job(10, 'upload'));
  route(h, 'incoming');
  assert.equal(disabled(h, 'scan'), false);
  assert.equal(disabled(h, 'move-incoming'), false);
  assert.equal(disabled(h, 'delete-incoming'), false);
  route(h, 'events');
  assert.equal(disabled(h, 'offload-media'), true);
  assert.equal(disabled(h, 'edit-media'), false);
  route(h, 'archive');
  assert.equal(disabled(h, 'upload-archive'), true);
  assert.equal(disabled(h, 'open-remote-index'), true);
  route(h, 'settings');
  for (const action of ['reset-host-key', 'download-catalog', 'restore-catalog', 'reset-catalog']) assert.equal(disabled(h, action), true);
  assert.equal(h.page.querySelector('[name="name"]').disabled, true);
});

test('local scan/move leaves Archive and Events remote actions enabled', () => {
  const h = ready();
  for (const kind of ['scan', 'move']) {
    setJobs(h, job(11, kind), null);
    route(h, 'incoming');
    for (const action of ['scan', 'move-incoming', 'delete-incoming']) assert.equal(disabled(h, action), true);
    route(h, 'events');
    assert.equal(disabled(h, 'offload-media'), false);
    route(h, 'archive');
    assert.equal(disabled(h, 'upload-archive'), false);
    assert.equal(disabled(h, 'open-remote-index'), false);
    route(h, 'settings');
    assert.equal(disabled(h, 'reset-host-key'), false);
    for (const action of ['download-catalog', 'restore-catalog', 'reset-catalog']) assert.equal(disabled(h, action), true);
  }
});

test('duplicate cleanup is disabled during local jobs and remains enabled during remote upload', () => {
  const h = ready();
  h.state.incoming[0].status = 'duplicate';
  for (const kind of ['scan', 'move', 'duplicate-cleanup']) {
    setJobs(h, job(16, kind), null);
    route(h, 'incoming');
    assert.equal(disabled(h, 'cleanup-incoming'), true, kind);
  }
  setJobs(h, null, job(17, 'upload'));
  route(h, 'incoming');
  assert.equal(disabled(h, 'cleanup-incoming'), false);
});

test('exclusive reset and synchronous catalog barrier lock local, remote and settings actions', () => {
  const h = ready();
  for (const synchronous of [false, true]) {
    setJobs(h, null, null, synchronous ? null : job(20, 'reset-all'));
    h.view.catalogOpBusy = synchronous;
    route(h, 'incoming');
    for (const action of ['scan', 'move-incoming', 'delete-incoming']) assert.equal(disabled(h, action), true);
    route(h, 'events');
    for (const action of ['offload-media', 'edit-media', 'new-event']) assert.equal(disabled(h, action), true);
    route(h, 'archive');
    for (const action of ['upload-archive', 'open-remote-index']) assert.equal(disabled(h, action), true);
    route(h, 'settings');
    for (const action of ['reset-host-key', 'download-catalog', 'restore-catalog', 'reset-catalog']) assert.equal(disabled(h, action), true);
  }
});

test('simultaneous lanes show global banner, keep polling after local finishes and cancel the explicit remote ID', async () => {
  const h = ready();
  let snap;
  const cancelled = [];
  h.setFetch(async (url, options) => {
    if (url === '/api/state') return { ok: true, json: async () => snap };
    if (options.method === 'POST') { cancelled.push(url); return { ok: true, json: async () => job(10, 'upload', 'cancelled', { error: '중지했습니다.' }) }; }
    return new Promise(() => {});
  });
  setJobs(h, job(11, 'scan'), job(10, 'upload'));
  route(h, 'incoming');
  assert.equal(h.page.querySelectorAll('.active-job-pill').length, 2);
  assert.match(h.page.querySelector('.active-jobs-bar').textContent, /#11/);
  assert.match(h.page.querySelector('.active-jobs-bar').textContent, /#10/);
  let polls = 0;
  h.win.setTimeout = (_callback, ms) => { if (ms === 650) polls++; return 1; };
  snap = snapshot(h, job(11, 'scan', 'done', { checked: 2 }), job(10, 'upload'));
  await h.syncState();
  h.render();
  assert.equal(polls, 1);
  assert.equal(h.page.querySelectorAll('.active-job-pill').length, 1);
  const cancel = h.page.querySelector('[data-action="cancel-archive-upload"]');
  assert.equal(cancel.dataset.value, '10');
  snap = snapshot(h, job(11, 'scan', 'done', { checked: 2 }), job(10, 'upload', 'cancelled', {}));
  await h.actions['cancel-archive-upload'](cancel.dataset.value);
  assert.deepEqual(cancelled, ['/api/archive/transfers/10/cancel']);
  h.render();
  assert.equal(h.page.querySelector('.active-jobs-bar'), null);
});

test('Incoming preview delete tracks local #12 while remote #10 runs and updates its list/message', async () => {
  const h = ready();
  setJobs(h, null, job(10, 'upload'));
  route(h, 'incoming');
  h.openIncomingPreview('i1');
  h.requestPreviewDelete();
  assert.equal(h.view.preview.confirming, true);
  let snap = snapshot(h, job(12, 'delete'), job(10, 'upload'));
  h.setFetch(async (url) => ({ ok: true, json: async () => url === '/api/state' ? snap : { id: 12, lane: 'local' } }));
  await h.performPreviewDelete();
  assert.equal(h.view.preview.jobId, 12);
  assert.equal(h.view.preview.busy, true);
  snap = { ...snapshot(h, job(12, 'delete', 'done', { deleted: 1 }), job(10, 'upload')), incoming: [makeIncoming('i2')] };
  await h.syncState();
  assert.equal(h.view.preview.busy, false);
  assert.deepEqual([...h.view.preview.ids], ['i2']);
  assert.match(h.view.preview.message, /삭제했습니다/);
  assert.equal(h.remoteBusy(), true);
  assert.equal(h.localBusy(), false);
});
