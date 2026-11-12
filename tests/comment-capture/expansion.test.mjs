import test from "node:test";
import assert from "node:assert/strict";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

const url = STORIES[0].url;
const now = Math.floor(Date.now() / 1000);
const comment = (id, parent, body, replies = "") => ({ kind: "t1", data: { id, parent_id: parent, link_id: "t3_fixture0", author: "reader", body, score: 1, created_utc: now, replies } });

async function openArchive(initial, expanded, { handler = "Userscripts", expandedDelay = 0 } = {}) {
  const fixture = discussionFixture(url);
  const responses = [
    { match: (path) => path.includes("/api/posts/search"), json: { data: [fixture.posts[0]] } },
    { match: (path) => path.includes("/api/comments/tree") && new URL(path).searchParams.get("limit") === "25000", delay: expandedDelay, json: { data: expanded } },
    { match: (path) => path.includes("/api/comments/tree"), json: { data: initial } },
  ];
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler, settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false }, values: { "HNewhere:reddit_read_window_notice": 2, "HNewhere:reddit_tier": { tier: "archive", timestamp: Date.now() } }, responses });
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
    assert(await waitFor(async () => await app.page.locator("#comments-content .comment[data-comment-id]").count() === 101, 15000));
    await more.click();
    assert(await waitFor(async () => await app.page.locator("#comments-content .comment[data-comment-id]").count() === 121, 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:extra119"]').count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test('expanded replies remain available to another page using the shared discussion', { timeout: 45000 }, async () => {
  const root = comment('root', 't3_fixture0', 'First comment');
  const ids = Array.from({ length: 101 }, (_, index) => `extra${index}`);
  const initial = [root, { kind: 'more', data: { children: ids, count: ids.length } }];
  const expanded = [root, ...ids.map((id) => comment(id, 't3_fixture0', `Shared expanded reply ${id}`))];
  const app = await openArchive(initial, expanded, { handler: 'Tampermonkey' });
  try {
    const more = app.page.locator('#comments-content .more-replies');
    await more.waitFor({ timeout: 15000 });
    await more.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:extra99"]').count() === 1, 10000));
    assert(await waitFor(() => Boolean(app.store.get('HNewhere:thread_cache:reddit:fixture0')?.comments?.['reddit:extra99']), 5000), 'expanded comments are published to the shared discussion');
    const other = await app.context.newPage();
    await other.goto(url);
    assert(await waitFor(async () => await other.locator('#comments-content .comment[data-comment-id="reddit:extra99"]').count() === 1, 10000));
    const remaining = other.locator('#comments-content .more-replies');
    assert.match(await remaining.textContent(), /^1 more reply/, 'only the remaining reply is offered');
    await remaining.click();
    assert(await waitFor(async () => await other.locator('#comments-content .comment[data-comment-id="reddit:extra100"]').count() === 1, 10000));
    await other.locator('#comment-sort').selectOption('newest');
    assert(await waitFor(async () => await other.locator('#comments-content .discussion-loading').count() === 0 && await other.locator('#comments-content .comment[data-comment-id]').count() === 102, 15000), 'sorting keeps all replies expanded from the shared cache');
    assert.equal(await remaining.count(), 0, 'already loaded replies are not offered again');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test("sync preserves already expanded replies and keeps the remaining replies loadable", { timeout: 45000 }, async () => {
  const root = comment("root", "t3_fixture0", "First comment");
  const ids = Array.from({ length: 120 }, (_, index) => `extra${index}`);
  const initial = [root, { kind: "more", data: { children: ids, count: 120 } }];
  const expanded = [root, ...ids.map((id) => comment(id, "t3_fixture0", `Comment ${id}`))];
  const app = await openArchive(initial, expanded, { handler: "Tampermonkey" });
  try {
    const more = app.page.locator('#comments-content .more-replies');
    await more.waitFor({ timeout: 15000 });
    await more.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() === 101, 15000));
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(async () => await app.page.locator('#browse-home-sync').getAttribute('aria-busy') !== 'true', 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id]').count(), 101, 'expanded comments remain visible after sync');
    assert.match(await more.textContent(), /^20 more replies/, 'only the remaining replies are offered');
    await more.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() === 121, 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:extra119"]').count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("a reply expansion interrupted by sync remains retryable", { timeout: 45000 }, async () => {
  const root = comment("root", "t3_fixture0", "First comment");
  const ids = ["extra0", "extra1"];
  const initial = [root, { kind: "more", data: { children: ids, count: 2 } }];
  const expanded = [root, ...ids.map((id) => comment(id, "t3_fixture0", `Comment ${id}`))];
  const app = await openArchive(initial, expanded, { handler: "Tampermonkey", expandedDelay: 1600 });
  try {
    const more = app.page.locator('#comments-content .more-replies');
    await more.waitFor({ timeout: 15000 });
    await more.click();
    assert(await more.isDisabled());
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(async () => await app.page.locator('#browse-home-sync').getAttribute('aria-busy') !== 'true', 15000));
    assert(await waitFor(async () => await more.count() === 1 && !(await more.isDisabled()), 10000), 'the interrupted expansion can be retried');
    await more.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() === 3, 15000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("sync keeps expanded Bluesky replies without restoring an exhausted more button", { timeout: 45000 }, async () => {
  const uri = (index) => `at://did:plc:fixture/app.bsky.feed.post/depth${index}`;
  const post = (index, replyCount = 1) => ({ uri: uri(index), author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, embed: index === 0 ? { external: { uri: url } } : undefined, record: { text: `Bluesky depth ${index}`, createdAt: new Date().toISOString() }, replyCount, likeCount: 1 });
  let chain = { post: post(10), replies: [] };
  for (let index = 9; index >= 0; index--) chain = { post: post(index), replies: [chain] };
  const extra = { post: post(11, 0), replies: [] };
  const story = { source: 'bsky', id: uri(0), url, title: STORIES[0].title, descendants: 1 };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: false, bsky: true }, autoOpenSidebar: true, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false }, values: {
    'HNewhere:frontpage_feed:technology/bsky/at://did:plc:cndfx4udwgvpjaakvxvh7wm5/app.bsky.feed.generator/flipboard-tech': { timestamp: Date.now(), stories: [story] },
  }, responses: [
    { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
    { match: (path) => path.includes('/app.bsky.feed.getPosts'), json: { posts: [post(0)] } },
    { match: (path) => path.includes('/app.bsky.feed.getPostThread') && new URL(path).searchParams.get('uri') === uri(0), json: { thread: chain } },
    { match: (path) => path.includes('/app.bsky.feed.getPostThread') && new URL(path).searchParams.get('uri') === uri(10), json: { thread: { post: post(10), replies: [extra] } } },
    { match: (path) => path.includes('/app.bsky.feed.getPostThread') && new URL(path).searchParams.get('uri') === uri(11), json: { thread: extra } },
  ] });
  try {
    await app.page.goto(url);
    const more = app.page.locator('#comments-content .more-replies');
    await more.waitFor({ timeout: 15000 });
    await more.click();
    assert(await waitFor(async () => (await app.page.locator('#comments-content').textContent()).includes('Bluesky depth 11'), 15000));
    const sync = app.page.locator('#browse-home-sync');
    await sync.click();
    assert(await waitFor(async () => await sync.getAttribute('aria-busy') !== 'true', 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id]').count(), 12);
    assert.equal(await more.count(), 0, 'an already expanded reply is not offered a second time');
    await app.page.locator('#comment-sort').selectOption('newest');
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 5000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() === 12, 15000));
    assert.equal(await more.count(), 0, 'sorting does not restore the exhausted button');
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
    assert.equal(await app.page.locator("#comments-content .comment[data-comment-id]").count(), 3);
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
    const disclosure = app.page.locator("#comments-content .page-header-disclosure");
    assert(await waitFor(async () => await disclosure.count() === 1, 15000), "a single affected discussion still has a sources menu");
    assert.match(await disclosure.textContent(), /1\* discussion/);
    await disclosure.click();
    assert.match(await app.page.locator("#comments-content .discussion-source-status").textContent(), /only some comments/i);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
