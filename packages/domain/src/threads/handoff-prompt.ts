import { type ProviderId, Providers } from '#domain/providers/provider';

export function handoffPromptOf(input: {
  sourceProvider: ProviderId;
  sessionId?: string;
  sourceHome?: string;
  transcript?: string;
  directory?: string;
}) {
  const transcriptInstruction = input.transcript
    ? `Read the previous conversation from the local transcript at "${input.transcript}".`
    : 'No session transcript was saved as a standalone file. Recover it from the source session store if available; otherwise use the current workspace and its git state as context.';

  return [
    `Continue work after ${Providers[input.sourceProvider].label} reached its usage limit.`,
    ...(input.directory ? [`The working directory is "${input.directory}".`] : []),
    ...(input.sessionId ? [`The previous session ID is "${input.sessionId}".`] : []),
    ...(input.sourceHome ? [`The source provider's local session store is under "${input.sourceHome}".`] : []),
    transcriptInstruction,
    'Use the resume-agent-session skill if available. Otherwise follow this recovery workflow:',
    'Locate the source session by its ID in the source provider local session store. When no transcript file is supplied, recover the conversation through the provider supported local export or read-only session storage. Never read credentials. If the session ID is unknown, match the working directory and latest session, and state any uncertainty.',
    'Read selectively: original user goal, later decisions and corrections, completed actions, pending work, errors and blockers, and final messages. Do not dump the raw transcript.',
    'Build a compact handoff: goal, completed work and evidence, decisions and constraints, exact in-progress step, next actions, relevant paths and branch, validation already run, and unanswered questions. Separate transcript claims from current-state verification. Omit sensitive data.',
    'Preserve existing and untracked user changes. Do not overwrite them or assume ownership. Continue the latest user-requested task without repeating completed work. Ask only if a missing decision blocks the next action.',
    input.transcript
      ? 'Read the transcript as context for the latest user-requested task, then inspect the current workspace and git diff before acting. Continue unfinished work without repeating completed work. Ask only if critical information is missing.'
      : 'Inspect the current workspace and git diff before acting. Continue unfinished work without repeating completed work. Ask only if critical information is missing.',
  ].join('\n\n');
}
