import { endChat } from '@favo/contracts/rpc/chat/end-chat';
import { listChats } from '@favo/contracts/rpc/chat/list-chats';
import { readChat } from '@favo/contracts/rpc/chat/read-chat';
import { sendChatMessage } from '@favo/contracts/rpc/chat/send-chat-message';
import { startChat } from '@favo/contracts/rpc/chat/start-chat';
import { switchChatProvider } from '@favo/contracts/rpc/chat/switch-chat-provider';
import type { RpcClient } from '@favo/contracts/rpc/client';
import type { ProviderId } from '@favo/domain/providers/provider';
import type { IChatRepository } from '@/modules/chat/app/repositories/IChatRepository';
import type { Seat } from '@/modules/comb/app/entities/Seat';

export class ApiChatRepository implements IChatRepository {
  constructor(private readonly client: RpcClient) {}

  list() {
    return this.client.call(listChats, {});
  }

  start(seat: Seat, directory?: string) {
    return this.client.call(startChat, { account: seat.account, provider: seat.provider, directory });
  }

  send(id: string, text: string) {
    return this.client.call(sendChatMessage, { id, text });
  }

  read(id: string) {
    return this.client.call(readChat, { id });
  }

  switchProvider(id: string, provider: ProviderId) {
    return this.client.call(switchChatProvider, { id, provider });
  }

  async end(id: string) {
    await this.client.call(endChat, { id });
  }
}
