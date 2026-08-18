# Changelog

All notable changes to Backchannel — formerly HNewhere — are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `HNewhere.user.js`'s `@version` header is what userscript managers
use to detect updates, so every release bumps it.

## [1.6.11] — 2026-08-17

### Added

- **new first**, beside the Sort control at the top of a discussion. It appears
  only when you are returning to something you have read before and there is
  something new in it, and it is off until you press it. On a return visit the
  comments posted since you were last here rise to the top, and the ones that
  were already there follow. A live discussion still leads a quiet one, and the
  order inside a thread is untouched. On a page with a single discussion — where
  there is nothing to sort across and so no Sort control — it appears on its
  own. (#112)

### Changed

- **The green mark clears once a comment has been on screen**, rather than only
  after you scroll past it or press it. A comment you can see has been seen. It
  takes about a second of being on screen, so a comment that flashes by while you
  scroll somewhere else keeps its mark, and one below the fold keeps it until you
  get there. This used to happen only on touch devices; it now happens
  everywhere. (#112)

- **Nothing is marked unread the first time you open a page.** A discussion you
  have never read has nothing to be new against, and marking all of it green said
  nothing. The visit is recorded, and the next time you open that page the mark
  means what it says. (#112)

- Changing the comment sort no longer clears every unread mark. The panel now
  holds the time of your arrival for as long as you are on the page, instead of
  re-reading a timestamp it had already moved forward.

- **front pages**, **queue** and **collection** carry the dotted underline that
  marks everything else you can press, and the one you are on is underlined
  solid. They were told apart by color alone, which did not say they were
  pressable.

- **The front page loads as a skeleton of the page it is about to show**, rather
  than a line of text where the first row goes. The line saying what is loading
  now sits at the same left edge as the tabs and the blend note above it.

- **Where a source has both arrows, the one you did not use dims** once a vote is
  placed, instead of sitting at full strength beside the one you did. Hacker News
  is unaffected — it replaces its arrow with **unvote**.

- **Blended from …** is set at the size of the byline it sits above, rather than
  a step larger.

- The queue tab is **queue**, without a count after it. What is unread is already
  said by the rows themselves.

- **The queue and the collection each say what they hold**, the way the front page
  says what it is blended from: *Discussions you've queued or are watching*, and
  *All of your favorited discussions, comments, and notes*. The line slides with
  the list when you move between the three.

- **The collection's sections fold.** *favorite discussions*, *favorite comments*
  and *notes* each carry a **[–]**, so a long collection can be read a part at a
  time.

- **new first** is **prioritize unread**, and sits with the comments it reorders
  rather than at the top of the panel. A pipe separates it from Sort.

- **One box writes both a comment and a note.** It carries two buttons that say
  what they do: a green **comment** that sends what you wrote down to the
  discussion, and a grey **note** that keeps it up in your notepad. Which buttons
  it shows depends on what is possible — a source that takes no replies offers
  only the note, a reader with the notepad off gets only the comment, and where
  neither applies there is no box at all. Filtering a blend down to a source that
  takes no replies takes the green button away with it. The notepad no longer
  carries its own **add a note**, and a note written in the box still anchors to
  a passage you quoted, as before.

  **A page carrying several discussions had no comment box at all** until now —
  every composer sat inside a per-discussion block that a blend keeps hidden.
  There, the green button asks which discussion you meant, from a list that drops
  below it and scrolls when the blend is a long one; filtered to one, it goes
  straight there.

  **Scroll the box out of sight and it follows you**, as a pill under the header.
  Pressing it opens the same box, still holding whatever you had half-written;
  scrolling back puts it home.

  The box is one line tall until you write in it, then keeps a spare line below
  whatever you have written, and falls back to one line when you press away from
  it; dragging its corner still sets a height of your own. Its two buttons and
  **formatting** share a row inside the same border as the text. The notepad,
  where you have written one, sits above the box, and the comments below it.

- **Sort is offered on a single-source discussion too.** It used to appear only
  where more than one discussion was being blended, on the grounds that Best is
  a site's own order and there is nothing to choose. That holds for Best and not
  for the other two: Newest and Oldest reorder a single discussion from times
  the panel already has. Best is still there, and still means the order the site
  gave.

- **Collapsing a comment takes its indent guide with it** rather than leaving a
  stub of it behind holding the row open. Expanding draws the guide back down
  from the top.

- **The notifications option is hidden where the browser has no notifications to
  give**, which is most of them on a phone. It was a checkbox that could be
  pressed and would then quietly un-tick itself.

- **On a discussion from a single source the notepad sits with the piece**, after
  the story and above the box you write a comment in, rather than at the very top
  of the panel. A rule above it keeps it from reading as part of the story's own
  text. On a page carrying several discussions it stays where it was, above them
  all.

- A note in the notepad is given the same room below it as above it. The last one
  used to sit on the rule beneath it.

### Fixed

- **A Hacker News action on a phone reported a blocked popup and left nowhere to
  go.** Voting opened its window one step after the press rather than during it,
  which is when browsers stop allowing it — measured across three engines, only
  the synchronous case keeps the activation a popup blocker looks for. The window
  is now opened while the press is still running. If it is blocked anyway, the
  message no longer points at a setting that iOS does not have: it offers the
  address, and pressing it does the same thing in a tab. (#109)

- **A link underneath a highlight could not be pressed.** Each highlight was a
  button laid over the article, so it took the press from anything beneath it.
  The highlight is now drawn whole and made pressable only where nothing else is,
  which leaves links, buttons and fields to the page. (#110)

- **The panel's left edges did not line up.** The wordmark sits 8px further in
  than everything below it, and only some of the things below it made up the
  difference. A discussion's title and byline, **NOTEPAD**, the **Sort** row, and
  the numbered rows on the front page and in the queue all start on the wordmark's
  edge now. The numbers themselves were also set right-aligned in their column,
  which pushed them off that edge whatever the column did; they read from the left.

- **The LIVE bookend and the rule under a blended discussion's byline** started
  8px left of everything else, for the same reason the rest did.

- **The notepad's notes, and the box you write one in, started on the panel's
  edge** while the NOTEPAD mark started on the wordmark's. They start together.

- **The box you write a comment in, and the numbers on the front page and in the
  queue**, both start on that same edge now. The numbers' column also held room
  for four digits where two was the most it ever needed, which left the number
  stranded away from the title beside it.

- **The rule above the notepad ran wider than the one below it**, and **add a
  note** carried no underline to say it could be pressed. The two rules match,
  and it does.

- **queue** and **collection** were losing their dotted underline to the
  `overflow:hidden` that lets them slide open. They keep it.

- **Returning to the front page from another tab showed the old rows** until the
  new ones arrived, with no sign anything was loading. The list is cleared when
  the tab changes, so the skeleton appears.

- **A discussion's title was set larger than the header it stands in for**, so
  narrowing a blended page to a single source made the title jump a size. Both
  are set the same now.

- **A source that cannot vote no longer holds a column open for arrows it will
  never have.** Filtering a blended page down to Bluesky, Lemmy or Wikipedia used
  to leave the title indented past an empty gutter; it starts where the rest of
  the panel starts.

- **A story's vote arrows sat on its title.** The column holding them was 14px
  wide and the arrow inside it 10px, drawn centred — so it overhung its own cell
  and touched the words. Both a story's arrows and a comment's now use one
  column, so a title clears them by the same margin a comment's text does.

- **A settings hint started two pixels left of the label it belongs to.** The
  label clears a 15px box and an 8px gap, and the hint was indented 21px rather
  than 23. Sub-options were out by the same two.

- **The line down the left of a comment went missing on about half of them, with
  no pattern to it.** The line hangs below the vote arrows and takes whatever
  height is left over. A two-arrow pair is 22px, and with the padding above and
  the gap below that is 26px — exactly the height of a one-line comment, leaving
  the line nothing at all. Which comments lost it therefore depended on how many
  arrows their source draws and how short they happened to be. Measured on a real
  thread: 85 of 182 comments had no line. The line now has a minimum length, and
  short comments give it the few pixels it needs.

- **Vote arrows never finished loading on a page carrying more than one
  source.** A comment was told to expect arrows whenever *any* source in the
  panel could vote, but arrows are fetched one discussion at a time and only for
  the sources that have them. Comments from Bluesky, Lobsters, Lemmy, Wikipedia
  or Hypothes.is were left holding a placeholder nothing was ever going to fill.
  A comment now expects arrows only where its own source can vote. The gutter is
  still held across the whole thread, so the comment guides stay lined up.

- **Highlights stayed where the text used to be** when the page reflowed —
  changing text size, a font arriving late, anything above them growing. They
  only followed the window being resized, so scrolling a page with images loading
  appeared to fix them. They now follow the article itself. (#111)

## [1.6.9] — 2026-08-13

### Added

- **Watch a page, and be told when someone starts talking about it.** Discovery
  happens once, when you land: a page nobody has posted anywhere yet is dark, and
  stays dark however long you sit on it. **watch**, next to the comment count,
  keeps asking. When a discussion turns up it goes into your queue as unread, and
  the watch stops. Checks ride the page loads you were already making rather than
  running on a schedule, so a page you never go near again is checked rarely, and
  a watch that cannot be answered several times running says so instead of
  waiting silently.

- **Enable notifications for updates to watched discussions**, under Enable
  notepad in settings. Off to begin with, and ticking it is what asks for
  permission to send notifications. Left off, a watch still lands in your queue —
  the notification only decides whether you are told before you look.

- **Collection**, a third tab beside front pages and queue, holding what you have
  kept rather than what you are working through, under three headings: favorite
  discussions, favorite comments, and noted. A comment and a note are a piece of
  writing rather than a headline, so each is shown as itself — set as a quote,
  cut to a line — above who wrote it and which discussion or page it is in.
  Opening a favorited comment loads the page its discussion is about and focuses
  that comment. **noted** lists your notes one by one, newest first, each with an
  **edit** and a **delete** that reach the note itself rather than just the row —
  so the place you go to find a note you wrote elsewhere is a place you can
  change it. Nothing in the collection is numbered; the rows are told apart by
  the room between them.

- **Favorites are kept here rather than on the source**, which is what lets them
  work everywhere — Bluesky, Mastodon, Lemmy and Hypothes.is have no way to
  favorite anything, and a favorite that only worked on some of your sources
  would be a stranger thing than one that works on all of them. Nothing is sent
  to your account.

- The number of notes you have taken sits under Enable notepad, next to export.

### Changed

- Front pages and queue read as two halves of one page rather than two places.
  The wordmark stays **Backchannel** across both instead of becoming
  Backchannel / Queue, the pair sits under it rather than indented past it, and
  moving between them slides.

- A watched page with something new rises to the top of the queue, newest first,
  marked with a filled bullet and **UNREAD**.

- **clear read** leaves watched pages alone. Unwatching one drops it into the
  queue, where it clears like anything else.

- **un-favorite** is **unfavorite**, and **remove** in the queue is **unqueue**,
  matching unwatch.

- **favorite keeps an item here rather than favoriting it on Hacker News.** It
  used to do the latter, through the same popup vote and reply use. Every source
  has some equivalent of favoriting and only Hacker News could be wired to it,
  so it is kept locally for now and works on all of them.

- **favorite is on everything there is to keep**, rather than on Hacker News
  alone: every source's discussions, in both the front pages and the queue, and
  every comment in them. A favorited item now says **unfavorite** wherever it
  appears, which it did not when the label was still asking Hacker News.

- A page carrying several discussions is favorited as a page. **favorite** sits
  beside watch above them, keeping the page rather than picking one of them.

- A watched page keeps its color once read. The bullet beside it already says
  whether there is anything new, and a watch is something you asked to keep
  hearing about.

- The **BETA** pills are gone from the sources. Every source carried one, which
  made it say nothing about any of them. **Favorite** and **Flag** have gone from
  What each source supports for the same reason — favorites are kept here, so
  there is nothing per-source to report.

- The explanation under Enable notepad folds away when it is ticked, the way the
  other settings' explanations do.

### Removed

- **flag** is gone. It was Hacker News's alone, it could not be offered anywhere
  else, and it is the one thing here that asks a moderator to act rather than
  keeping something for you. Flagging is where it always was, on the item's own
  page.

### Fixed

- **Queueing a story only worked once.** A front page row names no key of its
  own, so the first story queued stored an empty one and every story queued
  after it was read as the same story and dropped without a word. Entries
  already saved that way could not be removed either, and were cleared even
  where the page was being watched. (#107)

- The top of the field was cut off when you started a note, and the note saying
  a quoted passage was not found was cut off below **save** and painted under
  the note beneath it. The draft gives up the clipping it slides open with once
  it is open.

- Editing or deleting a note from **collection** while reading a different
  article moved that note to the article you were reading. A note keeps the
  address it was written at.

- The notepad sat below every comment on a discussion from a single source, and
  **favorite** was missing from that discussion's byline. Both now read the way
  a blended discussion already did.

- Filtering a blended discussion to one of its sources took your notes away with
  it, and writing a note dropped the filter and put the blend back. Notes belong
  to the page rather than to any one discussion of it, and the filter survives.

- A settings checkbox sat below the line of its own label. It is centered on that
  line now, and a little larger, so it nearly fills it. **reset** lights up under
  the pointer the way **export** does.

- **reset**, **Backchannel** and **Report an issue** each drew a different
  underline in a different font. They read as **export** does, which is what
  every other small action in the panel looks like.

- The discussion count in a blended header underlines on hover, the way the
  toggles beside it do.

- Some pages changed the spacing of everything in the sidebar. The panel resets
  what a page can send into it and let one property through — line height — so a
  page with unusual spacing reshaped the panel. (#105)

- A Lemmy discussion stretched its pill out of shape under **discussions**,
  because the community's full address is a good deal longer than `HN` or
  `r/OpenAI`. Long names are shortened; the count stays. (#106)

- A comment count reads **418+ comments** rather than 418 comments+.

- A quoted passage that appears more than once in a page now anchors to the first
  one instead of refusing to anchor at all and reporting that the passage was not
  there.

- The reason a note could not be pinned to a passage is attached to **save**,
  where the answer is, rather than sitting beside cancel where it read as another
  button.

- A rule inside a comment is drawn as a hairline, the same as every other line in
  the panel, rather than the browser's default groove.

- The notepad's closing rule is there on first load, not only after it has been
  opened once, and **add a note** and **show** have a separator between them.

## [1.6.8] — 2026-08-12

### Added

- **A notepad of your own, on any page or PDF.** Select a passage and write what
  you think of it, or open the notepad and write without selecting anything. A
  note keeps the passage it was written about, so it lights up in the article the
  way a commenter's quote does, and clicking it filters to the note. It sits in
  its own section above the sort, and it is a setting rather than a source —
  nobody else is in it, so it does not belong in a list of places to fetch from.
  It is on to begin with, and unticking Enable notepad takes the section away.

- Notes are yours to take away. **Export** next to the setting writes every note
  across every document to a JSON file: the text, the quoted passage, and enough
  context to find that passage again. Notes live in your userscript manager's
  storage, which means they do not follow you to another browser and a manager
  reset takes them with it — the export is the answer to both.

- A note is edited as text rather than through a form. The quoted passage is a
  `>` line at the top, so changing your mind about which words you meant is
  editing a line, and the highlight moves to the words you left in it.

- **Enhanced PDF support**, off by default, under Enable annotations. Turned on,
  it covers Chrome's and Safari's PDF viewer with
  [pdf.js](https://mozilla.github.io/pdf.js/), which is what lets a quoted
  passage be highlighted on the PDF itself. It is a choice rather than the
  default because it downloads 1.74 MiB of pdf.js from `cdn.jsdelivr.net` — the
  one part of the script that is not self-contained. Safari's own PDF toolbar
  still floats above the reader and cannot be removed. **Firefox is not covered
  at all**: it reserves its built-in PDF viewer, no extension is allowed to run
  there, and a PDF opened in Firefox gets no button, no sidebar and no
  highlights — the setting has no effect.

### Changed

- A PDF is named by its title. The panel used to head the discussion with the
  host, so every paper on a preprint server read as the same thing.

- Lemmy comments render their Markdown. Lemmy's API hands over Markdown rather
  than HTML and it was being escaped and shown as written, so a link arrived as
  `[text](url)`. Links, quotes, lists, emphasis and code now render; images
  become links rather than loading anything into the panel. Measured across 1,899
  comments from lemmy.world, quotes were the commonest thing in them, ahead of
  emphasis and links. (#96)

- Ticking Enable annotations, Enhanced PDF support or Enable notepad folds that
  setting's explanation away, the way a source's caveat already does — the tick
  is the acknowledgement.

- Next in queue sits at the bottom of the sidebar when the discussion is short,
  instead of following the last comment up the panel. A long thread is unchanged.

### Fixed

- One quoted passage that overlapped another stopped every highlight on the page
  from being drawn, rather than just its own.

- A quoted passage that runs across a line break inside a PDF anchors. The text
  layer welds those lines together, so the words the commenter quoted and the
  words in the document were not the same string.

- Turning the notepad on or off applies immediately. It needed a page reload
  before, because the setting was saved without anything being told to re-draw.

- Notes line up with the comments beside them. A note sat eight pixels right of
  every discussion comment, because the rule that clears that indent only ever
  matched comments in the discussion list.

- Collapsing or expanding a note resizes the notepad around it. The section keeps
  an explicit height so it can animate, and that height was measured once and
  never revisited, so an expanded note was cut off partway down.

- The explanations under the settings checkboxes animate again. The rule that
  gives them a height to collapse from had lost its opening `/*`, and the
  malformed comment swallowed the height along with it.

- PubPeer was measured for this release and is not viable as a source: its API
  returns a comment count, the commenters' names and a link, and no comment text.
  (#87)

## [1.6.7] — 2026-08-10

### Added

- **Voting and replying on Reddit.** Signed in to Reddit, the arrows and the
  reply box in the sidebar act on your account, through the session your browser
  already holds. Nothing is submitted anywhere until you press something, and no
  password or token is read, stored or moved.

- What you are able to do is read off the page rather than assumed. A subreddit
  with downvotes turned off, a locked thread, or a karma threshold on Hacker News
  means the arrow is not offered — because the site did not offer it, not because
  a table somewhere says the site supports voting.

- Signing in finishes what you started. Pressing vote while signed out opens the
  source's login page and says what it is holding; sign in and the vote is cast
  from there, rather than being lost. "What each source supports" in settings
  marks anything you would still have to sign in for.

- Bluesky, Lemmy and Hypothes.is posters are called by the name they chose.
  Those three keep a display name apart from the handle, and only the handle was
  shown. The handle still resolves the profile link and sits on its title.

- Adds Hypothes.is. The public annotations left on a page arrive as comments that
  quote the passage they are about, so a note lands under the sentence it answers
  rather than at the top of the page. Read-only, no account, one request per page.

- Highlights a quoted passage inside a PDF. The viewer draws two pages of
  fifteen and builds the rest as you scroll, so the whole document's text is read
  from the file rather than from the page: a quote is found wherever it lives,
  and lights up when you reach it.

- Reading an article through an archive shows what is being said about the
  article. archive.is, archive.today and the Wayback Machine are recognised, the
  original address is recovered from the archive's own URL or from what the
  archived page says about itself, and both addresses are looked up — an archive
  link and the article it archives are often both submitted, and those are
  discussions about the same thing.

- Runs on PDFs, which were excluded outright until now. Scholarly annotation
  happens on the PDF — the notes on a paper are attached to it, not to the
  abstract page — so the exclusion hid the conversation and left the noise.
  Whether a quoted passage can be highlighted there depends on the browser's PDF
  viewer; the discussion itself does not.

### Changed

- A quote that arrives already anchored is searched for as written. Annotations
  carry the exact words they were attached to, and those were being expanded into
  every sub-phrase first, each one scanned against the whole page. On a page with
  59 annotated passages that was 8,687 scans where 59 will do.

- Pressing the wordmark to browse no longer hides where you came from.
  `Backchannel / Discussion` reads as a toggle: the view you are on keeps the
  text color and the other dims, so the way back is on screen rather than
  something to guess at.

- Every collective names its own discussion — "Hypothes.is annotations",
  "Wikipedia talk pages", "Mastodon posts", alongside the "Bluesky comments" that
  already did. Only Bluesky used to, so the others fell back to the page title,
  which is the same string for all of them and told a reader nothing about which
  discussion was on screen.

- The back arrow beside the wordmark is gone. It pointed at what the toggle now
  says, and two things saying it was one too many.

- A quoted passage that appears twice on a page is anchored to the right one. An
  annotation carries the words either side of what it quotes, and those were being
  thrown away — so a quote that was not unique was refused rather than placed. Of
  the annotations sampled, every one carried that context and 8% quoted something
  the page says more than once.

- Submitting a page is offered when the page has no discussion, rather than when
  you happen to be on the front-page tab. If any enabled source already has a
  discussion you can join it, and which source it landed on is not your problem —
  so the offer to post it somewhere else goes away.

- The what-each-source-supports table lists favoriting and flagging. Every one
  of these sites has both and this does none of them, which the table used to
  say by omission — reading as though nobody did.

- The live heading no longer cuts off the sources it names. "happening now in"
  holds still and the names scroll gently when there are more of them than fit,
  pausing at each end. They stay put, ellipsised, if you have asked for less
  motion.

- A horizontal rule inside a comment is drawn like every other line in the panel.
  Sources can send one — Hypothes.is notes do — and it was falling through to the
  browser's grey groove, heavier than anything the panel draws for itself.

### Fixed

- **Reddit discussions submitted through a publisher's share button are found.**
  Reddit was asked for the article's exact address, and a share-to-Reddit button
  appends `utm_source=reddit`, so a post made through one carried an address the
  lookup could not see. On one Fortune article that hid the conversation: the
  63-comment thread was found and the 725-comment one was not.

- **A vote that did not go through says so.** The sidebar asked the popup to
  vote and then looked only at the answer it wanted, so a vote that failed —
  not signed in, no such arrow, rate limited, popup blocked — looked exactly
  like one that worked: a window that opened and closed.

- A Hypothes.is profile link no longer points at a display name. The annotator's
  chosen name was taken as the author, and the author is what builds the profile
  URL, so anyone who had set one got a link to nobody.

- Favouriting and flagging are offered only where the source has them. Both were
  shown for any source that could vote, which was true of Hacker News alone until
  it wasn't.

- Annotations made on a different copy of a document no longer appear. Asked
  about an arXiv abstract, Hypothes.is answers with notes made on the PDF — and
  on copies of that PDF hosted elsewhere — because it groups by document rather
  than by address. Those quote text the abstract page does not contain, so they
  would have arrived as comments highlighting nothing.

## [1.6.6] — 2026-08-10

### Fixed

- **A page can say which parts of its address are not the page, and is now
  believed.** A reader arriving from a newsletter or a syndication partner
  carries parameters the submitter's copy did not — ft.com hands out
  `?syn-25a6b1a6=1` — and the comparison every source ends with is equality, so
  an article sitting on the front page two rows down came back as no discussion
  at all. The list of tracking parameters could not answer this: the suffix on
  that one is per-link, and the next publisher's name for the same idea would be
  the next report. The canonical link is read instead, or `og:url` where a page
  publishes no canonical, as ft.com does not to a logged-out reader. It is
  allowed to do exactly one thing — drop query parameters — and a hint that
  moves the host or the path, or introduces a parameter of its own, is refused
  whole. Where a page will not admit to a parameter it is not the answer:
  ft.com's paywalled render names the bare address and its subscriber render
  names the reader's own address back with the syndication tag still on it, so
  the tracking list gains families — `utm_*`, `syn-*` — for the names whose
  suffix is per link. The two catch what the other cannot. Hacker News' own canonical keeps `?id=`, so nothing is stripped there;
  arXiv's `og:url` names `…v1` to a reader standing on the version-less address
  and is turned down. (#82)
- **A queued article counts as read however you got back to it.** The queue was
  always meant to survive this — a parameter picked up on the way in should not
  stop it recognising where you have got to — and it only half did, because the
  seven parameter names it knew did not include the ones publishers actually
  add. Saving an article from a front page and arriving from a newsletter left
  the entry sitting unread on the page you had just finished.
- **Arriving on a story you pressed still counts as arriving.** What gets
  written down when you press a row is the address its source holds; what you
  have when the page loads is whatever the site handed back, and some hand back
  more. Measured against the wrong one of those, a site that appends a parameter
  on the way in made every arrival look like a page nobody had clicked towards —
  the panel did not open itself, and a comment count pressed to read what was
  said about a story landed on it in silence.
- **Submitting sends the address the page claims, not the one you arrived
  with.** Hacker News tells a resubmission from a new story by comparing the URL
  it is handed, and a campaign parameter walks straight past that. What that
  produces is not a rejected submission but an accepted one: a second thread for
  an article that already had a thread. The field is still yours to edit.
- **Arbitrary page styling stops at the panel.** Shadow DOM encapsulates
  selectors, not inheritance, so every inherited property flowed in from the
  page — a glow set on one site's root text put the same glow on every comment
  in the sidebar. The panel used to pin the eight properties known to have
  caused trouble; that same page was measured pushing thirty-two more through,
  two of them CSS additions recent enough that no list built from bug reports
  could have named them. The whole set is reset in one declaration now, and
  stays right as the set grows. Line height still follows the page, and text
  direction still follows the reader's language. (#79)
- **The header no longer runs its own title over its buttons.** At a narrow
  panel — a small phone, or the width a reader drags it to — "Backchannel /
  Discussion" was drawn straight through the eye and the gear. The buttons hold
  their size now and the trail gives way instead, losing its end to an ellipsis
  rather than the wordmark losing its. (#78)
- **Pressing Backchannel from the submit form goes back to the front page.** The
  trail read "Backchannel / Submit" and the wordmark left through the wrong
  door, landing on the discussion of a page that — the reader being in the middle
  of submitting it — almost never had one. What it offered instead was "No
  discussion found for this page yet." It now goes where Cancel goes, and where
  the trail says it goes. (#83)

## [1.6.5] — 2026-08-08

### Added

- **Mastodon, through the two doors it leaves open.** Its front page is
  `/api/v1/trends/links` — official, no account, and ranked by how many accounts
  posted a link rather than how many posts, because one account posting
  something nine times is not nine people finding it worth posting. Discovery
  cannot go the same way: status search needs an account, and four instances
  asked anonymously each returned an empty list. So it goes through Tootfinder,
  an opt-in index, searched by domain and matched exactly here — which means the
  domain is sent rather than the full address, the same trade Lobsters already
  makes. The result is thin, and the caveat says so: two posts per URL on a busy
  news domain, because the index holds only people who chose to be searchable.
- **Wikipedia reads the Talk pages it used to only name.** It listed the pages
  citing a URL and stopped, because the endpoints the first cut measured had no
  comments in them. MediaWiki's DiscussionTools does. A root is now the comment
  that actually cites your page, carrying the replies it drew — not the whole
  Talk page, which on `Talk:Fediverse` is 124 comments about editing that
  article, of which two cite the link you arrived from. A page whose comments
  cite nothing still names itself, exactly as before.
- **The tail of a deep Bluesky thread.** `getPostThread` stops at ten levels
  whatever depth is asked for — 10, 50 and 1000 return byte-identical responses
  — so a node at the cap now carries the same "more replies" affordance Reddit's
  stubs use, filled by a second request rooted there. Two of fourteen sampled
  roots hit the cap.
- **Hiding Backchannel on one page rather than a whole publication.** Off a
  front page the eye hides the page you are on. On a front page both readings
  are plausible, so it asks.

### Changed

- **Submitting is a place in the panel, not a popover on a button.** The grey
  button meant "no discussion here" and the only thing behind it was an offer to
  submit; it now opens the front page, and submitting is a button on that page,
  beside the byline naming what went into it. The trail says where you are —
  Backchannel, Backchannel / Discussion, Backchannel / Submit.
- Links, mentions and hashtags inside Bluesky posts are links. The text carries
  Bluesky's own truncated form of an address — `simonwillison.net/2026/Aug/7/o…`
  — and the address itself lives only in the facet beside it, so a post rendered
  from its text named a page nobody could reach.
- The source beside a comment count reads as an aside — `(HN) 295 comments` —
  rather than as part of the count.
- **A front-page row's comment count goes to the page it counts**, and opens the
  conversation when it gets there. The title reads the article and the count
  reads what was said about it, the way a Hacker News row splits the same two.
  The panel only ever shows the discussion of the page behind it, so there is
  nowhere else for a conversation to be read from.
- That count is marked as a floor — `2,419+`. A row knows what the front pages
  carry and nothing else: `r/popular` held one thread about a story fifteen
  subreddits were arguing about. Going to the page is what settles the number.
- Each discussion a page's conversation is made of is still reachable, from the
  "4 discussions" button under the title once you are there.

### Fixed

- **The foot of the panel is reachable on a phone.** It was sized to `100vh`,
  which is the height the page would have with the browser's chrome collapsed
  whether or not it currently is, so the bottom of the list sat behind the URL
  bar and scrolling could not reach it. The last thing in the list is what went
  missing, which on the front page is the More button.
- Wikipedia comments no longer arrive in pairs. Deletion logs transclude the
  discussions they list, so one comment is reached through several pages under
  the same id — 27 of one discussion's 28 comments are also comments of a log
  page carrying 1,177 — and it is one comment.
- Wikipedia comments no longer end by repeating their own byline. Every one is
  signed, and the panel already puts the author and the age on the line above.
- Wiki links inside those comments point at Wikipedia. There are 321 relative
  links on one Talk page against 49 absolute ones, and a relative href resolves
  against whatever site you are reading.
- The panel stops saying it is loading once it has. Opening a conversation from
  a front-page count, changing the sort, or switching a source off left the
  subtitle claiming to load for as long as the panel stayed open.
- Opening a queued story from another source no longer offers a Hacker News
  discussion that does not exist. The strip at the foot of a thread recorded
  which page it was opening but not where it came from, so a Lobsters id could
  be read back as a Hacker News item number.
- Two submissions of one page are told apart wherever the panel opens them. The
  date that separates them was added on arrival but not when a conversation is
  opened from a front-page count, so both pills read "HN".

## [1.6.4] — 2026-08-06

### Added

- **The front page behind the wordmark is every source's front page, merged.**
  It was Hacker News' own, which was the right answer while Hacker News was the
  only source that had one. Now Hacker News, Reddit, Lobsters and Lemmy each
  contribute their own ranking and the panel blends them — by the same
  rank-fraction over log-scaled standing that already merges a page's comments,
  because a front page is already that source's own ranking. Bluesky and
  Wikipedia do not appear: neither ranks URLs, so neither has a front page to
  contribute. A byline under the tab names which ones went in.
- A page on more than one front page is one row, not two. Hacker News and
  Lobsters shared three of twenty-five URLs on the day this was built, which as
  two adjacent identical titles read as the panel repeating itself. The merged
  row carries a comment link per source — `HN 211 comments · Lobsters 24
  comments` — and never adds the counts up, because a Reddit number and a Hacker
  News number are not the same unit.

### Changed

- The queue identifies an article by its address rather than by its Hacker News
  item number, so a page can be queued from any source and queueing something
  already in the list is a no-op rather than a second copy. Existing queues are
  migrated in place on first run; nothing is re-fetched and nothing is lost.
- Reddit and Lemmy contribute only rows that point somewhere off their own site.
  Their front pages are mostly native content — measured at 80% of `r/popular`,
  44 of 100 being bare images — and a reading list of memes is not what the
  wordmark is for. Videos and articles hosted anywhere else are kept.
- Flag and favorite appear only on Hacker News rows, which are the only ones
  where they could do anything. Every source already declared its capabilities;
  the front page now reads them.
- The front page tab reads "front pages", and the wordmark's tooltip "front
  pages and your queue". Both said Hacker News — and lower case now that the
  name has gone, matching `queue` beside it.
- Queueing your first story slides the queue tab out from under "front pages"
  and pushes it across, rather than snapping a second tab into a row that had
  one. Clearing the last one slides it away again. Only for something you just
  did: opening the panel on a queue that already has entries shows the tab
  rather than replaying its arrival.
- Paging through the merged list costs no further requests. Every source is
  fetched once to a fixed depth and the pool is paged locally.

### Fixed

- Clicking a non-Hacker-News story and then losing the network no longer offers a
  Hacker News discussion that does not exist. The record of what you clicked is
  recovered as a Hacker News item reference when discovery comes back empty, and
  it now records which source it came from so only Hacker News rows are recovered
  that way.
- A queued story from another source no longer costs a wasted Hacker News request
  every time the queue is drawn. The refresh asks Hacker News only about Hacker
  News entries; the rest keep the numbers they were saved with.

## [1.6.3] — 2026-08-06

### Added

- Adds Lobsters. A page's submissions there join the blended thread. Read-only; only the domain reaches lobste.rs, no account.
- Adds Wikipedia. The Talk and project pages that cite or debate a page, collected as one discussion, newest first. Read-only, no account.
- Adds Lemmy. Read across the federated network from one well-connected instance, so a link discussed in any community surfaces. Read-only, no account.

### Changed

- A source's caveat collapses once you enable it — checking the box is the acknowledgement, and the panel gets quieter.
- The what-each-source-supports table scrolls sideways, row labels pinned, as more sources are added.
- Lemmy, Wikipedia and Bluesky are marked as slower to load: the Sources page says so, and while comments load the status line names any still outstanding.

### Fixed

- Bluesky comments no longer all read "OP". A discussion there is many people's separate posts, so there is no single poster to mark; the topic-based sources still do.
- A slow or unreachable source no longer freezes the button or the comment panel. Each source has a time ceiling and drops out rather than holding up the rest.

## [1.6.2] — 2026-08-05

### Changed

- **The blended list knows what year it is.** Opening the panel on the Wikipedia
  article for Western Sahara — posted to Hacker News the day before — led with a
  comment from September 2013, and with fourteen more from the same thread before
  the current one got a word in. The merge ranked each comment by where it sat in
  its own discussion and nothing else, so a 284-comment thread from 2013 beat a
  17-comment thread from yesterday simply by being bigger.

  A discussion is now weighed by what it earned, discounted by how long ago it
  earned it. Old is not the same as invalid: that 2013 thread drew 761 comments
  and 1,916 votes, and it is still the best conversation about the page. It keeps
  its place in the list and most of the list — it just no longer owns the top of
  it. Votes count on a log scale, because 1,916 upvotes in a default subreddit
  and 102 points on Hacker News were never the same currency, and the discount for
  age is gentle enough that a genuinely good old thread outranks a mediocre new
  one.

- **A conversation happening right now comes first, full stop.** If any
  discussion has had a comment in the last day, all of it leads the list —
  ahead of the archive whatever the archive has accumulated. It is not weighed
  against thirteen years of votes, because that is not a trade worth making: a
  live conversation is the thing you opened the panel to find. The live stretch
  is bookended, so you can see where it starts and ends, and several sites
  talking about the same page on the same day all sit inside it.

- **The discussion you came from goes first among those.** Arriving from Hacker
  News puts the Hacker News thread at the top, and the same for Reddit and
  Bluesky.

- **The submission date only appears where it is still telling you something.**
  When one page has been submitted twice, each discussion is labelled with its
  month so you can tell them apart. That label sat beside a comment's own age —
  "HN · Aug 2026, 1 minute ago" — and beside the LIVE marker, saying the same
  thing twice and saying the weaker half first. It now drops wherever what's next
  to it already says when, and stays on an older discussion, where it is the only
  thing separating that thread from the current one.

- **Blended comments arrive in the order they were ranked.** They were rendered
  five at a time and appended in whichever order the sites answered — and they
  do not answer at the same speed, since Reddit sends a whole thread at once
  while Hacker News is asked for one comment at a time. A comment could land up
  to four places from where the ranking put it. Never visible on a page with a
  single discussion, because there every answer takes equally long.

- **Indent guides stop thickening as you read.** The orange accent on a new
  comment widened its guide from 1px to 2px, and clearing the accent only put the
  color back — so every comment you had already read kept a doubled guide for
  good. The accent is now a color rather than a width. Top-level comments were
  also being pushed 7px to the right by it and left there, which is why a thread
  read over two sittings had a ragged left edge.

- **Less air above the panel title.** Two 12px margins were stacked where one was
  meant to be.

### Added

- **Sort the whole list by Best, Newest or Oldest.** A dropdown under the
  header, and only where there is something to choose: a page with one
  discussion arrives in that site's own order, which is inherited rather than
  invented. Newest and Oldest ignore which site a comment came from and order
  everything by time.

  There is no "Score". Hacker News publishes no comment scores at any endpoint,
  so one would have to be invented for a third of the sources. Best already is
  the score-ordered blend, honestly named: each site's own ranking, read as a
  position rather than a number.

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
  into one, and both `localhost` and loopback now cover a port, so a dev server
  on `:3000` is excluded — which it was not before, and that was the common
  case. `*.bank.com` came out: it matched one registered domain and no actual
  bank, while the runtime block list has covered banking properly all along.
  Thanks to the reporter of #52 for the audit.

  Loopback is listed three ways on purpose. `127.*.*.*` covers the whole range
  under Violentmonkey and Safari, and covers **nothing** under Tampermonkey,
  which rewrites a trailing wildcard in a hostname into a list of real TLDs —
  correct for `*.google.*`, useless for an address whose last part is a number.
  The literal `127.0.0.1` rules sit alongside it so the case everyone actually
  hits is excluded in every manager. An unusual loopback address under
  Tampermonkey still reaches the runtime guard, which refuses any IP literal.

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
  accent color moves off Hacker News orange for the same reason — the panel
  speaks for several sources now and should not wear any one of their colors —
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
  applies to, at the size and color it will actually be.
- **The accent color is yours.** The measure under the button in Settings used
  to caption the button's width, which the stepper beside it already states.
  It carries the accent's hex instead, and you can type over it: leaving the
  field applies it, Enter commits, Escape abandons, and emptying it goes back to
  the built-in color.

  The panel keeps its accent as a pair — one value for a light background and a
  lifted one for a dark background, where the light value reads muddy — so a
  color you type has to become a pair too. Each half is walked until it clears
  4.5:1 against the panel it sits on, which is what body text is asked for. How
  far it has to move depends entirely on what you type: the built-in green needs
  a sixteen-point lift to be legible on the dark panel, a pale green needs none,
  and yellow has to come down to be legible on the light one. The header behind
  it goes the other way and is held to the same bar behind white.

  The mark on the button follows too, black or white depending on what it is
  sitting on. That was worth fixing regardless: the dark theme's accent is
  lifted, which makes it a light color, and white on it was 2.9:1 — a mark you
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
- **Reply, flag and favorite no longer appear on comments that cannot take
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
  font and its colors without pinning anything that moves text about. A site
  that centers its body centered the entire panel, comments and all.

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
  2px top margin, which centers it against the 12px settings rows it was tuned
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
  text characters, and flexbox centers a glyph's line box rather than its ink —
  so the gear sat about a pixel low and the dash half a pixel high, while the
  drawn eye was exactly centered and read as the odd one out. All three are now
  paths on the same 16-unit grid, aligned by construction on every platform.
  Retires the iOS workaround that kept the gear from rendering as a color emoji.
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
