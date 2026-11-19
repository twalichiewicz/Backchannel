import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {launchApp, STORIES, waitFor} from './harness.mjs';

const siteHTML = await readFile(new URL('../../site/index.html', import.meta.url), 'utf8');
// Standalone mark from https://triglavis.com/, retrieved 17 November 2026.
const officialMarkHash = 'c9ad042f8190f28cf9a9eea847c6ae4a936e23a3f8fcda34a75359a4dde73075';
const actionSelectors = [
  '#app-toggle-discussion',
  '#app-article-actions [data-item-action="save"]',
  '#app-view-toggle',
];

function watchConsole(app) {
  app.consoleErrors = [];
  app.page.on('console', message => {
    if (message.type() === 'error') app.consoleErrors.push(message.text());
  });
  return app;
}

function clean(app) {
  assert.deepEqual(app.errors, []);
  assert.deepEqual(app.consoleErrors, []);
}

for(const fromSearch of [false,true])test(`Privacy ${fromSearch?'search result':'deep link'} opens the General subsection without expanding the chin`,{timeout:15000},async()=>{
  const app=watchConsole(await launchApp({sharedStore:true,viewport:{width:1100,height:950},settings:{sources:{hn:true},frontPageMode:'sources',updateCheck:false},values:{'HNewhere:app_panes':{list:false,discussion:true}}}));
  try{
    await app.page.goto(`https://backchnnl.app/${fromSearch?'':'#privacy'}`);
    if(fromSearch){
      await app.page.locator('#app-rail-search').click();
      await app.page.locator('#app-search-input').fill('privacy');
      await app.page.locator('#app-search-results .app-search-item').filter({hasText:'Privacy'}).first().click();
    }
    const modal=app.page.locator('#app-settings-modal');await modal.waitFor();
    assert.equal(await modal.getAttribute('data-section'),'general');
    const pos=await app.page.locator('#settings-privacy').evaluate(node=>{const n=node.getBoundingClientRect(),c=node.closest('#app-settings-content').getBoundingClientRect();return{top:n.top,clipTop:c.top,clipBottom:c.bottom}});
    assert(pos.top>=pos.clipTop&&pos.top<pos.clipBottom,'Privacy is scrolled into view');
    assert.equal(await app.page.locator('.chin').evaluate(node=>node.getBoundingClientRect().height),30,'the old site privacy drawer does not resize Reader');
    assert.equal(await app.page.locator('#app-chin').evaluate(node=>Boolean(node.closest('[inert]'))),true);
    assert.equal(app.store.get('HNewhere:app_panes').list,false);
    await app.page.locator('#app-settings-close').click();
    assert.equal(await modal.isVisible(),false);
    clean(app);
  }finally{await app.browser.close()}
});

async function reader(width = 1600) {
  const app = watchConsole(await launchApp({
    sharedStore: true,
    viewport: {width, height: 950},
    votable: {[STORIES[0].id]: 'updown', [STORIES[7].id]: 'updown'},
    settings: {sources: {hn: true}, frontPageMode: 'sources', updateCheck: false},
  }));
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link').first().click();
    await app.page.locator('#app-article-body iframe').waitFor({state: 'attached', timeout: 3000});
    await app.page.locator('#comments-content .comment[data-comment-id]').first().waitFor({state: 'attached', timeout: 3000});
    assert(await waitFor(async () => app.page.locator('#panel').evaluate(panel => getComputedStyle(panel).transform === 'none'), 2500));
    return app;
  } catch (error) {
    await app.browser.close();
    throw error;
  }
}

for (const width of [701, 1100, 1600]) {
  test(`${width}px desktop Reader fits authentic branding and real actions inside the 30px chin`, {timeout: 15000}, async () => {
    const app = await reader(width);
    try {
      assert.equal(await app.page.locator('#app-chin').count(), 1, 'the shadow root owns one chin');
      await app.page.locator('#app-chin [data-item-action="save"]').waitFor({timeout: 3000});
      const layout = await app.page.locator('#app-chin').evaluate((chin, selectors) => {
        const root = chin.getRootNode();
        const box = node => {
          const r = node.getBoundingClientRect();
          return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom};
        };
        const brand = chin.querySelector('a[href="https://triglavis.com/"]');
        const mark = brand?.querySelector('svg path');
        return {
          chin: box(chin), screen: box(document.querySelector('.screen')), rail: box(root.querySelector('#app-rail')),
          brand: brand && box(brand), brandText: brand?.innerText, mark: mark?.getAttribute('d'),
          controls: selectors.map(selector => {
            const nodes = root.querySelectorAll(selector), node = nodes[0], rect = box(node);
            const hit = root.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {selector, count: nodes.length, inChin: chin.contains(node), hit: node === hit || node.contains(hit), label: node.getAttribute('aria-label') || node.title, title: node.title, ...rect};
          }),
          oldLinks: [...document.querySelectorAll('.chin a')].filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden').map(node => node.textContent.trim()),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, actionSelectors);
      assert.equal(layout.chin.height, 30);
      assert.equal(layout.chin.y, 920);
      assert.equal(layout.chin.bottom, 950);
      assert(Math.abs(layout.chin.x - layout.screen.x) <= 1);
      assert(layout.chin.right <= width && layout.chin.right >= layout.screen.right - 1);
      assert.equal(layout.rail.width, 50);
      assert(layout.brand, 'the brand links to Triglavis');
      assert(layout.brand.width <= 50 && layout.brand.height <= 30, 'branding fits the rail-width slot');
      assert(layout.brand.x >= layout.rail.x && layout.brand.right <= layout.rail.right + 1);
      assert.equal(layout.brandText.trim(), '', 'the brand uses only the mark');
      assert.equal(createHash('sha256').update(layout.mark || '').digest('hex'), officialMarkHash, 'the mark preserves the official path');
      for (const control of layout.controls) {
        assert.equal(control.count, 1, `${control.selector} keeps its original identity`);
        assert(control.inChin, `${control.selector} is the real article control inside the chin`);
        assert(control.width >= 24 && control.height >= 24, `${control.selector} keeps a usable target`);
        assert(control.y >= layout.chin.y && control.bottom <= layout.chin.bottom, `${control.selector} fits the chin`);
        assert(control.hit, `${control.selector} is reachable through the frame's clipping boundaries`);
        assert(control.label && control.title, `${control.selector} retains an accessible label and tooltip`);
      }
      assert(layout.controls.every(control => Math.abs(control.y + control.height / 2 - 935) <= 1), 'controls share one horizontal row');
      assert.deepEqual(layout.oldLinks, [], 'old footer links have no visible or focusable boxes');
      assert.equal(layout.overflow, false);
      clean(app);
    } finally { await app.browser.close(); }
  });
}

test('desktop chin retains save, discussion, original-page, keyboard and upward menu actions', {timeout: 20000}, async () => {
  const app = await reader();
  try {
    assert.equal(await app.page.locator('#app-chin').count(), 1);
    const save = app.page.locator('#app-article-actions [data-item-action="save"]');
    await save.click();
    assert(await waitFor(async () => /unsave/i.test(await save.textContent()), 3000), 'the chin uses the real save action');
    const discussion = app.page.locator('#app-toggle-discussion');
    await discussion.focus();
    await app.page.keyboard.press('Enter');
    assert(await waitFor(async () => app.page.locator('#app').evaluate(node => node.classList.contains('discussion-hidden')), 2000));
    assert.equal(await discussion.getAttribute('aria-pressed'), 'false');
    await app.page.keyboard.press('Enter');
    assert(await waitFor(async () => app.page.locator('#app').evaluate(node => !node.classList.contains('discussion-hidden')), 2000));
    assert(await waitFor(async () => app.page.locator('#app').evaluate(node => !node.classList.contains('discussion-moving')), 2000));

    const style = app.page.locator('#app-view-toggle');
    await style.focus();
    await app.page.keyboard.press('Enter');
    const menu = app.page.locator('#app-view-menu');
    await menu.waitFor({timeout: 3000});
    const chin = await app.page.locator('#app-chin').boundingBox(), menuBox = await menu.boundingBox();
    assert(menuBox.y >= 8 && menuBox.y + menuBox.height <= chin.y - 1, 'Style opens completely above the chin');
    assert(menuBox.x >= 0 && menuBox.x + menuBox.width <= 1600, 'Style fits the viewport');
    await menu.locator('button:visible').first().focus();
    await app.page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false);
    assert.equal(await style.evaluate(node => node.getRootNode().activeElement === node), true, 'Escape returns focus to Style');

    await style.click();
    const [original] = await Promise.all([
      app.context.waitForEvent('page'),
      app.page.locator('#app-article-open').click(),
    ]);
    await original.waitForURL(STORIES[0].url);
    await original.close();
    clean(app);
  } finally { await app.browser.close(); }
});

test('rail Settings holds the chin inert, traps focus, and returns it to its opener', {timeout: 15000}, async () => {
  const app = await reader();
  try {
    const proxy = app.page.locator('#settings-toggle');
    assert.equal(await proxy.count(), 1);
    await proxy.focus();
    await app.page.keyboard.press('Enter');
    const modal = app.page.locator('#app-settings-modal');
    await modal.waitFor({timeout: 3000});
    assert.equal(await proxy.getAttribute('aria-expanded'), 'true');
    const held = await proxy.evaluate(node => {
      const root = node.getRootNode();
      return ['#app-rail', '#app-list', '#app-reading', '#app-chin'].map(selector => Boolean(root.querySelector(selector).closest('[inert]')));
    });
    assert(held.every(Boolean), 'the chin and every background pane are inert while Settings is open');
    const close = app.page.locator('#app-settings-close');
    await close.focus();
    await app.page.keyboard.press('Shift+Tab');
    assert.equal(await modal.evaluate(node => node.contains(node.getRootNode().activeElement)), true, 'backward Tab wraps inside Settings');
    await app.page.keyboard.press('Tab');
    assert.equal(await close.evaluate(node => node.getRootNode().activeElement === node), true, 'forward Tab wraps to the first control');
    await app.page.keyboard.press('Escape');
    assert.equal(await modal.isVisible(), false);
    assert.equal(await proxy.getAttribute('aria-expanded'), 'false');
    assert.equal(await proxy.evaluate(node => node.getRootNode().activeElement === node), true, 'closing Settings returns focus to the rail opener');
    assert.equal(await proxy.evaluate(node => Boolean(node.closest('[inert]'))), false);
    clean(app);
  } finally { await app.browser.close(); }
});

test('desktop resizing, article changes, and phone proxies keep the current article state', {timeout: 20000}, async () => {
  const app = await reader();
  try {
    assert.equal(await app.page.locator('#app-chin').count(), 1);
    const middle = await app.page.locator('.app-pane-middle').elementHandle();
    const save = app.page.locator('#app-article-actions [data-item-action="save"]');
    await save.click();
    assert(await waitFor(async () => /unsave/i.test(await save.textContent()), 3000));
    await app.page.setViewportSize({width: 1100, height: 950});
    await app.page.locator('#app-chin #app-view-toggle').waitFor({timeout: 3000});
    assert.equal(await app.page.locator('.app-pane-middle').evaluate((node, original) => node === original, middle), true);
    assert.match(await save.textContent(), /unsave/i);
    assert.equal(await app.page.locator('#app-bar').isVisible(), false, 'stacked desktop uses the chin');

    await app.page.setViewportSize({width: 390, height: 950});
    if (await app.page.locator('#app').getAttribute('data-stage') === 'list') {
      await app.page.locator('#app-list-body .browse-title-link').filter({hasText: STORIES[0].title}).first().click();
    }
    assert(await waitFor(async () => app.page.locator('#app').evaluate(node => node.dataset.stage === 'article' && !node.dataset.moving), 2500));
    assert.equal(await app.page.locator('#app-chin').isVisible(), false);
    const mobileSave = app.page.locator('#app-bar-save');
    await mobileSave.waitFor({timeout: 3000});
    assert.equal(await mobileSave.getAttribute('aria-pressed'), 'true', 'the phone reflects the desktop save');
    const phoneBoxes = await app.page.locator('#app-bar > button:visible').evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect();
      return {x: r.x, y: r.y, width: r.width, height: r.height};
    }));
    assert(phoneBoxes.length >= 3);
    assert(phoneBoxes.every(box => Math.abs(box.x + box.width / 2 - 360) <= 1), 'phone controls retain the right-hand vertical column');
    assert(phoneBoxes.every((box, index) => !index || box.y >= phoneBoxes[index - 1].y + phoneBoxes[index - 1].height));
    await mobileSave.click();
    assert(await waitFor(async () => (await mobileSave.getAttribute('aria-pressed')) === 'false', 3000), 'the phone proxy updates the real save control');
    await app.page.locator('#app-bar-discussion').click();
    assert(await waitFor(async () => (await app.page.locator('#app').getAttribute('data-stage')) === 'discussion', 2500));
    await app.page.locator('#panel').evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    await app.page.locator('#app-bar-discussion').click();
    assert(await waitFor(async () => (await app.page.locator('#app').getAttribute('data-stage')) === 'article', 2500));

    await app.page.setViewportSize({width: 1600, height: 950});
    await app.page.locator('#app-chin #app-view-toggle').waitFor({timeout: 3000});
    assert.equal(await app.page.locator('.app-pane-middle').evaluate((node, original) => node === original, middle), true, 'resizing reparents the original controls');
    assert.doesNotMatch(await save.textContent(), /unsave/i, 'the desktop reflects the phone change');
    await app.page.locator('#app-list-body .browse-title-link').filter({hasText: STORIES[7].title}).first().click();
    assert(await waitFor(async () => (await app.page.locator('#app-article-open').getAttribute('href')) === STORIES[7].url, 3000));
    assert.equal(await save.getAttribute('data-save-url'), STORIES[7].url, 'the reparented control targets the newly opened article');
    await save.click();
    assert(await waitFor(async () => /unsave/i.test(await save.textContent()), 3000));
    clean(app);
  } finally { await app.browser.close(); }
});

for (const fixture of [
  {name: 'light desktop Reader', width: 1600, theme: 'light', reader: true},
  {name: 'dark desktop Reader', width: 1100, theme: 'dark', reader: true},
  {name: 'dark phone Reader', width: 390, theme: 'dark', reader: true},
  {name: 'light Sidebar', width: 1440, theme: 'light', reader: false},
]) {
  test(`${fixture.name} ends General with the existing complete privacy policy`, {timeout: 15000}, async () => {
    const app = watchConsole(await launchApp({
      sharedStore: true,
      viewport: {width: fixture.width, height: 950},
      ...(fixture.reader ? {} : {appHost: new URL(STORIES[0].url).hostname}),
      settings: {sources: {hn: true}, frontPageMode: 'sources', theme: fixture.theme, autoOpenSidebar: !fixture.reader, updateCheck: false},
    }));
    try {
      await app.page.goto(fixture.reader ? 'https://backchnnl.app/' : STORIES[0].url);
      await app.page.locator('#settings-toggle').click();
      await app.page.locator('[data-settings-section="general"]').click();
      await app.page.locator('#settings-cache-clear').waitFor({timeout: 3000});
      const policy = app.page.locator('.settings-privacy');
      assert.equal(await policy.count(), 1, 'General contains a single Privacy subsection');
      const comparison = await policy.evaluate((policy, html) => {
        const root = policy.getRootNode(), normalize = value => value.replace(/\s+/g, ' ').trim();
        const copy = node => Object.fromEntries(['p', 'li', 'h3'].map(selector => [selector, [...node.querySelectorAll(selector)].map(item => normalize(item.textContent)).filter(text => text !== 'Privacy')]));
        const links = node => [...node.querySelectorAll('a[href]')].map(link => ({text: normalize(link.textContent), href: link.getAttribute('href')}));
        const original = new DOMParser().parseFromString(html, 'text/html').querySelector('.privacy-body');
        const groups = [...policy.parentElement.querySelectorAll(':scope > .settings-group')].filter(group => group.getClientRects().length && getComputedStyle(group).visibility !== 'hidden');
        const content = root.querySelector('#app-settings-content');
        const cache = root.querySelector('#settings-cache-clear').closest('.settings-group');
        return {
          actual: copy(policy), expected: copy(original), actualLinks: links(policy), expectedLinks: links(original),
          last: groups.at(-1) === policy,
          afterCache: Boolean(cache.compareDocumentPosition(policy) & Node.DOCUMENT_POSITION_FOLLOWING),
          horizontalOverflow: content.scrollWidth > content.clientWidth + 1,
          text: normalize(policy.textContent),
        };
      }, siteHTML);
      assert.deepEqual(comparison.actual, comparison.expected, 'Settings contains the complete current site policy');
      assert.deepEqual(comparison.actualLinks, comparison.expectedLinks, 'the policy retains its original SECURITY.md and issue links');
      assert.equal(comparison.last, true, 'Privacy is the final General subsection');
      assert.equal(comparison.afterCache, true);
      assert.equal(comparison.horizontalOverflow, false, 'the policy wraps within Settings at the current width');
      assert.match(comparison.text, /Last updated 19 November 2026/);
      assert.match(comparison.text, /encrypted copy of your settings, reading queue, saved items and notes/);
      assert.match(comparison.text, /Diagnostic sharing starts off\. Your choice is included in encrypted Account sync and takes effect on each device when it syncs/);
      assert.match(comparison.text, /database backups may retain earlier copies for up to 30 days/);
      clean(app);
    } finally { await app.browser.close(); }
  });
}
