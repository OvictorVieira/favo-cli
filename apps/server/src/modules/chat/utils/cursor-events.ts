import type { ChatEvent } from '@favo/domain/chat/chat-event';
import { parseJson } from '@favo/domain/shared/parse-json';

type Block = { type?: string; text?: string };
type CursorLine = {
  type?: string;
  subtype?: string;
  session_id?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: Block[] };
  tool_call?: Record<string, { name?: string } | undefined>;
};

const ToolSuffix = 'ToolCall';

export function cursorEventsOf(line: string): ChatEvent[] {
  const parsed = parseJson(line);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const message = parsed as CursorLine;
  if (message.type === 'system')
    return message.subtype === 'init' && message.session_id ? [{ type: 'session', sessionId: message.session_id }] : [];
  if (message.type === 'assistant') return (message.message?.content ?? []).flatMap(textEventsOf);
  if (message.type === 'tool_call') return message.subtype === 'started' ? toolEventsOf(message.tool_call) : [];
  if (message.type !== 'result') return [];
  if (!message.is_error) return [{ type: 'turn-completed' }];
  const reason = message.result?.trim();
  return [{ type: 'error', message: reason ? reason : 'Cursor reported an error.' }];
}

function textEventsOf({ type, text }: Block): ChatEvent[] {
  return type === 'text' && text?.trim() ? [{ type: 'message', text }] : [];
}

function toolEventsOf(toolCall: CursorLine['tool_call']): ChatEvent[] {
  const [key] = Object.keys(toolCall ?? {});
  if (key === undefined) return [];
  const name = toolNameOf(key, toolCall);
  return name ? [{ type: 'tool', name }] : [];
}

function toolNameOf(key: string, toolCall: CursorLine['tool_call']) {
  if (key === 'function') return toolCall?.function?.name;
  return key.endsWith(ToolSuffix) ? key.slice(0, -ToolSuffix.length) : key;
}
