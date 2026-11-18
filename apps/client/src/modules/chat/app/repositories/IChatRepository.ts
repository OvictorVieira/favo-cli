import type { ChatView } from '@favo/contracts/rpc/views';
import type { ProviderId } from '@favo/domain/providers/provider';
import type { Seat } from '@/modules/comb/app/entities/Seat';

export type IChatRepository = {
  start(seat: Seat, directory?: string): Promise<ChatView>;
  send(id: string, text: string): Promise<ChatView>;
  read(id: string): Promise<ChatView>;
  switchProvider(id: string, provider: ProviderId): Promise<ChatView>;
  end(id: string): Promise<void>;
};
