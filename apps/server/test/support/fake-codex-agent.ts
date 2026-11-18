import type { PipedProcess, ProcessRequest } from '@/modules/system/gateways/process-runner';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

type Json = Record<string, unknown>;

export type FakeCodexScript = {
  threadId?: string;
  chunks?: string[];
  finalText?: string;
  tools?: Json[];
  failure?: string;
  asksApproval?: boolean;
  holdsThread?: boolean;
};

/** An agent that speaks the Codex app-server protocol over a pipe. */
export function fakeCodexRunner(script: FakeCodexScript = {}) {
  const received: Json[] = [];
  const opened: ProcessRequest[] = [];
  let killed = 0;
  let releaseThread = () => {};

  class FakeCodexRunner extends ScriptedProcessRunner {
    override open(request: ProcessRequest): PipedProcess {
      opened.push(request);
      const listeners: ((line: string) => void)[] = [];
      const say = (message: Json) => {
        queueMicrotask(() => {
          for (const listener of listeners) listener(JSON.stringify(message));
        });
      };
      const threadId = script.threadId ?? 'th-1';
      return {
        write(line) {
          const message = JSON.parse(line) as Json & { id?: number; method?: string; params?: Json };
          received.push(message);
          if (message.method === 'initialize') say({ id: message.id, result: { userAgent: 'codex' } });
          if (message.method === 'thread/start' || message.method === 'thread/resume') {
            const open = () =>
              say({ id: message.id, result: { thread: { id: (message.params?.threadId as string) ?? threadId } } });
            if (script.holdsThread) releaseThread = open;
            else open();
          }
          if (message.method === 'turn/start') {
            say({ id: message.id, result: { turn: { id: 't-1' } } });
            for (const item of script.tools ?? []) say({ method: 'item/started', params: { item } });
            if (script.asksApproval) say({ id: 900, method: 'item/commandExecution/requestApproval', params: {} });
            for (const delta of script.chunks ?? ['ok']) say({ method: 'item/agentMessage/delta', params: { delta } });
            const text = script.finalText ?? (script.chunks ?? ['ok']).join('');
            say({ method: 'item/completed', params: { item: { type: 'agentMessage', text } } });
            say({
              method: 'turn/completed',
              params: {
                turn: script.failure
                  ? { status: 'failed', error: { message: script.failure } }
                  : { status: 'completed' },
              },
            });
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
    runner: new FakeCodexRunner(),
    received,
    opened,
    killedCount: () => killed,
    openThread: () => releaseThread(),
  };
}
