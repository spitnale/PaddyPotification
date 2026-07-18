import { list, clear } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ok: true, sessions: list() });
}

// DELETE /api/sessions            -> clear everything
// DELETE /api/sessions?ended=1    -> clear only ended sessions
// DELETE /api/sessions?id=abc     -> clear one session
export async function DELETE(req) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id');
  const endedOnly = u.searchParams.get('ended') === '1';
  clear({ id: id || undefined, endedOnly });
  return Response.json({ ok: true });
}
