# Q-3 narrow native-child resize remediation

## Reproduction and root cause

Before the fix, the instrumented isolated S5 history scene reproduced QA's result on this head:

```text
FAIL H8: owner viewport=360, row x=0 width=360, wrapper x=0 width=360
child viewport=1120, titleWidth=874, geometryOk=false
captureError=Error: CDP Page.captureScreenshot timed out
```

The row and wrapper were not overflowing. The row observer could publish the new x0/360 anchor while main still owned the old x260/1120 page rect. Their 100px intersection correctly failed main's consistency check. That refusal hid the native child before the matching page rect arrived; `onLayout` then returned early for a non-shown child without updating its bounds. A bounds-only first attempt was insufficient because Chromium does not deliver resize to a hidden `WebContentsView` renderer.

The fix retains the sanitized v2 projection from that specific inconsistency. When the matching layout arrives, main recomputes the bounds against the new page rect and applies them in one synchronous visible–resize–hide sequence. No compositor frame is yielded between those calls. The final hidden state and intentional layout dismissal are unchanged, and main's anchor consistency check is not relaxed.

## Regression coverage

`browser-address-overlay.test.mjs` now drives the exact ordering through the real controller:

1. Show and ready the reusable child.
2. Deliver x0/360 anchor with the stale x260/1120 page rect and verify `anchor_inconsistent`.
3. Deliver the matching 360px page rect.
4. Require x0/360 child bounds, final `visible=false`, and exactly the existing `dismiss: layout` event.

It was RED before the fix (`260 !== 0`) and is GREEN after. The real H8 probe now records owner geometry, keeps the geometry verdict separate from capture failure, and does not turn a capture error into the old downstream cascade.

## Actual post-fix results

Two independent instrumented isolated runs, each with all direct neighbours:

```text
13 PASS / 0 FAIL / 0 BLOCKED / 0 pending
H8: viewport=360, titleWidth=114, geometryOk=true, captureError=null
```

The terminal full head matrix then produced:

```text
32 PASS / 7 FAIL / 6 BLOCKED / 0 pending
H8 PASS: owner viewport=360, row/wrapper width=360,
         child viewport=360, titleWidth=114, captureError=null
H4 PASS: githubCommitted=true, vpnCommitted=true
```

The seven remaining FAILs are T1, T3, V4, V8, V13, V14, V15 — the same upstream S4b-era assertions present on the clean base. They are not called passes. See `matrix.md` for the complete output and `history-only.md` for the second isolated run.

## Selector-scope hardening

The glass clear is now keyed to `data-browser-route-chrome` on the route-owned wrapper, not to any chrome region nested inside any other chrome region. The tab strip and permanent address row are the only cleared members. Their computed backgrounds remain transparent and the wrapper remains the only alpha-painting region; flat materials are untouched by that selector.
