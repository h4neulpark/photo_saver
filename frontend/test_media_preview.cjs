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
      state, view, page, mediaPreview, dialog, notice,
      render, syncState, loadRoute, clearCatalogViews,
      openIncomingPreview, openManagedPreview, currentPreviewFile,
      stepPreview, closeMediaPreview, reconcilePreview, retryPreview,
      requestPreviewDelete, performPreviewDelete, disposePreviewMedia,
      chooseEvent,
      confirmIncomingCleanup, api,
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
  assert.equal(h.doc.activeElement.dataset.action, 'cancel-preview-delete');
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
  assert.match(h.mediaPreview.querySelector('.preview-error-message').textContent, /가져오기/);
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

test('Incoming filters clear hidden selections and search updates counts and executable actions', async () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [
    makeIncoming('photo'),
    makeIncoming('clip', { name: 'scene.mp4', kind: 'video', status: 'duplicate' }),
    makeIncoming('image', { status: 'duplicate' }),
  ];
  h.render();
  const all = h.page.querySelector('[data-select="incoming-all"]');
  all.checked = true;
  h.page.dispatchEvent({ type: 'change', target: all });
  assert.equal(h.view.incomingSelection.size, 3);

  const duplicates = h.page.querySelector('[data-action="incoming-filter"][data-value="duplicate"]');
  h.page.dispatchEvent({ type: 'click', target: duplicates });
  await flushMicrotasks();
  assert.equal(h.view.incomingSelection.has('photo'), false);
  assert.equal(h.page.querySelector('[data-action="move-incoming"]').disabled, true);
  assert.equal(h.page.querySelector('[data-action="delete-incoming"]').disabled, true);
  assert.equal(h.page.querySelector('[data-action="cleanup-incoming"]').disabled, false);

  const query = h.page.querySelector('#file-search');
  query.value = 'scene';
  h.page.dispatchEvent({ type: 'input', target: query });
  assert.equal(h.view.incomingSelection.size, 1);
  assert.equal(h.view.incomingSelection.has('clip'), true);
  assert.match(h.page.querySelector('[data-action="incoming-filter"][data-value="duplicate"]').textContent, /중복1/);
  assert.equal(h.page.querySelectorAll('[data-select="incoming"]').length, 1);
});

test('duplicate video preview shares the selection and shows the recorded keeper and companion', () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [makeIncoming('dup', {
    name: 'video.mp4', path: 'Card/DCIM/video.mp4', kind: 'video', status: 'duplicate',
    duplicateSource: { kind: 'remote', path: 'Archive/video.mp4' },
    companions: [{ path: 'Card/DCIM/video.xmp', kind: 'xmp', disposition: 'keep' }],
  })];
  h.render();
  h.openIncomingPreview('dup');
  const meta = h.mediaPreview.querySelector('.preview-meta').textContent;
  assert.match(meta, /incoming\/Card\/DCIM\/video.mp4/);
  assert.match(meta, /OMV 보관 사본.*Archive\/video.mp4/);
  assert.match(meta, /video.xmp 보존 필요/);
  assert.equal(h.mediaPreview.querySelector('[data-action="request-preview-delete"]'), null);
  const toggle = h.mediaPreview.querySelector('[data-action="toggle-preview-selection"]');
  h.mediaPreview.dispatchEvent({ type: 'click', target: toggle });
  assert.equal(h.view.incomingSelection.has('dup'), true);
  assert.equal(h.page.querySelector('[data-action="cleanup-incoming"]').disabled, false);
  assert.equal(h.mediaPreview.querySelector('[data-action="toggle-preview-selection"]').getAttribute('aria-pressed'), 'true');
});

test('duplicate cleanup sends only removals after choosing an Incoming keeper and omits blocked groups', async () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [
    makeIncoming('a', { status: 'duplicate', kind: 'video', path: 'DCIM/a.mp4', companions: [{ path: 'DCIM/a.xmp', kind: 'xmp', disposition: 'keep', reason: '고유 XMP' }] }),
    makeIncoming('b', { status: 'duplicate', kind: 'video', path: 'DCIM/b.mp4' }),
    makeIncoming('c', { status: 'duplicate', path: 'DCIM/c.jpg' }),
  ];
  h.state.incoming.forEach(file => h.view.incomingSelection.add(file.id));
  h.render();
  const groups = [
    {
      files: [{ id: 'a', path: 'DCIM/a.mp4', sizeBytes: 2000000 }, { id: 'b', path: 'DCIM/b.mp4', sizeBytes: 2000000 }],
      keepers: [{ kind: 'remote', id: 'r', path: 'Archive/a.mp4' }, { kind: 'incoming', id: 'b', path: 'DCIM/b.mp4' }],
    },
    { files: [{ id: 'c', path: 'DCIM/c.jpg', sizeBytes: 10 }], keepers: [], reason: '사본을 확인할 수 없습니다.' },
  ];
  const response = payload => Promise.resolve({ ok: true, json: async () => payload });
  h.setFetch(url => {
    if (url === '/api/incoming/duplicates/plan') return response({ groups });
    if (url === '/api/jobs/duplicate-cleanup') return response({ id: 31 });
    return response({ incoming: h.state.incoming, managed: [], events: [], pendingXmp: [], job: null });
  });
  await h.confirmIncomingCleanup();
  assert.equal(h.dialog.open, true);
  assert.match(h.dialog.textContent, /Incoming에 남아 있는 XMP와 보조 파일\(THM·LRV·AAE\)은 보존합니다\./);
  assert.match(h.dialog.textContent, /DCIM\/a.xmp.*Incoming에 보존/);
  assert.match(h.dialog.textContent, /사본을 확인할 수 없습니다/);
  assert.match(h.dialog.querySelector('#cleanup-summary').textContent, /정리 2개.*보류 1개/);
  const keeper = h.dialog.querySelector('[data-keeper-group]');
  keeper.value = '1';
  h.dialog.dispatchEvent({ type: 'change', target: keeper });
  assert.match(h.dialog.querySelector('#cleanup-summary').textContent, /정리 1개.*보류 1개/);
  const form = h.dialog.querySelector('form');
  h.dialog.dispatchEvent({ type: 'submit', target: form, currentTarget: form });
  await flushMicrotasks();
  const jobRequest = h.fetchCalls.find(call => call.url === '/api/jobs/duplicate-cleanup');
  assert.deepEqual(JSON.parse(jobRequest.opts.body), { items: [{ id: 'a', keeperKind: 'incoming', keeperId: 'b' }] });
});

test('AAE companions, auxiliary count fallback and move completion name all auxiliary types', () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [
    makeIncoming('apple', { name: 'IMG.HEIC', companions: [{ path: 'DCIM/IMG.AAE', kind: 'aae', disposition: 'delete-after-move' }] }),
    makeIncoming('fallback', { cameraAuxCount: 2 }),
  ];
  h.render();
  assert.match(h.page.querySelector('[data-item-key="apple"]').textContent, /IMG\.AAE/);
  assert.match(h.page.querySelector('[data-item-key="fallback"]').textContent, /THM·LRV·AAE 2개 원본 이동 후 정리/);
  h.openIncomingPreview('apple');
  assert.match(h.mediaPreview.textContent, /IMG\.AAE/);
  h.closeMediaPreview();
  h.state.latestIncomingResult = {
    id: 77, kind: 'move', status: 'done',
    result: { moved: 1, auxDeleted: 2, items: [{ path: 'IMG.HEIC', status: 'moved', companions: [{ path: 'IMG.AAE', kind: 'aae', disposition: 'deleted' }] }] },
  };
  h.render();
  assert.match(h.page.querySelector('.incoming-result').textContent, /THM·LRV·AAE 2개 삭제\./);
  assert.match(h.page.querySelector('.incoming-result').textContent, /IMG\.AAE/);
});

test('a new scan shows stage progress while the latest processing result remains available', () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  const scan = { id: 8, kind: 'scan', status: 'running', result: { phase: '신규 파일 해시 검사', completedFiles: 2, totalFiles: 6, current: 'DCIM/a.mp4' } };
  h.state.jobs.local = scan;
  h.state.activeJobs.local = scan;
  h.state.latestIncomingResult = {
    id: 7, kind: 'duplicate-cleanup', status: 'done',
    result: { cleaned: 1, review: 1, items: [{ path: 'DCIM/b.mp4', status: 'review', reason: '원격 사본을 확인할 수 없습니다.' }] },
  };
  h.render();
  const progress = h.page.querySelector('progress');
  assert.equal(progress.getAttribute('value'), '2');
  assert.equal(progress.getAttribute('max'), '6');
  assert.match(h.page.querySelector('.incoming-progress').textContent, /신규 파일 해시 검사/);
  assert.match(h.page.querySelector('.incoming-result').textContent, /DCIM\/b.mp4/);
  assert.match(h.page.querySelector('.incoming-result').textContent, /원격 사본을 확인할 수 없습니다/);
  assert.equal(h.page.querySelector('[data-action="rescan-incoming"]').disabled, true);
});

function cleanupHarness() {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.incoming = [makeIncoming('dup', { status: 'duplicate', kind: 'video' })];
  h.view.incomingSelection.add('dup');
  h.render();
  let resolvePlan;
  h.setFetch(url => {
    if (url === '/api/incoming/duplicates/plan') return new Promise(resolve => { resolvePlan = resolve; });
    return new Promise(() => {});
  });
  return {
    h,
    finish() {
      resolvePlan({ ok: true, status: 200, json: async () => ({ groups: [{
        files: [{ id: 'dup', path: 'dup.mp4', sizeBytes: 7 }],
        keepers: [{ kind: 'managed', id: 'keeper', path: 'kept.mp4' }],
      }] }) });
    },
  };
}

test('duplicate cleanup click survives polling render and modal cancel without sticking disabled', async () => {
  const { h, finish } = cleanupHarness();
  h.page.dispatchEvent({ type: 'click', target: h.page.querySelector('[data-action="cleanup-incoming"]') });
  await flushMicrotasks();
  assert.equal(h.view.cleanupPlanning, true);
  assert.equal(h.page.querySelector('[data-action="cleanup-incoming"]').disabled, true);
  assert.match(h.page.querySelector('[data-action="cleanup-incoming"]').textContent, /보관 사본 조회 중…/);
  h.render();
  assert.equal(h.page.querySelector('[data-action="cleanup-incoming"]').disabled, true);
  finish();
  await flushMicrotasks();
  assert.equal(h.dialog.open, true);
  h.dialog.dispatchEvent({ type: 'click', target: h.dialog.querySelector('[data-action="close-dialog"]') });
  await flushMicrotasks();
  assert.equal(h.dialog.open, false);
  assert.equal(h.view.cleanupPlanning, false);
  assert.equal(h.page.querySelector('[data-action="cleanup-incoming"]').disabled, false);
  assert.match(h.page.querySelector('[data-action="cleanup-incoming"]').textContent, /중복 정리 \(1\)/);
});

test('duplicate cleanup aborts modal when localBusy or status changes during plan fetch', async () => {
  for (const change of ['busy', 'status', 'selection', 'route', 'dialog', 'preview']) {
    const { h, finish } = cleanupHarness();
    const pending = h.confirmIncomingCleanup();
    if (change === 'busy') {
      const local = { id: 44, kind: 'scan', status: 'running' };
      h.state.jobs.local = local;
      h.state.activeJobs.local = local;
    } else if (change === 'status') h.state.incoming[0].status = 'ready';
    else if (change === 'selection') h.view.incomingSelection.clear();
    else if (change === 'route') h.win.dispatchHashChange('#events');
    else if (change === 'dialog') { h.dialog.innerHTML = '<p>existing dialog</p>'; h.dialog.showModal(); }
    else h.openIncomingPreview('dup');
    finish();
    await pending;
    assert.equal(h.view.cleanupPlanning, false, change);
    if (change === 'dialog') assert.equal(h.dialog.textContent, 'existing dialog');
    else assert.equal(h.dialog.open, false, change);
    if (change === 'preview') assert.equal(h.mediaPreview.open, true);
  }
});

test('duplicate cleanup 409 refreshes state and releases the planning button', async () => {
  const { h } = cleanupHarness();
  let stateRequests = 0;
  h.setFetch(async url => {
    if (url === '/api/incoming/duplicates/plan') return { ok: false, status: 409, json: async () => ({ detail: '검사 결과가 변경되었습니다.' }) };
    assert.equal(url, '/api/state');
    stateRequests += 1;
    return { ok: true, status: 200, json: async () => ({
      timezone: 'Asia/Seoul', incoming: [makeIncoming('dup', { status: 'ready' })],
      managed: [], events: [], pendingXmp: [], scan: null, job: null,
    }) };
  });
  await assert.rejects(h.confirmIncomingCleanup(), error => error.status === 409);
  assert.equal(stateRequests, 1);
  assert.equal(h.state.incoming[0].status, 'ready');
  assert.equal(h.view.cleanupPlanning, false);
  assert.equal(h.dialog.open, false);
  assert.doesNotMatch(h.page.querySelector('[data-action="cleanup-incoming"]').textContent, /조회 중/);
});

test('api maps FastAPI default 404 Not Found to actionable Korean message', async () => {
  const h = createHarness();
  for (const detail of ['Not Found', '파일을 찾을 수 없습니다.']) {
    h.setFetch(async () => ({ ok: false, status: 404, json: async () => ({ detail }) }));
    await assert.rejects(h.api('incoming/duplicates/plan', 'POST', { ids: ['dup'] }), error => {
      assert.equal(error.status, 404);
      if (detail === 'Not Found') assert.match(error.message, /백엔드 컨테이너.*다시 빌드·재시작/);
      else assert.equal(error.message, detail);
      return true;
    });
  }
});

test('incomingResultSection handles null item path and auto-expands on companionReview', () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.state.latestIncomingResult = { id: 91, kind: 'move', status: 'done', result: {
    review: 0, companionReview: 1, items: [
      { id: 'missing-id', path: null, status: 'review' },
      { path: null, status: 'review' },
    ],
  } };
  h.render();
  const details = h.page.querySelector('#incoming-result-items');
  assert.notEqual(details.getAttribute('open'), null);
  assert.match(details.textContent, /missing-id/);
  assert.match(details.textContent, /경로 정보 없음/);
  assert.doesNotMatch(details.textContent, /null/);
  // Retain a user's collapsed state on the next poll of the same job.
  details.open = false;
  h.render();
  assert.equal(h.page.querySelector('#incoming-result-items').getAttribute('open'), null);
});

test('incoming table renders root filenames once and keeps nested paths and companion summaries', () => {
  const h = createHarness();
  h.win.dispatchHashChange('#incoming');
  h.view.incomingLayout = 'table';
  h.state.incoming = [
    makeIncoming('root', { name: 'root.jpg', folder: '', companions: [{ path: 'root.THM', kind: 'thm', disposition: 'keep' }] }),
    makeIncoming('nested', { name: 'nested.jpg', folder: 'DCIM' }),
  ];
  h.render();
  const cells = h.page.querySelector('tbody').children.map(row => row.children[1].textContent);
  assert.equal((cells[0].match(/root\.jpg/g) || []).length, 1);
  assert.match(cells[0], /THM/);
  assert.match(cells[1], /DCIM\/nested.jpg/);
});

function setPollingJob(h, lane, job) {
  h.state.jobs[lane] = job;
  h.state.activeJobs[lane] = job && ['queued', 'running'].includes(job.status) ? job : null;
}

function changeSelection(h, kind, value, checked) {
  const input = h.page.querySelector(`[data-select="${kind}"][value="${value}"]`);
  assert.ok(input, `missing ${kind} ${value}`);
  input.checked = checked;
  h.page.dispatchEvent({ type: 'change', target: input });
  return input;
}

function keyedImage(h, id) {
  return h.page.querySelector(`[data-item-key="${id}"] img`);
}

test('Incoming polling render and checkbox selection preserve thumbnail img nodes across table and card views', async () => {
  for (const layout of ['table', 'cards']) {
    const h = createHarness();
    h.win.dispatchHashChange('#incoming');
    h.view.connecting = false;
    h.view.incomingLayout = layout;
    h.state.incoming = [makeIncoming('i1'), makeIncoming('i2', { status: 'duplicate' })];
    h.state.pendingXmp = [{ id: 'xmp', path: 'sidecar.XMP', status: 'pending', recommended: 'm1',
      candidates: [{ id: 'm1', name: 'original.mp4' }, { id: 'm2', name: 'second.mp4' }] }];
    h.render();
    const main = h.page.querySelector('main');
    const rows = h.page.querySelector('#incoming-rows');
    const first = keyedImage(h, 'i1');
    const second = keyedImage(h, 'i2');
    assert.equal(first.getAttribute('decoding'), 'async');
    const unchanged = () => {
      assert.equal(h.page.querySelector('main'), main, layout);
      assert.equal(keyedImage(h, 'i1'), first, layout);
      assert.equal(keyedImage(h, 'i2'), second, layout);
    };
    rows.scrollTop = 90;
    for (let completedFiles = 1; completedFiles <= 3; completedFiles += 1) {
      setPollingJob(h, 'local', { id: 51, kind: 'duplicate-cleanup', status: 'running', result: {
        phase: `검증 ${completedFiles}`, totalFiles: 4, completedFiles,
      } });
      h.render();
      unchanged();
      assert.equal(h.page.querySelector('.incoming-progress progress').getAttribute('value'), String(completedFiles));
      assert.equal(h.page.querySelector('[data-action="move-incoming"]').disabled, true);
      assert.equal(rows.scrollTop, 90);
    }
    setPollingJob(h, 'local', null);
    h.render();
    const input = changeSelection(h, 'incoming', 'i1', true);
    unchanged();
    assert.equal(h.page.querySelector('[data-select="incoming"][value="i1"]'), input);
    assert.equal(input.checked, true);
    assert.equal(h.page.querySelector('[data-item-key="i1"]').classList.contains('selected'), true);
    assert.equal(h.page.querySelector('[data-select="incoming-all"]').indeterminate, true);
    assert.equal(h.page.querySelector('[data-action="move-incoming"]').disabled, false);
    changeSelection(h, 'incoming-all', 'all', true);
    unchanged();
    assert.equal(h.page.querySelector('[data-select="incoming-all"]').checked, true);
    assert.equal(h.page.querySelector('[data-select="incoming-all"]').indeterminate, false);
    assert.match(h.page.querySelector('#incoming-actions').textContent, /2개 선택/);
    h.openIncomingPreview('i1');
    h.mediaPreview.dispatchEvent({ type: 'click', target: h.mediaPreview.querySelector('[data-action="toggle-preview-selection"]') });
    unchanged();
    assert.equal(input.checked, false);
    assert.equal(h.page.querySelector('[data-item-key="i1"]').classList.contains('selected'), false);
    assert.equal(h.page.querySelector('[data-select="incoming-all"]').indeterminate, true);
    h.closeMediaPreview();
    const xmp = h.page.querySelector('[data-xmp-id="xmp"]');
    h.page.querySelector('.xmp-matches').scrollTop = 47;
    xmp.value = 'm2';
    h.page.dispatchEvent({ type: 'change', target: xmp });
    unchanged();
    assert.equal(h.view.xmpChoices.get('xmp'), 'm2');
    assert.equal(h.page.querySelector('.xmp-matches').scrollTop, 47);

    // Searching without excluding a file preserves its input, caret/focus, and image.
    const search = h.page.querySelector('#file-search');
    search.focus();
    search.value = 'inc_';
    h.page.dispatchEvent({ type: 'input', target: search });
    unchanged();
    h.render();
    assert.equal(h.page.querySelector('#file-search'), search);
    assert.equal(h.doc.activeElement, search);
    assert.equal(search.focusCalls.length, 1);
    // An unchanged layout click is a no-op, including the user's scroll position.
    h.page.dispatchEvent({ type: 'click', target: h.page.querySelector(`[data-action="incoming-layout"][data-value="${layout}"]`) });
    await flushMicrotasks();
    unchanged();
    assert.equal(rows.scrollTop, 90);

    // Append and reorder exercise both reconciler paths without replacing existing images.
    const thirdFile = makeIncoming('i3');
    h.state.incoming.push(thirdFile);
    h.render();
    unchanged();
    const third = keyedImage(h, 'i3');
    h.state.incoming = [thirdFile, ...h.state.incoming.slice(0, 2).reverse()];
    h.render();
    unchanged();
    assert.equal(keyedImage(h, 'i3'), third);
    assert.deepEqual(h.page.querySelectorAll('[data-item-key]').map(row => row.dataset.itemKey), ['i3', 'i2', 'i1']);

    h.state.incoming = h.state.incoming.filter(file => file.id !== 'i1');
    h.state.incoming.find(file => file.id === 'i2').status = 'ready';
    h.render();
    assert.equal(keyedImage(h, 'i1'), null);
    assert.equal(keyedImage(h, 'i2'), second);
    assert.equal(keyedImage(h, 'i3'), third);
    assert.match(h.page.querySelector('[data-item-key="i2"]').textContent, /이동 가능/);
    h.state.incoming.find(file => file.id === 'i2').thumbnail = '/thumbnails/new-content-v1.jpg';
    h.render();
    const newSecond = keyedImage(h, 'i2');
    assert.notEqual(newSecond, second);
    assert.equal(newSecond.getAttribute('src'), '/thumbnails/new-content-v1.jpg');
    assert.equal(keyedImage(h, 'i3'), third);
    search.value = 'inc_i3';
    h.page.dispatchEvent({ type: 'input', target: search });
    assert.equal(keyedImage(h, 'i2'), null);
    assert.equal(keyedImage(h, 'i3'), third);
    search.value = '';
    h.page.dispatchEvent({ type: 'input', target: search });
    assert.notEqual(keyedImage(h, 'i2'), newSecond);
    assert.equal(keyedImage(h, 'i3'), third);
    h.view.incomingLayout = layout === 'table' ? 'cards' : 'table';
    h.render();
    assert.notEqual(keyedImage(h, 'i3'), third);
    assert.equal(h.page.querySelector('main'), main);
    assert.equal(rows.dataset.mode, h.view.incomingLayout);
  }
});

test('Events polling render, checkbox selection, search input, and status updates preserve thumbnail img nodes', () => {
  const h = createHarness();
  h.state.events = [
    { id: 'ev1', name: 'Trip', folder: 'Trip', parent: null, start: '2026-06-01', end: '2026-06-03', zone: 'Asia/Seoul' },
    { id: 'ev2', name: 'Next', folder: 'Next', parent: null },
  ];
  h.state.managed = [makeManaged('m1', { canOffload: true }), makeManaged('m2', { canOffload: true })];
  h.view.eventId = 'ev1';
  h.render();
  const main = h.page.querySelector('main');
  const first = keyedImage(h, 'm1');
  let second = keyedImage(h, 'm2');
  const rows = h.page.querySelector('#event-rows');
  rows.scrollTop = 135;
  const unchanged = () => {
    assert.equal(h.page.querySelector('main'), main);
    assert.equal(keyedImage(h, 'm1'), first);
    assert.equal(keyedImage(h, 'm2'), second);
    assert.equal(rows.scrollTop, 135);
  };
  for (const kind of ['offload', 'upload']) {
    for (let completedFiles = 1; completedFiles <= 2; completedFiles += 1) {
      setPollingJob(h, 'remote', { id: 61, kind, status: 'running', result: { phase: `전송 ${completedFiles}`, totalFiles: 3, completedFiles } });
      h.render();
      unchanged();
      assert.equal(h.page.querySelector('[data-action="offload-media"]').disabled, true);
      if (kind === 'offload') assert.equal(h.page.querySelector('.upload-status progress').getAttribute('value'), String(Math.round(completedFiles / 3 * 100)));
    }
  }
  setPollingJob(h, 'remote', null);
  h.render();
  const input = changeSelection(h, 'event', 'm1', true);
  unchanged();
  assert.equal(h.page.querySelector('[data-select="event"][value="m1"]'), input);
  assert.equal(h.page.querySelector('[data-item-key="m1"]').classList.contains('selected'), true);
  assert.equal(h.page.querySelector('[data-select="event-all"]').indeterminate, true);
  assert.equal(h.page.querySelector('[data-action="offload-media"]').disabled, false);
  assert.equal(h.page.querySelector('[data-action="edit-media"]').disabled, false);
  const target = h.page.querySelector('#move-event-target');
  target.value = 'ev2';
  h.page.dispatchEvent({ type: 'change', target });
  assert.equal(h.page.querySelector('[data-action="move-event"]').disabled, false);
  changeSelection(h, 'event-all', 'all', true);
  unchanged();
  assert.equal(h.page.querySelector('[data-select="event-all"]').checked, true);
  assert.equal(h.page.querySelector('[data-select="event-all"]').indeterminate, false);
  assert.equal(h.page.querySelector('#move-event-target').value, 'ev2');
  changeSelection(h, 'event-all', 'all', false);
  assert.equal(h.page.querySelector('[data-action="edit-media"]').disabled, true);
  assert.equal(h.page.querySelector('[data-action="move-event"]').disabled, true);
  const search = h.page.querySelector('#event-search');
  // Some fixtures omit isConnected; containment must be enough to retain focus.
  Object.defineProperty(search, 'isConnected', { value: undefined });
  search.focus();
  search.value = 'm';
  h.page.dispatchEvent({ type: 'input', target: search });
  unchanged();
  h.render();
  assert.equal(h.page.querySelector('#event-search'), search);
  assert.equal(h.doc.activeElement, search);
  assert.equal(search.focusCalls.length, 1);
  search.value = 'm1';
  h.page.dispatchEvent({ type: 'input', target: search });
  assert.equal(keyedImage(h, 'm1'), first);
  assert.equal(keyedImage(h, 'm2'), null);
  search.value = '';
  h.page.dispatchEvent({ type: 'input', target: search });
  assert.equal(keyedImage(h, 'm1'), first);
  assert.notEqual(keyedImage(h, 'm2'), second);
  second = keyedImage(h, 'm2');
  changeSelection(h, 'event', 'm1', true);
  h.state.managed[0].confirmed = true;
  h.render();
  unchanged();
  assert.match(h.page.querySelector('[data-item-key="m1"] [data-col="status"]').textContent, /확정/);
  assert.equal(h.page.querySelector('[data-action="confirm-event"]').disabled, true);
  h.state.managed[0].status = 'archived';
  h.state.managed[0].preview = null;
  h.render();
  assert.equal(h.page.querySelector('[data-item-key="m1"] button.thumb'), null);
  assert.ok(h.page.querySelector('[data-item-key="m1"] span.thumb'));
  assert.notEqual(keyedImage(h, 'm1'), first);
  assert.equal(keyedImage(h, 'm2'), second);
  h.chooseEvent('ev1');
  assert.equal(rows.scrollTop, 135);
  h.chooseEvent('ev2');
  assert.equal(rows.scrollTop, 0);
});

test('Archive source selection updates checkboxes, indeterminate state, count, and upload button in place', () => {
  const h = createHarness();
  h.state.events = [{ id: 'ev1', name: 'Trip', folder: 'Trip', parent: null }, { id: 'ev2', name: 'Next', folder: 'Next', parent: null }];
  h.state.managed = [
    makeManaged('m1', { confirmed: true, xmp: { name: 'm1.xmp' } }),
    makeManaged('m2', { confirmed: true }),
    makeManaged('m3', { confirmed: true, eventId: 'ev2' }),
  ];
  h.view.archive = { root: '/archive', path: '', entries: [] };
  h.view.sourceSelection.add('m1:media');
  h.win.dispatchHashChange('#archive');
  const main = h.page.querySelector('main');
  const first = h.page.querySelector('[data-select="source"][value="0"]');
  const all = h.page.querySelector('[data-select="source-all"]');
  const upload = h.page.querySelector('[data-action="upload-archive"]');
  const count = h.page.querySelector('#source-selection-count');
  assert.equal(first.checked, false);
  assert.equal(first.indeterminate, true);
  assert.equal(all.indeterminate, true);
  assert.equal(count.textContent, '1개 파일 선택');
  const unchanged = () => {
    assert.equal(h.page.querySelector('main'), main);
    assert.equal(h.page.querySelector('[data-select="source"][value="0"]'), first);
    assert.equal(h.page.querySelector('[data-action="upload-archive"]'), upload);
  };
  changeSelection(h, 'source', '0', true);
  unchanged();
  assert.equal(first.indeterminate, false);
  assert.equal(first.checked, true);
  assert.equal(first.closest('.tree-row').classList.contains('source-selected'), true);
  assert.equal(count.textContent, '3개 파일 선택');
  assert.equal(all.indeterminate, true);
  assert.equal(upload.disabled, false);
  changeSelection(h, 'source-all', 'all', true);
  unchanged();
  assert.equal(all.checked, true);
  assert.equal(all.indeterminate, false);
  assert.equal(count.textContent, '4개 파일 선택');
  assert.equal(h.page.querySelectorAll('.source-selected').length, 2);
  changeSelection(h, 'source', '0', false);
  unchanged();
  assert.equal(first.closest('.tree-row').classList.contains('source-selected'), false);
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true);
  assert.equal(count.textContent, '1개 파일 선택');
  changeSelection(h, 'source-all', 'all', false);
  unchanged();
  assert.equal(all.indeterminate, false);
  assert.equal(upload.disabled, true);
  assert.equal(count.textContent, '0개 파일 선택');
  setPollingJob(h, 'remote', { id: 71, kind: 'upload', status: 'running', result: {} });
  h.render();
  assert.equal(h.page.querySelector('[data-select="source"]').disabled, true);
  assert.equal(h.page.querySelector('[data-select="source-all"]').disabled, true);
  assert.equal(h.page.querySelector('[data-action="upload-archive"]').disabled, true);
});
