import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { getById } from '../../../lib/store';
import { isLocalReq } from '../../../lib/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function run(cmd, args, okMeta) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 4000 }, (err) => {
      if (err) {
        resolve(Response.json({ ok: false, error: String(err.message || err) }, { status: 500 }));
      } else {
        resolve(Response.json({ ok: true, ...okMeta }));
      }
    });
  });
}

function exec(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => {
      resolve(err ? null : String(stdout || '').trim());
    });
  });
}

// Resolve a JetBrains IDE's command-line launcher binary from its bundle id.
// This is the `Contents/MacOS/<exec>` inside the .app (e.g. `webstorm`,
// `idea`) — the same binary the Toolbox shell launchers invoke. Unlike
// `open -b <bundle> <folder>` (a LaunchServices open-document event, which
// makes JetBrains spawn a NEW project frame), running this binary with the
// project path forwards to the already-running instance and focuses the
// existing project window.
async function jetBrainsLauncher(bundle) {
  const appPath = await exec('mdfind', [`kMDItemCFBundleIdentifier == '${bundle}'`]);
  const app = (appPath || '').split('\n').find((p) => p.endsWith('.app'));
  if (!app || !fs.existsSync(app)) return null;
  const exe = await exec('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    `${app}/Contents/Info.plist`,
  ]);
  if (!exe) return null;
  const bin = `${app}/Contents/MacOS/${exe}`;
  return fs.existsSync(bin) ? bin : null;
}

// POST { id } -> bring the window/app hosting that session to the front.
//
// The command is assembled ONLY from values we stored ourselves (set by our own
// hook), never from raw request input, and is run via execFile (no shell), so a
// crafted body cannot inject a command.
export async function POST(req) {
  if (!isLocalReq(req)) {
    return Response.json({ ok: false, error: 'localhost only' }, { status: 403 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    /* empty body */
  }
  const id = body?.id;
  if (!id) return Response.json({ ok: false, error: 'id required' }, { status: 400 });

  const rec = getById(id);
  if (!rec) return Response.json({ ok: false, error: 'unknown session' }, { status: 404 });

  const bundle = rec.bundleId || '';
  const cwd = rec.cwd || '';

  // JetBrains IDEs (WebStorm/PhpStorm/…): open the project through the IDE's
  // own CLI launcher so it reuses and focuses the already-open project window,
  // via the running instance — rather than spawning a new blank frame. Mirrors
  // the JetBrains Toolbox launcher: `open -na <launcher-binary> --args <path>`.
  const isJetBrains = /^com\.jetbrains\.[A-Za-z0-9]+$/.test(bundle);
  const cwdOk = cwd.startsWith('/') && !cwd.includes('\0') && fs.existsSync(cwd);

  if (isJetBrains && cwdOk) {
    const launcher = await jetBrainsLauncher(bundle);
    if (launcher) {
      return run('open', ['-na', launcher, '--args', cwd], {
        focused: 'jetbrains',
        app: bundle,
        cwd,
      });
    }
    // Fallback if the launcher can't be resolved (Spotlight off, odd install):
    // at least bring the app forward.
    return run('open', ['-b', bundle, cwd], { focused: 'jetbrains', app: bundle, cwd });
  }

  // Hyper isn't scriptable and exposes no per-tab id, so the best we can do is
  // bring the app forward — not select the exact tab.
  if (bundle === 'co.zeit.hyper' || rec.termProgram === 'Hyper') {
    return run('open', ['-b', 'co.zeit.hyper'], { focused: 'hyper', app: 'co.zeit.hyper' });
  }

  return Response.json(
    { ok: false, error: 'This session has no focusable window on this machine.', focusKind: null },
    { status: 422 }
  );
}
