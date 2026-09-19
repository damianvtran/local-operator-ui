# browser-conversation-tabs — the strip's grouping, the chip cap and the in-band list

This set holds the frames a sweep of ONE tree cannot produce, which is why it is declared
rather than swept:

- `before-strip-story/` — `browser-tab-strip--worst-case` and `--worst-case-widest` as
  `origin/main` (the branch's merge base) renders them: an unbounded chip run beside each
  title, which is the floor the fix is about. Extracted with `git show
  origin/main:docs/evidence/browser-tab-strip/<story>/localOperatorDark.webp`; the same
  stories' frames in this tree are re-taken at all twelve palettes under
  `docs/evidence/browser-tab-strip/`.
- `after-strip-story/` — the same two stories on this branch, same fixtures, same
  viewports, same palette, so the pair differs only by the change.
- `live/` — the proof run's own frames (`scripts/browser-chrome-proof.mjs`, the frame
  names the run prints), which are observations of the running app rather than stories:
  the pooled strip with twenty tabs from six conversations plus the unattributed run,
  the pinned control opened as the in-band list, the same frame with the page beneath it,
  and the one-event batch close.

  **TWO OF THE FOUR ARE FROM A LATER RUN THAN THE OTHER TWO** (2026-09-17).
  `19b-pinned-control-open.png` and `19b-pinned-control-open-page.png` were re-taken in
  the run that closed the D5 and D9 findings below; `19-strip-pooled-20-over-6.png` and
  `19c-batch-close-one-event.png` are unchanged from the pass before it. Nothing in those
  two carries a surface the intervening round repainted — `19` shows the strip with the
  pinned control already reading its bare count (`16`), and `19c` shows the band's list,
  which the remediation's band changes do not touch — so they are not re-shot for
  tidiness. Say what each is a picture of rather than implying one run made all four.

## What this set does NOT show, stated rather than implied

**THE BAND'S HEADING ROW IS RENDERED AND, ON THIS HEAD, VISIBLE IN
`live/19b-pinned-control-open.png`** (review round 1, D5, resolved after the round and
confirmed in this re-take). The design reviewer measured no ink where the band's own
heading (`All tabs, N not shown`, `browser-tab-strip.tsx`'s first child of
`browser-tab-overflow-list`) belongs, and could not tell whether the run had driven a
stale bundle, whether a clip hid it, or whether the row was missing. It was none of
those: the run's app has **no daemon to talk to**, so its own reconnect banner ("No Local
Operator daemon was found and this app is configured not to start one.") is painted
across the top of the window, and on that tree the band began at CSS 44 — under the
banner's 68 — so the row was drawn and covered. What the proof RECORDS, from the DOM
rather than from the pixels, at the same moment it takes the frame:

```
banner {"top":0,"height":68}
heading {"text":"All tabs, 16 not shown","top":170,"bottom":198,"left":220,"right":1380,
         "height":28,"display":"flex","visibility":"visible","overflow":"visible"}
        inside the band box {"top":165,"bottom":346,"left":220,"right":1380,"height":181}
```

The heading sits at CSS 170-198 and the band's box at 165-346, both entirely below the
banner, and the committed frame shows the row: `All tabs, 16 not shown` is legible
above `conv-alpha 4`. Two checks in the run carry that rather than this paragraph — "the
band paints the heading row the source renders, inside the band's own box" (the reading
above) and "the tab strip is present in the layout, whether or not the connectivity
banner is up over it" (`banner {"top":0,"height":121} over 2 notice(s), tab strip
{"top":121,"height":37}, overlaps false`). The band's own height is the second witness
that the row is inside the box it is drawn in: 181 = the 8px of padding + the 28px heading
+ the 144px scroller.

**THE TWO READINGS DIFFER ON PURPOSE, AND THE SECOND IS THE WHOLE BAND** (review round 2,
D15). The block above is the reading THAT run took, when the banner finder stopped at the
first matching notice: 68 CSS px, the connectivity band alone. The window carries TWO
stacked notices when the app's compatibility check has failed as well (68 + 53 = 121, the
sum `app.tsx` records for exactly this case, and the pair `browser-composition/19` and `20`
photograph), and the finder used to under-report that by the second band's 53 px — while
its `overlaps` compared 68 against a strip at 121, i.e. ~53 px of headroom that does not
exist on a band ending 1 px above the strip's top border. The finder now collects every
matching band and reports their union, with each notice named beside it, so the figure a
reader quotes is the band the frame carries and a future regression at the strip's top
border cannot pass it.

Why the row sat under the banner before and does not now is the app's own chrome, not a
change to this harness: the strip and the band lie below the whole band on this head,
where the version these frames first replaced put the band at 44. What changed is that the
banner no longer covers the subject.

**NOT "NO FRAME THIS HARNESS TAKES IS BANNER-FREE"** (review round 2, D14). The harness
still deliberately has no daemon reachable (that is the "scratch backend port is dead"
check at the top of its own transcript), but the banner is a property of WHEN IN THE RUN a
frame is taken, not of the harness: the app's own check fails a moment after boot, so a
frame taken earlier in the same run carries no banner at all. Measured on this head with
`sharp`: `browser-composition/03-surface-populated.webp`'s top-left is the app's own ground
`(14,12,8)`, uniform through device y 248 (CSS 124), and this set's own
`live/19-strip-pooled-20-over-6.png` measures `(15,12,8)` — both from runs whose later
frames carry the band. An earlier revision of this paragraph said "so no frame it takes is
banner-free", which those two frames refute.

There is no before half for `live/19b-pinned-control-open.png`, and it cannot be produced:
the scene is added by this change, and the control it photographs no longer exists on the
base — a menu inside the band, which `browser-view-policy.ts` paints into the content rect
under the native view. The occlusion claim is answered on the after side instead: the
frame shows the list in the band with the page below it intact, and the proof asserts the
same thing in text ("the pinned control opens with a row for every tab in the pool, in the
band rather than over the page"). A reader looking for the before image of a menu that was
never visible is looking for a photograph of an absence.
