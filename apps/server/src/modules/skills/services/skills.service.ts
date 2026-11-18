import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import {
  isCatalogCandidate,
  type SkillCandidate,
  SkillDecision,
  SkillPhase,
  type SkillsView,
  skillConflicts,
  toCatalogSkill,
  unresolvedConflicts,
} from '@favo/domain/skills/skill';
import type { SkillLibrary } from '@/modules/skills/gateways/skill-library';
import type { SkillStateRepository } from '@/modules/skills/repositories/skill-state.repository';

const ConflictsNotice = 'Same name, different content. Choose one version for each conflict.';

export class SkillsService {
  private phase: SkillsView['phase'] = SkillPhase.idle;
  private progress = '';
  private candidates: SkillCandidate[] = [];
  private hasScanned = false;
  private scanProblems: string[] = [];
  private publishProblems: string[] = [];
  private work?: Promise<void>;
  constructor(
    private readonly state: SkillStateRepository,
    private readonly library: SkillLibrary
  ) {}

  async view(): Promise<SkillsView> {
    const state = await this.state.read();
    if (state.decision === SkillDecision.enabled && !this.hasScanned && !this.work) await this.scan();
    return {
      ...state,
      phase: this.phase,
      progress: this.progress,
      problems: [...this.scanProblems, ...this.publishProblems],
      conflicts: unresolvedConflicts(this.candidates, state.skills),
    };
  }

  async skip() {
    this.assertIdle();
    await this.state.save({ ...(await this.state.read()), decision: SkillDecision.skipped });
    return this.view();
  }

  async start() {
    if (this.work) return this.view();
    this.phase = SkillPhase.scanning;
    this.progress = 'Scanning local agent skills';
    this.work = this.run().finally(() => {
      this.work = undefined;
    });
    return this.view();
  }

  async resolve(name: string, candidateId: string) {
    this.assertIdle();
    const running = this.choose(name, candidateId);
    this.work = running.then(
      () => undefined,
      () => undefined
    );
    const guard = this.work;
    try {
      return await running;
    } finally {
      if (this.work === guard) this.work = undefined;
    }
  }

  private async choose(name: string, candidateId: string) {
    const state = await this.state.read();
    assertDomain(
      state.decision !== SkillDecision.pending,
      DomainErrorCode.invalidParams,
      'Agree to share your skills first: favo skills import'
    );
    assertDomain(
      state.decision !== SkillDecision.skipped,
      DomainErrorCode.invalidParams,
      'Skill sharing is off. Run favo skills import to turn it on.'
    );
    if (this.candidates.length === 0) await this.scan();
    const group = skillConflicts(this.candidates, state.skills).find((group) => group.name === name);
    const selected = group?.candidates.find((candidate) => candidate.id === candidateId);
    assertDomain(
      selected && group,
      DomainErrorCode.invalidParams,
      'That skill version changed. Scan again before choosing.'
    );
    if (!isCatalogCandidate(selected)) await this.library.adopt(selected);
    const earlier = state.skills.find((skill) => skill.name === name)?.rejected ?? [];
    const others = group.candidates.filter((candidate) => candidate.id !== selected.id);
    const rejected = [...new Set([...earlier, ...others.map((candidate) => candidate.fingerprint)])];
    await this.state.save({
      ...state,
      skills: [...state.skills.filter((skill) => skill.name !== name), toCatalogSkill(selected, rejected)],
    });
    await this.finish();
    return this.view();
  }

  async ensureProvider() {
    if (this.work || (await this.state.read()).decision !== SkillDecision.enabled) return;
    try {
      await this.scan();
      const state = await this.state.read();
      if (unresolvedConflicts(this.candidates, state.skills).length > 0) {
        this.phase = SkillPhase.conflicts;
        this.progress = ConflictsNotice;
        return;
      }
      this.publishProblems = await this.library.publish(state.skills);
      this.phase = this.publishProblems.length > 0 ? SkillPhase.failed : SkillPhase.done;
    } catch (error) {
      this.publishProblems = [error instanceof Error ? error.message : String(error)];
      this.phase = SkillPhase.failed;
    }
  }

  private assertIdle() {
    assertDomain(!this.work, DomainErrorCode.invalidParams, 'Wait for skill processing to finish.');
  }

  private async scan() {
    const scan = await this.library.discover((message) => {
      this.progress = message;
    });
    this.candidates = scan.candidates;
    this.hasScanned = true;
    this.scanProblems = scan.problems;
  }

  private async run() {
    try {
      await this.state.save({ ...(await this.state.read()), decision: SkillDecision.enabled });
      await this.scan();
      await this.adoptUnambiguous();
      await this.finish();
    } catch (error) {
      this.phase = SkillPhase.failed;
      this.publishProblems = [error instanceof Error ? error.message : String(error)];
    }
  }

  private async adoptUnambiguous() {
    let state = await this.state.read();
    for (const group of skillConflicts(this.candidates, state.skills)) {
      const [candidate] = group.candidates;
      if (group.candidates.length !== 1 || !candidate || state.skills.some((skill) => skill.name === group.name)) {
        continue;
      }
      this.phase = SkillPhase.importing;
      this.progress = `Adapting ${candidate.name}`;
      await this.library.adopt(candidate);
      state = { ...state, skills: [...state.skills, toCatalogSkill(candidate, [])] };
      await this.state.save(state);
    }
  }

  private async finish() {
    const state = await this.state.read();
    if (unresolvedConflicts(this.candidates, state.skills).length > 0) {
      this.phase = SkillPhase.conflicts;
      this.progress = ConflictsNotice;
      return;
    }
    this.phase = SkillPhase.syncing;
    this.progress = 'Publishing the shared catalog to local providers';
    this.publishProblems = await this.library.publish(state.skills);
    this.phase = this.publishProblems.length > 0 ? SkillPhase.failed : SkillPhase.done;
    this.progress = `${state.skills.length} skills in the Favo catalog`;
  }
}
