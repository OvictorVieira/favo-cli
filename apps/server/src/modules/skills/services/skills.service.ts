import type { ProviderId } from '@favo/domain/providers/provider';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import {
  type CatalogSkill,
  type SkillCandidate,
  SkillDecision,
  SkillPhase,
  type SkillState,
  type SkillsView,
  skillConflicts,
} from '@favo/domain/skills/skill';
import type { SkillLibrary } from '@/modules/skills/gateways/skill-library';
import type { SkillStateRepository } from '@/modules/skills/repositories/skill-state.repository';

export class SkillsService {
  private phase: SkillsView['phase'] = SkillPhase.idle;
  private progress = '';
  private candidates: SkillCandidate[] = [];
  private problems: string[] = [];
  private work?: Promise<void>;
  constructor(
    private readonly state: SkillStateRepository,
    private readonly library: SkillLibrary
  ) {}

  async view(): Promise<SkillsView> {
    const state = await this.state.read();
    return {
      ...state,
      phase: this.phase,
      progress: this.progress,
      problems: this.problems,
      conflicts: skillConflicts(this.candidates, state.skills).filter((group) => group.candidates.length > 1),
    };
  }

  async skip() {
    assertDomain(!this.work, DomainErrorCode.invalidParams, 'Wait for skill processing to finish.');
    const state = await this.state.read();
    await this.state.save({ ...state, decision: SkillDecision.skipped });
    return this.view();
  }

  async start() {
    if (this.work) return this.view();
    const state = await this.state.read();
    await this.state.save({ ...state, decision: SkillDecision.enabled });
    this.phase = SkillPhase.scanning;
    this.progress = 'Scanning local agent skills';
    this.work = this.import()
      .catch((error: unknown) => {
        this.phase = SkillPhase.failed;
        this.problems.push(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        this.work = undefined;
      });
    return this.view();
  }

  async resolve(name: string, candidateId: string) {
    assertDomain(!this.work, DomainErrorCode.invalidParams, 'Wait for skill processing to finish.');
    if (this.candidates.length === 0) await this.scan();
    const state = await this.state.read();
    const group = skillConflicts(this.candidates, state.skills).find((group) => group.name === name);
    const selected = group?.candidates.find((candidate) => candidate.id === candidateId);
    assertDomain(
      selected && group,
      DomainErrorCode.invalidParams,
      'That skill version changed. Scan again before choosing.'
    );
    if (!selected.id.startsWith('catalog:')) await this.library.adopt(selected);
    const skill: CatalogSkill = {
      name,
      description: selected.description,
      source: selected.source,
      fingerprint: selected.fingerprint,
      warnings: selected.warnings,
      rejected: [
        ...new Set([
          ...(state.skills.find((skill) => skill.name === name)?.rejected ?? []),
          ...group.candidates
            .filter((candidate) => candidate.id !== selected.id)
            .map((candidate) => candidate.fingerprint),
        ]),
      ],
    };
    await this.state.save({
      ...state,
      decision: SkillDecision.enabled,
      skills: [...state.skills.filter((skill) => skill.name !== name), skill],
    });
    await this.finish();
    return this.view();
  }

  async ensureProvider(_provider: ProviderId) {
    if ((await this.state.read()).decision !== SkillDecision.enabled) return;
    if (this.work) await this.work;
    await this.scan();
    const state = await this.state.read();
    const conflicts = skillConflicts(this.candidates, state.skills).filter((group) => group.candidates.length > 1);
    assertDomain(
      conflicts.length === 0,
      DomainErrorCode.invalidParams,
      'Skills changed. Open favo skills and choose which versions to keep before launching.'
    );
    this.problems = await this.library.publish(state.skills);
    assertDomain(this.problems.length === 0, DomainErrorCode.invalidParams, this.problems.join('; '));
  }

  private async scan() {
    const scan = await this.library.discover((message) => {
      this.progress = message;
    });
    this.candidates = scan.candidates;
    this.problems = scan.problems;
  }

  private async import() {
    await this.scan();
    let state = await this.state.read();
    const groups = skillConflicts(this.candidates, state.skills);
    for (const group of groups) {
      if (group.candidates.length !== 1 || state.skills.some((skill) => skill.name === group.name)) continue;
      const candidate = group.candidates[0]!;
      this.phase = SkillPhase.importing;
      this.progress = `Adapting ${candidate.name}`;
      await this.library.adopt(candidate);
      state = {
        ...state,
        skills: [
          ...state.skills,
          {
            name: candidate.name,
            description: candidate.description,
            source: candidate.source,
            fingerprint: candidate.fingerprint,
            rejected: [],
            warnings: candidate.warnings,
          },
        ],
      };
      await this.state.save(state);
    }
    await this.finish();
  }

  private async finish() {
    const state: SkillState = await this.state.read();
    if (skillConflicts(this.candidates, state.skills).some((group) => group.candidates.length > 1)) {
      this.phase = SkillPhase.conflicts;
      this.progress = 'Same name, different content. Choose one version for each conflict.';
      return;
    }
    this.phase = SkillPhase.syncing;
    this.progress = 'Publishing the shared catalog to local providers';
    this.problems.push(...(await this.library.publish(state.skills)));
    this.phase = this.problems.length > 0 ? SkillPhase.failed : SkillPhase.done;
    this.progress = `${state.skills.length} skills in the Favo catalog`;
  }
}
