import { describe, expect, it } from 'bun:test';
import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { recordingRunner } from '#test/support/recording-runner';
import { ClaudeChatRunner } from '@/modules/chat/gateways/claude.chat-runner';

const streaming =
  'claude --print --input-format stream-json --output-format stream-json --verbose --include-partial-messages';
const spec = {
  binary: 'claude',
  env: { CLAUDE_CONFIG_DIR: '/seat/work/claude' },
  cwd: '/code/hive',
  isolationArguments: [],
};

const init = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' });
const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const assistant = JSON.stringify({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    ],
  },
});
const finished = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Hello' });

function started(lines: string[], command = streaming) {
  const writes: string[] = [];
  const processes = recordingRunner(writes);
  processes.converse(command, lines);
  const session = new ClaudeChatRunner(processes).start(spec);
  const events: ChatEvent[] = [];
  session.onEvent((event) => events.push(event));
  return { processes, session, events, writes };
}

describe('Claude chat runner', () => {
  it('starts claude in streaming mode, as the account, in the folder of the chat', () => {
    const { processes } = started([]);
    expect(processes.calls[0]).toMatchObject({
      command: 'claude',
      env: { CLAUDE_CONFIG_DIR: '/seat/work/claude' },
      cwd: '/code/hive',
    });
    expect(processes.calls[0]?.args.join(' ')).toBe(streaming.replace('claude ', ''));
  });
  it('bypasses permissions only when the favo session opts in', () => {
    const processes = recordingRunner([]);
    const session = new ClaudeChatRunner(processes).start({ ...spec, isDangerouslySkippingPermissions: true });
    expect(processes.calls[0]?.args).toContain('--dangerously-skip-permissions');
    session.end();
    new ClaudeChatRunner(processes).start(spec).end();
    expect(processes.calls[1]?.args).not.toContain('--dangerously-skip-permissions');
  });
  it('resumes its own session when it has one', () => {
    const processes = recordingRunner([]);
    processes.converse(`${streaming} --resume s-0`, []);
    new ClaudeChatRunner(processes).start({ ...spec, resumeSessionId: 's-0' });
    expect(processes.calls[0]?.args.slice(-2)).toEqual(['--resume', 's-0']);
  });
  it('writes each message as one user line', () => {
    const { session, writes } = started([]);
    expect(session.send('Hello')).toBe(true);
    expect(writes.map((line) => JSON.parse(line))).toEqual([
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] } },
    ]);
  });
  it('turns what claude prints into one turn of events', () => {
    const { session, events } = started([init, delta('Hel'), delta('lo'), assistant, finished]);
    session.send('Hi');
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'message', text: 'Hello' },
      { type: 'tool', name: 'Read' },
      { type: 'turn-completed' },
    ]);
  });
  it('ends the turn with the message when claude reports an error', () => {
    const failed = JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'You have hit your usage limit',
    });
    const { session, events } = started([failed]);
    session.send('Hi');
    expect(events).toEqual([{ type: 'error', message: 'You have hit your usage limit' }]);
  });
  it('ignores a line that is not an event it knows', () => {
    const { session, events } = started([
      'not json',
      '{}',
      '[]',
      '7',
      JSON.stringify({ type: 'system', subtype: 'hook' }),
    ]);
    session.send('Hi');
    expect(events).toEqual([]);
  });
  it('tells the chat when claude cannot start', async () => {
    const processes = recordingRunner([]);
    const session = new ClaudeChatRunner(processes).start(spec);
    const events: ChatEvent[] = [];
    session.onEvent((event) => events.push(event));
    await session.exited;
    expect(events).toEqual([{ type: 'error', message: expect.stringContaining('not found') }]);
  });
  it('takes no message once it has ended, and stops the process', () => {
    const { processes, session } = started([]);
    session.end();
    expect(session.send('late')).toBe(false);
    expect(processes.killed).toHaveLength(1);
  });
});
