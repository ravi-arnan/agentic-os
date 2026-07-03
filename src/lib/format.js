export function fmtMoney(n) {
  if (n == null) return '·';
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function fmtTokens(n) {
  if (n == null) return '·';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export function fmtAgo(ts) {
  if (!ts) return 'never';
  const ms = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function fmtDuration(ms) {
  if (ms == null) return '·';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function shortPath(p) {
  if (!p) return '';
  return String(p).replace(/^\/home\/[^/]+\/Projects\//, '').replace(/^\/home\/[^/]+/, '~');
}

/** Stable display color per model family. */
export function modelColor(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('fable')) return 'var(--color-success)';
  if (m.includes('opus')) return 'var(--color-violet)';
  if (m.includes('sonnet')) return 'var(--color-cyan)';
  if (m.includes('haiku')) return 'var(--color-warn)';
  return 'var(--color-faint)';
}

export function shortModel(model) {
  const m = String(model || '');
  const match = m.match(/(fable|opus|sonnet|haiku)[-\s]?([\d.-]*)/i);
  if (!match) return m;
  return `${match[1]}${match[2] ? ' ' + match[2].replace(/-/g, '.') : ''}`.trim();
}
