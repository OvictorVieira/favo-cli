import { ProviderId } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { persistentChatSession } from '@/modules/chat/gateways/persistent.chat-session';
import { type CodexNotification, codexEventsOf } from '@/modules/chat/utils/codex-events';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const OpenRequestId = 2;

type CodexMessage = CodexNotification & {
  id?: number | string;
  params?: CodexNotification['params'] & { permissions?: Record<string, unknown> };
  result?: { thread?: { id?: string } };
  error?: { message?: string };
};

export class CodexChatRunner extends ChatRunner {
  readonly id = ProviderId.codex;

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
    const process = this.processes.open({ command: binary, args: [...isolationArguments, 'app-server'], env, cwd });
    const waiting: string[] = [];
    let nextId = 1;
    let threadId: string | undefined;

    const { session, emit } = persistentChatSession(process, 'Codex', (text) => {
      if (threadId === undefined) waiting.push(text);
      else turn(text);
    });
    function write(message: unknown) {
      process.write(JSON.stringify(message));
    }
    function request(method: string, params: unknown) {
      write({ id: nextId++, method, params });
    }
    function turn(text: string) {
      request('turn/start', { threadId, input: [{ type: 'text', text }] });
    }

    process.onLine((line) => {
      const message = parseJson(line) as CodexMessage | null;
      if (typeof message !== 'object' || message === null) return;
      if (message.method === 'item/permissions/requestApproval' && message.id !== undefined) {
        const permissions = isDangerouslySkippingPermissions ? (message.params?.permissions ?? {}) : {};
        write({ id: message.id, result: { permissions, scope: 'turn' } });
      } else if (message.method?.endsWith('/requestApproval') && message.id !== undefined) {
        write({ id: message.id, result: { decision: isDangerouslySkippingPermissions ? 'accept' : 'decline' } });
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
    const permissions = isDangerouslySkippingPermissions
      ? { approvalPolicy: 'never', sandbox: 'danger-full-access' }
      : {};
    if (resumeSessionId) request('thread/resume', { threadId: resumeSessionId, cwd, ...permissions });
    else request('thread/start', { cwd, ...permissions });
    return session;
  }
}
