"""Reset managed data and records while preserving incoming and SSH settings."""
import json
import os
import stat
import time
from pathlib import Path

from catalog import DATA, THUMBNAILS, clear_catalog, database, now
from media import DIRECTORY_FLAGS, directory

# These are live database and coordination files, not user data.
CATALOG_FILES = {'catalog.sqlite3', 'catalog.sqlite3-wal', 'catalog.sqlite3-shm', 'catalog.lock', 'worker.lock'}


def purge_directory(root, progress, keep=()):
    """Empty a configured root through descriptors; never follow symlinks."""
    with directory(root) as root_fd:
        device = os.fstat(root_fd).st_dev

        def purge(fd, top=False):
            for name in sorted(os.listdir(fd)):
                if top and name in keep:
                    continue
                info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                if stat.S_ISDIR(info.st_mode):
                    if info.st_dev != device:
                        raise OSError('하위 마운트가 있어 초기화를 중단했습니다.')
                    child = os.open(name, DIRECTORY_FLAGS, dir_fd=fd)
                    try:
                        purge(child)
                    finally:
                        os.close(child)
                    os.rmdir(name, dir_fd=fd)
                    progress(False)
                else:
                    # Includes hidden files, sidecars, links and special files.
                    os.unlink(name, dir_fd=fd)
                    progress(True)

        purge(root_fd, top=True)
        if any(name not in keep for name in os.listdir(root_fd)):
            raise OSError('초기화 중 새 파일이 생겼습니다. 다시 초기화하세요.')


def reset_local_data(job, incoming, managed):
    result = {'phase': '초기화 준비 중', 'deletedFiles': 0, 'deletedDirectories': 0}
    last_save = 0

    def save(force=False):
        nonlocal last_save
        if not force and time.monotonic() - last_save < 0.3:
            return
        with database(write=True) as db:
            db.execute('UPDATE jobs SET result=? WHERE id=?', (json.dumps(result, ensure_ascii=False), job['id']))
        last_save = time.monotonic()

    def progress(is_file):
        result['deletedFiles' if is_file else 'deletedDirectories'] += 1
        save()

    try:
        areas = [('managed 삭제 중', managed), ('썸네일 삭제 중', THUMBNAILS)]
        roots = [Path(path).resolve() for _, path in areas] + [Path(DATA).resolve()]
        # Incoming is protected, including when a deletion root is misconfigured.
        validation_roots = roots + [Path(incoming).resolve()]
        # Validate every root before deleting anything. Never wipe the library root.
        if any(path == Path('/') or path == Path('/settings') for path in roots):
            raise ValueError('초기화 디렉터리 설정을 확인하세요.')
        for index, first in enumerate(validation_roots):
            for second in validation_roots[index + 1:]:
                if first == second or first in second.parents or second in first.parents:
                    raise ValueError('초기화 대상 디렉터리가 서로 겹칩니다.')
        for root in roots:
            with directory(root):
                pass
        for phase, root in areas:
            result['phase'] = phase
            save(True)
            purge_directory(root, progress)
        result['phase'] = '임시 데이터 삭제 중'
        save(True)
        purge_directory(DATA, progress, keep=CATALOG_FILES)
        # Do not declare success if another process wrote files during the reset.
        for _, root in areas:
            with directory(root) as fd:
                if os.listdir(fd):
                    raise OSError('초기화 중 새 파일이 생겼습니다. 다시 초기화하세요.')
        with database(write=True) as db:
            clear_catalog(db)  # Includes this reset job: no history remains.
    except Exception as error:
        result['phase'] = '초기화 실패'
        result['error'] = f'초기화가 완료되지 않았습니다. 이미 삭제된 파일은 복구되지 않습니다. 원인을 확인한 뒤 다시 초기화하세요. {error}'
        with database(write=True) as db:
            db.execute("UPDATE jobs SET status='failed',result=?,finished_at=? WHERE id=?",
                       (json.dumps(result, ensure_ascii=False), now(), job['id']))
