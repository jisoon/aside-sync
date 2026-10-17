// Aside Sync - background service worker
// Automatic syncing is done by the OS scheduler (launchd / Task Scheduler / cron),
// so it keeps working even when Chrome is closed. This worker only:
//  - runs manual syncs, - polls status to update the badge / notify about new chats.
const HOST = 'com.aside.sync';
const POLL_ALARM = 'aside-sync-status';
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
      if (m.type === 'error') reject(Object.assign(new Error(m.error), { code: m.code })); else resolve(m);
    });
    port.onDisconnect.addListener(() => {
      if (done) return;
      const err = chrome.runtime.lastError?.message || '네이티브 호스트 연결이 끊겼습니다.';
      reject(new Error(err.includes('not found') ? '네이티브 호스트가 설치되지 않았습니다. 설치 명령을 먼저 실행하세요.' : err));
    });
    port.postMessage({ ...msg, requestId });
  });
}

function broadcast(msg) { chrome.runtime.sendMessage(msg).catch(() => {}); }

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

// Reflect the latest result (from any trigger) in the badge, notify on new chats.
async function applyStatus(st) {
  const r = st?.lastResult;
  const { seenFinishedAt = 0 } = await chrome.storage.local.get('seenFinishedAt');
  if (st?.running) setBadge('…', '#6366f1');
  else if (!r) setBadge('', null);
  else if (!r.ok || (st.scheduler && !st.scheduler.ok && !st.scheduler.pendingLogin)) setBadge('!', '#dc2626');
  else setBadge('', null);
  if (r && r.finishedAt > seenFinishedAt) {
    await chrome.storage.local.set({ seenFinishedAt: r.finishedAt });
    if (seenFinishedAt && r.trigger !== 'manual' && r.sessions?.downloaded > 0) {
      chrome.notifications.create({
        type: 'basic', iconUrl: 'icons/128.png', title: 'Aside Sync',
        message: `다른 PC에서 채팅 ${r.sessions.downloaded}개를 가져왔습니다. 목록에 안 보이면 Aside를 재시작하세요.`,
      });
    }
  }
}

async function pollStatus() {
  try {
    const st = await callHost({ type: 'status' });
    await applyStatus(st);
    return st;
  } catch (e) {
    setBadge('!', '#dc2626');
    return null;
  }
}

async function runSync(massDelete) {
  if (syncing) return syncing;
  syncing = (async () => {
    setBadge('…', '#6366f1');
    broadcast({ type: 'sync-state', running: true });
    try {
      const { result } = await callHost({ type: 'sync', massDelete }, (message) => broadcast({ type: 'sync-progress', message }));
      broadcast({ type: 'sync-done', result });
      return { ok: true, result };
    } catch (e) {
      broadcast({ type: 'sync-error', error: e.message });
      return { ok: false, error: e.message };
    } finally {
      syncing = null;
      broadcast({ type: 'sync-state', running: false });
      pollStatus();
    }
  })();
  return syncing;
}

function ensurePollAlarm() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 2, delayInMinutes: 0.1 });
}

chrome.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) pollStatus(); });
chrome.runtime.onStartup.addListener(ensurePollAlarm);
chrome.runtime.onInstalled.addListener(async (d) => {
  await chrome.alarms.clear('aside-sync-auto'); // v1.0 alarm (auto sync moved to OS scheduler)
  ensurePollAlarm();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'sync': return runSync(msg.massDelete);
      case 'isSyncing': return { running: !!syncing };
      case 'connectGit': {
        const r = await callHost({ type: 'connectGit', url: msg.url, accountDir: msg.accountDir }, (message) => broadcast({ type: 'connect-progress', message }));
        pollStatus();
        return r;
      }
      case 'checkUpdate': {
        const { updateInfo } = await chrome.storage.local.get('updateInfo');
        if (!msg.force && updateInfo && Date.now() - updateInfo.at < 6 * 3600 * 1000) return updateInfo;
        const r = await callHost({ type: 'checkUpdate' });
        const info = { ...r, at: Date.now() };
        await chrome.storage.local.set({ updateInfo: info });
        return info;
      }
      case 'update': {
        const r = await callHost({ type: 'update' }, (message) => broadcast({ type: 'update-progress', message }));
        await chrome.storage.local.remove('updateInfo');
        setTimeout(() => chrome.runtime.reload(), 1500); // load the new extension files from disk
        return r;
      }
      case 'host': {
        const r = await callHost(msg.payload);
        if (msg.payload?.type === 'status') applyStatus(r);
        return r;
      }
      default: return null;
    }
  })().then(sendResponse, (e) => sendResponse({ type: 'error', error: e.message, code: e.code }));
  return true;
});
