"""Plan Incoming duplicate cleanup and verify that a separate copy survives."""

import hashlib
import json
import logging
from collections import defaultdict
from contextlib import ExitStack
from pathlib import PurePosixPath

from fastapi import HTTPException

from archive import archive_config, archive_connection, archive_revision, resolve_remote_file, storage_id_for
from catalog import LANE_LOCAL, active_offload_media_ids, database, load_latest_scan, now, queue_job
from companions import CAMERA_AUX, aux_owner, source_candidates, source_index
from media import (SUPPORTED, delete_verified_file, fingerprint, hash_file, inspect, iso_time,
                   relative_parts, scan_tree, size_from_fingerprint)
from settings import fail
from transfers import CONNECTION_ERRORS, remote_hash, sftp_disconnected, stat_mtime_ns

VERIFICATION_ERRORS = (HTTPException, OSError, ValueError, *CONNECTION_ERRORS)
log = logging.getLogger(__name__)


def _archive_config_if_set():
    try:
        return archive_config()
    except HTTPException:
        return None


def _scan_snapshot(db, ids):
    scan = load_latest_scan(db)
    rows = db.execute(
        """SELECT id,scan_id,path,sha,size,fingerprint,status,companions FROM scan_files
           WHERE scan_id=? AND status IN ('ready','duplicate') ORDER BY (status='duplicate'), path""",
        (scan["id"],),
    ) if scan else ()
    candidates = {row["id"]: row for row in rows if row["sha"] and row["fingerprint"] and
                  row["size"] is not None and PurePosixPath(row["path"]).suffix.lower() in SUPPORTED}
    groups = defaultdict(list)
    for file_id in dict.fromkeys(ids):
        row = candidates.get(file_id)
        if row is None or row["status"] != "duplicate":
            fail(409, "검사 결과가 변경되었습니다. 현재 중복 파일을 다시 선택하세요.")
        groups[row["sha"]].append(row)
    return candidates, groups


def _local_keeper(kind, row):
    return {"kind": kind, **{key: row[key] for key in ("id", "path", "fingerprint", "size")}}


def _keepers_for_group(db, sha, selected, incoming, offloading, config):
    keepers = [_local_keeper("managed", row) for row in db.execute(
        """SELECT id,path,fingerprint,size FROM media WHERE sha=? AND status='available'
           AND fingerprint<>'' ORDER BY path""", (sha,),
    ) if row["id"] not in offloading]
    if config:
        storage_id, revision = storage_id_for(config), archive_revision(config)
        for row in db.execute(
            """SELECT path,size,verified_at FROM remote_files WHERE sha=? AND storage_id=?
               AND archive_root=? AND status='present' AND verified_at IS NOT NULL
               ORDER BY verified_at DESC,path""", (sha, storage_id, config["root"]),
        ):
            keeper_id = hashlib.sha256(f"{revision}\0{row['path']}".encode()).hexdigest()
            keepers.append({"kind": "remote", "id": keeper_id, "path": row["path"], "size": row["size"],
                            "verifiedAt": row["verified_at"], "revision": revision, "storageId": storage_id,
                            "root": config["root"]})
    selected_paths = {row["path"] for row in selected}
    keepers.extend(_local_keeper("incoming", row) for row in incoming
                   if selected_paths - {row["path"]})
    return keepers


def _duplicate_groups(db, ids):
    candidates, selected = _scan_snapshot(db, ids)
    incoming_by_sha = defaultdict(list)
    for row in candidates.values():
        if row["sha"] in selected:
            incoming_by_sha[row["sha"]].append(row)
    config, offloading = _archive_config_if_set(), active_offload_media_ids(db)
    return [(sha, files, _keepers_for_group(db, sha, files, incoming_by_sha[sha], offloading, config))
            for sha, files in selected.items()]


def deletable_aux_companions(row):
    return [{"path": entry["path"],
             "kind": PurePosixPath(entry["path"]).suffix.lower().lstrip("."),
             "fingerprint": entry["fingerprint"],
             "size": entry.get("size") if entry.get("size") is not None else size_from_fingerprint(entry["fingerprint"])}
            for entry in json.loads(row["companions"] or "[]")
            if PurePosixPath(entry.get("path", "")).suffix.lower() in CAMERA_AUX
            and entry.get("fingerprint") and entry.get("disposition") in {"keep", "delete-after-move"}]


def _unique_aux(db, rows):
    """Reject shared references, even if a corrupt scan assigned a unique owner."""
    references = defaultdict(set)
    selected_counts = defaultdict(int)
    for scan_id in {row["scan_id"] for row in rows}:
        for row in db.execute("SELECT id,companions FROM scan_files WHERE scan_id=? AND status IN ('ready','duplicate','review')", (scan_id,)):
            for entry in json.loads(row["companions"] or "[]"):
                if entry.get("fingerprint"):
                    references[entry.get("path")].add(row["id"])
    candidates = {row["id"]: deletable_aux_companions(row) for row in rows}
    for entries in candidates.values():
        for entry in entries:
            selected_counts[entry["path"]] += 1
    return {key: [entry for entry in entries if len(references[entry["path"]]) <= 1
                  and selected_counts[entry["path"]] == 1] for key, entries in candidates.items()}


def plan_duplicate_cleanup(db, ids):
    planned = _duplicate_groups(db, ids)
    aux = _unique_aux(db, [row for _sha, rows, _keepers in planned for row in rows])
    groups = []
    for sha, files, keepers in planned:
        group = {
            "sha": sha,
            "files": [{"id": row["id"], "path": row["path"], "sizeBytes": row["size"]} for row in files],
            "auxCompanions": [{"fileId": row["id"], "path": entry["path"], "kind": entry["kind"], "sizeBytes": entry["size"]}
                              for row in files for entry in aux[row["id"]]],
            "keepers": [{key: keeper[key] for key in ("kind", "id", "path", "verifiedAt") if key in keeper}
                        for keeper in keepers],
        }
        if not keepers:
            group["reason"] = "남길 사본을 확인할 수 없습니다. 원격 설정과 인덱스를 확인하거나 파일을 다시 검사하세요."
        groups.append(group)
    return {"groups": groups}


def queue_duplicate_cleanup(db, items, *, delete_aux=False):
    from catalog import has_active_storage_shutdown
    if any(item['keeperKind'] == 'remote' for item in items) and has_active_storage_shutdown(db):
        fail(409, 'storage_shutdown_active')
    chosen = {}
    for item in items:
        file_id, kind, keeper_id = item["id"], item["keeperKind"], item["keeperId"]
        if file_id in chosen:
            fail(400, "정리 대상이 중복으로 선택되었습니다.")
        chosen[file_id] = (kind, keeper_id)
    if not chosen:
        fail(400, "정리할 중복 파일을 선택하세요.")
    files = []
    planned = _duplicate_groups(db, chosen)
    aux = _unique_aux(db, [row for _sha, rows, _keepers in planned for row in rows]) if delete_aux else {}
    for sha, targets, keepers in planned:
        choices = {chosen[row["id"]] for row in targets}
        if len(choices) != 1:
            fail(400, "같은 내용의 파일에는 남길 사본을 하나만 지정하세요.")
        kind, keeper_id = next(iter(choices))
        keeper = next((item for item in keepers if (item["kind"], item["id"]) == (kind, keeper_id)), None)
        if keeper is None:
            fail(409, "남길 사본이 변경되었습니다. 중복 목록을 다시 확인하세요.")
        if kind == "incoming" and (keeper_id in chosen or any(row["path"] == keeper["path"] for row in targets)):
            fail(409, "같은 Incoming 그룹에서 남길 사본은 정리 대상에서 제외하세요.")
        for row in targets:
            files.append({**{key: row[key] for key in ("id", "scan_id", "path", "fingerprint", "size")},
                          "sha": sha, "keeper": keeper})
            if delete_aux:
                files[-1]["auxCompanions"] = aux[row["id"]]
    try:
        payload = {"files": files}
        if delete_aux:
            payload["deleteAux"] = True
        job_id = queue_job(db, "duplicate-cleanup", payload)
    except ValueError as error:
        fail(409, str(error))
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(_result(len(files)), ensure_ascii=False), job_id))
    return {"id": job_id, "lane": LANE_LOCAL, "count": len(files)}


class _RemoteVerification:
    def __init__(self, stack):
        self.stack = stack
        self.sftp = None
        self.connection_error = None
        self.ssh_state = {"supported": True}

    def _current_config(self, keeper):
        config = archive_config()
        if (archive_revision(config) != keeper["revision"] or storage_id_for(config) != keeper["storageId"]):
            fail(409, "원격 아카이브 설정이 변경되었습니다. 남길 사본을 다시 선택하세요.")
        return config

    def _handle_transport_error(self, error):
        if isinstance(error, CONNECTION_ERRORS) or (self.sftp is not None and sftp_disconnected(self.sftp, error)):
            self.connection_error = error if isinstance(error, HTTPException) else HTTPException(
                502, "원격 아카이브 연결이 끊어졌습니다. 연결 상태를 확인하고 다시 시도하세요.")
            self.sftp = None
            raise self.connection_error from error

    def verify(self, keeper, sha):
        config = self._current_config(keeper)
        with database() as db:
            indexed = db.execute(
                """SELECT 1 FROM remote_files WHERE storage_id=? AND archive_root=? AND path=? AND sha=?
                   AND size=? AND status='present' AND verified_at IS NOT NULL""",
                (keeper["storageId"], keeper["root"], keeper["path"], sha, keeper["size"]),
            ).fetchone()
        if not indexed:
            fail(409, "원격 사본의 인덱스 기록이 변경되었습니다. 남길 사본을 다시 확인하세요.")
        if self.connection_error:
            raise self.connection_error
        if self.sftp is None:
            try:
                self.sftp, _config = self.stack.enter_context(archive_connection(config))
            except VERIFICATION_ERRORS as error:
                self.connection_error = error
                raise
        try:
            target, before = resolve_remote_file(self.sftp, keeper["root"], keeper["path"])
            if before.st_size != keeper["size"]:
                fail(409, "원격 사본의 크기가 검사 기록과 다릅니다. 원격 인덱스를 다시 확인하세요.")
            digest = remote_hash(self.sftp, target, lambda _bytes: None,
                                 file_size=before.st_size, ssh_state=self.ssh_state)
            final_path, after = resolve_remote_file(self.sftp, keeper["root"], keeper["path"])
        except HTTPException as error:
            if error.status_code == 404:
                fail(409, "원격 사본을 찾을 수 없습니다. 원격 인덱스를 다시 확인하세요.")
            self._handle_transport_error(error)
            raise
        except VERIFICATION_ERRORS as error:
            self._handle_transport_error(error)
            raise
        if (digest != sha or target != final_path or before.st_size != after.st_size or
                stat_mtime_ns(before) is None or stat_mtime_ns(before) != stat_mtime_ns(after)):
            fail(409, "원격 사본의 내용이 일치하지 않거나 확인 중 변경되었습니다. 원격 인덱스를 다시 확인하세요.")
        return {"path": final_path, "size": after.st_size, "mtime": stat_mtime_ns(after)}

    def recheck(self, keeper, snapshot):
        if self.connection_error:
            raise self.connection_error
        if self.sftp is None:
            fail(502, "원격 아카이브 연결이 끊어졌습니다. 연결 상태를 확인하고 다시 시도하세요.")
        self._current_config(keeper)
        try:
            path, info = resolve_remote_file(self.sftp, keeper["root"], keeper["path"])
        except HTTPException as error:
            if error.status_code == 404:
                fail(409, "남길 원격 사본을 찾을 수 없습니다. 원격 인덱스를 다시 확인하세요.")
            self._handle_transport_error(error)
            raise
        except VERIFICATION_ERRORS as error:
            self._handle_transport_error(error)
            raise
        if path != snapshot["path"] or info.st_size != snapshot["size"] or stat_mtime_ns(info) != snapshot["mtime"]:
            fail(409, "남길 원격 사본이 정리 직전에 변경되었습니다. 원격 인덱스를 다시 확인하세요.")


def _verify_local_keeper(incoming, managed, item):
    keeper = item["keeper"]
    with database() as db:
        if keeper["kind"] == "managed":
            root = managed
            row = db.execute("SELECT * FROM media WHERE id=? AND status='available'", (keeper["id"],)).fetchone()
            if keeper["id"] in active_offload_media_ids(db):
                row = None
        else:
            root = incoming
            row = db.execute(
                "SELECT * FROM scan_files WHERE scan_id=? AND id=? AND status IN ('ready','duplicate') AND path<>?",
                (item["scan_id"], keeper["id"], item["path"]),
            ).fetchone()
    if (row is None or row["sha"] != item["sha"] or
            any(row[key] != keeper[key] for key in ("path", "size", "fingerprint"))):
        fail(409, "남길 로컬 사본의 상태가 변경되었습니다. 파일을 다시 검사하세요.")
    try:
        digest, _info = hash_file(root, keeper["path"], keeper["fingerprint"])
        if digest != item["sha"]:
            raise OSError("내용 불일치")
    except OSError:
        fail(409, "남길 로컬 사본을 읽을 수 없거나 내용이 변경되었습니다. 파일을 다시 검사하세요.")
    return root


def _remove_duplicate(incoming, managed, item, remote):
    with database() as db:
        scan = load_latest_scan(db)
        row = db.execute("SELECT * FROM scan_files WHERE id=?", (item["id"],)).fetchone()
    if (not scan or not row or scan["id"] != item["scan_id"] or
            any(row[key] != item[key] for key in ("scan_id", "path", "sha", "fingerprint", "size")) or
            PurePosixPath(item["path"]).suffix.lower() not in SUPPORTED):
        fail(409, "정리 대상의 검사 결과가 변경되었습니다. 파일을 다시 검사하세요.")
    if row["status"] == "deleted":
        return
    if row["status"] not in {"duplicate", "deleting"}:
        fail(409, row["reason"] or "현재 중복으로 확인된 파일만 정리할 수 있습니다.")
    try:
        digest, _info = hash_file(incoming, item["path"], item["fingerprint"])
    except FileNotFoundError:
        if row["status"] == "deleting":
            return
        fail(409, "Incoming 원본을 찾을 수 없습니다. 파일을 다시 검사하세요.")
    except OSError:
        fail(409, "Incoming 원본을 읽을 수 없거나 변경되었습니다. 파일을 다시 검사하세요.")
    if digest != item["sha"]:
        fail(409, "Incoming 원본의 내용이 변경되었습니다. 파일을 다시 검사하세요.")

    keeper = item["keeper"]
    if keeper["kind"] == "remote":
        remote_snapshot = remote.verify(keeper, item["sha"])
    else:
        keeper_root = _verify_local_keeper(incoming, managed, item)
    with database(write=True) as db:
        cursor = db.execute(
            "UPDATE scan_files SET status='deleting' WHERE id=? AND status IN ('duplicate','deleting')",
            (item["id"],),
        )
        if cursor.rowcount != 1:
            fail(409, "정리 대상의 상태가 변경되었습니다. 파일을 다시 검사하세요.")
    if keeper["kind"] == "remote":
        remote.recheck(keeper, remote_snapshot)
    else:
        try:
            if fingerprint(inspect(keeper_root, keeper["path"])) != keeper["fingerprint"]:
                raise OSError("파일 변경")
        except OSError:
            fail(409, "남길 로컬 사본이 정리 직전에 변경되었습니다. 파일을 다시 검사하세요.")
    delete_verified_file(incoming, item["path"], item["fingerprint"])


def _result(count):
    return {"totalFiles": count, "completedFiles": 0, "cleaned": 0, "review": 0,
            "auxDeleted": 0, "companionReview": 0, "freedBytes": 0, "phase": "대기 중", "items": []}


def _save_progress(db, job_id, result):
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job_id))


def _companion_receipt(row, *, cleaned_paths=()):
    companions = []
    for item in json.loads(row["companions"]) if row else ():
        path = item["path"]
        kind = item.get("kind") or PurePosixPath(path).suffix.lower().lstrip(".")
        allowed = {"linked", "already-stored", "deleted", "absent"} | ({"review"} if path in cleaned_paths else set())
        if item.get("disposition") in allowed:
            disposition, reason = item["disposition"], item.get("reason", "")
        else:
            disposition, reason = "keep", "중복 정리 시 동반 파일은 보존합니다."
        companions.append({"path": path, "kind": kind, "disposition": disposition, "reason": reason,
                           "sizeBytes": item.get("size") if item.get("size") is not None else size_from_fingerprint(item.get("fingerprint"))})
    return companions


ABSENT_REASON = "Incoming에서 이미 사라진 보조 파일입니다."


def companion_error(exc):
    return getattr(exc, "strerror", None) or str(exc)


def _validate_aux_path(path):
    if any(part.startswith(".") for part in relative_parts(path)) or PurePosixPath(path).suffix.lower() not in CAMERA_AUX:
        raise ValueError("THM·LRV·AAE 보조 파일만 정리할 수 있습니다.")


def _cleanup_paired_aux(incoming, item):
    deleted = review = freed = 0
    aux_by_path = {aux["path"]: aux for aux in item["auxCompanions"]}
    with database() as db:
        row = db.execute("SELECT companions FROM scan_files WHERE id=?", (item["id"],)).fetchone()
    entries = json.loads(row["companions"])
    for entry in entries:
        aux = aux_by_path.get(entry.get("path"))
        if not aux:
            continue
        if entry.get("disposition") not in {"deleted", "absent"}:
            try:
                _validate_aux_path(aux["path"])
                if not aux.get("fingerprint"):
                    raise ValueError("파일 상태를 확인할 수 없습니다.")
                delete_verified_file(incoming, aux["path"], aux["fingerprint"])
                entry.update(disposition="deleted", reason="")
            except FileNotFoundError:
                entry.update(disposition="absent", reason=ABSENT_REASON)
            except (OSError, ValueError) as exc:
                entry.update(disposition="review", reason=companion_error(exc))
                log.warning("보조 파일을 정리할 수 없습니다: %s", aux["path"])
            with database(write=True) as db:
                db.execute("UPDATE scan_files SET companions=? WHERE id=?", (json.dumps(entries, ensure_ascii=False), item["id"]))
        if entry.get("disposition") == "deleted":
            deleted += 1
            freed += aux.get("size") or 0
        elif entry.get("disposition") == "review":
            review += 1
    return deleted, review, freed


def cleanup_duplicates(job, incoming, managed, *, refresh_group=None):
    files = json.loads(job["payload"])["files"]
    result, outcomes = _result(len(files)), []
    cleaned_hashes = set()
    stack = ExitStack()
    try:
        remote = _RemoteVerification(stack)
        for item in files:
            result["current"] = item["path"]
            result["phase"] = "원격 사본 SHA-256 확인 중" if item["keeper"]["kind"] == "remote" else "로컬 사본 확인 중"
            with database(write=True) as db:
                _save_progress(db, job["id"], result)
            outcome = {"id": item["id"], "path": item["path"], "status": "cleaned"}
            try:
                _remove_duplicate(incoming, managed, item, remote)
            except VERIFICATION_ERRORS as error:
                outcome["status"] = "review"
                outcome["reason"] = error.detail if isinstance(error, HTTPException) else (
                    "원본이나 남길 사본을 확인할 수 없습니다. 연결 상태를 확인하고 파일을 다시 검사하세요."
                )
            else:
                with database(write=True) as db:
                    db.execute("UPDATE scan_files SET status='deleted', thumbnail=NULL WHERE id=?", (item["id"],))
                cleaned_hashes.add(item["sha"])
                result["freedBytes"] += item["size"]
                if item.get("auxCompanions"):
                    deleted, review, freed = _cleanup_paired_aux(incoming, item)
                    result["auxDeleted"] += deleted
                    result["companionReview"] += review
                    result["freedBytes"] += freed
            result["completedFiles"] += 1
            result[outcome["status"]] += 1
            with database(write=True) as db:
                row = db.execute("SELECT companions FROM scan_files WHERE id=? AND scan_id=?",
                                 (item["id"], item["scan_id"])).fetchone()
                companions = _companion_receipt(row, cleaned_paths={aux["path"] for aux in item.get("auxCompanions", [])}
                                                if outcome["status"] == "cleaned" else ())
                if companions:
                    outcome["companions"] = companions
                if outcome["status"] == "cleaned":
                    db.execute("UPDATE scan_files SET status='deleted', thumbnail=NULL WHERE id=?", (item["id"],))
                else:
                    db.execute("""UPDATE scan_files SET status='review', reason=?
                                  WHERE id=? AND scan_id=? AND status IN ('duplicate','deleting')""",
                               (outcome["reason"], item["id"], item["scan_id"]))
                _save_progress(db, job["id"], result)
            outcomes.append(outcome)
    finally:
        try:
            stack.close()
        except VERIFICATION_ERRORS:
            log.warning("원격 아카이브 연결을 닫을 수 없습니다. 정리 결과를 보존합니다.", exc_info=True)
    if refresh_group:
        for sha in cleaned_hashes:
            refresh_group(managed, sha)
    result.update(phase="확인 필요 항목 있음" if result["review"] or result["companionReview"] else "완료", current="", items=outcomes)
    with database(write=True) as db:
        db.execute("""UPDATE jobs SET status='done',result=?,finished_at=?
                      WHERE id=? AND status IN ('queued','running')""",
                   (json.dumps(result, ensure_ascii=False), now(), job["id"]))


AUX_CATEGORY_ORDER = ("orphan", "duplicate-owner", "ambiguous", "review-owner", "unscanned-owner", "ready-owner", "unreadable")


def plan_aux_cleanup(db, incoming_root):
    try:
        live = list(scan_tree(incoming_root, SUPPORTED | CAMERA_AUX))
    except OSError:
        fail(503, "Incoming 폴더에 접근할 수 없습니다.")
    scan = load_latest_scan(db)
    rows = {row["path"]: row for row in db.execute("SELECT path,status FROM scan_files WHERE scan_id=?", (scan["id"],))} if scan else {}
    processed = source_index([path for path, row in rows.items() if row["status"] in {"moved", "deleted"}])
    archived = source_index([row["original_path"] for row in db.execute(
        "SELECT original_path FROM media WHERE status IN ('available','archived') AND original_path IS NOT NULL")])
    live_index = source_index([path for path, _info in live if PurePosixPath(path).suffix.lower() in SUPPORTED])
    items = []
    for path, info in live:
        if PurePosixPath(path).suffix.lower() not in CAMERA_AUX:
            continue
        candidates = source_candidates(path, live_index)
        owner = aux_owner(path, candidates)
        owner_status = rows[owner]["status"] if owner in rows else None
        hint = None
        if info is None:
            category, reason = "unreadable", "파일 상태를 읽을 수 없습니다."
        elif not candidates:
            category = "orphan"
            processed_matches = source_candidates(path, processed)
            archived_matches = source_candidates(path, archived)
            if processed_matches:
                hint = "owner-processed"
                reason = f"원본({', '.join(processed_matches)})이 이미 이동·정리된 뒤 남아 있는 보조 파일입니다."
            elif archived_matches:
                hint = "owner-archived"
                reason = f"원본({', '.join(archived_matches)})이 보관함에 등록된 기록이 있는 보조 파일입니다."
            else:
                hint = "unverified-orphan"
                reason = "원본 보관 여부를 확인할 수 없는 고아 보조 파일입니다."
        elif owner is None:
            category, reason = "ambiguous", "원본 후보가 여러 개입니다."
        else:
            category = {"duplicate": "duplicate-owner", "ready": "ready-owner", "review": "review-owner"}.get(owner_status, "unscanned-owner")
            reason = "원본 이동 시 자동 정리 예정" if category == "ready-owner" else "연결된 Incoming 원본을 확인하세요."
        name = PurePosixPath(path)
        items.append({"path": path, "name": name.name, "folder": "" if str(name.parent) == "." else str(name.parent),
                      "kind": name.suffix.lower().lstrip("."), "sizeBytes": info.st_size if info else None,
                      "modifiedAt": iso_time(info.st_mtime) if info else None, "fingerprint": fingerprint(info) if info else None,
                      "category": category, "orphanHint": hint, "ownerPath": owner, "ownerStatus": owner_status,
                      "candidatePaths": candidates, "reason": reason, "selectable": info is not None,
                      "defaultSelected": category in {"orphan", "duplicate-owner"}})
    items.sort(key=lambda item: (AUX_CATEGORY_ORDER.index(item["category"]), item["path"]))
    by_category = {key: {"count": 0, "bytes": 0} for key in AUX_CATEGORY_ORDER}
    for item in items:
        bucket = by_category[item["category"]]
        bucket["count"] += 1
        bucket["bytes"] += item["sizeBytes"] or 0
    return {"scanId": scan["id"] if scan else None, "scannedAt": now(), "items": items,
            "summary": {"totalCount": len(items), "totalBytes": sum(item["sizeBytes"] or 0 for item in items),
                        "defaultSelectedCount": sum(item["defaultSelected"] for item in items),
                        "defaultSelectedBytes": sum(item["sizeBytes"] or 0 for item in items if item["defaultSelected"]),
                        "byCategory": by_category}}


def _aux_result(count):
    return {"totalFiles": count, "completedFiles": 0, "deleted": 0, "absent": 0, "review": 0,
            "freedBytes": 0, "phase": "대기 중", "current": "", "items": []}


def queue_aux_cleanup(db, incoming_root, items):
    verified, seen = [], set()
    for item in items:
        path, snapshot = item["path"], item["fingerprint"]
        if path in seen:
            fail(400, "정리 대상이 중복으로 선택되었습니다.")
        seen.add(path)
        try:
            _validate_aux_path(path)
            if size_from_fingerprint(snapshot) is None:
                raise ValueError("잘못된 파일 상태입니다.")
        except ValueError as exc:
            fail(400, str(exc))
        try:
            info = inspect(incoming_root, path)
            if fingerprint(info) != snapshot:
                raise ValueError("파일 변경")
        except (OSError, ValueError):
            fail(409, "보조 파일 상태가 변경되었습니다. 목록을 다시 확인하세요.")
        verified.append({"path": path, "fingerprint": snapshot, "size": info.st_size,
                         "kind": PurePosixPath(path).suffix.lower().lstrip(".")})
    if not verified:
        fail(400, "정리할 보조 파일을 선택하세요.")
    scan = load_latest_scan(db)
    try:
        job_id = queue_job(db, "aux-cleanup", {"scan_id": scan["id"] if scan else None, "files": verified})
    except ValueError as exc:
        fail(409, str(exc))
    _save_progress(db, job_id, _aux_result(len(verified)))
    return {"id": job_id, "lane": LANE_LOCAL, "count": len(verified)}


def _sync_removed_aux(db, outcomes):
    removed = {item["path"]: item["status"] for item in outcomes if item["status"] in {"deleted", "absent"}}
    scan = load_latest_scan(db)
    if not scan or not removed:
        return
    for row in db.execute("SELECT id,companions FROM scan_files WHERE scan_id=?", (scan["id"],)).fetchall():
        entries = json.loads(row["companions"] or "[]")
        for entry in entries:
            status = removed.get(entry.get("path"))
            if status:
                entry.update(disposition=status, reason="" if status == "deleted" else ABSENT_REASON)
        db.execute("UPDATE scan_files SET companions=? WHERE id=?", (json.dumps(entries, ensure_ascii=False), row["id"]))
    scan_result = json.loads(scan["result"] or "{}")
    scan_result["unmatchedCompanions"] = [entry for entry in scan_result.get("unmatchedCompanions", []) if entry.get("path") not in removed]
    _save_progress(db, scan["id"], scan_result)


def cleanup_aux_companions(job, incoming, managed):
    files = json.loads(job["payload"])["files"]
    prior = {item["path"]: item for item in json.loads(job["result"] or "{}").get("items", [])
             if item.get("status") in {"deleted", "absent"}}
    result = _aux_result(len(files))
    for item in files:
        outcome = prior.get(item["path"])
        if outcome is None:
            outcome = {"path": item["path"], "kind": item.get("kind"), "status": "deleted", "sizeBytes": item["size"]}
            try:
                _validate_aux_path(item["path"])
                if size_from_fingerprint(item.get("fingerprint")) is None:
                    raise ValueError("파일 상태를 확인할 수 없습니다.")
                delete_verified_file(incoming, item["path"], item["fingerprint"])
            except FileNotFoundError:
                outcome.update(status="absent", reason=ABSENT_REASON)
            except (OSError, ValueError) as exc:
                outcome.update(status="review", reason=companion_error(exc))
        result[outcome["status"]] += 1
        if outcome["status"] == "deleted":
            result["freedBytes"] += item["size"]
        result["items"].append(outcome)
        result.update(completedFiles=result["completedFiles"] + 1, current=item["path"], phase="보조 파일 정리 중")
        with database(write=True) as db:
            _save_progress(db, job["id"], result)
    result.update(current="", phase="확인 필요 항목 있음" if result["review"] else "완료")
    with database(write=True) as db:
        _sync_removed_aux(db, result["items"])
        db.execute("UPDATE jobs SET status='done',result=?,finished_at=? WHERE id=? AND status IN ('queued','running')",
                   (json.dumps(result, ensure_ascii=False), now(), job["id"]))
