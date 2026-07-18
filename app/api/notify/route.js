import { execFile } from 'node:child_process';
import { isLocalReq } from '../../../lib/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { title, body, sound?, key?, markOnly? } -> native macOS notification
// banner. Runs osascript, so localhost-only. `sound` must be a stock macOS
// alert sound (distinct per alert kind); `key` dedupes when several dashboards
// are open. `markOnly` claims the key without displaying anything — the Tauri
// app uses it, then posts the banner itself so it carries the app icon.

const SOUNDS = new Set([
  'Basso', 'Blow', 'Bottle', 'Frog', 'Funk', 'Glass', 'Hero',
  'Morse', 'Ping', 'Pop', 'Purr', 'Sosumi', 'Submarine', 'Tink',
]);
const asq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const clean = (s, max) =>
  String(s || '')
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Survives dev hot-reloads; entries expire quickly so it stays tiny.
function recent() {
  if (!globalThis.__PADDY_NOTIFY__) globalThis.__PADDY_NOTIFY__ = new Map();
  return globalThis.__PADDY_NOTIFY__;
}
const DEDUPE_MS = 3000;

export async function POST(req) {
  if (!isLocalReq(req)) {
    return Response.json({ ok: false, error: 'localhost only' }, { status: 403 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  const title = clean(body?.title, 80) || 'Paddy Potification';
  const text = clean(body?.body, 160) || 'A session needs you.';
  const sound = SOUNDS.has(body?.sound) ? body.sound : null;
  const key = clean(body?.key, 120);

  if (key) {
    const m = recent();
    const now = Date.now();
    for (const [k, t] of m) if (now - t > DEDUPE_MS) m.delete(k);
    if (m.has(key)) return Response.json({ ok: true, deduped: true });
    m.set(key, now);
  }

  if (body?.markOnly === true) return Response.json({ ok: true, marked: true });

  const script =
    `display notification ${asq(text)} with title ${asq(title)}` +
    (sound ? ` sound name ${asq(sound)}` : '');

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 4000 }, (err) => {
      if (err) {
        resolve(Response.json({ ok: false, error: String(err.message || err) }, { status: 500 }));
      } else {
        resolve(Response.json({ ok: true }));
      }
    });
  });
}
