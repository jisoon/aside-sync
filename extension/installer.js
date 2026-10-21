// Builds the one-click engine installer entirely inside the extension (no server, no extra permissions).
// A browser extension cannot register a native messaging host itself, so the user opens this file once:
//  - macOS:   zip holding an executable .command (a bare download would lose the +x bit and not run)
//  - Windows: .cmd
// Both just run the repo's own installer with ASIDE_SYNC_HOST_ONLY=1 (host only; the extension is already installed).
// That installer fetches its own Node.js runtime when the PC has none, so nothing else has to be installed first.
(function (root) {
  const REPO = 'jisoon/aside-sync';
  const RAW = `https://raw.githubusercontent.com/${REPO}/main`;
  const MAC_NAME = 'Install Aside Sync.command';

  const MAC_SCRIPT = `#!/bin/bash
clear
echo "Aside Sync 엔진을 설치합니다. 잠시만 기다려 주세요..."
echo ""
export ASIDE_SYNC_HOST_ONLY=1
if curl -fsSL ${RAW}/install.sh | bash; then
  echo ""
  echo "✔ 설치가 끝났습니다. 이 창은 닫고 크롬 확장 설정 화면으로 돌아가세요."
else
  echo ""
  echo "✘ 설치에 실패했습니다. 위의 메시지에 원인이 적혀 있습니다."
  echo "  (인터넷 연결과 디스크 여유 공간을 확인한 뒤 이 파일을 다시 열면 이어서 설치합니다.)"
fi
echo ""
read -n 1 -s -r -p "아무 키나 누르면 이 창이 닫힙니다."
`;

  const WIN_SCRIPT = [
    '@echo off',
    'chcp 65001 >nul',
    'echo Aside Sync 엔진을 설치합니다. 잠시만 기다려 주세요...',
    'echo.',
    'set ASIDE_SYNC_HOST_ONLY=1',
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${RAW}/install.ps1 | iex"`,
    'if errorlevel 1 (',
    '  echo.',
    '  echo 설치에 실패했습니다. 위의 메시지에 원인이 적혀 있습니다. 인터넷 연결과 디스크 여유 공간을 확인한 뒤 이 파일을 다시 실행하세요.',
    ') else (',
    '  echo.',
    '  echo 설치가 끝났습니다. 이 창은 닫고 크롬 확장 설정 화면으로 돌아가세요.',
    ')',
    'echo.',
    'pause',
    '',
  ].join('\r\n');

  const enc = (s) => new TextEncoder().encode(s);

  let crcTable;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Single-entry, uncompressed zip with unix mode 0755 so Finder/Archive Utility restores the executable bit.
  function zipExecutable(name, data) {
    const nameB = enc(name);
    const crc = crc32(data);
    const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1; // 2024-01-01, a fixed stamp keeps the output reproducible
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    local.setUint16(28, 0, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, (3 << 8) | 20, true); // made by: Unix
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameB.length, true);
    central.setUint32(38, (0o100755 << 16) >>> 0, true); // external attrs: -rwxr-xr-x
    central.setUint32(42, 0, true);
    const localLen = 30 + nameB.length + data.length;
    const centralLen = 46 + nameB.length;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, 1, true);
    eocd.setUint16(10, 1, true);
    eocd.setUint32(12, centralLen, true);
    eocd.setUint32(16, localLen, true);
    const out = new Uint8Array(localLen + centralLen + 22);
    let p = 0;
    for (const part of [new Uint8Array(local.buffer), nameB, data, new Uint8Array(central.buffer), nameB, new Uint8Array(eocd.buffer)]) { out.set(part, p); p += part.length; }
    return out;
  }

  function detectOs() {
    const p = (root.navigator?.userAgentData?.platform || root.navigator?.platform || root.navigator?.userAgent || '').toLowerCase();
    if (p.includes('mac')) return 'mac';
    if (p.includes('win')) return 'win';
    return null;
  }

  function build(os) {
    if (os === 'mac') return { filename: 'Install-Aside-Sync-mac.zip', mime: 'application/zip', bytes: zipExecutable(MAC_NAME, enc(MAC_SCRIPT)), inner: MAC_NAME };
    if (os === 'win') return { filename: 'Install-Aside-Sync.cmd', mime: 'application/octet-stream', bytes: enc(WIN_SCRIPT), inner: 'Install-Aside-Sync.cmd' };
    throw new Error('지원하지 않는 운영체제입니다 (macOS, Windows만 지원).');
  }

  const api = { detectOs, build, crc32, MAC_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AsideInstaller = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
