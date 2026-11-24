# 개발과 검증

## 소스 구성

```text
photo_saver/
├── compose.yaml            # Nginx, API, 워커와 영속 볼륨
├── .env.example            # 사용자 환경 변수 예시
├── backend/
│   ├── Dockerfile          # Python 3.12 + FFmpeg, OpenSSH, ExifTool
│   ├── requirements.txt    # Python 의존성 고정 버전
│   ├── nginx.conf          # 정적 웹·썸네일·API 프록시
│   ├── api.py              # FastAPI 앱과 이벤트·배치 API
│   ├── catalog.py          # SQLite 스키마와 작업 등록
│   ├── worker.py           # 로컬 처리와 작업 실행 루프
│   ├── media.py            # 파일 안전성·미디어 분석
│   ├── companions.py       # XMP와 부가 파일 매칭
│   ├── resets.py           # 전체 로컬 데이터 영구 삭제와 중단 후 재개
│   ├── settings.py         # SSH·저장소 설정과 DB 백업·복원
│   ├── archive.py          # SFTP 연결·폴더 탐색·단일 파일 다운로드
│   ├── transfers.py        # 업로드·검증·취소·이력·remote_files 동기화
│   ├── remote_index.py     # 원격 아카이브 전체·폴더별 증분 인덱싱
│   ├── offload.py          # 실시간 SFTP 확인 기반 로컬 원본 비우기(Safe Offload)
│   ├── devices.py          # 촬영도구 이름 규칙·조회·변경
│   ├── records.py          # 파일·아카이브·원격 인덱스 기록 조회
│   └── test_*.py           # unittest 테스트
├── frontend/
│   ├── index.html
│   ├── app.js              # 해시 라우팅과 전체 UI
│   ├── styles.css
│   └── test_media_preview.cjs  # Node 내장 테스트 러너 기반 미리보기 UI 테스트
└── docs/                   # 현재 구현 문서
```

현재 프론트엔드는 별도 패키지 설치·번들링 단계가 없으며, 미리보기 모달 테스트도 외부 npm 패키지 없이 Node.js 내장 `node:test`와 `vm`으로 실행한다. Python 의존성은 FastAPI, Uvicorn, Pillow, pillow-heif, defusedxml, Paramiko이며 정확한 버전은 [requirements.txt](../backend/requirements.txt)를 따른다.

## 테스트 실행

백엔드 테스트는 Python 표준 `unittest`를 사용한다. 백엔드가 Linux 파일 API를 사용하므로 Mac의 Python에서 직접 실행하기보다 백엔드 Docker 이미지로 실행한다. 서비스·원본·운영 DB를 마운트하지 않고 읽기 전용 컨테이너와 임시 디렉터리(`/tmp` tmpfs)만 사용한다.

프로젝트 루트에서 Compose 설정을 확인하고 이미지를 빌드한다.

```sh
docker compose config --quiet
docker compose build api
```

이미지에는 테스트 파일을 복사하지 않으므로 소스 디렉터리를 읽기 전용으로 마운트한다.

```sh
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev \
  -v "$PWD/backend:/app:ro" \
  -w /app \
  photo-saver-backend \
  python -m unittest test_concurrency -v

docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev \
  -v "$PWD/backend:/app:ro" \
  -w /app \
  photo-saver-backend \
  python -m unittest discover -s . -p 'test_*.py' -v
```

프론트엔드 문법 검사·미리보기 단위 테스트와 diff 공백 검사는 프로젝트 루트에서 실행한다.

```sh
node --check frontend/app.js
node --check frontend/test_media_preview.cjs
node --check frontend/test_job_concurrency.cjs
node --test frontend/test_media_preview.cjs frontend/test_job_concurrency.cjs
git diff --check
```

한 부문만 실행할 때는 마지막 백엔드 명령을 `python -m unittest test_transfers -v`처럼 지정한다. 테스트는 외부 SSH·OMV 연결을 모의 객체 또는 로컬 SFTP 대역으로 대체한다.

2026-11-24 기준 위의 네트워크 차단·읽기 전용 컨테이너 명령으로 백엔드 unittest **120개**(`test_concurrency.py` 19개, `test_media_preview.py` 10개 포함)와 프론트엔드 `node --test` **15개**가 모두 통과했다. 별도 임시 디렉터리와 격리 Compose 프로젝트에서 `api` `/managed-preview` 읽기 전용 마운트, 워커 스캔 지문 일관성, Nginx 프록시 경유 `HEAD`·단일 `Range`(`206`)·`If-Range`·`416`(`bytes */N`)·다중 `Range`(`400`)·`405`와 `MEDIA_HEADERS`를 확인했고, 메모리 fixture 기반 헤드리스 Chrome에서 390×320·320×320·320×240(200% 확대) 오류 버튼 비클리핑/클릭 가능 여부와 폴링 자동 닫힘 후 `#event-search` 포커스 복귀도 검증했다. 실제 OMV 연결과 실기기/브라우저 실제 코덱(HEVC 등) 재생 검증은 수동 확인 항목으로 남긴다.

## 테스트 범위

| 파일 | 주요 검증 |
| --- | --- |
| [test_concurrency.py](../backend/test_concurrency.py) | 구버전 jobs 레인 마이그레이션·인덱스·직접 SQL 트리거, 전체 충돌 매트릭스, 실제 1+1 스레드 병렬 처리·배리어·중단 대기·재시작 복구, offload 중 scan/move/delete·XMP 경합과 원복, 신규·변경 XMP 연결 거부 및 조회 후 상태 전이에도 scan 완료·기존 XMP 보존, 썸네일 보존, SQLite 동시 쓰기, 백업·복원 배타 잠금·구버전 복원, 다중 레인 state |
| [test_job_concurrency.cjs](../frontend/test_job_concurrency.cjs) | 레인별 버튼 활성·exclusive/동기 카탈로그 잠금, 동시 진행 배너·한 레인 종료 후 폴링, 명시적 원격 취소 ID, 원격 실행 중 Incoming 미리보기 삭제 격리 |
| [test_archive.py](../backend/test_archive.py) | 루트 이탈 거부, 링크 경계, 특수 파일명, 빈 폴더·조회 제한, 접속 오류 매핑, 저장된 키만 사용하는 연결, 단일 파일 SFTP 다운로드·UTF-8 헤더·루트 불일치 거부, 호스트 키 초기화 |
| [test_events.py](../backend/test_events.py) | 날짜 접두사, 이벤트·장비 폴더 충돌, 수정 롤백, 수정 후 경로 갱신, 기존 전송 기록·예약 경로 유지 |
| [test_gopro.py](../backend/test_gopro.py) | GoPro 인코더·메타데이터 트랙·모델 판정, 추측 방지, 재분석 시 사용자 분류 보존 |
| [test_transfers.py](../backend/test_transfers.py) | 폴더·XMP 전송, 동일 파일 재전송 생략 및 `remote_files` 고속 스킵, 타 경로 원격 중복 차단·선택 허용, `remote_files` 동기화, SSH 원격 해시(`sha256sum`/`shasum`) 및 SFTP `prefetch` 자동 폴백, 임시 파일 정리, 충돌·심볼릭 링크·원본 변경·검증 오류·취소·연결 단절 조기 중단·설정 변경·잘못된 입력 |
| [test_remote_index.py](../backend/test_remote_index.py) | 원격 증분 인덱싱 지원 확장자 필터·숨김/심볼릭 링크 제외, 크기·수정시각 증분 스킵 및 `full_rehash`, 범위 제한 `missing` 판정, 취소·연결 단절 시 부분 해시 보존 및 오판 방지, 해시 중 파일 변경(TOCTOU) 감지, 기존 원격 전용 파일의 Incoming/업로드 중복 차단·`원격 인덱스` 조회·다운로드 연동, 구버전 `storages` 백업 복원 |
| [test_offload.py](../backend/test_offload.py) | 안정적 스토리지 ID 유지, 구버전 백업 `remote_files` 백필 및 `offloading` 복원, 실시간 SFTP 검증 후 원본·XMP 로컬 비우기·썸네일 보존·`archived` 전환, 미업로드 XMP·원격 누락/크기 불일치/링크/로컬 변경 거부, 중단 재개와 연결 단절 중단, 원격 아카이브 기준 Incoming 스캔·이동·삭제 중복 판정 |
| [test_devices.py](../backend/test_devices.py) | 기존·신규 적용, 재분석·재시작, 수동 이름 우선, 경로·검색 일치, 충돌과 업로드 잠금, 신구 백업 호환 |
| [test_media_edit.py](../backend/test_media_edit.py) | 기존 장비 일괄 배정, 실제 XMP 읽기·파일별 시각·시간대 적용, 누락 시각 유지, 엄격 검증 호환, 전부 누락·잘못된 플래그 거부, 재검사한 XMP 적용 |
| [test_reset.py](../backend/test_reset.py) | managed·캐시·임시 데이터·모든 기록 삭제, incoming 전체·SSH·원격 보존, 링크 경계, 중단 재개·실패 재실행, 확인 문구·활성 작업 차단 |
| [test_records.py](../backend/test_records.py) | 이벤트 트리·검색·필터·페이지 독립성, 원본·XMP 해시, 부분 실패·구버전 이력, 누락 파일과 현재 해시 구분, 백업·복원 호환 |
| [test_media_preview.py](../backend/test_media_preview.py) | `/api/state` managed `preview`/`original` URL, MIME·UTF-8 inline·메서드(`405`), 단일 `Range`·`If-Range`·oversized suffix 보정(`206`)·역전 범위(`end < start` `400`)·초대형 자릿수(4500자리 `400`)·`416`(`bytes */N`)·`HEAD` 0바이트 오류, `404`/`403`/`409`/`415`, 경로 이탈·심볼릭 링크·특수 파일 차단, FD 고정 TOCTOU·지문 `ETag`, HEIC/HEIF 2200×2200 JPEG 변환·EXIF 회전·`Range` 무시, 이벤트 수정·오프로드·초기화 연계, 64 MiB 대용량 스트리밍·DB 잠금 비점유·취소 시 FD 해제, Incoming 회귀·삭제 격리 |
| [test_media_preview.cjs](../frontend/test_media_preview.cjs) | `incoming`/`managed` 동일 ID 충돌 방지, 필터 순서 이전·다음 탐색과 `archived` 건너뛰기, 선택·필터·스크롤 보존, `managed` 삭제 키 차단 및 Incoming 삭제(`running/deleting`·`running/deleted`·`failed`/`review`·즉시 `done`) 목록 정합성, `<video>`·입력 요소·조합 키 방향키 보호, 영상 리소스 정리(`pause`/`removeAttribute('src')`/`load`), 폴링 자동 닫힘·`render()` 후 포커스 복귀·폴백, 상태 폴링 중 재생 유지·목록 조정, stale 오류/HEAD 무시·`.is-error` 상태 전환 및 `다시 시도` |

자동 테스트에는 실제 OMV·SFTP 서버, 실제 촬영 샘플의 브라우저 코덱 재생(HEVC 등), 실기기 터치·200% 확대 레이아웃을 검증하는 브라우저 E2E 테스트가 없다. Incoming 이동·삭제와 XMP 연결 경합은 `test_concurrency.py`에서 검증하지만 실제 OMV 및 실기기 E2E는 별도 수동 검증 대상이다.

## 기능 변경에 따른 확인

관련 부문의 테스트와 문서를 확인하고, 필요한 경우 아래 실제 흐름을 사용한다.

| 변경 부문 | 수동 확인 예 |
| --- | --- |
| Incoming | 별도 테스트 원본으로 신규·중복·변경 파일 검사, 선택 이동 후 원본·카탈로그 일치 |
| 메타데이터 | JPEG·HEIC·MP4·MOV 표본의 회전·장비·시간대·미리보기 확인 |
| 보관 미리보기·영상 재생 | Nginx 경유 `HEAD`/단일 `Range` 탐색, 브라우저에서 사진 확대·영상 재생/탐색·`playsinline`·코덱 미지원 오류/`원본 열기`, `archived` 비활성화, 좁은·짧은 화면 및 200% 확대 레이아웃 |
| 이벤트 | 기간 양 끝 날짜·중복 기간·미확인 시각, 소분류 이동, 확정 후 Source 경로 |
| 전송 | 테스트 원격 폴더에서 신규·동일 파일·충돌·중지·워커 재시작과 XMP 결과 |
| 기록·복원 | 검색·페이지·검증 이력, 별도 테스트 카탈로그로 백업·복원 |
| UI | 다섯 해시 경로, 표·카드 전환, 키보드 이동, 좁은 화면, 오류·빈 상태 |

입력·응답을 바꾸면 [API](api.md), DB 열·상태·제약을 바꾸면 [데이터 모델](data-model.md), 실행 변수·볼륨을 바꾸면 [실행과 운영](setup-and-operations.md)을 함께 갱신한다.
