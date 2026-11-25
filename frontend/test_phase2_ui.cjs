'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Keep the established five-root fixture and all protected test files intact.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, renderNavigation, navBadgeInfo, incomingScanStrip,
      buildArchiveUploadPreview, syncSourceSelection, isStorageConfigured,
      maybeAutoConnectArchive, resetArchiveConnection, browseArchive,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeManaged, makeIncoming } = vm.runInContext('({ createHarness, flushMicrotasks, makeManaged, makeIncoming })', context);
const plain = value => JSON.parse(JSON.stringify(value));
const response = data => ({ ok: true, status: 200, json: async () => data });
const configured = () => ({ addressConfigured: true, storageRootConfigured: true, accountConfigured: true, keyGenerated: true, hostKeyTrusted: true, keyCopied: true });
const remote = () => ({ root: '/NAS', path: '', entries: [] });
const event = (id = 'ev1', overrides = {}) => ({ id, name: '제주여행', folder: '260903_제주여행', parent: null, start: '2026-09-03', end: '2026-09-05', ...overrides });
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);
function route(h, name) { h.view.connecting = false; h.win.location.hash = `#${name}`; h.render(); }
function archive(h) {
  h.state.events = [event(), event('child', { name: '해변식당', folder: '해변식당', parent: 'ev1' })];
  h.state.managed = [makeManaged('one', { confirmed: true, eventId: 'child', deviceFolder: 'GoPro', path: 'disk/GX010001.MP4', xmp: { name: 'GX010001.xmp' } })];
  h.view.archive = remote(); route(h, 'archive');
}
function click(element) { assert.ok(element); element.dispatchEvent({ type: 'click', target: element }); }
function change(element, checked) { element.checked = checked; element.dispatchEvent({ type: 'change', target: element }); }
function assertHiddenDisabled(element) { assert.ok(element.hidden || element.closest('[hidden]')); assert.equal(element.disabled, true); }
async function submit(h, values = {}) {
  h.context.FormData = class { get(name) { return values[name]; } };
  const form = h.dialog.querySelector('form');
  form.dispatchEvent({ type: 'submit', target: form, currentTarget: form });
  await flushMicrotasks();
  assert.equal(h.dialog.querySelector('#dialog-error').hidden, true);
}

test('01 sidebar preserves six routes, two labelled groups and workflow steps', () => {
  const h = createHarness(); route(h, 'incoming');
  const nav = h.doc.getElementById('navigation');
  const groups = nav.querySelectorAll('[role="group"]');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].getAttribute('aria-labelledby'), 'nav-group-workflow');
  assert.equal(groups[1].getAttribute('aria-labelledby'), 'nav-group-manage');
  assert.match(groups[0].textContent, /작업 흐름/); assert.match(groups[1].textContent, /조회·관리/);
  assert.deepEqual(plain(nav.querySelectorAll('.nav-step').map(el => el.textContent)), ['1', '2', '3']);
  assert.deepEqual(plain(nav.querySelectorAll('a').map(el => el.getAttribute('href'))), ['#incoming', '#events', '#archive', '#catalog', '#jobs', '#settings']);
  assert.equal(nav.querySelector('[aria-current="page"]').getAttribute('href'), '#incoming');
  const link = nav.querySelector('a'); h.render(); assert.equal(nav.querySelector('a'), link);
});

test('02 sidebar live badges count pending work, hide zero and expose exact 99+ count', () => {
  const h = createHarness(); route(h, 'incoming');
  const nav = h.doc.getElementById('navigation'); assert.equal(nav.querySelectorAll('.nav-badge').length, 0);
  h.state.incoming = ['ready', 'duplicate', 'review', 'moved', 'deleted'].map((status, i) => makeIncoming(String(i), { status }));
  h.state.pendingXmp = [{ status: 'pending' }, { status: 'linked' }];
  h.state.events = [event()];
  h.state.managed = [makeManaged('unassigned', { eventId: null }), makeManaged('pending', { confirmed: true }),
    makeManaged('sent', { confirmed: true, archived: true }), makeManaged('xmp', { confirmed: true, archived: true, xmp: { name: 'x.xmp' }, xmpArchived: false }),
    makeManaged('draft'), makeManaged('remote', { confirmed: true, status: 'archived' })];
  h.state.activeJobs.local = { id: 1, kind: 'scan', lane: 'local', status: 'running', result: {} };
  h.state.activeJobs.remote = { id: 2, kind: 'upload', lane: 'remote', status: 'queued', result: {} };
  h.view.deviceUpload.running = true; h.renderNavigation();
  for (const [id, count, label] of [['incoming', 4, '대기 항목'], ['events', 1, '미배정'], ['archive', 2, '아카이브 대기'], ['jobs', 3, '진행 중']]) {
    const badge = nav.querySelector(`[href="#${id}"] .nav-badge`);
    assert.equal(badge.textContent, String(count)); assert.equal(badge.getAttribute('aria-label'), `${label} ${count}건`);
    assert.equal(badge.classList.contains('nav-badge-muted'), id !== 'jobs');
  }
  h.state.pendingXmp = []; h.state.incoming = Array.from({ length: 105 }, (_, id) => makeIncoming(String(id))); h.renderNavigation();
  const badge = nav.querySelector('[href="#incoming"] .nav-badge');
  assert.equal(badge.textContent, '99+'); assert.equal(badge.getAttribute('title'), '105건'); assert.equal(badge.getAttribute('aria-label'), '대기 항목 105건');
  h.state.incoming.length = 99; h.renderNavigation(); assert.equal(nav.querySelector('[href="#incoming"] .nav-badge').textContent, '99');
});

test('03 Korean terms remain consistent across pages while actual disk paths remain valid', () => {
  const h = createHarness(); h.state.incoming = [makeIncoming('photo')]; h.view.incomingSelection.add('photo'); route(h, 'incoming');
  assert.match(h.page.textContent, /가져오기/); assert.match(action(h, 'move-incoming').textContent, /보관함으로 가져오기/);
  h.state.events = [event()]; h.state.managed = [makeManaged('one', { canOffload: true })]; h.view.eventId = 'ev1'; h.view.eventSelection.add('one'); route(h, 'events');
  assert.match(h.page.textContent, /이벤트 분류/); assert.match(action(h, 'confirm-event').textContent, /분류 확정/); assert.match(action(h, 'offload-media').textContent, /NAS 보관 후 로컬 비우기/);
  archive(h); assert.match(h.page.textContent, /보낼 항목 \(로컬\)/); assert.match(h.page.textContent, /원격 아카이브 \(NAS\)/);
  for (const name of ['incoming', 'events', 'archive', 'catalog', 'jobs', 'settings']) {
    route(h, name); assert.doesNotMatch(h.page.textContent, /Incoming Library|이벤트 관리|managed로|배치 확정|푸티지|Source|Destination/);
  }
});

test('04 Incoming tabs have counts, linked panels and roving keyboard focus', () => {
  const h = createHarness(); h.state.incoming = [makeIncoming('one')];
  h.state.pendingXmp = [{ id: 'x', path: 'x.xmp', status: 'review', candidates: [] }];
  h.state.scan = { finishedAt: '2026-11-25T00:00:00Z', result: { checked: 1, unmatchedCompanions: [{ path: 'a.thm', reason: '확인' }] } };
  route(h, 'incoming'); assert.equal(h.page.querySelector('#incoming-tabs').getAttribute('role'), 'tablist');
  assert.equal(h.page.querySelectorAll('[role="tab"]').length, 3);
  for (const key of ['files', 'xmp', 'companions']) {
    const tab = h.page.querySelector(`#incoming-tab-${key}`);
    assert.equal(tab.getAttribute('aria-controls'), `incoming-tabpanel-${key}`); assert.equal(tab.querySelector('.incoming-tab-count').textContent, '1');
  }
  for (const [key, expected] of [['ArrowRight', 'xmp'], ['ArrowRight', 'companions'], ['ArrowRight', 'files'], ['ArrowLeft', 'companions'], ['Home', 'files'], ['End', 'companions']]) {
    const current = h.page.querySelector(`[role="tab"][aria-selected="true"]`); current.dispatchEvent({ type: 'keydown', key, target: current });
    assert.equal(h.view.incomingTab, expected); assert.equal(h.doc.activeElement.id, `incoming-tab-${expected}`);
    for (const tab of h.page.querySelectorAll('[role="tab"]')) {
      const active = tab.dataset.value === expected;
      assert.equal(tab.getAttribute('aria-selected'), String(active)); assert.equal(tab.getAttribute('tabindex'), active ? '0' : '-1');
      assert.equal(h.page.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden, !active);
    }
  }
});

test('05 Incoming tabs retain image, upload input, focus, selection and scroll nodes', () => {
  const h = createHarness(); h.state.incoming = [makeIncoming('one')]; h.view.deviceUpload.open = true; route(h, 'incoming');
  const rows = h.page.querySelector('#incoming-rows'), image = rows.querySelector('img'), panel = h.page.querySelector('#incoming-upload-panel'), folder = h.page.querySelector('#incoming-upload-folder');
  rows.scrollTop = 123; folder.value = h.view.deviceUpload.folder = 'my-folder'; folder.focus(); h.view.incomingSelection.add('one');
  for (const key of ['xmp', 'companions', 'files']) {
    h.actions['incoming-tab'](key);
    assert.equal(h.page.querySelector('#incoming-rows'), rows); assert.equal(rows.querySelector('img'), image); assert.equal(rows.scrollTop, 123);
    assert.equal(h.page.querySelector('#incoming-upload-panel'), panel); assert.equal(h.page.querySelector('#incoming-upload-folder'), folder); assert.equal(folder.value, 'my-folder'); assert.equal(h.doc.activeElement, folder);
    assert.equal(h.view.incomingSelection.has('one'), true); assert.equal(h.page.querySelector('#incoming-view-switch').hidden, key !== 'files');
  }
});

test('06 empty auxiliary tabs retain context and offer a working files return action', async () => {
  const h = createHarness(); h.state.pendingXmp = [{ id: 'x', path: 'x.xmp', status: 'review', candidates: [] }]; route(h, 'incoming');
  h.actions['incoming-tab']('xmp'); h.state.pendingXmp = []; h.render();
  assert.equal(h.view.incomingTab, 'xmp'); assert.match(h.page.querySelector('#incoming-tabpanel-xmp').textContent, /연결할 XMP 파일이 없습니다/);
  assert.equal(h.page.querySelector('#incoming-tab-xmp').classList.contains('is-empty'), true);
  click(h.page.querySelector('#incoming-tabpanel-xmp [data-action="incoming-tab"]')); await flushMicrotasks(); assert.equal(h.view.incomingTab, 'files');
  h.actions['incoming-tab']('companions'); assert.match(h.page.querySelector('#incoming-tabpanel-companions').textContent, /확인이 필요한 동반 파일이 없습니다/);
  h.view.archiveAutoAttempted = true; h.view.archiveAutoConnecting = true; h.clearCatalogViews();
  assert.equal(h.view.incomingTab, 'files'); assert.equal(h.view.archiveAutoAttempted, false); assert.equal(h.view.archiveAutoConnecting, false);
});

test('07 Incoming context actions handle idle, photos, videos, duplicates, mixed filters and clearing', async () => {
  const h = createHarness(); h.state.incoming = [makeIncoming('photo'), makeIncoming('video', { kind: 'video' }), makeIncoming('dup', { status: 'duplicate' })]; route(h, 'incoming');
  assert.match(h.page.querySelector('#incoming-actions').textContent, /항목을 선택하면/);
  for (const name of ['move-incoming', 'cleanup-incoming', 'delete-incoming']) assertHiddenDisabled(action(h, name));
  h.view.incomingSelection.add('photo'); h.render(); assert.equal(h.page.querySelector('#incoming-actions').classList.contains('has-selection'), true);
  assert.match(action(h, 'move-incoming').textContent, /보관함으로 가져오기 \(1\)/); assert.equal(action(h, 'move-incoming').classList.contains('primary'), true); assert.match(action(h, 'delete-incoming').textContent, /사진 삭제 \(1\)/);
  h.view.incomingSelection.clear(); h.view.incomingSelection.add('video'); h.render(); assertHiddenDisabled(action(h, 'delete-incoming')); assert.equal(action(h, 'move-incoming').disabled, false);
  h.view.incomingSelection.add('dup'); h.render();
  for (const text of ['2개 선택', '이동 가능 1개', '중복 1개']) assert.ok(h.page.querySelector('#incoming-actions').textContent.includes(text));
  click(h.page.querySelector('[data-action="incoming-filter"][data-value="duplicate"]')); await flushMicrotasks();
  assert.equal(h.view.incomingSelection.has('video'), false); assert.match(h.page.querySelector('#incoming-actions').textContent, /중복 1개 선택/);
  const cleanup = action(h, 'cleanup-incoming'); assert.match(cleanup.textContent, /중복 정리 \(1\)/); assert.equal(cleanup.classList.contains('primary'), true); assert.equal(cleanup.classList.contains('danger'), true);
  assertHiddenDisabled(action(h, 'move-incoming')); assertHiddenDisabled(action(h, 'delete-incoming'));
  click(action(h, 'clear-incoming-selection')); await flushMicrotasks(); assert.equal(h.view.incomingSelection.size, 0); assert.equal(h.page.querySelector('#incoming-actions').classList.contains('has-selection'), false);
});

test('08 completed scan strips remove duplicate status counts and retain active progress', () => {
  const h = createHarness(); h.state.scan = { finishedAt: '2026-11-25T00:00:00Z', result: { checked: 12, ready: 8, duplicate: 3, review: 1 } }; route(h, 'incoming');
  assert.match(h.page.querySelector('#incoming-scan-strip').textContent, /총 12개 검사/); assert.doesNotMatch(h.page.querySelector('#incoming-scan-strip').textContent, /이동 가능|중복|확인 필요/);
  h.state.activeJobs.local = h.state.jobs.local = { id: 1, kind: 'scan', lane: 'local', status: 'running', result: { totalFiles: 12, completedFiles: 4, current: 'long/path.jpg' } }; h.render();
  const progress = h.page.querySelector('progress'); assert.equal(progress.getAttribute('value'), '4'); assert.equal(progress.getAttribute('max'), '12'); assert.match(h.page.querySelector('#incoming-scan-strip').textContent, /4 \/ 12.*long\/path.jpg/s);
});

test('09 Events context bar hides idle controls and keeps one confirm primary with partial offload', async () => {
  const h = createHarness(); h.state.events = [event(), event('other')]; h.state.managed = [makeManaged('one', { canOffload: true }), makeManaged('two')]; h.view.eventId = 'ev1'; route(h, 'events');
  assert.equal(h.page.querySelector('#event-actions').hidden, true);
  assert.equal(h.page.querySelector('#event-actions .action-bar-idle'), null);
  for (const name of ['move-event', 'edit-media', 'offload-media', 'confirm-event']) assertHiddenDisabled(action(h, name));
  assertHiddenDisabled(h.page.querySelector('#move-event-target'));
  h.view.eventSelection.add('one'); h.view.eventSelection.add('two'); h.render();
  assert.equal(h.page.querySelector('#event-actions').hidden, false);
  assert.equal(h.page.querySelector('#event-actions').classList.contains('has-selection'), true); assert.match(action(h, 'offload-media').textContent, /NAS 보관 후 로컬 비우기 \(1\)/);
  assert.equal(h.page.querySelectorAll('#event-actions .primary').length, 1); assert.equal(action(h, 'confirm-event').classList.contains('primary'), true);
  click(action(h, 'clear-event-selection')); await flushMicrotasks(); assert.equal(h.view.eventSelection.size, 0); assert.equal(h.page.querySelector('#event-actions').classList.contains('has-selection'), false);
  assert.equal(h.page.querySelector('#event-actions').hidden, true);
  h.view.eventSelection.add('two'); h.render(); assertHiddenDisabled(action(h, 'offload-media'));
});

test('10 Archive logical breadcrumb jumps to ancestors and clears selected assets', async () => {
  const h = createHarness(); archive(h); h.view.sourcePath = ['260903_제주여행', '해변식당', 'GoPro']; h.view.sourceSelection.add('one:media'); h.render();
  const crumb = h.page.querySelector('.archive-breadcrumb'); assert.match(crumb.textContent, /로컬 확정 목록.*제주여행.*해변식당.*GoPro/); assert.doesNotMatch(crumb.textContent, /managed/);
  assert.equal(crumb.querySelector('[aria-current="location"]').textContent, 'GoPro');
  click(crumb.querySelector('[data-value="1"]')); await flushMicrotasks(); assert.deepEqual(plain(h.view.sourcePath), ['260903_제주여행']); assert.equal(h.view.sourceSelection.size, 0);
  click(h.page.querySelector('.archive-breadcrumb [data-value="0"]')); await flushMicrotasks(); assert.deepEqual(plain(h.view.sourcePath), []);
});

test('11 Archive preview matches server paths, XMP, size, samples and in-place checkbox updates', () => {
  const h = createHarness(); archive(h);
  let result = h.buildArchiveUploadPreview(['one:media', 'one:xmp', 'one:media', 'missing:media']);
  assert.deepEqual(plain(result.samples), ['/NAS/260903_제주여행/해변식당/GoPro/GX010001.MP4', '/NAS/260903_제주여행/해변식당/GoPro/GX010001.xmp']);
  assert.equal(result.totalCount, 2); assert.equal(result.mediaCount, 1); assert.equal(result.xmpCount, 1); assert.equal(result.totalSizeMb, 12.5);
  result = h.buildArchiveUploadPreview(['one:media', 'one:xmp'], ['260903_제주여행', '해변식당'], 'travel', '/');
  assert.equal(result.samples[0], '/travel/GoPro/GX010001.MP4'); assert.equal(result.samples.some(path => path.includes('//')), false);
  assert.equal(h.buildArchiveUploadPreview(['one:media'], ['different']).invalidCount, 1);
  h.state.managed.push(...Array.from({ length: 4 }, (_, i) => makeManaged(`extra${i}`, { confirmed: true, eventId: 'child', deviceFolder: 'GoPro', size: i === 3 ? null : 2 })));
  h.render(); const main = h.page.querySelector('main'), checkbox = h.page.querySelector('[data-select="source"]'), button = action(h, 'upload-archive'), count = h.page.querySelector('#source-selection-count');
  change(checkbox, true);
  assert.equal(h.page.querySelector('main'), main); assert.equal(h.page.querySelector('[data-select="source"]'), checkbox); assert.equal(action(h, 'upload-archive'), button); assert.equal(h.page.querySelector('#source-selection-count'), count); assert.equal(count.textContent, '6개 파일 선택');
  result = h.buildArchiveUploadPreview(); assert.equal(result.samples.length, 4); assert.equal(result.remainingCount, 2); assert.equal(result.totalSizeMb, 18.5); assert.equal(result.hasUnknownSize, true);
  assert.match(h.page.querySelector('#archive-preview-slot').textContent, /외 2개 파일/); assert.match(h.page.querySelector('#archive-preview-slot').textContent, /\(\+ XMP\)/);
  h.view.sourcePath = ['260903_제주여행', '해변식당']; h.view.archive = null; h.view.settings = {}; h.render();
  assert.match(h.page.querySelector('#archive-preview-slot').textContent, /선택한 기준 상대 경로/); assert.match(h.page.querySelector('#archive-preview-slot').textContent, /현재 열린 위치.*상대 구조만/); assert.match(h.page.querySelector('#archive-preview-slot').textContent, /연결하면 전송/);
  assert.equal(h.page.querySelectorAll('[data-action="connect-archive"]').length, 1); assert.ok(h.page.querySelector('#archive-preview-slot [href="#settings"]'));
  h.view.sourceSelection.clear(); h.syncSourceSelection(); assert.match(h.page.querySelector('#archive-preview-slot').textContent, /파일이나 폴더를 선택하면/);
});

test('12 Archive auto-connect checks all settings flags and only runs on route entry', async () => {
  const h = createHarness(); route(h, 'archive'); assert.equal(h.fetchCalls.filter(call => call.url.includes('/api/archive')).length, 0);
  h.setFetch(async url => response(url === '/api/settings' ? configured() : remote())); h.loadRoute(); await flushMicrotasks();
  assert.deepEqual(plain(h.fetchCalls.slice(1).map(call => call.url)), ['/api/settings', '/api/archive?path=']); assert.ok(h.view.archive); assert.equal(h.view.archiveAutoConnecting, false);
  for (const flag of Object.keys(configured()).filter(key => key !== 'keyCopied')) assert.equal(h.isStorageConfigured({ ...configured(), [flag]: false }), false);
  const missing = createHarness(); missing.setFetch(async () => response({ addressConfigured: true })); missing.win.location.hash = '#archive'; missing.loadRoute(); await flushMicrotasks();
  assert.equal(missing.fetchCalls.filter(call => call.url.startsWith('/api/archive')).length, 0); assert.match(missing.page.textContent, /스토리지 설정이 필요합니다/); assert.ok(missing.page.querySelector('[href="#settings"]')); assert.equal(missing.view.archiveError, '');
  const exclusive = createHarness(); exclusive.view.settings = configured(); exclusive.state.activeJobs.exclusive = { id: 1, lane: 'exclusive', kind: 'reset-all', status: 'running' }; exclusive.win.location.hash = '#archive'; exclusive.loadRoute(); await flushMicrotasks(); assert.equal(exclusive.view.archiveAutoAttempted, false);
  const unavailable = createHarness(); unavailable.setFetch(async () => { throw new Error('settings unavailable'); }); unavailable.win.location.hash = '#archive'; unavailable.loadRoute(); await flushMicrotasks();
  assert.equal(unavailable.view.archiveError, ''); assert.equal(unavailable.fetchCalls.filter(call => call.url.startsWith('/api/archive')).length, 0); assert.equal(unavailable.view.archiveAutoConnecting, false);
});

test('13 Archive connection survives revisit, bounds failed attempts and invalidates changed settings', async () => {
  const h = createHarness(); h.view.settings = configured(); h.setFetch(async () => response(remote())); h.win.location.hash = '#archive'; h.loadRoute(); await flushMicrotasks();
  h.view.archivePath = 'saved'; const connected = h.view.archive, calls = h.fetchCalls.length;
  h.win.dispatchHashChange('#events'); h.win.dispatchHashChange('#archive'); await flushMicrotasks(); assert.equal(h.view.archive, connected); assert.equal(h.view.archivePath, 'saved'); assert.equal(h.fetchCalls.length, calls);
  for (const name of ['edit-storage-address', 'edit-storage-root', 'reset-host-key']) {
    h.actions[name](); await submit(h, { address: '192.0.2.1', path: '/new' });
    assert.equal(h.view.archive, null); assert.equal(h.view.archivePath, ''); assert.equal(h.view.archiveAutoAttempted, false);
    h.view.settings = configured(); h.loadRoute(); await flushMicrotasks(); assert.ok(h.view.archive);
  }
  h.setFetch(async url => response(url === '/api/devices' ? { devices: [] } : configured()));
  await h.actions['generate-storage-key'](); assert.equal(h.view.archive, null); assert.equal(h.view.archiveAutoAttempted, false);
  h.view.archive = remote(); await h.actions['test-storage-ssh'](); assert.equal(h.view.archive, null);
  route(h, 'settings'); h.view.devices = [];
  h.setFetch(async url => response(url === '/api/settings/ssh-test' ? { status: 'confirm_host', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:test', token: 'once' } : configured()));
  h.view.archive = remote(); await h.actions['test-storage-ssh'](); await submit(h); assert.equal(h.view.archive, null);
  route(h, 'archive');
  h.setFetch(async () => ({ ok: false, status: 502, json: async () => ({ detail: 'NAS offline' }) })); h.resetArchiveConnection(); h.loadRoute(); await flushMicrotasks();
  assert.equal(h.view.archiveError, 'NAS offline'); assert.equal(h.view.archiveAutoAttempted, true); assert.match(action(h, 'connect-archive').textContent, /다시 연결/);
  const failedCalls = h.fetchCalls.length; h.win.dispatchHashChange('#events'); h.win.dispatchHashChange('#archive'); await flushMicrotasks(); assert.equal(h.fetchCalls.length, failedCalls);
  const waiting = createHarness(); let resolve; waiting.setFetch(() => new Promise(done => { resolve = done; })); waiting.win.location.hash = '#archive'; waiting.loadRoute(); waiting.resetArchiveConnection(); resolve(response(configured())); await flushMicrotasks(); assert.equal(waiting.view.archive, null); assert.equal(waiting.view.archiveAutoAttempted, false);
  waiting.view.settings = configured(); let finish; waiting.setFetch(() => new Promise(done => { finish = done; })); const browsing = waiting.browseArchive('old'); waiting.resetArchiveConnection(); finish(response(remote())); await browsing; assert.equal(waiting.view.archive, null);
});

test('14 Settings orders daily names, connection, backup and marked danger area', () => {
  const h = createHarness(); h.view.settings = configured(); h.view.devices = []; route(h, 'settings');
  const sections = h.page.querySelectorAll('.settings-section');
  assert.deepEqual(plain(sections.map(section => section.getAttribute('aria-label'))), ['촬영도구 이름', '스토리지 연결', 'DB 백업 및 복원', '썸네일 캐시', '데이터 초기화']);
  assert.equal(sections[4].classList.contains('settings-danger'), true); assert.equal(sections[4].querySelector('.settings-danger-badge').textContent, '위험 구역');
});
