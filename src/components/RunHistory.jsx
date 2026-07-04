import { CircleCheck, CircleX, LoaderCircle, History } from 'lucide-react';
import { fmtAgo, fmtMoney, fmtDuration } from '../lib/format.js';

export default function RunHistory({ runs, skills, onSelect }) {
  const byId = Object.fromEntries((skills || []).map((s) => [s.id, s]));
  const list = runs || [];

  return (
    <div className="panel h-full p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="panel-title">skill runs · ops log</h2>
        <div className="flex-1" />
        <span className="text-faint font-mono text-[0.68rem]">{list.length} recorded</span>
      </div>

      {list.length === 0 && (
        <p className="text-faint mt-3 flex items-center gap-2 font-mono text-xs">
          <History size={13} /> no runs yet. click a skill above.
        </p>
      )}

      <ul className="mt-1 divide-y divide-edge/40">
        {list.slice(0, 30).map((run) => (
          <li key={run.id}>
            <button
              onClick={() => onSelect(run)}
              className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-raised/40"
            >
              {run.status === 'running' ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin text-accent" />
              ) : run.ok ? (
                <CircleCheck size={13} className="shrink-0 text-success" />
              ) : (
                <CircleX size={13} className="shrink-0 text-danger" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">
                  {byId[run.skillId]?.name || run.skillId}
                  {run.input && <span className="text-faint font-normal"> · "{run.input.slice(0, 40)}"</span>}
                </div>
                {run.summary && (
                  <p className="text-faint truncate text-[0.65rem]">{run.summary.replace(/\s+/g, ' ')}</p>
                )}
              </div>
              <div className="num shrink-0 text-right font-mono text-[0.62rem] text-dim">
                <div>{fmtMoney(run.costUSD)} · {fmtDuration(run.durationMs)}</div>
                <div className="text-faint">{fmtAgo(run.startedAt)}</div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
