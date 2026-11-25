'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Share the protected five-root FakeDOM fixture; document has no addEventListener.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, filteredEventFiles, eventLifecycleSummary, matchesEventLifecycle, hasActiveEventFilters,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks, makeManaged, makeIncoming } = vm.runInContext('({ createHarness, flushMicrotasks, makeManaged, makeIncoming })', context);
const plain = value => JSON.parse(JSON.stringify(value));
const root = () => ({ id: 'ev1', name: '여행', folder: '260601_여행', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' });
const child = () => ({ id: 'child', name: '해변', folder: '해변', parent: 'ev1' });
const response = data => ({ ok: true, status: 200, json: async () => data });
const action = (h, name) => h.page.querySelector(`[data-action="${name}"]`);
const chip = (h, value) => h.page.querySelector(`[data-action="event-lifecycle"][data-value="${value}"]`);
function route(h, name) { h.view.connecting = false; h.win.location.hash = `#${name}`; h.render(); }
function events(files = [makeManaged('one'), makeManaged('two')]) {
  const h = createHarness(); h.state.events = [root(), child()]; h.state.managed = files;
  h.view.eventId = 'ev1'; route(h, 'events'); return h;
}
function click(el) { assert.ok(el); return el.dispatchEvent({ type: 'click', target: el }); }
function key(el, name) { assert.ok(el); return el.dispatchEvent({ type: 'keydown', key: name, target: el }); }
function select(el, checked) { assert.ok(el); el.checked = checked; el.dispatchEvent({ type: 'change', target: el }); }
function menuOpen(h, expected) {
  assert.equal(h.view.eventMenuOpen, expected);
  assert.equal(h.page.querySelector('#event-menu-toggle').getAttribute('aria-expanded'), String(expected));
  assert.equal(h.page.querySelector('#event-menu-panel').hidden, !expected);
}

test('01 Events hides idle selection bar but preserves disabled controls and measures sticky notices', () => {
  const h = events(), bar = h.page.querySelector('#event-actions');
  assert.equal(bar.hidden, true); assert.equal(bar.querySelector('.action-bar-idle'), null);
  for (const name of ['move-event', 'edit-media', 'offload-media', 'confirm-event']) assert.equal(action(h, name).disabled, true);
  assert.equal(h.page.querySelector('#move-event-target').disabled, true);
  assert.equal(bar.querySelectorAll('.action-bar-buttons').length, 2);
  for (const group of bar.querySelectorAll('.action-bar-buttons')) assert.equal(group.hidden, true);
  select(h.page.querySelector('[data-select="event"]'), true);
  assert.equal(bar.hidden, false); assert.equal(bar.classList.contains('has-selection'), true);
  assert.equal(h.doc.body.classList.contains('has-event-sticky-actions'), true);
  bar.getBoundingClientRect = () => ({ height: 152 }); h.render();
  assert.match(h.notice.getAttribute('style'), /--selection-bar-height: 152px/);
  h.actions['clear-event-selection'](); assert.equal(bar.hidden, true);
  assert.equal(h.doc.body.classList.contains('has-event-sticky-actions'), false);
});

test('02 Incoming keeps its idle guide, view labels and selection behavior across route changes', () => {
  const h = events(); select(h.page.querySelector('[data-select="event"]'), true);
  h.state.incoming = [makeIncoming('photo')]; route(h, 'incoming');
  assert.equal(h.doc.body.classList.contains('has-event-sticky-actions'), false);
  const bar = h.page.querySelector('#incoming-actions');
  assert.equal(bar.hidden, false); assert.ok(bar.querySelector('.action-bar-idle'));
  assert.match(h.page.querySelector('#incoming-view-switch').textContent, /표 보기.*카드 보기/s);
  select(h.page.querySelector('[data-select="incoming"]'), true);
  assert.equal(bar.classList.contains('has-selection'), true);
  assert.equal(h.doc.body.classList.contains('has-sticky-actions'), true);
  assert.equal(h.doc.body.classList.contains('has-event-sticky-actions'), false);
  h.actions['clear-incoming-selection'](); assert.equal(bar.classList.contains('has-selection'), false);
  route(h, 'events'); assert.equal(h.page.querySelector('#event-actions').hidden, false);
});

test('03 Create lives only in the left panel and zero events offers onboarding and a primary action', async () => {
  const h = events();
  assert.equal(h.page.querySelectorAll('[data-action="new-event"]').length, 1);
  const create = action(h, 'new-event'); assert.ok(create.closest('#event-sidebar-head'));
  assert.equal(create.getAttribute('aria-label'), '이벤트 생성'); assert.equal(create.getAttribute('title'), '이벤트 생성');
  assert.equal(create.classList.contains('primary'), false); assert.equal(h.page.querySelector('#events-header button'), null);
  assert.equal(h.page.querySelector('.event-list-empty'), null);
  h.state.events = []; h.chooseEvent('unassigned'); h.render();
  assert.ok(h.page.querySelector('[data-action="choose-event"][data-value="all"]'));
  assert.ok(h.page.querySelector('[data-action="choose-event"][data-value="unassigned"]'));
  assert.match(h.page.querySelector('.event-list-empty').textContent, /아직 이벤트가 없습니다.*\+ 생성/s);
  assert.equal(action(h, 'new-event').classList.contains('primary'), true);
  click(action(h, 'new-event')); await flushMicrotasks(); assert.equal(h.dialog.open, true);
});

test('04 Header menu groups root/child actions and disappears for all and unassigned', () => {
  const h = events();
  assert.ok(action(h, 'collect').closest('#event-header-actions'));
  assert.equal(h.page.querySelector('#event-tools-actions'), null);
  const trigger = h.page.querySelector('#event-menu-toggle');
  assert.equal(trigger.getAttribute('aria-label'), '이벤트 작업 더 보기'); assert.equal(trigger.getAttribute('title'), '더 보기');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu'); assert.equal(trigger.getAttribute('aria-controls'), 'event-menu-panel');
  assert.equal(trigger.querySelectorAll('circle').length, 3);
  assert.equal(h.page.querySelector('#event-menu-panel').getAttribute('role'), 'menu');
  for (const name of ['new-child', 'edit-event', 'delete-event']) assert.ok(action(h, name).closest('#event-menu-panel'));
  assert.ok(h.page.querySelector('#event-menu-panel [role="separator"]'));
  h.chooseEvent('child'); h.render();
  assert.equal(action(h, 'collect'), null); assert.equal(action(h, 'new-child'), null);
  assert.equal(h.page.querySelector('#event-menu-toggle').getAttribute('aria-label'), '소분류 작업 더 보기');
  assert.equal(action(h, 'edit-event').textContent, '소분류 수정'); assert.equal(action(h, 'delete-event').textContent, '소분류 삭제');
  for (const id of ['all', 'unassigned']) {
    h.chooseEvent(id); h.view.eventMenuOpen = true; h.render();
    assert.equal(h.page.querySelector('#event-header-actions').hidden, true);
    assert.equal(h.page.querySelector('#event-header-actions').textContent, ''); assert.equal(h.view.eventMenuOpen, false);
    assert.equal(h.page.querySelector('#event-menu'), null);
  }
});

test('05 Menu toggles synchronously and closes outside, on Escape, event switch and route change', async () => {
  const h = events(), trigger = h.page.querySelector('#event-menu-toggle'); menuOpen(h, false);
  trigger.focus(); click(trigger); menuOpen(h, true); assert.equal(trigger.disabled, false);
  click(trigger); menuOpen(h, false); click(trigger); click(h.page.querySelector('#event-menu-panel')); menuOpen(h, true);
  click(h.page.querySelector('#event-search')); menuOpen(h, false);
  click(trigger); key(h.page.querySelector('[role="menuitem"]'), 'Escape'); menuOpen(h, false); assert.equal(h.doc.activeElement, trigger);
  click(trigger); h.chooseEvent('child'); h.render(); menuOpen(h, false);
  click(h.page.querySelector('#event-menu-toggle')); route(h, 'incoming'); assert.equal(h.view.eventMenuOpen, false);
  route(h, 'events'); menuOpen(h, false);
  click(h.page.querySelector('#event-menu-toggle')); h.state.events = []; h.render(); assert.equal(h.view.eventMenuOpen, false);
  await flushMicrotasks();
});

test('06 Escape leaves the menu alone while either modal is open', () => {
  const h = events(); click(h.page.querySelector('#event-menu-toggle'));
  for (const modal of [h.dialog, h.mediaPreview]) {
    modal.open = true; key(h.page.querySelector('#event-menu-toggle'), 'Escape'); menuOpen(h, true); modal.open = false;
  }
  key(h.page.querySelector('#event-menu-toggle'), 'Escape'); menuOpen(h, false);
});

test('07 Menu ArrowDown/ArrowUp wrap, Home/End focus edges, Tab closes without trapping focus', () => {
  const h = events(), trigger = h.page.querySelector('#event-menu-toggle');
  const items = h.page.querySelectorAll('#event-menu-panel [role="menuitem"]');
  assert.equal(key(trigger, 'ArrowDown'), false); menuOpen(h, true); assert.equal(h.doc.activeElement, items[0]);
  key(items[0], 'ArrowUp'); assert.equal(h.doc.activeElement, items[2]);
  key(items[2], 'ArrowDown'); assert.equal(h.doc.activeElement, items[0]);
  key(items[0], 'End'); assert.equal(h.doc.activeElement, items[2]);
  key(items[2], 'Home'); assert.equal(h.doc.activeElement, items[0]);
  key(items[0], 'ArrowDown'); assert.equal(h.doc.activeElement, items[1]);
  assert.equal(key(items[1], 'Tab'), true); menuOpen(h, false);
  key(trigger, 'ArrowUp'); assert.equal(h.doc.activeElement, items[2]); menuOpen(h, true);
  items[1].disabled = true; key(items[0], 'ArrowDown'); assert.equal(h.doc.activeElement, items[2]);
});

test('08 Each menu action closes before opening its corresponding dialog', async () => {
  for (const id of ['ev1', 'child']) {
    for (const name of id === 'ev1' ? ['new-child', 'edit-event', 'delete-event'] : ['edit-event', 'delete-event']) {
      const h = events(); h.chooseEvent(id); h.render(); click(h.page.querySelector('#event-menu-toggle'));
      click(action(h, name)); await flushMicrotasks(); menuOpen(h, false); assert.equal(h.dialog.open, true, `${id}: ${name}`);
    }
  }
});

test('09 Polls, selection, filters and count updates retain open menu DOM and focused item', async () => {
  const h = events(); click(h.page.querySelector('#event-menu-toggle'));
  const menu = h.page.querySelector('#event-menu'), panel = h.page.querySelector('#event-menu-panel'), item = action(h, 'edit-event'); item.focus();
  const same = () => { assert.equal(h.page.querySelector('#event-menu'), menu); assert.equal(h.page.querySelector('#event-menu-panel'), panel); assert.equal(h.doc.activeElement, item); menuOpen(h, true); };
  h.setFetch(() => response(plain(h.state))); await h.syncState(); same();
  select(h.page.querySelector('[data-select="event"]'), true); same();
  h.state.managed.push(makeManaged('three', { confirmed: true })); h.render(); same();
  h.actions['event-lifecycle']('confirmed'); h.render(); same();
  h.view.eventQuery = 'absent'; h.render(); same();
});

test('10 Exclusive jobs disable all mutating menu actions and keyboard navigation skips them', async () => {
  const h = events(); h.state.activeJobs.exclusive = { id: 1, kind: 'reset-all', lane: 'exclusive', status: 'running' }; h.render();
  assert.equal(action(h, 'new-event').disabled, true); assert.equal(action(h, 'collect').disabled, true);
  const trigger = h.page.querySelector('#event-menu-toggle'); trigger.focus(); key(trigger, 'ArrowDown'); menuOpen(h, true);
  assert.equal(h.doc.activeElement, trigger);
  for (const name of ['new-child', 'edit-event', 'delete-event']) {
    assert.equal(action(h, name).disabled, true); click(action(h, name)); await flushMicrotasks(); assert.equal(h.dialog.open, false);
  }
  h.state.activeJobs.exclusive = null; h.render(); key(h.page.querySelector('#event-menu-toggle'), 'ArrowUp');
  assert.equal(h.doc.activeElement, action(h, 'delete-event'));
});

test('11 Lifecycle chips exactly partition statuses, retain unfiltered counts and toggle selected chips off', async () => {
  const files = [makeManaged('draft'), makeManaged('copy', { archived: true }), makeManaged('done', { confirmed: true, archived: true }), makeManaged('old', { confirmed: true, status: 'archived', archived: true }), makeManaged('old-draft', { status: 'archived' })];
  const h = events(files), summary = h.eventLifecycleSummary(files);
  assert.equal(h.view.eventLifecycle, 'all'); assert.equal(h.page.querySelector('#event-storage'), null);
  for (const [value, expected] of [['all', 5], ['draft', 2], ['confirmed', 1], ['archived', 2]]) {
    assert.equal(files.filter(file => h.matchesEventLifecycle(file, value)).length, expected);
    assert.equal(value === 'all' ? summary.total : summary[value], expected);
    h.view.eventSelection.add('draft'); click(chip(h, value)); await flushMicrotasks();
    assert.equal(h.page.querySelectorAll('#event-rows [data-item-key]').length, expected);
    assert.equal(chip(h, value).getAttribute('aria-pressed'), 'true');
    if (value !== 'all') assert.equal(h.view.eventSelection.size, 0);
    assert.match(h.page.querySelector('#event-lifecycle').textContent, /전체 5.*초안 2.*분류 확정 1.*아카이브 보관 2.*NAS 사본 보유 2/s);
    assert.equal(h.page.querySelectorAll('.event-lifecycle-bar .is-dimmed').length, value === 'all' ? 0 : 2);
    if (value !== 'all') { click(chip(h, value)); await flushMicrotasks(); assert.equal(h.view.eventLifecycle, 'all'); }
  }
  h.view.eventSelection.add('draft'); h.actions['event-lifecycle']('invalid'); assert.equal(h.view.eventLifecycle, 'all'); assert.equal(h.view.eventSelection.size, 1);
  h.chooseEvent('child'); assert.equal(h.view.eventLifecycle, 'all'); assert.equal(h.view.eventSelection.size, 0);
});

test('12 Lifecycle combines with device, date and search; empty results reset every filter and selection', async () => {
  const h = events([makeManaged('draft'), makeManaged('done', { confirmed: true, device: 'GoPro' })]);
  h.actions['event-lifecycle']('confirmed'); h.view.eventDevice = 'device:GoPro'; h.view.eventDate = '2026-06-01'; h.view.eventQuery = 'done'; h.render();
  assert.equal(h.filteredEventFiles(h.state.managed).length, 1);
  assert.match(h.page.querySelector('#event-lifecycle').textContent, /전체 2.*초안 1.*분류 확정 1/s);
  h.view.eventQuery = 'absent'; h.view.eventSelection.add('done'); h.render();
  assert.match(h.page.querySelector('#event-rows').textContent, /조건에 맞는 사진·영상이 없습니다/);
  assert.equal(h.page.querySelector('#event-card-select-all').hidden, true);
  click(action(h, 'reset-event-filters')); await flushMicrotasks();
  assert.equal(h.hasActiveEventFilters(), false); assert.equal(h.view.eventSelection.size, 0);
  assert.equal(h.view.eventLifecycle, 'all');
  for (const id of ['event-search', 'event-device', 'event-date']) assert.equal(h.page.querySelector(`#${id}`).value, '');
  assert.equal(h.page.querySelectorAll('#event-rows [data-item-key]').length, 2);
  // Each individual filter also supplies a reset action when the event itself is empty.
  h.state.managed = [];
  for (const [name, value] of [['eventLifecycle', 'draft'], ['eventDevice', 'missing'], ['eventDate', '2026-06-01'], ['eventQuery', 'x']]) {
    h.actions['reset-event-filters'](); h.view[name] = value; h.render(); assert.ok(action(h, 'reset-event-filters'));
  }
  h.actions['reset-event-filters'](); h.render(); assert.equal(action(h, 'reset-event-filters'), null);
  assert.match(h.page.querySelector('#event-rows').textContent, /상단의 기간으로 모으기/);
  h.chooseEvent('child'); h.render(); assert.doesNotMatch(h.page.querySelector('#event-rows').textContent, /기간으로 모으기/);
});

test('13 Icon view switch keeps accessible names and a single select-all synced across table/card transitions', async () => {
  const h = events();
  for (const [value, label] of [['table', '표 보기'], ['cards', '카드 보기']]) {
    const toggle = h.page.querySelector(`#event-view-switch [data-value="${value}"]`);
    assert.equal(toggle.textContent.trim(), ''); assert.equal(toggle.getAttribute('aria-label'), label); assert.equal(toggle.getAttribute('title'), label); assert.ok(toggle.querySelector('svg'));
  }
  select(h.page.querySelector('[data-select="event"]'), true);
  for (const mode of ['cards', 'table', 'cards']) {
    click(h.page.querySelector(`#event-view-switch [data-value="${mode}"]`)); await flushMicrotasks();
    assert.equal(h.page.querySelectorAll('[data-select="event-all"]').length, 1);
    const all = h.page.querySelector('[data-select="event-all"]'); assert.equal(all.indeterminate, true); assert.equal(all.checked, false);
    assert.equal(h.page.querySelector('#event-card-select-all').hidden, mode !== 'cards');
    if (mode === 'cards') { assert.ok(all.closest('.event-tools-end')); assert.equal(h.page.querySelector('#event-rows .card-select-all'), null); assert.equal(h.page.querySelector('#event-rows').children.length, 1); }
    else assert.ok(all.closest('thead'));
  }
  select(h.page.querySelector('[data-select="event-all"]'), true);
  let all = h.page.querySelector('[data-select="event-all"]'); assert.equal(all.checked, true); assert.equal(all.indeterminate, false); assert.equal(h.view.eventSelection.size, 2);
  h.actions['event-view']('table'); h.render(); all = h.page.querySelector('[data-select="event-all"]'); assert.equal(all.checked, true); assert.equal(all.indeterminate, false);
  select(all, false); assert.equal(h.view.eventSelection.size, 0); assert.equal(all.checked, false); assert.equal(all.indeterminate, false);
  h.actions['event-view']('cards'); h.render(); h.view.eventQuery = 'absent'; h.render();
  assert.equal(h.page.querySelectorAll('[data-select="event-all"]').length, 0); assert.equal(h.page.querySelector('#event-card-select-all').hidden, true);
  h.view.eventQuery = ''; h.render(); assert.equal(h.page.querySelectorAll('[data-select="event-all"]').length, 1);
});

test('14 Rendered event labels and hidden assistive copy exclude forbidden terms', () => {
  const h = events();
  for (const id of ['ev1', 'child', 'all', 'unassigned']) {
    h.chooseEvent(id); h.render();
    assert.doesNotMatch(h.page.textContent, /Incoming Library|이벤트 관리|managed로|배치 확정|푸티지|Source|Destination/);
  }
});

const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
function cssRules(source = css, media = '') {
  const rules = [], re = /([^{}]+)\{/g; let match;
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

test('15 CSS preserves desktop sticky/sidebar/menu layers and mobile fixed/touch contracts', () => {
  const desktop = '@media (min-width: 761px)', mobile = '@media (max-width: 760px)';
  assert.equal(declaration('.event-sidebar', 'position'), 'sticky'); assert.equal(declaration('.event-sidebar', 'top'), '20px'); assert.equal(declaration('.event-sidebar', 'max-height'), 'calc(100dvh - 40px)');
  assert.equal(declaration('.event-sidebar', 'position', mobile), 'static'); assert.equal(declaration('.event-sidebar', 'max-height', mobile), 'none');
  assert.equal(declaration('.event-list', 'overflow-y'), 'auto'); assert.equal(declaration('.event-list', 'max-height', mobile), '112px');
  assert.equal(declaration('.event-content', 'overflow'), 'visible'); assert.equal(declaration('#event-actions[hidden]', 'display'), 'none');
  assert.equal(declaration('#event-actions.has-selection', 'position', desktop), 'sticky'); assert.equal(declaration('#event-actions.has-selection', 'bottom', desktop), '0'); assert.equal(declaration('#event-actions.has-selection', 'z-index', desktop), '20');
  assert.match(declaration('body.has-event-sticky-actions .notice', 'bottom', desktop), /var\(--selection-bar-height, 0px\)/);
  assert.equal(declaration('.event-menu-panel', 'z-index'), '25'); assert.equal(declaration('.event-sidebar', 'z-index'), '5'); assert.equal(declaration('.notice', 'z-index'), '30');
  assert.equal(declaration('.event-menu-item:hover:not(:disabled)', 'background'), '#f0f4fb');
  assert.equal(declaration('.event-menu-item.danger:not(:disabled)', 'color'), 'var(--red)');
  assert.equal(declaration('.event-menu-item.danger:not(:disabled):hover', 'background'), 'var(--red-soft)');
  assert.equal(declaration('.event-menu-item:disabled', 'background'), '#e8edf4');
  // Danger and hover rules must never override the disabled appearance.
  for (const rule of cssRules()) {
    for (const selector of rule.selector.split(/,\s*/)) {
      if (selector.includes('.event-menu-item') && /\.danger|:hover/.test(selector)) assert.ok(selector.includes(':not(:disabled)'), selector);
    }
  }
  assert.equal(declaration('.action-bar.has-selection', 'position', mobile), 'fixed'); assert.equal(declaration('.action-bar.has-selection', 'z-index', mobile), '20');
  for (const selector of ['.event-menu-trigger', '.event-menu-item', '.lifecycle-chip', '.toolbar-select-all', '.view-switch-icon .filter.icon-only']) assert.equal(declaration(selector, 'min-height', mobile), '44px');
  for (const selector of ['.event-menu-trigger', '.view-switch-icon .filter.icon-only']) assert.equal(declaration(selector, 'min-width', mobile), '44px');
  assert.equal(declaration('.event-header-actions', 'width', '@media (max-width: 550px)'), '100%');
  for (const rule of cssRules().filter(rule => rule.media)) assert.doesNotMatch(rule.selector, /\.event-link/);
});
