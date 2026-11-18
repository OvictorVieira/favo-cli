import { ProviderId } from '@favo/domain/providers/provider';
import { ChatRunner, type ChatSession, type ChatSessionSpec } from '@/modules/chat/gateways/chat-runner';
import { persistentChatSession } from '@/modules/chat/gateways/persistent.chat-session';
import { claudeEventsOf } from '@/modules/chat/utils/claude-events';
import { permissionArgumentsFor } from '@/modules/providers/utils/permission-options';
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

  start({
    binary,
    env,
    cwd,
    isolationArguments,
    resumeSessionId,
    isDangerouslySkippingPermissions,
  }: ChatSessionSpec): ChatSession {
    const resume = resumeSessionId ? ['--resume', resumeSessionId] : [];
    const process = this.processes.open({
      command: binary,
      args: [
        ...isolationArguments,
        ...StreamingArguments,
        ...(isDangerouslySkippingPermissions ? permissionArgumentsFor(this.id) : []),
        ...resume,
      ],
      env,
      cwd,
    });
    const { session, emit } = persistentChatSession(process, 'Claude Code', (text) => process.write(userLineOf(text)));
    process.onLine((line) => {
      for (const event of claudeEventsOf(line)) emit(event);
    });
    return session;
  }
}

function userLineOf(text: string) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
}
