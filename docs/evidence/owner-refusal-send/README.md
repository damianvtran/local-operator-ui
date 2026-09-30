# A send the owner refused before admission (held draft vs handed back)

**EVERY FRAME HERE IS COMMITTED AS `<arm>/<name>/<theme>.webp`** (2026-09-25). The evidence
gate derives a frame's expected ground from its FILENAME, so the name has to be the
palette the frame was painted under; these were committed under the arm and the moment
they show instead, and were renamed in place - the bytes are untouched.

Frames of the composer after a send that the session's OWNER refused before it
admitted anything — the state the operator reported as a held draft. `before/`
is unmodified `origin/main` (`e48d64b81`), `after/` is this branch, and the two
halves come from the SAME rig, the same stub, the same message and the same
window size, so the difference between them is the change and nothing else.

## Which refusal each arm stands for, and whether the fix reaches it

The owner answers a control call it will not serve with one of two refusals. Only
one of them carries a machine code today, and that decides which half of this
change the frames can show:

| Arm | What the owner answers (captured from the real ladder) | Live today? |
| --- | --- | --- |
| `busy-exhausted` / `busy-internal` | `503 {"detail": {"code": "runtime_busy", "message": "Session owner is unavailable. Reconnect and reconcile before retrying.", "retryable": true, "retry_after_ms": 2000}}` | yes — this is the incident |
| `retiring` | `409 {"detail": "This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted — send it again once the new build is up."}` | **no code on the wire**: the arm is INERT |
| `unreachable` | `503 {"detail": {"code": "runtime_unreachable", "message": "Session owner is unavailable. Reconnect and reconcile before retrying."}}` | yes — the CONTROL, deliberately unchanged |

That middle row is the one finding that governs how this set must be read, and it
is stated rather than papered over. `RuntimeRetiring` is a `ValueError` whose
desktop ladder arm is `raise HTTPException(409, str(error))`: the ladder's coded
arm covers the attachment, profile-registry, superseded-token and
deletion-refused errors, and this one is not among them, so what arrives is a
plain STRING `detail` with no `code` for the renderer to read. The bodies above
are not read off a document — they are captured by running the ladder itself
(`harness/capture-bodies.py`, backend `origin/main` = `5bc34c90`), which is also
how the previous revision of this evidence was caught asserting a wire shape that
does not exist. Consequence: **the `retiring` arm's frames are the held state in
BOTH halves** — the app cannot classify a refusal nobody labelled — and the
`runtime_retiring` term in `isRefusedBeforeAdmission` is forward-compatible code
waiting on the backend half, not a live fix. The answer to the CODED body is
pinned where an assertion belongs, `scripts/canonical-chat.test.mjs`, because no
backend sends it yet.

**The dependency, named.** Backend PR #1494 (`fix(desktop): answer a retiring
refusal as a coded 409`, head `f7b1890b4`) is the half that puts the code on the
wire: it adds `RuntimeRetiring` to the ladder's coded arm WITHOUT moving the
sentence. Captured from that head with the same script, the retiring refusal
becomes
`409 {"detail": {"code": "runtime_retiring", "message": "This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted — send it again once the new build is up."}}`
(and `409 {"detail": {"code": "runtime_retiring", "message": "This session is leaving; it will not start a new turn. …"}}`
for a plain departure), with no `retryable` and no `retry_after_ms`. Until that
lands, this PR's retiring arm is inert: the frames ship the uncoded body above,
because that is what a real owner answers with today, and the coded body's answer
lives in the unit test rather than in a frame.

## What each frame shows

| Arm (the owner's verdict) | `before/` — origin/main | `after/` — this branch |
| --- | --- | --- |
| `busy-exhausted` — `503 runtime_busy` on four attempts (the app's own three repeats included), admission afterwards | [before/busy-exhausted-after-first-send/localOperatorDark.webp](before/busy-exhausted-after-first-send/localOperatorDark.webp): the owner's sentence, then *"A message is still being held, so a different message cannot be sent yet. Whether it reached the agent is not knowable - its copy is in the transcript above - so restore it and send again only if no reply arrives."* over a message the owner had just said it did not take, with `Restore message` / `Discard message` and an EMPTY composer. The wire log stops at attempt 4: the operator's second press produces no request at all. | [after/busy-exhausted-after-first-send/localOperatorDark.webp](after/busy-exhausted-after-first-send/localOperatorDark.webp): no held claim and no controls — the owner's sentence plus the composer's hint, *"Your message is still in the composer. Send it again."*, and **the text is back in the composer**. [after/busy-exhausted-after-second-send/localOperatorDark.webp](after/busy-exhausted-after-second-send/localOperatorDark.webp) is the operator's own remedy: the same request identity goes out and is admitted (attempt 5). This is the arm the incident is about, and it is the arm the change moves. |
| `busy-internal` — the same `busy` 503, but answered by the app's OWN repeats | not captured: this arm's behaviour is the same in both halves, and the after frame is the record | [after/busy-internal-after-first-send/localOperatorDark.webp](after/busy-internal-after-first-send/localOperatorDark.webp): no refusal reaches the composer at all. The message is sent; nothing is held and nothing is restored. |
| `retiring` — `409` with a STRING `detail` (no `code`) on the first send | [before/retiring-after-first-send/localOperatorDark.webp](before/retiring-after-first-send/localOperatorDark.webp): held. The alert carries the owner's *"The message was not admitted"* and, immediately under it, the app's *"Whether it reached the agent is not knowable"* — the contradiction the report is about. | [after/retiring-after-first-send/localOperatorDark.webp](after/retiring-after-first-send/localOperatorDark.webp): **unchanged, still held**, for the reason stated above: with no `code` in the body there is nothing for this branch to key on. The frame is the record of the inert arm, not a claim that the 409 half is fixed. Its `-after-second-send` partner is byte-identical to the first: the composer is disabled in the held state, so the second press sends nothing (the wire log has one line for the whole run). When the backend half lands, the answer this arm will give is the one `scripts/canonical-chat.test.mjs` already pins for the coded body. |
| `unreachable` — `503 runtime_unreachable` on every send | [before/unreachable-after-first-send/localOperatorDark.webp](before/unreachable-after-first-send/localOperatorDark.webp): held. | [after/unreachable-after-first-send/localOperatorDark.webp](after/unreachable-after-first-send/localOperatorDark.webp): **still held, unchanged** — the control. The hop failure may have arrived and settled with only its ack lost, so the app must not claim the message never landed; the held claim and its controls stay. |

`*/readings.json` is the same measurement in numbers — the composer's `boxValue`,
the alert's prose, its controls, its visible text and the transcript's row count
per arm — and `*/wire.log` is the owner's own request log, which is where the
identity claim is checkable: every repeat carries the `request_id` of the first
attempt, and in `before/` the operator's second press produces no line at all.
Both `wire.log` files are tracked with `git add -f`, because `.gitignore` excludes
`*.log`; a change to them is a change to the evidence, exactly like a frame.

**Reading the transcript rows.** `transcriptRows` counts the painted rows inside
the transcript scroller (`[data-lo-canonical-transcript] [data-record-id]`) and is
the field the two halves can be compared on: `1` in every state that keeps the
echo (all of `before/`, and the `after/` `retiring` and `unreachable` arms) and
`0` on `after/busy-exhausted`, which is the echo retraction in numbers.
`transcriptUserRows` is the speaker-scoped count, and it is
`null` on any page that paints rows without a `data-record-kind` marker — which is
every `before/` frame, because that marker is added by this branch — rather than a
false `0`. The field's predecessor matched two attributes that exist nowhere in
`src/`, so it read `0` over frames that plainly painted the echo; that is what
this pair replaces (agent review R-5, QA Q1, design D1).

## Which surface produced these frames, and what they do not prove

**Surface:** the app's own chat components served by a Vite browser dev server
(`harness/app.vite.mjs`), which mounts `src/renderer/index.html` and `main.tsx`
with the app's real CSP. Its `/__desktop` route is the committed
`desktopProxyPlugin`, which calls the SAME `requestDesktop` in
`src/main/desktop-transport.ts` that Electron's IPC handler calls — so the
refusal decoding, the classification, the store's record of it and the composer
are the shipping ones.

**Owner:** `harness/stub-owner.mjs`, a disposable stand-in answering the desktop
control routes. Its verdicts are substituted at the HTTP boundary and its bodies
are the captured ones (see the table above): the retiring sentence carries the
backend's own em dash, the busy and unreachable sentences are the shared
`RUNTIME_UNREACHABLE_MESSAGE`, and the busy pace is the backend's real 2000 ms.

**Copy, and which ink it lands in (design D2).** The two dispositions put the
app's own clause in two different places, and that is deliberate rather than
drift: on the handed-back `busy-exhausted` arm the clause (*"Your message is
still in the composer. Send it again."*) is appended INSIDE the failure paragraph
and paints `danger`, because it is the remedy for the failure on screen; in the
held state the clause (*"A message is still being held…"*) is its own paragraph in
`inkMuted`, because it is a statement of state rather than a remedy. One
consequence of the captured bodies is worth naming: the backend reuses the
unreachable sentence for `runtime_busy` on purpose (its own comment says the text
does not move for renderers that have not updated), so the handed-back busy alert
reads a `reconnect` sentence above a `send it again` hint. The app's half is the
accurate instruction for that refusal — the backend's half is what will let the
sentence move, and it is the same backend change that carries the retiring code.

**Motion (design D3).** Retracting the echo is the only motion this change adds.
In the stub the echo's visible life on `busy-exhausted` is ~6 s, because the arm
now runs at the backend's own 2000 ms pace across the app's three repeats — at a
shortened stand-in pace it measured 346 ms. On `retiring` the echo never leaves,
because the arm is held. Production latency is the request's own, so the number
to read here is the busy one: seconds, not hundreds of milliseconds.

**These frames therefore do NOT prove:** the packaged Electron IPC hop, a native
window, any theme other than `localOperatorDark`, or the real backend's ladder and
timings. The transcript PANE on the `after/` handed-back frames is the stub's
empty-history placeholder — `Loading conversation…` over a shimmer, visible in
`after/busy-exhausted-after-first-send/localOperatorDark.webp` — and not a product re-fetch: the
stub answers `/history` with nothing and holds an empty event stream, so with the
only row retracted the pane falls back to its initial state. Whether a conversation
with real history does the same on a refusal is NOT settled here and needs a
packaged run over a real conversation. The alert region and the composer, which is
where this change lives, are painted from real state either way. A packaged-app
run and a real-owner run remain ungathered and are named here rather than implied.

## Reproducing

```sh
# after: this branch.  before: the same four harness files copied into a worktree
# detached at origin/main, run with --tree=before.
node docs/evidence/owner-refusal-send/harness/capture.mjs /tmp/owner-refusal-out --tree=after

# the captured bodies, from a backend checkout:
PYTHONPATH=<backend checkout> <backend checkout>/.venv/bin/python \
  docs/evidence/owner-refusal-send/harness/capture-bodies.py
```

One command per half; it prints each arm's reading and writes the frames,
`readings.json` and `wire.log` into the directory given. `--only=<arm>` narrows
it to one arm while a rig is being changed.

## State at this revision

These frames were taken at `ca752b26e` and the branch was then folded onto
`origin/main` = `1020b48a9` (a 0.30.20 release merge). They are RE-STAMPED, NOT
RE-TAKEN: the only chat-area change main brought across is the `/usage` picker
(`usage-view.tsx`), which is not a surface any frame here photographs — nothing
in the alert, the composer or the transcript moved. The stamps live in
`docs/evidence/manifest.json` and are re-derived at the folded tip; the frames,
their readings and the wire logs carry the pre-fold bytes deliberately, and this
paragraph is what says so.
