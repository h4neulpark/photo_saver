"""Durable, non-overwriting SFTP uploads of confirmed catalog placements."""
import errno
import hashlib
import json
import os
import re
import shlex
import socket
import stat
import time
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4

import paramiko
from fastapi import HTTPException
from pydantic import BaseModel, Field

from archive import CONNECTION_ERRORS, sftp_disconnected, archive_config, archive_connection, archive_revision as config_identity, relative_path, storage_id_for
from catalog import LANE_REMOTE, active_duplicate_keeper_ids, database, now, queue_job, upsert_remote_file
import offload
from media import fingerprint, inspect, regular_file
from settings import fail

from devices import device_names, effective_device

CHUNK = 1024 * 1024
HEX_SHA = re.compile(r"^\\?([0-9a-fA-F]{64}) [ *]")
REMOTE_HASH_SCRIPT = (
    'if command -v sha256sum >/dev/null 2>&1; then exec sha256sum -- "$1"; '
    'elif command -v shasum >/dev/null 2>&1; then exec shasum -a 256 -- "$1"; '
    'else exit 127; fi'
)


class RemoteDuplicateError(HTTPException):
    def __init__(self, detail, duplicates, duplicate_ids, new_count):
        super().__init__(status_code=409, detail=detail)
        self.duplicates = duplicates
        self.duplicate_ids = duplicate_ids
        self.new_count = new_count


class MissingXmpOffloadError(HTTPException):
    def __init__(self, missing_xmp_media_ids):
        super().__init__(status_code=409, detail="연결된 XMP를 함께 업로드한 뒤 로컬 원본을 비울 수 있습니다.")
        self.missing_xmp_media_ids = missing_xmp_media_ids


def stat_mtime_ns(info):
    if info is None:
        return None
    if getattr(info, "st_mtime_ns", None) is not None:
        return int(info.st_mtime_ns)
    if getattr(info, "st_mtime", None) is not None:
        return int(info.st_mtime * 1_000_000_000)
    return None


class TransferItem(BaseModel):
    id: str
    kind: Literal["media", "xmp"] = "media"


class TransferRequest(BaseModel):
    connection: str = Field(min_length=64, max_length=64)
    items: list[TransferItem] = Field(min_length=1, max_length=10000)
    source: list[str] = Field(default_factory=list, max_length=3)
    destination: str = ""
    allow_duplicates: bool = False
    offload_after_upload: bool = False


def components(parts):
    if any(not part or part in {".", ".."} or "/" in part or "\0" in part for part in parts):
        fail(400, "유효한 파일·폴더 경로를 선택하세요.")
    return parts


def existing_remote_paths(db, sha, storage_id, archive_root):
    rows = db.execute(
        """SELECT path FROM remote_files
           WHERE sha=? AND status='present' AND archive_root=?
           ORDER BY (storage_id=?) DESC, coalesce(verified_at, last_seen_at) DESC, path""",
        (sha, archive_root, storage_id),
    ).fetchall()
    return list(dict.fromkeys(row["path"] for row in rows))


def queue_transfer(db, request, device_folder):
    prefix = components(request.source)
    destination = relative_path(request.destination)
    config = archive_config()
    if request.connection != config_identity(config):
        fail(409, "Destination의 연결 설정이 변경되었습니다. 아카이브에 다시 연결하고 업로드하세요.")
    storage_id = storage_id_for(config)
    events = {row["id"]: row for row in db.execute("SELECT * FROM events")}
    names = device_names(db)
    seen, targets, files, duplicates = set(), set(), [], []
    for selection in request.items:
        key = (selection.id, selection.kind)
        if key in seen:
            continue
        seen.add(key)
        row = db.execute("SELECT * FROM media WHERE id=?", (selection.id,)).fetchone()
        if not row or row["status"] != "available" or not row["confirmed"] or row["event_id"] not in events:
            fail(409, "확정된 파일만 업로드할 수 있습니다. 파일 목록을 새로 고침하세요.")
        event = events[row["event_id"]]
        folders = ([events[event["parent_id"]]["folder"]] if event["parent_id"] else []) + [event["folder"], device_folder(effective_device(row, names))]
        local = row["xmp_path"] if selection.kind == "xmp" else row["path"]
        sha = row["xmp_sha"] if selection.kind == "xmp" else row["sha"]
        if not local or not sha:
            fail(409, "파일 또는 XMP 정보가 변경되었습니다. 다시 검사하세요.")
        logical = components([*folders, PurePosixPath(local).name])
        if logical[:len(prefix)] != prefix:
            fail(409, "선택한 파일이 현재 Source 폴더에 속하지 않습니다. 다시 선택하세요.")
        target = str(destination.joinpath(*logical[len(prefix):]))
        if target in targets:
            fail(409, "같은 목적지 경로를 사용하는 파일이 있습니다. 이벤트·장비 분류를 확인하세요.")
        targets.add(target)
        if selection.kind == "media" and not request.allow_duplicates:
            remote_paths = existing_remote_paths(db, sha, storage_id, config["root"])
            if remote_paths and target not in remote_paths:
                duplicates.append({
                    "id": row["id"], "kind": selection.kind, "name": row["name"],
                    "target": target, "existingPaths": remote_paths[:5],
                })
        files.append({"id": row["id"], "kind": selection.kind, "local": local, "target": target, "sha": sha,
                      "fingerprint": row["fingerprint"] if selection.kind == "media" else None,
                      "size": row["size"] if selection.kind == "media" else None})
    offload_media_ids = []
    if request.offload_after_upload:
        offload_media_ids = list(dict.fromkeys(item["id"] for item in files if item["kind"] == "media"))
        if not offload_media_ids:
            fail(400, "로컬 비우기는 사진·영상 원본이 포함된 업로드에서만 사용할 수 있습니다.")
        missing_xmp_ids = []
        for media_id in offload_media_ids:
            row = db.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
            if row["xmp_path"]:
                if not row["xmp_sha"]:
                    fail(409, "연결된 XMP의 해시 정보를 확인할 수 없습니다. 먼저 새로 고침하세요.")
                if (media_id, "xmp") not in seen and offload.find_remote_copy(db, row["xmp_sha"], storage_id, config["root"]) is None:
                    missing_xmp_ids.append(media_id)
        if missing_xmp_ids:
            raise MissingXmpOffloadError(missing_xmp_ids)
        if active_duplicate_keeper_ids(db).intersection(offload_media_ids):
            fail(409, "Incoming 중복 정리에서 보존할 로컬 원본입니다. 정리 완료 후 다시 시도하세요.")
    if duplicates:
        duplicate_ids = {item["id"] for item in duplicates}
        new_count = sum(1 for item in files if item["id"] not in duplicate_ids)
        raise RemoteDuplicateError(
            f"원격 아카이브의 다른 경로에 이미 동일한 파일 {len(duplicates)}개가 보관되어 있습니다.",
            duplicates[:100],
            sorted(duplicate_ids),
            new_count,
        )
    payload = {"config": config_identity(config), "files": files, "token": uuid4().hex,
               "offloadAfterUpload": bool(request.offload_after_upload), "offloadMediaIds": offload_media_ids}
    try:
        job_id = queue_job(db, "upload", payload)
    except ValueError as exc:
        fail(409, str(exc))
    result = {"totalFiles": len(files), "completedFiles": 0, "uploaded": 0, "skipped": 0, "failed": 0,
              "totalBytes": sum(item["size"] or 0 for item in files), "transferredBytes": 0, "errors": []}
    if request.offload_after_upload:
        result["offload"] = new_upload_offload_result(offload_media_ids)
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result), job_id))
    return {"id": job_id, "lane": LANE_REMOTE, "count": len(files)}


class UploadCancelled(Exception):
    pass


def remote_stat(sftp, path):
    try:
        return sftp.lstat(str(path))
    except OSError as error:
        if error.errno == errno.ENOENT:
            return None
        raise


def remote_directory(sftp, base, relative):
    current = base
    for part in relative.parts:
        current = current / part
        info = remote_stat(sftp, current)
        if info is None:
            try:
                sftp.mkdir(str(current))
            except OSError:
                if remote_stat(sftp, current) is None:
                    raise
            info = sftp.lstat(str(current))
        if not stat.S_ISDIR(info.st_mode):
            fail(409, "목적지 경로에 폴더가 아닌 파일 또는 심볼릭 링크가 있습니다.")
    return current


def ssh_remote_hash(sftp, path, tick, *, file_size=None, ssh_state=None):
    if ssh_state is not None and not ssh_state.get("supported", True):
        return None
    if not hasattr(sftp, "get_channel"):
        return None
    sftp_channel = sftp.get_channel()
    transport = sftp_channel.get_transport() if sftp_channel is not None and hasattr(sftp_channel, "get_transport") else None
    if transport is None or not transport.is_active():
        return None
    channel = None
    try:
        channel = transport.open_session(timeout=5)
        channel.settimeout(0.5)
        command = f"sh -c {shlex.quote(REMOTE_HASH_SCRIPT)} photo-saver {shlex.quote(str(path))}"
        channel.exec_command(command)
        output = bytearray()
        deadline = time.monotonic() + max(60, int((file_size or 0) / (2 * 1024 * 1024)) + 60)
        while True:
            tick()
            if time.monotonic() > deadline:
                return None
            try:
                chunk = channel.recv(4096)
            except (socket.timeout, TimeoutError):
                if not transport.is_active():
                    raise paramiko.SSHException("원격 연결이 끊어졌습니다.")
                continue
            if not chunk:
                break
            if len(output) < 4096:
                output.extend(chunk)
        exit_status = channel.recv_exit_status()
        if exit_status == 0:
            line = output.decode("utf-8", errors="replace").splitlines()
            matched = HEX_SHA.match(line[0]) if line else None
            if matched:
                return matched.group(1).lower()
        elif exit_status in {126, 127} and ssh_state is not None:
            ssh_state["supported"] = False
        return None
    except UploadCancelled:
        raise
    except paramiko.ChannelException:
        if ssh_state is not None:
            ssh_state["supported"] = False
        return None
    except (paramiko.SSHException, OSError):
        if not transport.is_active():
            raise
        if ssh_state is not None:
            ssh_state["supported"] = False
        return None
    finally:
        if channel is not None:
            try:
                channel.close()
            except OSError:
                pass


def sftp_remote_hash(sftp, path, tick, file_size=None):
    digest = hashlib.sha256()
    read_bytes = 0
    with sftp.open(str(path), "rb") as stream:
        if hasattr(stream, "prefetch") and file_size:
            stream.prefetch(file_size)
        while block := stream.read(CHUNK):
            digest.update(block)
            read_bytes += len(block)
            tick(read_bytes)
    return digest.hexdigest()


def remote_hash(sftp, path, tick, *, file_size=None, ssh_state=None, ssh_tick=None):
    remote_digest = ssh_remote_hash(
        sftp, path, ssh_tick or (lambda: tick(0)), file_size=file_size, ssh_state=ssh_state,
    )
    if remote_digest is not None:
        return remote_digest
    return sftp_remote_hash(sftp, path, tick, file_size=file_size)


def remote_record_matches(storage_id, archive_root, path, sha, size, mtime_ns):
    if not storage_id or not archive_root or mtime_ns is None:
        return False
    with database() as db:
        row = db.execute(
            """SELECT sha, size, mtime_ns, archive_root, status FROM remote_files
               WHERE storage_id=? AND path=?""",
            (storage_id, path),
        ).fetchone()
    return bool(
        row and row["status"] == "present" and row["archive_root"] == archive_root
        and row["sha"] == sha and row["size"] == size and row["mtime_ns"] == mtime_ns
    )


def percent_label(label, current, total):
    if not total:
        return label
    return f"{label} ({min(100, round(current * 100 / total))}%)"


def send_file(sftp, base, managed, item, temporary_name, progress, *, storage_id=None, archive_root=None, ssh_state=None):
    target_relative = relative_path(item["target"])
    parent = remote_directory(sftp, base, target_relative.parent)
    target = parent / target_relative.name
    expected = item["fingerprint"] or fingerprint(inspect(managed, item["local"]))
    # Open and retain the verified local descriptor throughout the operation.
    with regular_file(managed, item["local"], expected=expected) as (source, local_info):
        existing = remote_stat(sftp, target)
        if existing is not None:
            if not stat.S_ISREG(existing.st_mode) or existing.st_size != local_info.st_size:
                fail(409, "같은 이름의 다른 파일이 있어 덮어쓰지 않았습니다.")
            existing_mtime = stat_mtime_ns(existing)
            if not remote_record_matches(storage_id, archive_root, item["target"], item["sha"], local_info.st_size, existing_mtime):
                progress(0, "비교 중")
                digest = remote_hash(
                    sftp, target,
                    lambda read_bytes: progress(read_bytes, percent_label("비교 중", read_bytes, local_info.st_size)),
                    file_size=existing.st_size, ssh_state=ssh_state,
                    ssh_tick=lambda: progress(0, "원격 비교 중"),
                )
                if digest != item["sha"]:
                    fail(409, "같은 이름의 다른 파일이 있어 덮어쓰지 않았습니다.")
                after_existing = remote_stat(sftp, target)
                if (after_existing is None or not stat.S_ISREG(after_existing.st_mode)
                        or after_existing.st_size != local_info.st_size or stat_mtime_ns(after_existing) != existing_mtime):
                    fail(409, "비교 중 원격 파일이 변경되었습니다. 다시 시도하세요.")
            # Ensure the local source still matches its catalog hash too.
            if hashlib.file_digest(source, "sha256").hexdigest() != item["sha"]:
                fail(409, "원본이 검사 이후 변경되었습니다. 다시 검사하세요.")
            return "skipped", local_info.st_size, existing_mtime
        temporary = parent / temporary_name
        stale = remote_stat(sftp, temporary)
        if stale is not None:
            if not stat.S_ISREG(stale.st_mode):
                fail(409, "이전 전송 임시 경로를 사용할 수 없습니다.")
            sftp.remove(str(temporary))
        try:
            digest = hashlib.sha256()
            sent = 0
            with sftp.open(str(temporary), "wx") as output:
                output.set_pipelined(True)
                while block := source.read(CHUNK):
                    output.write(block)
                    digest.update(block)
                    sent += len(block)
                    progress(sent, "업로드 중")
            if digest.hexdigest() != item["sha"] or sent != local_info.st_size:
                fail(409, "원본이 검사 이후 변경되었습니다. 다시 검사하세요.")
            # Verify the open descriptor before exposing a final remote filename.
            if fingerprint(os.fstat(source.fileno())) != expected:
                fail(409, "전송 중 원본이 변경되었습니다. 다시 검사하세요.")
            progress(sent, "검증 중")
            verified_digest = remote_hash(
                sftp, temporary,
                lambda read_bytes: progress(sent, percent_label("검증 중", read_bytes, sent)),
                file_size=sent, ssh_state=ssh_state,
                ssh_tick=lambda: progress(sent, "원격 검증 중"),
            )
            if verified_digest != item["sha"]:
                fail(502, "업로드한 파일의 SHA-256 검증에 실패했습니다.")
            # Standard SFTP rename fails if the destination appeared in the meantime.
            sftp.rename(str(temporary), str(target))
            return "uploaded", sent, stat_mtime_ns(remote_stat(sftp, target))
        finally:
            try:
                sftp.remove(str(temporary))
            except OSError:
                pass


def record_archive(job_id, index, item, config, outcome, size=None, error=None, mtime_ns=None):
    stamp = now()
    storage_id = storage_id_for(config)
    final_size = size if size is not None else item["size"]
    verified_at = stamp if outcome in {"uploaded", "skipped"} else None
    with database(write=True) as db:
        db.execute(
            """INSERT INTO archive_entries
               (job_id,item_index,media_id,asset_kind,local_path,sha,size,storage_id,archive_root,target,outcome,verified_at,recorded_at,error)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(job_id,item_index) DO UPDATE SET
               size=excluded.size,outcome=excluded.outcome,verified_at=excluded.verified_at,
               recorded_at=excluded.recorded_at,error=excluded.error""",
            (job_id, index, item["id"], item["kind"], item["local"], item["sha"], final_size,
             storage_id, config["root"], item["target"], outcome, verified_at, stamp, error),
        )
        if outcome in {"uploaded", "skipped"}:
            upsert_remote_file(
                db, storage_id, item["target"], config["root"], item["sha"], final_size,
                mtime_ns=mtime_ns, status="present", verified_at=verified_at,
            )


def new_upload_offload_result(ids):
    return {"enabled": True, "totalFiles": len(ids), "completedFiles": 0, "offloaded": 0,
            "skipped": 0, "failed": 0, "freedBytes": 0, "errors": [], "phase": "대기 중"}


def upload_selection(job, _incoming, managed):
    payload = json.loads(job["payload"])
    offload_after = bool(payload.get("offloadAfterUpload"))
    offload_media_ids = list(payload.get("offloadMediaIds") or [])
    asset_outcomes = {}
    media_assets = {}
    for item in payload["files"]:
        media_assets.setdefault(item["id"], []).append(item)
    in_offload_phase = False
    result = {"totalFiles": len(payload["files"]), "completedFiles": 0, "uploaded": 0, "skipped": 0, "failed": 0,
              "totalBytes": 0, "transferredBytes": 0, "errors": [], "current": "", "phase": "연결 중"}
    if offload_after:
        result["offload"] = new_upload_offload_result(offload_media_ids)
    for index, item in enumerate(payload["files"]):
        size = item["size"]
        if size is None:
            try:
                size = inspect(managed, item["local"]).st_size
            except OSError:
                size = 0
                if offload_after:
                    with database() as db:
                        saved_asset = db.execute("SELECT size FROM archive_entries WHERE job_id=? AND item_index=? AND outcome IN ('uploaded','skipped')", (job["id"], index)).fetchone()
                    if saved_asset:
                        size = saved_asset["size"] or 0
        result["totalBytes"] += size
    last_update = 0
    completed_bytes = 0

    def save(force=False):
        nonlocal last_update
        if not force and time.monotonic() - last_update < 0.3:
            return
        with database(write=True) as db:
            saved = db.execute("SELECT result FROM jobs WHERE id=?", (job["id"],)).fetchone()
            if saved and json.loads(saved["result"] or "{}").get("cancelRequested"):
                raise UploadCancelled()
            db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job["id"]))
        last_update = time.monotonic()

    def progress(sent, phase):
        result["transferredBytes"] = completed_bytes + sent
        result["phase"] = phase
        save()

    def check_upload_cancel():
        with database() as db:
            row = db.execute("SELECT result FROM jobs WHERE id=?", (job["id"],)).fetchone()
        if row and json.loads(row["result"] or "{}").get("cancelRequested"):
            raise UploadCancelled()

    status = "done"
    try:
        # Cancellation can survive a worker crash inside the atomic deletion
        # boundary. Settle that boundary before stopping, without starting any
        # new file deletion or re-uploading a removed source.
        try:
            check_upload_cancel()
        except UploadCancelled:
            recovery = []
            if offload_after:
                with database(write=True) as db:
                    for media_id in offload_media_ids:
                        row = db.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
                        if row and row["status"] == "archived":
                            in_offload_phase = True
                            result["offload"]["offloaded"] += 1
                            result["offload"]["completedFiles"] += 1
                        if not row or row["status"] != "offloading":
                            continue
                        in_offload_phase = True
                        paths = [row["path"]] + ([row["xmp_path"]] if row["xmp_path"] else [])
                        if all((managed / path).is_file() for path in paths):
                            db.execute("UPDATE media SET status='available' WHERE id=? AND status='offloading'", (media_id,))
                        else:
                            recovery.append(media_id)
                if recovery:
                    config = archive_config()
                    if config_identity(config) != payload["config"]:
                        fail(409, "전송 예약 후 SSH 설정이 변경되었습니다. 다시 업로드하세요.")
                    with archive_connection(config) as (sftp, config):
                        for media_id in recovery:
                            with database() as db:
                                item = offload.build_offload_item(db, media_id, storage_id_for(config), config["root"], allow_offloading=True)
                            result["offload"]["freedBytes"] += offload.offload_file(sftp, config, managed, item)
                            result["offload"]["offloaded"] += 1
                            result["offload"]["completedFiles"] += 1
            raise
        save(True)
        config = archive_config()
        if config_identity(config) != payload["config"]:
            fail(409, "전송 예약 후 SSH 설정이 변경되었습니다. 다시 업로드하세요.")
        with archive_connection(config) as (sftp, config):
            base = PurePosixPath(sftp.normalize(config["root"]))
            storage_id = storage_id_for(config)
            ssh_state = {"supported": True}
            for index, item in enumerate(payload["files"]):
                result["current"] = item["target"]
                save(True)
                try:
                    restored = None
                    if offload_after:
                        with database() as db:
                            restored = db.execute("""SELECT a.outcome,a.size FROM archive_entries a JOIN media m ON m.id=a.media_id
                                WHERE a.job_id=? AND a.item_index=? AND a.outcome IN ('uploaded','skipped')
                                AND m.status IN ('offloading','archived')""", (job["id"], index)).fetchone()
                    if restored:
                        outcome, size = restored["outcome"], restored["size"] or 0
                    else:
                        outcome, size, mtime_ns = send_file(
                            sftp, base, managed, item, f".photo-saver-{payload['token']}-{index}.part", progress,
                            storage_id=storage_id, archive_root=config["root"], ssh_state=ssh_state,
                        )
                        record_archive(job["id"], index, item, config, outcome, size, mtime_ns=mtime_ns)
                    asset_outcomes[(item["id"], item["kind"])] = outcome
                    result[outcome] += 1
                    completed_bytes += size
                except UploadCancelled:
                    raise
                except (OSError, ValueError, HTTPException) as error:
                    if sftp_disconnected(sftp, error):
                        raise
                    result["failed"] += 1
                    asset_outcomes[(item["id"], item["kind"])] = "failed"
                    message = error.detail if isinstance(error, HTTPException) else "파일을 읽거나 업로드하지 못했습니다. 연결 및 파일 권한을 확인하세요."
                    record_archive(job["id"], index, item, config, "failed", error=message)
                    if len(result["errors"]) < 100:
                        result["errors"].append({"path": item["target"], "message": message})
                result["completedFiles"] += 1
                result["transferredBytes"] = completed_bytes
                save(True)
            if offload_after:
                in_offload_phase = True
                follow = result["offload"]
                follow["phase"] = "로컬 원본 비우기 중"
                result["phase"] = follow["phase"]
                for media_id in offload_media_ids:
                    save(True)
                    assets = media_assets.get(media_id, [])
                    if any(asset_outcomes.get((item["id"], item["kind"])) not in {"uploaded", "skipped"} for item in assets):
                        follow["skipped"] += 1
                        follow["completedFiles"] += 1
                        continue
                    try:
                        with database() as db:
                            row = db.execute("SELECT * FROM media WHERE id=?", (media_id,)).fetchone()
                            if row and row["status"] == "archived":
                                follow["offloaded"] += 1
                                follow["completedFiles"] += 1
                                continue
                            if media_id in active_duplicate_keeper_ids(db):
                                follow["skipped"] += 1
                                follow["completedFiles"] += 1
                                if len(follow["errors"]) < 100:
                                    follow["errors"].append({"path": row["path"] if row else media_id, "message": "Incoming 중복 정리에서 보존할 로컬 원본입니다. 정리 완료 후 다시 시도하세요."})
                                continue
                            offload_item = offload.build_offload_item(db, media_id, storage_id, config["root"], allow_offloading=True)
                        result["current"] = offload_item["name"]
                        freed = offload.offload_file(sftp, config, managed, offload_item, cancel_check=check_upload_cancel)
                        follow["offloaded"] += 1
                        follow["freedBytes"] += freed
                    except UploadCancelled:
                        raise
                    except (OSError, ValueError, HTTPException) as error:
                        if sftp_disconnected(sftp, error):
                            raise
                        follow["failed"] += 1
                        if len(follow["errors"]) < 100:
                            follow["errors"].append({"path": row["path"] if row else media_id, "message": error.detail if isinstance(error, HTTPException) else "로컬 원본을 비우지 못했습니다."})
                    follow["completedFiles"] += 1
                    save(True)
                follow["phase"] = "실패" if follow["failed"] else "완료"
        if result["failed"]:
            status = "failed"
            result["error"] = f"{result['failed']}개 파일을 업로드하지 못했습니다. 실패 목록을 확인하고 다시 업로드하세요."
        if offload_after and result["offload"]["failed"]:
            status = "failed"
            result["error"] = (f"업로드 {result['failed']}개 실패, " if result["failed"] else "업로드 검증은 완료했으나 ") + f"로컬 비우기 {result['offload']['failed']}개 실패했습니다. 실패 목록을 확인하세요."
    except UploadCancelled:
        status = "cancelled"
        result["error"] = "업로드를 중지했습니다. 완료된 파일은 아카이브에 유지됩니다."
        result["cancelRequested"] = True
        if offload_after:
            result["offload"]["phase"] = "중지됨" if in_offload_phase else "건너뜀"
            result["error"] = f"로컬 원본 비우기를 중지했습니다. 이미 비운 {result['offload']['offloaded']}개 외 나머지 로컬 원본은 유지됩니다." if in_offload_phase else "업로드를 중지했습니다. 완료된 파일은 아카이브에 유지되며 로컬 원본은 비우지 않았습니다."
    except Exception as error:
        status = "failed"
        result["error"] = error.detail if isinstance(error, HTTPException) else "아카이브 전송에 실패했습니다. 연결 상태를 확인하고 다시 업로드하세요."
        if offload_after:
            follow = result["offload"]
            follow["phase"] = "실패" if in_offload_phase else "건너뜀"
            if in_offload_phase:
                follow["failed"] += follow["totalFiles"] - follow["completedFiles"]
                follow["completedFiles"] = follow["totalFiles"]
                result["error"] = "로컬 원본 비우기 중 연결 또는 검증에 실패했습니다. 남은 원본은 유지됩니다."
        pending = payload["files"][result["completedFiles"]:]
        result["failed"] += len(pending)
        result["completedFiles"] = result["totalFiles"]
        for item in pending[:max(0, 100 - len(result["errors"]))]:
            result["errors"].append({"path": item["target"], "message": result["error"]})
    result["phase"] = "완료" if status == "done" else "중지됨" if status == "cancelled" else "실패"
    result["current"] = ""
    with database(write=True) as db:
        db.execute("UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?", (status, json.dumps(result, ensure_ascii=False), now(), job["id"]))
