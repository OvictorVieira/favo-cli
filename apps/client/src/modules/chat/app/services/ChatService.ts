import type { ChatSummary, ChatView } from '@favo/contracts/rpc/views';
import { ChatProviders } from '@favo/domain/chat/chat-providers';
import { LocalMachineId } from '@favo/domain/machines/machine';
import type { Seat } from '@/modules/comb/app/entities/Seat';
import { ToastKind } from '@/shared/app/services/ToastService';
import { container } from '@/shared/container';
import type { ServiceCreator } from '@/shared/stores/app';

export type ChatService = {
  chat?: ChatView;
  chatInput: string;
  chatHistory: ChatSummary[];
  isChatHistoryOpen: boolean;
  openChatHistory(): Promise<void>;
  closeChatHistory(): void;
  resumeChat(id: string): Promise<void>;
  openChat(seat: Seat): Promise<void>;
  changeChatInput(input: string): void;
  sendChatInput(): Promise<void>;
  nextChatProvider(): Promise<void>;
  closeChat(): Promise<void>;
};

const FollowIntervalMs = 250;

export const createChatService: ServiceCreator<ChatService> = (set, get) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    chat: undefined,
    chatInput: '',
    chatHistory: [],
    isChatHistoryOpen: false,
    async openChatHistory() {
      const chatRepository = container.get('IChatRepository');
      const chatHistory = await chatRepository.list();
      set({ chatHistory, isChatHistoryOpen: true });
    },
    closeChatHistory() {
      set({ isChatHistoryOpen: false });
    },
    async resumeChat(id) {
      const chatRepository = container.get('IChatRepository');
      const chat = await chatRepository.read(id);
      set({ chatInput: '', isChatHistoryOpen: false });
      _follow(chat);
    },
    async openChat(seat) {
      const { showToast, selectedDirectory } = get();
      if (seat.machineId !== LocalMachineId) {
        showToast('A chat runs on this machine only for now.', ToastKind.error);
        return;
      }
      const chatRepository = container.get('IChatRepository');
      const chat = await chatRepository.start(seat, selectedDirectory);
      set({ chatInput: '' });
      _follow(chat);
    },
    changeChatInput(input) {
      set({ chatInput: input });
    },
    async sendChatInput() {
      const { chat, chatInput } = get();
      const text = chatInput.trim();
      if (!chat || text === '' || chat.isBusy) return;
      set({ chatInput: '' });
      const chatRepository = container.get('IChatRepository');
      try {
        _follow(await chatRepository.send(chat.id, text));
      } catch (error) {
        set({ chatInput: text });
        throw error;
      }
    },
    async nextChatProvider() {
      const { chat, accounts, showToast } = get();
      if (!chat) return;
      const account = accounts.find(({ name, machineId }) => name === chat.account && machineId === LocalMachineId);
      const providers = (account?.visibleSeats ?? [])
        .filter((seat) => seat.isSignedIn && ChatProviders.includes(seat.provider))
        .map((seat) => seat.provider);
      const next = providers[(providers.indexOf(chat.provider) + 1) % providers.length];
      if (next === undefined || next === chat.provider) {
        showToast('No other signed-in provider in this account.', ToastKind.error);
        return;
      }
      const chatRepository = container.get('IChatRepository');
      _follow(await chatRepository.switchProvider(chat.id, next));
    },
    async closeChat() {
      clearTimeout(timer);
      const { chat } = get();
      set({ chat: undefined, chatInput: '' });
      const chatRepository = container.get('IChatRepository');
      if (chat) await chatRepository.end(chat.id);
    },
  };

  function _follow(chat: ChatView) {
    clearTimeout(timer);
    set({ chat });
    if (chat.isBusy) timer = setTimeout(() => void _read(chat.id), FollowIntervalMs);
  }

  async function _read(id: string) {
    try {
      const chatRepository = container.get('IChatRepository');
      const chat = await chatRepository.read(id);
      if (get().chat?.id === id) _follow(chat);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { chat, showToast } = get();
      if (chat?.id === id) set({ chat: { ...chat, isBusy: false, turn: undefined, error: message } });
      showToast(message, ToastKind.error);
    }
  }
};
