import type { ChatEvent } from '@favo/domain/chat/chat-event';
import type { ProviderId } from '@favo/domain/providers/provider';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';

const DefaultAnswer: ChatEvent[] = [{ type: 'message', text: 'ok' }, { type: 'turn-completed' }];

export class ScriptedChatRunner extends ChatRunner {
  readonly started: ChatSessionSpec[] = [];
  readonly sent: string[] = [];
  endings = 0;
  answers: ChatEvent[][] = [];
  isSilent = false;
  refusalsLeft = 0;
  onStart: ChatEvent[] = [];

  constructor(readonly id: ProviderId) {
    super();
  }

  start(spec: ChatSessionSpec): ChatSession {
    this.started.push(spec);
    const listeners: ((event: ChatEvent) => void)[] = [];
    const early = this.onStart;
    queueMicrotask(() => {
      for (const event of early) for (const listener of listeners) listener(event);
    });
    return {
      send: (text) => {
        if (this.refusalsLeft > 0) {
          this.refusalsLeft--;
          return false;
        }
        this.sent.push(text);
        if (!this.isSilent) {
          for (const event of this.answers.shift() ?? DefaultAnswer) for (const listener of listeners) listener(event);
        }
        return true;
      },
      onEvent: (listener) => {
        listeners.push(listener);
      },
      end: () => {
        this.endings++;
      },
      exited: new Promise<void>(() => {}),
    };
  }
}
