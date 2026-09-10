# Failed-send evidence

The failed send moves off a banner at the top of the chat page and onto the
composer that holds the message. These frames are the before state, the after
state, the two ways the error clears, and one `errorCode` remedy.

## What produced these frames

**The real Electron app**, not Storybook. `electron-vite dev` running this
worktree's source, with the app's own main and preload processes and its real
IPC desktop transport, against a real `local-operator serve` backend paired
through a shared `LOCAL_OPERATOR_DESKTOP_TOKEN`. Frames were captured over the
Chrome DevTools Protocol against that window, the same raw-CDP approach as
`scripts/capture-evidence.mjs`, by `scripts/send-error-evidence.mjs`.

The failures are **real failures**, not props set on a component:

- The unreachable-backend frames were produced by stopping the backend process
  and pressing Enter in the composer. The error is the app's own transport
  reporting that it could not reach a backend.
- The `unresolved_attachment` frame was produced by answering the admission
  POST (`/v1/desktop/sessions/<id>/messages`) with the 409 the backend itself
  returns for that condition (`detail.code`, the shape asserted in
  `scripts/desktop-renderer-transport.test.mjs`). Only the backend's verdict was
  substituted, at the HTTP boundary; the app's own transport parsed it, its own
  `DesktopControlError` carried the code, and its own draft store recorded it.

Text was entered through the native `HTMLTextAreaElement` value setter followed
by a real `input` event, and sends were triggered by a real `Enter` keydown on
the focused textarea, so the app's own submit path ran in every case.

**What these frames do not prove:** the packaged/notarised build (this is the
dev main process), any theme other than `localOperatorDark`, any window size
other than 1380x872, or screen-reader announcement (the `role="alert"` is
present in the DOM, which is not the same as hearing it). The
`profile_registry_unavailable` remedy shares one code path with the
`unresolved_attachment` remedy captured here and was not photographed
separately. The "server is offline" strip visible along the top of every frame
is the legacy agents REST probe against a backend that does not serve that API;
it is present on `origin/main` too and is unrelated to this change.

## Before / after

| Frame | Observed behaviour |
| --- | --- |
| [before-banner-at-top.png](before-banner-at-top.png) | The reported state, on `origin/main`. The error, a read-only echo of the message, and a "Discard unsent message" link are pinned above the header. The composer at the bottom already contains the same text. |
| [after-error-at-composer.png](after-error-at-composer.png) | Same failure on this branch. The error sits directly on top of the composer, edge-aligned with it, and the message is in the input, editable. No echo. |
| [after-edit-clears-error.png](after-edit-clears-error.png) | After typing one more clause into the composer. The alert is gone; the amended text remains. |
| [after-retry-succeeded.png](after-retry-succeeded.png) | The backend restarted and the same draft re-sent with the send button's normal path. Session `1f0eb47ed29d` was created and the agent is answering. |
| [after-unresolved-attachment-actions.png](after-unresolved-attachment-actions.png) | The `unresolved_attachment` 409. The backend's own message plus "Choose agent" and "Choose team" at the composer, with the text still editable. |

## The measurement

The sibling PR (#101) independently measured this banner as rendering "525px
away at y=0, above the header, while the chip it names sits at the bottom".
Measured here in the running app at 1380x872, on the same conversation:

| | banner/alert top | composer top | distance |
| --- | --- | --- | --- |
| `origin/main` | 36 | 744 | **709px** |
| this branch | 529 | 600 | **0px gap**, edges aligned to 0px |

`gapPx` is the space between the alert's bottom edge and the composer's top
edge, and `edgeDeltaPx` is the difference between their left edges. Both are 0:
the alert shares the composer's track, so the two read as one unit.

## What was checked in the running app, not in the code

Captured alongside the frames by `scripts/send-error-evidence.mjs`:

- `textareaValue` after a failed send is the submitted message, and
  `textareaEditable` is `true`. The copy's claim that the message is still in
  the composer is a measured fact, not an assertion.
- `echoedCopyPresent` is `false` on every after frame: no element inside the
  alert repeats the textarea's contents.
- Editing clears the alert (`alertBeforeEdit: true` -> `alertAfterEdit: false`)
  while keeping the amended text.
- "Discard unsent message" clears the alert, empties the textarea, and drops the
  store's retained claim (`clicked: true, alertGone: true, value: ""`).
- "Choose agent" opens the real agent picker (`pickerOpen: true`), so the remedy
  is usable where it now lives rather than merely rendered there.

One behaviour worth recording because it was observed rather than designed: with
an unconfirmed send retained, re-sending the same text unchanged surfaces the
store's own guard message ("The previous send has not been confirmed. Retry it
unchanged, or discard it to send something different.") at the composer. That
guard is unchanged by this work; discarding clears it, which is what the discard
control is for.

## Reproducing

```
export LOCAL_OPERATOR_DESKTOP_TOKEN=$(openssl rand -hex 32)
local-operator serve --host 127.0.0.1 --port <your-port>

LOCAL_OPERATOR_DESKTOP_TOKEN=$... npx electron-vite dev \
  --remoteDebuggingPort=<your-cdp-port> -- --user-data-dir=<scratch>
```

`--user-data-dir` is required when another Electron instance is already running:
the app takes a single-instance lock and a second copy otherwise exits at once.
Then, with a message typed in the composer, stop the backend and press Enter:

```
node scripts/send-error-evidence.mjs <cdp-port> docs/evidence/send-error <name>
```

## Round-1 remediation

Three review streams (agent review F1-F7, UX U1-U10, design D1-D6) converged on
one defect behind both blockers: the retained-claim model was **enforced but
invisible**. Clearing the textarea left `admissionAttempted: true` with nothing
on screen, so the next different message was refused by a healthy backend with
no causal link to the action that caused it (U1); and the copy that was supposed
to explain the refusal instructed the user to "edit it… then send again", which
is the one thing `admitChatDraft` throws on, producing a loop (U2/F1/D4).

The claim is now **stated whenever it is held and not visible in the box**, and
the two remedies are controls rather than instructions:

- **Restore unsent message** puts the exact held payload back, so an unchanged
  retry is one keypress. The guard demands a byte-identical resend of a message
  the user can no longer see; asking them to retype it was asking the impossible.
- **Discard unsent message** / **Stop holding it** — one control, two behaviours.
  With the box empty or holding the payload it discards the draft. With
  *different* text typed it releases only the store's claim, because discarding
  there would silently destroy what the user just typed (U3).

The generic "send it again" tail is now conditional on the next send actually
being acceptable, so it never appears on the guard it contradicts.

### Measurements (own tree, provenance asserted, focus emulation on)

Every frame below was taken with `location.origin` asserted against this
session's own dev server, the new copy present, and both `origin/main`'s deleted
copy and round-1's replaced copy absent. Round 1 lost four frames to an Electron
window that silently reattached to another PR's vite server, so origin is
asserted before any number counts.

**U1 — driven end to end, existing-session path.** The new-chat path fails at
`createSession`, *before* `admissionAttempted` latches, which is why round-1
evidence never reproduced the trap. Failing only the admission POST reproduces
it:

```
STEP 1 admission fails   alert: "The previous send has not been confirmed, and it does not
                                 match what is in the composer now." + held notice
                         buttons: [Restore unsent message, Stop holding it]
STEP 2 select-all-delete mentionsHeld: true    <- was: zero indication
STEP 3 type DIFFERENT    mentionsHeld: true, abandon control = "Stop holding it"
STEP 4 click escape      typed draft SURVIVED: true
STEP 5 send              wire: POST /v1/desktop/sessions/<id>/messages
                               body.text = "Actually, what is the weather in Toronto?"
```

The last line is the proof: round 1 this send was refused client-side and never
reached the wire. The 500 that follows is a backend-side `ImportError` in this
local build (`RuntimeLocality`), unrelated to this PR.

**D2 — long draft, narrow column, with positive control.** Round 1 measured the
composer pushed 93px below the viewport with the send button unreachable at a
~520px column. The alert is now capped (`max-h-32`, internal scroll):

| viewport | alert h | offscreenBy | send visible | control (alert off) | delta |
| --- | --- | --- | --- | --- | --- |
| 620x620 | 128 | -4 | true | -4 | 0px |
| 520x600 | 128 | -4 | true | -4 | 0px |
| 800x600 | 110 | -4 | true | -4 | 0px |

Zero delta against the positive control at every width: the alert is no longer
capable of moving the composer's bottom edge.

**D1 — 12-theme contrast, re-measured.** Danger prose vs the abandon control,
each against the footer ground:

| theme | danger | abandon | | theme | danger | abandon |
| --- | --- | --- | --- | --- | --- | --- |
| localOperatorDark | 7.08 | 5.46 | | neon | 5.35 | 5.76 |
| localOperatorLight | 5.22 | 4.95 | | obsidian | 8.23 | 6.20 |
| dracula | 5.32 | 6.31 | | radient | 6.98 | 7.41 |
| dune | 5.64 | 6.38 | | sage | 5.27 | 5.21 |
| iceberg | 5.18 | 5.19 | | synth | 7.03 | 6.29 |
| monokai | 5.11 | 6.29 | | tokyoNight | 6.46 | 6.47 |

Worst case radient improves from **11.86 to 7.41**. The round-1 note said the
worst margin over danger fell from **4.88 to 0.43**; that tracked `radient`
across both rounds, but the worst THEME migrated, so the true maximum over the
twelve is **1.18 (monokai)** — radient is only 4th-worst, at 0.43. Corrected
here because both reviewers accepted the residual on the strength of how small
it is, and 1.18 is the number that acceptance rests on. Five themes put danger
on top.

Deliberately not "fixed" by contrast: mixing danger toward the ground guarantees
the ordering but collapses the control to 1.05-1.47:1 — an illegible destructive
control, a worse defect. That band is worst in the **light** palettes (`iceberg`
and `localOperatorLight` reach 1.04 at 5% and stay under 1.50 through 40%); the
round-1 note attributed it to the dark ones, which was wrong in attribution
though not in conclusion. The ranking is instead carried by size and weight,
which no palette can invert — see D6 below.

**D3/D5/U8/U9/U10.** Remedy buttons carry `underline` at rest and
`cursor: pointer` (measured `textDecorationLine: underline`, `cursor: pointer`);
the alert's horizontal padding now matches `COMPOSER_BOX` (`px-4`/`px-2`), so the
error prose and the message text share a left edge; the action row is `min-h-6`.

---

## Round 2 remediation

Four defects the round-1 remediation introduced or left, verified against a real
renderer (`electron-vite dev` on a pinned strict port) and a real HTTP backend
speaking the desktop contract, with a controllable verdict so the app's own
transport, `DesktopControlError` and draft store all run. Frame ownership was
asserted before any reading counted: origin, an injected `probe-marker`, a CSP
carrying this run's backend port, and `document.hasFocus()` under focus
emulation. Every absence measurement below has a known-positive canary, because
a dead instrument reports "the defect is gone" exactly as it reports a pass.

**R1 — a `pending` draft was abandonable, which stripped `admissionRequestId`.**
`admissionAttempted` is set before the awaited request, so the claim notice and
its abandon control were live for the whole in-flight window. Fixed on both
sides: `updateDraft` refuses a patch that would resurrect a deleted row, and the
claim UI waits for the send to settle.

```
in-flight (2.5s into an unanswered admission)
  alert present: false      controls: []       <- nothing to abandon mid-flight
after it settles
  "The backend could not complete this request." + [Discard this message]
after the escape, healthy backend
  WIRE: 1 message  request_id well-formed      <- session not wedged
canary: same probe on the pre-fix tree (e10f732cd, byte-identical archive)
  GHOST ROW RESURRECTED (missing key, createRequestId, admissionRequestId)
  send#0..3 REFUSED "Invalid desktop operation." wire.requestId=undefined
```

**U7 — the guard and the copy compared different strings.** `normalizeSendText`
is now the single payload boundary; the composer compares the normalized box
against the normalized claim, so no edit can land in a gap between them.

```
held = "...flag anything unusual. "  (trailing space)
user removes the trailing space, backend healthy, Enter
  WIRE: 1 message "…flag anything unusual."   <- reached the wire
canary (known-positive): a genuinely different message with a claim held
  WIRE: 0 messages, alert offers [Restore unsent message, Stop holding it]
```

**R2 — the U4 fix keyed on a pre-send intention.** `loadedTarget` falls back to
`draft.target.name`, which a staged draft carries before any send, so an
`unresolved_attachment` failure cleared itself on the first render. It now keys
on the live binding only.

```
staged draft (target set pre-send), 409 unresolved_attachment
  t+400ms / t+1200ms / t+3000ms:
    [Choose agent, Choose team, Discard this message]   <- remedies survive
canary: the same probe observes the alert clearing on a real dismiss path
```

**R3 — a vacuous assertion.** `store.error` was never made non-null, so the
landed-send clear could not be distinguished from nothing having set it. The
test now establishes it first, and does so by DRIVING `createSession` to fail
rather than by `setState`-ing the field: a hand-seeded precondition can put the
fixture in a state production never reaches, and can mask or repair the very
behaviour under test. The picker calls `createSession` directly with no
admission involved, so this is a state a user genuinely reaches. Mutation, clean `md5` restore between mutants, each
asserted to land and to parse:

| mutant | before | after |
| --- | --- | --- |
| B — delete the success-path `setState({error:null})` | **survived 14/14** | **RED**, names the test |
| A, C, D, E (round-1 mutants) | RED | RED |
| F — revert the `updateDraft` guard | — | RED |
| G — guard compares raw `input.text` | — | RED |
| H — `normalizeSendText` becomes identity | — | RED |

G initially survived and exposed vacuity in this round's own new test: the first
loop iteration succeeded, retiring the draft, so later iterations tested an
unarmed guard. The loop now keeps the claim armed and asserts each variant
reaches the wire normalized.

**D6 — hierarchy carried by icon and weight rather than hue.** Measured live in
the running app, failure state:

```
error prose : CircleAlert present (svg 1), font-weight 500, 13px
controls    : Restore unsent message 12px, abandon 12px
```

`danger` is the highest-contrast ink in 0 of 12 palettes, so a hue-ranking rule
is unwinnable by construction; size and weight are axes no palette contests.
