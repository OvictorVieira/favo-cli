import { afterEach, expect, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { renderApp } from '@/__tests__/utils/renderApp';

let dispose: (() => Promise<void>) | undefined;

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

for (const isClick of [false, true]) {
  test(`reopens saved chat through ${isClick ? 'click' : 'keyboard'} at 80 columns`, async () => {
    const view = await renderApp({ width: 80, height: 30 });
    dispose = view.dispose;
    await view.press('w');
    view.app.state.changeChatInput('saved release plan');
    await view.app.state.sendChatInput();
    const id = view.app.state.chat!.id;
    await view.pressEscape();
    if (isClick) await view.clickOn('history');
    else await view.press('W');
    await view.waitForFrame((frame) => frame.includes('saved release plan'));
    if (isClick) await view.clickOn('echo: saved release plan');
    else await view.press('RETURN');
    await view.waitForFrame((frame) => frame.includes('chat with'));
    expect(view.app.state.chat?.id).toBe(id);
    expect(Object.keys(mockDb.chats)).toHaveLength(1);
  });
}
