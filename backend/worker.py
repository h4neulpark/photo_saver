import fcntl
import json
import logging
import os
import time
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from catalog import DATA, DEFAULT_ZONE, PHOTOS, THUMBNAILS, database, initialize, now
from media import (
    analyze, delete_photo, fingerprint, hash_file, inspect, iso_time, move_file,
    preview_thumbnail, relative_parts, scan_tree, thumbnail_path,
)

log = logging.getLogger(__name__)
ROOT = Path(os.environ.get("PHOTO_SAVER_LIBRARY", "/library")).resolve()


def configured_area(variable, default):
    configured = Path(os.environ.get(variable, default))
    if configured.is_absolute() or not configured.parts:
        raise ValueError(f"{variable}에는 라이브러리 아래의 상대 경로를 지정하세요.")
    path = ROOT
    for part in relative_parts(configured.as_posix()):
        path = path / part
        if path.is_symlink() or not path.is_dir():
            raise ValueError(f"{variable} 경로에 접근할 수 없습니다: {path}")
    if not os.access(path, os.R_OK | os.W_OK | os.X_OK):
        raise ValueError(f"{variable}의 읽기·쓰기 권한이 필요합니다: {path}")
    return path


def configure():
    incoming = configured_area("INCOMING_DIR", "incoming")
    managed = configured_area("MANAGED_DIR", "managed")
    if incoming == managed or incoming in managed.parents or managed in incoming.parents:
        raise ValueError("incoming과 managed는 겹치지 않는 디렉터리여야 합니다.")
    if incoming.stat().st_dev != managed.stat().st_dev:
        raise ValueError("incoming과 managed는 같은 파일시스템에 있어야 합니다.")
    ZoneInfo(DEFAULT_ZONE)
    return incoming, managed


def store_analysis(file_id, path, sha, info, analysis):
    kind, details, thumbnail, captured, source, verified, device = analysis
    snapshot = fingerprint(info)
    with database(write=True) as db:
        db.execute(
            """
            INSERT INTO media (id, path, name, kind, sha, size, fingerprint, status,
                               metadata, thumbnail, capture_time, time_source, time_verified, device)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(path) DO UPDATE SET
                id=CASE WHEN media.sha=excluded.sha OR media.status='moving' THEN media.id ELSE excluded.id END,
                kind=excluded.kind, sha=excluded.sha, size=excluded.size,
                fingerprint=excluded.fingerprint, status='available', metadata=excluded.metadata,
                thumbnail=excluded.thumbnail, capture_time=excluded.capture_time,
                time_source=excluded.time_source, time_verified=excluded.time_verified, device=excluded.device,
                event_id=CASE WHEN media.sha=excluded.sha THEN media.event_id END,
                confirmed=CASE WHEN media.sha=excluded.sha THEN media.confirmed ELSE 0 END,
                user_time=CASE WHEN media.sha=excluded.sha THEN media.user_time END,
                user_device=CASE WHEN media.sha=excluded.sha THEN media.user_device END
            """,
            (file_id, path, Path(path).name, kind, sha, info.st_size, snapshot,
             json.dumps(details, ensure_ascii=False), thumbnail, captured, source, int(verified), device),
        )


def index_managed(managed):
    with database() as db:
        existing = {row["path"]: row for row in db.execute("SELECT * FROM media")}
    seen, missing, known = set(), set(), {}
    for path, info in scan_tree(managed):
        seen.add(path)
        old = existing.get(path)
        if old and old["status"] == "moving":
            continue
        try:
            if info is None:
                raise OSError("파일의 상태를 읽을 수 없습니다.")
            snapshot = fingerprint(info)
            if old and old["status"] == "available" and old["fingerprint"] == snapshot:
                sha = old["sha"]
            else:
                sha, info = hash_file(managed, path, snapshot)
                snapshot = fingerprint(info)
                result = analyze(managed, path, sha, snapshot)
                store_analysis(uuid4().hex, path, sha, info, result)
            known.setdefault(sha, []).append((path, snapshot))
        except OSError:
            log.warning("보관 파일을 읽을 수 없습니다: %s", path)
            if old:
                missing.add(path)
    missing.update(
        path for path, row in existing.items()
        if path not in seen and row["status"] == "available"
    )
    if missing:
        with database(write=True) as db:
            db.executemany("UPDATE media SET status='missing' WHERE path=?", [(path,) for path in missing])
    return known


def scan_incoming(job, incoming, managed):
    known = index_managed(managed)
    candidates = list(scan_tree(incoming))
    if candidates:
        time.sleep(0.4)
    in_batch = {}
    results = []
    for path, initial in candidates:
        sha, snapshot, size, modified, thumbnail = None, None, None, None, None
        try:
            if initial is None:
                raise OSError("파일 상태를 읽을 수 없습니다.")
            sha, info = hash_file(incoming, path, fingerprint(initial))
            snapshot, size, modified = fingerprint(info), info.st_size, iso_time(info.st_mtime)
            thumbnail = preview_thumbnail(incoming, path, sha, snapshot)
            if sha in known:
                status, reason = "duplicate", f"managed의 {known[sha][0][0]}와 동일"
            elif sha in in_batch:
                status, reason = "duplicate", f"이번 검사의 {in_batch[sha]}와 동일"
            else:
                status, reason = "ready", ""
                in_batch[sha] = path
        except OSError:
            size = initial.st_size if initial else None
            modified = iso_time(initial.st_mtime) if initial else None
            status, reason = "review", "파일이 변경되었거나 읽을 수 없습니다."
        results.append((job["id"], uuid4().hex, path, snapshot, sha, size, modified, thumbnail, status, reason))
    with database(write=True) as db:
        db.executemany(
            """INSERT INTO scan_files (scan_id,id,path,fingerprint,sha,size,modified_at,thumbnail,status,reason)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            results,
        )
        db.execute("DELETE FROM scan_files WHERE scan_id <> ?", (job["id"],))
        finish(db, job["id"], {"checked": len(results)})


def live_duplicate(managed, known, sha):
    for path, snapshot in known.get(sha, ()):
        try:
            if fingerprint(inspect(managed, path)) == snapshot:
                return path
        except OSError:
            pass
    return None


def set_outcome(file_id, status, reason=""):
    with database(write=True) as db:
        db.execute("UPDATE scan_files SET status=?, reason=? WHERE id=?", (status, reason, file_id))
        if status != "moved":
            db.execute("UPDATE media SET status='missing' WHERE id=? AND status='moving'", (file_id,))


def import_file(row, incoming, managed, known):
    file_id, source, sha, snapshot = (row[key] for key in ("id", "path", "sha", "fingerprint"))
    name = Path(source).name
    target = f"{file_id}/{name}"
    with database() as db:
        intent = db.execute("SELECT status FROM media WHERE id=?", (file_id,)).fetchone()

    if intent and intent["status"] == "available":
        set_outcome(file_id, "moved")
        return

    info = None
    if intent and intent["status"] == "moving":
        try:
            recovered_sha, info = hash_file(managed, target)
            if recovered_sha != sha:
                raise OSError("대상 경로에 다른 파일이 있습니다.")
        except FileNotFoundError:
            pass

    if info is None:
        current = inspect(incoming, source)
        if fingerprint(current) != snapshot:
            raise OSError("검사 이후 원본이 변경되었습니다. 새로 고침이 필요합니다.")
        duplicate = live_duplicate(managed, known, sha)
        if duplicate:
            set_outcome(file_id, "duplicate", f"managed의 {duplicate}와 동일")
            return
        kind = "photo" if Path(name).suffix.lower() in PHOTOS else "video"
        with database(write=True) as db:
            db.execute(
                """INSERT INTO media (id,path,name,kind,sha,size,fingerprint,status)
                   VALUES (?,?,?,?,?,?,?,'moving')
                   ON CONFLICT(id) DO UPDATE SET status='moving'""",
                (file_id, target, name, kind, sha, current.st_size, snapshot),
            )
        move_file(incoming, source, managed, target, snapshot)
        info = inspect(managed, target)
        # A rename can change ctime. The other identity fields should be preserved.
        if json.loads(fingerprint(info))[:4] != json.loads(snapshot)[:4]:
            final_sha, info = hash_file(managed, target)
            if final_sha != sha:
                raise OSError("이동된 파일의 내용이 검사 결과와 일치하지 않습니다.")

    new_snapshot = fingerprint(info)
    analysis = analyze(managed, target, sha, new_snapshot)
    store_analysis(file_id, target, sha, info, analysis)
    known.setdefault(sha, []).append((target, new_snapshot))
    set_outcome(file_id, "moved")


def import_selection(job, incoming, managed):
    known = index_managed(managed)
    ids = json.loads(job["payload"])["ids"]
    counts = {"moved": 0, "duplicate": 0, "review": 0}
    for file_id in ids:
        with database() as db:
            row = db.execute("SELECT * FROM scan_files WHERE id=?", (file_id,)).fetchone()
        if row is None:
            counts["review"] += 1
            continue
        if row["status"] == "ready":
            try:
                import_file(row, incoming, managed, known)
            except OSError as exc:
                log.warning("파일 이동에 확인이 필요합니다: %s: %s", row["path"], exc)
                message = exc.strerror if exc.errno is not None else str(exc)
                set_outcome(file_id, "review", message)
        with database() as db:
            outcome = db.execute("SELECT status FROM scan_files WHERE id=?", (file_id,)).fetchone()["status"]
        counts[outcome] += 1
    with database(write=True) as db:
        finish(db, job["id"], counts)


def delete_scanned_photo(row, incoming):
    file_id = row["id"]
    recovering = row["status"] == "deleting"
    try:
        if not recovering:
            info = inspect(incoming, row["path"])
            if fingerprint(info) != row["fingerprint"]:
                raise OSError("검사 이후 파일이 변경되었습니다. 새로 고침이 필요합니다.")
            with database(write=True) as db:
                db.execute("UPDATE scan_files SET status='deleting' WHERE id=?", (file_id,))
        try:
            delete_photo(incoming, row["path"], row["fingerprint"])
        except FileNotFoundError:
            if not recovering:
                raise
    except OSError as exc:
        with database(write=True) as db:
            reason = "사진이 변경되었거나 삭제할 수 없습니다. 새로 고침 후 다시 확인하세요."
            db.execute("UPDATE scan_files SET status='review', reason=?, thumbnail=NULL WHERE id=?", (reason, file_id))
        log.warning("사진 삭제에 확인이 필요합니다: %s: %s", row["path"], exc)
        return "review"
    with database(write=True) as db:
        db.execute("UPDATE scan_files SET status='deleted', thumbnail=NULL WHERE id=?", (file_id,))
    return "deleted"


def refresh_deleted_group(managed, sha):
    with database() as db:
        copies = db.execute("SELECT path,fingerprint FROM media WHERE sha=? AND status='available'", (sha,)).fetchall()
        remaining = db.execute(
            """SELECT id,path FROM scan_files WHERE sha=? AND status IN ('ready','duplicate')
               ORDER BY (status='ready') DESC,path""", (sha,)
        ).fetchall()
        references = db.execute(
            """SELECT 1 FROM scan_files WHERE sha=? AND thumbnail IS NOT NULL AND status NOT IN ('moved','deleted')
               UNION ALL SELECT 1 FROM media WHERE sha=? AND thumbnail IS NOT NULL AND status='available'
               LIMIT 1""", (sha, sha)
        ).fetchone()

    duplicate = live_duplicate(managed, {sha: [(row["path"], row["fingerprint"]) for row in copies]}, sha)
    if remaining:
        with database(write=True) as db:
            for index, row in enumerate(remaining):
                if duplicate:
                    status, reason = "duplicate", f"managed의 {duplicate}와 동일"
                elif index:
                    status, reason = "duplicate", f"이번 검사의 {remaining[0]['path']}와 동일"
                else:
                    status, reason = "ready", ""
                db.execute("UPDATE scan_files SET status=?, reason=? WHERE id=?", (status, reason, row["id"]))
    if not references:
        try:
            thumbnail_path(sha).unlink(missing_ok=True)
        except OSError as exc:
            log.warning("사용하지 않는 썸네일을 제거할 수 없습니다: %s", exc)


def delete_selection(job, incoming, managed):
    ids = json.loads(job["payload"])["ids"]
    counts = {"deleted": 0, "review": 0}
    hashes = set()
    for file_id in ids:
        with database() as db:
            row = db.execute("SELECT * FROM scan_files WHERE id=?", (file_id,)).fetchone()
        outcome = row["status"] if row else "review"
        if outcome in {"ready", "duplicate", "deleting"}:
            outcome = delete_scanned_photo(row, incoming)
        counts[outcome if outcome == "deleted" else "review"] += 1
        if outcome == "deleted":
            hashes.add(row["sha"])
    for sha in hashes:
        refresh_deleted_group(managed, sha)
    with database(write=True) as db:
        finish(db, job["id"], counts)


def finish(db, job_id, result, status="done"):
    db.execute(
        "UPDATE jobs SET status=?, result=?, finished_at=? WHERE id=?",
        (status, json.dumps(result, ensure_ascii=False), now(), job_id),
    )


def run():
    incoming, managed = configure()
    initialize()
    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    with (DATA / "worker.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with database(write=True) as db:
            db.execute("UPDATE jobs SET status='queued' WHERE status='running'")

        log.info("수집 워커 시작 · %s → %s", incoming, managed)
        handlers = {"scan": scan_incoming, "move": import_selection, "delete": delete_selection}
        while True:
            with database(write=True) as db:
                job = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1").fetchone()
                if job:
                    db.execute("UPDATE jobs SET status='running' WHERE id=?", (job["id"],))
            if not job:
                time.sleep(0.4)
                continue
            try:
                handlers[job["kind"]](job, incoming, managed)
            except Exception:
                log.exception("작업이 실패했습니다: %s", job["id"])
                with database(write=True) as db:
                    finish(db, job["id"], {"error": "작업을 마치지 못했습니다. 경로와 워커 로그를 확인하세요."}, "failed")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
