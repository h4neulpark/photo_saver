'use strict';

const icons = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  aperture: '<circle cx="12" cy="12" r="9"/><path d="M14.3 3.3 9.4 12m11.4-2.3H10.9m7.5 8.9-4.9-8.6M9.7 20.7l4.9-8.7M3.2 14.3h9.9M5.6 5.4l4.9 8.6"/>',
  inbox: '<path d="M4 4h16l2 11v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-4L4 4Z"/><path d="M2 15h6l2 2h4l2-2h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18m-13 5h2m4 0h2"/>',
  transfer: '<path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4"/>',
  refresh: '<path d="M20 10a8 8 0 1 0-1.5 7M20 4v6h-6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  trash: '<path d="M3 6h18M9 6V4h6v2m4 0-1 14H6L5 6m5 4v6m4-6v6"/>',
  folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-4 3 2 4-4 4 5"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  edit: '<path d="m14 5 5 5M4 20l5-1 12-12-4-4L5 15l-1 5Z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18m-12-5v11"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  file: '<path d="M5 3h9l5 5v13H5zM14 3v6h5m-11 4h8m-8 4h6"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18m-14 3h.01m4 0h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.2-1.6l1.6-1.3-1.5-2.6-2 .7a7 7 0 0 0-2.7-1.6L13.8 3h-3.6l-.4 2.6a7 7 0 0 0-2.7 1.6l-2-.7-1.5 2.6 1.6 1.3a7 7 0 0 0 0 3.2l-1.6 1.3 1.5 2.6 2-.7a7 7 0 0 0 2.7 1.6l.4 2.6h3.6l.4-2.6a7 7 0 0 0 2.7-1.6l2 .7 1.5-2.6-1.6-1.3A7 7 0 0 0 19 12Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  key: '<circle cx="8" cy="10" r="4"/><path d="m11 13 8 8m-4-4 3-3m0 6 3-3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const navigationGroups = [
  { id: 'workflow', label: '작업 흐름' },
  { id: 'manage', label: '조회·관리' },
];
const navigation = [
  { id: 'incoming', title: '가져오기', icon: 'inbox', group: 'workflow', step: 1 },
  { id: 'events', title: '이벤트 분류', icon: 'calendar', group: 'workflow', step: 2 },
  { id: 'archive', title: '아카이브 전송', icon: 'transfer', group: 'workflow', step: 3 },
  { id: 'catalog', title: '파일 기록', icon: 'file', group: 'manage', step: null },
  { id: 'jobs', title: '작업 내역', icon: 'clock', group: 'manage', step: null },
  { id: 'settings', title: '설정', icon: 'settings', group: 'manage', step: null },
];



function dateTimeFormatter(timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function savedPreference(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function storePreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ }
}

function savedIncomingLayout() {
  try {
    return localStorage.getItem('photo-saver-incoming-layout') === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

function savedEventView() {
  try {
    return localStorage.getItem('photo-saver-event-view') === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

const state = { incoming: [], managed: [], events: [], pendingXmp: [], scan: null, latestIncomingResult: null, job: null, jobs: { local: null, remote: null, exclusive: null }, activeJobs: { local: null, remote: null, exclusive: null }, timezone: 'Asia/Seoul' };
const view = {
  catalogView: savedPreference('photo-saver-catalog-view', 'table') === 'cards' ? 'cards' : 'table', thumbnailGeneratingShas: new Set(),
  thumbnailStats: null, thumbnailStatsError: '', thumbnailOpBusy: false,
  remoteIndexGenerateThumbnails: savedPreference('photo-saver-remote-index-thumbs', '0') === '1',
  dismissedResults: loadDismissedResults(), resultDetailsOpen: new Map(), deviceUploadHistory: loadDeviceUploadHistory(),
  jobs: { items: [], summary: null, nextBeforeId: null, hasMore: false, statusFilter: 'all', laneFilter: 'all', busy: false, loadingMore: false, error: '', loadedOnce: false },
  jobsExpanded: new Set(),
  deviceUpload: { open: false, folder: '', autoScan: true, running: false, cancelling: false, activeUploadId: null, abortController: null, totalFiles: 0, completedFiles: 0, totalBytes: 0, uploadedBytes: 0, currentName: '', currentLoaded: 0, currentTotal: 0, batchId: 0, dismissedBatchId: 0, startedAt: null, results: [], scanNote: '' },
  page: '', incomingFilter: 'all', incomingKind: '', query: '', connecting: true, loadError: '',
  incomingLayout: savedIncomingLayout(), incomingTab: 'files', preview: null, cleanupPlanning: false,
  incomingSelection: new Set(), eventId: 'unassigned', eventSelection: new Set(), eventLifecycle: 'all', eventMenuOpen: false, eventDevice: '', eventDate: '',
  eventTarget: '', eventQuery: '', eventView: savedEventView(), sourcePath: [], xmpChoices: new Map(),
  devices: null, devicesError: '', settings: null, settingsError: '', publicKeyToCopy: null, keyCopiedLocally: false, restoreFile: null,
  catalogOpBusy: false, sshTestBusy: false, sshTestResult: null,
  archive: null, archivePath: '', archiveBusy: false, archiveError: '', archiveAutoAttempted: false, archiveAutoConnecting: false,
  sourceSelection: new Set(), uploadStarting: false, dragSource: null,
  catalogEvent: 'all', catalogDevice: '', catalogExpanded: new Set(),
  catalogRemoteFolder: '', catalogRemoteExpanded: new Set(),
  catalogExpandedRows: new Set(),
  jobsTab: 'list', catalogJobId: null, catalogUploadResult: 'all', catalog: null, catalogTab: 'files', catalogQuery: '', catalogScope: 'all', catalogPage: 1, catalogBusy: false, catalogError: '',
};
let refreshTimer;
let stateRequest = 0;
let catalogRequest = 0;
let jobsRequest = 0;
let catalogSearchTimer;
let catalogComposing = false;
let devicesRequest = 0;
let archiveConnectionVersion = 0;
let previewMediaGeneration = 0;
let pendingPreviewFocus = null;

const page = document.getElementById('page');
const nav = document.getElementById('navigation');
const dialog = document.getElementById('dialog');
const mediaPreview = document.getElementById('media-preview');
const notice = document.getElementById('notice');
let noticeTimeout;

// Slots and keyed rows retain their DOM (including lazy-loaded images) across polls.
const slotHtmlCache = new WeakMap();

function setSlotHtml(element, html) {
  if (!element || slotHtmlCache.get(element) === html) return false;
  slotHtmlCache.set(element, html);
  element.innerHTML = html;
  return true;
}

function setClass(element, name, enabled) {
  if (!element) return;
  if (enabled) element.classList.add(name);
  else element.classList.remove(name);
}

function setChecked(input, checked) {
  if (!input) return;
  input.checked = Boolean(checked);
  if (checked) input.setAttribute('checked', '');
  else input.removeAttribute('checked');
}

function setDisabled(control, disabled) {
  if (!control) return;
  control.disabled = Boolean(disabled);
  if (disabled) control.setAttribute('disabled', '');
  else control.removeAttribute('disabled');
}

function parseSingleElement(parentTag, html) {
  const host = document.createElement(parentTag);
  host.innerHTML = html;
  return host.children[0] || null;
}

function reconcileKeyedChildren(container, parentTag, items, getKey, createNode, patchNode) {
  const existingByKey = new Map();
  const nextKeys = new Set(items.map(getKey));
  for (const child of [...container.children]) {
    const key = child.dataset?.itemKey;
    if (!key || !nextKeys.has(key) || existingByKey.has(key)) child.remove();
    else existingByKey.set(key, child);
  }
  const ordered = items.map(item => {
    const key = getKey(item);
    let node = existingByKey.get(key);
    if (!node) {
      node = createNode(item, parentTag);
      if (node) node.dataset.itemKey = key;
    }
    if (node) patchNode(node, item);
    return node;
  }).filter(Boolean);
  const current = container.children;
  if (current.length === ordered.length && ordered.every((node, index) => current[index] === node)) return;
  if (current.length < ordered.length && [...current].every((node, index) => ordered[index] === node)) {
    for (let index = current.length; index < ordered.length; index += 1) container.appendChild(ordered[index]);
    return;
  }
  if (typeof container.insertBefore === 'function') {
    for (let index = 0; index < ordered.length; index += 1) {
      const node = ordered[index];
      const cursor = container.children[index] || null;
      if (node !== cursor) container.insertBefore(node, cursor);
    }
  } else {
    container.replaceChildren(...ordered);
  }
}


async function api(path, method = 'GET', data) {
  let response;
  try {
    const binary = data instanceof Blob;
    response = await fetch(`/api/${path}`, {
      method,
      cache: 'no-store',
      headers: data ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : undefined,
      body: binary ? data : data ? JSON.stringify(data) : undefined,
    });
  } catch {
    throw new Error('로컬 API에 연결할 수 없습니다.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const rawDetail = result?.detail;
    const message = response.status === 404 && rawDetail === 'Not Found'
      ? '요청한 API 경로를 찾을 수 없습니다. 백엔드 컨테이너가 최신 코드로 다시 빌드·재시작되었는지 확인하세요.'
      : typeof rawDetail === 'string' ? rawDetail : '요청을 처리하지 못했습니다.';
    const error = new Error(message);
    error.status = response.status;
    error.data = result;
    throw error;
  }
  return result;
}

const jobLanes = { "thumbnails-local": "local", "thumbnails-remote": "remote", scan: 'local', move: 'local', delete: 'local', 'duplicate-cleanup': 'local', 'xmp-link': 'local', upload: 'remote', offload: 'remote', 'remote-index': 'remote', 'reset-all': 'exclusive' };
const lanes = ['local', 'remote', 'exclusive'];
function isJobActive(job) { return Boolean(job && ['queued', 'running'].includes(job.status)); }
const MAX_DISMISSED_RESULTS = 100;
function jobDismissKey(job) {
  if (!job || job.id == null) return '';
  if (job.createdAt) return `${job.id}:${job.createdAt}`;
  if (job.finishedAt) return `${job.id}:${job.finishedAt}`;
  return `${job.id}:${job.kind || ''}:${job.status || ''}`;
}
function loadDismissedResults() {
  try {
    const saved = JSON.parse(localStorage.getItem('photo-saver-dismissed-results-v1'));
    return new Set(saved?.version === 1 && Array.isArray(saved.keys) ? saved.keys.filter(key => typeof key === 'string').slice(-100) : []);
  } catch { return new Set(); }
}
function saveDismissedResults(set) {
  try { localStorage.setItem('photo-saver-dismissed-results-v1', JSON.stringify({ version: 1, keys: [...set].slice(-100) })); } catch { /* Keep the memory copy. */ }
}
function isResultDismissed(job) {
  if (!job || isJobActive(job)) return false;
  return view.dismissedResults.has(jobDismissKey(job));
}
function dismissResult(key) {
  if (!key) return;
  view.dismissedResults.add(key);
  while (view.dismissedResults.size > MAX_DISMISSED_RESULTS) view.dismissedResults.delete(view.dismissedResults.values().next().value);
  saveDismissedResults(view.dismissedResults);
}
function clearDismissedResults() {
  view.dismissedResults.clear(); view.resultDetailsOpen.clear();
  try { localStorage.removeItem('photo-saver-dismissed-results-v1'); } catch { /* Keep the memory copy. */ }
}
function jobHasAttention(job) {
  const result = job?.result || {};
  return job?.status === 'failed' || job?.status === 'cancelled' || Boolean(result.error) ||
    (result.failed || 0) > 0 || (result.review || 0) > 0 || (result.companionReview || 0) > 0;
}
function resultTone(job) { return job.status === 'failed' ? 'danger' : jobHasAttention(job) ? 'warn' : 'ok'; }
function resultBannerActions(job, title, followup = '') {
  return `${followup}<a class="button" href="#jobs">작업 내역</a>${button('dismiss-result', '닫기', { glyph: 'close', extra: `data-value="${escapeHtml(jobDismissKey(job))}" aria-label="${escapeHtml(title)} 닫기"` })}`;
}
function resultDetailsAttributes(job) {
  const key = jobDismissKey(job);
  const previous = [...page.querySelectorAll('[data-result-details]')].find(el => el.dataset.resultDetails === key);
  const open = previous ? previous.open : view.resultDetailsOpen.has(key) ? view.resultDetailsOpen.get(key) : jobHasAttention(job);
  return `data-result-details="${escapeHtml(key)}"${open ? ' open' : ''}`;
}
function loadDeviceUploadHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem('photo-saver-upload-history-v1'));
    return saved?.version === 1 && Array.isArray(saved.entries)
      ? saved.entries.filter(entry => entry && entry.source === 'device' && entry.createdAt && entry.result && Array.isArray(entry.result.items)).slice(-20).map(trimDeviceUploadEntry) : [];
  } catch { return []; }
}
function trimDeviceUploadEntry(entry) {
  const items = entry.result.items || [];
  const attention = item => item.status !== 'done' || deviceUploadRenamed(item);
  const shown = [...items.filter(attention), ...items.filter(item => !attention(item))].slice(0, 100);
  const total = Math.max(entry.itemsTotal || 0, items.length);
  return { ...entry, itemsTotal: total, itemsTruncated: total > shown.length,
    result: { ...entry.result, items: shown }, resultMeta: { itemsTotal: total, itemsShown: shown.length, itemsTruncated: total > shown.length, errorsTotal: 0, errorsShown: 0, errorsTruncated: false } };
}
function recordDeviceUploadHistory(entry) {
  view.deviceUploadHistory.push(trimDeviceUploadEntry(entry));
  view.deviceUploadHistory = view.deviceUploadHistory.slice(-20);
  try { localStorage.setItem('photo-saver-upload-history-v1', JSON.stringify({ version: 1, entries: view.deviceUploadHistory })); } catch { /* Keep the memory copy. */ }
}
function clearDeviceUploadHistory() {
  view.deviceUploadHistory = [];
  try { localStorage.removeItem('photo-saver-upload-history-v1'); } catch { /* Keep the memory copy. */ }
}
function deviceUploadEntry(active = false) {
  const upload = view.deviceUpload;
  return { id: `device-${upload.startedAt}-${upload.batchId}`, source: 'device', lane: 'device', kind: 'device-upload',
    createdAt: upload.startedAt, finishedAt: active ? null : new Date().toISOString(),
    status: active ? 'running' : upload.cancelling ? 'cancelled' : upload.results.some(item => item.status === 'failed') ? 'failed' : 'done',
    result: { items: [...upload.results], failed: upload.results.filter(item => item.status === 'failed').length,
      review: upload.results.filter(item => item.status === 'skipped' || deviceUploadRenamed(item)).length,
      uploaded: upload.results.filter(item => item.status === 'done').length, phase: upload.cancelling ? '중지 중…' : upload.scanNote,
      totalFiles: upload.totalFiles, completedFiles: upload.completedFiles, totalBytes: upload.totalBytes,
      transferredBytes: upload.uploadedBytes, current: upload.currentName } };
}
function jobActive(job = state.job) { return isJobActive(job); }
function normalizeJobs(snapshot) {
  const jobs = { local: null, remote: null, exclusive: null, ...snapshot.jobs };
  const activeJobs = { local: null, remote: null, exclusive: null, ...snapshot.activeJobs };
  if (!snapshot.jobs && snapshot.job) jobs[snapshot.job.lane || jobLanes[snapshot.job.kind] || 'exclusive'] = snapshot.job;
  for (const lane of lanes) {
    if (jobs[lane]) jobs[lane] = { ...jobs[lane], lane, result: jobs[lane].result || {} };
    if (!snapshot.activeJobs) activeJobs[lane] = isJobActive(jobs[lane]) ? jobs[lane] : null;
    else if (activeJobs[lane]) activeJobs[lane] = { ...activeJobs[lane], lane, result: activeJobs[lane].result || {} };
  }
  return { jobs, activeJobs };
}
function laneJob(lane) {
  return state.jobs?.[lane] || ((state.job?.lane || jobLanes[state.job?.kind]) === lane ? state.job : null);
}
function activeLaneJob(lane) {
  const job = state.activeJobs?.[lane] || laneJob(lane);
  return isJobActive(job) ? job : null;
}
function exclusiveActive() { return Boolean(activeLaneJob('exclusive')) || view.catalogOpBusy; }
function localBusy() { return exclusiveActive() || Boolean(activeLaneJob('local')); }
function remoteBusy() { return exclusiveActive() || Boolean(activeLaneJob('remote')); }
function anyJobActive() { return lanes.some(lane => activeLaneJob(lane)); }
function setOptimisticJob(job) {
  const lane = job.lane || jobLanes[job.kind] || 'exclusive';
  job = { ...job, lane, result: job.result || {} };
  state.job = job;
  state.jobs[lane] = job;
  state.activeJobs[lane] = isJobActive(job) ? job : null;
}
function activeJobsBar() {
  let existing = laneJobsBar();
  if (view.deviceUpload.running) {
    const upload = view.deviceUpload;
    const pill = '<div class="active-device-job"><span role="status">기기 업로드 · ' + upload.completedFiles + '/' + upload.totalFiles + ' · ' + deviceUploadPercent() + '%</span>' + button('cancel-incoming-upload', upload.cancelling ? '중지 중…' : '중지', { disabled: upload.cancelling }) + '</div>';
    existing = existing ? existing.slice(0, -6) + pill + '</div>' : '<div class="active-jobs-bar" aria-label="진행 중인 작업">' + pill + '</div>';
  }
  return existing ? existing.slice(0, -6) + '<a class="button active-jobs-link" href="#jobs">작업 내역</a></div>' : '';
}

function laneJobsBar() {
  if (!anyJobActive()) return '';
  const labels = { local: '로컬', remote: '원격', exclusive: '데이터 초기화' };
  const kinds = { "thumbnails-local": "썸네일 생성", "thumbnails-remote": "썸네일 생성", scan: '검사', move: '가져오기', delete: '사진 삭제', 'duplicate-cleanup': '중복 정리', 'xmp-link': 'XMP 연결', upload: '업로드', offload: '로컬 비우기', 'remote-index': '원격 인덱싱', 'reset-all': '초기화' };
  return `<div class="active-jobs-bar" aria-label="진행 중인 작업">${lanes.map(lane => {
    const job = activeLaneJob(lane);
    if (!job) return '';
    const result = job.result || {};
    const cancel = job.kind.startsWith("thumbnails-") ? "cancel-thumbnail-job" : job.kind === 'upload' ? 'cancel-archive-upload' : job.kind === 'remote-index' ? 'cancel-remote-index' : null;
    return `<div class="active-job-pill"><span role="status">${labels[lane]} · ${kinds[job.kind] || job.kind} #${job.id} · ${escapeHtml(result.phase || (job.status === 'queued' ? '대기 중' : '진행 중'))}${result.totalFiles ? ` · ${result.completedFiles ?? result.processedFiles ?? 0}/${result.totalFiles}` : ''}</span>${cancel ? button(cancel, result.cancelRequested ? '중지 중…' : job.kind.startsWith("thumbnails-") ? "생성 중지" : job.kind === 'upload' ? '업로드 중지' : '인덱싱 중지', { disabled: result.cancelRequested, extra: `data-value="${job.id}"` }) : ''}</div>`;
  }).join('')}</div>`;
}

function jobMessage(job) {
  if (job.status === 'cancelled') return job.result.error || '작업을 중지했습니다.';
  if (job.status === 'failed') return job.result.error;
  if (job.kind.startsWith("thumbnails-")) return thumbnailJobMessage(job.result);
  if (job.kind === 'upload') return `업로드 ${job.result.uploaded}개 완료 · 동일 파일 ${job.result.skipped}개 건너뜀`;
  if (job.kind === 'offload') return `로컬 원본 ${job.result.offloaded || 0}개를 비웠습니다.${job.result.failed ? ` 실패 ${job.result.failed}개.` : ''}`;
  if (job.kind === 'remote-index') return `원격 인덱싱 완료 · 신규 해시 ${job.result.hashed || 0}개 · 변경 없음 ${job.result.unchanged || 0}개${job.result.missing ? ` · 누락 ${job.result.missing}개` : ''}${job.result.thumbnails ? ` · ${thumbnailJobMessage(job.result.thumbnails)}` : ''}`;
  if (job.kind === 'scan') return `${job.result.checked}개 파일의 검사를 완료했습니다.`;
  if (job.kind === 'delete') return `사진 ${job.result.deleted}개를 삭제했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  if (job.kind === 'duplicate-cleanup') return `중복 ${job.result.cleaned || 0}개 정리${job.result.freedBytes ? ` · ${sizeLabel(job.result.freedBytes / 1e6)} 비움` : ''}${job.result.review ? ` · 확인 필요 ${job.result.review}개` : ''}`;
  if (job.kind === 'xmp-link') return `XMP ${job.result.linked || 0}개 연결${job.result.alreadyStored ? ` · 이미 보관 ${job.result.alreadyStored}개` : ''}${job.result.review ? ` · 확인 필요 ${job.result.review}개` : ''}`;
  return `${job.result.moved}개를 보관함으로 가져왔습니다.${job.result.xmp ? ` XMP ${job.result.xmp}개 보관.` : ''}${job.result.auxDeleted ? ` THM·LRV ${job.result.auxDeleted}개 삭제.` : ''}${job.result.duplicate ? ` 중복 ${job.result.duplicate}개.` : ''}${job.result.review || job.result.companionReview ? ` 확인 필요 ${(job.result.review || 0) + (job.result.companionReview || 0)}개.` : ''}`;
}

async function syncState() {
  const request = ++stateRequest;
  window.clearTimeout(refreshTimer);
  try {
    const previousJobs = Object.fromEntries(lanes.map(lane => [lane, laneJob(lane)]));
    const snapshot = await api('state');
    if (request !== stateRequest) return;
    Object.assign(state, snapshot, normalizeJobs(snapshot));
    view.loadError = '';
    const messages = [];
    let completed = false;
    for (const lane of lanes) {
      const previous = previousJobs[lane], current = laneJob(lane);
      if (previous?.kind === 'reset-all' && isJobActive(previous) && !current) {
        clearCatalogViews();
        messages.push('incoming과 SSH 연결 설정을 보존하고 managed·캐시·카탈로그를 초기화했습니다.');
        completed = true;
      } else if (isJobActive(previous) && current?.id === previous.id && !isJobActive(current)) {
        messages.push(jobMessage(current));
        completed = true;
        if (lane === 'remote' && current.kind === 'upload' && view.archive && view.page === 'archive') await browseArchive(view.archivePath);
      }
    }
    if (messages.length) announce(messages.filter(Boolean).join(' · '));
    if (completed) view.thumbnailGeneratingShas.clear();
    if (completed && recordBrowserVisible()) await loadCatalog({ soft: true });
    if (completed && view.page === 'settings') await loadThumbnailStats({ silent: true });
    if (view.page === 'jobs' && view.jobsTab === 'list' && (completed || lanes.some(lane => {
      const job = activeLaneJob(lane);
      return job && !view.jobs.items.some(item => item.id === job.id);
    }))) await loadJobs({ silent: true, preserveLoaded: true });
    const sourceKeys = new Set(sourceFiles().flatMap(sourceAssetKeys));
    for (const key of view.sourceSelection) if (!sourceKeys.has(key)) view.sourceSelection.delete(key);
    pruneIncomingSelection();
    const preservePreviewMessage = updatePreviewAfterDelete();
    reconcilePreview({ preserveMessage: preservePreviewMessage });
  } catch (error) {
    if (request === stateRequest) view.loadError = error.message;
  } finally {
    if (request === stateRequest) {
      view.connecting = false;
      if (anyJobActive() || view.loadError) refreshTimer = window.setTimeout(async () => {
        await syncState();
        render();
      }, view.loadError ? 2500 : 650);
    }
  }
}

async function submitJob(kind, payload, preview = null) {
  const result = await api(`jobs/${kind}`, 'POST', payload);
  setOptimisticJob({ id: result.id, kind, status: 'queued' });
  if (preview) preview.jobId = result.id;
  else view.incomingSelection.clear();
  await syncState();
}

function collectionMessage(result) {
  const needsReview = result.uncertain + result.overlapping;
  return `${result.collected}개를 배정했습니다.${needsReview ? ` 미배정 목록에 확인이 필요한 파일 ${needsReview}개가 있습니다.` : ''}`;
}

function announce(message) {
  notice.textContent = message;
  window.clearTimeout(noticeTimeout);
  noticeTimeout = window.setTimeout(() => { notice.textContent = ''; }, 3600);
}

function button(action, label, { glyph, primary, danger, disabled, extra = '' } = {}) {
  if (['new-event', 'new-child', 'edit-event', 'delete-event', 'collect', 'move-event', 'edit-media', 'edit-media-time', 'confirm-event', 'resolve-time'].includes(action)) disabled ||= exclusiveActive();
  return `<button type="button" class="button${primary ? ' primary' : ''}${danger ? ' danger' : ''}" data-action="${action}" ${disabled ? 'disabled' : ''} ${extra}>${glyph ? icon(glyph) : ''}${label}</button>`;
}

function smallButton(action, label, glyph) {
  return `<button type="button" class="button icon" data-action="${action}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
}

function header(title, description, action) {
  return `<header class="page-header">
    <div><h1 id="page-title">${title}</h1><p>${description}</p></div>
    ${action}
  </header>`;
}

function badge(type, label) {
  return `<span class="status ${type}">${label}</span>`;
}

function emptyState(glyph, title, detail = '') {
  return `<div class="empty-state"><span class="empty-icon">${icon(glyph)}</span>
    <h3>${title}</h3>${detail ? `<p>${detail}</p>` : ''}
  </div>`;
}


function sizeLabel(size) {
  if (size === null) return '—';
  if (size < 1) return `${Number((size * 1000).toFixed(1))} KB`;
  return size >= 1000 ? `${(size / 1000).toFixed(2)} GB` : `${Number(size.toFixed(1))} MB`;
}

function fileThumbnail(file, interactive = false, card = false, source = 'incoming') {
  const picture = file.kind === 'photo';
  const image = file.thumbnail ? `<img src="${escapeHtml(file.thumbnail)}" alt="" loading="lazy" decoding="async">` : '';
  const contents = `${icon(picture ? 'photo' : 'video')}${image}`;
  const canPreview = source === 'managed' ? file.status === 'available' && Boolean(file.preview) : Boolean(file.preview);
  if (interactive && canPreview) {
    const action = source === 'managed' ? 'preview-managed' : 'preview-incoming';
    const cardAttr = card ? ' data-card-preview' : '';
    return `<button type="button" class="thumb" data-action="${action}" data-value="${escapeHtml(file.id)}"
      aria-label="${escapeHtml(file.name)} 미리보기"${cardAttr}>${contents}</button>`;
  }
  return `<span class="thumb"${source === 'managed' && file.status === 'archived' ? ' title="로컬 원본 없음 (아카이브 보관)"' : ''}>${contents}</span>`;
}

const filterLabels = { all: '전체', ready: '이동 가능', duplicate: '중복', review: '확인 필요' };
const keeperLabels = { managed: 'Mac 보관 사본', remote: 'OMV 보관 사본', incoming: '같은 Incoming 검사' };
const companionLabels = {
  move: '원본과 함께 이동', 'delete-after-move': '원본 이동 후 정리', link: '연결 가능',
  linked: '연결됨', 'already-stored': '이미 보관됨', deleted: '정리됨', absent: '파일 없음', keep: '보존 필요', review: '확인 필요',
};

function canDeleteIncoming(file) {
  return file.kind === 'photo' && file.status === 'ready';
}

function canSelectIncoming(file) {
  return file.status === 'ready' || file.status === 'duplicate';
}

function selectedIncoming(predicate = canSelectIncoming) {
  return filteredIncoming().filter(file => view.incomingSelection.has(file.id) && predicate(file));
}

function pruneIncomingSelection() {
  const selectable = new Set(filteredIncoming().filter(canSelectIncoming).map(file => file.id));
  for (const id of view.incomingSelection) if (!selectable.has(id)) view.incomingSelection.delete(id);
}

function incomingPath(file) {
  return file.path ?? [file.folder, file.name].filter(Boolean).join('/');
}

function incomingReason(file) {
  const source = file.duplicateSource;
  return keeperLabels[source?.kind] ? `${keeperLabels[source.kind]} · ${source.path}` : file.reason;
}

function matchesXmp(file, query) {
  if (!file.xmp) return false;
  const { title, description, keywords, city, region, country, location, latitude, longitude, date, name } = file.xmp;
  return ['XMP', name, title, description, ...(keywords || []), city, region, country, location, latitude, longitude, date?.raw]
    .some(value => value?.toLocaleLowerCase().includes(query));
}

function companionSummary(file) {
  if (file.companions) return file.companions.map(item => `${item.path.split('/').at(-1)} ${companionLabels[item.disposition] || '확인 필요'}`).join(' · ');
  return [file.xmp ? 'XMP' : '', file.cameraAuxCount && file.status === 'ready' ? `THM·LRV ${file.cameraAuxCount}개 원본 이동 후 정리` : ''].filter(Boolean).join(' · ');
}

function filteredIncoming(filter = view.incomingFilter) {
  const query = view.query.trim().toLocaleLowerCase();
  return state.incoming.filter(file =>
    (filter === 'all' || file.status === filter) &&
    (!view.incomingKind || file.kind === view.incomingKind) &&
    (!query || incomingPath(file).toLocaleLowerCase().includes(query) || matchesXmp(file, query))
  );
}

function incomingFilters() {
  const results = filteredIncoming('all');
  return Object.entries(filterLabels).map(([key, label]) => `<button type="button" class="filter" data-action="incoming-filter" data-value="${key}" aria-pressed="${view.incomingFilter === key}">${label}<span>${key === 'all' ? results.length : results.filter(file => file.status === key).length}</span></button>`).join('');
}

function checkbox(kind, id, label, selection) {
  return `<input type="checkbox" data-select="${kind}" value="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" ${selection.has(id) ? 'checked' : ''}>`;
}

function checkHit(inputHtml) {
  return inputHtml ? `<label class="check-hit">${inputHtml}</label>` : '';
}

function incomingCardCaption(file) {
  const path = incomingPath(file);
  const reason = incomingReason(file);
  const companions = companionSummary(file);
  return `
        <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
        ${path !== file.name ? `<p class="small muted card-reason">${escapeHtml(path)}</p>` : ''}
        <div class="card-info">${badge(file.status, filterLabels[file.status] || '삭제 중')}<span class="small muted numbers">${sizeLabel(file.size)}</span></div>
        ${reason ? `<p class="small muted card-reason">${escapeHtml(reason)}</p>` : ''}
        ${companions ? `<p class="small muted card-reason">${escapeHtml(companions)}</p>` : ''}
    `;
}

function incomingEmptyState() {
  if (activeLaneJob('local')?.kind === 'scan' && !state.scan) return emptyState('refresh', '첫 검사 진행 중', '검사를 마치면 여기에 결과가 표시됩니다.');
  if (!state.scan && !state.incoming.length) return emptyState('inbox', '아직 검사 결과가 없습니다.', '기기에서 업로드하거나 incoming 폴더에 파일을 넣고 파일 검사를 누르세요.');
  if (view.query || view.incomingFilter !== 'all' || view.incomingKind) return emptyState('search', '조건에 맞는 파일이 없습니다.', button('reset-incoming-filters', '필터 초기화'));
  return state.scan?.result?.checked
    ? emptyState('check', '이번 검사에서 남은 사진·영상이 없습니다.', '파일을 추가하면 다시 검사하세요.')
    : emptyState('inbox', '검사할 사진·영상이 없습니다.', '기기에서 업로드하거나 incoming 폴더에 파일을 넣은 뒤 다시 검사하세요.');
}

function createIncomingRow(_file, parentTag) {
  return parseSingleElement(parentTag, view.incomingLayout === 'cards'
    ? '<li class="incoming-card"><div class="card-image"><span class="thumb-slot"></span><span class="card-check-slot"></span></div><div class="card-caption"></div></li>'
    : '<tr><td data-col="select"></td><td data-col="file"><div class="file-cell"><span class="thumb-slot"></span><div data-col="file-text"></div></div></td><td class="numbers muted" data-col="modified"></td><td class="numbers" data-col="size"></td><td data-col="status"></td></tr>');
}

function patchIncomingRow(node, file) {
  const card = view.incomingLayout === 'cards';
  const path = incomingPath(file);
  setSlotHtml(node.querySelector('.thumb-slot'), fileThumbnail(file, true, card));
  // Checked state belongs to selection synchronization, not the HTML slot cache.
  const select = canSelectIncoming(file) ? checkbox('incoming', file.id, `${path} 선택`, new Set()) : '';
  if (card) {
    setSlotHtml(node.querySelector('.card-check-slot'), select ? `<label class="card-check"><span class="card-check-box">${select}</span></label>` : '');
    setSlotHtml(node.querySelector('.card-caption'), incomingCardCaption(file));
  } else {
    setSlotHtml(node.querySelector('[data-col="select"]'), checkHit(select));
    const detail = [path !== file.name ? path : '', companionSummary(file)].filter(Boolean).join(' · ');
    setSlotHtml(node.querySelector('[data-col="file-text"]'), `<strong>${escapeHtml(file.name)}</strong>${detail ? `<span class="small muted">${escapeHtml(detail)}</span>` : ''}`);
    setSlotHtml(node.querySelector('[data-col="modified"]'), file.modifiedAt ? dateTimeFormatter(state.timezone).format(new Date(file.modifiedAt)) : '—');
    setSlotHtml(node.querySelector('[data-col="size"]'), sizeLabel(file.size));
    setSlotHtml(node.querySelector('[data-col="status"]'), `${badge(file.status, filterLabels[file.status] || '삭제 중')}${incomingReason(file) ? `<div class="small muted file-reason">${escapeHtml(incomingReason(file))}</div>` : ''}`);
  }
}

function patchIncomingRows() {
  const container = page.querySelector('#incoming-rows');
  const files = filteredIncoming();
  const mode = files.length ? view.incomingLayout : 'empty';
  if (container.dataset.mode !== mode) {
    container.dataset.mode = mode;
    slotHtmlCache.delete(container);
    container.innerHTML = mode === 'empty' ? '' : mode === 'cards'
      ? '<div data-col="select-all"></div><ul class="incoming-cards" aria-label="가져오기 카드 목록"></ul>'
      : '<table aria-label="가져오기 검사 결과"><thead><tr><th scope="col" data-col="select-all"></th><th scope="col">파일</th><th scope="col">수정 일시</th><th scope="col">크기</th><th scope="col">검사 결과</th></tr></thead><tbody></tbody></table>';
  }
  if (mode === 'empty') {
    setSlotHtml(container, incomingEmptyState());
    return;
  }
  const selectAll = files.some(canSelectIncoming) ? checkbox('incoming-all', 'all', '표시된 파일 모두 선택', new Set()) : '';
  setSlotHtml(container.querySelector('[data-col="select-all"]'), mode === 'cards' && selectAll
    ? `<label class="card-select-all">${selectAll} 표시된 파일 모두 선택</label>` : checkHit(selectAll));
  reconcileKeyedChildren(container.querySelector(mode === 'cards' ? 'ul' : 'tbody'), mode === 'cards' ? 'ul' : 'tbody',
    files, file => file.id, createIncomingRow, patchIncomingRow);
}

function syncIncomingSelection() {
  const container = page.querySelector('#incoming-rows');
  if (!container) return;
  for (const row of container.querySelectorAll('[data-item-key]')) {
    const selected = view.incomingSelection.has(row.dataset.itemKey);
    setClass(row, 'selected', selected);
    setChecked(row.querySelector('[data-select="incoming"]'), selected);
  }
  const files = filteredIncoming().filter(canSelectIncoming);
  const count = files.filter(file => view.incomingSelection.has(file.id)).length;
  const all = container.querySelector('[data-select="incoming-all"]');
  setChecked(all, files.length > 0 && count === files.length);
  if (all) all.indeterminate = count > 0 && count < files.length;
  renderIncomingActions();
}

function incomingActions() {
  const files = selectedIncoming();
  const photos = files.filter(canDeleteIncoming).length;
  const movable = files.filter(file => file.status === 'ready').length;
  const duplicates = files.filter(file => file.status === 'duplicate').length;
  const primaryAction = duplicates > 0 && (!movable || view.incomingFilter === 'duplicate') ? 'cleanup' : 'move';
  const summary = movable && duplicates ? `<strong>${files.length}개 선택</strong> · 이동 가능 ${movable}개 · 중복 ${duplicates}개` :
    movable ? `<strong>이동 가능 ${movable}개 선택</strong>` : duplicates ? `<strong>중복 ${duplicates}개 선택</strong>` : `<strong>${files.length}개 선택</strong>`;
  return `${files.length ? `<div>${summary}${button('clear-incoming-selection', '선택 해제')}</div>` : '<span class="small muted action-bar-idle">항목을 선택하면 보관함 가져오기·중복 정리·사진 삭제 작업이 표시됩니다.</span>'}
    <div class="action-bar-buttons" ${files.length ? '' : 'hidden'}>
    ${button('delete-incoming', photos ? `사진 삭제 (${photos})` : '사진 삭제', { glyph: 'trash', danger: true, disabled: !photos || localBusy(), extra: photos ? '' : 'hidden' })}
    ${button('cleanup-incoming', view.cleanupPlanning ? '보관 사본 조회 중…' : duplicates ? `중복 정리 (${duplicates})` : '중복 정리', { glyph: 'check', primary: primaryAction === 'cleanup', danger: true, disabled: !duplicates || localBusy() || view.cleanupPlanning, extra: duplicates ? '' : 'hidden' })}
    ${button('move-incoming', movable ? `보관함으로 가져오기 (${movable})` : '보관함으로 가져오기', { glyph: 'arrow', primary: primaryAction === 'move', disabled: !movable || localBusy(), extra: movable ? '' : 'hidden' })}</div>`;
}

function renderIncomingActions() {
  const bar = page.querySelector('#incoming-actions');
  setClass(bar, 'has-selection', selectedIncoming().length > 0);
  setSlotHtml(bar, incomingActions());
  syncStickyActionBar();
}

let observedStickyBar = null;
const stickyActionObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(syncStickyActionBar) : null;

function syncStickyActionBar() {
  const incomingActive = view.page === 'incoming' && view.incomingTab === 'files' && selectedIncoming().length > 0;
  const eventActive = view.page === 'events' && view.eventSelection.size > 0;
  const active = incomingActive || eventActive;
  setClass(page, 'has-sticky-actions', active);
  setClass(document.body, 'has-sticky-actions', active);
  setClass(document.body, 'has-event-sticky-actions', eventActive);
  // Wrapped actions can exceed 140px on phones; keep notices above the actual bar.
  const bar = active ? page.querySelector(incomingActive ? '#incoming-actions' : '#event-actions') : null;
  if (observedStickyBar !== bar) {
    stickyActionObserver?.disconnect();
    if (bar) stickyActionObserver?.observe(bar);
    observedStickyBar = bar;
  }
  const height = typeof bar?.getBoundingClientRect === 'function' ? Math.ceil(bar.getBoundingClientRect().height) : 0;
  notice.setAttribute('style', `--selection-bar-height: ${height}px`);
  page.setAttribute('style', `--selection-bar-height: ${height}px`);
}

window.addEventListener('resize', syncStickyActionBar);

function pendingXmpLinks() {
  return state.pendingXmp.filter(file => file.status === 'pending').map(file => ({
    id: file.id, media_id: view.xmpChoices.get(file.id) ?? file.recommended,
  })).filter(link => link.media_id);
}

function pendingXmpSection() {
  if (!state.pendingXmp.length) return emptyState('check', '연결할 XMP 파일이 없습니다.', button('incoming-tab', '파일 목록으로 돌아가기', { extra: 'data-value="files"' }));
  const selected = pendingXmpLinks();
  const duplicated = new Set(selected.map(link => link.media_id)).size !== selected.length;
  return `
    <div class="table-wrap xmp-matches"><table aria-label="XMP 원본 후보"><thead><tr><th scope="col">XMP 파일</th><th scope="col">기록된 시각</th><th scope="col">managed 원본</th></tr></thead>
      <tbody>${state.pendingXmp.map(file => {
        const chosen = view.xmpChoices.get(file.id) ?? file.recommended;
        return `<tr><td>${escapeHtml(file.path)}</td><td>${escapeHtml(file.date?.raw || '—')}</td><td>
          ${file.status === 'pending' && file.candidates.length ? `<select data-xmp-id="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.path)} 원본 후보">
            <option value="">선택 안 함</option>${file.candidates.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === chosen ? 'selected' : ''}>${escapeHtml(item.originalPath || item.name)} · ${item.kind === 'photo' ? '사진' : '영상'}</option>`).join('')}
          </select>` : `<span class="muted">${escapeHtml(file.reason || '연결 가능한 원본을 찾지 못했습니다.')}</span>`}</td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="action-bar"><span class="small muted">${duplicated ? '같은 원본에 여러 XMP가 선택되었습니다.' : '원본을 확인한 뒤 XMP를 함께 보관합니다.'}</span>
      ${button('link-xmp', '선택한 XMP 연결', { primary: true, disabled: !selected.length || duplicated || localBusy() })}</div>
  `;
}

function unmatchedCompanionsSection() {
  const items = state.scan?.result?.unmatchedCompanions;
  if (!items?.length) return emptyState('check', '확인이 필요한 동반 파일이 없습니다.', button('incoming-tab', '파일 목록으로 돌아가기', { extra: 'data-value="files"' }));
  return `<div class="unmatched-companions-panel">
    <ul>${items.map(item => `<li><strong>${escapeHtml(item.path)}</strong> <span class="small muted">${escapeHtml(companionLabels[item.disposition] || '확인 필요')}</span>
      <p class="small">${escapeHtml(item.reason)}</p></li>`).join('')}</ul>
  </div>`;
}

function incomingResultSection() {
  const titles = { move: '보관함 가져오기 결과', delete: '사진 삭제 결과', 'duplicate-cleanup': '중복 정리 결과', 'xmp-link': 'XMP 연결 결과' };
  const job = state.latestIncomingResult || laneJob('local');
  if (!titles[job?.kind] || isJobActive(job) || isResultDismissed(job)) return '';
  const result = job.result || {};
  const items = result.items || [];
  const itemLabels = { moved: '이동 완료', duplicate: '이미 보관됨', cleaned: '정리 완료', deleted: '삭제 완료', review: '확인 필요', linked: '연결 완료', 'already-stored': '이미 보관됨' };
  const previous = page.querySelector('#incoming-result-items');
  const key = jobDismissKey(job);
  const expanded = previous && previous.dataset.jobKey === key ? previous.open : (view.resultDetailsOpen.has(key) ? view.resultDetailsOpen.get(key) : jobHasAttention(job));
  const followup = `${result.moved ? button('open-unassigned', '이벤트 분류의 미배정 열기', { glyph: 'arrow' }) : ''}${result.review || result.companionReview || job.status === 'failed' ? button('rescan-incoming', '다시 검사', { glyph: 'refresh', disabled: localBusy() }) : ''}`;
  return `<section class="surface incoming-result result-banner result-banner-${resultTone(job)}" ${job.status === 'failed' ? 'role="alert"' : ''} aria-labelledby="incoming-result-title">
    <div class="incoming-result-summary">
      <div><h2 id="incoming-result-title">${titles[job.kind]}</h2><p class="small muted">${escapeHtml(jobMessage(job) || '작업을 완료하지 못했습니다.')}</p></div>
      <div class="incoming-next-actions">
        ${resultBannerActions(job, titles[job.kind], followup)}
      </div>
    </div>
    ${items.length ? `<details id="incoming-result-items" data-job-id="${job.id}" data-job-key="${escapeHtml(key)}" data-result-details="${escapeHtml(key)}" ${expanded ? 'open' : ''}>
      <summary>파일별 결과 ${items.length}개</summary>
      <ul>${items.map(item => `<li>
        <strong>${escapeHtml(item.path || item.id || '경로 정보 없음')}</strong> <span class="small muted">${escapeHtml(itemLabels[item.status] || item.status)}</span>
        ${item.reason ? `<p class="small">${escapeHtml(item.reason)}</p>` : ''}
        ${item.companions?.length ? `<ul>${item.companions.map(companion => `<li class="small">${escapeHtml(companion.path)} · ${escapeHtml(companionLabels[companion.disposition] || '확인 필요')}${companion.reason ? ` · ${escapeHtml(companion.reason)}` : ''}</li>`).join('')}</ul>` : ''}
      </li>`).join('')}</ul>
    </details>` : ''}
  </section>`;
}

function incomingScanStrip() {
  const job = activeLaneJob('exclusive') || laneJob('local');
  const active = isJobActive(job);
  const failedScan = job?.kind === 'scan' && job.status === 'failed';
  const complete = state.scan?.result;
  const jobLabels = {
    scan: '파일 검사 중', move: '보관함으로 가져오는 중', delete: '사진 삭제 중',
    'duplicate-cleanup': '중복 정리 중', 'xmp-link': 'XMP 연결 중', 'reset-all': '서버 데이터 초기화 중',
  };
  const status = active ? (jobLabels[job.kind] || '작업 진행 중') :
    failedScan ? '파일 검사 실패' : state.scan ? '최근 검사 완료' : '검사 대기';
  const xmpCount = state.pendingXmp.length;
  const companionsCount = complete?.unmatchedCompanions?.length || 0;
  const counts = xmpCount || companionsCount ? ` · XMP ${xmpCount} · 동반 파일 ${companionsCount}` : '';
  const detail = failedScan ? (job.result.error || '다시 검사하세요.') : active ? (job.result?.phase || '작업을 준비하고 있습니다.') :
    complete ? `${dateTimeFormatter(state.timezone).format(new Date(state.scan.finishedAt))} · 총 ${complete.checked}개 검사${counts}` : '파일 검사를 눌러 시작하세요.';
  const total = active ? job.result?.totalFiles : 0;
  const completed = active ? job.result?.completedFiles ?? 0 : 0;
  return `<div class="scan-strip" role="status">
      <span>${icon(active ? 'refresh' : 'check')} ${status}</span>
      <span class="small incoming-progress">${escapeHtml(detail)}${total > 0 ? ` · ${completed} / ${total}<progress aria-label="${status} 진행률" value="${completed}" max="${total}"></progress>` : ''}
        ${active && job.result?.current ? `<span class="incoming-path">${escapeHtml(job.result.current)}</span>` : ''}</span>
    </div>`;
}

const devicePhotoExtensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
const deviceVideoExtensions = new Set(['mp4', 'mov']);
const deviceCompanionExtensions = new Set(['xmp', 'thm', 'lrv']);
function deviceExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
function deviceStem(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
function deviceUploadExclusionReason(file) {
  if (file.name.startsWith('.')) return '숨김 파일 제외';
  if (file.size <= 0) return '빈 파일 제외';
  const extension = deviceExtension(file.name);
  return devicePhotoExtensions.has(extension) || deviceVideoExtensions.has(extension) || deviceCompanionExtensions.has(extension) ? '' : '지원하지 않는 형식 제외';
}
function deviceKey(name) { return name.normalize('NFC').toLowerCase(); }
function deviceUploadBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Math.max(0, bytes), unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return Number(value.toFixed(unit && value < 10 ? 1 : 0)) + ' ' + units[unit];
}
function deviceUploadRenamed(item) {
  return item.status === 'done' && Boolean(item.result?.renamed || item.result?.name && item.result.name !== item.name);
}
let incomingUploadDetails = { batchId: -1, open: false, userToggled: false, autoExpanded: false };
function deviceUploadPercent() {
  const upload = view.deviceUpload;
  return upload.totalBytes ? Math.min(100, Math.floor(100 * upload.uploadedBytes / upload.totalBytes)) : 0;
}

function incomingUploadShell() {
  return '<section id="incoming-upload-panel" class="surface incoming-upload-panel" hidden aria-labelledby="incoming-upload-title">' +
    '<div class="surface-head"><h2 id="incoming-upload-title">기기에서 업로드</h2><div id="incoming-upload-head-actions"></div></div>' +
    '<input id="incoming-upload-input" type="file" multiple hidden>' +
    '<div class="incoming-upload-options"><label for="incoming-upload-folder">저장할 하위 폴더<input id="incoming-upload-folder" type="text" placeholder="예: 2026-11-24_iphone (선택)" maxlength="180"></label>' +
    '<label class="incoming-upload-autoscan"><input id="incoming-upload-autoscan" type="checkbox">완료 후 파일 검사</label></div>' +
    '<div class="incoming-upload-dropzone" data-incoming-upload-drop="true"><p>사진·영상·동반 파일을 여기에 놓으세요.</p><div id="incoming-upload-picker-actions"></div></div>' +
    '<p class="small muted">iPhone·iPad 사진 보관함에서 원본 화질(HEIC·MOV)을 유지하려면 선택 화면 ‘옵션’에서 ‘현재 항목’을 선택하세요.</p>' +
    '<div id="incoming-upload-progress" role="status" aria-live="polite"></div><div id="incoming-upload-results" class="incoming-upload-results"></div></section>';
}

function patchIncomingUpload() {
  const upload = view.deviceUpload;
  const panel = page.querySelector('#incoming-upload-panel');
  if (!panel) return;
  panel.hidden = !upload.open;
  const folder = panel.querySelector('#incoming-upload-folder');
  if (folder.value !== upload.folder) folder.value = upload.folder;
  setDisabled(folder, upload.running);
  const autoScan = panel.querySelector('#incoming-upload-autoscan');
  autoScan.checked = upload.autoScan;
  setDisabled(autoScan, upload.running);
  setSlotHtml(panel.querySelector('#incoming-upload-head-actions'), upload.running ? button('cancel-incoming-upload', upload.cancelling ? '중지 중…' : '중지', { disabled: upload.cancelling }) : '');
  setSlotHtml(panel.querySelector('#incoming-upload-picker-actions'), button('choose-incoming-upload-files', '사진·파일 선택', { glyph: 'upload', primary: true, disabled: upload.running || exclusiveActive() || view.connecting }));
  const currentPercent = upload.currentTotal ? Math.min(100, Math.floor(100 * upload.currentLoaded / upload.currentTotal)) : 0;
  setSlotHtml(panel.querySelector('#incoming-upload-progress'), upload.totalFiles ?
    '<p>' + upload.completedFiles + '/' + upload.totalFiles + '개 · ' + deviceUploadBytes(upload.uploadedBytes) + ' / ' + deviceUploadBytes(upload.totalBytes) + ' (' + deviceUploadPercent() + '%)</p>' +
    '<progress class="device-upload-progress" max="100" value="' + deviceUploadPercent() + '" aria-label="전체 기기 업로드 진행률"></progress>' +
    (upload.currentName ? '<p class="small muted">' + escapeHtml(upload.currentName) + ' · ' + deviceUploadBytes(upload.currentLoaded) + ' / ' + deviceUploadBytes(upload.currentTotal) + ' (' + currentPercent + '%)</p><progress class="device-upload-progress" max="100" value="' + currentPercent + '" aria-label="현재 파일 업로드 진행률"></progress>' : '') +
    (upload.running ? '<p class="small muted">업로드가 끝날 때까지 화면을 켜 두고 이 탭을 유지하세요.</p>' : '') : '');
  const previousDetails = panel.querySelector('#incoming-upload-result-items');
  if (incomingUploadDetails.batchId !== upload.batchId) incomingUploadDetails = { batchId: upload.batchId, open: false, userToggled: false, autoExpanded: false };
  else if (previousDetails && previousDetails.open !== incomingUploadDetails.open) {
    incomingUploadDetails.open = previousDetails.open;
    incomingUploadDetails.userToggled = true;
  }
  const needsAttention = upload.results.some(item => item.status === 'failed' || item.status === 'skipped' || deviceUploadRenamed(item));
  if (needsAttention && !incomingUploadDetails.userToggled && !incomingUploadDetails.autoExpanded) {
    incomingUploadDetails.open = true;
    incomingUploadDetails.autoExpanded = true;
  }
  const counts = [
    ['완료', upload.results.filter(item => item.status === 'done').length],
    ['이름 변경', upload.results.filter(deviceUploadRenamed).length],
    ['제외', upload.results.filter(item => item.status === 'skipped').length],
    ['실패', upload.results.filter(item => item.status === 'failed').length],
    ['취소', upload.results.filter(item => item.status === 'cancelled').length],
  ].filter(([, count]) => count > 0).map(([label, count]) => label + ' ' + count + '개').join(' · ');
  const resultBar = !upload.running && (upload.results.length || upload.scanNote) ? `<div class="upload-result-bar ${needsAttention || upload.cancelling ? 'result-tone-warn' : ''}">${badge(needsAttention || upload.cancelling ? 'review' : 'ready', upload.cancelling ? '중지됨' : needsAttention ? '확인 필요' : '업로드 완료')}<a class="button" href="#jobs">작업 내역</a>${button('dismiss-upload-result', '닫기', { glyph: 'close', extra: 'aria-label="기기 업로드 결과 닫기"' })}</div>` : '';
  const resultsChanged = setSlotHtml(panel.querySelector('#incoming-upload-results'), resultBar + (upload.scanNote ? '<p role="status">' + escapeHtml(upload.scanNote) + '</p>' : '') + (upload.results.length ?
    '<details id="incoming-upload-result-items"><summary>업로드 결과 · ' + counts + '</summary><ul>' +
    upload.results.map(item => '<li>' + escapeHtml(item.name) + ' · ' + escapeHtml(item.message) +
      (item.result?.path ? '<div class="small muted">' + (deviceUploadRenamed(item) ? '이름 변경: ' + escapeHtml(item.name) + ' → ' : '저장 경로: ') + escapeHtml(item.result.path) + '</div>' : '') + '</li>').join('') + '</ul></details>' : ''));
  const details = panel.querySelector('#incoming-upload-result-items');
  if (details) {
    details.open = incomingUploadDetails.open;
    if (resultsChanged) {
      const detailsState = incomingUploadDetails;
      // Native summary activation can happen between two polling renders.
      details.addEventListener('click', event => {
        if (event.target.closest('summary')) detailsState.userToggled = true;
      });
      details.addEventListener('toggle', () => {
        if (details.open !== detailsState.open) {
          detailsState.open = details.open;
          detailsState.userToggled = true;
        }
      });
    }
  }
}

function refreshDeviceUpload() {
  if (view.page === 'incoming') { patchIncomingUpload(); patchPageStatus(); }
  else if (view.page === 'jobs') patchJobsPage();
  else render();
  renderNavigation();
}

async function deviceUploadRequest(path, method = 'GET', body, signal) {
  const binary = body && typeof body !== 'string';
  const response = await fetch('/api/incoming/uploads' + path, {
    method, cache: 'no-store', signal,
    headers: body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : undefined, body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.detail || '업로드 요청에 실패했습니다.');
    error.status = response.status;
    error.expectedOffset = result.expectedOffset;
    throw error;
  }
  return result;
}

// Kept separate so retry timing can be replaced in the deterministic DOM tests.
function deviceUploadDelay(ms) { return new Promise(resolve => window.setTimeout(resolve, ms)); }
function deviceUploadAborted() {
  const error = new Error('업로드를 중지했습니다.');
  error.name = 'AbortError';
  return error;
}
function checkDeviceUploadCancelled(upload) { if (upload.cancelling) throw deviceUploadAborted(); }

async function deleteDeviceUpload(uploadId) {
  if (!uploadId) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await deviceUploadRequest('/' + uploadId, 'DELETE'); return; }
    catch (error) {
      if (error.status === 404) return;
      if (error.status !== 409 || attempt === 2) throw error;
      await deviceUploadDelay(attempt ? 2000 : 800);
    }
  }
}

async function cancelIncomingUpload() {
  const upload = view.deviceUpload;
  if (!upload.running) return;
  upload.cancelling = true;
  upload.abortController?.abort();
  refreshDeviceUpload();
  try { await deleteDeviceUpload(upload.activeUploadId); }
  catch {
    upload.scanNote = '임시 업로드 정리를 확인하지 못했습니다. 남은 임시 파일은 2시간 후 정리됩니다.';
    refreshDeviceUpload();
  }
}

async function uploadDeviceFile(file, name, folder) {
  const upload = view.deviceUpload;
  const signal = upload.abortController?.signal;
  checkDeviceUploadCancelled(upload);
  // Do not abort creation: receiving its ID lets cancellation always delete it.
  const session = await deviceUploadRequest('', 'POST', JSON.stringify({ name, size: file.size, folder, last_modified_ms: Number.isFinite(file.lastModified) ? Math.trunc(file.lastModified) : null }));
  upload.activeUploadId = session.uploadId;
  checkDeviceUploadCancelled(upload);
  let offset = 0, retries = 0;
  const chunkSize = Math.max(1, Math.min(session.chunkSize, session.maxChunkBytes || session.chunkSize));
  while (offset < file.size) {
    checkDeviceUploadCancelled(upload);
    try {
      const sent = await deviceUploadRequest('/' + session.uploadId + '/chunks?offset=' + offset, 'PUT', file.slice(offset, offset + chunkSize), signal);
      if (!Number.isInteger(sent.receivedBytes) || sent.receivedBytes <= offset || sent.receivedBytes > file.size) throw new Error('잘못된 업로드 진행률입니다.');
      upload.uploadedBytes += sent.receivedBytes - offset;
      offset = sent.receivedBytes;
      upload.currentLoaded = offset;
      retries = 0;
      refreshDeviceUpload();
    } catch (error) {
      checkDeviceUploadCancelled(upload);
      if (error.name === 'AbortError') throw error;
      const offsetConflict = error.status === 409 && Number.isInteger(error.expectedOffset);
      if ((!offsetConflict && error.status >= 400 && error.status < 500) || error.status === 507 || retries >= 2) throw error;
      await deviceUploadDelay([800, 2000][retries++]);
      checkDeviceUploadCancelled(upload);
      const status = offsetConflict ? { receivedBytes: error.expectedOffset } : await deviceUploadRequest('/' + session.uploadId, 'GET', undefined, signal);
      if (!Number.isInteger(status.receivedBytes) || status.receivedBytes < 0 || status.receivedBytes > file.size) throw new Error('잘못된 업로드 오프셋입니다.');
      upload.uploadedBytes += status.receivedBytes - offset;
      offset = status.receivedBytes;
      upload.currentLoaded = offset;
      refreshDeviceUpload();
    }
  }
  checkDeviceUploadCancelled(upload);
  // Completion can publish the file; let its response settle before cancelling.
  const result = await deviceUploadRequest('/' + session.uploadId + '/complete', 'POST');
  upload.activeUploadId = null;
  return result;
}

async function startIncomingUpload(entries) {
  const upload = view.deviceUpload;
  if (upload.running || exclusiveActive() || view.connecting || !entries.length) return;
  Object.assign(upload, { open: true, running: true, cancelling: false, totalFiles: Math.min(entries.length, 2000), completedFiles: 0, totalBytes: 0, uploadedBytes: 0, currentName: '', currentLoaded: 0, currentTotal: 0, results: [], scanNote: '', activeUploadId: null, batchId: upload.batchId + 1, abortController: typeof AbortController === 'function' ? new AbortController() : null });
  upload.startedAt = new Date().toISOString(); upload.dismissedBatchId = 0;
  const queue = entries.slice(0, 2000).map(entry => entry.file ? entry : { file: entry, folder: '' });
  if (entries.length > 2000) upload.scanNote = '한 번에 2,000개까지 업로드합니다. 나머지 파일은 다시 선택하세요.';
  const rank = file => devicePhotoExtensions.has(deviceExtension(file.name)) ? 0 : deviceVideoExtensions.has(deviceExtension(file.name)) ? 1 : 2;
  queue.sort((a, b) => rank(a.file) - rank(b.file));
  upload.totalBytes = queue.reduce((sum, entry) => sum + (deviceUploadExclusionReason(entry.file) ? 0 : entry.file.size), 0);
  const exact = new Map(), stems = new Map(), stemSources = new Map();
  const folderFor = entry => [upload.folder.trim().normalize('NFC').replace(/\/+$/, ''), entry.folder || ''].filter(Boolean).join('/');
  for (const entry of queue) {
    if (deviceUploadExclusionReason(entry.file) || rank(entry.file) === 2) continue;
    const key = folderFor(entry) + '/' + deviceKey(deviceStem(entry.file.name));
    stemSources.set(key, (stemSources.get(key) || 0) + 1);
  }
  let wakeLock;
  refreshDeviceUpload();
  try {
    if (typeof navigator !== 'undefined' && navigator.wakeLock?.request) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* Upload works without a screen lock. */ }
    }
    for (const entry of queue) {
      const file = entry.file, extension = deviceExtension(file.name), folder = folderFor(entry);
      upload.currentName = file.name; upload.currentLoaded = 0; upload.currentTotal = file.size;
      refreshDeviceUpload();
      if (upload.cancelling) {
        upload.results.push({ name: file.name, status: 'cancelled', message: '중지됨' });
      } else if (deviceUploadExclusionReason(file)) {
        upload.results.push({ name: file.name, status: 'skipped', message: deviceUploadExclusionReason(file) });
      } else {
        try {
          let name = file.name;
          if (deviceCompanionExtensions.has(extension)) {
            const base = deviceStem(name), key = folder + '/' + deviceKey(base);
            const replacement = exact.get(key) || (stemSources.get(key) === 1 ? stems.get(key) : null);
            if (replacement) name = replacement + name.slice(name.lastIndexOf('.'));
          }
          const result = await uploadDeviceFile(file, name, folder);
          upload.results.push({ name: file.name, status: 'done', message: result.renamed || name !== file.name ? '완료 → ' + result.name : '완료', result });
          if (!deviceCompanionExtensions.has(extension)) {
            exact.set(folder + '/' + deviceKey(file.name), result.name);
            const key = folder + '/' + deviceKey(deviceStem(file.name));
            if (stemSources.get(key) === 1) stems.set(key, deviceStem(result.name));
          }
        } catch (error) {
          upload.results.push({ name: file.name, status: upload.cancelling || error.name === 'AbortError' ? 'cancelled' : 'failed', message: upload.cancelling ? '중지됨' : error.message });
          try { await deleteDeviceUpload(upload.activeUploadId); }
          catch { upload.scanNote = '남은 임시 파일은 2시간 후 정리됩니다.'; }
          upload.activeUploadId = null;
        }
      }
      upload.completedFiles++;
      refreshDeviceUpload();
    }
  } finally {
    try { await wakeLock?.release(); } catch { /* Lock may already have been released by the OS. */ }
    upload.running = false; upload.abortController = null; upload.currentName = '';
    if (upload.results.some(item => item.status === 'done') && upload.autoScan) {
      if (!localBusy() && !exclusiveActive()) {
        try { await submitJob('scan'); upload.scanNote = '업로드 완료 후 파일 검사를 시작했습니다.'; }
        catch (error) { upload.scanNote = '파일 검사를 시작하지 못했습니다. ' + error.message; }
      } else upload.scanNote = '진행 중인 로컬 작업이 끝난 뒤 파일 검사를 누르세요.';
    }
    if (upload.completedFiles > 0) recordDeviceUploadHistory(deviceUploadEntry());
    refreshDeviceUpload();
  }
}

async function collectIncomingDrop(dataTransfer) {
  const collected = [];
  async function visit(entry, folder) {
    if (!entry || entry.name.startsWith('.') || collected.length >= 2000) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      if (collected.length < 2000) collected.push({ file, folder });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (collected.length < 2000) {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, [folder, entry.name].filter(Boolean).join('/'));
      }
    }
  }
  const items = Array.from(dataTransfer.items || []);
  if (items.some(item => typeof item.webkitGetAsEntry === 'function')) {
    // Capture entries during the drop event while the data store is available.
    const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
    for (const entry of entries) await visit(entry, '');
  } else {
    for (const file of Array.from(dataTransfer.files || []).slice(0, 2000)) if (!file.name.startsWith('.')) collected.push({ file, folder: '' });
  }
  return collected;
}

window.addEventListener('beforeunload', event => {
  if (!view.deviceUpload.running) return;
  event.preventDefault(); event.returnValue = '';
});
window.addEventListener('pagehide', () => {
  const upload = view.deviceUpload;
  if (!upload.running || !upload.activeUploadId) return;
  upload.cancelling = true;
  upload.abortController?.abort();
  fetch('/api/incoming/uploads/' + upload.activeUploadId, { method: 'DELETE', keepalive: true }).catch(() => {});
});

function incomingTabsMarkup() {
  return [
    { key: 'files', label: '파일 목록', count: state.incoming.length },
    { key: 'xmp', label: 'XMP 연결', count: state.pendingXmp.length, tone: 'is-accent' },
    { key: 'companions', label: '동반 파일 확인', count: state.scan?.result?.unmatchedCompanions?.length || 0, tone: 'is-warn' },
  ].map(({ key, label, count, tone }) => {
    const active = view.incomingTab === key;
    return `<button type="button" role="tab" id="incoming-tab-${key}" class="catalog-tab incoming-tab${key !== 'files' && !count ? ' is-empty' : ''}" data-action="incoming-tab" data-value="${key}" aria-selected="${active}" aria-controls="incoming-tabpanel-${key}" tabindex="${active ? '0' : '-1'}">${label}<span class="incoming-tab-count${count && tone ? ` ${tone}` : ''}">${count}</span></button>`;
  }).join('');
}

function mountIncomingPage() {
  page.innerHTML = `<main aria-labelledby="page-title" data-page="incoming">
    <div id="page-active-jobs"></div><div id="page-load-error"></div>
    <div id="incoming-header"></div><div id="incoming-scan-strip"></div><div id="incoming-result-slot"></div>
    ${incomingUploadShell()}
    <section class="surface" aria-labelledby="incoming-title">
      <div class="surface-head incoming-tabs-head"><h2 id="incoming-title" class="sr-only">검사 결과</h2>
        <div id="incoming-tabs" class="incoming-tabs" role="tablist" aria-label="가져오기 탭"></div>
        <div class="view-switch" id="incoming-view-switch" role="group" aria-label="보기 방식">
          <button class="filter" type="button" data-action="incoming-layout" data-value="table" aria-pressed="${view.incomingLayout === 'table'}">${icon('table')} 표 보기</button>
          <button class="filter" type="button" data-action="incoming-layout" data-value="cards" aria-pressed="${view.incomingLayout === 'cards'}">${icon('grid')} 카드 보기</button>
        </div>
      </div>
      <div id="incoming-tabpanel-files" class="incoming-tabpanel" role="tabpanel" aria-labelledby="incoming-tab-files">
      <div class="filter-bar">
        <div class="filters" id="incoming-filters" aria-label="검사 결과 필터"></div>
        <div class="field-control">
          <select id="incoming-kind" aria-label="파일 형식 필터">
            <option value="">모든 형식</option>
            <option value="photo" ${view.incomingKind === 'photo' ? 'selected' : ''}>사진</option>
            <option value="video" ${view.incomingKind === 'video' ? 'selected' : ''}>영상</option>
          </select>
          <label class="search">${icon('search')}<span class="sr-only">파일 검색</span><input type="search" id="file-search" placeholder="파일 검색" value="${escapeHtml(view.query)}"></label>
        </div>
      </div>
      <div class="table-wrap" id="incoming-rows"></div>
      <div class="action-bar" id="incoming-actions"></div>
      </div>
      <div id="incoming-tabpanel-xmp" class="incoming-tabpanel" role="tabpanel" aria-labelledby="incoming-tab-xmp" hidden><div id="incoming-xmp-slot"></div></div>
      <div id="incoming-tabpanel-companions" class="incoming-tabpanel" role="tabpanel" aria-labelledby="incoming-tab-companions" hidden><div id="incoming-unmatched-slot"></div></div>
    </section>
  </main>`;
}

function patchPageStatus() {
  setSlotHtml(page.querySelector('#page-active-jobs'), activeJobsBar());
  setSlotHtml(page.querySelector('#page-load-error'), view.loadError ? `<p class="scan-strip" role="alert">${escapeHtml(view.loadError)}</p>` : '');
}

function patchIncomingPage() {
  syncStickyActionBar();
  patchPageStatus();
  setSlotHtml(page.querySelector('#incoming-tabs'), incomingTabsMarkup());
  for (const key of ['files', 'xmp', 'companions']) {
    page.querySelector(`#incoming-tabpanel-${key}`).hidden = view.incomingTab !== key;
  }
  page.querySelector('#incoming-view-switch').hidden = view.incomingTab !== 'files';
  const scanning = activeLaneJob('local')?.kind === 'scan';
  setSlotHtml(page.querySelector('#incoming-header'), header('가져오기', '기기에서 업로드하거나 incoming 폴더에 넣은 사진과 영상을 검사하고 정리합니다.',
    '<div class="page-header-actions">' + button('toggle-incoming-upload', '기기에서 업로드', { glyph: 'upload', disabled: exclusiveActive() || view.connecting, extra: 'aria-expanded="' + view.deviceUpload.open + '" aria-controls="incoming-upload-panel"' }) +
    button('scan', scanning ? '검사 중…' : '파일 검사', { glyph: 'refresh', disabled: localBusy() || view.connecting }) + '</div>'));
  setSlotHtml(page.querySelector('#incoming-scan-strip'), incomingScanStrip());
  patchIncomingUpload();
  setSlotHtml(page.querySelector('#incoming-filters'), incomingFilters());
  for (const control of page.querySelectorAll('#incoming-view-switch button')) {
    control.setAttribute('aria-pressed', String(control.dataset.value === view.incomingLayout));
  }
  const kind = page.querySelector('#incoming-kind');
  if (kind.value !== view.incomingKind) kind.value = view.incomingKind;
  const search = page.querySelector('#file-search');
  if (search.value !== view.query) search.value = view.query;
  patchIncomingRows();
  syncIncomingSelection();
  setSlotHtml(page.querySelector('#incoming-result-slot'), incomingResultSection());
  setSlotHtml(page.querySelector('#incoming-unmatched-slot'), unmatchedCompanionsSection());
  const xmpScroll = page.querySelector('.xmp-matches')?.scrollTop || 0;
  if (setSlotHtml(page.querySelector('#incoming-xmp-slot'), pendingXmpSection())) {
    page.querySelector('.xmp-matches')?.scrollTo(0, xmpScroll);
  }
}

function eventById(id) {
  return state.events.find(event => event.id === id);
}

function childEvents(id) {
  return state.events.filter(event => event.parent === id);
}

function footageForEvent(id) {
  if (id === 'all') return state.managed;
  return state.managed.filter(file => file.eventId === (id === 'unassigned' ? null : id));
}

function eventLink(id, label, count, child = false) {
  return `<button type="button" class="event-link${child ? ' child' : ''}" data-action="choose-event" data-value="${id}" aria-current="${id === view.eventId}">
    ${icon(id === 'unassigned' ? 'inbox' : 'folder')}<span class="event-label">${escapeHtml(label)}</span><span class="count">${count}</span>
  </button>`;
}


function eventDestinations(event) {
  return state.events.filter(option => option.id !== event?.id);
}

function eventLabel(event) {
  if (!event.start) return event.name;
  const prefix = `${event.start.slice(2).replaceAll('-', '')}_`;
  return event.name.startsWith(prefix) ? event.name : `${prefix}${event.name}`;
}

function eventOptionLabel(event) {
  return event.parent ? `${eventLabel(eventById(event.parent))} / ${eventLabel(event)}` : eventLabel(event);
}

function eventDateForFile(file) {
  if (!file.time) return '';
  const event = eventById(view.eventId);
  const root = event?.parent ? eventById(event.parent) : event;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: root?.zone || state.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(file.time));
}

function matchesEventLifecycle(file, filter = view.eventLifecycle) {
  if (filter === 'all') return true;
  if (filter === 'archived') return file.status === 'archived';
  if (file.status === 'archived') return false;
  return filter === 'confirmed' ? Boolean(file.confirmed) : !file.confirmed;
}

function hasActiveEventFilters() {
  return view.eventLifecycle !== 'all' || Boolean(view.eventDevice) || Boolean(view.eventDate) || Boolean(view.eventQuery.trim());
}

function filteredEventFiles(files) {
  const query = view.eventQuery.trim().toLocaleLowerCase();
  return files.filter(file =>
    matchesEventLifecycle(file) &&
    (!view.eventDevice || (view.eventDevice === 'missing' ? !file.device : `device:${file.device}` === view.eventDevice)) &&
    (!view.eventDate || eventDateForFile(file) === view.eventDate) &&
    (!query || file.name.toLocaleLowerCase().includes(query) || file.device?.toLocaleLowerCase().includes(query) || matchesXmp(file, query))
  );
}

function offloadStatus() {
  const job = laneJob('remote');
  if (job?.kind !== 'offload') return '';
  const result = job.result || {};
  const active = jobActive(job);
  if (!active) return resultBanner(job, 'NAS 보관 후 로컬 비우기 결과');
  const percent = Math.min(100, Math.round((result.completedFiles || 0) / (result.totalFiles || 1) * 100));
  return `<section class="surface upload-status" aria-label="NAS 보관 후 로컬 비우기 상태">
    <div class="upload-summary"><strong role="status">${active ? job.status === 'queued' ? 'NAS 보관 후 로컬 비우기 대기 중' : result.phase || 'NAS 보관 후 로컬 비우기 중' : job.status === 'done' ? 'NAS 보관 후 로컬 비우기 완료' : 'NAS 보관 후 로컬 비우기 실패'}</strong>
      <span class="small muted">${result.completedFiles || 0} / ${result.totalFiles || 0}개 처리 · 완료 ${result.offloaded || 0}개 · 실패 ${result.failed || 0}개${result.freedBytes ? ` · 확보 ${sizeLabel(result.freedBytes / 1_000_000)}` : ''}</span></div>
    ${active ? `<progress max="100" value="${percent}" aria-label="NAS 보관 후 로컬 비우기 진행률">${percent}%</progress><p class="small muted archive-path">${escapeHtml(result.current || '원격 아카이브를 확인하고 있습니다.')}</p>` : ''}
    ${result.error ? `<p class="form-error" role="alert">${escapeHtml(result.error)}</p>` : ''}
    ${result.errors?.length ? `<details><summary>실패한 파일 ${result.failed}개${result.failed > result.errors.length ? ` 중 ${result.errors.length}개 표시` : ''}</summary><ul>${result.errors.map(error => `<li><span class="archive-path">${escapeHtml(error.path)}</span>: ${escapeHtml(error.message)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function eventFileStatus(file) {
  if (file.status === 'archived') {
    return `${badge('archived', '아카이브 보관')}<div class="file-reason small muted">로컬 원본 없음</div>${file.reviewReason ? `<div class="file-reason small muted">${escapeHtml(file.reviewReason)}</div>` : ''}`;
  }
  const primary = file.reviewReason ? badge('review', escapeHtml(file.reviewReason)) :
    badge(file.confirmed ? 'ready' : 'draft', file.confirmed ? '분류 확정' : file.eventId ? '초안' : '미배정');
  return `${primary}${file.archived ? '<div class="file-reason small muted">아카이브 사본 있음</div>' : ''}`;
}

function eventCardCaption(file, footageDate) {
  const timeText = file.time ? footageDate.format(new Date(file.time)) : '촬영 시각 없음';
  const timeControl = file.status !== 'archived'
    ? `<button type="button" class="card-time-btn numbers" data-action="edit-media-time" data-value="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.name)} 촬영 시각 수정" ${exclusiveActive() ? 'disabled' : ''}>${escapeHtml(timeText)}${!file.timeVerified ? ' · 확인 필요' : ''}</button>`
    : `<span class="small muted numbers card-time-static">${escapeHtml(timeText)}</span>`;
  const primaryBadge = file.status === 'archived' ? badge('archived', '아카이브 보관')
    : file.reviewReason ? badge('review', escapeHtml(file.reviewReason))
      : badge(file.confirmed ? 'ready' : 'draft', file.confirmed ? '분류 확정' : file.eventId ? '초안' : '미배정');
  const notes = [file.status === 'archived' ? '로컬 원본 없음' : '', file.status !== 'archived' && file.archived ? '아카이브 사본 있음' : '', file.analysisError || ''].filter(Boolean);
  return `<strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
    <div class="card-time-row">${timeControl}</div>
    <div class="small muted card-device" title="${escapeHtml(file.device || '장비 확인 필요')}">${escapeHtml(file.device || '장비 확인 필요')}</div>
    <div class="card-info">${primaryBadge}${file.xmp ? `<button type="button" class="xmp-badge" data-action="view-xmp" data-value="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.name)} XMP 정보 보기">XMP</button>` : ''}</div>
    ${notes.map(text => `<p class="small muted card-reason">${escapeHtml(text)}</p>`).join('')}
    ${file.canDownload ? `<div class="file-links card-links"><a class="time-edit-link" href="/api/archive/download?media_id=${encodeURIComponent(file.id)}" target="_blank" rel="noopener">다운로드</a></div>` : ''}`;
}

function eventLifecycleSummary(files) {
  let draft = 0, confirmed = 0, archived = 0, localArchivedCopy = 0;
  for (const file of files) {
    if (file.status === 'archived') archived++;
    else {
      if (file.confirmed) confirmed++;
      else draft++;
      if (file.archived) localArchivedCopy++;
    }
  }
  return { total: files.length, draft, confirmed, archived, localArchivedCopy };
}

function eventLifecycleMarkup(files) {
  const summary = eventLifecycleSummary(files);
  if (!summary.total) return '';
  return `<div class="event-lifecycle" id="event-lifecycle" aria-label="파일 상태 요약 및 필터">
    <div class="event-lifecycle-counts small numbers" role="group" aria-label="분류 상태 필터">
      ${[['all', '전체'], ['draft', '초안'], ['confirmed', '분류 확정'], ['archived', '아카이브 보관']].map(([key, label]) => `<button type="button" class="lifecycle-chip lifecycle-${key}" data-action="event-lifecycle" data-value="${key}" aria-pressed="${view.eventLifecycle === key}">${key !== 'all' ? '<i aria-hidden="true"></i>' : ''}${label} <span>${key === 'all' ? summary.total : summary[key]}</span></button>`).join('')}
      ${summary.localArchivedCopy ? `<span class="lifecycle-note muted">· NAS 사본 보유 ${summary.localArchivedCopy}</span>` : ''}</div>
    <div class="event-lifecycle-bar" aria-hidden="true">${['archived', 'confirmed', 'draft'].map(key => summary[key] ? `<span class="bar-${key}${view.eventLifecycle !== 'all' && view.eventLifecycle !== key ? ' is-dimmed' : ''}" style="flex:${summary[key]}"></span>` : '').join('')}</div></div>`;
}

function mountEventsPage() {
  page.innerHTML = `<main aria-labelledby="page-title" data-page="events">
    <div id="page-active-jobs"></div><div id="page-load-error"></div>
    <div id="events-header"></div><div id="events-offload-slot"></div>
    <div class="event-split">
      <section class="surface event-sidebar" aria-label="이벤트 목록">
        <div class="surface-head event-sidebar-head" id="event-sidebar-head"><h2>이벤트</h2><div id="event-create-slot"></div></div><div class="event-list" id="event-list"></div>
      </section>
      <section class="surface event-content" aria-label="이벤트 파일 목록">
        <div class="surface-head event-heading" id="event-heading">
          <div class="event-heading-main" id="event-heading-main"></div>
          <div class="event-header-actions" id="event-header-actions"></div>
        </div>
        <div class="event-tools">
          <label class="search"><span class="sr-only">이벤트 파일 검색</span>${icon('search')}<input type="search" id="event-search" placeholder="파일명·XMP 검색"></label>
          <select id="event-device" aria-label="촬영 장비 필터"></select>
          <select id="event-date" aria-label="촬영일 필터"></select>
          <div class="event-tools-end"><div class="event-card-select-all" id="event-card-select-all" hidden></div>
            <div class="view-switch view-switch-icon" id="event-view-switch" role="group" aria-label="이벤트 파일 보기 방식">
              <button class="filter icon-only" type="button" data-action="event-view" data-value="table" aria-pressed="${view.eventView === 'table'}" aria-label="표 보기" title="표 보기">${icon('table')}</button>
              <button class="filter icon-only" type="button" data-action="event-view" data-value="cards" aria-pressed="${view.eventView === 'cards'}" aria-label="카드 보기" title="카드 보기">${icon('grid')}</button>
            </div></div>
        </div>
        <div class="table-wrap" id="event-rows"></div>
        <div class="action-bar" id="event-actions" hidden></div>
      </section>
    </div></main>`;
}

function createEventRow(_file, parentTag) {
  if (view.eventView === 'cards') return parseSingleElement(parentTag, '<li class="incoming-card event-card"><div class="card-image"><span class="thumb-slot"></span><span class="card-check-slot"></span></div><div class="card-caption"></div></li>');
  return parseSingleElement(parentTag, '<tr><td data-col="select"></td><td data-col="file"><div class="file-cell"><span class="thumb-slot"></span><div data-col="file-text"></div></div><div data-col="file-links"></div></td><td class="numbers muted" data-col="time"></td><td data-col="status"></td></tr>');
}

function patchEventRow(node, file, footageDate) {
  const card = view.eventView === 'cards';
  setSlotHtml(node.querySelector('.thumb-slot'), fileThumbnail(file, true, card, 'managed'));
  const select = checkbox('event', file.id, `${file.name} 선택`, new Set());
  if (card) {
    setSlotHtml(node.querySelector('.card-check-slot'), `<label class="card-check"><span class="card-check-box">${select}</span></label>`);
    setSlotHtml(node.querySelector('.card-caption'), eventCardCaption(file, footageDate));
    return;
  }
  setSlotHtml(node.querySelector('[data-col="select"]'), checkHit(select));
  setSlotHtml(node.querySelector('[data-col="file-text"]'), `<strong>${escapeHtml(file.name)}</strong><span class="small muted">${escapeHtml(file.device || '장비 확인 필요')}</span>`);
  const links = node.querySelector('[data-col="file-links"]');
  setClass(links, 'file-links', Boolean(file.xmp || file.canDownload));
  setSlotHtml(links, `${file.xmp ? `<button type="button" class="time-edit-link" data-action="view-xmp" data-value="${escapeHtml(file.id)}">XMP 정보</button>` : ''}${file.canDownload ? `<a class="time-edit-link" href="/api/archive/download?media_id=${encodeURIComponent(file.id)}" target="_blank" rel="noopener">다운로드</a>` : ''}`);
  setSlotHtml(node.querySelector('[data-col="time"]'), `${file.time ? footageDate.format(new Date(file.time)) : '—'}
    ${file.timeSource ? `<div class="file-reason small">${escapeHtml(file.timeSource)}${file.timeVerified ? '' : ' · 확인 필요'}</div>` : ''}
    ${file.analysisError ? `<div class="file-reason small">${escapeHtml(file.analysisError)}</div>` : ''}
    ${!file.timeVerified && file.status !== 'archived' ? `<button type="button" class="time-edit-link" data-action="resolve-time" data-value="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.name)} 촬영 시각 지정" ${exclusiveActive() ? 'disabled' : ''}>촬영 시각 지정</button>` : ''}`);
  setSlotHtml(node.querySelector('[data-col="status"]'), eventFileStatus(file));
}

function patchEventRows(event, filtered) {
  const container = page.querySelector('#event-rows');
  const mode = filtered.length ? view.eventView : 'empty';
  const cardSelectAll = page.querySelector('#event-card-select-all');
  cardSelectAll.hidden = mode !== 'cards';
  setSlotHtml(cardSelectAll, mode === 'cards' ? `<label class="toolbar-select-all">${checkbox('event-all', 'all', '표시된 이벤트 파일 모두 선택', new Set())}<span>전체 선택</span></label>` : '');
  if (container.dataset.mode !== mode) {
    container.dataset.mode = mode;
    slotHtmlCache.delete(container);
    container.innerHTML = mode === 'empty' ? '' : mode === 'cards'
      ? '<ul class="incoming-cards event-cards" id="event-cards" aria-label="이벤트 파일 카드 목록"></ul>'
      : '<table aria-label="이벤트별 파일"><thead><tr><th scope="col" data-col="select-all"></th><th scope="col">파일</th><th scope="col">촬영 일시</th><th scope="col">분류 상태</th></tr></thead><tbody></tbody></table>';
  }
  if (mode === 'empty') {
    setSlotHtml(container, hasActiveEventFilters()
      ? emptyState('search', '조건에 맞는 사진·영상이 없습니다.', button('reset-event-filters', '필터 초기화'))
      : emptyState('video', '표시할 사진·영상이 없습니다.', event && !event.parent ? '상단의 기간으로 모으기를 눌러 미배정 파일을 찾을 수 있습니다.' : ''));
    return;
  }
  const selectAll = checkbox('event-all', 'all', '표시된 이벤트 파일 모두 선택', new Set());
  if (mode === 'table') setSlotHtml(container.querySelector('thead th[data-col="select-all"]'), checkHit(selectAll));
  const parent = event?.parent ? eventById(event.parent) : event;
  const footageDate = dateTimeFormatter(parent?.zone || state.timezone);
  const listTag = mode === 'cards' ? 'ul' : 'tbody';
  reconcileKeyedChildren(container.querySelector(listTag), listTag, filtered, file => file.id, createEventRow,
    (node, file) => patchEventRow(node, file, footageDate));
}

function syncEventSelection(event = eventById(view.eventId), filtered = filteredEventFiles(footageForEvent(view.eventId))) {
  const container = page.querySelector('#event-rows');
  if (!container) return;
  for (const row of container.querySelectorAll('[data-item-key]')) {
    const selected = view.eventSelection.has(row.dataset.itemKey);
    setClass(row, 'selected', selected);
    setChecked(row.querySelector('[data-select="event"]'), selected);
  }
  const count = filtered.filter(file => view.eventSelection.has(file.id)).length;
  const all = page.querySelector('[data-select="event-all"]');
  setChecked(all, filtered.length > 0 && count === filtered.length);
  if (all) all.indeterminate = count > 0 && count < filtered.length;
  const confirmable = filtered.filter(file => view.eventSelection.has(file.id) && file.status === 'available' && !file.confirmed).length;
  const confirmButton = event ? button('confirm-event', confirmable ? `선택 ${confirmable}개 분류 확정` : '선택 분류 확정', {
    glyph: 'check', primary: true, disabled: !confirmable,
  }) : '';
  const selected = view.eventSelection.size;
  const offloadable = filtered.filter(file => view.eventSelection.has(file.id) && file.canOffload);
  const offloadLabel = offloadable.length && offloadable.length !== selected ? `NAS 보관 후 로컬 비우기 (${offloadable.length})` : 'NAS 보관 후 로컬 비우기';
  const destinations = eventDestinations(event);
  const bar = page.querySelector('#event-actions');
  bar.hidden = selected === 0;
  setClass(bar, 'has-selection', selected > 0);
  setSlotHtml(bar, `<div class="action-bar-buttons" ${selected ? '' : 'hidden'}>
    <strong>${selected}개 선택</strong>${button('clear-event-selection', '선택 해제')}
    ${destinations.length ? `<select id="move-event-target" aria-label="이동할 이벤트" ${!selected || exclusiveActive() ? 'disabled' : ''}><option value="">이동할 이벤트</option>${destinations.map(item => `<option value="${item.id}">${escapeHtml(eventOptionLabel(item))}</option>`).join('')}</select>${button('move-event', '이동', { disabled: true })}` : ''}
    ${button('edit-media', '장비·촬영 시각 수정', { disabled: !selected })}
    ${button('offload-media', offloadLabel, { glyph: 'trash', danger: true, disabled: !offloadable.length || remoteBusy(), extra: offloadable.length ? '' : 'hidden' })}
    </div><div class="action-bar-buttons action-bar-primary" ${selected ? '' : 'hidden'}>${confirmButton}</div>`);
  updateEventActions();
  syncStickyActionBar();
}

function patchEventsPage() {
  patchPageStatus();
  setSlotHtml(page.querySelector('#events-header'), header('이벤트 분류', '촬영 기간으로 사진과 영상을 모으고, 필요한 파일을 소분류로 배정하세요.', ''));
  setSlotHtml(page.querySelector('#event-create-slot'), button('new-event', '생성', { glyph: 'plus', primary: state.events.length === 0, extra: 'aria-label="이벤트 생성" title="이벤트 생성"' }));
  setSlotHtml(page.querySelector('#events-offload-slot'), offloadStatus());
  setSlotHtml(page.querySelector('#event-list'), `${eventLink('all', '전체 파일', state.managed.length)}${eventLink('unassigned', '미배정', footageForEvent('unassigned').length)}${state.events.filter(item => !item.parent).map(item => {
    const children = childEvents(item.id);
    const total = footageForEvent(item.id).length + children.reduce((sum, child) => sum + footageForEvent(child.id).length, 0);
    return eventLink(item.id, eventLabel(item), total) + children.map(child => eventLink(child.id, eventLabel(child), footageForEvent(child.id).length, true)).join('');
  }).join('')}${state.events.length === 0 ? '<p class="event-list-empty small muted">아직 이벤트가 없습니다. <strong>+ 생성</strong>으로 첫 이벤트를 만들어 보세요.</p>' : ''}`);
  const event = eventById(view.eventId);
  const parent = event?.parent ? eventById(event.parent) : event;
  const files = footageForEvent(view.eventId);
  const filtered = filteredEventFiles(files);
  setSlotHtml(page.querySelector('#event-heading-main'), `<h2>${escapeHtml(event ? eventLabel(event) : view.eventId === 'all' ? '전체 파일' : '미배정 파일')}</h2>
    <div class="event-meta small muted">${parent ? `${parent.start} ~ ${parent.end} · ` : ''}${hasActiveEventFilters() ? `${filtered.length} / ` : ''}${files.length}개 파일</div>${eventLifecycleMarkup(files)}`);
  const headerActions = page.querySelector('#event-header-actions');
  headerActions.hidden = !event;
  if (!event) view.eventMenuOpen = false;
  // Keep menu state out of this cached template so polls preserve menu DOM and focus.
  setSlotHtml(headerActions, event ? `${!event.parent ? button('collect', '기간으로 모으기', { glyph: 'refresh' }) : ''}
    <div class="event-menu" id="event-menu">
      <button type="button" class="button icon event-menu-trigger" id="event-menu-toggle" data-action="toggle-event-menu" aria-haspopup="menu" aria-expanded="false" aria-controls="event-menu-panel" aria-label="${event.parent ? '소분류 작업 더 보기' : '이벤트 작업 더 보기'}" title="더 보기">${icon('more')}</button>
      <div class="event-menu-panel" id="event-menu-panel" role="menu" aria-labelledby="event-menu-toggle" hidden>
        ${!event.parent ? `<button type="button" class="event-menu-item" role="menuitem" data-action="new-child"${exclusiveActive() ? ' disabled' : ''}>${icon('plus')}<span>소분류 추가</span></button>` : ''}
        <button type="button" class="event-menu-item" role="menuitem" data-action="edit-event"${exclusiveActive() ? ' disabled' : ''}>${icon('edit')}<span>${event.parent ? '소분류 수정' : '이벤트 수정'}</span></button>
        <hr class="event-menu-sep" role="separator">
        <button type="button" class="event-menu-item danger" role="menuitem" data-action="delete-event"${exclusiveActive() ? ' disabled' : ''}>${icon('trash')}<span>${event.parent ? '소분류 삭제' : '이벤트 삭제'}</span></button>
      </div>
    </div>` : '');
  const search = page.querySelector('#event-search');
  if (search.value !== view.eventQuery) search.value = view.eventQuery;
  const devices = [...new Set(files.map(file => file.device).filter(Boolean))];
  const device = page.querySelector('#event-device');
  setSlotHtml(device, `<option value="">모든 장비</option><option value="missing">장비 확인 필요</option>${devices.map(name => `<option value="device:${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`);
  if (device.value !== view.eventDevice) device.value = view.eventDevice;
  const dates = [...new Set(files.map(eventDateForFile).filter(Boolean))].sort();
  const date = page.querySelector('#event-date');
  setSlotHtml(date, `<option value="">모든 촬영일</option>${dates.map(day => `<option value="${day}">${day}</option>`).join('')}`);
  if (date.value !== view.eventDate) date.value = view.eventDate;
  for (const control of page.querySelectorAll('#event-view-switch button')) {
    control.setAttribute('aria-pressed', String(control.dataset.value === view.eventView));
  }
  patchEventRows(event, filtered);
  syncEventSelection(event, filtered);
  syncEventMenu();
}

function syncEventMenu() {
  const trigger = page.querySelector('#event-menu-toggle');
  const panel = page.querySelector('#event-menu-panel');
  if (trigger) trigger.setAttribute('aria-expanded', String(view.eventMenuOpen));
  if (panel) panel.hidden = !view.eventMenuOpen;
}

function closeEventMenu({ restoreFocus = false } = {}) {
  view.eventMenuOpen = false;
  syncEventMenu();
  if (restoreFocus) page.querySelector('#event-menu-toggle')?.focus({ preventScroll: true });
}

function sourceFolders(file) {
  const event = eventById(file.eventId);
  const parent = event.parent ? eventById(event.parent) : null;
  return [...(parent ? [parent.folder] : []), event.folder, file.deviceFolder || 'unknown'];
}

function sourceFiles() {
  return state.managed.filter(file => file.status === 'available' && file.confirmed && eventById(file.eventId));
}

function sourceAssetKeys(file) {
  return [`${file.id}:media`, ...(file.xmp ? [`${file.id}:xmp`] : [])];
}

function sourceEntries() {
  const folders = new Map();
  const files = [];
  for (const file of sourceFiles()) {
    const path = sourceFolders(file);
    if (view.sourcePath.some((value, index) => path[index] !== value)) continue;
    const nextFolder = path[view.sourcePath.length];
    if (!nextFolder) {
      files.push(file);
      if (file.xmp) files.push({ id: file.id, name: file.xmp.name, kind: 'xmp', size: null });
      continue;
    }
    if (!folders.has(nextFolder)) folders.set(nextFolder, []);
    folders.get(nextFolder).push(file);
  }
  const folderEntries = Array.from(folders, ([name, members]) => ({ name, members, assets: members.flatMap(sourceAssetKeys) }));
  return [...folderEntries, ...files.map(file => ({ name: file.name, file, assets: [`${file.id}:${file.kind === 'xmp' ? 'xmp' : 'media'}`] }))];
}

function archiveBreadcrumb() {
  const parts = ['로컬 확정 목록', ...view.sourcePath];
  return `<nav class="archive-breadcrumb" aria-label="보낼 항목 경로">${parts.map((part, depth) =>
    `${depth ? '<span class="archive-crumb-sep" aria-hidden="true">/</span>' : ''}${depth === parts.length - 1 ?
      `<span class="archive-crumb-current" aria-current="location">${escapeHtml(part)}</span>` :
      `<button type="button" class="archive-crumb" data-action="source-jump" data-value="${depth}">${escapeHtml(part)}</button>`}`
  ).join('')}</nav>`;
}

const ARCHIVE_PREVIEW_SAMPLE_LIMIT = 4;

// Match transfers.py's logical path, trimming the currently open local prefix.
function buildArchiveUploadPreview(keys = [...view.sourceSelection], source = view.sourcePath, destination = view.archivePath, root = view.archive?.root || '') {
  const byId = new Map(sourceFiles().map(file => [file.id, file]));
  const rootClean = root === '/' ? '' : root.replace(/\/+$/, '');
  const destParts = destination ? destination.split('/').filter(Boolean) : [];
  const seen = new Set(), entries = [];
  let mediaCount = 0, xmpCount = 0, totalSizeMb = 0, invalidCount = 0;
  let hasUnknownSize = false;
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const [id, kind] = key.split(':');
    const file = byId.get(id);
    if (!file || !['media', 'xmp'].includes(kind) || (kind === 'xmp' && !file.xmp)) continue;
    const fileName = kind === 'xmp' ? file.xmp.name : (file.path ? file.path.split('/').at(-1) : file.name);
    const logical = [...sourceFolders(file), fileName];
    if (source.some((segment, index) => logical[index] !== segment)) { invalidCount++; continue; }
    const relativeTarget = [...destParts, ...logical.slice(source.length)].join('/');
    const fullTarget = root ? `${rootClean}/${relativeTarget}` : relativeTarget;
    entries.push({ key, kind, relativeTarget, fullTarget });
    if (kind === 'xmp') xmpCount++;
    else {
      mediaCount++;
      if (typeof file.size === 'number') totalSizeMb += file.size;
      else hasUnknownSize = true;
    }
  }
  entries.sort((a, b) => a.fullTarget.localeCompare(b.fullTarget));
  return { totalCount: entries.length, mediaCount, xmpCount, totalSizeMb, hasUnknownSize, invalidCount,
    samples: entries.slice(0, ARCHIVE_PREVIEW_SAMPLE_LIMIT).map(item => item.fullTarget),
    remainingCount: Math.max(0, entries.length - ARCHIVE_PREVIEW_SAMPLE_LIMIT) };
}

function archivePreviewPanel() {
  if (!view.sourceSelection.size) return '<p class="small muted">보낼 항목 (로컬)에서 파일이나 폴더를 선택하면 원격 아카이브 (NAS)에 생성될 최종 경로와 용량을 미리 확인할 수 있습니다.</p>';
  const preview = buildArchiveUploadPreview();
  const size = preview.mediaCount ? sizeLabel(preview.totalSizeMb) : '—';
  return `<div class="archive-preview-head"><h2>${view.archive ? 'NAS 최종 경로 미리보기' : '원격 아카이브 (NAS)에 연결하면 전송할 수 있습니다.'}</h2>
    <span class="small muted">총 ${preview.totalCount}개 파일${preview.xmpCount ? ` (사진·영상 ${preview.mediaCount} · XMP ${preview.xmpCount})` : ''} · ${size}${preview.xmpCount ? ' (+ XMP)' : ''}${preview.hasUnknownSize ? ' · 일부 용량 확인 필요' : ''}</span></div>
    ${!view.archive ? '<p class="small muted">선택한 기준 상대 경로 · 위의 아카이브 연결을 눌러 연결하세요.</p>' : ''}
    <ul class="archive-preview-paths mono">${preview.samples.map(path => `<li>${escapeHtml(path)}</li>`).join('')}${preview.remainingCount ? `<li class="muted">외 ${preview.remainingCount}개 파일</li>` : ''}</ul>
    ${view.sourcePath.length ? `<p class="small muted">현재 열린 위치(${escapeHtml(view.sourcePath.join(' / '))}) 아래의 상대 구조만 유지됩니다.</p>` : ''}
    ${preview.invalidCount ? `<p class="small form-error">현재 열린 위치에 속하지 않는 ${preview.invalidCount}개 항목은 미리보기에서 제외했습니다.</p>` : ''}
    ${!view.archive && view.settings && !isStorageConfigured(view.settings) ? '<a class="button" href="#settings">스토리지 설정 열기</a>' : ''}`;
}

function archivePage() {
  const entries = sourceEntries();
  const allAssets = entries.flatMap(entry => entry.assets);
  const busy = remoteBusy() || view.uploadStarting;
  return `${header('아카이브 전송', '보낼 항목 (로컬)을 선택하고 원격 아카이브 (NAS) 대상 폴더로 이동한 뒤 업로드를 누르세요. 데스크톱에서는 드래그로도 전송할 수 있습니다.', '')}
    ${uploadStatus()}${remoteIndexStatus()}
    <div class="split">
      <section class="surface browser" aria-labelledby="source-title">
        <div class="surface-head archive-heading"><div><h2 id="source-title">${icon('folder')} 보낼 항목 (로컬)</h2><p class="small muted">분류 확정된 로컬 파일</p></div>
          ${button('upload-archive', view.uploadStarting ? '예약 중…' : '업로드', { glyph: 'upload', primary: true, disabled: busy || !view.archive || view.archiveBusy || !view.sourceSelection.size })}</div>
        <div class="location">
          ${view.sourcePath.length ? smallButton('source-up', '상위 폴더', 'up') : icon('folder')}
          ${archiveBreadcrumb()}
        </div>
        <div class="source-selection"><label>${checkbox('source-all', 'all', '표시된 보낼 항목 (로컬) 모두 선택', new Set(allAssets.length && allAssets.every(key => view.sourceSelection.has(key)) ? ['all'] : []))} 모두 선택</label>
          <span class="small muted" id="source-selection-count" role="status">${view.sourceSelection.size}개 파일 선택</span></div>
        ${entries.length ? `<ul class="tree">${entries.map((entry, index) => {
          const name = escapeHtml(entry.name);
          const selected = entry.assets.every(key => view.sourceSelection.has(key));
          const selection = checkbox('source', String(index), `${entry.name} 업로드 선택`, new Set(selected ? [String(index)] : []));
          const attributes = `draggable="${!busy}" data-source-index="${index}" class="tree-row${selected ? ' source-selected' : ''}"`;
          if (entry.file) return `<li ${attributes}>${checkHit(selection)}
            <span class="tree-file">${icon(entry.file.kind === 'xmp' ? 'file' : entry.file.kind)}${name}</span><span class="meta numbers">${sizeLabel(entry.file.size)}</span>
          </li>`;
          return `<li ${attributes}>${checkHit(selection)}
            <button type="button" class="tree-button" data-action="open-source" data-value="${index}">${icon('folder')}<span>${name}</span>${icon('right')}</button>
            <span class="meta">${entry.members.length}개</span>
          </li>`;
        }).join('')}</ul>` : emptyState('folder', '표시할 파일이 없습니다.', '이벤트 분류에서 분류를 확정하세요.')}
      </section>
      <section class="surface browser archive-destination" aria-labelledby="destination-title" ${view.archive && !view.archiveBusy && !busy ? `data-archive-drop="${escapeHtml(view.archivePath)}"` : ''}>
        <div class="surface-head archive-heading"><div><h2 id="destination-title">${icon('disk')} 원격 아카이브 (NAS)</h2><p class="small muted">${view.archive ? '대상 폴더로 이동한 뒤 보낼 항목의 업로드를 누르거나 여기로 드래그하세요' : 'NAS 원격 폴더 연결'}</p></div>
          <div class="archive-actions">
            ${view.archive ? button('open-remote-index', '원격 인덱싱', { glyph: 'search', disabled: busy || view.archiveBusy }) : ''}
            ${button('connect-archive', view.archiveBusy ? '조회 중…' : view.archiveError ? '다시 연결' : view.archive ? '새로 고침' : '아카이브 연결',
              { glyph: 'refresh', primary: !view.archive, disabled: view.archiveBusy })}
          </div></div>
        ${archiveDestination()}
      </section>
    </div><section id="archive-preview-slot" class="surface archive-preview" aria-label="NAS 최종 경로 미리보기"></section>`;
}

function archiveDestination() {
  const archive = view.archive;
  const path = [archive?.root || '', view.archivePath].filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  return `${archive || view.archivePath ? `<div class="location">
      ${button('archive-up', '상위 폴더', { glyph: 'up', disabled: view.archiveBusy || !view.archivePath })}
      <span class="mono archive-path">${escapeHtml(path)}</span>
    </div>` : ''}
    ${view.archiveError ? `<p class="archive-error form-error" role="alert">${escapeHtml(view.archiveError)}</p>` : ''}
    <div aria-busy="${view.archiveBusy}">
      ${view.archiveBusy ? emptyState('disk', '아카이브를 조회하고 있습니다.') : archive ?
        `<p class="archive-count small muted" role="status">조회 완료 · ${archive.entries.length}개 항목</p>` +
        (archive.entries.length ? `<ul class="tree">${archive.entries.map((entry, index) => {
          const entryPath = [view.archivePath, entry.name].filter(Boolean).join('/');
          return `<li class="tree-row">
          ${entry.kind === 'folder' ? `<button type="button" class="tree-button" data-action="open-archive" data-value="${index}" ${!remoteBusy() && !view.uploadStarting ? `data-archive-drop="${escapeHtml(entryPath)}"` : ''}>${icon('folder')}<span>${escapeHtml(entry.name)}</span>${icon('right')}</button>` :
            `<span class="tree-file">${icon('file')}${escapeHtml(entry.name)}</span><span class="meta numbers">${entry.kind === 'link' ? '심볼릭 링크' : sizeLabel(entry.size === null ? null : entry.size / 1_000_000)}</span>${entry.kind === 'file' ? `<a class="button icon" href="/api/archive/download?path=${encodeURIComponent(entryPath)}" target="_blank" rel="noopener" aria-label="${escapeHtml(entry.name)} 다운로드" title="다운로드">${icon('download')}</a>` : ''}`}
        </li>`;
        }).join('')}</ul>` : emptyState('folder', '빈 폴더입니다.')) :
        emptyState('disk', view.archiveError ? '파일 목록을 불러오지 못했습니다.' : view.settings && !isStorageConfigured(view.settings) ? '스토리지 설정이 필요합니다.' : '원격 아카이브에 연결하세요.',
          view.archiveError ? '다시 연결하거나 설정에서 SSH 연결 정보를 확인하세요.' : view.settings && !isStorageConfigured(view.settings) ? '<a class="button" href="#settings">설정에서 스토리지 연결하기</a>' : '설정에 저장된 SSH 연결 정보와 저장 절대경로를 사용합니다.')}
    </div>`;
}

function uploadStatus() {
  const job = laneJob('remote');
  if (job?.kind !== 'upload') return '';
  const result = job.result || {};
  const active = jobActive(job);
  if (!active) return resultBanner(job, '아카이브 업로드 결과', button('open-job-archives', '아카이브 기록 보기', { extra: `data-value="${job.id}"` }));
  const percent = Math.min(100, Math.round((result.transferredBytes || 0) / (result.totalBytes || 1) * 100));
  return `<section class="surface upload-status" aria-label="아카이브 업로드 상태">
    <div class="upload-summary"><strong role="status">${active ? job.status === 'queued' ? '업로드 대기 중' : result.phase || '업로드 중' : job.status === 'done' ? '업로드 완료' : job.status === 'cancelled' ? '업로드 중지됨' : '업로드 실패'}</strong>
      <span class="small muted">${result.completedFiles || 0} / ${result.totalFiles || 0}개 처리 · 업로드 ${result.uploaded || 0}개 · 건너뜀 ${result.skipped || 0}개 · 실패 ${result.failed || 0}개</span>
      ${active ? button('cancel-archive-upload', result.cancelRequested ? '중지 중…' : '업로드 중지', { disabled: result.cancelRequested, extra: `data-value="${job.id}"` }) : ''}</div>
    ${active ? `<progress max="100" value="${percent}" aria-label="업로드 진행률">${percent}%</progress><p class="small muted archive-path">${escapeHtml(result.current || '서버에 연결하고 있습니다.')} · ${sizeLabel((result.transferredBytes || 0) / 1_000_000)} / ${sizeLabel((result.totalBytes || 0) / 1_000_000)}</p>` : ''}
    ${result.error && job.status !== 'cancelled' ? `<p class="form-error" role="alert">${escapeHtml(result.error)}</p>` : ''}
    ${result.errors?.length ? `<details><summary>실패한 파일 ${result.failed}개${result.failed > result.errors.length ? ` 중 ${result.errors.length}개 표시` : ''}</summary><ul>${result.errors.map(error => `<li><span class="archive-path">${escapeHtml(error.path)}</span>: ${escapeHtml(error.message)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function remoteIndexStatus() {
  const job = laneJob('remote');
  if (job?.kind !== 'remote-index') return '';
  const result = job.result || {};
  const active = jobActive(job);
  if (!active) return resultBanner(job, '원격 인덱싱 결과', job.status === 'done' ? button('open-catalog-tab', '원격 인덱스 보기', { extra: 'data-value="remote"' }) : '');
  const total = result.totalFiles || 0;
  const percent = total ? Math.min(100, Math.round((result.processedFiles || 0) / total * 100)) : 0;
  const scopeLabel = result.scope ? `범위: ${result.scope}` : '전체 아카이브 루트';
  return `<section class="surface upload-status" aria-label="원격 아카이브 인덱싱 상태">
    <div class="upload-summary"><strong role="status">${active ? job.status === 'queued' ? '원격 인덱싱 대기 중' : result.phase || '원격 인덱싱 중' : job.status === 'done' ? '원격 인덱싱 완료' : job.status === 'cancelled' ? '원격 인덱싱 중지됨' : '원격 인덱싱 실패'}</strong>
      <span class="small muted">${escapeHtml(scopeLabel)} · ${result.processedFiles || 0} / ${total}개 처리 · 해시 ${result.hashed || 0}개 · 변경 없음 ${result.unchanged || 0}개${result.missing ? ` · 누락 ${result.missing}개` : ''}${result.failed ? ` · 실패 ${result.failed}개` : ''}</span>
      ${active ? button('cancel-remote-index', result.cancelRequested ? '중지 중…' : '인덱싱 중지', { disabled: result.cancelRequested, extra: `data-value="${job.id}"` }) : ''}</div>
    ${active ? `<progress max="100" value="${percent}" aria-label="원격 인덱싱 진행률">${percent}%</progress><p class="small muted archive-path">${escapeHtml(result.current || '원격 아카이브에 연결하고 있습니다.')}</p>` : ''}
    ${result.error && job.status !== 'cancelled' ? `<p class="form-error" role="alert">${escapeHtml(result.error)}</p>` : ''}
    ${result.errors?.length ? `<details><summary>실패한 파일 ${result.failed}개${result.failed > result.errors.length ? ` 중 ${result.errors.length}개 표시` : ''}</summary><ul>${result.errors.map(error => `<li><span class="archive-path">${escapeHtml(error.path)}</span>: ${escapeHtml(error.message)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function openRemoteIndexDialog() {
  if (!view.archive || remoteBusy()) return;
  const currentScope = view.archivePath || '';
  showDialog('원격 아카이브 인덱싱', `<p>원격 스토리지의 사진·영상·XMP 파일을 증분 스캔해 아카이브 DB(<code>remote_files</code>)에 등록합니다. 이미 기록된 파일 중 크기와 수정 시각이 같은 파일은 재해시를 건너뜁니다.</p>
    <p class="small muted">인덱싱된 원격 파일은 Incoming 수집 및 업로드 시 전역 중복 차단에 반영되며, 파일 기록의 <strong>원격 인덱스</strong> 탭에서 검색·다운로드할 수 있습니다.</p>
    <label>스캔 범위<select name="scope">
      <option value="">전체 아카이브 루트 (${escapeHtml(view.archive.root)})</option>
      ${currentScope ? `<option value="${escapeHtml(currentScope)}">현재 폴더만 (${escapeHtml(currentScope)})</option>` : ''}
    </select></label>
    <label class="checkbox-row"><input type="checkbox" name="full_rehash" value="1"><span>크기·수정 시각이 같은 파일도 전체 해시 다시 검증</span></label>
    <label class="checkbox-row"><input type="checkbox" name="generate_thumbnails" value="1" ${view.remoteIndexGenerateThumbnails ? 'checked' : ''}><span>인덱싱 시 누락된 사진·영상 썸네일도 함께 생성</span></label>
    <p class="small muted">기존 캐시는 재사용합니다. 원격 영상은 NAS ffmpeg를 우선 사용하고, 미설치 시 150 MiB 이하만 내려받습니다.</p>`,
  '인덱싱 시작', async form => {
    const scope = String(form.get('scope') || '');
    const fullRehash = form.get('full_rehash') === '1';
    view.remoteIndexGenerateThumbnails = form.get('generate_thumbnails') === '1';
    storePreference('photo-saver-remote-index-thumbs', view.remoteIndexGenerateThumbnails ? '1' : '0');
    const result = await api('archive/index', 'POST', {
      connection: view.archive.connectionVersion, path: scope, full_rehash: fullRehash,
      generate_thumbnails: view.remoteIndexGenerateThumbnails,
    });
    setOptimisticJob({ id: result.id, kind: 'remote-index', status: 'queued', result: { scope } });
    await syncState();
    announce('원격 아카이브 인덱싱을 시작합니다.');
  });
  dialog.querySelector('[name="generate_thumbnails"]')?.addEventListener('change', event => {
    view.remoteIndexGenerateThumbnails = event.target.checked;
    storePreference('photo-saver-remote-index-thumbs', event.target.checked ? '1' : '0');
  });
}

function confirmDuplicateUpload(keys, source, destination, data) {
  const duplicates = data.duplicates || [];
  const duplicateIds = new Set(data.duplicateIds || duplicates.map(item => item.id));
  const filteredKeys = keys.filter(key => !duplicateIds.has(key.split(':')[0]));
  const list = `<ul class="preview-paths mono">${duplicates.map(item =>
    `<li>${escapeHtml(item.name)} → ${escapeHtml(item.target)}<br><span class="small muted">기존: ${escapeHtml((item.existingPaths || []).join(', '))}</span></li>`
  ).join('')}</ul>`;
  const note = filteredKeys.length
    ? `<p>중복 파일 ${duplicates.length}개를 제외하고 신규 ${filteredKeys.length}개만 업로드하거나, 별도 사본으로 모두 업로드할 수 있습니다.</p>`
    : '<p>선택한 파일이 모두 원격 아카이브의 다른 경로에 이미 보관되어 있습니다. 정말 별도 사본을 만들려면 아래에서 진행하세요.</p>';
  showDialog(
    '원격 중복 파일 감지',
    `<p>${escapeHtml(data.detail || '원격 아카이브의 다른 경로에 동일한 파일이 있습니다.')}</p>${note}${list}`,
    filteredKeys.length ? `중복 제외하고 신규 ${filteredKeys.length}개만 업로드` : '별도 사본으로 모두 업로드',
    async () => {
      if (filteredKeys.length) {
        await startArchiveUpload(filteredKeys, source, destination, false);
      } else {
        await startArchiveUpload(keys, source, destination, true);
      }
    },
    { danger: !filteredKeys.length },
  );
  if (filteredKeys.length) {
    const actionsRow = dialog.querySelector('.dialog-actions');
    const forceButton = document.createElement('button');
    forceButton.type = 'button';
    forceButton.className = 'button danger';
    forceButton.textContent = '별도 사본으로 모두 업로드';
    forceButton.addEventListener('click', async () => {
      forceButton.disabled = true;
      const errorMessage = dialog.querySelector('#dialog-error');
      errorMessage.hidden = true;
      try {
        await startArchiveUpload(keys, source, destination, true);
        dialog.close();
        render();
      } catch (error) {
        errorMessage.hidden = false;
        errorMessage.textContent = error.message;
        forceButton.disabled = false;
      }
    });
    actionsRow.insertBefore(forceButton, actionsRow.querySelector('[type="submit"]'));
  }
}

async function startArchiveUpload(keys = [...view.sourceSelection], source = [...view.sourcePath], destination = view.archivePath, allowDuplicates = false) {
  if (remoteBusy() || view.uploadStarting || view.archiveBusy || !view.archive || !keys.length) return;
  if (keys.length > 10000) throw new Error('한 번에 최대 10,000개 파일을 업로드할 수 있습니다. 나누어 선택하세요.');
  view.uploadStarting = true;
  render();
  let duplicateData = null;
  try {
    const items = keys.map(key => { const [id, kind] = key.split(':'); return { id, kind }; });
    const result = await api('archive/transfers', 'POST', {
      items, source, destination, connection: view.archive.connectionVersion, allow_duplicates: allowDuplicates,
    });
    setOptimisticJob({ id: result.id, kind: 'upload', status: 'queued', result: { totalFiles: result.count } });
    await syncState();
    announce(`${result.count}개 파일의 업로드를 시작합니다.`);
  } catch (error) {
    if (!allowDuplicates && error.data?.code === 'remote_duplicate') {
      duplicateData = error.data;
    } else {
      throw error;
    }
  } finally {
    view.uploadStarting = false;
  }
  if (duplicateData) {
    render();
    confirmDuplicateUpload(keys, source, destination, duplicateData);
  }
}

async function browseArchive(path = view.archivePath) {
  if (view.archiveBusy) return;
  const version = archiveConnectionVersion;
  view.archiveBusy = true;
  view.archiveError = '';
  view.archivePath = path;
  render();
  try {
    const archive = await api(`archive?path=${encodeURIComponent(path)}`);
    if (version !== archiveConnectionVersion) return;
    view.archive = archive;
    view.archivePath = view.archive.path;
  } catch (error) {
    if (version !== archiveConnectionVersion) return;
    view.archive = null;
    view.archiveError = error.message;
  } finally {
    if (version === archiveConnectionVersion) view.archiveBusy = false;
  }
}

function isStorageConfigured(settings) {
  return Boolean(settings?.addressConfigured && settings?.storageRootConfigured && settings?.accountConfigured && settings?.keyGenerated && settings?.hostKeyTrusted);
}

function resetArchiveConnection() {
  ++archiveConnectionVersion;
  view.archive = null;
  view.archivePath = '';
  view.archiveError = '';
  view.archiveBusy = false;
  view.archiveAutoAttempted = false;
  view.archiveAutoConnecting = false;
}

async function maybeAutoConnectArchive() {
  if (view.archive || view.archiveBusy || view.archiveAutoConnecting || view.archiveAutoAttempted || exclusiveActive()) return;
  view.archiveAutoAttempted = true;
  view.archiveAutoConnecting = true;
  const version = archiveConnectionVersion;
  try {
    const settings = view.settings || await api('settings');
    if (version !== archiveConnectionVersion) return;
    view.settings = settings;
    if (!isStorageConfigured(settings)) {
      if (view.page === 'archive') render();
      return;
    }
    if (view.page === 'archive' && !view.archive && !view.archiveBusy && !exclusiveActive()) {
      await browseArchive(view.archivePath || '');
      if (view.page === 'archive') render();
    }
  } catch {
    // Settings discovery is optional; manual connection remains available.
  } finally {
    if (version === archiveConnectionVersion) view.archiveAutoConnecting = false;
  }
}

function catalogTime(value, timeZone = state.timezone) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  try { return dateTimeFormatter(timeZone || state.timezone).format(date); }
  catch { return dateTimeFormatter(state.timezone).format(date); }
}

function normalizeRootPath(value) {
  return String(value || '').replace(/\/+$/, '') || (value?.startsWith('/') ? '/' : '');
}

function formatRelativePath(fullPath, displayName = '') {
  if (!fullPath) return '';
  const path = String(fullPath || '');
  const slash = path.lastIndexOf('/');
  if (path.slice(slash + 1) !== displayName) return path;
  const dir = path.slice(0, Math.max(0, slash));
  return dir ? `${dir}/` : '루트 직속';
}

function catalogEventLabel(folder) {
  return folder.folder || (!folder.parent_id && folder.start ? eventLabel(folder) : folder.name || '');
}

function shortHash(sha) {
  if (!sha) return '해시 미기록';
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha;
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) throw new Error('복사할 내용이 없습니다.');
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // HTTP LAN or denied clipboard access: try the browser's copy command.
    }
  }
  if (typeof document.execCommand === 'function') {
    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.setAttribute('style', 'position:fixed;top:0;left:-9999px;opacity:0');
    document.body.appendChild(textarea);
    try {
      if (typeof textarea.focus === 'function') textarea.focus();
      if (typeof textarea.select === 'function') textarea.select();
      if (typeof textarea.setSelectionRange === 'function') textarea.setSelectionRange(0, value.length);
      if (document.execCommand('copy')) return;
    } finally {
      textarea.remove();
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
    }
  }
  throw new Error('클립보드에 복사할 수 없습니다. 브라우저의 클립보드 권한 또는 연결 환경을 확인하세요.');
}

function catalogFolderLabel() {
  if (view.catalogTab === 'remote') {
    if (!view.catalogRemoteFolder) return '전체 원격 파일';
    if (view.catalogRemoteFolder === '__root__') return '아카이브 루트 직속 파일';
    return view.catalogRemoteFolder;
  }
  const id = view.catalogEvent;
  if (id === 'all') return '전체 파일';
  if (id === 'unassigned') return '미배정';
  const folder = view.catalog?.folders?.find(item => item.id === id);
  if (!folder) return '이벤트 정보 없음';
  const parent = view.catalog.folders.find(item => item.id === folder.parent_id);
  return [parent && catalogEventLabel(parent), catalogEventLabel(folder), view.catalogDevice].filter(Boolean).join(' / ');
}

function catalogFolderButton({ action, value, label, count, selected, glyph = 'folder', nodeKind = '' }) {
  return `<button type="button" class="catalog-folder${selected ? ' active' : ''}" data-action="${action}" data-value="${escapeHtml(value)}" data-node-kind="${nodeKind}"
    ${selected ? 'aria-current="location"' : ''} title="${escapeHtml(label)}">${icon(glyph)}<span class="catalog-folder-label">${escapeHtml(label)}</span><span class="catalog-folder-count">${count}</span></button>`;
}

function catalogFolderRow({ depth = 0, expandable = false, expanded = false, toggleAction = '', toggleValue = '', label = '', buttonHtml }) {
  const lead = expandable
    ? `<button type="button" class="catalog-folder-toggle" data-action="${toggleAction}" data-value="${escapeHtml(toggleValue)}" aria-expanded="${expanded}" aria-label="${escapeHtml(label)} 하위 폴더 ${expanded ? '접기' : '펼치기'}">${icon('right')}</button>`
    : '<span class="catalog-folder-spacer" aria-hidden="true"></span>';
  return `<div class="catalog-folder-row" style="--folder-depth:${depth}">${lead}${buttonHtml}</div>`;
}

function remoteFolderTree() {
  const data = view.catalog;
  const folders = data?.remoteFolders || [];
  const folderButton = (folderPath, label, count, nodeKind = 'all') => catalogFolderButton({
    action: 'catalog-remote-folder',
    value: folderPath,
    label,
    count,
    nodeKind,
    selected: view.catalogRemoteFolder === folderPath,
  });
  const branch = (folder, depth = 0) => {
    const children = folder.children || [];
    const expandable = children.length > 0;
    const expanded = expandable && view.catalogRemoteExpanded.has(folder.path);
    return `<li>${catalogFolderRow({
      depth,
      expandable,
      expanded,
      toggleAction: 'toggle-remote-folder',
      toggleValue: folder.path,
      label: folder.name,
      buttonHtml: folderButton(folder.path, folder.name, folder.count, depth ? 'sub' : 'event'),
    })}
      ${expanded ? `<ul>${children.map(child => branch(child, depth + 1)).join('')}</ul>` : ''}
    </li>`;
  };
  const rootFilesItem = data?.remoteRootCount
    ? `<li>${catalogFolderRow({ depth: 0, buttonHtml: folderButton('__root__', '루트 직속 파일', data.remoteRootCount, 'root-files') })}</li>`
    : '';
  return `<nav class="catalog-folders" aria-label="원격 아카이브 폴더"><div class="catalog-folders-heading"><h2>원격 폴더</h2><p class="small muted">아카이브 경로 기준</p></div>
    <div class="catalog-folder-list">${folderButton('', '전체 원격 파일', data?.summary.remoteTotal || 0)}
      ${rootFilesItem || folders.length ? `<ul>${rootFilesItem}${folders.map(folder => branch(folder, 0)).join('')}</ul>` : ''}
      ${!folders.length && !data?.remoteRootCount ? '<p class="small muted catalog-folders-empty">인덱싱된 원격 파일이 없습니다.</p>' : ''}
    </div></nav>`;
}

function catalogFolderTree() {
  if (view.catalogTab === 'remote') return remoteFolderTree();
  const data = view.catalog;
  const folders = data?.folders || [];
  const folderButton = (event, device, label, count, nodeKind = 'all') => catalogFolderButton({
    action: 'catalog-folder',
    value: JSON.stringify({ event, device }),
    label,
    count,
    nodeKind,
    glyph: ({ unassigned: 'inbox', event: 'calendar', device: 'aperture' })[nodeKind] || 'folder',
    selected: view.catalogEvent === event && view.catalogDevice === device,
  });
  const branch = (folder, depth = 0) => {
    const children = folders.filter(item => item.parent_id === folder.id);
    const devices = folder.devices || [];
    const count = folder.count + children.reduce((sum, item) => sum + item.count, 0);
    const expandable = children.length > 0 || devices.length > 0;
    const expanded = expandable && view.catalogExpanded.has(folder.id);
    return `<li>${catalogFolderRow({
      depth,
      expandable,
      expanded,
      toggleAction: 'toggle-catalog-folder',
      toggleValue: folder.id,
      label: catalogEventLabel(folder),
      buttonHtml: folderButton(folder.id, '', catalogEventLabel(folder), count, folder.parent_id ? 'sub' : 'event'),
    })}
      ${expanded ? `<ul>${children.map(child => branch(child, depth + 1)).join('')}${devices.map(device => `<li>${catalogFolderRow({
        depth: depth + 1,
        buttonHtml: folderButton(folder.id, device.name, device.name, device.count, 'device'),
      })}</li>`).join('')}</ul>` : ''}
    </li>`;
  };
  const count = view.catalogTab === 'archives' ? data?.archiveSelection?.total : data?.summary.files;
  const unassignedItem = `<li>${catalogFolderRow({ depth: 0, buttonHtml: folderButton('unassigned', '', '미배정', data?.unassigned || 0, 'unassigned') })}</li>`;
  return `<nav class="catalog-folders" aria-label="이벤트 폴더"><div class="catalog-folders-heading"><h2>이벤트</h2><p class="small muted">이벤트 · 소분류 · 장비</p></div>
    <div class="catalog-folder-list">${folderButton('all', '', '전체 파일', count || 0)}
      <ul>${unassignedItem}${folders.filter(folder => !folder.parent_id).map(folder => branch(folder, 0)).join('')}</ul>
      ${!folders.length ? '<p class="small muted catalog-folders-empty">등록된 이벤트가 없습니다.</p>' : ''}
    </div></nav>`;
}

function catalogRemoteLinkLabel(row) {
  if (!row.in_catalog) return '<div class="muted">원격 전용</div>';
  const events = Array.isArray(row.catalog_events) ? row.catalog_events : (row.catalog_event_name ? [row.catalog_event_name] : []);
  if (events.length === 1 && !row.catalog_has_unassigned) return `<div>${escapeHtml(events[0])}</div>`;
  if (events.length === 1) return `<div title="${escapeHtml(events[0])} · 미배정 포함">${escapeHtml(events[0])} <span class="small muted">외 미배정</span></div>`;
  if (events.length > 1) return `<div title="${escapeHtml(events.join(', '))}${row.catalog_has_unassigned ? ' · 미배정 포함' : ''}">${escapeHtml(events[0])} <span class="small muted">외 ${events.length - 1}개${row.catalog_has_unassigned ? ' · 미배정' : ''}</span></div>`;
  return row.catalog_has_unassigned ? '<div>카탈로그 연동 <span class="small muted">· 미배정</span></div>' : '<div>카탈로그 연동됨</div>';
}

function catalogRowKey(row, index) {
  return row.record_key || `${view.catalogTab}:${row.file_id || row.remote_path || row.local_path || row.name || index}:${index}`;
}

function catalogRootException(row) {
  const rowRootNorm = normalizeRootPath(row.archive_root);
  const activeRootNorm = normalizeRootPath(view.catalog?.activeArchiveRoot);
  if (rowRootNorm && activeRootNorm) return rowRootNorm === activeRootNorm ? '' : `<div class="small catalog-path mono catalog-root-mismatch">다른 루트: ${escapeHtml(row.archive_root)}</div>`;
  if (rowRootNorm) return `<div class="small muted catalog-path mono">루트: ${escapeHtml(row.archive_root)}</div>`;
  return view.catalogTab === 'archives' ? '<div class="small muted catalog-path">아카이브 루트 미기록</div>' : '';
}

function recordBrowserVisible() { return view.page === 'catalog' || (view.page === 'jobs' && view.jobsTab === 'archives'); }
function jobsTabs() {
  return `<div class="catalog-tabs" role="tablist" aria-label="작업 내역 종류">${[['list','작업 목록'],['archives','아카이브 기록']].map(([key,label]) => `<button type="button" role="tab" id="jobs-tab-${key}" class="catalog-tab" data-action="jobs-tab" data-value="${key}" aria-selected="${view.jobsTab === key}" aria-controls="jobs-panel" tabindex="${view.jobsTab === key ? 0 : -1}">${label}</button>`).join('')}</div>`;
}
function openArchiveHistory(id = null) {
  closeMediaPreview({ restoreFocus: false });
  cancelCatalogSearchDebounce(); ++catalogRequest; ++jobsRequest;
  view.jobs.busy = false; view.jobs.loadingMore = false;
  view.jobsTab = 'archives'; view.catalogTab = 'archives'; view.catalogJobId = id ? Number(id) : null;
  view.catalogScope = 'all'; view.catalogUploadResult = 'all'; view.catalogQuery = '';
  view.catalogEvent = 'all'; view.catalogDevice = ''; view.catalogPage = 1;
  view.catalog = null; view.catalogExpandedRows.clear();
  if (location.hash === '#jobs') { render(); return loadCatalog(); }
  location.hash = 'jobs';
}
function latestUploadLabel(attempt) {
  if (!attempt) return '전송 이력 없음';
  return '최근 업로드 · ' + (({uploaded:'성공',skipped:'동일 파일 확인',failed:'전송 실패',pending:'대기·진행 중',legacy_verified:'과거 전송 완료'})[attempt.outcome] || '결과 미기록');
}
function catalogFileStatus(row) {
  let label, tone = 'draft', note = '';
  const activeRoot = view.catalog?.activeArchiveRoot;
  const confirmed = row.confirmed ? '분류 확정' : '분류 미확정';
  if (row.location === 'incoming') {
    label = ({ ready: 'Incoming 대기', duplicate: 'Incoming 중복', review: 'Incoming 검토', moving: 'Incoming 이동 중', moved: 'Incoming 이동됨', deleting: 'Incoming 삭제 중', deleted: 'Incoming 삭제됨' })[row.status] || row.status;
    tone = ({ duplicate: 'duplicate', review: 'review' })[row.status] || 'draft';
    if (row.has_archive) note = row.can_download ? 'NAS 동일 파일 있음' : '과거 검증 또는 다른 루트 사본';
  } else if (row.status === 'archived') {
    label = row.can_download ? 'NAS 보관' : '로컬 비움 / NAS 보관 이력'; tone = 'archived';
    note = row.can_download ? '로컬 비움 완료' : '현재 NAS 사본 미확인';
  } else if (row.status === 'available') {
    label = row.can_download ? '로컬 + NAS' : row.has_archive ? '로컬 + 이력' : '로컬만';
    tone = row.can_download || row.has_archive ? 'ready' : 'local';
    note = confirmed + (!row.can_download && row.has_archive ? ` · ${activeRoot ? '다른 루트 또는 과거 이력' : '검증 이력 있음'}` : '');
  } else if (row.status === 'missing') {
    label = '로컬 누락'; tone = 'review';
    note = row.can_download ? 'NAS 사본 있음' : row.has_archive ? '과거 아카이브 이력 있음' : '로컬 원본 없음';
  } else label = row.status === 'offloading' ? '로컬 비우기 중' : row.status;
  return `<span class="status ${tone}">${escapeHtml(label)}</span>${note ? `<div class="small muted">${escapeHtml(note)}</div>` : ''}<div class="small ${row.latest_archive?.outcome === 'failed' ? 'form-error' : ['uploaded','skipped'].includes(row.latest_archive?.outcome) ? 'catalog-upload-success' : 'muted'}">${escapeHtml(latestUploadLabel(row.latest_archive))}</div>`;
}

function catalogRowDetail(row, index) {
  const entry = (label, value, { wide = false, html = false } = {}) => `<div${wide ? ' class="catalog-detail-wide"' : ''}><dt>${label}</dt><dd>${html ? value : escapeHtml(value ?? '—')}</dd></div>`;
  const time = value => catalogTime(value);
  let details = entry('SHA-256', row.sha
    ? `<code class="catalog-hash-full mono">${escapeHtml(row.sha)}</code> ${button('copy-record-hash', '복사', { glyph: 'copy', extra: `data-value="${escapeHtml(row.sha)}" aria-label="${escapeHtml(row.name)} SHA-256 복사"` })}`
    : '<code class="mono muted">해시 미기록</code>', { wide: true, html: true });
  if (view.catalogTab === 'files') {
    if (row.latest_archive) {
      const a = row.latest_archive;
      details += entry('최근 업로드 작업', button('open-job-archives', `작업 #${a.job_id}`, {extra: `data-value="${a.job_id}"`}), {html:true});
      details += entry('최근 업로드 결과', latestUploadLabel(a));
      details += entry('아카이브 루트', a.archive_root); details += entry('목적지 상대 경로', a.target);
      details += entry('기록 시각', time(a.recorded_at));
      details += entry(a.outcome === 'legacy_verified' ? '과거 작업 완료 시각' : '검증 시각', time(a.verified_at));
      if (a.job_status === 'cancelled' && a.outcome === 'unknown') details += entry('작업 상태', '중지됨 · 파일 결과 미기록');
      if (row.has_verified_history && a.outcome === 'failed') details += entry('이전 이력', '이전 검증 완료 이력 있음');
      if (a.error) details += entry('오류 상세', a.error, {wide:true});
    }
    details += entry('파일 ID', row.file_id);
    details += entry('내부 경로', `${row.location === 'incoming' ? 'incoming' : 'managed'}/${row.local_path || ''}`);
    if (row.original_path) details += entry('원래 Incoming 경로', `incoming/${row.original_path}`);
    if (row.download_path) details += entry('NAS 영구 경로', row.download_path);
    if (view.catalog?.activeArchiveRoot && row.download_path) details += entry('활성 NAS 루트', view.catalog.activeArchiveRoot);
    if (row.captured_at) details += entry('촬영 일시', `${catalogTime(row.captured_at, row.event_zone)}${row.event_zone ? ` (${row.event_zone})` : ''}`);
  } else if (view.catalogTab === 'archives') {
    details += entry('파일 ID', row.file_id);
    details += entry('작업 정보', `작업 #${row.job_id} · ${row.kind === 'xmp' ? 'XMP' : '원본'}`);
    details += entry('내부 로컬 경로', row.local_path ? `managed/${row.local_path}` : '미기록');
    if (row.original_path) details += entry('원래 Incoming 경로', `incoming/${row.original_path}`);
    details += entry('아카이브 루트', row.archive_root || '미기록');
    details += entry('목적지 상대 경로', row.target || '미기록');
    details += entry('기록 시각', time(row.recorded_at));
    details += entry(row.outcome === 'legacy_verified' ? '과거 작업 완료 시각' : '검증 시각', time(row.verified_at));
    if (row.job_status === 'cancelled' && row.outcome === 'unknown') details += entry('작업 상태', '중지됨 · 파일 결과 미기록');
    if (row.error) details += entry('오류 상세', row.error, { wide: true });
  } else {
    details += entry('원격 전체 경로', row.remote_path);
    details += entry('아카이브 루트', row.archive_root || '미기록');
    details += entry('스토리지 ID', row.storage_id);
    details += entry('확인 시각', `최초 ${time(row.first_seen_at)} · 검증 ${time(row.verified_at)} · 최근 ${time(row.last_seen_at)}`);
    if (row.in_catalog) {
      const events = Array.isArray(row.catalog_events) ? row.catalog_events : (row.catalog_event_name ? [row.catalog_event_name] : []);
      details += entry('연동 이벤트', [events.join(', '), row.catalog_has_unassigned ? '미배정 포함' : '', (row.catalog_file_ids || []).join(', ')].filter(Boolean).join(' · ') || '카탈로그 연동됨', { wide: true });
    }
  }
  return `<tr class="catalog-detail-row" id="catalog-detail-${index}"><td colspan="3" class="catalog-cell-detail"><dl class="catalog-detail-grid">${details}</dl></td></tr>`;
}

function catalogThumbnailStatus(row) {
  return view.thumbnailGeneratingShas.has(row.sha) && row.thumbnail_status !== 'ready' ? 'generating' : row.thumbnail_status || 'unavailable';
}

function catalogThumbSlot(row, index, card = false) {
  const kind = row.media_kind || row.kind;
  const status = kind === 'xmp' ? 'non_media' : catalogThumbnailStatus(row);
  const labels = { missing: '썸네일 미생성', generating: '생성 중', unavailable: '생성 불가', failed: '생성 실패', skipped_large: '대용량 건너뜀', non_media: 'XMP' };
  const content = status === 'ready' ? `<img src="${escapeHtml(row.thumbnail)}" alt="" loading="lazy" decoding="async">${kind === 'video' ? '<span class="catalog-video-badge" aria-label="영상">▶</span>' : ''}`
    : `<span class="catalog-thumb-placeholder${status === 'generating' ? ' is-generating' : ''}">${icon(kind === 'xmp' ? 'file' : kind === 'video' ? 'video' : 'photo')}<span class="${card || kind === 'xmp' ? 'small' : 'sr-only'}">${labels[status]}</span></span>`;
  const attrs = `class="catalog-thumb ${card ? 'catalog-card-media' : 'thumb'} is-${status}" title="${escapeHtml(row.thumbnail_error || labels[status] || row.name)}"`;
  if (kind === 'xmp' || status === 'unavailable') return `<div ${attrs}>${content}</div>`;
  if (status === 'generating') return `<button type="button" ${attrs} disabled aria-busy="true" aria-label="${escapeHtml(row.name)} 썸네일 생성 중">${content}</button>`;
  if (status === 'missing' && row.can_generate_thumbnail) {
    if (card) return `<div ${attrs}>${content}${button('generate-catalog-thumb', '썸네일 생성', { extra: `data-value="${escapeHtml(row.sha)}"`, disabled: exclusiveActive() })}</div>`;
    return `<button type="button" ${attrs} data-action="generate-catalog-thumb" data-value="${escapeHtml(row.sha)}" aria-label="${escapeHtml(row.name)} 썸네일 생성" ${exclusiveActive() ? 'disabled' : ''}>${content}</button>`;
  }
  return `<button type="button" ${attrs} data-action="preview-catalog" data-value="${escapeHtml(catalogRowKey(row, index))}" aria-label="${escapeHtml(row.name)} 미리보기">${content}</button>`;
}

function catalogGenerateButton(row) {
  if (!row.can_generate_thumbnail || !['missing', 'failed', 'skipped_large'].includes(catalogThumbnailStatus(row))) return '';
  return button('generate-catalog-thumb', ['failed', 'skipped_large'].includes(row.thumbnail_status) ? '다시 시도' : '썸네일 생성', { extra: `data-value="${escapeHtml(row.sha)}"`, disabled: exclusiveActive() });
}

function catalogThumbnailAlert() {
  const job = lanes.map(activeLaneJob).find(job => job?.kind.startsWith('thumbnails-'));
  if (job) return `<div class="catalog-thumb-alert" role="status"><span>${escapeHtml(job.result?.phase || '썸네일 생성 대기 중')}</span>${button('cancel-thumbnail-job', '생성 중지', { extra: `data-value="${job.id}"`, disabled: job.result?.cancelRequested })}</div>`;
  const missing = view.catalog?.missingThumbnails;
  return missing?.total > 0 ? `<div class="catalog-thumb-alert" role="status"><span class="small">썸네일 미생성 <strong>${missing.total}개</strong> (사진 ${missing.photos} · 영상 ${missing.videos})</span>${button('open-thumbnail-batch', '누락 썸네일 생성', { extra: 'data-value="folder"' })}</div>` : '';
}

function catalogCardItem(row, index) {
  const key = catalogRowKey(row, index);
  const name = (row.media_kind || row.kind) === 'xmp' ? `<strong>${escapeHtml(row.name)}</strong>` : `<button type="button" class="catalog-file-preview" data-action="preview-catalog" data-value="${escapeHtml(key)}"><strong>${escapeHtml(row.name)}</strong></button>`;
  const path = row.remote_path || row.target || row.download_path;
  const status = view.catalogTab === 'remote' ? `<span class="status ${row.status === 'present' ? 'archived' : 'review'}">${row.status === 'present' ? 'NAS 보관' : 'NAS 누락'}</span>`
    : view.catalogTab === 'archives' ? `<span class="status ${row.outcome === 'failed' ? 'review' : 'draft'}">${escapeHtml(({ uploaded: '업로드 검증', skipped: '동일 파일 확인', legacy_verified: '과거 전송 완료', failed: '전송 실패', pending: '진행 대기', unknown: '결과 미기록' })[row.outcome] || '결과 미기록')}</span>` : catalogFileStatus(row);
  return `<article class="catalog-card">${catalogThumbSlot(row, index, true)}<div class="catalog-card-body">${name}${status}<p class="small muted">${escapeHtml(row.event_name || row.catalog_event_name || '미배정')} · ${sizeLabel(row.size == null ? null : row.size / 1e6)}</p><p class="small muted catalog-path">${escapeHtml(path || row.local_path || '')}</p>${row.thumbnail_error ? `<p class="small form-error">${escapeHtml(row.thumbnail_error)}</p>` : ''}</div><div class="catalog-row-actions">${row.can_download ? `<a class="button" href="/api/archive/download?path=${encodeURIComponent(path)}" target="_blank" rel="noopener">NAS 다운로드</a>` : ''}${catalogGenerateButton(row)}${button('open-catalog-detail-dialog', '상세', { extra: `data-value="${escapeHtml(key)}"` })}</div></article>`;
}

function openCatalogDetailDialog(key) {
  const index = view.catalog?.rows.findIndex((row, i) => catalogRowKey(row, i) === key) ?? -1;
  const row = index >= 0 ? view.catalog.rows[index] : view.preview?.detachedCatalogFile?.id === key ? view.preview.detachedCatalogFile : null;
  if (!row) return;
  const details = catalogRowDetail(row, Math.max(0, index)).match(/<dl[\s\S]*<\/dl>/)?.[0] || '';
  showDialog(escapeHtml(row.name), details, null, null, { scrollBody: true });
}

function catalogTableRow(row, index, labels) {
  const archives = view.catalogTab === 'archives', remote = view.catalogTab === 'remote';
  const rowKey = catalogRowKey(row, index), expanded = view.catalogExpandedRows.has(rowKey);
  const size = sizeLabel(row.size == null ? null : row.size / 1_000_000);
  const kind = row.kind === 'xmp' ? 'XMP' : row.kind === 'video' ? '영상' : '사진';
  const path = (value, prefix = '') => `<div class="small muted catalog-path mono" title="${escapeHtml(value)}">${prefix}${escapeHtml(formatRelativePath(value, row.name))}</div>`;
  let file = `${(row.media_kind || row.kind) !== 'xmp' ? `<button type="button" class="catalog-file-preview" data-action="preview-catalog" data-value="${escapeHtml(rowKey)}"><strong>${escapeHtml(row.name)}</strong></button>` : `<strong>${escapeHtml(row.name)}</strong>`}${row.kind === 'xmp' ? ' <span class="catalog-kind-tag">XMP</span>' : ''}`;
  if (remote) file += path(row.remote_path) + catalogRootException(row);
  else if (archives) file += (row.target ? path(row.target) : '<div class="small muted catalog-path">목적지 미기록</div>') + catalogRootException(row);
  else if (row.location === 'incoming') file += `<div class="small muted catalog-path mono">${escapeHtml(`incoming/${row.local_path}`)}</div>`;
  else if (row.download_path) file += path(row.download_path, '<span class="catalog-path-prefix">NAS</span> ');
  const meta = remote ? `${catalogRemoteLinkLabel(row)}<div class="small muted">${kind} · ${size}</div>`
    : archives ? `<div>${escapeHtml(row.event_name || '미배정')}</div><div class="small muted">작업 #${row.job_id} · ${row.kind === 'xmp' ? 'XMP' : '원본'} · ${size}</div>${row.device ? `<div class="small muted">${escapeHtml(row.device)}</div>` : ''}`
      : `<div>${escapeHtml(row.event_name || '미배정')}</div><div class="small muted numbers">${row.captured_at ? catalogTime(row.captured_at, row.event_zone) : '—'}</div><div class="small muted">${escapeHtml(row.device || '장비 미확인')} · ${size}</div>`;
  const outcomes = { uploaded: ['업로드 검증', 'ready'], skipped: ['동일 파일 확인', 'ready'], legacy_verified: ['과거 전송 완료', 'draft'], failed: ['전송 실패', 'danger'], pending: ['진행 대기', 'draft'], unknown: ['결과 미기록', 'draft'] };
  const outcome = outcomes[row.outcome] || [row.outcome || '결과 미기록', 'draft'];
  let status = remote ? `<span class="status ${row.status === 'present' ? 'archived' : 'review'}">${row.status === 'present' ? 'NAS 보관' : 'NAS 누락'}</span><div class="small muted numbers">${catalogTime(row.verified_at || row.last_seen_at)}</div>`
    : archives ? `<span class="status ${outcome[1]}">${escapeHtml(outcome[0])}</span><div class="small muted numbers">${catalogTime(row.verified_at || row.recorded_at)}</div>${row.error ? `<p class="small form-error catalog-path">${escapeHtml(row.error)}</p>` : ''}`
      : catalogFileStatus(row);
  const downloadPath = remote ? row.remote_path : archives ? row.target : row.download_path;
  status += `<div class="catalog-row-actions">${catalogGenerateButton(row)}${row.thumbnail_error ? `<span class="small form-error">${escapeHtml(row.thumbnail_error)}</span>` : ''}${row.can_download ? `<a class="time-edit-link" href="/api/archive/download?path=${encodeURIComponent(downloadPath)}" target="_blank" rel="noopener">${archives || remote ? '다운로드' : 'NAS 다운로드'}</a>` : ''}<button type="button" class="button catalog-detail-toggle" data-action="toggle-catalog-detail" data-value="${escapeHtml(rowKey)}" aria-expanded="${expanded}"${expanded ? ` aria-controls="catalog-detail-${index}"` : ''} aria-label="${escapeHtml(row.name)} 상세 정보 ${expanded ? '접기' : '펼치기'}">상세</button></div>`;
  return `<tr class="catalog-row" data-expanded="${expanded}"><td class="catalog-cell-file" data-label="${labels[0]}"><div class="file-cell">${catalogThumbSlot(row, index)}<div class="file-cell-body">${file}</div></div></td><td class="catalog-cell-meta" data-label="${labels[1]}">${meta}</td><td class="catalog-cell-status" data-label="${labels[2]}">${status}</td></tr>${expanded ? catalogRowDetail(row, index) : ''}`;
}

function catalogPage() {
  const data = view.catalog;
  const archives = view.catalogTab === 'archives', remote = view.catalogTab === 'remote';
  const summary = data?.summary;
  const options = remote
    ? [['all', '모든 원격 파일'], ['present', 'NAS 보관'], ['remote_only', '원격 전용 (카탈로그 미등록)'], ['missing', 'NAS 누락'], ['xmp', 'XMP']]
    : archives ? [['all', '모든 결과'], ['verified', '검증 완료'], ['failed', '전송 실패'], ['unknown', '결과 미확정'], ['xmp', 'XMP']]
      : [['all', '모든 파일'], ['managed', '관리 파일 (로컬·NAS)'], ['incoming', 'Incoming 기록'], ['verified', 'NAS 검증 이력 있음'], ['xmp', 'XMP']];
  options.push(['no_thumbnail', '썸네일 없음']);
  const labels = remote ? ['원격 파일 / 폴더', '연동 이벤트 / 크기', 'NAS 상태 / 확인 시각']
    : archives ? ['파일 / 목적지', '분류 / 작업 정보', '검증 결과 / 시각'] : ['파일 / 보관 경로', '분류 / 촬영 일시', '보관 상태 / 최근 업로드'];
  const summaryText = !summary ? '기록을 확인하고 있습니다.' : remote
    ? `NAS 보관 ${summary.remotePresent || 0}개 · 원격 전용 ${summary.remoteOnly || 0}개${summary.remoteMissing ? ` · 누락 ${summary.remoteMissing}개` : ''}${summary.lastIndexedAt ? ` · 인덱싱 ${catalogTime(summary.lastIndexedAt)}` : ''}`
    : archives ? `전체 ${data?.archiveSelection?.total || 0}개 기록 · 성공 ${(data?.archiveSelection?.uploaded || 0) + (data?.archiveSelection?.skipped || 0)} · 실패 ${data?.archiveSelection?.failed || 0} · 과거 완료 ${data?.archiveSelection?.legacy || 0} · 대기 ${data?.archiveSelection?.pending || 0} · 미기록 ${data?.archiveSelection?.unknown || 0}` : `폴더 기준 최근 업로드 · 성공 ${data?.uploadSummary?.success || 0} · 실패 ${data?.uploadSummary?.failed || 0} · 대기 ${data?.uploadSummary?.pending || 0} · 미기록 ${data?.uploadSummary?.unknown || 0} · 과거 완료 ${data?.uploadSummary?.legacy || 0}`;
  const hasFilter = (remote ? view.catalogRemoteFolder : view.catalogEvent !== 'all' || view.catalogDevice) || view.catalogQuery || view.catalogScope !== 'all' || view.catalogUploadResult !== 'all';
  const rootBadge = data?.activeArchiveRoot
    ? `<span class="catalog-root-badge mono" title="활성 NAS 루트: ${escapeHtml(data.activeArchiveRoot)}"><span class="catalog-root-label">NAS 루트</span>${escapeHtml(data.activeArchiveRoot)}</span>`
    : '<span class="catalog-root-badge is-unset">NAS 루트 미설정</span>';
  return `${header(archives ? '작업 내역' : '파일 기록', archives ? '아카이브 전송의 파일별 결과를 조회합니다.' : '보유 파일과 원격 인덱스를 조회합니다.', button('refresh-catalog', '새로 고침', { glyph: 'refresh', disabled: view.catalogBusy }))}
    <section class="surface" aria-label="파일 카탈로그">
      <div class="catalog-topbar"><div class="catalog-tabs" ${archives ? '' : 'role="tablist" aria-label="기록 종류"'}>
        ${(archives ? [] : [['files', '보유 파일', summary?.files], ['remote', '원격 인덱스', summary?.remoteTotal]]).map(([key, title, count]) => `<button type="button" role="tab" id="catalog-tab-${key}" class="catalog-tab" data-action="catalog-tab" data-value="${key}" aria-selected="${view.catalogTab === key}" aria-controls="catalog-tabpanel" tabindex="${view.catalogTab === key ? '0' : '-1'}">${title} <span class="catalog-tab-count">${count ?? '—'}</span></button>`).join('')}
      </div><p class="catalog-summary small muted">${summaryText}</p></div>
      <div id="catalog-tabpanel" ${archives ? '' : `role="tabpanel" aria-labelledby="catalog-tab-${view.catalogTab}"`}>${archives ? `<p class="small muted">종료된 작업의 미기록 항목은 파일별 실패가 확인된 결과와 구분합니다.</p><p>${view.catalogJobId ? `작업 #${view.catalogJobId} · 아카이브 기록 ${button('all-archives','전체 아카이브 기록')}` : '전체 아카이브 기록'}</p>` : ''}
      <div class="catalog-layout">${catalogFolderTree()}<div class="catalog-content">
      <div class="catalog-context-bar"><div class="catalog-location" aria-label="${remote ? '현재 원격 폴더' : '현재 이벤트 폴더'}">${icon('folder')}<strong>${escapeHtml(catalogFolderLabel())}</strong></div>${archives || remote ? rootBadge : ''}${catalogThumbnailAlert()}</div>
      <form id="catalog-search" class="catalog-tools">
        <label class="search">${icon('search')}<span class="sr-only">파일 기록 검색</span><input id="catalog-query" name="query" type="search" maxlength="300" placeholder="파일명·경로·SHA-256 검색" value="${escapeHtml(view.catalogQuery)}"></label>
        <select id="catalog-scope" name="scope" aria-label="파일 기록 필터">${options.map(([value, label]) => `<option value="${value}" ${view.catalogScope === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        ${!archives && !remote ? `<select id="catalog-upload-result" aria-label="최근 업로드 결과">${[['all','모든 업로드 결과'],['success','성공'],['failed','실패'],['pending','대기·진행 중'],['unknown','결과 미기록'],['legacy','과거 전송 완료'],['none','전송 이력 없음']].map(([key,label]) => `<option value="${key}" ${view.catalogUploadResult === key ? 'selected' : ''}>${label}</option>`).join('')}</select>` : ''}
        <button type="submit" class="button" ${view.catalogBusy ? 'disabled' : ''}>검색</button>
        ${hasFilter ? button('reset-catalog-filters', '필터 초기화') : ''}<div class="view-switch view-switch-icon" role="group" aria-label="기록 보기 방식">${[ ['table', '표 보기', 'table'], ['cards', '카드 보기', 'grid'] ].map(([value, label, glyph]) => button('catalog-view', label, { glyph, extra: `data-value="${value}" aria-pressed="${view.catalogView === value}"` })).join('')}</div>
      </form>
      ${view.catalogError ? `<p class="archive-error form-error" role="alert">${escapeHtml(view.catalogError)}</p>` : ''}
      <div class="catalog-results${view.catalogBusy ? ' is-loading' : ''}" aria-busy="${view.catalogBusy}">
      ${view.catalogBusy && !view.catalogSoftLoading ? emptyState('file', '기록을 불러오고 있습니다.') : data?.rows.length ? view.catalogView === 'cards' ? `<div class="catalog-cards incoming-cards">${data.rows.map(catalogCardItem).join('')}</div>` : `<div class="table-wrap catalog-table-wrap" tabindex="0" aria-label="${remote ? '원격 인덱스' : archives ? '아카이브' : '파일'} 기록 표, 가로 스크롤 가능"><table class="catalog-table" aria-label="${remote ? '원격 인덱스' : archives ? '아카이브 기록' : '파일 해시 기록'}">
        <thead><tr>${labels.map(label => `<th scope="col">${label}</th>`).join('')}</tr></thead>
        <tbody>${data.rows.map((row, index) => catalogTableRow(row, index, labels)).join('')}</tbody></table></div>` : emptyState('file', view.catalogError ? '기록을 불러오지 못했습니다.' : hasFilter ? '조건에 맞는 기록이 없습니다.' : remote ? '인덱싱된 원격 파일이 없습니다.' : archives ? '아카이브 전송 기록이 없습니다.' : '파일 기록이 없습니다.', remote ? '아카이브 전송 페이지에서 원격 스토리지에 연결한 뒤 원격 인덱싱을 실행하세요.' : archives ? '아카이브 전송 결과가 이곳에 기록됩니다.' : '가져오기에서 파일을 검사하면 해시 기록을 확인할 수 있습니다.')}
      </div>
      ${data && !view.catalogBusy && !view.catalogError ? `<div class="catalog-pagination"><span class="small muted" role="status">${data.total}개 기록 · ${data.page} / ${data.pages}페이지</span><div>
        ${button('catalog-page', '이전', { extra: `data-value="${data.page - 1}"`, disabled: data.page <= 1 })}
        ${button('catalog-page', '다음', { extra: `data-value="${data.page + 1}"`, disabled: data.page >= data.pages })}</div></div>` : ''}
      </div></div></div>
    </section>`;
}

function cancelCatalogSearchDebounce() { window.clearTimeout(catalogSearchTimer); catalogSearchTimer = null; }
function scheduleCatalogSearch() {
  cancelCatalogSearchDebounce();
  if (catalogComposing) return;
  catalogSearchTimer = window.setTimeout(() => {
    catalogSearchTimer = null;
    if (!recordBrowserVisible()) return;
    view.catalogPage = 1; loadCatalog({ soft: true });
  }, view.catalogQuery ? 280 : 0);
}
async function loadCatalog({ soft = false } = {}) {
  cancelCatalogSearchDebounce();
  const request = ++catalogRequest;
  view.catalogSoftLoading = soft && Boolean(view.catalog);
  view.catalogBusy = true;
  view.catalogError = '';
  if (recordBrowserVisible()) render();
  try {
    const query = new URLSearchParams({
      view: view.catalogTab, q: view.catalogQuery, scope: view.catalogScope, page: view.catalogPage,
      event: view.catalogEvent, device: view.catalogDevice, folder: view.catalogRemoteFolder,
    });
    if (view.catalogTab === 'archives' && view.catalogJobId) query.set('job_id', view.catalogJobId);
    if (view.catalogTab === 'files') query.set('upload_result', view.catalogUploadResult);
    const result = await api(`catalog?${query}`);
    if (request !== catalogRequest) return;
    view.catalog = result;
    const rowKeys = new Set(result.rows.map(catalogRowKey));
    for (const key of view.catalogExpandedRows) if (!rowKeys.has(key)) view.catalogExpandedRows.delete(key);
    view.catalogPage = result.page;
  } catch (error) {
    if (request === catalogRequest) view.catalogError = error.message;
  } finally {
    if (request === catalogRequest) {
      view.catalogBusy = false;
      if (recordBrowserVisible()) render();
    }
  }
}

function historyResultDetails(job) {
  const result = job.result || {}, meta = job.resultMeta || {};
  const list = (name, title) => {
    const values = result[name];
    if (!Array.isArray(values) || !values.length) return '';
    const truncated = meta[`${name}Truncated`] ? `<p class="small muted">총 ${meta[`${name}Total`]}건 중 ${values.length}건 표시 (확인 필요 항목 우선)</p>` : '';
    return `${truncated}<h3>${title}</h3><ul>${values.map(item => `<li>${escapeHtml(typeof item === 'object' && item !== null ? [item.path || item.name || item.id || '', item.status || '', item.reason || item.message || '', item.result?.path || ''].filter(Boolean).join(' · ') || JSON.stringify(item) : item)}</li>`).join('')}</ul>`;
  };
  return `${result.error ? `<p class="form-error">${escapeHtml(result.error)}</p>` : ''}${list('items', '파일별 결과')}${list('errors', '오류')}${list('unmatchedCompanions', '연결하지 못한 동반 파일')}`;
}
function resultBanner(job, title, followup = '') {
  if (isResultDismissed(job)) return '';
  const details = historyResultDetails(job);
  return `<section class="surface upload-status result-banner result-banner-${resultTone(job)}" ${job.status === 'failed' ? 'role="alert"' : ''} aria-label="${escapeHtml(title)}">
    <div class="result-banner-head"><div><strong>${escapeHtml(title)}</strong><p class="small muted">${escapeHtml(jobMessage(job) || '작업을 종료했습니다.')}</p></div>
    <div class="result-banner-actions">${resultBannerActions(job, title, followup)}</div></div>
    ${details ? `<details ${resultDetailsAttributes(job)}><summary>상세 결과</summary>${details}</details>` : ''}</section>`;
}
function jobHistoryKey(job) { return `${job.source === 'device' ? 'device' : 'server'}:${jobDismissKey(job)}`; }
function mergedJobEntries() {
  const entries = new Map(view.jobs.items.map(job => [job.id, job]));
  for (const lane of lanes) {
    const latest = laneJob(lane);
    if (latest && entries.has(latest.id)) entries.set(latest.id, { ...entries.get(latest.id), ...latest });
    const active = activeLaneJob(lane);
    if (active) entries.set(active.id, { ...entries.get(active.id), ...active });
  }
  const device = [...view.deviceUploadHistory];
  if (view.deviceUpload.running) device.push(deviceUploadEntry(true));
  return [...entries.values(), ...device].filter(job => {
    if (view.jobs.laneFilter !== 'all' && job.lane !== view.jobs.laneFilter) return false;
    const filter = view.jobs.statusFilter;
    return filter === 'all' || (filter === 'active' ? isJobActive(job) : filter === 'attention' ? !isJobActive(job) && jobHasAttention(job) : job.status === filter);
  }).sort((a, b) => {
    const activeDeviceDiff = Number(b.source === 'device' && isJobActive(b)) - Number(a.source === 'device' && isJobActive(a));
    const timeDiff = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    if (activeDeviceDiff || timeDiff) return activeDeviceDiff || timeDiff;
    const idDiff = Number(b.id) - Number(a.id);
    return Number.isFinite(idDiff) && idDiff !== 0 ? idDiff : String(b.id).localeCompare(String(a.id));
  });
}
async function loadJobs({ reset = false, silent = false, preserveLoaded = false, more = false } = {}) {
  const jobs = view.jobs, request = ++jobsRequest;
  if (reset) Object.assign(jobs, { items: [], nextBeforeId: null, hasMore: false, loadedOnce: false });
  jobs.busy = !silent && !more; jobs.loadingMore = more; jobs.error = '';
  if (view.page === 'jobs') patchJobsPage();
  const query = new URLSearchParams({ limit: '30', status: jobs.statusFilter, lane: jobs.laneFilter === 'device' ? 'all' : jobs.laneFilter });
  if (more && jobs.nextBeforeId) query.set('before_id', jobs.nextBeforeId);
  try {
    const result = await api(`jobs?${query}`);
    if (request !== jobsRequest) return;
    if (more) {
      const merged = new Map(jobs.items.map(item => [item.id, item]));
      for (const item of result.jobs) merged.set(item.id, item);
      jobs.items = [...merged.values()].sort((a, b) => b.id - a.id);
      jobs.nextBeforeId = result.nextBeforeId; jobs.hasMore = result.hasMore;
    } else if (preserveLoaded) {
      const older = result.hasMore && result.nextBeforeId != null
        ? jobs.items.filter(item => item.id < result.nextBeforeId)
        : [];
      jobs.items = [...result.jobs, ...older];
      if (!older.length) { jobs.nextBeforeId = result.nextBeforeId; jobs.hasMore = result.hasMore; }
    } else {
      jobs.items = result.jobs;
      jobs.nextBeforeId = result.nextBeforeId; jobs.hasMore = result.hasMore;
    }
    jobs.summary = result.summary; jobs.loadedOnce = true;
  } catch (error) { if (request === jobsRequest) jobs.error = error.message; }
  finally {
    if (request === jobsRequest) {
      jobs.busy = false; jobs.loadingMore = false;
      if (view.page === 'jobs') patchJobsPage();
    }
  }
}
function mountJobsPage() {
  page.innerHTML = `<main aria-labelledby="page-title" data-page="jobs"><div id="page-active-jobs"></div><div id="page-load-error"></div><div id="jobs-header"></div>${jobsTabs()}<div id="jobs-panel" role="tabpanel" aria-labelledby="jobs-tab-list">
    <section class="surface" aria-label="작업 내역 목록"><div class="jobs-toolbar"><div id="jobs-status-filters" class="filters" aria-label="작업 상태 필터"></div>
      <label>작업 영역 <select id="jobs-lane-filter"><option value="all">모든 영역</option><option value="local">로컬 파일</option><option value="remote">원격 아카이브</option><option value="device">기기 업로드 (이 브라우저)</option><option value="exclusive">시스템</option></select></label></div>
    <div id="jobs-error"></div><div id="jobs-list" class="jobs-list"></div><div id="jobs-footer" class="jobs-footer"></div></section></div></main>`;
}
function jobHistoryActions(job) {
  const result = job.result || {};
  if (isJobActive(job)) {
    const cancel = { upload: 'cancel-archive-upload', 'remote-index': 'cancel-remote-index', 'device-upload': 'cancel-incoming-upload' }[job.kind];
    return `${job.kind === 'upload' ? button('open-job-archives', '아카이브 기록 보기', {extra: `data-value="${job.id}"`}) : ''}${cancel ? button(cancel, result.cancelRequested || (job.source === 'device' && view.deviceUpload.cancelling) ? '중지 중…' : '중지', { disabled: result.cancelRequested || (job.source === 'device' && view.deviceUpload.cancelling), extra: `data-value="${escapeHtml(job.id)}"` }) : ''}`;
  }
  if (job.kind === 'upload') return button('open-job-archives', '아카이브 기록 보기', { extra: `data-value="${job.id}"` });
  if (job.kind === 'remote-index') return button('open-catalog-tab', '원격 인덱스 보기', { extra: 'data-value="remote"' });
  if (job.kind === 'offload') return button('open-events', '이벤트 분류 열기');
  if (job.kind === 'device-upload') return button('open-incoming', '가져오기 열기');
  if (['scan', 'move', 'delete', 'duplicate-cleanup', 'xmp-link'].includes(job.kind)) return `${job.kind === 'move' && result.moved > 0 ? button('open-unassigned', '미배정 열기') : ''}${button('open-incoming', '가져오기 열기')}${jobHasAttention(job) ? button('rescan-incoming', '다시 검사', { disabled: localBusy() }) : ''}`;
  return '';
}
function patchJobCard(node, job) {
  const kinds = { "thumbnails-local": "썸네일 생성", "thumbnails-remote": "썸네일 생성", scan: '파일 검사', move: '보관함 가져오기', delete: '사진 삭제', 'duplicate-cleanup': '중복 정리', 'xmp-link': 'XMP 연결', upload: '아카이브 업로드', offload: 'NAS 보관 후 로컬 비우기', 'remote-index': '원격 인덱싱', 'reset-all': '초기화', 'device-upload': '기기 업로드' };
  const statuses = { queued: '대기 중', running: '진행 중', done: '완료', failed: '실패', cancelled: '중지됨' };
  const result = job.result || {}, active = isJobActive(job), key = jobHistoryKey(job);
  setSlotHtml(node.querySelector('[data-slot="head"]'), `<div><strong>${escapeHtml(kinds[job.kind] || job.kind)}</strong> ${badge(active ? 'draft' : jobHasAttention(job) ? 'review' : 'ready', statuses[job.status] || job.status)}${job.source === 'device' ? '<span class="job-source-tag">이 브라우저 기록</span>' : `<span class="small muted">#${job.id}</span>`}</div><time class="small muted">${catalogTime(job.createdAt)}</time>`);
  const completed = result.completedFiles ?? result.processedFiles ?? 0;
  const percent = result.totalBytes ? Math.min(100, Math.round((result.transferredBytes || 0) / result.totalBytes * 100)) : Math.min(100, Math.round(completed / (result.totalFiles || 1) * 100));
  const message = active ? result.phase || '작업 진행 중' : job.kind === 'device-upload' ? `업로드 ${result.uploaded || 0}개 · 실패 ${result.failed || 0}개 · 확인 필요 ${result.review || 0}개` : jobMessage(job) || '작업 종료';
  setSlotHtml(node.querySelector('[data-slot="body"]'), `<p>${escapeHtml(message)}</p>${active ? `<p class="small muted">${completed} / ${result.totalFiles || 0}개${result.totalBytes ? ` · ${deviceUploadBytes(result.transferredBytes || 0)} / ${deviceUploadBytes(result.totalBytes)}` : ''}</p><progress max="100" value="${percent}" aria-label="${escapeHtml(kinds[job.kind] || job.kind)} 진행률"></progress>${result.current ? `<p class="small job-current">${escapeHtml(result.current)}</p>` : ''}` : ''}<div class="job-actions">${jobHistoryActions(job)}</div>`);
  const detailSlot = node.querySelector('[data-slot="details"]'), previous = detailSlot.querySelector('details');
  if (previous) { if (previous.open) view.jobsExpanded.add(key); else view.jobsExpanded.delete(key); }
  const details = historyResultDetails(job);
  // Keep the HTML cache independent of native details.open changes.
  if (setSlotHtml(detailSlot, details ? `<details data-job-history-key="${escapeHtml(key)}"><summary>상세 결과</summary>${details}</details>` : '')) {
    const el = detailSlot.querySelector('details');
    if (el) el.open = view.jobsExpanded.has(key);
  }
}
function patchJobsPage() {
  if (!page.querySelector('#jobs-list')) return;
  patchPageStatus();
  setSlotHtml(page.querySelector('#jobs-header'), header('작업 내역', '서버 작업과 이 브라우저에서 업로드한 기록을 확인하세요.', button('refresh-jobs', '새로 고침', { glyph: 'refresh', disabled: view.jobs.busy })));
  const summary = { total: 0, active: 0, attention: 0, done: 0, ...view.jobs.summary };
  for (const job of [...view.deviceUploadHistory, ...(view.deviceUpload.running ? [deviceUploadEntry(true)] : [])]) {
    summary.total++; if (isJobActive(job)) summary.active++; else if (jobHasAttention(job)) summary.attention++;
    if (job.status === 'done') summary.done++;
  }
  setSlotHtml(page.querySelector('#jobs-status-filters'), [['all', '전체', 'total'], ['active', '진행 중', 'active'], ['attention', '실패·확인 필요', 'attention'], ['done', '완료', 'done']].map(([filter, title, count]) => `<button type="button" class="filter ${view.jobs.statusFilter === filter ? 'active' : ''}" data-action="jobs-status-filter" data-value="${filter}" aria-pressed="${view.jobs.statusFilter === filter}">${title} <span>${summary[count]}</span></button>`).join(''));
  const lane = page.querySelector('#jobs-lane-filter'); if (lane.value !== view.jobs.laneFilter) lane.value = view.jobs.laneFilter;
  setSlotHtml(page.querySelector('#jobs-error'), view.jobs.error ? `<p class="form-error" role="alert">${escapeHtml(view.jobs.error)} ${button('refresh-jobs', '다시 시도')}</p>` : '');
  const entries = mergedJobEntries();
  reconcileKeyedChildren(page.querySelector('#jobs-list'), 'div', entries, jobHistoryKey,
    () => parseSingleElement('div', '<article class="job-card"><div data-slot="head" class="job-card-head"></div><div data-slot="body"></div><div data-slot="details"></div></article>'), patchJobCard);
  setSlotHtml(page.querySelector('#jobs-footer'), `${!entries.length ? `<p class="muted" role="status">${view.jobs.busy ? '작업 내역을 불러오고 있습니다.' : view.jobs.error ? '작업 내역을 불러오지 못했습니다.' : '조건에 맞는 작업 내역이 없습니다.'}</p>` : ''}${view.jobs.hasMore && view.jobs.laneFilter !== 'device' ? button('load-more-jobs', view.jobs.loadingMore ? '불러오는 중…' : '이전 기록 더 보기', { disabled: view.jobs.loadingMore || view.jobs.busy }) : ''}`);
}

function settingRow(label, description, controls) {
  return `<div class="setting-row"><div><h3>${label}</h3><p class="small muted">${description}</p></div>
    <div class="setting-controls">${controls}</div></div>`;
}

function maskedSetting(status) {
  return `<code class="setting-mask">***</code><span class="small muted">${status}</span>`;
}

function visibleSetting(value) {
  if (value) return `<code class="setting-value mono">${escapeHtml(value)}</code>`;
  return `<span class="small muted">${view.settings ? '미등록' : '확인 중'}</span>`;
}

function thumbnailJobMessage(r) {
  return `썸네일 ${r.generated || 0}개 생성${r.reused ? ` · 기존 ${r.reused}개 재사용` : ''}${r.skippedLarge ? ` · 대용량 건너뜀 ${r.skippedLarge}개` : ''}${r.failed ? ` · 실패 ${r.failed}개` : ''}`;
}

async function loadThumbnailStats({ silent = false } = {}) {
  try { view.thumbnailStats = await api('settings/thumbnails'); view.thumbnailStatsError = ''; }
  catch (error) { view.thumbnailStatsError = error.message; }
  if (!silent) render();
}

function thumbnailSettingsSection() {
  const s = view.thumbnailStats;
  return `<section class="surface settings-section" aria-label="썸네일 캐시"><div class="surface-head"><h2>${icon('photo')} 썸네일 캐시</h2></div>
    ${view.thumbnailStatsError ? `<p class="form-error" role="alert">${escapeHtml(view.thumbnailStatsError)}</p>` : ''}
    ${s ? `<dl class="thumbnail-stats"><div><dt>캐시된 썸네일</dt><dd>${s.cachedCount}개 · ${sizeLabel(s.cachedBytes / 1e6)}</dd></div><div><dt>미생성 미디어</dt><dd>${s.missingTotal}개 (로컬 ${s.missingLocal} · 원격 사진 ${s.missingRemotePhotos} · 원격 영상 ${s.missingRemoteVideos})</dd></div><div><dt>미참조(고아) 캐시</dt><dd>${s.orphanCount}개 · ${sizeLabel(s.orphanBytes / 1e6)}</dd></div><div><dt>실패·대용량 건너뜀</dt><dd>실패 ${s.failedCount}개 · 건너뜀 ${s.skippedLargeCount}개</dd></div></dl>` : '<p role="status">캐시 현황을 불러오는 중입니다.</p>'}
    <p class="small muted">DB 복원 후 누락 썸네일 일괄 생성으로 이미지를 복구할 수 있습니다.${anyJobActive() ? ' 미참조 캐시 정리는 모든 작업이 끝난 뒤 가능합니다.' : ''}</p>
    <div class="thumbnail-settings-actions">${button('refresh-thumbnail-stats', '현황 새로고침', { disabled: view.thumbnailOpBusy })}${button('open-thumbnail-batch', '누락 썸네일 일괄 생성', { extra: 'data-value="all"', disabled: !s?.missingTotal || exclusiveActive() })}${button('cleanup-orphan-thumbnails', '미참조 썸네일 정리', { disabled: !s?.orphanCount || !s?.canCleanup || anyJobActive() || view.thumbnailOpBusy })}${button('reset-thumbnail-failures', '실패 상태 초기화', { disabled: !((s?.failedCount || 0) + (s?.skippedLargeCount || 0)) || view.thumbnailOpBusy || exclusiveActive() })}</div></section>`;
}

function thumbnailScopeRequest(scope) {
  return { scope, view: view.catalogTab, event: view.catalogEvent, device: view.catalogDevice, folder: view.catalogRemoteFolder, ...(scope === 'folder' && view.catalogTab === 'archives' && view.catalogJobId ? {job_id:view.catalogJobId} : {}) };
}

async function openThumbnailBatchDialog(defaultScope = 'folder') {
  let scope = defaultScope;
  const hasFolder = recordBrowserVisible() && (view.catalogTab === 'remote' ? view.catalogRemoteFolder : view.catalogEvent !== 'all' || view.catalogDevice || (view.catalogTab === 'archives' && view.catalogJobId));
  if (!hasFolder) scope = 'all';
  const plan = await api('thumbnails/plan', 'POST', thumbnailScopeRequest(scope));
  showDialog('누락 썸네일 일괄 생성', `${hasFolder ? `<fieldset><legend>생성 범위</legend>${[['folder', view.catalogTab === 'archives' && view.catalogJobId ? `작업 #${view.catalogJobId} · 현재 폴더 범위` : '현재 폴더 범위'], ['all', '전체 미생성']].map(([value, label]) => `<label class="checkbox-row"><input type="radio" name="thumbnail_scope" value="${value}" ${scope === value ? 'checked' : ''}>${label}</label>`).join('')}</fieldset>` : ''}<div id="thumbnail-plan" role="status"></div><div id="thumbnail-fallback"></div>`, '썸네일 생성', async form => {
    const result = await api('jobs/thumbnails', 'POST', { ...thumbnailScopeRequest(scope), allow_large_sftp_fallback: form.get('allow_large_sftp_fallback') === '1' });
    if (result.id) setOptimisticJob({ ...result, result: { phase: '썸네일 생성 대기 중' } });
    await syncState();
  });
  let requestVersion = 0;
  const paint = plan => {
    const busy = plan.lane === 'remote' ? remoteBusy() : localBusy();
    dialog.querySelector('#thumbnail-plan').innerHTML = `<p>로컬 원본 <strong>${plan.local}개</strong> · 원격 사진 ${plan.remotePhotos}개 · 원격 영상 ${plan.remoteVideos}개</p><p class="small muted">예상 디스크 증가량 ${sizeLabel(plan.estimatedBytes / 1e6)} · ${plan.lane === 'remote' ? '원격 작업' : '로컬 작업'}</p>${busy ? '<p class="form-error">해당 작업 레인이 사용 중입니다. 완료 후 다시 실행하세요.</p>' : ''}${plan.lane === 'remote' && !plan.storageConfigured ? '<p class="form-error">설정에서 NAS 연결을 준비하세요.</p>' : ''}`;
    dialog.querySelector('#thumbnail-fallback').innerHTML = plan.remoteVideos ? `<label class="checkbox-row"><input type="checkbox" name="allow_large_sftp_fallback" value="1"><span>NAS에 ffmpeg가 없을 때 150 MiB 초과 영상도 SFTP로 내려받아 추출</span></label><p class="small muted">현재 대상 중 150 MiB 초과 원격 영상 ${plan.remoteVideosOverLimit}개가 있습니다.</p>` : '';
    dialog.querySelector('[type="submit"]').disabled = !plan.total || busy || (plan.lane === 'remote' && !plan.storageConfigured);
  };
  paint(plan);
  dialog.querySelectorAll('[name="thumbnail_scope"]').forEach(input => input.addEventListener('change', async event => {
    scope = event.target.value;
    const version = ++requestVersion;
    dialog.querySelector('[type="submit"]').disabled = true;
    try {
      const next = await api('thumbnails/plan', 'POST', thumbnailScopeRequest(scope));
      if (version === requestVersion && dialog.open) paint(next);
    } catch (error) {
      if (version === requestVersion) dialog.querySelector('#thumbnail-plan').textContent = error.message;
    }
  }));
}

async function generateCatalogThumbnail(sha) {
  if (view.thumbnailGeneratingShas.has(sha)) return;
  view.thumbnailGeneratingShas.add(sha);
  if (view.preview?.source === 'catalog') renderMediaPreview({ focusTitle: false });
  let result;
  try { result = await api('jobs/thumbnails', 'POST', { scope: 'shas', shas: [sha] }); }
  catch (error) {
    view.thumbnailGeneratingShas.delete(sha);
    if (view.preview?.source === 'catalog') renderMediaPreview({ focusTitle: false });
    throw error;
  }
  if (result.id) {
    setOptimisticJob({ ...result, result: { phase: '썸네일 생성 대기 중' } });
  }
  else view.thumbnailGeneratingShas.delete(sha);
  if (view.preview?.source === 'catalog') renderMediaPreview({ focusTitle: false });
  if (result.status === 'noop') { await loadCatalog({ soft: true }); reconcilePreview(); }
  else await syncState();
  render();
}

async function thumbnailCacheOperation(path) {
  if (view.thumbnailOpBusy) return;
  view.thumbnailOpBusy = true; render();
  try {
    const result = await api('settings/thumbnails/' + path, 'POST');
    view.thumbnailStats = result.stats;
    announce(path === 'cleanup' ? `미참조 썸네일 ${result.deleted}개 정리` : `실패 상태 ${result.cleared}개 초기화`);
    if (recordBrowserVisible()) await loadCatalog({ soft: true });
  } finally { view.thumbnailOpBusy = false; render(); }
}

function settingsPage() {
  const settings = view.settings;
  const keyCopied = settings?.keyCopied || view.keyCopiedLocally;
  return `${header('설정', '촬영도구 이름, 스토리지 연결과 카탈로그 백업을 관리하세요.', '')}
    ${view.settingsError ? `<p class="scan-strip" role="alert">${escapeHtml(view.settingsError)}</p>` : ''}
    <section class="surface settings-section device-names" aria-label="촬영도구 이름">
      <div class="surface-head"><h2>${icon('aperture')} 촬영도구 이름</h2></div>
      <p class="device-names-help small muted">기존 파일과 앞으로 들어오는 같은 촬영도구의 파일에 적용합니다. 파일별로 직접 지정한 이름은 유지하며, 기존 원격 폴더는 바꾸지 않습니다.</p>
      ${view.devicesError ? `<p class="form-error device-names-help" role="alert">${escapeHtml(view.devicesError)}</p>${button('refresh-devices', '목록 다시 불러오기')}` : ''}
      ${view.devices === null ? '<p class="device-names-help small muted" role="status">촬영도구 목록을 불러오는 중입니다.</p>' :
        !view.devices.length ? '<p class="device-names-help small muted">감지된 촬영도구가 없습니다. 파일을 보관함으로 가져오고 검사하면 여기에 표시됩니다.</p>' :
        view.devices.map((device, index) => `<form class="setting-row device-name-form" data-source="${escapeHtml(device.source)}">
          <div class="device-name-origin"><label for="device-name-${index}">${escapeHtml(device.source)}</label>
            <p class="small muted">기존 파일 ${device.count}개와 이후 파일에 적용</p></div>
          <div class="setting-controls"><input id="device-name-${index}" name="name" value="${escapeHtml(device.name)}" required maxlength="80" autocomplete="off" ${exclusiveActive() || ['upload', 'offload'].includes(activeLaneJob('remote')?.kind) ? 'disabled' : ''}>
            <button type="submit" class="button" ${exclusiveActive() || ['upload', 'offload'].includes(activeLaneJob('remote')?.kind) ? 'disabled' : ''}>이름 저장</button></div>
          <p class="form-error device-name-error" role="alert" hidden></p>
        </form>`).join('')}
    </section>
    <section class="surface settings-section" aria-label="스토리지 연결">
      <div class="surface-head"><h2>${icon('disk')} 스토리지 연결</h2></div>
      ${settingRow('스토리지 IP 주소', '연결할 스토리지의 IPv4 또는 IPv6 주소',
        visibleSetting(settings?.address) +
        button('edit-storage-address', settings?.addressConfigured ? 'IP 변경' : 'IP 등록', { disabled: !settings || view.sshTestBusy }))}
      ${settingRow('저장 절대경로', '원격 스토리지에서 사진과 영상을 보관할 폴더',
        visibleSetting(settings?.storageRoot) +
        button('edit-storage-root', settings?.storageRootConfigured ? '경로 변경' : '경로 등록', { disabled: !settings }))}
      ${settingRow('SSH 계정명', '.env의 PHOTO_SAVER_STORAGE_USER에서 설정',
        maskedSetting(settings ? settings.accountConfigured ? '등록됨' : '미등록' : '확인 중'))}
      ${settingRow('SSH 공개키', '키마다 한 번 복사할 수 있습니다. 새로 생성하면 다시 복사할 수 있습니다.',
        maskedSetting(settings ? keyCopied ? '복사 완료' : settings.keyGenerated ? '생성됨' : '미생성' : '확인 중') +
        (settings?.keyGenerated ? button('copy-public-key', '공개키 복사', { glyph: 'copy', disabled: keyCopied || !view.publicKeyToCopy || view.sshTestBusy }) +
          button('regenerate-storage-key', '공개키 재생성', { glyph: 'key', disabled: view.sshTestBusy }) :
          button('generate-storage-key', '공개키 생성', { glyph: 'key', primary: true, disabled: !settings || view.sshTestBusy })))}
      ${settingRow('서버 호스트 키', '저장된 SSH 호스트 키와 서버가 다를 때 초기화한 뒤 접속 테스트로 다시 신뢰할 수 있습니다.',
        `<span class="small muted">${settings ? settings.hostKeyTrusted ? '신뢰됨' : '미등록' : '확인 중'}</span>` +
        button('reset-host-key', '호스트 키 초기화', {
          danger: true,
          disabled: !settings?.hostKeyTrusted || view.sshTestBusy || remoteBusy(),
        }))}
      ${settingRow('SSH 접속 테스트', view.sshTestResult ? `<span role="status" class="${view.sshTestResult.ok ? 'ssh-test-success' : 'form-error'}">${escapeHtml(view.sshTestResult.message)}</span>` :
        '저장된 IP, 계정명, 키로 공개키 인증을 확인합니다.',
        button('test-storage-ssh', view.sshTestBusy ? '테스트 중…' : '접속 테스트', { glyph: 'refresh', disabled: !settings || view.sshTestBusy }))}
    </section>
    <section class="surface settings-section" aria-label="DB 백업 및 복원">
      <div class="surface-head"><h2>${icon('file')} DB 백업 및 복원</h2></div>
      ${settingRow('카탈로그 백업', '이벤트와 파일 분류 상태가 포함된 SQLite 백업을 다운로드합니다.',
        button('download-catalog', 'DB 백업 다운로드', { glyph: 'download', disabled: anyJobActive() || view.catalogOpBusy }))}
      ${settingRow('카탈로그 복원', '선택한 백업의 내용으로 현재 카탈로그를 교체합니다. 썸네일 이미지 파일은 DB 백업에 포함되지 않습니다. 복원 후 아래 썸네일 캐시의 누락 썸네일 일괄 생성으로 복구할 수 있습니다.',
        `<input id="restore-catalog-file" type="file" accept=".sqlite3,.sqlite,.db,application/octet-stream" hidden>` +
        (view.restoreFile ? maskedSetting('파일 선택됨') : '') + button('pick-catalog-file', '백업 파일 선택', { disabled: anyJobActive() || view.catalogOpBusy }) +
        button('restore-catalog', '복원', { glyph: 'upload', danger: true, disabled: !view.restoreFile || anyJobActive() || view.catalogOpBusy }))}
    </section>
    ${thumbnailSettingsSection()}
    <section class="surface settings-section settings-danger" aria-label="데이터 초기화">
      <div class="surface-head"><h2>${icon('trash')} 데이터 초기화</h2><span class="settings-danger-badge">위험 구역</span></div>
      ${settingRow('managed 및 기록 초기화', 'managed 원본과 부가 파일, 썸네일, 카탈로그·작업 기록을 영구 삭제합니다. incoming과 SSH 연결 설정은 유지합니다.',
        button('reset-catalog', '데이터 초기화', { danger: true, disabled: anyJobActive() || view.catalogOpBusy }))}
      ${resetStatus()}
    </section>`;
}

async function loadSettings() {
  await loadThumbnailStats({ silent: true });
  await loadDevices();
  try {
    view.settings = await api('settings');
    view.settingsError = '';
    if (view.keyCopiedLocally && !view.settings.keyCopied) {
      view.settings = await api('settings/ssh-key/copied', 'POST');
    }
    const pending = view.settings.keyGenerated && !view.settings.keyCopied;
    view.publicKeyToCopy = pending ? (await api('settings/ssh-key/public', 'POST')).publicKey : null;
  } catch (error) {
    view.settingsError = error.message;
  }
}

async function loadDevices() {
  const request = ++devicesRequest;
  try {
    const result = await api('devices');
    if (request !== devicesRequest) return;
    view.devices = result.devices;
    view.devicesError = '';
  } catch (error) {
    if (request !== devicesRequest) return;
    view.devices = [];
    view.devicesError = error.message;
  }
}

page.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('.device-name-form')) return;
  event.preventDefault();
  const submit = form.querySelector('[type="submit"]');
  const errorMessage = form.querySelector('.device-name-error');
  errorMessage.hidden = true;
  submit.disabled = true;
  submit.textContent = '저장 중…';
  try {
    view.devices = (await api('devices/name', 'PUT', {
      source: form.dataset.source, name: new FormData(form).get('name'),
    })).devices;
    view.eventDevice = ''; view.catalogDevice = ''; view.catalogPage = 1;
    view.sourcePath = []; view.sourceSelection.clear();
    await syncState();
    announce('촬영도구 이름을 저장했습니다. 이후 파일에도 같은 이름을 적용합니다.');
    render();
  } catch (error) {
    errorMessage.textContent = error.message;
    errorMessage.hidden = false;
    submit.disabled = false;
    submit.textContent = '이름 저장';
  }
});

function editStorageAddress() {
  showDialog('스토리지 IP 주소', `<label>새 IP 주소
      <input name="address" type="text" value="${escapeHtml(view.settings?.address || '')}" placeholder="IPv4 또는 IPv6 주소 입력"
        autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus>
    </label>`, 'IP 저장', async form => {
    view.settings = await api('settings/storage', 'PUT', { address: form.get('address') });
    resetArchiveConnection();
    view.sshTestResult = null;
    announce('스토리지 IP 주소를 저장했습니다.');
  });
}

function editStorageRoot() {
  showDialog('스토리지 저장 절대경로', `<label>저장 절대경로
    <input name="path" type="text" value="${escapeHtml(view.settings?.storageRoot || '')}"
      placeholder="/srv/media/archive" autocomplete="off" autocapitalize="off" spellcheck="false" required autofocus>
  </label>`, '경로 저장', async form => {
    view.settings = await api('settings/storage/root', 'PUT', { path: form.get('path') });
    resetArchiveConnection();
    announce('원격 스토리지의 저장 경로를 저장했습니다.');
  });
}

async function generateStorageKey() {
  view.settings = await api('settings/ssh-key', 'POST');
  resetArchiveConnection();
  view.keyCopiedLocally = false;
  view.publicKeyToCopy = null;
  view.sshTestResult = null;
  await loadSettings();
  announce('SSH 키를 생성했습니다. 공개키를 복사해 스토리지에 등록하세요.');
}

function regenerateStorageKey() {
  showDialog('SSH 공개키 재생성', '<p>기존 SSH 키를 새 키로 교체합니다. 새 공개키를 스토리지 계정에 등록해야 다시 접속할 수 있습니다.</p>',
    '재생성', generateStorageKey, { danger: true });
}

async function copyStorageKey() {
  if (!view.publicKeyToCopy || view.keyCopiedLocally) return;
  await copyTextToClipboard(view.publicKeyToCopy);
  view.keyCopiedLocally = true;
  view.publicKeyToCopy = null;
  view.settings = await api('settings/ssh-key/copied', 'POST');
  announce('공개키를 복사했습니다. 스토리지의 SSH 계정에 등록하세요.');
}

function reportSshResult(ok, message) {
  view.sshTestResult = { ok, message };
}

async function testStorageSsh() {
  view.sshTestBusy = true;
  view.sshTestResult = null;
  render();
  try {
    const result = await api('settings/ssh-test', 'POST');
    if (result.status === 'confirm_host') {
      if (view.page !== 'settings') return;
      showDialog('서버 호스트 키 확인', `<p>스토리지에서 확인한 SSH 호스트 키 지문과 아래 지문을 비교하세요.</p>
        <p class="mono">${escapeHtml(result.algorithm)}<br>${escapeHtml(result.fingerprint)}</p>`,
      '지문 확인 및 접속', async () => {
        try {
          await api('settings/ssh-test/trust', 'POST', { token: result.token });
          resetArchiveConnection();
          reportSshResult(true, 'SSH 공개키 인증에 성공했습니다.');
        } catch (error) {
          reportSshResult(false, error.message);
        } finally {
          view.settings = await api('settings').catch(() => view.settings);
        }
      });
    } else {
      resetArchiveConnection();
      reportSshResult(true, 'SSH 공개키 인증에 성공했습니다.');
    }
  } catch (error) {
    reportSshResult(false, error.message);
  } finally {
    view.sshTestBusy = false;
    render();
  }
}

function confirmResetHostKey() {
  showDialog('서버 호스트 키 초기화', `<p>현재 스토리지 IP에 저장된 SSH 호스트 키를 삭제합니다.</p>
    <p>다음 접속 테스트에서 서버의 지문을 다시 확인해 신뢰해야 원격 아카이브에 연결할 수 있습니다.</p>`,
  '호스트 키 초기화', async () => {
    view.settings = await api('settings/ssh-host-key', 'DELETE');
    view.sshTestResult = null;
    resetArchiveConnection();
    announce('저장된 SSH 호스트 키를 초기화했습니다. 접속 테스트로 다시 확인하세요.');
  }, { danger: true });
}

async function downloadCatalog() {
  view.catalogOpBusy = true;
  render();
  try {
    const response = await fetch('/api/settings/catalog/backup', { cache: 'no-store' });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail || 'DB 백업을 다운로드할 수 없습니다.');
    }
    const url = URL.createObjectURL(await response.blob());
    const download = document.createElement('a');
    download.href = url;
    download.download = response.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1] || 'photo-saver.sqlite3';
    document.body.append(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally { view.catalogOpBusy = false; render(); }
}

function confirmCatalogRestore() {
  const file = view.restoreFile;
  if (!file) return;
  showDialog('카탈로그 복원', `<p>선택한 백업으로 현재 이벤트와 파일 분류 상태를 교체합니다.</p>
    <p>원본 사진과 영상은 디스크에 보관됩니다.</p>`, 'DB 복원', async () => {
    view.catalogOpBusy = true;
    render();
    try {
      await api('settings/catalog/restore', 'POST', file);
      clearDismissedResults();
      view.restoreFile = null;
      view.incomingSelection.clear();
      view.xmpChoices.clear();
      chooseEvent('unassigned');
      view.sourcePath = [];
      await syncState();
      announce('카탈로그를 복원했습니다.');
    } finally { view.catalogOpBusy = false; render(); }
  }, { danger: true });
}

function resetStatus() {
  const job = laneJob('exclusive');
  if (job?.kind !== 'reset-all') return '';
  if (job.status === 'failed') return resultBanner(job, '초기화 실패');
  const result = job.result || {};
  const detail = job.status === 'failed' ? result.error :
    `${result.phase || '초기화 대기 중'} · 파일 ${result.deletedFiles || 0}개 삭제`;
  return `<p class="device-names-help ${job.status === 'failed' ? 'form-error' : 'small muted'}" role="${job.status === 'failed' ? 'alert' : 'status'}">${escapeHtml(detail)}</p>`;
}

function clearCatalogViews() {
  view.thumbnailStats = null; view.thumbnailStatsError = ''; view.thumbnailGeneratingShas.clear();
  cancelCatalogSearchDebounce(); clearDismissedResults(); clearDeviceUploadHistory();
  ++jobsRequest;
  Object.assign(view.jobs, { items: [], summary: null, nextBeforeId: null, hasMore: false, busy: false, loadingMore: false, loadedOnce: false, error: '' });
  view.jobsExpanded.clear();
  view.incomingLayout = 'table';
  view.eventView = 'table';
  try { localStorage.removeItem('photo-saver-event-view'); } catch { /* Storage may be unavailable. */ }
  view.incomingTab = 'files';
  try { localStorage.removeItem('photo-saver-incoming-layout'); } catch { /* Storage may be unavailable. */ }
  resetArchiveConnection(); view.catalogTab = 'files';
  ++catalogRequest;
  ++devicesRequest;
  view.incomingSelection.clear();
  view.incomingFilter = 'all'; view.incomingKind = ''; view.query = '';
  view.xmpChoices.clear();
  chooseEvent('unassigned');
  view.sourcePath = []; view.sourceSelection.clear();
  clearArchiveDrag();
  view.catalog = null; view.catalogBusy = false; view.catalogError = '';
  view.catalogEvent = 'all'; view.catalogDevice = ''; view.catalogQuery = '';
  view.catalogJobId = null; view.catalogUploadResult = 'all'; view.jobsTab = 'list';
  view.catalogScope = 'all'; view.catalogPage = 1; view.catalogExpanded.clear();
  view.catalogRemoteFolder = ''; view.catalogRemoteExpanded.clear();
  view.catalogExpandedRows.clear();
  view.restoreFile = null;
  view.devices = []; view.devicesError = '';
  closeMediaPreview({ restoreFocus: false });
}

function confirmCatalogReset() {
  showDialog('데이터 초기화', `<p><strong>아래 데이터를 영구 삭제합니다.</strong></p>
    <ul><li>managed 전체: 사진·영상 원본과 부가 파일</li>
      <li>썸네일, 서버 임시 데이터, 파일·이벤트·전송·작업 기록</li>
      <li>장비·촬영 시각 보정과 촬영도구 이름 규칙</li></ul>
    <p><strong>incoming 디렉터리와 그 안의 모든 파일·하위 폴더는 유지합니다.</strong> SSH 연결 설정·키와 원격 아카이브도 유지합니다.</p>
    <p><strong>삭제한 파일은 복구할 수 없습니다.</strong> DB 백업에는 원본 파일이 포함되지 않습니다.</p>
    <label><span>확인 문구 <strong>모든 데이터 삭제</strong>를 입력하세요.</span>
      <input name="confirmation" required autocomplete="off" spellcheck="false"></label>`,
  '모든 데이터 삭제', async form => {
    const result = await api('settings/catalog/reset', 'POST', { confirmation: form.get('confirmation') });
    closeMediaPreview({ restoreFocus: false });
    setOptimisticJob({ id: result.id, kind: 'reset-all', status: 'queued', result: {} });
    await syncState();
    if (jobActive()) announce('서버 데이터 초기화를 시작했습니다. 설정에서 진행 상황을 확인할 수 있습니다.');
  }, { danger: true });
  const confirmation = dialog.querySelector('[name="confirmation"]');
  const submit = dialog.querySelector('[type="submit"]');
  submit.disabled = true;
  confirmation.addEventListener('input', () => { submit.disabled = confirmation.value !== '모든 데이터 삭제'; });
}

function showDialog(title, content, submitLabel, handler, { danger = false, scrollBody = false } = {}) {
  if (scrollBody) dialog.classList.add('dialog-scroll-body');
  else dialog.classList.remove('dialog-scroll-body');
  dialog.innerHTML = `<form id="dialog-form">
    <div class="dialog-head"><h2 id="dialog-title">${title}</h2>${smallButton('close-dialog', '닫기', 'close')}</div>
    <div class="dialog-body">${content}<div class="form-error" id="dialog-error" role="alert" hidden></div></div>
    <div class="dialog-actions">${button('close-dialog', handler ? '취소' : '닫기', { extra: danger ? 'autofocus' : '' })}
      ${handler ? `<button type="submit" class="button primary${danger ? ' danger' : ''}">${submitLabel}</button>` : ''}</div>
  </form>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!handler) return;
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const errorMessage = form.querySelector('#dialog-error');
    errorMessage.hidden = true;
    try {
      await handler(new FormData(form));
      if (dialog.contains(form)) dialog.close();
      render();
    } catch (error) {
      errorMessage.hidden = false;
      errorMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });
  dialog.showModal();
  if (scrollBody) dialog.querySelector('.dialog-body').scrollTop = 0;
}


function zoneOptions(selected = state.timezone) {
  return [...new Set([state.timezone, 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/Paris', 'America/Los_Angeles', 'UTC', selected])]
    .map(zone => `<option ${zone === selected ? 'selected' : ''}>${escapeHtml(zone)}</option>`).join('');
}

function eventFormFields(subcategory, event) {
  return `<label>${subcategory ? '소분류 이름' : '이벤트명'}<input name="name" autofocus required maxlength="60"
      placeholder="${subcategory ? '예시 · 해변 식당' : '예시 · 제주 여행'}" value="${escapeHtml(event?.name || '')}"></label>
    ${subcategory ? '' : '<p class="small muted">폴더명에 시작일(YYMMDD_)이 자동으로 붙습니다. 이름이 같은 날짜로 시작하면 한 번만 붙습니다.</p>'}
    ${subcategory ? '' : `<div class="date-grid">
      <label>시작일<input name="start" type="date" required value="${escapeHtml(event?.start || '')}"></label>
      <label>종료일<input name="end" type="date" required value="${escapeHtml(event?.end || '')}"></label>
    </div>
    <label>촬영일 기준 시간대<select name="zone">${zoneOptions(event?.zone)}</select></label>`}`;
}

function createEventDialog(parent) {
  showDialog(parent ? '소분류 추가' : '이벤트 생성', eventFormFields(Boolean(parent)),
    parent ? '소분류 만들기' : '생성하고 파일 모으기', async form => {
    const payload = Object.fromEntries(form);
    if (parent) payload.parent_id = parent.id;
    const result = await api('events', 'POST', payload);
    chooseEvent(result.event.id);
    await syncState();
    announce(parent ? '소분류를 만들었습니다.' : collectionMessage(result.collection));
  });
}

function editEventDialog(event) {
  if (!event) return;
  showDialog(event.parent ? '소분류 수정' : '이벤트 수정', `${eventFormFields(Boolean(event.parent), event)}
    <p class="small muted">변경한 이름과 시작일에 맞춰 보낼 항목 (로컬) 폴더명과 이후 업로드 경로가 바뀝니다. 이미 예약한 업로드와 OMV에 저장된 폴더는 기존 경로를 유지합니다.</p>`,
  '변경 저장', async form => {
    await api(`events/${event.id}`, 'PUT', Object.fromEntries(form));
    view.eventDate = '';
    view.sourcePath = [];
    view.sourceSelection.clear();
    view.dragSource = null;
    await syncState();
    announce(event.parent ? '소분류를 수정했습니다.' : '이벤트를 수정했습니다.');
  });
}

function deleteEventDialog(event) {
  if (!event) return;
  const parent = eventById(event.parent);
  const children = childEvents(event.id).length;
  const name = escapeHtml(eventLabel(event));
  const eventType = parent ? '소분류' : '이벤트';
  const destination = parent ? `상위 이벤트 <strong>${escapeHtml(eventLabel(parent))}</strong>로 이동해 초안 상태가 됩니다` : '미배정으로 돌아갑니다';
  showDialog(`${eventType} 삭제`, `<p><strong>${name}</strong> ${eventType}${children ? `와 하위 소분류 ${children}개` : ''}를 삭제합니다.</p>
    <p>배정된 사진과 영상은 ${destination}. 원본은 로컬 보관함에 그대로 유지됩니다.</p>`,
  `${eventType} 삭제`, async () => {
    const result = await api(`events/${event.id}`, 'DELETE');
    chooseEvent(result.parentId || 'unassigned');
    view.sourcePath = [];
    await syncState();
    announce(`${eventType} 삭제를 완료했습니다.${result.affectedFiles ? ` ${result.affectedFiles}개 파일의 배정을 변경했습니다.` : ''}`);
  }, { danger: true });
}

function editMedia(ids = [...view.eventSelection], suggestSource = false) {
  const selectedIds = new Set(ids);
  const files = state.managed.filter(file => selectedIds.has(file.id));
  if (!files.length) return;
  const devices = [...new Set(state.managed.map(file => file.device).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hasMetadata = files.every(file => file.timeCandidates?.metadata);
  const xmpFiles = files.filter(file => file.timeCandidates?.xmp);
  const hasXmp = xmpFiles.length > 0;
  const hasModified = files.every(file => file.timeCandidates?.modified);
  const metadataLabel = files.every(file => file.kind === 'photo') ? 'EXIF 시각 사용' : '메타데이터 시각 사용';
  const mode = suggestSource && hasXmp ? 'xmp' : suggestSource && hasMetadata ? 'metadata' : suggestSource && hasModified ? 'modified' : suggestSource ? 'manual' : 'keep';
  const event = eventById(view.eventId);
  const root = event?.parent ? eventById(event.parent) : event;
  const defaultZone = root?.zone || state.timezone;
  showDialog('장비·촬영 시각 수정', `
    <p class="small muted">선택한 파일 ${files.length}개에 적용합니다.</p>
    <label>촬영 장비<select id="media-device" name="device_choice">
      <option value="">변경하지 않음</option>${devices.map(device => `<option value="device:${escapeHtml(device)}">${escapeHtml(device)}</option>`).join('')}
      <option value="custom">직접 입력</option>
    </select></label>
    <label id="media-custom-device" hidden>새 촬영 장비<input name="device" maxlength="80" placeholder="예시 · GoPro 또는 unknown" disabled></label>
    <label>촬영 시각 출처<select id="media-time-mode" name="time_mode">
      <option value="keep" ${mode === 'keep' ? 'selected' : ''}>변경하지 않음</option>
      <option value="manual" ${mode === 'manual' ? 'selected' : ''}>직접 입력</option>
      <option value="metadata" ${mode === 'metadata' ? 'selected' : ''} ${hasMetadata ? '' : 'disabled'}>${metadataLabel}${hasMetadata ? '' : ' (사용 가능한 값 없음)'}</option>
      <option value="xmp" ${mode === 'xmp' ? 'selected' : ''} ${hasXmp ? '' : 'disabled'}>XMP 시각 사용 (${xmpFiles.length}/${files.length}개 가능)</option>
      <option value="modified" ${mode === 'modified' ? 'selected' : ''} ${hasModified ? '' : 'disabled'}>파일 수정 시각 사용</option>
    </select></label>
    <div class="date-grid" id="media-time-fields">
      <label id="media-manual-time">촬영 시각<input type="datetime-local" name="captured_at"></label>
      <label id="media-time-zone">촬영 시간대<select name="zone">${zoneOptions(defaultZone)}</select></label>
    </div>
    <p id="media-time-note" class="small muted" role="status" hidden></p>
    <div id="media-xmp-preview" hidden><p class="small muted">파일별 XMP 촬영 시각</p><ul class="preview-paths"></ul></div>`,
  '변경 저장', async form => {
    const timeMode = form.get('time_mode');
    const payload = { ids: files.map(file => file.id), zone: form.get('zone') || defaultZone };
    const choice = form.get('device_choice');
    const device = choice === 'custom' ? (form.get('device') || '').trim() : choice.startsWith('device:') ? choice.slice(7) : '';
    if (choice === 'custom' && !device) throw new Error('새 촬영 장비 이름을 입력하세요.');
    const time = form.get('captured_at');
    if (device) payload.device = device;
    if (timeMode === 'manual' && time) payload.captured_at = time;
    if (!['keep', 'manual'].includes(timeMode)) payload.time_mode = timeMode;
    if (timeMode === 'xmp') payload.skip_missing_xmp = true;
    const result = await api('media', 'PATCH', payload);
    view.eventSelection.clear();
    view.eventDevice = '';
    view.eventDate = '';
    await syncState();
    announce(timeMode === 'xmp' ? `선택한 파일을 수정했습니다. XMP 시각 ${result.timeUpdated}개 적용 · ${result.timeSkipped}개 기존 시각 유지.` : '선택한 파일의 정보를 수정했습니다.');
  });
  const deviceControl = dialog.querySelector('#media-device');
  const customField = dialog.querySelector('#media-custom-device');
  const deviceInput = customField.querySelector('input');
  const submit = dialog.querySelector('[type="submit"]');
  const modeControl = dialog.querySelector('#media-time-mode');
  const dateField = dialog.querySelector('#media-manual-time');
  const zoneField = dialog.querySelector('#media-time-zone');
  const zoneControl = zoneField.querySelector('select');
  const note = dialog.querySelector('#media-time-note');
  const preview = dialog.querySelector('#media-xmp-preview');
  function updateSubmit() {
    const hasDevice = deviceControl.value === 'custom' ? Boolean(deviceInput.value.trim()) : deviceControl.value.startsWith('device:');
    const hasTime = modeControl.value === 'manual' ? Boolean(dateField.querySelector('input').value) : modeControl.value !== 'keep';
    submit.disabled = !(hasDevice || hasTime);
  }
  function updateTimeFields() {
    const mode = modeControl.value;
    const metadataMode = mode === 'metadata' || mode === 'xmp';
    const candidates = mode === 'xmp' ? xmpFiles : files;
    dateField.hidden = mode !== 'manual';
    zoneField.hidden = ['keep', 'modified'].includes(mode) || (metadataMode && candidates.every(file => file.timeCandidates[mode].verified));
    dateField.querySelector('input').disabled = dateField.hidden;
    zoneControl.disabled = zoneField.hidden;
    dialog.querySelector('#media-time-fields').hidden = dateField.hidden && zoneField.hidden;
    note.hidden = ['keep', 'manual'].includes(mode);
    preview.hidden = mode !== 'xmp';
    updateSubmit();
    if (note.hidden) return;
    if (mode === 'xmp') {
      note.textContent = `XMP 시각 ${xmpFiles.length}개 적용 · ${files.length - xmpFiles.length}개 기존 시각 유지. 파일마다 해당 XMP 시각을 사용하며, 시간대가 없는 값에는 ${zoneControl.value}를 적용합니다.`;
      preview.querySelector('ul').innerHTML = files.map(file => {
        const candidate = file.timeCandidates?.xmp;
        const detail = candidate ? `${candidate.raw || candidate.time} · ${file.xmp?.date?.field || 'XMP'}${candidate.verified ? '' : ` · ${zoneControl.value}`}` : file.xmp ? 'XMP에 촬영 시각 없음 · 기존 시각 유지' : 'XMP 없음 · 기존 시각 유지';
        return `<li>${escapeHtml(file.name)} — ${escapeHtml(detail)}</li>`;
      }).join('');
    } else if (files.length > 1) {
      note.textContent = mode === 'modified' ? '파일마다 해당 파일의 수정 시각을 사용합니다.' :
        '파일마다 메타데이터에 기록된 시각을 사용합니다. 시간대 정보가 없는 파일에는 선택한 시간대를 적용합니다.';
    } else if (mode === 'modified') {
      note.textContent = `파일 수정 시각 ${dateTimeFormatter(defaultZone).format(new Date(files[0].timeCandidates.modified))} · ${defaultZone}`;
    } else {
      const candidate = files[0].timeCandidates[mode];
      note.textContent = candidate.verified ? `${candidate.source} ${candidate.raw || candidate.time}` :
        `${candidate.source} ${candidate.raw} · ${zoneControl.value}로 해석`;
    }
  }
  deviceControl.addEventListener('change', () => {
    customField.hidden = deviceControl.value !== 'custom';
    deviceInput.disabled = customField.hidden;
    deviceInput.required = !customField.hidden;
    updateSubmit();
  });
  deviceInput.addEventListener('input', updateSubmit);
  dateField.querySelector('input').addEventListener('input', updateSubmit);
  modeControl.addEventListener('change', updateTimeFields);
  zoneControl.addEventListener('change', updateTimeFields);
  updateTimeFields();
}

function showXmp(id) {
  const file = state.managed.find(item => item.id === id);
  if (!file?.xmp) return;
  const { name, title, description, date, keywords, location, city, region, country, latitude, longitude, error } = file.xmp;
  const fields = {
    '파일': name, '촬영 시각': date?.raw, '제목': title, '설명': description,
    '키워드': keywords?.join(', '), '장소': [location, city, region, country].filter(Boolean).join(', '),
    'GPS': [latitude, longitude].filter(Boolean).join(', '), '분석 상태': error,
  };
  showDialog('XMP 정보', `<dl class="xmp-data">${Object.entries(fields).filter(([, value]) => value)
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('')}</dl>`);
}

function chooseEvent(id) {
  if (view.eventId !== id) page.querySelector('#event-rows')?.scrollTo(0, 0);
  view.eventId = id;
  view.eventSelection.clear();
  view.eventLifecycle = 'all';
  view.eventMenuOpen = false;
  view.eventDevice = '';
  view.eventDate = '';
  view.eventQuery = '';
  view.eventTarget = '';
}

function updateEventActions() {
  const target = page.querySelector('#move-event-target');
  if (target) {
    target.value = view.eventTarget || '';
    setDisabled(page.querySelector('[data-action="move-event"]'), exclusiveActive() || !target.value || !view.eventSelection.size);
  }
}



function navBadgeInfo(id) {
  if (id === 'incoming') return { count: state.incoming.filter(file => ['ready', 'duplicate', 'review'].includes(file.status)).length + state.pendingXmp.filter(file => file.status === 'pending').length, label: '대기 항목', muted: true };
  if (id === 'events') return { count: footageForEvent('unassigned').length, label: '미배정', muted: true };
  if (id === 'archive') return { count: sourceFiles().filter(file => !file.archived || (Boolean(file.xmp) && !file.xmpArchived)).length, label: '아카이브 대기', muted: true };
  if (id === 'jobs') return { count: lanes.filter(lane => activeLaneJob(lane)).length + (view.deviceUpload.running ? 1 : 0), label: '진행 중', muted: false };
  return null;
}

function renderNavigation() {
  setSlotHtml(nav, navigationGroups.map(group => `<div class="nav-group" role="group" aria-labelledby="nav-group-${group.id}"><div class="nav-group-label" id="nav-group-${group.id}">${group.label}</div>${navigation.filter(item => item.group === group.id).map(item => {
    const badge = navBadgeInfo(item.id);
    return `<a class="nav-link" href="#${item.id}"${item.id === view.page ? ' aria-current="page"' : ''}>${item.step ? `<span class="nav-step" aria-hidden="true">${item.step}</span>` : icon(item.icon)}<span class="nav-label">${item.title}</span>${badge?.count > 0 ? `<span class="nav-badge${badge.muted ? ' nav-badge-muted' : ''}" aria-label="${badge.label} ${badge.count}건" title="${badge.count}건">${badge.count > 99 ? '99+' : badge.count}</span>` : ''}</a>`;
  }).join('')}</div>`).join(''));
}
function render() {
  const windowScroll = window.scrollY || 0;
  const catalogScroll = page.querySelector('.catalog-table-wrap, .catalog-cards');
  const catalogScrollPosition = catalogScroll ? { top: catalogScroll.scrollTop, left: catalogScroll.scrollLeft } : null;
  const folderScroll = page.querySelector('.catalog-folder-list')?.scrollTop || 0;
  const active = document.activeElement;
  const selection = active?.tagName === 'INPUT' ? { start: active.selectionStart, end: active.selectionEnd } : null;
  const keepFocus = active && page.contains(active);
  const route = location.hash.slice(1);
  const current = navigation.find(item => item.id === route) || navigation[0];
  const pageChanged = view.page !== current.id;
  if (pageChanged) view.eventMenuOpen = false;
  const views = { archive: archivePage, catalog: catalogPage, settings: settingsPage };
  view.page = current.id;
  renderNavigation();
  const status = view.loadError ? `<p class="scan-strip" role="alert">${escapeHtml(view.loadError)}</p>` : '';
  const existingMain = page.querySelector('main');
  const inPlace = !pageChanged && existingMain?.dataset.page === view.page && ['incoming', 'events', 'jobs'].includes(view.page);
  if (view.page === 'incoming') {
    if (!inPlace) mountIncomingPage();
    patchIncomingPage();
  } else if (view.page === 'events') {
    if (!inPlace) mountEventsPage();
    patchEventsPage();
  } else if (view.page === 'jobs') {
    if (view.jobsTab === 'archives') page.innerHTML = `<main data-page="jobs-archives">${jobsTabs()}<div id="jobs-panel" role="tabpanel" aria-labelledby="jobs-tab-archives">${catalogPage()}</div></main>`;
    else { if (!inPlace || !page.querySelector('#jobs-list')) mountJobsPage(); patchJobsPage(); }
  } else {
    page.innerHTML = `<main aria-labelledby="page-title">${activeJobsBar()}${status}${views[view.page]()}</main>`;
  }
  document.title = `${current.title} · Photo Saver`;
  if (view.page === 'archive') syncSourceSelection();
  syncStickyActionBar();
  if (pageChanged) {
    pendingPreviewFocus = null;
    window.scrollTo(0, 0);
    return;
  }
  if (recordBrowserVisible()) window.scrollTo(0, windowScroll);
  if (catalogScrollPosition) page.querySelector('.catalog-table-wrap, .catalog-cards')?.scrollTo(catalogScrollPosition);
  page.querySelector('.catalog-folder-list')?.scrollTo(0, folderScroll);
  if (pendingPreviewFocus) {
    const focusIntent = pendingPreviewFocus;
    pendingPreviewFocus = null;
    if (!view.preview) {
      restorePreviewFocus(focusIntent);
      return;
    }
  }
  if (keepFocus && !page.contains(active)) {
    const replacement = [...page.querySelectorAll('button, input, select')].find(element => {
      if (active.id) return element.id === active.id;
      if (active.dataset.action) return element.dataset.action === active.dataset.action && element.dataset.value === active.dataset.value;
      if (active.dataset.xmpId) return element.dataset.xmpId === active.dataset.xmpId;
      return active.dataset.select && element.dataset.select === active.dataset.select && element.value === active.value;
    });
    if (replacement) {
      replacement.focus({ preventScroll: true });
      if (selection && selection.start != null && typeof replacement.setSelectionRange === 'function') {
        try { replacement.setSelectionRange(selection.start, selection.end); } catch { /* Some input types do not support ranges. */ }
      }
    } else if (active.dataset?.action === 'preview-managed' && view.page === 'events') {
      restorePreviewFocus({ source: 'managed', returnFocus: { source: 'managed', id: active.dataset.value, eventId: view.eventId } });
    } else if (active.dataset?.action === 'preview-incoming' && view.page === 'incoming') {
      restorePreviewFocus({ source: 'incoming', returnFocus: { source: 'incoming', id: active.dataset.value, eventId: null } });
    }
  }
}

function toggleSelection(selection, ids, checked) {
  for (const id of ids) {
    if (checked) selection.add(id);
    else selection.delete(id);
  }
}

function updateIncomingSearch(value) {
  view.query = value;
  pruneIncomingSelection();
  setSlotHtml(page.querySelector('#incoming-filters'), incomingFilters());
  patchIncomingRows();
  syncIncomingSelection();
}

function syncSourceSelection() {
  const entries = sourceEntries();
  const busy = remoteBusy() || view.uploadStarting;
  for (const input of page.querySelectorAll('[data-select="source"]')) {
    const keys = entries[Number(input.value)]?.assets || [];
    const selected = keys.length > 0 && keys.every(key => view.sourceSelection.has(key));
    setChecked(input, selected);
    input.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !selected;
    setDisabled(input, busy);
    setClass(input.closest('.tree-row'), 'source-selected', selected);
  }
  const keys = entries.flatMap(entry => entry.assets);
  const selected = keys.length > 0 && keys.every(key => view.sourceSelection.has(key));
  const all = page.querySelector('[data-select="source-all"]');
  setChecked(all, selected);
  if (all) all.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !selected;
  setDisabled(all, !keys.length || busy);
  const count = page.querySelector('#source-selection-count');
  const label = `${view.sourceSelection.size}개 파일 선택`;
  if (count && count.textContent !== label) count.textContent = label;
  setDisabled(page.querySelector('[data-action="upload-archive"]'), busy || !view.archive || view.archiveBusy || !view.sourceSelection.size);
  setSlotHtml(page.querySelector('#archive-preview-slot'), archivePreviewPanel());
}

function handleSelection(control) {
  const kind = control.dataset.select;
  const id = control.value;
  if (kind === 'incoming' || kind === 'incoming-all') {
    const ids = kind === 'incoming' ? [id] : filteredIncoming().filter(canSelectIncoming).map(file => file.id);
    toggleSelection(view.incomingSelection, ids, control.checked);
    syncIncomingSelection();
  } else if (kind === 'source' || kind === 'source-all') {
    const entries = sourceEntries();
    const keys = kind === 'source-all' ? entries.flatMap(entry => entry.assets) : entries[Number(id)]?.assets || [];
    toggleSelection(view.sourceSelection, keys, control.checked);
    syncSourceSelection();
  } else {
    const ids = kind === 'event' ? [id] : filteredEventFiles(footageForEvent(view.eventId)).map(file => file.id);
    toggleSelection(view.eventSelection, ids, control.checked);
    syncEventSelection();
  }
}


async function moveEvent() {
  const target = eventById(view.eventTarget);
  if (!target || !view.eventSelection.size) return;
  const result = await api('placements', 'POST', { ids: [...view.eventSelection], event_id: target.id });
  chooseEvent(target.id);
  await syncState();
  announce(`${result.count}개 파일을 ${target.name}에 배정했습니다.`);
}

function confirmDeleteIncoming() {
  const photos = selectedIncoming(canDeleteIncoming);
  if (!photos.length) return;
  showDialog('선택한 사진 삭제', `<p>아래 사진 ${photos.length}개를 incoming에서 영구 삭제합니다.</p>
    <ul class="preview-paths mono">${photos.map(file => `<li>${escapeHtml(incomingPath(file))}</li>`).join('')}</ul>`,
  `사진 ${photos.length}개 삭제`, () => submitJob('delete', { ids: photos.map(file => file.id) }), { danger: true });
}

function cleanupTargets(group, keeper) {
  if (!keeper) return [];
  return group.files.filter(file => keeper.kind !== 'incoming' || file.id !== keeper.id);
}

function cleanupGroupFiles(group, keeper, filesById) {
  const targets = new Set(cleanupTargets(group, keeper).map(file => file.id));
  return `<ul class="cleanup-files">${group.files.map(file => {
    const companions = filesById.get(file.id)?.companions || [];
    const action = targets.has(file.id) ? '정리' : keeper ? '남김' : '보류';
    return `<li><span class="incoming-path">${escapeHtml(file.path)}</span>
      <span class="small muted">${action} · ${sizeLabel(file.sizeBytes == null ? null : file.sizeBytes / 1e6)}</span>
      ${companions.map(item => `<div class="small muted incoming-path">${escapeHtml(item.path)} · ${item.disposition === 'linked' ? '연결됨' : 'Incoming에 보존'}
        ${item.reason ? ` · ${escapeHtml(item.reason)}` : ''}</div>`).join('')}
    </li>`;
  }).join('')}</ul>`;
}

async function confirmIncomingCleanup() {
  const selected = selectedIncoming(file => file.status === 'duplicate');
  if (!selected.length || localBusy() || view.cleanupPlanning) return;
  const filesById = new Map(selected.map(file => [file.id, file]));
  view.cleanupPlanning = true;
  renderIncomingActions();
  let cleanupPlan;
  try {
    cleanupPlan = await api('incoming/duplicates/plan', 'POST', { ids: [...filesById.keys()] });
  } catch (error) {
    if (error.status === 409) await syncState();
    throw error;
  } finally {
    view.cleanupPlanning = false;
    renderIncomingActions();
  }
  const { groups } = cleanupPlan;
  const current = new Set(selectedIncoming(file => file.status === 'duplicate').map(file => file.id));
  if (view.page !== 'incoming' || localBusy() || dialog.open || mediaPreview.open ||
      [...filesById.keys()].some(id => !current.has(id))) return;

  const keepers = groups.map(group => group.keepers[0]);
  const targetItems = () => groups.flatMap((group, index) => {
    const keeper = keepers[index];
    return cleanupTargets(group, keeper).map(file => ({ id: file.id, keeperKind: keeper.kind, keeperId: keeper.id }));
  });
  const blocked = groups.reduce((sum, group) => sum + (group.keepers.length ? 0 : group.files.length), 0);
  const summary = () => {
    const targets = groups.flatMap((group, index) => cleanupTargets(group, keepers[index]));
    const totalBytes = targets.reduce((sum, file) => sum + (file.sizeBytes || 0), 0);
    return `정리 ${targets.length}개 · ${sizeLabel(totalBytes / 1e6)}${blocked ? ` · 보류 ${blocked}개` : ''}`;
  };
  const keeperLabel = keeper => {
    const verified = keeper.verifiedAt ? ` · 최근 검증 ${catalogTime(keeper.verifiedAt)}` : '';
    return escapeHtml(`${keeperLabels[keeper.kind]} · ${keeper.path}${verified}`);
  };
  showDialog('중복 파일 정리', `<p>남길 사본을 다시 검증한 뒤 선택한 Incoming 파일을 영구 삭제합니다. Incoming에 남아 있는 XMP와 카메라 보조 파일은 보존합니다.</p>
    <p id="cleanup-summary" class="numbers" role="status">${summary()}</p>
    <div class="cleanup-groups">${groups.map((group, index) => `<section class="cleanup-group" aria-label="중복 묶음 ${index + 1}">
      ${group.keepers.length > 1 ? `<label>남길 사본<select data-keeper-group="${index}" aria-describedby="keeper-detail-${index}">${group.keepers.map((keeper, option) => `<option value="${option}">${keeperLabel(keeper)}</option>`).join('')}</select></label>` : ''}
      ${keepers[index] ? `<p id="keeper-detail-${index}" class="small incoming-path">${group.keepers.length === 1 ? '<strong>남길 사본</strong> ' : ''}${keeperLabel(keepers[index])}</p>` : ''}
      ${group.reason || !keepers[index] ? `<p class="small muted">${escapeHtml(group.reason || '남길 사본을 찾지 못했습니다.')}</p>` : ''}
      <div data-cleanup-group-files="${index}">${cleanupGroupFiles(group, keepers[index], filesById)}</div>
    </section>`).join('')}</div>`,
  '검증 후 정리', targetItems().length ? () => submitJob('duplicate-cleanup', { items: targetItems() }) : null, { danger: true, scrollBody: true });

  for (const select of dialog.querySelectorAll('[data-keeper-group]')) {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.keeperGroup);
      keepers[index] = groups[index].keepers[Number(select.value)];
      dialog.querySelector(`#keeper-detail-${index}`).innerHTML = keeperLabel(keepers[index]);
      dialog.querySelector(`[data-cleanup-group-files="${index}"]`).innerHTML = cleanupGroupFiles(groups[index], keepers[index], filesById);
      dialog.querySelector('#cleanup-summary').textContent = summary();
    });
  }
}

function previewCollection(source) {
  if (source === 'catalog') {
    const files = (view.catalog?.rows || []).map((row, index) => ({ ...row, id: catalogRowKey(row, index), kind: row.media_kind || row.kind, thumbnail_status: catalogThumbnailStatus(row) }));
    const detached = view.preview?.source === 'catalog' ? view.preview.detachedCatalogFile : null;
    if (detached && !files.some(file => file.id === detached.id)) files.push(detached);
    return files;
  }
  return source === 'managed' ? state.managed : state.incoming;
}

function isPreviewableFile(source, file) {
  if (source === 'catalog') return Boolean(file && file.kind !== 'xmp');
  if (!file || !file.preview) return false;
  return source === 'managed' ? file.status === 'available' : true;
}

function currentPreviewFile(preview = view.preview) {
  if (!preview) return null;
  const id = preview.ids[preview.index];
  if (!id) return null;
  return previewCollection(preview.source).find(file => file.id === id) || null;
}

function previewEventLabel(file) {
  if (!file.eventId) return '미배정';
  const event = eventById(file.eventId);
  if (!event) return '';
  if (event.parent) {
    const parent = eventById(event.parent);
    return parent ? `${eventLabel(parent)} / ${eventLabel(event)}` : eventLabel(event);
  }
  return eventLabel(event);
}

function previewMetaHtml(source, file) {
  if (source === 'catalog') return `<span>${escapeHtml(file.remote_path || file.target || file.download_path || file.local_path || file.name)}</span> · ${sizeLabel(file.size == null ? null : file.size / 1e6)}`;
  if (source === 'managed') {
    const eventName = previewEventLabel(file);
    return `<span class="mono">${escapeHtml(`managed/${file.path}`)}</span> · ${sizeLabel(file.size)}${eventName ? ` · 이벤트: ${escapeHtml(eventName)}` : ''}`;
  }
  return `<span class="mono">${escapeHtml(`incoming/${incomingPath(file)}`)}</span> · ${sizeLabel(file.size)}
    ${incomingReason(file) ? `<span class="preview-detail">${escapeHtml(incomingReason(file))}</span>` : ''}
    ${companionSummary(file) ? `<span class="preview-detail">${escapeHtml(companionSummary(file))}</span>` : ''}`;
}

function defaultPreviewErrorMessage(source) {
  if (source === 'managed') {
    return '미리보기를 열 수 없습니다. 브라우저에서 지원하지 않는 형식이거나 원본을 읽을 수 없습니다. 원본 열기로 확인하거나 다시 시도하세요.';
  }
  return '미리보기를 열 수 없습니다. 원본을 열거나 가져오기에서 파일을 다시 검사하세요.';
}

function diagnosticMessageForStatus(source, file, status) {
  if (status === 404) {
    return source === 'managed'
      ? '로컬 원본을 찾을 수 없습니다. 원본이 이동·비우기 되었는지 확인하거나 가져오기에서 다시 검사하세요.'
      : '원본 파일을 찾을 수 없습니다. 가져오기에서 다시 검사하세요.';
  }
  if (status === 403) return '로컬 원본의 읽기 권한이 없습니다. 파일·폴더 권한을 확인하세요.';
  if (status === 409) return '원본 파일이 변경되었습니다. 원본을 확인한 뒤 가져오기에서 다시 검사하세요.';
  if (status === 415) return '미리보기를 지원하지 않는 파일 형식입니다. 원본 열기로 확인하세요.';
  if (status === 200 || status === 206) {
    return file.kind === 'video'
      ? '브라우저에서 이 영상 코덱을 재생할 수 없거나 파일이 손상되었습니다. 원본 열기로 확인하세요.'
      : '사진을 표시하거나 변환할 수 없습니다. 원본을 확인한 뒤 다시 검사하거나 원본 열기로 확인하세요.';
  }
  return defaultPreviewErrorMessage(source);
}

function disposePreviewMedia() {
  previewMediaGeneration += 1;
  for (const video of mediaPreview.querySelectorAll('video')) {
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      // Ignore cleanup errors on detached or stubbed video elements.
    }
  }
  mediaPreview.replaceChildren();
}

function restorePreviewFocus(closing) {
  if (!closing) return;
  const source = closing.returnFocus?.source || closing.source;
  const currentId = closing.ids?.[closing.index];
  const originalId = closing.returnFocus?.id;
  if (source === 'catalog' && recordBrowserVisible()) {
    const buttons = [...page.querySelectorAll('[data-action="preview-catalog"]')];
    (buttons.find(element => element.dataset.value === currentId) || page.querySelector('#catalog-query'))?.focus({ preventScroll: true });
    return;
  }
  if (source === 'incoming' && view.page === 'incoming') {
    const buttons = [...page.querySelectorAll('[data-action="preview-incoming"]')];
    const target = buttons.find(element => element.dataset.value === currentId)
      || buttons.find(element => element.dataset.value === originalId)
      || page.querySelector('[data-action="incoming-layout"][aria-pressed="true"]')
      || page.querySelector('#file-search');
    target?.focus({ preventScroll: true });
    return;
  }
  if (source === 'managed' && view.page === 'events') {
    const buttons = [...page.querySelectorAll('[data-action="preview-managed"]')];
    const eventId = closing.returnFocus?.eventId;
    const target = buttons.find(element => element.dataset.value === originalId)
      || buttons.find(element => element.dataset.value === currentId)
      || page.querySelector('#event-search')
      || (eventId ? [...page.querySelectorAll('[data-action="choose-event"]')].find(element => element.dataset.value === eventId) : null)
      || page.querySelector('[data-action="choose-event"][aria-current="true"]');
    target?.focus({ preventScroll: true });
  }
}

function closeMediaPreview({ restoreFocus = true, deferFocus = false } = {}) {
  const closing = view.preview;
  if (!restoreFocus) pendingPreviewFocus = null;
  if (!closing && !mediaPreview.open) return;
  disposePreviewMedia();
  view.preview = null;
  if (mediaPreview.open) mediaPreview.close();
  if (restoreFocus && closing) {
    if (deferFocus) {
      pendingPreviewFocus = closing;
    } else {
      pendingPreviewFocus = null;
      restorePreviewFocus(closing);
    }
  }
}

function openMediaPreview(source, id, ids, returnFocus = null) {
  const index = ids.indexOf(id);
  if (index < 0) return;
  pendingPreviewFocus = null;
  disposePreviewMedia();
  view.preview = {
    source,
    ids: [...ids],
    index,
    confirming: false,
    busy: false,
    jobId: null,
    deletingId: null,
    message: '',
    renderedSrc: null,
    renderedKind: null,
    returnFocus: returnFocus || { source, id, eventId: source === 'managed' ? view.eventId : null },
  };
  renderMediaPreview();
}

function openIncomingPreview(id) {
  const ids = filteredIncoming().filter(file => file.preview).map(file => file.id);
  openMediaPreview('incoming', id, ids, { source: 'incoming', id, eventId: null });
}

function openManagedPreview(id) {
  const ids = filteredEventFiles(footageForEvent(view.eventId))
    .filter(file => isPreviewableFile('managed', file))
    .map(file => file.id);
  openMediaPreview('managed', id, ids, { source: 'managed', id, eventId: view.eventId });
}

function openCatalogPreview(key) {
  const ids = previewCollection('catalog').filter(file => isPreviewableFile('catalog', file)).map(file => file.id);
  openMediaPreview('catalog', key, ids, { source: 'catalog', id: key, tab: view.catalogTab });
}

function catalogPreviewStage(file) {
  if (file.has_local_original && file.preview) return null;
  if (file.thumbnail_status === 'ready') return `<div class="preview-stage is-cached-thumb"><img class="preview-cached-img" src="${escapeHtml(file.thumbnail)}" alt="${escapeHtml(file.name)}"><span class="status draft preview-cache-badge">캐시 썸네일 미리보기</span><p class="small muted">로컬 원본이 없어 서버 캐시 썸네일(360×240)을 표시합니다.${file.kind === 'video' ? ' 브라우저 재생을 하려면 NAS 원본을 다운로드하세요.' : ''}</p></div>`;
  const generating = file.thumbnail_status === 'generating';
  return `<div class="preview-stage is-empty-thumb"><div role="status">${icon(file.kind === 'video' ? 'video' : 'photo')}<p>${generating ? '썸네일을 생성하고 있습니다…' : file.thumbnail_status === 'unavailable' ? '로컬 원본과 활성 NAS 사본이 없어 썸네일을 생성할 수 없습니다.' : escapeHtml(file.thumbnail_error || '썸네일이 아직 없습니다.')}</p>${file.can_generate_thumbnail || generating ? button('generate-preview-thumb', generating ? '생성 중…' : ['failed', 'skipped_large'].includes(file.thumbnail_status) ? '다시 시도' : '지금 썸네일 생성', { disabled: generating }) : ''}</div></div>`;
}

function renderMediaPreview({ focusTitle = true } = {}) {
  const preview = view.preview;
  const file = currentPreviewFile(preview);
  if (!preview || !file) return;
  if (preview.source === 'catalog') preview.catalogSnapshot = { ...file };
  disposePreviewMedia();
  const gen = previewMediaGeneration;
  const name = escapeHtml(file.name);
  const src = file.preview ? escapeHtml(file.preview) : '';
  const dataAttrs = `data-preview-gen="${gen}" data-preview-source="${preview.source}" data-preview-id="${escapeHtml(file.id)}"`;
  const media = !src ? '' : file.kind === 'photo'
    ? `<img src="${src}" alt="${name}" decoding="async" ${dataAttrs}>`
    : `<video src="${src}" ${file.thumbnail ? `poster="${escapeHtml(file.thumbnail)}"` : ''} controls preload="metadata" playsinline ${dataAttrs}></video>`;
  const metaHtml = previewMetaHtml(preview.source, file);
  const errorOriginal = file.original ? `<a class="button" href="${escapeHtml(file.original)}" target="_blank" rel="noopener">원본 열기</a>` : '';
  mediaPreview.innerHTML = `<div class="preview-frame">
    <header class="preview-header"><div class="preview-title"><h2 id="media-preview-title" tabindex="-1">${name}</h2>
      <p class="small muted preview-meta">${metaHtml}</p></div>
      ${smallButton('close-preview', '미리보기 닫기', 'close')}</header>
    <div class="preview-stage${src ? '' : ' is-error'}">
      ${media}
      ${src ? '<p class="preview-media-loading" role="status">원본 불러오는 중…</p>' : ''}
      <div class="preview-media-error" role="status" ${src ? 'hidden' : ''}>
        <p class="preview-error-message">${escapeHtml(defaultPreviewErrorMessage(preview.source))}</p>
        <div class="preview-error-actions">
          ${button('retry-preview', '다시 시도', { glyph: 'refresh' })}
          ${errorOriginal}
        </div>
      </div>
    </div>
    <footer class="preview-footer"></footer>
  </div>`;
  const metaEl = mediaPreview.querySelector('.preview-meta');
  if (metaEl) metaEl.dataset.renderedHtml = metaHtml;
  preview.renderedSrc = file.preview || null;
  preview.renderedKind = file.kind || null;
  if (preview.source === 'catalog') {
    preview.renderedStage = file.thumbnail_status;
    preview.renderedThumb = file.thumbnail;
    const stage = catalogPreviewStage(file);
    if (stage) {
      const element = mediaPreview.querySelector('.preview-stage');
      element.setAttribute('class', file.thumbnail_status === 'ready' ? 'preview-stage is-cached-thumb' : 'preview-stage is-empty-thumb');
      element.innerHTML = stage.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '');
    }
  }
  renderPreviewFooter();
  if (!mediaPreview.open) mediaPreview.showModal();
  if (focusTitle) mediaPreview.querySelector('#media-preview-title')?.focus();
}

function updatePreviewMetadata() {
  const preview = view.preview;
  const file = currentPreviewFile(preview);
  if (!preview || !file) return;
  const titleEl = mediaPreview.querySelector('#media-preview-title');
  if (titleEl && titleEl.textContent !== file.name) titleEl.textContent = file.name;
  const metaEl = mediaPreview.querySelector('.preview-meta');
  if (metaEl) {
    const nextMetaHtml = previewMetaHtml(preview.source, file);
    if (metaEl.dataset.renderedHtml !== nextMetaHtml) {
      metaEl.dataset.renderedHtml = nextMetaHtml;
      metaEl.innerHTML = nextMetaHtml;
    }
  }
  renderPreviewFooter();
}

function renderPreviewFooter() {
  const preview = view.preview;
  const file = currentPreviewFile(preview);
  const footer = mediaPreview.querySelector('.preview-footer');
  if (!preview || !file || !footer) return;
  const isIncoming = preview.source === 'incoming';
  const canDelete = isIncoming && canDeleteIncoming(file) && !localBusy();
  const counter = `<span class="numbers preview-count">${preview.index + 1} / ${preview.ids.length}</span>`;
  if (isIncoming && (preview.confirming || preview.busy)) {
    const html = `<p role="status">${preview.busy ? '사진을 삭제하고 있습니다.' :
      `<strong>${escapeHtml(file.name)}</strong> 파일을 incoming에서 영구 삭제합니다.`}</p>
      <div class="preview-controls">
        ${button('cancel-preview-delete', '취소', { disabled: preview.busy })}
        ${button('perform-preview-delete', '사진 삭제', { primary: true, danger: true, disabled: preview.busy })}
      </div>`;
    if (footer.dataset.renderedHtml !== html) {
      footer.dataset.renderedHtml = html;
      footer.innerHTML = html;
      if (!preview.busy) footer.querySelector('[data-action="cancel-preview-delete"]')?.focus();
    }
    return;
  }
  const original = file.original ? `<a class="button" href="${escapeHtml(file.original)}" target="_blank" rel="noopener">원본 열기</a>` : '';
  const selected = view.incomingSelection.has(file.id);
  const selection = isIncoming && canSelectIncoming(file) ? button('toggle-preview-selection', '이 파일 선택', {
    disabled: localBusy(), extra: `aria-pressed="${selected}"`,
  }) : '';
  const hint = preview.message
    ? escapeHtml(preview.message)
    : preview.source === 'catalog' ? '<kbd>←</kbd> <kbd>→</kbd> 이동' : isIncoming
      ? `<kbd>←</kbd> <kbd>→</kbd> 이동${canDelete ? ' · <kbd>Delete</kbd> 삭제' : ''}`
      : '닫은 뒤 선택 항목을 분류할 수 있습니다 · <kbd>←</kbd> <kbd>→</kbd> 이동';
  const html = `<div class="preview-controls" role="group" aria-label="파일 이동">
      ${button('previous-preview', '이전', { glyph: 'left', disabled: preview.index === 0 })}${counter}
      ${button('next-preview', '다음', { glyph: 'right', disabled: preview.index === preview.ids.length - 1 })}
    </div>
    <div class="preview-controls">
      ${original}${preview.source === 'catalog' ? `${file.can_download ? `<a class="button" href="/api/archive/download?path=${encodeURIComponent(file.remote_path || file.target || file.download_path)}" target="_blank" rel="noopener">NAS 원본 다운로드</a>` : ''}${button('preview-catalog-detail', '상세 정보')}` : ''}${selection}${canDelete ? button('request-preview-delete', '사진 삭제', { glyph: 'trash', danger: true }) : ''}
    </div>
    <p class="preview-hint small muted" ${preview.message ? 'role="status"' : ''}>${hint}</p>`;
  if (footer.dataset.renderedHtml !== html) {
    footer.dataset.renderedHtml = html;
    footer.innerHTML = html;
  }
}

function stepPreview(direction) {
  const preview = view.preview;
  if (!preview || preview.confirming || preview.busy) return;
  const next = preview.index + direction;
  if (next < 0 || next >= preview.ids.length) return;
  preview.index = next;
  preview.message = '';
  renderMediaPreview();
}

function isPendingPreviewDelete(preview) {
  if (!preview || preview.source !== 'incoming' || !preview.busy) return false;
  if (!preview.jobId) return true;
  return Boolean(laneJob('local')?.id === preview.jobId && isJobActive(laneJob('local')));
}

function reconcilePreview({ preserveMessage = false } = {}) {
  const preview = view.preview;
  if (!preview || isPendingPreviewDelete(preview)) return;
  if (preview.source === 'catalog' && view.catalogScope === 'no_thumbnail') {
    const snapshot = preview.catalogSnapshot;
    const currentId = preview.ids[preview.index];
    const stillListed = view.catalog?.rows.some((row, index) => catalogRowKey(row, index) === currentId);
    const generated = snapshot?.id === currentId && lanes.some(lane => {
      const job = laneJob(lane);
      return job?.kind.startsWith('thumbnails-') && !isJobActive(job)
        && job.result?.items?.some(item => item.sha === snapshot.sha && ['generated', 'reused'].includes(item.status));
    });
    if (!stillListed && generated) {
      preview.detachedCatalogFile = { ...snapshot, thumbnail_status: 'ready', thumbnail_error: '', can_generate_thumbnail: false,
        thumbnail: `/thumbnails/${snapshot.sha}-v1.jpg` };
    }
  }
  const collection = previewCollection(preview.source);
  const byId = new Map(collection.map(file => [file.id, file]));
  const currentId = preview.ids[preview.index];
  const nextIds = preview.ids.filter(id => isPreviewableFile(preview.source, byId.get(id)));
  if (!nextIds.length) {
    closeMediaPreview({ deferFocus: true });
    announce('로컬 미리보기 가능한 파일이 없습니다.');
    return;
  }
  const survivingIndex = nextIds.indexOf(currentId);
  if (survivingIndex >= 0) {
    const currentFile = byId.get(currentId);
    const mediaChanged = preview.renderedSrc !== (currentFile.preview || null) || preview.renderedKind !== (currentFile.kind || null)
      || (preview.source === 'catalog' && (preview.renderedStage !== currentFile.thumbnail_status || preview.renderedThumb !== currentFile.thumbnail));
    preview.ids = nextIds;
    preview.index = survivingIndex;
    if (mediaChanged) renderMediaPreview({ focusTitle: false });
    else updatePreviewMetadata();
    return;
  }
  let removedBefore = 0;
  for (let i = 0; i < preview.index; i += 1) {
    if (!isPreviewableFile(preview.source, byId.get(preview.ids[i]))) removedBefore += 1;
  }
  preview.ids = nextIds;
  preview.index = Math.max(0, Math.min(preview.index - removedBefore, nextIds.length - 1));
  preview.confirming = false;
  preview.busy = false;
  if (!preserveMessage) preview.message = '';
  renderMediaPreview();
}

async function diagnosePreviewError(source, file, gen) {
  try {
    const response = await fetch(file.original, { method: 'HEAD', cache: 'no-store' });
    if (gen !== previewMediaGeneration) return;
    const preview = view.preview;
    if (!preview || preview.source !== source || preview.ids[preview.index] !== file.id) return;
    const messageEl = mediaPreview.querySelector('.preview-error-message');
    if (!messageEl) return;
    const detail = diagnosticMessageForStatus(source, file, response.status);
    if (detail && messageEl.textContent !== detail) messageEl.textContent = detail;
  } catch {
    // Keep the default error message when diagnostic HEAD fails.
  }
}

async function retryPreview() {
  const preview = view.preview;
  if (!preview || preview.busy) return;
  const { source } = preview;
  const id = preview.ids[preview.index];
  const gen = previewMediaGeneration;
  await syncState();
  render();
  if (!view.preview || view.preview !== preview) return;
  if (view.preview.source !== source || view.preview.ids[view.preview.index] !== id) return;
  if (gen !== previewMediaGeneration) return;
  renderMediaPreview({ focusTitle: false });
}

function requestPreviewDelete() {
  const preview = view.preview;
  if (!preview || preview.source !== 'incoming' || preview.busy || localBusy()) return;
  const file = currentPreviewFile(preview);
  if (!file || !canDeleteIncoming(file)) return;
  preview.confirming = true;
  renderPreviewFooter();
}

function togglePreviewSelection() {
  const file = currentPreviewFile();
  if (view.preview?.source !== 'incoming' || !file || !canSelectIncoming(file) || localBusy()) return;
  toggleSelection(view.incomingSelection, [file.id], !view.incomingSelection.has(file.id));
  if (view.page === 'incoming') syncIncomingSelection();
  else render();
  renderPreviewFooter();
  mediaPreview.querySelector('[data-action="toggle-preview-selection"]')?.focus();
}

function cancelPreviewDelete() {
  const preview = view.preview;
  if (!preview || preview.source !== 'incoming' || preview.busy) return;
  preview.confirming = false;
  renderPreviewFooter();
  mediaPreview.querySelector('[data-action="request-preview-delete"]')?.focus();
}

async function performPreviewDelete() {
  const preview = view.preview;
  if (!preview || preview.source !== 'incoming' || !preview.confirming || preview.busy || localBusy()) return;
  const file = currentPreviewFile(preview);
  if (!file || !canDeleteIncoming(file)) return;
  preview.busy = true;
  preview.deletingId = file.id;
  renderPreviewFooter();
  mediaPreview.querySelector('#media-preview-title')?.focus();
  try {
    await submitJob('delete', { ids: [file.id] }, preview);
  } catch (error) {
    preview.busy = false;
    preview.confirming = false;
    preview.jobId = null;
    preview.deletingId = null;
    preview.message = error.message;
    if (view.preview === preview) renderPreviewFooter();
  }
  render();
}

function updatePreviewAfterDelete() {
  const preview = view.preview;
  const job = laneJob('local');
  if (!preview || preview.source !== 'incoming' || !preview.jobId) return false;
  const trackedJobId = preview.jobId;
  if (job?.id === trackedJobId && jobActive(job)) return false;
  const deletingId = preview.deletingId;
  preview.busy = false;
  preview.confirming = false;
  preview.jobId = null;
  preview.deletingId = null;
  if (job?.id !== trackedJobId) return false;
  if (job.status === 'done' && job.result?.deleted) {
    const removedIndex = deletingId ? preview.ids.indexOf(deletingId) : -1;
    if (removedIndex >= 0) {
      preview.ids.splice(removedIndex, 1);
      if (!preview.ids.length) {
        closeMediaPreview({ deferFocus: true });
        return false;
      }
      if (removedIndex < preview.index) preview.index -= 1;
      else if (preview.index >= preview.ids.length) preview.index = preview.ids.length - 1;
    } else if (!preview.ids.length) {
      closeMediaPreview({ deferFocus: true });
      return false;
    }
    preview.message = '선택한 사진을 삭제했습니다.';
    if (currentPreviewFile(preview)) renderMediaPreview();
    return true;
  }
  preview.message = job.status === 'failed'
    ? (job.result?.error || '사진을 삭제하지 못했습니다.')
    : '사진이 변경되었거나 삭제할 수 없습니다. 다시 검사한 뒤 확인하세요.';
  renderPreviewFooter();
  return true;
}

const previewActions = {
  'generate-preview-thumb': () => actions['generate-preview-thumb'](),
  'preview-catalog-detail': () => actions['preview-catalog-detail'](),
  'previous-preview': () => stepPreview(-1),
  'next-preview': () => stepPreview(1),
  'close-preview': () => closeMediaPreview(),
  'retry-preview': retryPreview,
  'toggle-preview-selection': togglePreviewSelection,
  'request-preview-delete': requestPreviewDelete,
  'cancel-preview-delete': cancelPreviewDelete,
  'perform-preview-delete': performPreviewDelete,
};

function confirmEvent() {
  const files = footageForEvent(view.eventId).filter(file => view.eventSelection.has(file.id) && file.status === 'available' && !file.confirmed);
  if (!files.length) return;
  showDialog('분류 확정', `<p>확정한 파일 ${files.length}개가 아카이브 전송의 보낼 항목 (로컬)에 표시됩니다.</p>
    <ul class="preview-paths mono">${files.map(file => `<li>${escapeHtml([...sourceFolders(file), file.name].join('/'))}</li>`).join('')}</ul>`,
  '분류 확정', async () => {
    await api('placements/confirm', 'POST', { ids: files.map(file => file.id) });
    view.eventSelection.clear();
    await syncState();
    announce('선택한 분류를 확정했습니다.');
  });
}

function confirmOffload() {
  const files = filteredEventFiles(footageForEvent(view.eventId)).filter(file => view.eventSelection.has(file.id) && file.canOffload);
  if (!files.length) return;
  showDialog('NAS 보관 후 로컬 비우기', `<p>원격 아카이브에 파일 존재·크기를 실시간 확인한 뒤 아래 ${files.length}개 파일의 로컬 <code>managed</code> 원본(및 연결된 XMP)을 삭제합니다.</p>
    <p>썸네일, 메타데이터, XMP 정보, 이벤트 배정은 DB에 그대로 유지되며 언제든 다시 다운로드할 수 있습니다. 원격에 없거나 크기가 다르면 삭제하지 않고 유지합니다.</p>
    <ul class="preview-paths mono">${files.map(file => `<li>${escapeHtml(file.name)}${file.xmp ? ` (+ ${escapeHtml(file.xmp.name)})` : ''} → ${escapeHtml(file.remotePaths[0] || '')}</li>`).join('')}</ul>`,
  `NAS 보관 후 로컬 비우기 (${files.length})`, async () => {
    const result = await api('jobs/offload', 'POST', { ids: files.map(file => file.id) });
    setOptimisticJob({ id: result.id, kind: 'offload', status: 'queued', result: {} });
    view.eventSelection.clear();
    await syncState();
    announce(`${result.count}개 파일의 원격 확인 및 NAS 보관 후 로컬 비우기를 시작합니다.`);
  }, { danger: true });
}

const actions = {
  'catalog-view'(value) { view.catalogView = value === 'cards' ? 'cards' : 'table'; storePreference('photo-saver-catalog-view', view.catalogView); render(); },
  'preview-catalog': openCatalogPreview,
  'open-catalog-detail-dialog': openCatalogDetailDialog,
  'preview-catalog-detail'() { if (view.preview) openCatalogDetailDialog(view.preview.ids[view.preview.index]); },
  'generate-catalog-thumb': generateCatalogThumbnail,
  'generate-preview-thumb'() { const file = currentPreviewFile(); if (file && file.thumbnail_status !== 'generating') return generateCatalogThumbnail(file.sha); },
  'open-thumbnail-batch': openThumbnailBatchDialog,
  'refresh-thumbnail-stats': loadThumbnailStats,
  'cleanup-orphan-thumbnails'() { return thumbnailCacheOperation('cleanup'); },
  'reset-thumbnail-failures'() { return thumbnailCacheOperation('reset-failures'); },
  async 'cancel-thumbnail-job'(id) { await api(`jobs/thumbnails/${id}/cancel`, 'POST'); await syncState(); },
  'incoming-tab'(value) {
    if (!['files', 'xmp', 'companions'].includes(value)) return;
    view.incomingTab = value;
    if (view.page === 'incoming') patchIncomingPage();
  },
  'clear-incoming-selection'() { view.incomingSelection.clear(); syncIncomingSelection(); },
  'clear-event-selection'() { view.eventSelection.clear(); syncEventSelection(); },
  'source-jump'(value) {
    const depth = Math.max(0, Math.min(view.sourcePath.length, Number(value) || 0));
    if (depth === view.sourcePath.length) return;
    view.sourcePath = view.sourcePath.slice(0, depth);
    view.sourceSelection.clear();
  },
  'dismiss-result': dismissResult,
  'dismiss-upload-result'() {
    const upload = view.deviceUpload;
    if (upload.running) return;
    Object.assign(upload, { dismissedBatchId: upload.batchId, results: [], scanNote: '', totalFiles: 0, completedFiles: 0, totalBytes: 0, uploadedBytes: 0 });
  },
  'refresh-jobs'() { return loadJobs({ silent: true, preserveLoaded: true }); },
  'load-more-jobs'() { if (!view.jobs.loadingMore && view.jobs.hasMore) return loadJobs({ more: true }); },
  'jobs-status-filter'(filter) { view.jobs.statusFilter = filter; return loadJobs({ reset: true }); },
  'open-incoming'() { location.hash = 'incoming'; },
  'open-events'() { location.hash = 'events'; },
  'open-job-archives': openArchiveHistory,
  'all-archives'() { return openArchiveHistory(); },
  'jobs-tab'(tab) { if (tab === 'archives') return openArchiveHistory(view.catalogJobId); ++catalogRequest; view.jobsTab = 'list'; render(); return view.jobs.items.length ? Promise.resolve() : loadJobs({reset:true}); },
  'open-catalog-tab'(tab) { if (tab === 'archives') return openArchiveHistory(); cancelCatalogSearchDebounce(); view.catalogExpandedRows.clear(); view.catalogTab = tab; view.catalogScope = 'all'; view.catalogPage = 1; view.catalog = null; if (location.hash === '#catalog') return loadCatalog(); location.hash = 'catalog'; },
  'reset-catalog-filters'() {
    view.catalogExpandedRows.clear();
    cancelCatalogSearchDebounce(); view.catalogQuery = ''; view.catalogUploadResult = 'all'; view.catalogScope = 'all'; view.catalogPage = 1;
    view.catalogEvent = 'all'; view.catalogDevice = ''; view.catalogRemoteFolder = '';
    return loadCatalog({ soft: true });
  },
  scan() { return submitJob('scan'); },
  'rescan-incoming'() { return submitJob('scan'); },
  'incoming-filter'(value) { view.incomingFilter = value; pruneIncomingSelection(); },
  'reset-incoming-filters'() {
    view.query = ''; view.incomingKind = ''; view.incomingFilter = 'all';
    pruneIncomingSelection();
  },
  'incoming-layout'(value) {
    if (view.incomingLayout === value) return;
    view.incomingLayout = value;
    page.querySelector('#incoming-rows').scrollTo(0, 0);
    try {
      localStorage.setItem('photo-saver-incoming-layout', value);
    } catch {
      // The current page still retains the setting when storage is unavailable.
    }
  },
  'preview-incoming': openIncomingPreview,
  'event-view'(value) {
    if (!['table', 'cards'].includes(value) || view.eventView === value) return;
    view.eventView = value;
    page.querySelector('#event-rows')?.scrollTo(0, 0);
    try { localStorage.setItem('photo-saver-event-view', value); } catch { /* Keep the in-memory preference. */ }
  },
  'preview-managed': openManagedPreview,
  'move-incoming'() { return submitJob('move', { ids: selectedIncoming(file => file.status === 'ready').map(file => file.id) }); },
  'delete-incoming': confirmDeleteIncoming,
  'cleanup-incoming': confirmIncomingCleanup,
  'open-unassigned'() { chooseEvent('unassigned'); location.hash = 'events'; },
  'link-xmp'() { return submitJob('xmp-link', { links: pendingXmpLinks() }); },
  'view-xmp': showXmp,
  'refresh-devices': loadDevices,
  'edit-storage-address': editStorageAddress,
  'edit-storage-root': editStorageRoot,
  'generate-storage-key': generateStorageKey,
  'regenerate-storage-key': regenerateStorageKey,
  'copy-public-key': copyStorageKey,
  'reset-host-key': confirmResetHostKey,
  'test-storage-ssh': testStorageSsh,
  'download-catalog': downloadCatalog,
  'pick-catalog-file'() { page.querySelector('#restore-catalog-file').click(); },
  'restore-catalog': confirmCatalogRestore,
  'reset-catalog': confirmCatalogReset,
  'choose-event': chooseEvent,
  'event-lifecycle'(value) {
    if (!['all', 'draft', 'confirmed', 'archived'].includes(value)) return;
    const next = value !== 'all' && view.eventLifecycle === value ? 'all' : value;
    if (next === view.eventLifecycle) return;
    view.eventLifecycle = next;
    view.eventSelection.clear();
  },
  'reset-event-filters'() {
    view.eventLifecycle = 'all';
    view.eventDevice = '';
    view.eventDate = '';
    view.eventQuery = '';
    view.eventSelection.clear();
  },
  'new-event'() { createEventDialog(); },
  'new-child'() { closeEventMenu(); createEventDialog(eventById(view.eventId)); },
  'edit-event'() { closeEventMenu(); editEventDialog(eventById(view.eventId)); },
  'delete-event'() { closeEventMenu(); deleteEventDialog(eventById(view.eventId)); },
  async collect() {
    const result = await api(`events/${view.eventId}/collect`, 'POST');
    await syncState();
    announce(collectionMessage(result));
  },
  'move-event': moveEvent,
  'edit-media'() { editMedia(); },
  'offload-media': confirmOffload,
  'edit-media-time'(id) {
    const file = state.managed.find(item => item.id === id);
    if (!file || file.status === 'archived') return;
    editMedia([id], !file.timeVerified);
  },
  'resolve-time'(id) {
    const file = state.managed.find(item => item.id === id);
    if (!file || file.status === 'archived') return;
    editMedia([id], true);
  },
  'confirm-event': confirmEvent,
  'open-source'(value) { view.sourcePath.push(sourceEntries()[Number(value)].name); view.sourceSelection.clear(); },
  'source-up'() { view.sourcePath.pop(); view.sourceSelection.clear(); },
  'upload-archive'() { return startArchiveUpload(); },
  async 'cancel-archive-upload'(value) {
    const jobId = Number(value) || activeLaneJob('remote')?.id;
    if (!jobId) return;
    setOptimisticJob(await api(`archive/transfers/${jobId}/cancel`, 'POST'));
    await syncState();
  },
  'open-remote-index': openRemoteIndexDialog,
  async 'cancel-remote-index'(value) {
    const jobId = Number(value) || activeLaneJob('remote')?.id;
    if (!jobId) return;
    setOptimisticJob(await api(`archive/index/${jobId}/cancel`, 'POST'));
    await syncState();
  },
  'catalog-folder'(value) {
    view.catalogExpandedRows.clear();
    const folder = JSON.parse(value);
    view.catalogEvent = folder.event; view.catalogDevice = folder.device; view.catalogPage = 1;
    view.catalogExpanded.add(folder.event);
    return loadCatalog();
  },
  'toggle-catalog-folder'(id) { if (view.catalogExpanded.has(id)) view.catalogExpanded.delete(id); else view.catalogExpanded.add(id); },
  'catalog-remote-folder'(folder) {
    view.catalogExpandedRows.clear();
    view.catalogRemoteFolder = folder; view.catalogPage = 1;
    if (folder && folder !== '__root__') {
      const parts = folder.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i += 1) {
        view.catalogRemoteExpanded.add(parts.slice(0, i).join('/'));
      }
    }
    return loadCatalog();
  },
  'toggle-remote-folder'(folder) { if (view.catalogRemoteExpanded.has(folder)) view.catalogRemoteExpanded.delete(folder); else view.catalogRemoteExpanded.add(folder); },
  'refresh-catalog': loadCatalog,
  'catalog-tab'(tab) { view.catalogExpandedRows.clear(); view.catalogTab = tab; view.catalogScope = 'all'; view.catalogPage = 1; return loadCatalog(); },
  'catalog-page'(value) { view.catalogExpandedRows.clear(); view.catalogPage = Math.max(1, Number(value)); return loadCatalog(); },
  'toggle-catalog-detail'(key) { if (view.catalogExpandedRows.has(key)) view.catalogExpandedRows.delete(key); else view.catalogExpandedRows.add(key); },
  async 'copy-record-hash'(value) { await copyTextToClipboard(value); announce('SHA-256을 복사했습니다.'); },
  'connect-archive'() { return browseArchive(); },
  'open-archive'(value) {
    const entry = view.archive?.entries[Number(value)];
    if (entry?.kind === 'folder') return browseArchive([view.archivePath, entry.name].filter(Boolean).join('/'));
  },
  'archive-up'() { return browseArchive(view.archivePath.split('/').slice(0, -1).join('/')); },
};

page.addEventListener('click', async event => {
  const control = event.target.closest('button[data-action]');
  if (!control || control.disabled) return;
  if (control.dataset.action === 'toggle-event-menu') {
    view.eventMenuOpen = !view.eventMenuOpen;
    syncEventMenu();
    return;
  }
  if (control.dataset.action === 'choose-incoming-upload-files') {
    // Safari requires the picker to open inside the original user gesture.
    if (!view.deviceUpload.running && !exclusiveActive() && !view.connecting) page.querySelector('#incoming-upload-input')?.click();
    return;
  }
  if (control.dataset.action === 'toggle-incoming-upload') {
    view.deviceUpload.open = !view.deviceUpload.open;
    render();
    return;
  }
  if (control.dataset.action === 'cancel-incoming-upload') { await cancelIncomingUpload(); return; }
  const wasDisabled = control.disabled;
  try {
    control.disabled = true;
    await actions[control.dataset.action](control.dataset.value);
  } catch (error) {
    announce(error.message);
  } finally {
    // In browsers, assigning .disabled also adds the disabled attribute.
    control.disabled = wasDisabled;
    if (!dialog.open && !mediaPreview.open) render();
  }
});

const archiveDragType = 'application/x-photo-saver';

page.addEventListener('dragover', event => {
  const zone = event.target.closest('[data-incoming-upload-drop]');
  if (!zone || view.dragSource || view.deviceUpload.running || exclusiveActive()) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  zone.classList.add('is-dragover');
});
page.addEventListener('dragleave', event => {
  const zone = event.target.closest('[data-incoming-upload-drop]');
  if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
});
page.addEventListener('drop', async event => {
  const zone = event.target.closest('[data-incoming-upload-drop]');
  if (!zone || view.dragSource) return;
  event.preventDefault();
  zone.classList.remove('is-dragover');
  if (view.deviceUpload.running || exclusiveActive()) return;
  try { await startIncomingUpload(await collectIncomingDrop(event.dataTransfer)); }
  catch (error) { announce('파일을 읽지 못했습니다. ' + error.message); }
});

function clearArchiveDrag() {
  view.dragSource = null;
  page.classList.remove('source-dragging');
  page.querySelectorAll('.archive-drop-hover').forEach(element => element.classList.remove('archive-drop-hover'));
}

page.addEventListener('dragstart', event => {
  const row = event.target.closest('[data-source-index]');
  if (!row || remoteBusy() || view.uploadStarting) return;
  const entry = sourceEntries()[Number(row.dataset.sourceIndex)];
  if (!entry) return;
  const keys = entry.assets.every(key => view.sourceSelection.has(key)) ? [...view.sourceSelection] : entry.assets;
  view.dragSource = { keys, source: [...view.sourcePath] };
  event.dataTransfer.setData(archiveDragType, JSON.stringify(view.dragSource));
  event.dataTransfer.effectAllowed = 'copy';
  page.classList.add('source-dragging');
});

page.addEventListener('dragover', event => {
  const target = event.target.closest('[data-archive-drop]');
  if (!target || !view.dragSource || remoteBusy() || view.uploadStarting) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  page.querySelectorAll('.archive-drop-hover').forEach(element => {
    if (element !== target) element.classList.remove('archive-drop-hover');
  });
  target.classList.add('archive-drop-hover');
});

page.addEventListener('dragleave', event => {
  const target = event.target.closest('[data-archive-drop]');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('archive-drop-hover');
});

page.addEventListener('dragend', clearArchiveDrag);
page.addEventListener('drop', async event => {
  const target = event.target.closest('[data-archive-drop]');
  if (!target || !view.dragSource) return;
  event.preventDefault();
  const drag = view.dragSource;
  const destination = target.dataset.archiveDrop;
  clearArchiveDrag();
  try {
    await startArchiveUpload(drag.keys, drag.source, destination);
  } catch (error) {
    announce(error.message);
  } finally {
    render();
  }
});

page.addEventListener('submit', event => {
  if (event.target.id !== 'catalog-search') return;
  event.preventDefault();
  const form = new FormData(event.target);
  view.catalogQuery = String(form.get('query') || '');
  view.catalogScope = String(form.get('scope') || 'all');
  view.catalogPage = 1;
  cancelCatalogSearchDebounce(); loadCatalog({ soft: true });
});

page.addEventListener('change', event => {
  const control = event.target;
  if (control.id === 'incoming-upload-input') {
    const files = Array.from(control.files || []);
    control.value = '';
    startIncomingUpload(files).catch(error => announce(error.message));
  } else if (control.id === 'incoming-upload-folder') {
    view.deviceUpload.folder = control.value;
  } else if (control.id === 'incoming-upload-autoscan') {
    view.deviceUpload.autoScan = control.checked;
  } else if (control.id === 'catalog-scope') {
    cancelCatalogSearchDebounce();
    view.catalogScope = control.value;
    view.catalogPage = 1; loadCatalog({ soft: true });
  } else if (control.id === 'catalog-upload-result') {
    view.catalogUploadResult = control.value; view.catalogPage = 1; view.catalogExpandedRows.clear(); loadCatalog({soft:true});
  } else if (control.id === 'jobs-lane-filter') {
    view.jobs.laneFilter = control.value; loadJobs({ reset: true });
  } else if (control.dataset.select) {
    handleSelection(control);
  } else if (control.id === 'restore-catalog-file') {
    if (control.files[0]) view.restoreFile = control.files[0];
    render();
  } else if (control.dataset.xmpId) {
    view.xmpChoices.set(control.dataset.xmpId, control.value);
    render();
  } else if (control.id === 'incoming-kind') {
    view.incomingKind = control.value;
    pruneIncomingSelection();
    render();
  } else if (control.id === 'event-device') {
    view.eventDevice = control.value;
    view.eventSelection.clear();
    render();
  } else if (control.id === 'event-date') {
    view.eventDate = control.value;
    view.eventSelection.clear();
    render();
  } else if (control.id === 'move-event-target') {
    view.eventTarget = control.value;
    updateEventActions();
  }
});

page.addEventListener('toggle', event => {
  const el = event.target;
  if (el.dataset.resultDetails) view.resultDetailsOpen.set(el.dataset.resultDetails, el.open);
  if (el.dataset.jobHistoryKey) {
    if (el.open) view.jobsExpanded.add(el.dataset.jobHistoryKey);
    else view.jobsExpanded.delete(el.dataset.jobHistoryKey);
  }
}, true);
page.addEventListener('compositionstart', event => {
  if (event.target.id === 'catalog-query') { catalogComposing = true; cancelCatalogSearchDebounce(); }
});
page.addEventListener('compositionend', event => {
  if (event.target.id === 'catalog-query') { catalogComposing = false; view.catalogQuery = event.target.value; scheduleCatalogSearch(); }
});

page.addEventListener('input', event => {
  if (event.target.id === 'incoming-upload-folder') view.deviceUpload.folder = event.target.value;
});

page.addEventListener('input', event => {
  if (event.target.id === 'catalog-query') {
    view.catalogQuery = event.target.value;
    if (!event.isComposing && !catalogComposing) scheduleCatalogSearch();
    return;
  }
  if (event.target.id === 'event-search') {
    view.eventQuery = event.target.value;
    patchEventsPage();
    return;
  }
  if (event.target.id !== 'file-search') return;
  updateIncomingSearch(event.target.value);
});

document.body.addEventListener('click', event => {
  if (view.eventMenuOpen && !event.target.closest?.('#event-menu')) closeEventMenu();
});

document.body.addEventListener('keydown', event => {
  if (event.key === 'Escape' && view.eventMenuOpen && !dialog.open && !mediaPreview.open) {
    event.preventDefault();
    closeEventMenu({ restoreFocus: true });
  }
});

page.addEventListener('keydown', event => {
  const menuTrigger = event.target.closest('#event-menu-toggle');
  const menuItem = event.target.closest('#event-menu-panel [role="menuitem"]');
  if (menuTrigger && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    view.eventMenuOpen = true;
    syncEventMenu();
    const items = [...page.querySelectorAll('#event-menu-panel [role="menuitem"]')].filter(item => !item.disabled);
    items[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
    return;
  }
  if (menuItem && view.eventMenuOpen) {
    if (event.key === 'Tab') { closeEventMenu(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...page.querySelectorAll('#event-menu-panel [role="menuitem"]')].filter(item => !item.disabled);
      const index = items.indexOf(menuItem);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
      return;
    }
  }
  const incomingTab = event.target.closest('[role="tab"][data-action="incoming-tab"]');
  if (incomingTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const tabs = ['files', 'xmp', 'companions'], index = tabs.indexOf(incomingTab.dataset.value);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    actions['incoming-tab'](tabs[target]);
    page.querySelector(`#incoming-tab-${tabs[target]}`)?.focus();
    return;
  }
  const jobsTab = event.target.closest('[data-action="jobs-tab"]');
  if (jobsTab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
    event.preventDefault(); const target = event.key === 'Home' ? 'list' : event.key === 'End' ? 'archives' : jobsTab.dataset.value === 'list' ? 'archives' : 'list';
    Promise.resolve(actions['jobs-tab'](target)).then(() => page.querySelector(`#jobs-tab-${target}`)?.focus()); return;
  }
  const tab = event.target.closest('[role="tab"][data-action="catalog-tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const tabs = ['files', 'remote'], index = tabs.indexOf(tab.dataset.value);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    const loading = actions['catalog-tab'](tabs[target]);
    page.querySelector(`#catalog-tab-${tabs[target]}`)?.focus();
    loading.then(() => { if (recordBrowserVisible() && view.catalogTab === tabs[target]) page.querySelector(`#catalog-tab-${tabs[target]}`)?.focus(); });
    return;
  }
  const card = event.target.closest('[data-card-preview]');
  if (!card) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (card.dataset.action !== 'preview-incoming') return;
    const file = state.incoming.find(item => item.id === card.dataset.value);
    if (!file || !canDeleteIncoming(file) || localBusy()) return;
    event.preventDefault();
    if (!event.repeat) {
      openIncomingPreview(card.dataset.value);
      requestPreviewDelete();
    }
    return;
  }
  const grid = card.closest('.incoming-cards');
  if (!grid) return;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  const cards = [...grid.children];
  for (let index = cards.indexOf(card.closest('.incoming-card')) + direction; cards[index]; index += direction) {
    const next = cards[index].querySelector('[data-card-preview]');
    if (next) {
      next.focus();
      break;
    }
  }
});

function isEditableOrMediaTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'VIDEO' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}

mediaPreview.addEventListener('click', async event => {
  const action = event.target.closest('button[data-action]')?.dataset.action;
  if (action && previewActions[action]) {
    try { await previewActions[action](); }
    catch (error) { if (view.preview) view.preview.message = error.message; renderPreviewFooter(); announce(error.message); }
  }
});

mediaPreview.addEventListener('keydown', event => {
  const preview = view.preview;
  if (!preview || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (preview.source !== 'incoming' || isEditableOrMediaTarget(event.target)) return;
    const file = currentPreviewFile(preview);
    if (!file || !canDeleteIncoming(file) || localBusy()) return;
    event.preventDefault();
    if (!event.repeat && !preview.confirming) requestPreviewDelete();
  } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !isEditableOrMediaTarget(event.target)) {
    event.preventDefault();
    stepPreview(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

mediaPreview.addEventListener('cancel', event => {
  if (view.preview?.source === 'incoming' && view.preview.confirming && !view.preview.busy) {
    event.preventDefault();
    cancelPreviewDelete();
  }
});

mediaPreview.addEventListener('close', () => {
  if (mediaPreview.open) return;
  const closing = view.preview;
  disposePreviewMedia();
  if (!closing) return;
  view.preview = null;
  restorePreviewFocus(closing);
});

mediaPreview.addEventListener('error', event => {
  const target = event.target;
  if (!target?.matches?.('.preview-stage img, .preview-stage video')) return;
  const preview = view.preview;
  const gen = Number(target.dataset?.previewGen);
  if (!target.isConnected || !preview || gen !== previewMediaGeneration) return;
  const currentId = preview.ids[preview.index];
  if (target.dataset?.previewSource !== preview.source || target.dataset?.previewId !== currentId) return;
  target.hidden = true;
  target.parentElement?.classList?.add('is-error');
  target.parentElement?.querySelector('.preview-media-loading')?.remove();
  const errorBox = mediaPreview.querySelector('.preview-media-error');
  if (errorBox) errorBox.hidden = false;
  const file = currentPreviewFile(preview);
  if (file?.original) diagnosePreviewError(preview.source, file, gen);
}, true);

for (const type of ['load', 'loadedmetadata']) {
  mediaPreview.addEventListener(type, event => {
    const target = event.target;
    if (!target?.matches?.('.preview-stage img, .preview-stage video')) return;
    if (!target.isConnected || Number(target.dataset?.previewGen) !== previewMediaGeneration) return;
    target.parentElement?.querySelector('.preview-media-loading')?.remove();
  }, true);
}

dialog.addEventListener('click', async event => {
  const control = event.target.closest('button[data-action]');
  if (control?.dataset.action === 'close-dialog') dialog.close();
  else if (control?.dataset.action === 'open-job-archives') { dialog.close(); openArchiveHistory(control.dataset.value); }
  else if (control?.dataset.action === 'copy-record-hash') {
    try { await actions['copy-record-hash'](control.dataset.value); }
    catch (error) { announce(error.message); }
  }
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
function loadRoute() {
  cancelCatalogSearchDebounce(); catalogComposing = false;
  ++jobsRequest; view.jobs.busy = false; view.jobs.loadingMore = false;
  closeMediaPreview({ restoreFocus: false });
  ++catalogRequest;
  if (location.hash === '#catalog' && view.catalogTab === 'archives') { view.catalogTab = 'files'; view.catalog = null; view.catalogScope = 'all'; }
  if (location.hash === '#jobs' && view.jobsTab === 'archives') view.catalogTab = 'archives';
  render();
  if (recordBrowserVisible()) loadCatalog();
  if (view.page === 'jobs' && view.jobsTab === 'list') loadJobs({ reset: true });
  if (view.page === 'archive') maybeAutoConnectArchive();
  if (view.page === 'settings') loadSettings().then(() => {
    if (view.page === 'settings') render();
  });
}
window.addEventListener('hashchange', loadRoute);
page.addEventListener('error', event => {
  if (event.target.tagName === 'IMG') event.target.remove();
}, true);
loadRoute();
syncState().then(render);
