import { Flame, FileText, Inbox, Link2Off, CircleCheck, Circle } from 'lucide-react';

function Check({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 font-mono text-[0.68rem]">
      {ok ? <CircleCheck size={12} className="text-success" /> : <Circle size={12} className="text-faint" />}
      <span className={ok ? 'text-dim' : 'text-faint'}>{label}</span>
    </span>
  );
}

export default function VaultCard({ vault }) {
  if (vault && !vault.ok) {
    return (
      <div className="panel p-4">
        <h2 className="panel-title">vault · secondbrain</h2>
        <p className="text-danger mt-2 font-mono text-xs">{vault.error}</p>
      </div>
    );
  }
  const edited = vault?.editedPerDay || [];
  const maxEdit = Math.max(1, ...edited.map((e) => e.count));

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <h2 className="panel-title">vault · secondbrain</h2>

      <div className="flex items-end gap-5">
        <div>
          <div className="flex items-center gap-1.5">
            <Flame size={18} className={vault?.dailyStreak > 0 ? 'text-warn' : 'text-faint'} />
            <span className="num text-2xl leading-none">{vault?.dailyStreak ?? '·'}</span>
          </div>
          <div className="text-faint mt-1 font-mono text-[0.62rem] tracking-wider uppercase">day streak</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <FileText size={15} className="text-dim" />
            <span className="num text-2xl leading-none">{vault?.noteCount ?? '·'}</span>
          </div>
          <div className="text-faint mt-1 font-mono text-[0.62rem] tracking-wider uppercase">notes</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <Inbox size={15} className="text-dim" />
            <span className="num text-2xl leading-none">{vault?.inboxCount ?? '·'}</span>
          </div>
          <div className="text-faint mt-1 font-mono text-[0.62rem] tracking-wider uppercase">inbox</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <Link2Off size={15} className={vault?.orphanCount ? 'text-warn' : 'text-dim'} />
            <span className="num text-2xl leading-none">{vault?.orphanCount ?? '·'}</span>
          </div>
          <div className="text-faint mt-1 font-mono text-[0.62rem] tracking-wider uppercase">orphans</div>
        </div>
      </div>

      <div className="flex gap-4">
        <Check ok={vault?.hasTodayDaily} label="daily note today" />
        <Check ok={vault?.hasTodaySessionLog} label="session log today" />
      </div>

      <div>
        <div className="text-faint mb-1 font-mono text-[0.62rem] tracking-wider uppercase">edits · 14d</div>
        <div className="flex h-8 items-end gap-[3px]">
          {edited.length === 0 && <span className="text-faint font-mono text-[0.65rem]">quiet</span>}
          {edited.map((e) => (
            <div
              key={e.date}
              title={`${e.date}: ${e.count} notes`}
              className="w-3 rounded-sm bg-accent/70"
              style={{ height: `${Math.max(12, (e.count / maxEdit) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      {vault?.orphans?.length > 0 && (
        <p className="text-faint truncate font-mono text-[0.65rem]" title={vault.orphans.join('\n')}>
          orphan: {vault.orphans.join(', ')}
        </p>
      )}
    </div>
  );
}
