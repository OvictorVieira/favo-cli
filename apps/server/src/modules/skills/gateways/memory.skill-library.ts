import type { CatalogSkill, SkillCandidate } from '@favo/domain/skills/skill';
import { SkillLibrary } from './skill-library';

export class MemorySkillLibrary extends SkillLibrary {
  candidates: SkillCandidate[] = [];
  problems: string[] = [];
  native: string[] = [];
  adopted: string[] = [];
  published: CatalogSkill[] = [];
  publishProblems: string[] = [];
  leftAlone: string[] = [];
  scans = 0;
  async discover(progress: (message: string) => void) {
    this.scans++;
    progress('Scanning local skills');
    return { candidates: this.candidates, problems: this.problems, native: this.native };
  }
  async adopt(candidate: SkillCandidate) {
    this.adopted.push(candidate.id);
  }
  async publish(skills: CatalogSkill[]) {
    this.published = skills;
    return { problems: this.publishProblems, leftAlone: this.leftAlone };
  }
}
