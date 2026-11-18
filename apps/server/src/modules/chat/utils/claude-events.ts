import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { parseJson } from '@favo/domain/shared/parse-json';

type Block = { type?: string; text?: string; name?: string };
type ClaudeLine = {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  event?: { type?: string; delta?: { type?: string; text?: string } };
  message?: { content?: Block[] };
};

export function claudeEventsOf(line: string): ChatEvent[] {
  const parsed = parseJson(line);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const message = parsed as ClaudeLine;
  if (message.type === 'system') return systemEventsOf(message);
  if (message.type === 'stream_event') return deltaEventsOf(message);
  if (message.type === 'assistant') return (message.message?.content ?? []).flatMap(blockEventsOf);
  if (message.type === 'result') return [resultEventOf(message)];
  return [];
}

function systemEventsOf({ subtype, session_id }: ClaudeLine): ChatEvent[] {
  return subtype === 'init' && session_id ? [{ type: 'session', sessionId: session_id }] : [];
}

function deltaEventsOf({ event }: ClaudeLine): ChatEvent[] {
  const { delta } = event ?? {};
  const isText = event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text;
  return isText ? [{ type: 'text', text: delta.text! }] : [];
}

function blockEventsOf({ type, text, name }: Block): ChatEvent[] {
  if (type === 'text' && text?.trim()) return [{ type: 'message', text }];
  return type === 'tool_use' && name ? [{ type: 'tool', name }] : [];
}

function resultEventOf({ is_error, result }: ClaudeLine): ChatEvent {
  if (!is_error) return { type: 'turn-completed' };
  const reason = result?.trim();
  return { type: 'error', message: reason ? reason : 'Claude Code reported an error.' };
}
