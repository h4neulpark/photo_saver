'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Use the real app and the established five-root DOM fixture, with no API service.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, catalogPage, loadCatalog, catalogRowKey, catalogEventLabel, normalizeRootPath, formatRelativePath, catalogTime, shortHash,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', context);
const plain = value => JSON.parse(JSON.stringify(value));
const sha = '0123456789abcdef'.repeat(4);
const base = {
  record_key: 'managed:one', file_id: 'one', name: 'one.mp4', sha,
  local_path: 'uuid/one.mp4', original_path: 'camera/one.mp4',
  location: 'managed', kind: 'video', status: 'available', confirmed: true,
  event_name: '260903_나고야 / 1일차', captured_at: '2026-09-03T01:00:00Z', event_zone: 'Asia/Tokyo',
  device: 'GoPro', size: 1000000, can_download: true, has_archive: true,
  download_path: '260903_나고야/1일차/GoPro/one.mp4',
  archive_root: '/NAS', target: '260903_나고야/1일차/GoPro/one.mp4',
  outcome: 'uploaded', job_id: 7, recorded_at: '2026-11-01T00:00:00Z', verified_at: '2026-11-01T01:00:00Z',
  remote_path: '260903_나고야/1일차/GoPro/one.mp4', storage_id: 'storage',
  first_seen_at: '2026-10-01T00:00:00Z', last_seen_at: '2026-11-01T02:00:00Z',
  in_catalog: true, catalog_events: ['260903_나고야 / 1일차'], catalog_event_name: '260903_나고야 / 1일차',
  catalog_match_count: 1, catalog_has_unassigned: false, catalog_file_ids: ['one'],
};
function ready(tab = 'files', rows = [{}], extra = {}) {
  const h = createHarness();
  h.view.connecting = false; h.view.catalogTab = tab;
  h.view.catalog = {
    summary: { files: 3, hashes: 2, verified: 4, attempts: 5, failed: 1, remotePresent: 6, remoteTotal: 9, remoteOnly: 2, remoteMissing: 3, lastIndexedAt: '2026-11-01T00:00:00Z' },
    folders: [], remoteFolders: [], unassigned: 0, activeArchiveRoot: '/NAS',
    rows: rows.map(row => ({ ...base, ...(tab === 'remote' ? { status: 'present' } : {}), ...row })),
    total: rows.length, page: 1, pages: 2, ...extra,
  };
  h.win.location.hash = '#catalog'; h.render();
  h.setFetch(() => ({ ok: true, status: 200, json: async () => h.view.catalog }));
  return h;
}
const control = h => h.page.querySelector('[data-action="toggle-catalog-detail"]');
async function toggle(h, index = 0) {
  const button = h.page.querySelectorAll('[data-action="toggle-catalog-detail"]')[index];
  button.dispatchEvent({ type: 'click', target: button }); await flushMicrotasks();
}
const cell = (h, kind) => h.page.querySelector('.catalog-cell-' + kind);
const detail = h => h.page.querySelector('.catalog-detail-row');
const text = h => detail(h).textContent;
function detailMap(h) {
  return Object.fromEntries(detail(h).querySelector('.catalog-detail-grid').children.map(item => [item.querySelector('dt').textContent, item.querySelector('dd').textContent]));
}

test('P0-2 path helpers preserve root slash, filename differences, and root files', () => {
  const h = ready();
  for (const [value, expected] of [[null, ''], ['', ''], ['/', '/'], ['///', '/'], ['/NAS///', '/NAS'], ['/NAS', '/NAS']]) assert.equal(h.normalizeRootPath(value), expected);
  for (const [value, name, expected] of [['a/b/one.mp4', 'one.mp4', 'a/b/'], ['one.mp4', 'one.mp4', '루트 직속'], ['a/renamed.mp4', 'one.mp4', 'a/renamed.mp4'], ['a/one.xmp', 'one.xmp', 'a/'], ['a/one.mp4', '', 'a/one.mp4']]) assert.equal(h.formatRelativePath(value, name), expected);
});

test('Round 1: empty, null and undefined relative paths remain empty', () => {
  const h = ready();
  for (const fullPath of ['', null, undefined]) {
    assert.equal(h.formatRelativePath(fullPath, ''), '');
    assert.equal(h.formatRelativePath(fullPath), '');
    assert.equal(h.formatRelativePath(fullPath, 'one.mp4'), '');
  }
});

test('P0-2 files foreground permanent NAS path and hide internal/original paths until expanded', async () => {
  const h = ready();
  assert.equal(cell(h, 'file').querySelector('.catalog-path').getAttribute('title'), base.download_path);
  assert.match(cell(h, 'file').textContent, /260903_나고야\/1일차\/GoPro\//);
  assert.doesNotMatch(cell(h, 'file').textContent, /managed\/|uuid|camera\/|SHA-256/);
  assert.equal(cell(h, 'file').querySelector('.catalog-path-prefix').textContent, 'NAS');
  await toggle(h);
  const map = detailMap(h);
  assert.equal(map['내부 경로'], 'managed/uuid/one.mp4');
  assert.equal(map['원래 Incoming 경로'], 'incoming/camera/one.mp4');
  assert.equal(map['NAS 영구 경로'], base.download_path); assert.equal(map['활성 NAS 루트'], '/NAS');
  const local = ready('files', [{ download_path: null, can_download: false, has_archive: false }]);
  assert.equal(cell(local, 'file').querySelector('.catalog-path'), null);
  const incoming = ready('files', [{ location: 'incoming', local_path: 'camera/one.mp4', download_path: null }]);
  assert.match(cell(incoming, 'file').textContent, /incoming\/camera\/one.mp4/);
});

test('P0-2 archive/remote show relative directories, root files and differing filenames accurately', () => {
  for (const tab of ['archives', 'remote']) {
    const h = ready(tab);
    const path = cell(h, 'file').querySelector('.catalog-path');
    assert.equal(path.textContent, '260903_나고야/1일차/GoPro/');
    assert.equal(path.getAttribute('title'), base.target);
    assert.doesNotMatch(cell(h, 'file').textContent, /managed\/|camera\//);
    const renamed = ready(tab, [{ target: 'a/renamed.mp4', remote_path: 'a/renamed.mp4' }]);
    assert.match(cell(renamed, 'file').textContent, /a\/renamed.mp4/);
    const root = ready(tab, [{ target: 'one.mp4', remote_path: 'one.mp4' }]);
    assert.match(cell(root, 'file').textContent, /루트 직속/);
  }
  const h = ready('archives', [{ target: null }]);
  assert.match(cell(h, 'file').textContent, /목적지 미기록/);
});

test('P0-3 context shows active root once and rows only show root exceptions', () => {
  for (const tab of ['archives', 'remote']) {
    const h = ready(tab, [{ archive_root: '/NAS/' }]);
    assert.equal(h.page.querySelectorAll('.catalog-root-badge').length, 1);
    assert.equal(h.page.querySelector('.catalog-root-badge').getAttribute('title'), '활성 NAS 루트: /NAS');
    assert.equal(h.page.querySelector('.catalog-root-label').textContent, 'NAS 루트');
    assert.doesNotMatch(cell(h, 'file').textContent, /루트:|다른 루트|\/NAS/);
    const mismatch = ready(tab, [{ archive_root: '/old' }]);
    assert.equal(cell(mismatch, 'file').querySelector('.catalog-root-mismatch').textContent, '다른 루트: /old');
    const unset = ready(tab, [{}], { activeArchiveRoot: null });
    assert.equal(unset.page.querySelector('.catalog-root-badge').textContent, 'NAS 루트 미설정');
    assert.match(cell(unset, 'file').textContent, /루트: \/NAS/);
    const absent = ready(tab, [{ archive_root: null }]);
    assert.equal(cell(absent, 'file').textContent.includes('아카이브 루트 미기록'), tab === 'archives');
  }
  assert.equal(ready().page.querySelector('.catalog-root-badge'), null);
});

test('P0-3 active root slash is preserved and root/path HTML is escaped', () => {
  const h = ready('remote', [{ archive_root: '/', remote_path: '<script>&"/one.mp4' }], { activeArchiveRoot: '/' });
  assert.doesNotMatch(cell(h, 'file').textContent, /다른 루트/);
  assert.equal(cell(h, 'file').querySelector('script'), null);
  assert.equal(cell(h, 'file').querySelector('.catalog-path').getAttribute('title'), '<script>&"/one.mp4');
  const root = ready('archives', [{ archive_root: '/old<&"' }], { activeArchiveRoot: '/NAS<&"' });
  assert.equal(root.page.querySelector('.catalog-root-badge').getAttribute('title'), '활성 NAS 루트: /NAS<&"');
  assert.equal(root.page.querySelector('old'), null);
});

test('P1-4 all views use exactly three labelled columns and show XMP tags', () => {
  const expected = {
    files: ['파일 / 보관 경로', '분류 / 촬영 일시', '보관 상태'],
    archives: ['파일 / 목적지', '분류 / 작업 정보', '검증 결과 / 시각'],
    remote: ['원격 파일 / 폴더', '연동 이벤트 / 크기', 'NAS 상태 / 확인 시각'],
  };
  for (const tab of Object.keys(expected)) {
    const h = ready(tab, [{ kind: 'xmp', name: 'one.xmp' }]);
    assert.deepEqual(plain(h.page.querySelectorAll('thead th').map(th => th.textContent)), expected[tab]);
    assert.deepEqual(plain(h.page.querySelectorAll('.catalog-row td').map(td => td.dataset.label)), expected[tab]);
    assert.equal(h.page.querySelectorAll('.catalog-row td').length, 3);
    assert.equal(h.page.querySelector('.catalog-cell-hash'), null);
    assert.equal(cell(h, 'file').querySelector('.catalog-kind-tag').textContent, 'XMP');
    assert.equal(cell(h, 'status').querySelectorAll('.catalog-row-actions').length, 1);
  }
});

test('P1-4 files show event timezone capture date and equipment, with safe fallbacks', async () => {
  const h = ready();
  assert.match(cell(h, 'meta').textContent, /260903_나고야 \/ 1일차.*2026-09-03 10:00.*GoPro.*1 MB/s);
  assert.ok(cell(h, 'meta').querySelector('.numbers'));
  assert.equal(h.catalogTime('invalid'), '—'); assert.equal(h.catalogTime(null), '—');
  assert.equal(h.catalogTime(base.captured_at, 'Invalid/Zone'), h.catalogTime(base.captured_at));
  await toggle(h); assert.match(detailMap(h)['촬영 일시'], /2026-09-03 10:00 \(Asia\/Tokyo\)/);
  const absent = ready('files', [{ captured_at: null, event_name: null, device: null }]);
  assert.match(cell(absent, 'meta').textContent, /미배정.*—.*장비 미확인/s);
});

test('P1-4 managed statuses explain local/NAS presence, history and classification', () => {
  const cases = [
    [{ status: 'archived' }, 'NAS 보관', 'archived', '로컬 비움 완료'],
    [{ status: 'archived', can_download: false }, 'NAS 보관', 'archived', '로컬 비움 · 활성 루트 미확인'],
    [{}, '로컬 + NAS', 'ready', '분류 확정'],
    [{ confirmed: false }, '로컬 + NAS', 'ready', '분류 미확정'],
    [{ can_download: false }, '로컬 + 이력', 'ready', '분류 확정 · 다른 루트 또는 과거 이력'],
    [{ can_download: false, has_archive: false, confirmed: false }, '로컬만', 'local', '분류 미확정'],
    [{ status: 'offloading' }, '로컬 비우기 중', 'draft', ''],
    [{ status: 'missing' }, '로컬 누락', 'review', 'NAS 사본 있음'],
    [{ status: 'missing', can_download: false }, '로컬 누락', 'review', '과거 아카이브 이력 있음'],
    [{ status: 'missing', can_download: false, has_archive: false }, '로컬 누락', 'review', '로컬 원본 없음'],
  ];
  for (const [row, label, tone, note] of cases) {
    const h = ready('files', [row]), badge = cell(h, 'status').querySelector('.status');
    assert.equal(badge.textContent, label); assert.ok(badge.classList.contains(tone)); assert.ok(cell(h, 'status').textContent.includes(note));
  }
  const unset = ready('files', [{ status: 'archived', can_download: false }], { activeArchiveRoot: null });
  assert.match(cell(unset, 'status').textContent, /로컬 비움 완료/);
  const history = ready('files', [{ can_download: false, confirmed: false }], { activeArchiveRoot: null });
  assert.match(cell(history, 'status').textContent, /분류 미확정 · 검증 이력 있음/);
});

test('P1-4 Incoming statuses and NAS identical-file notes are distinct', () => {
  for (const [status, label, tone] of [['ready', 'Incoming 대기', 'draft'], ['duplicate', 'Incoming 중복', 'duplicate'], ['review', 'Incoming 검토', 'review'], ['moving', 'Incoming 이동 중', 'draft'], ['moved', 'Incoming 이동됨', 'draft'], ['deleting', 'Incoming 삭제 중', 'draft'], ['deleted', 'Incoming 삭제됨', 'draft']]) {
    const h = ready('files', [{ location: 'incoming', status }]), badge = cell(h, 'status').querySelector('.status');
    assert.equal(badge.textContent, label); assert.ok(badge.classList.contains(tone));
    assert.match(cell(h, 'status').textContent, /NAS 동일 파일 있음/);
    assert.doesNotMatch(cell(h, 'status').textContent, /분류 확정/);
  }
  assert.doesNotMatch(cell(ready('files', [{ location: 'incoming', has_archive: false }]), 'status').textContent, /NAS 동일 파일 있음/);
});

test('P1-4 archive results and remote status keep exact labels, tones, times and errors', () => {
  for (const [outcome, label, tone] of [['uploaded', '업로드 검증', 'ready'], ['skipped', '동일 파일 확인', 'ready'], ['legacy_verified', '과거 전송 완료', 'ready'], ['failed', '전송 실패', 'danger'], ['pending', '진행 대기', 'draft'], ['unknown', '결과 미기록', 'draft']]) {
    const h = ready('archives', [{ outcome, error: '<error>실패' }]), badge = cell(h, 'status').querySelector('.status');
    assert.equal(badge.textContent, label); assert.ok(badge.classList.contains(tone));
    assert.match(cell(h, 'meta').textContent, /작업 #7 · 원본 · 1 MB.*GoPro/s);
    assert.equal(cell(h, 'status').querySelector('.form-error').textContent, '<error>실패'); assert.equal(h.page.querySelector('error'), null);
    assert.ok(cell(h, 'status').querySelector('.numbers'));
  }
  for (const [status, label, tone] of [['present', 'NAS 보관', 'archived'], ['missing', 'NAS 누락', 'review']]) {
    const h = ready('remote', [{ status }]), badge = cell(h, 'status').querySelector('.status');
    assert.equal(badge.textContent, label); assert.ok(badge.classList.contains(tone)); assert.ok(cell(h, 'status').querySelector('.numbers'));
  }
});

test('P1-4 scope values stay compatible while labels match each view', () => {
  const expected = {
    files: [['all', '모든 파일'], ['managed', '관리 파일 (로컬·NAS)'], ['incoming', 'Incoming 기록'], ['verified', 'NAS 검증 이력 있음'], ['xmp', 'XMP'], ['no_thumbnail', '썸네일 없음']],
    archives: [['all', '모든 결과'], ['verified', '검증 완료'], ['failed', '전송 실패'], ['unknown', '결과 미확정'], ['xmp', 'XMP'], ['no_thumbnail', '썸네일 없음']],
    remote: [['all', '모든 원격 파일'], ['present', 'NAS 보관'], ['remote_only', '원격 전용 (카탈로그 미등록)'], ['missing', 'NAS 누락'], ['xmp', 'XMP'], ['no_thumbnail', '썸네일 없음']],
  };
  for (const tab of Object.keys(expected)) {
    assert.deepEqual(plain(ready(tab).page.querySelectorAll('#catalog-scope option').map(option => [option.getAttribute('value'), option.textContent])), expected[tab]);
  }
});

test('P1-4 remote event labels cover single, multiple, unassigned, legacy and remote-only rows', () => {
  const cases = [
    [{ in_catalog: false }, '원격 전용', null],
    [{ catalog_events: ['A'] }, 'A', null],
    [{ catalog_events: ['A'], catalog_has_unassigned: true }, 'A 외 미배정', 'A · 미배정 포함'],
    [{ catalog_events: ['A', 'B', 'C'] }, 'A 외 2개', 'A, B, C'],
    [{ catalog_events: ['A', 'B'], catalog_has_unassigned: true }, 'A 외 1개 · 미배정', 'A, B · 미배정 포함'],
    [{ catalog_events: [], catalog_has_unassigned: true }, '카탈로그 연동 · 미배정', null],
    [{ catalog_events: [] }, '카탈로그 연동됨', null],
    [{ catalog_events: undefined, catalog_event_name: 'legacy' }, 'legacy', null],
    [{ catalog_events: undefined, catalog_event_name: null }, '카탈로그 연동됨', null],
    [{ catalog_events: ['<x>&"', 'B'] }, '<x>&" 외 1개', '<x>&", B'],
  ];
  for (const [row, label, title] of cases) {
    const h = ready('remote', [row]), div = cell(h, 'meta').children[0];
    assert.equal(div.textContent, label); assert.equal(div.getAttribute('title'), title); assert.equal(div.querySelector('x'), null);
  }
});

test('P1-5 detail toggle has accessible state, full hash, colspan 3, focus/scroll retention and collapse', async () => {
  for (const tab of ['files', 'archives', 'remote']) {
    const h = ready(tab), original = control(h);
    assert.equal(original.getAttribute('aria-expanded'), 'false'); assert.equal(original.getAttribute('aria-controls'), null);
    assert.equal(original.getAttribute('aria-label'), 'one.mp4 상세 정보 펼치기'); assert.equal(detail(h), null);
    original.focus(); h.page.querySelector('.catalog-table-wrap').scrollTo(25, 79);
    await toggle(h);
    assert.equal(control(h).getAttribute('aria-expanded'), 'true'); assert.equal(control(h).getAttribute('aria-controls'), 'catalog-detail-0');
    assert.equal(control(h).getAttribute('aria-label'), 'one.mp4 상세 정보 접기'); assert.equal(h.doc.activeElement, control(h));
    assert.equal(h.page.querySelector('.catalog-table-wrap').scrollTop, 79); assert.equal(h.page.querySelector('.catalog-table-wrap').scrollLeft, 25);
    assert.equal(h.page.querySelector('.catalog-row').dataset.expanded, 'true');
    assert.equal(detail(h).parentElement.children[1], detail(h)); assert.equal(detail(h).getAttribute('id'), 'catalog-detail-0');
    assert.equal(detail(h).querySelector('td').getAttribute('colspan'), '3'); assert.ok(detail(h).querySelector('.catalog-detail-wide'));
    assert.equal(detail(h).querySelector('.catalog-hash-full').textContent, sha);
    assert.equal(detail(h).querySelector('[data-action="copy-record-hash"]').dataset.value, sha);
    await toggle(h); assert.equal(detail(h), null); assert.equal(h.view.catalogExpandedRows.size, 0);
  }
});

test('P1-5 per-view details expose full audit fields and do not invent absent metadata', async () => {
  const archive = ready('archives', [{ error: '<error>detail', archive_root: null, target: null }]);
  await toggle(archive);
  const a = detailMap(archive);
  for (const label of ['파일 ID', '작업 정보', '내부 로컬 경로', '원래 Incoming 경로', '아카이브 루트', '목적지 상대 경로', '시각', '오류 상세']) assert.ok(label in a, label);
  assert.equal(a['아카이브 루트'], '미기록'); assert.equal(a['목적지 상대 경로'], '미기록'); assert.match(a['시각'], /기록 .* · 검증 /); assert.equal(a['오류 상세'], '<error>detail');
  const remote = ready('remote', [{ catalog_events: ['A', 'B'], catalog_has_unassigned: true, catalog_file_ids: ['one', 'two'] }]);
  await toggle(remote); const r = detailMap(remote);
  assert.equal(r['원격 전체 경로'], base.remote_path); assert.equal(r['아카이브 루트'], '/NAS'); assert.equal(r['스토리지 ID'], 'storage'); assert.match(r['확인 시각'], /최초 .* · 검증 .* · 최근 /); assert.equal(r['연동 이벤트'], 'A, B · 미배정 포함 · one, two');
  const incoming = ready('files', [{ location: 'incoming', sha: null, captured_at: null, download_path: null, original_path: null }]);
  await toggle(incoming); const i = detailMap(incoming);
  assert.equal(i['내부 경로'], 'incoming/uuid/one.mp4'); assert.equal(i['SHA-256'], '해시 미기록');
  for (const label of ['촬영 일시', '원래 Incoming 경로', 'NAS 영구 경로', '활성 NAS 루트']) assert.equal(label in i, false);
  assert.equal(detail(incoming).querySelector('[data-action="copy-record-hash"]'), null);
  const only = ready('remote', [{ in_catalog: false }]); await toggle(only); assert.equal('연동 이벤트' in detailMap(only), false);
});

test('P1-5 stable keys, fallback keys and successful loads preserve only matching expanded rows', async () => {
  const h = ready('files', [{ record_key: 'one' }, { record_key: 'two', name: 'two.mp4' }]);
  assert.equal(h.catalogRowKey({ record_key: 'stable' }, 3), 'stable');
  assert.equal(h.catalogRowKey({ file_id: 'id' }, 2), 'files:id:2');
  assert.equal(h.catalogRowKey({ remote_path: 'path' }, 2), 'files:path:2');
  assert.equal(h.catalogRowKey({}, 2), 'files:2:2');
  await toggle(h, 0); await toggle(h, 1);
  const next = { ...h.view.catalog, rows: [{ ...base, record_key: 'two' }, { ...base, record_key: 'new' }] };
  h.setFetch(() => ({ ok: true, status: 200, json: async () => next }));
  await h.loadCatalog();
  assert.deepEqual([...h.view.catalogExpandedRows], ['two']);
  assert.equal(h.page.querySelectorAll('.catalog-detail-row').length, 1); assert.equal(control(h).getAttribute('aria-controls'), 'catalog-detail-0');
  h.setFetch(() => ({ ok: false, status: 500, json: async () => ({ detail: 'unavailable' }) }));
  await h.loadCatalog(); assert.deepEqual([...h.view.catalogExpandedRows], ['two']);
  h.setFetch(() => ({ ok: true, status: 200, json: async () => ({ ...next, rows: [] }) }));
  await h.loadCatalog(); assert.equal(h.view.catalogExpandedRows.size, 0);
});

test('P1-5 navigation and reset actions clear row details while folder toggles preserve them', async () => {
  const cases = [['catalog-tab', 'remote'], ['open-catalog-tab', 'archives'], ['catalog-page', '2'], ['catalog-folder', JSON.stringify({ event: 'event', device: '' })], ['catalog-remote-folder', 'a/b'], ['reset-catalog-filters']];
  for (const [action, value] of cases) {
    const h = ready(); await toggle(h);
    await h.actions[action](value); assert.equal(h.view.catalogExpandedRows.size, 0, action);
  }
  const h = ready(); await toggle(h);
  h.actions['toggle-catalog-folder']('event'); h.actions['toggle-remote-folder']('a');
  assert.equal(h.view.catalogExpandedRows.size, 1);
  h.clearCatalogViews(); assert.equal(h.view.catalogExpandedRows.size, 0);
});

test('P1-5 download links retain exact encoded path and per-view action labels', () => {
  for (const tab of ['files', 'archives', 'remote']) {
    const h = ready(tab), a = cell(h, 'status').querySelector('.catalog-row-actions a');
    assert.equal(a.getAttribute('href'), '/api/archive/download?path=' + encodeURIComponent(base.target));
    assert.equal(a.textContent, tab === 'files' ? 'NAS 다운로드' : '다운로드');
    assert.equal(a.getAttribute('target'), '_blank'); assert.equal(a.getAttribute('rel'), 'noopener');
    assert.equal(cell(ready(tab, [{ can_download: false }]), 'status').querySelector('a'), null);
  }
});

test('P1-6 header puts counted tabs and view-only summary outside tabpanel, context before search', () => {
  const expected = { files: '고유 해시 2개 · NAS 검증 4건', archives: '검증 4건 · 실패 1건', remote: 'NAS 보관 6개 · 원격 전용 2개 · 누락 3개 · 인덱싱' };
  for (const tab of ['files', 'archives', 'remote']) {
    const h = ready(tab), top = h.page.querySelector('.catalog-topbar'), panel = h.page.querySelector('#catalog-tabpanel');
    assert.ok(top.querySelector('.catalog-tabs')); assert.equal(top.querySelector('.catalog-tabs').getAttribute('role'), 'tablist');
    assert.equal(panel.querySelector('.catalog-tabs'), null); assert.equal(panel.querySelector('.catalog-summary'), null);
    assert.ok(top.querySelector('.catalog-summary').textContent.startsWith(expected[tab]));
    const content = h.page.querySelector('.catalog-content');
    assert.ok(content.children[0].classList.contains('catalog-context-bar')); assert.equal(content.children[1].getAttribute('id'), 'catalog-search');
    assert.equal(h.page.querySelector('.catalog-note'), null);
    assert.match(h.page.textContent, /보유 파일, 아카이브 이력, 원격 인덱스를 조회합니다\./);
  }
  const h = ready('remote', [{}], { summary: { remotePresent: 1, remoteOnly: 0, remoteMissing: 0 } });
  assert.equal(h.page.querySelector('.catalog-summary').textContent, 'NAS 보관 1개 · 원격 전용 0개');
});

test('P1-6 CSS defines sidebar breakpoints, 3-column widths, detail cards and mobile touch targets', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(css, /\.catalog-layout\s*\{[^}]*grid-template-columns: clamp\(248px, 21vw, 272px\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 1050px\)\s*\{\s*\.catalog-layout\s*\{ grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(css, /\.catalog-table-wrap \.catalog-table\s*\{ min-width: 620px; width: 100%; table-layout: fixed; white-space: normal;/);
  for (const [index, width] of [[1, 42], [2, 32], [3, 26]]) assert.ok(css.includes(`.catalog-table th:nth-child(${index}) { width: ${width}%; }`));
  for (const selector of ['.catalog-topbar', '.catalog-context-bar', '.catalog-root-badge', '.catalog-row-actions', '.catalog-detail-toggle', '.catalog-detail-row', '.catalog-detail-grid', '.catalog-hash-full', '.status.danger', '.status.local', '.catalog-kind-tag', '.catalog-path-prefix', '.catalog-root-mismatch']) assert.ok(css.includes(selector));
  const mobile = css.slice(css.indexOf('@media (max-width: 760px)', css.indexOf('.catalog-hash-full')));
  assert.match(mobile, /\.catalog-layout\s*\{ grid-template-columns: 1fr;/);
  assert.match(mobile, /\.catalog-detail-grid\s*\{ grid-template-columns: 1fr; \}/);
  assert.match(mobile, /\.catalog-detail-toggle, \.catalog-detail-grid \.button\s*\{ min-height: 44px; padding: 8px 12px;/);
  assert.match(mobile, /\.catalog-table \.catalog-detail-row\s*\{[^}]*border-top: 1px dashed/);
  assert.match(mobile, /\.catalog-root-badge\s*\{[^}]*overflow-wrap: anywhere/);
});

test('Round 1: node hierarchy rules exclude active folders and preserve their color and weight', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, selectors, body]) =>
    selectors.trim().split(/,\s*/).map(selector => ({ selector, body })));
  const active = rules.find(rule => rule.selector === '.catalog-folder.active');
  assert.ok(active);
  assert.match(active.body, /(?:^|;)\s*color:\s*#1945b2\s*;/);
  assert.match(active.body, /(?:^|;)\s*font-weight:\s*700\s*;/);
  for (const kind of ['all', 'event', 'sub', 'device', 'unassigned', 'root-files']) {
    const prefix = `.catalog-folder[data-node-kind="${kind}"]`;
    const hierarchy = rules.filter(rule => rule.selector.startsWith(prefix));
    assert.ok(hierarchy.length, `missing hierarchy style for ${kind}`);
    for (const rule of hierarchy) {
      assert.ok(rule.selector.startsWith(`${prefix}:not(.active)`), `${rule.selector} must exclude active nodes`);
    }
  }
});

test('Round 1: mobile detail background overrides the white main card with higher specificity', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(css, /(?:^|\n)\.catalog-detail-row\s*\{\s*background:\s*#f8faff\s*;/);
  const start = css.indexOf('@media (max-width: 760px)', css.indexOf('.catalog-hash-full'));
  assert.ok(start >= 0);
  let depth = 1, end = css.indexOf('{', start) + 1;
  const bodyStart = end;
  while (depth && end < css.length) {
    if (css[end] === '{') depth++;
    if (css[end] === '}') depth--;
    end++;
  }
  const mobile = css.slice(bodyStart, end - 1);
  const rules = [...mobile.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const main = rules.findIndex(rule => rule.selector === '.catalog-table tr');
  const detail = rules.findIndex(rule => rule.selector === '.catalog-table .catalog-detail-row');
  assert.ok(main >= 0);
  assert.ok(detail > main, 'the detail override must follow the main card rule');
  assert.match(rules[main].body, /(?:^|;)\s*background:\s*var\(--white\)\s*;/);
  assert.match(rules[detail].body, /(?:^|;)\s*background:\s*#f8faff\s*;/);
  // Two classes (0,2,0) outrank one class plus a type (0,1,1).
  assert.equal((rules[main].selector.match(/\.[\w-]+/g) || []).length, 1);
  assert.equal((rules[detail].selector.match(/\.[\w-]+/g) || []).length, 2);
});

