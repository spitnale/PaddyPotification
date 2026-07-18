'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Status catalog — Discord-style presence colors.
const STATUS = {
  alert:      { label: 'Needs you',       group: 'Needs you',       color: '#c45858' },
  error:      { label: 'Tool error',      group: 'Errors',          color: '#d9663a' },
  working:    { label: 'Working',         group: 'Working',         color: '#9b7af0' },
  waiting:    { label: 'Waiting for you', group: 'Waiting for you', color: '#d4a053' },
  compacting: { label: 'Compacting',      group: 'Compacting',      color: '#46b3b0' },
  active:     { label: 'Active · idle',   group: 'Active · idle',   color: '#6bc46d' },
  ended:      { label: 'Ended',           group: 'Ended',           color: '#5a5280' },
};
const ORDER = ['alert', 'error', 'working', 'waiting', 'compacting', 'active', 'ended'];
const metaFor = (s) => STATUS[s] || STATUS.active;

// ---------- Notification identity (chime tones + macOS sound) ----------
// Alerts are split by kind so a permission request never sounds like an idle
// "waiting for your input" nudge. `sound` is the native macOS banner sound.
const CHIME_META = {
  alert_permission: { label: 'Needs permission', color: '#e0564f', tones: [988, 1245, 1568], sound: 'Glass', defaultChime: true },
  alert_input:      { label: 'Needs your input', color: '#c45858', tones: [880, 1109, 880],  sound: 'Ping',  defaultChime: true },
  error:            { label: 'Tool error',       color: '#d9663a', tones: [587, 466, 349],   sound: 'Basso', defaultChime: true },
  working:          { label: 'Working',          color: '#9b7af0', tones: [523],             defaultChime: false },
  waiting:          { label: 'Waiting for you',  color: '#d4a053', tones: [659, 880],        sound: 'Pop',   defaultChime: true },
  compacting:       { label: 'Compacting',       color: '#46b3b0', tones: [440, 622],        defaultChime: false },
  active:           { label: 'Active · idle',    color: '#6bc46d', tones: [698],             defaultChime: false },
  ended:            { label: 'Ended',            color: '#5a5280', tones: [392, 294],        defaultChime: false },
};
const CHIME_ORDER = Object.keys(CHIME_META);
const chimeKeyFor = (s) =>
  s.status === 'alert' ? (s.alertKind === 'permission' ? 'alert_permission' : 'alert_input') : s.status;
const PACKS = {
  'Soft chime': { type: 'sine', mul: 1 },
  Marimba: { type: 'triangle', mul: 1 },
  Ping: { type: 'sine', mul: 1.5 },
  Woodblock: { type: 'square', mul: 0.75 },
};

let audioCtx = null;
function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
// Custom audio packs discovered from public/sounds/ (see /api/sounds). Kept at
// module scope so playChime can reach them; populated once the fetch resolves.
let FILE_PACKS = {};
function setFilePacks(map) { FILE_PACKS = map || {}; }

function playFile(url) {
  try {
    const a = new Audio(url);
    a.volume = 0.7;
    a.play().catch(() => {});
  } catch {}
}

function playChime(chimeKey, packName) {
  // A custom pack plays its own file for this status; anything it doesn't
  // provide falls through to the synth beep below.
  const fileUrl = FILE_PACKS[packName]?.[chimeKey];
  if (fileUrl) { playFile(fileUrl); return; }

  const ctx = getCtx();
  if (!ctx) return;
  const pack = PACKS[packName] || PACKS['Soft chime'];
  const tone = CHIME_META[chimeKey]?.tones || CHIME_META.active.tones;
  let t = ctx.currentTime;
  const step = 0.16;
  for (const f of tone) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = pack.type;
    osc.frequency.setValueAtTime(f * pack.mul, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + step);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + step);
    t += step;
  }
}

// ---------- Helpers ----------
function ago(ts, now) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}
function shortDir(cwd) {
  if (!cwd) return '';
  return cwd.replace(/^\/Users\/[^/]+/, '~');
}
// Where the session lives — keep the tail (project) visible on long paths.
function locationLabel(cwd) {
  if (!cwd) return 'unknown location';
  const rel = cwd.replace(/^\/Users\/[^/]+/, '~');
  const parts = rel.split('/').filter(Boolean);
  return parts.length <= 3 ? rel : '…/' + parts.slice(-3).join('/');
}
// Friendly name of the app that can be focused, from its bundle id.
function ideName(bundleId) {
  const m = /^com\.jetbrains\.(.+)$/.exec(bundleId || '');
  return m ? m[1] : 'window';
}
// Compact token counts: 1234 -> 1.2k, 1234567 -> 1.23M
function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
// Context gauge color: calm accent until it matters, amber, then red.
function ctxColor(pct) {
  if (pct >= 80) return '#c45858';
  if (pct >= 60) return '#d4a053';
  return '#9b7af0';
}
function messageFor(s) {
  switch (s.status) {
    case 'alert': return s.message || 'Needs your input.';
    case 'error': return s.message || 'A tool call failed.';
    case 'working': return s.message || s.task || 'Working…';
    case 'waiting': return s.message || (s.task ? `Done: ${s.task}` : 'Done — waiting for your next prompt.');
    case 'compacting': return s.message || 'Compacting context…';
    case 'active': return s.message || 'Idle — ready for a prompt.';
    case 'ended': return s.title || s.summary || s.message || 'Session ended.';
    default: return s.event || '';
  }
}

// Native banner. Inside the desktop app, post through the Tauri notification
// plugin so the banner carries Paddy's own icon (osascript banners show up as
// Script Editor). The server round-trip still happens first, markOnly, so the
// existing dedupe keeps multiple open dashboards down to one banner.
const markNotify = (payload) =>
  fetch('/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then((r) => r.json()).catch(() => ({}));

async function emitNativeBanner(payload) {
  const viaTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  // In the desktop app, prefer the Tauri plugin so the banner carries Paddy's
  // own icon. Only claim the dedupe key AFTER the banner actually shows, so a
  // missing notification permission (or any plugin failure) falls through to
  // the osascript banner below instead of silently showing nothing — the bug
  // where the app "stopped notifying" after it was never granted permission.
  if (viaTauri) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import('@tauri-apps/plugin-notification');
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (ok) {
        sendNotification({ title: payload.title, body: payload.body, sound: payload.sound });
        // Reserve the key so any other open dashboard stays quiet.
        markNotify({ ...payload, markOnly: true });
        return;
      }
    } catch {}
    // permission missing or plugin failed -> fall through to the osascript banner
  }

  // Web path, or desktop fallback: real osascript banner (also claims the key).
  const res = await markNotify(payload);
  if (res?.deduped) return;
}

// Global rate limit on OS banners. macOS's notification daemon (usernoted) can
// wedge under a burst — after which it silently drops EVERY banner (the "app
// stopped notifying" bug). Emit at most one banner per NOTIFY_MIN_GAP_MS; when
// several alerts land inside a window, fold the extras into a single trailing
// "(+N more)" banner instead of firing them all. The board light and tray badge
// still reflect every session, so nothing is lost — only the OS spam is capped.
const NOTIFY_MIN_GAP_MS = 4000;
let lastNotifyAt = 0;
let pendingBanner = null;
let pendingCount = 0;
let flushTimer = null;

function notifyNative(payload) {
  const now = Date.now();
  if (now - lastNotifyAt >= NOTIFY_MIN_GAP_MS) {
    lastNotifyAt = now;
    emitNativeBanner(payload);
    return;
  }
  // Inside the quiet window — remember the newest alert and count the burst.
  pendingBanner = payload;
  pendingCount += 1;
  if (flushTimer) return;
  const wait = NOTIFY_MIN_GAP_MS - (now - lastNotifyAt);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const p = pendingBanner;
    const extra = pendingCount - 1;
    pendingBanner = null;
    pendingCount = 0;
    if (!p) return;
    lastNotifyAt = Date.now();
    emitNativeBanner(extra > 0 ? { ...p, body: `${p.body}  (+${extra} more)` } : p);
  }, wait);
}

// Native window width per layout. Rail is a slim glance strip; full restores the
// default board width. Only runs inside the Tauri desktop app; a no-op on the web.
const RAIL_WINDOW_W = 300;
const FULL_WINDOW_W = 420;
async function applyWindowWidth(rail) {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const win = getCurrentWindow();
    // Preserve the user's current height; only the width tracks the layout.
    const factor = await win.scaleFactor();
    const size = await win.innerSize();
    await win.setSize(new LogicalSize(rail ? RAIL_WINDOW_W : FULL_WINDOW_W, size.height / factor));
  } catch {}
}

const LS_KEY = 'paddy.settings.v2';
function loadSettings() {
  const chime = {};
  for (const k of CHIME_ORDER) chime[k] = CHIME_META[k].defaultChime;
  const base = { master: true, pack: 'Soft chime', showEnded: true, onTop: false, nativeNotify: true, rail: false, chime };
  if (typeof window === 'undefined') return base;
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    const savedChime = { ...(saved.chime || {}) };
    // Migrate the pre-split single "alert" toggle into both alert kinds.
    if (savedChime.alert !== undefined) {
      if (savedChime.alert_permission === undefined) savedChime.alert_permission = savedChime.alert;
      if (savedChime.alert_input === undefined) savedChime.alert_input = savedChime.alert;
      delete savedChime.alert;
    }
    return { ...base, ...saved, chime: { ...chime, ...savedChime } };
  } catch {
    return base;
  }
}

// ---------- Icons ----------
function BellIcon({ size = 15, off = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {off && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}
const Gear = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const Back = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);
// Arrow-up-right: "jump to this session's window"
const OpenIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M8 7h9v9" /></svg>
);
const ClockIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></svg>
);
const ActivityIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
);
const RefreshIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
);
// Double-chevron: collapse the board to a rail (left) / expand it back (right).
const ChevronsIcon = ({ dir = 'left' }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={dir === 'right' ? { transform: 'scaleX(-1)' } : undefined}>
    <polyline points="11 17 6 12 11 7" /><polyline points="18 17 13 12 18 7" />
  </svg>
);

function Switch({ on, onClick }) {
  return (
    <button className={`switch${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="knob" />
    </button>
  );
}

export default function Page() {
  const [sessions, setSessions] = useState([]);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [screen, setScreen] = useState('board');
  const [now, setNow] = useState(() => Date.now());
  const [isTauri, setIsTauri] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [history, setHistory] = useState([]);
  const [restoringId, setRestoringId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [usage, setUsage] = useState(null);
  const [hooks, setHooks] = useState(null);
  const [hooksBusy, setHooksBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [ctx, setCtx] = useState({});
  const [soundPacks, setSoundPacks] = useState([]);

  const prevStatus = useRef({});
  const initialized = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch {}
  }, [settings]);

  // Unlock audio on first gesture
  useEffect(() => {
    const unlock = () => getCtx();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Discover custom sound packs dropped into public/sounds/.
  useEffect(() => {
    let alive = true;
    fetch('/api/sounds')
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d?.ok) return;
        const map = {};
        for (const p of d.packs) map[p.name] = p.sounds;
        setFilePacks(map);
        setSoundPacks(d.packs);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Desktop (Tauri) integration
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    setIsTauri(true);
    (async () => {
      try {
        const { isEnabled } = await import('@tauri-apps/plugin-autostart');
        setLaunchAtLogin(await isEnabled());
      } catch {}
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setAlwaysOnTop(!!settingsRef.current.onTop);
      } catch {}
      // Match the native window to the saved layout on launch.
      applyWindowWidth(!!settingsRef.current.rail);
    })();
  }, []);

  // Chime + native macOS notification on status change. Keyed by chime key
  // (not raw status) so alert KIND changes re-notify with their own sound.
  const handleSessions = useCallback((data) => {
    const cfg = settingsRef.current;
    if (initialized.current) {
      for (const s of data) {
        const key = chimeKeyFor(s);
        if (prevStatus.current[s.id] === key) continue;
        if (cfg.master && cfg.chime[key]) {
          playChime(key, cfg.pack);
          if (navigator.vibrate) navigator.vibrate(s.status === 'alert' ? [120, 60, 120] : 60);
        }
        if (cfg.nativeNotify && (key === 'alert_permission' || key === 'alert_input' || key === 'error')) {
          notifyNative({
            title: `${s.name} — ${CHIME_META[key].label.toLowerCase()}`,
            body: messageFor(s),
            // Respect the master mute: banner still shows, silently.
            sound: cfg.master ? CHIME_META[key].sound : undefined,
            key: `${s.id}:${key}`,
          });
        }
      }
    }
    const map = {};
    for (const s of data) map[s.id] = chimeKeyFor(s);
    prevStatus.current = map;
    initialized.current = true;
    setSessions(data);
  }, []);

  // SSE stream
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('snapshot', (e) => { setConnected(true); handleSessions(JSON.parse(e.data)); });
    es.addEventListener('update', (e) => handleSessions(JSON.parse(e.data)));
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [handleSessions]);

  // Transient error/info banner — server actions used to fail silently.
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const set = (patch) => setSettings((s) => ({ ...s, ...patch }));
  const setChime = (k, v) => setSettings((s) => ({ ...s, chime: { ...s.chime, [k]: v } }));
  const toggleMaster = () => { getCtx(); if (!settings.master) playChime('waiting', settings.pack); set({ master: !settings.master }); };
  const clearEnded = () => fetch('/api/sessions?ended=1', { method: 'DELETE' });
  const clearAll = () => fetch('/api/sessions', { method: 'DELETE' });

  // Jump to the window/app hosting a session (localhost-only server action).
  const focusSession = useCallback(
    (s) => {
      if (!s.focusable) return;
      fetch('/api/focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (!d.ok) showToast(d.error || 'Could not focus that window.');
        })
        .catch(() => showToast('Could not reach the local server.'));
    },
    [showToast]
  );

  // Context-window fill per live session (approximate, from transcript tails).
  const loadCtx = useCallback(() => {
    fetch('/api/context')
      .then((r) => r.json())
      .then((d) => setCtx(d.context || {}))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (screen !== 'board') return;
    loadCtx();
    const id = setInterval(loadCtx, 30000);
    return () => clearInterval(id);
  }, [screen, loadCtx]);

  // Ended-session history
  const loadHistory = useCallback(() => {
    fetch('/api/history')
      .then((r) => r.json())
      .then((d) => setHistory(d.sessions || []))
      .catch(() => {});
  }, []);
  const clearHistory = () => fetch('/api/history', { method: 'DELETE' }).then(loadHistory);
  const restoreSession = (h) => {
    setRestoringId(h.id);
    fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: h.id }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) showToast(d.error || 'Restore failed.');
      })
      .catch(() => showToast('Could not reach the local server.'))
      .finally(() => setTimeout(() => setRestoringId(null), 1400));
  };
  const copyResume = async (h) => {
    try {
      await navigator.clipboard.writeText(`claude --resume ${h.id}`);
      setCopiedId(h.id);
      setTimeout(() => setCopiedId(null), 1400);
    } catch {}
  };

  // Refresh the history list when viewing it, and when a session just ended.
  useEffect(() => {
    if (screen === 'history') loadHistory();
  }, [screen, sessions, loadHistory]);

  // Usage (token windows from transcripts)
  const loadUsage = useCallback(() => {
    fetch('/api/usage')
      .then((r) => r.json())
      .then((d) => setUsage(d.usage || null))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (screen !== 'usage') return;
    loadUsage();
    const id = setInterval(loadUsage, 60000);
    return () => clearInterval(id);
  }, [screen, loadUsage]);

  // Claude Code hook installer
  const loadHooks = useCallback(() => {
    fetch('/api/hooks')
      .then((r) => r.json())
      .then((d) => setHooks(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (screen === 'settings') loadHooks();
  }, [screen, loadHooks]);
  const setHooksInstalled = (method) => {
    setHooksBusy(true);
    fetch('/api/hooks', { method })
      .then((r) => r.json())
      .then((d) => setHooks(d))
      .catch(() => {})
      .finally(() => setHooksBusy(false));
  };

  const toggleLaunch = async () => {
    try {
      const m = await import('@tauri-apps/plugin-autostart');
      if (launchAtLogin) await m.disable(); else await m.enable();
      setLaunchAtLogin(await m.isEnabled());
    } catch {}
  };
  const toggleOnTop = async () => {
    const next = !settings.onTop;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch {}
    set({ onTop: next });
  };

  const visible = settings.showEnded ? sessions : sessions.filter((s) => s.status !== 'ended');
  const alertCount = visible.filter((s) => s.status === 'alert').length;
  // History entries whose session is actually still live on the board — offer
  // "jump to its window" instead of spawning a second `claude --resume`.
  const liveById = new Map(sessions.filter((s) => s.status !== 'ended').map((s) => [s.id, s]));
  const groups = ORDER.map((st) => {
    const list = visible.filter((s) => s.status === st);
    return list.length ? { key: st, meta: STATUS[st], sessions: list } : null;
  }).filter(Boolean);

  const { master } = settings;
  // Rail = collapsed glance mode: a narrow single column of presence dots +
  // names, no paths/messages/gauges. Only meaningful on the board itself.
  const railView = settings.rail && screen === 'board';
  const toggleRail = () => { const next = !settings.rail; set({ rail: next }); applyWindowWidth(next); };

  return (
    <main className={`app${railView ? ' rail' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <BellIcon size={17} />
          {!railView && <span className="title">Paddy Potification</span>}
        </div>
        <div className="spacer" />
        {!railView && alertCount > 0 && (
          <span className="alertpill"><span className="pd" />{alertCount} need{alertCount === 1 ? 's' : ''} you</span>
        )}
        {screen === 'board' && (
          <button className="iconbtn" onClick={toggleRail} title={railView ? 'Expand board' : 'Collapse to rail'}>
            <ChevronsIcon dir={railView ? 'right' : 'left'} />
          </button>
        )}
        <button className="iconbtn" onClick={toggleMaster} title={master ? 'Mute' : 'Unmute'}><BellIcon off={!master} /></button>
        <button className="iconbtn" onClick={() => setScreen(screen === 'usage' ? 'board' : 'usage')} title="Usage"><ActivityIcon /></button>
        <button className="iconbtn" onClick={() => setScreen(screen === 'history' ? 'board' : 'history')} title="Ended sessions"><ClockIcon /></button>
        <button className="iconbtn" onClick={() => setScreen(screen === 'settings' ? 'board' : 'settings')} title="Settings"><Gear /></button>
      </header>

      {screen === 'board' ? (
        <div className="board">
          {groups.length === 0 ? (
            <div className="empty">
              <span className="glyph"><BellIcon size={40} /></span>
              <h2>No active sessions</h2>
              <p>Start a Claude Code session in any terminal and it&rsquo;ll appear here automatically.</p>
            </div>
          ) : (
            groups.map((g) => (
              <section className="group" key={g.key} style={{ '--c': g.meta.color }}>
                <div className="group-head">
                  <span className="ghdot" />
                  <span className="group-title">{g.meta.group}</span>
                  <span className="group-count">{g.sessions.length}</span>
                </div>
                <div className="group-cards">
                  {g.sessions.map((s) => {
                    const isWorking = s.status === 'working' || s.status === 'compacting';
                    const pulse = s.status === 'alert' || s.status === 'error';
                    const isEnded = s.status === 'ended';
                    // actionable/finished states carry a message worth showing
                    const showMsg = !railView && (pulse || isWorking || isEnded || s.status === 'waiting');
                    const focusProps = s.focusable
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          title: `Jump to this session in ${ideName(s.bundleId)}`,
                          onClick: () => focusSession(s),
                          onKeyDown: (e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusSession(s); }
                          },
                        }
                      : {};
                    return (
                      <article key={s.id} className={`card${pulse ? ' pulse' : ''}${s.status === 'ended' ? ' ended' : ''}${s.focusable ? ' focusable' : ''}`} style={{ '--c': metaFor(s.status).color }} {...focusProps}>
                        <span className="dot" />
                        <div className="card-main">
                          <div className="row1">
                            <span className="cname" title={s.cwd}>{s.name}</span>
                            {s.focusable && <span className="openico"><OpenIcon /></span>}
                            <span className="elapsed">{s.status === 'ended' ? `${ago(s.lastSeen, now)} ago` : ago(s.lastSeen, now)}</span>
                          </div>
                          {!railView && <div className="cpath" title={shortDir(s.cwd)}>{locationLabel(s.cwd)}</div>}
                          {showMsg && (
                            <div className="cmsg">
                              {isWorking && <span className="spinner" />}
                              {isEnded && <span className="sid" title={`Session ${s.id}`}>#{s.id.slice(0, 8)}</span>}
                              {messageFor(s)}
                            </div>
                          )}
                          {!railView && !isEnded && ctx[s.id] && (
                            <div
                              className="ctxrow"
                              title={`≈${fmtTokens(ctx[s.id].tokens)} of ${fmtTokens(ctx[s.id].window)} context window (estimate)`}
                            >
                              <span className="ctxbar">
                                <span
                                  className="ctxfill"
                                  style={{ width: `${ctx[s.id].pct}%`, background: ctxColor(ctx[s.id].pct) }}
                                />
                              </span>
                              <span className="ctxpct" style={{ color: ctxColor(ctx[s.id].pct) }}>
                                {ctx[s.id].pct}%
                              </span>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      ) : screen === 'history' ? (
        <div className="settings">
          <div className="set-head">
            <button className="iconbtn" onClick={() => setScreen('board')}><Back /></button>
            <span className="set-title">Ended sessions</span>
            <div className="spacer" />
            {history.length > 0 && <button className="btn sm" onClick={clearHistory}>Clear all</button>}
          </div>
          {history.length === 0 ? (
            <div className="empty">
              <span className="glyph"><ClockIcon size={40} /></span>
              <h2>No ended sessions yet</h2>
              <p>When a Claude Code session ends it&rsquo;s saved here with its summary so you can restore it later.</p>
            </div>
          ) : (
            <div className="histlist">
              {history.map((h) => (
                <article className="histcard" key={h.id}>
                  <div className="histtop">
                    <span className="histtitle" title={h.cwd}>{h.title || h.summary || h.name}</span>
                    <span className="elapsed">{ago(h.endedAt || now, now)} ago</span>
                  </div>
                  <div className="cpath" title={shortDir(h.cwd)}>{locationLabel(h.cwd)}</div>
                  {h.lastPrompt && h.lastPrompt !== (h.title || h.summary) && (
                    <div className="histsub">last: {h.lastPrompt}</div>
                  )}
                  <div className="histfoot">
                    <span className="sid" title={`Session ${h.id}`}>#{h.id.slice(0, 8)}</span>
                    <div className="spacer" />
                    <button className="btn sm" onClick={() => copyResume(h)}>{copiedId === h.id ? 'Copied ✓' : 'Copy'}</button>
                    {(() => {
                      const live = liveById.get(h.id);
                      if (!live) {
                        return (
                          <button className="btn sm primary" onClick={() => restoreSession(h)}>
                            {restoringId === h.id ? 'Opening…' : 'Restore'}
                          </button>
                        );
                      }
                      return live.focusable ? (
                        <button className="btn sm primary" onClick={() => focusSession(live)}>Jump to window</button>
                      ) : (
                        <span className="livehint">still open</span>
                      );
                    })()}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : screen === 'usage' ? (
        <div className="settings">
          <div className="set-head">
            <button className="iconbtn" onClick={() => setScreen('board')}><Back /></button>
            <span className="set-title">Usage</span>
            <div className="spacer" />
            <button className="iconbtn" onClick={loadUsage} title="Refresh"><RefreshIcon /></button>
          </div>
          {!usage ? (
            <div className="empty">
              <span className="glyph"><ActivityIcon size={40} /></span>
              <h2>Reading usage…</h2>
            </div>
          ) : (
            <>
              {[{ k: 'day', label: 'Last 24 hours' }, { k: 'week', label: 'Last 7 days' }].map(({ k, label }) => {
                const b = usage[k].total;
                const models = Object.entries(usage[k].byModel)
                  .filter(([, mb]) => mb.input + mb.output > 0)
                  .sort((a, c) => c[1].input + c[1].output - (a[1].input + a[1].output));
                return (
                  <div key={k}>
                    <span className="set-label">{label}</span>
                    <div className="set-section">
                      <div className="usage-card">
                        <div className="usage-head">
                          <span className="usage-big">{fmtTokens(b.input + b.output)}</span>
                          <span className="usage-unit">in&nbsp;+&nbsp;out tokens · {b.messages} msg</span>
                        </div>
                        <div className="usage-break">
                          <span><b>{fmtTokens(b.input)}</b> in</span>
                          <span><b>{fmtTokens(b.output)}</b> out</span>
                          <span><b>{fmtTokens(b.cacheRead)}</b> cache read</span>
                          <span><b>{fmtTokens(b.cacheCreate)}</b> cache write</span>
                        </div>
                        {models.length > 0 && (
                          <div className="usage-models">
                            {models.map(([m, mb]) => (
                              <div className="usage-model" key={m}>
                                <span className="um-name">{m}</span>
                                <span className="um-tok">{fmtTokens(mb.input + mb.output)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <p className="usage-note">
                Measured from local session transcripts — the same source Claude Code&rsquo;s <code>/usage</code>{' '}
                reads. Approximate, this machine only; not official billing.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="settings">
          <div className="set-head">
            <button className="iconbtn" onClick={() => setScreen('board')}><Back /></button>
            <span className="set-title">Settings</span>
          </div>

          <span className="set-label">Claude Code</span>
          <div className="set-section">
            <div className="set-row">
              <div className="rt">
                <div className="rlabel">
                  Session hooks{hooks?.installed && <span className="ok"> · installed</span>}
                </div>
                <div className="rsub">Lets Paddy see your Claude sessions. Edits ~/.claude/settings.json (backed up first).</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {hooks?.installed ? (
                  <>
                    <button className="btn sm" onClick={() => setHooksInstalled('POST')} disabled={hooksBusy}>Reinstall</button>
                    <button className="btn sm" onClick={() => setHooksInstalled('DELETE')} disabled={hooksBusy}>Remove</button>
                  </>
                ) : (
                  <button className="btn sm primary" onClick={() => setHooksInstalled('POST')} disabled={hooksBusy}>
                    {hooksBusy ? '…' : 'Install'}
                  </button>
                )}
              </div>
            </div>
            <div className="set-note">Start a new Claude Code session (or restart running ones) to pick up the hooks.</div>
          </div>

          <span className="set-label">Sound</span>
          <div className="set-section">
            <div className="set-row">
              <div className="rt"><div className="rlabel">Play sounds</div><div className="rsub">Master switch for all chimes</div></div>
              <Switch on={master} onClick={toggleMaster} />
            </div>
            <div className="set-row">
              <div className="rt"><div className="rlabel">Sound pack</div><div className="rsub">Which chime plays</div></div>
              <select className="pack" value={settings.pack} onChange={(e) => { set({ pack: e.target.value }); playChime('waiting', e.target.value); }}>
                {Object.keys(PACKS).map((p) => <option key={p} value={p}>{p}</option>)}
                {soundPacks.length > 0 && (
                  <optgroup label="Your sounds">
                    {soundPacks.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="set-row">
              <div className="rt">
                <div className="rlabel">macOS notifications</div>
                <div className="rsub">Native banner when a session needs you or errors, each kind with its own sound</div>
              </div>
              <Switch on={!!settings.nativeNotify} onClick={() => set({ nativeNotify: !settings.nativeNotify })} />
            </div>
          </div>

          <span className="set-label">Chime when a session becomes…</span>
          <div className="set-section">
            {CHIME_ORDER.map((k) => (
              <div className="chime-row" key={k} style={{ '--c': CHIME_META[k].color }}>
                <span className="cdot" />
                <span className="clabel">{CHIME_META[k].label}</span>
                <button className="preview" title="Preview" onClick={() => playChime(k, settings.pack)}>▸</button>
                <Switch on={!!settings.chime[k]} onClick={() => setChime(k, !settings.chime[k])} />
              </div>
            ))}
          </div>

          <span className="set-label">Board</span>
          <div className="set-section">
            <div className="set-row">
              <div className="rt"><div className="rlabel">Show ended sessions</div><div className="rsub">Keep finished sessions on the board</div></div>
              <Switch on={settings.showEnded} onClick={() => set({ showEnded: !settings.showEnded })} />
            </div>
            <div className="set-row">
              <div className="rt"><div className="rlabel">Clear sessions</div><div className="rsub">Remove sessions from the board</div></div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn sm" onClick={clearEnded}>Ended</button>
                <button className="btn sm" onClick={clearAll}>All</button>
              </div>
            </div>
          </div>

          {isTauri && (
            <>
              <span className="set-label">App</span>
              <div className="set-section">
                <div className="set-row">
                  <div className="rt"><div className="rlabel">Launch at login</div><div className="rsub">Start Paddy when you log in</div></div>
                  <Switch on={launchAtLogin} onClick={toggleLaunch} />
                </div>
                <div className="set-row">
                  <div className="rt"><div className="rlabel">Keep window on top</div><div className="rsub">Float above other apps</div></div>
                  <Switch on={!!settings.onTop} onClick={toggleOnTop} />
                </div>
              </div>
            </>
          )}

          <div className="set-foot">
            <span className="ver">Paddy Potification v1.0</span>
            <button className="btn sm" onClick={() => setScreen('board')}>Done</button>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      <footer className="statusbar">
        {master ? (
          <><span className="ico"><BellIcon size={13} /></span><span>Chimes on · alerts you when a session needs you</span></>
        ) : (
          <><span className="ico off"><BellIcon size={13} off /></span><span>Sounds muted</span></>
        )}
        <div className="spacer" />
        <span className={`livedot ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting'} />
      </footer>
    </main>
  );
}
