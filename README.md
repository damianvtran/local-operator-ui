# The agent-opened sidebar row: from `· agent-opened` to the team it serves — the frames at `feat/row-team-trailing` (PR #521)

Not merged anywhere; an orphan branch so the PR can embed the stills without
committing them to the tree.

- `after/` — the PR's head tree, story `Chat sidebar/Agent-opened rows`
  (`chat-sidebar-opened-by.stories.tsx`), captured with the **`browser` tool**.
- `before/` — a worktree of `origin/main` = `939b7ed48` carrying THIS SET'S OWN
  story file byte-for-byte — `sha256 9ced58f5e85c20377611a9271bc337b09da4ccb8f69347d2550a8827e6277fe4`
  on both trees — so the pair differs by the change under test and nothing else.
- Both trees served Storybook 8.6.12 on `http://127.0.0.1:6051`, one after the
  other (the same approved origin), and **nothing** here came from a raw-CDP
  driver, a private headless Chrome, a downloaded engine or a scripted
  screenshot path. The draft-splash retirement note is the rule; this set is
  inside it.

## What the frames are

Six states × three panel widths (240 / 280 / 360) × both brand themes, plus
flyout stills for three states at 280. Raw 2560×1440 (`window: 1280x720 @2x ·
visible` — the viewport the run reports, printed by the story's own readout in
every frame, not assumed).

The behavior this PR implements, and what the pair shows:

- An agent-opened row (`opened_by` present) draws `· <team>` — the team its
  binding names, the same string the flyout's binding clause and the binding
  slot beside it already show — with the binding slot's bounded, truncating
  treatment; and it draws **NOTHING** in that slot when it serves no team.
- The constant `· agent-opened` no longer appears in any row's visible text.
- The two claims above it are unchanged: `· in conversation` and
  `· Not sent yet` still outrank the slot, and every non-agent-opened row
  renders exactly as it did.
- The team is drawn words, not `aria-hidden` — the accessible name is never
  narrower than the pixels — and the `, opened by <agent>` sentence still
  renders on the rows the marker spoke for (the team rows and the silent ones).

## The six states, and what each pair shows

| state | before (`origin/main`) | after (head) |
| --- | --- | --- |
| `agent-opened-team-bound` | `· agent-opened` (87/87) on the template row, nested **and** flat; the control row bound to the same team draws `· lopdev` (45/45) | `· lopdev` on both instances — the same string, same bounded treatment as the control — and the title regains the width the marker held (280px flat row: title box 141→183 of 213; nested: 109→151) |
| `agent-opened-team-less` | `· agent-opened` (87/87); title 141/213 flat | nothing in the slot (0/0); title 236/236; the attribution lives in the flyout and the `sr-only` sentence (`spoken: …, opened by coder`) |
| `agent-opened-unnamed` (all three members null) | `· agent-opened` | nothing in the slot; `spoken: …, opened by an agent` — presence, not members, is the fact |
| `agent-opened-and-search-marked` | `· in conversation` (the conversation match outranks the slot) | `· in conversation` — **byte-identical**, all six pairs |
| `agent-opened-not-sent` | `· Not sent yet` | `· Not sent yet` — **byte-identical**, all six pairs |
| `not-agent-opened` | binding / nothing | **byte-identical**, all six pairs |

**The inertness half is measured, not asserted.** For the three states the
change must not touch a pixel on — `agent-opened-and-search-marked`,
`agent-opened-not-sent`, `not-agent-opened` — all **18** before/after pairs are
byte-identical (`sha256`, see `pair-digests.sha256` beside this file; six
`not-agent-opened` digests are quoted in the PR). The three states the change
moves differ exactly on the slot.

## The flyout stills

For `agent-opened-team-bound` and `agent-opened-team-less` (280, both themes;
plus `agent-opened-unnamed` on the after side): the row clicked, and its flyout —
the pointer/keyboard channel — showing the attribution the slot no longer
carries: `Retry ladder for superseded tokens` / `(lopdev)` / `Recent, opened by
coder in “Harden lop secret against agent credential leaks”`. The flyout's own
words are untouched by this change; the stills are here because "the attribution
stays reachable" is a claim about what a reader can still GET from the row, and
this is the frame where they get it. (`opened_by.label`, the requesting
conversation's name, exists nowhere else on screen.)

## The instrument, exactly — four things that are load-bearing

- **The shutter is viewport-only, and the frames are whole frames.** The
  `browser` tool opens its tab in the background and never activates it; the
  stills are the story at 1280×720 CSS, devicePixelRatio 2 (raw 2560×1440), not
  cropped and not scaled. The readout beside the panel IS the fact carrier, so
  the panel + readout is the whole surface the claim is about; the dead space
  right of it is the viewport.
- **The flyout stills need a click, a forcing read, and a second look.** On this
  instrument a clicked row's tooltip mounts in the DOM before it is composed
  into the presented frame, so each flyout run is click → read (which forces the
  presentation) → shutter, and every still was verified to CONTAIN the tooltip's
  text before it was accepted. One transient settle artefact was caught the same
  way — a search-marked frame whose readout had not yet polled; it was re-shot
  and is byte-identical to its after twin now.
- **One shared story file is what makes the pair mean anything.** The file is
  identical in both trees (sha256 above) and compiles against `origin/main`
  because every row it draws is a plain object in the wire's own field names.
- **The window is the run's, not a constant to remember.** Each frame's readout
  carries `window: 1280x720 @2x · visible`, read from
  `window.innerWidth/innerHeight/devicePixelRatio` and `document.visibilityState`
  by the story itself; a caption that restated a remembered pair would be a
  claim, not a record.

## What these frames do NOT show

- The keyboard traversal and reduced-motion paths of the flyout: not in the
  diff, and not reachable through this instrument (documented rather than
  implied).
- A 64-character team: the drawn `lopdev` does not reach the slot's 45% cap at
  any swept width, so nothing here clips. The clip is the binding slot's own
  pinned width case (review round 4, R21 on PR #448) and the two slots share
  their classes.
- The live app with a real backend: this is the story rig, stated above. The
  wire half (`opened_by` arriving from a real catalogue) was #448's and is
  untouched; the anchor is session `0e071e7377ad`'s shape, mirrored in the
  fixtures rather than read from the operator's live files.
- The command palette's own row: it deliberately keeps drawing the binding (its
  comment says so); that surface's precedence decision remains its own change.
