# HNewhere

<img width="1085" height="1006" alt="SCR-20260728-ndit" src="https://github.com/user-attachments/assets/e5d46dba-d099-416c-a10a-0177c403ff56" />

A lightweight userscript that adds Hacker News discussions to any article.

Current release: `v1.5.0`

HNewhere detects matching Hacker News stories, loads comments into a sidebar, and lets you browse discussions without leaving the page.

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
- Tracks stories opened from Hacker News
- Resizable sidebar with saved width
- Draggable floating HN button with remembered desktop position
- Collapsible comment threads with saved state
- Highlights new comments since your last visit
- Shows story text when available
- Marks original poster comments
- Reply links open directly to Hacker News
- Blended view when multiple matching HN submissions exist

## Requirements

- A browser with userscript support
- Access to:
  - Hacker News API
  - HN Algolia search API

## License

MIT
