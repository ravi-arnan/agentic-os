import fs from 'node:fs';
import readline from 'node:readline';

/**
 * Stream a .jsonl file line by line, invoking onRecord for each
 * successfully parsed JSON object. Malformed lines are skipped.
 */
export async function eachJsonlRecord(filePath, onRecord) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // partial/corrupt line (e.g. mid-write) — skip
    }
    onRecord(record);
  }
}

/** Parse every valid JSON line of a jsonl string (for small files / tests). */
export function parseJsonl(text) {
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // skip
    }
  }
  return records;
}

/** UTC date key (YYYY-MM-DD) in local time for an ISO timestamp or epoch ms. */
export function dayKey(ts) {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
