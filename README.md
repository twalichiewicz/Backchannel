<pre style="font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.17;white-space:pre;background-color:#000;color:#fff;padding:8px;margin:0;"><span style="color:#FFFFFF">▀▀▀▀▄</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">▀▀▀▄</span><span style="color:#AAAAAA">  </span><span style="color:#FFFFFF">▀▀▀▀▀</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█  ▄▀</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">▀▀▀▀▀</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">▀▀▀▄</span><span style="color:#AAAAAA">  </span><span style="color:#FFFFFF">▀▀▀▄</span><span style="color:#AAAAAA">  </span><span style="color:#FFFFFF">▀▀▀▄</span><span style="color:#AAAAAA">  </span><span style="color:#FFFFFF">▀▀▀▀▀</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█</span><span style="color:#AAAAAA">   </span>
<span style="color:#FFFFFF">█ ▀▀▄</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█ ▀▀█</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█</span><span style="color:#AAAAAA">     </span><span style="color:#FFFFFF">█ ▀█</span><span style="color:#AAAAAA">  </span><span style="color:#FFFFFF">█</span><span style="color:#AAAAAA">     </span><span style="color:#FFFFFF">█ ▀▀█</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█ ▀▀█</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█ ▀</span><span style="color:#AAAAAA">   </span><span style="color:#FFFFFF">█</span><span style="color:#AAAAAA">   </span>
<span style="color:#FFFFFF">█ ▄▄█</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█▄▄▄▄</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█▄▄▄▄</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█   █</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF"> ▀▄▄▄</span><span style="color:#AAAAAA"> </span><span style="color:#FFFFFF">█▄▄▄</span></pre>

```
See what everyone's talking about.  
```

<a href="https://trendshift.io/repositories/95983?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-95983" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/95983/daily?language=JavaScript" alt="twalichiewicz%2FBackchannel | Trendshift" width="250" height="55"/></a>
                                               
<img width="1305" height="887" alt="A screenshot of Safari on macOS opened to https://www.seangoedecke.com/llms-reward-expertise/, with the HNewhere side bar open viewing the comments. The settings dropdown in the sidebar is also open, showing which settings the user currently has enabled." src="https://github.com/user-attachments/assets/f50131fc-fa6b-4e25-a5dd-9c44ceae1bc5" />


## What it does

- **The web's commentary track:** Avoid the two-tab-tango and conveniently read the community's comments in-context.
- **Never miss a thread:** Every page you land on gets checked against the sources you've picked, so you find out a discussion exists without going hunting for one.
- **What the internet is saying, in one thread:** Hacker News, Bluesky, and Reddit merged into a single conversation, each comment quietly noting where it came from. Pick your sources with a checkbox.
- **See what they're talking about:** Quotes in the comments get matched back to the article and lit as annotations in articles. Click a highlight to filter the thread to the people discussing that passage.
   - _Currently in beta. Enable Annotations in the settings menu to try it out!_ 
- **Read, then join in:** Vote, reply, and even submit on supported sources. It uses the session you already have, in a popup on news.ycombinator.com. The script never sees your password.
- **New front page of the internet**: Blend together all of your added sources to create a custom front page to find new articles to read.
- **Quality of life:** Indent guides, OP marking, and new comment highlighting.
- **Yours to adjust:** Button shape and size, sidebar width, theme, which annotation layers show, and a per-site off switch. It's one file with no build step, so if the settings don't cover it, the source is right there.

## What it can see

It runs on every page, so this matters: there's no backend, no analytics, and no
telemetry. Which hosts it contacts depends on which sources you switch on.

- Hacker News talks to the HN API, Algolia search, and news.ycombinator.com, with
no persistent identifier attached.
- Reddit sends the pages you visit to reddit.com, and if you're
signed in to Reddit, those requests arrive as your account. Signed out, they carry a long-lived device identifier
instead.
- Bluesky sends the pages you visit to Constellation, an independent index of
Bluesky links, not to Bluesky. Bluesky is asked only about the posts
Constellation names. No account is needed and neither host sets a cookie.
- Lobsters sends only the domain of each page you visit — not the full address —
to lobste.rs, to find that domain's submissions. Signed in or out, the request
carries no account.
- Wikipedia sends the pages you visit to Wikipedia's API, to find the Talk and
project pages that link them. No account, signed in or out.
- Lemmy sends the pages you visit to lemmy.world, a large instance whose
federation reaches across the wider network. No account, signed in or out.

Webmail, banking, auth flows, and cloud consoles are excluded outright.

Full detail, including a host-by-host table, in [SECURITY.md](SECURITY.md).

## Where did HNewhere go?

Nothing went anywhere. **HNewhere is now Backchannel**. Same project, same
history, same install URL, same settings. It was renamed in v1.6.0 when it
stopped being about one site: it now reads Hacker News and/or Reddit, and each
source is a checkbox you control. The repository has since been renamed to
match, and links to the old one redirect.

If you already have it installed it updates itself and renames in place. Your hidden sites, your reading queue, your collapsed threads and your
preferences all carry over untouched.

## Install

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Userscripts (Safari)](https://apps.apple.com/us/app/userscripts/id1463298887)

2. [Install Backchannel](https://raw.githubusercontent.com/twalichiewicz/Backchannel/refs/heads/main/HNewhere.user.js)
   - *Upgrading from HNewhere?* Let it auto-update and it renames itself. If you
     install from this link instead, delete the old **HNewhere** entry afterwards.
3. Browse the web as usual. If a thread exists for that page the (BC) button lights up. Clicking it opens the sidebar. Still grey? Nobody's posted it yet-- click to submit it yourself.

## Contributing

Bug reports and pull requests are welcome. Please report anything security-sensitive privately via [SECURITY.md](SECURITY.md). Backchannel is a single file with no
build step or dependencies: edit `HNewhere.user.js`, load it in your userscript
manager, and what you see is what users install. Release history is in
[CHANGELOG.md](CHANGELOG.md).

## License

MIT
