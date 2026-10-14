// Aside Sync - background service worker
const HOST = 'com.aside.sync';
const ALARM = 'aside-sync-auto';
let syncing = null;

// One request over a native port; streams progress, resolves on final message.
function callHost(msg, onProgress) {
  return new Promise((resolve, reject) => {
    let port;
    try { port = chrome.runtime.connectNative(HOST); } catch (e) { reject(e); return; }
    const requestId = crypto.randomUUID();
    let done = false;
    port.onMessage.addListener((m) => {
      if (m.type === 'progress') { onProgress?.(m.message); return; }
      done = true;
      port.disconnect();
      if (m.type === 'error') reject(new Error(m.error)); else resolve(m);
    });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const err = chrome.runtime.lastError?.message || '네이티브 호스트 연결이 끊겼습니다.';
      reject(new Error(err.includes('not found') ? '네이티브 호스트가 설치되지 않았습니다. install 스크립트를 먼저 실행하세요.' : err));
    });
    port.postMessage({ ...msg, requestId });
  });
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

async function runSync(trigger = 'manual') {
  if (syncing) return syncing;
  syncing = (async () => {
    setBadge('…', '#6366f1');
    broadcast({ type: 'sync-state', running: true });
    try {
      const { result } = await callHost({ type: 'sync' }, (message) => broadcast({ type: 'sync-progress', message }));
      await chrome.storage.local.set({ lastResult: result, lastError: null, lastTrigger: trigger });
      const s = result.sessions; const f = result.files;
      const changed = s.uploaded + s.downloaded + f.uploaded + f.downloaded + f.deleted;
      if (!result.ok) setBadge('!', '#dc2626');
      else setBadge(s.downloaded ? String(s.downloaded) : '', '#16a34a');
      if (s.downloaded > 0 && trigger !== 'manual') {
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/128.png', title: 'Aside Sync',
          message: `다른 PC에서 채팅 ${s.downloaded}개를 가져왔습니다. 목록에 안 보이면 Aside를 재시작하세요.`,
        });
      }
      broadcast({ type: 'sync-done', result, changed });
      return { ok: true, result };
    } catch (e) {
      await chrome.storage.local.set({ lastError: { message: e.message, at: Date.now() } });
      setBadge('!', '#dc2626');
      broadcast({ type: 'sync-error', error: e.message });
      return { ok: false, error: e.message };
    } finally {
      syncing = null;
      broadcast({ type: 'sync-state', running: false });
    }
  })();
  return syncing;
}

async function scheduleAlarm() {
  try {
    const st = await callHost({ type: 'status' });
    const minutes = Number(st.config.autoSyncMinutes) || 0;
    await chrome.alarms.clear(ALARM);
    if (minutes > 0) chrome.alarms.create(ALARM, { periodInMinutes: Math.max(1, minutes), delayInMinutes: 1 });
    return st;
  } catch (e) {
    await chrome.storage.local.set({ lastError: { message: e.message, at: Date.now() } });
    return null;
  }
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) runSync('auto'); });

chrome.runtime.onStartup.addListener(async () => {
  const st = await scheduleAlarm();
  if (st?.config?.syncOnStartup && st.config.syncDir) runSync('startup');
});

chrome.runtime.onInstalled.addListener(async (d) => {
  await scheduleAlarm();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'sync': return runSync('manual');
      case 'isSyncing': return { running: !!syncing };
      case 'host': return callHost(msg.payload);
      case 'reschedule': return scheduleAlarm();
      default: return null;
    }
  })().then(sendResponse, (e) => sendResponse({ type: 'error', error: e.message }));
  return true;
});
