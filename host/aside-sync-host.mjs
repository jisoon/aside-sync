#!/usr/bin/env node
// Aside Sync - native messaging host + CLI
// Syncs Aside chat history (sessions), projects, memory, user skills, persona and
// (optionally) settings between PCs through a shared cloud folder
// (Google Drive / iCloud / Dropbox / OneDrive / NAS ...).
//
// Usage (CLI):
//   node aside-sync-host.mjs sync            run one sync
//   node aside-sync-host.mjs status          print config + last result
//   node aside-sync-host.mjs detect          list Aside accounts + cloud folders
//   node aside-sync-host.mjs config key=value [key=value ...]
// When Chrome launches it (argv contains chrome-extension://...), it speaks the
// native messaging protocol on stdin/stdout.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.3.0';
const CODE_REPO = process.env.ASIDE_SYNC_REPO || 'jisoon/aside-sync';
const CODE_BRANCH = process.env.ASIDE_SYNC_BRANCH || 'main';
const HOST_FILE = fileURLToPath(import.meta.url);
const SCHED_LABEL = process.env.ASIDE_SYNC_LABEL || 'com.aside.sync';
const WIN_TASK = process.env.ASIDE_SYNC_LABEL || 'AsideSync';
const SYNC_HOME = process.env.ASIDE_SYNC_HOME || path.join(os.homedir(), '.aside-sync');
const CONFIG_FILE = path.join(SYNC_HOME, 'config.json');
const STATE_FILE = path.join(SYNC_HOME, 'state.json');
const LOG_FILE = path.join(SYNC_HOME, 'sync.log');
const LOCK_FILE = path.join(SYNC_HOME, 'sync.lock');
const TOKEN = '{{ASIDE_ACCOUNT_ROOT}}';
const STORE_NAME = 'aside-sync-store';
const SCHEMA = 1;

// settings.json keys that are device specific or contain secrets -> never synced
const SETTINGS_EXCLUDE = ['routineDeviceId', 'externalPasswordManagers', 'cli', 'mcp', 'customModels', 'analytics'];
const FILE_EXCLUDE = [/^memory\/memory-index-local\.json$/, /^memory\/\.dream-state\.json$/, /^memory\/\.local-memory\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/, /\.aside-sync-tmp$/];
// columns that only make sense on the machine that owns the browser
const ROW_FP_IGNORE = ['active_tab_target_id', 'browser_binding'];

// ---------------------------------------------------------------- utils
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toPosix = (p) => p.split(path.sep).join('/');
const now = () => Date.now();

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Cloud provider mount root for paths under ~/Library/CloudStorage/<Provider>/...
function cloudMountRoot(dir) {
  const cs = path.join(os.homedir(), 'Library', 'CloudStorage');
  const rel = path.relative(cs, path.resolve(dir));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return path.join(cs, rel.split(path.sep)[0]);
}
// The sync folder must already exist (it lives in a cloud drive). Creating it during a sync while the
// cloud client is signed out / paused produces a plain local folder that is not linked to the cloud;
// when the client reconnects it is uploaded as a second folder ("AsideSync 2") and the PCs drift apart.
// So: create only when the user explicitly sets the folder (create=true), never from a sync run.
function checkSyncDir(dir, { create = false } = {}) {
  const abs = path.resolve(dir);
  if (fs.existsSync(abs)) return abs;
  const mount = cloudMountRoot(abs);
  if (mount && !fs.existsSync(mount)) throw new Error(`클라우드 드라이브가 연결되어 있지 않습니다 (${path.basename(mount)}). 클라우드 앱 로그인 상태를 확인하세요.`);
  if (!create) throw new Error(`동기화 폴더를 찾을 수 없습니다: ${abs}. 클라우드 앱(Google Drive 등)이 로그아웃/일시중지됐거나 폴더가 이동·삭제됐을 수 있습니다. 클라우드와 연결 안 된 폴더가 생기는 것을 막기 위해 자동으로 만들지 않습니다. 확장 옵션에서 폴더를 다시 지정하세요.`);
  if (!fs.existsSync(path.dirname(abs))) throw new Error(`상위 폴더가 없습니다: ${path.dirname(abs)}`);
  ensureDir(abs);
  return abs;
}

function log(...args) {
  try {
    ensureDir(SYNC_HOME);
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
    try { if (fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch {}
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, obj) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.aside-sync-tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

function copyAtomic(src, dest) {
  ensureDir(path.dirname(dest));
  const tmp = `${dest}.${process.pid}.aside-sync-tmp`;
  fs.copyFileSync(src, tmp);
  fs.renameSync(tmp, dest);
}

function sha256Buf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }

function hashFileSync(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function walkFiles(root, base = root, out = []) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(full, base, out);
    else if (e.isFile()) out.push(toPosix(path.relative(base, full)));
  }
  return out;
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ---------------------------------------------------------------- config & state
function defaultConfig() {
  return {
    deviceId: crypto.randomUUID(),
    deviceName: os.hostname(),
    asideRoot: path.join(os.homedir(), '.aside'),
    accountDir: '', // auto-detect when empty
    syncDir: '', // cloud folder, e.g. ~/Library/CloudStorage/GoogleDrive-.../My Drive/AsideSync
    gitRemote: '', // git mode: private repo URL, e.g. https://github.com/me/aside-sync-data.git (takes precedence over syncDir)
    autoSyncMinutes: 15,
    maxFileMB: 100,
    include: {
      sessions: true, // chat history (messages.jsonl + DB rows)
      artifacts: true, // session artifacts/ and attachments/
      projects: true,
      memory: true,
      userSkills: true,
      persona: true, // AGENTS.md, SOUL.md
      settings: false, // settings.json (secrets/device keys excluded)
    },
  };
}

function loadConfig() {
  ensureDir(SYNC_HOME);
  const saved = readJson(CONFIG_FILE, {});
  const def = defaultConfig();
  const cfg = { ...def, ...saved, include: { ...def.include, ...(saved.include || {}) } };
  if (!saved.deviceId) writeJsonAtomic(CONFIG_FILE, cfg);
  return cfg;
}

function saveConfig(patch) {
  if (patch.syncDir) checkSyncDir(patch.syncDir, { create: true });
  if (patch.gitRemote) { patch.gitRemote = normalizeGitUrl(patch.gitRemote); checkGitRemote(patch.gitRemote); }
  const cfg = loadConfig();
  const next = { ...cfg, ...patch, include: { ...cfg.include, ...(patch.include || {}) } };
  next.deviceId = cfg.deviceId; // immutable
  writeJsonAtomic(CONFIG_FILE, next);
  return next;
}

function loadState() {
  return { sessions: {}, files: {}, settings: null, hashCache: {}, lastResult: null, ...readJson(STATE_FILE, {}) };
}
function saveState(st) { writeJsonAtomic(STATE_FILE, st); }

function cachedHash(st, file) {
  const s = fs.statSync(file);
  const c = st.hashCache[file];
  if (c && c.size === s.size && c.mtimeMs === s.mtimeMs) return { hash: c.hash, size: s.size, mtimeMs: s.mtimeMs };
  const hash = hashFileSync(file);
  st.hashCache[file] = { size: s.size, mtimeMs: s.mtimeMs, hash };
  return { hash, size: s.size, mtimeMs: s.mtimeMs };
}

function listAccounts(asideRoot) {
  const uDir = path.join(asideRoot, 'u');
  let ids = [];
  try { ids = fs.readdirSync(uDir); } catch {}
  return ids
    .map((id) => {
      const dir = path.join(uDir, id);
      const db = path.join(dir, 'state.db');
      if (!fs.existsSync(db)) return null;
      let mtime = 0;
      for (const f of ['state.db', 'state.db-wal']) { try { mtime = Math.max(mtime, fs.statSync(path.join(dir, f)).mtimeMs); } catch {} }
      let sessions = 0;
      try { sessions = fs.readdirSync(path.join(dir, 'sessions')).length; } catch {}
      return { id, dir, lastActive: mtime, sessionFolders: sessions };
    })
    .filter(Boolean)
    .sort((a, b) => b.lastActive - a.lastActive);
}

// Which Aside account (~/.aside/u/<id>) to sync. Never guess between several accounts: picking "the most
// recently used" flips when the user switches accounts, and the 3-way base of one account applied to another
// makes every file of the first look deleted (tombstones that then spread to all PCs).
function resolveAccountDir(cfg, st = null) {
  if (cfg.accountDir) {
    if (!fs.existsSync(path.join(cfg.accountDir, 'state.db'))) throw new Error(`지정한 Aside 계정 폴더가 없습니다: ${cfg.accountDir}`);
    return cfg.accountDir;
  }
  const accs = listAccounts(cfg.asideRoot);
  if (!accs.length) throw new Error(`Aside 계정 폴더를 찾지 못했습니다: ${path.join(cfg.asideRoot, 'u')}`);
  if (accs.length === 1) return accs[0].dir;
  if (st?.accountDir && accs.some((a) => a.dir === st.accountDir)) return st.accountDir;
  throw new Error(`Aside 계정 폴더가 여러 개입니다 (${accs.map((a) => `u/${a.id}: 채팅 ${a.sessionFolders}개`).join(', ')}). 동기화할 계정을 지정하세요: aside-sync-host.mjs config accountDir='"${accs[0].dir}"'`);
}

function detectCloudFolders() {
  const home = os.homedir();
  const cands = [];
  const add = (p, label) => { try { if (fs.statSync(p).isDirectory()) cands.push({ label, path: path.join(p, 'AsideSync') }); } catch {} };
  const cs = path.join(home, 'Library', 'CloudStorage');
  try {
    for (const d of fs.readdirSync(cs)) {
      const base = path.join(cs, d);
      if (d.startsWith('GoogleDrive')) {
        for (const sub of ['My Drive', '내 드라이브']) add(path.join(base, sub), `Google Drive (${d.replace('GoogleDrive-', '')})`);
      } else add(base, d);
    }
  } catch {}
  add(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'iCloud Drive');
  add(path.join(home, 'Dropbox'), 'Dropbox');
  try { for (const d of fs.readdirSync(home)) if (d.startsWith('OneDrive')) add(path.join(home, d), d); } catch {}
  add(path.join(home, 'Google Drive', 'My Drive'), 'Google Drive');
  add(path.join(home, 'iCloudDrive'), 'iCloud Drive');
  if (process.platform === 'win32') {
    for (const letter of 'DEFGHIJ') {
      add(`${letter}:\\My Drive`, `Google Drive (${letter}:)`);
      add(`${letter}:\\내 드라이브`, `Google Drive (${letter}:)`);
    }
  }
  return cands;
}

// ---------------------------------------------------------------- path tokenization
function makePathCodec(localRoot) {
  const rawRoot = localRoot.replace(/[\\/]+$/, '');
  const jsonRoot = JSON.stringify(rawRoot).slice(1, -1); // backslashes escaped (Windows)
  const tokenize = (v) => {
    if (typeof v !== 'string') return v;
    let s = v;
    if (jsonRoot !== rawRoot) s = s.replace(new RegExp(escapeRe(jsonRoot), 'g'), TOKEN);
    return s.replace(new RegExp(escapeRe(rawRoot), 'g'), TOKEN);
  };
  const detokenize = (v) => {
    if (typeof v !== 'string' || !v.includes(TOKEN)) return v;
    let isJson = false;
    if (/^\s*[[{"]/.test(v)) { try { JSON.parse(v); isJson = true; } catch {} }
    return v.split(TOKEN).join(isJson ? jsonRoot : rawRoot);
  };
  const mapRow = (row, fn) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, fn(v)]));
  return { tokenize, detokenize, tokenizeRow: (r) => mapRow(r, tokenize), detokenizeRow: (r) => mapRow(r, detokenize) };
}

// ---------------------------------------------------------------- store
class Store {
  constructor(syncDir) {
    this.root = path.join(syncDir, STORE_NAME);
  }
  init() {
    ensureDir(this.root);
    const meta = path.join(this.root, 'store.json');
    if (!fs.existsSync(meta)) writeJsonAtomic(meta, { schema: SCHEMA, createdAt: now(), app: 'aside-sync' });
    const m = readJson(meta, {});
    if (m.schema && m.schema > SCHEMA) throw new Error('동기화 폴더가 더 최신 버전의 Aside Sync로 만들어졌습니다. 이 PC의 Aside Sync를 업데이트하세요.');
  }
  p(...parts) { return path.join(this.root, ...parts); }
  // Cloud drives (esp. Google Drive) allow several folders with the same name. When two PCs
  // create e.g. "blobs/a6" before seeing each other's, the drive client shows "a6 2", "a6 3"...
  // Every read therefore treats "<name>" and "<name> N" as one logical folder.
  resolveDirs(...parts) {
    let dirs = [this.root];
    for (const part of parts) {
      const re = new RegExp('^' + escapeRe(part) + '( \\d+)?$');
      const next = [];
      for (const d of dirs) {
        let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) if (e.isDirectory() && re.test(e.name)) next.push(path.join(d, e.name));
      }
      dirs = next;
    }
    return dirs;
  }
  blobPath(hash) { return this.p('blobs', hash.slice(0, 2), hash); }
  findBlob(hash, size) {
    for (const d of this.resolveDirs('blobs', hash.slice(0, 2))) {
      const p = path.join(d, hash);
      try { const st = fs.statSync(p); if (st.isFile() && (size == null || st.size === size)) return p; } catch {}
    }
    return null;
  }
  hasBlob(hash, size) { return !!this.findBlob(hash, size); }
  putBlob(hash, size, src) {
    if (this.hasBlob(hash, size)) return false;
    copyAtomic(src, this.blobPath(hash));
    return true;
  }
  getBlob(hash, dest) {
    const src = this.findBlob(hash) || this.blobPath(hash);
    const tmp = `${dest}.${process.pid}.aside-sync-tmp`;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, tmp);
    if (hashFileSync(tmp) !== hash) { fs.rmSync(tmp, { force: true }); throw new Error(`blob hash mismatch ${hash}`); }
    fs.renameSync(tmp, dest);
  }
  // entry names across duplicate folders; duplicate sub-folder suffixes (" 2") are folded
  listDir(...parts) {
    const out = new Set();
    for (const d of this.resolveDirs(...parts)) {
      let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) out.add(e.isDirectory() ? e.name.replace(/ \d+$/, '') : e.name);
    }
    return [...out];
  }
  // per-device json files: dir/<deviceId>.json (read from every duplicate folder)
  readDeviceFiles(...parts) {
    const out = [];
    for (const d of this.resolveDirs(...parts)) {
      let names; try { names = fs.readdirSync(d); } catch { continue; }
      for (const n of names) if (n.endsWith('.json')) { const j = readJson(path.join(d, n)); if (j) out.push(j); }
    }
    return out;
  }
}

// ---------------------------------------------------------------- DB helpers
function openDb(accountDir) {
  const db = new DatabaseSync(path.join(accountDir, 'state.db'));
  db.exec('PRAGMA busy_timeout = 15000;');
  return db;
}
function tableCols(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}
function tableExists(db, table) {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}
function upsert(db, table, row, cols, pk = 'id') {
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  const q = (k) => `"${k}"`;
  const sql = `INSERT INTO ${table} (${keys.map(q).join(',')}) VALUES (${keys.map(() => '?').join(',')})
    ON CONFLICT(${q(pk)}) DO UPDATE SET ${keys.filter((k) => k !== pk).map((k) => `${q(k)}=excluded.${q(k)}`).join(',')}`;
  db.prepare(sql).run(...keys.map((k) => row[k]));
}
function insertRow(db, table, row, cols) {
  const keys = Object.keys(row).filter((k) => cols.includes(k));
  const r = db.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k]));
  return Number(r.lastInsertRowid);
}

// ---------------------------------------------------------------- sync engine
class SyncRun {
  constructor(cfg, onProgress) {
    this.cfg = cfg;
    this.onProgress = onProgress || (() => {});
    this.state = loadState();
    this.accountDir = resolveAccountDir(cfg, this.state);
    this.sessionsDir = path.join(this.accountDir, 'sessions');
    this.codec = makePathCodec(this.accountDir);
    this.store = new Store(cfg.syncDir);
    this.res = {
      startedAt: now(), finishedAt: null, ok: false, device: cfg.deviceName, trigger: 'manual',
      sessions: { uploaded: 0, downloaded: 0, skippedRunning: 0, pending: 0, conflicts: 0 },
      projects: { downloaded: 0 }, files: { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0 },
      settings: null, blobsRemoved: 0, errors: [], notes: [],
    };
  }

  // Stall detection without cloud APIs: every device publishes which lastSyncAt of each peer it has seen.
  // If an active peer keeps syncing but has not seen our updates for over an hour (while we did publish
  // newer ones), one side's cloud client is not uploading/downloading -> surface it instead of "ok".
  checkPeers(peers) {
    const H = 3600 * 1000;
    const myPrev = this.state.lastPublishedAt || 0;
    for (const p of peers) {
      const seenMe = p.seen?.[this.cfg.deviceId];
      if (!seenMe || !p.lastSyncAt || now() - p.lastSyncAt > 24 * H) continue;
      if (p.lastSyncAt - seenMe > H && myPrev - seenMe > H) {
        this.res.errors.push(`'${p.deviceName || p.deviceId}'이(가) 1시간 넘게 이 PC의 변경을 받지 못하고 있습니다. 두 PC의 클라우드 앱(Google Drive 등)이 '최신 상태'인지 확인하고, 아니면 앱을 재시작하거나 계정을 다시 연결하세요.`);
      }
    }
  }

  progress(msg) { log(msg); this.onProgress(msg); }
  err(where, e) { const m = `${where}: ${e?.message || e}`; log('ERROR', m, e?.stack || ''); this.res.errors.push(m); }

  async run() {
    if (!this.cfg.syncDir) throw new Error('동기화 폴더(syncDir)가 설정되지 않았습니다. 확장 옵션에서 지정하세요.');
    checkSyncDir(this.cfg.syncDir);
    this.store.init();
    // Guard: if the sync folder/store changed (different path, or cloud replaced/renamed the folder),
    // the saved 3-way base is meaningless. Reset it so nothing is treated as "deleted on the other side".
    const storeMeta = readJson(this.store.p('store.json'), {});
    const storeId = `${path.resolve(this.cfg.syncDir)}|${storeMeta.createdAt || ''}`;
    if (this.state.storeId && this.state.storeId !== storeId) {
      this.state.sessions = {}; this.state.files = {}; this.state.settings = null;
      this.res.notes.push('동기화 폴더가 바뀌어 비교 기준을 초기화했습니다 (첫 동기화처럼 처리, 삭제 없음).');
      log('store changed:', this.state.storeId, '->', storeId);
    }
    this.state.storeId = storeId;
    if (this.state.accountDir && this.state.accountDir !== this.accountDir) {
      this.state.sessions = {}; this.state.files = {}; this.state.settings = null;
      this.res.notes.push('동기화할 Aside 계정이 바뀌어 비교 기준을 초기화했습니다 (삭제 없음).');
      log('account changed:', this.state.accountDir, '->', this.accountDir);
    }
    this.state.accountDir = this.accountDir;
    if (!this.cfg.accountDir) { saveConfig({ accountDir: this.accountDir }); this.cfg = { ...this.cfg, accountDir: this.accountDir }; this.res.notes.push(`동기화할 Aside 계정을 고정했습니다: ${this.accountDir}`); }
    this.progress(`계정 폴더: ${this.accountDir}`);
    this.db = openDb(this.accountDir);
    try {
      if (this.cfg.include.projects) this.syncProjects();
      if (this.cfg.include.sessions) await this.syncSessions();
      this.syncFiles();
      if (this.cfg.include.settings) this.syncSettings();
      this.gcBlobs();
      const peers = this.store.readDeviceFiles('devices').filter((d) => d.deviceId && d.deviceId !== this.cfg.deviceId);
      this.checkPeers(peers);
      const lastSyncAt = now();
      // git mode: an idle run should not create a commit every 15 min -> heartbeat at most every 30 min
      const r = this.res; const changed = r.sessions.uploaded + r.sessions.downloaded + r.files.uploaded + r.files.downloaded + r.files.deleted + (r.projects.downloaded || 0) > 0;
      const ownDevice = this.store.p('devices', `${this.cfg.deviceId}.json`);
      if (!this.cfg.gitRemote || changed || !fs.existsSync(ownDevice) || lastSyncAt - (this.state.lastPublishedAt || 0) > 30 * 60 * 1000) writeJsonAtomic(this.store.p('devices', `${this.cfg.deviceId}.json`), {
        deviceId: this.cfg.deviceId, deviceName: this.cfg.deviceName, platform: process.platform, version: VERSION, lastSyncAt,
        seen: Object.fromEntries(peers.map((p) => [p.deviceId, p.lastSyncAt])),
      });
      if (readJson(ownDevice, {}).lastSyncAt === lastSyncAt) this.state.lastPublishedAt = lastSyncAt;
      this.res.ok = this.res.errors.length === 0;
    } finally {
      try { this.db.close(); } catch {}
      // prune hash cache entries for files that no longer exist
      for (const f of Object.keys(this.state.hashCache)) if (!fs.existsSync(f)) delete this.state.hashCache[f];
      this.res.finishedAt = now();
      this.state.lastResult = this.res;
      saveState(this.state);
    }
    return this.res;
  }

  // ---------------- projects
  syncProjects() {
    if (!tableExists(this.db, 'projects')) return;
    this.progress('프로젝트 동기화 중...');
    const cols = tableCols(this.db, 'projects');
    const local = new Map(this.db.prepare('SELECT * FROM projects').all().map((r) => [r.id, r]));
    const remote = new Map();
    for (const f of this.store.readDeviceFiles('projects')) {
      if (f.deviceId === this.cfg.deviceId) continue;
      for (const r of f.projects || []) {
        const cur = remote.get(r.id);
        if (!cur || (r.updated_at || 0) > (cur.updated_at || 0)) remote.set(r.id, r);
      }
    }
    for (const [id, r] of remote) {
      const l = local.get(id);
      if (!l || (r.updated_at || 0) > (l.updated_at || 0)) {
        try {
          const row = this.codec.detokenizeRow(r);
          if (row.workspace_path && !fs.existsSync(row.workspace_path)) {
            try { ensureDir(row.workspace_path); } catch {}
          }
          upsert(this.db, 'projects', row, cols);
          local.set(id, row);
          this.res.projects.downloaded++;
        } catch (e) { this.err(`project ${id}`, e); }
      }
    }
    const mine = { deviceId: this.cfg.deviceId, deviceName: this.cfg.deviceName, projects: [...local.values()].map((r) => this.codec.tokenizeRow(r)) };
    const file = this.store.p('projects', `${this.cfg.deviceId}.json`);
    const prev = readJson(file);
    if (!prev || JSON.stringify(prev.projects) !== JSON.stringify(mine.projects)) writeJsonAtomic(file, { ...mine, exportedAt: now() });
  }

  // ---------------- sessions
  sessionDirFor(id) {
    try {
      const hit = fs.readdirSync(this.sessionsDir).find((d) => d.endsWith(`_${id}`) || d === id);
      if (hit) return path.join(this.sessionsDir, hit);
    } catch {}
    return null;
  }

  sessionFileList(dir) {
    if (!dir) return [];
    const out = [];
    if (fs.existsSync(path.join(dir, 'messages.jsonl'))) out.push('messages.jsonl');
    if (this.cfg.include.artifacts) {
      for (const sub of ['artifacts', 'attachments']) for (const rel of walkFiles(path.join(dir, sub))) out.push(`${sub}/${rel}`);
    }
    const max = this.cfg.maxFileMB * 1024 * 1024;
    return out.filter((rel) => {
      if (FILE_EXCLUDE.some((re) => re.test(rel))) return false;
      try { return fs.statSync(path.join(dir, rel)).size <= max; } catch { return false; }
    }).sort();
  }

  localFingerprint(row, dir, turnCount) {
    const r = { ...row };
    for (const k of ROW_FP_IGNORE) delete r[k];
    const files = this.sessionFileList(dir).map((rel) => {
      const s = fs.statSync(path.join(dir, rel));
      return `${rel}:${s.size}:${Math.round(s.mtimeMs)}`;
    });
    return sha1(JSON.stringify([r, turnCount, files]));
  }

  effectiveRecord(id) {
    let best = null;
    for (const rec of this.store.readDeviceFiles('sessions', id)) {
      if (!rec.version || !rec.row) continue;
      if (!best || rec.updatedAt > best.updatedAt || (rec.updatedAt === best.updatedAt && rec.exportedAt > best.exportedAt)) best = rec;
    }
    return best;
  }

  async syncSessions() {
    if (!tableExists(this.db, 'sessions')) return;
    this.progress('채팅 기록 비교 중...');
    const rows = this.db.prepare('SELECT * FROM sessions WHERE ephemeral = 0 AND incognito = 0').all();
    const local = new Map(rows.map((r) => [r.id, r]));
    const turnCount = new Map(this.db.prepare('SELECT session_id, COUNT(*) c FROM session_turns GROUP BY session_id').all().map((r) => [r.session_id, r.c]));
    const ids = new Set([...local.keys(), ...this.store.listDir('sessions')]);
    let i = 0;
    for (const id of ids) {
      i++;
      if (i % 10 === 0) this.progress(`채팅 기록 ${i}/${ids.size}`);
      try {
        const row = local.get(id);
        const st = this.state.sessions[id] || {};
        const dir = row ? this.sessionDirFor(id) : null;
        const L = row ? this.localFingerprint(row, dir, turnCount.get(id) || 0) : null;
        const S = this.effectiveRecord(id);
        if (row && row.status === 'running') { this.res.sessions.skippedRunning++; continue; }

        let action = null;
        if (!row && S) action = st.local && st.store === S.version ? null : 'import'; // respect local deletion
        else if (row && !S) action = 'export';
        else if (row && S) {
          const lc = L !== st.local;
          const sc = S.version !== st.store;
          if (lc && !sc) action = 'export';
          else if (sc && !lc) action = 'import';
          else if (lc && sc) {
            // both changed (or first sync on this PC) -> newest wins
            if (st.local || st.store) this.res.sessions.conflicts++;
            action = (S.updatedAt || 0) > (row.updated_at || 0) ? 'import' : 'export';
            if (S.updatedAt === row.updated_at && S.row.transcript_revision === row.transcript_revision) action = 'adopt';
          }
        }
        if (action === 'export') this.exportSession(row, dir, L);
        else if (action === 'import') this.importSession(id, S);
        else if (action === 'adopt') this.state.sessions[id] = { local: L, store: S.version };
      } catch (e) { this.err(`session ${id}`, e); }
    }
  }

  exportSession(row, dir, fp) {
    const id = row.id;
    const files = [];
    for (const rel of this.sessionFileList(dir)) {
      const abs = path.join(dir, rel);
      const { hash, size } = cachedHash(this.state, abs);
      this.store.putBlob(hash, size, abs);
      files.push({ rel, hash, size });
    }
    const turns = tableExists(this.db, 'session_turns') ? this.db.prepare('SELECT * FROM session_turns WHERE session_id = ? ORDER BY id').all(id) : [];
    const extractions = tableExists(this.db, 'session_turn_memory_extractions')
      ? this.db.prepare('SELECT * FROM session_turn_memory_extractions WHERE session_id = ?').all(id) : [];
    const rec = {
      schema: SCHEMA, id, deviceId: this.cfg.deviceId, deviceName: this.cfg.deviceName,
      version: crypto.randomUUID(), exportedAt: now(), updatedAt: row.updated_at || 0,
      dirName: dir ? path.basename(dir) : null,
      row: this.codec.tokenizeRow(row), turns, extractions, files,
    };
    writeJsonAtomic(this.store.p('sessions', id, `${this.cfg.deviceId}.json`), rec);
    this.state.sessions[id] = { local: fp, store: rec.version };
    this.res.sessions.uploaded++;
  }

  importSession(id, rec) {
    // all blobs must already be present (cloud clients upload files in arbitrary order)
    const missing = rec.files.filter((f) => !this.store.hasBlob(f.hash, f.size));
    if (missing.length) { this.res.sessions.pending++; log(`session ${id}: ${missing.length} blobs not yet synced, retry later`); return; }

    let dir = this.sessionDirFor(id);
    if (!dir) {
      const created = new Date((rec.row.created_at || rec.updatedAt) * 1000);
      const ymd = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;
      dir = path.join(this.sessionsDir, rec.dirName || `${ymd}_${id}`);
    }
    ensureDir(dir);
    const wanted = new Set(rec.files.map((f) => f.rel));
    for (const f of rec.files) {
      const abs = path.join(dir, ...f.rel.split('/'));
      let same = false;
      try { same = cachedHash(this.state, abs).hash === f.hash; } catch {}
      if (!same) this.store.getBlob(f.hash, abs);
    }
    if (this.cfg.include.artifacts) {
      for (const sub of ['artifacts', 'attachments']) for (const rel of walkFiles(path.join(dir, sub))) {
        if (!wanted.has(`${sub}/${rel}`) && !FILE_EXCLUDE.some((re) => re.test(`${sub}/${rel}`))) {
          const abs = path.join(dir, sub, rel);
          try { if (fs.statSync(abs).size <= this.cfg.maxFileMB * 1024 * 1024) fs.rmSync(abs); } catch {}
        }
      }
    }
    for (const sub of ['artifacts', 'tmp']) ensureDir(path.join(dir, sub));

    const row = this.codec.detokenizeRow(rec.row);
    if (row.status === 'running') row.status = 'idle';
    if (row.project_id && !this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(row.project_id)) row.project_id = null;
    for (const k of ROW_FP_IGNORE) row[k] = null;

    const sCols = tableCols(this.db, 'sessions');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
      if (existing) for (const k of ROW_FP_IGNORE) if (k in existing) row[k] = existing[k];
      upsert(this.db, 'sessions', row, sCols);
      if (tableExists(this.db, 'session_turns')) {
        const tCols = tableCols(this.db, 'session_turns').filter((c) => c !== 'id');
        const hasEx = tableExists(this.db, 'session_turn_memory_extractions');
        if (hasEx) this.db.prepare('DELETE FROM session_turn_memory_extractions WHERE session_id = ?').run(id);
        this.db.prepare('DELETE FROM session_turns WHERE session_id = ?').run(id);
        const idMap = new Map();
        for (const t of rec.turns || []) {
          const { id: oldId, ...rest } = t;
          idMap.set(oldId, insertRow(this.db, 'session_turns', rest, tCols));
        }
        if (hasEx) {
          const eCols = tableCols(this.db, 'session_turn_memory_extractions');
          for (const e of rec.extractions || []) {
            const mapped = idMap.get(e.session_turn_id);
            if (mapped == null) continue;
            insertRow(this.db, 'session_turn_memory_extractions', { ...e, session_turn_id: mapped }, eCols);
          }
        }
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    const fresh = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    const tc = this.db.prepare('SELECT COUNT(*) c FROM session_turns WHERE session_id = ?').get(id).c;
    this.state.sessions[id] = { local: this.localFingerprint(fresh, dir, tc), store: rec.version };
    this.res.sessions.downloaded++;
  }

  // ---------------- generic files (memory, user skills, persona)
  fileRoots() {
    const inc = this.cfg.include;
    const roots = [];
    if (inc.memory) roots.push('memory');
    if (inc.userSkills) roots.push('skills/user');
    return roots;
  }

  localFiles() {
    const out = new Map();
    for (const r of this.fileRoots()) {
      for (const rel of walkFiles(path.join(this.accountDir, ...r.split('/')))) out.set(`${r}/${rel}`, null);
    }
    if (this.cfg.include.persona) for (const f of ['AGENTS.md', 'SOUL.md']) if (fs.existsSync(path.join(this.accountDir, f))) out.set(f, null);
    for (const rel of [...out.keys()]) if (FILE_EXCLUDE.some((re) => re.test(rel))) out.delete(rel);
    return out;
  }

  inScope(rel) {
    if (FILE_EXCLUDE.some((re) => re.test(rel))) return false;
    if (['AGENTS.md', 'SOUL.md'].includes(rel)) return this.cfg.include.persona;
    return this.fileRoots().some((r) => rel.startsWith(r + '/'));
  }

  // Both PCs edited the same text file since the last sync: merge line by line (git merge-file) using the
  // last synced version as base. Clean merge -> write + publish the merged file. Overlapping edits -> null,
  // and the caller falls back to "newest wins" (+ backup of the losing copy).
  tryMerge(rel, abs, B, S, myManifest, base) {
    if (!/\.(md|txt|jsonl)$/i.test(rel) || !gitAvailable()) return false;
    const bp = this.store.findBlob(B); const sp = this.store.findBlob(S);
    if (!bp || !sp) return false;
    if (fs.statSync(abs).size > 2e6 || fs.statSync(sp).size > 2e6) return false;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aside-merge-'));
    try {
      const lf = path.join(tmp, 'local'); const bf = path.join(tmp, 'base'); const rf = path.join(tmp, 'remote');
      fs.copyFileSync(abs, lf); fs.copyFileSync(bp, bf); fs.copyFileSync(sp, rf);
      const args = ['merge-file', '-p'];
      if (/\.jsonl$/i.test(rel)) args.push('--union'); // append-only logs: keep both sides' lines
      let out;
      try { out = gitRaw([...args, lf, bf, rf], { encoding: 'buffer' }); } catch { return false; } // exit>0 = conflicts
      const out2 = path.join(tmp, 'merged'); fs.writeFileSync(out2, out);
      const h = hashFileSync(out2); const size = out.length;
      copyAtomic(out2, abs);
      this.store.putBlob(h, size, abs);
      const st = fs.statSync(abs);
      myManifest.entries[rel] = { hash: h, size, mtime: Math.round(st.mtimeMs), at: now() };
      base[rel] = h;
      this.res.files.merged = (this.res.files.merged || 0) + 1;
      this.res.files.uploaded++;
      log(`merged ${rel}`);
      return true;
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  syncFiles() {
    if (!this.fileRoots().length && !this.cfg.include.persona) return;
    this.progress('메모리/스킬 파일 동기화 중...');
    // effective remote entry = newest "at" across all device manifests
    const remote = new Map();
    let myManifest = { deviceId: this.cfg.deviceId, entries: {} };
    for (const m of this.store.readDeviceFiles('manifests')) {
      if (m.deviceId === this.cfg.deviceId) myManifest = m;
      for (const [rel, e] of Object.entries(m.entries || {})) {
        const cur = remote.get(rel);
        if (!cur || e.at > cur.at) remote.set(rel, e);
      }
    }
    const local = this.localFiles();
    // Guard: if this device's own manifest is missing from the store (new/replaced folder, cloud not synced yet),
    // never trust the old base -> treat as first sync so local files are pushed, not deleted.
    const ownFound = this.store.readDeviceFiles('manifests').some((m) => m.deviceId === this.cfg.deviceId);
    if (!ownFound && Object.keys(this.state.files).length) {
      this.state.files = {};
      this.res.notes.push('동기화 폴더에 이 PC의 파일 목록이 없어 첫 동기화처럼 처리했습니다 (삭제 없음).');
    }
    const base = this.state.files;
    const all = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)]);
    let manifestDirty = false;
    const conflictDir = path.join(SYNC_HOME, 'conflicts', new Date().toISOString().replace(/[:.]/g, '-'));
    const pendingDeletes = [];

    for (const rel of all) {
      if (!this.inScope(rel)) continue;
      try {
        const abs = path.join(this.accountDir, ...rel.split('/'));
        let L = null; let lInfo = null;
        if (local.has(rel)) { lInfo = cachedHash(this.state, abs); L = lInfo.hash; }
        const R = remote.get(rel);
        const S = R ? R.hash : null;
        const B = base[rel] ?? null;
        if (L === S) { if (L) base[rel] = L; else delete base[rel]; continue; }
        const lc = L !== B; const sc = S !== B;
        let push = false; let pull = false;
        if (lc && !sc) push = true;
        else if (sc && !lc) pull = true;
        else if (L && S && B && this.tryMerge(rel, abs, B, S, myManifest, base)) {
          manifestDirty = true; continue;
        } else {
          // both changed, or first sync with differing content -> newest wins
          const lTime = lInfo ? lInfo.mtimeMs : 0;
          const rTime = R ? (R.mtime || R.at) : 0;
          if (rTime > lTime) pull = true; else push = true;
          if (L && S) this.res.files.conflicts++;
          if (pull && L) { copyAtomic(abs, path.join(conflictDir, ...rel.split('/'))); }
          if (push && S) { const sp = this.store.findBlob(S); if (sp) copyAtomic(sp, path.join(conflictDir, ...rel.split('/')) + '.other-pc'); }
          // first sync and remote has no file -> keep local (push)
        }
        if (push) {
          const entry = L ? { hash: L, size: lInfo.size, mtime: Math.round(lInfo.mtimeMs), at: now() } : { hash: null, at: now() };
          if (L) this.store.putBlob(L, lInfo.size, abs);
          myManifest.entries[rel] = entry; manifestDirty = true;
          if (L) base[rel] = L; else delete base[rel];
          if (L) this.res.files.uploaded++;
        } else if (pull) {
          if (S) {
            if (!this.store.hasBlob(S, R.size)) { log(`file ${rel}: blob not yet synced`); continue; }
            this.store.getBlob(S, abs);
            if (R.mtime) try { fs.utimesSync(abs, new Date(), new Date(R.mtime)); } catch {}
            base[rel] = S; this.res.files.downloaded++;
          } else {
            pendingDeletes.push({ abs, rel, L, lInfo });
          }
        }
      } catch (e) { this.err(`file ${rel}`, e); }
    }
    // Safety net: a sync should rarely delete many files at once. A large batch almost always means the
    // store looks empty/foreign (folder replaced, cloud not synced yet), not a real deletion on another PC.
    if (pendingDeletes.length) {
      const limit = Math.max(5, Math.ceil(local.size * 0.2));
      const allow = process.env.ASIDE_SYNC_ALLOW_MASS_DELETE === '1';
      const keep = process.env.ASIDE_SYNC_KEEP_LOCAL === '1';
      if (keep) {
        // resolve the other way: keep this PC's copies and re-upload them (restores them on the other PCs too)
        for (const { rel, L, lInfo } of pendingDeletes) {
          if (!L) continue;
          myManifest.entries[rel] = { hash: L, size: lInfo.size, mtime: Math.round(lInfo.mtimeMs), at: now() };
          this.store.putBlob(L, lInfo.size, path.join(this.accountDir, ...rel.split('/')));
          base[rel] = L; manifestDirty = true; this.res.files.uploaded++;
        }
        this.res.notes.push(`다른 PC에서 지운 파일 ${pendingDeletes.length}개를 지우지 않고 다시 올렸습니다 (--keep-local).`);
      } else if (pendingDeletes.length > limit && !allow) {
        this.res.errors.push(`다른 PC에서 파일 ${pendingDeletes.length}개가 지워진 것으로 보이지만 안전을 위해 삭제하지 않았습니다 (한도 ${limit}개). 삭제를 받아들이려면 'sync --allow-mass-delete', 이 PC 파일로 되살리려면 'sync --keep-local'로 실행하세요. 목록: ~/.aside-sync/sync.log`);
        log('mass delete blocked:', pendingDeletes.map((d) => d.rel).join(', '));
      } else {
        for (const { abs, rel } of pendingDeletes) {
          try {
            if (fs.existsSync(abs)) copyAtomic(abs, path.join(conflictDir, 'deleted', ...rel.split('/')));
            fs.rmSync(abs, { force: true }); delete base[rel]; this.res.files.deleted++;
          } catch (e) { this.err(`file ${rel}`, e); }
        }
      }
    }
    if (manifestDirty) writeJsonAtomic(this.store.p('manifests', `${this.cfg.deviceId}.json`), { ...myManifest, deviceName: this.cfg.deviceName, updatedAt: now() });
  }

  // ---------------- settings.json (opt-in)
  syncSettings() {
    const file = path.join(this.accountDir, 'settings.json');
    const full = readJson(file);
    if (!full) return;
    const filtered = Object.fromEntries(Object.entries(full).filter(([k]) => !SETTINGS_EXCLUDE.includes(k)));
    const L = sha1(JSON.stringify(filtered));
    let R = null;
    for (const f of this.store.readDeviceFiles('settings')) if (!R || f.at > R.at) R = f;
    const S = R ? R.hash : null;
    const B = this.state.settings;
    const writeMine = () => {
      writeJsonAtomic(this.store.p('settings', `${this.cfg.deviceId}.json`), { deviceId: this.cfg.deviceId, at: now(), hash: L, data: filtered });
      this.state.settings = L; this.res.settings = 'uploaded';
    };
    if (L === S) { this.state.settings = L; return; }
    const lc = L !== B; const sc = S !== B;
    let pull = sc && !lc;
    if (lc && sc && R) pull = R.at > fs.statSync(file).mtimeMs;
    if (pull && R) {
      const merged = { ...R.data };
      for (const k of SETTINGS_EXCLUDE) if (k in full) merged[k] = full[k];
      copyAtomic(file, path.join(SYNC_HOME, 'settings-backup.json'));
      writeJsonAtomic(file, merged);
      this.state.settings = S; this.res.settings = 'downloaded';
    } else writeMine();
  }

  // ---------------- blob garbage collection
  gcBlobs() {
    if (this.cfg.gitRemote) return;
    const KEEP_MS = 3 * 24 * 3600 * 1000;
    const refs = new Set();
    for (const id of this.store.listDir('sessions')) {
      const recs = this.store.readDeviceFiles('sessions', id);
      let best = null;
      for (const r of recs) if (!best || r.updatedAt > best.updatedAt || (r.updatedAt === best.updatedAt && r.exportedAt > best.exportedAt)) best = r;
      for (const r of recs) if (r === best || now() - (r.exportedAt || 0) < KEEP_MS) for (const f of r.files || []) refs.add(f.hash);
    }
    for (const m of this.store.readDeviceFiles('manifests')) for (const e of Object.values(m.entries || {})) if (e.hash) refs.add(e.hash);
    for (const pre of this.store.listDir('blobs')) {
      for (const d of this.store.resolveDirs('blobs', pre)) {
        let hs; try { hs = fs.readdirSync(d); } catch { continue; }
        for (const h of hs) {
          if (refs.has(h)) continue;
          const p = path.join(d, h);
          try {
            if (now() - fs.statSync(p).mtimeMs > KEEP_MS) { fs.rmSync(p); this.res.blobsRemoved++; }
          } catch {}
        }
      }
    }
  }
}

// ---------------------------------------------------------------- locking
async function withLock(fn) {
  ensureDir(SYNC_HOME);
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: now() }));
      fs.closeSync(fd);
      try { return await fn(); } finally { fs.rmSync(LOCK_FILE, { force: true }); }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const info = readJson(LOCK_FILE, {});
      let alive = false;
      try { process.kill(info.pid, 0); alive = true; } catch {}
      if (alive && now() - (info.at || 0) < 30 * 60 * 1000) throw new Error('이미 다른 동기화가 진행 중입니다.');
      fs.rmSync(LOCK_FILE, { force: true });
    }
  }
  throw new Error('lock 획득 실패');
}

// "github.com/me/repo", "https://github.com/me/repo", ".../repo.git" -> https://github.com/me/repo.git
function normalizeGitUrl(u) {
  u = String(u || '').trim();
  const m = u.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i); // also browser URLs like .../tree/main
  if (m) return `https://github.com/${m[1]}/${m[2]}.git`;
  return u;
}

// One-step setup from the extension: verify repo access, pin the Aside account, register the OS
// scheduler, then run the first sync. Only the initial native-host install needs a terminal.
async function connectGit(msg, progress) {
  const url = normalizeGitUrl(msg.url);
  if (!url) throw new Error('저장소 주소를 입력하세요 (예: https://github.com/아이디/aside-sync-data)');
  progress('저장소 접근 확인 중...');
  checkGitRemote(url);
  const cfg0 = loadConfig();
  const accounts = listAccounts(cfg0.asideRoot);
  let accountDir = msg.accountDir || cfg0.accountDir;
  let autoPicked = false;
  if (!accountDir) {
    if (!accounts.length) throw new Error(`Aside 계정 폴더를 찾지 못했습니다: ${path.join(cfg0.asideRoot, 'u')}`);
    accountDir = accounts[0].dir; // most recently used = the Aside account being used right now
    autoPicked = accounts.length > 1;
  }
  const patch = { gitRemote: url, accountDir };
  if (!Number(cfg0.autoSyncMinutes)) patch.autoSyncMinutes = 15;
  const config = saveConfig(patch);
  let scheduler = null;
  try { scheduler = applySchedule(config); } catch (e) { scheduler = { ok: false, error: e.message }; }
  const result = await runSync(progress, 'manual');
  return { config, accounts, autoPicked, scheduler, result };
}

const cmpVer = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
async function checkUpdate() {
  const res = await fetch(`https://raw.githubusercontent.com/${CODE_REPO}/${CODE_BRANCH}/host/aside-sync-host.mjs?t=${now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`업데이트 확인 실패: HTTP ${res.status}`);
  const latest = ((await res.text()).match(/const VERSION = '([^']+)'/) || [])[1];
  return { current: VERSION, latest, newer: !!latest && cmpVer(latest, VERSION) > 0 };
}

// Self-update: download the code repo, replace ~/.aside-sync/app (extension/host/install) and the running
// host file, then re-run the platform installer (re-registers the native host for all browsers).
async function selfUpdate(progress) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aside-sync-upd-'));
  try {
    progress('새 버전 받는 중...');
    const res = await fetch(`https://codeload.github.com/${CODE_REPO}/tar.gz/refs/heads/${CODE_BRANCH}`);
    if (!res.ok) throw new Error(`다운로드 실패: HTTP ${res.status}`);
    const tgz = path.join(tmp, 'src.tgz');
    fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    run('tar', ['-xzf', tgz, '-C', tmp]);
    const src = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory());
    const newHost = path.join(src, 'host', 'aside-sync-host.mjs');
    const to = (fs.readFileSync(newHost, 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
    if (!to) throw new Error('받은 파일이 올바르지 않습니다.');
    run(process.execPath, ['--check', newHost]); // never install a host that does not parse
    progress(`v${to} 설치 중...`);
    const APP = path.join(SYNC_HOME, 'app');
    ensureDir(APP);
    for (const d of ['extension', 'host', 'install']) {
      fs.rmSync(path.join(APP, d), { recursive: true, force: true });
      fs.cpSync(path.join(src, d), path.join(APP, d), { recursive: true });
    }
    for (const fn of ['README.md', 'install.sh', 'install.ps1']) { try { fs.copyFileSync(path.join(src, fn), path.join(APP, fn)); } catch {} }
    copyAtomic(newHost, HOST_FILE);
    try {
      if (process.platform === 'win32') run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP, 'install', 'install-windows.ps1')]);
      else run('bash', [path.join(APP, 'install', 'install-mac.sh')]);
    } catch (e) { log('installer after update failed:', e.message); }
    log(`self-update ${VERSION} -> ${to}`);
    return { from: VERSION, to };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function runSync(onProgress, trigger = 'manual') {
  return withLock(async () => {
    const cfg = loadConfig();
    try {
      const gitMode = !!cfg.gitRemote;
      if (gitMode) gitPrepare(cfg, onProgress || (() => {}));
      const run = new SyncRun(gitMode ? { ...cfg, syncDir: GIT_DIR } : cfg, onProgress);
      run.res.trigger = trigger;
      const res = await run.run();
      if (gitMode) {
        try { if (gitPublish(cfg, res, onProgress || (() => {}))) res.notes.push('저장소에 올렸습니다.'); }
        catch (e) { res.errors.push(e.message); res.ok = false; }
        const st = loadState(); st.lastResult = res; saveState(st);
      }
      return res;
    } catch (e) {
      // record setup-level failures so the extension can show them
      const st = loadState();
      if (!st.lastResult || st.lastResult.finishedAt < now() - 1000) {
        st.lastResult = { startedAt: now(), finishedAt: now(), ok: false, trigger, device: cfg.deviceName,
          sessions: { uploaded: 0, downloaded: 0, skippedRunning: 0, pending: 0, conflicts: 0 }, projects: { downloaded: 0 },
          files: { uploaded: 0, downloaded: 0, deleted: 0, conflicts: 0 }, errors: [e.message], notes: [] };
        saveState(st);
      }
      throw e;
    }
  });
}

// ---------------------------------------------------------------- OS scheduler
// The OS (launchd / Task Scheduler / cron) runs "sync --trigger=scheduler" in the
// background, so syncing works even when Chrome is closed. The extension only
// changes the interval and shows status.
function syncCommand() {
  return [process.execPath, '--no-warnings', HOST_FILE, 'sync', '--trigger=scheduler'];
}
const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true, ...opts });

// ---------------------------------------------------------------- git transport (GitHub etc.)
// With config.gitRemote set, the store lives in a local clone (~/.aside-sync/repo) and each sync is
// fetch+rebase -> SyncRun -> commit -> push. Every device only writes its own files (devices/<id>.json,
// manifests/<id>.json, sessions/<sid>/<id>.json) and blobs are content-addressed, so rebases do not conflict.
// Unlike a cloud-drive folder: an upload failure is an explicit error, nothing is half-synced, and the
// full history stays in git (any old version can be restored).
const GIT_DIR = path.join(SYNC_HOME, 'repo');
const GIT_BRANCH = 'main';
const GIT_TIMEOUT = 15 * 60 * 1000;
function gitEnv() { return { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C' }; }
function gitRaw(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(), windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...opts });
}
function git(args, opts) { return gitRaw(['-C', GIT_DIR, ...args], opts); }
function gitMsg(e) {
  const t = `${e?.stderr || ''}${e?.stdout || ''}`.trim() || e?.message || String(e);
  return t.split('\n').filter(Boolean).slice(-3).join(' / ');
}
function gitAvailable() { try { gitRaw(['--version']); return true; } catch { return false; } }
function checkGitRemote(url) {
  if (!gitAvailable()) throw new Error('git이 설치되어 있지 않습니다 (macOS: xcode-select --install, Windows: Git for Windows 설치).');
  try { gitRaw(['ls-remote', '--heads', url], { timeout: 120000 }); }
  catch (e) { throw new Error(`저장소에 접근할 수 없습니다: ${gitMsg(e)}. 주소와 이 PC의 git 로그인(GitHub 자격 증명)을 확인하세요.`); }
}
function gitHasRef(ref) { try { git(['rev-parse', '--verify', '--quiet', ref]); return true; } catch { return false; } }
function gitCommitAll(msg) {
  git(['add', '-A']);
  if (!git(['status', '--porcelain']).trim()) return false;
  git(['commit', '-q', '--no-verify', '-m', msg]);
  return true;
}
function gitPull() {
  try { git(['fetch', '--quiet', 'origin'], { timeout: GIT_TIMEOUT }); }
  catch (e) { throw new Error(`저장소에서 받지 못했습니다 (네트워크/로그인 확인): ${gitMsg(e)}`); }
  if (!gitHasRef(`origin/${GIT_BRANCH}`)) return; // empty remote: this device publishes first
  if (!gitHasRef('HEAD')) { git(['checkout', '-q', '-B', GIT_BRANCH, `origin/${GIT_BRANCH}`]); return; }
  try {
    // "-X ours" = on the rare add/add race (e.g. store.json) keep the upstream copy so all PCs agree
    git(['rebase', '-q', '-X', 'ours', `origin/${GIT_BRANCH}`]);
  } catch (e) {
    try { git(['rebase', '--abort']); } catch {}
    throw new Error(`저장소 변경을 합치지 못했습니다: ${gitMsg(e)}`);
  }
}
function gitPrepare(cfg, progress) {
  if (!gitAvailable()) throw new Error('git이 설치되어 있지 않습니다 (macOS: xcode-select --install, Windows: Git for Windows 설치).');
  if (fs.existsSync(path.join(GIT_DIR, '.git'))) {
    let cur = ''; try { cur = git(['remote', 'get-url', 'origin']).trim(); } catch {}
    if (cur !== cfg.gitRemote) fs.renameSync(GIT_DIR, `${GIT_DIR}-old-${now()}`); // remote changed: keep old clone aside
  }
  if (!fs.existsSync(path.join(GIT_DIR, '.git'))) {
    if (fs.existsSync(GIT_DIR)) fs.renameSync(GIT_DIR, `${GIT_DIR}-old-${now()}`);
    progress('저장소 받는 중 (처음 한 번)...');
    try { gitRaw(['clone', '--quiet', cfg.gitRemote, GIT_DIR], { timeout: GIT_TIMEOUT }); }
    catch (e) { throw new Error(`저장소를 받지 못했습니다: ${gitMsg(e)}`); }
  }
  // repo-local settings: byte-exact files (content hashes!), readable names, a commit identity
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'core.quotepath', 'false']);
  git(['config', 'user.name', `aside-sync (${cfg.deviceName})`]);
  git(['config', 'user.email', 'aside-sync@localhost']);
  if (!gitHasRef('HEAD')) git(['symbolic-ref', 'HEAD', `refs/heads/${GIT_BRANCH}`]);
  const ga = path.join(GIT_DIR, '.gitattributes');
  if (!fs.existsSync(ga)) fs.writeFileSync(ga, '* -text\n');
  gitCommitAll(`aside-sync: ${cfg.deviceName} (이전 동기화 마무리)`); // leftovers of an interrupted run
  progress('저장소에서 변경 받는 중...');
  gitPull();
}
function gitPublish(cfg, res, progress) {
  gitCommitAll(`aside-sync: ${cfg.deviceName} · 채팅 ↑${res.sessions.uploaded} ↓${res.sessions.downloaded} · 파일 ↑${res.files.uploaded} ↓${res.files.downloaded}`);
  if (gitHasRef(`origin/${GIT_BRANCH}`) && git(['rev-list', '--count', `origin/${GIT_BRANCH}..HEAD`]).trim() === '0') return false;
  if (!gitHasRef('HEAD')) return false;
  progress('저장소에 올리는 중...');
  for (let i = 0; ; i++) {
    try { git(['push', '-q', 'origin', `HEAD:refs/heads/${GIT_BRANCH}`], { timeout: GIT_TIMEOUT }); return true; }
    catch (e) {
      const m = gitMsg(e);
      if (i < 3 && /rejected|non-fast-forward|fetch first/i.test(m)) { gitPull(); continue; } // another PC pushed meanwhile
      throw new Error(`저장소에 올리지 못했습니다 (다음 동기화 때 다시 시도): ${m}`);
    }
  }
}

function macPlistPath() { return path.join(os.homedir(), 'Library', 'LaunchAgents', `${SCHED_LABEL}.plist`); }

function applySchedule(cfg = loadConfig()) {
  const minutes = Math.max(0, Math.round(Number(cfg.autoSyncMinutes) || 0));
  const cmd = syncCommand();
  ensureDir(SYNC_HOME);
  if (process.platform === 'darwin') {
    const plist = macPlistPath();
    const domain = `gui/${process.getuid()}`;
    if (!minutes) {
      try { run('launchctl', ['bootout', `${domain}/${SCHED_LABEL}`]); } catch {}
      fs.rmSync(plist, { force: true });
      return schedulerStatus(cfg);
    }
    const env = process.env.ASIDE_SYNC_HOME ? `<key>EnvironmentVariables</key><dict><key>ASIDE_SYNC_HOME</key><string>${xmlEsc(process.env.ASIDE_SYNC_HOME)}</string></dict>` : '';
    ensureDir(path.dirname(plist));
    const plistText = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xmlEsc(SCHED_LABEL)}</string>
<key>ProgramArguments</key><array>${cmd.map((a) => `<string>${xmlEsc(a)}</string>`).join('')}</array>
<key>StartInterval</key><integer>${minutes * 60}</integer>
<key>RunAtLoad</key><true/>
<key>ProcessType</key><string>Background</string>
<key>LowPriorityIO</key><true/>
<key>StandardOutPath</key><string>${xmlEsc(path.join(SYNC_HOME, 'scheduler.log'))}</string>
<key>StandardErrorPath</key><string>${xmlEsc(path.join(SYNC_HOME, 'scheduler.log'))}</string>
${env}
</dict></plist>
`;
    let prev = null; try { prev = fs.readFileSync(plist, 'utf8'); } catch {}
    if (prev === plistText && schedulerStatus(cfg).installed) return schedulerStatus(cfg); // already running as-is
    try { run('launchctl', ['bootout', `${domain}/${SCHED_LABEL}`]); } catch {}
    fs.writeFileSync(plist, plistText);
    try { run('launchctl', ['bootstrap', domain, plist]); }
    catch (e1) {
      try { run('launchctl', ['load', '-w', plist]); }
      catch { log('launchctl bootstrap failed (will start at next login):', e1.message); }
    }
  } else if (process.platform === 'win32') {
    try { run('schtasks', ['/Delete', '/F', '/TN', WIN_TASK]); } catch {}
    if (!minutes) return schedulerStatus(cfg);
    // VBScript wrapper runs node with a hidden window (no console flash)
    const vbs = path.join(SYNC_HOME, 'run-hidden.vbs');
    const q = (a) => `""${a}""`;
    const line = `CreateObject("WScript.Shell").Run "${cmd.map(q).join(' ')}", 0, False\r\n`;
    fs.writeFileSync(vbs, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(line, 'utf16le')]));
    run('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', String(Math.min(minutes, 1439)), '/TN', WIN_TASK, '/TR', `wscript.exe "${vbs}"`]);
    try { run('schtasks', ['/Run', '/TN', WIN_TASK]); } catch {}
  } else {
    let tab = '';
    try { tab = run('crontab', ['-l']); } catch {}
    const lines = tab.split('\n').filter((l) => l.trim() && !l.includes('# aside-sync'));
    if (minutes) {
      const when = minutes < 60 ? `*/${minutes} * * * *` : `0 */${Math.max(1, Math.round(minutes / 60))} * * *`;
      const envp = process.env.ASIDE_SYNC_HOME ? `ASIDE_SYNC_HOME='${process.env.ASIDE_SYNC_HOME}' ` : '';
      lines.push(`${when} ${envp}${cmd.map((a) => `'${a}'`).join(' ')} >/dev/null 2>&1 # aside-sync`);
    }
    run('crontab', ['-'], { input: lines.join('\n') + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  }
  return schedulerStatus(cfg);
}

function schedulerStatus(cfg = loadConfig()) {
  const minutes = Math.max(0, Math.round(Number(cfg.autoSyncMinutes) || 0));
  let installed = false; let kind = '';
  try {
    if (process.platform === 'darwin') {
      kind = 'launchd';
      run('launchctl', ['print', `gui/${process.getuid()}/${SCHED_LABEL}`]);
      installed = true;
    } else if (process.platform === 'win32') {
      kind = 'Task Scheduler';
      run('schtasks', ['/Query', '/TN', WIN_TASK]);
      installed = true;
    } else {
      kind = 'cron';
      installed = run('crontab', ['-l']).includes('# aside-sync');
    }
  } catch {}
  const usesThisHost = process.platform !== 'darwin' || (() => { try { return fs.readFileSync(macPlistPath(), 'utf8').includes(xmlEsc(HOST_FILE)); } catch { return false; } })();
  const pendingLogin = process.platform === 'darwin' && !installed && minutes > 0 && fs.existsSync(macPlistPath());
  return { kind, installed, pendingLogin, minutes, ok: minutes === 0 ? !installed : installed && usesThisHost };
}

function status() {
  const cfg = loadConfig();
  const st = loadState();
  let accountDir = null; let accountError = null;
  try { accountDir = resolveAccountDir(cfg, st); } catch (e) { accountError = e.message; }
  let devices = [];
  const storeDir = cfg.gitRemote ? GIT_DIR : cfg.syncDir;
  if (storeDir && fs.existsSync(storeDir)) {
    const store = new Store(storeDir);
    devices = store.readDeviceFiles('devices');
  }
  let scheduler = null;
  try { scheduler = schedulerStatus(cfg); } catch (e) { scheduler = { error: e.message }; }
  let running = false;
  try { const l = readJson(LOCK_FILE); if (l) { process.kill(l.pid, 0); running = true; } } catch {}
  return { version: VERSION, node: process.version, config: cfg, accountDir, accountError, lastResult: st.lastResult, devices, syncHome: SYNC_HOME, scheduler, running };
}

function detect() {
  const cfg = loadConfig();
  return { accounts: listAccounts(cfg.asideRoot), cloudFolders: detectCloudFolders(), home: os.homedir(), platform: process.platform };
}

async function handle(msg, send) {
  switch (msg?.type) {
    case 'ping': return { type: 'pong', version: VERSION };
    case 'status': return { type: 'status', ...status() };
    case 'detect': return { type: 'detect', ...detect() };
    case 'setConfig': {
      const patch = { ...(msg.config || {}) };
      delete patch.deviceId;
      if (patch.syncDir) patch.syncDir = patch.syncDir.replace(/^~(?=$|[\\/])/, os.homedir());
      const before = loadConfig();
      const config = saveConfig(patch);
      let scheduler = null;
      if (Number(before.autoSyncMinutes) !== Number(config.autoSyncMinutes) || !schedulerStatus(config).ok) scheduler = applySchedule(config);
      return { type: 'config', config, scheduler };
    }
    case 'schedule': return { type: 'scheduler', scheduler: applySchedule() };
    case 'connectGit': return { type: 'connected', ...(await connectGit(msg, (m) => send({ type: 'progress', message: m }))) };
    case 'checkUpdate': return { type: 'update-info', ...(await checkUpdate()) };
    case 'update': return { type: 'updated', ...(await selfUpdate((m) => send({ type: 'progress', message: m }))) };
    case 'sync': {
      const result = await runSync((m) => send({ type: 'progress', message: m }), 'manual');
      return { type: 'result', result };
    }
    default: throw new Error(`unknown message type: ${msg?.type}`);
  }
}

// ---------------------------------------------------------------- native messaging
function nativeMain() {
  const send = (obj) => {
    const buf = Buffer.from(JSON.stringify(obj), 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32LE(buf.length, 0);
    process.stdout.write(Buffer.concat([len, buf]));
  };
  let pending = Buffer.alloc(0);
  let busy = Promise.resolve();
  process.stdin.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const n = pending.readUInt32LE(0);
      if (pending.length < 4 + n) break;
      const body = pending.subarray(4, 4 + n).toString('utf8');
      pending = pending.subarray(4 + n);
      let msg; try { msg = JSON.parse(body); } catch { send({ type: 'error', error: 'invalid json' }); continue; }
      busy = busy.then(async () => {
        try { send({ ...(await handle(msg, send)), requestId: msg.requestId }); }
        catch (e) { log('ERROR', e?.stack || String(e)); send({ type: 'error', error: e?.message || String(e), requestId: msg.requestId }); }
      });
    }
  });
  process.stdin.on('end', () => busy.then(() => process.exit(0)));
}

async function cliMain(args) {
  const cmd = args[0] || 'status';
  if (cmd === 'sync') {
    const trigger = (args.find((a) => a.startsWith('--trigger=')) || '--trigger=cli').split('=')[1];
    if (args.includes('--allow-mass-delete')) process.env.ASIDE_SYNC_ALLOW_MASS_DELETE = '1';
    if (args.includes('--keep-local')) process.env.ASIDE_SYNC_KEEP_LOCAL = '1';
    if (trigger === 'scheduler' && !loadConfig().syncDir && !loadConfig().gitRemote) { console.log('syncDir not set, skipping'); process.exit(0); }
    const r = await runSync((m) => console.log('·', m), trigger);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  } else if (cmd === 'status') console.log(JSON.stringify(status(), null, 2));
  else if (cmd === 'detect') console.log(JSON.stringify(detect(), null, 2));
  else if (cmd === 'connect') {
    const r = await connectGit({ url: args[1], accountDir: args[2] }, (m) => console.log('·', m));
    console.log(JSON.stringify({ gitRemote: r.config.gitRemote, accountDir: r.config.accountDir, autoPicked: r.autoPicked, accounts: r.accounts.map((a) => `u/${a.id} (채팅 ${a.sessionFolders}개)`), scheduler: r.scheduler, result: { ok: r.result.ok, sessions: r.result.sessions, files: r.result.files, errors: r.result.errors } }, null, 2));
  } else if (cmd === 'update') console.log(JSON.stringify(await selfUpdate((m) => console.log('·', m)), null, 2));
  else if (cmd === 'check-update') console.log(JSON.stringify(await checkUpdate(), null, 2));
  else if (cmd === 'schedule') console.log(JSON.stringify(applySchedule(), null, 2));
  else if (cmd === 'unschedule') console.log(JSON.stringify(applySchedule({ ...loadConfig(), autoSyncMinutes: 0 }), null, 2));
  else if (cmd === 'config') {
    const patch = {};
    for (const kv of args.slice(1)) {
      const i = kv.indexOf('=');
      const k = kv.slice(0, i); let v = kv.slice(i + 1);
      try { v = JSON.parse(v); } catch {}
      if (k.startsWith('include.')) { patch.include = { ...(patch.include || {}), [k.slice(8)]: v }; } else patch[k] = v;
    }
    console.log(JSON.stringify(saveConfig(patch), null, 2));
  } else {
    console.log('usage: aside-sync-host.mjs [connect <github-url> [accountDir]|sync|status|detect|schedule|unschedule|update|check-update|config key=value ...]');
  }
}

const isNative = process.argv.slice(2).some((a) => a.startsWith('chrome-extension://')) || process.env.ASIDE_SYNC_NATIVE === '1';
if (isNative) nativeMain();
else cliMain(process.argv.slice(2)).catch((e) => { console.error('오류:', e.message); process.exit(1); });
