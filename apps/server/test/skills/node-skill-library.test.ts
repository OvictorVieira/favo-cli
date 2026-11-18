import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { NodeSkillLibrary } from '@/modules/skills/gateways/node.skill-library';

let home: string;
let library: NodeSkillLibrary;

beforeEach(async () => {
  home = await mkdtemp(`${tmpdir()}/favo-skills-`);
  library = new NodeSkillLibrary(home, `${home}/.favo`, `${home}/.config`);
});
afterEach(() => rm(home, { recursive: true, force: true }));

async function writeSkill(root: string, name: string, body: string) {
  await mkdir(`${home}/${root}/${name}/references`, { recursive: true });
  await writeFile(`${home}/${root}/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Does ${name}\n---\n${body}\n`);
  await writeFile(`${home}/${root}/${name}/references/notes.md`, 'bundled notes');
}

test('finds the same skill in several agents as one version per content', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'same body');
  await writeSkill('.agents/skills', 'debug-root-cause', 'same body');
  await writeSkill('.cursor/skills', 'review-pr', 'read only');
  await writeSkill('.copilot/skills', 'review-pr', 'edits files');
  const { candidates } = await library.discover(() => {});
  const fingerprints = (name: string) =>
    new Set(candidates.filter((item) => item.name === name).map((item) => item.fingerprint));
  expect(fingerprints('debug-root-cause').size).toBe(1);
  expect(fingerprints('review-pr').size).toBe(2);
});

test('publishes the catalog to every installed agent, keeping bundled files and backing up replaced copies', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  for (const agent of ['.codex', '.cursor', '.copilot', '.config/opencode']) {
    await mkdir(`${home}/${agent}`, { recursive: true });
  }
  const { candidates } = await library.discover(() => {});
  const [candidate] = candidates;
  await library.adopt(candidate!);
  const problems = await library.publish([
    {
      name: 'debug-root-cause',
      description: 'Does debug-root-cause',
      source: candidate!.source,
      fingerprint: candidate!.fingerprint,
      rejected: [],
      warnings: [],
    },
  ]);
  expect(problems).toEqual([]);
  for (const root of [
    '.claude/skills',
    '.agents/skills',
    '.cursor/skills',
    '.copilot/skills',
    '.config/opencode/skills',
  ]) {
    const folder = `${home}/${root}/debug-root-cause`;
    expect((await lstat(folder)).isSymbolicLink()).toBe(true);
    expect(await readFile(`${folder}/references/notes.md`, 'utf8')).toBe('bundled notes');
  }
  expect(await realpath(`${home}/.claude/skills/debug-root-cause`)).toBe(
    await realpath(`${home}/.cursor/skills/debug-root-cause`)
  );
  expect((await readdir(`${home}/.favo/skills/backups`)).length).toBe(1);
});

test('does not create skill folders for agents that are not installed', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  const { candidates } = await library.discover(() => {});
  await library.adopt(candidates[0]!);
  await library.publish([
    {
      name: 'debug-root-cause',
      description: 'x',
      source: candidates[0]!.source,
      fingerprint: candidates[0]!.fingerprint,
      rejected: [],
      warnings: [],
    },
  ]);
  for (const agent of ['.codex', '.cursor', '.copilot', '.gemini', '.agents', '.config']) {
    expect(await lstat(`${home}/${agent}`).catch(() => undefined)).toBeUndefined();
  }
});

test('leaves an install untouched when it cannot be replaced', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  const { candidates } = await library.discover(() => {});
  await library.adopt(candidates[0]!);
  await rm(`${home}/.claude/skills/debug-root-cause`, { recursive: true });
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  await chmod(`${home}/.claude/skills`, 0o500);
  const problems = await library.publish([
    {
      name: 'debug-root-cause',
      description: 'x',
      source: candidates[0]!.source,
      fingerprint: candidates[0]!.fingerprint,
      rejected: [],
      warnings: [],
    },
  ]);
  await chmod(`${home}/.claude/skills`, 0o700);
  expect(problems).toHaveLength(1);
  expect(await readFile(`${home}/.claude/skills/debug-root-cause/SKILL.md`, 'utf8')).toContain('find the cause');
  expect((await readdir(`${home}/.claude/skills`)).sort()).toEqual(['debug-root-cause']);
});

test('says which files were not copied', async () => {
  await writeSkill('.claude/skills', 'leaky', 'body');
  await writeFile(`${home}/.claude/skills/leaky/.env.example`, 'TOKEN=');
  const { candidates } = await library.discover(() => {});
  expect(candidates[0]?.warnings.join()).toContain('.env.example');
});

test('refuses to replace a copy nobody reviewed', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  const { candidates } = await library.discover(() => {});
  await library.adopt(candidates[0]!);
  await writeSkill('.agents/skills', 'debug-root-cause', 'my own different edit');
  const problems = await library.publish([
    {
      name: 'debug-root-cause',
      description: 'x',
      source: candidates[0]!.source,
      fingerprint: candidates[0]!.fingerprint,
      rejected: [],
      warnings: [],
    },
  ]);
  expect(problems.join()).toContain('Unreviewed skill');
  expect(await readFile(`${home}/.agents/skills/debug-root-cause/SKILL.md`, 'utf8')).toContain('my own different edit');
});

test('does not carry credentials or links outside the skill folder into the catalog', async () => {
  await writeSkill('.claude/skills', 'leaky', 'body');
  await writeFile(`${home}/.claude/skills/leaky/.env`, 'TOKEN=secret');
  await writeFile(`${home}/.claude/skills/leaky/credentials.json`, '{}');
  const { candidates } = await library.discover(() => {});
  await library.adopt(candidates[0]!);
  const kept = await readdir(`${home}/.favo/skills/catalog/leaky`);
  expect(kept.sort()).toEqual(['SKILL.md', 'references']);
});

test('an agent folder shared with another tool gets no skill folders of its own', async () => {
  await writeSkill('.claude/skills', 'debug-root-cause', 'find the cause');
  await mkdir(`${home}/.gemini`, { recursive: true });
  await mkdir(`${home}/.codex`, { recursive: true });
  const { candidates } = await library.discover(() => {});
  await library.adopt(candidates[0]!);
  await library.publish([
    {
      name: 'debug-root-cause',
      description: 'x',
      source: candidates[0]!.source,
      fingerprint: candidates[0]!.fingerprint,
      rejected: [],
      warnings: [],
    },
  ]);
  expect(await lstat(`${home}/.gemini/config`).catch(() => undefined)).toBeUndefined();
  expect(await lstat(`${home}/.codex/skills`).catch(() => undefined)).toBeUndefined();
  expect((await lstat(`${home}/.agents/skills/debug-root-cause`)).isSymbolicLink()).toBe(true);
});
