// Runs the userscript against synthetic articles, sources, and manager storage.
// Unhandled browser requests are blocked so these tests do not depend on live APIs.

import { chromium, webkit } from "playwright";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const TYPES = { ".html": "text/html; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

export const NOW = 1789430400;

const GC = [
	"Garbage collection pauses are the single most misunderstood cost in managed runtimes today, and the confusion starts with how they get reported.",
	"Manual allocation avoids the pause entirely but transfers the burden onto every caller in the system, which is a trade most teams make without noticing.",
	"Reference counting occupies a middle position, with deterministic destruction costs that are spread thinly across every single assignment you perform.",
	"Throughput benchmarks disagree with latency percentiles about which approach wins, and the disagreement is not a measurement error but a real tension.",
	"Compiler inlining and monomorphization change the shape of the generated code enough that allocation counts measured on debug builds mean very little.",
	"Scheduler preemption and fairness quantums interact badly with long collector pauses, producing tail latencies that look like network problems.",
	"The filesystem journal and fsync durability guarantees add another layer, because a pause during a flush is indistinguishable from a slow disk.",
];

export const LATE_QUOTE =
	"Profilers using sampling rather than instrumentation systematically undercount short pauses";

const FILLER = Array.from(
	{ length: 24 },
	(_, i) => `Filler paragraph ${i + 1} is here so the article runs long enough to scroll, and it says nothing a comment would quote.`,
);

const HEAVY_ARTICLE = Number(process.env.BC_HEAVY_ARTICLE || 0);
const HEAVY_ARTICLE_TAIL = Array.from(
	{ length: HEAVY_ARTICLE },
	(_, i) => `<p>Heavy paragraph ${i + 1} carries <a href="#h${i}">a link</a>, <em>some emphasis</em>, <code>inline code</code> and <span style="font-weight:600">a styled run</span> so each reflow has real inline boxes to place across the whole column of text.</p>`,
).join("");

const body = () =>
	[...GC, ...FILLER, `${LATE_QUOTE}, which is precisely the regime where they matter most.`]
		.map((text) => `<p>${text}</p>`)
		.join("\n") +
	HEAVY_ARTICLE_TAIL;

function article({ title, head = "", tail = "" }) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} | Fixture</title><meta property="og:title" content="${title}">${head}</head><body><nav><a href="/">Home</a> <a href="/about">About</a></nav><main><article><h1>${title}</h1>${body()}<p><a id="onward-link" href="https://framed.example.com/post/8">Read the related post</a></p></article></main><footer><button type="button">Share</button> Fixture footer</footer>${tail}</body></html>`;
}

const ARTICLES = {
	"https://framed.example.com/gc": { headers: {}, html: () => article({ title: "The cost nobody measures" }) },
	"https://refused.example.org/gc": { headers: { "x-frame-options": "DENY" }, html: () => article({ title: "The cost nobody measures, refused" }) },
	"https://buster.example.net/post": {
		headers: {},
		html: () => article({ title: "A page that busts frames", tail: "<script>if (top !== self) { try { top.location = self.location.href; } catch (e) {} }</script>" }),
	},
	"https://cloak.example.com/post": {
		headers: {},
		html: () => article({ title: "A page that hides itself in frames", head: '<style id="ac">body{display:none !important}</style>', tail: '<script>if (self === top) document.getElementById("ac").remove();</script>' }),
	},
	"https://plain.example.org/post": { headers: {}, html: () => article({ title: "A page the manager skipped" }) },
	"https://spa.example.net/app": {
		headers: { "content-security-policy": "frame-ancestors 'none'" },
		html: () => '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script>window.app = 1;</script></body></html>',
	},
	"http://insecure.example.com/post": { headers: {}, html: () => article({ title: "An article over http" }) },
};

export function articleFor(url) {
	const known = ARTICLES[url];

	if (known) {
		return { status: 200, headers: known.headers, html: known.html() };
	}

	const post = /^https:\/\/framed\.example\.com\/post\/(\d+)$/.exec(url);

	return post ? { status: 200, headers: {}, html: article({ title: `Fixture story ${post[1]}` }) } : null;
}

const LEADS = [
	["The cost nobody measures", "https://framed.example.com/gc"],
	["The cost nobody measures, refused", "https://refused.example.org/gc"],
	["A page that busts frames", "https://buster.example.net/post"],
	["A page that hides itself in frames", "https://cloak.example.com/post"],
	["A page the manager skipped", "https://plain.example.org/post"],
	["An app with nothing to read", "https://spa.example.net/app"],
	["An article over http", "http://insecure.example.com/post"],
];

const HEAVY_COMMENTS = Number(process.env.BC_HEAVY_COMMENTS || 0);

export const STORIES = Array.from({ length: 40 }, (_, i) => {
	const [title, url] = LEADS[i] || [`Fixture story ${i + 1}`, `https://framed.example.com/post/${i + 1}`];

	return { id: 9001 + i, title, url, by: `user${i + 1}`, points: 300 - i * 5, comments: i === 0 && HEAVY_COMMENTS ? HEAVY_COMMENTS : i < 2 ? 30 : 3, time: NOW - 3600 * (i + 1) };
});

const QUOTES = [
	"&gt; Manual allocation avoids the pause entirely but transfers the burden onto every caller in the system<p>That is the whole article in one line.",
	"&gt; Throughput benchmarks disagree with latency percentiles about which approach wins<p>Which is why p99 is the only number worth publishing.",
	`&gt; ${LATE_QUOTE}<p>The last paragraph is the one that matters.`,
];

function storiesWith(resubmissions) {
	return [
		...STORIES,
		...Array.from({ length: resubmissions }, (_, k) => ({
			id: 9100 + k,
			title: STORIES[0].title,
			url: STORIES[0].url,
			by: `resubmitter${k + 1}`,
			points: 120 - k * 9,
			comments: 90 - k * 8,
			time: STORIES[0].time - 86400 * (k + 1),
		})),
	];
}

export const COMMENT_TEXT = new Map();

function commentsFor(story, live = []) {
	return Array.from({ length: story.comments }, (_, k) => ({
		id: story.id * 100 + k,
		type: "comment",
		by: `commenter${k + 1}`,
		parent: story.id,
		time: live.includes(story.id) ? Math.floor(Date.now() / 1000) - 60 * (k + 1) : story.time + 60 * (k + 1),
		text: COMMENT_TEXT.get(story.id * 100 + k) || (story.id <= 9002 && QUOTES[k]) || `Comment ${k + 1} on ${story.title}, long enough to take a line or two in the panel so the discussion scrolls.`,
		kids: [],
	}));
}

function frontPageHTML(listed = STORIES) {
	const rows = listed.map((story) => {
		const host = story.url ? new URL(story.url).hostname : "";
		const link = story.url || `item?id=${story.id}`;
		const site = host ? `<span class="sitebit comhead"> (<a href="from?site=${host}"><span class="sitestr">${host}</span></a>)</span>` : "";

		return `<tr class="athing" id="${story.id}"><td class="title"><span class="titleline"><a href="${link}">${story.title}</a>${site}</span></td></tr>
<tr><td class="subtext"><span class="subline"><span class="score" id="score_${story.id}">${story.points} points</span> by <a href="user?id=${story.by}" class="hnuser">${story.by}</a> <span class="age" title="${new Date(story.time * 1000).toISOString().slice(0, 19)}"><a href="item?id=${story.id}">1 hour ago</a></span> | <a href="item?id=${story.id}">${story.comments} comments</a></span></td></tr>`;
	});

	return `<html><body><table>${rows.join("\n")}</table></body></html>`;
}

const strip = (url) => String(url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
const json = (value) => ({ status: 200, headers: "content-type: application/json", text: JSON.stringify(value) });

function hnResponse(url, stories = STORIES, votable = {}, live = [], front = STORIES) {
	let parsed;

	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	if (parsed.hostname === "news.ycombinator.com" && parsed.pathname === "/news") {
		return { status: 200, headers: "content-type: text/html", text: frontPageHTML(front) };
	}

	if (parsed.hostname === "news.ycombinator.com" && parsed.pathname === "/item") {
		const id = parsed.searchParams.get("id");
		const vote = votable[id];

		if (!vote) {
			return null;
		}

		const auth = `auth=check${id}&amp;goto=item%3Fid%3D${id}`;
		const links =
			vote === "voted"
				? `<a id="up_${id}" class="clicky nosee" href="vote?id=${id}&amp;how=up&amp;${auth}"><div class="votearrow"></div></a><a id="un_${id}" href="vote?id=${id}&amp;how=un&amp;${auth}">unvote</a>`
				: `<a id="up_${id}" class="clicky" href="vote?id=${id}&amp;how=up&amp;${auth}"><div class="votearrow"></div></a>${vote === "updown" ? `<a id="down_${id}" class="clicky" href="vote?id=${id}&amp;how=down&amp;${auth}"><div class="votearrow rotate180"></div></a>` : ""}`;

		return { status: 200, headers: "content-type: text/html", text: `<html><body><table><tr class="athing" id="${id}"><td class="votelinks"><center>${links}</center></td><td class="title">Story</td></tr></table></body></html>` };
	}

	if (parsed.hostname === "hn.algolia.com") {
		const query = strip(parsed.searchParams.get("query"));
		const hits = stories.filter((story) => strip(story.url) === query).map((story) => ({
			objectID: String(story.id),
			title: story.title,
			url: story.url,
			author: story.by,
			points: story.points,
			num_comments: story.comments,
			created_at_i: story.time,
		}));

		return json({ hits, nbHits: hits.length });
	}

	const item = /^\/v0\/item\/(\d+)\.json$/.exec(parsed.pathname);

	if (parsed.hostname === "hacker-news.firebaseio.com" && item) {
		const id = Number(item[1]);
		const story = stories.find((each) => each.id === id);

		if (story) {
			return json({ id, type: "story", by: story.by, title: story.title, url: story.url, score: story.points, time: story.time, descendants: story.comments, kids: commentsFor(story, live).map((comment) => comment.id) });
		}

		const parent = stories.find((each) => each.id === Math.floor(id / 100));
		const comment = parent && commentsFor(parent, live).find((each) => each.id === id);

		return comment ? json(comment) : json(null);
	}

	return null;
}

function answer({ url, responseType = "" }, stories = STORIES, votable = {}, live = [], lookup = articleFor, front = STORIES) {
	const hn = hnResponse(url, stories, votable, live, front);

	if (hn) {
		return { status: hn.status, finalUrl: url, responseHeaders: hn.headers, text: hn.text };
	}

	const found = lookup(url);
	const page = found?.fetch ? { status: found.fetch.status ?? 200, headers: found.fetch.headers || {}, html: found.fetch.html || "", body: found.fetch.body } : found;

	if (page) {
		const headers = { "content-type": "text/html; charset=utf-8", ...page.headers };

		const binary = page.body && /^(blob|arraybuffer)$/.test(responseType) ? Buffer.from(page.body).toString("base64") : "";

		return { status: page.status, finalUrl: url, responseHeaders: Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n"), text: page.html ?? "", base64: binary };
	}

	return { status: 404, finalUrl: url, responseHeaders: "", text: "" };
}

function boot({ injectTop, skipFrameHosts, settings, values, appHost, topHosts = [], shared = false, version = "check", handler = undefined, injectDelay = 0, tabs = false }) {
	const inFrame = window.top !== window.self;

	if (!/^https?:$/.test(location.protocol)) {
		return;
	}

	if (inFrame ? skipFrameHosts.includes(location.hostname) : !(injectTop && (location.hostname === appHost || topHosts.includes(location.hostname)))) {
		return;
	}

	const store = new Map([["HNewhere:settings", settings], ["HNewhere:seeded_sources", 1], ...Object.entries(values)]);

	window.unsafeWindow = window;
	window.GM = {
		info: { script: { version }, scriptHandler: handler },
		// BC_GM_TABS=1: the manager-tab API, as the Userscripts app has it, backed by window.open.
		...(tabs ? { openInTab: async (url, background) => { window.__tabs = window.__tabs || new Map(); const id = window.__tabs.size + 1; const w = window.open(url, "_blank"); if (!w) return null; window.__tabs.set(id, w); return { id, active: !background }; }, closeTab: async (id) => { if (id != null) { window.__tabs?.get(id)?.close(); return; } window.close(); } } : {}),
		getValue: async (key, fallback) => {
			if (shared) {
				const answer = await window.__gmStore("get", key);

				return answer.has ? answer.value : fallback;
			}

			return store.has(key) ? store.get(key) : fallback;
		},
		setValue: async (key, value) => {
			if (shared) {
				await window.__gmStore("set", key, value);
				return;
			}

			store.set(key, value);
		},
		deleteValue: async (key) => {
			if (shared) {
				await window.__gmStore("delete", key);
				return;
			}

			store.delete(key);
		},
		deleteValues: async (keys) => {
			if (shared) {
				await window.__gmStore("deleteMany", keys);
				return;
			}

			keys.forEach((key) => store.delete(key));
		},
		listValues: async () => (shared ? await window.__gmStore("list") : [...store.keys()]),
		getResourceText: async () => "",
		xmlHttpRequest(options) {
			window.__gmXHR({ url: options.url, method: options.method || "GET", anonymous: Boolean(options.anonymous), responseType: options.responseType || "" }).then(
				(response) => {
					const bytes = response.base64 ? Uint8Array.from(atob(response.base64), (c) => c.charCodeAt(0)) : null;
					const type = /content-type:\s*([^\r\n;]+)/i.exec(response.responseHeaders || "")?.[1] || "";
					const body = bytes ? (options.responseType === "arraybuffer" ? bytes.buffer : new Blob([bytes], { type })) : undefined;

					options.onload?.({ status: response.status, finalUrl: response.finalUrl, responseHeaders: response.responseHeaders, responseText: response.text, response: body ?? response.text });
				},
				() => options.onerror?.({ error: "failed" }),
			);

			return { abort() {} };
		},
	};

	const run = () => {
		const script = document.createElement("script");

		script.textContent = window.__bcSource;
		document.documentElement.appendChild(script);
	};

	const later = () => (injectDelay && !inFrame ? setTimeout(run, injectDelay) : run());

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", later, { once: true });
	} else {
		later();
	}
}

export async function launchApp({
	viewport = { width: 1440, height: 900 },
	colorScheme = "light",
	injectTop = true,
	skipFrameHosts = ["plain.example.org"],
	settings = {},
	values = {},
	hasTouch = false,
	timezoneId = undefined,
	engine = process.env.ENGINE || "chromium",
	resubmissions = Number(process.env.BC_RESUBMISSIONS || 0),
	source = null,
	scale = 1,
	votable = {},
	live = [],
	pages = {},
	appHost = "backchnnl.app",
	topHosts = [],
	sharedStore = false,
	extraStories = [],
	version = "check",
	handler = undefined,
	tabs = process.env.BC_GM_TABS === "1",
	responses = [],
	appHeaders = {},
	launchOptions = {},
	injectDelay = 0,
	slowGets = { key: "", ms: 0, armed: false },
} = {}) {
	const pageFor = (url) => (pages[url] ? { status: pages[url].status ?? 200, headers: pages[url].headers || {}, html: pages[url].html, body: pages[url].body, fetch: pages[url].fetch } : articleFor(url));

	source = source ?? (await readFile(process.env.BC_SCRIPT || join(ROOT, "HNewhere.user.js"), "utf8"));
	const browser = await (engine === "webkit" ? webkit : chromium).launch(launchOptions);
	const context = await browser.newContext({ viewport, colorScheme, hasTouch, deviceScaleFactor: scale, ...(timezoneId ? { timezoneId } : {}) });
	await context.route("**/*", (route) => route.abort("blockedbyclient"));
	const requests = [];
	const extra = extraStories.map((each, k) => ({ id: 9200 + k, by: `extra${k + 1}`, points: 1, comments: 3, time: NOW - 3600 * (50 + k), ...each }));
	const stories = [...storiesWith(resubmissions), ...extra];
	const front = [...STORIES, ...extra];

	await context.exposeFunction("__gmXHR", async (options) => {
		requests.push(options);

		const canned = responses.find((each) => each.match(options.url));

		if (canned) {
			if (canned.delay) await new Promise((resolve) => setTimeout(resolve, canned.delay));

			return { status: canned.status ?? 200, finalUrl: options.url, responseHeaders: canned.headers || "content-type: application/json", text: JSON.stringify(canned.json ?? {}) };
		}

		return answer(options, stories, votable, live, pageFor, front);
	});

	await context.route(`https://${appHost}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		const file = join(ROOT, "site", path === "/" ? "index.html" : path);

		try {
			await route.fulfill({ status: 200, headers: { "content-type": TYPES[extname(file)] || "application/octet-stream", ...(extname(file) === ".html" ? appHeaders : {}) }, body: await readFile(file) });
		} catch {
			await route.fulfill({ status: 404, body: "not found" });
		}
	});

	await context.route(/^https?:\/\/[^/]+\.example\.(com|org|net)\//, async (route) => {
		const page = pageFor(route.request().url().replace(/#.*$/, ""));

		if (!page) {
			await route.fulfill({ status: 404, body: "not found" });
			return;
		}

		await route.fulfill({ status: page.status, headers: { "content-type": "text/html; charset=utf-8", ...page.headers }, body: page.body ?? page.html });
	});

	await context.route(/^https:\/\/news\.ycombinator\.com\//, async (route) => {
		const url = route.request().url();
		const id = new URL(url).searchParams.get("id") || "";
		const story = stories.find((each) => String(each.id) === id);

		await route.fulfill({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: `<!doctype html><html><head><meta charset="utf-8"><title>${story?.title || "Hacker News"}</title></head><body><article><h1>${story?.title || "Hacker News"}</h1><p>${story?.text || "A thread."}</p></article></body></html>` });
	});

	const store = new Map([["HNewhere:settings", { sources: { hn: true }, annotations: true, frontPageMode: "sources", ...settings }], ["HNewhere:seeded_sources", 1], ...Object.entries(values)]);

	await context.exposeFunction("__gmStore", async (op, key, value) => {
		if (op === "get") {
			if (slowGets.armed && slowGets.key === key) {
				slowGets.armed = false;
				await new Promise((resolve) => setTimeout(resolve, slowGets.ms));
			}

			return store.has(key) ? { has: true, value: store.get(key) } : { has: false };
		}

		if (op === "delete") {
			store.delete(key);
			return true;
		}

		if (op === "deleteMany") {
			key.forEach((name) => store.delete(name));
			return true;
		}

		if (op === "list") {
			return [...store.keys()];
		}

		store.set(key, value);
		return true;
	});
	await context.addInitScript({ content: `window.__bcSource = ${JSON.stringify(source)};` });
	await context.addInitScript({
		content: `(${boot.toString()})(${JSON.stringify({ injectTop, skipFrameHosts, values, appHost, topHosts, shared: sharedStore, version, handler, injectDelay, tabs, settings: { sources: { hn: true }, annotations: true, frontPageMode: "sources", ...settings } })});`,
	});

	const page = await context.newPage();
	const errors = [];

	page.on("pageerror", (error) => errors.push(error.message));
	context.on("page", (other) => other.on("pageerror", (error) => errors.push(error.message)));

	return { browser, context, page, errors, requests, store, slowGets };
}

export function reporter() {
	let failures = 0;

	return {
		check(name, ok, detail = "") {
			if (!ok) failures += 1;
			console.log(`${ok ? "ok  " : "FAIL"}  ${name}${!ok && detail ? `\n        ${detail}` : ""}`);
		},
		get failures() {
			return failures;
		},
	};
}

export async function waitFor(fn, timeout = 8000) {
	const until = Date.now() + timeout;

	while (Date.now() < until) {
		try {
			if (await fn()) return true;
		} catch {
		}

		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	return false;
}
