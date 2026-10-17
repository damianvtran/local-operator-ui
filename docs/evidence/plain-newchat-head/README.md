# Plain new chat — the head-page membership, before and after

The evidence for the fix to the operator's report: *conversations started with a
plain New chat do not appear in the sidebar and cannot be found by search.* The
second symptom is refuted as stated (search finds the conversation by its title
words, its first message and later prose — the checks below); the first is real
and this set is its reproduction and its cure, with a **scrolled before/after
pair** that shows the delta where the reader actually looks.

## What the defect was, in one paragraph

The catalogue's rank order leads with its status bands — unseen, busy, and a
wake band of scheduled rows — so on a store with enough of those (the
operator's carries ~44 wake-bearing rows), a plain conversation the reader just
used, once its completion is read and its runtime drains, lands *below the
sidebar's fetched page*: the panel reads one 50-row page in the rank order and
the row sits at rank 61+. It looks intermittent because the row is near the top
while its turn runs (busy/unseen bands), then leaves the visible page. The fix
reads that head page in the **activity order** (`sort=activity`) — recency —
which is the order the sidebar's own sectioning presents (Today/Yesterday/…).

## Which frame is which claim

The claim split the design round asked for (D1): each caption says what the
**pixels** show, and what the **log beside it** proves. Both halves are one
scene (`plain-newchat-lifecycle`) on one loaded store model — 60 fabricated
wake-bearing rows, 62 rows total — run twice: `before/` against the branch
base, `after/` against the fix head.

| Frame | What the pixels show | What the log proves |
| --- | --- | --- |
| `before/drained` | The sidebar at rest: the pinned `Aida` row at the foot of the list region. The list continues below the fold; **no conversation from this run is anywhere in the column.** | `rowRendered:false`; the catalogue ranks the row **61 of 62** in the rank order; the checks name the two failures (membership, order). |
| `after/drained` | The same state on the fixed build: `Aida` pinned, and the list below. The conversation **is in the list now**, as the first `TODAY` row, but at `scrollTop 0` it sits *just past the scroller's edge* — this frame alone proves membership in the DOM, **not** visibility. | `rowRendered:true`; `catalogueActivityHead:true`, `cataloguePageable:true`, `sessionCount:50`, `cataloguePinnedCount:1`. |
| `before/scrolled` | The chats list scrolled to the reader's own neighbourhood (`TODAY`, the first row ~30% down the window): `Aida`, the `TODAY` header, and the **scheduled band only** — the conversation the reader used a minute ago is *absent*. | `scrolledRead.isSubject:false` (the row is not in the DOM at all, so the step falls back to the first `TODAY` row); `scrollTop 340 / maxScroll 386`, window `clientHeight 460`. |
| `after/scrolled` | The same window position: `Aida`, `TODAY`, and **`Hello from the mock pr…` as the first `TODAY` row, highlighted** as the open conversation. | `scrolledRead.isSubject:true`; the row's own DOM text: `Complete` · `Hello from the mock provider` · `1m, last active 1 minute ago`; row box `521.8–553.8` inside window `384–844`; `scrollTop 340` of `386` max. |

Both scrolled frames are the **same scroll geometry** (`scrollTop 340`,
`clientHeight 460`, `scrollHeight 846`) because the scene scrolls by a measured
step — subject row to ~30% of the window — and the before half lands on the
first `TODAY` row by the same step. The pair therefore shows one window, with
and without the conversation in it.

**One honest caveat, the design round's own:** where the fold falls is
store-shaped — this rig's region layout puts the list's head just under the
fold at `scrollTop 0`, and a different store or window size moves it. The
scrolled pair is robust to that: it names its scroll geometry, and the claim it
carries (the row is the first `TODAY` member, directly under the pinned row in
list order) is read from the log beside it.

## What each run's log carries (the numbers, exactly)

- **Before**: `[FAIL] the conversation is rendered in the sidebar at the drained
  steady state` · `[FAIL] the catalogue is read in the sidebar's own order` ·
  `[FAIL] the store holds the head page` · `[FAIL] …(invariant 1)` — 4 of 20
  checks fail; `rowRendered:false`; steady `sessionCount:51` (50 page rows + 1
  pinned extra appended off-page — the base build has no capability, so the
  guard also fails there for the pinned-extra reason **this round's Q1 finding
  fixed**: the fixed guard subtracts pinned extras and stays exact).
- **After**: `ALL CHECKS PASSED` (20/20) — including `the scrolled frame is
  taken with the list's subject (or first TODAY) row inside the window` and the
  two failures that are the defect, now passing.
- **Search (both halves pass)**: `tessellate` and `pomegranate` each return the
  conversation (`apiFound && renderedFound`; the words live in the first message
  and in later prose respectively).

## The wire (`after/wire.log`)

Every desktop request the run made, from the rig's own body-logging tap (the
tap is the only door: the serve record points at it). The two requests that
start a plain chat, verbatim:

- `POST /v1/desktop/sessions/draft` — `{"request_id": "a1663c79-…", "cwd": "~"}`
  → `{"result": {"draft_id": "69a1cf602544", …}}`
- `POST /v1/desktop/sessions` — `{"request_id": "23fbcbca-…", "cwd": "~",
  "draft_id": "69a1cf602544"}` → `{"result": {"session_id": "69a1cf602544",
  "binding": {"agent": null, "team": null}, "admitted": true, …}}`

**Three fields, no `purpose`** — the origin-hiding hypothesis is refuted on the
wire for the current UI (the server stamps `agent-config` only for
configuration runs, which send one).

Of the 65 catalogue reads in the run, **31 carry `sort=activity`** — all of the
sidebar pane's head-page reads, verbatim
`GET /v1/desktop/sessions?limit=50&include_archived=true&with_counts=true&sort=activity`.
The reads *without* `sort` are the two surfaces this change deliberately does
not touch: the main process's `limit=1` adoption probe (fires before the
capability answer) and the strip keeper's periodic `limit=500` catalogue poll
(both byte-identical to the base build's).

## Reproduce it

The scene is this repository's own dev-driver at the plain-newchat-lifecycle
scene; the rig (isolated HOME, isolated daemon, tap) and its loaded-store
fabricator live in the round's session scratchpad, and the commands are the
scene's own:

```bash
# after: the fix head + a fresh loaded rig
rig-up.sh --loaded && run-scene.sh          # ALL CHECKS PASSED, frames land in $FRAMES
# before: the branch base, same scene, same store model
LO_RIG_UI_WT=<base worktree> LO_RIG_FRAMES=<out> run-scene.sh   # 4 CHECK(S) FAILED (the repro)
```

Both runs drive the built app in `headless` window mode; no window is shown,
focused or photographed from the OS — every frame is the app's own
`capturePage()`, and each run reaps its processes (the scene asserts it).
