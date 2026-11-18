import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { settled } from '#test/support/fake-acp-agent';
import { type FakeCodexScript, fakeCodexRunner } from '#test/support/fake-codex-agent';
import { CodexChatRunner } from '@/modules/chat/gateways/codex.chat-runner';

const spec = { binary: 'codex', env: { CODEX_HOME: '/seat/work/codex' }, cwd: '/code/hive', isolationArguments: [] };

function started(script: FakeCodexScript = {}, overrides: { resumeSessionId?: string; cwd?: string | undefined } = {}) {
  const agent = fakeCodexRunner(script);
  const session = new CodexChatRunner(agent.runner).start({ ...spec, ...overrides });
  const events: ChatEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { ...agent, session, events };
}

const methods = (received: { method?: unknown }[]) => received.map(({ method }) => method);

describe('Codex chat runner', () => {
  it('starts the app server as the account and opens a thread in the folder of the chat', async () => {
    const { opened, received } = started();
    await settled();
    expect(opened[0]).toMatchObject({ command: 'codex', args: ['app-server'], env: spec.env, cwd: '/code/hive' });
    expect(methods(received)).toEqual(['initialize', 'initialized', 'thread/start']);
    expect(received[2]).toMatchObject({ params: { cwd: '/code/hive' } });
  });
  it('tells the chat the id of the thread', async () => {
    const { events } = started({ threadId: 'th-9' });
    await settled();
    expect(events).toEqual([{ type: 'session', sessionId: 'th-9' }]);
  });
  it('turns one message into the text that streams in, the finished message, and the end of the turn', async () => {
    const { session, events, received } = started({ chunks: ['Hel', 'lo'] });
    await settled();
    expect(session.send('Hi')).toBe(true);
    await settled();
    expect(received.at(-1)).toMatchObject({
      method: 'turn/start',
      params: { threadId: 'th-1', input: [{ type: 'text', text: 'Hi' }] },
    });
    expect(events.slice(1)).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'message', text: 'Hello' },
      { type: 'turn-completed' },
    ]);
  });
  it('names the tools it used', async () => {
    const { session, events } = started({ tools: [{ type: 'commandExecution' }, { type: 'fileChange' }] });
    await settled();
    session.send('Hi');
    await settled();
    expect(events.filter((event) => event.type === 'tool')).toEqual([
      { type: 'tool', name: 'shell' },
      { type: 'tool', name: 'edit' },
    ]);
  });
  it('declines a request for approval, because a chat has nobody to ask', async () => {
    const { session, received } = started({ asksApproval: true });
    await settled();
    session.send('Hi');
    await settled();
    expect(received.find((message) => message.id === 900)).toMatchObject({ id: 900, result: { decision: 'decline' } });
  });
  it('ends the turn with the message when the turn fails', async () => {
    const { session, events } = started({ failure: 'usage limit', chunks: [] });
    await settled();
    session.send('Hi');
    await settled();
    expect(events.at(-1)).toEqual({ type: 'error', message: 'usage limit' });
  });
  it('resumes the thread it already has instead of starting a new one', async () => {
    const { received } = started({}, { resumeSessionId: 'th-0' });
    await settled();
    expect(methods(received)).toEqual(['initialize', 'initialized', 'thread/resume']);
    expect(received[2]).toMatchObject({ params: { threadId: 'th-0', cwd: '/code/hive' } });
  });
  it('holds a message sent before the thread is open, and sends it once it is', async () => {
    const agent = fakeCodexRunner({ holdsThread: true });
    const session = new CodexChatRunner(agent.runner).start(spec);
    await settled();
    expect(session.send('early')).toBe(true);
    await settled();
    expect(methods(agent.received)).not.toContain('turn/start');
    agent.openThread();
    await settled();
    expect(methods(agent.received)).toContain('turn/start');
  });
  it('takes no message once it has ended, and stops the process', async () => {
    const { session, killedCount } = started();
    await settled();
    session.end();
    expect(session.send('late')).toBe(false);
    expect(killedCount()).toBe(1);
  });
});
