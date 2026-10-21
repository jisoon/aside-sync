const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
const TRIGGER = { manual: '수동', scheduler: '자동', cli: '명령어' };
let busy = false;

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
  $('fDown').textContent = r.files.downloaded;
  $('last').textContent = `${ago(r.finishedAt)} · ${TRIGGER[r.trigger] || r.trigger || '-'}`;
  const notes = [];
  if (r.sessions.skippedRunning) notes.push(`실행 중인 채팅 ${r.sessions.skippedRunning}개는 다음에 동기화`);
  if (r.sessions.pending) notes.push(`업로드 대기 ${r.sessions.pending}개`);
  if (r.sessions.conflicts || r.files.conflicts) notes.push(`충돌 ${r.sessions.conflicts + r.files.conflicts}건 (최신 쪽 유지)`);
  if (r.sessions.downloaded) notes.push('새 채팅이 목록에 안 보이면 Aside를 재시작하세요');
  if (r.files.merged) notes.push(`양쪽에서 고친 파일 ${r.files.merged}개를 줄 단위로 합침`);
  if (r.files.deleted) notes.push(`다른 PC에서 지운 파일 ${r.files.deleted}개 삭제 (백업: ~/.aside-sync/conflicts)`);
  for (const n of r.notes || []) notes.push(n);
  $('notes').textContent = notes.join(' · ');
}

function showBlocked(r) {
  const files = r?.blockedDeletes || [];
  $('blocked').hidden = !files.length || busy;
  if (!files.length) return;
  $('blockedText').textContent = `다른 PC에서 파일 ${files.length}개가 지워진 것으로 보여 삭제하지 않았습니다. 폴더 이동(정리)일 수도 있으니 목록을 확인하고 선택하세요.`;
  $('blockedList').textContent = files.join('\n');
  $('blockedList').style.whiteSpace = 'pre-wrap';
}

function setState(kind, text) {
  $('dot').className = `dot ${kind}`;
  $('state').textContent = text;
}

async function refresh() {
  const st = await send({ type: 'host', payload: { type: 'status' } });
  if (st?.type === 'error') {
    setState('bad', '연결 안 됨');
    $('msg').className = 'err'; $('msg').textContent = st.error; $('sync').disabled = true;
    if (st.code === 'NO_HOST') { $('msg').textContent += ' (눌러서 설정 열기)'; $('msg').style.cursor = 'pointer'; $('msg').onclick = () => chrome.runtime.openOptionsPage(); }
    return;
  }
  const c = st.config;
  $('device').textContent = c.deviceName;
  const target = c.gitRemote ? c.gitRemote.replace(/^https?:\/\/(www\.)?/, '').replace(/\.git$/, '') : '';
  $('dir').textContent = target || '미설정';
  $('dir').title = c.gitRemote || '';

  const sc = st.scheduler || {};
  if (!c.autoSyncMinutes) $('sched').textContent = '꺼짐';
  else if (sc.installed) $('sched').innerHTML = `<span class="ok">${c.autoSyncMinutes}분마다</span>`;
  else if (sc.pendingLogin) $('sched').textContent = `${c.autoSyncMinutes}분마다 (다음 로그인부터)`;
  else $('sched').innerHTML = '<span class="err">등록 안 됨</span>';
  $('sched').title = sc.kind ? `${sc.kind}${sc.error ? ': ' + sc.error : ''}` : '';
  $('fixSched').hidden = !!sc.ok || !c.autoSyncMinutes;

  const r = st.lastResult;
  if (st.accountError) { setState('bad', '설정 필요'); if (!busy) { $('msg').className = 'err'; $('msg').textContent = st.accountError + '\n→ 설정에서 Aside 계정을 고르세요.'; } $('sync').disabled = true; return; }
  if (!c.gitRemote) setState('bad', '동기화 대상 미설정 (설정에서 GitHub 주소 입력)');
  else if (st.running || busy) setState('run', '동기화 중...');
  else if (r && !r.ok) setState('bad', '오류');
  else if (r) setState('ok', '정상');
  else setState('', '아직 동기화 안 함');
  if (r?.errors?.length && !busy) { $('msg').className = 'err'; $('msg').textContent = r.errors.slice(0, 3).join('\n'); }
  showResult(r);
  showBlocked(r);
  $('sync').disabled = !c.gitRemote || busy || st.running;
  $('sync').textContent = busy || st.running ? '동기화 중...' : '지금 동기화';

  $('devices').innerHTML = '';
  for (const d of (st.devices || []).sort((a, b) => b.lastSyncAt - a.lastSyncAt)) {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = '<span></span><span class="muted"></span>';
    el.children[0].textContent = d.deviceName + (d.deviceId === c.deviceId ? ' (이 PC)' : '');
    el.children[1].textContent = ago(d.lastSyncAt);
    $('devices').appendChild(el);
  }
  if (!st.devices?.length) $('devices').textContent = '아직 없음';
}

async function runSync(massDelete) {
  busy = true;
  $('blocked').hidden = true;
  $('msg').className = 'muted'; $('msg').textContent = '시작...';
  $('sync').disabled = true; $('sync').textContent = '동기화 중...';
  setState('run', '동기화 중...');
  const r = await send({ type: 'sync', massDelete });
  busy = false;
  if (r?.ok) { $('msg').className = r.result.ok ? 'ok' : 'err'; $('msg').textContent = r.result.ok ? '동기화 완료' : r.result.errors.join('\n'); }
  else { $('msg').className = 'err'; $('msg').textContent = r?.error || '실패'; }
  refresh();
}
$('sync').onclick = () => runSync();
$('allowDel').onclick = () => runSync('allow');
$('keepLocal').onclick = () => runSync('keepLocal');
$('fixSched').onclick = async () => {
  const r = await send({ type: 'host', payload: { type: 'schedule' } });
  $('msg').className = r?.type === 'error' ? 'err' : 'muted';
  $('msg').textContent = r?.type === 'error' ? r.error : '자동 동기화를 다시 등록했습니다.';
  refresh();
};
$('opts').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };

chrome.runtime.onMessage.addListener((m) => {
  if (m.type === 'sync-progress') { $('msg').className = 'muted'; $('msg').textContent = m.message; }
});

async function checkUpd() {
  try {
    const r = await send({ type: 'checkUpdate' });
    if (r?.newer) { $('upd').hidden = false; $('updText').textContent = `새 버전 v${r.latest} (현재 v${r.current})`; }
  } catch {}
}
$('updBtn').onclick = async () => {
  $('updBtn').disabled = true; $('updText').textContent = '업데이트 중...';
  const r = await send({ type: 'update' });
  if (!r || r.type === 'error') { $('updText').className = 'err'; $('updText').textContent = r?.error || '업데이트 실패'; $('updBtn').disabled = false; return; }
  $('updText').className = 'ok'; $('updText').textContent = `v${r.to}로 업데이트했습니다. 확장을 다시 불러옵니다...`;
};
chrome.runtime.onMessage.addListener((m) => { if (m.type === 'update-progress') $('updText').textContent = m.message; });

refresh();
checkUpd();
setInterval(() => { if (!busy) refresh(); }, 3000); // background (scheduler) syncs show up live
