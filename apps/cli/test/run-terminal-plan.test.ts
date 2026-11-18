import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
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
    harness.terminal?.write('hello\r');

    await until(() => screen.includes('provider got hello'), 'the provider received the keys');
    expect(await harness.exited).toBe(0);
    harness.terminal?.close();
  });
  it('notices a usage limit in what the provider prints on the terminal, and stops it', async () => {
    let screen = '';
    const decoder = new TextDecoder();
    const harness = Bun.spawn([process.execPath, `${import.meta.dir}/support/pty-launch.ts`, 'limit'], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          screen += decoder.decode(data);
        },
      },
    });

    await until(() => screen.includes('RESULT '), 'the run finished by itself');

    expect(screen).toContain('provider-up');
    expect(screen).toMatch(/RESULT \{[^}]*"rateLimitDetected":true/);
    expect(await harness.exited).toBe(0);
    harness.terminal?.close();
  });
});
