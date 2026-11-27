"""Resumable Incoming uploads; only complete files enter the visible library."""
import errno
import fcntl
import json
import os
import re
import shutil
import stat
import time
import unicodedata
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, StrictInt

from companions import COMPANION_EXTENSIONS
from media import DIRECTORY_FLAGS, SUPPORTED, VIDEOS, iso_time, regular_stat, rename_noreplace

INCOMING_UPLOAD = Path(os.environ.get("PHOTO_SAVER_INCOMING_UPLOAD", "/incoming-upload"))
STAGING_DIR_NAME = ".photo-saver-uploads"
UPLOAD_EXTENSIONS = SUPPORTED | COMPANION_EXTENSIONS
DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024
MAX_CHUNK_BYTES = 32 * 1024 * 1024
MAX_FILE_BYTES = int(os.environ.get("PHOTO_SAVER_MAX_UPLOAD_BYTES", str(100 * 1024**3)))
MIN_FREE_HEADROOM_BYTES = 64 * 1024 * 1024
STALE_TTL_SECONDS = 7200
CLEANUP_INTERVAL_SECONDS = 600
UPLOAD_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
_last_cleanup = 0.0


class UploadRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def respond(request):
            try:
                response = await handler(request)
            except HTTPException as exc:
                response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
            except RequestValidationError:
                response = JSONResponse({"detail": "업로드 요청 형식을 확인하세요."}, status_code=400)
            except OSError as exc:
                code = 507 if exc.errno in (errno.ENOSPC, errno.EDQUOT) else 409
                response = JSONResponse({"detail": "저장 공간이 부족합니다." if code == 507 else "업로드 경로 또는 파일 상태가 변경되었습니다."}, status_code=code)
            response.headers.update(UPLOAD_HEADERS)
            return response
        return respond


router = APIRouter(prefix="/api/incoming/uploads", route_class=UploadRoute)


class UploadRequest(BaseModel):
    name: str
    size: StrictInt
    folder: str = ""
    last_modified_ms: StrictInt | None = None


def normalized(value):
    return unicodedata.normalize("NFC", value.strip())


def validate_name(value):
    name = normalized(value)
    if not name or name.startswith(".") or UNSAFE.search(name) or len(name.encode("utf-8")) > 220 or Path(name).stem.strip() in ("", ".", ".."):
        raise HTTPException(400, "파일 이름을 확인하세요. 숨김 파일과 특수 문자는 사용할 수 없습니다.")
    if Path(name).suffix.lower() not in UPLOAD_EXTENSIONS:
        raise HTTPException(415, "지원하지 않는 형식입니다. JPG·PNG·WEBP·HEIC·HEIF·MP4·MOV·XMP·THM·LRV·AAE 파일을 선택하세요.")
    return name


def validate_folder(value):
    folder = normalized(value)
    if folder.startswith("/") or "\\" in folder:
        raise HTTPException(400, "상대 폴더 경로만 사용할 수 있습니다.")
    folder = folder.rstrip("/")
    parts = folder.split("/") if folder else []
    if len(folder) > 180 or len(parts) > 6 or any(p != p.strip() or not p.strip() or p.startswith(".") or len(p.encode("utf-8")) > 220 or UNSAFE.search(p) for p in parts):
        raise HTTPException(400, "폴더는 앞뒤 공백·숨김·특수 문자 없이 6단계, 180자 이내(각 이름 UTF-8 220바이트 이하)로 입력하세요.")
    return folder


def validate_id(upload_id):
    if not UPLOAD_ID.fullmatch(upload_id):
        raise HTTPException(400, "잘못된 업로드 ID입니다.")


@contextmanager
def upload_root():
    try:
        fd = os.open(INCOMING_UPLOAD, DIRECTORY_FLAGS)
    except OSError as exc:
        raise HTTPException(503, "Incoming 업로드 폴더를 사용할 수 없습니다.") from exc
    try:
        if not os.access(INCOMING_UPLOAD, os.W_OK):
            raise HTTPException(503, "Incoming 업로드 폴더에 쓰기 권한이 없습니다.")
        yield fd
    finally:
        os.close(fd)


@contextmanager
def target_directory(root_fd, folder, create=False):
    fd = os.dup(root_fd)
    try:
        for part in folder.split("/") if folder else []:
            if create:
                try:
                    os.mkdir(part, dir_fd=fd)
                except FileExistsError:
                    pass
            try:
                child = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            except FileNotFoundError:
                if not create:
                    break
                raise
            except OSError as exc:
                raise HTTPException(409, "대상 폴더에 파일 또는 심볼릭 링크가 있습니다.") from exc
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


@contextmanager
def staging(create=False):
    with upload_root() as root:
        if create:
            try:
                os.mkdir(STAGING_DIR_NAME, 0o700, dir_fd=root)
            except FileExistsError:
                pass
        try:
            fd = os.open(STAGING_DIR_NAME, DIRECTORY_FLAGS, dir_fd=root)
        except FileNotFoundError as exc:
            raise HTTPException(404, "업로드 세션이 없습니다.") from exc
        try:
            yield root, fd
        finally:
            os.close(fd)


def open_regular(fd, name, flags=os.O_RDONLY):
    file_fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    if not stat.S_ISREG(os.fstat(file_fd).st_mode):
        os.close(file_fd)
        raise HTTPException(409, "일반 파일만 업로드할 수 있습니다.")
    return file_fd


def load_session(fd, upload_id):
    try:
        meta_fd = open_regular(fd, upload_id + ".json")
        with os.fdopen(meta_fd) as stream:
            metadata = json.load(stream)
        regular_stat(fd, upload_id + ".part")
        return metadata
    except FileNotFoundError as exc:
        raise HTTPException(404, "업로드 세션이 없습니다.") from exc


@contextmanager
def locked(fd, upload_id):
    try:
        lock_fd = open_regular(fd, upload_id + ".lock", os.O_RDWR)
    except FileNotFoundError as exc:
        raise HTTPException(404, "업로드 세션이 없습니다.") from exc
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise HTTPException(409, "이 업로드가 전송 중입니다. 잠시 후 다시 시도하세요.") from exc
        yield
    finally:
        os.close(lock_fd)


def remove_session(fd, upload_id):
    for suffix in (".part", ".json", ".json.tmp", ".lock"):
        try:
            os.unlink(upload_id + suffix, dir_fd=fd)
        except FileNotFoundError:
            pass


def cleanup_stale_uploads(ttl=STALE_TTL_SECONDS):
    try:
        with staging() as (_, fd):
            ids = {name.split(".")[0] for name in os.listdir(fd) if UPLOAD_ID.fullmatch(name.split(".")[0])}
            for upload_id in ids:
                try:
                    with locked(fd, upload_id):
                        stamps = [os.stat(upload_id + suffix, dir_fd=fd, follow_symlinks=False).st_mtime for suffix in (".part", ".json", ".lock") if _exists(fd, upload_id + suffix)]
                        if stamps and time.time() - max(stamps) > ttl:
                            remove_session(fd, upload_id)
                except (HTTPException, OSError):
                    continue
    except HTTPException as exc:
        if exc.status_code not in (404, 503):
            raise


def _exists(fd, name):
    try:
        os.stat(name, dir_fd=fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


@router.post("", status_code=201)
def create_upload(body: UploadRequest):
    global _last_cleanup
    name, folder = validate_name(body.name), validate_folder(body.folder)
    if body.size <= 0:
        raise HTTPException(400, "빈 파일은 업로드할 수 없습니다.")
    if body.size > MAX_FILE_BYTES:
        raise HTTPException(413, "파일이 업로드 크기 제한을 초과했습니다.")
    with upload_root() as root:
        with target_directory(root, folder):
            pass
        if shutil.disk_usage(INCOMING_UPLOAD).free < body.size + MIN_FREE_HEADROOM_BYTES:
            raise HTTPException(507, "저장 공간이 부족합니다.")
    stamp = time.monotonic()
    if stamp - _last_cleanup >= CLEANUP_INTERVAL_SECONDS:
        cleanup_stale_uploads()
        _last_cleanup = stamp
    upload_id = uuid4().hex
    metadata = {"uploadId": upload_id, "name": name, "folder": folder, "expectedSize": body.size, "lastModifiedMs": body.last_modified_ms}
    with staging(create=True) as (_, fd):
        try:
            for suffix in (".lock", ".part"):
                os.close(os.open(upload_id + suffix, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd))
            temporary = upload_id + ".json.tmp"
            meta_fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600, dir_fd=fd)
            with os.fdopen(meta_fd, "w") as stream:
                json.dump(metadata, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, upload_id + ".json", src_dir_fd=fd, dst_dir_fd=fd)
        except BaseException:
            remove_session(fd, upload_id)
            if _exists(fd, upload_id + ".json.tmp"):
                os.unlink(upload_id + ".json.tmp", dir_fd=fd)
            raise
    return {k: v for k, v in metadata.items() if k != "lastModifiedMs"} | {"receivedBytes": 0, "chunkSize": DEFAULT_CHUNK_BYTES, "maxChunkBytes": MAX_CHUNK_BYTES}


@router.get("/{upload_id}")
def upload_status(upload_id: str):
    validate_id(upload_id)
    with staging() as (_, fd):
        meta = load_session(fd, upload_id)
        return {k: v for k, v in meta.items() if k != "lastModifiedMs"} | {"receivedBytes": regular_stat(fd, upload_id + ".part").st_size}


@router.put("/{upload_id}/chunks")
async def upload_chunk(upload_id: str, request: Request, offset: int):
    validate_id(upload_id)
    if offset < 0:
        raise HTTPException(400, "잘못된 전송 오프셋입니다.")
    with staging() as (_, fd), locked(fd, upload_id):
        meta = load_session(fd, upload_id)
        part_fd = open_regular(fd, upload_id + ".part", os.O_RDWR)
        try:
            current = os.fstat(part_fd).st_size
            if current != offset:
                return JSONResponse({"detail": "전송 오프셋이 일치하지 않습니다.", "expectedOffset": current}, status_code=409, headers=UPLOAD_HEADERS)
            received = 0
            os.lseek(part_fd, offset, os.SEEK_SET)
            try:
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > MAX_CHUNK_BYTES:
                        raise HTTPException(413, "청크 크기가 제한을 초과했습니다.")
                    if offset + received > meta["expectedSize"]:
                        raise HTTPException(400, "예상 파일 크기를 초과했습니다.")
                    remaining = memoryview(chunk)
                    while remaining:
                        written = os.write(part_fd, remaining)
                        remaining = remaining[written:]
                if not received:
                    raise HTTPException(400, "빈 청크는 전송할 수 없습니다.")
            except BaseException:
                os.ftruncate(part_fd, offset)
                raise
            return {"uploadId": upload_id, "receivedBytes": offset + received, "expectedSize": meta["expectedSize"]}
        finally:
            os.close(part_fd)


@router.post("/{upload_id}/complete", status_code=201)
def complete_upload(upload_id: str):
    validate_id(upload_id)
    with staging() as (root, fd), locked(fd, upload_id):
        meta = load_session(fd, upload_id)
        name, folder = validate_name(meta["name"]), validate_folder(meta["folder"])
        part_name = upload_id + ".part"
        part_fd = open_regular(fd, part_name, os.O_RDWR)
        try:
            info = os.fstat(part_fd)
            if info.st_size != meta["expectedSize"]:
                raise HTTPException(409, "전송이 완료되지 않았습니다.")
            modified = meta.get("lastModifiedMs")
            if isinstance(modified, int) and 315532800000 <= modified <= int(time.time() * 1000) + 86_400_000:
                os.utime(part_fd, ns=(modified * 1_000_000, modified * 1_000_000))
            os.fsync(part_fd)
            with target_directory(root, folder, create=True) as target:
                # Serialize case-insensitive name selection across upload sessions.
                fcntl.flock(target, fcntl.LOCK_EX)
                existing = {unicodedata.normalize("NFC", entry).casefold() for entry in os.listdir(target)}
                stem, suffix = Path(name).stem, Path(name).suffix
                for number in range(10000):
                    candidate = name if number == 0 else f"{stem} ({number}){suffix}"
                    if unicodedata.normalize("NFC", candidate).casefold() in existing:
                        continue
                    try:
                        rename_noreplace(fd, part_name, target, candidate)
                        break
                    except FileExistsError:
                        continue
                else:
                    raise HTTPException(409, "같은 이름의 파일이 너무 많습니다.")
                os.fsync(target)
            info = os.fstat(part_fd)
        finally:
            os.close(part_fd)
        remove_session(fd, upload_id)
        extension = Path(name).suffix.lower()
        return {"path": "/".join(filter(None, (folder, candidate))), "name": candidate, "folder": folder, "originalName": name, "renamed": candidate != name, "sizeBytes": info.st_size, "kind": "companion" if extension in COMPANION_EXTENSIONS else "video" if extension in VIDEOS else "photo", "modifiedAt": iso_time(info.st_mtime)}


@router.delete("/{upload_id}")
def cancel_upload(upload_id: str):
    validate_id(upload_id)
    try:
        with staging() as (_, fd):
            if _exists(fd, upload_id + ".lock"):
                with locked(fd, upload_id):
                    remove_session(fd, upload_id)
            else:
                remove_session(fd, upload_id)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
    return {"cancelled": True}
