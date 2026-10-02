# Team mark restyle — before/after frames

Frames for the PR that restyles the chat sidebar's team initials mark (the `LD` /
`RD` bubble) into the sidebar rail's notification-count badge treatment, in the
no-picture case. Operator report, relayed by Aida, verbatim:

> the RUNNING-section session rows' ringed `LD`/`RD` bubbles *"should probably be
> more similar to the borderless bubble of the sidebar notification counts —
> slight contrast vs backdrop, smaller more subtle text, in the case there's no
> picture. Currently it looks kind of ugly."*

They live on this branch so the PR body can inline them; they are **not** in the
PR's diff and not on `main`. The mechanism is the one `evidence/agent-opened-row`
uses.

| file | tree | state |
| --- | --- | --- |
| `before-sidebar-dark.png` / `after-sidebar-dark.png` | `origin/main` `9b4822de106` / the PR branch | `chat-sidebar-sections--resting-default` — the RUNNING section with its team-bound rows, `localOperatorDark` |
| `before-sidebar-light.png` / `after-sidebar-light.png` | same | same story, `localOperatorLight` |
| `before-marks-dark.png` / `after-marks-dark.png` | same | `chat-team-avatar-bubble--marks` — every initials shape plus the three image states (a URL renders, an absent URL, a URL that FAILS), `localOperatorDark` |
| `before-marks-light.png` / `after-marks-light.png` | same | same story, `localOperatorLight` |
| `before-header-team-bound-dark.png` / `after-header-team-bound-dark.png` *(and `-light`)* | `origin/main` `9b4822de106` / the PR branch | `chat-header-identity--team-bound` 560×84 — the component's **second production host**, the header identity chip (design round 1, D1) |
| `before-header-long-label-*.png` / `after-header-long-label-*.png` | same | `chat-header-identity--long-label` 560×84 — the 80-character label at the chip's `24ch` cap |
| `before-header-narrow-fold-*.png` / `after-header-narrow-fold-*.png` | same | `chat-header-identity--narrow-fold` 560×84 — the same chip where the title truncates hardest |
| `before-focus-sidebar-team-mark-focus-*.webp` / `after-focus-sidebar-team-mark-focus-*.webp` | same | `chat-sidebar-sections--query-while-collapsed` 741×460 — the rig's own registered `sidebar-team-mark-focus` row (a Tab walk to the mark), the frame design round 1's D2/R1-3 found cited but never filed |
| `after-family-*` | the PR branch | the mark and the rail's own `attentionQuiet` count badge in one frame, on `surface`, `row-hover` and `row-selected` — the "one family" claim, checkable |

## Which rig, and why not the built app

**The Storybook story rig, declared as a substitution** for the repository's own
built-app driver, per the task's fallback. The driver cannot draw this surface:
`scripts/renderer-driver.mjs` runs the app against a backend it has verified is
dead, and the sidebar's session list — the only place a team-bound RUNNING row
exists at all — is drawn from `sessions.list`. With no backend there are no rows,
so no frame of the real app can show the thing the report is about.
`chat-sidebar-sections` is the story whose RUNNING row is team-bound by fixture.

The `after-family-*` frames come from a **temporary scratch story**
(`Scratch/team-mark-and-rail-badge`) that renders the shared `Badge` beside the
mark. It is a comparison rig, not part of the change: it was deleted from the
worktree before the branch was committed, and it does not exist on either tree.

## How they were taken

```sh
# in the PR worktree, and again with origin/main's component in place for BEFORE
./node_modules/.bin/storybook dev --ci --port 6043
node "$LOCAL_OPERATOR_SCRATCHPAD/probe.mjs"   # one headless Chrome, N navigations
```

`pnpm` was **not** used to run these: this worktree's `node_modules` is a symlink
into the primary checkout, and pnpm's pre-run install step refuses that shape
("workspace hoist directory is not a real directory"), so every gate and rig in
this round was invoked directly.

The probe is a scratch CDP script (this round's, not committed). It launches
**one** headless Chrome — the fleet's own rule, after a one-round rig made 152
profile copies in 14 minutes — with `--user-data-dir` in the session scratchpad
and `--use-mock-keychain` (a scratch profile with no keychain makes Chrome ask
macOS to CREATE a login keychain, which is a dialog on the operator's screen). Per
case it sets `Emulation.setDeviceMetricsOverride` to the story's size at
`deviceScaleFactor: 2`, seeds `ui-preferences-storage` so the palette is the
frame's own, parks the pointer, navigates to
`/iframe.html?id=<story>&viewMode=story&args=theme:<palette>`, reads the DOM
measurements below, and screenshots. The browser is killed by exact pid before
the script returns; no window was ever shown.

**BEFORE is a pre-change build of the same rig**, not a fixture: `git checkout
origin/main -- src/renderer/src/features/chat/components/team-avatar-bubble.tsx`,
re-capture, restore. Nothing else in the tree differed between the pairs, so the
only variable is the mark's own source.

**The two focus frames come from the repository's own rig**, not the scratch
probe: `scripts/capture-evidence.mjs` was run against the same Storybook with its
own registered row — `--only=chat-sidebar-sections--query-while-collapsed
--dirs=sidebar-team-mark-focus` — so the Tab walk, the 741×460 size and the
expected-panel assertions are the ones this repository already pins for that row
(`capture-evidence.mjs:5225`). It writes into `docs/evidence/`, which is **not**
where these frames ship: the run's output was copied here and the swept tree
restored (`git checkout -- docs/evidence`) in the same round, so the committed
set keeps the images `main` holds and the PR's diff carries no frame.

## The pair, as measurements (not just pixels)

Read from the DOM in the same run that took the frames.

| what | before (`origin/main`) | after (this branch) |
| --- | --- | --- |
| mark box | **20.00 × 20.00** (every mark; a fixed `size-5` circle) | **22.38 × 16.00** (`LD`) … **24.61 × 16.00** (`DQ`) — 16px tall, width follows the initials |
| mark edge | `1px solid` `border-control` (dark `#837c6d`, light `#857f70`) drawn on the avatar | **none** — `border-width: 0px` |
| mark fill | `sunken` on the AvatarFallback | `elevated` on the mark itself (dark `#322d22`, light `#fefdfa`) |
| letters | 11px, **weight 500**, `ink` (`#f1eee6` dark / `#211e18` light) | 11px, **weight 400**, `ink-dim` (`#a6a091` dark / `#656056` light) |
| session row box | 32.00px | 32.00px (**unchanged**) |
| section-header row box | 28.00px | 28.00px (unchanged) |
| first clipped title (`Install the pinned uv on Windows arm64 via the bootstrap script`) | client **217** / scroll 387 | client **213** / scroll 387 |
| `Ship the session-avatar round` | client 217 | client 215 |
| `Reconcile the supplier ledger` | client 279 | client 274.39 |

**The picture case wears a collar, stated whole** (agent review round 1, R1-2):
"20px -> 16px" was not the whole of what moved. The thumbnail is still a circular
crop, now 16px inside the badge's 24×16 stadium, so the badge's own `px-1` leaves
**4px of `elevated` on each side of it** (measured at head, in css: fill 2.0-4.5,
crop 4.5-20.5, fill 20.5-24.0). Before, the 1px `border-control` sat ON the 20px
circle, so there was no collar at all. Visible in the image row of
`after-marks-dark.png`.

**"Smaller, more subtle text" landed as subtler, not smaller** (design round 1,
D3): the glyphs keep the rail badge's own `text-meta-sm` (11px, cap height
8.5-9.0 css against the rail numeral's 8.0), because moving the type step would
break the shared `badgeVariants` call that makes the two faces one family. The
letters went weight 500 -> 400 and `ink` -> `ink-dim`; the MARK went 20 -> 16px
tall.

**The title does NOT gain width, and this frame set is the evidence.** The brief
expected a small gain; measured, the title's available width moves by exactly the
mark's width delta, and the badge's own `px-1` plus two 11px initials
(14.4–16.6px) is **2.4–4.6px wider** than the 20px circle it replaced — so the
title loses that much on these fixtures. What the mark saves is height (20 → 16px).
If the width cost is unwanted, the lever is the badge's geometry, not this
component: the mark composes the rail's own `badgeVariants` call, so narrowing it
means narrowing the rail's count badge too — which is the point of composing it
rather than copying it.

**The chat header's chip (D1's fix: frame it, and the verdict).** The change lives
on the shared root, so the header's identity chip wears it too, and the header is
the host with its own constraint - a `shrink-0` mark leading a `min-w-0
max-w-[24ch] truncate` label in a one-line block. Measured before/after off these
frames (computed styles, css px):

| | before | after |
| --- | --- | --- |
| chip box (`[data-header-identity=team]`) | 159.27×**20.00** / 231.41×20.00 (long label) | 160.47×**20.00** / 232.61×20.00 |
| mark | 20.00×20.00, 1px `border-control` edge, no fill | 21.20×16.00, `border-0`, `elevated` fill, `ink-dim` |
| the capped label's own box (long-label frame) | 181.41 wide, client 181, scroll 468 | **identical**: 181.41 / 181 / 468 |
| the title band | `Install the pinned uv on …` truncates | **truncates at the same place** (see the frames) |

So the header's pill is not wrong - only unframed, which this round fixes. The
chip's height is its own `h-5` (20px) in both trees and does not move; the chip
grows **1.2px** wider for the same reason the sidebar row does (the mark is 20 ->
21.2 wide at these initials) and it is right-anchored, so that 1.2px comes out of
the leading gap. The chip's own label is at its `24ch` cap in both trees in the
long-label frame, which is why the cap case shows no change at all.

## Contrast, measured over all 59 palettes

Computed from `scripts/palette-source.mjs` + `scripts/color.mjs` in the same run
(and asserted per palette by `scripts/contrast-contract.mjs`):

- **`ink-dim` on `elevated`: 5.01:1 at worst** (`palenight`), 7.94:1 at best
  (`highContrastLight`); **0 of 59 palettes under 5.0:1**, 0 under 4.5:1.
  `localOperatorDark` 5.25:1, `localOperatorLight` 6.14:1 — which is what the
  frames' own pixels read (`rgb(166,160,145)` on `rgb(50,45,34)`).
- **`elevated` against the grounds the mark can sit on** (the whisper, not a
  boundary): `canvas` min ΔE00 **4.17**, `surface` min **2.02** (`arcade`),
  `rowHover` min **0.00** (`arcade`, byte-identical; 4 of 59 under 2.0),
  `rowSelected` min **0.47** (`duskfox`; 16 of 59 under 2.0). Where the fill
  merges with a row's ground the **letters alone read** — the same deal the
  sidebar's own count lines strike, and the reason the edge is declared away
  rather than replaced.
- For the record, the pair it left: `sunken` vs `rowHover` min ΔE00 1.86
  (`iceberg`) and `border-control` on `rowHover` 2.92:1 at worst — under the 3:1
  non-text floor, which is why the old row rested on the edge arm.
- **The full-merge palette, named rather than framed** (design round 1, D5):
  `arcade`'s `elevated` is byte-identical to its `rowHover` (ΔE00 0.00), and four
  of the fifty-nine palettes sit inside ΔE00 2.0 on that ground (`gruvbox` 1.14,
  `obsidian` 1.21, `everforest` 1.90); sixteen sit inside 2.0 on `rowSelected`
  (`duskfox` 0.47 at worst). There the letters are the whole mark, and they clear
  the text floor on the GROUND itself — `ink-dim` on `arcade`'s `rowHover` is
  5.29:1 — which is the deal the rail's count badge strikes on the same four
  grounds.

## What these frames do NOT prove

- **Not the tooltip, the keyboard path, or the flyout.** The mark's hover/focus
  tooltip, its `tabIndex` and Enter/Space forwarding to the row, and the row's
  flyout suppression are the surface's own behaviours and are unchanged by this
  round; a still cannot show any of them.
- **Not a focus ring.** These run in a window without focus; `:focus-visible`
  styling is what the `before|after-focus-sidebar-team-mark-focus` frames in this
directory measure - the rig's own registered row, filed here at this head rather
  than in the swept set - and the ring traces the mark's own pill
  (`rounded-full` from the badge's `shape="pill"`) instead of the old circle.
  Round 1 of this PR's review found the previous wording citing those frames while
  no such frame was filed anywhere; this round files them.
- **Not the real app.** See "Which rig" above: the frames are Storybook, the
  RUNNING row is a fixture, and `window.api.desktop.request` is stubbed by the
  story. No frame here is a picture of a live backend's replies.
- **Not the other 57 palettes.** Two palettes per story
  (`localOperatorDark`, `localOperatorLight`); the remaining palettes are covered
  by `scripts/contrast-contract.mjs`'s per-palette assertion, not by pixels.
- **Not the picture's behaviour.** The image states are shown (renders / absent /
  fails), and the picture's rendered size moved 20px → 16px with the mark's
  geometry; the mechanism (`AvatarImage` + Radix's own fallback) is untouched.
