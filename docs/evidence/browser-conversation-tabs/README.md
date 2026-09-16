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

There is no before half for `live/19b-pinned-control-open.png`, and it cannot be produced:
the scene is added by this change, and the control it photographs no longer exists on the
base — a menu inside the band, which `browser-view-policy.ts` paints into the content rect
under the native view. The occlusion claim is answered on the after side instead: the
frame shows the list in the band with the page below it intact, and the proof asserts the
same thing in text ("the pinned control opens with a row for every tab in the pool, in the
band rather than over the page"). A reader looking for the before image of a menu that was
never visible is looking for a photograph of an absence.
