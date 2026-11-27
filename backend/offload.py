"""Safe removal of local managed copies after live SFTP verification."""
import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import BaseModel, Field

from archive import (
    active_storage_scope, archive_config, archive_connection, archive_revision as config_identity,
    resolve_remote_file, storage_id_for, sftp_disconnected,
)
from catalog import LANE_REMOTE, active_duplicate_keeper_ids, database, now, queue_job
from media import delete_verified_file, directory, fingerprint, regular_file, relative_parts
from settings import fail, read_local_retention


def parse_utc_iso(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def compute_media_retention(row, active_copies, xmp_active, policy, now_dt, *, active_storage_id=None):
    result = dict(archivedAt=None, retentionDueAt=None, retentionEligible=False, missingVerifiedAt=False)
    can_offload = bool(active_copies) and (not row["xmp_path"] or bool(row["xmp_sha"] and xmp_active))
    if not can_offload:
        return result

    def earliest(copies):
        same_storage = [c for c in copies if active_storage_id and c["storage_id"] == active_storage_id]
        valid = [t for c in (same_storage or copies) if (t := parse_utc_iso(c.get("verified_at"))) is not None]
        return min(valid) if valid else None

    media_at = earliest(active_copies)
    xmp_at = earliest(xmp_active) if row["xmp_path"] else media_at
    if media_at is None or xmp_at is None:
        result["missingVerifiedAt"] = row["status"] == "available" and can_offload
        return result
    archived_dt = max(media_at, xmp_at)
    result["archivedAt"] = archived_dt.isoformat()
    if policy["mode"] == "days":
        due = archived_dt + timedelta(days=policy["days"])
        result["retentionDueAt"] = due.isoformat()
        result["retentionEligible"] = row["status"] == "available" and can_offload and (policy["days"] == 0 or now_dt >= due)
    return result


def candidate_context(db):
    storage_id, root = active_storage_scope()
    copies = {}
    if root:
        for row in db.execute("SELECT * FROM remote_files WHERE archive_root=? AND status='present' AND sha IS NOT NULL", (root,)):
            copies.setdefault(row["sha"], []).append(dict(row))
    return storage_id, root, copies, active_duplicate_keeper_ids(db)


def candidate_summary(rows, *, sample_limit):
    return {
        "ids": [row["id"] for row in rows[:10000]], "totalEligibleCount": len(rows),
        "truncated": len(rows) > 10000, "totalBytes": sum(row["sizeBytes"] + (row["xmpSizeBytes"] or 0) for row in rows),
        "samples": rows[:sample_limit],
    }


def candidate_view(row, copies, storage_id):
    xmp = copies.get(row["xmp_sha"], [])
    xmp.sort(key=lambda c: c["storage_id"] != storage_id)
    return {"id": row["id"], "name": row["name"], "sizeBytes": row["size"] or 0,
            "xmpSizeBytes": xmp[0]["size"] if row["xmp_path"] and xmp else None}


def retention_candidates(db, *, policy=None, now_dt=None):
    storage_id, root, copies, keepers = candidate_context(db)
    policy = read_local_retention() if policy is None else policy
    stamp = datetime.now(timezone.utc) if now_dt is None else now_dt
    eligible, blocked, missing = [], 0, 0
    for row in db.execute("SELECT * FROM media WHERE status='available'"):
        info = compute_media_retention(row, copies.get(row["sha"], []), copies.get(row["xmp_sha"], []), policy, stamp, active_storage_id=storage_id)
        missing += int(info["missingVerifiedAt"])
        if not info["retentionEligible"]:
            continue
        if row["id"] in keepers:
            blocked += 1
            continue
        eligible.append({**candidate_view(row, copies, storage_id), "archivedAt": info["archivedAt"], "retentionDueAt": info["retentionDueAt"]})
    eligible.sort(key=lambda r: (r["archivedAt"], r["name"], r["id"]))
    return {**candidate_summary(eligible, sample_limit=50), "blockedByKeeperCount": blocked, "missingVerifiedAtCount": missing, "storageConfigured": bool(root)}


def upload_offload_candidates(db, job_id):
    if not db.execute("SELECT 1 FROM jobs WHERE id=? AND kind='upload'", (job_id,)).fetchone():
        fail(404, "업로드 작업을 찾을 수 없습니다.")
    storage_id, root, copies, keepers = candidate_context(db)
    eligible, blocked, missing_xmp = [], 0, 0
    for entry in db.execute("""SELECT media_id,MIN(item_index) FROM archive_entries
            WHERE job_id=? AND outcome IN ('uploaded','skipped') GROUP BY media_id ORDER BY MIN(item_index)""", (job_id,)):
        row = db.execute("SELECT * FROM media WHERE id=? AND status='available'", (entry["media_id"],)).fetchone()
        if not row or not copies.get(row["sha"]):
            continue
        if row["xmp_path"] and (not row["xmp_sha"] or not copies.get(row["xmp_sha"])):
            missing_xmp += 1
            continue
        if row["id"] in keepers:
            blocked += 1
            continue
        eligible.append(candidate_view(row, copies, storage_id))
    return {**candidate_summary(eligible, sample_limit=20), "blockedByKeeperCount": blocked, "excludedMissingXmp": missing_xmp}


class OffloadRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=10000)


def find_remote_copy(db, sha, storage_id, archive_root):
    return db.execute(
        """SELECT storage_id, path, archive_root, sha, size
           FROM remote_files
           WHERE sha=? AND status='present' AND archive_root=?
           ORDER BY (storage_id=?) DESC, coalesce(verified_at, last_seen_at) DESC, path
           LIMIT 1""",
        (sha, archive_root, storage_id),
    ).fetchone()


def build_offload_item(db, file_id, storage_id, archive_root, *, allow_offloading=False):
    row = db.execute("SELECT * FROM media WHERE id=?", (file_id,)).fetchone()
    if not row or row["status"] not in ({"available", "offloading"} if allow_offloading else {"available"}):
        fail(409, "로컬에 보관 중인 파일만 비울 수 있습니다. 화면을 새로 고침하세요.")
    primary = find_remote_copy(db, row["sha"], storage_id, archive_root)
    if not primary:
        fail(409, "원격 아카이브에 검증된 사본이 없는 파일이 포함되어 있습니다. 먼저 업로드하세요.")
    xmp_entry = None
    if row["xmp_path"]:
        if not row["xmp_sha"]:
            fail(409, "연결된 XMP의 해시 정보를 확인할 수 없습니다. 먼저 새로 고침하세요.")
        xmp_remote = find_remote_copy(db, row["xmp_sha"], storage_id, archive_root)
        if not xmp_remote:
            fail(409, "연결된 XMP가 아직 아카이브에 업로드되지 않았습니다. XMP를 함께 업로드한 뒤 로컬 원본을 비우세요.")
        xmp_entry = {
            "local": row["xmp_path"], "sha": row["xmp_sha"], "size": xmp_remote["size"],
            "remoteStorageId": xmp_remote["storage_id"], "remotePath": xmp_remote["path"],
        }
    return {
        "id": row["id"], "name": row["name"], "local": row["path"],
        "sha": row["sha"], "size": row["size"], "fingerprint": row["fingerprint"],
        "remoteStorageId": primary["storage_id"], "remotePath": primary["path"],
        "xmp": xmp_entry,
    }


def queue_offload(db, request):
    ids = list(dict.fromkeys(request.ids))
    if active_duplicate_keeper_ids(db).intersection(ids):
        fail(409, "Incoming 중복 정리에서 보존할 로컬 원본입니다. 정리 완료 후 다시 시도하세요.")
    config = archive_config()
    storage_id = storage_id_for(config)
    files = [build_offload_item(db, file_id, storage_id, config["root"]) for file_id in ids]
    payload = {
        "config": config_identity(config), "storageId": storage_id,
        "archiveRoot": config["root"], "files": files,
    }
    try:
        job_id = queue_job(db, "offload", payload)
    except ValueError as exc:
        fail(409, str(exc))
    result = {
        "totalFiles": len(files), "completedFiles": 0, "offloaded": 0, "failed": 0,
        "freedBytes": 0, "errors": [], "current": "", "phase": "대기 중",
    }
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job_id))
    return {"id": job_id, "lane": LANE_REMOTE, "count": len(files)}


def mark_remote_missing(storage_id, remote_path):
    with database(write=True) as db:
        db.execute(
            "UPDATE remote_files SET status='missing', last_seen_at=? WHERE storage_id=? AND path=?",
            (now(), storage_id, remote_path),
        )


def verify_remote_asset(sftp, archive_root, storage_id, remote_path, expected_sha, expected_size):
    with database() as db:
        record = db.execute(
            """SELECT sha, size, archive_root, status FROM remote_files
               WHERE storage_id=? AND path=?""",
            (storage_id, remote_path),
        ).fetchone()
    if (not record or record["status"] != "present" or record["archive_root"] != archive_root
            or record["sha"] != expected_sha):
        fail(409, "원격 검증 기록이 변경되었습니다. 다시 확인하세요.")
    try:
        _, info = resolve_remote_file(sftp, archive_root, remote_path)
    except HTTPException as error:
        if error.status_code == 404:
            mark_remote_missing(storage_id, remote_path)
            fail(409, "원격 아카이브에서 파일이 사라져 로컬 원본을 유지했습니다.")
        raise
    if info.st_size != expected_size:
        mark_remote_missing(storage_id, remote_path)
        fail(409, "원격 파일 크기가 검증 기록과 달라 로컬 원본을 유지했습니다.")
    return info


def remove_empty_parent(managed, local_path):
    parts = relative_parts(local_path)
    if len(parts) != 2:
        return
    try:
        with directory(managed) as managed_fd:
            os.rmdir(parts[0], dir_fd=managed_fd)
    except OSError:
        pass


def offload_file(sftp, config, managed, item, *, cancel_check=None):
    with database() as db:
        row = db.execute("SELECT * FROM media WHERE id=?", (item["id"],)).fetchone()
    if not row:
        fail(409, "파일 기록을 찾을 수 없습니다.")
    if row["status"] == "archived":
        return 0
    if row["status"] not in {"available", "offloading"}:
        fail(409, "로컬에 보관 중인 파일만 비울 수 있습니다.")
    if row["sha"] != item["sha"] or row["path"] != item["local"]:
        fail(409, "카탈로그의 원본 정보가 변경되어 비우지 않았습니다.")
    expected_xmp = item["xmp"]
    if (row["xmp_path"] or None) != (expected_xmp["local"] if expected_xmp else None) or \
            (row["xmp_sha"] or None) != (expected_xmp["sha"] if expected_xmp else None):
        fail(409, "연결된 XMP 정보가 변경되어 비우지 않았습니다.")

    verify_remote_asset(
        sftp, config["root"], item["remoteStorageId"], item["remotePath"], item["sha"], item["size"],
    )
    if expected_xmp:
        verify_remote_asset(
            sftp, config["root"], expected_xmp["remoteStorageId"], expected_xmp["remotePath"],
            expected_xmp["sha"], expected_xmp["size"],
        )

    recovering = row["status"] == "offloading"
    primary_exists = False
    try:
        with regular_file(managed, item["local"], expected=item["fingerprint"]) as (stream, local_info):
            if local_info.st_size != item["size"] or hashlib.file_digest(stream, "sha256").hexdigest() != item["sha"]:
                fail(409, "로컬 원본이 검사 이후 변경되어 비우지 않았습니다.")
            primary_exists = True
    except FileNotFoundError:
        if not recovering:
            fail(409, "로컬 원본을 찾을 수 없어 비우기를 중단했습니다.")

    xmp_fingerprint = None
    if expected_xmp:
        try:
            with regular_file(managed, expected_xmp["local"]) as (xmp_stream, xmp_info):
                if xmp_info.st_size != expected_xmp["size"] or hashlib.file_digest(xmp_stream, "sha256").hexdigest() != expected_xmp["sha"]:
                    fail(409, "로컬 XMP가 검사 이후 변경되어 비우지 않았습니다.")
                xmp_fingerprint = fingerprint(xmp_info)
        except FileNotFoundError:
            if not recovering:
                fail(409, "로컬 XMP를 찾을 수 없어 비우기를 중단했습니다.")

    if not recovering:
        if cancel_check:
            cancel_check()
        with database(write=True) as db:
            if item["id"] in active_duplicate_keeper_ids(db):
                fail(409, "Incoming 중복 정리에서 보존할 로컬 원본입니다. 정리 완료 후 다시 시도하세요.")
            cursor = db.execute(
                """UPDATE media SET status='offloading' WHERE id=? AND status='available'
                   AND sha=? AND path=? AND xmp_path IS ? AND xmp_sha IS ?""",
                (item["id"], item["sha"], item["local"],
                 expected_xmp["local"] if expected_xmp else None,
                 expected_xmp["sha"] if expected_xmp else None),
            )
            if cursor.rowcount != 1:
                fail(409, "카탈로그의 원본 또는 XMP 정보가 변경되어 비우지 않았습니다.")

    if primary_exists:
        delete_verified_file(managed, item["local"], item["fingerprint"])
    if expected_xmp and xmp_fingerprint:
        delete_verified_file(managed, expected_xmp["local"], xmp_fingerprint)
    remove_empty_parent(managed, item["local"])

    stamp = now()
    with database(write=True) as db:
        db.execute("UPDATE media SET status='archived' WHERE id=?", (item["id"],))
        db.execute(
            "UPDATE remote_files SET last_seen_at=? WHERE storage_id=? AND path=?",
            (stamp, item["remoteStorageId"], item["remotePath"]),
        )
        if expected_xmp:
            db.execute(
                "UPDATE remote_files SET last_seen_at=? WHERE storage_id=? AND path=?",
                (stamp, expected_xmp["remoteStorageId"], expected_xmp["remotePath"]),
            )
    return (item["size"] if primary_exists else 0) + (expected_xmp["size"] if expected_xmp and xmp_fingerprint else 0)


class OffloadCancelled(Exception):
    pass


def check_offload_cancel(job_id):
    with database() as db:
        row = db.execute("SELECT result FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row and json.loads(row["result"] or "{}").get("cancelRequested"):
        raise OffloadCancelled()


def cancel_offload_job(db, job_id):
    job = db.execute("SELECT * FROM jobs WHERE id=? AND kind='offload'", (job_id,)).fetchone()
    if not job:
        fail(404, "로컬 비우기 작업을 찾을 수 없습니다.")
    if job["status"] in {"queued", "running"}:
        result = json.loads(job["result"] or "{}")
        result.update(cancelRequested=True, phase="중지됨" if job["status"] == "queued" else "중지 요청됨")
        if job["status"] == "queued":
            result["error"] = "로컬 원본 비우기를 중지했습니다."
            db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=?", (now(), job_id))
        db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job_id))
    return db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()


def offload_selection(job, _incoming, managed):
    payload = json.loads(job["payload"])
    result = {
        "totalFiles": len(payload["files"]), "completedFiles": 0, "offloaded": 0, "failed": 0,
        "freedBytes": 0, "errors": [], "current": "", "phase": "원격 연결 중",
    }
    last_update = 0

    def save(force=False):
        nonlocal last_update
        if not force and time.monotonic() - last_update < 0.3:
            return
        with database(write=True) as db:
            saved = db.execute("SELECT result FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if saved and json.loads(saved["result"] or "{}").get("cancelRequested"):
                raise OffloadCancelled()
            db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job["id"]))
        last_update = time.monotonic()

    status = "done"
    try:
        # A crash may leave a file inside its atomic deletion boundary. Settle
        # only those files before honoring a persisted cancellation request.
        try:
            check_offload_cancel(job["id"])
        except OffloadCancelled:
            recovery = []
            with database(write=True) as db:
                for item in payload["files"]:
                    row = db.execute("SELECT status FROM media WHERE id=?", (item["id"],)).fetchone()
                    if row and row["status"] == "archived":
                        result["offloaded"] += 1
                        result["completedFiles"] += 1
                    if not row or row["status"] != "offloading":
                        continue
                    paths = [item["local"]] + ([item["xmp"]["local"]] if item["xmp"] else [])
                    if all((managed / path).is_file() for path in paths):
                        db.execute("UPDATE media SET status='available' WHERE id=? AND status='offloading'", (item["id"],))
                    else:
                        recovery.append(item)
            if recovery:
                config = archive_config()
                if config_identity(config) != payload["config"]:
                    fail(409, "작업 예약 후 SSH 설정이 변경되었습니다. 다시 실행하세요.")
                with archive_connection(config) as (sftp, config):
                    for item in recovery:
                        result["freedBytes"] += offload_file(sftp, config, managed, item)
                        result["offloaded"] += 1
                        result["completedFiles"] += 1
            raise
        save(True)
        config = archive_config()
        if config_identity(config) != payload["config"]:
            fail(409, "작업 예약 후 SSH 설정이 변경되었습니다. 다시 실행하세요.")
        with archive_connection(config) as (sftp, config):
            for item in payload["files"]:
                check_offload_cancel(job["id"])
                result["current"] = item["name"]
                result["phase"] = "원격 확인 및 로컬 비우기 중"
                save()
                try:
                    freed = offload_file(sftp, config, managed, item, cancel_check=lambda: check_offload_cancel(job["id"]))
                    result["offloaded"] += 1
                    result["freedBytes"] += freed
                except (OSError, ValueError, HTTPException) as error:
                    if sftp_disconnected(sftp, error):
                        raise
                    result["failed"] += 1
                    message = error.detail if isinstance(error, HTTPException) else "파일을 확인하거나 삭제하지 못했습니다. 원본은 유지됩니다."
                    if len(result["errors"]) < 100:
                        result["errors"].append({"path": item["local"], "message": message})
                result["completedFiles"] += 1
                save(True)
        if result["failed"]:
            status = "failed"
            result["error"] = f"{result['failed']}개 파일의 로컬 원본을 비우지 못했습니다. 원본은 유지됩니다."
    except OffloadCancelled:
        status = "cancelled"
        result["cancelRequested"] = True
        result["error"] = f"로컬 원본 비우기를 중지했습니다. {result['offloaded']}개 비우기 완료, 나머지 로컬 원본은 유지됩니다."
    except Exception as error:
        status = "failed"
        result["error"] = error.detail if isinstance(error, HTTPException) else "원격 스토리지 확인에 실패했습니다. 로컬 원본은 유지됩니다."
        pending = payload["files"][result["completedFiles"]:]
        result["failed"] += len(pending)
        result["completedFiles"] = result["totalFiles"]
        for item in pending[:max(0, 100 - len(result["errors"]))]:
            result["errors"].append({"path": item["local"], "message": result["error"]})
    result["phase"] = "완료" if status == "done" else "중지됨" if status == "cancelled" else "실패"
    result["current"] = ""
    with database(write=True) as db:
        db.execute(
            "UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?",
            (status, json.dumps(result, ensure_ascii=False), now(), job["id"]),
        )
