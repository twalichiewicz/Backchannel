```
▄▄▄   ▄▄▄ ▄▄▄    ▄▄▄               ▄▄                      
███   ███ ████▄  ███               ██                      
█████████ ███▀██▄███ ▄█▀█▄ ██   ██ ████▄ ▄█▀█▄ ████▄ ▄█▀█▄ 
███▀▀▀███ ███  ▀████ ██▄█▀ ██ █ ██ ██ ██ ██▄█▀ ██ ▀▀ ██▄█▀ 
███   ███ ███    ███ ▀█▄▄▄  ██▀██  ██ ██ ▀█▄▄▄ ██    ▀█▄▄▄ 

A userscript that tells you when Hacker News has been there.  
```

<a href="https://trendshift.io/repositories/95983?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-95983" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/95983/daily?language=JavaScript" alt="twalichiewicz%2FHNewhere | Trendshift" width="250" height="55"/></a>
                                               
<img width="1161" height="753" alt="A screenshot of Safari on macOS opened to https://john.fun/elevators, with the HNewhere side bar open viewing the comments. The settings dropdown in the sidebar is also open, showing which settings the user currently has enabled." src="https://github.com/user-attachments/assets/8f56269d-a707-4107-9e17-8d1c36e37daa" />

## What it does

- **The web's commentary track:** Avoid the two-tab-tango and conveniently read the community's comments in-context.
- **Never miss a thread:** Every page you land on gets checked against Hacker News, so you find out a discussion exists without going hunting for one.
- **See what they're talking about:** Quotes in the comments get matched back to the article and lit where they sit. Click a highlight to filter the thread to the people discussing that passage; click a quote inside a comment to jump to the sentence it came from.
   - _Currently in beta. Enable Annotations in the settings menu to try it out!_ 
- **Read, then join in:** Vote, reply, and even submit. It uses the Hacker News session you already have, in a popup on news.ycombinator.com. The script never sees your password. 
- **The small things:** Indent guides, OP marking, and new comment highlighting.
- **Yours to adjust:** Button shape and size, sidebar width, theme, which annotation layers show, and a per-site off switch. It's one file with no build step, so if the settings don't cover it, the source is right there.

## What it can see

It runs on every page, so this matters: there's no backend, no analytics, and
no telemetry. Requests go to three hosts: the HN API, Algolia search, and
news.ycombinator.com and nowhere else. Webmail, banking, auth flows, and
cloud consoles are excluded outright. 

Full detail in [SECURITY.md](SECURITY.md).

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Userscripts (Safari)](https://apps.apple.com/us/app/userscripts/id1463298887)

2. [Install HNewhere](https://raw.githubusercontent.com/twalichiewicz/HNewhere/refs/heads/main/HNewhere.user.js)
3. Browse the web as usual. If a thread exists for that page the (HN) button will light up the familiar orange. Clicking it will open the sidebar. Still grey? Nobody's posted it yet-- click to submit it yourself.

## Contributing

Bug reports and pull requests are welcome. Please report anything security-sensitive privately via [SECURITY.md](SECURITY.md). HNewhere is a single file with no
build step or dependencies: edit `HNewhere.user.js`, load it in your userscript
manager, and what you see is what users install. Release history is in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT
