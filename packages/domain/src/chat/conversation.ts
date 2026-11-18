import { z } from 'zod';
import { ProviderId } from '#domain/providers/provider';
import type { ValueOf } from '#domain/shared/value-of';

export const ChatRole = {
  user: 'user',
  assistant: 'assistant',
} as const;
export type ChatRole = ValueOf<typeof ChatRole>;

export const ChatMessage = z.object({
  role: z.enum(ChatRole),
  text: z.string(),
  provider: z.enum(ProviderId).optional(),
  at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const Conversation = z.object({
  id: z.string(),
  account: z.string(),
  directory: z.string().optional(),
  provider: z.enum(ProviderId),
  sessions: z.partialRecord(z.enum(ProviderId), z.string()),
  seen: z.partialRecord(z.enum(ProviderId), z.number()).default({}),
  messages: z.array(ChatMessage),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

export const ChatIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const HandoffMaxCharacters = 60_000;
const RoleLabels: Record<ChatRole, string> = { user: 'User', assistant: 'Assistant' };

export function handoffTextOf(messages: ChatMessage[], maxCharacters = HandoffMaxCharacters) {
  const blocks = messages
    .filter(({ text }) => text.trim() !== '')
    .map(({ role, text }) => `${RoleLabels[role]}:\n${text.trim()}`);
  const kept = newestBlocksWithin(blocks, maxCharacters);
  const isTruncated = kept.length < blocks.length;
  const title = `Conversation so far${isTruncated ? ' (oldest messages truncated)' : ''}:`;
  return [title, ...kept].join('\n\n');
}

export function messageFor(conversation: Conversation, provider: ProviderId, text: string) {
  const unseen = conversation.messages.slice(conversation.seen[provider] ?? 0);
  if (!unseen.some((message) => message.text.trim() !== '')) return text;
  return [
    'You are continuing a conversation. Use what follows as context, then answer the new message at the end.',
    handoffTextOf(unseen),
    `New message:\n${text}`,
  ].join('\n\n');
}

export function withSeen(conversation: Conversation, provider: ProviderId): Conversation {
  return { ...conversation, seen: { ...conversation.seen, [provider]: conversation.messages.length } };
}

export function withMessage(conversation: Conversation, message: ChatMessage): Conversation {
  return { ...conversation, messages: [...conversation.messages, message], updatedAt: message.at };
}

function newestBlocksWithin(blocks: string[], maxCharacters: number) {
  const separator = 2;
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks.toReversed()) {
    if (kept.length > 0 && used + block.length + separator > maxCharacters) break;
    kept.unshift(kept.length === 0 && block.length > maxCharacters ? block.slice(-maxCharacters) : block);
    used += block.length + separator;
  }
  return kept;
}
