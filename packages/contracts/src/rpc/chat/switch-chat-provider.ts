import { ProviderId } from '@favo/domain/providers/provider';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { ChatView } from '#contracts/rpc/views';

export const switchChatProvider = defineMethod({
  name: 'chat.switch',
  routing: MethodRouting.machine,
  params: z.strictObject({ id: z.string(), provider: z.enum(ProviderId) }),
  result: ChatView,
});
