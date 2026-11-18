import { describe, expect, it } from 'bun:test';
import { type ChatMessage, type Conversation, handoffTextOf, messageFor, withMessage } from '#domain/chat/conversation';

const at = '2026-11-18T12:00:00.000Z';
const said = (role: ChatMessage['role'], text: string): ChatMessage => ({ role, text, at });

function conversationOf(
  messages: ChatMessage[],
  sessions: Conversation['sessions'] = {},
  seen: Conversation['seen'] = {}
): Conversation {
  return { id: 'c1', account: 'work', provider: 'claude', sessions, seen, messages, createdAt: at, updatedAt: at };
}

describe('the conversation handed to the next provider', () => {
  it('says who spoke, in the order they spoke', () => {
    const text = handoffTextOf([said('user', 'Add a retry'), said('assistant', 'Done, in client.ts')]);
    expect(text.indexOf('User:\nAdd a retry')).toBeGreaterThan(-1);
    expect(text.indexOf('Assistant:\nDone, in client.ts')).toBeGreaterThan(text.indexOf('User:\nAdd a retry'));
  });
  it('leaves out a message with nothing in it', () => {
    const text = handoffTextOf([said('user', 'Hi'), said('assistant', '   '), said('user', 'Anyone?')]);
    expect(text.match(/Assistant:/g)).toBeNull();
    expect(text).toContain('User:\nAnyone?');
  });
  it('keeps the newest messages when it is too long, and says the oldest were cut', () => {
    const messages = Array.from({ length: 30 }, (_, index) => said('user', `message ${index} ${'x'.repeat(100)}`));
    const text = handoffTextOf(messages, 1_000);
    expect(text).toContain('oldest messages truncated');
    expect(text).toContain('message 29');
    expect(text).not.toContain('message 0 ');
  });
  it('never starts in the middle of a message when it cuts', () => {
    const messages = Array.from({ length: 20 }, (_, index) => said('assistant', `reply ${index} ${'y'.repeat(80)}`));
    const body = handoffTextOf(messages, 700).split('\n\n').slice(1);
    expect(body[0]).toMatch(/^Assistant:/);
  });
});

describe('the first message a provider receives', () => {
  it('is just what the user typed when it is the first message of the chat', () => {
    expect(messageFor(conversationOf([]), 'claude', 'Hello')).toBe('Hello');
  });
  it('is just what the user typed when that provider already has its own session', () => {
    const conversation = conversationOf(
      [said('user', 'a'), said('assistant', 'b')],
      { claude: 'session-1' },
      { claude: 2 }
    );
    expect(messageFor(conversation, 'claude', 'Next')).toBe('Next');
  });
  it('carries the conversation when the provider has no session of its own, then the new message', () => {
    const conversation = conversationOf([said('user', 'Add a retry'), said('assistant', 'Done')], {
      claude: 'session-1',
    });
    const text = messageFor(conversation, 'codex', 'Now add a timeout');
    expect(text).toContain('Add a retry');
    expect(text).toContain('Done');
    expect(text.trimEnd().endsWith('Now add a timeout')).toBe(true);
    expect(text.indexOf('Done')).toBeLessThan(text.indexOf('Now add a timeout'));
  });
});

describe('coming back to a provider after another one answered', () => {
  const heard = [
    said('user', 'first question'),
    { ...said('assistant', 'claude answer'), provider: 'claude' as const },
    said('user', 'second question'),
    { ...said('assistant', 'codex answer'), provider: 'codex' as const },
  ];
  const both = { claude: 's-1', codex: 's-2' };

  it('carries only what the provider has not seen, then the new message', () => {
    const text = messageFor(conversationOf(heard, both, { claude: 2, codex: 4 }), 'claude', 'third question');
    expect(text).toContain('second question');
    expect(text).toContain('codex answer');
    expect(text).not.toContain('first question');
    expect(text).not.toContain('claude answer');
    expect(text.trimEnd().endsWith('third question')).toBe(true);
  });
  it('sends just the text when the provider has seen everything', () => {
    expect(messageFor(conversationOf(heard, both, { claude: 4 }), 'claude', 'next')).toBe('next');
  });
  it('carries the whole conversation to a provider that has never answered in it', () => {
    const text = messageFor(conversationOf(heard, { codex: 's-2' }, { codex: 4 }), 'claude', 'next');
    expect(text).toContain('first question');
    expect(text).toContain('codex answer');
  });
  it('carries what a failed turn left unseen, so a message that got no answer is not lost', () => {
    const text = messageFor(
      conversationOf([...heard.slice(0, 2), said('user', 'unanswered')], both, { claude: 2 }),
      'claude',
      'again'
    );
    expect(text).toContain('unanswered');
    expect(text.trimEnd().endsWith('again')).toBe(true);
  });
});

describe('adding to a conversation', () => {
  it('appends the message and moves the update time, leaving the original alone', () => {
    const original = conversationOf([said('user', 'a')]);
    const next = withMessage(original, {
      role: 'assistant',
      text: 'b',
      provider: 'claude',
      at: '2026-11-18T12:05:00.000Z',
    });
    expect(next.messages.map(({ text }) => text)).toEqual(['a', 'b']);
    expect(next.updatedAt).toBe('2026-11-18T12:05:00.000Z');
    expect(original.messages).toHaveLength(1);
  });
});
