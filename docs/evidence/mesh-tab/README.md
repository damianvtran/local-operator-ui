# Mesh tab (interactive canvas, `features.peers` + `features.session_transfer`)

The Mesh tab's states, in both brand palettes, at the app's own window size and at the
narrow one. The tab still ships **dark** - mounted only when the backend advertises
`features.peers`, with no call at all on a machine in no mesh - and this set is slice 2's:
the canvas became interactive (pan, zoom, hover, the device panel, the drag and its
transient states, the two dialogs, the busy refusal, and the **receipt** the remedy
produces), so the set grew from slice 1's nine states to the **nineteen** - and the
redesign's round-1 remediation added the six that bring it to the **twenty-five** below:
the two states the redesign's own model needed on the CANVAS (`reach-states`, `scopes`),
their list and narrow counterparts (`reach-states-list`, `scopes-narrow`), and the two
shipped renderings no earlier frame carried (`single-device-panel`'s `never`,
`scopes-declared`'s declared tier). **The round-2 remediation adds the four the stack
needed** - `scopes-shared-top` and `scopes-nested` with their narrow passes, two and
three enclosures hanging off one opener - which brings the set to the **twenty-nine**
below. **The operator report's pass (2026-10-04) adds the four its crowding report's
states needed** - `many-conversations`, `many-conversations-menu` and
`many-conversations-peer`, the device panel open at the scale of the operator's own
catalogue with one row's `⋯` menu open over the list, plus `many-conversations-bottom`,
the same panel parked at its maximum scroll (design round 1, D3: where the device-level
sections actually live) - which brings the set to the **thirty-three** below; their
before halves are the declared pair `../mesh-tab-before/`.

**The remedy's own row proves the move, because round 4 fixed the reason it could not**
(design review rounds 3 D13 and 4 D18). `move-busy-waited` photographs the receipt *and* the world
it claims: the play presses the remedy, asserts the re-issue carried the route's wait ceiling,
waits for the re-read, and asserts the canvas agrees with the notice - the panel reads
`Conversations (1)`, this device draws one conversation, and the peer draws the moved `Sweep 001`.
Round 3's explanation for the pre-move frame was wrong (it blamed the capture's mount; the capture
is on the same mount as the play), and the real cause was one line: the fixture hook that answers
the post-move world had been wired into `MoveCopyWithUndo` instead of into this story. Both the
code and this page now say that.

**The operator report's pair is `../mesh-tab-before/` (operator report, 2026-10-04).** The
three top-of-list `many-conversations*` states are the AFTER half of a declared pair: the set beside
this one holds the same three states rendered by `origin/main`'s two component files
(`mesh-card.tsx`, `mesh-node.tsx`) from the harness committed there - the same Storybook,
the same story ids, the same fixtures, the same viewport and encoding - so the fix is
judged on a frame against its twin. (`many-conversations-bottom` has no before twin on
purpose: at `origin/main`'s bytes the sections painted THROUGH the list rather than
sitting below it, and the pair's three states already photograph that defect from the
top; a bottom run would photograph the same overlap lower down.) That set's README carries the rendered-DOM audit's
numbers for both halves (`readings.json` beside it); the short version: the conversations
section measured 6,755 px of content in a 166 px box before and 6,755 px in 6,755 px
after, in-flow text overlaps 24 / 24 / 18 -> 0, container-region overlaps 3 -> 0 per
state, in both palettes, and the overlap is the SAME with the `⋯` menu closed as open -
which is what rules the menu out as the layer at fault.

**Re-captured, not carried forward (design review round 2, D9).** Slice 2's frames were
re-shot at this branch's own head through the command below: the previous set still
rendered `4 chats` - a string the renamed code can no longer produce - and contained no
frame of any interactive state, while this README documented the command that writes
them. A frame that contradicts the code reads as verified, which is worse than a missing
one.

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

66 frames, 33 states x 2 palettes, written through the repo's own sweep (a private
headless Chrome, `Page.captureScreenshot` as webp at `deviceScaleFactor: 1` and
quality 88 - the rig's own settings - with `assertFramePaints` on every frame) - the
round-2 pass re-shot the set whole, then narrowed once
(`--dirs=scopes-nested,scopes-nested-narrow`) to re-take the four frames whose fixture
changed; the operator-report pass narrowed again (`--only=mesh-tab--many-conversations
--themes=localOperatorLight,localOperatorDark`) to write its six; and the
design-round-1 remediation re-took the eleven states whose TRUNCATING chips the fix
moved - every state in the set carrying a truncated chip (their frames were stale
against their own captions, design round 1, D1) plus `many-conversations-bottom` -
in one narrowed pass (`--dirs=cap-at-four,device-panel,device-panel-narrow,
drag-refused-over-network,drag-to-device,invite-receipt,move-busy-waited,move-confirm,
move-copy-with-undo,move-refused-busy,many-conversations-bottom`). `manifest.json` records
this as a **partial** capture
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
and it throws on an op it does not answer. The design-round-1 re-shoot (2026-10-04
17:03) ran under the same flag for the same reason - the operator's app was up again
(pid 21804, `Local Operator [serve] port=1111`, up 7m at capture time) - and its
readings reproduce the offline-captured frames' totals exactly (24 / 24 / 18 in-flow,
3 / 3 / 3 container), which is the empirical half of the no-dependency claim rather
than the structural half alone.

**These frames therefore do NOT prove:** that a live relay answers these payloads,
that a real mesh looks like this (the shapes are the wire's, read from
`local_operator/server/models/desktop_mesh.py`; the values are invented), that the
tab behaves this way against a slow or half-up backend, or anything about
performance. They also cannot show the two claims the tab's own design rests on and
a still cannot carry - that a poll that changed nothing moves no node, and that a
wheel-zoom keeps the world point under the pointer invariant. Both are asserted
numerically in `scripts/mesh-tab.test.mjs`, which is the cheap half of this evidence
rather than a substitute for it.

Two smaller gaps, named rather than implied. **The node's on-screen type size is the app's
own, not a scaled one** (design round 1, D2; N2): `MAX_FIT_SCALE = 1` means the world is
never enlarged by the fit, so the node's label renders at `text-body-sm` (13px) and its
stat line at `text-meta` (12px) beside the page's own 13px subtitle and 12px summary line.
A reader coming to these frames from the pre-D2 set, where the same node measured 1.79x
(≈23px and ≈21px), is looking at a different type size. **The rail row is not in any frame**:
the set is page-level `MeshPage` captures, and the one piece of chrome this slice adds
- the Mesh destination in the sidebar and in the command palette - is pinned at the
source instead (`scripts/mesh-tab.test.mjs`), because mounting the rail inside these
stories would be a second harness for one row. And **the self row's `Chats` cell can
never carry a count in production** (design round 1, D5): `deviceStatLine` prints a
count when `sessionCount !== null`, and `sessionCount` comes from the PEER row, which
by construction does not describe this device - so the frame's `this device` is the
honest production reading, not a fixture gap. The middle column therefore holds a
count, an identity and a state sentence, and the `Chats` sort compares them as it
finds them; sourcing self's own count is slice 2's question (it has to come from the
sessions the app already holds, not from the peer catalogue).

## The gate, precisely (review round 1, R1-1)

Two facts, two jobs, and they are not the same fact:

- **`features.peers` is a CAPABILITY.** lop advertises it on every install, on purpose -
  "the KEYS answer 'what can this backend do' rather than 'is this machine in a mesh'"
  (`local_operator/server/routes/capabilities.py`) - so a device in NO network carries it
  too. It gates the `/mesh` ROUTE, and it is why the route stays mounted when membership
  goes empty: a reader who leaves their last network while on this page must not be
  ejected out from under their pointer by a poll, and the empty state is the honest
  answer to that moment.
- **Membership is the catalogue's own emptiness**, which is where the backend says the
  fact lives ("a device in no network answers an empty catalogue, and an empty catalogue
  mounts nothing"). It gates the RAIL ROW and the command palette's destination, so a
  device that is in no mesh keeps today's chrome.

The cost, stated as it actually behaves (review round 2, R2-1, measured it - the first
version of this paragraph said "one read" without a cadence, and the code was polling
every 30 seconds because the always-mounted rail had inherited the tab's interval):

- **one read-only catalogue read per window**, issued when the window starts: a
  `networks.list`, which creates nothing - the backend short-circuits it on
  `has_any_network()`, an `is_dir` test whose `_networks()` returns `[]` "so nothing else
  mkdirs";
- **no interval, no window-focus refetch and an infinite `staleTime`** on the rail's
  observer (`useMeshMembership` asks for `poll: false`), because a mesh listing DIALS
  every peer - so nothing about this row may poll on a screen that is not the tab;
- the catalogue's **30 s cadence belongs to the TAB**, and the rail rides that observer's
  cache entry while the tab is open;
- and a daemon that does not advertise `peers` issues nothing at all.

**The residual cost, stated rather than implied**, because this is the number round 2 asked
for: that one read FANS OUT. The rail is mounted before anything else, so its read is the
first thing a mesh-capable window does, and a `networks.list` dials every peer. It is one
fan-out per window instead of one every 30 s, and it is not removable from this side:
membership cannot be known without asking, `peers` is advertised by every install, and
keying the row on the capability instead is the R1-1 defect. The read that would make even
the window-start fan-out free is a membership summary that does not dial peers - a
`has_network` field on the capabilities payload, or a summary route - a backend ask,
deferred, and not faked here by having the renderer read the config directory.

The row stays absent until the device is KNOWN to be in a mesh. What the brief's "no call
is issued" line was protecting is the byte-for-byte chrome, and this protects it better
than the capability alone did.

**And what a genuinely fresh install meets today is not the empty state.** QA round 1
(Q-1) traced it: `GET /v1/desktop/commands`, which the app fetches on every boot for the
palette, CREATES `<config>/network/networks`. Round 2 challenged the attribution, because an
import scan of that route finds nothing from the network package - the import is
**function-local**, which is exactly why. The chain at `damianvtran/local-operator`
`origin/main` (`801c8731b`):

```
GET /v1/desktop/commands
  routes/desktop_catalogues.py:128  command_catalogue()      -> reply({"commands": ...})
  utils/desktop_commands.py:46      command_catalogue()      -> argument_words(spec), per row
  utils/desktop_commands.py:43      argument_words()         -> command_argument_words(spec)
  slash_commands.py:1726            ArgumentShape.REMOTE_PEER -> local import of known_peer_names
  network/peers.py:101              known_peer_names()       -> known_peers(root)
  network/peers.py:84               known_peers()            -> store.list_networks(root)
  network/store.py:650              list_networks()          -> networks_dir(root).glob("*.json")
  network/store.py:117              networks_dir()           -> path.mkdir(parents=True, exist_ok=True)
```

`list_networks` is a READ that creates, reached through the vocabulary the catalogue
publishes for every row. `has_any_network()` is then an `is_dir` test on exactly that path,
so the mesh reads proceed to a relay that has no record and answer `503
relay_unavailable` on a machine that has never joined anything - which is why `reads-failed`
is in this set. The root cause is outside this diff, and its fix is in flight as its own
backend PR: **#1666, "fix(network): a read must not create the network plane"**, which
re-derives this trace, records the two `mkdir` events an audit hook saw, and shows **0 of
53** GET routes create the plane after it. So `virgin-device` is the page's own first-run
state - what a
reader sees wherever the catalogue answers `[]`, including after leaving a network with
the tab open - and not a claim about what a machine with no mesh shows on first launch.

The **gated-out** case (no `features.peers`) has no frame on purpose: a daemon that
cannot serve these routes gets no Mesh row and no `/mesh` route, so the evidence for
it is absence, pinned at the source in `scripts/mesh-tab.test.mjs` - a screenshot of a
missing row proves nothing a reader could check.

## The states

| Frame | State | The one fact it carries |
| --- | --- | --- |
| `single-device/localOperator*.webp` | a device alone in one network | today's real S=1 shape: one lane, one device, one membership edge, and the summary line naming which device this is |
| `two-devices/…` | a healthy two-device mesh | the design target: two nodes, one edge, the peer's chat count |
| `two-devices-narrow/…` | the same screen at 1024x768 | a narrow case: the canvas fits the world into a smaller box rather than scrolling it. The app's own floor is **800x600** (`WINDOW_MIN_WIDTH`/`WINDOW_MIN_HEIGHT` in `src/main/window-mode.ts`), and the design round captured four states there without committing them - all hold, and the node's ellipsis is a world-space cut rather than a responsive one |
| `overlapping-networks/…` | five devices across two networks, one device in both | THE claim of the model: a device in two networks is ONE node with TWO edges |
| `reach-states/…` | the five reach states on one canvas, plus the working device | `not asked` no longer wears a failure's hue: each stripe and word is keyed on `deviceReach`, `unknown` says so with no hue, and a suspect device carries the shield as the non-colour channel |
| `reach-states-list/…` | the same fixture in the list presentation | THE two faces of the round-1 list-ink finding: `not asked` with no hue, and `no answer` + the shield + an `identity suspect` badge on the suspect row - neither was visible on the list in any committed frame before |
| `scopes/…` | the drawn boundary tiers at 1380x900 | two peers agreeing on WireGuard's default subnet draw dashed; `backup-nas` sharing this device's prefix draws solid; a duplicated address draws nothing |
| `scopes-narrow/…` | the same tiers at 1024x768 | the label band's second cause, and round 2's second fix: the topmost label was STILL sliced flat by the canvas's own top edge at the fit's floor (k = 0.8 put a 563 px world in a 559 px well), so the floor-bound fit now TOP-ALIGNS rather than centres and the top clearance scales with the stack - this frame is where the corrected behaviour is checkable, and the label sits ~10 px inside at this width |
| `scopes-declared/…` | the `declared` tier, from a fixture | the third drawn tier's shipped styling (solid frame, the operator's word, `· declared`) - **buildable client-side, not reachable from any backend yet**: `scope` is `""` in every install, so this frame is a styling proof rather than a live state, and `mesh-scope.ts`'s backend ask is where it lands |
| `scopes-shared-top/…` | two enclosures sharing their topmost device | THE M4 collision, photographed: `build-box` publishes a LAN and a tunnel address, is topmost in both groups, and before the nesting rule both labels anchored at one point - now one nested pair of rings, labels 26 px apart, the shared frame (reaching further down) the outer one |
| `scopes-shared-top-narrow/…` | the same pair at 1024x768 | the collision at the width where the fit's floor binds, so the staircase and the top-aligned fit can be read together |
| `scopes-nested/…` | three levels on one opener | the staircase at its full pitch: `build-box` is topmost in three INFERRED groups, so three labels stand 26 px apart and each frame is 4 px wider than the one inside it. A declared tier cannot appear in a stack - an authored scope excludes the device from the prefix arithmetic - which is why this fixture uses a third inferred prefix |
| `scopes-nested-narrow/…` | the same three levels at 1024x768 | the depth case at the narrow width, where the 84 px row reservation and the top-aligned fit are both visible |
| `misconfigured/…` | a suspect device, an unreachable device, a revoked membership | each misconfiguration is a named state with its own reason, and the revoked edge draws dashed |
| `virgin-device/…` | no network at all | the page's own first-run state: the sentence and the command that changes it |
| `reads-failed/…` | both reads refused | the relay's own sentence, verbatim, and the control that asks again |
| `loading/…` | the first paint | a skeleton, not a spinner over a blank world |
| `list-view/…` | the same mesh in the list presentation | the sortable list, which is the other way in and the reason a graph is not the only presentation |
| `single-device-panel/…` | the panel's `never` | a null `Last status frame` reads `never` rather than a date computed from zero - the D4 fix's own null case, which no earlier frame carried |
| `device-panel/…` | a device's panel, open | the node's detail and its actions: memberships, the session list, and the two affordances the canvas cannot offer |
| `device-panel-narrow/…` | the same panel at 1024x768 | the clicked node stays whole while the panel takes a third of the width - the clamp that keeps it visible solves against the canvas's *clip* box, so nothing sits under the border (round 3, Q-1) |
| `cap-at-four/…` | four conversations on one peer | the cap's own case: two chips and the `+N` control. Since the operator report the chip keeps the HEAD (`mesh-node.tsx` carries the trade) - and this frame now SHOWS the trade rather than asserting it: the two peer chips both read `Sweep …` here, the shared-prefix collision itself (design round 1, D1; re-shot at the fix head), with the full names one hover away on the chip and on the panel's row |
| `move-confirm/…` | the confirm a destructive move raises | the dialog names what is lost, because the source copy is deleted once the peer has it |
| `move-refused-busy/…` | a turn in flight refuses the move | the code, the route's own sentence, and the one remedy that changes anything: wait for the turn to finish |
| `move-busy-waited/…` | the remedy executed | the receipt the re-issued move produces (`cloud-node-1 holds it now; the copy here is gone.`) **and the world it claims**: this device holds one conversation, and the peer draws the moved `Sweep 001` beside its own - see the note above |
| `move-copy-with-undo/…` | a `--keep` copy, and its undo | the peer gains a copy under a new id, the original stays, and the undo is a recall that names its own loss |
| `invite-receipt/…` | an invite, minted | admission is two-sided, so the affordance is a dialog rather than a drag: the token's path, and why this app never reads it |
| `drag-to-device/…` | a session lifted over a valid target | the transient: the ghost under the pointer, the target's own edge, and the indicator naming the operation the drop would perform |
| `drag-refused-over-network/…` | the same drag over a network lane | the one gesture the protocol refuses, refused prospectively - a conversation lives on a device, and the indicator says so before the drop |
| `many-conversations/…` | the panel open on this device, a catalogue page of conversations behind it | the operator report's containment state: **201 rows** that used to paint through the Network addresses/Status/Show-in-list sections below them (24 overlapping text pairs, 3 container regions, measured - see `../mesh-tab-before/`) now scroll as one column; this frame's `+199` and the peer's `+9` are the caps the report saw, and the chips read `Onbo…`/`Relea…` where they read `…chine`/`3 line` before |
| `many-conversations-menu/…` | one row's `⋯` menu open over the same list | the report's own composition, and its discriminator: the overlap is IDENTICAL with the menu closed, so the menu was never the layer at fault - and the menu's own surface (opaque `elevated` in both palettes) was never missing |
| `many-conversations-peer/…` | the same panel on the peer, eleven conversations | the report's first screenshot: rows, addresses and Status interleaved at ELEVEN rows too (18 overlapping pairs), and the chips reading tail fragments (`…obe OK`/`…2E pull`) where the report's own read `…BE-OK`/`…2E pull` - the fixtures invent the names, not the shapes |
| `many-conversations-bottom/…` | the same panel parked at its maximum scroll | the state the stacking claim lives in (design round 1, D3): below the whole catalogue come Network addresses, Status, Reach, Last status frame and Show in list as one clean column - every frame before it showed the list's top only, so "the sections stack below the list" had no frame of its own |

## The numbers behind the frames

Three claims in the frames are quantitative, so they were measured rather than
looked at; each is quoted in the source beside the decision it decides.

- **The node's edge is a control's edge (corrected in review round 1, D1).** The edge
  measures **3.92:1** against the node's own `elevated` fill on `localOperatorLight`
  and **3.30:1** on `localOperatorDark` - above the CONTROLS floor a control whose
  boundary is its border owes - beside the fill's own step off the canvas well, ΔE00
  6.85 / 7.71. This bullet used to claim `hairline` on that fill measured ΔE00 1.44 /
  1.23, "a border nobody can see"; re-measured with the repo's own `deltaE` it is
  **9.19 / 4.80**, so the hairline is visible and the edge was chosen for the ratio
  above. `scripts/contrast-contract.mjs` carries a `mesh device node` row asserting
  that triple, and the gate reports **29,476 assertions across 59 themes** with 0
  consulted exceptions — re-derived at this head (agent review round 1, m1/D5: this
  sentence has moved with the contract before - round 3's D17 recorded 28,524, and the
  round-1 remediation measured 29,417 on its own tree - and the number is a reading,
  not a constant: it last moved when the fold onto `ee5611a2e4` brought main's
  `CONTROLS` rows in).
- **Selection needs more than a fill.** `rowSelected` against this node's own
  `elevated` fill measures ΔE00 7.00 on the light brand palette but only 2.19 on the
  dark one - at the field floor, not above it - so a selected node takes the ink edge
  as well (11.8:1 against that fill).
- **The containment pair, measured (operator report, 2026-10-04).** The rendered-DOM audit
  over the three new states counted **24 / 24 / 18** in-flow text overlaps and **3 / 3 / 3**
  container-region overlaps on `origin/main`'s two component files, and **0** of both after -
  in both palettes, with the `⋯` menu closed and again with it open. The figure behind the
  overlaps: the conversations section measured **6,755 px of content in a 166 px box** before
  (the panel's flex column held it shrank; its `<ul>` kept its natural height and painted)
  and **6,755 px in 6,755 px** after, which is what makes the aside's `overflow-y-auto` the
  scroll owner. `../mesh-tab-before/readings.json` is the runs' own output.
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

The frames are `.webp` at 1380x900 (and 1024x768 for the narrow rows -
`two-devices-narrow`, `device-panel-narrow`, `scopes-narrow`, `scopes-shared-top-narrow`,
`scopes-nested-narrow`), written by the sweep's
own Chrome profile, which it removes on exit.
