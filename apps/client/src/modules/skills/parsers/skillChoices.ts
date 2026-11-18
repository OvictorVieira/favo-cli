import type { SkillCandidate, SkillsView } from '@favo/domain/skills/skill';

export type SkillChoice = { name: string; candidate: SkillCandidate };

export function skillChoices(view: SkillsView): SkillChoice[] {
  return view.conflicts.flatMap((conflict) =>
    conflict.candidates.map((candidate) => ({ name: conflict.name, candidate }))
  );
}

export function shortPath(path: string, home?: string) {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function modifiedDay(candidate: SkillCandidate) {
  return candidate.modifiedAt ? new Date(candidate.modifiedAt).toISOString().slice(0, 10) : 'catalog';
}
