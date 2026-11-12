import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, STORIES, waitFor } from "./harness.mjs";

for (const tabs of [true, false]) test(`Sidebar recovers live Reddit comments with ${tabs ? 'manager tabs' : 'a popup'} when the archive has none`, { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 2, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A live comment missing from the archive', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [{ ...post, num_comments: 0 }] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [] } },
  ] });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/') body = '<!doctype html><title>Reddit fixture</title>';
    else if (path === '/api/me.json') body = JSON.stringify({ data: { name: 'fixture-user' } });
    else if (path.includes('/comments/')) body = JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment] } }]);
    else body = JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    const button = app.page.locator('#hn-submit-button');
    assert(await waitFor(async () => await button.count() === 1, 15000), 'archive lookup completes without a discussion');
    await button.click();
    assert(await waitFor(async () => (await app.page.locator('#comments-content').textContent()).includes('A live comment missing from the archive'), 20000), 'opening Sidebar finds the signed-in live discussion');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("the Reddit tab identifies its purpose and closes before local comment rendering finishes", { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const sourceText = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const batchSize = 5;\n\t\tlet annotatedAt = 0;';
  assert(sourceText.includes(seam));
  const source = sourceText.replace(seam, `${seam}\n\t\tawait new Promise((resolve) => setTimeout(resolve, 4000));`);
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A live comment', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [{ ...post, num_comments: 0 }] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [] } },
  ] });
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me.json') await new Promise((resolve) => setTimeout(resolve, 1000));
    let body;
    if (path === '/') body = '<!doctype html><title>Reddit fixture</title>';
    else if (path === '/api/me.json') body = JSON.stringify({ data: { name: 'fixture-user' } });
    else if (path.includes('/comments/')) body = JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment] } }]);
    else body = JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    const button = app.page.locator('#hn-submit-button');
    assert(await waitFor(async () => await button.count() === 1, 15000));
    await button.click();
    assert(await waitFor(async () => opened.some((page) => !page.isClosed()) && /Backchannel/i.test(await opened.find((page) => !page.isClosed()).title()), 5000), 'the tab title explains that Backchannel is using Reddit');
    const redditTab = opened.find((page) => !page.isClosed());
    const firstTitle = await redditTab.title();
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.notEqual(await redditTab.title(), firstTitle, 'the tab title animates while the refresh is active');
    assert(await waitFor(async () => await app.page.locator('#comments-content .top-level-comments').count() === 1, 15000), 'local rendering has started');
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 2500), 'the Reddit tab closes before local rendering finishes');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count(), 0, 'the controlled rendering pause is still in effect');
    const composer = app.page.locator('#comments-content .compose-box');
    await composer.locator('.composer-text').fill('Draft while comments render');
    assert(await composer.locator('.compose-send-note').isDisabled(), 'notes remain disabled during rendering');
    assert(await composer.locator('.compose-send-comment').isDisabled(), 'comments remain disabled during rendering');
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count() === 1, 10000));
    assert(await waitFor(async () => !(await composer.locator('.compose-send-comment').isDisabled()), 10000), 'submission becomes available when rendering finishes');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Sidebar Sync closes its Reddit tab after requests, before local rendering completes", { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const sourceText = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const batchSize = 5;\n\t\tlet annotatedAt = 0;';
  assert(sourceText.includes(seam));
  const source = sourceText.replace(seam, `${seam}\n\t\tif (window.__bcSlowRender) await new Promise((resolve) => setTimeout(resolve, 4000));`);
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = (id, body) => ({ kind: 't1', data: { id, body, author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } });
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment('archived', 'Archived comment')] } },
  ] });
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/') body = '<!doctype html><title>Reddit fixture</title>';
    else if (path === '/api/me.json') body = JSON.stringify({ data: { name: 'fixture-user' } });
    else if (path.includes('/comments/')) body = JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment('live', 'Live comment after sync')] } }]);
    else body = JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => /updated/i.test(await app.page.locator('#header-subtitle').textContent()), 15000), 'initial discussion is ready');
    await app.page.evaluate(() => { window.__bcSlowRender = true; });
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(() => opened.length > 0, 10000), 'sync opens the Reddit tab');
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 10000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .top-level-comments').count() === 1, 15000));
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 2500), 'the tab closes while local rendering is paused');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count(), 0);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count() === 1, 10000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("opening a known discussion does not keep Reddit open during its initial local render", { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const sourceText = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const batchSize = 5;\n\t\tlet annotatedAt = 0;';
  assert(sourceText.includes(seam));
  const source = sourceText.replace(seam, `${seam}\n\t\tif (!window.__bcRenderDelayed) { window.__bcRenderDelayed = true; await new Promise((resolve) => setTimeout(resolve, 3000)); }`);
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = (id, body) => ({ kind: 't1', data: { id, body, author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } });
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: false, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment('archived', 'Archived comment')] } },
  ] });
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === '/') body = '<!doctype html><title>Reddit fixture</title>';
    else if (path === '/api/me.json') body = JSON.stringify({ data: { name: 'fixture-user' } });
    else if (path.includes('/comments/')) body = JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment('live', 'Live comment after opening')] } }]);
    else body = JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    const button = app.page.locator('#hn-collapse-button');
    assert(await waitFor(async () => await button.count() === 1, 15000));
    await button.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .top-level-comments').count() === 1, 10000));
    assert.equal(opened.length, 0, 'the background tab is not opened before its Reddit work can start');
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count() === 1, 15000), 'the live refresh still happens after the initial render');
    assert(await waitFor(() => opened.length > 0 && opened.every((page) => page.isClosed()), 10000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("a slow Reddit search does not discard an already discovered live discussion", { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const source = (await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8')).replace('const DISCOVER_CEILING_MS = 12000;', 'const DISCOVER_CEILING_MS = 1200;');
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 2, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'Already discovered live comment', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [{ ...post, num_comments: 0 }] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [] } },
  ] });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/search.json') await new Promise((resolve) => setTimeout(resolve, 1700));
    let body;
    if (path === '/') body = '<!doctype html><title>Reddit fixture</title>';
    else if (path === '/api/me.json') body = JSON.stringify({ data: { name: 'fixture-user' } });
    else if (path.includes('/comments/')) body = JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment] } }]);
    else body = JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    const button = app.page.locator('#hn-submit-button');
    assert(await waitFor(async () => await button.count() === 1, 15000));
    await button.click();
    assert(await waitFor(async () => (await app.page.locator('#comments-content').textContent()).includes('Already discovered live comment'), 12000), 'a later slow search must not erase the first exact match');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("an oversized live thread falls back without losing other live discussions", { timeout: 60000 }, async () => {
  const url = "https://video.example.com/clip";
  const now = Math.floor(Date.now() / 1000);
  const post = (id, subreddit, count) => ({ id, url, title: "A discussion fixture", author: "reader", subreddit, subreddit_name_prefixed: `r/${subreddit}`, permalink: `/r/${subreddit}/comments/${id}/article/`, num_comments: count, created_utc: now - 3600, score: 100 });
  const large = post("bigthread", "news", 2000);
  const small = post("smallthread", "local", 1);
  const archived = { kind: "t1", data: { id: "recovered", author: "reader", body: "Recovered archive comment", parent_id: "t3_bigthread", link_id: "t3_bigthread", created_utc: now - 60, replies: "" } };
  const liveComment = (id, body, parent) => ({ kind: "t1", data: { id, body, author: "reader", parent_id: `t3_${parent}`, link_id: `t3_${parent}`, created_utc: now - 60, score: 10 } });
  const app = await launchApp({
    sharedStore: true,
    handler: "Userscripts",
    tabs: true,
    topHosts: ["www.reddit.com"],
    settings: { sources: { reddit: true, hn: true }, frontPageMode: "sources", updateCheck: false },
    values: { "HNewhere:reddit_read_window_notice": 2 },
    pages: { [url]: { html: "<!doctype html><title>Clip</title><main>Video</main>" } },
    responses: [
      { match: (path) => path.includes("/api/posts/search"), json: { data: [{ ...large, num_comments: 0 }, small] } },
      { match: (path) => path.includes("/api/posts/ids"), json: { data: [large] } },
      { match: (path) => path.includes("/api/comments/tree"), json: { data: [archived] } },
    ],
  });
  const opened = [];
  app.context.on("page", (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route("https://www.reddit.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path === "/") body = "<!doctype html><title>Reddit fixture</title>";
    else if (path === "/api/me.json") body = JSON.stringify({ data: { name: "fixture-user", modhash: "private-fixture-token" } });
    else if (path.includes("/comments/")) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const largeThread = path.includes("bigthread");
      const item = largeThread ? liveComment("huge", "x".repeat(2000001), large.id) : liveComment("small", "Other live comment", small.id);
      body = JSON.stringify([{ data: { children: [{ kind: "t3", data: largeThread ? large : small }] } }, { data: { children: [item] } }]);
    } else body = JSON.stringify({ data: { children: [{ kind: "t3", data: large }, { kind: "t3", data: small }] } });
    await route.fulfill({ status: 200, contentType: path === "/" ? "text/html" : "application/json", body });
  });
  try {
    await app.page.goto("https://backchnnl.app/");
    await app.page.locator("#app-list-sync").click();
    assert(await waitFor(async () => await app.page.locator("#app-list-body .browse-title-link", { hasText: large.title }).count() > 0, 15000));
    assert(await waitFor(() => opened.length > 0 && opened.every((page) => page.isClosed()), 15000));
    await app.page.locator("#app-list-body .browse-title-link", { hasText: large.title }).first().click();
    assert(await waitFor(async () => await app.page.locator("#panel.app-docked > .discussion-progress-strip").count() === 1, 15000), "Reader shows progress while discussions load");
    assert.doesNotMatch(await app.page.locator("#comments-content").textContent(), /keep the reddit tab open/i);
    assert(await waitFor(async () => (await app.page.locator("#comments-content").textContent()).includes("Recovered archive comment"), 20000));
    assert.match(await app.page.locator("#comments-content").textContent(), /Other live comment/, "a local size limit must not hide the next discussion");
    assert(!(app.store.get("HNewhere:reddit_poll")?.until > Date.now()), "a local size limit is not a server rate limit");
    assert(!JSON.stringify([...app.store.values()]).includes("private-fixture-token"), "private Reddit credentials stay in the Reddit tab");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
