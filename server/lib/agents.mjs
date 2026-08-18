/**
 * One adapter per CLI agent: how to launch it headless, and how to turn its
 * output into the single event shape the dashboard already speaks
 * ({t:'init'|'assistant'|'result'}).
 *
 * A skill picks its agent with `agent: 'opencode'` (default 'claude').
 *
 * Verified on this machine 2026-07-29: claude, agy and opencode ran a prompt
 * end to end. cursor-agent and copilot are wired from their real output too,
 * but both accounts are out of quota, so only their startup and error events
 * were observed live — see the notes on those adapters.
 */

const ANSI = /\x1b\[[0-9;]*m/g;

/** True when the skill wants unattended edits (the existing default). */
function autoApprove(skill) {
  const mode = skill.permissionMode || 'acceptEdits';
  return mode === 'acceptEdits' || mode === 'bypassPermissions';
}

/**
 * Claude Code stream-json. Also used for cursor-agent, which emits the same
 * system/user/assistant/result envelope.
 */
export function distillClaudeEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.type === 'system' && evt.subtype === 'init') {
    return { t: 'init', model: evt.model || null, sessionId: evt.session_id || null };
  }
  if (evt.type === 'assistant') {
    const content = evt.message?.content;
    if (!Array.isArray(content)) return null;
    const text = content
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join('');
    const tools = content
      .filter((c) => c?.type === 'tool_use')
      .map((c) => ({
        name: c.name,
        target:
          c.input?.file_path || c.input?.path || c.input?.command?.slice(0, 80) ||
          c.input?.pattern || null,
      }));
    if (!text && tools.length === 0) return null;
    return { t: 'assistant', text: text || null, tools };
  }
  if (evt.type === 'result') {
    // The CLI reports terminal API errors (expired OAuth, rate limit) as
    // subtype "success" with is_error set, so subtype alone is not enough:
    // trusting it recorded auth failures as healthy runs.
    const failed = evt.subtype !== 'success' || evt.is_error === true;
    return {
      t: 'result',
      ok: !failed,
      text: typeof evt.result === 'string' ? evt.result : null,
      costUSD: evt.total_cost_usd ?? null,
      turns: evt.num_turns ?? null,
      durationMs: evt.duration_ms ?? null,
      sessionId: evt.session_id ?? null,
      error: failed
        ? (evt.subtype !== 'success' ? evt.subtype : evt.terminal_reason || 'is_error')
        : null,
    };
  }
  return null;
}

/** GitHub Copilot CLI --output-format json (NDJSON, one event per line). */
export function distillCopilotEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  // our own prompt comes back as an event; the text fallback below would
  // otherwise replay it as if the model had said it
  if (evt.type === 'user.message') return null;
  if (evt.type === 'session.auto_mode_resolved') {
    return { t: 'init', model: evt.data?.model || null, sessionId: evt.sessionId || null };
  }
  if (evt.type === 'session.error') {
    return { t: 'note', text: `copilot ${evt.data?.errorType || 'error'}: ${evt.data?.message || ''}`.trim() };
  }
  if (evt.type === 'tool.invoked' || evt.type === 'tool.call_start') {
    return { t: 'assistant', text: null, tools: [{ name: evt.data?.name || 'tool', target: null }] };
  }
  if (evt.type === 'result') {
    const usage = evt.usage || {};
    return {
      t: 'result',
      ok: evt.exitCode === 0,
      text: null, // copilot prints the answer on stdout separately from the event stream
      costUSD: null, // billed in premium requests, not dollars
      turns: usage.premiumRequests ?? null,
      durationMs: usage.sessionDurationMs ?? null,
      sessionId: evt.sessionId ?? null,
      error: evt.exitCode === 0 ? null : `exit ${evt.exitCode}`,
    };
  }
  // ponytail: assistant text events were never observed (quota ran out before
  // the model answered), so fall back to any event carrying a text payload.
  const text = evt.data?.text || evt.data?.content;
  if (typeof text === 'string' && text.trim()) return { t: 'assistant', text, tools: [] };
  return null;
}

/** Agents that only print prose: keep the lines, build the result at exit. */
function plainTextLine(line, skipBanner) {
  const clean = line.replace(ANSI, '').trimEnd();
  if (!clean.trim()) return null;
  if (skipBanner && skipBanner.test(clean)) return null;
  return { t: 'assistant', text: clean, tools: [] };
}

/** Result for text-only agents, assembled from what they printed. */
function textResult(run, code) {
  const text = run.events
    .filter((e) => e.t === 'assistant' && e.text)
    .map((e) => e.text)
    .join('\n')
    .trim();
  return {
    t: 'result',
    ok: code === 0,
    text: text || null,
    costUSD: null,
    turns: null,
    durationMs: (run.endedAt || Date.now()) - run.startedAt,
    sessionId: null,
    error: code === 0 ? null : `exited ${code}`,
  };
}

export const AGENTS = {
  claude: {
    label: 'Claude Code',
    bin: (config) => config.claudeBin,
    mode: 'ndjson',
    args(skill, prompt) {
      const args = [
        '-p', prompt,
        '--output-format', 'stream-json',
        '--verbose',
        '--permission-mode', skill.permissionMode || 'acceptEdits',
      ];
      if (skill.allowedTools?.length) args.push('--allowedTools', ...skill.allowedTools);
      const model = skill.models?.claude || skill.model;
      if (model) args.push('--model', model);
      return args;
    },
    parse: distillClaudeEvent,
  },

  cursor: {
    label: 'Cursor CLI',
    bin: () => 'cursor-agent',
    mode: 'ndjson',
    args(skill, prompt) {
      // --trust: without it the CLI refuses any directory it has not seen in
      // the TUI. Free plans reject named models, so default to Auto.
      const args = [
        '--print', prompt,
        '--output-format', 'stream-json',
        '--trust',
        '--model', skill.models?.cursor || 'auto',
      ];
      if (autoApprove(skill)) args.push('--force');
      return args;
    },
    parse: distillClaudeEvent, // same envelope as Claude Code
  },

  copilot: {
    label: 'GitHub Copilot CLI',
    bin: () => 'copilot',
    mode: 'ndjson',
    args(skill, prompt) {
      const args = ['-p', prompt, '--output-format', 'json'];
      // No per-tool mapping: copilot's tool names are its own, and a skill's
      // allowedTools are written in Claude syntax. Unattended runs would hang
      // on the first prompt, so grant the lot inside the skill's cwd.
      if (autoApprove(skill)) args.push('--allow-all-tools');
      const model = skill.models?.copilot;
      if (model) args.push('--model', model);
      return args;
    },
    parse: distillCopilotEvent,
  },

  agy: {
    label: 'Antigravity CLI',
    bin: () => 'agy',
    mode: 'text',
    args(skill, prompt) {
      const args = ['--print', prompt];
      if (autoApprove(skill)) args.push('--mode', 'accept-edits');
      const model = skill.models?.agy;
      if (model) args.push('--model', model);
      return args;
    },
    parse: (line) => plainTextLine(line),
    result: textResult,
  },

  opencode: {
    label: 'opencode',
    bin: () => 'opencode',
    mode: 'text',
    args(skill, prompt) {
      const args = ['run', prompt];
      // `opencode run` auto-rejects every permission request, so a write skill
      // silently does nothing without this.
      // ponytail: coarse — opencode has no accept-edits middle ground yet.
      if (autoApprove(skill)) args.push('--dangerously-skip-permissions');
      const model = skill.models?.opencode;
      if (model) args.push('--model', model);
      return args;
    },
    // strips the "> build · big-pickle" header opencode prints before the answer
    parse: (line) => plainTextLine(line, /^>\s+\S+\s+·\s+/),
    result: textResult,
  },
};

export function getAgent(id) {
  const agent = AGENTS[id || 'claude'];
  if (!agent) throw new Error(`unknown agent "${id}" (have: ${Object.keys(AGENTS).join(', ')})`);
  return agent;
}
