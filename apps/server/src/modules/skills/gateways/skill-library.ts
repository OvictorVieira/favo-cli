import type { CatalogSkill, SkillCandidate } from '@favo/domain/skills/skill';

export abstract class SkillLibrary {
  abstract discover(progress: (message: string) => void): Promise<{ candidates: SkillCandidate[]; problems: string[] }>;
  abstract adopt(candidate: SkillCandidate): Promise<void>;
  abstract publish(skills: CatalogSkill[]): Promise<string[]>;
}
