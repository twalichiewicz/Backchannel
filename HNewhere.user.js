// ==UserScript==
// @name         HNewhere
// @namespace    https://github.com/twalichiewicz/HNewhere
// @version      1.5.2
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @downloadURL  https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @homepageURL  https://github.com/twalichiewicz/HNewhere
// @supportURL   https://github.com/twalichiewicz/HNewhere/issues
// @description  Hacker News comments sidebar for any article
// @include      http://*
// @include      https://*
// @exclude      http://localhost/*
// @exclude      https://localhost/*
// @exclude      https://www.google.com/*
// @exclude      https://www.google.*/*
// @exclude      https://chatgpt.com/
// @exclude      https://claude.ai/
// @exclude      https://x.com/
// @exclude      https://*.google.com/*
// @exclude      https://accounts.google.com/*
// @exclude      https://mail.google.com/*
// @exclude      https://mail.*.*/*
// @exclude      https://*.bank.com/*
// @exclude      https://*.googleusercontent.com/*
// @exclude      https://*.doubleclick.net/*
// @exclude      https://*.facebook.com/*
// @exclude      https://*.twitter.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      hacker-news.firebaseio.com
// @connect      hn.algolia.com
// @connect      news.ycombinator.com
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
	"use strict";

	const OLD_STORAGE = {
		width: "hn_width",
		position: "hn_button_position",
		last: "hn_last",
		collapsed: "hn_collapsed_comments",
		seen: "hn_seen_comments",
	};

	async function migrateStorage() {
		const migrated = await load("HNewhere:migrated", false);

		if (migrated) return;

		try {
			for (const key of Object.keys(OLD_STORAGE)) {
				const oldKey = OLD_STORAGE[key];
				const newKey = STORAGE[key];

				if (!oldKey || !newKey) {
					continue;
				}

				const oldValue = await load(oldKey, null);

				if (oldValue !== null) {
					await save(newKey, oldValue);
				}
			}

			await save("HNewhere:migrated", 1);
		} catch (e) {
			console.error("HNewhere migration failed:", e);
		}
	}

	const STORAGE = {
		width: "HNewhere:width",
		widths: "HNewhere:width_by_site",
		position: "HNewhere:button_position",
		last: "HNewhere:last",
		collapsed: "HNewhere:collapsed_comments",
		seen: "HNewhere:seen_comments",
		settings: "HNewhere:settings",
		state: "HNewhere:sidebar_state",
		votes: "HNewhere:votes",
	};

	// Votes have to be remembered locally. The sidebar reads HN over a cross-site
	// GM request, which the browser strips the SameSite session cookie from, so a
	// fetched page always reports "not voted" no matter what you have voted on.
	// Only the popup sees the real state, so what it reports is recorded here and
	// replayed over anonymously fetched pages.
	const VOTE_MEMORY_TTL = 90 * 24 * 60 * 60 * 1000;

	const DEFAULT_SETTINGS = {
		annotations: false,
		annotationsWhenSidebarOpen: true,
		annotationsWhenSidebarClosed: false,
		autoOpenSidebar: false,
	};

	const HN_ORIGIN = "https://news.ycombinator.com";
	const VOTE_BRIDGE_MESSAGE_SOURCE = "HNewhereVoteBridge";

	// The popup votes by navigating to the vote URL, and HN's goto redirect drops
	// the URL fragment, so the bridge payload cannot ride the hash across it.
	// sessionStorage is per-tab and per-origin, which is exactly the popup's life.
	const VOTE_BRIDGE_STORAGE_KEY = "hnewhere-vote-bridge";
	const TRACKING_PARAMS = new Set([
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
		"fbclid",
		"gclid",
	]);

	let sidebar = null;
	let sidebarUI = null;
	let opening = false;
	let sidebarGeneration = 0;
	let renderedComments = [];
	let annotationController = null;
	let activeCommentFilter = null;

	// -------------------------
	// Storage
	// -------------------------

	async function save(key, value) {
		await GM.setValue(key, value);
	}

	async function load(key, fallback) {
		try {
			return await GM.getValue(key, fallback);
		} catch {
			return fallback;
		}
	}

	async function loadCollapsed() {
		const ids = await load(STORAGE.collapsed, []);
		return new Set(Array.isArray(ids) ? ids : []);
	}

	async function saveCollapsed(ids) {
		await save(STORAGE.collapsed, ids);
	}

	async function getSeenTime(storyID) {
		const seen = await load(STORAGE.seen, {});
		return seen[storyID] || 0;
	}

	async function markSeen(storyID) {
		const seen = await load(STORAGE.seen, {});

		seen[storyID] = Math.floor(Date.now() / 1000);

		await save(STORAGE.seen, seen);
	}

	async function toggleCollapsed(id, collapsed) {
		const ids = new Set(await loadCollapsed());

		if (collapsed) {
			ids.add(id);
		} else {
			ids.delete(id);
		}

		await saveCollapsed([...ids]);
	}

	async function loadSettings() {
		const stored = await load(STORAGE.settings, {});
		const merged = {
			...DEFAULT_SETTINGS,
			...(stored && typeof stored === "object" ? stored : {}),
		};

		if (merged.annotationsWhenSidebarOpen == null) {
			merged.annotationsWhenSidebarOpen = Boolean(merged.annotations);
		}

		if (merged.annotationsWhenSidebarClosed == null) {
			merged.annotationsWhenSidebarClosed = false;
		}

		return merged;
	}

	async function saveSettings(patch) {
		const next = {
			...(await loadSettings()),
			...patch,
		};

		await save(STORAGE.settings, next);

		return next;
	}

	function siteKey() {
		return location.hostname;
	}

	async function loadSiteWidth() {
		const widths = await load(STORAGE.widths, {});
		const perSiteWidth =
			widths && typeof widths === "object" ? widths[siteKey()] : undefined;

		if (typeof perSiteWidth === "number" && Number.isFinite(perSiteWidth)) {
			return perSiteWidth;
		}

		// Read with a null default so a genuinely stored width is distinguishable
		// from never having set one -- otherwise the mobile default below could
		// never apply.
		const savedWidth = await load(STORAGE.width, null);

		if (typeof savedWidth === "number" && Number.isFinite(savedWidth)) {
			return savedWidth;
		}

		// Dragging the resize handle on a touch screen is fiddly, so pick something
		// usable rather than leaving it to be corrected by hand. A portrait phone
		// takes the full width; three quarters still left the comments squeezed.
		if (isPortraitPhone()) {
			return window.innerWidth - PORTRAIT_SIDEBAR_GUTTER;
		}

		return isMobile() ? Math.round(window.innerWidth * 0.75) : 420;
	}

	async function saveSiteWidth(width) {
		if (typeof width !== "number" || !Number.isFinite(width)) {
			return;
		}

		const widths = await load(STORAGE.widths, {});
		const nextWidths =
			widths && typeof widths === "object" && !Array.isArray(widths)
				? { ...widths }
				: {};

		nextWidths[siteKey()] = width;
		await save(STORAGE.widths, nextWidths);
	}

	async function loadSidebarState() {
		const states = await load(STORAGE.state, {});
		const state =
			states && typeof states === "object" ? states[siteKey()] : undefined;

		return state === "open" || state === "collapsed" ? state : null;
	}

	async function saveSidebarState(state) {
		if (state !== "open" && state !== "collapsed") {
			return;
		}

		const states = await load(STORAGE.state, {});
		const nextStates =
			states && typeof states === "object" && !Array.isArray(states)
				? { ...states }
				: {};

		nextStates[siteKey()] = state;
		await save(STORAGE.state, nextStates);
	}

	// -------------------------
	// Remembered votes
	// -------------------------

	// Mirrors the persisted map so render paths stay synchronous. Populated once
	// at startup by loadRememberedVotes().
	let rememberedVotes = {};

	async function loadRememberedVotes() {
		const stored = await load(STORAGE.votes, {});
		const now = Date.now();
		const kept = {};
		let expired = 0;

		if (stored && typeof stored === "object" && !Array.isArray(stored)) {
			for (const [itemId, record] of Object.entries(stored)) {
				if (!record || typeof record !== "object" || !record.state) {
					continue;
				}

				if (Number.isFinite(record.ts) && now - record.ts > VOTE_MEMORY_TTL) {
					expired++;
					continue;
				}

				kept[itemId] = record;
			}
		}

		rememberedVotes = kept;

		if (expired) {
			await save(STORAGE.votes, kept);
		}
	}

	function rememberVote(itemId, voteInfo) {
		const key = String(itemId);
		const state = voteInfo?.state;

		if (state === "up" || state === "down") {
			rememberedVotes[key] = {
				state,
				// Kept so the vote can still be undone later: HN does not render an
				// unvote link on a plain page load, and the arrow it does render for
				// something already voted on carries no auth token.
				unUrl: voteInfo.unUrl || null,
				ts: Date.now(),
			};
		} else if (!(key in rememberedVotes)) {
			return;
		} else {
			delete rememberedVotes[key];
		}

		save(STORAGE.votes, rememberedVotes).catch(console.error);
	}

	// Replays what the popup told us over a page HN served anonymously.
	function applyRememberedVotes(voteLinks) {
		for (const [itemId, record] of Object.entries(rememberedVotes)) {
			const entry = voteLinks.get(itemId);

			if (!entry) {
				continue;
			}

			// A fetched page cannot contradict this: it never sees any vote at all.
			entry.state = record.state;
			entry.unUrl = entry.unUrl || record.unUrl;
		}

		return voteLinks;
	}

	// -------------------------
	// Network
	// -------------------------

	function request(url) {
		return new Promise((resolve) => {
			GM.xmlHttpRequest({
				method: "GET",

				url: url,

				timeout: 10000,

				onload: function (response) {
					try {
						resolve(JSON.parse(response.responseText));
					} catch {
						resolve(null);
					}
				},

				onerror: function () {
					resolve(null);
				},

				ontimeout: function () {
					resolve(null);
				},
			});
		});
	}

	function requestText(url) {
		return new Promise((resolve) => {
			GM.xmlHttpRequest({
				method: "GET",
				url,
				timeout: 10000,
				anonymous: false,
				onload: function (response) {
					resolve(response.responseText || "");
				},
				onerror: function () {
					resolve("");
				},
				ontimeout: function () {
					resolve("");
				},
			});
		});
	}

	const itemCache = new Map();
	const voteLinkCache = new Map();
	const displayAgeCache = new Map();
	const voteBridgeRequests = new Map();

	async function getItem(id) {
		if (itemCache.has(id)) {
			return itemCache.get(id);
		}

		const item = await request(
			"https://hacker-news.firebaseio.com/v0/item/" + id + ".json",
		);

		itemCache.set(id, item);

		return item;
	}

	// Stories reach the sort in two shapes: Algolia hits from findHN and Firebase
	// items from loadStories. Reading both here keeps one ordering rule instead of
	// two that can disagree.
	function discussionRank(story) {
		return {
			comments: story.descendants ?? story.num_comments ?? 0,
			points: story.score ?? story.points ?? 0,
			time: story.time ?? story.created_at_i ?? 0,
		};
	}

	// Ordered by how much discussion there is to read, not by recency. The same
	// article gets resubmitted, and the newest submission is routinely a 0-comment
	// repost while the thread worth reading is days old -- putting the empty one
	// first buries the only discussion there is. Recency is only the tie-break.
	function compareStoriesByDiscussion(a, b) {
		const left = discussionRank(a);
		const right = discussionRank(b);

		return (
			right.comments - left.comments ||
			right.points - left.points ||
			right.time - left.time
		);
	}

	async function findHN(url) {
		const target = normalizeURL(url);

		if (!target) {
			return [];
		}

		const cacheKey = "HNewhere:hn_cache:" + target;

		const cached = await load(cacheKey, null);

		if (cached && Date.now() - cached.timestamp < 3600000) {
			// Re-sorted on read rather than trusted as stored, so an ordering change
			// applies immediately instead of waiting out an hour of cached results.
			return [...cached.results].sort(compareStoriesByDiscussion);
		}

		const queries = [url, target];

		const matches = new Map();

		for (const query of queries) {
			const result = await request(
				"https://hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=20&query=" +
					encodeURIComponent(query),
			);

			if (!result || !result.hits) {
				continue;
			}

			for (const item of result.hits) {
				if (normalizeURL(item.url) === target) {
					matches.set(item.objectID, item);
				}
			}
		}

		const sorted = [...matches.values()].sort(compareStoriesByDiscussion);

		await save(cacheKey, {
			timestamp: Date.now(),
			results: sorted,
		});

		return sorted;
	}

	// -------------------------
	// Helpers
	// -------------------------

	function normalizeURL(url) {
		try {
			const u = new URL(url);
			const keysToRemove = [];

			for (const key of u.searchParams.keys()) {
				if (TRACKING_PARAMS.has(key.toLowerCase())) {
					keysToRemove.push(key);
				}
			}

			for (const key of keysToRemove) {
				u.searchParams.delete(key);
			}

			return (
				u.hostname.toLowerCase() +
				u.pathname.replace(/\/$/, "") +
				u.search
			);
		} catch {
			return "";
		}
	}

	function sanitizeHTML(html) {
		const template = document.createElement("template");
		template.innerHTML = html || "";

		const allowedTags = new Set([
			"A",
			"P",
			"PRE",
			"CODE",
			"B",
			"STRONG",
			"I",
			"EM",
			"BLOCKQUOTE",
			"BR",
			"TT",
			"UL",
			"OL",
			"LI",
			"HR",
		]);

		function cleanNode(node) {
			for (const child of [...node.childNodes]) {
				if (child.nodeType !== Node.ELEMENT_NODE) {
					continue;
				}

				if (!allowedTags.has(child.tagName)) {
					const fragment = document.createDocumentFragment();

					while (child.firstChild) {
						fragment.appendChild(child.firstChild);
					}

					child.replaceWith(fragment);
					continue;
				}

				const originalText = child.textContent;

				let safeHref = null;

				if (child.tagName === "A") {
					const href = child.getAttribute("href");

					try {
						const url = new URL(href, location.origin);

						if (url.protocol !== "http:" && url.protocol !== "https:") {
							throw new Error();
						}

						safeHref = url.href;
					} catch {
						child.replaceWith(document.createTextNode(originalText));
						continue;
					}
				}

				for (const attr of [...child.attributes]) {
					child.removeAttribute(attr.name);
				}

				if (safeHref) {
					child.setAttribute("href", safeHref);
					child.setAttribute("target", "_blank");
					child.setAttribute("rel", "noopener noreferrer");
				}

				cleanNode(child);
			}
		}

		cleanNode(template.content);

		return template.innerHTML;
	}

	function escapeHTML(value) {
		return String(value || "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function pluralize(value, singular, plural = singular + "s") {
		return value + " " + (value === 1 ? singular : plural);
	}

	function timeAgo(timestamp) {
		if (!timestamp) return "";

		const seconds = Math.floor(Date.now() / 1000 - timestamp);

		if (seconds < 60) return "just now";

		const minutes = Math.floor(seconds / 60);

		if (minutes < 60) return pluralize(minutes, "minute") + " ago";

		const hours = Math.floor(minutes / 60);

		if (hours < 24) return pluralize(hours, "hour") + " ago";

		const days = Math.floor(hours / 24);

		return pluralize(days, "day") + " ago";
	}

	function isNewComment(comment, seenTimestamp) {
		return comment.time && comment.time > seenTimestamp;
	}

	// Sliver of the page left showing down the left edge on a portrait phone, so it
	// still reads as a panel over the article rather than a new page.
	const PORTRAIT_SIDEBAR_GUTTER = 28;

	// The case where a partial-width sidebar leaves the comment column too narrow to
	// read. Keyed on viewport size rather than isMobile(), which counts any touch
	// device: a portrait iPad has plenty of room and should keep the 80% cap, as
	// should landscape phones.
	function isPortraitPhone() {
		return (
			window.matchMedia("(max-width: 700px)").matches &&
			window.innerHeight >= window.innerWidth
		);
	}

	function maxSidebarWidth() {
		return isPortraitPhone()
			? window.innerWidth - PORTRAIT_SIDEBAR_GUTTER
			: window.innerWidth * 0.8;
	}

	function isMobile() {
		return (
			window.matchMedia("(max-width: 700px)").matches ||
			"ontouchstart" in window ||
			navigator.maxTouchPoints > 0
		);
	}

	function applyButtonMobileStyle(button) {
		Object.assign(button.style, {
			boxSizing: "border-box",
			width: "44px",
			height: "44px",
			padding: "0",
			borderRadius: "50%",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			fontSize: "13px",
			color: "white",
			top: "16px",
			right: "16px",
			opacity: "1",
		});
	}

		function createFloatingHNButton(id) {
			let button = document.getElementById(id);

			if (button) return button;

			button = document.createElement("button");
			button.id = id;
			button.textContent = "HN";
			button.title = "Hacker News discussion";

			button.style.cssText = `
					position:fixed;
					top:16px;
					right:16px;
					z-index:2147483647;
					background:#ff6600;
					color:white;
					border:none;
					border-radius:50%;
					width:44px;
					height:44px;
					padding:0;
					font-family:Verdana,sans-serif;
					font-size:13px;
					font-weight:bold;
					cursor:pointer;
					box-shadow:0 1px 4px rgba(0,0,0,.25);
					user-select:none;
					touch-action:none;
					display:flex;
					align-items:center;
					justify-content:center;
					-webkit-tap-highlight-color:transparent;
				`;

			const updateButtonStyle = () => {
				applyButtonMobileStyle(button);
			};

			updateButtonStyle();
			window.addEventListener("resize", updateButtonStyle);
			document.body.appendChild(button);

			button._cleanup = () => {
				window.removeEventListener("resize", updateButtonStyle);
			};

			return button;
		}

	// -------------------------
	// Popup helpers
	// -------------------------

	function openHNWindow(url) {
		window.open(
			url,
			"hn_popup",
			"width=760,height=700,resizable=yes,scrollbars=yes",
		);
	}

	function replyURL(comment, storyID) {
		return (
			"https://news.ycombinator.com/reply?id=" +
			comment.id +
			"&goto=item%3Fid%3D" +
			storyID +
			"%23" +
			comment.id
		);
	}

	function commentURL(storyID) {
		return HN_ORIGIN + "/item?id=" + storyID;
	}

	function normalizeVoteURL(href) {
		if (!href) {
			return null;
		}

		try {
			const url = new URL(href, HN_ORIGIN + "/");

			if (url.origin !== HN_ORIGIN || url.pathname !== "/vote") {
				return null;
			}

			return url.href;
		} catch {
			return null;
		}
	}

	function cloneVoteInfo(voteInfo) {
		if (!voteInfo) {
			return null;
		}

		return {
			upUrl: voteInfo.upUrl || null,
			downUrl: voteInfo.downUrl || null,
			unUrl: voteInfo.unUrl || null,
			state: voteInfo.state || "none",
			hasAuth: Boolean(voteInfo.hasAuth),
		};
	}

	function extractVoteLinksFromRoot(root) {
		const voteLinks = new Map();

		root.querySelectorAll("a[id]").forEach((anchor) => {
			const match = /^(up|down|un)_(\d+)$/.exec(anchor.id || "");

			if (!match) {
				return;
			}

			const [, action, itemId] = match;
			const voteURL = normalizeVoteURL(anchor.getAttribute("href"));

			if (!voteURL) {
				return;
			}

			const entry = voteLinks.get(itemId) || {
				upUrl: null,
				downUrl: null,
				unUrl: null,
				state: "none",
				hasAuth: false,
			};

			const hasAuth = new URL(voteURL).searchParams.has("auth");
			entry.hasAuth = entry.hasAuth || hasAuth;
			const hidden = (anchor.className || "").split(/\s+/).includes("nosee");

			if (action === "up") {
				entry.upUrl = voteURL;
				// hn.js does vis($('up_'+id), how == 'un'), i.e. it marks the arrows
				// `nosee` once you have voted. That is the only signal present on a
				// plain page load of something voted on earlier, since the unvote
				// link below is injected client-side at vote time.
				entry.upHidden = hidden;
			} else if (action === "down") {
				entry.downUrl = voteURL;
				entry.downHidden = hidden;
			} else {
				entry.unUrl = voteURL;

				// When an unvote link is present its label is authoritative about
				// direction: "undown" removes a downvote, "unvote" an upvote.
				if (!hidden) {
					const label = (anchor.textContent || "").trim().toLowerCase();
					entry.state = label.includes("undown") ? "down" : "up";
				}
			}

			voteLinks.set(itemId, entry);
		});

		for (const entry of voteLinks.values()) {
			// No unvote link rendered, so fall back to which arrow HN hid. One arrow
			// hidden while the other shows names the direction outright. Both hidden
			// only says a vote exists -- hn.js hides the pair either way -- so upvote
			// is the assumption there, downvoting needing karma most accounts lack.
			if (entry.state === "none") {
				if (entry.upHidden && !entry.downHidden) {
					entry.state = "up";
				} else if (entry.downHidden && !entry.upHidden) {
					entry.state = "down";
				} else if (entry.upHidden && entry.downHidden) {
					entry.state = "up";
				}
			}

			// hn.js builds the unvote href as vurl(id, 'un', auth, goto), reusing
			// the very same auth token as the up/down link, so when HN did not
			// render an unvote link it can be derived from whichever arrow is here.
			// Null when HN offered no unvote link and no arrow with a usable token,
			// which is the already-voted-in-an-earlier-session case. The unvote
			// control is simply withheld rather than rendered dead.
			if (entry.state !== "none" && !entry.unUrl) {
				entry.unUrl = deriveUnvoteURL(entry.upUrl || entry.downUrl);
			}

			// Kept off the shape cloneVoteInfo copies, but tidy up regardless.
			delete entry.upHidden;
			delete entry.downHidden;
		}

		return voteLinks;
	}

	// HN renders the real tally as <span class="score" id="score_123">45 points</span>.
	// Reading it beats adding one to a cached Firebase score, which drifts as other
	// people vote and is what made the sidebar count disagree with HN.
	function extractScoreFromRoot(root, itemId) {
		const element = root.querySelector(`[id="score_${String(itemId)}"]`);

		if (!element) {
			return null;
		}

		const match = /-?\d+/.exec(element.textContent || "");

		return match ? Number(match[0]) : null;
	}

	// HN re-dates threads it resurfaces onto the front page. The age element keeps
	// the true timestamp in its title while displaying a shifted one:
	//
	//   <span class="age" title="2026-07-25T14:08:57 1784988537">3 hours ago</span>
	//
	// Both APIs report the title value, so the displayed string exists nowhere but
	// the rendered page and cannot be derived (two comments 3d and 2d16h old both
	// render as "1 hour ago"). Reading the text is the only way to agree with HN.
	function extractDisplayAgesFromRoot(root) {
		const ages = new Map();

		root.querySelectorAll("span.age").forEach((span) => {
			const link = span.querySelector('a[href*="item?id="]');

			if (!link) {
				return;
			}

			const id = /item\?id=(\d+)/.exec(link.getAttribute("href") || "")?.[1];
			const text = (link.textContent || "").trim();

			if (id && text) {
				ages.set(id, text);
			}
		});

		return ages;
	}

	function hydrateDisplayAges(storyID) {
		const ages = displayAgeCache.get(String(storyID));

		if (!ages || !sidebarUI?.body) {
			return;
		}

		sidebarUI.body.querySelectorAll("[data-age-id]").forEach((element) => {
			const text = ages.get(String(element.dataset.ageId));

			if (text) {
				element.textContent = text;
			}
		});
	}

	function deriveUnvoteURL(voteURL) {
		if (!voteURL) {
			return null;
		}

		try {
			const url = new URL(voteURL);

			// HN renders the already-used arrow hidden and without an auth token, and
			// it ignores a vote that carries none. Deriving from one of those would
			// produce an unvote control that silently does nothing, so refuse.
			if (!url.searchParams.get("auth")) {
				return null;
			}

			url.searchParams.set("how", "un");
			return url.href;
		} catch {
			return null;
		}
	}

	function invalidateVoteLinks(storyID) {
		voteLinkCache.delete(String(storyID));
	}

	function getVoteStateValue(voteInfo) {
		if (!voteInfo) {
			return 0;
		}

		if (voteInfo.state === "up") {
			return 1;
		}

		if (voteInfo.state === "down") {
			return -1;
		}

		if (voteInfo.state === "none") {
			return 0;
		}

		return null;
	}

	// Mirrors HN's own byline: once a vote is in, the arrow disappears and an
	// unvote link takes its place -- "unvote" after an upvote, "undown" after a
	// downvote. Clicking it removes the vote.
	function updateVoteStatus(itemId, state, onUnvote) {
		const label =
			state === "up" ? "unvote" : state === "down" ? "undown" : null;

		const escapedId = CSS.escape(String(itemId));
		const selector =
			`.story-vote-status[data-vote-status-id="${escapedId}"],` +
			`.comment-vote-status[data-vote-status-id="${escapedId}"]`;

		// Scoped to the sidebar's shadow root: document.querySelector cannot
		// cross that boundary and would silently match nothing.
		(sidebarUI?.body?.querySelectorAll(selector) || []).forEach((element) => {
			element.replaceChildren();

			if (!label) {
				return;
			}

			element.appendChild(document.createTextNode(" | "));

			const button = document.createElement("button");
			button.type = "button";
			button.className = "vote-unvote-link";
			button.textContent = label;

			button.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				onUnvote?.();
			};

			element.appendChild(button);
		});
	}

	function updateCachedStoryScore(storyID, score) {
		const numericScore = Number(score);

		if (!Number.isFinite(numericScore)) {
			return;
		}

		for (const key of [String(storyID), Number(storyID)]) {
			if (!itemCache.has(key)) {
				continue;
			}

			const item = itemCache.get(key);

			if (item && typeof item === "object") {
				item.score = numericScore;
			}
		}
	}

	function updateStoryScoreDisplay(storyID, score) {
		const numericScore = Math.max(0, Math.round(Number(score)));

		if (!Number.isFinite(numericScore)) {
			return;
		}

		sidebarUI?.body
			?.querySelectorAll(`[data-story-score-id="${String(storyID)}"]`)
			.forEach((element) => {
				element.dataset.storyScore = String(numericScore);
				element.textContent = String(numericScore);
			});
	}

	function maybeUpdateStoryScoreFromVoteChange(storyID, itemId, previousVoteInfo, nextVoteInfo) {
		if (String(storyID) !== String(itemId)) {
			return;
		}

		const previousValue = getVoteStateValue(previousVoteInfo);
		const nextValue = getVoteStateValue(nextVoteInfo);

		if (previousValue == null || nextValue == null || previousValue === nextValue) {
			return;
		}

		const scoreElement = sidebarUI?.body?.querySelector(
			`[data-story-score-id="${String(storyID)}"]`,
		);
		const displayedScore = Number(
			scoreElement?.dataset.storyScore || scoreElement?.textContent,
		);
		const cachedItem = itemCache.get(String(storyID)) || itemCache.get(Number(storyID));
		const cachedScore = Number(cachedItem?.score);
		const currentScore = Number.isFinite(displayedScore)
			? displayedScore
			: cachedScore;

		if (!Number.isFinite(currentScore)) {
			return;
		}

		const nextScore = Math.max(0, currentScore + (nextValue - previousValue));
		updateCachedStoryScore(storyID, nextScore);
		updateStoryScoreDisplay(storyID, nextScore);
	}

	function setVoteInfoForStoryItem(
		storyID,
		itemId,
		voteInfo,
		authoritativeScore,
	) {
		const cacheKey = String(storyID);
		const cached = voteLinkCache.get(cacheKey);
		const nextVoteLinks = cached instanceof Map ? new Map(cached) : new Map();
		const previousVoteInfo = nextVoteLinks.get(String(itemId)) || null;

		if (voteInfo) {
			const merged = cloneVoteInfo(voteInfo);

			// The popup owns the vote state, but it reports from the item's own
			// permalink, which can carry a downvote arrow the story listing never
			// showed. Whichever arrows the sidebar already had win outright -- not
			// `previous || popup`, since falling back still lets the permalink's
			// extra arrow through and makes a ▼ appear on unvote that was never
			// there before the vote.
			if (previousVoteInfo) {
				merged.upUrl = previousVoteInfo.upUrl;
				merged.downUrl = previousVoteInfo.downUrl;
			}

			nextVoteLinks.set(String(itemId), merged);
		} else {
			nextVoteLinks.delete(String(itemId));
		}

		voteLinkCache.set(cacheKey, nextVoteLinks);

		// Prefer HN's own tally when the popup managed to read it. The +/-1
		// estimate below drifts as soon as anyone else has voted since the sidebar
		// loaded, which is what made the count disagree with Hacker News.
		if (Number.isFinite(authoritativeScore)) {
			updateCachedStoryScore(storyID, authoritativeScore);
			updateStoryScoreDisplay(storyID, authoritativeScore);
		} else {
			maybeUpdateStoryScoreFromVoteChange(
				storyID,
				itemId,
				previousVoteInfo,
				voteInfo || null,
			);
		}

		hydrateVoteControlsForStory(storyID, nextVoteLinks);
	}

	async function loadVoteLinks(storyID, options = {}) {
		const cacheKey = String(storyID);
		const cached = voteLinkCache.get(cacheKey);

		if (!options.force && cached) {
			return await cached;
		}

		const promise = (async () => {
			const html = await requestText(commentURL(storyID));

			if (!html) {
				return new Map();
			}

			const doc = new DOMParser().parseFromString(html, "text/html");

			const trueScore = extractScoreFromRoot(doc, storyID);

			if (Number.isFinite(trueScore)) {
				updateCachedStoryScore(storyID, trueScore);
				updateStoryScoreDisplay(storyID, trueScore);
			}

			// Same fetch, so HN's own displayed ages come along at no extra cost.
			displayAgeCache.set(cacheKey, extractDisplayAgesFromRoot(doc));

			return applyRememberedVotes(extractVoteLinksFromRoot(doc));
		})();

		voteLinkCache.set(cacheKey, promise);

		try {
			const voteLinks = await promise;
			voteLinkCache.set(cacheKey, voteLinks);
			return voteLinks;
		} catch {
			voteLinkCache.delete(cacheKey);
			return new Map();
		}
	}

	function getVoteDescriptors(voteInfo) {
		if (!voteInfo) {
			return [];
		}

		const descriptors = [];

		if (voteInfo.state === "up" && voteInfo.unUrl) {
			descriptors.push({
				label: "▲",
				title: "Remove upvote on Hacker News",
				action: "un",
				url: voteInfo.unUrl,
				active: true,
				variant: "up",
			});
		} else if (voteInfo.upUrl) {
			descriptors.push({
				label: "▲",
				title: "Upvote on Hacker News",
				action: "up",
				url: voteInfo.upUrl,
				active: false,
				variant: "up",
			});
		}

		if (voteInfo.state === "down" && voteInfo.unUrl) {
			descriptors.push({
				label: "▼",
				title: "Remove downvote on Hacker News",
				action: "un",
				url: voteInfo.unUrl,
				active: true,
				variant: "down",
			});
		} else if (voteInfo.downUrl) {
			descriptors.push({
				label: "▼",
				title: "Downvote on Hacker News",
				action: "down",
				url: voteInfo.downUrl,
				active: false,
				variant: "down",
			});
		}

		if (!descriptors.length && voteInfo.unUrl) {
			descriptors.push({
				label: "↺",
				title: "Remove vote on Hacker News",
				action: "un",
				url: voteInfo.unUrl,
				active: true,
				variant: "neutral",
			});
		}

		return descriptors;
	}

	function voteBridgePageURL(storyID, itemId, action, voteURL, nonce) {
		const url = new URL(commentURL(itemId));
		const hash = new URLSearchParams();
		hash.set("hnewhere-vote", "1");
		hash.set("story", String(storyID));
		hash.set("item", String(itemId));
		hash.set("action", action);

		// Carried through because the popup cannot always find the anchor itself:
		// hn.js injects the un_ unvote link client-side at vote time, so it is
		// absent from a freshly loaded page and getElementById finds nothing.
		if (voteURL) {
			hash.set("voteURL", voteURL);
		}

		hash.set("origin", location.origin);
		hash.set("nonce", nonce);
		url.hash = hash.toString();
		return url.href;
	}

	function setupVoteBridgeListener() {
		if (window.__hnewhereVoteBridgeListenerInstalled) {
			return;
		}

		window.__hnewhereVoteBridgeListenerInstalled = true;
		window.addEventListener("message", (event) => {
			if (event.origin !== HN_ORIGIN) {
				return;
			}

			const data = event.data;

			if (!data || data.source !== VOTE_BRIDGE_MESSAGE_SOURCE || !data.nonce) {
				return;
			}

			// The popup read HN as a real logged-in page, so its result stands.
			// Deliberately no refetch to reconcile afterwards: that returned a stale
			// score and a state that reported no vote, which visibly undid the vote a
			// moment after it landed.
			if (data.storyID && data.itemId && data.voteInfo) {
				rememberVote(data.itemId, data.voteInfo);
				setVoteInfoForStoryItem(
					data.storyID,
					data.itemId,
					data.voteInfo,
					data.score,
				);
			}

			const pending = voteBridgeRequests.get(data.nonce);

			if (!pending) {
				return;
			}

			clearTimeout(pending.timeoutId);
			voteBridgeRequests.delete(data.nonce);

			try {
				pending.popup?.close();
			} catch {}

			pending.resolve(data);
		});
	}

	function openVoteBridgePopup(storyID, itemId, action, voteURL) {
		setupVoteBridgeListener();

		return new Promise((resolve) => {
			const nonce =
				String(Date.now()) + Math.random().toString(36).slice(2, 10);
			const bridgeURL = voteBridgePageURL(
				storyID,
				itemId,
				action,
				voteURL,
				nonce,
			);
			const popup = window.open(
				bridgeURL,
				"hnewhere_vote_bridge_" + nonce,
				"width=420,height=320,resizable=yes,scrollbars=yes",
			);

			if (!popup) {
				resolve({ ok: false, reason: "popup-blocked" });
				return;
			}

			// Deliberately does NOT close the popup. The vote is a navigation now,
			// and closing mid-flight aborts it -- the very bug that stopped votes
			// persisting. On timeout just unblock the sidebar and let the popup
			// finish and close itself. The window covers two page loads (the vote
			// and HN's redirect back), so it is generous.
			const timeoutId = window.setTimeout(() => {
				voteBridgeRequests.delete(nonce);
				resolve({ ok: false, reason: "timeout" });
			}, 12000);

			voteBridgeRequests.set(nonce, {
				resolve,
				timeoutId,
				popup,
			});
		});
	}

	async function submitVote(storyID, itemId, descriptor, container) {
		if (!container || container.dataset.votePending === "1") {
			return;
		}

		container.dataset.votePending = "1";
		container.classList.add("vote-controls-pending");
		container.querySelectorAll(".vote-button").forEach((button) => {
			button.disabled = true;
		});

		try {
			const result = await openVoteBridgePopup(
				storyID,
				itemId,
				descriptor.action,
				descriptor.url,
			);

			if (result?.storyID && result?.itemId && result?.voteInfo) {
				setVoteInfoForStoryItem(result.storyID, result.itemId, result.voteInfo);
			}
		} finally {
			delete container.dataset.votePending;
			container.classList.remove("vote-controls-pending");
			container.querySelectorAll(".vote-button").forEach((button) => {
				button.disabled = false;
			});
		}
	}

	function renderVoteControls(container, storyID, itemId, voteInfo) {
		if (!container) {
			return;
		}

		container.replaceChildren();

		const descriptors = getVoteDescriptors(voteInfo);
		const state = voteInfo?.state;
		const hasVote = state === "up" || state === "down";

		// Only offer the link when there is a URL behind it, so it never renders
		// as something that looks clickable but does nothing.
		updateVoteStatus(itemId, voteInfo?.unUrl ? state : null, () => {
			submitVote(
				storyID,
				itemId,
				{ action: "un", url: voteInfo.unUrl },
				container,
			);
		});

		// HN hides the arrows entirely once you have voted; the unvote link in the
		// byline becomes the only control.
		if (!descriptors.length || hasVote) {
			container.classList.add("hidden");
			return;
		}

		container.classList.remove("hidden");

		for (const descriptor of descriptors) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "vote-button";
			button.title = descriptor.title;
			button.setAttribute("aria-label", descriptor.title);

			if (descriptor.variant === "neutral") {
				button.classList.add("vote-button-neutral");
				button.textContent = descriptor.label;
			} else {
				button.textContent = "";
			}

			if (descriptor.active) {
				button.classList.add("vote-button-active");
			}

			if (descriptor.variant) {
				button.classList.add("vote-button-" + descriptor.variant);
			}

			button.onclick = async (event) => {
				event.preventDefault();
				event.stopPropagation();
				await submitVote(storyID, itemId, descriptor, container);
			};

			container.appendChild(button);
		}
	}

	function hydrateVoteControlsForStory(storyID, voteLinks = new Map()) {
		const containers = sidebarUI?.body?.querySelectorAll(
			`[data-hn-vote-story-id="${String(storyID)}"]`,
		);

		if (!containers?.length) {
			return;
		}

		for (const container of containers) {
			const itemId = container.dataset.hnVoteItemId;
			renderVoteControls(container, storyID, itemId, voteLinks.get(String(itemId)));
		}
	}

	// -------------------------
	// Restore button
	// -------------------------

	async function applyButtonPosition(button) {
		const saved = await load(STORAGE.position, null);

		if (!saved) return;

		const maxX = window.innerWidth - button.offsetWidth;
		const maxY = window.innerHeight - button.offsetHeight;

		button.style.left = Math.max(0, Math.min(saved.x, maxX)) + "px";
		button.style.top = Math.max(0, Math.min(saved.y, maxY)) + "px";
		button.style.right = "auto";
	}

	function makeButtonDraggable(button) {
		let dragging = false;
		let moved = false;
		let suppressClick = false;
		let startX = 0;
		let startY = 0;
		let startLeft = 0;
		let startTop = 0;

		const clampPosition = () => {
			const maxX = window.innerWidth - button.offsetWidth;
			const maxY = window.innerHeight - button.offsetHeight;

			button.style.left = Math.max(0, Math.min(button.offsetLeft, maxX)) + "px";
			button.style.top = Math.max(0, Math.min(button.offsetTop, maxY)) + "px";
			button.style.right = "auto";
		};

		window.addEventListener("resize", clampPosition);

		button.addEventListener("pointerdown", (event) => {
			dragging = true;
			moved = false;

			startX = event.clientX;
			startY = event.clientY;

			const rect = button.getBoundingClientRect();

			startLeft = rect.left;
			startTop = rect.top;

			button.setPointerCapture(event.pointerId);
		});

		button.addEventListener("pointermove", (event) => {
			if (!dragging) return;

			const deltaX = event.clientX - startX;
			const deltaY = event.clientY - startY;

			if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
				moved = true;
			}

			button.style.left =
				Math.min(
					Math.max(0, startLeft + deltaX),
					window.innerWidth - button.offsetWidth,
				) + "px";

			button.style.top =
				Math.min(
					Math.max(0, startTop + deltaY),
					window.innerHeight - button.offsetHeight,
				) + "px";

			button.style.right = "auto";
		});

		button.addEventListener("pointerup", (event) => {
			if (!dragging) return;

			dragging = false;

			if (moved) {
				suppressClick = true;

				save(STORAGE.position, {
					x: button.offsetLeft,
					y: button.offsetTop,
				});

				requestAnimationFrame(() => {
					suppressClick = false;
				});
			}

			if (button.hasPointerCapture(event.pointerId)) {
				button.releasePointerCapture(event.pointerId);
			}
		});

		button.addEventListener("click", (event) => {
			if (suppressClick) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		});

		return {
			wasMoved: () => suppressClick,
			cleanup: () => {
				window.removeEventListener("resize", clampPosition);
			},
		};
	}

	function destroyFloatingButton(button) {
		if (!button) return;

		button._dragController?.cleanup?.();
		button._cleanup?.();
		button.remove();
	}

	async function revealSidebar() {
		if (!sidebar) {
			return false;
		}

		const wasHidden = sidebar.style.display === "none";

		sidebar.style.display = "";
		await saveSidebarState("open");

		const restoreButton = document.getElementById("hn-restore-button");
		if (restoreButton) {
			destroyFloatingButton(restoreButton);
		}

		ensureVoteControlsLoaded().catch(console.error);

		return wasHidden;
	}

	async function createRestoreButton() {
		const button = createFloatingHNButton("hn-restore-button");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = async () => {
			if (button._dragController.wasMoved()) return;

			await revealSidebar();
			await refreshArticleAnnotations();
		};

		return button;
	}

	function setFloatingButtonBusy(button, busy) {
		button.disabled = busy;
		button.textContent = busy ? "…" : "HN";
	}

	function pulseFloatingButtonFeedback(button, text) {
		button.textContent = text;
		button.style.fontSize = "11px";
		button.style.color = "white";

		window.setTimeout(() => {
			button.textContent = "HN";
			applyButtonMobileStyle(button);
		}, 900);
	}

	async function createCollapsedButton(storiesOrResolver) {
		const button = createFloatingHNButton("hn-collapse-button");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = async () => {
			if (button._dragController.wasMoved()) return;

			let stories = storiesOrResolver;

			if (typeof storiesOrResolver === "function") {
				setFloatingButtonBusy(button, true);
				try {
					stories = await storiesOrResolver();
				} catch (error) {
					console.error(error);
					stories = [];
				} finally {
					setFloatingButtonBusy(button, false);
				}
			}

			if (!stories?.length) {
				pulseFloatingButtonFeedback(button, "×");
				return;
			}

			destroyFloatingButton(button);
			openSidebar(stories).catch(console.error);
		};

		return button;
	}

	// -------------------------
	// Sidebar
	// -------------------------

	async function createSidebar() {
		if (sidebar) {
			sidebar._cleanup?.();
			sidebar.remove();
			sidebar = null;
		}

		const savedWidth = await loadSiteWidth();

		const width = Math.min(Math.max(savedWidth, 280), maxSidebarWidth());

		const host = document.createElement("div");
		host.setAttribute("data-hnewhere-sidebar", "1");
		document.body.appendChild(host);

		const shadow = host.attachShadow({
			mode: "open",
		});

		shadow.innerHTML = `
<style>

#panel {
    position:fixed;
    right:0;
    top:0;
    height:100vh;
    width:${width}px;
    min-width:${isPortraitPhone() ? "0" : "280px"};
    max-width:${isPortraitPhone() ? `calc(100vw - ${PORTRAIT_SIDEBAR_GUTTER}px)` : "80vw"};
    /* Without this the 1px border-left is added to the width, so a panel sized to
       the viewport renders a pixel past its left edge. */
    box-sizing:border-box;
    background:#f6f6ef;
    color:#000;
    z-index:2147483646;
    display:flex;
    flex-direction:column;
    border-left:1px solid #ccc;
    box-shadow:-3px 0 12px rgba(0,0,0,.15);
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
    font-size:13px;
    overflow:visible;
}

header {
    background:#ff6600;
    color:black;
    padding:6px 8px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    gap:8px;
    font-weight:bold;
}

header button {
    background:none;
    border:0;
    color:black;
    cursor:pointer;
    font-size:20px;
    width:36px;
    height:36px;
    display:flex;
    align-items:center;
    justify-content:center;
    border-radius:4px;
    padding:0;
    touch-action:manipulation;
}

/* #panel is position:fixed, which is already a containing block for this. */
#resize-handle {
    position:absolute;
    left:0;
    top:0;
    bottom:0;
    width:8px;
    cursor:col-resize;
    z-index:3;
    /* Keeps the browser from turning the drag into a scroll or a page-back swipe
       before the resize handlers see it. */
    touch-action:none;
}

/* A finger needs a far bigger target than a cursor, and an invisible edge strip is
   undiscoverable, so coarse pointers get a wider strip with a visible grip. */
@media (pointer: coarse) {
    #resize-handle {
        width:20px;
        display:flex;
        align-items:center;
        justify-content:center;
    }

    #resize-handle::before {
        content:"";
        width:4px;
        height:40px;
        border-radius:2px;
        background:rgba(0,0,0,.2);
    }

    #resize-handle.resize-handle-active::before {
        background:#ff6600;
    }
}

/* Touch devices latch :hover on after a tap and hold it until something else is
   tapped, so the settings and minimize buttons stayed highlighted. Only apply it
   where a real pointer can hover. */
@media (hover: hover) {
    header button:hover {
        background:rgba(0,0,0,.08);
    }
}


.header-actions {
    display:flex;
    align-items:center;
    gap:0;
}

/* The 36px buttons already centre their glyphs, so the visual inset on the right
   is the 8px header padding plus roughly half the leftover button width. This
   mirrors that on the left rather than letting the title hug the edge. */
.header-title {
    display:flex;
    flex-direction:column;
    min-width:0;
    padding-left:12px;
}

.header-subtitle {
    font-size:11px;
    font-weight:normal;
    line-height:1.2;
    opacity:.85;
}

.settings-panel {
    position:absolute;
    top:46px;
    right:8px;
    width:240px;
    background:white;
    color:#222;
    border:1px solid #d6d6d6;
    border-radius:8px;
    box-shadow:0 8px 24px rgba(0,0,0,.16);
    /* Slightly more at the bottom than the top: the title's line-height adds its
       own leading up top, so a literal 10px all round reads as short underneath
       the last option. */
    padding:10px 10px 13px;
    z-index:3;
}

.settings-title {
    margin:0 0 8px;
    font-size:12px;
    font-weight:600;
}

.settings-group + .settings-group {
    margin-top:10px;
    padding-top:10px;
    border-top:1px solid #eee;
}

.settings-group-label {
    margin-bottom:6px;
    color:#666;
    font-size:10px;
    font-weight:700;
    letter-spacing:.04em;
    text-transform:uppercase;
}

/* U+2699 defaults to its emoji presentation on iOS. font-variant-emoji is the
   stated way to ask for the text glyph but only lands in Safari 17+, and
   system-ui alone does not help because iOS still resolves the codepoint through
   Apple Color Emoji. The U+FE0E variation selector in the markup is what actually
   forces it; these remain as support for browsers that honour them. */
#settings-toggle {
    font-family: system-ui, sans-serif;
    font-variant-emoji: text;
}

/* Held while the dropdown is open so the gear reads as a toggle rather than a
   button that fired once. Darker than the hover tint so the two stay distinct on
   a pointer device, and outside the hover media query so touch gets it too. */
#settings-toggle.is-open {
    background:rgba(0,0,0,.16);
}

.settings-option {
    display:flex;
    gap:8px;
    align-items:flex-start;
    font-size:12px;
    line-height:1.35;
}

.settings-option + .settings-option {
    margin-top:8px;
}

.settings-option input {
    margin:2px 0 0;
}

.settings-option.sub-option {
    margin-left:20px;
    font-size:11px;
}

.settings-hint {
    margin-top:8px;
    color:#666;
    font-size:11px;
    line-height:1.35;
}

.submission {
    margin:0;
    padding-top:0;
}

.submission + .submission {
    margin-top:16px;
    padding-top:12px;
    border-top:1px solid #ccc;
}

#comments {
			flex:1 1 auto;
			min-height:0;
    overflow:auto;
    overflow-x:hidden;
			overscroll-behavior:contain;
    padding:12px 12px 8px;
    word-wrap:break-word;
}

#comments-content {
    opacity:1;
    transition:opacity .18s ease;
    will-change:opacity;
}

#comments-content.comments-transitioning {
    opacity:.12;
}

.filter-banner {
    position:relative;
    margin:12px 0 16px;
    padding:6px 34px 4px;
    color:#4a3a26;
    text-align:center;
}

.filter-banner-title {
    font-size:11px;
    font-weight:600;
    letter-spacing:.04em;
    text-transform:uppercase;
    opacity:.72;
}

.filter-banner-quote {
    margin-top:8px;
    color:#3b3022;
    font-size:16px;
    font-style:italic;
    line-height:1.55;
}

.filter-banner-meta {
    display:none;
}

.filter-match-list {
    display:flex;
    flex-wrap:wrap;
    justify-content:center;
    gap:6px;
    margin-top:10px;
}

.filter-match-chip {
    border:1px solid rgba(255,102,0,.18);
    border-radius:999px;
    background:transparent;
    color:#7b4f24;
    cursor:pointer;
    padding:3px 8px;
    font:500 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

@media (hover: hover) {
    .filter-match-chip:hover {
        background:rgba(255,102,0,.05);
    }
}

.filter-match-chip-active {
    border-color:rgba(255,102,0,.34);
    background:rgba(255,102,0,.09);
    color:#5e2e00;
}

.filter-banner-close {
    position:absolute;
    right:2px;
    top:2px;
    width:26px;
    height:26px;
    border:none;
    border-radius:999px;
    background:none;
    color:#8d5c2d;
    cursor:pointer;
    font:500 18px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    padding:0;
}

@media (hover: hover) {
    .filter-banner-close:hover {
        background:rgba(255,102,0,.05);
    }
}

.comment {
    margin:12px 0 12px 18px;
    max-width:100%;
    overflow-wrap:anywhere;
}

.top-level-comments > .comment {
    margin-left:0;
}

.children > .comment {
    border-left:1px solid #ddd;
    padding-left:8px;
}

.comment.new-comment {
			border-left:2px solid rgba(255,102,0,.95);
			padding-left:6px;
			transition:border-left-color .9s ease;
}

.comment.new-comment.comment-new-seen {
    border-left-color:transparent;
}

.comment.comment-target {
    background:rgba(255,102,0,.10);
    border-radius:6px;
}

.comment.comment-filter-hidden {
    display:none !important;
}

.submission.submission-filter-hidden {
    display:none !important;
}

.text {
    margin-top:4px;
    line-height:132%;
    font-weight:normal;
}

.text p {
    margin:8px 0;
}

.text a {
    color:#0000aa;
}

.meta {
    color:#828282;
    font-size:10px;
}

.meta a {
    color:#828282;
    text-decoration:none;
}

@media (hover: hover) {
    .meta a:hover {
        text-decoration:underline;
    }
}

.vote-controls {
    display:flex;
    flex-direction:column;
    align-items:center;
    width:17px;
}

.story-table {
    width:100%;
    border-collapse:collapse;
    table-layout:fixed;
}

.story-table td {
    padding:0;
    vertical-align:top;
}

.story-votelinks,
.story-votespacer {
    width:14px;
}

.story-votelinks {
    text-align:center;
}

.story-votelinks .vote-controls {
    margin-top:3px;
}

.story-title-cell,
.story-body-cell {
    padding-left:2px;
}

.comment-layout {
    display:flex;
    align-items:flex-start;
}

.comment-vote-slot {
    flex:0 0 17px;
    width:17px;
    display:flex;
    justify-content:center;
    align-items:flex-start;
    padding-top:1px;
}

.comment-main {
    flex:1 1 auto;
    min-width:0;
}

.vote-button {
    position:relative;
    width:10px;
    height:10px;
    min-width:10px;
    border:none;
    background:none;
    padding:0;
    margin:0;
    color:transparent;
    cursor:pointer;
    font-size:0;
    line-height:1;
}

.vote-button::before {
    content:"";
    position:absolute;
    left:1px;
    top:1px;
    width:0;
    height:0;
    border-left:4px solid transparent;
    border-right:4px solid transparent;
    border-bottom:7px solid #828282;
}

.vote-button-down::before {
    border-bottom:none;
    border-top:7px solid #828282;
    top:2px;
}

/* Split deliberately: the -active colour marks a recorded vote and must apply on
   touch, so only the :hover half is gated. */
.vote-button-active::before {
    border-bottom-color:#ff6600;
}

@media (hover: hover) {
    .vote-button:hover::before {
        border-bottom-color:#ff6600;
    }

    .vote-button-down:hover::before {
        border-top-color:#ff6600;
    }
}

.vote-button-down.vote-button-active::before {
    border-top-color:#666;
}

.vote-button-neutral {
    width:auto;
    min-width:10px;
    height:auto;
    color:#828282;
    font:600 10px/1 Verdana, Geneva, sans-serif;
}

.vote-button-neutral::before {
    content:none;
}

.vote-button-neutral.vote-button-active {
    color:#ff6600;
}

@media (hover: hover) {
    .vote-button-neutral:hover {
        color:#ff6600;
    }
}

.vote-button + .vote-button {
    margin-top:2px;
}

.vote-button:disabled {
    opacity:.55;
    cursor:default;
}

.story-vote-status,
.comment-vote-status {
    color:#828282;
}

/* Sits in the byline as plain text, the way HN's own unvote link does. */
.vote-unvote-link {
    background:none;
    border:0;
    padding:0;
    margin:0;
    color:inherit;
    font:inherit;
    cursor:pointer;
}

@media (hover: hover) {
    .vote-unvote-link:hover {
        text-decoration:underline;
    }
}

.vote-controls-pending {
    opacity:.7;
}

.comment-quote-link {
    color:inherit;
    cursor:pointer;
    border-radius:3px;
    outline:none;
    transition:background .18s ease, opacity .18s ease, max-height .18s ease, margin .18s ease, padding .18s ease, border-color .18s ease;
}

blockquote.comment-quote-link {
    margin:6px 0;
    padding:2px 0 2px 10px;
    border-left:2px solid rgba(255,102,0,.32);
    color:#5f5f5f;
}

.comment-quote-link-inline {
    text-decoration:underline;
    text-decoration-color:rgba(255,102,0,.32);
    text-decoration-thickness:1.5px;
    text-underline-offset:2px;
}

/* Split deliberately: :focus-visible is keyboard navigation and must keep working
   regardless of pointer type, so only the :hover half is gated. */
.comment-quote-link:focus-visible {
    background:rgba(255,102,0,.06);
}

blockquote.comment-quote-link:focus-visible {
    background:rgba(255,102,0,.04);
}

@media (hover: hover) {
    .comment-quote-link:hover {
        background:rgba(255,102,0,.06);
    }

    blockquote.comment-quote-link:hover {
        background:rgba(255,102,0,.04);
    }
}

.comment-quote-redundant.comment-quote-link-inline {
    opacity:.28;
    text-decoration-color:rgba(0,0,0,.14);
}

blockquote.comment-quote-redundant {
    max-height:0;
    overflow:hidden;
    margin:0;
    padding:0;
    border-left-color:transparent;
    opacity:.08;
}

.op-pill {
    display:inline-block;
    margin-left:4px;
    margin-right:4px;
    padding:1px 4px;
    border-radius:3px;
    background:#ff6600;
    color:white;
    font-size:9px;
    font-weight:bold;
    line-height:1.2;
}

.toggle {
    cursor:pointer;
}

.hidden {
    display:none;
}

.story-title {
    font-size:15px;
    line-height:1.25;
}

.story-title a {
    color:#000;
    text-decoration:none;
    word-break:break-word;
}

.story-meta {
    color:#828282;
    font-size:10px;
    line-height:1.4;
    padding-top:2px;
}

.story-text {
    margin:10px 0;
    line-height:1.45;
}

.story-text p:first-child {
    margin-top:0;
}

.story-text p:last-child {
    margin-bottom:0;
}

.story-text a {
    color:#0000aa;
}

.story-actions {
    margin-top:8px;
    display:flex;
    align-items:center;
    gap:8px;
    flex-wrap:wrap;
}

.story-actions button {
    font-family:Verdana, Geneva, sans-serif;
    font-size:11px;
    cursor:pointer;
}

</style>

<div id="panel">

<div id="resize-handle" aria-hidden="true"></div>

<header>

<span class="header-title">
<span><b>HN</b>ewhere</span>
<span id="header-subtitle" class="header-subtitle"></span>
</span>

<div class="header-actions">
<button id="settings-toggle" aria-label="Open HNewhere settings" title="HNewhere settings" aria-expanded="false" aria-controls="settings-panel">
&#9881;&#65038;
</button>

<button id="minimize" aria-label="Minimize HNewhere" title="Minimize">
−
</button>
</div>

</header>

<div id="settings-panel" class="settings-panel hidden">
<div class="settings-title">Settings</div>

<div class="settings-group">
<div class="settings-group-label">Sidebar</div>
<label class="settings-option">
<input id="setting-auto-open-sidebar" data-setting="autoOpenSidebar" type="checkbox">
<span>Automatically open the sidebar when a discussion exists</span>
</label>
</div>

<div class="settings-group">
<div class="settings-group-label">Annotations <span class="op-pill">BETA</span></div>
<label class="settings-option">
<input id="setting-annotations" data-setting="annotations" type="checkbox">
<span>Enable article annotations</span>
</label>
<label class="settings-option sub-option">
<input id="setting-annotations-open" data-setting="annotationsWhenSidebarOpen" type="checkbox">
<span>When sidebar open</span>
</label>
<label class="settings-option sub-option">
<input id="setting-annotations-closed" data-setting="annotationsWhenSidebarClosed" type="checkbox">
<span>When sidebar closed</span>
</label>
</div>
</div>

<div id="comments">
<div id="filter-banner" class="filter-banner hidden">
<button id="clear-filter" class="filter-banner-close" type="button" aria-label="Close filtered discussion" title="Show all comments">
×
</button>
<div class="filter-banner-title">Focused discussion</div>
<div id="filter-banner-quote" class="filter-banner-quote"></div>
<div id="filter-banner-meta" class="filter-banner-meta"></div>
<div id="filter-match-list" class="filter-match-list hidden"></div>
</div>
<div id="comments-content">Loading...</div>
</div>

</div>
`;

		const panel = shadow.querySelector("#panel");
		const settingsPanel = shadow.querySelector("#settings-panel");
		const settingsToggle = shadow.querySelector("#settings-toggle");
		const filterBanner = shadow.querySelector("#filter-banner");
		const filterBannerQuote = shadow.querySelector("#filter-banner-quote");
		const filterBannerMeta = shadow.querySelector("#filter-banner-meta");
		const filterMatchList = shadow.querySelector("#filter-match-list");
		const clearFilterButton = shadow.querySelector("#clear-filter");

		// Stop scroll/touch events moving out of sidebar so sites with
		// JS scroll hijacking (wheel listeners on window) don't scroll behind
		for (const type of ["wheel", "touchmove"]) {
			host.addEventListener(type, (event) => event.stopPropagation());
		}

		const settingsInputs = {
			autoOpenSidebar: shadow.querySelector("#setting-auto-open-sidebar"),
			annotations: shadow.querySelector("#setting-annotations"),
			annotationsWhenSidebarOpen: shadow.querySelector("#setting-annotations-open"),
			annotationsWhenSidebarClosed: shadow.querySelector("#setting-annotations-closed"),
		};

		const applySettingsPanelState = (settings) => {
			for (const [key, input] of Object.entries(settingsInputs)) {
				input.checked = Boolean(settings[key]);
			}

			const annotationsEnabled = Boolean(settings.annotations);

			settingsInputs.annotationsWhenSidebarOpen.disabled = !annotationsEnabled;
			settingsInputs.annotationsWhenSidebarClosed.disabled = !annotationsEnabled;
		};

		applySettingsPanelState(await loadSettings());

		// Single place the open state changes, so the button's pressed styling and
		// aria-expanded cannot drift out of sync with the panel.
		const setSettingsOpen = (open) => {
			settingsPanel.classList.toggle("hidden", !open);
			settingsToggle.classList.toggle("is-open", open);
			settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");
		};

		setSettingsOpen(false);

		settingsToggle.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			setSettingsOpen(settingsPanel.classList.contains("hidden"));
		};

		settingsPanel.addEventListener("click", (event) => {
			event.stopPropagation();
		});

		shadow.addEventListener("click", (event) => {
			const path = event.composedPath();

			if (path.includes(settingsToggle) || path.includes(settingsPanel)) {
				return;
			}

			setSettingsOpen(false);
		});

		settingsPanel.addEventListener("change", async (event) => {
			const input = event.target.closest("input[data-setting]");

			if (!input) {
				return;
			}

			const settings = await saveSettings({
				[input.dataset.setting]: input.checked,
			});

			applySettingsPanelState(settings);

			if (
				[
					"annotations",
					"annotationsWhenSidebarOpen",
					"annotationsWhenSidebarClosed",
				].includes(input.dataset.setting)
			) {
				await refreshArticleAnnotations();
			}
		});

		clearFilterButton.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			clearCommentFilter();
		};

		let resizing = false;
		let startX = 0;
		let startWidth = 0;
		// Set once a width has been dragged, so the orientation handling below knows
		// to leave a deliberately chosen width alone.
		let userResized = false;

		panel.addEventListener("mousemove", (e) => {
			if (e.offsetX < 8) {
				panel.style.cursor = "col-resize";
			} else if (!resizing) {
				panel.style.cursor = "default";
			}
		});

		panel.addEventListener("mouseleave", () => {
			if (!resizing) {
				panel.style.cursor = "default";
			}
		});

		panel.addEventListener("mousedown", (e) => {
			if (e.offsetX >= 8) return;

			resizing = true;
			startX = e.clientX;
			startWidth = panel.offsetWidth;

			document.body.style.userSelect = "none";
			document.body.style.cursor = "col-resize";

			e.preventDefault();
		});

		let resizeTimer;

		const onMouseMove = (e) => {
			if (!resizing) return;

			const delta = startX - e.clientX;

			const newWidth = Math.min(
				Math.max(startWidth + delta, 280),
				maxSidebarWidth(),
			);

			panel.style.width = newWidth + "px";
			userResized = true;

			clearTimeout(resizeTimer);

			resizeTimer = setTimeout(() => {
				if (!destroyed) {
					saveSiteWidth(newWidth);
				}
			}, 250);
		};

		const onMouseUp = () => {
			if (!resizing) return;

			resizing = false;

			document.body.style.userSelect = "";
			document.body.style.cursor = "";

			panel.style.cursor = "default";
		};

		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);

		let destroyed = false;

		// Touch never fires the mouse drag above, so resizing is wired separately
		// here. Listeners sit on the handle rather than the panel so a drag starting
		// anywhere else still scrolls the comments normally, and are non-passive so
		// preventDefault can stop the page scrolling mid-drag.
		const resizeHandle = shadow.querySelector("#resize-handle");

		const onTouchStart = (e) => {
			const touch = e.touches[0];

			if (!touch) {
				return;
			}

			resizing = true;
			startX = touch.clientX;
			startWidth = panel.offsetWidth;
			resizeHandle.classList.add("resize-handle-active");
			e.preventDefault();
		};

		const onTouchMove = (e) => {
			const touch = e.touches[0];

			if (!resizing || !touch) {
				return;
			}

			const newWidth = Math.min(
				Math.max(startWidth + (startX - touch.clientX), 280),
				maxSidebarWidth(),
			);

			panel.style.width = newWidth + "px";
			userResized = true;
			e.preventDefault();

			clearTimeout(resizeTimer);

			resizeTimer = setTimeout(() => {
				if (!destroyed) {
					saveSiteWidth(newWidth);
				}
			}, 250);
		};

		const onTouchEnd = () => {
			resizing = false;
			resizeHandle.classList.remove("resize-handle-active");
		};

		if (resizeHandle) {
			resizeHandle.addEventListener("touchstart", onTouchStart, {
				passive: false,
			});
			resizeHandle.addEventListener("touchmove", onTouchMove, {
				passive: false,
			});
			resizeHandle.addEventListener("touchend", onTouchEnd);
			resizeHandle.addEventListener("touchcancel", onTouchEnd);
		}

		// Deliberately does not persist the clamped value. This fires on rotation,
		// where portrait allows the full width and landscape only 80%, so saving
		// here would let one rotation overwrite the chosen width for good. The
		// clamp is reapplied on open anyway, so display-only is enough.
		let wasPortrait = isPortraitPhone();

		const clampSidebarWidth = () => {
			const maxWidth = maxSidebarWidth();
			const portrait = isPortraitPhone();

			// Rotating back to portrait restores the full width, since a shrink-only
			// clamp would strand the panel at the narrower landscape size. Gated on an
			// actual orientation change rather than every resize, because iOS fires
			// resize when the URL bar collapses mid-scroll, and on the width not
			// having been chosen by hand, so this never fights a manual resize.
			if (portrait !== wasPortrait) {
				wasPortrait = portrait;

				if (portrait && !userResized) {
					panel.style.width = maxWidth + "px";
					return;
				}
			}

			if (panel.offsetWidth > maxWidth) {
				panel.style.width = maxWidth + "px";
			}
		};

		window.addEventListener("resize", clampSidebarWidth);

		host._cleanup = () => {
			destroyed = true;
			clearTimeout(resizeTimer);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("resize", clampSidebarWidth);

			if (sidebar === host) {
				clearArticleAnnotations();
				sidebarUI = null;
			}
		};

		shadow.querySelector("#minimize").onclick = async () => {
			host.style.display = "none";
			await saveSidebarState("collapsed");
			clearArticleAnnotations();
			setSettingsOpen(false);
			await createRestoreButton();
			await refreshArticleAnnotations();
		};

		document
			.querySelectorAll("#hn-restore-button, #hn-collapse-button")
			.forEach((button) => destroyFloatingButton(button));

		sidebar = host;

		return {
			shadow,
			body: shadow.querySelector("#comments-content"),
			headerSubtitle: shadow.querySelector("#header-subtitle"),
			filterBanner,
			filterBannerQuote,
			filterBannerMeta,
			filterMatchList,
		};
	}

	// -------------------------
	// Story rendering
	// -------------------------

	function renderStory(story, container, options = {}) {
		if (!story?.id) {
			return null;
		}

		const storyID = String(story.id);
		const hnURL = commentURL(story.id);

		const wrapper = document.createElement("div");
		wrapper.innerHTML = `

	<div class="story">
	<table class="story-table" role="presentation">
	<tbody>
	<tr>
	<td class="story-votelinks">
	<span class="story-vote-controls vote-controls hidden"
	data-hn-vote-story-id="${escapeHTML(storyID)}"
	data-hn-vote-item-id="${escapeHTML(storyID)}"></span>
	</td>
	<td class="story-title-cell">
	<div class="story-title">
	<a target="_blank"
	href="${escapeHTML(hnURL)}"
	title="Open discussion on Hacker News">
	${escapeHTML(story.title)}
	</a>
	</div>
	</td>
	</tr>
	<tr>
	<td class="story-votespacer"></td>
	<td class="story-body-cell">
	<div class="story-meta">
	<span class="story-score" data-story-score-id="${escapeHTML(storyID)}" data-story-score="${escapeHTML(String(story.score || 0))}">${story.score || 0}</span> points by
	${escapeHTML(story.by || "")}
	|
	<span class="item-age" data-age-id="${escapeHTML(storyID)}">${timeAgo(story.time)}</span><span class="story-vote-status" data-vote-status-id="${escapeHTML(storyID)}"></span>
	|
	${story.descendants || 0} comments
	</div>
	${
		story.text
			? `
	<div class="story-text">
	${sanitizeHTML(story.text)}
	</div>
	`
			: ""
	}
	<div class="story-actions">
	<button type="submit" class="add-comment">
	add comment
	</button>
	</div>
	</td>
	</tr>
	</tbody>
	</table>
	</div>

<br>

`;
		const storyElement = wrapper.firstElementChild;
		storyElement.dataset.storyId = storyID;
		container.appendChild(storyElement);

		storyElement.querySelector(".add-comment").onclick = () => {
			openHNWindow(commentURL(story.id));
		};

		return storyElement;
	}

	function mountFilterBanner(afterElement, ui) {
		if (!afterElement || !ui?.filterBanner) {
			return;
		}

		afterElement.after(ui.filterBanner);
	}

	function positionFilterBannerForComment(commentElement) {
		const anchor =
			commentElement?.closest(".submission")?.querySelector(".story") ||
			sidebarUI?.body?.querySelector(".story");

		if (anchor && sidebarUI?.filterBanner) {
			anchor.after(sidebarUI.filterBanner);
		}
	}

	function startNewCommentFade(element) {
		if (!element?.classList.contains("new-comment")) {
			return;
		}

		element.classList.add("comment-new-seen");
	}

	// -------------------------
	// Comment rendering
	// -------------------------

	async function renderChildren(
		replyIDs,
		container,
		storyID,
		storyAuthor,
		seenTime,
		collapsedIds,
		generation = sidebarGeneration,
		parentId = null,
	) {
		const batchSize = 5;

		for (let i = 0; i < replyIDs.length; i += batchSize) {
			const batch = replyIDs.slice(i, i + batchSize);

			await Promise.all(
				batch.map((id) =>
					renderComment(
						id,
						container,
						storyID,
						storyAuthor,
						seenTime,
						collapsedIds,
						generation,
						parentId,
					),
				),
			);

			await new Promise(requestAnimationFrame);
		}
	}

	async function renderComment(
		id,
		container,
		storyID,
		storyAuthor,
		seenTime = 0,
		collapsedIds = new Set(),
		generation = sidebarGeneration,
		parentId = null,
	) {
		const comment = await getItem(id);

		if (generation !== sidebarGeneration) {
			return;
		}

		if (!comment || comment.deleted || comment.dead) return;
		const div = document.createElement("div");

		div.className = "comment";
		div.dataset.commentId = String(comment.id);
		div.dataset.storyId = String(storyID);

		if (isNewComment(comment, seenTime)) {
			div.classList.add("new-comment");
		}

		const replies = comment.kids || [];
		const reply = replyURL(comment, storyID);
		const commentID = String(comment.id);

		div.innerHTML = `
      <div class="comment-layout">
      <span class="comment-vote-slot">
      <span class="comment-vote-controls vote-controls hidden"
      data-hn-vote-story-id="${escapeHTML(String(storyID))}"
      data-hn-vote-item-id="${escapeHTML(commentID)}"></span>
      </span>

      <div class="comment-main">
      <div class="meta">

      <a target="_blank"
      href="https://news.ycombinator.com/user?id=${encodeURIComponent(comment.by || "")}">

      ${escapeHTML(comment.by || "anonymous")}

      </a>

      ${
					comment.by && comment.by === storyAuthor
						? `<span class="op-pill">OP</span>`
						: ""
				}

      <span class="item-age" data-age-id="${escapeHTML(commentID)}">${timeAgo(comment.time)}</span><span class="comment-vote-status" data-vote-status-id="${escapeHTML(commentID)}"></span>

      |

      <a class="reply-link" href="#">
      reply
      </a>

      <span class="toggle">
      [–]
      </span>

      </div>

      <div class="comment-content">
       	<div class="text">
        		${sanitizeHTML(comment.text) || ""}
       	</div>
       	<div class="children"></div>
      </div>
      </div>
      </div>
    `;

		container.appendChild(div);

		const content = div.querySelector(".comment-content");
		const textElement = div.querySelector(".text");
		const children = div.querySelector(".children");
		const toggle = div.querySelector(".toggle");

		renderedComments.push({
			id: comment.id,
			storyID,
			parentId,
			author: comment.by || "anonymous",
			time: comment.time || 0,
			textHTML: comment.text || "",
			element: div,
			textElement,
			contentElement: content,
			toggleElement: toggle,
			sectionElement: div.closest(".submission"),
			matchedGroupKeys: new Set(),
		});

		if (collapsedIds.has(comment.id)) {
			content.classList.add("hidden");
			toggle.textContent = "[+]";
		}

		if (div.classList.contains("new-comment")) {
			div.addEventListener("pointerenter", () => startNewCommentFade(div), {
				once: true,
			});
			div.addEventListener("wheel", () => startNewCommentFade(div), {
				once: true,
				passive: true,
			});
			div.addEventListener("touchstart", () => startNewCommentFade(div), {
				once: true,
				passive: true,
			});
			div.addEventListener("pointerdown", () => startNewCommentFade(div), {
				once: true,
			});
		}

		toggle.onclick = async () => {
			const hidden = content.classList.toggle("hidden");

			toggle.textContent = hidden ? "[+]" : "[–]";

			await toggleCollapsed(comment.id, hidden);
		};

		const replyButton = div.querySelector(".reply-link");

		replyButton.onclick = function (event) {
			event.preventDefault();

			openHNWindow(reply);
		};

		if (replies.length) {
			await renderChildren(
				replies,
				children,
				storyID,
				storyAuthor,
				seenTime,
				collapsedIds,
				generation,
				comment.id,
			);
		}
	}

	// -------------------------
	// Discussion loading
	// -------------------------

	async function renderSingleDiscussion(story, ui) {
		clearArticleAnnotations();
		clearCommentFilter({ animate: false });
		renderedComments = [];
		ui.body.innerHTML = "";
		ui.headerSubtitle.textContent = "";

		const generation = sidebarGeneration;
		const votePromise = isSidebarVisible() ? loadVoteLinks(story.id) : null;
		const storyElement = renderStory(story, ui.body);
		mountFilterBanner(storyElement, ui);

		const comments = document.createElement("div");
		comments.className = "top-level-comments";
		ui.body.appendChild(comments);

		const seenTime = await getSeenTime(story.id);
		const collapsedIds = await loadCollapsed();

		await renderChildren(
			story.kids || [],
			comments,
			story.id,
			story.by,
			seenTime,
			collapsedIds,
		);

		await markSeen(story.id);

		if (votePromise && generation === sidebarGeneration) {
			hydrateVoteControlsForStory(story.id, await votePromise);
			hydrateDisplayAges(story.id);
		}
	}

	async function renderBlendedDiscussion(stories, ui) {
		clearArticleAnnotations();
		clearCommentFilter({ animate: false });
		renderedComments = [];
		ui.body.innerHTML = "";
		ui.headerSubtitle.textContent = pluralize(stories.length, "submission") + " on HN";

		const generation = sidebarGeneration;

		for (const [index, story] of stories.entries()) {
			const votePromise = isSidebarVisible() ? loadVoteLinks(story.id) : null;
			const section = document.createElement("div");
			section.className = "submission";
			section.dataset.storyId = String(story.id);

			ui.body.appendChild(section);

			const storyElement = renderStory(story, section, {
				multiple: true,
				stories,
			});

			if (index === 0) {
				mountFilterBanner(storyElement, ui);
			}

			const comments = document.createElement("div");
			comments.className = "top-level-comments";

			section.appendChild(comments);

			const seenTime = await getSeenTime(story.id);
			const collapsedIds = await loadCollapsed();

			await renderChildren(
				story.kids || [],
				comments,
				story.id,
				story.by,
				seenTime,
				collapsedIds,
			);

			await markSeen(story.id);

			if (votePromise && generation === sidebarGeneration) {
				hydrateVoteControlsForStory(story.id, await votePromise);
				hydrateDisplayAges(story.id);
			}
		}
	}

	async function loadStories(stories) {
		const ids = [
			...new Set(
				normalizeStories(stories)
					.map((story) => story.objectID)
					.filter(Boolean),
			),
		];

		const items = await Promise.all(ids.map((id) => getItem(id)));

		// This is the order the sidebar actually renders in: it runs after findHN and
		// overrides whatever order that produced, so the rule has to be applied here
		// too rather than only at lookup time.
		return items
			.filter((item) => item && item.type === "story")
			.sort(compareStoriesByDiscussion);
	}

	// -------------------------
	// Open sidebar
	// -------------------------
	function normalizeStories(stories) {
		return stories.map((story) =>
			typeof story === "string" ? { objectID: story } : story,
		);
	}

	async function openSidebar(stories, options = {}) {
		if (opening) return;

		opening = true;

		try {
			const loaded = await loadStories(stories);

			if (!loaded.length) {
				throw new Error("No HN stories could be loaded");
			}

			const generation = ++sidebarGeneration;
			const ui = await createSidebar();
			sidebarUI = ui;

			if (generation !== sidebarGeneration) {
				return;
			}

			if (options.startHidden && sidebar) {
				sidebar.style.display = "none";
				await saveSidebarState("collapsed");
			} else {
				await saveSidebarState("open");
			}

			if (loaded.length === 1) {
				await renderSingleDiscussion(loaded[0], ui);
			} else {
				await renderBlendedDiscussion(loaded, ui);
			}

			if (generation === sidebarGeneration) {
				await refreshArticleAnnotations();

				if (options.startHidden) {
					await createRestoreButton();
				}
			}
		} catch (e) {
			console.error(e);
		} finally {
			opening = false;
		}
	}

	// -------------------------
	// Hacker News click tracking / vote bridge
	// -------------------------

	function parseVoteBridgePayload() {
		const hash = location.hash.replace(/^#/, "");

		if (!hash) {
			return null;
		}

		const params = new URLSearchParams(hash);

		if (params.get("hnewhere-vote") !== "1") {
			return null;
		}

		const storyID = params.get("story");
		const itemId = params.get("item");
		const action = params.get("action");
		const origin = params.get("origin");
		const nonce = params.get("nonce");

		if (!storyID || !itemId || !nonce) {
			return null;
		}

		if (!["up", "down", "un"].includes(action)) {
			return null;
		}

		return {
			storyID,
			itemId,
			action,
			origin,
			nonce,
			// Re-validated rather than trusted: this arrives via the URL fragment
			// and is about to be navigated to, so it must be a real HN vote URL.
			voteURL: normalizeVoteURL(params.get("voteURL")),
		};
	}

	function postVoteBridgeResult(payload, result) {
		if (!window.opener) {
			return;
		}

		try {
			window.opener.postMessage(
				{
					source: VOTE_BRIDGE_MESSAGE_SOURCE,
					storyID: payload.storyID,
					itemId: payload.itemId,
					action: payload.action,
					nonce: payload.nonce,
					...result,
				},
				payload.origin || "*",
			);
		} catch (error) {
			console.error("Failed posting vote bridge result:", error);
		}
	}

	function currentVoteInfoFor(itemId) {
		return cloneVoteInfo(
			extractVoteLinksFromRoot(document).get(String(itemId)) || null,
		);
	}

	// Runs on the page HN redirects to after the vote is committed. The hash is
	// gone by now, so the payload comes back out of sessionStorage.
	function reportVoteResultAfterReload() {
		// HN's /vote response is itself a page this script runs on, and at that
		// point the redirect has not landed yet so the document carries no vote
		// links. Reporting from there would consume the payload, post a null
		// voteInfo and close the popup before the real state was ever read.
		// Only report once the redirect has arrived at the item page.
		if (location.pathname !== "/item") {
			return false;
		}

		let stored = null;

		try {
			stored = window.sessionStorage.getItem(VOTE_BRIDGE_STORAGE_KEY);
			// Cleared immediately: if anything below throws, a stale payload must
			// not make the next HN page load try to report again.
			window.sessionStorage.removeItem(VOTE_BRIDGE_STORAGE_KEY);
		} catch {
			return false;
		}

		if (!stored) {
			return false;
		}

		let payload = null;

		try {
			payload = JSON.parse(stored);
		} catch {
			return false;
		}

		if (!payload?.itemId || !payload?.nonce) {
			return false;
		}

		// Server-rendered state, so this is the vote HN actually holds.
		const voteInfo = currentVoteInfoFor(payload.itemId);
		const changed = voteInfo?.state !== payload.beforeState;

		postVoteBridgeResult(payload, {
			ok: changed,
			reason: changed ? "updated" : "unchanged",
			voteInfo,
			// HN's own tally, read off the page it just served.
			score: extractScoreFromRoot(document, payload.itemId),
		});

		window.setTimeout(() => window.close(), 60);
		return true;
	}

	function maybeHandleHNVoteBridge() {
		const payload = parseVoteBridgePayload();

		if (!payload) {
			return false;
		}

		const before = currentVoteInfoFor(payload.itemId);

		// This page's own tokens come first. It was just loaded in a real logged-in
		// tab, so its auth is fresh, whereas the URL the sidebar passed in may be
		// minutes old and HN expires those ("Unknown or expired link"). The passed
		// URL is only the fallback, for when this page offers nothing usable --
		// notably an unvote, since hn.js injects the un_ link client-side at vote
		// time and it is absent from a freshly loaded page.
		const anchor = document.getElementById(
			payload.action + "_" + payload.itemId,
		);
		const voteURL =
			(anchor instanceof HTMLAnchorElement
				? normalizeVoteURL(anchor.getAttribute("href"))
				: null) ||
			(payload.action === "un" ? before?.unUrl : null) ||
			payload.voteURL;

		if (!voteURL) {
			postVoteBridgeResult(payload, {
				ok: false,
				reason: "vote-url-missing",
				voteInfo: before,
			});
			window.setTimeout(() => window.close(), 80);
			return true;
		}

		// Deliberately NOT voteAnchor.click(): HN's own handler updates the arrow
		// optimistically and sends /vote in the background, so closing the popup
		// moments later aborts the request and the vote never reaches the server.
		// A top-level navigation cannot be aborted that way -- HN commits the vote
		// and redirects to goto, and the state we read after is the real one.
		const target = new URL(voteURL);
		target.searchParams.set("goto", "item?id=" + payload.itemId);

		try {
			window.sessionStorage.setItem(
				VOTE_BRIDGE_STORAGE_KEY,
				JSON.stringify({
					...payload,
					beforeState: before?.state ?? "none",
				}),
			);
		} catch (error) {
			console.error("HNewhere: could not stage vote payload", error);
			postVoteBridgeResult(payload, {
				ok: false,
				reason: "storage-unavailable",
				voteInfo: before,
			});
			window.setTimeout(() => window.close(), 80);
			return true;
		}

		location.href = target.href;
		return true;
	}

	function setupHNListener() {
		document.addEventListener(
			"click",
			async function (event) {
				try {
					const link = event.target.closest(".titleline > a");

					if (!link) return;

					const row = link.closest("tr.athing");

					if (!row?.id) return;

					await save(STORAGE.last, {
						url: link.href,
						ids: [row.id],
						timestamp: Date.now(),
					});
				} catch (e) {
					console.error("Failed saving HN story:", e);
				}
			},
			true,
		);
	}

	// -------------------------
	// URL helpers
	// -------------------------

	function sameURL(a, b) {
		return normalizeURL(a) === normalizeURL(b);
	}

	function shouldAutoOpenSidebar(settings, siteState = null) {
		if (siteState === "open") {
			return true;
		}

		if (siteState === "collapsed") {
			return false;
		}

		return !isMobile() && settings.autoOpenSidebar;
	}

	function shouldPreloadHiddenSidebar(settings, siteState = null) {
		return (
			Boolean(settings.annotations) &&
			!shouldAutoOpenSidebar(settings, siteState) &&
			Boolean(settings.annotationsWhenSidebarClosed)
		);
	}

	function shouldDeferInitialLookup(settings, siteState = null) {
		return (
			!shouldAutoOpenSidebar(settings, siteState) &&
			!shouldPreloadHiddenSidebar(settings, siteState)
		);
	}

	function isSidebarVisible() {
		return Boolean(sidebar && sidebar.style.display !== "none");
	}

	function shouldShowArticleAnnotations(settings) {
		if (!settings.annotations) {
			return false;
		}

		return isSidebarVisible()
			? Boolean(settings.annotationsWhenSidebarOpen)
			: Boolean(settings.annotationsWhenSidebarClosed);
	}

	async function ensureVoteControlsLoaded() {
		if (!isSidebarVisible() || !sidebarUI?.body) {
			return;
		}

		const storyIDs = [
			...new Set(
				[...sidebarUI.body.querySelectorAll("[data-hn-vote-story-id]")]
					.map((element) => element.dataset.hnVoteStoryId)
					.filter(Boolean),
			),
		];

		for (const storyID of storyIDs) {
			hydrateVoteControlsForStory(storyID, await loadVoteLinks(storyID));
			hydrateDisplayAges(storyID);
		}
	}

	// -------------------------
	// Article annotations
	// -------------------------

	function transitionCommentList(update, options = {}) {
		const container = sidebarUI?.body;

		if (!container || options.animate === false) {
			update();
			return;
		}

		if (container._hnewhereTransitionTimer) {
			clearTimeout(container._hnewhereTransitionTimer);
		}

		container.classList.add("comments-transitioning");
		container._hnewhereTransitionTimer = window.setTimeout(() => {
			update();
			requestAnimationFrame(() => {
				container.classList.remove("comments-transitioning");
				container._hnewhereTransitionTimer = null;
			});
		}, 110);
	}

	function setQuoteRedundancy(group, redundant) {
		for (const candidateGroup of annotationController?.groups || []) {
			for (const comment of candidateGroup.comments) {
				for (const element of comment.quoteElements || []) {
					element.classList.toggle(
						"comment-quote-redundant",
						redundant && candidateGroup.key === group?.key,
					);
				}
			}
		}
	}

	function scrollToCommentElement(element) {
		if (!element) {
			return;
		}

		element.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
	}

	function updateSubmissionVisibility(visibleCommentIds = null) {
		const sections = sidebarUI?.body?.querySelectorAll(".submission");

		if (!sections?.length) {
			return;
		}

		if (!visibleCommentIds) {
			sections.forEach((section) => {
				section.classList.remove("submission-filter-hidden");
			});
			return;
		}

		for (const section of sections) {
			const hasVisibleComments = renderedComments.some(
				(comment) =>
					comment.sectionElement === section && visibleCommentIds.has(comment.id),
			);

			section.classList.toggle("submission-filter-hidden", !hasVisibleComments);
		}
	}

	function clearCommentFilter(options = {}) {
		activeCommentFilter = null;

		positionFilterBannerForComment(null);

		transitionCommentList(() => {
			for (const rendered of renderedComments) {
				rendered.element.classList.remove("comment-filter-hidden");

				if (rendered.element.dataset.filterExpanded === "1") {
					rendered.contentElement.classList.add("hidden");
					rendered.toggleElement.textContent = "[+]";
					delete rendered.element.dataset.filterExpanded;
				}
			}

			setQuoteRedundancy(null, false);
			updateSubmissionVisibility(null);
			sidebarUI?.filterBanner?.classList.add("hidden");
			if (sidebarUI?.filterBannerQuote) {
				sidebarUI.filterBannerQuote.textContent = "";
			}
			if (sidebarUI?.filterBannerMeta) {
				sidebarUI.filterBannerMeta.textContent = "";
			}
			if (sidebarUI?.filterMatchList) {
				sidebarUI.filterMatchList.replaceChildren();
				sidebarUI.filterMatchList.classList.add("hidden");
			}
		}, options);
	}

	function clearArticleAnnotations() {
		annotationController?.cleanup?.();
		annotationController = null;

		if (sidebarUI?.shadow) {
			sidebarUI.shadow
				.querySelectorAll("[data-hnewhere-quote-link='1']")
				.forEach((element) => {
					element.replaceWith(...element.childNodes);
				});

			sidebarUI.shadow
				.querySelectorAll("[data-hnewhere-quote-block='1']")
				.forEach((element) => {
					element.classList.remove("comment-quote-link");
					element.removeAttribute("role");
					element.removeAttribute("tabindex");
					element.onclick = null;
					element.onkeydown = null;
					delete element.dataset.hnewhereQuoteBlock;
				});

			sidebarUI.shadow
				.querySelectorAll(".comment-target")
				.forEach((element) => element.classList.remove("comment-target"));
		}
	}

	function normalizeSearchText(text) {
		let normalized = "";
		const map = [];
		let lastWasSpace = true;

		for (let i = 0; i < (text || "").length; i += 1) {
			const original = text[i];
			const char =
				original === "’" || original === "‘"
					? "'"
					: original === "“" || original === "”"
						? '"'
						: original === "…"
							? " "
							: original;

			if (/^[\p{L}\p{N}]$/u.test(char)) {
				normalized += char.toLowerCase();
				map.push(i);
				lastWasSpace = false;
				continue;
			}

			if (!lastWasSpace && normalized) {
				normalized += " ";
				map.push(i);
				lastWasSpace = true;
			}
		}

		if (normalized.endsWith(" ")) {
			normalized = normalized.slice(0, -1);
			map.pop();
		}

		return {
			text: normalized,
			map,
		};
	}

	function truncateText(text, maxLength = 120) {
		const value = String(text || "").replace(/\s+/g, " ").trim();

		if (value.length <= maxLength) {
			return value;
		}

		return value.slice(0, maxLength - 1).trimEnd() + "…";
	}

	function addUniqueText(target, seen, text, minNormalizedLength = 24) {
		const value = String(text || "").replace(/\s+/g, " ").trim();

		if (!value) {
			return;
		}

		const normalized = normalizeSearchText(value).text;

		if (normalized.length < minNormalizedLength || seen.has(normalized)) {
			return;
		}

		seen.add(normalized);
		target.push(value);
	}

	function cleanQuoteLine(text) {
		return String(text || "")
			.replace(/^\s*>+\s*/, "")
			.replace(/^\s*(?:[-*•◦‣]|\d+[.)]|\([a-z0-9]+\))\s+/, "")
			.replace(/^\s+|\s+$/g, "");
	}

	function splitQuoteLines(text) {
		return String(text || "")
			.split(/\n+/)
			.map(cleanQuoteLine)
			.filter(Boolean);
	}

	function expandSentenceLikeQuoteSegments(text) {
		const segments = [];
		const seen = new Set();
		const cleaned = String(text || "").replace(/\s+/g, " ").trim();

		addUniqueText(segments, seen, cleaned);

		const sentenceParts = cleaned
			.split(/(?<=[.!?])\s+/)
			.map((part) => part.trim())
			.filter(Boolean);

		for (const part of sentenceParts) {
			addUniqueText(segments, seen, part);
		}

		for (let size = Math.min(3, sentenceParts.length); size >= 2; size -= 1) {
			for (let start = 0; start + size <= sentenceParts.length; start += 1) {
				addUniqueText(
					segments,
					seen,
					sentenceParts.slice(start, start + size).join(" "),
				);
			}
		}

		for (const delimiter of [":", " — ", " – ", " - "]) {
			const index = cleaned.indexOf(delimiter);

			if (index !== -1) {
				addUniqueText(segments, seen, cleaned.slice(index + delimiter.length));
			}
		}

		if (sentenceParts.length > 1 && sentenceParts[0].split(/\s+/).length <= 4) {
			addUniqueText(segments, seen, sentenceParts.slice(1).join(" "));
		}

		const labelMatch = cleaned.match(
			/^([a-z][a-z0-9'/-]*(?:\s+[a-z][a-z0-9'/-]*){0,4})\s+([A-Z0-9].{24,})$/,
		);

		if (labelMatch?.[2]) {
			addUniqueText(segments, seen, labelMatch[2]);
		}

		return segments;
	}

	function expandStructuredQuoteSegments(text) {
		const segments = [];
		const seen = new Set();
		const cleaned = String(text || "").replace(/\s+/g, " ").trim();
		const lines = splitQuoteLines(text);

		addUniqueText(segments, seen, cleaned);

		for (const line of lines) {
			for (const segment of expandSentenceLikeQuoteSegments(line)) {
				addUniqueText(segments, seen, segment);
			}
		}

		for (let size = Math.min(4, lines.length); size >= 2; size -= 1) {
			for (let start = 0; start + size <= lines.length; start += 1) {
				const windowText = lines.slice(start, start + size).join(" ");
				addUniqueText(segments, seen, windowText);

				for (const segment of expandSentenceLikeQuoteSegments(windowText)) {
					addUniqueText(segments, seen, segment);
				}
			}
		}

		return segments;
	}

	const SEARCH_BLOCK_TAGS = new Set([
		"ARTICLE",
		"ASIDE",
		"BLOCKQUOTE",
		"BR",
		"DIV",
		"FIGCAPTION",
		"FOOTER",
		"H1",
		"H2",
		"H3",
		"H4",
		"H5",
		"H6",
		"HEADER",
		"LI",
		"MAIN",
		"NAV",
		"OL",
		"P",
		"PRE",
		"SECTION",
		"TD",
		"TH",
		"UL",
	]);

	const SEARCH_SKIP_TAGS = new Set([
		"BUTTON",
		"INPUT",
		"NOSCRIPT",
		"OPTION",
		"SCRIPT",
		"SELECT",
		"STYLE",
		"SVG",
		"TEXTAREA",
	]);

	function extractTextWithBreaks(node) {
		const pieces = [];

		function walk(current) {
			if (current.nodeType === Node.TEXT_NODE) {
				pieces.push(current.textContent || "");
				return;
			}

			if (current.nodeType !== Node.ELEMENT_NODE) {
				return;
			}

			if (current.tagName === "BR") {
				pieces.push("\n");
				return;
			}

			const isBlock = SEARCH_BLOCK_TAGS.has(current.tagName);

			if (isBlock && pieces.length && !/\s$/.test(String(pieces.at(-1)))) {
				pieces.push("\n");
			}

			for (const child of current.childNodes) {
				walk(child);
			}

			if (isBlock) {
				pieces.push("\n");
			}
		}

		for (const child of node.childNodes) {
			walk(child);
		}

		return pieces.join("");
	}

	function buildQuoteSearchVariants(text) {
		const cleaned = String(text || "").replace(/\s+/g, " ").trim();
		const variants = [];
		const seen = new Set();

		const addVariant = (value) => {
			const candidateText = String(value || "").replace(/\s+/g, " ").trim();
			const normalized = normalizeSearchText(candidateText).text;

			if (!candidateText || normalized.length < 24 || seen.has(normalized)) {
				return;
			}

			seen.add(normalized);
			variants.push({
				text: candidateText,
				normalized,
			});
		};

		for (const segment of expandStructuredQuoteSegments(cleaned)) {
			addVariant(segment);
		}

		const phrases = cleaned
			.split(/(?<=[.!?])\s+|\s*[—–-]\s*|\s*:\s*/)
			.map((part) => part.trim())
			.filter(Boolean);

		for (let size = Math.min(3, phrases.length); size >= 1; size -= 1) {
			for (let start = 0; start + size <= phrases.length; start += 1) {
				addVariant(phrases.slice(start, start + size).join(" "));
			}
		}

		const words = cleaned.split(/\s+/).filter(Boolean);

		for (const size of [24, 20, 16, 12, 10, 8]) {
			if (words.length <= size) {
				continue;
			}

			const step = Math.max(1, Math.floor(size / 2));

			for (let start = 0; start + size <= words.length; start += step) {
				addVariant(words.slice(start, start + size).join(" "));
			}
		}

		if (words.length > 8) {
			addVariant(words.slice(0, 12).join(" "));
			addVariant(words.slice(-12).join(" "));
		}

		return variants.sort((a, b) => b.normalized.length - a.normalized.length);
	}

	function extractQuotedTextCandidates(commentHTML) {
		const template = document.createElement("template");
		template.innerHTML = commentHTML || "";

		const candidates = [];
		const seen = new Set();
		const plainText = extractTextWithBreaks(template.content);
		const lines = plainText
			.split(/\n+/)
			.map((line) => line.trim())
			.filter(Boolean);

		let currentQuote = [];

		const flushQuote = () => {
			if (!currentQuote.length) return;

			for (const segment of expandStructuredQuoteSegments(currentQuote.join("\n"))) {
				addUniqueText(candidates, seen, segment);
			}

			currentQuote = [];
		};

		for (const line of lines) {
			const match = line.match(/^>+\s*(.+)$/);

			if (match?.[1]) {
				currentQuote.push(match[1]);
				continue;
			}

			flushQuote();
		}

		flushQuote();

		template.content.querySelectorAll("blockquote").forEach((blockquote) => {
			for (const segment of expandStructuredQuoteSegments(
				extractTextWithBreaks(blockquote),
			)) {
				addUniqueText(candidates, seen, segment);
			}
		});

		for (const match of plainText.matchAll(/[“"]([^”"\n]{24,320})[”"]/g)) {
			if (match[1]) {
				for (const segment of expandSentenceLikeQuoteSegments(match[1])) {
					addUniqueText(candidates, seen, segment);
				}
			}
		}

		return candidates.sort((a, b) => b.length - a.length);
	}

	function shouldSkipElementForIndex(element, options = {}) {
		if (SEARCH_SKIP_TAGS.has(element.tagName)) {
			return true;
		}

		if (options.excludeSelectors?.some((selector) => element.closest(selector))) {
			return true;
		}

		if (!options.skipHidden) {
			return false;
		}

		const style = window.getComputedStyle(element);

		return style.display === "none" || style.visibility === "hidden";
	}

	function buildTextIndex(root, options = {}) {
		const state = {
			rawText: "",
			rawPoints: [],
		};

		const pushChar = (char, point) => {
			state.rawText += char;
			state.rawPoints.push(point);
		};

		const pushSeparator = (char = "\n") => {
			if (!state.rawText || /\s$/.test(state.rawText)) {
				return;
			}

			pushChar(char, null);
		};

		const walk = (node) => {
			if (node.nodeType === Node.TEXT_NODE) {
				const value = node.nodeValue || "";

				if (!value) {
					return;
				}

				if (!value.trim()) {
					if (/\s/.test(value)) {
						pushSeparator(" ");
					}
					return;
				}

				for (let index = 0; index < value.length; index += 1) {
					pushChar(value[index], {
						node,
						offset: index,
					});
				}

				return;
			}

			if (node.nodeType !== Node.ELEMENT_NODE) {
				return;
			}

			if (shouldSkipElementForIndex(node, options)) {
				return;
			}

			if (node.tagName === "BR") {
				pushSeparator("\n");
				return;
			}

			const isBlock = SEARCH_BLOCK_TAGS.has(node.tagName);

			if (isBlock) {
				pushSeparator("\n");
			}

			for (const child of node.childNodes) {
				walk(child);
			}

			if (isBlock) {
				pushSeparator("\n");
			}
		};

		if (root.nodeType === Node.TEXT_NODE) {
			walk(root);
		} else {
			for (const child of root.childNodes) {
				walk(child);
			}
		}

		const normalized = normalizeSearchText(state.rawText);

		return {
			rawText: state.rawText,
			rawPoints: state.rawPoints,
			normalizedText: normalized.text,
			normalizedMap: normalized.map,
		};
	}

	function getArticleSearchRoot() {
		const candidates = [
			document.querySelector("main article"),
			document.querySelector("article"),
			document.querySelector("main"),
			document.querySelector("[role='main']"),
			document.body,
		].filter(Boolean);

		let best = document.body;
		let bestLength = 0;

		for (const candidate of candidates) {
			const index = buildTextIndex(candidate, {
				skipHidden: true,
				excludeSelectors: [
					"#hn-restore-button",
					"#hn-collapse-button",
					"[data-hnewhere-annotation-overlay]",
					"[data-hnewhere-sidebar]",
				],
			});

			const length = index.normalizedText.length;

			if (length > bestLength) {
				best = candidate;
				bestLength = length;
			}

			if (candidate.tagName === "ARTICLE" && length > 800) {
				return candidate;
			}
		}

		return best;
	}

	function buildArticleTextIndex() {
		return buildTextIndex(getArticleSearchRoot(), {
			skipHidden: true,
			excludeSelectors: [
				"#hn-restore-button",
				"#hn-collapse-button",
				"[data-hnewhere-annotation-overlay]",
				"[data-hnewhere-sidebar]",
			],
		});
	}

	function findNormalizedOccurrences(haystack, needle) {
		const matches = [];

		if (!haystack || !needle) {
			return matches;
		}

		let offset = 0;

		while (offset < haystack.length) {
			const index = haystack.indexOf(needle, offset);

			if (index === -1) {
				break;
			}

			const before = index === 0 || haystack[index - 1] === " ";
			const after =
				index + needle.length === haystack.length ||
				haystack[index + needle.length] === " ";

			if (before && after) {
				matches.push(index);
			}

			offset = index + 1;
		}

		return matches;
	}

	function resolveRawPoint(index, rawOffset, bias) {
		if (!index.rawPoints.length) {
			return null;
		}

		const clamped = Math.max(0, Math.min(rawOffset, index.rawPoints.length - 1));
		const point = index.rawPoints[clamped];

		if (point) {
			return point;
		}

		if (bias === "end") {
			for (let i = clamped; i >= 0; i -= 1) {
				if (index.rawPoints[i]) {
					return index.rawPoints[i];
				}
			}

			for (let i = clamped + 1; i < index.rawPoints.length; i += 1) {
				if (index.rawPoints[i]) {
					return index.rawPoints[i];
				}
			}
		} else {
			for (let i = clamped; i < index.rawPoints.length; i += 1) {
				if (index.rawPoints[i]) {
					return index.rawPoints[i];
				}
			}

			for (let i = clamped - 1; i >= 0; i -= 1) {
				if (index.rawPoints[i]) {
					return index.rawPoints[i];
				}
			}
		}

		return null;
	}

	function createRangeFromMatch(index, matchStart, matchLength) {
		const startRaw = index.normalizedMap[matchStart];
		const endRaw = index.normalizedMap[matchStart + matchLength - 1];

		if (startRaw == null || endRaw == null) {
			return null;
		}

		const start = resolveRawPoint(index, startRaw, "start");
		const end = resolveRawPoint(index, endRaw, "end");

		if (!start || !end) {
			return null;
		}

		const range = document.createRange();

		try {
			range.setStart(start.node, start.offset);
			range.setEnd(end.node, end.offset + 1);
		} catch {
			return null;
		}

		return range.collapsed
			? null
			: {
				startRaw,
				endRaw,
				range,
			};
	}

	function findRangeInRoot(root, normalizedNeedle, uniqueOnly = true) {
		const index = buildTextIndex(root, {
			skipHidden: false,
			excludeSelectors: ["[data-hnewhere-quote-link='1']"],
		});
		const matches = findNormalizedOccurrences(index.normalizedText, normalizedNeedle);

		if (!matches.length || (uniqueOnly && matches.length !== 1)) {
			return null;
		}

		return createRangeFromMatch(index, matches[0], normalizedNeedle.length)?.range || null;
	}

	function findBestQuoteMatch(articleIndex, quoteText) {
		let best = null;

		for (const [variantIndex, variant] of buildQuoteSearchVariants(quoteText).entries()) {
			const matches = findNormalizedOccurrences(
				articleIndex.normalizedText,
				variant.normalized,
			);

			if (!matches.length) {
				continue;
			}

			const unique = matches.length === 1;
			const allowFallback = !unique && variant.normalized.length >= 80 && matches.length <= 3;

			if (!unique && !allowFallback) {
				continue;
			}

			const rangeMatch = createRangeFromMatch(
				articleIndex,
				matches[0],
				variant.normalized.length,
			);

			if (!rangeMatch || !getPageRectsForRange(rangeMatch.range).length) {
				continue;
			}

			const score =
				variant.normalized.length * 10 +
				(unique ? 10000 : 0) -
				variantIndex * 3 -
				(matches.length - 1) * 150;

			if (!best || score > best.score) {
				best = {
					score,
					key: `${rangeMatch.startRaw}:${rangeMatch.endRaw}`,
					range: rangeMatch.range,
					quoteText: unique ? quoteText : variant.text,
					fullQuoteText: quoteText,
					quoteNormalized: variant.normalized,
					startRaw: rangeMatch.startRaw,
					endRaw: rangeMatch.endRaw,
				};
			}
		}

		return best;
	}

	function getPageRectsForRange(range) {
		return [...range.getClientRects()]
			.filter((rect) => rect.width > 0 && rect.height > 0)
			.map((rect) => ({
				left: rect.left + window.scrollX,
				top: rect.top + window.scrollY,
				width: rect.width,
				height: rect.height,
				right: rect.right + window.scrollX,
			}));
	}

	function scrollRangeIntoView(range) {
		const rect = range.getBoundingClientRect();

		window.scrollTo({
			top: Math.max(0, rect.top + window.scrollY - window.innerHeight * 0.3),
			behavior: "smooth",
		});
	}

	function flashSidebarComment(element) {
		element.classList.add("comment-target");

		window.setTimeout(() => {
			element.classList.remove("comment-target");
		}, 1200);
	}

	function buildAnnotationGroups(comments) {
		const articleIndex = buildArticleTextIndex();

		if (!articleIndex.normalizedText) {
			return [];
		}

		for (const rendered of comments) {
			rendered.matchedGroupKeys = new Set();
		}

		const groups = new Map();

		for (const rendered of comments) {
			const quoteCandidates = extractQuotedTextCandidates(rendered.textHTML);
			const matchedQuoteKeys = new Set();

			for (const quoteText of quoteCandidates) {
				const match = findBestQuoteMatch(articleIndex, quoteText);

				if (!match || matchedQuoteKeys.has(match.key)) {
					continue;
				}

				const group = groups.get(match.key) || {
					key: match.key,
					range: match.range,
					quoteText: match.quoteText,
					fullQuoteText: match.fullQuoteText,
					comments: [],
				};

				group.comments.push({
					commentId: rendered.id,
					element: rendered.element,
					textElement: rendered.textElement,
					author: rendered.author,
					time: rendered.time,
					commentText: rendered.textElement?.textContent || "",
					quoteText: match.quoteText,
					quoteNormalized: match.quoteNormalized,
					fullQuoteText: match.fullQuoteText,
				});

				groups.set(match.key, group);
				rendered.matchedGroupKeys.add(match.key);
				matchedQuoteKeys.add(match.key);
			}
		}

		return [...groups.values()];
	}

	function createHighlightRect(rect, options = {}) {
		const node = document.createElement(options.interactive ? "button" : "div");
		const variant = options.variant || "highlight";
		const style = {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			borderRadius: "3px",
			background: options.emphasis
				? "rgba(255,102,0,.22)"
				: "rgba(255,102,0,.08)",
		};

		if (variant === "underline") {
			style.top = rect.top + Math.max(0, rect.height - 2);
			style.height = 2;
			style.borderRadius = "999px";
			style.background = options.emphasis
				? "rgba(255,102,0,.6)"
				: "rgba(255,102,0,.34)";
		}

		if (options.interactive) {
			node.type = "button";
			node.title = options.title || "Show linked Hacker News comments";
			node.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				options.onActivate?.();
			};
		}

		node.style.cssText = `
			position:absolute;
			left:${style.left}px;
			top:${style.top}px;
			width:${style.width}px;
			height:${style.height}px;
			border:${options.interactive ? "none" : "0"};
			border-radius:${style.borderRadius};
			background:${style.background};
			padding:0;
			cursor:${options.interactive ? "pointer" : "default"};
			pointer-events:${options.interactive ? "auto" : "none"};
		`;

		return node;
	}

	function getCommentGraph() {
		const byId = new Map(renderedComments.map((comment) => [comment.id, comment]));
		const childrenByParent = new Map();

		for (const comment of renderedComments) {
			if (comment.parentId == null) {
				continue;
			}

			const children = childrenByParent.get(comment.parentId) || [];
			children.push(comment.id);
			childrenByParent.set(comment.parentId, children);
		}

		return { byId, childrenByParent };
	}

	function getVisibleCommentIds(commentIds) {
		const { byId, childrenByParent } = getCommentGraph();
		const visible = new Set();

		const addDescendants = (commentId) => {
			if (visible.has(commentId)) {
				return;
			}

			visible.add(commentId);

			for (const childId of childrenByParent.get(commentId) || []) {
				addDescendants(childId);
			}
		};

		for (const commentId of commentIds) {
			let currentId = commentId;

			while (currentId != null) {
				if (visible.has(currentId)) {
					break;
				}

				visible.add(currentId);
				currentId = byId.get(currentId)?.parentId ?? null;
			}

			addDescendants(commentId);
		}

		return visible;
	}

	function setActiveFilterMatchChip(commentId) {
		sidebarUI?.filterMatchList
			?.querySelectorAll(".filter-match-chip")
			.forEach((chip) => {
				chip.classList.toggle(
					"filter-match-chip-active",
					chip.dataset.commentId === String(commentId),
				);
			});
	}

	function renderFilterMatchList(group) {
		const list = sidebarUI?.filterMatchList;

		if (!list) {
			return;
		}

		list.replaceChildren();

		if ((group?.comments?.length || 0) <= 1) {
			list.classList.add("hidden");
			return;
		}

		for (const match of group.comments) {
			const chip = document.createElement("button");
			chip.type = "button";
			chip.className = "filter-match-chip";
			chip.dataset.commentId = String(match.commentId);
			chip.textContent = match.author || "anonymous";
			chip.title = truncateText(match.commentText || match.fullQuoteText || "", 180);
			chip.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				setActiveFilterMatchChip(match.commentId);
				scrollToCommentElement(match.element);
			};
			list.appendChild(chip);
		}

		setActiveFilterMatchChip(group.comments[0]?.commentId);
		list.classList.remove("hidden");
	}

	function applyCommentFilter(groupKey, options = {}) {
		const group = annotationController?.groupsByKey.get(groupKey);

		if (!group) {
			clearCommentFilter(options);
			return;
		}

		activeCommentFilter = groupKey;

		const targetMatch =
			group.comments.find((match) => match.commentId === options.commentId) ||
			group.comments[0];
		const directMatchIds = new Set(group.comments.map((comment) => comment.commentId));
		const visibleCommentIds = getVisibleCommentIds([...directMatchIds]);

		positionFilterBannerForComment(targetMatch?.element);

		transitionCommentList(() => {
			for (const rendered of renderedComments) {
				rendered.element.classList.toggle(
					"comment-filter-hidden",
					!visibleCommentIds.has(rendered.id),
				);

				if (
					visibleCommentIds.has(rendered.id) &&
					rendered.contentElement.classList.contains("hidden")
				) {
					rendered.contentElement.classList.remove("hidden");
					rendered.toggleElement.textContent = "[–]";
					rendered.element.dataset.filterExpanded = "1";
				}
			}

			setQuoteRedundancy(group, true);
			updateSubmissionVisibility(visibleCommentIds);
			renderFilterMatchList(group);

			if (sidebarUI?.filterBanner && sidebarUI?.filterBannerQuote) {
				sidebarUI.filterBanner.classList.remove("hidden");
				sidebarUI.filterBannerQuote.textContent = truncateText(
					group.fullQuoteText || group.quoteText,
					220,
				);
			}

			if (sidebarUI?.filterBannerMeta) {
				sidebarUI.filterBannerMeta.textContent = "";
			}
		}, options);

		setActiveFilterMatchChip(targetMatch?.commentId);

		if (options.scroll !== false) {
			scrollToCommentElement(targetMatch?.element);
		}
	}

	function activateCommentQuoteElement(element, onActivate) {
		element.classList.add("comment-quote-link");
		element.setAttribute("role", "button");
		element.tabIndex = 0;
		element.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			onActivate();
		};
		element.onkeydown = (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			event.preventDefault();
			onActivate();
		};
	}

	function wrapInlineCommentQuote(range, onActivate) {
		const fragment = range.extractContents();

		if (
			fragment.querySelector(
				"article, aside, blockquote, div, footer, header, h1, h2, h3, h4, h5, h6, li, ol, p, pre, section, table, ul",
			)
		) {
			range.insertNode(fragment);
			return null;
		}

		const wrapper = document.createElement("span");
		wrapper.dataset.hnewhereQuoteLink = "1";
		wrapper.className = "comment-quote-link comment-quote-link-inline";
		wrapper.appendChild(fragment);
		range.insertNode(wrapper);
		activateCommentQuoteElement(wrapper, onActivate);
		return wrapper;
	}

	function decorateSidebarMatches(controller) {
		for (const group of controller.groups) {
			for (const comment of group.comments) {
				const onActivate = () => {
					applyCommentFilter(group.key, {
						scroll: false,
						commentId: comment.commentId,
					});
					controller.focusGroup(group.key);
				};
				const quoteElements = [];
				const blockquote = [...comment.textElement.querySelectorAll("blockquote")].find(
					(element) =>
						!element.dataset.hnewhereQuoteBlock &&
						normalizeSearchText(element.textContent).text.includes(
							comment.quoteNormalized,
						),
				);

				if (blockquote) {
					blockquote.dataset.hnewhereQuoteBlock = "1";
					activateCommentQuoteElement(blockquote, onActivate);
					quoteElements.push(blockquote);
					comment.quoteElements = quoteElements;
					continue;
				}

				const range = findRangeInRoot(
					comment.textElement,
					comment.quoteNormalized,
					false,
				);

				if (range) {
					const wrapper = wrapInlineCommentQuote(range, onActivate);
					if (wrapper) {
						quoteElements.push(wrapper);
					}
				}

				comment.quoteElements = quoteElements;
			}
		}
	}

	async function openFocusedDiscussion(groupKey, options = {}) {
		const wasHidden = await revealSidebar();

		applyCommentFilter(groupKey, options);

		if (wasHidden) {
			await refreshArticleAnnotations();
		}
	}

	function createAnnotationOverlay(groups, settings) {
		const overlay = document.createElement("div");
		overlay.setAttribute("data-hnewhere-annotation-overlay", "1");
		overlay.style.cssText = `
			position:absolute;
			left:0;
			top:0;
			width:100%;
			pointer-events:none;
			z-index:2147483645;
		`;

		const baseLayer = document.createElement("div");
		overlay.append(baseLayer);
		document.body.appendChild(overlay);

		const groupsByKey = new Map(groups.map((group) => [group.key, group]));
		let renderFrame = 0;

		const render = () => {
			overlay.style.height =
				Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) +
				"px";
			baseLayer.replaceChildren();

			for (const group of groups) {
				const rects = getPageRectsForRange(group.range);

				if (!rects.length) {
					continue;
				}

				for (const rect of rects) {
					baseLayer.appendChild(
						createHighlightRect(rect, {
							interactive: true,
							title: "Show linked Hacker News comments",
							onActivate: () => {
								openFocusedDiscussion(group.key).catch(console.error);
							},
							variant: "highlight",
						}),
					);

					baseLayer.appendChild(
						createHighlightRect(rect, {
							interactive: true,
							title: "Show linked Hacker News comments",
							onActivate: () => {
								openFocusedDiscussion(group.key).catch(console.error);
							},
							variant: "underline",
						}),
					);
				}
			}
		};

		const scheduleRender = () => {
			if (renderFrame) {
				return;
			}

			renderFrame = requestAnimationFrame(() => {
				renderFrame = 0;
				render();
			});
		};

		window.addEventListener("resize", scheduleRender);
		window.addEventListener("load", scheduleRender, true);
		render();

		return {
			groups,
			groupsByKey,
			focusGroup(groupKey) {
				const group = groupsByKey.get(groupKey);

				if (!group) {
					return;
				}

				scrollRangeIntoView(group.range);
			},
			cleanup() {
				window.removeEventListener("resize", scheduleRender);
				window.removeEventListener("load", scheduleRender, true);

				if (renderFrame) {
					cancelAnimationFrame(renderFrame);
				}

				overlay.remove();
			},
		};
	}

	async function refreshArticleAnnotations() {
		clearArticleAnnotations();

		if (!sidebar || !renderedComments.length) {
			return;
		}

		const settings = await loadSettings();

		if (!settings.annotations) {
			clearCommentFilter({ animate: false });
			return;
		}

		if (!shouldShowArticleAnnotations(settings)) {
			return;
		}

		const groups = buildAnnotationGroups(renderedComments);

		if (!groups.length) {
			clearCommentFilter({ animate: false });
			return;
		}

		annotationController = createAnnotationOverlay(groups, settings);
		decorateSidebarMatches(annotationController);

		if (activeCommentFilter) {
			applyCommentFilter(activeCommentFilter, {
				scroll: false,
				animate: false,
			});
		}
	}

	// -------------------------
	// Initialization
	// -------------------------

	async function init() {
		await migrateStorage();

		// On HN, only record clicked stories and service popup vote actions.
		if (location.hostname === "news.ycombinator.com") {
			setupHNListener();

			// Order matters: after the vote navigation the hash is gone and the
			// payload is in sessionStorage, so the post-vote report has to be
			// checked before treating this as a fresh bridge request.
			if (reportVoteResultAfterReload()) {
				return;
			}

			maybeHandleHNVoteBridge();
			return;
		}

		// Before anything renders, so the first paint already knows what is voted.
		await loadRememberedVotes();

		const settings = await loadSettings();
		const siteState = await loadSidebarState();

		// Check if we arrived here by clicking
		// a story from Hacker News.
		let last = await load(STORAGE.last, null);

		if (last && Date.now() - last.timestamp > 300000) {
			await save(STORAGE.last, null);
			last = null;
		}

		if (
			last &&
			sameURL(last.url, location.href) &&
			Date.now() - last.timestamp < 300000
		) {
			await save(STORAGE.last, null);

			const storyRefs = last.ids.map((id) => ({
				objectID: id,
			}));

			if (shouldAutoOpenSidebar(settings, siteState)) {
				await openSidebar(storyRefs);
			} else if (shouldPreloadHiddenSidebar(settings, siteState)) {
				await openSidebar(storyRefs, {
					startHidden: true,
				});
			} else {
				await createCollapsedButton(storyRefs);
			}

			return;
		}

		// Otherwise, silently check if this URL
		// already has an HN discussion.
		if (shouldDeferInitialLookup(settings, siteState)) {
			await createCollapsedButton(async () => {
				const stories = await findHN(location.href);
				return stories.map((story) => ({
					objectID: story.objectID,
				}));
			});
			return;
		}

		const stories = await findHN(location.href);

		if (stories.length) {
			const storyRefs = stories.map((story) => ({
				objectID: story.objectID,
			}));

			if (shouldAutoOpenSidebar(settings, siteState)) {
				await openSidebar(storyRefs);
			} else if (shouldPreloadHiddenSidebar(settings, siteState)) {
				await openSidebar(storyRefs, {
					startHidden: true,
				});
			} else {
				await createCollapsedButton(storyRefs);
			}
		}
	}

	init().catch(console.error);
})();
