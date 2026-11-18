import type { ChatSummary, ChatView } from '@favo/contracts/rpc/views';
import { type ChatEvent, type ChatTurn, EmptyTurn, turnAfter } from '@favo/domain/chat/chat-event';
import { ChatRole, type Conversation, messageFor, withMessage, withSeen } from '@favo/domain/chat/conversation';
import type { ProviderId } from '@favo/domain/providers/provider';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import type { SeatsService } from '@/modules/accounts/services/seats.service';
import type { ChatRunners, ChatSession } from '@/modules/chat/gateways/chat-runner';
import type { ConversationRepository } from '@/modules/chat/repositories/conversation.repository';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import type { Clock } from '@/modules/system/gateways/clock';

type Live = {
  provider: ProviderId;
  session: ChatSession;
  turn: ChatTurn;
  isBusy: boolean;
  work: Promise<void>;
  error?: string;
};

const PreviewLength = 80;

export class ChatService {
  private readonly live = new Map<string, Live>();
  private readonly sending = new Set<string>();
  private readonly writes = new Map<string, Promise<unknown>>();

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly providers: ProvidersService,
    private readonly seats: SeatsService,
    private readonly runners: ChatRunners,
    private readonly clock: Clock,
    private readonly isDangerouslySkippingPermissions = false
  ) {}

  async start(params: { account: string; provider: ProviderId; directory?: string }) {
    this.runnerOf(params.provider);
    await this.seats.reconcile(params.account, params.provider);
    const now = this.clock.now().toISOString();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      account: params.account,
      directory: params.directory,
      provider: params.provider,
      sessions: {},
      seen: {},
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.conversations.save(conversation);
    return this.viewOf(conversation);
  }

  async send(id: string, text: string): Promise<ChatView> {
    assertDomain(
      !this.sending.has(id) && !this.live.get(id)?.isBusy,
      DomainErrorCode.chatBusy,
      'Wait for the answer before sending another message.'
    );
    this.sending.add(id);
    try {
      return await this.deliver(id, text);
    } finally {
      this.sending.delete(id);
    }
  }

  private async deliver(id: string, text: string) {
    const conversation = await this.conversations.require(id);
    const first = await this.liveFor(conversation);
    await this.mutate(id, (stored) =>
      withMessage(stored, { role: ChatRole.user, text, at: this.clock.now().toISOString() })
    );
    if (!this.tell(first, conversation, text)) {
      this.stop(id);
      const second = await this.liveFor(conversation);
      assertDomain(this.tell(second, conversation, text), DomainErrorCode.internal, 'Could not reach the provider.');
      await second.live.work;
    } else {
      await first.live.work;
    }
    return this.viewOf(await this.conversations.require(id));
  }

  private tell({ live, isFresh }: { live: Live; isFresh: boolean }, conversation: Conversation, text: string) {
    const { provider } = conversation;
    const heard = isFresh ? { ...conversation, seen: { ...conversation.seen, [provider]: 0 } } : conversation;
    const payload = messageFor(heard, provider, text);
    Object.assign(live, { turn: EmptyTurn, isBusy: true, error: undefined });
    const isDelivered = live.session.send(payload);
    if (!isDelivered) live.isBusy = false;
    return isDelivered;
  }

  async read(id: string) {
    return this.viewOf(await this.conversations.require(id));
  }

  async switchProvider(id: string, provider: ProviderId) {
    await this.conversations.require(id);
    this.runnerOf(provider);
    assertDomain(
      !this.live.get(id)?.isBusy,
      DomainErrorCode.chatBusy,
      'Wait for the answer before switching provider.'
    );
    this.stop(id);
    const switched = await this.mutate(id, (stored) => ({
      ...stored,
      provider,
      updatedAt: this.clock.now().toISOString(),
    }));
    return this.viewOf(switched);
  }

  async end(id: string) {
    await this.conversations.require(id);
    this.stop(id);
    return {};
  }

  async list(): Promise<ChatSummary[]> {
    const all = await this.conversations.all();
    return all
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, account, directory, provider, messages, updatedAt }) => ({
        id,
        account,
        directory,
        provider,
        preview: (messages.at(-1)?.text ?? '').slice(0, PreviewLength),
        updatedAt,
      }));
  }

  private runnerOf(provider: ProviderId) {
    const runner = this.runners[provider];
    assertDomain(runner, DomainErrorCode.chatUnsupported, `A chat with ${provider} is not available yet.`);
    return runner;
  }

  private stop(id: string) {
    this.live.get(id)?.session.end();
    this.live.delete(id);
  }

  private async liveFor(conversation: Conversation) {
    const existing = this.live.get(conversation.id);
    if (existing?.provider === conversation.provider) return { live: existing, isFresh: false };
    const { account, provider, directory } = conversation;
    await this.seats.reconcile(account, provider);
    const session = this.runnerOf(provider).start({
      binary: await this.providers.requireBinary(provider),
      env: await this.providers.environmentOf(account, provider),
      cwd: directory,
      isolationArguments: await this.providers.isolationArgumentsOf(account, provider),
      resumeSessionId: conversation.sessions[provider],
      isDangerouslySkippingPermissions: this.isDangerouslySkippingPermissions,
    });
    const live: Live = { provider, session, turn: EmptyTurn, isBusy: false, work: Promise.resolve() };
    this.live.set(conversation.id, live);
    session.onEvent((event) => {
      live.work = live.work
        .then(() => this.take(conversation.id, live, event))
        .catch((error: unknown) => {
          live.isBusy = false;
          live.error = error instanceof Error ? error.message : String(error);
        });
    });
    return { live, isFresh: conversation.sessions[provider] === undefined };
  }

  private async take(id: string, live: Live, event: ChatEvent) {
    live.turn = turnAfter(live.turn, event);
    if (event.type === 'session') {
      await this.mutate(id, (stored) => ({
        ...stored,
        sessions: { ...stored.sessions, [live.provider]: event.sessionId },
      }));
    }
    if (!live.turn.isDone) return;
    const answer = answerOf(live.turn);
    if (answer.trim() !== '') {
      await this.mutate(id, (stored) =>
        withSeen(
          withMessage(stored, {
            role: ChatRole.assistant,
            text: answer,
            provider: live.provider,
            at: this.clock.now().toISOString(),
          }),
          live.provider
        )
      );
    }
    live.isBusy = false;
    live.error = live.turn.error;
  }

  private mutate(id: string, change: (stored: Conversation) => Conversation) {
    const run = (this.writes.get(id) ?? Promise.resolve()).then(async () => {
      const changed = change(await this.conversations.require(id));
      await this.conversations.save(changed);
      return changed;
    });
    this.writes.set(
      id,
      run.catch(() => {})
    );
    return run;
  }

  private viewOf(conversation: Conversation): ChatView {
    const live = this.live.get(conversation.id);
    const turn = live?.isBusy ? { text: live.turn.text, tools: live.turn.tools } : undefined;
    return {
      id: conversation.id,
      account: conversation.account,
      directory: conversation.directory,
      provider: conversation.provider,
      isBusy: live?.isBusy === true,
      messages: conversation.messages,
      turn,
      error: live?.error,
      updatedAt: conversation.updatedAt,
    };
  }
}

function answerOf({ text, error }: ChatTurn) {
  return error && text.trim() !== '' ? `${text}\n\n[stopped: ${error}]` : text;
}
