import { afterEach, expect, test } from 'bun:test';
import { testRender } from '@opentui/react/test-utils';
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
