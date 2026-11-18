import { ProviderId } from '@favo/domain/providers/provider';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { ChatView } from '#contracts/rpc/views';

export const startChat = defineMethod({
  name: 'chat.start',
  routing: MethodRouting.machine,
  params: z.strictObject({ account: z.string(), provider: z.enum(ProviderId), directory: z.string().optional() }),
  result: ChatView,
});
