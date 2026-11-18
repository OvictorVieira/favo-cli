import { SkillDecision, SkillState } from '@favo/domain/skills/skill';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

export class SkillStateRepository {
  constructor(
    private readonly files: FileSystem,
    private readonly paths: FavoPaths
  ) {}
  async read(): Promise<SkillState> {
    const text = await this.files.readText(`${this.paths.root}/skills/state.json`);
    return text === undefined ? { decision: SkillDecision.pending, skills: [] } : SkillState.parse(JSON.parse(text));
  }
  async save(state: SkillState) {
    await this.files.replaceText(`${this.paths.root}/skills/state.json`, JSON.stringify(state));
  }
}
