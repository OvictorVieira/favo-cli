import type { ChatEvent } from '@favo/domain/chat/chat-event';

type Update = { sessionUpdate?: string; title?: string; content?: { type?: string; text?: string } };

export function acpUpdateEventsOf(update: Update): ChatEvent[] {
  if (update.sessionUpdate === 'agent_message_chunk') {
    const { content } = update;
    return content?.type === 'text' && content.text ? [{ type: 'text', text: content.text }] : [];
  }
  return update.sessionUpdate === 'tool_call' && update.title ? [{ type: 'tool', name: update.title }] : [];
}
