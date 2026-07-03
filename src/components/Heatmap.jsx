import { useMemo, useState } from 'react';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Hour x weekday activity heatmap from prompt history. */
export default function Heatmap({ activity }) {
  const [hover, setHover] = useState(null);
  const heatmap = activity?.heatmap;

  const max = useMemo(
    () => Math.max(1, ...(heatmap || []).flat()),
    [heatmap],
  );

  return (
    <div className="panel p-4">
      <div className="flex items-baseline">
        <h2 className="panel-title">focus · prompts by hour, last {activity?.weeks ?? 8}w</h2>
        <div className="flex-1" />
        <span className="num h-4 text-[0.68rem] text-dim">
          {hover
            ? `${DAYS[hover[0]]} ${String(hover[1]).padStart(2, '0')}:00 · ${heatmap[hover[0]][hover[1]]} prompts`
            : `${activity?.totalPrompts ?? '·'} prompts`}
        </span>
      </div>

      <div className="mt-3 grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, 1fr)' }} onMouseLeave={() => setHover(null)}>
        {(heatmap || Array.from({ length: 7 }, () => new Array(24).fill(0))).map((row, d) => (
          <div key={d} className="contents">
            <span className="pr-1.5 text-right font-mono text-[0.6rem] leading-4 text-faint">{DAYS[d]}</span>
            {row.map((count, h) => (
              <span
                key={h}
                onMouseEnter={() => setHover([d, h])}
                className="aspect-square rounded-[2px]"
                style={{
                  background:
                    count === 0
                      ? 'rgba(255, 255, 255, 0.45)'
                      : `rgba(91, 84, 196, ${(0.12 + 0.78 * (count / max)).toFixed(3)})`,
                }}
              />
            ))}
          </div>
        ))}
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="text-center font-mono text-[0.55rem] text-faint">
            {h % 6 === 0 ? h : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
