"""Incremental remote archive indexing with SSH hashing and SFTP fallback."""
import errno
import json
import stat
import time
import thumbnails
from pathlib import PurePosixPath

from fastapi import HTTPException
from pydantic import BaseModel

from archive import (
    archive_config, archive_connection, archive_revision as config_identity, relative_path, storage_id_for,
)
from catalog import LANE_REMOTE, database, ensure_storage, now, queue_job, upsert_remote_file
from companions import XMP
from media import SUPPORTED
from settings import fail
from transfers import (
    UploadCancelled, percent_label, remote_hash, remote_stat, sftp_disconnected, stat_mtime_ns,
)

INDEXABLE_EXTENSIONS = SUPPORTED | {XMP}
MAX_INDEX_FILES = 200_000


class IndexCancelled(UploadCancelled):
    pass


class RemoteIndexRequest(BaseModel):
    connection: str
    path: str = ""
    full_rehash: bool = False
    generate_thumbnails: bool = False
    allow_large_sftp_fallback: bool = False


def escape_like(value):
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def queue_remote_index(db, request):
    if len(request.connection) != 64:
        fail(400, "유효한 연결 설정 식별자가 아닙니다.")
    scope_path = relative_path(request.path)
    scope = "" if str(scope_path) == "." else str(scope_path)
    config = archive_config()
    if request.connection != config_identity(config):
        fail(409, "Destination의 연결 설정이 변경되었습니다. 아카이브에 다시 연결하고 인덱싱하세요.")
    storage_id = storage_id_for(config)
    payload = {
        "config": config_identity(config),
        "storageId": storage_id,
        "archiveRoot": config["root"],
        "scope": scope,
        "fullRehash": bool(request.full_rehash),
        "generateThumbnails": request.generate_thumbnails,
        "allowLargeSftpFallback": request.allow_large_sftp_fallback,
    }
    try:
        job_id = queue_job(db, "remote-index", payload)
    except ValueError as exc:
        fail(409, str(exc))
    result = {
        "scope": scope, "fullRehash": bool(request.full_rehash),
        "totalFiles": 0, "processedFiles": 0, "hashed": 0, "unchanged": 0,
        "missing": 0, "failed": 0, "errors": [], "current": "", "phase": "대기 중",
    }
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job_id))
    return {"id": job_id, "lane": LANE_REMOTE, "scope": scope}


def resolve_remote_scope(sftp, root, scope):
    base = PurePosixPath(sftp.normalize(root))
    if not scope:
        return base, base
    relative = relative_path(scope)
    current = base
    for part in relative.parts:
        current = current / part
        try:
            info = sftp.lstat(str(current))
        except OSError as error:
            if error.errno == errno.ENOENT:
                fail(404, "인덱싱할 원격 폴더를 찾을 수 없습니다.")
            raise
        if stat.S_ISLNK(info.st_mode):
            fail(403, "심볼릭 링크 폴더는 인덱싱할 수 없습니다.")
        if not stat.S_ISDIR(info.st_mode):
            fail(400, "선택한 경로가 폴더가 아닙니다.")
    normalized = PurePosixPath(sftp.normalize(str(current)))
    if not normalized.is_relative_to(base):
        fail(403, "아카이브 루트 밖의 폴더는 인덱싱할 수 없습니다.")
    return base, current


def walk_remote_scope(sftp, base, start, scope, check_cancel, on_discover):
    stack = [(start, PurePosixPath(scope) if scope else PurePosixPath())]
    found = []
    while stack:
        check_cancel()
        current_abs, current_rel = stack.pop()
        entries = list(sftp.listdir_iter(str(current_abs), read_aheads=1))
        entries.sort(key=lambda item: (item.filename.casefold(), item.filename))
        subdirs = []
        for item in entries:
            name = item.filename
            if name in (".", "..") or name.startswith(".") or "/" in name or "\0" in name:
                continue
            mode = item.st_mode or 0
            if stat.S_ISLNK(mode):
                continue
            rel = current_rel / name
            if stat.S_ISDIR(mode):
                subdirs.append((current_abs / name, rel))
            elif stat.S_ISREG(mode) and PurePosixPath(name).suffix.lower() in INDEXABLE_EXTENSIONS:
                found.append((str(rel), int(item.st_size or 0), stat_mtime_ns(item)))
                if len(found) > MAX_INDEX_FILES:
                    fail(413, f"원격 인덱싱 대상이 최대 {MAX_INDEX_FILES:,}개를 초과했습니다. 하위 폴더별로 나누어 인덱싱하세요.")
                on_discover(len(found), str(rel))
        for subdir in reversed(subdirs):
            stack.append(subdir)
    return found


def load_existing_scope(db, storage_id, archive_root, scope):
    if scope:
        pattern = f"{escape_like(scope)}/%"
        rows = db.execute(
            """SELECT path, sha, size, mtime_ns, status FROM remote_files
               WHERE storage_id=? AND archive_root=? AND path LIKE ? ESCAPE '\\'""",
            (storage_id, archive_root, pattern),
        ).fetchall()
    else:
        rows = db.execute(
            """SELECT path, sha, size, mtime_ns, status FROM remote_files
               WHERE storage_id=? AND archive_root=?""",
            (storage_id, archive_root),
        ).fetchall()
    return {row["path"]: dict(row) for row in rows}


def flush_seen(storage_id, paths):
    if not paths:
        return
    stamp = now()
    with database(write=True) as db:
        db.executemany(
            "UPDATE remote_files SET last_seen_at=? WHERE storage_id=? AND path=?",
            [(stamp, storage_id, path) for path in paths],
        )
    paths.clear()


def index_remote_archive(job, _incoming, _managed):
    payload = json.loads(job["payload"])
    scope = payload.get("scope", "")
    full_rehash = bool(payload.get("fullRehash", False))
    result = {
        "scope": scope, "fullRehash": full_rehash,
        "totalFiles": 0, "processedFiles": 0, "hashed": 0, "unchanged": 0,
        "missing": 0, "failed": 0, "errors": [], "current": "", "phase": "원격 연결 중",
    }
    last_update = 0

    def save(force=False):
        nonlocal last_update
        if not force and time.monotonic() - last_update < 0.3:
            return
        with database(write=True) as db:
            saved = db.execute("SELECT result FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if saved and json.loads(saved["result"] or "{}").get("cancelRequested"):
                raise IndexCancelled()
            db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job["id"]))
        last_update = time.monotonic()

    def on_discover(count, path):
        result["totalFiles"] = count
        result["current"] = path
        save()

    status = "done"
    try:
        save(True)
        config = archive_config()
        if config_identity(config) != payload["config"]:
            fail(409, "인덱싱 예약 후 SSH 설정이 변경되었습니다. 다시 실행하세요.")
        storage_id = storage_id_for(config)
        with archive_connection(config) as (sftp, config):
            base, start = resolve_remote_scope(sftp, config["root"], scope)
            result["phase"] = "원격 폴더 탐색 중"
            save(True)
            discovered = walk_remote_scope(sftp, base, start, scope, save, on_discover)
            result["totalFiles"] = len(discovered)
            save(True)

            with database() as db:
                existing = load_existing_scope(db, storage_id, config["root"], scope)

            ssh_state = {"supported": True}
            seen_paths = set()
            unchanged_batch = []

            for rel_path, size, mtime_ns in discovered:
                save()
                seen_paths.add(rel_path)
                result["current"] = rel_path
                record = existing.get(rel_path)
                if (not full_rehash and record and record["status"] == "present" and record["sha"]
                        and record["size"] == size and record["mtime_ns"] is not None
                        and record["mtime_ns"] == mtime_ns):
                    unchanged_batch.append(rel_path)
                    result["unchanged"] += 1
                    result["processedFiles"] += 1
                    if len(unchanged_batch) >= 100:
                        flush_seen(storage_id, unchanged_batch)
                    result["phase"] = "증분 확인 중"
                    save()
                    continue

                flush_seen(storage_id, unchanged_batch)
                target_abs = base / rel_path
                try:
                    result["phase"] = "원격 해시 중"
                    save(True)
                    digest = remote_hash(
                        sftp, target_abs,
                        lambda read_bytes, sz=size: (
                            result.__setitem__("phase", percent_label("SFTP 해시 중", read_bytes, sz)),
                            save(),
                        ),
                        file_size=size, ssh_state=ssh_state,
                        ssh_tick=lambda: (result.__setitem__("phase", "원격 해시 중"), save()),
                    )
                    after = remote_stat(sftp, target_abs)
                    if (after is None or not stat.S_ISREG(after.st_mode)
                            or int(after.st_size or 0) != size or stat_mtime_ns(after) != mtime_ns):
                        fail(409, "인덱싱 중 원격 파일이 변경되었습니다. 다음 스캔에서 다시 확인하세요.")
                    stamp = now()
                    with database(write=True) as db:
                        upsert_remote_file(
                            db, storage_id, rel_path, config["root"], digest, size,
                            mtime_ns=mtime_ns, status="present", verified_at=stamp,
                        )
                    result["hashed"] += 1
                except IndexCancelled:
                    raise
                except (OSError, ValueError, HTTPException) as error:
                    if sftp_disconnected(sftp, error):
                        raise
                    result["failed"] += 1
                    message = error.detail if isinstance(error, HTTPException) else "원격 파일을 읽거나 해시할 수 없습니다."
                    if len(result["errors"]) < 100:
                        result["errors"].append({"path": rel_path, "message": message})
                result["processedFiles"] += 1
                save(True)

            flush_seen(storage_id, unchanged_batch)
            missing_paths = [
                path for path, rec in existing.items()
                if rec["status"] == "present" and path not in seen_paths
            ]
            stamp = now()
            with database(write=True) as db:
                ensure_storage(db, storage_id, root_hint=config["root"])
                if missing_paths:
                    db.executemany(
                        "UPDATE remote_files SET status='missing', last_seen_at=? WHERE storage_id=? AND path=?",
                        [(stamp, storage_id, path) for path in missing_paths],
                    )
                if not scope:
                    db.execute(
                        "UPDATE storages SET last_indexed_at=?, last_seen_at=? WHERE id=?",
                        (stamp, stamp, storage_id),
                    )
            result["missing"] = len(missing_paths)
            if payload.get('generateThumbnails'):
                with database() as db:
                    _, items = thumbnails.plan_thumbnails(db, thumbnails.ThumbnailRequest(
                        scope='folder', view='remote', folder=scope), active_scope=(storage_id, config['root']))
                summary = dict(total=len(items), generated=0, reused=0, failed=0, skippedLarge=0)
                result['thumbnails'] = summary
                ffmpeg_state = {}
                for index, item in enumerate(items):
                    result.update(currentSha=item['sha'], phase=f'누락 썸네일 생성 중 ({index}/{len(items)})')
                    save(True)
                    outcome = thumbnails.extract_thumbnail_for_item(item, _incoming, _managed,
                        sftp=sftp, base=str(base), tick=lambda: save(True), ssh_ffmpeg_state=ffmpeg_state,
                        cancel_exc=IndexCancelled,
                        allow_large_sftp_fallback=payload.get('allowLargeSftpFallback', False))
                    summary[{'skipped_large': 'skippedLarge'}.get(outcome['status'], outcome['status'])] += 1
                result['currentSha'] = ''
        if result["failed"]:
            status = "failed"
            result["error"] = f"{result['failed']}개 파일을 인덱싱하지 못했습니다. 실패 목록을 확인하세요."
    except (IndexCancelled, UploadCancelled):
        status = "cancelled"
        result["error"] = "원격 인덱싱을 중지했습니다. 완료된 해시 기록과 기존 인덱스는 유지됩니다."
    except Exception as error:
        status = "failed"
        result["error"] = error.detail if isinstance(error, HTTPException) else "원격 아카이브 인덱싱에 실패했습니다. 연결 상태를 확인하세요."
    result["phase"] = "완료" if status == "done" else "중지됨" if status == "cancelled" else "실패"
    result["current"] = ""
    result["currentSha"] = ""
    with database(write=True) as db:
        db.execute(
            "UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?",
            (status, json.dumps(result, ensure_ascii=False), now(), job["id"]),
        )
