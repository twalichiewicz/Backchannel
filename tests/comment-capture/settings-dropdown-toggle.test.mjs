import test from 'node:test';
import assert from 'node:assert/strict';
import { launchApp, STORIES } from './harness.mjs';

async function clickCenter(page, locator) {
  const bounds = await locator.boundingBox();
  assert(bounds, 'the dropdown trigger has visible bounds');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

for (const reader of [true, false]) {
  test(`${reader ? 'Reader' : 'Sidebar'} Sync schedule closes when its open trigger is clicked`, { timeout: 15000 }, async () => {
    const app = await launchApp({
      ...(reader ? {} : { appHost: new URL(STORIES[0].url).hostname }),
      sharedStore: true,
      settings: {
        sources: { hn: true },
        frontPageMode: 'sources',
        autoOpenSidebar: !reader,
        sourceRefreshMinutes: 15,
        updateCheck: false,
      },
    });
    try {
      await app.page.goto(reader ? 'https://backchnnl.app/' : STORIES[0].url);
      await app.page.locator('#settings-toggle').click();
      await app.page.locator('[data-settings-section="sources"]').click();
      const toggle = app.page.locator('#setting-source-refresh');
      const list = app.page.locator('#setting-source-refresh-options');
      assert.equal(await list.isVisible(), false, 'the menu starts closed');
      assert.deepEqual(app.errors, [], 'the running app has no console exceptions');

      await clickCenter(app.page, toggle);
      assert.equal(await list.isVisible(), true, 'the first physical click opens the menu');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');

      await clickCenter(app.page, toggle);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'the second physical click toggles the menu closed');
      await list.waitFor({ state: 'hidden', timeout: 2000 });
      assert.equal(await list.isVisible(), false, 'the second physical click closes the menu');
      assert.deepEqual(app.errors, []);
    } finally {
      await app.browser.close();
    }
  });
}
