import type { PipedProcess, ProcessRequest } from '@/modules/system/gateways/process-runner';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

type Json = Record<string, unknown>;

export const settled = () => Bun.sleep(0);

export type FakeAcpScript = {
  sessionId?: string;
  chunks?: string[];
  tools?: string[];
  stopReason?: string;
  promptError?: string;
  asksPermission?: boolean;
  permissionOptions?: { optionId: string; kind: string }[];
  replaysHistoryOnLoad?: string[];
  neverAnswersPrompt?: boolean;
  holdsSession?: boolean;
  sessionError?: string;
};

/** An agent that speaks the Agent Client Protocol over a pipe, so a runner is tested against real exchanges. */
export function fakeAcpRunner(script: FakeAcpScript = {}) {
  const received: Json[] = [];
  const opened: ProcessRequest[] = [];
  let killed = 0;
  let releaseSession = () => {};

  class FakeAcpRunner extends ScriptedProcessRunner {
    override open(request: ProcessRequest): PipedProcess {
      opened.push(request);
      const listeners: ((line: string) => void)[] = [];
      const say = (message: Json, before: () => void = () => {}) => {
        queueMicrotask(() => {
          before();
          for (const listener of listeners) listener(JSON.stringify({ jsonrpc: '2.0', ...message }));
        });
      };
      let isInitialized = false;
      const update = (sessionUpdate: string, extra: Json = {}) =>
        say({
          method: 'session/update',
          params: { sessionId: script.sessionId ?? 's-1', update: { sessionUpdate, ...extra } },
        });
      return {
        write(line) {
          const message = JSON.parse(line) as Json & { id?: number; method?: string };
          received.push(message);
          if (message.method === 'initialize') {
            say({ id: message.id, result: { protocolVersion: 1 } }, () => {
              isInitialized = true;
            });
          }
          const opensSession = message.method === 'session/new' || message.method === 'session/load';
          if (opensSession && !isInitialized)
            say({ id: message.id, error: { code: -32002, message: 'Not initialized' } });
          else if (opensSession && script.sessionError) {
            say({ id: message.id, error: { code: -32000, message: script.sessionError } });
            return;
          }
          if (message.method === 'session/new' && isInitialized) {
            const open = () => say({ id: message.id, result: { sessionId: script.sessionId ?? 's-1' } });
            if (script.holdsSession) releaseSession = open;
            else open();
          }
          if (message.method === 'session/load' && isInitialized) {
            for (const text of script.replaysHistoryOnLoad ?? [])
              update('agent_message_chunk', { content: { type: 'text', text } });
            say({ id: message.id, result: {} });
          }
          if (message.method === 'session/prompt' && !script.neverAnswersPrompt) {
            update('available_commands_update');
            for (const tool of script.tools ?? []) update('tool_call', { title: tool });
            if (script.asksPermission)
              say({
                id: 900,
                method: 'session/request_permission',
                params: { options: script.permissionOptions ?? [] },
              });
            for (const text of script.chunks ?? ['ok'])
              update('agent_message_chunk', { content: { type: 'text', text } });
            if (script.promptError) say({ id: message.id, error: { code: -32000, message: script.promptError } });
            else say({ id: message.id, result: { stopReason: script.stopReason ?? 'end_turn' } });
          }
        },
        onLine(listener) {
          listeners.push(listener);
        },
        exited: new Promise(() => {}),
        kill() {
          killed++;
        },
      };
    }
  }
  return {
    runner: new FakeAcpRunner(),
    received,
    opened,
    killedCount: () => killed,
    openSession: () => releaseSession(),
  };
}
