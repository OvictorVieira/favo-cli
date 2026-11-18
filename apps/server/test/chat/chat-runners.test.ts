import { describe, expect, it } from 'bun:test';
import { ChatProviders } from '@favo/domain/chat/chat-providers';
import { createChatRunners } from '@/modules/chat/gateways/chat-runners';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

describe('the chat runners favo ships', () => {
  it('are the providers the comb offers a chat with, so the two lists cannot drift apart', () => {
    const runners = createChatRunners(new ScriptedProcessRunner());
    expect(Object.keys(runners).toSorted()).toEqual([...ChatProviders].toSorted());
  });
  it('each answer to the provider they are filed under', () => {
    const runners = createChatRunners(new ScriptedProcessRunner());
    for (const provider of ChatProviders) expect(runners[provider]?.id).toBe(provider);
  });
});
