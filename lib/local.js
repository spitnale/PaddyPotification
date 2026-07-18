// Guard for API routes that run local commands or edit local files.
// Two checks: the request must target a loopback host (blocks the LAN/Bonjour
// launcher), and if a browser sent an Origin it must be loopback too (blocks a
// malicious web page doing cross-site fetch()es at 127.0.0.1:3000).

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalReq(req) {
  const host = (req.headers.get('host') || '').replace(/:\d+$/, '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      if (!LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}
