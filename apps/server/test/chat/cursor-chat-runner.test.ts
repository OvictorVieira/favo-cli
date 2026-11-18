import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { settled } from '#test/support/fake-acp-agent';
import { type OneShotRun, oneShotRunner } from '#test/support/fake-oneshot-agent';
import { CursorChatRunner } from '@/modules/chat/gateways/cursor.chat-runner';

const spec = { binary: 'cursor-agent', env: { HOME: '/seat/work/cursor' }, cwd: '/code/hive', isolationArguments: [] };
const print = ['-p', '--trust', '--output-format', 'stream-json'];

const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'c-1', model: 'Auto' });
const said = (text: string) =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    session_id: 'c-1',
  });
const tool = (toolCall: object) =>
  JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'x', tool_call: toolCall });
const finished = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  session_id: 'c-1',
});

function started(runs: OneShotRun[], resumeSessionId?: string) {
  const agent = oneShotRunner(runs);
  const session = new CursorChatRunner(agent.runner).start({ ...spec, resumeSessionId });
  const events: ChatEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { ...agent, session, events };
}

describe('Cursor chat runner', () => {
  it('runs one print-mode process for each message, as the account, in the folder of the chat', async () => {
    const { session, opened } = started([{ lines: [finished] }]);
    expect(opened).toHaveLength(0);
    session.send('Hello');
    await settled();
    expect(opened[0]).toMatchObject({
      command: 'cursor-agent',
      args: [...print, 'Hello'],
      env: spec.env,
      cwd: '/code/hive',
      hasNoInput: true,
    });
  });
  it('keeps permission bypass on every message and resume only after opt-in', async () => {
    const agent = oneShotRunner([{ lines: [] }, { lines: [] }]);
    const session = new CursorChatRunner(agent.runner).start({
      ...spec,
      resumeSessionId: 'existing',
      isDangerouslySkippingPermissions: true,
    });
    session.send('first');
    await settled();
    session.send('second');
    await settled();
    expect(agent.opened).toHaveLength(2);
    for (const request of agent.opened) {
      expect(request.args).toContain('--force');
      expect(request.args.filter((argument) => argument === '--trust')).toHaveLength(1);
      expect(request.args).toContain('existing');
    }
    session.end();
  });
  it('turns what the agent prints into one turn of events', async () => {
    const { session, events } = started([
      {
        lines: [
          init,
          said('I will read it.'),
          tool({ readToolCall: { args: {} } }),
          tool({ function: { name: 'Task' } }),
          finished,
        ],
      },
    ]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([
      { type: 'session', sessionId: 'c-1' },
      { type: 'message', text: 'I will read it.' },
      { type: 'tool', name: 'read' },
      { type: 'tool', name: 'Task' },
      { type: 'turn-completed' },
    ]);
  });
  it('carries on the same chat with --resume once it has an id', async () => {
    const { session, opened } = started([{ lines: [init, finished] }, { lines: [finished] }]);
    session.send('first');
    await settled();
    session.send('second');
    await settled();
    expect(opened[1]?.args).toEqual([...print, '--resume', 'c-1', 'second']);
  });
  it('resumes the chat it already has on its first message', async () => {
    const { session, opened } = started([{ lines: [finished] }], 'c-0');
    session.send('Hi');
    await settled();
    expect(opened[0]?.args).toEqual([...print, '--resume', 'c-0', 'Hi']);
  });
  it('ends the turn with the message when the agent reports an error', async () => {
    const failed = JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Something broke' });
    const { session, events } = started([{ lines: [failed] }]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([{ type: 'error', message: 'Something broke' }]);
  });
  it('tells the chat why it stopped when it exits without a result, as on a usage limit', async () => {
    const stderr = "ActionRequiredError: You've hit your usage limit\nGet Cursor Pro for more Agent usage";
    const { session, events } = started([{ lines: [init], code: 1, stderr }]);
    session.send('Hi');
    await settled();
    expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringContaining("You've hit your usage limit") });
  });
  it('does not call it an error when it exits after a result', async () => {
    const { session, events } = started([{ lines: [finished], code: 1, stderr: 'noise' }]);
    session.send('Hi');
    await settled();
    expect(events.filter((event) => event.type === 'error')).toEqual([]);
  });
  it('ignores a line that is not an event it knows', async () => {
    const { session, events } = started([{ lines: ['not json', '{}', '[]', finished] }]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([{ type: 'turn-completed' }]);
  });
  it('takes no second message while one is being answered', async () => {
    const { session } = started([{ lines: [], staysOpen: true }]);
    expect(session.send('first')).toBe(true);
    expect(session.send('second')).toBe(false);
  });
  it('stops the running process when it ends, and takes no more messages', async () => {
    const { session, killedCount } = started([{ lines: [], staysOpen: true }]);
    session.send('first');
    session.end();
    expect(killedCount()).toBe(1);
    expect(session.send('late')).toBe(false);
  });
});
