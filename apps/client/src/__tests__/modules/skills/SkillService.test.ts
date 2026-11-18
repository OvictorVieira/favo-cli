import { describe, expect, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';
import { container } from '@/shared/container';

describe('SkillService', () => {
  test('offers sharing on first start and stays quiet once answered', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'pending';
    await app.state.offerSkills();
    expect(app.state.isSkillsOpen).toBe(true);
    app.state.closeSkills();
    mockDb.skills.decision = 'skipped' as typeof mockDb.skills.decision;
    await app.state.offerSkills();
    expect(app.state.isSkillsOpen).toBe(false);
  });
  test('imports nothing until the user starts it', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'pending';
    await app.state.openSkills();
    expect(mockDb.skills.imports).toBe(0);
    await app.state.startSkillImport();
    expect(mockDb.skills.imports).toBe(1);
    expect(app.state.skillsView.decision).toBe('enabled');
    expect(app.state.skillsView.phase).toBe('done');
    expect(app.state.skillsView.skills.map((skill) => skill.name)).toEqual(['debug-root-cause']);
  });
  test('remembers a refusal', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'pending';
    await app.state.openSkills();
    await app.state.skipSkillSharing();
    expect(mockDb.skills.decision as string).toBe('skipped');
    expect(app.state.isSkillsOpen).toBe(false);
  });
  test('stops on a conflict and publishes once every one is chosen', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'pending';
    mockDb.skills.conflicts = [
      {
        name: 'review-pr',
        candidates: [
          {
            id: 'read-only',
            name: 'review-pr',
            description: 'x',
            source: '/a',
            fingerprint: 'a',
            preview: 'reads',
            warnings: [],
          },
          {
            id: 'edits',
            name: 'review-pr',
            description: 'x',
            source: '/b',
            fingerprint: 'b',
            preview: 'edits',
            warnings: [],
          },
        ],
      },
    ];
    await app.state.openSkills();
    await app.state.startSkillImport();
    expect(app.state.skillsView.phase).toBe('conflicts');
    app.state.moveSkillChoice(1);
    await app.state.chooseSkillVersion();
    expect(mockDb.skills.chosen).toEqual([{ name: 'review-pr', candidateId: 'edits' }]);
    expect(app.state.skillsView.phase).toBe('done');
    expect(app.state.skillsView.conflicts).toEqual([]);
  });
  test('keeps the highlighted version inside the list', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'enabled';
    await app.state.openSkills();
    app.state.moveSkillChoice(-1);
    expect(app.state.skillChoiceIndex).toBe(0);
  });
  test('leaves a failed notice, not a running one, when reading the progress throws', async () => {
    const app = await getApp();
    mockDb.skills.decision = 'pending';
    const repository = container.get('ISkillRepository');
    container.register('ISkillRepository', {
      ...repository,
      importSkills: async () => ({ ...(await repository.getSkills()), phase: 'scanning' as const }),
      getSkills: async () => {
        throw new Error('hub went away');
      },
    });
    await expect(app.state.startSkillImport()).rejects.toThrow('hub went away');
    expect(app.state.skillsView.phase).toBe('failed');
    expect(app.state.skillsView.problems).toEqual(['hub went away']);
  });
});
