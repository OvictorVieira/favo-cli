import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { parseJson } from '@favo/domain/shared/parse-json';

type OpencodeLine = {
  type?: string;
  sessionID?: string;
  part?: { text?: string; tool?: string };
  error?: { name?: string; message?: string; data?: { message?: string } };
};

export function opencodeEventsOf(line: string, knownSession?: string): ChatEvent[] {
  const parsed = parseJson(line);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const message = parsed as OpencodeLine;
  const session: ChatEvent[] =
    message.sessionID && message.sessionID !== knownSession ? [{ type: 'session', sessionId: message.sessionID }] : [];
  return [...session, ...eventsOf(message)];
}

function eventsOf({ type, part, error }: OpencodeLine): ChatEvent[] {
  if (type === 'text' && part?.text?.trim()) return [{ type: 'message', text: part.text }];
  if (type === 'tool_use' && part?.tool) return [{ type: 'tool', name: part.tool }];
  if (type !== 'error') return [];
  return [
    { type: 'error', message: error?.data?.message ?? error?.message ?? error?.name ?? 'OpenCode reported an error.' },
  ];
}
