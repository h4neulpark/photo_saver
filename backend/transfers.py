"""Durable, non-overwriting SFTP uploads of confirmed catalog placements."""
import errno
import hashlib
import json
import os
import stat
import time
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field

from archive import archive_config, archive_connection, archive_revision as config_identity, relative_path
from catalog import database, now, queue_job
from media import fingerprint, inspect, regular_file
from settings import fail

CHUNK = 1024 * 1024


class TransferItem(BaseModel):
    id: str
    kind: Literal["media", "xmp"] = "media"


class TransferRequest(BaseModel):
    connection: str = Field(min_length=64, max_length=64)
    items: list[TransferItem] = Field(min_length=1, max_length=10000)
    source: list[str] = Field(default_factory=list, max_length=3)
    destination: str = ""


def components(parts):
    if any(not part or part in {".", ".."} or "/" in part or "\0" in part for part in parts):
        fail(400, "유효한 파일·폴더 경로를 선택하세요.")
    return parts


def queue_transfer(db, request, device_folder):
    prefix = components(request.source)
    destination = relative_path(request.destination)
    config = archive_config()
    if request.connection != config_identity(config):
        fail(409, "Destination의 연결 설정이 변경되었습니다. 아카이브에 다시 연결하고 업로드하세요.")
    events = {row["id"]: row for row in db.execute("SELECT * FROM events")}
    seen, targets, files = set(), set(), []
    for selection in request.items:
        key = (selection.id, selection.kind)
        if key in seen:
            continue
        seen.add(key)
        row = db.execute("SELECT * FROM media WHERE id=?", (selection.id,)).fetchone()
        if not row or row["status"] != "available" or not row["confirmed"] or row["event_id"] not in events:
            fail(409, "확정된 파일만 업로드할 수 있습니다. 파일 목록을 새로 고침하세요.")
        event = events[row["event_id"]]
        folders = ([events[event["parent_id"]]["folder"]] if event["parent_id"] else []) + [event["folder"], device_folder(row["user_device"] or row["device"])]
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
        files.append({"id": row["id"], "kind": selection.kind, "local": local, "target": target, "sha": sha,
                      "fingerprint": row["fingerprint"] if selection.kind == "media" else None,
                      "size": row["size"] if selection.kind == "media" else None})
    payload = {"config": config_identity(config), "files": files, "token": uuid4().hex}
    try:
        job_id = queue_job(db, "upload", payload)
    except ValueError:
        fail(409, "진행 중인 파일 작업이 끝난 뒤 업로드하세요.")
    result = {"totalFiles": len(files), "completedFiles": 0, "uploaded": 0, "skipped": 0, "failed": 0,
              "totalBytes": sum(item["size"] or 0 for item in files), "transferredBytes": 0, "errors": []}
    db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result), job_id))
    return {"id": job_id, "count": len(files)}


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


def remote_hash(sftp, path, tick):
    digest = hashlib.sha256()
    with sftp.open(str(path), "rb") as stream:
        while block := stream.read(CHUNK):
            digest.update(block)
            tick()
    return digest.hexdigest()


def send_file(sftp, base, managed, item, temporary_name, progress):
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
            progress(0, "비교 중")
            if remote_hash(sftp, target, lambda: progress(0, "비교 중")) != item["sha"]:
                fail(409, "같은 이름의 다른 파일이 있어 덮어쓰지 않았습니다.")
            # Ensure the local source still matches its catalog hash too.
            if hashlib.file_digest(source, "sha256").hexdigest() != item["sha"]:
                fail(409, "원본이 검사 이후 변경되었습니다. 다시 검사하세요.")
            return "skipped", local_info.st_size
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
            if remote_hash(sftp, temporary, lambda: progress(sent, "검증 중")) != item["sha"]:
                fail(502, "업로드한 파일의 SHA-256 검증에 실패했습니다.")
            # Standard SFTP rename fails if the destination appeared in the meantime.
            sftp.rename(str(temporary), str(target))
            return "uploaded", sent
        finally:
            try:
                sftp.remove(str(temporary))
            except OSError:
                pass


def record_archive(job_id, index, item, config, outcome, size=None, error=None):
    stamp = now()
    with database(write=True) as db:
        db.execute(
            """INSERT INTO archive_entries
               (job_id,item_index,media_id,asset_kind,local_path,sha,size,storage_id,archive_root,target,outcome,verified_at,recorded_at,error)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(job_id,item_index) DO UPDATE SET
               size=excluded.size,outcome=excluded.outcome,verified_at=excluded.verified_at,
               recorded_at=excluded.recorded_at,error=excluded.error""",
            (job_id,index,item["id"],item["kind"],item["local"],item["sha"],size if size is not None else item["size"],
             config_identity(config),config["root"],item["target"],outcome,
             stamp if outcome in {"uploaded", "skipped"} else None,stamp,error),
        )


def upload_selection(job, _incoming, managed):
    payload = json.loads(job["payload"])
    result = {"totalFiles": len(payload["files"]), "completedFiles": 0, "uploaded": 0, "skipped": 0, "failed": 0,
              "totalBytes": 0, "transferredBytes": 0, "errors": [], "current": "", "phase": "연결 중"}
    for item in payload["files"]:
        size = item["size"]
        if size is None:
            try:
                size = inspect(managed, item["local"]).st_size
            except OSError:
                size = 0
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

    status = "done"
    try:
        save(True)
        config = archive_config()
        if config_identity(config) != payload["config"]:
            fail(409, "전송 예약 후 SSH 설정이 변경되었습니다. 다시 업로드하세요.")
        with archive_connection(config) as (sftp, config):
            base = PurePosixPath(sftp.normalize(config["root"]))
            for index, item in enumerate(payload["files"]):
                result["current"] = item["target"]
                save(True)
                try:
                    outcome, size = send_file(sftp, base, managed, item, f".photo-saver-{payload['token']}-{index}.part", progress)
                    record_archive(job["id"], index, item, config, outcome, size)
                    result[outcome] += 1
                    completed_bytes += size
                except UploadCancelled:
                    raise
                except (OSError, ValueError, HTTPException) as error:
                    result["failed"] += 1
                    message = error.detail if isinstance(error, HTTPException) else "파일을 읽거나 업로드하지 못했습니다. 연결 및 파일 권한을 확인하세요."
                    record_archive(job["id"], index, item, config, "failed", error=message)
                    if len(result["errors"]) < 100:
                        result["errors"].append({"path": item["target"], "message": message})
                result["completedFiles"] += 1
                result["transferredBytes"] = completed_bytes
                save(True)
        if result["failed"]:
            status = "failed"
            result["error"] = f"{result['failed']}개 파일을 업로드하지 못했습니다. 실패 목록을 확인하고 다시 업로드하세요."
    except UploadCancelled:
        status = "cancelled"
        result["error"] = "업로드를 중지했습니다. 완료된 파일은 아카이브에 유지됩니다."
    except Exception as error:
        status = "failed"
        result["error"] = error.detail if isinstance(error, HTTPException) else "아카이브 전송에 실패했습니다. 연결 상태를 확인하고 다시 업로드하세요."
        pending = payload["files"][result["completedFiles"]:]
        result["failed"] += len(pending)
        result["completedFiles"] = result["totalFiles"]
        for item in pending[:max(0, 100 - len(result["errors"]))]:
            result["errors"].append({"path": item["target"], "message": result["error"]})
    result["phase"] = "완료" if status == "done" else "중지됨" if status == "cancelled" else "실패"
    result["current"] = ""
    with database(write=True) as db:
        db.execute("UPDATE jobs SET status=?,result=?,finished_at=? WHERE id=?", (status, json.dumps(result, ensure_ascii=False), now(), job["id"]))
