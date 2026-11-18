import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { endChat } from '@favo/contracts/rpc/chat/end-chat';
import { readChat } from '@favo/contracts/rpc/chat/read-chat';
import { sendChatMessage } from '@favo/contracts/rpc/chat/send-chat-message';
import { startChat } from '@favo/contracts/rpc/chat/start-chat';
import { switchChatProvider } from '@favo/contracts/rpc/chat/switch-chat-provider';
import { ProviderId } from '@favo/domain/providers/provider';
import { createTestServer } from '#test/support/test-server';

const ProvidersUnderEvaluation = [
  ProviderId.claude,
  ProviderId.codex,
  ProviderId.copilot,
  ProviderId.cursor,
  ProviderId.opencode,
] as const;

for (const first of ProvidersUnderEvaluation) {
  for (const second of ProvidersUnderEvaluation) {
    if (first === second) continue;
    describe(`handoff evaluation: ${first} → ${second} → ${first}`, () => {
      it('carries decisions across providers and resumes without repeating known context', async () => {
        const { client, chatRunners } = createTestServer({
          installed: ['claude', 'codex', 'opencode', 'cursor-agent', 'copilot'],
        });
        await client.call(createAccount, { name: 'work' });
        const chat = await client.call(startChat, { account: 'work', provider: first });
        chatRunners[first].answers = [
          [
            { type: 'session', sessionId: 'original-session' },
            { type: 'message', text: 'Use Postgres for persistence.' },
            { type: 'turn-completed' },
          ],
        ];
        await client.call(sendChatMessage, { id: chat.id, text: 'Choose persistence.' });
        await client.call(switchChatProvider, { id: chat.id, provider: second });
        chatRunners[second].answers = [
          [
            { type: 'session', sessionId: 'other-session' },
            { type: 'message', text: 'Add a unique idempotency key.' },
            { type: 'turn-completed' },
          ],
        ];
        await client.call(sendChatMessage, { id: chat.id, text: 'Prevent duplicate writes.' });
        expect(chatRunners[second].sent[0]).toContain('Use Postgres for persistence.');
        expect(chatRunners[second].sent[0]).toContain('Choose persistence.');
        await client.call(switchChatProvider, { id: chat.id, provider: first });
        await client.call(sendChatMessage, { id: chat.id, text: 'Apply both decisions.' });
        const resumedPrompt = chatRunners[first].sent.at(-1);
        expect(resumedPrompt).toContain('Prevent duplicate writes.');
        expect(resumedPrompt).toContain('Add a unique idempotency key.');
        expect(resumedPrompt).not.toContain('Choose persistence.');
        expect(resumedPrompt).not.toContain('Use Postgres for persistence.');
        expect(resumedPrompt?.endsWith('Apply both decisions.')).toBe(true);
        expect(chatRunners[first].started.at(-1)?.resumeSessionId).toBe('original-session');
        await client.call(endChat, { id: chat.id });
        await client.call(sendChatMessage, { id: chat.id, text: 'Continue after reopening.' });
        expect(chatRunners[first].started.at(-1)?.resumeSessionId).toBe('original-session');
        expect(chatRunners[first].sent.at(-1)).toBe('Continue after reopening.');
        const saved = await client.call(readChat, { id: chat.id });
        expect(saved.messages.map(({ text }) => text)).toEqual([
          'Choose persistence.',
          'Use Postgres for persistence.',
          'Prevent duplicate writes.',
          'Add a unique idempotency key.',
          'Apply both decisions.',
          'ok',
          'Continue after reopening.',
          'ok',
        ]);
      });
    });
  }
}
