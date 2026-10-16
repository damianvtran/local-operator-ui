# Plain new chat — the head-page membership, before and after

The evidence for the fix to the operator's report: *conversations started with a
plain New chat do not appear in the sidebar and cannot be found by search.* The
second symptom is refuted as stated (search finds the conversation by its title
words, its first message and later prose — the checks below); the first is real
and this set is its reproduction and its cure.

## What the defect was, in one paragraph

The catalogue's default order fills the head page with its status bands, and on
a store whose cold population is a wake band — the operator's carries ~44
scheduled rows — those rows lead the page. The sidebar fetches **one page** (50
rows, `catalogue_page`/`session_catalogue_page`), so a plain conversation, once
its completion was read and its runtime drained, sat at **rank 61 of 62** and
was never fetched: not drawn, not scrolled to, while search (which reads the
whole store) still found it. The fix reads the head page in the sidebar's own
order (`sort=activity`, advertised as `session_catalogue_sort`): rows that need
the reader first, then everything else newest-activity-first — the same clock
the panel's sections and its own "show the latest 10" pagination already use.

## The rig (both halves, same harness)

An isolated daemon and store, the built app driven by the repo's own dev-driver
(`node scripts/renderer-driver.mjs --scene plain-newchat-lifecycle`, headless
window mode, scratch `HOME`, no window ever shown), against a **loaded store**:
60 fabricated wake-bearing conversations plus the rig's own rows (62 total), so
a rank-ordered page cannot carry a fresh non-wake conversation. A body-logging
tap in front of the daemon is the address the app dials (the daemon's serve
record is mirrored to name it), so the exact request bodies land in
`after/wire.log`.

Both halves ran the same scene on the same store model; the before half ran the
pre-change build (16:39 local), the after half the fixed build (17:30 local).

## The frames

Within each half the scene's two captures (`drained` at phase 6's steady state
and `open-by-route` at phase 6's invariant-1 step) are **byte-identical** — the
sidebar state they photograph is the same at both moments — so the set ships
one frame per half, and the claims both reads carry are in the logs beside it.

| Frame | What it shows | The claim it is evidence for |
| --- | --- | --- |
| `before/drained/localOperatorDark.webp` | The drained steady state on the pre-change build: the sidebar's rows are the pinned Aida row and the scheduled band — the conversation the run just used (open in the pane at the right) is absent (`rowRendered: false`). | The report, reproduced: `rank 61` of 62 with `limit 50`. |
| `after/drained/localOperatorDark.webp` | The same state on the fixed build: the sidebar lists `Complete Hello from the mock provider now` directly under the pinned row — the conversation that was in the reader's hands a moment ago. | The fix, in pixels; `catalogueActivityHead: true` and `sessionCount: 50` in the same note say the read was the head page in the activity order (a legacy whole-catalogue read would also carry the row — and would be no fix). |

The `##` readings those captions quote, verbatim:

- Before, phase 6 steady state (`before/run.log`): `[FAIL] the conversation is
  rendered in the sidebar at the drained steady state` / `[FAIL] the
  conversation being viewed is on screen even when the page no longer carries
  it (invariant 1)`, with the phase's own catalogue read: `{"total":62,"rank":61,
  "row":{"id":"5cf0b415bd88", ..., "status":"complete","unseen":false,"live":""}}`.
- After, phase 6 steady state (`after/run.log`): `rowRendered: true`,
  `catalogueActivityHead: true`, `cataloguePageable: true`, `sessionCount: 50`,
  and the same row at `"rank":61` in the rank order — the page that carries it
  is the activity page, not the rank page. `ALL CHECKS PASSED`.

## Search (the second symptom)

Both halves pass every search check: the title words (`provider`), the first
message's words (`tessellate`), the later prose (`pomegranate`) and a
run-unique token that lives in the second turn (`mv…`) all find the
conversation — API and rendered. The digest limits (first 4,000 chars of
prose, tool results excluded) are deliberate and unchanged; name or early
content matching MUST be findable, and it is.

## The wire (`after/wire.log`)

- The create, verbatim: `{"cwd":"~","draft_id":"517ac25d8c29","request_id":"74fdc874-cb00-46bd-9eb7-07bd3bb67e3c"}`
  — four fields, **no `purpose`**, so the origin-hiding hypothesis is refuted
  on the wire for the current UI (the server stamps the hidden origin only for
  configuration runs that send one).
- The sidebar's own refresh reads, verbatim:
  `GET /v1/desktop/sessions?limit=50&include_archived=true&with_counts=true&sort=activity`
  — 35 of the run's catalogue reads carry `sort=activity`; the page size is the
  50-row head.

## What this set does not prove

- It is the app's own frames and wire against an **isolated** daemon, not the
  operator's live store; the store model mirrors the operator's population
  shape (a 60-row wake band), not its contents.
- The before half's log predates the activity-head check names (it was captured
  against `catalog.py`'s rank order only); its two FAILs and its `rank 61`
  reading are the reproduction, and the after half carries the path checks.
- Search behaviour is asserted at the scene level here; the digest bounds'
  own suites are unchanged.
