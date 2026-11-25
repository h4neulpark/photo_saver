import errno
import hashlib
import json
import logging
import re
import sqlite3
import unicodedata
import uploads
import thumbnails
from contextlib import ExitStack, asynccontextmanager
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Literal
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image
from pydantic import BaseModel, Field
from starlette.datastructures import Headers, MutableHeaders

from catalog import LANE_LOCAL, active_jobs_by_lane, latest_jobs_by_lane, active_offload_media_ids, DEFAULT_ZONE, PHOTOS, backfill_remote_files, database, initialize, load_latest_scan, now, queue_job
from media import VIDEOS, capture_time, modified_time_from_fingerprint, parse_capture_datetime, regular_file, save_image_preview
from settings import NO_STORE, ensure_storage_id, router as settings_router
from archive import active_storage_scope, router as archive_router
from transfers import RemoteDuplicateError, TransferRequest, queue_transfer
from offload import OffloadRequest, queue_offload
from remote_index import RemoteIndexRequest, queue_remote_index
from incoming_cleanup import plan_duplicate_cleanup, queue_duplicate_cleanup
from records import router as records_router
from devices import router as devices_router, device_names, effective_device, device_sql, device_folder


@asynccontextmanager
async def lifespan(_app):
    ZoneInfo(DEFAULT_ZONE)
    initialize()
    storage_id = ensure_storage_id()
    with database(write=True) as db:
        backfill_remote_files(db, storage_id)
    try:
        await run_in_threadpool(uploads.cleanup_stale_uploads)
    except Exception:
        logging.getLogger(__name__).exception("업로드 임시 파일 정리에 실패했습니다.")
    yield


app = FastAPI(lifespan=lifespan)
app.include_router(settings_router)
app.include_router(archive_router)
app.include_router(records_router)
app.include_router(devices_router)
app.include_router(uploads.router)


@app.exception_handler(RemoteDuplicateError)
async def handle_remote_duplicate(_request, exc):
    return JSONResponse(
        {
            "detail": exc.detail, "code": "remote_duplicate",
            "duplicates": exc.duplicates, "duplicateIds": exc.duplicate_ids, "newCount": exc.new_count,
        },
        status_code=exc.status_code,
    )


def reset_in_progress():
    with database() as db:
        return db.execute("SELECT 1 FROM jobs WHERE lane='exclusive' AND status IN ('queued','running')").fetchone() is not None


@app.middleware("http")
async def guard_reset(request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and await run_in_threadpool(reset_in_progress):
        response = JSONResponse({"detail": "데이터 초기화 중입니다. 완료 후 다시 시도하세요."}, status_code=409)
    else:
        response = await call_next(request)
    if request.url.path.startswith("/api/incoming/uploads"):
        response.headers.update(uploads.UPLOAD_HEADERS)
    return response


logger = logging.getLogger(__name__)
unsafe_component = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')
INCOMING_PREVIEW = Path("/incoming-preview")
MANAGED_PREVIEW = Path("/managed-preview")
MEDIA_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
    ".heic": "image/heic", ".heif": "image/heif", ".mp4": "video/mp4", ".mov": "video/quicktime",
}
MEDIA_HEADERS = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
SINGLE_RANGE_RE = re.compile(r"^\s*bytes\s*=\s*(?:(?P<start>\d+)-(?P<end>\d*)|-(?P<suffix>\d+))\s*$", re.IGNORECASE)
MAX_RANGE_DIGITS = 32
MAX_RANGE_TOKEN_LEN = 64
STALE_PREVIEW = "파일이 변경되었거나 이동했습니다. Incoming Library에서 다시 검사하세요."
INCOMING_HEIF_ERROR = "사진을 미리 볼 수 없습니다. 다시 검사하거나 원본 파일을 확인하세요."
MANAGED_UNAVAILABLE = "로컬 원본을 미리 볼 수 없습니다."
MANAGED_NOT_FOUND = "로컬 원본을 찾을 수 없습니다."
MANAGED_PERMISSION_DENIED = "로컬 원본의 읽기 권한을 확인하세요."
MANAGED_STALE_PREVIEW = "로컬 원본이 변경되었습니다. 원본을 확인한 뒤 Incoming Library에서 다시 검사하세요."
MANAGED_ACCESS_ERROR = "로컬 원본을 읽을 수 없습니다. 원본을 확인한 뒤 Incoming Library에서 다시 검사하세요."
MANAGED_UNSUPPORTED = "미리보기를 지원하지 않는 파일 형식입니다."
MANAGED_HEIF_ERROR = "사진을 미리 볼 수 없습니다. 원본을 확인한 뒤 다시 검사하거나 원본 파일을 열어 확인하세요."
MANAGED_RANGE_ERROR = "단일 바이트 범위 요청만 지원합니다."
MANAGED_RANGE_UNSATISFIABLE = "요청한 바이트 범위가 파일 크기를 벗어났습니다."


class Selection(BaseModel):
    ids: list[str] = Field(min_length=1)


class DuplicateCleanupItem(BaseModel):
    id: str
    keeperKind: Literal["managed", "remote", "incoming"]
    keeperId: str


class DuplicateCleanupSelection(BaseModel):
    items: list[DuplicateCleanupItem] = Field(min_length=1)


class EventFields(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    start: date | None = None
    end: date | None = None
    zone: str = DEFAULT_ZONE


class NewEvent(EventFields):
    parent_id: str | None = None


class Assignment(Selection):
    event_id: str


class MediaEdit(Selection):
    device: str | None = Field(default=None, max_length=80)
    captured_at: datetime | None = None
    time_mode: Literal["metadata", "modified", "xmp"] | None = None
    skip_missing_xmp: bool = False
    zone: str = DEFAULT_ZONE


class XmpLink(BaseModel):
    id: str
    media_id: str


class XmpSelection(BaseModel):
    links: list[XmpLink] = Field(min_length=1)


def error(status, detail):
    raise HTTPException(status_code=status, detail=detail)


def path_key(value):
    return unicodedata.normalize("NFC", value).casefold()


def clean_component(value):
    name = value.strip()
    if name in {"", ".", ".."} or unsafe_component.search(name):
        error(400, "폴더명에 사용할 수 있는 이름을 입력하세요.")
    return unicodedata.normalize("NFC", name)


def zone_for(name):
    try:
        return ZoneInfo(name)
    except (ValueError, ZoneInfoNotFoundError):
        error(400, "유효한 시간대를 선택하세요.")


def display_size(size):
    return size / 1_000_000 if size is not None else None


def view_event(row):
    return {
        "id": row["id"], "name": row["name"], "folder": row["folder"], "parent": row["parent_id"],
        "start": row["start"], "end": row["end"], "zone": row["zone"],
    }


def metadata_time(row, metadata):
    if row["time_source"] not in {"EXIF", "영상 메타데이터"} or not row["capture_time"]:
        return None
    return {
        "source": row["time_source"], "time": row["capture_time"],
        "raw": metadata.get("raw_time"), "verified": bool(row["time_verified"]),
    }


def time_label(row):
    if not row["user_time"]:
        return row["time_source"]
    if row["user_time_source"] == "metadata":
        return f"{row['time_source']} · 사용자 확인"
    if row["user_time_source"] == "modified":
        return "파일 수정 시각 · 사용자 확인"
    if row["user_time_source"] == "xmp":
        return "XMP · 사용자 확인"
    return "사용자 지정"


def xmp_time(xmp):
    return {**xmp["date"], "source": "XMP"} if xmp.get("date") else None


def capture_for_event(row, metadata, xmp):
    if row["user_time"]:
        return row["user_time"], time_label(row), True, None
    embedded = metadata_time(row, metadata)
    sidecar = xmp_time(xmp)
    if sidecar and not embedded:
        return sidecar["time"], "XMP", sidecar["verified"], None
    if sidecar and embedded and sidecar["verified"]:
        if embedded["verified"]:
            first = parse_capture_datetime(embedded["time"])
            second = parse_capture_datetime(sidecar["time"])
        else:
            first = parse_capture_datetime(embedded["raw"])
            second = parse_capture_datetime(sidecar["raw"])
            if first and second:
                first, second = first.replace(tzinfo=None), second.replace(tzinfo=None)
        if first and second and first.replace(microsecond=0) == second.replace(microsecond=0):
            if not embedded["verified"]:
                return sidecar["time"], "XMP · 시간대 보완", True, None
        else:
            return embedded["time"], embedded["source"], False, "원본과 XMP 시각 불일치"
    return row["capture_time"], row["time_source"], bool(row["time_verified"]), None


def remote_copies_by_sha(db):
    copies = {}
    for row in db.execute(
        """SELECT storage_id, path, archive_root, sha, size, verified_at, last_seen_at
           FROM remote_files WHERE status='present' AND sha IS NOT NULL
           ORDER BY coalesce(verified_at, last_seen_at) DESC, path"""
    ):
        copies.setdefault(row["sha"], []).append(dict(row))
    return copies


def managed_media_type(path, kind):
    suffix = PurePosixPath(path).suffix.lower()
    media_type = MEDIA_TYPES.get(suffix)
    if not media_type:
        return None
    if kind == "photo" and suffix in PHOTOS:
        return media_type
    if kind == "video" and suffix in VIDEOS:
        return media_type
    return None


def view_media(row, periods, names=None, remote_index=None, active_scope=(None, None)):
    device = effective_device(row, names or {})
    metadata = json.loads(row["metadata"])
    xmp = json.loads(row["xmp_metadata"] or "{}")
    stamp, source, verified, review_reason = capture_for_event(row, metadata, xmp)
    if row["event_id"] is None:
        if not stamp or not verified:
            review_reason = review_reason or "촬영 시각 확인 필요"
        elif len(matching_events(stamp, periods)) > 1:
            review_reason = "이벤트 기간 중복"
    remote_index = remote_index or {}
    active_storage_id, active_root = active_scope
    all_copies = remote_index.get(row["sha"], [])
    active_copies = [item for item in all_copies if active_root and item["archive_root"] == active_root]
    active_copies.sort(key=lambda item: (item["storage_id"] != active_storage_id,))
    xmp_copies = remote_index.get(row["xmp_sha"], []) if row["xmp_sha"] else []
    xmp_active = [item for item in xmp_copies if active_root and item["archive_root"] == active_root]
    xmp_archived = True if not row["xmp_path"] else bool(xmp_active)
    can_preview = (
        row["status"] == "available"
        and bool(row["fingerprint"])
        and managed_media_type(row["path"], row["kind"]) is not None
    )
    return {
        "id": row["id"], "name": row["name"], "path": row["path"], "kind": row["kind"],
        "status": row["status"],
        "size": display_size(row["size"]), "device": device, "deviceFolder": device_folder(device),
        "time": stamp, "timeVerified": verified, "reviewReason": review_reason,
        "timeSource": source,
        "timeCandidates": {
            "metadata": metadata_time(row, metadata),
            "xmp": xmp_time(xmp),
            "modified": modified_time_from_fingerprint(row["fingerprint"]) if row["fingerprint"] else None,
        },
        "eventId": row["event_id"], "confirmed": bool(row["confirmed"]),
        "archived": bool(all_copies),
        "canDownload": bool(active_copies),
        "canOffload": row["status"] == "available" and bool(active_copies) and xmp_archived,
        "xmpArchived": xmp_archived,
        "remotePaths": [item["path"] for item in active_copies],
        "thumbnail": f"/thumbnails/{row['thumbnail']}" if row["thumbnail"] else None,
        "preview": f"/api/managed/{row['id']}/preview" if can_preview else None,
        "original": f"/api/managed/{row['id']}/original" if can_preview else None,
        "analysisError": metadata.get("error"),
        "xmp": {**xmp, "name": PurePosixPath(row["xmp_path"]).name} if row["xmp_path"] else None,
    }


def view_duplicate_source(row):
    if row["status"] != "duplicate":
        return None
    reason = row["reason"]
    for kind, prefix, suffix in (
        ("managed", "managed의 ", "와 동일"),
        ("remote", "원격 아카이브의 ", "에 이미 보관됨"),
        ("incoming", "이번 검사의 ", "와 동일"),
    ):
        if reason.startswith(prefix) and reason.endswith(suffix):
            return {"kind": kind, "path": reason[len(prefix):-len(suffix)]}
    return None


def view_scan_companion(item, status):
    kind = item.get("kind") or PurePosixPath(item["path"]).suffix.lower().lstrip(".")
    disposition = item.get("disposition")
    reason = item.get("reason", "")
    if not disposition:
        disposition = "keep"
        if status == "ready":
            disposition = "move" if kind == "xmp" else "delete-after-move"
    elif status != "ready" and disposition in {"move", "delete-after-move"}:
        disposition = "keep"
        reason = "원본이 이동 대상이 아니므로 동반 파일을 보존합니다."
    return {
        "path": item["path"], "kind": kind, "disposition": disposition,
        "reason": reason, "pendingId": item.get("pendingId"),
    }


def view_scan_file(row):
    path = PurePosixPath(row["path"])
    companions = json.loads(row["companions"])
    xmp = next((item for item in companions if item.get("metadata") is not None), None)
    companion_views = [view_scan_companion(item, row["status"]) for item in companions]
    return {
        "id": row["id"], "path": row["path"], "name": path.name,
        "folder": "" if str(path.parent) == "." else str(path.parent),
        "kind": "photo" if path.suffix.lower() in PHOTOS else "video",
        "modifiedAt": row["modified_at"], "size": display_size(row["size"]),
        "thumbnail": f"/thumbnails/{row['thumbnail']}" if row["thumbnail"] else None,
        "preview": f"/api/incoming/{row['id']}/preview" if row["status"] in {"ready", "duplicate"} else None,
        "original": f"/api/incoming/{row['id']}/original" if row["status"] in {"ready", "duplicate"} else None,
        "status": row["status"], "reason": row["reason"], "duplicateSource": view_duplicate_source(row),
        "xmp": {**xmp["metadata"], "name": PurePosixPath(xmp["path"]).name} if xmp else None,
        "cameraAuxCount": sum(item["disposition"] == "delete-after-move" for item in companion_views),
        "companions": companion_views,
    }


def view_pending_xmp(row, available):
    sidecar = json.loads(row["file"])
    targets = [available[media_id] for media_id in json.loads(row["candidates"]) if media_id in available]
    return {
        "id": row["id"], "path": sidecar["path"], "date": sidecar["metadata"].get("date"),
        "status": row["status"], "reason": row["reason"], "recommended": sidecar.get("recommended"),
        "candidates": [{"id": target["id"], "name": target["name"], "kind": target["kind"],
                        "originalPath": target["original_path"]} for target in targets],
    }


def view_job(row):
    if not row:
        return None
    try:
        result = json.loads(row["result"])
    except (TypeError, json.JSONDecodeError):
        result = {}
    if not isinstance(result, dict):
        result = {}
    return {
        "id": row["id"], "kind": row["kind"], "lane": row["lane"], "status": row["status"],
        "createdAt": row["created_at"], "finishedAt": row["finished_at"], "result": result,
    }


MAX_JOB_RESULT_LIST = 100
# CASE also guards aggregate expressions: SQLite need not short-circuit AND.
JOB_ATTENTION_SQL = """(
    status IN ('failed', 'cancelled') OR (
        json_valid(result) AND CASE WHEN json_valid(result) THEN (
            coalesce(json_extract(result, '$.error'), '') <> ''
            OR coalesce(CAST(json_extract(result, '$.failed') AS INTEGER), 0) > 0
            OR coalesce(CAST(json_extract(result, '$.review') AS INTEGER), 0) > 0
            OR coalesce(CAST(json_extract(result, '$.companionReview') AS INTEGER), 0) > 0
        ) ELSE 0 END
    )
)"""


def job_has_attention(status, result):
    if status in {"queued", "running"}:
        return False
    return (status in {"failed", "cancelled"} or bool(result.get("error"))
            or (result.get("failed") or 0) > 0 or (result.get("review") or 0) > 0
            or (result.get("companionReview") or 0) > 0)


def job_history_entry(row):
    job = view_job(row)
    result = job["result"].copy()
    meta = {}
    for name in ("items", "errors", "unmatchedCompanions"):
        values = result.get(name)
        total = len(values) if isinstance(values, list) else 0
        if total > MAX_JOB_RESULT_LIST:
            if name == "items":
                def attention(item):
                    return not isinstance(item, dict) or item.get("status") not in {"moved", "deleted", "cleaned", "linked", "generated", "reused"}
                values = [item for item in values if attention(item)] + [item for item in values if not attention(item)]
            result[name] = values[:MAX_JOB_RESULT_LIST]
        meta.update({f"{name}Total": total, f"{name}Shown": min(total, MAX_JOB_RESULT_LIST),
                     f"{name}Truncated": total > MAX_JOB_RESULT_LIST})
    job.update(result=result, resultMeta=meta, hasAttention=job_has_attention(job["status"], result))
    return job


@app.get("/api/jobs")
def job_history(
    limit: int = Query(default=30, ge=1, le=100),
    before_id: int | None = Query(default=None, ge=1),
    lane: Literal["all", "local", "remote", "exclusive"] = "all",
    status: Literal["all", "active", "attention", "done", "failed", "cancelled"] = "all",
    kind: Literal["all", "scan", "move", "delete", "duplicate-cleanup", "xmp-link", "upload", "offload", "remote-index", "reset-all", "thumbnails-local", "thumbnails-remote"] = "all",
):
    clauses, params = [], []
    if before_id is not None:
        clauses.append("id < ?")
        params.append(before_id)
    for column, value in (("lane", lane), ("kind", kind)):
        if value != "all":
            clauses.append(f"{column} = ?")
            params.append(value)
    if status == "active":
        clauses.append("status IN ('queued', 'running')")
    elif status == "attention":
        clauses.append(f"status NOT IN ('queued', 'running') AND {JOB_ATTENTION_SQL}")
    elif status != "all":
        clauses.append("status = ?")
        params.append(status)
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with database() as db:
        rows = db.execute(
            "SELECT id, kind, lane, status, result, created_at, finished_at FROM jobs"
            + where + " ORDER BY id DESC LIMIT ?", (*params, limit + 1),
        ).fetchall()
        summary = dict(db.execute(f"""SELECT count(*) AS total,
            coalesce(sum(status IN ('queued', 'running')), 0) AS active,
            coalesce(sum(status NOT IN ('queued', 'running') AND {JOB_ATTENTION_SQL}), 0) AS attention,
            coalesce(sum(status = 'done'), 0) AS done FROM jobs""").fetchone())
    has_more = len(rows) > limit
    page_rows = rows[:limit]
    return JSONResponse({"jobs": [job_history_entry(row) for row in page_rows],
                         "nextBeforeId": page_rows[-1]["id"] if has_more else None,
                         "hasMore": has_more, "summary": summary}, headers=NO_STORE)


@app.get("/api/health")
def health():
    return {"status": "ok"}


class MediaJSONResponse(JSONResponse):
    def __init__(self, content, status_code=200, headers=None):
        super().__init__(content, status_code=status_code, headers={**MEDIA_HEADERS, **(headers or {})})

    async def __call__(self, scope, receive, send):
        await send({"type": "http.response.start", "status": self.status_code, "headers": self.raw_headers})
        body = b"" if scope.get("method") == "HEAD" else self.body
        await send({"type": "http.response.body", "body": body})


def fingerprint_etag(snapshot):
    return f'"{hashlib.sha256(snapshot.encode("utf-8")).hexdigest()}"'


def classify_incoming_access_error(_exc):
    return 409, STALE_PREVIEW


def classify_incoming_heif_error(_exc):
    return 409, INCOMING_HEIF_ERROR


def classify_managed_access_error(exc):
    if isinstance(exc, (ValueError, FileNotFoundError)) or getattr(exc, "errno", None) in {
        errno.ENOENT, errno.ELOOP, errno.ENOTDIR,
    }:
        return 404, MANAGED_NOT_FOUND
    if isinstance(exc, PermissionError) or getattr(exc, "errno", None) in {errno.EACCES, errno.EPERM}:
        return 403, MANAGED_PERMISSION_DENIED
    if isinstance(exc, OSError) and exc.errno is None and str(exc) == "파일 상태가 변경되었습니다.":
        return 409, MANAGED_STALE_PREVIEW
    logger.warning("Managed media access failed: %s", exc)
    return 409, MANAGED_ACCESS_ERROR


def incoming_for_preview(file_id):
    with database() as db:
        scan = load_latest_scan(db)
        row = db.execute(
            "SELECT path, fingerprint FROM scan_files WHERE scan_id=? AND id=? AND status IN ('ready','duplicate')",
            (scan["id"], file_id),
        ).fetchone() if scan else None
    if not row or not row["fingerprint"]:
        error(404, STALE_PREVIEW)
    return row


def managed_for_preview(file_id):
    with database() as db:
        row = db.execute(
            "SELECT id, path, name, kind, status, fingerprint FROM media WHERE id=?",
            (file_id,),
        ).fetchone()
    if not row or row["status"] != "available" or not row["fingerprint"]:
        return None, None, (404, MANAGED_UNAVAILABLE)
    media_type = managed_media_type(row["path"], row["kind"])
    if not media_type:
        return None, None, (415, MANAGED_UNSUPPORTED)
    return row, media_type, None


def parse_range_uint(token: str) -> int | None:
    if len(token) > MAX_RANGE_TOKEN_LEN:
        return None
    stripped = token.lstrip("0")
    if not stripped:
        return 0
    if len(stripped) > MAX_RANGE_DIGITS:
        return None
    try:
        return int(stripped)
    except ValueError:
        return None


def parse_single_byte_range(range_headers: list[str], file_size: int):
    if len(range_headers) != 1 or "," in range_headers[0]:
        return "bad", None
    match = SINGLE_RANGE_RE.match(range_headers[0])
    if not match:
        return "bad", None
    suffix_str = match.group("suffix")
    if suffix_str is not None:
        suffix = parse_range_uint(suffix_str)
        if suffix is None:
            return "bad", None
        if file_size <= 0 or suffix <= 0:
            return "unsatisfiable", None
        return "ok", (max(0, file_size - suffix), file_size - 1)
    start = parse_range_uint(match.group("start"))
    if start is None:
        return "bad", None
    end_str = match.group("end")
    if end_str:
        end = parse_range_uint(end_str)
        if end is None or end < start:
            return "bad", None
        if file_size <= 0 or start >= file_size:
            return "unsatisfiable", None
        return "ok", (start, min(end, file_size - 1))
    if file_size <= 0 or start >= file_size:
        return "unsatisfiable", None
    return "ok", (start, file_size - 1)


class VerifiedOriginal(Response):
    def __init__(self, root, row, media_type, *, error_classifier, range_policy="default", etag=None):
        super().__init__(media_type=media_type)
        self.root = root
        self.row = row
        self.error_classifier = error_classifier
        self.range_policy = range_policy
        self.etag = etag

    async def __call__(self, scope, receive, send):
        is_head = scope.get("method") == "HEAD"
        file_size = None
        head_body_sent = False

        async def wrapped_send(message):
            nonlocal head_body_sent
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=list(message.get("headers", [])))
                for key, value in MEDIA_HEADERS.items():
                    headers[key] = value
                if message.get("status") == 416:
                    content_range = headers.get("content-range")
                    if content_range and not content_range.lower().startswith("bytes "):
                        headers["content-range"] = f"bytes {content_range}"
                    elif not content_range and file_size is not None:
                        headers["content-range"] = f"bytes */{file_size}"
                await send({**message, "headers": headers.raw})
                return
            if message["type"] == "http.response.body" and is_head:
                if head_body_sent:
                    return
                head_body_sent = True
                await send({**message, "body": b"", "more_body": False})
                return
            await send(message)

        with ExitStack() as stack:
            try:
                stream, info = stack.enter_context(regular_file(
                    self.root, self.row["path"], expected=self.row["fingerprint"], recheck=False,
                ))
            except (OSError, ValueError) as exc:
                status, detail = self.error_classifier(exc)
                await JSONResponse({"detail": detail}, status_code=status)(scope, receive, wrapped_send)
                return
            file_size = info.st_size
            # Keep the verified descriptor open while FileResponse handles HTTP range requests.
            response_headers = dict(MEDIA_HEADERS)
            if self.etag is not None:
                response_headers["ETag"] = self.etag
            response = FileResponse(
                f"/proc/self/fd/{stream.fileno()}", stat_result=info, media_type=self.media_type,
                filename=PurePosixPath(self.row["path"]).name, content_disposition_type="inline",
                headers=response_headers,
            )
            call_scope = scope
            if self.range_policy == "single":
                req_headers = Headers(scope=scope)
                range_headers = req_headers.getlist("range")
                if range_headers:
                    if_range = req_headers.get("if-range")
                    if if_range is not None and if_range not in {
                        response.headers.get("etag"), response.headers.get("last-modified"),
                    }:
                        call_scope = {
                            **scope,
                            "headers": [(k, v) for k, v in scope.get("headers", []) if k.lower() != b"range"],
                        }
                    else:
                        kind, bounds = parse_single_byte_range(range_headers, file_size)
                        if kind == "bad":
                            await JSONResponse({"detail": MANAGED_RANGE_ERROR}, status_code=400)(scope, receive, wrapped_send)
                            return
                        if kind == "unsatisfiable":
                            await JSONResponse(
                                {"detail": MANAGED_RANGE_UNSATISFIABLE}, status_code=416,
                                headers={"Content-Range": f"bytes */{file_size}"},
                            )(scope, receive, wrapped_send)
                            return
                        start, end = bounds
                        filtered = [(k, v) for k, v in scope.get("headers", []) if k.lower() != b"range"]
                        filtered.append((b"range", f"bytes={start}-{end}".encode("ascii")))
                        call_scope = {**scope, "headers": filtered}
            await response(call_scope, receive, wrapped_send)


class IncomingOriginal(VerifiedOriginal):
    def __init__(self, row, media_type):
        super().__init__(
            INCOMING_PREVIEW, row, media_type,
            error_classifier=classify_incoming_access_error,
            range_policy="default",
        )


def render_heif_preview(root, row, *, error_classifier, decode_error_detail):
    preview = BytesIO()
    try:
        with regular_file(root, row["path"], expected=row["fingerprint"]) as (stream, _):
            try:
                with Image.open(stream) as image:
                    save_image_preview(image, preview, (2200, 2200))
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                logger.warning("HEIF preview conversion failed: %s", exc)
                return MediaJSONResponse({"detail": decode_error_detail}, status_code=409)
    except (OSError, ValueError) as exc:
        status, detail = error_classifier(exc)
        return MediaJSONResponse({"detail": detail}, status_code=status)
    return Response(preview.getvalue(), media_type="image/jpeg", headers=MEDIA_HEADERS)


@app.api_route("/api/incoming/{file_id}/original", methods=["GET", "HEAD"])
def incoming_original(file_id: str):
    row = incoming_for_preview(file_id)
    suffix = PurePosixPath(row["path"]).suffix.lower()
    return IncomingOriginal(row, MEDIA_TYPES[suffix])


@app.get("/api/incoming/{file_id}/preview")
def incoming_preview(file_id: str):
    row = incoming_for_preview(file_id)
    suffix = PurePosixPath(row["path"]).suffix.lower()
    if suffix not in {".heic", ".heif"}:
        return IncomingOriginal(row, MEDIA_TYPES[suffix])
    return render_heif_preview(
        INCOMING_PREVIEW, row,
        error_classifier=classify_incoming_heif_error,
        decode_error_detail=INCOMING_HEIF_ERROR,
    )


@app.api_route("/api/managed/{file_id}/original", methods=["GET", "HEAD"])
def managed_original(file_id: str):
    row, media_type, failure = managed_for_preview(file_id)
    if failure:
        status, detail = failure
        return MediaJSONResponse({"detail": detail}, status_code=status)
    return VerifiedOriginal(
        MANAGED_PREVIEW, row, media_type,
        error_classifier=classify_managed_access_error,
        range_policy="single",
        etag=fingerprint_etag(row["fingerprint"]),
    )


@app.get("/api/managed/{file_id}/preview")
def managed_preview(file_id: str):
    row, media_type, failure = managed_for_preview(file_id)
    if failure:
        status, detail = failure
        return MediaJSONResponse({"detail": detail}, status_code=status)
    suffix = PurePosixPath(row["path"]).suffix.lower()
    if suffix not in {".heic", ".heif"}:
        return VerifiedOriginal(
            MANAGED_PREVIEW, row, media_type,
            error_classifier=classify_managed_access_error,
            range_policy="single",
            etag=fingerprint_etag(row["fingerprint"]),
        )
    return render_heif_preview(
        MANAGED_PREVIEW, row,
        error_classifier=classify_managed_access_error,
        decode_error_detail=MANAGED_HEIF_ERROR,
    )


@app.get("/api/state")
def state():
    with database() as db:
        scan = load_latest_scan(db)
        events = db.execute("SELECT * FROM events ORDER BY start DESC, name, id").fetchall()
        periods = root_periods(events)
        incoming = db.execute(
            "SELECT * FROM scan_files WHERE scan_id=? AND status NOT IN ('moved','deleted') ORDER BY path",
            (scan["id"],),
        ).fetchall() if scan else []
        managed = db.execute(
            "SELECT * FROM media WHERE status IN ('available', 'archived') ORDER BY coalesce(user_time, capture_time), name"
        ).fetchall()
        available = {row["id"]: row for row in managed if row["status"] == "available"}
        pending = db.execute("SELECT * FROM scan_xmp WHERE scan_id=? AND status<>'linked' ORDER BY id", (scan["id"],)).fetchall() if scan else []
        names = device_names(db)
        remote_index = remote_copies_by_sha(db)
        active_scope = active_storage_scope()
        media = [view_media(row, periods, names, remote_index, active_scope) for row in managed]
        media.sort(key=lambda item: (item["time"] or "", item["name"]))
        active = active_jobs_by_lane(db)
        jobs = latest_jobs_by_lane(db)
        latest_incoming_result = db.execute(
            """SELECT * FROM jobs WHERE kind IN ('move','delete','duplicate-cleanup','xmp-link')
               AND status IN ('done','failed','cancelled') ORDER BY id DESC LIMIT 1"""
        ).fetchone()
        compat_job = active['exclusive'] or max(
            (row for row in active.values() if row), key=lambda row: row['id'], default=None,
        )
        if compat_job is None:
            compat_job = db.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT 1").fetchone()
        return {
            "timezone": DEFAULT_ZONE,
            "scan": view_job(scan), "incoming": [view_scan_file(row) for row in incoming],
            "latestIncomingResult": view_job(latest_incoming_result),
            "job": view_job(compat_job),
            "jobs": {lane: view_job(row) for lane, row in jobs.items()},
            "activeJobs": {lane: view_job(row) for lane, row in active.items()},
            "events": [view_event(row) for row in events],
            "managed": media,
            "pendingXmp": sorted((view_pending_xmp(row, available) for row in pending), key=lambda item: item["path"]),
        }


@app.post("/api/jobs/scan", status_code=202)
def scan_library():
    with database(write=True) as db:
        try:
            return {"id": queue_job(db, "scan", {}), "lane": LANE_LOCAL}
        except ValueError as exc:
            error(409, str(exc))


@app.post('/api/thumbnails/plan')
def thumbnail_plan(request: thumbnails.ThumbnailRequest):
    with database() as db:
        plan, _ = thumbnails.plan_thumbnails(db, request)
    return JSONResponse(plan, headers=NO_STORE)


@app.post('/api/jobs/thumbnails', status_code=202)
def start_thumbnails(request: thumbnails.ThumbnailRequest):
    with database(write=True) as db:
        result = thumbnails.queue_thumbnails(db, request)
    return JSONResponse(result, status_code=200 if result['status'] == 'noop' else 202, headers=NO_STORE)


@app.post('/api/jobs/thumbnails/{job_id}/cancel')
def cancel_thumbnails(job_id: int):
    with database(write=True) as db:
        job = db.execute("SELECT * FROM jobs WHERE id=? AND kind IN ('thumbnails-local','thumbnails-remote')", (job_id,)).fetchone()
        if not job:
            error(404, '썸네일 생성 작업을 찾을 수 없습니다.')
        if job['status'] in {'queued', 'running'}:
            result = json.loads(job['result'] or '{}')
            result.update(cancelRequested=True, phase='중지됨' if job['status'] == 'queued' else '중지 요청됨')
            if job['status'] == 'queued':
                result['error'] = '사용자가 썸네일 생성을 중지했습니다.'
                db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=?", (now(), job_id))
            db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(result, ensure_ascii=False), job_id))
        return view_job(db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())


@app.get('/api/settings/thumbnails')
def get_thumbnail_stats():
    with database() as db:
        return JSONResponse(thumbnails.thumbnail_stats(db), headers=NO_STORE)


@app.post('/api/settings/thumbnails/cleanup')
def cleanup_thumbnail_cache():
    return JSONResponse(thumbnails.cleanup_orphans(), headers=NO_STORE)


@app.post('/api/settings/thumbnails/reset-failures')
def reset_thumbnail_failures():
    with database(write=True) as db:
        cleared = db.execute("DELETE FROM thumbnail_cache WHERE status IN ('failed','skipped_large')").rowcount
        return JSONResponse(dict(cleared=cleared, stats=thumbnails.thumbnail_stats(db)), headers=NO_STORE)


@app.post("/api/archive/transfers", status_code=202)
def upload_archive(request: TransferRequest):
    with database(write=True) as db:
        return queue_transfer(db, request, device_folder)


@app.post("/api/archive/transfers/{job_id}/cancel")
def cancel_archive_upload(job_id: int):
    with database(write=True) as db:
        job = db.execute("SELECT * FROM jobs WHERE id=? AND kind='upload'", (job_id,)).fetchone()
        if not job:
            error(404, "전송 작업을 찾을 수 없습니다.")
        if job["status"] in {"queued", "running"}:
            result = json.loads(job["result"] or "{}")
            result["cancelRequested"] = True
            if job["status"] == "queued":
                result["error"] = "업로드를 중지했습니다."
                db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=?", (now(), job_id))
            db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result), job_id))
        return view_job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())


@app.post("/api/archive/index", status_code=202)
def start_remote_index(request: RemoteIndexRequest):
    with database(write=True) as db:
        return queue_remote_index(db, request)


@app.post("/api/archive/index/{job_id}/cancel")
def cancel_remote_index(job_id: int):
    with database(write=True) as db:
        job = db.execute("SELECT * FROM jobs WHERE id=? AND kind='remote-index'", (job_id,)).fetchone()
        if not job:
            error(404, "원격 인덱싱 작업을 찾을 수 없습니다.")
        if job["status"] in {"queued", "running"}:
            result = json.loads(job["result"] or "{}")
            result["cancelRequested"] = True
            if job["status"] == "queued":
                result["error"] = "원격 인덱싱을 중지했습니다."
                db.execute("UPDATE jobs SET status='cancelled',finished_at=? WHERE id=?", (now(), job_id))
            db.execute("UPDATE jobs SET result=? WHERE id=?", (json.dumps(result, ensure_ascii=False), job_id))
        return view_job(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())


@app.post("/api/jobs/move", status_code=202)
def move_files(selection: Selection):
    return queue_incoming_selection(selection, "move")


@app.post("/api/jobs/delete", status_code=202)
def delete_photos(selection: Selection):
    return queue_incoming_selection(selection, "delete")


@app.post("/api/incoming/duplicates/plan")
def incoming_duplicate_plan(selection: Selection):
    with database() as db:
        return plan_duplicate_cleanup(db, selection.ids)


@app.post("/api/jobs/duplicate-cleanup", status_code=202)
def clean_incoming_duplicates(selection: DuplicateCleanupSelection):
    with database(write=True) as db:
        return queue_duplicate_cleanup(db, [item.model_dump() for item in selection.items])


@app.post("/api/jobs/offload", status_code=202)
def offload_files(request: OffloadRequest):
    with database(write=True) as db:
        return queue_offload(db, request)


@app.post("/api/jobs/xmp-link", status_code=202)
def link_xmp(selection: XmpSelection):
    links = selection.links
    if len({item.id for item in links}) != len(links) or len({item.media_id for item in links}) != len(links):
        error(400, "원본과 XMP는 한 번에 하나씩 연결하세요.")
    with database(write=True) as db:
        scan = load_latest_scan(db)
        pending = {row["id"]: json.loads(row["candidates"]) for row in db.execute(
            "SELECT id,candidates FROM scan_xmp WHERE scan_id=? AND status='pending'", (scan["id"],),
        )} if scan else {}
        offloading = active_offload_media_ids(db)
        if any(link.media_id in offloading for link in links):
            error(409, "로컬 원본 비우기가 진행 중인 파일에는 XMP를 연결할 수 없습니다.")
        if any(link.media_id not in pending.get(link.id, ()) for link in links):
            error(409, "XMP 연결 후보가 변경되었습니다. 다시 검사하세요.")
        try:
            return {"id": queue_job(db, "xmp-link", selection.model_dump()), "lane": LANE_LOCAL}
        except ValueError as exc:
            error(409, str(exc))


def queue_incoming_selection(selection, kind):
    ids = list(dict.fromkeys(selection.ids))
    with database(write=True) as db:
        scan = load_latest_scan(db)
        scanned = {row["id"]: row for row in db.execute(
            "SELECT id, path, status FROM scan_files WHERE scan_id=?", (scan["id"],)
        )} if scan else {}
        if any(file_id not in scanned for file_id in ids):
            error(409, "검사 결과가 바뀌었습니다. 다시 검사한 뒤 선택하세요.")
        rows = [scanned[file_id] for file_id in ids]
        if kind == "move" and any(row["status"] != "ready" for row in rows):
            error(409, "이동 가능한 파일을 다시 선택하세요.")
        if kind == "delete" and any(
            row["status"] not in {"ready", "duplicate"} or PurePosixPath(row["path"]).suffix.lower() not in PHOTOS
            for row in rows
        ):
            error(409, "검사가 끝난 incoming 사진을 다시 선택하세요.")
        try:
            return {"id": queue_job(db, kind, {"ids": ids}), "lane": LANE_LOCAL}
        except ValueError as exc:
            error(409, str(exc))


def get_event(db, event_id):
    event = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if event is None:
        error(404, "이벤트를 찾을 수 없습니다.")
    return event


def get_selection(db, ids, *, statuses=("available", "archived")):
    placeholders = ",".join("?" for _ in statuses)
    selection = []
    for file_id in dict.fromkeys(ids):
        row = db.execute(f"SELECT * FROM media WHERE id=? AND status IN ({placeholders})", (file_id, *statuses)).fetchone()
        if row is None:
            error(409, "선택한 파일이 목록에 없습니다. 화면을 새로 고침하세요.")
        selection.append(row)
    return selection


def root_periods(events):
    return [(row, zone_for(row["zone"])) for row in events if row["parent_id"] is None]


def matching_events(stamp, periods):
    captured = datetime.fromisoformat(stamp)
    matching = []
    for event, zone in periods:
        day = captured.astimezone(zone).date().isoformat()
        if event["start"] <= day <= event["end"]:
            matching.append(event["id"])
    return matching


def collect(db, event):
    periods = root_periods(db.execute("SELECT * FROM events WHERE parent_id IS NULL"))
    collected, uncertain, overlapping = [], 0, 0
    for row in db.execute("SELECT * FROM media WHERE event_id IS NULL AND status IN ('available', 'archived')"):
        stamp, _, verified, _ = capture_for_event(row, json.loads(row["metadata"]), json.loads(row["xmp_metadata"] or "{}"))
        if not stamp or not verified:
            uncertain += 1
            continue
        matches = matching_events(stamp, periods)
        if event["id"] in matches:
            if len(matches) == 1:
                collected.append((event["id"], row["id"]))
            else:
                overlapping += 1
    db.executemany("UPDATE media SET event_id=? WHERE id=?", collected)
    return {"collected": len(collected), "uncertain": uncertain, "overlapping": overlapping}


def event_period(request):
    if not request.start or not request.end or request.end < request.start:
        error(400, "시작일과 시작일 이후의 종료일을 지정하세요.")
    return request.start.isoformat(), request.end.isoformat(), zone_for(request.zone).key


def check_event_name(db, name, parent_id, start, except_id=None):
    siblings = db.execute(
        "SELECT id,name FROM events WHERE parent_id IS ? AND start IS ?", (parent_id, start)
    )
    if any(row["id"] != except_id and path_key(row["name"]) == path_key(name) for row in siblings):
        error(409, "같은 날짜와 위치에 동일한 이름의 이벤트가 있습니다." if start else "같은 이름의 소분류가 있습니다.")


def event_folder(name, start):
    if start is None:
        return name
    prefix = f"{start:%y%m%d}_"
    return name if name.startswith(prefix) else prefix + name


def check_event_device_folder(db, parent_id, folder):
    if parent_id is None:
        return
    devices = db.execute(
        f"""SELECT DISTINCT {device_sql()} FROM media m
           WHERE event_id=? AND confirmed=1 AND status IN ('available', 'archived')""", (parent_id,)
    )
    if any(path_key(device_folder(row[0])) == path_key(folder) for row in devices):
        error(409, "이미 사용 중인 장비 폴더와 같은 이름입니다.")


@app.post("/api/events", status_code=201)
def new_event(request: NewEvent):
    name = clean_component(request.name)
    event_id = uuid4().hex
    with database(write=True) as db:
        if request.parent_id:
            parent = get_event(db, request.parent_id)
            if parent["parent_id"]:
                error(400, "소분류는 최상위 이벤트에만 추가할 수 있습니다.")
            folder, start, end, zone = name, None, None, None
        else:
            start, end, zone = event_period(request)
            folder = event_folder(name, request.start)
        check_event_device_folder(db, request.parent_id, folder)
        check_event_name(db, name, request.parent_id, start)
        try:
            db.execute(
                "INSERT INTO events VALUES (?,?,?,?,?,?,?,?)",
                (event_id, name, folder, path_key(folder), request.parent_id, start, end, zone),
            )
        except sqlite3.IntegrityError:
            error(409, "같은 위치의 아카이브 폴더 이름이 이미 사용 중입니다.")
        event = get_event(db, event_id)
        return {"event": view_event(event), "collection": collect(db, event) if not request.parent_id else None}


@app.put("/api/events/{event_id}")
def edit_event(event_id: str, request: EventFields):
    name = clean_component(request.name)
    with database(write=True) as db:
        event = get_event(db, event_id)
        start, end, zone = (None, None, None) if event["parent_id"] else event_period(request)
        check_event_name(db, name, event["parent_id"], start, except_id=event_id)
        folder = event_folder(name, None if event["parent_id"] else request.start)
        check_event_device_folder(db, event["parent_id"], folder)
        try:
            db.execute(
                "UPDATE events SET name=?, folder=?, folder_key=?, start=?, end=?, zone=? WHERE id=?",
                (name, folder, path_key(folder), start, end, zone, event_id),
            )
        except sqlite3.IntegrityError:
            error(409, "같은 위치의 아카이브 폴더 이름이 이미 사용 중입니다.")
        return view_event(get_event(db, event_id))


@app.delete("/api/events/{event_id}")
def delete_event(event_id: str):
    with database(write=True) as db:
        event = get_event(db, event_id)
        affected = db.execute(
            """UPDATE media SET event_id=?, confirmed=0
               WHERE event_id=? OR event_id IN (SELECT id FROM events WHERE parent_id=?)""",
            (event["parent_id"], event_id, event_id),
        ).rowcount
        children = db.execute("DELETE FROM events WHERE parent_id=?", (event_id,)).rowcount
        db.execute("DELETE FROM events WHERE id=?", (event_id,))
        return {"parentId": event["parent_id"], "affectedFiles": affected, "deletedEvents": children + 1}


@app.post("/api/events/{event_id}/collect")
def collect_for_event(event_id: str):
    with database(write=True) as db:
        event = get_event(db, event_id)
        if event["parent_id"]:
            error(400, "최상위 이벤트에서 기간으로 모을 수 있습니다.")
        return collect(db, event)


@app.post("/api/placements")
def assign_files(request: Assignment):
    with database(write=True) as db:
        get_event(db, request.event_id)
        rows = get_selection(db, request.ids)
        db.executemany(
            "UPDATE media SET event_id=?, confirmed=0 WHERE id=? AND event_id IS NOT ?",
            [(request.event_id, row["id"], request.event_id) for row in rows],
        )
        return {"count": len(rows)}


@app.patch("/api/media")
def edit_media(request: MediaEdit):
    device = clean_component(request.device) if request.device is not None else None
    if request.time_mode and request.captured_at is not None:
        error(400, "촬영 시각 출처를 하나만 선택하세요.")
    if request.skip_missing_xmp and request.time_mode != "xmp":
        error(400, "XMP 시각 적용에서만 시각 없는 파일을 제외할 수 있습니다.")
    captured = request.captured_at
    if captured and captured.tzinfo is None:
        captured = captured.replace(tzinfo=zone_for(request.zone))
    user_time = captured.astimezone(timezone.utc).isoformat() if captured else None
    if device is None and user_time is None and not request.time_mode:
        error(400, "수정할 촬영 장비나 시각을 입력하세요.")
    with database(write=True) as db:
        rows = get_selection(db, request.ids)
        selected_zone = zone_for(request.zone) if request.time_mode in {"metadata", "xmp"} else None
        updates = []
        time_updated, time_skipped = 0, 0
        for row in rows:
            if request.time_mode == "modified":
                stamp = modified_time_from_fingerprint(row["fingerprint"])
            elif request.time_mode in {"metadata", "xmp"}:
                candidate = metadata_time(row, json.loads(row["metadata"])) if request.time_mode == "metadata" else xmp_time(json.loads(row["xmp_metadata"] or "{}"))
                if not candidate and request.time_mode == "xmp" and request.skip_missing_xmp:
                    stamp = None
                    time_skipped += 1
                elif not candidate:
                    error(400, "선택한 파일 중 사용할 수 있는 메타데이터 시각이 없는 파일이 있습니다.")
                else:
                    stamp = candidate["time"] if candidate["verified"] else capture_time(
                        candidate["raw"], assumed_zone=selected_zone.key,
                    )[0]
                    if not stamp:
                        error(400, "선택한 파일의 메타데이터 시각을 해석할 수 없습니다.")
            else:
                stamp = user_time
            source = (request.time_mode or "manual") if stamp else None
            time_updated += bool(stamp)
            updates.append((device, stamp, source, device, row["id"]))
        if request.time_mode == "xmp" and request.skip_missing_xmp and not time_updated:
            error(400, "선택한 파일에 적용할 수 있는 XMP 촬영 시각이 없습니다.")
        db.executemany(
            """UPDATE media SET user_device=coalesce(?,user_device), user_time=coalesce(?,user_time),
               user_time_source=coalesce(?,user_time_source),
               confirmed=CASE WHEN ? IS NULL THEN confirmed ELSE 0 END WHERE id=?""",
            updates,
        )
        return {"count": len(rows), "timeUpdated": time_updated, "timeSkipped": time_skipped}


@app.post("/api/placements/confirm")
def confirm_placements(selection: Selection):
    with database(write=True) as db:
        rows = get_selection(db, selection.ids, statuses=("available",))
        names = device_names(db)
        for row in rows:
            if not row["event_id"]:
                error(400, "미배정 파일을 이벤트에 넣은 뒤 확정하세요.")
            folder = device_folder(effective_device(row, names))
            if not folder:
                error(400, "촬영 장비를 지정하거나 unknown으로 분류한 뒤 확정하세요.")
            event = get_event(db, row["event_id"])
            if any(child["folder_key"] == path_key(folder) for child in db.execute(
                "SELECT folder_key FROM events WHERE parent_id=?", (event["id"],)
            )):
                error(409, "장비와 소분류의 폴더 이름이 같습니다. 장비 경로를 다르게 지정하세요.")
        db.executemany("UPDATE media SET confirmed=1 WHERE id=?", [(row["id"],) for row in rows])
        return {"count": len(rows)}
