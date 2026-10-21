#!/bin/bash
# Aside Sync - macOS / Linux installer (native messaging host)
set -e
EXT_ID="${1:-dmncckmmjbfdafmjnleocmfogddimkah}"
HOST_NAME="com.aside.sync"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/.aside-sync/host"
mkdir -p "$DEST"
cp "$SRC_DIR/host/aside-sync-host.mjs" "$DEST/"

# Find Node >= 22.5 (needs built-in node:sqlite). Prefer the runtime bundled with Aside, then the system Node,
# then a runtime this installer downloaded earlier. ASIDE_SYNC_FORCE_RUNTIME=1 skips the first two (testing).
RT="$HOME/.aside-sync/runtime"
NODE=""
CANDS=("$RT/node/bin/node")
[ "${ASIDE_SYNC_FORCE_RUNTIME:-}" = "1" ] || CANDS=("$HOME/.aside/runtime/bin/node" "$HOME/.aside/runtime/node/bin/node" "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$RT/node/bin/node")
for c in "${CANDS[@]}"; do
  [ -x "$c" ] || continue
  if "$c" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null; then NODE="$c"; break; fi
done

# No usable Node: fetch the official build into ~/.aside-sync/runtime (no admin rights, nothing system-wide).
# The archive is checked against nodejs.org's published SHASUMS256.txt before it is unpacked.
fetch_node() {
  local os arch base tmp line file sum got
  case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64) arch=x64;; *) echo "지원하지 않는 CPU입니다: $(uname -m)" >&2; return 1;; esac
  case "$(uname)" in Darwin) os=darwin;; Linux) os=linux;; *) echo "지원하지 않는 운영체제입니다: $(uname)" >&2; return 1;; esac
  base="https://nodejs.org/dist/latest-v22.x"
  echo "Node.js 런타임을 내려받는 중입니다 (처음 한 번, 약 40MB)..." >&2
  tmp="$(mktemp -d)"
  curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt" || { echo "Node.js 체크섬 목록을 받지 못했습니다. 인터넷 연결을 확인하세요." >&2; rm -rf "$tmp"; return 1; }
  line="$(grep -E " node-v[0-9.]+-$os-$arch\.tar\.gz\$" "$tmp/SHASUMS256.txt" | head -1)"
  [ -n "$line" ] || { echo "이 PC($os-$arch)용 Node.js 배포본을 찾지 못했습니다." >&2; rm -rf "$tmp"; return 1; }
  sum="${line%% *}"; file="${line##* }"
  curl -fL --progress-bar "$base/$file" -o "$tmp/$file" || { echo "Node.js를 내려받지 못했습니다. 인터넷 연결과 디스크 여유 공간을 확인하세요." >&2; rm -rf "$tmp"; return 1; }
  got="$(shasum -a 256 "$tmp/$file" | cut -d' ' -f1)"
  [ "$got" = "$sum" ] || { echo "내려받은 Node.js의 체크섬이 공식 값과 다릅니다. 설치를 중단합니다. (받은 값 $got / 공식 값 $sum)" >&2; rm -rf "$tmp"; return 1; }
  tar -xzf "$tmp/$file" -C "$tmp" || { echo "Node.js 압축을 풀지 못했습니다. 디스크 여유 공간을 확인하세요." >&2; rm -rf "$tmp"; return 1; }
  rm -rf "$RT/node"; mkdir -p "$RT"
  mv "$tmp/${file%.tar.gz}" "$RT/node" || { echo "Node.js를 $RT 에 두지 못했습니다." >&2; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  echo "$RT/node/bin/node"
}
if [ -z "$NODE" ]; then
  echo "이 PC에서 Node.js 22.5 이상을 찾지 못해 설치용 Node.js를 준비합니다. (시스템 Node와 PATH는 건드리지 않습니다)"
  NODE="$(fetch_node)" || { echo "설치에 실패했습니다: Node.js를 준비하지 못했습니다."; exit 1; }
  "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)' 2>/dev/null || { echo "내려받은 Node.js가 실행되지 않습니다."; exit 1; }
fi

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
echo "3) 확장 ID가 $EXT_ID 인지 확인 후, 옵션에서 GitHub 저장소 연결"
