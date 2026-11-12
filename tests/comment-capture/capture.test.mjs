import test from "node:test";
import assert from "node:assert/strict";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

async function assertCaptured(app, fixture) {
  const selector = '#comments-content .comment[data-story-id="fixture0"]';
  await waitFor(async () => await app.page.locator(selector).count() === 140, 12000);
  assert.equal(await app.page.locator(selector).count(), 140, "large discussion must render every available comment");
  for (let index = 0; index < fixture.posts.length; index++) {
    const actual = await app.page.locator(`#comments-content .comment[data-story-id="${fixture.posts[index].id}"]`).count();
    assert.equal(actual, fixture.sizes[index], `discussion ${index} lost or duplicated comments`);
  }
  const root = app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]');
  assert.equal(await root.locator('.children .comment[data-comment-id="reddit:reply0x0"]').count(), 1, "replies stay under their parent");
  assert((await root.textContent()).includes("Root comment 0"), "readable text survives a deleted account");
  const warning = await app.page.locator("#comments-content .discussion-load-warning").textContent();
  assert.match(warning, /archive returned 140 comments/i, "a larger reported total is explained");
  assert(app.requests.some(({ url }) => url.includes("/api/comments/tree") && new URL(url).searchParams.get("link_id") === "t3_fixture0"), "the complete archive tree is requested");
  assert.deepEqual(app.errors, [], "no uncaught browser errors");
}

const url = STORIES[0].url;

test("Sidebar captures six discussions and every archived comment", { timeout: 60000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({
    appHost: new URL(url).hostname,
    sharedStore: true,
    handler: "Userscripts",
    settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false },
    values: { "HNewhere:reddit_read_window_notice": 2 },
    responses: fixture.responses,
  });
  try {
    await app.page.goto(url);
    await assertCaptured(app, fixture);
  } finally {
    await app.browser.close();
  }
});

test("Reader captures the same discussions when opened from another source", { timeout: 60000 }, async () => {
  const fixture = discussionFixture(url);
  const app = await launchApp({
    sharedStore: true,
    handler: "Tampermonkey",
    settings: { sources: { hn: true, reddit: true }, frontPageMode: "sources", updateCheck: false },
    values: { "HNewhere:reddit_tier": { tier: "archive", timestamp: Date.now() } },
    responses: fixture.responses,
  });
  try {
    await app.page.goto("https://backchnnl.app/");
    await app.page.locator("#app-list-body .browse-title-link", { hasText: STORIES[0].title }).first().click();
    await assertCaptured(app, fixture);
    assert(await app.page.locator('#comments-content .comment[data-story-id="9001"]').count() > 0, "the Hacker News discussion is also shown");
  } finally {
    await app.browser.close();
  }
});

test("a large thread renders 1,600 distinct comments without truncation", { timeout: 90000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 400, replyRoots: 400 });
  const app = await launchApp({
    appHost: new URL(url).hostname,
    sharedStore: true,
    handler: "Userscripts",
    settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false },
    values: { "HNewhere:reddit_read_window_notice": 2 },
    responses: fixture.responses,
  });
  try {
    await app.page.goto(url);
    const comments = app.page.locator('#comments-content .comment[data-story-id="fixture0"]');
    assert(await waitFor(async () => await comments.count() === 1600, 60000), "large thread did not finish rendering");
    const keys = await comments.evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId));
    assert.equal(new Set(keys).size, 1600, "comments must not be duplicated or dropped");
    assert(await waitFor(async () => await app.page.locator("#comments-content .live-bookend-close").count() === 1, 10000), "rendering should complete after the live discussion");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
