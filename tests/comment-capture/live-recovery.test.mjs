import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, STORIES, waitFor } from "./harness.mjs";

for (const mode of ['Reader', 'Sidebar']) test(`${mode} does not start a delayed automatic Reddit refresh after a manual sync`, { timeout: 45000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const [accepted, cooldown] = await Promise.all([load(REDDIT_READ_NOTICE_KEY, false), load(REDDIT_POLL_KEY, null)]);';
  assert(original.includes(seam));
  const source = original.replace(seam, `if (!window.__autoRefreshPaused) { window.__autoRefreshPaused = true; await new Promise((resolve) => { window.__resumeAutoRefresh = resolve; }); }\n\t\t\t${seam}`);
  const url = STORIES[0].url;
  const sidebar = mode === 'Sidebar';
  const app = await launchApp({ source, ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: true, reddit: true }, autoOpenSidebar: sidebar, frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (sidebar) {
      assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() > 0, 15000));
      await app.page.locator('#browse-toggle .wordmark-root').click();
    }
    assert(await waitFor(async () => await app.page.evaluate(() => window.__autoRefreshPaused === true), 10000), 'automatic refresh is waiting on storage');
    const button = app.page.locator(sidebar ? '#browse-home-sync' : '#app-list-sync');
    await button.click();
    assert(await waitFor(() => opened.length === 1, 10000), 'manual sync opens Reddit');
    assert(await waitFor(async () => await button.getAttribute('aria-busy') !== 'true' && opened.every((page) => page.isClosed()), 15000), 'manual sync has completed');
    await app.page.evaluate(() => window.__resumeAutoRefresh());
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(opened.length, 1, 'the delayed automatic refresh must not open another tab after sync');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

for (const outcome of ['empty', 'failed', 'malformed']) test(`concurrent views ${outcome === 'empty' ? 'share an empty' : `retry a ${outcome}`} Reddit discovery`, { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const app = await launchApp({ sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com', new URL(url).hostname], settings: { sources: { hn: true, reddit: true }, autoOpenSidebar: true, frontPageMode: 'sources', updateCheck: false }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== '/') await new Promise((resolve) => setTimeout(resolve, 250));
    if (outcome === 'failed' && path !== '/' && path !== '/api/me.json') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"reason":"private"}' });
    if (outcome === 'malformed' && path !== '/' && path !== '/api/me.json') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":{}}' });
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  const other = await app.context.newPage();
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page && page !== other) opened.push(page); });
  try {
    await Promise.all([app.page.goto(url), other.goto(url)]);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id]').count() > 0 && await other.locator('#comments-content .comment[data-comment-id]').count() > 0, 15000));
    await Promise.all([app.page.locator('#browse-home-sync').click(), other.locator('#browse-home-sync').click()]);
    assert(await waitFor(async () => await app.page.locator('#browse-home-sync').getAttribute('aria-busy') !== 'true' && await other.locator('#browse-home-sync').getAttribute('aria-busy') !== 'true' && opened.length && opened.every((page) => page.isClosed()), 25000), 'both syncs complete');
    assert.equal(opened.length, outcome === 'empty' ? 1 : 2, `both views ${outcome === 'empty' ? 'share the successful empty refresh' : 'retry after an unsuccessful refresh'}: ${JSON.stringify(app.store.get('HNewhere:reddit_shared_refresh'))}`);
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

for (const { firstMode, outcome, topics } of [
  ...['Sidebar', 'Reader'].flatMap((firstMode) => ['success', 'failed'].map((outcome) => ({ firstMode, outcome, topics: false }))),
  { firstMode: 'Reader', outcome: 'success', topics: true },
]) test(`concurrent ${firstMode} and Sidebar browsing views ${outcome === 'success' ? 'share a successful' : 'retry a failed'} Reddit ${topics ? 'topic ' : ''}feed refresh`, { timeout: 45000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const source = original.replace('let redditReadInitialAttempted = false;', 'let redditReadInitialAttempted = true;');
  assert.notEqual(source, original);
  const url = STORIES[0].url;
  const reader = firstMode === 'Reader';
  const app = await launchApp({ source, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com', new URL(url).hostname], settings: { sources: { hn: true, reddit: true }, autoOpenSidebar: true, frontPageMode: topics ? 'topics' : 'sources', frontPageTopics: topics ? ['technology'] : [], updateCheck: false }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  let feedRequests = 0;
  let feedTitle = 'A freshly synced feed item';
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== '/') await new Promise((resolve) => setTimeout(resolve, 250));
    const feed = /^\/r\/[^/]+\.json$/.test(path);
    if (feed) feedRequests++;
    if (feed && outcome === 'failed') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"reason":"private"}' });
    const post = { id: 'feedonly', url: 'https://framed.example.com/post/110', title: feedTitle, author: 'reader', subreddit: 'news', permalink: '/r/news/comments/feedonly/article/', num_comments: 1, created_utc: Math.floor(Date.now() / 1000), score: 10 };
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: feed ? [{ kind: 't3', data: post }] : [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  const other = await app.context.newPage();
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page && page !== other) opened.push(page); });
  try {
    await Promise.all([app.page.goto(reader ? 'https://backchnnl.app/' : url), other.goto(url)]);
    assert(await waitFor(async () => await app.page.locator(reader ? '#app-list-body .browse-title-link' : '#comments-content .comment[data-comment-id]').count() > 0 && await other.locator('#comments-content .comment[data-comment-id]').count() > 0, 15000));
    await Promise.all([...(reader ? [] : [app.page.locator('#browse-toggle .wordmark-root').click()]), other.locator('#browse-toggle .wordmark-root').click()]);
    assert(await waitFor(async () => (reader || await app.page.locator('#panel.browsing').count() === 1) && await other.locator('#panel.browsing').count() === 1, 10000));
    const firstButton = app.page.locator(reader ? '#app-list-sync' : '#browse-home-sync');
    const otherButton = other.locator('#browse-home-sync');
    await Promise.all([firstButton.click(), otherButton.click()]);
    assert(await waitFor(async () => await firstButton.getAttribute('aria-busy') !== 'true' && await otherButton.getAttribute('aria-busy') !== 'true' && opened.length && opened.every((page) => page.isClosed()), 25000));
    assert.equal(opened.length, outcome === 'success' ? 1 : 2, 'only a successful feed refresh can be shared');
    assert.equal(feedRequests, outcome === 'success' ? 1 : 2, 'failed feeds are retried and successful feeds are fetched once');
    if (outcome === 'success') {
      assert(await app.page.locator(reader ? '#app-list-body' : '#browse-list').getByText('A freshly synced feed item').count(), 'the first view shows the refreshed feed');
      assert(await other.locator('#browse-list').getByText('A freshly synced feed item').count(), 'the other view shows the refreshed feed');
      feedTitle = 'A later feed refresh';
      await otherButton.click();
      assert(await waitFor(async () => opened.length === 2 && opened.every((page) => page.isClosed()) && await otherButton.getAttribute('aria-busy') !== 'true', 15000), 'a later explicit sync starts a fresh request');
      assert.equal(feedRequests, 2);
      assert(await other.locator('#browse-list').getByText('A later feed refresh').count(), 'a later sync displays the newer feed');
    }
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('shared storage coordination serializes competing views and ignores expired claims', { timeout: 30000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = '\tasync function loadCollapsed() {';
  assert(original.includes(seam));
  const source = original.replace(seam, `\twindow.__storageLockProbe = () => withSharedStorageLock('test-probe', async () => {\n\t\tconst previous = await load('test-probe-counter', 0);\n\t\tawait new Promise((resolve) => setTimeout(resolve, 30));\n\t\tawait save('test-probe-counter', previous + 1);\n\t});\n${seam}`);
  const app = await launchApp({ source, sharedStore: true, topHosts: [new URL(STORIES[0].url).hostname], settings: { sources: { hn: true }, updateCheck: false } });
  try {
    app.store.set('HNewhere:storage_lock:test-probe:expired', { choosing: true, ticket: 0, expires: Date.now() - 1000 });
    const pages = [app.page, ...await Promise.all(Array.from({ length: 3 }, () => app.context.newPage()))];
    await Promise.all(pages.map((page, index) => page.goto(index % 2 ? STORIES[0].url : 'https://backchnnl.app/')));
    await Promise.all(pages.map((page) => page.evaluate(async () => {
      while (!window.__storageLockProbe) await new Promise((resolve) => setTimeout(resolve, 20));
      for (let index = 0; index < 4; index++) await window.__storageLockProbe();
    })));
    assert.equal(app.store.get('test-probe-counter'), 16, 'all views enter the critical section separately');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('closing a view releases its shared storage claim', { timeout: 20000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = '\tasync function loadCollapsed() {';
  assert(original.includes(seam));
  const source = original.replace(seam, `\twindow.__holdReviewLock = () => withSharedStorageLock('close-probe', async () => { window.__reviewLockHeld = true; await new Promise(() => {}); });\n\twindow.__takeReviewLock = () => withSharedStorageLock('close-probe', async () => { window.__reviewLockTaken = true; });\n${seam}`);
  const app = await launchApp({ source, sharedStore: true, topHosts: [new URL(STORIES[0].url).hostname], settings: { sources: { hn: true }, updateCheck: false } });
  try {
    const other = await app.context.newPage();
    await Promise.all([app.page.goto('https://backchnnl.app/'), other.goto(STORIES[0].url)]);
    assert(await waitFor(async () => await app.page.evaluate(() => typeof window.__holdReviewLock === 'function') && await other.evaluate(() => typeof window.__takeReviewLock === 'function'), 5000));
    await app.page.evaluate(() => { window.__holdReviewLock().catch(() => {}); });
    assert(await waitFor(async () => await app.page.evaluate(() => window.__reviewLockHeld === true), 5000));
    await app.page.close();
    await other.evaluate(() => { window.__takeReviewLock().catch(() => {}); });
    assert(await waitFor(async () => await other.evaluate(() => window.__reviewLockTaken === true), 8000), 'another view recovers promptly from the abandoned lease');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('the Reddit title advances when background timers run once per spinner cycle', { timeout: 30000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const titleTimer = window.setInterval(tickTitle, 200);';
  assert(original.includes(seam));
  const source = original.replace(seam, 'const titleTimer = window.setInterval(tickTitle, 2000);');
  const url = STORIES[0].url;
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  const opened = [];
  app.context.on('page', (page) => opened.push(page));
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me.json') await new Promise((resolve) => setTimeout(resolve, 8000));
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    await app.page.locator('#hn-submit-button').click();
    assert(await waitFor(async () => opened.length && /Backchannel/.test(await opened[0].title()), 5000));
    const tab = opened[0];
    const first = await tab.title();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    const second = await tab.title();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const third = await tab.title();
    assert.notEqual(second, first, 'the spinner advances on the first throttled callback');
    assert.notEqual(third, second, 'the spinner keeps moving through subsequent callbacks');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('a slow Reddit discussion does not serialize unrelated discussion requests', { timeout: 30000 }, async () => {
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = '\tfunction beginRedditDiscussionRead() {';
  assert(original.includes(seam));
  const source = original.replace(seam, `\twindow.__parallelRedditProbe = () => runRedditReadAction(async (release) => {\n\t\tconst results = await Promise.all(['alpha', 'beta', 'gamma', 'delta'].map((name) => redditFetch('/r/' + name + '.json?limit=100', null, { listing: true })));\n\t\tawait release();\n\t\treturn results.length;\n\t});\n${seam}`);
  const url = STORIES[0].url;
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  let active = 0;
  let maximum = 0;
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/r/')) { active++; maximum = Math.max(maximum, active); await new Promise((resolve) => setTimeout(resolve, 900)); active--; }
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    assert(await waitFor(async () => await app.page.locator('#hn-submit-button').count() === 1, 12000));
    assert.equal(await app.page.evaluate(() => window.__parallelRedditProbe()), 4);
    assert(maximum > 1, `independent requests should run concurrently in the one Reddit tab; maximum was ${maximum}`);
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

test('Reader opens an article when the feed refreshes during a click', { timeout: 30000 }, async () => {
  const app = await launchApp({ sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: true, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 } });
  let releaseReddit;
  let redditStarted = false;
  const redditGate = new Promise((resolve) => { releaseReddit = resolve; });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me.json') { redditStarted = true; await redditGate; }
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : JSON.stringify({ data: { children: [] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    const link = app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first();
    await link.waitFor();
    assert(await waitFor(() => redditStarted, 10000), 'the automatic feed refresh starts');
    const box = await link.boundingBox();
    assert(box);
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.mouse.down();
    releaseReddit();
    await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 4000);
    await app.page.mouse.up();
    assert(await waitFor(async () => (await app.page.locator('#comments-content').textContent())?.includes('What people said about the article you open shows here.') === false, 10000), 'the clicked article opens');
    assert.deepEqual(app.errors, []);
  } finally { releaseReddit(); await app.browser.close(); }
});

for (const scenario of ['normal', 'delayed', 'expired']) test(`concurrent Reader and Sidebar syncs share one Reddit refresh${scenario === 'delayed' ? ' with delayed storage reads' : scenario === 'expired' ? ' after a suspended claim expires' : ''}`, { timeout: 60000 }, async () => {
  const url = STORIES[0].url;
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A shared live comment', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const original = scenario === 'expired' ? await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8') : '';
  const seam = 'const held = await load(REDDIT_SHARED_REFRESH_KEY, null);';
  if (original) assert(original.includes(seam));
  const source = original ? original.replace(seam, `${seam}\n if (window.__pauseSharedClaim) { window.__sharedClaimPaused = true; await new Promise((resolve) => { window.__resumeSharedClaim = resolve; }); }`) : null;
  const app = await launchApp({ source, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com', new URL(url).hostname], settings: { sources: { hn: true, reddit: true }, autoOpenSidebar: true, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment] } },
  ] });
  const opened = [];
  const requests = [];
  const initialRequests = [];
  let slow = false;
  let latest = 'A freshly synced shared comment';
  app.context.on('page', (page) => { opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (slow) requests.push(path);
    else initialRequests.push(path);
    if (slow && path !== '/') await new Promise((resolve) => setTimeout(resolve, 1200));
    const updated = slow ? { ...comment, data: { ...comment.data, body: latest } } : comment;
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : path.includes('/comments/') ? JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [updated] } }]) : JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    const initialComment = await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count() === 1, 20000);
    if (!initialComment) {
      const panel = app.page.locator('#comments-content');
      const comments = await panel.locator('.comment[data-comment-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.commentId));
      const refresh = app.store.get('HNewhere:reddit_shared_refresh');
      assert.fail(`Initial Reader discussion did not render: ${JSON.stringify({ comments, text: (await panel.textContent())?.slice(0, 1000), redditRequests: initialRequests, openTabs: opened.filter((page) => !page.isClosed()).length, refresh: refresh && { page: refresh.page, state: refresh.state, ok: refresh.ok, pageReady: refresh.pageReady }, errors: app.errors })}`);
    }
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 10000));
    assert(await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 10000), 'the Reader refresh finishes');
    assert(await waitFor(() => app.store.has('HNewhere:reddit_page_cache:framed.example.com/gc'), 10000), 'the refreshed discussion is shared');
    const sharedBeforeArticle = app.store.get('HNewhere:reddit_page_cache:framed.example.com/gc');
    const article = await app.context.newPage();
    await article.goto(url);
    assert(await waitFor(async () => await article.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count() === 1, 20000));
    assert(await waitFor(() => opened.filter((page) => page !== article).every((page) => page.isClosed()), 10000));
    const earlierTabs = opened.filter((page) => page !== article).length;
    const priorRefresh = app.store.get('HNewhere:reddit_shared_refresh');
    await article.locator('#minimize').click();
    await article.locator('#hn-restore-button').click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(opened.filter((page) => page !== article).length, earlierTabs, `reopening Sidebar reuses the Reader refresh without another Reddit tab: ${JSON.stringify(sharedBeforeArticle)}; ${JSON.stringify(priorRefresh)} => ${JSON.stringify(app.store.get('HNewhere:reddit_shared_refresh'))}`);
    opened.length = 0;
    slow = true;
    if (scenario === 'expired') {
      app.store.delete('HNewhere:reddit_shared_refresh');
      app.store.delete('HNewhere:reddit_page_cache:framed.example.com/gc');
      await app.page.evaluate(() => { window.__pauseSharedClaim = true; });
      await app.page.locator('#app-list-sync').click();
      assert(await waitFor(async () => await app.page.evaluate(() => window.__sharedClaimPaused === true), 5000), 'the first view pauses inside the claim');
      const key = [...app.store.keys()].find((item) => item.startsWith('HNewhere:storage_lock:reddit-refresh:'));
      assert(key, 'the first view holds the coordination lease');
      app.store.set(key, { ...app.store.get(key), expires: Date.now() - 1 });
      await article.locator('#browse-home-sync').click();
      assert(await waitFor(() => opened.length > 0, 5000), 'the second view starts after expiry');
      await app.page.evaluate(() => { window.__pauseSharedClaim = false; window.__resumeSharedClaim(); });
    } else if (scenario === 'delayed') {
      app.store.delete('HNewhere:reddit_shared_refresh');
      app.store.delete('HNewhere:reddit_page_cache:framed.example.com/gc');
      Object.assign(app.slowGets, { key: 'HNewhere:reddit_shared_refresh', armed: true, afterRead: true, delays: [200, 700] });
      await Promise.all([app.page.locator('#app-list-sync').click(), article.locator('#browse-home-sync').click()]);
    } else {
      await app.page.locator('#app-list-sync').click();
      assert(await waitFor(() => opened.length > 0, 5000));
      await article.locator('#browse-home-sync').click();
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(opened.length, 1, 'concurrent refreshes must not open separate Reddit tabs');
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 30000), 'the shared refresh closes its tab');
    assert(await waitFor(async () => /A freshly synced shared comment/.test(await article.locator('#comments-content').textContent()), 15000), 'Sidebar receives the refreshed comment');
    assert(await waitFor(async () => /A freshly synced shared comment/.test(await app.page.locator('#comments-content').textContent()), 15000), 'Reader receives the refreshed comment');
    assert.equal(requests.filter((path) => path.includes('/comments/')).length, 1, 'the two views share the same Reddit discussion request');
    assert(await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 10000));
    assert(await waitFor(async () => await app.page.locator('#app-list-sync').getAttribute('aria-busy') !== 'true', 10000), 'the first Sync has finished');
    latest = 'A later shared refresh';
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async () => /A later shared refresh/.test(await app.page.locator('#comments-content').textContent()), 20000));
    assert(await waitFor(() => opened.length === 2 && opened.every((page) => page.isClosed()), 15000));
    assert(await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 10000));
    await article.locator('#browse-home-sync').click();
    assert(await waitFor(async () => /A later shared refresh/.test(await article.locator('#comments-content').textContent()), 15000), 'a later Sidebar sync picks up the Reader refresh');
    assert.equal(opened.length, 2, 'a second view does not open Reddit after the first has just synced');
    assert.equal(requests.filter((path) => path.includes('/comments/')).length, 2, 'the later refresh is also downloaded only once');
    assert.deepEqual(app.errors, []);
  } finally { await app.browser.close(); }
});

for (const tabs of [true, false]) test(`Sidebar recovers live Reddit comments with ${tabs ? 'manager tabs' : 'a popup'} when the archive has none`, { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const source = tabs ? `Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });\n${await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8')}` : undefined;
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 2, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A live comment missing from the archive', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const app = await launchApp({ source, appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
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

for (const tabs of [true, false]) test(`opening while discovery is running renders live comments once with ${tabs ? 'manager tabs' : 'a popup'}`, { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A single live render', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const app = await launchApp({ appHost: new URL(url).hostname, sharedStore: true, handler: 'Userscripts', tabs, topHosts: ['www.reddit.com'], settings: { sources: { hn: false, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), delay: 1000, json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [] } },
  ] });
  const opened = [];
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : path.includes('/comments/') ? JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment] } }]) : JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(url);
    await app.page.locator('#hn-checking-button').click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count() === 1, 20000));
    assert(await waitFor(() => opened.length === 1 && opened[0].isClosed(), 5000), 'the one Reddit session closes');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(opened.length, 1, 'discovery does not schedule a second Reddit session');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test('Reader Sync still requests a working Reddit feed after an individual discussion is denied', { timeout: 60000 }, async () => {
  const url = STORIES[0].url;
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = { kind: 't1', data: { id: 'freshcomment', body: 'A comment available from the archive', author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } };
  const original = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'renderAppList({ force: !sharedRefreshSince }).finally(finishFeed),';
  assert(original.includes(seam));
  const source = original.replace(seam, 'new Promise((resolve) => setTimeout(resolve, 3000)).then(() => renderAppList({ force: true })).finally(finishFeed),');
  const app = await launchApp({ source, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: true, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment] } },
  ] });
  let denyThread = false;
  let denyFeed = false;
  const calls = [];
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (denyThread) calls.push(path);
    if (path === '/r/popular.json' && denyFeed) return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Forbidden"}' });
    if (path.includes('/comments/') && denyThread) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"Forbidden"}' });
    }
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : path.includes('/comments/') ? JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment] } }]) : JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshcomment"]').count() === 1, 20000));
    denyThread = true;
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async () => await app.page.locator('#app-list-sync').getAttribute('aria-busy') !== 'true', 25000));
    assert(calls.some((path) => path.includes('/comments/')), 'a discussion request was denied');
    assert(calls.includes('/r/popular.json'), `the separately accessible feed is still requested: ${calls.join(', ')}`);
    assert(calls.findIndex((path) => path.includes('/comments/')) < calls.indexOf('/r/popular.json'), `the denial precedes the feed request: ${calls.join(', ')}`);
    assert.equal(await app.page.locator('#app-list-body .browse-feed-status').count(), 0, 'an unrelated discussion denial does not mark the feed unavailable');
    denyThread = false;
    denyFeed = true;
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(async () => await app.page.locator('#app-list-sync').getAttribute('aria-busy') !== 'true', 25000));
    assert.match(await app.page.locator('#app-list-body .browse-feed-status').textContent(), /Reddit.*feed.*Showing saved articles/i, 'a real feed failure is still disclosed');
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
    assert.match(firstTitle, /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Backchannel/, 'the Braille spinner leads the title');
    await redditTab.evaluate(() => { document.title = 'Reddit'; });
    assert(await waitFor(async () => /Backchannel/.test(await redditTab.title()), 1000), 'Reddit cannot replace the refresh title');
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
  const seam = 'const lookup = new Map(renderedComments.map((entry) => [entry.discussionKey + "\\0" + entry.id, entry]));';
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
    assert(await waitFor(async () => /rendering comments/i.test(await app.page.locator('#header-subtitle').textContent()), 15000));
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 2500), 'the tab closes while local rendering is paused');
    assert.equal(await app.page.locator('#comments-content .discussion-loading').count(), 0, 'sync keeps the existing discussion in view');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:archived"]').count(), 1);
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count(), 0);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count() === 1, 10000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("Reader Sync closes its Reddit tab after feeds and threads load, before local reconciliation finishes", { timeout: 60000 }, async () => {
  const url = STORIES[0].url;
  const sourceText = await readFile(new URL('../../HNewhere.user.js', import.meta.url), 'utf8');
  const seam = 'const lookup = new Map(renderedComments.map((entry) => [entry.discussionKey + "\\0" + entry.id, entry]));';
  assert(sourceText.includes(seam));
  const source = sourceText.replace(seam, `${seam}\n\t\tif (window.__bcSlowRender) await new Promise((resolve) => setTimeout(resolve, 4000));`);
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = (id) => ({ kind: 't1', data: { id, body: `Comment ${id}`, author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } });
  const app = await launchApp({ source, sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: true, reddit: true }, updateCheck: false, frontPageMode: 'sources' }, values: { 'HNewhere:reddit_read_window_notice': 2 }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment('initial')] } },
  ] });
  const opened = [];
  let current = 'initial';
  app.context.on('page', (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : path.includes('/comments/') ? JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment(current)] } }]) : JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto('https://backchnnl.app/');
    assert(await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 15000), 'the initial feed refresh finishes');
    await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().evaluate((element) => element.click());
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:initial"]').count() === 1, 20000));
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 10000));
    assert(await waitFor(() => app.store.get('HNewhere:reddit_shared_refresh')?.state === 'done', 10000), 'the initial refresh finishes before starting another');
    opened.length = 0;
    current = 'freshsync';
    await app.page.evaluate(() => { window.__bcSlowRender = true; });
    await app.page.locator('#app-list-sync').click();
    assert(await waitFor(() => opened.length > 0, 10000));
    assert(await waitFor(() => opened.every((page) => page.isClosed()), 12000), 'the tab closes while reconciliation is paused');
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:initial"]').count(), 1);
    assert.equal(await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshsync"]').count(), 0);
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:freshsync"]').count() === 1, 12000));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

for (const mode of ['Sidebar', 'Reader']) test(`${mode} keeps loaded comments when the Reddit connection is first enabled`, { timeout: 45000 }, async () => {
  const url = STORIES[0].url;
  const sidebar = mode === 'Sidebar';
  const now = Math.floor(Date.now() / 1000);
  const post = { id: 'freshpost', url, title: STORIES[0].title, author: 'reader', subreddit: 'news', subreddit_name_prefixed: 'r/news', permalink: '/r/news/comments/freshpost/article/', num_comments: 1, created_utc: now - 3600, score: 100 };
  const comment = (id) => ({ kind: 't1', data: { id, body: `Comment ${id}`, author: 'reader', parent_id: 't3_freshpost', link_id: 't3_freshpost', created_utc: now - 60, replies: '' } });
  const app = await launchApp({ ...(sidebar ? { appHost: new URL(url).hostname } : {}), sharedStore: true, handler: 'Userscripts', tabs: true, topHosts: ['www.reddit.com'], settings: { sources: { hn: !sidebar, reddit: true }, autoOpenSidebar: sidebar, updateCheck: false, frontPageMode: 'sources' }, responses: [
    { match: (path) => path.includes('/api/posts/search'), json: { data: [post] } },
    { match: (path) => path.includes('/api/comments/tree'), json: { data: [comment('archived')] } },
  ] });
  await app.context.route('https://www.reddit.com/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/' ? '<!doctype html><title>Reddit fixture</title>' : path === '/api/me.json' ? JSON.stringify({ data: { name: 'fixture-user' } }) : path.includes('/comments/') ? JSON.stringify([{ data: { children: [{ kind: 't3', data: post }] } }, { data: { children: [comment('live')] } }]) : JSON.stringify({ data: { children: [{ kind: 't3', data: post }] } });
    await route.fulfill({ status: 200, contentType: path === '/' ? 'text/html' : 'application/json', body });
  });
  try {
    await app.page.goto(sidebar ? url : 'https://backchnnl.app/');
    if (!sidebar) await app.page.locator('#app-list-body .browse-title-link', { hasText: STORIES[0].title }).first().evaluate((element) => element.click());
    const archived = app.page.locator('#comments-content .comment[data-comment-id="reddit:archived"]');
    assert(await waitFor(async () => await archived.count() === 1, 15000));
    await archived.evaluate((element) => { window.__beforeRedditEnable = element; });
    await app.page.locator('#reddit-read-modal .reddit-read-confirm').click();
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count() === 1, 20000));
    assert(await archived.evaluate((element) => element === window.__beforeRedditEnable), 'the original comment stays in place');
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});

test("opening a known discussion fetches live comments once and reuses them on reopen", { timeout: 45000 }, async () => {
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
    assert(await waitFor(() => opened.length === 1 && opened.every((page) => page.isClosed()), 2500), 'the Reddit tab closes while local rendering is paused');
    assert(await waitFor(async () => await app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]').count() === 1, 15000), 'the initial render uses the live discussion');
    assert.equal(opened.length, 1, 'opening does not repeat the Reddit refresh after rendering');
    const commentNode = app.page.locator('#comments-content .comment[data-comment-id="reddit:live"]');
    await commentNode.evaluate((element) => { element.dataset.cacheSentinel = 'retained'; });
    const tabCount = opened.length;
    await app.page.locator('#minimize').click();
    await app.page.locator('#hn-restore-button').click();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(opened.length, tabCount, 'reopening a fresh discussion does not start another Reddit session');
    assert.equal(await commentNode.getAttribute('data-cache-sentinel'), 'retained', 'reopening keeps the already rendered discussion');
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
