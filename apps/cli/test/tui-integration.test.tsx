import { afterEach, describe, expect, test } from 'bun:test';
import { App } from '@favo/client/App';
import { bootstrapAppContainer } from '@favo/client/shared/container/app';
import { useApp } from '@favo/client/shared/stores/app';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { listAccounts } from '@favo/contracts/rpc/accounts/list-accounts';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { recordThread } from '@favo/contracts/rpc/threads/record-thread';
import { recordProviderUpdate } from '@favo/contracts/rpc/updates/record-provider-update';
import { LoginState } from '@favo/contracts/rpc/views';
import { encodeArguments, type TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { createTestServer, Home, seedClaudeBase } from '@favo/server/test/support/test-server';
import { testRender } from '@opentui/react/test-utils';

const writeError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes('not wrapped in act')) writeError(...args);
};

let dispose: (() => Promise<void>) | undefined;

async function openFleet(
  callerEnv?: Record<string, string>,
  options: { rateLimited?: boolean; failRun?: number; alsoSignedIn?: ('codex' | 'antigravity' | 'opencode')[] } = {}
) {
  const mac = createTestServer({ callerEnv });
  const devbox = createTestServer({ hostname: 'devbox' });
  await seedClaudeBase(mac.fileSystem);
  await seedClaudeBase(devbox.fileSystem);
  await mac.client.call(createAccount, { name: 'work' });
  await mac.client.call(addMachine, { target: 'bee@devbox' });
  mac.remotes.connect('devbox', devbox.router);
  mac.clis.claude.login = { login: LoginState.signedIn, identity: 'mac@bee.dev', plan: 'max' };
  for (const provider of options.alsoSignedIn ?? []) {
    mac.clis[provider].login = { login: LoginState.signedIn, identity: `mac@${provider}.dev` };
    await mac.client.call(provisionSeat, { account: 'work', provider });
  }
  devbox.clis.claude.login = { login: LoginState.signedIn, identity: 'devbox@bee.dev' };
  const copied: string[] = [];
  const plans: TerminalPlan[] = [];
  bootstrapAppContainer({
    transport: mac.router,
    clipboardGateway: {
      async copy(text) {
        copied.push(text);
        return true;
      },
    },
    terminalGateway: {
      async run(plan) {
        plans.push(plan);
        if (plans.length === options.failRun) throw new Error('could not start the provider');
        return { exitCode: 0, rateLimitDetected: options.rateLimited === true && plans.length === 1 };
      },
    },
  });
  useApp.setState(useApp.getInitialState(), true);
  const view = await testRender(<App onQuit={() => {}} />, { width: 130, height: 36, useMouse: true });
  dispose = view.dispose;
  await view.waitForFrame((frame) => frame.includes('devbox@bee.dev') && frame.includes('mac@bee.dev'));
  await readsSettled();
  await view.flush();
  return { ...view, mac, devbox, copied, plans };
}

async function plansReach(plans: unknown[], count: number) {
  for (let wait = 0; wait < 200 && plans.length < count; wait++) await Bun.sleep(10);
  expect(plans).toHaveLength(count);
}

async function readsSettled() {
  while (useApp.getState().isLimitsReading || useApp.getState().isProviderClisReading) await Bun.sleep(1);
}

async function tokensSettled() {
  await Bun.sleep(5);
  while (useApp.getState().isTokensReading) await Bun.sleep(1);
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe('updating the provider CLIs from the comb', () => {
  test('starts favo in the background on every machine, and follows it until each CLI is done', async () => {
    const view = await openFleet();
    view.mac.processes.reply('/usr/bin/claude --version', { stdout: '2.1.316 (Claude Code)\n' });
    view.devbox.processes.reply('/usr/bin/claude --version', { stdout: '2.1.290 (Claude Code)\n' });
    await useApp.getState().refreshProviderClis();
    function startsOn(server: typeof view.mac) {
      return server.processes.calls.filter(({ command, args }) => command === 'favo' && args[0] === 'update');
    }
    const run = useApp.getState().updateProviderClis();
    await view.waitFor(() => startsOn(view.mac).length === 1 && startsOn(view.devbox).length === 1);
    expect(startsOn(view.devbox)[0]?.args.slice(0, 6)).toEqual([
      'update',
      '--skip-favo',
      '--machine',
      'local',
      '--provider',
      'claude',
    ]);
    const updating = await view.waitForFrame((frame) => /[⬡⬢] updating · /.test(frame));
    expect(updating).toContain('devbox updating…');
    view.devbox.processes.reply('/usr/bin/claude --version', { stdout: '2.1.316 (Claude Code)\n' });
    for (const provider of ['claude', 'codex', 'antigravity', 'opencode'] as const) {
      await view.mac.client.call(recordProviderUpdate, { provider });
      await view.devbox.client.call(recordProviderUpdate, { provider });
    }
    expect(await run).toEqual([]);
    await view.waitForFrame((frame) => frame.includes('updated from 2.1.290'));
    expect(useApp.getState().toast?.message).toBe('Updated Claude Code on devbox.');
  });
  test('reads each machine on its own favo, and shows the last update recorded there', async () => {
    const view = await openFleet();
    view.mac.processes.reply('/usr/bin/claude --version', { stdout: '2.1.316 (Claude Code)\n' });
    view.devbox.processes.reply('/usr/bin/claude --version', { stdout: '2.1.290 (Claude Code)\n' });
    const outcome = { state: 'failed' as const, from: '2.1.290', reason: 'exit 1' };
    await view.devbox.client.call(recordProviderUpdate, { provider: 'claude', outcome });
    await useApp.getState().refreshProviderClis();
    view.mockInput.pressKey('v');
    await view.waitForFrame((frame) => /devbox\s+2\.1\.290 older/.test(frame));
    expect(view.captureCharFrame()).toContain('the last update failed, exit 1');
    expect(view.captureCharFrame()).toMatch(/macbook\s+2\.1\.316\s+own install at \/usr\/bin\/claude/);
  });
});

describe('threads on a real backend', () => {
  test('shows the thread of a seat and goes back to it, in its folder', async () => {
    const view = await openFleet({
      FAVO_ACCOUNT: 'personal',
      FAVO_LAUNCH: 'l1',
    });
    await view.mac.fileSystem.ensureDirectory(`${Home}/projects/hive`);
    await view.mac.client.call(recordThread, {
      provider: 'claude',
      id: '11111111-2222-4333-8444-00000000abcd',
      directory: `${Home}/projects/hive`,
      isFresh: true,
    });
    await useApp.getState().loadSelectedThreads();
    await view.waitForFrame((frame) => frame.includes('0000abcd'));
    view.mockInput.pressKey('b');
    await view.waitFor(() => view.plans.length === 1);
    expect(view.plans[0]?.args).toContain('11111111-2222-4333-8444-00000000abcd');
    expect(view.plans[0]?.cwd).toBe(`${Home}/projects/hive`);
  });
  test('offers to install the hook, and writes it to the machine you are on', async () => {
    const view = await openFleet();
    await view.waitForFrame((frame) => frame.includes('press b to remember them'));
    view.mockInput.pressKey('b');
    await view.flush();
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('remember threads');
    expect(await view.mac.fileSystem.readText(`${Home}/.claude/settings.json`)).toBe('{}');
    view.mockInput.pressKey('y');
    await view.waitFor(() => useApp.getState().toast !== undefined);
    expect(await view.mac.fileSystem.readText(`${Home}/.claude/settings.json`)).toContain('favo-hook:claude');
  });
  test('resumes on the other machine through favo there', async () => {
    const view = await openFleet();
    await view.devbox.fileSystem.ensureDirectory(`${Home}/srv`);
    useApp.getState().selectRow('seat:devbox/personal/claude');
    await view.flush();
    const seat = useApp.getState().selectedSeat!;
    const thread = {
      id: 'abc',
      directory: `${Home}/srv`,
      updatedAt: '2026-10-31T12:00:00.000Z',
      isGuess: false,
      isDirectoryGone: false,
    };
    await useApp.getState().resumeSeatThread(seat, thread);
    const encoded = encodeArguments(['--dir', `${Home}/srv`, 'resume', 'claude', 'personal', 'abc']);
    expect(view.plans[0]?.args.at(-1)).toBe(`~/.favo/bin/favo --argv-b64 ${encoded}`);
  });
});

describe('usage on a real backend', () => {
  const session = { id: 'five_hour', kind: 'session' as const, label: 'Session', usedPercent: 32 };

  test('reads both machines through the contracts', async () => {
    const { mac, devbox, flush, mockInput, waitForFrame } = await openFleet();
    mac.clis.claude.limitsReading = { windows: [session] };
    devbox.clis.claude.limitsReading = { windows: [{ ...session, usedPercent: 7 }] };
    mockInput.pressKey('u');
    await flush();
    mockInput.pressKey('r');
    await readsSettled();
    await waitForFrame((frame) => frame.includes('81% left') && frame.includes('devbox read'));
  });
  test('shows a machine with no such method as older favo, and keeps the rest', async () => {
    const { mac, flush, mockInput, waitForFrame } = await openFleet();
    mac.clis.claude.limitsReading = { windows: [session] };
    mac.remotes.connect('devbox', {
      send: async ({ id, method }) => {
        if (method === 'seats.usage') {
          return { id, ok: false, error: { code: 'unknownMethod', message: `Unknown method "${method}".` } };
        }
        return { id, ok: true, result: [] };
      },
    });
    mockInput.pressKey('u');
    await flush();
    mockInput.pressKey('r');
    await readsSettled();
    await waitForFrame((frame) => frame.includes('devbox older favo') && frame.includes('68% left'));
  });
});

describe('tokens on a real backend', () => {
  function claudeLine(id: string, output: number) {
    const usage = { input_tokens: 1_000_000, cache_read_input_tokens: 20_000_000, output_tokens: output };
    return {
      type: 'assistant',
      timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      requestId: `req_${id}`,
      sessionId: `session-${id}`,
      message: { id: `msg_${id}`, model: 'claude-test-1', usage },
    };
  }

  test('counts both machines through the contracts, prices them here and remembers the tab', async () => {
    const { mac, devbox, flush, mockInput, waitForFrame } = await openFleet();
    mac.priceSource.table = { 'claude-test-1': { input_cost_per_token: 0.000003, output_cost_per_token: 0.000015 } };
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/one.jsonl`, [claudeLine('one', 1_000_000)]);
    devbox.tokenLogs.write(`${Home}/.claude/projects/hive/two.jsonl`, [claudeLine('two', 3_000_000)]);
    mockInput.pressKey('u');
    await flush();
    mockInput.pressKey('t');
    await flush();
    mockInput.pressKey('r');
    await tokensSettled();
    await waitForFrame((frame) => frame.includes('46M tokens      2 sessions      $186.00 at API prices'));
    await waitForFrame((frame) => /devbox +█+░+\s+24M\s+52%/.test(frame) && frame.includes('read just now'));
    expect(devbox.priceSource.fetches).toBe(0);
    expect(JSON.parse((await mac.fileSystem.readText(mac.paths.configFile))!).usageView).toEqual({
      page: 'tokens',
      period: '30d',
    });
    expect(await mac.fileSystem.list(mac.paths.keptTokenUsage)).toEqual(['devbox.json']);
  });
  test('shows a machine with no such method as older favo, and keeps the rest', async () => {
    const { mac, flush, mockInput, waitForFrame } = await openFleet();
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/one.jsonl`, [claudeLine('one', 1_000_000)]);
    mac.remotes.connect('devbox', {
      send: async ({ id, method }) => {
        if (method.startsWith('usage.')) {
          return { id, ok: false, error: { code: 'unknownMethod', message: `Unknown method "${method}".` } };
        }
        return { id, ok: true, result: [] };
      },
    });
    mockInput.pressKey('u');
    await flush();
    mockInput.pressKey('t');
    await flush();
    mockInput.pressKey('r');
    await tokensSettled();
    await waitForFrame((frame) => /devbox +older favo/.test(frame) && frame.includes('22M tokens'));
  });
});

describe('the TUI on a real backend', () => {
  test('shows both machines through the contracts', async () => {
    const { captureCharFrame } = await openFleet();
    const frame = captureCharFrame();
    expect(frame).toContain('macbook · this machine');
    expect(frame).toContain('devbox · bee@devbox');
    expect(frame).toContain('work');
  });
  test('inspects real links for the selected seat', async () => {
    const { waitForFrame } = await openFleet();
    await waitForFrame((frame) => frame.includes('✓ CLAUDE.md'));
  });
  test('copies a provisioned path, creating its links first', async () => {
    const { mac, copied, mockInput, flush, waitFor } = await openFleet();
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    mockInput.pressKey('c');
    await waitFor(() => copied.length === 1);
    const path = `${Home}/.favo/accounts/work/claude`;
    expect(copied).toEqual([path]);
    expect((await mac.fileSystem.entry(`${path}/CLAUDE.md`)).kind).toBe('link');
  });
  test('launches this machine with the seat isolated', async () => {
    const { plans, mockInput, flush, waitFor } = await openFleet();
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    mockInput.pressKey('RETURN');
    await waitFor(() => plans.length === 1);
    expect(plans[0]?.command).toBe('/usr/bin/claude');
    expect(plans[0]?.env.CLAUDE_CONFIG_DIR).toBe(`${Home}/.favo/accounts/work/claude`);
  });
  describe('when a launch reports a usage limit', () => {
    async function limitedLaunch() {
      const view = await openFleet(undefined, { rateLimited: true, alsoSignedIn: ['codex', 'opencode'] });
      useApp.getState().selectRow('seat:local/work/claude');
      await view.flush();
      await useApp.getState().launchSelectedSeat();
      await view.waitForFrame((frame) => frame.includes('provider usage limit'));
      return view;
    }

    test('offers the signed-in providers of the same account, and no other', async () => {
      const view = await limitedLaunch();
      const frame = view.captureCharFrame();
      expect(frame).toContain('Claude Code reached its limit');
      expect(frame.match(/limit unavailable/g)).toHaveLength(2);
      expect(frame).toContain('Codex');
      expect(frame).toContain('OpenCode');
      expect(frame).not.toContain('Antigravity ·');
    });
    test('stops when asked, and starts nothing', async () => {
      const view = await limitedLaunch();
      view.mockInput.pressKey('q');
      await view.waitForFrame((frame) => !frame.includes('provider usage limit'));
      expect(view.plans).toHaveLength(1);
      expect(useApp.getState().pendingHandoff).toBeUndefined();
    });
    test('tells the user when the next provider cannot start, and keeps the choice open', async () => {
      const view = await openFleet(undefined, { rateLimited: true, failRun: 2, alsoSignedIn: ['codex'] });
      useApp.getState().selectRow('seat:local/work/claude');
      await view.flush();
      await useApp.getState().launchSelectedSeat();
      await view.waitForFrame((frame) => frame.includes('provider usage limit'));

      view.mockInput.pressKey('RETURN');
      await view.waitForFrame((frame) => frame.includes('could not start the provider'));

      expect(view.captureCharFrame()).toContain('provider usage limit');
      expect(useApp.getState().pendingHandoff).toBeDefined();
    });
    test('continues in the provider it points at, in the same folder, with a prompt about the first one', async () => {
      const view = await limitedLaunch();
      view.mockInput.pressKey('RETURN');
      await plansReach(view.plans, 2);
      expect(view.plans[1]?.command).toBe('/usr/bin/codex');
      expect(view.plans[1]?.cwd).toBe(view.plans[0]?.cwd);
      expect(view.plans[1]?.args.at(-1)).toContain('Claude Code');
    });
  });
  describe('the chat screen', () => {
    async function openChat(alsoSignedIn: ('codex' | 'antigravity' | 'opencode')[] = []) {
      const view = await openFleet(undefined, { alsoSignedIn });
      useApp.getState().selectRow('seat:local/work/claude');
      await view.flush();
      view.mockInput.pressKey('w');
      await view.waitForFrame((frame) => frame.includes('chat with Claude Code'));
      return view;
    }

    async function say(view: Awaited<ReturnType<typeof openChat>>, text: string) {
      await view.mockInput.typeText(text);
      view.mockInput.pressKey('RETURN');
      await view.waitForFrame((frame) => frame.includes(text));
    }

    test('opens a chat for the selected seat and shows what the provider answers', async () => {
      const view = await openChat();
      await say(view, 'Hello');
      await view.waitForFrame((frame) => frame.includes('ok'));
      expect(view.mac.chatRunners.claude.sent).toEqual(['Hello']);
      expect(view.mac.chatRunners.claude.started[0]?.env.CLAUDE_CONFIG_DIR).toBe(`${Home}/.favo/accounts/work/claude`);
    });
    test('changes the provider with tab, and the next one receives the conversation', async () => {
      const view = await openChat(['codex']);
      await say(view, 'Hello');
      await view.waitForFrame((frame) => frame.includes('ok'));

      view.mockInput.pressKey('TAB');
      await view.waitForFrame((frame) => frame.includes('chat with Codex'));
      await say(view, 'More');

      await plansReach(view.mac.chatRunners.codex.sent, 1);
      const [first] = view.mac.chatRunners.codex.sent;
      expect(first).toContain('Hello');
      expect(first?.trimEnd().endsWith('More')).toBe(true);
      expect(view.mac.chatRunners.claude.endings).toBe(1);
    });
    test('resumes a saved chat after the client restarts and continues through another provider', async () => {
      const view = await openChat(['codex']);
      await say(view, 'Release only after the smoke test');
      await view.waitForFrame((frame) => frame.includes('ok'));
      const id = useApp.getState().chat!.id;
      await useApp.getState().closeChat();
      useApp.setState(useApp.getInitialState(), true);
      await useApp.getState().loadThemes();
      await useApp.getState().loadFleet();
      await view.flush();

      view.mockInput.pressKey('W');
      await view.waitForFrame((frame) => frame.includes('saved chats on this machine') && frame.includes('work'));
      view.mockInput.pressKey('RETURN');
      await view.waitForFrame((frame) => frame.includes('Release only after the smoke test'));
      expect(useApp.getState().chat?.id).toBe(id);
      expect(useApp.getState().chat?.account).toBe('work');

      view.mockInput.pressKey('TAB');
      await view.waitForFrame((frame) => frame.includes('chat with Codex'));
      await say(view, 'Continue the release');
      await plansReach(view.mac.chatRunners.codex.sent, 1);
      expect(view.mac.chatRunners.codex.sent[0]).toContain('Release only after the smoke test');
      expect(view.mac.chatRunners.codex.sent[0]).toContain('Continue the release');
    });
    test('goes back to the comb with escape and lets the provider process go', async () => {
      const view = await openChat();
      await say(view, 'Hello');
      view.mockInput.pressEscape();
      for (let wait = 0; wait < 100 && useApp.getState().chat !== undefined; wait++) await Bun.sleep(25);
      await view.flush();
      expect(view.captureCharFrame()).toContain('macbook · this machine');
      await plansReach(Array.from({ length: view.mac.chatRunners.claude.endings }), 1);
    });
    test('says so when the provider cannot chat yet', async () => {
      const view = await openFleet(undefined, { alsoSignedIn: ['antigravity'] });
      useApp.getState().selectRow('seat:local/work/antigravity');
      await view.flush();
      view.mockInput.pressKey('w');
      await view.waitForFrame((frame) => frame.includes('not available yet'));
      expect(view.captureCharFrame()).not.toContain('chat with Antigravity as work');
    });
  });
  test('launches the other machine through ssh', async () => {
    const { plans, mockInput, flush, waitFor } = await openFleet();
    useApp.getState().selectRow('seat:devbox/personal/claude');
    await flush();
    mockInput.pressKey('RETURN');
    await waitFor(() => plans.length === 1);
    expect(plans[0]?.command).toBe('ssh');
    const encoded = encodeArguments(['claude', 'personal']);
    expect(plans[0]?.args).toEqual(['-t', '--', 'bee@devbox', `~/.favo/bin/favo --argv-b64 ${encoded}`]);
  });
  test('creates an account on the machine you selected, not this one', async () => {
    const { devbox, mac, mockInput, flush, waitForFrame } = await openFleet();
    useApp.getState().selectRow('seat:devbox/personal/claude');
    await flush();
    mockInput.pressKey('a');
    await flush();
    await mockInput.typeText('side');
    await flush();
    mockInput.pressKey('RETURN');
    await waitForFrame((frame) => frame.includes('A new cell for side on devbox.'));
    expect((await devbox.fileSystem.list(`${Home}/.favo/accounts`)).includes('side')).toBe(true);
    expect((await mac.fileSystem.list(`${Home}/.favo/accounts`)).includes('side')).toBe(false);
  });
  test('renames a cell on the machine you selected, and leaves its folder alone', async () => {
    const { devbox, mac, mockInput, flush, waitForFrame } = await openFleet();
    await devbox.client.call(createAccount, { name: 'side' });
    await useApp.getState().refreshMachine('devbox');
    useApp.getState().selectRow('seat:devbox/side/claude');
    await flush();
    mockInput.pressKey('n');
    await flush();
    await mockInput.typeText('-two');
    await flush();
    mockInput.pressKey('RETURN');
    await waitForFrame((frame) => frame.includes('side is now side-two.'));
    const [, renamed] = await devbox.client.call(listAccounts, {});
    expect(renamed?.displayName).toBe('side-two');
    expect(await devbox.fileSystem.list(`${Home}/.favo/accounts`)).toEqual(['side']);
    expect((await mac.client.call(listAccounts, {})).map(({ displayName }) => displayName)).not.toContain('side-two');
  });
  test('offers an app only once the backend finds it, and opens it isolated', async () => {
    const { mac, mockInput, flush, renderOnce, captureCharFrame, waitForFrame } = await openFleet();
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    await renderOnce();
    expect(captureCharFrame()).not.toContain('p open');
    mac.desktopApps.install('claude');
    await useApp.getState().loadDesktopApps('local');
    await flush();
    await renderOnce();
    expect(captureCharFrame()).toContain('p open Claude');
    mockInput.pressKey('p');
    await waitForFrame((frame) => frame.includes('Claude is opening as work.'));
    expect(mac.desktopApps.opened[0]?.launch.env.CLAUDE_CONFIG_DIR).toBe(`${Home}/.favo/accounts/work/claude`);
  });
  test('shows the app signed in on another account, from what the app left in the seat', async () => {
    const { mac, flush, waitForFrame } = await openFleet();
    const app = JSON.stringify({ windowSizeWasSignedIn: true, lastKnownAccountUuid: 'uuid-app' });
    const cli = JSON.stringify({ oauthAccount: { accountUuid: 'uuid-cli' } });
    await mac.fileSystem.writePrivateText(`${Home}/.favo/accounts/work/claude-app/config.json`, app);
    await mac.fileSystem.writePrivateText(`${Home}/.favo/accounts/work/claude/.claude.json`, cli);
    mac.desktopApps.install('claude');
    await useApp.getState().refreshMachine('local');
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    const frame = await waitForFrame((current) => current.includes('Claude app on another account'));
    expect(frame).toMatch(/mac@bee\.dev\s+app(?!\?)/);
    expect(frame).toMatch(/mac@bee\.dev\s+app\?/);
  });
  test('shows the Claude app of a seat on another machine, read there, without offering to open it', async () => {
    const { devbox, flush, waitForFrame } = await openFleet();
    const account = JSON.stringify({ oauthAccount: { accountUuid: 'uuid-devbox' } });
    const app = JSON.stringify({ windowSizeWasSignedIn: true, lastKnownAccountUuid: 'uuid-devbox' });
    await devbox.fileSystem.writePrivateText(`${Home}/.config/Claude/config.json`, app);
    await devbox.fileSystem.writePrivateText(`${Home}/.claude.json`, account);
    devbox.desktopApps.install('claude');
    await useApp.getState().refreshMachine('devbox');
    useApp.getState().selectRow('seat:devbox/personal/claude');
    await flush();
    const frame = await waitForFrame((current) => current.includes('Claude app signed in'));
    expect(frame).toMatch(/devbox@bee\.dev\s+app /);
    expect(frame).not.toContain('p open');
  });
  test('removes an account while the Claude app is installed, and says where it went', async () => {
    const { mac, flush, waitForFrame } = await openFleet();
    mac.desktopApps.install('claude');
    await useApp.getState().refreshMachine('local');
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    await useApp.getState().removeSelectedAccount();
    await waitForFrame((frame) => frame.includes('work moved to'));
    expect((await mac.client.call(listAccounts, {})).map(({ name }) => name)).not.toContain('work');
  });
  test('carries a confirmed close all the way to the backend', async () => {
    const { mac, mockInput, flush, waitForFrame, waitFor } = await openFleet();
    mac.desktopApps.install('claude');
    mac.desktopApps.run('claude');
    await useApp.getState().loadDesktopApps('local');
    useApp.getState().selectRow('seat:local/work/claude');
    await flush();
    mockInput.pressKey('p');
    await waitForFrame((frame) => frame.includes('Close it and reopen as work?'));
    expect(mac.desktopApps.quitCalls).toEqual([]);
    mockInput.pressKey('y');
    await waitFor(() => mac.desktopApps.opened.length === 1);
    expect(mac.desktopApps.quitCalls).toEqual(['claude']);
  });
  test('shows a real backend error as a toast', async () => {
    const { mockInput, flush, waitForFrame } = await openFleet();
    useApp.getState().selectRow('seat:local/personal/antigravity');
    await flush();
    mockInput.pressKey('o');
    await waitForFrame((frame) => frame.includes('Antigravity has no sign-out command.'));
  });
});
