import { endChat } from '@favo/contracts/rpc/chat/end-chat';
import { listChats } from '@favo/contracts/rpc/chat/list-chats';
import { readChat } from '@favo/contracts/rpc/chat/read-chat';
import { sendChatMessage } from '@favo/contracts/rpc/chat/send-chat-message';
import { startChat } from '@favo/contracts/rpc/chat/start-chat';
import { switchChatProvider } from '@favo/contracts/rpc/chat/switch-chat-provider';
import type { ChatService } from '@/modules/chat/services/chat.service';
import type { RpcRouter } from '@/shared/rpc/rpc-router';

export function registerChatController(router: RpcRouter, chat: ChatService) {
  router.handle(startChat, (params) => chat.start(params));
  router.handle(sendChatMessage, ({ id, text }) => chat.send(id, text));
  router.handle(readChat, ({ id }) => chat.read(id));
  router.handle(switchChatProvider, ({ id, provider }) => chat.switchProvider(id, provider));
  router.handle(listChats, () => chat.list());
  router.handle(endChat, ({ id }) => chat.end(id));
}
