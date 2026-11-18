import { ProviderId } from '@favo/domain/providers/provider';

const PermissionArguments: Record<ProviderId, string[]> = {
  [ProviderId.claude]: ['--dangerously-skip-permissions'],
  [ProviderId.codex]: ['--dangerously-bypass-approvals-and-sandbox'],
  [ProviderId.antigravity]: ['--dangerously-skip-permissions'],
  [ProviderId.opencode]: ['--auto'],
  [ProviderId.cursor]: ['--force', '--sandbox', 'disabled', '--approve-mcps', '--trust'],
  [ProviderId.copilot]: ['--allow-all'],
};

export function permissionArgumentsFor(provider: ProviderId): string[] {
  return [...PermissionArguments[provider]];
}
