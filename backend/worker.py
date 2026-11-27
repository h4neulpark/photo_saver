import thumbnails
import fcntl
import json
import logging
import os
import signal
import threading
from storage_wake import run_storage_wake
from storage_shutdown import run_storage_shutdown
import time
from collections import defaultdict
from functools import partial
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from catalog import (DATA, DEFAULT_ZONE, PHOTOS, THUMBNAILS, LANE_LOCAL, LANE_REMOTE,
                     LANE_EXCLUSIVE, active_offload_media_ids, database, initialize, now)
from companions import CAMERA_AUX, COMPANION_EXTENSIONS, XMP, aux_owner, read_xmp, source_candidates, source_index, xmp_owner
from media import (
    SUPPORTED, VIDEO_METADATA_VERSION, analyze, delete_photo, delete_verified_file, fingerprint, hash_file, inspect, iso_time, move_file,
    preview_thumbnail, relative_parts, scan_tree, thumbnail_path,
)
from transfers import upload_selection
from offload import offload_selection
from remote_index import index_remote_archive
from incoming_cleanup import cleanup_duplicates
from resets import reset_local_data

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
                user_time_source=CASE WHEN media.sha=excluded.sha THEN media.user_time_source END,
                user_device=CASE WHEN media.sha=excluded.sha THEN media.user_device END,
                original_path=CASE WHEN media.sha=excluded.sha THEN media.original_path END,
                xmp_path=CASE WHEN media.sha=excluded.sha THEN media.xmp_path END,
                xmp_sha=CASE WHEN media.sha=excluded.sha THEN media.xmp_sha END,
                xmp_metadata=CASE WHEN media.sha=excluded.sha THEN media.xmp_metadata END
            WHERE media.status NOT IN ('offloading', 'archived')
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
        if old and old["status"] in {"moving", "offloading"}:
            continue
        try:
            if info is None:
                raise OSError("파일의 상태를 읽을 수 없습니다.")
            snapshot = fingerprint(info)
            if old and old["status"] == "available" and old["fingerprint"] == snapshot:
                sha = old["sha"]
                if old["kind"] == "video" and json.loads(old["metadata"]).get("video_metadata_version") != VIDEO_METADATA_VERSION:
                    result = analyze(managed, path, sha, snapshot)
                    store_analysis(old["id"], path, sha, info, result)
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
            db.executemany("UPDATE media SET status='missing' WHERE path=? AND status='available'", [(path,) for path in missing])
    return known


def companion_disposition(path, disposition, reason=""):
    return {"path": path, "kind": Path(path).suffix.lower().lstrip("."),
            "disposition": disposition, "reason": reason}


def plan_companions(incoming, companion_files, media_rows):
    with database(write=True) as db:
        db.execute("""UPDATE media SET original_path=(SELECT path FROM scan_files WHERE scan_files.id=media.id)
                      WHERE original_path IS NULL AND id IN (SELECT id FROM scan_files WHERE status='moved')""")
        known = db.execute("SELECT * FROM media WHERE status='available'").fetchall()
    incoming_by_path = {row[2]: row for row in media_rows}
    incoming_index = source_index(incoming_by_path)
    known_by_origin = defaultdict(list)
    known_by_path = {row["path"]: row for row in known}
    known_by_sha = defaultdict(list)
    for row in known:
        if row["original_path"]:
            known_by_origin[row["original_path"]].append(row)
        known_by_sha[row["sha"]].append(row)
    known_origin_index = source_index(known_by_origin)
    known_name_index = source_index(known_by_path, include_folder=False)
    attached = defaultdict(list)
    pending, unmatched = [], []
    for path, initial in companion_files:
        suffix = Path(path).suffix.lower()
        candidates = source_candidates(path, incoming_index)
        if suffix in CAMERA_AUX:
            owner = aux_owner(path, candidates)
            if owner is not None and initial is not None:
                if incoming_by_path[owner][-2] == "ready":
                    entry = companion_disposition(path, "delete-after-move")
                else:
                    entry = companion_disposition(path, "keep", "원본이 이동 대상이 아니므로 보조 파일을 보존합니다.")
                entry["fingerprint"] = fingerprint(initial)
            else:
                reason = ("연결할 원본을 찾지 못했습니다." if not candidates else
                          "원본 후보가 여러 개입니다." if owner is None else
                          "파일 상태를 읽을 수 없습니다.")
                entry = companion_disposition(path, "keep", reason)
            for candidate in ([owner] if owner else candidates):
                attached[candidate].append(entry)
            if not candidates:
                unmatched.append(entry)
            continue
        owner = xmp_owner(candidates)
        try:
            if initial is None:
                raise OSError("파일 상태를 읽을 수 없습니다.")
            sidecar = read_xmp(incoming, path, fingerprint(initial))
        except OSError:
            log.warning("XMP를 읽을 수 없습니다: %s", path)
            entry = companion_disposition(path, "keep", "XMP를 읽을 수 없습니다. 파일을 확인한 뒤 다시 검사하세요.")
            for candidate in ([owner] if owner else candidates):
                attached[candidate].append(entry)
            if not candidates:
                unmatched.append(entry)
            continue
        options = []
        if owner:
            row = incoming_by_path[owner]
            if row[-2] == "ready":
                sidecar.update(companion_disposition(path, "move"))
                attached[owner].append(sidecar)
                continue
            if row[-2] == "duplicate":
                options = known_by_sha[row[4]]
        elif not candidates:
            prior_paths = source_candidates(path, known_origin_index)
            if prior_paths:
                options = [row for prior in prior_paths for row in known_by_origin[prior]]
            else:
                options = [known_by_path[item] for item in source_candidates(path, known_name_index, include_folder=False)]
        compatible = [row for row in options if not row["xmp_path"] or row["xmp_sha"] == sidecar["sha"]]
        if compatible and all(row["xmp_path"] for row in compatible):
            disposition, status = "already-stored", "already-stored"
            reason = "보관함에 같은 XMP가 기록되어 있습니다. Incoming 사본은 보존합니다."
        elif compatible:
            disposition, status, reason = "link", "pending", "보관함의 원본에 XMP를 연결할 수 있습니다."
        else:
            disposition, status = "keep", "review"
            reason = ("보관함 원본에 다른 XMP가 연결되어 있습니다." if options else
                      "원본 후보가 여러 개입니다." if not owner and candidates else
                      "원본 상태를 확인한 뒤 다시 검사하세요." if owner and row[-2] == "review" else
                      "연결할 수 있는 보관함 원본을 찾지 못했습니다.")
        options = compatible
        preferred = xmp_owner([row["path"] for row in options])
        sidecar["recommended"] = next((row["id"] for row in options if row["path"] == preferred), None)
        pending_id = uuid4().hex
        sidecar.update(companion_disposition(path, disposition, reason), pendingId=pending_id)
        if owner:
            sidecar["ownerPath"] = owner
        for candidate in ([owner] if owner else candidates):
            attached[candidate].append(sidecar)
        pending.append((pending_id, sidecar, [row["id"] for row in options], status, reason))
    return attached, pending, unmatched


def index_managed_xmp(managed):
    with database() as db:
        records = db.execute("SELECT id,path,xmp_path,xmp_sha FROM media WHERE status='available'").fetchall()
    by_path = {row["path"]: row for row in records}
    assigned = {row["xmp_path"]: row for row in records if row["xmp_path"]}
    free = {row["path"] for row in records if not row["xmp_path"]}
    index = source_index(free)
    seen = set()
    for path, initial in scan_tree(managed, {XMP}):
        seen.add(path)
        owner = assigned.get(path)
        if not owner:
            candidate = xmp_owner([item for item in source_candidates(path, index) if item in free])
            owner = by_path.get(candidate)
        if not owner or initial is None:
            continue
        try:
            sidecar = read_xmp(managed, path, fingerprint(initial))
        except OSError:
            log.warning("보관 중인 XMP를 읽을 수 없습니다: %s", path)
            continue
        if owner["xmp_sha"] != sidecar["sha"]:
            try:
                with database(write=True) as db:
                    associate_xmp(db, owner["id"], path, sidecar)
            except OSError as exc:
                log.warning("보관 중인 XMP 연결을 건너뜁니다: %s: %s", path, exc)
        free.discard(owner["path"])
    missing = assigned.keys() - seen
    if missing:
        with database(write=True) as db:
            db.executemany("UPDATE media SET xmp_path=NULL,xmp_sha=NULL,xmp_metadata=NULL WHERE xmp_path=? AND status='available'", [(path,) for path in missing])


def archived_hashes():
    known = {}
    with database() as db:
        for row in db.execute(
            """SELECT sha, path FROM remote_files
               WHERE status='present' AND sha IS NOT NULL
               ORDER BY coalesce(verified_at, last_seen_at) DESC, path"""
        ):
            known.setdefault(row["sha"], []).append(row["path"])
    return known


def job_progress(job_id, phase, completed=0, total=None, current=""):
    result = {"phase": phase, "completedFiles": completed, "totalFiles": total, "current": current}
    with database(write=True) as db:
        db.execute("UPDATE jobs SET result=? WHERE id=? AND status IN ('queued','running')",
                   (json.dumps(result, ensure_ascii=False), job_id))


def incoming_scan_error(exc):
    if isinstance(exc, FileNotFoundError):
        return "파일이 이동되었거나 삭제되었습니다. Incoming 폴더를 확인한 뒤 다시 검사하세요."
    if isinstance(exc, PermissionError):
        return "파일을 읽을 수 없습니다. Finder에서 읽기 권한을 확인한 뒤 다시 검사하세요."
    return "파일이 복사 중이거나 변경되었습니다. 복사가 끝난 뒤 다시 검사하세요."


def scan_incoming(job, incoming, managed):
    last_progress = 0

    def progress(phase, completed=0, total=None, current="", *, force=False):
        nonlocal last_progress
        stamp = time.monotonic()
        if force or stamp - last_progress >= 0.25:
            job_progress(job["id"], phase, completed, total, current)
            last_progress = stamp

    progress("보관함 파일 확인 중", force=True)
    known = index_managed(managed)
    remote_known = archived_hashes()
    index_managed_xmp(managed)
    progress("Incoming 파일 찾는 중", force=True)
    files = list(scan_tree(incoming, SUPPORTED | COMPANION_EXTENSIONS))
    candidates = [(path, info) for path, info in files if Path(path).suffix.lower() in SUPPORTED]
    companion_files = [(path, info) for path, info in files if Path(path).suffix.lower() in COMPANION_EXTENSIONS]
    if candidates:
        time.sleep(0.4)
    hashed = []
    total = len(candidates)
    hash_phase = "Incoming 파일 해시 검사 중"
    progress(hash_phase, total=total, force=True)
    for index, (path, initial) in enumerate(candidates):
        progress(hash_phase, index, total, path)
        try:
            if initial is None:
                raise OSError("파일 상태를 읽을 수 없습니다.")
            sha, info = hash_file(incoming, path, fingerprint(initial))
            snapshot, size, modified = fingerprint(info), info.st_size, iso_time(info.st_mtime)
            issue = ""
        except OSError as exc:
            sha, snapshot = None, None
            size = initial.st_size if initial else None
            modified = iso_time(initial.st_mtime) if initial else None
            issue = incoming_scan_error(exc) if initial is not None else "파일 상태를 읽을 수 없습니다. Finder에서 파일을 확인한 뒤 다시 검사하세요."
        hashed.append((path, sha, snapshot, size, modified, issue))

    in_batch = {}
    results = []
    thumbnail_phase = "썸네일 생성과 중복 확인 중"
    progress(thumbnail_phase, total=total, force=True)
    for index, (path, sha, snapshot, size, modified, issue) in enumerate(hashed):
        progress(thumbnail_phase, index, total, path)
        if issue:
            results.append((job["id"], uuid4().hex, path, snapshot, sha, size, modified, None, "review", issue))
            continue
        thumbnail = None
        try:
            if fingerprint(inspect(incoming, path)) != snapshot:
                raise OSError("해시 검사 후 파일이 변경되었습니다.")
            thumbnail = preview_thumbnail(incoming, path, sha, snapshot)
            if sha in known:
                status, reason = "duplicate", f"managed의 {known[sha][0][0]}와 동일"
            elif sha in remote_known:
                status, reason = "duplicate", f"원격 아카이브의 {remote_known[sha][0]}에 이미 보관됨"
            elif sha in in_batch:
                status, reason = "duplicate", f"이번 검사의 {in_batch[sha]}와 동일"
            else:
                status, reason = "ready", ""
                in_batch[sha] = path
        except OSError as exc:
            status, reason = "review", incoming_scan_error(exc)
            sha, snapshot, thumbnail = None, None, None
        results.append((job["id"], uuid4().hex, path, snapshot, sha, size, modified, thumbnail, status, reason))
    progress("동반 파일 확인 중", force=True)
    attached, pending, unmatched = plan_companions(incoming, companion_files, results)
    counts = {"checked": len(results), "ready": 0, "duplicate": 0, "review": 0, "unmatchedCompanions": unmatched}
    for row in results:
        counts[row[-2]] += 1
    with database(write=True) as db:
        db.executemany(
            """INSERT INTO scan_files (scan_id,id,path,fingerprint,sha,size,modified_at,thumbnail,status,reason,companions)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            [(*row, json.dumps(attached.get(row[2], []), ensure_ascii=False)) for row in results],
        )
        db.executemany("INSERT INTO scan_xmp (id,scan_id,file,candidates,status,reason) VALUES (?,?,?,?,?,?)", [
            (file_id, job["id"], json.dumps(sidecar, ensure_ascii=False), json.dumps(options), status, reason)
            for file_id, sidecar, options, status, reason in pending
        ])
        db.execute("DELETE FROM scan_files WHERE scan_id <> ?", (job["id"],))
        db.execute("DELETE FROM scan_xmp WHERE scan_id <> ?", (job["id"],))
        finish(db, job["id"], counts)


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


def associate_xmp(db, owner, target, sidecar):
    if owner in active_offload_media_ids(db):
        raise OSError("로컬 원본 비우기가 진행 중인 파일에는 XMP를 연결할 수 없습니다.")
    cursor = db.execute("UPDATE media SET xmp_path=?,xmp_sha=?,xmp_metadata=? WHERE id=? AND status='available'", (
        target, sidecar["sha"], json.dumps(sidecar["metadata"], ensure_ascii=False), owner,
    ))
    if cursor.rowcount != 1:
        raise OSError("managed 원본의 상태가 변경되어 XMP를 연결하지 않았습니다.")


def retain_xmp(incoming, managed, owner, sidecar):
    with database() as db:
        if owner in active_offload_media_ids(db):
            raise OSError("로컬 원본 비우기가 진행 중인 파일에는 XMP를 연결할 수 없습니다.")
        record = db.execute("SELECT * FROM media WHERE id=? AND status='available'", (owner,)).fetchone()
    if not record or fingerprint(inspect(managed, record["path"])) != record["fingerprint"]:
        raise OSError("managed 원본을 다시 확인해야 합니다.")
    if record["xmp_path"] and record["xmp_sha"] != sidecar["sha"]:
        raise OSError("원본에 다른 XMP가 이미 연결되어 있습니다.")
    target = record["xmp_path"] or Path(record["path"]).with_name(Path(sidecar["path"]).name).as_posix()
    with database() as db:
        if db.execute("SELECT 1 FROM media WHERE xmp_path=? AND id<>? AND status='available'", (target, owner)).fetchone():
            raise OSError("다른 원본이 이미 이 경로의 XMP를 사용합니다.")
    moved = False
    try:
        existing_sha, _ = hash_file(managed, target)
    except FileNotFoundError:
        actual_sha, _ = hash_file(incoming, sidecar["path"], sidecar["fingerprint"])
        if actual_sha != sidecar["sha"]:
            raise OSError("검사 이후 XMP 내용이 변경되었습니다.")
        move_file(incoming, sidecar["path"], managed, target, sidecar["fingerprint"], create_parent=False)
        moved = True
    else:
        if existing_sha != sidecar["sha"]:
            raise OSError("같은 경로에 다른 XMP가 있습니다.")
        try:
            actual_sha, _ = hash_file(incoming, sidecar["path"], sidecar["fingerprint"])
        except FileNotFoundError:
            # A previous attempt can have moved the XMP before recording the association.
            outcome = "linked"
        else:
            if actual_sha != sidecar["sha"]:
                raise OSError("검사 이후 XMP 내용이 변경되었습니다.")
            outcome = "already-stored"
    try:
        with database(write=True) as db:
            associate_xmp(db, owner, target, sidecar)
    except OSError:
        if moved:
            move_file(managed, target, incoming, sidecar["path"], fingerprint(inspect(managed, target)), create_parent=False)
        raise
    return "linked" if moved else outcome


def companion_error(exc):
    return exc.strerror if exc.errno is not None else str(exc)


def finish_import_companions(row, incoming, managed):
    results = []
    for companion in json.loads(row["companions"]):
        path = companion["path"]
        suffix = Path(path).suffix.lower()
        planned = companion.get("disposition", "move" if suffix == XMP else "delete-after-move")
        disposition, reason = planned, companion.get("reason", "")
        try:
            if suffix == XMP and planned == "move":
                disposition = retain_xmp(incoming, managed, row["id"], companion)
                reason = "보관함에 같은 XMP가 있어 Incoming 사본을 보존했습니다." if disposition == "already-stored" else ""
            elif suffix in CAMERA_AUX and planned == "delete-after-move":
                try:
                    delete_verified_file(incoming, path, companion["fingerprint"])
                except FileNotFoundError:
                    disposition, reason = "absent", "Incoming에서 이미 사라진 보조 파일입니다."
                else:
                    disposition, reason = "deleted", ""
        except OSError as exc:
            log.warning("동반 파일 처리에 확인이 필요합니다: %s: %s", path, exc)
            disposition, reason = "review", companion_error(exc)
        results.append({**companion, **companion_disposition(path, disposition, reason)})
    if results:
        with database(write=True) as db:
            db.execute("UPDATE scan_files SET companions=? WHERE id=?", (json.dumps(results, ensure_ascii=False), row["id"]))


def import_file(row, incoming, managed, known, remote_known=None):
    file_id, source, sha, snapshot = (row[key] for key in ("id", "path", "sha", "fingerprint"))
    name = Path(source).name
    target = f"{file_id}/{name}"
    with database() as db:
        intent = db.execute("SELECT status FROM media WHERE id=?", (file_id,)).fetchone()

    if intent and intent["status"] == "available":
        with database(write=True) as db:
            db.execute("UPDATE media SET original_path=coalesce(original_path,?) WHERE id=?", (source, file_id))
        finish_import_companions(row, incoming, managed)
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
            raise OSError("검사 이후 원본이 변경되었습니다. 다시 검사가 필요합니다.")
        duplicate = live_duplicate(managed, known, sha)
        if duplicate:
            set_outcome(file_id, "duplicate", f"managed의 {duplicate}와 동일")
            return
        if remote_known and sha in remote_known:
            set_outcome(file_id, "duplicate", f"원격 아카이브의 {remote_known[sha][0]}에 이미 보관됨")
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
    with database(write=True) as db:
        db.execute("UPDATE media SET original_path=? WHERE id=?", (source, file_id))
    finish_import_companions(row, incoming, managed)
    known.setdefault(sha, []).append((target, new_snapshot))
    set_outcome(file_id, "moved")


def import_selection(job, incoming, managed):
    known = index_managed(managed)
    remote_known = archived_hashes()
    ids = json.loads(job["payload"])["ids"]
    counts = {"moved": 0, "duplicate": 0, "review": 0, "items": []}
    for file_id in ids:
        with database() as db:
            row = db.execute("SELECT * FROM scan_files WHERE id=?", (file_id,)).fetchone()
        if row is None:
            counts["review"] += 1
            counts["items"].append(incoming_outcome(file_id, None, "review", "파일 검사 결과를 찾지 못했습니다."))
            continue
        if row["status"] == "ready":
            try:
                import_file(row, incoming, managed, known, remote_known)
            except OSError as exc:
                log.warning("파일 이동에 확인이 필요합니다: %s: %s", row["path"], exc)
                set_outcome(file_id, "review", companion_error(exc))
        with database() as db:
            updated = db.execute("SELECT status,reason,companions FROM scan_files WHERE id=?", (file_id,)).fetchone()
        status = updated["status"] if updated["status"] in {"moved", "duplicate"} else "review"
        companions = []
        for entry in json.loads(updated["companions"]):
            disposition = entry.get("disposition", "keep") if status == "moved" else "keep"
            reason = entry.get("reason", "") if status == "moved" else "원본이 이동하지 않아 동반 파일을 보존했습니다."
            companions.append(companion_disposition(entry["path"], disposition, reason))
            tally = {"linked": "xmp", "deleted": "auxDeleted", "review": "companionReview"}.get(disposition)
            if tally:
                counts[tally] = counts.get(tally, 0) + 1
        counts[status] += 1
        counts["items"].append(incoming_outcome(file_id, row["path"], status, updated["reason"], companions))
    with database(write=True) as db:
        finish(db, job["id"], counts)


def incoming_outcome(file_id, path, status, reason, companions=None):
    item = {"id": file_id, "path": path, "status": status, "reason": reason}
    if companions:
        item["companions"] = companions
    return item


def record_xmp_outcome(db, row, sidecar, status, reason):
    db.execute("UPDATE scan_xmp SET status=?, reason=? WHERE id=?", (status, reason, row["id"]))
    owner = sidecar.get("ownerPath")
    if not owner:
        return
    original = db.execute("SELECT id,companions FROM scan_files WHERE scan_id=? AND path=?", (row["scan_id"], owner)).fetchone()
    if not original:
        return
    entries = json.loads(original["companions"])
    for entry in entries:
        if entry.get("pendingId") == row["id"]:
            entry.update(disposition=status if status != "review" else "keep", reason=reason)
    db.execute("UPDATE scan_files SET companions=? WHERE id=?", (json.dumps(entries, ensure_ascii=False), original["id"]))


def link_xmp_selection(job, incoming, managed):
    counts = {"linked": 0, "alreadyStored": 0, "review": 0, "items": []}
    for link in json.loads(job["payload"])["links"]:
        with database() as db:
            row = db.execute("SELECT * FROM scan_xmp WHERE id=?", (link["id"],)).fetchone()
        status, reason = (row["status"], row["reason"]) if row else ("review", "XMP 검사 결과가 없습니다.")
        sidecar = json.loads(row["file"]) if row else None
        if status == "pending":
            try:
                status = retain_xmp(incoming, managed, link["media_id"], sidecar)
                reason = "보관함에 같은 XMP가 있어 Incoming 사본을 보존했습니다." if status == "already-stored" else ""
            except OSError as exc:
                status = "review"
                reason = companion_error(exc)
            with database(write=True) as db:
                record_xmp_outcome(db, row, sidecar, status, reason)
        counts["alreadyStored" if status == "already-stored" else status] += 1
        counts["items"].append(incoming_outcome(link["id"], sidecar["path"] if sidecar else None, status, reason))
    with database(write=True) as db:
        finish(db, job["id"], counts)


def delete_scanned_photo(row, incoming):
    file_id = row["id"]
    recovering = row["status"] == "deleting"
    try:
        try:
            sha, _ = hash_file(incoming, row["path"], row["fingerprint"])
            if sha != row["sha"]:
                raise OSError("검사 이후 파일이 변경되었습니다. 다시 검사가 필요합니다.")
            if not recovering:
                with database(write=True) as db:
                    db.execute("UPDATE scan_files SET status='deleting' WHERE id=?", (file_id,))
            delete_photo(incoming, row["path"], row["fingerprint"])
        except FileNotFoundError:
            if not recovering:
                raise
    except OSError as exc:
        with database(write=True) as db:
            reason = "사진이 변경되었거나 삭제할 수 없습니다. 다시 검사 후 다시 확인하세요."
            db.execute("UPDATE scan_files SET status='review', reason=?, thumbnail=NULL WHERE id=?", (reason, file_id))
        log.warning("사진 삭제에 확인이 필요합니다: %s: %s", row["path"], exc)
        return "review"
    with database(write=True) as db:
        db.execute("UPDATE scan_files SET status='deleted', thumbnail=NULL WHERE id=?", (file_id,))
    return "deleted"


def _promote_ready_companions(db, row):
    entries = json.loads(row["companions"])
    for entry in entries:
        kind = entry.get("kind") or Path(entry["path"]).suffix.lower().lstrip(".")
        if kind == "xmp" and entry.get("ownerPath") == row["path"] and entry.get("disposition") != "linked":
            pending_id = entry.pop("pendingId", None)
            entry.update(disposition="move", reason="")
            if pending_id:
                db.execute("DELETE FROM scan_xmp WHERE id=? AND status<>'linked'", (pending_id,))
        elif f".{kind}" in CAMERA_AUX and entry.get("fingerprint") and entry.get("disposition") == "keep":
            entry.update(disposition="delete-after-move", reason="")
    return json.dumps(entries, ensure_ascii=False)


def refresh_deleted_group(managed, sha):
    with database() as db:
        copies = db.execute("SELECT path,fingerprint FROM media WHERE sha=? AND status='available'", (sha,)).fetchall()
        remaining = db.execute(
            """SELECT id,path,status,companions FROM scan_files WHERE sha=? AND status IN ('ready','duplicate')
               ORDER BY (status='ready') DESC,path""", (sha,)
        ).fetchall()
        references = thumbnails.sha_is_referenced(db, sha)

    duplicate = live_duplicate(managed, {sha: [(row["path"], row["fingerprint"]) for row in copies]}, sha)
    remote = archived_hashes().get(sha)
    if remaining:
        with database(write=True) as db:
            for index, row in enumerate(remaining):
                if duplicate:
                    status, reason = "duplicate", f"managed의 {duplicate}와 동일"
                elif remote:
                    status, reason = "duplicate", f"원격 아카이브의 {remote[0]}에 이미 보관됨"
                elif index:
                    status, reason = "duplicate", f"이번 검사의 {remaining[0]['path']}와 동일"
                else:
                    status, reason = "ready", ""
                if row["status"] == "duplicate" and status == "ready":
                    companions = _promote_ready_companions(db, row)
                    db.execute("UPDATE scan_files SET status=?, reason=?, companions=? WHERE id=?",
                               (status, reason, companions, row["id"]))
                else:
                    db.execute("UPDATE scan_files SET status=?, reason=? WHERE id=?", (status, reason, row["id"]))
    if not references:
        try:
            thumbnail_path(sha).unlink(missing_ok=True)
        except OSError as exc:
            log.warning("사용하지 않는 썸네일을 제거할 수 없습니다: %s", exc)


def delete_selection(job, incoming, managed):
    ids = json.loads(job["payload"])["ids"]
    counts = {"deleted": 0, "review": 0, "items": []}
    hashes = set()
    for file_id in ids:
        with database() as db:
            row = db.execute("SELECT * FROM scan_files WHERE id=?", (file_id,)).fetchone()
        outcome = row["status"] if row else "review"
        if outcome in {"ready", "duplicate", "deleting"}:
            outcome = delete_scanned_photo(row, incoming)
        status = outcome if outcome == "deleted" else "review"
        counts[status] += 1
        reason, companions = "파일 검사 결과를 찾지 못했습니다.", []
        if row:
            with database() as db:
                reason = db.execute("SELECT reason FROM scan_files WHERE id=?", (file_id,)).fetchone()["reason"] if status == "review" else ""
            for entry in json.loads(row["companions"]):
                if entry.get("disposition") not in {"linked", "deleted"}:
                    companions.append(companion_disposition(entry["path"], "keep", "사진 삭제 시 동반 파일은 보존합니다."))
        counts["items"].append(incoming_outcome(file_id, row["path"] if row else None, status, reason, companions))
        if outcome == "deleted":
            hashes.add(row["sha"])
    for sha in hashes:
        refresh_deleted_group(managed, sha)
    with database(write=True) as db:
        finish(db, job["id"], counts)


def finish(db, job_id, result, status="done"):
    db.execute(
        "UPDATE jobs SET status=?, result=?, finished_at=? WHERE id=? AND status IN ('queued', 'running')",
        (status, json.dumps(result, ensure_ascii=False), now(), job_id),
    )


class WorkerCoordinator:
    def __init__(self, incoming=None, managed=None, *, handlers=None, poll_interval=0.4):
        self.incoming, self.managed = incoming, managed
        self.stop_event = threading.Event()
        self.handlers = handlers if handlers is not None else {
            "storage-wake": partial(run_storage_wake, stop_event=self.stop_event),
            "storage-shutdown": partial(run_storage_shutdown, stop_event=self.stop_event),
            "scan": scan_incoming, "move": import_selection, "delete": delete_selection,
            "duplicate-cleanup": partial(cleanup_duplicates, refresh_group=refresh_deleted_group),
            "xmp-link": link_xmp_selection, "upload": upload_selection,
            "offload": offload_selection, "remote-index": index_remote_archive,
            "reset-all": reset_local_data,
            "thumbnails-local": thumbnails.generate_thumbnails,
            "thumbnails-remote": thumbnails.generate_thumbnails,
        }
        self.poll_interval = poll_interval
        self.running = {}
        self.wake_event = threading.Event()

    def recover_stale_jobs(self):
        with database(write=True) as db:
            db.execute("UPDATE jobs SET status='queued' WHERE status='running'")

    def reap_finished(self):
        for lane, thread in list(self.running.items()):
            if not thread.is_alive():
                thread.join(timeout=0)
                del self.running[lane]

    def stop(self):
        self.stop_event.set()
        self.wake_event.set()

    def dispatch_once(self):
        self.reap_finished()
        if self.stop_event.is_set():
            return
        claimed = []
        with database(write=True) as db:
            exclusive = db.execute("SELECT * FROM jobs WHERE status='queued' AND lane='exclusive' ORDER BY id LIMIT 1").fetchone()
            exclusive_running = db.execute("SELECT 1 FROM jobs WHERE status='running' AND lane='exclusive' LIMIT 1").fetchone()
            if exclusive or exclusive_running:
                if exclusive and not self.running and not db.execute("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").fetchone():
                    claimed.append(dict(exclusive))
            else:
                for lane in (LANE_LOCAL, LANE_REMOTE):
                    if lane not in self.running:
                        job = db.execute("SELECT * FROM jobs WHERE status='queued' AND lane=? ORDER BY id LIMIT 1", (lane,)).fetchone()
                        if job:
                            claimed.append(dict(job))
            for job in claimed:
                db.execute("UPDATE jobs SET status='running' WHERE id=?", (job['id'],))
                job['status'] = 'running'
        for job in claimed:
            lane = job['lane']
            if lane == LANE_EXCLUSIVE:
                self._run_job(lane, job)
            else:
                thread = threading.Thread(target=self._run_job, args=(lane, job), name=f"worker-{lane}-{job['id']}")
                self.running[lane] = thread
                thread.start()

    def _run_job(self, lane, job):
        try:
            self.handlers[job['kind']](job, self.incoming, self.managed)
        except Exception:
            log.exception("작업이 실패했습니다: %s", job['id'])
            with database(write=True) as db:
                finish(db, job['id'], {"error": "작업을 마치지 못했습니다. 경로와 워커 로그를 확인하세요."}, "failed")
        finally:
            self.wake_event.set()

    def run(self):
        self.recover_stale_jobs()
        try:
            while not self.stop_event.is_set():
                self.dispatch_once()
                self.wake_event.wait(timeout=self.poll_interval)
                self.wake_event.clear()
        finally:
            for thread in self.running.values():
                thread.join()
            self.reap_finished()


def run():
    incoming, managed = configure()
    initialize()
    THUMBNAILS.mkdir(parents=True, exist_ok=True)
    with (DATA / "worker.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        thumbnails.cleanup_temp_thumbnails()
        coordinator = WorkerCoordinator(incoming, managed)
        previous = {}
        if threading.current_thread() is threading.main_thread():
            for sig in (signal.SIGTERM, signal.SIGINT):
                previous[sig] = signal.signal(sig, lambda _signum, _frame: coordinator.stop())
        log.info("수집 워커 시작 · %s → %s", incoming, managed)
        try:
            coordinator.run()
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
