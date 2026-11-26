"""Read-only catalog views; historical verification is separate from current presence."""
import math
import json
import thumbnails
from pathlib import PurePosixPath
from typing import Annotated, Literal

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse

from archive import active_storage_scope
from catalog import database
from settings import NO_STORE
from devices import device_sql

router = APIRouter(prefix='/api/catalog')
VERIFIED = "('uploaded','skipped','legacy_verified')"
EVENT_LABEL_SQL = """CASE
    WHEN p.id IS NOT NULL THEN coalesce(nullif(p.folder, ''), p.name) || ' / ' || e.name
    ELSE coalesce(nullif(e.folder, ''), e.name)
END"""
CAPTURED_AT_SQL = """coalesce(
    m.user_time, m.capture_time,
    CASE WHEN m.xmp_metadata IS NOT NULL AND json_valid(m.xmp_metadata)
         THEN json_extract(m.xmp_metadata, '$.date.time') END
)"""
FILE_VERIFIED_SQL = f"""(
    EXISTS (SELECT 1 FROM archive_history a WHERE a.file_id=files.file_id AND a.kind=files.asset_kind AND a.sha=files.sha AND a.outcome IN {VERIFIED})
    OR EXISTS (SELECT 1 FROM remote_files rf WHERE rf.sha=files.sha AND rf.status='present')
)"""
CTE = f"""
WITH archive_history AS (
    SELECT 'archive:'||a.job_id||':'||a.item_index AS record_key,a.media_id AS file_id,
           a.asset_kind AS kind,a.local_path,a.sha,a.size,a.storage_id,a.archive_root,
           a.target,a.outcome,a.verified_at,a.recorded_at,a.error,a.job_id,j.status AS job_status,a.item_index
    FROM archive_entries a JOIN jobs j ON j.id=a.job_id
    UNION ALL
    SELECT 'archive:'||j.id||':'||f.key,json_extract(f.value,'$.id'),
           coalesce(json_extract(f.value,'$.kind'),'media'),json_extract(f.value,'$.local'),
           json_extract(f.value,'$.sha'),json_extract(f.value,'$.size'),
           json_extract(j.payload,'$.config'),NULL,json_extract(f.value,'$.target'),
           CASE WHEN j.status='done' THEN 'legacy_verified'
                WHEN j.status IN ('queued','running') THEN 'pending' ELSE 'unknown' END,
           CASE WHEN j.status='done' THEN j.finished_at END,coalesce(j.finished_at,j.created_at),
           NULL,j.id,j.status,CAST(f.key AS INTEGER)
    FROM jobs j, json_each(CASE WHEN json_valid(j.payload) THEN j.payload ELSE '{{}}' END,'$.files') f
    WHERE j.kind='upload' AND NOT EXISTS (
        SELECT 1 FROM archive_entries a WHERE a.job_id=j.id AND a.item_index=CAST(f.key AS INTEGER))
), files AS (
    SELECT 'managed:'||m.id AS record_key,m.id AS file_id,m.kind,'media' AS asset_kind,
           m.name,m.path AS local_path,m.original_path,m.sha,m.size,'managed' AS location,
           m.status,m.confirmed,{device_sql()} AS device,
           {EVENT_LABEL_SQL} AS event_name,m.event_id,e.parent_id AS parent_id,
           {CAPTURED_AT_SQL} AS captured_at,coalesce(p.zone,e.zone) AS event_zone
    FROM media m LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
    UNION ALL
    SELECT 'xmp:'||m.id,m.id,'xmp','xmp',NULL,m.xmp_path,NULL,m.xmp_sha,NULL,
           'managed',m.status,m.confirmed,{device_sql()},
           {EVENT_LABEL_SQL},m.event_id,e.parent_id,
           {CAPTURED_AT_SQL},coalesce(p.zone,e.zone)
    FROM media m LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
    WHERE m.xmp_path IS NOT NULL AND m.xmp_sha IS NOT NULL
    UNION ALL
    SELECT 'incoming:'||s.id,s.id,
           CASE WHEN lower(s.path) LIKE '%.mp4' OR lower(s.path) LIKE '%.mov' THEN 'video' ELSE 'photo' END,
           'media',NULL,s.path,NULL,s.sha,s.size,'incoming',s.status,0,'',NULL,NULL,NULL,NULL,NULL
    FROM scan_files s WHERE s.sha IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM media m WHERE m.id=s.id AND m.sha=s.sha)
), archive_files AS (
    SELECT a.*,m.event_id,e.parent_id,{device_sql()} AS device,
           {EVENT_LABEL_SQL} AS event_name,m.original_path AS original_path
    FROM archive_history a LEFT JOIN media m ON m.id=a.file_id
    LEFT JOIN events e ON e.id=m.event_id LEFT JOIN events p ON p.id=e.parent_id
), remote_view AS (
    SELECT 'remote:'||rf.storage_id||':'||rf.path AS record_key,
           rf.storage_id,rf.path AS remote_path,rf.archive_root,
           rf.sha,rf.size,rf.mtime_ns,rf.status,
           rf.first_seen_at,rf.verified_at,rf.last_seen_at,
           CASE WHEN lower(rf.path) LIKE '%.xmp' THEN 'xmp'
                WHEN lower(rf.path) LIKE '%.mp4' OR lower(rf.path) LIKE '%.mov' THEN 'video'
                ELSE 'photo' END AS kind,
           (EXISTS (SELECT 1 FROM media m WHERE m.sha=rf.sha AND m.status IN ('available','archived'))
            OR EXISTS (SELECT 1 FROM media m WHERE m.xmp_sha=rf.sha AND m.status IN ('available','archived'))) AS in_catalog
    FROM remote_files rf
)
"""


ENRICHED_CTE = CTE.rstrip() + f""", ranked_archive AS (
 SELECT *,row_number() OVER (PARTITION BY file_id,kind,sha ORDER BY job_id DESC,item_index DESC) AS rank,
 max(outcome IN {VERIFIED}) OVER (PARTITION BY file_id,kind,sha) AS has_verified_history
 FROM archive_history
), files_with_archive AS (
 SELECT files.*,a.record_key AS latest_record_key,a.job_id AS latest_job_id,
 a.item_index AS latest_item_index,a.outcome AS latest_outcome,a.job_status AS latest_job_status,
 a.storage_id AS latest_storage_id,a.archive_root AS latest_archive_root,a.target AS latest_target,
 a.recorded_at AS latest_recorded_at,a.verified_at AS latest_verified_at,a.error AS latest_error,
 coalesce(a.has_verified_history,0) AS has_verified_history,
 CASE WHEN a.record_key IS NULL THEN 'none' WHEN a.outcome IN ('uploaded','skipped') THEN 'success'
 WHEN a.outcome='legacy_verified' THEN 'legacy' WHEN a.outcome IN ('failed','pending') THEN a.outcome
 ELSE 'unknown' END AS upload_result
 FROM files LEFT JOIN ranked_archive a ON a.file_id=files.file_id AND a.kind=files.asset_kind
 AND a.sha=files.sha AND a.rank=1
)
"""


def escape_like(value):
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def search_clause(columns, query):
    if not query:
        return '1=1', []
    value = '%' + escape_like(query.lower()) + '%'
    return '(' + ' OR '.join(f"lower(coalesce({column},'')) LIKE ? ESCAPE '\\'" for column in columns) + ')', [value] * len(columns)


def build_remote_folders(db):
    root_count = 0
    top = {}
    for (path,) in db.execute('SELECT path FROM remote_files'):
        parts = PurePosixPath(path).parts
        if len(parts) <= 1:
            root_count += 1
            continue
        first = parts[0]
        entry = top.setdefault(first, {'path': first, 'name': first, 'count': 0, 'children': {}})
        entry['count'] += 1
        if len(parts) >= 3:
            second_path = f'{first}/{parts[1]}'
            child = entry['children'].setdefault(second_path, {'path': second_path, 'name': parts[1], 'count': 0})
            child['count'] += 1
    folders = []
    for key in sorted(top, key=lambda item: (item.casefold(), item), reverse=True):
        entry = top[key]
        children = sorted(entry['children'].values(), key=lambda item: (item['name'].casefold(), item['name']))
        folders.append({'path': entry['path'], 'name': entry['name'], 'count': entry['count'], 'children': children})
    return folders, root_count


def range_clause(view, event, device, folder, job_id=None):
    where, params = '1=1', []
    if view == 'remote':
        if folder == '__root__':
            where += " AND instr(remote_path, '/')=0"
        elif folder.strip('/'):
            where += " AND remote_path LIKE ? ESCAPE '\\'"
            params.append(escape_like(folder.strip('/')) + '/%')
    else:
        if event == 'unassigned':
            where += ' AND event_id IS NULL'
        elif event != 'all':
            where += ' AND (event_id=?' + (')' if device else ' OR parent_id=?)')
            params.extend([event] if device else [event, event])
        if device:
            where += ' AND device=?'
            params.append('' if device == '장비 미확인' else device)
    if view == 'archives' and job_id is not None:
        where += ' AND job_id=?'
        params.append(job_id)
    return where, params


@router.get('')
def catalog_records(
    view: Literal['files', 'archives', 'remote'] = 'files',
    q: str = Query(default='', max_length=300),
    scope: Literal['all', 'managed', 'incoming', 'xmp', 'verified', 'failed', 'unknown', 'present', 'missing', 'remote_only', 'no_thumbnail'] = 'all',
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    event: str = 'all',
    device: str = '',
    folder: str = '',
    upload_result: Literal['all','success','failed','pending','unknown','legacy','none'] = 'all',
    job_id: Annotated[int | None, Query(ge=1, le=2**63-1)] = None,
):
    if job_id is not None and (view != 'archives' or not 1 <= job_id <= 2**63-1):
        raise HTTPException(422, 'job_id requires archives and a positive signed 64-bit integer')
    if upload_result != 'all' and view != 'files':
        raise HTTPException(422, 'upload_result requires files')
    query_cte = ENRICHED_CTE if view == 'files' else CTE
    if view == 'files':
        table = 'files'
        where, params = search_clause(['name', 'local_path', 'original_path', 'sha', 'device', 'event_name', 'file_id'], q.strip())
        if scope in {'managed', 'incoming'}:
            where += ' AND location=?'
            params.append(scope)
        elif scope == 'xmp':
            where += " AND kind='xmp'"
        elif scope == 'verified':
            where += f" AND {FILE_VERIFIED_SQL}"
        if upload_result != 'all':
            where += ' AND upload_result=?'
            params.append(upload_result)
        order = 'local_path,record_key'
    elif view == 'archives':
        table = 'archive_files'
        where, params = search_clause(['local_path', 'target', 'archive_root', 'sha', 'file_id', 'event_name', 'device', 'CAST(job_id AS TEXT)', 'error'], q.strip())
        if scope == 'verified':
            where += f' AND outcome IN {VERIFIED}'
        elif scope == 'failed':
            where += " AND outcome='failed'"
        elif scope == 'unknown':
            where += " AND outcome IN ('unknown','pending')"
        elif scope == 'xmp':
            where += " AND kind='xmp'"
        order = 'job_id DESC,item_index ASC,record_key'
    else:
        table = 'remote_view'
        where, params = search_clause(['remote_path', 'archive_root', 'sha'], q.strip())
        if scope == 'present':
            where += " AND status='present'"
        elif scope == 'missing':
            where += " AND status='missing'"
        elif scope == 'remote_only':
            where += " AND status='present' AND NOT in_catalog"
        elif scope == 'xmp':
            where += " AND kind='xmp'"
        if folder == '__root__':
            where += " AND instr(remote_path, '/') = 0"
        elif folder.strip('/'):
            where += " AND remote_path LIKE ? ESCAPE '\\'"
            params.append(f"{escape_like(folder.strip('/'))}/%")
        order = 'remote_path,record_key'
    if view != 'remote':
        if event == 'unassigned':
            where += ' AND event_id IS NULL'
        elif event != 'all':
            where += ' AND (event_id=?' + (')' if device else ' OR parent_id=?)')
            params.extend([event] if device else [event, event])
        if device:
            where += ' AND device=?'
            params.append('' if device == '장비 미확인' else device)
    if view == 'archives' and job_id is not None:
        where += ' AND job_id=?'
        params.append(job_id)
    with database() as db:
        active_scope = active_storage_scope()
        thumb_context = thumbnails.context(db, active_scope)
        if scope == 'no_thumbnail':
            where += " AND kind<>'xmp' AND sha IS NOT NULL AND sha NOT IN (SELECT value FROM json_each(?))"
            params.append(json.dumps(list(thumb_context['disk_shas'])))
        range_where, range_params = range_clause(view, event, device, folder, job_id)
        range_rows = [dict(row) for row in db.execute(CTE + f'SELECT * FROM {table} WHERE {range_where}', range_params)]
        for row in range_rows:
            row['media_kind'] = thumbnails.media_kind(row['local_path'] or row['target']) if view == 'archives' and row['kind'] != 'xmp' else row['kind']
        missing_thumbnails = thumbnails.missing_summary(range_rows, thumb_context)
        facet_table = '(SELECT * FROM archive_files WHERE job_id=?)' if view == 'archives' and job_id is not None else table
        facet_params = [job_id] if view == 'archives' and job_id is not None else []
        if view == 'remote':
            folders, unassigned = [], 0
            remote_folders, remote_root_count = build_remote_folders(db)
        else:
            folders = [dict(row) for row in db.execute(CTE + f"""SELECT e.id,e.name,e.folder,e.parent_id,e.start,e.zone,
                       count(t.record_key) AS count FROM events e LEFT JOIN {facet_table} t ON t.event_id=e.id
                       GROUP BY e.id ORDER BY e.start DESC,e.name,e.id""", facet_params)]
            device_counts = [dict(row) for row in db.execute(CTE + f"SELECT event_id,device,count(*) AS count FROM {facet_table} GROUP BY event_id,device ORDER BY device", facet_params)]
            unassigned = sum(row['count'] for row in device_counts if row['event_id'] is None)
            for item in folders:
                item['devices'] = [{'name': row['device'] or '장비 미확인', 'count': row['count']} for row in device_counts if row['event_id'] == item['id']]
            remote_folders, remote_root_count = [], 0
        page_table = 'files_with_archive AS files' if view == 'files' else table
        total = db.execute(query_cte + f'SELECT count(*) FROM {page_table} WHERE {where}', params).fetchone()[0]
        pages = max(1, math.ceil(total / page_size))
        page = min(page, pages)
        extra = f", {FILE_VERIFIED_SQL} AS has_archive" if view == 'files' else ''
        rows = [dict(row) for row in db.execute(query_cte + f'SELECT * {extra} FROM {page_table} WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?', [*params, page_size, (page - 1) * page_size])]
        if view == 'remote':
            hashes = list(dict.fromkeys(row['sha'] for row in rows if row['sha'] is not None))
            matches = {sha: {} for sha in hashes}
            if hashes:
                placeholders = ','.join('?' for _ in hashes)
                linked_media = db.execute(f"""
                    SELECT m.id,m.sha,m.xmp_sha,m.event_id,{EVENT_LABEL_SQL} AS event_label
                    FROM media m LEFT JOIN events e ON e.id=m.event_id
                    LEFT JOIN events p ON p.id=e.parent_id
                    WHERE m.status IN ('available','archived')
                      AND (m.sha IN ({placeholders}) OR m.xmp_sha IN ({placeholders}))
                    ORDER BY coalesce(p.start,e.start) DESC,event_label ASC,m.id ASC
                """, [*hashes, *hashes])
                for media in linked_media:
                    for sha in {media['sha'], media['xmp_sha']}:
                        if sha in matches:
                            matches[sha][media['id']] = media
            for row in rows:
                linked = list(matches.get(row['sha'], {}).values())
                events = list(dict.fromkeys(media['event_label'] for media in linked if media['event_label']))
                row.update(
                    catalog_events=events,
                    catalog_event_name=events[0] if events else None,
                    catalog_match_count=len(linked),
                    catalog_has_unassigned=any(media['event_id'] is None for media in linked),
                    catalog_file_ids=[media['id'] for media in linked],
                )
        active_storage_id, active_root = active_scope
        present_remote = {}
        if view == 'files' and active_root:
            for remote in db.execute(
                """SELECT sha, path FROM remote_files
                   WHERE status='present' AND archive_root=? AND sha IS NOT NULL
                   ORDER BY (storage_id=?) DESC, coalesce(verified_at, last_seen_at) DESC, path""",
                (active_root, active_storage_id or ''),
            ):
                present_remote.setdefault(remote['sha'], remote['path'])
        upload_summary = None
        if view == 'files':
            upload_summary = dict(db.execute(ENRICHED_CTE + 'SELECT count(*) AS total,' + ','.join(f"coalesce(sum(upload_result='{key}'),0) AS {key}" for key in ('success','failed','pending','unknown','legacy','none')) + f' FROM files_with_archive WHERE {range_where}', range_params).fetchone())
        archive_selection = None
        if view == 'archives':
            archive_selection = dict(db.execute(CTE + 'SELECT count(*) AS total,' + ','.join(f"coalesce(sum(outcome='{outcome}'),0) AS {key}" for key,outcome in [('uploaded','uploaded'),('skipped','skipped'),('legacy','legacy_verified'),('failed','failed'),('pending','pending')]) + f",coalesce(sum(outcome NOT IN ('uploaded','skipped','legacy_verified','failed','pending')),0) AS unknown FROM archive_files WHERE {range_where}", range_params).fetchone())
            archive_selection['jobId'] = job_id
        file_summary = db.execute(CTE + 'SELECT count(*) AS files,count(DISTINCT sha) AS hashes FROM files').fetchone()
        archive_summary = db.execute(CTE + f"SELECT count(*) AS attempts,coalesce(sum(outcome IN {VERIFIED}),0) AS verified,coalesce(sum(outcome='failed'),0) AS failed FROM archive_history").fetchone()
        remote_summary = db.execute(CTE + """
            SELECT count(*) AS remoteTotal,
                   coalesce(sum(status='present'), 0) AS remotePresent,
                   coalesce(sum(status='missing'), 0) AS remoteMissing,
                   coalesce(sum(status='present' AND NOT in_catalog), 0) AS remoteOnly
            FROM remote_view
        """).fetchone()
        indexed_row = db.execute(
            "SELECT last_indexed_at FROM storages WHERE last_indexed_at IS NOT NULL ORDER BY (id=?) DESC, last_indexed_at DESC LIMIT 1",
            (active_storage_id or '',),
        ).fetchone()
    for row in rows:
        row['media_kind'] = thumbnails.media_kind(row['local_path'] or row['target']) if view == 'archives' and row['kind'] != 'xmp' else row['kind']
        row.update(thumbnails.resolve_thumbnail_state(row['media_kind'], row['sha'], **thumb_context))
        local = thumb_context['local_sources'].get(row['sha']) if row['media_kind'] != 'xmp' else None
        row.update(has_local_original=bool(local), preview=None, original=None)
        if local:
            prefix = f"/api/{local['area']}/{local['id']}"
            row.update(preview=prefix + '/preview', original=prefix + '/original')
        row['name'] = row.get('name') or PurePosixPath(row.get('remote_path') or row.get('local_path') or row.get('target') or '').name
        if view == 'files':
            fields = ('record_key','job_id','item_index','outcome','job_status','storage_id','archive_root','target','recorded_at','verified_at','error')
            latest = {field: row.pop('latest_' + field) for field in fields}
            row['latest_archive'] = latest if latest['record_key'] is not None else None
            row['has_verified_history'] = bool(row['has_verified_history'])
            download_path = present_remote.get(row['sha']) if active_root and row.get('sha') else None
            row['download_path'] = download_path
            row['can_download'] = bool(download_path)
        elif view == 'archives':
            row['can_download'] = bool(
                active_root and row.get('target') and row.get('archive_root') == active_root
                and row.get('outcome') in {'uploaded', 'skipped'}
            )
        else:
            row['in_catalog'] = bool(row['in_catalog'])
            row['can_download'] = bool(active_root and row.get('status') == 'present' and row.get('archive_root') == active_root)
    return JSONResponse({
        'uploadSummary': upload_summary,
        'archiveSelection': archive_selection,
        'view': view, 'rows': rows, 'total': total, 'page': page, 'pages': pages, 'pageSize': page_size,
        'summary': {
            **dict(file_summary), **dict(archive_summary), **dict(remote_summary),
            'lastIndexedAt': indexed_row['last_indexed_at'] if indexed_row else None,
        },
        'folders': folders, 'unassigned': unassigned,
        'remoteFolders': remote_folders, 'remoteRootCount': remote_root_count,
        'activeArchiveRoot': active_root, 'missingThumbnails': missing_thumbnails,
    }, headers=NO_STORE)
