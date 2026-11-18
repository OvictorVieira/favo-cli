import { SkillsView } from '@favo/domain/skills/skill';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const getSkills = defineMethod({
  name: 'skills.getSkills',
  routing: MethodRouting.hub,
  params: z.strictObject({}),
  result: SkillsView,
});
