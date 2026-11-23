"""Read-only catalog views; historical verification is separate from current presence."""
import math
from pathlib import PurePosixPath
from typing import Literal

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from catalog import database
from settings import NO_STORE
from devices import device_sql

router = APIRouter(prefix='/api/catalog')
VERIFIED = "('uploaded','skipped','legacy_verified')"
CTE = f"""
WITH archive_history AS (
    SELECT 'archive:'||a.job_id||':'||a.item_index AS record_key,a.media_id AS file_id,
           a.asset_kind AS kind,a.local_path,a.sha,a.size,a.storage_id,a.archive_root,
           a.target,a.outcome,a.verified_at,a.recorded_at,a.error,a.job_id,j.status AS job_status
    FROM archive_entries a JOIN jobs j ON j.id=a.job_id
    UNION ALL
    SELECT 'archive:'||j.id||':'||f.key,json_extract(f.value,'$.id'),
           coalesce(json_extract(f.value,'$.kind'),'media'),json_extract(f.value,'$.local'),
           json_extract(f.value,'$.sha'),json_extract(f.value,'$.size'),
           json_extract(j.payload,'$.config'),NULL,json_extract(f.value,'$.target'),
           CASE WHEN j.status='done' THEN 'legacy_verified'
                WHEN j.status IN ('queued','running') THEN 'pending' ELSE 'unknown' END,
           CASE WHEN j.status='done' THEN j.finished_at END,coalesce(j.finished_at,j.created_at),
           NULL,j.id,j.status
    FROM jobs j, json_each(CASE WHEN json_valid(j.payload) THEN j.payload ELSE '{{}}' END,'$.files') f
    WHERE j.kind='upload' AND NOT EXISTS (
        SELECT 1 FROM archive_entries a WHERE a.job_id=j.id AND a.item_index=CAST(f.key AS INTEGER))
), files AS (
    SELECT 'managed:'||m.id AS record_key,m.id AS file_id,m.kind,'media' AS asset_kind,
           m.name,m.path AS local_path,m.original_path,m.sha,m.size,'managed' AS location,
           m.status,m.confirmed,{device_sql()} AS device,
           CASE WHEN p.id IS NOT NULL THEN p.name||' / '||e.name ELSE e.name END AS event_name,m.event_id,e.parent_id AS parent_id
    FROM media m LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
    UNION ALL
    SELECT 'xmp:'||m.id,m.id,'xmp','xmp',NULL,m.xmp_path,NULL,m.xmp_sha,NULL,
           'managed',m.status,m.confirmed,{device_sql()},
           CASE WHEN p.id IS NOT NULL THEN p.name||' / '||e.name ELSE e.name END,m.event_id,e.parent_id
    FROM media m LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
    WHERE m.xmp_path IS NOT NULL AND m.xmp_sha IS NOT NULL
    UNION ALL
    SELECT 'incoming:'||s.id,s.id,
           CASE WHEN lower(s.path) LIKE '%.mp4' OR lower(s.path) LIKE '%.mov' THEN 'video' ELSE 'photo' END,
           'media',NULL,s.path,NULL,s.sha,s.size,'incoming',s.status,0,'',NULL,NULL,NULL
    FROM scan_files s WHERE s.sha IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM media m WHERE m.id=s.id AND m.sha=s.sha)
), archive_files AS (
    SELECT a.*,m.event_id,e.parent_id,{device_sql()} AS device,
           CASE WHEN p.id IS NOT NULL THEN p.name||' / '||e.name ELSE e.name END AS event_name
    FROM archive_history a LEFT JOIN media m ON m.id=a.file_id
    LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
)
"""


def search_clause(columns, query):
    if not query:
        return '1=1', []
    value = '%' + query.lower().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    return '(' + ' OR '.join(f"lower(coalesce({column},'')) LIKE ? ESCAPE '\\'" for column in columns) + ')', [value] * len(columns)


@router.get('')
def catalog_records(
    view: Literal['files', 'archives'] = 'files',
    q: str = Query(default='', max_length=300),
    scope: Literal['all', 'managed', 'incoming', 'xmp', 'verified', 'failed', 'unknown'] = 'all',
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    event: str = 'all',
    device: str = '',
):
    if view == 'files':
        table = 'files'
        where, params = search_clause(['name', 'local_path', 'original_path', 'sha', 'device', 'event_name', 'file_id'], q.strip())
        if scope in {'managed', 'incoming'}:
            where += ' AND location=?'
            params.append(scope)
        elif scope == 'xmp':
            where += " AND kind='xmp'"
        elif scope == 'verified':
            where += f" AND EXISTS (SELECT 1 FROM archive_history a WHERE a.file_id=files.file_id AND a.kind=files.asset_kind AND a.sha=files.sha AND a.outcome IN {VERIFIED})"
        order = 'local_path,record_key'
    else:
        table = 'archive_files'
        where, params = search_clause(['local_path', 'target', 'archive_root', 'sha', 'file_id', 'event_name', 'device', 'CAST(job_id AS TEXT)'], q.strip())
        if scope == 'verified':
            where += f' AND outcome IN {VERIFIED}'
        elif scope == 'failed':
            where += " AND outcome='failed'"
        elif scope == 'unknown':
            where += " AND outcome IN ('unknown','pending')"
        elif scope == 'xmp':
            where += " AND kind='xmp'"
        order = 'job_id DESC,record_key'
    if event == 'unassigned':
        where += ' AND event_id IS NULL'
    elif event != 'all':
        where += ' AND (event_id=?' + (')' if device else ' OR parent_id=?)')
        params.extend([event] if device else [event, event])
    if device:
        where += ' AND device=?'
        params.append('' if device == '장비 미확인' else device)
    with database() as db:
        folders = [dict(row) for row in db.execute(CTE + f"""SELECT e.id,e.name,e.parent_id,e.start,
                   count(t.record_key) AS count FROM events e LEFT JOIN {table} t ON t.event_id=e.id
                   GROUP BY e.id ORDER BY e.start DESC,e.name,e.id""")]
        device_counts = [dict(row) for row in db.execute(CTE + f"SELECT event_id,device,count(*) AS count FROM {table} GROUP BY event_id,device ORDER BY device")]
        unassigned = sum(row['count'] for row in device_counts if row['event_id'] is None)
        for folder in folders:
            folder['devices'] = [{'name': row['device'] or '장비 미확인', 'count': row['count']} for row in device_counts if row['event_id'] == folder['id']]
        total = db.execute(CTE + f'SELECT count(*) FROM {table} WHERE {where}', params).fetchone()[0]
        pages = max(1, math.ceil(total / page_size))
        page = min(page, pages)
        extra = f", EXISTS(SELECT 1 FROM archive_history a WHERE a.file_id=files.file_id AND a.kind=files.asset_kind AND a.sha=files.sha AND a.outcome IN {VERIFIED}) AS has_archive" if view == 'files' else ''
        rows = [dict(row) for row in db.execute(CTE + f'SELECT * {extra} FROM {table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?', [*params, page_size, (page - 1) * page_size])]
        file_summary = db.execute(CTE + 'SELECT count(*) AS files,count(DISTINCT sha) AS hashes FROM files').fetchone()
        archive_summary = db.execute(CTE + f"SELECT count(*) AS attempts,coalesce(sum(outcome IN {VERIFIED}),0) AS verified,coalesce(sum(outcome='failed'),0) AS failed FROM archive_history").fetchone()
    for row in rows:
        row['name'] = row.get('name') or PurePosixPath(row.get('local_path') or row.get('target') or '').name
    return JSONResponse({
        'view': view, 'rows': rows, 'total': total, 'page': page, 'pages': pages, 'pageSize': page_size,
        'summary': {**dict(file_summary), **dict(archive_summary)},
        'folders': folders, 'unassigned': unassigned,
    }, headers=NO_STORE)
