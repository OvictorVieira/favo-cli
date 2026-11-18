import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { ProviderId } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { acpUpdateEventsOf } from '@/modules/chat/utils/acp-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const AnyFolder = '/';
const InitializeId = 1;
const OpenId = 2;

type AcpMessage = {
  id?: number;
  method?: string;
  params?: { update?: Parameters<typeof acpUpdateEventsOf>[0] };
  result?: { sessionId?: string };
  error?: { message?: string };
};

export class CopilotChatRunner extends ChatRunner {
  readonly id = ProviderId.copilot;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start({ binary, env, cwd, isolationArguments, resumeSessionId }: ChatSessionSpec): ChatSession {
    const process = this.processes.open({ command: binary, args: [...isolationArguments, '--acp'], env, cwd });
    const folder = cwd ?? AnyFolder;
    const listeners: ((event: ChatEvent) => void)[] = [];
    const waiting: string[] = [];
    let nextId = 1;
    let sessionId: string | undefined;
    let promptId: number | undefined;
    let isEnded = false;

    const emit = (event: ChatEvent) => {
      for (const listener of listeners) listener(event);
    };
    const request = (method: string, params: unknown) => {
      const id = nextId++;
      process.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      return id;
    };
    const prompt = (text: string) => {
      promptId = request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
    };

    process.onLine((line) => {
      const message = parseJson(line) as AcpMessage | null;
      if (typeof message !== 'object' || message === null) return;
      if (message.method === 'session/update' && promptId !== undefined) {
        for (const event of acpUpdateEventsOf(message.params?.update ?? {})) emit(event);
      } else if (message.method === 'session/request_permission' && message.id !== undefined) {
        process.write(
          JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome: { outcome: 'cancelled' } } })
        );
      } else if (message.method === undefined && message.id === InitializeId) {
        if (message.error) return emit({ type: 'error', message: message.error.message ?? 'Copilot could not start.' });
        if (resumeSessionId) request('session/load', { sessionId: resumeSessionId, cwd: folder, mcpServers: [] });
        else request('session/new', { cwd: folder, mcpServers: [] });
      } else if (message.method === undefined && message.id === OpenId) {
        if (message.error)
          return emit({ type: 'error', message: message.error.message ?? 'Copilot could not open a session.' });
        sessionId = message.result?.sessionId ?? resumeSessionId;
        if (sessionId) emit({ type: 'session', sessionId });
        for (const text of waiting.splice(0)) prompt(text);
      } else if (message.method === undefined && message.id !== undefined && message.id === promptId) {
        promptId = undefined;
        emit(
          message.error
            ? { type: 'error', message: message.error.message ?? 'Copilot refused the message.' }
            : { type: 'turn-completed' }
        );
      }
    });
    request('initialize', { protocolVersion: 1, clientCapabilities: {} });
    const exited = process.exited.then(({ code, stderr, failure }) => {
      if (isEnded) return;
      isEnded = true;
      const detail = (failure ?? stderr).trim().split('\n').at(-1);
      emit({ type: 'error', message: `GitHub Copilot stopped (code ${code})${detail ? `: ${detail}` : ''}` });
    });

    return {
      send(text) {
        if (isEnded) return false;
        if (sessionId === undefined) waiting.push(text);
        else prompt(text);
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
