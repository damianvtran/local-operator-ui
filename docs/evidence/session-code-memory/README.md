# Session code memory: what the panel was, and what it is

The canvas "Code memory" panel could never load. It called
`GET /v1/agents/{id}/execution-variables` with a **canonical session id**
(12 hex, e.g. `8fd6c6a40934`), and that route resolves through `AgentRegistry`,
whose keys are agent-directory UUIDs (`~/.local-operator/agents/<uuid>/`).
Verified live against the running app's backend:

```
GET /v1/agents/8fd6c6a40934/execution-variables
404 {"detail":"Agent with ID 8fd6c6a40934 not found"}
```

The tour teaches the panel, so it stayed in the UI and never once rendered a
namespace. The fix gives the backend four session-addressed ops backed by the
session's live eval kernel and rewires the panel to them (see `#164`); these
two frames are the before/after pair for the read path.

## The pair

| frame | tree | what it shows |
| --- | --- | --- |
| `before-variables-404/` | unmodified `origin/main` at `7f0511dd4` | the panel's failure state - the state a user saw live, in the app's own words: "Could not load variables / The agent's code memory could not be read." |
| `../canvas-workspace/variables/` | this branch | the populated namespace, read from the session that owns it, all twelve themes (the swept set) |

The before frames are the ones the committed evidence could not show: the
`canvas-workspace/variables/` frames in the tree until this branch were **stale
against `main`'s story**. They last changed in `#77` (the Tailwind migration)
while `#83` moved this reader onto the desktop transport, so on `main` the story
rendered the panel's FAILURE state, not the populated list those frames show -
the story's fetch stub answered a URL (`/execution-variables`) the transport had
stopped calling. Nothing detected it: `check-evidence` asks whether a frame is a
picture of the app, not whether it is a picture of the current code.

This branch DOES change those twelve files, and an earlier version of this
paragraph said the opposite - that they were byte-identical to the base, "so the
refresh is a no-op in the diff". It was written to answer review round 1's C-04
and was wrong when written: the vocabulary pass (design round 1, D4) renamed the
header control `New` -> `New variable`, which is inside those frames, and the
commit that re-shot them is the same commit this paragraph rode in. Review round
2 (C-05) found it, which is the lesson worth keeping: a claim about a diff is
checkable by reading the diff, and prose written to close a finding is exactly
where the next false claim hides.

What IS true is narrower and still the point: those frames were not
MIS-rendered, they were mis-STAMPED. With the story's stub re-pointed at the ops
the panel really calls, the story renders the same populated list it always meant
to show - same rows, same order, same values - and the pixel difference the
re-capture produced is the label alone. The frames were never wrong about the
panel; the stamp they carried named a tree whose story drew a different state.

## Reproducing them

The before pair comes from `main`'s reader, captured with the branch's tooling:

```sh
git worktree add /tmp/ui-scm-before origin/main
cd /tmp/ui-scm-before && pnpm install --prefer-offline
# THE CONFIG FIX, not the feature: Storybook cannot build on TypeScript 7
# without it (#140 left `reactDocgen: "react-docgen-typescript"` behind), so
# apply only this one line from the branch under review.
sed -i '' 's/react-docgen-typescript/react-docgen/' .storybook/main.ts
pnpm storybook &
node scripts/capture-evidence.mjs --only=canvas-workspace--variables \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`--allow-backend` is required whenever the operator's own Local Operator app is
listening on `127.0.0.1:1111`: this story renders from fixtures and never calls
it, but the guard cannot know that. The frames were then moved into this set and
the swept directory was restored, which is why they are declared here as their
own `supplementary` set rather than sitting inside `canvas-workspace/`.

**Warm the server before capturing.** The capturer gives the theme decorator 10
seconds (40 x 250 ms after a 900 ms settle) and a cold Vite dev server serves
the first story's module graph more slowly than that - the first run here died
on `document carries theme "" after 10s`. Loading the story once in a browser
first makes the same capture pass. A papercut, not a defect in the frames.

## What these frames do not prove

- **Not a live session.** Both sets here are Storybook: the transport is real,
  the query cache is real, the component is real, and the answers are fixtures.
  The live path is a THIRD set, `../session-code-memory-live/`, taken from the
  real app by the independent QA round of this PR against a real backend with a
  resident kernel (`live/populated/` - a real turn's eight names, read by the
  panel; `live/busy/` - ten rows retained beside `Reading…` while a cell runs,
  which is the one row of the frozen state table no fixture can render, because
  retention is a property of a query that already held a reading).
- **Two themes in the before pair, twelve in the swept set, one in the live
  pair.** The before pair exists to state the failure, so it is captured in the
  two brand palettes; the swept set carries all twelve; the live pair is the
  app's default palette only, because it is the app rather than a themed
  renderer, and it is a state no other palette would change.
- **The live pair predates the design round's D3 repaint.** It was taken at head
  `2df13979d`, so the field-level refusal sentence in `live/busy/` carries that
  head's `text-danger`; the repaint to `ink` landed after it and is evidenced by
  the re-captured Storybook refusal frames on the current head.
