const $ = (id) => document.getElementById(id);
const host = (payload) => chrome.runtime.sendMessage({ type: 'host', payload });

async function load() {
  const st = await host({ type: 'status' });
  if (st?.type === 'error') {
    $('hostErr').hidden = false;
    $('hostErr').textContent = `${st.error}\n\n설치 폴더의 install 스크립트(macOS: install-mac.sh, Windows: install-windows.ps1)를 실행한 뒤 이 페이지를 새로고침하세요.`;
    return;
  }
  const c = st.config;
  $('syncDir').value = c.syncDir || '';
  $('deviceName').value = c.deviceName || '';
  $('autoSyncMinutes').value = c.autoSyncMinutes;
  $('syncOnStartup').checked = !!c.syncOnStartup;
  $('maxFileMB').value = c.maxFileMB;
  for (const el of document.querySelectorAll('[data-inc]')) el.checked = !!c.include[el.dataset.inc];
  $('home').textContent = st.syncHome;
  $('ver').textContent = `v${st.version} (node ${st.node})`;

  const det = await host({ type: 'detect' });
  const sel = $('accountDir');
  sel.innerHTML = '<option value="">자동 선택</option>';
  for (const a of det.accounts || []) {
    const o = document.createElement('option');
    o.value = a.dir;
    o.textContent = `u/${a.id} · 채팅 폴더 ${a.sessionFolders}개 · 최근 사용 ${new Date(a.lastActive).toLocaleString()}`;
    sel.appendChild(o);
  }
  sel.value = c.accountDir || '';
  $('clouds').innerHTML = '';
  for (const cf of det.cloudFolders || []) {
    const b = document.createElement('button');
    b.textContent = cf.label;
    b.title = cf.path;
    b.onclick = () => { $('syncDir').value = cf.path; };
    $('clouds').appendChild(b);
  }
  if (!det.cloudFolders?.length) $('clouds').innerHTML = '<span class="muted">감지된 폴더 없음. 직접 경로를 입력하세요.</span>';
}

async function save() {
  const include = {};
  for (const el of document.querySelectorAll('[data-inc]')) include[el.dataset.inc] = el.checked;
  const config = {
    syncDir: $('syncDir').value.trim(),
    deviceName: $('deviceName').value.trim() || undefined,
    accountDir: $('accountDir').value,
    autoSyncMinutes: Number($('autoSyncMinutes').value) || 0,
    syncOnStartup: $('syncOnStartup').checked,
    maxFileMB: Number($('maxFileMB').value) || 100,
    include,
  };
  const r = await host({ type: 'setConfig', config });
  if (r?.type === 'error') throw new Error(r.error);
  await chrome.runtime.sendMessage({ type: 'reschedule' });
  return r.config;
}

$('save').onclick = async () => {
  try { await save(); $('msg').className = 'ok'; $('msg').textContent = '저장했습니다.'; }
  catch (e) { $('msg').className = 'err'; $('msg').textContent = e.message; }
};
$('saveSync').onclick = async () => {
  try {
    await save();
    $('msg').className = 'muted'; $('msg').textContent = '동기화 중...';
    const r = await chrome.runtime.sendMessage({ type: 'sync' });
    if (!r?.ok) throw new Error(r?.error || '실패');
    const s = r.result.sessions; const f = r.result.files;
    $('msg').className = r.result.ok ? 'ok' : 'err';
    $('msg').textContent = `완료: 채팅 ↑${s.uploaded} ↓${s.downloaded}, 파일 ↑${f.uploaded} ↓${f.downloaded}` + (r.result.errors.length ? `\n오류: ${r.result.errors.join('\n')}` : '');
  } catch (e) { $('msg').className = 'err'; $('msg').textContent = e.message; }
};
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'sync-progress') $('msg').textContent = m.message; });

load();
