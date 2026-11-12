import test from "node:test";
import assert from "node:assert/strict";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

const url = STORIES[0].url;
const now = Math.floor(Date.now() / 1000);
const comment = (id, parent, body, replies = "") => ({ kind: "t1", data: { id, parent_id: parent, link_id: "t3_fixture0", author: "reader", body, score: 1, created_utc: now, replies } });

async function openArchive(initial, expanded) {
  const fixture = discussionFixture(url);
  const responses = [
    { match: (path) => path.includes("/api/posts/search"), json: { data: [fixture.posts[0]] } },
    { match: (path) => path.includes("/api/comments/tree") && new URL(path).searchParams.get("limit") === "25000", json: { data: expanded } },
    { match: (path) => path.includes("/api/comments/tree"), json: { data: initial } },
  ];
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler: "Userscripts", settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false }, values: { "HNewhere:reddit_read_window_notice": 2 }, responses });
  await app.page.goto(url);
  return app;
}

test("all 120 omitted roots remain loadable across multiple batches", { timeout: 45000 }, async () => {
  const root = comment("root", "t3_fixture0", "First comment");
  const ids = Array.from({ length: 120 }, (_, index) => `extra${index}`);
  const initial = [root, { kind: "more", data: { children: ids, count: 0 } }];
  const expanded = [root, ...ids.map((id) => comment(id, "t3_fixture0", `Comment ${id}`))];
  const app = await openArchive(initial, expanded);
  try {
    const more = app.page.locator("#comments-content .more-replies");
    await more.waitFor({ timeout: 15000 });
    assert.match(await more.textContent(), /^120 more replies/, "known IDs are not labeled as zero");
    await more.click();
    assert(await waitFor(async () => await app.page.locator("#comments-content .comment").count() === 101, 15000));
    await more.click();
    assert(await waitFor(async () => await app.page.locator("#comments-content .comment").count() === 121, 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:extra119"]').count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("expanding an archived reply preserves its nested descendants", { timeout: 45000 }, async () => {
  const more = { kind: "more", data: { children: ["child"], count: 2, parent_id: "t1_root" } };
  const initial = [comment("root", "t3_fixture0", "Parent", { kind: "Listing", data: { children: [more] } })];
  const grandchild = comment("grandchild", "t1_child", "Nested reply");
  const expanded = [comment("child", "t1_root", "Expanded reply", { kind: "Listing", data: { children: [grandchild] } })];
  const app = await openArchive(initial, expanded);
  try {
    const button = app.page.locator("#comments-content .more-replies");
    await button.waitFor({ timeout: 15000 });
    await button.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:grandchild"]').count() === 1, 15000));
    const root = app.page.locator('#comments-content .comment[data-comment-id="reddit:root"]');
    assert.equal(await root.locator('.comment[data-comment-id="reddit:grandchild"]').count(), 1);
    assert.equal(await app.page.locator("#comments-content .comment").count(), 3);
    assert(app.requests.some(({ url }) => url.includes("/api/comments/tree") && new URL(url).searchParams.get("parent_id") === "t1_root"));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("unexpandable missing replies are disclosed", { timeout: 30000 }, async () => {
  const initial = [comment("root", "t3_fixture0", "Parent"), { kind: "more", data: { children: [], count: 3 } }];
  const app = await openArchive(initial, []);
  try {
    assert(await waitFor(async () => await app.page.locator("#comments-content .discussion-load-warning").count() === 1, 15000));
    assert.match(await app.page.locator("#comments-content .discussion-load-warning").textContent(), /only some comments/i);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
