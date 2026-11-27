'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Use the incumbent DOM fixture without modifying it or running its tests.
let fixture = fs.readFileSync(path.join(__dirname, 'test_media_preview.cjs'), 'utf8').split("\ntest('")[0];
fixture = fixture.replace('      chooseEvent,', '      chooseEvent, startIncomingUpload, cancelIncomingUpload, collectIncomingDrop, activeJobsBar, patchIncomingUpload, deviceExtension, deviceStem, deviceUploadBytes, actions, setUploadDelay(fn) { deviceUploadDelay = fn; },');
fixture = fixture.replace('    window: win,', '    AbortController, window: win,');
const context = { require, __dirname, console, setImmediate, URLSearchParams, AbortController };
vm.createContext(context);
vm.runInContext(fixture, context);
const { createHarness, makeIncoming } = vm.runInContext('({ createHarness, makeIncoming })', context);

function file(name, size = 6) {
  return { name, size, lastModified: 1740000000000, slice(start, end) { return { size: Math.min(size, end) - start }; } };
}
function reply(result, status = 200) { return { ok: status < 400, status, json: async () => result }; }
function ready() {
  const h = createHarness();
  h.view.connecting = false;
  h.view.deviceUpload.autoScan = false;
  h.view.deviceUpload.open = true;
  h.state.incoming = [makeIncoming('i1')];
  h.win.location.hash = '#incoming';
  h.render();
  h.setUploadDelay(async () => {});
  return h;
}
function server(h, hook = () => null) {
  const sessions = new Map(), created = [], puts = [], deletes = [], scans = [], gets = [];
  let serial = 0;
  h.setFetch(async (url, opts) => {
    const injected = await hook(url, opts, sessions);
    if (injected) return injected;
    if (url === '/api/state') return reply({ ...h.state });
    if (url === '/api/jobs/scan') { scans.push(url); return reply({ id: 90 }); }
    if (!url.startsWith('/api/incoming/uploads')) return new Promise(() => {});
    if (url === '/api/incoming/uploads' && opts.method === 'POST') {
      const body = JSON.parse(opts.body), uploadId = String(++serial).padStart(32, '0');
      sessions.set(uploadId, { ...body, receivedBytes: 0 });
      created.push(body);
      return reply({ uploadId, receivedBytes: 0, expectedSize: body.size, chunkSize: 2, maxChunkBytes: 4 }, 201);
    }
    const id = url.split('/')[4], session = sessions.get(id);
    if (opts.method === 'DELETE') { deletes.push(id); sessions.delete(id); return reply({ cancelled: true }); }
    if (opts.method === 'GET') { gets.push(id); return reply(session); }
    if (opts.method === 'PUT') {
      const offset = Number(new URLSearchParams(url.split('?')[1]).get('offset'));
      puts.push({ id, offset, size: opts.body.size });
      if (offset !== session.receivedBytes) return reply({ expectedOffset: session.receivedBytes }, 409);
      session.receivedBytes += opts.body.size;
      return reply({ receivedBytes: session.receivedBytes });
    }
    if (url.endsWith('/complete')) {
      return reply({ name: session.name, folder: session.folder, originalName: session.name, path: session.folder + '/' + session.name, renamed: false, sizeBytes: session.size }, 201);
    }
    throw new Error('unexpected request ' + url);
  });
  return { sessions, created, puts, deletes, scans, gets };
}

test('persistent upload shell, file input without accept, folder focus and thumbnails survive polling', () => {
  const h = ready();
  const ids = ['incoming-upload-panel', 'incoming-upload-input', 'incoming-upload-folder', 'incoming-upload-autoscan'];
  const nodes = ids.map(id => h.page.querySelector('#' + id));
  const image = h.page.querySelector('img');
  const folder = nodes[2];
  folder.value = 'trip';
  folder.dispatchEvent({ type: 'input', target: folder });
  folder.focus();
  h.render(); h.render();
  ids.forEach((id, index) => assert.equal(h.page.querySelector('#' + id), nodes[index]));
  assert.equal(h.doc.activeElement, folder);
  assert.equal(folder.value, 'trip');
  assert.equal(nodes[1].getAttribute('accept'), null);
  assert.equal(h.page.querySelector('img'), image);
  assert.match(h.page.textContent, /현재 항목/);
});

test('Safari picker clicks synchronously and change clears input before upload work', async () => {
  const h = ready(), api = server(h);
  const input = h.page.querySelector('#incoming-upload-input');
  let clicked = false;
  input.click = () => { clicked = true; };
  h.page.dispatchEvent({ type: 'click', target: h.page.querySelector('[data-action="choose-incoming-upload-files"]') });
  assert.equal(clicked, true);
  input.files = [file('a.jpg')]; input.value = 'selected';
  input.dispatchEvent({ type: 'change', target: input });
  assert.equal(input.value, '');
  for (let i = 0; i < 30 && h.view.deviceUpload.running; i++) await new Promise(setImmediate);
  assert.equal(h.view.deviceUpload.running, false);
  assert.equal(api.created.length, 1);
});

test('multiple chunks and mixed batch partial failure preserve result details and thumbnails', async () => {
  const h = ready();
  const image = h.page.querySelector('img');
  let opened = false;
  const api = server(h, (url, opts) => {
    if (url === '/api/incoming/uploads' && opts.method === 'POST' && JSON.parse(opts.body).name === 'broken.mov') return reply({ detail: '저장 실패' }, 507);
    const details = h.page.querySelector('#incoming-upload-result-items');
    if (details) { details.open = true; opened = true; }
  });
  await h.startIncomingUpload([file('side.xmp'), file('broken.mov'), file('a.jpg'), file('raw.dng'), file('empty.jpg', 0)]);
  assert.deepEqual(api.puts.map(item => item.offset), [0, 2, 4, 0, 2, 4]);
  assert.deepEqual(Array.from(h.view.deviceUpload.results, item => item.status).sort(), ['done', 'done', 'failed', 'skipped', 'skipped']);
  assert.equal(opened, true);
  assert.equal(h.page.querySelector('#incoming-upload-result-items').open, true);
  assert.equal(h.page.querySelector('img'), image);
  assert.ok(h.page.querySelector('.device-upload-progress'));
});

test('companion mapping follows renamed exact filename and unambiguous stem', async () => {
  const h = ready();
  const api = server(h, (url, opts, sessions) => {
    if (url.endsWith('/complete')) {
      const session = sessions.get(url.split('/')[4]);
      if (session.name === 'IMG_0001.HEIC') return reply({ name: 'IMG_0001 (1).HEIC', renamed: true }, 201);
    }
  });
  await h.startIncomingUpload([file('IMG_0001.xmp'), file('IMG_0001.HEIC.xmp'), file('IMG_0001.HEIC'), file('IMG_0001.MOV', 0)]);
  assert.deepEqual(api.created.map(item => item.name), ['IMG_0001.HEIC', 'IMG_0001 (1).xmp', 'IMG_0001 (1).HEIC.xmp']);
});

test('ambiguous stems remain unchanged while exact companions map to their own source', async () => {
  const h = ready();
  const api = server(h, (url, opts, sessions) => {
    if (url.endsWith('/complete')) {
      const session = sessions.get(url.split('/')[4]);
      if (session.name === 'IMG.HEIC') return reply({ name: 'IMG (1).HEIC', renamed: true }, 201);
      if (session.name === 'IMG.MOV') return reply({ name: 'IMG (2).MOV', renamed: true }, 201);
    }
  });
  await h.startIncomingUpload([file('IMG.xmp'), file('IMG.HEIC.xmp'), file('IMG.MOV'), file('IMG.HEIC')]);
  assert.deepEqual(api.created.map(item => item.name), ['IMG.HEIC', 'IMG.MOV', 'IMG.xmp', 'IMG (1).HEIC.xmp']);
});

test('AAE uploads follow a single renamed source by stem and exact filename', async () => {
  const h = ready();
  const api = server(h, (url, opts, sessions) => {
    if (url.endsWith('/complete')) {
      const session = sessions.get(url.split('/')[4]);
      if (session.name === 'IMG_0001.HEIC') return reply({ name: 'IMG_0001 (1).HEIC', renamed: true }, 201);
    }
  });
  await h.startIncomingUpload([file('IMG_0001.AAE'), file('IMG_0001.HEIC.AAE'), file('IMG_0001.HEIC')]);
  assert.deepEqual(api.created.map(item => item.name), ['IMG_0001.HEIC', 'IMG_0001 (1).AAE', 'IMG_0001 (1).HEIC.AAE']);
  assert.deepEqual(Array.from(h.view.deviceUpload.results, item => item.status), ['done', 'done', 'done']);
});

test('Live Photo AAE stems stay unchanged while exact AAE names follow each renamed source', async () => {
  const h = ready();
  const api = server(h, (url, opts, sessions) => {
    if (url.endsWith('/complete')) {
      const session = sessions.get(url.split('/')[4]);
      if (session.name === 'IMG.HEIC') return reply({ name: 'IMG (1).HEIC', renamed: true }, 201);
      if (session.name === 'IMG.MOV') return reply({ name: 'IMG (2).MOV', renamed: true }, 201);
    }
  });
  await h.startIncomingUpload([file('IMG.AAE'), file('IMG.HEIC.AAE'), file('IMG.MOV.aae'), file('IMG.MOV'), file('IMG.HEIC')]);
  assert.deepEqual(api.created.map(item => item.name), ['IMG.HEIC', 'IMG.MOV', 'IMG.AAE', 'IMG (1).HEIC.AAE', 'IMG (2).MOV.aae']);
  assert.ok(Array.from(h.view.deviceUpload.results).every(item => item.status === 'done'));
});

test('transient network failure synchronizes GET offset before resuming', async () => {
  const h = ready();
  let failed = false;
  const delays = [];
  h.setUploadDelay(async ms => delays.push(ms));
  const api = server(h, (url, opts, sessions) => {
    if (opts.method === 'PUT' && !failed) {
      failed = true;
      sessions.get(url.split('/')[4]).receivedBytes = 2;
      throw new TypeError('network disconnected after server accepted chunk');
    }
  });
  await h.startIncomingUpload([file('a.jpg')]);
  assert.equal(api.gets.length, 1);
  assert.deepEqual(api.puts.map(item => item.offset), [2, 4]);
  assert.deepEqual(delays, [800]);
  assert.equal(h.view.deviceUpload.uploadedBytes, 6);
});

test('409 expectedOffset resumes and repeated failures stop after two retries', async () => {
  const h = ready();
  let first = true;
  const api = server(h, (url, opts, sessions) => {
    if (opts.method === 'PUT' && first) {
      first = false; sessions.get(url.split('/')[4]).receivedBytes = 2;
      return reply({ expectedOffset: 2 }, 409);
    }
  });
  await h.startIncomingUpload([file('a.jpg')]);
  assert.deepEqual(api.puts.map(item => item.offset), [2, 4]);
  let attempts = 0;
  const second = server(h, (_url, opts) => { if (opts.method === 'PUT') { attempts++; return reply({ detail: 'unavailable' }, 503); } });
  await h.startIncomingUpload([file('b.jpg')]);
  assert.equal(attempts, 3);
  assert.equal(second.gets.length, 2);
  assert.equal(second.deletes.length, 1);
  assert.equal(h.view.deviceUpload.results[0].status, 'failed');
});

test('cancellation aborts current request, DELETEs session and marks pending files cancelled', async () => {
  const h = ready();
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const api = server(h, (_url, opts) => {
    if (opts.method === 'PUT') {
      entered();
      return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => {
        const error = new Error('aborted'); error.name = 'AbortError'; reject(error);
      }));
    }
  });
  const batch = h.startIncomingUpload([file('a.jpg'), file('b.jpg')]);
  await started;
  assert.match(h.activeJobsBar(), /기기 업로드/);
  await h.cancelIncomingUpload();
  await batch;
  assert.ok(api.deletes.length >= 1);
  assert.deepEqual(Array.from(h.view.deviceUpload.results, item => item.status), ['cancelled', 'cancelled']);
  assert.equal(h.view.deviceUpload.running, false);
  assert.equal(h.activeJobsBar(), '');
});

test('successful batch auto scans with remote jobs and defers for local or exclusive jobs', async () => {
  for (const lane of ['none', 'remote', 'local', 'exclusive']) {
    const h = ready(), api = server(h);
    h.view.deviceUpload.autoScan = true;
    if (lane === 'remote' || lane === 'local') h.state.activeJobs[lane] = { id: 4, kind: lane === 'local' ? 'move' : 'upload', status: 'running', result: {} };
    if (lane === 'exclusive') {
      // A reset starts after transfer begins; the completion must not submit scan.
      const original = h.setUploadDelay;
      assert.ok(original);
      server(h, (url) => {
        if (url.endsWith('/complete')) h.view.catalogOpBusy = true;
      });
    }
    await h.startIncomingUpload([file('a.jpg')]);
    if (lane === 'none' || lane === 'remote') assert.equal(api.scans.length, 1, lane);
    else assert.match(h.view.deviceUpload.scanNote, /진행 중인 로컬 작업/);
  }
});

test('exclusive blocks starting while local/remote jobs permit uploads and autoScan=false submits none', async () => {
  const h = ready(), api = server(h);
  h.state.activeJobs.exclusive = { id: 1, kind: 'reset-all', status: 'running' };
  await h.startIncomingUpload([file('a.jpg')]);
  assert.equal(api.created.length, 0);
  h.state.activeJobs.exclusive = null;
  h.state.activeJobs.local = { id: 2, kind: 'scan', status: 'running' };
  await h.startIncomingUpload([file('a.jpg')]);
  assert.equal(api.created.length, 1);
  assert.equal(api.scans.length, 0);
});

test('drop recursively reads directory batches, excludes hidden entries and keeps folders', async () => {
  const h = ready();
  const leaf = name => ({ name, isFile: true, file(resolve) { resolve(file(name)); } });
  let read = 0;
  const folder = { name: 'trip', isDirectory: true, createReader() { return { readEntries(resolve) { resolve(read++ === 0 ? [leaf('a.jpg'), leaf('.hidden.jpg')] : read === 2 ? [leaf('b.mov')] : []); } }; } };
  const entries = await h.collectIncomingDrop({ items: [{ webkitGetAsEntry: () => folder }] });
  assert.deepEqual(Array.from(entries, entry => [entry.file.name, entry.folder]), [['a.jpg', 'trip'], ['b.mov', 'trip']]);
  const fallback = await h.collectIncomingDrop({ files: [file('c.jpg'), file('.hidden')] });
  assert.deepEqual(Array.from(fallback, entry => entry.file.name), ['c.jpg']);
  const capped = await h.collectIncomingDrop({ files: Array.from({ length: 2001 }, (_, i) => file(i + '.jpg')) });
  assert.equal(capped.length, 2000);
});

test('extensionless and hidden picker files are excluded before API requests or byte accounting', async () => {
  const h = ready(), api = server(h);
  for (const name of ['mov', 'README', '.jpg']) {
    assert.equal(h.deviceExtension(name), '');
    assert.equal(h.deviceStem(name), name);
  }
  assert.equal(h.deviceExtension('photo.JPG'), 'jpg');
  assert.equal(h.deviceStem('photo.JPG'), 'photo');
  await h.startIncomingUpload(['mov', 'README', '.hidden.jpg', '.jpg'].map(name => file(name)));
  assert.equal(api.created.length, 0);
  assert.equal(h.view.deviceUpload.totalBytes, 0);
  assert.deepEqual(Array.from(h.view.deviceUpload.results, item => item.status), ['skipped', 'skipped', 'skipped', 'skipped']);
  assert.deepEqual(Object.fromEntries(Array.from(h.view.deviceUpload.results, item => [item.name, item.message])), {
    mov: '지원하지 않는 형식 제외', README: '지원하지 않는 형식 제외', '.hidden.jpg': '숨김 파일 제외', '.jpg': '숨김 파일 제외',
  });
});

test('live progress shows aggregate/current bytes, both progress bars and screen retention guidance', async () => {
  const h = ready();
  let entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  server(h, async (url, opts) => {
    if (opts.method === 'PUT' && url.endsWith('offset=2')) { entered(); await paused; }
  });
  const batch = h.startIncomingUpload([file('current.jpg')]);
  await waiting;
  try {
    const progress = h.page.querySelector('#incoming-upload-progress');
    assert.match(progress.textContent, /0\/1개 · 2 B \/ 6 B \(33%\)/);
    assert.match(progress.textContent, /current.jpg · 2 B \/ 6 B \(33%\)/);
    assert.match(progress.textContent, /업로드가 끝날 때까지 화면을 켜 두고 이 탭을 유지하세요./);
    const bars = progress.querySelectorAll('.device-upload-progress');
    assert.equal(bars.length, 2);
    assert.deepEqual(Array.from(bars, bar => bar.getAttribute('value')), ['33', '33']);
    for (const [bytes, label] of [[0, '0 B'], [1024, '1 KB'], [1024 ** 2, '1 MB'], [1024 ** 3, '1 GB']]) assert.equal(h.deviceUploadBytes(bytes), label);
  } finally {
    release();
    await batch;
  }
  assert.doesNotMatch(h.page.querySelector('#incoming-upload-progress').textContent, /이 탭을 유지/);
});

test('result summary counts each state and shows escaped destination paths and rename information', () => {
  const h = ready(), upload = h.view.deviceUpload;
  upload.batchId++;
  upload.results = [
    { name: 'plain.jpg', status: 'done', message: '완료', result: { name: 'plain.jpg', path: 'trip/plain.jpg' } },
    { name: 'IMG.HEIC', status: 'done', message: '완료', result: { name: 'IMG (1).HEIC', renamed: true, path: 'trip/IMG (1).HEIC' } },
    { name: 'bad.dng', status: 'skipped', message: '지원하지 않는 형식 제외' },
    { name: 'failed.mov', status: 'failed', message: '쓰기 실패' },
    { name: 'cancelled.jpg', status: 'cancelled', message: '중지됨' },
  ];
  h.patchIncomingUpload();
  const details = h.page.querySelector('#incoming-upload-result-items');
  assert.match(details.querySelector('summary').textContent, /완료 2개 · 이름 변경 1개 · 제외 1개 · 실패 1개 · 취소 1개/);
  assert.match(details.textContent, /저장 경로: trip\/plain.jpg/);
  assert.match(details.textContent, /이름 변경: IMG.HEIC → trip\/IMG \(1\).HEIC/);
  assert.equal(details.open, true);
  upload.results = [{ name: '<file>.jpg', status: 'done', message: '완료', result: { name: '<file>.jpg', path: 'trip/<file>.jpg' } }];
  h.patchIncomingUpload();
  const rendered = h.page.querySelector('#incoming-upload-result-items');
  assert.match(rendered.textContent, /trip\/<file>.jpg/);
  assert.equal(rendered.querySelector('file'), null);
  assert.doesNotMatch(rendered.querySelector('summary').textContent, /실패|제외|취소|이름 변경/);
});

test('attention results auto expand once per batch and retain user folding across polls and result changes', () => {
  const h = ready(), upload = h.view.deviceUpload;
  for (const attention of [
    { name: 'a.jpg', status: 'failed', message: '실패' },
    { name: 'a.dng', status: 'skipped', message: '제외' },
    { name: 'a.jpg', status: 'done', message: '완료', result: { name: 'a (1).jpg', path: 'trip/a (1).jpg', renamed: true } },
  ]) {
    upload.batchId++;
    upload.results = [{ name: 'ok.jpg', status: 'done', message: '완료' }];
    h.patchIncomingUpload();
    assert.equal(h.page.querySelector('#incoming-upload-result-items').open, false);
    upload.results.push(attention);
    h.patchIncomingUpload();
    let details = h.page.querySelector('#incoming-upload-result-items');
    assert.equal(details.open, true);
    details.open = false;
    details.dispatchEvent({ type: 'toggle', target: details });
    h.render(); h.render(); h.render();
    assert.equal(h.page.querySelector('#incoming-upload-result-items'), details);
    assert.equal(details.open, false);
    upload.results.push({ name: 'later.jpg', status: 'failed', message: '다른 실패' });
    h.patchIncomingUpload();
    details = h.page.querySelector('#incoming-upload-result-items');
    assert.equal(details.open, false);
    details.open = true;
    details.dispatchEvent({ type: 'toggle', target: details });
    upload.scanNote = '완료';
    h.patchIncomingUpload(); h.render();
    assert.equal(h.page.querySelector('#incoming-upload-result-items').open, true);
  }
});

test('lastModified fractions are truncated and nonfinite values become null', async () => {
  const h = ready(), api = server(h);
  await h.startIncomingUpload([
    { ...file('fraction.jpg'), lastModified: 1740000000000.75 },
    { ...file('infinite.jpg'), lastModified: Infinity },
    { ...file('missing.jpg'), lastModified: undefined },
  ]);
  assert.deepEqual(api.created.map(item => item.last_modified_ms), [1740000000000, null, null]);
});

test('cancel cleanup failure refreshes its warning immediately', async () => {
  const h = ready();
  server(h, (_url, opts) => opts.method === 'DELETE' ? reply({ detail: 'unavailable' }, 503) : null);
  h.view.deviceUpload.running = true;
  h.view.deviceUpload.activeUploadId = '1'.repeat(32);
  await h.cancelIncomingUpload();
  assert.match(h.page.querySelector('#incoming-upload-results').textContent, /임시 업로드 정리를 확인하지 못했습니다/);
  h.view.deviceUpload.running = false;
});
