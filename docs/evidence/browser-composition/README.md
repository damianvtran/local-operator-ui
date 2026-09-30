# The browser surfaces in composition

**EVERY FRAME HERE IS COMMITTED AS `<name>/<theme>.webp`** (2026-09-25). The evidence gate
derives a frame's expected ground from its FILENAME, so the name has to be the palette the
frame was painted under; the six frames of the first pass were committed under the state
they show instead, and were renamed in place - the bytes are untouched. Frames added since
are named in their own sections below.

Eleven frames from `scripts/browser-chrome-proof.mjs`, which is the only path in this
repository that photographs the browser feature the way a user meets it: the real
chrome over a real page, in one frame, at the window size the app actually runs.

They are here because three of the operator's four asks are COMPOSITION asks, and a
Storybook story cannot answer any of them (a fourth and a fifth arrive in the
2026-09-28 pass, in their own section below):

- "a better approval surface (a list openable and closable from an approvals section
  inside the browser page)" is a claim about a panel that narrows a live page. Every
  committed `browser-approvals-dock/*` frame is a standalone story with a decorator,
  so none of them shows the page beside the list or the rect that moved.
- "a tab strip that reads like real browser tabs" is a claim about a strip sitting
  above a page, continuous with it. The story frames show the strip alone.
- the badge is painted at the URL bar's inner corner, and the URL bar's box is the
  window's right edge in the running app. The story decorator pads the page, which is
  exactly the property that hid the round-1 defect (D3) where the badge's right arc
  fell outside the window; the in-situ frames show it where it is drawn.

| frame | what it is for |
|---|---|
| `03-surface-populated/localOperatorDark.webp` | the strip over the USER's own tab, whose page has no handle to composite — chrome and the content rectangle only. The "over a real page" claim is carried by `12-approvals-queue/` and `18-approvals-dock/`, and the "user tab beside an agent tab" claim by `12-approvals-queue/`, `17-tab-actions-popout/` and `18-approvals-dock/`; this frame is here for the strip's own grammar |
| `12-approvals-queue/localOperatorDark.webp` | the band with a numbered queue: the count, the chips, the selected request's card |
| `12-restored-after-restart/localOperatorDark.webp` | the relaunch after the quit (2026-09-28 pass; RE-SHOT IN THE 2026-09-29 PASS): the healthy tab back with its `Restored` marker, the tab that was showing a load failure NOT restored, and — new on this head — the non-active agent row SKIPPED rather than brought back as a user tab. The re-shoot is owed because the state the previous pixels showed (the agent's tab back among the restored) no longer exists on this tree; the frame's own scenario is where the large run meets the skip, and this run records it: `healthy at quit 2 (of which 1 agent-owned and not active), restorable 1, restored 1`. The `Agent`-marked `Proof page two` row beside it is the run's own re-open after the restart (the designed recovery), not a restored row |
| `17-tab-actions-popout/localOperatorDark.webp` | REPLACES `17-tab-actions-in-band/` (2026-09-28 pass): the tab actions as a portaled popout — free of the strip's box (`menuBox.bottom 225` against `stripBottom 69`), over the suppressed content area with the paused note behind it, the badge in situ (D3, D4) and the strip's height and the page's rectangle unchanged while it is open |
| `17b-actions-page-restored/localOperatorDark.webp` | the dismissal (2026-09-28 pass): after Escape the menu is gone, no suppression is left and the paused note has yielded; the user tab's page has no handle to composite, so the content area is chrome-only, as in `03` |
| `18-approvals-dock/localOperatorDark.webp` | the dock open, the page still visible and narrowed, no suppression (D2, D9) |
| `19-strip-marked-tab-at-rest/localOperatorDark.webp` | the strip at rest with a user and an agent-marked row, **and on this head the strip IS in the picture**: re-taken 2026-09-17 on the harness that calls `exposeStrip()` before every frame, the frame carries the strip's own row with the `Agent` chip legible on `Proof page two` beside the group label `proof-open 1` and the unmarked row `Proof page one` (see the D9 note below for what moved and what the DOM reading says). The no-daemon banner is still painted across the top of the window — the harness has no daemon by design — but the strip now sits BELOW it rather than under it, which is the difference between a frame that shows the subject and one that only shows where it would have been |
| `20-strip-failed-and-agent-markers/localOperatorDark.webp` | RE-SHOT IN ROUND 2 (2026-09-28): the strip at rest carrying the pair at once — the `Agent` chip and the `Failed` pill side by side on `127.0.0.1:52706/broken` (the run's own port, as the frame carries it) — with the URL bar under it. The pixels this replaces came from the 2026-09-17 run and showed the band in its deleted in-band form; the re-shoot keeps the frame's headline (the marker pair, which no diff line alters) and drops the superseded state. The discharge is recorded in the note at the end of this file |
| `21-dead-tabs-in-strip/localOperatorDark.webp` | the mess, made deliberately (2026-09-28 pass): two tabs driven at the dead port, both marked `Failed` in the strip (`tabIds [13,14]`), the active one's failure panel behind them |
| `22-close-failed-tabs/localOperatorDark.webp` | the counted cleanup AND THE D2 CLEARANCE PHOTOGRAPH (round 2, 2026-09-28): `Close 2 failed tabs` — the count IS the disclosure — offered from the dead tab itself (the strip's right end), with the paused note behind the open menu. Measured in the very state this frame photographs: the panel's right edge at CSS 1273 against the Approvals pill's leading content at 1275.3 — the pill's icon and label stay clear and it no longer reads `pprovals`; the shift's own cap is the anchor's 28px (QA round 2, Q2-2), so the panel's edge sits on the pill's transparent padding |
| `23-dead-tabs-cleared/localOperatorDark.webp` | the strip after ONE press (2026-09-28 pass): the failed set is gone (`failed tabs after the press: []`) |
| `24-restore-boundary-before/localOperatorDark.webp` | the BASE build on the seeded fixture (2026-09-29 pass): the tab the killed session left behind is back as an ordinary `Restored` user tab (`…/linger`, beside the user's own `…/index.html`), and the budget's queued stragglers are blank — `14` of the `18` stalled rows with `url: ""` — with no `Failed` chip anywhere (`failed 0`). The accumulation, photographed on the before side |
| `25-restore-boundary-after/localOperatorDark.webp` | the fix, same fixture (2026-09-29 pass; RE-SHOT in round 1): the agent's row is skipped and pruned (the relaunch's own log counts it: `1 recorded tab(s) were opened by an agent…; not restored`), every stalled row's load is started (none `about:blank`), and the `4` that timed out carry `Failed` chips (`stall-0`…`stall-3`) while the drained `14` show as loading. The round-1 re-shoot carries the two fixes on top: the `Failed` marks sit beside a STATIC glyph (D1), and this run's own log proves the drained stragglers are not left behind — `every drained straggler reaches a terminal state within one launch: failed 18 of 18` |
| `26-restore-boundary-settled/localOperatorDark.webp` | the SAME run, settled (round-1 F1/D4/U1): the drain's bounded wait has marked every straggler — `failed 18 of 18 stalled rows` — and the counted close, opened on the last row, reads `Close 18 failed tabs`: one launch converges to one honest, one-press-clearable set instead of a spinner tail |

Source, exactly:

```
pnpm build
env -u NO_COLOR LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  node scripts/browser-chrome-proof.mjs --keep
```

The harness puts each frame at the path it prints, inside its own scratch directory, as
PNG; these four are that run's output, encoded to `.webp` at quality 90 to match the
format the rest of this directory uses, and committed because the scratch directory is
temporary. A full `capture-evidence.mjs` sweep does not produce them and does not
overwrite them: they are declared as a supplementary set in `manifest.json`, which is
what keeps the sweep's own frame count honest.

## What these frames are photographs of, and the one bounded delta left

**THREE OF THE SIX WERE RE-TAKEN AGAIN ON 2026-09-17, and the set now mixes two
runs.** `17-tab-actions-in-band/localOperatorDark.webp`, `19-strip-marked-tab-at-rest/localOperatorDark.webp` and
`20-strip-failed-and-agent-markers/localOperatorDark.webp` come from the run below; `03-surface-populated/localOperatorDark.webp`,
`12-approvals-queue/localOperatorDark.webp` and `18-approvals-dock/localOperatorDark.webp` are unchanged from `25ad52c33` (this
branch's spelling of the round that re-shaped the tab strip's overlaid chrome
cluster, the band's busy cue, the dock's notice sentence and waiting row, and the URL
bar's label reserve), which is what `manifest.json`'s `partialCapture.roundTwoRecapture`
records. The split is not arbitrary: review round 2's remediation moved the band's own
rows (D11: the four counted closes take `variant="danger"` and `Watch` returns to
`ghost`; D12: a hairline opens the destructive block) and the pinned control's channel
words (D10), and `17-tab-actions-in-band/` is the in-situ frame of that band. `19-strip-marked-tab-at-rest/` and `20-strip-failed-and-agent-markers/` were owed for a
different reason, D9, which is answered in its own section below. Nothing moved in the
other three, and rather than re-shoot them for tidiness this file says which run each
came from.

**THE IN-SITU CLAIM IS THE REASON `17-tab-actions-in-band/` IS HERE AT ALL.** The story frames under
`browser-tab-strip/` show the band alone, on a decorator that pads the page; in the
running app the badge is drawn at the window's right edge, next to the tab actions row,
and the page sits under the band. `17-tab-actions-in-band/` is the frame that shows all three at once — the
expanded band, the URL bar with its `Approvals` badge at the window edge, and the
consent card in the page area — on the D7 band (one item per row, `Copy URL` last behind
the rule) that the remediation then re-coloured.

**THE RE-TAKE'S OWN SOURCE, EXACTLY.** `pnpm build` (or the app already built), then,
at the commit that ships these frames:

```
env -u CMUX_WORKSPACE_ID -u CMUX_SESSION_ID -u CMUX_TERM -u CMUX_SOCKET -u LOP_SESSION_ID \
  node scripts/browser-chrome-proof.mjs --keep
```

The `CMUX_*`/`LOP_*` unsets are the machine's own rule for any agent-driven run (an
inherited `CMUX_WORKSPACE_ID` once let a headless test rename the operator's real cmux
workspaces), and the harness deletes those keys from the app's environment itself — the
`env -u` is what makes that true of the HARNESS process too. An earlier revision of this
file also unset `NO_COLOR` and set `TERM`; this run left both as the shell had them
(`NO_COLOR=1`, `TERM=dumb`), and that is measured rather than assumed: the same run's
`browser-tab-strip/overflow-list` set came back byte-identical to frames taken under the
older command in 11 of its 12 themes, so neither variable reaches the renderer. The run
reported `83 PASS / 0 FAIL / ALL CHECKS PASSED`.

Where each frame comes from, stated rather than implied, because three of the names are
not the run's own: `03-surface-populated/localOperatorDark.webp`, `12-approvals-queue/localOperatorDark.webp` and `18-approvals-dock/localOperatorDark.webp`
are the run's frames of those names in its own scratch directory, and
`17-tab-actions-in-band/localOperatorDark.webp` was too before the 2026-09-28 pass replaced
it with `17-tab-actions-popout/localOperatorDark.webp` (the run's own frame of that name);
`19-strip-marked-tab-at-rest/localOperatorDark.webp` is the run's
`09-strip-user-and-agent` (the strip at rest with one user and one agent-marked tab) and
`20-strip-failed-and-agent-markers/localOperatorDark.webp` is its `16-surface-strip-failed-agent-tab` (the
`Failed` and `Agent` markers painted together), each encoded to `.webp` at quality 90. The
2026-09-28 pass's five new names — `12-restored-after-restart/`, `17b-actions-page-restored/`,
`21-dead-tabs-in-strip/`, `22-close-failed-tabs/`, `23-dead-tabs-cleared/` — are the run's own
frames of those names, encoded the same way.

## The two frames named for the strip's markers now contain the strip (review round 2, D9, DISCHARGED 2026-09-17)

**MEASURED, IN THE COMMITTED PIXELS, ON BOTH SIDES OF THE FIX.** The frames these two
names carried before this re-take were taken on a tree where the strip's own row sat at
CSS 0-36 and the no-daemon banner ran to CSS 68, so the banner lay OVER the strip: the
frame's top 133 device px (≈67 CSS at dpr 2) was the banner's fill ending in a rule at
device y 134, and against the chips' own `#67C674` a 5% fuzz found 11,250 px in the frame
that DOES show them (`browser-pane-live/browser-pane-strip-four.png`) and 0 in `19-strip-marked-tab-at-rest/` and 5
in `20-strip-failed-and-agent-markers/`. Those two files are replaced, not re-captioned.

What the re-take produced, from the run's own assertions rather than from my eye: the
harness records the geometry at the strip's centre and CHECKS it before it photographs —
`banner {"top":0,"height":121} over 2 notice(s) [{"text":"Not connected to a Local
Operator server. If one","top":0,"height":68},{"text":"The Local Operator server is not
answering. Prov","top":68,"height":53}], tab strip {"top":121,"height":37}, overlaps
false`, and `elementFromPoint(800, 140) -> flex min-w-0 grow items-stretch` with `hidden
over it: []`. So the strip is not merely present in the layout, it is the topmost element
at its own centre, and nothing had to be hidden to make it so: the app's own chrome
changes moved the strip's row from CSS 0 to CSS 121, below the whole 121 px band.
**THE BANNER HALF OF THAT READING IS THE WHOLE BAND, NOT THE FIRST NOTICE** (review round
2, D15): the reading used to print `{"top":0,"height":68}`, which is the CONNECTIVITY
band alone on a window that carries two stacked notices (68 + 53 = 121, the sum `app.tsx`
itself records), so read on its own it showed ~53 px of headroom where the strip's top
border in fact begins 1 px below the second band. The reader is the harness's own banner
finder, and it now collects EVERY matching band and reports their union, with each notice
named beside it, so a future regression at the strip's top border cannot pass it. Both
frames carry the markers — `Agent` on `Proof page two` in `19-strip-marked-tab-at-rest/`, `Agent` and `Failed`
together on `127.0.0.1:52706/broken` in `20-strip-failed-and-agent-markers/` — which is the claim these two names exist to
carry.

**WHY THESE FRAMES CARRY A BANNER, AND WHY THAT IS ABOUT THE MOMENT IN THE RUN RATHER THAN
ABOUT THE HARNESS** (review round 2, D14). Both frames carry the app's two stacked notices
at the top because the harness boots the app against no daemon at all (its own "scratch
backend port is dead" check is what makes the run isolated) and the app's own check
FAILS A MOMENT AFTER BOOT rather than before it — so a frame taken earlier in the same run
is banner-free, and this set contains one: `03-surface-populated/localOperatorDark.webp`'s top-left is the
app's own ground `(14,12,8)`, uniform through device y 248 (CSS 124), with the strip's
first rule at device y 8. The neighbouring
`browser-conversation-tabs/live/19-strip-pooled-20-over-6.png` measures `(15,12,8)` for
the same reason. Both readings are mine, taken on this head with `sharp`. An earlier
revision of this paragraph said "no frame it takes is banner-free", which those three
frames refute; the banner is a property of WHEN the frame was taken, not of the harness,
and a banner-free re-take of `19-strip-marked-tab-at-rest/`/`20-strip-failed-and-agent-markers/` is available for anyone who needs one. What D9 was
about — two committed frames named for a strip they did not contain — is answered by the
strip being in them.

What it took: the harness that carries this file's frames is
`scripts/browser-chrome-proof.mjs`, and the defect that stopped it completing a run at
all — a synchronous `osascript` frontmost sampler starving the event loop, so the probe
read the host's own record outside its own deadline and died with `no LIVE host
answered /health` while the host was up — is documented in its `frontmost()` docblock
and fixed in the same commit that ships these frames. The re-take is the command above,
with the `17-tab-actions-in-band/localOperatorDark.webp`, `09-strip-user-and-agent` and
`16-surface-strip-failed-agent-tab` scratch PNGs encoded to `.webp` at quality 90.

## The 2026-09-28 pass: the dead-tab lifecycle, and the popout tab menu

TWO MORE OPERATOR REPORTS, and both are composition claims:

- a strip full of `[Restored] [Failed]` tabs pointed at dead loopback URLs, with a "15"
  overflow count. The accumulation turned out to be mechanical rather than a usage
  problem: a tab whose page refused to load kept its session-store row like any other
  tab, so every launch re-created it — where it failed again — and re-persisted it at
  the next quit. Nothing in the product ever dropped a dead tab, and no bulk control
  targeted the failed set. The fix marks such a row when it is captured and does not
  restore it on the next launch, and a counted `Close N failed tabs` clears a pile in
  one press.
- the in-band actions row ("shifting down like this"): it grew the strip by up to 214px
  at its designed worst case and moved the page and the URL bar down with it. The menu
  is a registered popout now: it floats free of the strip's box, the native view hides
  while it is open, and the paused note shows behind it.

WHAT MOVED: `17-tab-actions-in-band/` is REPLACED by `17-tab-actions-popout/` — the
state the old frame photographed no longer exists, and the name moved with it (same
`<name>/<theme>.webp` rule, same encoder). Five names are new:
`12-restored-after-restart/`, `17b-actions-page-restored/`, `21-dead-tabs-in-strip/`,
`22-close-failed-tabs/` and `23-dead-tabs-cleared/`. WHAT DID NOT MOVE:
`03-surface-populated/`, `12-approvals-queue/`, `18-approvals-dock/`,
`19-strip-marked-tab-at-rest/` are not re-taken and keep the pixels of their own runs.
`20-strip-failed-and-agent-markers/` was kept at the 2026-09-28 pass — its band was the
IN-BAND row that pass deleted, so it was NAMED AS OWED rather than left to read as current
(remediation round 1, reviewer m-4 / designer D1) — and the debt is PAID in round 2: the
frame is re-shot from the round-2 harness run and now carries the strip at rest with the
`Agent`/`Failed` pair and no band at all. The discharge, with the run's numbers, is at the
end of this section.

WHAT EACH NEW FRAME PROVES, from the run's own assertions and transcript (this run
reported `92 PASS / 0 FAIL / ALL CHECKS PASSED`):

| frame | what it proves |
|---|---|
| `21-dead-tabs-in-strip/` | the mess, made deliberately: two tabs driven at the dead port, both marked `Failed` in the strip (`tabIds [13,14]`), the active one's failure panel behind them |
| `22-close-failed-tabs/` | the counted cleanup — `Close 2 failed tabs` — offered from the dead tab itself, the paused note behind the open menu |
| `23-dead-tabs-cleared/` | the strip after ONE press: `failed tabs after the press: []` |
| `12-restored-after-restart/` | the relaunch: `healthy at quit 2, restored 2`, and the tab that was dead at the quit NOT restored, with the app's own log line naming the refusal — `[browser] 1 recorded tab(s) were showing a load failure when the session ended; not restored` |
| `17-tab-actions-popout/` | the popout: portaled outside the strip, `data-suppressed-by="browser-tab-actions::…"`, the paused note behind it, and both the strip's height and the page's rectangle unchanged while it is open (`strip height 37 -> 37; content rect {"x":260,"y":348,"width":1120,"height":552} -> the same`). The menu it measures is 152px tall, its top at 73 and its bottom at 225 against a strip bottom of 69: it leaves the band's box. It does NOT reach the content element's top (348) in this state, and the harness records that rather than asserting it — this section runs with a consent band between the strip and the content, and the popout's claims are the ones the check asserts: free of the strip, suppression registered, the page's rect untouched |
| `17b-actions-page-restored/` | the dismissal: after Escape the menu is gone, no suppression is left, and the paused note has yielded to the page |

THE OPEN AND CLOSE TRANSITIONS WERE SAMPLED PER FRAME (the probe the policy file calls
P11): twelve samples across the open, every one with the menu up AND the registration in
place, and twelve across the close, every one with both cleared — so no sampled frame
shows the menu up without the suppression behind it, which is the flicker this probe
exists to catch.

THE WINDOW HEIGHT IS NOT THE OLD FRAMES' (measured): this run's app reports a 1380x900
viewport, so its frames are 2760x1800 device px, where the 2026-09-15/17 frames in the
set are 2760x1736 (a 1380x868 viewport). Nothing was cropped to make them match; the
reading is stated instead, and a re-take of the older five at the taller viewport is
available to anyone who wants one height for the whole set.

## Remediation round 1 (2026-09-28): the in-band band one frame still shows, named rather than left to read as current

Review round 1 on this pass (agent review `m-4`, design `D1`) found that the frames which still
show the tab-actions band in its in-band form were neither re-shot nor named. Two of the three
are re-shot in the remediation commit: `browser-tab-strip/actions-expanded` and
`actions-expanded-batch`, 12 themes each, at this head — so the popout has its light-theme and
inactive-tab (`Watch` row) coverage in the committed sweep, and no committed frame of that story
surface shows the deleted band.

The third is the one above: `20-strip-failed-and-agent-markers/localOperatorDark.webp` keeps the
pixels of its own run, and its band is the in-band row this pass deleted. Its re-shoot is a
**harness run** rather than a Storybook capture, so it is deferred under the fleet's load
directive and **named as owed** here rather than left to read as current: the next harness run
re-shoots it (and with it gains the popout's photograph over this surface). What the frame still
proves is its own headline — the `Agent`/`Failed` marker pair on one row — which no diff line in
this pass alters, and the frame's strip reads identically to `21`/`23`.

**DISCHARGED (round 2, 2026-09-28).** The owed items this section named are paid, from
ONE bounded harness run (`scripts/browser-chrome-proof.mjs --keep`) at the round-2 head:

- `20-strip-failed-and-agent-markers/` is re-encoded from the run's own
  `16-surface-strip-failed-agent-tab` — the strip at rest with the `Agent`/`Failed` pair
  on `127.0.0.1:52706/broken` and no band of any form. The deleted in-band row no longer
  appears anywhere in the set.
- `22-close-failed-tabs/` is re-encoded from the same run's frame of that name — the
  app-side D2 photograph, with the clearance MEASURED in the run itself rather than
  read off the picture: panel right 1273 against the pill's box left 1266.3 and its
  leading content 1275.3 (window 1380) — the content clear, no `pprovals`, and the
  panel's edge on the pill's transparent padding, which is as far as the shift goes
  (`limitShift()` caps it at the anchor's 28px — QA round 2, Q2-2).

Both frames ride the same run's numbers recorded in the manifest note
`browserTabCleanupRoundTwoPass`.

## The restore boundary (2026-09-29): the residue a killed session leaves, and the stragglers

THE THIRD REPORT ON THIS SURFACE, and the mechanical half of the second one. #624 (above)
stopped a tab that was ALREADY dead when the app quit from being restored. Two shapes of
dead tab survived it, and the third had never been in its scope:

- a tab an agent session left behind at the quit — nothing closes an agent's tab when its
  session goes away, because there is no session-death signal by design (`ownership.ts`:
  a guess that closes the wrong tab is worse than a leak the user can see) — came back as
  a USER tab at every launch, and the capture AFTER that restore rewrote its row as the
  user's, so each restart added one more unattributed chip (measured on the field's own
  file: `[('user',5),('agent',29-ish)]`, and `restoring 20 of 24` at a boot);
- a restore that never committed a page — a server that accepts and never answers —
  produced no `did-fail-load` (the 10 s per-tab timeout fires instead), so it was never
  marked, and its row came back at every launch to time out again;
- and when the restore budget expired mid-pass, every row still queued got NO load at all
  and sat `about:blank` until the next restart — the deployed logs' `14 tab(s) still
  loading` at expiry is up to 14 blank tabs from one launch.

WHAT MOVED IN THE PRODUCT (`local-operator-ui` PR #662): at the restore boundary,
`readSession` skips an agent-owned row that was not the active tab at the capture (the
one agent tab the user was plausibly on survives), and `captureTabs` writes a tab that was
under hand-over at the quit as the user's, so the skip cannot lose the user's own tab; a
hydration that failed without committing a page records a load failure (the Failed chip,
the counted close, `lastLoadFailed` on the next capture, and the ordinary clear wiring
keeps it self-healing); and the budget drain STARTS every still-queued tab's load. `MAX_
RESTORED_TABS` / the budget / the per-tab timeout / the concurrency are deliberately
untouched.

THE PAIR. Both frames are the run's own `restore-boundary` frame, from ONE scenario staged
against two builds — the base at `0ab50df2a8` and the fix — with the same command (see
below), which is the shape §19b's check already uses for its own before/after:

| frame | what it proves |
|---|---|
| `24-restore-boundary-before/` | the base build on the seeded fixture: the killed session's tab back as a user tab beside the user's own, the `18` stalled rows' queue `14`-deep and BLANK (`url: ""`), NO `Failed` chip anywhere, and the skipped-row and budget lines absent from the relaunch's log |
| `25-restore-boundary-after/` | the fix, same fixture: the agent row SKIPPED and PRUNED (`rows on disk now: 19`), the budget line `the 8000ms restore budget expired with 14 tab(s) still queued; they start loading in the background`, every stalled row's load started, and `failed 4` — the in-flight wave, `stall-0`…`stall-3` — with the drained `14` still loading. RE-SHOT in round 1: the same frame after the remediation, whose additions the run's own transcript carries — `every drained straggler reaches a terminal state within one launch: failed 18 of 18` and the drained mark on the same bounded wait the wave gets |
| `26-restore-boundary-settled/` | the SAME round-1 run, settled: the drain's bounded wait has marked every straggler (`failed 18 of 18`), and the last row's menu reads `Close 18 failed tabs` — the settled set is closed by ONE counted press |
| `12-restored-after-restart/` | RE-SHOT from the fix run: the set's own relaunch, where the skip now fires (`restored 1`), replacing pixels whose state no longer exists |

THE SCENARIO (§20 of the harness): an agent tab is opened through the app's own RPC and
left; the app quits and its row is asserted in the file; the file is then SEEDED with `18`
rows at a server that accepts and never answers (`stalledServer`), which is what the
operator's own file held; the relaunch is the fixture both frames photograph.

THE RUNS, EXACTLY. Both from this branch, `--keep`:

```
pnpm build
env -u CMUX_WORKSPACE_ID -u CMUX_SESSION_ID -u CMUX_TERM -u CMUX_SOCKET -u LOP_SESSION_ID \
  node scripts/browser-chrome-proof.mjs --keep
```

- the fix: `102 PASS / 0 FAIL / ALL CHECKS PASSED`;
- the base, same harness run from a worktree at `0ab50df2a8` (`git worktree add ~/local-operator-ui-worktrees/<name> 0ab50df2a8`, its own `pnpm build`, the branch's
  harness with `cwd` there): `94 PASS / 8 FAIL`, and every one of the 8 is one of THIS
  pass's own expectations — `healthy at quit 2 (…1 agent-owned and not active), restorable
  1, restored 2`; the agent-skip log line absent; `urls: […index.html, …linger, …stall-0,
  …, "", "", "", …]` with the budget line absent; `failed 0`; the row still on disk.
  That is the before reading, not a regression: none of the other 94 checks moves.

The numbers the frames carry travel with the manifest note
`browserRestoreBoundaryPass`.
