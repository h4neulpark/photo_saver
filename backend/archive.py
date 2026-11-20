import errno
import socket
import stat
import time
import hashlib
import json
from contextlib import contextmanager
from pathlib import PurePosixPath

import paramiko
from fastapi import APIRouter
from fastapi.responses import JSONResponse

import settings

router = APIRouter(prefix="/api/archive")
MAX_ENTRIES = 10000


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
    return {
        "address": address, "account": account, "root": root,
        "hostKey": settings.read_setting(known_hosts),
        "identity": hashlib.sha256(settings.PUBLIC_KEY.read_bytes()).hexdigest(),
    }


def archive_revision(config):
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


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
