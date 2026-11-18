import { describe, expect, test } from 'bun:test';
import { handoffPromptOf } from '#domain/threads/handoff-prompt';

describe('handoff prompts', () => {
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
