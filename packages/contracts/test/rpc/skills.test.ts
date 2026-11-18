import { describe, expect, it } from 'bun:test';
import { getSkills } from '#contracts/rpc/skills/get-skills';
import { importSkills } from '#contracts/rpc/skills/import-skills';
import { resolveSkill } from '#contracts/rpc/skills/resolve-skill';
import { skipSkills } from '#contracts/rpc/skills/skip-skills';

const view = { decision: 'pending', phase: 'idle', progress: '', skills: [], conflicts: [], problems: [] };

describe('skills', () => {
  it('are read, imported and skipped on the favo you talk to, with no parameters', () => {
    for (const method of [getSkills, importSkills, skipSkills]) {
      expect(method.routing).toBe('hub');
      expect(method.params.safeParse({}).success).toBe(true);
      expect(method.params.safeParse({ extra: 1 }).success).toBe(false);
      expect(method.result.safeParse(view).success).toBe(true);
      expect(method.result.safeParse({ ...view, phase: 'unknown' }).success).toBe(false);
    }
  });
  it('are resolved by naming the skill and the version to keep', () => {
    expect(resolveSkill.params.safeParse({ name: 'review-pr', candidateId: 'abc' }).success).toBe(true);
    expect(resolveSkill.params.safeParse({ name: '../review', candidateId: 'abc' }).success).toBe(false);
    expect(resolveSkill.params.safeParse({ name: 'review-pr' }).success).toBe(false);
  });
});
