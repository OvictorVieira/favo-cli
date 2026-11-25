import type { DesktopAppView, ThreadView } from '@favo/contracts/rpc/views';
import { DesktopLogin, DesktopOpening } from '@favo/domain/desktop/desktop-app';
import { isOlderFavoError } from '@favo/domain/machines/machine';
import { Providers } from '@favo/domain/providers/provider';
import { ownValue } from '@favo/domain/shared/own-value';
import { TerminalAction, type TerminalRunResult } from '@favo/domain/terminal/terminal-plan';
import { handoffPromptOf } from '@favo/domain/threads/handoff-prompt';
import { compute } from '@/libs/zustand';
import type { Seat } from '@/modules/comb/app/entities/Seat';
import { ToastKind } from '@/shared/app/services/ToastService';
import { container } from '@/shared/container';
import type { AppService, ServiceCreator } from '@/shared/stores/app';

const AppLoginPollMs = 3_000;
const AppLoginPolls = 60;

export type AppLoginWatch = { seatKey: string };

export type SessionService = {
  sessionTransition?: { label: string };
  pendingHandoff?: { source: Seat; directory?: string; transcript?: string; sessionId?: string; launchId?: string };
  desktopApps: Record<string, DesktopAppView[]>;
  selectedDesktopApp?: DesktopAppView;
  canOpenDesktopApp: boolean;
  isDesktopAppBusy: boolean;
  appLoginWatch?: AppLoginWatch;
  loadDesktopApps(machineId: string): Promise<void>;
  loadAppLogin(seat: Seat): Promise<void>;
  watchAppLogin(seat: Seat): Promise<void>;
  openDesktopApp(seat: Seat, canClose?: boolean): Promise<DesktopOpening | undefined>;
  openSelectedSeat(): Promise<void>;
  launchSelectedSeat(): Promise<void>;
  resumeSeatThread(seat: Seat, thread: ThreadView): Promise<void>;
  signInSelectedSeat(): Promise<void>;
  signOutSelectedSeat(): Promise<void>;
  copySelectedPath(): Promise<void>;
  repairSelectedMachine(): Promise<void>;
  closeHandoff(): void;
  continueHandoff(seat: Seat): Promise<void>;
};

export const createSessionService: ServiceCreator<SessionService> = (set, get) => ({
  ...compute(get, ({ desktopApps, selectedSeat, selectedMachine }) => {
    const selectedDesktopApp = selectedSeat && _appOf(desktopApps, selectedSeat);
    return { selectedDesktopApp, canOpenDesktopApp: !!selectedDesktopApp?.canOpen && !!selectedMachine?.isLocal };
  }),
  desktopApps: {},
  isDesktopAppBusy: false,
  appLoginWatch: undefined,
  pendingHandoff: undefined,
  sessionTransition: undefined,
  async loadDesktopApps(machineId) {
    const previousApps = ownValue(get().desktopApps, machineId) ?? [];
    const desktopApps = await _appsOn(machineId);
    set((state) => ({ desktopApps: { ...state.desktopApps, [machineId]: desktopApps } }));
    if (_ownLoginProviders(desktopApps).join() === _ownLoginProviders(previousApps).join()) return;
    const { accounts, loadAppLogin } = get();
    const seats = accounts
      .filter((account) => account.machineId === machineId)
      .flatMap((account) => account.visibleSeats);
    await Promise.all(seats.map((seat) => loadAppLogin(seat)));
  },
  async loadAppLogin(seat) {
    const { desktopApps, updateSeat } = get();
    if (!_hasOwnLogin(desktopApps, seat)) {
      if (seat.hasAppLogin) updateSeat(seat.key, (current) => current.withAppLogin(undefined));
      return;
    }
    const desktopRepository = container.get('IDesktopRepository');
    const appLogin = await desktopRepository.getLogin(seat);
    const hasOwnLogin = _hasOwnLogin(get().desktopApps, seat);
    updateSeat(seat.key, (current) => current.withAppLogin(hasOwnLogin ? appLogin : undefined));
  },
  async watchAppLogin(seat) {
    const watch = { seatKey: seat.key };
    set({ appLoginWatch: watch });
    for (let poll = 0; poll < AppLoginPolls && _isWaiting(get(), watch); poll++) {
      await _wait(AppLoginPollMs);
      if (!_isWaiting(get(), watch) || !(await _isRead(get().loadAppLogin, seat))) break;
    }
    if (get().appLoginWatch === watch) set({ appLoginWatch: undefined });
  },
  async openDesktopApp(seat, canClose = false) {
    const { accounts, isDesktopAppBusy, refreshSeat, watchAppLogin, showToast } = get();
    if (isDesktopAppBusy) return undefined;
    try {
      set({ isDesktopAppBusy: true });
      const desktopRepository = container.get('IDesktopRepository');
      const { opening, label } = await desktopRepository.open(seat, canClose);
      if (opening === DesktopOpening.stillOpen) return opening;
      const account = accounts.find(({ machineId, name }) => machineId === seat.machineId && name === seat.account);
      showToast(`${label} is opening as ${account?.displayName}.`);
      await refreshSeat(seat);
      void watchAppLogin(seat);
      return opening;
    } finally {
      set({ isDesktopAppBusy: false });
    }
  },
  async openSelectedSeat() {
    const { selectedSeat, launchSelectedSeat, signInSelectedSeat } = get();
    if (!selectedSeat) return;
    if (selectedSeat.isSignedIn) await launchSelectedSeat();
    else await signInSelectedSeat();
  },
  async launchSelectedSeat() {
    const { selectedSeat, launchDirectories, refreshSeat, loadSelectedThreads, sessionTransition } = get();
    if (!selectedSeat || sessionTransition) return;
    const transition = { label: selectedSeat.label };
    const directory = ownValue(launchDirectories, selectedSeat.machineId);
    let offeredHandoff: SessionService['pendingHandoff'];
    try {
      set({ sessionTransition: transition });
      const result = await _runInTerminal(
        selectedSeat,
        TerminalAction.launch,
        refreshSeat,
        directory,
        undefined,
        [],
        true,
        (result) => {
          offeredHandoff = result.rateLimitDetected
            ? _handoffOf(selectedSeat, directory, undefined, result.launchId)
            : undefined;
          set({ sessionTransition: undefined, pendingHandoff: offeredHandoff });
        }
      );
      if (result.rateLimitDetected) {
        const thread = await _latestThreadOf(selectedSeat, directory, result.launchId);
        if (get().pendingHandoff === offeredHandoff)
          set({ pendingHandoff: _handoffOf(selectedSeat, directory, thread) });
      }
      await loadSelectedThreads();
    } finally {
      if (get().sessionTransition === transition) set({ sessionTransition: undefined });
    }
  },
  async resumeSeatThread(seat, thread) {
    const { refreshSeat, loadSelectedThreads, sessionTransition } = get();
    if (sessionTransition) return;
    const transition = { label: seat.label };
    try {
      set({ sessionTransition: transition });
      await _runInTerminal(seat, TerminalAction.resume, refreshSeat, thread.directory, thread.id, [], true, (result) =>
        set({
          sessionTransition: undefined,
          pendingHandoff: result.rateLimitDetected ? _handoffOf(seat, thread.directory, thread) : undefined,
        })
      );
      await loadSelectedThreads();
    } finally {
      if (get().sessionTransition === transition) set({ sessionTransition: undefined });
    }
  },
  closeHandoff() {
    set({ pendingHandoff: undefined });
  },
  async continueHandoff(seat) {
    const { pendingHandoff, sessionTransition } = get();
    if (!pendingHandoff || sessionTransition) return;
    const transition = { label: seat.label };
    let offeredHandoff: SessionService['pendingHandoff'];
    try {
      set({ pendingHandoff: undefined, sessionTransition: transition });
      const thread = pendingHandoff.sessionId
        ? undefined
        : await _latestThreadOf(pendingHandoff.source, pendingHandoff.directory, pendingHandoff.launchId);
      const context = thread ? _handoffOf(pendingHandoff.source, pendingHandoff.directory, thread) : pendingHandoff;
      const prompt = handoffPromptOf({
        sourceProvider: context.source.provider,
        sourceHome: context.source.path,
        sessionId: context.sessionId,
        transcript: context.transcript,
        directory: context.directory,
      });
      const args = [...Providers[seat.provider].initialPromptArguments, prompt];
      const result = await _runInTerminal(
        seat,
        TerminalAction.launch,
        get().refreshSeat,
        pendingHandoff.directory,
        undefined,
        args,
        true,
        (result) => {
          offeredHandoff = result.rateLimitDetected
            ? _handoffOf(seat, pendingHandoff.directory, undefined, result.launchId)
            : undefined;
          set({ sessionTransition: undefined, pendingHandoff: offeredHandoff });
        }
      );
      if (result.rateLimitDetected) {
        const thread = await _latestThreadOf(seat, pendingHandoff.directory, result.launchId);
        if (get().pendingHandoff === offeredHandoff)
          set({ pendingHandoff: _handoffOf(seat, pendingHandoff.directory, thread) });
      }
    } catch (error) {
      set({ pendingHandoff });
      throw error;
    } finally {
      if (get().sessionTransition === transition) set({ sessionTransition: undefined });
    }
  },
  async signInSelectedSeat() {
    const { selectedSeat, sessionTransition, refreshSeat } = get();
    if (!selectedSeat || sessionTransition) return;
    const transition = { label: selectedSeat.label };
    try {
      set({ sessionTransition: transition });
      await _runInTerminal(selectedSeat, TerminalAction.login, refreshSeat, undefined, undefined, [], false, () =>
        set({ sessionTransition: undefined })
      );
    } finally {
      if (get().sessionTransition === transition) set({ sessionTransition: undefined });
    }
  },
  async signOutSelectedSeat() {
    const { selectedSeat, sessionTransition, refreshSeat } = get();
    if (!selectedSeat || sessionTransition) return;
    const transition = { label: selectedSeat.label };
    try {
      set({ sessionTransition: transition });
      await _runInTerminal(selectedSeat, TerminalAction.logout, refreshSeat, undefined, undefined, [], false, () =>
        set({ sessionTransition: undefined })
      );
    } finally {
      if (get().sessionTransition === transition) set({ sessionTransition: undefined });
    }
  },
  async copySelectedPath() {
    const { selectedSeat, updateSeat, showToast } = get();
    if (!selectedSeat) return;
    const fleetRepository = container.get('IFleetRepository');
    const clipboardGateway = container.get('IClipboardGateway');
    await fleetRepository.provisionSeat(selectedSeat);
    updateSeat(selectedSeat.key, (seat) => seat.withProvisioned());
    const isCopied = await clipboardGateway.copy(selectedSeat.path);
    if (isCopied) showToast(`Copied. Paste it into T3 Code as ${selectedSeat.pathHint}.`);
    else showToast(`Could not reach the clipboard: ${selectedSeat.path}`, ToastKind.error);
  },
  async repairSelectedMachine() {
    const { selectedMachine, refreshMachine, showToast } = get();
    if (!selectedMachine?.isOnline) return;
    const fleetRepository = container.get('IFleetRepository');
    const linked = await fleetRepository.repairMachine(selectedMachine.id);
    await refreshMachine(selectedMachine.id);
    showToast(linked > 0 ? `Mended ${linked} shared links.` : 'Every wall is sound.');
  },
});

function _appOf(desktopApps: Record<string, DesktopAppView[]>, seat: Seat) {
  return ownValue(desktopApps, seat.machineId)?.find((app) => app.provider === seat.provider);
}

async function _appsOn(machineId: string) {
  try {
    const desktopRepository = container.get('IDesktopRepository');
    return await desktopRepository.getApps(machineId);
  } catch (error) {
    if (isOlderFavoError(error)) return [];
    throw error;
  }
}

function _isWaiting({ appLoginWatch, accounts }: AppService, watch: AppLoginWatch) {
  const seat = accounts.flatMap((account) => account.seats).find(({ key }) => key === watch.seatKey);
  return appLoginWatch === watch && !!seat?.hasAppLogin && !seat.isAppSignedIn;
}

async function _isRead(loadAppLogin: (seat: Seat) => Promise<void>, seat: Seat) {
  try {
    await loadAppLogin(seat);
    return true;
  } catch {
    return false;
  }
}

function _wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function _hasOwnLogin(desktopApps: Record<string, DesktopAppView[]>, seat: Seat) {
  return _ownLoginProviders(ownValue(desktopApps, seat.machineId) ?? []).includes(seat.provider);
}

function _ownLoginProviders(desktopApps: DesktopAppView[]) {
  return desktopApps.filter((app) => app.login === DesktopLogin.separate).map((app) => app.provider);
}

async function _runInTerminal(
  seat: Seat,
  action: TerminalAction,
  refreshSeat: (seat: Seat) => Promise<void>,
  directory?: string,
  thread?: string,
  args: string[] = [],
  monitorLimits = false,
  onReturn?: (result: TerminalRunResult & { launchId?: string }) => void
) {
  const terminalRepository = container.get('ITerminalRepository');
  const terminalGateway = container.get('ITerminalGateway');
  const plan = await terminalRepository.plan(seat, action, directory, thread, args);
  let hasReturned = false;
  const beforeResume = (result: TerminalRunResult) => {
    if (hasReturned) return;
    hasReturned = true;
    onReturn?.({ ...result, launchId: plan.env.FAVO_LAUNCH });
  };
  const result = await terminalGateway.run(plan, {
    ...(monitorLimits ? { monitorLimits: seat.provider } : {}),
    beforeResume,
  });
  beforeResume(result);
  await refreshSeat(seat).catch((error: unknown) => {
    if (!result.rateLimitDetected) throw error;
  });
  return { ...result, launchId: plan.env.FAVO_LAUNCH };
}

function _handoffOf(source: Seat, directory: string | undefined, thread: ThreadView | undefined, launchId?: string) {
  return {
    source,
    directory: thread?.directory ?? directory,
    transcript: thread?.transcript,
    sessionId: thread?.id,
    launchId: launchId ?? thread?.launchId,
  };
}

async function _latestThreadOf(seat: Seat, directory?: string, launchId?: string) {
  const threadRepository = container.get('IThreadRepository');
  try {
    const threads = await threadRepository.getThreads(seat, directory);
    return launchId ? threads.find((thread) => thread.launchId === launchId) : threads[0];
  } catch {
    return undefined;
  }
}
