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
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  disk: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18m-14 3h.01m4 0h.01"/>',
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
];



function dateTimeFormatter(timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

const state = { incoming: [], managed: [], events: [], scan: null, job: null, timezone: 'Asia/Seoul' };
const view = {
  page: '', incomingFilter: 'all', incomingKind: '', query: '', connecting: true, loadError: '',
  incomingSelection: new Set(), eventId: 'unassigned', eventSelection: new Set(), eventDevice: '', eventDate: '',
  eventTarget: '', sourcePath: [],
};
let refreshTimer;
let stateRequest = 0;

const page = document.getElementById('page');
const nav = document.getElementById('navigation');
const dialog = document.getElementById('dialog');
const notice = document.getElementById('notice');
let noticeTimeout;


async function api(path, method = 'GET', data) {
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method,
      cache: 'no-store',
      headers: data ? { 'Content-Type': 'application/json' } : undefined,
      body: data ? JSON.stringify(data) : undefined,
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
  if (job.status === 'failed') return job.result.error;
  if (job.kind === 'scan') return `${job.result.checked}개 파일의 검사를 완료했습니다.`;
  if (job.kind === 'delete') return `사진 ${job.result.deleted}개를 삭제했습니다.${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
  return `${job.result.moved}개를 managed로 옮겼습니다.${job.result.duplicate ? ` 중복 ${job.result.duplicate}개.` : ''}${job.result.review ? ` 확인 필요 ${job.result.review}개.` : ''}`;
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
    }
    const selectable = new Set(state.incoming.filter(canSelectIncoming).map(file => file.id));
    for (const id of view.incomingSelection) {
      if (!selectable.has(id)) view.incomingSelection.delete(id);
    }
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

async function submitJob(kind, payload) {
  const result = await api(`jobs/${kind}`, 'POST', payload);
  state.job = { id: result.id, kind, status: 'queued' };
  view.incomingSelection.clear();
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

function fileCell(file, detail) {
  const name = escapeHtml(file.name);
  const picture = file.kind === 'photo' || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  const image = file.thumbnail ? `<img src="${escapeHtml(file.thumbnail)}" alt="" loading="lazy">` : '';
  return `<div class="file-cell">
    <span class="thumb">${icon(picture ? 'photo' : 'video')}${image}</span>
    <div><strong>${name}</strong>${detail ? `<span class="small muted">${escapeHtml(detail)}</span>` : ''}</div>
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

function filteredIncoming() {
  const query = view.query.trim().toLocaleLowerCase();
  return state.incoming.filter(file =>
    (view.incomingFilter === 'all' || file.status === view.incomingFilter) &&
    (!view.incomingKind || file.kind === view.incomingKind) &&
    (!query || file.name.toLocaleLowerCase().includes(query) || file.folder.toLocaleLowerCase().includes(query))
  );
}

function checkbox(kind, id, label, selection) {
  return `<input type="checkbox" data-select="${kind}" value="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" ${selection.has(id) ? 'checked' : ''}>`;
}

function incomingRows() {
  const files = filteredIncoming();
  if (!files.length) return emptyState('inbox', '표시할 파일이 없습니다.',
    state.scan ? '파일을 추가하거나 검사 결과 필터를 확인하세요.' : 'incoming에 사진이나 영상을 넣고 새로 고침하세요.');
  const available = files.filter(canSelectIncoming);
  return `<table aria-label="Incoming 검사 결과">
    <thead><tr>
      <th scope="col">${available.length ? checkbox('incoming-all', 'all', '표시된 파일 모두 선택', new Set(available.every(file => view.incomingSelection.has(file.id)) ? ['all'] : [])) : ''}</th>
      <th scope="col">파일</th><th scope="col">수정 일시</th><th scope="col">크기</th><th scope="col">검사 결과</th>
    </tr></thead>
    <tbody>${files.map(file => `<tr class="${view.incomingSelection.has(file.id) ? 'selected' : ''}">
      <td>${canSelectIncoming(file) ? checkbox('incoming', file.id, `${file.name} 선택`, view.incomingSelection) : ''}</td>
      <td>${fileCell(file, file.folder)}</td>
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

function incomingPage() {
  const results = state.incoming.filter(file => !view.incomingKind || file.kind === view.incomingKind);
  const active = jobActive();
  const failed = state.job?.status === 'failed';
  const scanning = active && state.job.kind === 'scan';
  const jobLabels = { scan: 'incoming 검사 중', move: '선택한 파일 이동 및 분석 중', delete: '선택한 사진 삭제 중' };
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
      <div class="surface-head"><h2 id="incoming-title">검사 결과</h2><span class="mono muted">/incoming</span></div>
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
    </section>`;
}

function eventById(id) {
  return state.events.find(event => event.id === id);
}

function childEvents(id) {
  return state.events.filter(event => event.parent === id);
}

function footageForEvent(id) {
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

function eventOptionLabel(event) {
  return event.parent ? `${eventById(event.parent).folder} / ${event.folder}` : event.folder;
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
  return files.filter(file => (!view.eventDevice || file.device === view.eventDevice) &&
    (!view.eventDate || eventDateForFile(file) === view.eventDate));
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
  return `${header('이벤트 관리', '촬영 기간으로 사진과 영상을 모으고, 필요한 파일을 소분류로 배정하세요.',
    button('new-event', '이벤트 생성', { glyph: 'plus', primary: true }))}
    <div class="event-split">
      <section class="surface" aria-label="이벤트 목록">
        <div class="surface-head"><h2>이벤트</h2></div>
        <div class="event-list">
          ${eventLink('unassigned', '미배정', footageForEvent('unassigned').length)}
          ${state.events.filter(item => !item.parent).map(item => {
            const children = childEvents(item.id);
            const total = footageForEvent(item.id).length + children.reduce((sum, child) => sum + footageForEvent(child.id).length, 0);
            return eventLink(item.id, item.folder, total) + children.map(child => eventLink(child.id, child.name, footageForEvent(child.id).length, true)).join('');
          }).join('')}
        </div>
      </section>
      <section class="surface" aria-label="이벤트 푸티지">
        <div class="surface-head">
          <div><h2>${escapeHtml(event?.folder || '미배정 푸티지')}</h2>
            <div class="event-meta small muted">${parent ? `${parent.start} ~ ${parent.end} · ` : ''}${files.length}개 파일</div>
          </div>
          ${event && !event.parent ? button('new-child', '소분류 추가', { glyph: 'plus' }) : ''}
        </div>
        <div class="event-tools">
          <select id="event-device" aria-label="촬영 장비 필터"><option value="">모든 장비</option>${devices.map(device =>
            `<option value="${escapeHtml(device)}" ${view.eventDevice === device ? 'selected' : ''}>${escapeHtml(device)}</option>`).join('')}</select>
          <select id="event-date" aria-label="촬영일 필터"><option value="">모든 촬영일</option>${dates.map(date =>
            `<option ${view.eventDate === date ? 'selected' : ''}>${date}</option>`).join('')}</select>
          ${event && !event.parent ? button('collect', '기간으로 모으기', { glyph: 'refresh' }) : ''}
        </div>
        <div class="table-wrap">${filtered.length ? `<table aria-label="이벤트별 파일">
          <thead><tr><th scope="col">${checkbox('event-all', 'all', '표시된 이벤트 파일 모두 선택', new Set(filtered.every(file => view.eventSelection.has(file.id)) ? ['all'] : []))}</th>
            <th scope="col">파일</th><th scope="col">촬영 일시</th><th scope="col">배치 상태</th></tr></thead>
          <tbody>${filtered.map(file => `<tr class="${view.eventSelection.has(file.id) ? 'selected' : ''}">
            <td>${checkbox('event', file.id, `${file.name} 선택`, view.eventSelection)}</td>
            <td>${fileCell(file, file.device || '장비 확인 필요')}</td>
            <td class="numbers muted">${file.time ? footageDate.format(new Date(file.time)) : '—'}
              ${file.timeSource ? `<div class="file-reason small">${escapeHtml(file.timeSource)}${file.timeVerified ? '' : ' · 확인 필요'}</div>` : ''}
              ${file.analysisError ? `<div class="file-reason small">${escapeHtml(file.analysisError)}</div>` : ''}</td>
            <td>${file.reviewReason ? badge('review', escapeHtml(file.reviewReason)) :
              badge(file.confirmed ? 'ready' : 'draft', file.confirmed ? '확정' : event ? '초안' : '미배정')}</td>
          </tr>`).join('')}</tbody>
        </table>` : emptyState('video', '표시할 푸티지가 없습니다.', event && !event.parent ? '기간으로 모으기를 눌러 미배정 영상을 찾을 수 있습니다.' : '')}</div>
        <div class="action-bar">
          <div>
            ${destinations.length ? `<select id="move-event-target" aria-label="이동할 이벤트"><option value="">이동할 이벤트</option>${destinations.map(item => `<option value="${item.id}">${escapeHtml(eventOptionLabel(item))}</option>`).join('')}</select>
            ${button('move-event', '이동', { disabled: true })}` : ''}
            ${button('edit-media', '장비·촬영 시각 수정', { disabled: !selected })}
          </div>
          ${event ? button('confirm-event', '선택 배치 확정', { glyph: 'check', primary: true, disabled: !filtered.some(file => view.eventSelection.has(file.id) && !file.confirmed) }) : ''}
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

function sourceEntries() {
  const folders = new Map();
  const files = [];
  for (const file of sourceFiles()) {
    const path = sourceFolders(file);
    if (view.sourcePath.some((value, index) => path[index] !== value)) continue;
    const nextFolder = path[view.sourcePath.length];
    if (!nextFolder) {
      files.push(file);
      continue;
    }
    if (!folders.has(nextFolder)) folders.set(nextFolder, []);
    folders.get(nextFolder).push(file);
  }
  const folderEntries = Array.from(folders, ([name, members]) => ({ name, members }));
  return [...folderEntries, ...files.map(file => ({ name: file.name, file }))];
}


function archivePage() {
  const entries = sourceEntries();
  return `${header('아카이브 전송', '확정된 이벤트와 장비별 파일 구조를 확인하세요.', '')}
    <div class="split">
      <section class="surface browser" aria-labelledby="source-title">
        <div class="surface-head"><div><h2 id="source-title">${icon('folder')} Source</h2><p class="small muted">확정된 이벤트 배치</p></div><span class="small muted">${sourceFiles().length}개 파일</span></div>
        <div class="location">
          ${view.sourcePath.length ? smallButton('source-up', '상위 폴더', 'up') : icon('folder')}
          <span class="mono">${escapeHtml(['/managed', ...view.sourcePath].join('/'))}</span>
        </div>
        ${entries.length ? `<ul class="tree">${entries.map((entry, index) => {
          const name = escapeHtml(entry.name);
          if (entry.file) return `<li class="tree-row">
            <span class="tree-file">${icon(entry.file.kind === 'photo' ? 'photo' : 'video')}${name}</span><span class="meta numbers">${sizeLabel(entry.file.size)}</span>
          </li>`;
          return `<li class="tree-row">
            <button type="button" class="tree-button" data-action="open-source" data-value="${index}">${icon('folder')}<span>${name}</span>${icon('right')}</button>
            <span class="meta">${entry.members.length}개</span>
          </li>`;
        }).join('')}</ul>` : emptyState('folder', '표시할 파일이 없습니다.', '이벤트 관리에서 배치를 확정하세요.')}
      </section>
      <section class="surface browser" aria-labelledby="destination-title">
        <div class="surface-head"><div><h2 id="destination-title">${icon('disk')} Destination</h2></div></div>
        ${emptyState('disk', 'OMV 전송 준비 중')}
      </section>
    </div>`;
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


function zoneOptions() {
  return [...new Set([state.timezone, 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/Paris', 'America/Los_Angeles', 'UTC'])]
    .map(zone => `<option>${escapeHtml(zone)}</option>`).join('');
}

function createEventDialog(parent) {
  showDialog(parent ? '소분류 추가' : '이벤트 생성', `
    <label>${parent ? '소분류 이름' : '이벤트명'}<input name="name" autofocus required maxlength="60" placeholder="${parent ? '예시 · 해변 식당' : '예시 · 제주 여행'}"></label>
    ${parent ? '' : `<div class="date-grid">
      <label>시작일<input name="start" type="date" required></label>
      <label>종료일<input name="end" type="date" required></label>
    </div>
    <label>촬영일 기준 시간대<select name="zone">${zoneOptions()}</select></label>`}`,
  parent ? '소분류 만들기' : '생성하고 파일 모으기', async form => {
    const payload = Object.fromEntries(form);
    if (parent) payload.parent_id = parent.id;
    const result = await api('events', 'POST', payload);
    chooseEvent(result.event.id);
    await syncState();
    announce(parent ? '소분류를 만들었습니다.' : collectionMessage(result.collection));
  });
}

function editMedia() {
  const ids = [...view.eventSelection];
  if (!ids.length) return;
  showDialog('장비·촬영 시각 수정', `
    <label>촬영 장비<input name="device" maxlength="80" placeholder="예시 · GoPro 또는 unknown"></label>
    <div class="date-grid"><label>촬영 시각<input type="datetime-local" name="captured_at"></label>
      <label>촬영 시간대<select name="zone">${zoneOptions()}</select></label></div>`,
  '변경 저장', async form => {
    const payload = { ids, zone: form.get('zone') };
    const device = form.get('device').trim();
    const time = form.get('captured_at');
    if (device) payload.device = device;
    if (time) payload.captured_at = time;
    await api('media', 'PATCH', payload);
    view.eventSelection.clear();
    view.eventDevice = '';
    view.eventDate = '';
    await syncState();
    announce('선택한 파일의 정보를 수정했습니다.');
  });
}

function chooseEvent(id) {
  view.eventId = id;
  view.eventSelection.clear();
  view.eventDevice = '';
  view.eventDate = '';
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
  const active = document.activeElement;
  const keepFocus = active && page.contains(active);
  const route = location.hash.slice(1);
  const current = navigation.find(item => item.id === route) || navigation[0];
  const pageChanged = view.page !== current.id;
  const views = { incoming: incomingPage, events: eventPage, archive: archivePage };
  view.page = current.id;
  nav.innerHTML = navigation.map(item => `<a class="nav-link" href="#${item.id}"${item.id === current.id ? ' aria-current="page"' : ''}>${icon(item.icon)}${item.title}</a>`).join('');
  const status = view.loadError ? `<p class="scan-strip" role="alert">${escapeHtml(view.loadError)}</p>` : '';
  page.innerHTML = `<main aria-labelledby="page-title">${status}${views[view.page]()}</main>`;
  document.title = `${current.title} · Photo Saver`;
  if (view.page === 'events') updateEventActions();
  if (pageChanged) {
    window.scrollTo(0, 0);
    return;
  }
  if (tableScroll) page.querySelector('#incoming-rows').scrollTo(tableScroll);
  if (keepFocus) {
    const replacement = [...page.querySelectorAll('button, input, select')].find(element => {
      if (active.id) return element.id === active.id;
      if (active.dataset.action) return element.dataset.action === active.dataset.action && element.dataset.value === active.dataset.value;
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
  'move-incoming'() { return submitJob('move', { ids: selectedIncoming(file => file.status === 'ready').map(file => file.id) }); },
  'delete-incoming': confirmDeleteIncoming,
  'choose-event': chooseEvent,
  'new-event'() { createEventDialog(); },
  'new-child'() { createEventDialog(eventById(view.eventId)); },
  async collect() {
    const result = await api(`events/${view.eventId}/collect`, 'POST');
    await syncState();
    announce(collectionMessage(result));
  },
  'move-event': moveEvent,
  'edit-media': editMedia,
  'confirm-event': confirmEvent,
  'open-source'(value) { view.sourcePath.push(sourceEntries()[Number(value)].name); },
  'source-up'() { view.sourcePath.pop(); },
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
    if (!dialog.open) render();
  }
});

page.addEventListener('change', event => {
  const control = event.target;
  if (control.dataset.select) {
    handleSelection(control);
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
  if (event.target.id !== 'file-search') return;
  view.query = event.target.value;
  document.getElementById('incoming-rows').innerHTML = incomingRows();
});

dialog.addEventListener('click', event => {
  if (event.target.closest('[data-action="close-dialog"]')) dialog.close();
});

document.querySelectorAll('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
window.addEventListener('hashchange', render);
page.addEventListener('error', event => {
  if (event.target.tagName === 'IMG') event.target.remove();
}, true);
render();
syncState().then(render);
