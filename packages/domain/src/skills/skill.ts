import { z } from 'zod';

export const SkillDecision = { pending: 'pending', skipped: 'skipped', enabled: 'enabled' } as const;
export const SkillPhase = {
  idle: 'idle',
  scanning: 'scanning',
  importing: 'importing',
  conflicts: 'conflicts',
  syncing: 'syncing',
  done: 'done',
  failed: 'failed',
} as const;
export const SkillName = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(64);
export const SkillCandidate = z.object({
  id: z.string(),
  name: SkillName,
  description: z.string(),
  source: z.string(),
  fingerprint: z.string(),
  preview: z.string(),
  warnings: z.array(z.string()),
  modifiedAt: z.number().optional(),
});
export type SkillCandidate = z.infer<typeof SkillCandidate>;
export const CatalogSkill = z.object({
  name: SkillName,
  description: z.string(),
  source: z.string(),
  fingerprint: z.string(),
  rejected: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type CatalogSkill = z.infer<typeof CatalogSkill>;
export const SkillState = z.object({ decision: z.enum(SkillDecision), skills: z.array(CatalogSkill) });
export type SkillState = z.infer<typeof SkillState>;
export const SkillConflict = z.object({ name: SkillName, candidates: z.array(SkillCandidate) });
export const SkillsView = z.object({
  decision: z.enum(SkillDecision),
  phase: z.enum(SkillPhase),
  progress: z.string(),
  skills: z.array(CatalogSkill),
  conflicts: z.array(SkillConflict),
  problems: z.array(z.string()),
});
export type SkillsView = z.infer<typeof SkillsView>;

export function skillConflicts(candidates: SkillCandidate[], skills: CatalogSkill[]) {
  const groups = new Map<string, SkillCandidate[]>();
  for (const candidate of candidates) {
    const stored = skills.find((skill) => skill.name === candidate.name);
    if (stored?.rejected.includes(candidate.fingerprint)) continue;
    const group = groups.get(candidate.name) ?? [];
    if (!group.some((other) => other.fingerprint === candidate.fingerprint)) group.push(candidate);
    groups.set(candidate.name, group);
  }
  for (const skill of skills) {
    const group = groups.get(skill.name);
    if (!group || group.every((candidate) => candidate.fingerprint === skill.fingerprint)) continue;
    if (!group.some((candidate) => candidate.fingerprint === skill.fingerprint))
      group.unshift({
        id: catalogCandidateId(skill.name),
        name: skill.name,
        description: skill.description,
        source: 'Favo catalog',
        fingerprint: skill.fingerprint,
        preview: 'Keep the current catalog version.',
        warnings: skill.warnings,
      });
  }
  return [...groups].map(([name, candidates]) => ({ name, candidates }));
}

const CatalogCandidatePrefix = 'catalog:';

export function catalogCandidateId(name: string) {
  return `${CatalogCandidatePrefix}${name}`;
}

export function isCatalogCandidate(candidate: SkillCandidate) {
  return candidate.id.startsWith(CatalogCandidatePrefix);
}

export function unresolvedConflicts(candidates: SkillCandidate[], skills: CatalogSkill[]) {
  return skillConflicts(candidates, skills).filter((group) => group.candidates.length > 1);
}

export function toCatalogSkill(candidate: SkillCandidate, rejected: string[]): CatalogSkill {
  return {
    name: candidate.name,
    description: candidate.description,
    source: candidate.source,
    fingerprint: candidate.fingerprint,
    rejected,
    warnings: candidate.warnings,
  };
}

export function isSkillWorkRunning(phase: SkillsView['phase']) {
  return phase === SkillPhase.scanning || phase === SkillPhase.importing || phase === SkillPhase.syncing;
}

export function newestVersions(conflicts: { name: string; candidates: SkillCandidate[] }[]) {
  return conflicts.map(({ name, candidates }) => {
    const newest = candidates.reduce((best, candidate) =>
      (candidate.modifiedAt ?? 0) > (best.modifiedAt ?? 0) ? candidate : best
    );
    return { name, candidateId: newest.id };
  });
}
