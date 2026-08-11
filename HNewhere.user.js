// ==UserScript==
// @name         Backchannel
// @namespace    https://github.com/twalichiewicz/HNewhere
// @version      1.6.7
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/twalichiewicz/Backchannel/main/HNewhere.user.js
// @downloadURL  https://raw.githubusercontent.com/twalichiewicz/Backchannel/main/HNewhere.user.js
// @homepageURL  https://github.com/twalichiewicz/Backchannel
// @supportURL   https://github.com/twalichiewicz/Backchannel/issues
// @description  See what everyone's talking about.
// @include      http://*
// @include      https://*
// @exclude      *://localhost/*
// @exclude      *://localhost:*/*
// @exclude      *://127.0.0.1/*
// @exclude      *://127.0.0.1:*/*
// @exclude      *://127.*.*.*/*
// @exclude      https://*.google.*/*
// @exclude      https://chatgpt.com/
// @exclude      https://claude.ai/
// @exclude      https://x.com/
// @exclude      https://mail.*.*/*
// @exclude      https://*.googleusercontent.com/*
// @exclude      https://*.doubleclick.net/*
// @exclude      https://*.facebook.com/*
// @exclude      https://*.twitter.com/*
// @exclude      https://*.linkedin.com/*
// @exclude      https://*.youtube.com/
// @include      https://*.youtube.com/watch?v=*
// @exclude      https://outlook.*/*
// @exclude      https://*.slack.com/*
// @exclude      https://*.notion.so/*
// @exclude      https://*.figma.com/*
// @exclude      https://*.atlassian.net/*
// @exclude      https://*.paypal.com/*
// @exclude      https://*.stripe.com/*
// @exclude      https://console.aws.amazon.com/*
// @exclude      https://portal.azure.com/*
// @exclude      https://*.netflix.com/*
// @exclude      https://web.whatsapp.com/*
// @exclude      https://*.instagram.com/*
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @connect      hacker-news.firebaseio.com
// @connect      hn.algolia.com
// @connect      news.ycombinator.com
// @connect      www.reddit.com
// @connect      arctic-shift.photon-reddit.com
// @connect      public.api.bsky.app
// @connect      constellation.microcosm.blue
// @connect      lobste.rs
// @connect      en.wikipedia.org
// @connect      lemmy.world
// @connect      mastodon.social
// @connect      www.tootfinder.ch
// @connect      api.hypothes.is
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
			console.error("Backchannel migration failed:", e);
		}
	}

	const SOURCE_KEY_MIGRATION = "HNewhere:migrated_source_keys";

	async function migrateSourceKeys() {
		if (await load(SOURCE_KEY_MIGRATION, false)) {
			return;
		}

		try {
			await save(
				STORAGE.collapsed,
				migrateCollapsedIds(await load(STORAGE.collapsed, [])),
			);
			await save(STORAGE.seen, migrateSeenTimes(await load(STORAGE.seen, {})));
			await save(SOURCE_KEY_MIGRATION, 1);
		} catch (e) {
			console.error("Backchannel source key migration failed:", e);
		}
	}

	const QUEUE_KEY_MIGRATION = "HNewhere:migrated_queue_keys";

	async function migrateQueue() {
		if (await load(QUEUE_KEY_MIGRATION, false)) {
			return;
		}

		try {
			await saveQueue(migrateQueueKeys(await loadQueue(), normalizeURL));
			await save(QUEUE_KEY_MIGRATION, 1);
		} catch (e) {
			console.error("Backchannel queue key migration failed:", e);
		}
	}

	const SOURCE_SEED_MIGRATION = "HNewhere:seeded_sources";

	const PRIOR_STORAGE_KEYS = [
		"HNewhere:migrated",
		"hn_width",
		"hn_button_position",
		"hn_last",
		"hn_collapsed_comments",
		"hn_seen_comments",
		"HNewhere:width",
		"HNewhere:settings",
		"HNewhere:sidebar_state",
		"HNewhere:collapsed_comments",
		"HNewhere:seen_comments",
	];

	async function hadPriorStorage() {
		for (const key of PRIOR_STORAGE_KEYS) {
			if ((await load(key, null)) !== null) {
				return true;
			}
		}

		return false;
	}

	// Runs before every other migration, because those write, and "has this reader
	// been here before" is only answerable while the store is still untouched.
	async function seedSources() {
		if (await load(SOURCE_SEED_MIGRATION, false)) {
			return;
		}

		try {
			const stored = await load(STORAGE.settings, {});
			const seeded = seedSourcesForExistingReader(
				await hadPriorStorage(),
				stored?.sources,
			);

			if (seeded) {
				await save(STORAGE.settings, { ...stored, sources: seeded });
			}

			await save(SOURCE_SEED_MIGRATION, 1);
		} catch (e) {
			console.error("Backchannel source seeding failed:", e);
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
		blocked: "HNewhere:blocked_sites",
		queue: "HNewhere:queue",
		itemActions: "HNewhere:item_actions",
	};

	// #region hnewhere-test-export
	// Identifiers carry their source. Two sources number their comments
	// independently, and buildCommentGraph walks parent links by identity, so
	// unprefixed ids make the graph correct only by the accident that HN's are
	// integers and Reddit's are base36. A graph that is acyclic only by luck will
	// eventually not be.
	const SOURCE_KEY_SEPARATOR = ":";

	function sourceKey(source, id) {
		return source + SOURCE_KEY_SEPARATOR + id;
	}

	function parseSourceKey(key) {
		const text = String(key ?? "");
		const at = text.indexOf(SOURCE_KEY_SEPARATOR);

		if (at < 1 || at === text.length - 1) {
			return null;
		}

		return { source: text.slice(0, at), id: text.slice(at + 1) };
	}

	function migrateCollapsedIds(stored) {
		if (!Array.isArray(stored)) {
			return [];
		}

		return stored.map((id) =>
			parseSourceKey(id) ? String(id) : sourceKey("hn", id),
		);
	}

	function migrateSeenTimes(stored) {
		if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
			return {};
		}

		const migrated = {};

		for (const [key, value] of Object.entries(stored)) {
			migrated[parseSourceKey(key) ? key : sourceKey("hn", key)] = value;
		}

		return migrated;
	}

	// Registration order decides the answer, not the stored object's key order: a
	// reader who enabled Reddit first must not get Reddit-first discovery for it.
	function normalizeSourceSettings(stored, registeredIds) {
		const source =
			stored && typeof stored === "object" && !Array.isArray(stored)
				? stored
				: {};
		const normalized = {};

		for (const id of registeredIds) {
			normalized[id] = Boolean(source[id]);
		}

		return normalized;
	}

	// Anything unreadable reads as nothing enabled. The failure mode of this
	// function is network traffic to somebody else's server, so it fails closed.
	function enabledSourceIds(settings, registeredIds) {
		const normalized = normalizeSourceSettings(settings?.sources, registeredIds);

		return registeredIds.filter((id) => normalized[id]);
	}

	function seedSourcesForExistingReader(hadPrior, storedSources) {
		if (storedSources !== undefined && storedSources !== null) {
			return null;
		}

		return hadPrior ? { hn: true } : null;
	}
	// #endregion hnewhere-test-export

	const VOTE_MEMORY_TTL = 90 * 24 * 60 * 60 * 1000;

	// #region hnewhere-test-export
	const BUTTON_SIZE_MIN = 24;
	const BUTTON_SIZE_MAX = 64;
	const BUTTON_SIZE_STEP = 4;
	const BUTTON_SIZE_DEFAULT = 44;

	// 1.5.4 stored these as named presets. Mapped rather than discarded so an
	// existing choice survives the change to a pixel value.
	const LEGACY_BUTTON_SIZES = {
		small: 36,
		medium: 44,
		large: 56,
	};

	const BUTTON_SHAPES = {
		circle: "50%",
		squircle: "30%",
	};

	// One or two characters, because that is what a 44px circle holds.
	const BUTTON_MARK_DEFAULT = "BC";
	const BUTTON_MARK_MAX = 2;

	function normalizeButtonMark(value) {
		const text = String(value ?? "")
			.trim()
			.slice(0, BUTTON_MARK_MAX)
			.toUpperCase();

		return text || BUTTON_MARK_DEFAULT;
	}

	function normalizeButtonSize(value) {
		const raw = typeof value === "string" ? LEGACY_BUTTON_SIZES[value] : value;
		const numeric = Number.isFinite(raw)
			? Math.round(raw)
			: BUTTON_SIZE_DEFAULT;

		return Math.min(BUTTON_SIZE_MAX, Math.max(BUTTON_SIZE_MIN, numeric));
	}

	function stepButtonSize(current, direction) {
		const from = normalizeButtonSize(current);
		const next =
			direction > 0
				? Math.floor(from / BUTTON_SIZE_STEP) * BUTTON_SIZE_STEP +
					BUTTON_SIZE_STEP
				: Math.ceil(from / BUTTON_SIZE_STEP) * BUTTON_SIZE_STEP -
					BUTTON_SIZE_STEP;

		return normalizeButtonSize(next);
	}

	// Kept proportional to the button rather than fixed, and bounded so "HN" still
	// fits inside a 24px button and does not swamp a 64px one.
	function buttonFontSizeFor(size) {
		return Math.min(18, Math.max(9, Math.round(size * 0.3)));
	}

	let themePreference = "auto";
	let buttonShapePreference = "circle";
	let buttonSizePreference = BUTTON_SIZE_DEFAULT;
	let buttonMarkPreference = BUTTON_MARK_DEFAULT;
	let accentPreference = null;

	// The only writer of the caches. Called by loadSettings and saveSettings so they
	// cannot drift from stored settings, and directly by tests.
	function syncAppearancePreferences(settings) {
		themePreference = settings.theme || "auto";
		buttonShapePreference = BUTTON_SHAPES[settings.buttonShape]
			? settings.buttonShape
			: "circle";
		buttonSizePreference = normalizeButtonSize(settings.buttonSize);
		buttonMarkPreference = normalizeButtonMark(settings.buttonMark);
		accentPreference =
			typeof settings.accentColor === "string" ? settings.accentColor : null;
	}
	// #endregion hnewhere-test-export

	const DEFAULT_SETTINGS = {
		annotations: false,
		annotationsWhenSidebarClosed: false,
		autoOpenSidebar: false,
		autoOpenSidebarOnlyFromHN: false,
		hideWithoutDiscussion: false,
		showButtonWithQueue: false,
		sources: undefined,
		// "auto" reproduces the pre-1.5.4 behaviour of following the page.
		theme: "auto",
		buttonShape: "circle",
		buttonSize: BUTTON_SIZE_DEFAULT,
		buttonMark: BUTTON_MARK_DEFAULT,
		accentColor: null,
		commentSort: "best",
	};

	// #region hnewhere-test-export
	const HN_ORIGIN = "https://news.ycombinator.com";
	// #endregion hnewhere-test-export

	const REPO_URL = "https://github.com/twalichiewicz/Backchannel";

	const SCRIPT_VERSION = (() => {
		try {
			return GM?.info?.script?.version || "";
		} catch {
			return "";
		}
	})();

	const ITEM_ACTION_BRIDGE_MESSAGE_SOURCE = "HNewhereVoteBridge";
	const SUBMIT_BRIDGE_MESSAGE_SOURCE = "HNewhereSubmitBridge";
	const COMMENT_BRIDGE_MESSAGE_SOURCE = "HNewhereCommentBridge";

	// HN truncates submission titles at 80 characters.
	const HN_TITLE_LIMIT = 80;

	const ITEM_ACTION_BRIDGE_STORAGE_KEY = "hnewhere-vote-bridge";
	const SUBMIT_BRIDGE_STORAGE_KEY = "hnewhere-submit-bridge";
	const COMMENT_BRIDGE_STORAGE_KEY = "hnewhere-comment-bridge";

	const BRIDGE_PAYLOAD_PREFIX = "HNewhere:bridge_payload:";

	// Long enough to survive a slow HN, short enough that an abandoned popup's
	// payload does not sit in storage indefinitely.
	const BRIDGE_PAYLOAD_TTL = 10 * 60 * 1000;
	// #region hnewhere-test-export
	const TRACKING_PARAMS = new Set([
		"utm_source",
		"utm_medium",
		"utm_campaign",
		"utm_term",
		"utm_content",
		"fbclid",
		"gclid",
	]);

	// Families, for the names whose suffix is per link. Kept narrow: stripping a
	// parameter that identifies a page shows the wrong discussion.
	const TRACKING_PATTERNS = [/^utm_/, /^syn-/];

	function isTrackingParam(key) {
		const name = String(key || "").toLowerCase();

		return (
			TRACKING_PARAMS.has(name) ||
			TRACKING_PATTERNS.some((pattern) => pattern.test(name))
		);
	}
	// #endregion hnewhere-test-export

	let sidebar = null;
	let sidebarUI = null;
	let opening = false;
	let openingRun = null;
	let sidebarGeneration = 0;
	let renderedComments = [];
	// Which sources the open sidebar is showing, so per-thread decisions -- the vote
	// gutter, for one -- do not have to walk the comment list to find out.
	const sidebarSourceKeys = new Set();
	const liveDiscussions = new Map();
	let annotationController = null;
	// Unsubscribes the pass from "the document gained text" -- a PDF page being
	// drawn, or its text arriving. Torn down with the annotations it belongs to.
	let stopDocumentReindex = null;
	let activeCommentFilter = null;

	let preFilterPosition = null;

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

		if (merged.annotationsWhenSidebarClosed == null) {
			merged.annotationsWhenSidebarClosed = false;
		}

		syncAppearancePreferences(merged);

		return merged;
	}

	async function saveSettings(patch) {
		const next = {
			...(await loadSettings()),
			...patch,
		};

		await save(STORAGE.settings, next);

		syncAppearancePreferences(next);

		return next;
	}

	function siteKey() {
		return location.hostname;
	}

	// Exact hostname only, matching how per-site widths are keyed. Subdomains are
	// therefore independent entries, which is what "hide it on this site" means.
	async function loadBlockedSites() {
		const stored = await load(STORAGE.blocked, []);

		return new Set(
			Array.isArray(stored)
				? stored.filter((entry) => typeof entry === "string")
				: [],
		);
	}

	async function saveBlockedSites(sites) {
		await save(STORAGE.blocked, [...sites].sort());
	}

	async function isSiteBlocked() {
		const entries = await loadBlockedSites();

		return pageIsBlocked(entries, siteKey(), location.href);
	}

	// #region hnewhere-test-export

	const BLOCKED_PAGE_PREFIX = "page:";

	function blockedPageEntry(url) {
		const normalized = normalizeURL(url);

		return normalized ? BLOCKED_PAGE_PREFIX + normalized : null;
	}

	function pageIsBlocked(entries, hostname, url) {
		if (entries.has(hostname)) {
			return true;
		}

		const page = blockedPageEntry(url);

		return Boolean(page && entries.has(page));
	}

	function describeBlockedEntry(entry) {
		return entry.startsWith(BLOCKED_PAGE_PREFIX)
			? entry.slice(BLOCKED_PAGE_PREFIX.length)
			: entry + " (domain-wide)";
	}

	function addToQueue(entries, story, now) {
		const list = Array.isArray(entries) ? entries : [];

		if (list.some((entry) => entry.key === story.key)) {
			return list;
		}

		return [
			...list,
			{
				id: story.id,
				key: story.key,
				source: story.source,
				permalink: story.permalink || "",
				url: story.url,
				title: story.title,
				by: story.by || "",
				score: story.score || 0,
				time: story.time || 0,
				descendants: story.descendants || 0,
				site: story.site || "",
				addedAt: now,
				readAt: null,
			},
		];
	}

	function removeFromQueue(entries, key) {
		return (Array.isArray(entries) ? entries : []).filter(
			(entry) => entry.key !== key,
		);
	}

	function migrateQueueKeys(entries, normalize) {
		return (Array.isArray(entries) ? entries : []).map((entry) =>
			entry.key
				? entry
				: {
						...entry,
						key: normalize(entry.url || ""),
						source: entry.source || "hn",
						permalink:
							entry.permalink || "https://news.ycombinator.com/item?id=" + entry.id,
					},
		);
	}

	function sortQueue(entries) {
		return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
			const aRead = a.readAt ? 1 : 0;
			const bRead = b.readAt ? 1 : 0;

			if (aRead !== bRead) {
				return aRead - bRead;
			}

			return aRead ? b.readAt - a.readAt : a.addedAt - b.addedAt;
		});
	}

	function markQueueRead(entries, url, now, matches = sameURL) {
		return (Array.isArray(entries) ? entries : []).map((entry) =>
			!entry.readAt && matches(entry.url, url)
				? { ...entry, readAt: now }
				: entry,
		);
	}

	function clearReadFromQueue(entries) {
		return (Array.isArray(entries) ? entries : []).filter(
			(entry) => !entry.readAt,
		);
	}

	function nextUnreadInQueue(entries) {
		return sortQueue(entries).find((entry) => !entry.readAt) || null;
	}

	function unreadQueueCount(entries) {
		return (Array.isArray(entries) ? entries : []).filter(
			(entry) => !entry.readAt,
		).length;
	}

	// #endregion hnewhere-test-export

	async function markQueueArrival(url = pageAddress(), now = Date.now()) {
		const entries = await loadQueue();

		if (!entries.length) {
			return false;
		}

		const marked = markQueueRead(entries, url, now);

		if (marked.every((entry, index) => entry === entries[index])) {
			return false;
		}

		await saveQueue(marked);

		// The strip is showing what comes next, and what comes next has just changed.
		if (sidebarUI?.shadow) {
			refreshQueueCount(sidebarUI.shadow).catch(console.error);
			refreshNextUp(sidebarUI.shadow).catch(console.error);
		}

		return true;
	}

	async function loadQueue() {
		const stored = await load(STORAGE.queue, []);

		return Array.isArray(stored) ? stored.filter((entry) => entry?.id) : [];
	}

	async function saveQueue(entries) {
		await save(STORAGE.queue, entries);
		return entries;
	}

	async function loadSiteWidth() {
		const widths = await load(STORAGE.widths, {});
		const perSiteWidth =
			widths && typeof widths === "object" ? widths[siteKey()] : undefined;

		if (typeof perSiteWidth === "number" && Number.isFinite(perSiteWidth)) {
			return perSiteWidth;
		}

		const savedWidth = await load(STORAGE.width, null);

		if (typeof savedWidth === "number" && Number.isFinite(savedWidth)) {
			return savedWidth;
		}

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

	let rememberedItemActions = {};

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

	async function loadRememberedItemActions() {
		const stored = await load(STORAGE.itemActions, {});
		const now = Date.now();
		const kept = {};
		let expired = 0;

		if (stored && typeof stored === "object" && !Array.isArray(stored)) {
			for (const [itemId, record] of Object.entries(stored)) {
				if (!record || typeof record !== "object") {
					continue;
				}

				if (Number.isFinite(record.at) && now - record.at > VOTE_MEMORY_TTL) {
					expired++;
					continue;
				}

				kept[itemId] = record;
			}
		}

		rememberedItemActions = kept;

		if (expired) {
			await save(STORAGE.itemActions, kept);
		}
	}

	function rememberItemAction(itemId, patch) {
		const key = String(itemId);
		const next = { ...(rememberedItemActions[key] || {}), ...patch, at: Date.now() };

		rememberedItemActions[key] = next;
		save(STORAGE.itemActions, rememberedItemActions).catch(console.error);

		return next;
	}

	function itemActionState(itemId) {
		return rememberedItemActions[String(itemId)] || null;
	}

	// Kept under a key no story id can collide with, since it is not about a story.
	const ITEM_ACTION_ACCOUNT_KEY = "account";

	function rememberItemActionUnavailable(field) {
		const account = rememberedItemActions[ITEM_ACTION_ACCOUNT_KEY] || {};

		rememberedItemActions[ITEM_ACTION_ACCOUNT_KEY] = {
			...account,
			[field + "Unavailable"]: true,
			at: Date.now(),
		};

		save(STORAGE.itemActions, rememberedItemActions).catch(console.error);
	}

	function clearItemActionUnavailable(field) {
		const account = rememberedItemActions[ITEM_ACTION_ACCOUNT_KEY];

		if (!account?.[field + "Unavailable"]) {
			return;
		}

		delete account[field + "Unavailable"];
		save(STORAGE.itemActions, rememberedItemActions).catch(console.error);
		refreshAllItemActionControls();
	}

	function itemActionUnavailable(field) {
		return Boolean(
			rememberedItemActions[ITEM_ACTION_ACCOUNT_KEY]?.[field + "Unavailable"],
		);
	}

	// Favourite and flag are Hacker News's, not every voting source's.
	function sourceHasItemActions(sourceID) {
		return Boolean(getWriteBridge(sourceID)?.actions?.vote?.itemActions);
	}

	function itemActionLinksHTML(itemId, sourceID) {
		if (!sourceHasItemActions(sourceID)) {
			return "";
		}

		const id = escapeHTML(String(itemId));
		const source = escapeHTML(String(sourceID || ""));

		return `
      |
      <button class="item-action-link" type="button"
      data-item-action="flag" data-item-action-source="${source}" data-item-action-id="${id}">flag</button>
      |
      <button class="item-action-link" type="button"
      data-item-action="fave" data-item-action-source="${source}" data-item-action-id="${id}">favorite</button>`;
	}

	const ITEM_ACTION_FIELD = { fave: "favorite", flag: "flagged" };

	const ITEM_ACTION_LABEL = {
		favorite: { on: "un-favorite", off: "favorite" },
		flagged: { on: "unflag", off: "flag" },
	};

	function refreshItemActionControls(itemId) {
		const root = sidebarUI?.shadow;

		if (!root) {
			return;
		}

		const state = itemActionState(itemId) || {};
		const selector = `[data-item-action-id="${CSS.escape(String(itemId))}"]`;

		for (const button of root.querySelectorAll(selector)) {
			const field = ITEM_ACTION_FIELD[button.dataset.itemAction];
			const on = Boolean(state[field]);

			button.hidden = itemActionUnavailable(field);
			button.textContent = ITEM_ACTION_LABEL[field][on ? "on" : "off"];
			button.classList.toggle("item-action-on", on);
		}
	}

	function refreshAllItemActionControls() {
		const root = sidebarUI?.shadow;

		if (!root) {
			return;
		}

		const seen = new Set();

		for (const button of root.querySelectorAll("[data-item-action-id]")) {
			seen.add(button.dataset.itemActionId);
		}

		seen.forEach(refreshItemActionControls);
	}

	async function submitItemAction(button) {
		const itemId = button.dataset.itemActionId;
		const kind = button.dataset.itemAction;
		const field = ITEM_ACTION_FIELD[kind];

		if (!itemId || !field || button.disabled) {
			return;
		}

		const action = itemActionState(itemId)?.[field] ? "un" + kind : kind;

		button.disabled = true;

		try {
			// No URL to pass: unlike a vote there is no client-injected link to hand
			// over, so the popup finds the anchor on the page it lands on.
			await openItemActionPopup(
				button.dataset.itemActionSource,
				itemId,
				itemId,
				action,
				null,
			);
		} finally {
			button.disabled = false;
			refreshItemActionControls(itemId);
		}
	}

	function rememberVote(itemId, voteInfo) {
		const key = String(itemId);
		const state = voteInfo?.state;

		if (state === "up" || state === "down") {
			rememberedVotes[key] = {
				state,
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

	function requestWithMeta(url) {
		return new Promise((resolve) => {
			const failure = { ok: false, status: 0, json: null, rateLimit: null };

			GM.xmlHttpRequest({
				method: "GET",
				url,
				timeout: 10000,
				onload: function (response) {
					let json = null;

					try {
						json = JSON.parse(response.responseText);
					} catch {
						json = null;
					}

					resolve({
						ok:
							response.status >= 200 &&
							response.status < 300 &&
							json !== null,
						status: response.status,
						json,
						rateLimit: parseRateLimit(response.responseHeaders),
					});
				},
				onerror: () => resolve(failure),
				ontimeout: () => resolve(failure),
			});
		});
	}

	function requestText(url, headers) {
		return new Promise((resolve) => {
			GM.xmlHttpRequest({
				method: "GET",
				url,
				headers,
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
	const itemActionRequests = new Map();

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

	// #region hnewhere-test-export
	// Stories reach the sort in three shapes: Algolia hits from findHN, Firebase
	// items from loadStories, and normalized discussions from a source adapter.
	// Reading all three here keeps one ordering rule instead of three that can
	// disagree -- the normalized names are read first, since they are the shape
	// everything is heading towards.
	function discussionRank(story) {
		return {
			comments: story.commentCount ?? story.descendants ?? story.num_comments ?? 0,
			points: story.score ?? story.points ?? 0,
			time: story.createdAt ?? story.time ?? story.created_at_i ?? 0,
		};
	}

	function compareStoriesByDiscussion(a, b) {
		const left = discussionRank(a);
		const right = discussionRank(b);

		return (
			right.time - left.time ||
			right.comments - left.comments ||
			right.points - left.points
		);
	}

	function disambiguateLabels(discussions) {
		const counts = new Map();

		for (const discussion of discussions) {
			const base = discussion.baseLabel ?? discussion.label;

			counts.set(base, (counts.get(base) ?? 0) + 1);
		}

		return discussions.map((discussion) => {
			const baseLabel = discussion.baseLabel ?? discussion.label;

			if ((counts.get(baseLabel) ?? 0) < 2 || !discussion.createdAt) {
				return { ...discussion, baseLabel, label: baseLabel };
			}

			const when = new Date(discussion.createdAt * 1000);

			return {
				...discussion,
				baseLabel,
				label: `${baseLabel} · ${when.toLocaleString(undefined, {
					month: "short",
					year: "numeric",
				})}`,
			};
		});
	}

	const DISCUSSION_SHAPE = {
		source: { type: "string" },
		key: { type: "string" },
		id: { type: ["number", "string"] },
		title: { type: "string" },
		author: { type: "string" },
		score: { type: "number", nullable: true },
		commentCount: { type: "number" },
		createdAt: { type: "number" },
		permalink: { type: "string", nullable: true },
		articleURL: { type: "string" },
		label: { type: "string" },
		bodyHTML: { type: "string" },
		rootKeys: { type: "array" },
		rootTimes: { type: "array" },
		wikiPages: { type: "array", optional: true },
		annotations: { type: "array", optional: true },
		// Nobody submitted this one; it is every mention of a URL on one source,
		// gathered. Its title names the discussion rather than the page.
		collective: { type: "boolean", optional: true },
		statuses: { type: "array", optional: true },
		creatorId: { type: ["number", "string"], optional: true },
	};

	const COMMENT_SHAPE = {
		source: { type: "string" },
		key: { type: "string" },
		id: { type: ["number", "string"] },
		discussionKey: { type: "string" },
		parentKey: { type: "string", nullable: true },
		author: { type: "string" },
		bodyHTML: { type: "string" },
		score: { type: "number", nullable: true },
		createdAt: { type: "number" },
		isOP: { type: "boolean" },
		deleted: { type: "boolean" },
		replyKeys: { type: "array" },
		more: { type: "object", nullable: true, optional: true },
	};

	const STORY_SHAPE = {
		source: { type: "string" },
		key: { type: "string" },
		id: { type: ["number", "string"] },
		// The page, which is what the title links to. For an Ask HN this is the
		// discussion, because for an Ask HN those are the same thing.
		url: { type: "string" },
		title: { type: "string" },
		by: { type: "string" },
		// Nullable for the reason it is in DISCUSSION_SHAPE: a source can have no
		// number worth reporting, and a displayed 0 would claim it scored nothing.
		score: { type: "number", nullable: true },
		time: { type: "number" },
		descendants: { type: "number" },
		site: { type: "string" },
		permalink: { type: "string", nullable: true },
	};

	function shapeProblems(shape, value) {
		if (!value || typeof value !== "object") {
			return ["not an object"];
		}

		const problems = [];

		for (const [field, rule] of Object.entries(shape)) {
			if (!Object.prototype.hasOwnProperty.call(value, field)) {
				if (!rule.optional) {
					problems.push(`${field}: missing`);
				}

				continue;
			}

			const actual = value[field];

			if (actual === undefined) {
				problems.push(`${field}: undefined`);
				continue;
			}

			if (actual === null) {
				if (!rule.nullable) {
					problems.push(`${field}: null, not declared nullable`);
				}

				continue;
			}

			const allowed = [].concat(rule.type);
			const found = Array.isArray(actual) ? "array" : typeof actual;

			if (!allowed.includes(found)) {
				problems.push(`${field}: ${found}, expected ${allowed.join("|")}`);
			}
		}

		for (const field of Object.keys(value)) {
			if (!shape[field]) {
				problems.push(`${field}: not in the shape`);
			}
		}

		return problems;
	}

	function hnDiscussion(story) {
		return {
			source: "hn",
			key: sourceKey("hn", story.id),
			id: story.id,
			title: story.title || "",
			author: story.by || "",
			score: story.score ?? 0,
			commentCount: story.descendants ?? 0,
			createdAt: story.time || 0,
			permalink: "https://news.ycombinator.com/item?id=" + story.id,
			articleURL: story.url || "",
			label: "HN",
			bodyHTML: story.text || "",
			rootKeys: (story.kids || []).map((id) => sourceKey("hn", id)),
			// The item carries kids but not their times. loadThread reads those.
			rootTimes: [],
		};
	}

	function algoliaDiscussion(hit) {
		return {
			source: "hn",
			key: sourceKey("hn", hit.objectID),
			id: Number(hit.objectID),
			title: hit.title || "",
			author: hit.author || "",
			score: hit.points ?? 0,
			commentCount: hit.num_comments ?? 0,
			createdAt: hit.created_at_i ?? 0,
			permalink: "https://news.ycombinator.com/item?id=" + hit.objectID,
			articleURL: hit.url || "",
			label: "HN",
			bodyHTML: hit.story_text || "",
			// Deliberately empty. The roots live on the Firebase item, and loadThread
			// is where that is fetched -- which is the whole point of the split.
			rootKeys: [],
			rootTimes: [],
		};
	}

	function hnStory(row) {
		return {
			source: "hn",
			key: normalizeURL(row.url),
			id: row.id,
			url: row.url,
			title: row.title,
			by: row.by,
			score: row.score,
			time: row.time,
			descendants: row.descendants,
			site: row.site,
			permalink: commentURL(row.id),
		};
	}

	function lobstersStory(story) {
		return {
			source: "lobsters",
			key: normalizeURL(story.url),
			id: story.short_id,
			url: story.url,
			title: story.title || "",
			by: story.submitter_user || "",
			score: story.score ?? 0,
			time: Math.floor(new Date(story.created_at).getTime() / 1000) || 0,
			descendants: story.comment_count ?? 0,
			site: hostLabel(story.url),
			permalink: story.short_id_url || story.comments_url || "",
		};
	}

	// A Lemmy row is spread over three objects: the post carries the link, the
	// counts carry the numbers, and the creator carries the name.
	function lemmyStory(view) {
		const post = view.post || {};

		return {
			source: "lemmy",
			key: normalizeURL(post.url),
			id: post.id,
			url: post.url || "",
			title: post.name || "",
			by: view.creator?.name || "",
			score: view.counts?.score ?? 0,
			time: Math.floor(new Date(post.published).getTime() / 1000) || 0,
			descendants: view.counts?.comments ?? 0,
			site: hostLabel(post.url),
			permalink: post.ap_id || "",
		};
	}

	function redditStory(post) {
		return {
			source: "reddit",
			key: normalizeURL(post.url),
			id: post.id,
			url: post.url || "",
			title: post.title || "",
			by: post.author || "",
			score: post.score ?? 0,
			time: post.created_utc ?? 0,
			descendants: post.num_comments ?? 0,
			site: post.subreddit_name_prefixed || "r/" + (post.subreddit || ""),
			permalink: "https://www.reddit.com" + (post.permalink || ""),
		};
	}

	function hostLabel(url) {
		try {
			return new URL(url).hostname.replace(/^www\./, "");
		} catch {
			return "";
		}
	}

	function hnComment(item, discussion) {
		return {
			source: "hn",
			key: sourceKey("hn", item.id),
			id: item.id,
			discussionKey: discussion.key,
			parentKey: item.parent ? sourceKey("hn", item.parent) : null,
			author: item.by || "anonymous",
			bodyHTML: item.text || "",
			score: null,
			createdAt: item.time || 0,
			isOP: Boolean(item.by) && item.by === discussion.author,
			deleted: Boolean(item.deleted || item.dead),
			replyKeys: (item.kids || []).map((id) => sourceKey("hn", id)),
		};
	}

	// A query that answered with nothing and a query that never answered produce
	// the same empty result set. Only the first is worth remembering for an hour.
	function shouldCacheDiscovery(answered) {
		return answered.some(Boolean);
	}

	function parseRateLimit(headerText) {
		if (!headerText) {
			return null;
		}

		const remaining = /^x-ratelimit-remaining:\s*([\d.]+)/im.exec(headerText);
		const reset = /^x-ratelimit-reset:\s*([\d.]+)/im.exec(headerText);

		if (!remaining && !reset) {
			return null;
		}

		return {
			remaining: remaining ? Number(remaining[1]) : Infinity,
			resetSeconds: reset ? Number(reset[1]) : 0,
		};
	}

	const MIRROR_SUBREDDITS = new Set(["hackernews", "hypeurls"]);

	function redditHitPasses(post) {
		return (
			(post?.num_comments ?? 0) > 0 &&
			!post.removed_by_category &&
			!MIRROR_SUBREDDITS.has(String(post.subreddit || "").toLowerCase())
		);
	}

	function unescapeRedditHTML(value) {
		if (!value) {
			return "";
		}

		const holder = document.createElement("textarea");

		holder.innerHTML = value;

		return holder.value;
	}

	function redditDiscussion(post) {
		return {
			source: "reddit",
			key: sourceKey("reddit", post.id),
			id: post.id,
			title: post.title || "",
			author: post.author || "",
			score: post.score ?? 0,
			commentCount: post.num_comments ?? 0,
			createdAt: post.created_utc ?? 0,
			permalink: "https://www.reddit.com" + (post.permalink || ""),
			articleURL: post.url || "",
			// The subreddit, not "Reddit". A blended thread shows this beside a
			// comment, and r/science and r/conspiracy are not interchangeable.
			label: post.subreddit_name_prefixed || "r/" + (post.subreddit || ""),
			bodyHTML: unescapeRedditHTML(post.selftext_html),
			// The listing carries no comments at all -- loadThread fetches the tree,
			// and every root's time arrives with it.
			rootKeys: [],
			rootTimes: [],
		};
	}

	function redditComment(node, discussion) {
		const data = node.data;
		const parent = String(data.parent_id || "");

		return {
			source: "reddit",
			key: sourceKey("reddit", data.id),
			id: data.id,
			discussionKey: discussion.key,
			parentKey: parent.startsWith("t1_")
				? sourceKey("reddit", parent.slice(3))
				: null,
			author: data.author || "[deleted]",
			bodyHTML: unescapeRedditHTML(data.body_html),
			score: data.score ?? null,
			createdAt: data.created_utc ?? 0,
			isOP: Boolean(data.is_submitter),
			deleted: data.author === "[deleted]" && !data.body_html,
			replyKeys: [],
		};
	}

	function mastodonTrendStory(link) {
		const today = link?.history?.[0] || {};
		const url = link?.url || "";

		return {
			source: "mastodon",
			key: normalizeURL(url),
			// No id of its own: a trending link is a URL and a count, not a post.
			id: normalizeURL(url),
			url,
			title: link?.title || "",
			by: "",
			score: Number(today.accounts) || 0,
			time: Number(today.day) || 0,
			descendants: Number(today.uses) || 0,
			site: hostLabel(url),
			permalink: null,
		};
	}

	function mastodonStatusPasses(status, target) {
		const card = status?.card?.url;

		return Boolean(card && target && normalizeURL(card) === target);
	}

	function mastodonAuthorFromURL(url) {
		try {
			const parsed = new URL(String(url));
			const handle = parsed.pathname.split("/").filter(Boolean)[0] || "";

			return handle.startsWith("@")
				? handle.slice(1) + "@" + parsed.hostname
				: "";
		} catch {
			return "";
		}
	}

	function mastodonComment(status, discussion) {
		const url = status?.url || status?.uri || "";

		return {
			source: "mastodon",
			key: sourceKey("mastodon", url),
			id: status?.id || url,
			discussionKey: discussion?.key,
			parentKey: null,
			author: mastodonAuthorFromURL(url),
			// The status is already HTML, and goes through sanitizeHTML at render
			// like every other source's body.
			bodyHTML: status?.content || "",
			// The index reports no favourites and no boosts, so a number here would
			// be invented rather than measured.
			score: null,
			createdAt: Math.floor(Date.parse(status?.created_at || "") / 1000) || 0,
			isOP: false,
			deleted: false,
			replyKeys: [],
		};
	}

	function mastodonCollective(url, statuses) {
		if (!statuses.length) {
			return null;
		}

		const times = statuses.map(
			(status) => Math.floor(Date.parse(status?.created_at || "") / 1000) || 0,
		);

		return {
			source: "mastodon",
			key: sourceKey("mastodon", "links:" + url),
			id: "links:" + url,
			title: "Mastodon posts",
			author: "",
			score: null,
			commentCount: statuses.length,
			// The newest post, because a collective was never submitted and the only
			// honest timestamp is when it last moved.
			createdAt: Math.max(...times, 0),
			permalink: null,
			articleURL: url,
			label: "Mastodon",
			collective: true,
			bodyHTML: "",
			rootKeys: statuses.map(
				(status) => sourceKey("mastodon", status?.url || status?.uri || ""),
			),
			rootTimes: times,
			statuses,
		};
	}

	function redditThreadIndex(listing, discussion) {
		const byKey = new Map();
		const rootKeys = [];
		let hiddenCount = 0;

		let rootMore = null;

		const walk = (children, intoKeys, parent) => {
			for (const node of children || []) {
				if (node.kind === "more") {
					const ids = node.data?.children || [];
					const record = { ids, count: node.data?.count ?? ids.length };

					hiddenCount += record.count;

					if (parent) {
						parent.more = record;
					} else {
						rootMore = record;
					}

					continue;
				}

				if (node.kind !== "t1" || !node.data?.id) {
					continue;
				}

				const comment = redditComment(node, discussion);

				byKey.set(comment.key, comment);
				intoKeys.push(comment.key);

				const replies = node.data.replies;

				if (replies && replies.data) {
					walk(replies.data.children, comment.replyKeys, comment);
				}
			}
		};

		walk(listing?.[1]?.data?.children, rootKeys, null);

		return { rootKeys, byKey, hiddenCount, rootMore };
	}

	function redditThreadIndexFromFlat(rows, discussion) {
		const byKey = new Map();
		const rootKeys = [];

		for (const row of rows) {
			if (!row?.id) {
				continue;
			}

			byKey.set(
				sourceKey("reddit", row.id),
				redditComment({ kind: "t1", data: row }, discussion),
			);
		}

		for (const comment of byKey.values()) {
			const parent = comment.parentKey && byKey.get(comment.parentKey);

			if (parent) {
				parent.replyKeys.push(comment.key);
			} else {
				rootKeys.push(comment.key);
			}
		}

		return { rootKeys, byKey, hiddenCount: 0, rootMore: null };
	}

	function lobstersComment(raw, discussion) {
		return {
			source: "lobsters",
			key: sourceKey("lobsters", raw.short_id),
			id: raw.short_id,
			discussionKey: discussion.key,
			parentKey: raw.parent_comment
				? sourceKey("lobsters", raw.parent_comment)
				: null,
			author: raw.commenting_user || "",
			bodyHTML: raw.comment || "",
			score: raw.score ?? null,
			createdAt: Math.floor(Date.parse(raw.created_at) / 1000) || 0,
			isOP: (raw.commenting_user || "") === discussion.author,
			deleted: Boolean(raw.is_deleted),
			replyKeys: [],
		};
	}

	function lobstersDiscussion(story) {
		return {
			source: "lobsters",
			key: sourceKey("lobsters", story.short_id),
			id: story.short_id,
			title: story.title || "",
			author: story.submitter_user || "",
			score: story.score ?? null,
			commentCount: story.comment_count ?? 0,
			createdAt: Math.floor(Date.parse(story.created_at) / 1000) || 0,
			permalink: story.comments_url,
			articleURL: story.url || "",
			label: "Lobsters",
			bodyHTML: story.description || "",
			rootKeys: [],
			rootTimes: [],
		};
	}

	function lobstersThreadIndex(story, discussion) {
		const byKey = new Map();
		const rootKeys = [];

		for (const raw of story.comments || []) {
			if (!raw?.short_id) {
				continue;
			}

			byKey.set(
				sourceKey("lobsters", raw.short_id),
				lobstersComment(raw, discussion),
			);
		}

		for (const comment of byKey.values()) {
			const parent = comment.parentKey && byKey.get(comment.parentKey);

			if (parent) {
				parent.replyKeys.push(comment.key);
			} else {
				rootKeys.push(comment.key);
			}
		}

		return { rootKeys, byKey, hiddenCount: 0, rootMore: null };
	}

	function wikipediaCitingComments(items, targetURL) {
		const target = normalizeURL(targetURL);

		if (!target) {
			return [];
		}

		const found = [];

		const cites = (html) => {
			for (const match of String(html || "").matchAll(/href="([^"]*)"/g)) {
				// The href arrives HTML-escaped inside a JSON string, so a query with
				// more than one parameter reads as &amp; and parses as a different URL.
				if (normalizeURL(match[1].replace(/&amp;/g, "&")) === target) {
					return true;
				}
			}

			return false;
		};

		const walk = (list) => {
			for (const item of list || []) {
				if (item?.type === "comment" && cites(item.html)) {
					found.push(item);
				}

				walk(item?.replies);
			}
		};

		walk(items);

		return found;
	}

	const WIKIPEDIA_SIGNATURE_TIME = /\d{1,2}:\d{2},\s+\d{1,2}\s+\w+\s+\d{4}\s+\(UTC[^)]*\)\s*$/;
	const WIKIPEDIA_SIGNATURE_LINK =
		/^(?:\.\/|https:\/\/en\.wikipedia\.org\/wiki\/)(?:User:|User_talk:|Special:Contributions\/)/;
	// The punctuation a signature is assembled from -- "(talk | contribs)" and the
	// dash some editors put in front of their name. Letters and digits are prose.
	const WIKIPEDIA_SIGNATURE_PUNCTUATION = /[^\s(),|·—–\- ]/;

	function isWikipediaSignaturePart(node) {
		if (node.nodeType === Node.TEXT_NODE) {
			return !WIKIPEDIA_SIGNATURE_PUNCTUATION.test(node.textContent);
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return true;
		}

		if (node.tagName === "A") {
			return WIKIPEDIA_SIGNATURE_LINK.test(node.getAttribute("href") || "");
		}

		// The wrappers editors decorate a signature with. Only when everything
		// inside is itself signature, so a <small> holding a real aside stays.
		if (["SMALL", "SPAN", "B", "I", "SUB", "SUP", "BDI"].includes(node.tagName)) {
			return [...node.childNodes].every(isWikipediaSignaturePart);
		}

		return false;
	}

	function wikipediaStripSignature(html) {
		const template = document.createElement("template");

		template.innerHTML = String(html || "");

		const walker = document.createTreeWalker(
			template.content,
			NodeFilter.SHOW_TEXT,
		);

		let last = null;

		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node.textContent.trim()) {
				last = node;
			}
		}

		const match = last && WIKIPEDIA_SIGNATURE_TIME.exec(last.textContent);

		// No timestamp at the end is no signature, and the comment is returned
		// exactly as it arrived rather than trimmed on a guess.
		if (!match) {
			return String(html || "");
		}

		last.textContent = last.textContent.slice(0, match.index);

		let cursor = last.previousSibling;

		// "(talk) 15:29, …" leaves ") " behind once the time is gone.
		if (!WIKIPEDIA_SIGNATURE_PUNCTUATION.test(last.textContent)) {
			last.remove();
		}

		while (cursor && isWikipediaSignaturePart(cursor)) {
			const previous = cursor.previousSibling;

			cursor.remove();
			cursor = previous;
		}

		if (cursor?.nodeType === Node.TEXT_NODE) {
			cursor.textContent = cursor.textContent.replace(/[\s—–\-|·]+$/, "");
		}

		return template.innerHTML;
	}

	function wikipediaAbsoluteLinks(html) {
		return String(html || "").replace(
			/href="\.\/([^"]*)"/g,
			(_, path) => `href="https://en.wikipedia.org/wiki/${path}"`,
		);
	}

	function wikipediaComment(item, discussion, parentKey) {
		return {
			source: "wikipedia",
			key: sourceKey("wikipedia", item?.id || ""),
			id: item?.id || "",
			discussionKey: discussion?.key,
			parentKey: parentKey || null,
			author: item?.author || "",
			bodyHTML: wikipediaAbsoluteLinks(wikipediaStripSignature(item?.html)),
			score: null,
			createdAt: Math.floor(Date.parse(item?.timestamp || "") / 1000) || 0,
			// The article's editors are not an OP; a Talk page was not submitted by
			// anybody, the same reason the Bluesky collective marks none.
			isOP: false,
			deleted: false,
			replyKeys: [],
		};
	}

	function indexWikipediaPage(items, discussion, targetURL, seen = new Set()) {
		const byKey = new Map();
		const rootKeys = [];

		const absorb = (item, parentKey) => {
			const comment = wikipediaComment(item, discussion, parentKey);

			if (seen.has(comment.key)) {
				return null;
			}

			seen.add(comment.key);
			byKey.set(comment.key, comment);

			for (const reply of item?.replies || []) {
				const children =
					reply?.type === "comment" ? [reply] : reply?.replies || [];

				for (const child of children) {
					if (child?.type !== "comment") {
						continue;
					}

					const absorbed = absorb(child, comment.key);

					if (absorbed) {
						comment.replyKeys.push(absorbed.key);
					}
				}
			}

			return comment;
		};

		const citing = wikipediaCitingComments(items, targetURL);

		for (const item of citing) {
			const root = absorb(item, null);

			if (root) {
				rootKeys.push(root.key);
			}
		}

		return { rootKeys, byKey, cited: citing.length };
	}

	function wikipediaCollective(pageURL, pages, timeByTitle) {
		if (!pages.length) {
			return null;
		}

		const rootKeys = [];
		const rootTimes = [];
		const wikiPages = [];
		let newest = 0;

		for (const page of pages) {
			const time = timeByTitle.get(page.title) || 0;

			rootKeys.push(sourceKey("wikipedia", String(page.pageid)));
			rootTimes.push(time);
			wikiPages.push({ pageid: page.pageid, title: page.title, time });

			if (time > newest) {
				newest = time;
			}
		}

		return {
			source: "wikipedia",
			key: sourceKey("wikipedia", "linksearch:" + pageURL),
			id: "linksearch:" + pageURL,
			// Every collective names itself, so a reader with several on screen can
			// tell which one they are looking at. Empty fell back to the page title,
			// which is the same for all of them.
			title: "Wikipedia talk pages",
			author: "",
			score: null,
			commentCount: pages.length,
			createdAt: newest,
			permalink: "https://en.wikipedia.org/wiki/Special:LinkSearch/" + pageURL,
			articleURL: pageURL,
			label: "Wikipedia",
			collective: true,
			bodyHTML: "",
			rootKeys,
			rootTimes,
			wikiPages,
		};
	}

	function hypothesisTime(stamp) {
		const parsed = Date.parse(stamp || "");

		return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
	}

	function hypothesisAuthor(row) {
		const display = String(row?.user_info?.display_name || "").trim();

		if (display) {
			return display;
		}

		const account = String(row?.user || "");

		return account.match(/^acct:([^@]+)@/)?.[1] || account;
	}

	// A TextQuoteSelector carries prefix and suffix beside the exact text, and they
	// exist to tell repeats apart. Kept whole here; findBestQuoteMatch decides what
	// to do with them.
	function hypothesisSelector(row) {
		for (const target of row?.target || []) {
			for (const selector of target?.selector || []) {
				if (
					selector?.type === "TextQuoteSelector" &&
					String(selector.exact || "").trim()
				) {
					return {
						exact: String(selector.exact),
						prefix: String(selector.prefix || ""),
						suffix: String(selector.suffix || ""),
					};
				}
			}
		}

		return null;
	}

	function hypothesisQuote(row) {
		return hypothesisSelector(row)?.exact || "";
	}

	// A note is user-authored, and 70% of the ones the API returns already carry
	// markup -- curation accounts post HTML. Those go through as HTML the way a
	// Mastodon status does, and sanitizeHTML cleans them at render. A note that is
	// plain text is escaped here, so a stray angle bracket in prose survives.
	function hypothesisNoteHTML(note) {
		if (/<[a-z][^>]*>/i.test(note)) {
			return note;
		}

		return note
			.split(/\n{2,}/)
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => `<p>${escapeHTML(part).replace(/\n/g, "<br>")}</p>`)
			.join("");
	}

	// data-hnewhere-exact marks a quote that came out of a TextQuoteSelector, which
	// is verbatim page text. findBestQuoteMatch reads it and skips variant search.
	function hypothesisBodyHTML(row) {
		const selector = hypothesisSelector(row);
		const context = selector
			? (selector.prefix
					? ` data-hnewhere-prefix="${escapeHTML(selector.prefix)}"`
					: "") +
				(selector.suffix
					? ` data-hnewhere-suffix="${escapeHTML(selector.suffix)}"`
					: "")
			: "";

		return (
			(selector
				? `<blockquote data-hnewhere-exact="1"${context}>${escapeHTML(selector.exact)}</blockquote>`
				: "") + hypothesisNoteHTML(String(row?.text || "").trim())
		);
	}

	// The API answers `url=` with document equivalents rather than with the URL that
	// was asked, so an arxiv.org/abs query returns annotations made on the PDF and on
	// copies of it hosted elsewhere. Those quote a document the reader does not have
	// open, and this is the same check every other source applies to its own results.
	function hypothesisKeptRows(rows, target) {
		return (rows || []).filter(
			(row) =>
				row?.id &&
				row.hidden !== true &&
				String(row.text || "").trim() &&
				normalizeURL(row.uri) === target &&
				Number.isFinite(hypothesisTime(row.created)),
		);
	}

	function hypothesisComment(row, discussion, keptIds) {
		const references = row?.references || [];
		const parentId = references.length ? references[references.length - 1] : null;

		return {
			source: "hypothesis",
			key: sourceKey("hypothesis", row.id),
			id: row.id,
			discussionKey: discussion?.key,
			// A reply whose parent was filtered out is a root, not an orphan pointing
			// at a key the index will never hold.
			parentKey:
				parentId && keptIds.has(parentId)
					? sourceKey("hypothesis", parentId)
					: null,
			author: hypothesisAuthor(row),
			bodyHTML: hypothesisBodyHTML(row),
			// Hypothes.is has no votes, and a displayed 0 would claim it scored nothing.
			score: null,
			createdAt: hypothesisTime(row.created),
			isOP: false,
			deleted: false,
			replyKeys: [],
		};
	}

	// articleURL is the address the reader is at, not the normalised key. The key
	// carries no scheme, and everything that compares an articleURL to the address
	// bar -- the page title among them -- reads a schemeless one as a different page.
	function hypothesisCollective(target, rows, articleURL = target) {
		const kept = hypothesisKeptRows(rows, target);

		if (!kept.length) {
			return null;
		}

		const keptIds = new Set(kept.map((row) => row.id));
		const rootKeys = [];
		const rootTimes = [];
		let newest = 0;

		for (const row of kept) {
			const references = row.references || [];
			const parentId = references.length ? references[references.length - 1] : null;
			const time = hypothesisTime(row.updated) || hypothesisTime(row.created);

			if (!parentId || !keptIds.has(parentId)) {
				rootKeys.push(sourceKey("hypothesis", row.id));
				rootTimes.push(hypothesisTime(row.created));
			}

			if (time > newest) {
				newest = time;
			}
		}

		return {
			source: "hypothesis",
			key: sourceKey("hypothesis", "annotations:" + target),
			id: "annotations:" + target,
			// Names itself the way the Bluesky collective does, and in its own words:
			// these are annotations, not comments. Left empty it fell back to the page
			// title, which says nothing about which discussion is on screen.
			title: "Hypothes.is annotations",
			author: "",
			score: null,
			commentCount: kept.length,
			createdAt: newest,
			permalink:
				"https://hypothes.is/search?q=" + encodeURIComponent("url:" + target),
			articleURL,
			label: "Hypothes.is",
			collective: true,
			bodyHTML: "",
			rootKeys,
			rootTimes,
			annotations: kept,
		};
	}

	function hypothesisThreadIndex(rows, discussion) {
		const keptIds = new Set((rows || []).map((row) => row.id));
		const byKey = new Map();
		const rootKeys = [];

		for (const row of rows || []) {
			const comment = hypothesisComment(row, discussion, keptIds);

			byKey.set(comment.key, comment);
		}

		for (const comment of byKey.values()) {
			const parent = comment.parentKey ? byKey.get(comment.parentKey) : null;

			if (parent) {
				parent.replyKeys.push(comment.key);
			} else {
				rootKeys.push(comment.key);
			}
		}

		return { byKey, rootKeys };
	}

	function lemmyHost(actorId) {
		try {
			return new URL(actorId).hostname;
		} catch {
			return "";
		}
	}

	// name for a local user, name@instance for a federated one -- the way Lemmy
	// prints a handle, and what a profile link needs to resolve.
	function lemmyHandle(creator) {
		const name = creator?.name || "";
		const host = lemmyHost(creator?.actor_id);

		return host && host !== "lemmy.world" ? name + "@" + host : name;
	}

	function lemmyDiscussion(postView) {
		const post = postView.post || {};
		const community = postView.community || {};
		const host = lemmyHost(community.actor_id);

		return {
			source: "lemmy",
			key: sourceKey("lemmy", post.id),
			id: post.id,
			title: post.name || "",
			author: lemmyHandle(postView.creator),
			score: postView.counts?.score ?? null,
			commentCount: postView.counts?.comments ?? 0,
			createdAt: Math.floor(Date.parse(post.published) / 1000) || 0,
			// The instance's own view resolves even when the post originated on a
			// smaller server the reader has never heard of.
			permalink: "https://lemmy.world/post/" + post.id,
			articleURL: post.url || "",
			// !community@instance -- how Lemmy names one, and what tells apart the
			// several communities a link gets cross-posted to.
			label: "!" + (community.name || "") + (host ? "@" + host : ""),
			bodyHTML: escapeHTML(post.body || ""),
			rootKeys: [],
			rootTimes: [],
			creatorId: post.creator_id,
		};
	}

	// Lemmy threads via a materialized path: "0.<id>" is a root, "0.<parent>.<id>"
	// a reply. The immediate parent is the id before this one in the path.
	function lemmyComment(commentView, discussion) {
		const comment = commentView.comment || {};
		const parts = String(comment.path || "0").split(".");
		const parentId = parts.length > 2 ? parts[parts.length - 2] : null;
		const removed = Boolean(comment.deleted || comment.removed);

		return {
			source: "lemmy",
			key: sourceKey("lemmy", comment.id),
			id: comment.id,
			discussionKey: discussion.key,
			parentKey: parentId ? sourceKey("lemmy", parentId) : null,
			author: lemmyHandle(commentView.creator),
			bodyHTML: removed ? "" : escapeHTML(comment.content || ""),
			score: commentView.counts?.score ?? null,
			createdAt: Math.floor(Date.parse(comment.published) / 1000) || 0,
			isOP:
				Boolean(commentView.creator?.id) &&
				commentView.creator.id === discussion.creatorId,
			deleted: removed,
			replyKeys: [],
		};
	}

	function lemmyThreadIndex(comments, discussion) {
		const byKey = new Map();
		const rootKeys = [];

		for (const commentView of comments || []) {
			if (!commentView?.comment?.id) {
				continue;
			}

			const comment = lemmyComment(commentView, discussion);
			byKey.set(comment.key, comment);
		}

		for (const comment of byKey.values()) {
			const parent = comment.parentKey && byKey.get(comment.parentKey);

			if (parent) {
				parent.replyKeys.push(comment.key);
			} else {
				rootKeys.push(comment.key);
			}
		}

		return { rootKeys, byKey, hiddenCount: 0, rootMore: null };
	}

	function blendPosition(index, total) {
		return (index + 1) / (total + 1);
	}

	const SORT_MODES = [
		{ id: "best", label: "Best" },
		{ id: "newest", label: "Newest" },
		{ id: "oldest", label: "Oldest" },
	];

	const STANDING_GRAVITY = 1;
	const STANDING_ARRIVAL_BOOST = 1.5;
	// A day. Long enough that a thread posted last night is still live when the
	// reader wakes up, short enough that "live" means what it says.
	const STANDING_LIVE_WINDOW = 86400;
	const SECONDS_PER_YEAR = 31557600;

	function standing(discussion, newestCommentAt, options = {}) {
		if (!discussion) {
			return 1;
		}

		const now = options.now ?? Math.floor(Date.now() / 1000);
		const ageYears =
			Math.max(now - (discussion.createdAt || now), 0) / SECONDS_PER_YEAR;

		const votes =
			discussion.score == null
				? 0
				: Math.log10(1 + Math.max(discussion.score, 0));
		const comments = Math.log10(1 + Math.max(discussion.commentCount || 0, 0));

		let value = (1 + votes + comments) / (1 + ageYears) ** STANDING_GRAVITY;

		if (options.arrivedFrom && discussion.source === options.arrivedFrom) {
			value *= STANDING_ARRIVAL_BOOST;
		}

		return value;
	}

	function newestThreadComment(thread) {
		let newest = 0;

		for (const time of thread?.rootTimes?.values() || []) {
			if (time > newest) {
				newest = time;
			}
		}

		return newest;
	}

	function isDiscussionLive(thread, now) {
		const newest = newestThreadComment(thread);

		return Boolean(newest) && now - newest <= STANDING_LIVE_WINDOW;
	}

	function blendRoots(groups, options = {}) {
		const entries = [];
		const now = options.now ?? Math.floor(Date.now() / 1000);

		for (const group of groups) {
			const total = group.rootKeys.length;
			const weight = group.story
				? standing(group.story, newestThreadComment(group.thread), options)
				: 1;
			const live = Boolean(group.story) && isDiscussionLive(group.thread, now);

			group.rootKeys.forEach((key, index) => {
				entries.push({
					key,
					discussionKey: group.discussionKey,
					position: blendPosition(index, total) / weight,
					createdAt: group.thread?.rootTimes?.get(key) || 0,
					live,
					size: total,
				});
			});
		}

		if (options.sort === "newest") {
			return entries.sort((a, b) => b.createdAt - a.createdAt || b.size - a.size);
		}

		if (options.sort === "oldest") {
			return entries.sort((a, b) => a.createdAt - b.createdAt || b.size - a.size);
		}

		return entries.sort(
			(a, b) =>
				Number(b.live) - Number(a.live) ||
				a.position - b.position ||
				b.size - a.size,
		);
	}

	function blendStories(lists, options = {}) {
		const entries = [];

		for (const stories of lists) {
			const total = stories.length;

			stories.forEach((story, index) => {
				entries.push({
					story,
					also: [],
					position:
						blendPosition(index, total) /
						standing(
							{
								source: story.source,
								score: story.score,
								commentCount: story.descendants,
								createdAt: story.time,
							},
							0,
							{ now: options.now },
						),
				});
			});
		}

		return entries.sort(
			(a, b) => a.position - b.position || b.story.descendants - a.story.descendants,
		);
	}

	function mergeStoriesByURL(entries) {
		const byURL = new Map();
		const merged = [];

		for (const entry of entries) {
			const key = normalizeURL(entry.story.url);
			const existing = key ? byURL.get(key) : null;

			if (existing) {
				existing.also.push(entry.story);
				continue;
			}

			const row = { ...entry, also: [...entry.also] };

			if (key) {
				byURL.set(key, row);
			}

			merged.push(row);
		}

		return merged;
	}

	function isOffSiteLink(url, selfHosts = [], selfPaths = []) {
		let parsed;

		try {
			parsed = new URL(url);
		} catch {
			// Includes the empty string, which is how Lobsters and Lemmy both write
			// "this submission is its own text". Nothing to open, so not a row.
			return false;
		}

		if (!/^https?:$/.test(parsed.protocol)) {
			return false;
		}

		const host = parsed.hostname.toLowerCase();

		if (
			selfHosts.some(
				(self) => host === self || host.endsWith("." + self),
			)
		) {
			return false;
		}

		return !selfPaths.some((path) => parsed.pathname.startsWith(path));
	}

	function redditTierForStatus(status, current) {
		if (status !== 403) {
			return current;
		}

		return current === "loid" ? "archive" : "off";
	}

	function bskyTarget(url) {
		try {
			const parsed = new URL(url);

			for (const key of [...parsed.searchParams.keys()]) {
				if (isTrackingParam(key)) {
					parsed.searchParams.delete(key);
				}
			}

			parsed.hash = "";

			return parsed.href;
		} catch {
			return "";
		}
	}

	function bskyKeyFromRecord(record) {
		return sourceKey("bsky", `${record?.did || ""}/${record?.rkey || ""}`);
	}

	// at://did/app.bsky.feed.post/rkey -> the key form. The inverse of
	// bskyURIFromKey, for the path where a post arrives already hydrated.
	function bskyKeyFromURI(uri) {
		const match = /^at:\/\/([^/]+)\/[^/]+\/(.+)$/.exec(String(uri || ""));

		return match ? sourceKey("bsky", `${match[1]}/${match[2]}`) : sourceKey("bsky", "");
	}

	function bskyURIFromKey(key) {
		const parsed = parseSourceKey(key);

		if (parsed?.source !== "bsky") {
			return null;
		}

		const cut = parsed.id.lastIndexOf("/");

		if (cut < 1 || cut === parsed.id.length - 1) {
			return null;
		}

		return `at://${parsed.id.slice(0, cut)}/app.bsky.feed.post/${parsed.id.slice(cut + 1)}`;
	}

	function bskyPostPasses(post) {
		return (post?.replyCount ?? 0) > 0;
	}

	function bskyTime(post) {
		const parsed = Date.parse(post?.record?.createdAt || "");

		return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
	}

	function bskyCollective(url, posts) {
		const admitted = (posts || []).filter(bskyPostPasses);

		if (!admitted.length) {
			return null;
		}

		const replies = admitted.reduce((total, post) => total + (post.replyCount ?? 0), 0);

		return {
			source: "bsky",
			key: sourceKey("bsky", normalizeURL(url)),
			id: normalizeURL(url),
			title: "Bluesky comments",
			// Nobody authored a collective. NON_AUTHORS already contains "", so
			// nothing tries to link it to a profile.
			author: "",
			score: null,
			commentCount: admitted.length + replies,
			createdAt: Math.max(...admitted.map((post) => bskyTime(post))),
			// Bluesky has no page showing everything that linked a URL. Rather than
			// invent one, this says so and renderStory prints an unlinked title.
			permalink: null,
			articleURL: url,
			label: "Bluesky",
			collective: true,
			bodyHTML: "",
			rootKeys: admitted.map((post) => bskyKeyFromURI(post.uri)),
			rootTimes: admitted.map((post) => bskyTime(post)),
		};
	}

	function bskyLinkURI(uri) {
		try {
			const protocol = new URL(String(uri)).protocol;

			return protocol === "http:" || protocol === "https:" ? String(uri) : null;
		} catch {
			return null;
		}
	}

	function bskyFacetHref(feature) {
		switch (feature?.$type) {
			case "app.bsky.richtext.facet#link":
				return bskyLinkURI(feature.uri);
			case "app.bsky.richtext.facet#mention":
				return feature.did ? "https://bsky.app/profile/" + feature.did : null;
			case "app.bsky.richtext.facet#tag":
				return feature.tag
					? "https://bsky.app/hashtag/" + encodeURIComponent(feature.tag)
					: null;
			default:
				return null;
		}
	}

	function bskyRichText(text, facets) {
		const source = String(text || "");
		const ranges = (facets || [])
			.map((facet) => ({
				start: facet?.index?.byteStart,
				end: facet?.index?.byteEnd,
				// First recognised feature wins. A facet may carry several, and the
				// range is one stretch of text that can only be one link.
				uri: (facet?.features || []).map(bskyFacetHref).find(Boolean) || null,
			}))
			.filter(
				(range) =>
					range.uri &&
					Number.isInteger(range.start) &&
					Number.isInteger(range.end) &&
					range.start < range.end,
			)
			.sort((left, right) => left.start - right.start);

		if (!ranges.length) {
			return escapeHTML(source);
		}

		const bytes = new TextEncoder().encode(source);
		const decoder = new TextDecoder();
		const cut = (start, end) =>
			decoder.decode(bytes.subarray(start, Math.min(end, bytes.length)));

		let html = "";
		let cursor = 0;

		for (const range of ranges) {
			if (range.start < cursor || range.start >= bytes.length) {
				continue;
			}

			html += escapeHTML(cut(cursor, range.start));
			html += `<a target="_blank" rel="noopener noreferrer" href="${escapeHTML(
				range.uri,
			)}">${escapeHTML(cut(range.start, range.end))}</a>`;
			cursor = Math.min(range.end, bytes.length);
		}

		return html + escapeHTML(cut(cursor, bytes.length));
	}

	function bskyComment(post, discussion, parentKey) {
		const key = bskyKeyFromURI(post?.uri);

		return {
			source: "bsky",
			key,
			// Through parseSourceKey rather than slicing a literal prefix off: the
			// separator is declared in one place and this is what reads it back.
			id: parseSourceKey(key)?.id ?? "",
			discussionKey: discussion?.key,
			parentKey: parentKey || null,
			author: post?.author?.handle || "",
			bodyHTML: bskyRichText(post?.record?.text, post?.record?.facets),
			score: post?.likeCount ?? 0,
			createdAt: bskyTime(post),
			isOP: false,
			deleted: false,
			replyKeys: [],
		};
	}

	const BSKY_THREAD_DEPTH = 10;

	function indexBskyThread(node, discussion, byKey, parentKey, depth = 0) {
		const post = node?.post;

		if (!post?.uri) {
			return;
		}

		const key = bskyKeyFromURI(post.uri);
		const comment = bskyComment(post, discussion, parentKey);

		byKey.set(key, comment);

		if (depth >= BSKY_THREAD_DEPTH && (post.replyCount || 0) > 0) {
			comment.more = { ids: [post.uri], count: post.replyCount };
		}

		for (const reply of node.replies || []) {
			if (!reply?.post?.uri) {
				continue;
			}

			comment.replyKeys.push(bskyKeyFromURI(reply.post.uri));
			indexBskyThread(reply, discussion, byKey, key, depth + 1);
		}
	}

	const SOURCES = new Map();

	function registerSource(source) {
		SOURCES.set(source.id, source);
		return source;
	}

	function getSource(id) {
		return SOURCES.get(id) || null;
	}

	function arrivalSource(referrer = document.referrer) {
		let host;

		try {
			host = new URL(referrer).hostname.toLowerCase();
		} catch {
			return null;
		}

		for (const source of SOURCES.values()) {
			if ((source.origins || []).some((origin) => origin.toLowerCase() === host)) {
				return source.id;
			}
		}

		return null;
	}

	function sourceShortLabel(story) {
		return getSource(story?.source)?.shortLabel || story?.label || "the site";
	}

	function discussionURL(story) {
		if (story?.permalink) {
			return story.permalink;
		}

		return story?.source ? null : commentURL(story?.id);
	}

	function storyTitle(story, page, disambiguating) {
		return (disambiguating && story?.title) || page;
	}

	function stripCloseClearsFilter(opening, filter) {
		return !opening && filter?.type === "discussion";
	}

	function newestCommentTime(comments, discussionKey) {
		let newest = 0;

		for (const comment of comments || []) {
			if (comment.discussionKey === discussionKey && comment.time > newest) {
				newest = comment.time;
			}
		}

		return newest;
	}

	function renderedCommentCount(comments, discussionKey) {
		let count = 0;

		for (const comment of comments || []) {
			if (comment.discussionKey === discussionKey) {
				count += 1;
			}
		}

		return count;
	}
	// #endregion hnewhere-test-export

	const NON_AUTHORS = new Set(["[deleted]", "[removed]", "anonymous", ""]);

	function authorProfileURL(sourceId, author) {
		if (NON_AUTHORS.has(String(author || "").trim())) {
			return null;
		}

		return getSource(sourceId)?.profileURL?.(author) || null;
	}

	function authorLinkHTML(sourceId, author) {
		const href = authorProfileURL(sourceId, author);

		return href
			? `<a target="_blank" rel="noopener noreferrer" href="${escapeHTML(href)}">${escapeHTML(author)}</a>`
			: escapeHTML(author);
	}

	function registeredSourceIds() {
		return [...SOURCES.keys()];
	}

	function sourceListHTML({ idPrefix = "" } = {}) {
		return [...SOURCES.values()]
			.map(
				(source) => `
<label class="settings-option">
<input${idPrefix ? ` id="${escapeHTML(idPrefix + source.id)}"` : ""} data-source="${escapeHTML(source.id)}" type="checkbox">
<span>${escapeHTML(source.label)}${source.beta ? ` <span class="op-pill">BETA</span>` : ""}${source.slow ? ` <span class="op-pill op-pill-slow" tabindex="0" role="note" aria-label="Slower comment fetch source">⧗<span class="op-pill-tip" aria-hidden="true">Slower comment fetch source</span></span>` : ""}</span>
</label>
${
	source.caveat
		? `<div class="settings-option-hint">${escapeHTML(source.caveat)}${source.slow ? `<p class="settings-option-hint-slow">This source takes longer to fetch comments, so they may take a moment to appear.</p>` : ""}</div>`
		: ""
}`,
			)
			.join("");
	}

	function syncSourceHint(input) {
		const option = input?.closest(".settings-option");
		const hint = option?.nextElementSibling;

		if (hint && hint.classList.contains("settings-option-hint")) {
			hint.classList.toggle("is-acknowledged", input.checked);
		}

		option?.classList.toggle("settings-option-on", Boolean(input?.checked));
	}

	function enabledSources(settings) {
		return enabledSourceIds(settings, registeredSourceIds()).map((id) =>
			SOURCES.get(id),
		);
	}

	function isSlowSource(id) {
		return Boolean(getSource(id)?.slow);
	}

	function hasFrontPage(source) {
		return typeof source?.frontPage === "function";
	}

	registerSource({
		id: "hn",
		// What a referrer has to match for arrivalSource to call this the source
		// the reader came from. Bare hostnames, compared for equality.
		origins: ["news.ycombinator.com"],
		label: "Hacker News",
		shortLabel: "HN",
		caveat:
			"Will send each page you visit to Algolia's Hacker News search, with no identifier attached. Vote, reply and submit through your existing HN session.",
		capabilities: { vote: true, reply: true, submit: true },

		profileURL: (author) =>
			"https://news.ycombinator.com/user?id=" + encodeURIComponent(author),

		async discover(url) {
			return (await findHN(url)).map(algoliaDiscussion);
		},

		async frontPage() {
			const html = await requestText(HN_ORIGIN + "/news");

			if (!html) {
				return [];
			}

			return parseFrontPage(
				new DOMParser().parseFromString(html, "text/html"),
			).map(hnStory);
		},

		async loadThread(discussion) {
			const roots = discussion.rootKeys.length
				? discussion.rootKeys
				: ((await getItem(discussion.id))?.kids || []).map((id) =>
						sourceKey("hn", id),
					);

			const rootItems = await Promise.all(
				roots.map((key) => {
					const parsed = parseSourceKey(key);

					return parsed ? getItem(Number(parsed.id)) : null;
				}),
			);

			const rootTimes = new Map(
				roots.map((key, index) => [key, rootItems[index]?.time || 0]),
			);

			return {
				rootKeys: roots,
				rootTimes,
				async getComment(key) {
					const parsed = parseSourceKey(key);

					if (!parsed) {
						return null;
					}

					const item = await getItem(Number(parsed.id));

					return item ? hnComment(item, discussion) : null;
				},
			};
		},
	});

	const REDDIT_TIER_KEY = "HNewhere:reddit_tier";
	const REDDIT_TIER_TTL = 10 * 60 * 1000;
	// Below this the budget is left alone. Most pages have no Reddit thread, and
	// spending the last of it on them would leave none for the one that does.
	const REDDIT_RATE_FLOOR = 10;

	let redditRateRemaining = Infinity;

	async function redditTier() {
		const stored = await load(REDDIT_TIER_KEY, null);

		if (stored && Date.now() - stored.timestamp < REDDIT_TIER_TTL) {
			return stored.tier;
		}

		return "loid";
	}

	// One request, through whichever tier is current, falling to the next on the
	// one status that means "your cookie is not good here".
	async function redditFetch(path, archivePath) {
		let tier = await redditTier();

		if (tier === "off") {
			return null;
		}

		if (tier === "loid") {
			if (redditRateRemaining < REDDIT_RATE_FLOOR) {
				return null;
			}

			const result = await requestWithMeta("https://www.reddit.com" + path);

			if (result.rateLimit) {
				redditRateRemaining = result.rateLimit.remaining;
			}

			if (result.ok) {
				return { json: result.json, tier };
			}

			const next = redditTierForStatus(result.status, tier);

			if (next === tier) {
				return null;
			}

			await save(REDDIT_TIER_KEY, { tier: next, timestamp: Date.now() });
			tier = next;
		}

		if (tier !== "archive" || !archivePath) {
			return null;
		}

		const archive = await requestWithMeta(
			"https://arctic-shift.photon-reddit.com" + archivePath,
		);

		if (!archive.ok) {
			const next = redditTierForStatus(archive.status, "archive");

			if (next !== "archive") {
				await save(REDDIT_TIER_KEY, { tier: next, timestamp: Date.now() });
			}

			return null;
		}

		return { json: archive.json, tier: "archive" };
	}

	const REDDIT_SELF_HOSTS = ["reddit.com", "redd.it"];

	registerSource({
		id: "reddit",
		// All four are real places a reader clicks a link from, and Reddit does not
		// redirect between them before the referrer is written.
		origins: ["reddit.com", "www.reddit.com", "old.reddit.com", "new.reddit.com"],
		label: "Reddit",
		shortLabel: "Reddit",
		beta: true,
		caveat:
			"Will send each page you visit to reddit.com. Signed in to Reddit, those requests arrive as your account. Signed out, they carry only the long-lived device id your browser already holds. Vote and reply through your existing Reddit session.",
		capabilities: { vote: true, reply: true, submit: false },

		profileURL: (author) =>
			"https://www.reddit.com/user/" + encodeURIComponent(author) + "/",

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			const scheme = url.startsWith("http://") ? "http://" : "https://";
			const bare = scheme + target;
			const queries = [bare, bare + "/"];

			const matches = new Map();

			for (const query of queries) {
				const encoded = encodeURIComponent(query);
				const result = await redditFetch(
					"/api/info.json?url=" + encoded,
					"/api/posts/search?limit=25&url=" + encoded,
				);

				if (!result) {
					continue;
				}

				const posts =
					result.tier === "archive"
						? result.json?.data || []
						: (result.json?.data?.children || []).map((child) => child.data);

				for (const post of posts) {
					if (post?.id) {
						matches.set(post.id, post);
					}
				}
			}

			return [...matches.values()]
				.filter(redditHitPasses)
				// The same correctness check findHN applies to Algolia: the query is a
				// hint, and this comparison is the answer.
				.filter((post) => normalizeURL(post.url) === target)
				.map(redditDiscussion);
		},

		async frontPage() {
			const result = await redditFetch("/r/popular.json?limit=100");
			const posts = (result?.json?.data?.children || []).map(
				(child) => child.data,
			);

			return posts
				.filter((post) => post?.id && isOffSiteLink(post.url, REDDIT_SELF_HOSTS))
				.map(redditStory);
		},

		async loadThread(discussion) {
			const result = await redditFetch(
				discussion.permalink.replace("https://www.reddit.com", "") +
					".json?limit=500&sort=top",
				"/api/comments/search?limit=100&link_id=" +
					encodeURIComponent(discussion.id),
			);

			if (!result) {
				return emptyThreadReader();
			}

			const index =
				result.tier === "archive"
					? redditThreadIndexFromFlat(result.json?.data || [], discussion)
					: redditThreadIndex(result.json, discussion);

			return {
				rootKeys: index.rootKeys,
				// Free here: the whole tree arrived in one response, so every root's
				// time is already in the map getComment reads.
				rootTimes: new Map(
					index.rootKeys.map((key) => [key, index.byKey.get(key)?.createdAt || 0]),
				),
				rootMore: index.rootMore,
				async getComment(key) {
					return index.byKey.get(key) || null;
				},

				async expandMore(ids) {
					const batch = ids.slice(0, 100);

					if (!batch.length) {
						return { ok: true, added: [], remaining: [] };
					}

					const result = await redditFetch(
						"/api/morechildren.json?api_type=json&link_id=t3_" +
							encodeURIComponent(discussion.id) +
							"&sort=top&children=" +
							encodeURIComponent(batch.join(",")),
						null,
					);

					if (!result) {
						return { ok: false, added: [], remaining: ids };
					}

					const things = result?.json?.json?.data?.things || [];
					const added = [];

					for (const node of things) {
						if (node.kind !== "t1" || !node.data?.id) {
							continue;
						}

						const comment = redditComment(node, discussion);

						index.byKey.set(comment.key, comment);
						added.push(comment);
					}

					// Linked into the tree first, so a reply whose parent came down in
					// this same batch is reachable from it.
					for (const comment of added) {
						const parent =
							comment.parentKey && index.byKey.get(comment.parentKey);

						if (parent && parent !== comment && !parent.replyKeys.includes(comment.key)) {
							parent.replyKeys.push(comment.key);
						}
					}

					return { ok: true, added, remaining: ids.slice(100) };
				},
			};
		},
	});

	const BSKY_APPVIEW = "https://public.api.bsky.app/xrpc";
	const CONSTELLATION = "https://constellation.microcosm.blue";

	const CONSTELLATION_UA = `Backchannel/${SCRIPT_VERSION || "dev"} (github.com/twalichiewicz/Backchannel)`;

	async function bskyJSON(url, headers) {
		const attempt = async (sent) => {
			try {
				return await requestText(url, sent);
			} catch (error) {
				console.warn("Backchannel bsky: request threw", url, error);

				return "";
			}
		};

		let text = await attempt(headers);

		if (!text && headers) {
			text = await attempt(undefined);

			if (text) {
				console.warn(
					"Backchannel bsky: this manager refused a custom header; retried without the User-Agent Constellation asks for",
				);
			}
		}

		if (!text) {
			console.warn(
				"Backchannel bsky: empty response from",
				url,
				"— the manager may not have been granted this host",
			);

			return null;
		}

		try {
			return JSON.parse(text);
		} catch {
			console.warn("Backchannel bsky: response was not JSON", url, text.slice(0, 120));

			return null;
		}
	}

	registerSource({
		id: "bsky",
		// The app, not the PDS or the AppView. A reader clicks a link from
		// bsky.app; nothing navigates out of public.api.bsky.app.
		origins: ["bsky.app"],
		label: "Bluesky",
		shortLabel: "Bluesky",
		slow: true,
		beta: true,
		ageLabel: "Last Bluesky comment",
		threadArrivesWhole: true,
		caveat:
			"Will send each page you visit to Constellation, an independent index of Bluesky links, not to Bluesky. Bluesky is asked only about the posts Constellation names. Signed in or out, these requests carry no account.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (handle) => "https://bsky.app/profile/" + encodeURIComponent(handle),

		async discover(url) {
			const target = bskyTarget(url);

			if (!target) {
				return [];
			}

			const encoded = encodeURIComponent(target);
			const headers = { "User-Agent": CONSTELLATION_UA };
			const all = await bskyJSON(`${CONSTELLATION}/links/all?target=${encoded}`, headers);
			const paths = all?.links?.["app.bsky.feed.post"];

			if (!paths) {
				return [];
			}

			const uris = new Set();

			for (const [path, stat] of Object.entries(paths)) {
				if (!stat?.records) {
					continue;
				}

				const source = encodeURIComponent(`app.bsky.feed.post:${path.replace(/^\./, "")}`);
				const page = await bskyJSON(
					`${CONSTELLATION}/xrpc/blue.microcosm.links.getBacklinks?subject=${encoded}&source=${source}&limit=100`,
					headers,
				);

				for (const record of page?.records || []) {
					uris.add(`at://${record.did}/${record.collection}/${record.rkey}`);
				}
			}

			if (!uris.size) {
				return [];
			}

			const posts = [];
			const list = [...uris];

			for (let i = 0; i < list.length; i += 25) {
				const query = list
					.slice(i, i + 25)
					.map((uri) => "uris=" + encodeURIComponent(uri))
					.join("&");
				const batch = await bskyJSON(`${BSKY_APPVIEW}/app.bsky.feed.getPosts?${query}`);

				posts.push(...(batch?.posts || []));
			}

			const collective = bskyCollective(url, posts);

			return collective ? [collective] : [];
		},

		async loadThread(discussion) {
			const byKey = new Map();

			return {
				rootKeys: discussion.rootKeys,
				// Carried from discovery rather than fetched. The subtrees stay lazy,
				// which is the whole point of this adapter's shape.
				rootTimes: new Map(
					(discussion.rootKeys || []).map((key, index) => [
						key,
						discussion.rootTimes?.[index] || 0,
					]),
				),
				async getComment(key) {
					if (byKey.has(key)) {
						return byKey.get(key) || null;
					}

					const uri = bskyURIFromKey(key);

					if (!uri) {
						return null;
					}

					const thread = await bskyJSON(
						`${BSKY_APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=${BSKY_THREAD_DEPTH}&parentHeight=0`,
					);

					if (!thread?.thread) {
						// Remembered as absent, so a failed root is not refetched for
						// every reply the renderer then asks about.
						byKey.set(key, null);

						return null;
					}

					indexBskyThread(thread.thread, discussion, byKey, null);

					return byKey.get(key) || null;
				},

				async expandMore(ids) {
					const uri = ids?.[0];

					if (!uri) {
						return { ok: true, added: [], remaining: [] };
					}

					const thread = await bskyJSON(
						`${BSKY_APPVIEW}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=${BSKY_THREAD_DEPTH}&parentHeight=0`,
					);

					if (!thread?.thread) {
						return { ok: false, added: [], remaining: ids };
					}

					const key = bskyKeyFromURI(uri);
					const parent = byKey.get(key);
					const before = new Set(byKey.keys());

					for (const reply of thread.thread.replies || []) {
						if (!reply?.post?.uri) {
							continue;
						}

						const replyKey = bskyKeyFromURI(reply.post.uri);

						if (parent && !parent.replyKeys.includes(replyKey)) {
							parent.replyKeys.push(replyKey);
						}

						indexBskyThread(reply, discussion, byKey, key, 1);
					}

					const added = [];

					for (const [addedKey, comment] of byKey) {
						if (!before.has(addedKey) && comment) {
							added.push(comment);
						}
					}

					// This gap is closed whatever came back. Anything deeper is a new
					// gap, carried by whichever node now sits at the bottom.
					if (parent) {
						parent.more = null;
					}

					return { ok: true, added, remaining: [] };
				},
			};
		},
	});

	async function lobstersJSON(url) {
		const result = await requestWithMeta(url);

		return result.ok ? result.json : null;
	}

	registerSource({
		id: "lobsters",
		origins: ["lobste.rs"],
		label: "Lobsters",
		shortLabel: "Lobsters",
		beta: true,
		threadArrivesWhole: true,
		caveat:
			"Will send the domain of each page you visit to lobste.rs, not the full address. Signed in or out, these requests carry no account.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (user) => "https://lobste.rs/~" + encodeURIComponent(user),

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			let host;

			try {
				host = new URL(url).hostname;
			} catch {
				return [];
			}

			const stories = await lobstersJSON(
				`https://lobste.rs/domains/${encodeURIComponent(host)}.json`,
			);

			return (Array.isArray(stories) ? stories : [])
				.filter((story) => normalizeURL(story.url) === target)
				.map(lobstersDiscussion);
		},

		async frontPage() {
			const stories = await lobstersJSON("https://lobste.rs/hottest.json");

			return (Array.isArray(stories) ? stories : [])
				.filter((story) => isOffSiteLink(story.url, ["lobste.rs"]))
				.map(lobstersStory);
		},

		async loadThread(discussion) {
			const story = await lobstersJSON(
				`https://lobste.rs/s/${encodeURIComponent(discussion.id)}.json`,
			);
			const index = lobstersThreadIndex(story || { comments: [] }, discussion);

			return {
				rootKeys: index.rootKeys,
				// The whole tree arrived, so every root's time is already known.
				rootTimes: new Map(
					index.rootKeys.map((key) => [key, index.byKey.get(key)?.createdAt || 0]),
				),
				async getComment(key) {
					return index.byKey.get(key) || null;
				},
			};
		},
	});

	const WIKIPEDIA_THREAD_PAGES = 10;

	async function wikipediaJSON(url) {
		const result = await requestWithMeta(url);

		return result.ok ? result.json : null;
	}

	function wikipediaRootComment(page, discussion) {
		const href =
			"https://en.wikipedia.org/wiki/" +
			encodeURIComponent(page.title.replace(/ /g, "_"));

		return {
			source: "wikipedia",
			key: sourceKey("wikipedia", String(page.pageid)),
			id: page.pageid,
			discussionKey: discussion.key,
			parentKey: null,
			author: "",
			bodyHTML: `<a target="_blank" rel="noopener noreferrer" href="${escapeHTML(href)}">${escapeHTML(page.title)}</a> links this page.`,
			score: null,
			createdAt: page.time || 0,
			isOP: false,
			deleted: false,
			replyKeys: [],
		};
	}

	registerSource({
		id: "wikipedia",
		origins: ["en.wikipedia.org"],
		label: "Wikipedia",
		shortLabel: "Wikipedia",
		slow: true,
		beta: true,
		// A collective was never posted; its byline is the last edit among the pages
		// that cite the URL. Named so the panel does not read "Last comment".
		ageLabel: "Last active on Wikipedia",
		// The roots are known at discovery and carried on the discussion, so the
		// whole thing is on screen as soon as it renders.
		threadArrivesWhole: true,
		caveat:
			"Will send each page you visit to Wikipedia's API to find pages that link it. No account, signed in or out.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (author) =>
			"https://en.wikipedia.org/wiki/User:" + encodeURIComponent(author),

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			const api = "https://en.wikipedia.org/w/api.php";
			const query = target.replace(/^https?:\/\//, "");
			const ext = await wikipediaJSON(
				`${api}?action=query&list=exturlusage&eunamespace=${encodeURIComponent("1|3|4|5")}&euquery=${encodeURIComponent(query)}&eulimit=100&format=json&formatversion=2`,
			);

			// The euquery is a hint; this comparison is the answer, the same check the
			// other sources apply to their own search results.
			const rows = (ext?.query?.exturlusage || []).filter(
				(row) => normalizeURL(row.url) === target,
			);
			const pages = [...new Map(rows.map((row) => [row.pageid, row])).values()];

			if (!pages.length) {
				return [];
			}

			// Dates every page in batches of 50. The last edit is an approximate
			// "last active", which is all the blend needs to place the roots.
			const times = new Map();

			for (let i = 0; i < pages.length; i += 50) {
				const titles = pages
					.slice(i, i + 50)
					.map((page) => page.title)
					.join("|");
				const rev = await wikipediaJSON(
					`${api}?action=query&prop=revisions&rvprop=timestamp&format=json&formatversion=2&titles=${encodeURIComponent(titles)}`,
				);

				for (const page of rev?.query?.pages || []) {
					const stamp = page.revisions?.[0]?.timestamp;

					if (stamp) {
						times.set(page.title, Math.floor(Date.parse(stamp) / 1000));
					}
				}
			}

			const collective = wikipediaCollective(url, pages, times);

			return collective ? [collective] : [];
		},

		async loadThread(discussion) {
			const byKey = new Map();
			const rootKeys = [];
			const rootTimes = new Map();

			const pages = [...(discussion.wikiPages || [])].sort(
				(left, right) => (right.time || 0) - (left.time || 0),
			);
			const asked = pages.slice(0, WIKIPEDIA_THREAD_PAGES);
			const threads = await Promise.all(
				asked.map((page) =>
					wikipediaJSON(
						`https://en.wikipedia.org/w/api.php?action=discussiontoolspageinfo&page=${encodeURIComponent(
							page.title,
						)}&prop=threaditemshtml&format=json&formatversion=2`,
					),
				),
			);

			// One set for the whole discussion, so the pages are deduplicated against
			// each other in the order they are walked -- newest edit first.
			const seen = new Set();

			pages.forEach((page, index) => {
				const items =
					index < asked.length
						? threads[index]?.discussiontoolspageinfo?.threaditemshtml
						: null;
				const indexed = items
					? indexWikipediaPage(items, discussion, discussion.articleURL, seen)
					: { rootKeys: [], byKey: new Map(), cited: 0 };

				if (!indexed.rootKeys.length && !indexed.cited) {
					const fallback = wikipediaRootComment(page, discussion);

					byKey.set(fallback.key, fallback);
					rootKeys.push(fallback.key);
					rootTimes.set(fallback.key, page.time || 0);

					return;
				}

				for (const [key, comment] of indexed.byKey) {
					byKey.set(key, comment);
				}

				for (const key of indexed.rootKeys) {
					rootKeys.push(key);
					rootTimes.set(key, byKey.get(key)?.createdAt || page.time || 0);
				}
			});

			return {
				rootKeys,
				rootTimes,
				async getComment(key) {
					return byKey.get(key) || null;
				},
			};
		},
	});

	const HYPOTHESIS_API = "https://api.hypothes.is/api/search";
	const HYPOTHESIS_LIMIT = 200;

	async function hypothesisJSON(url) {
		const result = await requestWithMeta(url);

		return result.ok ? result.json : null;
	}

	registerSource({
		id: "hypothesis",
		origins: ["hypothes.is", "web.hypothes.is"],
		label: "Hypothes.is",
		shortLabel: "Hypothes.is",
		beta: true,
		// The annotations were never posted as a thread; this is when one was last
		// written, so the panel does not read "Last comment".
		ageLabel: "Last annotation",
		// /api/search returns the note text, so the rows ride on the discussion and
		// loadThread makes no second request.
		threadArrivesWhole: true,
		caveat:
			"Will send each page you visit to the Hypothes.is API to find public annotations on it. No account, signed in or out.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (author) =>
			"https://hypothes.is/users/" + encodeURIComponent(author),

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			// The normalized target carries no scheme, which the API accepts and
			// answers for both http and https copies of the page. It answers for
			// other documents it considers equivalent too; hypothesisKeptRows is
			// what narrows that back to the page in front of the reader.
			const found = await hypothesisJSON(
				`${HYPOTHESIS_API}?url=${encodeURIComponent(target)}&limit=${HYPOTHESIS_LIMIT}`,
			);
			const collective = hypothesisCollective(target, found?.rows || [], url);

			return collective ? [collective] : [];
		},

		async loadThread(discussion) {
			const index = hypothesisThreadIndex(
				discussion.annotations || [],
				discussion,
			);
			const rootTimes = new Map();

			for (const key of index.rootKeys) {
				rootTimes.set(key, index.byKey.get(key)?.createdAt || 0);
			}

			return {
				rootKeys: index.rootKeys,
				rootTimes,
				async getComment(key) {
					return index.byKey.get(key) || null;
				},
			};
		},
	});

	const MASTODON_INSTANCE = "https://mastodon.social";
	const TOOTFINDER = "https://www.tootfinder.ch";

	async function mastodonJSON(url) {
		const result = await requestWithMeta(url);

		return result.ok ? result.json : null;
	}

	registerSource({
		id: "mastodon",
		// Where a reader arrives from. Not exhaustive -- there are thousands of
		// instances -- and arrival is only a blend hint, so a miss costs nothing.
		origins: ["mastodon.social", "hachyderm.io", "fosstodon.org", "mstdn.social"],
		label: "Mastodon",
		shortLabel: "Mastodon",
		slow: true,
		beta: true,
		// A collective was never posted, so a bare age would read as "posted then".
		// The only honest timestamp is when it last moved.
		ageLabel: "Last Mastodon post",
		// The index answers with whole statuses, so loadThread fetches nothing and
		// what is on screen is the discussion.
		threadArrivesWhole: true,
		caveat:
			"Will send the domain of each page you visit to Tootfinder, an opt-in index of Mastodon posts. It indexes only people who chose to be searchable. Signed in or out, these requests carry no account.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (handle) => {
			const [user, host] = String(handle).split("@");

			return user && host
				? `https://${host}/@${encodeURIComponent(user)}`
				: null;
		},

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			let host = "";

			try {
				host = new URL(url).hostname;
			} catch {
				return [];
			}

			const statuses = await mastodonJSON(
				`${TOOTFINDER}/rest/api/search/${encodeURIComponent(host)}`,
			);

			if (!Array.isArray(statuses)) {
				return [];
			}

			const collective = mastodonCollective(
				url,
				statuses.filter((status) => mastodonStatusPasses(status, target)),
			);

			return collective ? [collective] : [];
		},

		// Nothing to fetch: discovery already holds every status this will show.
		async loadThread(discussion) {
			const byKey = new Map();

			for (const status of discussion.statuses || []) {
				const comment = mastodonComment(status, discussion);

				byKey.set(comment.key, comment);
			}

			return {
				rootKeys: discussion.rootKeys,
				rootTimes: new Map(
					(discussion.rootKeys || []).map((key, index) => [
						key,
						discussion.rootTimes?.[index] || 0,
					]),
				),
				async getComment(key) {
					return byKey.get(key) || null;
				},
			};
		},

		async frontPage() {
			const links = await mastodonJSON(
				`${MASTODON_INSTANCE}/api/v1/trends/links?limit=40`,
			);

			if (!Array.isArray(links)) {
				return [];
			}

			return links.filter((link) => link?.url).map(mastodonTrendStory);
		},
	});

	async function lemmyJSON(url) {
		const result = await requestWithMeta(url);

		return result.ok ? result.json : null;
	}

	registerSource({
		id: "lemmy",
		origins: [
			"lemmy.world",
			"lemmy.ml",
			"sh.itjust.works",
			"lemm.ee",
			"programming.dev",
			"beehaw.org",
		],
		label: "Lemmy",
		shortLabel: "Lemmy",
		slow: true,
		beta: true,
		caveat:
			"Will send each page you visit to lemmy.world, a large Lemmy instance whose federation reaches across the network. No account, signed in or out.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (handle) => "https://lemmy.world/u/" + handle,

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			const res = await lemmyJSON(
				`https://lemmy.world/api/v3/search?q=${encodeURIComponent(url)}&type_=Url&listing_type=All&limit=20`,
			);

			return (res?.posts || [])
				.filter((postView) => normalizeURL(postView.post?.url) === target)
				.map(lemmyDiscussion);
		},

		async frontPage() {
			const res = await lemmyJSON(
				"https://lemmy.world/api/v3/post/list?sort=Active&type_=All&limit=50",
			);

			return (res?.posts || [])
				.filter((view) => isOffSiteLink(view.post?.url, [], ["/pictrs/"]))
				.map(lemmyStory);
		},

		async loadThread(discussion) {
			const res = await lemmyJSON(
				`https://lemmy.world/api/v3/comment/list?post_id=${encodeURIComponent(discussion.id)}&type_=All&sort=Top&max_depth=8&limit=300`,
			);
			const index = lemmyThreadIndex(res?.comments || [], discussion);

			return {
				rootKeys: index.rootKeys,
				// The tree arrived in one call, so every root's time is known.
				rootTimes: new Map(
					index.rootKeys.map((key) => [key, index.byKey.get(key)?.createdAt || 0]),
				),
				async getComment(key) {
					return index.byKey.get(key) || null;
				},
			};
		},
	});

	const DISCOVER_CEILING_MS = 12000;

	function discoverWithCeiling(promise, sourceId) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				console.warn("Backchannel " + sourceId + " discovery timed out");
				resolve([]);
			}, DISCOVER_CEILING_MS);

			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				() => {
					clearTimeout(timer);
					resolve([]);
				},
			);
		});
	}

	// More than one address can name the same article -- an archive page and the
	// article it archived. Every source is asked about each, in one pass, so the
	// wait does not double even though the request count does.
	async function discoverAll(urls, settings) {
		const targets = [...new Set([].concat(urls).filter(Boolean))];
		const results = await Promise.all(
			enabledSources(settings).flatMap((source) =>
				targets.map((target) =>
					discoverWithCeiling(
						source.discover(target).catch((e) => {
							console.error("Backchannel " + source.id + " discovery failed:", e);
							return [];
						}),
						source.id,
					),
				),
			),
		);

		return disambiguateLabels(
			dedupeDiscussions(results.flat().filter(Boolean)).sort(
				compareStoriesByDiscussion,
			),
		);
	}

	const THREAD_CEILING_MS = 20000;

	function emptyThreadReader() {
		return {
			rootKeys: [],
			rootTimes: new Map(),
			async getComment() {
				return null;
			},
		};
	}

	function loadThreadWithCeiling(story) {
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				console.warn("Backchannel " + story.source + " comments timed out");
				resolve(emptyThreadReader());
			}, THREAD_CEILING_MS);

			Promise.resolve(getSource(story.source).loadThread(story)).then(
				(reader) => {
					clearTimeout(timer);
					resolve(reader || emptyThreadReader());
				},
				(error) => {
					clearTimeout(timer);
					console.error("Backchannel " + story.source + " comments failed:", error);
					resolve(emptyThreadReader());
				},
			);
		});
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

		const answered = [];

		for (const query of queries) {
			const result = await request(
				"https://hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=20&query=" +
					encodeURIComponent(query),
			);

			answered.push(Boolean(result && result.hits));

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

		if (shouldCacheDiscovery(answered)) {
			await save(cacheKey, {
				timestamp: Date.now(),
				results: sorted,
			});
		}

		return sorted;
	}

	const FRONT_PAGE_CACHE_KEY = "HNewhere:frontpage_cache";

	const FRONT_PAGE_TTL = 5 * 60 * 1000;

	// Which enabled sources have a front page to contribute. See hasFrontPage for
	// why that is a method on the source rather than a list kept here.
	function frontPageSourceIds(settings) {
		return enabledSourceIds(settings, registeredSourceIds()).filter((id) =>
			hasFrontPage(getSource(id)),
		);
	}

	async function loadFrontPages(options = {}) {
		const settings = options.settings || (await loadSettings());
		const ids = frontPageSourceIds(settings);

		if (!ids.length) {
			return { rows: [], sources: [] };
		}

		const cacheKey = FRONT_PAGE_CACHE_KEY + ":" + ids.join(",");
		const cached = await load(cacheKey, null);

		if (
			!options.force &&
			cached?.rows?.length &&
			Date.now() - cached.timestamp < FRONT_PAGE_TTL
		) {
			return { rows: cached.rows, sources: cached.sources || ids };
		}

		const lists = await Promise.all(
			ids.map(async (id) => {
				try {
					return (await getSource(id).frontPage()) || [];
				} catch (e) {
					console.warn("Backchannel " + id + " front page failed:", e);
					return [];
				}
			}),
		);

		const answered = ids.filter((id, index) => lists[index].length);
		const rows = mergeStoriesByURL(
			blendStories(lists.filter((list) => list.length)),
		);

		if (!rows.length) {
			return { rows: cached?.rows || [], sources: cached?.sources || [] };
		}

		await save(cacheKey, { timestamp: Date.now(), rows, sources: answered });

		return { rows, sources: answered };
	}

	// -------------------------
	// Helpers
	// -------------------------

	// Hosts that renamed under Hacker News' feet. HN holds years of submissions
	// under the old name while the site now serves the new one, so a reader on
	// x.com looking at something submitted as twitter.com finds nothing at all --
	// 179 comments, and a grey button.
	//
	// Folded onto one name rather than searched for twice, and because normalizeURL
	// is applied to both sides -- the address in hand and every hit it is measured
	// against -- it does not matter which way round the two arrive.
	// #region hnewhere-test-export
	// Wrapped with normalizeURL below rather than separately: normalizeURL reads
	// this map, so exporting the function without it is a ReferenceError the
	// moment a test calls it.
	const HOST_ALIASES = new Map([
		["x.com", "twitter.com"],
		["www.x.com", "twitter.com"],
		["mobile.x.com", "twitter.com"],
		["www.twitter.com", "twitter.com"],
		["mobile.twitter.com", "twitter.com"],
	]);

	function normalizeURL(url) {
		try {
			const u = new URL(url);
			const keysToRemove = [];

			for (const key of u.searchParams.keys()) {
				if (isTrackingParam(key)) {
					keysToRemove.push(key);
				}
			}

			for (const key of keysToRemove) {
				u.searchParams.delete(key);
			}

			const host = u.hostname.toLowerCase();

			return (
				(HOST_ALIASES.get(host) || host) +
				u.pathname.replace(/\/$/, "") +
				u.search
			);
		} catch {
			return "";
		}
	}

	function canonicalPageURL(href, hint) {
		if (!hint) {
			return href;
		}

		let page;
		let named;

		try {
			page = new URL(href);
			named = new URL(hint, href);
		} catch {
			return href;
		}

		const bare = (path) => path.replace(/\/+$/, "");

		if (
			named.hostname.toLowerCase() !== page.hostname.toLowerCase() ||
			bare(named.pathname) !== bare(page.pathname)
		) {
			return href;
		}

		for (const [key, value] of named.searchParams) {
			if (page.searchParams.get(key) !== value) {
				return href;
			}
		}

		// The reader's address minus what the hint dropped, not the hint itself:
		// rebuilding would adopt its scheme and trailing slash too.
		const out = new URL(href);

		for (const key of [...out.searchParams.keys()]) {
			if (!named.searchParams.has(key)) {
				out.searchParams.delete(key);
			}
		}

		return out.href;
	}

	const ARCHIVE_HOSTS = new Set([
		"archive.is",
		"archive.today",
		"archive.ph",
		"archive.li",
		"archive.vn",
		"archive.md",
		"archive.fo",
		"web.archive.org",
	]);

	function isArchiveHost(hostname) {
		return ARCHIVE_HOSTS.has(
			String(hostname || "").toLowerCase().replace(/^www\./, ""),
		);
	}

	function safeDecode(value) {
		try {
			return decodeURIComponent(value);
		} catch {
			return null;
		}
	}

	// An archive is the one place where "this page is really a different page" is
	// the truth rather than a spoof, so it is the one place canonicalPageURL's
	// refusal to follow a hint across hosts is lifted -- and only for the hosts
	// named above, because the refusal is what stops a site claiming someone
	// else's discussion.
	function archivedOriginalURL(href, hint) {
		let here;

		try {
			here = new URL(href);
		} catch {
			return null;
		}

		if (!isArchiveHost(here.hostname)) {
			return null;
		}

		const usable = (candidate) => {
			let parsed;

			try {
				parsed = new URL(candidate);
			} catch {
				return null;
			}

			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return null;
			}

			// An archived archive names nothing worth asking about, and following it
			// would recurse.
			if (isArchiveHost(parsed.hostname)) {
				return null;
			}

			// The exclusion list covers the page the reader is on. An archived bank
			// would walk straight past it, so what comes out takes the same check.
			return isHiddenSite(parsed.href) ? null : parsed.href;
		};

		// The path first, because it is structural where a canonical is a claim the
		// archived document makes about itself. Any timestamp, flagged or not, or
		// newest/oldest, then the address.
		for (const path of [here.pathname, safeDecode(here.pathname)]) {
			const found = path?.match(/\/(https?:\/{1,2}.+)$/i);

			if (found) {
				// Some archives collapse the scheme's double slash on the way in.
				const repaired = found[1].replace(/^(https?:)\/(?!\/)/i, "$1//");

				// The original's own query and fragment sit in the archive URL's search
				// and hash rather than its path.
				return usable(repaired + here.search + here.hash);
			}
		}

		// Nothing in the path: a short code, like archive.is/901m5. What the
		// archived document says about itself is the only thing left.
		return hint ? usable(hint) : null;
	}

	// Both addresses can surface the same thread -- an archive link and the article
	// it archives are often both submitted. Keyed on what already identifies a
	// discussion uniquely per source.
	function dedupeDiscussions(discussions) {
		const seen = new Set();

		return (discussions || []).filter((discussion) => {
			if (!discussion || seen.has(discussion.key)) {
				return false;
			}

			seen.add(discussion.key);

			return true;
		});
	}
	// #endregion hnewhere-test-export

	function canonicalHint() {
		return (
			document.querySelector('link[rel~="canonical" i]')?.href ||
			document.querySelector('meta[property="og:url" i]')?.content ||
			""
		);
	}

	function pageAddress() {
		return canonicalPageURL(location.href, canonicalHint());
	}

	// What to look the conversation up under. On an archive, the article it
	// archived is asked about as well as the archive link -- both get submitted and
	// discussed, and they are discussions about the same thing. pageAddress itself
	// stays the address the reader is at, so submitting and the queue keep meaning
	// what they mean.
	function pageAddresses() {
		const here = pageAddress();
		const original = archivedOriginalURL(location.href, canonicalHint());

		return original && !sameURL(original, here) ? [here, original] : [here];
	}

	// pageAddress reads the head, so it needs one. @run-at document-end is not
	// honoured by every manager.
	function documentReady() {
		if (document.readyState !== "loading") {
			return Promise.resolve();
		}

		return new Promise((resolve) => {
			document.addEventListener("DOMContentLoaded", () => resolve(), {
				once: true,
			});
		});
	}

	// -------------------------
	// Site suppression
	// -------------------------

	// Pages that could never be a Hacker News submission: someone's mail, their
	// money, an auth flow, a document they are editing, or something only reachable
	// from inside a network. The @exclude header catches the worst of these before
	// the script loads at all, but a header pattern cannot look at a URL path, so
	// anything path-shaped has to be caught here.
	//
	// Deliberately conservative. A missed site shows a button that does nothing
	// useful, which is a far cheaper mistake than suppressing a site people
	// genuinely read articles on, and adding an entry is a one-line change.
	// #region hnewhere-test-export
	const HIDDEN_HOST_PATTERNS = [
		// Mail
		/^(mail|inbox|webmail|email)\./,
		/(^|\.)(gmail|outlook|hotmail|fastmail|zoho|superhuman|hey)\.com$/,
		/(^|\.)proton\.(me|mail)$/,
		/(^|\.)mail\.(ru|yahoo)\.com$/,

		// Auth and identity
		/^(accounts?|login|signin|auth|sso|idp|id|oauth)\./,
		/(^|\.)(okta|onelogin|duosecurity|auth0|clerk|workos)\.com$/,

		// Money
		/(^|\.)bank(ing)?\./,
		/(^|\.)(chase|bankofamerica|wellsfargo|citibank|capitalone|usbank)\.com$/,
		/(^|\.)(hsbc|barclays|lloydsbank|natwest|santander|monzo|revolut)\.(com|co\.uk)$/,
		/(^|\.)(americanexpress|amex|discover)\.com$/,
		/(^|\.)(schwab|fidelity|vanguard|etrade|robinhood|coinbase)\.com$/,
		/(^|\.)(paypal|venmo|wise|stripe|squareup|plaid)\.com$/,

		// Consoles and dashboards. "portal." is deliberately not in the generic list:
		// portal.acm.org and friends host papers that get submitted all the time.
		/^(console|dashboard|admin|manage)\./,
		/(^|\.)console\.(aws\.amazon|cloud\.google)\.com$/,
		/(^|\.)portal\.azure\.com$/,

		// Documents being edited, not read
		/(^|\.)(docs|drive|sheets|slides|calendar|keep)\.google\.com$/,
		/(^|\.)(notion|coda|airtable|figma|miro|canva)\.(so|io|com)$/,
		/(^|\.)(linear|asana|monday|clickup|trello|basecamp)\.(app|com)$/,
		/(^|\.)atlassian\.net$/,

		// Chat and meetings
		/(^|\.)(slack|discord|zoom)\.(com|us)$/,
		/(^|\.)(teams|outlook)\.(microsoft|office|live)\.com$/,
		/(^|\.)meet\.google\.com$/,
		/(^|\.)web\.(whatsapp|telegram)\.(com|org)$/,
		/(^|\.)messenger\.com$/,

		// Feeds with nothing stable to link to
		/(^|\.)(instagram|tiktok|snapchat|threads)\.(com|net)$/,

		// Streaming
		/(^|\.)(netflix|hulu|disneyplus|max|primevideo|spotify|tidal)\.com$/,
		/(^|\.)music\.(apple|youtube)\.com$/,

		// Search result pages
		/(^|\.)(duckduckgo|bing|baidu|yandex|ecosia|startpage|qwant)\.com$/,
		/^search\./,
	];

	const HIDDEN_PATH_PATTERNS = [
		/^\/(login|log-in|signin|sign-in|signup|sign-up|register|logout|log-out|sign-out)(\/|$)/,
		/^\/(auth|oauth|oauth2|sso|saml|password|reset-password|forgot|forgot-password|verify|2fa|mfa)(\/|$)/,
		/^\/(checkout|cart|basket|payment|payments|billing|invoice|invoices|subscribe|upgrade)(\/|$)/,
		/^\/(admin|wp-admin|dashboard|settings|preferences|account|accounts|my-account|profile\/edit)(\/|$)/,
		/^\/(search|results)(\/|$)/,
		/^\/(compose|inbox|messages|dm|chat)(\/|$)/,
	];

	// Whole classes of host for one rule each: anything not reachable from the
	// public internet cannot be submitted, whatever it is serving.
	function isPrivateHostname(hostname) {
		return (
			hostname === "localhost" ||
			// IPv4 literal, or an IPv6 literal (which arrives bracketed, so testing for
			// a colon is enough to tell it from a name).
			/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
			hostname.includes(":") ||
			// No dot at all means a single-label intranet name.
			!hostname.includes(".") ||
			/\.(local|internal|test|localhost|lan|invalid|example)$/.test(hostname) ||
			hostname.endsWith(".home.arpa")
		);
	}

	function isHiddenSite(url = location.href) {
		let parsed;

		try {
			parsed = new URL(url);
		} catch {
			// Unparseable means there is nothing to submit either.
			return true;
		}

		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return true;
		}

		const hostname = parsed.hostname.toLowerCase();

		if (isPrivateHostname(hostname)) {
			return true;
		}

		if (HIDDEN_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
			return true;
		}

		const pathname = parsed.pathname.toLowerCase();

		return HIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(pathname));
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
	// #endregion hnewhere-test-export

	function pluralize(value, singular, plural = singular + "s") {
		return value + " " + (value === 1 ? singular : plural);
	}

	function joinWithAnd(items) {
		if (items.length < 3) {
			return items.join(" and ");
		}

		return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
	}

	// #region hnewhere-test-export
	// What the sidebar is waiting on, named rather than measured. Lowercase to sit
	// under the header title the way the rest of the secondary text does.
	const SIDEBAR_STAGES = {
		discussion: "loading discussion…",
		comments: "loading comments…",
		votes: "loading votes…",
		annotations: "loading annotations…",
	};

	// Returns "" for no stage and for an unrecognised one, so the caller can clear
	// the subtitle by passing null and never has to strip a placeholder.
	function sidebarStageLabel(stage) {
		return SIDEBAR_STAGES[stage] || "";
	}

	function prefersReducedMotion(
		mediaMatcher = typeof window === "undefined" ? null : window.matchMedia,
	) {
		if (typeof mediaMatcher !== "function") {
			return false;
		}

		try {
			return mediaMatcher("(prefers-reduced-motion: reduce)")?.matches === true;
		} catch {
			return false;
		}
	}

	// #endregion hnewhere-test-export

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
		return comment.createdAt && comment.createdAt > seenTimestamp;
	}

	// Sliver of the page left showing down the left edge on a portrait phone, so it
	// still reads as a panel over the article rather than a new page.
	const PORTRAIT_SIDEBAR_GUTTER = 28;

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

	// -------------------------
	// Theme detection
	// -------------------------
	//
	// Matching the page rather than the OS is deliberate: a reader running Dark
	// Reader or a site's own dark theme has a dark page under a light OS, and a
	// sidebar that follows the OS would be the one bright rectangle on screen.
	// Originally contributed by @bennetthanke in #21.

	// Returns null when the colour says nothing about the page -- fully transparent,
	// or a format this cannot read -- so the caller can look somewhere else.
	// #region hnewhere-test-export
	function isDarkColor(color) {
		const match = /rgba?\(([^)]+)\)/.exec(color || "");

		if (!match) {
			return null;
		}

		const [r, g, b, a = 1] = match[1].split(",").map(parseFloat);

		if (![r, g, b].every(Number.isFinite)) {
			return null;
		}

		// Mostly transparent is treated the same as transparent: what shows through is
		// whatever is behind, so this element is not the one to judge by.
		if (!Number.isFinite(a) || a < 0.5) {
			return null;
		}

		// Rec. 709 coefficients over gamma-encoded sRGB. Not true relative luminance,
		// but the error is far smaller than the light/dark margin being tested.
		return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
	}

	function detectDarkMode() {
		if (themePreference === "dark") {
			return true;
		}

		if (themePreference === "light") {
			return false;
		}

		for (const element of [document.body, document.documentElement]) {
			if (!element) {
				continue;
			}

			const dark = isDarkColor(getComputedStyle(element).backgroundColor);

			if (dark !== null) {
				return dark;
			}
		}

		return window.matchMedia("(prefers-color-scheme: dark)").matches;
	}

	function isDarkBackdrop(element) {
		for (let node = element; node; node = node.parentElement) {
			const dark = isDarkColor(getComputedStyle(node).backgroundColor);

			if (dark !== null) {
				return dark;
			}
		}

		const scheme = getComputedStyle(document.documentElement).colorScheme || "";

		return (
			/\bdark\b/.test(scheme) &&
			window.matchMedia("(prefers-color-scheme: dark)").matches
		);
	}

	// getComputedStyle needs an element, and a range routinely lands on a text node.
	function nearestElement(node) {
		if (!node) {
			return null;
		}

		return node.nodeType === 1 ? node : node.parentElement;
	}

	// #endregion hnewhere-test-export

	const DARK_CLASS = "hnewhere-dark";

	// The reader's accent split into its light and dark halves, or null while they
	// are on the built-in one. Memoised on the stored string: activeAccent is asked
	// once per highlight rect, and a page with a busy article asks hundreds of
	// times for an answer that only changes when the setting does.
	// #region hnewhere-test-export
	let accentMemoKey = false;
	let accentMemo = null;

	function accentOverridePalette() {
		if (accentMemoKey !== accentPreference) {
			accentMemoKey = accentPreference;
			accentMemo = accentPreference
				? deriveAccentPalette(accentPreference)
				: null;
		}

		return accentMemo;
	}

	function activeAccent(dark) {
		const override = accentOverridePalette();

		if (override) {
			return dark ? override.dark : override.light;
		}

		return dark
			? {
					accent: ACCENT_DARK,
					accentRgb: ACCENT_DARK_RGB,
					ink: readableInk(parseHexColor(ACCENT_DARK)),
				}
			: {
					accent: ACCENT,
					accentRgb: ACCENT_RGB,
					ink: readableInk(parseHexColor(ACCENT)),
				};
	}
	// #endregion hnewhere-test-export

	// loadSettings and saveSettings have already refreshed the cache the palette
	// memoises off, so this only has to push the new colour out to what is mounted.
	async function refreshAccentOverride() {
		for (const apply of themeAppliers) {
			apply();
		}

		await refreshButtonAppearance();
		await refreshArticleAnnotations();
	}

	function applyThemeToHost(host) {
		const dark = detectDarkMode();

		host.classList.toggle(DARK_CLASS, dark);

		const properties = {
			"--accent": null,
			"--accent-rgb": null,
			"--accent-ink": null,
			"--header-bg": null,
			"--subtitle-stage": null,
		};

		const override = accentOverridePalette();

		if (override) {
			const half = dark ? override.dark : override.light;

			properties["--accent"] = half.accent;
			properties["--accent-rgb"] = half.accentRgb;
			properties["--accent-ink"] = half.ink;
			properties["--subtitle-stage"] = half.subtitleStage;
			// Light follows the accent through var(--header-bg:var(--accent)); dark
			// is a literal in the stylesheet and has to be replaced outright.
			properties["--header-bg"] = dark ? half.headerBg : null;
		}

		for (const [name, value] of Object.entries(properties)) {
			if (value) {
				host.style.setProperty(name, value);
			} else {
				host.style.removeProperty(name);
			}
		}
	}

	// Every mounted surface registers its applier here so a settings change can be
	// pushed to all of them; matchMedia only covers the OS-level trigger.
	const themeAppliers = new Set();

	// Returns a cleanup function. The OS setting can change while a surface is open,
	// and it is the fallback whenever the page background is transparent.
	function watchTheme(host) {
		const apply = () => applyThemeToHost(host);
		const query = window.matchMedia("(prefers-color-scheme: dark)");

		apply();
		query.addEventListener("change", apply);
		themeAppliers.add(apply);

		return () => {
			query.removeEventListener("change", apply);
			themeAppliers.delete(apply);
		};
	}

	const KEYBOARD_GUARD_EVENTS = ["keydown", "keypress", "keyup"];
	const EDITABLE_SELECTOR =
		"input, textarea, select, [contenteditable=''], [contenteditable='true']";

	function guardHostKeyboard(host) {
		const onKey = (event) => {
			const source = event.composedPath()[0];

			if (source instanceof Element && source.matches(EDITABLE_SELECTOR)) {
				event.stopPropagation();
			}
		};

		for (const type of KEYBOARD_GUARD_EVENTS) {
			host.addEventListener(type, onKey);
		}
	}

	// The floating buttons sit in the page rather than a shadow root, so they
	// resolve their own colour and have to be repainted by hand.
	function refreshThemeSurfaces() {
		for (const apply of themeAppliers) {
			apply();
		}

		for (const id of [
			"hn-restore-button",
			"hn-collapse-button",
			"hn-submit-button",
			"hn-setup-button",
		]) {
			const button = document.getElementById(id);

			if (button) {
				setFloatingButtonVariant(
					button,
					button.dataset.hnewhereVariant || "active",
				);
			}
		}
	}

	function isMobile() {
		return (
			window.matchMedia("(max-width: 700px)").matches ||
			"ontouchstart" in window ||
			navigator.maxTouchPoints > 0
		);
	}

	// The floating button lives in the page rather than a shadow root, so it cannot
	// read the panel's CSS variables and needs the accent as a value. Same colour,
	// stated twice -- which is why both live here rather than in the rules that use
	// them.
	// #region hnewhere-test-export
	// In a region because the heat palette is built from ACCENT_RGB and is itself
	// tested: the harness evaluates the regions alone, so an identifier one region
	// borrows from another has to be inside one too.
	const ACCENT = "#237140";
	const ACCENT_DARK = "#3fa96a";

	const ACCENT_RGB = "35,113,64";
	// The dark half's channels, beside the hex they belong to rather than written
	// out again wherever they are needed.
	const ACCENT_DARK_RGB = "63,169,106";

	const PANEL_BG_LIGHT = { r: 246, g: 246, b: 239 };
	const PANEL_BG_DARK = { r: 30, g: 30, b: 30 };
	const ACCENT_MIN_CONTRAST = 4.5;

	function parseHexColor(value) {
		const text = String(value ?? "").trim().replace(/^#/, "");

		// Three digits is the shorthand every colour picker accepts, so a reader
		// typing #0a0 means the same thing here as everywhere else.
		const full =
			text.length === 3
				? text.replace(/./g, (character) => character + character)
				: text;

		if (!/^[0-9a-f]{6}$/i.test(full)) {
			return null;
		}

		return {
			r: parseInt(full.slice(0, 2), 16),
			g: parseInt(full.slice(2, 4), 16),
			b: parseInt(full.slice(4, 6), 16),
		};
	}

	function rgbToHex({ r, g, b }) {
		return (
			"#" +
			[r, g, b]
				.map((channel) =>
					Math.max(0, Math.min(255, Math.round(channel)))
						.toString(16)
						.padStart(2, "0"),
				)
				.join("")
		);
	}

	function rgbToHsl({ r, g, b }) {
		const red = r / 255;
		const green = g / 255;
		const blue = b / 255;
		const max = Math.max(red, green, blue);
		const min = Math.min(red, green, blue);
		const delta = max - min;
		const l = (max + min) / 2;

		if (!delta) {
			return { h: 0, s: 0, l };
		}

		const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
		let h;

		if (max === red) {
			h = ((green - blue) / delta) % 6;
		} else if (max === green) {
			h = (blue - red) / delta + 2;
		} else {
			h = (red - green) / delta + 4;
		}

		return { h: (h * 60 + 360) % 360, s, l };
	}

	function hslToRgb({ h, s, l }) {
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs((((h % 360) + 360) % 360) / 60 % 2 - 1));
		const m = l - c / 2;
		const sector = Math.floor((((h % 360) + 360) % 360) / 60);
		const [r, g, b] = [
			[c, x, 0],
			[x, c, 0],
			[0, c, x],
			[0, x, c],
			[x, 0, c],
			[c, 0, x],
		][sector];

		return {
			r: Math.round((r + m) * 255),
			g: Math.round((g + m) * 255),
			b: Math.round((b + m) * 255),
		};
	}

	function relativeLuminance({ r, g, b }) {
		const [red, green, blue] = [r, g, b].map((channel) => {
			const value = channel / 255;

			return value <= 0.03928
				? value / 12.92
				: Math.pow((value + 0.055) / 1.055, 2.4);
		});

		return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	}

	function readableInk(rgb) {
		return contrastRatio(rgb, { r: 255, g: 255, b: 255 }) >=
			contrastRatio(rgb, { r: 0, g: 0, b: 0 })
			? "#ffffff"
			: "#000000";
	}

	function contrastRatio(a, b) {
		const first = relativeLuminance(a);
		const second = relativeLuminance(b);

		return (
			(Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
		);
	}

	function reachContrast(hsl, background, target, direction) {
		let { l } = hsl;

		for (let step = 0; step <= 100; step += 1) {
			const candidate = { ...hsl, l };

			if (contrastRatio(hslToRgb(candidate), background) >= target) {
				return candidate;
			}

			l = Math.max(0, Math.min(1, l + direction * 0.01));

			if (l === 0 || l === 1) {
				return { ...hsl, l };
			}
		}

		return { ...hsl, l };
	}

	function deriveAccentPalette(hex) {
		const rgb = parseHexColor(hex);

		if (!rgb) {
			return null;
		}

		const hsl = rgbToHsl(rgb);
		const light = reachContrast(
			hsl,
			PANEL_BG_LIGHT,
			ACCENT_MIN_CONTRAST,
			-1,
		);
		const dark = reachContrast(hsl, PANEL_BG_DARK, ACCENT_MIN_CONTRAST, 1);

		const headerDark = reachContrast(
			{ ...hsl, l: Math.min(hsl.l, dark.l) * 0.75 },
			{ r: 255, g: 255, b: 255 },
			ACCENT_MIN_CONTRAST,
			-1,
		);

		const tint = (source, lightness, saturation) =>
			rgbToHex(hslToRgb({ h: source.h, s: source.s * saturation, l: lightness }));

		return {
			light: {
				accent: rgbToHex(hslToRgb(light)),
				accentRgb: Object.values(hslToRgb(light)).join(","),
				ink: readableInk(hslToRgb(light)),
				subtitleStage: tint(hsl, 0.82, 0.45),
			},
			dark: {
				accent: rgbToHex(hslToRgb(dark)),
				accentRgb: Object.values(hslToRgb(dark)).join(","),
				ink: readableInk(hslToRgb(dark)),
				headerBg: rgbToHex(hslToRgb(headerDark)),
				subtitleStage: tint(hsl, 0.65, 0.35),
			},
		};
	}
	// #endregion hnewhere-test-export

	const BUTTON_VARIANTS = {
		active: {
			background: ACCENT,
			// The accent is tuned for a light page; on a dark one the same value reads
			// muddy, so it lifts -- unlike the old orange, which carried itself on both.
			darkBackground: ACCENT_DARK,
			boxShadow: "0 1px 4px rgba(0,0,0,.25)",
			title: "Discussion found",
		},
		inactive: {
			background: "#b8b8b8",
			darkBackground: "#4a4a4a",
			boxShadow: "0 1px 3px rgba(0,0,0,.18)",
			title: "No discussion yet — click to submit this page",
		},
		setup: {
			background: "#b8b8b8",
			darkBackground: "#4a4a4a",
			boxShadow: "0 1px 3px rgba(0,0,0,.18)",
			title: "Choose where to read comments from",
		},
		checking: {
			background: "#b8b8b8",
			darkBackground: "#4a4a4a",
			boxShadow: "0 1px 3px rgba(0,0,0,.18)",
			title: "Checking for discussions…",
		},
	};

	const BUTTON_SPINNER_ID = "hnewhere-button-spinner";
	const BUTTON_PENDING_ID = "hn-checking-button";

	function startButtonSpinner(button) {
		if (!button || button.querySelector(`#${BUTTON_SPINNER_ID}`)) {
			return;
		}

		const ring = document.createElement("span");

		ring.id = BUTTON_SPINNER_ID;
		ring.setAttribute("aria-hidden", "true");
		ring.style.cssText = `
				position:absolute;
				inset:0;
				border-radius:inherit;
				padding:2px;
				overflow:hidden;
				-webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
				-webkit-mask-composite:xor;
				mask:linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
				pointer-events:none;
				opacity:0;
				transition:opacity .2s ease;
			`;

		const sweep = document.createElement("span");

		sweep.style.cssText = `
				position:absolute;
				inset:-50%;
				background:conic-gradient(from 0turn, rgba(255,255,255,0) 0 55%, rgba(255,255,255,.95) 100%);
			`;

		ring.appendChild(sweep);
		button.appendChild(ring);

		// Next frame, so the transition has a 0 to animate away from.
		requestAnimationFrame(() => {
			ring.style.opacity = "1";
		});

		if (prefersReducedMotion()) {
			return;
		}

		ring._hnewhereAnimation = sweep.animate(
			[{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
			{ duration: 900, iterations: Number.POSITIVE_INFINITY },
		);
	}

	function stopButtonSpinner(button) {
		const ring = button?.querySelector(`#${BUTTON_SPINNER_ID}`);

		if (!ring) {
			return;
		}

		ring.style.opacity = "0";

		window.setTimeout(() => {
			ring._hnewhereAnimation?.cancel();
			ring.remove();
		}, 220);
	}

	function pinButtonStyle(button, properties) {
		for (const [name, value] of Object.entries(properties)) {
			const property = name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

			if (value === null || value === undefined) {
				button.style.removeProperty(property);
				continue;
			}

			button.style.setProperty(property, String(value), "important");
		}
	}

	const BUTTON_STYLE_RESET = {
		margin: "0",
		border: "0",
		minWidth: "0",
		maxWidth: "none",
		minHeight: "0",
		maxHeight: "none",
		lineHeight: "1",
		letterSpacing: "normal",
		wordSpacing: "normal",
		textTransform: "none",
		textIndent: "0",
		textDecoration: "none",
		textAlign: "center",
		fontStyle: "normal",
		whiteSpace: "nowrap",
		boxSizing: "border-box",
		float: "none",
		visibility: "visible",
	};

	function applyButtonAppearance(button) {
		const size = buttonSizePreference;

		button.textContent = buttonMarkPreference;
		pinButtonStyle(button, {
			width: `${size}px`,
			height: `${size}px`,
			fontSize: `${buttonFontSizeFor(size)}px`,
			borderRadius:
				BUTTON_SHAPES[buttonShapePreference] || BUTTON_SHAPES.circle,
		});
	}

	async function refreshButtonAppearance() {
		for (const id of [
			"hn-restore-button",
			"hn-collapse-button",
			"hn-submit-button",
			"hn-setup-button",
		]) {
			const button = document.getElementById(id);

			if (!button) {
				continue;
			}

			applyButtonAppearance(button);

			if (!isMobile()) {
				await applyButtonPosition(button);
			}
		}
	}

	function setFloatingButtonVariant(button, variant) {
		const style = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.active;

		const dark = detectDarkMode();
		const background =
			variant === "active"
				? activeAccent(dark).accent
				: dark
					? style.darkBackground
					: style.background;

		button.dataset.hnewhereVariant = variant;
		pinButtonStyle(button, {
			background,
			color: readableInk(parseHexColor(background)),
			boxShadow: style.boxShadow,
		});
		button.title = style.title;
	}

	function applyButtonMobileStyle(button) {
		pinButtonStyle(button, {
			...BUTTON_STYLE_RESET,
			padding: "0",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: "white",
			top: "16px",
			right: "16px",
		});

		button.style.opacity = "1";

		applyButtonAppearance(button);

		// Re-asserted because this runs on every resize and would otherwise reset a
		// button that is deliberately showing the inactive colour.
		setFloatingButtonVariant(
			button,
			button.dataset.hnewhereVariant || "active",
		);
	}

	function createFloatingHNButton(id, variant = "active") {
		let button = document.getElementById(id);

		if (button) {
			button.textContent = buttonMarkPreference;
			return button;
		}

		button = document.getElementById(BUTTON_PENDING_ID);

		if (button) {
			button.id = id;
			button.textContent = buttonMarkPreference;
			setFloatingButtonVariant(button, variant);
			return button;
		}

		button = document.createElement("button");
		button.id = id;
		button.textContent = buttonMarkPreference;

		pinButtonStyle(button, {
			...BUTTON_STYLE_RESET,
			position: "fixed",
			top: "16px",
			right: "16px",
			zIndex: "2147483647",
			color: "white",
			padding: "0",
			fontFamily: "Verdana,sans-serif",
			fontWeight: "bold",
			cursor: "pointer",
			userSelect: "none",
			touchAction: "none",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			transition: "background .2s ease, box-shadow .2s ease",
			// So the fill overlay can be clipped to the circle.
			overflow: "hidden",
			isolation: "isolate",
		});

		button.style.setProperty(
			"-webkit-tap-highlight-color",
			"transparent",
			"important",
		);

		setFloatingButtonVariant(button, variant);

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
	// Submission helpers
	// -------------------------

	// #region hnewhere-test-export
	// The content's own name, which is what the panel shows once it reads more
	// than one source. og:title first because it is what the author wrote for
	// sharing, whereas document.title routinely carries a " | Site Name" tail.
	//
	// The hostname floor is load-bearing: it makes an empty header unreachable
	// rather than merely unlikely, and unlikely is not enough when a Bluesky
	// collective is honestly titled "" because nobody titled it.
	//
	// `doc` is a parameter for the same reason parseFrontPage takes one: it makes
	// the precedence testable without a live page.
	function pageTitle(doc = document) {
		const candidates = [
			doc.querySelector('meta[property="og:title"]')?.content,
			doc.querySelector('meta[name="twitter:title"]')?.content,
			doc.title,
			location.hostname,
		];

		for (const candidate of candidates) {
			const trimmed = (candidate || "").trim().replace(/\s+/g, " ");

			if (trimmed) {
				return trimmed;
			}
		}

		return "";
	}
	// #endregion hnewhere-test-export

	function suggestedSubmissionTitle() {
		return pageTitle().slice(0, HN_TITLE_LIMIT);
	}

	// -------------------------
	// Popup helpers
	// -------------------------

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

	// #region hnewhere-test-export
	function commentURL(storyID) {
		return HN_ORIGIN + "/item?id=" + storyID;
	}
	// #endregion hnewhere-test-export

	function submitURL(url, title) {
		return (
			HN_ORIGIN +
			"/submitlink?u=" +
			encodeURIComponent(url) +
			"&t=" +
			encodeURIComponent(title)
		);
	}

	// -------------------------
	// Bridge payloads
	// -------------------------

	function bridgeNonce() {
		return String(Date.now()) + Math.random().toString(36).slice(2, 10);
	}

	async function stageBridgePayload(nonce, payload) {
		await save(BRIDGE_PAYLOAD_PREFIX + nonce, {
			...payload,
			ts: Date.now(),
		});
	}

	async function readBridgePayload(nonce) {
		const stored = await load(BRIDGE_PAYLOAD_PREFIX + nonce, null);

		if (!stored || typeof stored !== "object") {
			return null;
		}

		if (Number.isFinite(stored.ts) && Date.now() - stored.ts > BRIDGE_PAYLOAD_TTL) {
			await save(BRIDGE_PAYLOAD_PREFIX + nonce, null);
			return null;
		}

		return stored;
	}

	async function clearBridgePayload(nonce) {
		await save(BRIDGE_PAYLOAD_PREFIX + nonce, null);
	}

	async function sweepBridgePayloads() {
		const index = await load(BRIDGE_PAYLOAD_PREFIX + "index", []);

		if (!Array.isArray(index) || !index.length) {
			return;
		}

		const now = Date.now();
		const kept = [];

		for (const entry of index) {
			if (!entry?.nonce) {
				continue;
			}

			if (Number.isFinite(entry.ts) && now - entry.ts > BRIDGE_PAYLOAD_TTL) {
				await save(BRIDGE_PAYLOAD_PREFIX + entry.nonce, null);
				continue;
			}

			kept.push(entry);
		}

		if (kept.length !== index.length) {
			await save(BRIDGE_PAYLOAD_PREFIX + "index", kept);
		}
	}

	async function indexBridgePayload(nonce) {
		const index = await load(BRIDGE_PAYLOAD_PREFIX + "index", []);
		const next = Array.isArray(index) ? [...index] : [];

		next.push({ nonce, ts: Date.now() });
		await save(BRIDGE_PAYLOAD_PREFIX + "index", next);
	}

	// #region hnewhere-test-export

	// The fragment the sidebar attaches when it opens a bridge popup. An action
	// names any extra keys it carries there.
	function parseBridgeHash(marker, fields = [], hash = location.hash) {
		const raw = hash.replace(/^#/, "");

		if (!raw) {
			return null;
		}

		const params = new URLSearchParams(raw);

		if (params.get(marker) !== "1") {
			return null;
		}

		const nonce = params.get("nonce");

		if (!nonce) {
			return null;
		}

		const payload = {
			nonce,
			origin: params.get("origin"),
			storyID: params.get("story"),
		};

		for (const field of fields) {
			payload[field] = params.get(field);
		}

		return payload;
	}

	function bridgeHash(action, nonce, values = {}, origin = location.origin) {
		const hash = new URLSearchParams();

		hash.set(action.marker, "1");
		hash.set("nonce", nonce);
		hash.set("origin", origin);

		for (const [key, value] of Object.entries(values)) {
			if (value !== null && value !== undefined && value !== "") {
				hash.set(key, String(value));
			}
		}

		return hash.toString();
	}

	// #endregion hnewhere-test-export

	function postBridgeResult(source, payload, result) {
		if (!window.opener) {
			return;
		}

		try {
			window.opener.postMessage(
				{
					source,
					nonce: payload.nonce,
					...result,
				},
				payload.origin || "*",
			);
		} catch (error) {
			console.error("Failed posting bridge result:", error);
		}
	}

	// One-shot listener per bridge kind, resolving whichever request matches the
	// nonce the popup reports back. Modelled on setupItemActionListener.
	function createBridgeChannel(source) {
		const pending = new Map();
		let installed = false;

		const install = () => {
			if (installed) {
				return;
			}

			installed = true;
			window.addEventListener("message", (event) => {
				const data = event.data;

				if (!data || data.source !== source || !data.nonce) {
					return;
				}

				const request = pending.get(data.nonce);

				// Checked against the popup this nonce was opened for: each source
				// answers from its own origin.
				if (!request || event.origin !== request.origin) {
					return;
				}

				clearTimeout(request.timeoutId);
				pending.delete(data.nonce);

				try {
					request.popup?.close();
				} catch {}

				request.resolve(data);
			});
		};

		return function openBridge(
			nonce,
			{ origin = HN_ORIGIN, timeout = 60000, features } = {},
		) {
			install();

			const popup = window.open(
				"about:blank",
				source + "_" + nonce,
				features || "width=760,height=680,resizable=yes,scrollbars=yes",
			);

			if (!popup) {
				return {
					blocked: true,
					result: Promise.resolve({ ok: false, reason: "popup-blocked" }),
					navigate() {},
				};
			}

			const result = new Promise((resolve) => {
				const timeoutId = window.setTimeout(() => {
					pending.delete(nonce);
					resolve({ ok: false, reason: "timeout" });
				}, timeout);

				pending.set(nonce, { resolve, timeoutId, popup, origin });
			});

			return {
				blocked: false,
				result,
				navigate(url) {
					// about:blank inherits this origin, so assigning location is allowed
					// even though the destination is cross-origin.
					try {
						popup.location = url;
					} catch (error) {
						console.error("HNewhere: could not navigate bridge popup", error);
					}
				},
			};
		};
	}

	// -------------------------
	// Write bridges
	// -------------------------

	const WRITE_BRIDGES = new Map();

	function registerWriteBridge(bridge) {
		WRITE_BRIDGES.set(bridge.id, bridge);
	}

	function getWriteBridge(id) {
		return WRITE_BRIDGES.get(id) || null;
	}

	function writeBridges() {
		return [...WRITE_BRIDGES.values()];
	}

	function isWriteBridgeOrigin(origin) {
		return writeBridges().some((bridge) => bridge.origin === origin);
	}

	// #region hnewhere-test-export

	// What an action returns when the answer arrives on a later page load rather
	// than from this one.
	const BRIDGE_NAVIGATED = { navigated: true };

	function writeBridgeForHost(bridges, hostname) {
		return (
			bridges.find((bridge) => bridge?.hosts?.includes(hostname)) || null
		);
	}

	function stageBridgeReload(key, payload) {
		try {
			window.sessionStorage.setItem(key, JSON.stringify(payload));
			return true;
		} catch (error) {
			console.error("HNewhere: could not stage bridge payload", error);
			return false;
		}
	}

	function clearBridgeReload(key) {
		try {
			window.sessionStorage.removeItem(key);
		} catch {}
	}

	// Cleared before parsing, so a payload that cannot be read does not make every
	// later page load try to report again.
	function takeBridgeReload(key) {
		let stored = null;

		try {
			stored = window.sessionStorage.getItem(key);
			window.sessionStorage.removeItem(key);
		} catch {
			return null;
		}

		if (!stored) {
			return null;
		}

		try {
			const payload = JSON.parse(stored);

			return payload?.nonce ? payload : null;
		} catch {
			return null;
		}
	}

	// Leaves a readable payload staged, for a write whose landing page is not the
	// one it passes through first. Unreadable payloads are still dropped.
	function peekBridgeReload(key) {
		let stored = null;

		try {
			stored = window.sessionStorage.getItem(key);
		} catch {
			return null;
		}

		if (!stored) {
			return null;
		}

		try {
			const payload = JSON.parse(stored);

			if (payload?.nonce) {
				return payload;
			}
		} catch {}

		clearBridgeReload(key);
		return null;
	}

	// The seam. A refusal is a result the sidebar is told about, not a throw.
	async function runWriteAction(action, { payload, staged, root }) {
		if (action.requiresDraft && !staged?.text) {
			return { ok: false, reason: "draft-missing" };
		}

		try {
			return await action.act({ payload, staged, root });
		} catch (error) {
			console.error("HNewhere: write bridge action failed", error);
			return { ok: false, reason: "bridge-failed" };
		}
	}

	// #endregion hnewhere-test-export

	// Fields an action echoes back on every result, so the sidebar knows which
	// control the answer belongs to.
	function postWriteResult(action, payload, result) {
		postBridgeResult(action.messageSource, payload, {
			...action.echo?.(payload),
			...result,
		});
	}

	async function dispatchWriteAction(action, root = document) {
		const payload = parseBridgeHash(action.marker, action.fields);

		if (!payload || action.accepts?.(payload) === false) {
			return false;
		}

		const staged = action.stagesDraft
			? await readBridgePayload(payload.nonce)
			: null;
		const result = await runWriteAction(action, { payload, staged, root });

		if (result !== BRIDGE_NAVIGATED) {
			postWriteResult(action, payload, result);

			if (action.closeAfter) {
				window.setTimeout(() => window.close(), action.closeAfter);
			}
		}

		return true;
	}

	function reportWriteAction(action, root = document) {
		const reported = action.report?.(root);

		if (!reported) {
			return false;
		}

		postWriteResult(action, reported.payload, reported.result);
		window.setTimeout(() => window.close(), 60);
		return true;
	}

	function reportWriteBridge(bridge, root = document) {
		for (const action of Object.values(bridge?.actions || {})) {
			if (reportWriteAction(action, root)) {
				return true;
			}
		}

		return false;
	}

	async function dispatchWriteBridge(bridge, root = document) {
		for (const action of Object.values(bridge?.actions || {})) {
			if (await dispatchWriteAction(action, root)) {
				return true;
			}
		}

		return false;
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
			if (entry.state === "none") {
				if (entry.upHidden && !entry.downHidden) {
					entry.state = "up";
				} else if (entry.downHidden && !entry.upHidden) {
					entry.state = "down";
				} else if (entry.upHidden && entry.downHidden) {
					entry.state = "up";
				}
			}

			if (entry.state !== "none" && !entry.unUrl) {
				entry.unUrl = deriveUnvoteURL(entry.upUrl || entry.downUrl);
			}

			// Kept off the shape cloneVoteInfo copies, but tidy up regardless.
			delete entry.upHidden;
			delete entry.downHidden;
		}

		return voteLinks;
	}

	function extractScoreFromRoot(root, itemId) {
		const element = root.querySelector(`[id="score_${String(itemId)}"]`);

		if (!element) {
			return null;
		}

		const match = /-?\d+/.exec(element.textContent || "");

		return match ? Number(match[0]) : null;
	}

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

			if (!url.searchParams.get("auth")) {
				return null;
			}

			url.searchParams.set("how", "un");
			return url.href;
		} catch {
			return null;
		}
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

	// #region hnewhere-test-export
	function voteFailureMessage(result, sourceLabel = "the source") {
		switch (result?.reason) {
			case "popup-blocked":
				return "Your browser blocked the popup. Allow popups for this site and try again.";
			case "timeout":
				return `${sourceLabel} did not respond in time.`;
			case "not-logged-in":
			case "awaiting-sign-in":
				return `Sign in to ${sourceLabel} to vote.`;
			case "action-unavailable":
				return `${sourceLabel} is not offering that vote here.`;
			case "rate-limited":
				return `${sourceLabel} is rate limiting votes. Wait a moment and try again.`;
			default:
				return result?.message || "That vote did not go through.";
		}
	}
	// #endregion hnewhere-test-export

	function voteStatusSlots(itemId) {
		const escapedId = CSS.escape(String(itemId));

		return (
			sidebarUI?.body?.querySelectorAll(
				`.story-vote-status[data-vote-status-id="${escapedId}"],` +
					`.comment-vote-status[data-vote-status-id="${escapedId}"]`,
			) || []
		);
	}

	// The slot the unvote link uses, so what went wrong lands beside the item it
	// belongs to.
	function showVoteMessage(itemId, message, action = null) {
		voteStatusSlots(itemId).forEach((element) => {
			element.replaceChildren();

			if (!message) {
				return;
			}

			element.appendChild(document.createTextNode(" | "));

			const note = document.createElement("span");

			note.className = "vote-note";
			note.textContent = message;
			element.appendChild(note);

			if (!action) {
				return;
			}

			const button = document.createElement("button");

			button.type = "button";
			button.className = "vote-unvote-link";
			button.textContent = action.label;
			button.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				action.onPress();
			};

			element.appendChild(document.createTextNode(" "));
			element.appendChild(button);
		});
	}

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

			if (previousVoteInfo) {
				merged.upUrl = previousVoteInfo.upUrl;
				merged.downUrl = previousVoteInfo.downUrl;
			}

			nextVoteLinks.set(String(itemId), merged);
		} else {
			nextVoteLinks.delete(String(itemId));
		}

		voteLinkCache.set(cacheKey, nextVoteLinks);

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

	function voteDescriptorsFor(sourceID, voteInfo) {
		const action = getWriteBridge(sourceID)?.actions?.vote;

		return action?.descriptors
			? action.descriptors(voteInfo, getSource(sourceID)?.label || "the source")
			: [];
	}

	// A source with nothing to scrape has only what the reader did last.
	async function loadVoteState(sourceID, storyID) {
		const action = getWriteBridge(sourceID)?.actions?.vote;

		if (action?.voteLinks) {
			return await action.voteLinks(storyID);
		}

		const map = new Map();

		for (const [itemId, record] of Object.entries(rememberedVotes)) {
			map.set(itemId, cloneVoteInfo(record));
		}

		return map;
	}

	// #region hnewhere-test-export

	// HN hides the arrows entirely once you have voted; the unvote link in the
	// byline becomes the only control.
	function hnVoteDescriptors(voteInfo, label) {
		if (!voteInfo || voteInfo.state === "up" || voteInfo.state === "down") {
			return [];
		}

		const descriptors = [];

		if (voteInfo.upUrl) {
			descriptors.push({
				label: "▲",
				title: "Upvote on " + label,
				action: "up",
				url: voteInfo.upUrl,
				active: false,
				variant: "up",
			});
		}

		if (voteInfo.downUrl) {
			descriptors.push({
				label: "▼",
				title: "Downvote on " + label,
				action: "down",
				url: voteInfo.downUrl,
				active: false,
				variant: "down",
			});
		}

		if (!descriptors.length && voteInfo.unUrl) {
			descriptors.push({
				label: "↺",
				title: "Remove vote on " + label,
				action: "un",
				url: voteInfo.unUrl,
				active: true,
				variant: "neutral",
			});
		}

		return descriptors;
	}

	// A three-state toggle with no link behind it: the arrows stay, the one that is
	// active shows it, and pressing it again clears the vote.
	function buttonVoteDescriptors(voteInfo, label) {
		const state = voteInfo?.state || "none";

		return [
			{
				label: "▲",
				title: (state === "up" ? "Remove upvote on " : "Upvote on ") + label,
				action: state === "up" ? "un" : "up",
				url: null,
				active: state === "up",
				variant: "up",
			},
			{
				label: "▼",
				title:
					(state === "down" ? "Remove downvote on " : "Downvote on ") + label,
				action: state === "down" ? "un" : "down",
				url: null,
				active: state === "down",
				variant: "down",
			},
		];
	}

	// #endregion hnewhere-test-export

	function itemActionPageURL(voteAction, { storyID, itemId, action, voteURL, nonce }) {
		return (
			voteAction.url({ storyID, itemId }) +
			"#" +
			bridgeHash(voteAction, nonce, {
				story: storyID,
				item: itemId,
				action,
				voteURL,
			})
		);
	}

	function setupItemActionListener() {
		if (window.__hnewhereItemActionListenerInstalled) {
			return;
		}

		window.__hnewhereItemActionListenerInstalled = true;
		window.addEventListener("message", (event) => {
			// Any source this script writes to, rather than one fixed site.
			if (!isWriteBridgeOrigin(event.origin)) {
				return;
			}

			const data = event.data;

			if (!data || data.source !== ITEM_ACTION_BRIDGE_MESSAGE_SOURCE || !data.nonce) {
				return;
			}

			if (data.storyID && data.itemId && data.voteInfo) {
				rememberVote(data.itemId, data.voteInfo);
				setVoteInfoForStoryItem(
					data.storyID,
					data.itemId,
					data.voteInfo,
					data.score,
				);
			}

			if (data.itemId && ITEM_ACTION_PATHS[data.action]) {
				const field = data.action.endsWith("fave") ? "favorite" : "flagged";

				if (data.reason === "action-unavailable") {
					rememberItemActionUnavailable(field);
					refreshAllItemActionControls();
					return;
				}

				if (typeof data.applied === "boolean") {
					rememberItemAction(data.itemId, { [field]: data.applied });

					clearItemActionUnavailable(field);
				}

				refreshItemActionControls(data.itemId);
			}

			const pending = itemActionRequests.get(data.nonce);

			if (!pending) {
				return;
			}

			clearTimeout(pending.timeoutId);
			itemActionRequests.delete(data.nonce);

			try {
				pending.popup?.close();
			} catch {}

			pending.resolve(data);
		});
	}

	function openItemActionPopup(sourceID, storyID, itemId, action, voteURL) {
		const bridge = getWriteBridge(sourceID);
		const voteAction = bridge?.actions?.vote;

		if (!voteAction) {
			return Promise.resolve({ ok: false, reason: "no-bridge" });
		}

		setupItemActionListener();

		return new Promise((resolve) => {
			const nonce = bridgeNonce();
			const popup = window.open(
				itemActionPageURL(voteAction, {
					storyID,
					itemId,
					action,
					voteURL,
					nonce,
				}),
				"hnewhere_vote_bridge_" + nonce,
				"width=420,height=320,resizable=yes,scrollbars=yes",
			);

			if (!popup) {
				resolve({ ok: false, reason: "popup-blocked" });
				return;
			}

			const timeoutId = window.setTimeout(() => {
				itemActionRequests.delete(nonce);
				resolve({ ok: false, reason: "timeout" });
			}, 12000);

			itemActionRequests.set(nonce, {
				resolve,
				timeoutId,
				popup,
				origin: bridge.origin,
			});
		});
	}

	async function submitVote(
		sourceID,
		storyID,
		itemId,
		descriptor,
		container,
		{ force = false } = {},
	) {
		if (!container || container.dataset.votePending === "1") {
			return;
		}

		// force never consults the verdict, so a stale one costs a second press
		// rather than stranding a reader who signed in elsewhere.
		if (!force && shouldAskToSignIn(await readAuthVerdict(sourceID), Date.now())) {
			showVoteMessage(
				itemId,
				`Sign in to ${getSource(sourceID)?.label || "the source"} to vote.`,
				{
					label: "sign in and vote",
					onPress: () =>
						submitVote(sourceID, storyID, itemId, descriptor, container, {
							force: true,
						}),
				},
			);
			return;
		}

		container.dataset.votePending = "1";
		container.classList.add("vote-controls-pending");
		container.querySelectorAll(".vote-button").forEach((button) => {
			button.disabled = true;
		});

		try {
			const result = await openItemActionPopup(
				sourceID,
				storyID,
				itemId,
				descriptor.action,
				descriptor.url,
			);

			if (result?.storyID && result?.itemId && result?.voteInfo) {
				setVoteInfoForStoryItem(result.storyID, result.itemId, result.voteInfo);
			}

			if (!result?.ok) {
				showVoteMessage(
					itemId,
					voteFailureMessage(result, getSource(sourceID)?.label || "the source"),
				);
			}

			await rememberAuthFromResult(sourceID, result);
		} finally {
			delete container.dataset.votePending;
			container.classList.remove("vote-controls-pending");
			container.querySelectorAll(".vote-button").forEach((button) => {
				button.disabled = false;
			});
		}
	}

	// -------------------------
	// Whether a reader can act
	// -------------------------

	const AUTH_PREFIX = "HNewhere:auth:";

	// #region hnewhere-test-export

	const AUTH_TTL = { out: 3 * 60 * 1000, in: 12 * 60 * 60 * 1000 };

	function verdictFromResult(result) {
		if (result?.ok) {
			return "in";
		}

		if (
			result?.reason === "not-logged-in" ||
			result?.reason === "awaiting-sign-in"
		) {
			return "out";
		}

		return null;
	}

	function authVerdictUsable(verdict, now) {
		if (!verdict?.state || !Number.isFinite(verdict.at)) {
			return false;
		}

		return now - verdict.at < (AUTH_TTL[verdict.state] ?? 0);
	}

	function shouldAskToSignIn(verdict, now) {
		return verdict?.state === "out" && authVerdictUsable(verdict, now);
	}

	// #endregion hnewhere-test-export

	function readAuthVerdict(sourceID) {
		return load(AUTH_PREFIX + sourceID, null);
	}

	async function rememberAuthFromResult(sourceID, result) {
		const state = verdictFromResult(result);

		if (state) {
			await save(AUTH_PREFIX + sourceID, { state, at: Date.now() });
		}
	}

	function renderVoteControls(container, storyID, itemId, voteInfo) {
		if (!container) {
			return;
		}

		// Read off the container the markup carries, so the chain from render to
		// popup never has to guess which source these controls belong to.
		const sourceID = container.dataset.hnVoteSource;

		container.replaceChildren();

		const descriptors = voteDescriptorsFor(sourceID, voteInfo);
		const state = voteInfo?.state;

		// Only offer the link when there is a URL behind it, so it never renders
		// as something that looks clickable but does nothing.
		updateVoteStatus(itemId, voteInfo?.unUrl ? state : null, () => {
			submitVote(
				sourceID,
				storyID,
				itemId,
				{ action: "un", url: voteInfo.unUrl },
				container,
			);
		});

		if (!descriptors.length) {
			container.classList.add("hidden");
			return;
		}

		container.classList.remove("hidden");

		container.classList.add("vote-controls-arriving");
		requestAnimationFrame(() => {
			container.classList.remove("vote-controls-arriving");
		});

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
				await submitVote(sourceID, storyID, itemId, descriptor, container);
			};

			container.appendChild(button);
		}
	}

	function hydrateItemActionsForRoot() {
		refreshAllItemActionControls();
	}

	function hydrateVoteControlsForStory(storyID, voteLinks = new Map()) {
		hydrateItemActionsForRoot();

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

	const BUTTON_EDGE_MARGIN = 4;

	function buttonBounds(button) {
		const doc = document.documentElement;
		const width = doc.clientWidth || window.innerWidth;
		const height = doc.clientHeight || window.innerHeight;

		return {
			minX: BUTTON_EDGE_MARGIN,
			minY: BUTTON_EDGE_MARGIN,
			// Never negative: a button wider than the viewport clamps to the margin
			// rather than to a max below its min, which would pin it off-screen left.
			maxX: Math.max(
				BUTTON_EDGE_MARGIN,
				width - button.offsetWidth - BUTTON_EDGE_MARGIN,
			),
			maxY: Math.max(
				BUTTON_EDGE_MARGIN,
				height - button.offsetHeight - BUTTON_EDGE_MARGIN,
			),
		};
	}

	function clampButtonToViewport(button, x, y) {
		const bounds = buttonBounds(button);

		return {
			x: Math.min(Math.max(x, bounds.minX), bounds.maxX),
			y: Math.min(Math.max(y, bounds.minY), bounds.maxY),
		};
	}

	async function applyButtonPosition(button) {
		const saved = await load(STORAGE.position, null);

		if (!saved) return;

		const { x, y } = clampButtonToViewport(button, saved.x, saved.y);

		pinButtonStyle(button, { left: x + "px", top: y + "px", right: "auto" });
	}

	// Anything anchored to the button -- currently the submit popover -- listens for
	// this rather than reaching into the drag state, so the two stay independent.
	const BUTTON_MOVE_EVENT = "hnewhere:buttonmove";

	function makeButtonDraggable(button) {
		let dragging = false;
		let moved = false;
		let suppressClick = false;
		let startX = 0;
		let startY = 0;
		let startLeft = 0;
		let startTop = 0;

		const notifyMoved = () => {
			button.dispatchEvent(new CustomEvent(BUTTON_MOVE_EVENT));
		};

		const clampPosition = () => {
			const { x, y } = clampButtonToViewport(
				button,
				button.offsetLeft,
				button.offsetTop,
			);

			pinButtonStyle(button, { left: x + "px", top: y + "px", right: "auto" });
			notifyMoved();
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

			// Same bounds as every other clamp: the visible viewport, not
			// window.innerWidth, so a drag cannot park the button under a scrollbar.
			const { x, y } = clampButtonToViewport(
				button,
				startLeft + deltaX,
				startTop + deltaY,
			);

			pinButtonStyle(button, { left: x + "px", top: y + "px", right: "auto" });
			notifyMoved();
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

	function isBrowsing(ui) {
		return Boolean(
			ui?.shadow?.querySelector("#panel")?.classList.contains("browsing"),
		);
	}

	// The panel wears both classes while the form is up, so isBrowsing alone cannot
	// tell the front page from the form standing on it.
	function isSubmitting(ui) {
		return Boolean(
			ui?.shadow?.querySelector("#panel")?.classList.contains("submitting"),
		);
	}

	let discussionScrollTop = 0;

	// Matches the .16s the two views transition over, so the outgoing one is gone
	// before the swap rather than being cut off partway down.
	const VIEW_SWAP_FADE_MS = 160;

	async function setSubmitMode(ui, on) {
		const panel = ui?.shadow?.querySelector("#panel");
		const view = ui?.shadow?.querySelector("#submit-view");

		if (!panel || !view) {
			return;
		}

		if (!on) {
			panel.classList.remove("submitting");
			view.replaceChildren();

			return;
		}

		const settings = await loadSettings();
		const submitTarget = submitTargetFor(settings);

		view.innerHTML = submitFormHTML({
			submitTarget,
			message: submitTarget ? "" : unsubmittableMessage(settings),
		});

		panel.classList.add("submitting");
		setWordmarkLocation(ui, "Submit");

		wireSubmitForm(view, {
			submitTarget,
			onCancel: () => {
				setSubmitMode(ui, false).catch(console.error);
				setBrowseMode(ui, true);
			},
			onSubmit: async (fields, form) => {
				const result = await submitPageThroughBridge(submitTarget.id, fields);

				if (!result?.ok) {
					form.setStatus(
						submitFailureMessage(result, submitTarget.label),
						{ error: true },
					);

					return;
				}

				form.setStatus(
					result.storyID
						? `Submitted. <a href="${escapeHTML(HN_ORIGIN)}/item?id=${encodeURIComponent(
								result.storyID,
							)}" target="_blank" rel="noopener noreferrer">See the discussion</a>`
						: `Submitted. <a href="${escapeHTML(
								HN_ORIGIN,
							)}/newest" target="_blank" rel="noopener noreferrer">See it on HN</a>`,
					{ html: true },
				);
			},
		});
	}

	function setBrowseMode(ui, on, options = {}) {
		const panel = ui?.shadow?.querySelector("#panel");
		const toggle = ui?.shadow?.querySelector("#browse-toggle");
		const comments = ui?.shadow?.querySelector("#comments");

		if (!panel || !toggle) {
			return;
		}

		if (on && !frontPageAvailable && !queueHasItems) {
			return;
		}

		if (on && comments) {
			discussionScrollTop = comments.scrollTop;
		}

		if (on) {
			browseTab =
				options.tab ||
				(queueHasItems || !frontPageAvailable ? "queue" : "front");
		}

		const swap = () => {
			panel.classList.toggle("browsing", on);
			toggle.title = on ? "Back to this page's discussion" : browseLabel();

			panel.classList.remove("submitting");
			ui?.shadow?.querySelector("#submit-view")?.replaceChildren();

			if (!on) {
				setWordmarkLocation(ui, sidebarHasDiscussion ? "Discussion" : "");
			}

			if (on) {
				ui?.shadow?.querySelector(".browse-tabs")?.classList.remove("is-ready");
			}

			if (comments) {
				comments.scrollTop = on ? 0 : discussionScrollTop;
			}

			if (on) {
				renderBrowseView(ui).catch(console.error);
			}
		};

		// animate:false is for a panel that is not on screen yet. Cross-fading two
		// views nobody can see would only delay the one they are about to.
		if (!comments || options.animate === false || prefersReducedMotion()) {
			swap();
			return;
		}

		crossFadeCommentsView(comments, swap);
	}

	function crossFadeCommentsView(comments, swap) {
		if (comments._hnewhereSwapTimer) {
			clearTimeout(comments._hnewhereSwapTimer);
		}

		comments.classList.add("views-swapping");
		comments._hnewhereSwapTimer = window.setTimeout(() => {
			swap();
			requestAnimationFrame(() => {
				comments.classList.remove("views-swapping");
				comments._hnewhereSwapTimer = null;
			});
		}, VIEW_SWAP_FADE_MS);
	}

	function openStoryFromRow(story, event, { openPanel = false } = {}) {
		const record = save(STORAGE.last, {
			url: story.url,
			source: story.source || "hn",
			ids: [String(story.id)],
			timestamp: Date.now(),
			// Only ever true, never written false: an absent flag is a title click,
			// and a record written by an older version has none.
			...(openPanel ? { openPanel: true } : {}),
		});

		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}

		event.preventDefault();

		// Navigates either way. A storage error is not a reason to refuse to open
		// the article -- it costs the arrival, not the click.
		record.catch(() => {}).then(() => {
			location.href = story.url;
		});
	}

	function renderBrowseRow(story, container, rank, options = {}) {
		const discussions = [story, ...(options.also || [])];
		const totalComments = discussions.reduce(
			(sum, each) => sum + (each.descendants || 0),
			0,
		);
		const totalText = escapeHTML(pluralize(totalComments, "comment"));

		const commentTotal = `<a class="browse-comments-total" href="${escapeHTML(story.url)}"
	title="Go to the page and read what was said about it">${totalText}<span class="browse-comments-floor" aria-hidden="true">+</span></a>`;

		const actions =
			!story.source || getSource(story.source)?.capabilities?.vote
				? itemActionLinksHTML(story.id, story.source || "hn")
				: "";

		const meta = `${escapeHTML(pluralize(story.score, "point"))}${story.by ? ` by ${escapeHTML(story.by)}` : ""}
	<span class="item-age">${escapeHTML(timeAgo(story.time))}</span>
	|
	<button class="browse-save-link" type="button">queue</button>
	${actions}
	|
	${commentTotal}`;

		const row = document.createElement("div");
		row.className = "story browse-row";
		row.dataset.storyId = String(story.id);
		row.innerHTML = `
	<div class="browse-rank">${rank}.</div>
	<div class="browse-main">
	<div class="story-title">
	<a class="browse-title-link" href="${escapeHTML(story.url)}">${escapeHTML(story.title)}</a>
	${story.site ? `<span class="browse-site">(${escapeHTML(story.site)})</span>` : ""}
	</div>
	<div class="story-meta">
	${meta}
	</div>
	</div>
	`;

		// Wired per row rather than delegated, because the row is built here and
		// thrown away whole, so there is nothing to keep in step.
		const total = row.querySelector(".browse-comments-total");

		if (total) {
			total.onclick = (event) => {
				event.stopPropagation();
				openStoryFromRow(story, event, { openPanel: true });
			};
		}

		const saveButton = row.querySelector(".browse-save-link");

		{
			const queuedLabel = options.inQueue ? "remove" : "queued";

			const key = queueKey(story);

			// Read once per row rather than passed in, so a row rendered after
			// something was queued elsewhere still opens in the right state.
			loadQueue()
				.then((entries) => {
					saveButton.textContent = entries.some((e) => queueKey(e) === key)
						? queuedLabel
						: "queue";
				})
				.catch(console.error);

			saveButton.onclick = async () => {
				const entries = await loadQueue();
				const already = entries.some((e) => queueKey(e) === key);

				await saveQueue(
					already
						? removeFromQueue(entries, key)
						: addToQueue(entries, story, Date.now()),
				);

				saveButton.textContent = already ? "queue" : queuedLabel;

				if (already && row.parentElement?.closest("#browse-list") && browseTab === "queue") {
					row.remove();
				}

				refreshQueueCount(container.getRootNode());
				refreshNextUp(container.getRootNode());
			};
		}

		row.querySelector(".browse-title-link").onclick = (event) =>
			openStoryFromRow(story, event);

		container.appendChild(row);
		return row;
	}

	let queueHasItems = false;
	let frontPageAvailable = true;

	function browseLabel() {
		return frontPageAvailable ? "front pages and your queue" : "Your queue";
	}

	// Submitting is for a page nobody has posted yet. Once any enabled source has a
	// discussion the reader can already join it, and which source it landed on is
	// not their problem -- so the offer to post it somewhere else goes away.
	async function refreshSubmitAffordance(root) {
		const button = root?.querySelector?.("#header-submit");

		if (button) {
			button.hidden =
				!submitTargetFor(await loadSettings()) || sidebarHasDiscussion;
		}
	}

	async function refreshBrowseAffordances(root) {
		const frontTab = root?.querySelector?.("#browse-tab-front");
		const wordmark = root?.querySelector?.("#browse-toggle");

		if (!frontTab && !wordmark) {
			return;
		}

		const settings = await loadSettings();
		frontPageAvailable = frontPageSourceIds(settings).length > 0;

		if (frontTab) {
			frontTab.hidden = !frontPageAvailable;
		}

		if (wordmark) {
			wordmark.hidden = !frontPageAvailable && !queueHasItems;

			// Only while the panel is showing this page's discussion. In browse mode
			// the title is the way back out, and setBrowseMode owns it.
			if (!isBrowsing({ shadow: root })) {
				wordmark.title = browseLabel();
			}
		}

		if (!frontPageAvailable && browseTab === "front" && sidebarUI) {
			if (queueHasItems) {
				renderBrowseView(sidebarUI, { tab: "queue" }).catch(console.error);
			} else {
				setBrowseMode(sidebarUI, false);
			}
		}
	}

	// The count belongs on the tab, so saving anywhere has to reach it. Takes a root
	// rather than the ui object, because a browse row only knows the tree it is in.
	async function refreshQueueCount(root) {
		const tab = root?.querySelector?.("#browse-tab-queue");

		if (!tab) {
			return;
		}

		const entries = await loadQueue();
		const unread = unreadQueueCount(entries);

		queueHasItems = entries.length > 0;

		if (queueHasItems) {
			tab.textContent = unread ? `queue (${unread})` : "queue";

			tab.style.setProperty("--queue-tab-width", tab.scrollWidth + "px");
		}

		tab.classList.toggle("is-collapsed", !queueHasItems);
		tab.setAttribute("aria-hidden", String(!queueHasItems));
		tab.tabIndex = queueHasItems ? 0 : -1;

		// Next frame, so this pass paints in whatever state it found and only what
		// happens after it moves. setBrowseMode clears it again on the way in.
		const tabs = tab.parentElement;

		if (tabs && !tabs.classList.contains("is-ready")) {
			requestAnimationFrame(() => tabs.classList.add("is-ready"));
		}

		await refreshBrowseAffordances(root);

		if (!queueHasItems && browseTab === "queue" && sidebarUI) {
			if (frontPageAvailable) {
				renderBrowseView(sidebarUI, { tab: "front" }).catch(console.error);
			} else {
				setBrowseMode(sidebarUI, false);
			}
		}
	}

	let browsePage = 1;
	let browseTab = "front";

	// HN numbers its rows continuously across pages -- page 2 starts at 31 -- and
	// the rank is only useful if it says the same thing.
	const FRONT_PAGE_SIZE = 30;

	function renderBrowseNav(view, { page, nextPage }, onNavigate) {
		const nav = document.createElement("div");
		nav.className = "browse-nav";

		const link = (text, target, disabled = false) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "browse-nav-link";
			button.textContent = text;
			button.disabled = disabled;
			button.onclick = () => onNavigate(target);
			return button;
		};

		if (page <= 1) {
			if (nextPage) {
				nav.appendChild(link("More", nextPage));
				view.appendChild(nav);
			}

			return;
		}

		const label = document.createElement("span");
		label.className = "browse-nav-page";
		label.textContent = "page " + page;

		nav.append(
			link("‹ prev", page - 1),
			label,
			link("next ›", nextPage, !nextPage),
		);
		view.appendChild(nav);
	}

	async function refreshNextUp(root) {
		const strip = root?.querySelector?.("#next-up");

		if (!strip) {
			return;
		}

		const entries = await loadQueue();
		const next = nextUnreadInQueue(entries);

		if (!next) {
			strip.classList.add("hidden");
			strip.replaceChildren();
			return;
		}

		const remaining = unreadQueueCount(entries);

		const label = document.createElement("span");
		label.className = "next-up-label";
		label.textContent = "Next in queue ›";

		const title = document.createElement("a");
		title.className = "next-up-title";
		title.href = next.url;
		title.textContent = next.title;

		const count = document.createElement("span");
		count.className = "next-up-count";
		count.textContent = pluralize(remaining, "left", "left");

		title.onclick = (event) => {
			const record = save(STORAGE.last, {
				url: next.url,
				source: next.source || "hn",
				ids: [String(next.id)],
				timestamp: Date.now(),
			});

			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}

			event.preventDefault();
			record.catch(() => {}).then(() => {
				location.href = next.url;
			});
		};

		const row = document.createElement("div");
		row.className = "next-up-row";
		row.append(label, title, count);

		strip.replaceChildren(row);
		strip.classList.remove("hidden");
	}

	let sidebarHasDiscussion = true;

	function renderNoDiscussion(ui) {
		const body = ui?.body;

		if (!body) {
			return;
		}

		body.replaceChildren();

		const message = document.createElement("div");
		message.className = "browse-empty no-discussion";
		message.textContent =
			"No discussion found for this page yet. Minimize to submit it, or read something else.";

		body.appendChild(message);
	}

	const PANEL_ENTER_MS = 180;

	function slidePanelIn(ui) {
		const panel = ui?.shadow?.querySelector("#panel");

		if (!panel || prefersReducedMotion() || typeof panel.animate !== "function") {
			return;
		}

		panel.animate(
			[
				{ transform: "translateX(100%)", opacity: 0 },
				{ transform: "none", opacity: 1 },
			],
			{ duration: PANEL_ENTER_MS, easing: "ease" },
		);
	}

	// #region hnewhere-test-export
	function setWordmarkLocation(ui, label, { elsewhere = false } = {}) {
		const tail = ui?.shadow?.querySelector(".wordmark-tail");
		const sep = tail?.querySelector(".wordmark-sep");
		const where = tail?.querySelector(".wordmark-where");

		if (!tail || !sep || !where) {
			return;
		}

		const swap = () => {
			where.textContent = label;
		};

		const panel = ui?.shadow?.querySelector("#panel");

		panel?.classList.toggle("has-trail", Boolean(label));
		// Which half of the toggle is lit. Set before the early return below, because
		// the label can stay the same while its state changes -- "Discussion" goes
		// from where the reader is to where they can go back to.
		panel?.classList.toggle("trail-elsewhere", Boolean(label) && elsewhere);

		// Nothing to announce if it already says this, and animating it anyway would
		// blink the trail every time the same tab is re-rendered.
		if (tail.textContent.endsWith(label)) {
			return;
		}

		if (prefersReducedMotion() || typeof tail.animate !== "function") {
			swap();
			return;
		}

		const out = tail.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 110,
			easing: "ease",
			fill: "forwards",
		});

		out.finished
			.then(() => {
				swap();
				out.cancel();
				tail.animate([{ opacity: 0 }, { opacity: 1 }], {
					duration: 110,
					easing: "ease",
				});
			})
			.catch(() => swap());
	}
	// #endregion hnewhere-test-export

	async function offerQueueOnHN() {
		if (document.getElementById("hn-queue-button")) {
			return;
		}

		const [blocked, , entries] = await Promise.all([
			isSiteBlocked(),
			loadSettings(),
			loadQueue(),
		]);

		if (blocked || !entries.length) {
			return;
		}

		const button = createFloatingHNButton("hn-queue-button");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = async () => {
			if (button._dragController.wasMoved()) {
				return;
			}

			destroyFloatingButton(button);
			await openSidebar([], { browseOnly: true, queueOnly: true });
		};

		return button;
	}

	function scrollBrowseToTop(ui) {
		const comments = ui?.shadow?.querySelector("#comments");

		if (comments) {
			comments.scrollTop = 0;
		}
	}

	const QUEUE_REFRESH_BATCH = 6;

	async function refreshQueueEntries(entries) {
		const fetched = [];

		const refreshable = (entry) => !entry.source || entry.source === "hn";

		for (let i = 0; i < entries.length; i += QUEUE_REFRESH_BATCH) {
			fetched.push(
				...(await Promise.all(
					entries
						.slice(i, i + QUEUE_REFRESH_BATCH)
						.map((entry) =>
							refreshable(entry) ? getItem(entry.id).catch(() => null) : null,
						),
				)),
			);
		}

		let changed = false;

		const next = entries.map((entry, index) => {
			const item = fetched[index];

			// A dead or deleted story returns nothing useful. What was stored is then
			// the best record there is, and is left alone.
			if (!item?.id) {
				return entry;
			}

			const fresh = {
				...entry,
				by: item.by || entry.by || "",
				score: item.score ?? entry.score ?? 0,
				time: item.time || entry.time || 0,
				descendants: item.descendants ?? entry.descendants ?? 0,
				title: item.title || entry.title,
			};

			if (
				fresh.by !== entry.by ||
				fresh.score !== entry.score ||
				fresh.descendants !== entry.descendants ||
				fresh.title !== entry.title ||
				fresh.time !== entry.time
			) {
				changed = true;
			}

			return fresh;
		});

		if (changed) {
			await saveQueue(next);
		}

		return changed;
	}

	async function renderQueueView(ui, list) {
		const entries = sortQueue(await loadQueue());

		list.replaceChildren();

		if (!entries.length) {
			const empty = document.createElement("div");
			empty.className = "browse-empty";
			// Names the control rather than describing the feature: the tab is here
			// from the start, so the one thing a reader needs is where "queue" lives.
			empty.textContent =
				"Nothing queued yet. Use queue on any story, here or on Hacker News, to read it later.";
			list.appendChild(empty);
			return;
		}

		entries.forEach((entry, index) => {
			const row = renderBrowseRow(entry, list, index + 1, { inQueue: true });
			row.classList.toggle("browse-row-read", Boolean(entry.readAt));
		});

		refreshAllItemActionControls();

		refreshQueueEntries(entries).then((refreshed) => {
			if (refreshed && isBrowsing(ui) && browseTab === "queue") {
				renderQueueView(ui, list).catch(console.error);
			}
		});

		if (entries.some((entry) => entry.readAt)) {
			const clear = document.createElement("button");
			clear.type = "button";
			clear.className = "browse-nav-link browse-clear-read";
			clear.textContent = "clear read";
			clear.onclick = async () => {
				await saveQueue(clearReadFromQueue(await loadQueue()));
				await renderQueueView(ui, list);
				refreshQueueCount(ui.shadow);
				refreshNextUp(ui.shadow);
			};

			const nav = document.createElement("div");
			nav.className = "browse-nav";
			nav.appendChild(clear);
			list.appendChild(nav);
		}
	}

	function setBlendNote(ui, sources) {
		const note = ui?.shadow?.querySelector("#browse-blend-note");

		if (!note) {
			return;
		}

		note.hidden = sources.length < 2;

		if (!note.hidden) {
			note.textContent =
				"Blended from " +
				joinWithAnd(sources.map((id) => getSource(id)?.label || id));
		}
	}

	async function renderFrontPageView(ui, list) {
		if (!list.childElementCount) {
			list.textContent = "Loading front pages…";
		}

		const requested = browsePage;
		const { rows, sources } = await loadFrontPages();

		// A second click while the first was still in flight, so this answer is for
		// a page nobody is waiting for any more.
		if (browsePage !== requested || browseTab !== "front") {
			return;
		}

		setBlendNote(ui, sources);

		if (!rows.length) {
			list.textContent = "Could not reach any front page.";
			return;
		}

		const lastPage = Math.max(1, Math.ceil(rows.length / FRONT_PAGE_SIZE));
		const page = Math.min(requested, lastPage);
		const start = (page - 1) * FRONT_PAGE_SIZE;

		browsePage = page;

		list.replaceChildren();
		rows
			.slice(start, start + FRONT_PAGE_SIZE)
			.forEach((row, index) =>
				renderBrowseRow(row.story, list, start + index + 1, { also: row.also }),
			);

		refreshAllItemActionControls();

		renderBrowseNav(
			list,
			{ page, nextPage: page < lastPage ? page + 1 : null },
			(target) => {
				// Back to the top: the reader asked for a different page, not for the same
				// place in a new one.
				scrollBrowseToTop(ui);
				renderBrowseView(ui, { page: target }).catch(console.error);
			},
		);
	}

	async function renderBrowseView(ui, options = {}) {
		const list = ui?.shadow?.querySelector("#browse-list");

		if (!list) {
			return;
		}

		if (Number.isFinite(options.page)) {
			browsePage = Math.max(1, options.page);
		}

		if (options.tab) {
			browseTab = options.tab;
		}

		for (const tab of ui.shadow.querySelectorAll(".browse-tab")) {
			const isCurrent =
				tab.id === (browseTab === "queue" ? "browse-tab-queue" : "browse-tab-front");
			tab.classList.toggle("is-current", isCurrent);
			tab.setAttribute("aria-selected", String(isCurrent));
		}

		// The page's own discussion is still one press away -- the wordmark is that
		// press -- but nothing said so, and the trail emptied on the way in. It keeps
		// naming the discussion instead, dimmed, because it is not what is on screen.
		// Which browse tab is current is already shown by the tab strip.
		if (sidebarHasDiscussion) {
			setWordmarkLocation(ui, "Discussion", { elsewhere: true });
		} else {
			setWordmarkLocation(ui, browseTab === "queue" ? "Queue" : "");
		}

		await refreshSubmitAffordance(ui.shadow);

		refreshQueueCount(ui.shadow);

		if (browseTab === "queue") {
			setBlendNote(ui, []);
			await renderQueueView(ui, list);
			return;
		}

		await renderFrontPageView(ui, list);
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

	function pulseFloatingButtonFeedback(button, text) {
		button.textContent = text;
		pinButtonStyle(button, { fontSize: "11px", color: "white" });

		window.setTimeout(() => {
			button.textContent = buttonMarkPreference;
			applyButtonMobileStyle(button);
		}, 900);
	}

	function settleButtonToDiscussion(button) {
		if (button) {
			setFloatingButtonVariant(button, "active");
		}
	}

	let openRequestedWhileChecking = false;

	function takeRequestedOpen() {
		const requested = openRequestedWhileChecking;
		openRequestedWhileChecking = false;
		return requested;
	}

	async function createCheckingButton() {
		const button = createFloatingHNButton(BUTTON_PENDING_ID, "checking");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = () => {
			if (button._dragController?.wasMoved()) {
				return;
			}

			openRequestedWhileChecking = true;
		};

		startButtonSpinner(button);

		return button;
	}

	async function createCollapsedButton(stories) {
		const button = createFloatingHNButton("hn-collapse-button");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = async () => {
			if (button._dragController.wasMoved()) return;

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
	// Submit-to-HN button
	// -------------------------

	const openSubmitBridgePopup = createBridgeChannel(
		SUBMIT_BRIDGE_MESSAGE_SOURCE,
	);

	function submitTargetFor(settings) {
		return (
			enabledSourceIds(settings, registeredSourceIds())
				.map(getSource)
				.find((source) => source?.capabilities.submit) ?? null
		);
	}

	function unsubmittableMessage(settings) {
		const enabled = enabledSourceIds(settings, registeredSourceIds())
			.map((id) => getSource(id)?.label)
			.filter(Boolean);

		const names =
			enabled.length > 1
				? enabled.slice(0, -1).join(", ") + " and " + enabled.at(-1)
				: enabled[0] || "your sources";

		return `Submitting to ${names} is not supported yet. Turn on a source that accepts submissions in Settings → Sources to post this page.`;
	}

	const SUBMIT_FORM_CSS = `
.submit-title {
	font-weight:600;
	margin-bottom:8px;
}

/* HN's own explanation of how url and text interact. Kept because the two fields
   are genuinely non-obvious: a blank url turns the whole thing into an Ask HN. */
.submit-note {
	margin-top:8px;
	color:var(--muted);
	font-size:11px;
}

.submit-field + .submit-field {
	margin-top:8px;
}

.submit-field label {
	display:block;
	color:var(--muted);
	font-size:10px;
	font-weight:700;
	letter-spacing:.04em;
	text-transform:uppercase;
	margin-bottom:3px;
}

.submit-field-head {
	display:flex;
	align-items:baseline;
	justify-content:space-between;
	gap:8px;
	margin-bottom:3px;
}

.submit-field-head label {
	margin-bottom:0;
}

.submit-field input,
.submit-field textarea {
	width:100%;
	box-sizing:border-box;
	font:13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	padding:5px 6px;
	border:1px solid var(--field-border);
	border-radius:4px;
	background:var(--field-bg);
	color:var(--field-text);
}

.submit-field textarea {
	min-height:56px;
	resize:vertical;
	/* Same reasoning as the sidebar composer: HN reads leading spaces as code. */
	white-space:pre-wrap;
}

.submit-field input:focus,
.submit-field textarea:focus {
	outline:2px solid rgba(var(--accent-rgb),.4);
	outline-offset:-1px;
}

.submit-count {
	color:var(--meta);
	font-size:10px;
	flex:0 0 auto;
	white-space:nowrap;
}

.submit-count.over {
	color:var(--error);
}

.submit-actions {
	display:flex;
	justify-content:flex-end;
	gap:6px;
	margin-top:10px;
}

.submit-actions button {
	font:600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	padding:5px 10px;
	border-radius:4px;
	cursor:pointer;
	border:1px solid var(--button-border);
	background:var(--button-bg);
	color:var(--button-text);
}

.submit-actions button.primary {
	background:var(--accent);
	border-color:var(--accent);
	color:white;
}

.submit-actions button:disabled {
	opacity:.6;
	cursor:default;
}

.submit-status {
	margin-top:8px;
	font-size:11px;
	line-height:1.4;
}

.submit-status.error {
	color:var(--error);
}

.submit-status a {
	color:var(--link);
}
`;

	function submitFormHTML({ submitTarget, message = "" }) {
		return `
<div class="submit-title">${
			// Named, not bare. "Submit" was unambiguous while one source could take a
			// submission; with a picker in front of the reader it has to say where.
			submitTarget ? "Submit to " + escapeHTML(submitTarget.label) : "Submit"
		}</div>
${
	submitTarget
		? `
<div class="submit-field">
<div class="submit-field-head">
<label for="submit-title">title</label>
<span id="submit-count" class="submit-count"></span>
</div>
<input id="submit-title" type="text" maxlength="${HN_TITLE_LIMIT}" spellcheck="true">
</div>

<div class="submit-field">
<label for="submit-url">url</label>
<input id="submit-url" type="text" spellcheck="false">
</div>

<div class="submit-field">
<label for="submit-text">text</label>
<textarea id="submit-text" rows="3" spellcheck="true"></textarea>
</div>

<div class="submit-note">
Leave url blank to submit a question for discussion. If there is no url, text will appear at the top of the thread. If there is a url, text is optional.
</div>`
		: `
<div class="submit-note">
${escapeHTML(message)}
</div>`
}

<div class="submit-actions">
<button id="submit-cancel" type="button">${submitTarget ? "Cancel" : "Close"}</button>
${submitTarget ? `<button id="submit-go" type="button" class="primary">Submit</button>` : ""}
</div>

<div id="submit-status" class="submit-status hidden" role="status"></div>
`;
	}

	function wireSubmitForm(root, { submitTarget, onSubmit, onCancel }) {
		const titleInput = root.querySelector("#submit-title");
		const countLabel = root.querySelector("#submit-count");
		const urlInput = root.querySelector("#submit-url");
		const textInput = root.querySelector("#submit-text");
		const goButton = root.querySelector("#submit-go");
		const cancelButton = root.querySelector("#submit-cancel");
		const statusLine = root.querySelector("#submit-status");

		const setStatus = (message, { error = false, html = false } = {}) => {
			statusLine.classList.remove("hidden");
			statusLine.classList.toggle("error", error);

			if (html) {
				statusLine.innerHTML = message;
			} else {
				statusLine.textContent = message;
			}
		};

		if (cancelButton) {
			cancelButton.onclick = () => onCancel?.();
		}

		if (!submitTarget) {
			cancelButton?.focus();

			return { setStatus };
		}

		titleInput.value = suggestedSubmissionTitle();
		urlInput.value = pageAddress();

		const updateCount = () => {
			const remaining = HN_TITLE_LIMIT - titleInput.value.length;

			countLabel.textContent = remaining + " left";
			countLabel.classList.toggle("over", remaining < 0);

			// HN requires a title, and requires at least one of url or text -- a
			// submission with neither has nothing in it.
			goButton.disabled =
				!titleInput.value.trim() ||
				(!urlInput.value.trim() && !textInput.value.trim());
		};

		updateCount();
		titleInput.addEventListener("input", updateCount);
		urlInput.addEventListener("input", updateCount);
		textInput.addEventListener("input", updateCount);

		goButton.onclick = async () => {
			const title = titleInput.value.trim();
			const url = urlInput.value.trim();
			// Not trimmed: HN reads two leading spaces as a code block, so the body
			// has to reach it exactly as typed.
			const text = textInput.value;

			if (!title || (!url && !text.trim())) {
				return;
			}

			goButton.disabled = true;
			cancelButton.disabled = true;
			titleInput.disabled = true;
			urlInput.disabled = true;
			textInput.disabled = true;
			setStatus("Opening Hacker News…");

			try {
				await onSubmit({ title, url, text }, { setStatus });
			} finally {
				cancelButton.disabled = false;
			}
		};

		// Enter submits from the single-line fields only. In the text area it has to
		// stay a newline, since blank lines are how HN separates paragraphs.
		for (const field of [titleInput, urlInput]) {
			field.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					goButton.click();
				}
			});
		}

		titleInput.focus();
		titleInput.select();

		return { setStatus };
	}

	// Not async, for the same reason as submitCommentThroughBridge: window.open has
	// to happen before the first await or the browser blocks it.
	function submitPageThroughBridge(sourceID, { title, url, text }) {
		const bridge = getWriteBridge(sourceID);
		const action = bridge?.actions?.submit;

		if (!action) {
			return Promise.resolve({ ok: false, reason: "no-bridge" });
		}

		const nonce = bridgeNonce();
		const session = openSubmitBridgePopup(nonce, { origin: bridge.origin });

		if (session.blocked) {
			return session.result;
		}

		return (async () => {
			try {
				await stageBridgePayload(nonce, {
					kind: "submit",
					url,
					title,
					text,
					// Blank for a text-only submission, which is what tells the reporter
					// there is no URL to match against /newest.
					normalized: url ? normalizeURL(url) : "",
					origin: location.origin,
				});
				await indexBridgePayload(nonce);

				session.navigate(
					action.url({ url, title }) + "#" + bridgeHash(action, nonce),
				);

				return await session.result;
			} finally {
				await clearBridgePayload(nonce);
			}
		})();
	}

	function renderSourcePicker(ui) {
		ui.body.innerHTML = `
<div class="source-picker">
<div class="source-picker-title">Where should comments come from?</div>
<div class="source-picker-intro">Pick at least one. Nothing is contacted until you do.</div>
<div class="source-picker-list">${sourceListHTML()}</div>
<div class="source-picker-actions">
<button class="source-picker-save" type="button" disabled>Save</button>
</div>
</div>`;

		const list = ui.body.querySelector(".source-picker-list");
		const save = ui.body.querySelector(".source-picker-save");

		// Saving nothing is the state the picker exists to leave, so the way out has
		// to be closed until there is something to save.
		const syncSave = () => {
			save.disabled = !list.querySelector("input[data-source]:checked");
		};

		list.addEventListener("change", (event) => {
			syncSave();
			syncSourceHint(event.target.closest("input[data-source]"));
		});
		syncSave();

		for (const input of list.querySelectorAll("input[data-source]")) {
			syncSourceHint(input);
		}

		save.onclick = async () => {
			const chosen = {};

			for (const input of list.querySelectorAll("input[data-source]")) {
				chosen[input.dataset.source] = input.checked;
			}

			save.disabled = true;
			await saveSettings({ sources: chosen });
			await refreshForSourceChange();
		};
	}

	// Deliberately plainer than createSubmitButton, which carries a popover for
	// composing a submission. This one only has to open the picker.
	async function createSetupButton() {
		const button = createFloatingHNButton("hn-setup-button", "setup");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = () => {
			if (button._dragController.wasMoved()) return;

			destroyFloatingButton(button);
			openSidebar([], { setupOnly: true }).catch(console.error);
		};

		return button;
	}

	async function createSubmitButton() {
		const button = createFloatingHNButton("hn-submit-button", "inactive");

		if (!button._dragController) {
			button._dragController = makeButtonDraggable(button);
		}

		if (!isMobile()) {
			await applyButtonPosition(button);
		}

		button.onclick = () => {
			if (button._dragController.wasMoved()) return;

			destroyFloatingButton(button);
			openSidebar([], { browseOnly: true }).catch(console.error);
		};

		return button;
	}

	// #region hnewhere-test-export
	function submitFailureMessage(result, sourceLabel = "Hacker News") {
		switch (result?.reason) {
			case "popup-blocked":
				return "Your browser blocked the popup. Allow popups for this site and try again.";
			case "timeout":
				return `${sourceLabel} did not respond in time. Check the popup window.`;
			case "not-logged-in":
				return `Log in to ${sourceLabel} in the popup, then try again.`;
			case "dupe":
				return `${sourceLabel} already has this URL. Reload the page to see the discussion.`;
			case "no-form":
				return `Could not find the submission form on ${sourceLabel}.`;
			default:
				return result?.message || "Submission did not go through.";
		}
	}
	// #endregion hnewhere-test-export

	// -------------------------
	// Shared chrome
	// -------------------------

	const THEME_CSS = `
:host {
	--bg:#f6f6ef;
	--text:#000;
	--header-bg:var(--accent);
	--header-text:#fff;
	--subtitle-stage:#c2e0cd;
	--subtitle-stage-peak:#ffffff;
	--border:#ccc;
	--border-soft:#ddd;
	--link:#0000aa;
	--meta:#828282;
	--muted:#666;
	--accent:#237140;
	--accent-rgb:35,113,64;
	/* What reads on the accent, for the mark that sits directly on it. White here
		because #237140 carries white at 6:1 and black at 3.5. */
	--accent-ink:#ffffff;
	--surface:#fff;
	--surface-text:#222;
	--surface-border:#d6d6d6;
	--surface-divider:#eee;
	--hover-tint:rgba(0,0,0,.08);
	--active-tint:rgba(0,0,0,.16);
	--grip:rgba(0,0,0,.2);
	--quote-text:#5f5f5f;
	--quote-ornament:#b4b4b4;

    /* 1.5.3 surfaces */
	--field-bg:#fff;
	--field-text:#000;
	--field-border:#ccc;
	--field-disabled-bg:#f0f0ea;
	--help-bg:#fbfbf5;
	--help-border:#e2e2d9;
	--help-text:#555;
	--code-bg:#efefe6;
    /* Deliberately cool against the panel's warm neutrals: the preview is a
       measuring surface, not part of the orange brand language. */
	--blueprint-bg:#f6f8fa;
	--blueprint-grid:rgba(64,86,112,.13);
	--blueprint-line:rgba(64,86,112,.22);
	--blueprint-ink:rgba(52,72,96,.72);
	--status-text:#555;
	--error:#c00;
	--button-bg:#fff;
	--button-text:#333;
	--button-border:#ccc;
	--inactive-button:#b8b8b8;
	--underline-soft:rgba(0,0,0,.2);

	color-scheme:light;
}

:host(.${DARK_CLASS}) {
	--bg:#1e1e1e;
	--text:#dcdcdc;
	--header-bg:#1b5732;
	--header-text:#f0fff5;
	/* Dimmer to hold the same relationship against the dimmer header. */
	--subtitle-stage:#8fbda2;
	--subtitle-stage-peak:#e6fff0;
	--border:#3d3d3d;
	--border-soft:#383838;
	--link:#8ab4f8;
	--meta:#9a9a9a;
	--muted:#a3a3a3;
	--accent:#3fa96a;
	--accent-rgb:63,169,106;
	--accent-ink:#000000;
	--surface:#2a2a2a;
	--surface-text:#dcdcdc;
	--surface-border:#454545;
	--surface-divider:#3a3a3a;
	--hover-tint:rgba(255,255,255,.10);
	--active-tint:rgba(255,255,255,.18);
	--grip:rgba(255,255,255,.25);
	--quote-text:#a8a8a8;
	--quote-ornament:#6d6d6d;

	--field-bg:#262626;
	--field-text:#dcdcdc;
	--field-border:#4a4a4a;
	--field-disabled-bg:#222;
	--help-bg:#252525;
	--help-border:#3a3a3a;
	--help-text:#b0b0b0;
	--code-bg:#333;
	--blueprint-bg:#1b1f25;
	--blueprint-grid:rgba(150,180,214,.12);
	--blueprint-line:rgba(150,180,214,.2);
	--blueprint-ink:rgba(168,196,226,.75);
	--status-text:#b0b0b0;
	--error:#ff8080;
	--button-bg:#333;
	--button-text:#dcdcdc;
	--button-border:#4a4a4a;
	--inactive-button:#4a4a4a;
	--underline-soft:rgba(255,255,255,.28);

	color-scheme:dark;
}
`;

	const CHROME_CSS = `
header {
	background:var(--header-bg);
	color:var(--header-text);
	padding:6px 8px;
	display:flex;
	justify-content:space-between;
	align-items:center;
	gap:8px;
	font-weight:bold;
	position:relative;
}

.header-actions button {
	background:none;
	border:0;
	color:var(--header-text);
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

@media (hover: hover) {
	.header-actions button:hover {
		background:var(--hover-tint);
	}
}

/* The eye and the choice behind it. Deliberately not the menu's containing
   block -- see the note on header. */
.hide-control {
	display:inline-flex;
}

.hide-caret {
	margin-left:1px;
	font-size:18px;
	line-height:1;
}

#hide-site.has-scope {
	gap:0;
}

.hide-menu {
	position:absolute;
	top:46px;
	right:8px;
	/* Above the settings panel, which is also absolute in this header at z-index
	   3. Opened with settings already down, this used to arrive behind it. */
	z-index:5;
	display:flex;
	flex-direction:column;
	width:max-content;
	min-width:max-content;
	max-width:min(320px, 82vw);
	padding:4px;
	border:1px solid var(--surface-border);
	border-radius:6px;
	background:var(--surface);
	box-shadow:0 6px 18px rgba(0,0,0,.18);
}

.hide-menu[hidden] {
	display:none;
}

.hide-menu button {
	padding:5px 8px;
	border:0;
	border-radius:4px;
	background:none;
	color:var(--surface-text);
	font:12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	text-align:left;
	white-space:nowrap;
	cursor:pointer;
}

@media (hover: hover) {
	.hide-menu button:hover {
		background:var(--hover-tint);
	}
}

.header-actions {
	display:flex;
	align-items:center;
	gap:0;
	flex-shrink:0;
}

.header-wordmark {
	align-self:flex-start;
	display:flex;
	align-items:baseline;
    /* max-width, not min-width: .header-title is a column flex container, so its
       main axis is vertical and min-width relaxes nothing horizontal. */
	max-width:100%;
	border:0;
	padding:0;
	margin:0;
	background:none;
	color:inherit;
	font:inherit;
	cursor:pointer;
	text-align:left;
}

.wordmark-root {
	transition:color .2s ease;
	flex:0 0 auto;
}

/* The wordmark and its trail are a toggle, and exactly one side is lit: whichever
   view is on screen keeps the text colour, the other dims to read as a way back.
   Both dimming at once says nothing about where the reader is. */
#panel.has-trail:not(.trail-elsewhere) .wordmark-root {
	color:var(--subtitle-stage);
}

#panel.queue-only .header-wordmark {
	cursor:default;
	opacity:1;
}

.wordmark-more {
	flex:0 0 auto;
	width:auto;
	margin-left:4px;
	overflow:hidden;
	color:var(--subtitle-stage);
	transition:width .2s ease, margin-left .2s ease, opacity .2s ease;
}

#panel.has-trail .wordmark-more {
	width:0;
	margin-left:0;
	opacity:0;
}

.wordmark-tail {
	display:flex;
	align-items:baseline;
	gap:5px;
	margin-left:5px;
	white-space:nowrap;
	opacity:0;
	transform:translateX(-4px);
	pointer-events:none;
	transition:opacity .2s ease, transform .2s ease;
	min-width:0;
}

/* The location, in a box of its own so it can be cut. text-overflow needs inline
   content in a block box, which .wordmark-tail is not. */
.wordmark-where {
	min-width:0;
	overflow:hidden;
	text-overflow:ellipsis;
	white-space:nowrap;
	transition:color .2s ease;
}

#panel.has-trail .wordmark-tail {
	opacity:1;
	transform:none;
	pointer-events:auto;
}

.wordmark-sep {
	font-weight:400;
	color:var(--subtitle-stage);
	flex:0 0 auto;
}

/* The other half of the toggle: the trail names somewhere the reader is not, so
   it dims and the wordmark lights instead. */
#panel.trail-elsewhere .wordmark-where {
	color:var(--subtitle-stage);
}

.header-wordmark:focus-visible {
	outline:1px solid var(--link);
	outline-offset:2px;
}

@media (hover: hover) {
	.header-wordmark:hover {
		opacity:.75;
	}
}

.browse-view {
	display:none;
	--browse-indent:28px;
}

#comments-content,
.browse-view {
	transition:opacity .16s ease;
}

#comments.views-swapping > #comments-content,
#comments.views-swapping > .browse-view,
#comments.views-swapping > .filter-banner {
	opacity:0;
}

/* Starts exactly where every title beneath it does. */
.browse-tabs {
	display:flex;
	align-items:baseline;
	margin:0 0 10px var(--browse-indent);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
}

#browse-tab-queue::after {
	content:"|";
	margin:0 .35em;
	color:var(--meta);
}

#browse-tab-queue {
	max-width:var(--queue-tab-width, 8em);
	overflow:hidden;
	white-space:nowrap;
	opacity:1;
}

#browse-tab-queue.is-collapsed {
	max-width:0;
	opacity:0;
	/* Zero width already makes it unclickable; this says so rather than relying
	   on it, since the tab is in the tree and no longer hidden by attribute. */
	pointer-events:none;
}

.browse-tabs.is-ready #browse-tab-queue {
	transition:max-width .2s ease, opacity .2s ease;
}

@media (prefers-reduced-motion: reduce) {
	.browse-tabs.is-ready #browse-tab-queue {
		transition:none;
	}
}

.browse-tab[hidden] {
	display:none;
}

.browse-tab {
	border:0;
	padding:0;
	background:none;
	color:var(--meta);
	cursor:pointer;
	font-family:inherit;
	font-size:inherit;
}

.browse-tab.is-current {
	color:var(--text);
}

@media (hover: hover) {
	.browse-tab:not(.is-current):hover {
		text-decoration:underline;
		text-underline-offset:2px;
	}
}

.browse-empty {
	margin:4px 0 0 var(--browse-indent);
	max-width:var(--measure);
	color:var(--meta);
	line-height:1.5;
}

.browse-row-read {
	opacity:.5;
}

.browse-comments-sep {
	padding:0 4px;
	color:var(--meta);
}

.browse-comments-total {
	padding:0;
	border:0;
	background:none;
	font:inherit;
	color:inherit;
	text-decoration:none;
	cursor:pointer;
}

@media (hover: hover) {
	.browse-comments-total:hover {
		text-decoration:underline;
	}
}

/* Quiet, because it qualifies the number rather than being part of it. Hidden
   from screen readers, which would read it as arithmetic. */
.browse-comments-floor {
	color:var(--meta);
}

/* Tight under the tab it qualifies: "front pages" and the list of them are one
   statement, and the gap was reading as a separation between two. */
.browse-blend-note {
	margin:-7px 0 10px var(--browse-indent);
	color:var(--meta);
	font-size:11px;
	font-family:Verdana, Geneva, sans-serif;
}

.browse-blend-note[hidden] {
	display:none;
}

/* Which view is on screen no longer decides this -- whether the page already has
   a discussion does, and that is read in refreshSubmitAffordance. */
#panel.submitting #header-submit {
	display:none;
}

#header-submit[hidden] {
	display:none;
}

/* A rank column wide enough for two digits and the stop after them, which is
   every row on a thirty-story page. */
.browse-row {
	display:flex;
	gap:6px;
	align-items:baseline;
	padding:0 0 5px;
}

.browse-row .story-title {
	font-size:13px;
	line-height:1.3;
}

.browse-row .story-meta {
	line-height:1.15;
	padding-top:1px;
}

.browse-rank {
	flex:0 0 auto;
	min-width:22px;
	text-align:right;
	color:var(--meta);
	font-size:11px;
}

.browse-main {
	flex:1 1 auto;
	min-width:0;
}

/* Beside the title at meta weight, the way HN sets it: it qualifies the link
   rather than competing with it. */
.browse-site {
	color:var(--meta);
	font-size:11px;
}

.browse-title-link:visited {
	color:var(--meta);
}

/* Indented to the rank column's right edge, so it starts where every title above
   it starts rather than at the panel's edge. */
.browse-nav {
	display:flex;
	align-items:baseline;
	gap:10px;
	margin:14px 0 8px var(--browse-indent);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	color:var(--meta);
}

/* Set as a meta-row text link, like every other action on these rows. HN writes
   favorite and flag exactly this way and puts them in exactly this company. */
.item-action-link {
	border:0;
	padding:0;
	background:none;
	color:var(--meta);
	cursor:pointer;
	font-family:inherit;
	font-size:inherit;
	text-decoration:none;
	text-underline-offset:2px;
}

.item-action-link[hidden] {
	display:none;
}

.item-action-link:disabled {
	opacity:.5;
	cursor:default;
}

.item-action-link:enabled:focus-visible {
	text-decoration:underline;
}

@media (hover: hover) {
	.item-action-link:enabled:hover {
		text-decoration:underline;
	}
}

.browse-save-link {
	border:0;
	padding:0;
	background:none;
	color:var(--meta);
	cursor:pointer;
	font-family:inherit;
	font-size:inherit;
	text-decoration:none;
	text-underline-offset:2px;
}

@media (hover: hover) {
	.browse-save-link:hover {
		text-decoration:underline;
	}
}

.browse-save-link:focus-visible {
	text-decoration:underline;
}

/* Text links on a meta row, the same treatment .filter-banner-close gets: no
   underline until hover, no colour shift. */
.browse-nav-link {
	border:0;
	padding:0;
	background:none;
	color:var(--meta);
	cursor:pointer;
	font-family:inherit;
	font-size:inherit;
	text-decoration:none;
	text-underline-offset:2px;
}

/* Dimmed and inert rather than removed. Which end of the list you are at is
   information, and a control that vanishes makes the reader work out why. */
.browse-nav-link:disabled {
	opacity:.4;
	cursor:default;
}

.browse-nav-link:enabled:focus-visible {
	text-decoration:underline;
}

.next-up {
	display:block;
	margin:18px -12px 24px;
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	color:var(--meta);
}

.next-up-row {
	display:flex;
	flex-wrap:wrap;
	align-items:baseline;
	gap:6px;
	padding:0 12px 0 26px;
}

.next-up.hidden {
	display:none;
}

.next-up-label {
	color:var(--meta);
}

/* The title carries the panel's own text colour and the panel's own size: it is
   the thing being offered, and the row around it is the label. */
.next-up-title {
	flex:1 1 auto;
	min-width:0;
	color:var(--text);
	font-family:inherit;
	font-size:13px;
	text-decoration:none;
}

@media (hover: hover) {
	.next-up-title:hover {
		text-decoration:underline;
		text-underline-offset:2px;
	}
}

.next-up-count {
	flex:0 0 auto;
}

@media (hover: hover) {
	.browse-nav-link:enabled:hover {
		text-decoration:underline;
	}
}

#panel.browsing .browse-view {
	display:block;
}

#panel.browsing #comments-content,
#panel.browsing .filter-banner,
#panel.browsing .next-up {
	display:none;
}

.header-title {
	display:flex;
	flex-direction:column;
	min-width:0;
	padding-left:12px;
}

.header-title:has(.header-subtitle) > :first-child {
	line-height:1.25;
}

.header-subtitle {
	font-size:11px;
	font-weight:normal;
	line-height:1.2;
	max-height:0;
	opacity:0;
	overflow:hidden;
	transition:max-height .2s ease, opacity .2s ease;
}

.header-subtitle-visible {
	max-height:16px;
	opacity:.85;
}

.header-subtitle-stage {
	color:var(--subtitle-stage);
}

/* A highlight swept across the text itself rather than a spinner beside it, so
   the header gains no furniture for a state that is usually brief. */
.header-subtitle-loading {
    background:linear-gradient(
        90deg,
		var(--subtitle-stage) 0%,
		var(--subtitle-stage) 40%,
		var(--subtitle-stage-peak) 50%,
		var(--subtitle-stage) 60%,
        var(--subtitle-stage) 100%
    );
	background-size:220% 100%;
	-webkit-background-clip:text;
	background-clip:text;
	-webkit-text-fill-color:transparent;
	animation:hnewhere-subtitle-shimmer 1.6s linear infinite;
}

@keyframes hnewhere-subtitle-shimmer {
    from { background-position:120% 0; }
    to { background-position:-20% 0; }
}

.settings-panel {
	position:absolute;
	top:46px;
	right:8px;
	width:240px;
	background:var(--surface);
	color:var(--surface-text);
	border:1px solid var(--surface-border);
	border-radius:8px;
	box-shadow:0 8px 24px rgba(0,0,0,.16);
	padding:10px 10px 13px;
	z-index:3;
}

.settings-group + .settings-group {
	margin-top:10px;
	padding-top:10px;
	border-top:1px solid var(--surface-divider);
}

header button svg {
	display:block;
}

/* Both dropdowns in this header stay lit while they are down, so the button and
   the panel under it read as one thing rather than as a press that ended. */
#settings-toggle.is-open,
#hide-site.is-open {
	background:var(--active-tint);
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

.settings-option input[type="checkbox"] {
	appearance:none;
	-webkit-appearance:none;
	box-sizing:border-box;
	flex:0 0 auto;
	width:13px;
	height:13px;
	font-size:inherit;
	margin:calc((1.35em - 13px) / 2) 0 0;
	display:inline-grid;
	place-content:center;
	border:1px solid var(--help-border);
	border-radius:3px;
	background:var(--help-bg);
	cursor:pointer;
	transition:background .14s ease, border-color .14s ease;
}

/* Same accent the selected segment uses, so a checked box and a chosen segment
   read as the same kind of "on". */
.settings-option input[type="checkbox"]:checked {
	border-color:transparent;
	background:#0b63ce;
	background:AccentColor;
}

.settings-option input[type="checkbox"]:checked::after {
	content:"";
	width:6px;
	height:3px;
	border-left:1.5px solid #fff;
	border-bottom:1.5px solid #fff;
	transform:translateY(-1px) rotate(-45deg);
}

.settings-option input[type="checkbox"]:focus-visible {
	outline:2px solid #0b63ce;
	outline:2px solid AccentColor;
	outline-offset:1px;
}

/* Sub-options are disabled while their parent is off, and an appearance:none box
   has no UA disabled styling of its own. */
.settings-option input[type="checkbox"]:disabled {
	opacity:.45;
	cursor:default;
}

.settings-option.sub-option {
	margin-left:20px;
	font-size:11px;
}

.settings-suboptions {
	overflow:hidden;
	max-height:0;
	opacity:0;
	margin-top:0;
	transition:max-height .22s ease, opacity .18s ease, margin-top .22s ease;
}

.settings-suboptions.is-visible {
	max-height:140px;
	opacity:1;
	/* Separates the first sub-option from whatever it belongs to above it. */
	margin-top:8px;
}

.settings-suboptions + .settings-option {
	margin-top:8px;
}

.settings-option-hint + .settings-option {
	margin-top:8px;
}

/* Version on the left, issues link on the right, one row. */
.settings-credits {
	display:flex;
	align-items:baseline;
	justify-content:space-between;
	gap:10px;
	color:var(--muted);
	font-size:11px;
	line-height:1.45;
}

.settings-credits a {
	color:var(--muted);
	text-decoration:underline;
	text-decoration-color:var(--underline-soft);
	text-underline-offset:2px;
}

@media (hover: hover) {
	.settings-credits a:hover {
		color:var(--accent);
		text-decoration-color:rgba(var(--accent-rgb),.5);
	}
}

/* The page, not a submission of it. Sized like a story header used to be, so the
	panel opens onto the same shape it always did. */
.page-header {
	padding:0 14px 10px;
	border-bottom:1px solid var(--border-soft);
}

.page-header-title {
	font-size:13px;
	font-weight:500;
	line-height:1.35;
}

.page-header-meta {
	margin-top:3px;
	color:var(--meta);
	font-size:11px;
}

/* One discussion leaves this empty, and an empty line still takes a line's
	height plus its margin -- a gap under the title with nothing in it. */
.page-header-meta:empty {
	display:none;
}

.page-header-quiet {
	padding:0;
	border-bottom:0;
}

/* The aggregate leads and this is what a reader reaches for, so it sits below the
	count at metadata weight rather than above it as a masthead. */
/* The same slide the settings sub-options use, down to the durations, because it
	is the same gesture: a group opening inside a panel rather than a new surface. */
.source-strip {
	display:flex;
	flex-wrap:wrap;
	gap:6px;
	overflow:hidden;
	max-height:0;
	opacity:0;
	margin-top:0;
	transition:max-height .22s ease, opacity .18s ease, margin-top .22s ease;
}

.source-strip-single {
	display:none;
}

.source-strip.is-open {
	opacity:1;
	margin-top:8px;
}

/* Reads as the affordance it is: the count is the thing you press, so it carries
	a dotted underline rather than looking like the prose around it. */
.page-header-disclosure {
	font:inherit;
	color:inherit;
	background:none;
	border:0;
	padding:0;
	cursor:pointer;
	text-decoration:underline dotted;
	text-underline-offset:2px;
	text-decoration-color:var(--border);
}

.page-header-disclosure[aria-expanded="true"] {
	text-decoration-style:solid;
	text-decoration-color:var(--accent);
}

.page-sort {
	display:flex;
	align-items:center;
	gap:6px;
	padding:8px 0 0;
	font-size:11px;
	color:var(--meta);
}

.page-sort-select {
	font:inherit;
	color:var(--text);
	background:var(--bg);
	border:1px solid var(--border);
	border-radius:4px;
	padding:2px 4px;
	cursor:pointer;
}

.list-filtered .page-sort {
	display:none;
}

.source-strip-entry {
	display:inline-flex;
	align-items:baseline;
	gap:5px;
	padding:2px 7px;
	border:0;
	border-radius:999px;
	background:var(--hover-tint);
	color:inherit;
	font:inherit;
	font-size:11px;
	cursor:pointer;
}

/* The pill that is currently filtering. Pressing it again clears, so it reads as
	a toggle rather than a destination. */
.source-strip-entry-active {
	background:var(--active-tint);
	font-weight:600;
}

.source-strip-count {
	color:var(--muted);
	font-variant-numeric:tabular-nums;
}

.more-replies {
	display:block;
	margin:8px 0 0 8px;
	padding:0;
	border:0;
	background:none;
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	color:var(--meta);
	cursor:pointer;
}

.more-replies:disabled {
	cursor:default;
	opacity:.7;
}

@media (hover: hover) {
	.more-replies:hover:not(:disabled) {
		text-decoration:underline;
	}
}

.comment-source::before {
	content:"·";
	margin-right:4px;
}

.live-pill {
	margin-left:6px;
	padding:0 4px;
	border-radius:3px;
	font-size:10px;
	font-weight:600;
	letter-spacing:.04em;
	vertical-align:1px;
	color:var(--header-text);
	background:rgba(var(--accent-rgb),.95);
}

@media (prefers-reduced-motion: no-preference) {
	.live-pill {
		animation:live-pulse 2s ease-in-out infinite;
	}
}

@keyframes live-pulse {
	50% { opacity:.55; }
}

.live-bookend {
	display:flex;
	align-items:center;
	gap:6px;
	margin:0 -12px;
	padding:10px 12px 0;
	font-size:11px;
	color:var(--meta);
	line-height:13px;
}

.live-bookend::after {
	content:"";
	flex:1 0 24px;
	height:1px;
	background:rgba(var(--accent-rgb),.5);
}

.live-bookend-text {
	display:flex;
	align-items:baseline;
	gap:4px;
	min-width:0;
	overflow:hidden;
	white-space:nowrap;
}

/* "happening now in" never moves. */
.live-bookend-lead {
	flex:0 0 auto;
}

/* The source names, in a box they can be wider than. Ellipsised while still, so
   a reader who has turned motion off still sees where the run was cut. */
.live-bookend-names {
	min-width:0;
	overflow:hidden;
	text-overflow:ellipsis;
}

.live-bookend-scroll {
	display:inline-block;
}

/* Ping-pong rather than a loop: a list that wraps around reads as a different
   list every time it passes. It holds at each end long enough to be read. */
.live-bookend-names.is-marquee {
	text-overflow:clip;
}

.live-bookend-names.is-marquee .live-bookend-scroll {
	animation:live-bookend-marquee var(--marquee-duration, 6s) ease-in-out infinite alternate;
}

@keyframes live-bookend-marquee {
	0%, 18% {
		transform:translateX(0);
	}

	82%, 100% {
		transform:translateX(var(--marquee-shift, 0));
	}
}

@media (prefers-reduced-motion: reduce) {
	.live-bookend-names.is-marquee .live-bookend-scroll {
		animation:none;
	}

	.live-bookend-names.is-marquee {
		text-overflow:ellipsis;
	}
}

/* The closing rule leads instead of trailing, so the pair reads as a bracket
	around the run rather than as two identical headings. */
.live-bookend-close {
	padding:14px 12px 0;
	flex-direction:row-reverse;
}

.live-bookend-mark {
	padding:0 4px;
	border-radius:3px;
	font-size:10px;
	font-weight:600;
	letter-spacing:.04em;
	color:var(--header-text);
	background:rgba(var(--accent-rgb),.95);
}

@media (prefers-reduced-motion: no-preference) {
	.live-bookend-mark {
		animation:live-pulse 2s ease-in-out infinite;
	}
}

.live-bookend-hidden {
	display:none;
}

.discussion-filtered .comment-source {
	display:none;
}

.source-picker {
	padding:20px 18px;
	max-width:420px;
}

.source-picker-title {
	font-size:15px;
	font-weight:600;
	margin-bottom:6px;
}

.source-picker-intro {
	color:var(--muted);
	font-size:12px;
	line-height:1.45;
	margin-bottom:14px;
}

.source-picker-list {
	margin-bottom:16px;
}

.source-picker-actions {
	display:flex;
	justify-content:flex-end;
	gap:6px;
	margin-top:10px;
}

.source-picker-save {
	font:600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	padding:5px 10px;
	border-radius:4px;
	cursor:pointer;
	border:1px solid var(--accent);
	background:var(--accent);
	color:white;
}

/* Disabled rather than hidden, so the way out of this screen stays visible along
	with what it is waiting for. */
.source-picker-save:disabled {
	opacity:.6;
	cursor:default;
}

/* Indented to clear the checkbox so the text starts under the option's label rather
   than under its box. 13px is the native checkbox width, plus the flex gap. */
.settings-option-hint {
	margin:3px 0 0 21px;
	color:var(--muted);
	font-size:11px;
	line-height:1.35;
	   Stated in px for the same reason the hide menu is: rem here would be
	   measured against the page's root font-size, and a site using the 62.5%
	   reset would put this ceiling back below the caveats it has to clear. */
	max-height:384px;
	overflow:hidden;
	transition:max-height .25s ease, margin-top .25s ease, opacity .2s ease;
}

/* The slower-fetch note, added as its own paragraph under a slow source's caveat. */
.settings-option-hint-slow {
	margin:6px 0 0;
}

.settings-option:has(#setting-hide-without-discussion:checked) ~ .settings-option-hint {
	display:none;
}

.settings-option:has(input[data-source]:checked) + .settings-option-hint,
.settings-option-hint.is-acknowledged {
	max-height:0;
	margin-top:0;
	opacity:0;
}

.settings-option.sub-option + .settings-option-hint {
	margin-left:41px;
}

/* Shared: the settings panel's BETA pill needs this in the popover, and comment
   rendering needs it in the sidebar. */
.op-pill {
	display:inline-block;
	margin-left:1px;
	margin-right:1px;
	padding:1px 4px;
	border-radius:3px;
	background:var(--accent);
	color:white;
	font-size:9px;
	font-weight:bold;
	line-height:1.2;
}

.op-pill-front,
.op-pill-slow {
	display:none;
	position:relative;
	background:var(--muted);
	font-weight:400;
	cursor:default;
}

.settings-option-on .op-pill-front,
.settings-option-on .op-pill-slow {
	display:inline-block;
}

.op-pill-tip {
	position:absolute;
	bottom:calc(100% + 6px);
	left:50%;
	transform:translateX(-50%);
	white-space:nowrap;
	padding:4px 6px;
	border-radius:4px;
	background:var(--surface-text);
	color:var(--surface);
	font-size:10px;
	opacity:0;
	pointer-events:none;
	transition:opacity .15s ease;
	z-index:3;
}

.op-pill-front:hover .op-pill-tip,
.op-pill-front:focus .op-pill-tip,
.op-pill-slow:hover .op-pill-tip,
.op-pill-slow:focus .op-pill-tip {
	opacity:1;
}

.hidden {
	display:none;
}

.settings-field + .settings-field {
	margin-top:10px;
}

.settings-field-label {
	font-size:11px;
	color:var(--muted);
	margin-bottom:4px;
}

.settings-panel {
	overflow-x:hidden;
    /* The popover no longer clips this, so the panel bounds itself against a
       short viewport rather than running off the bottom of the screen. */
	max-height:calc(100vh - 120px);
	overflow-y:auto;
}

.settings-panes + .settings-credits {
	margin-top:10px;
	padding-top:10px;
	border-top:1px solid var(--surface-divider);
}

.settings-panes {
	display:flex;
	align-items:flex-start;
	width:200%;
	overflow:hidden;
	transition:transform .26s ease, height .26s ease;
}

.settings-panes.is-secondary {
	transform:translateX(-50%);
}

.settings-pane {
	flex:0 0 50%;
	width:50%;
	min-width:0;
    /* Delayed on the way out so the outgoing pane stays visible for the whole
       slide, then drops out of the tab order once it is off-screen. */
	visibility:hidden;
	transition:visibility 0s linear .26s;
}

.settings-panes:not(.is-secondary) > .settings-pane-primary,
.settings-panes.is-secondary > .settings-pane-secondary.is-active {
	visibility:visible;
	transition-delay:0s;
}

.settings-pane-secondary {
	display:none;
}

.settings-pane-secondary.is-active {
	display:block;
}

/* Small enough to sit in a dropdown, which is the constraint: five rows and a
	column per source is about what fits before it stops being glanceable. */
.source-matrix-caption {
	margin:14px 0 5px;
	color:var(--muted);
	font-size:11px;
}

.source-matrix-scroll {
	overflow-x:auto;
	overscroll-behavior-x:contain;
}

.source-matrix {
	width:auto;
	min-width:100%;
	border-collapse:separate;
	border-spacing:0;
	font-size:11px;
}

.source-matrix th,
.source-matrix td {
	padding:3px 4px;
	text-align:center;
	font-weight:400;
	white-space:nowrap;
}

.source-matrix thead th,
.source-matrix tbody th {
	color:var(--muted);
}

.source-matrix tbody th {
	text-align:left;
}

.source-matrix thead th:first-child,
.source-matrix tbody th {
	position:sticky;
	left:0;
	z-index:1;
	background:var(--surface);
	border-right:1px solid var(--surface-divider);
}

.source-matrix tbody tr + tr th,
.source-matrix tbody tr + tr td {
	border-top:1px solid var(--surface-divider);
}

.source-matrix .yes {
	color:var(--surface-text);
}

.source-matrix .no {
	color:var(--muted);
}

/* Separates the source checkboxes from the support table below them. */
.sources-divider {
	border:none;
	border-top:1px solid var(--surface-divider);
	margin:14px 0;
}

/* No gap: the chevron animates its own width and margin, and a flex gap would
   still reserve space for it while collapsed, indenting the title on level one. */
.settings-head {
	display:flex;
	align-items:baseline;
	margin:0 0 8px;
}

/* Collapsed to zero width rather than hidden, so entering the second level slides
   it open and pushes the trail across instead of snapping. */
.settings-back {
	flex:0 0 auto;
	width:0;
	margin-right:0;
	padding:0;
	border:0;
	overflow:hidden;
	background:none;
	color:var(--muted);
	font-size:15px;
	line-height:1;
	opacity:0;
	cursor:pointer;
	align-self:center;
	transition:width .2s ease, margin-right .2s ease, opacity .2s ease;
}

.settings-head.is-secondary .settings-back {
	width:9px;
	margin-right:5px;
	opacity:1;
}

.settings-crumb-root {
	padding:0;
	border:0;
	background:none;
	color:inherit;
	font-size:12px;
	font-weight:600;
	line-height:1.3;
    /* Inert on the first level, where it is simply the panel's title. */
	cursor:default;
	transition:color .2s ease, font-weight .2s ease;
}

/* Enabled only on the second level, where it stops being the title and becomes
   the way back -- so emphasis moves off it and onto the current page. */
.settings-crumb-root:enabled {
	cursor:pointer;
	font-weight:400;
	color:var(--muted);
	text-decoration:underline;
	text-underline-offset:2px;
}

.settings-crumb-tail {
	display:flex;
	align-items:baseline;
	gap:5px;
    /* The head has no flex gap -- the chevron animates its own -- so the space
       before the separator belongs to the trail. */
	margin-left:5px;
	font-size:12px;
	font-weight:600;
	line-height:1.3;
	opacity:0;
	transform:translateX(-4px);
	pointer-events:none;
	transition:opacity .2s ease, transform .2s ease;
}

.settings-head.is-secondary .settings-crumb-tail {
	opacity:1;
	transform:none;
	pointer-events:auto;
}

.settings-crumb-sep {
	font-weight:400;
	color:var(--muted);
}

.segmented {
	display:flex;
	border:1px solid var(--help-border);
	border-radius:5px;
	background:var(--help-bg);
	overflow:hidden;
}

.segment {
	position:relative;
	flex:1 1 0;
	min-width:0;
}

.segment + .segment {
	border-left:1px solid var(--help-border);
}

/* Full-bleed rather than display:none so the control stays keyboard reachable and
   arrow keys still move through the group. */
.segment input {
	position:absolute;
	inset:0;
	width:100%;
	height:100%;
	margin:0;
	opacity:0;
	cursor:pointer;
}

.segment span {
	display:block;
	padding:4px 5px;
	text-align:center;
	font-size:11px;
	line-height:1.3;
	color:var(--help-text);
	white-space:nowrap;
	overflow:hidden;
	text-overflow:ellipsis;
	transition:background .14s ease, color .14s ease;
}

.segment input:checked + span {
	background:#0b63ce;
	background:AccentColor;
	color:#fff;
	font-weight:600;
}

.segment input:focus-visible + span {
	outline:2px solid #0b63ce;
	outline:2px solid AccentColor;
	outline-offset:-2px;
}

.button-designer {
	display:flex;
	align-items:stretch;
	gap:10px;
}

/* flex-start so the "Button" label sits level with the top of the preview box
   beside it rather than floating in the middle of the column. */
.button-designer-controls {
	flex:1 1 auto;
	min-width:0;
	display:flex;
	flex-direction:column;
	justify-content:flex-start;
}

/* align-self so the row is only as wide as its three controls; stretched to the
   column it left the two buttons marooned at opposite edges. */
.stepper {
	display:flex;
	align-items:center;
	align-self:flex-start;
	gap:4px;
	margin-top:8px;
}

.stepper-button {
	flex:0 0 24px;
	width:24px;
	height:24px;
	display:flex;
	align-items:center;
	justify-content:center;
	padding:0;
	border:1px solid var(--help-border);
	border-radius:4px;
	background:var(--help-bg);
	color:var(--help-text);
	font-size:14px;
	line-height:1;
	cursor:pointer;
}

.stepper-button:disabled {
	opacity:.4;
	cursor:default;
}

.stepper-value {
	display:flex;
	align-items:baseline;
	gap:1px;
	padding:0 5px;
	border:1px solid var(--help-border);
	border-radius:4px;
	background:var(--field-bg);
}

.stepper-value:focus-within {
	outline:2px solid #0b63ce;
	outline:2px solid AccentColor;
	outline-offset:-1px;
}

.stepper-input {
	width:24px;
	padding:3px 0;
	border:0;
	background:none;
	color:var(--field-text);
	font-family:Menlo, Consolas, monospace;
	font-size:11px;
	text-align:right;
}

.stepper-input:focus {
	outline:none;
}

.stepper-unit {
	font-family:Menlo, Consolas, monospace;
	font-size:9px;
	color:var(--muted);
}

.button-preview {
	flex:0 0 88px;
	display:flex;
	flex-direction:column;
	align-items:center;
	justify-content:center;
	gap:5px;
	padding:8px 6px;
	border:1px solid var(--blueprint-line);
	border-radius:5px;
	background-color:var(--blueprint-bg);
    background-image:
		linear-gradient(var(--blueprint-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--blueprint-grid) 1px, transparent 1px);
	background-size:8px 8px;
	background-position:center center;
}

/* Fixed so the panel does not jump as the button grows through its range. */
.button-preview-stage {
	height:68px;
	display:flex;
	align-items:center;
	justify-content:center;
}

.button-preview-shape {
	display:flex;
	align-items:center;
	justify-content:center;
	border:0;
	cursor:text;
	/* Both follow the accent rather than assuming white, the same way the real
		button's mark does -- the preview is meant to be what it will look like. */
	caret-color:var(--accent-ink);
	outline-offset:2px;
	background:var(--accent);
	box-shadow:0 1px 4px rgba(0,0,0,.25);
	color:var(--accent-ink);
	font-family:Verdana,sans-serif;
	font-weight:bold;
	transition:width .16s ease, height .16s ease, border-radius .16s ease, font-size .16s ease;
}

.button-preview-rule {
	position:relative;
	display:flex;
	align-items:center;
	justify-content:center;
	width:100%;
	height:9px;
}

.button-preview-rule::before,
.button-preview-rule::after {
	content:"";
	position:absolute;
	top:calc(50% - 5px);
	height:5px;
	/* Clears the caption, which is now a seven-character hex rather than the two
		digits the ticks were spaced for. */
	width:calc(50% - 27px);
	border-bottom:1px solid var(--blueprint-ink);
}

.button-preview-rule::before {
	left:0;
	border-left:1px solid var(--blueprint-ink);
}

.button-preview-rule::after {
	right:0;
	border-right:1px solid var(--blueprint-ink);
}

.button-preview-dim {
	position:relative;
	padding:0 4px;
	background:var(--blueprint-bg);
	color:var(--blueprint-ink);
	font-family:Menlo, Consolas, monospace;
	font-size:9px;
	white-space:nowrap;
	cursor:text;
	outline:0;
}

.button-preview-dim:focus {
	color:var(--accent);
}

.settings-reset {
	align-self:flex-end;
	margin-top:6px;
	padding:0;
	border:0;
	background:none;
	color:var(--muted);
	font-size:11px;
	text-decoration:underline;
	text-underline-offset:2px;
	cursor:pointer;
}

.settings-link-button {
	display:flex;
	align-items:center;
	justify-content:space-between;
	width:100%;
	padding:6px 8px;
	border:1px solid var(--help-border);
	border-radius:4px;
	background:var(--help-bg);
	color:var(--help-text);
	font-size:12px;
	text-align:left;
	cursor:pointer;
}

.settings-link-chevron {
	font-size:14px;
	opacity:.6;
}

.settings-blocked-list {
	margin-top:4px;
}

.settings-blocked-entry {
	display:flex;
	align-items:center;
	justify-content:space-between;
	gap:8px;
	padding:3px 0;
	font-size:11px;
}

.settings-blocked-remove {
	border:0;
	background:none;
	color:var(--muted);
	font-size:14px;
	line-height:1;
	padding:0 2px;
	cursor:pointer;
}

.settings-blocked-empty {
	font-size:11px;
	color:var(--muted);
}
`;

	function headerHTML({ subtitle = false, minimize = false, browse = false } = {}) {
		return `
<header>

<span class="header-title">
${
	browse
		? `<button id="browse-toggle" class="header-wordmark" type="button"
title="${escapeHTML(browseLabel())}"><span
class="wordmark-root"><b>Back</b>channel</span><span class="wordmark-more" aria-hidden="true">&#8943;</span><span
class="wordmark-tail"><span class="wordmark-sep">/</span><span
class="wordmark-where">Discussion</span></span></button>`
		: `<span><b>Back</b>channel</span>`
}
${subtitle ? `<span id="header-subtitle" class="header-subtitle"></span>` : ""}
</span>

<div class="header-actions">
<button id="header-submit" type="button" aria-label="Submit this page" title="Submit this page" hidden>
<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
<path d="M8 12.7V4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
<path d="M4.5 7.7 8 4.2l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
</button>
<span class="hide-control">
<button id="hide-site" class="has-scope" aria-haspopup="true" aria-expanded="false" aria-label="Hide Backchannel here" title="Hide Backchannel here">
<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
<!-- Filled rather than outlined. White on the header's green, a 1.25px stroke
     is most of the way to invisible at 15px; a solid shape holds its detail.
     The pupil is a hole punched with evenodd rather than a circle painted in
     the background colour, so it survives whatever the header is behind it. -->
<path fill="currentColor" fill-rule="evenodd" d="M1.4 8S3.9 3.9 8 3.9 14.6 8 14.6 8 12.1 12.1 8 12.1 1.4 8 1.4 8ZM8 6.15a1.85 1.85 0 1 0 0 3.7 1.85 1.85 0 1 0 0-3.7Z"/>
<!-- The slash needs to read across a filled shape, so it is cut into it: a wide
     line in the header's own colour, and the mark itself drawn on top. -->
<line x1="3.1" y1="12.9" x2="12.9" y2="3.1" stroke="var(--header-bg)" stroke-width="3.4" stroke-linecap="round"/>
<line x1="3.1" y1="12.9" x2="12.9" y2="3.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
<span class="hide-caret" aria-hidden="true">&#9662;</span>
</button>
</span>
<button id="settings-toggle" aria-label="Open Backchannel settings" title="Backchannel settings" aria-expanded="false" aria-controls="settings-panel">
<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
<path fill="currentColor" fill-rule="evenodd" d="M6.43 1.18A7 7 0 0 1 9.57 1.18L9.55 3.09A5.15 5.15 0 0 1 10.38 3.43L11.71 2.06A7 7 0 0 1 13.94 4.29L12.57 5.62A5.15 5.15 0 0 1 12.91 6.45L14.82 6.43A7 7 0 0 1 14.82 9.57L12.91 9.55A5.15 5.15 0 0 1 12.57 10.38L13.94 11.71A7 7 0 0 1 11.71 13.94L10.38 12.57A5.15 5.15 0 0 1 9.55 12.91L9.57 14.82A7 7 0 0 1 6.43 14.82L6.45 12.91A5.15 5.15 0 0 1 5.62 12.57L4.29 13.94A7 7 0 0 1 2.06 11.71L3.43 10.38A5.15 5.15 0 0 1 3.09 9.55L1.18 9.57A7 7 0 0 1 1.18 6.43L3.09 6.45A5.15 5.15 0 0 1 3.43 5.62L2.06 4.29A7 7 0 0 1 4.29 2.06L5.62 3.43A5.15 5.15 0 0 1 6.45 3.09ZM8 5.5A2.5 2.5 0 0 0 8 10.5A2.5 2.5 0 0 0 8 5.5Z"/>
</svg>
</button>
${
	minimize
		? `<button id="minimize" aria-label="Minimize Backchannel" title="Minimize">
<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
<line x1="3.4" y1="8" x2="12.6" y2="8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
</button>`
		: ""
}
</div>
${
	`<div id="hide-menu" class="hide-menu" role="menu" hidden>
<button type="button" role="menuitem" data-hide-scope="page">Hide on this page only</button>
<button type="button" role="menuitem" data-hide-scope="site">Hide on all ${escapeHTML(siteKey())} pages</button>
</div>`
}

</header>
`;
	}

	function settingsPanelHTML() {
		return `
<div id="settings-panel" class="settings-panel hidden">
<div id="settings-head" class="settings-head">
<button id="settings-blocked-back" class="settings-back" type="button" aria-label="Back to settings" disabled>&lsaquo;</button>
<button id="settings-crumb-root" class="settings-crumb-root" type="button" disabled>Settings</button>
<span id="settings-crumb-tail" class="settings-crumb-tail" aria-hidden="true"><span class="settings-crumb-sep">/</span><span id="settings-crumb-name">Hidden sites</span></span>
</div>
<div id="settings-panes" class="settings-panes">

<div class="settings-pane settings-pane-primary">

<div class="settings-group">
<label class="settings-option">
<input id="setting-auto-open-sidebar" data-setting="autoOpenSidebar" type="checkbox">
<span>Automatically open the sidebar when a discussion exists</span>
</label>
<div class="settings-suboptions" data-suboptions-of="autoOpenSidebar">
<label class="settings-option sub-option">
<input id="setting-auto-open-only-from-hn" data-setting="autoOpenSidebarOnlyFromHN" type="checkbox">
<span>Only when arriving from Hacker News</span>
</label>
</div>
<label class="settings-option">
<input id="setting-hide-without-discussion" data-setting="hideWithoutDiscussion" type="checkbox">
<span>Only show the button when a discussion exists</span>
</label>
<div class="settings-suboptions" data-suboptions-of="hideWithoutDiscussion">
<label class="settings-option sub-option">
<input id="setting-show-button-with-queue" data-setting="showButtonWithQueue" type="checkbox">
<span>Except when something is waiting in your queue</span>
</label>
</div>
<div class="settings-option-hint">
When off, pages with no discussion get a greyed-out button that offers to submit them.
</div>
</div>

<div class="settings-group">
<label class="settings-option">
<input id="setting-annotations" data-setting="annotations" type="checkbox">
<span>Enable article annotations <span class="op-pill">BETA</span></span>
</label>
<div class="settings-option-hint">
Highlights the passages commenters quote, so you can jump between the article and what was said about it.
</div>
<div class="settings-suboptions" data-suboptions-of="annotations">
<label class="settings-option sub-option">
<input id="setting-annotations-closed" data-setting="annotationsWhenSidebarClosed" type="checkbox">
<span>Show when sidebar closed</span>
</label>
</div>
</div>

<div class="settings-group">
<div class="settings-field">
<div class="settings-field-label">Theme</div>
<div class="segmented">
<label class="segment"><input type="radio" name="hnewhere-theme" data-setting="theme" value="auto"><span>Detect</span></label>
<label class="segment"><input type="radio" name="hnewhere-theme" data-setting="theme" value="light"><span>Light</span></label>
<label class="segment"><input type="radio" name="hnewhere-theme" data-setting="theme" value="dark"><span>Dark</span></label>
</div>
</div>

<div class="settings-field">
<div class="button-designer">
<div class="button-designer-controls">
<div class="settings-field-label">Button</div>
<div class="segmented">
<label class="segment"><input type="radio" name="hnewhere-button-shape" data-setting="buttonShape" value="circle"><span>Circle</span></label>
<label class="segment"><input type="radio" name="hnewhere-button-shape" data-setting="buttonShape" value="squircle"><span>Squircle</span></label>
</div>
<div class="stepper">
<button type="button" class="stepper-button" data-size-step="-1" aria-label="Smaller button">&#8722;</button>
<span class="stepper-value">
<input id="button-size-input" class="stepper-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" aria-label="Button size in pixels" value="44">
<span class="stepper-unit">px</span>
</span>
<button type="button" class="stepper-button" data-size-step="1" aria-label="Larger button">+</button>
</div>
<button id="settings-reset-button" class="settings-reset" type="button">Reset</button>
</div>
<div class="button-preview">
<div class="button-preview-stage">
<div id="button-preview-shape" class="button-preview-shape"
contenteditable="plaintext-only" spellcheck="false"
role="textbox" aria-label="Button label, one or two characters"
title="Type one or two characters">BC</div>
</div>
<div class="button-preview-rule"><span id="button-preview-dim" class="button-preview-dim"
contenteditable="plaintext-only" spellcheck="false" role="textbox"
aria-label="Accent colour as a hex value"
title="Type a hex colour">#237140</span></div>
</div>
</div>
</div>

</div>

<div class="settings-group">
<button id="settings-manage-sources" class="settings-link-button" type="button" data-pane="sources" data-pane-name="Sources">Sources<span class="settings-link-chevron">&rsaquo;</span></button>
</div>

<div class="settings-group">
<button id="settings-manage-blocked" class="settings-link-button" type="button" data-pane="blocked" data-pane-name="Hidden sites">Manage hidden sites<span class="settings-link-chevron">&rsaquo;</span></button>
</div>
</div>

<div class="settings-pane settings-pane-secondary" data-pane="blocked">
<div id="settings-blocked-list" class="settings-blocked-list"></div>
</div>

<div class="settings-pane settings-pane-secondary" data-pane="sources">
${sourceListHTML({ idPrefix: "setting-source-" })}
<hr class="sources-divider">
<div class="source-matrix-caption">What each source supports</div>
<div class="source-matrix-scroll">
<table class="source-matrix">
<thead><tr><th></th>${[...SOURCES.values()].map((source) => `<th>${escapeHTML(source.shortLabel || source.label)}</th>`).join("")}</tr></thead>
<tbody>
${[
	["Read", () => true],
	["Front page", (source) => hasFrontPage(source)],
	["Vote", (source) => Boolean(source.capabilities.vote)],
	["Reply", (source) => Boolean(source.capabilities.reply)],
	["Submit", (source) => Boolean(source.capabilities.submit)],
	// Listed while nothing does them. Every one of these sites has both; leaving
	// the rows out read as though nobody did, when what is true is that this does
	// not. A row of dashes is the honest version of that.
	["Favourite", (source) => Boolean(source.capabilities.favourite)],
	["Flag", (source) => Boolean(source.capabilities.flag)],
]
	.map(
		([label, supported]) => `<tr><th>${escapeHTML(label)}</th>${[
			...SOURCES.values(),
		]
			.map((source) => {
				const yes = Boolean(supported(source));
				return `<td class="${yes ? "yes" : "no"}" aria-label="${yes ? "yes" : "no"}">${yes ? "&check;" : "&ndash;"}</td>`;
			})
			.join("")}</tr>`,
	)
	.join("")}
</tbody>
</table>
</div>
</div>

</div>

<div class="settings-credits">
<a href="${escapeHTML(REPO_URL)}" target="_blank" rel="noopener noreferrer">Backchannel${SCRIPT_VERSION ? " v" + escapeHTML(SCRIPT_VERSION) : ""}</a>
<a href="${escapeHTML(REPO_URL)}/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
</div>
</div>
`;
	}

	async function wireSettingsPanel(shadow, { onAnnotationChange } = {}) {
		const settingsPanel = shadow.querySelector("#settings-panel");
		const settingsToggle = shadow.querySelector("#settings-toggle");

		if (!settingsPanel || !settingsToggle) {
			return { setSettingsOpen: () => {} };
		}

		const settingsInputs = {
			autoOpenSidebar: shadow.querySelector("#setting-auto-open-sidebar"),
			hideWithoutDiscussion: shadow.querySelector(
				"#setting-hide-without-discussion",
			),
			showButtonWithQueue: shadow.querySelector("#setting-show-button-with-queue"),
			annotations: shadow.querySelector("#setting-annotations"),
			annotationsWhenSidebarClosed: shadow.querySelector(
				"#setting-annotations-closed",
			),
			autoOpenSidebarOnlyFromHN: shadow.querySelector(
				"#setting-auto-open-only-from-hn",
			),
		};

		const settingsRadios = {
			theme: [...settingsPanel.querySelectorAll("input[data-setting='theme']")],
			buttonShape: [
				...settingsPanel.querySelectorAll("input[data-setting='buttonShape']"),
			],
		};

		const panes = shadow.querySelector("#settings-panes");
		const previewShape = shadow.querySelector("#button-preview-shape");
		const previewDim = shadow.querySelector("#button-preview-dim");
		const sizeInput = shadow.querySelector("#button-size-input");
		const stepperButtons = [
			...settingsPanel.querySelectorAll("[data-size-step]"),
		];

		const syncPanesHeight = () => {
			// scrollHeight reads 0 under display:none, so measuring while the panel
			// is closed would pin the track to zero until the next open.
			if (!panes || settingsPanel.classList.contains("hidden")) {
				return;
			}

			const active = panes.querySelector(
				panes.classList.contains("is-secondary")
					? ".settings-pane-secondary.is-active"
					: ".settings-pane-primary",
			);

			if (active) {
				panes.style.height = `${active.scrollHeight}px`;
			}
		};

		if (panes && typeof ResizeObserver === "function") {
			const paneObserver = new ResizeObserver(() => syncPanesHeight());

			for (const pane of panes.querySelectorAll(".settings-pane")) {
				paneObserver.observe(pane);
			}
		}

		const head = shadow.querySelector("#settings-head");
		const crumbBack = shadow.querySelector("#settings-blocked-back");
		const crumbRoot = shadow.querySelector("#settings-crumb-root");
		const crumbTail = shadow.querySelector("#settings-crumb-tail");
		const crumbName = shadow.querySelector("#settings-crumb-name");

		const showSecondaryPane = (paneName) => {
			const secondary = Boolean(paneName);

			for (const pane of panes?.querySelectorAll(".settings-pane-secondary") ||
				[]) {
				pane.classList.toggle("is-active", pane.dataset.pane === paneName);
			}

			if (paneName && crumbName) {
				crumbName.textContent =
					shadow.querySelector(`[data-pane="${paneName}"][data-pane-name]`)
						?.dataset.paneName || "";
			}

			panes?.classList.toggle("is-secondary", secondary);

			// One class drives the whole trail so the chevron, the de-emphasis of
			// "Settings", and the trail fading in all run off the same transition.
			head?.classList.toggle("is-secondary", secondary);
			crumbTail?.setAttribute("aria-hidden", secondary ? "false" : "true");

			// Disabled rather than hidden: both stay in the layout for the animation,
			// and disabling is what keeps them out of the tab order meanwhile.
			if (crumbBack) {
				crumbBack.disabled = !secondary;
			}

			// On the first level "Settings" is the panel's title, not a link back to
			// somewhere.
			if (crumbRoot) {
				crumbRoot.disabled = !secondary;
			}

			syncPanesHeight();
		};

		const applyButtonDesigner = (settings) => {
			const size = normalizeButtonSize(settings.buttonSize);
			const radius =
				BUTTON_SHAPES[settings.buttonShape] || BUTTON_SHAPES.circle;

			// Left alone while focused, so a half-typed value is not overwritten
			// mid-keystroke by a refresh triggered elsewhere in the panel.
			if (sizeInput && shadow.activeElement !== sizeInput) {
				sizeInput.value = String(size);
			}

			if (previewDim && shadow.activeElement !== previewDim) {
				previewDim.textContent =
					settings.accentColor ?? activeAccent(detectDarkMode()).accent;
			}

			if (previewShape) {
				previewShape.style.width = `${size}px`;
				previewShape.style.height = `${size}px`;
				previewShape.style.borderRadius = radius;
				previewShape.style.fontSize = `${buttonFontSizeFor(size)}px`;
			}

			// Disabled only when stepping cannot move at all, which is the ends of
			// the range. From a typed 63 the + button still works, landing on 64.
			for (const button of stepperButtons) {
				button.disabled =
					stepButtonSize(size, Number(button.dataset.sizeStep)) === size;
			}
		};

		// Found by the setting each group hangs off rather than by id, so a third
		// group needs markup and nothing here.
		const suboptionGroups = [
			...settingsPanel.querySelectorAll("[data-suboptions-of]"),
		];

		const applySettingsPanelState = (settings) => {
			for (const [key, input] of Object.entries(settingsInputs)) {
				if (input) {
					input.checked = Boolean(settings[key]);
				}
			}

			for (const [key, inputs] of Object.entries(settingsRadios)) {
				for (const input of inputs) {
					input.checked = input.value === settings[key];
				}
			}

			applyButtonDesigner(settings);

			const sourceState = normalizeSourceSettings(
				settings.sources,
				registeredSourceIds(),
			);

			for (const input of settingsPanel.querySelectorAll(
				"input[data-source]",
			)) {
				input.checked = Boolean(sourceState[input.dataset.source]);
				syncSourceHint(input);
			}

			for (const group of suboptionGroups) {
				const enabled = Boolean(settings[group.dataset.suboptionsOf]);

				group.classList.toggle("is-visible", enabled);

				for (const input of group.querySelectorAll("input")) {
					input.disabled = !enabled;
				}
			}
		};

		applySettingsPanelState(await loadSettings());

		let setHideMenuOpen = () => {};

		// Single place the open state changes, so the button's pressed styling and
		// aria-expanded cannot drift out of sync with the panel.
		const setSettingsOpen = (open) => {
			settingsPanel.classList.toggle("hidden", !open);
			settingsToggle.classList.toggle("is-open", open);
			settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");

			// The other half of the pair. Opening settings over an open hide menu left
			// two dropdowns down at once, one of them stacked behind the other.
			if (open) {
				setHideMenuOpen(false);
			}

			// Measured only while visible: scrollHeight reads 0 under display:none,
			// which is why this runs after the class toggle rather than before it.
			if (open) {
				syncPanesHeight();
				return;
			}

			// Reopening lands on the main pane rather than wherever it was left.
			showSecondaryPane(null);
		};

		setSettingsOpen(false);

		settingsToggle.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			setSettingsOpen(settingsPanel.classList.contains("hidden"));
		};

		// Wired here rather than per-surface because this is the one function both
		// the sidebar header and the submit popover header pass through.
		const hideSiteButton = shadow.querySelector("#hide-site");
		const hideMenu = shadow.querySelector("#hide-menu");

		setHideMenuOpen = (open) => {
			if (!hideMenu || !hideSiteButton) {
				return;
			}

			hideMenu.hidden = !open;
			hideSiteButton.classList.toggle("is-open", open);
			hideSiteButton.setAttribute("aria-expanded", open ? "true" : "false");
		};

		setHideMenuOpen(false);

		if (hideSiteButton && hideMenu) {
			hideSiteButton.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();

				const opening = hideMenu.hidden;

				if (opening) {
					setSettingsOpen(false);
				}

				setHideMenuOpen(opening);
			};

			for (const choice of hideMenu.querySelectorAll("[data-hide-scope]")) {
				choice.onclick = (event) => {
					event.preventDefault();
					event.stopPropagation();
					hideCurrentSite(choice.dataset.hideScope).catch(console.error);
				};
			}

			shadow.addEventListener("click", (event) => {
				if (event.composedPath().includes(hideSiteButton) || event.composedPath().includes(hideMenu)) {
					return;
				}

				setHideMenuOpen(false);
			});
		}

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
			const sourceInput = event.target.closest("input[data-source]");

			if (sourceInput) {
				// Collapse (or restore) this source's caveat immediately, without
				// waiting on :has() re-evaluation the browser may not do live.
				syncSourceHint(sourceInput);

				const current = await loadSettings();

				await saveSettings({
					sources: {
						...normalizeSourceSettings(current.sources, registeredSourceIds()),
						[sourceInput.dataset.source]: sourceInput.checked,
					},
				});

				await refreshSubmitAffordance(shadow);

				await refreshForSourceChange();
				return;
			}

			const input = event.target.closest("input[data-setting]");

			if (!input) {
				return;
			}

			const settings = await saveSettings({
				[input.dataset.setting]:
					input.type === "radio" ? input.value : input.checked,
			});

			applySettingsPanelState(settings);

			const setting = input.dataset.setting;

			// saveSettings re-syncs the appearance caches from its patched result, so
			// they are current by the time these refreshers run.
			if (setting === "theme") {
				refreshThemeSurfaces();
				await onAnnotationChange?.();
				return;
			}

			if (setting === "buttonShape") {
				await refreshButtonAppearance();
				return;
			}

			if (["annotations", "annotationsWhenSidebarClosed"].includes(setting)) {
				await onAnnotationChange?.();
			}
		});

		if (previewShape) {
			const commitMark = async () => {
				const next = normalizeButtonMark(previewShape.textContent);

				previewShape.textContent = next;
				applySettingsPanelState(await saveSettings({ buttonMark: next }));
				await refreshButtonAppearance();
			};

			previewShape.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					previewShape.blur();
					return;
				}

				const selection = previewShape.ownerDocument.getSelection();
				const replacing = selection && !selection.isCollapsed;

				if (
					event.key.length === 1 &&
					!event.metaKey &&
					!event.ctrlKey &&
					!replacing &&
					previewShape.textContent.trim().length >= BUTTON_MARK_MAX
				) {
					event.preventDefault();
				}
			});

			previewShape.addEventListener("blur", () => {
				commitMark().catch(console.error);
			});

			// Paste arrives as whatever was on the clipboard, including newlines and
			// markup. Taken as text and normalised rather than inserted.
			previewShape.addEventListener("paste", (event) => {
				event.preventDefault();
				previewShape.textContent = normalizeButtonMark(
					event.clipboardData?.getData("text/plain"),
				);
			});
		}

		if (previewDim) {
			const commitAccent = async () => {
				const typed = previewDim.textContent.trim();
				const parsed = typed ? parseHexColor(typed) : null;

				if (typed && !parsed) {
					// Unparseable: snap back to what is actually painting rather than
					// storing something the panel cannot use.
					applySettingsPanelState(await loadSettings());
					return;
				}

				const value = parsed ? rgbToHex(parsed) : null;

				applySettingsPanelState(await saveSettings({ accentColor: value }));
				await refreshAccentOverride();
			};

			previewDim.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					previewDim.blur();
					return;
				}

				// Escape abandons rather than commits, so a half-typed value does not
				// become the accent because the reader changed their mind.
				if (event.key === "Escape") {
					event.preventDefault();
					loadSettings()
						.then((settings) => {
							applySettingsPanelState(settings);
							previewDim.blur();
						})
						.catch(console.error);
				}
			});

			previewDim.addEventListener("blur", () => {
				commitAccent().catch(console.error);
			});

			// Paste arrives as whatever was on the clipboard. Taken as plain text so
			// a copied swatch cannot bring markup into a caption.
			previewDim.addEventListener("paste", (event) => {
				event.preventDefault();
				previewDim.textContent = (
					event.clipboardData?.getData("text/plain") ?? ""
				)
					.trim()
					.slice(0, 7);
			});
		}

		for (const button of stepperButtons) {
			button.onclick = async () => {
				const current = normalizeButtonSize(
					(await loadSettings()).buttonSize,
				);
				const next = stepButtonSize(
					current,
					Number(button.dataset.sizeStep),
				);

				// The ends of the range produce no change; skip the write rather than
				// churning storage on a click that cannot move anything.
				if (next === current) {
					return;
				}

				const settings = await saveSettings({ buttonSize: next });

				applySettingsPanelState(settings);
				await refreshButtonAppearance();
			};
		}

		if (sizeInput) {
			const commitSizeInput = async () => {
				const current = normalizeButtonSize((await loadSettings()).buttonSize);
				const parsed = Number.parseInt(sizeInput.value, 10);
				const next = Number.isFinite(parsed)
					? normalizeButtonSize(parsed)
					: current;

				if (next === current) {
					// Snap the field back: it may hold "5" or "abc" that resolved to
					// the value already in effect.
					sizeInput.value = String(current);
					return;
				}

				const settings = await saveSettings({ buttonSize: next });

				applySettingsPanelState(settings);
				await refreshButtonAppearance();
			};

			sizeInput.onchange = () => {
				commitSizeInput().catch(console.error);
			};

			sizeInput.onkeydown = (event) => {
				if (event.key !== "Enter") {
					return;
				}

				event.preventDefault();
				// Blur rather than committing directly, so Enter and click-away take
				// exactly the same path through onchange.
				sizeInput.blur();
			};
		}

		const resetButton = shadow.querySelector("#settings-reset-button");

		if (resetButton) {
			resetButton.onclick = async () => {
				const settings = await saveSettings({
					buttonShape: DEFAULT_SETTINGS.buttonShape,
					buttonSize: DEFAULT_SETTINGS.buttonSize,
					accentColor: DEFAULT_SETTINGS.accentColor,
				});

				applySettingsPanelState(settings);
				await refreshButtonAppearance();
				// Reaches further than the button: the accent is the panel's, the
				// article highlights' and the header's as well.
				await refreshAccentOverride();
			};
		}

		const blockedList = shadow.querySelector("#settings-blocked-list");

		const renderBlockedList = async () => {
			if (!blockedList) {
				return;
			}

			const sites = await loadBlockedSites();

			blockedList.replaceChildren();

			if (!sites.size) {
				const empty = document.createElement("div");

				empty.className = "settings-blocked-empty";
				empty.textContent = "No sites hidden yet.";
				blockedList.appendChild(empty);
				syncPanesHeight();

				return;
			}

			for (const host of [...sites].sort()) {
				const row = document.createElement("div");
				const name = document.createElement("span");
				const remove = document.createElement("button");
				// Storage is not language: an entry is stored as `page:host/path`
				// and read as a sentence.
				const label = describeBlockedEntry(host);

				row.className = "settings-blocked-entry";
				name.textContent = label;

				remove.type = "button";
				remove.className = "settings-blocked-remove";
				remove.textContent = "×";
				remove.setAttribute("aria-label", `Stop hiding Backchannel on ${label}`);
				remove.onclick = async () => {
					const next = await loadBlockedSites();

					next.delete(host);
					await saveBlockedSites(next);
					await renderBlockedList();
				};

				row.append(name, remove);
				blockedList.appendChild(row);
			}

			syncPanesHeight();
		};

		await renderBlockedList();

		for (const entry of settingsPanel.querySelectorAll(
			".settings-link-button[data-pane]",
		)) {
			entry.onclick = async () => {
				// The blocked list is built on demand rather than kept in sync, so it
				// has to be rendered before the pane it lives in slides in.
				if (entry.dataset.pane === "blocked") {
					await renderBlockedList();
				}

				showSecondaryPane(entry.dataset.pane);
			};
		}

		for (const control of [crumbBack, crumbRoot]) {
			if (control) {
				control.onclick = () => showSecondaryPane(null);
			}
		}

		return { setSettingsOpen };
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
		guardHostKeyboard(host);
		document.body.appendChild(host);

		const shadow = host.attachShadow({
			mode: "open",
		});

		shadow.innerHTML = `
<style>

#panel {
	all:initial;
	line-height:inherit;
	color-scheme:inherit;
	-webkit-text-size-adjust:100%;
	text-size-adjust:100%;
	position:fixed;
	right:0;
	top:0;
	height:100vh;
	height:100dvh;
	width:${width}px;
	min-width:${isPortraitPhone() ? "0" : "280px"};
	max-width:${isPortraitPhone() ? `calc(100vw - ${PORTRAIT_SIDEBAR_GUTTER}px)` : "80vw"};
    /* Without this the 1px border-left is added to the width, so a panel sized to
       the viewport renders a pixel past its left edge. */
	box-sizing:border-box;
	background:var(--bg);
	color:var(--text);
	z-index:2147483646;
	display:flex;
	flex-direction:column;
	border-left:1px solid var(--border);
	box-shadow:-3px 0 12px rgba(0,0,0,.15);
	font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
	font-size:13px;
	overflow:visible;
    /* Reading width for a single block of prose. Never applied to a container: a
       cap on any ancestor of .children narrows every reply nested under it. */
	--measure:1215px;
}

${THEME_CSS}
${CHROME_CSS}
${SUBMIT_FORM_CSS}

.submit-view {
	display:none;
	transition:opacity .16s ease;
}

#panel.submitting .submit-view {
	display:block;
}

#panel.submitting #comments-content,
#panel.submitting .browse-view,
#panel.submitting .filter-banner,
#panel.submitting .next-up {
	display:none;
}

#comments.views-swapping > .submit-view {
	opacity:0;
}

/* Sidebar-only, so deliberately not part of CHROME_CSS: #panel is position:fixed,
   which is already a containing block. */
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
		background:var(--grip);
	}

	#resize-handle.resize-handle-active::before {
		background:var(--accent);
	}
}

.submission {
	margin:0;
	padding-top:0;
}

.next-up::before,
.submission-detail::before,
.submission + .submission::before {
	content:"";
	display:block;
	height:15px;
	box-sizing:content-box;
	margin:0 -12px 12px;
	border-top:1px solid var(--border);
	border-bottom:1px solid var(--border);
    background-image:repeating-linear-gradient(
        315deg,
		var(--border) 0,
		var(--border) 1px,
		transparent 0,
        transparent 50%
    );
	background-size:6px 6px;
}

.submission + .submission {
	margin:16px -12px 0;
	padding:0 12px;
}

.submission-detail-banded {
	margin-top:0;
}

/* The band is always here and merely collapsed, so turning a filter on has
	something to grow from rather than putting a rule on screen in one frame. */
.submission-detail::before {
	transition:
		height .2s ease,
		opacity .2s ease,
		margin-bottom .2s ease,
		border-top-width .2s ease,
		border-bottom-width .2s ease;
}

.submission-detail:not(.submission-detail-banded)::before {
	height:0;
	opacity:0;
	margin-bottom:0;
	border-top-width:0;
	border-bottom-width:0;
}

.page-header {
	transition:border-bottom-color .2s ease, padding-bottom .2s ease;
}

.discussion-filtered .page-header {
	border-bottom-color:transparent;
	padding-bottom:12px;
}

#comments {
			flex:1 1 auto;
			min-height:0;
	overflow:auto;
	overflow-x:hidden;
			overscroll-behavior:contain;
	padding:12px 12px calc(32px + env(safe-area-inset-bottom, 0px));
	word-wrap:break-word;
}

.top-level-comments {
	opacity:1;
	transition:opacity .18s ease;
	will-change:opacity;
}

.comments-transitioning .top-level-comments {
	opacity:.12;
}

.filter-banner {
	max-width:720px;
	margin:12px 0 16px 14px;
	color:var(--meta);
}

.filter-banner-head {
	display:flex;
	flex-wrap:wrap;
	align-items:baseline;
	color:var(--meta);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
}

.filter-banner-title {
	color:var(--text);
}

.filter-banner-close::before {
	content:"|";
	margin:0 5px;
}

.filter-banner-quote {
	margin-top:6px;
	padding:7px 8px;
	border:1px solid var(--help-border);
	border-radius:4px;
	background:var(--help-bg);
	color:var(--quote-text);
	font-size:13px;
	font-style:italic;
	line-height:1.5;
}

.filter-banner-quote::before,
.filter-banner-quote::after {
	color:var(--quote-ornament);
	font-size:17px;
	font-style:normal;
	line-height:0;
	vertical-align:-2px;
}

.filter-banner-quote::before {
	content:"❛";
	margin-right:3px;
}

.filter-banner-quote::after {
	content:"❜";
	margin-left:3px;
}

.filter-banner-quote-comment::before,
.filter-banner-quote-comment::after {
	content:none;
}

.filter-banner-quote-comment {
	font-style:normal;
}

/* The one piece of contrast in the line, the same job .filter-banner-title does in
   the row above: without it the author reads as part of the sentence. */
.filter-banner-author {
	color:var(--text);
}

.filter-banner-author::after {
	content:" — ";
	color:var(--meta);
}

/* Unboxed, an empty quote was invisible. Boxed, it would render as a stray
   empty rectangle whenever a group carries no quote text. */
.filter-banner-quote:empty {
	display:none;
}

/* A text link on the meta row, not a floating glyph. Same rule as .meta a and
   .composer-help-toggle: no underline until hover, no colour shift. */
.filter-banner-close {
	border:0;
	padding:0;
	background:none;
	color:var(--meta);
	cursor:pointer;
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	text-decoration:none;
	text-underline-offset:2px;
}

/* Split from :hover deliberately, same as the quote links: keyboard focus must
   show regardless of pointer type. */
.filter-banner-close:focus-visible {
	text-decoration:underline;
}

@media (hover: hover) {
	.filter-banner-close:hover {
		text-decoration:underline;
	}
}

.comment {
	margin:12px 0 0 8px;
	max-width:100%;
	overflow-wrap:anywhere;
}

.top-level-comments > .comment {
	margin-left:0;
}

.children > .comment {
	margin-left:0;
	border-left:1px solid var(--border-soft);
	padding-left:6px;
}

.comment.new-comment {
	border-left-color:rgba(var(--accent-rgb),.95);
	transition:border-left-color .9s ease;
}

.top-level-comments > .comment.new-comment {
	box-shadow:-1px 0 0 rgba(var(--accent-rgb),.95);
	transition:box-shadow .9s ease;
}

/* A top-level comment has no divider under the accent, so it does fade to nothing. */
.comment.new-comment.comment-new-seen {
	border-left-color:transparent;
}

.top-level-comments > .comment.new-comment.comment-new-seen {
	box-shadow:-1px 0 0 transparent;
}

.children > .comment.new-comment.comment-new-seen {
	border-left-color:var(--border-soft);
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
	cursor:text;
	max-width:var(--measure);
}

.text p {
	margin:8px 0;
}

.text > *:first-child,
.story-text > *:first-child {
	margin-top:0;
}

.text > *:last-child,
.story-text > *:last-child {
	margin-bottom:0;
}

.text pre,
.story-text pre {
	white-space:pre-wrap;
	overflow-x:auto;
	max-width:100%;
}

.text pre,
.text ul,
.text ol,
.story-text pre,
.story-text ul,
.story-text ol {
	margin:8px 0;
}

.text ul,
.text ol,
.story-text ul,
.story-text ol {
	padding-left:22px;
}

/* A source can send a rule inside a comment body -- Hypothes.is notes carry one.
   Left alone it draws the browser's grey inset groove, which is heavier than any
   line the panel draws for itself. Matches .sources-divider, on the paragraph
   rhythm rather than the settings one. */
.text hr,
.story-text hr {
	border:none;
	border-top:1px solid var(--surface-divider);
	margin:8px 0;
}

.text a {
	color:var(--link);
}

.meta {
	color:var(--meta);
	font-size:10px;
}

.meta a {
	color:var(--meta);
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
	opacity:1;
	transition:opacity .15s ease;
}

.vote-controls-arriving {
	opacity:0;
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

.story-votelinks-inline .vote-controls {
	margin-top:2px;
}

.story-title-cell,
.story-body-cell {
	padding-left:2px;
}

.comment-layout {
	display:flex;
	align-items:flex-start;
}

/* Collapsed rather than hidden: the slot still exists so the layout is one rule,
   it just stops reserving width when nothing in the thread can be voted on. */
.comment-vote-slot-empty {
	flex-basis:0;
	width:0;
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
	border-bottom:7px solid var(--meta);
}

.vote-button-down::before {
	border-bottom:none;
	border-top:7px solid var(--meta);
	top:2px;
}

/* Split deliberately: the -active colour marks a recorded vote and must apply on
   touch, so only the :hover half is gated. */
.vote-button-active::before {
	border-bottom-color:var(--accent);
}

@media (hover: hover) {
	.vote-button:hover::before {
		border-bottom-color:var(--accent);
	}

	.vote-button-down:hover::before {
		border-top-color:var(--accent);
	}
}

.vote-button-down.vote-button-active::before {
	border-top-color:var(--muted);
}

.vote-button-neutral {
	width:auto;
	min-width:10px;
	height:auto;
	color:var(--meta);
	font:600 10px/1 Verdana, Geneva, sans-serif;
}

.vote-button-neutral::before {
	content:none;
}

.vote-button-neutral.vote-button-active {
	color:var(--accent);
}

@media (hover: hover) {
	.vote-button-neutral:hover {
		color:var(--accent);
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
	color:var(--meta);
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

.text blockquote,
.text p.comment-quote-promoted {
	position:relative;
	margin:8px 0;
	padding-left:15px;
	color:var(--quote-text);
	font-style:italic;
}

.text blockquote::before,
.text p.comment-quote-promoted::before {
	content:"❛";
	position:absolute;
	left:0;
	top:0;
	color:var(--quote-ornament);
	font-size:15px;
	font-style:normal;
	line-height:1.35;
}

.text blockquote p:first-child {
	margin-top:0;
}

.text blockquote p:last-child {
	margin-bottom:0;
}

.text blockquote .comment-quote-link-inline,
.comment-quote-promoted .comment-quote-link-inline {
	text-decoration:none;
}

/* A hairline. 1.5px was landing on three device pixels at 2x, which read as a rule
   under the text rather than as a mark on it. */
.comment-quote-link-inline {
	text-decoration:underline;
	text-decoration-color:rgba(var(--accent-rgb),.32);
	text-decoration-thickness:1px;
	text-underline-offset:2px;
}

/* Split deliberately: :focus-visible is keyboard navigation and must keep working
   regardless of pointer type, so only the :hover half is gated. */
.comment-quote-link:focus-visible {
	background:rgba(var(--accent-rgb),.06);
}

blockquote.comment-quote-link:focus-visible {
	background:rgba(var(--accent-rgb),.04);
}

@media (hover: hover) {
	.comment-quote-link:hover {
		background:rgba(var(--accent-rgb),.06);
	}

	blockquote.comment-quote-link:hover {
		background:rgba(var(--accent-rgb),.04);
	}
}

.comment-quote-redundant.comment-quote-link-inline {
	text-decoration:none;
	cursor:default;
}

/* Outside the hover media query and more specific than the rules there, so a
   quote the reader cannot usefully click does not light up under the pointer. */
.comment-quote-redundant.comment-quote-link-inline:hover,
.comment-quote-redundant.comment-quote-link-inline:focus-visible {
	background:transparent;
}

blockquote.comment-quote-redundant {
	max-height:0;
	overflow:hidden;
	margin:0;
	padding:0;
	opacity:.08;
}

.toggle {
	cursor:pointer;
}

.story-title {
	font-size:15px;
	line-height:1.25;
}

.story-title a {
	color:var(--text);
	text-decoration:none;
	word-break:break-word;
}

.story-meta {
	color:var(--meta);
	font-size:10px;
	line-height:1.4;
	padding-top:2px;
}

/* Matches .meta a, so the submitter reads the same as any commenter's name. */
.story-meta a {
	color:var(--meta);
	text-decoration:none;
}

@media (hover: hover) {
	.story-meta a:hover {
		text-decoration:underline;
	}
}

.story-text {
	margin:10px 0;
	line-height:1.45;
	cursor:text;
}

.story-text p {
	margin:8px 0;
}

.story-text a {
	color:var(--link);
}

.comment-composer {
	margin-top:10px;
	max-width:720px;
}

.reply-composer {
	overflow:hidden;
	max-height:600px;
	opacity:1;
	transition:max-height .24s ease, opacity .18s ease;
}

.reply-composer.collapsed {
	max-height:0;
	opacity:0;
    /* Nothing inside a collapsed box should be reachable by keyboard. */
	visibility:hidden;
}

/* Matches .composer-help-toggle: a text link that keeps its underline while the
   thing it toggles is open. */
.reply-link.is-open {
	text-decoration:underline;
}

.composer-text {
	display:block;
	width:100%;
	box-sizing:border-box;
	min-height:72px;
    /* Both axes, but bounded by the wrapper: a textarea dragged wider than the
       sidebar would just be clipped by #comments' overflow-x:hidden. */
	max-width:100%;
	resize:both;
	padding:6px 7px;
	border:1px solid var(--field-border);
	border-radius:4px;
	background:var(--field-bg);
	color:var(--field-text);
	font:13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    /* Whitespace is significant to HN's formatter, so never collapse it visually. */
	white-space:pre-wrap;
	tab-size:4;
	cursor:text;
}

.composer-text:focus {
	outline:2px solid rgba(var(--accent-rgb),.4);
	outline-offset:-1px;
}

.composer-text:disabled {
	background:var(--field-disabled-bg);
	color:var(--muted);
}

/* space-between rather than a margin on the link, so the button stays left and the
   formatting link stays flush right however either one is relabelled. */
.composer-actions {
	display:flex;
	align-items:center;
	justify-content:space-between;
	gap:8px;
	margin-top:6px;
}

/* HN renders "add comment" as a real submit input, so it inherits the platform's
   default button chrome. Deliberately left unstyled to match. */
.composer-submit {
	cursor:pointer;
}

.composer-help-toggle {
	background:none;
	border:0;
	padding:0;
	color:var(--meta);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	cursor:pointer;
	text-decoration:none;
	text-underline-offset:2px;
}

.composer-help-toggle.is-open {
	text-decoration:underline;
}

/* Underline only, no colour shift -- exactly what .meta a does for usernames. */
@media (hover: hover) {
	.composer-help-toggle:hover {
		text-decoration:underline;
	}
}

.composer-help {
	margin-top:6px;
	padding:7px 8px;
	border:1px solid var(--help-border);
	border-radius:4px;
	background:var(--help-bg);
	color:var(--help-text);
	font-size:11px;
	line-height:1.5;
}

.composer-help p {
	margin:0;
}

.composer-help p + p {
	margin-top:5px;
}

.composer-help code {
	background:var(--code-bg);
	border-radius:2px;
	padding:0 3px;
	font-family:Menlo, Consolas, monospace;
	font-size:10px;
}

.composer-status {
	flex:1 1 auto;
	min-width:0;
	font-size:11px;
	line-height:1.4;
	color:var(--status-text);
	transition:opacity .14s ease;
}

/* Held while the message is being swapped, so one state fades out before the next
   fades in rather than the text changing under the reader. */
.composer-status.is-fading {
	opacity:0;
}

.composer-status.error {
	color:var(--error);
}

/* Braille frames rather than a spinning glyph: they animate in place without the
   baseline wobble a rotating character gives you, and need no image or keyframes. */
.composer-spinner {
	display:inline-block;
	width:1em;
	font-family:Menlo, Consolas, monospace;
	color:var(--meta);
}

.composer-status a {
	color:var(--link);
}

</style>

<div id="panel">

<div id="resize-handle" aria-hidden="true"></div>

${headerHTML({ subtitle: true, minimize: true, browse: true })}
${settingsPanelHTML()}
<div id="comments">
<div id="filter-banner" class="filter-banner hidden">
<div class="filter-banner-head">
<span class="filter-banner-title">Focused discussion</span><button id="clear-filter" class="filter-banner-close" type="button">show all comments</button>
</div>
<div id="filter-banner-quote" class="filter-banner-quote"></div>
</div>
<div id="comments-content">Loading...</div>
<div id="browse-view" class="browse-view">
<div class="browse-tabs" role="tablist">
<button id="browse-tab-queue" class="browse-tab is-collapsed" type="button" role="tab" aria-hidden="true" tabindex="-1">queue</button>
<button id="browse-tab-front" class="browse-tab is-current" type="button" role="tab">front pages</button>
</div>
<div id="browse-blend-note" class="browse-blend-note" hidden></div>
<div id="browse-list"></div>
</div>
<div id="submit-view" class="submit-view"></div>
<div id="next-up" class="next-up hidden"></div>
</div>

</div>
`;

		const panel = shadow.querySelector("#panel");

		// Applied to the host, not the panel, so the custom properties inherit into
		// everything in this shadow tree.
		const stopWatchingTheme = watchTheme(host);
		const filterBanner = shadow.querySelector("#filter-banner");
		const filterBannerQuote = shadow.querySelector("#filter-banner-quote");
		const clearFilterButton = shadow.querySelector("#clear-filter");

		// Stop scroll/touch events moving out of sidebar so sites with
		// JS scroll hijacking (wheel listeners on window) don't scroll behind
		for (const type of ["wheel", "touchmove"]) {
			host.addEventListener(type, (event) => event.stopPropagation());
		}

		// Shared with the submit popover; the annotation refresh is the one piece
		// that only makes sense here, so it is passed in rather than assumed.
		const { setSettingsOpen } = await wireSettingsPanel(shadow, {
			onAnnotationChange: refreshArticleAnnotations,
		});

		clearFilterButton.onclick = (event) => {
			event.preventDefault();
			event.stopPropagation();
			clearCommentFilter({ restore: true });
		};

		let resizing = false;
		let startX = 0;
		let startWidth = 0;
		// Set once a width has been dragged, so the orientation handling below knows
		// to leave a deliberately chosen width alone.
		let userResized = false;

		const resizeHandle = shadow.querySelector("#resize-handle");

		const onResizeMouseDown = (e) => {
			// Ignore anything but a primary-button drag, so a right-click on the edge
			// cannot leave the panel stuck in a resize that never gets a mouseup.
			if (e.button !== 0) {
				return;
			}

			resizing = true;
			startX = e.clientX;
			startWidth = panel.offsetWidth;

			document.body.style.userSelect = "none";
			document.body.style.cursor = "col-resize";

			e.preventDefault();
		};

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
		};

		resizeHandle?.addEventListener("mousedown", onResizeMouseDown);
		document.addEventListener("mousemove", onMouseMove);
		document.addEventListener("mouseup", onMouseUp);

		let destroyed = false;

		// Touch never fires the mouse drag above, so resizing is wired separately
		// here. Non-passive so preventDefault can stop the page scrolling mid-drag.
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

		let wasPortrait = isPortraitPhone();

		const clampSidebarWidth = () => {
			const maxWidth = maxSidebarWidth();
			const portrait = isPortraitPhone();

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
			resizeHandle?.removeEventListener("mousedown", onResizeMouseDown);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("resize", clampSidebarWidth);
			stopWatchingTheme();

			if (sidebar === host) {
				clearArticleAnnotations();
				sidebarUI = null;
			}
		};

		shadow.querySelector("#minimize").onclick = async () => {
			host.style.display = "none";
			clearArticleAnnotations();
			setSettingsOpen(false);

			if (sidebarHasDiscussion) {
				await saveSidebarState("collapsed");
				await createRestoreButton();
			} else if (location.hostname === "news.ycombinator.com") {
				// Back to the button that opened it. A submit button here would be
				// offering to submit Hacker News to Hacker News.
				await offerQueueOnHN();
			} else {
				await createSubmitButton();
			}

			await refreshArticleAnnotations();
		};

		document
			.querySelectorAll(
				"#hn-restore-button, #hn-collapse-button, #hn-submit-button",
			)
			.forEach((button) => destroyFloatingButton(button));

		sidebar = host;

		const ui = {
			shadow,
			body: shadow.querySelector("#comments-content"),
			headerSubtitle: shadow.querySelector("#header-subtitle"),
			filterBanner,
			filterBannerQuote,
		};

		const browseToggle = shadow.querySelector("#browse-toggle");

		if (browseToggle) {
			browseToggle.onclick = () => {
				// Pressing the root goes to the root, which is where Cancel goes.
				if (isSubmitting(ui)) {
					setBrowseMode(ui, true);
					return;
				}

				// Read off the panel rather than kept in a flag of its own, so a
				// teardown that rebuilds the panel cannot leave the two disagreeing.
				setBrowseMode(ui, !isBrowsing(ui));
			};
		}

		for (const [id, tab] of [
			["#browse-tab-front", "front"],
			["#browse-tab-queue", "queue"],
		]) {
			const button = shadow.querySelector(id);

			if (button) {
				button.onclick = () => {
					scrollBrowseToTop(ui);
					renderBrowseView(ui, { tab }).catch(console.error);
				};
			}
		}

		const submitButton = shadow.querySelector("#header-submit");

		if (submitButton) {
			submitButton.onclick = () => {
				scrollBrowseToTop(ui);
				setSubmitMode(ui, true).catch(console.error);
			};
		}

		refreshQueueCount(shadow).catch(console.error);
		refreshNextUp(shadow).catch(console.error);

		shadow.addEventListener("click", (event) => {
			const button = event.target?.closest?.("[data-item-action-id]");

			if (button) {
				event.preventDefault();
				submitItemAction(button).catch(console.error);
			}
		});

		return ui;
	}

	// -------------------------
	// Story rendering
	// -------------------------

	function renderStory(story, container, options = {}) {
		if (!story?.id) {
			return null;
		}

		const storyID = String(story.id);
		const hnURL = discussionURL(story);
		const title = options.title ?? story.title;

		// Flag and favourite are Hacker News features. A source without them must not
		// be given links that would act on an item id Hacker News never issued.
		const showActions = options.actions !== false;
		const showTitle = options.showTitle !== false;
		// Separate from `actions`, which is about voting. A source can allow one and
		// not the other, and the front-page rows pass neither.
		const showComposer = options.compose === true;
		const storyAuthor = story.author ?? story.by;
		const storyCreatedAt = story.createdAt ?? story.time;
		const storyScore = story.score ?? story.points;
		const ageLabel = getSource(story.source)?.ageLabel || "";
		const storyCommentCount = story.commentCount ?? story.descendants ?? 0;
		const storyBodyHTML = story.bodyHTML ?? story.text;

		// Lifted out because it goes in one of two cells: beside the title when
		// there is one, and beside the byline when there is not.
		const voteControlsHTML = `<span class="story-vote-controls vote-controls hidden"
	data-hn-vote-source="${escapeHTML(String(story.source || "hn"))}"
	data-hn-vote-story-id="${escapeHTML(storyID)}"
	data-hn-vote-item-id="${escapeHTML(storyID)}"></span>`;

		const wrapper = document.createElement("div");
		wrapper.innerHTML = `

	<div class="story">
	<table class="story-table" role="presentation">
	<tbody>
	${
		showTitle
			? `<tr>
	<td class="story-votelinks">
	${voteControlsHTML}
	</td>
	<td class="story-title-cell">
	<div class="story-title">
	${
		hnURL
			? `<a target="_blank" rel="noopener noreferrer"
	href="${escapeHTML(hnURL)}"
	title="Open this discussion where it lives">
	${escapeHTML(title)}
	</a>`
			: escapeHTML(title)
	}
	</div>
	</td>
	</tr>`
			: ""
	}
	<tr>
	<td class="${showTitle ? "story-votespacer" : "story-votelinks story-votelinks-inline"}">${showTitle ? "" : voteControlsHTML}</td>
	<td class="story-body-cell">
	<div class="story-meta">
	${
		storyScore === null || storyScore === undefined
			? ""
			: `<span class="story-score" data-story-score-id="${escapeHTML(storyID)}" data-story-score="${escapeHTML(String(storyScore))}">${storyScore}</span> points `
	}${
		// "by" belongs to the name, so a discussion nobody authored drops both
		// rather than trailing a preposition into the timestamp.
		storyAuthor ? `by ${authorLinkHTML(story.source, storyAuthor)} ` : ""
	}${
		ageLabel ? escapeHTML(ageLabel) + " " : ""
	}<span class="item-age" data-age-id="${escapeHTML(storyID)}">${timeAgo(storyCreatedAt)}</span><span class="story-vote-status" data-vote-status-id="${escapeHTML(storyID)}"></span>
	${showActions ? itemActionLinksHTML(storyID, story.source || "hn") : ""}
	${
		// The separator belongs to the link, so a source with no page of its own
		// renders neither rather than leaving a bare pipe pointing nowhere.
		showTitle || !hnURL
			? ""
			: `| <a class="story-open-link" target="_blank" rel="noopener noreferrer"
	href="${escapeHTML(hnURL)}">open on ${escapeHTML(sourceShortLabel(story))}</a>`
	}
	|
	<span class="story-comment-count">${storyCommentCount}</span> comments
	</div>
	${
		storyBodyHTML
			? `
	<div class="story-text">
	${sanitizeHTML(storyBodyHTML)}
	</div>
	`
			: ""
	}
	${
		showComposer
			? composerHTML({ label: "add comment", placeholder: "Add a comment…" })
			: ""
	}
	</td>
	</tr>
	</tbody>
	</table>
	</div>

<br>

`;
		const storyElement = wrapper.firstElementChild;
		storyElement.dataset.storyId = storyID;

		// Same treatment a comment gets: a story's opening paragraph arrives unwrapped
		// too, so without this the first-child rule would land on its second paragraph.
		wrapLooseCommentText(storyElement.querySelector(".story-text"));

		container.appendChild(storyElement);

		wireComposer(storyElement.querySelector(".comment-composer"), {
			source: story.source,
			storyID,
		});

		return storyElement;
	}

	// -------------------------
	// Comment composer
	// -------------------------

	const openCommentBridgePopup = createBridgeChannel(
		COMMENT_BRIDGE_MESSAGE_SOURCE,
	);

	function composerHTML({ label, placeholder }) {
		return `
	<div class="comment-composer">
	<textarea class="composer-text" rows="4" placeholder="${escapeHTML(placeholder)}" aria-label="${escapeHTML(label)}"></textarea>
	<div class="composer-actions">
	<button type="submit" class="composer-submit">${escapeHTML(label)}</button>
	<div class="composer-status hidden" role="status"></div>
	<button type="button" class="composer-help-toggle" aria-expanded="false">formatting</button>
	</div>
	<div class="composer-help hidden">
	<p>Blank lines separate paragraphs.</p>
	<p>Text surrounded by asterisks is italicized. To get a literal asterisk, use <code>\\*</code> or <code>**</code>.</p>
	<p>Text after a blank line that is indented by two or more spaces is formatted as code.</p>
	<p>Urls become links, except in the text field of a submission.</p>
	<p>If your url gets linked incorrectly, put it in <code>&lt;angle brackets&gt;</code> and it should work.</p>
	</div>
	</div>
`;
	}

	// Keyed on the comment being replied to, or the story for a top-level comment, so
	// two drafts in the same thread cannot overwrite each other.
	function composerDraftKey({ storyID, parentId }) {
		return "HNewhere:comment_draft:" + (parentId || storyID);
	}

	const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

	// Returns a stop function. The caller owns the lifetime, because the spinner has
	// to survive across the await that opens the popup and outlive any one message.
	function startSpinner(element) {
		let frame = 0;

		element.textContent = SPINNER_FRAMES[0];

		const timer = window.setInterval(() => {
			frame = (frame + 1) % SPINNER_FRAMES.length;
			element.textContent = SPINNER_FRAMES[frame];
		}, 90);

		return () => window.clearInterval(timer);
	}

	// parentId set means this is a reply to that comment; absent means a top-level
	// comment on the story. Everything else about the two is identical.
	function wireComposer(
		composer,
		{ source = "hn", storyID, parentId = null, onPosted } = {},
	) {
		if (!composer) {
			return null;
		}

		const draftKey = composerDraftKey({ storyID, parentId });
		const textarea = composer.querySelector(".composer-text");
		const submitButton = composer.querySelector(".composer-submit");
		const submitLabel = submitButton.textContent;
		const helpToggle = composer.querySelector(".composer-help-toggle");
		const help = composer.querySelector(".composer-help");
		const status = composer.querySelector(".composer-status");

		let stopSpinner = null;
		let swapTimer = 0;

		const setStatus = (message, { error = false, html = false } = {}) => {
			stopSpinner?.();
			stopSpinner = null;

			clearTimeout(swapTimer);

			const write = () => {
				if (!message) {
					status.classList.add("hidden");
					status.replaceChildren();
					return;
				}

				status.classList.remove("hidden");
				status.classList.toggle("error", error);

				if (html) {
					status.innerHTML = message;
				} else {
					status.textContent = message;
				}
			};

			// Nothing showing yet, so there is nothing to fade out of.
			if (status.classList.contains("hidden")) {
				write();
				return;
			}

			status.classList.add("is-fading");

			swapTimer = window.setTimeout(() => {
				write();
				status.classList.remove("is-fading");
			}, 140);
		};

		const showSpinner = (label) => {
			clearTimeout(swapTimer);
			stopSpinner?.();

			status.classList.remove("hidden", "error");
			status.replaceChildren();

			const spinner = document.createElement("span");

			spinner.className = "composer-spinner";
			status.appendChild(spinner);

			if (label) {
				status.appendChild(document.createTextNode(" " + label));
			}

			status.classList.remove("is-fading");
			stopSpinner = startSpinner(spinner);
		};

		helpToggle.onclick = () => {
			const hidden = help.classList.toggle("hidden");

			helpToggle.classList.toggle("is-open", !hidden);
			helpToggle.setAttribute("aria-expanded", hidden ? "false" : "true");
		};

		// Restored asynchronously, and only into a box the reader has not already
		// started typing in, so a slow storage read cannot overwrite live input.
		load(draftKey, "")
			.then((draft) => {
				if (draft && !textarea.value) {
					textarea.value = draft;
				}
			})
			.catch(console.error);

		let saveTimer = 0;

		textarea.addEventListener("input", () => {
			clearTimeout(saveTimer);

			saveTimer = window.setTimeout(() => {
				save(draftKey, textarea.value).catch(console.error);
			}, 400);
		});

		const setBusy = (busy) => {
			submitButton.disabled = busy;
			textarea.disabled = busy;
			// Ellipsis form of whatever the button says, so "reply" and "add comment"
			// both read correctly without the caller having to supply a second label.
			submitButton.textContent = busy ? submitLabel + "…" : submitLabel;
		};

		submitButton.onclick = async () => {
			const text = textarea.value;

			if (!text.trim()) {
				setStatus("Write something first.", { error: true });
				textarea.focus();
				return;
			}

			setBusy(true);
			showSpinner();

			try {
				// Called before any await in this handler, so window.open still counts as
				// user-initiated. Do not introduce an await above this line.
				const result = await submitCommentThroughBridge(
					source,
					storyID,
					text,
					parentId,
				);

				await rememberAuthFromResult(source, result);

				if (!result?.ok) {
					setStatus(
						commentFailureMessage(result, getSource(source)?.label || "the source"),
						{ error: true },
					);
					return;
				}

				textarea.value = "";
				clearTimeout(saveTimer);
				await save(draftKey, null);

				setStatus("Posted");

				window.setTimeout(() => {
					onPosted?.();
					reloadDiscussion(storyID);
				}, 1400);
			} finally {
				setBusy(false);
			}
		};

		return { focus: () => textarea.focus() };
	}

	function submitCommentThroughBridge(sourceID, storyID, text, parentId = null) {
		const bridge = getWriteBridge(sourceID);
		const action = bridge?.actions?.reply;

		if (!action) {
			return Promise.resolve({ ok: false, reason: "no-bridge" });
		}

		const nonce = bridgeNonce();
		const session = openCommentBridgePopup(nonce, { origin: bridge.origin });

		if (session.blocked) {
			return session.result;
		}

		return (async () => {
			try {
				await stageBridgePayload(nonce, {
					kind: "comment",
					storyID: String(storyID),
					parentId: parentId ? String(parentId) : null,
					text,
					origin: location.origin,
				});
				await indexBridgePayload(nonce);

				session.navigate(
					action.url({ storyID, parentId }) +
						"#" +
						bridgeHash(action, nonce, { story: storyID }),
				);

				return await session.result;
			} finally {
				await clearBridgePayload(nonce);
			}
		})();
	}

	// #region hnewhere-test-export
	function commentFailureMessage(result, sourceLabel = "Hacker News") {
		switch (result?.reason) {
			case "popup-blocked":
				return "Your browser blocked the popup. Allow popups for this site and try again.";
			case "timeout":
				return `${sourceLabel} did not respond in time. Check the popup window — your draft is saved.`;
			case "not-logged-in":
				return `Log in to ${sourceLabel} in the popup, then submit again.`;
			case "rate-limited":
				return `${sourceLabel} is rate limiting comments. Wait a moment and try again.`;
			case "no-form":
				return `Could not find the comment box on ${sourceLabel}. The thread may be locked.`;
			case "unconfirmed":
				return `Submitted, but ${sourceLabel} did not show the comment back. Check the thread before reposting.`;
			default:
				return result?.message || "Comment did not go through — your draft is saved.";
		}
	}
	// #endregion hnewhere-test-export

	function reloadDiscussion(storyID) {
		itemCache.clear();

		openSidebar([{ objectID: String(storyID) }]).catch(console.error);
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
		newCommentScrollObserver?.unobserve(element);
	}

	let newCommentScrollObserver = null;

	let suppressNewCommentAutoClearUntil = 0;

	function suppressNewCommentAutoClear(duration = 1200) {
		suppressNewCommentAutoClearUntil = Date.now() + duration;
	}

	function newCommentAutoClearEnabled() {
		if (typeof window.matchMedia !== "function") {
			return false;
		}

		return !window.matchMedia("(hover: hover)").matches;
	}

	function observeNewCommentForScroll(element) {
		if (!newCommentAutoClearEnabled() || typeof IntersectionObserver !== "function") {
			return;
		}

		if (!newCommentScrollObserver) {
			const root = commentScrollContainer();

			if (!root) {
				return;
			}

			newCommentScrollObserver = new IntersectionObserver(
				(entries) => {
					if (Date.now() < suppressNewCommentAutoClearUntil) {
						return;
					}

					for (const entry of entries) {
						if (entry.isIntersecting || !entry.rootBounds) {
							continue;
						}

						if (!entry.boundingClientRect.height) {
							continue;
						}

						if (entry.boundingClientRect.bottom <= entry.rootBounds.top) {
							startNewCommentFade(entry.target);
						}
					}
				},
				{ root, threshold: 0 },
			);
		}

		newCommentScrollObserver.observe(element);
	}

	function stopObservingNewComments() {
		newCommentScrollObserver?.disconnect();
		newCommentScrollObserver = null;
	}

	// -------------------------
	// Comment rendering
	// -------------------------

	async function renderChildren(
		replyKeys,
		thread,
		container,
		discussion,
		seenTime,
		collapsedKeys,
		generation = sidebarGeneration,
		parentKey = null,
	) {
		const batchSize = 5;

		for (let i = 0; i < replyKeys.length; i += batchSize) {
			const batch = replyKeys.slice(i, i + batchSize);

			await Promise.all(
				batch.map((key) =>
					renderComment(
						key,
						thread,
						container,
						discussion,
						seenTime,
						collapsedKeys,
						generation,
						parentKey,
					),
				),
			);

			await new Promise(requestAnimationFrame);
		}
	}

	// #region hnewhere-test-export
	// Tags sanitizeHTML can emit that establish a block. Deliberately not
	// SEARCH_BLOCK_TAGS, which counts BR because the text index wants a line break
	// there — here BR must stay inline, or a comment's first line would split at
	// the break and only its first fragment would be tested for a quote marker.
	const QUOTE_BLOCK_CONTAINERS = new Set(["P", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "HR"]);

	function readQuoteMarker(text) {
		const match = /^\s*((?:>\s*)+)/.exec(text || "");

		return match
			? { depth: (match[1].match(/>/g) || []).length, length: match[0].length }
			: null;
	}

	const QUOTATION_PAIRS = { '"': '"', "“": "”", "«": "»" };

	function readQuotationWrapper(text) {
		const trimmed = (text || "").trim();

		// Two marks and something between them.
		if (trimmed.length < 3) {
			return null;
		}

		const closer = QUOTATION_PAIRS[trimmed[0]];

		if (!closer || trimmed[trimmed.length - 1] !== closer) {
			return null;
		}

		const inner = trimmed.slice(1, -1);

		if (!inner.trim() || inner.includes(closer)) {
			return null;
		}

		return {
			prefix: text.length - text.trimStart().length + 1,
			suffix: text.length - text.trimEnd().length + 1,
		};
	}

	function dropLeadingCharacters(nodes, count) {
		let remaining = count;

		const walk = (node) => {
			if (remaining <= 0) {
				return;
			}

			if (node.nodeType === Node.TEXT_NODE) {
				const value = node.nodeValue || "";
				const taken = Math.min(remaining, value.length);

				node.nodeValue = value.slice(taken);
				remaining -= taken;
				return;
			}

			for (const child of [...node.childNodes]) {
				walk(child);
			}
		};

		for (const node of nodes) {
			walk(node);
		}
	}

	// The mirror of the above, for the closing mark of a quotation. `>` needs no such
	// thing -- it only ever has a front -- so this exists solely for the wrapped form.
	function dropTrailingCharacters(nodes, count) {
		let remaining = count;

		const walk = (node) => {
			if (remaining <= 0) {
				return;
			}

			if (node.nodeType === Node.TEXT_NODE) {
				const value = node.nodeValue || "";
				const taken = Math.min(remaining, value.length);

				node.nodeValue = value.slice(0, value.length - taken);
				remaining -= taken;
				return;
			}

			for (const child of [...node.childNodes].reverse()) {
				walk(child);
			}
		};

		for (const node of [...nodes].reverse()) {
			walk(node);
		}
	}

	function buildQuoteTree(lines) {
		const quote = document.createElement("blockquote");
		let index = 0;

		while (index < lines.length) {
			if (lines[index].depth <= 1) {
				const paragraph = document.createElement("p");

				for (const node of lines[index].nodes) {
					paragraph.appendChild(node);
				}

				if (paragraph.textContent.trim()) {
					quote.appendChild(paragraph);
				}

				index += 1;
				continue;
			}

			const start = index;

			while (index < lines.length && lines[index].depth > 1) {
				index += 1;
			}

			quote.appendChild(
				buildQuoteTree(
					lines.slice(start, index).map((line) => ({ ...line, depth: line.depth - 1 })),
				),
			);
		}

		return quote;
	}

	function partitionCommentBlocks(root) {
		const blocks = [];
		let loose = null;

		for (const node of [...root.childNodes]) {
			if (node.nodeType === Node.ELEMENT_NODE && QUOTE_BLOCK_CONTAINERS.has(node.tagName)) {
				loose = null;
				blocks.push({ nodes: [node], element: node });
				continue;
			}

			if (!loose) {
				loose = { nodes: [], element: null };
				blocks.push(loose);
			}

			loose.nodes.push(node);
		}

		for (const block of blocks) {
			const text = block.nodes.map((node) => node.textContent || "").join("");

			block.blank = !text.trim();
			block.depth = 0;

			// A quote line is a bare leading run or a <p>. A <pre> is excluded on
			// purpose: shell prompts and diffs legitimately begin lines with `>`.
			if (block.blank || (block.element && block.element.tagName !== "P")) {
				continue;
			}

			const marker = readQuoteMarker(text);

			if (marker) {
				block.depth = marker.depth;
				block.prefix = marker.length;
				continue;
			}

			// Tried second, so a line carrying both -- `> "quoted"` -- keeps its `>`
			// depth and its marks, which is what the commenter typed.
			const wrapper = readQuotationWrapper(text);

			if (wrapper) {
				block.depth = 1;
				block.prefix = wrapper.prefix;
				block.suffix = wrapper.suffix;
			}
		}

		return blocks;
	}

	function foldQuoteRun(root, run) {
		const lines = [];

		for (const block of run) {
			if (block.blank) {
				continue;
			}

			const nodes = block.element ? [...block.element.childNodes] : block.nodes;

			dropTrailingCharacters(nodes, block.suffix || 0);
			dropLeadingCharacters(nodes, block.prefix);
			lines.push({ depth: block.depth, nodes });
		}

		// Hold the position before building, because building moves the run's own
		// nodes into the new blockquote and they can no longer anchor the insert.
		const placeholder = document.createComment("");

		root.insertBefore(placeholder, run[0].nodes[0]);
		root.replaceChild(buildQuoteTree(lines), placeholder);

		// Whatever the tree did not adopt — emptied <p> shells, blank lines — is
		// still a direct child of root and is now redundant.
		for (const block of run) {
			for (const node of block.nodes) {
				if (node.parentNode === root) {
					node.remove();
				}
			}
		}
	}

	function foldQuoteBlocks(root) {
		if (!root) {
			return;
		}

		const blocks = partitionCommentBlocks(root);
		let index = 0;

		while (index < blocks.length) {
			if (!blocks[index].depth) {
				index += 1;
				continue;
			}

			// Blank blocks do not break a run; they are absorbed and dropped, so a
			// stray whitespace node between two quote lines cannot split the quote.
			let last = index;
			let end = index + 1;

			while (end < blocks.length && (blocks[end].depth || blocks[end].blank)) {
				if (blocks[end].depth) {
					last = end;
				}

				end += 1;
			}

			foldQuoteRun(root, blocks.slice(index, last + 1));
			index = last + 1;
		}
	}

	// Blocks that stand on their own. Anything else at the top level of a comment is
	// inline and belongs to whatever paragraph surrounds it.
	const COMMENT_BLOCK_TAGS = new Set([
		"P",
		"BLOCKQUOTE",
		"PRE",
		"DIV",
		"UL",
		"OL",
		"TABLE",
	]);

	function wrapLooseCommentText(root) {
		if (!root) {
			return;
		}

		let run = [];

		const flush = () => {
			// A run of nothing but whitespace is the surrounding template's own
			// indentation. Wrapping it would invent a paragraph.
			const meaningful = run.some(
				(node) => node.nodeType !== 3 || node.textContent.trim(),
			);

			if (run.length && meaningful) {
				const paragraph = document.createElement("p");
				run[0].before(paragraph);
				paragraph.append(...run);
			}

			run = [];
		};

		for (const node of [...root.childNodes]) {
			if (node.nodeType === 1 && COMMENT_BLOCK_TAGS.has(node.tagName)) {
				flush();
				continue;
			}

			run.push(node);
		}

		flush();
	}

	// #endregion hnewhere-test-export

	async function renderComment(
		key,
		thread,
		container,
		discussion,
		seenTime = 0,
		collapsedKeys = new Set(),
		generation = sidebarGeneration,
		parentKey = null,
	) {
		const comment = await thread.getComment(key);

		if (generation !== sidebarGeneration) {
			return;
		}

		if (!comment || comment.deleted) return;
		const div = document.createElement("div");

		const storyID = discussion.id;

		div.className = "comment";
		div.dataset.commentId = comment.key;
		div.dataset.storyId = String(storyID);

		if (isNewComment(comment, seenTime)) {
			div.classList.add("new-comment");
		}

		const replies = comment.replyKeys;
		const commentID = String(comment.id);
		const capabilities = getSource(comment.source)?.capabilities || {};
		const threadCanVote = renderedSourcesCanVote();

		div.innerHTML = `
      <div class="comment-layout">
      <span class="comment-vote-slot${threadCanVote ? "" : " comment-vote-slot-empty"}">
      <span class="comment-vote-controls vote-controls hidden"
      data-hn-vote-source="${escapeHTML(String(comment.source || "hn"))}"
      data-hn-vote-story-id="${escapeHTML(String(storyID))}"
      data-hn-vote-item-id="${escapeHTML(commentID)}"></span>
      </span>

      <div class="comment-main">
      <div class="meta">

      ${authorLinkHTML(comment.source, comment.author)}

		${comment.isOP ? `<span class="op-pill">OP</span>` : ""}

		${
				parentKey === null && discussion.label && sidebarSourceKeys.size > 1
					? `<span class="comment-source">${escapeHTML(
							liveDiscussions.has(discussion.key)
								? discussion.baseLabel || discussion.label
								: discussion.label,
						)}</span>`
					: ""
			}

		<span class="item-age" data-age-id="${escapeHTML(commentID)}">${timeAgo(comment.createdAt)}</span><span class="comment-vote-status" data-vote-status-id="${escapeHTML(commentID)}"></span>

		${
				capabilities.reply
					? `|

      <a class="reply-link" href="#">
      reply
		</a>`
					: ""
			}

      |

      <a class="focus-link" href="#">
      focus
      </a>
		${capabilities.vote ? itemActionLinksHTML(commentID, comment.source || "hn") : ""}

      <span class="toggle">
      [–]
      </span>

      </div>

      <div class="comment-content">
       	<div class="text">
        		${sanitizeHTML(comment.bodyHTML) || ""}
       	</div>
       	${
					// Collapsed, so it was invisible either way -- but a reply box with
					// no reply link to open it is markup that can never be reached.
					capabilities.reply
						? `<div class="reply-composer collapsed">
       	${composerHTML({ label: "reply", placeholder: "Reply…" })}
       	</div>`
						: ""
				}
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

		// After folding, so the quote detector still sees the raw line structure it
		// partitions on rather than paragraphs this put around it.
		foldQuoteBlocks(textElement);
		wrapLooseCommentText(textElement);

		renderedComments.push({
			id: comment.key,
			source: comment.source,
			discussionKey: discussion.key,
			storyID,
			parentId: parentKey,
			author: comment.author,
			time: comment.createdAt,
			textHTML: comment.bodyHTML,
			element: div,
			textElement,
			contentElement: content,
			toggleElement: toggle,
			sectionElement: div.closest(".submission"),
			matchedGroupKeys: new Set(),
		});

		if (collapsedKeys.has(comment.key)) {
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

			observeNewCommentForScroll(div);
		}

		toggle.onclick = async () => {
			const hidden = content.classList.toggle("hidden");

			toggle.textContent = hidden ? "[+]" : "[–]";

			await toggleCollapsed(comment.key, hidden);
		};

		const replyButton = div.querySelector(".reply-link");
		const focusButton = div.querySelector(".focus-link");
		const replyComposer = div.querySelector(".reply-composer");

		let composerAPI = null;

		// Absent on a read-only source, where the link was never rendered.
		if (replyButton) {
			replyButton.onclick = function (event) {
				event.preventDefault();

				const opening = replyComposer.classList.contains("collapsed");

				replyComposer.classList.toggle("collapsed", !opening);
				replyButton.classList.toggle("is-open", opening);

				if (!opening) {
					return;
				}

				// Expanding a collapsed reply box inside a collapsed comment would put it
				// somewhere invisible, so make sure the comment itself is showing.
				if (content.classList.contains("hidden")) {
					content.classList.remove("hidden");
					toggle.textContent = "[–]";
					toggleCollapsed(comment.key, false).catch(console.error);
				}

				// comment.id, not comment.key: this becomes HN's own reply URL, and a
				// namespaced value lands on a 404.
				composerAPI ||= wireComposer(
					replyComposer.querySelector(".comment-composer"),
					{
						source: comment.source,
						storyID,
						parentId: comment.id,
					},
				);

				composerAPI?.focus();
			};
		}

		focusButton.onclick = function (event) {
			event.preventDefault();
			applyCommentFocus(comment.key);
		};

		if (replies.length) {
			await renderChildren(
				replies,
				thread,
				children,
				discussion,
				seenTime,
				collapsedKeys,
				generation,
				comment.key,
			);
		}

		mountMoreReplies(comment.more, thread, children, discussion, {
			seenTime,
			collapsedKeys,
			generation,
			parentKey: comment.key,
		});
	}

	function renderedSourcesCanVote() {
		return [...SOURCES.values()].some(
			(source) => source.capabilities.vote && sidebarSourceKeys.has(source.id),
		);
	}

	function mountMoreReplies(more, thread, container, discussion, context) {
		if (!more?.ids?.length || typeof thread.expandMore !== "function") {
			return;
		}

		let pending = more.ids;
		let remainingCount = more.count;

		const button = document.createElement("button");

		button.type = "button";
		button.className = "more-replies";
		container.appendChild(button);

		const label = () =>
			`${pluralize(remainingCount, "more reply", "more replies")}`;

		button.textContent = label();

		button.onclick = async () => {
			if (button.disabled) {
				return;
			}

			button.disabled = true;
			button.textContent = "loading…";

			const { ok, added, remaining } = await thread.expandMore(pending);

			if (context.generation !== sidebarGeneration) {
				return;
			}

			if (!ok) {
				button.disabled = false;
				button.textContent = label() + " — try again";
				return;
			}

			// Rendered before the button so the thread reads in order, and the button
			// stays beneath whatever it just produced.
			const holder = document.createElement("div");

			container.insertBefore(holder, button);

			const directKeys = added
				.filter((comment) => comment.parentKey === context.parentKey)
				.map((comment) => comment.key);

			await renderChildren(
				directKeys,
				thread,
				holder,
				discussion,
				context.seenTime,
				context.collapsedKeys,
				context.generation,
				context.parentKey,
			);

			pending = remaining;
			// Counted against everything that arrived, not just the direct children:
			// a nested reply is one fewer comment behind the gap too.
			remainingCount = Math.max(0, remainingCount - added.length);

			// The gap is genuinely closed: the source answered, and either it gave
			// back nothing or there are no ids left to ask about.
			if (!pending.length || !added.length) {
				button.remove();
				return;
			}

			button.disabled = false;
			button.textContent = label();
		};
	}

	// -------------------------
	// Discussion loading
	// -------------------------

	function discussionsPageTitle(stories) {
		const article = (stories || []).find((story) => story.articleURL)?.articleURL;

		// pageAddress, because articleURL is either the address a story was submitted
		// under or the one discovery was given -- never the address bar's.
		if (!article || sameURL(article, pageAddress())) {
			return pageTitle();
		}

		// A collective's title names a discussion -- "Hypothes.is annotations" -- and
		// is not the title of anything anybody submitted. Borrowing it for the page
		// heading puts the name of one source where the article's name belongs.
		return (
			(stories || []).find((story) => story.title && !story.collective)?.title ||
			pageTitle()
		);
	}

	async function renderDiscussions(stories, ui) {
		clearArticleAnnotations();
		clearCommentFilter({ animate: false });
		setWordmarkLocation(ui, "Discussion");
		// The observer holds the elements about to be thrown away with the list.
		stopObservingNewComments();
		renderedComments = [];
		ui.body.innerHTML = "";
		setSidebarRestingSubtitle(ui, "");

		const generation = sidebarGeneration;

		const settings = await loadSettings();

		const pending = new Set(stories.map((story) => story.key));
		const slowKeys = new Set(
			stories
				.filter((story) => isSlowSource(story.source))
				.map((story) => story.key),
		);
		const nameByKey = new Map(
			stories.map((story) => [
				story.key,
				getSource(story.source)?.shortLabel || story.source || "",
			]),
		);
		const updateLoadingLabel = () => {
			if (pending.size && [...pending].every((key) => slowKeys.has(key))) {
				const names = [...new Set([...pending].map((key) => nameByKey.get(key)))];
				setSidebarLoadingLabel(ui, "still loading " + joinNames(names) + "…");
			}
		};

		updateLoadingLabel();

		const threads = await Promise.all(
			stories.map((story) =>
				loadThreadWithCeiling(story).then((reader) => {
					pending.delete(story.key);
					updateLoadingLabel();
					return reader;
				}),
			),
		);

		if (generation !== sidebarGeneration) {
			return;
		}

		liveDiscussions.clear();

		const liveNow = Math.floor(Date.now() / 1000);

		stories.forEach((story, index) => {
			if (isDiscussionLive(threads[index], liveNow)) {
				// baseLabel, not label: the run is current by definition, so the date
				// disambiguateLabels adds is answering a question nobody asked here.
				liveDiscussions.set(story.key, story.baseLabel || story.label || "");
			}
		});

		const page = discussionsPageTitle(stories);

		const headerElement = renderPageHeader(stories, ui.body, {
			page,
			sort: settings.commentSort,
			onSortChange: () => renderDiscussions(stories, ui),
		});

		mountFilterBanner(headerElement, ui);

		sidebarSourceKeys.clear();

		for (const story of stories) {
			sidebarSourceKeys.add(story.source);
		}

		const details = document.createElement("div");

		details.className = "submission-details";
		ui.body.appendChild(details);

		const disambiguating = stories.length > 1;

		for (const story of stories) {
			const canVote = Boolean(getSource(story.source)?.capabilities.vote);
			const canReply = Boolean(getSource(story.source)?.capabilities.reply);
			const resolved = storyTitle(story, page, disambiguating);
			const block = renderStory(story, details, {
				actions: canVote,
				compose: canReply,
				title: resolved,
				showTitle: true,
			});

			if (block) {
				block.classList.add("submission-detail");
				block.dataset.discussionKey = story.key;
				block.hidden = stories.length > 1;
			}
		}

		const comments = document.createElement("div");

		comments.className = "top-level-comments";
		ui.body.appendChild(comments);

		const collapsedKeys = await loadCollapsed();
		const seenTimes = new Map(
			await Promise.all(
				stories.map(async (story) => [story.key, await getSeenTime(story.key)]),
			),
		);

		const context = new Map(
			stories.map((story, index) => [
				story.key,
				{ story, thread: threads[index] },
			]),
		);

		const entries = blendRoots(
			stories.map((story, index) => ({
				discussionKey: story.key,
				rootKeys: threads[index].rootKeys,
				story,
				thread: threads[index],
			})),
			{
				sort: settings.commentSort,
				arrivedFrom: arrivalSource(),
			},
		);

		const liveRunEnd =
			(settings.commentSort || "best") === "best"
				? entries.reduce((last, entry, index) => (entry.live ? index : last), -1)
				: -1;

		if (liveRunEnd >= 0) {
			comments.appendChild(liveBookend("open"));
		}

		const batchSize = 5;

		for (let i = 0; i < entries.length; i += batchSize) {
			if (generation !== sidebarGeneration) {
				return;
			}

			const batch = entries.slice(i, i + batchSize);

			await Promise.all(
				batch.map((entry) =>
					context.get(entry.discussionKey).thread.getComment(entry.key),
				),
			);

			for (const entry of batch) {
				if (generation !== sidebarGeneration) {
					return;
				}

				const held = context.get(entry.discussionKey);

				await renderComment(
					entry.key,
					held.thread,
					comments,
					held.story,
					seenTimes.get(entry.discussionKey) || 0,
					collapsedKeys,
					generation,
				);
			}

			await new Promise(requestAnimationFrame);
		}

		if (liveRunEnd >= 0) {
			const firstAfter = entries[liveRunEnd + 1]?.key;
			const anchor = firstAfter
				? [...comments.children].find(
						(node) => node.dataset?.commentId === firstAfter,
					) || null
				: null;

			comments.insertBefore(liveBookend("close"), anchor);
		}

		syncLiveBookends();

		for (const [index, story] of stories.entries()) {
			mountMoreReplies(threads[index].rootMore, threads[index], comments, story, {
				seenTime: seenTimes.get(story.key) || 0,
				collapsedKeys,
				generation,
				parentKey: null,
			});
		}

		reconcileWholeThreads(stories, ui);

		for (const story of stories) {
			await markSeen(story.key);
		}

		for (const story of stories) {
			if (!isSidebarVisible() || !getSource(story.source)?.capabilities.vote) {
				continue;
			}

			if (generation !== sidebarGeneration) {
				return;
			}

			setSidebarStage(ui, "votes");
			hydrateVoteControlsForStory(
				story.id,
				await loadVoteState(story.source, story.id),
			);
			hydrateDisplayAges(story.id);
		}

		if (generation === sidebarGeneration) {
			clearSidebarStage(ui);
		}
	}

	function reconcileWholeThreads(stories, ui) {
		const body = ui?.body;

		if (!body) {
			return;
		}

		let corrected = false;

		for (const story of stories) {
			if (!getSource(story.source)?.threadArrivesWhole) {
				continue;
			}

			const count = renderedCommentCount(renderedComments, story.key);

			if (!count) {
				continue;
			}

			const newest = newestCommentTime(renderedComments, story.key);

			story.commentCount = count;
			corrected = true;

			for (const block of body.querySelectorAll(".submission-detail")) {
				if (block.dataset.discussionKey !== story.key) {
					continue;
				}

				const age = block.querySelector(".item-age");
				const shown = block.querySelector(".story-comment-count");

				if (age && newest) {
					age.textContent = timeAgo(newest);
				}

				if (shown) {
					shown.textContent = String(count);
				}
			}

			for (const pill of body.querySelectorAll(".source-strip-entry")) {
				if (pill.dataset.discussionKey === story.key) {
					const shown = pill.querySelector(".source-strip-count");

					if (shown) {
						shown.textContent = String(count);
					}
				}
			}
		}

		const total = corrected && body.querySelector(".page-header-total");

		if (total) {
			total.textContent = pluralize(
				stories.reduce((sum, story) => sum + (story.commentCount || 0), 0),
				"comment",
			);
		}
	}

	function visibleLiveLabels() {
		const filter = activeCommentFilter;

		if (!filter) {
			return [...liveDiscussions.values()].filter(Boolean);
		}

		if (filter.type !== "discussion") {
			return [];
		}

		const label = liveDiscussions.get(filter.key);

		return liveDiscussions.has(filter.key) ? [label].filter(Boolean) : [];
	}

	function liveBookend(edge) {
		const node = document.createElement("div");

		node.className = `live-bookend live-bookend-${edge}`;
		node.dataset.liveBookend = edge;

		if (edge === "open") {
			// The names are their own box so they can scroll inside it. Everything up
			// to "in" holds still, because a heading that slides away entirely is
			// harder to read than one that never moved.
			node.innerHTML =
				`<span class="live-bookend-mark">LIVE</span>` +
				`<span class="live-bookend-text">` +
				`<span class="live-bookend-lead"></span>` +
				`<span class="live-bookend-names"><span class="live-bookend-scroll"></span></span>` +
				`</span>`;
		} else {
			node.innerHTML = `<span class="live-bookend-text">end of the live discussion</span>`;
		}

		return node;
	}

	// Re-read on every filter change rather than written once at render. The run is
	// a statement about what is on screen, and the filter is what changes that.
	function syncLiveBookends() {
		const host = sidebarUI?.body;

		if (!host) {
			return;
		}

		const labels = visibleLiveLabels();

		for (const node of host.querySelectorAll("[data-live-bookend]")) {
			node.classList.toggle("live-bookend-hidden", !labels.length);

			if (node.dataset.liveBookend === "open") {
				setLiveBookendNames(node, labels);
			}
		}
	}

	// Enough of a run to read a name before it moves, and enough at the far end to
	// finish the last one.
	const MARQUEE_PIXELS_PER_SECOND = 26;

	function setLiveBookendNames(node, labels) {
		const lead = node.querySelector(".live-bookend-lead");
		const names = node.querySelector(".live-bookend-names");
		const scroll = node.querySelector(".live-bookend-scroll");

		if (!lead || !names || !scroll) {
			return;
		}

		lead.textContent = labels.length ? "happening now in" : "happening now";
		scroll.textContent = labels.join(", ");

		// Measured after a frame, or the box has not been laid out and every heading
		// looks like it fits.
		requestAnimationFrame(() => {
			const overflow = scroll.scrollWidth - names.clientWidth;

			// Reduced motion keeps the ellipsis: a name the reader cannot see is a
			// smaller problem than one that will not hold still.
			if (overflow <= 1 || prefersReducedMotion()) {
				names.classList.remove("is-marquee");
				scroll.style.removeProperty("--marquee-shift");
				scroll.style.removeProperty("--marquee-duration");

				return;
			}

			// Constant speed rather than constant duration, so a long list does not
			// race and a short one does not crawl.
			scroll.style.setProperty("--marquee-shift", `-${overflow}px`);
			scroll.style.setProperty(
				"--marquee-duration",
				`${Math.max(3, overflow / MARQUEE_PIXELS_PER_SECOND).toFixed(1)}s`,
			);
			names.classList.add("is-marquee");
		});
	}

	function renderPageHeader(stories, container, options = {}) {
		const sort = options.sort || "best";
		const page = options.page ?? discussionsPageTitle(stories);
		const total = stories.reduce(
			(sum, story) => sum + (story.commentCount || 0),
			0,
		);

		const wrapper = document.createElement("div");

		const single = stories.length < 2;

		wrapper.className = single ? "page-header page-header-quiet" : "page-header";
		wrapper.innerHTML = `
<div class="page-header-title">${single ? "" : escapeHTML(page)}</div>
<div class="page-header-meta">${
	stories.length > 1
		? `<span class="page-header-total">${escapeHTML(pluralize(total, "comment"))}</span> across <button type="button" class="page-header-disclosure" aria-expanded="false" aria-controls="source-strip">${escapeHTML(pluralize(stories.length, "discussion"))}</button>`
		: ""
}</div>
<div class="source-strip${stories.length > 1 ? "" : " source-strip-single"}" id="source-strip">
${
	stories
	.map(
		(story, index) => `
<button type="button" class="source-strip-entry"
data-discussion-key="${escapeHTML(story.key)}"
title="Show only this discussion">
<span class="source-strip-label">${escapeHTML(liveDiscussions.has(story.key) ? story.baseLabel || story.label : story.label)}</span>
<span class="source-strip-count">${escapeHTML(String(story.commentCount ?? 0))}</span>${liveDiscussions.has(story.key) ? `<span class="live-pill">LIVE</span>` : ""}
</button>`,
	)
	.join("")
}
</div>`;

		const strip = wrapper.querySelector(".source-strip");
		const disclosure = wrapper.querySelector(".page-header-disclosure");

		// Nothing to disclose with a single discussion: no button was rendered, and
		// the strip stays out of the layout entirely.
		if (!disclosure) {
			container.appendChild(wrapper);

			return wrapper;
		}

		const setStripOpen = (open) => {
			strip.classList.toggle("is-open", open);
			disclosure.setAttribute("aria-expanded", open ? "true" : "false");

			strip.style.maxHeight = open ? `${strip.scrollHeight}px` : "0px";

			// Collapsed content stays in the layout for the slide, so it has to leave
			// the tab order by hand or a hidden pill can still be focused.
			for (const entry of strip.querySelectorAll(".source-strip-entry")) {
				entry.tabIndex = open ? 0 : -1;
			}
		};

		setStripOpen(false);

		disclosure.onclick = () => {
			const opening = !strip.classList.contains("is-open");

			// Put the whole blend back before the strip goes, so the reader is never
			// left filtered with the only control that undoes it off screen.
			if (stripCloseClearsFilter(opening, activeCommentFilter)) {
				clearCommentFilter({ restore: true });
				syncFilterAffordances();
			}

			setStripOpen(opening);
		};

		wrapper.querySelector(".source-strip").addEventListener("click", (event) => {
			const entry = event.target.closest(".source-strip-entry");

			if (!entry) {
				return;
			}

			const key = entry.dataset.discussionKey;

			if (activeCommentFilter?.type === "discussion" && activeCommentFilter.key === key) {
				clearCommentFilter({ restore: true });
			} else {
				applyDiscussionFilter(key);
			}

			syncFilterAffordances();
			// Left open on purpose: collapsing the strip out from under the press
			// that just filtered would take away the control needed to undo it.
			setStripOpen(true);
		});

		container.appendChild(wrapper);

		const sortRow = document.createElement("div");

		sortRow.className = "page-sort";
		sortRow.innerHTML = `
<label class="page-sort-label" for="comment-sort">Sort</label>
<select class="page-sort-select" id="comment-sort">${SORT_MODES.map(
			(mode) =>
				`<option value="${mode.id}"${mode.id === sort ? " selected" : ""}>${mode.label}</option>`,
		).join("")}</select>`;

		sortRow.querySelector(".page-sort-select").onchange = async (event) => {
			const next = event.target.value;

			if (next === sort) {
				return;
			}

			await saveSettings({ commentSort: next });

			if (typeof options.onSortChange === "function") {
				await options.onSortChange(next);
			}
		};

		container.appendChild(sortRow);

		return wrapper;
	}

	function syncSubmissionDetails() {
		const blocks = sidebarUI?.body?.querySelectorAll(".submission-detail");

		if (!blocks?.length) {
			return;
		}

		// One discussion has no ambiguity to resolve, so its block simply stays.
		if (blocks.length === 1) {
			blocks[0].hidden = false;
			return;
		}

		const active =
			activeCommentFilter?.type === "discussion" ? activeCommentFilter.key : null;

		for (const block of blocks) {
			const show = block.dataset.discussionKey === active;
			const wasHidden = block.hidden;

			block.hidden = !show;

			if (!show) {
				block.classList.remove("submission-detail-banded");
				continue;
			}

			if (!wasHidden) {
				block.classList.add("submission-detail-banded");
				continue;
			}

			void block.offsetHeight;
			requestAnimationFrame(() => {
				block.classList.add("submission-detail-banded");
			});
		}
	}

	function syncFilterAffordances() {
		const wrapper = sidebarUI?.body?.querySelector(".source-strip");

		if (wrapper) {
			syncSourceStripState(wrapper);
		}

		syncSubmissionDetails();
		syncSourceBadges();
	}

	function syncSourceBadges() {
		sidebarUI?.body?.classList.toggle(
			"discussion-filtered",
			activeCommentFilter?.type === "discussion",
		);

		sidebarUI?.body?.classList.toggle("list-filtered", Boolean(activeCommentFilter));
	}

	function syncSourceStripState(wrapper) {
		const active =
			activeCommentFilter?.type === "discussion" ? activeCommentFilter.key : null;

		for (const entry of wrapper.querySelectorAll(".source-strip-entry")) {
			entry.classList.toggle(
				"source-strip-entry-active",
				entry.dataset.discussionKey === active,
			);
		}
	}

	async function resolveDiscussions(items) {
		const resolved = items.some((item) => item && item.source)
			? items
			: (await loadStories(items)).map(hnDiscussion);

		const settings = await loadSettings();
		const enabled = new Set(
			enabledSourceIds(settings, registeredSourceIds()),
		);

		return disambiguateLabels(
			resolved.filter((discussion) => enabled.has(discussion.source)),
		);
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

	// Must outlast the .2s max-height transition on .header-subtitle, or the text
	// disappears while the header is still closing.
	const SUBTITLE_COLLAPSE_MS = 240;

	function writeSidebarSubtitle(element, text) {
		window.clearTimeout(element._hnewhereSubtitleTimer);

		if (text) {
			element.textContent = text;
			element.classList.add("header-subtitle-visible");
			return;
		}

		element.classList.remove("header-subtitle-visible");
		element._hnewhereSubtitleTimer = window.setTimeout(() => {
			element.textContent = "";
		}, SUBTITLE_COLLAPSE_MS);
	}

	function setSidebarStage(ui, stage) {
		const element = ui?.headerSubtitle;
		const label = sidebarStageLabel(stage);

		if (!element || !label) {
			return;
		}

		ui.activeStage = stage;
		writeSidebarSubtitle(element, label);
		element.classList.add("header-subtitle-stage");
		element.classList.toggle("header-subtitle-loading", !prefersReducedMotion());
	}

	function clearSidebarStage(ui) {
		const element = ui?.headerSubtitle;

		if (!element) {
			return;
		}

		ui.activeStage = null;
		element.classList.remove("header-subtitle-stage", "header-subtitle-loading");
		writeSidebarSubtitle(element, ui.restingSubtitle || "");
	}

	function setSidebarRestingSubtitle(ui, text) {
		if (!ui?.headerSubtitle) {
			return;
		}

		ui.restingSubtitle = text;

		if (!ui.activeStage) {
			writeSidebarSubtitle(ui.headerSubtitle, text);
		}
	}

	function setSidebarLoadingLabel(ui, text) {
		const element = ui?.headerSubtitle;

		if (!element || !text) {
			return;
		}

		ui.activeStage = "comments";
		writeSidebarSubtitle(element, text);
		element.classList.add("header-subtitle-stage");
		element.classList.toggle("header-subtitle-loading", !prefersReducedMotion());
	}

	function joinNames(names) {
		if (names.length <= 1) {
			return names[0] || "";
		}

		return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
	}

	// Still one open at a time, but the guard hands the in-flight run back rather
	// than only refusing, so a navigation can wait for it to unwind.
	function openSidebar(stories, options = {}) {
		if (opening) {
			return openingRun ?? Promise.resolve();
		}

		opening = true;

		openingRun = runOpenSidebar(stories, options).finally(() => {
			opening = false;
			openingRun = null;
		});

		return openingRun;
	}

	async function runOpenSidebar(stories, options = {}) {
		try {
			const generation = ++sidebarGeneration;

			const ui = await createSidebar();
			sidebarUI = ui;

			if (generation !== sidebarGeneration) {
				return;
			}

			if (options.setupOnly) {
				sidebarHasDiscussion = false;
				renderSourcePicker(ui);
				return;
			}

			if (options.browseOnly) {
				sidebarHasDiscussion = false;
				renderNoDiscussion(ui);

				if (options.queueOnly) {
					const toggle = ui.shadow.querySelector("#browse-toggle");

					ui.shadow.querySelector("#panel")?.classList.add("queue-only");

					if (toggle) {
						toggle.disabled = true;
						toggle.title = "Your queue";
					}
				}

				setBrowseMode(ui, true, {
					animate: false,
					tab: options.queueOnly ? "queue" : undefined,
				});
				slidePanelIn(ui);
				return;
			}

			sidebarHasDiscussion = true;

			if (options.startHidden && sidebar) {
				sidebar.style.display = "none";

				await createRestoreButton();
			} else if (options.remember !== false) {
				await saveSidebarState("open");
			}

			setSidebarStage(ui, "discussion");

			const loaded = await resolveDiscussions(stories);

			if (!loaded.length) {
				throw new Error("No discussions could be loaded");
			}

			if (generation !== sidebarGeneration) {
				return;
			}

			setSidebarStage(ui, "comments");

			const settings = await loadSettings();

			await renderDiscussions(loaded, ui);
			await refreshSubmitAffordance(ui.shadow);

			if (generation === sidebarGeneration) {
				// Announced only when the pass will actually run, so the sidebar never
				// claims to be doing work that is switched off.
				if (settings.annotations && shouldShowArticleAnnotations(settings)) {
					setSidebarStage(ui, "annotations");
				}

				await refreshArticleAnnotations();
			}
		} catch (e) {
			console.error(e);
		} finally {
			clearSidebarStage(sidebarUI);
			stopButtonSpinner(document.getElementById("hn-restore-button"));
		}
	}

	// -------------------------
	// Hacker News click tracking / vote bridge
	// -------------------------

	// #region hnewhere-test-export

	const ITEM_ACTION_PATHS = {
		fave: { path: "fave", params: {} },
		unfave: { path: "fave", params: { un: "t" } },
		flag: { path: "flag", params: {} },
		unflag: { path: "flag", params: { un: "t" } },
	};

	// The three every voting source has, and the two that are Hacker News's own.
	const VOTE_ACTIONS = ["up", "down", "un"];

	const ITEM_ACTIONS = [...VOTE_ACTIONS, ...Object.keys(ITEM_ACTION_PATHS)];

	function findItemActionAnchor(root, action, itemId) {
		const shape = ITEM_ACTION_PATHS[action];

		if (!shape) {
			return null;
		}

		const wantsUndo = "un" in shape.params;

		return (
			[...root.querySelectorAll("a[href]")].find((anchor) => {
				const href = anchor.getAttribute("href") || "";

				if (!href.startsWith(shape.path + "?")) {
					return false;
				}

				const params = new URL(href, HN_ORIGIN + "/").searchParams;

				return (
					params.get("id") === String(itemId) &&
					(params.get("un") === "t") === wantsUndo
				);
			}) || null
		);
	}

	// #endregion hnewhere-test-export

	function currentVoteInfoFor(root, itemId) {
		return cloneVoteInfo(
			extractVoteLinksFromRoot(root).get(String(itemId)) || null,
		);
	}

	// Runs on the page HN redirects to after the vote is committed. The hash is
	// gone by now, so the payload comes back out of sessionStorage.
	function reportHNItemAction(root) {
		const payload = peekBridgeReload(ITEM_ACTION_BRIDGE_STORAGE_KEY);

		if (!payload) {
			return null;
		}

		if (!payload.item) {
			clearBridgeReload(ITEM_ACTION_BRIDGE_STORAGE_KEY);
			return null;
		}

		const isFaveOrFlag = Boolean(ITEM_ACTION_PATHS[payload.action]);

		// Left staged: a vote that has not reached the item page yet is still in
		// flight, and this is a page it only passes through.
		if (!isFaveOrFlag && location.pathname !== "/item") {
			return null;
		}

		clearBridgeReload(ITEM_ACTION_BRIDGE_STORAGE_KEY);

		if (isFaveOrFlag) {
			const base = payload.action.startsWith("un")
				? payload.action.slice(2)
				: payload.action;
			const wanted = !payload.action.startsWith("un");

			const onLink = findItemActionAnchor(root, "un" + base, payload.item);
			const offLink = findItemActionAnchor(root, base, payload.item);

			const applied = onLink ? true : offLink ? false : wanted;

			return {
				payload,
				result: {
					ok: applied === wanted,
					reason: applied === wanted ? "updated" : "unchanged",
					action: payload.action,
					applied,
				},
			};
		}

		// Server-rendered state, so this is the vote HN actually holds.
		const voteInfo = currentVoteInfoFor(root, payload.item);
		const changed = voteInfo?.state !== payload.beforeState;

		return {
			payload,
			result: {
				ok: changed,
				reason: changed ? "updated" : "unchanged",
				voteInfo,
				// HN's own tally, read off the page it just served.
				score: extractScoreFromRoot(root, payload.item),
			},
		};
	}

	function actHNFaveFlag(payload, root) {
		const anchor = findItemActionAnchor(root, payload.action, payload.item);

		if (!anchor) {
			const base = payload.action.startsWith("un")
				? payload.action.slice(2)
				: payload.action;
			const opposite = payload.action.startsWith("un") ? base : "un" + base;

			const already = findItemActionAnchor(root, opposite, payload.item);

			return {
				ok: Boolean(already),
				reason: already ? "already" : "action-unavailable",
				action: payload.action,
				...(already ? { applied: !payload.action.startsWith("un") } : {}),
			};
		}

		const target = new URL(anchor.getAttribute("href"), HN_ORIGIN + "/");

		target.searchParams.set("goto", "item?id=" + payload.item);

		if (!stageBridgeReload(ITEM_ACTION_BRIDGE_STORAGE_KEY, payload)) {
			return {
				ok: false,
				reason: "storage-unavailable",
				action: payload.action,
			};
		}

		location.href = target.href;
		return BRIDGE_NAVIGATED;
	}

	function actHNItemAction({ payload, root }) {
		if (ITEM_ACTION_PATHS[payload.action]) {
			return actHNFaveFlag(payload, root);
		}

		const before = currentVoteInfoFor(root, payload.item);

		const anchor = root.getElementById(payload.action + "_" + payload.item);
		const voteURL =
			(anchor instanceof HTMLAnchorElement
				? normalizeVoteURL(anchor.getAttribute("href"))
				: null) ||
			(payload.action === "un" ? before?.unUrl : null) ||
			normalizeVoteURL(payload.voteURL);

		if (!voteURL) {
			return { ok: false, reason: "vote-url-missing", voteInfo: before };
		}

		const target = new URL(voteURL);
		target.searchParams.set("goto", "item?id=" + payload.item);

		if (
			!stageBridgeReload(ITEM_ACTION_BRIDGE_STORAGE_KEY, {
				...payload,
				beforeState: before?.state ?? "none",
			})
		) {
			return { ok: false, reason: "storage-unavailable", voteInfo: before };
		}

		location.href = target.href;
		return BRIDGE_NAVIGATED;
	}

	// -------------------------
	// HN side: submit bridge
	// -------------------------

	// HN's submit form posts to /r. Login pages have no such form, which is how being
	// logged out is detected.
	function findSubmitForm(root) {
		for (const form of root.querySelectorAll("form")) {
			if (
				form.querySelector('input[name="title"]') &&
				form.querySelector('input[name="url"]')
			) {
				return form;
			}
		}

		return null;
	}

	// Scrapes whatever HN said went wrong. Its error pages are bare text, so this
	// looks for the phrases rather than a structure that does not exist.
	function readSubmitError(root) {
		const text = (root.body?.textContent || "").toLowerCase();

		if (text.includes("that link has already been submitted")) {
			return { reason: "dupe" };
		}

		if (text.includes("please log in") || text.includes("bad login")) {
			return { reason: "not-logged-in" };
		}

		if (text.includes("submitting too fast")) {
			return {
				reason: "rate-limited",
				message: "Hacker News is rate limiting submissions. Try again shortly.",
			};
		}

		return null;
	}

	function reportHNSubmit(root) {
		const payload = takeBridgeReload(SUBMIT_BRIDGE_STORAGE_KEY);

		if (!payload) {
			return null;
		}

		// Already submitted by someone: HN redirects straight to the existing item.
		if (location.pathname === "/item") {
			const id = new URLSearchParams(location.search).get("id");

			return {
				payload,
				result: {
					ok: Boolean(id),
					storyID: id,
					reason: id ? "existing" : "dupe",
				},
			};
		}

		// The success case. HN drops you on /newest, so the new story has to be found
		// by matching the URL that was just submitted.
		if (location.pathname === "/newest") {
			return {
				payload,
				result: {
					ok: true,
					storyID: findSubmittedStoryID(root, payload.normalized),
					reason: "submitted",
				},
			};
		}

		// Still on a form or an error page: the submission did not go through.
		return {
			payload,
			result: {
				ok: false,
				...(readSubmitError(root) || { reason: "unknown" }),
			},
		};
	}

	function findSubmittedStoryID(root, normalized) {
		if (!normalized) {
			return null;
		}

		for (const link of root.querySelectorAll(".titleline > a")) {
			if (normalizeURL(link.href) !== normalized) {
				continue;
			}

			const row = link.closest("tr.athing");

			if (row?.id) {
				return row.id;
			}
		}

		return null;
	}

	function actHNSubmit({ payload, staged, root }) {
		const form = findSubmitForm(root);

		if (!form) {
			return { ok: false, reason: "not-logged-in" };
		}

		const titleInput = form.querySelector('input[name="title"]');
		const urlInput = form.querySelector('input[name="url"]');
		const textInput = form.querySelector('textarea[name="text"]');

		if (titleInput && staged?.title) {
			titleInput.value = staged.title.slice(0, HN_TITLE_LIMIT);
		}

		if (urlInput) {
			urlInput.value = staged?.url || "";
		}

		// Assigned verbatim, for the same reason as the comment bridge: HN's formatter
		// is the only thing that should interpret this.
		if (textInput) {
			textInput.value = staged?.text || "";
		}

		if (
			!stageBridgeReload(SUBMIT_BRIDGE_STORAGE_KEY, {
				...payload,
				normalized: staged?.normalized || null,
			})
		) {
			return { ok: false, reason: "storage-unavailable" };
		}

		// Same reasoning as the vote bridge: submit the form as a navigation rather
		// than clicking, so closing the popup cannot abort an in-flight request.
		form.submit();
		return BRIDGE_NAVIGATED;
	}

	// -------------------------
	// HN side: comment bridge
	// -------------------------

	// The top-level comment form on an item page. A locked thread or a logged-out
	// reader gets no such form, which is how both are detected.
	function findHNCommentForm(root) {
		for (const form of root.querySelectorAll("form")) {
			const textarea = form.querySelector('textarea[name="text"]');

			if (textarea) {
				return { form, textarea };
			}
		}

		return null;
	}

	function readHNCommentError(root) {
		const text = (root.body?.textContent || "").toLowerCase();

		if (text.includes("you're posting too fast") || text.includes("posting too fast")) {
			return { reason: "rate-limited" };
		}

		if (text.includes("please log in") || text.includes("bad login")) {
			return { reason: "not-logged-in" };
		}

		return null;
	}

	// #region hnewhere-test-export
	// Comparison key for "did HN echo our comment back". Whitespace and case are
	// normalized because HN reflows the text into paragraphs, and only a prefix is
	// used because it wraps long comments in markup this cannot see through.
	//
	// Emphasis markers go too, because HN eats them: a comment typed `*minimum*`
	// comes back as `<i>minimum</i>`, whose text has no asterisks. Both sides pass
	// through here, so dropping them from both is what makes the two comparable.
	// Measured at 15 of 468 real comments on one thread.
	function commentMatchKey(text) {
		return (text || "")
			.replace(/[*_]/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
			.slice(0, 120);
	}

	function commentNodeText(node) {
		if (!node) {
			return "";
		}

		const copy = node.cloneNode(true);

		for (const block of copy.querySelectorAll("p, pre, div, br")) {
			block.before(" ");
		}

		return copy.textContent || "";
	}
	// #endregion hnewhere-test-export

	function reportHNComment(root) {
		const payload = takeBridgeReload(COMMENT_BRIDGE_STORAGE_KEY);

		if (!payload) {
			return null;
		}

		const error = readHNCommentError(root);

		if (error) {
			return { payload, result: { ok: false, ...error } };
		}

		// Server-rendered proof: HN redirected back to the item page, so if the comment
		// landed it is on this page.
		return {
			payload,
			result: hnCommentEchoed(root, payload.matchKey)
				? { ok: true, reason: "posted" }
				: { ok: false, reason: "unconfirmed" },
		};
	}

	function hnCommentEchoed(root, needle) {
		if (!needle) {
			return false;
		}

		for (const node of root.querySelectorAll(".commtext")) {
			if (commentMatchKey(commentNodeText(node)).startsWith(needle.slice(0, 60))) {
				return true;
			}
		}

		return false;
	}

	function actHNComment({ payload, staged, root }) {
		const target = findHNCommentForm(root);

		if (!target) {
			return {
				ok: false,
				...(readHNCommentError(root) || { reason: "no-form" }),
			};
		}

		// Assigned verbatim. HN's formatter is the only thing that should interpret
		// this text, so nothing here trims, collapses or re-wraps it.
		target.textarea.value = staged.text;

		if (
			!stageBridgeReload(COMMENT_BRIDGE_STORAGE_KEY, {
				...payload,
				matchKey: commentMatchKey(staged.text),
			})
		) {
			return { ok: false, reason: "storage-unavailable" };
		}

		// Navigation rather than a click, for the same reason as the vote bridge: a
		// backgrounded request dies with the popup, a form navigation does not.
		target.form.submit();
		return BRIDGE_NAVIGATED;
	}

	registerWriteBridge({
		id: "hn",
		origin: HN_ORIGIN,
		hosts: ["news.ycombinator.com"],
		actions: {
			vote: {
				marker: "hnewhere-vote",
				messageSource: ITEM_ACTION_BRIDGE_MESSAGE_SOURCE,
				fields: ["item", "action", "voteURL"],
				accepts: (payload) =>
					Boolean(payload.storyID && payload.item) &&
					ITEM_ACTIONS.includes(payload.action),
				echo: (payload) => ({
					storyID: payload.storyID,
					itemId: payload.item,
					action: payload.action,
				}),
				closeAfter: 80,
				url: ({ itemId }) => commentURL(itemId),
				descriptors: hnVoteDescriptors,
				voteLinks: loadVoteLinks,
				itemActions: true,
				act: actHNItemAction,
				report: reportHNItemAction,
			},
			submit: {
				marker: "hnewhere-submit",
				messageSource: SUBMIT_BRIDGE_MESSAGE_SOURCE,
				stagesDraft: true,
				url: ({ url, title }) => submitURL(url, title),
				act: actHNSubmit,
				report: reportHNSubmit,
			},
			reply: {
				marker: "hnewhere-comment",
				messageSource: COMMENT_BRIDGE_MESSAGE_SOURCE,
				stagesDraft: true,
				requiresDraft: true,
				// /reply carries its own goto back to the item page, so both land
				// somewhere report can read the result from.
				url: ({ storyID, parentId }) =>
					parentId ? replyURL({ id: parentId }, storyID) : commentURL(storyID),
				act: actHNComment,
				report: reportHNComment,
			},
		},
	});

	// -------------------------
	// Reddit side: write bridge
	// -------------------------

	const REDDIT_WRITE_ORIGIN = "https://old.reddit.com";

	// #region hnewhere-test-export

	const REDDIT_VOTE_DIR = { up: "1", down: "-1", un: "0" };

	// A bare id from the sidebar; only the page can say whether it names a post or
	// a comment.
	function redditThing(root, itemId) {
		if (!itemId) {
			return null;
		}

		for (const prefix of ["t3_", "t1_"]) {
			const thing = root.querySelector(
				'.thing[data-fullname="' + prefix + itemId + '"]',
			);

			if (thing) {
				return thing;
			}
		}

		return null;
	}

	function redditVoteState(thing) {
		const midcol = thing?.querySelector(".midcol");

		if (!midcol) {
			return null;
		}

		if (midcol.classList.contains("likes")) {
			return "up";
		}

		if (midcol.classList.contains("dislikes")) {
			return "down";
		}

		return "none";
	}

	// What the reader may actually do here, rather than what the site supports: a
	// locked thread, an archived post or a subreddit with downvotes off simply has
	// no such arrow.
	function redditArrow(thing, action) {
		const midcol = thing?.querySelector(".midcol");

		if (!midcol) {
			return null;
		}

		if (action === "un") {
			return midcol.querySelector(".arrow.upmod, .arrow.downmod, .arrow");
		}

		return midcol.querySelector(
			action === "up"
				? ".arrow.up, .arrow.upmod"
				: ".arrow.down, .arrow.downmod",
		);
	}

	// Reddit answers with its own words; they are passed through rather than
	// reinvented, so the reader reads what Reddit said.
	function redditWriteError(errors) {
		const [code, message] = errors?.[0] || [];

		switch (String(code || "").toUpperCase()) {
			case "RATELIMIT":
				return { reason: "rate-limited", message };
			case "USER_REQUIRED":
			case "NOT_AUTHENTICATED":
				return { reason: "not-logged-in" };
			default:
				return { reason: "rejected", message: message || undefined };
		}
	}

	// #endregion hnewhere-test-export

	function redditModhash(root) {
		const field = root.querySelector('input[name="uh"]');

		if (field?.value) {
			return field.value;
		}

		const scopes = [
			typeof unsafeWindow !== "undefined" ? unsafeWindow : null,
			typeof window !== "undefined" ? window : null,
		];

		for (const scope of scopes) {
			if (scope?.___r?.modhash) {
				return scope.___r.modhash;
			}
		}

		return null;
	}

	// Same-origin, with the session the browser was already sending. Nothing is
	// read out or stored: the modhash comes off this page and is used on it.
	async function redditPost(path, fields) {
		const response = await fetch(REDDIT_WRITE_ORIGIN + path, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ ...fields, api_type: "json" }).toString(),
		});

		if (!response.ok) {
			return { ok: false, errors: null };
		}

		const json = await response.json().catch(() => null);

		return { ok: true, errors: json?.json?.errors || null };
	}

	function redditPermalink(storyID, itemId) {
		return (
			REDDIT_WRITE_ORIGIN +
			"/comments/" +
			encodeURIComponent(storyID) +
			(itemId && itemId !== storyID ? "/_/" + encodeURIComponent(itemId) : "")
		);
	}

	async function actRedditVote({ payload, root }) {
		const uh = redditModhash(root);

		if (!uh) {
			return { ok: false, reason: "not-logged-in" };
		}

		const thing = redditThing(root, payload.item);

		if (!thing) {
			return { ok: false, reason: "item-missing" };
		}

		const before = redditVoteState(thing);

		if (!redditArrow(thing, payload.action)) {
			return {
				ok: false,
				reason: "action-unavailable",
				voteInfo: cloneVoteInfo({ state: before, hasAuth: true }),
			};
		}

		const sent = await redditPost("/api/vote", {
			id: thing.getAttribute("data-fullname"),
			dir: REDDIT_VOTE_DIR[payload.action],
			uh,
		});

		if (!sent.ok || sent.errors?.length) {
			return {
				ok: false,
				...(sent.errors?.length
					? redditWriteError(sent.errors)
					: { reason: "rejected" }),
				voteInfo: cloneVoteInfo({ state: before, hasAuth: true }),
			};
		}

		// Reddit accepted it, and the page this landed on cannot say otherwise: it
		// may have been served from cache, still showing the vote before this one.
		const state = payload.action === "un" ? "none" : payload.action;

		return {
			ok: true,
			reason: "updated",
			voteInfo: cloneVoteInfo({ state, hasAuth: true }),
		};
	}

	async function actRedditReply({ payload, staged, root }) {
		const uh = redditModhash(root);

		if (!uh) {
			return { ok: false, reason: "not-logged-in" };
		}

		const thing = redditThing(root, staged.parentId || payload.storyID);

		if (!thing) {
			return { ok: false, reason: "no-form" };
		}

		const sent = await redditPost("/api/comment", {
			thing_id: thing.getAttribute("data-fullname"),
			text: staged.text,
			uh,
		});

		if (!sent.ok) {
			return { ok: false, reason: "rejected" };
		}

		if (sent.errors?.length) {
			return { ok: false, ...redditWriteError(sent.errors) };
		}

		return { ok: true, reason: "posted" };
	}

	registerWriteBridge({
		id: "reddit",
		origin: REDDIT_WRITE_ORIGIN,
		// The one Reddit whose markup this reads. The popup goes where it is sent.
		hosts: ["old.reddit.com"],
		actions: {
			vote: {
				marker: "hnewhere-vote",
				messageSource: ITEM_ACTION_BRIDGE_MESSAGE_SOURCE,
				fields: ["item", "action", "voteURL"],
				accepts: (payload) =>
					Boolean(payload.storyID && payload.item) &&
					VOTE_ACTIONS.includes(payload.action),
				echo: (payload) => ({
					storyID: payload.storyID,
					itemId: payload.item,
					action: payload.action,
				}),
				closeAfter: 80,
				url: ({ storyID, itemId }) => redditPermalink(storyID, itemId),
				descriptors: buttonVoteDescriptors,
				act: actRedditVote,
			},
			reply: {
				marker: "hnewhere-comment",
				messageSource: COMMENT_BRIDGE_MESSAGE_SOURCE,
				stagesDraft: true,
				requiresDraft: true,
				url: ({ storyID, parentId }) => redditPermalink(storyID, parentId),
				act: actRedditReply,
			},
		},
	});

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

	async function setupHNQueueLinks() {
		const rows = [...document.querySelectorAll("tr.athing")];

		if (!rows.length) {
			return;
		}

		const queued = new Set((await loadQueue()).map(queueKey));

		for (const row of rows) {
			const parsed = parseFrontPageRow(row);
			const story = parsed ? hnStory(parsed) : null;
			const subline = row.nextElementSibling?.querySelector(".subline, .subtext");

			// A job post has no subline worth appending to and cannot be read later in
			// any useful sense -- it is a listing, not an article.
			if (!story || !subline || !story.by) {
				continue;
			}

			const key = queueKey(story);

			const link = document.createElement("a");
			link.href = "#";
			link.className = "hnewhere-save-link";
			link.textContent = queued.has(key) ? "queued" : "queue";

			link.onclick = async (event) => {
				event.preventDefault();

				const entries = await loadQueue();
				const already = entries.some((entry) => queueKey(entry) === key);

				const next = already
					? removeFromQueue(entries, key)
					: addToQueue(entries, story, Date.now());

				await saveQueue(next);

				link.textContent = already ? "queue" : "queued";

				if (next.length) {
					await offerQueueOnHN();
				} else {
					const existing = document.getElementById("hn-queue-button");

					if (existing) {
						destroyFloatingButton(existing);
					}
				}
			};

			const age = subline.querySelector(".age");

			if (age) {
				age.after(document.createTextNode(" | "), link);
			} else {
				subline.append(document.createTextNode(" | "), link);
			}
		}
	}

	// -------------------------
	// URL helpers
	// -------------------------

	function queueKey(story) {
		return story.key || normalizeURL(story.url || "");
	}

	function sameURL(a, b) {
		return normalizeURL(a) === normalizeURL(b);
	}

	// #region hnewhere-test-export

	function parseFrontPageRow(row) {
		const id = Number(row.id);
		const link = row.querySelector(".titleline > a");

		// Both are real rows on a real page: HN pads the list with `pagespace` and
		// `morespace` rows carrying no title, and their ids are words.
		if (!Number.isFinite(id) || !id || !link) {
			return null;
		}

		const subtext = row.nextElementSibling?.querySelector(".subtext");

		const parsed = new URL(link.getAttribute("href") || "", HN_ORIGIN + "/");

		const url = /^https?:$/.test(parsed.protocol)
			? parsed.href
			: HN_ORIGIN + "/item?id=" + id;

		const time = Number(
			(subtext?.querySelector(".age")?.getAttribute("title") || "").split(/\s+/)[1],
		);

		const commentLink = [...(subtext?.querySelectorAll("a") || [])].find((anchor) =>
			/\bcomments?\b|\bdiscuss\b/i.test(anchor.textContent || ""),
		);

		return {
			id,
			title: (link.textContent || "").trim(),
			url,
			by: subtext?.querySelector(".hnuser")?.textContent || "",
			// Job posts carry no score. Absent is not zero, but every consumer here
			// displays it, and a displayed zero is honest about there being none.
			score: parseInt(subtext?.querySelector(".score")?.textContent || "", 10) || 0,
			time: Number.isFinite(time) ? time : 0,
			// \D+ rather than a split: the separator is a non-breaking space.
			descendants:
				parseInt((commentLink?.textContent || "").replace(/\D+/g, ""), 10) || 0,
			site: row.querySelector(".sitestr")?.textContent || "",
		};
	}

	function parseFrontPage(doc) {
		return [...doc.querySelectorAll("tr.athing")]
			.map(parseFrontPageRow)
			.filter(Boolean);
	}

	// #endregion hnewhere-test-export

	// #region hnewhere-test-export
	// True when this document was reached by clicking a link on HN. HN serves
	// <meta name="referrer" content="origin">, so the value arrives as the bare
	// origin rather than the item URL; comparing origins accepts that and a
	// full-URL referrer alike. A typed URL or a bookmark leaves it empty, which
	// makes the URL constructor throw -- that throw is the direct-visit answer.
	// The argument defaults to the real referrer and exists so tests can hand it a
	// string; document.referrer is read-only, and faking it would mean redefining a
	// property of the live document.
	function referrerIsHN(referrer = document.referrer) {
		try {
			return new URL(referrer).origin === HN_ORIGIN;
		} catch {
			return false;
		}
	}

	function shouldAutoOpenSidebar(settings, siteState = null, fromHN = false) {
		if (settings.autoOpenSidebar) {
			return settings.autoOpenSidebarOnlyFromHN ? fromHN : true;
		}

		return siteState === "open";
	}
	// #endregion hnewhere-test-export

	let arrivedFromHNReferrer = referrerIsHN();

	function forgetHNReferrer() {
		arrivedFromHNReferrer = false;
	}

	function shouldPreloadHiddenSidebar(settings, siteState = null, fromHN = false) {
		return (
			Boolean(settings.annotations) &&
			!shouldAutoOpenSidebar(settings, siteState, fromHN) &&
			Boolean(settings.annotationsWhenSidebarClosed)
		);
	}

	function isSidebarVisible() {
		return Boolean(sidebar && sidebar.style.display !== "none");
	}

	function shouldShowArticleAnnotations(settings) {
		if (!settings.annotations) {
			return false;
		}

		return isSidebarVisible() || Boolean(settings.annotationsWhenSidebarClosed);
	}

	async function ensureVoteControlsLoaded() {
		if (!isSidebarVisible() || !sidebarUI?.body) {
			return;
		}

		const containers = [
			...sidebarUI.body.querySelectorAll("[data-hn-vote-story-id]"),
		];
		const bySource = new Map();

		for (const container of containers) {
			const storyID = container.dataset.hnVoteStoryId;

			if (storyID && !bySource.has(storyID)) {
				bySource.set(storyID, container.dataset.hnVoteSource);
			}
		}

		for (const [storyID, sourceID] of bySource) {
			hydrateVoteControlsForStory(
				storyID,
				await loadVoteState(sourceID, storyID),
			);
			hydrateDisplayAges(storyID);
		}
	}

	// -------------------------
	// Article annotations
	// -------------------------

	function transitionCommentList(update, options = {}) {
		// Entering or leaving a focused discussion hides and restores comments in
		// bulk, which moves everything below them without the reader scrolling.
		suppressNewCommentAutoClear();

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
		const focusedPassage =
			redundant && group
				? normalizeSearchText(group.fullQuoteText || group.quoteText || "").text
				: "";

		for (const candidateGroup of annotationController?.groups || []) {
			for (const comment of candidateGroup.comments) {
				const redundantHere =
					Boolean(focusedPassage) &&
					Boolean(comment.quoteNormalized) &&
					focusedPassage.includes(comment.quoteNormalized);

				for (const element of comment.quoteElements || []) {
					element.classList.toggle("comment-quote-redundant", redundantHere);
				}
			}
		}
	}

	// Matches #comments' own top padding, so the banner lands where a first item
	// would sit rather than jammed against the edge.
	const FILTER_BANNER_SCROLL_MARGIN = 12;

	function commentScrollContainer() {
		return sidebarUI?.body?.closest("#comments") || null;
	}

	function captureReadingPosition() {
		const position = { pageScrollY: window.scrollY, commentId: null, offset: 0 };
		const container = commentScrollContainer();

		if (!container) {
			return position;
		}

		const top = container.getBoundingClientRect().top;

		for (const rendered of renderedComments) {
			if (rendered.element.classList.contains("comment-filter-hidden")) {
				continue;
			}

			const rect = rendered.element.getBoundingClientRect();

			// The first whose bottom edge has not yet passed the top of the viewport.
			// That is what the reader is looking at, even part-scrolled.
			if (rect.bottom > top) {
				position.commentId = rendered.id;
				position.offset = rect.top - top;
				break;
			}
		}

		return position;
	}

	// Called once the list is whole again, so the thread is measured against the
	// layout the reader is about to see rather than the filtered one.
	function restoreReadingPosition(position) {
		if (!position) {
			return;
		}

		// Putting the reader back sweeps every comment the focus had been hiding past
		// the top of the panel. None of them has been read.
		suppressNewCommentAutoClear();

		window.scrollTo({
			top: position.pageScrollY,
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});

		const container = commentScrollContainer();

		if (!container || position.commentId == null) {
			return;
		}

		const rendered = renderedComments.find(
			(comment) => comment.id === position.commentId,
		);

		if (!rendered) {
			return;
		}

		container.scrollTop +=
			rendered.element.getBoundingClientRect().top -
			container.getBoundingClientRect().top -
			position.offset;
	}

	function scrollFilterBannerToTop() {
		const banner = sidebarUI?.filterBanner;

		if (!banner || banner.classList.contains("hidden")) {
			return;
		}

		suppressNewCommentAutoClear();

		const container = commentScrollContainer();

		if (!container) {
			banner.scrollIntoView({
				behavior: prefersReducedMotion() ? "auto" : "smooth",
				block: "start",
			});
			return;
		}

		const offset =
			banner.getBoundingClientRect().top -
			container.getBoundingClientRect().top +
			container.scrollTop;

		container.scrollTo({
			top: Math.max(0, offset - FILTER_BANNER_SCROLL_MARGIN),
			behavior: prefersReducedMotion() ? "auto" : "smooth",
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

		const position = options.restore ? preFilterPosition : null;
		preFilterPosition = null;

		positionFilterBannerForComment(null);

		transitionCommentList(() => {
			// activeCommentFilter is already null above, so this restores the full
			// wording rather than needing to be told what was cleared.
			syncLiveBookends();

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
			syncFilterAffordances();
			sidebarUI?.filterBanner?.classList.add("hidden");
			if (sidebarUI?.filterBannerQuote) {
				sidebarUI.filterBannerQuote.textContent = "";
				sidebarUI.filterBannerQuote.classList.remove(
					"filter-banner-quote-comment",
				);
			}

			// Last, with every comment back in the list and the banner gone, so the
			// position it puts the reader at is the one they will actually see.
			restoreReadingPosition(position);
		}, options);
	}

	function clearArticleAnnotations() {
		stopDocumentReindex?.();
		stopDocumentReindex = null;

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
				.querySelectorAll("[data-hnewhere-quote-promoted='1']")
				.forEach((element) => {
					element.classList.remove("comment-quote-promoted");
					delete element.dataset.hnewhereQuotePromoted;
				});
		}
	}

	// #region hnewhere-test-export
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

	// #endregion hnewhere-test-export

	// #region hnewhere-test-export
	// How much of a passage a cut has to save before it is worth making. A 251
	// character quote trimmed to 220 lost its last four words to save an eighth of
	// itself: the reader got a line barely shorter that no longer ended anywhere,
	// and the words it dropped were sitting in full in the comment underneath.
	const TRUNCATE_MIN_SAVING = 0.25;

	function truncateText(text, maxLength = 120) {
		const value = String(text || "").replace(/\s+/g, " ").trim();

		if (value.length <= maxLength) {
			return value;
		}

		if (value.length * (1 - TRUNCATE_MIN_SAVING) <= maxLength) {
			return value;
		}

		const cut = value.slice(0, maxLength - 1).trimEnd();
		const lastSpace = cut.lastIndexOf(" ");

		return (
			(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() +
			"…"
		);
	}

	const COMMENT_FOCUS_PREVIEW_LENGTH = 200;

	function commentFocusPreview(comment) {
		return {
			author: comment?.author || "",
			preview: truncateText(
				comment?.textElement?.textContent || "",
				COMMENT_FOCUS_PREVIEW_LENGTH,
			),
		};
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

	// #endregion hnewhere-test-export

	// #region hnewhere-test-export
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

		// The rule addUniqueText applies, carrying the exact flag alongside the text.
		const addCandidate = (text, exact = false, context = null) => {
			const value = String(text || "").replace(/\s+/g, " ").trim();

			if (!value) {
				return;
			}

			const normalized = normalizeSearchText(value).text;

			if (normalized.length < 24 || seen.has(normalized)) {
				return;
			}

			seen.add(normalized);
			candidates.push({
				text: value,
				exact,
				prefix: context?.prefix || "",
				suffix: context?.suffix || "",
			});
		};

		// A blockquote marked exact came from a source that anchors -- a Hypothes.is
		// TextQuoteSelector -- so it is verbatim page text and goes through whole.
		// Removed here so the passes below do not expand it again.
		template.content
			.querySelectorAll("blockquote[data-hnewhere-exact='1']")
			.forEach((blockquote) => {
				addCandidate(extractTextWithBreaks(blockquote), true, {
					prefix: (blockquote.getAttribute("data-hnewhere-prefix") || "").trim(),
					suffix: (blockquote.getAttribute("data-hnewhere-suffix") || "").trim(),
				});
				blockquote.remove();
			});

		const plainText = extractTextWithBreaks(template.content);
		const lines = plainText
			.split(/\n+/)
			.map((line) => line.trim())
			.filter(Boolean);

		let currentQuote = [];

		const flushQuote = () => {
			if (!currentQuote.length) return;

			for (const segment of expandStructuredQuoteSegments(currentQuote.join("\n"))) {
				addCandidate(segment);
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

			if (line.length >= 40 && line.length <= 320) {
				addCandidate(line);
			}
		}

		flushQuote();

		template.content.querySelectorAll("blockquote").forEach((blockquote) => {
			for (const segment of expandStructuredQuoteSegments(
				extractTextWithBreaks(blockquote),
			)) {
				addCandidate(segment);
			}
		});

		for (const match of plainText.matchAll(/[“"]([^”"\n]{24,320})[”"]/g)) {
			if (match[1]) {
				for (const segment of expandSentenceLikeQuoteSegments(match[1])) {
					addCandidate(segment);
				}
			}
		}

		return candidates.sort((a, b) => {
			if (a.exact !== b.exact) {
				return a.exact ? -1 : 1;
			}

			return b.text.length - a.text.length;
		});
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

	// Where the text is, what a highlight hangs off, and what scrolls. A page in a
	// browser answers all three the same way; a PDF viewer answers none of them
	// that way, so the answers live behind this rather than inside the matcher.
	//
	// originFor is an offset ADDED to viewport rects, not a rect to subtract. For
	// HTML that is exactly the arithmetic this code always did. Deriving it from
	// the host's own rect would look tidier and be wrong: the overlay's containing
	// block is the initial containing block, not body, so a body margin would move
	// every highlight by its width.
	const HTML_DOCUMENT_SOURCE = {
		id: "html",

		buildIndex() {
			return buildTextIndex(getArticleSearchRoot(), {
				skipHidden: true,
				excludeSelectors: [
					"#hn-restore-button",
					"#hn-collapse-button",
					"[data-hnewhere-annotation-overlay]",
					"[data-hnewhere-sidebar]",
				],
			});
		},

		hostFor() {
			return document.body;
		},

		originFor() {
			return { left: window.scrollX, top: window.scrollY };
		},

		heightFor() {
			return Math.max(
				document.body.scrollHeight,
				document.documentElement.scrollHeight,
			);
		},

		scrollIntoView(range) {
			const rect = range.getBoundingClientRect();

			window.scrollTo({
				top: Math.max(0, rect.top + window.scrollY - window.innerHeight * 0.3),
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		},

		onReindex() {
			return () => {};
		},
	};

	// A PDF viewer renders two pages of fifteen and builds the rest as the reader
	// scrolls, so the DOM is never the document. pdf.js will hand over the text of
	// every page on request, which is what gets indexed instead -- a quote is then
	// found whether or not its page has been drawn yet.
	//
	// One string, with the page boundaries recorded beside it. A single space joins
	// pages so a quote cannot be matched across the seam between two of them.
	function pdfConcatenatedText(pageTexts) {
		const parts = [];
		const pageStarts = [];
		let at = 0;

		for (const text of pageTexts || []) {
			pageStarts.push(at);
			parts.push(String(text ?? ""));
			at += String(text ?? "").length + 1;
		}

		return { text: parts.join(" "), pageStarts };
	}

	// Which page an offset into that string belongs to. Binary search rather than a
	// walk: this is asked once per candidate match, on a document that can run to
	// hundreds of pages.
	function findPageByOffset(pageStarts, offset) {
		if (!pageStarts?.length || !(offset >= 0)) {
			return null;
		}

		let low = 0;
		let high = pageStarts.length - 1;

		while (low < high) {
			const mid = Math.ceil((low + high) / 2);

			if (pageStarts[mid] <= offset) {
				low = mid;
			} else {
				high = mid - 1;
			}
		}

		return { pageIndex: low, offsetInPage: offset - pageStarts[low] };
	}

	// The viewer is a page global. A userscript runs sandboxed, so it is reached
	// through unsafeWindow where the manager provides one. Absent either, there is
	// no viewer as far as this is concerned, and the fallbacks in pdfDocumentSource
	// take over.
	function pdfViewerApp() {
		const scopes = [
			typeof unsafeWindow !== "undefined" ? unsafeWindow : null,
			typeof window !== "undefined" ? window : null,
		];

		for (const scope of scopes) {
			const app = scope?.PDFViewerApplication;

			if (app?.pdfDocument) {
				return app;
			}
		}

		return null;
	}

	function pdfViewerElement() {
		return (
			document.querySelector(".pdfViewer") ||
			document.getElementById("viewerContainer") ||
			null
		);
	}

	// A page's text layer is an ordinary piece of DOM, so the ordinary index works
	// on it -- and everything downstream of an index then works unchanged. Rebuilt
	// rather than cached across renders, because pdf.js discards and recreates the
	// layer as pages come and go.
	function pdfPageIndex(pageIndex) {
		const layer = document.querySelectorAll(".page")[pageIndex]?.querySelector(
			".textLayer",
		);

		if (!layer) {
			return null;
		}

		const index = buildTextIndex(layer, {
			skipHidden: true,
			excludeSelectors: [
				"[data-hnewhere-annotation-overlay]",
				"[data-hnewhere-sidebar]",
			],
		});

		return index.normalizedText ? index : null;
	}

	// pdf.js hands over page text asynchronously, and buildIndex is synchronous
	// because every other source can answer at once. So the text is fetched ahead
	// and read from here: the first pass indexes what the DOM has, and the arrival
	// of the real text is just another reason to measure again.
	let pdfTexts = null;
	let pdfTextsFor = null;
	const pdfReindexWaiters = new Set();

	function notifyPdfReindex() {
		for (const waiter of [...pdfReindexWaiters]) {
			try {
				waiter();
			} catch (e) {
				console.error("Backchannel pdf reindex failed:", e);
			}
		}
	}

	function pdfDocumentTexts(app) {
		if (pdfTextsFor === app.pdfDocument) {
			return pdfTexts;
		}

		if (pdfTextsFor === "loading:" + app.pdfDocument.fingerprints?.[0]) {
			return null;
		}

		pdfTextsFor = "loading:" + app.pdfDocument.fingerprints?.[0];

		(async () => {
			const document_ = app.pdfDocument;
			const texts = [];

			for (let number = 1; number <= document_.numPages; number += 1) {
				const page = await document_.getPage(number);
				const content = await page.getTextContent();

				texts.push(content.items.map((item) => item.str).join(""));
			}

			// Checked after the await: the reader can have opened another file while
			// this was running, and indexing the old one would be worse than nothing.
			if (app.pdfDocument !== document_) {
				return;
			}

			pdfTexts = texts;
			pdfTextsFor = document_;
			notifyPdfReindex();
		})().catch((e) => {
			console.error("Backchannel could not read the PDF text:", e);
			pdfTextsFor = null;
		});

		return null;
	}

	// Two indexes, and they answer different questions. This one holds every page's
	// text and answers "does this quote exist, and on which page". It cannot make a
	// range: the text came from the file, not from nodes. rangeAt hands that job to
	// the page's own index once pdf.js has drawn it.
	function pdfDocumentIndex(pageTexts) {
		const joined = pdfConcatenatedText(pageTexts);
		const normalized = normalizeSearchText(joined.text);

		return {
			normalizedText: normalized.text,
			normalizedMap: normalized.map,
			pageStarts: joined.pageStarts,

			rangeAt(matchStart, matchLength) {
				const rawStart = normalized.map[matchStart];
				const at = findPageByOffset(joined.pageStarts, rawStart);
				const pageIndex = at && pdfPageIndex(at.pageIndex);

				if (!pageIndex) {
					// Found, but its page is not drawn. Absent is already an ordinary
					// outcome, and it becomes anchored on the next reindex.
					return null;
				}

				// By text, not by carrying the offset over: the extracted text and the
				// text layer disagree about whitespace, so only the words are portable.
				const needle = normalized.text.slice(
					matchStart,
					matchStart + matchLength,
				);
				const here = findNormalizedOccurrences(pageIndex.normalizedText, needle);

				if (here.length !== 1) {
					return null;
				}

				return createRangeFromMatch(pageIndex, here[0], needle.length);
			},
		};
	}

	const PDF_DOCUMENT_SOURCE = {
		id: "pdf",

		buildIndex() {
			const app = pdfViewerApp();
			const texts = app ? pdfDocumentTexts(app) : null;

			// Degraded, not broken: with no reachable viewer the drawn pages are still
			// ordinary DOM, so index those and reach less of the document.
			if (!texts?.length) {
				return HTML_DOCUMENT_SOURCE.buildIndex();
			}

			return pdfDocumentIndex(texts);
		},

		hostFor() {
			return pdfViewerElement() || document.body;
		},

		originFor(host) {
			if (!host || host === document.body) {
				return HTML_DOCUMENT_SOURCE.originFor(host);
			}

			const rect = host.getBoundingClientRect();

			return { left: -rect.left, top: -rect.top };
		},

		heightFor(host) {
			return host === document.body
				? HTML_DOCUMENT_SOURCE.heightFor(host)
				: host.scrollHeight;
		},

		scrollIntoView(range) {
			const container = document.getElementById("viewerContainer");

			if (!container) {
				HTML_DOCUMENT_SOURCE.scrollIntoView(range);
				return;
			}

			const rect = range.getBoundingClientRect();
			const box = container.getBoundingClientRect();

			container.scrollTo({
				top: Math.max(
					0,
					container.scrollTop + (rect.top - box.top) - container.clientHeight * 0.3,
				),
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		},

		// A page gaining text turns absent matches into anchored ones; a scale change
		// makes every rect stale. Both mean: measure again.
		onReindex(callback) {
			const bus = pdfViewerApp()?.eventBus;
			const events = ["textlayerrendered", "pagesloaded", "scalechanging"];

			pdfReindexWaiters.add(callback);

			if (bus?.on) {
				for (const name of events) {
					bus.on(name, callback);
				}
			}

			return () => {
				pdfReindexWaiters.delete(callback);

				if (bus?.off) {
					for (const name of events) {
						bus.off(name, callback);
					}
				}
			};
		},
	};

	// Chosen by what the page can do, never by its address or its browser. A viewer
	// whose text is unreachable simply never matches here.
	function detectDocumentSource() {
		if (pdfViewerApp() || document.querySelector(".pdfViewer .textLayer")) {
			return PDF_DOCUMENT_SOURCE;
		}

		return HTML_DOCUMENT_SOURCE;
	}

	let activeDocumentSource = HTML_DOCUMENT_SOURCE;

	function documentSource() {
		return activeDocumentSource;
	}
	// #endregion hnewhere-test-export

	function buildArticleTextIndex() {
		return documentSource().buildIndex();
	}

	// #region hnewhere-test-export
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

	// Split out from createRangeFromMatch so a span can also be built from raw offsets
	// that never came from one match -- the union of several overlapping ones.
	function createRangeFromRawSpan(index, startRaw, endRaw) {
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

		return range.collapsed ? null : range;
	}

	// An index over a browser page can turn an offset straight into a range, because
	// the text came from DOM nodes and it kept them. An index over a PDF cannot: its
	// text came from the file, and the pages it names may not be drawn. So the index
	// answers this rather than the caller assuming, and one that says nothing gets
	// the behaviour it always had.
	function rangeFromIndexMatch(index, matchStart, matchLength) {
		return typeof index?.rangeAt === "function"
			? index.rangeAt(matchStart, matchLength)
			: createRangeFromMatch(index, matchStart, matchLength);
	}

	function createRangeFromMatch(index, matchStart, matchLength) {
		const startRaw = index.normalizedMap[matchStart];
		const endRaw = index.normalizedMap[matchStart + matchLength - 1];

		if (startRaw == null || endRaw == null) {
			return null;
		}

		const range = createRangeFromRawSpan(index, startRaw, endRaw);

		return range ? { startRaw, endRaw, range } : null;
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

	// How much of a selector's context is compared. The W3C selectors carry about
	// this much, and more would only be more ways for an edit to break the match.
	const QUOTE_CONTEXT_WINDOW = 32;

	// Does the page read the way the selector says it should on either side of a
	// candidate occurrence? Counted rather than required, because a prefix cut off
	// at a block boundary is a normal miss and should not veto a good suffix.
	function quoteContextAgreement(haystack, at, length, prefix, suffix) {
		const wantBefore = prefix
			? normalizeSearchText(prefix).text.slice(-QUOTE_CONTEXT_WINDOW)
			: "";
		const wantAfter = suffix
			? normalizeSearchText(suffix).text.slice(0, QUOTE_CONTEXT_WINDOW)
			: "";
		const sides = [];

		if (wantBefore) {
			// Trimmed, because the normalised prefix has no trailing separator while
			// the page has one between it and the quote.
			const before = haystack
				.slice(Math.max(0, at - wantBefore.length - 8), at)
				.trimEnd();

			sides.push(["prefix", before.endsWith(wantBefore)]);
		}

		if (wantAfter) {
			const after = haystack
				.slice(at + length, at + length + wantAfter.length + 8)
				.trimStart();

			sides.push(["suffix", after.startsWith(wantAfter)]);
		}

		const agreed = sides.filter(([, ok]) => ok).map(([side]) => side);

		return {
			supplied: sides.length,
			agreed: agreed.length,
			matched: agreed.length === 2 ? "both" : agreed[0] || null,
		};
	}

	function findBestQuoteMatch(articleIndex, candidate) {
		const quoteText = typeof candidate === "string" ? candidate : candidate.text;
		let best = null;

		// A quote that arrived pre-anchored is verbatim page text. Searching for it
		// as written costs one scan; expanding it first costs one scan per variant
		// and cannot find anything the original would miss.
		if (typeof candidate === "object" && candidate.exact) {
			const normalized = normalizeSearchText(quoteText).text;
			const matches = findNormalizedOccurrences(
				articleIndex.normalizedText,
				normalized,
			);
			let at = null;
			let context = null;

			if (matches.length === 1) {
				at = matches[0];
				context = quoteContextAgreement(
					articleIndex.normalizedText,
					at,
					normalized.length,
					candidate.prefix,
					candidate.suffix,
				);
			} else if (matches.length > 1 && (candidate.prefix || candidate.suffix)) {
				// Repeats are what the context is for. Rank by how many sides agree and
				// take the winner only if it is alone at the top -- a tie means the
				// context did not actually decide anything.
				const ranked = matches
					.map((offset) => ({
						offset,
						context: quoteContextAgreement(
							articleIndex.normalizedText,
							offset,
							normalized.length,
							candidate.prefix,
							candidate.suffix,
						),
					}))
					.sort((left, right) => right.context.agreed - left.context.agreed);

				if (
					ranked[0].context.agreed > 0 &&
					ranked[0].context.agreed > (ranked[1]?.context.agreed ?? -1)
				) {
					at = ranked[0].offset;
					context = ranked[0].context;
				}
			}

			if (at !== null) {
				const rangeMatch = rangeFromIndexMatch(
					articleIndex,
					at,
					normalized.length,
				);

				if (rangeMatch && getPageRectsForRange(rangeMatch.range).length) {
					return {
						score: normalized.length * 10 + 10000,
						key: `${rangeMatch.startRaw}:${rangeMatch.endRaw}`,
						range: rangeMatch.range,
						quoteText,
						fullQuoteText: quoteText,
						quoteNormalized: normalized,
						startRaw: rangeMatch.startRaw,
						endRaw: rangeMatch.endRaw,
						contextMatched: context?.matched ?? null,
					};
				}
			}
		}

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

			const rangeMatch = rangeFromIndexMatch(
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

	function getPageRectsForRange(range, source = documentSource()) {
		const origin = source.originFor(source.hostFor(range));

		return [...range.getClientRects()]
			.filter((rect) => rect.width > 0 && rect.height > 0)
			.map((rect) => ({
				left: rect.left + origin.left,
				top: rect.top + origin.top,
				width: rect.width,
				height: rect.height,
				right: rect.right + origin.left,
			}));
	}
	// #endregion hnewhere-test-export

	function scrollRangeIntoView(range) {
		documentSource().scrollIntoView(range);
	}

	function buildAnnotationGroups(comments, providedIndex = null) {
		const articleIndex = providedIndex || buildArticleTextIndex();

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

			for (const candidate of quoteCandidates) {
				const match = findBestQuoteMatch(articleIndex, candidate);

				if (!match || matchedQuoteKeys.has(match.key)) {
					continue;
				}

				const group = groups.get(match.key) || {
					key: match.key,
					range: match.range,
					quoteText: match.quoteText,
					fullQuoteText: match.fullQuoteText,
					startRaw: match.startRaw,
					endRaw: match.endRaw,
					comments: [],
				};

				group.comments.push({
					commentId: rendered.id,
					element: rendered.element,
					textElement: rendered.textElement,
					author: rendered.author,
					time: rendered.time,
					commentText: rendered.textElement
						? extractTextWithBreaks(rendered.textElement)
						: "",
					quoteText: match.quoteText,
					quoteNormalized: match.quoteNormalized,
					fullQuoteText: match.fullQuoteText,
				});

				groups.set(match.key, group);
				rendered.matchedGroupKeys.add(match.key);
				matchedQuoteKeys.add(match.key);
			}
		}

		return mergeOverlappingGroups([...groups.values()], articleIndex);
	}

	// #region hnewhere-test-export
	// Two commenters quoting the same sentence rarely quote the same span of it: one
	// takes a clause, another the whole thing. Keying a discussion on the exact
	// characters matched made those two discussions about one passage, so a reader
	// following either found half the conversation and no sign of the rest.
	//
	// Ranges that overlap are the same passage, so they become one discussion
	// reaching as wide as everything that landed on it.
	function mergeOverlappingGroups(groups, articleIndex) {
		const sorted = [...groups].sort(
			(a, b) => a.startRaw - b.startRaw || a.endRaw - b.endRaw,
		);

		const merged = [];

		for (const group of sorted) {
			const previous = merged[merged.length - 1];

			// Sharing characters, not merely meeting: two sentences quoted separately
			// sit end to end and stay two discussions, which is right -- they are two.
			if (previous && group.startRaw <= previous.endRaw) {
				previous.endRaw = Math.max(previous.endRaw, group.endRaw);
				previous.comments.push(...group.comments);
				continue;
			}

			merged.push({ ...group, comments: [...group.comments] });
		}

		for (const group of merged) {
			// One comment can quote two overlapping spans of a passage and land in
			// both, which after merging would list it twice in its own discussion.
			const seen = new Set();

			group.comments = group.comments.filter((comment) => {
				if (seen.has(comment.commentId)) {
					return false;
				}

				seen.add(comment.commentId);
				return true;
			});

			const span = createRangeFromRawSpan(
				articleIndex,
				group.startRaw,
				group.endRaw,
			);

			if (!span) {
				continue;
			}

			group.key = `${group.startRaw}:${group.endRaw}`;
			group.range = span;

			const text = span.toString().trim();

			if (text) {
				group.quoteText = text;
				group.fullQuoteText = text;
			}
		}

		return merged;
	}
	// #endregion hnewhere-test-export

	// #region hnewhere-test-export
	const HEAT_MIN_PASSAGE_CHARS = 40;
	const HEAT_MIN_PASSAGES = 5;
	const HEAT_MIN_COMMENTS = 10;
	const HEAT_MIN_REGION_COMMENTS = 3;
	const HEAT_BM25_K1 = 1.2;
	const HEAT_BM25_B = 0.75;
	const HEAT_MIN_Z_RATIO = 0.55;
	const HEAT_MIN_MATCHED_TERMS = 2;

	const HEAT_STOPWORDS = new Set([
		"about", "above", "after", "again", "against", "all", "almost", "also",
		"although", "always", "among", "and", "another", "any", "anyone",
		"anything", "are", "around", "because", "been", "before", "being",
		"below", "besides", "between", "both", "but", "came", "can", "cannot",
		"come", "could", "did", "does", "doing", "done", "down", "during",
		"each", "either", "else", "enough", "even", "ever", "every", "everyone",
		"everything", "few", "for", "from", "further", "get", "gets", "getting",
		"give", "given", "goes", "going", "gone", "got", "had", "has", "have",
		"having", "her", "here", "hers", "herself", "him", "himself", "his",
		"how", "however", "into", "its", "itself", "just", "keep", "kind",
		"know", "known", "least", "less", "let", "like", "likely", "made",
		"make", "makes", "many", "may", "maybe", "mean", "might", "more",
		"most", "much", "must", "myself", "need", "needs", "neither", "never",
		"next", "not", "nothing", "now", "off", "often", "once", "one", "only",
		"onto", "other", "others", "otherwise", "our", "ours", "ourselves",
		"out", "over", "own", "particular", "per", "perhaps", "put", "quite",
		"rather", "really", "said", "same", "say", "says", "see", "seem",
		"seems", "seen", "several", "shall", "she", "should", "significant",
		"since", "some", "someone", "something", "sometimes", "still", "such",
		"sure", "take", "taken", "takes", "than", "that", "the", "their",
		"theirs", "them", "themselves", "then", "there", "therefore", "these",
		"they", "this", "those", "though", "through", "thus", "together",
		"too", "toward", "under", "unless", "until", "upon", "use", "used",
		"uses", "using", "usually", "various", "very", "want", "wants", "was",
		"way", "ways", "well", "went", "were", "what", "whatever", "when",
		"where", "whether", "which", "while", "who", "whom", "whose", "why",
		"will", "with", "within", "without", "would", "yet", "you", "your",
		"yours", "yourself",
	]);

	function foldPlural(token) {
		if (token.length >= 6 && token.endsWith("es")) {
			return token.slice(0, -2);
		}

		if (token.length >= 5 && token.endsWith("s") && !token.endsWith("ss")) {
			return token.slice(0, -1);
		}

		return token;
	}

	function tokenizeNormalizedText(normalizedSlice) {
		const tokens = [];

		for (const token of String(normalizedSlice || "").split(" ")) {
			if (token.length < 3 || HEAT_STOPWORDS.has(token)) {
				continue;
			}

			tokens.push(foldPlural(token));
		}

		return tokens;
	}

	function normalizedIndexForRaw(normalizedMap, rawOffset, bias) {
		let low = 0;
		let high = normalizedMap.length - 1;
		let result = -1;

		while (low <= high) {
			const mid = (low + high) >> 1;
			const value = normalizedMap[mid];

			if (bias === "start") {
				if (value >= rawOffset) {
					result = mid;
					high = mid - 1;
				} else {
					low = mid + 1;
				}
			} else if (value <= rawOffset) {
				result = mid;
				low = mid + 1;
			} else {
				high = mid - 1;
			}
		}

		return result;
	}

	function segmentArticlePassages(index) {
		const passages = [];
		const rawText = index?.rawText || "";
		const normalizedMap = index?.normalizedMap || [];
		const normalizedText = index?.normalizedText || "";

		if (!rawText || !normalizedMap.length) {
			return passages;
		}

		const pushSegment = (fromRaw, toRaw) => {
			if (toRaw <= fromRaw) {
				return;
			}

			const normStart = normalizedIndexForRaw(normalizedMap, fromRaw, "start");
			const normEnd = normalizedIndexForRaw(normalizedMap, toRaw - 1, "end");

			if (normStart < 0 || normEnd < 0 || normStart > normEnd) {
				return;
			}

			if (normEnd - normStart + 1 < HEAT_MIN_PASSAGE_CHARS) {
				return;
			}

			const tokens = tokenizeNormalizedText(
				normalizedText.slice(normStart, normEnd + 1),
			);

			if (!tokens.length) {
				return;
			}

			passages.push({
				normStart,
				normEnd,
				tokens,
				length: tokens.length,
			});
		};

		const boundaries = /\n+/g;
		let cursor = 0;
		let match = boundaries.exec(rawText);

		while (match) {
			pushSegment(cursor, match.index);
			cursor = match.index + match[0].length;
			match = boundaries.exec(rawText);
		}

		pushSegment(cursor, rawText.length);

		return passages;
	}

	function buildBM25Model(passages) {
		const documentFrequency = new Map();
		const termFreqs = [];
		let totalLength = 0;

		for (const passage of passages) {
			const freqs = new Map();

			for (const term of passage.tokens) {
				freqs.set(term, (freqs.get(term) || 0) + 1);
			}

			for (const term of freqs.keys()) {
				documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
			}

			termFreqs.push(freqs);
			totalLength += passage.length;
		}

		const total = passages.length;
		const idf = new Map();

		for (const [term, count] of documentFrequency) {
			idf.set(term, Math.log((total - count + 0.5) / (count + 0.5) + 1));
		}

		return {
			passages,
			idf,
			avgLen: total ? totalLength / total : 0,
			termFreqs,
		};
	}

	function scoreCommentAgainstModel(model, tokens) {
		const scores = new Array(model.passages.length).fill(0);
		const queryTerms = new Set(tokens);

		for (let index = 0; index < model.passages.length; index += 1) {
			const freqs = model.termFreqs[index];
			const ratio = model.avgLen
				? model.passages[index].length / model.avgLen
				: 1;
			const norm = HEAT_BM25_K1 * (1 - HEAT_BM25_B + HEAT_BM25_B * ratio);
			let score = 0;

			for (const term of queryTerms) {
				const frequency = freqs.get(term);

				if (!frequency) {
					continue;
				}

				score +=
					(model.idf.get(term) || 0) *
					((frequency * (HEAT_BM25_K1 + 1)) / (frequency + norm));
			}

			scores[index] = score;
		}

		return scores;
	}

	function selectBestPassage(scores, model, tokens) {
		if (!scores.length) {
			return null;
		}

		let sum = 0;
		let bestIndex = 0;

		for (let index = 0; index < scores.length; index += 1) {
			sum += scores[index];

			if (scores[index] > scores[bestIndex]) {
				bestIndex = index;
			}
		}

		const mean = sum / scores.length;
		let variance = 0;

		for (const score of scores) {
			variance += (score - mean) ** 2;
		}

		const stddev = Math.sqrt(variance / scores.length);

		if (!(stddev > 0)) {
			return null;
		}

		const threshold = HEAT_MIN_Z_RATIO * Math.sqrt(scores.length - 1);

		if ((scores[bestIndex] - mean) / stddev < threshold) {
			return null;
		}

		const freqs = model.termFreqs[bestIndex];
		let matched = 0;

		for (const term of new Set(tokens)) {
			if (!freqs.get(term)) {
				continue;
			}

			matched += 1;

			if (matched >= HEAT_MIN_MATCHED_TERMS) {
				return bestIndex;
			}
		}

		return null;
	}

	function bucketAndMergeRegions(passages, counts, index) {
		let max = 0;

		for (const count of counts) {
			if (count > max) {
				max = count;
			}
		}

		if (max < HEAT_MIN_REGION_COMMENTS) {
			return [];
		}

		const buckets = counts.map((count) => {
			if (count < HEAT_MIN_REGION_COMMENTS) {
				return null;
			}

			const ratio = count / max;

			if (ratio > 0.75) {
				return "heavy";
			}

			return ratio >= 0.4 ? "medium" : "light";
		});

		const regions = [];
		let runStart = -1;

		const flushRun = (endIndex) => {
			if (runStart < 0) {
				return;
			}

			const first = passages[runStart];
			const last = passages[endIndex];
			let total = 0;

			for (let i = runStart; i <= endIndex; i += 1) {
				total += counts[i];
			}

			const built = createRangeFromMatch(
				index,
				first.normStart,
				last.normEnd - first.normStart + 1,
			);

			if (built?.range) {
				regions.push({
					normStart: first.normStart,
					normEnd: last.normEnd,
					range: built.range,
					commentCount: total,
					bucket: buckets[runStart],
				});
			}

			runStart = -1;
		};

		for (let i = 0; i < buckets.length; i += 1) {
			if (buckets[i] == null) {
				flushRun(i - 1);
				continue;
			}

			if (runStart < 0) {
				runStart = i;
				continue;
			}

			if (buckets[i] !== buckets[runStart]) {
				flushRun(i - 1);
				runStart = i;
			}
		}

		flushRun(buckets.length - 1);

		return regions;
	}
	// #endregion hnewhere-test-export

	function buildHeatRegions(comments, index) {
		try {
			if (!comments || comments.length < HEAT_MIN_COMMENTS) {
				return [];
			}

			if (getArticleSearchRoot() === document.body) {
				return [];
			}

			const passages = segmentArticlePassages(index);

			if (passages.length < HEAT_MIN_PASSAGES) {
				return [];
			}

			const model = buildBM25Model(passages);
			const counts = new Array(passages.length).fill(0);

			for (const comment of comments) {
				if (comment.matchedGroupKeys?.size) {
					continue;
				}

				const normalized = normalizeSearchText(
					comment.textElement?.textContent || "",
				).text;
				const tokens = tokenizeNormalizedText(normalized);

				if (!tokens.length) {
					continue;
				}

				const best = selectBestPassage(
					scoreCommentAgainstModel(model, tokens),
					model,
					tokens,
				);

				if (best != null) {
					counts[best] += 1;
				}
			}

			return bucketAndMergeRegions(passages, counts, index);
		} catch (error) {
			console.error("HNewhere: heat regions failed", error);
			return [];
		}
	}

	// #region hnewhere-test-export
	// Literal channels, not var(--accent-rgb): these paint into the page-side
	// overlay, which cannot see the panel's variables. Keep them in step with
	// ACCENT_RGB by hand -- there is no mechanism that can do it here.
	// Built per paint rather than once at load, so a reader who sets their own
	// accent gets it on the article too and not only in the panel.
	function heatFill(dark) {
		const channels = activeAccent(dark).accentRgb;
		const alphas = dark
			? { light: ".035", medium: ".055", heavy: ".075" }
			: { light: ".025", medium: ".045", heavy: ".07" };

		return {
			light: `rgba(${channels},${alphas.light})`,
			medium: `rgba(${channels},${alphas.medium})`,
			heavy: `rgba(${channels},${alphas.heavy})`,
		};
	}

	const QUOTE_FILL_OPACITY = 0.5;
	const QUOTE_ACTIVE_OPACITY = 0.24;

	function createHighlightRect(rect, options = {}) {
		const node = document.createElement(options.interactive ? "button" : "div");
		const variant = options.variant || "highlight";
		const style = {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			borderRadius: "3px",
			background: activeAccent(options.dark).accent,
		};

		if (variant === "heat") {
			const palette = heatFill(options.dark);
			style.background = palette[options.bucket] || palette.light;
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

	// #endregion hnewhere-test-export

	// #region hnewhere-test-export

	function buildCommentGraph(comments) {
		const byId = new Map(comments.map((comment) => [comment.id, comment]));
		const childrenByParent = new Map();

		for (const comment of comments) {
			if (comment.parentId == null) {
				continue;
			}

			const children = childrenByParent.get(comment.parentId) || [];
			children.push(comment.id);
			childrenByParent.set(comment.parentId, children);
		}

		return { byId, childrenByParent };
	}

	function visibleCommentIdsFromGraph(graph, commentIds) {
		const { byId, childrenByParent } = graph;
		const visible = new Set();
		const descended = new Set();

		const addDescendants = (commentId) => {
			if (descended.has(commentId)) {
				return;
			}

			descended.add(commentId);
			visible.add(commentId);

			for (const childId of childrenByParent.get(commentId) || []) {
				addDescendants(childId);
			}
		};

		for (const commentId of commentIds) {
			addDescendants(commentId);

			let currentId = byId.get(commentId)?.parentId ?? null;

			while (currentId != null) {
				if (visible.has(currentId)) {
					break;
				}

				visible.add(currentId);
				currentId = byId.get(currentId)?.parentId ?? null;
			}
		}

		return visible;
	}

	// #endregion hnewhere-test-export

	function getCommentGraph() {
		return buildCommentGraph(renderedComments);
	}

	function getVisibleCommentIds(commentIds) {
		return visibleCommentIdsFromGraph(getCommentGraph(), commentIds);
	}

	function applyFocusedDiscussion(
		{ filter, directMatchIds, anchorElement, paintBanner, onFiltered, banner },
		options = {},
	) {
		if (!activeCommentFilter) {
			preFilterPosition = captureReadingPosition();
		}

		activeCommentFilter = filter;

		const visibleCommentIds = getVisibleCommentIds([...directMatchIds]);

		positionFilterBannerForComment(anchorElement);

		transitionCommentList(() => {
			syncLiveBookends();

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

			onFiltered?.();
			updateSubmissionVisibility(visibleCommentIds);
			// Every way into a filter, not just the strip's own press: focusing a
			// comment or a quoted passage changes what the pills should say too.
			syncFilterAffordances();

			if (sidebarUI?.filterBanner && sidebarUI?.filterBannerQuote) {
				if (banner === false) {
					sidebarUI.filterBanner.classList.add("hidden");
					sidebarUI.filterBannerQuote.textContent = "";
				} else {
					sidebarUI.filterBanner.classList.remove("hidden");
					paintBanner(sidebarUI.filterBannerQuote);
				}
			}

		}, options);

		if (options.scroll !== false) {
			scrollFilterBannerToTop();
		}
	}

	function applyCommentFilter(groupKey, options = {}) {
		const group = annotationController?.groupsByKey.get(groupKey);

		if (!group) {
			clearCommentFilter(options);
			return;
		}

		const earliest = [...group.comments].sort(
			(a, b) => (a.time || 0) - (b.time || 0),
		)[0];

		const targetMatch =
			group.comments.find((match) => match.commentId === options.commentId) ||
			earliest;

		applyFocusedDiscussion(
			{
				filter: { type: "quote", key: groupKey },
				directMatchIds: new Set(
					group.comments.map((comment) => comment.commentId),
				),
				anchorElement: targetMatch?.element,
				paintBanner: (quote) => {
					quote.classList.remove("filter-banner-quote-comment");
					quote.textContent = truncateText(
						group.fullQuoteText || group.quoteText,
						220,
					);
				},
				onFiltered: () => setQuoteRedundancy(group, true),
			},
			options,
		);
	}

	function applyDiscussionFilter(discussionKey, options = {}) {
		const roots = renderedComments.filter(
			(rendered) =>
				rendered.discussionKey === discussionKey && rendered.parentId === null,
		);

		// Same bail-out as a missing quote group: a re-render between refreshes can
		// leave a filter pointing at comments that are no longer in the list.
		if (!roots.length) {
			clearCommentFilter(options);
			return;
		}

		applyFocusedDiscussion(
			{
				filter: { type: "discussion", key: discussionKey },
				directMatchIds: new Set(roots.map((rendered) => rendered.id)),
				anchorElement: null,
				banner: false,
				paintBanner: () => {},
			},
			options,
		);
	}

	function applyCommentFocus(commentId, options = {}) {
		const comment = getCommentGraph().byId.get(commentId);

		if (!comment) {
			clearCommentFilter(options);
			return;
		}

		const { author, preview } = commentFocusPreview(comment);

		applyFocusedDiscussion(
			{
				filter: { type: "comment", id: commentId },
				directMatchIds: new Set([commentId]),
				anchorElement: comment.element,
				paintBanner: (quote) => {
					quote.classList.add("filter-banner-quote-comment");

					const byline = document.createElement("span");
					byline.className = "filter-banner-author";
					byline.textContent = author;

					quote.replaceChildren(byline, document.createTextNode(preview));
				},
			},
			options,
		);
	}

	// #region hnewhere-test-export
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
		if (
			range
				.cloneContents()
				.querySelector(
					"article, aside, blockquote, div, footer, header, h1, h2, h3, h4, h5, h6, li, ol, p, pre, section, table, ul",
				)
		) {
			return null;
		}

		const wrapper = document.createElement("span");
		wrapper.dataset.hnewhereQuoteLink = "1";
		wrapper.className = "comment-quote-link comment-quote-link-inline";
		wrapper.appendChild(range.extractContents());
		range.insertNode(wrapper);
		activateCommentQuoteElement(wrapper, onActivate);
		return wrapper;
	}

	function promoteWholeParagraphQuote(wrapper) {
		const paragraph = wrapper?.closest("p");

		if (!paragraph || paragraph.closest("blockquote")) {
			return;
		}

		if (
			normalizeSearchText(paragraph.textContent).text !==
			normalizeSearchText(wrapper.textContent).text
		) {
			return;
		}

		paragraph.dataset.hnewhereQuotePromoted = "1";
		paragraph.classList.add("comment-quote-promoted");
	}

	function decorateSidebarMatches(controller) {
		for (const group of controller.groups) {
			for (const comment of group.comments) {
				const onActivate = () => {
					applyCommentFilter(group.key, {
						commentId: comment.commentId,
					});
					controller.focusGroup(group.key);
				};
				const quoteElements = [];

				const range = findRangeInRoot(
					comment.textElement,
					comment.quoteNormalized,
					false,
				);
				const wrapper = range ? wrapInlineCommentQuote(range, onActivate) : null;

				if (wrapper) {
					quoteElements.push(wrapper);
					comment.quoteElements = quoteElements;
					promoteWholeParagraphQuote(wrapper);
					continue;
				}

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
				}

				comment.quoteElements = quoteElements;
			}
		}
	}

	// #endregion hnewhere-test-export

	async function openFocusedDiscussion(groupKey, options = {}) {
		const wasHidden = await revealSidebar();

		applyCommentFilter(groupKey, options);

		if (wasHidden) {
			await refreshArticleAnnotations();
		}
	}

	function createAnnotationOverlay(groups, regions, settings) {
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

		const heatLayer = document.createElement("div");
		const baseLayer = document.createElement("div");
		const activeLayer = document.createElement("div");

		// The quote layers are where a highlight's strength lives, so that opaque
		// rects inside them cannot compound where two comments quote the same words.
		baseLayer.style.opacity = String(QUOTE_FILL_OPACITY);

		activeLayer.style.cssText = `
			opacity:0;
			pointer-events:none;
			${prefersReducedMotion() ? "" : "transition:opacity .12s ease;"}
		`;

		overlay.append(heatLayer, baseLayer, activeLayer);

		const source = documentSource();
		const overlayHost = source.hostFor(groups[0]?.range || regions?.[0]?.range);

		overlayHost.appendChild(overlay);

		let heatRegions = regions || [];

		const groupsByKey = new Map(groups.map((group) => [group.key, group]));
		let renderFrame = 0;

		const rectsByGroup = new Map();
		let activeGroupKey = null;

		// Live rather than read once: a convertible laptop can gain and lose a mouse
		// without reloading the page.
		const hoverQuery =
			typeof window.matchMedia === "function"
				? window.matchMedia("(hover: hover)")
				: null;

		const paintActiveLayer = () => {
			const rects = activeGroupKey ? rectsByGroup.get(activeGroupKey) : null;

			if (!rects?.length) {
				activeLayer.style.opacity = "0";
				return;
			}

			activeLayer.replaceChildren(
				...rects.map((node) =>
					createHighlightRect(
						{
							left: parseFloat(node.style.left),
							top: parseFloat(node.style.top),
							width: parseFloat(node.style.width),
							height: parseFloat(node.style.height),
						},
						{ interactive: false, variant: "highlight" },
					),
				),
			);

			activeLayer.style.opacity = String(QUOTE_ACTIVE_OPACITY);
		};

		const setActiveGroup = (groupKey) => {
			if (activeGroupKey === groupKey) {
				return;
			}

			activeGroupKey = groupKey;
			paintActiveLayer();
		};

		const render = () => {
			overlay.style.height = source.heightFor(overlayHost) + "px";
			baseLayer.replaceChildren();
			heatLayer.replaceChildren();
			rectsByGroup.clear();

			const backdrop =
				nearestElement(groups[0]?.range?.commonAncestorContainer) ||
				nearestElement(heatRegions[0]?.range?.commonAncestorContainer) ||
				document.body;
			const dark = isDarkBackdrop(backdrop);

			overlay.style.mixBlendMode = dark ? "screen" : "multiply";

			for (const region of heatRegions) {
				for (const rect of getPageRectsForRange(region.range)) {
					heatLayer.appendChild(
						createHighlightRect(rect, {
							interactive: false,
							variant: "heat",
							bucket: region.bucket,
							dark,
						}),
					);
				}
			}

			for (const group of groups) {
				const rects = getPageRectsForRange(group.range);

				if (!rects.length) {
					continue;
				}

				const groupRects = [];

				for (const rect of rects) {
					const node = createHighlightRect(rect, {
						interactive: true,
						title: "Show the comments quoting this",
						onActivate: () => {
							openFocusedDiscussion(group.key).catch(console.error);
						},
						variant: "highlight",
					});

					// Pointer feedback only where there is a pointer. On a touch screen
					// hover states either never fire or, worse, stick after a tap.
					node.addEventListener("pointerenter", () => {
						if (hoverQuery?.matches !== false) {
							setActiveGroup(group.key);
						}
					});

					node.addEventListener("pointerleave", () => {
						if (activeGroupKey === group.key) {
							setActiveGroup(null);
						}
					});

					// Keyboard parity. :focus-visible keeps this off the click that
					// precedes an activation, where the pointer has already said it.
					node.addEventListener("focus", () => {
						if (node.matches(":focus-visible")) {
							setActiveGroup(group.key);
						}
					});

					node.addEventListener("blur", () => {
						if (activeGroupKey === group.key) {
							setActiveGroup(null);
						}
					});

					groupRects.push(node);
					baseLayer.appendChild(node);
				}

				rectsByGroup.set(group.key, groupRects);
			}

			// Rebuilt from the fresh geometry, so a resize under the pointer moves the
			// lit quote with everything else rather than leaving it behind.
			paintActiveLayer();
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
			setHeatRegions(next) {
				heatRegions = next || [];
				scheduleRender();
			},
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

	// Safari only shipped requestIdleCallback in 16.4 and the Userscripts app
	// targets Safari, so fall back to a macrotask.
	function scheduleIdleTask(callback) {
		if (typeof requestIdleCallback === "function") {
			requestIdleCallback(callback, { timeout: 500 });
			return;
		}

		setTimeout(callback, 0);
	}

	// Every surface this script puts on a page. Annotations go first: they unwrap
	// quote links inside the sidebar's shadow root, so it has to still exist.
	function teardownSurfaces() {
		clearArticleAnnotations();

		for (const id of [
			BUTTON_PENDING_ID,
			"hn-restore-button",
			"hn-collapse-button",
			"hn-submit-button",
			"hn-setup-button",
		]) {
			const button = document.getElementById(id);

			if (button) {
				destroyFloatingButton(button);
			}
		}

		// The popover is a separate host with its own shadow root, and the hide
		// control lives in its header too, so it has to go the same way.
		document
			.querySelectorAll("[data-hnewhere-submit-popover]")
			.forEach((host) => host.remove());

		if (sidebar) {
			sidebar._cleanup?.();
			sidebar.remove();
			sidebar = null;
			sidebarUI = null;
		}
	}

	function teardownForBlockedSite() {
		teardownSurfaces();
	}

	async function refreshForSourceChange() {
		if (isSidebarVisible() && sidebarUI) {
			await refreshDiscussionsInPlace(sidebarUI);
			return;
		}

		teardownSurfaces();
		await runPagePass();
	}

	// Rebuilds the thread inside the panel the reader is already looking at.
	async function refreshDiscussionsInPlace(ui) {
		const generation = ++sidebarGeneration;
		const comments = ui.shadow?.querySelector("#comments");
		const settings = await loadSettings();

		const render = () => {
			if (generation !== sidebarGeneration) {
				return;
			}

			(async () => {
				// Before the branching, because two of the three branches return early
				// and the wordmark has to be told either way.
				await refreshBrowseAffordances(ui.shadow);

				if (!enabledSourceIds(settings, registeredSourceIds()).length) {
					sidebarHasDiscussion = false;
					renderSourcePicker(ui);
					return;
				}

				setSidebarStage(ui, "discussion");

				const discussions = await discoverAll(pageAddresses(), settings);

				if (generation !== sidebarGeneration) {
					return;
				}

				if (!discussions.length) {
					sidebarHasDiscussion = false;

					if (frontPageAvailable || queueHasItems) {
						setBrowseMode(ui, true);
						return;
					}

					teardownSurfaces();
					await runPagePass();
					return;
				}

				sidebarHasDiscussion = true;
				setSidebarStage(ui, "comments");
				await renderDiscussions(discussions, ui);
				await refreshSubmitAffordance(ui.shadow);

				if (generation === sidebarGeneration) {
					await refreshArticleAnnotations();
				}
			})().catch(console.error);
		};

		if (!comments || prefersReducedMotion()) {
			render();
			return;
		}

		crossFadeCommentsView(comments, render);
	}

	async function hideCurrentSite(scope = "page") {
		const sites = await loadBlockedSites();
		const entry = scope === "site" ? siteKey() : blockedPageEntry(location.href);

		if (!entry) {
			return;
		}

		sites.add(entry);
		await saveBlockedSites(sites);
		teardownForBlockedSite();
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

		// Decided here rather than at load: a PDF viewer builds itself after the
		// script has already run, so asking at startup would always answer "no".
		activeDocumentSource = detectDocumentSource();

		const articleIndex = buildArticleTextIndex();
		// Must run before buildHeatRegions: it populates comment.matchedGroupKeys,
		// which heat reads to skip comments already represented by a quote match.
		const groups = buildAnnotationGroups(renderedComments, articleIndex);

		// No early return on an empty group list: heat exists precisely to serve
		// articles nobody quoted, so the overlay has to be created either way.
		if (!groups.length) {
			clearCommentFilter({ animate: false });
		}

		annotationController = createAnnotationOverlay(groups, [], settings);
		decorateSidebarMatches(annotationController);

		// A PDF hands over its pages as the reader reaches them, so a quote that had
		// nowhere to anchor a moment ago may have somewhere now. Coalesced into the
		// next frame: pdf.js fires per page, and a burst of them is one repaint.
		let queued = 0;
		stopDocumentReindex = documentSource().onReindex(() => {
			cancelAnimationFrame(queued);
			queued = requestAnimationFrame(() => {
				refreshArticleAnnotations().catch(console.error);
			});
		});

		if (activeCommentFilter?.type === "quote") {
			applyCommentFilter(activeCommentFilter.key, {
				scroll: false,
				animate: false,
			});
		} else if (activeCommentFilter?.type === "comment") {
			applyCommentFocus(activeCommentFilter.id, {
				scroll: false,
				animate: false,
			});
		} else if (activeCommentFilter?.type === "discussion") {
			applyDiscussionFilter(activeCommentFilter.key, {
				scroll: false,
				animate: false,
			});
		}

		const controller = annotationController;

		scheduleIdleTask(() => {
			// A newer refresh (or a teardown) may have replaced the controller
			// while we were queued; drop the stale result rather than cancelling.
			if (annotationController !== controller) {
				return;
			}

			controller.setHeatRegions(buildHeatRegions(renderedComments, articleIndex));
		});
	}

	// -------------------------
	// Soft navigation
	// -------------------------

	// The generation bump tells a render in flight to stop at its next checkpoint;
	// awaiting openingRun is how we learn that it has.
	async function teardownForNavigation() {
		sidebarGeneration++;

		if (openingRun) {
			await openingRun.catch(() => {});
		}

		teardownSurfaces();

		stopObservingNewComments();
		renderedComments = [];
		activeCommentFilter = null;
	}

	// Routers push more than once for one navigation, and the new article is
	// usually not in the DOM yet when they do, so the pass waits for the burst.
	const SOFT_NAV_SETTLE_MS = 250;
	const SOFT_NAV_POLL_MS = 400;

	let softNavigationWatched = false;

	function watchSoftNavigation() {
		if (softNavigationWatched) {
			return;
		}

		softNavigationWatched = true;

		let currentHref = location.href;
		let currentURL = normalizeURL(currentHref);
		let timer = null;
		let queue = Promise.resolve();

		const check = () => {
			if (location.href === currentHref) {
				return;
			}

			currentHref = location.href;

			// Normalized, so a fragment or a tracking parameter findHN already
			// discards is not treated as a new page.
			const nextURL = normalizeURL(currentHref);

			if (nextURL === currentURL) {
				return;
			}

			currentURL = nextURL;

			// This page was navigated to, not arrived at. The referrer still says HN
			// and will keep saying so for the rest of the document's life.
			forgetHNReferrer();

			clearTimeout(timer);

			timer = setTimeout(() => {
				// Chained, so two navigations cannot have one's teardown run against
				// the other's half-built surfaces.
				queue = queue
					.then(async () => {
						await teardownForNavigation();
						await runPagePass();
					})
					.catch(console.error);
			}, SOFT_NAV_SETTLE_MS);
		};

		for (const method of ["pushState", "replaceState"]) {
			const original = history[method];

			if (typeof original !== "function") {
				continue;
			}

			try {
				history[method] = function (...args) {
					const result = original.apply(this, args);

					check();

					return result;
				};
			} catch {
				// Frozen or isolated by the manager. Polling still catches it.
			}
		}

		window.addEventListener("popstate", check);
		setInterval(check, SOFT_NAV_POLL_MS);
	}

	// -------------------------
	// Initialization
	// -------------------------

	async function init() {
		// Before migrateStorage, which writes on its own first run and would make
		// every fresh install look like an upgrade.
		await seedSources();
		await migrateStorage();
		await migrateSourceKeys();
		await migrateQueue();

		const bridge = writeBridgeForHost(writeBridges(), location.hostname);
		const onHN = location.hostname === "news.ycombinator.com";

		// On HN, also record clicked stories and offer the queue.
		if (onHN) {
			setupHNListener();

			setupHNQueueLinks().catch(console.error);
		}

		// A popup this script opened, on the source's own page.
		if (bridge) {
			if (reportWriteBridge(bridge)) {
				return;
			}

			// Async because a staged draft lives in GM storage rather than the URL
			// fragment, so it cannot be tested with a plain if.
			if (await dispatchWriteBridge(bridge)) {
				return;
			}
		}

		if (onHN) {
			await markQueueArrival().catch(console.error);

			// Last, so a bridge popup -- which returns above -- never grows a button
			// on a window that exists to do one thing and close.
			await offerQueueOnHN();
			return;
		}

		// Never gated on what the pass decides: a page the script declines to touch
		// is exactly the one a reader navigates away from.
		watchSoftNavigation();

		await runPagePass();
	}

	async function runPagePass() {
		if (isHiddenSite()) {
			return;
		}

		// Everything past here may call pageAddress, which reads the head.
		await documentReady();

		const [blocked, settings, siteState, storedLast] = await Promise.all([
			isSiteBlocked(),
			loadSettings(),
			loadSidebarState(),
			load(STORAGE.last, null),
		]);

		// Same guarantee as isHiddenSite above: no lookup, no button, no stored
		// state. Nothing above this line writes, so reaching it early is safe.
		if (blocked) {
			return;
		}

		// A popup closed before it finished leaves its staged draft behind.
		sweepBridgePayloads().catch(console.error);

		markQueueArrival().catch(console.error);

		const votesReady = Promise.all([
			loadRememberedVotes(),
			loadRememberedItemActions(),
		]);

		const hideButton =
			settings.hideWithoutDiscussion &&
			!(settings.showButtonWithQueue && unreadQueueCount(await loadQueue()));

		if (!enabledSourceIds(settings, registeredSourceIds()).length) {
			if (!hideButton) {
				await createSetupButton();
			}

			return;
		}

		const pendingButton = hideButton ? null : await createCheckingButton();

		// Vote memory is only read once something renders, so it no longer sits in
		// front of the first paint -- but it must still land before it does.
		await votesReady;

		// Check if we arrived here by clicking
		// a story from Hacker News.
		let last = storedLast;

		if (last && Date.now() - last.timestamp > 300000) {
			await save(STORAGE.last, null);
			last = null;
		}

		const arrivedFromClick = Boolean(
			last &&
				sameURL(last.url, pageAddress()) &&
				Date.now() - last.timestamp < 300000,
		);

		const arrivedForComments = arrivedFromClick && Boolean(last.openPanel);

		if (arrivedFromClick) {
			await save(STORAGE.last, null);
		}

		const found = await discoverAll(pageAddresses(), settings);

		const recoverable = arrivedFromClick && (!last.source || last.source === "hn");

		const stories =
			found.length || !recoverable
				? found
				: last.ids.map((id) => ({ objectID: id }));

		const requestedOpen = takeRequestedOpen();

		if (stories.length) {
			settleButtonToDiscussion(pendingButton);

			if (requestedOpen || arrivedForComments) {
				destroyFloatingButton(document.getElementById(BUTTON_PENDING_ID));
				await openSidebar(stories);
				return;
			}

			await presentDiscussion(
				stories,
				settings,
				siteState,
				arrivedFromClick || arrivedFromHNReferrer,
			);
			return;
		}

		if (requestedOpen || arrivedForComments) {
			destroyFloatingButton(pendingButton);
			await openSidebar([], { browseOnly: true });
			return;
		}

		// Offer to put it there, unless the reader has asked for the button to stay
		// out of the way when there is nothing to read.
		if (!hideButton) {
			await createSubmitButton();
		}

		stopButtonSpinner(pendingButton);
	}

	// The three ways a known discussion can be presented, in one place because init
	// reaches this point by two different routes.
	async function presentDiscussion(storyRefs, settings, siteState, fromHN = false) {
		if (shouldAutoOpenSidebar(settings, siteState, fromHN)) {
			// The sidebar itself is the answer here, so the placeholder goes rather
			// than becoming a button that would sit on top of an open panel.
			destroyFloatingButton(document.getElementById(BUTTON_PENDING_ID));

			await openSidebar(storyRefs, { remember: false });
			return;
		}

		if (shouldPreloadHiddenSidebar(settings, siteState, fromHN)) {
			// Kept: createRestoreButton adopts it, so the ring carries on spinning
			// across the render and the annotation pass, which is the slow case.
			await openSidebar(storyRefs, { startHidden: true });
			return;
		}

		stopButtonSpinner(await createCollapsedButton(storyRefs));
	}

	init().catch(console.error);
})();
