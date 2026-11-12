import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

test("source adapters preserve discussions, comments, and parent-child links", { timeout: 30000 }, async () => {
  const path = process.env.BC_SCRIPT || new URL("../../HNewhere.user.js", import.meta.url);
  const source = await readFile(path, "utf8");
  const regions = [...source.matchAll(/\/\/ #region hnewhere-test-export([\s\S]*?)\/\/ #endregion hnewhere-test-export/g)].map((match) => match[1]);
  assert(regions.length > 0, "source test exports are missing");
  const browser = await ({ chromium, firefox, webkit }[process.env.ENGINE] || chromium).launch();
  const page = await browser.newPage();
  try {
    const result = await page.evaluate((code) => {
      const api = new Function(code + "\nreturn { hnDiscussion, hnComment, redditThreadIndex, lemmyThreadIndex, indexBskyThread, lobstersThreadIndex, mastodonCollective, mastodonComment, hypothesisThreadIndex, indexWikipediaPage };")();
      const hn = api.hnDiscussion({ id: 1, title: "Article", url: "https://example.com/article", kids: [2], descendants: 2 });
      const hnRoot = api.hnComment({ id: 2, parent: 1, by: "reader", text: "Root", kids: [3] }, hn);
      const reddit = api.redditThreadIndex([null, { data: { children: [{ kind: "t1", data: { id: "root", author: "[deleted]", body: "Readable text", parent_id: "t3_post", replies: { data: { children: [{ kind: "t1", data: { id: "child", author: "reader", body: "Reply", parent_id: "t1_root", replies: "" } }] } } } }] } }], { key: "reddit:post" });
      const lemmy = api.lemmyThreadIndex([
        { comment: { id: 1, path: "0.1", content: "Root" }, creator: { name: "reader" } },
        { comment: { id: 2, path: "0.1.2", content: "Reply" }, creator: { name: "reader" } },
      ], { key: "lemmy:post" });
      const byKey = new Map();
      const rootURI = "at://did:plc:fixture/app.bsky.feed.post/root";
      const replyURI = "at://did:plc:fixture/app.bsky.feed.post/reply";
      api.indexBskyThread({ post: { uri: rootURI, author: { handle: "reader.test" }, record: { text: "Root" } }, replies: [{ post: { uri: replyURI, author: { handle: "reader.test" }, record: { text: "Reply" } } }] }, { key: "bsky:thread" }, byKey, null);
      const lobsters = api.lobstersThreadIndex({ comments: [{ short_id: "root", comment: "Root" }, { short_id: "child", parent_comment: "root", comment: "Reply" }] }, { key: "lobsters:post" });
      const statuses = [{ id: "1", url: "https://social.example/@reader/1", content: "Post" }, { id: "2", url: "https://social.example/@reader/2", content: "Another post" }];
      const mastodon = api.mastodonCollective("https://example.com/article", statuses);
      const annotation = api.hypothesisThreadIndex([{ id: "root", text: "Root" }, { id: "child", text: "Reply", references: ["root"] }], { key: "hypothesis:thread" });
      const wikipedia = api.indexWikipediaPage([{ type: "comment", id: "root", html: '<p><a href="https://example.com/article">Article</a></p>', replies: [{ type: "comment", id: "child", html: "<p>Reply</p>" }] }], { key: "wikipedia:thread" }, "https://example.com/article");
      return {
        hn: { roots: hn.rootKeys, replies: hnRoot.replyKeys },
        reddit: { roots: reddit.rootKeys, replies: reddit.byKey.get("reddit:root").replyKeys, deleted: reddit.byKey.get("reddit:root").deleted },
        lemmy: { roots: lemmy.rootKeys, replies: lemmy.byKey.get("lemmy:1").replyKeys },
        bsky: [...byKey.values()].map(({ key, parentKey, replyKeys }) => ({ key, parentKey, replyKeys })),
        lobsters: { roots: lobsters.rootKeys, replies: lobsters.byKey.get("lobsters:root").replyKeys },
        mastodon: { roots: mastodon.rootKeys, first: api.mastodonComment(statuses[0], mastodon).key },
        hypothesis: { roots: annotation.rootKeys, replies: annotation.byKey.get("hypothesis:root").replyKeys },
        wikipedia: { roots: wikipedia.rootKeys, replies: wikipedia.byKey.get("wikipedia:root").replyKeys },
      };
    }, regions.join("\n"));
    assert.deepEqual(result.hn, { roots: ["hn:2"], replies: ["hn:3"] });
    assert.deepEqual(result.reddit, { roots: ["reddit:root"], replies: ["reddit:child"], deleted: false });
    assert.deepEqual(result.lemmy, { roots: ["lemmy:1"], replies: ["lemmy:2"] });
    assert.equal(result.bsky.length, 2);
    assert.equal(result.bsky[1].parentKey, result.bsky[0].key);
    assert.deepEqual(result.bsky[0].replyKeys, [result.bsky[1].key]);
    assert.deepEqual(result.lobsters, { roots: ["lobsters:root"], replies: ["lobsters:child"] });
    assert.equal(result.mastodon.roots.length, 2);
    assert.equal(result.mastodon.first, result.mastodon.roots[0]);
    assert.deepEqual(result.hypothesis, { roots: ["hypothesis:root"], replies: ["hypothesis:child"] });
    assert.deepEqual(result.wikipedia, { roots: ["wikipedia:root"], replies: ["wikipedia:child"] });
  } finally {
    await browser.close();
  }
});
