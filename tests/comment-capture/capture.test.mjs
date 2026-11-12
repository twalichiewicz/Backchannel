import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, STORIES, waitFor } from "./harness.mjs";
import { discussionFixture } from "./fixtures.mjs";

test('Backchannel starts on a page without randomUUID', { timeout: 30000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const source = `Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });\n${original}`;
  const url = 'http://insecure.example.com/post';
  const app = await launchApp({ source, appHost: 'insecure.example.com', sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: true, updateCheck: false } });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9007"]').count() === 3, 15000), 'discussion loading works without the secure-context UUID API');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

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

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync keeps existing comments and applies changed and new comments in place`, { timeout: 60000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 12, replyRoots: 2 });
  const response = {
    match: (path) => path.includes('/api/comments/') && new URL(path).searchParams.get('link_id')?.replace(/^t3_/, '') === 'fixture0',
    json: { data: fixture.trees.get('fixture0') },
    delay: 0,
  };
  const newDiscussion = { ...fixture.posts[1], id: 'newdiscussion', subreddit: 'newcommunity', subreddit_name_prefixed: 'r/newcommunity', permalink: '/r/newcommunity/comments/newdiscussion/article/', num_comments: 1 };
  const newDiscussionResponse = { match: (path) => path.includes('/api/comments/tree') && new URL(path).searchParams.get('link_id') === 't3_newdiscussion', json: { data: [{ kind: 't1', data: { id: 'newdiscussioncomment', body: 'A newly discovered discussion', author: 'reader', parent_id: 't3_newdiscussion', link_id: 't3_newdiscussion', created_utc: Math.floor(Date.now() / 1000), replies: '' } }] } };
  const sidebar = mode === 'Sidebar';
  const app = await launchApp({
    ...(sidebar ? { appHost: new URL(url).hostname } : {}),
    sharedStore: true,
    handler: 'Tampermonkey',
    settings: { sources: { hn: !sidebar, reddit: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false },
    values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } },
    responses: [response, newDiscussionResponse, ...fixture.responses],
  });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const root = app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]');
    const retained = app.page.locator('#comments-content .comment[data-comment-id="reddit:root1"]');
    assert(await waitFor(async () => await root.count() === 1 && await retained.count() === 1 && await root.locator('.reply-link').count() >= 1, 15000));
    await root.evaluate((element) => { window.__syncOriginal = element; });
    await root.locator('.reply-link').first().click();
    const draft = root.locator('.reply-composer textarea').first();
    await draft.fill('A reply drafted before syncing');
    const updated = structuredClone(fixture.trees.get('fixture0'));
    updated[0].data.body = 'This existing comment was edited';
    updated[0].data.author = 'updated_author';
    updated[0].data.replies.data.children.push({ kind: 't1', data: { id: 'newreply', body: 'A new reply after sync', author: 'reader', parent_id: 't1_root0', link_id: 't3_fixture0', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    updated.splice(1, 1);
    updated.push({ kind: 't1', data: { id: 'newroot', body: 'A new root after sync', author: 'reader', parent_id: 't3_fixture0', link_id: 't3_fixture0', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    fixture.posts[0].title = 'Updated discussion title';
    fixture.posts.push(newDiscussion);
    response.json = { data: updated };
    response.delay = 1200;
    const before = app.requests.filter(({ url }) => response.match(url)).length;
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await button.click();
    assert(await waitFor(() => app.requests.filter(({ url }) => response.match(url)).length > before, 12000), 'refresh has requested the updated thread');
    assert.equal(await root.count(), 1, 'existing comments remain visible while syncing');
    assert.equal(await app.page.locator('#comments-content .discussion-loading').count(), 0, 'sync does not replace existing comments with a skeleton');
    assert.equal(await draft.inputValue(), 'A reply drafted before syncing');
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 20000));
    assert(await waitFor(async () => (await root.textContent()).includes('This existing comment was edited'), 15000), 'edits are reflected');
    assert(await root.evaluate((element) => element === window.__syncOriginal), 'the existing comment remains the same DOM node');
    assert.match(await root.locator('.comment-author').first().textContent(), /updated_author/, 'changed comment metadata is reflected');
    assert.equal(await draft.inputValue(), 'A reply drafted before syncing', 'the open reply and its draft are preserved');
    assert.equal(await retained.count(), 1, 'a comment omitted by the refreshed response is not discarded');
    assert.equal(await root.locator('.comment[data-comment-id="reddit:newreply"]').count(), 1, 'a new nested reply is added');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:newroot"]').count(), 1, 'a new root comment is added');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:newdiscussioncomment"]').count(), 1, 'a newly discovered discussion is added');
    assert.match(await app.page.locator('#comments-content .submission-detail[data-discussion-key="reddit:fixture0"] .story-title').textContent(), /Updated discussion title/, 'updated discussion details are reflected');
    response.status = 503;
    response.delay = 100;
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 20000));
    assert.equal(await root.count(), 1, 'a failed refresh keeps previously loaded comments');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:newroot"]').count(), 1, 'a failed refresh keeps comments from the prior successful sync');
    const sourceMenu = app.page.locator(sidebar ? '#comments-content .page-header-disclosure' : '#app-discussion-meta .page-header-disclosure');
    await sourceMenu.click();
    const menu = app.page.locator(sidebar ? '#comments-content .source-menu' : '#app-discussion-meta .source-menu');
    assert.equal(await menu.locator('[data-discussion-key="reddit:newdiscussion"]').count(), 1, 'the new discussion appears in the Sources menu');
    const status = app.page.locator(sidebar ? '#comments-content .source-menu-entry' : '#app-discussion-meta .source-menu-entry').filter({ has: app.page.locator('[data-discussion-key="reddit:fixture0"]') });
    assert.match(await status.locator('.discussion-source-status').textContent(), /couldn't refresh.*previously loaded/i, 'the affected source explains that the existing comments are retained');
    await sourceMenu.click();
    await app.page.locator('#comment-sort').selectOption('newest');
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 5000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    assert(await waitFor(async () => await root.count() === 1 && await retained.count() === 1 && await app.page.locator('#comments-content .comment[data-comment-id="reddit:newroot"]').count() === 1, 15000), 'sorting reuses the retained and newly synced comments');
    assert.match(await root.textContent(), /This existing comment was edited/);
    await sourceMenu.click();
    assert.match(await status.locator('.discussion-source-status').textContent(), /couldn't refresh.*previously loaded/i, 'sorting retains the failed-refresh status');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} refreshes after posting without replacing existing comments`, { timeout: 45000 }, async () => {
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'function reloadDiscussion(ui, stories) {';
  assert(original.includes(seam));
  const source = original.replace(seam, `window.__postSubmitRefresh = () => reloadDiscussion(sidebarUI, renderedDiscussions);\n\t${seam}`);
  const fixture = discussionFixture(url, { rootCount: 4, replyRoots: 0 });
  const sidebar = mode === 'Sidebar';
  const app = await launchApp({ source, ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: !sidebar, reddit: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } }, responses: fixture.responses });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const existing = app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]');
    assert(await waitFor(async () => await existing.count() === 1 && await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    await existing.evaluate((element) => { window.__postRefreshOriginal = element; });
    fixture.trees.get('fixture0').push({ kind: 't1', data: { id: 'posted', body: 'A newly posted comment', author: 'reader', parent_id: 't3_fixture0', link_id: 't3_fixture0', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    await app.page.evaluate(() => window.__postSubmitRefresh());
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:posted"]').count() === 1, 15000));
    assert(await existing.evaluate((element) => element === window.__postRefreshOriginal), 'the original comment remains in place');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync preserves Hacker News comments missing from a refresh`, { timeout: 45000 }, async () => {
  const sidebar = mode === 'Sidebar';
  const now = Math.floor(Date.now() / 1000);
  const ids = Array.from({ length: 30 }, (_, index) => 900100 + index);
  const story = { match: (path) => path.endsWith('/v0/item/9001.json'), json: { id: 9001, type: 'story', by: 'reader', title: STORIES[0].title, url, score: 100, time: now - 3600, descendants: 30, kids: ids } };
  const edit = { match: (path) => path.endsWith('/v0/item/900100.json'), json: { id: 900100, type: 'comment', by: 'reader', parent: 9001, time: now - 60, text: 'Original Hacker News comment', kids: [] } };
  const missing = { match: (path) => path.endsWith('/v0/item/900101.json'), json: { id: 900101, type: 'comment', by: 'reader', parent: 9001, time: now - 60, text: 'Previously loaded Hacker News comment', kids: [] } };
  const addition = { match: (path) => path.endsWith('/v0/item/900199.json'), json: { id: 900199, type: 'comment', by: 'reader', parent: 9001, time: now, text: 'New Hacker News comment', kids: [] } };
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, responses: [story, edit, missing, addition] });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const changed = app.page.locator('#comments-content .comment[data-comment-id="hn:900100"]');
    const retained = app.page.locator('#comments-content .comment[data-comment-id="hn:900101"]');
    assert(await waitFor(async () => await changed.count() === 1 && await retained.count() === 1, 15000));
    await changed.evaluate((element) => { window.__hnSyncOriginal = element; });
    story.json = { ...story.json, kids: [...ids.filter((id) => id !== 900101), 900199] };
    edit.json = { ...edit.json, text: 'Edited Hacker News comment' };
    missing.json = { id: 900101, type: 'comment', deleted: true };
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    assert.match(await changed.textContent(), /Edited Hacker News comment/);
    assert(await changed.evaluate((element) => element === window.__hnSyncOriginal));
    assert.match(await retained.textContent(), /Previously loaded Hacker News comment/);
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="hn:900199"]').count(), 1);
    await app.page.locator('#comment-sort').selectOption('newest');
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 5000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    assert(await waitFor(async () => await retained.count() === 1, 15000), 'the retained comment survives a later render from cache');
    assert.match(await retained.textContent(), /Previously loaded Hacker News comment/);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test('a stale in-flight Hacker News reply cannot overwrite the refreshed cache', { timeout: 45000 }, async () => {
  const now = Math.floor(Date.now() / 1000);
  const story = { match: (path) => path.endsWith('/v0/item/9001.json'), json: { id: 9001, type: 'story', by: 'reader', title: STORIES[0].title, url, score: 100, time: now - 3600, descendants: 2, kids: [900100] } };
  const root = { match: (path) => path.endsWith('/v0/item/900100.json'), json: { id: 900100, type: 'comment', by: 'reader', parent: 9001, time: now - 60, text: 'Parent comment', kids: [900199] } };
  let first = true;
  const oldReply = { match: (path) => { if (!path.endsWith('/v0/item/900199.json') || !first) return false; first = false; return true; }, delay: 2500, json: { id: 900199, type: 'comment', by: 'reader', parent: 900100, time: now - 60, text: 'Old reply', kids: [] } };
  const newReply = { match: (path) => path.endsWith('/v0/item/900199.json'), json: { id: 900199, type: 'comment', by: 'reader', parent: 900100, time: now - 60, text: 'Refreshed reply', kids: [] } };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: true, updateCheck: false }, responses: [story, root, oldReply, newReply] });
  try {
    await app.page.goto(url);
    assert(await waitFor(() => app.requests.some(({ url }) => url.endsWith('/v0/item/900199.json')), 15000));
    const button = app.page.locator('#browse-home-sync');
    assert(await waitFor(async () => await button.isVisible(), 10000));
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    const reply = app.page.locator('#comments-content .comment[data-comment-id="hn:900199"]');
    assert.match(await reply.textContent(), /Refreshed reply/);
    await new Promise((resolve) => setTimeout(resolve, 2800));
    await app.page.locator('#comment-sort').selectOption('newest');
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 1, 5000));
    assert(await waitFor(async () => await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    assert.match(await reply.textContent(), /Refreshed reply/, 'the earlier response cannot replace the updated cache');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync preserves the selected discussion filter`, { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 4, replyRoots: 0 });
  const sidebar = mode === 'Sidebar';
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: !sidebar, reddit: true }, annotations: true, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } }, responses: fixture.responses });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const source = app.page.locator('#comments-content .comment[data-story-id="fixture1"]').first();
    const other = app.page.locator('#comments-content .comment[data-story-id="fixture0"]').first();
    assert(await waitFor(async () => await source.count() === 1 && await other.count() === 1, 15000));
    const disclosure = app.page.locator(sidebar ? '#comments-content .page-header-disclosure' : '#app-discussion-meta .page-header-disclosure');
    await disclosure.click();
    const menu = app.page.locator(sidebar ? '#comments-content .source-menu' : '#app-discussion-meta .source-menu');
    await menu.locator('[data-discussion-key="reddit:fixture1"] input').check();
    assert(await waitFor(async () => await other.evaluate((element) => element.classList.contains('comment-filter-hidden')), 5000));
    await app.page.locator('#comments-content').evaluate((body) => {
      window.__syncFilterFlash = false;
      new MutationObserver((records) => {
        for (const record of records) for (const added of record.addedNodes) {
          const comment = added.nodeType === Node.ELEMENT_NODE && (added.matches?.('[data-comment-id="reddit:filternew"]') ? added : added.querySelector?.('[data-comment-id="reddit:filternew"]'));
          if (comment && !comment.classList.contains('comment-filter-hidden')) window.__syncFilterFlash = true;
        }
      }).observe(body, { childList: true, subtree: true });
    });
    fixture.trees.get('fixture0').push({ kind: 't1', data: { id: 'filternew', body: 'A new comment from another discussion', author: 'reader', parent_id: 't3_fixture0', link_id: 't3_fixture0', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    fixture.trees.get('fixture1').push({ kind: 't1', data: { id: 'selectednew', body: 'A new comment from the selected discussion', author: 'reader', parent_id: 't3_fixture1', link_id: 't3_fixture1', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    const sync = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await sync.click();
    assert(await waitFor(async () => await sync.getAttribute('aria-busy') !== 'true', 15000));
    assert(await other.evaluate((element) => element.classList.contains('comment-filter-hidden')), 'unselected discussions remain hidden');
    assert(await app.page.locator('#comments-content .comment[data-comment-id="reddit:filternew"]').evaluate((element) => element.classList.contains('comment-filter-hidden')), 'new comments respect the selected source');
    assert(!(await app.page.locator('#comments-content .comment[data-comment-id="reddit:selectednew"]').evaluate((element) => element.classList.contains('comment-filter-hidden'))), 'new comments in the selected discussion are visible');
    assert.equal(await app.page.evaluate(() => window.__syncFilterFlash), false, 'new comments from another source never flash into view');
    assert(!(await source.evaluate((element) => element.classList.contains('comment-filter-hidden'))), 'the selected discussion remains visible');
    await disclosure.click();
    assert(await menu.locator('[data-discussion-key="reddit:fixture1"] input').isChecked(), 'the source selection is retained');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync keeps the current reading position when new comments arrive above it`, { timeout: 45000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 80, replyRoots: 0 });
  const sidebar = mode === 'Sidebar';
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: !sidebar, reddit: true }, autoOpenSidebar: sidebar, commentSort: 'newest', frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } }, responses: fixture.responses });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const target = app.page.locator('#comments-content .comment[data-comment-id="reddit:root60"]');
    assert(await waitFor(async () => await target.count() === 1 && await app.page.locator('#comments-content .discussion-loading').count() === 0, 20000));
    await target.evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const offset = async () => (await target.boundingBox()).y - (await app.page.locator('#comments').boundingBox()).y;
    const before = await offset();
    fixture.trees.get('fixture0').unshift({ kind: 't1', data: { id: 'newabove', body: 'A newly arrived comment above the current reading position', author: 'reader', parent_id: 't3_fixture0', link_id: 't3_fixture0', created_utc: Math.floor(Date.now() / 1000), replies: '' } });
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 20000));
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:newabove"]').count(), 1);
    const after = await offset();
    assert(Math.abs(after - before) <= 8, `the comment being read stays at the same position (${before} to ${after})`);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync keeps a draft when no comments have loaded`, { timeout: 30000 }, async () => {
  const sidebar = mode === 'Sidebar';
  const fixture = discussionFixture(url, { rootCount: 0, replyRoots: 0 });
  const post = { ...fixture.posts[0], num_comments: 1 };
  const story = { source: 'reddit', id: post.id, url, title: STORIES[0].title, descendants: 1, time: post.created_utc, site: post.subreddit_name_prefixed, permalink: 'https://www.reddit.com' + post.permalink };
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, values: {
    'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() },
    'HNewhere:frontpage_cache:reddit': { timestamp: Date.now(), rows: [{ story, also: [] }], sources: ['reddit'] },
  }, responses: [
    { match: (path) => path.includes('/api/posts/search') || path.includes('/api/posts/ids'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [] } },
  ] });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: story.title }).first().click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .top-level-comments').count() === 1 && await app.page.locator('#comments-content .discussion-loading').count() === 0, 15000));
    if (!sidebar) await app.page.locator('#comment-toggle').click();
    const composer = app.page.locator('#panel .compose-box');
    await composer.locator('.composer-text').fill('Draft in an empty discussion');
    await composer.evaluate((element) => { window.__emptyDiscussionComposer = element; });
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    assert(await composer.evaluate((element) => element === window.__emptyDiscussionComposer), 'the composer is not rebuilt');
    assert.equal(await composer.locator('.composer-text').inputValue(), 'Draft in an empty discussion');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} Sync updates a Bluesky discussion without replacing its comments`, { timeout: 45000 }, async () => {
  const sidebar = mode === 'Sidebar';
  const uri = 'at://did:plc:fixture/app.bsky.feed.post/article';
  const replyURI = 'at://did:plc:fixture/app.bsky.feed.post/reply';
  const now = new Date().toISOString();
  const post = { uri, author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, embed: { external: { uri: url } }, record: { text: 'Original Bluesky post', createdAt: now }, replyCount: 0, likeCount: 1 };
  const reply = { uri: replyURI, author: { handle: 'reader.bsky.social', did: 'did:plc:fixture' }, record: { text: 'New Bluesky reply', createdAt: now }, replyCount: 0, likeCount: 1 };
  const story = { source: 'bsky', id: uri, url, title: STORIES[0].title, descendants: 0 };
  const thread = { match: (path) => path.includes('/app.bsky.feed.getPostThread'), json: { thread: { post, replies: [] } }, delay: 0 };
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, settings: { sources: { hn: false, bsky: true }, autoOpenSidebar: sidebar, frontPageMode: 'topics', frontPageTopics: ['technology'], updateCheck: false }, values: {
    'HNewhere:frontpage_feed:technology/bsky/at://did:plc:cndfx4udwgvpjaakvxvh7wm5/app.bsky.feed.generator/flipboard-tech': { timestamp: Date.now(), stories: [story] },
  }, responses: [
    { match: (path) => path.includes('constellation.microcosm.blue/links/all'), json: { links: {} } },
    { match: (path) => path.includes('/app.bsky.feed.getPosts'), json: { posts: [post] } },
    { match: (path) => path.includes('/app.bsky.feed.getFeed'), json: { feed: [{ post }] } },
    thread,
  ] });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: story.title }).first().click();
    const root = app.page.locator('#comments-content .comment').filter({ hasText: 'Original Bluesky post' }).first();
    assert(await waitFor(async () => await root.count() === 1, 15000));
    await root.evaluate((element) => { window.__bskySyncOriginal = element; });
    const edited = { ...post, record: { ...post.record, text: 'Edited Bluesky post' }, replyCount: 1 };
    thread.json = { thread: { post: edited, replies: [{ post: reply, replies: [] }] } };
    thread.delay = 1200;
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    const before = app.requests.filter(({ url }) => thread.match(url)).length;
    await button.click();
    assert(await waitFor(() => app.requests.filter(({ url }) => thread.match(url)).length > before, 10000));
    assert(await app.page.evaluate(() => window.__bskySyncOriginal.isConnected), 'the old comment stays connected during the refresh');
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    const updated = app.page.locator('#comments-content .comment').filter({ hasText: 'Edited Bluesky post' }).first();
    assert(await updated.evaluate((element) => element === window.__bskySyncOriginal));
    assert.equal(await updated.locator('.comment').filter({ hasText: 'New Bluesky reply' }).count(), 1);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test('a Reader sync finishing after navigation cannot attach the old discussion to the new article', { timeout: 45000 }, async () => {
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'await paintCollectionTag(ui, nextStories, seenTimes);';
  assert(original.includes(seam));
  const source = original.replace(seam, `${seam}\n\t\t\tif (window.__pauseOldSync) { window.__oldSyncPaused = true; await new Promise((resolve) => setTimeout(resolve, 2500)); }`);
  const app = await launchApp({ source, sharedStore: true, settings: { sources: { hn: true }, frontPageMode: 'sources', updateCheck: false } });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-rail [data-app-view="all"]').click();
    const first = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[0].url}"]`).first();
    const second = app.page.locator(`#app-list-body .browse-title-link[href="${STORIES[1].url}"]`).first();
    await first.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9001"]').count() === 30, 15000));
    await app.page.evaluate(() => { window.__pauseOldSync = true; });
    const button = app.page.locator('#app-list-sync');
    await button.click();
    assert(await waitFor(() => app.page.evaluate(() => Boolean(window.__oldSyncPaused)), 10000));
    await second.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9002"]').count() === 30, 15000));
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 10000));
    await app.page.evaluate(() => { window.__pauseOldSync = false; });
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-story-id="9001"]').count(), 0, 'the old article does not appear in the new discussion');
    assert.equal(await app.page.locator('#comments-content .comment[data-story-id="9002"]').count(), 30);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test('a Sidebar sync finishing after an in-page URL change cannot attach the old discussion to the new page', { timeout: 45000 }, async () => {
  const { readFile } = await import('node:fs/promises');
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'await paintCollectionTag(ui, nextStories, seenTimes);';
  assert(original.includes(seam));
  const source = original.replace(seam, `${seam}\n\t\t\tif (window.__pauseOldSync) { window.__oldSyncPaused = true; await new Promise((resolve) => setTimeout(resolve, 2500)); }`);
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, settings: { sources: { hn: true }, autoOpenSidebar: true, updateCheck: false } });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9001"]').count() === 30, 15000));
    await app.page.evaluate(() => { window.__pauseOldSync = true; });
    await app.page.locator('#browse-home-sync').click();
    assert(await waitFor(() => app.page.evaluate(() => Boolean(window.__oldSyncPaused)), 10000));
    await app.page.evaluate((next) => history.pushState({}, '', next), STORIES[7].url);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9008"]').count() === 3, 20000));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await app.page.evaluate(() => { window.__pauseOldSync = false; });
    const button = app.page.locator('#browse-home-sync');
    assert(await waitFor(async () => await button.isVisible() && await button.getAttribute('aria-busy') !== 'true', 10000));
    await button.click();
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 15000));
    assert.equal(await app.page.locator('#comments-content .comment[data-story-id="9001"]').count(), 0, 'the old page does not appear in the new discussion');
    assert.equal(await app.page.locator('#comments-content .comment[data-story-id="9008"]').count(), 3);
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

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

test('Reader recovers other exact discussions already present in shared feeds', { timeout: 30000 }, async () => {
  const story = { source: 'lemmy', id: 321, url, title: STORIES[0].title, descendants: 1 };
  const postView = { post: { id: 321, url, name: STORIES[0].title, creator_id: 1, published: new Date().toISOString() }, community: { name: 'technology', actor_id: 'https://lemmy.world/c/technology' }, creator: { id: 1, name: 'reader' }, counts: { comments: 1 } };
  const comment = { comment: { id: 99, content: 'A discussion from another shared feed', path: '0.99', published: new Date().toISOString() }, creator: { id: 2, name: 'reader' }, counts: { score: 1 } };
  const app = await launchApp({ sharedStore: true, settings: { sources: { hn: true, lemmy: true }, frontPageMode: 'sources', updateCheck: false }, responses: [
    { match: (path) => path.includes('/api/v3/search'), json: { posts: [] } },
    { match: (path) => path.includes('/api/v3/post?id=321'), json: { post_view: postView } },
    { match: (path) => path.includes('/api/v3/comment/list?post_id=321'), json: { comments: [comment] } },
  ] });
  try {
    await app.page.goto('https://backchnnl.app/');
    const link = app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first();
    assert(await waitFor(async () => await link.count() > 0, 10000));
    await app.page.evaluate(async (story) => {
      await window.__gmStore('set', 'HNewhere:frontpage_cache:hn,lemmy', { timestamp: Date.now(), rows: [{ story, also: [] }], sources: ['hn', 'lemmy'] });
    }, story);
    await link.click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="lemmy:99"]').count() === 1, 12000), 'Reader includes an exact article discussion from another cached feed');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('Sidebar reuses comments loaded by Reader in another tab', { timeout: 45000 }, async () => {
  const app = await launchApp({ sharedStore: true, topHosts: [new URL(url).hostname], settings: { sources: { hn: true }, autoOpenSidebar: true, frontPageMode: 'sources', updateCheck: false } });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-story-id="9001"]').count() === 30, 15000));
    assert(await waitFor(() => app.store.has('HNewhere:thread_cache:hn:9001'), 10000), 'the loaded discussion is available to other pages');
    const itemRequests = () => app.requests.filter(({ url: requested }) => /hacker-news\.firebaseio\.com\/v0\/item\/(9001|9001\d\d)\.json/.test(requested)).length;
    const before = itemRequests();
    const article = await app.context.newPage();
    await article.goto(url);
    assert(await waitFor(async () => await article.locator('#comments-content .comment[data-story-id="9001"]').count() === 30, 15000));
    assert.equal(itemRequests(), before, 'the second view reads the existing discussion instead of downloading it again');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
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

test("sync keeps a large 1,600-comment discussion visible without duplicates", { timeout: 90000 }, async () => {
  const fixture = discussionFixture(url, { rootCount: 400, replyRoots: 400 });
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler: 'Tampermonkey', settings: { sources: { hn: false, reddit: true }, autoOpenSidebar: true, updateCheck: false }, values: { 'HNewhere:reddit_tier': { tier: 'archive', timestamp: Date.now() } }, responses: fixture.responses });
  try {
    await app.page.goto(url);
    const comments = app.page.locator('#comments-content .comment[data-story-id="fixture0"]');
    assert(await waitFor(async () => await comments.count() === 1600, 60000));
    const first = app.page.locator('#comments-content .comment[data-comment-id="reddit:root0"]');
    await first.evaluate((element) => { window.__largeSyncOriginal = element; });
    const button = app.page.locator('#browse-home-sync');
    assert(await waitFor(async () => await button.isVisible(), 10000));
    await button.click();
    assert.equal(await comments.count(), 1600, 'the full thread stays visible when sync starts');
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true', 60000));
    assert.equal(await comments.count(), 1600);
    assert(await first.evaluate((element) => element === window.__largeSyncOriginal));
    const ids = await comments.evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId));
    assert.equal(new Set(ids).size, 1600, 'reconciliation does not duplicate comments');
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
    await app.page.waitForSelector('#header-subtitle');
    await app.page.locator('#header-subtitle').evaluate((element) => {
      window.__discussionStatuses = [element.textContent];
      new MutationObserver(() => window.__discussionStatuses.push(element.textContent)).observe(element, { childList: true, characterData: true, subtree: true });
    });
    const comments = app.page.locator('#comments-content .comment[data-story-id="fixture0"]');
    assert(await waitFor(async () => await app.page.locator('[data-hnewhere-annotation-overlay] [title="Show the comments quoting this"]').count() > 0, 60000), "a quote highlight appears on the article");
    assert((await comments.count()) < 1600, "annotations should not wait for every comment to render");
    assert.doesNotMatch(await app.page.locator('#header-subtitle').textContent(), /loading discussions/i, "the header identifies rendering after requests finish");
    assert(await waitFor(async () => await comments.count() === 1600, 60000), "rendering still completes");
    assert(!(await app.page.evaluate(() => window.__discussionStatuses)).some((text) => /annotating link|loading votes/i.test(text)), 'rendering and annotations use one stable status');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
