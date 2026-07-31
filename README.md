# HNewhere

<img width="1085" height="1006" alt="SCR-20260728-ndit" src="https://github.com/user-attachments/assets/e5d46dba-d099-416c-a10a-0177c403ff56" />

A lightweight userscript that adds Hacker News discussions to any article.

HNewhere detects matching Hacker News stories, loads comments into a sidebar, and lets you browse discussions without leaving the page.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Userscripts (Safari)](https://apps.apple.com/us/app/userscripts/id1463298887)

2. [Install HNewhere](https://raw.githubusercontent.com/twalichiewicz/HNewhere/refs/heads/main/HNewhere.user.js) Current release: `v1.5.4`

3. Visit an article with a Hacker News discussion.

## Features

- Automatically detects Hacker News discussions for articles
- Displays HN comments in a sidebar without leaving the page
- Quote-linked article annotations while the sidebar is open
- Discussion heat: an ambient wash over passages several commenters are discussing, even when nobody quoted them
- Subtle clickable article highlights and underlines for matched quotes
- Clickable cited text inside matched comments that jumps back to the article and filters the discussion
- Comments can link multiple cited passages from the same article
- Clicking an article annotation can filter the sidebar to the matching comment thread
- Filtered discussion view with a pull-quote summary, direct-match navigator, and quick return to the full thread
- In blended views, filtered mode hides HN submissions that do not contain a matching quote
- Comment and reply straight from the sidebar, with Hacker News' own formatting rules to hand
- Submit the current page to Hacker News when no discussion exists yet
- Theme that matches the page, or is pinned to light or dark, so it works with Dark Reader and site themes
- Adjustable HN button: circle or squircle, 24px to 64px, with a live preview
- Hide HNewhere on any site, with a managed list of hidden sites to undo it later
- Greyed-out button on pages with no discussion, or hidden entirely if you prefer
- Stays out of the way on webmail, banking, auth flows, consoles, and local addresses
- Vote on stories and comments without leaving the article
- Tracks stories opened from Hacker News
- Resizable sidebar with saved width
- Draggable floating HN button with remembered desktop position
- Collapsible comment threads with saved state
- Highlights new comments since your last visit
- Shows story text when available
- Marks original poster comments
- Blended view when multiple matching HN submissions exist
- Sidebar settings for annotation layers and automatic opening behavior

## Requirements

- A browser with userscript support
- Access to:
  - Hacker News API
  - HN Algolia search API

## Contributing

Bug reports and pull requests are welcome. HNewhere is a single file with no
build step or dependencies: edit `HNewhere.user.js`, load it in your userscript
manager, and what you see is what users install. Release history is in
[CHANGELOG.md](CHANGELOG.md).

To report something security-sensitive, see [SECURITY.md](SECURITY.md), which
also documents what the script can access and the limits placed on it.

## License

MIT
