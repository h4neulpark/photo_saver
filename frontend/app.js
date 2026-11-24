'use strict';

const icons = {
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

const navigation = [
  { id: 'incoming', title: 'Incoming Library', icon: 'inbox' },
  { id: 'events', title: '이벤트 관리', icon: 'calendar' },
  { id: 'archive', title: '아카이브 전송', icon: 'transfer' },
  { id: 'catalog', title: '파일 기록', icon: 'file' },
  { id: 'settings', title: '설정', icon: 'settings' },
];



function dateTimeFormatter(timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function savedIncomingLayout() {
  try {
    return localStorage.getItem('photo-saver-incoming-layout') === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

const state = { incoming: [], managed: [], events: [], pendingXmp: [], scan: null, job: null, jobs: { local: null, remote: null, exclusive: null }, activeJobs: { local: null, remote: null, exclusive: null }, timezone: 'Asia/Seoul' };
const view = {
  page: '', incomingFilter: 'all', incomingKind: '', query: '', connecting: true, loadError: '',
  incomingLayout: savedIncomingLayout(), preview: null,
  incomingSelection: new Set(), eventId: 'unassigned', eventSelection: new Set(), eventStorage: '', eventDevice: '', eventDate: '',
  eventTarget: '', eventQuery: '', sourcePath: [], xmpChoices: new Map(),
  devices: null, devicesError: '', settings: null, settingsError: '', publicKeyToCopy: null, keyCopiedLocally: false, restoreFile: null,
  catalogOpBusy: false, sshTestBusy: false, sshTestResult: null,
  archive: null, archivePath: '', archiveBusy: false, archiveError: '',
  sourceSelection: new Set(), uploadStarting: false, dragSource: null,
  catalogEvent: 'all', catalogDevice: '', catalogExpanded: new Set(),
  catalogRemoteFolder: '', catalogRemoteExpanded: new Set(),
  catalog: null, catalogTab: 'files', catalogQuery: '', catalogScope: 'all', catalogPage: 1, catalogBusy: false, catalogError: '',
};
let refreshTimer;
let stateRequest = 0;
let catalogRequest = 0;
let devicesRequest = 0;
let previewMediaGeneration = 0;
let pendingPreviewFocus = null;

const page = document.getElementById('page');
const nav = document.getElementById('navigation');
const dialog = document.getElementById('dialog');
const mediaPreview = document.getElementById('media-preview');
const notice = document.getElementById('notice');
let noticeTimeout;


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
    const error = new Error(typeof result?.detail === 'string' ? result.detail : '요청을 처리하지 못했습니다.');
    error.status = response.status;
    error.data = result;
    throw error;
  }
  return result;
}

const jobLanes = { scan: 'local', move: 'local', delete: 'local', 'xmp-link': 'local', upload: 'remote', offload: 'remote', 'remote-index': 'remote', 'reset-all': 'exclusive' };
const lanes = ['local', 'remote', 'exclusive'];
function isJobActive(job) { return Boolean(job && ['queued', 'running'].includes(job.status)); }
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
  if (!anyJobActive()) return '';
  const labels = { local: '로컬', remote: '원격', exclusive: '데이터 초기화' };
  const kinds = { scan: '검사', move: '이동', delete: '삭제', 'xmp-link': 'XMP 연결', upload: '업로드', offload: '로컬 비우기', 'remote-index': '원격 인덱싱', 'reset-all': '초기화' };
  return `<div class="active-jobs-bar" aria-label="진행 중인 작업">${lanes.map(lane => {
    const job = activeLaneJob(lane);
    if (!job) return '';
    const result = job.result || {};
    const cancel = job.kind === 'upload' ? 'cancel-archive-upload' : job.kind === 'remote-index' ? 'cancel-remote-index' : null;
    return `<div class="active-job-pill"><span role="status">${labels[lane]} · ${kinds[job.kind] || job.kind} #${job.id} · ${escapeHtml(result.phase || (job.status === 'queued' ? '대기 중' : '진행 중'))}${result.totalFiles ? ` · ${result.completedFiles ?? result.processedFiles ?? 0}/${result.totalFiles}` : ''}</span>${cancel ? button(cancel, result.cancelRequested ? '중지 중…' : job.kind === 'upload' ? '업로드 중지' : '인덱싱 중지', { disabled: result.cancelRequested, extra: `data-value="${job.id}"` }) : ''}</div>`;
  }).join('')}</div>`;
}

function jobMessage(job) {
  if (job.status === 'cancelled') return job.result.error || '작업을 중지했습니다.';
  if (job.status === 'failed') return job.result.error;
  if (job.kind === 'upload') return `업로드 ${job.result.uploaded}개 완료 · 동일 파일 ${job.result.skipped}개 건너뜀`;
  if (job.kind === 'offload') return `로컬 원본 ${job.result.offloaded || 0}개를 비웠습니다.${job.result.failed ? ` 실패 ${job.result.failed}개.` : ''}`;
  if (job.kind === 'remote-index') return `원격 인덱싱 완료 · 신규 해시 ${job.result.hashed || 0}개 · 변경 없음 ${job.result.unchanged || 0}개${job.result.missing ? ` · 누락 ${job.result.missing}개` : ''}`;
  if (job.kind === 'scan') return `${job.result.checked}개 파일의 검사를 완료했습니다.`;
  if (job.kind === 'delete') return `사진 ${job.result.deleted}개를 삭제했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  if (job.kind === 'xmp-link') return `XMP ${job.result.linked}개를 연결했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  return `${job.result.moved}개를 managed로 옮겼습니다.${job.result.xmp ? ` XMP ${job.result.xmp}개 보관.` : ''}${job.result.auxDeleted ? ` THM·LRV ${job.result.auxDeleted}개 삭제.` : ''}${job.result.duplicate ? ` 중복 ${job.result.duplicate}개.` : ''}${job.result.review || job.result.companionReview ? ` 확인 필요 ${(job.result.review || 0) + (job.result.companionReview || 0)}개.` : ''}`;
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
    if (completed && view.page === 'catalog') await loadCatalog();
    const sourceKeys = new Set(sourceFiles().flatMap(sourceAssetKeys));
    for (const key of view.sourceSelection) if (!sourceKeys.has(key)) view.sourceSelection.delete(key);
    const selectable = new Set(state.incoming.filter(canSelectIncoming).map(file => file.id));
    for (const id of view.incomingSelection) {
      if (!selectable.has(id)) view.incomingSelection.delete(id);
    }
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
  if (['new-event', 'new-child', 'edit-event', 'delete-event', 'collect', 'move-event', 'edit-media', 'confirm-event', 'resolve-time'].includes(action)) disabled ||= exclusiveActive();
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
  const image = file.thumbnail ? `<img src="${escapeHtml(file.thumbnail)}" alt="" loading="lazy">` : '';
  const contents = `${icon(picture ? 'photo' : 'video')}${image}`;
  const canPreview = source === 'managed' ? file.status === 'available' && Boolean(file.preview) : Boolean(file.preview);
  if (interactive && canPreview) {
    const action = source === 'managed' ? 'preview-managed' : 'preview-incoming';
    const cardAttr = source === 'incoming' && card ? ' data-card-preview' : '';
    return `<button type="button" class="thumb" data-action="${action}" data-value="${escapeHtml(file.id)}"
      aria-label="${escapeHtml(file.name)} 미리보기"${cardAttr}>${contents}</button>`;
  }
  return `<span class="thumb">${contents}</span>`;
}

function fileCell(file, detail, interactive = false, source = 'incoming') {
  return `<div class="file-cell">
    ${fileThumbnail(file, interactive, false, source)}
    <div><strong>${escapeHtml(file.name)}</strong>${detail ? `<span class="small muted">${escapeHtml(detail)}</span>` : ''}</div>
  </div>`;
}

const filterLabels = { all: '전체', ready: '이동 가능', duplicate: '중복', review: '확인 필요' };

function canDeleteIncoming(file) {
  return file.kind === 'photo' && ['ready', 'duplicate'].includes(file.status);
}

function canSelectIncoming(file) {
  return file.status === 'ready' || canDeleteIncoming(file);
}

function selectedIncoming(predicate) {
  return state.incoming.filter(file => view.incomingSelection.has(file.id) && predicate(file));
}

function matchesXmp(file, query) {
  if (!file.xmp) return false;
  const { title, description, keywords, city, region, country, location, latitude, longitude, date, name } = file.xmp;
  return ['XMP', name, title, description, ...(keywords || []), city, region, country, location, latitude, longitude, date?.raw]
    .some(value => value?.toLocaleLowerCase().includes(query));
}

function companionSummary(file) {
  return [file.xmp ? 'XMP' : '', file.cameraAuxCount ? `이동 후 THM·LRV ${file.cameraAuxCount}개 삭제` : ''].filter(Boolean).join(' · ');
}

function filteredIncoming() {
  const query = view.query.trim().toLocaleLowerCase();
  return state.incoming.filter(file =>
    (view.incomingFilter === 'all' || file.status === view.incomingFilter) &&
    (!view.incomingKind || file.kind === view.incomingKind) &&
    (!query || file.name.toLocaleLowerCase().includes(query) || file.folder.toLocaleLowerCase().includes(query) || matchesXmp(file, query))
  );
}

function checkbox(kind, id, label, selection) {
  return `<input type="checkbox" data-select="${kind}" value="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" ${selection.has(id) ? 'checked' : ''}>`;
}

function incomingCards(files, selectAll) {
  return `${selectAll ? `<label class="card-select-all">${selectAll} 표시된 파일 모두 선택</label>` : ''}
    <ul class="incoming-cards" aria-label="Incoming 카드 목록">${files.map(file => `<li class="incoming-card${view.incomingSelection.has(file.id) ? ' selected' : ''}">
      <div class="card-image">
        ${fileThumbnail(file, true, true)}
        ${canSelectIncoming(file) ? `<label class="card-check">${checkbox('incoming', file.id, `${file.name} 선택`, view.incomingSelection)}</label>` : ''}
      </div>
      <div class="card-caption">
        <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
        <div class="card-info">${badge(file.status, filterLabels[file.status] || '삭제 중')}<span class="small muted numbers">${sizeLabel(file.size)}</span></div>
        ${file.reason ? `<p class="small muted card-reason">${escapeHtml(file.reason)}</p>` : ''}
        ${companionSummary(file) ? `<p class="small muted card-reason">${companionSummary(file)}</p>` : ''}
      </div>
    </li>`).join('')}</ul>`;
}

function incomingRows() {
  const files = filteredIncoming();
  if (!files.length) return emptyState('inbox', '표시할 파일이 없습니다.',
    state.scan ? '파일을 추가하거나 검사 결과 필터를 확인하세요.' : 'incoming에 사진이나 영상을 넣고 새로 고침하세요.');
  const available = files.filter(canSelectIncoming);
  const selectAll = available.length ? checkbox('incoming-all', 'all', '표시된 파일 모두 선택', new Set(available.every(file => view.incomingSelection.has(file.id)) ? ['all'] : [])) : '';
  if (view.incomingLayout === 'cards') return incomingCards(files, selectAll);
  return `<table aria-label="Incoming 검사 결과">
    <thead><tr>
      <th scope="col">${selectAll}</th>
      <th scope="col">파일</th><th scope="col">수정 일시</th><th scope="col">크기</th><th scope="col">검사 결과</th>
    </tr></thead>
    <tbody>${files.map(file => `<tr class="${view.incomingSelection.has(file.id) ? 'selected' : ''}">
      <td>${canSelectIncoming(file) ? checkbox('incoming', file.id, `${file.name} 선택`, view.incomingSelection) : ''}</td>
      <td>${fileCell(file, [file.folder, companionSummary(file)].filter(Boolean).join(' · '), true)}</td>
      <td class="numbers muted">${file.modifiedAt ? dateTimeFormatter(state.timezone).format(new Date(file.modifiedAt)) : '—'}</td>
      <td class="numbers">${sizeLabel(file.size)}</td>
      <td>${badge(file.status, filterLabels[file.status] || '삭제 중')}${file.reason ? `<div class="small muted file-reason">${escapeHtml(file.reason)}</div>` : ''}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function incomingActions() {
  const count = view.incomingSelection.size;
  const photos = selectedIncoming(canDeleteIncoming).length;
  const movable = selectedIncoming(file => file.status === 'ready').length;
  const moveLabel = movable && movable !== count ? `신규 ${movable}개를 managed로 이동` : '선택 항목을 managed로 이동';
  return `<span class="small muted">${count}개 선택됨${photos && photos !== count ? ` · 사진 ${photos}개` : ''}</span>
    <div>${button('delete-incoming', '사진 삭제', { glyph: 'trash', danger: true, disabled: !photos || localBusy() })}
    ${button('move-incoming', moveLabel, { glyph: 'arrow', primary: true, disabled: !movable || localBusy() })}</div>`;
}

function pendingXmpLinks() {
  return state.pendingXmp.filter(file => file.status === 'pending').map(file => ({
    id: file.id, media_id: view.xmpChoices.get(file.id) ?? file.recommended,
  })).filter(link => link.media_id);
}

function pendingXmpSection() {
  if (!state.pendingXmp.length) return '';
  const selected = pendingXmpLinks();
  const duplicated = new Set(selected.map(link => link.media_id)).size !== selected.length;
  return `<section class="surface xmp-section" aria-label="XMP 연결">
    <div class="surface-head"><h2>XMP 연결 <span class="small muted">${state.pendingXmp.length}개</span></h2></div>
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
  </section>`;
}

function incomingPage() {
  const results = state.incoming.filter(file => !view.incomingKind || file.kind === view.incomingKind);
  const job = activeLaneJob('exclusive') || laneJob('local');
  const active = isJobActive(job);
  const failed = job?.status === 'failed';
  const scanning = active && job.kind === 'scan';
  const jobLabels = {
    scan: 'incoming 검사 중', move: '선택한 파일 이동 및 분석 중', delete: '선택한 사진 삭제 중',
    'xmp-link': 'XMP 연결 중', upload: '아카이브 업로드 중', offload: '로컬 원본 비우기 중',
    'remote-index': '원격 아카이브 인덱싱 중', 'reset-all': '서버 데이터 초기화 중',
  };
  const status = active ? (jobLabels[job.kind] || '작업 진행 중') :
    failed ? '작업 실패' : state.scan ? '최근 검사 완료' : '검사 대기';
  const detail = failed ? job.result.error : active ? (scanning ? '중복을 확인하고 썸네일을 만들고 있습니다.' : '완료되면 결과에 반영됩니다.') :
    state.scan ? `${dateTimeFormatter(state.timezone).format(new Date(state.scan.finishedAt))} · ${state.scan.result.checked}개 검사` : '새로 고침을 눌러 검사를 시작하세요.';
  return `${header('Incoming Library', '사진과 영상을 검사하고 managed로 옮길 파일을 선택하세요.',
    button('scan', scanning ? '검사 중…' : '새로 고침', { glyph: 'refresh', disabled: localBusy() || view.connecting }))}
    <div class="scan-strip" role="status">
      <span>${icon(active ? 'refresh' : 'check')} ${status}</span>
      <span class="small">${escapeHtml(detail)}</span>
    </div>
    <section class="surface" aria-labelledby="incoming-title">
      <div class="surface-head"><h2 id="incoming-title">검사 결과</h2>
        <div class="view-switch" role="group" aria-label="보기 방식">
          <button class="filter" type="button" data-action="incoming-layout" data-value="table" aria-pressed="${view.incomingLayout === 'table'}">${icon('table')} 표 보기</button>
          <button class="filter" type="button" data-action="incoming-layout" data-value="cards" aria-pressed="${view.incomingLayout === 'cards'}">${icon('grid')} 카드 보기</button>
        </div>
      </div>
      <div class="filter-bar">
        <div class="filters" aria-label="검사 결과 필터">
          ${Object.entries(filterLabels).map(([key, label]) => `<button type="button" class="filter" data-action="incoming-filter" data-value="${key}" aria-pressed="${view.incomingFilter === key}">${label}<span>${key === 'all' ? results.length : results.filter(file => file.status === key).length}</span></button>`).join('')}
        </div>
        <div class="field-control">
          <select id="incoming-kind" aria-label="파일 형식 필터">
            <option value="">모든 형식</option>
            <option value="photo" ${view.incomingKind === 'photo' ? 'selected' : ''}>사진</option>
            <option value="video" ${view.incomingKind === 'video' ? 'selected' : ''}>영상</option>
          </select>
          <label class="search">${icon('search')}<span class="sr-only">파일 검색</span><input type="search" id="file-search" placeholder="파일 검색" value="${escapeHtml(view.query)}"></label>
        </div>
      </div>
      <div class="table-wrap" id="incoming-rows">${incomingRows()}</div>
      <div class="action-bar" id="incoming-actions">${incomingActions()}</div>
    </section>${pendingXmpSection()}`;
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

function filteredEventFiles(files) {
  const query = view.eventQuery.trim().toLocaleLowerCase();
  return files.filter(file =>
    (!view.eventStorage || file.status === view.eventStorage) &&
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
  const percent = Math.min(100, Math.round((result.completedFiles || 0) / (result.totalFiles || 1) * 100));
  return `<section class="surface upload-status" aria-label="로컬 원본 비우기 상태">
    <div class="upload-summary"><strong role="status">${active ? job.status === 'queued' ? '로컬 원본 비우기 대기 중' : result.phase || '로컬 원본 비우기 중' : job.status === 'done' ? '로컬 원본 비우기 완료' : '로컬 원본 비우기 실패'}</strong>
      <span class="small muted">${result.completedFiles || 0} / ${result.totalFiles || 0}개 처리 · 완료 ${result.offloaded || 0}개 · 실패 ${result.failed || 0}개${result.freedBytes ? ` · 확보 ${sizeLabel(result.freedBytes / 1_000_000)}` : ''}</span></div>
    ${active ? `<progress max="100" value="${percent}" aria-label="로컬 원본 비우기 진행률">${percent}%</progress><p class="small muted archive-path">${escapeHtml(result.current || '원격 아카이브를 확인하고 있습니다.')}</p>` : ''}
    ${result.error ? `<p class="form-error" role="alert">${escapeHtml(result.error)}</p>` : ''}
    ${result.errors?.length ? `<details><summary>실패한 파일 ${result.failed}개${result.failed > result.errors.length ? ` 중 ${result.errors.length}개 표시` : ''}</summary><ul>${result.errors.map(error => `<li><span class="archive-path">${escapeHtml(error.path)}</span>: ${escapeHtml(error.message)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function eventFileStatus(file) {
  if (file.status === 'archived') {
    return `${badge('archived', '아카이브 보관')}<div class="file-reason small muted">로컬 원본 없음</div>${file.reviewReason ? `<div class="file-reason small muted">${escapeHtml(file.reviewReason)}</div>` : ''}`;
  }
  const primary = file.reviewReason ? badge('review', escapeHtml(file.reviewReason)) :
    badge(file.confirmed ? 'ready' : 'draft', file.confirmed ? '확정' : file.eventId ? '초안' : '미배정');
  return `${primary}${file.archived ? '<div class="file-reason small muted">아카이브 사본 있음</div>' : ''}`;
}

function eventPage() {
  const event = eventById(view.eventId);
  const files = footageForEvent(view.eventId);
  const filtered = filteredEventFiles(files);
  const filtersActive = view.eventStorage || view.eventDevice || view.eventDate || view.eventQuery.trim();
  const dates = [...new Set(files.map(eventDateForFile).filter(Boolean))].sort();
  const parent = event?.parent ? eventById(event.parent) : event;
  const footageDate = dateTimeFormatter(parent?.zone || state.timezone);
  const destinations = eventDestinations(event);
  const devices = [...new Set(files.map(file => file.device).filter(Boolean))];
  const selected = view.eventSelection.size;
  const offloadable = filtered.filter(file => view.eventSelection.has(file.id) && file.canOffload);
  const offloadLabel = offloadable.length && offloadable.length !== selected ? `아카이브 검증 ${offloadable.length}개 로컬 비우기` : '로컬 원본 비우기';
  const confirmButton = event ? button('confirm-event', '선택 배치 확정', {
    glyph: 'check', primary: true, disabled: !filtered.some(file => view.eventSelection.has(file.id) && file.status === 'available' && !file.confirmed),
  }) : '';
  return `${header('이벤트 관리', '촬영 기간으로 사진과 영상을 모으고, 필요한 파일을 소분류로 배정하세요.',
    button('new-event', '이벤트 생성', { glyph: 'plus', primary: true }))}
    ${offloadStatus()}
    <div class="event-split">
      <section class="surface" aria-label="이벤트 목록">
        <div class="surface-head"><h2>이벤트</h2></div>
        <div class="event-list">
          ${eventLink('all', '전체 파일', state.managed.length)}
          ${eventLink('unassigned', '미배정', footageForEvent('unassigned').length)}
          ${state.events.filter(item => !item.parent).map(item => {
            const children = childEvents(item.id);
            const total = footageForEvent(item.id).length + children.reduce((sum, child) => sum + footageForEvent(child.id).length, 0);
            return eventLink(item.id, eventLabel(item), total) + children.map(child => eventLink(child.id, eventLabel(child), footageForEvent(child.id).length, true)).join('');
          }).join('')}
        </div>
      </section>
      <section class="surface" aria-label="이벤트 푸티지">
        <div class="surface-head event-heading">
          <div><h2>${escapeHtml(event ? eventLabel(event) : view.eventId === 'all' ? '전체 파일' : '미배정 푸티지')}</h2>
            <div class="event-meta small muted">${parent ? `${parent.start} ~ ${parent.end} · ` : ''}${filtersActive ? `${filtered.length} / ` : ''}${files.length}개 파일</div>
          </div>
          ${event ? `<div class="event-header-actions">
            ${!event.parent ? button('new-child', '소분류 추가', { glyph: 'plus' }) : ''}
            ${button('edit-event', event.parent ? '소분류 수정' : '이벤트 수정', { glyph: 'edit' })}
            ${button('delete-event', event.parent ? '소분류 삭제' : '이벤트 삭제', { glyph: 'trash', danger: true })}
          </div>` : ''}
        </div>
        <div class="event-tools">
          <label class="search"><span class="sr-only">이벤트 파일 검색</span>${icon('search')}<input type="search" id="event-search" placeholder="파일명·XMP 검색" value="${escapeHtml(view.eventQuery)}"></label>
          <select id="event-storage" aria-label="보관 위치 필터">
            <option value="">모든 위치</option>
            <option value="available" ${view.eventStorage === 'available' ? 'selected' : ''}>로컬 보유</option>
            <option value="archived" ${view.eventStorage === 'archived' ? 'selected' : ''}>아카이브 보관</option>
          </select>
          <select id="event-device" aria-label="촬영 장비 필터"><option value="">모든 장비</option>
            <option value="missing" ${view.eventDevice === 'missing' ? 'selected' : ''}>장비 확인 필요</option>${devices.map(device =>
            `<option value="device:${escapeHtml(device)}" ${view.eventDevice === `device:${device}` ? 'selected' : ''}>${escapeHtml(device)}</option>`).join('')}</select>
          <select id="event-date" aria-label="촬영일 필터"><option value="">모든 촬영일</option>${dates.map(date =>
            `<option ${view.eventDate === date ? 'selected' : ''}>${date}</option>`).join('')}</select>
          ${event && !event.parent ? button('collect', '기간으로 모으기', { glyph: 'refresh' }) : ''}
          ${confirmButton}
        </div>
        <div class="table-wrap" id="event-rows">${filtered.length ? `<table aria-label="이벤트별 파일">
          <thead><tr><th scope="col">${checkbox('event-all', 'all', '표시된 이벤트 파일 모두 선택', new Set(filtered.every(file => view.eventSelection.has(file.id)) ? ['all'] : []))}</th>
            <th scope="col">파일</th><th scope="col">촬영 일시</th><th scope="col">배치 상태</th></tr></thead>
          <tbody>${filtered.map(file => `<tr class="${view.eventSelection.has(file.id) ? 'selected' : ''}">
            <td>${checkbox('event', file.id, `${file.name} 선택`, view.eventSelection)}</td>
            <td>${fileCell(file, file.device || '장비 확인 필요', true, 'managed')}${(file.xmp || file.canDownload) ? `<div class="file-links">${file.xmp ? `<button type="button" class="time-edit-link" data-action="view-xmp" data-value="${escapeHtml(file.id)}">XMP 정보</button>` : ''}${file.canDownload ? `<a class="time-edit-link" href="/api/archive/download?media_id=${encodeURIComponent(file.id)}" target="_blank" rel="noopener">다운로드</a>` : ''}</div>` : ''}</td>
            <td class="numbers muted">${file.time ? footageDate.format(new Date(file.time)) : '—'}
              ${file.timeSource ? `<div class="file-reason small">${escapeHtml(file.timeSource)}${file.timeVerified ? '' : ' · 확인 필요'}</div>` : ''}
              ${file.analysisError ? `<div class="file-reason small">${escapeHtml(file.analysisError)}</div>` : ''}
              ${!file.timeVerified ? `<button type="button" class="time-edit-link" data-action="resolve-time" data-value="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.name)} 촬영 시각 지정" ${exclusiveActive() ? 'disabled' : ''}>촬영 시각 지정</button>` : ''}</td>
            <td>${eventFileStatus(file)}</td>
          </tr>`).join('')}</tbody>
        </table>` : emptyState('video', '표시할 푸티지가 없습니다.', filtersActive ? '보관 위치·장비·촬영일 필터나 검색어를 변경해 보세요.' : event && !event.parent ? '기간으로 모으기를 눌러 미배정 영상을 찾을 수 있습니다.' : '')}</div>
        <div class="action-bar">
          <div>
            ${destinations.length ? `<select id="move-event-target" aria-label="이동할 이벤트" ${exclusiveActive() ? 'disabled' : ''}><option value="">이동할 이벤트</option>${destinations.map(item => `<option value="${item.id}">${escapeHtml(eventOptionLabel(item))}</option>`).join('')}</select>
            ${button('move-event', '이동', { disabled: true })}` : ''}
            ${button('edit-media', '장비·촬영 시각 수정', { disabled: !selected })}
            ${button('offload-media', offloadLabel, { glyph: 'trash', danger: true, disabled: !offloadable.length || remoteBusy() })}
          </div>
          ${confirmButton}
        </div>
      </section>
    </div>`;
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


function archivePage() {
  const entries = sourceEntries();
  const allAssets = entries.flatMap(entry => entry.assets);
  const busy = remoteBusy() || view.uploadStarting;
  return `${header('아카이브 전송', '파일·폴더를 선택해 업로드하거나 Destination으로 드래그하세요.', '')}
    ${uploadStatus()}${remoteIndexStatus()}
    <div class="split">
      <section class="surface browser" aria-labelledby="source-title">
        <div class="surface-head archive-heading"><div><h2 id="source-title">${icon('folder')} Source</h2><p class="small muted">확정된 이벤트 배치</p></div>
          ${button('upload-archive', view.uploadStarting ? '예약 중…' : '업로드', { glyph: 'upload', primary: true, disabled: busy || !view.archive || view.archiveBusy || !view.sourceSelection.size })}</div>
        <div class="location">
          ${view.sourcePath.length ? smallButton('source-up', '상위 폴더', 'up') : icon('folder')}
          <span class="mono archive-path">${escapeHtml(['/managed', ...view.sourcePath].join('/'))}</span>
        </div>
        <div class="source-selection"><label>${checkbox('source-all', 'all', '표시된 Source 항목 모두 선택', new Set(allAssets.length && allAssets.every(key => view.sourceSelection.has(key)) ? ['all'] : []))} 모두 선택</label>
          <span class="small muted" role="status">${view.sourceSelection.size}개 파일 선택</span></div>
        ${entries.length ? `<ul class="tree">${entries.map((entry, index) => {
          const name = escapeHtml(entry.name);
          const selected = entry.assets.every(key => view.sourceSelection.has(key));
          const selection = checkbox('source', String(index), `${entry.name} 업로드 선택`, new Set(selected ? [String(index)] : []));
          const attributes = `draggable="${!busy}" data-source-index="${index}" class="tree-row${selected ? ' source-selected' : ''}"`;
          if (entry.file) return `<li ${attributes}>${selection}
            <span class="tree-file">${icon(entry.file.kind === 'xmp' ? 'file' : entry.file.kind)}${name}</span><span class="meta numbers">${sizeLabel(entry.file.size)}</span>
          </li>`;
          return `<li ${attributes}>${selection}
            <button type="button" class="tree-button" data-action="open-source" data-value="${index}">${icon('folder')}<span>${name}</span>${icon('right')}</button>
            <span class="meta">${entry.members.length}개</span>
          </li>`;
        }).join('')}</ul>` : emptyState('folder', '표시할 파일이 없습니다.', '이벤트 관리에서 배치를 확정하세요.')}
      </section>
      <section class="surface browser archive-destination" aria-labelledby="destination-title" ${view.archive && !view.archiveBusy && !busy ? `data-archive-drop="${escapeHtml(view.archivePath)}"` : ''}>
        <div class="surface-head archive-heading"><div><h2 id="destination-title">${icon('disk')} Destination</h2><p class="small muted">${view.archive ? '현재 폴더에 업로드 · 폴더 위에 놓으면 해당 폴더로 전송' : '원격 아카이브 연결'}</p></div>
          <div class="archive-actions">
            ${view.archive ? button('open-remote-index', '원격 인덱싱', { glyph: 'search', disabled: busy || view.archiveBusy }) : ''}
            ${button('connect-archive', view.archiveBusy ? '조회 중…' : view.archiveError ? '다시 연결' : view.archive ? '새로 고침' : '아카이브 연결',
              { glyph: 'refresh', primary: !view.archive, disabled: view.archiveBusy })}
          </div></div>
        ${archiveDestination()}
      </section>
    </div>`;
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
        emptyState('disk', view.archiveError ? '파일 목록을 불러오지 못했습니다.' : '원격 아카이브에 연결하세요.',
          view.archiveError ? '다시 연결하거나 설정에서 SSH 연결 정보를 확인하세요.' : '설정에 저장된 SSH 연결 정보와 저장 절대경로를 사용합니다.')}
    </div>`;
}

function uploadStatus() {
  const job = laneJob('remote');
  if (job?.kind !== 'upload') return '';
  const result = job.result || {};
  const active = jobActive(job);
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
    <label class="checkbox-row"><input type="checkbox" name="full_rehash" value="1"><span>크기·수정 시각이 같은 파일도 전체 해시 다시 검증</span></label>`,
  '인덱싱 시작', async form => {
    const scope = String(form.get('scope') || '');
    const fullRehash = form.get('full_rehash') === '1';
    const result = await api('archive/index', 'POST', {
      connection: view.archive.connectionVersion, path: scope, full_rehash: fullRehash,
    });
    setOptimisticJob({ id: result.id, kind: 'remote-index', status: 'queued', result: { scope } });
    await syncState();
    announce('원격 아카이브 인덱싱을 시작합니다.');
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
  view.archiveBusy = true;
  view.archiveError = '';
  view.archivePath = path;
  render();
  try {
    view.archive = await api(`archive?path=${encodeURIComponent(path)}`);
    view.archivePath = view.archive.path;
  } catch (error) {
    view.archive = null;
    view.archiveError = error.message;
  } finally {
    view.archiveBusy = false;
  }
}

function catalogTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : dateTimeFormatter(state.timezone).format(date);
}

function catalogHash(row) {
  return `<div class="catalog-hash"><code>${escapeHtml(row.sha || '해시 미기록')}</code>
    ${row.sha ? button('copy-record-hash', '복사', { glyph: 'copy', extra: `data-value="${escapeHtml(row.sha)}" aria-label="${escapeHtml(row.name)} SHA-256 복사"` }) : ''}</div>`;
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
  return [parent?.name, folder.name, view.catalogDevice].filter(Boolean).join(' / ');
}

function remoteFolderTree() {
  const data = view.catalog;
  const folders = data?.remoteFolders || [];
  const folderButton = (folderPath, label, count, depth = 0) => {
    const selected = view.catalogRemoteFolder === folderPath;
    return `<button type="button" class="catalog-folder${selected ? ' active' : ''}" data-action="catalog-remote-folder" data-value="${escapeHtml(folderPath)}"
      ${selected ? 'aria-current="location"' : ''} title="${escapeHtml(label)}" style="--folder-depth:${depth}">${icon('folder')}<span>${escapeHtml(label)}</span><span class="catalog-folder-count">${count}</span></button>`;
  };
  const branch = folder => {
    const children = folder.children || [];
    const expandable = children.length > 0;
    const expanded = view.catalogRemoteExpanded.has(folder.path);
    return `<li><div class="catalog-folder-row" style="--folder-depth:0">
      ${expandable ? `<button type="button" class="catalog-folder-toggle" data-action="toggle-remote-folder" data-value="${escapeHtml(folder.path)}" aria-expanded="${expanded}" aria-label="${escapeHtml(folder.name)} 하위 폴더 ${expanded ? '접기' : '펼치기'}">${icon('right')}</button>` : '<span class="catalog-folder-spacer"></span>'}
      ${folderButton(folder.path, folder.name, folder.count, 0)}</div>
      ${expanded ? `<ul>${children.map(child => `<li>${folderButton(child.path, child.name, child.count, 1)}</li>`).join('')}</ul>` : ''}
    </li>`;
  };
  return `<nav class="catalog-folders" aria-label="원격 아카이브 폴더"><div class="catalog-folders-heading"><h2>원격 폴더</h2><p class="small muted">아카이브 경로 기준</p></div>
    <div class="catalog-folder-list">${folderButton('', '전체 원격 파일', data?.summary.remoteTotal || 0)}
      ${data?.remoteRootCount ? folderButton('__root__', '루트 직속 파일', data.remoteRootCount) : ''}
      <ul>${folders.map(branch).join('')}</ul>
      ${!folders.length && !data?.remoteRootCount ? '<p class="small muted catalog-folders-empty">인덱싱된 원격 파일이 없습니다.</p>' : ''}
    </div></nav>`;
}

function catalogFolderTree() {
  if (view.catalogTab === 'remote') return remoteFolderTree();
  const data = view.catalog;
  const folders = data?.folders || [];
  const folderButton = (event, device, label, count, depth = 0) => {
    const selected = view.catalogEvent === event && view.catalogDevice === device;
    return `<button type="button" class="catalog-folder${selected ? ' active' : ''}" data-action="catalog-folder" data-value="${escapeHtml(JSON.stringify({ event, device }))}"
      ${selected ? 'aria-current="location"' : ''} title="${escapeHtml(label)}" style="--folder-depth:${depth}">${icon('folder')}<span>${escapeHtml(label)}</span><span class="catalog-folder-count">${count}</span></button>`;
  };
  const branch = (folder, depth = 0) => {
    const children = folders.filter(item => item.parent_id === folder.id);
    const count = folder.count + children.reduce((sum, item) => sum + item.count, 0);
    const expandable = children.length || folder.devices.length;
    const expanded = view.catalogExpanded.has(folder.id);
    return `<li><div class="catalog-folder-row" style="--folder-depth:${depth}">
      ${expandable ? `<button type="button" class="catalog-folder-toggle" data-action="toggle-catalog-folder" data-value="${escapeHtml(folder.id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(folder.name)} 하위 폴더 ${expanded ? '접기' : '펼치기'}">${icon('right')}</button>` : '<span class="catalog-folder-spacer"></span>'}
      ${folderButton(folder.id, '', folder.name, count, depth)}</div>
      ${expanded ? `<ul>${children.map(child => branch(child, depth + 1)).join('')}${folder.devices.map(device => `<li>${folderButton(folder.id, device.name, device.name, device.count, depth + 1)}</li>`).join('')}</ul>` : ''}
    </li>`;
  };
  const count = view.catalogTab === 'archives' ? data?.summary.attempts : data?.summary.files;
  return `<nav class="catalog-folders" aria-label="이벤트 폴더"><div class="catalog-folders-heading"><h2>이벤트</h2><p class="small muted">이벤트 · 소분류 · 장비</p></div>
    <div class="catalog-folder-list">${folderButton('all', '', '전체 파일', count || 0)}${folderButton('unassigned', '', '미배정', data?.unassigned || 0)}
      <ul>${folders.filter(folder => !folder.parent_id).map(folder => branch(folder)).join('')}</ul>
      ${!folders.length ? '<p class="small muted catalog-folders-empty">등록된 이벤트가 없습니다.</p>' : ''}
    </div></nav>`;
}

function catalogPage() {
  const data = view.catalog;
  const archives = view.catalogTab === 'archives';
  const remote = view.catalogTab === 'remote';
  const summary = data?.summary;
  const options = remote
    ? [['all', '모든 원격 파일'], ['present', '보관 중'], ['remote_only', '원격 전용 (카탈로그 미등록)'], ['missing', '누락됨'], ['xmp', 'XMP']]
    : archives
      ? [['all', '모든 결과'], ['verified', '검증 완료'], ['failed', '실패'], ['unknown', '결과 미확정'], ['xmp', 'XMP']]
      : [['all', '모든 파일'], ['managed', '보관 파일'], ['incoming', 'Incoming 기록'], ['xmp', 'XMP'], ['verified', '아카이브 검증 기록 있음']];
  const outcomes = { uploaded: '업로드 검증', skipped: '동일 파일 확인', legacy_verified: '과거 전송 완료', failed: '실패', pending: '진행 대기', unknown: '파일별 결과 미기록' };
  const statuses = { available: '보관 중', archived: '아카이브 보관', offloading: '로컬 비우기 중', missing: '파일 없음', moving: '이동 중', ready: '이동 대기', duplicate: '중복', review: '검토 필요', moved: '이동됨', deleted: '삭제됨', deleting: '삭제 중' };
  const summaryText = !summary ? '기록을 확인하고 있습니다.' : remote
    ? `원격 보관 ${summary.remotePresent}개 (원격 전용 ${summary.remoteOnly}개) · 누락 ${summary.remoteMissing}개${summary.lastIndexedAt ? ` · 최근 전체 인덱싱 ${catalogTime(summary.lastIndexedAt)}` : ''}`
    : `파일 기록 ${summary.files}개 · 고유 SHA-256 ${summary.hashes}개 · 아카이브 검증 ${summary.verified}건 · 원격 인덱스 ${summary.remotePresent}개 · 파일별 실패 ${summary.failed}건`;
  const hasFilter = remote ? (view.catalogRemoteFolder || view.catalogQuery || view.catalogScope !== 'all')
    : (view.catalogEvent !== 'all' || view.catalogQuery || view.catalogScope !== 'all');
  return `${header('파일 기록', '카탈로그에 저장된 파일 해시, 아카이브 전송 이력과 원격 인덱스를 조회하세요.', button('refresh-catalog', '새로 고침', { glyph: 'refresh', disabled: view.catalogBusy }))}
    <section class="surface" aria-label="파일 카탈로그">
      <div class="catalog-tabs" role="group" aria-label="기록 종류">
        ${button('catalog-tab', '보유 파일', { extra: `data-value="files" aria-pressed="${!archives && !remote}"`, primary: !archives && !remote })}
        ${button('catalog-tab', '아카이브 기록', { extra: `data-value="archives" aria-pressed="${archives}"`, primary: archives })}
        ${button('catalog-tab', '원격 인덱스', { extra: `data-value="remote" aria-pressed="${remote}"`, primary: remote })}
      </div>
      <p class="catalog-summary small muted">${summaryText}</p>
      <div class="catalog-layout">${catalogFolderTree()}<div class="catalog-content">
      <div class="catalog-location" aria-label="${remote ? '현재 원격 폴더' : '현재 이벤트 폴더'}">${icon('folder')}<strong>${escapeHtml(catalogFolderLabel())}</strong></div>
      <form id="catalog-search" class="catalog-tools">
        <label class="search">${icon('search')}<span class="sr-only">파일 기록 검색</span><input id="catalog-query" name="query" type="search" maxlength="300" placeholder="파일명·경로·SHA-256 검색" value="${escapeHtml(view.catalogQuery)}"></label>
        <select id="catalog-scope" name="scope" aria-label="파일 기록 필터">${options.map(([value, label]) => `<option value="${value}" ${view.catalogScope === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <button type="submit" class="button" ${view.catalogBusy ? 'disabled' : ''}>검색</button>
      </form>
      <p class="catalog-note small muted">${remote ? '원격 스토리지에 인덱싱된 파일 스냅샷입니다. Photo Saver 밖에서 미리 올려둔 기존 영상도 중복 차단과 다운로드에 사용됩니다.' : archives ? '전송 시점의 SHA-256 검증 기록입니다. 과거 작업에 목적지 루트나 파일별 결과가 없으면 미기록으로 표시합니다.' : '보관 파일·XMP와 Incoming의 해시 기록을 표시합니다. 같은 해시의 파일도 경로별로 구분합니다.'}</p>
      ${view.catalogError ? `<p class="archive-error form-error" role="alert">${escapeHtml(view.catalogError)}</p>` : ''}
      <div aria-busy="${view.catalogBusy}">
      ${view.catalogBusy ? emptyState('file', '기록을 불러오고 있습니다.') : data?.rows.length ? `<div class="table-wrap catalog-table-wrap" tabindex="0" aria-label="${remote ? '원격 인덱스' : archives ? '아카이브' : '파일'} 기록 표, 가로 스크롤 가능"><table class="catalog-table" aria-label="${remote ? '원격 인덱스' : archives ? '아카이브 기록' : '파일 해시 기록'}">
        <thead><tr><th scope="col">${remote ? '원격 파일 / 경로' : '파일 / 경로'}</th><th scope="col">SHA-256</th><th scope="col">${remote ? '분류 / 크기' : archives ? '아카이브 목적지' : '분류 / 크기'}</th><th scope="col">${remote ? '인덱스 상태 / 검증 시각' : archives ? '검증 결과 / 시각' : '파일 상태'}</th></tr></thead>
        <tbody>${data.rows.map(row => remote ? `<tr>
          <td><strong>${escapeHtml(row.name)}</strong><div class="small muted catalog-path mono">${escapeHtml(row.remote_path)}</div>
            ${row.archive_root ? `<div class="small muted catalog-path mono">${escapeHtml(row.archive_root)}</div>` : ''}</td>
          <td>${catalogHash(row)}</td>
          <td><div>${row.in_catalog ? '카탈로그 연동됨' : '원격 전용'}</div><div class="small muted">${row.kind === 'xmp' ? 'XMP' : row.kind === 'video' ? '영상' : '사진'} · ${sizeLabel(row.size === null ? null : row.size / 1_000_000)}</div></td>
          <td><span class="status ${row.status === 'present' ? 'archived' : 'review'}">${row.status === 'present' ? '보관 중' : '누락됨'}</span><div class="small muted numbers">${catalogTime(row.verified_at || row.last_seen_at)}</div>${row.can_download ? `<a class="time-edit-link" href="/api/archive/download?path=${encodeURIComponent(row.remote_path)}" target="_blank" rel="noopener">다운로드</a>` : ''}</td>
        </tr>` : `<tr>
          <td><strong>${escapeHtml(row.name)}</strong><div class="small muted catalog-path">${escapeHtml((archives || row.location === 'managed' ? 'managed/' : 'incoming/') + row.local_path)}</div>
            ${row.original_path ? `<div class="small muted catalog-path">원본: incoming/${escapeHtml(row.original_path)}</div>` : ''}
            ${archives ? `<div class="small muted">작업 #${row.job_id} · ${row.kind === 'xmp' ? 'XMP' : '원본'} · ${sizeLabel(row.size === null ? null : row.size / 1_000_000)}</div>` : ''}</td>
          <td>${catalogHash(row)}</td>
          <td>${archives ? `<div class="catalog-path mono">${escapeHtml(row.archive_root ? [row.archive_root.replace(/\/$/, ''), row.target].join('/') : row.target || '목적지 미기록')}</div>${!row.archive_root ? '<div class="small muted">아카이브 루트 미기록</div>' : ''}` :
            `<div>${escapeHtml(row.event_name || '미배정')}</div><div class="small muted">${escapeHtml(row.kind === 'xmp' ? 'XMP' : row.device || '장비 미확인')} · ${sizeLabel(row.size === null ? null : row.size / 1_000_000)}</div>`}</td>
          <td>${archives ? `<span class="status ${['uploaded', 'skipped', 'legacy_verified'].includes(row.outcome) ? 'ready' : row.outcome === 'failed' ? 'review' : 'draft'}">${escapeHtml(outcomes[row.outcome] || row.outcome)}</span><div class="small muted numbers">${catalogTime(row.verified_at || row.recorded_at)}</div>${row.can_download ? `<a class="time-edit-link" href="/api/archive/download?path=${encodeURIComponent(row.target)}" target="_blank" rel="noopener">다운로드</a>` : ''}${row.error ? `<p class="small form-error catalog-path">${escapeHtml(row.error)}</p>` : ''}` :
            `<span class="status ${row.status === 'available' ? 'ready' : row.status === 'archived' ? 'archived' : 'draft'}">${escapeHtml(statuses[row.status] || row.status)}</span>${row.location === 'managed' && row.status !== 'archived' ? `<div class="small muted">${row.confirmed ? '배치 확정' : '배치 미확정'}</div>` : ''}${row.has_archive ? '<div class="small muted">아카이브 검증 기록 있음</div>' : ''}${row.can_download ? `<a class="time-edit-link" href="/api/archive/download?path=${encodeURIComponent(row.download_path)}" target="_blank" rel="noopener">아카이브 다운로드</a>` : ''}`}</td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('file', view.catalogError ? '기록을 불러오지 못했습니다.' : hasFilter ? '조건에 맞는 기록이 없습니다.' : remote ? '인덱싱된 원격 파일이 없습니다.' : archives ? '아카이브 전송 기록이 없습니다.' : '파일 기록이 없습니다.', remote ? '아카이브 전송 페이지에서 원격 스토리지에 연결한 뒤 원격 인덱싱을 실행하세요.' : archives ? '아카이브 전송 결과가 이곳에 기록됩니다.' : 'Incoming Library에서 파일을 검사하면 해시 기록을 확인할 수 있습니다.')}
      </div>
      ${data && !view.catalogBusy && !view.catalogError ? `<div class="catalog-pagination"><span class="small muted" role="status">${data.total}개 기록 · ${data.page} / ${data.pages}페이지</span><div>
        ${button('catalog-page', '이전', { extra: `data-value="${data.page - 1}"`, disabled: data.page <= 1 })}
        ${button('catalog-page', '다음', { extra: `data-value="${data.page + 1}"`, disabled: data.page >= data.pages })}</div></div>` : ''}
      </div></div>
    </section>`;
}

async function loadCatalog() {
  const request = ++catalogRequest;
  view.catalogBusy = true;
  view.catalogError = '';
  if (view.page === 'catalog') render();
  try {
    const query = new URLSearchParams({
      view: view.catalogTab, q: view.catalogQuery, scope: view.catalogScope, page: view.catalogPage,
      event: view.catalogEvent, device: view.catalogDevice, folder: view.catalogRemoteFolder,
    });
    const result = await api(`catalog?${query}`);
    if (request !== catalogRequest) return;
    view.catalog = result;
    view.catalogPage = result.page;
  } catch (error) {
    if (request === catalogRequest) view.catalogError = error.message;
  } finally {
    if (request === catalogRequest) {
      view.catalogBusy = false;
      if (view.page === 'catalog') render();
    }
  }
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

function settingsPage() {
  const settings = view.settings;
  const keyCopied = settings?.keyCopied || view.keyCopiedLocally;
  return `${header('설정', '촬영도구 이름, 스토리지 연결과 카탈로그 백업을 관리하세요.', '')}
    ${view.settingsError ? `<p class="scan-strip" role="alert">${escapeHtml(view.settingsError)}</p>` : ''}
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
    <section class="surface settings-section device-names" aria-label="촬영도구 이름">
      <div class="surface-head"><h2>${icon('aperture')} 촬영도구 이름</h2></div>
      <p class="device-names-help small muted">기존 파일과 앞으로 들어오는 같은 촬영도구의 파일에 적용합니다. 파일별로 직접 지정한 이름은 유지하며, 기존 원격 폴더는 바꾸지 않습니다.</p>
      ${view.devicesError ? `<p class="form-error device-names-help" role="alert">${escapeHtml(view.devicesError)}</p>${button('refresh-devices', '목록 다시 불러오기')}` : ''}
      ${view.devices === null ? '<p class="device-names-help small muted" role="status">촬영도구 목록을 불러오는 중입니다.</p>' :
        !view.devices.length ? '<p class="device-names-help small muted">감지된 촬영도구가 없습니다. 파일을 managed로 이동하고 검사하면 여기에 표시됩니다.</p>' :
        view.devices.map((device, index) => `<form class="setting-row device-name-form" data-source="${escapeHtml(device.source)}">
          <div class="device-name-origin"><label for="device-name-${index}">${escapeHtml(device.source)}</label>
            <p class="small muted">기존 파일 ${device.count}개와 이후 파일에 적용</p></div>
          <div class="setting-controls"><input id="device-name-${index}" name="name" value="${escapeHtml(device.name)}" required maxlength="80" autocomplete="off" ${exclusiveActive() || ['upload', 'offload'].includes(activeLaneJob('remote')?.kind) ? 'disabled' : ''}>
            <button type="submit" class="button" ${exclusiveActive() || ['upload', 'offload'].includes(activeLaneJob('remote')?.kind) ? 'disabled' : ''}>이름 저장</button></div>
          <p class="form-error device-name-error" role="alert" hidden></p>
        </form>`).join('')}
    </section>
    <section class="surface settings-section" aria-label="DB 백업 및 복원">
      <div class="surface-head"><h2>${icon('file')} DB 백업 및 복원</h2></div>
      ${settingRow('카탈로그 백업', '이벤트와 파일 배치가 포함된 SQLite 백업을 다운로드합니다.',
        button('download-catalog', 'DB 백업 다운로드', { glyph: 'download', disabled: anyJobActive() || view.catalogOpBusy }))}
      ${settingRow('카탈로그 복원', '선택한 백업의 내용으로 현재 카탈로그를 교체합니다.',
        `<input id="restore-catalog-file" type="file" accept=".sqlite3,.sqlite,.db,application/octet-stream" hidden>` +
        (view.restoreFile ? maskedSetting('파일 선택됨') : '') + button('pick-catalog-file', '백업 파일 선택', { disabled: anyJobActive() || view.catalogOpBusy }) +
        button('restore-catalog', '복원', { glyph: 'upload', danger: true, disabled: !view.restoreFile || anyJobActive() || view.catalogOpBusy }))}
    </section>
    <section class="surface settings-section" aria-label="데이터 초기화">
      <div class="surface-head"><h2>${icon('trash')} 데이터 초기화</h2></div>
      ${settingRow('managed 및 기록 초기화', 'managed 원본과 부가 파일, 썸네일, 카탈로그·작업 기록을 영구 삭제합니다. incoming과 SSH 연결 설정은 유지합니다.',
        button('reset-catalog', '데이터 초기화', { danger: true, disabled: anyJobActive() || view.catalogOpBusy }))}
      ${resetStatus()}
    </section>`;
}

async function loadSettings() {
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
    announce('원격 스토리지의 저장 경로를 저장했습니다.');
  });
}

async function generateStorageKey() {
  view.settings = await api('settings/ssh-key', 'POST');
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
  try {
    await navigator.clipboard.writeText(view.publicKeyToCopy);
  } catch {
    throw new Error('클립보드에 복사할 수 없습니다. 브라우저의 클립보드 권한을 확인하세요.');
  }
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
          reportSshResult(true, 'SSH 공개키 인증에 성공했습니다.');
        } catch (error) {
          reportSshResult(false, error.message);
        } finally {
          view.settings = await api('settings').catch(() => view.settings);
        }
      });
    } else {
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
    view.archive = null;
    view.archiveError = '';
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
  showDialog('카탈로그 복원', `<p>선택한 백업으로 현재 이벤트와 파일 배치를 교체합니다.</p>
    <p>원본 사진과 영상은 디스크에 보관됩니다.</p>`, 'DB 복원', async () => {
    view.catalogOpBusy = true;
    render();
    try {
      await api('settings/catalog/restore', 'POST', file);
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
  const result = job.result || {};
  const detail = job.status === 'failed' ? result.error :
    `${result.phase || '초기화 대기 중'} · 파일 ${result.deletedFiles || 0}개 삭제`;
  return `<p class="device-names-help ${job.status === 'failed' ? 'form-error' : 'small muted'}" role="${job.status === 'failed' ? 'alert' : 'status'}">${escapeHtml(detail)}</p>`;
}

function clearCatalogViews() {
  view.incomingLayout = 'table';
  try { localStorage.removeItem('photo-saver-incoming-layout'); } catch { /* Storage may be unavailable. */ }
  view.archive = null; view.archivePath = ''; view.archiveError = ''; view.catalogTab = 'files';
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
  view.catalogScope = 'all'; view.catalogPage = 1; view.catalogExpanded.clear();
  view.catalogRemoteFolder = ''; view.catalogRemoteExpanded.clear();
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

function showDialog(title, content, submitLabel, handler, { danger = false } = {}) {
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
    <p class="small muted">변경한 이름과 시작일에 맞춰 Source 폴더명과 이후 업로드 경로가 바뀝니다. 이미 예약한 업로드와 OMV에 저장된 폴더는 기존 경로를 유지합니다.</p>`,
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
    <p>배정된 사진과 영상은 ${destination}. 원본은 managed에 보관됩니다.</p>`,
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
  view.eventId = id;
  view.eventSelection.clear();
  view.eventStorage = '';
  view.eventDevice = '';
  view.eventDate = '';
  view.eventQuery = '';
  view.eventTarget = '';
}

function updateEventActions() {
  const target = page.querySelector('#move-event-target');
  if (target) {
    target.value = view.eventTarget || '';
    page.querySelector('[data-action="move-event"]').disabled = exclusiveActive() || !target.value || !view.eventSelection.size;
  }
}



function render() {
  const catalogScroll = page.querySelector('.catalog-table-wrap');
  const catalogScrollPosition = catalogScroll ? { top: catalogScroll.scrollTop, left: catalogScroll.scrollLeft } : null;
  const folderScroll = page.querySelector('.catalog-folder-list')?.scrollTop || 0;
  const incomingTable = page.querySelector('#incoming-rows');
  const tableScroll = incomingTable ? { top: incomingTable.scrollTop, left: incomingTable.scrollLeft } : null;
  const eventTable = page.querySelector('#event-rows');
  const eventScroll = eventTable ? { top: eventTable.scrollTop, left: eventTable.scrollLeft } : null;
  const xmpScroll = page.querySelector('.xmp-matches')?.scrollTop;
  const active = document.activeElement;
  const keepFocus = active && page.contains(active);
  const route = location.hash.slice(1);
  const current = navigation.find(item => item.id === route) || navigation[0];
  const pageChanged = view.page !== current.id;
  const views = { incoming: incomingPage, events: eventPage, archive: archivePage, catalog: catalogPage, settings: settingsPage };
  view.page = current.id;
  nav.innerHTML = navigation.map(item => `<a class="nav-link" href="#${item.id}"${item.id === current.id ? ' aria-current="page"' : ''}>${icon(item.icon)}${item.title}</a>`).join('');
  const status = view.loadError ? `<p class="scan-strip" role="alert">${escapeHtml(view.loadError)}</p>` : '';
  page.innerHTML = `<main aria-labelledby="page-title">${activeJobsBar()}${status}${views[view.page]()}</main>`;
  document.title = `${current.title} · Photo Saver`;
  if (view.page === 'events') updateEventActions();
  if (view.page === 'archive') {
    const entries = sourceEntries();
    page.querySelectorAll('[data-select="source"]').forEach(input => {
      const keys = entries[Number(input.value)]?.assets || [];
      input.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !keys.every(key => view.sourceSelection.has(key));
      input.disabled = remoteBusy() || view.uploadStarting;
    });
    const all = page.querySelector('[data-select="source-all"]');
    const keys = entries.flatMap(entry => entry.assets);
    if (all) {
      all.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !keys.every(key => view.sourceSelection.has(key));
      all.disabled = !keys.length || remoteBusy() || view.uploadStarting;
    }
  }
  if (pageChanged) {
    pendingPreviewFocus = null;
    window.scrollTo(0, 0);
    return;
  }
  if (catalogScrollPosition) page.querySelector('.catalog-table-wrap')?.scrollTo(catalogScrollPosition);
  page.querySelector('.catalog-folder-list')?.scrollTo(0, folderScroll);
  if (tableScroll) page.querySelector('#incoming-rows')?.scrollTo(tableScroll);
  if (eventScroll) page.querySelector('#event-rows')?.scrollTo(eventScroll);
  if (xmpScroll) page.querySelector('.xmp-matches')?.scrollTo(0, xmpScroll);
  if (pendingPreviewFocus) {
    const focusIntent = pendingPreviewFocus;
    pendingPreviewFocus = null;
    if (!view.preview) {
      restorePreviewFocus(focusIntent);
      return;
    }
  }
  if (keepFocus) {
    const replacement = [...page.querySelectorAll('button, input, select')].find(element => {
      if (active.id) return element.id === active.id;
      if (active.dataset.action) return element.dataset.action === active.dataset.action && element.dataset.value === active.dataset.value;
      if (active.dataset.xmpId) return element.dataset.xmpId === active.dataset.xmpId;
      return active.dataset.select && element.dataset.select === active.dataset.select && element.value === active.value;
    });
    if (replacement) {
      replacement.focus({ preventScroll: true });
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

function handleSelection(control) {
  const kind = control.dataset.select;
  const id = control.value;
  if (kind === 'incoming' || kind === 'incoming-all') {
    const ids = kind === 'incoming' ? [id] : filteredIncoming().filter(canSelectIncoming).map(file => file.id);
    toggleSelection(view.incomingSelection, ids, control.checked);
  } else if (kind === 'source' || kind === 'source-all') {
    const entries = sourceEntries();
    const keys = kind === 'source-all' ? entries.flatMap(entry => entry.assets) : entries[Number(id)]?.assets || [];
    toggleSelection(view.sourceSelection, keys, control.checked);
  } else {
    const ids = kind === 'event' ? [id] : filteredEventFiles(footageForEvent(view.eventId)).map(file => file.id);
    toggleSelection(view.eventSelection, ids, control.checked);
  }
  render();
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
    <ul class="preview-paths mono">${photos.map(file => `<li>${escapeHtml(file.folder ? `${file.folder}/${file.name}` : file.name)}</li>`).join('')}</ul>`,
  `사진 ${photos.length}개 삭제`, () => submitJob('delete', { ids: photos.map(file => file.id) }), { danger: true });
}

function previewCollection(source) {
  return source === 'managed' ? state.managed : state.incoming;
}

function isPreviewableFile(source, file) {
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
  if (source === 'managed') {
    const eventName = previewEventLabel(file);
    return `<span class="mono">${escapeHtml(`managed/${file.path}`)}</span> · ${sizeLabel(file.size)}${eventName ? ` · 이벤트: ${escapeHtml(eventName)}` : ''}`;
  }
  return `${escapeHtml(file.folder ? `incoming/${file.folder}` : 'incoming')} · ${sizeLabel(file.size)}`;
}

function defaultPreviewErrorMessage(source) {
  if (source === 'managed') {
    return '미리보기를 열 수 없습니다. 브라우저에서 지원하지 않는 형식이거나 원본을 읽을 수 없습니다. 원본 열기로 확인하거나 다시 시도하세요.';
  }
  return '미리보기를 열 수 없습니다. 원본 파일을 열거나 Incoming Library를 새로 고침하세요.';
}

function diagnosticMessageForStatus(source, file, status) {
  if (status === 404) {
    return source === 'managed'
      ? '로컬 원본을 찾을 수 없습니다. 원본이 이동·비우기 되었는지 확인하거나 Incoming Library의 새로 고침으로 다시 검사하세요.'
      : '원본 파일을 찾을 수 없습니다. Incoming Library를 새로 고침하세요.';
  }
  if (status === 403) return '로컬 원본의 읽기 권한이 없습니다. 파일·폴더 권한을 확인하세요.';
  if (status === 409) return '원본 파일이 변경되었습니다. 원본을 확인한 뒤 Incoming Library의 새로 고침으로 다시 검사하세요.';
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

function renderMediaPreview({ focusTitle = true } = {}) {
  const preview = view.preview;
  const file = currentPreviewFile(preview);
  if (!preview || !file) return;
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
      if (!preview.busy) footer.querySelector('[data-action="perform-preview-delete"]')?.focus();
    }
    return;
  }
  const original = file.original ? `<a class="button" href="${escapeHtml(file.original)}" target="_blank" rel="noopener">원본 열기</a>` : '';
  const hint = preview.message
    ? escapeHtml(preview.message)
    : isIncoming
      ? `<kbd>←</kbd> <kbd>→</kbd> 이동${canDelete ? ' · <kbd>Delete</kbd> 삭제' : ''}`
      : '닫은 뒤 선택 항목을 분류할 수 있습니다 · <kbd>←</kbd> <kbd>→</kbd> 이동';
  const html = `<div class="preview-controls" role="group" aria-label="파일 이동">
      ${button('previous-preview', '이전', { glyph: 'left', disabled: preview.index === 0 })}${counter}
      ${button('next-preview', '다음', { glyph: 'right', disabled: preview.index === preview.ids.length - 1 })}
    </div>
    <div class="preview-controls">
      ${original}${canDelete ? button('request-preview-delete', '사진 삭제', { glyph: 'trash', danger: true }) : ''}
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
    const mediaChanged = preview.renderedSrc !== (currentFile.preview || null) || preview.renderedKind !== (currentFile.kind || null);
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
    : '사진이 변경되었거나 삭제할 수 없습니다. 새로 고침 후 다시 확인하세요.';
  renderPreviewFooter();
  return true;
}

const previewActions = {
  'previous-preview': () => stepPreview(-1),
  'next-preview': () => stepPreview(1),
  'close-preview': () => closeMediaPreview(),
  'retry-preview': retryPreview,
  'request-preview-delete': requestPreviewDelete,
  'cancel-preview-delete': cancelPreviewDelete,
  'perform-preview-delete': performPreviewDelete,
};

function confirmEvent() {
  const files = footageForEvent(view.eventId).filter(file => view.eventSelection.has(file.id) && file.status === 'available' && !file.confirmed);
  if (!files.length) return;
  showDialog('배치 확정', `<p>확정한 파일 ${files.length}개가 아카이브 전송의 Source에 표시됩니다.</p>
    <ul class="preview-paths mono">${files.map(file => `<li>${escapeHtml([...sourceFolders(file), file.name].join('/'))}</li>`).join('')}</ul>`,
  '배치 확정', async () => {
    await api('placements/confirm', 'POST', { ids: files.map(file => file.id) });
    view.eventSelection.clear();
    await syncState();
    announce('선택한 배치를 확정했습니다.');
  });
}

function confirmOffload() {
  const files = filteredEventFiles(footageForEvent(view.eventId)).filter(file => view.eventSelection.has(file.id) && file.canOffload);
  if (!files.length) return;
  showDialog('로컬 원본 비우기', `<p>원격 아카이브에 파일 존재·크기를 실시간 확인한 뒤 아래 ${files.length}개 파일의 로컬 <code>managed</code> 원본(및 연결된 XMP)을 삭제합니다.</p>
    <p>썸네일, 메타데이터, XMP 정보, 이벤트 배정은 DB에 그대로 유지되며 언제든 다시 다운로드할 수 있습니다. 원격에 없거나 크기가 다르면 삭제하지 않고 유지합니다.</p>
    <ul class="preview-paths mono">${files.map(file => `<li>${escapeHtml(file.name)}${file.xmp ? ` (+ ${escapeHtml(file.xmp.name)})` : ''} → ${escapeHtml(file.remotePaths[0] || '')}</li>`).join('')}</ul>`,
  `로컬 원본 ${files.length}개 비우기`, async () => {
    const result = await api('jobs/offload', 'POST', { ids: files.map(file => file.id) });
    setOptimisticJob({ id: result.id, kind: 'offload', status: 'queued', result: {} });
    view.eventSelection.clear();
    await syncState();
    announce(`${result.count}개 파일의 원격 확인 및 로컬 원본 비우기를 시작합니다.`);
  }, { danger: true });
}

const actions = {
  scan() { return submitJob('scan'); },
  'incoming-filter'(value) { view.incomingFilter = value; },
  'incoming-layout'(value) {
    view.incomingLayout = value;
    page.querySelector('#incoming-rows').scrollTo(0, 0);
    try {
      localStorage.setItem('photo-saver-incoming-layout', value);
    } catch {
      // The current page still retains the setting when storage is unavailable.
    }
  },
  'preview-incoming': openIncomingPreview,
  'preview-managed': openManagedPreview,
  'move-incoming'() { return submitJob('move', { ids: selectedIncoming(file => file.status === 'ready').map(file => file.id) }); },
  'delete-incoming': confirmDeleteIncoming,
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
  'new-event'() { createEventDialog(); },
  'new-child'() { createEventDialog(eventById(view.eventId)); },
  'edit-event'() { editEventDialog(eventById(view.eventId)); },
  'delete-event'() { deleteEventDialog(eventById(view.eventId)); },
  async collect() {
    const result = await api(`events/${view.eventId}/collect`, 'POST');
    await syncState();
    announce(collectionMessage(result));
  },
  'move-event': moveEvent,
  'edit-media'() { editMedia(); },
  'offload-media': confirmOffload,
  'resolve-time'(id) { editMedia([id], true); },
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
    const folder = JSON.parse(value);
    view.catalogEvent = folder.event; view.catalogDevice = folder.device; view.catalogPage = 1;
    view.catalogExpanded.add(folder.event);
    return loadCatalog();
  },
  'toggle-catalog-folder'(id) { if (view.catalogExpanded.has(id)) view.catalogExpanded.delete(id); else view.catalogExpanded.add(id); },
  'catalog-remote-folder'(folder) {
    view.catalogRemoteFolder = folder; view.catalogPage = 1;
    if (folder && folder !== '__root__') view.catalogRemoteExpanded.add(folder.split('/')[0]);
    return loadCatalog();
  },
  'toggle-remote-folder'(folder) { if (view.catalogRemoteExpanded.has(folder)) view.catalogRemoteExpanded.delete(folder); else view.catalogRemoteExpanded.add(folder); },
  'refresh-catalog': loadCatalog,
  'catalog-tab'(tab) { view.catalogTab = tab; view.catalogScope = 'all'; view.catalogPage = 1; return loadCatalog(); },
  'catalog-page'(value) { view.catalogPage = Math.max(1, Number(value)); return loadCatalog(); },
  async 'copy-record-hash'(value) { await navigator.clipboard.writeText(value); announce('SHA-256을 복사했습니다.'); },
  'connect-archive'() { return browseArchive(); },
  'open-archive'(value) {
    const entry = view.archive?.entries[Number(value)];
    if (entry?.kind === 'folder') return browseArchive([view.archivePath, entry.name].filter(Boolean).join('/'));
  },
  'archive-up'() { return browseArchive(view.archivePath.split('/').slice(0, -1).join('/')); },
};

page.addEventListener('click', async event => {
  const control = event.target.closest('button[data-action]');
  if (!control) return;
  try {
    control.disabled = true;
    await actions[control.dataset.action](control.dataset.value);
  } catch (error) {
    announce(error.message);
  } finally {
    control.disabled = false;
    if (!dialog.open && !mediaPreview.open) render();
  }
});

const archiveDragType = 'application/x-photo-saver';

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
  loadCatalog();
});

page.addEventListener('change', event => {
  const control = event.target;
  if (control.id === 'catalog-scope') {
    view.catalogScope = control.value;
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
    render();
  } else if (control.id === 'event-storage') {
    view.eventStorage = control.value;
    view.eventSelection.clear();
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

page.addEventListener('input', event => {
  if (event.target.id === 'catalog-query') {
    view.catalogQuery = event.target.value;
    return;
  }
  if (event.target.id === 'event-search') {
    const { selectionStart, selectionEnd, value } = event.target;
    view.eventQuery = value;
    render();
    page.querySelector('#event-search').setSelectionRange(selectionStart, selectionEnd);
    return;
  }
  if (event.target.id !== 'file-search') return;
  view.query = event.target.value;
  document.getElementById('incoming-rows').innerHTML = incomingRows();
});

page.addEventListener('keydown', event => {
  const card = event.target.closest('[data-card-preview]');
  if (!card) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    if (!event.repeat) {
      openIncomingPreview(card.dataset.value);
      requestPreviewDelete();
    }
    return;
  }
  const grid = card.closest('.incoming-cards');
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

mediaPreview.addEventListener('click', event => {
  const action = event.target.closest('button[data-action]')?.dataset.action;
  if (action && previewActions[action]) previewActions[action]();
});

mediaPreview.addEventListener('keydown', event => {
  const preview = view.preview;
  if (!preview || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (preview.source !== 'incoming' || isEditableOrMediaTarget(event.target)) return;
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

dialog.addEventListener('click', event => {
  if (event.target.closest('[data-action="close-dialog"]')) dialog.close();
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
function loadRoute() {
  closeMediaPreview({ restoreFocus: false });
  render();
  if (view.page === 'catalog') loadCatalog();
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
