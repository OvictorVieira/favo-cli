import { afterEach, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';
import { App } from '@/App';
import type { IFleetRepository } from '@/modules/comb/app/repositories/IFleetRepository';
import { TestFleetRepository } from '@/modules/comb/app/repositories/TestFleetRepository';
import { container } from '@/shared/container';

let dispose: (() => Promise<void>) | undefined;

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

test('keeps the comb on screen when the fleet is read again, as after adding a machine', async () => {
  let isHeld = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class HoldableFleetRepository extends TestFleetRepository implements IFleetRepository {
    override async getMachines() {
      if (isHeld) await gate;
      return super.getMachines();
    }
  }
  const app = await getApp({ isLoaded: false });
  container.register('IFleetRepository', new HoldableFleetRepository());
  const view = await testRender(<App onQuit={() => undefined} />, { width: 80, height: 24 });
  dispose = view.dispose;
  await view.waitFor(() => app.state.hasLoadedFleet);
  await view.flush();
  isHeld = true;

  const reloading = app.state.loadFleet();
  await view.flush();
  await view.renderOnce();

  expect(view.captureCharFrame()).not.toContain('loading providers');
  expect(view.captureCharFrame()).toContain('macbook · this machine');
  release();
  await reloading;
});

test('shows the Favo loading mark until provider status checks finish', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  class DelayedFleetRepository extends TestFleetRepository implements IFleetRepository {
    override async getMachines() {
      await gate;
      return super.getMachines();
    }
  }
  const app = await getApp({ isLoaded: false });
  container.register('IFleetRepository', new DelayedFleetRepository());
  const view = await testRender(<App onQuit={() => undefined} />, { width: 80, height: 24 });
  dispose = view.dispose;
  await view.flush();
  await view.renderOnce();

  expect(view.captureCharFrame()).toContain('loading providers');
  expect(view.captureCharFrame()).toMatch(/[⬢⬡]/);

  release();
  await view.waitFor(() => app.state.hasLoadedFleet);
  await view.flush();
  await view.renderOnce();
  expect(view.captureCharFrame()).toContain('macbook · this machine');
});

test('shows the initial loading style while preparing an agent, and ignores a second launch', async () => {
  const app = await getApp();
  const repository = container.get('ITerminalRepository');
  const plan = repository.plan.bind(repository);
  const gate = Promise.withResolvers<void>();
  let requests = 0;
  repository.plan = async (...args) => {
    requests++;
    await gate.promise;
    return plan(...args);
  };
  const view = await testRender(<App onQuit={() => undefined} />, { width: 80, height: 24 });
  dispose = view.dispose;
  const launching = app.state.openSelectedSeat();
  await view.waitForFrame((frame) => frame.includes('loading Claude Code'));
  expect(view.captureCharFrame()).toMatch(/[⬢⬡]/);
  expect(view.captureCharFrame()).not.toContain('macbook · this machine');
  await app.state.openSelectedSeat();
  expect(requests).toBe(1);
  gate.resolve();
  await launching;
  await view.waitForFrame((frame) => frame.includes('macbook · this machine'));
});

test('replaces the limit dialog with loading for the chosen provider', async () => {
  const app = await getApp();
  mockDb.terminalRateLimitDetected = true;
  const view = await testRender(<App onQuit={() => undefined} />, { width: 80, height: 24 });
  dispose = view.dispose;
  await app.state.launchSelectedSeat();
  await view.waitForFrame((frame) => frame.includes('provider usage limit'));
  const gate = Promise.withResolvers<void>();
  const repository = container.get('ITerminalRepository');
  const plan = repository.plan.bind(repository);
  repository.plan = async (...args) => {
    await gate.promise;
    return plan(...args);
  };
  const codex = app.state.selectedAccount!.visibleSeats.find((seat) => seat.provider === 'codex')!;
  mockDb.terminalRateLimitDetected = false;
  const switching = app.state.continueHandoff(codex);
  await view.waitForFrame((frame) => frame.includes('loading Codex'));
  expect(view.captureCharFrame()).not.toContain('provider usage limit');
  gate.resolve();
  await switching;
  await view.waitForFrame((frame) => frame.includes('macbook · this machine'));
});

test('clears loading when preparing an agent fails', async () => {
  const app = await getApp();
  container.get('ITerminalRepository').plan = async () => {
    throw new Error('could not prepare');
  };
  await expect(app.state.openSelectedSeat()).rejects.toThrow('could not prepare');
  expect(app.state.sessionTransition).toBeUndefined();
});
