export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'session'; sessionId: string }
  | { type: 'turn-completed' }
  | { type: 'error'; message: string };

export type ChatTurn = {
  text: string;
  settled: string;
  streaming: string;
  tools: string[];
  sessionId?: string;
  error?: string;
  isDone: boolean;
};

export const EmptyTurn: ChatTurn = { text: '', settled: '', streaming: '', tools: [], isDone: false };

export function turnAfter(turn: ChatTurn, event: ChatEvent): ChatTurn {
  if (event.type === 'text') return withText({ ...turn, streaming: turn.streaming + event.text });
  if (event.type === 'message') return withText({ ...settled(turn, event.text), streaming: '' });
  if (event.type === 'tool')
    return turn.tools.includes(event.name) ? turn : { ...turn, tools: [...turn.tools, event.name] };
  if (event.type === 'session') return { ...turn, sessionId: event.sessionId };
  if (event.type === 'turn-completed')
    return withText({ ...settled(turn, turn.streaming), streaming: '', isDone: true });
  return withText({ ...settled(turn, turn.streaming), streaming: '', error: event.message, isDone: true });
}

function settled(turn: ChatTurn, text: string): ChatTurn {
  return { ...turn, settled: joined(turn.settled, text) };
}

function withText(turn: ChatTurn): ChatTurn {
  return { ...turn, text: joined(turn.settled, turn.streaming) };
}

function joined(first: string, second: string) {
  if (first === '') return second;
  return second === '' ? first : `${first}\n\n${second}`;
}
