// The status-reporter script the in-app installer writes to disk. It's a
// self-contained mirror of hooks/notify.mjs, written with plain string
// concatenation (no template literals) so it embeds cleanly here.
// Keep this in sync with hooks/notify.mjs if that changes.

export const NOTIFY_SOURCE = `#!/usr/bin/env node
// Paddy Potification status reporter (installed by the in-app hook installer).
import http from 'node:http';

const status = process.argv[2] || 'active';
const base = process.env.PADDY_URL || 'http://127.0.0.1:4747';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => send(raw));
process.stdin.on('error', () => send(raw));
const bail = setTimeout(() => process.exit(0), 1500);

const oneLine = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

function toolDetail(input) {
  if (!input || typeof input !== 'object') return '';
  const file = input.file_path || input.path || input.notebook_path;
  if (file) return String(file).split('/').pop();
  const keys = ['command', 'description', 'pattern', 'query', 'url', 'skill', 'prompt'];
  for (const k of keys) {
    if (input[k]) return oneLine(input[k]).slice(0, 60);
  }
  return '';
}

function send(data) {
  let payload = {};
  try { payload = JSON.parse(data || '{}'); } catch (e) {}
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
    const err = (payload.error || payload.tool_output || '').toString().replace(/\\s+/g, ' ').trim();
    message = tool ? (tool + ' failed' + (err ? ': ' + err : '')) : (err || 'A tool call failed.');
  }
  if (message.length > 160) message = message.slice(0, 159) + '…';

  const body = JSON.stringify({
    status: status,
    session_id: payload.session_id || 'unknown',
    cwd: payload.cwd || '',
    event: payload.hook_event_name || '',
    message: message,
    prompt: payload.hook_event_name === 'UserPromptSubmit' ? oneLine(payload.prompt).slice(0, 200) : '',
    transcript_path: payload.transcript_path || '',
    bundle_id: process.env.__CFBundleIdentifier || '',
    term_program: process.env.TERM_PROGRAM || '',
    term_emulator: process.env.TERMINAL_EMULATOR || '',
    iterm_session_id: process.env.ITERM_SESSION_ID || '',
    tmux_pane: process.env.TMUX_PANE || '',
  });

  let url;
  try { url = new URL(base); } catch (e) { clearTimeout(bail); process.exit(0); }

  const req = http.request({
    hostname: url.hostname,
    port: url.port || 80,
    path: '/api/status',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    timeout: 1200,
  }, (res) => { res.resume(); res.on('end', () => { clearTimeout(bail); process.exit(0); }); });
  req.on('error', () => { clearTimeout(bail); process.exit(0); });
  req.on('timeout', () => { req.destroy(); clearTimeout(bail); process.exit(0); });
  req.write(body);
  req.end();
}
`;
