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
| `19-strip-marked-tab-at-rest.webp` | the strip at rest with an agent-marked row, so D12's marker visibility has a frame that can show it |
| `20-strip-failed-and-agent-markers.webp` | the `Failed` and `Agent` markers painted together, the pair D11 re-framed |

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

`12`, `17`, `18`, `19` and `20` were re-taken at `937d99822` (this branch's spelling
of the round that re-shaped the tab strip's overlaid chrome cluster, the band's busy
cue, the dock's notice sentence and waiting row, and the URL bar's label reserve).
That re-shoot is done: the deferral the earlier revision of this file carried is
discharged, and `manifest.json`'s `partialCapture.roundTwoRecapture` records it.

**The bounded delta is CLOSED, and these six frames are current at this head.** The
earlier revision of this paragraph recorded that `03` carried strip pixels from an
older tree and that none of the six had been re-photographed at the head that added
the four- and five-chip floors and the button-level clip; review round 2 then changed
two surfaces every one of them contains (the pinned control's count chip beside the
new-tab control, and the actions band's shape), so the whole set was re-taken. Source,
exactly, at this head: `pnpm build`, then

```
env -u NO_COLOR LOCAL_OPERATOR_NO_NOTIFICATIONS=1 LOCAL_OPERATOR_NO_TERMINAL_TITLE=1 \
  node scripts/browser-chrome-proof.mjs --keep
```

and the run's own scratch frames (PNG) encoded to `.webp` at quality 90. Where each
frame comes from, now stated rather than implied, because two of the names are not
the run's own: `03-surface-populated`, `12-approvals-queue`, `17-tab-actions-in-band`
and `18-approvals-dock` are the run's frames of those names; `19-strip-marked-tab-at-rest`
is the run's `09-strip-user-and-agent` (the strip at rest with one user and one
agent-marked tab) and `20-strip-failed-and-agent-markers` is its
`16-surface-strip-failed-agent-tab` (the `Failed` and `Agent` markers painted
together). `17` is the frame that carries review round 2's D7 band — one item per row,
`Copy URL` last behind the rule — in the running app.
