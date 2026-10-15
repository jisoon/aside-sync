const $ = (id) => document.getElementById(id);
const host = (payload) => chrome.runtime.sendMessage({ type: 'host', payload });

function showSched(sc, minutes) {
  const el = $('schedState');
  if (!sc) { el.textContent = ''; return; }
  if (!minutes) { el.className = 'muted'; el.textContent = '자동 동기화 꺼짐 (수동으로만 동기화)'; }
  else if (sc.installed) { el.className = 'ok'; el.textContent = `✔ ${sc.kind}에 등록됨: ${minutes}분마다 실행`; }
  else if (sc.pendingLogin) { el.className = 'muted'; el.textContent = `${sc.kind}에 저장됨: 다음 로그인부터 ${minutes}분마다 실행`; }
  else { el.className = 'err'; el.textContent = `자동 동기화가 등록되지 않았습니다${sc.error ? ': ' + sc.error : ''}. 팝업의 '다시 등록' 버튼을 눌러보세요.`; }
}

async function load() {
  const st = await host({ type: 'status' });
  if (st?.type === 'error') {
    $('hostErr').hidden = false;
    $('hostErr').textContent = `${st.error}\n\n설치 폴더의 install 스크립트(macOS: install-mac.sh, Windows: install-windows.ps1)를 실행한 뒤 이 페이지를 새로고침하세요.`;
    return;
  }
  const c = st.config;
  $('gitRemote').value = c.gitRemote || '';
  $('authState').textContent = c.gitAuth ? `(토큰 사용 중: ${c.gitAuth.helper.startsWith('store') ? '파일' : c.gitAuth.helper})` : '';
  $('deviceName').value = c.deviceName || '';
  $('autoSyncMinutes').value = c.autoSyncMinutes;
  showSched(st.scheduler, c.autoSyncMinutes);
  $('maxFileMB').value = c.maxFileMB;
  for (const el of document.querySelectorAll('[data-inc]')) el.checked = !!c.include[el.dataset.inc];
  $('home').textContent = st.syncHome;
  $('ver').textContent = `v${st.version} (node ${st.node})`;

  const det = await host({ type: 'detect' });
  const sel = $('accountDir');
  sel.innerHTML = '<option value="">(선택 안 함)</option>';
  for (const a of det.accounts || []) {
    const o = document.createElement('option');
    o.value = a.dir;
    o.textContent = `u/${a.id} · 채팅 폴더 ${a.sessionFolders}개 · 최근 사용 ${new Date(a.lastActive).toLocaleString()}`;
    sel.appendChild(o);
  }
  sel.value = c.accountDir || '';
}

async function save() {
  const include = {};
  for (const el of document.querySelectorAll('[data-inc]')) include[el.dataset.inc] = el.checked;
  const config = {
    gitRemote: $('gitRemote').value.trim(),
    deviceName: $('deviceName').value.trim() || undefined,
    accountDir: $('accountDir').value || undefined, // keep the pinned account unless one is chosen
    autoSyncMinutes: Number($('autoSyncMinutes').value) || 0,
    maxFileMB: Number($('maxFileMB').value) || 100,
    include,
  };
  const r = await host({ type: 'setConfig', config });
  if (r?.type === 'error') throw new Error(r.error);
  if (r.scheduler) showSched(r.scheduler, r.config.autoSyncMinutes);
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

let connecting = false;
$('connect').onclick = async () => {
  const out = $('connectMsg');
  connecting = true; $('connect').disabled = true;
  out.className = 'muted'; out.textContent = '연결 중...';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'connectGit', url: $('gitRemote').value.trim(), accountDir: $('accountDir').value || undefined });
    if (!r || r.type === 'error') throw Object.assign(new Error(r?.error || '연결 실패'), { code: r?.code });
    $('authBox').hidden = true;
    const res = r.result; const acc = (r.accounts || []).find((a) => a.dir === r.config.accountDir);
    const lines = [`✔ 연결됨: ${r.config.gitRemote}`];
    if (acc) lines.push(`Aside 계정: u/${acc.id} (채팅 ${acc.sessionFolders}개)${r.autoPicked ? '. 계정이 여러 개라 지금 쓰고 있는 계정으로 고정했습니다. 다르면 아래 "Aside 계정"에서 바꾸고 다시 연결하세요.' : ''}`);
    lines.push(r.scheduler?.installed ? `자동 동기화: ${r.config.autoSyncMinutes}분마다` : `자동 동기화: ${r.scheduler?.pendingLogin ? '다음 로그인부터' : '등록 실패, 팝업의 다시 등록 버튼'}`);
    lines.push(`첫 동기화: 채팅 ↑${res.sessions.uploaded} ↓${res.sessions.downloaded}, 파일 ↑${res.files.uploaded} ↓${res.files.downloaded}`);
    if (res.sessions.downloaded) lines.push('받아온 채팅은 Aside를 재시작하면 목록에 보입니다.');
    if (res.errors?.length) lines.push('오류: ' + res.errors.join('\n'));
    out.className = res.ok ? 'ok' : 'err'; out.textContent = lines.join('\n');
    await load();
  } catch (e) {
    out.className = 'err'; out.textContent = e.message;
    if (e.code === 'GIT_AUTH') showAuthBox();
  }
  finally { connecting = false; $('connect').disabled = false; }
};

// ---- token login
function repoParts() {
  const m = $('gitRemote').value.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}
function showAuthBox() {
  const p = repoParts();
  $('repoName').textContent = p ? `${p.owner}/${p.repo}` : '저장소';
  $('authBox').hidden = false;
  $('gitToken').focus();
}
$('showAuth').onclick = (e) => { e.preventDefault(); showAuthBox(); };
$('makeToken').onclick = (e) => {
  e.preventDefault();
  const p = repoParts();
  if (!p) { $('authMsg').className = 'err'; $('authMsg').textContent = '먼저 위에 GitHub 저장소 주소를 넣으세요.'; return; }
  const dev = ($('deviceName').value || 'PC').slice(0, 24);
  const q = new URLSearchParams({ name: `aside-sync ${dev}`.slice(0, 40), description: `Aside Sync: ${p.owner}/${p.repo} 동기화 전용 (Contents read/write)`, target_name: p.owner, expires_in: '366', contents: 'write' });
  chrome.tabs.create({ url: `https://github.com/settings/personal-access-tokens/new?${q}` });
};
$('saveToken').onclick = async () => {
  const msg = $('authMsg'); msg.className = 'muted'; msg.textContent = '토큰 확인 중...';
  $('saveToken').disabled = true;
  try {
    const r = await host({ type: 'setGitToken', url: $('gitRemote').value.trim(), token: $('gitToken').value, allowFile: $('allowFile').checked });
    if (!r || r.type === 'error') throw Object.assign(new Error(r?.error || '실패'), { code: r?.code });
    $('gitToken').value = '';
    msg.className = 'ok'; msg.textContent = `✔ 토큰 저장됨 (${r.stored}). 연결을 계속합니다...`;
    $('connect').click();
  } catch (e) {
    msg.className = 'err'; msg.textContent = e.message;
    if (e.code === 'CRED_STORE') $('allowFileRow').hidden = false;
  } finally { $('saveToken').disabled = false; }
};
$('clearAuth').onclick = async (e) => {
  e.preventDefault();
  const r = await host({ type: 'clearGitToken' });
  $('connectMsg').className = 'muted'; $('connectMsg').textContent = r?.cleared ? '저장된 토큰을 삭제했습니다.' : '저장된 토큰이 없습니다.';
  load();
};
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'connect-progress' && connecting) $('connectMsg').textContent = m.message; });

load();
