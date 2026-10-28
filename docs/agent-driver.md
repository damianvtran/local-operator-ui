# Driving the app's renderer from an agent run

An agent could read this app's JSX and could not see it run. The `browser` tool
drives the operator's own browser and cannot enter an Electron renderer, and
loading the renderer under a bare Vite server dies immediately at
`Cannot read properties of undefined (reading 'ipcRenderer')` because `App`
assumes its preload bridge (`src/renderer/src/app.tsx:102`). Two review rounds
followed from that: a UX round for a browser-chrome change was recorded as
blocked because nobody could walk the flow, and a design round could only argue
from the source.

This is the supported way through, and it is deliberately built out of the app's
own mechanisms:

- the **built app**, launched by its own Electron and driven in the documented
  `headless` window mode (`src/main/window-mode.ts`);
- an **opt-in dev-driver bridge** (`src/main/dev-driver.ts`,
  `src/preload/dev-driver.ts`, `src/renderer/src/dev-driver/install.ts`) whose
  verbs are the app's own code paths — stores, the hash router, DOM controls;
- **`webContents.capturePage()`** for the pixels, so every frame is the app
  photographing itself.

No browser engine is installed or scripted for any of this: no Playwright, no
Puppeteer, no downloaded Chromium, and no macOS `screencapture` (which
photographs the frontmost window and would require exactly the focus theft the
window modes exist to remove).

## The commands

```bash
pnpm build                                          # the harness drives the BUILT app
node scripts/renderer-driver.mjs --scene states --out /tmp/frames
node scripts/renderer-driver.mjs --gate-check       # proves the gate fails closed
```

`pnpm app:driver` and `pnpm app:driver:gate-check` are the same two commands.
`--scene states` (the default) writes a before/after pair of one screen plus a
real control press; `--scene palette` does the same for the command palette,
driving it the way it is actually opened (a pointer sequence on the rail's
Search row) and typing into it through CDP's own input pipeline; `--scene
new-chat` drives the app-wide `⌘N` with a real CDP key chord
(`Input.dispatchKeyEvent`). It asserts whichever claim the run is in: with
`--backend`, the feature — a fresh draft staged and the app on the chat route,
plus the two presses that are deliberately not it (`⌘⇧N`, a bare `n`); without,
the gate — the same press changing nothing, because the shortcut takes the New
chat row's own `session_catalogue` gate and a driver run has no backend.
**`--scene stale-team-draft` photographs the team New-chat defect (2026-10-22):**
a page whose header says "New chat with <team>" while the body says the
conversation is gone. It seeds the persisted pair that produces it — the team's
stable `draft:team:<name>` row carrying the `sessionId` its create wrote,
`activeDraftKey` naming that row, and a tombstone for the id — then reloads and
asserts the three things one click must end with: no missing-session notice, an
editable composer, and the dead pointer retired before the first paint. It needs
`--backend`, because the composer it measures replaces the capability refusal a
backend-less run paints. The press itself is the store's own rule and is driven
by `scripts/team-new-chat-stale-draft.test.mjs`; a run-owned daemon has no
authored team for the sidebar to list. Its before/after pair is committed under
`docs/pr-evidence/team-new-chat-stale-draft/`.

**`--scene team-newchat` photographs TWO team New-chat defects, in four
modes.** (2026-10-23). *Draft modes:* a REPLAYED draft receipt. The stable team
row's `draftRequestId` persists across launches, and a daemon that restarted (or
a draft that expired) replays the id it minted the first time — an id its
registry no longer serves. The pane streams on `sessionId ?? draft.warmId`, so
its bridge 404s; the base tree read that as a missing conversation and painted
"This conversation is no longer on this machine" under a header that says "New
chat with <team>". The scene seeds the operator's persisted row (a stable
`draft:team:<name>` with the request id, no `sessionId`), reloads, types a single
`C` through CDP's input pipeline, and reports the route, the header, the notice,
the composer, the row's own state and the id the daemon answered for the seeded
request. `--expect broken` (the base tree) asserts the notice appeared, the row
still holds the request id, and an in-page probe catches the notice being painted
and the box refused; `--expect fresh` (the fix) asserts no notice, the `C` still
in an editable box with the caret, a re-minted request id, and a first send that
reaches the transcript with the entered-to-rendered milliseconds reported. It
also installs the probe over the 404 → retire → next-mint window (DOM mutations,
animation frames and the store's own persisted writes) and holds the first frame
after the answer beside the settled one, so "no notice" is a statement about the
window rather than about one screenshot. `--expect immediate` races a send into
that window and reports the outcome. *Carry mode:* `--expect carry` drives a
GENUINELY missing conversation (a real route to a 12-hex id the daemon does not
serve) whose composer holds text and a chip, presses the notice's own
**Start a new chat** (keyboard first, pointer fallback, both reported), and reads
back the new chat's route, composer, caret, chip and the dead identity's row;
then it reloads to prove the way out survives and sends the carried text once.
The draft modes need `--backend`, `--backend-records`, `--team <name>`,
`--draft-request-id <uuid>` and `--seed-onboarding-complete`; `carry` needs the
same except the receipt, and the daemon's 404 in the draft modes must be real:
the precondition minted the receipt, materialised a conversation on it, deleted
that conversation and restarted the daemon.

`--scene none` boots and arms the driver without running a
scene. `--window-size WxH` sets the window (default 1380x900, the app's own
default). The scratch tree is kept and its path printed; `--clean` removes it,
`--out <dir>` puts frames somewhere you choose.

**`--scene sidebar-docking` exercises #1077 against a populated synthetic
conversation on an isolated daemon.** It drives the real Cmd/Ctrl+B chord and
the strip/dock pointer controls through CDP at 1380, 1023 and 800 CSS px, checks
the persisted preference and the absence of a sheet, and reads sidebar/chat/rail
boxes plus document overflow. At 800 with a stored 320px width the drawn dock is
capped to 276px so the 480px chat floor and 44px rail still fit; widening
restores 320 without rewriting storage. It also checks the separate canvas
fit-yield and captures settled dark/light frames. The base tree is the negative
control: the same scene records its forced strip and overlay failures before the
head-only matrix continues. Viewport changes use `Emulation.setDeviceMetricsOverride`,
so the recorded CSS viewport is the asserted size; native-window resize and
process-restart persistence are independent QA's lanes. The scene requires
`--backend`, `--backend-records`, `--session <id>`,
`--seed-onboarding-complete`, and the mock transcript marker named in
`scripts/sidebar-docking-scene.mjs`.

**`--scene attach` presses the composer's paperclip and proves what it stages
(`--attach <absolute-path>`, repeatable).** The attach path is `handleAttachFile`
-> `show-open-dialog` -> `addAttachment`; the one step a headless CDP scene cannot
perform is the native picker's answer, so an armed launch that was given
`--attach` has main return those queued paths from `show-open-dialog`
(`src/main/dev-driver-attach.ts`) and **only that answer is replaced** — the
press, the IPC round trip, the store write and the rendered chips are the app's
own. The scene opens a conversation on its own daemon, presses
`[data-tour-tag="chat-input-attach-file-button"]`, and asserts: the persisted
`conversation-input-store` row holds exactly the paths given, in order; one
`[data-attachment-id]` chip is on screen per path; the row carries the pending
caption; and the app log names the queue-answered dialog. It does not prove that
the OS picker opens or that a person can choose a file through it — say so beside
the frame rather than implying it. `--attach` is refused for a relative path, and
the queue is read only when the dev-driver bridge is armed.

**`--attach-prompt "<text>"` sends after staging, so the scene proves the
paperclip reaches an answer.** The prompt is typed into the composer's real field
and the real `Send message` control is pressed; the run then waits for the
daemon's own transcript (not the painted echo) to carry the prompt as a user row.
It waits for the turn to SETTLE - the snapshot's `streaming` and
`last_turn_outcome`, not the first assistant row with text, which a tool-using
turn can emit mid-turn - then reports the session id, the row's `document`
block(s) and the settled final text, and asserts that each staged file arrived
as a document block and that the assistant turn completed. `--attach-expect-answer "<substring>"` adds a
substring check on that final text. This path needs a daemon that serves
`POST /v1/desktop/attachments` **and** a provider that can answer; a daemon
without either is refused by the send, and the scene reports that refusal rather
than a staged-only pass.

```bash
pnpm build
node scripts/renderer-driver.mjs --scene attach \
  --backend http://127.0.0.1:<port> --attach /abs/path/report.pdf \
  --seed-onboarding-complete --out /tmp/frames

# the answer path QA runs
node scripts/renderer-driver.mjs --scene attach \
  --backend http://127.0.0.1:<port> --attach /abs/path/report.pdf \
  --attach-prompt "Summarise this PDF in one line." \
  --attach-expect-answer "<expected substring>" \
  --seed-onboarding-complete --out /tmp/frames
```
**`--scene authoring-refresh` is the one scene whose write comes from OUTSIDE the
app.** Its subject is an agent creating a team or a profile on the backend, so
the write is an HTTP request from this script's own Node process to the
backend's authoring route — never a press, never a navigation, never
`window.api` — and what it measures is whether the sidebar's Agents/Teams lists
notice it with nobody touching the window. `--authoring-expect refresh` (the
default) runs against a backend whose feed publishes `authoring` frames; `stale`
runs against one that publishes none (the installed runtime, i.e. the
base-commit behaviour), where the row must NOT arrive and the lists must NOT be
re-read until the app is remounted. It needs `--backend` plus the token in this
script's environment, and the renderer built against the same URL, like every
other `--backend` scene. Its two runs and their readings are committed as
`docs/evidence/authoring-refresh/`.

**`--scene project-detail` (`--project <key>` names the row) is the live half of
the Projects tab's detail page.** It needs `--backend` — the isolated daemon the
lane owns, hosted the way the note below requires — and a seeded project:
`--project` names the row's key, and the scene fails loudly when the row (or its
linked session) is absent rather than photographing an empty page. It exercises
the two acts a Storybook state cannot: a message typed into the quick-send strip,
admitted through the chat's own `admitChatDraft`, and read back from the
daemon's `history` route — and the start-session picker creating a session,
auto-linking it, and landing on that session's chat with a PRE-FILLED, unsent
prompt. Its six frames per palette are committed under
`docs/evidence/project-detail-live/`, whose README carries the seed script and
the full command.

**`--scene project-inline-edit` (`--project <key>` names the row) is the live
half of the Projects detail page's INLINE EDITING.** It needs `--backend` and
`--backend-records`: every save it makes is asserted against the daemon this
run owns (the frame is the UI half, the daemon read is the claim), and its
saving frame is held by pausing that daemon's own process — SIGSTOP/SIGCONT by
exact pid from the serve record, the `mini-view` device, which is why the
operator's own 1111 is refused rather than paused. It drives and photographs
the per-field contract (`docs/design/agents-inplace-shared-composer.md` § 2):
hover and focus reveals, open via the affordance and via double-click, Escape
reverts, Enter accepts a single-line field, the check and the x commit and
cancel, blur accepts iff changed, Enter in the description is a newline while
Cmd+Enter accepts, a refused write holds its sentence beside the field (a real
409 `project_name_exists` and the done-gate 422), a field that moved
out-of-band holds its commit with `Keep mine` / `Use theirs`, and a missing
field is born inline from the properties block's `+ Add` menu (an estimate
and tags born from none included, and a clean tags draft adopting an
out-of-band move without reverting it — the two data-integrity cases review
round 1 reproduced). Its nine frames per palette are committed under
`docs/evidence/projects-inline-edit/`, whose README carries the seed script,
the exact command and the check list.

**`--scene project-open` (`--project <key>` names the row) is the before/after
pair for the project page's composer autofocus** (operator report, 2026-10-08:
*"when clicking into a project, because of the standard behaviour of the
composer, it scrolls the user down to centre on the composer and focuses it ...
on the projects page it shouldn't [autofocus], and we should stay scrolled at
the top when clicking in"*). It presses the seeded project's row in the LIST
view with a real pointer, samples the page per animation frame while the
detail page lands, and asserts the claim `--autofocus-expect` names: `jump` on
the base tree (the strip's mount-time focus scrolls the page down, the box
holds the caret) or `stay` on the head tree (scrollTop 0, unfocused, the strip
below the fold) — the same scene bytes on both trees. It also walks the
controls the change must not move: the strip still takes a click and types, a
pointer Send is admitted (read back from the daemon's `history` route), the
Send-to target switches through the real Radix Select without moving the page,
the chat pane's composer still takes the caret on open, and `history.back()`
returns to a page that stayed put. It also leaves the detail WHILE SCROLLED -
through the sidebar's `Projects` row, which lands at any offset, where the
header's own escape must be wheeled to first - and re-opens the SAME project:
the detail scroller's DOM node is reused across the list and the detail views,
so the offset can only survive a leave that happens scrolled (UX round 1's U1),
and the `stay` half asserts the landing at the top while the base half records
where it lands. It uses CDP
`Emulation.setFocusEmulationEnabled` because a never-shown window cannot show
`:focus` rings, and says so in its README. Its frames are committed under
`docs/evidence/project-open-no-autofocus/`, the base tree's half under
`before/` and the head tree's under `after/`.

**`--scene sessionless-slash` (issue #625) types five commands — `/help`,
`/theme`, `/login`, `/logout`, `/resume` — into a NEW chat (`⌘N`, the press
`--scene new-chat` proves), one theme per launch like every stateful scene.
`--slash-expect open` (the default) asserts each mounts its picker on the
sessionless pane; `--slash-expect refused` asserts the dispatcher's refusal
sentence instead, so the base tree's half of a before/after pair runs the SAME
bytes as the head's. Under `open` the scene then sends a turn, waits for the
mock provider's answer, and asserts `/theme` on that live conversation still
presents the picker — the session-ful path the change must not move. It needs
`--backend`, the daemon's serve record (`--backend-records`), and
`--seed-onboarding-complete`, like every `--backend` scene. Its frames are
committed under `docs/evidence/sessionless-slash/`, the base tree's under
`sessionless-slash-baseline/`.**

**`--scene mini-view` photographs the Quick send composer — the second renderer document a global hotkey summons (design §I.3).** Since the dev-driver exerciser (M-B1) the scene drives the app's OWN mini window: an armed launch in `headless` mode creates it (`headlessExerciserAllowed` in `src/main/dev-driver.ts`), registration stays normal-only (`hotkeysAllowed`), and it is never shown — presentation still runs through `presentMiniView`, which a headless plan refuses. The scene finds that window, sends the real `mini-view:summoned` channel into it from MAIN (a headless run has no OS chord to press), drives the composer through CDP's own input pipeline, and captures each state from MAIN's `capturePage` on the hidden window, with the console rig's rule applied (the first capture of a hidden window can come back blank, so every capture retries) and a settle poll before every capture (the stills used to be taken mid-transition, so their colours were a phase of a 120 ms fade — design round 1, D6). A run where the window is absent refuses by name rather than photographing a hand-built substitute: a substitute cannot pass the desktop plane's frame gate (`desktop-ipc.ts`), which is exactly why the live send needed the app's own window. The draft is typed through CDP's `Input.insertText`, the mic frame is driven by a fake `getUserMedia`/`MediaRecorder` installed before boot, and the run closes with every window of the app surveyed (`none visible`), an asserted absence of any `cannot use desktop controls` refusal in the app log, and the hidden window's renderer memory, which is risk K6's number. **With `--backend` (plus `--backend-records`, which the app needs anyway to admit the daemon) the whole send path is real**: the message goes to the chief-of-staff conversation and is read back from the daemon's own `/v1/desktop/sessions/<id>/history` route. Two harness aids make the transient stills possible, both disclosed here and in the run output, neither in shipped code: the run's own daemon process is SIGSTOPped by exact pid — from the linked serve record, loopback-only and never 1111, guarded like `--scene connection-drop`'s kill — for the `sending` frame and SIGCONTinued in a `finally` before the same request completes (so the `sent` frame is that request's real admission), and the composer's own 600 ms flash timer (`SENT_FLASH_MS`, read from its declaration) is stretched in the page for the `sent` frame. Without `--backend` the send's end is the transport refusal (`error` — the fail-closed state with the draft kept) and no sending/sent frames are taken. It cannot prove a real OS chord reaching the registrar, focus returning to the previous app, the microphone permission prompt, or the OS-level conflicts macOS does not report (QA round 1, Q2) — those are human steps and platform facts, and the PR says so beside the frames.

**`--backend <url>` points the app at a live, ISOLATED backend this run owns.**
Absent (the default) the app is aimed at a port the script verified dead, so a
scene captures an app that cannot reach a backend and every frame is publishable
by construction. Set, the app's own transport uses that backend instead, which is
what a surface gated on a backend ANSWER needs — a capability-gated row cannot be
driven at all while the capability is unreachable. The bearer is read from
`LOCAL_OPERATOR_DESKTOP_TOKEN` in the script's environment, never from argv; the
run refuses to start without it. **The renderer must have been built against the
same URL** (`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:<port> pnpm build`): the
renderer's copy of that address is inlined at build time, so a tree built for the
default would leave the renderer talking to the operator's own backend while main
talked to the run's. The run asserts which URL the renderer was built with and
fails by name if it is not the one `--backend` named.

**And the port has to be one the PAGE allows.** `src/renderer/index.html` pins
`connect-src` to `1111`, `8080` and three vendor origins, and nothing computes it
at runtime, so the renderer refuses — by its own policy, before any of this run's
logic — a fetch to a backend on any other loopback port. `--backend` on such a
port still boots and main still talks to it, which is what makes the failure read
as a missing composer rather than a refused fetch; the app's own log carries
`Connecting to 'http://127.0.0.1:<port>/v1/credentials' violates the following
Content Security Policy`, and `--scene mentions` names the port in its refusal
(QA round 3, Q-6). Run the rig's proxy on `8080` or `1111`.

**AND THE DAEMON MUST BE TOLD ITS HOSTING, which the flags do not do on a fresh
config root** (QA round 1, Q3 — it cost that lane its whole first pass, and this
one its first scene set).

```sh
local-operator serve --host 127.0.0.1 --port <port> --hosting test --model mock-model
```

writes no hosting into a freshly created config root, so every turn dies in the
daemon — `local_operator.session_factory.HostingNotConfiguredError: Hosting
platform is not configured.` → `POST /v1/desktop/sessions/<id>/messages → 503`.
Inside the app the ONLY symptom is a message that reaches the transcript and is
never answered, which reads exactly like a UI defect: `--scene first-send`
reports `answered: false`, and the composer's readings never resolve a model.
Two lanes have now spent a round photographing it. Write the values the flags
imply BEFORE the daemon starts:

```sh
mkdir -p "$CONFIG_DIR"
cat >"$CONFIG_DIR/config.yml" <<'YAML'
values:
  hosting: test
  model_name: mock-model
YAML
```

With that file, the same tree reports `first-send` 14 PASS / 0 FAIL at 1380x900
and 800x600 (`answered: true`) and `question-dock` 13 PASS / 0 FAIL. Without it,
the turn-bearing scenes are silently un-runnable, and a FAIL line in their log is
about the harness rather than about the app.

**The run refuses before its first boot if the tree is not on the Electron this
branch pins** (`package.json` `optionalDependencies.electron`, the version
`pnpm install --frozen-lockfile` gives and `build.electronVersion` moves with).
It prints `[refusing] this tree is not on the pinned runtime …` and exits 1 with
nothing booted and no frame written, so a worktree inheriting a stale shared
`node_modules` cannot populate a frames directory at all — which is what makes
the pin worth stating: a committed frame is only reproducible on the runtime that
produced it (a 35.x build renders this window as a 1380x872 viewport against
44.3.0's 1380x868, and every pixel hash differs). With `--keep` the scratch tree
is named rather than removed; otherwise the refusal removes the tree it had just
created, since nothing has run in it.

The frames below came from exactly that command —
`docs/evidence/renderer-driver/`:

| Frame | Surface |
| --- | --- |
| `chat-dark.png` | `/chat`, `localOperatorDark` || `chat-light.png` | `/chat`, `localOperatorLight` — the same screen, same size |

## The CI producer's case table

`scripts/asks-app-regression.mjs` runs in `ci.yml`'s macOS NPX leg on every pull
request, and it is what supplies the frames a design or UX round reads for a
CHANGE (the scenes above are how a surface is photographed deliberately, by
hand). It boots the real assembled app once per case per leg — a **candidate** leg
built from the checkout, and a **control** leg built from a real historical revision
(`resolveAsksControl`: the merge-base of `origin/main` and `HEAD`, the pinned
`2461cfa3` only when that cannot be resolved) — drives the same case on both, and
uploads every leg's PNGs and `measurements.json` as one artifact. Each leg's
rail-close frame carries a `railClosePolicy` reading — the candidate's post-state is
asserted and the control's is only recorded, so the pair shows which close policy
each revision has without hard-asserting one revision's. Main and preload
are reused byte-identically across the two legs and only the renderer is rebuilt
for the control, which is why `prepareControl` asserts the four reused parts
(`src/main`, `src/preload`, `electron.vite.config.js`, `pnpm-lock.yaml`) agree
before it builds anything: a case whose branch moves one of those is refused
rather than photographed against a control that is not the code under review.

What a UI head supplies is only its **case**, an entry in the table near the top
of that file: `purpose` (prose for the reviewer), `route`, `frames` (a contract —
the runner fails the run if a promised label was not captured), optional
`legacyOutputLayout` for the first case's `<output>/control|candidate` paths, and
`drive(ctx)`, which gets the generic doors only (`press`, `pressEscape`, `wait`,
`waitFor`, `facts`, `frame`, `fixtureMode`, `session`, `cdp`, `api`, `kind`).
Driving through `press` and reading state back through the driver's `state` verb
is the point: a case that reaches into React or calls a store directly would
prove the store works, not that the surface a user presses does. The legs are run
by the same table, so a case is added, removed or renamed in one place, and
`--case <name> --leg control|candidate` outside the table refuses before any
artifact root or Electron binary is resolved.

What it cannot do is photograph the native `WebContentsView` plane: `capturePage`
sees the renderer document, not a sibling native view or the macOS z-order, so
`physical1106` in the manifest records that gap by name rather than letting a
green frame imply coverage it does not have.

Some screens are recorded as **not yet caseable**, because a case there would
photograph the wrong thing rather than nothing. `settings` is the example that
matters most, and it was rejected on source rather than on taste: the settings
read travels `GET /v1/settings`, and the fixture models no answer for that path,
so a settings case would capture the fixture's `404 No fixture for /v1/settings`
fallthrough as though it were the screen a user sees. The Radient read door is a
separate matter: its allowlist carries `quota.notice` alone, which is why the
credit census is answered and anything else on that door is refused — that is
not what stops a settings case, and widening it would not unblock one. Making
`settings` a case means modelling the settings answer in the fixture, which is
its own reviewed change rather than an edit smuggled in beside a frame capture.
Until then, settings frames come from the Storybook locale rig
(`.storybook/preview.tsx`, whose evidence-locale global landed in #1125) rather
than from here. The test generalises: a case that would photograph a read the
fixture does not model, or a refusal the fixture raises, is not evidence of the
screen — that surface is recorded here instead of being added to the table.

## The gate: off unless the launch asked for it

Arming needs **both** `LOCAL_OPERATOR_UI_DEV_DRIVER=1` (or `true`) and an
absolute `LOCAL_OPERATOR_UI_DEV_DRIVER_OUT` frames directory, and the launch must
not be in `normal` window mode. Anything else is off, and a value that was set
and not understood is off *loudly*: `LOCAL_OPERATOR_UI_DEV_DRIVER=yes` prints a
`[dev-driver] not armed: ...` line naming the accepted values rather than looking
like a harness bug.

Both are read from the environment the process was **launched** with, and that is
a narrower thing than `process.env`. `src/main/backend/config.ts` applies a
`.env` from the app's working directory with dotenv `override: true`, so from
that line onward `process.env` is the launch plus that file, and the file wins;
the launch facts (this opt-in, and `LOCAL_OPERATOR_UI_WINDOW_MODE` with it) are
resolved from the snapshot taken before the fold. So a `.env` in the checkout
**cannot** arm the driver, cannot choose its frames directory, and cannot
override an explicit `LOCAL_OPERATOR_UI_DEV_DRIVER=0` — which matters because a
`.env` is exactly where an agent reaching for "an environment variable" would put
one, and a control surface a config file can switch on is not opt-in.

Off means the process is indistinguishable from the app as it was:

- main registers no `dev-driver-*` channel at all, so a call is refused by
  Electron itself (`No handler registered for 'dev-driver-capture'`);
- the window carries no dev-driver `additionalArguments` entry, so the preload
exposes no `window.__loDevDriver` — not a disabled object, nothing. (The window
DOES carry the telemetry decision, which is written on every window, armed or
not — a different entry, in the same argv `slot`; `rendererArgumentFlags` in
`src/main/index.ts` is what unions them, and `AGENTS.md`'s "An agent-driven run
sends no telemetry either" is where that switch is documented);
- the renderer's install module returns immediately.

`node scripts/renderer-driver.mjs --gate-check` measures that on four real boots
and fails the run if any of it is untrue. Three of them must be inert, in every
respect the list above names — the plain launch, one asked to arm by a `.env` in
its own working directory, and that same file asking while the environment says
`=0` — and the armed launch must have the bridge, write a real PNG through it,
and print the banner. `scripts/dev-driver-gate.test.mjs` pins the same decision
in-process (it is in `pnpm test:desktop`), because the module imports nothing
from Electron and can be bundled in a test.

Two mistakes are recorded here because they are the two ways this gate fails:

- **A `sendSync` handshake deadlocks an unarmed launch.** The first version had
  the preload call `ipcRenderer.sendSync("dev-driver-handshake")`, and a
  `sendSync` to a channel with no listener never answers: the normal launch
  blocked inside its preload, the window never painted (the page target was
  still `index.html` nine seconds later and CDP answered nothing), and the log
  carried `called ipcRenderer.sendSync() with 'dev-driver-handshake' channel
  without listeners`. The gate now travels as an `additionalArguments` entry,
  which is synchronous, cannot be forged from outside the process, and does not
  block. `--gate-check` asserts the paint first for that reason.
- **Do not share one `--user-data-dir` between two boots.** The app takes a
  single-instance lock **per profile**, so two boots sharing one profile collide:
  the second prints "Another instance is already running" and exits without a
  window — which reads exactly like a broken driver (that is what the first
  two-boot run of this harness did, one profile directory for both). Two boots on
  *different* profiles do coexist — a peer session measured that, on different
  `HOME`/config as well as on the same config — so the requirement is one profile
  per launch, which is what the harness does, and not serialisation of runs.

## The address-overlay probe's own opt-ins

The browser's address-overlay child (`src/main/browser/address-overlay.ts`) is not
the dev driver and is not armed by it: it has its own exact-`1` opt-ins, each an
increment on the one before, and every refusal prints
`[address-overlay] not armed: <reason>` on stdout.

| Variable | Arms | Extra requirements |
| --- | --- | --- |
| `LOCAL_OPERATOR_UI_BROWSER_ADDRESS_OVERLAY_S1` | the inert native child | armed dev driver, `headless` |
| `…_S2` | the mirror list inside that child | S1, armed driver, `headless` |
| `…_VISIBLE` | one **visible** probe run of that mirror | S1 + S2, armed driver, `--window-mode=inactive`, unpackaged |

`…_VISIBLE` is the only one that puts anything on the operator's screen, so it
is also the only one with containment of its own:

- **never a default and never product surface** — absent on every ordinary
  launch, refused in `normal` (the product's own mode), refused in `headless`
  (a headless run labelled “visible” would misattribute its evidence), refused in
  a packaged build;
- **launcher-bound** — `inactive` is normally not watched (`resolveLauncherWatchPlan`
  treats a visible window as closeable by a person), but a visible probe passes
  `boundedVisibleProbe: true` and quits when its launcher goes;
- **capped at 120 s** — `ADDRESS_OVERLAY_VISIBLE_MAX_MS`, `unref`'d, ending in the
  same bounded `endHeadlessRun` quit every other non-product run takes;
- **one self-contained command.** `node scripts/browser-address-overlay-probe.mjs
  --s3-visible --window-mode=inactive --out <dir>` refuses to start without that
  argv, without its own environment opt-in, or without a TTY. It proves the
  headless/normal refusals first, opens one `inactive` window, asks five
  numbered questions, then reaps its exact pid tree and writes `teardown.json`.
  Nothing here calls `screencapture`, `desktopCapturer` or any other capture API
  that could raise a TCC prompt: a composite-pixel claim is the operator's eyes
  or an operator-supplied screenshot, and an unattended run marks those rows
  BLOCKED rather than passing them.

The headless half is `--s3` (and `--s2` for the mirror alone). `--s3` re-runs the
S2 matrix on the current head as its regression surface and adds the focus, IME
and accessibility rows; `docs/design/browser-address-overlay.md` holds what those
rows do and do not establish.

## The approvals card's kill switch (S6c)

The native approvals card is a **product surface and on by default**. Exactly
`LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_DISABLE=1` restores the DOM dock and
band for that launch; an absent value or any other value leaves the card on. The
switch is read once in the browser host, so a disabled launch creates **no card
controller and no `WebContentsView` child at all**; it is not a hidden view.

Platform/fallback rules stay: the child is opaque on non-darwin (the
opaque-square fallback), and if the child cannot be created the host projects
`approvalsCard.available: false`, which makes the renderer fall back to the dock.
The card takes the Approvals route from the shield **and** from the page menu's
Approvals item; while it is available the dock component is not mounted. The
card is not claimed at VoiceOver parity (see the PR's owner-named limitation).

## Isolation: what the run cannot reach

A driver run happens on the operator's desktop, next to his real app. Every path
that could reach his state is redirected, and the run prints all of them:

- `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` are scratch. The config dir alone is
  not enough: caches and hardcoded home roots follow `HOME`, and this repository
  has already written 612 rows into the operator's live analytics database from a
  run somebody believed was sandboxed.
- `--user-data-dir` is scratch **per launch**, so the Electron profile (the
  localStorage the UI preferences persist into) cannot see or touch the real one.
- `LOCAL_OPERATOR_LOG_DIR` is scratch. The app's own log directory is the user's
  real home — Electron's `home` is the OS account's home, and neither the scratch
  `HOME` nor `--user-data-dir` redirects it — so without the app's own override
  every run appended its lines to the operator's
  `~/Library/Application Support/Local Operator/logs/*.log`. The harness sets the
  override and asserts, from the `Log path: …` line the app writes at logger
  init, that the app resolved it. The app resolves it from the pre-dotenv launch
  snapshot (`src/main/backend/launch-env.ts`), so the scratch cwd `.env` in the
  next bullet cannot move it either — a `--gate-check` boot names its own log
  directory in that file and the run asserts the app logged into this run's tree
  instead.
- The app's **cwd is outside the checkout**, and the scratch cwd holds a `.env`
  with `VITE_LOCAL_OPERATOR_API_URL` pointing at a port the script picked and
  verified to be dead — or, under `--backend`, at the backend this run started.
  `src/main/backend/config.ts` loads `.env` from `process.cwd()` with dotenv
  `override: true`, so a repository `.env` cannot win and the run has no reachable
  backend. That is the difference between a run that shows a disconnected app and
  one that writes into the operator's backend — and it is why every frame can be
  pasted into a PR.
- The run asserts, with `lsof` on the app's own pid, that the app holds **no TCP
  connection to the URL the renderer was built with** (`VITE_LOCAL_OPERATOR_API_URL`
  is inlined into the renderer bundle, and a few renderer-direct features —
  attachments, the canvas edit API, the updates panel — would use it). The probe
  says "unavailable" rather than "no connections" if `lsof` is missing. Under
  `--backend` that URL IS the run's own backend, so the two halves are asked
  separately instead: the app holds a connection to the run's backend, and holds
  none to `http://localhost:1111`, the address the operator's own backend listens
  on and the one a careless build would leave inlined.
- `CMUX_*` and `LOP_*` are stripped from the child environment: an inherited
  workspace id has already renamed the operator's real cmux workspaces from a test
  run in this repository.
- Nothing raises the window: `headless` is never shown, and the run asserts
  `visible=false`, `focused=false` from main before it captures anything.

## The app's lifecycle: one boot, one process, stopped by pid

A run boots the app several times (four in `--gate-check`) and each of those apps
is a real Electron process on the operator's desktop, so how it is stopped is
part of what this harness has to get right:

- Each launch spawns the **Electron binary itself** (`require("electron")`,
  the same resolution `bin/local-operator-ui.js` uses) and not
  `node_modules/.bin/electron`. That shim spawns the app as *its* child, so a pid
  taken from it is the shim's — the teardown then signals a process that has
  already exited and the app is re-parented to launchd, still running, still
  holding the profile `--clean` is about to delete. Measured before the change: a
  `--gate-check --clean` run printed "scratch removed" with all four of its apps
  alive under `ppid 1`, one still answering on its debugging port.
- Teardown is **SIGTERM, then SIGKILL, both to that same app pid**, and both
  wait for the exit. Signals are never pattern-matched (`pkill`, `pgrep -f`): the
  operator's own app matches any pattern wide enough to find a headless one, and a
  sibling session's pattern-derived kill here matched eleven orphaned apps from
  runs that had already finished.
- Every boot is registered before anything can throw, and a reaper stops all of
  them on `SIGINT`, on `SIGTERM` and on a thrown error — an interrupted run
  (Ctrl+C, a supervisor's timeout) is the common way this harness is stopped, and
  it used to leave every app booted so far running.
- The run **measures** the result rather than asserting it in prose: the armed
  boot checks that the leftover probe can see it while it is running, and every
  run ends by checking that no process carrying this run's own tag survived
  (detection can be a pattern, because the tag is `lo-renderer-driver-<this run's
  pid>` and cannot match another session). `--clean` deletes the scratch tree only
  after that check passes: an app still running re-creates the profile directory
  under it the moment it is removed.
- **An INTERRUPTED run leaves its scratch tree, and reclaiming it is yours to
  do.** `SIGINT` and `SIGTERM` go straight to `process.exit` after the reaper
  stops the apps this run started, so `--clean`'s removal never runs and the tree
  stays at `$TMPDIR/lo-renderer-driver-<pid>` — about 1.9 MB holding a dead
  profile and the app's own log, which is the file you want after an interrupt.
  Nothing else reclaims it: `--out` frames live outside it and survive, and a
  later run uses a different pid, so a tree left by run 4711 is never touched by
  run 4712. Delete it when you are done with the log:

  ```bash
  rm -rf "${TMPDIR:-/tmp}/lo-renderer-driver-<pid>"   # the path the run printed
  ```

  A run that refuses on the pin check leaves one too, and prints its path: that
  path removes the tree only when `--clean` was passed without `--keep`. With the
  default flags — neither `--clean` nor `--keep` — it prints `scratch: <path>` and
  keeps the tree, so a refused run needs the same `rm -rf` an interrupted one does.

## The verbs

`window.__loDevDriver` exists only in an armed launch. Its own methods are the
bridge; the verbs are registered by the renderer's install module.

| Call | What it does |
| --- | --- |
| `call("hello")` | Where the app is: route, theme, viewport, dpr, `visibilityState`, `hasFocus`, and the renderer's baked API base URL |
| `call("state")` | The state the verbs write into: route, theme, panel flags, active session, session count |
| `call("navigate", path)` | Navigates the hash router and waits for the route |
| `call("setTheme", name)` | The settings picker's own action, waiting out the 120ms `transition-colors` it starts so a frame taken after it is the settled palette rather than a blend of the two |
| `call("press", selector)` | Waits for the element, hit-tests its painted centre, dispatches a pointer sequence, returns what was hit |
| `call("openCanvasDocument", { path })` | Puts a local file in the canvas, on the pane the app is showing: the read step the Files grid's tile click performs (`probeFiles` for the mtime and size, `READ_ENCODING`/`viewerFor` for whether the viewer reads its own bytes, `readFile` for the text kinds, `canvasDocumentForPath` for the document), then `addFileAndSelect`. It also stages a draft, because a run with no backend cannot open the New chat gate and without a pane identity there is no conversation for the document to belong to. **That staging is not enough with no backend, measured 2026-09-24:** the chat route draws its refusal surface when no backend answers, so neither the pane row (`[data-tour-tag="pane-row"]`) nor the chat column mounts and the canvas never does - a scene that measures the chat pane's geometry needs `--backend` (see the `floors` scene below) |
| `call("queries")` | Every query the app is holding, as the screen's own gate reads it: key, `status`, `fetchStatus`, the derived `isLoading`, the error's own sentence, `dataUpdatedAt`, `failureCount` and the observer count — keys and the error's sentence, never data. The full-page spinner is the same pixels whichever query holds it, so this is the reading that says WHICH one was holding a route |
| `call("queryFetches", { arm: true })` | Arms the fetch trap: `Query.prototype.fetch` is patched so every fetch the app starts is recorded with the stack of whoever started it, and arming fetches a key of its own through the patched path and reports `validated` only if that fetch lands in the log. A page-side wrapper over `window.api` cannot do this — `window.api` is a `contextBridge` object and ignores property assignment silently, which is how an earlier version of the settings-gate scene printed `0 reads from 0 caller(s)` beside an `armed true` note |
| `call("queryFetches", { key })` | The recorded fetch call sites, deduplicated by stack, with counts and the span each covered (`key` filters by key substring; the probe's own key is excluded and counted as `probeRecords`) |
| `facts()` | From main: window mode, window vs content size, visible/focused/minimized, app version |
| `capture(label)` | `webContents.capturePage()` → `<out>/<label>.png`, reporting pixels and the CSS viewport |

Verb names are enumerable (`verbs()`), so a scene that calls one that does not
exist is told what does. `capture` is deliberately not a verb: it goes through
main, which is the only side that can photograph the window.

Scenes live in the harness script, not in the app: a scene is assertions and
captures composed from those verbs, so a new one costs a function rather than a
release. Add a *verb* only when a scene needs to reach a path none of these can
— and keep it named and reviewable. A generic "eval this string in the page" hook
is refused on purpose: its blast radius grows with every PR, and the review
question "what can this reach" would have no answer.

There are several scenes, and the ones below are the worked examples of that
rule:

- **`states`** — the before/after pair of one screen plus a real control press;
- **`palette`** — the command palette, opened by a pointer sequence on the rail's
  Search row and typed into through CDP's own input pipeline
  (`Input.insertText`, the same domain `click-proof.mjs` dispatches through,
  rather than a synthetic DOM event from inside the page). No verb was added for
  it: everything it needs is a scene-level use of what the harness already
  speaks. It asserts what the frames cannot — that the press hit the row it
  named, that focus landed in the query field, that typing narrowed the list,
  that Escape closed the dialog, and that focus came BACK to the row that opened
  it — and it does not claim the groups that need a backend (conversations, the
  settings registry, and the panel rows, which now need a live backend rather
  than a live pane). Those are covered by unit tests over the join and the
  ranking, and by the QA pass against a live backend.
- **`new-chat`** — the sidebar's `⌘N`, pressed through CDP's own key pipeline
  (`Input.dispatchKeyEvent`, never a `KeyboardEvent` built inside the page,
  because the whole claim is that the press reaches the listener) against the
  BUILT app. It is the scene that needed this harness's three newer flags:
  `--backend` points the app's own transport at a live, ISOLATED backend the run
  owns, `--backend-records` hands the app the record that backend wrote for
  itself (without it `discovery.ts` does not admit the daemon), and
  `--seed-onboarding-complete` writes the scratch profile's onboarding flags,
  because a fresh profile in front of a fresh backend is a first-run user whose
  six-step wizard is a modal over the window. It asserts both halves of the
  claim: that the chord moves the app to `/chat` and stages a fresh draft, and
  that with no catalogue answering the press changes nothing at all.
- **`floors`** — §I's pane floors, measured rather than argued: the chat column's
  480px floor, the canvas docking at `min(560, available - 480)`, and the `overlay`
  literal it falls back to where the row cannot give the pane its own 400px floor
  (a flex dock beside the column, not a cover: the mode's positioning was removed
  with the PaneSlot refactor - `canvasPaneMode` carries the note). It is run at
  the widths that straddle both bands (`--window-size 1380x900`, `1024x673`,
  `960x673`, `800x600`), and it **requires `--backend`**: the chat pane does not mount
  without one (see `openCanvasDocument` above), so the scene names the gap in a note
  instead of passing on a reading it could not take. It captures the frame BEFORE it
  reads the boxes, because the canvas's wrapper carries `transition-[width]` and a
  reading taken mid-transition describes a layout that was never on screen - measured:
  chat 942 / canvas 179 at 1380 in one run against the settled 560/560 the frame shows.


- **`route-tops`** — the top of every route the shell draws: `/chat` as the control
  (a route the change it was written for does not touch) and `/settings`,
  `/settings?section=integrations`, `/agents`, `/agents/<any id>` (the saved-agent
  route, which draws its own 280px roster through a different component),
  `/agent-hub`, `/schedules`, `/projects` and `/browser`, each photographed and read
  back as numbers. `/projects` and `/browser` joined the sweep for review round 1's
  M1 (the operator-named must-not-move routes the first sweep left out); neither
  draws a leading column, so their reading is the floor half of the band claim
  rather than a hand-over. It
  exists because the sub-view inset report (2026-09-26, "for sub-views like the
  settings page, the sidebar and view doesn't go all the way to the top") was a
  claim about ONE y coordinate per route — where a column's first box begins — and
  that number is what a reviewer can check: on a macOS integrated window the lane
  ends at 32 and every route's first box must start there (measured at y 62.86
  before the fix, 32 after, with the app sidebar's row at 32 in both).

  **TWO CLAIMS, BECAUSE THE REPORT CAME TWICE (2026-09-27, "Same issue with agents
  and teams").** The second is the same y as a GROUND rather than as a box: the
  lane's `surface` band is a mirror of the columns' grounds, so a route's own
  leading column — the settings rail, the agents list pane — needs the band to run
  past its right edge, or the content ground is painted over its width and the
  column's panel starts below the strip. The scene reads the lane's RESOLVED
  gradient (its stop and its first colour) and the route's leading column, and
  asserts the stop reaches the column's right edge in the `surface` role; where a
  route draws no such column the stop must be exactly the app sidebar's own width.
  The column is DERIVED from the layout (a full-height surface column at the
  route's left edge) rather than looked up by the marker the fix adds, because a
  rig that asks for a handle the broken tree does not have passes by having nothing
  to check — measured on the base tree, where that shape reported every route as
  having no leading column. The readings on the tree this was written for: the band
  stopped at 260 against a rail ending at 479 and a list pane ending at 516 (both
  FAIL), and reaches 479/516/540 after.

  **Requires `--backend`** for the settings, agents, projects, hub and schedules
  surfaces to render at all, and is run twice per tree (`--window-size 1380x900` and
  `800x600`, `--run-label` keeping the two sets of frame names apart).

- **`hit-zones`** — the window drag region against the overlays painted over it,
  and the audit that goes with it: every control of every overlay the scene can
  open is sampled at five points through a page-side re-implementation of the
  rect walk Chromium runs for `app-region` (drag unions, no-drag subtracts), so a
  swallowed click is separated from a dead handler — the operator's report of
  2026-09-26 ("the X button at the top of the analytics also seems to be
  unclickable") is reproduced as a region reading rather than a click attempt. It
  cross-checks against Electron's own `[draggable-regions]` debugger lines, and
  asserts the non-chat route band's shape PER PLATFORM since #535: stood down
  where the shell's lane is drawn (macOS and leading layouts), the caption height
  `env(titlebar-area-height)` where it is not. **Requires `--backend`** (the
  machine panels open through a slash command the backend's catalogue resolves),
  and only macOS is exercised here — the caption-trailing branch is written for
  the Windows/Linux runners that render it. The evidence set is
  `docs/evidence/hit-zones/`, force-tracked run logs included.

- **`sidebar-sections`** — RETIRED with the split's removal (agent review
  round 1, R2; QA's Q3). It walked the sidebar's draggable boundary, its two
  collapse controls, the persisted height a relaunch had to restore and the
  bubbled brand mark, and the merged panel draws none of the split's furniture -
  one scroller, no boundary, no collapse - so the scene could only throw at its
  own preconditions. `sidebar-split.ts` and `docs/design/sidebar-sections.md`
  remain the feature's record, and the frames it took remain the record of the
  trees they were taken on.

- **`canvas-freshness`** — the canvas document kept current with the file on
  disk. The scene writes the file ITSELF, from outside the app, which is the only
  way to produce the event the feature exists for, and it sets the mtime to a
  FIXED epoch rather than to the clock, so every claim in it is exact rather than
  phase-dependent and a re-take is byte-comparable: a write with a new mtime must
  appear with no interaction, and a write with the SAME mtime must not — then the
  refresh control must apply it anyway, and the preview of an HTML document must
  be re-FETCHED rather than left showing the bytes it had.

  Its two claims about TIME are counted, and the counter lives in MAIN. The
  renderer cannot be counted from the page: `window.api` is a `contextBridge`
  object, so a wrapper assigned over one of its properties is silently ignored
  (measured — this scene's first version installed one and read zero for a run in
  which probes demonstrably happened), and what replaced it at the time was the
  app's own `canvas-store` entry, which proves non-APPLICATION rather than
  non-probing. Main has no such problem, so the scene launches with
  `--inspect=<port>` and installs a counter over the `fs` calls `probe-files`
  itself makes, limited to this run's scratch root, and it PROVES the counter
  before measuring anything: a probe issued from the renderer through the app's
  own bridge must appear in the log, so a later zero is a measurement rather than
  a broken wrapper. That is what makes "3 probes in 6 seconds on screen, 0 for the
  tab that is off screen, 0 while the panel is closed" assertable, and what
  replaced the latency lower bound the scene used to assert (a free-running poll
  makes latency uniform in (0, interval], so the lower bound failed on roughly
  half of runs — QA round 1, Q2).

  This is also the scene that needed a new verb (`openCanvasDocument`), because a
  driver run has no other way to put a file in the canvas: the tiles come from a
  transcript, ⌘O is an OS dialog, and the create-file dialog needs an agent id
  that only a session supplies. What it cannot show is a window that is genuinely
  `hidden`, or a real user's typing — the run's renderer reports `visible`, and
  the dirty-suppression half is covered against the shipped module by
  `scripts/canvas-file-freshness.test.mjs`.

- **`mesh-tab`** — the Mesh tab's device census against a live daemon, and the
  one scene that reads its expectation from the DAEMON rather than from a
  fixture. `--mesh-expect tombstones` is the base tree, which drew every member
  id as a device node, so a revoked membership (`active: false`, a tombstone the
  relay keeps for audit) appeared as a peer that had not answered;
  `--mesh-expect collapsed` is the fixed tree, which draws only devices with an
  active membership and carries the revoked memberships in one inspectable
  count. The scene asks `/v1/desktop/networks` for the same rows the app renders,
  derives the live ids and the tombstone ids, and refuses to run on a mesh with
  no revoked membership: a pair photographed on a clean mesh would not be
  evidence about this defect. It captures the canvas and the list in the
  `--theme` this run claims, then opens the revoked count with a real press and
  photographs the audit rows. What it cannot prove: that a tombstone was created
  through this UI (the daemon's fixture predates the run), and that the relay's
  90-day retention pruned anything.

- **It is isolated from the operator's state, not from the network.** The run
  reaches no backend — the scratch `.env` points the app at a port the script
  verified dead, and the run asserts the app holds no connection to the URL the
  renderer was built with — and since the telemetry switch landed it sends no
  product telemetry either: `renderer-driver.mjs` hands its child
  `LOCAL_OPERATOR_UI_TELEMETRY=off` (`scripts/telemetry-off.mjs`), and an off
  launch constructs no PostHog client in either process, so no
  `us.i.posthog.com` / `us-assets.i.posthog.com` connection is made for its pids
  and `capture_exceptions` captures nothing. Measured both ways on one machine:
  the same boot with the switch in place holds no connection to either host,
  and without it holds ESTABLISHED connections to both (commands and output on
  the pull request that added the switch). What that does NOT make this run is
  "offline": the isolation is the operator's state — profile, config dir, log
  directory, backend URL — and the app is free to reach whatever else it
  reaches.

- **Abandoned scratch trees are reaped at the start of every run.** `--clean` is
  opt-out, so a tree survives whenever its run does not ask for it - and always when a
  run is killed or crashes. Measured on the operator's machine, 2026-09-24: **244**
  `lo-renderer-driver-*` trees in the shared temp directory, 2-4 MB each, ~700 MB, with
  free space down to ~3 GiB and builds in a neighbouring session failing on it. A run
  now sweeps trees whose pid is gone **and** which are older than 30 minutes, never
  touching one a live pid owns and never touching an unparseable name, and prints what
  it removed. The age is the second guard on purpose: pid numbers are reused, and this
  fleet runs ~25 sessions at once where two driver runs overlapping is ordinary.

## What it can prove

- What the app actually paints, at a real viewport and device pixel ratio, of the
  built app the operator runs.
- A visual **before/after of one screen** — the shape a visual-change review
  needs, and the reason `--scene states` captures the same surface twice. The
  pair is asserted to be *two renders* (the frames on disk are compared, and
  their hashes printed) as well as the same route and viewport, because those two
  checks are satisfied by one frame written twice — which is exactly what shipped
  once, with `chat-light.png` a byte copy of `chat-dark.png`.
- That a control is real enough to be driven: the press reports the element at
  the painted point, and the scene checks the app's state moved.
- That the run stayed out of the way: window mode, size, visibility and focus
  come from main, not from the page's own belief about itself.
- That a committed frame is one the app **held still for**. The theme verb waits
  out the app's own colour transitions (three consecutive frames with nothing
  running) and the scene then captures twice, 150ms apart, committing the second
  only if the two are byte-identical and no transient toast is on it. Both halves
  are checks, not notes, because both have already been wrong on this harness: a
  light frame captured mid-transition (the rail's pill at 46% of its colour
  change in a run that reported a settled frame), and a dark frame carrying the
  app's own `List agents request failed: 503` toast in one run out of two.

## What it cannot prove, and what it is not for

- **It is not a substitute for the `browser` tool.** This drives the app's own
  Electron; it says nothing about a page's behaviour in the operator's real
  browser — different profile, cookies, extensions and permissions. When the real
  browser is what is under test, use the `browser` tool.
- **It cannot see inside the embedded browser's page.** That page lives in a
  native `WebContentsView` (`src/main/browser/`), and a renderer frame does not
  include it — measured: with a tab navigated to a magenta local page, the
  captured frame contained none of it. The chrome and the page are two surfaces,
  so capturing a browser-flow change means capturing both and, if a single image
  is wanted, composing them — and a composed image must be labelled as composed,
  never presented as one screenshot. The page half has its own supported path:
  the browser host's `screenshot` RPC, driven by `scripts/browser-host-proof.mjs`.
- **Focus-dependent rendering is not covered.** A `headless` window is never
  shown and cannot be focused, so `:focus`/`:focus-visible` rings, text carets and
  anything gated on `document.hasFocus()` do not render as they do for a user.
  For those, run with `--window-mode=inactive` or force focus over CDP
  (`Emulation.setFocusEmulationEnabled`) and say which you did — the same caveat
  `AGENTS.md` records for the window modes.
- **A backend-gated screen does not reach a reviewed state here.** The run has no
  backend, so `/settings`, `/agents`, `/agent-hub` and `/schedules` render the
  app's offline surface (measured at 6s) rather than a reviewed screen, and a
  spinner is what an earlier cut of the app showed instead. A scene must not
  present either as a reviewed screen; `--scene states` says so instead of
  capturing one — which is also why it presses the rail's Agent hub button and
  asserts the route moved without capturing the destination.
- **Pressed events are synthetic.** `press` dispatches a pointer sequence from
  inside the page, which reaches the app's handlers but bypasses the browser's own
  hit testing and input pipeline. Whether a control is genuinely hit-testable is a
  different question with its own tool: `scripts/click-proof.mjs`.
- **Transient toasts are excluded, deliberately.** A run has no backend, so the
  app raises its own error toast on a timer the scene does not control; the scene
  waits for toasts to clear and discards a capture that has one. So a frame here
  is not evidence about toast styling, placement or timing — that needs a scene
  that triggers and captures one on purpose.
- **A chord decided in MAIN is unreachable from here.** `before-input-event`
  hooks read `mainWindow.isFocused() && mainWindow.isVisible()`, and a `headless`
  launch is by construction `visible=false focused=false` — the mode's whole point.
  Measured while pinning the command palette's second chord: `Cmd/Ctrl+P` could
  not open the palette in any headless run, and the mutation-checked reason is
  the guard, not the wiring. `Emulation.setFocusEmulationEnabled` moves the PAGE's
  focus, not the window's, so no CDP variant closes this gap. A main-process chord
  is therefore covered by reading the two halves of its wiring, never by pressing
  it here; proving the runtime half needs a human in a visible window, and saying
  otherwise would be claiming coverage this harness cannot have.
- **And a key injected through CDP reaches the app's handlers, and this build's
  EDITING pipeline too — but not every pipeline.** `Input.dispatchKeyEvent`
  reaches a `keydown` listener, which is what makes the guards around one
  measurable (`defaultPrevented` being the tell). **Corrected in review round 1 of
  #297, measured while walking the composer's `@` flow:** this paragraph used to
  state flatly that the injected key does not drive Chromium's editing pipeline,
  and on the built app (Electron 44.3.0) it does — `Input.insertText('abcdef')`
  followed by three `ArrowLeft` moved the field's own `selectionStart` 6 → 3. What
  is still NOT reachable is a MODIFIER-based selection (`⌘A`, `⇧arrows`: a caret
  asked for its modifier arrows back stayed at 8 whatever modifier arrived), and a
  range set from OUTSIDE the page does not reliably reach React's own caret state
  — the composer's caret is React state fed by real keystrokes, and a select-all
  plus one Backspace was measured taking the app's atomic-delete path against a
  stale caret. So: caret movement and typed text can be driven here with plain
  keys, a modifier selection cannot, and a state that lives in React rather than in
  the DOM still needs a real keystroke — say in the row which of the two you used.
- **It is not a way to answer an approval, and must not be used as one.** A verb
  can press an in-app approval control, so a scene that did would make every "it
  works" captured through it worthless: approvals are the operator's, and the
  harness is not a second way to give them.
- **It is not a way to see the operator's data.** The isolation above is what
  makes that true, and it holds only while every launch uses this script rather
  than an ad-hoc `electron .` invocation with a real profile.

## The frames in this repository

`docs/evidence/renderer-driver/` holds the pair above with a README naming the
command that produced them. They are live-app frames, not Storybook captures, so
the Storybook sweep (`pnpm check-evidence`, which walks `.webp`) does not cover
them — the same position as the other committed live-app PNG sets, and the reason
`docs/evidence/project-detail-live/` (the `project-detail` scene's frames, six per
palette) is declared in the manifest's `supplementary` list with `frames: 0`.
The same position holds for `docs/evidence/projects-inline-edit/` (the
`project-inline-edit` scene's frames, nine per palette) and for
`docs/evidence/project-open-no-autofocus/` (the `project-open` pair, four frames
per palette per tree).
