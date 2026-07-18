// Persistent archive of ended sessions, so the History page survives server
// restarts (the live session store is in-memory only). Stored under the user's
// home so it resolves the same in `npm run dev` and inside the bundled app.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), '.paddy-potification');
const FILE = path.join(DIR, 'ended-sessions.json');
const MAX = 300; // keep the most recent N; older ones fall off

function readAll() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(items.slice(0, MAX), null, 2));
  } catch {
    /* best-effort; never throw into a request */
  }
}

export function listArchive() {
  return readAll().sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
}

export function getArchived(id) {
  return readAll().find((x) => x.id === id) || null;
}

// De-dupe by id, newest first.
export function saveEnded(rec) {
  if (!rec || !rec.id) return;
  const items = readAll().filter((x) => x.id !== rec.id);
  items.unshift(rec);
  writeAll(items);
}

export function removeArchived({ id } = {}) {
  if (id) writeAll(readAll().filter((x) => x.id !== id));
  else writeAll([]);
}
