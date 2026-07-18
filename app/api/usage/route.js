import { computeUsage } from '../../../lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const usage = await computeUsage(Date.now());
  return Response.json({ ok: true, usage });
}
