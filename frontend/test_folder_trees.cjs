'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Share the existing DOM fixture without running its tests or modifying it.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, catalogFolderTree,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', context);

// Parse declarations from the real stylesheet; calculated coordinates below are
// a structural regression oracle, complemented by real Chrome measurements.
const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) => {
  const declarations = Object.fromEntries(body.split(';').filter(item => item.trim()).map(item => {
    const colon = item.indexOf(':');
    return [item.slice(0, colon).trim(), item.slice(colon + 1).trim().replace(/\s+/g, ' ')];
  }));
  return selectors.trim().split(/,\s*/).map(selector => ({ selector, declarations }));
});
function rule(selector) {
  const matches = rules.filter(item => item.selector === selector);
  assert.ok(matches.length, `missing CSS rule ${selector}`);
  return Object.assign({}, ...matches.map(item => item.declarations));
}
function px(value) {
  assert.match(value, /^\d+(?:\.\d+)?px$/);
  return Number.parseFloat(value);
}
function paddingLeft(declarations) {
  if (declarations['padding-left']) return px(declarations['padding-left']);
  const parts = declarations.padding.split(' ');
  return px(parts[3] || parts[1] || parts[0]);
}
const indent = px(rule('.catalog-folder-list')['--folder-indent']);
const slotWidth = px(rule('.catalog-folder-list')['--folder-toggle-width']);
const buttonPadding = paddingLeft(rule('.catalog-folder'));

function remoteNode(name, children = [], parent = '') {
  const folderPath = [parent, name].filter(Boolean).join('/');
  return { name, path: folderPath, count: 1, children: children.map(child => remoteNode(child.name, child.children, folderPath)) };
}
function catalogData() {
  return {
    summary: { files: 20, attempts: 30, hashes: 20, verified: 10, failed: 0, remoteTotal: 10, remotePresent: 10, remoteOnly: 0, remoteMissing: 0 },
    remoteRootCount: 1,
    remoteFolders: [
      remoteNode('261030_고프로백업', [{ name: '100GOPRO' }]),
      remoteNode('260903_나고야', [{ name: '고프로' }, { name: '댄아이폰' }]),
      remoteNode('260801_단일폴더'),
      remoteNode('260701_깊은폴더', [{ name: 'sub', children: [{ name: 'leaf' }] }]),
    ],
    folders: [
      { id: 'event', parent_id: null, name: '상위 이벤트', count: 2, devices: [{ name: '직속 장비', count: 1 }] },
      { id: 'sub', parent_id: 'event', name: '소분류', count: 1, devices: [{ name: '소분류 장비', count: 1 }] },
      // Missing devices is also a valid leaf.
      { id: 'single', parent_id: null, name: '리프 이벤트', count: 1 },
    ],
    unassigned: 1,
    rows: [{ name: 'fixture.mp4', local_path: 'fixture.mp4', remote_path: 'fixture.mp4', kind: 'video', size: 1000, status: 'available', outcome: 'uploaded' }],
    total: 1, page: 1, pages: 1,
  };
}
function ready(tab, data = catalogData()) {
  const h = createHarness();
  h.view.connecting = false;
  h.view.catalogTab = tab;
  h.view.catalog = data;
  const expand = folders => {
    for (const folder of folders) {
      h.view.catalogRemoteExpanded.add(folder.path);
      expand(folder.children || []);
    }
  };
  expand(data.remoteFolders);
  for (const folder of data.folders) h.view.catalogExpanded.add(folder.id);
  h.win.location.hash = '#catalog';
  h.render();
  h.setFetch(async url => {
    assert.match(url, /^\/api\/catalog\?/);
    return { ok: true, status: 200, json: async () => data };
  });
  return h;
}
function folderButton(h, label) {
  const button = h.page.querySelectorAll('.catalog-folder').find(item => item.querySelector('.catalog-folder-label')?.textContent === label);
  assert.ok(button, `missing folder ${label}`);
  return button;
}
function coordinates(button) {
  const row = button.parentElement;
  if (!row.classList.contains('catalog-folder-row')) return { icon: buttonPadding, button: 0 };
  const match = row.getAttribute('style').match(/^--folder-depth:(\d+)$/);
  assert.ok(match, 'depth belongs on the row');
  assert.equal(button.getAttribute('style'), null, 'button must not indent a second time');
  const depth = Number(match[1]);
  return { depth, slot: depth * indent, button: depth * indent + slotWidth, icon: depth * indent + slotWidth + buttonPadding };
}
function assertTree(h, rootLabel, expected) {
  const list = h.page.querySelector('.catalog-folder-list');
  const root = folderButton(h, rootLabel);
  assert.equal(root.parentElement, list);
  assert.equal(coordinates(root).icon, 7);
  assert.equal(list.querySelectorAll('.catalog-folder').length, expected.length + 1);
  assert.equal(list.querySelectorAll('.catalog-folder-row').length, expected.length);
  for (const [label, depth, expandable] of expected) {
    const button = folderButton(h, label);
    const row = button.parentElement;
    assert.ok(row.classList.contains('catalog-folder-row'), `${label} needs a row`);
    assert.equal(row.children.length, 2);
    assert.equal(row.children[1], button);
    const lead = row.children[0];
    assert.ok(lead.classList.contains(expandable ? 'catalog-folder-toggle' : 'catalog-folder-spacer'), label);
    assert.equal(lead.tagName, expandable ? 'BUTTON' : 'SPAN');
    if (!expandable) assert.equal(lead.getAttribute('aria-hidden'), 'true');
    const actual = coordinates(button);
    assert.equal(actual.depth, depth, label);
    assert.equal(actual.slot, 16 * depth, label);
    assert.equal(actual.button, 16 * depth + 21, label);
    assert.equal(actual.icon, 16 * depth + 28, label);
  }
}
async function click(h, control) {
  h.page.dispatchEvent({ type: 'click', target: control });
  await flushMicrotasks();
}

test('folder CSS reserves equal slots and applies exactly one depth offset', () => {
  assert.equal(indent, 16);
  assert.equal(slotWidth, 21);
  assert.ok(indent > 0 && slotWidth > 0);
  assert.equal(rule('.catalog-folder-row')['padding-left'], 'calc(var(--folder-depth, 0) * var(--folder-indent))');
  assert.equal(buttonPadding, 7);
  for (const item of rules.filter(item => item.selector.startsWith('.catalog-folder'))) {
    if (item.selector !== '.catalog-folder-row') {
      for (const [property, value] of Object.entries(item.declarations)) {
        if (property.startsWith('padding')) assert.doesNotMatch(value, /--folder-depth/, item.selector);
      }
    }
  }
  for (const selector of ['.catalog-folder-toggle', '.catalog-folder-spacer']) {
    assert.equal(rule(selector).flex, '0 0 var(--folder-toggle-width)');
    assert.equal(rule(selector).width, 'var(--folder-toggle-width)');
  }
  assert.equal(rule('.catalog-folder-toggle').padding, '0');
  assert.equal(rule('.catalog-folder-row > .catalog-folder').width, 'auto');
  assert.equal(rule('.catalog-folder-row > .catalog-folder').flex, '1 1 0');
  assert.equal(rule('.catalog-folder-row > .catalog-folder')['min-width'], '84px');
  assert.equal(rule('.catalog-folder-list').overflow, 'auto');
  for (const selector of ['.catalog-folder > svg', '.catalog-folder-count']) assert.equal(rule(selector).flex, '0 0 auto');
  assert.equal(rule('.catalog-folder-count')['font-variant-numeric'], 'tabular-nums');
  const label = rule('.catalog-folder-label');
  assert.equal(label.flex, '1 1 0');
  assert.equal(label['min-width'], '0');
  assert.equal(label.overflow, 'hidden');
  assert.equal(label['text-overflow'], 'ellipsis');
  assert.equal(label['white-space'], 'nowrap');
});

test('remote root files, branches and leaves align through three levels', () => {
  const h = ready('remote');
  assertTree(h, '전체 원격 파일', [
    ['루트 직속 파일', 0, false], ['261030_고프로백업', 0, true], ['100GOPRO', 1, false],
    ['260903_나고야', 0, true], ['고프로', 1, false], ['댄아이폰', 1, false],
    ['260801_단일폴더', 0, false], ['260701_깊은폴더', 0, true], ['sub', 1, true], ['leaf', 2, false],
  ]);
  assert.equal(coordinates(folderButton(h, '100GOPRO')).button, coordinates(folderButton(h, 'sub')).button);
});

for (const tab of ['files', 'archives']) {
  test(`${tab}: events, subcategories and device leaves align through three levels`, () => {
    const h = ready(tab);
    assertTree(h, '전체 파일', [
      ['미배정', 0, false], ['상위 이벤트', 0, true], ['리프 이벤트', 0, false],
      ['소분류', 1, true], ['직속 장비', 1, false], ['소분류 장비', 2, false],
    ]);
    const parent = coordinates(folderButton(h, '상위 이벤트'));
    const child = coordinates(folderButton(h, '소분류'));
    assert.equal(child.slot - parent.slot, 16);
    assert.equal(child.icon - parent.icon, 16);
    assert.equal(child.button, coordinates(folderButton(h, '직속 장비')).button);
    assert.equal(folderButton(h, '전체 파일').querySelector('.catalog-folder-count').textContent, tab === 'files' ? '20' : '30');
  });
}

for (const [tab, action, value, label] of [
  ['remote', 'toggle-remote-folder', '260701_깊은폴더', '260701_깊은폴더'],
  ['files', 'toggle-catalog-folder', 'event', '상위 이벤트'],
  ['archives', 'toggle-catalog-folder', 'event', '상위 이벤트'],
]) {
  test(`${tab}: click toggles accessible expansion and restores focus and scroll`, async () => {
    const h = ready(tab);
    const toggle = () => h.page.querySelector(`[data-action="${action}"][data-value="${value}"]`);
    const childList = () => folderButton(h, label).parentElement.parentElement.children.find(item => item.tagName === 'UL');
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.ok(childList());
    assert.match(toggle().getAttribute('aria-label'), /하위 폴더 접기$/);
    const original = toggle();
    original.focus();
    h.page.querySelector('.catalog-folder-list').scrollTop = 71;
    h.page.querySelector('.catalog-table-wrap').scrollTo(23, 91);
    await click(h, original);
    assert.equal(toggle().getAttribute('aria-expanded'), 'false');
    assert.match(toggle().getAttribute('aria-label'), /하위 폴더 펼치기$/);
    assert.equal(childList(), undefined);
    assert.equal(h.doc.activeElement, toggle());
    assert.notEqual(toggle(), original);
    assert.equal(h.page.querySelector('.catalog-folder-list').scrollTop, 71);
    assert.equal(h.page.querySelector('.catalog-table-wrap').scrollTop, 91);
    assert.equal(h.page.querySelector('.catalog-table-wrap').scrollLeft, 23);
    await click(h, toggle());
    assert.equal(toggle().getAttribute('aria-expanded'), 'true');
    assert.ok(childList());
    const button = folderButton(h, label);
    button.focus();
    h.render();
    assert.equal(h.doc.activeElement, folderButton(h, label));
    assert.equal(h.doc.activeElement.focusCalls.at(-1).preventScroll, true);
  });
}

test('selecting a nested remote path expands every ancestor and preserves the action contract', async () => {
  const data = catalogData();
  data.remoteFolders = [remoteNode('a', [{ name: 'b', children: [{ name: 'c', children: [{ name: 'd' }] }] }])];
  const h = ready('remote', data);
  h.view.catalogRemoteExpanded.clear();
  h.view.catalogPage = 9;
  await h.actions['catalog-remote-folder']('a/b/c');
  assert.deepEqual([...h.view.catalogRemoteExpanded], ['a', 'a/b', 'a/b/c']);
  assert.equal(h.view.catalogPage, 1);
  const selected = folderButton(h, 'c');
  assert.equal(selected.dataset.action, 'catalog-remote-folder');
  assert.equal(selected.dataset.value, 'a/b/c');
  assert.equal(selected.getAttribute('aria-current'), 'location');
  assert.ok(selected.classList.contains('active'));
  assert.equal(h.page.querySelectorAll('.catalog-folder.active').length, 1);
  assert.ok(folderButton(h, 'd'));
  assert.match(h.fetchCalls.at(-1).url, /folder=a%2Fb%2Fc/);
  for (const value of ['', '__root__']) {
    h.view.catalogRemoteExpanded.clear();
    await h.actions['catalog-remote-folder'](value);
    assert.equal(h.view.catalogRemoteExpanded.size, 0);
  }
});

for (const tab of ['files', 'archives']) {
  test(`${tab}: selecting a device retains JSON values and location state`, async () => {
    const h = ready(tab);
    const button = folderButton(h, '소분류 장비');
    assert.deepEqual(JSON.parse(button.dataset.value), { event: 'sub', device: '소분류 장비' });
    button.focus();
    await click(h, button);
    const selected = folderButton(h, '소분류 장비');
    assert.equal(selected.getAttribute('aria-current'), 'location');
    assert.ok(selected.classList.contains('active'));
    assert.equal(h.doc.activeElement, selected);
    assert.equal(h.view.catalogEvent, 'sub');
    assert.equal(h.view.catalogDevice, '소분류 장비');
  });
}

test('long names stay in an ellipsis label with an escaped original title', () => {
  const label = `긴 폴더명 ${'<태그> & "인용" \'작은따옴표\' '.repeat(20)}`;
  for (const tab of ['remote', 'files', 'archives']) {
    const data = catalogData();
    data.remoteFolders = [remoteNode(label)];
    data.folders = [{ id: 'long', name: label, count: 123456, parent_id: null }];
    const h = ready(tab, data);
    const button = folderButton(h, label);
    assert.equal(button.getAttribute('title'), label);
    assert.equal(button.querySelector('.catalog-folder-label').textContent, label);
    assert.equal(button.querySelector('.catalog-folder-count').textContent, tab === 'remote' ? '1' : '123456');
    assert.equal(button.querySelector('태그'), null);
    const html = h.catalogFolderTree();
    assert.match(html, /&lt;태그&gt; &amp; &quot;인용&quot; &#39;작은따옴표&#39;/);
    assert.doesNotMatch(html, /<태그>/);
  }
});

test('empty remote index omits empty lists, while root-only files keep a leaf row', () => {
  const data = catalogData();
  data.remoteFolders = [];
  data.remoteRootCount = 0;
  const h = ready('remote', data);
  const list = h.page.querySelector('.catalog-folder-list');
  assert.match(list.textContent, /인덱싱된 원격 파일이 없습니다\./);
  assert.equal(list.querySelectorAll('ul').length, 0);
  assert.equal(list.querySelectorAll('.catalog-folder-row').length, 0);
  assert.equal(list.querySelectorAll('.catalog-folder').length, 1);
  data.remoteRootCount = 1;
  h.render();
  assertTree(h, '전체 원격 파일', [['루트 직속 파일', 0, false]]);
  assert.equal(h.page.querySelector('.catalog-folders-empty'), null);
  for (const tab of ['files', 'archives']) {
    const empty = ready(tab, { ...catalogData(), folders: [] });
    assert.match(empty.page.textContent, /등록된 이벤트가 없습니다\./);
    assertTree(empty, '전체 파일', [['미배정', 0, false]]);
  }
});

test('Events sidebar keeps parent and child eventLink classes and existing indentation', () => {
  const h = createHarness();
  h.state.events = [
    { id: 'parent', name: '상위 이벤트', folder: 'parent', parent: null },
    { id: 'child', name: '소분류', folder: 'child', parent: 'parent' },
  ];
  h.render();
  const parent = h.page.querySelector('.event-list [data-value="parent"]');
  const child = h.page.querySelector('.event-list [data-value="child"]');
  assert.ok(parent.classList.contains('event-link'));
  assert.equal(parent.classList.contains('child'), false);
  assert.ok(child.classList.contains('event-link'));
  assert.ok(child.classList.contains('child'));
  assert.equal(parent.querySelector('.event-label').textContent, '상위 이벤트');
  assert.equal(child.querySelector('.event-label').textContent, '소분류');
  assert.equal(parent.dataset.action, 'choose-event');
  assert.equal(child.dataset.action, 'choose-event');
  assert.equal(paddingLeft(rule('.event-link')), 9);
  assert.equal(paddingLeft(rule('.event-link.child')), 28);
  assert.ok(paddingLeft(rule('.event-link.child')) > paddingLeft(rule('.event-link')));
});
