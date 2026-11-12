#!/usr/bin/env node
// Runs every suite in tests/ in a real browser and reports what broke.
//
// The suites already assert their own logic; what this adds is the thing no
// suite can check about itself — that the page loaded at all, that nothing
// threw on the way, and that the userscript still parses. A suite that fails
// to boot prints "running…" forever and looks identical to one that passed
// if nobody reads it.
//
//   cd tests && npm install && npm test
//   npm run test:slow      # includes the suites that load 24 iframes
//
// The checked-in thread-cache suite runs in a clean checkout; additional local
// HTML suites are included automatically when present.

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HOSTNAME = "hnewhere.localtest.me";
let HOST = "";

// Loads two dozen saved pages in iframes; minutes, not seconds.
const SLOW = new Set(["hypothesis-anchor.html", "pdf-render-anchor.html"]);
// Harness shells and probes rather than suites.
const SKIP = new Set(["_runner.html", "_runner_laidout.html", "has-invalidation-probe.html"]);
// Suites whose subject is failure handling, so they log errors on purpose.
const LOGS_ERRORS = new Set(["write-bridge.html", "repro.html", "blocked-styles.html"]);
// Suites that load saved copies of real pages. The pages' own assets were not
// saved with them, so their requests 404 and their scripts throw; none of that
// is the suite's, which reports through its summary.
const SAVED_PAGES = new Set(["hypothesis-anchor.html"]);

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".pdf": "application/pdf",
	".xml": "application/xml",
};

function serve() {
	const server = createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url, HOST).pathname);

		try {
			const body = await readFile(join(ROOT, path));

			res.writeHead(200, {
				"content-type": TYPES[extname(path)] || "application/octet-stream",
				"cache-control": "no-store",
			});
			res.end(body);
		} catch {
			res.writeHead(404).end("not found");
		}
	});

	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// A suite reports through #summary. "all N passed" is the shape every one of
// them uses; anything else is a failure, including still saying "running…".
function readSummary(text) {
	if (!text || /running/i.test(text)) {
		return { ok: false, note: "never finished" };
	}

	// Suites report in three shapes: "all N passed", "N passed, M failed",
	// and "N assertions passed over …". Only a non-zero failure count is a fail.
	const failed = /(\d+)\s+failed/i.exec(text);

	if (failed && Number(failed[1]) > 0) {
		return { ok: false, note: text.trim() };
	}

	const passed = /all\s+(\d+)\s+passed|(\d+)\s+(?:assertions )?passed/i.exec(text);

	return passed
		? { ok: true, count: Number(passed[1] || passed[2]), note: text.trim() }
		: { ok: false, note: text.trim() || "no summary" };
}

const args = new Set(process.argv.slice(2));
const server = await serve();
HOST = `http://${HOSTNAME}:${server.address().port}`;
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOSTNAME} 127.0.0.1`] });
const candidates = (await readdir(HERE))
	.filter((f) => f.endsWith(".html") && !SKIP.has(f))
	.filter((f) => {
		const only = [...args].filter((a) => !a.startsWith("--"));
		return !only.length || only.some((o) => f.includes(o));
	})
	.sort();
const skippedSlow = args.has("--all") ? 0 : candidates.filter((file) => SLOW.has(file)).length;
const files = candidates.filter((file) => args.has("--all") || !SLOW.has(file));

let failures = 0;
let total = 0;
const skipped = [];

for (const file of files) {
	const page = await browser.newPage();
	const noise = [];

	page.on("console", (m) => {
		if (m.type() === "error" && !/favicon/i.test(m.text()) && !LOGS_ERRORS.has(file) && !SAVED_PAGES.has(file)) {
			noise.push(m.text().slice(0, 160));
		}
	});
	page.on("pageerror", (e) => {
		if (!SAVED_PAGES.has(file)) {
			noise.push("uncaught: " + e.message.slice(0, 160));
		}
	});

	let verdict;

	try {
		await page.goto(`${HOST}/tests/${file}`, { waitUntil: "load", timeout: 20000 });
		await page
			.waitForFunction(
				() => !/running/i.test(document.getElementById("summary")?.textContent || "running"),
				null,
				{ timeout: SLOW.has(file) ? 300000 : 30000 },
			)
			.catch(() => {});

		const found = await page.evaluate(() => {
			const el = document.getElementById("summary");
			return el ? el.textContent : null;
		});

		// No #summary at all means a fixture or a hand-driven repro page, which
		// is not the same as a suite that hung before it could report.
		verdict = found === null ? { ok: true, note: "no summary" } : readSummary(found);

		if (found !== null && !verdict.ok) {
			verdict.fails = await page.evaluate(() =>
				(document.getElementById("out")?.textContent || "")
					.split("\n")
					.filter((line, i, all) => /^FAIL\b/.test(line) || /^FAIL\b/.test(all[i - 1] || ""))
					.slice(0, 12),
			);
		}
	} catch (error) {
		verdict = { ok: false, note: error.message.split("\n")[0].slice(0, 120) };
	}

	await page.close();

	// A suite with no #summary is a fixture page, not a failure.
	if (verdict.note === "no summary") {
		skipped.push(file);
		continue;
	}

	total += verdict.count || 0;

	const bad = !verdict.ok || noise.length;

	if (bad) failures += 1;

	console.log(
		`${bad ? "FAIL" : "ok  "}  ${file.padEnd(30)} ${verdict.note}` +
			(noise.length ? `\n        console: ${noise.slice(0, 3).join("\n        ")}` : "") +
			(verdict.fails?.length ? `\n        ${verdict.fails.join("\n        ")}` : ""),
	);
}

await browser.close();
server.close();

console.log(
	`\n${failures ? `${failures} suite(s) failed` : "all suites passed"} — ` +
		`${total} assertions across ${files.length - skipped.length} suites` +
		(skipped.length ? `, ${skipped.length} pages had no summary` : "") +
		(skippedSlow ? `, ${skippedSlow} slow suites skipped (--all to include)` : ""),
);

process.exit(failures ? 1 : 0);
