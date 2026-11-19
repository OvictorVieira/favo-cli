import type { CatalogSkill, SkillCandidate } from '@favo/domain/skills/skill';

export type PublishResult = { problems: string[]; leftAlone: string[] };

export abstract class SkillLibrary {
  abstract discover(progress: (message: string) => void): Promise<{ candidates: SkillCandidate[]; problems: string[] }>;
  abstract adopt(candidate: SkillCandidate): Promise<void>;
  abstract publish(skills: CatalogSkill[], progress?: (message: string) => void): Promise<PublishResult>;
}
