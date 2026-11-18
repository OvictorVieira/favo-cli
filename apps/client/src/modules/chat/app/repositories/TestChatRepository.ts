import type { ChatView } from '@favo/contracts/rpc/views';
import type { ProviderId } from '@favo/domain/providers/provider';
import { mockDb } from '@/__tests__/db';
import type { IChatRepository } from '@/modules/chat/app/repositories/IChatRepository';
import type { Seat } from '@/modules/comb/app/entities/Seat';

const At = '2026-11-18T12:00:00.000Z';

export class TestChatRepository implements IChatRepository {
  async list() {
    return Object.values(mockDb.chats)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, account, directory, provider, messages, updatedAt }) => ({
        id,
        account,
        directory,
        provider,
        updatedAt,
        preview: (messages.at(-1)?.text ?? '').slice(0, 80),
      }));
  }

  async start(seat: Seat, directory?: string) {
    const chat: ChatView = {
      id: `chat-${Object.keys(mockDb.chats).length + 1}`,
      account: seat.account,
      directory,
      provider: seat.provider,
      isBusy: false,
      messages: [],
      updatedAt: At,
    };
    mockDb.chats[chat.id] = chat;
    return chat;
  }

  async send(id: string, text: string) {
    const chat = this.require(id);
    const isBusy = mockDb.chatBusyReads > 0;
    const messages = [...chat.messages, { role: 'user' as const, text, at: At }];
    const answered = isBusy
      ? messages
      : [...messages, { role: 'assistant' as const, text: `echo: ${text}`, provider: chat.provider, at: At }];
    return this.keep({ ...chat, isBusy, messages: answered, turn: isBusy ? { text: '', tools: [] } : undefined });
  }

  async read(id: string) {
    const chat = this.require(id);
    mockDb.chatReads.push(id);
    if (!chat.isBusy) return chat;
    mockDb.chatBusyReads--;
    if (mockDb.chatBusyReads > 0) return chat;
    const messages = [...chat.messages, { role: 'assistant' as const, text: 'done', provider: chat.provider, at: At }];
    return this.keep({ ...chat, isBusy: false, messages, turn: undefined });
  }

  async switchProvider(id: string, provider: ProviderId) {
    return this.keep({ ...this.require(id), provider });
  }

  async end(id: string) {
    mockDb.chatEnded.push(id);
  }

  private require(id: string) {
    const chat = mockDb.chats[id];
    if (!chat) throw new Error(`No chat ${id}.`);
    return chat;
  }

  private keep(chat: ChatView) {
    mockDb.chats[chat.id] = chat;
    return chat;
  }
}
