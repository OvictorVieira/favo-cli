import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { ProviderId } from '@favo/domain/providers/provider';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { claudeEventsOf } from '@/modules/chat/utils/claude-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const StreamingArguments = [
  '--print',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
];

export class ClaudeChatRunner extends ChatRunner {
  readonly id = ProviderId.claude;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start({ binary, env, cwd, isolationArguments, resumeSessionId }: ChatSessionSpec): ChatSession {
    const resume = resumeSessionId ? ['--resume', resumeSessionId] : [];
    const process = this.processes.open({
      command: binary,
      args: [...isolationArguments, ...StreamingArguments, ...resume],
      env,
      cwd,
    });
    const listeners: ((event: ChatEvent) => void)[] = [];
    let isEnded = false;
    const emit = (event: ChatEvent) => {
      for (const listener of listeners) listener(event);
    };
    process.onLine((line) => {
      for (const event of claudeEventsOf(line)) emit(event);
    });
    const exited = process.exited.then(({ code, stderr, failure }) => {
      if (isEnded) return;
      isEnded = true;
      emit({ type: 'error', message: stoppedMessage(code, stderr, failure) });
    });
    return {
      send(text) {
        if (isEnded) return false;
        process.write(userLineOf(text));
        return true;
      },
      onEvent(listener) {
        listeners.push(listener);
      },
      end() {
        isEnded = true;
        process.kill();
      },
      exited,
    };
  }
}

function userLineOf(text: string) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}

function stoppedMessage(code: number, stderr: string, failure?: string) {
  const detail = (failure ?? stderr).trim().split('\n').at(-1);
  return `Claude Code stopped (code ${code})${detail ? `: ${detail}` : ''}`;
}
