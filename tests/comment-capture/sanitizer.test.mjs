import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptPath = process.env.BC_SCRIPT || new URL("../../HNewhere.user.js", import.meta.url);
const source = await readFile(scriptPath, "utf8");
const position = source.indexOf("function redditReadPath(");
const start = source.lastIndexOf("// #region hnewhere-test-export", position);
const end = source.indexOf("// #endregion hnewhere-test-export", position);
assert(start >= 0 && end > start, "Reddit transport test exports are missing");
const { publicRedditJSON } = new Function(`${source.slice(start, end)}; return { publicRedditJSON };`)();

test("the signed-in bridge preserves deeply nested discussion replies", () => {
  let node = { kind: "t1", data: { id: "leaf", body: "deep reply", author: "reader", replies: "" } };
  for (let index = 0; index < 12; index++) {
    node = { kind: "t1", data: { id: `level${index}`, body: "reply", author: "reader", replies: { kind: "Listing", data: { children: [node] } } } };
  }
  const result = publicRedditJSON([{ data: { children: [] } }, { data: { children: [node] } }]);
  assert.match(JSON.stringify(result), /deep reply/);
});

test("the bridge still bounds large responses and excludes private fields", () => {
  const sanitized = publicRedditJSON({ data: { children: [{ kind: "t1", data: { id: "ok", body: "public", access_token: "private-value" } }] } });
  assert.doesNotMatch(JSON.stringify(sanitized), /private-value/);
  assert.throws(() => publicRedditJSON({ data: { children: [{ data: { body: "x".repeat(2000001) } }] } }), /too large/);
});
