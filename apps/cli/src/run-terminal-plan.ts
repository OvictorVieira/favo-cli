import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mergeEnvironment } from '@favo/domain/shared/environment';
import { herdrSequenceOf } from '@favo/domain/terminal/herdr';
import {
  spawnCommandOf,
  type TerminalPlan,
  type TerminalRunOptions,
  type TerminalRunResult,
  type TerminalStep,
} from '@favo/domain/terminal/terminal-plan';
import { ProviderLimitDetector } from '@/provider-limit';
import { recordSessionEvent, SessionEvent } from '@/session-log';

const AfterExitTimeoutMs = 1_000;
const LimitStopGraceMs = 1_000;

export async function runTerminalPlan(
  plan: TerminalPlan,
  baseEnv: Record<string, string | undefined>,
  options: TerminalRunOptions = {}
): Promise<TerminalRunResult> {
  const isCaseInsensitive = process.platform === 'win32';
  const detector = options.monitorLimits ? new ProviderLimitDetector(options.monitorLimits) : undefined;
  let rateLimitDetected = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const hasManagedOutput = !!detector || options.onReady !== undefined;
  const isInteractive = hasManagedOutput && process.stdin.isTTY && process.stdout.isTTY;
  const captureOutput = hasManagedOutput && !isInteractive;
  const hasOwnProcessGroup = !!detector && process.platform !== 'win32';
  const logEnv = mergeEnvironment({ base: baseEnv, overrides: plan.env, unset: plan.unsetEnv, isCaseInsensitive });
  logEnv.FAVO_HOME ??= join(baseEnv.HOME ?? homedir(), '.favo');
  const record = (event: Parameters<typeof recordSessionEvent>[1]) =>
    recordSessionEvent(logEnv, { provider: options.monitorLimits, ...event });
  let outputBytes = 0;
  let ready: Promise<void> | undefined;
  let isOutputReady = false;
  let isInputAttached = false;
  let terminalOutput = Promise.resolve();
  const forwardInput = (data: Buffer) => child.terminal?.write(data);
  const resize = () => child.terminal?.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
  record({ event: SessionEvent.started, isInteractive, isMonitoringLimits: !!detector });
  const child = Bun.spawn(spawnCommandOf(plan.command, plan.args), {
    cwd: plan.cwd,
    env: logEnv,
    detached: hasOwnProcessGroup,
    ...(isInteractive
      ? {
          terminal: {
            cols: process.stdout.columns ?? 80,
            rows: process.stdout.rows ?? 24,
            data(_terminal, data) {
              const pending = new Uint8Array(data);
              terminalOutput = terminalOutput.then(() => forwardChunk(pending, (chunk) => process.stdout.write(chunk)));
              void terminalOutput.catch(() => child.kill('SIGTERM'));
            },
          },
        }
      : {
          stdin: 'inherit' as const,
          stdout: captureOutput ? ('pipe' as const) : ('inherit' as const),
          stderr: captureOutput ? ('pipe' as const) : ('inherit' as const),
        }),
  });
  if (isInteractive && child.terminal) {
    process.stdout.on('resize', resize);
    resize();
  }
  function stopForLimit() {
    signalLimitedProcess('SIGINT');
    stopTimer = setTimeout(() => {
      record({ event: SessionEvent.stopEscalated });
      signalLimitedProcess('SIGTERM');
      stopTimer = setTimeout(() => signalLimitedProcess('SIGKILL'), LimitStopGraceMs);
    }, LimitStopGraceMs);
  }
  function signalLimitedProcess(signal: NodeJS.Signals) {
    try {
      if (hasOwnProcessGroup) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      child.kill(signal);
    }
  }
  async function prepareOutput() {
    await options.onReady?.();
    if (isInteractive && child.terminal) {
      resize();
      process.stdin.setRawMode(true);
      process.stdin.on('data', forwardInput);
      process.stdin.resume();
      isInputAttached = true;
    }
    isOutputReady = true;
  }
  async function forwardChunk(data: Uint8Array, write: (data: Uint8Array) => void) {
    outputBytes += data.byteLength;
    if (!rateLimitDetected && detector?.write(data)) {
      rateLimitDetected = true;
      record({ event: SessionEvent.limitDetected });
      stopForLimit();
    }
    if (rateLimitDetected && !isOutputReady && options.onReady) return;
    ready ??= prepareOutput();
    await ready;
    write(data);
  }
  const forwardOutput = async (
    stream: ReadableStream<Uint8Array> | null | undefined,
    write: (data: Uint8Array) => void
  ) => {
    if (!stream) return;
    for await (const data of stream) await forwardChunk(data, write);
  };
  const outputDone = captureOutput
    ? Promise.all([
        forwardOutput(child.stdout, (data) => process.stdout.write(data)),
        forwardOutput(child.stderr, (data) => process.stderr.write(data)),
      ])
    : Promise.resolve();
  void outputDone.catch(() => child.kill('SIGTERM'));
  const ignoreSignal = () => {};
  process.on('SIGINT', ignoreSignal);
  if (plan.pidFile) await Bun.write(plan.pidFile, String(child.pid)).catch(() => {});
  let code = 1;
  try {
    code = await child.exited;
    await outputDone;
    await terminalOutput;
  } finally {
    clearTimeout(stopTimer);
    process.off('SIGINT', ignoreSignal);
    if (isInputAttached) {
      process.stdin.off('data', forwardInput);
      process.stdin.setRawMode(false);
    }
    process.stdout.off('resize', resize);
    child.terminal?.close();
    if (plan.pidFile) await rm(plan.pidFile, { force: true }).catch(() => {});
    if (plan.afterExit) await runAfterExit(plan.afterExit);
  }
  record({ event: SessionEvent.exited, exitCode: code, rateLimitDetected, outputBytes });
  return { exitCode: code, rateLimitDetected };
}

async function runAfterExit({ command, args, stampFlag }: TerminalStep) {
  try {
    const stamp = stampFlag ? [stampFlag, String(herdrSequenceOf(Date.now()))] : [];
    const step = Bun.spawn([command, ...args, ...stamp], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    const timer = setTimeout(() => step.kill(), AfterExitTimeoutMs);
    await step.exited;
    clearTimeout(timer);
  } catch {}
}
