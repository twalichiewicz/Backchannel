<p align="center">
<picture>
  <img width="120" height="120" alt="backchannel-birb" src="https://github.com/user-attachments/assets/1419b9a3-6172-4d13-b634-0a8fa2cba84f" />
</picture>
  <br/><em>The internet's commentary track</em>
</p>

<img width="1305" height="887" alt="A screenshot of Safari on macOS opened to https://www.seangoedecke.com/llms-reward-expertise/, with the HNewhere side bar open viewing the comments. The settings dropdown in the sidebar is also open, showing which settings the user currently has enabled." src="https://github.com/user-attachments/assets/f50131fc-fa6b-4e25-a5dd-9c44ceae1bc5" />

# Backchannel

- **The internet's commentary track:** Avoid the two-tab-tango and conveniently read the community's comments in-context.
- **Never miss a thread:** Every page you land on gets checked against the sources you've picked, so you find out a discussion exists without going hunting for one.
- **What the internet is saying, in one thread:** Every source you've switched on, merged into a single conversation, each comment quietly noting where it came from. Pick them with a checkbox.
- **See what they're talking about:** Quotes in the comments get matched back to the article and lit as annotations in articles. Click a highlight to filter the thread to the people discussing that passage.
   - **Enable Annotations** in the settings menu to try it out!
   - Enable **Enhanced PDF support** to get highlighting directly on PDF documents. (Not supported on Firefox)
- **Read, then join in:** Vote, reply, and even submit on supported sources. It acts in a popup on the source's own site, using the session you already have there. The script never sees your password.
- **Take notes across the web:** Add notes to any page or PDF you visit, allowing you to have your own personal commentary track. All stored locally.
- **New front page of the internet**: Blend together all of your added sources to create a custom front page to find new articles to read.
- **Quality of life:** Indent guides, OP marking, and new comment highlighting.
- **Yours to adjust:** Button shape and size, sidebar width, theme, which annotation layers show, and a per-site off switch. It's one file with no build step, so if the settings don't cover it, the source is right there.

## Install

<a href="https://trendshift.io/repositories/95983?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-95983" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/95983/daily?language=JavaScript" alt="twalichiewicz%2FBackchannel | Trendshift" width="250" height="55"/></a> <a href="https://www.producthunt.com/products/backchannel-4?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-backchannel-4" target="_blank" rel="noopener noreferrer"><img alt="Backchannel - The internet's commentary track. | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222392&amp;theme=light&amp;t=1786733251041"></a>

1. Install a userscript manager:
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
   - [Userscripts (Safari)](https://apps.apple.com/us/app/userscripts/id1463298887)

2. **[Install Backchannel](https://raw.githubusercontent.com/twalichiewicz/Backchannel/refs/heads/main/HNewhere.user.js)**

## Usage
1. Browse the web as usual. If a thread exists for that page the (BC) button lights up, letting you know people are discussing this site. 
2. You can visit https://twalichiewicz.github.io/Backchannel/ once you have the script installed to have a customizable front page you can bookmark.
3. You can directly upload to Hacker News and Reddit using the **↑** button.

## FAQ

### Where did HNewhere go?

Nothing went anywhere. **HNewhere is now Backchannel**. Same project, same
history, same install URL, same settings. It was renamed in v1.6.0 when it
stopped being about one site: it now offers many sources and each
source is a checkbox you control.

If you already have it installed it updates itself and renames in place. Your hidden sites, your reading queue, your collapsed threads and your
preferences all carry over untouched.

### What exactly is the script doing with my information?

It runs on every page, so this matters: there's no backend, no analytics, and no
telemetry. Which hosts it contacts depends on which sources you switch on.

- Hacker News talks to the HN API, Algolia search, and news.ycombinator.com, with
no persistent identifier attached.
- Reddit sends the pages you visit to reddit.com, and if you're
signed in to Reddit, those requests arrive as your account. Signed out, they carry a long-lived device identifier
instead. Voting and replying go through that same session, and only when you press something.
- Bluesky sends the pages you visit to Constellation, an independent index of
Bluesky links, not to Bluesky. Bluesky is asked only about the posts
Constellation names. No account is needed and neither host sets a cookie.
- Lobsters sends only the domain of each page you visit to lobste.rs, to find that domain's submissions. Signed in or out, the request
carries no account.
- Wikipedia sends the pages you visit to Wikipedia's API, to find the Talk and
project pages that link them, and then reads what was said on them. No account,
signed in or out.
- Mastodon sends only the domain of each page you visit to Tootfinder, an opt-in
index of Mastodon posts, not to Mastodon. It holds only people who chose to be
searchable, so it finds a slice of the fediverse rather than all of it. The front
page asks mastodon.social what it's currently linking to, which tells it nothing
about you. No account, signed in or out.
- Lemmy sends the pages you visit to lemmy.world, a large instance whose
federation reaches across the wider network. No account, signed in or out.
- Hypothes.is sends the pages you visit to its API, to find the public
annotations people have left on them. No account, signed in or out.

Webmail, banking, auth flows, and cloud consoles are excluded outright.

Full detail, including a host-by-host table, in [SECURITY.md](SECURITY.md).

### When I enable annotations, I see faintly highlighted text that isn't directly quoted

When you enable annotations, the script generates a heat map of which content in the article the discussions are focusing on. So even if a piece of text isn't directly quoted by a comment, it may receive the highlighter effect. If it's distracting, you can disable showing annotations when the sidebar is closed by making sure **Show when sidebar closed** is not enabled.

### How can I contribute?

Bug reports and pull requests are welcome. Please report anything security-sensitive privately via [SECURITY.md](SECURITY.md). Backchannel is a single file with no
build step or dependencies: edit `HNewhere.user.js`, load it in your userscript
manager, and what you see is what users install. Release history is in
[CHANGELOG.md](CHANGELOG.md).

### What's the license on this bad boy?

MIT
