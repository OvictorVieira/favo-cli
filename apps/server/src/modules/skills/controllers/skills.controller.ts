import { getSkills } from '@favo/contracts/rpc/skills/get-skills';
import { importSkills } from '@favo/contracts/rpc/skills/import-skills';
import { resolveSkill } from '@favo/contracts/rpc/skills/resolve-skill';
import { skipSkills } from '@favo/contracts/rpc/skills/skip-skills';
import type { SkillsService } from '@/modules/skills/services/skills.service';
import type { RpcRouter } from '@/shared/rpc/rpc-router';

export function registerSkillsController(router: RpcRouter, skills: SkillsService) {
  router.handle(getSkills, () => skills.view());
  router.handle(importSkills, () => skills.start());
  router.handle(skipSkills, () => skills.skip());
  router.handle(resolveSkill, ({ name, candidateId }) => skills.resolve(name, candidateId));
}
