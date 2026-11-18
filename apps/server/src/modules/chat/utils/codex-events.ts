import type { ChatEvent } from '@favo/domain/chat/chat-event';

type Item = { type?: string; text?: string; tool?: string };
export type CodexNotification = {
  method?: string;
  params?: { delta?: string; item?: Item; turn?: { status?: string; error?: { message?: string } } };
};

const ToolNames: Record<string, string> = {
  commandExecution: 'shell',
  fileChange: 'edit',
  webSearch: 'web search',
};

export function codexEventsOf({ method, params }: CodexNotification): ChatEvent[] {
  if (method === 'item/agentMessage/delta') return params?.delta ? [{ type: 'text', text: params.delta }] : [];
  if (method === 'item/completed') return finishedItemEventsOf(params?.item);
  if (method === 'item/started') return startedItemEventsOf(params?.item);
  if (method !== 'turn/completed') return [];
  if (params?.turn?.status !== 'failed') return [{ type: 'turn-completed' }];
  return [{ type: 'error', message: params.turn.error?.message ?? 'Codex could not finish the turn.' }];
}

function finishedItemEventsOf(item?: Item): ChatEvent[] {
  return item?.type === 'agentMessage' && item.text?.trim() ? [{ type: 'message', text: item.text }] : [];
}

function startedItemEventsOf(item?: Item): ChatEvent[] {
  const name = item?.type === 'mcpToolCall' ? (item.tool ?? 'tool') : ToolNames[item?.type ?? ''];
  return name ? [{ type: 'tool', name }] : [];
}
