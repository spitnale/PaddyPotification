import { list } from '../../../lib/store';
import { contextFor } from '../../../lib/context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> { context: { [sessionId]: { tokens, window, pct, model } } }
// Context-window fill for every live session with a known transcript.
export async function GET() {
  const live = list().filter((s) => s.status !== 'ended' && s.transcriptPath);
  const entries = await Promise.all(
    live.map(async (s) => [s.id, await contextFor(s.transcriptPath)])
  );
  const context = Object.fromEntries(entries.filter(([, v]) => v));
  return Response.json({ ok: true, context });
}
