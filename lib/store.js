// In-memory session store shared across API routes.
// Stashed on globalThis so it survives Next.js dev hot-reloads (one process).

import { saveEnded } from './archive';
import { summarize } from './transcript';

function store() {
  if (!globalThis.__PADDY__) {
    globalThis.__PADDY__ = { sessions: new Map(), listeners: new Set(), reaper: null };
  }
  return globalThis.__PADDY__;
}

function shortName(cwd) {
  if (!cwd) return 'session';
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'session';
}

const RANK = { alert: 0, error: 1, waiting: 2, working: 3, compacting: 4, active: 5, ended: 6 };
const rank = (x) => RANK[x.status] ?? 5;

// Which kind of "needs you" this is — Claude's Notification hook messages are
// stable enough to sniff: permission requests vs. waiting-for-input vs. rest.
// The dashboard gives each kind its own chime + macOS notification sound.
function alertKindFor(status, message) {
  if (status !== 'alert') return '';
  const m = (message || '').toLowerCase();
  if (m.includes('permission')) return 'permission';
  if (m.includes('waiting for your input') || m.includes('waiting for input')) return 'input';
  return 'other';
}

// --- Ghost-session reaping ---
// A working/compacting session fires PreToolUse on every tool call, so silence
// this long almost always means the terminal exited mid-task -> auto-end it.
const WORKING_STALE_MS = 15 * 60 * 1000;
// Resting states (waiting/active/alert/error) legitimately persist; only end
// them once truly abandoned.
const IDLE_STALE_MS = 8 * 60 * 60 * 1000;
// Drop ended sessions after a day so the board doesn't accrete history forever.
const ENDED_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = 60 * 1000;

// Which app hosts a session decides whether we can jump back to its window.
// jetbrains -> focus the exact project window; hyper -> can only bring the app
// forward (Hyper isn't scriptable / exposes no per-tab id).
function focusKindFor(rec) {
  const b = rec.bundleId || '';
  if (b.startsWith('com.jetbrains.')) return 'jetbrains';
  if (b === 'co.zeit.hyper' || rec.termProgram === 'Hyper') return 'hyper';
  return null;
}

export function focusInfo(rec) {
  const focusKind = focusKindFor(rec);
  return { focusKind, focusable: focusKind !== null };
}

// Shape sent to the UI: adds derived focus fields, hides nothing.
function decorate(rec) {
  return { ...rec, ...focusInfo(rec) };
}

export function list() {
  const s = store();
  ensureReaper();
  return [...s.sessions.values()]
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return b.lastSeen - a.lastSeen;
    })
    .map(decorate);
}

export function getById(id) {
  return store().sessions.get(id) || null;
}

export function upsert({
  session_id,
  cwd,
  status,
  event,
  message,
  prompt,
  transcript_path,
  bundle_id,
  term_program,
  term_emulator,
  iterm_session_id,
  tmux_pane,
}) {
  const s = store();
  ensureReaper();
  const now = Date.now();
  const prev = s.sessions.get(session_id);
  const rec = {
    id: session_id,
    cwd: cwd || prev?.cwd || '',
    name: shortName(cwd || prev?.cwd || ''),
    status: status || prev?.status || 'active',
    event: event || '',
    message: message || '',
    alertKind: alertKindFor(status, message),
    // The last user prompt — sticky, so cards can say what the session is on.
    task: prompt || prev?.task || '',
    // Host/terminal identity — sticky across events (only the first hook of a
    // session may carry a given var, so fall back to what we already know).
    transcriptPath: transcript_path || prev?.transcriptPath || '',
    bundleId: bundle_id || prev?.bundleId || '',
    termProgram: term_program || prev?.termProgram || '',
    termEmulator: term_emulator || prev?.termEmulator || '',
    itermSessionId: iterm_session_id || prev?.itermSessionId || '',
    tmuxPane: tmux_pane || prev?.tmuxPane || '',
    lastSeen: now,
    startedAt: prev?.startedAt || now,
  };
  const becameEnded = rec.status === 'ended' && prev?.status !== 'ended';
  s.sessions.set(session_id, rec);
  broadcast();
  if (becameEnded) archive(rec);
  return decorate(rec);
}

// Enrich an ended session with a transcript summary and persist it for the
// History page. Fire-and-forget: it rebroadcasts once the summary lands.
async function archive(rec) {
  let meta = {};
  try {
    meta = await summarize(rec.transcriptPath);
  } catch {
    /* no transcript / unreadable — fall back to whatever we have */
  }
  rec.title = meta.title || rec.title || '';
  rec.summary = meta.summary || rec.summary || rec.message || '';
  rec.lastPrompt = meta.lastPrompt || rec.lastPrompt || '';
  rec.endedAt = rec.endedAt || Date.now();
  saveEnded({
    id: rec.id,
    name: rec.name,
    cwd: rec.cwd,
    bundleId: rec.bundleId,
    termProgram: rec.termProgram,
    transcriptPath: rec.transcriptPath,
    title: rec.title,
    summary: rec.summary,
    lastPrompt: rec.lastPrompt,
    endedAt: rec.endedAt,
  });
  broadcast();
}

export function clear({ id, endedOnly } = {}) {
  const s = store();
  if (id) {
    s.sessions.delete(id);
  } else if (endedOnly) {
    for (const [k, v] of s.sessions) if (v.status === 'ended') s.sessions.delete(k);
  } else {
    s.sessions.clear();
  }
  broadcast();
}

export function subscribe(fn) {
  store().listeners.add(fn);
}
export function unsubscribe(fn) {
  store().listeners.delete(fn);
}

// Auto-end stalled sessions and drop old ended ones. Runs on a timer because a
// dead session emits no further events — nothing else would ever re-evaluate it.
function sweep() {
  const s = store();
  const now = Date.now();
  let changed = false;
  const newlyEnded = [];
  for (const [k, v] of s.sessions) {
    const age = now - v.lastSeen;
    if (v.status === 'ended') {
      if (age > ENDED_TTL_MS) {
        s.sessions.delete(k);
        changed = true;
      }
      continue;
    }
    const working = v.status === 'working' || v.status === 'compacting';
    if (working && age > WORKING_STALE_MS) {
      v.status = 'ended';
      v.message = 'Stalled — no activity, terminal may have exited.';
      v.autoEnded = true;
      v.endedAt = now;
      newlyEnded.push(v);
      changed = true;
    } else if (age > IDLE_STALE_MS) {
      v.status = 'ended';
      v.message = 'Inactive — auto-ended.';
      v.autoEnded = true;
      v.endedAt = now;
      newlyEnded.push(v);
      changed = true;
    }
  }
  if (changed) broadcast();
  for (const v of newlyEnded) archive(v);
}

function ensureReaper() {
  const s = store();
  if (s.reaper) return;
  s.reaper = setInterval(sweep, SWEEP_MS);
  if (s.reaper.unref) s.reaper.unref(); // don't keep the process alive on our own
}

function broadcast() {
  const data = list();
  for (const fn of store().listeners) {
    try {
      fn(data);
    } catch {
      /* ignore dead listeners */
    }
  }
}
