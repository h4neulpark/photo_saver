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
│   ├── archive.py          # SFTP 연결·폴더 탐색
│   ├── transfers.py        # 업로드·검증·취소·이력
│   ├── devices.py          # 촬영도구 이름 규칙·조회·변경
│   ├── records.py          # 파일·아카이브 기록 조회
│   └── test_*.py           # unittest 테스트
├── frontend/
│   ├── index.html
│   ├── app.js              # 해시 라우팅과 전체 UI
│   └── styles.css
└── docs/                   # 현재 구현 문서
```

현재 프론트엔드는 별도 패키지 설치·번들링 단계가 없다. Python 의존성은 FastAPI, Uvicorn, Pillow, pillow-heif, defusedxml, Paramiko이며 정확한 버전은 [requirements.txt](../backend/requirements.txt)를 따른다.

## 테스트 실행

기존 테스트는 Python 표준 `unittest`를 사용한다. 백엔드가 Linux 파일 API를 사용하므로 Mac의 Python에서 직접 실행하기보다 백엔드 Docker 이미지로 실행한다. 서비스·원본·운영 DB를 마운트하지 않고 테스트용 임시 디렉터리를 사용한다.

프로젝트 루트에서 이미지를 빌드한다.

```sh
docker compose build api
```

이미지에는 테스트 파일을 복사하지 않으므로 소스 디렉터리를 읽기 전용으로 마운트한다.

```sh
docker run --rm --network none \
  -v "$PWD/backend:/app:ro" \
  -w /app \
  photo-saver-backend \
  python -m unittest discover -s . -p 'test_*.py' -v
```

한 부문만 실행할 때는 마지막 명령을 `python -m unittest test_transfers -v`처럼 지정한다. 테스트는 외부 SSH·OMV 연결을 모의 객체 또는 로컬 SFTP 대역으로 대체한다.

2026-11-23 기준 위의 네트워크 차단·소스 읽기 전용 마운트 명령으로 기존·촬영도구 이름·초기화·일괄 수정 테스트 67개가 모두 통과했다. 실제 OMV 연결은 검증하지 않았다. 촬영도구 이름 화면은 별도 임시 서버에서 실제 API 저장·공백 유지·충돌 오류·새로고침 후 유지·빈 목록·오류 재시도와 PC·모바일 배치를 브라우저로 확인했다.

통합 초기화는 별도 임시 서버에서 단일 버튼·이전 확인 문구 거부·취소·실제 파일 삭제·모든 기록 제거·incoming·SSH·원격 보존·변경 요청 차단·초기화 후 재검사와 PC·모바일 화면을 브라우저로 검증했다. 운영 카탈로그에는 초기화를 실행하지 않았다.

## 테스트 범위

| 파일 | 주요 검증 |
| --- | --- |
| [test_archive.py](../backend/test_archive.py) | 루트 이탈 거부, 링크 경계, 특수 파일명, 빈 폴더·조회 제한, 접속 오류 매핑, 저장된 키만 사용하는 연결 |
| [test_events.py](../backend/test_events.py) | 날짜 접두사, 이벤트·장비 폴더 충돌, 수정 롤백, 수정 후 경로 갱신, 기존 전송 기록·예약 경로 유지 |
| [test_gopro.py](../backend/test_gopro.py) | GoPro 인코더·메타데이터 트랙·모델 판정, 추측 방지, 재분석 시 사용자 분류 보존 |
| [test_transfers.py](../backend/test_transfers.py) | 폴더·XMP 전송, 동일 파일 재전송 생략, 임시 파일 정리, 충돌·심볼릭 링크·원본 변경·검증 오류·취소·설정 변경·잘못된 입력 |
| [test_devices.py](../backend/test_devices.py) | 기존·신규 적용, 재분석·재시작, 수동 이름 우선, 경로·검색 일치, 충돌과 업로드 잠금, 신구 백업 호환 |
| [test_media_edit.py](../backend/test_media_edit.py) | 기존 장비 일괄 배정, 실제 XMP 읽기·파일별 시각·시간대 적용, 누락 시각 유지, 엄격 검증 호환, 전부 누락·잘못된 플래그 거부, 재검사한 XMP 적용 |
| [test_reset.py](../backend/test_reset.py) | managed·캐시·임시 데이터·모든 기록 삭제, incoming 전체·SSH·원격 보존, 링크 경계, 중단 재개·실패 재실행, 확인 문구·활성 작업 차단 |
| [test_records.py](../backend/test_records.py) | 이벤트 트리·검색·필터·페이지 독립성, 원본·XMP 해시, 부분 실패·구버전 이력, 누락 파일과 현재 해시 구분, 백업·복원 호환 |

자동 테스트에는 실제 OMV·SFTP 서버, Docker 마운트의 파일 이동, 실제 촬영 샘플의 전체 분석, 브라우저 조작 전체를 검증하는 통합·E2E 테스트가 없다. 특히 Incoming 전체 처리와 XMP 연결·사진 삭제 흐름은 현재 전용 테스트 파일이 없다.

## 기능 변경에 따른 확인

관련 부문의 테스트와 문서를 확인하고, 필요한 경우 아래 실제 흐름을 사용한다.

| 변경 부문 | 수동 확인 예 |
| --- | --- |
| Incoming | 별도 테스트 원본으로 신규·중복·변경 파일 검사, 선택 이동 후 원본·카탈로그 일치 |
| 메타데이터 | JPEG·HEIC·MP4·MOV 표본의 회전·장비·시간대·미리보기 확인 |
| 이벤트 | 기간 양 끝 날짜·중복 기간·미확인 시각, 소분류 이동, 확정 후 Source 경로 |
| 전송 | 테스트 원격 폴더에서 신규·동일 파일·충돌·중지·워커 재시작과 XMP 결과 |
| 기록·복원 | 검색·페이지·검증 이력, 별도 테스트 카탈로그로 백업·복원 |
| UI | 다섯 해시 경로, 표·카드 전환, 키보드 이동, 좁은 화면, 오류·빈 상태 |

입력·응답을 바꾸면 [API](api.md), DB 열·상태·제약을 바꾸면 [데이터 모델](data-model.md), 실행 변수·볼륨을 바꾸면 [실행과 운영](setup-and-operations.md)을 함께 갱신한다.
