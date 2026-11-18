import { LoginState } from '@favo/contracts/rpc/views';
import { PersonalAccount } from '@favo/domain/accounts/account';
import { ChatRole } from '@favo/domain/chat/conversation';
import type { SkillCandidate } from '@favo/domain/skills/skill';
import { JudgeProviderOrder, judgePrompt, parseVerdict, type SkillVerdict } from '@favo/domain/skills/skill-judge';
import type { ChatService } from '@/modules/chat/services/chat.service';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import { SkillJudge } from '@/modules/skills/gateways/skill-judge';
import type { FileSystem } from '@/modules/system/gateways/file-system';

export class ChatSkillJudge extends SkillJudge {
  constructor(
    private readonly chats: ChatService,
    private readonly providers: ProvidersService,
    private readonly fileSystem: FileSystem,
    private readonly scratch: string
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
      const view = await this.chats.send(id, prompt);
      const reply = view.messages.findLast((message) => message.role === ChatRole.assistant)?.text;
      return reply === undefined ? undefined : parseVerdict(reply, candidates);
    } catch {
      return undefined;
    } finally {
      if (id) await this.chats.discard(id).catch(() => undefined);
    }
  }
}
