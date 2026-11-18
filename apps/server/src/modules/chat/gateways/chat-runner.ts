import type { ChatEvent } from '@favo/domain/chat/chat-event';
import type { ProviderId } from '@favo/domain/providers/provider';

export type ChatSessionSpec = {
  binary: string;
  env: Record<string, string | undefined>;
  cwd?: string;
  isolationArguments: string[];
  resumeSessionId?: string;
  isDangerouslySkippingPermissions?: boolean;
};

export type ChatSession = {
  send(text: string): boolean;
  onEvent(listener: (event: ChatEvent) => void): void;
  end(): void;
  exited: Promise<void>;
};

export type ChatRunners = Partial<Record<ProviderId, ChatRunner>>;

export abstract class ChatRunner {
  abstract readonly id: ProviderId;
  abstract start(spec: ChatSessionSpec): ChatSession;
}
