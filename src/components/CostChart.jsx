import { useMemo, useState } from 'react';
import { fmtMoney, fmtTokens, modelColor, shortModel } from '../lib/format.js';

const W = 900;
const H = 220;
const PAD = { top: 10, right: 8, bottom: 22, left: 44 };

/** Stacked daily bars of estimated cost by model, custom SVG. */
export default function CostChart({ usage }) {
  const [hover, setHover] = useState(null);
  const daily = usage?.daily || [];

  const { bars, maxCost, models } = useMemo(() => {
    const models = new Map();
    let maxCost = 0;
    const bars = daily.map((d) => {
      maxCost = Math.max(maxCost, d.cost);
      let y = 0;
      const segs = Object.entries(d.byModel)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([model, m]) => {
          models.set(model, (models.get(model) || 0) + m.cost);
          const seg = { model, cost: m.cost, y0: y };
          y += m.cost;
          return seg;
        });
      return { ...d, segs };
    });
    return {
      bars,
      maxCost: maxCost || 1,
      models: [...models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    };
  }, [daily]);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / Math.max(bars.length, 1);
  const barW = Math.max(3, Math.min(22, step * 0.7));
  const yFor = (v) => PAD.top + innerH * (1 - v / maxCost);

  const hovered = hover != null ? bars[hover] : null;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="panel-title">spend · est. API value / day</h2>
        <div className="flex-1" />
        {models.slice(0, 4).map((m) => (
          <span key={m} className="flex items-center gap-1.5 font-mono text-[0.65rem] text-dim">
            <span className="h-2 w-2 rounded-sm" style={{ background: modelColor(m) }} />
            {shortModel(m)}
          </span>
        ))}
      </div>

      <div className="num mt-1 h-5 text-xs text-dim">
        {hovered
          ? `${hovered.date} · ${fmtMoney(hovered.cost)} · ${fmtTokens(hovered.out)} out · ${hovered.messages} msgs · ${hovered.sessions} sessions`
          : usage
            ? `${fmtMoney(usage.totals.cost)} lifetime est. · ${fmtTokens(usage.totals.out)} tokens out · ${usage.totals.sessions} sessions`
            : 'loading...'}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-label="Daily estimated cost, stacked by model"
        onMouseLeave={() => setHover(null)}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left} x2={W - PAD.right}
              y1={yFor(maxCost * f)} y2={yFor(maxCost * f)}
              stroke="currentColor" className="text-edge" strokeDasharray="3 5" strokeWidth="0.6"
            />
            <text
              x={PAD.left - 6} y={yFor(maxCost * f) + 3}
              textAnchor="end" fontSize="9"
              className="num fill-current text-dim"
            >
              {fmtMoney(maxCost * f)}
            </text>
          </g>
        ))}

        {bars.map((bar, i) => {
          const x = PAD.left + i * step + (step - barW) / 2;
          return (
            <g key={bar.date} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + i * step} y={PAD.top} width={step} height={innerH} fill="transparent" />
              {bar.segs.map((seg) => (
                <rect
                  key={seg.model}
                  x={x}
                  y={yFor(seg.y0 + seg.cost)}
                  width={barW}
                  height={Math.max(0.5, (seg.cost / maxCost) * innerH)}
                  rx="1.5"
                  fill={modelColor(seg.model)}
                  opacity={hover == null || hover === i ? 0.95 : 0.35}
                />
              ))}
              {(i === 0 || i === bars.length - 1 || bar.date.endsWith('-01') || i % 7 === 0) && (
                <text
                  x={x + barW / 2} y={H - 8}
                  textAnchor="middle" fontSize="8.5"
                  className="num fill-current text-faint"
                >
                  {bar.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
