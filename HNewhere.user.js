// ==UserScript==
// @name         HNewhere
// @namespace    https://github.com/twalichiewicz/HNewhere
// @version      1.5
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
// @exclude      https://chatgpt.com/*
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

	const STORAGE = {
		width: "hn_width",
		position: "hn_button_position",
		last: "hn_last",
	};

	let sidebar = null;
	let opening = false;

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

	// -------------------------
	// Network
	// -------------------------

	function request(url) {
		return new Promise((resolve, reject) => {
			GM.xmlHttpRequest({
				method: "GET",

				url: url,

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
			});
		});
	}

	async function getItem(id) {
		return request(
			"https://hacker-news.firebaseio.com/v0/item/" + id + ".json",
		);
	}

	async function findHN(url) {
		const target = normalizeURL(url);

		const queries = [url, target];

		const matches = new Map();

		for (const query of queries) {
			const result = await request(
				"https://hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=100&query=" +
					encodeURIComponent(query),
			);

			if (!result || !result.hits) continue;

			result.hits.forEach((item) => {
				if (normalizeURL(item.url) === target) {
					matches.set(item.objectID, item);
				}
			});
		}

		return [...matches.values()].sort(
			(a, b) => b.created_at_i - a.created_at_i,
		);
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

		template.content
			.querySelectorAll("script, iframe, object, embed")
			.forEach((el) => el.remove());

		template.content.querySelectorAll("*").forEach((el) => {
			for (const attr of [...el.attributes]) {
				if (attr.name.startsWith("on")) {
					el.removeAttribute(attr.name);
				}
			}

			el.removeAttribute("style");

			for (const attr of ["href", "src"]) {
				const value = el.getAttribute(attr);

				if (value && /^(javascript|data):/i.test(value)) {
					el.removeAttribute(attr);
				}
			}
		});

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

	function isMobile() {
		return window.matchMedia("(max-width: 700px)").matches;
	}

	function clampButtonPosition(button) {
		const maxX = window.innerWidth - button.offsetWidth;
		const maxY = window.innerHeight - button.offsetHeight;

		const currentX = parseInt(button.style.left || button.offsetLeft, 10);
		const currentY = parseInt(button.style.top || button.offsetTop, 10);

		const x = Math.max(0, Math.min(currentX, maxX));
		const y = Math.max(0, Math.min(currentY, maxY));

		button.style.left = x + "px";
		button.style.top = y + "px";
		button.style.right = "auto";
	}

	// -------------------------
	// Article annotations
	// -------------------------

	const annotations = {
		markers: new Map(),
		comments: new Map(),
	};

	function normalizeText(text) {
		return (text || "")
			.replace(/<[^>]+>/g, " ")
			.replace(/[“”‘’"]/g, '"')
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
	}

	function extractQuotes(html) {
		if (!html) return [];

		const div = document.createElement("div");
		div.innerHTML = html;

		const quotes = [];

		function addQuote(text, priority = 0) {
			const normalized = normalizeText(text);

			if (normalized.length < 30) {
				return;
			}

			// Avoid common non-article conversational text
			if (
				/^(thanks|interesting|i agree|good point|nice|lol|haha)/i.test(
					normalized,
				)
			) {
				return;
			}

			// Long quotes are fragile. Break into searchable chunks.
			if (normalized.length > 300) {
				const sentences = normalized.match(/[^.!?]+[.!?]+/g);

				if (sentences) {
					sentences.forEach((sentence) => {
						const s = normalizeText(sentence);

						if (s.length >= 50) {
							quotes.push({
								text: s,
								priority,
							});
						}
					});
				}

				return;
			}

			quotes.push({
				text: normalized,
				priority,
			});
		}

		//
		// 1. Real HTML blockquotes
		//
		div.querySelectorAll("blockquote").forEach((el) => {
			addQuote(el.textContent, 3);
		});

		//
		// Preserve original line structure before normalization.
		// HN renders quoted text as:
		// > something someone said
		//
		const rawText = div.textContent || "";

		const lines = rawText
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);

		//
		// 2. Markdown/HN quote blocks
		//
		let quoteBuffer = [];

		for (const line of lines) {
			if (line.startsWith(">")) {
				quoteBuffer.push(line.replace(/^>\s*/, ""));
			} else if (quoteBuffer.length) {
				addQuote(quoteBuffer.join(" "), 3);

				quoteBuffer = [];
			}
		}

		if (quoteBuffer.length) {
			addQuote(quoteBuffer.join(" "), 3);
		}

		//
		// 3. Explicit quoted strings
		//
		for (const match of rawText.matchAll(/["“](.{30,}?)["”]/gs)) {
			addQuote(match[1], 2);
		}

		//
		// 4. Single quotes
		//
		for (const match of rawText.matchAll(/['‘](.{40,}?)['’]/gs)) {
			addQuote(match[1], 1);
		}

		//
		// 5. Long standalone comment lines
		// Catch comments like:
		// "The article says..."
		//
		lines.forEach((line) => {
			const cleaned = line.replace(/^>\s*/, "");

			if (cleaned.length >= 100 && !/^https?:\/\//i.test(cleaned)) {
				addQuote(cleaned, 0);
			}
		});

		//
		// Rank longer/more explicit quotes first.
		// Deduplicate after ranking.
		//
		const seen = new Set();

		return quotes
			.sort((a, b) => {
				if (b.priority !== a.priority) {
					return b.priority - a.priority;
				}

				return b.text.length - a.text.length;
			})
			.map((q) => q.text)
			.filter((q) => {
				if (seen.has(q)) {
					return false;
				}

				seen.add(q);
				return true;
			});
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
        -webkit-tap-highlight-color: transparent;
    `;

		document.body.appendChild(button);

		await applyButtonPosition(button);
		makeButtonDraggable(button);

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
    overflow:auto;
    overflow-x:hidden;
    padding:8px 12px;
    word-wrap:break-word;
}

.comment {
    margin:12px 0 12px 15px;
    max-width:100%;
    overflow-wrap:anywhere;
}

.top-level-comments > .comment {
    margin-left:0;
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

		host._cleanup = () => {
			destroyed = true;
			clearTimeout(resizeTimer);
			document.removeEventListener("mousemove", onMouseMove);
			document.removeEventListener("mouseup", onMouseUp);
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
		const { multiple = false, stories = [] } = options;

		const url = story.url || "https://news.ycombinator.com/item?id=" + story.id;

		const wrapper = document.createElement("div");
		wrapper.innerHTML = `

<div class="story">

<div class="story-title">

<a target="_blank"
href="${escapeHTML(url)}">

${escapeHTML(story.title)}

</a>
</div>

<div class="story-meta">

${story.score || 0} points by

${escapeHTML(story.by || "")}

|

${timeAgo(story.time)}
</div>

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

	async function renderComment(id, container, storyID) {
		const comment = await getItem(id);

		if (!comment || comment.deleted || comment.dead) return;

		const div = document.createElement("div");

		div.className = "comment";

		const replies = comment.kids || [];

		const reply = replyURL(comment, storyID);

		div.innerHTML = `

<div class="meta">


<a target="_blank"
href="https://news.ycombinator.com/user?id=${encodeURIComponent(comment.by || "")}">

${escapeHTML(comment.by || "anonymous")}

</a>


${timeAgo(comment.time)}

|

<a class="reply-link"
href="#">
reply
</a>

<span class="toggle">
[–]
</span>
</div>

<div class="text">
<div class="children">
${sanitizeHTML(comment.text) || ""}
</div>
</div>

`;

		div._quotes = extractQuotes(comment.text);

		container.appendChild(div);

		annotations.comments.set(comment.id, div);
		div.dataset.commentId = comment.id;

		const children = div.querySelector(".children");
		const toggle = div.querySelector(".toggle");

		toggle.onclick = () => {
			children.classList.toggle("hidden");
			toggle.textContent = children.classList.contains("hidden")
				? "[+]"
				: "[–]";
		};

		const replyButton = div.querySelector(".reply-link");

		replyButton.onclick = function (event) {
			event.preventDefault();

			openHNWindow(reply);
		};

		for (let i = 0; i < replies.length; i++) {
			await renderComment(replies[i], children, storyID);

			if (i > 0 && i % 10 === 0) {
				await new Promise(requestAnimationFrame);
			}
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

		for (const child of story.kids || []) {
			await renderComment(child, comments, story.id);
		}
		annotateArticle();
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

			for (const child of story.kids || []) {
				await renderComment(child, comments, story.id);
			}
		}
		annotateArticle();
	}

	function buildArticleIndex() {
		const walker = document.createTreeWalker(
			document.body,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node) {
					if (!node.textContent.trim()) {
						return NodeFilter.FILTER_REJECT;
					}

					if (
						node.parentElement.closest("#hn-collapse-button,#hn-restore-button")
					) {
						return NodeFilter.FILTER_REJECT;
					}

					if (node.parentElement.closest("script,style,noscript")) {
						return NodeFilter.FILTER_REJECT;
					}

					if (node.parentElement.closest(".hn-annotation")) {
						return NodeFilter.FILTER_REJECT;
					}

					return NodeFilter.FILTER_ACCEPT;
				},
			},
		);

		const map = [];
		let normalized = "";

		function normalizeWithMap(text, node) {
			const localMap = [];
			let localNormalized = "";

			for (let i = 0; i < text.length; i++) {
				const char = text[i].toLowerCase();

				if (/\s/.test(char)) {
					if (
						localNormalized.length &&
						localNormalized[localNormalized.length - 1] !== " "
					) {
						localMap.push({
							rawNode: node,
							rawOffset: i,
						});

						localNormalized += " ";
					}
				} else {
					localMap.push({
						rawNode: node,
						rawOffset: i,
					});

					localNormalized += char;
				}
			}

			return {
				normalized: localNormalized,
				map: localMap,
			};
		}

		let node;

		while ((node = walker.nextNode())) {
			const result = normalizeWithMap(node.textContent, node);

			const start = normalized.length;

			normalized += result.normalized;

			result.map.forEach((entry, i) => {
				map[start + i] = entry;
			});
		}

		return {
			normalized,
			map,
		};
	}

	function annotateArticle() {
		const article = buildArticleIndex();

		if (!article.normalized.length) {
			return;
		}

		const usedRanges = [];

		for (const comment of annotations.comments.values()) {
			const quotes = comment._quotes || [];

			for (const quote of quotes) {
				const normalizedQuote = normalizeText(quote);

				if (normalizedQuote.length < 60) {
					continue;
				}

				// Try longer matches first, then progressively relax.
				const candidates = [
					normalizedQuote.substring(0, 160),
					normalizedQuote.substring(0, 120),
					normalizedQuote.substring(0, 80),
				];

				let index = -1;

				for (const candidate of candidates) {
					if (candidate.length < 60) {
						continue;
					}

					index = article.normalized.indexOf(candidate);

					if (index !== -1) {
						break;
					}
				}

				if (index === -1) {
					continue;
				}

				const start = index;
				const end = index + normalizedQuote.length;

				// Avoid stacking multiple annotations over the same text.
				const overlaps = usedRanges.some((range) => {
					return start < range.end && end > range.start;
				});

				if (overlaps) {
					continue;
				}

				usedRanges.push({
					start,
					end,
				});

				highlightApproximateMatch(
					article,
					index,
					Math.min(normalizedQuote.length, article.normalized.length - index),
					comment,
				);

				break;
			}
		}
	}

	function highlightApproximateMatch(article, index, length, comment) {
		const startEntry = article.map[index];
		const endEntry = article.map[index + length - 1];

		if (!startEntry || !endEntry) {
			return;
		}

		highlightRange(article.map, startEntry, endEntry, comment);
	}

	function highlightRange(map, startEntry, endEntry, comment) {
		const range = document.createRange();

		range.setStart(startEntry.rawNode, startEntry.rawOffset);

		range.setEnd(endEntry.rawNode, endEntry.rawOffset + 1);

		const span = document.createElement("span");

		span.className = "hn-annotation";

		span.style.background = "rgba(255,102,0,.18)";
		span.style.borderBottom = "2px solid #ff6600";
		span.style.cursor = "pointer";

		try {
			const fragment = range.extractContents();

			span.appendChild(fragment);
			range.insertNode(span);

			span.onclick = () => {
				comment.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
			};

			const meta = comment.querySelector(".meta");

			if (meta && !meta.querySelector(".article-jump")) {
				const jump = document.createElement("a");

				jump.className = "article-jump";
				jump.href = "#";
				jump.textContent = "article";
				jump.style.marginLeft = "6px";

				jump.onclick = (e) => {
					e.preventDefault();

					span.scrollIntoView({
						behavior: "smooth",
						block: "center",
					});
				};

				meta.appendChild(jump);
			}
		} catch (e) {
			console.error("HN annotation failed", e);
		}
	}

	async function loadStories(stories) {
		const loaded = [];

		for (const story of normalizeStories(stories)) {
			const item = await getItem(story.objectID);

			if (item) {
				loaded.push(item);
			}
		}

		loaded.sort((a, b) => b.time - a.time);
		return loaded;
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
			const ui = await createSidebar();

			const loaded = await loadStories(stories);

			if (!loaded.length) {
				throw new Error("No HN stories could be loaded");
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
					const link = event.target.closest("a");
					if (!link) return;
					const row = link.closest("tr.athing");
					if (!row) return;
					if (!link.closest(".titleline")) return;
					const id = row.id;
					if (!id) return;

					console.log("Saving HN story:", id, link.href);

					await save(STORAGE.last, {
						url: link.href,
						ids: [id],
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
		console.log("HNewhere sidebar loaded", location.href);

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

		console.log("Stored HN click:", last);
		console.log("Current URL:", location.href);
		console.log("Same URL:", last && sameURL(last.url, location.href));
		console.log("Age:", last ? Date.now() - last.timestamp : null);

		if (
			last &&
			sameURL(last.url, location.href) &&
			Date.now() - last.timestamp < 300000
		) {
			console.log("Opening HN discussion from click:", last.ids);

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
			console.log(
				"Found HN discussions:",
				stories.map((s) => s.objectID),
			);

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
