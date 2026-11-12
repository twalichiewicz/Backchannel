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
      assert(await waitFor(async () => await app.page.locator('#comments-content .page-header-disclosure').count() > 0, 15000), "missing sources menu");
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
    assert(await waitFor(async () => await button.count() > 0, 15000));
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
    assert(await loading.locator('.discussion-skeleton-comment').count() >= 2, "the skeleton resembles a discussion");
    assert.equal(await loading.locator('[role="progressbar"]').count(), 0, "Sidebar does not duplicate the status in its body");
    const subtitle = app.page.locator('#header-subtitle');
    assert(await waitFor(async () => /loading comments \([1-5] of 6\)/i.test(await subtitle.textContent()), 10000), "header progress advances while discussions remain");
    assert(await waitFor(async () => await loading.count() === 0, 15000), "the skeleton is removed after loading");
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="fixture0"]').count() === 140, 10000), "all comments render after loading");
    assert(await waitFor(async () => !/loading comments/i.test(await subtitle.textContent()), 10000), "the header stops reporting comment loading after rendering");
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

test("syncing a discussion restores its article highlights and finishes the header status", { timeout: 30000 }, async () => {
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: true, annotations: true, updateCheck: false } });
  try {
    await app.page.goto(url);
    const marks = app.page.locator('[data-hnewhere-annotation-overlay] button');
    assert(await waitFor(async () => await marks.count() > 0, 15000), "the discussion initially highlights the article");
    const button = app.page.locator('#browse-home-sync');
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000), "discussion sync finishes");
    assert(await waitFor(async () => await marks.count() > 0, 10000), "the refreshed comments still highlight the article");
    assert.doesNotMatch(await app.page.locator('#header-subtitle').textContent(), /loading comments|displaying comments|syncing/i);
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
