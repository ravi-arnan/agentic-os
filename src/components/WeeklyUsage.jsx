import { useMemo, useState } from 'react';
import { fmtMoney, fmtTokens, weekStart, daysUntilWeekReset } from '../lib/format.js';

/**
 * Per-week usage rollup from the daily series. No fixed limit line —
 * Claude's plan ceiling isn't in the transcript data — so this just tracks
 * how much you've spent each week and where the current week stands.
 */
export default function WeeklyUsage({ usage }) {
  const daily = usage?.daily || [];

  const weeks = useMemo(() => {
    const map = new Map();
    for (const d of daily) {
      const wk = weekStart(d.date);
      const w =
        map.get(wk) ||
        { week: wk, cost: 0, in: 0, out: 0, cacheRead: 0, cacheCreate: 0, messages: 0, toolCalls: 0, days: 0 };
      w.cost += d.cost;
      w.in += d.in;
      w.out += d.out;
      w.cacheRead += d.cacheRead;
      w.cacheCreate += d.cacheCreate;
      w.messages += d.messages;
      w.toolCalls += d.toolCalls;
      w.days += 1;
      map.set(wk, w);
    }
    return [...map.values()].sort((a, b) => a.week.localeCompare(b.week));
  }, [daily]);

  const currentWk = weekStart(new Date().toISOString().slice(0, 10));
  const currentIdx = weeks.findIndex((w) => w.week === currentWk);
  const [sel, setSel] = useState(null);
  const activeIdx = sel ?? (currentIdx >= 0 ? currentIdx : weeks.length - 1);
  const active = weeks[activeIdx];

  const maxCost = Math.max(1, ...weeks.map((w) => w.cost));
  const resetIn = daysUntilWeekReset();

  if (!weeks.length) {
    return (
      <div className="panel p-4">
        <h2 className="panel-title">usage · by week</h2>
        <div className="mt-2 text-xs text-faint">no usage yet</div>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="panel-title">usage · by week</h2>
        <div className="flex-1" />
        {active?.week === currentWk && (
          <span className="font-mono text-[0.65rem] text-faint">resets in {resetIn}d</span>
        )}
      </div>

      {active && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="num text-2xl text-ink" style={{ color: 'var(--color-violet)' }}>
            {fmtMoney(active.cost)}
          </span>
          <span className="num text-xs text-dim">
            week of {active.week} · {fmtTokens(active.out)} out · {active.messages} msgs · {active.toolCalls} tools
            {active.week === currentWk ? ' · so far' : ''}
          </span>
        </div>
      )}

      <div className="mt-4 flex items-end gap-1.5" style={{ height: 96 }}>
        {weeks.map((w, i) => {
          const isCurrent = w.week === currentWk;
          const isActive = i === activeIdx;
          return (
            <button
              key={w.week}
              type="button"
              onClick={() => setSel(i)}
              title={`${w.week} · ${fmtMoney(w.cost)}`}
              className="group flex h-full flex-1 flex-col justify-end"
            >
              <div
                className="w-full rounded-sm transition-opacity"
                style={{
                  height: `${Math.max(3, (w.cost / maxCost) * 100)}%`,
                  background: isCurrent ? 'var(--color-violet)' : 'var(--color-blue-500)',
                  opacity: isActive ? 1 : 0.4,
                }}
              />
              <span className="num mt-1 text-center text-[0.55rem] text-faint">{w.week.slice(5)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
