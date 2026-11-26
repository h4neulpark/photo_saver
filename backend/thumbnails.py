"""SHA-addressed thumbnail cache, offline planning, and cancellable extraction."""
import io
import json
import os
import re
import shlex
import shutil
import tempfile
import time
from uuid import uuid4
from contextlib import closing
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from PIL import Image
from pydantic import BaseModel, Field

import catalog
import media
from archive import active_storage_scope, archive_config, archive_connection, archive_revision, resolve_remote_file
from settings import ensure_catalog_idle, fail
from transfers import UploadCancelled

REMOTE_VIDEO_SFTP_LIMIT_BYTES = 150 * 1024 * 1024
REMOTE_PHOTO_SFTP_LIMIT_BYTES = 128 * 1024 * 1024
REMOTE_FFMPEG_STDOUT_LIMIT = 10 * 1024 * 1024
REMOTE_FFMPEG_TIMEOUT = 45
SHA = re.compile(r"^[0-9a-f]{64}$")
CACHE_NAME = re.compile(r"^([0-9a-f]{64})-v1\.jpg$")
REMOTE_FFMPEG_SCRIPT = ('PATH="${PATH:+$PATH:}/opt/homebrew/bin:/usr/local/bin"; '
    'command -v ffmpeg >/dev/null 2>&1 || exit 127; '
    'exec ffmpeg -nostdin -hide_banner -loglevel error -protocol_whitelist file '
    '-i "$1" -map 0:v:0 -frames:v 1 -an -sn -dn '
    '-vf "scale=360:240:force_original_aspect_ratio=decrease" '
    '-threads 1 -f image2pipe -vcodec mjpeg -q:v 4 pipe:1')


class ThumbnailRequest(BaseModel):
    scope: Literal['folder', 'all', 'shas'] = 'all'
    view: Literal['files', 'archives', 'remote'] = 'files'
    event: str = 'all'
    device: str = ''
    folder: str = ''
    job_id: int | None = Field(default=None, ge=1, le=2**63-1)
    shas: list[str] = Field(default_factory=list, max_length=500)
    include_failed: bool = True
    allow_large_sftp_fallback: bool = False


def scan_disk_thumbnails():
    result = {}
    if catalog.THUMBNAILS.is_dir():
        with os.scandir(catalog.THUMBNAILS) as entries:
            for entry in entries:
                match = CACHE_NAME.fullmatch(entry.name)
                if match and entry.is_file(follow_symlinks=False):
                    result[match[1]] = entry.stat(follow_symlinks=False).st_size
    return result


REFERENCE_SQL = """SELECT sha FROM scan_files WHERE sha IS NOT NULL AND status NOT IN ('moved','deleted')
    UNION SELECT sha FROM media WHERE status IN ('available','archived','offloading','moving')
    UNION SELECT sha FROM remote_files WHERE status='present' AND lower(path) NOT LIKE '%.xmp'
    UNION SELECT sha FROM archive_entries WHERE asset_kind='media'"""


def referenced_shas(db):
    return {row[0] for row in db.execute(REFERENCE_SQL) if row[0]}


def sha_is_referenced(db, sha):
    return bool(db.execute(f'SELECT 1 FROM ({REFERENCE_SQL}) WHERE sha=? LIMIT 1', (sha,)).fetchone())


def media_kind(path):
    suffix = Path(path or '').suffix.lower()
    return 'xmp' if suffix == '.xmp' else 'video' if suffix in media.VIDEOS else 'photo'


def sources(db, active_scope=None):
    local, remote = {}, {}
    for table, condition, area in [('media', "status='available'", 'managed'),
                                    ('scan_files', "status IN ('ready','duplicate')", 'incoming')]:
        for row in db.execute(f'SELECT id,sha,path,fingerprint,size FROM {table} WHERE {condition} ORDER BY path'):
            if row['sha']:
                local.setdefault(row['sha'], dict(row, area=area))
    storage_id, root = active_scope if active_scope is not None else active_storage_scope()
    if root:
        for row in db.execute("""SELECT sha,path,size,mtime_ns FROM remote_files
                WHERE status='present' AND archive_root=? AND lower(path) NOT LIKE '%.xmp'
                ORDER BY (storage_id=?) DESC,path""", (root, storage_id or '')):
            if row['sha']:
                remote.setdefault(row['sha'], dict(row))
        for row in db.execute("""SELECT sha,target AS path,size FROM archive_entries
                WHERE archive_root=? AND asset_kind='media' AND outcome IN ('uploaded','skipped')
                AND target IS NOT NULL ORDER BY recorded_at DESC""", (root,)):
            remote.setdefault(row['sha'], dict(row))
    return local, remote


def local_source_for_sha(db, sha):
    for table, condition, area in [('media', "status='available'", 'managed'),
                                  ('scan_files', "status IN ('ready','duplicate')", 'incoming')]:
        row = db.execute(f'SELECT id,sha,path,fingerprint,size FROM {table} WHERE sha=? AND {condition} ORDER BY path LIMIT 1', (sha,)).fetchone()
        if row:
            return dict(row, area=area)
    return None


def context(db, active_scope=None):
    local, remote = sources(db, active_scope)
    generating = set()
    for row in db.execute("SELECT payload,result FROM jobs WHERE status IN ('queued','running') AND kind IN ('thumbnails-local','thumbnails-remote','remote-index')"):
        payload, result = json.loads(row['payload']), json.loads(row['result'] or '{}')
        done = {item.get('sha') for item in result.get('items', [])}
        generating.update(item['sha'] for item in payload.get('items', []) if item['sha'] not in done)
        if result.get('currentSha'):
            generating.add(result['currentSha'])
    return dict(disk_shas=scan_disk_thumbnails(), cache_rows={r['sha']: dict(r) for r in db.execute('SELECT * FROM thumbnail_cache')},
                generating_shas=generating, local_sources=local, remote_sources=remote)


def resolve_thumbnail_state(kind, sha, *, disk_shas, cache_rows, generating_shas, local_sources, remote_sources):
    state, error, can = 'unavailable', '', False
    if kind == 'xmp':
        state = 'non_media'
    elif SHA.fullmatch(sha or ''):
        if sha in disk_shas:
            state = 'ready'
        elif sha in generating_shas:
            state = 'generating'
        else:
            can = sha in local_sources or sha in remote_sources
            cached = cache_rows.get(sha, {})
            if cached.get('status') in {'failed', 'skipped_large'}:
                state, error = cached['status'], cached['error']
            elif can:
                state = 'missing'
    return {'thumbnail_status': state, 'thumbnail_error': error, 'can_generate_thumbnail': can,
            'thumbnail': f'/thumbnails/{sha}-v1.jpg' if state == 'ready' else None}


def missing_summary(rows, ctx):
    result = dict(total=0, missing=0, photos=0, videos=0, local=0, remotePhotos=0, remoteVideos=0, failed=0, skippedLarge=0)
    seen = set()
    for row in rows:
        sha, kind = row['sha'], row.get('media_kind') or row['kind']
        if sha in seen:
            continue
        seen.add(sha)
        state = resolve_thumbnail_state(kind, sha, **ctx)
        if not state['can_generate_thumbnail']:
            continue
        result['total'] += 1
        result['videos' if kind == 'video' else 'photos'] += 1
        result['local' if sha in ctx['local_sources'] else 'remoteVideos' if kind == 'video' else 'remotePhotos'] += 1
        key = {'missing': 'missing', 'failed': 'failed', 'skipped_large': 'skippedLarge'}.get(state['thumbnail_status'])
        if key:
            result[key] += 1
    return result


def plan_thumbnails(db, request, *, active_scope=None):
    ctx = context(db, active_scope)
    if request.scope == 'shas':
        if any(not SHA.fullmatch(sha) for sha in request.shas):
            fail(400, '유효한 SHA-256 해시를 선택하세요.')
        candidates = {sha: media_kind((ctx['local_sources'].get(sha) or ctx['remote_sources'].get(sha) or {}).get('path')) for sha in request.shas}
    elif request.scope == 'folder':
        from records import CTE, range_clause
        table = {'files': 'files', 'archives': 'archive_files', 'remote': 'remote_view'}[request.view]
        where, params = range_clause(request.view, request.event, request.device, request.folder, request.job_id)
        candidates = {r['sha']: (media_kind(r['local_path'] or r['target']) if request.view == 'archives' and r['kind'] != 'xmp' else r['kind'])
                      for r in db.execute(CTE + f'SELECT * FROM {table} WHERE {where}', params)}
    else:
        candidates = {sha: media_kind(src['path']) for sha, src in {**ctx['remote_sources'], **ctx['local_sources']}.items()}
    result = dict(total=0, local=0, localPhotos=0, localVideos=0, remotePhotos=0, remoteVideos=0,
                  remoteVideosOverLimit=0, alreadyReady=0, unavailable=0, failed=0, skippedLarge=0)
    items = []
    for sha, kind in candidates.items():
        state = resolve_thumbnail_state(kind, sha, **ctx)
        status = state['thumbnail_status']
        if status == 'ready':
            result['alreadyReady'] += 1
        elif not state['can_generate_thumbnail']:
            result['unavailable'] += status != 'non_media'
        elif request.include_failed or status == 'missing':
            local, remote = ctx['local_sources'].get(sha), ctx['remote_sources'].get(sha)
            source = local or remote
            items.append(dict(sha=sha, media_kind=kind, source_kind='local' if local else 'remote_video' if kind == 'video' else 'remote_photo',
                              local_source=local, remote_path=remote['path'] if remote else None, size=source.get('size') or 0,
                              name=source['path'], mtime_ns=source.get('mtime_ns')))
            result['total'] += 1
            if status in {'failed', 'skipped_large'}:
                result['failed' if status == 'failed' else 'skippedLarge'] += 1
            if local:
                result['local'] += 1
                result['localVideos' if kind == 'video' else 'localPhotos'] += 1
            else:
                result['remoteVideos' if kind == 'video' else 'remotePhotos'] += 1
                result['remoteVideosOverLimit'] += kind == 'video' and (source.get('size') or 0) > REMOTE_VIDEO_SFTP_LIMIT_BYTES
    _, root = active_scope if active_scope is not None else active_storage_scope()
    result.update(estimatedBytes=result['total'] * 35000, lane='remote' if result['remotePhotos'] + result['remoteVideos'] else 'local',
                  storageConfigured=bool(root), activeArchiveRoot=root)
    return result, items


def queue_thumbnails(db, request):
    plan, items = plan_thumbnails(db, request)
    if not items:
        if plan['alreadyReady']:
            return dict(id=None, status='noop', alreadyReady=plan['alreadyReady'])
        if db.execute("SELECT 1 FROM jobs WHERE kind IN ('thumbnails-local','thumbnails-remote') AND status IN ('queued','running')").fetchone():
            fail(409, '썸네일 생성 작업이 진행 중입니다. 완료 후 다시 시도하세요.')
        fail(400, '생성 가능한 로컬 또는 활성 NAS 원본이 없습니다.')
    config = None
    if plan['lane'] == 'remote':
        try:
            config = archive_config()
        except HTTPException as exc:
            fail(400, exc.detail)
    kind = 'thumbnails-' + plan['lane']
    payload = dict(items=items, allowLargeSftpFallback=request.allow_large_sftp_fallback,
                   config=archive_revision(config) if config else None)
    try:
        job_id = catalog.queue_job(db, kind, payload)
    except ValueError as exc:
        fail(409, str(exc))
    return dict(plan, id=job_id, kind=kind, status='queued')


def record_result(item, status, source, error=''):
    sha = item['sha']
    dest = media.thumbnail_path(sha)
    with catalog.database(write=True) as db:
        db.execute('''INSERT OR REPLACE INTO thumbnail_cache
            (sha,status,source_kind,media_kind,error,size_bytes,updated_at) VALUES (?,?,?,?,?,?,?)''',
            (sha, status, source, item['media_kind'], error, dest.stat().st_size if status == 'ready' else None, catalog.now()))
        if status == 'ready':
            for table in ('media', 'scan_files'):
                db.execute(f"UPDATE {table} SET thumbnail=? WHERE sha=? AND (thumbnail IS NULL OR thumbnail='')", (dest.name, sha))


def ssh_ffmpeg(sftp, target, tick, state):
    if state.get('supported') is False:
        return None
    if not hasattr(sftp, 'get_channel'):
        state['supported'] = False
        return None
    transport = sftp.get_channel().get_transport()
    with closing(transport.open_session(timeout=5)) as channel:
        channel.settimeout(0.5)
        channel.exec_command(f'sh -c {shlex.quote(REMOTE_FFMPEG_SCRIPT)} photo-saver {shlex.quote(str(target))}')
        output, errors = bytearray(), bytearray()
        deadline = time.monotonic() + REMOTE_FFMPEG_TIMEOUT
        while True:
            tick()
            if time.monotonic() > deadline:
                raise TimeoutError('NAS 영상 추출 시간이 초과되었습니다.')
            if channel.recv_ready():
                output.extend(channel.recv(65536))
                if len(output) > REMOTE_FFMPEG_STDOUT_LIMIT:
                    raise ValueError('NAS 프레임 크기가 제한을 초과했습니다.')
            if channel.recv_stderr_ready():
                chunk = channel.recv_stderr(4096)
                if len(errors) < 4096:
                    errors.extend(chunk[:4096-len(errors)])
            if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
                break
            time.sleep(0.02)
        code = channel.recv_exit_status()
        if code in (126, 127):
            state['supported'] = False
            return None
        if code or not output:
            raise ValueError('NAS ffmpeg 추출 실패: ' + errors.decode(errors='replace')[:200])
        state['supported'] = True
        return output


def extract_thumbnail_for_item(item, incoming, managed, *, sftp=None, base=None, tick=lambda: None,
                               ssh_ffmpeg_state=None, allow_large_sftp_fallback=False, cancel_exc=UploadCancelled):
    tick()
    sha, kind = item['sha'], item['media_kind']
    if not SHA.fullmatch(sha):
        raise ValueError('유효하지 않은 SHA입니다.')
    dest = media.thumbnail_path(sha)
    dest.parent.mkdir(parents=True, exist_ok=True)
    source = item['source_kind']
    try:
        if dest.is_symlink():
            raise ValueError('썸네일 경로의 심볼릭 링크는 사용할 수 없습니다.')
        if dest.is_file():
            record_result(item, 'ready', source)
            return dict(sha=sha, name=item['name'], status='reused', source=source, error='')
        with catalog.database() as db:
            local = local_source_for_sha(db, sha)
        root = (managed if local['area'] == 'managed' else incoming) if local else None
        if local and root:
            staging = dest.parent / f'.{uuid4().hex}.tmp.jpg'
            try:
                with media.regular_file(root, local['path'], expected=local['fingerprint']) as (stream, _):
                    if kind == 'photo':
                        with Image.open(stream) as image:
                            media.save_image_preview_atomic(image, staging)
                    else:
                        media.video_thumbnail(stream, staging, tick)
                tick()
                os.replace(staging, dest)
                source = 'local'
            except (UploadCancelled, cancel_exc):
                raise
            except (OSError, ValueError):
                if not item.get('remote_path'):
                    raise
            finally:
                staging.unlink(missing_ok=True)
        if not dest.is_file():
            if sftp is None or not item.get('remote_path'):
                raise ValueError('접근 가능한 원본이 없습니다.')
            target, info = resolve_remote_file(sftp, str(base), item['remote_path'])
            if kind == 'video':
                raw = ssh_ffmpeg(sftp, target, tick, ssh_ffmpeg_state if ssh_ffmpeg_state is not None else {})
                if raw is not None:
                    with Image.open(io.BytesIO(raw)) as image:
                        media.save_image_preview_atomic(image, dest)
                    source = 'remote_video_ssh'
                elif info.st_size > REMOTE_VIDEO_SFTP_LIMIT_BYTES and not allow_large_sftp_fallback:
                    error = 'NAS에 ffmpeg가 없고 영상이 150 MiB를 초과하여 건너뛰었습니다.'
                    record_result(item, 'skipped_large', 'remote_video_sftp', error)
                    return dict(sha=sha, name=item['name'], status='skipped_large', source='remote_video_sftp', error=error)
            if not dest.is_file():
                limit = REMOTE_PHOTO_SFTP_LIMIT_BYTES if kind == 'photo' else None if allow_large_sftp_fallback else REMOTE_VIDEO_SFTP_LIMIT_BYTES
                if limit and info.st_size > limit:
                    raise ValueError('원격 사진 크기가 제한(128 MiB)을 초과했습니다.')
                with tempfile.TemporaryDirectory(prefix='thumb-', dir=catalog.THUMBNAILS) as tmp:
                    temporary = Path(tmp) / ('source' + Path(item['remote_path']).suffix)
                    count = 0
                    with sftp.open(str(target), 'rb') as remote, temporary.open('wb') as output:
                        while True:
                            tick()
                            chunk = remote.read(256 * 1024)
                            if not chunk:
                                break
                            count += len(chunk)
                            if limit and count > limit:
                                raise ValueError('원격 파일 다운로드 크기가 제한을 초과했습니다.')
                            output.write(chunk)
                    with temporary.open('rb') as stream:
                        if kind == 'photo':
                            with Image.open(stream) as image:
                                media.save_image_preview_atomic(image, dest)
                        else:
                            media.video_thumbnail(stream, dest, tick)
                source = 'remote_photo' if kind == 'photo' else 'remote_video_sftp'
        record_result(item, 'ready', source)
        return dict(sha=sha, name=item['name'], status='generated', source=source, error='')
    except (UploadCancelled, cancel_exc):
        raise
    except Exception as exc:
        error = str(exc.detail if isinstance(exc, HTTPException) else exc)[:300]
        record_result(item, 'failed', source, error)
        return dict(sha=sha, name=item['name'], status='failed', source=source, error=error)


def generate_thumbnails(job, incoming, managed):
    payload = json.loads(job['payload'])
    items = sorted(payload['items'], key=lambda i: i['source_kind'] != 'local')
    result = dict(totalFiles=len(items), completedFiles=0, generated=0, reused=0, failed=0, skippedLarge=0, items=[])
    state = {}
    last_save = 0
    def tick():
        nonlocal last_save
        with catalog.database(write=True) as db:
            current = db.execute('SELECT result FROM jobs WHERE id=?', (job['id'],)).fetchone()
            if current and json.loads(current['result'] or '{}').get('cancelRequested'):
                raise UploadCancelled()
            if time.monotonic() - last_save >= 0.3:
                db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(result, ensure_ascii=False), job['id']))
                last_save = time.monotonic()
    def run(item, sftp=None, base=None):
        result.update(currentSha=item['sha'], currentFile=item['name'], phase=f"썸네일 생성 중 ({result['completedFiles']}/{len(items)})")
        tick()
        outcome = extract_thumbnail_for_item(item, incoming, managed, sftp=sftp, base=base, tick=tick,
                    ssh_ffmpeg_state=state, allow_large_sftp_fallback=payload.get('allowLargeSftpFallback', False))
        result['items'].append(outcome)
        result['completedFiles'] += 1
        result[{'skipped_large': 'skippedLarge'}.get(outcome['status'], outcome['status'])] += 1
        result['sshFfmpegSupported'] = state.get('supported')
        tick()
    status = 'done'
    try:
        for item in items:
            if item['source_kind'] == 'local':
                run(item)
        remote = [item for item in items if item['source_kind'] != 'local']
        if remote:
            tick()
            config = archive_config()
            if archive_revision(config) != payload['config']:
                raise ValueError('예약 후 NAS 설정이 변경되었습니다. 다시 실행하세요.')
            with archive_connection(config) as (sftp, config):
                for item in remote:
                    run(item, sftp, config['root'])
    except UploadCancelled:
        status, result['cancelRequested'], result['error'] = 'cancelled', True, '사용자가 썸네일 생성을 중지했습니다.'
    except Exception as exc:
        status, result['error'] = 'failed', str(exc.detail if isinstance(exc, HTTPException) else exc)
    result.update(phase='중지됨' if status == 'cancelled' else '실패' if status == 'failed' else '완료', currentSha='', currentFile='')
    with catalog.database(write=True) as db:
        db.execute('UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?', (status, json.dumps(result, ensure_ascii=False), catalog.now(), job['id']))


def thumbnail_stats(db):
    disk, refs = scan_disk_thumbnails(), referenced_shas(db)
    plan, _ = plan_thumbnails(db, ThumbnailRequest())
    counts = {r['status']: r['n'] for r in db.execute("SELECT status,count(*) AS n FROM thumbnail_cache WHERE sha NOT IN (SELECT value FROM json_each(?)) GROUP BY status", (json.dumps(list(disk)),))}
    active = db.execute("SELECT id,kind,lane,status FROM jobs WHERE kind IN ('thumbnails-local','thumbnails-remote') AND status IN ('queued','running') ORDER BY id LIMIT 1").fetchone()
    orphan = disk.keys() - refs
    return dict(cachedCount=len(disk), cachedBytes=sum(disk.values()), missingTotal=plan['total'], missingLocal=plan['local'],
                missingRemotePhotos=plan['remotePhotos'], missingRemoteVideos=plan['remoteVideos'], orphanCount=len(orphan),
                orphanBytes=sum(disk[sha] for sha in orphan), failedCount=counts.get('failed', 0), skippedLargeCount=counts.get('skipped_large', 0),
                activeThumbnailJob=dict(active) if active else None, canCleanup=not db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone())


def cleanup_orphans():
    with catalog.catalog_lock(exclusive=True), closing(catalog.open_db()) as db:
        ensure_catalog_idle(db)
        db.execute('BEGIN IMMEDIATE')
        try:
            refs, disk = referenced_shas(db), scan_disk_thumbnails()
            orphan = disk.keys() - refs
            for sha in orphan:
                path = catalog.THUMBNAILS / f'{sha}-v1.jpg'
                if not path.is_symlink() and path.is_file():
                    path.unlink(missing_ok=True)
            db.execute('DELETE FROM thumbnail_cache WHERE sha NOT IN (SELECT value FROM json_each(?))', (json.dumps(list(refs)),))
            db.commit()
            return dict(deleted=len(orphan), freedBytes=sum(disk[sha] for sha in orphan), stats=thumbnail_stats(db))
        except BaseException:
            db.rollback()
            raise


def cleanup_temp_thumbnails():
    if catalog.THUMBNAILS.is_dir():
        for path in catalog.THUMBNAILS.iterdir():
            if path.is_symlink():
                continue
            if path.is_file() and re.fullmatch(r'\.[0-9a-f]{32}(?:\.tmp)?\.jpg', path.name):
                path.unlink(missing_ok=True)
            elif path.is_dir() and path.name.startswith('thumb-'):
                shutil.rmtree(path)
