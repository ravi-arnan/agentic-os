# Agentic OS

A visual agentic OS for one person: a clickable local dashboard that wraps
opencode (default, via 9router) and Claude Code, turns daily workflows into
one-click skills, and shows metrics the terminal can't — wired into the
`secondbrain` Obsidian vault.

## What it does

- **Skill deck** — one-click headless opencode runs (`opencode run --dangerously-skip-permissions`),
  streamed live into the dashboard (Claude Code still supported via `agent: 'claude'`):
  - *Morning briefing* — sweeps `~/Projects` git state + memory, writes Prioritas /
    Konteks buat AI into today's `daily/` note in the vault.
  - *Project status sweep* — per-project status + next action, saved to `AI/status/`.
  - *Session journaler* — digests today's Claude Code activity into `AI/sessions/`
    plus the daily note's Agent log.
  - *Quick capture* — routes a thought to the right vault note (or `00-Inbox/`).
- **Metrics** — parsed from `~/.claude` (Claude transcripts) + `~/.local/share/opencode/opencode-stable.db` (opencode sessions):
  - Estimated API-value spend per day, stacked by model (subscription / free
    transcripts carry `costUSD: 0`, so cost is estimated from tokens x model pricing; free 9router/opencode models show $0.00).
  - Hour x weekday focus heatmap, per-project cost and staleness, live session pips.
  - Vault health: daily-note streak, orphan notes, inbox count, edit activity.
  - Ops log of every skill run: duration, turns, est. cost, result summary.

## Run

```bash
npm install
npm run build && npm start   # production: http://localhost:4177
npm run dev                  # dev: vite on :4173 proxying API to :4177
npm test                     # vitest for the parsing/aggregation logic
```

## Scheduled skills

Skills with a `schedule` field auto-run while the server is up (checked every
minute, restart-safe: a skill that already ran today won't re-fire):

- morning-briefing at 08:30 daily
- session-journaler at 21:30 daily
- status-sweep Fridays at 17:00
- weekly-review Sundays at 20:00

A slot missed because the server was down or the laptop was asleep is caught up
on the next tick, but only within 6 hours of the slot. Older misses are dropped
on purpose: a briefing fired half a day late is noise. A scheduled skill whose
last run failed, or that has missed two of its own cycles, raises a banner at
the top of the dashboard and a warning in the next morning briefing.

Edit the `schedule: { hour, minute, weekday? }` fields in
`server/skills/index.mjs` (weekday is JS `getDay()`: 0=Sun..6=Sat).
Disable all scheduling with `AGENTIC_OS_NO_SCHEDULE=1`.

## Which CLI runs a skill

A skill picks its backend with `agent: 'opencode'` (default since 2026-08-30,
previously `'claude'`). Every adapter lives in `server/lib/agents.mjs` — argv
builder plus a parser that normalizes the CLI's output into the same
`{t:'init'|'assistant'|'result'}` events the dashboard already renders.
Override default via `AGENTIC_OS_AGENT=claude` env.

| agent | CLI | output | verified |
|---|---|---|---|
| `claude` | Claude Code | `--output-format stream-json` | yes |
| `agy` | Antigravity | plain text (`--print`) | yes |
| `opencode` | opencode | plain text (`run`) | yes |
| `cursor` | cursor-agent | stream-json (same envelope as Claude) | startup only, account out of quota |
| `copilot` | GitHub Copilot CLI | `--output-format json` (NDJSON) | startup + error only, monthly quota exceeded |

Caveats worth knowing before switching a skill over:

- `allowedTools` is Claude syntax. Other CLIs get their own coarse equivalent
  (`--force`, `--allow-all-tools`, `--mode accept-edits`), so a skill that
  leans on a tight tool allowlist is safest left on `claude`.
- `opencode run` auto-rejects every permission prompt, so write skills need
  the `--dangerously-skip-permissions` the adapter adds for `acceptEdits`.
- Cost metrics now merge `~/.claude` (Claude) + `opencode-stable.db` (opencode).
  Free 9router/opencode models still report $0.00; use `server/lib/opencode-usage.mjs` to adjust pricing if needed.
- Per-agent model override: `models: { opencode: '9router/gemini/gemini-3.5-flash-lite' }` on the skill (since 2026-08-30 skills use `9router/gemini/gemini-3.5-flash-lite` for quick tasks and `9router/free-default` for heavy ones).

## Always-on + phone access (deploy)

This app runs *on the laptop* — it shells out to the `claude` binary and
reads/writes `~/.claude` and the vault on local disk, so it can't go to a
normal cloud host. "Deploy" means: run it persistently and reach it over
your tailnet.

```bash
./deploy/install.sh          # build + install a systemd user service + linger
tailscale serve --bg 4177    # expose localhost:4177 over HTTPS on the tailnet
```

`deploy/install.sh` installs `deploy/agentic-os.service` as a **systemd user
service** (`systemctl --user`), enables it, and turns on linger so it keeps
running after logout and across reboots. Because it runs persistently, the
scheduled skills (briefing/journaler/sweep) actually fire on their own.

`tailscale serve --bg 4177` proxies the localhost port to
`https://<machine>.<tailnet>.ts.net` — reachable from your phone and other
tailnet devices with TLS, and **only** by devices on your tailnet. The
server keeps binding `127.0.0.1`, so it never listens on a routable
interface directly.

Manage it:

```bash
systemctl --user restart agentic-os      # after pulling code changes
journalctl --user -u agentic-os -f       # live logs
tailscale serve --bg off                 # stop tailnet exposure
```

Do NOT use `tailscale funnel` (public internet) or bind `0.0.0.0` on an
untrusted network — anyone who reaches the port can spawn Claude runs.

### Alternative: direct tailnet bind (no HTTPS)

If you'd rather skip `tailscale serve`, bind the tailnet IP directly. The
service file would use `Environment=AGENTIC_OS_HOST=<tailscale-ip>` and you'd
reach it at `http://<tailscale-ip>:4177`. Less clean (no TLS, IP:port URL,
and the bind depends on tailscaled being up first), so the serve route above
is preferred.

## Configuration

Defaults live in `server/config.mjs`, overridable via env:

| env | default |
|-----|---------|
| `AGENTIC_OS_PORT` | `4177` |
| `AGENTIC_OS_HOST` | `127.0.0.1` |
| `AGENTIC_OS_NO_SCHEDULE` | unset (scheduler on) |
| `CLAUDE_DIR` | `~/.claude` |
| `PROJECTS_ROOT` | `~/Projects` |
| `VAULT_DIR` | `~/Projects/secondbrain` |
| `CLAUDE_BIN` | `claude` |
| `OPENCODE_BIN` | `/etc/profiles/per-user/ravi/bin/opencode` |
| `AGENTIC_OS_AGENT` | `opencode` (since 2026-08-30) |

Skills are plain objects in `server/skills/index.mjs` — prompt template,
cwd, allowed tools, permission mode, model, timeout. Add a new one-click
skill by appending to the array; the UI picks it up automatically.

Skills run with `cwd` set to the vault so the vault's own `CLAUDE.md`
protocol and SessionStart hook apply (Bahasa santai, wikilinks, INDEX.md
upkeep). Server-side deterministic context (git sweep, today's activity
digest) is injected into prompts so runs don't waste turns rediscovering
facts.

## Architecture

```
server/               express, plain ESM, no build step
  config.mjs          paths + env overrides (port, agent, opencode bin)
  lib/usage.mjs       Claude transcript aggregation (mtime-keyed disk cache,
                      dedupe by message.id, cost estimation)
  lib/opencode-usage.mjs  opencode sqlite aggregation (since 2026-08-30,
                          merges with Claude usage for dashboard)
  lib/activity.mjs    history.jsonl heatmap, stats-cache, live sessions
  lib/vault.mjs       vault walk: streak, orphans (wikilink graph), inbox
  lib/projects.mjs    git sweep of ~/Projects + memory hooks
  lib/runner.mjs      spawn agent (opencode/claude), distill output, SSE, run log
  skills/index.mjs    the one-click skill registry (now default agent: opencode)
src/                  react + tailwind v4, custom SVG charts, lucide icons
data/                 usage cache + run history (gitignored)
```

Run transcripts persist to `data/runs/*.ndjson`; the ops-log index is
`data/runs/index.jsonl`.
