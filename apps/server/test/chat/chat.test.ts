import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { endChat } from '@favo/contracts/rpc/chat/end-chat';
import { listChats } from '@favo/contracts/rpc/chat/list-chats';
import { readChat } from '@favo/contracts/rpc/chat/read-chat';
import { sendChatMessage } from '@favo/contracts/rpc/chat/send-chat-message';
import { startChat } from '@favo/contracts/rpc/chat/start-chat';
import { switchChatProvider } from '@favo/contracts/rpc/chat/switch-chat-provider';
import { createTestServer, Home } from '#test/support/test-server';

const Folder = `${Home}/projects/hive`;

async function chatServer() {
  const server = createTestServer();
  await server.client.call(createAccount, { name: 'work' });
  const chat = await server.client.call(startChat, { account: 'work', provider: 'claude', directory: Folder });
  return { ...server, chat };
}

describe('starting a chat', () => {
  it('opens an empty conversation for the account and provider', async () => {
    const { chat } = await chatServer();
    expect(chat).toMatchObject({ account: 'work', provider: 'claude', directory: Folder, isBusy: false, messages: [] });
  });
  it('lists the chats, newest first, with the last thing said', async () => {
    const { client, chat, clock } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'Add a retry' });
    clock.instant = new Date(clock.instant.getTime() + 60_000);
    const second = await client.call(startChat, { account: 'work', provider: 'claude' });
    expect((await client.call(listChats, {})).map(({ id }) => id)).toEqual([second.id, chat.id]);
    expect((await client.call(listChats, {})).at(-1)?.preview).toBe('ok');
  });
  it('refuses a provider that has no chat runner', async () => {
    const { client } = await chatServer();
    await expect(client.call(startChat, { account: 'work', provider: 'antigravity' })).rejects.toMatchObject({
      code: 'chatUnsupported',
    });
  });
  it('refuses an account that does not exist', async () => {
    const { client } = createTestServer();
    await expect(client.call(startChat, { account: 'ghost', provider: 'claude' })).rejects.toMatchObject({
      code: 'accountNotFound',
    });
  });
});

describe('talking in a chat', () => {
  it('keeps what was said and who said it, and saves it for the next run', async () => {
    const { client, chat, fileSystem } = await chatServer();
    const view = await client.call(sendChatMessage, { id: chat.id, text: 'Add a retry' });
    expect(view.messages.map(({ role, text, provider }) => [role, text, provider])).toEqual([
      ['user', 'Add a retry', undefined],
      ['assistant', 'ok', 'claude'],
    ]);
    expect(await fileSystem.readText(`${Home}/.favo/chats/${chat.id}.json`)).toContain('Add a retry');
  });
  it('runs the provider as the account, in the folder of the chat', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'Hi' });
    expect(chatRunners.claude.started[0]).toMatchObject({
      binary: '/usr/bin/claude',
      cwd: Folder,
      env: { CLAUDE_CONFIG_DIR: `${Home}/.favo/accounts/work/claude` },
    });
  });
  it('keeps one live process for the whole chat and sends the next message as it is', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    expect(chatRunners.claude.started).toHaveLength(1);
    expect(chatRunners.claude.sent).toEqual(['first', 'second']);
  });
  it('shows the answer while it is still being written', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [
      [
        { type: 'text', text: 'Thinking' },
        { type: 'tool', name: 'Read' },
      ],
    ];
    const view = await client.call(sendChatMessage, { id: chat.id, text: 'Hi' });
    expect(view.isBusy).toBe(true);
    expect(view.turn).toEqual({ text: 'Thinking', tools: ['Read'] });
    expect((await client.call(readChat, { id: chat.id })).turn?.text).toBe('Thinking');
  });
  it('takes no new message while one is being answered', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.isSilent = true;
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await expect(client.call(sendChatMessage, { id: chat.id, text: 'second' })).rejects.toMatchObject({
      code: 'chatBusy',
    });
  });
  it('shows an error from the provider and keeps what it had said', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [
      [
        { type: 'text', text: 'Working' },
        { type: 'error', message: 'usage limit' },
      ],
    ];
    const view = await client.call(sendChatMessage, { id: chat.id, text: 'Hi' });
    expect(view).toMatchObject({ isBusy: false, error: 'usage limit' });
    const last = view.messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.text).toContain('Working');
    expect(last?.text).toContain('usage limit');
    expect((await client.call(sendChatMessage, { id: chat.id, text: 'Again' })).error).toBeUndefined();
  });
  it('refuses a chat it does not know, or an id that is not one', async () => {
    const { client } = await chatServer();
    await expect(client.call(readChat, { id: '2f1c0d6e-9d52-4a4e-8e0e-1d6f6b3a7c11' })).rejects.toMatchObject({
      code: 'chatNotFound',
    });
    await expect(client.call(readChat, { id: '../../etc/passwd' })).rejects.toMatchObject({ code: 'chatNotFound' });
  });
});

describe('two messages at once', () => {
  it('lets one in and turns the other away, so one process answers one message', async () => {
    const { client, chat, chatRunners } = await chatServer();
    const results = await Promise.allSettled([
      client.call(sendChatMessage, { id: chat.id, text: 'first' }),
      client.call(sendChatMessage, { id: chat.id, text: 'second' }),
    ]);
    expect(results.map(({ status }) => status).toSorted()).toEqual(['fulfilled', 'rejected']);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({ reason: { code: 'chatBusy' } });
    expect(chatRunners.claude.started).toHaveLength(1);
    expect(chatRunners.claude.sent).toHaveLength(1);
  });
  it('takes a new message once the first is done', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    expect(chatRunners.claude.sent).toEqual(['first', 'second']);
  });
});

describe('a provider that cannot start', () => {
  it('leaves the conversation as it was, with no message that nobody answered', async () => {
    const server = createTestServer({ installed: ['codex'] });
    await server.client.call(createAccount, { name: 'work' });
    const chat = await server.client.call(startChat, { account: 'work', provider: 'claude' });
    await expect(server.client.call(sendChatMessage, { id: chat.id, text: 'Hi' })).rejects.toBeDefined();
    expect((await server.client.call(readChat, { id: chat.id })).messages).toEqual([]);
  });
});

describe('a provider process that died between messages', () => {
  it('starts a new one and sends the message there, keeping it once in the conversation', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [
      [{ type: 'session', sessionId: 's-1' }, { type: 'message', text: 'ok' }, { type: 'turn-completed' }],
    ];
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    chatRunners.claude.refusalsLeft = 1;

    const view = await client.call(sendChatMessage, { id: chat.id, text: 'second' });

    expect(chatRunners.claude.started).toHaveLength(2);
    expect(chatRunners.claude.started[1]?.resumeSessionId).toBe('s-1');
    expect(chatRunners.claude.sent.at(-1)).toBe('second');
    expect(view.messages.filter(({ text }) => text === 'second')).toHaveLength(1);
  });
  it('says so when the new process cannot be reached either', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    chatRunners.claude.refusalsLeft = 2;
    await expect(client.call(sendChatMessage, { id: chat.id, text: 'second' })).rejects.toMatchObject({
      code: 'internal',
    });
    expect((await client.call(readChat, { id: chat.id })).isBusy).toBe(false);
  });
});

describe('changing the provider in the middle of the chat', () => {
  it('starts the new provider with the conversation, then the new message, and ends the old process', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'Add a retry' });
    const switched = await client.call(switchChatProvider, { id: chat.id, provider: 'codex' });
    expect(switched.provider).toBe('codex');
    expect(chatRunners.claude.endings).toBe(1);

    const view = await client.call(sendChatMessage, { id: chat.id, text: 'Now add a timeout' });

    const [first] = chatRunners.codex.sent;
    expect(first).toContain('Add a retry');
    expect(first).toContain('ok');
    expect(first?.trimEnd().endsWith('Now add a timeout')).toBe(true);
    expect(view.messages.map(({ text, provider }) => [text, provider])).toEqual([
      ['Add a retry', undefined],
      ['ok', 'claude'],
      ['Now add a timeout', undefined],
      ['ok', 'codex'],
    ]);
  });
  it('refuses a provider that has no chat runner, and keeps the one it had', async () => {
    const { client, chat } = await chatServer();
    await expect(client.call(switchChatProvider, { id: chat.id, provider: 'antigravity' })).rejects.toMatchObject({
      code: 'chatUnsupported',
    });
    expect((await client.call(readChat, { id: chat.id })).provider).toBe('claude');
  });
  it('takes no switch while an answer is being written', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.isSilent = true;
    await client.call(sendChatMessage, { id: chat.id, text: 'Hi' });
    await expect(client.call(switchChatProvider, { id: chat.id, provider: 'codex' })).rejects.toMatchObject({
      code: 'chatBusy',
    });
  });
});

describe('going back to a provider that was in the chat before', () => {
  it('tells it what the other provider said while it was away, and nothing it already knew', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [
      [{ type: 'session', sessionId: 's-1' }, { type: 'message', text: 'claude one' }, { type: 'turn-completed' }],
    ];
    chatRunners.codex.answers = [[{ type: 'message', text: 'codex says hello' }, { type: 'turn-completed' }]];
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(switchChatProvider, { id: chat.id, provider: 'codex' });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    await client.call(switchChatProvider, { id: chat.id, provider: 'claude' });

    await client.call(sendChatMessage, { id: chat.id, text: 'third' });

    const told = chatRunners.claude.sent.at(-1);
    expect(told).toContain('second');
    expect(told).toContain('codex says hello');
    expect(told).not.toContain('claude one');
    expect(told?.trimEnd().endsWith('third')).toBe(true);
    expect(chatRunners.claude.started.at(-1)?.resumeSessionId).toBe('s-1');
  });
  it('keeps sending only the text while no other provider has spoken', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    expect(chatRunners.claude.sent).toEqual(['first', 'second']);
  });
});

describe('a first turn that failed', () => {
  it('carries the message it did not answer into the next one', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [[{ type: 'error', message: 'usage limit' }]];
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    const told = chatRunners.claude.sent.at(-1);
    expect(told).toContain('first');
    expect(told?.trimEnd().endsWith('second')).toBe(true);
  });
});

describe('a provider that speaks before it is asked anything', () => {
  it('keeps both the message and its session id, whichever is written first', async () => {
    const { client, chat, chatRunners, fileSystem } = await chatServer();
    chatRunners.claude.onStart = [{ type: 'session', sessionId: 's-early' }];
    const view = await client.call(sendChatMessage, { id: chat.id, text: 'Hi' });
    expect(view.messages.map(({ text }) => text)).toEqual(['Hi', 'ok']);
    expect(await fileSystem.readText(`${Home}/.favo/chats/${chat.id}.json`)).toContain('s-early');
  });
});

describe('a folder with something else in it', () => {
  it('lists the chats anyway', async () => {
    const { client, chat, fileSystem } = await chatServer();
    await fileSystem.writePrivateText(`${Home}/.favo/chats/notes.json`, '{}');
    await fileSystem.writePrivateText(`${Home}/.favo/chats/${chat.id}.json.123.tmp`, '{');
    expect((await client.call(listChats, {})).map(({ id }) => id)).toEqual([chat.id]);
  });
});

describe('coming back to a chat', () => {
  it('resumes the provider own session instead of replaying the conversation', async () => {
    const { client, chat, chatRunners } = await chatServer();
    chatRunners.claude.answers = [
      [{ type: 'session', sessionId: 's-1' }, { type: 'message', text: 'ok' }, { type: 'turn-completed' }],
    ];
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(endChat, { id: chat.id });
    expect(chatRunners.claude.endings).toBe(1);

    await client.call(sendChatMessage, { id: chat.id, text: 'second' });

    expect(chatRunners.claude.started[1]?.resumeSessionId).toBe('s-1');
    expect(chatRunners.claude.sent.at(-1)).toBe('second');
  });
  it('replays the conversation to a provider that has no session of its own, even after ending', async () => {
    const { client, chat, chatRunners } = await chatServer();
    await client.call(sendChatMessage, { id: chat.id, text: 'first' });
    await client.call(endChat, { id: chat.id });
    await client.call(sendChatMessage, { id: chat.id, text: 'second' });
    expect(chatRunners.claude.started[1]?.resumeSessionId).toBeUndefined();
    expect(chatRunners.claude.sent.at(-1)).toContain('first');
  });
});
