# Aside Sync

여러 PC에서 쓰는 Aside의 **채팅 기록**, 프로젝트, 메모리, 내가 만든 스킬, AGENTS.md/SOUL.md, (선택) 설정을
Google Drive / iCloud / Dropbox / OneDrive / NAS 같은 **공유 폴더**를 통해 자동 동기화합니다. 별도 서버가 필요 없습니다.

## 동기화 방식 두 가지

| | **GitHub 저장소 (권장, v1.2.0+)** | 클라우드 폴더 (Google Drive 등) |
|---|---|---|
| 업로드 실패 | 바로 오류로 표시 | 클라우드 앱이 "최신 상태"인 척 멈출 수 있음 |
| 중간 상태 | 커밋 단위라 반쯤 올라간 상태 없음 | 파일 단위로 올라가 중간 상태가 보일 수 있음 |
| 폴더 중복 | 없음 | `AsideSync 2`, `a6 2` 같은 중복 폴더가 생길 수 있음 |
| 되돌리기 | 전체 이력이 남아 어떤 버전이든 복구 | 휴지통(30일) 정도 |
| 메모리 동시 수정 | 다른 줄이면 줄 단위로 자동 병합 | 동일 (병합 기준 파일이 남아 있을 때) |
| 필요한 것 | git + GitHub 로그인, **비공개** 저장소 | 클라우드 앱 |

### GitHub 모드 설정

1. GitHub에서 **비공개(Private)** 저장소를 하나 만듭니다 (예: `aside-sync-data`, README 없이 빈 저장소). 채팅 원문이 올라가므로 절대 공개로 만들지 마세요.
2. 각 PC에서 그 저장소에 `git push`가 되는지 확인합니다 (평소 쓰는 GitHub 로그인/자격 증명 그대로 사용).
3. 확장 옵션의 **GitHub 저장소**에 주소를 넣고 저장하거나, CLI로:
   ```bash
   ~/.aside/runtime/bin/node ~/.aside-sync/host/aside-sync-host.mjs config gitRemote='"https://github.com/<아이디>/aside-sync-data.git"'
   ```
   저장할 때 저장소 접근을 바로 확인합니다. 로컬 사본은 `~/.aside-sync/repo`에 생깁니다.
4. 클라우드 폴더 방식에서 넘어오는 경우에도 그대로 지정하면 됩니다 (첫 동기화처럼 처리되어 아무것도 지우지 않습니다).

동작: `fetch + rebase → 동기화 → commit → push`. 다른 PC가 먼저 올렸으면 자동으로 다시 받아 합친 뒤 올립니다(최대 3회). 각 PC는 자기 파일만 쓰고 데이터는 내용 해시로 저장되므로 git 충돌이 나지 않습니다. 바뀐 게 없으면 커밋하지 않고, 30분마다 "살아 있음" 기록만 올립니다.

주의: 채팅이 바뀔 때마다 새 버전이 이력에 쌓이므로 저장소가 점점 커집니다. GitHub 권장 한도(수 GB)에 가까워지면 새 저장소로 옮기세요 (옮겨도 데이터는 각 PC에 있으므로 안전).

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

### 안전장치 (v1.1.1 ~ v1.1.4)

- **동기화 폴더가 바뀌면 비교 기준 초기화**: 폴더 경로가 바뀌거나, 같은 경로에 다른 폴더가 들어오면(클라우드가 폴더를 `AsideSync 2`로 바꿔치기한 경우 등) 첫 동기화처럼 처리합니다. 새 폴더에 없는 파일을 "다른 PC에서 지움"으로 오인해 삭제하지 않습니다.
- **이 PC의 파일 목록이 폴더에 없으면 삭제하지 않음**: 위와 같은 이유로, 폴더에 이 PC의 manifest가 없으면 기준을 초기화합니다.
- **동기화 폴더를 자동으로 만들지 않음**: 동기화 중에 폴더가 없으면 오류로 멈춥니다. 클라우드 앱이 로그아웃/일시중지된 상태에서 폴더를 만들면 클라우드와 연결 안 된 로컬 폴더가 생기고, 나중에 `AsideSync 2` 같은 중복 폴더로 올라가 PC 간 동기화가 갈라지기 때문입니다. 폴더는 옵션/`config syncDir=`로 지정할 때만 만들어집니다.
- **대량 삭제 차단**: 한 번에 max(5개, 로컬 파일의 20%)를 넘는 삭제는 실행하지 않고 오류로 알립니다. 삭제를 받아들이려면 `sync --allow-mass-delete`, 이 PC의 파일로 되살리려면(다른 PC에도 다시 퍼짐) `sync --keep-local`. 삭제되는 파일은 항상 `~/.aside-sync/conflicts/<시각>/deleted/`에 백업됩니다.
- **중복 하위 폴더 허용**: Google Drive가 `blobs/a6 2`처럼 같은 이름 폴더를 만들어도 하나로 취급합니다.
- **클라우드 정지 감지**: 각 PC가 "다른 PC의 어느 시점까지 봤는지"를 기록합니다. 활동 중인 다른 PC가 1시간 넘게 이 PC의 변경을 받지 못하면 오류로 표시합니다 (한쪽 PC의 클라우드 앱이 업로드/다운로드를 멈춘 상태).
- 팝업의 "파일 ↓"는 받은 파일만 셉니다. 삭제는 따로 "다른 PC에서 지운 파일 N개 삭제"로 표시됩니다.

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

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| 팝업에 "네이티브 호스트가 설치되지 않았습니다" | 확장을 로드한 브라우저(예: Aside 브라우저)에 호스트가 등록 안 됨 | 설치 명령 다시 실행 (v1.1.0+ 설치 스크립트는 Aside 브라우저 포함). 수동: `~/Library/Application Support/<브라우저>/NativeMessagingHosts/com.aside.sync.json` |
| `.aside-sync` 폴더가 선택 창에 안 보임 | macOS 숨김 폴더 | 선택 창에서 **Cmd+Shift+G** → `~/.aside-sync/app/extension` |
| (GitHub 모드) "저장소에 접근할 수 없습니다" / "올리지 못했습니다" | 네트워크, GitHub 로그인(자격 증명) 만료, 저장소 주소 오류 | 터미널에서 `git ls-remote <주소>`가 되는지 확인. 실패한 변경은 로컬 커밋으로 남아 다음 동기화 때 올라갑니다 |
| 다른 PC의 채팅이 안 보임, "연결된 PC"에 이 PC만 있음 | 그 PC의 클라우드 앱이 업로드/다운로드를 안 함 (로그아웃, 일시중지, 재로그인 후 꼬임) | 그 PC에서 클라우드 앱 상태 확인 → 앱 재시작 → 안 되면 계정 연결 해제 후 재로그인. **재로그인 전에 `unschedule`로 자동 동기화를 꺼두세요** |
| Drive에 `AsideSync`, `AsideSync 2`가 생김 | 두 PC가 같은 이름 폴더를 따로 만들었음 (한쪽이 오프라인/로그아웃 상태) | 하나를 정해 모든 PC의 syncDir을 같은 폴더로 지정 → 동기화 → 나머지 폴더는 휴지통으로 |
| 동기화는 됐는데 채팅 목록에 없음 | Aside가 실행 중에는 새 채팅을 목록에 반영하지 않음 | Aside(브라우저) 재시작 |
| 자동 동기화가 "저장됨 (다음 로그인부터)" | launchd 등록이 현재 세션에서 거부됨 (원격/샌드박스 셸 등) | 팝업의 **다시 등록** 또는 터미널에서 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aside.sync.plist` |
| 다른 PC에서 파일 수십 개가 "지워짐"으로 올라옴 | 그 PC에 Aside 계정 폴더가 여러 개(`u/0`, `u/1`)이고, v1.1.5 이하는 최근 사용 계정을 자동 선택해 계정이 중간에 바뀜 | v1.1.6으로 업데이트 후 `config accountDir='"~/.aside/u/<id>"'`로 계정 지정. 지워진 파일은 원본이 있는 PC에서 `sync --keep-local` |
| 메모리 파일이 사라짐 | v1.1.0 이하에서 동기화 폴더가 바뀌었을 때의 버그 (v1.1.1에서 수정) | 이전 폴더(`AsideSync 2` 등)의 `manifests/<deviceId>.json` 해시로 `blobs/`에서 복원. 휴지통에서 이전 폴더 복원 가능(30일) |

## 변경 이력

- **1.2.0**: GitHub(git) 저장소 동기화 모드, 양쪽에서 고친 메모리 텍스트 파일 줄 단위 3-way 병합, `memory/.dream-state.json` 제외(PC별 상태), 충돌로 진 쪽 사본도 `conflicts/`에 `.other-pc`로 백업, 옵션에서 계정 고정 유지
- **1.1.6**: Aside 계정 폴더(`~/.aside/u/<id>`)가 여러 개면 자동으로 고르지 않음. 처음 동기화한 계정을 config에 고정하고, 계정이 바뀌면 비교 기준 초기화
- **1.1.5**: 대량 삭제가 막혔을 때 `sync --keep-local`로 이 PC 파일을 다시 올려 되살리는 옵션
- **1.1.4**: 동기화 중 폴더 자동 생성 금지, 대량 삭제 차단 + 삭제 전 백업, PC 간 수신 확인으로 클라우드 정지 감지, 팝업에 삭제 수/엔진 메모 표시
- **1.1.3**: Google Drive 중복 하위 폴더(`a6 2`) 허용
- **1.1.2**: `memory/.local-memory` 제외(PC별 인덱스), 재설치 시 실행 중인 launchd 작업 유지
- **1.1.1**: 동기화 폴더가 바뀌면 메모리 파일을 지우던 버그 수정 (비교 기준 초기화)
- **1.1.0+**: 설치 스크립트가 Aside 브라우저에도 네이티브 호스트 등록

## 주의

- Aside 내부 DB 구조(비공개)에 맞춰 만든 도구입니다. Aside 업데이트로 스키마가 바뀌면 없는 컬럼은 자동으로 무시하지만, 큰 변경 시 수정이 필요할 수 있습니다.
- 클라우드 폴더에는 채팅 원문이 그대로 저장됩니다. 본인 계정의 드라이브를 사용하세요.
- 처음 쓸 때는 `~/.aside/u/<id>/state.db`를 따로 백업해 두길 권장합니다.
