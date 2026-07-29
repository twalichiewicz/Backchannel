# HNewhere

<img width="1085" height="1006" alt="SCR-20260728-ndit" src="https://github.com/user-attachments/assets/e5d46dba-d099-416c-a10a-0177c403ff56" />

A lightweight userscript that adds Hacker News discussions to any article.

Current release: `v1.5.0`

HNewhere detects matching Hacker News stories, loads comments into a sidebar, and lets you browse discussions without leaving the page.

In `v1.5.0`, the sidebar can also project matched discussion context back into the article with quote-linked annotations that disappear when the sidebar is closed.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Userscripts (Safari)](https://apps.apple.com/us/app/userscripts/id1463298887)

2. [Install HNewhere](https://raw.githubusercontent.com/twalichiewicz/HNewhere/refs/heads/main/HNewhere.user.js)

3. Visit an article with a Hacker News discussion.

## Features

- Automatically detects Hacker News discussions for articles
- Displays HN comments in a sidebar without leaving the page
- Quote-linked article annotations while the sidebar is open
- Subtle clickable article highlights and underlines for matched quotes
- Clickable cited text inside matched comments that jumps back to the article and filters the discussion
- Comments can link multiple cited passages from the same article
- Clicking an article annotation can filter the sidebar to the matching comment thread
- Filtered discussion view with a pull-quote summary, direct-match navigator, and quick return to the full thread
- In blended views, filtered mode hides HN submissions that do not contain a matching quote
- Tracks stories opened from Hacker News
- Resizable sidebar with saved width
- Draggable floating HN button with remembered desktop position
- Collapsible comment threads with saved state
- Highlights new comments since your last visit
- Shows story text when available
- Marks original poster comments
- Reply links open directly to Hacker News
- Blended view when multiple matching HN submissions exist
- Sidebar settings for annotation layers and automatic opening behavior

## Requirements

- A browser with userscript support
- Access to:
  - Hacker News API
  - HN Algolia search API

## License

MIT
