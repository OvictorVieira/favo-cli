import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runTerminalPlan } from '@/run-terminal-plan';
import { removeFolder } from './support/remove-folder';

let root: string;

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/favo-plan-`).replaceAll('\\', '/');
});

afterEach(() => removeFolder(root));

function planWith(pidFile: string) {
  return { command: process.execPath, args: ['--version'], env: {}, unsetEnv: [], pidFile };
}

describe('the pid file around a provider', () => {
  it('is gone once the provider has exited', async () => {
    const pidFile = `${root}/running/work/claude/launch`;
    expect(await runTerminalPlan(planWith(pidFile), process.env)).toEqual({ exitCode: 0, rateLimitDetected: false });
    expect(existsSync(pidFile)).toBe(false);
  });
  it('never gets in the way of the launch when it cannot be written', async () => {
    writeFileSync(`${root}/running`, 'a file where a folder should be');
    expect(await runTerminalPlan(planWith(`${root}/running/work/claude/launch`), process.env)).toEqual({
      exitCode: 0,
      rateLimitDetected: false,
    });
  });
  it('records a limited run without saving its output, prompt or environment', async () => {
    const result = await runTerminalPlan(
      {
        command: process.execPath,
        args: [
          '-e',
          `console.log("You've hit your 5-hour limit · resets 12:20am"); console.log('private-conversation'); setInterval(() => {}, 1000)`,
        ],
        env: { FAVO_HOME: root, FAVO_LAUNCH: 'launch-test', FAVO_ACCOUNT: 'work', ANTHROPIC_API_KEY: 'private-key' },
        unsetEnv: [],
      },
      {},
      { monitorLimits: 'claude' }
    );
    const file = readdirSync(`${root}/logs`)[0]!;
    const text = readFileSync(`${root}/logs/${file}`, 'utf8');
    const events = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(result.rateLimitDetected).toBe(true);
    expect(events.map(({ event }) => event)).toEqual([
      'provider_started',
      'provider_limit_detected',
      'provider_exited',
    ]);
    for (const event of events)
      expect(event).toMatchObject({ launchId: 'launch-test', account: 'work', provider: 'claude' });
    expect(events.at(-1)).toMatchObject({ exitCode: result.exitCode, rateLimitDetected: true });
    expect(text).not.toContain('private-conversation');
    expect(text).not.toContain('private-key');
    expect(text).not.toContain('console.log');
  });

  it.each([
    ['claude', "You've hit your 5-hour limit · resets 12:20am"],
    ['codex', "You've hit your usage limit."],
    ['antigravity', 'Quota exceeded for this model.'],
    ['opencode', 'Rate limit reached, retrying in 30s'],
    ['cursor', "You've hit your usage limit"],
    ['copilot', "You've hit your premium request limit"],
  ] as const)('returns control when %s keeps waiting after a limit', async (provider, message) => {
    const result = await runTerminalPlan(
      {
        command: process.execPath,
        args: [
          '-e',
          `process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); console.log(${JSON.stringify(message)}); setTimeout(() => process.exit(99), 4000)`,
        ],
        env: {},
        unsetEnv: [],
      },
      {},
      { monitorLimits: provider }
    );
    expect(result.rateLimitDetected).toBe(true);
    expect(result.exitCode).not.toBe(99);
  });

  it('keeps diagnostics in the caller favo home when a provider changes HOME', async () => {
    await runTerminalPlan(
      {
        command: process.execPath,
        args: ['--version'],
        env: { HOME: `${root}/isolated`, FAVO_LAUNCH: 'isolated-run' },
        unsetEnv: [],
      },
      { HOME: `${root}/caller` }
    );
    expect(readdirSync(`${root}/caller/.favo/logs`)).toHaveLength(1);
    expect(existsSync(`${root}/isolated/.favo`)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'stops the retrying provider subprocesses as well as the provider',
    async () => {
      const pidFile = `${root}/descendant.pid`;
      const descendant = `process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`;
      const parent = `process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); const child = Bun.spawn([process.execPath, '-e', ${JSON.stringify(descendant)}], {stdout: 'inherit', stderr: 'inherit'}); await Bun.write(${JSON.stringify(pidFile)}, String(child.pid)); await Bun.sleep(100); console.log('Rate limit reached, retrying in 30s'); setTimeout(() => process.exit(99), 4000);`;
      let pid: number | undefined;
      try {
        const result = await runTerminalPlan(
          { command: process.execPath, args: ['-e', parent], env: {}, unsetEnv: [] },
          {},
          { monitorLimits: 'opencode' }
        );
        pid = Number(readFileSync(pidFile, 'utf8'));
        expect(result.rateLimitDetected).toBe(true);
        expect(result.exitCode).not.toBe(99);
        let isAlive = true;
        for (let attempt = 0; attempt < 20 && isAlive; attempt++) {
          try {
            process.kill(pid, 0);
            await Bun.sleep(25);
          } catch {
            isAlive = false;
          }
        }
        expect(isAlive).toBe(false);
      } finally {
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
      }
    }
  );

  it('waits for the first provider output before handing the screen over', async () => {
    const started = `${root}/started`;
    const release = `${root}/release`;
    let handovers = 0;
    const run = runTerminalPlan(
      {
        command: process.execPath,
        args: [
          '-e',
          `await Bun.write(${JSON.stringify(started)}, 'started'); while (!(await Bun.file(${JSON.stringify(release)}).exists())) await Bun.sleep(10); console.log('agent first screen');`,
        ],
        env: {},
        unsetEnv: [],
      },
      {},
      {
        onReady: async () => {
          handovers++;
        },
      }
    );
    await until(() => existsSync(started), 'the agent started without displaying output');
    expect(handovers).toBe(0);
    writeFileSync(release, 'go');
    expect((await run).exitCode).toBe(0);
    expect(handovers).toBe(1);
  });

  it('keeps Favo on screen when the first output is an exhausted limit', async () => {
    let handovers = 0;
    const result = await runTerminalPlan(
      {
        command: process.execPath,
        args: ['-e', `console.log("You've hit your 5-hour limit"); setInterval(() => {}, 1000)`],
        env: {},
        unsetEnv: [],
      },
      {},
      {
        monitorLimits: 'claude',
        onReady: async () => {
          handovers++;
        },
      }
    );
    expect(result.rateLimitDetected).toBe(true);
    expect(handovers).toBe(0);
  });

  it('stops a provider if handing the screen over fails', async () => {
    await expect(
      runTerminalPlan(
        {
          command: process.execPath,
          args: ['-e', `console.log('agent first screen'); setInterval(() => {}, 1000)`],
          env: {},
          unsetEnv: [],
        },
        {},
        {
          onReady: async () => {
            throw new Error('terminal unavailable');
          },
        }
      )
    ).rejects.toThrow('terminal unavailable');
  });

  it('detects a usage limit from captured output when there is no terminal', async () => {
    const result = await runTerminalPlan(
      {
        command: process.execPath,
        args: ['-e', "console.log('You have hit your usage limit'); setInterval(() => {}, 1000)"],
        env: {},
        unsetEnv: [],
      },
      process.env,
      { monitorLimits: 'claude' }
    );
    expect(result.rateLimitDetected).toBe(true);
  });
});

async function until(condition: () => boolean, what: string) {
  for (let waited = 0; waited < 5_000 && !condition(); waited += 25) await Bun.sleep(25);
  expect(condition(), what).toBe(true);
}

describe('a provider launched from the comb, on a real terminal', () => {
  it.each(['claude', 'codex', 'antigravity', 'opencode', 'cursor', 'copilot'])(
    'keeps %s at the terminal size when the panel resizes during loading',
    async (provider) => {
      let screen = '';
      const decoder = new TextDecoder();
      const harness = Bun.spawn([process.execPath, `${import.meta.dir}/support/pty-resize.ts`, provider, root], {
        terminal: {
          cols: 80,
          rows: 24,
          data(_terminal, data) {
            screen += decoder.decode(data);
          },
        },
      });
      try {
        await until(() => existsSync(`${root}/started`), 'the provider initialized its terminal');
        harness.terminal?.resize(100, 40);
        await until(() => existsSync(`${root}/parent-resized`), 'Favo received the panel resize');
        writeFileSync(`${root}/release`, 'go');
        await until(() => screen.includes('provider-size'), 'the provider drew its input area');
        expect(screen).toContain('provider-size 100x40');
        harness.terminal?.write('done\r');
        expect(await harness.exited).toBe(0);
      } finally {
        harness.kill();
        harness.terminal?.close();
      }
    }
  );

  it('receives what is typed, although the comb paused stdin when it stepped aside', async () => {
    let screen = '';
    const decoder = new TextDecoder();
    const harness = Bun.spawn([process.execPath, `${import.meta.dir}/support/pty-launch.ts`], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          screen += decoder.decode(data);
        },
      },
    });

    await until(() => screen.includes('provider-up'), 'the provider showed its screen');
    expect(screen.indexOf('favo-handover')).toBeLessThan(screen.indexOf('provider-up'));
    harness.terminal?.write('hello\r');

    await until(() => screen.includes('provider got hello'), 'the provider received the keys');
    expect(await harness.exited).toBe(0);
    harness.terminal?.close();
  });
  it.each(['limit', 'startup-limit', 'codex-limit'])('returns from a %s on the real terminal', async (mode) => {
    let screen = '';
    const decoder = new TextDecoder();
    const harness = Bun.spawn([process.execPath, `${import.meta.dir}/support/pty-launch.ts`, mode], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          screen += decoder.decode(data);
        },
      },
    });

    await until(() => screen.includes('RESULT '), 'the run finished by itself');

    if (mode === 'limit' || mode === 'codex-limit') expect(screen).toContain('provider-up');
    else expect(screen).not.toContain('favo-handover');
    expect(screen).toMatch(/RESULT \{[^}]*"rateLimitDetected":true/);
    expect(await harness.exited).toBe(0);
    harness.terminal?.close();
  });
});
