import { hooksStatus, installHooks, uninstallHooks } from '../../../lib/hooks-install';
import { isLocalReq } from '../../../lib/local';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Modifies ~/.claude/settings.json, so localhost-only (never over the LAN).

export async function GET() {
  return Response.json({ ok: true, ...hooksStatus() });
}

export async function POST(req) {
  if (!isLocalReq(req)) return Response.json({ ok: false, error: 'localhost only' }, { status: 403 });
  try {
    return Response.json({ ok: true, ...installHooks() });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!isLocalReq(req)) return Response.json({ ok: false, error: 'localhost only' }, { status: 403 });
  try {
    return Response.json({ ok: true, ...uninstallHooks() });
  } catch (e) {
    return Response.json({ ok: false, error: String(e.message || e) }, { status: 500 });
  }
}
