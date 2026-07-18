// Derives a human summary of a Claude Code session from its transcript .jsonl.
// The transcript path arrives via the hook (payload.transcript_path).
//
// Preference order for the headline: the `ai-title` record (the same title
// Claude's /resume picker shows) -> first user prompt -> last prompt.

import fs from 'node:fs/promises';

const CMD_BLOCK = /<command-[a-z-]+>[^]*?<\/command-[a-z-]+>/gi;
const CMD_TAG = /<\/?command-[a-z-]+>/gi;

function clean(s = '') {
  return String(s)
    .replace(CMD_BLOCK, ' ')
    .replace(CMD_TAG, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (const part of c) if (part?.type === 'text' && part.text) return part.text;
  }
  return '';
}

export async function summarize(transcriptPath) {
  if (!transcriptPath) return {};
  let raw;
  try {
    raw = await fs.readFile(transcriptPath, 'utf8');
  } catch {
    return {};
  }

  let title = null;
  let lastPrompt = null;
  let firstUser = null;

  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    switch (o.type) {
      case 'ai-title':
        // Claude stores the resume-picker title under `aiTitle` (last wins as
        // it gets refined through the session); tolerate `title` too.
        if (o.aiTitle) title = o.aiTitle;
        else if (o.title) title = o.title;
        break;
      case 'summary': // older transcript format
        if (!title && o.summary) title = o.summary;
        break;
      case 'last-prompt':
        if (o.lastPrompt) lastPrompt = o.lastPrompt;
        break;
      case 'user':
        if (firstUser === null) {
          const x = clean(textOf(o.message));
          if (x) firstUser = x;
        }
        break;
    }
  }

  const headline = title || firstUser || clean(lastPrompt || '') || '';
  return {
    title: (title || '').slice(0, 200),
    summary: headline.slice(0, 200),
    lastPrompt: clean(lastPrompt || '').slice(0, 200),
  };
}
