import type { ChatEvent } from '@favo/domain/chat/chat-event';
import type { ChatSession, ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const ReasonLines = 3;

export type OneShotProtocol = {
  label: string;
  argumentsFor(text: string, chatId: string | undefined): string[];
  eventsOf(line: string): ChatEvent[];
};

export function startOneShotSession(
  processes: ProcessRunner,
  { binary, env, cwd, isolationArguments, resumeSessionId }: ChatSessionSpec,
  protocol: OneShotProtocol
): ChatSession {
  const listeners: ((event: ChatEvent) => void)[] = [];
  let chatId = resumeSessionId;
  let running: ReturnType<ProcessRunner['open']> | undefined;
  let isEnded = false;
  let lastExit: Promise<void> = Promise.resolve();

  const emit = (event: ChatEvent) => {
    for (const listener of listeners) listener(event);
  };

  return {
    send(text) {
      if (isEnded || running) return false;
      const process = processes.open({
        command: binary,
        args: [...isolationArguments, ...protocol.argumentsFor(text, chatId)],
        env,
        cwd,
        hasNoInput: true,
      });
      running = process;
      let isAnswered = false;
      process.onLine((line) => {
        for (const event of protocol.eventsOf(line)) {
          if (event.type === 'session') chatId = event.sessionId;
          if (event.type === 'turn-completed' || event.type === 'error') isAnswered = true;
          emit(event);
        }
      });
      lastExit = process.exited.then(({ code, stderr, failure }) => {
        running = undefined;
        if (isEnded || isAnswered) return;
        if (code === 0) return emit({ type: 'turn-completed' });
        emit({ type: 'error', message: stoppedMessage(protocol.label, code, failure ?? stderr) });
      });
      return true;
    },
    onEvent(listener) {
      listeners.push(listener);
    },
    end() {
      isEnded = true;
      running?.kill();
    },
    get exited() {
      return lastExit;
    },
  };
}

function stoppedMessage(label: string, code: number, text: string) {
  const reason = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ReasonLines)
    .join(' ');
  return reason === '' ? `${label} stopped (code ${code})` : reason;
}
