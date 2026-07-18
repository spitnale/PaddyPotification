import { upsert } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called by the Claude Code hook (hooks/notify.mjs) on every session event.
export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {
    /* keep body empty */
  }
  const {
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
  } = body || {};
  if (!session_id || !status) {
    return Response.json({ ok: false, error: 'session_id and status required' }, { status: 400 });
  }
  const session = upsert({
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
  });
  return Response.json({ ok: true, session });
}

// Convenience for testing in a browser:
//   /api/status?session_id=demo&status=alert&cwd=/Users/me/Sites/Foo
export async function GET(req) {
  const u = new URL(req.url);
  const session_id = u.searchParams.get('session_id');
  const status = u.searchParams.get('status');
  if (!session_id || !status) {
    return Response.json({ ok: false, error: 'session_id and status required' }, { status: 400 });
  }
  const session = upsert({
    session_id,
    status,
    cwd: u.searchParams.get('cwd') || '',
    event: u.searchParams.get('event') || 'manual',
    message: u.searchParams.get('message') || '',
    bundle_id: u.searchParams.get('bundle_id') || '',
  });
  return Response.json({ ok: true, session });
}
