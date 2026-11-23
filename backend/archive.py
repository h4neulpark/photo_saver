import errno
import hashlib
import json
import socket
import stat
import time
from contextlib import ExitStack, contextmanager
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import quote

import paramiko
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

from catalog import database
import settings

router = APIRouter(prefix="/api/archive")
MAX_ENTRIES = 10000
DOWNLOAD_CHUNK = 1024 * 1024


def relative_path(value):
    path = PurePosixPath(value)
    if "\0" in value or path.is_absolute() or ".." in path.parts:
        settings.fail(400, "아카이브 루트 안의 폴더를 선택하세요.")
    return path


def directory_listing(sftp, root, path):
    base = PurePosixPath(sftp.normalize(root))
    target = PurePosixPath(sftp.normalize(str(base / path)))
    if not target.is_relative_to(base):
        settings.fail(403, "아카이브 루트 밖의 폴더는 조회할 수 없습니다.")
    entries = []
    started = time.monotonic()
    for item in sftp.listdir_iter(str(target), read_aheads=1):
        if len(entries) >= MAX_ENTRIES:
            settings.fail(413, "폴더 항목이 10,000개를 초과합니다. 더 작은 하위 폴더를 조회하세요.")
        if time.monotonic() - started > 15:
            settings.fail(504, "폴더 조회 시간이 초과되었습니다. 다시 연결하세요.")
        if item.filename in (".", "..") or "/" in item.filename or "\0" in item.filename:
            continue
        mode = item.st_mode or 0
        kind = "folder" if stat.S_ISDIR(mode) else "link" if stat.S_ISLNK(mode) else "file"
        entries.append({
            "name": item.filename, "kind": kind,
            "size": item.st_size if stat.S_ISREG(mode) else None,
            "modified": item.st_mtime,
        })
    entries.sort(key=lambda item: (item["kind"] != "folder", item["name"].casefold(), item["name"]))
    return {"root": root, "path": "" if str(path) == "." else str(path), "entries": entries}


@router.get("")
def browse_archive(path: str = ""):
    relative = relative_path(path)
    with archive_connection() as (sftp, config):
        result = directory_listing(sftp, config["root"], relative)
        result["connectionVersion"] = archive_revision(config)
    return JSONResponse(result, headers=settings.NO_STORE)


def content_disposition(filename):
    clean = filename.replace("\r", "").replace("\n", "").replace('"', "_").replace("\\", "_")
    ascii_name = "".join(ch if 32 <= ord(ch) < 127 and ch not in {'"', "\\", ";"} else "_" for ch in clean).strip() or "download"
    encoded = quote(clean, safe="")
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{encoded}'


def resolve_remote_file(sftp, root, relative):
    relative = relative_path(str(relative))
    if not relative.parts or str(relative) == ".":
        settings.fail(400, "원격 파일 경로를 지정하세요.")
    base = PurePosixPath(sftp.normalize(root))
    current = base
    for part in relative.parts[:-1]:
        current = current / part
        try:
            info = sftp.lstat(str(current))
        except OSError as error:
            if error.errno == errno.ENOENT:
                settings.fail(404, "원격 파일을 찾을 수 없습니다.")
            raise
        if stat.S_ISLNK(info.st_mode):
            settings.fail(403, "심볼릭 링크 경로는 접근할 수 없습니다.")
        if not stat.S_ISDIR(info.st_mode):
            settings.fail(400, "선택한 경로의 상위 항목이 폴더가 아닙니다.")
    target = current / relative.parts[-1]
    try:
        info = sftp.lstat(str(target))
    except OSError as error:
        if error.errno == errno.ENOENT:
            settings.fail(404, "원격 파일을 찾을 수 없습니다.")
        raise
    if stat.S_ISLNK(info.st_mode):
        settings.fail(403, "심볼릭 링크는 다운로드할 수 없습니다.")
    if stat.S_ISDIR(info.st_mode):
        settings.fail(400, "폴더는 직접 다운로드할 수 없습니다. 파일을 선택하세요.")
    if not stat.S_ISREG(info.st_mode):
        settings.fail(400, "일반 파일만 다운로드할 수 있습니다.")
    normalized = PurePosixPath(sftp.normalize(str(target)))
    if not normalized.is_relative_to(base):
        settings.fail(403, "아카이브 루트 밖의 파일은 다운로드할 수 없습니다.")
    return target, info


def resolve_media_download_path(media_id, kind, config):
    storage_id = storage_id_for(config)
    with database() as db:
        row = db.execute("SELECT id, sha, xmp_sha FROM media WHERE id=?", (media_id,)).fetchone()
        if not row:
            settings.fail(404, "파일 기록을 찾을 수 없습니다.")
        sha = row["xmp_sha"] if kind == "xmp" else row["sha"]
        if not sha:
            settings.fail(404, "요청한 원본 또는 XMP 해시 기록이 없습니다.")
        matches = db.execute(
            """SELECT storage_id, path, archive_root FROM remote_files
               WHERE sha=? AND status='present'
               ORDER BY (storage_id=? AND archive_root=?) DESC,
                        (archive_root=?) DESC,
                        coalesce(verified_at, last_seen_at) DESC, path""",
            (sha, storage_id, config["root"], config["root"]),
        ).fetchall()
    if not matches:
        settings.fail(404, "원격 아카이브에 검증된 파일 기록이 없습니다.")
    compatible = next((item for item in matches if item["archive_root"] == config["root"]), None)
    if not compatible:
        settings.fail(409, "현재 설정된 저장 절대경로와 다른 경로에 보관된 파일입니다. 설정의 저장 절대경로를 확인하세요.")
    return compatible["path"]


@router.get("/download")
def download_archive_file(
    path: str | None = None,
    media_id: str | None = None,
    kind: Literal["media", "xmp"] = "media",
):
    if bool(path) == bool(media_id):
        settings.fail(400, "다운로드할 원격 경로 또는 파일 ID 중 하나를 지정하세요.")
    config = archive_config()
    target_path = resolve_media_download_path(media_id, kind, config) if media_id else path
    relative = relative_path(target_path)
    if not relative.parts or str(relative) == ".":
        settings.fail(400, "원격 파일 경로를 지정하세요.")

    with ExitStack() as stack:
        sftp, active = stack.enter_context(archive_connection(config))
        if hasattr(sftp, "get_channel") and sftp.get_channel():
            sftp.get_channel().settimeout(60)
        target, info = resolve_remote_file(sftp, active["root"], relative)
        remote = stack.enter_context(sftp.open(str(target), "rb"))
        if hasattr(remote, "prefetch") and info.st_size:
            remote.prefetch(info.st_size)
        handoff = stack.pop_all()

    def stream():
        with handoff:
            while chunk := remote.read(DOWNLOAD_CHUNK):
                yield chunk

    headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": content_disposition(target.name),
        "Content-Length": str(info.st_size),
    }
    return StreamingResponse(stream(), media_type="application/octet-stream", headers=headers)


def archive_config():
    address, account = settings.ssh_target()
    root = settings.read_setting(settings.STORAGE_ROOT_FILE)
    if not root or not PurePosixPath(root).is_absolute() or "\0" in root:
        settings.fail(409, "설정에서 원격 스토리지의 저장 절대경로를 등록하세요.")
    known_hosts = settings.known_host_file(address)
    if not known_hosts.is_file():
        settings.fail(409, "설정의 SSH 접속 테스트에서 서버 호스트 키를 먼저 확인하세요.")
    if not settings.PUBLIC_KEY.is_file():
        settings.fail(409, "SSH 공개키를 확인할 수 없습니다. 설정에서 키 등록 상태를 확인하세요.")
    config = {
        "address": address, "account": account, "root": root,
        "hostKey": settings.read_setting(known_hosts),
        "identity": hashlib.sha256(settings.PUBLIC_KEY.read_bytes()).hexdigest(),
    }
    storage_id = settings.read_storage_id()
    if storage_id:
        config["storageId"] = storage_id
    return config


def archive_revision(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def storage_id_for(config):
    return config.get("storageId") or settings.read_storage_id() or archive_revision(config)


def active_storage_scope():
    try:
        config = archive_config()
    except HTTPException:
        return None, None
    return storage_id_for(config), config["root"]


@contextmanager
def archive_connection(expected=None):
    config = archive_config()
    if expected is not None and config != expected:
        settings.fail(409, "전송 예약 후 SSH 설정이 변경되었습니다. 다시 업로드하세요.")
    address, account = config["address"], config["account"]
    known_hosts = settings.known_host_file(address)
    try:
        trusted = paramiko.HostKeys(str(known_hosts)).lookup(settings.host_alias(address))
        if not trusted:
            settings.fail(409, "저장된 SSH 호스트 키를 확인할 수 없습니다. 설정에서 접속 테스트를 실행하세요.")
        with paramiko.SSHClient() as client:
            for algorithm, key in trusted.items():
                client.get_host_keys().add(address, algorithm, key)
            client.connect(
                hostname=address, username=account, key_filename=str(settings.KEY_FILE),
                allow_agent=False, look_for_keys=False, timeout=5,
                banner_timeout=5, auth_timeout=5, channel_timeout=5,
            )
            with client.open_sftp() as sftp:
                sftp.get_channel().settimeout(10)
                yield sftp, config
    except paramiko.BadHostKeyException:
        settings.fail(409, "서버 호스트 키가 저장된 값과 다릅니다. 설정에서 접속 테스트를 실행하세요.")
    except paramiko.AuthenticationException:
        settings.fail(401, "SSH 공개키 인증에 실패했습니다. 설정의 계정명과 공개키 등록 상태를 확인하세요.")
    except (socket.timeout, TimeoutError):
        settings.fail(504, "아카이브 응답 시간이 초과되었습니다. 다시 연결하세요.")
    except OSError as error:
        if error.errno == errno.ENOENT:
            settings.fail(404, "원격 폴더가 없습니다. 저장 절대경로 또는 선택한 폴더를 확인하세요.")
        if error.errno == errno.EACCES:
            settings.fail(403, "원격 폴더를 읽을 권한이 없습니다. 스토리지 계정의 권한을 확인하세요.")
        if error.errno == errno.ENOTDIR:
            settings.fail(400, "선택한 경로가 폴더가 아닙니다.")
        settings.fail(502, "아카이브에 연결할 수 없습니다. IP와 SSH 서비스 상태를 확인하세요.")
    except (paramiko.SSHException, ValueError):
        settings.fail(502, "SFTP로 파일 목록을 읽을 수 없습니다. 설정의 접속 테스트와 서버의 SFTP 지원을 확인하세요.")
