import { SkillsView } from '@favo/domain/skills/skill';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const skipSkills = defineMethod({
  name: 'skills.skipSkills',
  routing: MethodRouting.hub,
  params: z.strictObject({}),
  result: SkillsView,
});
