import { ProviderId } from '@favo/domain/providers/provider';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { startOneShotSession } from '@/modules/chat/gateways/one-shot.chat-session';
import { cursorEventsOf } from '@/modules/chat/utils/cursor-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const PrintArguments = ['-p', '--trust', '--output-format', 'stream-json'];

export class CursorChatRunner extends ChatRunner {
  readonly id = ProviderId.cursor;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start(spec: ChatSessionSpec): ChatSession {
    return startOneShotSession(this.processes, spec, {
      label: 'Cursor',
      argumentsFor: (text, chatId) => [...PrintArguments, ...(chatId ? ['--resume', chatId] : []), text],
      eventsOf: cursorEventsOf,
    });
  }
}
