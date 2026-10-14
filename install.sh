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

# ---- sync folder (skip if already configured)
CUR="$("$NODE" --no-warnings "$HOSTJS" status 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).config.syncDir||"")}catch{console.log("")}})')"
if [ -z "$CUR" ]; then
  CANDS=()
  while IFS= read -r line; do [ -n "$line" ] && CANDS+=("$line"); done < <("$NODE" --no-warnings "$HOSTJS" detect 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{for(const c of JSON.parse(s).cloudFolders)console.log(c.label+"\t"+c.path)}catch{}})')
  CHOSEN=""
  if [ ${#CANDS[@]} -gt 0 ] && [ -r /dev/tty ]; then
    echo ""
    echo "동기화 폴더를 선택하세요 (모든 PC에서 같은 클라우드를 골라야 합니다):"
    i=1; for c in "${CANDS[@]}"; do echo "  $i) ${c%%$'\t'*}  -> ${c#*$'\t'}"; i=$((i+1)); done
    echo "  0) 나중에 확장 옵션에서 직접 지정"
    printf "번호 [1]: "; { read -r n </dev/tty; } 2>/dev/null || n=1; n="${n:-1}"
    if [ "$n" != "0" ] && [ "$n" -ge 1 ] 2>/dev/null && [ "$n" -le ${#CANDS[@]} ]; then CHOSEN="${CANDS[$((n-1))]#*$'\t'}"; fi
  fi
  if [ -n "$CHOSEN" ]; then
    "$NODE" --no-warnings "$HOSTJS" config syncDir="$("$NODE" -e 'console.log(JSON.stringify(process.argv[1]))' "$CHOSEN")" >/dev/null
    echo "==> 동기화 폴더: $CHOSEN"
  fi
else
  echo "==> 기존 동기화 폴더 유지: $CUR"
fi

echo ""
echo "✔ 설치 완료. 마지막으로 크롬에 확장을 한 번만 등록하세요:"
echo "   1) 주소창에 chrome://extensions 입력 → 오른쪽 위 '개발자 모드' 켜기"
echo "   2) '압축해제된 확장 프로그램 로드' → 아래 폴더 선택"
echo "      $APP/extension"
echo "   (업데이트 시에는 이 명령을 다시 실행한 뒤 확장의 새로고침 버튼만 누르면 됩니다)"
if [ "$(uname)" = "Darwin" ]; then
  open "$APP" 2>/dev/null || true
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
fi
