import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { ChatSummary } from '#contracts/rpc/views';

export const listChats = defineMethod({
  name: 'chat.list',
  routing: MethodRouting.machine,
  params: z.strictObject({}),
  result: z.array(ChatSummary),
});
