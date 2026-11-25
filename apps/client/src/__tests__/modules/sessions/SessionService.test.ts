import { afterEach, describe, expect, jest, test } from 'bun:test';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';
import { container } from '@/shared/container';

describe('SessionService', () => {
  test('launches a signed in seat', async () => {
    const app = await getApp();
    await app.state.openSelectedSeat();
    expect(mockDb.terminalRuns).toEqual([{ command: 'claude', args: ['launch', 'personal'], env: {}, unsetEnv: [] }]);
  });
  test('offers a same-account provider after a limit and carries the transcript into its prompt', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    mockDb.threads['seat:local/personal/claude']![0]!.transcript = '/local/claude/session.jsonl';

    await app.state.launchSelectedSeat();

    expect(app.state.pendingHandoff?.source.provider).toBe('claude');
    expect(app.state.pendingHandoff?.transcript).toBe('/local/claude/session.jsonl');
    const codex = app.state.selectedAccount?.visibleSeats.find((seat) => seat.provider === 'codex');
    expect(codex?.isSignedIn).toBe(true);
    await app.state.continueHandoff(codex!);

    expect(mockDb.terminalRuns[1]?.args.at(-1)).toContain('/local/claude/session.jsonl');
    expect(mockDb.terminalRuns[1]?.args.at(-1)).toContain(mockDb.threads['seat:local/personal/claude']![0]!.id);
    expect(mockDb.terminalRuns[1]?.args.at(-1)).toContain(app.state.selectedSeat!.path);
    expect(app.state.pendingHandoff?.source.provider).toBe('codex');
  });
  test('hands over the exact launch even when another session in the same folder is newer', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    const [newer, limited] = mockDb.threads['seat:local/personal/claude']!;
    newer!.launchId = 'other-launch';
    newer!.transcript = '/local/other-session.jsonl';
    limited!.launchId = 'limited-launch';
    limited!.transcript = '/local/limited-session.jsonl';
    const repository = container.get('ITerminalRepository');
    const plan = repository.plan.bind(repository);
    repository.plan = async (...args) => {
      const result = await plan(...args);
      return { ...result, env: { ...result.env, FAVO_LAUNCH: 'limited-launch' } };
    };

    await app.state.launchSelectedSeat();

    expect(app.state.pendingHandoff?.sessionId).toBe(limited!.id);
    expect(app.state.pendingHandoff?.transcript).toBe('/local/limited-session.jsonl');
  });

  test('still offers a handoff when refreshing the exhausted provider fails', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    app.state.refreshSeat = async () => {
      throw new Error('usage unavailable');
    };
    await app.state.launchSelectedSeat();
    expect(app.state.pendingHandoff?.source.provider).toBe('claude');
  });

  test('prepares the limit dialog before restoring Favo and before refreshing provider status', async () => {
    const app = await getApp();
    const refreshed = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    app.state.refreshSeat = async () => {
      entered.resolve();
      await refreshed.promise;
    };
    container.get('ITerminalGateway').run = async (_plan, options) => {
      const result = { exitCode: 0, rateLimitDetected: true };
      options?.beforeResume?.(result);
      expect(app.state.pendingHandoff?.source.provider).toBe('claude');
      expect(app.state.sessionTransition).toBeUndefined();
      return result;
    };
    const running = app.state.launchSelectedSeat();
    await entered.promise;
    expect(app.state.pendingHandoff?.source.provider).toBe('claude');
    refreshed.resolve();
    await running;
  });

  test('a delayed source lookup never reopens its modal or clears loading for the chosen agent', async () => {
    const app = await getApp();
    const lookup = Promise.withResolvers<void>();
    const lookupStarted = Promise.withResolvers<void>();
    const target = Promise.withResolvers<void>();
    const targetStarted = Promise.withResolvers<void>();
    const threads = container.get('IThreadRepository');
    const getThreads = threads.getThreads.bind(threads);
    threads.getThreads = async (...args) => {
      lookupStarted.resolve();
      await lookup.promise;
      return getThreads(...args);
    };
    let runs = 0;
    container.get('ITerminalGateway').run = async (_plan, options) => {
      const isSource = ++runs === 1;
      if (!isSource) {
        targetStarted.resolve();
        await target.promise;
      }
      const result = { exitCode: 0, rateLimitDetected: isSource };
      options?.beforeResume?.(result);
      return result;
    };
    const sourceRun = app.state.launchSelectedSeat();
    await lookupStarted.promise;
    const codex = app.state.selectedAccount!.visibleSeats.find((seat) => seat.provider === 'codex')!;
    const targetRun = app.state.continueHandoff(codex);
    expect(app.state.sessionTransition?.label).toBe('Codex');
    lookup.resolve();
    await sourceRun;
    await targetStarted.promise;
    expect(app.state.sessionTransition?.label).toBe('Codex');
    expect(app.state.pendingHandoff).toBeUndefined();
    target.resolve();
    await targetRun;
    expect(app.state.sessionTransition).toBeUndefined();
  });

  test('keeps no folder for a handoff when the launch had none, so another machine is not sent this one', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    app.state.selectRow('seat:devbox/personal/claude');

    await app.state.launchSelectedSeat();

    expect(app.state.pendingHandoff?.directory).toBeUndefined();
    const codex = app.state.selectedAccount?.visibleSeats.find((seat) => seat.provider === 'codex');
    await app.state.continueHandoff(codex!);
    expect(mockDb.terminalRuns.at(-1)?.cwd).toBeUndefined();
  });
  test('hands the folder of the saved thread to the next provider, because that is where the work was', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    const thread = mockDb.threads['seat:local/personal/claude']![0]!;
    await app.state.launchSelectedSeat();
    expect(app.state.pendingHandoff?.directory).toBe(thread.directory);
  });
  test('stops the handoff when asked, and starts nothing', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    await app.state.launchSelectedSeat();
    app.state.closeHandoff();
    expect(app.state.pendingHandoff).toBeUndefined();
    await app.state.continueHandoff(app.state.selectedAccount!.visibleSeats[1]!);
    expect(mockDb.terminalRuns).toHaveLength(1);
  });
  test('offers no handoff when the launch did not hit a limit', async () => {
    const app = await getApp();
    await app.state.launchSelectedSeat();
    expect(app.state.pendingHandoff).toBeUndefined();
  });
  test('gives the handoff back when the next provider cannot start, so it can be tried again', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    await app.state.launchSelectedSeat();
    const handoff = app.state.pendingHandoff;
    const codex = app.state.selectedAccount?.visibleSeats.find((seat) => seat.provider === 'codex');
    const gateway = container.get('ITerminalGateway');
    gateway.run = () => Promise.reject(new Error('could not start'));
    await expect(app.state.continueHandoff(codex!)).rejects.toThrow('could not start');
    expect(app.state.pendingHandoff).toEqual(handoff);
  });
  test('starts the next provider with its own way of taking a first prompt', async () => {
    const app = await getApp();
    mockDb.terminalRateLimitDetected = true;
    await app.state.launchSelectedSeat();
    mockDb.terminalRateLimitDetected = false;
    const codex = app.state.selectedAccount?.visibleSeats.find((seat) => seat.provider === 'codex');
    await app.state.continueHandoff(codex!);
    expect(mockDb.terminalRuns.at(-1)?.args.at(-1)).toContain(
      'Continue work after Claude Code reached its usage limit.'
    );
  });
  test.each([
    ['copilot', ['--interactive']],
    ['cursor', []],
  ] as const)('starts %s with its own way of taking a first prompt', async (provider, flags) => {
    const app = await getApp();
    mockDb.accounts.local = mockDb.accounts.local!.map((account) => ({
      ...account,
      seats: account.seats.map((seat) => (seat.provider === provider ? { ...seat, isInstalled: true } : seat)),
    }));
    mockDb.seatStatuses[`seat:local/personal/${provider}`] = {
      login: 'signedIn',
      identity: 'bee@hive.dev',
      problems: 0,
    };
    await app.state.refreshMachine('local');
    mockDb.terminalRateLimitDetected = true;
    await app.state.launchSelectedSeat();
    mockDb.terminalRateLimitDetected = false;
    const next = app.state.selectedAccount?.visibleSeats.find((seat) => seat.provider === provider);
    expect(next?.isSignedIn).toBe(true);

    await app.state.continueHandoff(next!);

    const { args } = mockDb.terminalRuns.at(-1)!;
    expect(args.slice(2, -1)).toEqual([...flags]);
    expect(args.at(-1)).toContain('Continue work after Claude Code reached its usage limit.');
  });
  test('hands over the thread that was resumed, not whichever the list shows first', async () => {
    const app = await getApp();
    const [newest, older] = mockDb.threads['seat:local/personal/claude']!;
    newest!.transcript = '/local/claude/newest.jsonl';
    older!.transcript = '/local/claude/older.jsonl';
    older!.directory = '/Users/bee/other';
    mockDb.terminalRateLimitDetected = true;

    await app.state.resumeSeatThread(app.state.selectedSeat!, older!);

    expect(app.state.pendingHandoff?.transcript).toBe('/local/claude/older.jsonl');
    expect(app.state.pendingHandoff?.directory).toBe('/Users/bee/other');
  });
  test('launches with no folder on a machine named like an inherited property', async () => {
    const id: string = 'constructor';
    const app = await getApp();
    mockDb.machines.push({ id, name: id, target: `bee@${id}`, isLocal: false });
    mockDb.machineStatuses[id] = { state: 'online' };
    mockDb.accounts[id] = mockDb.accounts.devbox!;
    await app.state.loadFleet();
    app.state.selectRow(`seat:${id}/personal/claude`);
    expect(app.state.selectedSeat?.machineId).toBe(id);
    await app.state.launchSelectedSeat();
    expect(mockDb.terminalRuns.at(-1)?.cwd).toBeUndefined();
  });
  test('signs in a seat that is signed out, and refreshes it after', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/work/codex');
    mockDb.seatStatuses['seat:local/work/codex'] = { login: 'signedIn', identity: 'new@bee.dev', problems: 0 };
    await app.state.openSelectedSeat();
    expect(mockDb.terminalRuns[0]?.args).toEqual(['login', 'work']);
    expect(app.state.selectedSeat?.identity).toBe('new@bee.dev');
  });
  test('signs out and refreshes', async () => {
    const app = await getApp();
    mockDb.seatStatuses['seat:local/personal/claude'] = { login: 'signedOut', problems: 0 };
    await app.state.signOutSelectedSeat();
    expect(mockDb.terminalRuns[0]?.args).toEqual(['logout', 'personal']);
    expect(app.state.selectedSeat?.isSignedIn).toBe(false);
  });
  test('lets the caller see a refused sign-out', async () => {
    const app = await getApp();
    app.state.selectRow('seat:devbox/personal/antigravity');
    await expect(app.state.signOutSelectedSeat()).rejects.toMatchObject({ code: 'logoutUnsupported' });
  });
  test('copies the real path, creating the folder first, and says where it goes', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/work/claude');
    await app.state.copySelectedPath();
    expect(mockDb.provisioned).toEqual(['seat:local/work/claude']);
    expect(mockDb.clipboard).toEqual(['/Users/bee/.favo/accounts/work/claude']);
    expect(app.state.toast?.message).toBe('Copied. Paste it into T3 Code as CLAUDE_CONFIG_DIR path.');
  });
  test('copies a path from another machine too', async () => {
    const app = await getApp();
    app.state.selectRow('seat:devbox/personal/codex');
    await app.state.copySelectedPath();
    expect(mockDb.clipboard).toEqual(['/home/bee/.codex']);
  });
  test('repairs the selected machine and reports it', async () => {
    const app = await getApp();
    mockDb.repairedLinks = 2;
    app.state.moveMachine(1);
    await app.state.repairSelectedMachine();
    expect(mockDb.repaired).toEqual(['devbox']);
    expect(app.state.toast?.message).toBe('Mended 2 shared links.');
  });
  test('offers the app of the selected seat on this machine', async () => {
    const app = await getApp();
    expect(app.state.selectedDesktopApp).toEqual({
      provider: 'claude',
      label: 'Claude',
      login: 'separate',
      canOpen: true,
    });
    expect(app.state.canOpenDesktopApp).toBe(true);
  });
  test('offers nothing for a provider whose app is not installed', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/personal/codex');
    expect(app.state.selectedDesktopApp).toBeUndefined();
  });
  test('knows the app of a seat on another machine, but opens apps only on this one', async () => {
    const app = await getApp();
    mockDb.desktopApps.devbox = [{ provider: 'claude', label: 'Claude', login: 'separate', canOpen: false }];
    await app.state.refreshMachine('devbox');
    app.state.selectRow('seat:devbox/personal/claude');
    expect(app.state.selectedDesktopApp?.label).toBe('Claude');
    expect(app.state.canOpenDesktopApp).toBe(false);
  });
  test('shows the app login but offers no opening where favo has no screen, as over SSH', async () => {
    const app = await getApp();
    mockDb.desktopApps.local = [{ provider: 'claude', label: 'Claude', login: 'separate', canOpen: false }];
    await app.state.refreshMachine('local');
    expect(app.state.selectedSeat?.hasAppLogin).toBe(true);
    expect(app.state.canOpenDesktopApp).toBe(false);
  });
  test('knows no app on a machine that has none', async () => {
    const app = await getApp();
    app.state.selectRow('seat:devbox/personal/claude');
    expect(app.state.selectedDesktopApp).toBeUndefined();
    expect(app.state.canOpenDesktopApp).toBe(false);
  });
  test('notices an app installed later, on a refresh of this machine', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/personal/codex');
    mockDb.desktopApps.local = [
      { provider: 'claude', label: 'Claude', login: 'separate', canOpen: true },
      { provider: 'codex', label: 'ChatGPT', login: 'sharedWithCli', canOpen: true },
    ];
    await app.state.refreshMachine('local');
    expect(app.state.selectedDesktopApp?.label).toBe('ChatGPT');
  });
  test('stops offering an app removed later, on a refresh of this machine', async () => {
    const app = await getApp();
    mockDb.desktopApps.local = [];
    await app.state.refreshMachine('local');
    expect(app.state.selectedDesktopApp).toBeUndefined();
  });
  test('still refreshes the machines when the app lookup fails', async () => {
    const app = await getApp({ isLoaded: false });
    const repository = container.get('IDesktopRepository');
    repository.getApps = () => Promise.reject(new Error('no lookup'));
    await expect(app.state.loadFleet()).rejects.toThrow('no lookup');
    expect(app.state.accounts.length).toBeGreaterThan(0);
  });
  test('reads the app login of each seat here whose app signs in on its own', async () => {
    const app = await getApp({ isLoaded: false });
    mockDb.appLogins['seat:local/work/claude'] = { login: 'signedIn', isOtherAccount: false };
    await app.state.loadFleet();
    const seat = (key: string) => app.state.accounts.flatMap((account) => account.seats).find((s) => s.key === key);
    expect(seat('seat:local/work/claude')?.isAppSignedIn).toBe(true);
    expect(seat('seat:local/personal/claude')?.appLogin?.login).toBe('signedOut');
    expect(seat('seat:devbox/personal/claude')?.hasAppLogin).toBe(false);
    expect(mockDb.appLoginReads).not.toContain('seat:local/work/codex');
  });
  test('reads the app login of a seat on another machine, on that machine', async () => {
    const app = await getApp({ isLoaded: false });
    mockDb.desktopApps.devbox = [{ provider: 'claude', label: 'Claude', login: 'separate', canOpen: false }];
    mockDb.appLogins['seat:devbox/personal/claude'] = { login: 'signedIn', isOtherAccount: false };
    await app.state.loadFleet();
    const seat = (key: string) => app.state.accounts.flatMap((account) => account.seats).find((s) => s.key === key);
    expect(seat('seat:devbox/personal/claude')?.isAppSignedIn).toBe(true);
    expect(mockDb.appLoginReads).toContain('seat:devbox/personal/claude');
    expect(mockDb.appLoginReads).not.toContain('seat:devbox/personal/codex');
  });
  test.each([
    ['an unknown method', DomainErrorCode.unknownMethod],
    ['a reply it cannot read', DomainErrorCode.machineOutdated],
  ])('shows no app for a machine on an older favo, which answers with %s', async (_, code) => {
    const app = await getApp({ isLoaded: false });
    mockDb.desktopAppFailures.devbox = new DomainError(code, 'older favo');
    await app.state.loadFleet();
    const devboxSeats = app.state.accounts.filter((account) => account.machineId === 'devbox').flatMap((a) => a.seats);
    expect(devboxSeats.length).toBeGreaterThan(0);
    expect(devboxSeats.some((seat) => seat.hasAppLogin)).toBe(false);
  });
  test('asks a machine for its apps only once it is online', async () => {
    const app = await getApp({ isLoaded: false });
    mockDb.desktopAppFailures.studio = new Error('studio: Connection timed out');
    await app.state.loadFleet();
    expect(app.state.machines.find((machine) => machine.id === 'studio')?.isOnline).toBe(false);
  });
  test('reads each app login once per refresh, through the seat it belongs to', async () => {
    const app = await getApp();
    mockDb.appLoginReads = [];
    await app.state.refreshMachine('local');
    expect(mockDb.appLoginReads.toSorted()).toEqual(['seat:local/personal/claude', 'seat:local/work/claude']);
  });
  test('reads no app login for an app that shares the CLI login', async () => {
    const app = await getApp({ isLoaded: false });
    mockDb.desktopApps.local = [{ provider: 'codex', label: 'ChatGPT', login: 'sharedWithCli', canOpen: true }];
    await app.state.loadFleet();
    expect(mockDb.appLoginReads).toEqual([]);
    expect(app.state.accounts.flatMap((account) => account.seats).some((seat) => seat.hasAppLogin)).toBe(false);
  });
  test('drops the app login once the app is gone', async () => {
    const app = await getApp();
    mockDb.desktopApps.local = [];
    await app.state.refreshMachine('local');
    expect(app.state.selectedSeat?.hasAppLogin).toBe(false);
  });
  test('reads the app login again with the seat', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/work/claude');
    mockDb.appLogins['seat:local/work/claude'] = { login: 'signedIn', isOtherAccount: false };
    await app.state.refreshSeat(app.state.selectedSeat!);
    expect(app.state.selectedSeat?.isAppSignedIn).toBe(true);
  });
  test('keeps the status of a seat when its app login arrives late', async () => {
    const app = await getApp({ isLoaded: false });
    const repository = container.get('IDesktopRepository');
    const getLogin = repository.getLogin.bind(repository);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    repository.getLogin = async (seat) => {
      await held;
      return getLogin(seat);
    };
    const loading = app.state.loadFleet();
    await Bun.sleep(10);
    release();
    await loading;
    expect(app.state.selectedSeat?.isChecking).toBe(false);
    expect(app.state.selectedSeat?.hasAppLogin).toBe(true);
  });
  test('opens the app as the given account and says so', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/work/claude');
    expect(await app.state.openDesktopApp(app.state.selectedSeat!)).toBe('opened');
    expect(mockDb.desktopOpenings).toEqual(['seat:local/work/claude']);
    expect(app.state.toast?.message).toBe('Claude is opening as work.');
  });
  test('refreshes the seat after opening, because its links were mended', async () => {
    const app = await getApp();
    app.state.selectRow('seat:local/work/claude');
    mockDb.seatStatuses['seat:local/work/claude'] = { login: 'signedIn', identity: 'bee@work.dev', problems: 0 };
    await app.state.openDesktopApp(app.state.selectedSeat!);
    expect(app.state.selectedSeat?.problems).toBe(0);
  });
  test('leaves an open app alone until it is told to close it', async () => {
    const app = await getApp();
    mockDb.runningDesktopApps = ['claude'];
    app.state.selectRow('seat:local/work/claude');
    const seat = app.state.selectedSeat!;
    expect(await app.state.openDesktopApp(seat)).toBe('stillOpen');
    expect(mockDb.desktopOpenings).toEqual([]);
    expect(await app.state.openDesktopApp(seat, true)).toBe('opened');
    expect(mockDb.desktopOpenings).toEqual(['seat:local/work/claude']);
  });
  test('ignores a second open while the first is running', async () => {
    const app = await getApp();
    const seat = app.state.selectedSeat!;
    const opening = app.state.openDesktopApp(seat);
    expect(app.state.isDesktopAppBusy).toBe(true);
    expect(await app.state.openDesktopApp(seat)).toBeUndefined();
    await opening;
    expect(mockDb.desktopOpenings).toHaveLength(1);
    expect(app.state.isDesktopAppBusy).toBe(false);
  });
  test('is free again after a failure', async () => {
    const app = await getApp();
    mockDb.desktopFailure = new DomainError('desktopAppStuck', 'Claude did not close.');
    await expect(app.state.openDesktopApp(app.state.selectedSeat!, true)).rejects.toThrow('Claude did not close.');
    expect(app.state.isDesktopAppBusy).toBe(false);
  });
  test('does nothing on a machine row', async () => {
    const app = await getApp();
    app.state.selectRow('machine:studio');
    await app.state.openSelectedSeat();
    await app.state.copySelectedPath();
    await app.state.repairSelectedMachine();
    expect(mockDb.terminalRuns).toHaveLength(0);
    expect(mockDb.clipboard).toHaveLength(0);
    expect(mockDb.repaired).toHaveLength(0);
  });
});

describe('watching the app login after opening the app', () => {
  const work = 'seat:local/work/claude';
  const personal = 'seat:local/personal/claude';
  const signedIn = { login: 'signedIn', isOtherAccount: false } as const;

  async function openWork() {
    const app = await getApp();
    jest.useFakeTimers();
    app.state.selectRow(work);
    await app.state.openDesktopApp(app.state.selectedSeat!);
    mockDb.appLoginReads = [];
    return app;
  }

  async function wait(ms: number) {
    jest.advanceTimersByTime(ms);
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shows the sign-in as soon as the app has it, without a refresh', async () => {
    const app = await openWork();
    expect(app.state.appLoginWatch?.seatKey).toBe(work);
    await wait(3_000);
    expect(mockDb.appLoginReads).toEqual([work]);
    mockDb.appLogins[work] = signedIn;
    await wait(3_000);
    expect(app.state.selectedSeat?.isAppSignedIn).toBe(true);
    expect(app.state.appLoginWatch).toBeUndefined();
  });
  test('reads nothing more once the app is signed in', async () => {
    await openWork();
    mockDb.appLogins[work] = signedIn;
    await wait(3_000);
    await wait(30_000);
    expect(mockDb.appLoginReads).toEqual([work]);
  });
  test('gives up after three minutes without a sign-in', async () => {
    const app = await openWork();
    for (let poll = 0; poll < 70; poll++) await wait(3_000);
    expect(mockDb.appLoginReads).toHaveLength(60);
    expect(app.state.appLoginWatch).toBeUndefined();
  });
  test('watches nothing when the app is already signed in', async () => {
    const app = await getApp();
    mockDb.appLogins[work] = signedIn;
    app.state.selectRow(work);
    await app.state.openDesktopApp(app.state.selectedSeat!);
    expect(app.state.appLoginWatch).toBeUndefined();
  });
  test('follows only the seat the app was opened as last', async () => {
    const app = await openWork();
    app.state.selectRow(personal);
    await app.state.openDesktopApp(app.state.selectedSeat!, true);
    mockDb.appLoginReads = [];
    await wait(3_000);
    expect(mockDb.appLoginReads).toEqual([personal]);
  });
  test('stops quietly when the account is gone', async () => {
    const app = await openWork();
    mockDb.accounts.local = mockDb.accounts.local!.filter(({ name }) => name !== 'work');
    await app.state.refreshMachine('local');
    mockDb.appLoginReads = [];
    await wait(3_000);
    expect(mockDb.appLoginReads).toEqual([]);
    expect(app.state.appLoginWatch).toBeUndefined();
  });
  test('stops quietly when a read fails', async () => {
    const app = await openWork();
    container.get('IDesktopRepository').getLogin = () => Promise.reject(new Error('the files are gone'));
    await wait(3_000);
    expect(app.state.appLoginWatch).toBeUndefined();
    expect(app.state.toast?.message).toBe('Claude is opening as work.');
  });
});
