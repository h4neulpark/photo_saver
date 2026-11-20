import json
import re
import sqlite3
import unicodedata
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import PurePosixPath
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from catalog import DEFAULT_ZONE, PHOTOS, database, initialize, load_latest_scan, queue_job


@asynccontextmanager
async def lifespan(_app):
    ZoneInfo(DEFAULT_ZONE)
    initialize()
    yield


app = FastAPI(lifespan=lifespan)
unsafe_component = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')


class Selection(BaseModel):
    ids: list[str] = Field(min_length=1)


class NewEvent(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    parent_id: str | None = None
    start: date | None = None
    end: date | None = None
    zone: str = DEFAULT_ZONE


class Assignment(Selection):
    event_id: str


class MediaEdit(Selection):
    device: str | None = Field(default=None, max_length=80)
    captured_at: datetime | None = None
    zone: str = DEFAULT_ZONE


def error(status, detail):
    raise HTTPException(status_code=status, detail=detail)


def path_key(value):
    return unicodedata.normalize("NFC", value).casefold()


def clean_component(value):
    name = value.strip()
    if name in {"", ".", ".."} or unsafe_component.search(name):
        error(400, "폴더명에 사용할 수 있는 이름을 입력하세요.")
    return unicodedata.normalize("NFC", name)


def device_folder(name):
    return unsafe_component.sub("_", name).strip(" .") if name else ""


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


def view_media(row, periods):
    device = row["user_device"] or row["device"]
    metadata = json.loads(row["metadata"])
    stamp = row["user_time"] or row["capture_time"]
    verified = bool(row["user_time"] or row["time_verified"])
    review_reason = None
    if row["event_id"] is None:
        if not stamp or not verified:
            review_reason = "촬영 시각 확인 필요"
        elif len(matching_events(stamp, periods)) > 1:
            review_reason = "이벤트 기간 중복"
    return {
        "id": row["id"], "name": row["name"], "path": row["path"], "kind": row["kind"],
        "size": display_size(row["size"]), "device": device, "deviceFolder": device_folder(device),
        "time": stamp, "timeVerified": verified, "reviewReason": review_reason,
        "timeSource": "사용자 지정" if row["user_time"] else row["time_source"],
        "eventId": row["event_id"], "confirmed": bool(row["confirmed"]),
        "thumbnail": f"/thumbnails/{row['thumbnail']}" if row["thumbnail"] else None,
        "analysisError": metadata.get("error"),
    }


def view_scan_file(row):
    path = PurePosixPath(row["path"])
    return {
        "id": row["id"], "name": path.name, "folder": "" if str(path.parent) == "." else str(path.parent),
        "kind": "photo" if path.suffix.lower() in PHOTOS else "video",
        "modifiedAt": row["modified_at"], "size": display_size(row["size"]),
        "thumbnail": f"/thumbnails/{row['thumbnail']}" if row["thumbnail"] else None,
        "status": row["status"], "reason": row["reason"],
    }


def view_job(row):
    if not row:
        return None
    return {
        "id": row["id"], "kind": row["kind"], "status": row["status"],
        "finishedAt": row["finished_at"], "result": json.loads(row["result"]) if row["result"] else {},
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
        return {
            "timezone": DEFAULT_ZONE,
            "scan": view_job(scan), "incoming": [view_scan_file(row) for row in incoming],
            "job": view_job(db.execute("SELECT * FROM jobs ORDER BY id DESC LIMIT 1").fetchone()),
            "events": [view_event(row) for row in events],
            "managed": [view_media(row, periods) for row in db.execute(
                "SELECT * FROM media WHERE status='available' ORDER BY coalesce(user_time, capture_time), name"
            )],
        }


@app.post("/api/jobs/scan", status_code=202)
def scan_library():
    with database(write=True) as db:
        try:
            return {"id": queue_job(db, "scan", {})}
        except ValueError as exc:
            error(409, str(exc))


@app.post("/api/jobs/move", status_code=202)
def move_files(selection: Selection):
    return queue_incoming_selection(selection, "move")


@app.post("/api/jobs/delete", status_code=202)
def delete_photos(selection: Selection):
    return queue_incoming_selection(selection, "delete")


def queue_incoming_selection(selection, kind):
    ids = list(dict.fromkeys(selection.ids))
    with database(write=True) as db:
        scan = load_latest_scan(db)
        scanned = {row["id"]: row for row in db.execute(
            "SELECT id, path, status FROM scan_files WHERE scan_id=?", (scan["id"],)
        )} if scan else {}
        if any(file_id not in scanned for file_id in ids):
            error(409, "검사 결과가 바뀌었습니다. 새로 고침한 뒤 다시 선택하세요.")
        rows = [scanned[file_id] for file_id in ids]
        if kind == "move" and any(row["status"] != "ready" for row in rows):
            error(409, "이동 가능한 파일을 다시 선택하세요.")
        if kind == "delete" and any(
            row["status"] not in {"ready", "duplicate"} or PurePosixPath(row["path"]).suffix.lower() not in PHOTOS
            for row in rows
        ):
            error(409, "검사가 끝난 incoming 사진을 다시 선택하세요.")
        try:
            return {"id": queue_job(db, kind, {"ids": ids})}
        except ValueError as exc:
            error(409, str(exc))


def get_event(db, event_id):
    event = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if event is None:
        error(404, "이벤트를 찾을 수 없습니다.")
    return event


def get_selection(db, ids):
    selection = []
    for file_id in dict.fromkeys(ids):
        row = db.execute("SELECT * FROM media WHERE id=? AND status='available'", (file_id,)).fetchone()
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
    for row in db.execute("SELECT * FROM media WHERE event_id IS NULL AND status='available'"):
        stamp = row["user_time"] or row["capture_time"]
        if not stamp or not (row["user_time"] or row["time_verified"]):
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


@app.post("/api/events", status_code=201)
def new_event(request: NewEvent):
    name = clean_component(request.name)
    event_id = uuid4().hex
    with database(write=True) as db:
        if request.parent_id:
            parent = get_event(db, request.parent_id)
            if parent["parent_id"]:
                error(400, "소분류는 최상위 이벤트에만 추가할 수 있습니다.")
            devices = db.execute(
                """SELECT DISTINCT coalesce(user_device,device) FROM media
                   WHERE event_id=? AND confirmed=1 AND status='available'""", (parent["id"],)
            )
            if any(path_key(device_folder(row[0])) == path_key(name) for row in devices):
                error(409, "이미 사용 중인 장비 폴더와 같은 이름입니다.")
            folder, start, end, zone = name, None, None, None
        else:
            if not request.start or not request.end or request.end < request.start:
                error(400, "시작일과 시작일 이후의 종료일을 지정하세요.")
            zone = zone_for(request.zone).key
            start, end = request.start.isoformat(), request.end.isoformat()
            folder = f"{request.start:%y%m%d}_{name}"
        try:
            db.execute(
                "INSERT INTO events VALUES (?,?,?,?,?,?,?,?)",
                (event_id, name, folder, path_key(folder), request.parent_id, start, end, zone),
            )
        except sqlite3.IntegrityError:
            error(409, "같은 위치에 동일한 이름의 이벤트가 있습니다.")
        event = get_event(db, event_id)
        return {"event": view_event(event), "collection": collect(db, event) if not request.parent_id else None}


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
    captured = request.captured_at
    if captured and captured.tzinfo is None:
        captured = captured.replace(tzinfo=zone_for(request.zone))
    user_time = captured.astimezone(timezone.utc).isoformat() if captured else None
    if device is None and user_time is None:
        error(400, "수정할 촬영 장비나 시각을 입력하세요.")
    with database(write=True) as db:
        rows = get_selection(db, request.ids)
        db.executemany(
            """UPDATE media SET user_device=coalesce(?,user_device), user_time=coalesce(?,user_time),
               confirmed=CASE WHEN ? IS NULL THEN confirmed ELSE 0 END WHERE id=?""",
            [(device, user_time, device, row["id"]) for row in rows],
        )
        return {"count": len(rows)}


@app.post("/api/placements/confirm")
def confirm_placements(selection: Selection):
    with database(write=True) as db:
        rows = get_selection(db, selection.ids)
        for row in rows:
            if not row["event_id"]:
                error(400, "미배정 파일을 이벤트에 넣은 뒤 확정하세요.")
            folder = device_folder(row["user_device"] or row["device"])
            if not folder:
                error(400, "촬영 장비를 지정하거나 unknown으로 분류한 뒤 확정하세요.")
            event = get_event(db, row["event_id"])
            if any(child["folder_key"] == path_key(folder) for child in db.execute(
                "SELECT folder_key FROM events WHERE parent_id=?", (event["id"],)
            )):
                error(409, "장비와 소분류의 폴더 이름이 같습니다. 장비 경로를 다르게 지정하세요.")
        db.executemany("UPDATE media SET confirmed=1 WHERE id=?", [(row["id"],) for row in rows])
        return {"count": len(rows)}
