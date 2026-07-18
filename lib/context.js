// Estimates a session's context-window fill from its transcript.
// The last assistant message's usage block IS the current context: what was
// sent (input + cache read + cache write) plus what came back (output). Only
// the file tail is read — transcripts grow to many MB — and results are cached
// by mtime+size so polling costs a stat() per session.

import fs from 'node:fs/promises';

const TAIL_BYTES = 256 * 1024;

// Window sizes are an estimate: 1M for explicit long-context variants,
// otherwise the standard 200k. There's no authoritative per-model source on
// disk, so the UI labels this as approximate.
function windowFor(model) {
  return /\b1m\b|\[1m\]/i.test(model || '') ? 1_000_000 : 200_000;
}

function store() {
  if (!globalThis.__PADDY_CTX__) globalThis.__PADDY_CTX__ = new Map();
  return globalThis.__PADDY_CTX__; // path -> { mtimeMs, size, data }
}

export async function contextFor(transcriptPath) {
  if (!transcriptPath) return null;
  let st;
  try {
    st = await fs.stat(transcriptPath);
  } catch {
    return null;
  }
  const cache = store();
  const hit = cache.get(transcriptPath);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.data;

  let fh;
  let text = '';
  try {
    fh = await fs.open(transcriptPath, 'r');
    const start = Math.max(0, st.size - TAIL_BYTES);
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    text = buf.toString('utf8');
  } catch {
    return null;
  } finally {
    await fh?.close();
  }

  let data = null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s) continue;
    let o;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    // Sidechain lines are subagents with their own (smaller) context — skip.
    if (o.type !== 'assistant' || o.isSidechain) continue;
    const u = o.message?.usage;
    const model = o.message?.model || '';
    if (!u || model === '<synthetic>') continue;
    const tokens =
      (u.input_tokens || 0) +
      (u.cache_read_input_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.output_tokens || 0);
    const window = windowFor(model);
    data = { tokens, window, pct: Math.min(100, Math.round((tokens / window) * 100)), model };
    break;
  }

  cache.set(transcriptPath, { mtimeMs: st.mtimeMs, size: st.size, data });
  if (cache.size > 300) {
    for (const k of cache.keys()) {
      if (cache.size <= 150) break;
      cache.delete(k);
    }
  }
  return data;
}
