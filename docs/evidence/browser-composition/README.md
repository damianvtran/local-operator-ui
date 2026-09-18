# The browser surfaces in composition

Six frames from `scripts/browser-chrome-proof.mjs`, which is the only path in this
repository that photographs the browser feature the way a user meets it: the real
chrome over a real page, in one frame, at the window size the app actually runs.

They are here because three of the operator's four asks are COMPOSITION asks, and a
Storybook story cannot answer any of them:

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
| `03-surface-populated.webp` | the strip over the USER's own tab, whose page has no handle to composite — chrome and the content rectangle only. The "over a real page" claim is carried by `12` and `18`, and the "user tab beside an agent tab" claim by `12`, `17` and `18`; this frame is here for the strip's own grammar |
| `12-approvals-queue.webp` | the band with a numbered queue: the count, the chips, the selected request's card |
| `17-tab-actions-in-band.webp` | the tab actions row and the badge in situ (D3, D4) |
| `18-approvals-dock.webp` | the dock open, the page still visible and narrowed, no suppression (D2, D9) |
| `19-strip-marked-tab-at-rest.webp` | the strip at rest with a user and an agent-marked row, **and on this head the strip IS in the picture**: re-taken 2026-09-17 on the harness that calls `exposeStrip()` before every frame, the frame carries the strip's own row with the `Agent` chip legible on `Proof page two` beside the group label `proof-open 1` and the unmarked row `Proof page one` (see the D9 note below for what moved and what the DOM reading says). The no-daemon banner is still painted across the top of the window — the harness has no daemon by design — but the strip now sits BELOW it rather than under it, which is the difference between a frame that shows the subject and one that only shows where it would have been |
| `20-strip-failed-and-agent-markers.webp` | the same surface with the band OPEN, and the same re-take: the strip's own row carries the pair at once — `Agent` and the `Failed` pill side by side on `127.0.0.1:52792/broken` — with the band's items (`Let an agent use "Proof page one"…`, `Close "Proof page one"`, `Close 1 other tab`, `Copy URL`) below it and the URL bar under those. This is the frame D11/D12 asked for: the closed actions block is gone and the band carries TWO counted closes, which are the band's only red — `Close "Proof page one"` and `Close 1 other tab` (the four-close count is the batch story's, in `browser-tab-strip/actions-expanded-batch`) |

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
runs.** `17-tab-actions-in-band`, `19-strip-marked-tab-at-rest` and
`20-strip-failed-and-agent-markers` come from the run below; `03-surface-populated`,
`12-approvals-queue` and `18-approvals-dock` are unchanged from `25ad52c33` (this
branch's spelling of the round that re-shaped the tab strip's overlaid chrome
cluster, the band's busy cue, the dock's notice sentence and waiting row, and the URL
bar's label reserve), which is what `manifest.json`'s `partialCapture.roundTwoRecapture`
records. The split is not arbitrary: review round 2's remediation moved the band's own
rows (D11: the four counted closes take `variant="danger"` and `Watch` returns to
`ghost`; D12: a hairline opens the destructive block) and the pinned control's channel
words (D10), and `17` is the in-situ frame of that band. `19` and `20` were owed for a
different reason, D9, which is answered in its own section below. Nothing moved in the
other three, and rather than re-shoot them for tidiness this file says which run each
came from.

**THE IN-SITU CLAIM IS THE REASON `17` IS HERE AT ALL.** The story frames under
`browser-tab-strip/` show the band alone, on a decorator that pads the page; in the
running app the badge is drawn at the window's right edge, next to the tab actions row,
and the page sits under the band. `17` is the frame that shows all three at once — the
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
not the run's own: `03-surface-populated`, `12-approvals-queue` and `18-approvals-dock`
are the run's frames of those names in its own scratch directory, and
`17-tab-actions-in-band` is too; `19-strip-marked-tab-at-rest` is the run's
`09-strip-user-and-agent` (the strip at rest with one user and one agent-marked tab) and
`20-strip-failed-and-agent-markers` is its `16-surface-strip-failed-agent-tab` (the
`Failed` and `Agent` markers painted together), each encoded to `.webp` at quality 90.

## The two frames named for the strip's markers now contain the strip (review round 2, D9, DISCHARGED 2026-09-17)

**MEASURED, IN THE COMMITTED PIXELS, ON BOTH SIDES OF THE FIX.** The frames these two
names carried before this re-take were taken on a tree where the strip's own row sat at
CSS 0-36 and the no-daemon banner ran to CSS 68, so the banner lay OVER the strip: the
frame's top 133 device px (≈67 CSS at dpr 2) was the banner's fill ending in a rule at
device y 134, and against the chips' own `#67C674` a 5% fuzz found 11,250 px in the frame
that DOES show them (`browser-pane-live/browser-pane-strip-four.png`) and 0 in `19` and 5
in `20`. Those two files are replaced, not re-captioned.

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
frames carry the markers — `Agent` on `Proof page two` in `19`, `Agent` and `Failed`
together on `127.0.0.1:52792/broken` in `20` — which is the claim these two names exist to
carry.

**WHY THESE FRAMES CARRY A BANNER, AND WHY THAT IS ABOUT THE MOMENT IN THE RUN RATHER THAN
ABOUT THE HARNESS** (review round 2, D14). Both frames carry the app's two stacked notices
at the top because the harness boots the app against no daemon at all (its own "scratch
backend port is dead" check is what makes the run isolated) and the app's own check
FAILS A MOMENT AFTER BOOT rather than before it — so a frame taken earlier in the same run
is banner-free, and this set contains one: `03-surface-populated.webp`'s top-left is the
app's own ground `(14,12,8)`, uniform through device y 248 (CSS 124), with the strip's
first rule at device y 8. The neighbouring
`browser-conversation-tabs/live/19-strip-pooled-20-over-6.png` measures `(15,12,8)` for
the same reason. Both readings are mine, taken on this head with `sharp`. An earlier
revision of this paragraph said "no frame it takes is banner-free", which those three
frames refute; the banner is a property of WHEN the frame was taken, not of the harness,
and a banner-free re-take of `19`/`20` is available for anyone who needs one. What D9 was
about — two committed frames named for a strip they did not contain — is answered by the
strip being in them.

What it took: the harness that carries this file's frames is
`scripts/browser-chrome-proof.mjs`, and the defect that stopped it completing a run at
all — a synchronous `osascript` frontmost sampler starving the event loop, so the probe
read the host's own record outside its own deadline and died with `no LIVE host
answered /health` while the host was up — is documented in its `frontmost()` docblock
and fixed in the same commit that ships these frames. The re-take is the command above,
with the `17-tab-actions-in-band`, `09-strip-user-and-agent` and
`16-surface-strip-failed-agent-tab` scratch PNGs encoded to `.webp` at quality 90.
