# Chrome 웹 스토어 등록 자료

## 제출 절차
1. 개발자 계정 등록 (일회성 $5): https://chrome.google.com/webstore/devconsole
2. `scripts/package-extension.sh` 실행 → `dist/aside-sync-<버전>.zip`
3. 대시보드 > 새 항목 > zip 업로드
4. **기존 확장 ID 유지(선택)**: 대시보드 > 패키지(Package) > 공개 키 추가에 아래 값 입력
   (첫 업로드 후 ID가 달라지면 `install/*`의 허용 ID를 새 ID로 바꿔야 함)
   `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA8O+jYoVfppgTVK427gxKHnwjhDL7Mhwwe+epcSisg85r4xQRA1d9zEFI5zNRHYgizjwPbxa9KPXgXzUQNmtjO+/n6/WFkF4hEmFUR6/xRp2+UOpvbiBU6SxHttYozqiVEeCwrum1lAXvl+lLRf1mYfVL598NWmVAe634F3ZNNoIaNC3qamefwbVP3SjP6v63MN76ZBUTMH/f4OzEEIZkZ7bFF7hcBlTTzOByRPXlpF2ouz6GFpnQwMC1z46z8xilwG3h8/HHzla9ffUl9D0CPb9ANAqUd8aTi3f7TQAd3C9+V4+CV8Z/r5KRZdolWvUExJr9W/9s4x81myWnLbVhwwIDAQAB`
5. 스토어 등록정보/개인정보/배포 탭을 아래 내용으로 채우고, 개인정보처리방침 URL에
   `https://github.com/jisoon/aside-sync/blob/main/docs/privacy-policy.md` 입력 (푸시 후 유효)
6. 가시성: **공개(Public)** → 심사 제출

## 이름 / 요약(132자 이내)
- ko: Aside Sync
- 요약 ko: 여러 PC의 Aside 채팅·메모리·스킬을 내 GitHub 비공개 저장소로 자동 동기화합니다.
- 요약 en: Sync Aside chats, memory and skills across your PCs through your own private GitHub repository.

## 상세 설명 (ko)
Aside Sync는 여러 PC에서 쓰는 Aside의 채팅 기록, 프로젝트, 메모리, 스킬, AGENTS.md/SOUL.md를 내 GitHub 비공개 저장소로 동기화합니다. 별도 서버가 없고, 데이터는 내 PC와 내 저장소 사이로만 이동합니다.

기능
• 팝업에서 상태, 마지막 동기화 시각, 연결된 PC 목록 확인, "지금 동기화"
• 15분마다 자동 동기화(OS 예약 작업, 크롬이 꺼져 있어도 동작)
• 커밋 단위 업로드, 전체 이력으로 복구 가능
• 대량 삭제 차단과 삭제 전 백업 등 안전장치

⚠ 설치 전 꼭 읽어주세요
이 확장은 PC에 설치하는 로컬 동기화 엔진과 함께 동작합니다. 스토어에서 확장을 설치한 뒤, 각 PC에서 터미널 명령 한 줄로 엔진을 설치해야 합니다.
macOS: curl -fsSL https://raw.githubusercontent.com/jisoon/aside-sync/main/install.sh | bash
Windows(PowerShell): irm https://raw.githubusercontent.com/jisoon/aside-sync/main/install.ps1 | iex
필요: Git, GitHub 비공개 저장소.
채팅 원문이 저장소에 올라가므로 반드시 비공개 저장소를 사용하세요.
안내: https://github.com/jisoon/aside-sync

## Description (en)
Aside Sync syncs Aside chat history, projects, memory, skills and AGENTS.md/SOUL.md across your PCs through a private GitHub repository you own. No servers; data only moves between your PCs and your repository.

Features: status popup with "Sync now"; automatic sync every 15 minutes via the OS scheduler (works even when Chrome is closed); commit-based uploads with full history; mass-delete protection with backups.

IMPORTANT: this extension works together with a local sync engine. After installing from the store, run the one-line installer on each PC (see https://github.com/jisoon/aside-sync). Requires Git and a private GitHub repository. Chat content is uploaded as-is, so use a private repository.

## 단일 목적(Single purpose)
Aside 데이터를 사용자의 GitHub 비공개 저장소로 동기화하고 그 상태를 보여준다. / Sync Aside data to the user's private GitHub repository and show its status.

## 권한 사유(Permission justification)
- nativeMessaging: PC에 설치된 로컬 동기화 엔진(com.aside.sync)과 통신해 상태 조회·동기화 실행·설정 반영. 이 엔진 없이는 확장이 동작하지 않음. / Communicates with the locally installed sync engine to read status, trigger sync and apply settings.
- alarms: 상태 갱신과 업데이트 확인을 주기적으로 실행. / Periodic status refresh and update checks.
- storage: 확장 설정과 마지막 상태 저장. / Stores extension settings and last-known status.
- notifications: 다른 PC의 채팅을 받았거나 동기화 오류가 났을 때 알림. / Notifies when chats arrive from another PC or a sync error occurs.
- 원격 코드 사용: 아니오(확장 코드는 패키지에 포함, 외부 스크립트 로드 없음). / Remote code: No.

## 개인정보 탭
- 수집 데이터: 사용자가 직접 지정한 GitHub 저장소로만 전송되는 사용자 활동/콘텐츠(채팅 기록). 개발자는 수집하지 않음. 판매·광고·신용 판단 목적 사용 안 함.
- 세 가지 인증 항목(판매 안 함 / 목적 외 사용 안 함 / 신용 목적 사용 안 함) 모두 체크 가능.

## 스크린샷 (1280x800, 최소 1장)
팝업(정상 상태), 옵션 > GitHub 저장소 연결, 대량 삭제 해결 화면 — 직접 캡처 필요.

## 심사 전 확인할 위험
- 팝업/옵션의 "업데이트" 버튼은 확장 파일을 직접 갈아끼우는 자체 업데이트입니다. 스토어 설치본은 스토어가 업데이트하므로 이 버튼은 스토어 버전에서 숨기거나 엔진(host) 업데이트 전용으로 바꾸는 편이 안전합니다(심사에서 원격 코드로 오해 소지).
- Aside 브라우저가 Chrome 웹 스토어 설치를 지원하는지 확인 필요(Chrome에서는 문제 없음).
