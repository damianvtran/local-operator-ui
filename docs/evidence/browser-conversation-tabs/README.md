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

## What this set does NOT show, stated rather than implied

**THE BAND'S HEADING ROW IS RENDERED BUT NOT VISIBLE IN `live/19b-pinned-control-open.png`,
and the readout beside it is why** (review round 1, D5, resolved after the round). The
design reviewer measured no ink where the band's own heading (`All tabs, N not shown`,
`browser-tab-strip.tsx`'s first child of `browser-tab-overflow-list`) belongs, and could
not tell whether the run had driven a stale bundle, whether a clip hid it, or whether the
row was missing. It is none of those: this run's app has **no daemon to talk to**, so its
own reconnect banner ("No Local Operator daemon was found and this app is configured not
to start one.") is painted across the top of the window, and the band's first 24 CSS px
sit under it. Measured in the same run, from the DOM rather than from the pixels:

```
heading {"text":"All tabs, 16 not shown","top":49,"bottom":77,"left":220,"right":1380,
         "height":28,"display":"flex","visibility":"visible","overflow":"visible"}
        inside the band box {"top":44,"bottom":225,"left":220,"right":1380,"height":181}
```

The proof now RECORDS that reading and CHECKS it ("the band paints the heading row the
source renders, inside the band's own box"), so the frame's silence about the heading is
answered by a measurement taken at the same moment rather than by inference — and the
band's own height (181 = the 8px of padding + the 28px heading + the 144px scroller) is
the second witness that the row is in the box it is drawn in. A frame with no banner in it
would show the row; the harness deliberately has no daemon reachable (that is the
"scratch backend port is dead" check at the top of its own transcript), so that frame
cannot be taken from this harness.

There is no before half for `live/19b-pinned-control-open.png`, and it cannot be produced:
the scene is added by this change, and the control it photographs no longer exists on the
base — a menu inside the band, which `browser-view-policy.ts` paints into the content rect
under the native view. The occlusion claim is answered on the after side instead: the
frame shows the list in the band with the page below it intact, and the proof asserts the
same thing in text ("the pinned control opens with a row for every tab in the pool, in the
band rather than over the page"). A reader looking for the before image of a menu that was
never visible is looking for a photograph of an absence.
