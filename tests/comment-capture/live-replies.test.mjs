import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { launchApp, waitFor } from "./harness.mjs";

test("failed or incomplete live reply expansions remain retryable and keep nested replies", { timeout: 60000 }, async () => {
  const path = process.env.BC_SCRIPT || new URL("../../HNewhere.user.js", import.meta.url);
  let source = await readFile(path, "utf8");
  const startup = "init().catch(console.error);";
  assert(source.includes(startup));
  source = source.replace(startup, 'globalThis.__readTest = { source: SOURCES.get("reddit"), run: runRedditReadAction }; init().catch(console.error);');
  const app = await launchApp({ source, sharedStore: true, handler: "Userscripts", topHosts: ["www.reddit.com"], settings: { sources: { hn: true, reddit: true }, updateCheck: false }, values: { "HNewhere:reddit_read_window_notice": false }, responses: [{ match: (url) => /reddit|arctic-shift/.test(url), status: 403, json: {} }] });
  let mode = "error";
  const opened = [];
  app.context.on("page", (page) => { if (page !== app.page) opened.push(page); });
  await app.context.route("https://www.reddit.com/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const comment = { kind: "t1", data: { id: "reply", body: "A loaded reply", author: "reader", parent_id: "t3_post", link_id: "t3_post", created_utc: 1789430400 } };
    const nested = { kind: "more", data: { parent_id: "t1_reply", children: ["nested"], count: 1 } };
    let json;
    if (path === "/api/me.json") json = { data: { name: "fixture", modhash: "private-fixture-token" } };
    else if (path === "/api/morechildren.json") json = mode === "error"
      ? { json: { errors: [["RATELIMIT", "try later"]], data: { things: [] } } }
      : { json: { errors: [], data: { things: mode === "missing" ? [] : [comment, nested] } } };
    else json = [{ data: { children: [] } }, { data: { children: [{ kind: "more", data: { parent_id: "t3_post", count: 1, children: ["reply"] } }] } }];
    await route.fulfill({ status: 200, contentType: path === "/" ? "text/html" : "application/json", body: path === "/" ? "<!doctype html><title>Reddit fixture</title>" : JSON.stringify(json) });
  });
  try {
    await app.page.goto("https://backchnnl.app/");
    await app.page.locator("#app-list-sync").waitFor();
    await app.page.locator("#reddit-read-modal").waitFor();
    await app.page.keyboard.press("Escape");
    await app.page.evaluate(() => {
      const discussion = { id: "post", source: "reddit", key: "reddit:post", permalink: "https://www.reddit.com/r/news/comments/post/article/" };
      for (const [id, action] of [["thread", async () => { window.__thread = await __readTest.run(() => __readTest.source.loadThread(discussion)); }], ["more", async () => { window.__more = await window.__thread.expandMore(["reply"]); }]]) {
        const button = document.createElement("button");
        button.id = `probe-${id}`;
        button.textContent = id;
        button.style.cssText = `position:fixed;z-index:2147483647;left:20px;top:${id === "thread" ? 20 : 60}px`;
        button.onclick = action;
        document.body.append(button);
      }
    });
    await app.page.locator("#probe-thread").click();
    assert(await waitFor(() => app.page.evaluate(() => Boolean(window.__thread)), 10000));
    assert(await waitFor(() => opened.length > 0 && opened.every((page) => page.isClosed()), 10000));
    for (const next of ["error", "missing", "success"]) {
      mode = next;
      await app.page.evaluate(() => { window.__more = null; });
      await app.page.locator("#probe-more").click();
      assert(await waitFor(() => app.page.evaluate(() => Boolean(window.__more)), 10000), `${next} response did not complete`);
      const result = await app.page.evaluate(() => window.__more);
      if (next === "error") assert.equal(result.ok, false);
      if (next === "missing") assert(result.ok && result.remaining.includes("reply"));
      if (next === "success") assert(result.ok && result.added[0].more.ids.includes("nested") && result.remaining.length === 0);
      assert(await waitFor(() => opened.every((page) => page.isClosed()), 10000));
    }
    assert(!JSON.stringify([...app.store.values()]).includes("private-fixture-token"));
    assert.deepEqual(app.errors, []);
  } finally {
    await app.browser.close();
  }
});
