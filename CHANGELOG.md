# Changelog

All notable changes to HNewhere are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The version in `HNewhere.user.js`'s `@version` header is what userscript managers
use to detect updates, so every release bumps it.

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
