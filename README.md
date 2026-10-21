# Aside Sync

여러 PC에서 쓰는 Aside의 **채팅 기록**, 프로젝트, 메모리, 내가 만든 스킬, AGENTS.md/SOUL.md, (선택) 설정을
**GitHub 비공개 저장소**(git)를 통해 자동 동기화합니다. 별도 서버가 필요 없습니다. (v1.5.0부터 Google Drive / iCloud 등 클라우드 폴더 방식은 지원하지 않습니다.)

## 동기화 방식

| 항목 | GitHub 저장소 |
|---|---|
| 업로드 실패 | 바로 오류로 표시 |
| 중간 상태 | 커밋 단위라 반쯤 올라간 상태 없음 |
| 되돌리기 | 전체 이력이 남아 어떤 버전이든 복구 |
| 메모리 동시 수정 | 다른 줄이면 줄 단위로 자동 병합 |
| 필요한 것 | git + GitHub 로그인, **비공개** 저장소 |

> **v1.4.0 이하에서 클라우드 폴더(Drive 등)로 쓰던 PC**: 1.5.0으로 업데이트하면 폴더 방식 동기화는 오류로 멈추고(파일은 지우지 않음) GitHub 연결 안내가 표시됩니다. GitHub 저장소를 연결하면 첫 동기화처럼 처리되어 아무것도 지우지 않습니다.

### 설정 (가장 쉬운 방법)

1. GitHub에서 **비공개(Private)** 빈 저장소를 만듭니다 (예: `aside-sync-data`).
2. 확장 **설정 → GitHub 저장소**에 주소를 붙여넣고 **연결**. 브라우저 주소창 주소(`https://github.com/아이디/aside-sync-data`)를 그대로 넣어도 됩니다.
   저장소 접근 확인 → Aside 계정 고정(여러 개면 지금 쓰는 계정, 화면에서 변경 가능) → 자동 동기화 등록 → 첫 동기화까지 한 번에 합니다.
3. 다른 PC도 같은 주소로 **연결**하면 끝.

**GitHub 로그인이 안 된 PC**: 연결할 때 인증이 필요하면 설정 화면에 토큰 입력 칸이 뜹니다. **토큰 만들기 페이지 열기**를 누르면 이름·기간(366일)·Contents 쓰기 권한이 채워진 GitHub 페이지가 열리고, Repository access에서 이 저장소만 고른 뒤 생성된 토큰을 붙여넣으면 됩니다. 토큰은 macOS 키체인 / Windows 자격 증명 관리자에 **이 저장소 경로 전용**으로 저장됩니다 (config.json·로그·저장소에는 남지 않고, 그 PC의 다른 github.com 로그인은 건드리지 않음). 저장 후 다시 읽어 확인하며, 보안 저장소를 쓸 수 없는 환경에서는 동의를 받아 `~/.aside-sync/git-credentials`(600)에 저장합니다. 토큰이 만료되면 동기화 오류에 안내가 뜨고, 같은 방법으로 교체합니다. CLI: `printf %s "$TOKEN" | aside-sync-host.mjs login <주소>` (토큰은 표준입력으로만), `logout`. Windows에서 Git Credential Manager가 있으면 연결 시 GitHub 로그인 창이 뜰 수 있습니다.

업데이트: 새 버전이 있으면 팝업에 **업데이트** 버튼이 뜹니다. 누르면 새 버전을 받아 설치하고 확장을 스스로 다시 불러옵니다 (터미널 불필요). 터미널에서는 `aside-sync-host.mjs update`.

처음 설치(크롬과 엔진 연결 등록)만 PC마다 한 번 설치 명령이 필요합니다. 브라우저 보안상 확장이 스스로 할 수 없는 단계입니다.

### 설정 (수동/CLI)

1. GitHub에서 **비공개(Private)** 저장소를 하나 만듭니다 (예: `aside-sync-data`, README 없이 빈 저장소). 채팅 원문이 올라가므로 절대 공개로 만들지 마세요.
2. 각 PC에서 그 저장소에 `git push`가 되는지 확인합니다 (평소 쓰는 GitHub 로그인/자격 증명 그대로 사용).
3. 확장 옵션의 **GitHub 저장소**에 주소를 넣고 저장하거나, CLI로:
   ```bash
   ~/.aside/runtime/bin/node ~/.aside-sync/host/aside-sync-host.mjs config gitRemote='"https://github.com/<아이디>/aside-sync-data.git"'
   ```
   저장할 때 저장소 접근을 바로 확인합니다. 로컬 사본은 `~/.aside-sync/repo`에 생깁니다.

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

> 크롬 웹 스토어에서 확장을 설치했다면 명령어가 필요 없습니다. 확장 설정 화면의 **설치 파일 받기**를 누르고, 받은 파일을 한 번 여세요 (macOS는 우클릭 → 열기). 아래 명령어는 확장 없이 쓰거나 직접 설치하는 경우를 위한 방법입니다.

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

설치 후 확장 설정에서 GitHub 저장소 주소를 넣고 **연결**하면 됩니다. **모든 PC에서 같은 저장소**를 연결하세요.
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

## 수동 설치

1. 이 저장소를 PC에 받기 (Code → Download ZIP)
2. 네이티브 호스트 등록
   - macOS: `bash install/install-mac.sh`
   - Windows: PowerShell에서 `powershell -ExecutionPolicy Bypass -File .\install\install-windows.ps1`
   - Node 22.5 이상이 필요합니다. Aside에 내장된 Node(`~/.aside/runtime/bin/node` 또는 `~/.aside/runtime/node/bin/node`), 그다음 PC에 설치된 Node를 쓰고, 둘 다 없으면 nodejs.org 공식 배포본을 받아 `~/.aside-sync/runtime`에 둡니다 (공식 체크섬 검증, 시스템 Node·PATH는 건드리지 않음, 관리자 권한 불필요).
3. 크롬 `chrome://extensions` → 개발자 모드 ON → **압축해제된 확장 프로그램 로드** → `extension` 폴더 선택
   - 확장 ID: `dmncckmmjbfdafmjnleocmfogddimkah` (manifest의 key로 고정되어 모든 PC에서 같음)
4. 확장 옵션 페이지에서 **모든 PC에 같은 GitHub 비공개 저장소**를 입력하고 **연결**. 연결하면 자동 동기화(OS 예약 작업)도 함께 등록됩니다.

> 첫 PC에서 먼저 동기화한 뒤 다음 PC를 연결하세요. 새로 받은 채팅이 Aside 목록에 바로 안 보이면 Aside(크롬)를 한 번 재시작하면 됩니다.

## 동작 방식

- **채팅**: `state.db`의 sessions / session_turns / 메모리 추출 행 + 세션 폴더의 `messages.jsonl`, `artifacts/`, `attachments/`를 세션 단위로 동기화합니다. `tmp/`는 제외됩니다.
- **PC마다 다른 경로**(예: `/Users/a/.aside/u/1` ↔ `C:\Users\b\.aside\u\2`)는 자동 변환됩니다.
- **변경 감지**: 마지막 동기화 시점 대비 3-way 비교. 한쪽만 바뀌면 그쪽을 반영하고, 양쪽 다 바뀌면 **최신 쪽이 이깁니다**. 덮어쓰인 메모리 파일은 `~/.aside-sync/conflicts/`에 백업됩니다.
- **실행 중인 채팅은 건너뛰고** 다음 동기화 때 처리합니다.
- 파일은 내용 해시 기반(blob)으로 저장되어 바뀐 파일만 업로드되고, 안 쓰는 blob은 3일 뒤 정리됩니다.

### 안전장치 (v1.1.1 ~ v1.1.4)

- **저장소가 바뀌면 비교 기준 초기화**: 연결한 저장소가 바뀌거나 새로 만들어지면 첫 동기화처럼 처리합니다. 새 저장소에 없는 파일을 "다른 PC에서 지움"으로 오인해 삭제하지 않습니다.
- **이 PC의 파일 목록이 폴더에 없으면 삭제하지 않음**: 위와 같은 이유로, 폴더에 이 PC의 manifest가 없으면 기준을 초기화합니다.
- **대량 삭제 차단**: 한 번에 max(5개, 로컬 파일의 20%)를 넘는 삭제는 실행하지 않고 오류로 알립니다. 삭제를 받아들이려면 `sync --allow-mass-delete`, 이 PC의 파일로 되살리려면(다른 PC에도 다시 퍼짐) `sync --keep-local`. 삭제되는 파일은 항상 `~/.aside-sync/conflicts/<시각>/deleted/`에 백업됩니다.
- **동기화 정지 감지**: 각 PC가 "다른 PC의 어느 시점까지 봤는지"를 기록합니다. 활동 중인 다른 PC가 1시간 넘게 이 PC의 변경을 받지 못하면 오류로 표시합니다 (한쪽 PC의 push/pull이 멈춘 상태).
- 팝업의 "파일 ↓"는 받은 파일만 셉니다. 삭제는 따로 "다른 PC에서 지운 파일 N개 삭제"로 표시됩니다.

## 동기화하지 않는 것

- `credentials.json`(로그인 토큰), 비밀번호 관리자 연동, MCP 설정, 커스텀 모델 키, `routineDeviceId`
- 루틴(예약 작업): 여러 PC에서 중복 실행되는 걸 막기 위해 제외
- Slack/Telegram 채널 연결, 브라우저 탭 바인딩, 시크릿/임시 세션
- 설정(settings.json)은 기본 OFF (옵션에서 켤 수 있음)

## CLI (확장 없이도 사용 가능)

```bash
NODE=~/.aside/runtime/bin/node
$NODE ~/.aside-sync/host/aside-sync-host.mjs connect https://github.com/<아이디>/aside-sync-data   # 한 번에 설정
$NODE ~/.aside-sync/host/aside-sync-host.mjs update        # 최신 버전으로 업데이트
$NODE ~/.aside-sync/host/aside-sync-host.mjs detect        # Aside 계정 감지
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
| "저장소에 접근할 수 없습니다" / "올리지 못했습니다" | 네트워크, GitHub 로그인(자격 증명) 만료, 저장소 주소 오류 | 터미널에서 `git ls-remote <주소>`가 되는지 확인. 실패한 변경은 로컬 커밋으로 남아 다음 동기화 때 올라갑니다 |
| 동기화는 됐는데 채팅 목록에 없음 | Aside가 실행 중에는 새 채팅을 목록에 반영하지 않음 | Aside(브라우저) 재시작 |
| 자동 동기화가 "저장됨 (다음 로그인부터)" | launchd 등록이 현재 세션에서 거부됨 (원격/샌드박스 셸 등) | 팝업의 **다시 등록** 또는 터미널에서 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aside.sync.plist` |
| 다른 PC에서 파일 수십 개가 "지워짐"으로 올라옴 | 그 PC에 Aside 계정 폴더가 여러 개(`u/0`, `u/1`)이고, v1.1.5 이하는 최근 사용 계정을 자동 선택해 계정이 중간에 바뀜 | v1.1.6으로 업데이트 후 `config accountDir='"~/.aside/u/<id>"'`로 계정 지정. 지워진 파일은 원본이 있는 PC에서 `sync --keep-local` |

## 변경 이력

- **1.6.0**: 확장 설정 화면에서 **엔진 설치** (터미널 명령 없이 설치 파일을 받아 한 번 열기). Node.js가 없는 PC도 설치기가 Node를 스스로 준비합니다. 메모리 감사 로그 `memory/.history.jsonl`은 PC별 파일이라 동기화에서 제외하고, `maxFileMB`를 일반 파일(메모리·스킬)에도 적용 (push가 HTTP 408로 실패하던 원인)
- **1.5.2**: 설정 페이지에 새 버전 알림 배너와 업데이트 버튼, '업데이트 확인' 링크 추가 (팝업과 같은 자체 업데이트)
- **1.5.1**: 대량 삭제가 차단되면 팝업에 파일 목록과 선택 버튼(삭제 받아들이기 / 이 PC 파일로 되살리기)을 표시. 폴더 이동(정리)이 삭제로 보이는 경우를 터미널 없이 처리
- **1.5.0**: Google Drive / iCloud 등 클라우드 폴더 동기화 제거 (GitHub 전용). 폴더 자동 감지, 폴더 선택 UI, 설치 스크립트의 폴더 선택 단계, `config syncDir` 삭제. 기존 폴더 방식 PC는 오류 안내 후 중단(파일 삭제 없음)
- **1.4.0**: GitHub 인증 처리. 인증 실패 감지 및 안내, 확장에서 저장소 전용 토큰 입력(미리 채운 토큰 생성 링크), OS 보안 저장소에 저장소 경로 전용으로 저장 + 저장 확인, 동의 시 파일 저장 대안, 토큰 삭제, CLI `login`/`logout`. 버그 수정: 받기만 하는 PC가 자기 파일 목록을 안 올려 매번 비교 기준이 초기화되던 문제(병합 안 됨, 다른 PC에서 지운 파일을 되살림)
- **1.3.0**: 확장에서 GitHub 주소만 넣고 **연결**하면 접근 확인, 계정 고정, 자동 동기화 등록, 첫 동기화까지 한 번에. 팝업 **업데이트** 버튼(자체 업데이트 후 확장 자동 새로고침). CLI `connect <주소>`, `update`, `check-update`
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
- GitHub 저장소에는 채팅 원문이 그대로 저장됩니다. 반드시 **비공개(Private)** 저장소를 사용하세요.
- 처음 쓸 때는 `~/.aside/u/<id>/state.db`를 따로 백업해 두길 권장합니다.
