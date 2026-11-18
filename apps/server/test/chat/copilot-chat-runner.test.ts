import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { type FakeAcpScript, fakeAcpRunner, settled } from '#test/support/fake-acp-agent';
import { CopilotChatRunner } from '@/modules/chat/gateways/copilot.chat-runner';

const spec = { binary: 'copilot', env: { HOME: '/seat/work/copilot' }, cwd: '/code/hive', isolationArguments: [] };

function started(script: FakeAcpScript = {}, overrides: Partial<typeof spec & { resumeSessionId: string }> = {}) {
  const agent = fakeAcpRunner(script);
  const session = new CopilotChatRunner(agent.runner).start({ ...spec, ...overrides });
  const events: ChatEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { ...agent, session, events };
}

const methods = (received: { method?: unknown }[]) => received.map(({ method }) => method);

describe('Copilot chat runner', () => {
  it('starts the agent as the account, in the folder of the chat, and opens a session there', async () => {
    const { opened, received } = started();
    await settled();
    expect(opened[0]).toMatchObject({ command: 'copilot', args: ['--acp'], env: spec.env, cwd: '/code/hive' });
    expect(methods(received)).toEqual(['initialize', 'session/new']);
    expect(received[1]).toMatchObject({ params: { cwd: '/code/hive', mcpServers: [] } });
  });
  it('opens the session in an absolute folder when the chat has none, which the agent insists on', async () => {
    const { received } = started({}, { cwd: undefined });
    await settled();
    expect(received[1]).toMatchObject({ params: { cwd: '/' } });
  });
  it('tells the chat the session id of the agent', async () => {
    const { events } = started({ sessionId: 's-9' });
    await settled();
    expect(events).toEqual([{ type: 'session', sessionId: 's-9' }]);
  });
  it('turns one prompt into the text that streams in, then the end of the turn', async () => {
    const { session, events, received } = started({ chunks: ['Hel', 'lo'] });
    await settled();
    expect(session.send('Hi')).toBe(true);
    await settled();
    expect(received.at(-1)).toMatchObject({
      method: 'session/prompt',
      params: { sessionId: 's-1', prompt: [{ type: 'text', text: 'Hi' }] },
    });
    expect(events.slice(1)).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'turn-completed' },
    ]);
  });
  it('names the tools it used', async () => {
    const { session, events } = started({ tools: ['Read file'], chunks: ['done'] });
    session.send('Hi');
    await settled();
    expect(events).toContainEqual({ type: 'tool', name: 'Read file' });
  });
  it('refuses a request for permission, because a chat has nobody to ask', async () => {
    const { session, received } = started({ asksPermission: true });
    session.send('Hi');
    await settled();
    const answer = received.find((message) => message.id === 900);
    expect(answer).toMatchObject({ id: 900, result: { outcome: { outcome: 'cancelled' } } });
  });
  it('ends the turn with the message when the agent refuses the prompt', async () => {
    const { session, events } = started({ promptError: 'usage limit', chunks: [] });
    session.send('Hi');
    await settled();
    expect(events.at(-1)).toEqual({ type: 'error', message: 'usage limit' });
  });
  it('loads the session it already has instead of opening a new one', async () => {
    const { received } = started({}, { resumeSessionId: 's-0' });
    await settled();
    expect(methods(received)).toEqual(['initialize', 'session/load']);
    expect(received[1]).toMatchObject({ params: { sessionId: 's-0', cwd: '/code/hive' } });
  });
  it('does not take the history it replays on a load for an answer', async () => {
    const { session, events } = started(
      { replaysHistoryOnLoad: ['old answer'], chunks: ['new'] },
      { resumeSessionId: 's-0' }
    );
    session.send('Hi');
    await settled();
    expect(events.filter((event) => event.type === 'text')).toEqual([{ type: 'text', text: 'new' }]);
  });
  it('holds a message sent before the session is open, and sends it once it is', async () => {
    const agent = fakeAcpRunner({ chunks: ['ok'], holdsSession: true });
    const session = new CopilotChatRunner(agent.runner).start(spec);
    await settled();
    expect(session.send('early')).toBe(true);
    await settled();
    expect(methods(agent.received)).toEqual(['initialize', 'session/new']);
    agent.openSession();
    await settled();
    expect(methods(agent.received)).toEqual(['initialize', 'session/new', 'session/prompt']);
  });
  it('takes no message once it has ended, and stops the process', async () => {
    const { session, killedCount } = started();
    session.end();
    expect(session.send('late')).toBe(false);
    expect(killedCount()).toBe(1);
  });
});
