import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(os.environ.get("PHOTO_SAVER_DATA", "/data"))
THUMBNAILS = Path(os.environ.get("PHOTO_SAVER_THUMBNAILS", "/thumbnails"))
DEFAULT_ZONE = os.environ.get("PHOTO_SAVER_TIMEZONE", "Asia/Seoul")
PHOTOS = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_job
    ON jobs ((1)) WHERE status IN ('queued', 'running');
CREATE TABLE IF NOT EXISTS scan_files (
    scan_id INTEGER NOT NULL REFERENCES jobs(id),
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    fingerprint TEXT,
    sha TEXT,
    size INTEGER,
    modified_at TEXT,
    thumbnail TEXT,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS scan_files_by_job ON scan_files (scan_id, path);
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder TEXT NOT NULL,
    folder_key TEXT NOT NULL,
    parent_id TEXT REFERENCES events(id),
    start TEXT,
    end TEXT,
    zone TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS event_folder_per_parent
    ON events (coalesce(parent_id, ''), folder_key);
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    sha TEXT NOT NULL,
    size INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    thumbnail TEXT,
    capture_time TEXT,
    time_source TEXT,
    time_verified INTEGER NOT NULL DEFAULT 0,
    device TEXT,
    user_time TEXT,
    user_device TEXT,
    event_id TEXT REFERENCES events(id),
    confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS media_by_hash ON media (sha, status);
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def open_db():
    connection = sqlite3.connect(DATA / "catalog.sqlite3", timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def database(write=False):
    connection = open_db()
    try:
        connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    connection = open_db()
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.executescript(SCHEMA)
        connection.execute("BEGIN IMMEDIATE")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(scan_files)")}
        if "thumbnail" not in columns:
            connection.execute("ALTER TABLE scan_files ADD COLUMN thumbnail TEXT")
        connection.commit()
    finally:
        connection.close()


def load_latest_scan(connection):
    return connection.execute(
        "SELECT * FROM jobs WHERE kind='scan' AND status='done' ORDER BY id DESC LIMIT 1"
    ).fetchone()


def queue_job(connection, kind, payload):
    if connection.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
        raise ValueError("검사 또는 이동 작업이 진행 중입니다.")
    return connection.execute(
        "INSERT INTO jobs (kind, payload, created_at) VALUES (?, ?, ?)",
        (kind, json.dumps(payload), now()),
    ).lastrowid
