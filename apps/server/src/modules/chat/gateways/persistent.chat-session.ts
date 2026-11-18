import type { ChatEvent } from '@favo/domain/chat/chat-event';
import type { ChatSession } from '@/modules/chat/gateways/chat-runner';
import type { PipedProcess } from '@/modules/system/gateways/process-runner';

export function persistentChatSession(process: PipedProcess, label: string, send: (text: string) => void) {
  const listeners: ((event: ChatEvent) => void)[] = [];
  let isEnded = false;

  function emit(event: ChatEvent) {
    for (const listener of listeners) listener(event);
  }

  const exited = process.exited.then(({ code, stderr, failure }) => {
    if (isEnded) return;
    isEnded = true;
    const detail = (failure ?? stderr).trim().split('\n').at(-1);
    emit({ type: 'error', message: `${label} stopped (code ${code})${detail ? `: ${detail}` : ''}` });
  });

  const session: ChatSession = {
    send(text) {
      if (isEnded) return false;
      send(text);
      return true;
    },
    onEvent(listener) {
      listeners.push(listener);
    },
    end() {
      if (isEnded) return;
      isEnded = true;
      process.kill();
    },
    exited,
  };

  return { session, emit };
}
