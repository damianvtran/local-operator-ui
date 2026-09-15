# The chat sidebar's selected conversation — one row you can see is the current one

The operator's report: "The sidebar doesn't visibly highlight the selected
conversation, so you can't tell from the sidebar which one is selected. There
should be a visible, not-too-obnoxious highlight on the background of the
selected row."

It was not a missing highlight. The row painted one, and in the theme the
operator runs it measured **ΔE00 1.05** against the panel it is drawn on — no
mark at all — while the hover step the same rows carry measured 4.58 there. The
pointer therefore read as the current row and the current row did not. The same
pair marked the `All chats` filter, the `New chat` row, an entity row staging a
targeted draft (whose NAME BUTTON painted the hover ground straight over the
wrapper's mark, the defect round 1 raised as its MAJOR), and the settings rail's
current section on a second `surface` panel (round 1, design D2).

## What these frames are, and what they are not

Every frame is the **built app in `headless` window mode**, paired to an isolated
`local-operator serve` on a port each run checked nobody else owned, with `HOME`,
`LOCAL_OPERATOR_CONFIG_DIR` and `--user-data-dir` under `/tmp`, and the frames
come from `webContents.capturePage()` through the app's own dev driver — the app
photographing itself. No `screencapture`, no downloaded browser engine, no
Storybook. Each run reports `visible=false focused=false focusable=false` at
**1380x900 content 1380x868** and sampled the OS for the frontmost application:
**0 of 20** / **0 of 27** / **0 of 19** / **0 of 27** samples across the four
passes, with no window raised.

**Four passes, and what each one is for.** The `before` halves are
`origin/main` at **`f14a98d08`** (`chore(release): bump version to 0.24.4`) built
in its own worktree, so a pair differs by this change and nothing else; the
`after` halves are this branch. The branch was rebased onto `c47dc987a`
(`0.24.5`, the merge of #206) after these frames were taken and they were **not
re-shot for that move**, which is a measurement rather than a promise:

```
git diff f14a98d08..c47dc987a -- \
  src/renderer/src/features/chat/components/chat-sidebar.tsx \
  src/renderer/src/features/settings/components/settings-sidebar.tsx \
  src/renderer/src/shared/themes scripts/contrast-contract.mjs \
  docs/evidence/chat-sidebar-selection
(no output: the frames' subject files did not move with the base)
```

That stretch is 23 files — the notification kill switch and the desktop-test
runner among them — and none of them draws this sidebar. Both trees report version
**0.24.4** / **0.24.5** and were built on the pinned Electron **44.3.0**.

**This whole set was re-shot for round 1, and the previous frames are not
carried over.** They could not be: the seeded store gained the agent-bound
conversation the new states need (`harness/seed.mjs`, one row), so an old
six-row frame beside a new seven-row one would have been a comparison between two
different lists rather than between two trees. Every frame here is from this
round's four passes, and `before`/`after` are pixel-for-pixel the same seed,
route, window size and theme. Each pass was captured in **tokyoNight** (the theme
where the row was invisible) and in **localOperatorLight** (the light palette
round 1's design pass asked for).

`comparison-accent-tint` is **not a shipped state** and is labelled as such below:
it is the leading alternative ground, injected on the selected row for the design
round to judge on pixels rather than on prose.

## Every frame, with the state it claims

tokyoNight for every state, plus the three that a light palette is worth seeing
in. Window requested `1380x900` in `headless` mode; the app reports a **1380x868
CSS viewport at devicePixelRatio 2**, so every frame is **2760x1736 pixels** and
is committed as a lossless WebP (each one round-trip decoded and compared against
the PNG the app wrote: 0 differing pixels). Theme per the file name.

| State | Before (`origin/main` @ `f14a98d08`) | After (this branch) |
| --- | --- | --- |
| A conversation row is current, at rest | [`before-selected`](before-selected/tokyoNight.webp) — tokyoNight, [light](before-selected/localOperatorLight.webp) | [`after-selected`](after-selected/tokyoNight.webp) — tokyoNight, [light](after-selected/localOperatorLight.webp) |
| The pointer is ON the current row | [`before-selected-hover`](before-selected-hover/tokyoNight.webp) — tokyoNight, [light](before-selected-hover/localOperatorLight.webp) | [`after-selected-hover`](after-selected-hover/tokyoNight.webp) — tokyoNight, [light](after-selected-hover/localOperatorLight.webp) |
| The pointer is on a **neighbouring** row | [`before-selected-sibling-hover`](before-selected-sibling-hover/tokyoNight.webp) | [`after-selected-sibling-hover`](after-selected-sibling-hover/tokyoNight.webp) |
| The `All chats` filter is active | [`before-all-chats`](before-all-chats/tokyoNight.webp) | [`after-all-chats`](after-all-chats/tokyoNight.webp) |
| The `New chat` row is current | [`before-new-chat`](before-new-chat/tokyoNight.webp) | [`after-new-chat`](after-new-chat/tokyoNight.webp) |
| An **agent-bound** conversation is current (trailing statement, truncating title) | [`before-selected-bound`](before-selected-bound/tokyoNight.webp) | [`after-selected-bound`](after-selected-bound/tokyoNight.webp) |
| The same conversation as a **nested** row (`pl-7`) under its entity | [`before-nested-current`](before-nested-current/tokyoNight.webp) | [`after-nested-current`](after-nested-current/tokyoNight.webp) |
| An **entity row** staging a targeted draft, at rest | [`before-entity-draft`](before-entity-draft/tokyoNight.webp) — tokyoNight, [light](before-entity-draft/localOperatorLight.webp) | [`after-entity-draft`](after-entity-draft/tokyoNight.webp) — tokyoNight, [light](after-entity-draft/localOperatorLight.webp) |
| …and under the pointer | [`before-entity-draft-hover`](before-entity-draft-hover/tokyoNight.webp) | [`after-entity-draft-hover`](after-entity-draft-hover/tokyoNight.webp) |
| The **settings rail's** current section (`#/settings`) | [`before-settings-rail`](before-settings-rail/tokyoNight.webp) | [`after-settings-rail`](after-settings-rail/tokyoNight.webp) |
| The alternative ground — **not shipped** | — | [`comparison-accent-tint`](comparison-accent-tint/tokyoNight.webp) |

Route `#/chat/b3b3b3b3b3b3` for every state except `settings-rail` (`#/settings`)
and the entity states, which start from the draft that pressing the entity's name
stages. `b3b3…` is the third of seven seeded conversations, so the current row has
siblings above and below it; `b7b7…` is the agent-bound one. `Previous chats` is
COLLAPSED by default (`heading("previous")` passes no `initial`) and a fresh
profile stores no disclosure state, so the rig presses that heading before
navigating — without it the list the operator is looking at is not on screen at
all. A profile with no onboarding flag opens the `Connect a provider` modal over an
`aria-hidden` app; the rig writes the app's own persisted preference
(`onboarding-storage`, `isModalComplete`) before the document's scripts run and
reloads, i.e. these frames are the sidebar of a returning user, which is the only
state a multi-conversation sidebar exists in.

## The readings, taken from the page

`getComputedStyle(...).backgroundColor` and `getBoundingClientRect()` at capture
time, in the frame the reading belongs to — not recalled from the source that may
have failed to paint it. A row that paints NOTHING reports `transparent` (there is
no colour on screen there; the panel shows through), which is a reading and not a
failure — it is exactly what the before tree's entity NAME BUTTON does at rest.
The full record per pass is written to `readings-<tree>-<theme>.json` by the rig
(kept out of the repository as a run artefact; every number below is from it).

**WHICH BYTES A NUMBER IS ABOUT, because two bases are in play and round 2 found
them quoted as if they were one.** The tables below give what the PAGE computes,
which is the palette's own pair (`getComputedStyle` reads `#262b3f` on `#24283b`
in tokyoNight, the values `src/renderer/src/shared/themes/palettes/tokyo-night.ts`
declares). A committed frame's own bytes render every channel about one step off
both values — `before-settings-rail/tokyoNight.webp` carries that same pair as
`srgb(39,43,62)` on `srgb(37,40,58)`, i.e. `#272b3e` on `#25283a`. The offset is
the same in both colours, so the pair's separation agrees to 0.01 between the two
bases (`1.062` measured on the frame's bytes, `1.054` on the palette) and no
conclusion here turns on it: a reader sampling a frame by pixel will see the
offset, and a reader comparing a frame against these tables is comparing it
against the page. Every source comment and contract pin about this pair cites the
palette pair for that reason.

**THE DEFECT, ON SCREEN — tokyoNight.** The panel ground is `#24283b` in all four
columns below:

| What is being read | Before | ΔE00 vs the panel | After | ΔE00 vs the panel |
| --- | --- | --- | --- | --- |
| The conversation row, at rest | `#262b3f` (`accentWash`) | **1.05** | `#14141b` (`sunken`) | **8.68** |
| …with the pointer on it | `#2f334d` (`elevated`) — the mark is GONE | 4.58, and **3.74** from the mark | `#14141b` | 8.68, and **0.00** from the mark |
| The pointer on a neighbouring row | `#2f334d` | 4.58 | `#2f334d` | 4.58, and **13.15** from the mark |
| `All chats` filter, active | `#262b3f` | 1.05 | `#14141b` | 8.68 |
| `New chat` row, current | `#262b3f` | 1.05 | `#14141b` | 8.68 |
| Agent-bound row (current) | `#262b3f` | 1.05 | `#14141b` | 8.68 |
| Nested child row (current, `pl-7`) | `#262b3f` | 1.05 | `#14141b` | 8.68 |
| Entity row's wrapper (draft staged) | `#262b3f` | 1.05 | `#14141b` | 8.68 |
| Entity row's NAME BUTTON, at rest | paints nothing — the panel shows through | — | `#14141b` | 8.68 |
| Entity row's NAME BUTTON, pointer on it | `#2f334d` | 4.58 | `#14141b` | 8.68 (**0.00** from at rest) |
| Settings rail's current section | `#262b3f` on a `#24283b` rail | 1.05 | `#14141b` on the same rail | 8.68 |

Three things that table says and prose cannot:

- **The pointer and the selection were the same signal.** Before, a hovered
  neighbour and the current row were **3.74** apart while the current row was 1.05
  from the panel — the reader's eye saw the row under the mouse and not the row
  they were in. After, the pointer's row is 13.15 from the mark and the mark does
  not move at all under it (0.00).
- **The entity row's mark was painted over, not merely faint.** Before, the
  wrapper painted the wash and the name button — which fills ~90% of the row — was
  transparent at rest and painted `elevated` under the pointer, i.e. the pointer
  replaced the mark on the row the reader was already in. That is the same defect
  the session rows had, on the one call site where the ground and the hover step
  live on different elements, and it is why `before-entity-draft-hover` is in this
  set: it is the only frame that shows it.
- **Contrast was blind to the pair that failed.** tokyoNight's wash against its
  panel is `#262b3f` on `#24283b`, **1.04:1** — two colours that differ in hue and
  not in luminance, which is how this survived a gate that measures ratios.

**THE SAME STATES IN A LIGHT PALETTE — localOperatorLight**, panel ground
`#faf8f1`:

| What is being read | Before | ΔE00 | After | ΔE00 |
| --- | --- | --- | --- | --- |
| The conversation row, at rest | `#e7f1e8` (wash) | 5.95 | `#efe9db` (`sunken`) | 4.40 |
| …with the pointer on it | `#fffefb` (`elevated`) | **6.93** from the mark | `#efe9db` | **0.00** from the mark |
| The pointer on a neighbouring row | `#fffefb` | 2.25 | `#fffefb` | 2.25, 6.54 from the mark |
| Entity row (wrapper / name button), at rest and hovered | wash on the wrapper, nothing on the name button; `#fffefb` on hover | — | `#efe9db` at rest AND hovered | 4.40 |

The recessed step is the weaker of the two instruments in this palette (4.40
against 5.95) and it is the one that survives the pointer; the wash's 5.95 was
never the problem here, which is the whole reason the fix is a per-call-site
ground rather than a palette edit.

**The four marks share a box, with one pre-existing difference.** Measured from
the page in CSS pixels (devicePixelRatio 2):

| Marked row | Ground box (CSS x) | Width | Δ against the list rows |
| --- | --- | --- | --- |
| A conversation row | 228 → 484 | 256 | — |
| `New chat` | 228 → 484 | 256 | 0 |
| `All chats` | 228 → 492 | 264 | +8 (it clears the scroll gutter the list reserves) |
| An entity row | 232 → 488 | 256 | +4 (the agents list's own container carries `p-1`) |

**The entity row's 4px inset is not this change's** (round 1, design D3): every
number in that table is IDENTICAL on the before tree, and the cause is a class on
the list's container, not on the row — aligning it would move the entity rows'
CONTENT by 4px, which is a layout change this fix does not make and does not
need. The two marks are never adjacent on screen (different sections, separated by
a heading) and the difference is 4px on a 256px box.

## The twelve palettes, from the repository's own maths

`scripts/palette-source.mjs` + `scripts/color.mjs`, over all twelve shipped
palettes. This is what says the role choice is not a per-theme accident, and what
the contract asserts at the field floor of ΔE00 **2.0**:

| Palette | `accentWash` vs `surface` | `sunken` vs `surface` | `elevated` vs `surface` | `sunken` vs `elevated` |
| --- | --- | --- | --- | --- |
| iceberg | 6.46 | **3.75** | **2.15** | 5.85 |
| localOperatorLight | 5.95 | 4.40 | 2.25 | 6.54 |
| localOperatorDark | 13.24 | 4.48 | 3.97 | 8.32 |
| obsidian | 4.46 | 4.49 | 4.72 | 9.17 |
| dune | 8.80 | 4.59 | 4.49 | 8.76 |
| monokai | 10.33 | 5.11 | 5.05 | 10.04 |
| sage | 5.62 | 5.27 | 3.07 | 8.05 |
| dracula | 3.28 | 7.10 | 4.87 | 10.82 |
| neon | 11.13 | 7.77 | 4.61 | 12.03 |
| **tokyoNight** | **1.05** | 8.68 | 4.58 | 13.15 |
| radient | 4.42 | 8.80 | 6.25 | 14.80 |
| synth | 6.69 | 14.94 | 5.44 | 16.70 |

- `sunken` clears the 2.0 floor against `surface` in **every** palette, worst case
  **3.75** (iceberg) — a margin of 1.75 over the floor, not 0.01.
- The wash is below that floor in **exactly one** palette, tokyoNight at 1.05; the
  next lowest is dracula at 3.28. (The next LOWEST is not "the second failure":
  this is one theme's defect, which is what made it invisible to a gate that stays
  green while every palette passes.)
- `elevated` was the other candidate and is rejected on those numbers: 2.15 in
  iceberg is 0.15 over the floor, and it is the same raised side as the hover step.
- `sunken` against `elevated` never falls below 5.85, which is what keeps selection
  and hover on opposite sides of the panel ground rather than one being a louder
  version of the other.

## The gates that stop this reverting

`pnpm check-themes` (the contrast contract) now carries four call-site pins, and
each one catches a different revert:

| Pin | Catches |
| --- | --- |
| `const rowCurrent = "bg-sunken text-ink hover:bg-sunken"` | the shared ground going back to a wash, or losing its `hover:` half |
| the session row's expression (`… !activeDraftKey && rowCurrent`) | the reported row losing the ground or the predicate |
| the entity row's name button (`cn(rowStyle, "flex-1 text-left", staged && rowCurrent)`) | the MAJOR: the ground leaving the element the pointer lands on |
| the settings rail's active row (`"bg-sunken font-medium text-ink hover:bg-sunken"`) | D2: the second `surface` panel going back to the wash |

`scripts/chat-sidebar-selection.test.mjs` (run by `pnpm test:desktop`) resolves
each of those expressions through the SHIPPED `cn` with the current-row
predicates stubbed true, and asserts the merged class list paints `bg-sunken` and
does not paint `hover:bg-elevated` on any element of a current row — which is what
makes a call-site reorder, a dropped `!staged` guard and a ground moved off the
hover-carrying element all fail.

## What is not in this set

- No `All chats` list with a nested row inside it (the nested state is captured
  under its entity only, which is where it is drawn).
- No hovered NESTED row: the pointer frames are the flat row, the entity row and a
  neighbour. The nested row's ground is the same class string and the same reading
  as the flat one (8.68), which is why it was not given its own hover frame.
- No `localOperatorDark` pass this round. It was in the previous set and is
  deliberately replaced by the light palette, which is the palette that answers
  the design round's question; the twelve-palette table above carries its numbers.
- The alternative ground's frame is one state on the selected row, not a second
  system; the shipped role is `sunken` and the comparison is labelled as not
  shipped wherever it appears.
