# Image viewer — cold neighbours load on demand

This completes the original request to respect partial image loading. The
manager's final source check found that the earlier strip mounted every known
CanonicalImage at open; correcting its “lazy” comment had not implemented the
requested demand boundary. This set records the completed behavior, not a new
conversation pager or a second resolver.

## States (two brand themes; four new frames only)

| State | Action | What it proves |
| --- | --- | --- |
| `loading` | Open `Demand image 1` with synthetic responses held | Visible reserved slots, 24 known positions, only 9 cold requests rather than all 23 cold digests |
| `loaded` | Press `Release fixture responses` | Neighbours paint in the same strip/slot boxes; distant cold slots remain deferred |

`localOperatorDark` and `localOperatorLight` were captured with the browser tool,
viewed as two-state contact sheets, and normalised from 2560x1440 native PNG to
1280x720 CSS-pixel WebP (Sharp resize, quality 85). No existing viewer frame was
replaced. The fixture's top-left route/count/release controls are test
instrumentation, not new production chrome.

## Reproduce the real clicks and counted route

```
cd ~/local-operator-ui/.worktrees/imgview-viewer
env -u XPC_FLAGS LOCAL_OPERATOR_UI_NO_BYTECODE=true \
  LOCAL_OPERATOR_UI_TELEMETRY=off LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
  pnpm storybook --port 6231 --no-open
```

Navigate with the browser tool to
`http://localhost:6231/iframe.html?id=image-viewer-controls--demand&viewMode=story&args=theme:<theme>`.
Wait for `Expand Demand image 1` in the snapshot, then click it. This story
installs a **synthetic `sessions.attachment` route at the existing preload media
bridge**, returning real PNG bytes through desktopMedia -> useAttachmentUrl ->
blob cache -> CanonicalImage. It counts each request and initially holds its
reply. It is not an actual backend/media-relay server and makes no production
network claim. Digests are distinct, so request dedup cannot conceal eager
loading of the whole group. Picture 1 alone has inline bytes.

1. Open: output reads **Requests (9): 2, 24, 3, 4, 5, 6, 7, 8, 9**. The
   wrapped neighbour 24 is admitted even offscreen; the observer admits visible
   slots 3..9, not far cold slots 10..23. Screenshot -> `loading/<theme>.webp`.
2. Click `Release fixture responses`: loaded thumbnails appear. Screenshot ->
   `loaded/<theme>.webp`. Future requests use a synthetic 1800ms reply delay.
3. Click `Previous image` (1 -> 24). `scrollIntoView` moves the strip to its
   tail, and the one root observer admits newly visible, **non-adjacent** slots.
   Output becomes **Requests (17): 2, 24, 3, 4, 5, 6, 7, 8, 9, 23, 16, 17,
   18, 19, 20, 21, 22**. This distinguishes visibility loading from merely
   current +/-1 prefetch. Slot 12 remains deferred and unfetched.
4. In the light-theme pass, click `Next image` back to 1: count stays **17**,
   no refetch on return.
   (Direct strip scrolling through this browser host's scroll action did not
   move the element; actual carousel-wrap scrolling supplied the live check.)
5. While replies are held, `Show image 2 of 24` is still a real select button:
   the live position switches to **Image 2 of 24** before bytes arrive. This
   was exercised in the light theme, then returned to 1 before the loaded frame.

`browser-proof.json` retains the actual request outputs and rect readings.
Both themes had identical pending/settled rectangles:

| Element | Rect (CSS px), before AND after |
| --- | --- |
| strip | x128, y617, 1024x87 |
| slot 1 (inline) | x136, y621, 117x79 |
| slot 2 (cold -> loaded) | x261, y621, 117x79 |
| slot 12 (far/deferred) | x1511, y621, 117x79 |

Initial live measurement found a 1px cold-to-settled difference (78 -> 79).
Cold slots now reserve the settled outer 79px height, with the existing
AttachmentFrame's **117x78** reserved treatment inside. Inline and known-missing
slots keep their reviewed markup/dimensions. The current ink ring and its
`scroll-mx-px` clearance remain on every stable li, not on a conditionally
mounted resolver.

## Implementation and scoped regression

One strip-root IntersectionObserver activates visible slots. Selected and
wrapped current +/-1 are eligible immediately; inline data and known-missing
entries need no demand fetch and render immediately. Admission latches until
close, resets on group/scope/digest identity changes, and ignores callbacks
from retired observers. Offscreen cold slots keep the list position and a
named select button; selecting activates the existing resolver before the
bytes arrive. Missing IntersectionObserver support retains the selected/
neighbour path rather than silently fetching every cold tile.

The controlled-observer test uses distinct cold digests and the real native
media bridge seam. It asserts no far fetch at open, explicit visibility and
selection activation, wrapped neighbours, latch/reset, retired-callback
rejection and stable li identity. jsdom does NOT measure layout: the actual
no-reflow proof is the browser rect equality above.

```
node --test --test-name-pattern='cold strip demand|wide wrap|walk scrolls|filmstrip switches|walk from a strip|arrows walk|tile whose bytes|one picture in a group|fade to their resting|focused control' scripts/chat-image-expand.test.mjs
# 12 tests, 12 pass, 0 fail (8.799s)
```

## Limits and hygiene

- Synthetic route counts/real returned PNG bytes are verified, not a deployed
  daemon, remote media relay, access-control response or unloaded history page.
- Transcript pagination remains separate: the strip only knows its supplied
  group array and never fetches an unknown page.
- No app build, dependency installation, full suite, whole-set re-capture or
  local evidence decoder ran. Existing 120 viewer frames are untouched.
- Console errors were the previously observed Storybook placeholder PostHog
  401/404 responses; no viewer exception observed.
- One browser tab/server were reused for both themes. Tab closed, job and exact
  server process group reaped, port 6231 checked free.
