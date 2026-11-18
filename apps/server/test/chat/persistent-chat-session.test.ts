import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { ProviderId } from '@favo/domain/providers/provider';
import { createChatRunners } from '@/modules/chat/gateways/chat-runners';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

const PersistentProviders = [ProviderId.claude, ProviderId.codex, ProviderId.copilot];

for (const provider of PersistentProviders) {
  describe(`${provider} persistent chat lifecycle`, () => {
    it('closing repeatedly stops its process once and refuses later messages', async () => {
      const processes = new ScriptedProcessRunner();
      const session = createChatRunners(processes)[provider]?.start({
        binary: provider,
        env: {},
        isolationArguments: [],
      });
      expect(session).toBeDefined();
      const events: ChatEvent[] = [];
      session?.onEvent((event) => events.push(event));
      session?.end();
      session?.end();
      await session?.exited;
      expect(processes.killed).toHaveLength(1);
      expect(session?.send('after closing')).toBe(false);
      expect(events).toEqual([]);
    });

    it('reports process failure once and refuses further messages', async () => {
      const processes = new ScriptedProcessRunner();
      const session = createChatRunners(processes)[provider]?.start({
        binary: provider,
        env: {},
        isolationArguments: [],
      });
      const events: ChatEvent[] = [];
      session?.onEvent((event) => events.push(event));
      await session?.exited;
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'error', message: expect.stringContaining('not found') });
      expect(session?.send('after process failure')).toBe(false);
      session?.end();
      expect(events).toHaveLength(1);
    });
  });
}
