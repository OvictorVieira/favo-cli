import { ProviderId } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { persistentChatSession } from '@/modules/chat/gateways/persistent.chat-session';
import { acpUpdateEventsOf } from '@/modules/chat/utils/acp-events';
import { permissionArgumentsFor } from '@/modules/providers/utils/permission-options';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const AnyFolder = '/';
const InitializeId = 1;
const OpenId = 2;

type AcpMessage = {
  id?: number | string;
  method?: string;
  params?: {
    update?: Parameters<typeof acpUpdateEventsOf>[0];
    options?: { optionId: string; kind: string }[];
  };
  result?: { sessionId?: string };
  error?: { message?: string };
};

export class CopilotChatRunner extends ChatRunner {
  readonly id = ProviderId.copilot;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  start({
    binary,
    env,
    cwd,
    isolationArguments,
    resumeSessionId,
    isDangerouslySkippingPermissions,
  }: ChatSessionSpec): ChatSession {
    const process = this.processes.open({
      command: binary,
      args: [
        ...isolationArguments,
        '--acp',
        ...(isDangerouslySkippingPermissions ? permissionArgumentsFor(this.id) : []),
      ],
      env,
      cwd,
    });
    const folder = cwd ?? AnyFolder;
    const waiting: string[] = [];
    let nextId = 1;
    let sessionId: string | undefined;
    let promptId: number | undefined;

    const { session, emit } = persistentChatSession(process, 'GitHub Copilot', (text) => {
      if (sessionId === undefined) waiting.push(text);
      else prompt(text);
    });
    function request(method: string, params: unknown) {
      const id = nextId++;
      process.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      return id;
    }
    function prompt(text: string) {
      promptId = request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] });
    }

    process.onLine((line) => {
      const message = parseJson(line) as AcpMessage | null;
      if (typeof message !== 'object' || message === null) return;
      if (message.method === 'session/update' && promptId !== undefined) {
        for (const event of acpUpdateEventsOf(message.params?.update ?? {})) emit(event);
      } else if (message.method === 'session/request_permission' && message.id !== undefined) {
        const approval = isDangerouslySkippingPermissions
          ? message.params?.options?.find((option) => option.kind === 'allow_once' || option.kind === 'allow_always')
          : undefined;
        const outcome = approval ? { outcome: 'selected', optionId: approval.optionId } : { outcome: 'cancelled' };
        process.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { outcome } }));
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
    return session;
  }
}
