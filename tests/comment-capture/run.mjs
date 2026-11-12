import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const directory = fileURLToPath(new URL(".", import.meta.url));
const tests = readdirSync(directory).filter((file) => file.endsWith(".test.mjs")).sort().map((file) => join(directory, file));
if (!tests.length) throw new Error("No comment-capture tests found");
const engines = process.env.CAPTURE_ENGINES?.split(",").filter(Boolean) || ["chromium", "firefox", "webkit"];
if (!engines.length) throw new Error("No browser engines selected");
let failed = false;
for (const engine of engines) {
  if (!["chromium", "firefox", "webkit"].includes(engine)) throw new Error(`Unsupported browser: ${engine}`);
  console.log(`\nComment and discussion capture: ${engine}`);
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...tests], {
    env: { ...process.env, ENGINE: engine },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
