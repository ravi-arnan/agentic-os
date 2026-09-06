import { describe, test, expect } from 'vitest';
import { AGENTS, getAgent, distillCopilotEvent, distillCmdEvent } from '../lib/agents.mjs';

const skill = { id: 'quick-capture', permissionMode: 'acceptEdits', allowedTools: ['Read', 'Write'] };

describe('agent argv', () => {
  test('claude keeps the flags it always used', () => {
    const args = AGENTS.claude.args({ ...skill, model: 'sonnet' }, 'halo');
    expect(args).toEqual([
      '-p', 'halo',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read', 'Write',
      '--model', 'sonnet',
    ]);
  });

  test('cursor trusts the cwd and defaults to Auto (free plans reject named models)', () => {
    const args = AGENTS.cursor.args(skill, 'halo');
    expect(args).toContain('--trust');
    expect(args[args.indexOf('--model') + 1]).toBe('auto');
    expect(args).toContain('--force');
  });

  test('opencode needs the permission override or it silently rejects every write', () => {
    expect(AGENTS.opencode.args(skill, 'halo')).toEqual([
      'run', 'halo', '--dangerously-skip-permissions',
    ]);
    // read-only skills must not get it
    expect(AGENTS.opencode.args({ ...skill, permissionMode: 'plan' }, 'halo')).toEqual(['run', 'halo']);
  });

  test('agy runs in accept-edits, not skip-permissions', () => {
    const args = AGENTS.agy.args(skill, 'halo');
    expect(args).toEqual(['--print', 'halo', '--mode', 'accept-edits']);
  });

  test('commandcode needs --yolo for write skills, plan for read-only', () => {
    // acceptEdits (default) -> --yolo: in headless mode only --yolo opens
    // writes (--auto-accept still denies, verified live 2026-08-30)
    const args = AGENTS.commandcode.args(skill, 'halo');
    expect(args).toEqual([
      '-p', 'halo',
      '--output-format', 'json',
      '--skip-onboarding',
      '--no-auto-update',
      '--yolo',
    ]);
    // read-only/plan stays read-only
    const planArgs = AGENTS.commandcode.args({ ...skill, permissionMode: 'plan' }, 'halo');
    expect(planArgs).toContain('--permission-mode');
    expect(planArgs).toContain('plan');
    expect(planArgs).not.toContain('--yolo');
  });

  test('unknown agent fails loudly instead of silently running claude', () => {
    expect(() => getAgent('gemini')).toThrow(/unknown agent/);
  });
});

describe('output parsing', () => {
  test('opencode banner is dropped, answer kept', () => {
    // real output: ANSI reset lines, "> build · big-pickle", then the answer
    expect(AGENTS.opencode.parse('[0m')).toBeNull();
    expect(AGENTS.opencode.parse('> build · big-pickle')).toBeNull();
    expect(AGENTS.opencode.parse('PONG')).toEqual({ t: 'assistant', text: 'PONG', tools: [] });
  });

  test('agy prints plain prose', () => {
    expect(AGENTS.agy.parse('PONG')).toEqual({ t: 'assistant', text: 'PONG', tools: [] });
  });

  test('copilot quota error surfaces as a note and a failed result', () => {
    // captured live 2026-07-29 from `copilot -p ... --output-format json`
    const err = {
      type: 'session.error',
      data: { errorType: 'quota', message: 'You have exceeded your monthly quota', statusCode: 402 },
    };
    expect(distillCopilotEvent(err)).toEqual({
      t: 'note',
      text: 'copilot quota: You have exceeded your monthly quota',
    });
    const result = {
      type: 'result',
      sessionId: '807fab2f',
      exitCode: 1,
      usage: { premiumRequests: 0, sessionDurationMs: 9839 },
    };
    expect(distillCopilotEvent(result)).toMatchObject({
      t: 'result', ok: false, turns: 0, durationMs: 9839, sessionId: '807fab2f', error: 'exit 1',
    });
  });

  test('copilot does not echo our own prompt back as assistant text', () => {
    const echo = { type: 'user.message', data: { text: 'Reply with PONG.' } };
    expect(distillCopilotEvent(echo)).toBeNull();
  });

  test('cursor reuses the claude envelope', () => {
    const init = {
      type: 'system', subtype: 'init', model: 'Auto', session_id: '9ad5293a', cwd: '/tmp',
    };
    expect(AGENTS.cursor.parse(init)).toEqual({ t: 'init', model: 'Auto', sessionId: '9ad5293a' });
  });

  test('commandcode frames distil to the shared event shape', () => {
    // captured live 2026-08-30 from `cmd -p ... --output-format json`
    expect(distillCmdEvent({ type: 'event', event: { type: 'run_start', sessionId: '58c4caf2' } }))
      .toEqual({ t: 'init', model: null, sessionId: '58c4caf2' });
    expect(distillCmdEvent({ type: 'event', event: { type: 'text_delta', delta: 'pong' } }))
      .toEqual({ t: 'assistant', text: 'pong', tools: [], _delta: true });
    const toolFrame = {
      type: 'event',
      event: {
        type: 'message_update',
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool_use', name: 'read_file', input: { file_path: '/tmp/package.json' } },
        ],
      },
    };
    expect(distillCmdEvent(toolFrame))
      .toEqual({ t: 'assistant', text: null, tools: [{ name: 'read_file', target: '/tmp/package.json' }] });
    const result = {
      type: 'result', subtype: 'success', sessionId: '58c4caf2', stopReason: 'end_turn',
      usage: { inputTokens: 14854, outputTokens: 41 }, durationMs: 3729, finalText: 'pong',
    };
    expect(distillCmdEvent(result)).toMatchObject({
      t: 'result', ok: true, text: 'pong', turns: 14854, durationMs: 3729, sessionId: '58c4caf2',
    });
  });

  test('commandcode failed runs surface subtype + error', () => {
    const failed = { type: 'result', subtype: 'error', error: 'auth required' };
    expect(distillCmdEvent(failed)).toMatchObject({ t: 'result', ok: false, error: 'auth required' });
  });
});

describe('text agents get a result', () => {
  test('assembled from the lines they printed', () => {
    const run = {
      startedAt: 0,
      endedAt: 1200,
      events: [{ t: 'assistant', text: 'PONG', tools: [] }],
    };
    expect(AGENTS.agy.result(run, 0)).toMatchObject({ t: 'result', ok: true, text: 'PONG' });
    expect(AGENTS.opencode.result(run, 1)).toMatchObject({ ok: false, error: 'exited 1' });
  });
});
