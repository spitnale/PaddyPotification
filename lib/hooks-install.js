// Install/uninstall the Paddy Claude Code hooks from within the app, so the
// packaged .dmg is self-sufficient (no repo / npm run install-hooks needed).
//
// The installed hook command uses the app's own bundled Node (process.execPath)
// and a reporter written to ~/.paddy-potification/notify.mjs, so it resolves on
// any machine the app is installed on.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NOTIFY_SOURCE } from './hookScript';

const HOME = os.homedir();
const SETTINGS = path.join(HOME, '.claude', 'settings.json');
const PADDY_DIR = path.join(HOME, '.paddy-potification');
const NOTIFY = path.join(PADDY_DIR, 'notify.mjs');
const MARK = 'notify.mjs'; // recognizes our entries (repo- or app-installed)

// Claude Code event -> Paddy status. Must match scripts/install-hooks.mjs.
const MAP = [
  { event: 'SessionStart', status: 'active', matcher: false },
  { event: 'UserPromptSubmit', status: 'working', matcher: false },
  { event: 'PreToolUse', status: 'working', matcher: true },
  { event: 'PostToolUseFailure', status: 'error', matcher: true },
  { event: 'Notification', status: 'alert', matcher: false },
  { event: 'PreCompact', status: 'compacting', matcher: false },
  { event: 'Stop', status: 'waiting', matcher: false },
  { event: 'SessionEnd', status: 'ended', matcher: false },
];

const nodeBin = () => process.execPath || 'node';
const cmd = (status) => `"${nodeBin()}" "${NOTIFY}" ${status}`;
const isOurs = (entry) =>
  Array.isArray(entry?.hooks) &&
  entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes(MARK));

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  } catch {
    return null; // missing or invalid
  }
}

export function hooksStatus() {
  const s = readSettings();
  let installed = false;
  if (s && s.hooks) {
    for (const arr of Object.values(s.hooks)) {
      if (Array.isArray(arr) && arr.some(isOurs)) installed = true;
    }
  }
  return { installed, notifyPath: NOTIFY, node: nodeBin(), settings: SETTINGS };
}

export function installHooks() {
  fs.mkdirSync(PADDY_DIR, { recursive: true });
  fs.writeFileSync(NOTIFY, NOTIFY_SOURCE);

  let settings = {};
  if (fs.existsSync(SETTINGS)) {
    const parsed = readSettings();
    if (parsed === null) throw new Error(`${SETTINGS} is not valid JSON — not touching it.`);
    settings = parsed;
    fs.copyFileSync(SETTINGS, `${SETTINGS}.paddy-backup-${Date.now()}`);
  } else {
    fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  }

  settings.hooks = settings.hooks || {};
  for (const { event, status, matcher } of MAP) {
    const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = existing.filter((e) => !isOurs(e)); // drop prior Paddy entries
    const entry = matcher
      ? { matcher: '*', hooks: [{ type: 'command', command: cmd(status), timeout: 5 }] }
      : { hooks: [{ type: 'command', command: cmd(status), timeout: 5 }] };
    kept.push(entry);
    settings.hooks[event] = kept;
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  return hooksStatus();
}

export function uninstallHooks() {
  if (!fs.existsSync(SETTINGS)) return hooksStatus();
  const settings = readSettings();
  if (settings === null) throw new Error(`${SETTINGS} is not valid JSON — not touching it.`);
  fs.copyFileSync(SETTINGS, `${SETTINGS}.paddy-backup-${Date.now()}`);

  const hooks = settings.hooks || {};
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    hooks[event] = hooks[event].filter((e) => !isOurs(e));
    if (hooks[event].length === 0) delete hooks[event];
  }
  settings.hooks = hooks;
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  return hooksStatus();
}
