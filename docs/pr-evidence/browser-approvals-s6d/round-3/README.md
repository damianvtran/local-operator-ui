# Round 3 — source repair evidence; native QA pending

## Scope

This directory documents **source-only** changes and tests for the two narrow
round-3 findings. There is **no new frame, full build, native launch or whole-app
proof** here. The independent native acceptance pass is pending on the immutable
repair head. Round-2 artifacts stay historical; none is re-pinned to this repair.

## Repaired mechanisms

- **R3-1 / Q3-2 / U3-2 / D3-2:** `#approvals-request:not([hidden])` scopes its
  authored flex display so it cannot override `[hidden]`. The real document AND
  stylesheet are loaded together in `scripts/approvals-card-document.test.mjs`.
  The test asserts computed `display:none` and that no request decision
  participates in the visible/tabbable tree; Back restores both request and list
  states. This proves CSS/ancestor visibility in jsdom, not native pixel geometry.
- **R3-2 / Q3-1 / U3-1 / D3-1:** only an actually overflowing explanation becomes
  a named `region` and a Tab stop. Decisions link to it with
  `aria-describedby=approvals-gloss`. Forward Tab from a decision enters that
  decision's explanation (restoring its own text after a pointer preview);
  reverse Tab returns to the same decision; continuing forward reaches the next
  decision or Review-all. A visible border, stable scrollbar gutter and
  `:focus-visible` treatment mark the scrollport. Entering the explanation
  freezes its selected scope against hover replacement. Native text measurement
  preserves scroll position. Short non-overflowing explanations keep `tabIndex=-1`.
  No new copy, catalogue key, channel or host/preload change.

## Executed source tests

From `~/local-operator-ui/.worktrees/s6d`, existing dependencies, no installs,
no stash and no native launch. Disk checked above 2 GiB before each bounded run.

```sh
NODE_OPTIONS=--max-old-space-size=1536 \
python3 ~/local-operator/scripts/run_bounded.py --timeout 90 --memory-mb 2500 -- \
  node --test --test-name-pattern='R3-' scripts/approvals-card-document.test.mjs
```

Pre-repair source control (copies, never git stash): **0 pass / 2 fail**, rc 1.
Actual `R3-1` failure: computed `flex` vs expected `none`.
Actual `R3-2` failure: `tabIndex=-1` vs expected `0`. Source was restored after
the control. This reproduces the exact authored CSS and accessibility defects;
native geometry reported by independent round-3 reviewers remains attributed to
those reviewers, not relabelled as a launch performed here.

```sh
NODE_OPTIONS=--max-old-space-size=2048 \
python3 ~/local-operator/scripts/run_bounded.py --timeout 180 --memory-mb 3000 -- \
  node --test --test-concurrency=1 \
  scripts/approvals-card-document.test.mjs scripts/approvals-overlay.test.mjs \
  scripts/browser-approvals-route.test.mjs scripts/browser-startup.test.mjs \
  scripts/test-inventory.test.mjs
```

Final source suite: **65 pass / 0 fail**, rc 0 (`source-tests.log`).
`approvals-card-document`: **12 pass / 0 fail**, including stylesheet visibility,
scope text preservation, End/Home/PageDown/ArrowDown to the actual synthetic
scroll boundary, non-overflow tab-stop removal, and no decisions while reading.
`node_modules/.bin/tsc --noEmit -p tsconfig.app.json`: rc 0.
Biome on four changed implementation/test/probe files: no errors.
`node scripts/i18n/check-added-strings.mjs --base 17301e60c1`: no new literal copy.
`git diff --check`: clean. No full suite was run.

## Native acceptance prepared, NOT executed

`browser-approvals-s6b-probe.mjs` now adds rows for computed request display/zero
rectangles and no request decision tab stops in Review-all, Back restoration, and
**all five scope explanations** on fresh broad-grant fixture entries. Overflowing
explanations must be reachable from their associated decision, preserve full
selected text, reach the end using real End key input, then reach the end again
using real CDP wheel input, with zero denial overdraw. Non-overflow explanations
must not add a stop. The existing I7 control-order assertion allows only the
intentional gloss stop between otherwise unchanged decision controls.

**These rows have not run and claim no pass.** They require the manager's
original narrow source review, then one final full build and independent
native/app QA on an immutable head. Native composite/transparency, ring routing,
VoiceOver and OS focus remain BLOCKED and require attended validation or an
explicit named release-owner limitation. This is a headless interaction plan,
not a substitute for those checks.
