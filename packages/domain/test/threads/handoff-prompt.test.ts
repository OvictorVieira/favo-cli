import { describe, expect, test } from 'bun:test';
import { handoffPromptOf } from '#domain/threads/handoff-prompt';

describe('handoff prompts', () => {
  test('recovers an OpenCode session by its ID and store when there is no transcript file', () => {
    const prompt = handoffPromptOf({
      sourceProvider: 'opencode',
      sessionId: 'ses_limited',
      sourceHome: '/home/bee/.local/share/opencode',
    });
    expect(prompt).toContain('ses_limited');
    expect(prompt).toContain('/home/bee/.local/share/opencode');
    expect(prompt).toContain('resume-agent-session');
    expect(prompt).toContain('read-only session storage');
    expect(prompt).toContain('original user goal');
    expect(prompt).toContain('current-state verification');
    expect(prompt).toContain('Do not dump the raw transcript');
  });

  test('points the next provider to the saved transcript and current workspace', () => {
    const prompt = handoffPromptOf({
      sourceProvider: 'claude',
      transcript: '/Users/bee/.claude/projects/hive/session.jsonl',
      directory: '/Users/bee/code/hive',
    });

    expect(prompt).toContain('/Users/bee/.claude/projects/hive/session.jsonl');
    expect(prompt).toContain('/Users/bee/code/hive');
    expect(prompt).toContain('latest user-requested task');
  });

  test('names no folder when none is known, instead of inventing one', () => {
    const prompt = handoffPromptOf({ sourceProvider: 'claude', transcript: '/t/session.jsonl' });

    expect(prompt).not.toContain('The working directory is');
    expect(prompt).not.toContain('undefined');
    expect(prompt).toContain('/t/session.jsonl');
  });

  test('does not tell the next provider to read a transcript that does not exist', () => {
    const prompt = handoffPromptOf({ sourceProvider: 'cursor', directory: '/Users/bee/code/hive' });

    expect(prompt).not.toMatch(/read the transcript/i);
    expect(prompt).toContain('git diff');
    expect(prompt).toContain('Continue unfinished work');
  });

  test('tells the next provider to read the transcript when there is one', () => {
    const prompt = handoffPromptOf({ sourceProvider: 'claude', transcript: '/t/session.jsonl' });

    expect(prompt).toMatch(/read the transcript/i);
  });

  test('warns the next provider when no transcript was saved', () => {
    const prompt = handoffPromptOf({ sourceProvider: 'codex', directory: '/Users/bee/code/hive' });

    expect(prompt).toContain('No session transcript was saved');
    expect(prompt).not.toContain('undefined');
  });
});
