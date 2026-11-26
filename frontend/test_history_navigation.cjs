'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, actions, loadJobs, openThumbnailBatchDialog,');
const context = { require, __dirname, console, setImmediate, URLSearchParams };
vm.createContext(context); vm.runInContext(fixture, context);
const { createHarness } = vm.runInContext('({ createHarness })', context);
const reply = data => ({ ok: true, json: async () => data });

for (const more of [true, false]) test(`archive tab cancels ${more ? 'pagination' : 'refresh'} without losing the loaded list`, async () => {
  const h = createHarness();
  h.win.location.hash = '#jobs'; h.view.page = 'jobs'; h.view.jobsTab = 'list';
  Object.assign(h.view.jobs, { items: [{ id: 123, kind: 'upload', lane: 'remote', status: 'failed', result: {} }], hasMore: true, nextBeforeId: 123, statusFilter: 'attention', laneFilter: 'remote' });
  h.render();
  const items = h.view.jobs.items;
  let release;
  h.setFetch(() => new Promise(resolve => { release = () => resolve(reply({ jobs: [], hasMore: false, summary: {} })); }));
  const pending = more ? h.actions['load-more-jobs']() : h.loadJobs({ preserveLoaded: true });
  assert.equal(h.view.jobs.loadingMore, more); assert.equal(h.view.jobs.busy, !more);
  h.setFetch(() => reply({ view: 'archives', rows: [], summary: {}, archiveSelection: { total: 0 }, folders: [], missingThumbnails: { total: 0 } }));
  await h.actions['open-job-archives']('123');
  assert.equal(h.view.jobs.busy, false); assert.equal(h.view.jobs.loadingMore, false);
  await h.actions['jobs-tab']('list');
  release(); await pending;
  assert.equal(h.view.jobs.items, items);
  assert.equal(h.view.jobs.nextBeforeId, 123); assert.equal(h.view.jobs.hasMore, true);
  assert.equal(h.view.jobs.statusFilter, 'attention'); assert.equal(h.view.jobs.laneFilter, 'remote');
  assert.equal(h.view.catalogJobId, 123);
  assert.equal(h.page.querySelector('[data-action="load-more-jobs"]').disabled, false);
  assert.equal(h.view.jobs.loadingMore, false); assert.equal(h.view.jobs.busy, false);
});

for (const [tab, event, folder, expectedScope, jobLabel] of [
  ['files', 'all', '', 'all', false], ['files', 'event-a', '', 'folder', false],
  ['remote', 'all', '', 'all', false], ['remote', 'all', 'NAS/photos', 'folder', false],
  ['archives', 'all', '', 'folder', true],
]) test(`stored archive selection labels only actual ${tab} thumbnail range (${event}/${folder})`, async () => {
  const h = createHarness();
  h.win.location.hash = tab === 'archives' ? '#jobs' : '#catalog';
  Object.assign(h.view, { page: tab === 'archives' ? 'jobs' : 'catalog', jobsTab: 'archives', catalogTab: tab, catalogJobId: 123, catalogEvent: event, catalogDevice: '', catalogRemoteFolder: folder });
  h.setFetch(() => reply({ total: 1, local: 1, remotePhotos: 0, remoteVideos: 0, lane: 'local', estimatedBytes: 1 }));
  await h.openThumbnailBatchDialog('folder');
  const body = JSON.parse(h.fetchCalls.at(-1).opts.body);
  assert.equal(body.scope, expectedScope); assert.equal(body.view, tab);
  assert.equal(body.event, event); assert.equal(body.folder, folder);
  assert.equal(body.job_id, jobLabel ? 123 : undefined);
  assert.equal(h.dialog.textContent.includes('작업 #123'), jobLabel);
  assert.equal(!!h.dialog.querySelector('[name="thumbnail_scope"]'), expectedScope === 'folder');
  assert.equal(h.view.catalogJobId, 123);
});
