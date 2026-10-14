const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function ago(ts) {
  if (!ts) return '-';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '방금 전';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return new Date(ts).toLocaleString();
}

function showResult(r) {
  if (!r) return;
  $('sUp').textContent = r.sessions.uploaded;
  $('sDown').textContent = r.sessions.downloaded;
  $('fUp').textContent = r.files.uploaded;
  $('fDown').textContent = r.files.downloaded + r.files.deleted;
  $('last').textContent = ago(r.finishedAt);
  const notes = [];
  if (r.sessions.skippedRunning) notes.push(`실행 중인 채팅 ${r.sessions.skippedRunning}개는 다음에 동기화`);
  if (r.sessions.pending) notes.push(`클라우드 업로드 대기 ${r.sessions.pending}개`);
  if (r.sessions.conflicts || r.files.conflicts) notes.push(`충돌 ${r.sessions.conflicts + r.files.conflicts}건 (최신 쪽 유지)`);
  if (r.sessions.downloaded) notes.push('새 채팅이 목록에 안 보이면 Aside를 재시작하세요');
  $('notes').textContent = notes.join(' · ');
  if (r.errors?.length) { $('msg').className = 'err'; $('msg').textContent = r.errors.slice(0, 3).join('\n'); }
}

async function refresh() {
  const st = await send({ type: 'host', payload: { type: 'status' } });
  if (st?.type === 'error') {
    $('msg').className = 'err'; $('msg').textContent = st.error; $('sync').disabled = true; return;
  }
  $('device').textContent = st.config.deviceName;
  $('dir').textContent = st.config.syncDir || '미설정';
  $('dir').title = st.config.syncDir;
  if (!st.config.syncDir) { $('msg').className = 'err'; $('msg').textContent = '설정에서 동기화 폴더를 먼저 지정하세요.'; $('sync').disabled = true; }
  showResult(st.lastResult);
  $('devices').innerHTML = '';
  for (const d of (st.devices || []).sort((a, b) => b.lastSyncAt - a.lastSyncAt)) {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `<span></span><span class="muted"></span>`;
    el.children[0].textContent = d.deviceName + (d.deviceId === st.config.deviceId ? ' (이 PC)' : '');
    el.children[1].textContent = ago(d.lastSyncAt);
    $('devices').appendChild(el);
  }
  if (!st.devices?.length) $('devices').textContent = '아직 없음';
  const { running } = await send({ type: 'isSyncing' });
  setRunning(running);
}

function setRunning(on) {
  $('sync').disabled = on;
  $('sync').textContent = on ? '동기화 중...' : '지금 동기화';
}

$('sync').onclick = async () => {
  $('msg').className = 'muted'; $('msg').textContent = '시작...';
  setRunning(true);
  const r = await send({ type: 'sync' });
  setRunning(false);
  if (r?.ok) { $('msg').className = 'ok'; $('msg').textContent = r.result.ok ? '동기화 완료' : '일부 오류와 함께 완료'; refresh(); }
  else { $('msg').className = 'err'; $('msg').textContent = r?.error || '실패'; }
};
$('opts').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'sync-progress') { $('msg').className = 'muted'; $('msg').textContent = m.message; }
  if (m.type === 'sync-state') setRunning(m.running);
});

refresh();
