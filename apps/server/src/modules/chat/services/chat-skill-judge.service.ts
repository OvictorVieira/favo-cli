import { LoginState } from '@favo/contracts/rpc/views';
import { PersonalAccount } from '@favo/domain/accounts/account';
import { ChatRole } from '@favo/domain/chat/conversation';
import type { SkillCandidate } from '@favo/domain/skills/skill';
import { JudgeProviderOrder, judgePrompt, parseVerdict, type SkillVerdict } from '@favo/domain/skills/skill-judge';
import type { ChatService } from '@/modules/chat/services/chat.service';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import { SkillJudge } from '@/modules/skills/gateways/skill-judge';
import type { Clock } from '@/modules/system/gateways/clock';
import type { FileSystem } from '@/modules/system/gateways/file-system';

const PollMilliseconds = 250;
const AnswerTimeoutMilliseconds = 240_000;

export class ChatSkillJudge extends SkillJudge {
  constructor(
    private readonly chats: ChatService,
    private readonly providers: ProvidersService,
    private readonly fileSystem: FileSystem,
    private readonly scratch: string,
    private readonly clock: Clock
  ) {
    super();
  }

  async judge(name: string, candidates: SkillCandidate[]): Promise<SkillVerdict> {
    await this.fileSystem.ensureDirectory(this.scratch);
    for (const provider of JudgeProviderOrder) {
      if (!this.chats.canChatWith(provider)) continue;
      const { login } = await this.providers.loginOf(PersonalAccount, provider);
      if (login !== LoginState.signedIn) continue;
      const verdict = await this.ask(provider, judgePrompt(name, candidates), candidates);
      if (verdict) return verdict;
    }
    return { kind: 'human' };
  }

  private async ask(
    provider: (typeof JudgeProviderOrder)[number],
    prompt: string,
    candidates: SkillCandidate[]
  ): Promise<SkillVerdict | undefined> {
    let id: string | undefined;
    try {
      ({ id } = await this.chats.start({ account: PersonalAccount, provider, directory: this.scratch }));
      await this.chats.send(id, prompt);
      const reply = await this.replyTo(id);
      return reply === undefined ? undefined : parseVerdict(reply, candidates);
    } catch {
      return undefined;
    } finally {
      if (id) await this.chats.discard(id).catch(() => undefined);
    }
  }

  private async replyTo(id: string) {
    const deadline = this.clock.now().getTime() + AnswerTimeoutMilliseconds;
    while (this.clock.now().getTime() < deadline) {
      const view = await this.chats.read(id);
      if (!view.isBusy) return view.messages.findLast((message) => message.role === ChatRole.assistant)?.text;
      await new Promise((resolve) => setTimeout(resolve, PollMilliseconds));
    }
    return undefined;
  }
}
