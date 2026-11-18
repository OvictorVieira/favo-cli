import type { ChatMessageView } from '@favo/contracts/rpc/views';
import { Providers } from '@favo/domain/providers/provider';
import { useKeyboard } from '@opentui/react';
import { KeyHint } from '@/shared/components/KeyHint';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

function Message({ message }: { message: ChatMessageView }) {
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

function keyedMessages(messages: ChatMessageView[]) {
  const seen = new Map<string, number>();
  return messages.map((message) => {
    const identity = `${message.at}|${message.role}|${message.text}`;
    const count = (seen.get(identity) ?? 0) + 1;
    seen.set(identity, count);
    return { key: `${identity}|${count}`, message };
  });
}

export function ChatScreen() {
  const colors = useApp((state) => state.colors);
  const chat = useApp((state) => state.chat);
  const chatInput = useApp((state) => state.chatInput);
  const changeChatInput = useApp((state) => state.changeChatInput);
  const sendChatInput = useApp((state) => state.sendChatInput);
  const nextChatProvider = useApp((state) => state.nextChatProvider);
  const closeChat = useApp((state) => state.closeChat);
  const error = useError();

  useKeyboard((key) => {
    if (!chat) return;
    if (key.name === 'escape') void error.handle(closeChat)();
    else if (key.name === 'tab') {
      key.preventDefault();
      void error.handle(nextChatProvider)();
    }
  });

  if (!chat) return null;
  const { label } = Providers[chat.provider];
  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      flexDirection="column"
      paddingX={2}
      backgroundColor={colors.background}
    >
      <text fg={colors.accentBright}>{`chat with ${label} as ${chat.account}`}</text>
      <scrollbox flexGrow={1} stickyScroll stickyStart="bottom" marginTop={1}>
        {keyedMessages(chat.messages).map(({ key, message }) => (
          <Message key={key} message={message} />
        ))}
        {!!chat.turn && (
          <box flexDirection="column" flexShrink={0}>
            <text fg={colors.accent}>{label}</text>
            <text fg={colors.text} wrapMode="word">
              {chat.turn.text === '' ? '…' : chat.turn.text}
            </text>
            {chat.turn.tools.length > 0 && <text fg={colors.faint}>{`using ${chat.turn.tools.join(', ')}`}</text>}
          </box>
        )}
        {!!chat.error && <text fg={colors.danger}>{chat.error}</text>}
      </scrollbox>
      <box border borderStyle="rounded" borderColor={colors.accent} height={3} flexShrink={0}>
        <input
          focused
          value={chatInput}
          placeholder={chat.isBusy ? 'waiting for the answer…' : 'write a message'}
          onInput={changeChatInput}
          onSubmit={() => void error.handle(sendChatInput)()}
          textColor={colors.text}
          placeholderColor={colors.faint}
        />
      </box>
      <box flexDirection="row" flexShrink={0}>
        <KeyHint keys="enter" label="send" onPress={error.handle(sendChatInput)} />
        <KeyHint keys="tab" label="next provider" onPress={error.handle(nextChatProvider)} />
        <KeyHint keys="esc" label="back" onPress={error.handle(closeChat)} />
      </box>
    </box>
  );
}
