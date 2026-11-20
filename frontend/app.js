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

const state = { incoming: [], managed: [], events: [], pendingXmp: [], scan: null, job: null, timezone: 'Asia/Seoul' };
const view = {
  page: '', incomingFilter: 'all', incomingKind: '', query: '', connecting: true, loadError: '',
  incomingLayout: savedIncomingLayout(), preview: null,
  incomingSelection: new Set(), eventId: 'unassigned', eventSelection: new Set(), eventDevice: '', eventDate: '',
  eventTarget: '', eventQuery: '', sourcePath: [], xmpChoices: new Map(),
  settings: null, settingsError: '', publicKeyToCopy: null, keyCopiedLocally: false, restoreFile: null,
  sshTestBusy: false, sshTestResult: null,
  archive: null, archivePath: '', archiveBusy: false, archiveError: '',
  sourceSelection: new Set(), uploadStarting: false, dragSource: null,
};
let refreshTimer;
let stateRequest = 0;

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
    throw new Error(typeof result?.detail === 'string' ? result.detail : '요청을 처리하지 못했습니다.');
  }
  return result;
}

function jobActive(job = state.job) {
  return job && ['queued', 'running'].includes(job.status);
}

function jobMessage(job) {
  if (job.status === 'cancelled') return job.result.error || '작업을 중지했습니다.';
  if (job.status === 'failed') return job.result.error;
  if (job.kind === 'upload') return `업로드 ${job.result.uploaded}개 완료 · 동일 파일 ${job.result.skipped}개 건너뜀`;
  if (job.kind === 'scan') return `${job.result.checked}개 파일의 검사를 완료했습니다.`;
  if (job.kind === 'delete') return `사진 ${job.result.deleted}개를 삭제했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  if (job.kind === 'xmp-link') return `XMP ${job.result.linked}개를 연결했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  return `${job.result.moved}개를 managed로 옮겼습니다.${job.result.xmp ? ` XMP ${job.result.xmp}개 보관.` : ''}${job.result.auxDeleted ? ` THM·LRV ${job.result.auxDeleted}개 삭제.` : ''}${job.result.duplicate ? ` 중복 ${job.result.duplicate}개.` : ''}${job.result.review || job.result.companionReview ? ` 확인 필요 ${(job.result.review || 0) + (job.result.companionReview || 0)}개.` : ''}`;
}

async function syncState() {
  const request = ++stateRequest;
  window.clearTimeout(refreshTimer);
  try {
    const previousJob = state.job;
    const snapshot = await api('state');
    if (request !== stateRequest) return;
    Object.assign(state, snapshot);
    view.loadError = '';
    if (jobActive(previousJob) && state.job?.id === previousJob.id && !jobActive()) {
      announce(jobMessage(state.job));
      if (state.job.kind === 'upload' && view.archive && view.page === 'archive') await browseArchive(view.archivePath);
    }
    const sourceKeys = new Set(sourceFiles().flatMap(sourceAssetKeys));
    for (const key of view.sourceSelection) if (!sourceKeys.has(key)) view.sourceSelection.delete(key);
    const selectable = new Set(state.incoming.filter(canSelectIncoming).map(file => file.id));
    for (const id of view.incomingSelection) {
      if (!selectable.has(id)) view.incomingSelection.delete(id);
    }
    updatePreviewAfterDelete();
  } catch (error) {
    if (request === stateRequest) view.loadError = error.message;
  } finally {
    if (request === stateRequest) {
      view.connecting = false;
      if (jobActive() || view.loadError) refreshTimer = window.setTimeout(async () => {
        await syncState();
        render();
      }, view.loadError ? 2500 : 650);
    }
  }
}

async function submitJob(kind, payload, preview = null) {
  const result = await api(`jobs/${kind}`, 'POST', payload);
  state.job = { id: result.id, kind, status: 'queued' };
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

function fileThumbnail(file, interactive = false, card = false) {
  const picture = file.kind === 'photo';
  const image = file.thumbnail ? `<img src="${escapeHtml(file.thumbnail)}" alt="" loading="lazy">` : '';
  const contents = `${icon(picture ? 'photo' : 'video')}${image}`;
  if (interactive && file.preview) {
    return `<button type="button" class="thumb" data-action="preview-incoming" data-value="${escapeHtml(file.id)}"
      aria-label="${escapeHtml(file.name)} 미리보기" ${card ? 'data-card-preview' : ''}>${contents}</button>`;
  }
  return `<span class="thumb">${contents}</span>`;
}

function fileCell(file, detail, interactive = false) {
  return `<div class="file-cell">
    ${fileThumbnail(file, interactive)}
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
    <div>${button('delete-incoming', '사진 삭제', { glyph: 'trash', danger: true, disabled: !photos || jobActive() })}
    ${button('move-incoming', moveLabel, { glyph: 'arrow', primary: true, disabled: !movable || jobActive() })}</div>`;
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
      ${button('link-xmp', '선택한 XMP 연결', { primary: true, disabled: !selected.length || duplicated || jobActive() })}</div>
  </section>`;
}

function incomingPage() {
  const results = state.incoming.filter(file => !view.incomingKind || file.kind === view.incomingKind);
  const active = jobActive();
  const failed = state.job?.status === 'failed';
  const scanning = active && state.job.kind === 'scan';
  const jobLabels = { scan: 'incoming 검사 중', move: '선택한 파일 이동 및 분석 중', delete: '선택한 사진 삭제 중', 'xmp-link': 'XMP 연결 중' };
  const status = active ? jobLabels[state.job.kind] :
    failed ? '작업 실패' : state.scan ? '최근 검사 완료' : '검사 대기';
  const detail = failed ? state.job.result.error : active ? (scanning ? '중복을 확인하고 썸네일을 만들고 있습니다.' : '완료되면 결과에 반영됩니다.') :
    state.scan ? `${dateTimeFormatter(state.timezone).format(new Date(state.scan.finishedAt))} · ${state.scan.result.checked}개 검사` : '새로 고침을 눌러 검사를 시작하세요.';
  return `${header('Incoming Library', '사진과 영상을 검사하고 managed로 옮길 파일을 선택하세요.',
    button('scan', scanning ? '검사 중…' : '새로 고침', { glyph: 'refresh', disabled: active || view.connecting }))}
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
  return event.start ? `${event.start.slice(2).replaceAll('-', '')}_${event.name}` : event.name;
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
  return files.filter(file => (!view.eventDevice || file.device === view.eventDevice) &&
    (!view.eventDate || eventDateForFile(file) === view.eventDate) &&
    (!query || file.name.toLocaleLowerCase().includes(query) || file.device?.toLocaleLowerCase().includes(query) || matchesXmp(file, query)));
}

function eventPage() {
  const event = eventById(view.eventId);
  const files = footageForEvent(view.eventId);
  const filtered = filteredEventFiles(files);
  const dates = [...new Set(files.map(eventDateForFile).filter(Boolean))].sort();
  const parent = event?.parent ? eventById(event.parent) : event;
  const footageDate = dateTimeFormatter(parent?.zone || state.timezone);
  const destinations = eventDestinations(event);
  const devices = [...new Set(files.map(file => file.device).filter(Boolean))];
  const selected = view.eventSelection.size;
  const confirmButton = event ? button('confirm-event', '선택 배치 확정', {
    glyph: 'check', primary: true, disabled: !filtered.some(file => view.eventSelection.has(file.id) && !file.confirmed),
  }) : '';
  return `${header('이벤트 관리', '촬영 기간으로 사진과 영상을 모으고, 필요한 파일을 소분류로 배정하세요.',
    button('new-event', '이벤트 생성', { glyph: 'plus', primary: true }))}
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
            <div class="event-meta small muted">${parent ? `${parent.start} ~ ${parent.end} · ` : ''}${files.length}개 파일</div>
          </div>
          ${event ? `<div class="event-header-actions">
            ${!event.parent ? button('new-child', '소분류 추가', { glyph: 'plus' }) : ''}
            ${button('edit-event', event.parent ? '소분류 수정' : '이벤트 수정', { glyph: 'edit' })}
            ${button('delete-event', event.parent ? '소분류 삭제' : '이벤트 삭제', { glyph: 'trash', danger: true })}
          </div>` : ''}
        </div>
        <div class="event-tools">
          <label class="search"><span class="sr-only">이벤트 파일 검색</span>${icon('search')}<input type="search" id="event-search" placeholder="파일명·XMP 검색" value="${escapeHtml(view.eventQuery)}"></label>
          <select id="event-device" aria-label="촬영 장비 필터"><option value="">모든 장비</option>${devices.map(device =>
            `<option value="${escapeHtml(device)}" ${view.eventDevice === device ? 'selected' : ''}>${escapeHtml(device)}</option>`).join('')}</select>
          <select id="event-date" aria-label="촬영일 필터"><option value="">모든 촬영일</option>${dates.map(date =>
            `<option ${view.eventDate === date ? 'selected' : ''}>${date}</option>`).join('')}</select>
          ${event && !event.parent ? button('collect', '기간으로 모으기', { glyph: 'refresh' }) : ''}
          ${confirmButton}
        </div>
        <div class="table-wrap">${filtered.length ? `<table aria-label="이벤트별 파일">
          <thead><tr><th scope="col">${checkbox('event-all', 'all', '표시된 이벤트 파일 모두 선택', new Set(filtered.every(file => view.eventSelection.has(file.id)) ? ['all'] : []))}</th>
            <th scope="col">파일</th><th scope="col">촬영 일시</th><th scope="col">배치 상태</th></tr></thead>
          <tbody>${filtered.map(file => `<tr class="${view.eventSelection.has(file.id) ? 'selected' : ''}">
            <td>${checkbox('event', file.id, `${file.name} 선택`, view.eventSelection)}</td>
            <td>${fileCell(file, file.device || '장비 확인 필요')}${file.xmp ? `<button type="button" class="time-edit-link" data-action="view-xmp" data-value="${escapeHtml(file.id)}">XMP 정보</button>` : ''}</td>
            <td class="numbers muted">${file.time ? footageDate.format(new Date(file.time)) : '—'}
              ${file.timeSource ? `<div class="file-reason small">${escapeHtml(file.timeSource)}${file.timeVerified ? '' : ' · 확인 필요'}</div>` : ''}
              ${file.analysisError ? `<div class="file-reason small">${escapeHtml(file.analysisError)}</div>` : ''}
              ${!file.timeVerified ? `<button type="button" class="time-edit-link" data-action="resolve-time" data-value="${escapeHtml(file.id)}" aria-label="${escapeHtml(file.name)} 촬영 시각 지정">촬영 시각 지정</button>` : ''}</td>
            <td>${file.reviewReason ? badge('review', escapeHtml(file.reviewReason)) :
              badge(file.confirmed ? 'ready' : 'draft', file.confirmed ? '확정' : file.eventId ? '초안' : '미배정')}</td>
          </tr>`).join('')}</tbody>
        </table>` : emptyState('video', '표시할 푸티지가 없습니다.', event && !event.parent ? '기간으로 모으기를 눌러 미배정 영상을 찾을 수 있습니다.' : '')}</div>
        <div class="action-bar">
          <div>
            ${destinations.length ? `<select id="move-event-target" aria-label="이동할 이벤트"><option value="">이동할 이벤트</option>${destinations.map(item => `<option value="${item.id}">${escapeHtml(eventOptionLabel(item))}</option>`).join('')}</select>
            ${button('move-event', '이동', { disabled: true })}` : ''}
            ${button('edit-media', '장비·촬영 시각 수정', { disabled: !selected })}
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
  return state.managed.filter(file => file.confirmed && eventById(file.eventId));
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
  const busy = jobActive() || view.uploadStarting;
  return `${header('아카이브 전송', '파일·폴더를 선택해 업로드하거나 Destination으로 드래그하세요.', '')}
    ${uploadStatus()}
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
          ${button('connect-archive', view.archiveBusy ? '조회 중…' : view.archiveError ? '다시 연결' : view.archive ? '새로 고침' : '아카이브 연결',
            { glyph: 'refresh', primary: !view.archive, disabled: view.archiveBusy })}</div>
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
        (archive.entries.length ? `<ul class="tree">${archive.entries.map((entry, index) => `<li class="tree-row">
          ${entry.kind === 'folder' ? `<button type="button" class="tree-button" data-action="open-archive" data-value="${index}" ${!jobActive() && !view.uploadStarting ? `data-archive-drop="${escapeHtml([view.archivePath, entry.name].filter(Boolean).join('/'))}"` : ''}>${icon('folder')}<span>${escapeHtml(entry.name)}</span>${icon('right')}</button>` :
            `<span class="tree-file">${icon('file')}${escapeHtml(entry.name)}</span><span class="meta numbers">${entry.kind === 'link' ? '심볼릭 링크' : sizeLabel(entry.size === null ? null : entry.size / 1_000_000)}</span>`}
        </li>`).join('')}</ul>` : emptyState('folder', '빈 폴더입니다.')) :
        emptyState('disk', view.archiveError ? '파일 목록을 불러오지 못했습니다.' : '원격 아카이브에 연결하세요.',
          view.archiveError ? '다시 연결하거나 설정에서 SSH 연결 정보를 확인하세요.' : '설정에 저장된 SSH 연결 정보와 저장 절대경로를 사용합니다.')}
    </div>`;
}

function uploadStatus() {
  const job = state.job;
  if (job?.kind !== 'upload') return '';
  const result = job.result || {};
  const active = jobActive(job);
  const percent = Math.min(100, Math.round((result.transferredBytes || 0) / (result.totalBytes || 1) * 100));
  return `<section class="surface upload-status" aria-label="아카이브 업로드 상태">
    <div class="upload-summary"><strong role="status">${active ? job.status === 'queued' ? '업로드 대기 중' : result.phase || '업로드 중' : job.status === 'done' ? '업로드 완료' : job.status === 'cancelled' ? '업로드 중지됨' : '업로드 실패'}</strong>
      <span class="small muted">${result.completedFiles || 0} / ${result.totalFiles || 0}개 처리 · 업로드 ${result.uploaded || 0}개 · 건너뜀 ${result.skipped || 0}개 · 실패 ${result.failed || 0}개</span>
      ${active ? button('cancel-archive-upload', result.cancelRequested ? '중지 중…' : '업로드 중지', { disabled: result.cancelRequested }) : ''}</div>
    ${active ? `<progress max="100" value="${percent}" aria-label="업로드 진행률">${percent}%</progress><p class="small muted archive-path">${escapeHtml(result.current || '서버에 연결하고 있습니다.')} · ${sizeLabel((result.transferredBytes || 0) / 1_000_000)} / ${sizeLabel((result.totalBytes || 0) / 1_000_000)}</p>` : ''}
    ${result.error && job.status !== 'cancelled' ? `<p class="form-error" role="alert">${escapeHtml(result.error)}</p>` : ''}
    ${result.errors?.length ? `<details><summary>실패한 파일 ${result.failed}개${result.failed > result.errors.length ? ` 중 ${result.errors.length}개 표시` : ''}</summary><ul>${result.errors.map(error => `<li><span class="archive-path">${escapeHtml(error.path)}</span>: ${escapeHtml(error.message)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

async function startArchiveUpload(keys = [...view.sourceSelection], source = [...view.sourcePath], destination = view.archivePath) {
  if (jobActive() || view.uploadStarting || view.archiveBusy || !view.archive || !keys.length) return;
  if (keys.length > 10000) throw new Error('한 번에 최대 10,000개 파일을 업로드할 수 있습니다. 나누어 선택하세요.');
  view.uploadStarting = true;
  render();
  try {
    const items = keys.map(key => { const [id, kind] = key.split(':'); return { id, kind }; });
    const result = await api('archive/transfers', 'POST', { items, source, destination, connection: view.archive.connectionVersion });
    state.job = { id: result.id, kind: 'upload', status: 'queued', result: { totalFiles: result.count } };
    await syncState();
    announce(`${result.count}개 파일의 업로드를 시작합니다.`);
  } finally {
    view.uploadStarting = false;
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
  return `${header('설정', '스토리지 연결 정보와 카탈로그 백업을 관리하세요.', '')}
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
      ${settingRow('SSH 접속 테스트', view.sshTestResult ? `<span role="status" class="${view.sshTestResult.ok ? 'ssh-test-success' : 'form-error'}">${escapeHtml(view.sshTestResult.message)}</span>` :
        '저장된 IP, 계정명, 키로 공개키 인증을 확인합니다.',
        button('test-storage-ssh', view.sshTestBusy ? '테스트 중…' : '접속 테스트', { glyph: 'refresh', disabled: !settings || view.sshTestBusy }))}
    </section>
    <section class="surface settings-section" aria-label="DB 백업 및 복원">
      <div class="surface-head"><h2>${icon('file')} DB 백업 및 복원</h2></div>
      ${settingRow('카탈로그 백업', '이벤트와 파일 배치가 포함된 SQLite 백업을 다운로드합니다.',
        button('download-catalog', 'DB 백업 다운로드', { glyph: 'download', disabled: jobActive() }))}
      ${settingRow('카탈로그 복원', '선택한 백업의 내용으로 현재 카탈로그를 교체합니다.',
        `<input id="restore-catalog-file" type="file" accept=".sqlite3,.sqlite,.db,application/octet-stream" hidden>` +
        (view.restoreFile ? maskedSetting('파일 선택됨') : '') + button('pick-catalog-file', '백업 파일 선택') +
        button('restore-catalog', '복원', { glyph: 'upload', danger: true, disabled: !view.restoreFile || jobActive() }))}
    </section>`;
}

async function loadSettings() {
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

async function downloadCatalog() {
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
}

function confirmCatalogRestore() {
  const file = view.restoreFile;
  if (!file) return;
  showDialog('카탈로그 복원', `<p>선택한 백업으로 현재 이벤트와 파일 배치를 교체합니다.</p>
    <p>원본 사진과 영상은 디스크에 보관됩니다.</p>`, 'DB 복원', async () => {
    await api('settings/catalog/restore', 'POST', file);
    view.restoreFile = null;
    view.incomingSelection.clear();
    view.xmpChoices.clear();
    chooseEvent('unassigned');
    view.sourcePath = [];
    await syncState();
    announce('카탈로그를 복원했습니다.');
  }, { danger: true });
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
    <p class="small muted">아카이브 폴더 이름은 <strong>${escapeHtml(event.folder)}</strong>으로 유지됩니다.</p>`,
  '변경 저장', async form => {
    await api(`events/${event.id}`, 'PUT', Object.fromEntries(form));
    view.eventDate = '';
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
  const hasMetadata = files.every(file => file.timeCandidates?.metadata);
  const hasXmp = files.every(file => file.timeCandidates?.xmp);
  const hasModified = files.every(file => file.timeCandidates?.modified);
  const metadataLabel = files.every(file => file.kind === 'photo') ? 'EXIF 시각 사용' : '메타데이터 시각 사용';
  const mode = suggestSource && hasXmp ? 'xmp' : suggestSource && hasMetadata ? 'metadata' : suggestSource && hasModified ? 'modified' : 'manual';
  const event = eventById(view.eventId);
  const root = event?.parent ? eventById(event.parent) : event;
  const defaultZone = root?.zone || state.timezone;
  showDialog('장비·촬영 시각 수정', `
    <label>촬영 장비<input name="device" maxlength="80" placeholder="예시 · GoPro 또는 unknown"></label>
    <label>촬영 시각 출처<select id="media-time-mode" name="time_mode">
      <option value="manual" ${mode === 'manual' ? 'selected' : ''}>직접 입력</option>
      <option value="metadata" ${mode === 'metadata' ? 'selected' : ''} ${hasMetadata ? '' : 'disabled'}>${metadataLabel}${hasMetadata ? '' : ' (사용 가능한 값 없음)'}</option>
      <option value="xmp" ${mode === 'xmp' ? 'selected' : ''} ${hasXmp ? '' : 'disabled'}>XMP 시각 사용</option>
      <option value="modified" ${mode === 'modified' ? 'selected' : ''} ${hasModified ? '' : 'disabled'}>파일 수정 시각 사용</option>
    </select></label>
    <div class="date-grid" id="media-time-fields">
      <label id="media-manual-time">촬영 시각<input type="datetime-local" name="captured_at"></label>
      <label id="media-time-zone">촬영 시간대<select name="zone">${zoneOptions(defaultZone)}</select></label>
    </div>
    <p id="media-time-note" class="small muted" role="status" hidden></p>`,
  '변경 저장', async form => {
    const timeMode = form.get('time_mode');
    const payload = { ids: files.map(file => file.id), zone: form.get('zone') || defaultZone };
    const device = form.get('device').trim();
    const time = form.get('captured_at');
    if (device) payload.device = device;
    if (timeMode === 'manual' && time) payload.captured_at = time;
    if (timeMode !== 'manual') payload.time_mode = timeMode;
    await api('media', 'PATCH', payload);
    view.eventSelection.clear();
    view.eventDevice = '';
    view.eventDate = '';
    await syncState();
    announce('선택한 파일의 정보를 수정했습니다.');
  });
  const modeControl = dialog.querySelector('#media-time-mode');
  const dateField = dialog.querySelector('#media-manual-time');
  const zoneField = dialog.querySelector('#media-time-zone');
  const zoneControl = zoneField.querySelector('select');
  const note = dialog.querySelector('#media-time-note');
  function updateTimeFields() {
    const mode = modeControl.value;
    const metadataMode = mode === 'metadata' || mode === 'xmp';
    dateField.hidden = mode !== 'manual';
    zoneField.hidden = mode === 'modified' || (metadataMode && files.every(file => file.timeCandidates[mode].verified));
    dateField.querySelector('input').disabled = dateField.hidden;
    zoneControl.disabled = zoneField.hidden;
    dialog.querySelector('#media-time-fields').hidden = dateField.hidden && zoneField.hidden;
    note.hidden = mode === 'manual';
    if (mode === 'manual') return;
    if (files.length > 1) {
      note.textContent = mode === 'modified' ? '파일마다 해당 파일의 수정 시각을 사용합니다.' :
        '파일마다 메타데이터에 기록된 시각을 사용합니다. 시간대 정보가 없는 파일에는 선택한 시간대를 적용합니다.';
    } else if (mode === 'modified') {
      note.textContent = `파일 수정 시각 ${dateTimeFormatter(defaultZone).format(new Date(files[0].timeCandidates.modified))} · ${defaultZone}`;
    } else {
      const candidate = files[0].timeCandidates[mode];
      const selected = candidate.verified ? `${candidate.source} ${candidate.raw || candidate.time}` :
        `${candidate.source} ${candidate.raw} · ${zoneControl.value}로 해석`;
      const alternative = files[0].timeCandidates[mode === 'xmp' ? 'metadata' : 'xmp'];
      note.textContent = alternative ? `${selected} / ${alternative.source} ${alternative.raw || alternative.time}` : selected;
    }
  }
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
  view.eventDevice = '';
  view.eventDate = '';
  view.eventQuery = '';
  view.eventTarget = '';
}

function updateEventActions() {
  const target = page.querySelector('#move-event-target');
  if (target) {
    target.value = view.eventTarget || '';
    page.querySelector('[data-action="move-event"]').disabled = !target.value || !view.eventSelection.size;
  }
}



function render() {
  const incomingTable = page.querySelector('#incoming-rows');
  const tableScroll = incomingTable ? { top: incomingTable.scrollTop, left: incomingTable.scrollLeft } : null;
  const xmpScroll = page.querySelector('.xmp-matches')?.scrollTop;
  const active = document.activeElement;
  const keepFocus = active && page.contains(active);
  const route = location.hash.slice(1);
  const current = navigation.find(item => item.id === route) || navigation[0];
  const pageChanged = view.page !== current.id;
  const views = { incoming: incomingPage, events: eventPage, archive: archivePage, settings: settingsPage };
  view.page = current.id;
  nav.innerHTML = navigation.map(item => `<a class="nav-link" href="#${item.id}"${item.id === current.id ? ' aria-current="page"' : ''}>${icon(item.icon)}${item.title}</a>`).join('');
  const status = view.loadError ? `<p class="scan-strip" role="alert">${escapeHtml(view.loadError)}</p>` : '';
  page.innerHTML = `<main aria-labelledby="page-title">${status}${views[view.page]()}</main>`;
  document.title = `${current.title} · Photo Saver`;
  if (view.page === 'events') updateEventActions();
  if (view.page === 'archive') {
    const entries = sourceEntries();
    page.querySelectorAll('[data-select="source"]').forEach(input => {
      const keys = entries[Number(input.value)]?.assets || [];
      input.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !keys.every(key => view.sourceSelection.has(key));
      input.disabled = jobActive() || view.uploadStarting;
    });
    const all = page.querySelector('[data-select="source-all"]');
    const keys = entries.flatMap(entry => entry.assets);
    if (all) {
      all.indeterminate = keys.some(key => view.sourceSelection.has(key)) && !keys.every(key => view.sourceSelection.has(key));
      all.disabled = !keys.length || jobActive() || view.uploadStarting;
    }
  }
  if (pageChanged) {
    window.scrollTo(0, 0);
    return;
  }
  if (tableScroll) page.querySelector('#incoming-rows').scrollTo(tableScroll);
  if (xmpScroll) page.querySelector('.xmp-matches')?.scrollTo(0, xmpScroll);
  if (keepFocus) {
    const replacement = [...page.querySelectorAll('button, input, select')].find(element => {
      if (active.id) return element.id === active.id;
      if (active.dataset.action) return element.dataset.action === active.dataset.action && element.dataset.value === active.dataset.value;
      if (active.dataset.xmpId) return element.dataset.xmpId === active.dataset.xmpId;
      return active.dataset.select && element.dataset.select === active.dataset.select && element.value === active.value;
    });
    replacement?.focus({ preventScroll: true });
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

function currentPreviewFile() {
  const preview = view.preview;
  return preview && state.incoming.find(file => file.id === preview.ids[preview.index]);
}

function openIncomingPreview(id) {
  const ids = filteredIncoming().filter(file => file.preview).map(file => file.id);
  const index = ids.indexOf(id);
  if (index < 0) return;
  view.preview = { ids, index, confirming: false, busy: false, jobId: null, message: '' };
  renderMediaPreview();
}

function renderMediaPreview() {
  const file = currentPreviewFile();
  if (!file) return;
  const name = escapeHtml(file.name);
  const src = file.preview ? escapeHtml(file.preview) : '';
  const media = !src ? '' : file.kind === 'photo' ? `<img src="${src}" alt="${name}" decoding="async">` :
    `<video src="${src}" ${file.thumbnail ? `poster="${escapeHtml(file.thumbnail)}"` : ''} controls preload="metadata" playsinline></video>`;
  mediaPreview.innerHTML = `<div class="preview-frame">
    <header class="preview-header"><div class="preview-title"><h2 id="media-preview-title" tabindex="-1">${name}</h2>
      <p class="small muted">${escapeHtml(file.folder ? `incoming/${file.folder}` : 'incoming')} · ${sizeLabel(file.size)}</p></div>
      ${smallButton('close-preview', '미리보기 닫기', 'close')}</header>
    <div class="preview-stage">
      ${media}
      ${src ? '<p class="preview-media-loading" role="status">원본 불러오는 중…</p>' : ''}
      <p class="preview-media-error" role="status" ${src ? 'hidden' : ''}>미리보기를 열 수 없습니다. 원본 파일을 열거나 Incoming Library를 새로 고침하세요.</p>
    </div>
    <footer class="preview-footer"></footer>
  </div>`;
  renderPreviewFooter();
  if (!mediaPreview.open) mediaPreview.showModal();
  mediaPreview.querySelector('#media-preview-title').focus();
}

function renderPreviewFooter() {
  const file = currentPreviewFile();
  const preview = view.preview;
  const footer = mediaPreview.querySelector('.preview-footer');
  if (!file || !footer) return;
  const canDelete = canDeleteIncoming(file) && !jobActive();
  const counter = `<span class="numbers preview-count">${preview.index + 1} / ${preview.ids.length}</span>`;
  if (preview.confirming || preview.busy) {
    footer.innerHTML = `<p role="status">${preview.busy ? '사진을 삭제하고 있습니다.' :
      `<strong>${escapeHtml(file.name)}</strong> 파일을 incoming에서 영구 삭제합니다.`}</p>
      <div class="preview-controls">
        ${button('cancel-preview-delete', '취소', { disabled: preview.busy })}
        ${button('perform-preview-delete', '사진 삭제', { primary: true, danger: true, disabled: preview.busy })}
      </div>`;
    if (!preview.busy) footer.querySelector('[data-action="perform-preview-delete"]').focus();
    return;
  }
  const original = file.original ? `<a class="button" href="${escapeHtml(file.original)}" target="_blank" rel="noopener">원본 열기</a>` : '';
  footer.innerHTML = `<div class="preview-controls" role="group" aria-label="파일 이동">
      ${button('previous-preview', '이전', { glyph: 'left', disabled: preview.index === 0 })}${counter}
      ${button('next-preview', '다음', { glyph: 'right', disabled: preview.index === preview.ids.length - 1 })}
    </div>
    <div class="preview-controls">
      ${original}${canDelete ? button('request-preview-delete', '사진 삭제', { glyph: 'trash', danger: true }) : ''}
    </div>
    <p class="preview-hint small muted" ${preview.message ? 'role="status"' : ''}>${preview.message ? escapeHtml(preview.message) :
      `<kbd>←</kbd> <kbd>→</kbd> 이동${canDelete ? ' · <kbd>Delete</kbd> 삭제' : ''}`}</p>`;
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

function requestPreviewDelete() {
  const file = currentPreviewFile();
  if (!file || jobActive() || !canDeleteIncoming(file) || view.preview.busy) return;
  view.preview.confirming = true;
  renderPreviewFooter();
}

function cancelPreviewDelete() {
  if (view.preview.busy) return;
  view.preview.confirming = false;
  renderPreviewFooter();
  mediaPreview.querySelector('[data-action="request-preview-delete"]')?.focus();
}

async function performPreviewDelete() {
  const preview = view.preview;
  const file = currentPreviewFile();
  if (!file || !preview.confirming || preview.busy || jobActive()) return;
  preview.busy = true;
  renderPreviewFooter();
  mediaPreview.querySelector('#media-preview-title').focus();
  try {
    await submitJob('delete', { ids: [file.id] }, preview);
  } catch (error) {
    preview.busy = false;
    preview.confirming = false;
    preview.message = error.message;
    if (view.preview === preview) renderPreviewFooter();
  }
  render();
}

function updatePreviewAfterDelete() {
  const preview = view.preview;
  const job = state.job;
  if (!preview?.jobId || preview.jobId !== job?.id || jobActive(job)) return;
  preview.busy = false;
  preview.confirming = false;
  preview.jobId = null;
  if (job.status === 'done' && job.result.deleted) {
    preview.ids.splice(preview.index, 1);
    if (!preview.ids.length) {
      mediaPreview.close();
      return;
    }
    preview.index = Math.min(preview.index, preview.ids.length - 1);
    preview.message = '선택한 사진을 삭제했습니다.';
    renderMediaPreview();
  } else {
    preview.message = job.status === 'failed' ? job.result.error : '사진이 변경되었거나 삭제할 수 없습니다. 새로 고침 후 다시 확인하세요.';
    renderPreviewFooter();
  }
}

const previewActions = {
  'previous-preview': () => stepPreview(-1),
  'next-preview': () => stepPreview(1),
  'close-preview': () => mediaPreview.close(),
  'request-preview-delete': requestPreviewDelete,
  'cancel-preview-delete': cancelPreviewDelete,
  'perform-preview-delete': performPreviewDelete,
};

function confirmEvent() {
  const files = footageForEvent(view.eventId).filter(file => view.eventSelection.has(file.id) && !file.confirmed);
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
  'move-incoming'() { return submitJob('move', { ids: selectedIncoming(file => file.status === 'ready').map(file => file.id) }); },
  'delete-incoming': confirmDeleteIncoming,
  'link-xmp'() { return submitJob('xmp-link', { links: pendingXmpLinks() }); },
  'view-xmp': showXmp,
  'edit-storage-address': editStorageAddress,
  'edit-storage-root': editStorageRoot,
  'generate-storage-key': generateStorageKey,
  'regenerate-storage-key': regenerateStorageKey,
  'copy-public-key': copyStorageKey,
  'test-storage-ssh': testStorageSsh,
  'download-catalog': downloadCatalog,
  'pick-catalog-file'() { page.querySelector('#restore-catalog-file').click(); },
  'restore-catalog': confirmCatalogRestore,
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
  'resolve-time'(id) { editMedia([id], true); },
  'confirm-event': confirmEvent,
  'open-source'(value) { view.sourcePath.push(sourceEntries()[Number(value)].name); view.sourceSelection.clear(); },
  'source-up'() { view.sourcePath.pop(); view.sourceSelection.clear(); },
  'upload-archive'() { return startArchiveUpload(); },
  async 'cancel-archive-upload'() {
    state.job = await api(`archive/transfers/${state.job.id}/cancel`, 'POST');
    await syncState();
  },
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
  if (!row || jobActive() || view.uploadStarting) return;
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
  if (!target || !view.dragSource || jobActive() || view.uploadStarting) return;
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

page.addEventListener('change', event => {
  const control = event.target;
  if (control.dataset.select) {
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

mediaPreview.addEventListener('click', event => {
  const action = event.target.closest('button[data-action]')?.dataset.action;
  if (action) previewActions[action]();
});

mediaPreview.addEventListener('keydown', event => {
  const preview = view.preview;
  if (!preview) return;
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    if (!event.repeat && !preview.confirming) requestPreviewDelete();
  } else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target.tagName !== 'VIDEO') {
    event.preventDefault();
    stepPreview(event.key === 'ArrowLeft' ? -1 : 1);
  }
});

mediaPreview.addEventListener('cancel', event => {
  if (view.preview?.confirming && !view.preview.busy) {
    event.preventDefault();
    cancelPreviewDelete();
  }
});

mediaPreview.addEventListener('close', () => {
  const id = view.preview?.ids[view.preview.index];
  view.preview = null;
  mediaPreview.replaceChildren();
  if (view.page === 'incoming') {
    const button = [...page.querySelectorAll('[data-action="preview-incoming"]')].find(element => element.dataset.value === id);
    (button || page.querySelector('[data-action="incoming-layout"][aria-pressed="true"]'))?.focus();
  }
});

mediaPreview.addEventListener('error', event => {
  if (!event.target.matches('.preview-stage img, .preview-stage video')) return;
  event.target.hidden = true;
  event.target.parentElement.querySelector('.preview-media-loading')?.remove();
  mediaPreview.querySelector('.preview-media-error').hidden = false;
}, true);

for (const type of ['load', 'loadedmetadata']) {
  mediaPreview.addEventListener(type, event => {
    if (event.target.matches('.preview-stage img, .preview-stage video')) {
      event.target.parentElement.querySelector('.preview-media-loading')?.remove();
    }
  }, true);
}

dialog.addEventListener('click', event => {
  if (event.target.closest('[data-action="close-dialog"]')) dialog.close();
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
function loadRoute() {
  if (mediaPreview.open) mediaPreview.close();
  render();
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
