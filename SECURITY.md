# Security Policy

## Supported versions

Backchannel (formerly HNewhere) is distributed as a single userscript that auto-updates from `main`.
Only the latest release is supported -- there are no maintenance branches, and a
fix ships as a new version that existing installs pick up automatically.

| Version    | Supported |
| ---------- | --------- |
| 1.6.17     | Yes       |
| < 1.6.17   | No        |

Your installed version is shown beside the word Settings, at the top of
Settings.

## Reporting a vulnerability

Please report privately rather than opening a public issue, using
[GitHub's private vulnerability reporting](https://github.com/twalichiewicz/Backchannel/security/advisories/new)
on this repository.

Include what you need to reproduce it: the page or page type, your browser and
userscript manager, and the behavior you observed. A proof of concept helps but
is not required to report something.

This is a small project maintained by one person. Expect an acknowledgement
within about a week. If a fix is warranted it will ship as a version bump, and
you will be credited in the changelog unless you would rather not be.

## What this script can do

Worth stating plainly, because the permissions are broad by necessity:

- **It runs on every `http` and `https` page** you visit, injected by your
  userscript manager. Since 1.6.14 that includes frames inside those pages;
  everywhere except the reader's own article frame on backchnnl.app it stops on
  its first statement.
- **It listens for one key on every page.** Since 1.6.17, ⌘. (Ctrl+. off Apple
  platforms), or the key you set in Settings › Shortcuts, shows or hides the
  Sidebar. Every other key is left to the page, typing in a field included,
  and no key is kept or sent anywhere.
- **It can make cross-origin requests**, via `GM.xmlHttpRequest`, restricted by
  the `@connect` header. Which hosts it *actually* contacts depends on which
  comment sources you have enabled, and on the topics you pick for the front
  page:

  | Source | Hosts contacted | What they are told |
  | --- | --- | --- |
  | Hacker News | `hn.algolia.com`, `hacker-news.firebaseio.com`, `news.ycombinator.com` | the URL of each page you visit, with no persistent identifier attached |
  | Reddit | `www.reddit.com` | the URL of each page you visit. Signed in to Reddit, these requests arrive authenticated as your account; signed out, they carry a long-lived device identifier |
  | Reddit (fallback) | `arctic-shift.photon-reddit.com` | the URL of each page you visit, with no identifier. Used automatically when reddit.com declines the request |
  | Bluesky (discovery) | `constellation.microcosm.blue` | the URL of each page you visit, with no identifier attached |
  | Bluesky | `public.api.bsky.app` | post identifiers only -- never the URL of the page you are on |
  | Lobsters | `lobste.rs` | the domain of each page you visit -- never the full address. It has no URL search, so the exact match is made here |
  | Wikipedia | `en.wikipedia.org` | the URL of each page you visit, to find the Talk pages citing it, and then those pages' names to read what was said. Signed in to Wikipedia, these requests carry your session; signed out, they carry a device identifier that lasts a year |
  | Lemmy | `lemmy.world` | the URL of each page you visit, with no account |
  | Mastodon (discovery) | `www.tootfinder.ch` | the domain of each page you visit -- never the full address. An opt-in index of Mastodon posts, not Mastodon, and it holds only people who chose to be searchable |
  | Mastodon (front page) | `mastodon.social` | what that instance is currently linking to and, when you open one of those links in the reader and the search finds no posts for it, that link's address, to find the posts sharing it |
  | Front Pages, by topic | `www.reddit.com`, `news.ycombinator.com`, `lemmy.world`, `lobste.rs` and `public.api.bsky.app`, each only while that source is on | nothing about the page you are on, only the topics you picked. Signed in to Reddit or Hacker News, those requests arrive as your account |
  | Hypothes.is | `api.hypothes.is` | the URL of each page you visit, to find public annotations on it. No account, signed in or out |
  | *no source enabled* | none | nothing -- the script performs no lookup at all. Kind of weird to use it this way, but no judgements. |

  Nine sit outside that table because they are not lookups:

  | Host | When | What it is told |
  | --- | --- | --- |
  | `old.reddit.com` | only when you press vote or reply | the comment you are acting on, in a popup window you can see. Nothing at page load |
  | `cdn.jsdelivr.net` | when your manager fetches the script's declared resources, and again from the page itself if it did not | nothing about you -- it is a file download of a fixed, versioned URL |
  | the page you open in the reader on backchnnl.app | only when that page gives no answer from inside its frame | nothing but the request itself: one `GET` without cookies, to read whether it may be framed, whether it is a picture and, if it may not be framed, its text |
  | the site of each article in the reader's list on backchnnl.app | when the list shows the article, since 1.6.15 | nothing but a request for its icon, `/favicon.ico`, sent without a referrer |
  | wherever a page you open in the reader says its preview image is | once that page has loaded in the reader, since 1.6.15.1 | nothing but the request for the image, sent without a referrer |
  | the site of each page in your Collection | when the Collection shows a card that has no picture or colors kept for its page, since 1.6.17: at most six at a time, and each card once until the page reloads | nothing but the request itself: one `GET` without cookies, to read the page's picture, colors, fonts and icon |
  | wherever a page in your Collection says its picture and icon are | when the Collection shows its card, in the reader or in the Sidebar, since 1.6.17 | nothing but the requests for the images, sent without a referrer |
  | wherever an image in a comment is hosted | only with *Show images in comments* on, and it is off until you turn it on | nothing but the request for the image, over https and without a referrer |
  | the page you ask the reader to scrape | only when you press *Scrape link content* | what any visit tells it: the page opens in a tab of your own browser, signed in if you are |

- **It checks the pages in your Collection for new discussion.** Since 1.6.17
  every page you save is watched until you choose *Unwatch* in its card's
  menu; before, only what you chose to watch was. A page is checked once when
  you save it, to note how many posts link to it. After that, each time a page
  you visit is looked up, up to four saved pages not checked in the past hour
  are. A check sends the saved page's address to Hacker News's search, to
  Constellation and, while Reddit answers through its archive mirror, to that
  mirror -- only those you have on -- and asks how many posts link to it. When
  a count has grown, the saved page is looked up as a page you visit is, by
  every source you have on. A page with new discussion is not checked again
  until you have seen it, and one that no source answers five times running is
  no longer checked.
- **Enhanced PDF support downloads a copy of pdf.js.** The reader is
  [pdf.js](https://mozilla.github.io/pdf.js/), declared as two `@resource` files
  on `cdn.jsdelivr.net` -- 0.49 MiB for the viewer and 1.25 MiB for its worker,
  1.74 MiB in all, pinned to one version rather than tracking latest. Your
  userscript manager fetches declared resources for you; if it hands back
  nothing, the script fetches the same two URLs itself when the reader opens.
  Either way it is a file download from a CDN, it carries nothing about you, and
  the code is only loaded into a page when the setting is on and you are on a
  PDF. This is the one thing in the script that is not self-contained, which is
  why the setting is off until you turn it on.
- **Reading a PDF means reading the file you already have open.** With the
  setting off, the script asks the browser's own viewer for the document's text.
  With it on, the script's own reader parses the bytes instead -- the same bytes
  your browser downloaded to show you. Either way a quoted passage can be found
  on a page that is not on screen yet, and either way nothing about the document
  is sent anywhere.
   - **None of this happens in Firefox.** Firefox reserves its built-in PDF viewer
  and lets no extension run there, userscript managers included, so on a PDF the
  script never starts: nothing is read, no host is contacted, and no button or
  Sidebar appears. This is a limit of the browser rather than a setting, and it
  applies whatever Enhanced PDF support is set to.
- **`@connect` is a ceiling, not a statement of use.** The header is static, so
  it lists every host any source *could* contact, including sources you have
  switched off. A disabled source issues no requests; the entry is a permission
  the script is allowed but does not exercise. Since 1.6.14 it also lists `*`,
  for the reader's one fetch of a page that will not answer from its frame.
  Tampermonkey may ask before the first such request to a host outside the
  named list.
- **It stores data locally** through `GM.getValue` / `GM.setValue` -- settings,
  per-site Sidebar widths, the zoom level of the last forty sites you visited,
  button position, collapsed threads, seen-comment timestamps, remembered votes
  and your Collection, with each saved page's picture, colors and icon, your
  reading queue, the sites you have hidden, and anything you write in the
  notepad. An article you ask the reader to scrape passes through
  the same storage on its way from its tab: the reader removes it once it is
  shown, and if the reader has gone by then it stays until the next scrape
  replaces it. On backchnnl.app it also keeps your theme and the reader's two
  page colors in that site's own local storage, under `backchannel:chrome`, so
  the page can take your color before the script runs. Nothing is sent
  anywhere except the hosts above.
- **It keeps what Hacker News answered about the last pages you looked up**, so
  a page reopened within the hour is not asked about again. Since 1.6.15.2 that
  is one stored value holding thirty pages at most, by address. A page is used
  for an hour and dropped the next time a lookup is saved, so the value can
  still name a page for longer than that if you look nothing up in between.
  Before 1.6.15.2 every page had a stored value of its own, named
  `HNewhere:hn_cache:` followed by its address, and none was removed. Those are
  still in your userscript manager's storage: the script is granted no way to
  list or delete stored values, so it cannot remove them. Clearing the script's
  stored data in the manager removes them, and your settings and notes with
  them.
- **The notepad stays on the machine you wrote it on.** Notes live in your
  userscript manager's storage, keyed by page address or, on a PDF, by the
  document's fingerprint. Nothing is uploaded and no source is told they exist.
  That cuts the other way too: they do not sync between browsers, and clearing
  your manager's data takes them with it, which is why the setting offers an
  export.
- **There is no backend, no analytics, and no telemetry.** Nobody but you and the
  sources you have enabled sees which pages you look up.

## Design decisions that limit the blast radius

- **Sensitive sites are excluded** both in the userscript header and at runtime.
  `isHiddenSite()` blocks anything that is not `http` or `https`, private and
  single-label hostnames, and a list covering webmail, banking, auth flows and
  cloud consoles -- matched on the hostname and on the path, so a sign-in page
  is caught on a host that is otherwise fine. A blocked page
  performs no lookup, renders nothing, and writes no stored state. PDFs were on
  that list until 1.6.7; they are read like any other page now, and a PDF on an
  excluded host stays excluded.
- **Credentials never leave the site they belong to.** Everything that writes --
  voting, replying, and submitting on Hacker News; voting and replying on Reddit
  -- happens in a popup window on that site's own domain, using the session your
  browser already has there. The script never handles either password and never
  posts a session cookie anywhere. Those two are the only sources with write
  access; the rest are read-only.
- **Comment HTML is sanitized** before being inserted, through an allowlist of
  tags and attributes -- applied to every source. Reddit's rendered markdown
  arrives HTML-escaped and is unescaped only to be handed to the same sanitizer.
  Lemmy hands over Markdown rather than HTML, which is escaped first and only
  then turned into links and quotes, so the only markup in a Lemmy comment is
  markup this script wrote. An image is not loaded: inside a link it becomes
  the link's text, and anywhere else it is dropped. With *Show images in
  comments* on, an image with an https address is kept instead, stripped to
  its address and description and loaded lazily without a referrer; any
  other is dropped.
- **The UI renders inside shadow roots**, so page styles and page scripts do not
  reach into it by accident, and its styles do not leak onto the page.
- **Frames get almost nothing.** The script loads in frames, but anywhere
  except a frame named `backchannel-article` it stops on its first statement. In
  that frame, inside the reader on backchnnl.app, it answers only messages from
  `https://backchnnl.app`, and tells that page only the frame's address, its
  title, its size, the address of its preview image, its colors, fonts and
  icon and its site's name (for its card in the Collection), whether it is
  showing, whether it is a picture, which quotes it found, which link was
  pressed, a passage you pressed **Add note** on, a pull down from the top of
  the page, and a key you pressed in it when that key is one of the reader's
  shortcuts and you were not typing in a field.
  It performs no lookup there and writes nothing to storage; it reads your
  settings to know whether to offer **Add note**. A page in that frame could
  send the reader a passage of its own choosing: the reader would open its note
  box quoting it, and nothing is saved unless you write a note and save it.
- **The reader frames pages under a sandbox**, with no referrer and without
  permission to navigate the reader itself, so a page that tries to break out of
  its frame stays in it. A page read out instead is reduced by an allowlist to
  reading markup (text, links, https images, lists, tables and code) before it
  is shown. A post that is a picture is loaded as an image, also without a
  referrer.
- **A scrape answers one address, once.** *Scrape link content* stores the
  address you asked for and opens it in a tab. The script in that tab answers
  only within 25 seconds, only on the host that address names, and only for
  that address or a page there that names it as its canonical address; a page
  on another site that claims the address is ignored. What comes back is
  reduced by the same allowlist as any other reading view before it is shown.
  An excluded page is never read this way: a tab on one does not answer, and
  the reader does not offer to scrape one. A site you have hidden, and any site
  while the Sidebar is switched off, is still read if it is the address you
  asked for.
- **The Sidebar can be switched off.** With the switch in the reader's
  settings off, a page you visit gets no lookup, no button and no Sidebar.

## Exact table of what each source requests

One row per request the script can make, read from the code rather than described.
`<page>` is the address of the page you are on; `<domain>` is only its host. A
source you have not switched on issues none of these. A page in your Collection
that the watching rows find new discussion for is looked up by the same rows,
with its address as `<page>`.

| Source | Request | What it carries | Arrives as you? |
| --- | --- | --- | --- |
| Hacker News | `GET hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=20&query=<page>` | `<page>` | No, and no identifier of any kind |
| Hacker News | `GET hacker-news.firebaseio.com/v0/item/<id>` | story and comment ids it already has | No |
| Hacker News | `GET news.ycombinator.com/item?id=<id>` | a thread id, to read scores and flags | Yes, if you are signed in there |
| Reddit | `GET www.reddit.com/search.json?type=link&limit=25&q=<page>` | `<page>` | Yes when signed in. `reddit_session` is `SameSite=None`, so the browser attaches it cross-site. Signed out it carries `loid`, a device id that lasts over a year |
| Reddit (fallback) | `GET arctic-shift.photon-reddit.com<path>` | the same lookup, against an archive mirror | No identifier, no session |
| Reddit (vote, reply) | popup window on `old.reddit.com` | the one comment you acted on, only when you press | Yes, in a window you can see, using the session already in your browser |
| Bluesky | `GET constellation.microcosm.blue/links/all?target=<page>` | `<page>`, plus a `User-Agent` naming Backchannel and its version | No |
| Bluesky | `GET constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks?subject=<page>&source=...&limit=100` | `<page>` | No |
| Bluesky | `GET public.api.bsky.app/xrpc/app.bsky.feed.getPosts` and `...getPostThread` | post ids Constellation named, never `<page>` | No. Signed in, the cookie jar for `bsky.app` is empty -- it authenticates from local storage, which the browser never attaches |
| Lobsters | `GET lobste.rs/domains/<domain>.json` | `<domain>` only, never the full address | No |
| Wikipedia | `GET en.wikipedia.org/w/api.php?action=query&list=exturlusage&eunamespace=1\|3\|4\|5&euquery=<page>&eulimit=100` | `<page>`, to find the Talk and project pages citing it | Yes when signed in. `enwikiSession` is `SameSite=None`, so the browser attaches it cross-site. Signed in or out it carries `WMF-Uniq`, a device id Wikipedia sets on every visit, which lasts a year |
| Wikipedia | `GET en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=<titles>` | the names of those pages | The same, as in the row above |
| Lemmy | `GET lemmy.world/api/v3/search?q=<page>&type_=Url&listing_type=All&limit=20` | `<page>` | No |
| Lemmy | `GET lemmy.world/api/v3/comment/list?post_id=<id>&type_=All&sort=Top&max_depth=8&limit=300` | a post id it already found | No |
| Mastodon | `GET www.tootfinder.ch/rest/api/search/<domain>` | `<domain>` only, never the full address | No |
| Mastodon (front page) | `GET mastodon.social/api/v1/trends/links?limit=40` | nothing about you, only what that instance is linking to | No |
| Front Pages, by topic | `GET www.reddit.com/r/<subreddits>.json?limit=100` | the subreddits for a topic you picked, never `<page>`. Only while Reddit is on | Yes when signed in, as in the Reddit row |
| Front Pages, by topic | `GET news.ycombinator.com/news` | nothing about you. Only for Technology, and only while Hacker News is on | Yes, if you are signed in there |
| Front Pages, by topic | `GET lemmy.world/api/v3/post/list?community_name=<community>&sort=Active&type_=All&limit=50` | a community for a topic you picked, never `<page>`. Only while Lemmy is on | No |
| Front Pages, by topic | `GET lobste.rs/hottest.json` | nothing. Only for Technology, and only while Lobsters is on | No |
| Front Pages, by topic | `GET public.api.bsky.app/xrpc/app.bsky.feed.getFeed?feed=<feed>&limit=100` | a feed for a topic you picked, never `<page>`. Only while Bluesky is on | No |
| Hypothes.is | `GET api.hypothes.is/api/search?url=<page>&limit=200` | `<page>` | No |
| Hacker News (Collection) | `GET hn.algolia.com/api/v1/items/<id>` | the id of a comment you saved without its thread, to find that thread; at most five tries, only while Hacker News is on | No |
| Lobsters (Collection) | `GET lobste.rs/c/<id>.json`, then `GET lobste.rs/s/<id>.json` | the id of a comment you saved without its thread, then its story's id, to find the article; at most five tries, only while Lobsters is on | No. Its session cookie, `lobster_trap`, is `SameSite=Lax`, which the browser withholds cross-site |
| Lemmy (Collection) | `GET lemmy.world/api/v3/comment?id=<id>` | the id of a comment you saved without its thread, to find its post; at most five tries, only while Lemmy is on | No. Its session cookie, `jwt`, is `SameSite=Lax`, which the browser withholds cross-site |
| Hacker News (watching) | `GET hn.algolia.com/api/v1/search?tags=story&restrictSearchableAttributes=url&hitsPerPage=0&query=<saved page>&numericFilters=created_at_i><when you saved it>` | the address of a page in your Collection, in two spellings, and when you saved it, to count the stories posted since; only while Hacker News is on | No, and no identifier of any kind |
| Bluesky (watching) | `GET constellation.microcosm.blue/links/count?target=<saved page>&collection=app.bsky.feed.post&path=.embed.external.uri` | the address of a page in your Collection, plus a `User-Agent` naming Backchannel and its version; only while Bluesky is on | No |
| Reddit (watching) | `GET arctic-shift.photon-reddit.com/api/posts/search?limit=25&fields=id&url=<saved page>` | the address of a page in your Collection; only while Reddit is on and answering through the archive mirror | No identifier, no session |
| Reddit (reader) | `GET www.reddit.com/api/info.json?id=t3_<id>`, or the archive mirror's `/api/posts/ids?ids=<id>` | the id of a post the reader listed, when you open its link and the search by address missed that post; only while Reddit is on | Yes when signed in, as in the Reddit row |
| Bluesky (reader) | `GET public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=<post>` | a post a Front Pages feed listed, when you open its link and the search by address missed it; only while Bluesky is on | No, as in the Bluesky row |
| Lobsters (reader) | `GET lobste.rs/s/<id>.json` | the id of a story the reader listed, when you open its link and the search by domain missed it; only while Lobsters is on | No. Its session cookie, `lobster_trap`, is `SameSite=Lax`, which the browser withholds cross-site |
| Mastodon (reader) | `GET mastodon.social/api/v1/timelines/link?url=<link>&limit=40` | a link mastodon.social's trends listed, when you open it and the search finds no posts for it; only while Mastodon is on | No. Its session cookie, `_mastodon_session`, is `SameSite=Lax`, which the browser withholds cross-site |
| Lemmy (reader) | `GET lemmy.world/api/v3/post?id=<id>` | the id of a post the reader listed, when you open its link and the search by address missed it; only while Lemmy is on | No. Its session cookie, `jwt`, is `SameSite=Lax`, which the browser withholds cross-site |
| backchnnl.app reader, not a source | `GET <the page you opened>`, only when it gives no answer from its frame | nothing but the request itself | No, it is sent without cookies |
| backchnnl.app reader's list, not a source | `GET <article's site>/favicon.ico`, as an image, one for each article the list shows | nothing but the request itself, with no referrer | Only as far as your browser sends that site's cookies with an image on another site's page; browsers differ |
| backchnnl.app reader's list, not a source | `GET <the preview image an opened page names>`, as an image, once that page has loaded in the reader | nothing but the request itself, with no referrer | The same: whatever cookies your browser sends with an image on another site's page |
| Collection, not a source | `GET <a page in your Collection>`, when its card has no picture or colors kept, at most six at a time | nothing but the request itself | No, it is sent without cookies |
| Collection, not a source | `GET <a saved page's picture>` and `GET <its icon>`, as images, when the Collection shows its card | nothing but the request itself, with no referrer | The same: whatever cookies your browser sends with an image on another site's page |
| Images in comments, not a source | `GET <the image>`, for each https image in the comments shown, only with *Show images in comments* on | nothing but the request itself, with no referrer | The same: whatever cookies your browser sends with an image on another site's page |
| Scrape link content, not a source | a tab on `<the page you asked for>`, only when you press the button | what any visit to that page carries | Yes. It is your browser opening the page, with the session you have there |
| pdf.js, not a source | `GET cdn.jsdelivr.net/npm/pdfjs-dist@<version>/legacy/build/pdf.min.mjs` and `pdf.worker.min.mjs` | nothing about you, two fixed files at a pinned version | No |
| no source enabled | none | nothing, no lookup is performed at all | -- |

Three rows are worth reading twice. Reddit learns who you are, which is why it
is a checkbox rather than a default and why the caveat sits next to that
checkbox; *Never contact Reddit directly* uses only the archive mirror row,
which carries neither a session nor an identifier. Wikipedia is sent a device id
that lasts a year, signed in or out, and your session when you are signed in to
it. Bluesky never
learns which page you are on -- Constellation does, and Bluesky is asked only
about the posts Constellation named.

## Out of scope

- Vulnerabilities in your userscript manager, browser, or sources themselves --
  please report those to their maintainers.
- The script's ability to read pages you visit. That is inherent to what a
  userscript is, and is disclosed above rather than treated as a flaw. If you
  would rather it not run somewhere, hide it on that site from the header button,
  or narrow the `@include` rules in your manager.
