import { expect, test } from 'bun:test';
import { listChats } from '@favo/contracts/rpc/chat/list-chats';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { autoResolveSkills } from '@favo/contracts/rpc/skills/auto-resolve-skills';
import { getSkills } from '@favo/contracts/rpc/skills/get-skills';
import { importSkills } from '@favo/contracts/rpc/skills/import-skills';
import { resolveSkill } from '@favo/contracts/rpc/skills/resolve-skill';
import { skipSkills } from '@favo/contracts/rpc/skills/skip-skills';
import { LoginState } from '@favo/contracts/rpc/views';
import type { SkillCandidate } from '@favo/domain/skills/skill';
import { createTestServer, Home } from '#test/support/test-server';

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

function versioned(id: string, preview: string, modifiedAt: number): SkillCandidate {
  return { ...candidate(id, 'review-pr'), preview, modifiedAt };
}
async function enabledWithConflict(preview: string[]) {
  const server = createTestServer();
  server.skillLibrary.candidates = preview.map((text, index) => versioned(`v${index}`, text, index + 1));
  await server.client.call(importSkills, {});
  expect((await settled(server)).phase).toBe('conflicts');
  return server;
}
const Pick = (id: string) => [
  { type: 'message' as const, text: `{"verdict":"pick","id":"${id}"}` },
  { type: 'turn-completed' as const },
];
const Human = [{ type: 'message' as const, text: '{"verdict":"human"}' }, { type: 'turn-completed' as const }];

test('settles versions that are obviously the same skill without asking any AI', async () => {
  const server = await enabledWithConflict(['a\nb', 'a\nb\nc']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  const view = await server.client.call(autoResolveSkills, {});
  expect(view.conflicts).toEqual([]);
  expect(view.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('v1');
  expect(view.progress).toBe('1 resolved automatically, 0 need you.');
  expect(server.chatRunners.claude.sent).toEqual([]);
});
test('asks the best signed-in provider about versions that really differ, and follows its pick', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.clis.codex.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answers = [Pick('v0')];
  const view = await server.client.call(autoResolveSkills, {});
  expect(server.chatRunners.claude.sent[0]).toContain('only two');
  expect(server.chatRunners.codex.sent).toEqual([]);
  expect(view.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('v0');
  expect(view.progress).toBe('1 resolved automatically, 0 need you.');
});
test('falls back to the next provider when the first cannot answer', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.clis.codex.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answers = [[{ type: 'error', message: 'rate limited' }]];
  server.chatRunners.codex.answers = [Pick('v1')];
  const view = await server.client.call(autoResolveSkills, {});
  expect(view.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('v1');
});
test('leaves the conflict to the user when the AI is not sure or nobody is signed in', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  expect((await server.client.call(autoResolveSkills, {})).conflicts).toHaveLength(1);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answers = [Human];
  const view = await server.client.call(autoResolveSkills, {});
  expect(view.conflicts).toHaveLength(1);
  expect(view.progress).toBe('0 resolved automatically, 1 need you.');
});
test('does not keep the judge conversations in the chat history', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answers = [Pick('v0')];
  await server.client.call(autoResolveSkills, {});
  expect(await server.client.call(listChats, {})).toEqual([]);
});
test('needs the user to have agreed before comparing anything', async () => {
  const server = createTestServer();
  await expect(server.client.call(autoResolveSkills, {})).rejects.toThrow('Agree');
});

test('forgets a catalog saved with an older way of telling versions apart, keeping the answer to the consent', async () => {
  const server = createTestServer();
  const old = {
    decision: 'enabled',
    skills: [
      { name: 'review-pr', description: 'x', source: '/a', fingerprint: 'old-style', rejected: [], warnings: [] },
    ],
  };
  await server.fileSystem.writePrivateText(`${Home}/.favo/skills/state.json`, JSON.stringify(old));
  server.skillLibrary.candidates = [candidate('now', 'review-pr')];
  await server.client.call(importSkills, {});
  const view = await settled(server);
  expect(view.conflicts).toEqual([]);
  expect(view.decision).toBe('enabled');
  expect(view.skills.map((skill) => skill.fingerprint)).toEqual(['now']);
});

test('choosing a version also brings in the skills that had no conflict', async () => {
  const server = createTestServer();
  await server.fileSystem.writePrivateText(
    `${Home}/.favo/skills/state.json`,
    JSON.stringify({ decision: 'enabled', skills: [] })
  );
  server.skillLibrary.candidates = [
    candidate('solo', 'ralph'),
    candidate('read-only', 'review-pr'),
    candidate('edits', 'review-pr'),
  ];
  const chosen = await server.client.call(resolveSkill, { name: 'review-pr', candidateId: 'edits' });
  expect(chosen.skills.map((skill) => skill.name).toSorted()).toEqual(['ralph', 'review-pr']);
  expect(server.skillLibrary.adopted.toSorted()).toEqual(['edits', 'solo']);
});

test('waits for an answer that arrives after the message is sent', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answerDelayMs = 60;
  server.chatRunners.claude.answers = [Pick('v0')];
  const view = await server.client.call(autoResolveSkills, {});
  expect(server.chatRunners.codex.sent).toEqual([]);
  expect(view.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('v0');
});
test('moves on to the next provider when one never answers', async () => {
  const server = await enabledWithConflict(['a\nonly one', 'a\nonly two']);
  server.clis.claude.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.clis.codex.login = { login: LoginState.signedIn, identity: 'bee@x.dev' };
  server.chatRunners.claude.answers = [[{ type: 'error', message: 'exited' }]];
  server.chatRunners.codex.answerDelayMs = 40;
  server.chatRunners.codex.answers = [Pick('v1')];
  const view = await server.client.call(autoResolveSkills, {});
  expect(view.skills.find((skill) => skill.name === 'review-pr')?.fingerprint).toBe('v1');
});

test('forgets a skill that turns out to be one the provider ships itself', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('pdf', 'pdf'), candidate('debug')];
  await server.client.call(importSkills, {});
  expect((await settled(server)).skills.map((skill) => skill.name).toSorted()).toEqual(['debug-root-cause', 'pdf']);
  server.skillLibrary.candidates = [candidate('debug')];
  server.skillLibrary.native = ['pdf'];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect((await server.client.call(getSkills, {})).skills.map((skill) => skill.name)).toEqual(['debug-root-cause']);
});
test('keeps a skill whose name matches a native one when a copy of the user is still around', async () => {
  const server = createTestServer();
  server.skillLibrary.candidates = [candidate('mine', 'skill-creator')];
  await server.client.call(importSkills, {});
  await settled(server);
  server.skillLibrary.native = ['skill-creator'];
  await server.client.call(provisionSeat, { account: 'personal', provider: 'claude' });
  expect((await server.client.call(getSkills, {})).skills.map((skill) => skill.name)).toEqual(['skill-creator']);
});
