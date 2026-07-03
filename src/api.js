import { useCallback, useEffect, useRef, useState } from 'react';

export async function apiGet(path) {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${path}: ${res.status}`);
  return data;
}

/** Fetch on mount (and per pollMs); returns {data, error, loading, refresh}. */
export function useApi(path, { pollMs = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);

  const refresh = useCallback(() => {
    apiGet(path)
      .then((data) => alive.current && setState({ data, error: null, loading: false }))
      .catch((error) => alive.current && setState((s) => ({ ...s, error, loading: false })));
  }, [path]);

  useEffect(() => {
    alive.current = true;
    refresh();
    const timer = pollMs ? setInterval(refresh, pollMs) : null;
    return () => {
      alive.current = false;
      if (timer) clearInterval(timer);
    };
  }, [refresh, pollMs]);

  return { ...state, refresh };
}

/** Subscribe to a run's SSE stream; returns {events, status}. */
export function useRunStream(runId) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('running');

  useEffect(() => {
    if (!runId) return undefined;
    setEvents([]);
    setStatus('running');
    const source = new EventSource(`/api/runs/${runId}/stream`);
    source.onmessage = (msg) => {
      let evt;
      try {
        evt = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (evt.t === 'end') {
        setStatus(evt.status);
        source.close();
        return;
      }
      setEvents((prev) => [...prev, evt]);
    };
    source.onerror = () => {
      // server restarted or run evicted — stop trying
      source.close();
      setStatus((s) => (s === 'running' ? 'error' : s));
    };
    return () => source.close();
  }, [runId]);

  return { events, status };
}
