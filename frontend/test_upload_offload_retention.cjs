'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, sourceEntries, sourceOffloadFiles, eventLifecycleSummary,
      storageStructureKey, patchStorageStatus, matchesEventLifecycle, clearCatalogViews, syncSourceSelection,
      requestArchiveUpload, startArchiveUpload, confirmDuplicateUpload, retentionBanner, storageMonitor,
      sourceArchiveBadge, eventFileStatus,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
fixture = fixture.replace('class FakeElement {', `class FakeElement {
  insertBefore(node, reference) { this.appendChild(node); this.children.splice(this.children.indexOf(node), 1); this.children.splice(this.children.indexOf(reference), 0, node); return node; }
`);
fixture = fixture.replace('  showModal() {\n    this.open = true;', `  showModal() {
    if (this.open) { const error = new Error('Dialog is already open'); error.name = 'InvalidStateError'; throw error; }
    this.open = true;`);
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context); vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeManaged } = vm.runInContext('({ createHarness, flushMicrotasks, makeManaged })', context);
const plain = value => JSON.parse(JSON.stringify(value));
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);
const response = data => ({ ok: true, status: 200, json: async () => data });
const event = { id: 'ev1', name: '여행', folder: '여행', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' };
function route(h, page) { h.view.connecting = false; h.win.location.hash = `#${page}`; h.render(); }
function archive() {
  const h = createHarness(); h.state.events = [event];
  h.state.managed = [makeManaged('ready', { confirmed: true, archived: true, canOffload: true, sizeBytes: 12500000, retentionEligible: true }),
    makeManaged('new', { confirmed: true, xmp: { name: 'new.xmp' }, xmpArchived: false }),
    makeManaged('xmp', { confirmed: true, archived: true, canDownload: true, xmp: { name: 'xmp.xmp' }, xmpArchived: false }),
    makeManaged('other', { confirmed: true, archived: true })];
  h.view.archive = { root: '/NAS', entries: [], path: '', connectionVersion: 'a'.repeat(64) };
  route(h, 'archive'); return h;
}
function leaf(h) { h.view.sourcePath = ['여행', 'Sony A7']; h.render(); }
function click(el) { assert.ok(el); el.dispatchEvent({ type: 'click', target: el }); }
async function submit(h, values = {}) {
  h.context.FormData = class { get(name) { return values[name]; } };
  const form = h.dialog.querySelector('form'); form.dispatchEvent({ type: 'submit', target: form, currentTarget: form });
  await flushMicrotasks();
}

test('archive filter counts, folder summaries, badges and selection pruning', () => {
  const h = archive(); assert.equal(h.view.sourceFilter, 'all');
  assert.match(h.page.querySelector('.source-filters').textContent, /전체 4.*미업로드 3.*NAS 보관됨 1/s);
  assert.match(h.page.querySelector('.tree .meta').textContent, /NAS 보관 1.*미업로드 3/);
  leaf(h); assert.match(h.page.textContent, /NAS 보관됨 · 보존 만료/); assert.match(h.page.textContent, /XMP 미업로드/); assert.match(h.page.textContent, /다른 경로 보관됨/);
  h.view.sourceSelection = new Set(['ready:media', 'new:media']);
  h.actions['source-filter']('archived'); h.render();
  assert.deepEqual(plain([...h.view.sourceSelection]), ['ready:media']); assert.equal(h.sourceEntries().length, 1);
  h.actions['source-filter']('unarchived'); h.render(); assert.equal(h.view.sourceSelection.size, 0);
  assert.equal(h.sourceEntries().filter(entry => entry.file?.kind !== 'xmp').length, 3);
});

test('direct source offload opens shared confirmation and queues only eligible media', async () => {
  const h = archive(); leaf(h); h.view.sourceSelection = new Set(['ready:media', 'new:media']); h.render();
  assert.match(action(h, 'offload-source').textContent, /로컬 비우기 \(1\)/);
  h.setFetch(async (url, options) => url === '/api/jobs/offload' ? response({ id: 10, count: 1 }) : response(h.state));
  click(action(h, 'offload-source')); await flushMicrotasks(); assert.equal(h.dialog.open, true);
  assert.match(h.dialog.textContent, /원격 아카이브.*로컬 원본/s); await submit(h);
  const post = h.fetchCalls.find(call => call.url === '/api/jobs/offload'); assert.deepEqual(JSON.parse(post.opts.body), { ids: ['ready'] });
});

test('upload option persists, warns about missing XMP and requires one confirmation', async () => {
  const h = archive(); leaf(h); h.view.sourceSelection.add('new:media'); h.render();
  const toggle = action(h, 'toggle-upload-offload'); toggle.checked = true; toggle.dispatchEvent({ type: 'change', target: toggle }); await flushMicrotasks();
  assert.equal(h.view.uploadOffloadAfter, true); assert.notEqual(action(h, 'toggle-upload-offload').getAttribute('checked'), null);
  assert.equal(action(h, 'upload-archive').textContent.trim(), '업로드 후 로컬 비우기');
  assert.match(h.page.querySelector('#archive-preview-slot').textContent, /누락된 XMP 1개 함께 선택/);
  click(action(h, 'include-missing-xmp')); await flushMicrotasks(); assert.ok(h.view.sourceSelection.has('new:xmp'));
  h.setFetch(async url => url === '/api/archive/transfers' ? response({ id: 12, count: 2 }) : response(h.state));
  click(action(h, 'upload-archive')); await flushMicrotasks(); assert.equal(h.dialog.open, true);
  assert.equal(h.fetchCalls.filter(call => call.url === '/api/archive/transfers').length, 0);
  await submit(h);
  const post = h.fetchCalls.find(call => call.url === '/api/archive/transfers'); assert.equal(JSON.parse(post.opts.body).offload_after_upload, true);
  h.clearCatalogViews(); assert.equal(h.view.uploadOffloadAfter, false); assert.equal(h.view.sourceFilter, 'all');
});

test('remote duplicate choices preserve option and disable followup for XMP-only remainder', async () => {
  const h = archive(); h.setFetch(async url => url === '/api/archive/transfers' ? response({ id: 12, count: 1 }) : response(h.state));
  h.confirmDuplicateUpload(['ready:media', 'new:xmp'], [], '', { duplicates: [{ id: 'ready', name: 'ready', target: 'ready', existingPaths: ['old'] }], duplicateIds: ['ready'] }, true);
  assert.match(h.dialog.textContent, /로컬에서 비웁니다/); await submit(h);
  const post = h.fetchCalls.find(call => call.url === '/api/archive/transfers'); assert.equal(JSON.parse(post.opts.body).offload_after_upload, false);
});

test('upload confirmation transitions to remote duplicate dialog without reopening the modal', async () => {
  const h = archive(); h.view.uploadOffloadAfter = true; h.view.sourceSelection.add('ready:media');
  const showModal = h.dialog.showModal; let modalCalls = 0;
  h.dialog.showModal = function () { modalCalls++; return showModal.call(this); };
  h.setFetch(async url => url === '/api/archive/transfers' ? {
    ok: false, status: 409, json: async () => ({ code: 'remote_duplicate', detail: '원격 중복',
      duplicates: [{ id: 'ready', name: 'ready.mp4', target: 'new/ready.mp4', existingPaths: ['old/ready.mp4'] }], duplicateIds: ['ready'], newCount: 0 }),
  } : response(h.state));
  h.requestArchiveUpload(); const firstForm = h.dialog.querySelector('form');
  assert.equal(h.dialog.open, true);
  assert.throws(() => showModal.call(h.dialog), { name: 'InvalidStateError' });
  await submit(h);
  assert.equal(modalCalls, 1); assert.equal(h.dialog.open, true);
  assert.notEqual(h.dialog.querySelector('form'), firstForm);
  assert.equal(h.dialog.querySelector('#dialog-title').textContent, '원격 중복 파일 감지');
  assert.equal(h.dialog.querySelector('#dialog-error').hidden, true);
  assert.match(h.dialog.textContent, /로컬에서 비웁니다/);
  assert.equal(h.fetchCalls.filter(call => call.url === '/api/archive/transfers').length, 1);
});

test('events manual offload opens confirmation while OMV readiness is unknown', async () => {
  const h = archive(); h.view.archive = null; h.storageMonitor.snapshot = { status: 'loading' };
  h.view.eventId = 'ev1'; h.view.eventSelection.add('ready'); route(h, 'events');
  const offload = action(h, 'offload-media'); assert.equal(offload.disabled, false);
  click(offload); await flushMicrotasks();
  assert.equal(h.dialog.open, true); assert.match(h.dialog.textContent, /NAS 보관 후 로컬 비우기/);
  assert.equal(h.fetchCalls.filter(call => call.url === '/api/jobs/offload').length, 0);
  h.dialog.close(); route(h, 'archive'); h.view.sourceSelection.add('ready:media'); h.render();
  assert.equal(action(h, 'offload-source').disabled, true);
  h.actions['offload-source'](); assert.equal(h.dialog.open, false);
});

test('media stored only under another archive root shows the other-path reason', () => {
  const h = archive();
  const other = h.state.managed.find(file => file.id === 'other');
  Object.assign(other, { canDownload: false, xmp: { name: 'other.xmp' }, xmpArchived: false });
  leaf(h);
  const row = h.page.querySelectorAll('.tree-row').find(node => node.textContent.includes('other.mp4'));
  assert.match(row.textContent, /다른 경로 보관됨/); assert.doesNotMatch(row.textContent, /XMP 미업로드/);
  assert.match(h.eventFileStatus(other), /다른 경로 보관됨/); assert.doesNotMatch(h.eventFileStatus(other), /XMP 미업로드/);
  const xmp = h.state.managed.find(file => file.id === 'xmp');
  assert.match(h.sourceArchiveBadge(xmp), /XMP 미업로드/); assert.match(h.eventFileStatus(xmp), /XMP 미업로드/);
});

test('latest upload result fetches live candidates and renders followup counts', async () => {
  const h = archive();
  h.state.jobs.remote = { id: 20, lane: 'remote', kind: 'upload', status: 'done', result: { uploaded: 2, skipped: 0, offload: { enabled: true, phase: '완료', totalFiles: 2, completedFiles: 2, offloaded: 1, skipped: 1, failed: 0, freedBytes: 12 } } };
  h.state.latestUploadOffload = { jobId: 20, count: 1, totalBytes: 12500000, excludedMissingXmp: 1 }; h.render();
  assert.match(h.page.textContent, /방금 검증된 1개 로컬 비우기/); assert.match(h.page.textContent, /XMP 미업로드 1개는 로컬에 유지/);
  assert.match(h.page.textContent, /비움 1.*건너뜀 1.*실패 0.*확보/s);
  h.setFetch(async () => response({ ids: ['ready'], totalBytes: 12500000 }));
  click(action(h, 'offload-latest-upload')); await flushMicrotasks();
  assert.equal(h.fetchCalls.at(-1).url, '/api/archive/transfers/20/offload-candidates'); assert.equal(h.dialog.open, true);
});

test('server XMP conflict remains actionable when cached XMP state was stale', async () => {
  const h = archive(); h.view.uploadOffloadAfter = true; h.view.sourceSelection.add('new:media');
  h.state.managed.find(file => file.id === 'new').xmpArchived = true;
  h.setFetch(async () => ({ ok: false, status: 409, json: async () => ({ detail: 'XMP 확인', code: 'missing_xmp_for_offload', missingXmpMediaIds: ['new'] }) }));
  await h.startArchiveUpload(); h.render();
  assert.match(h.page.querySelector('#archive-preview-slot').textContent, /누락된 XMP 1개 함께 선택/);
  h.actions['include-missing-xmp'](); assert.ok(h.view.sourceSelection.has('new:xmp'));
});

test('events preserves summary and three segments while offloadable filter does not dim', () => {
  const h = archive(); h.state.managed.push(makeManaged('remote', { status: 'archived', confirmed: true }), makeManaged('draft'));
  h.view.eventId = 'ev1'; route(h, 'events');
  const lifecycle = h.page.querySelector('#event-lifecycle');
  assert.match(lifecycle.textContent, /전체 \d+.*초안 \d+.*분류 확정 \d+.*아카이브 보관 \d+.*NAS 사본 보유 \d+/s);
  assert.deepEqual(Object.keys(h.eventLifecycleSummary(h.state.managed)), ['total', 'draft', 'confirmed', 'archived', 'localArchivedCopy']);
  assert.match(lifecycle.textContent, /로컬 비우기 가능 1/);
  h.actions['event-lifecycle']('offloadable'); h.render();
  assert.equal(h.matchesEventLifecycle(h.state.managed[0]), true); assert.equal(h.matchesEventLifecycle(h.state.managed[1]), false);
  assert.equal(h.page.querySelectorAll('.event-lifecycle-bar .is-dimmed').length, 0);
  h.actions['event-lifecycle']('confirmed'); h.render(); assert.equal(h.page.querySelectorAll('.event-lifecycle-bar .is-dimmed').length, 2);
});

test('retention proposals preserve single connect action and react to OMV state', () => {
  const h = archive(); h.state.retention = { mode: 'days', days: 7, eligibleCount: 2, eligibleBytes: 100, storageConfigured: true };
  h.view.archive = null; h.render();
  assert.equal(h.page.querySelectorAll('[data-action="connect-archive"]').length, 1);
  assert.equal(action(h, 'offload-retention').disabled, true); assert.match(h.page.textContent, /위에서 아카이브 연결 또는 OMV 켜기/);
  h.view.archive = { root: '/NAS', entries: [], path: '' }; h.patchStorageStatus();
  assert.equal(action(h, 'offload-retention').disabled, false);
  h.view.archive = null; h.view.eventId = 'ev1'; route(h, 'events');
  assert.ok(h.page.querySelector('.retention-banner a[href="#archive"]'));
  h.storageMonitor.snapshot = { status: 'running' }; h.storageMonitor.expiry = Infinity; h.patchStorageStatus();
  assert.equal(action(h, 'offload-retention').disabled, false);
  assert.equal(h.page.querySelector('.retention-banner a[href="#archive"]'), null);
});

test('settings policy mode, presets, validation and persistence', async () => {
  const h = archive(); h.view.settings = { localRetention: { mode: 'days', days: 7 } }; h.view.devices = []; route(h, 'settings');
  const section = h.page.querySelectorAll('.settings-section').find(el => el.getAttribute('aria-label') === '로컬 보존 정책'); assert.ok(section);
  assert.match(section.textContent, /직후 \(0일\).*7일.*14일.*30일.*90일/s);
  assert.equal(section.querySelector('#retention-days').getAttribute('max'), '3650');
  h.actions['retention-preset']('0'); h.render();
  h.setFetch(async url => url === '/api/settings/retention' ? response({ localRetention: { mode: 'days', days: 0 } }) : response(h.state));
  await h.actions['save-retention']();
  const post = h.fetchCalls.find(call => call.url === '/api/settings/retention');
  assert.equal(post.opts.method, 'PUT'); assert.deepEqual(JSON.parse(post.opts.body), { mode: 'days', days: 0 });
  h.view.retentionDraftMode = 'days'; h.view.retentionDraftDays = '-1'; await h.actions['save-retention'](); assert.match(h.view.retentionError, /0에서 3650/);
});

test('empty retention input leaves presets unpressed and choosing a preset clears errors', async () => {
  const h = archive(); h.view.settings = { localRetention: { mode: 'days', days: 7 } }; h.view.devices = [];
  h.view.retentionDraftMode = 'days'; h.view.retentionDraftDays = ''; h.view.retentionError = '보존 기간을 확인하세요.'; route(h, 'settings');
  assert.equal(h.page.querySelectorAll('[data-action="retention-preset"][aria-pressed="true"]').length, 0);
  click(h.page.querySelector('[data-action="retention-preset"][data-value="0"]')); await flushMicrotasks();
  assert.equal(h.view.retentionError, ''); assert.equal(h.view.retentionDraftDays, '0');
  assert.equal(h.page.querySelector('[data-action="retention-preset"][data-value="0"]').getAttribute('aria-pressed'), 'true');
});

test('offload cancellation appears in archive, global lane, and job history', () => {
  const h = archive();
  const job = { id: 30, kind: 'offload', lane: 'remote', status: 'running', result: { totalFiles: 3, completedFiles: 1, offloaded: 1 } };
  h.state.jobs.remote = job; h.state.activeJobs.remote = job; h.render();
  assert.ok(h.page.querySelector('.upload-status [data-action="cancel-offload"]'));
  assert.ok(h.page.querySelector('.active-jobs-bar [data-action="cancel-offload"]'));
  job.result.cancelRequested = true; h.render();
  assert.equal(action(h, 'cancel-offload').disabled, true); assert.match(h.page.textContent, /중지 요청됨/);
  h.view.jobs.items = [job]; h.view.jobs.loadedOnce = true; route(h, 'jobs');
  assert.ok(action(h, 'cancel-offload')); assert.equal(action(h, 'cancel-offload').disabled, true);
});

test('offload cancel and retention actions use their live API endpoints', async () => {
  const h = archive();
  h.setFetch(async url => url === '/api/jobs/offload/44/cancel' ? response({ id: 44, kind: 'offload', lane: 'remote', status: 'cancelled', result: { cancelRequested: true } }) : response(h.state));
  await h.actions['cancel-offload']('44');
  const cancellation = h.fetchCalls.find(call => call.url === '/api/jobs/offload/44/cancel'); assert.ok(cancellation); assert.equal(cancellation.opts.method, 'POST');
  h.setFetch(async () => response({ ids: ['ready'], totalBytes: 12500000 }));
  await h.actions['offload-retention'](); assert.equal(h.fetchCalls.at(-1).url, '/api/offload/retention-candidates'); assert.equal(h.dialog.open, true);
});

test('structure key tracks retention, latest candidates, filters and drafts; rendered copy preserves bans', () => {
  const h = archive();
  for (const mutate of [() => h.state.retention = { mode: 'days', days: 0 }, () => h.state.latestUploadOffload = { jobId: 4 },
    () => h.view.sourceFilter = 'archived', () => h.view.uploadOffloadAfter = true, () => h.view.retentionDraftMode = 'days', () => h.view.retentionDraftDays = '30']) {
    const key = h.storageStructureKey(); mutate(); assert.notEqual(h.storageStructureKey(), key);
  }
  for (const page of ['archive', 'events', 'settings', 'catalog', 'jobs', 'incoming']) {
    route(h, page); assert.doesNotMatch(h.page.textContent, /Incoming Library|이벤트 관리|managed로|배치 확정|푸티지|Source|Destination/);
  }
});
