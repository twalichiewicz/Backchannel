// ==UserScript==
// @name         HNewhere
// @namespace    https://github.com/twalichiewicz/HNewhere
// @version      1.4.7
// @updateURL    https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @downloadURL  https://raw.githubusercontent.com/twalichiewicz/HNewhere/main/HNewhere.user.js
// @homepageURL  https://github.com/twalichiewicz/HNewhere
// @supportURL   https://github.com/twalichiewicz/HNewhere/issues
// @description  Hacker News comments sidebar for any article
// @include      http://*
// @include      https://*
// @exclude http://localhost/*
// @exclude https://localhost/*
// @exclude      https://www.google.com/*
// @exclude      https://www.google.*/*
// @exclude      https://chatgpt.com/
// @exclude      https://claude.ai/
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
			for (const key of Object.keys(STORAGE)) {
				const oldValue = await load(OLD_STORAGE[key], null);

				if (oldValue !== null) {
					await save(STORAGE[key], oldValue);
				}
			}

			await save("HNewhere:migrated", 1);
		} catch (e) {
			console.error("HNewhere migration failed:", e);
		}
	}

	const STORAGE = {
		width: "HNewhere:width",
		position: "HNewhere:button_position",
		last: "HNewhere:last",
		collapsed: "HNewhere:collapsed_comments",
		seen: "HNewhere:seen_comments",
	};

	let sidebar = null;
	let opening = false;
	let sidebarGeneration = 0;

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

	const itemCache = new Map();

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

	async function findHN(url) {
		const target = normalizeURL(url);

		if (!target) {
			return [];
		}

		const cacheKey = "HNewhere:hn_cache:" + target;

		const cached = await load(cacheKey, null);

		if (cached && Date.now() - cached.timestamp < 3600000) {
			return cached.results;
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

		const sorted = [...matches.values()].sort(
			(a, b) => b.created_at_i - a.created_at_i,
		);

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

			[
				"utm_source",
				"utm_medium",
				"utm_campaign",
				"utm_term",
				"utm_content",
				"fbclid",
				"gclid",
			].forEach((param) => u.searchParams.delete(param));

			return (
				u.hostname +
				u.pathname.replace(/\/$/, "") +
				u.search
			).toLowerCase();
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

	function timeAgo(timestamp) {
		if (!timestamp) return "";

		const seconds = Math.floor(Date.now() / 1000 - timestamp);

		if (seconds < 60) return "just now";

		const minutes = Math.floor(seconds / 60);

		if (minutes < 60) return minutes + " minutes ago";

		const hours = Math.floor(minutes / 60);

		if (hours < 24) return hours + " hours ago";

		const days = Math.floor(hours / 24);

		return days === 1 ? "1 day ago" : days + " days ago";
	}

	function isNewComment(comment, seenTimestamp) {
		return comment.time && comment.time > seenTimestamp;
	}

	function isMobile() {
		return window.matchMedia("(max-width: 700px)").matches;
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
		return "https://news.ycombinator.com/item?id=" + storyID;
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

				// Clear after the browser has finished dispatching click.
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

		return () => suppressClick;
	}

	async function createRestoreButton() {
		let button = document.getElementById("hn-restore-button");

		if (button) return button;

		button = document.createElement("button");
		button.id = "hn-restore-button";
		button.textContent = "HN";

		button.style.cssText = `
			position:fixed;
			top:12px;
			right:12px;
			z-index:2147483647;
			background:#ff6600;
			color:white;
			border:none;
			border-radius:3px;
			padding:4px 8px;
			font-family:Verdana,sans-serif;
			font-size:11px;
			font-weight:bold;
			cursor:pointer;
			box-shadow:0 1px 4px rgba(0,0,0,.25);
			user-select:none;
			touch-action:none;
			-webkit-tap-highlight-color:transparent;
		`;

		if (isMobile()) {
			Object.assign(button.style, {
				width: "44px",
				height: "44px",
				padding: "0",
				borderRadius: "50%",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontSize: "13px",
				top: "16px",
				right: "16px",
			});
		}

		document.body.appendChild(button);

		await applyButtonPosition(button);

		const wasMoved = makeButtonDraggable(button);

		button.onclick = () => {
			if (wasMoved()) return;

			if (sidebar) {
				sidebar.style.display = "";
			}

			button.remove();
		};

		return button;
	}

	async function createCollapsedButton(stories) {
		let button = document.getElementById("hn-collapse-button");
		if (button) return button;

		button = document.createElement("button");
		button.id = "hn-collapse-button";
		button.textContent = "HN";

		button.style.cssText = `
			position:fixed;
			top:12px;
			right:12px;
			z-index:2147483647;
			background:#ff6600;
			color:white;
			border:none;
			border-radius:3px;
			padding:4px 8px;
			font-family:Verdana,sans-serif;
			font-size:11px;
			font-weight:bold;
			cursor:pointer;
			box-shadow:0 1px 4px rgba(0,0,0,.25);
			user-select:none;
			touch-action:none;
			-webkit-tap-highlight-color: transparent;
		`;

		if (isMobile()) {
			button.style.width = "44px";
			button.style.height = "44px";
			button.style.padding = "0";
			button.style.borderRadius = "50%";
			button.style.display = "flex";
			button.style.alignItems = "center";
			button.style.justifyContent = "center";
			button.style.fontSize = "13px";
			button.style.top = "16px";
			button.style.right = "16px";
		}

		document.body.appendChild(button);

		await applyButtonPosition(button);

		const wasMoved = makeButtonDraggable(button);

		button.onclick = () => {
			if (wasMoved()) return;

			button.remove();
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

		const savedWidth = await load(STORAGE.width, 420);

		const width = Math.min(Math.max(savedWidth, 280), window.innerWidth * 0.8);

		const host = document.createElement("div");
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
    min-width:280px;
    max-width:80vw;
    background:#f6f6ef;
    color:#000;
    z-index:2147483646;
    display:flex;
    flex-direction:column;
    border-left:1px solid #ccc;
    box-shadow:-3px 0 12px rgba(0,0,0,.15);
    font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
    font-size:13px;
}

header {
    background:#ff6600;
    color:black;
    padding:6px 8px;
    display:flex;
    justify-content:space-between;
    align-items:center;
    font-weight:bold;
}

header button {
    background:none;
    border:0;
    color:black;
    cursor:pointer;
    font-size:16px;
}

.submission {
    margin:16px 0;
    padding-top:12px;
}

.submission + .submission {
    border-top:1px solid #ccc;
}

#comments {
	flex:1 1 auto;
	min-height:0;
    overflow:auto;
    overflow-x:hidden;
	overscroll-behavior:contain;
    padding:8px 12px;
    word-wrap:break-word;
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
	border-left:2px solid #ff6600;
	padding-left:6px;
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

.meta a:hover {
    text-decoration:underline;
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
}

.story-title a {
    color:#000;
    text-decoration:none;
}

.story-meta {
    color:#828282;
    font-size:10px;
    line-height:1.4;
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
}

.story-actions button {
    font-family:Verdana, Geneva, sans-serif;
    font-size:11px;
    cursor:pointer;
}

</style>

<div id="panel">

<header>

<span>
<b>HN</b>ewhere
</span>

<button id="minimize">
−
</button>

</header>

<div id="comments">
Loading...
</div>

</div>
`;

		const panel = shadow.querySelector("#panel");

		// Stop scroll/touch events moving out of sidebar so sites with
		// JS scroll hijacking (wheel listeners on window) don't scroll behind
		for (const type of ["wheel", "touchmove"]) {
			host.addEventListener(type, (event) => event.stopPropagation());
		}

		let resizing = false;
		let startX = 0;
		let startWidth = 0;

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
				window.innerWidth * 0.8,
			);

			panel.style.width = newWidth + "px";

			clearTimeout(resizeTimer);

			resizeTimer = setTimeout(() => {
				if (!destroyed) {
					save(STORAGE.width, newWidth);
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

		const clampSidebarWidth = () => {
			const maxWidth = window.innerWidth * 0.8;

			if (panel.offsetWidth > maxWidth) {
				panel.style.width = maxWidth + "px";
				save(STORAGE.width, maxWidth);
			}
		};

		window.addEventListener("resize", clampSidebarWidth);

		host._cleanup = () => {
			destroyed = true;
			clearTimeout(resizeTimer);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("resize", clampSidebarWidth);
		};

		shadow.querySelector("#minimize").onclick = async () => {
			host.style.display = "none";

			const restore = await createRestoreButton();

			restore.onclick = () => {
				host.style.display = "";
				restore.remove();
			};
		};

		document
			.querySelectorAll("#hn-restore-button, #hn-collapse-button")
			.forEach((button) => button.remove());

		sidebar = host;

		return {
			shadow,
			body: shadow.querySelector("#comments"),
		};
	}

	// -------------------------
	// Story rendering
	// -------------------------

	function renderStory(story, container, options = {}) {
		if (!story?.id) {
			return;
		}

		const hnURL = commentURL(story.id);

		const wrapper = document.createElement("div");
		wrapper.innerHTML = `

<div class="story">

<div class="story-title">

<a target="_blank"
href="${escapeHTML(hnURL)}"
title="Open discussion on Hacker News">

${escapeHTML(story.title)}

</a>
</div>

<div class="story-meta">

${story.score || 0} points by

${escapeHTML(story.by || "")}

|

${timeAgo(story.time)}

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
</div>

<br>

`;
		const storyElement = wrapper.firstElementChild;
		container.appendChild(storyElement);

		storyElement.querySelector(".add-comment").onclick = () => {
			openHNWindow(commentURL(story.id));
		};
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
	) {
		const comment = await getItem(id);

		if (generation !== sidebarGeneration) {
			return;
		}

		if (!comment || comment.deleted || comment.dead) return;
		const div = document.createElement("div");

		div.className = "comment";

		if (isNewComment(comment, seenTime)) {
			div.classList.add("new-comment");
		}

		const replies = comment.kids || [];
		const reply = replyURL(comment, storyID);

		div.innerHTML = `
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

      ${timeAgo(comment.time)}

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
    `;

		container.appendChild(div);

		const content = div.querySelector(".comment-content");
		const children = div.querySelector(".children");
		const toggle = div.querySelector(".toggle");

		if (collapsedIds.has(comment.id)) {
			content.classList.add("hidden");
			toggle.textContent = "[+]";
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
			);
		}
	}

	// -------------------------
	// Discussion loading
	// -------------------------

	async function renderSingleDiscussion(story, ui) {
		ui.body.innerHTML = "";

		renderStory(story, ui.body);

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
	}

	async function renderBlendedDiscussion(stories, ui) {
		ui.body.innerHTML = "";

		for (const story of stories) {
			const section = document.createElement("div");
			section.className = "submission";

			ui.body.appendChild(section);

			renderStory(story, section, {
				multiple: true,
				stories,
			});

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

		return items
			.filter((item) => item && item.type === "story")
			.sort((a, b) => b.time - a.time);
	}

	// -------------------------
	// Open sidebar
	// -------------------------
	function normalizeStories(stories) {
		return stories.map((story) =>
			typeof story === "string" ? { objectID: story } : story,
		);
	}

	async function openSidebar(stories) {
		if (opening) return;

		opening = true;

		try {
			const loaded = await loadStories(stories);

			if (!loaded.length) {
				throw new Error("No HN stories could be loaded");
			}

			const generation = ++sidebarGeneration;
			const ui = await createSidebar();

			if (generation !== sidebarGeneration) {
				return;
			}

			if (loaded.length === 1) {
				await renderSingleDiscussion(loaded[0], ui);
			} else {
				await renderBlendedDiscussion(loaded, ui);
			}
		} catch (e) {
			console.error(e);
		} finally {
			opening = false;
		}
	}

	// -------------------------
	// Hacker News click tracking
	// -------------------------

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

	// -------------------------
	// Initialization
	// -------------------------

	async function init() {
		await migrateStorage();

		// On HN, only record clicked stories.
		if (location.hostname === "news.ycombinator.com") {
			setupHNListener();
			return;
		}

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

			await openSidebar(
				last.ids.map((id) => ({
					objectID: id,
				})),
			);

			return;
		}

		// Otherwise, silently check if this URL
		// already has an HN discussion.
		const stories = await findHN(location.href);

		if (stories.length) {
			if (isMobile()) {
				await createCollapsedButton(stories);
			} else {
				await openSidebar(
					stories.map((story) => ({
						objectID: story.objectID,
					})),
				);
			}
		}
	}

	init().catch(console.error);
})();
