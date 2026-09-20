# Live proof: the ask gate's options, in the shipped renderer, against a real gate

Fourteen frames of the shipped renderer — served over Vite with `desktopProxyPlugin`
— talking to an **isolated** `local-operator` backend on a scratch port that is
holding a gate opened by the owner's own `_ask_gate([AskQuestion(...)])`: the
same seam `tests/e2e/test_desktop_session.py` uses, so no model and no mock is
involved. The operator's live backend on `127.0.0.1:1111` was never touched; the
rig runs with its own config root, its own 32-byte token, its own scratch root at
`/tmp/ask-gate-rig` (the path the frames are painted with, and the one the
commands below use) and an OS-assigned port.

They are **seven runs**: a pair for the ordinary ordering, a pair for the forced
losing ordering, and the five arms of the refusal itself — including the arms no
run could previously photograph at all (design round 1, D1 and D3; UX round 1,
U1; UX round 2, U7):

- `before-click/` + `after-click/` — a press on the card, the ordinary ordering.
- `lost-report-before/` + `lost-report-after/` — the same press with the answer's
  RESPONSE held back until after the owner's own state push had already cleared
  the card, which is the ordering that produced the false report. The first run is
  the **build before the fix** (the sentence), the second the build **after** it
  (silence). Nothing else differs between them.
- `refused-card/` — a press the answer route **refuses** while the card stays
  painted: the refusal written on the surface the press was made on.
- `refused-composer/` — a press refused **after another front end had already won
  the gate**, so the card is gone when the refusal lands and the composer carries
  it. The operator hit this shape in the other direction (a lost press reported as
  won); here it is a genuinely lost press, and the sentence is true.
- `unknown-composer/` — a press whose request the app **gave up on** without ever
  getting a response, so whether it landed is not knowable and the app says so
  rather than claiming a loss (UX round 1, U1).
- `unknown-card/` — the same failure with the card still PAINTED, which is the
  state a plain press reaches: the request is held past the app's own deadline, so
  the outcome is unknowable *while* the question is still pending. The register is
  the outcome's, so the card carries the same sentence the composer does (UX round
  2, U7; QA round 2, Q1 — whose repro this run is).

Every frame is of the FOLDED lineage: main's window (up to `60c1dc615`) rewrote
`src/` — including `message-input.tsx`, the composer band these frames photograph
— so every run was re-taken on the folded tree rather than carried, and the pair's
two trees differ only by this branch's two files. The set was re-taken once more
for this round, because the sentences themselves changed with the remediation
(the three codeless `409`s are now told apart by live facts, and the
no-response arm has its own register) and because `click-proof.mjs` now records
the tree it ran on (`head`, `srcTree`, `srcDirty`) and the owner's own answer
inside the record (code review round 1, m3). The records below carry
`head = 0c1d4cc95`, `srcTree = 1d00dfbaa`, and `lost-report-before`'s carries
`srcDirty: true` — that run is the pair's whole claim, and it is taken with
`origin/main`'s two renderer files checked out over this branch's, exactly as its
row says.

## What each frame shows

| frame | what it is |
| --- | --- |
| `before-click/localOperatorDark.webp` | **The card, live.** A real pending gate in the shipped renderer: three `<BUTTON>` options with a fill and an edge, the `Recommended` mark beside the **first** option's label in sentence case and the row's own ink (the harness arms `recommended: 1` and `AskQuestion._shape` hoists it to the front), and the hint `Choose an option, type 1-9 and send, or type your own answer below.` The only frame in the repository of the real card rather than a story fixture. The same card appears in every run's `before-click/` frame, because it is the state a press starts from in all of them. |
| `after-click/localOperatorDark.webp` | **The resolution, ordinary ordering.** The same run, after a real `Input.dispatchMouseEvent` press and release at the option's hit-tested centre (the record's `aim` is `x 960, y 644`, `elementFromPoint` resolving to the option itself). The card is **gone** — the gate cleared rather than the page failing — focus is on the composer, and the composer says nothing, because the owner took this answer. |
| `lost-report-before/after-click/localOperatorDark.webp` | **The bug.** The gate cleared, the owner took the pressed label, the answer route answered **200**, and the composer carries `That question was already answered somewhere else, so your answer was not sent.` while the model is already acting on the answer. Taken on `origin/main`'s renderer at `60c1dc615` with this branch's two files checked out of the working tree (`git checkout 60c1dc615 -- src/renderer/src/features/chat/ask-answer.ts src/renderer/src/features/chat/components/chat-page.tsx`), so no part of this branch's fix is in it — which the record itself says with `tree.srcDirty: true` and the two paths in `tree.srcStatus`. |
| `lost-report-after/after-click/localOperatorDark.webp` | **The same run against the fixed build.** The same ordering and the same 200 (`lost-report-after/click-result.json`'s `ordering` says so), with the composer band empty: a press the owner took is not reported at all. |
| `refused-card/after-click/localOperatorDark.webp` | **A refusal that stays on the card.** The route refused with a bare `409` (`{"detail":"This answer belongs to an earlier session owner"}`) while the gate is untouched, so the card is still up and holds `Your answer was not sent. This answer belongs to an earlier session owner.` The run asserts that reading: `report.cardRefusal: true` with `notSentCopy: []` — the sentence is on the page, the card is up, and it did **not** come from the composer's alert band. **This is the SIXTH state, not the rollover**: `--reject-answers` fabricates the refusal body without moving the app's epoch (its own help says the route's epoch check cannot be provoked from the page), so the live epoch still equals the one the press sent and the app has nothing better to say than the route's own reason. The rollover's own sentence is the app's now, and no committed run reaches it — see "What is not framed here". |
| `refused-composer/after-click/localOperatorDark.webp` | **The settled arm.** Another front end answered first (`preAnswer: {"status": 200, "label": "Popup is not open"}`), so the owner kept THAT label (`ownerAnswer`) and this press was the loser the route refused with a bare `409`. No gate is pending when the refusal lands, and that is the fact that makes the settled sentence TRUE — the app knows the press did not settle the question (a press the owner took answers `2xx`), so "answered somewhere else" is established rather than assumed. The run asserts `report.settledSentence: true`. |
| `unknown-card/after-click/localOperatorDark.webp` | **The register on the card, which is the arm a plain press reaches.** The answer request is held past the app's own control deadline (`--hold-answers-ms 40000`) while the gate stays pending, so the card is still up and the outcome is unknowable — the exact state UX round 2's U7 and QA round 2's Q1 measured, where the app used to print `Your answer was not sent` and deny it in the next clause. The card now carries `Whether your answer landed is not knowable. The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting. It may or may not have reached the server; check the result before repeating it.` The run asserts `report.cardUnknown: true` with `notSentCopy: []`, and its options stay disabled, so the control cannot repeat an answer whose fate is unknown (UX round 2, U9). |
| `unknown-composer/after-click/localOperatorDark.webp` | **The arm that must not claim a loss.** The other front end won the gate, and this press's request was then HELD past the app's own control deadline (`--hold-answers-ms 40000`), so the app stopped waiting and never got a response. The composer carries `Whether your answer landed is not knowable. The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting. It may or may not have reached the server; check the result before repeating it.` The run asserts `report.unconfirmedSentence: true`, and the record's answer log shows the held request (`held: true`) beside the winner's `200`. This is the arm UX round 1 measured by killing the backend mid-request, where the owner had kept the label and the app said the answer was not sent. |

The `refused-*` and `unknown-*` runs share a `before-click/` frame with the other
runs by construction (the same card), and their `after-click/` frames are the five
states the sentence can land in. Only `refused-card` claims something other than
a clearing: it records `resolved: true, gateCleared: false, resolution:
"refused"`, because a refused press is not supposed to clear the gate, and its end
state is the refusal itself.


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
busy turn to produce it: the measured margin is small, and the `lost-report-*`
pair holds a 2.5 s delay between the two moments, which inverts it. A margin that
size inverts under load.

**No millisecond figure is quoted in this file or in `ask-answer.ts` any more,
and that is deliberate** (agent review round 2, MINOR-2). The margin is a fresh
sample every time the set is re-taken — across this branch's sweeps the root
record's delivery has led the clearing by 1 ms and trailed it by 0.4 s — so a
quoted number is wrong the moment the frames are re-shot, which is exactly how
round 1's fix went stale. The numbers are in each `click-result.json`
(`answers[].answeredAt`, `answers[].deliveredAt`, `clearedAt`, `clearedAfterPressMs`)
and they are the ones to read.

Note what the DOM sampling is worth when a reader checks those numbers:
`clearedAt` is one sample of a 250 ms poll (`click-proof.mjs`'s resolution
loop), so `clearedAfterPressMs` is quantized to ±250 ms and is not a
millisecond-precise instrument. The two values that ARE precise — `answeredAt`
and `deliveredAt` — are epoch milliseconds taken in the rig's own process.

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
request, answered by `RigControl` rather than by the app, beside the value the
owner kept (`ownerAnswer`) — and the driver reads it before it reads the page, so
a run that produced the wrong ordering says so instead of photographing whatever
was on screen.

Three declarations are what turn a run into evidence, and a run that contradicts
one writes a diagnostic instead of overwriting the committed record:

- `CLICK_PROOF_EXPECT` — what the composer must say: `silent` (a press the owner
took is not reported), `moved-on` (the answer route refused without a code),
`card-refusal` (the not-sent sentence written on the card that is still up),
`card-unknown` (the UNKNOWN register written on the card that is still up, which
is `unknown-card/`), `not-sent` (the card's own sentence in the composer). The
list is the DRIVER's own — `scripts/click-proof.mjs` and `run-rig.sh`'s usage
line — and a value that is not on it falls through the driver's contradiction
chain to "no contradiction", so a run declaring one prints success while
asserting nothing (design round 2, D8).
- `CLICK_PROOF_EXPECT_ORDER` — `cleared-first` / `delivered-first`, asserted
against `ordering.verdict`. The verdict was already computed and printed but
never checked, so a run whose `--answer-delay-ms` did not take could be committed
as proof of the losing order while showing the winning one (code review round 1,
m3). `-` means the run makes no ordering claim: a refused press never clears the
gate, so there is no clearing to order against.
- `CLICK_PROOF_RESOLUTION` — `cleared` (the ordinary contract) or `refused` (the
end state is the refusal itself, on a card that is still up).

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
`answerRefusedWithoutACode` keys on, and why the app no longer needs to watch the
DOM for its card.

## What a bare `409` does NOT establish, and the live facts that separate the three

`2xx` means our value; a bare `409` means the route would not take it — and
nothing more. The route raises THREE refusals in that shape (code review round 1,
MAJOR-1), and the app holds the two facts that tell them apart without asking the
backend to say which:

| condition | body (measured against this rig) | how the app knows | sentence |
| --- | --- | --- | --- |
| another front end settled it | `{"detail":"This question or approval is no longer pending"}` | no gate pending, epoch unmoved | `That question was already answered somewhere else, so your answer was not sent.` |
| the ask advanced past it | `{"detail":"the answer does not match the current question"}` | a gate pending with a DIFFERENT key | `That question had already been settled or moved on, so your answer was not sent.` |
| the epoch was minted by a previous runtime instance | `{"detail":"This answer belongs to an earlier session owner"}` | the live epoch differs from the one the press sent | `Your answer was not sent. The app reconnected to a new runtime instance, so the question was not answered here.` |

The old sentence named the settlement for all three, so in the last two the app
told the user a front end they do not have had answered the question — while it
was still pending and still answerable (measured; the reviewer reproduced it).

The rollover is the one arm of the three with NO frame, and its sentence is the
app's own rather than the route's — see "What is not framed here" below. The
`refused-card/` frame shows the sixth state instead (a bare `409` with the pressed
question still live), which is the state the shipped harness can actually reach.

**And the SENTENCE no longer depends on which surface caught it** (UX round 2,
U8): the register is chosen from the outcome class before the destination is
chosen at all, so a rollover refusal reads the same on the card and in the
composer. Before this it read the backend's raw `detail` on the card and an
authored sentence in the composer, which made the copy a function of whether the
owner's state push beat the refusal — a race no user can see.

The three facts are read LIVE (`chat-page.tsx` keeps the gate key and the owner
epoch in refs). The render closure the async handler resumes with is the one the
press STARTED in, so a value read from it is the press compared with itself —
which is exactly the inert conjunct this branch deleted.

## The failure that carried no response

A refusal the owner made is not the only way a press can fail. `--hold-answers-ms`
photographs the other one: the request is held past the app's own control
deadline, so no response ever comes back while the backend is still alive and
working. Two bounds are involved and the frame's failure is the tighter one:
main's `fetch` deadline for a control op is 20 s (`DESKTOP_CONTROL_DEADLINE_MS`),
which is what synthesises the `504 deadline_exceeded` this run records, and the
renderer's own bound is 5 s above it (`desktopRequestTimeoutMs`), which only
covers the IPC round trip never settling at all. The app's own copy for that case already
says it may or may not have reached the server, and the composer now leads with
that rather than asserting a loss (UX round 1, U1 — whose measurement was the
same shape reached by killing the backend mid-request: the owner HAD kept the
label while the composer said the answer was not sent).

`answerOutcomeIsUnknown` covers the four ways the app loses sight of a request
without the owner refusing it — no HTTP response at all, its own `deadline_exceeded`
(a `504` main synthesises), its own `transport.failed`, and the DAEMON's own hop
failure (`503 {"code": "runtime_unreachable"}`, the answer route failing to hand
the value to the session's owner over its write-then-await-ack frame) — and
deliberately not the statuses the backend chose as REFUSALS, such as a `503` with
`pairing.plane-closed` or a coded `409`.

The daemon's code is the one agent review round 2's MAJOR-1 measured, and it is a
sight loss rather than a refusal for a structural reason: the frame is WRITTEN
before its ack is awaited, so an owner that resolved the gate and then lost its ack
produces this status. Classifying it as definite is what printed "your answer was
not sent" over an answer the owner had kept — the same defect this branch exists to
remove, one hop down.

## The knobs these frames need

```sh
# The refusal written on the CARD, which stays painted: refused-card/
bash docs/evidence/ask-options-live/harness/run-rig.sh \
  docs/evidence/ask-options-live/refused-card card-refusal 0 - refused \
  --reject-answers "This answer belongs to an earlier session owner"

# Another front end wins the gate first, so the refusal lands with the card GONE
# and no gate pending: the settled arm, refused-composer/
bash docs/evidence/ask-options-live/harness/run-rig.sh \
  docs/evidence/ask-options-live/refused-composer settled 0 - cleared \
  --pre-answer "Popup is not open"

# The same, with this press's request held past the app's own deadline, so no
# response ever comes back: the unknown arm, unknown-composer/
bash docs/evidence/ask-options-live/harness/run-rig.sh \
  docs/evidence/ask-options-live/unknown-composer unknown 0 - cleared \
  --pre-answer "Popup is not open" --hold-answers-ms 40000

# The same hold WITHOUT pre-answering, so the card is still painted when the app
# gives up: the unknown register on the card, unknown-card/ (UX round 2, U7)
bash docs/evidence/ask-options-live/harness/run-rig.sh \
  docs/evidence/ask-options-live/unknown-card card-unknown 0 - refused \
  --hold-answers-ms 40000
```

## What is not framed here, and why round 3 must not assume it was seen

Two of this branch's sentences have no frame, and both are unreachable from the
harness as shipped (design round 2, D7):

- **the rollover sentence** (`ANSWER_LOST_TO_RECONNECT_MESSAGE`) — reaching it
  needs the app's live owner epoch to have MOVED, which means a new runtime
  instance behind the same session. `serve-gate.py` arms one `AskQuestion` against
  one runtime and its `--reject-answers` fabricates the refusal BODY without
  rolling the epoch (the route's epoch check cannot be provoked from the page), so
  no knob here can produce the state.
- **the composer's moved-on sentence** (`QUESTION_MOVED_ON_MESSAGE`) — reaching it
  needs a gate pending under a DIFFERENT key, i.e. a multi-question ask that has
  advanced, which the single-question harness cannot arm.

Both are asserted at the unit level (`scripts/ask-options.test.mjs`, including the
sabotage that reddens if the rollover sentence goes back to the route's wording),
and neither is claimed as rendered. A frame for each needs a rig change — an
epoch roll pushed to the frontend, and an ask that advances — which is its own
change rather than part of this one.

`--reject-answers` answers the request itself with a bare `409` carrying that
detail and lets the gate stay pending, which is the state the reviewer measured by
firing the two requests that do not name the current question. `--pre-answer`
answers first **through the same route** with a second front end's label, so the
request the app then makes is the loser the route refuses — the shape
`probe-answer-exclusivity.py` produces concurrently, here sequenced so a frame can
be taken. `--hold-answers-ms` delays that loser's request past the renderer's own
control deadline instead of letting it reach the route. Two more exist for runs
that need them and are used by nothing committed here: `--drop-answers` (a
response that never starts) and `--die-after-answer-ms` (the backend killed after
it produced a response, undelivered), the second paired with
`--answer-log-file` so the record survives the process. None of them fakes an
outcome: in `refused-composer` and `unknown-composer` the winner's `200`, the
loser's `409` (or its absence) and the owner's `ownerAnswer` are all the route's
own answers, and the record's `answersFrom` says whether the log came from the
live route or from the file the harness flushes for a run that kills it.

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
- `harness/run-rig.sh` — the runner that wires the three together for one press,
  waits for the dev-server port rather than racing it, and kills every process it
  started by exact pid.

```sh
# 1. The isolated backend. Own config root, own token, OS-assigned port; it
#    prints and writes the port, and arms the card only when the driver asks.
#    `--answer-delay-ms 2500` is what forces the losing order (see the section
#    above); omit it for the ordinary one. `--pre-answer` and `--reject-answers`
#    produce the two refusal arms (see the section above); they are mutually
#    exclusive with each other and `--reject-answers` makes `--answer-delay-ms`
#    moot, since it answers before the route is reached.
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
#    `silent` on the fixed build, `moved-on` / `card-refusal` for the refusal
#    arms, `old-settled` on the build before the fix — and fail (writing
#    click-result.diagnostic.json, leaving the committed record alone) when it
#    says anything else. CLICK_PROOF_EXPECT_ORDER asserts the ordering the run
#    was told to force, and CLICK_PROOF_RESOLUTION says how the press is meant
#    to end (`cleared` or `refused`).
CLICK_PROOF_EXPECT=silent \
CLICK_PROOF_EXPECT_ORDER=delivered-first \
CLICK_PROOF_RESOLUTION=cleared \
  node scripts/click-proof.mjs http://localhost:5199 docs/evidence/ask-options-live a1a1a1a1a1a1
```

`docs/evidence/ask-options-live/harness/run-rig.sh` in this directory wraps all
three steps (and the teardown) for the captures committed here, so the frames can
be re-derived with one command:

```sh
bash docs/evidence/ask-options-live/harness/run-rig.sh <out-dir> \
  <expect|-> <answer-delay-ms> <order|-> <resolution> [serve-gate.py args...]
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