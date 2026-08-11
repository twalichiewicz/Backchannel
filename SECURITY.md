# Security Policy

## Supported versions

Backchannel — formerly HNewhere — is distributed as a single userscript that auto-updates from `main`.
Only the latest release is supported — there are no maintenance branches, and a
fix ships as a new version that existing installs pick up automatically.

| Version | Supported |
| ------- | --------- |
| 1.6.1   | Yes       |
| < 1.6.1 | No        |

Your installed version is shown at the bottom of the settings panel.

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
  userscript manager.
- **It can make cross-origin requests**, via `GM.xmlHttpRequest`, restricted by
  the `@connect` header. Which hosts it *actually* contacts depends on which
  comment sources you have enabled:

  | Source | Hosts contacted | What they are told |
  | --- | --- | --- |
  | Hacker News | `hn.algolia.com`, `hacker-news.firebaseio.com`, `news.ycombinator.com` | the URL of each page you visit, with no persistent identifier attached |
  | Reddit | `www.reddit.com` | the URL of each page you visit. **Signed in to Reddit, these requests arrive authenticated as your account**; signed out, they carry a long-lived device identifier |
  | Reddit (fallback) | `arctic-shift.photon-reddit.com` | the URL of each page you visit, with no identifier. Used automatically when reddit.com declines the request |
  | Bluesky (discovery) | `constellation.microcosm.blue` | the URL of each page you visit, with no identifier attached |
  | Bluesky | `public.api.bsky.app` | post identifiers only — **never the URL of the page you are on** |
  | Lobsters | `lobste.rs` | the **domain** of each page you visit — never the full address. It has no URL search, so the exact match is made here |
  | Wikipedia | `en.wikipedia.org` | the URL of each page you visit, to find the Talk pages citing it, and then those pages' names to read what was said. No account, signed in or out |
  | Lemmy | `lemmy.world` | the URL of each page you visit, with no account |
  | Mastodon (discovery) | `www.tootfinder.ch` | the **domain** of each page you visit — never the full address. An opt-in index of Mastodon posts, not Mastodon, and it holds only people who chose to be searchable |
  | Mastodon (front page) | `mastodon.social` | **nothing about you.** Asked only what that instance is currently linking to |
  | Hypothes.is | `api.hypothes.is` | the URL of each page you visit, to find public annotations on it. No account, signed in or out |
  | *no source enabled* | none | nothing — the script performs no lookup at all |

- **`@connect` is a ceiling, not a statement of use.** The header is static, so
  it lists every host any source *could* contact, including sources you have
  switched off. A disabled source issues no requests; the entry is a permission
  the script is allowed but does not exercise.
- **Reddit is off by default, and is a real trade.** Enabling it sends your
  browsing to a company whose business is advertising.

  How much it reveals depends on whether you are signed in, and this was
  measured rather than assumed. Reddit sets two session cookies. `token_v2` is
  `SameSite=Lax` and is withheld from cross-site requests — but signing in also
  sets **`reddit_session`, which is `SameSite=None`** and is not. So a request
  this script makes from an unrelated page arrives at Reddit **authenticated as
  your account**: asked who is calling, Reddit answers with your username.
  Signed out, the same request carries only `loid`, a device identifier that
  persists for over a year — and which Reddit can associate with your account
  anyway if you have ever signed in on that browser.

  Hacker News and Algolia receive URLs with no per-user identifier at all. This
  is why Reddit is a checkbox rather than a default, and why the caveat sits
  next to the checkbox rather than only here. Enabling *Never contact Reddit
  directly* uses only the archive mirror, which receives no identifier and no
  session.
- **Reddit is read-only.** No voting, no replying, no submitting. Nothing is ever
  posted to Reddit on your behalf.
- **Bluesky is off by default, read-only, and needs no account.** The trade is a
  different shape from Reddit's, and better in one specific way: the page you are
  reading is disclosed to *Constellation*, not to Bluesky. Bluesky's own API is
  asked only which posts Constellation named, so it learns which posts you looked
  at and not which page you are on.

  Constellation is run by the [microcosm](https://microcosm.blue) project — a
  small independent operator rather than a company, self-hostable, and it asks
  callers to identify themselves in a `User-Agent`, which this script does. That
  cuts both ways and is worth knowing in both directions: there is no advertising
  business behind it, and also no company behind it.

  Measured 2026-08-05, and the Reddit case above is exactly why it was measured
  rather than assumed. **Signed in to Bluesky, the cookie jar for `bsky.app` is
  empty** — it authenticates with tokens in local storage, which the browser
  never attaches to a request. There is no credential for these requests to
  carry, signed in or out. Separately, `public.api.bsky.app` returns
  byte-identical responses whether handed a cookie, a bearer token or nothing at
  all, and answers `501 Method Not Implemented` to the one auth-gated method
  tried: it has no authenticated mode to leak into. Two independent reasons,
  either of which would be sufficient.
- **It stores data locally** through `GM.getValue` / `GM.setValue` — settings,
  per-site sidebar widths, collapsed threads, seen-comment timestamps, and
  remembered votes. Nothing is sent anywhere except the hosts above.
- **There is no backend, no analytics, and no telemetry.** Nobody but you and the
  sources you have enabled sees which pages you look up.

## Design decisions that limit the blast radius

- **Sensitive sites are excluded** both in the userscript header and at runtime.
  `isHiddenSite()` blocks private and single-label hostnames, plus a list
  covering webmail, banking, auth flows, and cloud consoles. A blocked page
  performs no lookup, renders nothing, and writes no stored state. PDFs were on
  that list until 1.6.7; they are read like any other page now, and a PDF on an
  excluded host stays excluded.
- **Credentials never leave Hacker News.** Voting, submitting, and commenting are
  performed in a popup window on `news.ycombinator.com` using your existing
  session there. The script never handles your HN password, and never posts your
  session cookie anywhere. No other source has write access at all.
- **Comment HTML is sanitized** before being inserted, through an allowlist of
  tags and attributes — applied to every source, including Reddit's rendered
  markdown, which arrives HTML-escaped and is unescaped only to be handed to the
  same sanitizer.
- **The UI renders inside shadow roots**, so page styles and page scripts do not
  reach into it by accident, and its styles do not leak onto the page.
- **`@noframes`** keeps it out of iframes.

## Out of scope

- Vulnerabilities in your userscript manager, browser, or Hacker News itself —
  please report those to their maintainers.
- The script's ability to read pages you visit. That is inherent to what a
  userscript is, and is disclosed above rather than treated as a flaw. If you
  would rather it not run somewhere, hide it on that site from the header button,
  or narrow the `@include` rules in your manager.
