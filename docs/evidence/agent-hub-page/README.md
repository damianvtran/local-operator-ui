# Agent hub — one round trip per page, and a rail built from what is there

The hub's grid was slow for a reason the frames cannot show, so this surface
carries two kinds of evidence: the pictures below, and a request ledger read off
the same rendered page. Both come from `scripts/capture-evidence.mjs` and
`scripts/hub-round-trips.mjs` against the stories in
`src/renderer/src/features/agent-hub/agent-hub.stories.tsx`.

## What produced these frames

Storybook, from this branch, driven by the repo's own evidence rig:
`node scripts/capture-evidence.mjs http://localhost:<port> --only=agent-hub-page
--allow-backend`, twelve themes per story, viewports as declared in
`STORIES` (`1280x900` for each, except that the capture expands a frame to the
content height the story declares).

Seven states, because the surface has six and the grid alone was the only one
with a frame:

| story | what it is |
| --- | --- |
| `grid` | twelve records, signed out |
| `signed-in` | the same grid with the viewer's own likes and favourites filled from one batched read |
| `loading` | the first paint, before the list answers |
| `empty` | a hub with nothing published |
| `load-failed` | the list read failed — the backend did not answer, so the read is not retried and the state is on screen from the first paint |
| `empty-category` | a category that holds nothing, reached by clicking the rail |
| `page-change-keeps-the-grid` | page 2 in flight over page 1's records |

`agent-hub-page-baseline/grid/` is the same story captured from
**unmodified `origin/main`** — see that directory's own README for what was
patched to make it photograph the hub rather than its load error.

## The reading, and why it is the point

`scripts/hub-round-trips.mjs` reads a ledger the story's own bridge fills with
every request the page issues. Twelve cards, same fixtures, before and after:

| | `origin/main` | this branch |
| --- | --- | --- |
| signed out, to first paint | 39 requests = 1 list + **36** per-card counts | 3 = 1 list |
| signed in, to first paint | 63 = 1 list + **36** counts + **24** per-card status reads | 4 = 1 list + **1** batched status read |
| a focus five minutes later | **+26** (24 per-card status reads, which opt into focus refetching while the list opts out) | **+0** |

The three numbers on each row that are not the hub's own — `capabilities`,
`account` and one `capabilities`/`account` re-read on focus — are the app's
own reads and are identical on both sides; they are included in the totals so
the table is the ledger rather than a selection from it.

The "five minutes later" arm advances the page's clock rather than waiting,
because React Query refetches a focused query only once its data is stale and
these reads carry a five-minute `staleTime`. It is the one fake in the rig and it
is named in the rig's own comment: no query option changes, only whether the
moment has arrived.

## What these frames do NOT prove

- **Not that Radient answers any of it.** The transport below the hooks is
  stubbed at `window.api.desktop.request` — the preload bridge every Radient
  call goes through — and the payloads are fixtures shaped like
  `GET /v1/agents` and `agents.statuses`. Their FIELD NAMES are the wire's,
  checked against the live public endpoint; their values are invented.
- **Not that the real backend serves the batched op.** `agents.statuses` is
  additive, and a backend older than it answers 404 — which the hub reads as
  "no viewer state", the degradation the `grid` frame shows (it is the same
  rendering as a signed-out view). The op's own end-to-end proof is the
  local-operator PR's `tests/e2e/test_desktop_radient_statuses.py`.
- **Not the request counts.** They are the ledger reading above, not a picture of
  it; a frame of a grid looks the same at 3 requests and at 63.
- **Not the app's own chrome.** These are story frames: the hub page in the
  preview's window, not the desktop shell's sidebar, title bar or routing.
- **Nothing about a real signed-in account's likes.** The batched read is
  exercised against a fixture, so the filled hearts are the rendering of
  `liked: true`, not of a like that exists.
