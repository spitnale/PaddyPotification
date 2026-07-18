#!/usr/bin/env node
// Removes Paddy Potification hooks from ~/.claude/settings.json (backs up first).
// Only removes entries that reference hooks/notify.mjs — your other hooks stay.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
const MARK = 'hooks/notify.mjs';

if (!fs.existsSync(settingsPath)) {
  console.log('Nothing to do — no settings.json found.');
  process.exit(0);
}

let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
  console.error('✗ settings.json is not valid JSON — aborting.');
  process.exit(1);
}

const backup = `${settingsPath}.paddy-backup-${Date.now()}`;
fs.copyFileSync(settingsPath, backup);
console.log('• Backed up settings →', backup);

if (settings.hooks) {
  for (const event of Object.keys(settings.hooks)) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const kept = arr.filter((entry) => {
      const hs = entry && Array.isArray(entry.hooks) ? entry.hooks : [];
      return !hs.some((h) => typeof h?.command === 'string' && h.command.includes(MARK));
    });
    if (kept.length) settings.hooks[event] = kept;
    else delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
}

fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log('✓ Removed Paddy hooks from', settingsPath);
