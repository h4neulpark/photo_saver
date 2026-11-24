'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP_SOURCE = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

function decodeEntities(text) {
  return String(text)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function kebabCase(name) {
  return name.replace(/[A-Z]/g, ch => `-${ch.toLowerCase()}`);
}

const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'source', 'meta', 'link', 'circle', 'path', 'rect']);

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = { capture: new Map(), bubble: new Map() };
    this._text = '';
    this.open = false;
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.value = '';
    this.isContentEditable = false;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.currentTime = 0;
    this.mediaLog = [];
    this.focusCalls = [];

    const self = this;
    this.dataset = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        return self.attributes.get(`data-${kebabCase(prop)}`);
      },
      set(_target, prop, value) {
        self.attributes.set(`data-${kebabCase(String(prop))}`, String(value));
        return true;
      },
      deleteProperty(_target, prop) {
        self.attributes.delete(`data-${kebabCase(String(prop))}`);
        return true;
      },
    });
    this.classList = {
      add(...names) {
        const set = new Set((self.attributes.get('class') || '').split(/\s+/).filter(Boolean));
        for (const n of names) set.add(n);
        self.attributes.set('class', [...set].join(' '));
      },
      remove(...names) {
        const set = new Set((self.attributes.get('class') || '').split(/\s+/).filter(Boolean));
        for (const n of names) set.delete(n);
        self.attributes.set('class', [...set].join(' '));
      },
      contains(name) {
        return (self.attributes.get('class') || '').split(/\s+/).includes(name);
      },
    };
  }

  get id() {
    return this.attributes.get('id') || '';
  }

  set id(val) {
    this.attributes.set('id', String(val));
  }

  get hidden() {
    return this.attributes.has('hidden');
  }

  set hidden(val) {
    if (val) this.attributes.set('hidden', '');
    else this.attributes.delete('hidden');
  }

  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur === this.ownerDocument.body) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map(child => child.textContent).join('');
  }

  set textContent(val) {
    this.replaceChildren();
    this._text = String(val ?? '');
  }

  get innerHTML() {
    return this._rawHtml || '';
  }

  set innerHTML(html) {
    this._rawHtml = String(html);
    this.replaceChildren();
    this._text = '';
    parseHtmlInto(this, this._rawHtml, this.ownerDocument);
  }

  getAttribute(name) {
    const key = name.toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  setAttribute(name, value) {
    const key = name.toLowerCase();
    this.attributes.set(key, String(value));
    if (key === 'disabled') this.disabled = true;
    if (key === 'value') this.value = String(value);
  }

  removeAttribute(name) {
    const key = name.toLowerCase();
    this.mediaLog.push(`removeAttribute:${key}`);
    this.attributes.delete(key);
    if (key === 'disabled') this.disabled = false;
  }

  pause() {
    this.mediaLog.push('pause');
  }

  load() {
    this.mediaLog.push('load');
  }

  scrollTo(xOrOpts, y) {
    if (typeof xOrOpts === 'object' && xOrOpts) {
      if (typeof xOrOpts.left === 'number') this.scrollLeft = xOrOpts.left;
      if (typeof xOrOpts.top === 'number') this.scrollTop = xOrOpts.top;
    } else {
      this.scrollLeft = xOrOpts || 0;
      this.scrollTop = y || 0;
    }
  }

  focus(options) {
    this.focusCalls.push(options || null);
    this.ownerDocument.activeElement = this;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this._text = '';
    for (const node of nodes) this.appendChild(node);
  }

  contains(other) {
    let cur = other;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  showModal() {
    this.open = true;
  }

  close() {
    if (!this.open) return;
    this.open = false;
    if (this.ownerDocument.deferCloseEvent) {
      this.ownerDocument.pendingCloseEvents.push(() => this.dispatchEvent({ type: 'close', target: this }));
    } else {
      this.dispatchEvent({ type: 'close', target: this });
    }
  }

  addEventListener(type, handler, capture = false) {
    const bucket = capture ? this.listeners.capture : this.listeners.bubble;
    if (!bucket.has(type)) bucket.set(type, []);
    bucket.get(type).push(handler);
  }

  dispatchEvent(event) {
    const ev = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...event,
      target: event.target || this,
    };
    const pathNodes = [];
    let cur = ev.target;
    while (cur) {
      pathNodes.push(cur);
      cur = cur.parentElement;
    }
    if (!pathNodes.includes(this)) pathNodes.push(this);

    for (let i = pathNodes.length - 1; i >= 0; i -= 1) {
      const node = pathNodes[i];
      const handlers = node.listeners.capture.get(ev.type) || [];
      for (const fn of handlers) fn.call(node, ev);
    }
    for (let i = 0; i < pathNodes.length; i += 1) {
      const node = pathNodes[i];
      const handlers = node.listeners.bubble.get(ev.type) || [];
      for (const fn of handlers) fn.call(node, ev);
    }
    return !ev.defaultPrevented;
  }

  matches(selectorList) {
    return selectorList.split(',').some(sel => matchesComplexSelector(this, sel.trim()));
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matchesSimpleSelector(el, simple) {
  let rest = simple;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) {
    if (el.tagName !== tagMatch[0].toUpperCase()) return false;
    rest = rest.slice(tagMatch[0].length);
  }
  while (rest.length) {
    if (rest[0] === '#') {
      const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
      if (!m || el.id !== m[1]) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '.') {
      const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!m || !el.classList.contains(m[1])) return false;
      rest = rest.slice(m[0].length);
    } else if (rest[0] === '[') {
      const m = rest.match(/^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/);
      if (!m) return false;
      const attr = m[1].toLowerCase();
      if (!el.attributes.has(attr)) return false;
      if (m[2] !== undefined && el.attributes.get(attr) !== m[2]) return false;
      rest = rest.slice(m[0].length);
    } else {
      return false;
    }
  }
  return true;
}

function matchesComplexSelector(el, selector) {
  const parts = selector.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (!matchesSimpleSelector(el, parts[parts.length - 1])) return false;
  let cur = el.parentElement;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    while (cur && !matchesSimpleSelector(cur, parts[i])) cur = cur.parentElement;
    if (!cur) return false;
    cur = cur.parentElement;
  }
  return true;
}

function parseHtmlInto(root, html, ownerDocument) {
  const stack = [root];
  const tokenRe = /<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)([^>]*?)(\/?)>|([^<]+)/g;
  let match;
  while ((match = tokenRe.exec(html)) !== null) {
    if (match[1]) {
      const closing = match[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === closing) {
          stack.length = i;
          break;
        }
      }
    } else if (match[2]) {
      const tag = match[2].toLowerCase();
      const attrStr = match[3] || '';
      const selfClosing = Boolean(match[4]) || VOID_TAGS.has(tag);
      const el = new FakeElement(tag, ownerDocument);
      const attrRe = /([a-zA-Z0-9_:-]+)(?:\s*=\s*"([^"]*)")?/g;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) {
        const attrName = am[1].toLowerCase();
        const attrVal = am[2] !== undefined ? decodeEntities(am[2]) : '';
        el.setAttribute(attrName, attrVal);
      }
      stack[stack.length - 1].appendChild(el);
      if (!selfClosing) stack.push(el);
    } else if (match[5]) {
      const text = decodeEntities(match[5]);
      if (text) stack[stack.length - 1]._text += text;
    }
  }
}

function createHarness(fetchImpl) {
  const doc = {
    title: '',
    activeElement: null,
    deferCloseEvent: false,
    pendingCloseEvents: [],
    body: null,
    byId: new Map(),
    getElementById(id) { return this.byId.get(id) || null; },
    querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
    createElement(tag) { return new FakeElement(tag, this); },
  };
  doc.body = new FakeElement('body', doc);
  for (const id of ['page', 'navigation', 'dialog', 'media-preview', 'notice']) {
    const tag = (id === 'dialog' || id === 'media-preview') ? 'dialog' : 'div';
    const el = new FakeElement(tag, doc);
    el.id = id;
    doc.body.appendChild(el);
    doc.byId.set(id, el);
  }

  const fetchCalls = [];
  const defaultFetch = (url, opts) => {
    fetchCalls.push({ url, opts: opts || {} });
    if (fetchImpl) return fetchImpl(url, opts || {});
    return new Promise(() => {}); // Isolate bootstrap fetch so no timers/requests run.
  };

  const windowListeners = new Map();
  const storage = new Map();
  const win = {
    location: { hash: '#events' },
    scrollTo() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchHashChange(hash) {
      win.location.hash = hash;
      for (const fn of windowListeners.get('hashchange') || []) fn();
    },
  };

  const context = {
    window: win,
    document: doc,
    location: win.location,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    fetch: defaultFetch,
    Intl,
    URLSearchParams,
    Blob: class FakeBlob {},
    FormData: class FakeFormData {},
    setTimeout: win.setTimeout,
    clearTimeout: win.clearTimeout,
    console,
  };
  vm.createContext(context);
  vm.runInContext(APP_SOURCE, context, { filename: 'app.js' });

  const api = vm.runInContext(
    `({
      state, view, page, mediaPreview, notice,
      render, syncState, loadRoute, clearCatalogViews,
      openIncomingPreview, openManagedPreview, currentPreviewFile,
      stepPreview, closeMediaPreview, reconcilePreview, retryPreview,
      requestPreviewDelete, performPreviewDelete, disposePreviewMedia,
      chooseEvent,
    })`,
    context,
  );

  return { ...api, doc, win, fetchCalls, setFetch(fn) { fetchImpl = fn; } };
}

function makeManaged(id, overrides = {}) {
  return {
    id,
    name: `${id}.mp4`,
    path: `${id}/${id}.mp4`,
    kind: 'video',
    status: 'available',
    size: 12.5,
    device: 'Sony A7',
    deviceFolder: 'Sony A7',
    time: '2026-06-01T10:00:00+00:00',
    timeVerified: true,
    reviewReason: null,
    timeSource: '영상 메타데이터',
    timeCandidates: { metadata: null, xmp: null, modified: null },
    eventId: 'ev1',
    confirmed: false,
    archived: false,
    canDownload: false,
    canOffload: false,
    xmpArchived: true,
    remotePaths: [],
    thumbnail: `/thumbnails/${id}.jpg`,
    preview: `/api/managed/${id}/preview`,
    original: `/api/managed/${id}/original`,
    analysisError: null,
    xmp: null,
    ...overrides,
  };
}

function makeIncoming(id, overrides = {}) {
  return {
    id,
    name: `inc_${id}.jpg`,
    folder: 'day1',
    kind: 'photo',
    modifiedAt: '2026-06-01T10:00:00+00:00',
    size: 2.4,
    thumbnail: `/thumbnails/inc_${id}.jpg`,
    preview: `/api/incoming/${id}/preview`,
    original: `/api/incoming/${id}/original`,
    status: 'ready',
    reason: '',
    xmp: null,
    cameraAuxCount: 0,
    ...overrides,
  };
}

function flushMicrotasks() {
  return new Promise(resolve => setImmediate(resolve));
}

test('distinguishes identical IDs across incoming and managed sources', () => {
  const h = createHarness();
  h.state.events = [{ id: 'ev1', name: '제주 여행', folder: '260601_제주 여행', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' }];
  h.state.incoming = [makeIncoming('same-id', { name: 'incoming-photo.jpg' })];
  h.state.managed = [makeManaged('same-id', { name: 'managed-clip.mov', path: 'custom/managed-clip.mov' })];
  h.view.eventId = 'ev1';
  h.render();

  h.openManagedPreview('same-id');
  assert.equal(h.view.preview.source, 'managed');
  assert.equal(h.currentPreviewFile().name, 'managed-clip.mov');
  assert.equal(h.mediaPreview.querySelector('#media-preview-title').textContent, 'managed-clip.mov');
  assert.match(h.mediaPreview.querySelector('.preview-meta').textContent, /managed\/custom\/managed-clip\.mov/);
  assert.match(h.mediaPreview.querySelector('.preview-meta').textContent, /260601_제주 여행/);
  assert.equal(h.mediaPreview.querySelector('[data-action="request-preview-delete"]'), null);

  h.openIncomingPreview('same-id');
  assert.equal(h.view.preview.source, 'incoming');
  assert.equal(h.currentPreviewFile().name, 'incoming-photo.jpg');
  assert.equal(h.mediaPreview.querySelector('#media-preview-title').textContent, 'incoming-photo.jpg');
  assert.ok(h.mediaPreview.querySelector('[data-action="request-preview-delete"]'));
});

test('navigates filtered managed local list in order, skips archived, respects boundaries, preserves selection/filters/scroll', () => {
  const h = createHarness();
  h.state.events = [{ id: 'ev1', name: 'Trip', folder: '260601_Trip', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' }];
  h.state.managed = [
    makeManaged('m1', { name: 'a.jpg', kind: 'photo', device: 'Sony', thumbnail: null }),
    makeManaged('m-arch', { name: 'b.mp4', status: 'archived', preview: null, original: null, device: 'Sony', canDownload: true }),
    makeManaged('m2', { name: 'c.mp4', kind: 'video', device: 'GoPro' }),
    makeManaged('m3', { name: 'd.mp4', kind: 'video', device: 'Sony' }),
  ];
  h.view.eventId = 'ev1';
  h.view.eventDevice = 'device:Sony';
  h.view.eventSelection.add('m1');
  h.view.eventSelection.add('m-arch');
  h.view.eventTarget = 'ev1';
  h.render();

  const eventRows = h.page.querySelector('#event-rows');
  eventRows.scrollTop = 240;
  eventRows.scrollLeft = 15;

  // Archived row has non-interactive thumb + local-original-missing notice; thumbnail-less available row still has button
  const managedButtons = h.page.querySelectorAll('[data-action="preview-managed"]');
  assert.deepEqual(managedButtons.map(b => b.dataset.value), ['m1', 'm3']);
  assert.equal(managedButtons[0].getAttribute('data-card-preview'), null);
  assert.match(h.page.textContent, /로컬 원본 없음/);

  const callsBefore = h.fetchCalls.length;
  h.openManagedPreview('m1');
  assert.deepEqual([...h.view.preview.ids], ['m1', 'm3']);
  assert.equal(h.view.preview.index, 0);
  assert.equal(h.mediaPreview.querySelector('[data-action="previous-preview"]').disabled, true);
  assert.equal(h.mediaPreview.querySelector('[data-action="next-preview"]').disabled, false);

  // Boundaries do not wrap
  h.stepPreview(-1);
  assert.equal(h.view.preview.index, 0);
  h.stepPreview(1);
  assert.equal(h.view.preview.index, 1);
  assert.equal(h.mediaPreview.querySelector('[data-action="next-preview"]').disabled, true);
  h.stepPreview(1);
  assert.equal(h.view.preview.index, 1);

  h.closeMediaPreview();
  h.render();

  // Selection, target, filters, scroll, and API requests remain untouched
  assert.deepEqual([...h.view.eventSelection], ['m1', 'm-arch']);
  assert.equal(h.view.eventDevice, 'device:Sony');
  assert.equal(h.view.eventTarget, 'ev1');
  assert.equal(h.page.querySelector('#event-rows').scrollTop, 240);
  assert.equal(h.page.querySelector('#event-rows').scrollLeft, 15);
  assert.equal(h.fetchCalls.length, callsBefore);
});

test('managed Delete/Backspace never deletes while incoming delete guard stays intact', async () => {
  const h = createHarness();
  h.state.events = [{ id: 'ev1', name: 'Trip', folder: '260601_Trip', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' }];
  h.state.managed = [makeManaged('m1', { kind: 'photo', name: 'p.jpg' })];
  h.state.incoming = [makeIncoming('i1', { kind: 'photo', status: 'ready' })];
  h.view.eventId = 'ev1';
  h.render();

  const callsBefore = h.fetchCalls.length;
  h.openManagedPreview('m1');
  for (const key of ['Delete', 'Backspace']) {
    h.mediaPreview.dispatchEvent({ type: 'keydown', key, target: h.mediaPreview });
  }
  h.requestPreviewDelete();
  await h.performPreviewDelete();
  assert.equal(h.view.preview.confirming, false);
  assert.equal(h.view.preview.busy, false);
  assert.equal(h.fetchCalls.length, callsBefore);

  // Incoming delete confirmation works and Esc cancels it
  h.openIncomingPreview('i1');
  h.mediaPreview.dispatchEvent({ type: 'keydown', key: 'Delete', target: h.mediaPreview });
  assert.equal(h.view.preview.confirming, true);
  assert.ok(h.mediaPreview.querySelector('[data-action="perform-preview-delete"]'));
  const cancelEvent = { type: 'cancel', target: h.mediaPreview };
  const notPrevented = h.mediaPreview.dispatchEvent(cancelEvent);
  assert.equal(notPrevented, false);
  assert.equal(h.view.preview.confirming, false);
});

test('protects keyboard arrow keys on VIDEO, form controls, contenteditable, and modifier combos', () => {
  const h = createHarness();
  h.state.managed = [makeManaged('m1'), makeManaged('m2')];
  h.view.eventId = 'all';
  h.render();
  h.openManagedPreview('m1');

  const video = h.mediaPreview.querySelector('video');
  const input = h.doc.createElement('input');
  const editable = h.doc.createElement('div');
  editable.isContentEditable = true;

  for (const target of [video, input, editable]) {
    h.mediaPreview.dispatchEvent({ type: 'keydown', key: 'ArrowRight', target });
    assert.equal(h.view.preview.index, 0);
  }
  h.mediaPreview.dispatchEvent({ type: 'keydown', key: 'ArrowRight', ctrlKey: true, target: h.mediaPreview });
  assert.equal(h.view.preview.index, 0);

  // Unmodified ArrowRight outside media/form steps to next item
  h.mediaPreview.dispatchEvent({ type: 'keydown', key: 'ArrowRight', target: h.mediaPreview });
  assert.equal(h.view.preview.index, 1);
});

test('disposes video on step/close/route change and handles rapid close+reopen without clobbering state', () => {
  const h = createHarness();
  h.doc.deferCloseEvent = true;
  h.state.managed = [makeManaged('m1'), makeManaged('m2')];
  h.view.eventId = 'all';
  h.render();

  h.openManagedPreview('m1');
  const video1 = h.mediaPreview.querySelector('video');
  assert.ok(video1);

  h.stepPreview(1);
  assert.deepEqual(video1.mediaLog, ['pause', 'removeAttribute:src', 'load']);
  assert.equal(video1.isConnected, false);

  const video2 = h.mediaPreview.querySelector('video');
  h.closeMediaPreview();
  assert.deepEqual(video2.mediaLog, ['pause', 'removeAttribute:src', 'load']);

  // Rapidly reopen before deferred native close event fires
  h.openManagedPreview('m1');
  assert.equal(h.mediaPreview.open, true);
  assert.equal(h.view.preview.ids[h.view.preview.index], 'm1');
  while (h.doc.pendingCloseEvents.length) h.doc.pendingCloseEvents.shift()();
  assert.equal(h.view.preview.ids[h.view.preview.index], 'm1');
  assert.ok(h.mediaPreview.querySelector('video'));

  // Route change disposes video cleanly
  const video3 = h.mediaPreview.querySelector('video');
  h.win.dispatchHashChange('#incoming');
  assert.deepEqual(video3.mediaLog, ['pause', 'removeAttribute:src', 'load']);
  assert.equal(h.view.preview, null);
});

test('restores focus to source-matched trigger or fallback when row disappears', () => {
  const h = createHarness();
  h.state.managed = [makeManaged('m1'), makeManaged('m2')];
  h.view.eventId = 'all';
  h.render();

  h.openManagedPreview('m1');
  h.closeMediaPreview();
  assert.equal(h.doc.activeElement.dataset.action, 'preview-managed');
  assert.equal(h.doc.activeElement.dataset.value, 'm1');
  assert.deepEqual({ ...h.doc.activeElement.focusCalls.at(-1) }, { preventScroll: true });

  // When original row disappears before close, falls back to #event-search
  h.openManagedPreview('m1');
  h.state.managed = [];
  h.render();
  h.closeMediaPreview();
  assert.equal(h.doc.activeElement.id, 'event-search');

  // Incoming focus restoration returns to incoming button
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [makeIncoming('i1')];
  h.render();
  h.openIncomingPreview('i1');
  h.closeMediaPreview();
  assert.equal(h.doc.activeElement.dataset.action, 'preview-incoming');
  assert.equal(h.doc.activeElement.dataset.value, 'i1');
});

test('preserves video element and playback time across state polls, reconciles removals and empty list', async () => {
  let snapshot;
  const h = createHarness(async url => {
    if (url === '/api/state') {
      return { ok: true, status: 200, json: async () => snapshot };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  h.state.events = [
    { id: 'ev1', name: 'Trip', folder: '260601_Trip', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' },
    { id: 'ev2', name: 'Dinner', folder: 'Dinner', parent: 'ev1', start: null, end: null, zone: null },
  ];
  h.state.managed = [makeManaged('m1'), makeManaged('m2'), makeManaged('m3')];
  h.view.eventId = 'all';
  h.render();

  h.openManagedPreview('m2');
  const video = h.mediaPreview.querySelector('video');
  video.currentTime = 42.5;

  // Poll updates metadata (event assignment + confirmation) and removes sibling m1 -> video node untouched
  snapshot = {
    timezone: 'Asia/Seoul',
    scan: null,
    job: null,
    events: h.state.events,
    incoming: [],
    pendingXmp: [],
    managed: [
      makeManaged('m1', { status: 'archived', preview: null, original: null }),
      makeManaged('m2', { eventId: 'ev2', confirmed: true }),
      makeManaged('m3'),
    ],
  };
  await h.syncState();
  assert.equal(h.mediaPreview.querySelector('video'), video);
  assert.equal(video.currentTime, 42.5);
  assert.deepEqual([...h.view.preview.ids], ['m2', 'm3']);
  assert.equal(h.view.preview.index, 0);
  assert.match(h.mediaPreview.querySelector('.preview-meta').textContent, /Dinner/);

  // Offloading current item m2 disposes old video and advances to m3
  snapshot = {
    ...snapshot,
    managed: [
      makeManaged('m2', { status: 'archived', preview: null, original: null }),
      makeManaged('m3'),
    ],
  };
  await h.syncState();
  assert.deepEqual(video.mediaLog, ['pause', 'removeAttribute:src', 'load']);
  assert.equal(h.view.preview.ids[h.view.preview.index], 'm3');

  // Removing all remaining items closes modal and announces notice
  snapshot = { ...snapshot, managed: [] };
  await h.syncState();
  assert.equal(h.view.preview, null);
  assert.equal(h.mediaPreview.open, false);
  assert.match(h.notice.textContent, /로컬 미리보기 가능한 파일이 없습니다/);
});

test('ignores stale errors/HEAD responses, diagnoses 404/403/409/200 without treating 200 as success, and supports safe retry', async () => {
  const headResolvers = [];
  const headRequests = [];
  let stateSnapshot;

  const h = createHarness((url, opts) => {
    if (opts.method === 'HEAD') {
      headRequests.push({ url, opts });
      return new Promise(resolve => headResolvers.push(resolve));
    }
    if (url === '/api/state') {
      return Promise.resolve({ ok: true, status: 200, json: async () => stateSnapshot });
    }
    return new Promise(() => {});
  });

  h.state.managed = [makeManaged('m1', { kind: 'video' }), makeManaged('m2', { kind: 'photo', name: 'pic.heic' })];
  h.view.eventId = 'all';
  h.render();

  h.openManagedPreview('m1');
  const video1 = h.mediaPreview.querySelector('video');
  // loadedmetadata hides loading indicator, but error listener remains active
  h.mediaPreview.dispatchEvent({ type: 'loadedmetadata', target: video1 });
  assert.equal(h.mediaPreview.querySelector('.preview-media-loading'), null);

  // Trigger error on m1 -> shows error UI, marks stage .is-error, and sends HEAD with cache: 'no-store'
  assert.equal(h.mediaPreview.querySelector('.preview-stage').classList.contains('is-error'), false);
  h.mediaPreview.dispatchEvent({ type: 'error', target: video1 });
  assert.equal(video1.hidden, true);
  assert.equal(h.mediaPreview.querySelector('.preview-stage').classList.contains('is-error'), true);
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, false);
  assert.equal(headRequests.length, 1);
  assert.equal(headRequests[0].url, '/api/managed/m1/original');
  assert.equal(headRequests[0].opts.cache, 'no-store');

  // Step to m2 BEFORE m1's HEAD resolves -> late HEAD response for m1 must NOT overwrite m2
  h.stepPreview(1);
  assert.equal(h.mediaPreview.querySelector('.preview-stage').classList.contains('is-error'), false);
  headResolvers.shift()({ status: 403 });
  await flushMicrotasks();
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, true);

  // Late error fired on detached video1 must be ignored
  h.mediaPreview.dispatchEvent({ type: 'error', target: video1 });
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, true);

  // Trigger error on m2 (HEIC photo) and resolve HEAD 200 -> keeps error visible with decode/conversion guidance
  const img2 = h.mediaPreview.querySelector('img');
  h.mediaPreview.dispatchEvent({ type: 'error', target: img2 });
  assert.equal(h.mediaPreview.querySelector('.preview-stage').classList.contains('is-error'), true);
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, false);
  headResolvers.shift()({ status: 200 });
  await flushMicrotasks();
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, false);
  assert.match(h.mediaPreview.querySelector('.preview-error-message').textContent, /변환할 수 없습니다/);

  // Retry syncs state and reloads current item (clears .is-error)
  stateSnapshot = {
    timezone: 'Asia/Seoul', scan: null, job: null, events: [], incoming: [], pendingXmp: [],
    managed: h.state.managed,
  };
  await h.retryPreview();
  const refreshedImg = h.mediaPreview.querySelector('img');
  assert.notEqual(refreshedImg, img2);
  assert.equal(h.mediaPreview.querySelector('.preview-stage').classList.contains('is-error'), false);
  assert.equal(h.mediaPreview.querySelector('.preview-media-error').hidden, true);

  // Trigger error + 409 diagnostic mentions Incoming Library refresh rescan path
  h.mediaPreview.dispatchEvent({ type: 'error', target: refreshedImg });
  headResolvers.shift()({ status: 409 });
  await flushMicrotasks();
  assert.match(h.mediaPreview.querySelector('.preview-error-message').textContent, /Incoming Library/);
});

test('R1: incoming delete preserves remaining list across running/deleting, running/deleted, failed/review, and immediate done', async () => {
  const queue = [];
  let nextJobId = 70;
  const h = createHarness(async (url, opts) => {
    if (url === '/api/jobs/delete' && opts.method === 'POST') {
      nextJobId += 1;
      return { ok: true, status: 202, json: async () => ({ id: nextJobId }) };
    }
    if (url === '/api/state') {
      assert.ok(queue.length > 0, 'expected queued state snapshot');
      const snap = queue.shift();
      return { ok: true, status: 200, json: async () => snap };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });

  const makeSnap = (incoming, job) => ({
    timezone: 'Asia/Seoul', scan: null, job, events: [], managed: [], pendingXmp: [], incoming,
  });

  // Case 1: 3-item list, running/deleting (i1.preview=null) -> done/deleted=1 -> advances to i2 without skipping it
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [
    makeIncoming('i1', { kind: 'photo', status: 'ready' }),
    makeIncoming('i2', { kind: 'photo', status: 'ready' }),
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ];
  h.render();
  h.openIncomingPreview('i1');
  h.requestPreviewDelete();

  queue.push(makeSnap([
    makeIncoming('i1', { kind: 'photo', status: 'deleting', preview: null, original: null }),
    makeIncoming('i2', { kind: 'photo', status: 'ready' }),
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ], { id: 71, kind: 'delete', status: 'running', result: {} }));
  await h.performPreviewDelete();
  assert.deepEqual([...h.view.preview.ids], ['i1', 'i2', 'i3']);
  assert.equal(h.view.preview.index, 0);
  assert.equal(h.view.preview.busy, true);
  assert.equal(h.view.preview.jobId, 71);
  assert.equal(h.view.preview.deletingId, 'i1');

  queue.push(makeSnap([
    makeIncoming('i2', { kind: 'photo', status: 'ready' }),
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ], { id: 71, kind: 'delete', status: 'done', result: { deleted: 1, review: 0 } }));
  await h.syncState();
  h.render();
  assert.deepEqual([...h.view.preview.ids], ['i2', 'i3']);
  assert.equal(h.view.preview.index, 0);
  assert.equal(h.view.preview.ids[h.view.preview.index], 'i2');
  assert.equal(h.view.preview.busy, false);
  assert.equal(h.view.preview.jobId, null);
  assert.equal(h.view.preview.deletingId, null);
  assert.match(h.view.preview.message, /삭제했습니다/);

  // Case 2: 2-item list [i2, i3], running/deleted (i2 already omitted) -> done/deleted=1 -> stays open on i3
  h.requestPreviewDelete();
  queue.push(makeSnap([
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ], { id: 72, kind: 'delete', status: 'running', result: {} }));
  await h.performPreviewDelete();
  assert.deepEqual([...h.view.preview.ids], ['i2', 'i3']);
  assert.equal(h.view.preview.busy, true);

  queue.push(makeSnap([
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ], { id: 72, kind: 'delete', status: 'done', result: { deleted: 1, review: 0 } }));
  await h.syncState();
  h.render();
  assert.ok(h.view.preview);
  assert.deepEqual([...h.view.preview.ids], ['i3']);
  assert.equal(h.view.preview.index, 0);
  assert.equal(h.view.preview.busy, false);

  // Case 3: failed job keeps item open with error message
  h.requestPreviewDelete();
  queue.push(makeSnap([
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
  ], { id: 73, kind: 'delete', status: 'failed', result: { error: '디스크 오류' } }));
  await h.performPreviewDelete();
  assert.deepEqual([...h.view.preview.ids], ['i3']);
  assert.equal(h.view.preview.busy, false);
  assert.equal(h.view.preview.message, '디스크 오류');

  // Case 4: review outcome (deleted=0, review=1, i3 becomes preview:null) advances to remaining item with message
  h.state.incoming = [
    makeIncoming('i3', { kind: 'photo', status: 'ready' }),
    makeIncoming('i4', { kind: 'photo', status: 'ready' }),
  ];
  h.render();
  h.openIncomingPreview('i3');
  h.requestPreviewDelete();
  queue.push(makeSnap([
    makeIncoming('i3', { kind: 'photo', status: 'review', preview: null, original: null }),
    makeIncoming('i4', { kind: 'photo', status: 'ready' }),
  ], { id: 74, kind: 'delete', status: 'done', result: { deleted: 0, review: 1 } }));
  await h.performPreviewDelete();
  assert.deepEqual([...h.view.preview.ids], ['i4']);
  assert.equal(h.view.preview.index, 0);
  assert.match(h.view.preview.message, /변경되었거나 삭제할 수 없습니다/);

  // Case 5: last item deleted with immediate done (skipping running poll) closes cleanly and restores connected focus
  h.requestPreviewDelete();
  queue.push(makeSnap([], { id: 75, kind: 'delete', status: 'done', result: { deleted: 1, review: 0 } }));
  await h.performPreviewDelete();
  assert.equal(h.view.preview, null);
  assert.equal(h.mediaPreview.open, false);
  assert.equal(h.doc.activeElement.isConnected, true);
  assert.notEqual(h.doc.activeElement, h.doc.body);
});

test('R3: polling auto-close restores focus to connected fallback after render and skips focus on route change', async () => {
  let snapshot;
  const h = createHarness(async url => {
    if (url === '/api/state') {
      return { ok: true, status: 200, json: async () => snapshot };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  h.doc.deferCloseEvent = true;

  h.state.managed = [makeManaged('m1', { kind: 'video' })];
  h.view.eventId = 'all';
  h.render();

  h.openManagedPreview('m1');
  assert.equal(h.mediaPreview.open, true);

  // Real polling sequence: syncState() receives managed=[] -> render() replaces DOM -> native close event fires
  snapshot = {
    timezone: 'Asia/Seoul', scan: null, job: null, events: [], incoming: [], pendingXmp: [], managed: [],
  };
  await h.syncState();
  h.render();
  while (h.doc.pendingCloseEvents.length) h.doc.pendingCloseEvents.shift()();

  assert.equal(h.view.preview, null);
  assert.equal(h.mediaPreview.open, false);
  assert.equal(h.doc.activeElement.isConnected, true);
  assert.notEqual(h.doc.activeElement, h.doc.body);
  assert.equal(h.doc.activeElement.id, 'event-search');

  // Route change (restoreFocus: false) must NOT restore focus to #event-search
  h.state.managed = [makeManaged('m2', { kind: 'photo' })];
  h.render();
  h.openManagedPreview('m2');
  h.doc.activeElement = h.doc.body;
  h.win.dispatchHashChange('#incoming');
  while (h.doc.pendingCloseEvents.length) h.doc.pendingCloseEvents.shift()();
  assert.equal(h.view.preview, null);
  assert.notEqual(h.doc.activeElement.id, 'event-search');
});
