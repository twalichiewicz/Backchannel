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
      assert(await waitFor(async () => await app.page.locator("#comments-content .discussion-load-warning").count() > 0, 15000), "missing load warning");
      const warning = await app.page.locator("#comments-content .discussion-load-warning").textContent();
      assert.match(warning, mode === "partial" ? /only some comments/i : /couldn't load comments/i);
      assert.match(warning, /sync to retry/i);
      if (mode === "empty") assert.doesNotMatch(warning, /only some comments/i);
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

test("queued discussions get their own timeout instead of expiring before the request starts", { timeout: 30000 }, async () => {
  const scriptPath = process.env.BC_SCRIPT || new URL("../../HNewhere.user.js", import.meta.url);
  let source = await readFile(scriptPath, "utf8");
  const ceiling = "const THREAD_CEILING_MS = 20000;";
  assert(source.includes(ceiling), "the timeout test needs its controlled clock seam");
  source = source.replace(ceiling, "const THREAD_CEILING_MS = 1500;");
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
