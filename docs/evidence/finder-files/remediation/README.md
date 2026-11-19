# Finder Files — unified round-1 remediation evidence

## Scope / compiled identity

Base: `dd4add130ac7b2d5469f983e3db5ec3f997a6ee5`. All code/QA/design/UX findings
were batched into one remediation commit. PR1054 stays `f084a2ca7`.

Before uses the cached compiled `7a8e27a26` production source (identical to dd4:
its successors changed evidence/fold only), copied without rebuilding it. After
uses the final changed source. SHA256 over sorted changed source paths plus their
bytes: `2b441b4ecde0c4d9f288d8978a1364f3ad5d0940cccdbd3a3514b109606ca61e`.

**Actual build count: two**, not one. The first frozen build passed (15.39s), but
LOOKING at its true340 overlay exposed a clipped long placeholder. The only
production delta after that was the short localised visible placeholder/key;
long accessible label is retained. Reconstructing those three files' previous
bytes reproduced the first source fingerprint exactly
(`a2408dd9f1e82952abfd7caca3ba8ce06c9a651401699cfe1a09827810d97522`). Final
build passed in12.61s; every committed `final-*` frame was re-captured from it.
No full local suite. No model fallback (anthropic/claude-sonnet-5-5).

## Real environment / limits

Owned real backend #2393 `30815ed17` with the original5,002-row synthetic family;
`features.session_files:1`. Isolated HOME/config and bearer, no live sessions or
provider generation. The gateway supplies explicit loading/503 stimuli only;
other requests reach the real backend. Native app is headless, visible:false,
focused:false; telemetry/notifications disabled, CMUX stripped, mock keychain.
All app launches were serial and reaped by the shipped driver. Owned daemon and
gateway process tree (4 processes) was terminated and waited: remaining0.

Width is measured, not inferred from a requested window. `canvasDockWidth` and
`CANVAS_PANE_MAX_PX` in `chat-sidebar-layout.ts` capped the real dock at 560 on
the tree this matrix measured (the cap is now the slot's one `RIGHT_SLOT_MAX_PX`).
-1184×800 window → **400px dock**.
-920×800 window → **340px overlay**.
-1380×900 window → **560px dock**.
-960×800 window → **380px overlay**, NOT960px pane.
An initial644 request was clamped to800 and gave220px; those mislabeled trial
frames are **not committed**. No global layout was widened or geometry faked.

## Actual before / after results (real CDP input)

Each directory has screenshots and `report-<label>.json` with boxes, focus and
successive pointer-sort samples.166 supplementary frames, light+dark. They are
filename-labelled app evidence, not story-sweep passes; the manifest counts them
honestly as unjudged by that sweep naming gate.

| Surface | Before | Final after |
|---|---|---|
| Pointer-engaged Sort | dark400/560/380: mounted rows became0, false empty; light selected the already-applied Size and does not reproduce that reset |400: min16dark/14light;340:18/18;560:26/24;380:16/16; never0/false empty in ten250ms samples |
| Nonempty-search Escape | dock closed, both themes/all widths | query cleared, dock retained, both themes/all widths |
| Collapsed Highlights + narrowing | count matched but0 mounted rows |1 matching row, forced open |
| Sticky scrolled header | header8px below scroller | **0px**, all measured widths/themes |
| Head controls | search32 vs Sort/Filter28; clipped text | search/Sort/Filter32; visible `Search files` fits actual340 |
| Menu Escape + ArrowDown | focus restored to hidden ellipsis | visible roving row id restored; next arrow operates |
| Video band | inspected in before control | real narrowed video-band frames, both themes/widths |
| Loading/error total | invented0 | unknown count omitted; error appears once with Retry, no empty-creation detail |
| Child artifact + materialise | initial report retains prior proof | final child image decoded80×120; Copy file path used backend row handle despite canonical digest tab id;268B, byte-identical store copy, different inode |

Before-light Sort needed keyboard activation after an outside press dismissed a
prior portal. `sortActivation` records that actual fallback; menu-item selection
and parked pointer still use real CDP mouse input. Final controls used pointer
activation. The first sticky trial had collapsed Working files, so the rig was
corrected to expand it before scrolling; only corrected reports are committed.

## Commands / automated proof

`node scripts/run-desktop-tests.mjs scripts/session-files-hook.test.mjs scripts/finder-files.test.mjs`
→14/14 pass, including **real hook**9 advancing-building revisions (10requests,
ready), retained3→4 refresh with no0 frame, presentation-only rerender no extra
request, repeated-cursor restart recovery and capable draft0requests/ready.
Pure layout controls assert collapsed-match force-open and Page boundaries.

Affected neighbors (mentioned-files, image-actions, right-slot-width and i18n
keys/parity) were run, not the full suite. The first pass caught3 migration
expectations missing the new `closedSections`; only those expected persisted
shapes were updated, then the full25-case preference file passed. Both serial
typechecks and changed-source lint passed; final placeholder key types passed.

Reproduce captures using `capture-finder.mjs --delta-controls`, existing
`renderer-driver.mjs`, owned seeded backend and the widths above. Loading uses
`--probe-loading`; final child uses `--child-flow --materialise-flow`. All real
commands/outputs are retained in author scratch session88686b805c6b (`b-r2-*`,
`finder-rig/r2-*`). No native OS clipboard/dialog/open-app assertion: clipboard
was intercepted and materialised side effects checked on disk. SVG fallback is
implemented via image-document rasterisation but was not separately rendered in
this fixture; raster/child thumbnails and their bounded mounted population were
observed. Initial broad5,002-row scale proof is retained, not rerun wholesale.

## Independent round2

Code/QA/design/UX must review the remediation delta on its posted head. These are
author observations, not substituted independent sign-off. Deferred judgments:
posterless video placeholder height (poster service out of scope), and keeping
Sort/Filter enabled to let users prepare persisted view preferences while empty.
No follow-up issue created. Reset filter changes types only; Clear search and
filter changes both, so their distinct names intentionally remain.
