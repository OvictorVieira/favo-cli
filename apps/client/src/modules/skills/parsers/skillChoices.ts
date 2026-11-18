import type { SkillCandidate, SkillsView } from '@favo/domain/skills/skill';

export type SkillChoice = { name: string; candidate: SkillCandidate };

export function skillChoices(view: SkillsView): SkillChoice[] {
  return view.conflicts.flatMap((conflict) =>
    conflict.candidates.map((candidate) => ({ name: conflict.name, candidate }))
  );
}
