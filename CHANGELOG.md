# Changelog

All notable changes to HNewhere are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `HNewhere.user.js`'s `@version` header is what userscript managers
use to detect updates, so every release bumps it.

## [1.5.7] — 2026-07-31

### Added

- Automatic opening can be narrowed to pages you reached from Hacker News.
  **Only when arriving from Hacker News** appears under *Automatically open the
  sidebar when a discussion exists* once that is on. It is off by default, so an
  existing setup keeps opening everywhere until you say otherwise.

  Arrival is read two ways, because neither is sufficient alone. `document.referrer`
  carries HN's origin on any click from the site — HN serves
  `<meta name="referrer" content="origin">`, so it arrives as the bare host
  rather than the item URL — but some browsers withhold it entirely, and a
  setting that silently never fires is worse than no setting at all. The second
  signal is the story click HNewhere already records while you are on HN, which
  no referrer policy can strip.

  The referrer is read once, when the document loads. It is a property of the
  document rather than of the address currently showing, so on a site that
  navigates without reloading it would otherwise keep saying "from HN" for every
  article you clicked through to afterwards.

### Changed

- **Article highlights read as ink under the text rather than a film over it.**
  The highlight is drawn in an overlay above the page, so its orange was landing
  on top of the words it marked and washing them out — the mark drew your eye to
  a passage and then made it harder to read, which is backwards. The overlay now
  blends with the page instead of covering it: orange that can only darken on a
  light page, only lighten on a dark one, and so cannot touch the glyphs either
  way. Over the page background it lands on exactly the pixel it did before, so
  the highlight itself is unchanged.

  Freed of that, the fill no longer has to stay faint to keep the text readable,
  and has gone from barely visible to something that reads as a highlighter: half
  strength, where it used to be eight percent.

  Which way it blends is decided by the paper the highlight lands on, read from
  the page itself, and not by the theme you have chosen for the sidebar. Those
  are different questions — the sidebar's theme is about the sidebar — and
  answering the second would put a lightening blend on a white page, where it
  does nothing at all.

  A passage is also lit the same however many people quoted it. Highlights were
  painted once per comment, and translucent ones stacked, so a much-quoted
  sentence came out several times stronger than a singly-quoted one — the same
  mark meaning the same thing but rendered anywhere from faint to vivid. How much
  a passage is discussed is what the heat wash already says, and it was only
  being said twice.
- A quoted sentence is no longer marked inside a focused discussion when the
  banner at the top is already showing it. The underline invited a click through
  to the view the reader was in, and said a second time what the banner had just
  said. Quotes the banner does not cover keep their mark, because those still
  lead somewhere. The words themselves stay at full strength either way — they
  are the comment's own prose.
- The underline under a quoted sentence is a hairline. It was set to 1.5px, which
  a 2x screen rounds up to three device pixels, and read as a rule beneath the
  text rather than a mark on it.
- Article highlights lost their underline. The highlight carries the passage on
  its own, and the underline was a second interactive element stacked on the
  first — which is why tabbing through an annotated article used to stop on every
  quote twice.
- Pointing at a highlighted passage now deepens it, and the whole quote responds
  rather than the line under the pointer, since a quote that wraps is still one
  sentence. Keyboard focus does the same. Pointer feedback is limited to devices
  that have a pointer, where hover states neither fail to fire nor stick after a
  tap.
- **While automatic opening is on, it is now what decides.** The sidebar
  remembers per site whether you last opened or minimized it, and that memory
  used to be consulted first — so minimizing the panel once on a site quietly
  stopped it opening there again, whatever the setting said, with nothing on
  screen to say so and no way back except opening it by hand. A setting that
  reads *automatically open the sidebar when a discussion exists* has to do that,
  and *only when arriving from Hacker News* narrows the same sentence rather than
  making a second rule. Shutting a panel on one visit is not a standing objection
  to a preference you have since expressed.

  The per-site memory still decides when the setting is off, which is what makes
  a site you opened by hand keep opening. It now records only that — what you did
  yourself. An automatic open writes nothing.

  One consequence worth knowing: with the setting on, minimizing no longer
  silences a site. To stop the sidebar opening somewhere, turn the setting off —
  per-site memory then governs again — or hide the site outright.
- Automatic opening now works on phones and tablets. The switch was already
  there and already saved what you set, but the decision discarded it on any
  touch device, so turning it on did nothing and there was nothing to say why.
  The sidebar has handled small screens since 1.5.2, taking the full width less
  a sliver on a portrait phone.
- *Enable article annotations* has one sub-option instead of two. **When sidebar
  open** is gone. Annotations are what links a passage to the comment that
  quoted it, so switching them off while the sidebar is open left the feature
  enabled but absent from the one place it does anything; unchecking both left it
  enabled and absent everywhere. What remains is **Show when sidebar closed**,
  which is the only part that was ever a real choice. A stored preference from
  the old checkbox is ignored.

### Fixed

- The orange accent on a new comment comes off when you scroll past it, on devices
  with no pointer. It had only ever come off under the pointer, and a finger has no
  equivalent: a touch lands on whichever comment happens to be beneath it while
  scrolling, so the one that lost its accent was arbitrary and the rest kept theirs
  however far past them you had read. Scrolling clear of a comment is the touch
  equivalent of having attended to it.

  Only where there is no hover. Where there is a pointer, pointing at a comment is
  both more precise and more deliberate than scrolling past it, and that is left to
  do the job as before.

  Scrolling the panel does on your own behalf never clears anything: returning to a
  reading position, jumping to the focus banner, and reflowing the list around a
  filter all sweep comments past the top without you having read a word. A comment
  hidden by a filter or a collapsed thread is not counted as scrolled past either —
  it reports no box at all, which would otherwise satisfy the test.
- Code blocks in comments wrap instead of running off the side of the panel. A
  `<pre>` does not wrap at any width by default, so a code block — or a quote
  someone marked by indenting it, which Hacker News turns into one — pushed 697
  pixels of content through a 419 pixel panel and took the comment's own edge with
  it. It now wraps while keeping the indentation and line breaks that made the
  author reach for a code block, and anything that still cannot break scrolls
  inside its own block rather than widening everything around it. Every other kind
  of content — inline code, monospace, long links, unbroken words, lists — already
  wrapped.

  Code blocks and lists also sat on the browser's own 1em spacing rather than the
  8px every other break in a comment uses, and lists indented 40px, most of a
  nested reply's remaining width. Both now match everything around them.
- The quote under **Focused discussion** stops cutting off passages that very
  nearly fit. A 251-character quote was trimmed to 220, which took its last four
  words to save an eighth of it and ended mid-word on "Minimum ef…" — words that
  were sitting in full in the comment directly underneath. A cut now has to save
  at least a quarter of the passage to be worth making, and when one is made it
  lands between words rather than through one.
- One passage is now one discussion. Two commenters quoting the same sentence
  rarely quote the same span of it — one takes a clause, another the whole thing —
  and a discussion was keyed on the exact characters matched, so those became two
  separate discussions about one passage. Whichever you opened, you found half the
  conversation with no sign that the other half existed.

  Quotes whose spans overlap are now the same discussion, reaching as wide as
  everything that landed on the passage, and the banner shows the passage as the
  article words it rather than whichever excerpt happened to be found first.
  Quotes that merely sit end to end stay separate, because two adjacent sentences
  are two things to talk about.
- Quoting without Hacker News' `>` marker is now recognised as quoting. HN has no
  quote syntax — `>` is a convention, not markup — so a commenter who wraps the
  passage in quotation marks instead, or pastes it as its own paragraph with no
  marks at all, was quoting just as plainly and had it rendered as their own words.
  Both now read as quotes, and the marks come off the way the `>` always did, since
  the styling is what carries the meaning.

  Quoting inside a sentence is untouched: `I think "move fast" is a terrible motto`
  has text outside the marks, and keeps the underline that distinguishes the
  article's words from the commenter's. Only a paragraph that is nothing but the
  quotation folds.

  The unmarked form is decided by the article rather than by punctuation, because
  there is no punctuation to go on. Matching is exact once case, spacing and marks
  are normalised away, so a verbatim paste matches and a paraphrase does not,
  however closely it reads — and an unmarked sentence has to be longer than a
  marked one before it is even tested, since marks are a statement of intent that a
  short quote can rest on and bare text is not.
- A quote rendered as a block no longer underlines its own words as well. The
  indent, the ornament and the italics already say it is a quote; the underline is
  for a quote sitting inside a sentence, where nothing else could show it.
- Leaving a focused discussion returns you to where you were reading, in the
  article as well as the thread. Opening a focus moves both — the thread to the
  banner, and the article to the passage being quoted, so you can see the context
  it came from — but leaving only ever put back the article, and not even that.

  **show all comments** put back every comment the focus had been hiding, all of
  them above the one you were on, and left the scroll position where the short
  filtered list had it, which is the top; the article stayed down at the quote.
  You then had to find your place twice to carry on.

  Your place in the thread is remembered as a comment and how far down the panel it
  sat, rather than as a scroll offset, because an offset stops describing anything
  once the list changes length — which is precisely what filtering does to it. The
  article needs no such care: the sidebar is fixed, so nothing reflows behind it.

  Opening a second focus from inside the first still returns you to where you
  started rather than to the one you passed through; wandering off through the
  article while a focus is open does not cost you your place; and an annotation
  refresh no longer counts as arriving at a focus.
- Scrolling that the panel does on your behalf now stops when you have asked for
  reduced motion. Jumping to a quoted passage, to the focus banner, and back again
  were all animated regardless.
- **[#39](https://github.com/twalichiewicz/HNewhere/issues/39)** — comments sat at
  different distances from one another depending on what each one happened to end
  with: 12px after a single paragraph, 18px after a quote, 20px after a
  multi-paragraph comment. The same thing set the gap under a comment's byline,
  from 4px to 8px depending on what it opened with.

  The cause is that Hacker News opens a comment's first paragraph without a `<p>`
  and never closes the ones that follow, so the opening paragraph arrives as loose
  text rather than an element — as does the reply beneath a quote, which is what
  "> quoted line" plus an answer produces. Loose text becomes an anonymous block:
  it has no margins, and no selector can reach it. So the wrapped paragraphs
  carried spacing the unwrapped ones did not, that spacing escaped the text block,
  and `.comment-layout` being a flex row meant it never collapsed away — it added
  to the gap every comment already had.

  Every paragraph is now a real element before it is styled, which is what lets one
  rule apply to all of them. A comment sits 12px from the next whatever it contains,
  4px under its byline, and every break inside it — paragraph to paragraph,
  paragraph to quote, quote to quote — is 8px.

  Quotes moved from 6px to 8px to join that. The difference was only ever visible
  between two stacked quotes, since anywhere else it collapsed against a
  paragraph's 8px and was hidden.

  A story's own text was on the browser's default paragraph margin, 13px against
  the comments' 8px, so the submission and the replies to it read at different
  rhythms. It now matches.
- Sub-option checkboxes sat two pixels below their labels. The box carried a flat
  2px top margin, which centres it against the 12px settings rows it was tuned
  for and overshoots on the 11px sub-option rows, whose line box is shorter. The
  offset is now derived from the row's own type size, so both sizes land within a
  pixel and a third would too.
- Drawing annotations with the sidebar closed silently disabled automatic
  opening for the site. That combination builds the panel hidden, so the
  highlights have something to hang off, and building it recorded the site as
  one you had collapsed — a preference you never expressed, which then outranked
  the setting. One ordinary visit to a page you had not opened the sidebar on was
  enough to do it. The preload now records nothing; it never had cause to, since
  it cannot run on a site already marked open and only repeated itself on one
  already marked collapsed.

## [1.5.6] — 2026-07-31

### Fixed

- **[#35](https://github.com/twalichiewicz/HNewhere/issues/35)** — the discussion
  lookup ran once, when the script loaded. On a site that navigates without
  reloading — GitHub, and anything else built on Turbo or a client-side router —
  whichever answer it computed first was the one it kept. Landing on a subpage
  and moving to a page that had been posted left the button grey until a manual
  reload; starting on the posted page and moving away left it orange on a page
  that was never submitted. Navigation is now noticed and the page asked about
  again, arriving at whatever a fresh load of that URL would have shown.

  Three signals feed one debounced check, because no single one is reliable
  everywhere: patching `history` is instant but only reaches the page in some
  userscript managers, and is discarded without an error in others; `popstate`
  always arrives but only covers back and forward; a poll catches the rest. A
  fragment, an added tracking parameter, and a burst of pushes that ends where it
  started are all still the same page, and leave the sidebar alone.
- **[#37](https://github.com/twalichiewicz/HNewhere/issues/37)** — a comment's
  text had no line length of its own, and ran to whatever width the panel had
  been dragged to. It now takes a 1215px measure. The composer keeps the narrower
  720px it already had, which is sized to an input rather than to reading.

  The cap is on the text and nothing else. `.children` sits beside a comment's
  text rather than around it, so a reply is not bounded by the comment it
  answers: it starts further right and gets the full measure again. A cap on the
  comment, the list, or the scrolling wrapper would instead compound with the
  indent into a column that narrows at every level, which is the thing the indent
  spends horizontal space to avoid.
- A story's opening paragraph ran into the one below it, with no break between
  them. Hacker News does not wrap the first paragraph of a story's text — it
  emits it as bare text and wraps only the ones after it — so a rule zeroing the
  top margin of `p:first-child` was never matching the first paragraph at all. It
  matched the second, and closed the gap the reader needed. The comment renderer
  takes the same markup and never had the rule.

## [1.5.5] — 2026-07-31

### Added

- **Quotes render as quotes.** Hacker News has no quote syntax — commenters start
  a line with `>` and HN prints the marker literally, so quoted text is styled
  exactly like the commenter's own words. Consecutive `>` lines are now folded
  into a real blockquote, set in italics behind a ❛ in the gutter, with the
  markers dropped. `>>` nests. Code blocks are left alone, since diffs and shell
  prompts legitimately begin lines with `>`.
- Multi-line quotes are clickable, and collapse once you are focused on the
  discussion they belong to. Both behaviours already existed for `<blockquote>`
  elements but could never fire, because HN's API never emits one.
- **The button appears immediately.** It used to wait for the discussion lookup,
  and on the preload-hidden path for the sidebar render and the whole annotation
  pass as well — so on a long article the page looked as though nothing was
  installed. It is now drawn before any network request, with a spinner tracing
  its rim, and turns orange the moment the lookup replies rather than waiting for
  the comments and the annotations. Skipped when "hide HNewhere without a
  discussion" is on, since there it may correctly never appear.
- **The sidebar says what it is loading.** Under the HNewhere title, in sequence:
  loading discussion, loading comments, loading votes, loading annotations. The
  annotations stage is only claimed when that pass will actually run. The status
  opens and closes the header rather than appearing in it, set in dark orange
  with a shimmer travelling through it.
- Motion is suppressed for readers who ask for reduced motion.

### Changed

- **Focused discussion reads as part of Hacker News.** Its header uses HN's own
  pipe-separated meta form — `Focused discussion | show all comments` —
  left-aligned, in sentence case, with the close as a text link rather than a
  floating `×`. The quote sits at the comment text size, opened and closed by
  paired ❛ ❜ ornaments that distinguish it from the single-marked quotes in the
  stream. Aligned to the story's own left edge and capped at the composer's
  720px. Drops a bespoke brown palette that appeared nowhere else.
- A discussion anchors to the line it quoted rather than to the enclosing quote
  block. The block is the fallback, used only when the quote genuinely spans more
  than one line. It was previously tried first and claimed whenever it merely
  contained the quote, so with several discussions quoting one comment, whichever
  was processed first took the whole thing.
- Entering a focused discussion scrolls to the banner instead of centring the
  matched comment, so the filtered thread is read from its start. Re-applying an
  already-open filter still does not scroll, since annotations refresh on resize
  and on setting changes.
- Filtering fades only the comment list. The story header, the composer and the
  banner stay put, rather than the whole sidebar blinking for what is an edit to
  the list underneath.
- Header icons are drawn rather than typed. The gear and the minimize dash were
  text characters, and flexbox centres a glyph's line box rather than its ink —
  so the gear sat about a pixel low and the dash half a pixel high, while the
  drawn eye was exactly centred and read as the odd one out. All three are now
  paths on the same 16-unit grid, aligned by construction on every platform.
  Retires the iOS workaround that kept the gear from rendering as a colour emoji.
- The sidebar builds its chrome before loading stories rather than after. The
  panel does not depend on them, and loading first meant the reader watched an
  empty page through the slowest part of startup.
- Startup reads settings, sidebar state, the last-clicked story and the
  blocked-site list together rather than one after another, as does each
  discussion's seen time and collapsed set.
- Vote arrows fade in. They cannot be drawn before HN's per-item auth link has
  been fetched, so they always arrive late; their slot was already reserved, so
  only the snap needed fixing.
- Comment text is read block-aware when scoring discussion heat. It previously
  used raw `textContent`, which butts the last word of a paragraph against the
  first word of the next and tokenizes the join as a single junk term.

### Removed

- The author chips under a focused discussion. They repeated what the filtered
  list already showed and did not survive a discussion with more than a handful
  of participants.

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

[1.5.7]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.6...v1.5.7
[1.5.6]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/twalichiewicz/HNewhere/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.8...v1.5.0
[1.4.8]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/twalichiewicz/HNewhere/compare/v1.4.6...v1.4.7
