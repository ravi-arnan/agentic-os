import { Zap, MessageSquare, Wrench, Layers } from 'lucide-react';
import { fmtMoney, fmtTokens } from '../lib/format.js';

function Tile({ icon: Icon, label, value, sub }) {
  return (
    <div className="panel flex items-center gap-3 p-3.5">
      <div className="rounded-md bg-raised p-2 text-dim">
        <Icon size={16} strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <div className="num truncate text-lg leading-tight">{value}</div>
        <div className="text-faint font-mono text-[0.62rem] tracking-wider uppercase">
          {label}
          {sub && <span className="text-dim normal-case"> · {sub}</span>}
        </div>
      </div>
    </div>
  );
}

export default function StatTiles({ overview, usage }) {
  const t = usage?.totals;
  const today = overview?.today;
  const stats = overview?.stats;
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-3">
      <Tile
        icon={Zap}
        label="today"
        value={today ? fmtMoney(today.cost) : '·'}
        sub={today ? `${today.toolCalls} tools` : null}
      />
      <Tile
        icon={Layers}
        label="lifetime est."
        value={t ? fmtMoney(t.cost) : '·'}
        sub={t ? `${t.sessions} sessions` : null}
      />
      <Tile
        icon={MessageSquare}
        label="messages"
        value={t ? fmtTokens(t.messages) : '·'}
        sub={stats?.firstSessionDate ? `since ${String(stats.firstSessionDate).slice(0, 10)}` : null}
      />
      <Tile
        icon={Wrench}
        label="tool calls"
        value={t ? fmtTokens(t.toolCalls) : '·'}
        sub={t ? `${fmtTokens(t.cacheRead)} cache read` : null}
      />
    </div>
  );
}
