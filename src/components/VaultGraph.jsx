import { useEffect, useMemo, useRef, useState } from 'react';

const W = 1200;
const H = 760;

// deterministic pseudo-random in [0,1) so the layout is stable across reloads
const rnd = (seed) => {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Obsidian-style force-directed graph. Hand-rolled sim (fine for a few hundred
 * notes): repulsion + link springs + gravity, cooled by alpha. Drag the
 * background to pan, scroll to zoom (anchored to centre), drag a node to move
 * it. Hover highlights a node and its neighbours.
 * ponytail: O(n²) repulsion; swap for a Barnes-Hut quadtree only if the vault
 * grows past ~1k notes and settling stutters.
 */
export default function VaultGraph({ graph }) {
  const nodes = graph?.nodes;
  const edges = graph?.edges;

  const { pos, links, adjacency } = useMemo(() => {
    const list = nodes || [];
    const index = new Map(list.map((n, i) => [n.id, i]));
    // scatter across the middle of the canvas — never a tight cluster, so no
    // near-zero distances to make repulsion explode
    const pos = list.map((_, i) => ({
      x: W * 0.15 + rnd(i + 1) * W * 0.7,
      y: H * 0.15 + rnd(i + 31) * H * 0.7,
      vx: 0,
      vy: 0,
    }));
    const links = (edges || [])
      .map((e) => ({ s: index.get(e.source), t: index.get(e.target) }))
      .filter((l) => l.s != null && l.t != null);
    const adjacency = list.map(() => new Set());
    for (const l of links) {
      adjacency[l.s].add(l.t);
      adjacency[l.t].add(l.s);
    }
    return { pos, links, adjacency };
  }, [nodes, edges]);

  const [, tick] = useState(0);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const posRef = useRef(pos);
  posRef.current = pos;
  const viewRef = useRef(view);
  viewRef.current = view;
  const alphaRef = useRef(1);
  const svgRef = useRef(null);
  const pan = useRef(null); // background pan gesture
  const dragging = useRef(null); // { i } node being dragged

  // convert a screen point to graph-local coordinates
  const toLocal = (clientX, clientY) => {
    const r = svgRef.current.getBoundingClientRect();
    const vx = (clientX - r.left) * (W / r.width);
    const vy = (clientY - r.top) * (H / r.height);
    const v = viewRef.current;
    return { x: (vx - v.x) / v.k, y: (vy - v.y) / v.k };
  };

  // graph data changed — drop stale hover/drag indices before they crash render
  useEffect(() => {
    setHover(null);
    dragging.current = null;
    pan.current = null;
  }, [pos]);

  // simulation — persistent rAF that idles once cooled, re-heats on drag
  useEffect(() => {
    if (!pos.length) return;
    alphaRef.current = 1;
    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const a = alphaRef.current;
      const drag = dragging.current;
      if (a < 0.02 && !drag) return; // settled, nothing to do

      const p = posRef.current;
      const n = p.length;
      for (let i = 0; i < n; i++) {
        if (!p[i]) continue;
        for (let j = i + 1; j < n; j++) {
          let dx = p[i].x - p[j].x;
          let dy = p[i].y - p[j].y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = rnd(i * 7 + 1) - 0.5;
            dy = rnd(j * 7 + 3) - 0.5;
            d2 = dx * dx + dy * dy + 0.01;
          }
          d2 = Math.max(d2, 120); // clamp so force can't blow up
          const d = Math.sqrt(d2);
          const f = (3000 / d2) * a;
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          p[i].vx += fx;
          p[i].vy += fy;
          p[j].vx -= fx;
          p[j].vy -= fy;
        }
      }
      for (const l of links) {
        const s = p[l.s];
        const t = p[l.t];
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = ((d - 80) / d) * 0.05 * a;
        s.vx += dx * f;
        s.vy += dy * f;
        t.vx -= dx * f;
        t.vy -= dy * f;
      }
      for (let i = 0; i < n; i++) {
        if (!p[i]) continue;
        p[i].vx += (W / 2 - p[i].x) * 0.004 * a;
        p[i].vy += (H / 2 - p[i].y) * 0.004 * a;
        p[i].vx = clamp(p[i].vx * 0.82, -40, 40);
        p[i].vy = clamp(p[i].vy * 0.82, -40, 40);
        p[i].x += p[i].vx;
        p[i].y += p[i].vy;
      }
      if (drag && p[drag.i]) {
        p[drag.i].x = drag.x;
        p[drag.i].y = drag.y;
        p[drag.i].vx = 0;
        p[drag.i].vy = 0;
      } else if (!drag) {
        alphaRef.current = a * 0.985;
      }
      tick((v) => v + 1);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pos, links]);

  // non-passive wheel so we can preventDefault the page scroll while zooming
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => {
        const k = clamp(v.k * factor, 0.3, 4);
        // keep the canvas centre fixed while zooming
        const lx = (W / 2 - v.x) / v.k;
        const ly = (H / 2 - v.y) / v.k;
        return { k, x: W / 2 - lx * k, y: H / 2 - ly * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function onPointerDown(e) {
    // background → pan
    pan.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  }
  function onNodeDown(e, i) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const l = toLocal(e.clientX, e.clientY);
    dragging.current = { i, x: l.x, y: l.y };
    alphaRef.current = Math.max(alphaRef.current, 0.3);
  }
  function onPointerMove(e) {
    if (dragging.current) {
      const l = toLocal(e.clientX, e.clientY);
      dragging.current = { ...dragging.current, x: l.x, y: l.y };
      alphaRef.current = Math.max(alphaRef.current, 0.2);
      return;
    }
    if (!pan.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const s = W / r.width;
    setView((v) => ({
      ...v,
      x: pan.current.vx + (e.clientX - pan.current.x) * s,
      y: pan.current.vy + (e.clientY - pan.current.y) * s,
    }));
  }
  function onPointerUp() {
    pan.current = null;
    dragging.current = null;
  }

  if (!nodes) {
    return (
      <div className="panel text-faint flex h-[70vh] items-center justify-center font-mono text-xs">
        loading graph…
      </div>
    );
  }
  if (!nodes.length) {
    return (
      <div className="panel text-faint flex h-[70vh] items-center justify-center font-mono text-xs">
        no notes found
      </div>
    );
  }

  const p = posRef.current;
  const hi = hover != null ? adjacency[hover] : null;
  const isLit = (i) => hover == null || !hi || i === hover || hi.has(i);

  return (
    <div className="panel relative overflow-hidden p-0">
      <div className="text-faint pointer-events-none absolute left-4 top-3 z-10 font-mono text-[0.62rem] tracking-wider uppercase">
        vault graph · {nodes.length} notes · {links.length} links · drag node · scroll to zoom · drag bg to pan
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[70vh] w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {links.map((l, i) => {
            if (!p[l.s] || !p[l.t]) return null;
            const lit = hover == null || l.s === hover || l.t === hover;
            return (
              <line
                key={i}
                x1={p[l.s].x}
                y1={p[l.s].y}
                x2={p[l.t].x}
                y2={p[l.t].y}
                stroke={lit ? 'var(--color-accent)' : 'var(--color-edge)'}
                strokeOpacity={lit ? 0.5 : 0.22}
                strokeWidth={lit ? 1 : 0.6}
              />
            );
          })}
          {nodes.map((n, i) => {
            const r = 3.5 + Math.min(10, n.deg * 0.9);
            const lit = isLit(i);
            const showLabel = view.k > 0.8 || n.deg >= 4 || hover === i;
            return (
              <g
                key={n.id}
                transform={`translate(${p[i].x} ${p[i].y})`}
                opacity={lit ? 1 : 0.22}
                onPointerDown={(e) => onNodeDown(e, i)}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  r={r}
                  fill={hover === i ? 'var(--color-blue-100)' : 'var(--color-accent)'}
                  stroke="var(--color-bg)"
                  strokeWidth={1}
                />
                {showLabel && (
                  <text
                    x={r + 3}
                    y={3}
                    fontSize={9}
                    fill={hover === i ? 'var(--color-ink)' : 'var(--color-dim)'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
