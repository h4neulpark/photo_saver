"""Persistent names for automatically detected camera models."""
import re
import unicodedata

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from catalog import database

router = APIRouter(prefix='/api/devices')
UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]')


def device_folder(name):
    return UNSAFE.sub('_', name).strip(' .') if name else ''


def folder_key(name):
    return unicodedata.normalize('NFC', device_folder(name)).casefold()


def device_sql(alias='m'):
    return f"coalesce({alias}.user_device,(SELECT name FROM device_names WHERE source={alias}.device),{alias}.device,'')"


def device_names(db):
    return dict(db.execute('SELECT source,name FROM device_names'))


def effective_device(row, names):
    return row['user_device'] or names.get(row['device'], row['device'])


def listed_devices(db):
    return [dict(row) for row in db.execute('''
        WITH sources AS (SELECT device AS source FROM media WHERE device IS NOT NULL AND device<>''
                         UNION SELECT source FROM device_names)
        SELECT s.source,coalesce(n.name,s.source) AS name,
               (SELECT count(*) FROM media m WHERE m.device=s.source AND m.user_device IS NULL
                 AND m.status='available') AS count
        FROM sources s LEFT JOIN device_names n ON n.source=s.source ORDER BY s.source
    ''')]


class DeviceName(BaseModel):
    source: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=80)


@router.get('')
def get_devices():
    with database() as db:
        return {'devices': listed_devices(db)}


@router.put('/name')
def rename_device(request: DeviceName):
    name = unicodedata.normalize('NFC', request.name.strip())
    if not name or name in {'.', '..'} or UNSAFE.search(name) or not device_folder(name):
        raise HTTPException(400, '폴더명에 사용할 수 있는 촬영도구 이름을 입력하세요.')
    with database(write=True) as db:
        if db.execute("SELECT 1 FROM jobs WHERE kind='upload' AND status IN ('queued','running')").fetchone():
            raise HTTPException(409, '업로드가 끝난 뒤 촬영도구 이름을 변경하세요.')
        devices = listed_devices(db)
        if request.source not in {item['source'] for item in devices}:
            raise HTTPException(404, '촬영도구를 찾을 수 없습니다. 목록을 새로 고침하세요.')
        key = folder_key(name)
        others = [item['name'] for item in devices if item['source'] != request.source]
        others += [row[0] for row in db.execute('SELECT DISTINCT user_device FROM media WHERE user_device IS NOT NULL')]
        if any(folder_key(other) == key for other in others):
            raise HTTPException(409, '다른 촬영도구와 폴더 이름이 같습니다. 다른 이름을 입력하세요.')
        if db.execute('''SELECT 1 FROM media m JOIN events child ON child.parent_id=m.event_id
                         WHERE m.device=? AND m.user_device IS NULL AND m.status='available'
                         AND child.folder_key=?''', (request.source, key)).fetchone():
            raise HTTPException(409, '이벤트 소분류와 폴더 이름이 같습니다. 다른 이름을 입력하세요.')
        db.execute('INSERT INTO device_names(source,name) VALUES (?,?) '
                   'ON CONFLICT(source) DO UPDATE SET name=excluded.name', (request.source, name))
        return {'devices': listed_devices(db)}
