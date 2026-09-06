import { useMemo, useState } from 'react';
import { ShieldCheck, Cpu, Server, Sparkles, Zap, ChevronRight, CheckCircle2, Bot, TerminalSquare, Github } from 'lucide-react';
import { fmtMoney, fmtTokens, shortModel, modelColor, daysUntilWeekReset } from '../lib/format.js';

const ICONS = {
  claude: Sparkles,
  agy: Zap,
  opencode: Cpu,
  '9router': Server,
  codebuff: Bot,
  commandcode: Zap,
  cursor: TerminalSquare,
  copilot: Github,
};

export default function ProviderQuotas({ usage }) {
  const [selectedProvider, setSelectedProvider] = useState(null);
  const providers = usage?.providers || [];
  const resetIn = daysUntilWeekReset();

  const totalTokensAll = useMemo(() => {
    return providers.reduce((acc, p) => acc + p.in + p.out, 0) || 1;
  }, [providers]);

  if (!providers.length) return null;

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="panel-title">providers · usage & tier limits</h2>
          <p className="text-dim mt-0.5 text-xs">
            Tracking multi-agent token throughput, free tiers, and API billing limits
          </p>
        </div>
        <div className="text-faint font-mono text-[0.68rem]">
          weekly window reset: <span className="text-ink font-semibold">{resetIn}d</span>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {providers.map((p) => {
          const Icon = ICONS[p.id] || Cpu;
          const isSelected = selectedProvider === p.id;
          const totalTok = p.in + p.out;
          const sharePercent = ((totalTok / totalTokensAll) * 100).toFixed(1);

          return (
            <div
              key={p.id}
              onClick={() => setSelectedProvider(isSelected ? null : p.id)}
              className={`border-edge bg-bg/50 hover:bg-bg/80 relative flex cursor-pointer flex-col justify-between rounded-lg border p-3.5 transition-all ${
                isSelected ? 'ring-accent/60 ring-2' : ''
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="rounded-md p-1.5"
                      style={{
                        background: `${p.color}18`,
                        color: p.color,
                      }}
                    >
                      <Icon size={16} strokeWidth={2} />
                    </div>
                    <div>
                      <div className="text-ink text-sm font-semibold leading-tight">{p.name}</div>
                      <span className="text-faint font-mono text-[0.62rem]">{p.badge}</span>
                    </div>
                  </div>
                  {p.isPaid ? (
                    <span className="border-edge bg-accent-dim text-accent rounded px-1.5 py-0.5 font-mono text-[0.6rem]">
                      paid api
                    </span>
                  ) : (
                    <span className="border-edge bg-success/15 text-success rounded px-1.5 py-0.5 font-mono text-[0.6rem] flex items-center gap-1">
                      <CheckCircle2 size={10} /> free tier
                    </span>
                  )}
                </div>

                <div className="mt-3 space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-faint font-mono text-[0.68rem]">total tokens</span>
                    <span className="num text-ink text-sm font-medium">{fmtTokens(totalTok)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-edge/40">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(4, sharePercent)}%`, background: p.color }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[0.62rem] text-dim">
                    <span>{sharePercent}% of total</span>
                    <span>{fmtTokens(p.in)} in / {fmtTokens(p.out)} out</span>
                  </div>
                </div>

                <div className="mt-3 rounded border border-edge/40 bg-panel/60 p-2 text-[0.68rem]">
                  <div className="font-mono text-faint uppercase text-[0.58rem] tracking-wider">tier & limit</div>
                  <div className="text-ink font-medium mt-0.5">{p.tier}</div>
                  <div className="text-dim text-[0.62rem] mt-0.5">{p.quotaInfo}</div>
                </div>
              </div>

              <div className="mt-3.5 border-t border-edge/40 pt-2 flex items-center justify-between text-[0.68rem] text-dim">
                <span>{p.sessions} sessions · {p.messages} msgs</span>
                {p.cost > 0 && <span className="num font-semibold text-accent">{fmtMoney(p.cost)}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down model breakdown */}
      {selectedProvider && (
        <div className="mt-4 rounded-lg border border-edge bg-bg/40 p-3">
          {(() => {
            const current = providers.find((p) => p.id === selectedProvider);
            if (!current) return null;
            return (
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-ink font-medium">
                    Models under {current.name}
                  </span>
                  <button
                    onClick={() => setSelectedProvider(null)}
                    className="text-faint hover:text-ink text-[0.68rem] font-mono"
                  >
                    close [×]
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {current.models.map((m) => (
                    <div
                      key={m.model}
                      className="flex items-center justify-between rounded border border-edge/50 bg-panel/80 px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: modelColor(m.model) }}
                        />
                        <span className="truncate text-xs font-mono text-ink">
                          {shortModel(m.model)}
                        </span>
                      </div>
                      <div className="text-right num text-[0.72rem] text-dim shrink-0">
                        <span>{fmtTokens(m.in + m.out)} tok</span>
                        {m.cost > 0 && <span className="text-accent ml-1.5 font-medium">{fmtMoney(m.cost)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
