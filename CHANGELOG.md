# Changelog

All notable changes to HNewhere are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `HNewhere.user.js`'s `@version` header is what userscript managers
use to detect updates, so every release bumps it.

## [1.5.5] — Unreleased

### Added

- **The button appears immediately.** It used to wait for the discussion lookup,
  and on the preload-hidden path for the sidebar render and the whole annotation
  pass as well — so on a long article the page looked as though nothing was
  installed. It is now drawn before any network request, with a spinner around
  its rim, and turns orange the moment the lookup replies rather than waiting for
  the comments and the annotation pass to finish. Skipped when
  "hide HNewhere without a discussion" is on, since there it may correctly never
  appear.
- **The sidebar says what it is loading.** Under the HNewhere title, in sequence:
  loading discussion, loading comments, loading votes, loading annotations. The
  annotations stage is only claimed when that pass will actually run. The status
  opens and closes the header rather than appearing in it, and is set in dark
  orange with a shimmer travelling through it.

- **Quotes render as quotes.** Hacker News has no quote syntax — commenters
  start a line with `>` and HN prints the marker literally, so quoted text is
  styled exactly like the commenter's own words. Consecutive `>` lines are now
  folded into a real blockquote with a left border, and the markers are dropped.
  `>>` nests. Code blocks are left alone, since diffs and shell prompts
  legitimately begin lines with `>`.
- Multi-line quotes are clickable, and collapse once you are focused on the
  discussion they belong to. Both behaviours already existed for `<blockquote>`
  elements but could never fire, because HN's API never emits one.

### Changed

- Header icons are drawn rather than typed. The settings gear and the minimize
  dash were text characters, and flexbox centres a glyph's line box rather than
  its ink — so the gear sat about a pixel low and the dash half a pixel high,
  while the drawn eye was exactly centred and read as the odd one out. All three
  are now paths on the same 16-unit grid, aligned by construction on every
  platform and matched in weight. Retires the iOS workaround that kept the gear
  from rendering as a colour emoji.
- **Quotes are marked by an ornament, not a rule.** A quoted passage in a comment
  used to carry a left border, which read as thread hierarchy — nested comments
  use a left border for exactly that. Quotes are now set in italics behind a ❛ in
  the gutter, so a deep thread can be scanned without the two devices competing.
  A quote linked to the article shows its ornament in HN orange.
- **Focused discussion reads as part of Hacker News.** Its header uses HN's own
  pipe-separated meta form — `Focused discussion | show all comments` —
  left-aligned, in sentence case, with the close as a text link rather than a
  floating `×`. The quote sits at the comment text size, opened and closed by
  paired ❛ ❜ ornaments that distinguish it from the single-marked quotes in the
  stream. Aligned to the story's own left edge and capped at the composer's
  720px. Drops a bespoke brown palette that appeared nowhere else.
- Filtering to a discussion fades only the comment list. The story header, the
  composer and the banner stay put, rather than the whole sidebar blinking for
  what is an edit to the list underneath.
- Entering a focused discussion scrolls to the banner instead of centring the
  matched comment, so the filtered thread is read from its start rather than
  from the middle. Re-applying an already-open filter still does not scroll,
  since annotations refresh on resize and on setting changes.

### Removed

- The author chips under a focused discussion. They repeated what the filtered
  list already showed and did not survive a discussion with more than a handful
  of participants.
- A discussion now anchors to the line it quoted rather than to the enclosing
  quote block. The block is the fallback, used only when the quote genuinely
  spans more than one line. Previously the block was tried first and claimed
  whenever it merely contained the quote, so with several discussions quoting one
  comment, whichever was processed first took the whole quote.
- The sidebar builds its chrome before loading stories, rather than after. The
  panel does not depend on them, and loading first meant the reader watched an
  empty page through the slowest part of startup.
- Startup reads settings, sidebar state, the last-clicked story and remembered
  votes together rather than one after another, as does each discussion's seen
  time and collapsed set.
- Vote arrows fade in. They cannot be drawn before HN's per-item auth link has
  been fetched, so they always arrive late; their slot was already reserved, so
  only the snap needed fixing.
- Motion is now suppressed for readers who ask for reduced motion.
- Comment text is read block-aware when scoring discussion heat. It previously
  used raw `textContent`, which butts the last word of a paragraph against the
  first word of the next and tokenizes the join as a single junk term.

### Fixed

- Comments quoting more than one line were rendered shredded: paragraphs split
  mid-sentence, with the trailing punctuation stranded on a line of its own. When
  a quote match straddled a paragraph boundary, the inline quote-link wrapper
  detected it only after calling `extractContents()`, which had already cut the
  paragraph in half; re-inserting the fragment added the halves back as separate
  paragraphs instead of restoring the original. The check now runs against
  `cloneContents()`, so declining to wrap leaves the comment untouched.

## [1.5.4] — 2026-07-30

### Added

- **Discussion heat.** Comments that discuss a passage without quoting it are
  scored against the article's paragraphs and rendered as an ambient wash, so
  attention shows up on passages nobody quoted. Requires three independent
  comments converging on a paragraph before anything is drawn. Rides the existing
  article annotations setting, which is off by default.
- **Theme override.** Detect from the page, or pin to light or dark.
- **Button appearance.** The floating HN button can be a circle or a squircle,
  sized from 24px to 64px, with a live preview and a reset.
- **Hide HNewhere per site.** An eye-with-slash button in the header hides the
  current site immediately; hidden sites are listed in settings and can be
  removed from there.

### Changed

- The focused-discussion quote is now a bordered box matching the comment
  formatting panel, rather than a centered pull quote.
- Settings uses segmented controls, and hidden sites live on a second pane
  reached through a breadcrumb trail.
- Settings checkboxes are drawn from the theme's own tokens instead of the
  browser's form controls, so they match the segmented controls in both themes
  and across browsers.

### Fixed

- **[#32](https://github.com/twalichiewicz/HNewhere/issues/32)** — host pages
  with single-key shortcuts (GitHub's `s` for search, for instance) stole focus
  while typing in HNewhere's fields. Events leaving a shadow root are retargeted,
  so those pages saw HNewhere's container rather than a text field and their
  "is the user typing?" guard let the shortcut through. Keyboard events from
  HNewhere's own fields no longer reach the page.
- The settings panel was clipped to the submit popover's box on pages with no
  discussion, cutting off most of the options.

## [1.5.3] — 2026-07-30

Annotation and sidebar refinements.

## [1.5.2] — 2026-07-30

Mobile usability, discussion ordering, and HN-accurate rendering.

## [1.5.1] — 2026-07-30

Follow-up fixes to the 1.5 annotation release.

## [1.5.0] — 2026-07-29

Article annotations: quoted passages are highlighted in the page and linked to
the comments that quote them.

## [1.4.8] — 2026-07-29

Mobile fixes.

## [1.4.7] — 2026-07-29

Numerous small improvements.

---

Releases before 1.4.7 are recorded in the
[GitHub releases](https://github.com/twalichiewicz/HNewhere/releases) and the
commit history. Entries for 1.4.7 through 1.5.3 are summarized from their release
commits rather than written at the time.

[1.5.4]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.8...v1.5.0
[1.4.8]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.6...v1.4.7
