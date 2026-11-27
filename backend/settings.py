import base64
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import subprocess
import tempfile
import time
from contextlib import closing, contextmanager
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, field_validator, model_validator
from starlette.background import BackgroundTask

from catalog import (DATA, DEFAULT_ZONE, JobConflictError, LANE_EXCLUSIVE, LANE_REMOTE,
                     backfill_job_lanes, backfill_remote_files, catalog_lock, database,
                     has_active_jobs, now, open_db, queue_job)

router = APIRouter(prefix="/api/settings")
SETTINGS_DIR = Path("/settings")
ADDRESS_FILE = SETTINGS_DIR / "address"
STORAGE_ROOT_FILE = SETTINGS_DIR / "remote-root"
LOCAL_RETENTION_FILE = SETTINGS_DIR / "local-retention.json"
STORAGE_ID_RE = re.compile(r"^[0-9a-f]{32}$")
KEY_DIR = SETTINGS_DIR / "ssh"
KEY_FILE = KEY_DIR / "id_ed25519"
PUBLIC_KEY = KEY_DIR / "id_ed25519.pub"
KEY_COPIED = KEY_DIR / "public_key_copied"
PENDING_HOST_KEY = SETTINGS_DIR / "pending-host-key.json"
HOST_KEY_TYPES = ("ssh-ed25519", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521", "ssh-rsa")
MAX_BACKUP_BYTES = 128 * 1024 * 1024
NO_STORE = {"Cache-Control": "no-store"}

# Copy data into the application's existing schema, including older Photo Saver backups.
RESTORE_COLUMNS = {
    "thumbnail_cache": set(),
    "jobs": {"lane"},
    "events": set(),
    "device_names": set(),
    "storages": {"last_indexed_at"},
    "media": {"user_time_source", "original_path", "xmp_path", "xmp_sha", "xmp_metadata"},
    "scan_files": {"thumbnail", "companions"},
    "scan_xmp": set(),
    "archive_entries": set(),
    "remote_files": set(),
}
JSON_FIELDS = {
    "jobs": {"payload": "object", "result": "object"},
    "media": {"metadata": "object", "xmp_metadata": "object", "fingerprint": "array"},
    "scan_files": {"fingerprint": "array", "companions": "array"},
    "scan_xmp": {"file": "object", "candidates": "array"},
}


class StorageAddress(BaseModel):
    address: str


class StorageRoot(BaseModel):
    path: str


class HostKeyConfirmation(BaseModel):
    token: str


class CatalogReset(BaseModel):
    confirmation: Literal["모든 데이터 삭제"]


class LocalRetentionConfig(BaseModel):
    mode: Literal["manual", "days"]
    days: int | None = None

    @field_validator("days", mode="before")
    @classmethod
    def integer_days(cls, value):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int)):
            raise ValueError("보존 기간은 0에서 3650 사이의 정수로 입력하세요.")
        return value

    @model_validator(mode="after")
    def valid_policy(self):
        if self.mode == "manual" and self.days is not None:
            fail(400, "수동 유지 정책에는 보존 기간을 지정할 수 없습니다.")
        if self.mode == "days" and (self.days is None or not 0 <= self.days <= 3650):
            fail(400, "보존 기간은 0에서 3650 사이의 정수로 입력하세요.")
        return self


def read_local_retention():
    try:
        return LocalRetentionConfig.model_validate(json.loads(LOCAL_RETENTION_FILE.read_text(encoding="utf-8"))).model_dump()
    except (OSError, ValueError, TypeError, HTTPException):
        return {"mode": "manual", "days": None}


def save_local_retention(mode, days):
    policy = LocalRetentionConfig(mode=mode, days=days).model_dump()
    with settings_lock():
        replace_setting(LOCAL_RETENTION_FILE, json.dumps(policy, ensure_ascii=False) + "\n")


@router.put("/retention")
def put_local_retention(request: LocalRetentionConfig):
    save_local_retention(request.mode, request.days)
    return JSONResponse(settings_state(), headers=NO_STORE)


def fail(status, message):
    raise HTTPException(status_code=status, detail=message)


@contextmanager
def settings_lock():
    SETTINGS_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (SETTINGS_DIR / "settings.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def read_setting(path):
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def read_storage_id():
    value = read_setting(SETTINGS_DIR / "storage-id").strip()
    return value if STORAGE_ID_RE.fullmatch(value) else ""


def ensure_storage_id():
    with settings_lock():
        existing = read_storage_id()
        if existing:
            return existing
        created = uuid4().hex
        replace_setting(SETTINGS_DIR / "storage-id", created)
        return created


def settings_state():
    from storage_wake import public_configuration
    from storage_shutdown import public_configuration as shutdown_configuration
    address = read_setting(ADDRESS_FILE).strip()
    storage_root = read_setting(STORAGE_ROOT_FILE)
    generated = KEY_FILE.is_file() and PUBLIC_KEY.is_file()
    return {
        "localRetention": read_local_retention(),
        "storageWake": public_configuration(),
        "storageShutdown": shutdown_configuration(),
        "address": address, "storageRoot": storage_root, "account": "***", "publicKey": "***",
        "addressConfigured": bool(address),
        "storageRootConfigured": bool(storage_root),
        "accountConfigured": bool(os.environ.get("PHOTO_SAVER_STORAGE_USER", "").strip()),
        "keyGenerated": generated, "keyCopied": generated and KEY_COPIED.is_file(),
        "hostKeyTrusted": bool(address and known_host_file(address).is_file()),
    }


@router.get("")
def get_settings():
    return JSONResponse(settings_state(), headers=NO_STORE)


def replace_setting(path, value):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=SETTINGS_DIR, delete=False) as temporary:
        pending = Path(temporary.name)
        try:
            temporary.write(value)
            temporary.flush()
            os.fsync(temporary.fileno())
            os.replace(pending, path)
        finally:
            pending.unlink(missing_ok=True)


def write_setting(path, value):
    with settings_lock():
        replace_setting(path, value)


@router.put("/storage")
def save_storage(request: StorageAddress):
    value = request.address.strip()
    try:
        if "%" in value:
            raise ValueError("scoped address")
        address = ipaddress.ip_address(value)
    except ValueError:
        fail(400, "유효한 IPv4 또는 IPv6 주소를 입력하세요.")
    write_setting(ADDRESS_FILE, str(address))
    ensure_storage_id()
    return JSONResponse(settings_state(), headers=NO_STORE)


@router.put("/storage/root")
def save_storage_root(request: StorageRoot):
    value = request.path
    if "\0" in value or not PurePosixPath(value).is_absolute():
        fail(400, "원격 스토리지에서 /로 시작하는 절대경로를 입력하세요.")
    write_setting(STORAGE_ROOT_FILE, value)
    ensure_storage_id()
    return JSONResponse(settings_state(), headers=NO_STORE)


@router.post("/ssh-key", status_code=201)
def generate_key():
    with settings_lock():
        with tempfile.TemporaryDirectory(dir=SETTINGS_DIR) as directory:
            staged = Path(directory) / "ssh"
            staged.mkdir(mode=0o700)
            try:
                subprocess.run(
                    ["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "photo-saver", "-f", str(staged / KEY_FILE.name)],
                    check=True, timeout=10, capture_output=True,
                )
            except (OSError, subprocess.SubprocessError):
                fail(500, "SSH 키를 생성할 수 없습니다.")
            previous = Path(directory) / "previous-ssh"
            if KEY_DIR.exists():
                KEY_DIR.rename(previous)
            try:
                staged.rename(KEY_DIR)
            except OSError:
                if previous.exists():
                    previous.rename(KEY_DIR)
                raise
    return JSONResponse(settings_state(), status_code=201, headers=NO_STORE)


@router.post("/ssh-key/public")
def copy_public_key():
    with settings_lock():
        if not PUBLIC_KEY.is_file() or not KEY_FILE.is_file():
            fail(404, "먼저 SSH 키를 생성하세요.")
        if KEY_COPIED.exists():
            fail(409, "공개키 최초 복사가 완료되었습니다.")
        return JSONResponse({"publicKey": PUBLIC_KEY.read_text(encoding="utf-8").strip()}, headers=NO_STORE)


@router.post("/ssh-key/copied")
def acknowledge_key_copy():
    with settings_lock():
        if not PUBLIC_KEY.is_file() or not KEY_FILE.is_file():
            fail(404, "먼저 SSH 키를 생성하세요.")
        KEY_COPIED.touch(mode=0o600, exist_ok=True)
    return JSONResponse(settings_state(), headers=NO_STORE)


def ssh_target():
    address = read_setting(ADDRESS_FILE).strip()
    account = os.environ.get("PHOTO_SAVER_STORAGE_USER", "").strip()
    if not address:
        fail(409, "먼저 스토리지 IP 주소를 등록하세요.")
    if not account:
        fail(409, ".env에 PHOTO_SAVER_STORAGE_USER를 설정하세요.")
    if not KEY_FILE.is_file():
        fail(409, "먼저 SSH 키를 생성하고 공개키를 스토리지 계정에 등록하세요.")
    try:
        address = str(ipaddress.ip_address(address))
    except ValueError:
        fail(409, "스토리지 IP 주소를 다시 저장하세요.")
    return address, account


def host_alias(address):
    return "photo-saver-" + hashlib.sha256(address.encode()).hexdigest()


def known_host_file(address):
    return SETTINGS_DIR / f"known-{host_alias(address)}"


def discover_host_key(address):
    try:
        scan = subprocess.run(
            ["ssh-keyscan", "-T", "5", "-t", "ed25519,ecdsa,rsa", address],
            capture_output=True, text=True, timeout=8,
        )
    except subprocess.TimeoutExpired:
        fail(504, "스토리지의 SSH 서버가 응답하지 않았습니다. IP와 22번 포트를 확인하세요.")
    except OSError:
        fail(500, "SSH 접속 테스트를 시작할 수 없습니다.")
    keys = {}
    for line in scan.stdout.splitlines():
        fields = line.split()
        if len(fields) != 3 or fields[1] not in HOST_KEY_TYPES:
            continue
        try:
            decoded = base64.b64decode(fields[2], validate=True)
        except ValueError:
            continue
        if decoded:
            keys[fields[1]] = (fields[2], decoded)
    for algorithm in HOST_KEY_TYPES:
        if algorithm in keys:
            key, decoded = keys[algorithm]
            fingerprint = base64.b64encode(hashlib.sha256(decoded).digest()).decode().rstrip("=")
            return algorithm, key, f"SHA256:{fingerprint}"
    fail(502, "서버의 SSH 호스트 키를 읽을 수 없습니다. IP, 22번 포트 및 SSH 서비스 상태를 확인하세요.")


def verify_public_key_access(address, account):
    known_hosts = known_host_file(address)
    fields = read_setting(known_hosts).split()
    if len(fields) != 3 or fields[1] not in HOST_KEY_TYPES:
        fail(409, "저장된 SSH 호스트 키를 확인할 수 없습니다.")
    algorithms = "rsa-sha2-512,rsa-sha2-256" if fields[1] == "ssh-rsa" else fields[1]
    command = [
        "ssh", "-F", "/dev/null", "-T", "-v", "-i", str(KEY_FILE),
        "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
        "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no", "-o", "StrictHostKeyChecking=yes",
        "-o", "GlobalKnownHostsFile=/dev/null", "-o", f"UserKnownHostsFile={known_hosts}",
        "-o", f"HostKeyAlias={host_alias(address)}", "-o", f"HostKeyAlgorithms={algorithms}",
        "-o", "UpdateHostKeys=no", "-o", "ConnectTimeout=5", "-o", "ConnectionAttempts=1",
        "-l", account, "--", address, "true",
    ]
    try:
        with tempfile.NamedTemporaryFile(dir=SETTINGS_DIR) as debug_log:
            result = subprocess.run(
                [command[0], "-E", debug_log.name, *command[1:]],
                capture_output=True, text=True, errors="replace", timeout=10,
            )
            client_log = Path(debug_log.name).read_text(encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        fail(504, "SSH 인증 응답이 지연되고 있습니다. 스토리지의 SSH 서비스를 확인하세요.")
    except OSError:
        fail(500, "SSH 접속 테스트를 실행할 수 없습니다.")
    if re.search(r'^Authenticated to .+ using "publickey"\.$', client_log, re.MULTILINE):
        return JSONResponse({"status": "connected"}, headers=NO_STORE)
    diagnostic = (client_log + result.stderr).lower()
    if any(message in diagnostic for message in (
        "remote host identification has changed", "host key verification failed", "no matching host key type",
    )):
        fail(409, "서버 호스트 키가 저장된 값과 다르거나 지원되지 않습니다. 스토리지에서 호스트 키를 확인하세요.")
    if result.returncode == 0 or "permission denied" in diagnostic:
        fail(401, "공개키 인증에 실패했습니다. .env의 계정명과 스토리지에 등록한 공개키를 확인하세요.")
    fail(502, "스토리지의 SSH 서비스에 접속할 수 없습니다. IP와 22번 포트를 확인하세요.")


@router.post("/ssh-test")
def test_ssh_connection():
    address, account = ssh_target()
    if not known_host_file(address).is_file():
        algorithm, key, fingerprint = discover_host_key(address)
        with settings_lock():
            if read_setting(ADDRESS_FILE).strip() != address:
                fail(409, "스토리지 IP가 변경되었습니다. 접속 테스트를 다시 실행하세요.")
            if not known_host_file(address).is_file():
                token = secrets.token_urlsafe(24)
                replace_setting(PENDING_HOST_KEY, json.dumps({
                    "address": address, "algorithm": algorithm, "key": key, "token": token,
                    "expires": time.time() + 300,
                }))
                return JSONResponse({
                    "status": "confirm_host", "algorithm": algorithm, "fingerprint": fingerprint, "token": token,
                }, headers=NO_STORE)
    return verify_public_key_access(address, account)


@router.post("/ssh-test/trust")
def trust_and_test_host(request: HostKeyConfirmation):
    with settings_lock():
        address, account = ssh_target()
        pending = json.loads(read_setting(PENDING_HOST_KEY) or "{}")
        if (pending.get("token") != request.token or pending.get("address") != address or
                pending.get("expires", 0) < time.time()):
            fail(409, "호스트 키 확인 요청이 만료되었거나 스토리지 IP가 변경되었습니다. 다시 테스트하세요.")
        known_hosts = known_host_file(address)
        if known_hosts.exists():
            fail(409, "이미 서버 호스트 키가 등록되었습니다. 접속 테스트를 다시 실행하세요.")
        replace_setting(known_hosts, f"{host_alias(address)} {pending['algorithm']} {pending['key']}\n")
        PENDING_HOST_KEY.unlink()
    return verify_public_key_access(address, account)


@router.delete("/ssh-host-key")
def reset_host_key():
    with database() as db:
        if has_active_jobs(db, (LANE_REMOTE, LANE_EXCLUSIVE)):
            fail(409, "업로드·로컬 비우기·원격 인덱싱·OMV 시작·종료 확인이 끝난 뒤 호스트 키를 초기화하세요.")
    with settings_lock():
        address = read_setting(ADDRESS_FILE).strip()
        if not address:
            fail(409, "먼저 스토리지 IP 주소를 등록하세요.")
        known_host_file(address).unlink(missing_ok=True)
        PENDING_HOST_KEY.unlink(missing_ok=True)
    return JSONResponse(settings_state(), headers=NO_STORE)


def ensure_catalog_idle(connection):
    if connection.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
        fail(409, "진행 중인 파일 작업이 끝난 뒤 다시 시도하세요.")


@router.post("/catalog/reset", status_code=202)
def reset_catalog(request: CatalogReset):
    with database(write=True) as connection:
        try:
            job_id = queue_job(connection, "reset-all", {})
        except JobConflictError as exc:
            fail(409, str(exc))
    return JSONResponse({"id": job_id, "kind": "reset-all", "lane": LANE_EXCLUSIVE, "status": "queued"},
                        status_code=202, headers=NO_STORE)


@router.get("/catalog/backup")
def backup_catalog():
    path = None
    try:
        with catalog_lock(exclusive=True), closing(open_db()) as current:
            ensure_catalog_idle(current)
            with tempfile.NamedTemporaryFile(dir=DATA, suffix=".sqlite3", delete=False) as temporary:
                path = Path(temporary.name)
            with closing(sqlite3.connect(path)) as destination:
                current.backup(destination)
    except BaseException:
        if path:
            path.unlink(missing_ok=True)
        raise
    date = datetime.now(ZoneInfo(DEFAULT_ZONE)).strftime("%Y%m%d-%H%M%S")
    return FileResponse(
        path, filename=f"photo-saver-{date}.sqlite3", media_type="application/octet-stream",
        headers=NO_STORE, background=BackgroundTask(path.unlink, missing_ok=True),
    )


def restore_columns(source, target):
    tables = {name for name, sql in source.execute("SELECT name,sql FROM sqlite_schema WHERE type='table'")
              if sql and sql.upper().startswith("CREATE TABLE ")}
    columns = {}
    for table, optional in RESTORE_COLUMNS.items():
        if table in {"scan_xmp", "archive_entries", "device_names", "storages", "remote_files", "thumbnail_cache"} and table not in tables:
            continue
        available = {row[1] for row in source.execute(f"PRAGMA table_info({table})")}
        expected = [row["name"] for row in target.execute(f"PRAGMA table_info({table})")]
        if table not in tables or not set(expected).difference(optional).issubset(available):
            fail(400, "Photo Saver 카탈로그 형식의 백업 파일을 선택하세요.")
        columns[table] = [name for name in expected if name in available]
    return columns


def validate_restored_catalog(connection):
    for table, fields in JSON_FIELDS.items():
        for field, kind in fields.items():
            invalid = connection.execute(
                f"""SELECT 1 FROM {table} WHERE {field} IS NOT NULL
                    AND CASE WHEN json_valid({field}) THEN json_type({field})<>? ELSE 1 END LIMIT 1""",
                (kind,),
            ).fetchone()
            if invalid:
                fail(400, "백업에 읽을 수 없는 카탈로그 데이터가 있습니다.")
    if connection.execute("PRAGMA foreign_key_check").fetchone():
        fail(400, "백업의 이벤트 또는 파일 연결 정보가 손상되었습니다.")


def restore_catalog_file(path):
    try:
        with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)) as source:
            source.execute("PRAGMA trusted_schema=OFF")
            if source.execute("PRAGMA quick_check(1)").fetchone() != ("ok",):
                fail(400, "데이터베이스 백업이 손상되었습니다.")
            with catalog_lock(exclusive=True), closing(open_db()) as target:
                ensure_catalog_idle(target)
                columns = restore_columns(source, target)
                target.execute("BEGIN IMMEDIATE")
                with target:
                    target.execute("PRAGMA defer_foreign_keys=ON")
                    for table in reversed(RESTORE_COLUMNS):
                        target.execute(f"DELETE FROM {table}")
                    for table, names in columns.items():
                        fields = ",".join(names)
                        values = ",".join("?" for _ in names)
                        target.executemany(
                            f"INSERT INTO {table} ({fields}) VALUES ({values})",
                            source.execute(f"SELECT {fields} FROM {table}"),
                        )
                    validate_restored_catalog(target)
                    target.execute(
                        """UPDATE jobs SET status='failed',result=?,finished_at=?
                           WHERE status IN ('queued','running')""",
                        (json.dumps({"error": "복원 전에 대기 중이던 작업입니다. 라이브러리를 새로 고침하세요."}), now()),
                    )
                    backfill_job_lanes(target)
                    target.execute("UPDATE media SET status='missing' WHERE status='moving'")
                    target.execute("UPDATE media SET status='available' WHERE status='offloading'")
                    target.execute("UPDATE scan_files SET status='review' WHERE status='deleting'")
                    backfill_remote_files(target, read_storage_id() or None)
    except sqlite3.DatabaseError:
        fail(400, "데이터베이스 백업을 읽거나 복원할 수 없습니다.")


@router.post("/catalog/restore")
async def restore_catalog(request: Request):
    with tempfile.NamedTemporaryFile(dir=DATA, delete=False) as temporary:
        path = Path(temporary.name)
        try:
            written = 0
            async for chunk in request.stream():
                written += len(chunk)
                if written > MAX_BACKUP_BYTES:
                    fail(413, "128MB 이하의 백업 파일을 선택하세요.")
                temporary.write(chunk)
            temporary.flush()
            await run_in_threadpool(restore_catalog_file, path)
        finally:
            path.unlink(missing_ok=True)
    return {"restored": True}
