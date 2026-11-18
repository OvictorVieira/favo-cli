import { SkillDecision, SkillState, SkillStateFormat } from '@favo/domain/skills/skill';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

export class SkillStateRepository {
  constructor(
    private readonly files: FileSystem,
    private readonly paths: FavoPaths
  ) {}

  async read(): Promise<SkillState> {
    const text = await this.files.readText(`${this.paths.root}/skills/state.json`);
    if (text === undefined) return { decision: SkillDecision.pending, skills: [], format: SkillStateFormat };
    const state = SkillState.parse(JSON.parse(text));
    return state.format === SkillStateFormat
      ? state
      : { decision: state.decision, skills: [], format: SkillStateFormat };
  }

  async save(state: SkillState) {
    await this.files.replaceText(
      `${this.paths.root}/skills/state.json`,
      JSON.stringify({ ...state, format: SkillStateFormat })
    );
  }
}
