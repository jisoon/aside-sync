#!/bin/bash
# Build the Chrome Web Store upload zip: dist/aside-sync-<version>.zip
# The manifest "key" is stripped (the store assigns/holds the ID; register the public key
# under Developer Dashboard > Package to keep the existing extension ID).
set -e
cd "$(dirname "$0")/.."
VER=$(node -p "require('./extension/manifest.json').version")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -R extension/. "$STAGE/"
node -e '
const fs=require("fs"),p=process.argv[1]+"/manifest.json";
const m=JSON.parse(fs.readFileSync(p,"utf8"));delete m.key;
fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n");' "$STAGE"
mkdir -p dist
OUT="$PWD/dist/aside-sync-$VER.zip"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" . -x '.DS_Store')
echo "$OUT"
