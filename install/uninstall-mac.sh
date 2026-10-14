#!/bin/bash
# Removes the native host registration (keeps ~/.aside-sync config/state and your cloud folder)
find "$HOME/Library/Application Support" "$HOME/.config" -path '*NativeMessagingHosts/com.aside.sync.json' -delete 2>/dev/null
rm -rf "$HOME/.aside-sync/host"
echo "제거 완료. 확장은 chrome://extensions 에서 삭제하세요."
