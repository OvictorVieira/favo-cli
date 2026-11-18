import type { PipedProcess, ProcessRequest } from '@/modules/system/gateways/process-runner';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

export type OneShotRun = { lines?: string[]; code?: number; stderr?: string; staysOpen?: boolean };

/** Runs that print their lines and exit, one per process started, like a provider in print mode. */
export function oneShotRunner(runs: OneShotRun[]) {
  const opened: ProcessRequest[] = [];
  const queue = [...runs];
  let killed = 0;

  class OneShotRunner extends ScriptedProcessRunner {
    override open(request: ProcessRequest): PipedProcess {
      opened.push(request);
      const run = queue.shift() ?? {};
      const listeners: ((line: string) => void)[] = [];
      const exited = new Promise<{ code: number; stderr: string }>((resolve) => {
        queueMicrotask(() => {
          for (const line of run.lines ?? []) for (const listener of listeners) listener(line);
          if (!run.staysOpen) resolve({ code: run.code ?? 0, stderr: run.stderr ?? '' });
        });
      });
      return {
        write() {},
        onLine(listener) {
          listeners.push(listener);
        },
        exited,
        kill() {
          killed++;
        },
      };
    }
  }
  return { runner: new OneShotRunner(), opened, killedCount: () => killed };
}
