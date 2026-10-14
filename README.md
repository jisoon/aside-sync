# Aside Sync

여러 PC에서 쓰는 Aside의 **채팅 기록**, 프로젝트, 메모리, 내가 만든 스킬, AGENTS.md/SOUL.md, (선택) 설정을
Google Drive / iCloud / Dropbox / OneDrive / NAS 같은 **공유 폴더**를 통해 자동 동기화합니다. 별도 서버가 필요 없습니다.

## 구성

```
aside-sync/
├─ host/        동기화 엔진 (Node). OS 예약 작업이 주기적으로 실행 → 크롬이 꺼져 있어도 동기화
├─ extension/   크롬 확장 (선택): 상태 보기, 지금 동기화, 주기/대상 설정
└─ install/     네이티브 호스트 등록·제거 스크립트
```

## 설치 (PC마다 한 번, 명령어 한 줄)

**가장 쉬운 방법**: 새 PC의 Aside에게 이렇게 말하세요.
> https://github.com/jisoon/aside-sync 설치해줘

**직접 설치**

macOS (터미널):
```bash
curl -fsSL https://raw.githubusercontent.com/jisoon/aside-sync/main/install.sh | bash
```

Windows (PowerShell):
```powershell
irm https://raw.githubusercontent.com/jisoon/aside-sync/main/install.ps1 | iex
```

설치 중에 동기화 폴더(Google Drive 등)만 고르면 끝입니다. **모든 PC에서 같은 클라우드**를 고르세요.
설치가 끝나면 OS 예약 작업(macOS: launchd, Windows: 작업 스케줄러)에 등록되어 로그인 시 + 15분마다 자동 동기화됩니다.

**상태를 보고 싶다면 크롬 확장 (선택, 한 번만)**
1. `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램 로드** → `~/.aside-sync/app/extension` 선택 (Windows: `%USERPROFILE%\.aside-sync\app\extension`)
   - Chrome, Aside 브라우저 어디에 로드해도 됩니다.
   - macOS에서 `.aside-sync` 폴더가 숨김이라 안 보이면 선택 창에서 **Cmd+Shift+G** → 경로 붙여넣기 (또는 **Cmd+Shift+.** 로 숨김 파일 표시)

팝업에서 상태(정상/오류/동기화 중), 마지막 동기화 시각과 방식(자동/수동), 자동 동기화 등록 상태, 연결된 PC 목록을 볼 수 있고 **지금 동기화**도 할 수 있습니다.
옵션에서 주기를 바꾸면 OS 예약 작업에 바로 반영됩니다(0 = 끄기). 다른 PC에서 채팅을 받아오면 알림이 뜹니다.

**업데이트**: 같은 명령을 다시 실행 → 확장을 쓰면 `chrome://extensions`에서 새로고침(↻). 설정과 동기화 상태는 유지됩니다.

**제거**: `bash ~/.aside-sync/app/install/uninstall-mac.sh` / Windows: `~\.aside-sync\app\install\uninstall-windows.ps1`

> macOS에서 동기화 폴더가 Google Drive/iCloud면 처음 자동 실행 때 "node가 Google Drive의 파일에 접근하려고 합니다" 같은 권한 창이 뜰 수 있습니다. **허용**을 눌러주세요.

## 수동 설치

1. 이 저장소를 PC에 받기 (Code → Download ZIP)
2. 네이티브 호스트 등록
   - macOS: `bash install/install-mac.sh`
   - Windows: PowerShell에서 `powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1`
   - Node 22.5 이상이 필요하며, Aside에 내장된 Node(`~/.aside/runtime/bin/node`)를 우선 사용합니다.
3. 크롬 `chrome://extensions` → 개발자 모드 ON → **압축해제된 확장 프로그램 로드** → `extension` 폴더 선택
   - 확장 ID: `dmncckmmjbfdafmjnleocmfogddimkah` (manifest의 key로 고정되어 모든 PC에서 같음)
4. 확장 옵션 페이지에서 **모든 PC에 같은 클라우드 폴더**를 지정 (예: `Google Drive/내 드라이브/AsideSync`) → "저장 후 지금 동기화". 저장하면 자동 동기화(OS 예약 작업)도 함께 등록됩니다.

> 첫 PC에서 먼저 동기화한 뒤 다음 PC를 연결하세요. 새로 받은 채팅이 Aside 목록에 바로 안 보이면 Aside(크롬)를 한 번 재시작하면 됩니다.

## 동작 방식

- **채팅**: `state.db`의 sessions / session_turns / 메모리 추출 행 + 세션 폴더의 `messages.jsonl`, `artifacts/`, `attachments/`를 세션 단위로 동기화합니다. `tmp/`는 제외됩니다.
- **PC마다 다른 경로**(예: `/Users/a/.aside/u/1` ↔ `C:\Users\b\.aside\u\2`)는 자동 변환됩니다.
- **변경 감지**: 마지막 동기화 시점 대비 3-way 비교. 한쪽만 바뀌면 그쪽을 반영하고, 양쪽 다 바뀌면 **최신 쪽이 이깁니다**. 덮어쓰인 메모리 파일은 `~/.aside-sync/conflicts/`에 백업됩니다.
- **실행 중인 채팅은 건너뛰고** 다음 동기화 때 처리합니다.
- 파일은 내용 해시 기반(blob)으로 저장되어 바뀐 파일만 업로드되고, 안 쓰는 blob은 3일 뒤 정리됩니다.
- 각 PC는 자기 이름의 파일에만 기록하므로 클라우드 폴더에서 쓰기 충돌이 나지 않습니다.
- 클라우드 업로드가 덜 끝난 채팅은 "대기"로 표시되고 다음 동기화 때 가져옵니다.

## 동기화하지 않는 것

- `credentials.json`(로그인 토큰), 비밀번호 관리자 연동, MCP 설정, 커스텀 모델 키, `routineDeviceId`
- 루틴(예약 작업): 여러 PC에서 중복 실행되는 걸 막기 위해 제외
- Slack/Telegram 채널 연결, 브라우저 탭 바인딩, 시크릿/임시 세션
- 설정(settings.json)은 기본 OFF (옵션에서 켤 수 있음)

## CLI (확장 없이도 사용 가능)

```bash
NODE=~/.aside/runtime/bin/node
$NODE ~/.aside-sync/host/aside-sync-host.mjs detect        # 계정/클라우드 폴더 감지
$NODE ~/.aside-sync/host/aside-sync-host.mjs config syncDir='"/path/to/AsideSync"'
$NODE ~/.aside-sync/host/aside-sync-host.mjs sync
$NODE ~/.aside-sync/host/aside-sync-host.mjs status
$NODE ~/.aside-sync/host/aside-sync-host.mjs schedule      # 자동 동기화 (재)등록 (주기 = config의 autoSyncMinutes)
$NODE ~/.aside-sync/host/aside-sync-host.mjs unschedule    # 자동 동기화 해제
```

설정/상태/로그: `~/.aside-sync/` (config.json, state.json, sync.log, scheduler.log)

## 주의

- Aside 내부 DB 구조(비공개)에 맞춰 만든 도구입니다. Aside 업데이트로 스키마가 바뀌면 없는 컬럼은 자동으로 무시하지만, 큰 변경 시 수정이 필요할 수 있습니다.
- 클라우드 폴더에는 채팅 원문이 그대로 저장됩니다. 본인 계정의 드라이브를 사용하세요.
- 처음 쓸 때는 `~/.aside/u/<id>/state.db`를 따로 백업해 두길 권장합니다.
