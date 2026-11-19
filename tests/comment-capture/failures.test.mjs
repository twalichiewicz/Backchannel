import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

const url = STORIES[0].url;

for (const mode of ["partial", "empty", "rate-limit"]) {
  test(`${mode} archive responses preserve available discussions without load diagnostics`, { timeout: 45000 }, async () => {
    const fixture = discussionFixture(url);
    const main = fixture.posts[0];
    const isMain = (path, id) => path.includes("/api/comments/") && new URL(path).searchParams.get("link_id") === id;
    const overrides = [
      { match: (path) => isMain(path, `t3_${main.id}`), status: mode === "rate-limit" ? 429 : 503, json: {} },
      ...(mode === "empty" ? [{ match: (path) => isMain(path, main.id), json: { data: [] } }] : []),
    ];
    const app = await launchApp({
      appHost: new URL(url).hostname,
      sharedStore: true,
      handler: "Userscripts",
      settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false },
      values: { "HNewhere:reddit_read_window_notice": 2 },
      responses: [...overrides, ...fixture.responses],
    });
    try {
      await app.page.goto(url);
      assert(await waitFor(async () => await app.page.locator('#comments-content .page-header-disclosure').count() > 0 && await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000), "missing sources menu after loading");
      assert.equal(await app.page.locator("#comments-content .discussion-load-warning").count(), 0, "load errors should not cover the discussion");
      const disclosure = app.page.locator('#comments-content .page-header-disclosure');
      assert.match(await disclosure.textContent(), /6 discussions/, "the discussion count has no failure marker");
      assert.doesNotMatch(await disclosure.getAttribute('aria-label') || '', /could not be loaded/i, "internal load diagnostics are not announced to screen readers");
      await disclosure.click();
      assert.equal(Math.round((await app.page.locator('#comments-content .source-menu').boundingBox()).width), 300, 'the Sources menu is 300px wide in Sidebar');
      assert(await waitFor(async () => {
        const menu = await app.page.locator('#comments-content .source-menu').boundingBox();
        const panel = await app.page.locator('#panel').boundingBox();
        return menu.x >= panel.x && menu.x + menu.width <= panel.x + panel.width;
      }, 3000), 'the menu stays inside the panel');
      const failed = app.page.locator('#comments-content .source-menu-entry').filter({ has: app.page.locator('[data-discussion-key="reddit:fixture0"]') });
      assert.equal(await failed.count(), 1, 'the source still has a reported nonzero comment total');
      assert.equal(await app.page.locator('#comments-content .source-menu-entry .discussion-source-status').count(), 0, "load diagnostics are not added to the source rows");
      if (mode === "rate-limit") {
        assert(!app.requests.some(({ url }) => isMain(url, main.id)), "429 must not trigger an immediate fallback retry");
      }
      assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="fixture1"]').count() === 3, 10000), "a failed thread must not hide another discussion");
      assert.deepEqual(app.errors, []);
    } finally {
      await app.browser.close();
    }
  });
}

test("Reader keeps available comments without badging Sources for an unavailable discussion", { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({
    sharedStore: true,
    handler: "Tampermonkey",
    settings: { sources: { hn: true, reddit: true }, frontPageMode: "sources", updateCheck: false },
    values: { "HNewhere:reddit_tier": { tier: "archive", timestamp: Date.now() } },
    responses: [
      { match: (path) => path.includes("/api/comments/") && new URL(path).searchParams.get("link_id") === "t3_fixture0", status: 429, json: {} },
      ...fixture.responses,
    ],
  });
  try {
    await app.page.goto("https://backchnnl.app/");
    await app.page.locator("#app-list-body .browse-title-link", { hasText: STORIES[0].title }).first().click();
    const button = app.page.locator('#app-discussion-meta .page-header-disclosure');
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() > 0 && await app.page.locator('#app-discussion-meta .app-sources-sync').count() > 0 && await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy') !== 'true', 15000));
    assert.equal(await app.page.locator('#comments-content .discussion-load-warning').count(), 0);
    assert.equal(await button.locator('.discussion-source-badge').count(), 0, "the Sources button does not badge an internal load diagnostic");
    assert.doesNotMatch(await button.getAttribute('aria-label'), /could not be loaded/i);
    await button.click();
    const failed = app.page.locator('#app-discussion-meta .source-menu-entry').filter({ has: app.page.locator('[data-discussion-key="reddit:fixture0"]') });
    assert.equal(await failed.count(), 1);
    assert.equal(await app.page.locator('#app-discussion-meta .discussion-source-status').count(), 0);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("the bird loader reports completed discussions while slower sources are pending", { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({
    appHost: new URL(url).hostname,
    sharedStore: true,
    handler: "Userscripts",
    settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false },
    values: { "HNewhere:reddit_read_window_notice": 2 },
    responses: [
      ...fixture.posts.map((post) => ({
        match: (path) => path.includes("/api/comments/tree") && new URL(path).searchParams.get("link_id") === `t3_${post.id}`,
        delay: 2500,
        json: { data: fixture.trees.get(post.id) },
      })),
      ...fixture.responses,
    ],
  });
  try {
    await app.page.goto(url);
    const loading = app.page.locator('#comments-content .discussion-loading');
    assert(await waitFor(async () => await loading.count() > 0, 10000), "the bird loader appears");
    await app.page.locator('#comments-content').evaluate((element) => {
      window.__sawDiscussionWipe = false;
      const observer = new MutationObserver((records) => {
        if (records.some((record) => record.type === 'attributes' && record.target.classList?.contains('is-wiping'))) {
          window.__sawDiscussionWipe = true;
          observer.disconnect();
        }
      });
      observer.observe(element, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    const birds = loading.locator('.discussion-bird');
    assert.equal(await birds.count(), 6, 'the three birds take a turn from each side');
    assert.equal(await birds.locator('.discussion-bird-body').count(), 6, 'each bird has a stationary body layer');
    assert.equal(await birds.locator('.discussion-bird-head').count(), 6, 'each bird has its own moving head');
    assert.equal(await loading.locator('.discussion-birds').getAttribute('aria-hidden'), 'true');
    const timing = await birds.evaluateAll((elements) => elements.map((bird) => {
      const style = getComputedStyle(bird);
      const speaking = getComputedStyle(bird.querySelector('.discussion-bird-bubble'));
      return [parseFloat(style.animationDelay), style.animationIterationCount, speaking.animationIterationCount];
    }));
    assert(timing[0][0] < timing[1][0] && timing[1][0] < timing[2][0], 'the birds take turns');
    assert(timing.every(([, bird, bubble]) => bird === 'infinite' && bubble === 'infinite'), 'birds and their bubbles keep cycling while loading');
    const motion = await birds.evaluateAll(async elements => {
      const stage = elements[0].parentElement;
      const center = element => {
        const {x, y, width, height} = element.getBoundingClientRect();
        return [x + width / 2, y + height / 2];
      };
      const animations = stage.getAnimations({ subtree: true });
      const playback = animations.map(animation => ({time:animation.currentTime, state:animation.playState}));
      animations.forEach(animation => animation.pause());
      await Promise.all(animations.map(animation => animation.ready));
      const { delay, duration } = elements[0].getAnimations()[0].effect.getTiming();
      const sample = (bird, time) => {
        bird.getAnimations({ subtree: true }).forEach(animation => animation.currentTime = time);
        const bubble = bird.querySelector('.discussion-bird-bubble');
        const portrait = bird.querySelector('.discussion-bird-portrait');
        const head = bird.querySelector('.discussion-bird-head');
        const headArt = getComputedStyle(head.querySelector('.discussion-bird-mark')).backgroundImage;
        const openArt = getComputedStyle(head).getPropertyValue('--bird-open');
        const bubbleStyle = getComputedStyle(bubble);
        const bubbleTransform = new DOMMatrixReadOnly(bubbleStyle.transform);
        return {
          at: center(bird), opacity: Number(getComputedStyle(bird).opacity),
          bubble: bubbleStyle.visibility === 'visible' ? Number(bubbleStyle.opacity) : 0,
          bubbleScale: Math.hypot(bubbleTransform.a, bubbleTransform.b),
          open: headArt.includes(openArt.trim().slice(4, -1)),
          body: getComputedStyle(portrait).transform,
          head: getComputedStyle(head).transform,
        };
      };
      const offsets = elements.map(bird => bird.getAnimations()[0].effect.getTiming().delay);
      const entering = elements.map((bird, index) => sample(bird, offsets[index] + duration * .025));
      const speaking = elements.map((bird, index) => sample(bird, offsets[index] + duration * .075));
      const exiting = elements.map((bird, index) => sample(bird, offsets[index] + duration * .175));
      const mouthMatchesBubble = elements.every((bird, index) => [.01, .04, .09, .12, .16, .18, .23].every((progress) => {
        const {open, bubble} = sample(bird, offsets[index] + duration * progress);
        return open === (bubble > 0);
      }));
      const handoffTime = delay + duration * .19;
      const handoff = elements.slice(0, 2).map(bird => sample(bird, handoffTime).opacity);
      animations.forEach((animation, index) => {
        animation.currentTime = playback[index].time;
        if (playback[index].state === 'running') animation.play();
      });
      return { center: center(stage), container: center(stage.closest('#comments')), entering, speaking, exiting, handoff, mouthMatchesBubble };
    });
    assert(motion.center.every((coordinate, i) => Math.abs(coordinate - motion.container[i]) < 1), 'the rotor is centered in the discussion viewport');
    assert.deepEqual(motion.entering.map(({at}) => at[0] < motion.center[0]), [true, false, true, false, true, false]);
    for (const [index, entering] of motion.entering.entries()) {
      const speaking = motion.speaking[index];
      const exiting = motion.exiting[index];
      assert(entering.at[1] > motion.center[1] && exiting.at[1] < motion.center[1], 'the birds enter from below and leave above');
      assert(entering.opacity > 0 && entering.opacity < 1 && entering.bubble > 0 && entering.open, 'the birds speak as they fade in');
      assert(exiting.opacity > 0 && exiting.opacity < 1 && exiting.bubble === 0 && !exiting.open, 'the birds close their beaks and fade out');
      assert.equal(entering.body, speaking.body, 'the body stays steady as the bird speaks');
      assert.notEqual(entering.head, speaking.head, 'the head teeters as the bird speaks');
      assert(entering.bubbleScale < speaking.bubbleScale, 'the bubble grows out of the beak');
    }
    assert(motion.mouthMatchesBubble, 'the beak is open whenever the bubble is visible');
    for (const {at, opacity, bubble, open} of motion.speaking) {
      const offset = at.map((coordinate, i) => coordinate - motion.center[i]);
      assert(opacity > .99 && bubble > .99 && open && offset.every(distance => Math.abs(distance) < 1), `each bird talks at peak opacity on center stage: ${JSON.stringify({offset, opacity, bubble, open})}`);
    }
    assert(motion.handoff.every(opacity => opacity > 0 && opacity < 1), 'the next bird fades in while the previous one fades out');
    const art = await birds.evaluateAll(async elements => {
      const sources = elements.slice(0, 3).flatMap(bird => {
        const style = getComputedStyle(bird);
        return ['--bird-closed', '--bird-open'].map(pose => style.getPropertyValue(pose).trim());
      });
      sources.push(getComputedStyle(elements[0].querySelector('.discussion-bird-bubble')).backgroundImage);
      return Promise.all(sources.map(async source => {
        const url = source.match(/^url\(["']?(data:image\/webp;base64,[\w+/=]+)["']?\)$/)?.[1];
        if (!url) return 0;
        const image = new Image();
        image.src = url;
        await image.decode();
        return image.naturalWidth;
      }));
    });
    assert.deepEqual(art, [208, 208, 208, 208, 208, 208, 108], 'both promotional poses and the speech bubble are available without a fetch');
    assert((await app.page.locator('#comments-content .page-header-title').textContent()).length > 0, "the known article title appears immediately");
    const composer = app.page.locator('#comments-content .compose-box');
    assert.equal(await composer.count(), 1, "the real composer appears while discussions load");
    await composer.locator('.composer-text').fill('A draft while loading');
    assert(await composer.locator('.compose-send-note').isDisabled(), "note submission stays disabled while loading");
    assert(await composer.locator('.compose-send-comment').isDisabled(), "comment submission stays disabled while loading");
    const area = await app.page.locator('#comments').boundingBox();
    const skeleton = await loading.boundingBox();
    assert(skeleton.y + skeleton.height >= area.y + area.height - 40, "the loader extends to the bottom of the discussion viewport");
    assert.equal(await loading.locator('[role="progressbar"]').count(), 0, "Sidebar does not duplicate the status in its body");
    const subtitle = app.page.locator('#header-subtitle');
    assert(await waitFor(async () => /loading discussions \([1-5] of 6\)/i.test(await subtitle.textContent()), 10000), "header progress advances while discussions remain");
    assert(await waitFor(() => app.page.evaluate(() => window.__sawDiscussionWipe), 15000), 'the loader wipes away as comments appear');
    const real = app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"] .text').first();
    assert.match(await real.textContent(), /Root comment 0/, 'the actual comment text stays intact during animation');
    const realMarkup = await real.innerHTML();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(await real.innerHTML(), realMarkup, 'the real comment markup remains untouched');
    assert.equal(await app.page.locator('#comments-content .discussion-matrix-reveal').count(), 0, 'no scrambled visual copies obscure the real comments');
    assert(await waitFor(async () => await loading.count() === 0, 15000), "the loader is removed after loading");
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="fixture0"]').count() === 140, 10000), "all comments render after loading");
    assert(await waitFor(async () => !/loading discussions|rendering comments|annotating link/i.test(await subtitle.textContent()), 30000), `the header stops reporting loading after rendering: ${await subtitle.textContent()}`);
    assert.equal(await composer.locator('.composer-text').inputValue(), 'A draft while loading', "the draft survives the transition to comments");
    assert(!(await composer.locator('.compose-send-note').isDisabled()), "note submission is enabled once ready");
    assert(!(await composer.locator('.compose-send-comment').isDisabled()), "comment submission is enabled once ready");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const sidebar of [true, false]) test(`${sidebar ? 'Sidebar' : 'Reader'} respects reduced motion during discussion loading`, { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: !sidebar, reddit: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } }, responses: [
    { match: (path) => path.includes('/api/posts/search'), delay: 500, json: { data: fixture.posts } },
    ...fixture.posts.map((post) => ({ match: (path) => path.includes('/api/comments/tree') && new URL(path).searchParams.get('link_id') === `t3_${post.id}`, delay: 350, json: { data: fixture.trees.get(post.id) } })),
    ...fixture.responses,
  ] });
  try {
    await app.page.emulateMedia({ reducedMotion: 'reduce' });
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const birds = app.page.locator('#comments-content .discussion-birds');
    assert(await waitFor(() => birds.evaluateAll((elements) => elements.some((element) => element.getAnimations({ subtree: true }).length === 0)), 10000), 'the loader presents the birds without animation');
    await app.page.evaluate(() => {
      window.__wipeSeen = false;
      const root = [...document.querySelectorAll('*')].map((node) => node.shadowRoot).find((shadow) => shadow?.querySelector('#comments-content'));
      new MutationObserver((records) => { if (records.some((record) => record.type === 'attributes' && record.target.matches('.discussion-loading.is-wiping'))) window.__wipeSeen = true; }).observe(root, { attributes: true, attributeFilter: ['class'], subtree: true });
    });
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]').count() === 1, 15000));
    assert.equal(await app.page.evaluate(() => window.__wipeSeen), false, 'real comments appear without an animated wipe');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test("Reader shows the bird loader and aligned loading hint without a progress bar", { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({
    sharedStore: true,
    handler: "Tampermonkey",
    settings: { sources: { hn: true, reddit: true }, frontPageMode: "sources", updateCheck: false },
    values: { "HNewhere:reddit_tier": { tier: "archive", timestamp: Date.now() } },
    responses: [
      { match: (path) => path.includes('/api/posts/search'), delay: 800, json: { data: fixture.posts } },
      ...fixture.posts.map((post) => ({ match: (path) => path.includes('/api/comments/tree') && new URL(path).searchParams.get('link_id') === `t3_${post.id}`, delay: 600, json: { data: fixture.trees.get(post.id) } })),
      ...fixture.responses,
    ],
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading .discussion-bird').count() > 0, 3000), "the bird loader appears during discovery");
    assert.match(await app.page.locator('#panel.app-docked > .discussion-progress-strip').textContent(), /checking sources/i, 'the loading hint appears during discovery');
    assert(await app.page.locator('#app-discussion-compose .composer-text').isVisible(), 'the bottom composer is visible while discovery is still pending');
    assert(await app.page.locator('#app-discussion-meta .page-header-disclosure').isVisible(), 'the Sources control is visible while discovery is still pending');
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    assert.equal(Math.round((await app.page.locator('#app-discussion-meta .source-menu').boundingBox()).width), 300, 'the Sources menu is 300px wide');
    await app.page.locator('#app-discussion-meta .page-header-disclosure').click();
    assert(await app.page.locator('#app-discussion-compose .compose-send-comment').isDisabled(), 'submitting remains disabled while discovering discussions');
    await app.page.locator('.compose-box .composer-text').fill('Reader draft while loading');
    assert.doesNotMatch(await app.page.locator('#comments-content').textContent(), /Finding what people said/);
    const strip = app.page.locator('#panel.app-docked > .discussion-progress-strip');
    assert(await waitFor(async () => await strip.count() === 1, 10000), "progress appears directly below the Discussion header");
    assert(await waitFor(async () => (await strip.boundingBox())?.height >= 35, 3000));
    const head = await app.page.locator('#panel.app-docked > header').boundingBox();
    const progress = await strip.boundingBox();
    assert(Math.abs(progress.height - head.height) <= 2, "progress and header have the same height");
    assert(Math.abs(progress.y - (head.y + head.height)) <= 2, "progress is attached to the header");
    const font = await strip.evaluate((element) => getComputedStyle(element).fontSize);
    assert.equal(font, '11px', "the hint uses the smaller hint text size");
    assert.equal(await strip.locator('.discussion-progress-track, [role="progressbar"]').count(), 0, "there is no visual progress bar");
    const hintOffset = await strip.evaluate((element) => {
      const title = element.parentElement.querySelector('header .header-static-title').getBoundingClientRect();
      const label = element.querySelector('.discussion-progress-label').getBoundingClientRect();
      return Math.abs(title.x - label.x);
    });
    assert(hintOffset <= 2, "the hint aligns with the Discussion title");
    assert.notEqual(await strip.locator('.discussion-progress-label').evaluate((element) => getComputedStyle(element).animationName), 'none', 'the Reader loading hint glimmers');
    const composer = app.page.locator('#panel .compose-box');
    assert.equal(await composer.count(), 1);
    assert.equal(await composer.locator('.composer-text').inputValue(), 'Reader draft while loading', 'the early draft is kept when discovered sources arrive');
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="hn:"]').count()>0,10000),'a ready discussion appears before slower sources finish');
    assert(!(await composer.locator('.compose-send-note').isDisabled()),'notes become available with the ready discussion');
    assert(!(await composer.locator('.compose-send-comment').isDisabled()),'a slow source does not prevent replying to an available source');
    const loading = app.page.locator('#comments-content .discussion-loading');
    assert(await waitFor(async () => await loading.count() === 0, 20000), 'Reader removes the initial loader while ready comments remain visible');
    assert(await app.page.locator('#comments-content .comment[data-comment-id] .text').first().textContent(), 'the real comment text remains available');
    assert.equal(await app.page.locator('#comments-content .discussion-matrix-reveal').count(), 0, 'Reader uses no scrambled visual copies');
    assert(await waitFor(async () => await strip.count() === 0, 20000), "progress slides away when requests finish");
    assert(await waitFor(async () => !(await composer.locator('.compose-send-comment').isDisabled()), 15000));
    assert.equal(await composer.locator('.composer-text').inputValue(), 'Reader draft while loading');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Sidebar shows sync in the header while browsing without a duplicate toast", { timeout: 30000 }, async () => {
  const slowGets = { key: "HNewhere:settings", ms: 1500, armed: false };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, slowGets, settings: { sources: { hn: true }, autoOpenSidebar: true, frontPageMode: "sources", updateCheck: false } });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() > 0, 15000));
    assert(await waitFor(async () => /updated/i.test(await app.page.locator('#header-subtitle').textContent()), 10000));
    assert(await waitFor(async () => !(await app.page.locator('#header-subtitle').evaluate((element) => element.classList.contains('header-subtitle-visible'))), 3500), "the updated status auto-collapses");
    await app.page.locator('#browse-toggle .wordmark-root').click();
    assert(await waitFor(async () => await app.page.locator('#panel.browsing').count() === 1, 10000));
    const button = app.page.locator('#browse-home-sync');
    assert(await waitFor(async () => await button.isVisible(), 10000));
    slowGets.armed = true;
    await button.click();
    assert(await waitFor(async () => /syncing/i.test(await app.page.locator('#header-subtitle').textContent()), 3000), "the header reports the active sync");
    assert.doesNotMatch(await app.page.locator('#toast').textContent(), /syncing/i, "sync is not announced twice");
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 10000), "sync completes");
    assert.doesNotMatch(await app.page.locator('#header-subtitle').textContent(), /syncing/i, "the status clears after sync");
    assert.match(await app.page.locator('#header-subtitle').textContent(), /synced/i, 'successful browsing sync ends in the header');
    assert.doesNotMatch(await app.page.locator('#toast').textContent(), /^synced$/i, 'there is no duplicate Synced toast');
    assert(await waitFor(async () => !(await app.page.locator('#header-subtitle').evaluate((element) => element.classList.contains('header-subtitle-visible'))), 3500), 'the synced header status dismisses itself');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader keeps saved comments available while checking revisited articles", { timeout: 45000 }, async () => {
  const app = await launchApp({ sharedStore: true, settings: { sources: { hn: true }, frontPageMode: "sources", updateCheck: false } });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    const first = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[0].url}"]`).first();
    const second = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[1].url}"]`).first();
    await first.click();
    const firstComments = app.page.locator('#comments-content .comment[data-story-id="9001"]');
    assert(await waitFor(async () => await firstComments.count() === 30, 15000), 'first article loads');
    await firstComments.first().evaluate((element) => { element.dataset.cacheSentinel = 'retained'; });
    await first.click();
    assert.equal(await firstComments.first().getAttribute('data-cache-sentinel'), 'retained', 'selecting the current article preserves its rendered discussion');
    await second.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9002"]').count() === 30, 15000));
    const firstRequests = () => app.requests.filter(({ url }) => /hacker-news\.firebaseio\.com\/v0\/item\/(9001|9001\d\d)\.json/.test(url)).length;
    const before = firstRequests();
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async () => await app.page.locator('#app-list-sync').getAttribute('aria-busy') !== 'true', 15000));
    await first.click();
    assert(await waitFor(async () => await firstComments.count() === 30, 15000), `first article reloads; body: ${(await app.page.locator('#comments-content').textContent()).slice(0, 300)}; errors: ${JSON.stringify(app.errors)}`);
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',15000));
    assert(firstRequests()>before, 'revisiting an article checks for new comments even when saved comments were available');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("mobile Reader can sync an article with no discussions", { timeout: 45000 }, async () => {
  const search = { match: (path) => path.startsWith('https://hn.algolia.com/api/v1/search?'), json: { hits: [] } };
  const missing = { match: (path) => path.includes('hacker-news.firebaseio.com/v0/item/9001.json'), json: { id: 9001, type: 'deleted' } };
  const now = Math.floor(Date.now() / 1000);
  const app = await launchApp({ viewport: { width: 390, height: 844 }, hasTouch: true, sharedStore: true, settings: { sources: { hn: true }, frontPageMode: 'sources', updateCheck: false }, responses: [search, missing, { match: (path) => path.includes('/v0/item/9988.json'), json: { id: 9988, type: 'story', title: STORIES[0].title, url: STORIES[0].url, by: 'reader', time: now, descendants: 1, kids: [998801] } }, { match: (path) => path.includes('/v0/item/998801.json'), json: { id: 998801, type: 'comment', parent: 9988, by: 'reader', time: now, text: 'A newly found discussion' } }] });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    await app.page.locator('#app-bar-discussion').click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .no-discussion').count() === 1, 10000));
    const sync = app.page.locator('#app-discussion-sync-empty');
    assert(await sync.isVisible(), 'Sync remains available when no Sources menu exists');
    search.json = { hits: [{ objectID: '9988', title: STORIES[0].title, url: STORIES[0].url, author: 'reader', points: 10, num_comments: 1, created_at_i: now }] };
    const before = app.requests.filter(({ url }) => search.match(url)).length;
    await sync.tap();
    assert(await waitFor(() => app.requests.filter(({ url }) => search.match(url)).length > before, 10000), 'Sync checks sources again');
    assert(await waitFor(async () => /A newly found discussion/.test(await app.page.locator('#comments-content').textContent()), 15000), 'a newly discovered discussion appears');
    assert(await sync.isHidden(), 'the empty-state control is replaced by the Sources menu');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test("Reader clears provisional controls and its loading hint when discovery finds no discussions", { timeout: 30000 }, async () => {
  const app = await launchApp({
    sharedStore: true,
    settings: { sources: { hn: true }, frontPageMode: 'sources', updateCheck: false },
    responses: [
      { match: (path) => path.startsWith('https://hn.algolia.com/api/v1/search?'), delay: 600, json: { hits: [] } },
      { match: (path) => path.includes('hacker-news.firebaseio.com/v0/item/9001.json'), json: { id: 9001, type: 'deleted' } },
    ],
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    assert(await app.page.locator('#app-discussion-meta .page-header-disclosure').isVisible(), 'known source appears during discovery');
    assert(await waitFor(async () => await app.page.locator('#comments-content .no-discussion').count() === 1, 10000));
    assert.equal(await app.page.locator('#app-discussion-meta .page-header-disclosure').count(), 0, 'unconfirmed source controls are removed');
    assert(await app.page.locator('#app-discussion-compose').isHidden());
    assert(await waitFor(async () => await app.page.locator('#panel.app-docked > .discussion-progress-strip').count() === 0, 3000), 'the loading hint is dismissed');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader retains an early note draft when a newly discovered source accepts comments", { timeout: 30000 }, async () => {
  const story = { source: 'lemmy', id: 321, url, title: STORIES[0].title, descendants: 1, time: Math.floor(Date.now() / 1000) - 60 };
  const view = { post: { id: 321, url, name: story.title, creator_id: 1, published: new Date().toISOString() }, community: { name: 'technology', actor_id: 'https://lemmy.world/c/technology' }, creator: { name: 'reader' }, counts: { comments: 1 } };
  const app = await launchApp({
    sharedStore: true,
    settings: { sources: { hn: true, lemmy: true }, frontPageMode: 'sources', updateCheck: false },
    values: { 'HNewhere:frontpage_cache:hn,lemmy': { timestamp: Date.now(), rows: [{ story, also: [] }], sources: ['lemmy'] } },
    responses: [
      { match: (path) => path.includes('/api/v3/search'), delay: 800, json: { posts: [view] } },
      { match: (path) => path.includes('/api/v3/post?id=321'), json: { post_view: view } },
      { match: (path) => path.includes('/api/v3/comment/list?post_id=321'), json: { comments: [] } },
    ],
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: story.title }).first().click();
    const composer = app.page.locator('#panel .compose-box');
    await composer.locator('.composer-text').fill('A note drafted while sources load');
    assert.equal(await composer.locator('.composer-text').inputValue(),'A note drafted while sources load');
    assert(await waitFor(async () => await composer.locator('.compose-send-comment').isVisible(), 15000), 'the discovered Hacker News discussion offers commenting');
    assert(await waitFor(async () => !(await composer.locator('.compose-send-comment').isDisabled()), 15000));
    assert.equal(await composer.locator('.composer-text').inputValue(), 'A note drafted while sources load');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader retains an early draft while a zero-count feed source is checked", { timeout: 30000 }, async () => {
  const uri = 'at://did:plc:fixture/app.bsky.feed.post/article';
  const story = { source: 'bsky', id: uri, url, title: STORIES[0].title, descendants: 0, time: Math.floor(Date.now() / 1000) - 60 };
  const post = { uri, author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, embed: { external: { uri: url } }, record: { text: 'A Bluesky discussion', createdAt: new Date().toISOString() }, replyCount: 0, likeCount: 1 };
  const app = await launchApp({
    sharedStore: true,
    settings: { sources: { hn: true, bsky: true }, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false },
    values: {
      'HNewhere:frontpage_feed:technology/hn/': { timestamp: Date.now(), stories: [] },
      'HNewhere:frontpage_feed:technology/bsky/at://did:plc:cndfx4udwgvpjaakvxvh7wm5/app.bsky.feed.generator/flipboard-tech': { timestamp: Date.now(), stories: [story] },
    },
    responses: [
      { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
      { match: (path) => path.includes('/app.bsky.feed.getPosts'), delay: 1200, json: { posts: [post] } },
      { match: (path) => path.includes('/app.bsky.feed.getPostThread'), json: { thread: { post, replies: [] } } },
    ],
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: story.title }).first().click();
    assert.doesNotMatch(await app.page.locator('#app-discussion-meta .source-menu').textContent(), /Bluesky/, 'a provisional source with no comments is not selectable');
    const composer = app.page.locator('#panel .compose-box');
    await composer.locator('.composer-text').fill('A draft from a Bluesky feed');
    assert(await waitFor(async()=>await app.page.locator('#comments-content .comment[data-comment-id^="bsky:"]').count()>0,15000),'the feed post resolves into its collective discussion');
    assert(await waitFor(async()=>/Bluesky/.test(await app.page.locator('#app-discussion-meta .source-menu').textContent()),5000),'the source becomes selectable once real posts arrive');
    assert(await waitFor(async () => await composer.locator('.compose-send-comment').isVisible(), 15000));
    assert(await waitFor(async () => !(await composer.locator('.compose-send-comment').isDisabled()), 15000));
    assert.equal(await composer.locator('.composer-text').inputValue(), 'A draft from a Bluesky feed');
    await app.page.locator('#comment-sort').click();
    await app.page.getByRole('option', { name: 'Newest', exact: true }).click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 5000), 'changing sort refreshes the discussion');
    assert(await waitFor(async () => !(await composer.locator('.compose-send-comment').isDisabled()), 15000));
    assert.equal(await composer.locator('.composer-text').inputValue(), 'A draft from a Bluesky feed', 'sorting keeps the draft after the collective discussion is resolved');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader retains more than twenty saved discussions while rechecking an article", { timeout: 45000 }, async () => {
  const now = Math.floor(Date.now() / 1000);
  const posts = Array.from({ length: 25 }, (_, index) => ({ id: `cache${index}`, url, title: STORIES[0].title, author: 'reader', subreddit: `source${index}`, subreddit_name_prefixed: `r/source${index}`, permalink: `/r/source${index}/comments/cache${index}/article/`, num_comments: 1, created_utc: now - 3600, score: 10 }));
  const app = await launchApp({
    sharedStore: true, handler: 'Tampermonkey',
    settings: { sources: { hn: true, reddit: true }, frontPageMode: 'sources', updateCheck: false },
    values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } },
    responses: [
      { match: (path) => path.includes('/api/posts/search'), json: { data: posts } },
      ...posts.map((post) => ({ match: (path) => path.includes('/api/comments/tree') && new URL(path).searchParams.get('link_id') === `t3_${post.id}`, json: { data: [{ kind: 't1', data: { id: `${post.id}comment`, body: `Comment for ${post.id}`, author: 'reader', parent_id: `t3_${post.id}`, link_id: `t3_${post.id}`, created_utc: now - 60, replies: '' } }] } })),
    ],
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    const first = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[0].url}"]`).first();
    const second = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[1].url}"]`).first();
    await first.click();
    const comments = app.page.locator('#comments-content .comment[data-comment-id^="reddit:cache"]');
    assert(await waitFor(async () => await comments.count() === 25, 15000), 'all discussions load');
    await second.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9002"]').count() === 30, 15000));
    const treeRequests = () => app.requests.filter(({ url }) => url.includes('/api/comments/tree')).length;
    const before = treeRequests();
    assert.equal(before, 25);
    await first.click();
    assert(await waitFor(async () => await comments.count() === 25, 15000), 'all cached discussions return');
    assert(await waitFor(async()=>await app.page.locator('#app-discussion-meta .app-sources-sync').getAttribute('aria-busy')!=='true',15000));
    assert.equal(await comments.count(),25,'new checks preserve every saved discussion');
    assert.equal(treeRequests(), before+25, 'revisiting checks each discussion once while saved comments remain available');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("background discussion rendering cannot replace the browsing Sync status", { timeout: 45000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'setSidebarLoadingLabel(ui, "rendering comments…");';
  assert(original.includes(seam));
  const source = original.replace(seam, `await new Promise((resolve) => setTimeout(resolve, 1500));\n\t\t${seam}`);
  const slowGets = { key: 'HNewhere:settings', ms: 1800, armed: false };
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, slowGets, settings: { sources: { hn: true }, autoOpenSidebar: true, frontPageMode: 'sources', updateCheck: false } });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 10000));
    await app.page.locator('#browse-toggle .wordmark-root').click();
    assert(await waitFor(async () => await app.page.locator('#panel.browsing').count() === 1, 5000));
    const subtitle = app.page.locator('#header-subtitle');
    await subtitle.evaluate((element) => {
      window.__browseStatuses = [];
      new MutationObserver(() => window.__browseStatuses.push(element.textContent)).observe(element, { childList: true, characterData: true, subtree: true });
    });
    slowGets.armed = true;
    const button = app.page.locator('#browse-home-sync');
    await button.click();
    assert(await waitFor(async () => /syncing/i.test(await subtitle.textContent()), 3000));
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 12000));
    assert(!(await app.page.evaluate(() => window.__browseStatuses)).some((text) => /rendering comments|annotating link|loading discussions/i.test(text)), 'background discussion statuses stay hidden while browsing');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("syncing a discussion restores its article highlights and finishes the header status", { timeout: 30000 }, async () => {
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: true, annotations: true, updateCheck: false, sourceRefreshMinutes: 0 } });
  try {
    await app.page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.page.goto(url);
    const marks = app.page.locator('[data-hnewhere-annotation-overlay] button');
    const subtitle = app.page.locator('#header-subtitle');
    assert(await waitFor(async () => await marks.count() > 0, 15000), "the discussion initially highlights the article");
    assert(await waitFor(async () => /updated/i.test(await subtitle.textContent()), 15000), "initial rendering has finished");
    await subtitle.evaluate((element) => {
      window.__sawAnimatedSourceCheck = false;
      const observer = new MutationObserver(() => {
        if (!/checking sources/i.test(element.textContent) || !element.classList.contains('header-subtitle-loading')) return;
        window.__sawAnimatedSourceCheck = true;
        observer.disconnect();
      });
      observer.observe(element, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
    });
    const button = app.page.locator('#browse-home-sync');
    await button.click();
    assert(await waitFor(() => app.page.evaluate(() => window.__sawAnimatedSourceCheck), 6000), "source discovery reports its loading animation while active");
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000), "discussion sync finishes");
    assert(await waitFor(async () => await marks.count() > 0, 10000), "the refreshed comments still highlight the article");
    assert.doesNotMatch(await subtitle.textContent(), /checking sources|loading discussions|rendering comments|annotating link|syncing/i);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("queued discussions get their own timeout instead of expiring before the request starts", { timeout: 30000 }, async () => {
  const scriptPath = process.env.BC_SCRIPT || new URL("../../HNewhere.user.js", import.meta.url);
  let source = await readFile(scriptPath, "utf8");
  const ceiling = "const THREAD_CEILING_MS = 20000;";
  assert(source.includes(ceiling), "the timeout test needs its controlled clock seam");
  source = source.replace(ceiling, "const THREAD_CEILING_MS = 1500;");
  source = source.replace("Math.max(THREAD_CEILING_MS * 6, 120000)", "1200");
  const fixture = discussionFixture(url);
  const posts = fixture.posts.slice(1, 5);
  const responses = [
    { match: (path) => path.includes("/api/posts/search"), json: { data: posts } },
    ...posts.map((post) => ({
      match: (path) => path.includes("/api/comments/tree") && new URL(path).searchParams.get("link_id") === `t3_${post.id}`,
      delay: 700,
      json: { data: [fixture.trees.get(post.id)[0]] },
    })),
    ...posts.map((post) => ({
      match: (path) => path.includes("/api/comments/search") && new URL(path).searchParams.get("link_id") === post.id,
      delay: 700,
      json: { data: [fixture.trees.get(post.id)[0].data] },
    })),
  ];
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: "Userscripts", settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false }, values: { "HNewhere:reddit_read_window_notice": 2 }, responses });
  try {
    await app.page.goto(url);
    await waitFor(async () => await app.page.locator("#comments-content .comment[data-comment-id]").count() === 4, 15000);
    assert.equal(await app.page.locator("#comments-content .comment[data-comment-id]").count(), 4, "queued requests must not time out before starting");
    assert.equal(app.requests.filter(({ url }) => url.includes("/api/comments/tree")).length, 4);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
