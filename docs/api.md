# API

## 공통 규칙

Nginx를 통하는 기본 주소는 `http://127.0.0.1:8888`이고 모든 앱 API는 `/api` 아래에 있다. 요청·응답은 별도 표시가 없으면 JSON이다. FastAPI 자동 문서는 API 컨테이너의 `/docs`, OpenAPI는 `/openapi.json`에 생성되지만 현재 Nginx는 이 경로를 API로 프록시하지 않는다.

파일 ID와 이벤트 ID는 화면 상태 응답에서 가져온다. 임의의 로컬 절대경로로 파일을 조작하는 API는 없다. 인증·세션·사용자별 권한 검사는 구현되어 있지 않다.

| 코드 | 주요 의미 |
| --- | --- |
| `200` | 조회·수정·취소 요청 처리 |
| `201` | 이벤트 또는 SSH 키 생성 |
| `202` | 비동기 작업 등록. 응답의 `id`는 작업 ID |
| `400` | 유효하지 않은 이름·시간대·경로·요청 조합 |
| `401`, `403` | SSH 인증 또는 접근 권한 문제 |
| `404` | 파일·이벤트·작업·원격 경로가 없음 |
| `409` | 검사 결과·파일·설정 변경, 경로 충돌, 활성 작업 존재 |
| `413` | 복원 파일 128MiB 초과 또는 원격 한 폴더 항목 10,000개 초과 |
| `422` | Pydantic 요청·쿼리 검증 실패 |
| `502`, `504` | 원격 연결·프로토콜 오류 또는 시간 초과 |

일반 앱 오류는 `{"detail":"설명"}`이고 요청 모델 검증 오류의 `detail`은 배열일 수 있다. 비동기 작업의 처리 실패는 작업 상태·결과에서 확인한다. 전체 작업을 합쳐 `queued` 또는 `running`인 작업은 하나만 허용한다.

## 화면 상태와 Incoming

| 메서드 | 경로 | 입력 | 반환·동작 |
| --- | --- | --- | --- |
| GET | `/api/health` | 없음 | `{"status":"ok"}` |
| GET | `/api/state` | 없음 | 기본 시간대, 최근 완료 검사, Incoming, 마지막 작업, 이벤트, 보관 파일, 대기 XMP |
| POST | `/api/jobs/scan` | 없음 | `202 {"id":작업ID}`. `scan` 등록 |
| POST | `/api/jobs/move` | `{"ids":["파일ID"]}` | `202`. 최근 완료 검사에서 `ready`인 원본만 이동 등록 |
| POST | `/api/jobs/delete` | `{"ids":["파일ID"]}` | `202`. 최근 검사에서 `ready`·`duplicate`인 사진만 삭제 등록 |
| POST | `/api/jobs/offload` | `{"ids":["보관파일ID"]}` | `202`. 원격 아카이브에 검증된 사본(연결 XMP 포함)이 있는 `available` 파일의 로컬 원본 비우기 등록 |
| POST | `/api/jobs/xmp-link` | `{"links":[{"id":"XMP검사ID","media_id":"보관파일ID"}]}` | `202`. 현재 연결 후보에 있는 원본으로 XMP 연결 등록 |
| GET, HEAD | `/api/incoming/{file_id}/original` | 경로 ID | 원본 응답. 범위 요청은 `FileResponse`가 처리 |
| GET | `/api/incoming/{file_id}/preview` | 경로 ID | HEIC·HEIF는 최대 2200×2200 JPEG, 나머지는 원본 응답 |

`/api/state`의 주요 필드는 다음과 같다.

| 필드 | 내용 |
| --- | --- |
| `timezone` | 기본 시간대 |
| `scan` | 가장 최근 `done`인 `scan` 작업 또는 `null` |
| `incoming` | 해당 검사의 파일 목록. `moved`·`deleted`는 제외 |
| `job` | 종류와 관계없이 가장 최근 작업 또는 `null` |
| `events` | `id`, `name`, `folder`, `parent`, `start`, `end`, `zone` |
| `managed` | `available`·`archived` 원본의 보관 상태(`status`), 장비·촬영 시각·이벤트·확정 여부·아카이브 사본·다운로드/오프로드 가능 여부·썸네일·XMP |
| `pendingXmp` | 최근 검사에서 아직 `linked`가 아닌 XMP와 연결 후보 |

작업 표현은 `id`, `kind`, `status`, `finishedAt`, `result`를 포함한다. 상태는 `queued`, `running`, `done`, `failed`, `cancelled`다. `result`는 작업 종류별 집계·진행 정보로 구성한다. 파일 크기는 `incoming[].size`, `managed[].size`에서는 **십진 MB**이고 파일 기록·원격 목록·전송량 필드에서는 바이트이므로 혼용하지 않는다.

Incoming 미리보기는 최근 완료 검사에서 `ready`·`duplicate`인 파일에만 허용한다. 노출 가능한 검사 항목이나 fingerprint가 없으면 404, 기록과 실제 파일의 상태가 다르면 409다. 정상 원본·미리보기 응답은 `private, no-store`와 `nosniff`를 설정한다.

선택 요청의 `ids`는 최소 한 개가 필요하며 같은 ID는 한 번만 처리한다. XMP 연결의 `links`도 최소 한 개가 필요하다. 한 요청에 같은 XMP ID나 같은 원본 ID를 여러 번 지정하면 400이다.

## 이벤트·배치·촬영 정보

| 메서드 | 경로 | 입력 | 동작 |
| --- | --- | --- | --- |
| POST | `/api/events` | 이벤트 생성 모델 | `201 {"event":…, "collection":…}`. 최상위 이벤트는 생성 시 기간 수집도 실행 |
| PUT | `/api/events/{event_id}` | 이벤트 필드 | 수정한 이벤트 반환. 기존 배정 유지, 기간 재수집은 별도 |
| DELETE | `/api/events/{event_id}` | 없음 | `parentId`, `affectedFiles`, `deletedEvents` 반환 |
| POST | `/api/events/{event_id}/collect` | 없음 | 최상위 이벤트에 기간 수집. `collected`, `uncertain`, `overlapping` 반환 |
| POST | `/api/placements` | `{"ids":["파일ID"],"event_id":"이벤트ID"}` | 다른 이벤트로 배정한 파일은 `confirmed=0`. `count` 반환 |
| PATCH | `/api/media` | 선택 파일과 보정 필드 | 장비·촬영 시각 수정. `count`, `timeUpdated`, `timeSkipped` 반환 |
| POST | `/api/placements/confirm` | `{"ids":["파일ID"]}` | 이벤트·장비·폴더 충돌 검사 후 확정. `count` 반환 |

최상위 이벤트 생성 예시:

```json
{
  "name": "제주여행",
  "start": "2026-09-03",
  "end": "2026-09-05",
  "zone": "Asia/Seoul"
}
```

이벤트 이름은 1~60자이며 폴더에 쓸 수 없는 문자와 `.`·`..`를 거부한다. 최상위 이벤트는 시작일·종료일이 필요하고 양 끝 날짜를 포함한다. `parent_id`에 최상위 이벤트 ID를 주면 한 단계 소분류를 만든다. 소분류의 기간·시간대는 저장하지 않는다. 소분류 아래에 소분류를 만들 수 없다. PUT은 같은 필드를 받지만 `parent_id` 변경은 지원하지 않는다.

촬영 정보 보정 예시:

```json
{
  "ids": ["보관파일ID"],
  "device": "iPhone",
  "time_mode": "metadata",
  "zone": "Asia/Seoul"
}
```

`device`는 선택 필드이며 최대 80자다. 시각은 `time_mode`의 `metadata`·`modified`·`xmp` 중 하나를 사용하거나 `captured_at`을 직접 준다. `time_mode`와 `captured_at`을 함께 지정하면 400이다. 시간대 없는 직접 입력과 메타데이터에는 `zone`을 적용하고 사용자 시각을 UTC로 저장한다. 장비를 수정하면 확정 상태를 해제한다. API는 유효한 IANA 시간대를 받으며 화면의 선택 목록은 그 일부다.

XMP 시각은 최근 검사에서 연결한 XMP 메타데이터를 사용한다. `time_mode="xmp"`에 `skip_missing_xmp=true`를 함께 주면 XMP 시각이 있는 파일만 각각의 시각으로 보정하고, 나머지 파일의 기존 시각·출처를 보존한다. 함께 지정한 `device`는 선택 전체에 적용한다. 이 플래그의 기본값은 false로 기존의 전체 검증 방식을 유지한다. 다른 time_mode에 true를 지정하거나, true여도 적용할 XMP 시각이 하나도 없으면 400이며 장비 변경도 수행하지 않는다.

응답의 `timeUpdated`는 보정한 시각 수, `timeSkipped`는 XMP 시각이 없어 기존 시각을 유지한 수다. 장비만 수정하면 둘 다 0이다. 기존 `count`는 선택 파일 수로 유지한다. 장비를 선택하되 시각을 유지하려면 `device`만 보내고 시각 관련 필드는 생략한다.

## 아카이브 탐색과 전송

| 메서드 | 경로 | 입력 | 반환·동작 |
| --- | --- | --- | --- |
| GET | `/api/archive` | 쿼리 `path` (기본 `""`) | 저장 루트 안의 폴더 목록과 연결 식별자 |
| GET | `/api/archive/download` | 쿼리 `path` 또는 `media_id`(+`kind`) | 원격 아카이브 정규 파일의 SFTP 스트리밍 다운로드 (`attachment`, `no-store`) |
| POST | `/api/archive/transfers` | 전송 모델 | `202 {"id":작업ID,"count":파일수}` |
| POST | `/api/archive/transfers/{job_id}/cancel` | 없음 | `upload` 작업의 취소 요청 후 작업 상태 반환 |

폴더 조회 응답은 `root`, `path`, `entries`, `connectionVersion`을 포함한다. `entries`에는 `name`, `kind` (`folder`·`file`·`link`), `size`, `modified`가 있다. `size`는 일반 파일만 바이트 크기이고 나머지는 `null`이며, `modified`는 원격 수정 시각의 Unix 타임스탬프다. `connectionVersion`은 현재 설정 식별자로 업로드 요청의 `connection`에 전달한다. 루트 밖 경로·상위 경로 이동을 거부한다.

```json
{
  "connection": "<폴더 조회 응답의 64자 connectionVersion 값>",
  "items": [
    {"id": "보관파일ID", "kind": "media"},
    {"id": "보관파일ID", "kind": "xmp"}
  ],
  "source": [],
  "destination": ""
}
```

- `items`는 1~10,000개다. `kind` 기본값은 `media`이며 XMP는 별도 항목으로 지정한다.
- `source`는 현재 Source 폴더를 나타내는 문자열 배열이고 최대 3단계다. 항목은 해당 경로 아래에 속해야 한다.
- `destination`은 원격 루트 아래 상대 폴더다. 기본값은 루트다.
- 대상은 `destination + (논리적 파일 경로에서 source 접두 경로를 뺀 부분)`으로 결정한다.
- `available`이면서 확정된 원본과 그 XMP만 등록할 수 있다. 설정 식별자가 바뀌었거나 대상 경로가 중복되면 409다.
- 대기 작업 취소는 즉시 `cancelled`로 변경하고, 실행 중이면 `cancelRequested`를 설정해 워커가 확인한다. 이미 종료한 작업에는 상태 변경 없이 응답한다.

## 파일 기록

`GET /api/catalog`는 로컬 파일과 아카이브 이력을 별도 뷰로 조회한다.

| 쿼리 | 기본값 | 허용 값·범위 |
| --- | --- | --- |
| `view` | `files` | `files`, `archives` |
| `q` | 빈 문자열 | 최대 300자 검색어 |
| `scope` | `all` | `all`, `managed`, `incoming`, `xmp`, `verified`, `failed`, `unknown` |
| `page` | `1` | 1 이상. 마지막 페이지를 초과하면 마지막 페이지로 조정 |
| `page_size` | `50` | 1~100 |
| `event` | `all` | `all`, `unassigned`, 이벤트 ID |
| `device` | 빈 문자열 | 장비 표시 이름. 미확인은 `장비 미확인` |

로컬 파일 뷰는 `managed`, `incoming`, `xmp`, `verified` 범위를 적용하고 아카이브 뷰는 `xmp`, `verified`, `failed`, `unknown`을 적용한다. 그 밖의 조합은 추가 범위 조건 없이 조회한다. 반환값은 `view`, `rows`, `total`, `page`, `pages`, `pageSize`, `summary`, `folders`, `unassigned`다. 요약과 폴더 집계는 현재 검색·페이지 조건과 독립된 전체 집계다.

## 촬영도구 이름

- `GET /api/devices`: `{"devices":[{"source":"GoPro HERO8 Black","name":"GoPro8","count":3}]}`. `source`는 원래 자동 추출 이름, `name`은 적용 이름, `count`는 파일별 수동 지정 없이 해당 규칙을 적용하는 사용 가능한 원본 수다. 저장된 규칙은 현재 원본이 없어도 목록에 남는다.
- `PUT /api/devices/name`: `{"source":"GoPro HERO8 Black","name":"GoPro8"}`로 규칙을 저장하고 갱신한 목록을 반환한다. 이름은 1~80자이며 내부 공백은 유지한다. 앞뒤 공백 제거와 NFC 정규화 후 폴더명을 검증한다.
- 찾을 수 없는 원래 이름은 404, 업로드 대기·실행 중이거나 다른 장비·관련 소분류의 폴더명과 충돌하면 409다. 빈 이름·잘못된 문자는 400 또는 요청 모델 검증 422다. 원래 메타데이터와 파일별 지정은 수정하지 않는다.

## 설정과 카탈로그

| 메서드 | 경로 | 입력 | 동작 |
| --- | --- | --- | --- |
| GET | `/api/settings` | 없음 | 주소·루트·설정 여부. 계정·공개키는 `***` |
| PUT | `/api/settings/storage` | `{"address":"192.0.2.10"}` | IPv4·IPv6 주소 저장. 호스트명과 scope ID는 거부 |
| PUT | `/api/settings/storage/root` | `{"path":"/archive"}` | 원격 POSIX 절대경로 저장 |
| POST | `/api/settings/ssh-key` | 없음 | `201`. 새 Ed25519 키 생성. 기존 키가 있으면 교체 |
| POST | `/api/settings/ssh-key/public` | 없음 | 최초 복사 완료 표시 전 `publicKey` 반환 |
| POST | `/api/settings/ssh-key/copied` | 없음 | 공개키 복사 완료 표시 저장 |
| POST | `/api/settings/ssh-test` | 없음 | 공개키 접속 확인 또는 최초 호스트 키 확인 요청 |
| POST | `/api/settings/ssh-test/trust` | `{"token":"확인토큰"}` | 유효한 확인 요청의 호스트 키 저장 후 공개키 접속 확인 |
| DELETE | `/api/settings/ssh-host-key` | 없음 | 현재 IP에 저장된 SSH 호스트 키 초기화 (활성 `upload`·`offload` 작업 중에는 409) |
| GET | `/api/settings/catalog/backup` | 없음 | SQLite 백업 파일 다운로드 |
| POST | `/api/settings/catalog/reset` | `{"confirmation":"모든 데이터 삭제"}` | `202 {"id":작업ID,"kind":"reset-all","status":"queued"}`. 전체 로컬 데이터 초기화 등록 |
| POST | `/api/settings/catalog/restore` | SQLite 파일의 원시 요청 본문 | `{"restored":true}`. multipart 업로드가 아님 |

최초 접속 테스트는 `status=confirm_host`, `algorithm`, `fingerprint`, `token`을 반환한다. 토큰은 300초 동안 유효하며 IP 변경 시 사용할 수 없다. 인증 성공은 `{"status":"connected"}`다. 설정·원격 탐색·파일 기록·백업 응답은 `Cache-Control: no-store`를 설정한다.

초기화 확인 문구는 **모든 데이터 삭제**다. 이전 문구 `초기화`와 누락·오입력은 422로 거부한다. 다른 활성 작업이 있으면 409다. 초기화 중에는 GET·HEAD·OPTIONS 외의 요청도 409로 차단한다. 기존 `/api/settings/catalog/return-managed`는 제거했다.

워커의 `reset-all` 작업은 managed·썸네일·서버 임시 파일을 삭제한 뒤 DB의 모든 행과 현재 작업 자체를 삭제한다. `/api/state.job.result`에는 처리 중 `phase`, `deletedFiles`, `deletedDirectories`를 제공하며 실패 시 `error`를 기록한다. 성공하면 `job`이 `null`이 되며 완료 이력을 남기지 않는다. 클라이언트는 활성 reset-all 이후 job이 사라지는 것으로 완료를 표시한다. 자동 검사·백업·파일 이동·해시 계산은 수행하지 않는다.

incoming 디렉터리와 모든 파일·하위 폴더, SSH 설정·키와 원격 아카이브는 유지한다. 파일 삭제는 되돌릴 수 없고 중간 실패의 파일 롤백은 없다. DB 삭제는 한 트랜잭션으로 처리한다. 실패한 작업은 오류를 기록해 재실행할 수 있게 남는다. 응답은 `no-store`다.

구현 위치: [api.py](../backend/api.py), [settings.py](../backend/settings.py), [archive.py](../backend/archive.py), [transfers.py](../backend/transfers.py), [offload.py](../backend/offload.py), [records.py](../backend/records.py).
