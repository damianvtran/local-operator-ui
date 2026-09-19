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
for f in at-rest row-hover row-hover-body search-off search-on delete-dialog \
         delete-refused archive-refused header-archived undo-offer deleted-open; do
  d=docs/evidence/session-archive/$f
  mkdir -p "$d"
  cp /tmp/archive-frames-dark/$(echo $f | sed 's/search-off/search-live-only/;s/search-on/search-include-archived/').png \
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
`ALL CHECKS PASSED` with eleven frames each; the withdrawn run reports the same
with two. What the assertions cover, in the run's own words: the catalogue
answered, the archived conversation matches nothing before the control is on and a
row after it, the delete confirmation is open on the conversation the menu was
opened on, **Cancel hands the keyboard back to the header trigger**, the refused
delete stays in the dialog **with the keyboard on Cancel**, a refused archive is
reported beside the list, archiving the OPEN conversation adds the pill and leaves
the pane open, **the archive offer outlives the catalogue answers** (it was still
on screen 10s after the press, where the rule this round replaced retired it in
0.4-1.6s), **the keyboard lands on a row after a row press** (not on `<body>`),
**deleting the open conversation lands on the existing missing-session notice**,
and the offer frame is a still picture of a toast that was really on screen. Every
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
keys) and nothing else. The sentences the two refusal frames show are the
**route's own wording**, quoted in the stub from what the UX round reported
reading against the real daemon; what the client adds around them (the remedy
line, the register, the Retry) is what those frames are of.

| Frame | State | The claim it proves | How |
| --- | --- | --- | --- |
| `at-rest/{dark,light}` | the panel with the capability present, nothing archived on screen | **nothing is DRAWN at rest**: no marker, no search-block chrome — while the 24px slot is still RESERVED (see the numbers below) | `--theme <palette>`, no scene step beyond `navigate("/chat")` |
| `row-hover/{dark,light}` | the pointer parked on the archive control of a live row | the affordance appears on the pointer's row and nowhere else, without the row moving (`group-hover`, opacity only) | the scene moves the **real** pointer (`Input.dispatchMouseEvent` at the control's box, from the `measure` verb) before the shutter |
| `row-hover-body/{dark,light}` | the same row, pointer on its TITLE | the pair with `row-hover` settles design round 1 D5: the row's own highlight is a property of the ROW, not of the control's 24px box | the same, with the pointer 60px right of the row's left edge |
| `search-live-only/{dark,light}` | `notes` typed in the search box, `Include archived` off | the search block gains its one control only while a query exists; the archived conversation is NOT in the answer, and `[data-session-archived]` matches nothing | the scene types into the field through the input pipeline, then asserts the absence |
| `search-include-archived/{dark,light}` | the same query, the control ON | the archived conversation is reachable from the search, carries the muted leading marker, and the sidebar has gained no section to hold it | a real click on the checkbox, then an assertion that `[data-session-archived]` now matches and is in the viewport |
| `delete-dialog/{dark,light}` | the header's conversation menu → `Delete conversation…` | the one permanent delete asks with the danger role, names the conversation, says the transcript cannot be undone, and does nothing on its own | two real clicks (the trigger, then the item), then the dialog's box is measured |
| `delete-refused/{dark,light}` | the same dialog, `Delete` pressed on a conversation a live session claims | the refusal stays **in the dialog that asked**, the route's sentence is quoted and the window's own remedy follows it, and the keyboard is back on **Cancel** | the stub answers 409 for one conversation `live_claim: true`; the scene presses Confirm and then measures `[data-cancel-action]` for `focused` |
| `archive-refused/{dark,light}` | the archive control pressed on the same claimed conversation | a refused archive reports in the panel's own register beside the list, with the **Retry** that re-sends the desired state | the scene clicks the row's control and asserts `[data-session-archive-failure]` is in the viewport |
| `header-archived/{dark,light}` | the open conversation archived from its own menu, no dialog open | archiving the OPEN conversation keeps the pane open and adds the header's `Archived` pill with its restore control beside it | the scene archives from the menu, asserts the pill is in the viewport AND `activeSessionId` is still that conversation, and waits out the offer's 15s ceiling so nothing transient is over the pill's ink |
| `undo-offer/{dark,light}` | a row's archive just succeeded | a successful archive offers **Undo** on the surface that performed it (design round 1 D7 + UX U2), and the offer is still on screen after the catalogue's answers land | a real click on the row's control, then a plain `capture` (this is the one frame that is OF a toast, so it carries its own `stable` + `toastOnScreen` checks instead of the `toastFree` ones) |
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

**Two slots cost 28px each, and the frames carry the one this branch ships.**
The archive control measures 24px (`size-6`) and the wrapper's `gap-1` adds 4px,
so 28px of the title's line box is reserved on every row, at rest, whether or not
the pointer is near it. The arithmetic and the three panel widths:

| panel | no slot | one slot (this branch) | two slots (pin + archive) |
| --- | --- | --- | --- |
| 240 (clamp min) | 200 px | 172 px | **144 px ≈ 20 characters** |
| **280 (default, = these frames)** | 240 px | **212 px** | 184 px ≈ 26 characters |
| 360 (clamp max) | 320 px | 292 px | 264 px |

The 280 column is the measured one: the design round's own rigs measured the
title line box at **212 px** on these frames and at **240 px** with the capability
withdrawn, and the arithmetic that reproduces both is `panel − 68` with one slot
and `panel − 96` with two. The 240 and 360 columns are that arithmetic applied to
the clamp's other stops, which is why the design round's ruling is **two sibling
slots at ≥ 280, one shared control below** — at the clamp minimum the pair leaves
a title that identifies nothing, on every row, for a reader who may never pin or
archive anything.

**The archived marker costs a ragged title column: 21.5px on these frames.**
Measured on `search-include-archived/localOperatorDark.png`, where an archived row
and a live row sit one above the other:

```
magick docs/evidence/session-archive/search-include-archived/localOperatorDark.png \
  -crop 360x30+440+1609 +repage txt:-   # archived row:  status 232.5-247, marker 256.5-269, title from 274.5
magick docs/evidence/session-archive/search-include-archived/localOperatorDark.png \
  -crop 360x27+440+1673 +repage txt:-   # live sibling:  status 232.5-247, title from 253.0
```
(device x ÷ 2 = CSS px). So the archived row's title starts 21.5px further right
than its live sibling's, and the design round measured the same effect as 14px on
its own longer title — the gap follows the first glyph's shape, which is why both
numbers are quoted with the title they were taken on. The two candidate fixes and
their prices are recorded in `docs/design/session-archive-delete.md`.

**The withdrawn pair differs in exactly two count badges, and nowhere else.**
`magick compare -metric AE` on the two `at-rest` frames reports **310 device
pixels** above a threshold of 8/channel, in exactly two clusters:

```
magick docs/evidence/session-archive/at-rest/localOperatorDark.png \
       docs/evidence/session-archive/capability-withdrawn/localOperatorDark.png \
  -compose difference -composite -threshold 8 \
  -define connected-components:verbose=true -connected-components 8 null:
#   13x19+962+1375   (css x 481..487.5, y 687.5..697)   "All chats      3 -> 4"
#   13x19+962+1683   (css x 481..487.5, y 841.5..851)   "Previous chats 2 -> 3"
```

Both are the counts, and both were checked by cropping the badges out of the two
frames and reading them. With those two badges masked, the remaining **4.79
million pixels are identical** — not "a band around a live row", the whole frame:

```
for f in docs/evidence/session-archive/at-rest/localOperatorDark.png \
         docs/evidence/session-archive/capability-withdrawn/localOperatorDark.png; do
  magick "$f" -fill black -draw "rectangle 955,1368 982,1400" \
                     -draw "rectangle 955,1676 982,1708" "/tmp/masked-$(basename $(dirname $f)).png"
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
