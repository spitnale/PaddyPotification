import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { getById } from '../../../lib/store';
import { getArchived } from '../../../lib/archive';
import { isLocalReq } from '../../../lib/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Claude session ids are UUIDs; enforce that so nothing else reaches the shell.
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const shq = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`; // POSIX single-quote
const asq = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; // AppleScript string

// POST { id } -> resume an ended session in a fresh Terminal.app window.
//
// Terminal.app is used because it's the only common macOS terminal that's
// AppleScript-scriptable (Hyper/JetBrains can't be handed a command to run).
// The shell line is built only from a validated UUID and an existing absolute
// path, then quoted for both shell and AppleScript.
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
  const id = body?.id;
  if (!id) return Response.json({ ok: false, error: 'id required' }, { status: 400 });

  // If this session is still live on the board, resuming it in a second
  // terminal would have two Claudes writing the same conversation — refuse,
  // and let the UI steer the user to its window instead.
  const live = getById(id);
  if (live && live.status !== 'ended') {
    return Response.json(
      { ok: false, stillRunning: true, error: 'Session is still open — jump to its window instead.' },
      { status: 409 }
    );
  }

  const rec = live || getArchived(id);
  const sid = rec?.id || id;
  if (!UUID.test(sid)) {
    return Response.json({ ok: false, error: 'session id is not resumable' }, { status: 422 });
  }

  const cwd = rec?.cwd || '';
  const cwdOk = cwd.startsWith('/') && !cwd.includes('\0') && fs.existsSync(cwd);
  const cd = cwdOk ? `cd ${shq(cwd)} && ` : '';
  const shell = `${cd}claude --resume ${sid}`;
  const script = `tell application "Terminal"\n  activate\n  do script ${asq(shell)}\nend tell`;

  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 6000 }, (err) => {
      if (err) {
        resolve(Response.json({ ok: false, error: String(err.message || err) }, { status: 500 }));
      } else {
        resolve(Response.json({ ok: true, restored: sid, cwd: cwdOk ? cwd : null }));
      }
    });
  });
}
