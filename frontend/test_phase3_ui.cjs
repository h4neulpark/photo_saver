'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Reuse the established five-root DOM fixture without changing protected tests.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', `      chooseEvent, actions, eventLifecycleSummary, savedEventView,
      syncEventSelection, syncSourceSelection, copyTextToClipboard, copyStorageKey, shortHash,`);
fixture = fixture.replace('return { ...api, doc, win,', 'return { ...api, context, doc, win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeManaged, makeIncoming } = vm.runInContext('({ createHarness, flushMicrotasks, makeManaged, makeIncoming })', context);
const plain = value => JSON.parse(JSON.stringify(value));
const response = data => ({ ok: true, status: 200, json: async () => data });
const sha = '0123456789abcdef'.repeat(4);
const event = () => ({ id: 'ev1', name: '여행', folder: '260601_여행', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' });
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);
function route(h, name) { h.view.connecting = false; h.win.location.hash = `#${name}`; h.render(); }
function click(el) { assert.ok(el); el.dispatchEvent({ type: 'click', target: el }); }
function change(el, checked) { assert.ok(el); el.checked = checked; el.dispatchEvent({ type: 'change', target: el }); }
function events(files = [makeManaged('one')], cards = true) {
  const h = createHarness(); h.state.events = [event()]; h.state.managed = files;
  h.view.eventId = 'ev1'; h.view.eventView = cards ? 'cards' : 'table'; route(h, 'events'); return h;
}
function archive() {
  const h = events([makeManaged('one', { confirmed: true })]);
  h.view.archive = { root: '/NAS', path: '', entries: [] }; route(h, 'archive'); return h;
}
function catalog(h, tab, overrides = {}) {
  h.view.catalogTab = tab;
  h.view.catalog = { summary: {}, folders: [], remoteFolders: [], rows: [{ name: 'one.mp4', sha, local_path: 'a/one.mp4', remote_path: 'a/one.mp4', kind: 'video', size: 1000, status: tab === 'remote' ? 'present' : 'available', location: 'managed', outcome: 'uploaded', ...overrides }], total: 1, page: 1, pages: 1 };
  route(h, 'catalog');
}
function fallback(h, success = true) {
  h.context.navigator = {};
  const calls = [];
  h.doc.execCommand = command => {
    const textarea = h.doc.body.querySelector('textarea');
    calls.push({ command, value: textarea.value, readonly: textarea.getAttribute('readonly'), style: textarea.getAttribute('style') });
    assert.equal(h.doc.activeElement, textarea);
    assert.deepEqual(plain(textarea.selectionRange), [0, textarea.value.length]);
    return success;
  };
  const create = h.doc.createElement.bind(h.doc);
  h.doc.createElement = tag => {
    const node = create(tag);
    if (tag === 'textarea') {
      node.select = () => { node.selected = true; };
      node.setSelectionRange = (start, end) => { assert.equal(node.selected, true); node.selectionRange = [start, end]; };
    }
    return node;
  };
  return calls;
}

test('01 eventView defaults to table, persists to localStorage, ignores invalid/same values, and survives storage errors', () => {
  const h = events(undefined, false); assert.equal(h.view.eventView, 'table');
  h.actions['event-view']('invalid'); assert.equal(h.view.eventView, 'table');
  h.actions['event-view']('cards'); h.render();
  assert.equal(h.context.localStorage.getItem('photo-saver-event-view'), 'cards'); assert.equal(h.savedEventView(), 'cards');
  const rows = h.page.querySelector('#event-rows'), img = rows.querySelector('img'); rows.scrollTop = 120;
  h.actions['event-view']('cards'); h.render(); assert.equal(rows.scrollTop, 120); assert.equal(rows.querySelector('img'), img);
  h.context.localStorage.getItem = () => { throw Error('blocked'); }; assert.equal(h.savedEventView(), 'table');
  h.context.localStorage.setItem = () => { throw Error('full'); }; h.actions['event-view']('table'); assert.equal(h.view.eventView, 'table');
  h.actions['event-view']('cards'); h.clearCatalogViews(); assert.equal(h.view.eventView, 'table');
  const clean = createHarness(); clean.actions['event-view']('cards'); clean.clearCatalogViews(); assert.equal(clean.context.localStorage.getItem('photo-saver-event-view'), null);
  clean.context.localStorage.removeItem = () => { throw Error('blocked'); }; assert.doesNotThrow(() => clean.clearCatalogViews());
});

test('02 Events card view renders thumbnail, 44px check container, time button, device, status, XMP badge, and download link', async () => {
  const h = events([makeManaged('one', { xmp: { name: 'one.xmp', title: '여행' }, canDownload: true })]);
  const card = h.page.querySelector('.event-card');
  for (const selector of ['button.thumb[data-card-preview]', '.card-check', '.card-check-box', '.card-time-btn', '.card-device', '.status', '.xmp-badge', '.card-links a']) assert.ok(card.querySelector(selector), selector);
  assert.equal(h.page.querySelector('#event-view-switch [data-value="cards"]').getAttribute('aria-pressed'), 'true');
  assert.equal(card.querySelector('.card-links a').getAttribute('href'), '/api/archive/download?media_id=one');
  const xmp = action(h, 'view-xmp');
  // Real HTMLButtonElement reflects .disabled into its attribute; the base fixture does not.
  Object.defineProperty(xmp, 'disabled', { get() { return this.attributes.has('disabled'); }, set(value) { if (value) this.attributes.set('disabled', ''); else this.attributes.delete('disabled'); } });
  click(xmp); await flushMicrotasks(); assert.equal(h.dialog.open, true); assert.match(h.dialog.textContent, /XMP 정보/); assert.equal(xmp.disabled, false);
});

test('03 Events card view preserves unchanged img nodes across polling, selection, search, status/confirm updates, and reorder', async () => {
  const h = events([makeManaged('one'), makeManaged('two')], false);
  h.actions['event-view']('cards'); h.render();
  const image = h.page.querySelector('[data-item-key="one"] img');
  const same = () => assert.equal(h.page.querySelector('[data-item-key="one"] img'), image);
  h.setFetch(() => response(plain(h.state))); await h.syncState(); same();
  change(h.page.querySelector('[data-select="event"][value="one"]'), true); same(); assert.equal(h.page.querySelector('[data-select="event-all"]').indeterminate, true);
  change(h.page.querySelector('[data-select="event-all"]'), true); same(); assert.equal(h.view.eventSelection.size, 2); assert.equal(h.page.querySelector('[data-select="event-all"]').checked, true);
  h.view.eventQuery = 'one'; h.render(); same(); h.view.eventQuery = ''; h.render(); same();
  h.state.managed[0].reviewReason = '시각 확인'; h.render(); same(); h.state.managed[0].confirmed = true; h.state.managed[0].reviewReason = null; h.render(); same();
  h.state.managed.reverse(); h.render(); same(); assert.equal(h.page.querySelector('#event-cards').children[1].dataset.itemKey, 'one');
});

test('04 Events card view archived files render non-interactive thumb, disable time edit, and keep preview skipping archived', () => {
  const h = events([makeManaged('one'), makeManaged('old', { status: 'archived', confirmed: true, timeVerified: false, canDownload: true }), makeManaged('two')]);
  const old = h.page.querySelector('[data-item-key="old"]');
  assert.equal(old.querySelector('button.thumb'), null); assert.ok(old.querySelector('span.thumb img')); assert.equal(old.querySelector('[data-action="edit-media-time"]'), null);
  assert.match(old.textContent, /아카이브 보관.*로컬 원본 없음/s);
  h.actions['edit-media-time']('old'); h.actions['resolve-time']('old'); assert.equal(h.dialog.open, false);
  h.actions['edit-media-time']('missing'); h.actions['resolve-time']('missing'); assert.equal(h.dialog.open, false);
  h.openManagedPreview('old'); assert.equal(h.mediaPreview.open, false);
  h.openManagedPreview('one'); h.stepPreview(1); assert.equal(h.view.preview.ids[h.view.preview.index], 'two');
  h.closeMediaPreview(); h.actions['event-view']('table'); h.render(); assert.equal(h.page.querySelector('[data-item-key="old"] [data-action="resolve-time"]'), null);
});

test('05 Events card view edit-media-time opens media edit dialog for available files and respects exclusiveActive', async () => {
  const h = events([makeManaged('one', { timeVerified: false })]);
  click(action(h, 'edit-media-time')); await flushMicrotasks(); assert.equal(h.dialog.open, true);
  assert.ok(h.dialog.querySelector('#media-time-mode [value="manual"][selected]')); h.dialog.close();
  h.state.managed[0].timeVerified = true; h.render(); click(action(h, 'edit-media-time')); await flushMicrotasks(); assert.ok(h.dialog.querySelector('#media-time-mode [value="keep"][selected]')); h.dialog.close();
  h.state.activeJobs.exclusive = { id: 1, lane: 'exclusive', kind: 'reset-all', status: 'running' }; h.render(); assert.equal(action(h, 'edit-media-time').disabled, true);
  click(action(h, 'edit-media-time')); await flushMicrotasks(); assert.equal(h.dialog.open, false);
});

test('06 Events card view Delete/Backspace never triggers Incoming delete even with colliding IDs', () => {
  const h = events([makeManaged('same')]); h.state.incoming = [makeIncoming('same')];
  const card = h.page.querySelector('[data-card-preview]');
  for (const key of ['Delete', 'Backspace']) card.dispatchEvent({ type: 'keydown', key, target: card });
  assert.equal(h.mediaPreview.open, false); assert.equal(h.dialog.open, false); assert.equal(h.view.preview, null);
  assert.equal(h.fetchCalls.some(call => call.opts.method === 'DELETE' || call.url.includes('delete')), false);
});

test('07 eventLifecycleSummary partitions draft, confirmed, and archived without double counting', () => {
  const files = [makeManaged('old', { status: 'archived', confirmed: true, archived: true }), makeManaged('done', { confirmed: true, archived: true }), makeManaged('draft'), makeManaged('none', { eventId: null, archived: true })];
  const h = events(files); const s = h.eventLifecycleSummary(files);
  assert.deepEqual(plain(s), { total: 4, draft: 2, confirmed: 1, archived: 1, localArchivedCopy: 2 }); assert.equal(s.draft + s.confirmed + s.archived, s.total);
  h.view.eventId = 'all'; h.render(); assert.match(h.page.querySelector('#event-lifecycle').textContent, /총 4개.*초안 2.*분류 확정 1.*아카이브 보관 1.*NAS 사본 보유 2/s);
  assert.equal(h.page.querySelectorAll('.event-lifecycle-bar span').length, 3);
  h.view.eventQuery = 'done'; h.render(); assert.match(h.page.querySelector('.event-meta').textContent, /1 \/ 4개/); assert.match(h.page.querySelector('#event-lifecycle').textContent, /총 4개/);
  assert.deepEqual(plain(h.eventLifecycleSummary([])), { total: 0, draft: 0, confirmed: 0, archived: 0, localArchivedCopy: 0 }); h.state.managed = []; h.render(); assert.equal(h.page.querySelector('#event-lifecycle'), null);
});

test('08 card-check wraps visual box inside sibling label for both Incoming and Events cards', () => {
  const h = events(); h.state.incoming = [makeIncoming('one')]; h.view.incomingLayout = 'cards';
  for (const name of ['incoming', 'events']) {
    route(h, name); const image = h.page.querySelector('.card-image');
    const thumb = image.querySelector('.thumb-slot'), slot = image.querySelector('.card-check-slot'), label = slot.querySelector('.card-check'), box = label.querySelector('.card-check-box');
    assert.equal(thumb.parentElement, slot.parentElement); assert.equal(box.parentElement, label); assert.equal(box.querySelector('input').parentElement, box); assert.equal(label.closest('button'), null);
  }
  h.view.incomingLayout = 'table'; h.view.eventView = 'table';
  for (const name of ['incoming', 'events']) { route(h, name); assert.equal(h.page.querySelectorAll('.check-hit input').length, 2); }
  const a = archive(); assert.ok(a.page.querySelector('.tree-row .check-hit input'));
  for (const label of a.page.querySelectorAll('label')) assert.equal(label.querySelector('label'), null);
});

test('09 sticky selection bar class syncs on selection, tab switch, clear, and route change', () => {
  const h = events(); h.state.incoming = [makeIncoming('one')]; route(h, 'incoming');
  const active = expected => { assert.equal(h.page.classList.contains('has-sticky-actions'), expected); assert.equal(h.doc.body.classList.contains('has-sticky-actions'), expected); };
  active(false); change(h.page.querySelector('[data-select="incoming"]'), true); active(true);
  h.page.querySelector('#incoming-actions').getBoundingClientRect = () => ({ height: 174 }); h.render(); assert.match(h.notice.getAttribute('style'), /--selection-bar-height: 174px/);
  h.actions['incoming-tab']('xmp'); active(false); h.actions['incoming-tab']('companions'); active(false); h.actions['incoming-tab']('files'); active(true);
  h.actions['clear-incoming-selection'](); h.render(); active(false);
  route(h, 'events'); change(h.page.querySelector('[data-select="event"]'), true); active(true);
  h.actions['clear-event-selection'](); h.render(); active(false); change(h.page.querySelector('[data-select="event"]'), true); active(true);
  route(h, 'archive'); active(false);
});

test('10 Archive page preserves single upload CTA, touch guidance copy, and check-hit checkboxes without forbidden terms', () => {
  const h = archive(); const button = action(h, 'upload-archive'), checkbox = h.page.querySelector('.check-hit input');
  assert.equal(h.page.querySelectorAll('[data-action="upload-archive"]').length, 1);
  assert.match(h.page.textContent, /대상 폴더로 이동한 뒤 업로드를 누르세요/); assert.match(h.page.textContent, /데스크톱에서는 드래그/);
  assert.doesNotMatch(h.page.textContent, /Incoming Library|이벤트 관리|managed로|배치 확정|푸티지|Source|Destination/);
  change(checkbox, true); assert.equal(action(h, 'upload-archive'), button); assert.equal(h.page.querySelector('.check-hit input'), checkbox); assert.equal(button.disabled, false); assert.equal(checkbox.closest('.tree-row').classList.contains('source-selected'), true);
});

test('11 Catalog hash abbreviates to 12 chars with full title and data-value across all 3 tabs', () => {
  const h = createHarness(); assert.equal(h.shortHash('short'), 'short'); assert.equal(h.shortHash(null), '해시 미기록');
  for (const tab of ['files', 'archives', 'remote']) {
    catalog(h, tab); const code = h.page.querySelector('.catalog-hash-code');
    assert.equal(code.textContent, `${sha.slice(0, 12)}…`); assert.equal(code.getAttribute('title'), sha); assert.equal(action(h, 'copy-record-hash').dataset.value, sha);
    catalog(h, tab, { sha: null }); assert.match(h.page.querySelector('.catalog-hash').textContent, /해시 미기록/); assert.equal(action(h, 'copy-record-hash'), null);
  }
});

test('12 Catalog rows include responsive data-label and cell classes across files, archives, and remote tabs', () => {
  const h = createHarness();
  for (const [tab, labels] of [['files', ['파일 / 경로', 'SHA-256', '분류 / 크기', '파일 상태']], ['archives', ['파일 / 경로', 'SHA-256', '아카이브 목적지', '검증 결과 / 시각']], ['remote', ['원격 파일 / 경로', 'SHA-256', '분류 / 크기', '인덱스 상태 / 검증 시각']]]) {
    catalog(h, tab); const cells = h.page.querySelectorAll('.catalog-table tbody td');
    assert.deepEqual(plain(cells.map(cell => cell.dataset.label)), labels); assert.deepEqual(plain(cells.map(cell => cell.getAttribute('class'))), ['catalog-cell-file', 'catalog-cell-hash', 'catalog-cell-meta', 'catalog-cell-status']);
    const wrap = h.page.querySelector('.catalog-table-wrap'); wrap.scrollTop = 120; wrap.scrollLeft = 90; h.render(); assert.equal(h.page.querySelectorAll('.catalog-table-wrap').length, 1); assert.equal(h.page.querySelector('.catalog-table-wrap').scrollTop, 120); assert.equal(h.page.querySelector('.catalog-table-wrap').scrollLeft, 90);
  }
});

test('13 copyTextToClipboard uses navigator.clipboard first and falls back to execCommand on HTTP LAN', async () => {
  const h = createHarness(); const writes = []; h.context.navigator = { clipboard: { writeText: async value => writes.push(value) } };
  await h.actions['copy-record-hash'](sha); assert.deepEqual(writes, [sha]); assert.equal(h.notice.textContent, 'SHA-256을 복사했습니다.');
  catalog(h, 'files'); const focus = action(h, 'copy-record-hash'); focus.focus(); const calls = fallback(h);
  await h.actions['copy-record-hash'](sha); assert.equal(calls[0].command, 'copy'); assert.equal(calls[0].value, sha); assert.equal(calls[0].readonly, ''); assert.match(calls[0].style, /position:fixed/);
  assert.equal(h.doc.body.querySelector('textarea'), null); assert.equal(h.doc.activeElement, focus); assert.equal(focus.focusCalls.at(-1).preventScroll, true);
  h.context.navigator.clipboard = { writeText: async () => { throw Error('denied'); } }; await h.copyTextToClipboard(sha); assert.equal(calls.length, 2);
  fallback(h, false); click(action(h, 'copy-record-hash')); await flushMicrotasks(); assert.match(h.notice.textContent, /클립보드에 복사할 수 없습니다/); assert.equal(h.doc.body.querySelector('textarea'), null);
  delete h.doc.execCommand; await assert.rejects(h.copyTextToClipboard(sha), /클립보드/); await assert.rejects(h.copyTextToClipboard(''), /복사할 내용/);
});

test('14 copyStorageKey also works via HTTP LAN execCommand fallback and preserves keyCopiedLocally on failure', async () => {
  const h = createHarness(); const calls = fallback(h); h.view.publicKeyToCopy = 'ssh-ed25519 public'; h.setFetch(() => response({ keyCopied: true }));
  await h.copyStorageKey(); assert.equal(calls[0].value, 'ssh-ed25519 public'); assert.equal(h.view.keyCopiedLocally, true); assert.equal(h.view.publicKeyToCopy, null); assert.match(h.notice.textContent, /공개키를 복사했습니다/);
  const fail = createHarness(); fallback(fail, false); fail.view.publicKeyToCopy = 'ssh-ed25519 keep';
  await assert.rejects(fail.copyStorageKey(), /클립보드/); assert.equal(fail.view.keyCopiedLocally, false); assert.equal(fail.view.publicKeyToCopy, 'ssh-ed25519 keep'); assert.equal(fail.fetchCalls.some(call => call.url.includes('/copied')), false);
});

const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
// Preserve media-query context rather than flattening nested rules into globals.
function cssRules(source = css, media = '') {
  const rules = []; const re = /([^{}]+)\{/g; let match;
  while ((match = re.exec(source))) {
    const start = re.lastIndex; let depth = 1, end = start;
    while (depth && end < source.length) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
    const selector = match[1].trim(), body = source.slice(start, end - 1);
    if (selector.startsWith('@media')) rules.push(...cssRules(body, selector));
    else rules.push({ selector, body, media });
    re.lastIndex = end;
  }
  return rules;
}
function declaration(selector, property, media = '') {
  const rules = cssRules().filter(rule => rule.media === media && rule.selector.split(/,\s*/).includes(selector));
  const values = rules.flatMap(rule => [...rule.body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].map(match => match[1].trim()));
  assert.ok(values.length, `${media} ${selector} ${property}`); return values.at(-1);
}

test('15 CSS structural regression oracle protects sidebar flex-wrap, 44px touch targets, fixed action bar, catalog card rules, and reduced-motion', () => {
  const mobile = '@media (max-width: 760px)';
  assert.equal(declaration('.sidebar', 'flex-wrap', mobile), 'wrap'); assert.equal(declaration('.sidebar-footer', 'position', mobile), 'static'); assert.equal(declaration('.nav-link', 'min-height', mobile), '44px');
  for (const prop of ['width', 'height']) assert.equal(declaration('.card-check', prop), '44px');
  assert.equal(declaration('.action-bar.has-selection', 'position', mobile), 'fixed'); assert.match(declaration('.action-bar.has-selection', 'padding', mobile), /env\(safe-area-inset-bottom/); assert.equal(declaration('.notice', 'z-index'), '30');
  assert.equal(declaration('.catalog-table-wrap .catalog-table', 'min-width', mobile), '0'); assert.equal(declaration('.catalog-table tbody', 'display', mobile), 'grid'); assert.match(declaration('.catalog-table td::before', 'content', mobile), /attr\(data-label\)/);
  assert.equal(declaration('*', 'transition-duration', '@media (prefers-reduced-motion: reduce)'), '.01ms !important'); assert.equal(declaration('*', 'scroll-behavior', '@media (prefers-reduced-motion: reduce)'), 'auto !important');
});

test('16 Protected folder tree CSS and five-root index.html contract remain intact', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  for (const id of ['navigation', 'page', 'notice', 'media-preview', 'dialog']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  const protectedSelectors = ['.catalog-folder-list', '.catalog-folder', '.catalog-folder-row', '.catalog-folder-row > .catalog-folder', '.catalog-folder-toggle', '.catalog-folder-spacer', '.catalog-folder > svg', '.catalog-folder-count', '.catalog-folder-label', '.event-link', '.event-link.child'];
  for (const rule of cssRules().filter(rule => rule.media)) {
    for (const selector of rule.selector.split(/,\s*/)) {
      if (!protectedSelectors.includes(selector)) continue;
      assert.equal(rule.media, '@media (max-width: 550px)'); assert.equal(selector, '.catalog-folder-list'); assert.equal(rule.body.trim(), 'max-height: 220px;');
    }
  }
  assert.equal(declaration('.catalog-folder-list', '--folder-indent'), '16px'); assert.equal(declaration('.catalog-folder-list', '--folder-toggle-width'), '21px'); assert.equal(declaration('.catalog-folder-list', 'overflow'), 'auto');
  assert.equal(declaration('.catalog-folder-row', 'padding-left'), 'calc(var(--folder-depth, 0) * var(--folder-indent))'); assert.equal(declaration('.event-link.child', 'padding-left'), '28px');
});
