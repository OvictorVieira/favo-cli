import type { CatalogSkill, SkillCandidate } from '@favo/domain/skills/skill';

export type DiscoverResult = { candidates: SkillCandidate[]; problems: string[]; native: string[] };
export type PublishResult = { problems: string[]; leftAlone: string[] };

export abstract class SkillLibrary {
  abstract discover(progress: (message: string) => void): Promise<DiscoverResult>;
  abstract adopt(candidate: SkillCandidate): Promise<void>;
  abstract publish(skills: CatalogSkill[], progress?: (message: string) => void): Promise<PublishResult>;
}
