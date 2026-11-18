import type { SkillCandidate } from '@favo/domain/skills/skill';
import type { SkillVerdict } from '@favo/domain/skills/skill-judge';

export abstract class SkillJudge {
  abstract judge(name: string, candidates: SkillCandidate[]): Promise<SkillVerdict>;
}
