import { isSkillWorkRunning, SkillDecision, SkillPhase, type SkillsView } from '@favo/domain/skills/skill';
import { skillChoices } from '@/modules/skills/parsers/skillChoices';
import { ToastKind } from '@/shared/app/services/ToastService';
import { container } from '@/shared/container';
import type { ServiceCreator } from '@/shared/stores/app';

const PollMilliseconds = 100;

export type SkillService = {
  skillsView: SkillsView;
  isSkillsOpen: boolean;
  skillChoiceIndex: number;
  offerSkills(): Promise<void>;
  openSkills(): Promise<void>;
  closeSkills(): void;
  startSkillImport(): Promise<void>;
  skipSkillSharing(): Promise<void>;
  moveSkillChoice(delta: number): void;
  chooseSkillVersion(): Promise<void>;
};

const NoSkills: SkillsView = {
  decision: SkillDecision.pending,
  phase: SkillPhase.idle,
  progress: '',
  skills: [],
  conflicts: [],
  problems: [],
};

export const createSkillService: ServiceCreator<SkillService> = (set, get) => ({
  skillsView: NoSkills,
  isSkillsOpen: false,
  skillChoiceIndex: 0,
  async offerSkills() {
    const skillsView = await container.get('ISkillRepository').getSkills();
    const needsAnswer = skillsView.decision === SkillDecision.pending || skillsView.conflicts.length > 0;
    set({ skillsView, isSkillsOpen: get().isSkillsOpen || needsAnswer, skillChoiceIndex: 0 });
  },
  async openSkills() {
    const skillsView = await container.get('ISkillRepository').getSkills();
    set({ skillsView, isSkillsOpen: true, skillChoiceIndex: 0 });
  },
  closeSkills() {
    set({ isSkillsOpen: false });
  },
  async startSkillImport() {
    const skills = container.get('ISkillRepository');
    try {
      let skillsView = await skills.importSkills();
      set({ skillsView, skillChoiceIndex: 0 });
      while (isSkillWorkRunning(skillsView.phase)) {
        await new Promise((resolve) => setTimeout(resolve, PollMilliseconds));
        skillsView = await skills.getSkills();
        set({ skillsView });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ skillsView: { ...get().skillsView, phase: SkillPhase.failed, problems: [message] } });
      throw error;
    }
  },
  async skipSkillSharing() {
    const skillsView = await container.get('ISkillRepository').skipSkills();
    set({ skillsView, isSkillsOpen: false });
  },
  moveSkillChoice(delta) {
    const { skillsView, skillChoiceIndex } = get();
    const count = skillChoices(skillsView).length;
    if (count === 0) return;
    set({ skillChoiceIndex: Math.min(count - 1, Math.max(0, skillChoiceIndex + delta)) });
  },
  async chooseSkillVersion() {
    const { skillsView, skillChoiceIndex, showToast } = get();
    const choice = skillChoices(skillsView)[skillChoiceIndex];
    if (!choice) return;
    const next = await container.get('ISkillRepository').resolveSkill(choice.name, choice.candidate.id);
    set({ skillsView: next, skillChoiceIndex: 0 });
    if (next.phase === SkillPhase.failed) showToast(next.problems[0] ?? 'Skills could not be linked.', ToastKind.error);
  },
});
