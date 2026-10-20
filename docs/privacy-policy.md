# Aside Sync 개인정보처리방침 / Privacy Policy

시행일 / Effective: 2026-10-19

## 한국어

Aside Sync는 사용자의 여러 PC에 있는 Aside 데이터(채팅 기록, 메모리, 스킬 등)를 **사용자가 직접 지정한 GitHub 비공개 저장소**로 동기화하는 도구입니다.

- **운영자 서버 없음**: 개발자는 어떤 서버도 운영하지 않으며, 사용자의 데이터를 수집·저장·열람하지 않습니다.
- **데이터 이동 경로**: 데이터는 사용자의 PC → 사용자가 지정한 GitHub 저장소 → 사용자의 다른 PC로만 이동합니다. 제3자에게 판매·공유하지 않으며 분석/광고 목적으로 사용하지 않습니다.
- **확장 프로그램이 하는 일**: 확장은 PC에 설치된 로컬 동기화 엔진(네이티브 메시징 호스트 `com.aside.sync`)과 통신해 상태를 표시하고 동기화를 실행합니다. 설정(저장소 주소, 주기 등)은 브라우저 `storage`와 PC의 `~/.aside-sync/`에 저장됩니다.
- **인증 정보**: GitHub 토큰은 macOS 키체인 / Windows 자격 증명 관리자에 저장소 경로 전용으로 저장됩니다(보안 저장소를 쓸 수 없고 사용자가 동의한 경우에 한해 권한 600 파일). 확장이나 개발자에게 전송되지 않습니다.
- **동기화 제외**: 로그인 토큰(`credentials.json`), MCP 설정, 모델 키 등은 동기화하지 않습니다.
- **주의**: 채팅 원문이 저장소에 그대로 올라갑니다. 반드시 **비공개(Private)** 저장소를 사용하세요. 저장소 공개 여부와 접근 권한은 사용자의 책임입니다.
- **삭제**: 확장 제거 및 `uninstall` 스크립트 실행 시 로컬 엔진이 제거됩니다. GitHub 저장소의 데이터는 사용자가 직접 삭제합니다.

문의: https://github.com/jisoon/aside-sync/issues

## English

Aside Sync syncs Aside data (chat history, memory, skills) between a user's own computers via a **private GitHub repository chosen by the user**.

- **No developer-operated servers.** The developer does not collect, store, or access any user data.
- **Data flow:** user's PC → the user's chosen GitHub repository → the user's other PCs. Data is never sold, shared with third parties, or used for analytics or advertising.
- **What the extension does:** it talks to a locally installed sync engine (native messaging host `com.aside.sync`) to show status and trigger syncs. Settings are kept in browser `storage` and in `~/.aside-sync/` on the PC.
- **Credentials:** a GitHub token is stored in the macOS Keychain / Windows Credential Manager, scoped to the repository path (a 0600 file only if secure storage is unavailable and the user consents). It is never sent to the extension developer.
- **Not synced:** login tokens (`credentials.json`), MCP settings, model keys.
- **Note:** chat content is uploaded as-is. Use a **private** repository; repository visibility and access are the user's responsibility.
- **Removal:** uninstalling the extension and running the uninstall script removes the local engine; data in the GitHub repository must be deleted by the user.

Contact: https://github.com/jisoon/aside-sync/issues
