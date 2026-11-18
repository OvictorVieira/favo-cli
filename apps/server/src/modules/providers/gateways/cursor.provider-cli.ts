import { LoginState } from '@favo/contracts/rpc/views';
import { ProviderId } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { z } from 'zod';
import { ProviderCli, type ProviderSession } from '@/modules/providers/gateways/provider-cli';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const StatusTimeoutMs = 15_000;
const CursorStatus = z.object({
  isAuthenticated: z.boolean(),
  userInfo: z.object({ email: z.string().optional() }).optional(),
});

export class CursorProviderCli extends ProviderCli {
  readonly id = ProviderId.cursor;

  constructor(private readonly processes: ProcessRunner) {
    super();
  }

  async status(session: ProviderSession) {
    const result = await this.processes.run({
      command: session.binary,
      args: ['status', '--format', 'json'],
      env: session.env,
      timeoutMs: StatusTimeoutMs,
    });
    const status = CursorStatus.safeParse(parseJson(result.stdout));
    if (!status.success) return { login: LoginState.unknown };
    if (!status.data.isAuthenticated) return { login: LoginState.signedOut };
    const email = status.data.userInfo?.email;
    return email ? { login: LoginState.signedIn, identity: email } : { login: LoginState.signedIn };
  }

  loginArguments() {
    return ['login'];
  }

  logoutArguments() {
    return ['logout'];
  }
}
