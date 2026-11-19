import { SkillDecision, SkillPhase, type SkillsView } from '@favo/domain/skills/skill';
import { mockDb } from '@/__tests__/db';
import type { ISkillRepository } from '@/modules/skills/app/repositories/ISkillRepository';

function view(): SkillsView {
  const { decision, phase, skills, conflicts } = mockDb.skills;
  return {
    decision,
    phase,
    progress: '',
    skills,
    conflicts: decision === SkillDecision.enabled ? conflicts : [],
    problems: mockDb.skills.problems,
  };
}

function nextPhase() {
  return mockDb.skills.conflicts.length > 0 ? SkillPhase.conflicts : SkillPhase.done;
}

export class TestSkillRepository implements ISkillRepository {
  async getSkills() {
    return view();
  }

  async importSkills() {
    mockDb.skills.imports++;
    mockDb.skills.decision = SkillDecision.enabled;
    mockDb.skills.phase = nextPhase();
    if (mockDb.skills.conflicts.length === 0) mockDb.skills.skills = mockDb.skills.importable;
    return view();
  }

  async skipSkills() {
    mockDb.skills.decision = SkillDecision.skipped;
    return view();
  }

  async autoResolveSkills() {
    const picks = mockDb.skills.autoPicks;
    const settled = mockDb.skills.conflicts.filter((conflict) => picks[conflict.name] !== undefined);
    for (const conflict of settled)
      mockDb.skills.chosen.push({ name: conflict.name, candidateId: picks[conflict.name]! });
    mockDb.skills.conflicts = mockDb.skills.conflicts.filter((conflict) => picks[conflict.name] === undefined);
    mockDb.skills.phase = nextPhase();
    return {
      ...view(),
      progress: `${settled.length} resolved automatically, ${mockDb.skills.conflicts.length} need you.`,
    };
  }

  async resolveSkill(name: string, candidateId: string) {
    mockDb.skills.chosen.push({ name, candidateId });
    mockDb.skills.conflicts = mockDb.skills.conflicts.filter((conflict) => conflict.name !== name);
    mockDb.skills.skills = mockDb.skills.importable;
    mockDb.skills.phase = nextPhase();
    return view();
  }
}
