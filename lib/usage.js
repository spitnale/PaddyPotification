// Token-usage aggregation from local Claude Code transcripts — the same source
// the official `/usage` command reads (it also computes from local session
// history). Rolling 24h and 7d windows, broken down by model. Not billing.

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const DAY = 86400000;
const CACHE_MS = 30000; // transcripts don't change fast; avoid rescanning each poll

let cache = { at: 0, data: null };

function emptyBucket() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, messages: 0 };
}
function add(b, u) {
  b.input += u.input_tokens || 0;
  b.output += u.output_tokens || 0;
  b.cacheRead += u.cache_read_input_tokens || 0;
  b.cacheCreate += u.cache_creation_input_tokens || 0;
  b.messages += 1;
}

async function recentFiles(sinceMs) {
  const out = [];
  let dirs;
  try {
    dirs = await fsp.readdir(PROJECTS, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = path.join(PROJECTS, d.name);
    let files;
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      try {
        // A file last written before the window can't hold in-window messages.
        const st = await fsp.stat(fp);
        if (st.mtimeMs >= sinceMs) out.push(fp);
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

export async function computeUsage(now) {
  if (cache.data && now - cache.at < CACHE_MS) return cache.data;

  const since7d = now - 7 * DAY;
  const since24h = now - DAY;
  const files = await recentFiles(since7d);

  const day = emptyBucket();
  const week = emptyBucket();
  const dayModels = {};
  const weekModels = {};
  let lastActivity = 0;

  for (const fp of files) {
    let raw;
    try {
      raw = await fsp.readFile(fp, 'utf8');
    } catch {
      continue;
    }
    for (const line of raw.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      let o;
      try {
        o = JSON.parse(s);
      } catch {
        continue;
      }
      if (o.type !== 'assistant') continue;
      const u = o.message?.usage;
      if (!u) continue;
      const ts = Date.parse(o.timestamp || '');
      if (!ts || ts < since7d) continue;
      const model = o.message?.model || 'unknown';
      if (model === '<synthetic>') continue; // Claude's internal 0-token messages
      if (ts > lastActivity) lastActivity = ts;

      add(week, u);
      if (!weekModels[model]) weekModels[model] = emptyBucket();
      add(weekModels[model], u);
      if (ts >= since24h) {
        add(day, u);
        if (!dayModels[model]) dayModels[model] = emptyBucket();
        add(dayModels[model], u);
      }
    }
  }

  const data = {
    now,
    day: { window: '24h', total: day, byModel: dayModels },
    week: { window: '7d', total: week, byModel: weekModels },
    lastActivity: lastActivity || null,
    scannedFiles: files.length,
  };
  cache = { at: now, data };
  return data;
}
