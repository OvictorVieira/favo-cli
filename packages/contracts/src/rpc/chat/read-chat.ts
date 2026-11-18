import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { ChatView } from '#contracts/rpc/views';

export const readChat = defineMethod({
  name: 'chat.read',
  routing: MethodRouting.machine,
  params: z.strictObject({ id: z.string() }),
  result: ChatView,
});
