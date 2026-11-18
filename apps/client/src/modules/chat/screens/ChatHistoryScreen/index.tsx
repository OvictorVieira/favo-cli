import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import { ChatHistoryRow } from '@/modules/chat/screens/ChatHistoryScreen/ChatHistoryRow';
import { KeyHint } from '@/shared/components/KeyHint';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

export function ChatHistoryScreen() {
  const colors = useApp((state) => state.colors);
  const chats = useApp((state) => state.chatHistory);
  const resumeChat = useApp((state) => state.resumeChat);
  const closeChatHistory = useApp((state) => state.closeChatHistory);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const selected = chats[selectedIndex];
  const error = useError();

  async function onResume() {
    if (selected) await resumeChat(selected.id);
  }

  useKeyboard((key) => {
    if (key.name === 'escape') closeChatHistory();
    else if (key.name === 'down' || key.name === 'j') setSelectedIndex(Math.min(selectedIndex + 1, chats.length - 1));
    else if (key.name === 'up' || key.name === 'k') setSelectedIndex(Math.max(selectedIndex - 1, 0));
    else if (key.name === 'return') void error.handle(onResume)();
  });

  useEffect(() => {
    if (selected) scrollRef.current?.scrollChildIntoView(`chat:${selected.id}`);
  }, [selected?.id]);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      paddingX={2}
      flexDirection="column"
      backgroundColor={colors.background}
    >
      <text fg={colors.accentBright}>saved chats on this machine</text>
      <scrollbox ref={scrollRef} flexGrow={1} marginTop={1}>
        {chats.map((chat, index) => (
          <ChatHistoryRow key={chat.id} chat={chat} isSelected={index === selectedIndex} />
        ))}
        {chats.length === 0 && <text fg={colors.faint}>no saved chats yet</text>}
      </scrollbox>
      <box flexDirection="row" flexShrink={0}>
        <KeyHint keys="↑↓" label="move" />
        <KeyHint keys="enter" label="resume" onPress={error.handle(onResume)} />
        <KeyHint keys="esc" label="back" onPress={closeChatHistory} />
      </box>
    </box>
  );
}
