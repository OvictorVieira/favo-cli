import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const endChat = defineMethod({
  name: 'chat.end',
  routing: MethodRouting.machine,
  params: z.strictObject({ id: z.string() }),
  result: z.strictObject({}),
});
