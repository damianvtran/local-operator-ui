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

Thirteen states: the seven this surface had, plus the six states INSIDE this
change that no frame had rendered — the search miss, the scope switched, a
non-default sort, the focused control, the refused viewer read and the grid at
its narrowest supported column (design round 1, D8).

| story | what it is |
| --- | --- |
| `grid` | twelve records, signed out |
| `signed-in` | the same grid with the viewer's own likes and favourites filled from one batched read |
| `viewer-state-unknown` | the same grid with the batched viewer read REFUSED (500): the line that says so above the count, and cards whose heart and star are unavailable rather than unfilled |
| `loading` | the first paint, before the list answers |
| `empty` | a hub with nothing published |
| `load-failed` | the list read failed — the backend did not answer, so the read is not retried and the state is on screen from the first paint |
| `empty-category` | a category that holds nothing, reached by clicking the rail |
| `search-miss` | a search that matches nothing, typed into the box |
| `scope-switched` | the search scope switched to description |
| `sorted-by-name` | a non-default sort |
| `focused-search` | the search box focused, so the group's ring and the boundary that binds the scope to the box are both visible |
| `page-change-keeps-the-grid` | page 2 in flight over page 1's records |
| `narrow-columns` | the same grid at `920x900` — the width where the page's own `minmax(17.5rem,1fr)` lands on two columns beside the rail — with counts in the six- and seven-character range (`1,204,583`), which is the width the card's footer has to survive |

The six added here, and `installing-mid-run` on the sidebar beside them, are the
frames design round 1 asked for by name; the four control states are driven by
their stories' own `play` functions, so they are pictures of the controls
reacting rather than of a prop that fakes a state.

All but the last were captured at `1280x900`; `narrow-columns` declares `920x900`
in `STORIES`, and that is the only place a story's viewport is stated.

**Every frame in this directory is from the ROUND-2 remediation pass on head
`40db9e792`** — all thirteen stories, twelve themes each, taken in one narrowed
run (`--only=agent-hub-page --allow-backend`) at that head, the commit the
round's code changes ship in. The directory was re-taken WHOLE rather than in the
few frames the round's findings move, because the branch was folded onto
`origin/main` = `2f85777b0` in between and that fold moved the surfaces this set
photographs: `main` changed the hub components, `chat-sidebar.tsx`, six shared
primitives and both stylesheets between this set's previous head (`83d25dd39`,
its frames committed in `4c24e4190`) and this one, so the frames it carried were
pictures of a tree the app no longer renders that way. The pass before that one
had itself re-shot all thirteen against D6's capped panel, U5's alert copy and
U1's retry, U12's panel width and D1's skeleton and pager height; those frames
are history now.

**The loading placeholder holds the settled card's box, and that is measured
rather than eyeballed.** Design round 2's D1 was the second round it was raised
in. Read at column x=295 on `loading/<theme>.webp` against `grid/<theme>.webp`,
the placeholder's box and row pitch are the settled card's own in every theme the
read can separate them in: 259px and 283px in ten of the twelve, 260px and 284px
in `dune` and `synth` where the lossy frame rounds the hairline the other way,
and identical between the pair in each case. The same read before the fix gave
225-228px and 249-250px against 259-263px and 282-285px. `monokai` is the one
theme the pixel read cannot separate — its surface and its canvas are within the
6/255 a lossy frame carries, so the card has no edge to find — and there the
rendered page measured 259.0px and 283.0px against the settled 259.3px and
283.3px, which is the number these frames are the picture of. The composition,
read off the same column: the tag group is TWO rows in both frames — two 22px
pill rows and the group's own 6px gap inside `mt-auto`'s group — which is what a
settled card does on every record this hub serves at both widths the grid gives
it, and is the 30px of the 34 the placeholder was not paying.

**The whole directory was re-taken rather than those four because
`search-miss` was WRONG before this pass.** Three of its twelve committed frames
— the first three themes in `THEMES` order (`localOperatorDark`,
`localOperatorLight`, `dracula`) — were 1280x1404 and photographed the grid
BEFORE the search applied: "30 agents" and twelve cards, which is the `grid`
story's own content height, against 1280x900 for the other nine. The story's
`play` function types into the box, and those three shutters caught a pre-filter
render. All twelve now show the search miss ("0 agents" and its own panel) and
the set's height is uniform. Recorded because anything read off those three
frames before this pass — the D8 sentence they were added for included — was read
off a picture of the unfiltered grid.

`agent-hub-page-baseline/grid/` is the same story captured from
**unmodified `origin/main`** — see that directory's own README for what was
patched to make it photograph the hub rather than its load error.

## The reading, and why it is the point

`scripts/hub-round-trips.mjs` reads a ledger the story's own bridge fills with
every request the page issues. Twelve cards, same fixtures, before and after —
measured on `origin/main` at `da9e75a61` (a second worktree) and on this branch
rebased onto it, and re-measured after each rebase rather than carried forward:

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
  additive, and the status an older backend answers is **422, not 404**: an op
  the server does not know fails `RadientRequest`'s `Literal` at validation, and
  `local_operator/server/app.py:337-347` flattens every `/v1/desktop/*`
  validation failure to `422 {"detail": "The request has invalid fields."}`. 404
  is this app's `outdated` signal (`backend-error.ts:49-60` classifies 404 alone
  as outdated), and the earlier text here claimed it for a response that never
  arrives — which a future maintainer would have built the degradation on. The
  hub reads ANY failure of this read as "no viewer state", renders that as
  unknown rather than as unliked (`viewer-state-unknown` is that frame), and
  says so once above the count with a retry. The op's own end-to-end proof is the
  local-operator PR's `tests/e2e/test_desktop_radient_statuses.py`.
- **Not the request counts.** They are the ledger reading above, not a picture of
  it; a frame of a grid looks the same at 3 requests and at 63.
- **Not the app's own chrome.** These are story frames: the hub page in the
  preview's window, not the desktop shell's sidebar, title bar or routing.
- **Nothing about a real signed-in account's likes.** The batched read is
  exercised against a fixture, so the filled hearts are the rendering of
  `liked: true`, not of a like that exists.
- **Not that the grid is still while the placeholder is up at the narrowest
  column.** The placeholder matches the settled card's box at the widths this set
  photographs. At `narrow-columns`' 292px cards the settled card's FOOTER wraps
  to a second line — the card goes from 259.3px to 291.3px, the degradation the
  comment in `agent-hub-page.tsx` names as intended — while the placeholder's
  footer is fixed-size chips that never wrap, so at that one width a first paint
  would still move every row below it. Nothing here photographs it: `loading` is
  captured at 1280 only, and a placeholder whose wrap depended on the real
  counts' text width could only imitate the card by guessing the column.
