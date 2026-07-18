#!/usr/bin/env node
// Registers Paddy Potification status hooks into ~/.claude/settings.json.
//
// Safe & idempotent:
//   - backs up settings.json before touching it
//   - only adds/replaces OUR hook entries (identified by the notify.mjs path)
//   - leaves any of your other hooks untouched
//
// Run:  npm run install-hooks     (undo with: npm run uninstall-hooks)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(here, '..');
const notify = path.join(projectDir, 'hooks', 'notify.mjs');
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

const MARK = 'hooks/notify.mjs'; // how we recognize our own entries
const cmd = (status) => `node "${notify}" ${status}`;

// Claude Code event -> Paddy status. PreToolUse uses a tool matcher; the rest don't.
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

let settings = {};
if (fs.existsSync(settingsPath)) {
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    console.error(`✗ ${settingsPath} is not valid JSON — aborting so nothing is damaged.`);
    process.exit(1);
  }
  const backup = `${settingsPath}.paddy-backup-${Date.now()}`;
  fs.copyFileSync(settingsPath, backup);
  console.log('• Backed up existing settings →', backup);
} else {
  console.log('• No existing settings.json — creating a fresh one.');
}

settings.hooks = settings.hooks || {};

for (const { event, status, matcher } of MAP) {
  const existing = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  // Drop any prior Paddy entries so re-running stays clean.
  const kept = existing.filter((entry) => {
    const hs = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
    return !hs.some((h) => typeof h?.command === 'string' && h.command.includes(MARK));
  });
  const entry = matcher
    ? { matcher: '*', hooks: [{ type: 'command', command: cmd(status), timeout: 5 }] }
    : { hooks: [{ type: 'command', command: cmd(status), timeout: 5 }] };
  kept.push(entry);
  settings.hooks[event] = kept;
}

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

console.log('✓ Installed Paddy hooks into', settingsPath);
console.log('  ' + MAP.map((m) => `${m.event}→${m.status}`).join('  '));
console.log('  Reporter:', notify);
console.log('\nNote: open a NEW Claude Code session (or restart existing ones) to pick up the hooks.');
