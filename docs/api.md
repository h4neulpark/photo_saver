# API

## OMV 원격 종료

종료 API는 오류·검증 실패를 포함해 `Cache-Control: no-store`를 반환한다. 접수 중 HA/SSH 네트워크 호출은 없으며, POST는 완료가 아닌 작업 접수를 뜻한다.

| 메서드 | 경로 | 계약 |
| --- | --- | --- |
| POST | `/api/storage/shutdown` | 필수 JSON `{"requestId":"UUID","targetRevision":"64자리 소문자 hex"}`; 추가 필드 거부(422). 202 `{"job":공개작업}` |
| GET | `/api/storage/shutdown?request_id=UUID` | 200 `{"job":공개작업 또는 null}`; 원본 UUID·별칭 모두 조회. query 생략 시 최근 종료 작업 |
| POST | `/api/storage/shutdown/{id}/cancel` | 200 `{"job":공개작업}`; 미존재·다른 kind는 404. 이미 종료된 작업의 취소도 멱등 |

새 요청의 revision 불일치는 409 `target_changed`, remote/exclusive 충돌은 409 `remote_busy`, 원격 keeper를 가진 활성 중복 정리는 409 `remote_cleanup_busy`다. 반대로 원격 keeper 중복 정리 접수는 종료 작업 중 409 `storage_shutdown_active`다. 설정 문제는 409 `ha_not_configured|ha_shutdown_not_configured|ha_config_invalid|settings_busy`다. 동일 UUID는 종료 후에도 같은 작업을 반환하며 같은 대상의 활성 종료에 다른 UUID로 합류하면 별칭을 저장한다(별칭 128개 상한, 초과 429 `shutdown_request_limit`). 같은 UUID를 다른 revision에 재사용할 수 없다.

`GET /api/settings`의 `storageWake`·`storageShutdown`은 기존 `{available,reasonCode,message,timeoutSeconds,targetRevision}`에 `mode:"switch"|"script"`를 추가한다. 유효한 `PHOTO_SAVER_HA_POWER_SWITCH_ENTITY` 설정은 두 기능을 함께 활성화하며 레거시 스크립트 설정보다 우선한다. 잘못된 스위치는 `ha_config_invalid`로 차단한다. 종료 timeout은 기본 300초, 정수 30~1200초다. `/api/state.latestStorageShutdown`은 다른 원격 작업 이후에도 최근 종료 작업을 보존한다. `/api/jobs?kind=storage-shutdown`과 `status=attention`으로 이력을 확인한다. payload·별칭·HA 토큰은 공개하지 않는다.

공개 result는 `phaseCode/phase/message/outcome/code/detailCode/error/review/cancelRequested`, `attemptState/attemptCount/intentAt/receiptAt`, `haState/haFresh/haScriptState`, `sshState/sshConfigured/everSshStoppedAfterAttempt`, `startedAt/requestedAt/deadlineAt/checkedAt/elapsedSeconds/timeoutSeconds/targetRevision`를 사용한다. 단계는 `queued → checking_server → requesting → waiting_shutdown → waiting_power_off → complete`다. 파일 진행률은 없다.

추가 종료 result는 `controlMode`, `haPowerState`, `haPowerFresh`, `haRunningState`, `haRunningFresh`다. 스위치 모드에서는 `switch/turn_off`를 한 번만 요청하며, 완료는 신선한 전원 스위치 off와 SSH 응답 중단(주소가 없으면 스위치 off만)으로 판정한다. SSH·실행 센서가 먼저 멈춰도 `waiting_power_off`를 유지한다. 스위치 unknown/unavailable는 완료 증거가 아니다. preflight에서 스위치 on과 SSH 응답(주소 미설정 시 실행 센서 on 또는 404)이 없으면 요청하지 않으며, 미응답은 15초 후 `server_not_ready`, 불확실한 상태는 `response_unconfirmed`다.

성공은 `powered_off|already_off`(done, review=0), 부분 확인은 `ssh_stopped_ha_unconfirmed`(done, review=1)다. 실패는 `ha_request_failed|server_not_ready|response_unconfirmed|remote_cleanup_busy|shutdown_timeout|request_unknown|config_changed|interrupted|invalid_operation`(failed, review=1), 사용자 중지는 `cancelled`(cancelled, review=1)다. HA 인증·권한·엔티티·리다이렉트 오류 등은 detailCode에 보존한다. 취소는 확인 대기만 중단하며 이미 전송된 종료 스크립트는 계속 진행될 수 있다.

## OMV 원격 시작

세 API 모두 `Cache-Control: no-store`다. `/api/settings`, `/api/state`, 작업 내역과 아래 wake GET은 HA/SSH 요청이나 작업 등록을 하지 않는다. 화면의 독립 상태 모니터는 아래 `/api/storage/status`로 HA 상태와 비인증 SSH 도달성을 읽는다.

| 메서드 | 경로 | 계약 |
| --- | --- | --- |
| POST | `/api/storage/wake` | 필수 JSON `{"requestId":"UUID","targetRevision":"64자리 소문자 hex"}`. 추가 필드 거부(422). SSH 미설정도 허용 |
| GET | `/api/storage/wake?request_id=UUID` | `{"job":공개작업 또는 null}`. query 생략 시 최근 wake |
| POST | `/api/storage/wake/{id}/cancel` | `{"job":공개작업}`. 없는 ID/다른 종류 404. 종료 작업 반복 취소는 200 |

POST의 202 응답은 `id,kind:"storage-wake",lane:"remote",status,reused,targetRevision,requestedAt,deadlineAt`이다. 접수는 HA 전송이나 서버 기동 완료를 뜻하지 않는다. 동일 UUID·revision은 종료 후에도 같은 작업을 반환하며 다른 revision으로 UUID 재사용은 409 `wake_request_mismatch`다. 같은 설정의 진행 중 wake에 다른 UUID로 합류해도 동일 ID를 반환하고 별칭을 보존한다(작업당 최대 128개, 초과 429 `wake_request_limit`). 새로운 명시적 재시도에는 새 UUID를 사용한다. 브라우저는 응답 유실 시 UUID를 sessionStorage에 보존하고 GET으로 확인한다. 사용자 재시도 전 자동 POST는 없다.

새 요청의 설정 revision 불일치는 409 `wake_target_changed`, 다른 remote/exclusive 활동은 409 `remote_busy`, HA 누락/잘못된 설정은 503 `ha_not_configured`/`ha_config_invalid`, 설정 잠금 경합은 409 `settings_busy`다. 초기화 중에는 기존 middleware의 409가 우선한다. 로컬 작업은 함께 진행할 수 있다. GET `/api/state`의 `latestStorageWake`는 나중 원격 작업과 독립적으로 최근 wake를 유지하고 `/api/jobs?kind=storage-wake`로 이력을 조회한다. payload·UUID 별칭·HA URL/토큰은 공개하지 않는다.

공개 result는 schemaVersion 1, phaseCode/phase, targetRevision, requestedAt/deadlineAt/timeoutSeconds/elapsedSeconds, attemptState/attemptCount/intentAt/receiptAt, serverState/serverObservedAt/serverEvidenceAt, haState/haStateStale, archiveState/archiveObservedAt/archiveConnectionVersion, cancelRequested, outcome/message/code/review 및 실패·취소 시 error를 사용한다. 파일 수·바이트·진행률은 없다. `attemptState`는 `not_started|not_needed|observing_existing|intent|accepted|rejected|unknown`, attemptCount는 0/1이다. `serverState`는 `unknown|ha_reported_on|ssh_responding|archive_ready`, `haState`는 `on|off|unknown|unavailable|missing|unreachable`이다. `archiveState`는 `settings_required|checking|ready|unreachable|auth_failed|host_key_error|path_missing|permission_denied|not_directory|sftp_error`이다.

성공/주의 outcome은 `archive_ready`, `server_responding_settings_required`, `archive_blocked`, `archive_unconfirmed`(done), 실패 outcome은 `expired`, `startup_timeout`, `request_unknown`, `response_unconfirmed`, `ha_error`, `invalid_operation`(failed), 중지는 `config_changed`, `cancelled`(cancelled)다. HA 접수와 실제 접근 준비는 독립적이므로 unknown 접수 상태에서도 SFTP ready가 가능하다. queued 취소는 즉시 종료하고 running 취소는 flag를 저장한 뒤 I/O 프로세스를 종료·회수한 후 종료한다. 이미 보낸 기동 요청은 취소되지 않는다.

## OMV 현재 상태

스위치 모드에서는 HA 전원 스위치와 실행 센서를 동일 서브프로세스의 `get_many`로 순차 조회한다(최대 4개, 전체 4.5초 예산). 인증·DNS·TLS·리다이렉트·시간 초과·연결 실패 시 나머지 요청은 단락한다. `rawState`와 `ha`는 전원 스위치 기준이고, 선택 필드 `powerSwitch`·`runningSensor`는 각각 `{configured:boolean,status:"on"|"off"|"stale"|"unknown"|"error"|"unconfigured",reasonCode:string|null,reportedAt:string|null,changedAt:string|null}`이다. 엔티티 ID·URL·토큰·attributes는 반환하지 않는다. 스위치 변경 시 sourceRevision·캐시·lastKnown을 폐기한다.

스위치 on이고 실행 센서 off/unknown/stale이면 SSH 응답 시 `running/ha_lagging`, SSH 미응답·미설정이면 `booting/power_transitioning`(5초 재조회)이다. 이때 `ha.status=on`, `ha.reasonCode=power_transitioning`이다. 실행 센서 on 또는 404/error면 기존 HA on + SSH 결합 규칙을 쓴다. 스위치 off/stale/unknown/error는 아래 기존 표와 동일하다. 스위치 unknown/unavailable/404의 사유는 `switch_unknown|switch_unavailable|switch_missing`이며 실행 센서 404는 `sensor_missing`이다.

켜기 result에 `controlMode`, `haPowerState`가 추가된다. 스위치 on이면 `observing_existing`으로 관찰하며 POST하지 않는다. HA만으로 켜기 완료를 판단하거나 HA on 이력을 저장할 때는 신선한 실행 센서 on만 인정한다. 켜기는 `switch/turn_on`, 종료는 `switch/turn_off`, 레거시는 `script/turn_on`만 허용하며 서비스와 대상 엔티티 도메인이 다르면 요청을 거부한다.

`GET /api/storage/status`는 HA 센서 GET과, 저장된 IP가 있으면 TCP 22의 SSH 배너 확인을 병행한다. SSH는 인증·SFTP·디스크 접근 없이 최대 256바이트만 읽으며 HA 미설정이어도 수행한다. `?refresh=true`는 5초 재조회 간격이 허용할 때 새 조회를 수행한다. 센서 갱신·서비스·기동은 실행하지 않으며 작업/DB/설정 잠금/워커에 의존하지 않는다. 예상 오류도 HTTP200, 잘못된 bool query는 422, 모든 응답은 `Cache-Control: no-store`다.

기존 응답 필드 `status`, `reasonCode`, `rawState`, `fetchedAt`, `checkedAt`, `reportedAt`, `reportedAtSource`, `cached`, `sourceRevision`, `freshForSeconds`, `nextPollInSeconds`, `refreshAvailableInSeconds`, `lastKnown`을 유지한다. `changedAt`, `ha:{configured,status,reasonCode,reportedAt,changedAt}`, `ssh:{configured,status,latencyMs}`를 추가한다. HA status는 `on|off|stale|unknown|error|unconfigured`, SSH status는 `reachable|unreachable|unconfigured`, latencyMs는 숫자 또는 null이다. 최상위 status는 `running|booting|no_response|unknown|stale|unconfigured`, rawState는 `on|off|unknown|unavailable|null`이다. sourceRevision은 불투명 임의 값이며 HA 구성·SSH 주소·신선도 정책 변경 시 캐시와 이력을 폐기한다. lastKnown은 같은 구성의 과거 HA 사실 `{rawState,reportedAt,fetchedAt}` 또는 null이다.

HA `last_reported`가 있으면 그것만 사용하며 필드가 없을 때만 `last_updated`를 사용한다. `last_changed`는 진단용 changedAt이며 신선도의 근거가 아니다. 보고 시각 파싱 실패는 `report_time_invalid`, 30초 넘는 미래는 `report_time_future`다. 기본 `PHOTO_SAVER_HA_STALE_SECONDS=0`은 나이 제한을 끄므로 24시간 같은 상태여도 정상이다. 양수일 때만 그 초수를 넘으면 `report_stale`이다. freshForSeconds는 기본 null, 양수 정책에서는 남은 초(0..설정값)다. unknown/unavailable는 `sensor_unknown|sensor_unavailable`, 401/403은 `ha_auth_error`, 404는 `sensor_missing`, 3xx는 `ha_redirect_blocked`, 5xx는 `ha_http_5xx`, TLS/DNS/timeout은 `ha_tls_error|ha_dns_error|ha_timeout`, 연결 실패는 `ha_unreachable`, 스키마 오류는 `ha_response_invalid`다.

| HA | SSH 도달 | SSH 응답 없음 / 미설정 |
| --- | --- | --- |
| on | running | booting(`ssh_unreachable`) / running |
| off | running(`ha_lagging`) | no_response |
| unconfigured | running | no_response / unconfigured(`ha_not_configured`) |
| stale | running | stale(HA 사유) |
| unknown / error | running(HA 사유) | unknown(HA 사유) |

nextPollInSeconds와 캐시는 config_changed 1초, booting 5초, running/no_response 15초, unknown/stale 30초, unconfigured 60초다. 진행 중 조회 합류는 cached=false이며 기존 레코드를 반환할 때만 true다. HA I/O는 4.5초, SSH 배너는 2.5초 예산으로 병행하고 대기자는 5.5초 제한을 가진다. fetchedAt은 실제 조회 완료 시각, checkedAt은 판정 시각이다. 브라우저는 양수 신선도에서 왕복 시간을 빼 단조 시계로 만료시킨다. URL/token/헤더/속성/상위 오류 본문은 응답하지 않는다. wake의 인증된 SSH/SFTP 검증은 최대 12초이며 설정 잠금 밖에서 실행한다. 기동 후 path_missing/sftp_error는 waiting_mount로 최대 30초 기다리고, 인증·권한 오류는 즉시 archive_blocked로 종료한다. 기동 중 HA on 증거는 래치하여 나중 timeout을 archive_unconfirmed로 구별하며 wake result.code에 ha_http_401/403/404 등 상세 원인을 보존한다.

## 기기 → Incoming 청크 업로드

사진 JPG·JPEG·PNG·WEBP·HEIC·HEIF, 영상 MP4·MOV, 동반 파일 XMP·THM·LRV·AAE를 허용한다. 모든 업로드 응답(오류 포함)에 Cache-Control: no-store와 X-Content-Type-Options: nosniff를 적용한다. 워커 작업을 생성하지 않으며 기존 reset-all 쓰기 차단(409)을 따른다.

| 메서드 | 경로 | 입력 | 반환 |
| --- | --- | --- | --- |
| POST | /api/incoming/uploads | {"name":"IMG_0001.HEIC","size":123,"folder":"trip","last_modified_ms":1740000000000} | 201 {uploadId,name,folder,expectedSize,receivedBytes:0,chunkSize:8388608,maxChunkBytes:33554432} |
| GET | /api/incoming/uploads/{upload_id} | 32자리 소문자 hex ID | 200 {uploadId,name,folder,expectedSize,receivedBytes}. 실제 임시 파일 크기 |
| PUT | /api/incoming/uploads/{upload_id}/chunks?offset=0 | application/octet-stream 청크 | 200 {uploadId,receivedBytes,expectedSize} |
| POST | /api/incoming/uploads/{upload_id}/complete | 없음 | 201 {path,name,folder,originalName,renamed,sizeBytes,kind,modifiedAt} |
| DELETE | /api/incoming/uploads/{upload_id} | 없음 | 200 {"cancelled":true}. 없는 세션에도 멱등. 현재 전송 잠금 중이면 409 후 재시도 |

folder 기본값은 빈 문자열(루트), last_modified_ms 기본값은 null이다. 이름·폴더는 앞뒤 공백 제거와 NFC 정규화를 거친다. 이름은 UTF-8 220바이트 이하, 폴더는 180자·6단계 이하 상대경로이며 숨김·상위 경로·빈 중간 세그먼트·금지 문자를 거부한다. 파일 크기는 양의 정수, 기본 최대 100GiB이다. 미지원 확장자는 415, 잘못된 요청/ID는 400, 없는 세션은 404, 마운트 없음/쓰기 불가는 503이다.

청크는 기본 8MiB, 최대 32MiB이며 빈 청크·파일 크기 초과는 400, 파일/청크 한도 초과는 413이다. 오프셋 불일치는 409 {"detail":"전송 오프셋이 일치하지 않습니다.","expectedOffset":현재크기}로 동기화한다. 수신 중 단절·취소·쓰기 오류는 청크 시작 오프셋으로 롤백한다. 세션 잠금 경합과 미완료 게시 요청은 409다.

완료 전 파일은 숨김 .photo-saver-uploads/ 폴더에만 존재하여 검사 대상에서 제외된다. 완료 시 폴더를 안전하게 생성하고 기존 파일을 덮어쓰지 않으며 NFC·대소문자 충돌 시 이름 (1).확장자부터 (9999)까지 시도한다. kind는 photo, video, companion이다. 수정시각은 1980-01-01 이상·서버 현재 시각 +1일 이하인 값만 보존한다. 최초 요청에서 파일 크기 +64MiB 여유 공간을 확인하며 부족/ENOSPC는 507이다. 유휴 2시간 초과 세션은 기동 시 및 신규 요청의 10분 간격 청소에서 잠금 획득 가능한 경우에만 제거한다.


## 공통 규칙

Nginx를 통하는 기본 주소는 `http://127.0.0.1:8888`이고 모든 앱 API는 `/api` 아래에 있다. 요청·응답은 별도 표시가 없으면 JSON이다. FastAPI 자동 문서는 API 컨테이너의 `/docs`, OpenAPI는 `/openapi.json`에 생성되지만 현재 Nginx는 이 경로를 API로 프록시하지 않는다.

파일 ID와 이벤트 ID는 화면 상태 응답에서 가져온다. 임의의 로컬 절대경로로 파일을 조작하는 API는 없다. 인증·세션·사용자별 권한 검사는 구현되어 있지 않다.

| 코드 | 주요 의미 |
| --- | --- |
| `200` | 조회·수정·취소 요청 처리 |
| `201` | 이벤트·SSH 키·Incoming 업로드 세션 생성 또는 업로드 완료 |
| `202` | 비동기 작업 등록. 응답의 `id`는 작업 ID |
| `206` | 바이트 범위(`Range`) 부분 응답 |
| `400` | 유효하지 않은 이름·시간대·경로·요청 조합·잘못된 또는 다중 `Range` |
| `401`, `403` | SSH 인증 또는 접근 권한 문제 |
| `404` | 파일·이벤트·작업·원격 경로가 없음 |
| `405` | 허용하지 않는 HTTP 메서드 (예: `HEAD /api/managed/{file_id}/preview`) |
| `409` | 검사 결과·파일·설정 변경, 경로 충돌, 활성 작업 존재 |
| `413` | 복원 파일 128MiB 초과, Incoming 파일·청크 한도 초과 또는 원격 한 폴더 항목 10,000개 초과 |
| `415` | 지원하지 않는 확장자이거나 파일 종류(`kind`)와 확장자가 불일치 |
| `416` | 요청한 바이트 범위가 파일 크기를 벗어남 (`Content-Range: bytes */N`) |
| `422` | Pydantic 요청·쿼리 검증 실패 |
| `502`, `504` | 원격 연결·프로토콜 오류 또는 시간 초과 |

일반 앱 오류는 `{"detail":"설명"}`이고 요청 모델 검증 오류의 `detail`은 배열일 수 있다. Starlette `FileResponse`가 직접 반환하는 `400`/`416` 범위 오류는 `text/plain`일 수 있으며, `HEAD` 오류 응답은 본문을 보내지 않는다. 비동기 작업의 처리 실패는 작업 상태·결과에서 확인한다. `local`과 `remote`마다 `queued` 또는 `running` 작업을 하나씩 허용한다(1+1 병렬). 같은 레인 충돌은 해당 레인의 작업 안내를 409 `detail`로 반환한다. `exclusive` (`reset-all`)는 모든 레인과 상호 배제하며 동기 카탈로그 백업·복원도 전체 배타 잠금을 사용한다.

## 화면 상태, Incoming 및 보관 파일 미리보기

| 메서드 | 경로 | 입력 | 반환·동작 |
| --- | --- | --- | --- |
| GET | `/api/health` | 없음 | `{"status":"ok"}` |
| GET | `/api/state` | 없음 | 기본 시간대, 최근 완료 검사, Incoming, 마지막 작업, 이벤트, 보관 파일, 대기 XMP |
| GET | `/api/jobs` | `limit`, `before_id`, `lane`, `status`, `kind` | 최신 작업 내역·커서·전체 집계, `Cache-Control: no-store` |
| POST | `/api/jobs/scan` | 없음 | `202 {"id":작업ID,"lane":"local"}`. `scan` 등록 |
| POST | `/api/jobs/move` | `{"ids":["파일ID"]}` | `202`. 최근 완료 검사에서 `ready`인 원본만 이동 등록 |
| POST | `/api/jobs/delete` | `{"ids":["파일ID"]}` | `202`. 최근 검사에서 `ready`·`duplicate`인 사진만 삭제 등록 |
| POST | `/api/incoming/duplicates/plan` | `{"ids":["중복파일ID"]}` | 최근 검사에 근거한 해시별 정리 대상과 남길 사본 후보 |
| POST | `/api/jobs/duplicate-cleanup` | `{"items":[{"id":"중복파일ID","keeperKind":"managed","keeperId":"사본ID"}],"deleteAux":true}` | `202`. 선택한 사본 검증 및 중복 정리. `deleteAux` 생략 시 `false` |
| GET | `/api/incoming/aux/plan` | 없음 | 라이브 THM·LRV·AAE 분류·지문·용량 계획. `Cache-Control: no-store` |
| POST | `/api/jobs/aux-cleanup` | `{"items":[{"path":"clip.LRV","fingerprint":"[1,2,3,4,5]"}]}` | `202`, `{"id":작업ID,"lane":"local","count":선택수}`, `Cache-Control: no-store` |
| POST | `/api/jobs/offload` | `{"ids":["보관파일ID"]}` | `202`. 원격 아카이브에 검증된 사본(연결 XMP 포함)이 있는 `available` 파일의 로컬 원본 비우기 등록 |
| POST | `/api/jobs/xmp-link` | `{"links":[{"id":"XMP검사ID","media_id":"보관파일ID"}]}` | `202`. 현재 연결 후보에 있는 원본으로 XMP 연결 등록 |
| GET, HEAD | `/api/incoming/{file_id}/original` | 경로 ID | Incoming 원본 응답. 범위 요청은 `FileResponse`가 처리 |
| GET | `/api/incoming/{file_id}/preview` | 경로 ID | HEIC·HEIF는 최대 2200×2200 JPEG, 나머지는 원본 응답 |
| GET, HEAD | `/api/managed/{file_id}/original` | 경로 ID | 보관(`available`) 원본 응답. 단일 바이트 `Range` 및 지문 기반 `ETag`/`If-Range` 지원 |
| GET | `/api/managed/{file_id}/preview` | 경로 ID | HEIC·HEIF는 최대 2200×2200 JPEG(`200` 전체 응답, `Range` 무시), 나머지는 원본과 동일 (`HEAD`는 `405`) |

`/api/state`의 주요 필드는 다음과 같다.

| 필드 | 내용 |
| --- | --- |
| `timezone` | 기본 시간대 |
| `scan` | 가장 최근 `done`인 `scan` 작업 또는 `null` |
| `incoming` | 해당 검사의 파일 목록. Incoming 기준 `path`, 중복 근거 `duplicateSource`, 동반 파일의 `companions`와 처리 상태를 포함한다. `moved`·`deleted`는 제외 |
| `latestIncomingResult` | 검사 이후에도 조회 가능한 최근 Incoming 처리 작업 또는 `null`. 이동·삭제·중복 정리·보조 파일 정리·XMP 연결의 결과를 제공 |
| `jobs` | `{local, remote, exclusive}`: 레인별 최신 작업 또는 `null` |
| `activeJobs` | `{local, remote, exclusive}`: 레인별 현재 `queued`·`running` 작업 또는 `null` |
| `job` | 하위 호환: 활성 exclusive → 활성 local/remote 중 가장 큰 id → 전체 최신 작업 → `null` |
| `events` | `id`, `name`, `folder`, `parent`, `start`, `end`, `zone` |
| `managed` | `available`·`archived` 원본의 보관 상태(`status`), 장비·촬영 시각·이벤트·확정 여부·아카이브 사본·다운로드/오프로드 가능 여부·썸네일·XMP·미리보기/원본 URL(`preview`, `original`, 로컬 `available`이며 지문·형식이 유효할 때만 문자열이고 `archived` 등은 `null`) |
| `pendingXmp` | 최근 검사에서 아직 `linked`가 아닌 XMP와 연결 후보 |

`scan`·`move`·`delete`·`duplicate-cleanup`·`aux-cleanup`·`xmp-link` 등록은 `lane: "local"`, `upload`·`offload`·`remote-index` 등록은 `lane: "remote"`를 반환한다. 활성 offload의 대상 media_id에는 XMP 연결을 409로 거부한다. 활성 중복 정리에서 남길 managed 사본도 offload 대상으로 등록할 수 없다. 취소 API는 명시한 작업 ID에만 적용한다.

작업 표현은 `id`, `kind`, `lane`, `status`, `createdAt`, `finishedAt`, `result`를 포함한다. 상태는 `queued`, `running`, `done`, `failed`, `cancelled`다. `result`는 작업 종류별 집계·진행 정보로 구성한다. 파일 크기는 `incoming[].size`, `managed[].size`에서는 **십진 MB**이고 파일 기록·원격 목록·전송량 필드에서는 바이트이므로 혼용하지 않는다.

### 작업 내역: `GET /api/jobs`

`view_job`은 `/api/state`와 작업 응답에 `createdAt`(DB `created_at`)을 제공한다. 손상된 JSON, NULL, 배열 등 객체가 아닌 `result`는 `{}`로 응답한다.

| 쿼리 | 기본값 | 허용값 |
| --- | --- | --- |
| `limit` | `30` | 정수 1–100 |
| `before_id` | 없음 | 1 이상 ID. `id < before_id` 조회 |
| `lane` | `all` | `all`, `local`, `remote`, `exclusive` |
| `status` | `all` | `all`, `active`, `attention`, `done`, `failed`, `cancelled` |
| `kind` | `all` | `all`, `scan`, `move`, `delete`, `duplicate-cleanup`, `aux-cleanup`, `xmp-link`, `upload`, `offload`, `remote-index`, `reset-all` |

잘못된 쿼리는 HTTP 422다. ID 내림차순으로 최대 `limit`건을 반환하고, 다음 페이지가 있을 때 `hasMore: true`, `nextBeforeId: 마지막 반환 ID`를 제공한다. 마지막 페이지의 `nextBeforeId`는 `null`이다. 커서는 새 작업이 추가되어도 앞 페이지와 중복되지 않는다.

```json
{
  "jobs": [{
    "id": 12, "kind": "move", "lane": "local", "status": "done",
    "createdAt": "2026-11-25T00:00:00+00:00", "finishedAt": "2026-11-25T00:01:00+00:00",
    "result": {"moved": 1, "items": [{"path": "photo.jpg", "status": "moved"}]},
    "hasAttention": false,
    "resultMeta": {"itemsTotal": 1, "itemsShown": 1, "itemsTruncated": false,
      "errorsTotal": 0, "errorsShown": 0, "errorsTruncated": false,
      "unmatchedCompanionsTotal": 0, "unmatchedCompanionsShown": 0, "unmatchedCompanionsTruncated": false}
  }],
  "nextBeforeId": null, "hasMore": false,
  "summary": {"total": 1, "active": 0, "attention": 0, "done": 1}
}
```

`active`는 queued/running이다. `attention`은 종료한 작업 중 failed/cancelled이거나 `result.error`가 있거나 `failed`·`review`·`companionReview`가 0보다 큰 경우다. `done` 필터는 상태가 done인 모든 작업을 포함하므로 확인 필요 작업도 포함될 수 있다. `hasAttention`은 같은 판정을 각 항목에 제공한다. `summary`는 현재 필터·커서와 무관한 전체 서버 작업 집계이며 빈 DB에서는 모두 0이다. 기기 업로드는 서버 작업을 생성하지 않으므로 이 API에 포함되지 않는다.

응답은 `payload`를 조회하거나 반환하지 않는다. `result.items`, `result.errors`, `result.unmatchedCompanions`는 각각 최대 100건이며 DB 원본은 변경하지 않는다. `items`가 100건을 넘으면 moved/deleted/cleaned/linked 이외 항목과 객체가 아닌 항목을 우선 표시한다. `resultMeta`는 전체·표시 건수·절단 여부를 제공하며 items/errors의 6개 키는 항상 포함한다. 이력 응답에는 `Cache-Control: no-store`를 적용한다.

중복 정리 계획은 `groups`를 돌려준다. 그룹에는 `sha`, 선택한 `files` (`id`·`path`·`sizeBytes`, 기존 스키마 유지), 남길 수 있는 `keepers` (`kind`·`id`·`path`, 원격 검증 시각 `verifiedAt`), `auxCompanions` (`fileId`·`path`·`kind`·`sizeBytes`, 없으면 빈 배열)가 있다. 사본 종류는 `managed`·`remote`·`incoming`이며, 정리 등록 시 그룹별로 같은 사본을 지정한다. `incoming` 사본 ID는 정리 대상에서 제외해야 한다. `deleteAux:true`는 단일 소유권과 지문이 확인된 THM·LRV·AAE만 함께 삭제한다. XMP·모호한 후보·읽기 불가·다른 행에서 공유 참조하는 경로는 제외한다. 결과는 `cleaned`·`review`·`auxDeleted`·`companionReview`·`freedBytes`와 파일별 `items[].companions`를 포함한다. 본체 검증 실패 시 보조 파일을 보존한다.

보조 파일 계획은 API의 읽기 전용 Incoming 마운트를 실시간 검사한다(접근 실패 `503`). 응답은 `scanId`(없으면 null), `scannedAt`, `items`, `summary`다. 항목에는 `path`, `name`, `folder`, `kind`, `sizeBytes`, `modifiedAt`, `fingerprint`, `category`, `orphanHint`, `ownerPath`, `ownerStatus`, `candidatePaths`, `reason`, `selectable`, `defaultSelected`를 제공한다. 분류 순서는 `orphan`, `duplicate-owner`, `ambiguous`, `review-owner`, `unscanned-owner`, `ready-owner`, `unreadable`이며 같은 분류에서는 경로순이다. 고아와 중복 원본만 기본 선택하고 읽기 불가는 선택할 수 없다. 고아 힌트는 `owner-processed`(최근 검사에서 이동·삭제), `owner-archived`(보관 기록), `unverified-orphan` 순으로 결정한다. 요약은 `totalCount`, `totalBytes`, `defaultSelectedCount`, `defaultSelectedBytes`, `byCategory`(분류별 `count`, `bytes`)를 포함한다.

일괄 정리 요청은 1~10,000개, 경로 1~1,024자, 지문 1~256자다. 중복·절대·상위·숨김 경로, 화이트리스트 외 확장자, JSON 5정수 외 지문은 `400`, 파일 변경·부재·심볼릭 링크·권한 오류 및 local/exclusive 충돌은 `409`, 모델 위반은 `422`다. 접수 시와 삭제 직전에 지문을 재확인한다. 결과는 `totalFiles`, `completedFiles`, `deleted`, `absent`, `review`, `freedBytes`, `phase`, `current`, `items`다. `absent`는 오류 집계에 포함하지 않으며 파일별로 `파일 없음`을 표시한다. `latestIncomingResult`와 `/api/jobs?kind=aux-cleanup`에서 조회할 수 있다.

Incoming 미리보기는 최근 완료 검사에서 `ready`·`duplicate`인 파일에만 허용한다. 보관 파일 미리보기(`/api/managed/{file_id}/original`, `/preview`)는 `media.status='available'`이고 지문(`fingerprint`)이 있으며 지원 확장자·`kind`가 일치하는 파일에만 허용하며, 배정·확정 여부와 무관하게 열 수 있다. `managed` 원본은 단일 `Range`만 허용(다중·문법 오류·`end < start`·자릿수 한도 초과는 `400`, 파일 크기 초과·빈 파일/`bytes=-0`은 `416`과 `Content-Range: bytes */N`, 파일보다 큰 `suffix`는 전체 `206`으로 보정)하며 지문 해시 `ETag`로 `If-Range`를 처리한다.

`managed` 원본·미리보기 오류 분류는 실제 구현(`managed_for_preview`, `classify_managed_access_error`, `render_heif_preview`)을 따른다.

| 코드 | `managed` 오류 조건 |
| --- | --- |
| `400` | 다중 `Range`, 문법 오류, `end < start`, 자릿수 한도 초과 |
| `403` | 파일·디렉터리 읽기 권한 오류(`PermissionError`, `EACCES`, `EPERM`) |
| `404` | DB 레코드 없음, `status != 'available'`, 지문 없음, 실제 파일·마운트·상위 경로 없음(`FileNotFoundError`, `ENOENT`, `ENOTDIR`), 유효하지 않은 상대 경로(`ValueError`), 심볼릭 링크(`ELOOP`) |
| `409` | 지문 불일치(원본 변경·교체), 비정규 파일(디렉터리·FIFO·소켓 등) 접근 실패, 기타 파일 I/O 오류, HEIC·HEIF 디코드·변환 실패 |
| `415` | 지원하지 않는 확장자이거나 파일 종류(`kind`)와 확장자가 불일치 |
| `416` | 요청한 바이트 범위가 파일 크기를 벗어나거나 빈 파일·`bytes=-0` 요청 (`Content-Range: bytes */N`) |

`Cache-Control: private, no-store`와 `X-Content-Type-Options: nosniff`는 `managed` 미디어 핸들러와 공통 `VerifiedOriginal`·HEIF 변환 helper가 직접 생성하는 정상·오류 응답에 설정된다. 기존 Incoming의 DB 조회 단계 `HTTPException`(예: 검사 기록·지문 누락 `404`)과 FastAPI 자동 라우팅 `405` 응답에는 이 헤더를 추가하지 않는다.

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
| POST | `/api/archive/transfers` | 전송 모델 | `202 {"id":작업ID,"lane":"remote","count":파일수}` |
| POST | `/api/archive/transfers/{job_id}/cancel` | 없음 | `upload` 작업의 취소 요청 후 작업 상태 반환 |
| POST | `/api/archive/index` | `{"connection":"64자 식별자","path":"","full_rehash":false}` | `202 {"id":작업ID,"lane":"remote","scope":"상대경로"}`. 원격 아카이브 전체 또는 하위 폴더 증분 인덱싱(`remote-index`) 등록 |
| POST | `/api/archive/index/{job_id}/cancel` | 없음 | `remote-index` 작업의 취소 요청 후 작업 상태 반환 |

폴더 조회 응답은 `root`, `path`, `entries`, `connectionVersion`을 포함한다. `entries`에는 `name`, `kind` (`folder`·`file`·`link`), `size`, `modified`가 있다. `size`는 일반 파일만 바이트 크기이고 나머지는 `null`이며, `modified`는 원격 수정 시각의 Unix 타임스탬프다. `connectionVersion`은 현재 설정 식별자로 업로드 요청의 `connection`에 전달한다. 루트 밖 경로·상위 경로 이동을 거부한다.

```json
{
  "connection": "<폴더 조회 응답의 64자 connectionVersion 값>",
  "items": [
    {"id": "보관파일ID", "kind": "media"},
    {"id": "보관파일ID", "kind": "xmp"}
  ],
  "source": [],
  "destination": "",
  "allow_duplicates": false
}
```

- `items`는 1~10,000개다. `kind` 기본값은 `media`이며 XMP는 별도 항목으로 지정한다.
- `source`는 현재 Source 폴더를 나타내는 문자열 배열이고 최대 3단계다. 항목은 해당 경로 아래에 속해야 한다.
- `destination`은 원격 루트 아래 상대 폴더다. 기본값은 루트다.
- `allow_duplicates` 기본값은 `false`다. `kind=media` 항목 중 현재 활성 저장 루트의 `remote_files(status='present')`에 같은 SHA-256이 **다른 원격 경로**에 이미 존재하면 `409`와 함께 `{"detail", "code": "remote_duplicate", "duplicates", "duplicateIds", "newCount"}`를 반환해 중복 업로드를 차단한다. 동일 목적지 경로에 이미 있는 파일과 `kind=xmp` 항목은 이 차단에 걸리지 않으며, `allow_duplicates=true`로 명시 재요청하면 별도 사본 업로드를 허용한다.
- 대상은 `destination + (논리적 파일 경로에서 source 접두 경로를 뺀 부분)`으로 결정한다.
- `available`이면서 확정된 원본과 그 XMP만 등록할 수 있다. 설정 식별자가 바뀌었거나 대상 경로가 중복되면 409다.
- 대기 작업 취소는 즉시 `cancelled`로 변경하고, 실행 중이면 `cancelRequested`를 설정해 워커가 확인한다. 이미 종료한 작업에는 상태 변경 없이 응답한다.
- 원격 인덱싱(`POST /api/archive/index`)은 `connection`이 현재 설정 식별자와 일치해야 하며(불일치 409), `path`가 비어 있으면 전체 저장 루트를, 상대경로이면 해당 폴더 하위만 인덱싱한다. 지원 확장자(사진·영상·XMP) 정규 파일만 색인하며 숨김 항목(`.` 접두)과 심볼릭 링크는 건너뛴다. `full_rehash=false`(기본값)이면 `remote_files`의 `(size, mtime_ns)`가 일치하는 `present` 행은 재해시를 생략한다. 취소 또는 연결 단절로 중단된 경우 이미 완료된 해시는 유지하되 기존 `present` 행을 `missing`으로 바꾸지 않는다.

## 파일 기록

`GET /api/catalog`는 로컬 파일, 아카이브 이력, 원격 인덱스를 별도 뷰로 조회한다.

| 쿼리 | 기본값 | 허용 값·범위 |
| --- | --- | --- |
| `view` | `files` | `files`, `archives`, `remote` |
| `q` | 빈 문자열 | 최대 300자 검색어 |
| `scope` | `all` | `all`, `managed`, `incoming`, `xmp`, `verified`, `failed`, `unknown`, `present`, `missing`, `remote_only` |
| `page` | `1` | 1 이상. 마지막 페이지를 초과하면 마지막 페이지로 조정 |
| `page_size` | `50` | 1~100 |
| `event` | `all` | `all`, `unassigned`, 이벤트 ID (`files`·`archives` 뷰 전용) |
| `device` | 빈 문자열 | 장비 표시 이름. 미확인은 `장비 미확인` (`files`·`archives` 뷰 전용) |
| `folder` | 빈 문자열 | 원격 아카이브 하위 경로 접두 또는 루트 직속 파일용 `__root__` (`remote` 뷰 전용) |

보유 파일 뷰는 `managed`, `incoming`, `xmp`, `verified` 범위를, 아카이브 뷰는 `xmp`, `verified`, `failed`, `unknown`을, 원격 인덱스 뷰(`view=remote`)는 `present`, `missing`, `remote_only`(현재 사용 가능·오프로드 `media`에 없는 원격 전용 파일), `xmp`를 적용한다. 그 밖의 조합은 추가 범위 조건 없이 조회한다. 반환값은 기존 `view`, `rows`, `total`, `page`, `pages`, `pageSize`, `summary`(`files`, `hashes`, `attempts`, `verified`, `failed`, `remoteTotal`, `remotePresent`, `remoteMissing`, `remoteOnly`, `lastIndexedAt` 포함), `folders`, `unassigned`, `remoteFolders`, `remoteRootCount`와 추가된 `activeArchiveRoot: str | null`이다. `activeArchiveRoot`는 현재 설정된 NAS 절대 루트이며 스토리지 미설정 시 `null`이다. 요약과 폴더 집계는 현재 검색·페이지 조건과 독립된 전체 집계다. 조회는 읽기 전용 SQL을 사용하며 원격 연결·스키마 변경을 수행하지 않는다.

`files`·`archives`의 `event_name`은 상위 이벤트의 저장 폴더명(`260903_나고야`) 또는 `상위 폴더명 / 소분류명`(`260903_나고야 / 1일차`)이다. 폴더명이 비어 있으면 이벤트 이름을 사용하며 미배정은 `null`이다. `260903`, `260903_나고야`, `나고야`, `1일차` 모두 검색할 수 있다. `folders[]`는 기존 `id`, `name`, `parent_id`, `start`, `count`, `devices`와 함께 `folder`, `zone`을 제공한다. `name`은 날짜 접두 없는 기존 이벤트 이름을 유지한다.

`files.rows[]`의 `captured_at: str | null`은 사용자 지정 시각 → 원본 촬영 시각 → 유효한 XMP JSON의 `date.time` 순서로 선택한다. `event_zone: str | null`은 상위 이벤트의 시간대(없으면 해당 이벤트 시간대)이며 XMP 행도 부모 미디어의 시각·시간대를 상속한다. Incoming 행의 두 값은 `null`이다. 기존 `has_archive`는 현재 해시의 검증 이력 또는 인덱스의 동일 해시 `present` 사본 존재를 뜻하며, 활성 루트에서 내려받을 수 있다는 뜻은 아니다. `download_path`·`can_download`는 활성 루트의 `present` 사본으로 결정한다. `archives.rows[]`는 기존 필드와 현재 미디어의 `original_path`를 제공하며, `can_download`는 활성 루트와 일치하고 목적지가 있는 `uploaded`·`skipped` 기록에만 참이다.

`remote.rows[]`는 기존 `in_catalog`·`can_download`를 유지하고 아래 필드를 추가한다. 현재 페이지의 중복 제거한 non-null SHA 목록에 대해 같은 읽기 트랜잭션에서 단일 배치 쿼리를 실행하며, `media.status IN ('available', 'archived')`인 원본 SHA 또는 XMP SHA와 연결한다. XMP는 부모 미디어의 이벤트를 따른다. SHA가 없거나 `missing`·`offloading` 미디어만 매칭되면 미연동이며, `scope=remote_only`와 `summary.remoteOnly`의 기존 의미는 유지된다. `can_download`는 현재 활성 루트와 일치하는 `present` 원격 파일에만 참이다.

| 원격 연동 필드 | 의미 |
| --- | --- |
| `catalog_events: list[str]` | 고유 이벤트 표시명. 상위 시작일 내림차순 → 표시명 → 미디어 ID 순으로 연결한 뒤 중복을 제거한다. |
| `catalog_event_name: str \| null` | 첫 이벤트 표시명. 이벤트가 없으면 `null`. |
| `catalog_match_count: int` | 연결된 고유 `media.id` 수. 미연동은 `0`. |
| `catalog_has_unassigned: bool` | 연결 미디어 중 `event_id IS NULL`인 항목 존재 여부. |
| `catalog_file_ids: list[str]` | 연결된 고유 미디어 ID 목록. 미연동은 `[]`. |

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
| DELETE | `/api/settings/ssh-host-key` | 없음 | 현재 IP에 저장된 SSH 호스트 키 초기화 (활성 `upload`·`offload`·`remote-index` 작업 중에는 409) |
| GET | `/api/settings/catalog/backup` | 없음 | SQLite 백업 파일 다운로드 |
| POST | `/api/settings/catalog/reset` | `{"confirmation":"모든 데이터 삭제"}` | `202 {"id":작업ID,"kind":"reset-all","lane":"exclusive","status":"queued"}`. 전체 로컬 데이터 초기화 등록 |
| POST | `/api/settings/catalog/restore` | SQLite 파일의 원시 요청 본문 | `{"restored":true}`. multipart 업로드가 아님 |

최초 접속 테스트는 `status=confirm_host`, `algorithm`, `fingerprint`, `token`을 반환한다. 토큰은 300초 동안 유효하며 IP 변경 시 사용할 수 없다. 인증 성공은 `{"status":"connected"}`다. 설정·원격 탐색·파일 기록·백업 응답은 `Cache-Control: no-store`를 설정한다.

초기화 확인 문구는 **모든 데이터 삭제**다. 이전 문구 `초기화`와 누락·오입력은 422로 거부한다. 다른 활성 작업이 있으면 409다. 초기화 중에는 GET·HEAD·OPTIONS 외의 요청도 409로 차단한다. 기존 `/api/settings/catalog/return-managed`는 제거했다.

워커의 `reset-all` 작업은 managed·썸네일·서버 임시 파일을 삭제한 뒤 DB의 모든 행과 현재 작업 자체를 삭제한다. `/api/state.job.result`에는 처리 중 `phase`, `deletedFiles`, `deletedDirectories`를 제공하며 실패 시 `error`를 기록한다. 성공하면 `job`이 `null`이 되며 완료 이력을 남기지 않는다. 클라이언트는 활성 reset-all 이후 job이 사라지는 것으로 완료를 표시한다. 자동 검사·백업·파일 이동·해시 계산은 수행하지 않는다.

incoming 디렉터리와 모든 파일·하위 폴더, SSH 설정·키와 원격 아카이브는 유지한다. 파일 삭제는 되돌릴 수 없고 중간 실패의 파일 롤백은 없다. DB 삭제는 한 트랜잭션으로 처리한다. 실패한 작업은 오류를 기록해 재실행할 수 있게 남는다. 응답은 `no-store`다.

구현 위치: [api.py](../backend/api.py), [settings.py](../backend/settings.py), [archive.py](../backend/archive.py), [transfers.py](../backend/transfers.py), [remote_index.py](../backend/remote_index.py), [offload.py](../backend/offload.py), [records.py](../backend/records.py).
## 썸네일 캐시 API

모든 캐시 응답은 `Cache-Control: no-store`를 사용한다. 계획과 현황 조회는 NAS에 접속하지 않는다.

| 요청 | 입력 / 결과 |
| --- | --- |
| `POST /api/thumbnails/plan` | `scope: all\|folder\|shas`, `view: files\|archives\|remote`, `event`, `device`, `folder`, `shas`(최대 500개), `include_failed`(기본 true). `total`, `local`, `localPhotos`, `localVideos`, `remotePhotos`, `remoteVideos`, `remoteVideosOverLimit`, `alreadyReady`, `unavailable`, `failed`, `skippedLarge`, `estimatedBytes`, `lane`, `storageConfigured`, `activeArchiveRoot` 반환 |
| `POST /api/jobs/thumbnails` | 계획 입력에 `allow_large_sftp_fallback`(기본 false) 추가. 로컬만이면 `thumbnails-local`, 원격 포함이면 `thumbnails-remote`로 등록(202). 모두 캐시되었으면 `status: noop`(200), 원본 부재 400, 레인 충돌 409 |
| `POST /api/jobs/thumbnails/{id}/cancel` | 대기는 즉시 cancelled, 실행 중에는 `cancelRequested`. 완료 작업에 재호출해도 현재 상태 반환 |
| `GET /api/settings/thumbnails` | `cachedCount/Bytes`, `missingTotal/Local/RemotePhotos/RemoteVideos`, `orphanCount/Bytes`, `failedCount`, `skippedLargeCount`, `activeThumbnailJob`, `canCleanup` |
| `POST /api/settings/thumbnails/cleanup` | 모든 레인 유휴 필요(작업 중 409). `deleted`, `freedBytes`, 최신 `stats` 반환 |
| `POST /api/settings/thumbnails/reset-failures` | failed/skipped_large 기록만 초기화. `cleared`, 최신 `stats` 반환 |

`GET /api/catalog`은 `scope=no_thumbnail`을 지원한다. 모든 탭의 행에 `media_kind`, `thumbnail`, `thumbnail_status`, `thumbnail_error`, `can_generate_thumbnail`, `has_local_original`, `preview`, `original`이 추가된다. `kind`의 기존 의미는 유지한다. 로컬 URL은 `/api/managed/{id}/preview|original` 또는 `/api/incoming/{id}/preview|original`이다. 상태는 ready, missing, generating, unavailable, failed, skipped_large, non_media(XMP)이며 실제 디스크 캐시가 우선한다. `missingThumbnails`는 현재 탭·폴더 범위의 생성 가능한 고유 SHA를 집계하고 검색어·상태 필터는 무시한다(`total`, `missing`, `photos`, `videos`, `local`, `remotePhotos`, `remoteVideos`, `failed`, `skippedLarge`).

`POST /api/archive/index`의 기존 `connection`, `path`, `full_rehash` 계약은 유지하며 `generate_thumbnails`, `allow_large_sftp_fallback`(모두 기본 false)을 추가한다. 생성 옵션을 켜면 동일 연결에서 두 번째 단계로 실행하고 결과의 `thumbnails`에 total/generated/reused/failed/skippedLarge를 반환한다. `GET /api/jobs?kind=`는 `thumbnails-local`, `thumbnails-remote`도 허용한다.


`GET /api/catalog` 추가 매개변수: `job_id`는 `view=archives`에서만 사용하며 1부터 2^63-1까지의 정수다. 다른 뷰와 함께 사용하거나 범위를 벗어나면 422이며 알 수 없는 유효 ID는 빈 결과다. `upload_result=all|success|failed|pending|unknown|legacy|none`은 보유 파일의 최신 시도 필터이며 기존 `scope=verified`의 과거 검증/원격 인덱스 의미를 바꾸지 않는다. `all` 이외의 값을 다른 뷰에 적용하면 422다.

보유 행의 `latest_archive`는 시도가 없으면 null이며, 있으면 `record_key`, `job_id`, 숫자 `item_index`, `outcome`, `job_status`, `storage_id`, `archive_root`, `target`, `recorded_at`, `verified_at`, `error`를 제공한다. `has_verified_history`는 동일 ID·자산 종류·현재 SHA의 성공 이력이다. `uploadSummary`는 선택 이벤트/장비 범위의 현재 자산별 total/success/failed/pending/unknown/legacy/none을 제공하며 검색/선택 필터는 무시한다. `archiveSelection`은 jobId/total/uploaded/skipped/legacy/failed/pending/unknown을 제공하며 작업·이벤트·장비 범위를 반영하고 검색/결과 필터는 무시한다. 기존 전역 summary는 유지한다. 아카이브 검색은 오류 문자열도 포함하며 정렬은 작업 번호 내림차순, 숫자 manifest 위치 오름차순이다.

썸네일 계획/작업의 선택적 `job_id`도 같은 정수 범위를 가지며 `scope=folder,view=archives` 범위에 적용한다. 전체 생성에는 job_id를 보내지 않는다. 다운로드/썸네일 권한은 최근 업로드 결과에서 파생하지 않는다.
## 로컬 원본 생명주기

`GET /api/settings`는 `localRetention: {mode: "manual" | "days", days: int | null}`을 반환합니다.
`PUT /api/settings/retention`은 같은 객체를 받아 전체 설정 상태를 반환합니다 (`Cache-Control: no-store`).
수동 유지에서는 `days=null`, 기간 보관에서는 정수 `0..3650`을 사용하며 bool·실수·문자열은 거부합니다 (400 또는 422).
설정은 `/settings/local-retention.json`에 권한 0600으로 원자 저장하고, 손상·미존재 시 수동 유지로 돌아갑니다.
DB 백업 복원과 데이터 초기화는 이 설정을 유지합니다. 정책 저장은 자동 삭제를 시작하지 않습니다.

`POST /api/archive/transfers`의 `TransferRequest`에 `offload_after_upload: bool = false`가 추가되었습니다.
활성화하면 사진·영상 원본이 적어도 하나 있어야 하고, 연결된 XMP는 함께 선택하거나 활성 아카이브 경로에 보관되어 있어야 합니다.
XMP가 누락되면 `MissingXmpOffloadError` (409)는 `{detail, code: "missing_xmp_for_offload", missingXmpMediaIds: [id]}`를 반환합니다.
해시가 없거나 Incoming 중복 정리에서 보존할 원본이면 409로 거부합니다.
업로드 단계가 완료되면 같은 SFTP 세션에서 성공한 에셋의 원본만 Safe Offload로 처리합니다.
업로드 취소·연결 단절 시 후속 비우기를 시작하지 않으며, 비우기 취소는 현재 파일의 원자 삭제가 끝난 뒤 적용합니다.
결과의 `offload`는 `{enabled, totalFiles, completedFiles, offloaded, skipped, failed, freedBytes, errors, phase}`입니다.
업로드 또는 후속 비우기 실패가 있으면 작업 상태는 `failed`이고 작업 내역에서 주의 대상으로 표시합니다.

- `POST /api/jobs/offload/{job_id}/cancel`: queued는 즉시 cancelled, running은 `cancelRequested=true` 요청 후 안전 경계에서 종료합니다. 종료된 작업에는 멱등이며 없으면 404입니다. 작업 객체를 반환합니다.
- `GET /api/archive/transfers/{job_id}/offload-candidates`: 업로드의 uploaded/skipped 기록과 현재 로컬·활성 아카이브·XMP·중복 보존 상태를 교차 검증합니다. 없거나 upload가 아니면 404입니다. `{ids, totalEligibleCount, truncated, totalBytes, blockedByKeeperCount, excludedMissingXmp, samples}`를 반환합니다. 원래 전송 순서로 정렬하고 samples는 최대 20건입니다.
- `GET /api/offload/retention-candidates`: `{ids, totalEligibleCount, truncated, totalBytes, blockedByKeeperCount, missingVerifiedAtCount, storageConfigured, samples}`를 반환합니다. 검증 시각과 이름 순으로 정렬하고 samples는 최대 50건입니다.

위 세 엔드포인트는 모두 `Cache-Control: no-store`입니다. 두 후보 API의 ids는 최대 10,000건이며 집계는 전체 대상 기준입니다. `totalBytes`는 연결된 XMP를 포함합니다. 후보 조회는 파일을 삭제하지 않으며, 사용자 확인 후 기존 `POST /api/jobs/offload`에 ids를 전달합니다.

`GET /api/state`의 추가 필드:

- `retention`: `{mode, days, storageConfigured, eligibleCount, eligibleBytes, blockedByKeeperCount, missingVerifiedAtCount}`.
- `latestUploadOffload`: 가장 최근 remote 작업이 종료된 upload일 때 `{jobId, count, totalBytes, blockedByKeeperCount, excludedMissingXmp}`. 대상·제외가 모두 없거나 다른 작업이면 null.
- 각 managed 항목 (`view_media`): 기존 십진 MB `size`를 유지하고 `sizeBytes: int`, `xmpSizeBytes: int | null`, `archivedAt: ISO | null`, `retentionDueAt: ISO | null`, `retentionEligible: bool`을 추가합니다.

보존 기간은 촬영일·first_seen_at·last_seen_at이 아닌 활성 archive_root의 present 사본 `verified_at`에서만 계산합니다.
동일 storage_id 사본을 우선하고 그 안의 가장 이른 검증을 사용합니다. XMP가 연결되어 있으면 원본과 XMP 검증 중 더 늦은 시각부터 계산합니다.
검증 시각이 없거나 파싱할 수 없으면 대상에서 제외합니다. 0일은 검증 직후, 1일 이상은 UTC 만료 시각 이후에 제안합니다.
실제 삭제 시 원격 존재·크기와 로컬 fingerprint·SHA-256을 다시 확인하며, 중복 정리의 보존 원본은 예약과 실행 시점 모두 보호합니다.
