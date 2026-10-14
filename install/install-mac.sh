#!/bin/bash
# Aside Sync - macOS / Linux installer (native messaging host)
set -e
EXT_ID="${1:-dmncckmmjbfdafmjnleocmfogddimkah}"
HOST_NAME="com.aside.sync"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.aside-sync/host"
mkdir -p "$DEST"
cp "$SRC_DIR/host/aside-sync-host.mjs" "$DEST/"

# Find Node >= 22.5 (needs built-in node:sqlite). Prefer the runtime bundled with Aside.
NODE=""
for c in "$HOME/.aside/runtime/bin/node" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -x "$c" ] || continue
  if "$c" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then echo "Node.js 22.5 이상을 찾지 못했습니다. Aside를 설치했거나 Node를 설치한 뒤 다시 실행하세요."; exit 1; fi

cat > "$DEST/aside-sync-host.sh" <<LAUNCH
#!/bin/bash
exec "$NODE" --no-warnings "$DEST/aside-sync-host.mjs" "\$@"
LAUNCH
chmod +x "$DEST/aside-sync-host.sh"

if [ "$(uname)" = "Darwin" ]; then
  BASES=("Aside" "Google/Chrome" "Google/Chrome Beta" "Google/Chrome Canary" "Chromium" "Microsoft Edge" "BraveSoftware/Brave-Browser" "Arc/User Data")
  ROOT="$HOME/Library/Application Support"
else
  BASES=("google-chrome" "google-chrome-beta" "chromium" "microsoft-edge" "BraveSoftware/Brave-Browser")
  ROOT="$HOME/.config"
fi
n=0
for b in "${BASES[@]}"; do
  [ -d "$ROOT/$b" ] || continue
  mkdir -p "$ROOT/$b/NativeMessagingHosts"
  cat > "$ROOT/$b/NativeMessagingHosts/$HOST_NAME.json" <<JSON
{
  "name": "$HOST_NAME",
  "description": "Aside Sync native host",
  "path": "$DEST/aside-sync-host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
JSON
  echo "등록: $b"; n=$((n+1))
done
[ $n -gt 0 ] || { echo "Chrome 계열 브라우저를 찾지 못했습니다."; exit 1; }
echo ""
echo "완료! node: $NODE"
echo "1) chrome://extensions 에서 '개발자 모드' 켜기"
echo "2) '압축해제된 확장 프로그램 로드' -> $SRC_DIR/extension 선택"
echo "3) 확장 ID가 $EXT_ID 인지 확인 후, 옵션에서 동기화 폴더 지정"
