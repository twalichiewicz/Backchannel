# Changelog

All notable changes to Backchannel — formerly HNewhere — are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `HNewhere.user.js`'s `@version` header is what userscript managers
use to detect updates, so every release bumps it.

## [1.6.1] — 2026-08-05

### Added

- **Bluesky, as a third source.** Bluesky has no thread for a link — a page that
  got attention was posted by dozens of people as dozens of separate posts — so
  it arrives as one conversation rather than one entry per poster, with each
  post and its replies merged into the same thread as everything else. Posts
  with no replies are left out; on one measured article that removed 135 of 141,
  nearly all of them bots reposting links.

- **It is read without an account and without cookies.** Discovery goes to
  Constellation, an independent index of which posts link which URLs, because
  Bluesky's own search needs credentials. Bluesky is then asked only about the
  posts Constellation names, never about the page you are on. Off until you turn
  it on, marked BETA, and read-only.

### Changed

- **The header names the page, not one person's submission.** It used to show
  whichever submission happened to sort first, so visiting a page could hand you
  an unrelated stranger's framing as the page's own name — on `example.com`, an
  r/WindowsHelp thread title. Once the panel reads several sources it
  generalizes, and the generalization of a title is the title of the content.
  The title someone submitted under still appears where it is doing a job the
  page's title cannot: identifying which discussion you have filtered down to.

- **Links point at the repository's real name.** The install and update URLs
  named `HNewhere`, and worked only because GitHub redirects the old name — a
  redirect that ends the moment anything is created there, which would strand
  every installed copy's auto-update. Nothing about your install changes; it
  updates itself as usual.

- **The excluded-domain list says what it means.** Six Google patterns collapse
  into one, and the loopback exclusion covers the whole `127.*` range rather
  than a single address. Both it and `localhost` now cover a port, so a dev
  server on `:3000` is excluded — which it was not before, and that was the
  common case. `*.bank.com` came out: it matched one registered domain and no
  actual bank, while the runtime block list has covered banking properly all
  along. Thanks to the reporter of #52 for the audit.

- **The shape every source is read through is written down.** Nothing you can
  see changes. It used to be asserted twice, in two styles, with nothing
  requiring a definition to exist — so a third source would have been checked
  against whichever of the two its author happened to read. It is now one table,
  and every source is checked against it mechanically.

### Fixed

- **Posting a comment no longer warns that it might not have worked.** A comment
  that went through could still come back with "Submitted, but Hacker News did
  not show the comment back" — about one in seven of them. The check compares
  what you typed against what the page shows, and there were two differences it
  did not account for: Hacker News renders a blank line as a paragraph, which
  runs the words either side of it together, and it turns `*emphasis*` into
  italics, which drops the asterisks. Both sides are now compared on the same
  terms. Measured across 468 real comments: 65 of them would have been reported
  wrongly before, none are now.

## [1.6.0] — 2026-08-04

### Changed

- **HNewhere is now Backchannel.** The name described a product that checked one
  site. This one asks several, so it is named for what it shows rather than where
  it looked: the conversation running alongside the page you are reading. The
  accent colour moves off Hacker News orange for the same reason — the panel
  speaks for several sources now and should not wear any one of their colours —
  and the floating button reads **BC** rather than **HN**.

  The repository, the filename and the install URL are unchanged, so an install
  that auto-updates renames itself in place and keeps everything. Stored settings
  keep their old key prefix too: renaming them would be invisible to you and
  would risk your queue and hidden-site list for nothing.

  **If you reinstall by hand rather than letting it update, remove the old
  HNewhere entry afterwards.** Userscript managers match a manual install on the
  script's name, so a rename arrives as a second script rather than a new version
  of the first — and both would run, on every page, at once.

### Added

- **Reddit, and a source picker.** HNewhere told you what Hacker News said about
  a page. It now tells you what the internet said: Hacker News and Reddit —
  every subreddit a link was posted to — merged into one conversation rather
  than presented as two feeds. Each source is a checkbox, including Hacker News
  itself, so a reader who wants only one gets only one. A fresh install opens on
  the picker; an existing install keeps Hacker News on and sees no change.
- **Reddit is marked BETA**, the way annotations are. It works, and there is more
  of it to come — no front page, no writing, and long threads fill in on request
  rather than arriving whole.
- **Reddit is read-only and off by default.** Enabling it sends the pages you
  visit to reddit.com, and if you are signed in to Reddit those requests arrive
  as your account — Reddit sets a second session cookie, `reddit_session`, which
  unlike `token_v2` is `SameSite=None` and travels cross-site. Signed out they
  carry a long-lived device identifier instead. That is a real trade, and it is
  stated where the checkbox is rather than in a document nobody opens. Nothing is ever posted to Reddit on your behalf.
  When reddit.com declines the request the sidebar falls back to a cookie-free
  archive mirror, so the comments still arrive.
- **The floating button's label is yours.** It read `HN` when Hacker News was the
  only source and `BC` after the rename, and neither is right for everyone. The
  preview in the settings panel is now the field: click it and type one or two
  characters. It is the preview precisely so the mark is edited on the thing it
  applies to, at the size and colour it will actually be.
- **The accent colour is yours.** The measure under the button in Settings used
  to caption the button's width, which the stepper beside it already states.
  It carries the accent's hex instead, and you can type over it: leaving the
  field applies it, Enter commits, Escape abandons, and emptying it goes back to
  the built-in colour.

  The panel keeps its accent as a pair — one value for a light background and a
  lifted one for a dark background, where the light value reads muddy — so a
  colour you type has to become a pair too. Each half is walked until it clears
  4.5:1 against the panel it sits on, which is what body text is asked for. How
  far it has to move depends entirely on what you type: the built-in green needs
  a sixteen-point lift to be legible on the dark panel, a pale green needs none,
  and yellow has to come down to be legible on the light one. The header behind
  it goes the other way and is held to the same bar behind white.

  The mark on the button follows too, black or white depending on what it is
  sitting on. That was worth fixing regardless: the dark theme's accent is
  lifted, which makes it a light colour, and white on it was 2.9:1 — a mark you
  had to look for.

- **A single blended thread.** Top-level comments from every discussion are
  interleaved by where each one ranks within its own discussion, so a big thread
  contributes proportionally more without an upvote ever being compared to a
  point — Hacker News publishes no comment scores, so that comparison was never
  available. Reply trees stay intact beneath their own root, and the source sits
  in the byline at the weight of the timestamp: available, not announced.

### Fixed

- **Long Reddit threads are no longer truncated in silence.** Reddit returns a
  large thread in pieces and marks the gaps; those gaps now say how many replies
  are behind them and fill in when asked. A gap that cannot be filled — the rate
  budget runs out on a very long thread — says so and stays, rather than
  disappearing as though there had been nothing there.
- **Indent guides line up with the comment they belong to.** They sat eight
  pixels past the parent's first letter, which read as a slight stagger down a
  long thread.
- **Reply, flag and favourite no longer appear on comments that cannot take
  them.** They are offered where the source supports them and nowhere else; on
  Reddit they would have acted on an item id Hacker News never issued.
- **A switched-off source stays off, whichever way the panel is opened.** The URL
  lookup consulted your sources; arriving from Hacker News, opening something
  from the queue and reopening a thread after commenting did not, so a source you
  had turned off could still fill the sidebar. Every path goes through one check
  now.
- **The front page is only offered when Hacker News is on.** It is Hacker News'
  own page, so with that source off the tab goes — and with an empty queue there
  is nothing behind the wordmark at all, so the wordmark goes too rather than
  opening onto an empty list.
- **A single discussion gets a single heading.** The page header, a source pill
  and the submission's own line were three headings saying one thing. With one
  discussion the page header steps aside entirely and the submission reads the
  way a Hacker News story does: the arrow, the title and the subline as one
  unit, count and all.
- **A failed lookup is no longer cached as "no discussion".** `request()`
  resolves null on an error, a timeout or a bad response, so a moment offline
  stored an empty result for the full hour and left a page showing a grey button
  long after the connection came back.
- **Reddit no longer offers a comment box.** Every Reddit submission carried
  *Add a comment…* and a button to send it, on a source that ships read-only. A
  box that cannot send is worse than no box: it invites you to write something
  and then has nowhere to put it. The composer now follows the source's reply
  capability, and the reply box under each comment goes the same way — its link
  was already hidden, so the box could never be opened anyway.
- **A resubmitted link leads with the discussion happening now.** Instances of a
  story were ordered by how many comments each had, so an article posted again
  this morning opened on a thread from December 2024 — that one had 49 comments
  against today's 11 — and the conversation you could still join sat behind it.
  They are ordered by when they were posted now, and size only settles a tie.
  Nothing is hidden either way, so the older thread is one pill away whatever
  its size.
- **Repeated submissions are told apart by date.** A link posted to the same
  site twice gave two pills both reading "HN", which named neither of them.
  They carry the month they were posted where they would otherwise read the
  same — `HN · Aug 2026`, `HN · Dec 2024`, `HN · Nov 2024`. A lone discussion
  keeps its bare label, and subreddits already differ so they are left alone
  unless one carries two posts.
- **The pills count comments, not the roots they had loaded.** They disagreed
  with everything around them — the header totalled 325 while the pills summed
  to 100, and filtering to a pill marked 26 opened a submission line reading
  "96 comments".
- **The filter controls agree with the filter.** The source strip was updated by
  its own press and nothing else, so filtering to a discussion, focusing a
  comment inside it and then pressing *show all comments* cleared the filter
  while leaving the pill lit for one that was no longer on.
- **The upvote arrow sits beside the line it belongs to.** Where a submission's
  title repeats the page header it is dropped, and the arrow was left in a row
  of its own pointing at an empty cell. It moves down to the byline, which is
  then the first line the submission has.

### Changed

- **The accent is green.** `#237140`, in place of the indigo the rename first
  landed on. The indigo said nothing about conversation.
- **The front page tab says whose front page it is.** It read *front page*,
  which was unambiguous while Hacker News was the only source. The queue beside
  it stays unqualified, because it is not any source's.
- **The discussion count is gone from under the wordmark.** It counted
  submissions when the panel had no other way to say there were several. The
  source strip names every one and carries its own count, so "7 discussions"
  above it was a worse version of the row beneath.
- **Filtering to a source no longer explains itself twice.** Pressing a pill lit
  that pill and then said *Showing r/programming* underneath it with its own
  *show all comments* — the same state and the same control, one line apart. The
  banner stays for a quoted passage and a focused comment, which have no marker
  of their own. The hatched divider that marks a change of subject appears above
  the revealed submission instead, and the source label beside each comment goes
  while the filter is on, since every comment on screen is from it.
- **The Reddit note in Settings is shorter.** It said the source was read-only,
  which the table directly beneath it shows in three columns, and that Reddit
  can tie your browsing to your account, which restated the sentence before it.

- **One sidebar, whatever the page turns up.** A single discussion used to get a
  submission header and several got a page header, so the panel looked like a
  different product depending on how many places a link happened to reach. The
  page is the header now; each submission's own score, author and actions sit
  beneath it, and the source strip is how you get to one of them.
- The quoted-passage tooltip picks the earliest comment by time rather than the
  first in thread order, which stopped meaning anything once a passage could be
  quoted from more than one discussion.
- Checking a page no longer fetches every submission's full item up front. The
  search result already carries the title, score, comment count and author, and
  only the comment list needs more — so a page check costs the two requests it
  always did, rather than two plus one per submission found.

## [1.5.8] — 2026-08-02

### Added

- **The sidebar can show the Hacker News front page.** Reading an article with
  HNewhere open, you could reach its discussion and nothing else; deciding what
  to read next still meant going back to Hacker News. The wordmark in the panel
  header is now the way there, and the way back, with the list paged the way
  Hacker News pages its own.

  It leads to **Read more** rather than to Hacker News, because Hacker News is
  only one of the two things behind it. Your queue is the other, and it is the
  half you put there yourself. An ellipsis after the wordmark says the title can
  be pressed at all — it has no border, no background, and on a touch screen no
  hover to discover it with.

  A story opened from that list is opened the way one clicked on Hacker News is.
  The panel records the click exactly as it does while you are on HN, so the page
  you land on reads it as an arrival — which means automatic opening applies, and
  so does *Only when arriving from Hacker News*, without either of them knowing
  this path exists.

  The discussion you were reading is hidden while you browse rather than thrown
  away, so coming back puts you where you were, part-scrolled, with any focused
  discussion still open. The two cross-fade, and the header opens into the trail
  the same way the settings panel opens into its hidden-sites list: a chevron
  sliding out from nothing, the trail fading into place behind it. It is the same
  movement — a level opening inside the panel with the way back left behind — so
  it is built from the same parts.

  It is reachable from pages that have no discussion at all, which is where the
  question is asked most sharply: the wordmark is in the submit popover's header
  too, and opens the panel straight into browsing — sliding in from the edge it
  is docked to, since it is replacing a small box beside the button with a
  full-height panel and the movement is what connects the two. A panel opened
  that way leaves the page as it found it: minimizing gives back the grey submit
  button and records no preference about a discussion that does not exist.

  The first page offers *More*, which is what Hacker News offers. Deeper in, where
  there is a way back as well, the row says which page you are on.

- **A reading queue.** *queue* on any story — on Hacker News itself, in its own
  row in front of *flag*, or on any row in the sidebar's front page — puts it in
  a list, and the list is waiting under *Queue* when you want it. At the foot of
  a finished discussion, where the question actually gets asked, a strip offers
  whatever is next.

  Arriving at something you queued marks it read rather than removing it. The
  match is on the normalised URL, so a tracking parameter picked up on the way in
  does not defeat it — but a URL match can still be wrong, and something quietly
  eaten cannot be corrected, so read entries dim and sink beneath the unread ones
  until you clear them.

  **The queue is offered on Hacker News itself**, once there is something in it.
  That is where a queue gets filled, often across several pages, and what you do
  next is read it — which otherwise meant remembering what you had put in. The
  button appears there and opens the panel on the queue. Nothing sits behind the
  trail there, the front page being the page underneath, so the wordmark reads
  *HNewhere / Queue* and stops being a way back.

  Everywhere else the queue leads as soon as it has entries: the *Queue* tab
  moves in front of *Front page* and is what the panel opens on. Switching tabs
  lasts as long as the panel is open and no longer, so one press cannot quietly
  turn that off. The trail names whichever you are looking at — *Queue*, or
  *Read more* on the front page.

  A queued story is described the same way a front-page one is, because the queue
  is the same list with most of it filtered out. Scores and comment counts are
  refreshed when you open it, since a queue is read days after it was filled.

- **A focused discussion can now be built around any comment.** The sidebar
  could already filter a thread down to one conversation, but only through a
  quoted passage — which meant the feature was unavailable on the great majority
  of comments, the ones that quote nothing. *focus*, beside *reply*, shows a
  comment's chain up to the root and everything below it.

  That is Hacker News' own `parent`, `root` and `context` in a single view, and
  it is the same view a quoted passage opens rather than one that resembles it:
  both ask for a comment's ancestors and its whole subtree, and both return you
  to where you were reading when you leave.

  The banner says which it is. A quoted passage is shown between quote marks,
  because they are somebody else's words lifted from the article; a comment is
  named by its author, because it is the comment itself.

- **Favorite and flag, on stories and on comments.** The sidebar offered one of
  Hacker News' actions and read as though it offered them all.

  These take a different route from the rest of the panel. Everything HNewhere
  reads, it reads over a cross-site request, and the browser strips Hacker News'
  session cookie from those — so the page that comes back is a logged-out one,
  which renders no favorite link and no flag link at all. There is no state to
  read and nothing to act with. Both therefore travel the same way a vote does,
  through a brief popup on Hacker News itself, which is the only place the truth
  is visible; what it reports is what the panel remembers.

  Both links appear everywhere, because the panel cannot know in advance whether
  either applies to you. The popup finds out — being logged out and being below
  the karma flagging asks for look identical from here, which is to say the link
  simply is not there — and the answer is kept, so a link that cannot work
  retires rather than being offered again on every comment.

### Changed

- **A hatched band marks where the panel changes subject.** An article submitted
  to Hacker News more than once shows each submission in turn, and the break
  between them was a hairline — which says "and" where it means "different thing
  now". It is diagonal hatching now, running the full width of the panel rather
  than stopping short of its edges, and the same band separates a finished thread
  from what to read next.

- **The line under a story title follows Hacker News' order and punctuation.**
  It reads `214 points by someone 2 hours ago | flag | favorite | 21 comments`,
  where HN reads `118 points by eniac111 6 hours ago | flag | hide | past |
  favorite | 17 comments`. Ours had a bar between the author and the age, where
  HN uses a bare space, and put the comment count in the middle of the actions
  rather than at the end of the line. The same corrections apply to comments,
  where *flag* now precedes *favorite*.

  This is a change to a line that was already there — the story header at the
  top of every discussion — rather than only to the new front page.

- **The front page is set to Hacker News' own measure.** A story there runs 35px
  from one title to the next: a title line, a subtext line, and a five-pixel
  spacer. Ours ran 65. Most of the difference was that the story header's type is
  sized for the top of a discussion, where the story is the headline and the only
  one on screen; thirty of them in a list is a different job. A single-line row
  now measures 35.4px, and the separator between links carries HN's own spacing
  rather than twice it.

  Titles still wrap where Hacker News' would not. That is a 420px panel against a
  1200px page, and it is the panel's width rather than its spacing.

### Fixed

- **A focused discussion was leaving out the replies to the comments it
  focused.** It was meant to show a matching comment's chain up to the root and
  everything below it, and it showed the chain alone — so the thread you were
  handed stopped exactly where the conversation started. Focusing a thread's own
  root comment showed that comment by itself.

  The walk climbs and it descends, and the descent was refusing to start. It
  declined to walk any comment already on screen, which is a sensible guard
  against covering the same ground twice — except that the climb ran first and
  put the focused comment on screen, so the descent found its own starting point
  already there and stopped. The two walks are asking different questions, and
  they now keep separate answers.

- **Discussions on X are found again.** X renamed itself and Hacker News did
  not. HN holds years of submissions under `twitter.com` while the site now
  serves `x.com`, and the lookup asked for the address it was standing on — so a
  tweet with a couple of hundred comments waiting on it came up empty and got a
  grey button.

  The two names are read as one now, on both sides of the comparison: the
  address in hand and every submission it is measured against. Which of the two
  a given link happens to use therefore stops mattering, in either direction.

- **A page's own text styling no longer reaches into the sidebar.** Shadow DOM
  keeps a page's selectors out but not its inheritance, and the panel pinned its
  font and its colours without pinning anything that moves text about. A site
  that centres its body centred the entire panel, comments and all.

  `text-align` is only the one that turned up. The same door was open for
  `text-transform`, `letter-spacing`, `word-spacing`, `font-style`,
  `font-variant`, `text-indent` and `white-space`, each of them waiting for the
  site that happens to set it, so they are all shut now.

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
- **[#39](https://github.com/twalichiewicz/Backchannel/issues/39)** — comments sat at
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

- **[#35](https://github.com/twalichiewicz/Backchannel/issues/35)** — the discussion
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
- **[#37](https://github.com/twalichiewicz/Backchannel/issues/37)** — a comment's
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

- **[#32](https://github.com/twalichiewicz/Backchannel/issues/32)** — host pages
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
[GitHub releases](https://github.com/twalichiewicz/Backchannel/releases) and the
commit history. Entries for 1.4.7 through 1.5.3 are summarized from their release
commits rather than written at the time.

[1.6.1]: https://github.com/twalichiewicz/Backchannel/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.8...v1.6.0
[1.5.8]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.7...v1.5.8
[1.5.7]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.6...v1.5.7
[1.5.6]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.5...v1.5.6
[1.5.5]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.4...v1.5.5
[1.5.4]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.3...v1.5.4
[1.5.3]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/twalichiewicz/Backchannel/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/twalichiewicz/Backchannel/compare/v1.4.8...v1.5.0
[1.4.8]: https://github.com/twalichiewicz/Backchannel/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/twalichiewicz/Backchannel/compare/v1.4.6...v1.4.7
