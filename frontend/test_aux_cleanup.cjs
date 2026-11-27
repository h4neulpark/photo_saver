'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse the established DOM fixture without changing protected tests.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, openAuxCleanupDialog, companionDispositionLabel, incomingCompanions, incomingCompanionsCount, laneJobsBar, jobMessage, jobHistoryActions, patchJobCard, actions,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeIncoming } = vm.runInContext('({createHarness, flushMicrotasks, makeIncoming})', context);
const plain = value => JSON.parse(JSON.stringify(value));
const response = data => ({ ok: true, status: 200, json: async () => data });
function setup() {
  const h = createHarness(); h.view.connecting = false; h.win.dispatchHashChange('#incoming');
  return h;
}
function stub(h, plan, error = false) {
  h.setFetch(url => {
    if (url === '/api/incoming/aux/plan') return response(plan);
    if (url === '/api/jobs/aux-cleanup') return error ? { ok: false, status: 409, json: async () => ({ detail: '보조 파일 상태가 변경되었습니다.' }) } : response({ id: 45, lane: 'local' });
    return response({ incoming: h.state.incoming, managed: [], events: [], pendingXmp: [], jobs: h.state.jobs, activeJobs: h.state.activeJobs });
  });
}
function aux(path, category = 'orphan', overrides = {}) {
  return { path, kind: path.split('.').at(-1).toLowerCase(), sizeBytes: 1000000, fingerprint: '[1,2,1000000,4,5]', category,
    selectable: category !== 'unreadable', defaultSelected: ['orphan', 'duplicate-owner'].includes(category),
    orphanHint: category === 'orphan' ? 'unverified-orphan' : null, candidatePaths: [], reason: '파일 확인', ...overrides };
}
function change(h, input, checked) { input.checked = checked; h.dialog.dispatchEvent({ type: 'change', target: input }); }
function click(h, selector) { const target = h.dialog.querySelector(selector); h.dialog.dispatchEvent({ type: 'click', target }); }
async function submit(h) { const form = h.dialog.querySelector('form'); h.dialog.dispatchEvent({ type: 'submit', target: form, currentTarget: form }); await flushMicrotasks(); }

test('camera keep wording, XMP preservation and unique tab counts', () => {
  const h = setup();
  h.state.scan = { finishedAt: '2026-11-27T00:00:00Z', result: { unmatchedCompanions: [{ path: 'orphan.THM', disposition: 'keep' }] } };
  h.state.incoming = [makeIncoming('a', { companions: [{ path: 'a.AAE', disposition: 'keep', sizeBytes: 9 }, { path: 'a.xmp', disposition: 'keep' }] }),
    makeIncoming('b', { companions: [{ path: 'a.AAE', disposition: 'review' }] })];
  h.render();
  assert.equal(h.incomingCompanionsCount(), 2);
  assert.equal(h.companionDispositionLabel({ path: 'a.AAE', disposition: 'keep' }), 'Incoming 남음');
  assert.equal(h.companionDispositionLabel({ path: 'a.xmp', disposition: 'keep' }), '보존 필요');
  assert.match(h.page.textContent, /원본 없음/); assert.match(h.page.textContent, /원본 연결됨/);
  assert.match(h.page.textContent, /정리 창에서 실시간 용량 확인/);
  assert.equal(h.page.querySelector('#incoming-tab-companions .incoming-tab-count').textContent, '2');
});

test('empty companion tab offers live auxiliary discovery and preserves existing text', () => {
  const h = setup(); h.render();
  assert.match(h.page.textContent, /확인이 필요한 동반 파일이 없습니다\./);
  assert.match(h.page.querySelector('[data-action="cleanup-aux-companions"]').textContent, /Incoming 보조 파일 확인/);
  assert.equal(typeof h.actions['cleanup-aux-companions'], 'function');
});

test('companion rows show legacy orphan bytes and all unique owner paths with single-owner status', () => {
  const h = setup();
  h.state.scan = { finishedAt: '2026-11-27T00:00:00Z', result: { unmatchedCompanions: [
    { path: 'orphan.THM', disposition: 'keep', size: 3000000 },
  ] } };
  const shared = { path: 'CLIP.THM', disposition: 'keep', sizeBytes: 4000000, reason: '원본 후보가 여러 개입니다.' };
  h.state.incoming = [
    makeIncoming('photo', { path: 'CLIP.JPG', status: 'duplicate', companions: [shared, { path: 'photo.AAE', disposition: 'keep', sizeBytes: 2000000 }] }),
    makeIncoming('video', { path: 'CLIP.MP4', status: 'review', companions: [shared, { path: 'video.LRV', disposition: 'review', sizeBytes: 1000000 }] }),
    makeIncoming('same-owner-again', { path: 'CLIP.JPG', status: 'duplicate', companions: [shared] }),
  ];
  h.render();
  const items = plain(h.incomingCompanions());
  const ambiguous = items.find(item => item.path === 'CLIP.THM');
  assert.deepEqual(ambiguous.ownerPaths, ['CLIP.JPG', 'CLIP.MP4']);
  assert.equal(ambiguous.ownerPath, null); assert.equal(ambiguous.ownerStatus, null);
  const photo = items.find(item => item.path === 'photo.AAE');
  assert.equal(photo.ownerPath, 'CLIP.JPG'); assert.equal(photo.ownerStatus, 'duplicate');
  const rows = [...h.page.querySelectorAll('.companion-row')];
  const row = path => rows.find(node => node.querySelector('strong').textContent === path);
  assert.match(row('orphan.THM').textContent, /Incoming 남음 · 3 MB/);
  assert.match(row('photo.AAE').textContent, /Incoming 남음 · 2 MB/);
  assert.match(row('photo.AAE').textContent, /원본: CLIP.JPG \(중복\)/);
  assert.match(row('video.LRV').textContent, /원본: CLIP.MP4 \(확인 필요\)/);
  assert.match(row('CLIP.THM').textContent, /원본 후보: CLIP.JPG, CLIP.MP4/);
  assert.doesNotMatch(row('CLIP.THM').textContent, /원본: CLIP.MP4/);
  assert.equal(h.incomingCompanionsCount(), 4);
});

test('duplicate option defaults on, toggles receipts, and submits opt in', async () => {
  const h = setup();
  h.state.incoming = [makeIncoming('a', { status: 'duplicate', companions: [{ path: 'a.THM', disposition: 'keep' }, { path: 'a.xmp', disposition: 'keep' }] })];
  h.view.incomingSelection.add('a'); h.render();
  h.setFetch(url => url.includes('duplicates/plan') ? response({ groups: [{ files: [{ id: 'a', path: 'a.MP4', sizeBytes: 2000000 }], keepers: [{ id: 'm', kind: 'managed', path: 'kept.MP4' }], auxCompanions: [{ fileId: 'a', path: 'a.THM', kind: 'thm', sizeBytes: 1000000 }] }] }) : url.includes('jobs/duplicate-cleanup') ? response({ id: 1 }) : response({ incoming: h.state.incoming, managed: [], events: [], pendingXmp: [] }));
  await h.confirmIncomingCleanup();
  const checkbox = h.dialog.querySelector('[name="delete_aux"]'); assert.equal(checkbox.checked, true);
  assert.match(h.dialog.querySelector('#cleanup-summary').textContent, /보조 파일 1개/);
  assert.match(h.dialog.textContent, /a.THM · 함께 삭제/); assert.match(h.dialog.textContent, /a.xmp · Incoming에 보존/);
  change(h, checkbox, false); assert.doesNotMatch(h.dialog.querySelector('#cleanup-summary').textContent, /함께 삭제/);
  assert.match(h.dialog.textContent, /a.THM · Incoming에 보존/);
  change(h, checkbox, true); await submit(h);
  assert.equal(JSON.parse(h.fetchCalls.find(call => call.url === '/api/jobs/duplicate-cleanup').opts.body).deleteAux, true);
});

test('keeper changes disable the option when all eligible auxiliaries belong to keeper', async () => {
  const h = setup(); h.state.incoming = ['a', 'b'].map(id => makeIncoming(id, { status: 'duplicate' }));
  for (const file of h.state.incoming) h.view.incomingSelection.add(file.id); h.render();
  h.setFetch(() => response({ groups: [{ files: ['a', 'b'].map(id => ({ id, path: id + '.MP4', sizeBytes: 1 })), keepers: [{ id: 'm', kind: 'managed', path: 'm.MP4' }, { id: 'b', kind: 'incoming', path: 'b.MP4' }], auxCompanions: [{ fileId: 'b', path: 'b.LRV', kind: 'lrv', sizeBytes: 1000 }] }] }));
  await h.confirmIncomingCleanup(); const keeper = h.dialog.querySelector('[data-keeper-group]'); keeper.value = '1';
  h.dialog.dispatchEvent({ type: 'change', target: keeper });
  assert.equal(h.dialog.querySelector('[name="delete_aux"]').disabled, true);
  assert.match(h.dialog.querySelector('#cleanup-aux-label').textContent, /함께 삭제할 보조 파일이 없습니다/);
  assert.match(h.dialog.textContent, /b.LRV · Incoming에 보존/);
  keeper.value = '0'; h.dialog.dispatchEvent({ type: 'change', target: keeper });
  assert.equal(h.dialog.querySelector('[name="delete_aux"]').disabled, false);
});

test('duplicate option off omits deleteAux from the request', async () => {
  const h = setup(); h.state.incoming = [makeIncoming('a', { status: 'duplicate' })]; h.view.incomingSelection.add('a'); h.render();
  h.setFetch(url => url.includes('duplicates/plan') ? response({ groups: [{ files: [{ id: 'a', path: 'a.MP4', sizeBytes: 1 }], keepers: [{ kind: 'managed', id: 'm', path: 'm.MP4' }], auxCompanions: [{ fileId: 'a', path: 'a.LRV', kind: 'lrv', sizeBytes: 1 }] }] }) : url.includes('jobs/duplicate-cleanup') ? response({ id: 9 }) : response({ incoming: h.state.incoming, managed: [], events: [], pendingXmp: [] }));
  await h.confirmIncomingCleanup(); change(h, h.dialog.querySelector('[name="delete_aux"]'), false); await submit(h);
  assert.deepEqual(JSON.parse(h.fetchCalls.find(call => call.url === '/api/jobs/duplicate-cleanup').opts.body), { items: [{ id: 'a', keeperKind: 'managed', keeperId: 'm' }] });
});

test('duplicate modal and result keep deleted and absent auxiliary terminal states', async () => {
  const h = setup();
  const companions = [{ path: 'copy.LRV', disposition: 'deleted' }, { path: 'copy.THM', disposition: 'absent' }];
  h.state.incoming = [makeIncoming('copy', { path: 'copy.MP4', status: 'duplicate', companions })];
  h.view.incomingSelection.add('copy'); h.render();
  h.setFetch(() => response({ groups: [{ files: [{ id: 'copy', path: 'copy.MP4', sizeBytes: 7 }],
    keepers: [{ kind: 'managed', id: 'keeper', path: 'kept.MP4' }], auxCompanions: [] }] }));
  await h.confirmIncomingCleanup();
  const files = h.dialog.querySelector('[data-cleanup-group-files]');
  assert.match(files.textContent, /copy.LRV · 정리됨/);
  assert.match(files.textContent, /copy.THM · 파일 없음/);
  assert.doesNotMatch(files.textContent, /Incoming에 보존/);
  h.dialog.close();
  h.state.latestIncomingResult = { id: 10, kind: 'duplicate-cleanup', status: 'done', result: { cleaned: 1, items: [{ path: 'copy.MP4', status: 'cleaned', companions }] } };
  h.render();
  const result = h.page.querySelector('#incoming-result-slot');
  assert.doesNotMatch(result.textContent, /Incoming 남음/);
  assert.equal(result.querySelector('[data-action="incoming-tab"]'), null);
});

test('aux plan categories, group selection, quick selection, warning and submit payload', async () => {
  const h = setup(); const categories = ['orphan', 'duplicate-owner', 'ambiguous', 'review-owner', 'unscanned-owner', 'ready-owner', 'unreadable'];
  const items = categories.map((category, i) => aux(`${i}.LRV`, category, { candidatePaths: ['a.MP4', 'b.MP4'] }));
  stub(h, { items }); await h.openAuxCleanupDialog();
  assert.equal(h.dialog.querySelectorAll('[data-aux-category]').length, 7);
  assert.equal(h.dialog.querySelector('#aux-cleanup-warning').hidden, false); assert.match(h.dialog.textContent, /LRV에는 저화질 영상/);
  assert.match(h.dialog.querySelector('#aux-cleanup-summary').textContent, /선택 2개 \/ 전체 7개/);
  click(h, '[data-aux-select="none"]'); assert.equal(h.dialog.querySelector('[type="submit"]').disabled, true);
  assert.equal(h.dialog.querySelector('#aux-cleanup-warning').hidden, true);
  change(h, h.dialog.querySelector('[data-aux-category="ready-owner"]'), true); assert.match(h.dialog.querySelector('#aux-cleanup-summary').textContent, /선택 1개/);
  click(h, '[data-aux-select="all"]'); assert.match(h.dialog.querySelector('[type="submit"]').textContent, /6개/);
  assert.equal(h.dialog.querySelector('[data-aux-path="6.LRV"]').disabled, true);
  click(h, '[data-aux-select="defaults"]');
  change(h, h.dialog.querySelector('[data-aux-path="0.LRV"]'), false);
  assert.equal(h.dialog.querySelector('#aux-cleanup-warning').hidden, true);
  await submit(h);
  const sent = JSON.parse(h.fetchCalls.find(call => call.url === '/api/jobs/aux-cleanup').opts.body);
  assert.deepEqual(sent, { items: [{ path: '1.LRV', fingerprint: items[1].fingerprint }] });
});

test('aux 409 remains visible and resynchronizes state', async () => {
  const h = setup(); stub(h, { items: [aux('orphan.LRV')] }, true); await h.openAuxCleanupDialog(); await submit(h);
  assert.equal(h.dialog.open, true); assert.equal(h.dialog.querySelector('#dialog-error').hidden, false);
  assert.match(h.dialog.querySelector('#dialog-error').textContent, /상태가 변경/);
  assert.ok(h.fetchCalls.some(call => call.url === '/api/state'));
});

test('planning and busy guards prevent duplicate requests and stale dialogs', async () => {
  for (const guard of ['connecting', 'local', 'exclusive', 'planning']) {
    const h = setup();
    if (guard === 'connecting') h.view.connecting = true;
    if (guard === 'planning') h.view.auxCleanupPlanning = true;
    if (['local', 'exclusive'].includes(guard)) h.state.activeJobs[guard] = { id: 1, kind: guard === 'local' ? 'aux-cleanup' : 'reset-all', status: 'running' };
    const before = h.fetchCalls.length; await h.openAuxCleanupDialog(); assert.equal(h.fetchCalls.length, before);
  }
  for (const guard of ['page', 'dialog', 'preview', 'busy']) {
    const h = setup(); let resolve; h.setFetch(() => new Promise(done => { resolve = done; }));
    const pending = h.openAuxCleanupDialog(); assert.equal(h.view.auxCleanupPlanning, true);
    assert.equal(h.page.querySelector('[data-action="cleanup-aux-companions"]').disabled, true);
    if (guard === 'page') h.view.page = 'events';
    if (guard === 'dialog') h.dialog.showModal();
    if (guard === 'preview') h.mediaPreview.showModal();
    if (guard === 'busy') h.state.activeJobs.local = { id: 1, kind: 'scan', status: 'running' };
    resolve(response({ items: [aux('orphan.THM')] })); await pending;
    assert.equal(h.view.auxCleanupPlanning, false); assert.equal(h.dialog.querySelector('#aux-cleanup-summary'), null);
  }
});

test('empty and failed plans restore planning state', async () => {
  const h = setup(); stub(h, { items: [] }); await h.openAuxCleanupDialog();
  assert.equal(h.dialog.open, false); assert.match(h.notice.textContent, /정리할 THM·LRV·AAE 보조 파일이 없습니다/);
  h.setFetch(() => { throw new Error('offline'); }); await assert.rejects(h.openAuxCleanupDialog(), /로컬 API에 연결할 수 없습니다/);
  assert.equal(h.view.auxCleanupPlanning, false);
});

test('remote work coexists with auxiliary planning and known orphan has no unverified warning', async () => {
  const h = setup(); h.state.activeJobs.remote = { id: 11, kind: 'upload', lane: 'remote', status: 'running' };
  stub(h, { items: [aux('known.LRV', 'orphan', { orphanHint: 'owner-archived' })] });
  await h.openAuxCleanupDialog(); assert.equal(h.dialog.open, true); assert.equal(h.dialog.querySelector('#aux-cleanup-warning').hidden, true);
});

test('aux results, duplicate counts, preserved shortcuts and lane/history labels', () => {
  const h = setup();
  const job = { id: 45, kind: 'aux-cleanup', lane: 'local', status: 'done', result: { deleted: 2, absent: 1, review: 1, freedBytes: 1000000, items: [{ path: 'gone.THM', status: 'absent' }] } };
  h.state.latestIncomingResult = job; h.render(); assert.match(h.page.textContent, /보조 파일 정리 결과/);
  assert.match(h.page.textContent, /파일 없음/); assert.match(h.jobMessage(job), /2개 삭제.*이미 없음 1개.*확인 필요 1개/);
  assert.match(h.jobHistoryActions(job), /가져오기 열기/);
  const duplicate = { ...job, kind: 'duplicate-cleanup', result: { cleaned: 1, auxDeleted: 2, companionReview: 1, review: 1, items: [{ path: 'a.MP4', status: 'cleaned', companions: [{ path: 'a.THM', disposition: 'keep' }] }] } };
  assert.match(h.jobMessage(duplicate), /THM·LRV·AAE 2개 삭제.*확인 필요 2개/);
  h.state.latestIncomingResult = duplicate; h.render();
  assert.ok(h.page.querySelector('#incoming-result-slot [data-action="incoming-tab"]'));
  assert.match(h.page.querySelector('#incoming-result-slot').textContent, /Incoming 남음/);
  h.state.activeJobs.local = { ...job, status: 'running' }; h.render();
  assert.match(h.laneJobsBar(), /보조 파일 정리/); assert.equal(h.page.querySelector('[data-action="cleanup-aux-companions"]').disabled, true);
});

test('job history renders auxiliary cards and responsive styles preserve touch targets', () => {
  const h = setup(); const node = h.doc.createElement('article');
  node.innerHTML = '<div data-slot="head"></div><div data-slot="body"></div><div data-slot="details"></div>';
  h.patchJobCard(node, { id: 3, kind: 'aux-cleanup', lane: 'local', status: 'done', createdAt: '2026-11-27T00:00:00Z', result: { deleted: 1 } });
  assert.match(node.textContent, /보조 파일 정리/); assert.doesNotMatch(node.textContent, /aux-cleanup/);
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(css, /\.aux-cleanup-item[\s\S]*min-height: 44px/); assert.match(css, /overflow-wrap: anywhere/);
});
