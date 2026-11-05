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

## Serial clock budget

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
The first run is retained plus five recent runs. Download full evidence before navigating
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
