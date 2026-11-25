# 개발과 검증

## Incoming 기기 업로드 검증

[uploads.py](../backend/uploads.py), [test_uploads.py](../backend/test_uploads.py), [test_incoming_upload.cjs](../frontend/test_incoming_upload.cjs)가 청크 API와 브라우저 업로드를 구성한다. 운영 requirements.txt에는 패키지를 추가하지 않는다. FastAPI HTTP 테스트만 테스트 전용 이미지의 httpx 0.28.1을 사용한다.

    node --check frontend/app.js
    node --check frontend/test_incoming_upload.cjs
    node --test frontend/test_media_preview.cjs frontend/test_job_concurrency.cjs frontend/test_incoming_upload.cjs

업로드 백엔드 12개 테스트는 다중 청크/원자적 게시/검사 격리, 지원 형식·400/413/415, 경로·숨김·NFC·링크, 대소문자 충돌, 수정시각 범위, 409 오프셋·413 청크·단절/취소/OS 오류 롤백, DELETE 멱등·TTL/활성 잠금 보존, 507·마운트 503·reset-all 409, 실제 worker.scan_incoming과 동시 게시, 수정시각 설정 → 파일 fsync → 원자적 게시 순서를 검증한다. 폴더 각 세그먼트의 앞뒤/전체 공백·숨김·UTF-8 220바이트 초과도 거부한다.

업로드 프론트엔드 17개 테스트는 영속 패널/썸네일/폴더 포커스, Safari 동기 파일 선택/입력 초기화, 다중 청크와 혼합 부분 실패·details 보존, 동반 파일 exact/stem/모호성, 네트워크 GET 재동기화·409·2회 재시도, AbortController·DELETE·대기 취소, 자동 scan 및 local/remote/exclusive 작업 공존, 폴더 드롭과 숨김 제외·2,000개 제한, 확장자 없는/숨김 파일의 API 전 사전 제외와 바이트 집계, 전체/현재 파일 바이트·진행률·화면 유지 안내, 상태별 결과 요약·저장 경로·최초 자동 펼침과 배치별 사용자 접기 보존, lastModified 정수화, 취소 정리 실패 안내의 즉시 표시를 검증한다. 실제 iOS/iPadOS 사진 선택기의 옵션과 백그라운드 제한은 실기기 수동 확인 대상이다.

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
│   ├── uploads.py          # Incoming 기기 청크 업로드·원자적 게시·정리
│   ├── catalog.py          # SQLite 스키마와 작업 등록
│   ├── worker.py           # 로컬 처리와 작업 실행 루프
│   ├── media.py            # 파일 안전성·미디어 분석
│   ├── companions.py       # XMP와 부가 파일 매칭
│   ├── resets.py           # 전체 로컬 데이터 영구 삭제와 중단 후 재개
│   ├── settings.py         # SSH·저장소 설정과 DB 백업·복원
│   ├── archive.py          # SFTP 연결·폴더 탐색·단일 파일 다운로드
│   ├── transfers.py        # 업로드·검증·취소·이력·remote_files 동기화
│   ├── remote_index.py     # 원격 아카이브 전체·폴더별 증분 인덱싱
│   ├── incoming_cleanup.py # Incoming 중복 정리 계획과 남길 사본 검증
│   ├── offload.py          # 실시간 SFTP 확인 기반 로컬 원본 비우기(Safe Offload)
│   ├── devices.py          # 촬영도구 이름 규칙·조회·변경
│   ├── records.py          # 파일·아카이브·원격 인덱스 기록 조회
│   └── test_*.py           # unittest 테스트
├── frontend/
│   ├── index.html
│   ├── app.js              # 해시 라우팅과 전체 UI
│   ├── styles.css
│   ├── test_media_preview.cjs  # Node 내장 테스트 러너 기반 미리보기 UI 테스트
│   ├── test_job_concurrency.cjs # 로컬·원격·배타 작업 UI 테스트
│   ├── test_incoming_upload.cjs # 기기 업로드·진행률·결과 상태·취소 테스트
│   ├── test_folder_trees.cjs # 폴더 트리·CSS·스크롤 계약
│   ├── test_phase1_ui.cjs # 결과 배너·작업 내역·기록 탭
│   └── test_phase2_ui.cjs # 14개 Phase 2 UI·자동 연결·경로 회귀
└── docs/                   # 현재 구현 문서
```

현재 프론트엔드는 별도 패키지 설치·번들링 단계가 없으며, 미리보기 모달 테스트도 외부 npm 패키지 없이 Node.js 내장 `node:test`와 `vm`으로 실행한다. Python 의존성은 FastAPI, Uvicorn, Pillow, pillow-heif, defusedxml, Paramiko이며 정확한 버전은 [requirements.txt](../backend/requirements.txt)를 따른다.

## 테스트 실행

백엔드 테스트는 Python 표준 `unittest`를 사용한다. 백엔드가 Linux 파일 API를 사용하므로 Mac의 Python에서 직접 실행하기보다 백엔드 Docker 이미지로 실행한다. 서비스·원본·운영 DB를 마운트하지 않고 읽기 전용 컨테이너와 임시 디렉터리(`/tmp` tmpfs)만 사용한다.

프로젝트 루트에서 Compose 설정을 확인하고 이미지를 빌드한다.

```sh
docker compose config --quiet
docker compose build api
printf 'FROM photo-saver-backend\nRUN pip install --no-cache-dir httpx==0.28.1\n' | docker build -t photo-saver-backend-tests -
```

이미지에는 테스트 파일을 복사하지 않으므로 소스 디렉터리를 읽기 전용으로 마운트한다. HTTP 라우팅 회귀 테스트의 FastAPI `TestClient`는 `httpx`가 필요하므로 위에서 만든 테스트 전용 이미지를 사용한다. 운영 이미지와 실행 중인 서비스에는 추가 의존성을 설치하지 않는다.

```sh
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev \
  -v "$PWD/backend:/app:ro" \
  -w /app \
  photo-saver-backend-tests \
  python -m unittest test_jobs_api -v

docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev \
  -v "$PWD/backend:/app:ro" \
  -w /app \
  photo-saver-backend-tests \
  python -m unittest discover -s . -p 'test_*.py' -v
```

프론트엔드 문법 검사·미리보기 단위 테스트와 diff 공백 검사는 프로젝트 루트에서 실행한다.

```sh
node --check frontend/app.js
node --check frontend/test_media_preview.cjs
node --check frontend/test_job_concurrency.cjs
node --check frontend/test_incoming_upload.cjs
node --check frontend/test_folder_trees.cjs
node --check frontend/test_phase1_ui.cjs
node --check frontend/test_phase2_ui.cjs
node --test frontend/test_media_preview.cjs frontend/test_job_concurrency.cjs frontend/test_incoming_upload.cjs frontend/test_folder_trees.cjs frontend/test_phase1_ui.cjs frontend/test_phase2_ui.cjs
git diff --check
```

운영 반영과 읽기 전용 스모크는 다음과 같이 실행한다.

```sh
docker compose up -d --build api worker
docker compose ps
curl -fsS http://127.0.0.1:${PHOTO_SAVER_PORT:-8888}/api/health
curl -fsS -I http://127.0.0.1:${PHOTO_SAVER_PORT:-8888}/app.js
curl -fsS -I http://127.0.0.1:${PHOTO_SAVER_PORT:-8888}/styles.css
curl -fsS -D - "http://127.0.0.1:${PHOTO_SAVER_PORT:-8888}/api/jobs?limit=5" | head -n 30
curl -fsS http://127.0.0.1:${PHOTO_SAVER_PORT:-8888}/api/state | python3 -c "import sys,json; d=json.load(sys.stdin); print('state ok, keys:', sorted(d.keys()))"
```

Phase 1 검증(2026-11-25): 프론트엔드 **80개**(기존 59개 + Phase 1 21개), 백엔드 **162개**(jobs API 9개 포함)가 통과했다. 기존 폴더 트리 함수·액션·9개 CSS 규칙과 `test_folder_trees.cjs`는 작업 시작 상태와 동일함을 별도로 비교했다. 운영 API는 healthy, worker/frontend는 Up, jobs는 HTTP 200과 no-store 및 전체 집계를 반환했다. 배포된 Incoming·작업 내역·이벤트 관리·파일 기록을 Chrome 320·390·768·1280px에서 확인했고, 긴 경로 실패 배너와 실시간 작업은 브라우저 메모리 fixture로 추가 확인했다. 24개 레이아웃 검사에서 가로 넘침·컨트롤 클리핑·앱 콘솔 오류가 없었다(기존 favicon 404는 별도 제외).

Phase 1 리뷰 수정 Round 1(2026-11-25): 프론트엔드 **87개**(Phase 1 28개 포함), 백엔드 **163개**(jobs API 10개 포함)가 통과했다. 첫 페이지 갱신 시 필터 이탈 작업 제거와 커서 갱신·과거 페이지 보존, 활성 상태의 hasAttention 제외, Incoming 후속 액션 순서·재사용 ID의 상세 펼침 독립성, 혼합 ISO 시각·동률 ID 정렬 회귀를 추가했다. 운영 API·worker 재빌드 후 API healthy와 `/api/health`, `/api/jobs?limit=5`의 HTTP 200·no-store를 재확인했다.

Phase 2 검증(2026-11-25): 프론트엔드 **101개**(기존 87개 + `test_phase2_ui.cjs` 14개), 네트워크 차단·읽기 전용 임시 컨테이너의 백엔드 **163개**가 통과했다. 7개 JavaScript 파일의 `node --check`와 `git diff --check`를 확인했다. 기존 테스트 수정은 미리보기 2줄과 Phase 1 1줄의 승인된 문자열 갱신에 한정했으며, `backend/*`, `index.html`의 5개 루트 ID, Compose, 나머지 테스트 및 폴더 트리 CSS 규칙은 보존했다.

Phase 2 자동 연결은 `loadRoute()`에서만 실행하며 `render()`는 요청을 시작하지 않는다. 5개 스토리지 설정 플래그가 모두 참일 때 한 번 시도하고 실패 뒤 재방문으로 재시도하지 않는다. 설정 변경·초기화는 연결 세대를 갱신하여 이전 요청의 늦은 응답을 무시한다. NAS 미리보기는 서버와 같은 논리 경로에서 현재 로컬 접두 경로를 잘라 원격 목적지에 결합하고, 체크박스 변경은 패널만 갱신한다.

프론트엔드는 운영 Nginx에 읽기 전용 바인드 마운트되어 파일 수정이 즉시 반영된다. 서비스 재빌드 없이 API healthy, worker/frontend Up, health `{"status":"ok"}`, 배포된 `app.js`·`styles.css` HTTP 200 및 로컬 파일과 응답의 SHA-256 일치를 확인했다. 운영 데이터 변경 없이 Chrome 320·390·768·1280px에서 6개 페이지 24개 레이아웃과 메모리 fixture 24개, 혼합 선택·이벤트 선택·긴 NAS 경로·미연결 16개 레이아웃을 검증했다. 가로 넘침·컨트롤 클리핑·브랜드/상태 겹침·앱 콘솔 오류는 0건(favicon 404 제외)이다. 390×844·768×1024·1280×800에서 작업 3개 페이지의 첫 파일 행 전체 노출, 탭 키보드 이동·DOM/스크롤 보존과 위험 구역 배지 대비 **7.87:1**을 확인했다. 768px 선택 바는 줄바꿈하고 760px 이하 이벤트 목록은 높이를 제한해 스크롤하며, 폴더 링크 규칙은 바꾸지 않았다. 디자인 탐지기의 4개 경고는 기존 결과 배너 3개와 승인 설계에 명시된 위험 구역 4px 경계선 1개다. 실제 NAS 파일 업로드·삭제는 이 UI 검증에서 실행하지 않았다.

한 부문만 실행할 때는 마지막 백엔드 명령을 `python -m unittest test_transfers -v`처럼 지정한다. 테스트는 외부 SSH·OMV 연결을 모의 객체 또는 로컬 SFTP 대역으로 대체한다.

2026-11-24 기준 위의 네트워크 차단·읽기 전용 테스트 컨테이너 명령으로 백엔드 unittest **153개**(업로드 12개 포함, `test_concurrency.py` 23개, `test_incoming_cleanup.py` 11개, `test_incoming_workflow.py` 6개, `test_media_preview.py` 10개 포함)와 프론트엔드 `node --test` **46개**(업로드 17개 포함)가 모두 통과했다. 이전 검증에서는 별도 임시 디렉터리와 격리 Compose 프로젝트에서 `api` `/managed-preview` 읽기 전용 마운트, 워커 스캔 지문 일관성, Nginx 프록시 경유 `HEAD`·단일 `Range`(`206`)·`If-Range`·`416`(`bytes */N`)·다중 `Range`(`400`)·`405`와 `MEDIA_HEADERS`를 확인했고, 메모리 fixture 기반 헤드리스 Chrome에서 390×320·320×320·320×240(200% 확대) 오류 버튼 비클리핑/클릭 가능 여부와 폴링 자동 닫힘 후 `#event-search` 포커스 복귀도 검증했다. 실제 OMV 연결과 실기기/브라우저 실제 코덱(HEVC 등) 재생 검증은 수동 확인 항목으로 남긴다.

## 테스트 범위

썸네일 재로딩 회귀 테스트는 Incoming 표·카드와 이벤트 목록의 폴링·체크박스·검색·상태 변경에서 `<img>` 노드 동일성, 파일 추가·순서 변경·삭제 후 남은 행 보존, 썸네일 URL·보기 모드·필터 포함 여부 변경 시 필요한 DOM 교체를 확인한다. WeakMap 슬롯 캐시와 키 기반 행 조정, 세 페이지의 제자리 선택 갱신에서 선택 클래스·전체 선택의 indeterminate·작업 레인별 버튼 잠금·검색 포커스·스크롤도 검증한다. Nginx 문법 검사·리로드 후 실제 썸네일 200 및 조건부 304의 불변 캐시·nosniff, 없는 썸네일 404의 장기 캐시 부재·nosniff를 확인했다.

Incoming 회귀 테스트는 실제 FastAPI HTTP 경로의 중복 정리 계획·작업 등록과 200/202/400/409/422 응답, 워커 파일 정리, SFTP 배치 장애와 종료 예외, 승격된 중복의 동반 파일 처리, 조회 중 폴링·취소·상태 경합, 409 상태 재조회, 기본 404 재빌드 안내, 결과 자동 펼침과 루트 파일명 중복 방지를 포함한다. `docker compose up -d --build` 후 API healthy·worker/frontend Up과 더미 ID `{"ids":["nonexistent"]}`를 보낸 정리 계획 API의 HTTP 409 JSON 응답을 확인했다. 이전 격리 HTTP·워커 실행에서는 테스트 MP4 7개를 검사하고 중복 6개를 정리한 뒤 지정한 사본과 XMP 보존을 확인했고, Chrome 테스트 데이터로 넓은 화면과 320px 화면의 일괄 선택, 보존 사본 변경, 확인창, 완료 결과를 확인했다.

| 파일 | 주요 검증 |
| --- | --- |
| [test_jobs_api.py](../backend/test_jobs_api.py) | 작업 내역 HTTP 검증, 전체 집계·빈 DB, keyset 커서, 필터, 손상 JSON, payload 비노출, 상세 100건 절단·우선순위 |
| [test_phase1_ui.cjs](../frontend/test_phase1_ui.cjs) | 결과 닫기·저장소 오류·재사용 ID, 기기 이력 상한, 작업 내역 영속 셸·상세 DOM·요청 순서·페이지 보존·실시간 전환, 이벤트 단일 확정, 탭 키보드·IME·검색 debounce |
| [test_incoming_cleanup.py](../backend/test_incoming_cleanup.py) | 로컬·같은 검사·원격 사본 선택, 원격 범위와 SHA-256, 변경·누락·연결 실패, 배치 중 SFTP 단절 후 채널 재사용 방지·로컬 정리 지속, 연결 종료 예외에도 완료 결과·그룹 갱신 보존, 삭제 직전 원격 404→409 변환, 중단 후 재실행, 동반 파일 보존 |
| [test_incoming_workflow.py](../backend/test_incoming_workflow.py) | 검사 단계와 파일 수, 2단계 파일 변경 시 낡은 SHA·지문·썸네일 제거, 중복→이동 가능 승격 시 XMP·보조 파일 계획과 scan_xmp 정합성, 모호한 보조 파일 보존, 이동·삭제·XMP 파일별 결과, 이미 보관된 XMP |
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

기기 업로드 운영 검증에서는 Compose 재빌드·API healthy·Nginx 설정 검사/리로드, 두 preview 마운트 쓰기 EROFS와 upload 쓰기 성공, Nginx 경유 DNG 415·2청크 PUT 200·complete 201·미완료 DELETE 200을 확인했다. staging 잔여와 smoke_upload_check 폴더는 제거했고 Chrome fixture는 320·390·430·550·760·1280px에서 가로 넘침 없음과 최소 44px 버튼을 확인했다.
