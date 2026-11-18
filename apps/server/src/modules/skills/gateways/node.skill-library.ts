import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ProviderId } from '@favo/domain/providers/provider';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { type CatalogSkill, type SkillCandidate, SkillName } from '@favo/domain/skills/skill';
import { SkillLibrary } from './skill-library';

const AgentHomes: Record<Exclude<ProviderId, 'opencode'>, { marker: string; roots: string[] }> = {
  claude: { marker: '.claude', roots: ['.claude/skills'] },
  codex: { marker: '.codex', roots: ['.agents/skills', '.codex/skills'] },
  cursor: { marker: '.cursor', roots: ['.cursor/skills'] },
  copilot: { marker: '.copilot', roots: ['.copilot/skills'] },
  antigravity: {
    marker: '.gemini/antigravity-cli',
    roots: ['.gemini/antigravity-cli/skills', '.gemini/config/skills', '.gemini/skills'],
  },
};
const OmittedFolders = new Set(['.git', 'node_modules', '__pycache__']);
const MaximumBundleBytes = 80 * 1024 * 1024;
const PortableMarker = '<!-- FAVO PORTABLE SKILL -->';

type BundleFile = { path: string; bytes: Buffer; mode: number };
type Bundle = {
  candidate: SkillCandidate;
  files: BundleFile[];
  root: string;
  markdown: string;
  metadata: Record<string, unknown>;
};

export class NodeSkillLibrary extends SkillLibrary {
  private bundles = new Map<string, Bundle>();
  private readonly catalog: string;
  private readonly backups: string;
  constructor(
    private readonly home: string,
    private readonly root: string,
    private readonly configHome = `${home}/.config`
  ) {
    super();
    this.catalog = `${root}/skills/catalog`;
    this.backups = `${root}/skills/backups`;
  }

  async discover(progress: (message: string) => void) {
    const candidates: SkillCandidate[] = [];
    const problems: string[] = [];
    const visited = new Set<string>();
    this.bundles.clear();
    const roots = this.agents().flatMap((agent) => agent.roots);
    const manifest = await readFile(`${this.home}/.claude/plugins/installed_plugins.json`, 'utf8').catch(
      () => undefined
    );
    if (manifest) {
      try {
        const installed: unknown = JSON.parse(manifest);
        if (isRecord(installed) && isRecord(installed.plugins)) {
          for (const versions of Object.values(installed.plugins)) {
            if (!Array.isArray(versions)) continue;
            for (const version of versions) {
              if (isRecord(version) && typeof version.installPath === 'string' && version.scope === 'user')
                roots.push(`${version.installPath}/skills`);
            }
          }
        }
      } catch {
        problems.push('Claude plugin manifest could not be read. Personal skills can still be imported.');
      }
    }
    for (const folder of roots) await walk.call(this, folder, 0);
    return { candidates, problems };

    async function walk(this: NodeSkillLibrary, folder: string, depth: number): Promise<void> {
      try {
        if (depth > 12) {
          problems.push(`Skill nesting exceeds 12 levels: ${folder}`);
          return;
        }
        const target = await realpath(folder).catch(() => undefined);
        if (!target || visited.has(target) || isWithin(this.catalog, target) || isWithin(this.backups, target)) return;
        visited.add(target);
        if (!(await stat(target)).isDirectory()) return;
        progress(`Reading ${folder.replace(this.home, '~')}`);
        if (await stat(`${target}/SKILL.md`).catch(() => undefined)) {
          const bundle = await this.bundle(folder);
          this.bundles.set(bundle.candidate.id, bundle);
          candidates.push(bundle.candidate);
          return;
        }
        for (const entry of (await readdir(target)).sort()) {
          if (!OmittedFolders.has(entry) && !entry.startsWith('.'))
            await walk.call(this, `${folder}/${entry}`, depth + 1);
        }
      } catch (error) {
        problems.push(`${folder}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async adopt(candidate: SkillCandidate) {
    const known = this.bundles.get(candidate.id);
    assertDomain(known, DomainErrorCode.invalidParams, 'Scan local skills before importing.');
    const bundle = await this.bundle(candidate.source);
    assertDomain(
      bundle.candidate.fingerprint === candidate.fingerprint,
      DomainErrorCode.invalidParams,
      'Skill changed during import. Scan again.'
    );
    const temporary = `${this.root}/skills/staging/${randomUUID()}`;
    let kept: string | undefined;
    const destination = `${this.catalog}/${candidate.name}`;
    try {
      await mkdir(temporary, { recursive: true, mode: 0o700 });
      for (const file of bundle.files) {
        const staged = `${temporary}/${file.path}`;
        await mkdir(dirname(staged), { recursive: true, mode: 0o700 });
        const bytes = file.path === 'SKILL.md' ? Buffer.from(portableSkill(bundle, this.catalog)) : file.bytes;
        await writeFile(staged, bytes, { mode: file.mode });
        await chmod(staged, file.mode);
      }
      await mkdir(this.catalog, { recursive: true, mode: 0o700 });
      kept = await this.backup(destination);
      await rename(temporary, destination);
    } catch (error) {
      if (kept) await this.move(kept, destination).catch(() => undefined);
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async publish(skills: CatalogSkill[]) {
    const problems: string[] = [];
    for (const root of await this.installedRoots()) {
      for (const skill of skills) {
        try {
          await this.link(root, skill);
        } catch (error) {
          problems.push(`${skill.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return problems;
  }

  private agents() {
    const opencode = `${this.configHome}/opencode`;
    return [
      ...Object.values(AgentHomes).map(({ marker, roots }) => ({
        marker: `${this.home}/${marker}`,
        roots: roots.map((path) => `${this.home}/${path}`),
      })),
      { marker: opencode, roots: [`${opencode}/skills`] },
    ];
  }

  private async installedRoots() {
    const installed: string[] = [];
    for (const agent of this.agents()) {
      const hasAgent = await lstat(agent.marker).catch(() => undefined);
      for (const [index, root] of agent.roots.entries()) {
        const isPrimary = index === 0 && hasAgent;
        if (isPrimary || (await lstat(root).catch(() => undefined))) installed.push(root);
      }
    }
    return [...new Set(installed)];
  }

  private async link(root: string, skill: CatalogSkill) {
    const source = `${this.catalog}/${skill.name}`;
    assertDomain(
      await stat(`${source}/SKILL.md`).catch(() => undefined),
      DomainErrorCode.invalidConfig,
      `Catalog skill missing: ${skill.name}`
    );
    const destination = `${root}/${skill.name}`;
    if ((await realpath(destination).catch(() => undefined)) === (await realpath(source))) return;
    const approved = [skill.fingerprint, ...skill.rejected];
    if (await lstat(destination).catch(() => undefined)) {
      const current = await this.bundle(destination);
      assertDomain(
        current.candidate.name === skill.name && approved.includes(current.candidate.fingerprint),
        DomainErrorCode.invalidParams,
        `Unreviewed skill at ${destination}. Import again before replacing it.`
      );
    }
    const strays = await this.strayCopies(root, destination, skill.name, approved);
    await mkdir(root, { recursive: true });
    await this.replace(destination, source);
    for (const stray of strays) await this.backup(stray);
  }

  private async strayCopies(root: string, destination: string, name: string, approved: string[]) {
    const strays: string[] = [];
    for (const { candidate } of this.bundles.values()) {
      if (candidate.name !== name || !isWithin(root, candidate.source) || candidate.source === destination) continue;
      if (!(await lstat(candidate.source).catch(() => undefined))) continue;
      const current = await this.bundle(candidate.source);
      assertDomain(
        approved.includes(current.candidate.fingerprint),
        DomainErrorCode.invalidParams,
        `Choose which ${name} to keep before syncing.`
      );
      strays.push(candidate.source);
    }
    return strays;
  }

  private async replace(destination: string, source: string) {
    const staged = `${destination}.favo-${randomUUID()}`;
    await symlink(source, staged, process.platform === 'win32' ? 'junction' : 'dir');
    let kept: string | undefined;
    try {
      kept = await this.backup(destination);
      await rename(staged, destination);
    } catch (error) {
      if (kept) await this.move(kept, destination).catch(() => undefined);
      await rm(staged, { force: true });
      throw error;
    }
  }

  private async backup(path: string) {
    if (!(await lstat(path).catch(() => undefined))) return undefined;
    await mkdir(this.backups, { recursive: true, mode: 0o700 });
    const kept = `${this.backups}/${randomUUID()}-${basename(path)}`;
    await this.move(path, kept);
    return kept;
  }

  private async move(from: string, to: string) {
    try {
      await rename(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await cp(from, to, { recursive: true, verbatimSymlinks: true });
      await rm(from, { recursive: true, force: true });
    }
  }

  private async bundle(source: string): Promise<Bundle> {
    const root = await realpath(source);
    const files: BundleFile[] = [];
    let size = 0;
    const omitted: string[] = [];
    const visited = new Set<string>();
    async function collect(folder: string, prefix: string): Promise<void> {
      const actual = await realpath(folder);
      assertDomain(
        isWithin(root, actual),
        DomainErrorCode.invalidParams,
        `Linked resource outside the skill folder: ${prefix}`
      );
      assertDomain(!visited.has(actual), DomainErrorCode.invalidParams, `Cyclic skill resources: ${prefix}`);
      visited.add(actual);
      for (const name of (await readdir(folder)).sort()) {
        if (OmittedFolders.has(name) || name.startsWith('.env') || /^(auth|credentials)\.json$/.test(name)) {
          omitted.push(`${prefix}${name}`);
          continue;
        }
        const path = `${folder}/${name}`;
        const target = await realpath(path);
        assertDomain(
          isWithin(root, target),
          DomainErrorCode.invalidParams,
          `Linked resource outside the skill folder: ${prefix}${name}`
        );
        const info = await stat(path);
        if (info.isDirectory()) await collect(path, `${prefix}${name}/`);
        else if (info.isFile()) {
          size += info.size;
          assertDomain(size <= MaximumBundleBytes, DomainErrorCode.invalidParams, 'Skill bundle exceeds 80 MB.');
          files.push({ path: `${prefix}${name}`, bytes: await readFile(path), mode: info.mode & 0o777 });
        }
      }
      visited.delete(actual);
    }
    await collect(source, '');
    const markdown = files.find((file) => file.path === 'SKILL.md')?.bytes.toString('utf8') ?? '';
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    const parsed: unknown = frontmatter ? Bun.YAML.parse(frontmatter[1]!) : {};
    const metadata = isRecord(parsed) ? parsed : {};
    const rawName = typeof metadata.name === 'string' ? metadata.name : basename(source);
    const name = rawName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    SkillName.parse(name);
    const description =
      typeof metadata.description === 'string' ? metadata.description.trim() : `Use the ${name} workflow.`;
    const hash = createHash('sha256');
    for (const file of files) hash.update(`${file.path}\0${file.mode}\0${file.bytes.length}\0`).update(file.bytes);
    const fingerprint = hash.digest('hex');
    const id = createHash('sha256').update(source).update(fingerprint).digest('hex').slice(0, 24);
    const warnings: string[] = [];
    if (omitted.length > 0) {
      warnings.push(
        `Not copied (secrets, caches or build folders): ${omitted.join(', ')}. Only the backup of the original keeps them.`
      );
    }
    if (/mcp|plugin|perplexity/i.test(markdown))
      warnings.push(
        'External plugins/MCP tools must be available in the target agent; importing a skill does not install integrations.'
      );
    if (/\/Users\/|\/home\/|CLAUDE_PLUGIN_ROOT/.test(markdown))
      warnings.push('Contains local paths or plugin resources; check these dependencies on another machine.');
    if (metadata.context || metadata.agent || metadata.hooks)
      warnings.push(
        'Provider-specific execution settings are retained as instructions; native hooks and subagents require target support.'
      );
    return {
      root,
      files,
      markdown,
      metadata,
      candidate: { id, name, description, source, fingerprint, preview: markdown.slice(0, 16000), warnings },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isWithin(parent: string, path: string) {
  const child = relative(resolve(parent), resolve(path));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function portableSkill(bundle: Bundle, catalog: string) {
  const { name, description } = bundle.candidate;
  const metadata = bundle.metadata;
  const manual = metadata['disable-model-invocation'] === true;
  const body = bundle.markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replaceAll(bundle.candidate.source, `${catalog}/${name}`)
    .replaceAll(bundle.root, `${catalog}/${name}`)
    .replace(/Call the Skill tool with/gi, 'Load and follow the skill named')
    .replace(/(?:\$|\/)?mattpocock-skills:([a-z-]+)/g, '$1');
  const originalSettings = Object.entries(metadata).filter(
    ([key]) => !['name', 'description', 'disable-model-invocation'].includes(key)
  );
  const settings =
    originalSettings.length > 0
      ? `Original execution metadata (apply where supported): ${JSON.stringify(Object.fromEntries(originalSettings))}.\n`
      : '';
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n${manual ? 'disable-model-invocation: true\n' : ''}---\n${PortableMarker}\nUse this workflow with the current agent's native tools. To invoke another skill, load its SKILL.md from ${catalog}/<name>/; use the native skill loader when available, otherwise read the file. Preserve explicit approval, editing and read-only rules. Required plugins, MCP tools and programs must exist; report missing dependencies instead of inventing tools. Resolve bundled relative references from this skill folder.\n${manual ? 'Run this skill only when the user explicitly requests it.\n' : ''}${settings}\n${body}`;
}
