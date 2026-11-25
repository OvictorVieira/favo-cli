import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FavoVersion } from '@favo/contracts/version';
import { findProvider, type ProviderId } from '@favo/domain/providers/provider';
import type { ValueOf } from '@favo/domain/shared/value-of';

export const SessionEvent = {
  started: 'provider_started',
  limitDetected: 'provider_limit_detected',
  exited: 'provider_exited',
  stopEscalated: 'provider_stop_escalated',
  threadRecorded: 'session_hook',
  hookFailed: 'session_hook_failed',
} as const;

export function recordSessionEvent(
  env: Record<string, string | undefined>,
  event: {
    event: ValueOf<typeof SessionEvent>;
    provider?: ProviderId;
    sessionId?: string;
    isRecorded?: boolean;
    isInteractive?: boolean;
    isMonitoringLimits?: boolean;
    exitCode?: number;
    rateLimitDetected?: boolean;
    outputBytes?: number;
  }
) {
  try {
    if (!env.FAVO_LAUNCH) return;
    const timestamp = new Date().toISOString();
    const folder = join(env.FAVO_HOME ?? join(env.HOME ?? homedir(), '.favo'), 'logs');
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    appendFileSync(
      join(folder, `sessions-${timestamp.slice(0, 10)}.jsonl`),
      `${JSON.stringify({
        timestamp,
        version: FavoVersion,
        launchId: env.FAVO_LAUNCH,
        account: env.FAVO_ACCOUNT,
        pid: process.pid,
        ...event,
        provider: event.provider ?? findProvider(env.FAVO_PROVIDER ?? '')?.id,
      })}\n`,
      { mode: 0o600 }
    );
  } catch {}
}
