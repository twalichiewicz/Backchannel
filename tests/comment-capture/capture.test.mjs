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
  assert.equal(await app.page.locator("#comments-content .discussion-load-warning").count(), 0, "a reported count mismatch alone should not warn the user");
  assert(app.requests.some(({ url }) => url.includes("/api/comments/tree") && new URL(url).searchParams.get("link_id") === "t3_fixture0"), "the complete archive tree is requested");
  assert.deepEqual(app.errors, [], "no uncaught browser errors");
}

const url = STORIES[0].url;

test("Sidebar recovers exact Lemmy and Bluesky discussions already known to Reader", { timeout: 30000 }, async () => {
  const uri = 'at://did:plc:fixture/app.bsky.feed.post/article';
  const bskyPost = { uri, author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, embed: { external: { uri: url } }, record: { text: 'A Bluesky post already in Reader', createdAt: new Date().toISOString() }, replyCount: 0, likeCount: 1 };
  const lemmyPost = { post: { id: 321, url, name: STORIES[0].title, creator_id: 1, published: new Date().toISOString() }, community: { name: 'technology', actor_id: 'https://lemmy.world/c/technology' }, creator: { id: 1, name: 'reader' }, counts: { comments: 1, score: 2 } };
  const lemmyComment = { comment: { id: 99, content: 'A Lemmy comment already in Reader', path: '0.99', published: new Date().toISOString() }, creator: { id: 2, name: 'reader' }, counts: { score: 1 } };
  const bskyStory = { source: 'bsky', id: uri, url, title: STORIES[0].title, descendants: 0 };
  const lemmyStory = { source: 'lemmy', id: 321, url, title: STORIES[0].title, descendants: 1 };
  const changedStory = { source: 'lemmy', id: 322, url, title: STORIES[0].title, descendants: 1 };
  const unrelated = { source: 'lemmy', id: 999, url: 'https://framed.example.com/unrelated', title: 'Other article', descendants: 1 };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: false, bsky: true, lemmy: true }, autoOpenSidebar: true, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false }, values: {
    'HNewhere:frontpage_feed:technology/lemmy/technology@lemmy.world': { timestamp: Date.now(), stories: [lemmyStory, changedStory, unrelated] },
    'HNewhere:frontpage_feed:technology/bsky/at://did:plc:cndfx4udwgvpjaakvxvh7wm5/app.bsky.feed.generator/flipboard-tech': { timestamp: Date.now(), stories: [bskyStory] },
  }, responses: [
    { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
    { match: (path) => path.includes('/app.bsky.feed.getPosts'), json: { posts: [bskyPost] } },
    { match: (path) => path.includes('/app.bsky.feed.getPostThread'), json: { thread: { post: bskyPost, replies: [] } } },
    { match: (path) => path.includes('/api/v3/search'), json: { posts: [] } },
    { match: (path) => path.includes('/api/v3/post?id=321'), json: { post_view: lemmyPost } },
    { match: (path) => path.includes('/api/v3/post?id=322'), json: { post_view: { ...lemmyPost, post: { ...lemmyPost.post, id: 322, url: unrelated.url } } } },
    { match: (path) => path.includes('/api/v3/comment/list?post_id=321'), json: { comments: [lemmyComment] } },
  ] });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content').count() > 0 && (await app.page.locator('#comments-content').textContent()).includes('A Lemmy comment already in Reader'), 12000), 'the exact cached Lemmy story is recovered');
    assert.match(await app.page.locator('#comments-content').textContent(), /A Bluesky post already in Reader/, 'Reader’s zero-reply Bluesky post is also recovered');
    assert(!app.requests.some(({ url }) => url.includes('/api/v3/post?id=999')), 'an unrelated article never becomes a discussion match');
    assert(!app.requests.some(({ url }) => url.includes('/api/v3/comment/list?post_id=322')), 'a cached story is rejected if its current article URL changed');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader feed discoveries remain available on the article in Sidebar", { timeout: 45000 }, async () => {
  const uri = 'at://did:plc:fixture/app.bsky.feed.post/article';
  const bskyPost = { uri, author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, embed: { external: { uri: url, title: STORIES[0].title } }, record: { text: 'Bluesky feed comment', createdAt: new Date().toISOString() }, replyCount: 0, likeCount: 1, indexedAt: new Date().toISOString() };
  const lemmyPost = { post: { id: 321, url, name: STORIES[0].title, creator_id: 1, published: new Date().toISOString() }, community: { name: 'technology', actor_id: 'https://lemmy.world/c/technology' }, creator: { id: 1, name: 'reader' }, counts: { comments: 1, score: 2 } };
  const lemmyComment = { comment: { id: 99, content: 'Lemmy feed comment', path: '0.99', published: new Date().toISOString() }, creator: { id: 2, name: 'reader' }, counts: { score: 1 } };
  const app = await launchApp({ sharedStore: true, topHosts: [new URL(url).hostname], settings: { sources: { hn: false, bsky: true, lemmy: true }, autoOpenSidebar: true, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false }, responses: [
    { match: (path) => path.includes('/api/v3/post/list'), json: { posts: [lemmyPost] } },
    { match: (path) => path.includes('/app.bsky.feed.getFeed'), json: { feed: [{ post: bskyPost }] } },
    { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
    { match: (path) => path.includes('/app.bsky.feed.getPosts'), json: { posts: [bskyPost] } },
    { match: (path) => path.includes('/app.bsky.feed.getPostThread'), json: { thread: { post: bskyPost, replies: [] } } },
    { match: (path) => path.includes('/api/v3/search'), json: { posts: [] } },
    { match: (path) => path.includes('/api/v3/post?id=321'), json: { post_view: lemmyPost } },
    { match: (path) => path.includes('/api/v3/comment/list?post_id=321'), json: { comments: [lemmyComment] } },
  ] });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click({ timeout: 15000 });
    assert(await waitFor(async () => (await app.page.locator('#comments-content').textContent()).includes('Lemmy feed comment'), 15000));
    assert.match(await app.page.locator('#comments-content').textContent(), /Bluesky feed comment/);
    const article = await app.context.newPage();
    await article.goto(url);
    assert(await waitFor(async () => await article.locator('#comments-content').count() > 0 && (await article.locator('#comments-content').textContent()).includes('Lemmy feed comment'), 15000));
    assert.match(await article.locator('#comments-content').textContent(), /Bluesky feed comment/);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("a cached Bluesky post is not recovered if it no longer links the article", { timeout: 30000 }, async () => {
  const uri = 'at://did:plc:fixture/app.bsky.feed.post/article';
  const story = { source: 'bsky', id: uri, url, title: STORIES[0].title, descendants: 0 };
  const changed = { uri, author: { handle: 'reader.bsky.social' }, embed: { external: { uri: 'https://framed.example.com/unrelated' } }, record: { text: 'Different article', createdAt: new Date().toISOString() }, replyCount: 0 };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: false, bsky: true }, autoOpenSidebar: true, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false }, values: {
    'HNewhere:frontpage_feed:technology/bsky/at://did:plc:cndfx4udwgvpjaakvxvh7wm5/app.bsky.feed.generator/flipboard-tech': { timestamp: Date.now(), stories: [story] },
  }, responses: [
    { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
    { match: (path) => path.includes('/app.bsky.feed.getPosts'), json: { posts: [changed] } },
  ] });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#hn-submit-button').count() === 1, 12000), 'a changed link must not produce a discussion');
    assert(!app.requests.some(({ url }) => url.includes('/app.bsky.feed.getPostThread')), 'the unrelated post is not loaded as a comment');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Sidebar recovers a matching Lemmy discussion from a cached source feed", { timeout: 30000 }, async () => {
  const story = { source: 'lemmy', id: 321, url, title: STORIES[0].title, descendants: 1 };
  const postView = { post: { id: 321, url, name: STORIES[0].title, creator_id: 1, published: new Date().toISOString() }, community: { name: 'technology', actor_id: 'https://lemmy.world/c/technology' }, creator: { id: 1, name: 'reader' }, counts: { comments: 1 } };
  const comment = { comment: { id: 99, content: 'A source feed discussion', path: '0.99', published: new Date().toISOString() }, creator: { id: 2, name: 'reader' }, counts: { score: 1 } };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: false, lemmy: true }, autoOpenSidebar: true, frontPageMode: 'sources', updateCheck: false }, values: {
    'HNewhere:frontpage_cache:lemmy': { timestamp: Date.now(), rows: [{ story, also: [] }] },
  }, responses: [
    { match: (path) => path.includes('/api/v3/search'), json: { posts: [] } },
    { match: (path) => path.includes('/api/v3/post?id=321'), json: { post_view: postView } },
    { match: (path) => path.includes('/api/v3/comment/list?post_id=321'), json: { comments: [comment] } },
  ] });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="lemmy:99"]').count() === 1, 12000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

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

test("Sidebar shows quote annotations while a large discussion is still rendering", { timeout: 90000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 400, replyRoots: 400 });
  fixture.trees.get('fixture0')[100].data.body = '> Manual allocation avoids the pause entirely but transfers the burden onto every caller in the system, which is a trade most teams make without noticing.\n\nA useful point.';
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler: "Userscripts", settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, annotations: true, updateCheck: false }, values: { "HNewhere:reddit_read_window_notice": 2 }, responses: fixture.responses });
  try {
    await app.page.goto(url);
    const comments = app.page.locator('#comments-content .comment[data-story-id="fixture0"]');
    assert(await waitFor(async () => await app.page.locator('[data-hnewhere-annotation-overlay] [title="Show the comments quoting this"]').count() > 0, 60000), "a quote highlight appears on the article");
    assert((await comments.count()) < 1600, "annotations should not wait for every comment to render");
    assert.doesNotMatch(await app.page.locator('#header-subtitle').textContent(), /loading comments/i, "the header identifies rendering after requests finish");
    assert(await waitFor(async () => await comments.count() === 1600, 60000), "rendering still completes");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
