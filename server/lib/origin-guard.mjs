/**
 * Refuse state-changing requests that a foreign web page sent on the user's
 * behalf.
 *
 * The server binds loopback and is reached over Tailscale, which sounds
 * private but is not: any site the user has open can POST to
 * http://127.0.0.1:4177 from their browser. Nothing here reads a response
 * (no CORS headers are sent), but the side effect already happened, and the
 * side effect is a headless Claude Code run with --permission-mode acceptEdits
 * and write tools on the vault. Four of the five skills take no input, so a
 * bare POST with no body is enough to start one.
 *
 * A page cannot forge the Origin header, so comparing it to the host the
 * request was actually addressed to is enough. Requests without an Origin are
 * allowed: curl and the systemd health checks send none, and a browser always
 * sends one on a cross-origin POST.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function hostname(host) {
  return String(host || '').split(':')[0].toLowerCase();
}

/**
 * @returns {boolean} whether the request may proceed.
 */
export function isRequestAllowed({ method, origin, host }) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  if (!origin) return true; // not a browser

  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false; // unparseable Origin is not something to trust
  }

  if (originHost.toLowerCase() === String(host || '').toLowerCase()) return true;

  // The dev server proxies /api with changeOrigin, so Host becomes
  // localhost:4177 while Origin stays localhost:4173 and the ports never
  // match. Any loopback origin is therefore accepted; a hostile site on the
  // public internet cannot present one.
  return LOOPBACK.has(hostname(originHost)) && LOOPBACK.has(hostname(host));
}

export function originGuard(req, res, next) {
  if (isRequestAllowed({ method: req.method, origin: req.get('origin'), host: req.get('host') })) {
    return next();
  }
  res.status(403).json({ error: 'cross-site request refused' });
}
