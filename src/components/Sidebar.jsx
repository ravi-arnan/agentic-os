import { Hexagon, Terminal, LayoutDashboard, Sparkles, History, NotebookText, FolderGit2 } from 'lucide-react';

export const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'runs', label: 'Run History', icon: History },
  { id: 'vault', label: 'Vault', icon: NotebookText },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
];

export default function Sidebar({ view, onNav, running = 0 }) {
  return (
    <aside className="border-edge bg-panel sticky top-0 flex h-screen w-[232px] shrink-0 flex-col gap-1 border-r p-3">
      {/* brand */}
      <div className="flex items-center gap-3 px-2 pb-4 pt-1">
        <div className="relative">
          <Hexagon size={30} className="text-accent" strokeWidth={1.4} />
          <Terminal size={13} className="text-accent absolute inset-0 m-auto" />
        </div>
        <div>
          <h1 className="font-mono text-[0.95rem] font-semibold leading-none tracking-[0.18em]">
            AGENTIC<span className="text-accent">OS</span>
          </h1>
          <p className="text-faint mt-1 font-mono text-[0.6rem] tracking-wider">
            mission control
          </p>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ id, label, icon: Icon }) => {
          const activeItem = view === id;
          return (
            <button
              key={id}
              onClick={() => onNav(id)}
              aria-current={activeItem ? 'page' : undefined}
              className={`lift flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                activeItem
                  ? 'bg-accent-dim text-ink border border-accent/40'
                  : 'text-dim border border-transparent hover:bg-panel hover:text-ink'
              }`}
            >
              <Icon size={17} strokeWidth={1.8} className={activeItem ? 'text-accent' : 'text-faint'} />
              <span className="flex-1">{label}</span>
              {id === 'skills' && running > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent/30 px-1.5 font-mono text-[0.62rem] text-accent">
                  {running}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="text-faint mt-auto px-2 font-mono text-[0.58rem] leading-relaxed tracking-wider">
        wraps claude code headless
        <br />
        vault · secondbrain
      </div>
    </aside>
  );
}
