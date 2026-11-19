# One 300-second preview closure pass

This is the shipped ChatPage in a same-origin iframe, not a component replica.
Product DOM/CSS is unchanged. The iframe has real 800x600 or 1280x900 browsing
context dimensions; the evidence MUST report matching child innerWidth/innerHeight.
There is no native-window, compositor-first-paint or clipboard success claim here.

## Setup and exact surfaces

Manager owns one server and one harness-browser tab. Start only from the frozen,
clean PR worktree; record `git rev-parse HEAD` and compare it to evidence `source`.
Vite injects the startup checkout SHA, NOT a compiled-artifact identity. Do not edit
source while serving. No production backend is used (existing scripted bridge).

Use the harness bash background job with **timeout=300**, memory_mb=1536,
NODE_OPTIONS=--max-old-space-size=512, isolated scratch HOME/XDG_CONFIG_HOME, and
CMUX_* stripped. The command inside that owned process group, from the worktree:

```
node_modules/.bin/vite --config scripts/session-switch.vite.mjs --host 127.0.0.1
```

No install/build and no second server. Port 5211 must be free, not borrowed.
Stop on failed startup, blank page, or unresolved imports; no fallback browser.

Host: `http://127.0.0.1:5211/session-switch-preview.html?scene=long`
Other fixed `scene` values: `short`, `only`, `echo`, `code`, `links`.
Host selectors: `#scene` (native select), `#narrow`, `#wide`, `#reload`, `#sample`,
`#chat-fixture` (iframe titled "Real ChatPage fixture"), `#evidence` (compact read-only summary),
`#download-evidence` (actual user-click download of full sample JSON).
The existing direct page and galleries remain available and unmodified.

## Final two rows only (maximum 300s; all other rows retained)

- `?scene=reopen` now explicitly passes `domWindow=on`. The child head sets the
  SHIPPED `canonicalTranscriptDomWindow=on` localStorage flag after its normal
  clear and before any product module mounts. This is an opt-in feature case,
  not evidence of default DOM windowing. Require evidence DOM window `on`; an
  `off`/fallback result is not a successful unmount. Expand target e87, then use
  an actual click on the child composer to move focus out of the row and clear
  any text selection. Focus/selection retain a row deliberately; expansion of
  a plain-text user row alone does not. The newly authorized OUTER buttons
  `#history-start` ("Scroll history to start") and `#history-end` ("Scroll history
  to end") ONLY locate `[data-lo-transcript-scroll]` and call native `scrollTo`.
  Trusted root-button clicks release child focus normally; handlers never focus,
  select, change state/keys or force remount. Start uses the actual negative range
  `-(scrollHeight-clientHeight)` for the shipped flex-col-reverse scroller; end
  uses zero. A normal-flow scroller uses zero/scrollHeight instead. Click start
  to leave the target, capture `target-not-mounted`, then end to return to the same ID
  and capture reconstructed Show less; collapse and record cap174/anchor. Do not
  switch session, reload, invoke handlers or force unmount. Budget 0–160s.
  Download samples include exact independent container scrollTop/clientHeight/
  scrollHeight/flexDirection even while target is absent, plus observer-assigned
  container/target DOM-object identities. A restored target should have a new DOM
  identity under the same container/session. These are NOT React view-state IDs:
  no state-owner identifier is exposed. Source keeps the same uninterrupted
  CanonicalTranscript mounted; neither button navigates or replaces any element.
  If production retains the row despite native scrolling, report the pin/fallback
  evidence and leave the remount cell unproved; never add a forced unmount.
- `?scene=seal` uses the unchanged validated skill payload with a SHORT synthetic
  request (`userLines=0`), so its actual `$capture-demo` nested trigger can fit
  initially rather than sitting above a long bottom-anchored request. Use fresh
  child snapshot refs for that trigger, open its actual instructions, capture
  both trigger and `[data-lo-skill-body]`. No replacement UI or parser change.
  Budget 160–250s; if above viewport, use actual child scrolling before capture.
- 250–300s: download full JSON, save uniquely named captures, console check,
  close owned tab, stop exact owned server group and verify port closed.

Cold/locale/image/quote and prior English rows are CLOSED and retained; the
broader prior plan below is historical guidance, NOT a new dispatch matrix.

## Prior remaining-review closure (historical, do not rerun closed rows)

Use direct host URLs, NOT the flaky native scenario select. Prefix every suffix
below with `http://127.0.0.1:5211/session-switch-preview.html?scene=`. Retain already
approved English/gallery/attachment observations; do not rerun them as a matrix.

- **0–90s: `reopen` (U2/QA5 priority).** Fixed 90-step outgoing session, target
  `[data-record-id="abcdef000001-e87"]` (last user row), source owner unchanged.
  Expand its actual disclosure, record `Show less` and target ID. Use real child
  scrolling to leave the row's render window, then return to the SAME target.
  Evidence must show `target-not-mounted` followed by that same record ID and a
  reconstructed expanded `Show less`, then actual collapse to cap 174 and anchor.
  A DOM row merely offscreen is NOT remount proof. If it never unmounts under the
  app's real scroll path, report that bounded limitation, not a fabricated pass.
  **Do not switch sessions or reload:** canonical-transcript.tsx's viewState is
  deliberately replaced when its session identity changes (around 4290); only a
  row unmount under the same transcript owner can demonstrate retained state.
- **90–145s: `cold-long`, then `cold-short`.** These boot with no session selected.
  Through actual sidebar refs click `Workspace session 1`; pointer observation
  re-arms before its handler. Download first-content geometry immediately. Require
  cap174 for long and no false disclosure for short; an empty original navigation
  run is not content evidence. The initial and first-content runs are preserved.
- **145–205s: `fr-long`, then `ur-long`.** Real `setLocale` catalogue selection and
  manifest-derived document lang/dir. At actual800x600 capture full focused long
  label/disclosure collapsed and expanded; observe locale/dir in summary. Never
  replace labels or apply an artificial RTL stylesheet.
- **205–270s: `quote`, `seal`, `image`.** Actual reply-prefix parser, reducer-stamped
  skill payload, and a validated tiny inline PNG through the shipped image block.
  Use the real nested disclosure/card; capture parent cap behavior and visible
  grouping. No file uploads, RPC image bytes or replacement attachment cards.
- **270–300s:** download full JSON via `#download-evidence`, save unique captures,
  read console, close owned tab, TERM exact owned Vite group and verify port closed.

For every scene, use new child snapshot refs after navigation. At800x600 the parent
iframe stays exactly sized; innerWidth/innerHeight evidence must match. Trusted
Tab/Enter/Space use the actual child refs; never proxy or invoke handlers. Source
and viewport are read from the host/child respectively. Full geometry is in the
Blob download, not the compact accessibility tree. No native claims or QA waiver.

## Original general-purpose serial clock budget

- **0–30s**: launch once, inspect logs, open host through harness browser. Verify
  source SHA, real child 800x600 and nonblank real app. Browser console must be read.
- **30–90s**: long scene; capture collapsed, keyboard-focused collapsed, expanded,
  keyboard-focused expanded. Use real child disclosure, NOT an outer proxy.
  Narrow/wide buttons resize the child; evidence reads actual dimensions again.
- **90–135s**: select short and only; verify cards remain grouped with their user
  row and short/empty prose does not produce a false disclosure. Select echo,
  stay on boot `abcdef000001`, use real fixture buttons "Paint synthetic attachment
  echo" then "Persist synthetic attachment row"; capture both states.
- **135–205s**: links/code scenarios: keyboard traversal and disclosure use actual
  child controls. For copy, quote, find and selection use the shipped UI only;
  inspect resulting selection/composer/find state, not merely the click receipt.
  The synthetic links use local fragments and inline code; code uses the existing
  fenced-block example. Do not navigate externally to prove keyboard reachability.
- **205–260s**: use actual sidebar rows ("Workspace session 2", "Workspace session
  1") to switch away/back and observe scroll/anchor behavior. "Remount fixture"
  navigates the child afresh; it intentionally clears fixture localStorage just
  like the existing standalone fixture. This is distinct from reopening a session
  in the same mounted app. Compare evidence recordId/session and scroll offsets.
- **260–300s**: save uniquely named screenshots/recording, compact summary and full JSON via
  the actual "Download full sample JSON" link (use supported browser download),
  read logs, close the owned browser tab, stop the exact owned Vite job/group.
  Verify group exit AND port 5211 closed. The 300s wall bound is the fallback,
  not permission to leave a server behind. Never kill by name.

## Observation contract and limitations

Sampling is armed before iframe navigation. It retains every rAF observation,
max 180 frames / 5 seconds per run. Read-only pointer/key listeners re-arm before
real input handlers; there is no synthetic input, focus, scroll or style change.
The six-run bound protects the initial and first content-bearing runs, then retains the most recent remaining runs. Download full evidence before navigating
or selecting a new host URL; the bounded ring is not an archival store. Full samples
exist only in memory and a click-generated Blob download, never in the page's AX
tree. The visible summary is capped at 2200 characters / 11 lines; it is NOT the
full sample archive. Blob URLs are revoked on the next download or page exit.

`firstContentIndex=-1` means NO user row was observed within that budget: not PASS.
`viewport.matches=false` invalidates narrow/wide evidence. `stableFrames` counts
consecutive identical observed geometry, not permanent stability or native paint.
Samples contain row, bubble (cap's parent), cap, intrinsic and control rects,
maxHeight, expanded state, actual focus/selection, URL/session and scroll ancestors.
Evidence-panel updates are throttled to 12-frame intervals; samples are not.
Geometry cannot reconstruct pixels from an earlier frame. Use harness recording
for pixel timing; screenshots must have their own filenames and actual dimensions.

For child actions, use refs returned by the harness snapshot, or the harness's
supported keyboard operation after focusing `#chat-fixture`. Product selectors
inside the child: `[data-record-kind="user"]`, `[data-lo-user-turn-intrinsic]`,
and its cap's following `button[aria-expanded]`. If the chosen browser backend
cannot address child refs or keyboard input, mark that action BLOCKED; do NOT add
forwarding buttons, invoke handlers, use a custom engine, or claim proxy input.
Clipboard contents and any inaccessible find/quote result remain unverified until
the actual supported UI path exposes proof. This pass does not waive those rows.
