import { SkillName, SkillsView } from '@favo/domain/skills/skill';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const resolveSkill = defineMethod({
  name: 'skills.resolveSkill',
  routing: MethodRouting.hub,
  params: z.strictObject({ name: SkillName, candidateId: z.string() }),
  result: SkillsView,
});
