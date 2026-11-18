import type { SkillsView } from '@favo/domain/skills/skill';

export type ISkillRepository = {
  getSkills(): Promise<SkillsView>;
  importSkills(): Promise<SkillsView>;
  skipSkills(): Promise<SkillsView>;
  autoResolveSkills(): Promise<SkillsView>;
  resolveSkill(name: string, candidateId: string): Promise<SkillsView>;
};
