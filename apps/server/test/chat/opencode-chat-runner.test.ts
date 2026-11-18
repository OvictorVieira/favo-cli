import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { settled } from '#test/support/fake-acp-agent';
import { type OneShotRun, oneShotRunner } from '#test/support/fake-oneshot-agent';
import { OpencodeChatRunner } from '@/modules/chat/gateways/opencode.chat-runner';

const spec = {
  binary: 'opencode',
  env: { XDG_DATA_HOME: '/seat/work/opencode' },
  cwd: '/code/hive',
  isolationArguments: ['--standalone'],
};
const run = ['run', '--format', 'json'];

const line = (type: string, part: object = {}, sessionID = 'ses_1') => JSON.stringify({ type, sessionID, part });
const stepStart = line('step_start');
const said = (text: string) => line('text', { type: 'text', text });
const tool = (name: string) => line('tool_use', { type: 'tool', tool: name, state: { status: 'completed' } });
const stepFinish = line('step_finish', { reason: 'stop' });

function started(runs: OneShotRun[], resumeSessionId?: string) {
  const agent = oneShotRunner(runs);
  const session = new OpencodeChatRunner(agent.runner).start({ ...spec, resumeSessionId });
  const events: ChatEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { ...agent, session, events };
}

describe('OpenCode chat runner', () => {
  it('runs one process for each message, as the account, in the folder of the chat', async () => {
    const { session, opened } = started([{ lines: [stepFinish] }]);
    session.send('Hello');
    await settled();
    expect(opened[0]).toMatchObject({
      command: 'opencode',
      args: ['--standalone', ...run, 'Hello'],
      env: spec.env,
      cwd: '/code/hive',
      hasNoInput: true,
    });
  });
  it('keeps permission bypass on every message and resume only after opt-in', async () => {
    const agent = oneShotRunner([{ lines: [] }, { lines: [] }]);
    const session = new OpencodeChatRunner(agent.runner).start({
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
      expect(request.args).toContain('--auto');
      expect(request.args).toContain('existing');
    }
    session.end();
  });
  it('turns what it prints into one turn of events, and the exit into the end of the turn', async () => {
    const { session, events } = started([{ lines: [stepStart, tool('bash'), said('a.txt'), stepFinish] }]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([
      { type: 'session', sessionId: 'ses_1' },
      { type: 'tool', name: 'bash' },
      { type: 'message', text: 'a.txt' },
      { type: 'turn-completed' },
    ]);
  });
  it('tells the chat the session id once, however many lines carry it', async () => {
    const { session, events } = started([{ lines: [stepStart, said('a'), said('b'), stepFinish] }]);
    session.send('Hi');
    await settled();
    expect(events.filter((event) => event.type === 'session')).toHaveLength(1);
  });
  it('carries on the same session with --session once it has an id', async () => {
    const { session, opened } = started([{ lines: [stepStart] }, { lines: [] }]);
    session.send('first');
    await settled();
    session.send('second');
    await settled();
    expect(opened[1]?.args).toEqual(['--standalone', ...run, '--session', 'ses_1', 'second']);
  });
  it('resumes the session it already has on its first message, without announcing it again', async () => {
    const { session, opened, events } = started([{ lines: [line('step_start', {}, 'ses_0')] }], 'ses_0');
    session.send('Hi');
    await settled();
    expect(opened[0]?.args).toEqual(['--standalone', ...run, '--session', 'ses_0', 'Hi']);
    expect(events.filter((event) => event.type === 'session')).toEqual([]);
  });
  it('ends the turn with the message when it reports an error', async () => {
    const failed = JSON.stringify({
      type: 'error',
      sessionID: 'ses_1',
      error: { name: 'APIError', data: { message: 'rate limit reached' } },
    });
    const { session, events } = started([{ lines: [failed] }]);
    session.send('Hi');
    await settled();
    expect(events.at(-1)).toEqual({ type: 'error', message: 'rate limit reached' });
  });
  it('tells the chat why it stopped when it exits with an error and no event', async () => {
    const { session, events } = started([{ lines: [], code: 1, stderr: 'Error: no model configured' }]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([{ type: 'error', message: 'Error: no model configured' }]);
  });
  it('ignores a line that is not an event it knows', async () => {
    const { session, events } = started([{ lines: ['not json', '{}', '[]'] }]);
    session.send('Hi');
    await settled();
    expect(events).toEqual([{ type: 'turn-completed' }]);
  });
  it('takes no second message while one is being answered, and stops the process when it ends', async () => {
    const { session, killedCount } = started([{ lines: [], staysOpen: true }]);
    expect(session.send('first')).toBe(true);
    expect(session.send('second')).toBe(false);
    session.end();
    expect(killedCount()).toBe(1);
    expect(session.send('late')).toBe(false);
  });
});
