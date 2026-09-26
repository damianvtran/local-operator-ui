# Mesh tab (read-only slice, `features.peers`)

The Mesh tab's states, in both brand palettes, at the app's own window size and at
the narrow one. This is slice 1 of the Mesh build: the read surface, the tab that
ships **dark** - mounted only when the backend advertises `features.peers` - with no
mutation, no drag and no sidebar change.

## Which surface produced these frames, and what they do not prove

**Surface:** the real `MeshPage` (`src/renderer/src/features/mesh/mesh-page.tsx`),
mounted by Storybook in the app's own preview - the real fonts, the real theme
plumbing, the real React Query client built from `defaultQueryOptions`, the real
capability gate, the real `peers.list`/`networks.list` queries and their
normalisers, the real canvas with its pan/zoom and pinned slots, and the real four
states.

**One thing is replaced:** `window.api.desktop.request`, the preload seam
`desktop-api.desktopRequest` prefers. The stories install their own bridge on it
(`src/renderer/src/features/mesh/mesh-page.stories.tsx`), which answers
`capabilities`, `peers.list` and `networks.list` from fixtures and **throws** on any
other op - so a story that reached a live backend could not do so quietly, and
`scripts/mesh-tab.test.mjs` pins that those three are the only ops this page can
issue.

**Capture:**

```sh
node scripts/capture-evidence.mjs --only=mesh-tab \
  --themes=localOperatorLight,localOperatorDark --allow-backend
```

18 frames, 9 states x 2 palettes, written through the repo's own sweep (a private
headless Chrome, `Page.captureScreenshot` at deviceScaleFactor 2, `assertFramePaints`
on every frame). `manifest.json` records this as a **partial** capture
(`partialCapture`), which is what it is: the set is the tab's own states, not a
sweep of the tree.

**`--allow-backend` is disclosed here because it is the one flag that relaxes a
guard.** The operator's live backend (pid 14691, `Local Operator [serve] port=1111`,
up 9h47m at capture time) is running, and the sweep refuses by default - correctly,
since most surfaces would photograph its replies. The flag exists for exactly this
case, and its own docstring states the condition: a PARTIAL run whose stories
render from fixtures and never call out. That condition holds here for a reason
that is structural rather than asserted: the page's only network path is the
desktop bridge, the bridge is replaced in-page before the app can issue anything,
and it throws on an op it does not answer.

**These frames therefore do NOT prove:** that a live relay answers these payloads,
that a real mesh looks like this (the shapes are the wire's, read from
`local_operator/server/models/desktop_mesh.py`; the values are invented), that the
tab behaves this way against a slow or half-up backend, or anything about
performance. They also cannot show the two claims the tab's own design rests on and
a still cannot carry - that a poll that changed nothing moves no node, and that a
wheel-zoom keeps the world point under the pointer invariant. Both are asserted
numerically in `scripts/mesh-tab.test.mjs`, which is the cheap half of this evidence
rather than a substitute for it.

The **gated-out** case (no `features.peers`) has no frame on purpose: a user
without a mesh sees no Mesh row and no `/mesh` route, so the evidence for it is
absence, pinned at the source in `scripts/mesh-tab.test.mjs` - a screenshot of a
missing row proves nothing a reader could check.

## The states

| Frame | State | The one fact it carries |
| --- | --- | --- |
| `single-device/localOperator*.webp` | a device alone in one network | today's real S=1 shape: one lane, one device, one membership edge, and the summary line naming which device this is |
| `two-devices/…` | a healthy two-device mesh | the design target: two nodes, one edge, the peer's chat count |
| `two-devices-narrow/…` | the same screen at 1024x768 | the narrow case the app's own sidebar clamps for: the canvas fits the world into a smaller box rather than scrolling it |
| `overlapping-networks/…` | five devices across two networks, one device in both | THE claim of the model: a device in two networks is ONE node with TWO edges |
| `misconfigured/…` | a suspect device, an unreachable device, a revoked membership | each misconfiguration is a named state with its own reason, and the revoked edge draws dashed |
| `virgin-device/…` | no network at all | the state a fresh install meets: the sentence and the command that changes it, with no call issued |
| `reads-failed/…` | both reads refused | the relay's own sentence, verbatim, and the control that asks again |
| `loading/…` | the first paint | a skeleton, not a spinner over a blank world |
| `list-view/…` | the same mesh in the list presentation | the sortable list, which is the other way in and the reason a graph is not the only presentation |

## The numbers behind the frames

Three claims in the frames are quantitative, so they were measured rather than
looked at; each is quoted in the source beside the decision it decides.

- **The node's boundary is an edge, not a hairline.** `hairline` against the node's
  own `elevated` fill measures ΔE00 1.44 (`localOperatorLight`) and 1.23
  (`localOperatorDark`) - below the brand contract's own ΔE00 2.0 field floor, i.e. a
  border nobody can see - while the fill's own step off the canvas well measures
  ΔE00 6.85 / 7.71. The node is a control and its edge is its only boundary, so it
  takes `border-control` (3:1 floor). `scripts/contrast-contract.mjs` now carries a
  `mesh device node` row asserting that triple, and the gate reports 28,524
  assertions across 59 themes with 0 consulted exceptions.
- **Selection needs more than a fill.** `rowSelected` against this node's own
  `elevated` fill measures ΔE00 7.00 on the light brand palette but only 2.19 on the
  dark one - at the field floor, not above it - so a selected node takes the ink edge
  as well (11.8:1 against that fill).
- **One quantity, one number.** The first capture of this set showed a network node
  reading "3 devices" beside a summary line reading "4 devices": the node counted
  active memberships and the summary counts device nodes. Both now count members,
  and the revoked ones are named (`4 devices · 1 revoked`), pinned by a test rather
  than by a second look.

## Reproducing

```sh
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet &
node scripts/capture-evidence.mjs --only=mesh-tab \
  --themes=localOperatorLight,localOperatorDark --allow-backend
```

The frames are `.webp` at 1380x900 (and 1024x768 for the narrow row), written by
the sweep's own Chrome profile, which it removes on exit.
