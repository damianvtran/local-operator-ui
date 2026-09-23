# Session archive and delete — rendered evidence

The surfaces this feature adds, photographed in the running app: the row's
archive control and its reveal, the archived marker, the search block's
`Include archived` control off and on, the open conversation archived with its
header pill, the two refusals (a delete the route answers 409 for, an archive the
same guard refuses), the undo offer an archive makes, the one permanent-delete
confirmation, the pane's landing when the open conversation is deleted, and the
withdrawn pair that is the fail-closed claim.

## How these frames were taken

`scripts/renderer-driver.mjs`, scene `session-archive`, in a headless launch
(`--window-mode` resolves to `headless` for a rig-shaped launch: `AGENTS.md` §
*Running the app without taking the operator's focus*), one launch per palette.
The TWO PANEL WIDTHS the pair frames need are not viewport widths: the panel's
width is the user's own preference (`chatSidebarWidth`, clamped 240..360), so the
scene writes it through the divider's own store action (`setSidebarWidth`), and a
window resize would photograph the same panel at the same width.
> **SUPERSEDED IN PART (2026-09-20, `docs/design/sidebar-row-space.md`).** Two
> families of frames here photograph behaviour that change deletes, and they are
> kept as the record of the state it replaced rather than re-taken:
>
> - **`row-controls-shared*`** (the 240px narrow band's one shared pin+archive
>   control) and **`row-controls-pair-rest`**'s "two reserved slots" - the shed
>   constant, the shared menu and the rest reservation are all gone (that spec's
>   D9): the pair is drawn at every width, and at rest NOTHING is reserved on an
>   unpinned row. **The frames themselves were removed in the 2026-09-23
>   re-capture** (they are recoverable from history, and they were, when they
>   shipped, the record of the state it replaced). The `row-space` scene's own
>   after frames (`docs/evidence/sidebar-row-space/after/`) are where that state
>   is now photographed and asserted.
> - **`archive-refused*` and `undo-offer`** - the offer and the refusal are the
>   panel's own sonner toast lane now (that spec's D11), not a register line: the
>   element they are of no longer exists, and the after set's `offer-toast-280`
>   carries the new state with the same two assertions (inside the panel, disjoint
>   from the composer's Send control).
>
> The frames themselves are untouched: they are what the register looked like, and
> a reader wanting the current behaviour should open the row-space set.
>
> **ADDED 2026-09-22 as `refusal-band-280`, FOLDED INTO `archive-refused` 2026-09-23.** The
> refusal's CURRENT shape - the panel's own band - is what the scene draws today, so its
> frame is `archive-refused`, re-captured here; the row-space set carries only OFFERS and
> the band's tallest case is the refusal (design round 4, D15). The separate
> `refusal-band-280` name was a second label for this same state at the 280 panel, and the
> re-capture dropped the duplicate. **The box the D15 row quotes is re-confirmed on this
> head's own run**: the scene's `measure` reports `band 142 / card 134` at the 280 panel,
> the same numbers (`264x142` / `248x134`) the row carries. The register-era frames
> (`archive-refused*`, `undo-offer` as they were before this re-capture) are recoverable
> from history, and the set's own copy of those states now shows the lane, which is what
> the app draws.

**One stub per launch**, because the scene MUTATES the stub (it archives two
conversations), so a second launch against the same process starts from a
different store and the first row it looks for is not drawn.

The app is the real one; the daemon underneath it is **not**:

```
# 1. a build pointed at the stand-in backend (the real one is the sibling pull
#    request on damianvtran/local-operator, branch feat/session-archive-delete):
#    the repo's own .env supplies the other keys.
set -a; . ~/local-operator-ui/.env; set +a
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build

# 2. the load-bearing step: FRESH STUB, one per launch, then ONE launch per
#    palette (the scene writes <out>/<scene-label>.png, and the label-to-directory
#    convention below is what turns those files into the set committed here)
node docs/evidence/session-archive/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/archive-stub-records
LOCAL_OPERATOR_DESKTOP_TOKEN=stub-token-archive node scripts/renderer-driver.mjs \
  --scene session-archive --backend http://127.0.0.1:18234 \
  --backend-records /tmp/archive-stub-records --seed-onboarding-complete \
  --theme localOperatorDark --out /tmp/archive-frames-dark --window-size 1380x900
# NOTE (2026-09-20): the scene no longer emits `shared-rest`, `shared-hover` or
# `shared-menu` (the narrow band's shared control is deleted), and `pair-narrow`
# is now the pair AT 240 rather than the shed state - the row-space spec's D9. The
# frames below are the record of what the scene produced BEFORE that change, so
# re-running with this loop is not expected to reproduce `row-controls-shared*`;
# the loop is kept as the recipe that took them. `archive-refused*` and
# `undo-offer` are still emitted, but they are TOAST frames now and are captured
# through `captureWithToast` rather than `captureSettled`.
# NOTE (2026-09-23): the labels ARE the directory names now. This pass re-captured the
# whole set at the head that folded #430 (the offer's band reserved in the commit that
# lets a row go), so the sed mapping below is gone for every frame the scene emits
# today, and three renames landed: `pair-wide` / `pair-rest` / `pair-pin` / `pair-narrow`
# are the scene's own names for what the old convention called `row-controls-pair`,
# `row-controls-pair-rest`, `row-controls-pin-hover` and `row-controls-*` (the narrow
# band's shared control, which is deleted and whose frames are gone with it), and
# `search-off` / `search-on` replace `search-live-only` / `search-include-archived`.
# `settle-probe` is a new frame: the helper's own still before the arrival sequence, and
# it is NAMED here because the row-space set's copy was the thing design round 9's D26
# filed as unnamed.
for f in at-rest row-hover row-hover-body search-off search-on delete-dialog \
         delete-refused archive-refused archive-refused-chats-only header-archived \
         undo-offer deleted-open pair-wide pair-rest pair-pin pair-narrow settle-probe; do
  d=docs/evidence/session-archive/$f
  mkdir -p "$d"
  cp /tmp/archive-frames-dark/$f.png "$d/localOperatorDark.png"
  cp /tmp/archive-frames-light/$f.png "$d/localOperatorLight.png"
  # every directory is its own label: the label-to-directory step is a copy, not a rename
  # (the sed that mapped `search-off`/`search-on`/`pair-*` onto the OLD names is removed)
  # (`refusal-band-280` was a layout name for the band's refusal at the 280 panel; that
  #  state is what `archive-refused` is of at this head, so the duplicate is gone)

done

# 3. the withdrawn half: the same app against a daemon with no archive store,
#    again on a FRESH stub and its own records directory
node docs/evidence/session-archive/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/archive-stub-records2 --no-archive
LOCAL_OPERATOR_DESKTOP_TOKEN=stub-token-archive node scripts/renderer-driver.mjs \
  --scene session-archive --backend http://127.0.0.1:18234 \
  --backend-records /tmp/archive-stub-records2 --seed-onboarding-complete \
  --theme localOperatorDark --capability-withdrawn \
  --out /tmp/archive-frames-withdrawn --window-size 1380x900
cp /tmp/archive-frames-withdrawn/at-rest.png \
   docs/evidence/session-archive/capability-withdrawn/localOperatorDark.png
cp /tmp/archive-frames-withdrawn/search-off.png \
   docs/evidence/session-archive/capability-withdrawn-search/localOperatorDark.png
```

The scene asserts before it photographs. Run 1 (dark) and run 2 (light) report
`ALL CHECKS PASSED` with **seventeen frames each**; the withdrawn run reports the same
with two. The set committed here is therefore **36 PNGs** (17 + 17 + 2), and the count
is stated because this paragraph's predecessor said nineteen-with-a-rename-mapping and
the manifest's earlier `headNote` said 24 — both stale when written. What the assertions cover, in the run's own words: the catalogue
answered, the archived conversation matches nothing before the control is on and a
row after it, the delete confirmation is open on the conversation the menu was
opened on, **Cancel hands the keyboard back to the header trigger**, the refused
delete stays in the dialog **with the keyboard on Cancel**, a refused archive is
reported in the panel's own **toast lane** (the D11 lane at the panel's bottom, which
the app draws at its root — not the register line whose element the code no longer has), archiving the OPEN conversation adds the pill and leaves
the pane open, **the archive offer outlives the catalogue answers** (it was still
on screen 10s after the press, where the rule this round replaced retired it in
0.4-1.6s), **the keyboard lands on a row after a row press** (not on `<body>`),
**deleting the open conversation lands on the existing missing-session notice**,
the unread mark is DRAWN on the row the widths are measured from and nowhere else
(the fixture's `attention` had to be given the shape `mergeCompletionAttention`
accepts — design round 2, D11 — or two equal title widths were two BARE rows), and
the offer frame is a still picture of a lane card that was really there. Every
settled frame additionally refuses to be committed unless the app held it still
(`stable`) and nothing transient was on it (`toastFree`).

Two steps the scene takes that a re-runner should not be surprised by: it CLEARS
the search box before the row-level steps (a query filters the list, so a row it
presses would not be drawn), and it EXPANDS `Previous chats` once and relies on
the sidebar persisting that disclosure (a second toggle would collapse the
section its last step presses).

## What each frame is, and what it is not

Every frame is the real renderer: the real sidebar, the real canonical-sessions
store, the real search, the real header, the real `ConfirmationModal`. The wire
underneath is `harness/stub-daemon.mjs`, which answers the **frozen** contract's
shapes (`include_archived` on both reads, `archived` on every row and hit,
`sessions.archive`, `sessions.delete` with its 409 guard, the two capability
keys) and nothing else. It advertises `session_pins` and serves
`POST .../pin` as well, because the row's per-row controls are a PAIR and the
width rule this set photographs is about that pair: a stand-in that advertised
only the archive half would photograph a row no user can reach. Nothing in these
frames presses the pin. The sentences the two refusal frames show are the
**route's own wording**, quoted in the stub from what the UX round reported
reading against the real daemon; what the client adds around them (the remedy
line, the lane, the Retry) is what those frames are of.

| Frame | State | The claim it proves | How |
| --- | --- | --- | --- |
| `at-rest/{dark,light}` | the panel with the capability present, nothing archived on screen | **nothing is DRAWN at rest**: no marker, no search-block chrome — while the 24px slot is still RESERVED (see the numbers below) | `--theme <palette>`, no scene step beyond `navigate("/chat")` |
| `row-hover/{dark,light}` | the pointer parked on the archive control of a live row | the affordance appears on the pointer's row and nowhere else, without the row moving (`group-hover`, opacity only) — and the control under the pointer is the one that reads at full ink: brightest glyph pixels `#F1EEE7` (241) in the archive slot against `#C1BCB1` (193) in the pin slot beside it, both sampled inside their own 24px boxes (design round 4, D22, measured here rather than described) | the scene moves the **real** pointer (`Input.dispatchMouseEvent` at the control's box, from the `measure` verb) before the shutter |
| `row-hover-body/{dark,light}` | the list's FIRST session row, pointer on its TITLE | the pair with `row-hover` settles design round 1 D5: the row's own highlight is a property of the ROW, not of the control's 24px box - and the two frames hover DIFFERENT rows (`row-hover` the unread-marked `b3f1a09c7d52` at y 1656..1719, this frame the list's first at y 1376..1439), which is why its own row is named whenever the frame is used as a control | the same, with the pointer 60px right of the row's left edge |
| `pair-wide/{dark,light}` | the panel at its **280px default**, pointer on the row that carries an unread mark | the pair - a pin slot and an archive slot - reveals on that row and nowhere else, at a title width this set's own run reports as **228px** at rest (`pin 0x0, archive 0x0`: nothing is reserved on an unpinned row) and **172px** with the pair drawn. The `row-controls-shared` state this row used to describe is DELETED from the app (D9), so there is no shared control left for the row to call absent | the scene writes the panel width the divider writes (`setSidebarWidth`, 280), asserts the pair is drawn at this width, then moves the real pointer onto the row |
| `pair-pin/{dark,light}` | the 280px pair with the pointer parked on the **PIN** control | the pin's own step, which is the D22 change that lands on a RELEASED surface: main's pin declared no `hover:` colour at all, so this frame measures it rather than asserting it by construction — with the pointer on the pin the slots read `#F1EEE7` (241) / `#211E19` (33) in the pin's box against `#C1BCB1` (193) / `#4D4941` (77) in the archive's, dark and light (agent review round 4, R4-4) | the same run as `pair-wide`, with the pointer then moved onto `[data-session-pin]` and a second capture |
| `pair-rest/{dark,light}` | the same 280px panel, pointer PARKED off the list | the other half of the pair's rule, and this head states it as a measurement rather than a reservation: with the pointer off the list and the row unpinned, NOTHING is reserved — the driver's own report on this set's run is `pin 0x0, archive 0x0`, two zero boxes — which is D9's rule that the layout no longer holds a slot open for a control that is not drawn | the same run, with the pointer parked before the shutter |
| `search-off/{dark,light}` | `notes` typed in the search box, `Include archived` off | the search block gains its one control only while a query exists; the archived conversation is NOT in the answer, and `[data-session-archived]` matches nothing | the scene types into the field through the input pipeline, then asserts the absence |
| `search-on/{dark,light}` | the same query, the control ON | the archived conversation is reachable from the search, carries the muted leading marker, and the sidebar has gained no section to hold it | a real click on the checkbox, then an assertion that `[data-session-archived]` now matches and is in the viewport |
| `pair-narrow/{dark,light}` | the pair at the panel's **240px clamp minimum** | the pair is drawn at EVERY width now (the row-space spec's D9 deleted the shared control this row used to photograph): same two slots, same two acts, narrower panel - and the driver asserts the shared control is not in the document at all, so "shed" can no longer be confused with "drawn elsewhere" | the same run as `pair-wide`, at 240 |
| `settle-probe/{dark,light}` | the helper's own still, taken immediately before the arrival sequence | **the frame this set used to carry unnamed** (design round 9's D26 filed the row-space set's copy as identical to another frame and cited by neither README nor manifest): it is the settled list the arrival probes perturb, kept so the pre-arrival state is a picture rather than a claim, and it is named here for that reason | a plain `capture` through the arrival helper, before any press |
| `delete-dialog/{dark,light}` | the header's conversation menu → `Delete conversation…` | the one permanent delete asks with the danger role, names the conversation, says the transcript cannot be undone, and does nothing on its own | two real clicks (the trigger, then the item), then the dialog's box is measured |
| `delete-refused/{dark,light}` | the same dialog, `Delete` pressed on a conversation a live session claims | the refusal stays **in the dialog that asked**, the route's sentence is quoted and the window's own remedy follows it, and the keyboard is back on **Cancel** | the stub answers 409 for one conversation `live_claim: true`; the scene presses Confirm and then measures `[data-cancel-action]` for `focused` |
| `archive-refused/{dark,light}` | the archive control pressed on the conversation a running session claims, so the daemon refuses it | a refused archive is reported in the panel's own **toast lane** - the same `[data-archive-toast-band]` the offer uses, drawn in EVERY assembly mode (`chats-only` included, agent review round 4's R4-1) - with the **Retry** that re-sends the desired state; the register line this row used to describe, and the `[data-session-archive-failure]` selector it used to cite, are both gone from the tree | the scene clicks the row's control and asserts the refusal's Retry is in the viewport and hit-testable |
| `archive-refused-chats-only/{dark,light}` | the refused archive with the **entity region collapsed by the panel's own control** | R4-1's proof, in the mode that was broken: the refusal is reported in the lane the panel draws at its own root, not in the entity region's tree, so it survives `chats-only` — the scene asserts `[data-sidebar-region="entities"]` is UNMOUNTED and that the sentence and its Retry are both in the viewport, which is the assertion the old text-adjacency test could not make | the cluster's hide control hovered and pressed (`movePointer` + `pressPointerStationary`), asserted, then the restore row pressed to return |
| `header-archived/{dark,light}` | the open conversation archived from its own menu, no dialog open | archiving the OPEN conversation keeps the pane open and adds the header's `Archived` pill with its restore control beside it | the scene archives from the menu, asserts the pill is in the viewport AND `activeSessionId` is still that conversation, and waits out the offer's 15s ceiling so nothing transient is over the pill's ink |
| `undo-offer/{dark,light}` | a row's archive just succeeded | a successful archive offers **Undo** in the panel's own lane - sonner's card in the band at the panel's bottom (`[data-archive-toast-band]`, the D11 lane), not the register line this row used to describe, whose element no longer exists - and the offer outlives the catalogue's answers, being taken down by the lane's own duration rather than by them | a real click on the row's control, then a plain `capture` (this is the frame that is OF the offer, so it carries its own `stable` + `offerOnScreen` checks alongside the `toastFree` ones) |
| `deleted-open/{dark,light}` | the OPEN conversation deleted from its own menu | the pane lands on the missing-session notice that already existed — naming the conversation that is gone, with the composer refusing input — and the route stays on the deleted id rather than being swapped for a blank pane | the stub deletes an `idle`, unclaimed conversation; the scene asserts `#lo-missing-session-notice` is in the viewport AND `activeSessionId` is still that conversation |
| `capability-withdrawn/{dark}` | the same panel against a daemon that advertises neither capability | no slot, no marker, no control in the search block | `stub-daemon.mjs --no-archive` + `--capability-withdrawn`, which asserts both absences |
| `capability-withdrawn-search/{dark}` | the same, with a query typed | the search block still gains nothing | same run |

## The measurements, stated as numbers you can reproduce

**The panel is 280px, not 320.** Every frame is `2760x1736` device pixels at DPR 2
(1380x868 CSS). The sidebar's surface ends at device `x 999` and begins at
`x 440`, so it is **280 CSS px** wide — `DEFAULT_CHAT_SIDEBAR_WIDTH`, the default
of a 240–360 clamp:

```
magick docs/evidence/session-archive/at-rest/localOperatorDark.png \
  -crop 200x1+900+900 +repage txt:- | awk -F'#' 'NR>1 {print $2}' | uniq -c | head
#   the colour changes once, at device x 1000 (2A2722 -> 22201C)
```

**Two slots cost 28px each, and the frames carry both halves of the rule.**
The archive control measures 24px (`size-6`) and the wrapper's `gap-1` adds 4px,
so 28px of the title's line box is reserved on every row, at rest, whether or not
the pointer is near it. The arithmetic and the three panel widths:

| panel | no control | the shared control (240) | one slot | two slots (280, = these frames) |
| --- | --- | --- | --- | --- |
| 240 (clamp min) | 196 px | **168 px — measured** | 168 px | **140 px** (shed) |
| **280 (default)** | 236 px | 168 px | 208 px | **180 px — measured** |
| 360 (clamp max) | 316 px | 168 px | 288 px | 260 px |

Two columns are MEASURED, and they are the two the delivered rule turns on: at the
280 default the pair leaves a **180 px** title, and at the 240 clamp minimum the
single shared control leaves **168 px**. Both come from the driver's own report on
this set's trees:

```
# 280px panel  -> status row 180px, unread row 180px; pin 24x24, archive 24x24
# 240px panel  -> status row 168px, unread row 168px; pin 0x0, archive 0x0, shared 24x24
```

The arithmetic that reproduces both, and predicts the rest of the table, is
`panel − 16 (the panel's own p-2) − 28 × controls − 28 (the row's own px-1, its
LEADING status slot, and the gaps) − 8 (the scrollbar gutter the list reserves)`. The 28
per control is the `size-6` box plus the row's `gap-1`; the fixed 28 is 8 (the row's
`px-1`) + 16 (`ChatSessionStatus`'s `size-4`) + 4 (the gap between them); the 8 is the
`[scrollbar-gutter:stable]` inset, which is why the numbers below are 8 short of what the
same formula gave before it. Checked against this head's own run rather than assembled:
`280 − 16 − 0 − 28 − 8 = 228` and `240 − 16 − 0 − 28 − 8 = 188`, which is exactly what the
driver reports. **LEADING, not trailing** (design round 2,
D14): this paragraph used to call it the row's trailing status slot, which is what
four lanes then quoted as the reason a row with an unread mark has a narrower
title. It does not - the mark is drawn INSIDE that leading slot - and the formula
was right about the number while naming the wrong edge.
The pair's own price is visible in the frame: **where the two slots are drawn they cost
56 px of title** (2 × 28), so the same arithmetic gives `228 − 56 = 172` at the 280 panel
and `188 − 56 = 132` at 240 — the pair-shown widths (design round 10 read them on this
head), against the at-rest `228` and `188` above. The comparison this paragraph used to
draw against "the single shared control" is gone with that control (design D9 deleted it,
see the superseded note at the top), so the `180` / `140` / `168` figures it quoted are the
superseded layout's and are not this set's.

**The row that carries an unread mark has exactly the same title width as one that
does not** — `228 px` and `188 px` at rest on this set's own runs, `172` and `132` with the
pair drawn. That is worth stating because
the opposite was assumed when this set was planned: the unread mark is drawn in
the row's reserved STATUS slot, which is laid out before the title and does not
take width from it. What costs title width is a control slot, and only that. The
frames carry the mark anyway (`pair-wide`, `pair-pin` and `pair-narrow` hover the unread
row), so the claim and the picture are of the same row.

**The set was re-captured at the #430 fold (2026-09-23), and the numbers below are this
set's where they could be re-derived on it.** Every frame here was re-shot with the same
two launches per palette plus the withdrawn run, on fresh stubs, at
`2c2e1a8c8` — the head that reserves the offer's band in the commit that lets a row go —
and the ledger is: **22 frames the set already carried were replaced, 14 arrived under
the labels this driver emits, and 10 the scene no longer draws were removed** (the
narrow band's seven `row-controls-shared*` frames, `refusal-band-280`, and the two
search frames whose states are now `search-off` and `search-on`). Three consequences
worth stating rather than discovering:

- The scene emits the labels the directories now carry, so the label-to-directory sed
  mapping is gone. The frames removed are recoverable from history (`git show
  <the commit before this one>:docs/evidence/session-archive/<name>`), and the state the
  shared control was of is deleted from the app (the row-space spec's D9), which is why
  the row-space set - not this one - is where that behaviour is photographed now.
- **The hover ground's endpoints are re-read on this set: `456..967` device (CSS 228..483.5),
  against `456..983` (CSS 228..491.5) on the previous frame.** The D18/D23 property — the
  row's ground reaching the row box's right edge — **still holds**; what moved is the box,
  by the `[scrollbar-gutter:stable]` inset of 8 px. See the D18/D23 paragraph below for the
  full reading, and note that the first correction this note carried ("the ground no longer
  reaches the box's right edge") was a MISREADING of this PR's own hover flyout and its
  shadow: it is corrected there, in the manifest, and on the PR.
- The row-internal geometry the 21.5 px marker figure derives from is unchanged on this
  set: the archived row's title still starts where the marker's own reserved slot ends. The
  driver's own report on THIS set's runs is `status row 228px, unread row 228px; pin 0x0,
  archive 0x0` at the 280 panel and `status row 188px, unread row 188px; pin 0x0, archive 0x0`
  at 240, dark and light agreeing — the controls measure 0x0 because at rest nothing is
  reserved on an unpinned row (D9), which is the other half of why the figures are not the
  ones the older paragraphs quote: `180px` with `24x24` boxes and `168px` against a `24x24`
  shared control is the superseded layout's account, and the control it counts does not
  exist in this tree.
- **Known limits of the shipped instrument, stated rather than left implicit.** (a) The
  committed walk's rAF sampler is BLIND to the scroll clamp this set is about: its samples are
  taken per frame, and a clamp that lands inside one frame is simply not in the series - which
  is why the arrival's own mutation-callback assertion is the only place the clamp is caught,
  and why the instrument that fixed the defect could not itself see it (QA round 7 named
  exactly this gap). (b) D28's state - a pressed row's own acknowledgement register - cannot
  be photographed here at all, because the committed stub cannot hold `sessions.archive`; this
  set does not fake it, and the deferral is recorded in the manifest.

**The archived marker costs a ragged title column of 21.5px (design round 1 D4;
re-derived on THIS set by design round 3).** In `search-on/{dark,light}`
the archived row's title starts at **CSS 274.5** and its live sibling's at **253.0**
— 21.5px, the marker being a 13 × 12 CSS box glyph at `--lo-ink-dim` (5.70:1 dark /
5.74:1 light on the panel). The number is the design round's measurement on the
frames this set ships, which is the provenance the earlier paragraph said it owed:
the marker's own box (`ml-1 size-3.5`) did not change, so the offset is the same,
and it is now read off these artefacts rather than carried from the earlier set.

**The row's hover ground reaches the row box's right edge (design round 3, D18;
endpoints corrected in round 4, D23).**
On `pair-wide/localOperatorDark.png` the hovered row's ground runs from device x **456 to
967** at the row's own centre line — **CSS 228..483.5**, the row box's right edge — against
**456..983** (CSS 228..491.5) on the previous set's frame of the same state, the difference
being the `[scrollbar-gutter:stable]` inset of 8 px this head reserves. Half of that edge is
read through this PR's own hover flyout: the run is the row's ground in its exact token up
to **946**, then the SAME ground dimmed to **967** - the flyout's shadow falling over it, not
another surface - then the panel ground at 968..979 (dimmed by the same shadow), the flyout's
border at **980..981** (= the row box's right edge `484` + the flyout's `sideOffset 6` = `490`
CSS, matching the committed `flyout.left = 490`), and its fill (`bg-elevated`) from 982. **The
dim is a RAMP, not a value**: on this frame the ground reads `srgb(48,45,42)` at x 941..946 and
steps down through `srgb(47,44,41)` to `srgb(46,43,41)` by 967, and the panel ground under the
same shadow reads `srgb(40,37,33)` at 970 falling to `srgb(40,37,32)` at 979 - so quoting one
number for "the dimmed run" is a channel off depending on where it is sampled (QA round 7,
Q-14; the light palette's ground reads `srgb(236,235,231)` with the same ramp). The
corroboration is the
frame's own sibling: on `row-hover-body`, which draws no flyout, the ground reads UNDIMMED and
flat - `srgb(48,45,42)` across x 951..967 at that frame's centre line - the panel ground runs
968..999 and there is nothing at 980. **It is that frame's OWN hovered row, not this one**:
`row-hover-body` hovers the list's FIRST session row (`2d5ad5da0025`, "Invoice reconciliation")
at device y 1376..1439, while `row-hover` and `pair-wide` hover `b3f1a09c7d52` at y 1656..1719,
so sampling the earlier row's line on the body frame returns the panel ground and reads as if
this control had failed (design round 11, D37). **The D18/D23
property therefore still holds** — the ground reaches the box's right edge on this set too;
an earlier revision of this paragraph claimed otherwise by reading the shadow's early end
and the flyout's fill as other grounds, and that claim is withdrawn rather than softened.
(An earlier line said 470..982 — 470 is CSS 235, i.e. 7px inside the box; before the D23
fix the same frame measured CSS 228..436 — the conversation button's own ground, 56px
short — because the class stating it on the box was inert. The scene still asserts the box's
own computed background, with the pointer on the row and again with it on a control, so a
class that never matches cannot pass again.)

```
# on THIS set's frame, at the hovered row's centre line (y 1687):
#   x 941..946  srgb(48,45,42)   the row ground, exact token
#   x 951..967  srgb(47,44,41)   the same ground, -1/channel: the flyout's shadow
#   x 968..979  srgb(40,37,32)   the panel ground under the same shadow
#   x 980..981  srgb(63,59,46)   the flyout's border = row edge 484 + sideOffset 6
#   x 982..999  srgb(49,45,35)   the flyout's fill (bg-elevated)
# and on row-hover-body (no flyout), ITS OWN hovered row - the list's first, device
# y 1376..1439, not the row the other two frames hover:
#   ground flat srgb(48,45,42) through 967, panel srgb(42,39,34) at 968..999, nothing at 980
```

**The withdrawn pair differs in exactly two count badges, and nowhere else.**
`magick compare -metric AE` on the two `at-rest` frames reports **354 device
pixels** above a threshold of 8/channel, in exactly two clusters (re-derived on
THIS round's frames, at the folded head; the number moves by a pixel or two between
sets because the badges' own glyphs land on different sub-pixels, and the claim —
two clusters, both of them counts — does not):

```
magick docs/evidence/session-archive/at-rest/localOperatorDark.png \
       docs/evidence/session-archive/capability-withdrawn/localOperatorDark.png \
  -compose difference -composite -threshold 8 \
  -define connected-components:verbose=true -connected-components 8 null:
#   13x18+962+1376   (css x 481..487, y 688..697)   "All chats      4 -> 5"
#   14x19+961+1683   (css x 480.5..487.5, y 841.5..851)   "Previous chats 2 -> 3"
```

Both are the counts, and both were checked by cropping the badges out of the two
frames and reading them. With those two badges masked, the remaining **4.79
million pixels are identical** — not "a band around a live row", the whole frame:

```
for f in docs/evidence/session-archive/at-rest/localOperatorDark.png \
         docs/evidence/session-archive/capability-withdrawn/localOperatorDark.png; do
  magick "$f" -fill black -draw "rectangle 950,1368 990,1404" \
                     -draw "rectangle 950,1675 990,1712" "/tmp/masked-$(basename $(dirname $f)).png"
done
magick compare -metric AE /tmp/masked-at-rest.png /tmp/masked-capability-withdrawn.png null:   # -> 0
```

That is the fail-closed claim as a measurement, and it is also the correction of
an earlier sentence in the source comments and in this file: the withdrawn panel
is **not** DOM-identical to the enabled one, because with no capability nothing is
hidden and an archived conversation is LISTED. What the pixels say is the useful
version — nothing at all changes on screen except the two counts of what is
listed, and no row of the withdrawn panel is drawn differently from its live
sibling in the enabled one.

**What the withdrawn pair is OF moved at the fold, and the claim moved with it.**
`main` now carries the pin control, so the withdrawn panel is the **pin-only**
panel: the row's archive surface (control, marker, pair wrapper, shared control,
the `Include archived` control) is absent, and the pin control — a different
feature, with a different capability — is present, because the stand-in
advertises it. The byte-identity this pair proves is therefore against the
pin-only panel, not against a panel without pins; the earlier "identical to the
pre-change panel" wording named a tree main has since moved past.
