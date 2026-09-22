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
>   unpinned row. The `row-space` scene's own after frames
>   (`docs/evidence/sidebar-row-space/after/`) are where that state is now
>   photographed and asserted.
> - **`archive-refused*` and `undo-offer`** - the offer and the refusal are the
>   panel's own sonner toast lane now (that spec's D11), not a register line: the
>   element they are of no longer exists, and the after set's `offer-toast-280`
>   carries the new state with the same two assertions (inside the panel, disjoint
>   from the composer's Send control).
>
> The frames themselves are untouched: they are what the register looked like, and
> a reader wanting the current behaviour should open the row-space set.
>
> **ADDED 2026-09-22: `refusal-band-280/{dark,light}`.** The refusal's CURRENT shape -
> the panel's own band - now has a frame of its own in this set, because the row-space
> set carries only OFFERS and the band's tallest case is the refusal (design round 4,
> D15). `archive-refused*` and `undo-offer` stay exactly as they are: they are the
> record of the register, not of the lane.

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
for f in at-rest row-hover row-hover-body search-off search-on delete-dialog \
         delete-refused archive-refused archive-refused-chats-only header-archived \
         undo-offer deleted-open pair-wide pair-rest pair-pin pair-narrow; do
  d=docs/evidence/session-archive/$f
  mkdir -p "$d"
  cp /tmp/archive-frames-dark/$(echo $f | \
       sed 's/search-off/search-live-only/;s/search-on/search-include-archived/;s/pair-wide/row-controls-pair/;s/pair-rest/row-controls-pair-rest/;s/pair-pin/row-controls-pin-hover/;s/pair-narrow/row-controls-shared/;s/shared-rest/row-controls-shared-rest/;s/shared-hover/row-controls-shared-hover/;s/shared-menu/row-controls-shared-menu/').png \
     "$d/localOperatorDark.png"
done

# …then the same two steps with --theme localOperatorLight into
#    --out /tmp/archive-frames-light, copying into the same directories as
#    localOperatorLight.png. The scene labels two frames differently from the
#    directory names (`search-off` → `search-live-only`, `search-on` →
#    `search-include-archived`); the sed above is that mapping, and it is the only
#    renaming step - every other directory is the label.

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
`ALL CHECKS PASSED` with **nineteen frames each**; the withdrawn run reports the same
with two. The set committed here is therefore **42 PNGs** (19 + 19 + 2, plus the two
frames of `refusal-band-280` - see the row below), and the count is stated because the
round brief and the manifest's earlier `headNote` both said 24 — a number that was
already stale when they were written. What the assertions cover, in the run's own words: the catalogue
answered, the archived conversation matches nothing before the control is on and a
row after it, the delete confirmation is open on the conversation the menu was
opened on, **Cancel hands the keyboard back to the header trigger**, the refused
delete stays in the dialog **with the keyboard on Cancel**, a refused archive is
reported in the panel's register (at the panel's root, above both regions), archiving the OPEN conversation adds the pill and leaves
the pane open, **the archive offer outlives the catalogue answers** (it was still
on screen 10s after the press, where the rule this round replaced retired it in
0.4-1.6s), **the keyboard lands on a row after a row press** (not on `<body>`),
**deleting the open conversation lands on the existing missing-session notice**,
the unread mark is DRAWN on the row the widths are measured from and nowhere else
(the fixture's `attention` had to be given the shape `mergeCompletionAttention`
accepts — design round 2, D11 — or two equal title widths were two BARE rows), and
the offer frame is a still picture of a register that was really there. Every
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
line, the register, the Retry) is what those frames are of.

| Frame | State | The claim it proves | How |
| --- | --- | --- | --- |
| `at-rest/{dark,light}` | the panel with the capability present, nothing archived on screen | **nothing is DRAWN at rest**: no marker, no search-block chrome — while the 24px slot is still RESERVED (see the numbers below) | `--theme <palette>`, no scene step beyond `navigate("/chat")` |
| `row-hover/{dark,light}` | the pointer parked on the archive control of a live row | the affordance appears on the pointer's row and nowhere else, without the row moving (`group-hover`, opacity only) — and the control under the pointer is the one that reads at full ink: brightest glyph pixels `#F1EEE7` (241) in the archive slot against `#C1BCB1` (193) in the pin slot beside it, both sampled inside their own 24px boxes (design round 4, D22, measured here rather than described) | the scene moves the **real** pointer (`Input.dispatchMouseEvent` at the control's box, from the `measure` verb) before the shutter |
| `row-hover-body/{dark,light}` | the same row, pointer on its TITLE | the pair with `row-hover` settles design round 1 D5: the row's own highlight is a property of the ROW, not of the control's 24px box | the same, with the pointer 60px right of the row's left edge |
| `row-controls-pair/{dark,light}` | the panel at its **280px default**, pointer on the row that carries an unread mark | the delivered rule: **two sibling reserved slots** (pin, then archive) reveal on that row and nowhere else, at a measured title width of **180px** — and the shared control is NOT drawn | the scene writes the panel width the divider writes (`setSidebarWidth`, 280), asserts the pair's box and the shared control's ABSENCE, then moves the real pointer onto the row |
| `row-controls-shared/{dark,light}` | the same panel at its **240px clamp minimum**, same row | the rule's other half: the pair is SHED and **one shared pin+archive control** stands in its place, at a measured title width of **168px** — the same two acts, one slot, no act lost | the same, at 240, with both controls' boxes read (`pin 0x0, archive 0x0, shared 24x24`) so "shed" is a measurement rather than a description |
| `row-controls-pin-hover/{dark,light}` | the 280px pair with the pointer parked on the **PIN** control | the pin's own step, which is the D22 change that lands on a RELEASED surface: main's pin declared no `hover:` colour at all, so this frame measures it rather than asserting it by construction — with the pointer on the pin the slots read `#F1EEE7` (241) / `#211E19` (33) in the pin's box against `#C1BCB1` (193) / `#4D4941` (77) in the archive's, dark and light (agent review round 4, R4-4) | the same run as `row-controls-pair`, with the pointer then moved onto `[data-session-pin]` and a second capture |
| `row-controls-pair-rest/{dark,light}` | the same 280px panel, pointer PARKED off the list | the other half of the pair's rule: the slots are RESERVED with nothing drawn in them — two boxes, no glyphs — which a frame with the pointer on the row cannot show, because the pointer is what reveals them | the same run, with the pointer parked before the shutter |
| `row-controls-shared-hover/{dark,light}` | the 240px panel with the pointer on the **shared trigger**, nothing open | the one state D25 found unphotographed, and the arm of D22 measured cleanly: the trigger reads `#F1EEE7` (241) under the pointer against `#C1BCB1` (193) when the pointer is merely on the row, dark (`#211E19`/33 against `#4D4941`/77 in light) | the same run at 240, with the pointer moved onto `[data-session-actions]` and NO click, so nothing is open |
| `row-controls-shared-rest/{dark,light}` | the 240px panel, pointer parked | the shared control at REST, which is the state it was measured wrong in (design round 2, D10): it used to be drawn in the row's own ink at rest and to DIM under the pointer, so every row wore a title-weight glyph at the width with least room. Nothing is drawn here now | the same, at 240, with the pointer parked |
| `row-controls-shared-menu/{dark,light}` | the shared control opened with the pointer, at 240 | the affordance that NAMES its two acts (`Pin/Unpin conversation`, `Archive/Unarchive conversation`), so "one slot, no act lost" is a picture rather than a claim about the source | a real click on `[data-session-actions]`, then `Escape` closes it before the scene continues |
| `search-live-only/{dark,light}` | `notes` typed in the search box, `Include archived` off | the search block gains its one control only while a query exists; the archived conversation is NOT in the answer, and `[data-session-archived]` matches nothing | the scene types into the field through the input pipeline, then asserts the absence |
| `search-include-archived/{dark,light}` | the same query, the control ON | the archived conversation is reachable from the search, carries the muted leading marker, and the sidebar has gained no section to hold it | a real click on the checkbox, then an assertion that `[data-session-archived]` now matches and is in the viewport |
| `delete-dialog/{dark,light}` | the header's conversation menu → `Delete conversation…` | the one permanent delete asks with the danger role, names the conversation, says the transcript cannot be undone, and does nothing on its own | two real clicks (the trigger, then the item), then the dialog's box is measured |
| `delete-refused/{dark,light}` | the same dialog, `Delete` pressed on a conversation a live session claims | the refusal stays **in the dialog that asked**, the route's sentence is quoted and the window's own remedy follows it, and the keyboard is back on **Cancel** | the stub answers 409 for one conversation `live_claim: true`; the scene presses Confirm and then measures `[data-cancel-action]` for `focused` |
| `archive-refused/{dark,light}` |
| `archive-refused-chats-only/{dark,light}` | the refused archive with the **entity region collapsed by the panel's own control** | R4-1's proof, in the mode that was broken: the register is a root child beside the pin's failure line, so it survives `chats-only` — the scene asserts `[data-sidebar-region="entities"]` is UNMOUNTED and that the sentence and its Retry are both in the viewport, which is the assertion the old text-adjacency test could not make | the cluster's hide control hovered and pressed (`movePointer` + `pressPointerStationary`), asserted, then the restore row pressed to return |
 the archive control pressed on the same claimed conversation | a refused archive reports in the panel's own register - at the panel's root, drawn in EVERY assembly mode (`chats-only` included, agent review round 4's R4-1) - with the **Retry** that re-sends the desired state | the scene clicks the row's control and asserts `[data-session-archive-failure]` is in the viewport |
| `refusal-band-280/{dark,light}` | the archive control pressed on the conversation a running session claims, at the panel's **280px default** - the frame the design round's **D15** asked for, because the band's largest case had no measured box | the refusal in the shape D14 puts it in: the panel's own bottom band rather than an overlay, holding the **full** card (the sentence is nine lines and the band clips only past `calc(100% - 56px)`). The box, read in both palettes rather than quoted: **band 264x150 at x 228..492** (`y 710..860`), **card 248x142 at x 228..476** (`y 718..860`), panel 280x868, gap 8 - so `band.height == card.height + 8` as D14's ruling says, and the document's `216x170` / `216x206` are both stale in x AND y at this head. THE CARD'S X IS A READING THE RULING'S TABLE GETS WRONG: D14's table predicts the card "unchanged" at `244..492` (`panel.right - 8`), and the measured card sits at the LANE's left edge, **228..476**, with 16px of slack on the lane's right - the same left-anchoring `offer-toast-320` measures at the wider lane. Reported as a finding rather than reconciled here: nothing in the band's height ruling depends on x | ONE launch per palette on a fresh stub: the scene presses the row's control, asserts the refusal is in the lane with a hit-testable Retry, and reads the band, the card and the panel with `measure` |
| `header-archived/{dark,light}` | the open conversation archived from its own menu, no dialog open | archiving the OPEN conversation keeps the pane open and adds the header's `Archived` pill with its restore control beside it | the scene archives from the menu, asserts the pill is in the viewport AND `activeSessionId` is still that conversation, and waits out the offer's 15s ceiling so nothing transient is over the pill's ink |
| `undo-offer/{dark,light}` | a row's archive just succeeded | a successful archive offers **Undo** on the surface that performed it, as a **panel register at the panel's root** rather than a toast: the box is inside the panel (measured x 228..492 of the panel's 220..500) and disjoint from the composer's Send control (x 1307..1339), and it is still on screen after the catalogue's answers land | a real click on the row's control, then a plain `capture` (this is the frame that is OF the offer, so it carries its own `stable` + `offerOnScreen` checks alongside the `toastFree` ones — and the scene asserts the register's box is inside the panel and does not intersect Send) |
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
LEADING status slot, and the gaps)`. The 28 per control is the `size-6` box plus
the row's `gap-1`; the fixed 28 is 8 (the row's `px-1`) + 16 (`ChatSessionStatus`'s
`size-4`) + 4 (the gap between them). **LEADING, not trailing** (design round 2,
D14): this paragraph used to call it the row's trailing status slot, which is what
four lanes then quoted as the reason a row with an unread mark has a narrower
title. It does not - the mark is drawn INSIDE that leading slot - and the formula
was right about the number while naming the wrong edge.
The pair's own price is visible in the frame: **two slots cost 40 px of title
against the single shared control at the same panel width** (180 against 140 is
the pair at 280; 168 against 140 is the shared control against the pair at 240).

**The row that carries an unread mark has exactly the same title width as one that
does not** — 180 px and 168 px, both measured above. That is worth stating because
the opposite was assumed when this set was planned: the unread mark is drawn in
the row's reserved STATUS slot, which is laid out before the title and does not
take width from it. What costs title width is a control slot, and only that. The
frames carry the mark anyway (`row-controls-{pair,shared}` hover the unread row),
so the claim and the picture are of the same row.

**The set was re-shot at the fold, and the numbers above are this set's.** Every
frame here was re-shot with the same three commands after `origin/main` was folded
in (`13b5e1b41`, 0.30.3, #408's sidebar split), on fresh stubs, one launch per
palette, `ALL CHECKS PASSED` on all three; 24 of the 34 frames changed, because the
fold rewrote the panel they are pictures of. Two consequences for the claims on this
page: the hover ground's endpoints were re-read on THIS set (456..983 device, below),
and the row-internal geometry the 21.5px marker figure derives from is unchanged on
it — the driver's own report on this run is `status row 180px, unread row 180px; pin
24x24, archive 24x24` at 280 and `168px … shared 24x24` at 240, identical to the
numbers the figure was taken from, which is why the figure itself was not re-derived
pixel by pixel.

**The archived marker costs a ragged title column of 21.5px (design round 1 D4;
re-derived on THIS set by design round 3).** In `search-include-archived/{dark,light}`
the archived row's title starts at **CSS 274.5** and its live sibling's at **253.0**
— 21.5px, the marker being a 13 × 12 CSS box glyph at `--lo-ink-dim` (5.70:1 dark /
5.74:1 light on the panel). The number is the design round's measurement on the
frames this set ships, which is the provenance the earlier paragraph said it owed:
the marker's own box (`ml-1 size-3.5`) did not change, so the offset is the same,
and it is now read off these artefacts rather than carried from the earlier set.

**The row's hover ground reaches the row box's right edge (design round 3, D18;
endpoints corrected in round 4, D23).**
On `row-controls-pair/localOperatorDark.png` the hovered row's ground runs from
device x **456 to 983** at the row's own centre line (CSS 228..491.5), passing under
both control slots, with the panel ground `srgb(42,39,34)` resuming at 984. (An
earlier line said 470..982 — 470 is CSS 235, i.e. 7px inside the box, and the run's
own endpoints are 456 and 983.) Before this
round's fix the same frame measured CSS 228..436 — the conversation button's own
ground, 56px short — because the class stating it on the box was inert. The scene
now asserts the box's own computed background, with the pointer on the row and
again with it on a control, so a class that never matches cannot pass again:

```
magick docs/evidence/session-archive/row-controls-pair/localOperatorDark.png \
  -format "%[pixel:p{970,1680}]" info:      # -> srgb(48,45,42), the row ground
magick docs/evidence/session-archive/row-controls-pair/localOperatorDark.png \
  -format "%[pixel:p{990,1680}]" info:      # -> srgb(42,39,34), past the box
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
