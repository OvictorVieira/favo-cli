import type { TerminalPlan, TerminalRunOptions, TerminalRunResult } from '@favo/domain/terminal/terminal-plan';

export type TerminalGatewayOptions = TerminalRunOptions & {
  beforeResume?(result: TerminalRunResult): void;
};

export type ITerminalGateway = {
  run(plan: TerminalPlan, options?: TerminalGatewayOptions): Promise<TerminalRunResult>;
};
