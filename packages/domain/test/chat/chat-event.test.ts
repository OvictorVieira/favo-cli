import { describe, expect, it } from 'bun:test';
import { type ChatEvent, EmptyTurn, turnAfter } from '#domain/chat/chat-event';

function turnOf(events: ChatEvent[]) {
  return events.reduce(turnAfter, EmptyTurn);
}

describe('one turn of an answer', () => {
  it('grows as the text streams in', () => {
    const turn = turnOf([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
    ]);
    expect(turn.text).toBe('Hello');
    expect(turn.isDone).toBe(false);
  });
  it('takes the finished message over the streamed pieces, so the text is not said twice', () => {
    const turn = turnOf([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'message', text: 'Hello' },
      { type: 'turn-completed' },
    ]);
    expect(turn.text).toBe('Hello');
    expect(turn.isDone).toBe(true);
  });
  it('remembers the tools used, once each in the order they came', () => {
    const turn = turnOf([
      { type: 'tool', name: 'Read' },
      { type: 'tool', name: 'Edit' },
      { type: 'tool', name: 'Read' },
    ]);
    expect(turn.tools).toEqual(['Read', 'Edit']);
  });
  it('keeps the provider session id for resuming that provider later', () => {
    expect(turnOf([{ type: 'session', sessionId: 's-1' }]).sessionId).toBe('s-1');
  });
  it('ends the turn with an error and keeps what was said before it', () => {
    const turn = turnOf([
      { type: 'text', text: 'Working' },
      { type: 'error', message: 'usage limit' },
    ]);
    expect(turn.text).toBe('Working');
    expect(turn.error).toBe('usage limit');
    expect(turn.isDone).toBe(true);
  });
  it('does not change the turn it was given', () => {
    const before = turnOf([{ type: 'text', text: 'a' }]);
    turnAfter(before, { type: 'text', text: 'b' });
    expect(before.text).toBe('a');
  });
});
