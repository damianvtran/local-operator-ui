# Live proof: the ask gate's options, in the shipped renderer, against a real gate

Six frames of the shipped renderer — served over Vite with `desktopProxyPlugin`
— talking to an **isolated** `local-operator` backend on a scratch port that is
holding a gate opened by the owner's own `_ask_gate([AskQuestion(...)])`: the
same seam `tests/e2e/test_desktop_session.py` uses, so no model and no mock is
involved. The operator's live backend on `127.0.0.1:1111` was never touched; the
rig runs with its own config root, its own 32-byte token and an OS-assigned port.

They are **two pairs**, and the second is the reason this set was re-taken:

- `before-click/` + `after-click/` — a press on the card, the ordinary ordering.
- `lost-report-before/` + `lost-report-after/` — the same press with the answer's
  RESPONSE held back until after the owner's own state push had already cleared
  the card, which is the ordering that produced the false report. The first run is
  the **build before the fix** (the sentence), the second the build **after** it
  (silence). Nothing else differs between them.

All six frames are of the FOLDED lineage: main's window (up to `60c1dc615`)
rewrote `src/` — including `message-input.tsx`, the composer band these frames
photograph — so every run was re-taken on the folded tree rather than carried,
and the pair's two trees differ only by this branch's two files.

## What each frame shows

| frame | what it is |
| --- | --- |
| `before-click/localOperatorDark.webp` | **The card, live.** A real pending gate in the shipped renderer: three `<BUTTON>` options with a fill and an edge, the `Recommended` mark beside the **first** option's label in sentence case and the row's own ink (the harness arms `recommended: 1` and `AskQuestion._shape` hoists it to the front), and the hint `Choose an option, type 1-9 and send, or type your own answer below.` The only frame in the repository of the real card rather than a story fixture. The same card appears in both `lost-report-*` runs' `before-click/` frames, because it is the state a press starts from in all three. |
| `after-click/localOperatorDark.webp` | **The resolution, ordinary ordering.** The same run, after a real `Input.dispatchMouseEvent` press and release at the option's hit-tested centre (`x 960, y 644`, `elementFromPoint` resolving to the option itself). The card is **gone** — the gate cleared rather than the page failing — focus is on the composer, and the composer says nothing, because the owner took this answer. |
| `lost-report-before/after-click/localOperatorDark.webp` | **The bug.** The gate cleared, the owner took the pressed label, the answer route answered **200**, and the composer carries `That question was already answered somewhere else, so your answer was not sent.` while the model is already acting on the answer. Taken on `origin/main`'s renderer at `60c1dc615` with this branch's two files checked out of the working tree (`git checkout 60c1dc615 -- src/renderer/src/features/chat/ask-answer.ts src/renderer/src/features/chat/components/chat-page.tsx`), so no part of this branch's fix is in it. |
| `lost-report-after/after-click/localOperatorDark.webp` | **The same run against the fixed build.** Byte-for-byte the same ordering and the same 200 (`lost-report-after/click-result.json`'s `ordering` says so), with the composer band empty: a press the owner took is not reported at all. |

**The pair evidences the clearing, and the run's own record is what says so.**
`click-result.json` carries `resolved: true` and `after: {"found": false,
"count": 0}` (the pre-click DOM is in its `before` block), and
`owner-answer.json` records the label the owner received
(`{"PAIRING": ["Popup is open - generate the pairing code"]}`) — the option's
**label**, never its index. Both files are the run's own outputs, written by the
committed driver.

## The forced ordering, and why it is forced rather than waited for

Whether a press became the answer is decided from two channels that have **no
ordering between them**: the answer POST's response, and the owner's own state
push, which is what clears the card. The app's bug lived in that gap — it read
the card to decide the press had lost, and a press's own success is what removes
its card. A run that wants the interesting order, push first, cannot wait for a
busy turn to produce it: the measured margin is small (this rig's ordinary run
delivered the response 2 ms after the route answered and the card cleared 300 ms
later; the figure quoted in `ask-answer.ts` from an earlier round is 124 ms
against 200 ms), and a margin that size inverts under load.

So `harness/serve-gate.py --answer-delay-ms N` **forces** it, and forces it
honestly. The request is delivered and the route runs untouched — the owner
resolves the gate and pushes state at its normal moment, recorded as `answeredAt`
— and only the DELIVERY of the response the route already produced is held. Each
run's `click-result.json` therefore carries all three moments and the verdict
derived from them:

```json
"answers": [{ "requestedAt": 1789868803197.2, "answeredAt": 1789868803208.5,
              "status": 200, "deliveredAt": 1789868805710.4 }],
"clearedAt": 1789868803482,
"ordering": { "verdict": "the card cleared before the response was delivered" }
```

`GET /rig-state` is where that comes from — the rig's own log of every answer
request, answered by `RigControl` rather than by the app — and the driver reads it
before it reads the page, so a run that produced the wrong ordering says so
instead of photographing whatever was on screen. `CLICK_PROOF_EXPECT=silent`
(the fixed build) fails the run and writes a diagnostic instead of the record if
the composer says anything at all; `CLICK_PROOF_EXPECT=settled` is its mirror for
the build before the fix. That is how the two runs above are told apart: the only
difference between them is the tree under the rig.

## Can a `2xx` be a loss? Measured, not assumed

The fix rests on one backend property: the answer route answers `2xx` only when
the owner applied OUR value. `harness/probe-answer-exclusivity.py` measures it —
two concurrent answers with **different labels** on one real gate, plus a third
after the gate is settled, against the same isolated runtime this rig uses:

```sh
~/local-operator/.venv/bin/python \
  docs/evidence/ask-options-live/harness/probe-answer-exclusivity.py 6
```

Six rounds: exactly one request per gate is answered `2xx`, that request's label
is the one `owner-answer.json` shows the owner took, and both losers — the
concurrent one and the late one — are refused with a bare `409`. That is what
`answerWasSettledElsewhere` keys on, and why the app no longer needs to watch the
DOM for its card.

This supersedes two earlier problems with this set, both now closed:

- The previous pair's after frame showed three failure surfaces rather than a
  resolution (the Vite dev server had died mid-run), and was renamed
  `after-click-unresolved/` to stop it being read as evidence of the clearing.
  The `ERR_HTTP_HEADERS_SENT` defect behind that death is fixed in
  `desktop-proxy.ts`, and the re-captured pair resolves, so the frame is back at
  `after-click/` — a name that now tells the truth about what it shows.
- The previous pair could not be re-derived from the committed rig at all: the
  harness seeded the provoking user turn **after** `/rig-arm`, which is one page
  load too late — the app had already been answered its history request, so the
  durable row never reached the transcript, `CanonicalTranscript` collapsed to
  `h-0` as designed, and the driver failed with `no fieldset`. The turn is now
  appended before the driver is allowed to arm (and therefore before the page
  asks for its history). The record is regenerated by the committed driver, so
  the record and the driver agree on their field names (`textContent`,
  `accessibleName`, `pointerEvents`).

## Reproduction, from the repository

Three pieces, all in the tree:

- `harness/serve-gate.py` — the isolated backend. Real uvicorn, the app's own
  bearer/origin gate, the real `desktop_sessions` routes, a real `Session` over a
  real transcript, a real `ServingSessionHandle`/`RuntimeServer`, and a real
  `_ask_gate`. Only the provider stream is a stand-in, and it raises if it is
  ever called, because nothing here starts a turn. It also answers the rig's two
  control routes: `/rig-arm` and `/rig-state`.
- `harness/ask-gate.vite.mjs` — the renderer's browser dev server, with the
  committed `desktopProxyPlugin`, the app's own CSP, and the preload shim the
  browser-development surface needs (below).
- `scripts/click-proof.mjs` — the driver: a private `--headless=new` Chromium
  driven over raw CDP with real `Input.dispatchMouseEvent` press/release, the
  same technique `scripts/capture-evidence.mjs` uses.
- `harness/probe-answer-exclusivity.py` — the backend-side probe that measures the
  property the fix rests on, with no browser involved.

```sh
# 1. The isolated backend. Own config root, own token, OS-assigned port; it
#    prints and writes the port, and arms the card only when the driver asks.
#    `--answer-delay-ms 2500` is what forces the losing order (see the section
#    above); omit it for the ordinary one.
python docs/evidence/ask-options-live/harness/serve-gate.py \
  --scratch /tmp/ask-gate-rig \
  --token-file /tmp/ask-gate-rig/token \
  --result-file /tmp/ask-gate-rig/owner-answer.json \
  --answer-delay-ms 2500

# 2. The shipped renderer, pointed at it. The token is read by the Vite NODE
#    process, never by a VITE_* variable, and never printed.
VITE_LOCAL_OPERATOR_API_URL=http://localhost:5199 \
LOCAL_OPERATOR_DESKTOP_BACKEND_URL=http://127.0.0.1:$(cat /tmp/ask-gate-rig/port) \
LOCAL_OPERATOR_DESKTOP_TOKEN=$(cat /tmp/ask-gate-rig/token) \
  npx vite --config docs/evidence/ask-options-live/harness/ask-gate.vite.mjs

# 3. Open the session, wait for the app shell, then arm the card and click it.
#    CLICK_PROOF_EXPECT makes the run assert what the composer must say —
#    `silent` on the fixed build, `settled` on the build before it — and fail
#    (writing click-result.diagnostic.json, leaving the committed record alone)
#    when it says anything else.
CLICK_PROOF_EXPECT=silent \
  node scripts/click-proof.mjs http://localhost:5199 docs/evidence/ask-options-live a1a1a1a1a1a1
```

`click-proof.mjs` waits for the app shell, calls `/rig-arm` (proxied to the
rig's own control route), waits until the option is genuinely **hit-testable**
— `elementFromPoint` at its painted centre resolves to that button — then
presses and releases there. It then waits for the rig to record the answer's
DELIVERY (`/rig-state`) before it reads the composer, so the report it records is
the one the user would have seen after the whole round trip. It writes
`click-result.json` and exits non-zero without overwriting it when a step fails,
so a failed run cannot be mistaken for a successful one. When it does fail it writes `click-result.diagnostic.json`
(every failure path, including the ones that happen before the first frame, for
which the output directory is now created up front) so the reason survives
instead of being replaced by an `ENOENT`.

Two stand-ins were needed to boot the app in a browser at all. Both are
pre-existing gaps in the browser-development surface that this change neither
introduces nor fixes, and both are in `harness/ask-gate.vite.mjs` rather than
hidden in a scratch directory:

- `app.tsx` and several hooks read `window.electron.ipcRenderer` and
  `window.api.*` unguarded, which only Electron supplies. The shim provides
  them — and deliberately leaves `window.api.desktop` UNDEFINED, because that is
  what makes `desktop-api.ts` take its shipped **browser** branch through
  `/__desktop`, which is the path under test.
- The provider-onboarding modal opens on any install with no credential and has
  no close control. It is settled by seeding the onboarding store's own
  persisted completion flag (`onboarding-storage`), the way a returning user
  would have it.