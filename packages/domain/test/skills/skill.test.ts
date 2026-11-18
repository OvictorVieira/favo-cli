import { describe, expect, it } from 'bun:test';
import {
  type CatalogSkill,
  catalogCandidateId,
  isCatalogCandidate,
  isSkillWorkRunning,
  type SkillCandidate,
  SkillName,
  SkillPhase,
  skillConflicts,
  toCatalogSkill,
  unresolvedConflicts,
} from '@favo/domain/skills/skill';

function candidate(id: string, name = 'review-pr', fingerprint = id): SkillCandidate {
  return { id, name, fingerprint, source: `/skills/${id}`, description: 'Reviews', preview: id, warnings: [] };
}
function stored(name: string, fingerprint: string, rejected: string[] = []): CatalogSkill {
  return { name, description: 'Reviews', source: '/skills/kept', fingerprint, rejected, warnings: [] };
}

describe('skillConflicts', () => {
  it('merges copies with the same content into one version', () => {
    const [group] = skillConflicts([candidate('a', 'review-pr', 'same'), candidate('b', 'review-pr', 'same')], []);
    expect(group?.candidates.map(({ id }) => id)).toEqual(['a']);
  });
  it('groups different content under the same name', () => {
    const [group] = skillConflicts([candidate('a'), candidate('b')], []);
    expect(group?.candidates).toHaveLength(2);
  });
  it('ignores versions the user already rejected', () => {
    const groups = skillConflicts([candidate('kept'), candidate('old')], [stored('review-pr', 'kept', ['old'])]);
    expect(groups[0]?.candidates.map(({ id }) => id)).toEqual(['kept']);
  });
  it('offers the catalog version beside a new one that differs from it', () => {
    const [group] = skillConflicts([candidate('fresh')], [stored('review-pr', 'kept')]);
    expect(group?.candidates.map(({ id }) => id)).toEqual([catalogCandidateId('review-pr'), 'fresh']);
  });
});

describe('unresolvedConflicts', () => {
  it('keeps only names with more than one version', () => {
    const groups = unresolvedConflicts([candidate('a'), candidate('b'), candidate('c', 'other')], []);
    expect(groups.map(({ name }) => name)).toEqual(['review-pr']);
  });
});

describe('catalog candidates', () => {
  it('are recognised by their id', () => {
    expect(isCatalogCandidate(candidate(catalogCandidateId('review-pr')))).toBe(true);
    expect(isCatalogCandidate(candidate('a'))).toBe(false);
  });
  it('become catalog entries that remember the rejected versions', () => {
    expect(toCatalogSkill(candidate('a'), ['b'])).toEqual({
      name: 'review-pr',
      description: 'Reviews',
      source: '/skills/a',
      fingerprint: 'a',
      rejected: ['b'],
      warnings: [],
    });
  });
});

describe('skill phases', () => {
  it('are busy while scanning, importing or syncing', () => {
    expect(isSkillWorkRunning(SkillPhase.scanning)).toBe(true);
    expect(isSkillWorkRunning(SkillPhase.importing)).toBe(true);
    expect(isSkillWorkRunning(SkillPhase.syncing)).toBe(true);
    expect(isSkillWorkRunning(SkillPhase.conflicts)).toBe(false);
    expect(isSkillWorkRunning(SkillPhase.done)).toBe(false);
  });
});

describe('SkillName', () => {
  it('accepts lowercase words joined by hyphens only', () => {
    expect(SkillName.safeParse('debug-root-cause').success).toBe(true);
    expect(SkillName.safeParse('Debug').success).toBe(false);
    expect(SkillName.safeParse('../escape').success).toBe(false);
  });
});
