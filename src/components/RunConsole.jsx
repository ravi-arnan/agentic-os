import { useEffect, useRef } from 'react';
import { Square, LoaderCircle, CircleCheck, CircleX, Wrench, X, GitCommitHorizontal } from 'lucide-react';
import { useRunStream, apiPost } from '../api.js';
import { fmtMoney, fmtDuration, shortPath } from '../lib/format.js';

function ToolChip({ tool }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-edge bg-raised px-2 py-0.5 text-[0.68rem] font-mono text-dim">
      <Wrench size={10} className="shrink-0 text-warn" />
      <span className="text-ink">{tool.name}</span>
      {tool.target && <span className="truncate text-faint">{shortPath(tool.target)}</span>}
    </span>
  );
}

export default function RunConsole({ runId, skill, fallback, onClose, onFinished }) {
  const { events, status: streamStatus } = useRunStream(runId);
  // run evicted from server memory (restart / old run): fall back to the
  // persisted summary instead of showing a dead stream
  const evicted = streamStatus === 'error' && events.length === 0 && fallback && fallback.status !== 'running';
  const status = evicted ? (fallback.ok ? 'done' : 'error') : streamStatus;
  const scrollRef = useRef(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  useEffect(() => {
    if (status !== 'running' && !notifiedRef.current) {
      notifiedRef.current = true;
      onFinished?.();
    }
  }, [status, onFinished]);

  const result = events.find((e) => e.t === 'result');
  const init = events.find((e) => e.t === 'init');

  return (
    <section className="panel scanline flex flex-col overflow-hidden" aria-label="Run console">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2.5">
        {status === 'running' ? (
          <LoaderCircle size={14} className="animate-spin text-accent" />
        ) : status === 'done' ? (
          <CircleCheck size={14} className="text-success" />
        ) : (
          <CircleX size={14} className="text-danger" />
        )}
        <span className="font-mono text-xs tracking-wide">
          {skill?.name || 'run'} <span className="text-faint">· {runId}</span>
          {init?.model && <span className="text-faint"> · {init.model}</span>}
        </span>
        <div className="flex-1" />
        {status === 'running' && (
          <button
            onClick={() => apiPost(`/runs/${runId}/kill`)}
            className="flex items-center gap-1.5 rounded border border-danger/40 px-2 py-1 text-[0.68rem] font-mono text-danger transition hover:bg-danger/10"
          >
            <Square size={10} /> STOP
          </button>
        )}
        <button onClick={onClose} className="text-faint transition hover:text-ink" aria-label="Close console">
          <X size={15} />
        </button>
      </div>

      <div ref={scrollRef} className="max-h-72 space-y-2.5 overflow-y-auto px-4 py-3">
        {events.length === 0 && !evicted && (
          <p className="text-faint font-mono text-xs">spawning {skill?.agent || 'opencode'} ...</p>
        )}
        {evicted && (
          <div
            className={`rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap ${
              fallback.ok ? 'border-success/30 bg-success/10 text-ink' : 'border-danger/40 bg-danger/10 text-danger'
            }`}
          >
            {fallback.summary || '(no summary recorded)'}
          </div>
        )}
        {events.map((evt, i) => {
          if (evt.t === 'init') return null;
          if (evt.t === 'assistant') {
            return (
              <div key={i} className="feed-item space-y-1.5">
                {evt.tools?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {evt.tools.map((tool, j) => (
                      <ToolChip key={j} tool={tool} />
                    ))}
                  </div>
                )}
                {evt.text && (
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-dim">{evt.text}</p>
                )}
              </div>
            );
          }
          if (evt.t === 'note') {
            return (
              <div key={i} className="feed-item flex items-center gap-2 font-mono text-[0.68rem] text-faint">
                <GitCommitHorizontal size={12} className="shrink-0 text-accent" />
                <span>{evt.text}</span>
              </div>
            );
          }
          if (evt.t === 'result') {
            return (
              <div
                key={i}
                className={`feed-item rounded-md border p-3 text-xs leading-relaxed whitespace-pre-wrap ${
                  evt.ok ? 'border-success/30 bg-success/10 text-ink' : 'border-danger/40 bg-danger/10 text-danger'
                }`}
              >
                {evt.text || evt.error || '(no output)'}
              </div>
            );
          }
          return null;
        })}
      </div>

      {result && (
        <div className="flex items-center gap-4 border-t border-edge px-4 py-2 font-mono text-[0.68rem] text-dim">
          <span>cost <span className="num text-ink">{fmtMoney(result.costUSD)}</span></span>
          <span>turns <span className="num text-ink">{result.turns ?? '·'}</span></span>
          <span>took <span className="num text-ink">{fmtDuration(result.durationMs)}</span></span>
          {result.sessionId && (
            <span className="truncate text-faint">session: {result.sessionId}</span>
          )}
        </div>
      )}
    </section>
  );
}
