import { ChatIdPattern, Conversation } from '@favo/domain/chat/conversation';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { parseJson } from '@favo/domain/shared/parse-json';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

const ChatFileName = new RegExp(`^${ChatIdPattern.source.slice(1, -1)}\\.json$`);

export class ConversationRepository {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly paths: FavoPaths
  ) {}

  async find(id: string) {
    assertDomain(ChatIdPattern.test(id), DomainErrorCode.chatNotFound, 'No chat with that id.');
    const parsed = Conversation.safeParse(parseJson((await this.fileSystem.readText(this.fileOf(id))) ?? ''));
    return parsed.success ? parsed.data : undefined;
  }

  async require(id: string) {
    const conversation = await this.find(id);
    assertDomain(conversation, DomainErrorCode.chatNotFound, 'No chat with that id.');
    return conversation;
  }

  async save(conversation: Conversation) {
    await this.fileSystem.ensurePrivateDirectory(this.paths.chats);
    await this.fileSystem.replaceText(this.fileOf(conversation.id), JSON.stringify(conversation));
  }

  async all() {
    const names = await this.fileSystem.list(this.paths.chats);
    const found = await Promise.all(
      names.filter((name) => ChatFileName.test(name)).map((name) => this.find(name.slice(0, -'.json'.length)))
    );
    return found.filter((conversation) => conversation !== undefined);
  }

  private fileOf(id: string) {
    return `${this.paths.chats}/${id}.json`;
  }
}
