import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> { ok, packs: [{ name, sounds: { <chimeKey>: '/sounds/<pack>/<file>' } }] }
//
// Lists custom audio packs the user has dropped into public/sounds/. Each
// sub-folder is one pack; inside it, a file named after a chime key (e.g.
// alert_input.mp3) becomes the sound for that status. Anything missing falls
// back to the built-in synth beep, so a partial pack is fine.

const CHIME_KEYS = [
  'alert_permission', 'alert_input', 'error', 'working',
  'waiting', 'compacting', 'active', 'ended',
];
const EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']);

export async function GET() {
  const root = path.join(process.cwd(), 'public', 'sounds');
  const packs = [];

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return Response.json({ ok: true, packs }); // no sounds dir yet
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(root, ent.name));
    } catch {
      continue;
    }
    const sounds = {};
    for (const key of CHIME_KEYS) {
      const match = files.find((f) => {
        const ext = path.extname(f).toLowerCase();
        return EXTS.has(ext) && f.slice(0, -ext.length) === key;
      });
      if (match) {
        sounds[key] = `/sounds/${encodeURIComponent(ent.name)}/${encodeURIComponent(match)}`;
      }
    }
    if (Object.keys(sounds).length) packs.push({ name: ent.name, sounds });
  }

  return Response.json({ ok: true, packs });
}
