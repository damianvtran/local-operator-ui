# The sidebar's split, driven — the reveal, the drag, the collapse, the swap and the restart

Design review round 1 (D1) made this directory a blocker: the collapse cluster,
the boundary's hover and drag state line and the tooltips are the entire interface
between a user and this change, and a Storybook still can photograph none of them.
`:hover` is a state only the browser can enter, the reveal's timing is a claim
about two moments rather than one, and "a restart restores your adjustments" is a
claim about two boots. This is `--scene sidebar-split` in
`scripts/renderer-driver.mjs`, and these are its frames.

The design contract is `docs/design/sidebar-sections.md` (S1–S12, § 7.3, § 7.4);
the resting states are the story set in `../chat-sidebar-sections/`.

## What produced these frames

The built app, launched headless by the driver's own launcher (Electron 44.3.0,
`--window-mode=headless`, a scratch `--user-data-dir`, scratch `HOME` and config —
never shown, never focused), against an **isolated** `local-operator serve` this
run owns:

```sh
# 1. the backend, its own home and config root, its own bearer (minted, 0600)
mkdir -p /tmp/sbs-scene/backend/home
LOCAL_OPERATOR_HOME=/tmp/sbs-scene/backend/home \
LOCAL_OPERATOR_CONFIG_DIR=/tmp/sbs-scene/backend/config \
LOCAL_OPERATOR_DESKTOP_TOKEN=<minted for this run> \
  ~/local-operator/.venv/bin/python -c "from local_operator.cli import main; main()" serve --port 8931

# 2. six conversations in its catalogue, so the list region has real rows
for i in 1 2 3 4 5 6; do
  curl -s -X POST http://127.0.0.1:8931/v1/desktop/sessions \
    -H "Authorization: Bearer <the same token>" -H "Content-Type: application/json" \
    -d "{\"request_id\": \"$(uuidgen | tr 'A-Z' 'a-z')\", \"cwd\": \"/tmp/sbs-scene/backend/home\"}"
done

# 3. a renderer built to talk to THAT backend (the URL is inlined at build time)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8931 pnpm build

# 4. the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=<the same token> node scripts/renderer-driver.mjs \
  --scene sidebar-split --backend http://127.0.0.1:8931 \
  --backend-records /tmp/sbs-scene/backend/config/run/serve --seed-onboarding-complete \
  --out docs/evidence/sidebar-split-live
```

Run on 2026-09-19 at head `0aeccbc79`'s remediation round, `SCENE_EXIT=0`, with
**31 checks passed and 0 failed**, ending in the driver's own leftover-process
check (`[PASS] no process from this run outlived its boot`). The scratch profile
the restart reuses is `${USER_DATA}-scene`, and the two boots were pids
`76254 -> 76713` in that run: same profile, different process.

## The frames

| Frame | What it proves |
|---|---|
| `split-rest-360-dark.png` | the boundary at rest: nothing painted but the shipped hairline, the panel at 360px |
| `split-reveal-early-dark.png` | the first frame of the reveal — the cluster's plate and the line arriving together (S4's one intent) |
| `split-reveal-settled-dark.png` | the same state settled: three `icon-sm` ghost glyphs at the boundary's **trailing end**, with the centre of the band left to the drag (U1) |
| `split-tooltip-dark.png` | a tooltip open on a cluster control — the only naming a sighted user gets for a glyph-only button |
| `split-drag-line-dark.png` | the boundary's drag state line while the drag is **in flight**, captured mid-gesture with the button still down |
| `split-dragged-dark.png` | the drag's result: a stored height drawn where it says, and `aria-valuenow` equal to the drawn height |
| `split-collapsed-dark.png` | the collapse settled: the entity region fills the column, the chats region is unmounted, the restore row names what is hidden and carries its count |
| `split-restored-dark.png` | the way back, pressed and persisted |
| `split-keyboard-home-dark.png` | the keyboard path: the separator focused, `Home` pressed, focus still on the separator. Since round 2 `Home` goes to the LABELLED pane's extreme (the chats list's smallest, D8) rather than to the axis's - which for this handle's default order was the same region's maximum |
| `split-swapped-dark.png` | the swap: the chats region drawn first, each region keeping its **own DOM node** and its scroll position (U2) - subject to the region's new content height, so a position within 8px of the end is clamped by the region's own shorter content (Q-2; measured `120 -> 111`) |
| `split-rest-240-dark.png` | the panel at its width clamp, where the boundary and its controls have the least room |
| `split-reveal-240-dark.png` | the reveal at that width — the plate and the three glyphs still fit |
| `split-rest-360-light.png` | the resting state in the second brand palette - the SAME state as its dark twin, on a profile whose stored height is back to auto (see below) |
| `split-reveal-settled-light.png` | the revealed cluster in that palette |
| `split-restart-restored-dark.png` | **the operator's own acceptance criterion**: a second boot of the app, in the same scratch profile, drawing the height AND the collapse that were stored before it |

## What these frames do and do not prove

* **Real gestures.** Every pointer move, press and drag goes through CDP's
  `Input.dispatchMouseEvent`, so it enters Chromium's own input pipeline and the
  element under it is found the way a hand's would be — the check
  `the band's CENTRE is the separator rather than a control` is that pipeline's
  answer, not a synthetic event's. The keys go through `dispatchKeyEvent`.
* **Still synthetic.** No pressure, no jitter, no trackpad momentum, no real hand.
  A frame here does not say "a person finds this".
* **The light pair is taken on a RESET state, and that is a correction.** Taken
  where the run had left the split, the two light frames photographed the clamped
  top-of-range state the drag and the `Home` press had just written - a region at
  its 72px floor under a caption that read "the resting state in the second brand
  palette" - while their dark twins, taken first, were genuinely at rest, so the two
  palettes were not comparable like-for-like at all (design round 2, D9). The state
  is now reset to auto before those frames, because the palette half of D1 needs
  the two palettes photographed in the SAME state to say anything.
* **The travel-cancel is asserted here rather than described.** Round 2 found that
  `CONTROL_PRESS_SLOP_PX` appeared once in the tree, at its definition: the half of
  U1 that stops a travelling press from acting was implemented and asserted nowhere,
  so a regression deleting it would have kept every check green (agent review round
  2, m-3). This scene now presses a cluster control, travels 20px through CDP, and
  asserts that neither the stored `regions` nor the drawn regions moved.
* **The reveal's timing is read, not photographed.** `Page.captureScreenshot`
  takes longer than the 200ms intent window, so a frame taken "inside" it can show
  the plate already up — the first version of this scene reported the opposite of
  the truth on one run and the truth on the next. The checks therefore read the
  DOM: the cluster is not revealed the moment the pointer arrives, is still hidden
  at 120ms, and is revealed after the window. The two frames above are a pair of
  the fade, and the promise they carry is the code's single shared constant
  (`HOVER_INTENT_MS`, imported by the sidebar rather than copied).
* **Focus, not rings.** A window that is never shown never renders
  `:focus-visible` rings or carets, so the keyboard frame is about focus
  LOCATION.
* **Two widths, two palettes.** 360px and 240px (the panel's own clamp), in
  `localOperatorDark` and `localOperatorLight`. The ten other palettes are the
  design round's call, and this scene's subject is a gesture rather than a colour.
* **The rows are whatever the backend holds.** This run seeds six conversations
  and NO agents, so the entity region draws its empty state (with the app's own
  `Install all built-in agents` control). The subject here is the boundary, the
  controls on it and the state they write, none of which depends on the row count.
