'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, openCatalogPreview, openThumbnailBatchDialog, openRemoteIndexDialog, generateCatalogThumbnail, thumbnailSettingsSection, catalogRowKey, savedPreference,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context); vm.runInContext(fixture, context);
const { createHarness, flushMicrotasks } = vm.runInContext('({ createHarness, flushMicrotasks })', context);
const sha = 'a'.repeat(64);
const row = (extra = {}) => ({ record_key: 'remote:one', name: 'photo.jpg', sha, kind: 'photo', media_kind: 'photo', status: 'present', remote_path: 'Trip/photo.jpg', size: 1234, thumbnail_status: 'missing', can_generate_thumbnail: true, can_download: true, ...extra });
function ready(rows = [row()], extra = {}) {
  const h = createHarness();
  h.view.connecting = false; h.view.catalogTab = 'remote';
  h.view.catalog = { summary: {}, rows, total: rows.length, page: 1, pages: 1, folders: [], remoteFolders: [], activeArchiveRoot: '/NAS', ...extra };
  h.win.location.hash = '#catalog'; h.render();
  h.setFetch((url) => ({ ok: true, status: 200, json: async () => url.includes('/state') ? h.state : h.view.catalog }));
  return h;
}

test('catalog slots cover ready photo/video, missing, generating, failed, skipped, unavailable and XMP', () => {
  const rows = [row({ thumbnail_status: 'ready', thumbnail: '/thumbnails/a.jpg' }), row({ media_kind: 'video', thumbnail_status: 'ready', thumbnail: '/thumbnails/b.jpg' }), row(), row({ thumbnail_status: 'generating' }), row({ thumbnail_status: 'failed', thumbnail_error: 'decode failure' }), row({ thumbnail_status: 'skipped_large', thumbnail_error: '150 MiB' }), row({ thumbnail_status: 'unavailable', can_generate_thumbnail: false }), row({ kind: 'xmp', media_kind: 'xmp', thumbnail_status: 'non_media', can_generate_thumbnail: false })];
  const h = ready(rows);
  assert.equal(h.page.querySelectorAll('.catalog-thumb').length, 8);
  assert.equal(h.page.querySelectorAll('.catalog-video-badge').length, 1);
  assert.equal(h.page.querySelectorAll('.is-generating').length, 2);
  assert.match(h.page.textContent, /decode failure|150 MiB/);
  assert.equal(h.page.querySelectorAll('[data-action="generate-catalog-thumb"]').length, 4);
  assert.equal(h.page.querySelectorAll('.catalog-row')[0].children.length, 3);
});

test('missing notice is inside context bar only for positive total', () => {
  const h = ready([row()], { missingThumbnails: { total: 2, photos: 1, videos: 1 } });
  assert.match(h.page.querySelector('.catalog-context-bar').textContent, /썸네일 미생성.*2개/);
  assert.equal(h.page.querySelector('.catalog-content').children[1].id, 'catalog-search');
  h.view.catalog.missingThumbnails.total = 0; h.render();
  assert.equal(h.page.querySelector('.catalog-thumb-alert'), null);
});

test('view preference persists and cards use dialog details', () => {
  const h = ready(); h.actions['catalog-view']('cards');
  assert.equal(h.savedPreference('photo-saver-catalog-view', 'table'), 'cards');
  assert.equal(h.page.querySelectorAll('.catalog-card').length, 1);
  h.actions['open-catalog-detail-dialog']('remote:one');
  assert.equal(h.dialog.open, true);
  assert.ok(h.dialog.querySelector('.catalog-detail-grid'));
  assert.equal(h.page.querySelector('.catalog-detail-row'), null);
  h.actions['catalog-view']('table'); h.actions['toggle-catalog-detail']('remote:one'); h.render();
  assert.ok(h.page.querySelector('.catalog-detail-row'));
});

test('catalog preview navigates all media excluding XMP and restores focus', () => {
  const h = ready([row({ record_key: 'one' }), row({ record_key: 'xmp', kind: 'xmp', media_kind: 'xmp' }), row({ record_key: 'two', sha: 'b'.repeat(64) })]);
  h.openCatalogPreview('one');
  assert.equal(h.view.preview.ids.length, 2);
  assert.ok(h.mediaPreview.querySelector('.is-empty-thumb'));
  assert.ok(h.mediaPreview.querySelector('[data-action="generate-preview-thumb"]'));
  h.stepPreview(1); assert.equal(h.currentPreviewFile().id, 'two');
  h.closeMediaPreview();
  assert.equal(h.doc.activeElement.dataset.value, 'two');
});

test('catalog cached preview caps scaling and links NAS original', () => {
  const h = ready([row({ thumbnail_status: 'ready', thumbnail: '/thumbnails/a.jpg' })]);
  h.openCatalogPreview('remote:one');
  assert.ok(h.mediaPreview.querySelector('.preview-cached-img'));
  assert.match(h.mediaPreview.textContent, /캐시 썸네일 미리보기/);
  assert.match(h.mediaPreview.textContent, /NAS 원본 다운로드/);
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(css, /max-width: min\(100%, 360px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('catalog local preview uses high resolution original', () => {
  const h = ready([row({ has_local_original: true, preview: '/api/managed/one/preview', original: '/api/managed/one/original' })]);
  h.openCatalogPreview('remote:one');
  assert.equal(h.mediaPreview.querySelector('.preview-stage img').getAttribute('src'), '/api/managed/one/preview');
  assert.equal(h.mediaPreview.querySelector('.is-cached-thumb'), null);
});

test('thumbnail generation replaces open modal after job completes', async () => {
  const h = ready();
  h.openCatalogPreview('remote:one');
  h.setFetch(url => ({ ok: true, status: 200, json: async () => url.includes('/jobs/thumbnails') ? { id: 3, kind: 'thumbnails-remote', lane: 'remote', status: 'queued' } : url.includes('/state') ? h.state : h.view.catalog }));
  const generate = h.mediaPreview.querySelector('[data-action="generate-preview-thumb"]');
  generate.dispatchEvent({ type: 'click', target: generate });
  await flushMicrotasks();
  assert.equal(h.fetchCalls.filter(call => call.url.includes('/jobs/thumbnails')).length, 1);
  assert.equal(h.currentPreviewFile().thumbnail_status, 'generating');
  assert.equal(h.mediaPreview.open, true);
  h.view.catalog.rows[0] = row({ thumbnail_status: 'ready', thumbnail: '/thumbnails/a.jpg' });
  h.view.thumbnailGeneratingShas.clear(); h.reconcilePreview();
  assert.ok(h.mediaPreview.querySelector('.preview-cached-img'));
  assert.equal(h.mediaPreview.open, true);
});

test('remote indexing thumbnail opt in defaults off and is remembered', () => {
  const h = ready(); h.view.archive = { root: '/NAS', connectionVersion: sha };
  h.openRemoteIndexDialog();
  const input = h.dialog.querySelector('[name="generate_thumbnails"]');
  assert.equal(input.getAttribute('checked'), null);
  input.checked = true; input.dispatchEvent({ type: 'change', target: input });
  h.dialog.close(); h.openRemoteIndexDialog();
  assert.notEqual(h.dialog.querySelector('[name="generate_thumbnails"]').getAttribute('checked'), null);
});

test('batch scope change replans, fallback defaults off, busy lane disables submit', async () => {
  const h = ready(); h.view.catalogRemoteFolder = 'Trip';
  h.setFetch(() => ({ ok: true, status: 200, json: async () => ({ total: 2, local: 0, remotePhotos: 1, remoteVideos: 1, remoteVideosOverLimit: 1, estimatedBytes: 70000, lane: 'remote', storageConfigured: true }) }));
  await h.openThumbnailBatchDialog('folder');
  assert.equal(h.dialog.querySelector('[name="allow_large_sftp_fallback"]').getAttribute('checked'), null);
  const all = h.dialog.querySelector('[name="thumbnail_scope"][value="all"]');
  all.dispatchEvent({ type: 'change', target: all }); await flushMicrotasks();
  const calls = h.fetchCalls.filter(call => call.url.includes('/thumbnails/plan'));
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].opts.body).scope, 'all');
  h.state.activeJobs.remote = { id: 8, kind: 'upload', status: 'running', lane: 'remote' };
  h.dialog.close(); await h.openThumbnailBatchDialog('folder');
  assert.equal(h.dialog.querySelector('[type="submit"]').disabled, true);
});

test('settings cache management disables orphan cleanup while jobs run', () => {
  const h = ready();
  h.view.thumbnailStats = { cachedCount: 3, cachedBytes: 500, missingTotal: 2, missingLocal: 1, missingRemotePhotos: 1, missingRemoteVideos: 0, orphanCount: 1, orphanBytes: 100, failedCount: 1, skippedLargeCount: 0, canCleanup: true };
  h.state.activeJobs.local = { id: 5, kind: 'scan', status: 'running', lane: 'local' };
  h.win.location.hash = '#settings'; h.render();
  assert.ok(h.page.querySelectorAll('.settings-section').some(el => el.getAttribute('aria-label') === '썸네일 캐시'));
  assert.equal(h.page.querySelector('[data-action="cleanup-orphan-thumbnails"]').disabled, true);
  assert.match(h.page.textContent, /썸네일 이미지 파일은 DB 백업에 포함되지 않습니다/);
});

test('detail dialog hash copy works from cards and catalog preview and reports failure', async () => {
  const h = ready();
  const copied = [];
  h.doc.execCommand = command => { assert.equal(command, 'copy'); copied.push(h.doc.activeElement.value); return true; };
  h.actions['catalog-view']('cards');
  h.actions['open-catalog-detail-dialog']('remote:one');
  let copy = h.dialog.querySelector('[data-action="copy-record-hash"]');
  copy.dispatchEvent({ type: 'click', target: copy }); await flushMicrotasks();
  assert.deepEqual(copied, [sha]);
  h.dialog.close(); h.openCatalogPreview('remote:one');
  const details = h.mediaPreview.querySelector('[data-action="preview-catalog-detail"]');
  details.dispatchEvent({ type: 'click', target: details }); await flushMicrotasks();
  copy = h.dialog.querySelector('[data-action="copy-record-hash"]');
  copy.dispatchEvent({ type: 'click', target: copy }); await flushMicrotasks();
  assert.deepEqual(copied, [sha, sha]);
  h.actions['copy-record-hash'] = async () => { throw new Error('copy denied'); };
  copy.dispatchEvent({ type: 'click', target: copy }); await flushMicrotasks();
  assert.match(h.notice.textContent, /copy denied/);
});

test('XMP is visible and unavailable and generating slots cannot activate', () => {
  const h = ready([row({ kind: 'xmp', media_kind: 'xmp' }), row({ record_key: 'unavailable', thumbnail_status: 'unavailable', can_generate_thumbnail: false }), row({ record_key: 'generating', thumbnail_status: 'generating' })]);
  const xmp = h.page.querySelector('.catalog-thumb.is-non_media');
  assert.ok(xmp.querySelector('svg'));
  assert.equal(xmp.querySelector('.small').textContent, 'XMP');
  assert.equal(xmp.querySelector('.sr-only'), null);
  const unavailable = h.page.querySelector('.catalog-thumb.is-unavailable');
  assert.equal(unavailable.tagName, 'DIV'); assert.equal(unavailable.getAttribute('data-action'), null);
  const generating = h.page.querySelector('.catalog-thumb.is-generating');
  assert.equal(generating.disabled, true); assert.equal(generating.getAttribute('aria-busy'), 'true');
  assert.equal(generating.getAttribute('data-action'), null);
  h.actions['catalog-view']('cards');
  assert.equal(h.page.querySelector('.is-non_media .small').textContent, 'XMP');
});

test('missing table slot directly generates while file name opens preview', async () => {
  const h = ready();
  const slot = h.page.querySelector('.catalog-thumb.is-missing');
  assert.equal(slot.dataset.action, 'generate-catalog-thumb'); assert.equal(slot.dataset.value, sha);
  const file = h.page.querySelector('.catalog-file-preview');
  file.dispatchEvent({ type: 'click', target: file }); await flushMicrotasks();
  assert.equal(h.mediaPreview.open, true); h.closeMediaPreview();
  h.setFetch(url => ({ ok: true, status: 200, json: async () => url.includes('/jobs/thumbnails') ? { id: 9, kind: 'thumbnails-remote', lane: 'remote', status: 'queued' } : h.state }));
  slot.dispatchEvent({ type: 'click', target: slot }); await flushMicrotasks();
  assert.equal(h.fetchCalls.filter(call => call.url.includes('/jobs/thumbnails')).length, 1);
  assert.equal(h.mediaPreview.open, false);
});

test('missing card central button generates and its file name opens preview', async () => {
  const h = ready(); h.actions['catalog-view']('cards');
  const central = h.page.querySelector('.catalog-card-media [data-action="generate-catalog-thumb"]');
  assert.ok(central); assert.equal(central.textContent, '썸네일 생성');
  const file = h.page.querySelector('.catalog-card-body [data-action="preview-catalog"]');
  file.dispatchEvent({ type: 'click', target: file }); await flushMicrotasks();
  assert.equal(h.mediaPreview.open, true); h.closeMediaPreview();
  h.setFetch(url => ({ ok: true, status: 200, json: async () => url.includes('/jobs/thumbnails') ? { id: 10, kind: 'thumbnails-remote', lane: 'remote', status: 'queued' } : h.state }));
  central.dispatchEvent({ type: 'click', target: central }); await flushMicrotasks();
  assert.equal(h.fetchCalls.filter(call => call.url.includes('/jobs/thumbnails')).length, 1);
});

test('catalog thumbnail CSS uses 61x39 desktop and 44px mobile touch height', () => {
  const css = fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
  assert.match(css, /\.catalog-thumb\.thumb\s*\{\s*width:\s*61px;\s*height:\s*39px;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[^}]+\}[^}]*\.catalog-thumb\.thumb\s*\{\s*height:\s*44px;/);
  assert.match(css, /\.catalog-card-media\.is-missing > \.button\s*\{[^}]*top: 50%;[^}]*left: 50%;/);
});

test('no_thumbnail refresh keeps generated current media snapshot with empty or remaining rows', () => {
  for (const remaining of [[], [row({ record_key: 'other', sha: 'b'.repeat(64) })]]) {
    const h = ready([row(), ...remaining]); h.view.catalogScope = 'no_thumbnail'; h.openCatalogPreview('remote:one');
    h.state.jobs.remote = { id: 20, kind: 'thumbnails-remote', lane: 'remote', status: 'done', result: { items: [{ sha, status: 'generated' }] } };
    h.view.catalog.rows = remaining; h.reconcilePreview();
    assert.equal(h.mediaPreview.open, true);
    assert.equal(h.currentPreviewFile().id, 'remote:one');
    assert.equal(h.currentPreviewFile().thumbnail_status, 'ready');
    assert.equal(h.mediaPreview.querySelector('.preview-cached-img').getAttribute('src'), `/thumbnails/${sha}-v1.jpg`);
    h.reconcilePreview(); assert.equal(h.mediaPreview.open, true);
  }
});

test('no_thumbnail missing row is not invented as ready after a failed or cancelled generation', () => {
  for (const status of ['failed', 'cancelled']) {
    const h = ready(); h.view.catalogScope = 'no_thumbnail'; h.openCatalogPreview('remote:one');
    h.state.jobs.remote = { id: 21, kind: 'thumbnails-remote', lane: 'remote', status, result: { items: [{ sha, status: 'failed' }] } };
    h.view.catalog.rows = []; h.reconcilePreview();
    assert.equal(h.mediaPreview.open, false);
    assert.equal(h.mediaPreview.querySelector('.preview-cached-img'), null);
  }
});

test('no_thumbnail completion polling reloads the filtered list while preserving its open preview', async () => {
  const h = ready(); h.view.catalogScope = 'no_thumbnail'; h.openCatalogPreview('remote:one');
  h.setFetch(url => ({ ok: true, status: 200, json: async () => url.includes('/jobs/thumbnails')
    ? { id: 30, kind: 'thumbnails-remote', lane: 'remote', status: 'queued' } : h.state }));
  await h.generateCatalogThumbnail(sha);
  const job = { id: 30, kind: 'thumbnails-remote', lane: 'remote', status: 'done', result: { generated: 1, items: [{ sha, status: 'generated' }] } };
  const completed = { ...h.state, jobs: { local: null, remote: job, exclusive: null }, activeJobs: { local: null, remote: null, exclusive: null }, job };
  const filtered = { ...h.view.catalog, rows: [], total: 0 };
  h.setFetch(url => ({ ok: true, status: 200, json: async () => url.includes('/state') ? completed : filtered }));
  await h.syncState();
  assert.equal(h.view.catalog.rows.length, 0);
  assert.equal(h.mediaPreview.open, true);
  assert.equal(h.currentPreviewFile().id, 'remote:one');
  assert.equal(h.mediaPreview.querySelector('.preview-cached-img').getAttribute('src'), `/thumbnails/${sha}-v1.jpg`);
});
