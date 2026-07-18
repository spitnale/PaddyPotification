#!/usr/bin/env node
// Claude Code hook -> Paddy Potification status reporter.
//
// Wired into ~/.claude/settings.json by scripts/install-hooks.mjs.
// Reads the hook JSON payload from stdin and POSTs a status to the dashboard.
// Designed to NEVER block or fail a Claude session (always exits 0, short timeout).
//
//   node notify.mjs <status>     e.g. alert | working | waiting | active | ended
//
// Override the target with PADDY_URL (default http://127.0.0.1:4747).

import http from 'node:http';

const status = process.argv[2] || 'active';
const base = process.env.PADDY_URL || 'http://127.0.0.1:4747';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => send(raw));
process.stdin.on('error', () => send(raw));

// Hard safety net: never let the hook hang the session.
const bail = setTimeout(() => process.exit(0), 1500);

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Short human label for what a tool call is touching: a file basename, the
// shell command, a search pattern… whatever the payload offers first.
function toolDetail(input) {
  if (!input || typeof input !== 'object') return '';
  const file = input.file_path || input.path || input.notebook_path;
  if (file) return String(file).split('/').pop();
  for (const k of ['command', 'description', 'pattern', 'query', 'url', 'skill', 'prompt']) {
    if (input[k]) return oneLine(input[k]).slice(0, 60);
  }
  return '';
}

function send(data) {
  let payload = {};
  try {
    payload = JSON.parse(data || '{}');
  } catch {
    /* payload stays empty */
  }
  // Build a human message. PostToolUseFailure carries tool_name + `error`
  // (description) / `tool_output` (failure message); fall back as needed.
  let message = payload.message || '';
  if (status === 'working') {
    if (payload.hook_event_name === 'UserPromptSubmit' && payload.prompt) {
      message = oneLine(payload.prompt);
    } else if (payload.hook_event_name === 'PreToolUse' && payload.tool_name) {
      const d = toolDetail(payload.tool_input);
      message = payload.tool_name + (d ? ': ' + d : '');
    }
  }
  if (!message && status === 'error') {
    const tool = payload.tool_name || '';
    const err = (payload.error || payload.tool_output || '').toString().replace(/\s+/g, ' ').trim();
    message = tool ? `${tool} failed${err ? `: ${err}` : ''}` : err || 'A tool call failed.';
  }
  if (message.length > 160) message = message.slice(0, 159) + '…';

  const body = JSON.stringify({
    status,
    session_id: payload.session_id || 'unknown',
    cwd: payload.cwd || '',
    event: payload.hook_event_name || '',
    message,
    // The last thing the user asked for — sticky on the dashboard, so cards
    // can say WHAT a session is working on / finished, not just that it is.
    prompt:
      payload.hook_event_name === 'UserPromptSubmit' ? oneLine(payload.prompt).slice(0, 200) : '',
    transcript_path: payload.transcript_path || '',
    // Terminal/host identity, inherited from the session's environment, so the
    // dashboard can jump back to the exact window. __CFBundleIdentifier is the
    // hosting macOS app (e.g. com.jetbrains.WebStorm inside a JediTerm shell);
    // the rest are for iTerm/tmux support later.
    bundle_id: process.env.__CFBundleIdentifier || '',
    term_program: process.env.TERM_PROGRAM || '',
    term_emulator: process.env.TERMINAL_EMULATOR || '',
    iterm_session_id: process.env.ITERM_SESSION_ID || '',
    tmux_pane: process.env.TMUX_PANE || '',
  });

  let url;
  try {
    url = new URL(base);
  } catch {
    clearTimeout(bail);
    process.exit(0);
  }

  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: '/api/status',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 1200,
    },
    (res) => {
      res.resume();
      res.on('end', () => {
        clearTimeout(bail);
        process.exit(0);
      });
    }
  );
  req.on('error', () => {
    clearTimeout(bail);
    process.exit(0);
  });
  req.on('timeout', () => {
    req.destroy();
    clearTimeout(bail);
    process.exit(0);
  });
  req.write(body);
  req.end();
}
