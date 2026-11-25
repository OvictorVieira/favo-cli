import { expect, test } from 'bun:test';
import { RendererTerminalGateway } from '@/shared/app/gateways/RendererTerminalGateway';

const Plan = { command: 'claude', args: [], env: {}, unsetEnv: [] };
const Result = { exitCode: 0, rateLimitDetected: true };

test('keeps Favo visible until the provider has output, then prepares the limit dialog before returning', async () => {
  const events: string[] = [];
  const renderer = {
    async suspend() {
      events.push('suspend');
    },
    async resume() {
      events.push('resume');
    },
  };
  const gateway = new RendererTerminalGateway(renderer, async (_plan, options) => {
    events.push('starting');
    expect(events).toEqual(['starting']);
    await options?.onReady?.();
    events.push('provider screen');
    return Result;
  });
  await gateway.run(Plan, {
    beforeResume: () => {
      events.push('limit dialog');
    },
  });
  expect(events).toEqual(['starting', 'suspend', 'provider screen', 'limit dialog', 'resume']);
});

test('does not toggle the terminal when the provider fails before drawing its first screen', async () => {
  const events: string[] = [];
  const gateway = new RendererTerminalGateway(
    {
      async suspend() {
        events.push('suspend');
      },
      async resume() {
        events.push('resume');
      },
    },
    async () => {
      throw new Error('could not start');
    }
  );
  await expect(gateway.run(Plan)).rejects.toThrow('could not start');
  expect(events).toEqual([]);
});
