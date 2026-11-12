import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

const url = STORIES[0].url;

for (const mode of ["partial", "empty", "rate-limit"]) {
  test(`${mode} archive responses are disclosed without losing other discussions`, { timeout: 45000 }, async () => {
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
      assert.match(await disclosure.textContent(), /6\* discussions/, "the discussion count marks a failed load");
      assert.match(await disclosure.getAttribute('aria-label'), /6 discussions.*could not be loaded/i, "the count and warning remain available to screen readers");
      await disclosure.click();
      const failed = app.page.locator('#comments-content .source-menu-entry').filter({ has: app.page.locator('[data-discussion-key="reddit:fixture0"]') });
      const warning = await failed.locator('.discussion-source-status').textContent();
      assert.match(warning, mode === "partial" ? /only some comments/i : /couldn't load comments/i);
      assert.match(warning, /sync to retry/i);
      assert.equal(await app.page.locator('#comments-content .source-menu-entry .discussion-source-status').count(), 1, "only the affected discussion has a warning");
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

test("Reader puts a failed discussion on its source row and badges the Sources button", { timeout: 45000 }, async () => {
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
    assert(await waitFor(async () => await button.locator('.discussion-source-badge').count() === 1, 15000));
    assert.equal(await app.page.locator('#comments-content .discussion-load-warning').count(), 0);
    assert.equal(await button.locator('.discussion-source-badge').count(), 1, "the Sources button has a visible status badge");
    assert.match(await button.getAttribute('aria-label'), /could not be loaded/i);
    await button.click();
    const failed = app.page.locator('#app-discussion-meta .source-menu-entry').filter({ has: app.page.locator('[data-discussion-key="reddit:fixture0"]') });
    assert.match(await failed.locator('.discussion-source-status').textContent(), /couldn't load comments/i);
    assert.equal(await app.page.locator('#app-discussion-meta .discussion-source-status').count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("the loading skeleton reports completed discussions while slower sources are pending", { timeout: 45000 }, async () => {
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
        delay: 600,
        json: { data: fixture.trees.get(post.id) },
      })),
      ...fixture.responses,
    ],
  });
  try {
    await app.page.goto(url);
    const loading = app.page.locator('#comments-content .discussion-loading');
    assert(await waitFor(async () => await loading.count() > 0, 10000), "the loading skeleton appears");
    assert(await loading.locator('.discussion-skeleton-comment').count() >= 4, "the skeleton fills the discussion area");
    assert.equal(await loading.locator('.discussion-skeleton-heading, .discussion-skeleton-compose').count(), 0, "known content is not replaced with placeholders");
    assert((await app.page.locator('#comments-content .page-header-title').textContent()).length > 0, "the known article title appears immediately");
    const composer = app.page.locator('#comments-content .compose-box');
    assert.equal(await composer.count(), 1, "the real composer appears while discussions load");
    await composer.locator('.composer-text').fill('A draft while loading');
    assert(await composer.locator('.compose-send-note').isDisabled(), "note submission stays disabled while loading");
    assert(await composer.locator('.compose-send-comment').isDisabled(), "comment submission stays disabled while loading");
    const area = await app.page.locator('#comments').boundingBox();
    const skeleton = await loading.boundingBox();
    assert(skeleton.y + skeleton.height >= area.y + area.height - 40, "the skeleton extends to the bottom of the discussion viewport");
    assert.equal(await loading.locator('[role="progressbar"]').count(), 0, "Sidebar does not duplicate the status in its body");
    const subtitle = app.page.locator('#header-subtitle');
    assert(await waitFor(async () => /loading discussions \([1-5] of 6\)/i.test(await subtitle.textContent()), 10000), "header progress advances while discussions remain");
    assert(await waitFor(async () => await loading.count() === 0, 15000), "the skeleton is removed after loading");
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="fixture0"]').count() === 140, 10000), "all comments render after loading");
    assert(await waitFor(async () => !/loading discussions|rendering comments|annotating link/i.test(await subtitle.textContent()), 10000), "the header stops reporting loading after rendering");
    assert.equal(await composer.locator('.composer-text').inputValue(), 'A draft while loading', "the draft survives the transition to comments");
    assert(!(await composer.locator('.compose-send-note').isDisabled()), "note submission is enabled once ready");
    assert(!(await composer.locator('.compose-send-comment').isDisabled()), "comment submission is enabled once ready");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader shows a skeleton and aligned loading hint without a progress bar", { timeout: 45000 }, async () => {
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
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-skeleton-comment').count() > 0, 3000), "the normal skeleton appears during discovery");
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
    const title = await app.page.locator('#panel.app-docked > header .header-static-title').boundingBox();
    const label = await strip.locator('.discussion-progress-label').boundingBox();
    assert(Math.abs(title.x - label.x) <= 2, "the hint aligns with the Discussion title");
    const composer = app.page.locator('#panel .compose-box');
    assert.equal(await composer.count(), 1);
    await app.page.locator('#comment-toggle').click();
    await composer.locator('.composer-text').fill('Reader draft while loading');
    assert(await composer.locator('.compose-send-note').isDisabled());
    assert(await composer.locator('.compose-send-comment').isDisabled());
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
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment').count() > 0, 15000));
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
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader reuses cached comments when selecting and revisiting articles", { timeout: 45000 }, async () => {
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
    await first.click();
    assert(await waitFor(async () => await firstComments.count() === 30, 15000), `first article reloads; body: ${(await app.page.locator('#comments-content').textContent()).slice(0, 300)}; errors: ${JSON.stringify(app.errors)}`);
    assert.equal(firstRequests(), before, 'revisiting a fresh article does not refetch its comments');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader caches an article with more than twenty discussions", { timeout: 45000 }, async () => {
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
    assert.equal(treeRequests(), before, 'revisiting does not refetch discussions evicted by a small cache');
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
  const slowGets = { key: "HNewhere:settings", ms: 1500, armed: false };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, slowGets, settings: { sources: { hn: true }, autoOpenSidebar: true, annotations: true, updateCheck: false } });
  try {
    await app.page.goto(url);
    const marks = app.page.locator('[data-hnewhere-annotation-overlay] button');
    assert(await waitFor(async () => await marks.count() > 0, 15000), "the discussion initially highlights the article");
    assert(await waitFor(async () => /updated/i.test(await app.page.locator('#header-subtitle').textContent()), 15000), "initial rendering has finished");
    const button = app.page.locator('#browse-home-sync');
    slowGets.armed = true;
    await button.click();
    assert(await waitFor(async () => /checking sources/i.test(await app.page.locator('#header-subtitle').textContent()), 3000), "sync first reports source discovery");
    assert(await app.page.locator('#header-subtitle').evaluate((element) => element.classList.contains('header-subtitle-loading')), "source discovery uses the loading animation");
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000), "discussion sync finishes");
    assert(await waitFor(async () => await marks.count() > 0, 10000), "the refreshed comments still highlight the article");
    assert.doesNotMatch(await app.page.locator('#header-subtitle').textContent(), /loading discussions|rendering comments|annotating link|syncing/i);
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
    await waitFor(async () => await app.page.locator("#comments-content .comment").count() === 4, 15000);
    assert.equal(await app.page.locator("#comments-content .comment").count(), 4, "queued requests must not time out before starting");
    assert.equal(app.requests.filter(({ url }) => url.includes("/api/comments/tree")).length, 4);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
