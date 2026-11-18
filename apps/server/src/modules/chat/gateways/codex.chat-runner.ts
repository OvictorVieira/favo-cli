import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { ProviderId } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { type CodexNotification, codexEventsOf } from '@/modules/chat/utils/codex-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const OpenRequestId = 2;

type CodexMessage = CodexNotification & {
  id?: number;
  result?: { thread?: { id?: string } };
  error?: { message?: string };
};

export class CodexChatRunner extends ChatRunner {
  readonly id = ProviderId.codex;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start({ binary, env, cwd, isolationArguments, resumeSessionId }: ChatSessionSpec): ChatSession {
    const process = this.processes.open({ command: binary, args: [...isolationArguments, 'app-server'], env, cwd });
    const listeners: ((event: ChatEvent) => void)[] = [];
    const waiting: string[] = [];
    let nextId = 1;
    let threadId: string | undefined;
    let isEnded = false;

    const emit = (event: ChatEvent) => {
      for (const listener of listeners) listener(event);
    };
    const write = (message: unknown) => process.write(JSON.stringify(message));
    const request = (method: string, params: unknown) => write({ id: nextId++, method, params });
    const turn = (text: string) => request('turn/start', { threadId, input: [{ type: 'text', text }] });

    process.onLine((line) => {
      const message = parseJson(line) as CodexMessage | null;
      if (typeof message !== 'object' || message === null) return;
      if (message.method?.endsWith('/requestApproval') && message.id !== undefined) {
        write({ id: message.id, result: { decision: 'decline' } });
      } else if (message.method === undefined && message.id === OpenRequestId) {
        if (message.error)
          return emit({ type: 'error', message: message.error.message ?? 'Codex could not open a thread.' });
        threadId = message.result?.thread?.id ?? resumeSessionId;
        if (threadId) emit({ type: 'session', sessionId: threadId });
        for (const text of waiting.splice(0)) turn(text);
      } else if (message.method === undefined && message.error) {
        emit({ type: 'error', message: message.error.message ?? 'Codex refused the message.' });
      } else {
        for (const event of codexEventsOf(message)) emit(event);
      }
    });
    request('initialize', { clientInfo: { name: 'favo', version: '0' } });
    write({ method: 'initialized' });
    if (resumeSessionId) request('thread/resume', { threadId: resumeSessionId, cwd });
    else request('thread/start', { cwd });
    const exited = process.exited.then(({ code, stderr, failure }) => {
      if (isEnded) return;
      isEnded = true;
      const detail = (failure ?? stderr).trim().split('\n').at(-1);
      emit({ type: 'error', message: `Codex stopped (code ${code})${detail ? `: ${detail}` : ''}` });
    });

    return {
      send(text) {
        if (isEnded) return false;
        if (threadId === undefined) waiting.push(text);
        else turn(text);
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
