import { ProviderId } from '@favo/domain/providers/provider';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { startOneShotSession } from '@/modules/chat/gateways/one-shot.chat-session';
import { opencodeEventsOf } from '@/modules/chat/utils/opencode-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

export class OpencodeChatRunner extends ChatRunner {
  readonly id = ProviderId.opencode;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start(spec: ChatSessionSpec): ChatSession {
    let known = spec.resumeSessionId;
    return startOneShotSession(this.processes, spec, {
      label: 'OpenCode',
      argumentsFor: (text, chatId) => ['run', '--format', 'json', ...(chatId ? ['--session', chatId] : []), text],
      eventsOf: (line) => {
        const events = opencodeEventsOf(line, known);
        for (const event of events) if (event.type === 'session') known = event.sessionId;
        return events;
      },
    });
  }
}
