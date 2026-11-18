import { expect, test } from 'bun:test';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { getSkills } from '@favo/contracts/rpc/skills/get-skills';
import { importSkills } from '@favo/contracts/rpc/skills/import-skills';
import { resolveSkill } from '@favo/contracts/rpc/skills/resolve-skill';
import { skipSkills } from '@favo/contracts/rpc/skills/skip-skills';
import type { SkillCandidate } from '@favo/domain/skills/skill';
import { createTestServer } from '#test/support/test-server';

function candidate(id: string, name = 'debug-root-cause', fingerprint = id): SkillCandidate {
  return {
    id,
    name,
    fingerprint,
    source: `/skills/${id}`,
    description: 'Systematic diagnosis',
    preview: `Behavior ${id}`,
    warnings: [],
  };
}
async function settled(server: ReturnType<typeof createTestServer>) {
  for (let count = 0; count < 100; count++) {
    const view = await server.client.call(getSkills, {});
    if (['conflicts', 'done', 'failed'].includes(view.phase)) return view;
    await Bun.sleep(1);
  }
  throw new Error('Skill import did not settle');
}
test('first entry offers consent and does not import or publish without it', async () => {
  const server = createTestServer();
  expect((await server.client.call(getSkills, {})).decision).toBe('pending');
  expect((await server.client.call(skipSkills, {})).decision).toBe('skipped');
});
test('imports identical versions once and asks before selecting different behavior', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [
    candidate('debug'),
    candidate('same', 'debug-root-cause', 'debug'),
    candidate('read-only', 'review-pr'),
    candidate('edits', 'review-pr'),
  ];
  await server.client.call(importSkills, {});
  const view = await settled(server);
  expect(view.skills.map((skill) => skill.name)).toEqual(['debug-root-cause']);
  expect(view.conflicts[0]?.candidates.map((variant) => variant.id)).toEqual(['read-only', 'edits']);
  expect(server.skillLibrary.published).toEqual([]);
  const chosen = await server.client.call(resolveSkill, { name: 'review-pr', candidateId: 'edits' });
  expect(chosen.phase).toBe('done');
  expect(chosen.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('edits');
  expect(server.skillLibrary.published).toHaveLength(2);
});
test('opening an agent publishes the catalog only after consent', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect(server.skillLibrary.published).toEqual([]);
  await server.client.call(importSkills, {});
  await settled(server);
  server.skillLibrary.published = [];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'codex' });
  expect(server.skillLibrary.published.map((skill) => skill.name)).toEqual(['debug-root-cause']);
});
test('opening an agent does not block when a skill changed into two different versions', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(importSkills, {});
  await settled(server);
  server.skillLibrary.published = [];
  server.skillLibrary.candidates = [candidate('debug'), candidate('edited', 'debug-root-cause')];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect(server.skillLibrary.published).toEqual([]);
  const view = await server.client.call(getSkills, {});
  expect(view.conflicts[0]?.candidates.map((variant) => variant.id)).toEqual(['debug', 'edited']);
});
test('opening an agent does not block when linking a skill fails', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(importSkills, {});
  await settled(server);
  server.skillLibrary.publishProblems = ['debug-root-cause: Unreviewed skill at /home/x'];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect((await server.client.call(getSkills, {})).problems).toEqual(['debug-root-cause: Unreviewed skill at /home/x']);
});
test('choosing a version needs the user to have agreed to share skills', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('read-only', 'review-pr'), candidate('edits', 'review-pr')];
  await expect(server.client.call(resolveSkill, { name: 'review-pr', candidateId: 'edits' })).rejects.toThrow('Agree');
  expect(server.skillLibrary.adopted).toEqual([]);
});
test('two imports at once scan only once', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await Promise.all([server.client.call(importSkills, {}), server.client.call(importSkills, {})]);
  await settled(server);
  expect(server.skillLibrary.scans).toBe(1);
});
test('an unreadable folder is reported without failing the import', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  server.skillLibrary.problems = ['/skills/broken: Skill bundle exceeds 80 MB.'];
  await server.client.call(importSkills, {});
  const view = await settled(server);
  expect(view.phase).toBe('done');
  expect(view.problems).toEqual(['/skills/broken: Skill bundle exceeds 80 MB.']);
});
test('reading the catalog scans once, not on every read', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(importSkills, {});
  await settled(server);
  const scans = server.skillLibrary.scans;
  await server.client.call(getSkills, {});
  await server.client.call(getSkills, {});
  expect(server.skillLibrary.scans).toBe(scans);
});
test('opening an agent while an import runs does not wait for it', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(importSkills, {});
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect(server.skillLibrary.scans).toBe(1);
});
test('a launch that finds nothing wrong clears an old conflict notice', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('debug'), candidate('edited', 'debug-root-cause')];
  await server.client.call(importSkills, {});
  expect((await settled(server)).phase).toBe('conflicts');
  server.skillLibrary.candidates = [candidate('debug')];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect((await server.client.call(getSkills, {})).phase).toBe('done');
});
test('a skipped user is told sharing is off, not to agree again', async () => {
  const server = createTestServer();
  await server.client.call(skipSkills, {});
  await expect(server.client.call(resolveSkill, { name: 'review-pr', candidateId: 'x' })).rejects.toThrow(
    'sharing is off'
  );
});
