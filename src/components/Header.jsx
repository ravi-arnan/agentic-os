import { Hexagon, Terminal } from 'lucide-react';
import { fmtMoney, shortPath } from '../lib/format.js';

export default function Header({ overview }) {
  const live = overview?.liveSessions || [];
  const today = overview?.today;

  return (
    <header className="flex items-center gap-6 pb-2">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Hexagon size={30} className="text-accent" strokeWidth={1.4} />
          <Terminal size={13} className="text-accent absolute inset-0 m-auto" />
        </div>
        <div>
          <h1 className="font-mono text-lg font-semibold tracking-[0.22em] leading-none">
            AGENTIC<span className="text-accent">OS</span>
          </h1>
          <p className="text-faint text-[0.68rem] font-mono tracking-wider mt-1">
            claude code · mission control
          </p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        {live.length === 0 && (
          <span className="text-faint text-xs font-mono">no live sessions</span>
        )}
        {live.slice(0, 5).map((s) => (
          <span
            key={s.pid}
            title={`${s.name || s.sessionId} · ${shortPath(s.cwd)} · ${s.status}`}
            className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1 text-[0.68rem] font-mono text-dim"
          >
            <span
              className={`live-dot inline-block h-1.5 w-1.5 rounded-full ${
                s.status === 'busy' ? 'bg-success' : 'bg-warn'
              }`}
            />
            {shortPath(s.cwd).split('/')[0] || '~'}
          </span>
        ))}
      </div>

      <div className="text-right">
        <div className="num gradient-num text-xl leading-none">
          {today ? fmtMoney(today.cost) : '·'}
        </div>
        <div className="text-faint text-[0.65rem] font-mono tracking-wider mt-1 uppercase">
          est. value today
        </div>
      </div>
    </header>
  );
}
