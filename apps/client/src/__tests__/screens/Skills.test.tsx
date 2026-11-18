import { afterEach, describe, expect, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { renderApp } from '@/__tests__/utils/renderApp';

let dispose: (() => Promise<void>) | undefined;

async function open() {
  const view = await renderApp();
  dispose = view.dispose;
  return view;
}

function candidate(id: string, preview: string) {
  return { id, name: 'review-pr', description: 'x', source: `/skills/${id}`, fingerprint: id, preview, warnings: [] };
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe('the skills screen', () => {
  test('asks before sharing anything, and explains what will happen', async () => {
    const view = await open();
    mockDb.skills.decision = 'pending';
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Share your agent skills with every agent?'));
    expect(view.captureCharFrame()).toContain('A replaced copy is backed up first');
    expect(mockDb.skills.imports).toBe(0);
  });
  test('shares after enter and lists the catalog with its warnings', async () => {
    const view = await open();
    mockDb.skills.decision = 'pending';
    mockDb.skills.importable = [
      {
        ...mockDb.skills.importable[0]!,
        warnings: ['External plugins/MCP tools must be available in the target agent.'],
      },
    ];
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Share your agent skills'));
    await view.press('RETURN');
    await view.waitForFrame((frame) => frame.includes('⬢ debug-root-cause'));
    expect(view.captureCharFrame()).toContain('External plugins/MCP tools');
    expect(mockDb.skills.imports).toBe(1);
  });
  test('stops on a conflict until a version is chosen', async () => {
    const view = await open();
    mockDb.skills.decision = 'pending';
    mockDb.skills.conflicts = [
      { name: 'review-pr', candidates: [candidate('read-only', 'only reads'), candidate('edits', 'edits files')] },
    ];
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Share your agent skills'));
    await view.press('RETURN');
    await view.waitForFrame((frame) => frame.includes('Pick the version to keep'));
    const frame = view.captureCharFrame();
    expect(frame).toContain('/skills/read-only');
    expect(frame).toContain('edits files');
    await view.press('j', 'RETURN');
    await view.waitForFrame(
      (next) => next.includes('1 skills in the Favo catalog') || next.includes('⬢ debug-root-cause')
    );
    expect(mockDb.skills.chosen).toEqual([{ name: 'review-pr', candidateId: 'edits' }]);
  });
  test('remembers a refusal with s', async () => {
    const view = await open();
    mockDb.skills.decision = 'pending';
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Share your agent skills'));
    await view.press('s');
    await view.waitFor(() => !view.app.state.isSkillsOpen);
    expect(mockDb.skills.decision as string).toBe('skipped');
    expect(mockDb.skills.imports).toBe(0);
  });
  test('leaves the comb alone on later when nothing was decided', async () => {
    const view = await open();
    mockDb.skills.decision = 'pending';
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Share your agent skills'));
    await view.pressEscape();
    expect(view.app.state.isSkillsOpen).toBe(false);
    expect(mockDb.skills.decision as string).toBe('pending');
  });
  test('opens from the comb with e', async () => {
    const view = await open();
    mockDb.skills.decision = 'skipped';
    await view.press('e');
    await view.waitFor(() => view.app.state.isSkillsOpen);
    await view.waitForFrame((frame) => frame.includes('Share your agent skills'));
  });
  test('shows a conflict found later, even when the last scan said done', async () => {
    const view = await open();
    mockDb.skills.decision = 'enabled' as typeof mockDb.skills.decision;
    mockDb.skills.phase = 'done' as typeof mockDb.skills.phase;
    mockDb.skills.conflicts = [
      { name: 'review-pr', candidates: [candidate('read-only', 'only reads'), candidate('edits', 'edits files')] },
    ];
    await view.app.state.offerSkills();
    await view.waitForFrame((frame) => frame.includes('Pick the version to keep'));
  });
  test('scans again with r once sharing is on', async () => {
    const view = await open();
    mockDb.skills.decision = 'enabled' as typeof mockDb.skills.decision;
    await view.press('e');
    await view.waitForFrame((frame) => frame.includes('scan again'));
    await view.press('r');
    await view.waitFor(() => mockDb.skills.imports === 1);
  });
});
