#!/bin/bash
# Aside Sync one-line installer (macOS / Linux)
#   curl -fsSL https://raw.githubusercontent.com/jisoon/aside-sync/main/install.sh | bash
# Re-run the same command to update.
set -e
REPO="${ASIDE_SYNC_REPO:-jisoon/aside-sync}"
BRANCH="${ASIDE_SYNC_BRANCH:-main}"
APP="$HOME/.aside-sync/app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Aside Sync 다운로드 ($REPO@$BRANCH)"
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
mkdir -p "$APP"
rm -rf "$APP/extension" "$APP/host" "$APP/install"
cp -R "$SRC/extension" "$SRC/host" "$SRC/install" "$SRC/README.md" "$APP/"

echo "==> 네이티브 호스트 등록"
bash "$APP/install/install-mac.sh" >/tmp/aside-sync-install.log 2>&1 || { cat /tmp/aside-sync-install.log; exit 1; }
grep '^등록' /tmp/aside-sync-install.log || true
NODE="$(grep -o 'exec "[^"]*"' "$HOME/.aside-sync/host/aside-sync-host.sh" | head -1 | cut -d'"' -f2)"
HOSTJS="$HOME/.aside-sync/host/aside-sync-host.mjs"

# ---- GitHub connection (Google Drive / iCloud folder sync is not supported)
GITREMOTE="$("$NODE" --no-warnings "$HOSTJS" status 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).config.gitRemote||"")}catch{console.log("")}})')"
if [ -n "$GITREMOTE" ]; then
  echo "==> GitHub 저장소 유지: $GITREMOTE"
else
  echo "==> GitHub 저장소가 아직 연결되지 않았습니다. 설치 후 아래 중 하나로 연결하세요:"
  echo "    - 확장 설정 > GitHub 저장소 주소 입력 > 연결"
  echo "    - $NODE $HOSTJS connect https://github.com/<아이디>/aside-sync-data"
fi

echo "==> 자동 동기화 등록 (크롬이 꺼져 있어도 백그라운드에서 실행)"
SCHED="$("$NODE" --no-warnings "$HOSTJS" schedule 2>&1 || true)"
if echo "$SCHED" | grep -q '"installed": true'; then echo "    등록 완료"; elif echo "$SCHED" | grep -q '"pendingLogin": true'; then echo "    저장됨 (다음 로그인부터 실행)"; else echo "    등록 실패: 확장 팝업의 '다시 등록' 버튼으로 재시도하세요"; echo "$SCHED" | tail -3; fi

echo ""
echo "✔ 설치 완료. 동기화는 이제 자동으로 돌아갑니다."
echo ""
# ASIDE_SYNC_HOST_ONLY=1: run from the extension's "install engine" button (extension already installed)
if [ "${ASIDE_SYNC_HOST_ONLY:-}" = "1" ]; then
  echo "이 창은 닫고 크롬 확장 설정 화면으로 돌아가세요."
  exit 0
fi
echo "상태 확인용 크롬 확장 (선택, 한 번만):"
echo "   1) 주소창에 chrome://extensions 입력 → 오른쪽 위 '개발자 모드' 켜기"
echo "   2) '압축해제된 확장 프로그램 로드' → 아래 폴더 선택"
echo "      $APP/extension"
echo "   (업데이트 시에는 이 명령을 다시 실행한 뒤 확장의 새로고침 버튼만 누르면 됩니다)"
if [ "$(uname)" = "Darwin" ]; then
  open "$APP" 2>/dev/null || true
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
fi
