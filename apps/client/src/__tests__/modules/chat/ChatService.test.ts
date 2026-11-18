import { afterEach, describe, expect, jest, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';
import { container } from '@/shared/container';

async function wait(ms: number) {
  jest.advanceTimersByTime(ms);
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
}

afterEach(() => {
  jest.useRealTimers();
});

describe('ChatService', () => {
  test('opens a chat for the selected seat, in the folder it launches in', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    expect(app.state.chat).toMatchObject({ account: 'personal', provider: 'claude', isBusy: false });
    expect(app.state.chat?.directory).toBe(app.state.selectedDirectory);
  });
  test('reopens a saved conversation after closing it without creating a new chat', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    app.state.changeChatInput('Remember the release checklist');
    await app.state.sendChatInput();
    const saved = app.state.chat!;
    await app.state.closeChat();

    await app.state.openChatHistory();
    expect(app.state.chatHistory.map(({ id }) => id)).toEqual([saved.id]);
    await app.state.resumeChat(saved.id);

    expect(app.state.chat?.id).toBe(saved.id);
    expect(app.state.chat?.messages).toEqual(saved.messages);
    expect(app.state.isChatHistoryOpen).toBe(false);
    app.state.changeChatInput('What did I ask?');
    await app.state.sendChatInput();
    expect(app.state.chat?.messages).toHaveLength(4);
    expect(Object.keys(mockDb.chats)).toHaveLength(1);
  });
  test('does not open a chat for a seat on another machine, and says why', async () => {
    const app = await getApp();
    app.state.selectRow('seat:devbox/personal/claude');
    await app.state.openChat(app.state.selectedSeat!);
    expect(app.state.chat).toBeUndefined();
    expect(app.state.toast?.message).toBe('A chat runs on this machine only for now.');
  });
  test('sends what was typed, clears the box, and shows the answer', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    app.state.changeChatInput('  Hello  ');
    await app.state.sendChatInput();
    expect(app.state.chatInput).toBe('');
    expect(app.state.chat?.messages.map(({ role, text }) => [role, text])).toEqual([
      ['user', 'Hello'],
      ['assistant', 'echo: Hello'],
    ]);
  });
  test('sends nothing when the box is empty', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    app.state.changeChatInput('   ');
    await app.state.sendChatInput();
    expect(app.state.chat?.messages).toEqual([]);
  });
  test('puts the text back in the box when it could not be sent', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    container.get('IChatRepository').send = () => Promise.reject(new Error('could not send'));
    app.state.changeChatInput('Hello');
    await expect(app.state.sendChatInput()).rejects.toThrow('could not send');
    expect(app.state.chatInput).toBe('Hello');
  });
  test('keeps reading while the answer is being written, then stops', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    jest.useFakeTimers();
    mockDb.chatBusyReads = 2;
    app.state.changeChatInput('Hello');
    await app.state.sendChatInput();
    expect(app.state.chat?.isBusy).toBe(true);

    await wait(250);
    expect(app.state.chat?.isBusy).toBe(true);
    await wait(250);
    expect(app.state.chat?.isBusy).toBe(false);
    expect(app.state.chat?.messages.at(-1)?.text).toBe('done');

    mockDb.chatReads = [];
    await wait(2_000);
    expect(mockDb.chatReads).toEqual([]);
  });
  test('stops waiting and shows the error when reading the answer fails, so the chat is not left stuck', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    jest.useFakeTimers();
    mockDb.chatBusyReads = 5;
    app.state.changeChatInput('Hello');
    await app.state.sendChatInput();
    container.get('IChatRepository').read = () => Promise.reject(new Error('the backend went away'));

    await wait(250);

    expect(app.state.chat?.isBusy).toBe(false);
    expect(app.state.chat?.error).toBe('the backend went away');
    expect(app.state.toast?.message).toBe('the backend went away');
  });
  test('does not offer a provider that has no chat', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    mockDb.accounts.local = mockDb.accounts.local!.map((account) => ({
      ...account,
      seats: account.seats.map((seat) => ({
        ...seat,
        isInstalled: seat.provider === 'claude' || seat.provider === 'antigravity',
      })),
    }));
    mockDb.seatStatuses['seat:local/personal/antigravity'] = {
      login: 'signedIn',
      identity: 'bee@hive.dev',
      problems: 0,
    };
    await app.state.refreshMachine('local');
    expect(
      app.state.selectedAccount?.visibleSeats.some((seat) => seat.provider === 'antigravity' && seat.isSignedIn)
    ).toBe(true);

    await app.state.nextChatProvider();

    expect(app.state.chat?.provider).toBe('claude');
    expect(app.state.toast?.message).toBe('No other signed-in provider in this account.');
  });
  test('moves to the next signed-in provider of the account', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    const others = app.state.selectedAccount!.visibleSeats.filter(
      (seat) => seat.isSignedIn && seat.provider !== 'claude'
    );
    expect(others.length).toBeGreaterThan(0);
    await app.state.nextChatProvider();
    expect(app.state.chat?.provider).toBe(others[0]!.provider);
  });
  test('says so when there is no other signed-in provider', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    mockDb.accounts.local = mockDb.accounts.local!.map((account) => ({
      ...account,
      seats: account.seats.map((seat) => (seat.provider === 'claude' ? seat : { ...seat, isInstalled: false })),
    }));
    await app.state.refreshMachine('local');
    await app.state.nextChatProvider();
    expect(app.state.chat?.provider).toBe('claude');
    expect(app.state.toast?.message).toBe('No other signed-in provider in this account.');
  });
  test('ends the chat when it is closed, and stops following it', async () => {
    const app = await getApp();
    await app.state.openChat(app.state.selectedSeat!);
    const id = app.state.chat!.id;
    await app.state.closeChat();
    expect(app.state.chat).toBeUndefined();
    expect(mockDb.chatEnded).toEqual([id]);
  });
});
