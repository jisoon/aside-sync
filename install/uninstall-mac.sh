#!/bin/bash
# Removes the native host registration (keeps ~/.aside-sync config/state and your GitHub repository)
N="$(grep -o 'exec "[^"]*"' "$HOME/.aside-sync/host/aside-sync-host.sh" 2>/dev/null | head -1 | cut -d'"' -f2)"
[ -n "$N" ] && "$N" --no-warnings "$HOME/.aside-sync/host/aside-sync-host.mjs" unschedule >/dev/null 2>&1 || true
find "$HOME/Library/Application Support" "$HOME/.config" -path '*NativeMessagingHosts/com.aside.sync.json' -delete 2>/dev/null
rm -rf "$HOME/.aside-sync/host"
echo "제거 완료. 확장은 chrome://extensions 에서 삭제하세요."
