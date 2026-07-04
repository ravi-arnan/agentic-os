import { useMemo, useState } from 'react';
import { GitBranch, CircleDot, AlertTriangle, Search } from 'lucide-react';
import { fmtAgo, fmtMoney } from '../lib/format.js';

const SHOW_DEFAULT = 8;

export default function ProjectList({ projects }) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const list = projects || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.memory?.title?.toLowerCase().includes(q),
    );
  }, [list, query]);

  const visible = query ? filtered : showAll ? filtered : filtered.slice(0, SHOW_DEFAULT);

  return (
    <div className="panel flex flex-col p-4">
      <div className="flex items-center gap-3">
        <h2 className="panel-title">projects · ~/Projects</h2>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 rounded-md border border-edge/60 bg-raised px-2 py-1">
          <Search size={11} className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`filter ${list.length}`}
            className="w-24 bg-transparent font-mono text-[0.68rem] outline-none placeholder:text-faint"
            aria-label="Filter projects"
          />
        </label>
      </div>

      <div className="mt-1">
        <ul className="divide-y divide-edge/40">
          {visible.map((p) => (
            <li key={p.path} className="flex items-center gap-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-medium">{p.name}</span>
                  {p.isGit && p.branch && (
                    <span className="flex items-center gap-1 font-mono text-[0.62rem] text-faint">
                      <GitBranch size={10} /> {p.branch}
                    </span>
                  )}
                  {p.dirtyFiles > 0 && (
                    <span
                      className="flex items-center gap-1 font-mono text-[0.62rem] text-warn"
                      title={`${p.dirtyFiles} uncommitted files`}
                    >
                      <CircleDot size={9} /> {p.dirtyFiles}
                    </span>
                  )}
                  {p.staleDays != null && p.staleDays >= 21 && (
                    <span className="flex items-center gap-1 font-mono text-[0.62rem] text-danger" title="stale project">
                      <AlertTriangle size={9} /> {p.staleDays}d
                    </span>
                  )}
                </div>
                {p.memory && (
                  <p className="text-faint mt-0.5 truncate text-[0.65rem]" title={p.memory.note}>
                    {p.memory.title}
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="num text-[0.7rem] text-dim">{p.claude ? fmtMoney(p.claude.cost) : ''}</div>
                <div className="text-faint font-mono text-[0.62rem]">
                  {fmtAgo(p.claude?.lastActive || p.lastCommitAt || p.lastTouch)}
                </div>
              </div>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="text-faint py-3 text-center font-mono text-xs">no match</li>
          )}
        </ul>
      </div>

      {!query && filtered.length > SHOW_DEFAULT && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 w-full shrink-0 rounded-md border border-edge/60 bg-raised py-1.5 font-mono text-[0.68rem] text-dim transition hover:border-accent/40 hover:text-ink"
        >
          {showAll ? 'show less' : `show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}
