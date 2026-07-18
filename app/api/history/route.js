import { listArchive, removeArchived } from '../../../lib/archive';
import { focusInfo } from '../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> persisted ended sessions (newest first), each with focus/restore hints.
export async function GET() {
  const sessions = listArchive().map((s) => ({ ...s, ...focusInfo(s) }));
  return Response.json({ ok: true, sessions });
}

// DELETE /api/history          -> clear all history
// DELETE /api/history?id=abc   -> remove one
export async function DELETE(req) {
  const u = new URL(req.url);
  const id = u.searchParams.get('id');
  removeArchived({ id: id || undefined });
  return Response.json({ ok: true });
}
