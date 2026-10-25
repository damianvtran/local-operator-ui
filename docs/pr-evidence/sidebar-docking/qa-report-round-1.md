### QA report — round 1

Reviewer: qa-tester (openrouter/moonshotai/kimi-k3.1-pro)
Scope: 2eaf19928b2b7b26c67b690fbe2a013308584d63..6f2fb31ff81332c64a7be7c19396c7e594870581
Head: 6f2fb31ff81332c64a7be7c19396c7e594870581
Verdict: **PASS — clean/terminal for independent real-path QA.** No product Q-findings and no final FAIL/BLOCKED path in the coverage below. The separate red CI gate is reported verbatim at the end; it is not being marked passed.

#### Environment and method

Read issue #1077 (including triage), the PR body, and both existing PR comment endpoints before judging; there are no inline review comments or submitted reviews. Used a clean detached worktree at the exact head, byte-identical lockfile/shared dependency tree, and a fresh bounded `pnpm build`. Source and built-artifact hashes are recorded. QA did not edit the repository.

- Darwin arm64; built app `0.41.2`; Electron `44.3.0`; real `out/main/index.jsc` / preload / renderer.
- Headless native window remained `visible=false`, `focused=false`; viewport DPR 2.
- Native sizing used the already-launched main-process inspector to call real `BrowserWindow.setContentSize`; native bounds, main facts and CSS viewport all moved together. **No `Emulation.setDeviceMetricsOverride` was used.** Element-focus emulation was used only for the keyboard walk.
- Isolated HOME/TMPDIR/config/profile/log roots, synthetic OAuth placeholders/token and IDs, stripped CMUX/LOP/XPC state, telemetry/notifications off.
- Owned mock daemon: `local-operator serve --host 127.0.0.1 --port 18080 --hosting test --model mock-model`. Health was 200; its serve record matched the exact owned PID. The scoped `lsof` audit over the Electron process tree found established connections to 18080 and **zero connections to operator port 1111**.
- Commands:

```bash
QA_RUN_ID=native-3 python3 ~/local-operator/scripts/run_bounded.py \
  --timeout 900 --memory-mb 4096 -- bash "$LOCAL_OPERATOR_SCRATCHPAD/issue-1077-qa/run-native-qa.sh"
QA_ONLY_EMPTY=1 QA_RUN_ID=native-empty-5 python3 ~/local-operator/scripts/run_bounded.py \
  --timeout 300 --memory-mb 4096 -- bash "$LOCAL_OPERATOR_SCRATCHPAD/issue-1077-qa/run-native-qa.sh"
QA_ONLY_KEYBOARD=1 QA_RUN_ID=native-keyboard-6 python3 ~/local-operator/scripts/run_bounded.py \
  --timeout 300 --memory-mb 4096 -- bash "$LOCAL_OPERATOR_SCRATCHPAD/issue-1077-qa/run-native-qa.sh"
```

`native-3` executed the comprehensive matrix; its 102 non-empty cases all passed. Its one empty-case FAIL was a superseded QA predicate, not relabelled green: the predicate first assumed a fresh daemon had no auto-provisioned rows and then used `sessionCount`, which intentionally retains archived rows. `native-empty-5` is the discriminating empty-only rerun and exited 0. `native-keyboard-6` is the keyboard-only supplement adding post-activation `activeElement` and next-Tab targets and exited 0. No application code changed between those runs. Earlier harness iterations remain in scratch for audit but are not claimed as product failures.

#### Surface-by-surface actual results

| Surface | Real command / mechanism | ACTUAL output | Verdict |
|---|---|---|---|
| Built identity + populated fixture | Fresh `pnpm build`; `POST /v1/desktop/sessions`; `POST .../messages`; poll `GET .../history` | create=200, message=200, history=200; rendered both `Synthetic sidebar docking question` and `Hello from the mock provider`; built UA contains Electron 44.3.0 | PASS |
| Expanded native resize | `BrowserWindow.setContentSize(1380x900 -> 1023x900 -> 1380x900)` | At 1380: sidebar 320, chat 1016, rail 44. At 1023: sidebar 320, chat 659, rail 44. `collapsed=false`, stored width 320; no forced strip at the old breakpoint | PASS |
| Collapsed preference at narrow widths | Real collapse, then native resize to 1023 and 800 | At 1023: sidebar 56, chat 923, rail 44. At 800: sidebar 56, chat 700, rail 44. `collapsed=true`, stored width 320; resize did not reopen it | PASS |
| Stored 320 at 800 + wide restoration | Pointer-expand at native 800, inspect localStorage/DOM, then native 1380 | At 800: **276 + 480 + 44 = 800**; document/body scrollWidth=clientWidth=800; stored width remains **320**. At 1380 dock returns to 320. No horizontal overflow | PASS |
| Bare key and modifier negative controls | CDP `Input.dispatchKeyEvent` down/up | Bare `b` (modifiers 0): `defaultPrevented=false`, no toggle. Ctrl+Shift+B (modifiers 10, ctrl+shift): `defaultPrevented=false`, no toggle | PASS |
| Real Ctrl+B | KeyB, modifiers 2 | Trace has `ctrlKey=true`, `metaKey=false`, `defaultPrevented=true`. Two chords at native 1023 toggled `collapsed=false -> true -> false`, 320 dock -> 56 strip -> 320 dock; sheet/dialog counts 0 | PASS |
| Real Cmd+B | KeyB, modifiers 4 | Trace has `metaKey=true`, `ctrlKey=false`, `defaultPrevented=true`. Two chords toggled `collapsed=false -> true -> false`; sheet/dialog counts 0 | PASS |
| Pointer controls + accessible targets | CDP mouse move/down/up at each control's centre; capture `pointerdown.composedPath()` | **Collapse sidebar**: BUTTON, `aria-expanded=true`, rect **28x28**, pointer path starts at that BUTTON. **Expand sidebar**: BUTTON, `aria-expanded=false`, rect **32x32**, path `svg -> SPAN -> BUTTON`. Both toggled preference; no sheet/dialog | PASS |
| Process-restart persistence | Exact-PID SIGTERM/relaunch with the same isolated profile, twice | Collapsed restart at 1023: strip 56, `collapsed=true`, width 320. Expanded restart at 1380: dock 320, `collapsed=false`, width 320. Post-restart 800 still draws 276 without rewriting 320. App exits were code 0 | PASS |
| Tab / Shift+Tab / Enter / Space | Real key events + `activeElement` after every step; full trace below | Forward and backward order reached both controls; Enter collapsed and Space expanded. Post-activation focus and viable next Tab targets recorded; no keyboard trap or sheet | PASS |
| Settled canvas fit-yield | Open real canvas, capture consecutive app-owned PNGs until pixel-stable, **then** read DOM rects | Settled native 1023 geometry: **sidebar 56 + chat 480 + canvas 443 + rail 44 = 1023**. `canvasMode=docked`, `collapsed=false`, stored width 320. Real canvas rail close restores dock 320/chat 659 | PASS |
| Settled ask fit-yield + empty drawer | Real ask rail item; stable capture then DOM read | Settled native 1023 geometry: **sidebar 56 + chat 480 + ask 443 + rail 44 = 1023**. `askMode=docked`, `collapsed=false`, width 320. Text: `This conversation · All asks settled` / `No asks outstanding. The agent is not waiting on anything.` Close restores dock 320 | PASS |
| Agents 1000/392 boundary (code review R-1) | Navigate real reusable-profile route `/agents?name=coder` at native 1000 | Sidebar x0/w320; roster x320/w288; detail x608/w392; no chat rail. Textarea rect 312x55, clientWidth 304; **`scrollHeight == clientHeight == 55`**. Placeholder `Ask for a change, or describe something new…` measures **301.1709px** in the 304px content box. No clipping observed | PASS |
| True empty catalogue + empty conversation, dark/light | Archive only the two auto-created synthetic rows via real API; verify daemon listing zero; reload same renderer | Archive responses 200/200; daemon remaining=0. Renderer: `countsTotal=0`, zero rendered session rows, `Showing 0 of 0 chats` (two archived records intentionally retained internally). Stable dark/light frames captured | PASS |
| Loading, dark/light | SIGSTOP only owned daemon, `Page.reload`, then SIGCONT in `finally` | Actual pending/fetching queries included `desktop.capabilities`, `config`, `radient-prices`, `desktop.asks`; UI showed `Connecting to chats…`, `Connecting to the backend… Your conversation is safe.`, `Retry`. Dock stayed 320 at 1023. Resume restored the populated mock transcript | PASS |
| Offline/error, dark/light | SIGTERM owned daemon, `Page.reload` | Real `desktop.capabilities` error and Retry UI: `The app waits up to 20 seconds for this read, and it was still running when the app stopped waiting. Nothing was read; ask again.` Dock stayed 320; document width 1023, no overflow. Dark/light frames captured | PASS |
| Console/network/process hygiene | CDP Runtime/Log/Network listeners; exact-PID teardown; `ps`/`lsof` | All three comprehensive-run boots and both supplement boots: console errors 0, renderer `Network.loadingFailed` 0, Runtime exceptions 0, renderer-domain HTTP >=400 responses 0, Log errors 0. Main-transport query errors are separately shown above. Port 18080 closed; run-owned process leftovers 0; QA worktree clean | PASS |

#### Keyboard `activeElement` / focus-order evidence

At native 1023 with element-focus emulation enabled while the native window stayed hidden/unfocused:

```text
Expanded walk:
BODY
  -> Tab 1 Model: test/mock-model
  -> Tab 2 Active time
  -> Tab 3 Attach file
  -> Tab 4 Working directory
  -> Tab 5 Run details
  -> Tab 6 Collapse sidebar (BUTTON, 28x28)
  -> Shift+Tab Run details
  -> Tab Collapse sidebar
  -> Enter
After Enter: activeElement=BODY.
Next Tab: activeElement=BUTTON "Expand sidebar" (32x32, tabIndex=0); layout=56px strip.

Collapsed walk (full 34-stop trace is in native-keyboard-6/native-qa-results.json):
BODY -> New chat -> Search -> Aida -> Library -> Projects -> Agents
  -> Schedules -> Browser -> More destinations -> Settings -> Account settings
  -> Rename conversation -> Agent -> Team -> device/recall control
  -> Conversation actions -> Jump to your message -> Conversation -> Your message
  -> Copy -> Fork -> Agent message -> Copy -> speak-aloud status -> Fork
  -> Message -> Model -> Context -> pricing status -> Active time -> Attach file
  -> Working directory -> Run details (Tab 33) -> Expand sidebar (Tab 34)
  -> Shift+Tab Run details -> Tab Expand sidebar -> Space
After Space: activeElement=BODY.
Next Tab: activeElement=BUTTON "Search chats and agents" (28x28, tabIndex=0); layout=320px dock.
```

The frames show the resulting focus rings on `Expand sidebar` and `Search chats and agents`; neither activation opened a sheet/dialog.

#### Evidence paths

Root: `$LOCAL_OPERATOR_SCRATCHPAD/issue-1077-qa/`

- `test-plan.md`; `source-identity.txt`; `build-identity.txt`; `renderer-asset-hashes.txt`; `build.log`.
- Comprehensive matrix: `native-3/native-qa-run.log`, `native-3/native-qa-results.json`, `native-3/frames/` (21 PNGs, including 800 dark/light, canvas/ask yield/restored, restart, agents and state frames).
- True-empty rerun: `native-empty-5/native-qa-run.log`, `native-empty-5/native-qa-results.json`, `native-empty-5/frames/empty-catalogue-chat-{dark,light}.png`.
- Keyboard supplement: `native-keyboard-6/native-qa-run.log`, `native-keyboard-6/native-qa-results.json`, `native-keyboard-6/frames/keyboard-{enter-collapsed,space-expanded}-dark.png`.
- Visually inspected contact sheets: `contact-layout.png`, `contact-states.png`, `contact-keyboard.png`; the two new keyboard-6 PNGs were also inspected full-size.
- Failed CI log: `npx-macos-failure.log`.

#### CI observation — still red, not a QA pass

At the same head, `NPX Sanity Check (macos-latest)` is red ([job 120705693795](https://github.com/damianvtran/local-operator-ui/actions/runs/40037994848/job/120705693795)); every other executed check passed. Runtime Dependencies, Evidence Structure and Security Audit were SKIPPED and are not counted as passes. The failed job's actual log reaches `rendering chunks...`, then:

```text
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
Abort trap: 6           npm pack
##[error]Process completed with exit code 134.
```

The Ubuntu NPX check, Desktop Tests shards, Bytecode Build Check, type checking, lint, language coverage, Change Scope and Version Bump Guard passed. This QA round does not retry or duplicate CI and does not claim the merge-time CI gate is green. The macOS NPX OOM must be rerun or remediated before merge.
