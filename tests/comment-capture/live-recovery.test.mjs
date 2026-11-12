import test from "node:test";
import assert from "node:assert/strict";
import { launchApp, waitFor } from "./harness.mjs";

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
    assert(await waitFor(async () => (await app.page.locator("#comments-content").textContent()).includes("Recovered archive comment"), 20000));
    assert.match(await app.page.locator("#comments-content").textContent(), /Other live comment/, "a local size limit must not hide the next discussion");
    assert(!(app.store.get("HNewhere:reddit_poll")?.until > Date.now()), "a local size limit is not a server rate limit");
    assert(!JSON.stringify([...app.store.values()]).includes("private-fixture-token"), "private Reddit credentials stay in the Reddit tab");
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
