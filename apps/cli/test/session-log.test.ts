import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { recordSessionEvent, SessionEvent } from '@/session-log';
import { removeFolder } from './support/remove-folder';

let root: string;
beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/favo-session-log-`);
});
afterEach(() => removeFolder(root));

test('appends hook and provider events with the same launch and session IDs in a private log', () => {
  const env = { FAVO_HOME: root, FAVO_LAUNCH: 'launch-id', FAVO_ACCOUNT: 'work', FAVO_PROVIDER: 'claude' };
  recordSessionEvent(env, { event: SessionEvent.started });
  recordSessionEvent(env, { event: SessionEvent.threadRecorded, sessionId: 'session-id', isRecorded: true });
  const path = `${root}/logs/${readdirSync(`${root}/logs`)[0]}`;
  const events = readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({
    launchId: 'launch-id',
    sessionId: 'session-id',
    provider: 'claude',
    isRecorded: true,
  });
  if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
});

test('a failed diagnostic write never breaks a provider session', () => {
  writeFileSync(`${root}/logs`, 'a file where a folder should be');
  expect(() =>
    recordSessionEvent({ FAVO_HOME: root, FAVO_LAUNCH: 'launch-id' }, { event: SessionEvent.started })
  ).not.toThrow();
});
