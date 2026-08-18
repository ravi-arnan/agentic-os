import { TriangleAlert } from 'lucide-react';

/**
 * Scheduled skills that failed or went stale. Sits under the header on every
 * view because an unattended run that quietly broke is the one thing you will
 * never go looking for.
 */
export default function AlertBanner({ alerts, skills, onSelect }) {
  if (!alerts?.length) return null;
  const nameOf = (id) => (skills || []).find((s) => s.id === id)?.name || id;

  return (
    <div
      role="status"
      className="border-danger/30 bg-danger/10 space-y-1 rounded-lg border px-4 py-3"
    >
      {alerts.map((alert) => (
        <button
          key={alert.skillId}
          onClick={() => onSelect?.(alert.skillId)}
          className="flex w-full items-start gap-2 text-left font-mono text-[0.72rem] leading-relaxed"
        >
          <TriangleAlert
            size={13}
            className={`mt-0.5 shrink-0 ${alert.level === 'error' ? 'text-danger' : 'text-warn'}`}
          />
          <span className="text-dim">
            <span className="text-ink font-semibold">{nameOf(alert.skillId)}</span> · {alert.message}
          </span>
        </button>
      ))}
    </div>
  );
}
