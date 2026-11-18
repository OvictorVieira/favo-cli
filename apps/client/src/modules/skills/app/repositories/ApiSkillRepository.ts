import type { RpcClient } from '@favo/contracts/rpc/client';
import { autoResolveSkills } from '@favo/contracts/rpc/skills/auto-resolve-skills';
import { getSkills } from '@favo/contracts/rpc/skills/get-skills';
import { importSkills } from '@favo/contracts/rpc/skills/import-skills';
import { resolveSkill } from '@favo/contracts/rpc/skills/resolve-skill';
import { skipSkills } from '@favo/contracts/rpc/skills/skip-skills';
import type { ISkillRepository } from '@/modules/skills/app/repositories/ISkillRepository';

export class ApiSkillRepository implements ISkillRepository {
  constructor(private readonly client: RpcClient) {}

  getSkills() {
    return this.client.call(getSkills, {});
  }

  importSkills() {
    return this.client.call(importSkills, {});
  }

  skipSkills() {
    return this.client.call(skipSkills, {});
  }

  autoResolveSkills() {
    return this.client.call(autoResolveSkills, {});
  }

  resolveSkill(name: string, candidateId: string) {
    return this.client.call(resolveSkill, { name, candidateId });
  }
}
