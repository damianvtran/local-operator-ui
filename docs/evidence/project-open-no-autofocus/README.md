# The project page opens at the top: the quick-send strip no longer autofocuses

The operator's report (2026-10-08), verbatim: *"when clicking into a project,
because of the standard behaviour of the composer, it scrolls the user down to
centre on the composer and focuses it. For projects the composer is an optional
interaction, not the primary one ... on the projects page it shouldn't
[autofocus], and we should stay scrolled at the top when clicking in."*

The root cause, pinned to the base tree this set's `before/` half was captured
on (`origin/main` @ `15a7a4ed522`, v0.33.5): the project page's "Send to" strip
(`src/renderer/src/features/projects/components/project-quick-send.tsx`, mounted
by `project-links.tsx`) mounts the shared `MessageInput`, whose mount-time
effect at `src/renderer/src/shared/components/composer/message-input.tsx:5926`
calls a plain `textareaRef.current?.focus()`. A plain focus runs the focusing
steps' scroll - the element is scrolled into view, centred - so the detail page,
whose scroller is the `overflow-y-auto` region in `projects-page.tsx` (~line
625), lands scrolled down with the strip in view, the box centred in the
scroller's port, and its accent outline showing (measured: the focused
textarea's centre lands on the port's own centre, 466.2 vs 466).
The head tree (PR #902) gives `MessageInput` a documented `autoFocus` prop (the
strip passes it off; chat, mini and the agents page keep today's behaviour) and
the composer's own self-initiated focus passes `{ preventScroll: true }`.

## The pair

Twelve frames from `scripts/renderer-driver.mjs`'s `project-open` scene,
photographed through the app's own `capturePage()` in the `headless` window mode
at a 1380x900 window, run four times - one launch per palette per tree:

| tree | flag | committed frames | what the half records |
| --- | --- | --- | --- |
| `before/` | `--autofocus-expect jump` | `first-dark`, `first-light`, `settled-dark`, `settled-light`, `typed-dark`, `chat-focus-dark` | the defect: the page lands scrolled down with the box focused and in view |
| `after/` | `--autofocus-expect stay` | the same six | the claim: scrollTop 0, unfocused, the strip below the fold |

The SAME scene bytes drive both halves - the base tree is `origin/main` + this
scene commit, the head tree is PR #902's head + the same commit rebased onto it
- so the pair's difference is the app and never the rig. A run that disagrees
with its flag fails by name: the four runs are `jump` on `before/` and `stay` on
`after/`, and each printed `ALL CHECKS PASSED`.

The two control frames (`typed-*`, `chat-focus-*`) are committed in
`localOperatorDark` only: they are the same two interaction claims on both
trees, and an interaction is not a palette claim (the precedent is
`ask-options-live`, "this is a wire-and-interaction proof, not a palette
proof"). The light pass ran every check identically - its raw log and sampler
trace are committed beside the frames (`before-light-run.log`,
`after-light-run.log`).

## The run, exactly

```sh
# 1. the app, built against the backend this pass owns. `build:npm` is the
#    config's own npm-publish mode: this machine's provisioned node_modules
#    cannot resolve the Babel plugin the local V8-bytecode step wants
#    (ERR_PNPM_IGNORED_BUILDS territory), no frame here is about bytecode, and
#    the bytecode step only compiles main/preload - the renderer bundle is the
#    same build either way (`ask-composer-surfaces/` and `sidebar-remote/` used
#    the same entry point for the same reason).
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build:npm

# 2. the daemon: a scratch config root and a scratch agent home, the HOSTING
#    written into the config first (a fresh root holds none, and every turn
#    dies in `HostingNotConfiguredError` without it - docs/agent-driver.md), a
#    fresh bearer, and every CMUX_*/LOP_* variable stripped from its
#    environment (an inherited workspace id has renamed the operator's real
#    cmux workspaces). HOME itself is NOT redirected: the stores this daemon
#    writes all resolve through LOCAL_OPERATOR_CONFIG_DIR (config, logs, the
#    catalogue cache, run records, projects, sessions) and LOCAL_OPERATOR_HOME
#    (the agent home), and a scratch HOME is exactly the state in which macOS
#    asks to CREATE a login keychain - a dialog that belongs on nobody's
#    screen. The operator's own daemon on 1111 was never touched or connected
#    to; the app's CSP admits only 8080/1111, so this pass's daemon is on 8080
#    and the driver asserts the app reached it and NOT 1111.
mkdir -p "$ROOT" "$ROOT/agent-home"
printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$ROOT/config.yml"
openssl rand -hex 32 > token.hex
env -u CMUX_WORKSPACE_ID -u CMUX_SESSION_ID ...   # every CMUX_*/LOP_* present
  LOCAL_OPERATOR_CONFIG_DIR="$ROOT" \
  LOCAL_OPERATOR_HOME="$ROOT/agent-home" \
  LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
  local-operator serve --port 8080 --hosting test --model mock-model

# 3. the seed - run before EACH palette pass; it resets the row first:
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
  python3 docs/evidence/project-open-no-autofocus/seed.py

# 4. the scene, once per palette, with the claim this half names:
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
node scripts/renderer-driver.mjs --scene project-open \
  --autofocus-expect jump \
  --backend http://127.0.0.1:8080 \
  --backend-records "$ROOT/run/serve" \
  --project rig-open \
  --theme localOperatorDark \
  --seed-onboarding-complete --window-size 1380x900 \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/frames-before-dark" --clean
# ... and again with --theme localOperatorLight (the seed re-run first, though
# the seed is re-runnable anyway: it DELETEs by name and re-creates).

# 5. reap the daemon BY EXACT PID (never by name - other lanes run the same
#    program), then check the port is free.
```

The four raw logs and four sampler traces sit beside the frames
(`before-dark-run.log`, `before-light-run.log`, `after-dark-run.log`,
`after-light-run.log`, and the `*-sampler.json` files). The daemon roots were
`$LOCAL_OPERATOR_SCRATCHPAD/project-open-before/daemon` (daemon pid 97007) and
`.../project-open-after/daemon` (pid 22132); both were reaped by exact pid after
their half's scans, and no process carrying either scratch tag survived.

## The seed

`seed.py` sits beside this README (committed): it resets and re-creates
`rig-open` with four milestones, three multi-line progress updates and two
linked sessions - tall enough (scrollHeight 1784px) that the quick-send strip
starts below the fold at scrollTop 0. That height is the defect's own
precondition: a plain `focus()` only scrolls when there is somewhere to scroll,
so the scene PRECONDITION-checks `cardNaturalTop (1046.2) >= clientHeight (868)`
and fails by name, with the page's own scrollHeight, rather than photographing
a vacuous pair. The seed is re-runnable: it DELETEs the row first (`confirm`
echoing the name) and every distinct progress write appends ONE history entry
(`ProjectRegistry.update_project`), so the three updates are three feed rows on
every pass. It printed, on each of the four runs:

```
project: rig-open
milestones: ['seed the project', 'stand the daemon up', 'photograph both halves', 'fold the evidence in']
updates: 3
linked sessions: ['<id>', '<id>']      # two fresh sessions per pass; the ids differ per run
```

## The checks, as the runs printed them

Each run's count and verdict line, from the committed logs:

| run | verdict |
| --- | --- |
| `before/before-dark-run.log` (jump) | **35 PASS / 0 FAIL**, `ALL CHECKS PASSED` |
| `before/before-light-run.log` (jump) | **35 PASS / 0 FAIL**, `ALL CHECKS PASSED` |
| `after/after-dark-run.log` (stay) | **37 PASS / 0 FAIL**, `ALL CHECKS PASSED` |
| `after/after-light-run.log` (stay) | **37 PASS / 0 FAIL**, `ALL CHECKS PASSED` |

(The `stay` branch carries two extra checks - re-entry from the list and the
return from the chat are asserts there and recorded notes on `jump`.)

The load-bearing lines, quoted from the dark runs (the light runs print the
same, with `local-operator-light` in the frame names):

```
before: [PASS] the strip starts below the fold at scrollTop 0 (the defect's precondition)
before: [PASS] the page lands scrolled down with the box in view and focused (the defect this half records)
before: [PASS] the settled page still shows the moved state (base)
before: [PASS] the sampler saw the page move off the top
after:  [PASS] the page opens at scrollTop 0 with the box unfocused (the change's claim, first frame)
after:  [PASS] the sampler records no movement at all: every sampled frame sits at scrollTop 0
after:  [PASS] the settled page is still at the top, unfocused, with the strip under the fold
after:  [PASS] re-entering from the list opens at the top with the box unfocused (stay)
after:  [PASS] returning from the chat leaves the project page at the top, unfocused (stay)
both:   [PASS] switching the target neither moves the page nor hands the box the keyboard
both:   [PASS] a real pointer press puts the caret in the strip's box
both:   [PASS] the typed message lands in the box that took the caret
both:   [PASS] a pointer press of Send admits the message into the linked session's transcript (daemon read)
both:   [PASS] the press hands the keyboard back to the box
both:   [PASS] the refocus leaves the page where the reader left it
both:   [PASS] opening a conversation still puts the caret in the chat's composer (the control this change must not move)
both:   [PASS] no process from this run outlived its boot
```

The Send assertion is the DAEMON's, not the DOM's: the message is read back
through `sessions/{id}/history` with the run's own bearer, and every run's check
reported `delivered (read back on attempt 1)` with a message text unique per
run (`Rig check: report the page position. [mv02w710]` was the head-dark one).
A painted optimistic echo would prove nothing on its own, which is why the read
is the check and the frame is the UI half.

## The geometry, before vs after

The numbers each run printed, in CSS pixels, dark palette (light identical within
0.1px); `natural` is each element's position inside the scroller's content at
scrollTop 0:

| reading | before (jump) | after (stay) |
| --- | --- | --- |
| scroller scrollTop, first frame | **705** | **0** |
| scroller scrollTop, settled | 705 | 0 |
| sampler max(scrollTop) over the window | 705 | 0 |
| first non-zero scrollTop | t=349ms of the sampler window (light 105ms) | never |
| scroller clientHeight / scrollHeight | 868 / 1784 | 868 / 1784 |
| strip card box (viewport), first | 373.2..571.2 (198px tall) | 1078.2..1276.2 |
| textarea box (viewport), first | 449.2..483.2 (34px tall) | 1154.2..1188.2 |
| strip natural top / textarea natural top | 1046.2 / 1122.2 | 1046.2 / 1122.2 |
| `document.activeElement` | `textarea "Message"` | `body` |
| `textarea.matches(":focus")` | true | false |
| re-entry from the list (scrollTop) | 705 | 0 |
| after `history.back()` from the chat (scrollTop) | 705 | 0 |
| chat composer focused on open | yes | yes |

The page's own viewport reads **1380x900 at dpr 2** in this headless mode (the
run's window-mode line prints `size=1380x900 content=1380x900`; a hidden window
carries no chrome, and the frames are 2760x1800). The scroller's port is 868 of
those 900 because the shell's 32px header owns the rest - the strip's natural
top, 1046, is 178px below that port, which is why a plain `focus()` has 705px
to scroll and takes them.

## The sampler

Each run installs a `requestAnimationFrame` sampler before the row press that
records, per frame and only on change, `{t, scrollTop, activeElement, stripTop}`
(the scroller is found by walking up from the strip to the nearest ancestor
whose computed `overflow-y` is auto/scroll, never by class). Its window runs to
2.5s after the strip first appears, bounded at 6s. Headline:

| run | trace |
| --- | --- |
| `before/before-dark-sampler.json` | `sawStrip` at t=349ms; the very next sample is `scrollTop 705`, `activeElement "textarea \"Message\""` - the jump and the caret land in the frame the strip appears; max 705, 4 samples, `stopped` |
| `before/before-light-sampler.json` | same shape: strip at t=105ms, first non-zero scrollTop at t=105ms (705), max 705, 4 samples |
| `after/after-dark-sampler.json` | strip at t=84ms; max scrollTop **0**, first non-zero **never**, 2 samples (the pre-press frame and the strip's arrival) |
| `after/after-light-sampler.json` | strip at t=95ms; max 0, first non-zero never, 4 samples |

On the base tree there is no frame that shows the strip at scrollTop 0: the
focus call runs in the mount effect and the first sampled frame that contains
the strip already has the page at 705. On the head tree every sample with a
scroller reads 0.

## What each frame shows

| Frame | What I saw in it |
| --- | --- |
| `before/first-dark.png`, `before/first-light.png` | the detail page scrolled down 705px: the milestone rows and "New milestone" form at the top of the view, the two linked session rows, the "Send to" strip in view with the composer's box centred in the scroller's port and FOCUSED - accent outline on the card, caret in the box, placeholder "Message the session - paste an image to attach it". This is the operator's report, reproduced. |
| `before/settled-dark.png`, `before/settled-light.png` | the same state after the settle window (the run asserts `stable=true`): the page never returns to the top on its own |
| `before/typed-dark.png` | after the user's own wheel gesture to the strip, a pointer press in the box and a typed message: the text sits in the focused box, the Send control armed, the "Send to" target switched to the run's second linked session (the dark run's frame reads `c1d73f07954d`) - the strip still works on the old tree |
| `before/chat-focus-dark.png` | the linked session's conversation, carrying the delivered message and the mock provider's answer, with the CHAT composer focused (accent outline, caret) - the control |
| `after/first-dark.png`, `after/first-light.png` | the detail page at the TOP: "All projects", "Rig open" with the Active chip and the `rig-open` key, the description, the Properties block, the four milestones, "0 of 4 complete" - no composer in view, nothing focused |
| `after/settled-dark.png`, `after/settled-light.png` | the same top-of-page state, held (`stable=true`) - nothing scrolls it later |
| `after/typed-dark.png` | the strip reached by the same wheel gesture, the box pressed and typed, target switched, Send armed - the page at that scroll position because the USER scrolled it, which is the whole difference from the `before/` twin |
| `after/chat-focus-dark.png` | the chat with the delivered message and the mock answer, chat composer focused - unchanged on the new tree |

## What these frames cannot show

- **They are headless captures.** The window is never shown and never focused
  (every run asserts `visible=false focused=false`, and the driver's window-mode
  affordances are banned by `scripts/window-mode.test.mjs`). What a frame shows
  is the app's own rendering, not what an OS-activated window would look like.
- **The `:focus` rings are real but emulated.** A window that is never shown
  cannot be focused, so each run turns on CDP
  `Emulation.setFocusEmulationEnabled` and says so in its log and here
  (`document.hasFocus()=true` was read back and checked in every run). The
  outline in the frames is the app's own focus styling, driven by element focus
  - not the product of a focused OS window. Consequences a still cannot carry:
  the caret's blink phase, and any OS-level focus effect outside the page.
- **A still cannot carry the scroll.** The scrollTop numbers and the sampler
  traces are the readings; the frames are the pixels beside them.
- **The unit suite carries the rest.** The prop's contract, the strip's opt-out
  and the chat path are pinned by the PR's TypeScript/unit tests; these frames
  carry the live-app behaviour that jsdom cannot render (layout, real scrolling,
  a real Radix select, a real send through the daemon).
- The two palettes cover the brand's light and dark ground; a user's third-party
  theme is not photographed here.

## Isolation, focus emulation, and the reap

- **The daemon** was this pass's own (`LOCAL_OPERATOR_CONFIG_DIR` and
  `LOCAL_OPERATOR_HOME` both inside the pass's scratchpad; every `CMUX_*`/`LOP_*`
  variable stripped from its environment), on port 8080 - free when each half
  started (the after half waited ~0s; the before half waited out another lane's
  stub daemon rather than touching it). The operator's own daemon on 1111 was
  never connected to: every run printed `[PASS] the app holds a connection to
  this run's backend (http://127.0.0.1:8080)` and `[PASS] the app holds NO
  connection to the operator's own backend (http://localhost:1111)`.
- **No keychain prompt was armed.** The daemon ran under the operator's real
  HOME with its stores redirected (see the run section), so nothing under a
  scratch HOME reached Security Services; the app launch carries
  `--use-mock-keychain` (the driver's own switch, taken from
  `scripts/chrome-keychain.mjs`), so OSCrypt never asks macOS to create a login
  keychain. The desktop serve path carries no keychain call sites at all - the
  runtime's only `security find-generic-password` is the mobile auth store,
  which `local-operator serve` never imports.
- **The app** ran with the driver's scratch profile (`HOME`, config, profile all
  under the driver's own scratch tree, removed by `--clean`), and each run's
  last check is the driver's own `no process from this run outlived its boot` -
  PASS in all four.
- **The daemons were reaped by exact pid** (97007 and 22132) and the port was
  re-checked free afterwards; no process from either pass remained
  (`ps` shows nothing matching either scratch root). The frames' own pipeline
  wrote nothing outside the pass's scratchpad and this evidence directory.
