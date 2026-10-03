# Browser OAuth popups for driven pages

Implementation brief. Author: architect (lopdev). Branch `fix/browser-popup-oauth`,
base `654c58f5f6`. Written 2026-09-29. This file is committed by the implementing
commit, not by the brief's author.

Every claim about this repository cites `file:line` at this base. Claims about
Electron cite the **pinned runtime's own type surface** (`node_modules/electron/electron.d.ts`,
Electron 44.3.0) or the Electron docs page named, fetched 2026-09-29 (the docs site
serves a single latest channel; where a claim matters to the fix it is re-checked
against the pinned `d.ts`, and the end-to-end proof is the arbiter — §5).

## 0. The problem, as verified at source

- **Repro.** In the app's browser tab, `console.radienthq.com/login` → "Continue with
  Microsoft" → the site immediately renders "Microsoft sign-in could not be completed.
  Please try again." No navigation, no popup, repeats identically. "Continue with
  Google" from the same page works (same-tab redirect, PKCE).
- **The console's Microsoft half is MSAL `loginPopup`** (parent session's read of the
  console repo, 2026-09-29 — not re-derived here): a popup window must exist with a
  live **opener relation** (`window.opener`, `postMessage` both ways, `popup.closed`,
  auto-close on success). The same repo deliberately moved Google to same-window
  navigation because constrained surfaces break cross-window messaging — which is why
  exactly one half of that page works here.
- **Root cause, confirmed at source.** `wireView`'s `setWindowOpenHandler` denies every
  popup, `about:blank` included, and only *offers* http(s) URLs to the renderer:
  `src/main/browser/index.ts:868-881` (log at `:870-872`, IPC at `:873-876`). A denied
  `window.open` returns `null`; no amount of URL-offering can rebuild the MSAL
  contract — the handler's own comment says exactly that (`:862-867`: "POST bodies,
  window.opener and postMessage exchanges cannot be recreated safely from a blocked
  popup's URL").
- **The precedent to follow** is the main window's handler, `src/main/index.ts:898-978`:
  a trusted set (Google/Microsoft/storagerelay) allowed as real child `BrowserWindow`s
  via `overrideBrowserWindowOptions` (`:940-973`, with the load-bearing note that only
  that key is honoured, not `features`, `:943-948`), `about:blank` as an explicit case
  for MSAL init (`:922-938`), everything else denied to `shell.openExternal`
  (`:975-977`). Its **mechanics** are right for this fix; its **domain allowlist** is
  not (below).
- **Constraints that shape the fix.**
  - Driven views are hardened — `partition: "persist:local-operator-browser"`,
    `sandbox: true`, `contextIsolation: true`, no preload — `src/main/browser/index.ts:837-855`;
    the session's handlers (UA, permissions, downloads) are installed once on that
    session, `src/main/browser/profile.ts:155-235`.
  - The browser host module must not show/raise/activate anything
    (`src/main/browser/index.ts:89-93`), and `src/main/window-raise.ts` is the only
    module in `src/main` allowed to call `show`/`showInactive`/`focus`/`maximize`
    (`window-raise.ts:2-13`; enforced by the source scan at
    `scripts/window-mode.test.mjs:2186-2224`).
  - Every launch resolves a mode whose show plan is `focus` | `inactive` | `never`
    (`src/main/window-mode.ts:48`, per-mode table `:184-203`), and the browser host
    already receives that plan (`windowShow`, `src/main/browser/index.ts:117`, passed
    at `src/main/index.ts:3429`).
- **Acceptance** (from the operator ask): console MS sign-in completes reliably from the
  app browser with no retry roulette; Google re-verified; at least one popup-based MCP
  OAuth login exercised. §5 splits this into what runs credential-free and what needs
  the operator's click.

## 1. Popup policy for driven pages

**Recommendation: allow `about:blank` and http(s) popups from driven pages as real
child windows; deny every other scheme; deny popups from popups; cap live children per
view.** Do **not** copy the main window's domain allowlist. Reasons, in order:

1. Driven pages are arbitrary web content — the handler's existing comment already says
   why the allowlist was not copied (`src/main/browser/index.ts:862-865`), and an
   allowlist sized for the app's own two providers would need to name every IdP a user
   or agent may meet (Okta, Auth0, WorkOS, Entra variants, self-hosted). A miss breaks a
   page silently. The boundary here is the **hardened window** (§2), not a URL list.
2. The failure mode a deny-all produces (a page's feature silently broken) is worse and
   harder to diagnose than a bounded window appearing; the operator's bug is that class
   of silent breakage.
3. What the allowlist was protecting against — unexpected windows on the operator's
   screen — is handled by **presentation policy per launch mode** (§2) plus the cap,
   which act on *where a window can appear*, which is the actual risk, rather than on
   *what a page may open*, which is guesswork.

### 1.1 The decision table

| `details.url` / origin of the request | decision |
|---|---|
| `about:blank` (exact string, as `src/main/index.ts:929` does) | **allow** — MSAL opens `about:blank` first and navigates it; a denied blank popup is the failure being fixed |
| parsed scheme `http:` / `https:`, any host, any `disposition` | **allow** |
| form POST `target=_blank` (same URL check; `details.postBody` carried by Electron) | **allow** |
| everything else — `file:`, `javascript:`, `data:`, `blob:`, `chrome:`, `devtools:`, `about:` (non-blank), custom schemes (`msauth:`, `mailto:`, …) | **deny, log only** (today's non-http branch, `src/main/browser/index.ts:877-879`, kept) |
| any popup **from a popup** (`window.open` inside a child) | **deny, log** — children get their own deny-all handler (§3); no known auth flow nests popups, and unbounded nesting is what the cap would otherwise have to chase |
| beyond **4 concurrent live children per view** | **deny, log** (cap is a guard, not a contract; raise it only against a real flow that needs more) |

Disposition (`default` / `foreground-tab` / `new-window` / `background-tab` / `other`;
values per Electron docs, `webContents` § `setWindowOpenHandler`) **never** changes
allow/deny. It changes only presentation: `background-tab` may never foreground a window
(§2.4). `window.open` calls from script arrive with Electron's `default`/`new-window`
shapes; all that matters is that nothing here distinguishes "the user clicked" from
"script ran", because Electron exposes no gesture signal on this handler (accepted; see
§6).

### 1.2 The fate of the blocked-popup notice

**Remove it, and remove its plumbing.** After this change the `browser-popup-blocked`
channel has no user-actionable producer: http(s) popups open, non-http popups were
already log-only, and the remaining denials (cap, grandchildren) are guard rails, not
offers. The notice's one action, "Open in a new tab" (`browser-surface.tsx:607-620`),
could never carry a popup's contract anyway (the handler comment, `:862-867`) and cannot
load a non-http scheme at all (the view refuses non-http navigation, `:887-895`).

Sites to delete/adjust (all verified present):

- `src/main/browser/index.ts:873-876` — the `browser-popup-blocked` send.
- `src/preload/index.ts:871-890` — `onPopupBlocked`; `src/preload/index.d.ts:211`.
- `src/renderer/src/features/browser/components/browser-surface.tsx:242` (state),
  `:339-347` (subscribe effect + the "offered, never opened" comment), `:593-630`
  (the notice, incl. `data-tour-tag="browser-popup-notice"`).
- `src/renderer/src/features/browser/components/browser-pane.stories.tsx:224` (the
  stub prop).
- `src/renderer/src/shared/browser-view-policy.ts:161-166` — the comment counts the
  "blocked-popup line" among the chrome-band notices; update it.

This is a user-visible deletion (the band line disappears). It is exactly the kind of
delta the design round exists for (§5); if the design round wants a *replacement*
affordance for denied non-http popups, that is a new small design, not this brief.

Alternative considered and rejected: keep the notice, wired for denied schemas. It
would surface nothing the user can do (the CTA is dead by construction) and would keep
a channel alive with no producer — the "second mechanism beside the existing one" shape
this repo's reviews remove.

### 1.3 The security argument

**Preserved, unchanged by this fix:**

- The child is a web page like any other driven page: same session/partition
  (`persist:local-operator-browser`, §2.3), `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, `webSecurity: true`, **no preload** (`src/main/browser/index.ts:837-855`
  — mirrored explicitly in the popup's own options, §2.2).
- Session-level handlers apply to it automatically: default-deny permissions
  (`profile.ts:193-230`), arm-gated downloads (`profile.ts:231`), the Chrome-shaped UA
  (`profile.ts:182-185`), no CORS on the loopback RPC (design §11.7).
- The child cannot reach the app renderer: different partition, no bridge, the app's
  own IPC is sender-checked (`src/main/desktop-ipc.ts:100-107`).
- Navigation limits inside the child (§3) keep the scheme rule identical to the view's.
- The operator can always close it; nothing about it is unclosable or modal.

**The new thing, stated plainly:** an agent-driven page can now create a window that did
not exist before. That is bounded by:

- **mode**: headless never shows a window at all (`never`); inactive shows it without
  focus; only `normal` can focus one (§2.4). A page under agent control in a headless
  run therefore cannot put anything on the operator's screen.
- **cap**: ≤4 live children per view; beyond that, deny+log (§1.1).
- **disposition**: `background-tab` never foregrounds even in `normal` (§2.4).
- **cleanup**: children die with their opener unless explicitly told otherwise
  (§3.2) — the default the pinned `d.ts` documents
  (`node_modules/electron/electron.d.ts:20570-20573`).
- **observability**: every allow and deny logs one greppable line (§8), so a run can
  answer "which page opened a window and did anyone see it" from the app log.

**Residual risks accepted** (watched in §6): no gesture signal exists to distinguish a
user-clicked popup from a scripted one, so in `normal` mode a driven page can raise a
window while the operator is at the desk. This matches the normal web model (the page is
web content in the operator's own app), and the alternative — gating on gestures we
cannot see — would break exactly the legitimate flows this fix exists for.

## 2. Presentation

### 2.1 Child `BrowserWindow` (Electron default), not `createWindow`

**Recommendation: return `{ action: "allow", overrideBrowserWindowOptions: { … } }` and
configure the child in `did-create-window`.** Both mechanisms exist at the pinned
version — `WindowOpenHandlerResponse` carries `createWindow?: (options) =>
WebContents` and `outlivesOpener?: boolean` (`node_modules/electron/electron.d.ts:20553-20576`),
and `did-create-window` is on `WebContents` (`:16651`).

Why the default child wins:

1. **Precedent.** The main window's working auth popups are built exactly this way
   (`src/main/index.ts:949-972`); its review history already caught the one trap this
   API has (a `features` response that was silently ignored, `:943-948`). Reusing the
   honoured key and the same shape is the smallest change that works.
2. `createWindow` would make us reconstruct the merged options ourselves (docs: the
   constructed window "should use passed `options` object") and it *suppresses*
   `did-create-window` (`electron.d.ts:20564-20567`) — every bit of configuration moves
   into hand-rolled code with no reviewer-visible precedent.
3. `createWindow` has a known disposition wart in exactly our use shape — for
   `background-tab`, `options.webContents` is `undefined` because creation is deferred
   (electron/electron#49307, closed via #49379, labelled 38-x/39-x). We do not need to
   litigate whether 44.3.0 is clean: we are not using it.
4. The one thing `createWindow` would buy — attaching listeners before the first network
   request — is not needed: the **initial** popup URL is vetted by the open handler
   itself, and `did-create-window` fires during creation, before any response or script
   runs, so every later navigation and redirect is covered (§3.1).

### 2.2 The exact options

```ts
// wireView(view) — replaces src/main/browser/index.ts:868-881
contents.setWindowOpenHandler((details) => {
  const decision = decidePopup(details, {
    mode: plan.show,               // "focus" | "inactive" | "never" (already passed in)
    live: popupCount(tabId),       // §1 cap
  });
  if (!decision.allow) {
    log(`[browser] refused a popup from a driven page: ${details.url} (${decision.reason})`);
    return { action: "deny" };
  }
  log(
    `[browser] tab ${tabId} opened a popup: ${details.url} ` +
    `(disposition=${details.disposition}, presentation=${decision.presentation})`,
  );
  return {
    action: "allow",
    overrideBrowserWindowOptions: {
      width: 640, height: 720, minWidth: 480, minHeight: 560,
      center: true, frame: true, autoHideMenuBar: true,
      show: false,                                    // §2.4 — nothing shows itself
      focusable: decision.presentation !== "never",  // defence in depth (d.ts + main/index.ts:709-719)
      backgroundColor: "#FFFFFF",
      webPreferences: {
        partition: BROWSER_PARTITION,                 // EXPLICIT — §2.3
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        backgroundThrottling: plan.backgroundThrottling, // §2.5
        // no `preload` — a popup has no bridge, like the view
      },
    },
  };
});
contents.on("did-create-window", (child, details) => wirePopup(child, details, ctx));
```

Notes:

- `show: false` is the load-bearing line: a popup must never show itself; presentation
  happens only through the mode-gated path (§2.4).
- The main window's list is the model; `enableWebSQL` is dropped from it because WebSQL
  is gone from current Chromium (Electron release notes for v31 removed it), and
  `titleBarStyle`-class chrome options are irrelevant for a child.
- `backgroundThrottling` and `focusable` are **not** security-inherited and must be
  passed (or set, §2.5) explicitly; everything else above is belt-and-braces over what
  Electron inherits.

### 2.3 Session, cookie and UA sharing — the explicit partition

The popup must live in `persist:local-operator-browser` (`src/main/browser/profile.ts:26`).
Two Electron facts make the explicit `partition` in the options necessary rather than
implicit:

- Constructor options are merged "in increasing precedence: parsed options from the
  features string … security-related webPreferences inherited from the parent, and
  options given by `setWindowOpenHandler`" (Electron docs, `window.open`). Only
  *security-related* prefs are inherited; `partition` is not guaranteed among them, and
  a popup created in a different session is **not related** to its opener — Chromium
  severs `window.opener`, which is the entire MSAL contract. (This is the "EXPLICIT
  BROWSER_PARTITION sharing" requirement and the reason it is stated twice.)
- For `about:blank` children there is a documented exception: "the child window's
  WebPreferences will be copied from the parent window, and there is no way to override
  it because Chromium skips browser side navigation in this case" (Electron docs,
  `window.open`). Parent here is the driven `WebContentsView`, whose copied set is
  exactly the hardened one (`src/main/browser/index.ts:837-855`, partition included) —
  so the blank case lands in the same session with the same hardening, by copy instead
  of by our options.

Consequences that must hold and are asserted in the tests (§5): cookies visible to the
opener are visible to the popup and vice versa (one jar); the session UA — set before any
view exists (`profile.ts:182-185`) — is what the popup presents; the child's storage
belongs to the browser profile, never the app's renderer.

### 2.4 Per-mode show policy, and where the code is allowed to live

| launch mode (plan `show`) | disposition | effective presentation | what actually happens |
|---|---|---|---|
| `normal` (`focus`) | `default` / `foreground-tab` / `new-window` / `other` | `focus` | `show()` — activates the app and focuses the popup, as a browser popup does |
| `normal` | `background-tab` | `inactive` | `showInactive()` — visible, never foregrounded |
| `inactive` | any | `inactive` | `showInactive()` |
| `headless` (`never`) | any | `never` | never shown, never focused; the window exists, hidden, drivable/capturable via CDP |

Mechanics:

- New export `presentPopupWindow(window, show, context)` in `src/main/window-raise.ts`,
  modelled on `presentMiniView` (`window-raise.ts:935`): it computes the effective show
  from the table above, and delegates to the existing `presentWindow`
  (`window-raise.ts:182-201`), which already implements `show` / `showInactive` / "do
  nothing" and emits the standard `[window-raise]` line. Add a `RaiseTrigger` member
  (e.g. `"popup-open"`) to the union (`window-raise.ts:82-105`) and to the test's list
  (`scripts/window-mode.test.mjs:1236-1245`) — that list's whole purpose is to force a
  line for every new trigger.
- The browser host calls `presentPopupWindow` — it never touches `show*`/`focus` itself
  (the guard scan, `scripts/window-mode.test.mjs:2186-2224`, and the module's own
  contract, `src/main/browser/index.ts:89-93`).
- `headless` still **creates** the child. That is deliberate and does not contradict
  `canCreateWindowFor` (`window-raise.ts:220-222`, refusing to *create* a window for a
  `never` plan): that rule exists so a conversation delivery cannot leave an invisible
  window holding the operator's work; a driven page's popup exists for the **page's own
  flow** and is reachable by CDP, and no human was ever going to see it in a headless
  run. State this in the code comment; a reviewer will ask.
- `show:false` is honoured per §2.2; because the `about:blank` clause above makes any
  *override* behaviour suspect until measured, the wrapper also carries a second line of
  defence for `never`: if the window reads visible, `hide()` it immediately and log
  loudly (a fired fallback is a bug to fix, not a feature). The e2e proof (§5) is the
  falsifier that must show the fallback never fires.
- Normal-mode `show()` activates the app on macOS — measured and documented
  (`window-raise.ts:9-11`, UI `AGENTS.md:955-963`). For an operator-clicked popup that
  is the browser contract (the user asked for it). It is the one presentation where a
  *headless* launch must never reach, and the mode gate is what stops it.

### 2.5 Background throttling for hidden popups

The main window holds full rate in non-`normal` modes on purpose
(`window-mode.ts:184-203`, comment `:175-183`; `src/main/index.ts:734-743`). The popup
should match: pass `backgroundThrottling: plan.backgroundThrottling` in the options
(needs one new field on `StartBrowserHostOptions`, fed from `windowLaunch.backgroundThrottling`
at `src/main/index.ts:3429`'s call site) **and** call
`child.webContents.setBackgroundThrottling(false)` in `wirePopup` whenever
`plan.backgroundThrottling === false` — the post-creation call covers the `about:blank`
children whose prefs cannot be overridden (this is the documented
`webContents.setBackgroundThrottling(allowed)` method). The observable consequence: a
headless capture of a popup is a full-fidelity frame, same as the view's
(UI `AGENTS.md:933-963`).

### 2.6 How a headless rig drives and captures the popup

- **Drive**: the popup is a first-class CDP target on the app's devtools port. The e2e
  proof already opens `--remote-debugging-port=${DEVTOOLS_PORT}` on the app
  (`scripts/browser-host-proof.mjs:314`) and resolves targets via `/json/list` +
  WebSocket (`:437-445`); the popup appears there under its own `webSocketDebuggerUrl`
  for the whole of its life. The deterministic parity page performs its own scripted
  dance (opener/postMessage/cookie/close) so nothing needs driving mid-flow; the rig
  drives only to *hold* a popup open when capturing.
- **Capture**: use CDP `Page.captureScreenshot` against the popup target, for the reason
  the driver already refuses `capturePage` for page content (`src/main/browser/cdp.ts:26-31`:
  `capturePage`'s visibility-forcing semantics change what a page renders). The frame is
  the "popup under headless" evidence in §5.
- **Reading "no window appeared"**: the popup log line's `presentation=never` token,
  plus the standing app-not-frontmost sampling the repo already has for captures
  (`scripts/browser-chrome-proof.mjs:1070-1104` is the osascript frontmost sampler).
  Both readings go in the proof transcript.

## 3. Navigation/scheme limits inside the popup, and cleanup

### 3.1 `wirePopup` — what the child gets

Attached synchronously in `did-create-window`:

- `setWindowOpenHandler(() => ({ action: "deny" }))` with a log line — **no grandchildren**
  (§1.1).
- `will-navigate` / `will-redirect` → refuse anything that is not http(s)/`about:blank`,
  reusing the same predicate and parse-don't-prefix rule as the view
  (`src/main/browser/index.ts:883-903`, `src/main/browser/settle.ts:184-187`). The
  initial browser-side load is not covered by `will-navigate` (that event is for
  renderer-initiated navigations) — accepted, because the initial URL was vetted by the
  open handler a line earlier, and every hop a response or script then takes is covered.
- `will-attach-webview` → `preventDefault()` (mirror `src/main/browser/index.ts:951-955`).
- Track in a per-view `Set`; remove on `closed` (feeds the cap and the cleanup story).
- `presentPopupWindow(child, effectiveShow, { trigger: "popup-open", report })` (§2.4).
- No registry, no tab id, no state file, no CDP driver attachment, no `notifyChanged` —
  the popup is not a tab and must not become one (the e2e proof asserts the tab count
  stays put: `scripts/browser-host-proof.mjs:896-903`).

### 3.2 Cleanup semantics

- **Opener closes → children close.** The default, documented at
  `electron.d.ts:20570-20573` ("By default, child windows are closed when their opener is
  closed"); do not pass `outlivesOpener`. This covers the tab-close path for free: a
  closed tab destroys its view's webContents (`src/main/browser/index.ts:1006-1029`,
  `releaseView`), which is the opener.
- **App quit** closes all windows; nothing to add.
- **The user closes the popup** (or the page calls `window.close()` — script-opened
  windows may) → the `closed` handler drops it from the per-view set; `popup.closed`
  reads true to the opener (Chromium relation, §2.3).
- **Same-name windows** (`window.open(url, "name")` while a window named `name` lives)
  are reused by Chromium — a retry does not stack windows; note it so the cap is not
  misread as blocking legitimate retries.
- **Not restored, not recorded**: popups appear nowhere in `session.json` or the chrome
  (`src/main/browser/index.ts:626-641` restores tabs only). Closing the app ends them.

## 4. Renderer / design deltas

The renderer change is a deletion, itemised in §1.2: the `browser-popup-blocked` channel,
its preload surface, the `blockedPopup` state, the notice JSX and its storybook stub, and
two comments that describe the old policy (`browser-surface.tsx:339-347`,
`browser-view-policy.ts:161-166`). Nothing new renders; the chrome band is otherwise
untouched, and no layout, colour or copy work is proposed.

What the design round should verify with rendered frames (not source):

1. The chrome band with the notice gone — no gap, no stray border (the band is a row in
   `browser-surface.tsx:543-630`; removal must not shift the transfer/consent rows).
2. Optionally, the popup window itself in a `normal`/`inactive` run (a native window; in
   situ frame captured from inside the app, per `AGENTS.md:1042-1048` — never macOS
   `screencapture`).

UX round: no interaction flow inside the app changes; the popup's own flow is the site's.
If the design round judges that a denied-scheme popup needs a replacement affordance,
that is its own small design (see §1.2).

## 5. Test and evidence plan

### 5.1 Deterministic, credential-free (the PR's core proof)

1. **Policy matrix — desktop suite** (`scripts/browser-host.test.mjs`, the fake-based
   contract suite; its own header is explicit that these are rule tests, not proof the
   feature works). Add the new module to the suite's export list (`:42-85`) and test the
   pure decision function exhaustively: `about:blank` allow; http(s) allow; every denied
   scheme; grandchildren deny; cap boundary (4 allowed, 5th denied); disposition →
   presentation mapping for all three modes; the effective-show table in §2.4. The suite
   bundles the shipped TypeScript in memory, so a pure function is enough for the matrix.
2. **Source guards — `scripts/window-mode.test.mjs`.** Add `"popup-open"` to the trigger
   list (`:1236-1245`) so the line format test covers it (`:1266+`), and add a named
   regression test in the shape of the mini-view one (`:2226-2247`): the popup code
   contains no `show|showInactive|focus|maximize` call and reaches presentation only
   through `presentPopupWindow`. (The general scan, `:2186-2224`, already fails any
   bypass; the named test pins the intended path so a deletion cannot satisfy it
   vacuously.)
3. **End-to-end popup parity — `scripts/browser-host-proof.mjs`** (boots the built app
   headless against its real `/rpc`; isolation discipline `:14-35`; do not weaken it).
   The local site already carries a popup attempt (`:190-197`) and an assertion that it
   is blocked (`:892-903`) — flip and extend:
   - Opener page: a `#popup-open` control that `window.open("/popup-target", "proofpopup")`
     and records, in `#popup`, each event as it arrives.
   - Popup page: assert `window.opener !== null`; `postMessage` to the opener and wait
     for the opener's reply; set a cookie and re-read it; call `window.close()`.
   - Opener: record "opened / opener=yes / ack=yes / cookie=shared / closed=yes" and
     assert `popup.closed` became true; assert the opener never navigated.
   - Assertions: the dance all-green via an `rpc read` of `#popup`; the `tabs` count is
     still 1 (`:896-903` pattern); the app log carries the `opened a popup` line with
     `presentation=never` (headless); the log carries the `about:blank` case too (open
     a second popup with `""`, assert allowed); a denied-scheme open (e.g.
     `window.open("mailto:…")`) logs the refusal and creates nothing; the grandchild
     attempt inside the popup is refused; closing the tab while a held popup is live
     makes the popup target disappear from `/json/list` (opener-close cleanup).
   - Capture, while a `/popup-target?hold=1` popup is open: connect to its target and
     `Page.captureScreenshot` → committed frame (this is the popup-under-headless
     artifact; run it once more with `about:blank`-first to cover the copy-prefs case).
   - Keep/replace the existing log assertion at `:1138-1143` ("blocked a popup" →
     the new tokens) and re-record the transcript.
4. **Live, credential-free half** (QA, or the operator pre-signing-in): boot the current
   build in `normal` mode on a scratch profile with a devtools port (the
   `browser-chrome-proof` shape), drive the app browser to
   `https://console.radienthq.com/login`, click "Continue with Microsoft", and assert:
   a popup target appears; its URL host is a Microsoft sign-in host; the opener page's
   own MSAL flow is now waiting (not erroring). Do **not** sign in. Same run: click
   "Continue with Google" and assert the same tab starts navigating to
   `accounts.google.com` (regression guard for the working half). This is the run that
   can falsify "the popup opens but Microsoft still refuses the surface" (§6).

### 5.2 What needs the operator's hands (documented, not scripted)

- **Console MS acceptance**: operator completes the Microsoft sign-in in the popup, from
  the app browser, **twice in a row on a fresh state** (the acceptance says "no retry
  roulette"; one success does not distinguish luck from fix). Capture before/after: the
  current failure panel (before) and the signed-in console (after).
- **Google re-verify**: operator completes the Google flow once; confirm no change.
- **MCP reauth exercise** (the acceptance's "popup-based MCP OAuth login"): the live case
  is `minerva-qa` (`https://mcp.qa.gominerva.com/mcp`), sign-in expired.
  - **How the app-browser surface is entered, pinned:** neither automated MCP path
    targets it — the desktop panel's `desktop-open-authorization` resolves the URL from
    `auth.status` and hands it to `shell.openExternal` (`src/main/desktop-ipc.ts:327-368`),
    and the runtime's own grant prints the authorization URL and opens the **system**
    browser (`~/local-operator/local_operator/mcp/auth.py:2452-2477`, via
    `open_browser_quietly`, `:705-736`). So QA enters the app-browser surface by
    **navigating a driven tab to the printed authorization URL**. That navigation is
    user-driven and therefore not origin-gated (`src/main/browser/host.ts:1086-1103`;
    the gate is armed only around agent navigations, `src/main/browser/actions/gate.ts:16-22`);
    the provider's redirect lands on the loopback listener the flow advertises
    (`auth.py:4111-4125`, default `http://127.0.0.1:<port><path>`), which the view's
    scheme rule permits (`http:`).
  - **Steps**: run `lop mcp reauth minerva-qa` (or `/mcp reauth minerva-qa` in the TUI);
    copy the bracketed URL it prints (`auth.py:2469-2474`); paste it into the app
    browser's URL bar; complete the provider sign-in (**operator's credentials — the
    remaining human step**); confirm the redirect resolves and the server flips to
    connected (panel row or `mcp list`). Record the flow's shape as observed (popup vs
    plain redirect): the popup policy is under test wherever a popup appears, and the
    console's MS flow already exercises it beyond doubt. `reauth` deletes the stored
    credential before re-granting (`docs/design/mcp-auth-experience.md:320-342`), so do
    this once, knowingly.

### 5.3 Evidence to commit / attach

- Frames: headless popup capture(s) from 5.1.3; the live before/after pair from 5.2;
  (design round) the band without the notice. Follow the repo's evidence conventions —
  new set under `docs/evidence/<surface>/` with its README, frames named
  `<name>/<theme>.webp` (`docs/evidence/browser-composition/README.md:1-6`).
- **Manifest re-stamp** (required, this is the trap): a commit moving `src/` or
  `scripts/` invalidates `docs/evidence/manifest.json`'s `srcTree`/`scriptsTree` for
  everyone; the order is **commit → derive `git rev-parse HEAD:src` / `HEAD:scripts` →
  write the values into the manifest → `--amend`** (UI `AGENTS.md:126-147`). A local
  green is not a pass; the citation half stands down on shallow clones (`:149-172`).
  *(2026-10-01: `pnpm evidence:fold` performs that whole sequence - derive, write,
  run the guards, and `--amend` where the tip is the merge commit and only `docs/`
  moved - so the order above is what the command does, not a list of steps to
  follow by hand.)*
- Gates for the coder, all of them: `pnpm lint`, `pnpm lint:scripts`,
  `pnpm check-types`, `pnpm build`, `pnpm test:desktop`, `pnpm check-changed` (the local
  equivalent of the CI job set; a skipped job is a claim, not a pass — `AGENTS.md:1470-1507`).
  `pnpm check-evidence` takes a machine-wide lease — read `AGENTS.md:108-124` before
  running it, never delete its lock.
- Suggested commit: `fix(browser): open driven-page OAuth popups as gated child windows`
  — body states the deny-all history, the MSAL contract, the mode/cap/cleanup bounds,
  and the evidence pointers.

## 6. Risks and open questions

1. **Microsoft-side policy / UA.** The session presents a plain Chrome-shaped UA with no
   `Electron/` and no `LocalOperator/` token (`src/main/browser/profile.ts:26-58`, function
   `:92-104` — the product token was removed after a measured challenge stall, so do not
   reintroduce one "for identification"). That is the best available shape; whether
   Microsoft's risk engines still refuse popup sign-in from a non-branded Chromium is
   **not settled by code** and is exactly what the §5.2 run settles. If it fails, the
   discriminator is the popup's own console (`/json/list` target → its CDP console) plus
   the flow's failure point — record both before theorising.
2. **COOP / opener severing.** A hop that sends `Cross-Origin-Opener-Policy: same-origin`
   severs the opener and MSAL fails with its "could not be completed" class of error even
   with the popup open. Real browsers run this flow, so the pages are expected to be
   compatible; if the live run fails *with the popup open and loading*, check the popup's
   `window.opener` and the parent document's own console first — then it is a
   console-side issue, not this one.
3. **Electron 44.3.0 specifics to falsify in the proof, not assume:**
   - whether `show:false` in `overrideBrowserWindowOptions` is honoured for `about:blank`
     children (the copy-prefs clause makes this the one option whose override path is
     suspect; the §2.4 fallback logs loudly if it fires);
   - that `did-create-window` fires before the child's first response (listener
     attachment order for redirect checks);
   - that a child in the explicit partition keeps a live `window.opener` (the whole
     reason §2.3 exists).
4. **Focus in `normal` mode.** `show()` activates the app (macOS; `window-raise.ts:9-11`).
   For a user-visible popup that is correct; for a scripted popup on an agent-driven page
   it is a window the operator did not ask for (bounded: `normal` only, cap, closable,
   logged). Watch the first weeks via the log line; if it bites, the lever is a
   user-gesture requirement that Electron does not currently expose — a platform
   limitation to record, not to paper over.
5. **Cap number (4) is a judgement**, not a measurement: MSAL uses one window per flow,
   retries reuse the same-named window, and the cap only exists to bound abuse. If a real
   provider needs more, raise it with the observed flow named in the commit.
6. **The `about:blank` first-hop is invisible to the scheme guard** by construction (§3.1);
   the operating control is that the blank document is same-origin with its opener and
   short-lived. Stated rather than mitigated further; the e2e test covers the allowed
   blank case explicitly.
7. **Un-resolved: popup size/position requests** (`window.open(..., "width=…")`
   features). We ignore `features` wholesale (and override size), matching the main
   window handler (`src/main/index.ts:943-948`). MSAL does not depend on it; if a real
   provider does, that is a follow-up, not a blocker.

## 7. Non-goals and follow-ups

- **Not ours — console-side redirect fallback for Microsoft.** The console repo could
  align Microsoft with the same-window pattern it already chose for Google (parent
  session's read, 2026-09-29: Google was moved to same-window navigation because
  constrained surfaces break cross-window messaging). That is a **possible follow-up MR
  in that repo; context line for this PR only** — this fix makes the popup surface work,
  which is what the app owes a page that legitimately uses it.
- **Not ours, recorded for the PR context:** neither MCP entry path targets the app
  browser today (system browser via `shell.openExternal` / `webbrowser.open`, §5.2). A
  follow-up could let the desktop panel mint its authorization URL into the app browser
  instead of the system browser — backend/desktop scope, out of this PR.
- **Not in scope:** custom-scheme redirects (`msauth:`, `ms-appx-web:` …) and any
  system-browser fallback for denied schemes; popups from popups; agent/CDP actions
  targeting popups (the driver drives views; popups are invisible to it); popup chrome,
  tab-strip integration, restore; per-popup consent UI; gesture gating (no signal
  exists — §6.4).
- **Follow-up, cross-repo:** amend §11.6 of `docs/design/ui-browser-tab.md` (lives in
  `~/local-operator`, `:2056-2066`) — it currently mandates deny-all for driven views and
  cites exactly the reasoning this brief supersedes. The PR body should name it so the
  next reader is not left with two contradicting designs.

## 8. Implementation checklist (files and shapes)

1. **`src/main/browser/popups.ts` (new; or the same shapes inside `index.ts`)** — pure
   `decidePopup(details, {mode, live})` → `{allow:false, reason}` /
   `{allow:true, presentation: "focus"|"inactive"|"never"}`; the allow/deny table of
   §1.1 in one place. Export it for the desktop suite's in-memory bundle (add the line to
   `scripts/browser-host.test.mjs:42-85`).
2. **`src/main/browser/index.ts`** — replace `:868-881` with the handler above; add
   `did-create-window` wiring (`wirePopup`: child handlers, tracking set, cap,
   `setBackgroundThrottling`, `presentPopupWindow`, `closed` cleanup); add
   `backgroundThrottling` to `StartBrowserHostOptions` (`:117` neighbourhood); keep
   logging one line per allow/deny.
3. **`src/main/window-raise.ts`** — `presentPopupWindow` (effective-show table §2.4, the
   `never` fallback-hide), plus `"popup-open"` in `RaiseTrigger` (`:82-105`).
4. **`src/main/index.ts:3429`** — pass `backgroundThrottling: windowLaunch.backgroundThrottling`
   beside `windowShow`.
5. **`scripts/window-mode.test.mjs`** — trigger list + popup named regression test (§5.1.2).
6. **`scripts/browser-host.test.mjs`** — policy matrix (§5.1.1).
7. **`scripts/browser-host-proof.mjs`** — popup section rewrite + assertions + capture
   (§5.1.3); update `:892-903` and `:1138-1143`.
8. **Renderer/preload deletions** — §1.2's list.
9. **Evidence** — frames per §5.3; manifest re-stamp in the commit → derive → amend order
   (one command since 2026-10-01: `pnpm evidence:fold`).
10. **Gates** — §5.3's list; the QA/design/review rounds per the repo's standing rules.

Nothing in this list is optional; anything the implementer finds impossible is a finding
to bring back, not a silent omission.
