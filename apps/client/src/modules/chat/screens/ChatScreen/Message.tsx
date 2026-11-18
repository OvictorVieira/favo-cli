import type { ChatMessageView } from '@favo/contracts/rpc/views';
import { Providers } from '@favo/domain/providers/provider';
import { useApp } from '@/shared/stores/app';

export function Message({ message }: { message: ChatMessageView }) {
  const colors = useApp((state) => state.colors);
  const isUser = message.role === 'user';
  const speaker = isUser ? 'you' : speakerOf(message);
  return (
    <box flexDirection="column" flexShrink={0} marginBottom={1}>
      <text fg={isUser ? colors.muted : colors.accent}>{speaker}</text>
      <text fg={colors.text} wrapMode="word">
        {message.text}
      </text>
    </box>
  );
}

function speakerOf({ provider }: ChatMessageView) {
  return provider ? Providers[provider].label : 'assistant';
}
