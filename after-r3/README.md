# Round-3 frames for UI PR #491 (Integrations redesign)

Captured at the round-3 remediation commit `01448d5a4`
(`fix(settings): answer review round 3 on the Integrations redesign`) on
`feat/integrations-redesign`, in both brand palettes, with the theme riding
`&args=theme:` the way `scripts/capture-evidence.mjs` passes it - never the
preview's `globals=theme:`, which the story iframe ignores.

These are Storybook states of the surfaces this round's findings are about. The
LIVE walk is a different instrument and is reported on the PR; nothing here is
offered as proof that the app runs.

## Why these frames, and what the pre-fix half is

The dialog bodies changed shape this round (the ring's room moved from a widened
body to the body's own padding, D12's round-2 shape being what drew the stray
horizontal strip, n3), and the section's rows changed words and groups (Q1's
`last_seen` reading, m-2's failed sign-out, U14's remembered needs-sign-in).
`docs/evidence/` is NOT re-captured by the round-3 commit, for the reason the
manifest's own note gives: the documented sweep admits one run per machine and a
feature PR is not where it runs.

**The pre-fix half for the dialogs is `after-r2/*` on this branch**, and that is
not a shortcut: no file under `settings/` or `styles/` changed between the
round-2 capture tree (`69de06a97`) and the round-3 base (`b98a8d788`) - the agent
review verified it file by file - so the round-2 frames ARE this round's "before"
for the geometry.

## The D12 / n3 reading, measured on the rendered story

`localOperatorLight`, `settings-integrations--add-key-without-a-reference`
(`D12-n3-keyless-dialog-light.png`), focus forced into the key field through CDP:

| Reading | Value |
| --- | --- |
| focused element | `input#integration-key-key` |
| `:focus-visible` | true |
| **accent pixels on the input's mid row** | **4** (2 per side) |
| scroll container box | x 301, width 398 |
| control box inside the scroller | 6 px left, 6 px right |

Four is the number round 2 measured for its fix, and the shape that produced it
is what changed: the room is now the body's own `p-1.5` rather than a `-mx-1.5`
body plus a `px-1.5` wrapper per control. The body is therefore exactly the
scroller's width instead of 12 px wider - which is n3's stray horizontal strip
(`scrollWidth 404` inside a `clientWidth` of 398, visible under the last control
in `after-r2/D12-add-key-light.png` and in the live round's `r2-05`).

**The dark-palette run of that story never reached its state** - `forcedFocus:
miss`, 0 accent pixels, three attempts across two Storybook servers - so its
frame is the story's collapsed state rather than the measurement. The geometry is
palette-independent classes; what the dark palette would have added is a second
count of the same number, and round 2's dark reading (4 px after, 0 before) is
what stands in for it here. Said plainly rather than left for a reader to notice.

## The frames

| Frame | Surface | Finding |
| --- | --- | --- |
| `Q1-expired-check-{dark,light}.png` | the section, a `stored` row with a `last_seen` count | the row reads **"Worked earlier · 12 tools"** under Connected instead of decaying to "Ready" when no memory survives (Q1 / U10) |
| `m-2-failed-sign-out-{dark,light}.png` | the section, a failed `logout` | **"Sign-out didn't finish"** under **Needs attention**, leading with **Sign out again** (m-2, Q3, U16) |
| `D12-n3-keyless-dialog-{dark,light}.png` | the key dialog, keyless mode | the ring drawn with room on both sides inside the clip (D12) and a body no wider than its scroller (n3); also the per-server reference copy (U15) |
| `D19-sign-in-ready-{dark,light}.png` | the sign-in dialog, ready phase | `fullWidth`, so every phase holds one width instead of the success phase collapsing to the 320 px floor (D19) |
| `D19-sign-in-done-{dark,light}.png` | the sign-in dialog, success phase | the same 448 px as the ready phase (D19), with Done as the rendered focus target (D17) |
| `D13-D15-no-session-fallback-{dark,light}.png` | the session-route fallback | Ready rows carry a ghost Connect while the live-basis row keeps its weight (D13), and no copy names a key route the row does not have (D15) |
| `states-mixed-{dark,light}.png` | the section, every group at once | the regression neighbour: grouping, counts and overflow unchanged by this round's rules |

## Not captured here, stated rather than implied

- **The referenced-key dialog** (`add-key`) and **the add form**: their Stories
  did not reach their states in the three attempts this host's load allowed, so
  they have no round-3 frame. U19 (a press on the add form's actions row) is
  measured by the rig's own reading on the live app, and U13/n1/n2 were
  re-captured in round 2 with no change to those surfaces since.
- **The empty state and the filtered states**: unchanged this round.
- **The live-app frames**: the live rig (isolated #1511 daemon, headless app,
  browser opener stubbed) is where the reload, Disconnect, two-servers-one-header
  and empty-Name-press scenarios belong; it is reported on the PR. Its most
  valuable result this round was a defect no frame could show: the Settings page
  threw `ReferenceError: Cannot access 'ee' before initialization` from the
  settle window's helper being declared below the queries that call it, which is
  fixed and pinned, and the page renders.
