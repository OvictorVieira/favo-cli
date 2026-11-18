import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ProviderId } from '@favo/domain/providers/provider';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { type CatalogSkill, type SkillCandidate, SkillName } from '@favo/domain/skills/skill';
import { SkillLibrary } from './skill-library';

const NativeSkillRoots: Record<ProviderId, string[]> = {
  claude: ['.claude/skills'],
  codex: ['.agents/skills', '.codex/skills'],
  cursor: ['.cursor/skills'],
  copilot: ['.copilot/skills'],
  opencode: ['.config/opencode/skills'],
  antigravity: ['.gemini/config/skills', '.gemini/antigravity-cli/skills', '.gemini/skills'],
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
    const roots = Object.values(NativeSkillRoots)
      .flat()
      .map((path) => `${this.home}/${path}`);
    roots.push(`${this.configHome}/opencode/skills`);
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
    await mkdir(temporary, { recursive: true, mode: 0o700 });
    for (const file of bundle.files) {
      const destination = `${temporary}/${file.path}`;
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const bytes = file.path === 'SKILL.md' ? Buffer.from(portableSkill(bundle, this.catalog)) : file.bytes;
      await writeFile(destination, bytes, { mode: file.mode });
      await chmod(destination, file.mode);
    }
    await mkdir(this.catalog, { recursive: true, mode: 0o700 });
    const destination = `${this.catalog}/${candidate.name}`;
    await this.backup(destination);
    await rename(temporary, destination);
  }

  async publish(skills: CatalogSkill[]) {
    const problems: string[] = [];
    const roots = [
      ...new Set([
        ...Object.values(NativeSkillRoots)
          .flat()
          .map((path) => `${this.home}/${path}`),
        `${this.configHome}/opencode/skills`,
      ]),
    ];
    for (const root of roots) {
      for (const skill of skills) {
        try {
          const source = `${this.catalog}/${skill.name}`;
          assertDomain(
            await stat(`${source}/SKILL.md`).catch(() => undefined),
            DomainErrorCode.invalidConfig,
            `Catalog skill missing: ${skill.name}`
          );
          const destination = `${root}/${skill.name}`;
          if ((await realpath(destination).catch(() => undefined)) === (await realpath(source))) continue;
          const existing = await lstat(destination).catch(() => undefined);
          if (existing) {
            const current = await this.bundle(destination);
            assertDomain(
              current.candidate.name === skill.name &&
                [skill.fingerprint, ...skill.rejected].includes(current.candidate.fingerprint),
              DomainErrorCode.invalidParams,
              `Unreviewed skill at ${destination}. Import again before replacing it.`
            );
            await this.backup(destination);
          }
          for (const bundle of this.bundles.values()) {
            if (
              bundle.candidate.name !== skill.name ||
              !isWithin(root, bundle.candidate.source) ||
              bundle.candidate.source === destination
            )
              continue;
            if (!(await lstat(bundle.candidate.source).catch(() => undefined))) continue;
            assertDomain(
              [skill.fingerprint, ...skill.rejected].includes(bundle.candidate.fingerprint),
              DomainErrorCode.invalidParams,
              `Choose which ${skill.name} to keep before syncing.`
            );
            await this.backup(bundle.candidate.source);
          }
          await mkdir(root, { recursive: true });
          await symlink(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
        } catch (error) {
          problems.push(`${skill.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return problems;
  }

  private async backup(path: string) {
    if (!(await lstat(path).catch(() => undefined))) return;
    await mkdir(this.backups, { recursive: true, mode: 0o700 });
    await rename(path, `${this.backups}/${randomUUID()}-${basename(path)}`);
  }

  private async bundle(source: string): Promise<Bundle> {
    const root = await realpath(source);
    const files: BundleFile[] = [];
    let size = 0;
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
        if (OmittedFolders.has(name) || name.startsWith('.env') || /^(auth|credentials)\.json$/.test(name)) continue;
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
    for (const file of files) hash.update(file.path).update(file.bytes);
    const fingerprint = hash.digest('hex');
    const id = createHash('sha256').update(source).update(fingerprint).digest('hex').slice(0, 24);
    const warnings: string[] = [];
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
