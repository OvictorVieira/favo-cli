import { ProviderId } from '@favo/domain/providers/provider';
import type { ChatRunners } from '@/modules/chat/gateways/chat-runner';
import { ClaudeChatRunner } from '@/modules/chat/gateways/claude.chat-runner';
import { CodexChatRunner } from '@/modules/chat/gateways/codex.chat-runner';
import { CopilotChatRunner } from '@/modules/chat/gateways/copilot.chat-runner';
import { CursorChatRunner } from '@/modules/chat/gateways/cursor.chat-runner';
import { OpencodeChatRunner } from '@/modules/chat/gateways/opencode.chat-runner';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

export function createChatRunners(processes: ProcessRunner): ChatRunners {
  return {
    [ProviderId.claude]: new ClaudeChatRunner(processes),
    [ProviderId.codex]: new CodexChatRunner(processes),
    [ProviderId.copilot]: new CopilotChatRunner(processes),
    [ProviderId.cursor]: new CursorChatRunner(processes),
    [ProviderId.opencode]: new OpencodeChatRunner(processes),
  };
}
