// ==UserScript==
// @name         Backchannel
// @namespace    https://github.com/twalichiewicz/HNewhere
// @version      1.6.0
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @downloadURL  https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @homepageURL  https://github.com/twalichiewicz/HNewhere
// @supportURL   https://github.com/twalichiewicz/HNewhere/issues
// @description  Read what Hacker News and Reddit said about any page, in one thread
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
// @exclude      https://console.cloud.google.com/*
// @exclude      https://*.netflix.com/*
// @exclude      https://web.whatsapp.com/*
// @exclude      https://*.instagram.com/*
// @exclude      *://127.0.0.1/*
// @exclude      *://*/*.pdf
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// @connect      hacker-news.firebaseio.com
// @connect      hn.algolia.com
// @connect      news.ycombinator.com
// @connect      www.reddit.com
// @connect      arctic-shift.photon-reddit.com
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

	// Must run after migrateStorage, not before: that one copies the v1.5.3 keys
	// into the current namespace, and this one rewrites what is in the current
	// namespace. Reversed, it would migrate an empty store and then have the old
	// unprefixed values copied in on top of it.
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

	const SOURCE_SEED_MIGRATION = "HNewhere:seeded_sources";

	// Which keys prove a reader was here before this release.
	//
	// "HNewhere:migrated" leads, and only because seedSources runs *before*
	// migrateStorage. Read at that moment it is exact: an upgrading reader has it
	// from a previous session, and a first run has not reached the line that
	// writes it. Read any later it is worthless, because migrateStorage sets it
	// for brand new installs too -- which is why the order in init is load-bearing
	// rather than tidy.
	//
	// The rest are a belt-and-braces list for a store that somehow has history
	// without that flag. A reader who installed HNewhere and never once opened a
	// sidebar would leave almost none of them, which is exactly the reader the
	// flag catches and a hand-kept list would not.
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

	// The keys keep the old prefix, and deliberately. Renaming them buys nothing a
	// reader can see, and costs a sweep of seventeen fixed keys plus three
	// dynamic prefixes -- the per-URL lookup cache, the front-page cache and the
	// staged bridge payloads -- which would need GM.listValues and GM.deleteValue
	// granted just to find them. A migration that half-runs loses somebody's queue
	// and their hidden-site list. The name on the tin changed; the tin did not.
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

	// Split on the first separator rather than the last, so an id that contains
	// one still resolves to the right source. Nothing stored today contains a
	// colon; the rule is here for the source added when nobody remembers to check.
	//
	// Returns null rather than a guess for anything unprefixed, which is how the
	// storage migration recognises a value written before this existed.
	function parseSourceKey(key) {
		const text = String(key ?? "");
		const at = text.indexOf(SOURCE_KEY_SEPARATOR);

		if (at < 1 || at === text.length - 1) {
			return null;
		}

		return { source: text.slice(0, at), id: text.slice(at + 1) };
	}

	// Every id stored before this release was HN's, because HN was the only
	// source. So the migration is a prefix, not a lookup -- and anything already
	// prefixed is left exactly as found, which is what makes running it twice
	// harmless.
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

	// Returns what to write, or null for "leave it alone".
	//
	// An empty object counts as a choice already made -- the default is absent,
	// not empty, so an empty map can only have come from the picker saving with
	// nothing ticked. Treating it as unset would re-run the picker on every load
	// for a reader who deliberately turned everything off.
	function seedSourcesForExistingReader(hadPrior, storedSources) {
		if (storedSources !== undefined && storedSources !== null) {
			return null;
		}

		return hadPrior ? { hn: true } : null;
	}
	// #endregion hnewhere-test-export

	// Votes have to be remembered locally. The sidebar reads HN over a cross-site
	// GM request, which the browser strips the SameSite session cookie from, so a
	// fetched page always reports "not voted" no matter what you have voted on.
	// Only the popup sees the real state, so what it reports is recorded here and
	// replayed over anonymously fetched pages.
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

	// Clamped to the range but deliberately NOT snapped to the step: a size typed
	// into the field is the user's choice and is kept exactly, so any whole pixel
	// from 24 to 64 is a valid stored value. Snapping belongs to the stepper alone.
	// One or two characters, because that is what a 44px circle holds. Trimmed and
	// upper-cased so "bc" and " Bc " settle on the same mark, and anything that
	// normalises to nothing falls back rather than leaving a blank circle -- an
	// unlabelled button is indistinguishable from a broken one.
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

	// Moves to the next step in the direction pressed, so a typed 45 steps up to
	// 48 and down to 44 rather than to 49 and 41. Directional rather than nearest:
	// pressing + must never make the button smaller.
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

	// detectDarkMode runs synchronously on every annotation render, and
	// applyButtonAppearance runs on every resize, so neither can await GM storage.
	// These three caches are the synchronous view of the stored settings.
	let themePreference = "auto";
	let buttonShapePreference = "circle";
	let buttonSizePreference = BUTTON_SIZE_DEFAULT;
	let buttonMarkPreference = BUTTON_MARK_DEFAULT;

	// The only writer of the three caches. Called by loadSettings and saveSettings
	// so they cannot drift from stored settings, and directly by tests.
	function syncAppearancePreferences(settings) {
		themePreference = settings.theme || "auto";
		buttonShapePreference = BUTTON_SHAPES[settings.buttonShape]
			? settings.buttonShape
			: "circle";
		buttonSizePreference = normalizeButtonSize(settings.buttonSize);
		buttonMarkPreference = normalizeButtonMark(settings.buttonMark);
	}
	// #endregion hnewhere-test-export

	const DEFAULT_SETTINGS = {
		annotations: false,
		annotationsWhenSidebarClosed: false,
		autoOpenSidebar: false,
		// Narrows the setting above to pages reached from HN. Off by default, so an
		// existing reader's auto-open keeps opening everywhere until they say
		// otherwise.
		autoOpenSidebarOnlyFromHN: false,
		// Off by default, so the button now appears greyed out on pages with no
		// discussion rather than not appearing at all. Turning it on restores the
		// pre-1.5.3 behaviour of staying hidden unless there is something to read.
		hideWithoutDiscussion: false,
		// Narrows the setting above, which was chosen before there was a queue to
		// reach through that button. Off by default for the same reason
		// autoOpenSidebarOnlyFromHN is: a reader who set the parent gets exactly
		// what they set until they say otherwise.
		showButtonWithQueue: false,
		// Absent rather than { hn: true }. A fresh install has chosen nothing yet,
		// and that is a state the picker exists to resolve -- seeding a default here
		// would make "never configured" indistinguishable from "chose HN", and the
		// upgrade seeding depends on telling them apart. loadSettings deliberately
		// does not fill this in.
		sources: undefined,
		// "auto" reproduces the pre-1.5.4 behaviour of following the page.
		theme: "auto",
		buttonShape: "circle",
		buttonSize: BUTTON_SIZE_DEFAULT,
		buttonMark: BUTTON_MARK_DEFAULT,
	};

	// #region hnewhere-test-export
	const HN_ORIGIN = "https://news.ycombinator.com";
	// #endregion hnewhere-test-export

	const REPO_URL = "https://github.com/twalichiewicz/HNewhere";

	// Read back from the manager rather than written out a second time, so the
	// version in settings cannot drift from the @version header. Wrapped because
	// GM may not exist at all under a manager that only injects the GM_* globals,
	// and a bare reference would throw rather than yield undefined.
	const SCRIPT_VERSION = (() => {
		try {
			return GM?.info?.script?.version || "";
		} catch {
			return "";
		}
	})();

	// The wire value stays "HNewhereVoteBridge" though the mechanism no longer only
	// votes. It is the protocol between a popup and the page that opened it, and a
	// reader who updates the script mid-session can have one of each live at once --
	// renaming the string would leave that popup unable to report what it did.
	const ITEM_ACTION_BRIDGE_MESSAGE_SOURCE = "HNewhereVoteBridge";
	const SUBMIT_BRIDGE_MESSAGE_SOURCE = "HNewhereSubmitBridge";
	const COMMENT_BRIDGE_MESSAGE_SOURCE = "HNewhereCommentBridge";

	// HN truncates submission titles at 80 characters.
	const HN_TITLE_LIMIT = 80;

	// The popup acts by navigating to HN's own action URL, and HN's goto redirect
	// drops the URL fragment, so the bridge payload cannot ride the hash across it.
	// sessionStorage is per-tab and per-origin, which is exactly the popup's life.
	// The key keeps its old name for the same reason the message source does.
	const ITEM_ACTION_BRIDGE_STORAGE_KEY = "hnewhere-vote-bridge";
	const SUBMIT_BRIDGE_STORAGE_KEY = "hnewhere-submit-bridge";
	const COMMENT_BRIDGE_STORAGE_KEY = "hnewhere-comment-bridge";

	// Submissions and comments carry a title or a body, which is too much to put in a
	// URL fragment. GM storage is scoped to the script rather than the origin, so the
	// popup running on news.ycombinator.com can read what the sidebar wrote from the
	// article's origin -- the hash only has to carry a nonce to look it up by.
	const BRIDGE_PAYLOAD_PREFIX = "HNewhere:bridge_payload:";

	// Long enough to survive a slow HN, short enough that an abandoned popup's
	// payload does not sit in storage indefinitely.
	const BRIDGE_PAYLOAD_TTL = 10 * 60 * 1000;
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
	let openingRun = null;
	let sidebarGeneration = 0;
	let renderedComments = [];
	// Which sources the open sidebar is showing, so per-thread decisions -- the vote
	// gutter, for one -- do not have to walk the comment list to find out.
	const sidebarSourceKeys = new Set();
	let annotationController = null;
	// Tagged rather than a bare group key: a focused discussion can now be entered
	// two ways -- through a quoted passage, or through a comment -- and everything
	// that re-applies or tears down a filter has to know which it is holding.
	// { type: "quote", key } | { type: "comment", id }
	let activeCommentFilter = null;

	// Where the reader was, in both the thread and the article, before a focused
	// discussion moved them. Leaving the focus puts every hidden comment back above
	// them, so without this the list grows under the scroll position and drops them
	// at the top; and the article is left at the quoted passage the focus jumped to
	// rather than at whatever they were reading.
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

		// Re-synced from the patched result. loadSettings above already synced, but
		// it ran against the pre-patch settings, so relying on it alone would leave
		// the caches one change behind whatever was just saved.
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
		return (await loadBlockedSites()).has(siteKey());
	}

	// #region hnewhere-test-export

	// The reading queue is a list rather than a set, because its order is the
	// feature: what you saved first is what you are offered next. Every rule below
	// is a pure transform of that list so the ordering can be argued about without
	// a browser. The URL comparison arrives as an argument for the same reason
	// referrerIsHN takes its referrer -- the real one normalizes, and normalizeURL
	// lives outside this region.
	function addToQueue(entries, story, now) {
		const list = Array.isArray(entries) ? entries : [];

		// Saving something twice is not an error and not a second copy, and it does
		// not move it: a story saved an hour ago keeps its place in the line, which
		// is what having a line is for.
		if (list.some((entry) => entry.id === story.id)) {
			return list;
		}

		// Everything a row displays is kept, not just what identifies the story. The
		// queue is the same list as the front page with most of it filtered out, so
		// a row in it has to be able to say the same things -- and a queue entry is
		// read days after it was made, long after the page it came from is gone.
		return [
			...list,
			{
				id: story.id,
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

	function removeFromQueue(entries, id) {
		return (Array.isArray(entries) ? entries : []).filter(
			(entry) => entry.id !== id,
		);
	}

	// Unread first and oldest-saved at the top, so nothing starves at the bottom of
	// a list that keeps growing. Read entries sink below them, most recently read
	// first, which is the order you would look in for something you just finished.
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

	// Stamped, never removed. Arrival is matched by URL and URLs drift -- a
	// redirect, a paywall bounce, a canonical form the site prefers -- so a wrong
	// match has to be visible and undoable rather than silently eating an entry the
	// reader never got to.
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

	// Matched with sameURL, which normalizes both sides -- the same comparison
	// findHN uses to decide two addresses are the same submission -- so a tracking
	// parameter added on the way in, or a fragment, does not stop the queue
	// recognising where you have got to.
	//
	// Writes only when something actually changed. A page pass runs on every load
	// and on every soft navigation, and storing an identical list each time would
	// be a write per navigation for nothing.
	async function markQueueArrival(url = location.href, now = Date.now()) {
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

	// { [itemId]: { favorite?: bool, flagged?: bool, flagUnavailable?: bool, at } }
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

	// Favorite and flag have to be remembered for exactly the reason votes do, and
	// it is worth saying plainly: an anonymously fetched page shows neither. The
	// browser strips HN's SameSite cookie from a cross-site GM request, so the item
	// page the sidebar reads is a logged-out one -- it renders no favorite link at
	// all, and no flag link either. Only the popup ever sees the truth, so what the
	// popup reports is what gets kept.
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

	// Expires on the same 90-day clock as everything else in here, so an account
	// that gains the karma to flag -- or a reader who simply logs in -- is offered
	// the link again rather than having been written off for good.
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

	// Rendered on every story and every comment, because the sidebar cannot know
	// whether either applies: it reads HN logged out, where a favorite link never
	// appears and a flag link never appears either. The popup is what finds out, and
	// what it finds is remembered here -- so a link discovered to be unavailable
	// retires instead of being offered again on every comment in the thread.
	// flag before favorite, which is the order HN lists them in:
	// `… 6 hours ago | flag | hide | past | favorite | 17 comments`.
	function itemActionLinksHTML(itemId) {
		const id = escapeHTML(String(itemId));

		return `
      |
      <button class="item-action-link" type="button"
      data-item-action="flag" data-item-action-id="${id}">flag</button>
      |
      <button class="item-action-link" type="button"
      data-item-action="fave" data-item-action-id="${id}">favorite</button>`;
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

			// Hidden rather than disabled. A disabled control still says the action
			// exists and invites the reader to work out why they cannot have it;
			// this one does not apply to them at all.
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

		// Whether this is the doing or the undoing is decided from what is
		// remembered, which is the only record there is -- a fetched page would say
		// "not favorited" about everything.
		const action = itemActionState(itemId)?.[field] ? "un" + kind : kind;

		button.disabled = true;

		try {
			// No URL to pass: unlike a vote there is no client-injected link to hand
			// over, so the popup finds the anchor on the page it lands on.
			await openItemActionPopup(itemId, itemId, action, null);
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

	// Same transport as request(), but keeps the status and the response headers.
	// The status matters because 403 and 429 mean different things to a source that
	// can degrade, and request() flattens both -- along with a timeout and a parse
	// failure -- to the same null.
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

	// The same link gets submitted to Hacker News more than once, and the second
	// one is routinely a repost nobody replied to. Two discussions both labelled
	// "HN" -- one with 103 comments, one with 1 -- are not two places the
	// conversation is happening; they are the same place listed twice, under two
	// pills that cannot be told apart.
	//
	// Keyed on source *and* label rather than source alone, because a subreddit is
	// a label: r/programming and r/webdev are genuinely two rooms and both survive.
	// Two posts in the same subreddit do not. The rule is what the reader can
	// distinguish -- if two entries would present identically, only the one with
	// the conversation is worth keeping.
	function collapseIndistinguishable(discussions) {
		const best = new Map();

		for (const discussion of discussions) {
			const key = discussion.source + " " + (discussion.label ?? "");
			const held = best.get(key);

			if (!held || compareStoriesByDiscussion(discussion, held) < 0) {
				best.set(key, discussion);
			}
		}

		// Input order, not map order: discoverAll has already sorted these, and the
		// source strip reads left to right off this list.
		const kept = new Set(best.values());

		return discussions.filter((discussion) => kept.has(discussion));
	}

	// The shared shape every source is read through. Written as two mappers rather
	// than one adapter method because they are pure -- the fetching lives in the
	// adapter, the shape lives here, and only one of those is testable without a
	// network.
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
		};
	}

	// HN arrives in two shapes and both become a Discussion. An Algolia hit already
	// carries everything the button and the header need -- title, points, comment
	// count, author, timestamp -- and only the comment list needs the Firebase
	// item's `kids`. Mapping the hit directly is what keeps a page check at the two
	// requests it has always been, instead of two plus one per submission found.
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
		};
	}

	// score is null, not 0. HN's API does not carry comment points at any
	// endpoint, so there is no number to report -- and a 0 would be indexed,
	// sorted and displayed as though there were.
	//
	// It is also why blending cannot be ordered on score: one of the two sources
	// has none to give.
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

	// Reddit reports its budget on every response. Reading it is the difference
	// between backing off before the limit and meeting it as a run of 429s.
	//
	// Returns null rather than zeros when the headers are absent: "no budget left"
	// and "this service reports no budget" must not look alike, or every response
	// from a service that does not report one would read as exhausted.
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

	// Bots that repost Hacker News wholesale. Their "discussion" is a link back to
	// the thread the sidebar is already showing, so a hit from one is worse than no
	// hit: it lights the button and delivers nothing. Compared lowercased, because
	// Reddit preserves the display case of a subreddit name.
	const MIRROR_SUBREDDITS = new Set(["hackernews", "hypeurls"]);

	function redditHitPasses(post) {
		return (
			(post?.num_comments ?? 0) > 0 &&
			!post.removed_by_category &&
			!MIRROR_SUBREDDITS.has(String(post.subreddit || "").toLowerCase())
		);
	}

	// Reddit sends rendered markdown as an HTML-escaped string inside JSON. Left
	// escaped it renders as tag soup; unescaped and handed straight to innerHTML it
	// would let Reddit choose our markup. So it is unescaped here and sanitised
	// where every other source's body is, by the renderer.
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
			rootKeys: [],
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
			// A t3_ parent is the submission itself, which makes this a root. Reported
			// as null rather than the discussion's key, because the focus walk stops on
			// null and would otherwise look for a comment that is not in the list.
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

	// Reddit returns the tree whole and pre-nested, so this is the only walk: it
	// flattens once into a map the adapter answers getComment from instantly. That
	// is what lets a source with no per-comment request satisfy an interface built
	// around one.
	function redditThreadIndex(listing, discussion) {
		const byKey = new Map();
		const rootKeys = [];
		let hiddenCount = 0;

		// Where the gap is, not just how big. A stub carries the ids Reddit withheld,
		// which is what /api/morechildren needs to fill it -- counting them and
		// throwing the ids away made the number unusable.
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

	// The archive returns comments flat. Same output as redditThreadIndex, rebuilt
	// from parent_id -- and a comment whose parent is missing from the page becomes
	// a root rather than being dropped, so a partial fetch still reads as a thread.
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

	// Where a comment sits in its own discussion, as a fraction. This is the whole
	// ordering rule for a blended thread, and what it carefully never does is
	// compare a Reddit upvote to an HN point -- HN's API carries no comment score
	// at all, so that comparison was never available even in principle.
	//
	// Each platform has already ranked its own comments: HN's `kids` order is HN's
	// ranking and Reddit's sort=top is Reddit's. This reads that ranking and says
	// nothing else.
	//
	// The +1s are not decoration. Under plain i/n a discussion with one comment
	// scores 0 and its lone comment outranks the top comment of a 500-comment
	// thread; (i+1)/(n+1) puts it at 0.5, which is the honest position for a
	// discussion contributing one comment.
	function blendPosition(index, total) {
		return (index + 1) / (total + 1);
	}

	// Proportionality falls out of the fraction rather than needing a weighting
	// term: a discussion with ten times the comments has ten times as many of them
	// inside any span of the merged list.
	function blendRoots(groups) {
		const entries = [];

		for (const group of groups) {
			const total = group.rootKeys.length;

			group.rootKeys.forEach((key, index) => {
				entries.push({
					key,
					discussionKey: group.discussionKey,
					position: blendPosition(index, total),
					size: total,
				});
			});
		}

		// Larger discussion first on a tie, so the thread with more to read leads --
		// the same argument compareStoriesByDiscussion makes one level up.
		return entries.sort((a, b) => a.position - b.position || b.size - a.size);
	}

	// 403 is the only demotion, and it is specific: it is what Reddit returns to a
	// caller without a usable loid, which is exactly the condition the archive tier
	// exists for. A 429 is a wait and a 0 is a dropped connection; treating either
	// as a demotion would move a reader to stale scores over something temporary.
	function redditTierForStatus(status, current) {
		if (status !== 403) {
			return current;
		}

		return current === "loid" ? "archive" : "off";
	}

	// A registry rather than a pair of branches. HN is an entry, not a base case:
	// the moment a source is special-cased the renderer starts learning what a
	// source is, which is the thing this whole seam exists to prevent.
	const SOURCES = new Map();

	function registerSource(source) {
		SOURCES.set(source.id, source);
		return source;
	}

	function getSource(id) {
		return SOURCES.get(id) || null;
	}

	// The platform a discussion opens on, which is not the same as the label that
	// tells two discussions apart. A Reddit thread's label is its subreddit, so
	// this link read "open on r/programmingcirclejerk" where Hacker News read
	// "open on HN" -- the one line where the same layout said something different
	// depending on the source. The subreddit still labels the source strip and the
	// badge beside a comment, which is where telling r/science from r/conspiracy
	// is the whole point.
	//
	// Falls back to the discussion's own label for front-page rows, which are
	// parsed out of HN's markup and never pass through a source.
	function sourceShortLabel(story) {
		return getSource(story?.source)?.shortLabel || story?.label || "the site";
	}
	// #endregion hnewhere-test-export

	// Where a name links to, decided by the source the name came from. It used to
	// be Hacker News for everybody, which sent a Reddit username to an HN profile
	// page that has never existed.
	//
	// Returns null for a name that is not a person -- Reddit's "[deleted]", HN's
	// "anonymous" placeholder -- so the renderer can print the text without
	// wrapping it in a link to nowhere.
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

	// Built from the registry rather than written out, so adding a source is a
	// registry entry and no markup. The caveat travels with the source that earns
	// it: a checkbox that sends the reader's browsing history somewhere new has to
	// say so where it is ticked, not in a document nobody opens.
	// The id is optional because this list is rendered twice into the same shadow
	// root -- once in the settings panel, once in the picker -- and two elements
	// cannot share one. The input sits inside its own label, so nothing needs a
	// `for` and the picker's copy can simply go without.
	function sourceListHTML({ idPrefix = "" } = {}) {
		return [...SOURCES.values()]
			.map(
				(source) => `
<label class="settings-option">
<input${idPrefix ? ` id="${escapeHTML(idPrefix + source.id)}"` : ""} data-source="${escapeHTML(source.id)}" type="checkbox">
<span>${escapeHTML(source.label)}${source.beta ? ` <span class="op-pill">BETA</span>` : ""}</span>
</label>
${
	source.caveat
		? `<div class="settings-option-hint">${escapeHTML(source.caveat)}</div>`
		: ""
}`,
			)
			.join("");
	}

	function enabledSources(settings) {
		return enabledSourceIds(settings, registeredSourceIds()).map((id) =>
			SOURCES.get(id),
		);
	}

	registerSource({
		id: "hn",
		label: "Hacker News",
		shortLabel: "HN",
		caveat:
			"Sends each page you visit to Algolia's Hacker News search, with no identifier attached. Vote, reply and submit through your existing HN session.",
		capabilities: { vote: true, reply: true, submit: true },

		profileURL: (author) =>
			"https://news.ycombinator.com/user?id=" + encodeURIComponent(author),

		// Algolia only. The Firebase items are fetched by loadThread, when there is
		// actually a comment list to build, rather than on every page the reader
		// visits.
		async discover(url) {
			return (await findHN(url)).map(algoliaDiscussion);
		},

		// Returns a reader, not a tree. HN charges one request per comment, so the
		// renderer has to be able to ask for them one at a time and paint between
		// answers -- a source that returns whole trees satisfies the same interface
		// by resolving from a map instead.
		async loadThread(discussion) {
			// The one Firebase read a discussion needs before its comments can start:
			// `kids` exists on the item and nowhere else. A discussion that arrived
			// already carrying roots -- from the queue or the reading list, which go
			// through loadStories -- skips it.
			const roots = discussion.rootKeys.length
				? discussion.rootKeys
				: ((await getItem(discussion.id))?.kids || []).map((id) =>
						sourceKey("hn", id),
					);

			return {
				rootKeys: roots,
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
	// Matches Reddit's own rate window. Long enough that a demoted browser does not
	// re-403 on every page, short enough that a reader who has since loaded
	// reddit.com gets live scores back without doing anything about it.
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

	registerSource({
		id: "reddit",
		label: "Reddit",
		shortLabel: "Reddit",
		beta: true,
		// Measured, not assumed: signed in, a cross-site request from this script
		// arrives at Reddit authenticated as that account -- reddit_session is
		// SameSite=None and rides along. Signed out it carries only the device id.
		// The wording says which, because the difference is the whole trade.
		caveat:
			"Sends each page you visit to reddit.com. Signed in to Reddit, those requests arrive as your account \u2014 Reddit can tie your browsing to it. Signed out, they carry only the long-lived device id your browser already holds. Read-only either way: no voting or replying.",
		capabilities: { vote: false, reply: false, submit: false },

		profileURL: (author) =>
			"https://www.reddit.com/user/" + encodeURIComponent(author) + "/",

		async discover(url) {
			const target = normalizeURL(url);

			if (!target) {
				return [];
			}

			// Two queries, the way findHN already runs two against Algolia -- and for
			// a sharper reason. Reddit matches the URL as it was submitted, and
			// normalizeURL strips the trailing slash, so one canonical query misses
			// every thread whose submission kept it. Measured on a live article:
			// with the slash, eight hits including a 91-comment r/programming
			// thread; without it, zero. Reddit folds `www.` itself, so that needs no
			// variant, and the scheme is taken from the page rather than assumed.
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

		async loadThread(discussion) {
			const result = await redditFetch(
				discussion.permalink.replace("https://www.reddit.com", "") +
					".json?limit=500&sort=top",
				"/api/comments/search?limit=100&link_id=" +
					encodeURIComponent(discussion.id),
			);

			if (!result) {
				return {
					rootKeys: [],
					async getComment() {
						return null;
					},
				};
			}

			const index =
				result.tier === "archive"
					? redditThreadIndexFromFlat(result.json?.data || [], discussion)
					: redditThreadIndex(result.json, discussion);

			return {
				rootKeys: index.rootKeys,
				rootMore: index.rootMore,
				async getComment(key) {
					return index.byKey.get(key) || null;
				},

				// Fills one gap. Reddit takes up to a hundred ids per call and answers
				// with a flat list, so the replies are re-nested here and folded into
				// the same map getComment already reads -- a comment fetched this way
				// is indistinguishable from one that arrived with the tree.
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

					// A request that never answered is not an empty gap. Reported
					// separately so the caller can leave the offer standing rather
					// than quietly withdrawing it -- the rate budget runs out, and
					// "7 more replies" disappearing without producing seven replies
					// is worse than the button never having been there.
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

					// What the caller renders is decided by the caller, because only it
					// knows which comment the gap sat under. Classifying by "has no
					// parent" was wrong in the way that matters: a stub hangs beneath a
					// comment that is already on screen, so every reply it returns has a
					// parent in the map and nothing was ever a root.
					return { ok: true, added, remaining: ids.slice(100) };
				},
			};
		},
	});

	// The discovery entry point. With one source registered it is a fan-out of
	// one, and the current lookup still goes through findHN directly because the
	// button only needs to know whether a discussion exists. This is where a
	// second source plugs in.
	//
	// Sources are independent: one failing must never blank a sidebar that has
	// something else to show, so a rejected discover contributes nothing rather
	// than rejecting the whole lookup.
	async function discoverAll(url, settings) {
		const results = await Promise.all(
			enabledSources(settings).map((source) =>
				source.discover(url).catch((e) => {
					console.error("Backchannel " + source.id + " discovery failed:", e);
					return [];
				}),
			),
		);

		return results.flat().sort(compareStoriesByDiscussion);
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

		// Only a lookup that got an answer is worth an hour. request() resolves
		// null on error, timeout and parse failure, so caching unconditionally
		// stored "nobody posted this" for a moment offline -- and kept a live
		// discussion hidden until the TTL lapsed.
		if (shouldCacheDiscovery(answered)) {
			await save(cacheKey, {
				timestamp: Date.now(),
				results: sorted,
			});
		}

		return sorted;
	}

	const FRONT_PAGE_CACHE_KEY = "HNewhere:frontpage_cache";

	// Five minutes, where findHN caches an hour. What findHN stores is which
	// submissions exist for a URL, and that does not change; a ranking is the one
	// thing on HN that changes continuously, and a front page half an hour old is
	// a different front page.
	const FRONT_PAGE_TTL = 5 * 60 * 1000;

	// Fetched anonymously like everything else the sidebar reads -- the browser
	// strips HN's SameSite cookie from a cross-site GM request -- which for this
	// page costs nothing. The front page is the same for everyone; only the vote
	// arrows would differ, and those are replayed from vote memory anyway.
	async function loadFrontPage(options = {}) {
		// Cached a page at a time, the way findHN caches a URL at a time. One entry
		// holding every page would expire the whole run together, so paging back to
		// where you were would refetch a page you read a moment ago.
		const page = Math.max(1, Number(options.page) || 1);
		const cacheKey = FRONT_PAGE_CACHE_KEY + ":" + page;
		const cached = await load(cacheKey, null);

		if (
			!options.force &&
			cached?.stories?.length &&
			Date.now() - cached.timestamp < FRONT_PAGE_TTL
		) {
			return { stories: cached.stories, nextPage: cached.nextPage ?? null, page };
		}

		const html = await requestText(HN_ORIGIN + "/news?p=" + page);
		const doc = html
			? new DOMParser().parseFromString(html, "text/html")
			: null;
		const stories = doc ? parseFrontPage(doc) : [];

		// A failed fetch, or markup we could not read, falls back to whatever is
		// stored however old. Yesterday's front page is a worse answer than today's
		// and a far better one than an empty panel that does not say why.
		if (!stories.length) {
			return {
				stories: cached?.stories || [],
				nextPage: cached?.nextPage ?? null,
				page,
			};
		}

		const nextPage = parseFrontPageNextPage(doc);

		await save(cacheKey, { timestamp: Date.now(), stories, nextPage });

		return { stories, nextPage, page };
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
				if (TRACKING_PARAMS.has(key.toLowerCase())) {
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

	function pluralize(value, singular, plural = singular + "s") {
		return value + " " + (value === 1 ? singular : plural);
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

	// The matcher is a parameter so the decision can be tested without touching
	// window, and so a browser without matchMedia degrades to "animate" rather
	// than throwing during init.
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

	// Which way a highlight has to blend depends on the paper it lands on, and that
	// is not the question detectDarkMode answers. That one decides what the sidebar's
	// own chrome should look like, so it obeys the reader's theme preference first
	// and, when the page paints no background of its own, the operating system's.
	// Neither is evidence about the article. A highlight told "dark" on a white page
	// screens instead of multiplying, and screen over white paper is white: the mark
	// disappears and only the glyphs shift, which reads as a highlight far too faint
	// rather than as one applied backwards.
	//
	// So this asks the page directly, walking up from the marked text until something
	// has actually painted a background.
	function isDarkBackdrop(element) {
		for (let node = element; node; node = node.parentElement) {
			const dark = isDarkColor(getComputedStyle(node).backgroundColor);

			if (dark !== null) {
				return dark;
			}
		}

		// Nothing in the chain painted anything, so the canvas shows through. That is
		// white unless the page opted into a dark one, which is the only case where
		// the reader's colour scheme says anything about the article.
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

	// The class goes on the host element rather than anything inside the shadow root,
	// because that is what both the sidebar and the submit popover have in common --
	// and custom properties set on a host inherit into its shadow tree.
	function applyThemeToHost(host) {
		host.classList.toggle(DARK_CLASS, detectDarkMode());
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

	// Host pages bind single-key shortcuts on document -- GitHub uses "s" for
	// search -- and guard them by checking whether event.target is a text field.
	// That guard is correct for the light DOM but blind to ours: an event leaving a
	// shadow root is retargeted, so by the time it reaches document the target is
	// this host <div> rather than the <input>. The page concludes nobody is typing,
	// fires the shortcut, and steals focus mid-word (issue #32).
	//
	// Stopping at the host is late enough that every listener inside the shadow
	// root has already run, and narrow enough that shortcuts still work when focus
	// is on one of our buttons rather than in a field. It does not defeat a page
	// listener registered in the capture phase, which would see the event before it
	// ever reaches us; no site is known to bind shortcuts that way.
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
	const ACCENT = "#5b5bd6";
	const ACCENT_DARK = "#8b8bf0";

	// The same accent as channels, for the places that cannot use a CSS variable at
	// all: the annotation overlay is mounted in the page rather than in the panel's
	// shadow root -- deliberately, so mix-blend-mode composites against the article
	// -- and nothing there can see --accent. A var() reference would resolve to
	// nothing and paint every highlight invisible.
	const ACCENT_RGB = "91,91,214";
	// #endregion hnewhere-test-export

	// "HN" was doing double duty as the product's mark and as the name of the only
	// source; with several sources it would have been announcing one of them. The
	// reader can set their own, so this reads the preference rather than a
	// constant -- see normalizeButtonMark for what a valid one is.

	// The two states the floating button can be in. "active" means a discussion is
	// known to exist; "inactive" means the lookup came back empty and clicking offers
	// to submit the page instead. Kept in one table because both the initial cssText
	// and applyButtonMobileStyle used to hardcode the colour separately, which is
	// exactly how the two would drift.
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
		// A third meaning for the circle. Lit is "a discussion exists", grey is
		// "none yet, submit one" -- and with no source enabled neither is true,
		// because nothing has been looked up and nothing will be. Same grey, a
		// different offer.
		setup: {
			background: "#b8b8b8",
			darkBackground: "#4a4a4a",
			boxShadow: "0 1px 3px rgba(0,0,0,.18)",
			title: "Choose where to read comments from",
		},
		// Borrows the inactive grey rather than the orange: this is shown before the
		// lookup answers, and a page with no discussion would otherwise flash orange
		// on its way to grey.
		checking: {
			background: "#b8b8b8",
			darkBackground: "#4a4a4a",
			boxShadow: "0 1px 3px rgba(0,0,0,.18)",
			title: "Checking for discussions…",
		},
	};

	const BUTTON_SPINNER_ID = "hnewhere-button-spinner";
	const BUTTON_PENDING_ID = "hn-checking-button";

	// The button lives in the page, not in a shadow root, and the script injects no
	// page-level stylesheet anywhere -- so the ring is animated with the Web
	// Animations API instead of keyframes. Nothing we add can then collide with the
	// host page's CSS.
	function startButtonSpinner(button) {
		if (!button || button.querySelector(`#${BUTTON_SPINNER_ID}`)) {
			return;
		}

		// The rim itself never moves: it is a mask on this element, cut to whatever
		// border-radius the button is wearing. overflow keeps the sweep inside that
		// shape before the mask narrows it to the edge.
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

		// Only this rotates. Rotating the ring turned the squircle's own outline
		// with it, which read as a spinning square rather than a light traveling
		// the edge. Oversized so its corners still cover the rim once turned.
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

	// The only place these properties are set. They used to be spelled out in both
	// createFloatingHNButton's cssText and applyButtonMobileStyle, which re-asserts
	// them on every resize -- so a value applied to only one of them was silently
	// reverted the next time the window changed size.
	//
	// The label belongs here for the same reason. createFloatingHNButton returns an
	// existing button untouched and adopts a pending one by id, so neither path
	// re-labels it: a mark changed while a button was already on the page stayed on
	// the old one until a reload.
	function applyButtonAppearance(button) {
		const size = buttonSizePreference;

		button.textContent = buttonMarkPreference;
		button.style.width = `${size}px`;
		button.style.height = `${size}px`;
		button.style.fontSize = `${buttonFontSizeFor(size)}px`;
		button.style.borderRadius =
			BUTTON_SHAPES[buttonShapePreference] || BUTTON_SHAPES.circle;
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

			// Re-clamped because a button grown to 56px near a viewport edge would
			// otherwise hang partly off-screen at its stored position. Skipped on
			// mobile for the same reason createRestoreButton skips it: the button is
			// corner-pinned there, not freely positioned.
			if (!isMobile()) {
				await applyButtonPosition(button);
			}
		}
	}

	function setFloatingButtonVariant(button, variant) {
		const style = BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.active;

		// The button sits in the page, not in a shadow root, so it cannot inherit the
		// custom properties and resolves its own colour instead.
		button.dataset.hnewhereVariant = variant;
		button.style.background = detectDarkMode()
			? style.darkBackground
			: style.background;
		button.style.boxShadow = style.boxShadow;
		button.title = style.title;
	}

	function applyButtonMobileStyle(button) {
		Object.assign(button.style, {
			boxSizing: "border-box",
			padding: "0",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			color: "white",
			top: "16px",
			right: "16px",
			opacity: "1",
		});

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

			// A button drawn before the lookup answered becomes whichever button the
			// answer calls for, rather than being torn down and rebuilt: rebuilding
			// would drop the ring mid-fade and discard a position the reader had
			// already dragged it to.
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

			button.style.cssText = `
					position:fixed;
					top:16px;
					right:16px;
					z-index:2147483647;
					color:white;
					border:none;
					padding:0;
					font-family:Verdana,sans-serif;
					font-weight:bold;
					cursor:pointer;
					user-select:none;
					touch-action:none;
					display:flex;
					align-items:center;
					justify-content:center;
					-webkit-tap-highlight-color:transparent;
					/* box-shadow rides along because setFloatingButtonVariant writes it
					   too: without it the glow snapped while the fill cross-faded, which
					   is visible when the button settles out of "checking". */
					transition:background .2s ease, box-shadow .2s ease;
					/* So the fill overlay can be clipped to the circle. */
					overflow:hidden;
					isolation:isolate;
				`;

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

	// og:title first because it is what the author wrote for sharing, whereas
	// document.title routinely carries a " | Site Name" tail that only wastes
	// characters against HN's limit.
	function suggestedSubmissionTitle() {
		const candidates = [
			document.querySelector('meta[property="og:title"]')?.content,
			document.querySelector('meta[name="twitter:title"]')?.content,
			document.title,
			location.hostname,
		];

		for (const candidate of candidates) {
			const trimmed = (candidate || "").trim().replace(/\s+/g, " ");

			if (trimmed) {
				return trimmed.slice(0, HN_TITLE_LIMIT);
			}
		}

		return "";
	}

	// Fills the circle bottom-to-top, then leaves a plain orange button behind. Uses
	// element.animate() rather than a keyframe rule so nothing has to be injected into
	// the host page's stylesheet, and animates clip-path rather than a gradient
	// because clip-path actually interpolates.
	function animateButtonFill(button) {
		const overlay = document.createElement("span");

		overlay.textContent = buttonMarkPreference;
		overlay.style.cssText = `
			position:absolute;
			inset:0;
			display:flex;
			align-items:center;
			justify-content:center;
			background:${BUTTON_VARIANTS.active.background};
			color:white;
			font:bold 13px Verdana,sans-serif;
			border-radius:50%;
			clip-path:inset(100% 0 0 0);
			pointer-events:none;
		`;

		button.appendChild(overlay);

		const fill = overlay.animate(
			[{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
			{
				duration: 620,
				easing: "cubic-bezier(.22,.61,.36,1)",
				fill: "forwards",
			},
		);

		// A short settle so the fill reads as landing rather than stopping.
		button.animate(
			[
				{ transform: "scale(1)" },
				{ transform: "scale(1.12)" },
				{ transform: "scale(1)" },
			],
			{ duration: 420, delay: 480, easing: "ease-out" },
		);

		return fill.finished
			.catch(() => {})
			.then(() => {
				setFloatingButtonVariant(button, "active");
				overlay.remove();
			});
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

	function commentURL(storyID) {
		return HN_ORIGIN + "/item?id=" + storyID;
	}

	function submitURL(url, title) {
		return (
			HN_ORIGIN +
			"/submitlink?u=" +
			encodeURIComponent(url) +
			"&t=" +
			encodeURIComponent(title)
		);
	}

	function editURL(storyID) {
		return HN_ORIGIN + "/edit?id=" + storyID;
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

	// A popup that is closed before it finishes leaves its payload behind, so the
	// keys are swept rather than only deleted on the happy path. GM.listValues is not
	// granted, so this piggybacks on an index kept alongside the payloads.
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

	// Parses the fragment the sidebar attaches when it opens a bridge popup. Shared
	// by the submit and comment bridges, which differ only in their marker key.
	function parseBridgeHash(marker) {
		const hash = location.hash.replace(/^#/, "");

		if (!hash) {
			return null;
		}

		const params = new URLSearchParams(hash);

		if (params.get(marker) !== "1") {
			return null;
		}

		const nonce = params.get("nonce");

		if (!nonce) {
			return null;
		}

		return {
			nonce,
			origin: params.get("origin"),
			storyID: params.get("story"),
		};
	}

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
				if (event.origin !== HN_ORIGIN) {
					return;
				}

				const data = event.data;

				if (!data || data.source !== source || !data.nonce) {
					return;
				}

				const request = pending.get(data.nonce);

				if (!request) {
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

		// MUST be called synchronously from the click that triggered it. Browsers only
		// honour window.open while the user gesture is still on the stack, and these
		// bridges have to stage a payload in GM storage first -- awaiting that before
		// opening is exactly what got the popup blocked while voting, which stages
		// nothing, sailed through. So the window is opened blank while the gesture is
		// still live and navigated once the payload is in place.
		return function openBridge(nonce, { timeout = 60000, features } = {}) {
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
				// Deliberately does not close the popup on timeout. Like the vote bridge,
				// the action is a form navigation, and closing mid-flight aborts it. The
				// window is generous because a submission or comment spans two page loads
				// and the reader may have to log in first.
				const timeoutId = window.setTimeout(() => {
					pending.delete(nonce);
					resolve({ ok: false, reason: "timeout" });
				}, timeout);

				pending.set(nonce, { resolve, timeoutId, popup });
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

	function itemActionPageURL(storyID, itemId, action, voteURL, nonce) {
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

	function setupItemActionListener() {
		if (window.__hnewhereItemActionListenerInstalled) {
			return;
		}

		window.__hnewhereItemActionListenerInstalled = true;
		window.addEventListener("message", (event) => {
			if (event.origin !== HN_ORIGIN) {
				return;
			}

			const data = event.data;

			if (!data || data.source !== ITEM_ACTION_BRIDGE_MESSAGE_SOURCE || !data.nonce) {
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

			// Favorite and flag are remembered the same way and for the same reason:
			// the popup is the only place the truth was visible. An unavailable action
			// is remembered too, so the sidebar stops offering a link that cannot
			// work rather than asking again on every comment.
			if (data.itemId && ITEM_ACTION_PATHS[data.action]) {
				const field = data.action.endsWith("fave") ? "favorite" : "flagged";

				if (data.reason === "action-unavailable") {
					// Remembered against the account rather than the story. Being logged
					// out, or below the karma flagging asks for, is not a fact about the
					// item -- so recording it per item meant discovering it again on
					// every one, a popup at a time.
					rememberItemActionUnavailable(field);
					refreshAllItemActionControls();
					return;
				}

				if (typeof data.applied === "boolean") {
					rememberItemAction(data.itemId, { [field]: data.applied });

					// HN just answered for this action, so whatever made it look
					// unavailable no longer holds. Self-healing matters here because
					// the record is account-wide: without it a single wrong answer
					// would keep every one of these links hidden until it expired.
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

	function openItemActionPopup(storyID, itemId, action, voteURL) {
		setupItemActionListener();

		return new Promise((resolve) => {
			const nonce =
				String(Date.now()) + Math.random().toString(36).slice(2, 10);
			const bridgeURL = itemActionPageURL(
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
				itemActionRequests.delete(nonce);
				resolve({ ok: false, reason: "timeout" });
			}, 12000);

			itemActionRequests.set(nonce, {
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
			const result = await openItemActionPopup(
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

		// The arrows cannot be drawn until HN's per-item auth link has been scraped,
		// so they always arrive after the comment they belong to. The slot already
		// reserves their width, so nothing moves -- this only stops them snapping in.
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
				await submitVote(storyID, itemId, descriptor, container);
			};

			container.appendChild(button);
		}
	}

	// Ridden along with the vote hydration rather than given a pass of its own: both
	// are "put the state we remember onto the rows that have just rendered", and
	// they are wanted at exactly the same moments -- a first render, a re-render, a
	// blended view gaining a submission.
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

	// The visible viewport, which is not window.innerWidth: that includes the
	// scrollbar, so clamping to it let the button sit underneath one. On a page
	// with a vertical scrollbar the button landed 15px past the last visible pixel
	// and had to be dragged back into view.
	//
	// The margin keeps it off the edge entirely. Flush against the boundary is
	// where a button is hardest to grab and where a scrollbar, an overlay or a
	// rounded display corner is most likely to cover it.
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

		button.style.left = x + "px";
		button.style.top = y + "px";
		button.style.right = "auto";
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

			button.style.left = x + "px";
			button.style.top = y + "px";
			button.style.right = "auto";
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

			button.style.left = x + "px";
			button.style.top = y + "px";
			button.style.right = "auto";
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

	// Hiding the discussion keeps every reference into it alive, but it does not
	// keep the reader's place: #comments is the scroll container for both views, so
	// hiding one collapses its height and the browser clamps scrollTop to zero long
	// before anyone comes back. The position is carried across by hand for the same
	// reason preFilterPosition exists -- leaving a surface should put you back where
	// you left it.
	let discussionScrollTop = 0;

	// Matches the .16s the two views transition over, so the outgoing one is gone
	// before the swap rather than being cut off partway down.
	const VIEW_SWAP_FADE_MS = 160;

	// The wordmark carries both states rather than a second control appearing
	// beside it: it is the same affordance in both directions -- go to Hacker News,
	// come back to this page -- and the header's action row already holds three.
	//
	// One class toggle and a title. Both labels are already in the button and CSS
	// picks between them, so nothing here rewrites markup on a control the reader
	// is pointing at.
	function setBrowseMode(ui, on, options = {}) {
		const panel = ui?.shadow?.querySelector("#panel");
		const toggle = ui?.shadow?.querySelector("#browse-toggle");
		const comments = ui?.shadow?.querySelector("#comments");

		if (!panel || !toggle) {
			return;
		}

		// Nowhere to go: no front page, because the source that has one is switched
		// off, and nothing waiting in the queue. The wordmark is hidden in that
		// state, so this catches the gap before the first refresh has settled it --
		// frontPageAvailable starts out optimistic, and a press landing in that gap
		// opened browse onto a tab that was not there and bounced straight back out.
		if (on && !frontPageAvailable && !queueHasItems) {
			return;
		}

		if (on && comments) {
			discussionScrollTop = comments.scrollTop;
		}

		// What the panel opens on, decided fresh each time it is opened. A queue
		// with something in it is what the reader came for -- they put it there --
		// so it leads. Switching tabs while the panel is open lasts as long as the
		// panel is open, and no longer: a latch that survived would mean one
		// incidental press turning this off for good, invisibly, which is the fault
		// the auto-open setting was already fixed for once.
		if (on) {
			// Queue first when it has something, and always when there is no front
			// page to fall back on -- otherwise turning Hacker News off and pressing
			// the wordmark opened an empty front page for a source that is not on.
			browseTab =
				options.tab ||
				(queueHasItems || !frontPageAvailable ? "queue" : "front");
		}

		const swap = () => {
			panel.classList.toggle("browsing", on);
			toggle.title = on ? "Back to this page's discussion" : browseLabel();

			if (comments) {
				// Assigning scrollTop forces the layout it depends on, so the list is
				// measured in the state the class change has just put it in rather
				// than the one before.
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

	// The outgoing view fades, the swap happens behind it, and the incoming one
	// fades up. The class has to survive one frame past the swap: the view arriving
	// was display:none until that moment, and a browser given its display and its
	// opacity in the same frame settles both at once with nothing to transition --
	// the same reason the panel's own fade waits a frame.
	//
	// `swap` may be async and slow. It is not awaited on purpose: the fade covers
	// the moment the old content leaves, and anything that streams in afterwards
	// arrives during the fade up, which is what makes a rebuilt thread read as
	// regenerating rather than as the panel blinking.
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

	// Borrowing the story vocabulary rather than renderStory itself: the title
	// leads to the article here instead of to the discussion, there is no composer
	// and no story text, and a rank sits in front. Same classes, so a browse row
	// and the story at the top of a discussion read as the same kind of object.
	function renderBrowseRow(story, container, rank, options = {}) {
		// HN's own order and HN's own punctuation: the age follows the author on a
		// bare space, the actions come next, and the comment count closes the line.
		// `75 points by AlexeyBrin 3 hours ago | hide | 11 comments`.
		//
		// One shape for both lists. The queue is the front page with most of it
		// filtered out, so a story in it is described the same way -- what differs
		// is which stories are there and what order they are in.
		const meta = `${escapeHTML(pluralize(story.score, "point"))}${story.by ? ` by ${escapeHTML(story.by)}` : ""}
	<span class="item-age">${escapeHTML(timeAgo(story.time))}</span>
	|
	<button class="browse-save-link" type="button">queue</button>
	${itemActionLinksHTML(story.id)}
	|
	<a class="browse-comments-link" href="${escapeHTML(commentURL(story.id))}"
	target="_blank" rel="noopener noreferrer">${escapeHTML(pluralize(story.descendants, "comment"))}</a>`;

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

		const saveButton = row.querySelector(".browse-save-link");

		{
			// A text link on these rows says what pressing it will do, the way every
			// one of HN's own does -- favorite becomes un-favorite, not favorited. In
			// the queue the thing it will do is take the story out of the list, and
			// "remove" is what that is called there.
			const queuedLabel = options.inQueue ? "remove" : "queued";

			// Read once per row rather than passed in, so a row rendered after
			// something was queued elsewhere still opens in the right state.
			loadQueue()
				.then((entries) => {
					saveButton.textContent = entries.some((e) => e.id === story.id)
						? queuedLabel
						: "queue";
				})
				.catch(console.error);

			// The same toggle in both lists. Un-queueing from inside the queue takes
			// the row out with it rather than waiting for a redraw, so the list
			// answers at once; on the front page the row stays and only the word
			// changes, because the story is still on the front page either way.
			saveButton.onclick = async () => {
				const entries = await loadQueue();
				const already = entries.some((e) => e.id === story.id);

				await saveQueue(
					already
						? removeFromQueue(entries, story.id)
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

		row.querySelector(".browse-title-link").onclick = (event) => {
			// The same record setupHNListener writes when you click a story on HN.
			// Written before navigating, so the page you land on reads the arrival it
			// would have read coming from HN itself -- which is what makes automatic
			// opening, and "only when arriving from Hacker News", apply to a story
			// opened from here without either of them knowing this path exists.
			const record = save(STORAGE.last, {
				url: story.url,
				ids: [String(story.id)],
				timestamp: Date.now(),
			});

			// A modified or middle click means "open it somewhere else" everywhere on
			// the web, and it means that here too, so the default is left alone. The
			// record is still made and simply not waited on: the browser is already
			// opening the tab, and a GM write lands well inside a page load.
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
				return;
			}

			event.preventDefault();

			// Navigates either way. A storage error is not a reason to refuse to open
			// the article -- it costs the arrival, not the click.
			record.catch(() => {}).then(() => {
				location.href = story.url;
			});
		};

		container.appendChild(row);
		return row;
	}

	let queueHasItems = false;
	// Whether there is a front page to show at all, which is Hacker News being on.
	// Cached for the same reason queueHasItems is: renderBrowseView picks a tab
	// synchronously and cannot wait on a settings read to do it.
	let frontPageAvailable = true;

	// What is actually behind the wordmark, in one place because three of them set
	// this title -- the header template, setBrowseMode on every toggle, and
	// refreshBrowseAffordances when the sources change. Kept as two literals, the
	// last writer won, and a wordmark went on naming Hacker News after it had been
	// switched off and its front page tab had already gone.
	function browseLabel() {
		return frontPageAvailable ? "Hacker News and your queue" : "Your queue";
	}

	// The count belongs on the tab, so saving anywhere has to reach it. Takes a root
	// rather than the ui object because a browse row only knows the tree it is in.
	// The front page behind the wordmark is Hacker News' own, parsed from its
	// markup. With Hacker News switched off there is no front page to show, so the
	// tab goes -- and if the queue is empty too there is nothing behind the
	// wordmark at all, so the wordmark goes with it rather than opening onto an
	// empty list under a tab for a source the reader turned off.
	async function refreshBrowseAffordances(root) {
		const frontTab = root?.querySelector?.("#browse-tab-front");
		const wordmark = root?.querySelector?.("#browse-toggle");

		if (!frontTab && !wordmark) {
			return;
		}

		const settings = await loadSettings();
		frontPageAvailable = enabledSourceIds(
			settings,
			registeredSourceIds(),
		).includes("hn");

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

		// Standing on a page that has just become unavailable. The queue is the only
		// other place to be, and if that is empty too the browse view has nothing
		// left -- so it hands back to the discussion rather than sitting on a blank
		// list. Guarded on browseTab so this cannot loop through renderBrowseView.
		if (!frontPageAvailable && browseTab === "front" && sidebarUI) {
			if (queueHasItems) {
				renderBrowseView(sidebarUI, { tab: "queue" }).catch(console.error);
			} else {
				setBrowseMode(sidebarUI, false);
			}
		}
	}

	async function refreshQueueCount(root) {
		const tab = root?.querySelector?.("#browse-tab-queue");

		if (!tab) {
			return;
		}

		const entries = await loadQueue();
		const unread = unreadQueueCount(entries);

		// The bare word when there is nothing waiting. A "(0)" is a number that says
		// nothing and still asks to be read. Lower case, the way HN sets the tabs on
		// its own pages -- "submissions | comments" on a profile.
		tab.textContent = unread ? `queue (${unread})` : "queue";

		queueHasItems = entries.length > 0;

		// Present or absent, never moved. A tab that slides about as its contents
		// change asks to be watched; one that is simply there when it has something
		// to offer does not.
		tab.hidden = !queueHasItems;

		// Reads the queue, so the wordmark's own availability is settled here where
		// the answer is already known rather than by loading it a second time.
		// Before the fallback below, not after: that fallback asks whether there is
		// a front page to fall back to, and this is what answers it.
		await refreshBrowseAffordances(root);

		// Emptied while it was the thing on screen. The tab it was under has just
		// gone, so staying would leave the reader on a list with nothing in it
		// beneath a tab that is no longer there. Safe from looping: renderBrowseView
		// sets the tab before it reaches this, so the pass it starts cannot come
		// back through here.
		if (!queueHasItems && browseTab === "queue" && sidebarUI) {
			if (frontPageAvailable) {
				renderBrowseView(sidebarUI, { tab: "front" }).catch(console.error);
			} else {
				// The front page used to be "the only other place to be", which was
				// true while Hacker News was the only source. Switched off, there is
				// no front page to land on, and sending the reader to that tab was
				// what made pressing the wordmark open browse and snap shut again.
				setBrowseMode(sidebarUI, false);
			}
		}
	}

	// Kept across a round trip to the discussion, the way the discussion's own
	// scroll position is: having paged three deep and gone to read something, coming
	// back to the first page again would be the panel forgetting where you were.
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

		// On the first page there is only one direction to go, and Hacker News calls
		// it More -- capitalised, as it writes it. Saying "page 1" and offering a
		// disabled way back is the panel describing a position nobody is lost in.
		if (page <= 1) {
			if (nextPage) {
				nav.appendChild(link("More", nextPage));
				view.appendChild(nav);
			}

			return;
		}

		// Deeper in there is a way back as well, and then which end you are at is
		// worth stating: a list that has run out is a different thing from one that
		// has more, and both ends stay visible rather than vanishing.
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

	// At the foot of a finished discussion, which is where the question it answers
	// gets asked. Rendered only when something is actually waiting: a strip that
	// says "nothing next" is furniture.
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
		// The one still to be read is included, so this counts what is left rather
		// than what is left after this one -- "1 left" on the last article reads as
		// there being another.
		count.textContent = pluralize(remaining, "left", "left");

		title.onclick = (event) => {
			// Same record and same rules as a browse row: this is a story being opened
			// from HNewhere, and the page it lands on should read it as an arrival.
			const record = save(STORAGE.last, {
				url: next.url,
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

		// The contents go in a row of their own so the strip itself can carry the
		// band as a ::before. As a flex container it could not: a pseudo-element
		// there becomes another item in the row rather than a block above it.
		const row = document.createElement("div");
		row.className = "next-up-row";
		row.append(label, title, count);

		strip.replaceChildren(row);
		strip.classList.remove("hidden");
	}

	// True while the panel is showing a discussion. False when it was opened purely
	// to browse, from a page that has none -- which decides what the chevron goes
	// back to and which button minimizing leaves behind.
	let sidebarHasDiscussion = true;

	// What sits behind the chevron when there is no discussion. It has to say
	// something: a back arrow leading to an empty panel reads as a fault, and the
	// reason it is empty is the one thing worth saying here.
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

		// Animated outright rather than by adding a class and taking it away. A CSS
		// transition needs a start the browser has actually resolved, and this panel
		// is created, classed and un-classed inside a single task -- so there is
		// never a resolved off-screen state to leave, and both states collapse into
		// "already arrived". Neither a pair of animation frames nor a forced layout
		// read shook that loose.
		//
		// An animation carries its own first keyframe, so there is nothing to
		// coalesce and nothing to time. It is also how the rest of the file animates
		// -- the button's spinner and the submit fill are both done this way -- and
		// it leaves no styles behind to clean up afterwards.
		panel.animate(
			[
				{ transform: "translateX(100%)", opacity: 0 },
				{ transform: "none", opacity: 1 },
			],
			{ duration: PANEL_ENTER_MS, easing: "ease" },
		);
	}

	// The trail's destination, which is not always the same place. Off an article it
	// leads to Read more -- the front page and the queue together. On Hacker News
	// the front page is already underneath the panel, so the only thing it can be
	// offering is the queue, and it says so.
	function setWordmarkDestination(ui, label) {
		const tail = ui?.shadow?.querySelector(".wordmark-tail");
		const sep = tail?.querySelector(".wordmark-sep");

		if (!tail || !sep) {
			return;
		}

		const swap = () => tail.replaceChildren(sep, document.createTextNode(label));

		// Nothing to announce if it already says this, and animating it anyway would
		// blink the trail every time the same tab is re-rendered.
		if (tail.textContent.endsWith(label)) {
			return;
		}

		if (prefersReducedMotion() || typeof tail.animate !== "function") {
			swap();
			return;
		}

		// Out, changed, back in. The word is swapped at the bottom of the fade
		// rather than at either end, so the trail is never seen mid-change -- what
		// reads as one thing becoming another rather than as text being edited.
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

	// The panel on Hacker News itself, offered only once there is a queue to work
	// through. HN is where a queue gets filled, often across several pages, and
	// what you do next is read it -- which until now meant remembering what you
	// had put in.
	async function offerQueueOnHN() {
		if (document.getElementById("hn-queue-button")) {
			return;
		}

		// The Hacker News branch returns long before runPagePass, which is where
		// every other page reads these. Without them the button is drawn from the
		// declared defaults -- a 44px circle on the automatic theme -- whatever the
		// reader actually chose, and a site they had hidden HNewhere on would put
		// one there regardless.
		//
		// loadSettings is called for its effect rather than its answer: it syncs the
		// appearance preferences the button is built from.
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

	// The queue rendered as rows, reusing the front page's row exactly -- it is the
	// same object in the same list, and giving it a second appearance would say the
	// two were different kinds of thing.
	// Returns whether anything actually changed, so a redraw only happens when there
	// is something new to show. Without that the refresh would redraw the list every
	// time the tab is opened, and the redraw would start another refresh.
	// A handful at a time rather than all at once. A queue is meant to be filled
	// over days, so forty entries is an ordinary size and forty simultaneous
	// requests is not -- getItem caches, so this is paid once a session, but paying
	// it as one burst is how a reader ends up rate-limited for reading.
	const QUEUE_REFRESH_BATCH = 6;

	async function refreshQueueEntries(entries) {
		const fetched = [];

		for (let i = 0; i < entries.length; i += QUEUE_REFRESH_BATCH) {
			fetched.push(
				...(await Promise.all(
					entries
						.slice(i, i + QUEUE_REFRESH_BATCH)
						.map((entry) => getItem(entry.id).catch(() => null)),
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

		// The same row the front page draws, from the same function. What makes this
		// the queue is which stories are in it and what order they are in -- the
		// unread first, oldest saved at the top, the read greyed and beneath them --
		// not a different way of describing a story.
		entries.forEach((entry, index) => {
			const row = renderBrowseRow(entry, list, index + 1, { inQueue: true });
			row.classList.toggle("browse-row-read", Boolean(entry.readAt));
		});

		refreshAllItemActionControls();

		// Scores and comment counts move while something sits in a queue, and a
		// queue is read days after it was filled. Refreshed from the item API rather
		// than trusted as stored, after the rows are already up so nothing waits on
		// it, and through getItem so a story is fetched once a session however many
		// times it is drawn.
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

	async function renderFrontPageView(ui, list) {
		// Only on a first paint. Re-entering with rows already up leaves them in
		// place until the new ones are ready, so switching back and forth does not
		// blank the list each time.
		if (!list.childElementCount) {
			list.textContent = "Loading Hacker News…";
		}

		const requested = browsePage;
		const { stories, nextPage, page } = await loadFrontPage({ page: requested });

		// A second click while the first was still in flight, so this answer is for
		// a page nobody is waiting for any more.
		if (browsePage !== requested || browseTab !== "front") {
			return;
		}

		if (!stories.length) {
			list.textContent = "Could not reach Hacker News.";
			return;
		}

		list.replaceChildren();
		stories.forEach((story, index) =>
			renderBrowseRow(story, list, (page - 1) * FRONT_PAGE_SIZE + index + 1),
		);

		// These rows never pass through the vote hydration, which is what carries
		// remembered favorite and flag state onto a discussion. Put on here instead,
		// once the list exists.
		refreshAllItemActionControls();

		renderBrowseNav(list, { page, nextPage }, (target) => {
			// Back to the top: the reader asked for a different page, not for the same
			// place in a new one.
			scrollBrowseToTop(ui);
			renderBrowseView(ui, { page: target }).catch(console.error);
		});
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

		// The trail names where you actually are, not where the door led. Read more
		// is the pair of them; once you are standing in one of the two, saying so is
		// the more useful thing for it to say.
		setWordmarkDestination(ui, browseTab === "queue" ? "Queue" : "Read more");

		refreshQueueCount(ui.shadow);

		if (browseTab === "queue") {
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
		button.style.fontSize = "11px";
		button.style.color = "white";

		window.setTimeout(() => {
			button.textContent = buttonMarkPreference;
			applyButtonMobileStyle(button);
		}, 900);
	}

	// Takes a resolved array now rather than the resolver it used to accept: the
	// discussion lookup moved ahead of the first paint in 1.5.3 so the button's
	// colour can mean something, which leaves nothing left to resolve on click.
	// The colour answers "is there a discussion here", the ring answers "am I still
	// working". They are separate questions, so the colour settles the moment the
	// lookup replies rather than waiting for the comments and the annotation pass
	// -- which is what kept the button grey for the whole of startup.
	function settleButtonToDiscussion(button) {
		if (button) {
			setFloatingButtonVariant(button, "active");
		}
	}

	// Drawn before the discussion lookup answers, so the page shows something at
	// once. createFloatingHNButton adopts it as soon as the real button is asked
	// for, which is also when it gains that button's behaviour.
	// Pressed while the lookup was still running. The button spins for as long as
	// that takes and used to do nothing at all when pressed, which is the one thing
	// a button must not do -- so the press is remembered and honoured the moment
	// there is an answer to honour it with.
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

	// Its own shadow root for the same reason the sidebar has one: this renders over
	// an arbitrary page whose CSS would otherwise reach in and restyle it.
	function createSubmitPopover(button, onSubmit, onClose) {
		const host = document.createElement("div");

		host.setAttribute("data-hnewhere-submit-popover", "1");
		host.style.cssText = `
			position:fixed;
			z-index:2147483647;
			top:0;
			left:0;
		`;

		const shadow = host.attachShadow({ mode: "open" });

		shadow.innerHTML = `
<style>
${THEME_CSS}
${CHROME_CSS}

#popover {
	width:320px;
	box-sizing:border-box;
	background:var(--bg);
	color:var(--text);
	border:1px solid var(--border);
	border-radius:8px;
	box-shadow:0 8px 24px rgba(0,0,0,.18);
    /* No padding of its own: the header runs edge to edge like the sidebar's and
       rounds its own top corners. The body below carries the inset instead.
       Deliberately no overflow:hidden -- it used to clip the header, but it also
       clipped the absolutely positioned settings dropdown to this box, and the
       popover is only as tall as a short submit form. */
	padding:0;
    /* Containing block for the absolutely positioned settings dropdown. */
	position:relative;
	font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
	font-size:12px;
	line-height:1.4;
    /* The same inheritance the panel has to close off, for the same reason: this
       is a second shadow root on the same page, and it reads whatever the host
       inherited. See #panel for the full account. */
	text-align:left;
	text-indent:0;
	text-transform:none;
	letter-spacing:normal;
	word-spacing:normal;
	font-style:normal;
	font-variant:normal;
	white-space:normal;
}

/* Same inset the sidebar's #comments uses, so the two read as one product. */
.popover-body {
	padding:12px 12px 8px;
    /* The form is tall enough to run off a short viewport, so it scrolls itself
       rather than being clipped by the edge of the screen. Sized against the header
       and the popover's own vertical margins. */
	max-height:calc(100vh - 120px);
	overflow-y:auto;
}

/* Rounds its own top corners now that #popover no longer clips its children. */
#popover header {
	border-radius:7px 7px 0 0;
}

/* Narrower host than the sidebar, so the dropdown spans the width rather than
   sitting in a 240px column that would overhang the left edge. */
.settings-panel {
	top:44px;
	right:8px;
	left:8px;
	width:auto;
}

.popover-title {
	font-weight:600;
	margin-bottom:8px;
}

/* HN's own explanation of how url and text interact. Kept because the two fields
   are genuinely non-obvious: a blank url turns the whole thing into an Ask HN. */
.popover-note {
	margin-top:8px;
	color:var(--muted);
	font-size:11px;
}

.popover-field + .popover-field {
	margin-top:8px;
}

/* All of the following are scoped to .popover-field rather than bare element
   selectors. The settings dropdown shares this shadow root now, and a bare
   "input" rule would stretch its checkboxes to full width and give them a text
   field's border. */
.popover-field label {
	display:block;
	color:var(--muted);
	font-size:10px;
	font-weight:700;
	letter-spacing:.04em;
	text-transform:uppercase;
	margin-bottom:3px;
}

/* Label left, character count hard right, sharing one line above the field. Baseline
   alignment rather than centre so the count sits on the label's baseline despite
   being the smaller of the two. */
.popover-field-head {
	display:flex;
	align-items:baseline;
	justify-content:space-between;
	gap:8px;
	margin-bottom:3px;
}

.popover-field-head label {
	margin-bottom:0;
}

.popover-field input,
.popover-field textarea {
	width:100%;
	box-sizing:border-box;
	font:13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	padding:5px 6px;
	border:1px solid var(--field-border);
	border-radius:4px;
	background:var(--field-bg);
	color:var(--field-text);
}

.popover-field textarea {
	min-height:56px;
	resize:vertical;
    /* Same reasoning as the sidebar composer: HN reads leading spaces as code. */
	white-space:pre-wrap;
}

.popover-field input:focus,
.popover-field textarea:focus {
	outline:2px solid rgba(var(--accent-rgb),.4);
	outline-offset:-1px;
}

.popover-count {
	color:var(--meta);
	font-size:10px;
    /* Fixed digits would be better, but the count is short enough that reflow is
       imperceptible; what matters is that it never pushes the label around. */
	flex:0 0 auto;
	white-space:nowrap;
}

.popover-count.over {
	color:var(--error);
}

.popover-actions {
	display:flex;
	justify-content:flex-end;
	gap:6px;
	margin-top:10px;
}

/* Scoped for the same reason as the fields above: the header's gear button lives
   in this shadow root and must keep its own borderless styling. */
.popover-actions button {
	font:600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	padding:5px 10px;
	border-radius:4px;
	cursor:pointer;
	border:1px solid var(--button-border);
	background:var(--button-bg);
	color:var(--button-text);
}

.popover-actions button.primary {
	background:var(--accent);
	border-color:var(--accent);
	color:white;
}

.popover-actions button:disabled {
	opacity:.6;
	cursor:default;
}

.popover-status {
	margin-top:8px;
	font-size:11px;
	line-height:1.4;
}

.popover-status.error {
	color:var(--error);
}

.popover-status a {
	color:var(--link);
}

.hidden {
	display:none;
}
</style>

<div id="popover" role="dialog" aria-label="Submit to Hacker News">
${headerHTML({ browse: true })}
${settingsPanelHTML()}

<div class="popover-body">
<div class="popover-title">Submit</div>

<div class="popover-field">
<div class="popover-field-head">
<label for="submit-title">title</label>
<span id="submit-count" class="popover-count"></span>
</div>
<input id="submit-title" type="text" maxlength="${HN_TITLE_LIMIT}" spellcheck="true">
</div>

<div class="popover-field">
<label for="submit-url">url</label>
<input id="submit-url" type="text" spellcheck="false">
</div>

<div class="popover-field">
<label for="submit-text">text</label>
<textarea id="submit-text" rows="3" spellcheck="true"></textarea>
</div>

<div class="popover-note">
Leave url blank to submit a question for discussion. If there is no url, text will appear at the top of the thread. If there is a url, text is optional.
</div>

<div class="popover-actions">
<button id="submit-cancel" type="button">Cancel</button>
<button id="submit-go" type="button" class="primary">Submit</button>
</div>

<div id="submit-status" class="popover-status hidden" role="status"></div>
</div>
</div>
`;

		guardHostKeyboard(host);
		document.body.appendChild(host);

		// Same palette as the sidebar, resolved independently because this is its own
		// shadow root -- the two can be open at different times on different pages.
		const stopWatchingTheme = watchTheme(host);

		// The gear needs somewhere to open into, so the popover carries the same
		// dropdown the sidebar does. No annotation refresh is passed: there is no
		// sidebar to refresh when this is on screen.
		wireSettingsPanel(shadow).catch(console.error);

		// The wordmark is the way out of this page and into the rest of HN, which is
		// as true here as it is in the sidebar -- more so, since this page has no
		// discussion of its own to read. It opens the panel rather than trying to
		// fit thirty stories into a 320px popover.
		const browseToggle = shadow.querySelector("#browse-toggle");

		if (browseToggle) {
			browseToggle.onclick = () => {
				// close(), not onClose(): the latter only tells the button its popover
				// has gone, which would leave the popover itself sitting on the page
				// behind the panel. Declared further down, which is fine -- nothing
				// runs this until it has been clicked.
				close();
				openSidebar([], { browseOnly: true }).catch(console.error);
			};
		}

		const titleInput = shadow.querySelector("#submit-title");
		const countLabel = shadow.querySelector("#submit-count");
		const urlInput = shadow.querySelector("#submit-url");
		const textInput = shadow.querySelector("#submit-text");
		const goButton = shadow.querySelector("#submit-go");
		const cancelButton = shadow.querySelector("#submit-cancel");
		const statusLine = shadow.querySelector("#submit-status");

		// Same two values HN's own bookmarklet passes to /submitlink, both editable
		// here because the bookmarklet's weakness is that they are not.
		titleInput.value = suggestedSubmissionTitle();
		urlInput.value = location.href;

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

		// Anchored to the button rather than a fixed corner, because the button is
		// draggable and may be sitting anywhere along the edge.
		const position = () => {
			const rect = button.getBoundingClientRect();
			const popover = shadow.querySelector("#popover");
			const width = popover.offsetWidth || 264;
			const height = popover.offsetHeight || 180;
			const gap = 8;

			let left = rect.right - width;
			let top = rect.bottom + gap;

			// Flip above when there is no room below, and keep it on screen either way.
			if (top + height > window.innerHeight - gap) {
				top = Math.max(gap, rect.top - height - gap);
			}

			left = Math.min(Math.max(gap, left), window.innerWidth - width - gap);

			host.style.left = left + "px";
			host.style.top = top + "px";
		};

		position();
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		// The button is draggable, and dragging it while this is open would otherwise
		// leave the panel stranded where the button used to be.
		button.addEventListener(BUTTON_MOVE_EVENT, position);

		let closed = false;

		const close = () => {
			if (closed) {
				return;
			}

			closed = true;
			window.removeEventListener("resize", position);
			window.removeEventListener("scroll", position, true);
			button.removeEventListener(BUTTON_MOVE_EVENT, position);
			stopWatchingTheme();
			document.removeEventListener("pointerdown", onOutsidePointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
			host.remove();
			// Reported back so the button's toggle state cannot get out of step when the
			// popover is dismissed by an outside click or Escape rather than by the
			// button itself -- otherwise reopening it would take two clicks.
			onClose?.();
		};

		function onOutsidePointerDown(event) {
			const path = event.composedPath();

			if (path.includes(host) || path.includes(button)) {
				return;
			}

			close();
		}

		function onKeyDown(event) {
			if (event.key === "Escape") {
				event.stopPropagation();
				close();
			}
		}

		document.addEventListener("pointerdown", onOutsidePointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);

		cancelButton.onclick = close;

		const setStatus = (message, { error = false, html = false } = {}) => {
			statusLine.classList.remove("hidden");
			statusLine.classList.toggle("error", error);

			if (html) {
				statusLine.innerHTML = message;
			} else {
				statusLine.textContent = message;
			}
		};

		goButton.onclick = async () => {
			const title = titleInput.value.trim();
			const url = urlInput.value.trim();
			// Not trimmed: HN reads two leading spaces as a code block, so the body has
			// to reach it exactly as typed.
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
				await onSubmit({ title, url, text }, { setStatus, close });
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

		return { close, host };
	}

	// Not async, for the same reason as submitCommentToHN: window.open has to happen
	// before the first await or the browser blocks it.
	function submitPageToHN({ title, url, text }) {
		const nonce = bridgeNonce();
		const session = openSubmitBridgePopup(nonce);

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

				const hash = new URLSearchParams();

				hash.set("hnewhere-submit", "1");
				hash.set("nonce", nonce);
				hash.set("origin", location.origin);

				session.navigate(submitURL(url, title) + "#" + hash.toString());

				return await session.result;
			} finally {
				await clearBridgePayload(nonce);
			}
		})();
	}

	// Deferred to a Save, where the settings panel applies immediately. Picking
	// sources is a commitment -- it decides which servers get told what the reader
	// is reading -- and a checkbox that acts the instant it is touched is the wrong
	// shape for that. Everything in the settings panel is reversible; this is a
	// consent step, and it should feel like one.
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

		list.addEventListener("change", syncSave);
		syncSave();

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

		let popover = null;

		// The popover lives outside the button, so destroying the button -- which
		// happens the moment a sidebar opens -- would otherwise leave it orphaned on
		// the page with nothing to anchor to.
		const baseCleanup = button._cleanup;

		button._cleanup = () => {
			popover?.close();
			popover = null;
			baseCleanup?.();
		};

		button.onclick = () => {
			if (button._dragController.wasMoved()) return;

			if (popover) {
				popover.close();
				popover = null;
				return;
			}

			popover = createSubmitPopover(
				button,
				async (fields, ui) => {
					const result = await submitPageToHN(fields);

					if (!result?.ok) {
						ui.setStatus(submitFailureMessage(result), { error: true });
						return;
					}

					await animateButtonFill(button);

					// The story id is not always recoverable -- see the /newest branch in
					// reportSubmitResultAfterReload -- so the confirmation degrades to a
					// plain success rather than linking somewhere that may not be right.
					if (result.storyID) {
						ui.setStatus(
							`Submitted. <a href="${escapeHTML(commentURL(result.storyID))}" target="_blank" rel="noopener noreferrer">View</a> &middot; <a href="${escapeHTML(editURL(result.storyID))}" target="_blank" rel="noopener noreferrer">Edit title</a>`,
							{ html: true },
						);

						rebindSubmittedButton(button, result.storyID);
					} else {
						// No id came back -- either /newest could not be matched, or this
						// was a text-only submission with no URL to match on. Point at
						// /newest rather than claiming something about this page.
						ui.setStatus(
							`Submitted. <a href="${escapeHTML(HN_ORIGIN)}/newest" target="_blank" rel="noopener noreferrer">See it on HN</a>`,
							{ html: true },
						);
						setFloatingButtonVariant(button, "active");
					}
				},
				() => {
					popover = null;
				},
			);
		};

		return button;
	}

	function submitFailureMessage(result) {
		switch (result?.reason) {
			case "popup-blocked":
				return "Your browser blocked the popup. Allow popups for this site and try again.";
			case "timeout":
				return "Hacker News did not respond in time. Check the popup window.";
			case "not-logged-in":
				return "Log in to Hacker News in the popup, then try again.";
			case "dupe":
				return "Hacker News already has this URL. Reload the page to see the discussion.";
			case "no-form":
				return "Could not find the submission form on Hacker News.";
			default:
				return result?.message || "Submission did not go through.";
		}
	}

	// Turns the grey submit button into an ordinary discussion button, so the click
	// after a submission opens the thread instead of offering to submit again.
	function rebindSubmittedButton(button, storyID) {
		setFloatingButtonVariant(button, "active");

		const stories = [{ objectID: String(storyID) }];

		button.onclick = () => {
			if (button._dragController?.wasMoved()) return;

			destroyFloatingButton(button);
			openSidebar(stories).catch(console.error);
		};
	}

	// -------------------------
	// Shared chrome
	// -------------------------

	// Palette for both themes. Defined on :host rather than on #panel -- which is
	// where #21 put it -- because the submit popover is a separate shadow root with
	// no #panel in it, and custom properties set on a host element inherit into its
	// shadow tree. One definition therefore reaches every surface.
	//
	// Light values are the originals; the dark set comes from #21, extended for the
	// composer, popover and status surfaces added in 1.5.3.
	const THEME_CSS = `
:host {
	--bg:#f6f6ef;
	--text:#000;
	--header-bg:var(--accent);
	/* White, not black. Black carried itself on orange and does not on indigo --
		the accent is a good deal darker than the colour it replaced. */
	--header-text:#fff;
	/* The relationship inverts with the title: a dimmed lavender on the header's
		own indigo, clearly subordinate to the white title. The peak is the
		travelling highlight. */
	--subtitle-stage:#c6c6ef;
	--subtitle-stage-peak:#ffffff;
	--border:#ccc;
	--border-soft:#ddd;
	--link:#0000aa;
	--meta:#828282;
	--muted:#666;
	/* Backchannel's accent. Deliberately not Hacker News orange and not Reddit's
		orange-red: the panel now speaks for several sources and must not wear any
		one of their colours. One token, so changing the brand is one line. */
	--accent:#5b5bd6;
	--accent-rgb:91,91,214;
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
	/* Deliberately not var(--accent): the dark accent is lifted so it reads as a
		foreground, which makes it far too bright behind a header. This is the
		dimmed counterpart, the way #cc5200 was the dimmed counterpart of the old
		orange. */
	--header-bg:#3f3f9e;
	--header-text:#f0f0ff;
	/* Dimmer to hold the same relationship against the dimmer header. */
	--subtitle-stage:#9a9ad4;
	--subtitle-stage-peak:#e6e6ff;
	--border:#3d3d3d;
	--border-soft:#383838;
	--link:#8ab4f8;
	--meta:#9a9a9a;
	--muted:#a3a3a3;
	/* Lifted a little for dark backgrounds, where the light value reads muddy. */
	--accent:#8b8bf0;
	--accent-rgb:139,139,240;
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

	// The header and settings dropdown are used by both the sidebar and the submit
	// popover, which live in separate shadow roots and so cannot share a stylesheet
	// by cascade. Kept as one string rather than copied into each, so the two can
	// never drift apart.
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
}

/* Scoped to the action row rather than to every button in the header. It
   describes a 36px icon box -- fixed square, centred glyph, 20px -- which is
   right for the three controls on the right and wrong for anything else. The
   wordmark on the left is a button too, and while this was written as
   "header button" the rule sized it to 36 square and left its text hanging
   outside the box. */
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

/* Touch devices latch :hover on after a tap and hold it until something else is
   tapped, so the settings and minimize buttons stayed highlighted. Only apply it
   where a real pointer can hover. */
@media (hover: hover) {
	.header-actions button:hover {
		background:var(--hover-tint);
	}
}

.header-actions {
	display:flex;
	align-items:center;
	gap:0;
}

/* The wordmark is the way back, so it has to look like the wordmark and behave
   like a control. Button chrome is removed rather than restyled -- what belongs
   in the header is the title, and the only thing that should say "pressable" is
   what happens under the pointer. */
.header-wordmark {
    /* .header-title is a flex column, so a button placed in it is stretched to
       the header's full width and stops reading as a word. Hugging its content
       is what keeps it a word. */
	align-self:flex-start;
	display:flex;
	align-items:baseline;
	border:0;
	padding:0;
	margin:0;
	background:none;
	color:inherit;
	font:inherit;
	cursor:pointer;
	text-align:left;
}

/* The trail into Hacker News, built the way the settings panel builds its trail
   into hidden sites, because it is the same movement: a level opening inside the
   panel, with the way back left in place behind it.

   Collapsed to zero width rather than hidden, so arriving slides the chevron open
   and pushes the trail across instead of snapping it into place. */
.wordmark-chevron {
	flex:0 0 auto;
	width:0;
	margin-right:0;
	overflow:hidden;
	opacity:0;
	color:var(--subtitle-stage);
	transition:width .2s ease, margin-right .2s ease, opacity .2s ease;
}

#panel.browsing .wordmark-chevron {
	width:9px;
	margin-right:5px;
	opacity:1;
}

/* Emphasis comes off the wordmark once it stops being the title and becomes the
   way back, as the settings crumb's root does. Colour only, not weight: the
   settings crumb is the only thing moving in its row, where this one has a
   chevron and a trail carrying the change, and lightening part of a bold header
   title reads as a rendering fault rather than as a de-emphasis. Dark orange
   rather than the panel's grey, because this sits on the header's own bar. */
.wordmark-root {
	transition:color .2s ease;
}

#panel.browsing .wordmark-root {
	color:var(--subtitle-stage);
}

/* On Hacker News the trail has nothing behind it, so the wordmark is a label
   rather than a control: no chevron, and none of the treatment a disabled button
   would otherwise pick up. It is not unavailable, it simply does not lead
   anywhere from here. */
#panel.queue-only .wordmark-chevron {
	display:none;
}

#panel.queue-only .header-wordmark {
	cursor:default;
	opacity:1;
}

/* The one thing saying the title is pressable. A wordmark that is also a control
   has nothing else to announce it -- there is no border, no background, and on a
   touch screen no hover to discover -- so the ellipsis stands in for all of that
   and says there is more behind it.

   It goes when the trail arrives: by then the chevron is doing the same job in
   the other direction, and "HNewhere ⋯ / Read more" would be two affordances for
   one control. Collapsed the same way the chevron is, so the swap is a movement
   rather than a flicker. */
.wordmark-more {
	flex:0 0 auto;
	width:auto;
	margin-left:4px;
	overflow:hidden;
	color:var(--subtitle-stage);
	transition:width .2s ease, margin-left .2s ease, opacity .2s ease;
}

#panel.browsing .wordmark-more {
	width:0;
	margin-left:0;
	opacity:0;
}

/* Always in flow, faded and nudged rather than display:none, so it can animate in
   both directions. Laying it out while invisible costs nothing here for the same
   reason it costs nothing in the settings head: the title is left-aligned, so a
   trail nobody can see shifts nothing. */
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
}

#panel.browsing .wordmark-tail {
	opacity:1;
	transform:none;
	pointer-events:auto;
}

.wordmark-sep {
	font-weight:400;
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

/* Hidden rather than emptied. The discussion subtree is what renderedComments,
   the annotation controller and any open filter all point into, so tearing it
   down to make room would invalidate every one of them and cost a full
   re-render, re-annotate and vote re-hydration on the way back.

   One state class, on the panel rather than on #comments, because it has to
   reach the header too -- which is what lets the wordmark swap labels by CSS
   instead of by rewriting its markup on every toggle. */
.browse-view {
	display:none;
    /* Where .browse-main begins: the rank column's 22px plus the row's 6px gap.
       Named because four things line up on it -- the tabs, the More link, the
       empty state and the rows themselves -- and a number repeated four times is
       a number three of them will eventually disagree about. */
	--browse-indent:28px;
}

/* Both views fade, all the way out, where a filter change fades only the list to
   12% and leaves the frame alone. The distinction is what is actually changing:
   filtering is an edit to the list under a header that stays put, and swapping
   views replaces everything below the header at once. Fading only part of that
   would leave whichever part stayed put looking like it belonged to both. */
#comments-content,
.browse-view {
	transition:opacity .16s ease;
}

#comments.views-swapping > #comments-content,
#comments.views-swapping > .browse-view,
#comments.views-swapping > .filter-banner {
	opacity:0;
}

/* Two tabs set as a meta row rather than as a control: the same 11px Verdana the
   filter banner and the story lines use, so the front page reads as part of the
   panel rather than as a widget dropped into it. */
/* Starts exactly where every title beneath it does. */
.browse-tabs {
	display:flex;
	align-items:baseline;
	margin:0 0 10px var(--browse-indent);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
}

/* The bar hangs off the queue rather than sitting between the two as a sibling
   rule, so that hiding the queue takes the bar with it. As `+` it would stay
   attached to whichever tab came second and leave a leading bar in front of
   Front page on its own. */
#browse-tab-queue::after {
	content:"|";
    /* HN's own ratio, measured off it: 3.28px each side of the bar at 9.33px
       type, which is .35em. Given in em rather than pixels so it holds at the
       11px these are set in. */
	margin:0 .35em;
	color:var(--meta);
}

/* Nothing queued, nothing to show. The queue keeps its place on the left for
   when there is -- it does not move, it arrives. */
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

/* The current one carries the panel's text colour, the way .filter-banner-title
   does against its own grey row. Weight is left alone -- at 11px a bold and a
   regular Verdana differ more in colour than in shape, and the colour is already
   saying it. */
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

/* Read entries stay in the list, dimmed. Which is the point: the queue has to be
   able to be wrong about what you finished, and something invisible cannot be
   corrected. */
.browse-row-read {
	opacity:.5;
}

/* A rank column wide enough for two digits and the stop after them, which is
   every row on a thirty-story page. */
/* HN's own rhythm, measured off news.ycombinator.com rather than guessed at: a
   story runs 35px from one title to the next -- a 19px title line, an 11px
   subtext line, and a 5px spacer between. Ours came to 65.5.

   Most of the difference was that .story-title and .story-meta are set for the
   header at the top of a discussion, where the story is the headline and the
   only one on screen. Thirty of them in a list is a different job, so the sizes
   are scoped down here and left alone there.

   Titles still wrap where HN's would not -- a 420px panel is not a 1200px page --
   so a wrapped row is taller than 35px. That is the panel's width, not its
   spacing. */
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

/* HN leaves about a pixel and a half between the title and the subtext under it,
   which reads as none at all. The 2px this normally carries is there to separate
   the header from a story's own text below it, and there is no text here. */
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

/* Deliberately no colour of its own. The label already says what pressing it
   will do, and every other link on these rows is meta grey -- darkening this one
   made it the loudest thing on a comment, which is not what having flagged
   something means. */

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

/* A control in a meta row, so it is set as one: the same text-link treatment
   .browse-nav-link and .filter-banner-close get, not a button that looks like a
   button. HN's own row actions are text links between pipes and this sits among
   them. */
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

/* Sits under the last comment, separated by a rule rather than by space alone:
   the thread has ended, and what follows is a different question. Indented to the
   same 14px the filter banner uses, so it lines up with the story above it rather
   than with the scroll container. */
.next-up {
	display:block;
	margin:18px -12px 24px;
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
	color:var(--meta);
}

/* The inset lives on the row rather than on the strip, so the band above it can
   run the full width without having to be pulled back out again. The 26px is the
   panel's own 12px plus the 14px every story and banner is indented by, so the
   text lines up with the thread above it. */
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

/* The 36px buttons already centre their glyphs, so the visual inset on the right
   is the 8px header padding plus roughly half the leftover button width. This
   mirrors that on the left rather than letting the title hug the edge. */
.header-title {
	display:flex;
	flex-direction:column;
	min-width:0;
	padding-left:12px;
}

/* Only the two-line case needs tightening, and the subtitle exists only in the
   sidebar -- the popover header has none. Default leading put most of a line's
   worth of air between the title and the status under it.

   Matched on :first-child rather than span:first-child so it holds whatever
   element carries the title: a span in the popover's header, a button in the
   sidebar's. Typed as a span it silently stopped applying the moment the
   wordmark became a control, and the air came back. */
.header-title:has(.header-subtitle) > :first-child {
	line-height:1.25;
}

/* Collapsed until it has something to say. Animating the height is what moves
   the title, so the status arriving reads as the header opening rather than as
   the whole panel jumping. */
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

/* Dark orange rather than the header's black, so a status reads as transient
   next to the permanent title. Applied whether or not motion is allowed, so the
   colour never depends on the animation. */
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
    /* Slightly more at the bottom than the top: the title's line-height adds its
       own leading up top, so a literal 10px all round reads as short underneath
       the last option. */
	padding:10px 10px 13px;
	z-index:3;
}

.settings-group + .settings-group {
	margin-top:10px;
	padding-top:10px;
	border-top:1px solid var(--surface-divider);
}

/* Every header icon is drawn, not typed. Flexbox centres a glyph's line box
   rather than its ink, so where a character lands depends on the font's ascent
   and descent -- the gear used to sit about a pixel low and the minus half a
   pixel high, while the drawn eye was exactly centred, which is what made the
   eye look like the odd one out. Paths centred on the same 16-unit viewBox are
   aligned by construction, on every platform.

   Drawing the gear also retires a workaround: U+2699 defaults to its emoji
   presentation on iOS, which needed a U+FE0E variation selector in the markup
   plus font-variant-emoji, and that only lands in Safari 17+. */
header button svg {
	display:block;
}

/* Held while the dropdown is open so the gear reads as a toggle rather than a
   button that fired once. Darker than the hover tint so the two stay distinct on
   a pointer device, and outside the hover media query so touch gets it too. */
#settings-toggle.is-open {
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

/* Drawn from the panel's own tokens rather than left to appearance:auto. Chrome
   paints a UA checkbox from its dark form palette -- a lighter fill and a pale
   border -- which never matched the segmented controls beside it, and hand-
   matching that value would only move the mismatch to Safari and Firefox.
   13px is the native width the .settings-option-hint indent is measured against,
   so it stays 13px including the border. */
.settings-option input[type="checkbox"] {
	appearance:none;
	-webkit-appearance:none;
	box-sizing:border-box;
	flex:0 0 auto;
	width:13px;
	height:13px;
    /* Centred on the first line of the label, which is what the row aligns to --
       align-items is flex-start so a wrapping option keeps its box beside the
       first line rather than beside the middle of the block. Derived rather than
       tuned: a flat 2px was right for the 12px rows and dropped the 11px
       sub-option boxes 2px below their text, because the shorter line box needs a
       smaller offset. 1.35 is .settings-option's line-height, and font-size:inherit
       is what makes em resolve against the label rather than the input's UA
       default. Nothing here has text, so inheriting a size costs nothing. */
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

/* Collapsed rather than merely disabled when the parent option is off: a dead
	checkbox reads as broken, where nothing reads as "not applicable yet". The
	max-height ceiling is generous because the real height is not knowable in CSS --
	it only has to exceed the content for the transition to run to completion. */
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

/* A sub-options group sits between two options in the auto-open block, which
	breaks the .settings-option + .settings-option adjacency the spacing rule
	relies on. Without this the option below would touch the one above whenever the
	group is collapsed to zero height. */
.settings-suboptions + .settings-option {
	margin-top:8px;
}

/* The same break, from the other thing that comes between two options: on the
	sources pane every source is a checkbox followed by a line describing it, so
	every pair after the first lost its spacing and each description ran straight
	into the next source's box. */
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
	padding:12px 14px 10px;
	border-bottom:1px solid var(--border-soft);
}

.page-header-title {
	font-size:13px;
	font-weight:600;
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

/* Nothing left to show: no title, no count, no strip. Kept in the tree because
	the filter banner mounts against it, but it must not draw a rule across the
	panel above a submission that is now the heading. */
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

/* No max-height here: it is set from the measured content when the strip opens,
	so a page posted to two places and one posted to twelve both slide for the full
	duration rather than snapping open against a ceiling. */
/* Not merely collapsed: with one discussion the strip has nothing to say, so it
   leaves the layout rather than sitting there as an empty row that could be
   opened. */
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

/* Reads like the meta links it sits beneath -- reply, focus -- rather than as a
   control, because it is an offer to see more of the same thing rather than an
   action on it. */
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

/* Provenance, at the weight of the age beside it. Deliberately not a badge: the
	reader is looking at one conversation, and where each turn of it happened is
	available rather than announced. */
/* No colour of its own: it inherits .meta, which is what the author and the age
   beside it use. It had --muted, a step darker, so the label and its separator
   read as a different kind of thing from the line they sit in. */
.comment-source::before {
	content:"·";
	margin-right:4px;
}

/* The picker is the first thing a new reader sees, so it borrows the settings
	panel's spacing and type scale rather than inventing a form of its own. It sits
	in the sidebar body, which is why it needs its own padding -- the settings panel
	gets that from its own container. */
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

/* Deliberately identical to .popover-actions and its primary button, restated
	rather than shared. The submit popover is its own host with its own shadow root,
	so a rule written there cannot reach in here -- only THEME_CSS crosses, which is
	why the tokens do and the rules do not. Same values, so the two screens read as
	one product; if you change one, change both. */
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
}

/* That hint describes what happens with the setting off. Switched on, it is
   explaining a state the reader is not in, directly above the sub-option that
   now applies -- so it goes. Written as a selector rather than wired in
   applySettingsPanelState so it tracks the checkbox itself, with no second
   place to keep in step. The hint is the last thing in its group, so the
   sibling combinator reaches nothing else. */
.settings-option:has(#setting-hide-without-discussion:checked) ~ .settings-option-hint {
	display:none;
}

.settings-option.sub-option + .settings-option-hint {
	margin-left:41px;
}

/* Shared: the settings panel's BETA pill needs this in the popover, and comment
   rendering needs it in the sidebar. */
.op-pill {
	display:inline-block;
	margin-left:4px;
	margin-right:4px;
	padding:1px 4px;
	border-radius:3px;
	background:var(--accent);
	color:white;
	font-size:9px;
	font-weight:bold;
	line-height:1.2;
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

/* Two panes side by side inside a clipped viewport. Height is set in JS from the
   active pane, because a flex row is always as tall as its tallest child and the
   hidden-sites pane is much shorter than the main one. */
.settings-panel {
	overflow-x:hidden;
    /* The popover no longer clips this, so the panel bounds itself against a
       short viewport rather than running off the bottom of the screen. */
	max-height:calc(100vh - 120px);
	overflow-y:auto;
}

/* The title and credits sit outside the sliding track, so both panes keep them.
   This replaces the .settings-group + .settings-group rule that used to draw the
   separator when credits was itself a group inside the stack. */
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

/* The track is two slots wide and translates by exactly half, so only one second
	level may be in the flex flow at a time. display:none takes the others out of
	it entirely rather than stacking them into a third slot the slide cannot reach. */
.settings-pane-secondary {
	display:none;
}

.settings-pane-secondary.is-active {
	display:block;
}

/* Small enough to sit in a dropdown, which is the constraint: four rows and a
	column per source is about what fits before it stops being glanceable. */
.source-matrix-caption {
	margin:14px 0 5px;
	color:var(--muted);
	font-size:11px;
}

.source-matrix {
	width:100%;
	border-collapse:collapse;
	font-size:11px;
}

.source-matrix th,
.source-matrix td {
	padding:3px 4px;
	text-align:center;
	font-weight:400;
}

.source-matrix thead th,
.source-matrix tbody th {
	color:var(--muted);
}

.source-matrix tbody th {
	text-align:left;
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

/* A breadcrumb rather than a bare title: the hidden-sites list is a second level
   of the same panel, so the trail is what says where you are and how to get back.
   Sits outside the sliding track, so it survives the transition. */
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

/* Always in flow, faded and nudged rather than display:none, so it can animate
   in both directions. Laying it out on the first level costs nothing: the head
   is left-aligned, so an invisible trail shifts nothing. */
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

/* Matches the native checkboxes above rather than the HN orange: orange is
   reserved for the product button, which the preview beside this renders in full.
   AccentColor is the same value the unstyled checkboxes resolve to; the literal
   is the fallback where it is unsupported. */
/* Always white, never AccentColorText: that keyword resolves to black against a
   light system accent, which left the selected label unreadable on the blue. The
   background follows the system accent; the label does not follow it back. */
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

/* Fixed at three digits' worth: the field accepts anything typed and clamps on
   commit, so it has to hold a number wider than the 64px ceiling without the
   row resizing as you type. */
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

/* A drafting surface: hairline graph grid, the button drawn as line art rather
   than filled, and a measured callout under it. The grid makes the size change
   legible as a measurement instead of just "bigger". */
.button-preview {
    /* Sized to clear the 64px maximum button plus its padding and border, and no
       wider -- the controls column is the constraint, and "Squircle" truncates
       before it. */
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

/* Filled rather than drawn as line art: the point of the preview is to show the
   button you will actually get, colour included. The grid behind it still does
   the measuring work. */
.button-preview-shape {
	display:flex;
	align-items:center;
	justify-content:center;
	border:0;
	/* It is a text field now as well as a preview, so it says so on hover and
	   focus -- an editable thing that looks exactly like an unedittable one is
	   only discoverable by accident. */
	cursor:text;
	caret-color:#fff;
	outline-offset:2px;
	background:var(--accent);
	box-shadow:0 1px 4px rgba(0,0,0,.25);
	color:#fff;
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

/* The rule sits on each box's bottom edge so the side ticks rise from it toward
   the object being measured. On border-top the box hung below the line and the
   ticks pointed away from it. */
.button-preview-rule::before,
.button-preview-rule::after {
	content:"";
	position:absolute;
	top:calc(50% - 5px);
	height:5px;
	width:calc(50% - 14px);
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
}

/* A text link at the foot of the controls column rather than a button under the
   whole row: it undoes the two controls directly above it, and reads as
   secondary to them. */
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
title="${escapeHTML(browseLabel())}"><span class="wordmark-chevron" aria-hidden="true">&lsaquo;</span><span
class="wordmark-root"><b>Back</b>channel</span><span class="wordmark-more" aria-hidden="true">&#8943;</span><span
class="wordmark-tail"><span class="wordmark-sep">/</span>Read more</span></button>`
		: `<span><b>Back</b>channel</span>`
}
${subtitle ? `<span id="header-subtitle" class="header-subtitle"></span>` : ""}
</span>

<div class="header-actions">
<button id="hide-site" aria-label="Hide Backchannel on this site" title="Hide Backchannel on this site">
<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
<path d="M1.4 8S3.9 3.9 8 3.9 14.6 8 14.6 8 12.1 12.1 8 12.1 1.4 8 1.4 8Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
<circle cx="8" cy="8" r="1.85" fill="none" stroke="currentColor" stroke-width="1.25"/>
<line x1="3.1" y1="12.9" x2="12.9" y2="3.1" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
</svg>
</button>
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
<div class="button-preview-rule"><span id="button-preview-dim" class="button-preview-dim">44</span></div>
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
<div class="source-matrix-caption">What each source supports</div>
<table class="source-matrix">
<thead><tr><th></th>${[...SOURCES.values()].map((source) => `<th>${escapeHTML(source.shortLabel || source.label)}</th>`).join("")}</tr></thead>
<tbody>
${["read", "vote", "reply", "submit"]
	.map(
		(row) => `<tr><th>${escapeHTML({ read: "Read", vote: "Vote", reply: "Reply", submit: "Submit" }[row])}</th>${[
			...SOURCES.values(),
		]
			.map((source) => {
				const yes = row === "read" ? true : Boolean(source.capabilities[row]);
				return `<td class="${yes ? "yes" : "no"}" aria-label="${yes ? "yes" : "no"}">${yes ? "&check;" : "&ndash;"}</td>`;
			})
			.join("")}</tr>`,
	)
	.join("")}
</tbody>
</table>
</div>

</div>

<div class="settings-credits">
<a href="${escapeHTML(REPO_URL)}" target="_blank" rel="noopener noreferrer">Backchannel${SCRIPT_VERSION ? " v" + escapeHTML(SCRIPT_VERSION) : ""}</a>
<a href="${escapeHTML(REPO_URL)}/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
</div>
</div>
`;
	}

	// Wires the dropdown inside whichever shadow root it was rendered into. Returns
	// setSettingsOpen so the host can close it on its own events -- minimizing the
	// sidebar, for instance.
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

		// Measured from the active pane because a flex row is always as tall as its
		// tallest child, which would leave the short hidden-sites pane in a box
		// sized for the main one.
		const syncPanesHeight = () => {
			// scrollHeight reads 0 under display:none, so measuring while the panel
			// is closed would pin the track to zero until the next open.
			if (!panes || settingsPanel.classList.contains("hidden")) {
				return;
			}

			// `.is-active`, not just `.settings-pane-secondary`. While hidden sites
			// was the only second level the two selectors picked the same element;
			// with more than one they do not, and this took the first in document
			// order -- the empty blocked list -- and pinned the track to its height.
			// The pane the reader is looking at was fully rendered and 314px tall
			// inside a box measured at 0.
			const active = panes.querySelector(
				panes.classList.contains("is-secondary")
					? ".settings-pane-secondary.is-active"
					: ".settings-pane-primary",
			);

			if (active) {
				panes.style.height = `${active.scrollHeight}px`;
			}
		};

		// The track's height is fixed in JS, so anything that changes the active
		// pane's content has to resync it. Observing rather than calling
		// syncPanesHeight from each such place is deliberate: the annotation
		// sub-options collapse over a 0.22s max-height transition, so a call made
		// at toggle time measures the height they are leaving rather than the one
		// they are arriving at. The observer fires throughout the transition, and
		// covers any content added later without a new call site.
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

		// Takes a pane name, or null for the first level. It used to take a boolean,
		// which was enough while "hidden sites" was the only second level -- the
		// track is two slots wide, so exactly one secondary pane may occupy the
		// second at a time, and the rest are display:none and therefore out of the
		// flex flow entirely.
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

			if (previewDim) {
				previewDim.textContent = String(size);
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
			}

			for (const group of suboptionGroups) {
				const enabled = Boolean(settings[group.dataset.suboptionsOf]);

				group.classList.toggle("is-visible", enabled);

				// Still disabled as well as collapsed. max-height:0 hides them visually
				// but leaves them in the tab order, so keyboard focus could land on a
				// control nobody can see.
				for (const input of group.querySelectorAll("input")) {
					input.disabled = !enabled;
				}
			}
		};

		applySettingsPanelState(await loadSettings());

		// Single place the open state changes, so the button's pressed styling and
		// aria-expanded cannot drift out of sync with the panel.
		const setSettingsOpen = (open) => {
			settingsPanel.classList.toggle("hidden", !open);
			settingsToggle.classList.toggle("is-open", open);
			settingsToggle.setAttribute("aria-expanded", open ? "true" : "false");

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

		if (hideSiteButton) {
			hideSiteButton.onclick = (event) => {
				event.preventDefault();
				event.stopPropagation();
				hideCurrentSite().catch(console.error);
			};
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
				const current = await loadSettings();

				await saveSettings({
					sources: {
						...normalizeSourceSettings(current.sources, registeredSourceIds()),
						[sourceInput.dataset.source]: sourceInput.checked,
					},
				});

				// A source turned on mid-visit has never been looked up for this page,
				// and one turned off may be on screen. Re-running the whole decision is
				// cheaper to reason about than patching the sidebar in place.
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
			// Committed on blur and on Enter rather than per keystroke: one character
			// is a valid mark, so saving as you type would apply "B" on the way to
			// "BC" and repaint every button twice.
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

				// contenteditable has no maxlength. Typing past the limit is stopped
				// here rather than trimmed afterwards, so the field never shows a
				// character that will not survive.
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
				// normalizeButtonSize clamps out-of-range values to the ends of the
				// range, so 5 becomes 24 and 999 becomes 64. Anything unparseable
				// falls back to the stored value rather than the default.
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
				// Shape and size only. A button reset should not silently change the
				// user's theme choice.
				const settings = await saveSettings({
					buttonShape: DEFAULT_SETTINGS.buttonShape,
					buttonSize: DEFAULT_SETTINGS.buttonSize,
				});

				applySettingsPanelState(settings);
				await refreshButtonAppearance();
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

				row.className = "settings-blocked-entry";
				name.textContent = host;

				remove.type = "button";
				remove.className = "settings-blocked-remove";
				remove.textContent = "×";
				remove.setAttribute("aria-label", `Stop hiding Backchannel on ${host}`);
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
    /* Shadow DOM encapsulates selectors, not inheritance. Every inherited property
       flows in from the host unless the shadow tree sets its own, so a page that
       centres its body -- victoriametrics.com does -- centres the entire panel,
       comments and all. The same hole is open for everything else that moves text
       about, and each one is a bug report waiting for the site that trips it.

       Pinned on #panel rather than on :host, because a rule in the page that
       happens to match the host element outranks a :host rule from inside. Nothing
       in the page can reach this one.

       line-height and direction are deliberately absent. The panel has never set a
       line-height and the components that care carry their own, so pinning one now
       would restyle every site rather than fix one; and direction says something
       real about a reader's language, which is not ours to overrule. */
	text-align:left;
	text-indent:0;
	text-transform:none;
	letter-spacing:normal;
	word-spacing:normal;
	font-style:normal;
	font-variant:normal;
	white-space:normal;
    /* Reading width for a single block of prose. Never applied to a container: a
       cap on any ancestor of .children narrows every reply nested under it. */
	--measure:1215px;
}


${THEME_CSS}
${CHROME_CSS}

/* Sidebar-only, so deliberately not part of CHROME_CSS: the submit popover has no
   resize handle. #panel is position:fixed, which is already a containing block. */
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

/* A hatched band rather than a rule, in the two places where the panel changes
   subject instead of merely continuing: from one submission of this article to
   the next, and from the end of a thread to what to read after it. A hairline
   says "and"; this says "different thing now".

   Ruled top and bottom in the same colour the strokes are drawn in, so the band
   is a closed thing rather than hatching that fades out at the edges. The
   strokes repeat on a 6px square, which is what keeps them at 45 degrees however
   tall the band is -- a tile stretched to fit would shear them.

   Full bleed. #comments insets its contents by 12px, and a divider stopping
   short of the panel edge reads as part of the column rather than as a break
   across it, which is the one thing it is for. */
.next-up::before,
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

#comments {
			flex:1 1 auto;
			min-height:0;
	overflow:auto;
	overflow-x:hidden;
			overscroll-behavior:contain;
	/* The bottom is deliberately far larger than the top. The panel is fixed to
		the full viewport height, so a page with a horizontal scrollbar puts that
		scrollbar over the foot of the list -- and 8px was not enough to scroll the
		last comment clear of it, which read as the thread being cut off. It also
		gives a long thread somewhere to end: a list that stops flush against the
		edge looks truncated even when it is complete. */
	padding:12px 12px 32px;
	word-wrap:break-word;
}

/* Only the comment lists fade. Filtering to a discussion changes which comments
   are shown; the story header, the composer and the focused-discussion banner
   are the frame around that change, so fading them made the whole sidebar blink
   for what is really an edit to the list underneath. */
.top-level-comments {
	opacity:1;
	transition:opacity .18s ease;
	will-change:opacity;
}

.comments-transitioning .top-level-comments {
	opacity:.12;
}

/* The 14px indent is the width of the story's vote-arrow column
   (.story-votelinks), which is what sets the left edge of the title, the
   composer and every submission. Matching it lines the banner up with them
   instead of with the scroll container. */
.filter-banner {
	max-width:720px;
	margin:12px 0 16px 14px;
	color:var(--meta);
}

/* Reads as an HN meta line: same 11px Verdana and the same pipe separators as
   "deergomoo 11 hours ago | reply". Adopting the idiom already in use is what
   lets the header drop its uppercase treatment without losing its rank. */
.filter-banner-head {
	display:flex;
	flex-wrap:wrap;
	align-items:baseline;
	color:var(--meta);
	font-family:Verdana, Geneva, sans-serif;
	font-size:11px;
}

/* The one piece of contrast in the row, echoing how the story title sits above
   its own grey meta line. Without it every word carries equal weight and the
   label stops reading as a label. */
.filter-banner-title {
	color:var(--text);
}

.filter-banner-close::before {
	content:"|";
	margin:0 5px;
}

/* Same chrome as .composer-help, at the panel's own 13px so the quote reads at
   the size of the comments it was pulled from. Paired ornaments open and close
   it, which is what separates a focused quote from the comment quotes below --
   those carry the opening mark alone. */
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

/* Set above the text size: at 13px the ornament reads as a speck rather than a
   quote mark. The nudge drops it off the cap height onto the x-height, where a
   raised comma sits in type. */
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

/* A comment focus has no quotation to mark. The ornaments say "these are somebody
   else's words lifted from the article", which is exactly what this variant is
   not -- it is the comment itself, named by its author. The box stays, because
   what it separates from the thread below is unchanged. */
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

/* Indent is deliberately small. Every level costs horizontal space the comment
   text needs, and the border-left already marks the nesting, so the margin only
   has to separate the border from the parent's text rather than carry the
   hierarchy on its own. */
/* Vertical spacing is on the top edge only, never the bottom. .comment-layout is a
   flex container, and margins of flex items do not collapse through it -- so a
   bottom margin on a nested comment stays trapped inside its parent instead of
   collapsing with it, and every level of nesting added another 12px under the
   deepest reply. A top-only margin cannot accumulate: it still separates siblings,
   and still separates the first reply from its parent's text. */
.comment {
	margin:12px 0 0 8px;
	max-width:100%;
	overflow-wrap:anywhere;
}

.top-level-comments > .comment {
	margin-left:0;
}

/* margin-left:0 so the guide lands on the parent's first letter rather than 8px
	past it. .children sits inside .comment-main, which already starts after the
	vote slot, so zeroing the margin puts the rule exactly under where the parent's
	text begins -- which is what makes a column of them read as one hierarchy
	instead of a slight stagger. */
.children > .comment {
	margin-left:0;
	border-left:1px solid var(--border-soft);
	padding-left:6px;
}

/* 2px border + 5px padding lines this up with the 1px + 6px of an ordinary
   child, so gaining or losing the "new" accent never shifts the text. */
.comment.new-comment {
			border-left:2px solid rgba(var(--accent-rgb),.95);
			padding-left:5px;
			transition:border-left-color .9s ease;
}

/* A top-level comment has no divider under the accent, so it does fade to nothing. */
.comment.new-comment.comment-new-seen {
	border-left-color:transparent;
}

/* A child does have one. Fading the accent all the way out erased the nesting line
   with it, so it settles on the divider colour instead of disappearing. */
.children > .comment.new-comment.comment-new-seen {
	border-left-color:var(--border-soft);
}

.comment.comment-target {
	background:rgba(var(--accent-rgb),.10);
	border-radius:6px;
}

.comment.comment-filter-hidden {
	display:none !important;
}

.submission.submission-filter-hidden {
	display:none !important;
}

/* Stated rather than left to cursor:auto. The panel used to write an inline
   cursor:default on itself while hit-testing for the resize edge, and because
   cursor inherits, that suppressed the I-beam over every comment. The inline
   write is gone, but saying it here means no future ancestor rule can take the
   I-beam away again without being noticed. */
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

/* A comment's first and last element must not decide how far the comment sits from
   its neighbours, which is what happened while their margins were left to escape.
   .comment-layout is a flex row, so nothing collapses out through it: the margin
   stayed inside the comment and added to the 12px every comment already has,
   putting a multi-paragraph comment 20px from the next one, a comment ending in a
   quote 18px, and a single-paragraph one -- which is a bare text node, since HN
   does not wrap an opening paragraph -- at 12px. The same happened above, where
   what a comment opened with set its distance from its own byline.

   Bare text is untouched by this and needs to be: an anonymous block has no margins
   to zero, which is why it was the odd one out to begin with. */
.text > *:first-child,
.story-text > *:first-child {
	margin-top:0;
}

.text > *:last-child,
.story-text > *:last-child {
	margin-bottom:0;
}

/* A <pre> defaults to white-space:pre, which does not wrap at any width, so a code
   block or an indented quote ran straight out of the panel and took the comment's
   own edge with it. overflow-wrap is inherited from .comment and only bites once
   wrapping is allowed at all, which is what pre-wrap turns on -- and pre-wrap keeps
   the indentation and line breaks that made the author reach for a code block.

   overflow-x is the backstop for the case that still cannot break, an unbroken
   200-character token being the usual one: it scrolls inside its own block rather
   than widening everything around it. */
.text pre,
.story-text pre {
	white-space:pre-wrap;
	overflow-x:auto;
	max-width:100%;
}

/* Browser defaults are 1em, which is 13px here and sits oddly beside the 8px every
   other break in a comment uses. Lists also default to 40px of indent, most of a
   nested reply's remaining width, where enough to hang a bullet on will do. */
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

/* HN ships no quote syntax, so foldQuoteBlocks turns runs of marked lines into
   real blockquotes. A left rule would read as thread hierarchy -- .children >
   .comment already uses one for exactly that -- so the quote is marked by an
   ornament in the gutter and italics instead, which cannot be confused with
   nesting when scanning a deep thread.
   No backticks in here - this whole stylesheet is inside a template literal. */
/* Same 8px as a paragraph. At 6px a quote sat closer to its neighbour than two
   paragraphs did, which only showed between two stacked quotes -- everywhere else
   collapsing against a paragraph's 8px hid it. One gap for every break in the
   prose, whatever is on either side of it. */
.text blockquote,
.text p.comment-quote-promoted {
	position:relative;
	margin:8px 0;
	padding-left:15px;
	color:var(--quote-text);
	font-style:italic;
}

/* The ornaments are written as literal characters, not CSS codepoint escapes.
   This stylesheet is a template literal, and JS reads a backslash followed by a
   digit as an octal escape, which is a syntax error in template strings. */
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

/* The ornament stays neutral whether or not the quote is linked. The orange
   underline on the anchored text is already the loud signal; colouring the mark
   too gave the same information twice, and left the difference unreadable
   without comparing two quotes side by side. */

/* A block that already reads as a quote -- indented, italic, ornamented -- does not
   also need its words underlined; that says the same thing twice, and the underline
   is the mark for a quote sitting inside a sentence, where nothing else could show
   it. Applies to both forms, so a marker-folded quote and a paragraph promoted on a
   match look alike.
   No backticks in here - this whole stylesheet is inside a template literal. */
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

/* Inside a focused discussion the banner is already showing this sentence, so
   marking it again in the comment says the same thing twice -- and the mark invites
   a click through to the view the reader is already in. The words themselves stay
   at full strength: they are the comment's own prose, not an ornament, and fading
   them would make the comment harder to read to solve a problem it does not have.
   The blockquote form collapses instead, below, because there the quote is a
   standalone block rather than part of a sentence. */
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

/* The story ran on the browser's default paragraph margin -- 13px against the
   comments' 8px -- so prose in the panel had two rhythms depending on whether it
   was the submission or a reply to it. The edges are handled by the shared
   first-child/last-child rules above, which is what the old p:last-child rule here
   was reaching for. */
.story-text p {
	margin:8px 0;
}

.story-text a {
	color:var(--link);
}

/* The cap lives on the wrapper rather than the textarea so the actions row below
   inherits the same width, which is what lets the formatting link sit flush with
   the textarea's right edge instead of the panel's. */
.comment-composer {
	margin-top:10px;
	max-width:720px;
}

/* Reply boxes are collapsed until their comment's "reply" link is used. Same
   max-height technique as the settings sub-options: the real height is unknowable
   in CSS, so the ceiling only has to clear the content for the transition to
   finish. Generous because the formatting pane can be open inside it. */
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

/* Deliberately monospace-free and plain. HN treats two leading spaces as a code
   block, so a proportional font that hides whitespace would make the one piece of
   formatting that depends on exact spacing impossible to see. */
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

/* Reads as a text link, so it follows the same rule as .meta a: no underline until
   hover. Being a toggle, it also keeps the underline while the pane is open, which
   is the one place it differs from a plain link. */
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

/* Sits between the button and the formatting link, taking up the slack so the link
   stays flush right. When it is hidden the row's space-between keeps the link there
   anyway, so the layout does not shift as messages come and go. Long errors wrap
   rather than truncate -- the row grows, which is preferable to hiding half of why
   something failed. */
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
<button id="browse-tab-queue" class="browse-tab" type="button" role="tab" hidden>queue</button>
<button id="browse-tab-front" class="browse-tab is-current" type="button" role="tab">front page</button>
</div>
<div id="browse-list"></div>
</div>
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

		// #resize-handle is an 8px strip pinned to the panel's left edge, already used
		// by the touch handlers below and already carrying cursor:col-resize in CSS.
		// Hanging the mouse drag off it too removes the hit-test entirely.
		//
		// It previously lived on the panel and tested e.offsetX < 8, which is measured
		// from the *event target's* padding box rather than the panel's -- so hovering
		// near the left edge of any nested child (a .comment at its indent, a .children
		// wrapper) reported a small offsetX and armed a resize nowhere near the edge.
		// The paired mousemove also wrote an inline cursor:default on the panel, and
		// since cursor inherits, that was what suppressed the I-beam over comment text.
		// Letting CSS own every cursor fixes both.
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

			// A panel opened only to browse leaves the page exactly as it found it: a
			// grey button offering to submit, and no recorded preference. Recording
			// "collapsed" would be a preference about a discussion that does not
			// exist, and it would suppress automatic opening once one does.
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

		// Named and wired here rather than alongside the other header buttons: this
		// is the one control that needs the ui object, and the object is not built
		// until the panel is finished.
		const browseToggle = shadow.querySelector("#browse-toggle");

		if (browseToggle) {
			browseToggle.onclick = () => {
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

		refreshQueueCount(shadow).catch(console.error);
		refreshNextUp(shadow).catch(console.error);

		// Delegated rather than wired per row: a thread renders hundreds of comments
		// and each one carries two of these, so binding them individually would be
		// hundreds of listeners for controls most readers never touch.
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
		// The discussion supplies its own permalink rather than having an HN URL
		// assembled from its id, so this stops pointing at HN for a discussion that
		// is not on HN. Falls back for the front-page rows, which arrive as parsed
		// HN markup rather than through an adapter.
		const hnURL = story.permalink || commentURL(story.id);

		// Read through the normalized names first, falling back to the raw Firebase
		// ones. renderStory has two callers with different shapes: a discussion from
		// an adapter, and a front-page row parsed straight out of HN's markup, which
		// never passes through a mapper.
		// Flag and favourite are Hacker News features. A source without them must
		// not be given links that would act on an item id Hacker News never issued.
		const showActions = options.actions !== false;
		// The title row is dropped when it would only repeat the page header above
		// it. It carries the only way out to the discussion though, so that link
		// moves to the meta row rather than disappearing with it.
		const showTitle = options.showTitle !== false;
		const storyAuthor = story.author ?? story.by;
		const storyCreatedAt = story.createdAt ?? story.time;
		const storyCommentCount = story.commentCount ?? story.descendants ?? 0;
		const storyBodyHTML = story.bodyHTML ?? story.text;

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
	${
		showTitle
			? `<div class="story-title">
	<a target="_blank" rel="noopener noreferrer"
	href="${escapeHTML(hnURL)}"
	title="Open this discussion where it lives">
	${escapeHTML(story.title)}
	</a>
	</div>`
			: ""
	}
	</td>
	</tr>
	<tr>
	<td class="story-votespacer"></td>
	<td class="story-body-cell">
	<div class="story-meta">
	<span class="story-score" data-story-score-id="${escapeHTML(storyID)}" data-story-score="${escapeHTML(String(story.score || 0))}">${story.score || 0}</span> points by
	${storyAuthor ? authorLinkHTML(story.source, storyAuthor) : ""}
	<span class="item-age" data-age-id="${escapeHTML(storyID)}">${timeAgo(storyCreatedAt)}</span><span class="story-vote-status" data-vote-status-id="${escapeHTML(storyID)}"></span>
	${showActions ? itemActionLinksHTML(storyID) : ""}
	${
		showTitle
			? ""
			: `| <a class="story-open-link" target="_blank" rel="noopener noreferrer"
	href="${escapeHTML(hnURL)}">open on ${escapeHTML(sourceShortLabel(story))}</a>`
	}
	|
	${storyCommentCount} comments
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
	${composerHTML({ label: "add comment", placeholder: "Add a comment…" })}
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

	// One markup for the story-level box and every reply box. The only differences are
	// the button label and the placeholder, so a reply gets the same formatting help,
	// spinner and draft handling for free.
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
	function wireComposer(composer, { storyID, parentId = null, onPosted } = {}) {
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

		// Deliberately synchronous and never awaited. The fade is a CSS transition
		// driven by a class, not a promise -- awaiting it before opening the bridge
		// popup would break the user-activation chain that window.open depends on.
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
			// Not trimmed. HN reads two leading spaces as a code block, so trimming
			// would silently change what the reader wrote. Only the emptiness check
			// ignores whitespace.
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
				const result = await submitCommentToHN(storyID, text, parentId);

				if (!result?.ok) {
					setStatus(commentFailureMessage(result), { error: true });
					return;
				}

				textarea.value = "";
				clearTimeout(saveTimer);
				await save(draftKey, null);

				setStatus("Posted");

				// Reloaded automatically, but only after a beat: HN's API lags behind a
				// fresh comment, so refetching the instant the popup reports back tends
				// to return the thread without it. The delay is not a guarantee -- if the
				// comment is still missing it will appear on the next open.
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

	// Deliberately NOT async: the popup has to be opened while the click is still on
	// the stack. Everything that needs awaiting happens inside the returned promise,
	// after the window already exists.
	function submitCommentToHN(storyID, text, parentId = null) {
		const nonce = bridgeNonce();
		const session = openCommentBridgePopup(nonce);

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

				const hash = new URLSearchParams();

				hash.set("hnewhere-comment", "1");
				hash.set("nonce", nonce);
				hash.set("story", String(storyID));
				hash.set("origin", location.origin);

				// /reply carries its own goto back to the item page, so both paths land
				// somewhere reportCommentResultAfterReload can read the result from.
				const target = parentId
					? replyURL({ id: parentId }, storyID)
					: commentURL(storyID);

				session.navigate(target + "#" + hash.toString());

				return await session.result;
			} finally {
				await clearBridgePayload(nonce);
			}
		})();
	}

	function commentFailureMessage(result) {
		switch (result?.reason) {
			case "popup-blocked":
				return "Your browser blocked the popup. Allow popups for this site and try again.";
			case "timeout":
				return "Hacker News did not respond in time. Check the popup window — your draft is saved.";
			case "not-logged-in":
				return "Log in to Hacker News in the popup, then submit again.";
			case "rate-limited":
				return "Hacker News is rate limiting comments. Wait a moment and try again.";
			case "no-form":
				return "Could not find the comment box on Hacker News. The thread may be locked.";
			case "unconfirmed":
				return "Submitted, but Hacker News did not show the comment back. Check the thread before reposting.";
			default:
				return result?.message || "Comment did not go through — your draft is saved.";
		}
	}

	// Reuses the ordinary open path rather than patching a comment into the DOM, so
	// the reloaded thread is whatever HN actually holds.
	//
	// Clears the whole item cache rather than just the story's entry: the new comment
	// changes the story's kids list, and every ancestor of a reply holds its own
	// cached kids too, so there is no cheaper key set that is actually correct.
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

	// The accent comes off a comment the reader has attended to, which on a pointer
	// device is the one they put the pointer on. A finger has no equivalent: a touch
	// lands on whichever comment happens to be under it while scrolling, so the one
	// that loses its accent is arbitrary and the rest keep theirs however far past
	// them the reader has gone.
	//
	// Scrolling clear of a comment is the touch equivalent of having attended to it.
	let newCommentScrollObserver = null;

	// Set while the panel is scrolling itself: returning to a reading position,
	// jumping to the focus banner, or reflowing the list around a filter. Every one
	// of those sweeps comments past the top of the panel without the reader having
	// read anything, and would otherwise clear every accent it passed.
	let suppressNewCommentAutoClearUntil = 0;

	// Generous, and refreshed by each call: a smooth scroll runs a few hundred
	// milliseconds and a filter transition adds its own, so the window has to
	// outlast both rather than race them.
	function suppressNewCommentAutoClear(duration = 1200) {
		suppressNewCommentAutoClearUntil = Date.now() + duration;
	}

	// Only where there is no hover to do the job. On a pointer device the existing
	// pointerenter is both more precise and more deliberate, and scrolling past
	// something is a weaker claim to have read it.
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

						// A comment with no box is display:none -- filtered out of a
						// focused discussion, or inside a collapsed thread. Its rect
						// reads as all zeros, which would otherwise satisfy the test
						// below for any container not sitting at the top of the
						// viewport, and clear an accent nobody has been near.
						if (!entry.boundingClientRect.height) {
							continue;
						}

						// Past the top, not merely out of view. A comment below the
						// fold has not been read; one the reader has scrolled up and
						// over has.
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

			// The frame yield is what makes a thread appear in batches rather than in
			// one block. A source that returns whole trees resolves getComment
			// instantly, and without this it would paint everything at once.
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

	// Openers mapped to the closer that ends them. Single quotes are deliberately
	// absent: an apostrophe is the same character, so "'tis a fine day, isn't it'"
	// would read as a quotation and most possessives would flirt with it.
	const QUOTATION_PAIRS = { '"': '"', "“": "”", "«": "»" };

	// A paragraph that is nothing but one quotation. HN has no quote syntax, so
	// plenty of commenters reach for quotation marks rather than `>`, and the result
	// arrived styled like their own words -- the same problem `>` folding solves,
	// arriving by a different route.
	//
	// Wholly enclosed is the entire test, and it is what keeps ordinary quoting
	// inside a sentence alone: `I think "move fast" is a bad motto` has text outside
	// the marks, and `"A" and "B"` has a closer before the end.
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

	// Drop `count` characters from the front of `nodes` in document order, which
	// is where the marker sits. Walking text nodes rather than rewriting the
	// markup keeps any inline <a> or <i> in the quoted line intact.
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

			// Trailing first: dropping the front shifts nothing at the back, but both
			// walk the same text nodes and taking the end first keeps the two counts
			// independent of each other on a single-node line.
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

	// Hacker News has no quote syntax. Commenters mark a quotation by starting a
	// line with `>`, and HN renders that marker literally, so quoted text arrives
	// styled like the commenter's own words and split across sibling <p>s. Folding
	// each run of marked lines into one <blockquote> makes the quote a single
	// element, which is what lets it be styled, clicked and collapsed as a unit —
	// the block path in decorateSidebarMatches has always looked for exactly this.
	// Idempotent: folded lines no longer begin with a marker.
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

	// HN opens a comment's first paragraph without a <p> and never closes the ones
	// that follow, so the opening paragraph arrives as loose text rather than an
	// element -- and the same happens to the reply under a quote, which is the shape
	// "> quoted line" plus an answer produces. Loose text becomes an anonymous block,
	// which has no margins and cannot be addressed by a selector, so those paragraphs
	// sat at different distances from their neighbours than the wrapped ones and no
	// rule could reach them. Wrapping them makes every paragraph a real element, which
	// is what lets one margin apply to all of them.
	//
	// Runs, not nodes: a paragraph is often text, an <a>, and more text, and those are
	// one paragraph rather than three.
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

		// Two identifiers, deliberately. `comment.key` is identity -- the graph, the
		// focus filter, collapsed state -- and is source-qualified. `commentID` is
		// HN's own item number, which the vote, reply and age wiring put into HN
		// URLs and HN-shaped data attributes, and which a namespaced value would
		// turn into a 404.
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
		// Per thread, not per comment: a blended list where only some comments
		// reserve the gutter has a ragged left edge, and one where nobody can vote
		// has a dead column down the whole thing.
		const threadCanVote = renderedSourcesCanVote();

		div.innerHTML = `
      <div class="comment-layout">
      <span class="comment-vote-slot${threadCanVote ? "" : " comment-vote-slot-empty"}">
      <span class="comment-vote-controls vote-controls hidden"
      data-hn-vote-story-id="${escapeHTML(String(storyID))}"
      data-hn-vote-item-id="${escapeHTML(commentID)}"></span>
      </span>

      <div class="comment-main">
      <div class="meta">

      ${authorLinkHTML(comment.source, comment.author)}

		${comment.isOP ? `<span class="op-pill">OP</span>` : ""}

		${
				// Provenance at metadata weight, beside the author and the age, not as
				// a badge. Quiet, because the reader is meant to be reading one
				// conversation rather than two feeds stitched together -- but present,
				// because a comment from r/science and one from r/conspiracy are not
				// interchangeable, and removing it would make the sidebar feel coherent
				// by making it slightly dishonest.
				//
				// Roots only. Replies inherit it through the indent guides, and
				// repeating it on every nested comment would double the weight of the
				// metadata line to say what the parent already said.
				parentKey === null && discussion.label && sidebarSourceKeys.size > 1
					? `<span class="comment-source">${escapeHTML(discussion.label)}</span>`
					: ""
			}

		<span class="item-age" data-age-id="${escapeHTML(commentID)}">${timeAgo(comment.createdAt)}</span><span class="comment-vote-status" data-vote-status-id="${escapeHTML(commentID)}"></span>

		${
				// Reply, flag and favourite are things the reader can *do*, and only
				// where the source allows it. Reddit is read-only, so offering them
				// there is an offer that cannot be honoured -- and flag/favourite would
				// act on an item id Hacker News never issued.
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
		${capabilities.vote ? itemActionLinksHTML(commentID) : ""}

      <span class="toggle">
      [–]
      </span>

      </div>

      <div class="comment-content">
       	<div class="text">
        		${sanitizeHTML(comment.bodyHTML) || ""}
       	</div>
       	<div class="reply-composer collapsed">
       	${composerHTML({ label: "reply", placeholder: "Reply…" })}
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

		// After folding, so the quote detector still sees the raw line structure it
		// partitions on rather than paragraphs this put around it.
		foldQuoteBlocks(textElement);
		wrapLooseCommentText(textElement);

		// `id` and `parentId` keep their names and change what they hold: a
		// source-qualified key rather than a bare number. Everything downstream --
		// buildCommentGraph, the focus filter, the annotation groups -- compares
		// them for identity and never does arithmetic on them, so the rename would
		// have been churn across a dozen call sites and one test fixture to express
		// something the values already say.
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

		// Wired lazily. A thread can render hundreds of comments, and wiring every
		// reply box up front would mean hundreds of storage reads for drafts nobody
		// asked for.
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

	// A source that withholds part of a thread says so, and this is the button that
	// asks for the rest. Optional on both sides: a source with no gaps never sets
	// `more`, and one that cannot fill them offers no expandMore -- in either case
	// nothing is drawn, which is why Hacker News needed no changes for this.
	// Whether any source currently on screen can be voted on. Read off the enabled
	// sources rather than the rendered comments, so it is stable while a thread is
	// still painting.
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

			// Left standing, and say so. Reddit's budget is a hundred requests per ten
			// minutes and a long thread can exhaust it, which is a "try again shortly"
			// rather than a "there was nothing there".
			if (!ok) {
				button.disabled = false;
				button.textContent = label() + " — try again";
				return;
			}

			// Rendered before the button so the thread reads in order, and the button
			// stays beneath whatever it just produced.
			const holder = document.createElement("div");

			container.insertBefore(holder, button);

			// Direct children of the comment the gap sat under. Their own replies
			// arrived in the same batch and are already linked, so renderChildren
			// recurses into them without another request.
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

	async function renderDiscussions(stories, ui) {
		clearArticleAnnotations();
		clearCommentFilter({ animate: false });
		// The observer holds the elements about to be thrown away with the list.
		stopObservingNewComments();
		renderedComments = [];
		ui.body.innerHTML = "";
		// "submissions on HN" was true while HN was the only source. It stops being
		// true the moment a second one is enabled, and a header that miscounts where
		// a conversation happened is worse than one that just counts it. The proper
		// per-source breakdown is the source strip, which the blended thread brings.
		// Only when there is a number worth reading. "1 discussion" under the
		// wordmark is a count of something the page header directly beneath it
		// already names in full, and it put a third line of heading above a
		// conversation that had not started yet.
		setSidebarRestingSubtitle(
			ui,
			stories.length > 1 ? pluralize(stories.length, "discussion") : "",
		);

		const generation = sidebarGeneration;

		// Every thread first, because the merge needs each discussion's total before
		// it can place any one comment. They are independent reads, so they overlap
		// rather than queueing behind each other.
		const threads = await Promise.all(
			stories.map((story) => getSource(story.source).loadThread(story)),
		);

		if (generation !== sidebarGeneration) {
			return;
		}

		const headerElement = renderPageHeader(stories, threads, ui.body);

		mountFilterBanner(headerElement, ui);

		// Each discussion's own block -- its score, its author, and on Hacker News
		// its vote, flag, favourite and composer -- rendered once and revealed by
		// the strip. The page is the header; a submission is a thing inside it.
		//
		// Shown outright when there is only one, because then there is nothing to
		// disambiguate: its actions are the page's actions, and hiding the composer
		// behind a filter nobody needs would take away the way to reply.
		sidebarSourceKeys.clear();

		for (const story of stories) {
			sidebarSourceKeys.add(story.source);
		}

		const details = document.createElement("div");

		details.className = "submission-details";
		ui.body.appendChild(details);

		const pageTitle = stories[0]?.title || "";

		for (const story of stories) {
			const canVote = Boolean(getSource(story.source)?.capabilities.vote);
			// Shown only where it says something the page header does not. Two
			// submitters can title the same link differently, and that is worth
			// seeing; the usual case, where they match, was two identical headings
			// stacked on top of each other.
			const block = renderStory(story, details, {
				actions: canVote,
				// Always with one discussion: the page header has stood down, so this
				// title is the only one, and it belongs beside the arrow the way HN
				// sets it. With several the header names the page, so a submission
				// only repeats itself when its own title differs.
				showTitle: stories.length < 2 || story.title !== pageTitle,
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
			})),
		);

		// Batched exactly as renderChildren batches, for the same reason: the frame
		// yield is what makes a long thread appear in pieces rather than in one
		// block. What differs is that each root carries its own thread and
		// discussion, because the list they are merged into spans several.
		const batchSize = 5;

		for (let i = 0; i < entries.length; i += batchSize) {
			if (generation !== sidebarGeneration) {
				return;
			}

			await Promise.all(
				entries.slice(i, i + batchSize).map((entry) => {
					const held = context.get(entry.discussionKey);

					return renderComment(
						entry.key,
						held.thread,
						comments,
						held.story,
						seenTimes.get(entry.discussionKey) || 0,
						collapsedKeys,
						generation,
					);
				}),
			);

			await new Promise(requestAnimationFrame);
		}

		for (const [index, story] of stories.entries()) {
			mountMoreReplies(threads[index].rootMore, threads[index], comments, story, {
				seenTime: seenTimes.get(story.key) || 0,
				collapsedKeys,
				generation,
				parentKey: null,
			});
		}

		for (const story of stories) {
			await markSeen(story.key);
		}

		// Vote wiring is HN's, and only HN's -- Reddit is read-only, so its
		// discussions declare no vote capability and are skipped rather than
		// fetched-and-discarded.
		for (const story of stories) {
			if (!isSidebarVisible() || !getSource(story.source)?.capabilities.vote) {
				continue;
			}

			if (generation !== sidebarGeneration) {
				return;
			}

			setSidebarStage(ui, "votes");
			hydrateVoteControlsForStory(story.id, await loadVoteLinks(story.id));
			hydrateDisplayAges(story.id);
		}
	}

	// The subject is the page, not any one submission of it. `renderStory` put a
	// submission's own title and score at the top because there was only ever one;
	// with several, across several sites, that is trivia sitting where the article
	// should be.
	function renderPageHeader(stories, threads, container) {
		const total = stories.reduce(
			(sum, story) => sum + (story.commentCount || 0),
			0,
		);

		const wrapper = document.createElement("div");

		// With one discussion the header steps aside entirely and the submission
		// below renders the way a Hacker News story does: the arrow, the title and
		// the subline as one unit. Holding the title up here instead left the arrow
		// pointing at an empty cell, with our own heading and a rule above it --
		// which is what stopped it reading like HN.
		const single = stories.length < 2;

		wrapper.className = single ? "page-header page-header-quiet" : "page-header";
		wrapper.innerHTML = `
<div class="page-header-title">${single ? "" : escapeHTML(stories[0]?.title || "")}</div>
<div class="page-header-meta">${
	// With one discussion there is nothing to break down and nothing to switch
	// between, so the header is the title and nothing else: the submission's own
	// line below it already reads the way a Hacker News story line does, count
	// and all. "352 comments across 1 discussion", a pill reading "HN 87", and
	// that line underneath were three headings saying one thing.
	stories.length > 1
		? `${escapeHTML(pluralize(total, "comment"))} across <button type="button" class="page-header-disclosure" aria-expanded="false" aria-controls="source-strip">${escapeHTML(pluralize(stories.length, "discussion"))}</button>`
		: ""
}</div>
<div class="source-strip${stories.length > 1 ? "" : " source-strip-single"}" id="source-strip">
${stories
	.map(
		(story, index) => `
<button type="button" class="source-strip-entry"
data-discussion-key="${escapeHTML(story.key)}"
title="Show only this discussion">
<span class="source-strip-label">${escapeHTML(story.label)}</span>
<span class="source-strip-count">${escapeHTML(String(threads[index]?.rootKeys.length ?? 0))}</span>
</button>`,
	)
	.join("")}
</div>`;

		// Collapsed until asked for. The aggregate is the headline -- "what the
		// internet said about this page" -- and the breakdown is what a reader
		// reaches for, so it opens off the count that names it rather than sitting
		// permanently under the title.
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

			// Measured rather than left to the CSS ceiling. A max-height animation
			// only *looks* like a slide while the ceiling is still below the content:
			// against a fixed 160px, a two-pill strip 22px tall finishes moving about
			// 30ms into a 220ms transition and reads as a snap. Setting the height it
			// actually needs makes the motion last as long as the transition does.
			strip.style.maxHeight = open ? `${strip.scrollHeight}px` : "0px";

			// Collapsed content stays in the layout for the slide, so it has to leave
			// the tab order by hand or a hidden pill can still be focused.
			for (const entry of strip.querySelectorAll(".source-strip-entry")) {
				entry.tabIndex = open ? 0 : -1;
			}
		};

		setStripOpen(false);

		disclosure.onclick = () =>
			setStripOpen(!strip.classList.contains("is-open"));

		// Filtering, not navigating. A pill that opened the thread on Reddit would
		// be answering "show me this part of the conversation" by sending the reader
		// out of the conversation -- and the sidebar already knows how to show one
		// discussion, because a quoted passage and a focused comment do the same
		// thing. Pressing the active one puts the whole blend back.
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

			syncSourceStripState(wrapper);
			syncSubmissionDetails();
			// Left open on purpose: collapsing the strip out from under the press
			// that just filtered would take away the control needed to undo it.
			setStripOpen(true);
		});

		container.appendChild(wrapper);

		return wrapper;
	}

	// Which pill is currently doing something, read off the filter rather than
	// tracked separately, so a filter cleared from the banner leaves the strip
	// showing the truth.
	// The story block belonging to whichever discussion is filtered. Driven off
	// activeCommentFilter rather than tracked separately, so a filter cleared from
	// the banner leaves the right block showing.
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
			block.hidden = block.dataset.discussionKey !== active;
		}
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

	// Told apart by `source`, which only a normalized discussion carries. Refs are
	// HN by construction -- every path that produces one stores an HN item id --
	// so loading them through the HN adapter is not an assumption, it is what
	// those ids are.
	async function resolveDiscussions(items) {
		const resolved = items.some((item) => item && item.source)
			? items
			: (await loadStories(items)).map(hnDiscussion);

		// Filtered here rather than at the lookup, because the lookup is not the only
		// way in. Arriving from Hacker News reuses the story ids recorded while the
		// reader was on it, the queue and the reading list carry their own, and
		// reopening after a comment names one directly -- none of which passed
		// through discoverAll, so a switched-off source still rendered.
		const settings = await loadSettings();
		const enabled = new Set(
			enabledSourceIds(settings, registeredSourceIds()),
		);

		return collapseIndistinguishable(
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

	// Must outlast the .2s max-height transition on .header-subtitle, or the text
	// disappears while the header is still closing.
	const SUBTITLE_COLLAPSE_MS = 240;

	// The subtitle carries two things: what the sidebar is loading, and, once it is
	// idle, how many submissions it is showing. The resting text is recorded rather
	// than written straight out, so a render finishing mid-stage cannot overwrite
	// the stage the reader is currently being shown.
	// Every write goes through here, so the collapsed-when-empty class can never
	// drift out of step with the text that justifies it.
	function writeSidebarSubtitle(element, text) {
		window.clearTimeout(element._hnewhereSubtitleTimer);

		if (text) {
			element.textContent = text;
			element.classList.add("header-subtitle-visible");
			return;
		}

		// The text has to outlive the collapse. Emptying it now would take the
		// element's own height to zero in a single frame, and max-height would have
		// nothing left to animate -- which is the title dropping rather than easing.
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

			// The chrome does not depend on the stories, so it is built first and the
			// panel reports what it is waiting for. Loading first meant the reader
			// watched an empty page through the slowest part of startup.
			const ui = await createSidebar();
			sidebarUI = ui;

			if (generation !== sidebarGeneration) {
				return;
			}

			// Opened for the front page and the queue rather than for a discussion,
			// from a page that has none. Nothing below applies: there are no stories
			// to load, nothing to annotate, and no per-site state worth recording --
			// writing "collapsed" here would suppress automatic opening later, on a
			// page that has since been submitted, for a panel the reader never shut.
			// Same shape as browseOnly below: the shell is real, the body is not a
			// discussion. Nothing further applies -- there are no stories to load,
			// nothing to annotate, and no per-site state worth recording.
			if (options.setupOnly) {
				sidebarHasDiscussion = false;
				renderSourcePicker(ui);
				return;
			}

			if (options.browseOnly) {
				sidebarHasDiscussion = false;
				renderNoDiscussion(ui);

				// On Hacker News there is nothing behind the trail: the front page is
				// already the page underneath. So the wordmark stops being a way back
				// and becomes a label, the chevron goes, and the panel has one job.
				if (options.queueOnly) {
					const toggle = ui.shadow.querySelector("#browse-toggle");

					ui.shadow.querySelector("#panel")?.classList.add("queue-only");

					if (toggle) {
						toggle.disabled = true;
						toggle.title = "Your queue";
					}
				}

				// Put into browse without the cross-fade, then slid in. The panel is not
				// on screen yet, so fading between two views inside it would only be a
				// delay in front of the one movement there is to see.
				setBrowseMode(ui, true, {
					animate: false,
					tab: options.queueOnly ? "queue" : undefined,
				});
				slidePanelIn(ui);
				return;
			}

			sidebarHasDiscussion = true;

			if (options.startHidden && sidebar) {
				// Deliberately records nothing. This branch is the annotation preload:
				// the panel is built hidden so highlights can be drawn, which is the
				// script's own doing and not a reader shutting anything. Writing
				// "collapsed" here could only ever fabricate a preference -- the
				// preload is unreachable when the site is already "open", and a
				// no-op when it is already "collapsed" -- and the fabricated one
				// outranks the auto-open setting, silently killing it for the site.
				sidebar.style.display = "none";

				// Given its real handler now rather than after the render and the
				// annotation pass. Those are the slow part, the ring spins across all
				// of it, and until this ran the button on screen still carried the
				// placeholder's -- so the whole time it looked busiest, pressing it
				// did nothing. createFloatingHNButton adopts the placeholder, so the
				// ring carries on spinning through the swap.
				await createRestoreButton();
			} else if (options.remember !== false) {
				// Skipped only for an open the HN-arrival rule granted. The per-site
				// memory outranks the global setting, so recording one would turn the
				// site into one that opens on every visit -- and the reader would have
				// no way to see why the rule had stopped applying.
				await saveSidebarState("open");
			}

			setSidebarStage(ui, "discussion");

			// Two shapes converge here. The page lookup hands over discussions that
			// are already normalized, because a Reddit one cannot be rebuilt from an
			// HN id. The queue, the reading list and the reopen-after-commenting path
			// hand over HN story refs, which still have to be loaded.
			const loaded = await resolveDiscussions(stories);

			if (!loaded.length) {
				throw new Error("No discussions could be loaded");
			}

			if (generation !== sidebarGeneration) {
				return;
			}

			setSidebarStage(ui, "comments");

			// One path, whatever the count. Two renderers meant the panel looked
			// like a different product depending on how many places a link happened
			// to be posted to -- a submission header for one, a page header for
			// several -- and every fix had to be made twice.
			await renderDiscussions(loaded, ui);

			if (generation === sidebarGeneration) {
				// Announced only when the pass will actually run, so the sidebar never
				// claims to be doing work that is switched off.
				const settings = await loadSettings();

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

	function parseItemActionPayload() {
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

		if (!ITEM_ACTIONS.includes(action)) {
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
			// Only votes carry one -- favorite and flag have no client-injected link
			// to pass along, so the popup finds those itself.
			voteURL: normalizeVoteURL(params.get("voteURL")),
		};
	}

	// #region hnewhere-test-export

	// The path HN serves each action from, which is also how the popup finds the
	// anchor once it is there. Votes are keyed by element id because hn.js gives
	// them one; favorite and flag are not, so they are found by where they point.
	const ITEM_ACTION_PATHS = {
		fave: { path: "fave", params: {} },
		unfave: { path: "fave", params: { un: "t" } },
		flag: { path: "flag", params: {} },
		unflag: { path: "flag", params: { un: "t" } },
	};

	const ITEM_ACTIONS = ["up", "down", "un", ...Object.keys(ITEM_ACTION_PATHS)];

	// Favorite and flag both render as a plain link on a logged-in item page, with
	// no id to look them up by. Matched on the path and the item they name, and on
	// whether the link is the doing or the undoing of it -- HN marks the undo with
	// un=t, and the two are otherwise identical.
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

	function postItemActionResult(payload, result) {
		if (!window.opener) {
			return;
		}

		try {
			window.opener.postMessage(
				{
					source: ITEM_ACTION_BRIDGE_MESSAGE_SOURCE,
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
	function reportItemActionAfterReload() {
		const forget = () => {
			try {
				window.sessionStorage.removeItem(ITEM_ACTION_BRIDGE_STORAGE_KEY);
			} catch {}
		};

		let stored = null;

		try {
			stored = window.sessionStorage.getItem(ITEM_ACTION_BRIDGE_STORAGE_KEY);
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
			forget();
			return false;
		}

		if (!payload?.itemId || !payload?.nonce) {
			forget();
			return false;
		}

		const isFaveOrFlag = Boolean(ITEM_ACTION_PATHS[payload.action]);

		// A vote has to wait for the item page. HN's /vote response is itself a page
		// this script runs on, and the redirect has not landed yet, so the document
		// carries no vote links -- reporting from there would post a null voteInfo
		// and close the popup before the real state was ever read.
		//
		// Favorite must not wait for it, because it never arrives: /fave ignores
		// goto and redirects to the favorites list instead. Waiting for /item there
		// meant waiting forever, which is precisely what left the popup sitting
		// open on a page of favorites with nothing reported back.
		if (!isFaveOrFlag && location.pathname !== "/item") {
			return false;
		}

		// Read out only once it is going to be acted on. Cleared here so that if
		// anything below throws, a stale payload cannot make the next page load try
		// to report all over again.
		forget();

		// Favorite and flag are read back the way they were found: by which link HN
		// is now offering, on whichever page it chose to land on. Both the item page
		// and the favorites list carry the undo link for a story that is favorited,
		// so finding it is an answer either way.
		if (isFaveOrFlag) {
			const base = payload.action.startsWith("un")
				? payload.action.slice(2)
				: payload.action;
			const wanted = !payload.action.startsWith("un");

			// Read the state HN is now in, not the action that was asked for. The
			// undo link is only ever offered for something already done, so its
			// presence *is* the state: "unflag" showing means flagged, "flag"
			// showing means not.
			//
			// Deriving it from the action instead is what broke unflagging. The
			// check was "is the opposite link here" -- true after flagging, because
			// unflag appears; but also true after unflagging, because flag appears.
			// So a successful unflag recorded itself as flagged and the label never
			// changed back. Favorite escaped it by luck: /fave lands on the
			// favorites list, where a story just un-favorited is no longer named, so
			// neither link was found and the fallback happened to be right.
			const onLink = findItemActionAnchor(document, "un" + base, payload.itemId);
			const offLink = findItemActionAnchor(document, base, payload.itemId);

			// Neither link on the page says nothing about the story rather than
			// something negative -- a list that simply does not mention it. What was
			// asked for is the better answer there: the navigation went to HN's own
			// action URL carrying HN's own auth token, and HN does not quietly
			// decline those.
			const applied = onLink ? true : offLink ? false : wanted;

			postItemActionResult(payload, {
				ok: applied === wanted,
				reason: applied === wanted ? "updated" : "unchanged",
				action: payload.action,
				applied,
			});

			window.setTimeout(() => window.close(), 60);
			return true;
		}

		// Server-rendered state, so this is the vote HN actually holds.
		const voteInfo = currentVoteInfoFor(payload.itemId);
		const changed = voteInfo?.state !== payload.beforeState;

		postItemActionResult(payload, {
			ok: changed,
			reason: changed ? "updated" : "unchanged",
			voteInfo,
			// HN's own tally, read off the page it just served.
			score: extractScoreFromRoot(document, payload.itemId),
		});

		window.setTimeout(() => window.close(), 60);
		return true;
	}

	// Favorite and flag take the same route a vote does -- navigate, let HN commit
	// it, come back on the redirect -- but they are found differently and they
	// report differently, so they branch off before the vote machinery.
	function handleFaveFlagAction(payload) {
		const anchor = findItemActionAnchor(document, payload.action, payload.itemId);

		// The sidebar cannot know whether an action applies: it reads HN logged out,
		// where a favorite link never renders and a flag link never renders either.
		// So the popup is what finds out, and it finds out the only way available --
		// by looking at a page served to the real account and seeing nothing there.
		// Logged out, or below the karma flagging needs, and the answer is the same.
		if (!anchor) {
			const base = payload.action.startsWith("un")
				? payload.action.slice(2)
				: payload.action;
			const opposite = payload.action.startsWith("un") ? base : "un" + base;

			// A missing link has two very different meanings and they were being
			// treated as one. If the opposite link is here, the action plainly does
			// apply to this reader -- it is simply already done, and the panel is
			// the thing that is out of date. Only when neither is on the page has HN
			// declined to offer it at all.
			//
			// Conflating them is how one stale label took every flag link on the
			// page down with it: a second press on something already unflagged found
			// no unflag link, was read as "you cannot flag", and that answer is
			// remembered against the whole account.
			const already = findItemActionAnchor(document, opposite, payload.itemId);

			postItemActionResult(payload, {
				ok: Boolean(already),
				reason: already ? "already" : "action-unavailable",
				action: payload.action,
				...(already ? { applied: !payload.action.startsWith("un") } : {}),
			});
			window.setTimeout(() => window.close(), 80);
			return true;
		}

		const target = new URL(anchor.getAttribute("href"), HN_ORIGIN + "/");

		// Same rule as the vote path, for the same reason: HN's own handler would
		// fire this in the background and closing the popup would abort it. A
		// top-level navigation cannot be cancelled that way.
		target.searchParams.set("goto", "item?id=" + payload.itemId);

		try {
			window.sessionStorage.setItem(
				ITEM_ACTION_BRIDGE_STORAGE_KEY,
				JSON.stringify(payload),
			);
		} catch (error) {
			console.error("HNewhere: could not stage item action payload", error);
			postItemActionResult(payload, {
				ok: false,
				reason: "storage-unavailable",
				action: payload.action,
			});
			window.setTimeout(() => window.close(), 80);
			return true;
		}

		location.href = target.href;
		return true;
	}

	function maybeHandleHNItemAction() {
		const payload = parseItemActionPayload();

		if (!payload) {
			return false;
		}

		if (ITEM_ACTION_PATHS[payload.action]) {
			return handleFaveFlagAction(payload);
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
			postItemActionResult(payload, {
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
				ITEM_ACTION_BRIDGE_STORAGE_KEY,
				JSON.stringify({
					...payload,
					beforeState: before?.state ?? "none",
				}),
			);
		} catch (error) {
			console.error("HNewhere: could not stage vote payload", error);
			postItemActionResult(payload, {
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

	// -------------------------
	// HN side: submit bridge
	// -------------------------

	// HN's submit form posts to /r. Login pages have no such form, which is how being
	// logged out is detected.
	function findSubmitForm() {
		for (const form of document.querySelectorAll("form")) {
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
	function readSubmitError() {
		const text = (document.body?.textContent || "").toLowerCase();

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

	// Runs on whatever page HN lands on after the submission POST. Three outcomes are
	// possible and they are not distinguishable by anything except the pathname, so
	// each is handled explicitly rather than assumed.
	function reportSubmitResultAfterReload() {
		let stored = null;

		try {
			stored = window.sessionStorage.getItem(SUBMIT_BRIDGE_STORAGE_KEY);
			// Cleared first: if anything below throws, a stale payload must not make the
			// next HN page load try to report again.
			window.sessionStorage.removeItem(SUBMIT_BRIDGE_STORAGE_KEY);
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

		if (!payload?.nonce) {
			return false;
		}

		const finish = (result) => {
			postBridgeResult(SUBMIT_BRIDGE_MESSAGE_SOURCE, payload, result);
			window.setTimeout(() => window.close(), 60);
		};

		// Already submitted by someone: HN redirects straight to the existing item.
		if (location.pathname === "/item") {
			const id = new URLSearchParams(location.search).get("id");

			finish({ ok: Boolean(id), storyID: id, reason: id ? "existing" : "dupe" });
			return true;
		}

		// The success case. HN drops you on /newest, so the new story has to be found
		// by matching the URL that was just submitted.
		if (location.pathname === "/newest") {
			finish({
				ok: true,
				storyID: findSubmittedStoryID(payload.normalized),
				reason: "submitted",
			});
			return true;
		}

		// Still on a form or an error page: the submission did not go through.
		finish({ ok: false, ...(readSubmitError() || { reason: "unknown" }) });
		return true;
	}

	// Returns null rather than a guess when the row cannot be found. /newest ordering
	// and indexing are not guaranteed, and reporting a wrong id would send the reader
	// to somebody else's thread -- strictly worse than reporting none and letting the
	// ordinary findHN path pick the story up on the next load.
	function findSubmittedStoryID(normalized) {
		if (!normalized) {
			return null;
		}

		for (const link of document.querySelectorAll(".titleline > a")) {
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

	async function maybeHandleHNSubmitBridge() {
		const payload = parseBridgeHash("hnewhere-submit");

		if (!payload) {
			return false;
		}

		const staged = await readBridgePayload(payload.nonce);
		const form = findSubmitForm();

		if (!form) {
			postBridgeResult(SUBMIT_BRIDGE_MESSAGE_SOURCE, payload, {
				ok: false,
				reason: "not-logged-in",
			});
			return true;
		}

		// /submitlink prefills title and url from the query string; these are assigned
		// anyway so what the reader edited in the popover wins, and so a deliberately
		// cleared url actually arrives cleared rather than falling back to the query.
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

		try {
			window.sessionStorage.setItem(
				SUBMIT_BRIDGE_STORAGE_KEY,
				JSON.stringify({
					...payload,
					normalized: staged?.normalized || null,
				}),
			);
		} catch (error) {
			console.error("HNewhere: could not stage submit payload", error);
			postBridgeResult(SUBMIT_BRIDGE_MESSAGE_SOURCE, payload, {
				ok: false,
				reason: "storage-unavailable",
			});
			return true;
		}

		// Same reasoning as the vote bridge: submit the form as a navigation rather
		// than clicking, so closing the popup cannot abort an in-flight request.
		form.submit();
		return true;
	}

	// -------------------------
	// HN side: comment bridge
	// -------------------------

	// The top-level comment form on an item page. A locked thread or a logged-out
	// reader gets no such form, which is how both are detected.
	function findCommentForm() {
		for (const form of document.querySelectorAll("form")) {
			const textarea = form.querySelector('textarea[name="text"]');

			if (textarea) {
				return { form, textarea };
			}
		}

		return null;
	}

	function readCommentError() {
		const text = (document.body?.textContent || "").toLowerCase();

		if (text.includes("you're posting too fast") || text.includes("posting too fast")) {
			return { reason: "rate-limited" };
		}

		if (text.includes("please log in") || text.includes("bad login")) {
			return { reason: "not-logged-in" };
		}

		return null;
	}

	// Comparison key for "did HN echo our comment back". Whitespace and case are
	// normalized because HN reflows the text into paragraphs, and only a prefix is
	// used because it wraps long comments in markup this cannot see through.
	function commentMatchKey(text) {
		return (text || "")
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase()
			.slice(0, 120);
	}

	function reportCommentResultAfterReload() {
		let stored = null;

		try {
			stored = window.sessionStorage.getItem(COMMENT_BRIDGE_STORAGE_KEY);
			window.sessionStorage.removeItem(COMMENT_BRIDGE_STORAGE_KEY);
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

		if (!payload?.nonce) {
			return false;
		}

		const finish = (result) => {
			postBridgeResult(COMMENT_BRIDGE_MESSAGE_SOURCE, payload, result);
			window.setTimeout(() => window.close(), 60);
		};

		const error = readCommentError();

		if (error) {
			finish({ ok: false, ...error });
			return true;
		}

		// Server-rendered proof: HN redirected back to the item page, so if the comment
		// landed it is on this page.
		const needle = payload.matchKey;
		let found = false;

		if (needle) {
			for (const node of document.querySelectorAll(".commtext")) {
				if (commentMatchKey(node.textContent).startsWith(needle.slice(0, 60))) {
					found = true;
					break;
				}
			}
		}

		// Reported as unconfirmed rather than failed. The post very likely succeeded --
		// HN redirected here rather than showing an error -- but the text was not found,
		// so telling the reader it failed would invite a duplicate.
		finish(
			found
				? { ok: true, reason: "posted" }
				: { ok: false, reason: "unconfirmed" },
		);
		return true;
	}

	async function maybeHandleHNCommentBridge() {
		const payload = parseBridgeHash("hnewhere-comment");

		if (!payload) {
			return false;
		}

		const staged = await readBridgePayload(payload.nonce);

		if (!staged?.text) {
			postBridgeResult(COMMENT_BRIDGE_MESSAGE_SOURCE, payload, {
				ok: false,
				reason: "draft-missing",
			});
			return true;
		}

		const target = findCommentForm();

		if (!target) {
			postBridgeResult(COMMENT_BRIDGE_MESSAGE_SOURCE, payload, {
				ok: false,
				...(readCommentError() || { reason: "no-form" }),
			});
			return true;
		}

		// Assigned verbatim. HN's formatter is the only thing that should interpret
		// this text, so nothing here trims, collapses or re-wraps it.
		target.textarea.value = staged.text;

		try {
			window.sessionStorage.setItem(
				COMMENT_BRIDGE_STORAGE_KEY,
				JSON.stringify({
					...payload,
					matchKey: commentMatchKey(staged.text),
				}),
			);
		} catch (error) {
			console.error("HNewhere: could not stage comment payload", error);
			postBridgeResult(COMMENT_BRIDGE_MESSAGE_SOURCE, payload, {
				ok: false,
				reason: "storage-unavailable",
			});
			return true;
		}

		// Navigation rather than a click, for the same reason as the vote bridge: a
		// backgrounded request dies with the popup, a form navigation does not.
		target.form.submit();
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

	// Injected into HN's own rows, in HN's own vocabulary: a lowercase text link
	// between pipes, beside hide and discuss. Anything more would announce itself as
	// somebody else's furniture on a page that has a very settled idea of what a row
	// looks like.
	async function setupHNQueueLinks() {
		const rows = [...document.querySelectorAll("tr.athing")];

		if (!rows.length) {
			return;
		}

		const queued = new Set((await loadQueue()).map((entry) => entry.id));

		for (const row of rows) {
			const story = parseFrontPageRow(row);
			const subline = row.nextElementSibling?.querySelector(".subline, .subtext");

			// A job post has no subline worth appending to and cannot be read later in
			// any useful sense -- it is a listing, not an article.
			if (!story || !subline || !story.by) {
				continue;
			}

			const link = document.createElement("a");
			link.href = "#";
			link.className = "hnewhere-save-link";
			link.textContent = queued.has(story.id) ? "queued" : "queue";

			link.onclick = async (event) => {
				event.preventDefault();

				const entries = await loadQueue();
				const already = entries.some((entry) => entry.id === story.id);

				// The same control both ways. A row is the only place this story
				// appears, so making the reader hunt elsewhere to undo a misclick
				// would be the wrong half of a pair.
				const next = already
					? removeFromQueue(entries, story.id)
					: addToQueue(entries, story, Date.now());

				await saveQueue(next);

				link.textContent = already ? "queue" : "queued";

				// The button is offered once, when the page loads. A queue filled
				// after that -- which is the ordinary way of filling one, a row at a
				// time while reading down the page -- would otherwise have nowhere to
				// be opened from until the next page load. It follows the queue now
				// rather than whatever the queue happened to be on arrival, and goes
				// again when the last entry does.
				if (next.length) {
					await offerQueueOnHN();
				} else {
					const existing = document.getElementById("hn-queue-button");

					if (existing) {
						destroyFloatingButton(existing);
					}
				}
			};

			// First of the actions, wherever that group happens to begin. Every HN
			// subline is the same shape -- score, submitter, age, then the actions,
			// then the comment count -- so the age is the one thing that reliably
			// marks where the actions start.
			//
			// Anchoring on a particular action instead is what put this in the wrong
			// place: the favorites list carries neither flag nor hide, so a rule
			// written in terms of those had nothing to find and fell through to the
			// end of the line, landing queue after the comment count.
			//
			// It also lands where the order says it should: decide whether you want
			// to read it, flag it if it should not be there, hide it if it is not for
			// you, open the comments if it is.
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

	function sameURL(a, b) {
		return normalizeURL(a) === normalizeURL(b);
	}

	// #region hnewhere-test-export

	// HN's front page is two rows per story: the title row carries the id and the
	// link, the row after it carries everything else. Read outwards by selector
	// rather than by column, because a job post has no votelinks cell and counting
	// positions puts every one of its fields one to the left.
	function parseFrontPageRow(row) {
		const id = Number(row.id);
		const link = row.querySelector(".titleline > a");

		// Both are real rows on a real page: HN pads the list with `pagespace` and
		// `morespace` rows carrying no title, and their ids are words.
		if (!Number.isFinite(id) || !id || !link) {
			return null;
		}

		const subtext = row.nextElementSibling?.querySelector(".subtext");

		// Ask HN, Show HN without a link, and polls point at their own item page
		// with a relative href, so the "article" for those is the discussion.
		// Resolved against HN rather than against whatever page the sidebar is on.
		const parsed = new URL(link.getAttribute("href") || "", HN_ORIGIN + "/");

		// Then held to http(s). A `javascript:` or `data:` href survives the URL
		// constructor intact -- the base is ignored once a scheme is present -- and
		// escapeHTML does nothing to it either, since it carries no quotes or angle
		// brackets to escape. It would be live in both the row's href and the
		// assignment the click handler makes.
		//
		// HN would not accept such a submission today, which is exactly the sort of
		// assumption not to depend on: this is markup fetched from somewhere else
		// and rendered into every page the reader visits. A story whose URL cannot
		// be used still has a discussion, so it falls back to that rather than
		// disappearing -- built from HN_ORIGIN rather than through commentURL,
		// which lives outside the exported region this has to run inside.
		const url = /^https?:$/.test(parsed.protocol)
			? parsed.href
			: HN_ORIGIN + "/item?id=" + id;

		// title="2026-08-02T11:34:41 1785670481". The second field is the unix time
		// timeAgo wants; parsing the first would be the same answer by way of a date
		// parser and a time zone.
		const time = Number(
			(subtext?.querySelector(".age")?.getAttribute("title") || "").split(/\s+/)[1],
		);

		// By its words, not its href or its position. A job post's only `item?id=`
		// anchor is its age, so taking the last of those reads "3 hours ago" as
		// three comments. "discuss" is how HN writes none.
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

	// HN paginates with a single "More" link carrying ?p=N, and offers nothing
	// pointing backwards -- the page you came from is simply N-1, which is why only
	// this direction has to be read off the page. Its absence is how the last page
	// announces itself, so a missing link is the answer rather than a parse failure.
	function parseFrontPageNextPage(doc) {
		const href = doc.querySelector("a.morelink")?.getAttribute("href");

		if (!href) {
			return null;
		}

		const page = Number(
			new URL(href, HN_ORIGIN + "/news").searchParams.get("p"),
		);

		return Number.isFinite(page) && page > 1 ? page : null;
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

	// fromHN is passed in rather than read here because it has two sources: the
	// referrer, and the story click STORAGE.last already recorded on HN. The page
	// pass knows both; this only has to weigh the answer.
	function shouldAutoOpenSidebar(settings, siteState = null, fromHN = false) {
		// The setting reads as a sentence -- "automatically open the sidebar when a
		// discussion exists", narrowed by "only when arriving from Hacker News" --
		// and while it is on it is the whole answer. A panel the reader shut on some
		// earlier visit is not a standing objection to a preference they have since
		// expressed, and letting it win is how the setting ends up not doing what it
		// says. The sub-option is part of the same sentence, so it is weighed here
		// and nowhere else.
		if (settings.autoOpenSidebar) {
			return settings.autoOpenSidebarOnlyFromHN ? fromHN : true;
		}

		// With the setting off, what the reader did on this site by hand is all there
		// is to go on. Only a deliberate open is ever recorded, so reaching this can
		// never be the script honouring something it decided for itself.
		return siteState === "open";
	}
	// #endregion hnewhere-test-export

	// Read once at load, because document.referrer belongs to the document rather
	// than to the URL currently showing. A client-side router changes the address
	// without touching it, so a reader who arrived from HN and then clicked through
	// four articles would otherwise register as four arrivals. watchSoftNavigation
	// clears this the moment it commits to a new URL; a hard navigation needs no
	// help, because the referrer then becomes the site itself.
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

	// Unconditional while the sidebar is open, because that is the context the
	// annotations exist for: clicking a highlight filters the thread to the comment
	// that quoted it. The only choice left is whether they outlive the panel.
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

	// Matched on what the quote says rather than on which group it landed in. Two
	// comments quoting the same sentence can end up in different groups -- the groups
	// are keyed by the article range each matched, and those ranges need not be
	// identical -- so comparing group identity left one of them marked and the other
	// not. The reader saw the banner restate a sentence and then found that same
	// sentence underlined immediately beneath it.
	function setQuoteRedundancy(group, redundant) {
		// Measured against the passage the banner is showing, not against the group a
		// comment happens to belong to. Two comments quoting the same sentence can
		// land in different groups -- groups are keyed by the article range matched,
		// and one comment may have quoted a longer run than another -- so comparing
		// group identity left the banner restating a sentence while that very
		// sentence stayed marked in the comment below it.
		//
		// Containment, because a comment quoting any part of the focused passage is
		// quoting words the banner has already put on screen.
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

	// scrollIntoView would sit the banner flush against the container edge, under
	// #comments' own top padding. Scrolling the container directly lets the banner
	// keep that padding, so it reads as the top of the list rather than as
	// something clipped by it.
	// #comments scrolls; #comments-content is the list inside it.
	function commentScrollContainer() {
		return sidebarUI?.body?.closest("#comments") || null;
	}

	// Both surfaces the reader was using, because entering a focus moves both: the
	// thread jumps to the banner, and the article jumps to the quoted passage so the
	// reader can see the context it was taken from.
	//
	// The thread is stored as a comment and how far down the panel it sat, since a
	// raw offset stops describing anything once the list is a different length --
	// which is what filtering does to it. The article is stored as a plain offset,
	// because nothing reflows it: the sidebar is fixed, so the page it had is the
	// page it will have.
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

		// Read out before the transition, which may run a beat later, and dropped
		// here either way: a position kept past this point would describe a list that
		// no longer exists. Only an explicit "show all comments" restores -- the other
		// callers are tearing the list down or refreshing annotations, where moving
		// the reader would be an interruption rather than a return.
		const position = options.restore ? preFilterPosition : null;
		preFilterPosition = null;

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
			syncSubmissionDetails();
			sidebarUI?.filterBanner?.classList.add("hidden");
			if (sidebarUI?.filterBannerQuote) {
				sidebarUI.filterBannerQuote.textContent = "";
				// Cleared with the text it belongs to. Left on, the next focus entered
				// from a quoted passage would render without its quote marks -- a fault
				// that only shows up on the second focus of a session, and only in one
				// order.
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

			// Quote styling given to a paragraph on the strength of a match. With the
			// annotations gone there is nothing left proving it was a quote, so the
			// paragraph goes back to being ordinary prose.
			sidebarUI.shadow
				.querySelectorAll("[data-hnewhere-quote-promoted='1']")
				.forEach((element) => {
					element.classList.remove("comment-quote-promoted");
					delete element.dataset.hnewhereQuotePromoted;
				});

			sidebarUI.shadow
				.querySelectorAll(".comment-target")
				.forEach((element) => element.classList.remove("comment-target"));
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

		// On a word, not through one: "Minimum ef…" reads as something broken, where
		// "Minimum…" reads as a quotation carrying on. The floor is there for text
		// with no spaces to fall back to, a long URL being the usual one, which would
		// otherwise be cut back to nothing.
		return (
			(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() +
			"…"
		);
	}

	// 200 rather than the banner quote's 220: this line carries an author in front
	// of it, and the two together have to sit on the same one or two lines a pull
	// quote does.
	const COMMENT_FOCUS_PREVIEW_LENGTH = 200;

	// The comment's own opening, not a quote from the article -- a comment focus is
	// entered from the comment, so what identifies it is who wrote it and how it
	// starts. Reads textContent rather than the HTML: the banner is one line of
	// plain text, and a comment's markup is links, code and blockquotes.
	function commentFocusPreview(comment) {
		return {
			author: comment?.author || "",
			preview: truncateText(
				comment?.textElement?.textContent || "",
				COMMENT_FOCUS_PREVIEW_LENGTH,
			),
		};
	}
	// #endregion hnewhere-test-export

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

	// #region hnewhere-test-export
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

	// #endregion hnewhere-test-export

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

			// An unmarked paragraph, offered whole. Nothing in the text says "quote"
			// here -- no `>`, no marks -- so the only thing that can establish it is
			// the article itself. That works because matching is exact once case,
			// punctuation and whitespace are normalised away: a verbatim paste will
			// match and a paraphrase will not, however close it reads.
			//
			// The floor is higher than the 24 the quotation-mark rule below uses.
			// Marks are a statement of intent that carries a short quote on its own;
			// an unmarked sentence has to be long enough that appearing word for word
			// in the article is not a coincidence.
			if (line.length >= 40 && line.length <= 320) {
				addUniqueText(candidates, seen, line);
			}
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

	// #region hnewhere-test-export
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

	// #endregion hnewhere-test-export

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

	// #endregion hnewhere-test-export

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
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}

	function flashSidebarComment(element) {
		element.classList.add("comment-target");

		window.setTimeout(() => {
			element.classList.remove("comment-target");
		}, 1200);
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
					// Block-aware, not raw textContent: textContent butts the last word
					// of one paragraph against the first of the next, and the scorer
					// then tokenizes the join as a single junk term. The `>` markers
					// used to mask this by accident; folding removes them.
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

			// The passage as the article words it, rather than whichever commenter's
			// excerpt happened to be found first. That is what the discussion is
			// about, and what the banner should be showing.
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

		// The z-score of a maximum over n samples cannot exceed sqrt(n - 1), so a
		// fixed threshold would silently tighten on short articles. Scaling by the
		// attainable maximum keeps the isolation requirement constant.
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

			// Quote matching survives a body-fallback root because it demands a
			// literal string match. BM25 has no such immunity and would wash the
			// footer, so heat declines to run without real article structure.
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
	const HEAT_FILL_LIGHT = {
		light: `rgba(${ACCENT_RGB},.025)`,
		medium: `rgba(${ACCENT_RGB},.045)`,
		heavy: `rgba(${ACCENT_RGB},.07)`,
	};

	const HEAT_FILL_DARK = {
		light: `rgba(${ACCENT_RGB},.035)`,
		medium: `rgba(${ACCENT_RGB},.055)`,
		heavy: `rgba(${ACCENT_RGB},.075)`,
	};

	// Quote rects paint solid and their layer carries the strength. Painting them
	// translucent instead made a passage's colour depend on how many people happened
	// to quote it -- one comment gave .22, six overlapping gave .78 -- so the same
	// "this is quoted" mark ranged from barely there to vivid. Opaque ink inside a
	// layer that is itself partly transparent cannot compound, so every quote reads
	// the same. How much a passage is discussed is the heat layer's job, and it was
	// only ever being said twice.
	const QUOTE_INK = ACCENT;
	// Meant to read as a highlighter drawn over the line, not as a tint on it: half
	// strength puts white paper at rgb(173,173,235). The overlay blends, so the accent
	// cannot touch the glyphs however heavy it gets -- text on a highlight keeps a
	// contrast ratio above 10 here, against the 4.5 body text is asked for -- which
	// is what lets this be a real mark rather than the .08 whisper it started as.
	const QUOTE_FILL_OPACITY = 0.5;
	// Stacks over the resting layer rather than replacing it: 1-(1-.5)(1-.24) lands
	// the pointed-at quote at .62. Kept below the point where a dark page's text
	// falls under 4.5 against its own highlight, which is around .68.
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
			background: QUOTE_INK,
		};

		if (variant === "heat") {
			const palette = options.dark ? HEAT_FILL_DARK : HEAT_FILL_LIGHT;
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

	// Split from the module state it used to read so the rule a focus follows can
	// be tested without booting a sidebar. Takes anything with `id` and `parentId`;
	// the renderer's own entries carry a good deal more, and none of it matters here.
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

	// What "focused" means: the chain up to the root, so the reader can see what is
	// being replied to, and everything below, so they get the conversation rather
	// than one turn of it.
	//
	// The descent keeps its own visited set. Guarding it on `visible` instead is
	// what stopped it working at all: the climb below used to run first and add the
	// seed, so the descent found its own starting point already visible and
	// returned before adding a single reply -- and a focus on a thread's root
	// showed the root alone. The two walks ask different questions. "Have I already
	// walked this subtree" is not "is this comment on screen".
	//
	// Descending first is what makes a seed that is also another seed's ancestor
	// come out whole: reached as an ancestor it is only added to `visible`, and its
	// own turn as a seed still has a descent left to make.
	//
	// Neither walk can assume the ids it follows are present. HN returns dead and
	// deleted comments the renderer skips, so a parent chain can point at something
	// that was never rendered; `byId.get(...)?.parentId ?? null` is what ends the
	// climb there rather than throwing.
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

	// The half both entry points share. Everything that differs -- which comments are
	// direct matches, what the banner says, what else has to change once the list has
	// been filtered -- arrives as arguments, so neither caller has to know how the
	// list transitions or where the reader was standing when they left it.
	function applyFocusedDiscussion(
		{ filter, directMatchIds, anchorElement, paintBanner, onFiltered },
		options = {},
	) {
		// Only when entering from the full list. A refresh re-applies a filter that is
		// already open, and a focus opened from inside another one should still return
		// to where the reader started rather than to the focus they passed through.
		if (!activeCommentFilter) {
			preFilterPosition = captureReadingPosition();
		}

		activeCommentFilter = filter;

		const visibleCommentIds = getVisibleCommentIds([...directMatchIds]);

		positionFilterBannerForComment(anchorElement);

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

			// Inside the transition, where the quote branch's redundancy pass has always
			// run. Hoisting it out to the caller would apply it 110ms early, while the
			// list is still faded, so a mark would come off a comment the reader can
			// still see rather than under the cover of the change.
			onFiltered?.();
			updateSubmissionVisibility(visibleCommentIds);

			if (sidebarUI?.filterBanner && sidebarUI?.filterBannerQuote) {
				sidebarUI.filterBanner.classList.remove("hidden");
				paintBanner(sidebarUI.filterBannerQuote);
			}

		}, options);

		// Entering the filter puts the banner at the top rather than centring the
		// matched comment: the banner is the explanation of what just happened, and
		// starting at it means the reader gets the whole filtered thread from its
		// beginning instead of landing midway down it.
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

		// Earliest by timestamp, not first in thread order. Thread order is a
		// property of one discussion, and a quote group can now hold comments from
		// several -- so "first" meant "whichever source happened to render first",
		// which is not a fact about the comments at all.
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

	// The third way in, and the plainest: show one discussion out of the blend.
	// Direct matches are that discussion's roots, and getVisibleCommentIds carries
	// their subtrees down, so "just r/rust" is the same kind of view a quoted
	// passage produces rather than a separate mode with its own rules.
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
				// The strip is above the list rather than inside it, so there is no
				// comment to pin the banner to -- it sits at the top, where entering
				// this filter leaves the reader anyway.
				anchorElement: null,
				paintBanner: (quote) => {
					quote.classList.add("filter-banner-quote-comment");
					quote.textContent = discussionLabelForKey(discussionKey);
				},
			},
			options,
		);
	}

	function discussionLabelForKey(discussionKey) {
		return (
			sidebarUI?.body
				?.querySelector(`.source-strip-entry[data-discussion-key="${CSS.escape(discussionKey)}"] .source-strip-label`)
				?.textContent?.trim() || "this discussion"
		);
	}

	// The second way into a focused discussion. It asks getVisibleCommentIds for the
	// same ancestors-and-subtree rule a quoted passage gets, so what the reader sees
	// is one kind of view reached two ways rather than two views that resemble each
	// other. No redundancy pass: nothing has been restated, because the banner is
	// showing the comment itself rather than words quoted from the article.
	function applyCommentFocus(commentId, options = {}) {
		const comment = getCommentGraph().byId.get(commentId);

		// Same bail-out as a missing quote group. An annotation refresh re-applies
		// whatever filter is open, and a re-render in between can leave it pointing at
		// a comment that is no longer in the list.
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

					// replaceChildren over innerHTML: the preview is a reader's prose and
					// the author is a name they chose, and neither goes anywhere near an
					// HTML parser on its way to the banner.
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
		// Ask with cloneContents, not extractContents. Both build the same fragment,
		// but extractContents mutates: a range straddling a block boundary leaves the
		// partially covered ancestors cloned into the fragment and cut in half in the
		// document. Re-inserting the fragment does not put them back together — it
		// adds the clones alongside the halves, so one paragraph becomes two split at
		// the match boundary. HN separates paragraphs with an unclosed <p> and quote
		// lines with a leading `>`, and normalizeSearchText flattens both to a space,
		// so a multi-line `>` quote matches straight across the break and lands here
		// every time. Cloning first keeps the bail-out free of side effects.
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

	// A commenter who pastes a sentence from the article as its own paragraph, with
	// neither `>` nor quotation marks around it, is quoting just as plainly as one
	// who marks it -- and the annotation pass has just proved the words are the
	// article's. That proof is what makes this safe: the styling follows a verified
	// match rather than a guess at punctuation, which is why it can be applied to
	// text carrying no marks at all.
	//
	// A class, not a <blockquote>: the promotion has to come undone when annotations
	// are switched off, and removing a class is something clearArticleAnnotations can
	// do without having to rebuild the paragraph it replaced.
	function promoteWholeParagraphQuote(wrapper) {
		const paragraph = wrapper?.closest("p");

		if (!paragraph || paragraph.closest("blockquote")) {
			return;
		}

		// Only when the match is the whole paragraph. A sentence quoted inside a
		// longer one keeps the inline mark, which is precisely what says "this part
		// came from the article" while the rest is the commenter's own.
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
				// Scrolls, unlike the refresh path below: this is the reader entering
				// the filter, and the list they were looking at is about to be
				// replaced, so the old scroll position means nothing afterwards.
				const onActivate = () => {
					applyCommentFilter(group.key, {
						commentId: comment.commentId,
					});
					controller.focusGroup(group.key);
				};
				const quoteElements = [];

				// Anchor to the quoted text itself, the way a document comment
				// attaches to the selection that prompted it. The enclosing block is
				// the fallback, not the first choice: it is only the right anchor
				// when the quote genuinely spans more than one line, which is exactly
				// when the inline wrapper declines. Trying the block first would let
				// whichever discussion happened to be processed first claim the whole
				// quote, and the coarser anchor would be an accident of ordering.
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

		// Heat paints first so quote highlights always stack above it; the
		// resulting overlap makes a quoted phrase inside a hot paragraph the
		// hottest thing on the page, which is the hierarchy we want.
		const heatLayer = document.createElement("div");
		const baseLayer = document.createElement("div");
		const activeLayer = document.createElement("div");

		// The quote layers are where a highlight's strength lives, so that opaque
		// rects inside them cannot compound where two comments quote the same words.
		baseLayer.style.opacity = String(QUOTE_FILL_OPACITY);

		// Decorative only, and above the interactive rects, so it must never take the
		// pointer -- the base layer's buttons are what the reader is aiming at. Its
		// opacity is animated rather than its children being added and removed, so a
		// quote fades under the pointer instead of snapping.
		activeLayer.style.cssText = `
			opacity:0;
			pointer-events:none;
			${prefersReducedMotion() ? "" : "transition:opacity .12s ease;"}
		`;

		overlay.append(heatLayer, baseLayer, activeLayer);
		document.body.appendChild(overlay);

		let heatRegions = regions || [];

		const groupsByKey = new Map(groups.map((group) => [group.key, group]));
		let renderFrame = 0;

		// A quote that wraps produces one rect per line, and they are one thing: the
		// reader points at a sentence, not at a line of it. Kept so pointing at any
		// rect can light the rest.
		const rectsByGroup = new Map();
		let activeGroupKey = null;

		// Live rather than read once: a convertible laptop can gain and lose a mouse
		// without reloading the page.
		const hoverQuery =
			typeof window.matchMedia === "function"
				? window.matchMedia("(hover: hover)")
				: null;

		// Repaints only the active layer rather than re-rendering the overlay. A
		// re-render would replace the very node the pointer is over, which fires
		// pointerleave and leaves the highlight stuck on or flickering between states.
		// The old rects are left in place while the layer fades out, so a quote the
		// pointer has left finishes its fade instead of vanishing mid-transition.
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
			overlay.style.height =
				Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) +
				"px";
			baseLayer.replaceChildren();
			heatLayer.replaceChildren();
			rectsByGroup.clear();

			// Sampled from the text actually being marked rather than from the theme,
			// because the blend has to answer to the paper under the highlight. Falls
			// back through heat to the body, so a page with no quotes still resolves.
			const backdrop =
				nearestElement(groups[0]?.range?.commonAncestorContainer) ||
				nearestElement(heatRegions[0]?.range?.commonAncestorContainer) ||
				document.body;
			const dark = isDarkBackdrop(backdrop);

			// The whole overlay blends, rather than each rect: the overlay's z-index
			// makes it a stacking context, which isolates its descendants' blending to
			// the group. A mix-blend-mode on a rect would composite against the
			// overlay's own transparency and change nothing on the page.
			//
			// Orange over paper lands on the same pixel either way, so this costs the
			// highlight nothing and stops it washing the glyphs it covers -- the point
			// being that a highlighter is ink under the text, not a film over it.
			// Multiply can only darken, which is right until the page is dark, where it
			// would eat light text and sink into the background; screen is its mirror.
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

	// Ticking the blocklist toggle removes the sidebar the settings panel lives in,
	// so callers must finish persisting before calling this and must not read
	// sidebar or sidebarUI afterwards.
	function teardownForBlockedSite() {
		teardownSurfaces();
	}

	// Changing which sources are on changes what the thread is, not what the page
	// is. With the panel open it is re-rendered in place behind the same cross-fade
	// the front-page swap uses: the comments go, the new ones arrive as they load.
	//
	// It used to tear the panel down and re-run the page pass, which was wrong
	// twice over. The reader lost their place mid-checkbox, and the pass could take
	// a branch that produced neither a sidebar nor a button -- so turning a source
	// off could leave the page with nothing on it at all until a reload.
	//
	// Same contract as teardownForBlockedSite: persist before calling.
	async function refreshForSourceChange() {
		if (isSidebarVisible() && sidebarUI) {
			await refreshDiscussionsInPlace(sidebarUI);
			return;
		}

		// No panel to preserve -- the settings panel in the submit popover can reach
		// here too -- so the whole page decision is re-run to update the button.
		//
		// runPagePass, not init: init installs the soft-navigation watcher, which
		// wraps history.pushState, adds a popstate listener and starts an interval,
		// none of them guarded. Calling it per toggle stacked a poller every time.
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

				// Nothing enabled is a state, not an error: the panel offers the
				// picker rather than emptying and leaving the reader to guess.
				// Nothing enabled is a state the reader chose, and the picker is how
				// they undo it -- so the panel stays and offers it rather than
				// vanishing and leaving them to find the grey button.
				if (!enabledSourceIds(settings, registeredSourceIds()).length) {
					sidebarHasDiscussion = false;
					renderSourcePicker(ui);
					return;
				}

				setSidebarStage(ui, "discussion");

				const discussions = await discoverAll(location.href, settings);

				if (generation !== sidebarGeneration) {
					return;
				}

				// No source turned anything up, which is exactly what a page with no
				// discussion has always looked like: the grey button, offering to
				// submit. Keeping the panel open around a message would be a third
				// state that says less than the button it replaced.
				if (!discussions.length) {
					sidebarHasDiscussion = false;
					teardownSurfaces();
					await runPagePass();
					return;
				}

				sidebarHasDiscussion = true;
				setSidebarStage(ui, "comments");
				await renderDiscussions(discussions, ui);

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


	// Shared by both headers. Persists before tearing down, because the teardown
	// destroys the surface this was clicked in.
	async function hideCurrentSite() {
		const sites = await loadBlockedSites();

		sites.add(siteKey());
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

		// Re-applying a filter that is already open, not entering one. Must not
		// scroll: annotations refresh on resize and on setting changes, and each
		// refresh would otherwise yank the reader back to the banner.
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

	// Three feeds because none is sufficient alone: patching history is instant but
	// only lands where the manager's sandbox shares the page's History object,
	// popstate covers only back and forward, and the poll catches the rest.
	let softNavigationWatched = false;

	function watchSoftNavigation() {
		// Wraps history methods, adds a popstate listener and starts an interval,
		// none of which can be undone. Installing it twice leaves two pollers racing
		// on the same page, so it installs once per document however often it is
		// asked for.
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

		// On HN, only record clicked stories, offer the queue, and service popup
		// bridge actions.
		if (location.hostname === "news.ycombinator.com") {
			setupHNListener();

			// Deliberately not awaited and deliberately before the bridge checks: it
			// touches only rows that exist, so a bridge page simply has none, and
			// making the bridge wait on a storage read would slow every vote.
			setupHNQueueLinks().catch(console.error);

			// Order matters: after a bridge navigation the hash is gone and the payload
			// is in sessionStorage, so every post-action report has to be checked before
			// treating this page as a fresh bridge request.
			if (reportItemActionAfterReload()) {
				return;
			}

			if (reportSubmitResultAfterReload()) {
				return;
			}

			if (reportCommentResultAfterReload()) {
				return;
			}

			if (maybeHandleHNItemAction()) {
				return;
			}

			// Both are async because the staged payload lives in GM storage rather than
			// the URL fragment, so they cannot be tested with a plain if.
			if (await maybeHandleHNSubmitBridge()) {
				return;
			}

			await maybeHandleHNCommentBridge();

			// A queued Ask HN or a Show HN with no link resolves to an item page on
			// this very host, so reading one is an arrival like any other -- but the
			// arrival check lives in runPagePass, which this branch returns before.
			// Without this they stay unread for good: the count never falls and the
			// strip keeps offering something already read.
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

	// Split from init so a soft navigation can ask again. What stays above it --
	// the storage migration, the HN bridge -- belongs to the document rather than
	// to the page it is currently showing.
	async function runPagePass() {
		// After the HN branch, which has to keep working because the bridge popups run
		// there, and before anything else: no lookup, no button, no stored state on a
		// page that could never be a submission in the first place.
		if (isHiddenSite()) {
			return;
		}

		// Four independent reads, run together rather than one after another in front
		// of the first paint. The blocked-site check is one of them: it is a read of
		// our own storage like the rest, so resolving it alongside them costs nothing
		// and still gates everything that follows.
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

		// Arriving somewhere the queue was holding marks it read. Below the blocked
		// and hidden checks with everything else that writes, and not awaited: this
		// is bookkeeping about a list the reader is not currently looking at, and
		// nothing on this page waits on the answer.
		markQueueArrival().catch(console.error);

		// Deliberately not in the batch above: this one prunes expired votes and
		// therefore writes, which a blocked site must never trigger. Started here and
		// awaited below, so it overlaps the button rather than delaying it.
		const votesReady = Promise.all([
			loadRememberedVotes(),
			loadRememberedItemActions(),
		]);

		// "Only show the button when a discussion exists" was chosen before there
		// was a queue to reach through that button, and taken literally it now hides
		// the only way to something the reader put there themselves. Its sub-option
		// says so: hide it, except when something is waiting.
		const hideButton =
			settings.hideWithoutDiscussion &&
			!(settings.showButtonWithQueue && unreadQueueCount(await loadQueue()));

		// Nothing enabled means nothing is looked up: no Algolia, no Firebase, no
		// requests at all. The button stops being a discussion indicator, because
		// there is no discussion to indicate, and becomes the way into the picker.
		if (!enabledSourceIds(settings, registeredSourceIds()).length) {
			if (!hideButton) {
				await createSetupButton();
			}

			return;
		}

		// Drawn before the lookup, so the page shows something immediately and the
		// ring covers whatever comes next. Skipped when the reader has asked for no
		// button without a discussion, because then it might correctly never appear
		// and would flicker in and back out.
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

		if (
			last &&
			sameURL(last.url, location.href) &&
			Date.now() - last.timestamp < 300000
		) {
			await save(STORAGE.last, null);

			settleButtonToDiscussion(pendingButton);

			// Reaching this branch is itself an arrival from HN: the click that
			// recorded it happened on HN, on a link to this URL. Stated rather than
			// re-derived from the referrer, which some browsers withhold entirely.
			await presentDiscussion(
				last.ids.map((id) => ({ objectID: id })),
				settings,
				siteState,
				true,
			);

			return;
		}

		// Otherwise look the URL up now rather than on click. 1.5.3 makes the button's
		// colour mean "a discussion exists", which is only answerable before it is
		// drawn. Each source caches per URL for an hour, so this is one request per
		// source per new page rather than one per visit.
		const stories = await discoverAll(location.href, settings);

		const requestedOpen = takeRequestedOpen();

		if (stories.length) {
			settleButtonToDiscussion(pendingButton);

			// A press outranks every automatic rule, including the per-site memory --
			// that is about what the reader did here last time, and this is what they
			// are doing now. Recorded like any other open they asked for.
			if (requestedOpen) {
				destroyFloatingButton(document.getElementById(BUTTON_PENDING_ID));
				// Passed whole rather than reduced to ids. A Reddit discussion cannot
				// be rebuilt from an HN item number, and reducing these to refs was
				// what made that impossible.
				await openSidebar(stories);
				return;
			}

			await presentDiscussion(
				stories,
				settings,
				siteState,
				arrivedFromHNReferrer,
			);
			return;
		}

		// Nothing on HN for this page, but the panel has not been only about this
		// page since the front page and the queue went behind it -- and that is what
		// a reader who pressed the button while it was still looking asked to see.
		if (requestedOpen) {
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

			// Records nothing: the script opened this, not the reader. Per-site memory
			// now means "what I did here by hand", which is the only reading under
			// which it can be trusted once the setting is turned off again.
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
