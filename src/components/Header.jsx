import { fmtMoney, shortPath } from '../lib/format.js';
import { NAV } from './Sidebar.jsx';

const SUBTITLES = {
  overview: 'Live metrics, cost, and activity at a glance',
  skills: 'One-click opencode skills — launch and watch them run',
  runs: 'Every headless run, newest first',
  vault: 'Second brain snapshot from your Obsidian vault',
  projects: 'Projects agentic-os is tracking',
};

export default function Header({ view, overview }) {
  const live = overview?.liveSessions || [];
  const today = overview?.today;
  const nav = NAV.find((n) => n.id === view);
  const Icon = nav?.icon;

  return (
    <header className="border-edge sticky top-0 z-10 flex items-center gap-4 border-b bg-bg/80 px-6 py-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="rounded-lg bg-accent-dim p-2 text-accent">
            <Icon size={19} strokeWidth={1.8} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{nav?.label || 'Dashboard'}</h2>
          <p className="text-faint truncate text-xs">{SUBTITLES[view]}</p>
        </div>
      </div>

      <div className="flex-1" />

      <div className="hidden items-center gap-2 md:flex">
        {live.length === 0 && <span className="text-faint font-mono text-xs">no live sessions</span>}
        {live.slice(0, 4).map((s) => (
          <span
            key={s.pid}
            title={`${s.name || s.sessionId} · ${shortPath(s.cwd)} · ${s.status}`}
            className="border-edge bg-panel text-dim flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.68rem]"
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

      <div className="border-edge border-l pl-4 text-right">
        <div className="num gradient-num text-xl leading-none">{today ? fmtMoney(today.cost) : '·'}</div>
        <div className="text-faint mt-1 font-mono text-[0.62rem] uppercase tracking-wider">
          value today
        </div>
      </div>
    </header>
  );
}
