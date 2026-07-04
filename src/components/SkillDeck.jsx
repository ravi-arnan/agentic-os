import { useState } from 'react';
import { Sunrise, Radar, NotebookPen, Inbox, CalendarCheck, Play, LoaderCircle, CircleCheck, CircleX, Send, AlarmClock } from 'lucide-react';
import { apiPost } from '../api.js';
import { fmtAgo, fmtMoney, fmtDuration } from '../lib/format.js';

const ICONS = { Sunrise, Radar, NotebookPen, Inbox, CalendarCheck };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function ScheduleChip({ schedule }) {
  if (!schedule) return null;
  const hhmm = `${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute || 0).padStart(2, '0')}`;
  const when = schedule.weekday != null ? `${WEEKDAYS[schedule.weekday]} ${hhmm}` : hhmm;
  return (
    <span
      className="mt-0.5 flex items-center gap-1 font-mono text-[0.62rem] text-faint"
      title={`auto-runs at ${when} while the server is up`}
    >
      <AlarmClock size={10} /> {when}
    </span>
  );
}

function LastRun({ run }) {
  if (!run) return <span className="text-faint text-[0.68rem] font-mono">never run</span>;
  const Icon = run.ok ? CircleCheck : CircleX;
  return (
    <span className="flex items-center gap-1.5 text-[0.68rem] font-mono text-dim">
      <Icon size={12} className={run.ok ? 'text-success' : 'text-danger'} />
      {fmtAgo(run.endedAt)} · {fmtDuration(run.durationMs)} · {fmtMoney(run.costUSD)}
    </span>
  );
}

function SkillCard({ skill, lastRun, isRunning, onStart }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(null);
  const Icon = ICONS[skill.icon] || Play;

  async function launch() {
    setError(null);
    try {
      const { runId } = await apiPost(`/skills/${skill.id}/run`, { input });
      setInput('');
      onStart(runId, skill);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  return (
    <div className="panel flex flex-col gap-3 p-4 transition-colors hover:border-accent/40">
      {/* header: icon sits WITH the title */}
      <div className="flex items-center gap-2.5">
        <div className="shrink-0 rounded-lg bg-accent-dim p-2 text-accent">
          <Icon size={17} strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{skill.name}</h3>
          <ScheduleChip schedule={skill.schedule} />
        </div>
      </div>

      <p className="text-dim flex-1 text-xs leading-relaxed">{skill.tagline}</p>

      {/* runtime status sits next to the action, where you look after running */}
      <div className="flex min-h-[1.1rem] items-center">
        {isRunning ? (
          <span className="flex items-center gap-1.5 text-[0.66rem] font-mono text-accent">
            <LoaderCircle size={11} className="animate-spin" /> running
          </span>
        ) : (
          <LastRun run={lastRun} />
        )}
      </div>

      {skill.needsInput ? (
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && input.trim()) {
                e.preventDefault();
                launch();
              }
            }}
            placeholder={skill.placeholder}
            rows={2}
            className="min-h-9 flex-1 resize-none rounded-md border border-edge bg-bg/60 px-2.5 py-1.5 text-xs outline-none placeholder:text-faint focus:border-accent/50"
          />
          <button
            onClick={launch}
            disabled={isRunning || !input.trim()}
            className="cta rounded-lg p-2.5 shadow-md shadow-accent/30 transition disabled:opacity-30"
            aria-label={`Run ${skill.name}`}
          >
            <Send size={14} />
          </button>
        </div>
      ) : (
        <button
          onClick={launch}
          disabled={isRunning}
          className="cta flex items-center justify-center gap-2 rounded-lg py-2.5 text-xs font-mono font-medium tracking-wide shadow-md shadow-accent/30 transition active:scale-[0.99] disabled:opacity-30"
        >
          {isRunning ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} />}
          {isRunning ? 'RUNNING' : 'RUN'}
        </button>
      )}
      {error && <p className="text-danger text-[0.68rem] font-mono">{error}</p>}
    </div>
  );
}

export default function SkillDeck({ skills, lastRuns, runningSkillIds, onStart }) {
  return (
    <section aria-label="Skills" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {(skills || []).map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          lastRun={lastRuns?.[skill.id]}
          isRunning={runningSkillIds.has(skill.id)}
          onStart={onStart}
        />
      ))}
    </section>
  );
}
