import type { TerminalPlan, TerminalRunOptions, TerminalRunResult } from '@favo/domain/terminal/terminal-plan';
import type { ITerminalGateway, TerminalGatewayOptions } from '@/shared/app/gateways/ITerminalGateway';

type SuspendableRenderer = { suspend(): Promise<void>; resume(): Promise<void> };

export class RendererTerminalGateway implements ITerminalGateway {
  constructor(
    private readonly renderer: SuspendableRenderer,
    private readonly runPlan: (plan: TerminalPlan, options?: TerminalRunOptions) => Promise<TerminalRunResult>,
    private readonly updateScreen: (update: () => void) => void = (update) => update()
  ) {}

  async run(plan: TerminalPlan, options: TerminalGatewayOptions = {}) {
    let isSuspended = false;
    let ready: Promise<void> | undefined;
    const { beforeResume, ...runOptions } = options;
    const suspend = async () => {
      await this.renderer.suspend();
      isSuspended = true;
      await runOptions.onReady?.();
    };
    try {
      const result = await this.runPlan(plan, { ...runOptions, onReady: () => (ready ??= suspend()) });
      this.updateScreen(() => beforeResume?.(result));
      return result;
    } finally {
      if (isSuspended) await this.renderer.resume();
    }
  }
}
