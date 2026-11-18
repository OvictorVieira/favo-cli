import type { ChatSummary } from '@favo/contracts/rpc/views';
import { Providers } from '@favo/domain/providers/provider';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

export function ChatHistoryRow({ chat, isSelected }: { chat: ChatSummary; isSelected: boolean }) {
  const colors = useApp((state) => state.colors);
  const resumeChat = useApp((state) => state.resumeChat);
  const error = useError();

  async function onChatClick() {
    await resumeChat(chat.id);
  }

  return (
    <box
      id={`chat:${chat.id}`}
      flexDirection="column"
      flexShrink={0}
      backgroundColor={isSelected ? colors.selection : undefined}
      onMouseDown={error.handle(onChatClick)}
    >
      <text
        fg={colors.accent}
        truncate
      >{`${chat.account} · ${Providers[chat.provider].label} · ${chat.updatedAt}`}</text>
      <text fg={colors.text} truncate>
        {chat.preview === '' ? 'empty chat' : chat.preview}
      </text>
      {!!chat.directory && (
        <text fg={colors.faint} truncate>
          {chat.directory}
        </text>
      )}
    </box>
  );
}
