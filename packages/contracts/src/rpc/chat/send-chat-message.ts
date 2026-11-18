import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { ChatView } from '#contracts/rpc/views';

export const sendChatMessage = defineMethod({
  name: 'chat.send',
  routing: MethodRouting.machine,
  params: z.strictObject({ id: z.string(), text: z.string().min(1) }),
  result: ChatView,
});
