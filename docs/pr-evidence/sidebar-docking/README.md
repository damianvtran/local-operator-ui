# Sidebar docking — issue #1077

## What this set proves

The user's persisted open/closed choice now decides dock versus 56px strip at
1380, 1023 and 800 CSS px. The real Cmd+B and pointer controls write that same
preference; neither opens a sheet. At 800px a stored 320px width draws at 276px
so the 480px chat floor and 44px rail fit exactly, while storage remains 320 and
widening restores the full dock. The separate canvas fit-yield still collapses
to the strip without rewriting the preference, and closing the canvas restores
the dock.

C2 standard/pre-authorized UI behavior change. Non-goal: changing the separate
canvas/ask-drawer fit-yield, right-slot/run-pane behavior, or the stored width
merely to fit a narrow window.

## Independent QA round 1 supplement

Source: [QA report round 1](https://github.com/damianvtran/local-operator-ui/pull/1367#issuecomment-6377547192),
executed against `6f2fb31ff81332c64a7be7c19396c7e594870581`. The report and a
small selected artifact set are committed here so the native measurements and
focus traces do not depend on a session scratch root:

- `qa-report-round-1.md` is QA's full surface/command/actual-output matrix.
- `qa-native-3-results.json`, `qa-native-empty-5-results.json` and
  `qa-native-keyboard-6-results.json` preserve the raw comprehensive, empty-only
  and keyboard records. The comprehensive run's superseded empty predicate stays
  visible; the empty-only rerun and keyboard supplement both summarize PASS.
- `qa-contact-layout.png`, `qa-contact-states.png` and `qa-contact-keyboard.png`
  are QA's visually inspected layout, empty/loading/error and keyboard sheets.
- `qa-agents-1000-coder-dark.png` is the native 1000px agents boundary frame.
  `qa-keyboard-enter-collapsed-dark.png` and
  `qa-keyboard-space-expanded-dark.png` preserve the post-activation focus rings.

The agents boundary is sidebar **320** + roster **288** + detail **392** at
native 1000px, with no chat rail. The textarea's content box is 304px; its
`scrollHeight == clientHeight == 55`, and the measured placeholder width is
301.1709px. The image shows wrapped, readable placeholder text; the numbers
prove no vertical overflow, not an unwrapped one-line rendering.
`scripts/agents-composer-mount.test.mjs` audits those raw values and ties the
recorded placeholder to the current mounted component.

Settled native canvas and ask fit-yield both measure **56 + 480 + 443 + 44 =
1023**, retaining `collapsed=false`; closing restores the 320px dock. Real
Ctrl+B and Cmd+B both toggle twice with no sheet/dialog. Tab/Shift+Tab reaches
both named controls; Enter collapses and Space expands. After activation the
active element is BODY, and the next Tab reaches **Expand sidebar** (32x32) or
**Search chats and agents** (28x28), respectively. The keyboard JSON preserves
the full 34-stop trace and accessible names/rects.

QA's old-head macOS NPX observation remains a heap-OOM failure, not a pass. The
new push rechecks CI; no full local desktop or `check-changed` rerun is claimed.

## Trees, artifact identity and isolation

- Base application: `d406006bdfa43d73fe23d82089be4de24cae3ea4` (`origin/main`
  when the branch was cut), plus only the same driver/scene bytes used on head.
- Merged-head application: `b1b252d846dc2202054dc7819ba5a97727721a3e`, the
  merge of `aeb3574aa68ae79a8f11b60e9bf3c2bea29e4c5e` and `origin/main`
  `2eaf19928b2b7b26c67b690fbe2a013308584d63`. `after-build.txt` records the
  clean tree, application/driver/scene hashes and build. The subsequent
  evidence-only commit changes no application, driver or scene bytes.
- The base, original-head and merged-head runs used repository-pinned Electron
  44.3.0 and freshly built apps. `pnpm build` immediately preceded each accepted
  driver run and exited 0.
- Base bundle inspection finds `data-sidebar-sheet` in
  `out/renderer/assets/conversation-input-sync-BTDJOSN7.js`; the merged-head
  bundle has no match in any renderer JS. This is in addition to the behavioral
  negative control, not a substitute for it.
- The base/original-head daemon used `127.0.0.1:8080`; the merged-head recapture
  used a new separate `local-operator serve` on `127.0.0.1:18080`. Each used
  fresh HOME/TMPDIR/config/log roots, `hosting: test`, `model_name: mock-model`
  and a synthetic bearer. Another session owned `[::1]:8080`; it was not used or
  stopped. The operator's 1111 daemon was explicitly checked as unconnected.
- OAuth values were synthetic build-only placeholders because the build config
  requires all four. No credential file was read and no OAuth flow was exercised.
- The driver used a fresh headless Electron profile and its exact-process
  teardown. The accepted runs report no surviving app process. After the
  merged-head run, its daemon was reaped and port 18080 had no listener.

Setup verification against the daemon's own routes:

```text
health_status=200
create_status=200 synthetic_session=20a68eacec85
message_status=200 response_present=true
history_status=200 question=true mock_answer=true bytes=27957
```

## Commands

`$ROOT` below is the ignored run-owned runtime tree, `$TOKEN` its synthetic
bearer, and `$SESSION` the synthetic session above. The four required OAuth
variables were set to synthetic placeholders in the actual build environment.

```sh
# Base/original-head used PORT=8080; the merged-head recapture used 18080.
# Immediately before EACH accepted base/head run:
PORT=18080
VITE_LOCAL_OPERATOR_API_URL="http://127.0.0.1:$PORT" pnpm build

LOCAL_OPERATOR_DESKTOP_TOKEN="$TOKEN" \
node scripts/renderer-driver.mjs --scene sidebar-docking \
  --backend "http://127.0.0.1:$PORT" \
  --backend-records "$ROOT/config/run/serve" \
  --session "$SESSION" \
  --seed-onboarding-complete \
  --window-size 1380x900 \
  --theme localOperatorDark \
  --out "$ROOT/frames/<base-or-head>"
```

The base command exited 1 with exactly the three intended failures:

```text
[FAIL] sidebar-docking-1023-expanded-dark: docked is drawn from collapsed=false
        mode=strip width=56 preference={"collapsed":false,"width":320}
[FAIL] sidebar-docking-1023-keyboard-collapsed-dark: strip is drawn from collapsed=true
        mode=overlay width=260 preference={"collapsed":false,"width":320}
[FAIL] sidebar-docking-1023-keyboard-collapsed-dark: no sidebar overlay sheet or dialog opened
        sheet=1 dialogs=1
3 CHECK(S) FAILED
```

The merged-head command exited 0 with `ALL CHECKS PASSED`. Base and head report:

```text
renderer diagnostics: consoleEntries=0, consoleErrors=[], networkFailures=[]
[PASS] no renderer console errors during docking
[PASS] no failed network requests during docking
[PASS] no process from this run outlived its boot
```

The complete unedited outputs are `before-run.txt` and `after-run.txt`; the full
geometry, frame metadata, console and network records are the two `*-geometry.json`
files. `after-build.txt` is the merged-head build and identity record.

## Measured layout

Every row also had `sheetCount=0`, `openDialogCount=0`, and document/body
`scrollWidth <= innerWidth`. The transcript stayed populated with the synthetic
question and mock answer. Preference is shown as `collapsed / storedWidth`.

| State | CSS viewport | Drawn mode | Sidebar | Chat | Rail | Preference |
| --- | ---: | --- | ---: | ---: | ---: | --- |
| Initial wide | 1380x900 | docked | 320 | 1016 | 44 | false / 320 |
| Narrow | 1023x900 | docked | 320 | 659 | 44 | false / 320 |
| Real Cmd+B | 1023x900 | strip | 56 | 923 | 44 | true / 320 |
| Second Cmd+B | 1023x900 | docked | 320 | 659 | 44 | false / 320 |
| Real pointer collapse | 1023x900 | strip | 56 | 923 | 44 | true / 320 |
| Collapsed resize | 800x900 | strip | 56 | 700 | 44 | true / 320 |
| Real pointer expand | 800x900 | docked | 276 | 480 | 44 | false / 320 |
| Wide restore | 1380x900 | docked | 320 | 1016 | 44 | false / 320 |
| Canvas fit-yield | 1023x900 | strip | 56 | 658 | 44 | false / 320 |
| Canvas closed | 1023x900 | docked | 320 | 659 | 44 | false / 320 |

At 800 the invariant is exact: **276 + 480 + 44 = 800**, with
`scrollWidth=bodyScrollWidth=800`. The 276 value is only a render cap; the stored
preference remained 320 and the wide frame restored it.

At canvas fit-yield the merged-head tiling is **56 + 658 + 265 + 44 = 1023**
(sidebar + chat + canvas + rail). The previous table's 480 was not the previous
JSON's measurement (700); 658 is the current value read from `after-geometry.json`,
not a carried-forward estimate.

The chord uses CDP `Input.dispatchKeyEvent`; pointer controls use CDP
`Input.dispatchMouseEvent`. The canvas is opened through the driver's existing
`openCanvasDocument` verb with an owned markdown file and closed through its real
rail control. Ask-drawer arithmetic remains covered by
`scripts/right-slot-width.test.mjs` (`the asks drawer wears the canvas family's
width, and takes the slot alone`, plus the sidebar-yield integration cases).

## Frames

Base negative control:

- `before-1023-expanded-dark.png` — expanded preference forced to the strip.
- `before-1023-keyboard-overlay-dark.png` — Cmd+B opened the old 260px sheet.

Head (all are populated, settled, toast-free captures):

- `after-1023-expanded-dark.png` / `after-1023-keyboard-collapsed-dark.png` —
  the direct before/after pair at the same viewport and theme.
- `after-1023-keyboard-expanded-dark.png` and
  `after-1023-pointer-collapsed-dark.png` — the second chord and pointer control.
- `after-800-collapsed-dark.png` / `after-800-expanded-dark.png` — collapsed
  negative control and the 276px dock at the minimum window width.
- `after-800-expanded-light.png` — the same state in `localOperatorLight`.
- `after-1380-expanded-dark.png` / `after-1380-restored-dark.png` — wide initial
  and restored-width states.
- `after-1023-canvas-yield-dark.png` /
  `after-1023-canvas-restored-dark.png` — the separate fit-yield and restoration.

`after-800-expanded-light-on-white.png` is a **derived viewing aid**, not another
capture: the raw light PNG has translucent glass pixels (alpha 150–255), and the
composite makes them readable in viewers that show alpha against black. The raw
light PNG's measured RGB means are 239.45 / 236.08 / 227.87; the driver verified
DOM `localOperatorLight`, ground `#f2ede3`, and mean luma 236.3.

Every produced frame was viewed. All 11 merged-head frames were inspected in a
contact sheet; 1023 docked, 800 dark/light and canvas yield were also compared
side by side with the previous head. Consecutive-frame stability and palette
assertions are in `after-run.txt`.

## Automated reproduction and checks

Before the app fix, the new shipped-module regression was run on the base code:

```text
node --test scripts/chat-sidebar-layout.test.mjs
12 tests: 9 pass / 3 fail
1023px must honour expanded: 'strip' !== 'docked'
legacy request produced 'overlay'
800px stored-320 case: 'strip' !== 'docked'
```

On merged head `b1b252d846dc2202054dc7819ba5a97727721a3e`:

```text
node --test --test-concurrency=1 scripts/chat-sidebar-layout.test.mjs \
  scripts/chat-pane-floors.test.mjs \
  scripts/chat-sidebar-sections.test.mjs \
  scripts/right-slot-width.test.mjs
56 tests: 56 pass / 0 fail

pnpm exec biome check <the three changed renderer files>
3 files lint-clean

pnpm lint:scripts
6 changed scripts lint-clean against origin/main (2eaf199)

pnpm check-types
check-types:main and check-types:renderer passed
```

## Scoped aggregate result

The original-head `pnpm check-changed` (not rerun for this merge) completed its
job ledger with lint, changed-script lint, i18n coverage, TypeScript/release
guards and the bytecode build passing. Its `test:desktop` leg did **not** return
a test verdict: the
repository memory governor killed it (`rc=137`) at 16.2 GB owned footprint
against the 9.0 GB process-group budget (concurrency 7). The budget was not
raised and the run was not called green.

An earlier desktop attempt reached 10,203 tests / 21 failures. One was this
diff's stale `chat-layout.tsx` hardcoded-string ceiling after the sheet title
was removed; `node scripts/i18n/check-strings.mjs --update
src/renderer/src/shared/components/common/chat-layout.tsx` pruned that ceiling,
and the real-tree test now passes. The other 20 reproduce on the untouched base
with the same commands: typed-keys 3 (`TS5112` on the current TypeScript),
session-load-recovery 16, and one host-specific updater assertion
(`global-unknown` vs `uv-tool`). Those unrelated/base failures are not claimed
as fixed here. CI supplies the terminal full matrix.

## Deliberate limits

- Viewport changes use `Emulation.setDeviceMetricsOverride`; the recorded CSS
  viewport is what is asserted, not a native BrowserWindow resize. Native-window
  resize and process-restart persistence belong to independent QA's matrix.
- Loading, empty, offline/error and broader persistence flows are independent QA
  coverage, not claimed by this populated implementer scene.
- No duplicate full local desktop suite was run; CI supplies the terminal full
  matrix. `pnpm check-changed` and CI results are reported on the PR separately.
- These are headless built-Electron captures, not Storybook, a second browser
  stack, or screenshots of the operator's app/data.
