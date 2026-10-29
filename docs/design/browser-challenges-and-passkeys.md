# Browser challenges, captchas and passkeys

Status: **implemented on `fix/cloudflare-challenge-and-passkeys`** (branch cut from
`origin/main` = `548f8dfed`, version 0.28.4). Every number in this document was
produced by a command in it, on this machine, Electron 44.3.0 / Chromium
152.0.7977.78, macOS 25.6.0. Evidence frames are under
`docs/evidence/browser-challenges/`.

Read with: `docs/branding.md` (the design contract the chooser's copy follows),
`AGENTS.md` (window modes, evidence workflow, what a rig must redirect), and
`docs/design/ui-browser-tab.md` in `damianvtran/local-operator` — the browser
feature's design authority, whose §9.2 origin gate this document corrects.

---

## 0. The three reports

1. **A Cloudflare interstitial never passes.** The operator's screenshot: a page
   opened by an agent, the Approvals tray showing a grant, the Cloudflare
   "Verifying you are human" interstitial rendered — and the challenge never
   completing, including when it was solved by hand.
2. **Passkeys never reach the OS.** `navigator.credentials.create()`/`.get()`
   have no path out of the app, so a site offering a passkey gets nothing.
3. **The user agent stops the challenge completing at all.** Measured (§2): with
   the app's `LocalOperator/<version>` product token the managed challenge never
   completes, and with a plain Chrome string it completes in about two seconds.

They are unrelated defects that landed in one branch because they are the three
halves of "the built-in browser tab is not a browser yet". Which of (1) and (3)
explains the operator's single observation is answered in §4.2: the fix for (1)
is measured on a deterministic reproduction, the fix for (3) is measured as the
string the page presents, and the pass/fail discrimination between the two user
agents was measured in the shape §2 records rather than in the app's own view.

---

## 1. Root cause of (1): the origin gate refuses SUBFRAME documents

The gate (`src/main/browser/actions/gate.ts`) is armed around every
agent-initiated navigation and is right to be: a navigation is not one request,
and a host that checks only the URL it was handed has delegated the agent's reach
to whatever the first response says. It arms CDP `Fetch.enable` with

```
patterns: [{ resourceType: "Document", requestStage: "Request" }]
```

and the design's own words for that line were "*Chromium pauses every
Document-stage request for us while the gate is installed, so each hop is decided
on its own*" (design §9.2). That sentence assumed `Document` meant **navigation**.
It does not: CDP's `Document` resource type covers **subframe documents**.

Measured on two loopback origins, the app's own gate shape, only origin A
approved — the committed probe is `scripts/browser-gate-frames-probe.mjs`, run as
`node_modules/.bin/electron scripts/browser-gate-frames-probe.mjs`:

```
PAUSED type=Document frameId=31E4C824… CONTINUE http://127.0.0.1:<A>/top.html
PAUSED type=Document frameId=AB4B3DC7… REFUSE   http://127.0.0.1:<B>/frame.html
frames after top: main=31E4C824… children=[{"id":"AB4B3DC7…","url":"chrome-error://chromewebdata/"}]
```

The subframe's own document is failed with `BlockedByClient`. So for the whole
time an agent navigation is in flight, **every cross-origin iframe on the page is
refused**: Cloudflare's Turnstile widget (`challenges.cloudflare.com`), SSO
frames, embedded logins, payment frames, consent widgets. The human's click lands
on a widget whose own document was refused before it ran, which is exactly the
reported symptom — and the same defect degrades the pages the approval system
exists to make reachable.

### 1.1 How the fix attributes a paused request to the main frame

The paused request carries a `frameId`, and `Page.getFrameTree` names the top
frame. Measured, because the fix depends on it: **the main frame's id is stable
across a cross-origin navigation of that frame** — the same id came back before
the load, on the top-level document's own paused request, and again on a
cross-origin navigation of it (`MAIN-FRAME-ID-STABLE true`), and the probe exits
0 printing exactly that.

The gate therefore decides only requests whose `frameId` equals the main frame's,
and continues every other paused Document untouched. Its security property is
unchanged: an unapproved main-frame hop, including every hop of a redirect chain,
is still refused with `origin_not_allowed`, because the main frame is what the
comparison is against.

Two deliberate edges:

- **An unattributable request keeps the strict decision.** A paused Document with
  no `frameId` is not evidence that it is a subframe, so it is gated as a hop and
  counted; the count is logged once per operation, so the fallback is visible if
  it ever runs.
- **A frame tree that cannot be read fails closed.** `Page.enable` +
  `Page.getFrameTree` are bounded and their failure returns null, which keeps
  today's rule (every paused Document decided) and logs one line saying the
  navigation was gated on every Document request. Measured, for why the read is
  only safe on a target that has a document: on a target that has never
  navigated, `Page.enable` never answers at all (90 s, no reply). The app's own
  paths call `cdp.attach` immediately before the gate arms, and `attach` loads
  `about:blank` for a view that has never navigated, so the read always has
  something to ask.

### 1.2 The user-visible bug class, which is bigger than captchas

The gate's scope is a defect about **iframes**, so it is not only captchas: any
page an agent opens whose login, consent, embedded payment or SSO frame lives on
another origin had that frame refused for the duration of the navigation. The
captcha is the symptom the operator hit; the class is "cross-origin frame
documents are refused during an agent navigation".

### 1.3 What this is NOT: the throttling hypothesis, measured and dropped

An earlier round of this investigation concluded that `backgroundThrottling`
(which `buildView` leaves at Electron's default) was the cause. It is not, and
the change was dropped rather than dressed up. The five-way matrix on a local page
that needs timers and frames to complete, run in the app's own view shape
(`/tmp/cfpasskey/probes/mech.cjs`, scratch — the committed rig's local arm drives
the same shape):

| window | view throttle | window throttle | result |
| --- | --- | --- | --- |
| shown, pinned above everything | on (today's `buildView`) | on | COMPLETE, rAF ~120/s |
| shown, pinned | on | off | COMPLETE |
| shown, pinned | off | on | COMPLETE |
| shown, pinned | off | off | COMPLETE |
| **never shown** (a headless/agent launch) | on | on | page frozen, samples never answered |
| never shown | on | off | one partial answer, then frozen |
| never shown | off (either) | either | frozen |
| never shown | n/a — the window's own webContents | on | COMPLETE, rAF ~220/s |

The separating variable is whether the window is **occluded/never shown**, not the
throttle knob: with the window on screen, throttling on and off are identical. So
`backgroundThrottling` fixes nothing measurable here and is not part of this
branch.

### 1.4 The frozen-tab limit, documented rather than fixed

A driven tab whose window is occluded or never shown is hidden to Chromium: its
`requestAnimationFrame` stops, its timers stop, and an `executeJavaScript` that
awaits a two-second timer never returns at all (measured above; the same shape as
the manager's probe). Cloudflare's widget additionally refuses to solve while
`document.visibilityState` is hidden.

So a captcha can only complete in a tab whose **window is actually on screen**.
That is a limit of this design, not something this branch fixes, and it is the
reason the real-site evidence arm runs `--window-mode=inactive` (a visible,
never-activated window) rather than `headless`: a headless run cannot solve a
captcha, and a rig that claimed otherwise would be measuring its own blindness.

---

## 2. The user agent, and why the product token is gone

Third defect, same report, and the one that matches the operator's words most
directly: the challenge renders, the page is alive, and it never completes.

`browserUserAgent()` used to return Chromium's own Chrome-shaped string with the
`Electron/` token dropped and a `LocalOperator/<app version>` product token
appended — the design's (16.4) recommendation (c), a "middle path that still
identifies the app", with the experiment that would settle it named in the same
sentence: "*Settled by:* probing the operator's own sites". That experiment has now
been run, on exactly the page in the report, one variable changed, in a **plain
window whose own webContents loaded the URL** — not in the app's driven-view
shape, which is the distinction §2.1 and §2.2 exist to keep honest:

| arm | presented UA | result |
| --- | --- | --- |
| window's own webContents | plain Chrome string | challenge completes in ~2 s: title `Page not found – Muddy River News`, no challenge element, rAF ~430/s |
| window's own webContents | the same + `LocalOperator/<version>` | stuck on `Performing security verification` for 30 s, page ALIVE (rAF ~385/s, `visibilityState` `visible`) |
| the same, permission pair installed | `LocalOperator/<version>` | stuck identically |
| default UA with the permission pair | plain | inconclusive: the run hung and produced no samples |

So this is not the freeze of §1.4 and not the permission handlers: Cloudflare
serves the interstitial and then never completes it for a UA it does not trust.
The answer to 16.4's question is (b) — a plain Chrome string — not the (c) that
revision recommended, and `browserUserAgent()` now returns exactly that, with the
measurement above and the cost written into its comment.

**What this does NOT say**: that captchas now work in this app. The discrimination
above is between two user agents in a plain window; the app's own driven view
still fails the same URL on both trees (§2.1), and the operator's exact symptom is
therefore not proven fixed (§2.2).

**The cost, stated rather than glossed**: the app is no longer distinguishable by
User-Agent. Anything that wants to identify it must do so on a channel it owns
(its own requests, its own endpoints) rather than by a suffix on a string that
third-party sites read and act on. Nothing in this repository or in the
`local-operator` backend keyed off that token (grepped: the only other
`LocalOperator/` strings are the backend's own HTTP clients, which are unrelated),
and `docs/design/ui-browser-tab.md` §16.4 in `damianvtran/local-operator` still
recommends (c) — the design-document half of this correction is a follow-up in that
repository, listed in §6.

### 2.1 The evidence arm, and a harness trap worth writing down

`scripts/browser-challenge-proof.mjs --arm ua` runs the real site with everything
else identical across two BUILT TREES — the UA is compiled in, so the two trees ARE
the two arms — and every sample carries `navigator.userAgent`, the UA the page
ACTUALLY presented. That assertion is not decoration: an arm that sets a UA on a
session the page is not in reports Electron's default and passes a challenge the
app's real shape fails, which is a false negative for every candidate cause.

Measured here (×3 per arm, `--window-mode=inactive`, the app's own driven-view
shape):

| tree | presented UA | outcome |
| --- | --- | --- |
| `origin/main` `548f8dfed` | `… Chrome/152.0.7977.78 Safari/537.36 LocalOperator/0.28.4` | 0/3, `title="Just a moment…"`, no `cf_clearance` in ~40 s |
| this branch | `… Chrome/152.0.7977.78 Safari/537.36` | 0/3, `title="Just a moment…"`, no `cf_clearance` in ~40 s |

Read honestly, that pair shows: **the fix changes the string the page presents**
(measured, asserted per sample), and **this arm does not reproduce the
pass/fail discrimination** — in the app's driven-view shape both UAs stall, and
the app-level `ua` arm therefore FAILS 0/3 on BOTH trees, with the clean UA
presented on this branch (`ua="… Chrome/152.0.7977.78 Safari/537.36"`, no product
token). The discriminating measurement is the plain-window pair in §2's table,
with everything else identical, where the Electron-default UA cleared the same URL
in ~2 s twice and the app-UA arm sat on `Performing security verification` twice
with the page alive. The driven-view shape differs from that plain shape in more
than the UA — the candidates are §2.2 — and this branch does not claim to have
separated them.

### 2.2 Open questions: what is still unexplained

The operator's exact symptom — a challenge that never completes in the app's own
browser tab — is **not proven fixed**. Three candidates remain, each with the
method that would settle it and a plain statement of what is measured today:

- **(a) The browser session's default-deny permission pair.** Every arm with the
  app's handlers installed stalled or hung, while the two arms without them cleared
  the challenge — but one arm with the app UA and no handlers stalled too, so the
  correlation is real and the causation is not established. *Method:* the same
  plain-window measure with and without `setPermissionRequestHandler` /
  `setPermissionCheckHandler`, several runs per cell, plus the log of which
  permissions the challenge asks for. Not changed in this branch: denying
  everything by default is a deliberate security posture, and relaxing it
  (`storage-access`, `notifications`, `top-level-storage-access`) for the browser
  session is a product decision, recorded in §6.
- **(b) The always-on debugger attachment.** `cdp.attach` enables `Runtime`,
  `Log` and `Emulation.setFocusEmulationEnabled` on every driven view, so the page
  believes it is focused; the arm for that never attached and is therefore
  untested. It is the last app-specific difference from the plain shape that does
  clear the challenge. *Method:* the plain-window measure with each of the three
  CDP commands enabled in turn for the app UA, and with all three.
- **(c) Cloudflare's own escalation for this IP and this session.** Roughly thirty
  challenge loads were made from this machine in the hours these arms ran, and
  Cloudflare's decisions vary per request and harden with repetition. Later arms
  are less trustworthy than earlier ones for that reason alone. *Method:* the same
  measure from a different egress, or after a long cool-down, whichever is
  available first.

---

## 3. Passkeys: what Electron gives, and what it does not

Electron 41+ can drive the macOS platform authenticator, and this app is on
44.3.0. `app.configureWebAuthn({ touchID: { keychainAccessGroup, promptReason } })`
is the whole of the enablement, and it has a second half that is easy to miss:
**the same value must be in the app's `keychain-access-groups` code-signing
entitlement**, and its shape is `<TEAM_ID>.<BUNDLE_ID>.webauthn`.

### 3.1 What happens when it is configured without the entitlement (measured)

A tiny Electron probe, this machine, ad-hoc signed (no team id, no entitlement),
two arms — `configureWebAuthn` never called, and called with a fabricated group
(`/tmp/cfpasskey/probes/webauthn-nonentitlement-probe.cjs`, scratch — a probe for
a signed-only path, so it is not committed):

```
ARM=none   configureWebAuthn -> not called
           isUserVerifyingPlatformAuthenticatorAvailable -> false
           credentials.create -> (never settles; 60 s ceiling reached in both
                                 the hidden-window and the shown-inactive runs)
ARM=touch  configureWebAuthn -> returned normally          <- it does NOT throw
           FIDO: touch_id_context.mm:89 Touch ID authenticator unavailable
                 because keychain-access-group entitlement is missing or
                 incorrect. Expected value: FAKETEAM99.com.local-operator.webauthn
           isUserVerifyingPlatformAuthenticatorAvailable -> false
           credentials.create -> (never settles)
```

Three facts follow, and they are why this feature is gated rather than enabled:

1. the call never throws, so nothing fails at startup to warn anybody;
2. Chromium logs the missing entitlement itself, but only in the FIDO layer;
3. **the page's `credentials.create()` promise did not settle within a 60 s
   observation in that same never-shown window.**

**What item 3 does and does not show (QA round 1, Q1, correcting this document and
`src/main/webauthn.ts`'s own header).** The pending promise is NOT caused by the
missing configuration. Measured with the authenticator **off**, on a real RP origin
(`http://localhost:<port>`, so an IP-literal origin's `SecurityError` is out of the
picture), a page calling `credentials.create()` with `userVerification: "required"`
was **still pending after 20 s**, twice — so a never-shown window leaves that
request pending whether or not anything is configured, which by itself does not distinguish missing discovery from missing native UI.
The later controls and source inspection in §3.5 narrow the evidence without
claiming a native-hardware result.

The difference the gate actually buys is the one a site's own feature detection
reads, and it is the one measured here: with the entitlement missing,
`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` is
**`false`**, so a well-behaved site does not offer a passkey it cannot complete. A
site that offers a passkey which cannot complete is worse than a site that never
offers one — that is why the authenticator is configured **only** when the running
app's own signature really carries the entitlement for the exact group about to be
passed, and why the verifiable claim is the feature-detection flag rather than a
hang this machine cannot attribute.

### 3.2 The gate, and why it reads the signature instead of a config value

`src/main/webauthn.ts` derives everything from the running app's signature:

- `codesign -dv --verbose=4 <bundle>` → `TeamIdentifier=` (absent entirely for an
  ad-hoc signature) and `Identifier=` (the bundle id). **The report is on STDERR,
  and stdout is empty** (measured 2026-10-28 on the shipped 0.45.1: 1142 bytes on
  stderr, 0 on stdout). Until the fix in this change the gate parsed stdout, so
  every real signature read as `no bundle id` and the installed app logged
  `Touch ID passkeys are off: no bundle id` — a reason that blamed a field that is
  present and hid the real blocker (no entitlement, §3.4). The probe now reads
  stderr and falls back to stdout; the entitlement read below is the opposite case
  (`-` puts the plist on stdout) and is unchanged. The test fixture is the real
  captured stderr (`scripts/fixtures/codesign/`), because a fixture that put the
  report where the code looked is how the defect shipped. Measured: the shipped
  `/Applications/Local Operator.app` reports `TeamIdentifier=SHA2U6KT7V` and
  `Identifier=com.local-operator`; this machine's ad-hoc
  `node_modules/electron/dist/Electron.app` reports **no** `TeamIdentifier` line.
- `codesign -d --entitlements :- <bundle>` → the entitlements plist on stdout;
  measured shape: a single-line XML plist when there are entitlements, and
  **nothing at all** when there are none (the "entitlement absent" case rather
  than a parse failure).

Both calls are bounded (5 s), cached for the life of the process, and made only
when the app is packaged — so a development launch spawns nothing. The gate then
enables the authenticator only when the signature's `keychain-access-groups`
contains `<TEAM_ID>.<BUNDLE_ID>.webauthn` built from those same two values, and
otherwise logs exactly one line naming the first thing that is wrong:

```
[webauthn] Touch ID passkeys are off: unpackaged — an unpackaged run has no
signature to carry the entitlement, so there is no group to configure
```

That line was observed in a real boot of the built app: the evidence run's app log
carries it once per launch (`…/logs/backend-service.log`, from
`scripts/browser-challenge-proof.mjs`). The reasons are `not darwin`,
`unpackaged`, `signature unreadable`, `no bundle id`, `no team id`,
`entitlement absent` and `entitlement mismatch`.

### 3.3 The chooser: `select-webauthn-account`

Electron fires the Session event `select-webauthn-account` when a
`navigator.credentials.get()` matches **more than one** discoverable credential,
and the contract is explicit: with no listener — or one that passes no
`credentialId` — the request is cancelled with `NotAllowedError`. That is a dead
end for anybody with two passkeys for one site, so the app now answers it:

- main holds the pending requests (`WebauthnChooser`), sends
  `browser-webauthn-request` to the app's own window, and answers Electron's
  callback **exactly once** per request. Exactly-once is now a property of the
  callback rather than of the bookkeeping around it: the wrapper is keyed by the
  callback itself (`onceAnswer`), because Electron delivers one event to every
  registered listener with the *same* callback — and the registration is
  idempotent per `Session` (`attachWebauthnChooser`), which is what a macOS
  window close followed by a Dock click otherwise doubles (review round 1,
  finding 2: `session.fromPartition` returns the same Session for the life of the
  process, so a listener added inside the host's startup accumulates);
- **the chooser is rendered by the APP SHELL**, not by the browser surface
  (`browser-webauthn-prompt.tsx` in `app.tsx`, with the queue mirrored in
  `shared/browser-webauthn-queue.ts`). Round 1 shipped it inside `BrowserSurface`,
  which is mounted only on `/browser` or as the chat side pane — so a request
  raised while the user was anywhere else was pushed to nobody and died at the
  60 s bound (agent review round 1, finding 1 MAJOR; UX round 1, U2 MAJOR). The
  consent band had already paid for this defect and its fix is the same shape;
- **main is the source of truth for the queue, and the renderer pulls it**
  (`browser-webauthn-pending`) when the prompt mounts, so a request raised while
  nothing was listening is recoverable rather than lost, and returning to the
  surface never has to reconstruct what it missed;
- **every settle is pushed back** (`browser-webauthn-settled`, with the outcome),
  so a dialog whose request main has already cancelled is closed rather than left
  on screen offering buttons that cannot do anything (design round 1, D2). The
  outcome travels with it because the endings differ for the user: `chosen` and
  `dismissed` are their own act and get no paragraph, while an expiry, a host
  stop and a credential that was not offered are explained in words. There is no
  `no-accounts` ending: Electron's event can arrive with nothing to offer, and
  that case is answered before a request is ever pending — so it was removed from
  the outcome union, the wire type and the copy rather than kept as a state the
  surface could not render (review round 2, R2);
- requests are offered **oldest first**, and the ones behind are counted —
  "One more passkey request is waiting." **Requests**, not sites, because main
  keys its pending map by request id with no dedupe by relying party, so two tabs
  of one site both asking would make a site count false (review round 2, N3; UX
  round 2, U7);
- **an ending can never hide or cancel a live request** (review round 2, R1 MAJOR).
  The panel is one discriminated value (`model/webauthn-panel.ts`): a live request
  always wins, a pending ending is shown only once nothing is answerable, and the
  ending branch carries no request at all — so the Close press that acknowledges
  an ending cannot settle anything. The failed shape is worth naming: round 1 kept
  the ending in a `notice` slot beside the queue, the oldest of two expiring
  rendered the ending *instead of* the live request's rows, and the only button on
  screen ran the live branch's answer, cancelling a request the user had never
  seen. The property is asserted by `scripts/webauthn.test.mjs` (which fails on
  the round-1 behaviour) and re-measured live by the rig's queued-expiry step;
- **where the user was is TRACKED while nothing is open, and the caret is given
  back at the dismissal** (review round 2 R5; UX rounds 2 and 3, U6). Three
  measurements shaped this, and each one killed a cheaper version:
  re-capturing on every change of the offered request recorded Radix's dialog
  content as soon as a second request was queued; capturing on the closed-to-open
  transition recorded the dialog as well, because Radix moves focus into it as it
  opens (instrumented: `focus()` on the first account row, inside `[role=dialog]`);
  and restoring through `requestAnimationFrame` never ran at all in the
  `--window-mode=headless` rigs, where a hidden page's rAF is suspended. So the
  record is written at RAISE time in the handler, refreshed on every render while
  the panel is closed and by a `focusin` listener (a background window dispatches
  no focus events, a person's does), never cleared — an element inside the dialog,
  the body and a disconnected node all leave the previous answer standing — and the
  dismissal handlers sequence the restore themselves rather than racing Radix's own
  return-to-`body`. Measured on both doors: `activeElement=nav-item-chat`, with the
  instrumented tape showing Radix's two `focus()` calls and then the app's;
- the dialog is the existing hand-over dialog's shape — the same `BaseDialog` and
  roles, sentence case, no emoji, `cn` for class names (branding contract) — and
  everything it says is **derived from the request**: the lead sentence says which
  case the user is in (one account, several named, or several whose names the OS
  never supplied, where the copy says what the choice actually decides rather than
  offering three ordinals), an unnamed row says so instead of leaving a blank
  second line, the page the request came from is named when the event's frame
  resolves to a tab, a long login wraps or ellipsises instead of being cut
  mid-character at the panel edge, the Touch ID sentence is pinned in the footer
  rather than left below a scrolling list, the panel's width is a fixed step
  so the same dialog is the same size for every site. Two of those were refined in
  round 2: the positional fallback ("Passkey 1") is neither a person's name nor a
  machine string, so it leads its row in the app's own ink while a login keeps the
  machine voice (N2), and the unnamed row's second line now carries the recovery
  clause — what to do when the pick is the wrong one — rather than only what the
  pick decides (UX round 2, U8) — and that clause lives in the LEAD, in prose that
  wraps, rather than in the row's second line, which is the machine voice and
  truncates with a `title` (design round 3, D11; UX round 3, U9: a 706px sentence in
  a 380px box painted about half of itself, and the half that was lost was the
  actionable one). The rows' text also dims with the disabled state
  again (one `disabled:[&>span]:text-ink-disabled` on the row, because the D1 fix's
  spans declared their own colours and overrode the primitive's), and the
  "Answering…" cue moved out of the scrolling body into the footer for the same
  reason the Touch ID sentence is there (design round 2, N1);
- a dismissal, an unknown request id, a credential that was not offered, and the
  60 s timeout all answer Electron with **nothing** and log a line, because an
  unanswered callback is the dead end this feature exists to remove. That is now
  true of a THROW as well: the pre-timer body of `handle` (which resolves the
  frame description) is guarded and answers nothing if it fails, rather than
  leaving the callback — and the page's promise — pending (review round 2, N2).
  The mirror also merges main's snapshot instead of overwriting it, so the reply
  and a concurrent push cannot lose a request to their ordering (review round 2,
  N1);
- stopping the host cancels what is pending — and removes the Session listener —
  so a window that is going away does not leave a page's promise pending, and a
  second host start in the same process cannot find a second chooser. The gate's
  own cleanup has the matching rule: `Page` is disabled whenever the ensure may
  have enabled it, including when the frame read that followed the enable failed
  (review round 2, R3) — the flag records what was enabled, and the fallback's log
  line says the domain may still be armed.

A single matching credential never reaches any of this: Electron dispatches it.

**What the chooser cannot be exercised through on this machine.** Electron fires
this event out of the OS credential path, so it needs the signed, entitled
bundle: a CDP virtual authenticator answers a multi-credential request *inside
the renderer* and never routes account selection to the embedder (QA round 1, Q2,
measured twice). The evidence below therefore raises the event on the app's real
`Session` from the main process and says so — everything downstream of that emit
(chooser, IPC, preload validation, dialog, callback) is the shipped code, and the
trigger is the one synthetic part.

### 3.4 The entitlement in the release path

The group embeds the team id, which is a CI secret (`APPLE_TEAM_ID`), so it cannot
be committed. It is also not something electron-builder can substitute: measured
in this tree's own dependency, `app-builder-lib` resolves `mac.entitlements` to a
path (`out/mac/MacTargetHelper.js`) and hands the **file** to `@electron/osx-sign`,
which reads it as a plist and passes it to codesign — **no macro expansion**. A
`${…}` in the committed plist would ship literally.

**`keychain-access-groups` IS A RESTRICTED ENTITLEMENT, and v0.29.6 shipped it
with nothing to authorize it.** Apple's TN3125 divides entitlements in two: the
*unrestricted* ones (the App Sandbox, the hardened runtime, `get-task-allow`,
`application-groups`) may be claimed by any signed app, and everything else must
be authorized by a **provisioning profile embedded in the bundle**. The group is
on the restricted side. v0.29.6 rendered it into every executable of the bundle
and embedded no profile, so amfid refused every Mach-O at exec
(`AppleMobileFileIntegrityError Code=-413 "No matching profile found"`): the app
could not be launched at all, and neither could the ShipIt that was supposed to
relaunch it — while `codesign --verify --deep --strict`, `spctl -a -vvv -t exec`
and `stapler validate` all passed on the same bundle, because none of them asks
whether a claimed entitlement is authorized.

So until a profile exists, **the release path ships no group at all**:

- `publish.yml` builds with the committed, group-free
  `build/entitlements.mac.plist` and passes no entitlements override, so the group
  cannot reach the app *or the helpers it inherits*.
- Passkeys are inert in that build by design, not by accident: the gate reports
  the entitlement absent, `src/main/webauthn.ts` logs one line and never calls
  `configureWebAuthn`, and a site that feature-detects simply never offers a
  passkey. Nothing is shown to the user (§3.1).
- `scripts/render-mac-entitlements.mjs` is the door back, and it cannot be opened
  half way: without `--profile` it writes the committed plist unchanged, and with
  one it refuses unless the profile's own `keychain-access-groups` contains the
  exact group being signed in. Enabling passkeys is one secret wide — a Developer
  ID profile with Keychain Sharing on the App ID — and the three steps are written
  at the Build macOS app step in `publish.yml`. The group must go on
  `-c.mac.entitlements` **only**, never `entitlementsInherit`: Chromium reads the
  *main executable's* entitlement and osx-sign embeds the profile in the main
  bundle only, so a helper or ShipIt carrying the group holds a claim no profile
  authorizes — which is exactly how this incident took the relaunch leg down with
  it.

A local build renders nothing: `pnpm dist:mac` keeps the committed plist, stays
ad-hoc signed, and the app stays inert, logging `unpackaged`. That is the intended
behaviour and the reason the OS sheet cannot be verified here (§4).

`scripts/test-publish-workflow.mjs` asserts that shape: no render step, no
`ENTITLEMENTS_PLIST`, no entitlements override, `provisioningProfile` **absent**
(documented rather than wired), and the committed plist carries no
`keychain-access-groups` at all.

**The gate asserts two things about a built artifact, and one of them is a spawn.**
`app-spawn` executes the bundle's own `Contents/MacOS/<CFBundleExecutable>` in
Electron's node mode (`ELECTRON_RUN_AS_NODE=1 <exe> -p 'process.exit(0)'`, so no
window, no display, no user-data directory) and fails on a non-zero status, a
terminating signal, or a child that never exits within the bound. That is the
question the pipeline could not ask and the one the OS actually answers: measured
against the real 0.29.6 bundle it exits 137 (SIGKILL, no output), against the same
bundle re-signed without the group it exits 0, and against the 0.29.5 install on
this machine it exits 0. **The bound is one per kind of child, because the runner
checks both architectures.** A launcher this host has to translate answers in a
translation's time rather than in its own: on the arm64 runner, the x64 bundles'
probe crossed the 60 s bound twice in one release (v0.30.9, run `35701146672`,
both of its attempts) while the same launcher bytes passed later in that same run
and the arm64 bundles answered in 4-6 s, so the gate gives a child it must
translate through Rosetta 2 (`SPAWN_PROBE_TRANSLATED_TIMEOUT_MS`) longer to answer
and keeps the 60 s bound for every child it runs natively. The refusal this probe
exists to observe is decided at exec and stays immediate: a signal, a non-zero
status or a child that never returns is still red under either bound.
`app-profile-authorization` names the *cause* rather than
the symptom — every profile-backed entitlement the signature claims must appear in
an embedded profile's own `Entitlements` — and `app-webauthn-entitlement` is
bidirectional: absent is the shipped default, and present is only acceptable when
the profile authorizes that exact group for that bundle id. `app-spawn` is
deliberately absent from `SIGNATURE_CHECK_IDS` in `scripts/verify-signed-update.mjs`:
a failure there is a defect in the artifact, not a capability the runner lacks.

**The release-side check is bound to the app it is checking** (review round 2,
R4). It reads the plist back off the signed bundle and requires a `<string>` whose
value ends with `.<CFBundleIdentifier>.webauthn` **inside**
`keychain-access-groups`'s own array — the previous pattern walked past the
array's `</array>` with an open-ended `[\s\S]*?`, so a `.webauthn` group for a
different bundle id, or in some other array entirely, satisfied a gate whose whole
purpose is catching that. The nested-array question persists: the bundle also
carries `keychain-access-groups`-shaped keys under `com.apple.security.*` scopes,
so "inside an array" is not "inside a keychain-access-groups array". Measured
through the exported predicate: a group for another bundle id → false; a group for
this app in another array → false; an empty (ad-hoc) signature → false; this
app's own group → true.

The team id stays unverifiable here, and that is the honest limit: the release
gate can prove the entitlement LANDED and that the group is for this app, and the
running app compares the group's full value against its own signature before
enabling anything (§3.2). What neither can prove from this machine is that the
team id in the rendered group is the one the signature was made with.

**The entitlement read uses `-` with `--xml`, not `:-`** (QA round 2, Q1). The
deprecation warning is real — `codesign` says *"Specifying ':' in the path is
deprecated and will not work in a future release"* — but the suggested spelling is
not the fix, and the three were measured on an ad-hoc bundle signed with the
committed plist (2026-09-18, macOS 26):

| argv | stdout | stderr |
| --- | --- | --- |
| `-d --entitlements :- <app>` | XML plist | the deprecation warning |
| `-d --entitlements - <app>` | a human-readable `[Dict] [Key] [Value]` dump | — |
| `-d --entitlements - --xml <app>` | the same XML plist | — |

So dropping `:` alone changes the FORMAT and both parsers (this gate's pattern and
`src/main/webauthn.ts`'s `parseKeychainAccessGroups`) read XML. `--xml` is the
non-deprecated spelling that keeps it, and both call sites use it.

**And the signed artifact is now asserted, not trusted** (review round 1, finding
6). Every failure downstream of a missing entitlement is silent by design — the
app logs one line and goes inert — so a release whose rendered plist never reached
the signature would ship a passkey feature that can never work with nothing in the
pipeline saying so. `scripts/verify-macos-artifacts.mjs` — the gate that already
decides whether a macOS release is promotable — gained a check that reads the
**signed bundle's** own entitlements (`codesign -d --entitlements :- <app>`) and
requires a `keychain-access-groups` entry whose value has the group's shape,
`<TEAM_ID>.<BUNDLE_ID>.webauthn`. The shape rather than the value, because the team
id is a release secret this gate does not hold; the runtime compares the full value
against its own signature and stays inert if they differ.

### 3.5 What can and cannot be achieved in this browser (stated plainly)

The measurements and source inspection below come from an investigation on 2026-10-28 (Electron
44.3.0 / Chromium 152.0.7977.78, macOS arm64; the installed, signed 0.45.1 and a
dev build; headless, isolated HOME and user-data-dir; real relying-party fixture
and webauthn.io; a CDP virtual authenticator as the control). The matrix, the
probe scripts and the Chromium/Electron source copies are in that session's
scratchpad (`passkey-investigation/FINDINGS.md`, rows quoted by id below); the
upstream paths are named so each claim can be re-read at the tag.

**What happens today, in the shipped build.** There is **no authenticator**:
`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` is `false`
and `navigator.credentials.create()` / `.get()` **remained pending at the observation ceiling** (4–5 s in the fixture,
15 s after Register on webauthn.io; no prompt or rejection during those windows) for a platform, cross-platform and unspecified attachment,
with `uv` required, preferred and discouraged (rows A1, A4, A5, A8; webauthn.io,
A9). A virtual-authenticator control resolves requests in the same hidden window
(B2, B12), proving the page/Chromium path but not native discovery or hardware.
Hidden and bare-WebContents observations do not exclude a native-UI visibility
constraint; neither has a visible native UI. Touch ID is off
because the shipped signature carries no `keychain-access-groups` entitlement
(D1), and `src/main/webauthn.ts` additionally mis-reported the reason until the
stderr fix (§3.2). `PublicKeyCredential.isConditionalMediationAvailable()` is
`true`, so a site still starts a conditional `get()` still pending at the fixture ceiling (A3).

**What cannot be achieved, and why.**

| Capability | Status | Why (source) |
| --- | --- | --- |
| Touch ID platform passkeys | **Not available in the shipped build; enablement is gated, not impossible** | Needs the `keychain-access-groups` entitlement `<TEAM_ID>.<BUNDLE_ID>.webauthn`, which is a *restricted* entitlement: it must be authorized by an embedded Developer ID provisioning profile, and no such profile exists (the 0.29.6 incident, §3.4). Chromium's Touch ID path checks only that entitlement, then uses `LAContext` and the Secure Enclave: `device/fido/mac/touch_id_context.mm` `TouchIdAvailableImpl`. Credentials would be device-bound (no iCloud sync) |
| Apple Passwords / iCloud Keychain / 1Password sheet | **Not available, and no flag or entitlement alone changes it** | Chromium's iCloud-keychain discovery is added only when an `NSWindow` is set (`device/fido/fido_discovery_factory.cc` `MaybeCreatePlatformDiscovery`, ~202-212), and `set_nswindow` is called only from //chrome (`chrome/browser/webauthn/chrome_authenticator_request_delegate.cc` ~1206); Electron 44's WebAuthn files (`shell/browser/webauthn/`) contain no `NSWindow` handoff. It would also need Apple's `com.apple.developer.web-browser.public-key-credential` entitlement (applied for, reviewed by Apple, profile-backed) and Local Operator to declare `http`/`https` URL schemes (it does not today, so it is not selectable as a browser) |
| Hybrid ("use a phone", QR) | **Not available** | The QR key and cable data are set only by //chrome's `ConfigureDiscoveries`; `FidoDiscoveryFactory::Create(kHybrid)` returns nothing without them, and Electron never sets them (C1-C3). A CDP *virtual* hybrid device "works" only because it bypasses discovery (B11) |
| Bluetooth LE and NFC security keys | **Not available** | `Create(kBluetoothLowEnergy)` returns nothing in Electron's configuration; NFC is a TODO upstream (C3) |
| PIN-protected security keys; `userVerification: "required"` on a roaming key | **Not available** | Electron's client delegate does not override `SupportsPIN()`, whose default is `false`, and `CollectPIN` is `NOTREACHED()` in the base delegate, so nothing can collect a PIN (C1, C2, C4) |
| USB-HID security key with no PIN, `uv` preferred or discouraged | **UNMEASURED, not "unsupported"** | HID discovery IS created in Electron (no embedder gate, C4) and the page/Chromium flow completes against a *virtual* USB device (B7, B9, B13), but no real key was available, and there would be no on-screen cue to touch it |
| The OS Touch ID sheet itself | **UNMEASURED** | Cannot be driven headlessly and the entitlement is absent (A10 BLOCKED). The sheet has never been seen in this repository |
| Password-manager extensions (1Password, iCloud Passwords) | **Required integration APIs absent; real products untested** | `session.loadExtension` works in the persistent browser session and content scripts run (E2), but native messaging is disabled in Electron's extension host (`sendNativeMessage` fails, E4) and `chrome.webAuthenticationProxy` does not exist (E3). The real 1Password extension was not loaded (E6 BLOCKED): this is measured on a synthetic MV3 extension |
| Native addon (`vault12/electron-webauthn-mac`, `ASAuthorizationController`) | **Not built; would not reach third-party sites** | The addon generates its own challenge (README `challenge` row: "Auto-generated internally"), so a page's server-issued challenge cannot be used as-is, and it needs `com.apple.developer.associated-domains` plus an `apple-app-site-association` (AASA) file on the relying party that lists our app id. Measured: amazon.com's and login.microsoftonline.com's AASA files list 98 and 115 apps and neither includes `com.local-operator`; github.com and accounts.google.com serve none (the addon investigation's F1-F3) |
| Electron 45 `platformPasskeys` | **Not adopted; same reach as the addon** | Electron 45's option (released 2026-10-21) shows the system sheet but is described as requiring associated domains plus AASA and rejects cross-origin iframes (the addon investigation's F5, from the Electron PR, not run here) |

**Does the AASA limit apply to the Touch ID path? Not on what was read, and the
claim is bounded.** The Touch ID authenticator that `app.configureWebAuthn({
touchID })` enables is Chromium's own (`device/fido/mac/`, `LAContext` plus keychain
items in the configured access group). A search of the core files of that
directory at tag 152.0.7977.78 (`authenticator.{h,mm}`, `authenticator_config.h`,
`credential_metadata.cc`, `credential_store.mm`, `discovery.cc`,
`get_assertion_operation.mm`, `make_credential_operation.mm`,
`touch_id_context.mm`, `util.mm`) for `associated domain`, `applinks`,
`webcredentials`, `site-association`, `AASA` and `AuthenticationServices` found
**no match**; the group is the only app-identity input
(`touch_id_context.mm`'s entitlement check; `credential_store.mm` keys items by
`keychain_access_group`). So the AASA/associated-domains requirement belongs to
the addon and `platformPasskeys` paths, which go through `AuthenticationServices`,
and was NOT found on the Touch ID path. **UNVERIFIED:** that no other component
in the browser process imposes a per-site association on this path (not read), and
that a real signed build with the profile works at all (never exercised, §5).

**Open decisions, not decided here.** Whether to apply to Apple for the
web-browser passkey entitlement (which also turns Local Operator into a selectable
default browser), and whether to create the Developer ID provisioning profile
that would unlock the Touch ID path, are product and account decisions with the
account holder; the Touch ID path is additionally waiting on the Apple Developer
**Organization** account upgrade, after which the team id and so the group may
change. Nothing in this change creates a profile, touches a CI secret or changes
signing or notarization.

Sources: electron/electron#51255, electron/electron#27355, freedom-browser#347
(the same class of bug in a near-identical Electron browser), and the Chromium
and Electron paths named in the table.

**Shipped status (2026-10-28):** passkeys do **not** work in the built-in
browser. The release has no platform authenticator (no `keychain-access-groups`
entitlement and no provisioning profile), so a page's WebAuthn request stays
pending, and the entitlement is **not the only** blocker for password-manager
sheets: those also need an NSWindow handoff Electron 44 lacks and `http`/`https`
URL schemes the app does not declare. Hybrid/QR, BLE/NFC, PIN-protected keys and
extension native-messaging and webAuthenticationProxy APIs are absent (actual
product extensions untested); a real USB key and the OS Touch ID
sheet are **unmeasured**. A site that needs a passkey has to be completed in the
system browser; since §3.6 the browser says so instead of hanging silently.

### 3.6 The notice: a request that cannot be served must not hang silently

**The mechanism and why this one.** Electron 44 gives the embedder no
request-start signal: its only WebAuthn event, `select-webauthn-account`, fires
after a request already has several credentials to choose from (and never fires
on a build with no authenticator), and its client delegate overrides no
request-lifecycle method (C1). A timer in main therefore has nothing to hang off.
The one place a request is observable is the page's own JavaScript, so the
mechanism is a small shim that main injects (`frame.executeJavaScript` at each
http(s) frame's commit and finish-load) which wraps `CredentialsContainer`'s
`create` and `get` and reports, once, a call that is **still pending three
seconds later**. (A CDP `Page.addScriptToEvaluateOnNewDocument` was built first
and dropped: it needs the `Page` domain, which `actions/gate.ts` disables again
after every agent navigation, and a permanently enabled `Page` domain is one of
the open Cloudflare-stall discriminators of §2.2.)

**It observes and never participates.** The shim returns the page's own promise
and arguments unchanged and never rejects, resolves or fakes a result: a failure
must not wear a verdict's clothes. The notice says only what main can stand
behind: *a request from this site is still waiting, and this browser has no
passkey provider*. It does not say the request failed, and it does not call Touch
ID or a USB key "unsupported". Conditional-mediation `get()` (the autofill form)
is excluded, because pending is its normal state. A call that already settled by
the time of the check is not announced.

**The signal is one-way and carries no page text.** One `console.debug` line:
a fixed sentinel, a per-FRAME random nonce main issued, and `create` or `get`.
Main reads it from `webContents`' `console-message`. **Measured on Electron
44.3.0:** that event's `frame` is the *top* frame even when a child frame logged
the line, so attributing by it would blame the address-bar site for an embedded
frame's request; the nonce therefore selects the `WebFrameMain` main injected,
and that frame's browser-side `origin` (and whether it has a parent) is read at
that moment. Nothing is exposed to the page: no preload, no `contextBridge`, no
global; the sandbox, `contextIsolation`, origin gating and popup handling are
untouched. A page that cannot guess a nonce cannot signal; an opaque origin
(`null`, a sandboxed frame) raises nothing rather than a notice naming an invented
site; one notice per tab per 30 s (the rest are counted in the log); a notice
clears on the next top-level document and ages out at 120 s.

**The agent-versus-human boundary.** The notice carries who owns the tab as the
registry records it, and says "agent-driven tab" in its copy. It is projected only
for the ACTIVE tab, so a background agent tab's request never narrates itself onto
the page the user is looking at; it is shown, still labelled, when the user
activates that tab (measured by the rig's background-agent-tab and on-activation checks, §4.4).

**The one action** opens the tab's own page in the system browser through the
app's vetted door (`openVettedExternal`: http(s) only, no credentials, no
loopback or private-network host). The renderer sends a tab id and the notice's
identity (`at`); main reads the URL from the tab itself, so no URL travels from
the renderer, and a stale or replaced notice is refused. Measured: a loopback
page is refused by the door with its own reason and never reaches the opener.

**Off when the platform authenticator is on.** The shim is registered only when
`installWebauthn` did not configure the authenticator. With a signed build whose
entitlement the gate accepted, the OS sheet is the UX and the existing chooser
stays.

**Limits.** (1) A call made before the shim lands (an inline script at parse time)
is not observed. (2) A cross-origin frame may only call `create()` under user
activation in Chromium, and an out-of-process frame is reached only if Electron
lets main execute in it. (3) A page can evade the notice by replacing the wrapped
methods; it then only loses a courtesy. (4) The line is also a `logs`-action entry
for the tab (a nonce, no page data). (5) The copy is deliberately provisional:
*Touch ID passkeys are planned* promises no date.

### 3.7 Enablement runbook (NOT DONE: waiting on the Organization Apple Developer account)

Every step below is **not done**. The operator is upgrading to an Organization
Apple Developer account, and the team id (and so the keychain group) may change
with it, so nothing here is wired. Do not create a profile, add a secret or touch
signing/notarization config until that lands; then, in order:

1. **Apple side (not done, waiting on the Organization account).** In the
   Developer account for the Organization team: register or confirm the App ID
   `com.local-operator`, enable the **Keychain Sharing** capability on it, and
   create a **Developer ID provisioning profile** for that App ID that authorizes
   the keychain group `<TEAM_ID>.com.local-operator.webauthn`. (Apple's capability
   table lists Keychain Sharing as supported for Developer ID; TN3125 says the
   restricted `keychain-access-groups` entitlement must be authorized by an
   embedded profile. What happens at launch once a profile expires is
   **UNVERIFIED**.)
2. **CI secrets (not done, waiting on the Organization account).** The existing
   names (read from `.github/workflows/publish.yml` and
   `scripts/render-mac-entitlements.mjs`; none are new): `APPLE_TEAM_ID`,
   `CSC_CONTENT`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_ID_PASSWORD`. These all
   change with a new team/certificate and must be re-issued for the Organization.
   The profile itself has **no secret name yet**: add one (base64 of the
   `.provisionprofile`), decode it to `$RUNNER_TEMP/embedded.provisionprofile`
   in the Build macOS app step.
3. **Where the workflow consumes them (not done).** In `publish.yml`'s
   `Build macOS app` step, add `-c.mac.provisioningProfile=$RUNNER_TEMP/embedded.provisionprofile`
   to the `dist:mac` line and render the group with the profile:
   `node scripts/render-mac-entitlements.mjs --out <plist> --profile <profile>`
   (it refuses to emit the group without a profile that lists it), passing the
   result to `-c.mac.entitlements` **only**. The group must stay out of
   `entitlementsInherit`: Chromium reads the MAIN executable's entitlement,
   osx-sign embeds the profile in the main bundle only, and a helper or ShipIt that
   carried the group would be refused at exec (the 0.29.6 failure). The comment
   above that step in `publish.yml` is the authority.
4. **How the value is derived.** `<TEAM_ID>.<BUNDLE_ID>.webauthn`, built in one
   place per side: `webauthnKeychainAccessGroup` in `src/main/webauthn.ts` (read
   from the running signature) and in `scripts/render-mac-entitlements.mjs` (from
   `APPLE_TEAM_ID` and `build.appId`). A new team id changes the value everywhere
   at once; nothing is hand-typed.
5. **Verify in a signed build (not done).** In order: `pnpm verify-macos-artifacts`
   (its `app-webauthn-entitlement` check, and the spawn check that guards the
   0.29.6 brick); on the installed `.app`,
   `codesign -d --entitlements - --xml '<app>'` showing the group under
   `keychain-access-groups`; the boot log line `[webauthn] Touch ID platform
   authenticator enabled (<group>)` instead of `Touch ID passkeys are off: ...`;
   `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` returning
   `true` on a test page; and one real `navigator.credentials.create()` and
   `.get()` that **settle** (the OS Touch ID sheet appears, a credential is
   created and retrieved). With the authenticator on, the §3.6 notice is not
   armed; confirm that too.
6. **Rollback and reinstall consequence (not measured).** Credentials are
   device-bound and scoped to the configured keychain access group. A build
   without access to that group cannot use those keys. Whether a reinstall or
   rollback retains usable credentials depends on the signature, group, session
   metadata and keychain persistence; no data-loss or recovery guarantee has been
   measured. Validate that migration before enablement and communicate the result.
7. **AASA scope.** Not required by the Touch ID path on what was read (§3.5);
   required by the addon and Electron 45 `platformPasskeys` paths, which would
   reach only relying parties whose AASA lists our app id.

---

## 4. Evidence

`scripts/browser-challenge-proof.mjs` (committed, re-runnable) boots a **built app
tree** in a scratch HOME/config/`--user-data-dir`, drives the browser host over
its own `/rpc`, and prints one machine-readable line per sample. Both arms were
run ×3 against two trees: the BEFORE arm is `origin/main` = `548f8dfed` in a
second worktree with the same rig copied into it, the AFTER arm is this branch.

```
node scripts/browser-challenge-proof.mjs --app-tree <tree> --arm local --attempts 3
node scripts/browser-challenge-proof.mjs --app-tree <tree> --arm cloudflare --attempts 3
node scripts/browser-challenge-proof.mjs --app-tree <tree> --arm ua --attempts 3
```

### 4.1 The deterministic arm (the headline)

A local, captcha-shaped reproduction on two loopback origins: the top page (origin
A) reports `COMPLETE` only when a **cross-origin** iframe on origin B (whose
widget needs ~20 timer steps) posts back a token. The navigation is made the
agent's way — `request_access` → the user's decision in the app's own chrome
(`respondToConsent`) → `await_access` → `open` — so the gate is armed and only
origin A is approved.

| arm | outcome | per attempt | samples |
| --- | --- | --- | --- |
| BEFORE (`548f8dfed`) | **0/3** | `status=PENDING widget=none refusals=1` | `vis=visible`, rAF ~2650/12 s — the page runs; the widget never loads |
| AFTER (this branch) | **3/3** | `status=COMPLETE widget=token refusals=0` | same rAF, the widget's 20 steps complete and the token arrives |

`refusals` is the count of the gate's own `refused a navigation hop` lines in the
app log — the direct evidence that a subframe document was failed with
`BlockedByClient` before, and is not after. Frames:
`docs/evidence/browser-challenges/before-local-attempt1.webp` (interstitial-shaped
page stuck at PENDING with an empty frame) and `after-local-attempt1.webp`
(COMPLETE).

### 4.2 The real-site arm (inconclusive BY CONSTRUCTION, and it does not corroborate the gate)

The operator's URL, `--window-mode=inactive` (visible, never activated), ×3 per
tree, and run as `--arm ua` because the user agent is compiled into the host: the
two trees ARE the two UA arms (BEFORE presents `… Safari/537.36
LocalOperator/0.28.4`, AFTER presents `… Safari/537.36` with no product token,
asserted per sample). Both trees: **0/3**, `title="Just a moment..."`, no
`cf_clearance` and no `__cf_bm` within the ~40 s sample window, `vis=visible`.

Inconclusive by construction for the operator's symptom, for two reasons stated
rather than hidden: a rig cannot solve a captcha, and a rig cannot control
occlusion — a covered window freezes its page (§1.4), which no arm here can rule
out from inside the run.

Two honest readings, and the second one corrects an assumption this branch was
briefed with:

- **A rig never solves a captcha.** FAIL is the expected result on both arms, and
  the rate says nothing about the fix.
- **The gate refused NO hop on this arm, on either tree** (`refusals=0`, measured
  from the app log's own `refused a navigation hop` lines). The interstitial's own
  document is served from `muddyrivernews.com` (the URL carries
  `?__cf_chl_rt_tk=…`), so it was never a hop the gate would refuse — and in these
  runs the cross-origin Turnstile widget did not request a document inside the
  gated window either. So **this arm cannot be said to corroborate the gate fix**,
  and the gate is not what this arm shows about the operator's captcha. The claim
  rests on §4.1, which reproduces the class deterministically; what the real-site
  arm adds is that the app now reaches and runs the interstitial (the page answers
  probes, `vis=visible`) rather than hanging on the navigation.
- The arm also cannot distinguish "the widget refused to solve because the page
  reported itself hidden" from anything else, which is the frozen-tab limit in
  §1.4 — a limit this branch documents and does not fix.

### 4.3 Passkeys

What could be measured here: the gate's decision in a real boot of the built app
(§4.2's log line, once per launch), the pure logic and the chooser's mapping
(`scripts/webauthn.test.mjs`, 21 cases), the entitlements renderer including
`plutil -lint` over a rendered plist and the secret-hygiene assertion that the
team id never reaches stdout (`scripts/render-mac-entitlements.test.mjs`, which
also asserts the release gate's own entitlement check in both directions), and the
unentitled-behaviour probe in §3.1.

**And the chooser end to end, in a real boot**: `scripts/browser-challenge-proof.mjs
--arm webauthn` (committed, re-runnable) boots the built app headless, emits
`select-webauthn-account` on the app's real `Session` from the main process — the
one synthetic step, forced by Q2 below — and captures the app's own renderer frames
while asserting the things round 1 found wrong: the rows fit their box, the Touch
ID sentence stays inside the panel with twelve accounts, a nameless list explains
itself, a second request is named as waiting, a request raised **while the browser
surface is not mounted** is still on screen and answerable, returning to the
surface keeps it, an expiry replaces the rows with the sentence that explains it,
the answer reaches Electron's callback, exactly one Session listener survives nine
requests, and focus comes back to the app rather than landing on `<body>`. The
frames and the numbers are in `docs/evidence/browser-webauthn/README.md`.

### 4.4 The passkey notice, in a real boot

`scripts/browser-challenge-proof.mjs --arm passkey` (committed, re-runnable)
boots the built app headless (`--window-mode=headless`, scratch HOME and
user-data-dir, `--use-mock-keychain`) with the platform authenticator OFF, which
is the shipped state, and serves a relying-party fixture on two origins
(`rp.test` is mapped to 127.0.0.1 and treated as secure, because the app's
external door correctly refuses loopback hosts, so a `localhost` fixture could
only ever show the refusal). `shell.openExternal` is replaced from the main
inspector with a recorder, so no real browser is launched. Result on this head:
**arm=passkey pass=1/1, 29 checks, all PASS**, covering: the page's `create()`
returns a Promise and stays **pending** after the notice and 5 s later (nothing
rejected or faked); no notice before the 3 s delay; the origin read by main; a
**cross-origin iframe** attributed to the frame's own origin and marked embedded
(clicked with a real CDP mouse event, because a cross-origin frame may only call
`create()` under user activation); two more requests inside the window raising no
second notice (one log line); a stale or unknown notice identity refused for the
right reason; the real button handing the tab's own URL to the stubbed opener
exactly once; a loopback page refused by the vetted door and never reaching the
opener; dismissal by identity; a background **agent** tab raising nothing on the
user's page, then showing, labelled agent-driven, on activation; and no horizontal
overflow at 800 px in either ramp. The frames are in
`docs/evidence/browser-passkey-notice/README.md`.

---

## 5. What is NOT verified, and what the next signed release owes

- **The OS Touch ID sheet is unmeasured.** The tested development build is
  unpackaged and the installed signed build has no keychain group/profile. Nothing here proves that a signed build's sheet appears, that the
  prompt string renders as intended, or that a created credential is retrievable.
  The earlier chooser rig uses a synthetic emit (§4.3); the 2026-10-28
  investigation also triggered the real event with virtual authenticators, not
  native hardware.
- **The enabled profile path has never run. The shipped signature HAS been read
  (2026-10-28, §3.2), and contains no keychain group.** The render script and the workflow wiring are asserted by tests
  over the YAML and the plist, the gate's comparisons are unit-tested with the real
  0.29.6 signature as the negative fixture, and `app-spawn` runs for real against
  every artifact a release builds — but no build in this repository has produced a
  signature carrying `keychain-access-groups` with a profile behind it, because no
  Developer ID provisioning profile exists yet. The passkey-enabled arrangement
  therefore remains entirely unexercised end to end: what is verified is that the
  group cannot be signed in without one, and that the group-free build launches
  (measured on this machine, §3.4).
- **The 1Password / Apple Passwords sheet cannot work at all** (§3.5), and no
  amount of testing here would change that; an entitlement alone is insufficient, and the examined addon is not a
  drop-in solution for third-party relying parties (§3.5).
- **Two keyboard surfaces are unmeasured, and QA round 2 says so rather than
  implying coverage**: what a half-typed composer draft does when a passkey
  chooser takes focus on a boot where the chat route is reachable (round 2 had no
  backend, so the composer was not rendered at all), and whether pressing a
  captcha widget *inside* a cross-origin frame works when the view is driven over
  CDP — the frame reported no click at all this round, which is the mechanism
  `src/main/browser/actions/input.ts` documents (synthetic input is dropped on a
  view that is not visible) plus a node lookup that does not pierce frames. Round
  1's interactive press on the same unchanged file is the standing evidence for
  that path.

The next signed release owes, in this order: the release gate's new
`app-webauthn-entitlement` check passing on the shipped `.app`
(`codesign -d --entitlements - --xml` showing the rendered group, the spelling
§3.4 settles); then a boot of that
signed bundle whose log line names the group instead of `unpackaged`; then one real
`navigator.credentials.create()` on a test site with the sheet appearing and a
credential being created; and a real two-account `select-webauthn-account` — the
one case a synthetic emit cannot stand in for, because it is the OS that selects
the accounts.

---

## 6. Not addressed

- **The same gate defect in the extension**: `extension/src/origins.ts:307` in
  `damianvtran/local-operator` arms the identical
  `patterns: [{ resourceType: "Document" }]` with no frame discrimination, so the
  released extension refuses cross-origin iframe documents for the duration of an
  agent navigation exactly as the app did. Different repository, so it is a
  follow-up there rather than a change here.
- **The browser session's default-deny permission pair is NOT changed**, and
  candidate (a) in §2.2 is therefore still open. Denying every permission by
  default is a deliberate posture; whether to relax it for the browser session
  (`storage-access`, `top-level-storage-access`, `notifications`) is the operator's
  decision. *Measurement plan:* the plain-window measure from §2.2(a), several runs
  per cell, with the permission log the app already writes for every denied
  request.
- **`docs/design/ui-browser-tab.md` §16.4 still recommends the product token** in
  `damianvtran/local-operator`, and this branch's answer is (b). The design
  document lives in that repository, so the correction is a follow-up there.
- **`signed-update-candidate.yml`'s mac build does not render the entitlements
  plist.** Its artifacts exist to exercise the updater path and are never shipped,
  so the entitlement is not added there; if a candidate ever needs working
  passkeys, it needs the same two lines.
- **A queue of ENDINGS is not built** (agent review round 3, N2): the panel holds
  the newest unacknowledged ending, so two requests expiring in sequence produce
  one paragraph. Nothing is cancelled or hidden by that — the live request always
  wins, and the ending is only shown once nothing is answerable — but it does mean
  the older ending is never acknowledged. A FIFO of endings adds a second axis to
  the panel model and to the frames, and the reviewer who found it explicitly did
  not ask for the fix; it belongs with a design ruling rather than in a
  remediation round.
- **The frozen-tab limit** (§1.4): not fixed, only documented. Nothing in this
  branch makes a captcha solvable in an invisible tab.
- **A refused agent navigation still leaves no trace in the browser surface** (UX
  round 1, U4). An agent's `goto` to an unapproved origin is refused with a typed
  error naming the origin, the approved page is left alone rather than blanked —
  and the user's own surface says nothing at all, so the refusal is legible only in
  the agent's narration. That path is the RPC policy's refusal, not this diff's
  gate: it is pre-existing, identical on the base tree, and making it visible needs
  a notice channel the surface does not have (the consent band's attention path is
  the nearest shape). Recorded rather than half-built here.
- **The UA string change does not claim the stall.** §2.1's caveat stands: the
  app's own shape fails the real-site arm on both trees, and the frozen build
  component (`Chrome/152.0.0.0`, measured against Google Chrome 153.0.8010.53
  presenting `…153.0.0.0`) removes an artifact rather than explaining the
  operator's captcha.
