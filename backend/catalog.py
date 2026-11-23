import fcntl
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
CATALOG_TABLES = (
    "jobs", "events", "device_names", "storages",
    "media", "scan_files", "scan_xmp", "archive_entries", "remote_files",
)

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
    companions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS scan_files_by_job ON scan_files (scan_id, path);
CREATE TABLE IF NOT EXISTS scan_xmp (
    id TEXT PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES jobs(id),
    file TEXT NOT NULL,
    candidates TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS scan_xmp_by_job ON scan_xmp (scan_id);
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
CREATE TABLE IF NOT EXISTS device_names (
    source TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS storages (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '기본 아카이브',
    root_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_indexed_at TEXT
);
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
    user_time_source TEXT,
    user_device TEXT,
    original_path TEXT,
    xmp_path TEXT,
    xmp_sha TEXT,
    xmp_metadata TEXT,
    event_id TEXT REFERENCES events(id),
    confirmed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS media_by_hash ON media (sha, status);
CREATE INDEX IF NOT EXISTS media_by_event ON media (event_id, status);
CREATE TABLE IF NOT EXISTS archive_entries (
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    item_index INTEGER NOT NULL,
    media_id TEXT NOT NULL,
    asset_kind TEXT NOT NULL,
    local_path TEXT NOT NULL,
    sha TEXT NOT NULL,
    size INTEGER,
    storage_id TEXT NOT NULL,
    archive_root TEXT NOT NULL,
    target TEXT NOT NULL,
    outcome TEXT NOT NULL,
    verified_at TEXT,
    recorded_at TEXT NOT NULL,
    error TEXT,
    PRIMARY KEY (job_id, item_index)
);
CREATE INDEX IF NOT EXISTS archive_by_hash ON archive_entries (sha, outcome);
CREATE INDEX IF NOT EXISTS archive_by_media ON archive_entries (media_id, asset_kind, sha, outcome);
CREATE TABLE IF NOT EXISTS remote_files (
    storage_id TEXT NOT NULL REFERENCES storages(id),
    path TEXT NOT NULL,
    archive_root TEXT NOT NULL DEFAULT '',
    sha TEXT,
    size INTEGER NOT NULL,
    mtime_ns INTEGER,
    status TEXT NOT NULL DEFAULT 'present',
    first_seen_at TEXT NOT NULL,
    verified_at TEXT,
    last_seen_at TEXT NOT NULL,
    PRIMARY KEY (storage_id, path)
);
CREATE INDEX IF NOT EXISTS remote_files_by_sha ON remote_files (sha, status);
CREATE INDEX IF NOT EXISTS remote_files_by_storage_status ON remote_files (storage_id, archive_root, status, path);
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def ensure_storage(connection, storage_id, root_hint="", label="기본 아카이브"):
    stamp = now()
    connection.execute(
        """INSERT INTO storages (id, label, root_hint, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
               root_hint=CASE WHEN excluded.root_hint<>'' THEN excluded.root_hint ELSE storages.root_hint END,
               last_seen_at=excluded.last_seen_at""",
        (storage_id, label, root_hint or "", stamp, stamp),
    )


def upsert_remote_file(
    connection, storage_id, path, archive_root, sha, size, *, mtime_ns=None, status="present", verified_at=None,
):
    stamp = now()
    ensure_storage(connection, storage_id, root_hint=archive_root)
    connection.execute(
        """INSERT INTO remote_files
               (storage_id, path, archive_root, sha, size, mtime_ns, status, first_seen_at, verified_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(storage_id, path) DO UPDATE SET
               archive_root=excluded.archive_root,
               sha=coalesce(excluded.sha, remote_files.sha),
               size=excluded.size,
               mtime_ns=coalesce(excluded.mtime_ns, remote_files.mtime_ns),
               status=excluded.status,
               verified_at=coalesce(excluded.verified_at, remote_files.verified_at),
               last_seen_at=excluded.last_seen_at""",
        (storage_id, path, archive_root or "", sha, int(size or 0), mtime_ns, status, stamp, verified_at, stamp),
    )


def backfill_remote_files(connection, default_storage_id=None):
    if connection.execute("SELECT 1 FROM remote_files LIMIT 1").fetchone():
        return 0
    rows = connection.execute(
        """SELECT storage_id, archive_root, target, sha, size, verified_at, recorded_at
           FROM archive_entries
           WHERE outcome IN ('uploaded', 'skipped') AND archive_root <> '' AND target <> ''
           ORDER BY recorded_at ASC, job_id ASC, item_index ASC"""
    ).fetchall()
    for row in rows:
        storage_id = default_storage_id or row["storage_id"]
        upsert_remote_file(
            connection, storage_id, row["target"], row["archive_root"], row["sha"], row["size"] or 0,
            status="present", verified_at=row["verified_at"] or row["recorded_at"],
        )
    return len(rows)


def clear_catalog(connection):
    deleted = {}
    for table in reversed(CATALOG_TABLES):
        cursor = connection.execute(f"DELETE FROM {table}")
        deleted[table] = cursor.rowcount
    return deleted


def open_db():
    connection = sqlite3.connect(DATA / "catalog.sqlite3", timeout=10, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


@contextmanager
def catalog_lock(exclusive=False):
    with (DATA / "catalog.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)
        yield


@contextmanager
def database(write=False):
    with catalog_lock():
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
        if "companions" not in columns:
            connection.execute("ALTER TABLE scan_files ADD COLUMN companions TEXT NOT NULL DEFAULT '[]'")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(media)")}
        if "user_time_source" not in columns:
            connection.execute("ALTER TABLE media ADD COLUMN user_time_source TEXT")
        for column in ("original_path", "xmp_path", "xmp_sha", "xmp_metadata"):
            if column not in columns:
                connection.execute(f"ALTER TABLE media ADD COLUMN {column} TEXT")
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(storages)")}
        if "last_indexed_at" not in columns:
            connection.execute("ALTER TABLE storages ADD COLUMN last_indexed_at TEXT")
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
