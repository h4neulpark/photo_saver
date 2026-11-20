import ctypes
import hashlib
import json
import os
import stat
import subprocess
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from zoneinfo import ZoneInfo

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from catalog import DEFAULT_ZONE, PHOTOS, THUMBNAILS

register_heif_opener()
VIDEOS = {".mp4", ".mov"}
SUPPORTED = PHOTOS | VIDEOS
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
RENAME_NOREPLACE = 1

_libc = ctypes.CDLL(None, use_errno=True)
_renameat2 = _libc.renameat2
_renameat2.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
_renameat2.restype = ctypes.c_int


def relative_parts(relative):
    parts = relative.split("/")
    if any(part in ("", ".", "..") or "\0" in part for part in parts):
        raise ValueError("잘못된 파일 경로입니다.")
    return parts


@contextmanager
def directory(root, parts=()):
    fd = os.open(root, DIRECTORY_FLAGS)
    try:
        for part in parts:
            next_fd = os.open(part, DIRECTORY_FLAGS, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        yield fd
    finally:
        os.close(fd)


@contextmanager
def parent_directory(root, path):
    *parts, name = relative_parts(path)
    with directory(root, parts) as fd:
        yield fd, name


def fingerprint(info):
    return json.dumps((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns))


def regular_stat(parent, name):
    info = os.stat(name, dir_fd=parent, follow_symlinks=False)
    if not stat.S_ISREG(info.st_mode):
        raise OSError("일반 파일만 처리할 수 있습니다.")
    return info


def inspect(root, path):
    with parent_directory(root, path) as (parent, name):
        return regular_stat(parent, name)


@contextmanager
def regular_file(root, path, *, expected=None, recheck=True):
    with parent_directory(root, path) as (parent, name):
        fd = os.open(name, FILE_FLAGS, dir_fd=parent)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            snapshot = fingerprint(info)
            if snapshot != fingerprint(regular_stat(parent, name)) or (expected and snapshot != expected):
                raise OSError("파일 상태가 변경되었습니다.")
            yield stream, info
            if recheck:
                after = os.fstat(stream.fileno())
                if snapshot != fingerprint(after) or snapshot != fingerprint(regular_stat(parent, name)):
                    raise OSError("파일 상태가 변경되었습니다.")


def hash_file(root, path, expected=None):
    with regular_file(root, path, expected=expected) as (stream, info):
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return digest, info


def move_file(incoming, source, managed, target, expected, *, create_parent=True):
    if create_parent:
        parent_name, _ = relative_parts(target)
        with directory(managed) as managed_fd:
            try:
                os.mkdir(parent_name, dir_fd=managed_fd)
            except FileExistsError:
                pass
    with parent_directory(incoming, source) as (source_fd, source_name):
        with parent_directory(managed, target) as (target_fd, target_name):
            if fingerprint(regular_stat(source_fd, source_name)) != expected:
                raise OSError("검사 후 파일 상태가 변경되었습니다.")
            if _renameat2(source_fd, os.fsencode(source_name), target_fd, os.fsencode(target_name), RENAME_NOREPLACE):
                error = ctypes.get_errno()
                raise OSError(error, os.strerror(error), target)


def delete_photo(incoming, path, expected):
    if not expected or Path(path).suffix.lower() not in PHOTOS:
        raise OSError("검사한 사진만 삭제할 수 있습니다.")
    delete_verified_file(incoming, path, expected)


def delete_verified_file(incoming, path, expected):
    with parent_directory(incoming, path) as (fd, name):
        if fingerprint(regular_stat(fd, name)) != expected:
            raise OSError("검사 이후 파일이 변경되었습니다. 새로 고침이 필요합니다.")
        os.unlink(name, dir_fd=fd)


def scan_tree(root, extensions=SUPPORTED):
    def fail(error):
        raise error

    for path, dirs, names, dir_fd in os.fwalk(root, onerror=fail, follow_symlinks=False):
        dirs[:] = sorted(name for name in dirs if not name.startswith("."))
        for name in sorted(names):
            if name.startswith(".") or Path(name).suffix.lower() not in extensions:
                continue
            relative = Path(path, name).relative_to(root).as_posix()
            try:
                info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
            except OSError:
                yield relative, None
                continue
            if stat.S_ISREG(info.st_mode):
                yield relative, info


def iso_time(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()


def modified_time_from_fingerprint(snapshot):
    _, _, _, modified_ns, _ = json.loads(snapshot)
    return iso_time(modified_ns / 1_000_000_000)


def parse_capture_datetime(raw, offset=None):
    if not raw:
        return None
    value = str(raw).strip()
    if len(value) >= 10 and value[4] == ":" and value[7] == ":":
        value = value[:10].replace(":", "-") + value[10:]
    if offset and len(value) == 19:
        value += str(offset).strip()
    try:
        captured = datetime.fromisoformat(value)
    except ValueError:
        return None
    # QuickTime's epoch and old placeholder years cannot establish a recording date.
    if captured.year < 1980:
        return None
    return captured


def capture_time(raw, offset=None, *, assumed_zone=DEFAULT_ZONE):
    captured = parse_capture_datetime(raw, offset)
    if captured is None:
        return None, False
    verified = captured.tzinfo is not None
    if not verified:
        captured = captured.replace(tzinfo=ZoneInfo(assumed_zone))
    return captured.astimezone(timezone.utc).isoformat(), verified


def image_metadata(stream, thumbnail):
    with Image.open(stream) as image:
        exif = image.getexif()
        tags = {**exif, **exif.get_ifd(34665)}
        raw_time = tags.get(36867) or tags.get(36868) or tags.get(306)
        offset_tag = 36881 if tags.get(36867) else 36882 if tags.get(36868) else 36880
        captured, verified = capture_time(raw_time, tags.get(offset_tag))
        details = {
            "width": image.width, "height": image.height, "format": image.format,
            "make": str(tags.get(271) or ""), "model": str(tags.get(272) or ""),
            "raw_time": str(raw_time or ""),
        }
        try:
            if thumbnail:
                save_image_preview(image, thumbnail, (360, 240))
        except (OSError, ValueError):
            thumbnail.unlink(missing_ok=True)
        return details, captured, verified, "EXIF"


def save_image_preview(image, destination, bounds):
    upright = ImageOps.exif_transpose(image)
    upright.thumbnail(bounds, Image.Resampling.LANCZOS)
    upright.convert("RGB").save(destination, format="JPEG", quality=84)


def video_metadata(stream, thumbnail):
    input_path = f"/proc/self/fd/{stream.fileno()}"
    options = {"pass_fds": (stream.fileno(),), "capture_output": True, "check": True}
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-protocol_whitelist", "file", "-f", "mov", "-of", "json",
         "-show_format", "-show_streams", input_path],
        timeout=45, **options,
    )
    info = json.loads(probe.stdout)
    video = next((item for item in info.get("streams", [])
                  if item.get("codec_type") == "video" and not item.get("disposition", {}).get("attached_pic")), {})
    container = info.get("format", {})
    tags = {key.lower(): value for key, value in {**video.get("tags", {}), **container.get("tags", {})}.items()}
    raw_time = tags.get("com.apple.quicktime.creationdate") or tags.get("creation_time")
    captured, verified = capture_time(raw_time)
    details = {
        "width": video.get("width"), "height": video.get("height"),
        "codec": video.get("codec_name"), "duration": container.get("duration"),
        "make": tags.get("com.apple.quicktime.make") or tags.get("make", ""),
        "model": tags.get("com.apple.quicktime.model") or tags.get("model", ""),
        "raw_time": raw_time or "",
    }
    if video and thumbnail:
        try:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-nostdin", "-protocol_whitelist", "file", "-f", "mov",
                 "-i", input_path, "-map", f"0:{video['index']}", "-frames:v", "1",
                 "-vf", "scale=360:240:force_original_aspect_ratio=decrease",
                 "-threads", "1", "-y", str(thumbnail)],
                timeout=60, **options,
            )
        except (subprocess.SubprocessError, OSError):
            thumbnail.unlink(missing_ok=True)
    return details, captured, verified, "영상 메타데이터"


def thumbnail_path(sha):
    return THUMBNAILS / f"{sha}-v1.jpg"


def preview_thumbnail(root, path, sha, expected):
    cached = thumbnail_path(sha)
    if cached.is_file():
        return cached.name
    return analyze(root, path, sha, expected)[2]


def analyze(root, path, sha, expected):
    kind = "photo" if Path(path).suffix.lower() in PHOTOS else "video"
    destination = thumbnail_path(sha)
    temporary = THUMBNAILS / f".{uuid4().hex}.jpg"
    thumbnail = None if destination.is_file() else temporary
    try:
        with regular_file(root, path, expected=expected) as (stream, info):
            try:
                extract = image_metadata if kind == "photo" else video_metadata
                details, captured, verified, source = extract(stream, thumbnail)
            except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, subprocess.SubprocessError):
                temporary.unlink(missing_ok=True)
                details, captured, verified, source = {"error": "메타데이터를 읽을 수 없습니다."}, None, False, ""
        if temporary.is_file():
            os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    if not captured:
        captured, source = iso_time(info.st_mtime), "파일 수정 시각"
    parts = [str(details[key]).strip() for key in ("make", "model") if details.get(key)]
    device = " ".join(dict.fromkeys(parts))
    if len(parts) == 2 and parts[1].casefold().startswith(parts[0].casefold()):
        device = parts[1]
    return kind, details, destination.name if destination.is_file() else None, captured, source, verified, device or None
