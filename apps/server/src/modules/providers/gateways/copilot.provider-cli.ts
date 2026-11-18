import { LoginState } from '@favo/contracts/rpc/views';
import { ProviderId } from '@favo/domain/providers/provider';
import {
  type LoginContext,
  ProviderCli,
  type ProviderLogin,
  type ProviderSession,
} from '@/modules/providers/gateways/provider-cli';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const InitializeId = 1;
const SessionQuestionId = 2;
const StatusTimeoutMs = 15_000;
const AuthenticationRequired = /authentication required/i;
const AnyFolder = '/';

const InitializeQuestion = {
  jsonrpc: '2.0',
  id: InitializeId,
  method: 'initialize',
  params: { protocolVersion: 1, clientCapabilities: {} },
};

function sessionQuestionIn(cwd: string) {
  return { jsonrpc: '2.0', id: SessionQuestionId, method: 'session/new', params: { cwd, mcpServers: [] } };
}

type AcpMessage = { id?: number; result?: unknown; error?: { message?: string } };

export class CopilotProviderCli extends ProviderCli {
  readonly id = ProviderId.copilot;

  constructor(
    private readonly processes: ProcessRunner,
    private readonly timeoutMs = StatusTimeoutMs
  ) {
    super();
  }

  async status(session: ProviderSession): Promise<ProviderLogin> {
    const server = this.processes.open({
      command: session.binary,
      args: ['--acp'],
      env: session.env,
      cwd: session.cwd,
    });
    let hasAskedForSession = false;
    const answerOf = (message: AcpMessage) => {
      if (message.id !== InitializeId || hasAskedForSession) return loginOf(message);
      hasAskedForSession = true;
      server.write(JSON.stringify(sessionQuestionIn(session.cwd ?? AnyFolder)));
      return undefined;
    };
    const login = await this.ask<AcpMessage, LoginState>(server, [InitializeQuestion], answerOf, this.timeoutMs);
    return { login: login ?? LoginState.unknown };
  }

  loginArguments({ isOverSsh }: LoginContext) {
    return isOverSsh ? ['login', '--device-code'] : ['login'];
  }

  logoutArguments() {
    return undefined;
  }
}

function loginOf(message: AcpMessage) {
  if (message.id !== SessionQuestionId) return undefined;
  if (message.result !== undefined) return LoginState.signedIn;
  return AuthenticationRequired.test(message.error?.message ?? '') ? LoginState.signedOut : LoginState.unknown;
}
