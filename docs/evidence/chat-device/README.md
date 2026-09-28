# The chat header's device control (`features.peers`, `features.session_transfer`)

Where a conversation runs, as **one chip** in the chat header's title block: `New on this
device` on a new chat, `On this device` on a live one, `On build-box` when another device
holds it, `Moving to build-box` while a move is in flight. Pressing it opens the picker -
this device first, then one section per network by name - and picking a row is the whole
decision: a **setting** on a draft (exercised on the first send) or a **move** on a live
conversation.

**Eighteen states, two brand themes, 36 frames.** Four of them are picker states, and they
are not stills of a drawn panel: each presses `[data-device-chip]` with a real pointer event
and claims `[data-device-picker]` is on screen before the shutter, so a frame named
`picker-*` is a picture of the **open menu** rather than of a candidate for one.

## Which surface produced these frames, and what they do not prove

**Surface:** the real `ChatHeader` (`src/renderer/src/features/chat/components/chat-header.tsx`),
mounted by Storybook in the app's own preview - the real stylesheet and theme plumbing, the
real React Query client, and the control's own components
(`src/renderer/src/features/chat/device/`) unmodified. The device control is composed into
the header through the `deviceSlot` prop the header gained; **`withoutDevice` in the story is
the same tree with that prop omitted**, which is what the two `before-*` frames are.

**One thing is replaced:** `window.api.desktop.request`, the preload seam the app's desktop
client prefers. The story installs its own bridge
(`src/renderer/src/features/chat/device/chat-device.stories.tsx`), which answers
`capabilities`, `peers.list`, `networks.list` and the header's own `teams.list`,
`commands.entities`, `sessions.list`/`sessions.command` from fixtures and **throws** on any
other op - so a story that reached a live backend could not do so quietly. The
**device data is invented** (the field names are the wire's, `mesh-types.ts`'); the
**component, the gate and the sentences are not**.

**Not photographed here, and why:**

- **light/dark are both captured** (every state, `localOperatorDark` + `localOperatorLight`);
  the other ten palettes are the theme contract's business, not this set's;
- **the composer's held strip during a move** - the design specifies it, and this slice does
  not implement it: holding the composer is a change to `MessageInput`'s own admission path
  (a new seam through `chat-content.tsx`), not to this control, and it is left for its own
  change rather than half-wired here;
- **a docked pane's header** narrower than the app's 800px minimum;
- **the real backend's sentences**: the busy refusal here is the route's own sentence
  (`mobility.py`'s `_busy_sentence`), typed into the story's fixture, and the receipt is a
  fixture in `TransferReceipt`'s shape. What the control does with either is real - see
  `chat-device-model.ts`, which is where the two arrival sentences are decided.

## Numbers behind the frames

**Geometry**, read from the rendered page (viewport 1000x168 / 1000x520 at
`deviceScaleFactor: 1`, so CSS px = frame px):

| Quantity | Value |
|---|---|
| Header band row | 1000 x 40 (`h-10`) |
| Identity chips | agent x=165.9 (69.2 x 20), team x=239.1 (76.4 x 20) |
| Device chip, draft (`New on this device`) | x=323.5, **154.6 x 20** |
| Device chip, live (`On this device`) | x=397.1, **126.5 x 20** |
| Action cluster container | x=792, 192 x 32, 5 buttons - **identical with and without the chip** |
| **Cluster ink, before vs after** | rightmost ink column **x=973 in both**, in both themes |
| Picker panel, live | **320 x 414.3** at (397, 36); list 310 x 348.5, `scrollHeight == clientHeight` |
| Picker panel, new chat | **320 x 319.7** at (323, 36); list 310 x 309.7 |
| Panel alignment | the panel's left edge is flush with **the chip's own left** (397 = the trigger's box) |
| Footer | box y=404.5 h=34.8, **outside the scrolling list** (`footerPinned: true`); absent in a new chat |
| Row heights | current/candidate 50.9; ineligible 70.3 (the reason line) |

**Contrast**, sampled from the frames against the generated theme CSS, with the role pair the
palette asserts:

| Cell | localOperatorDark | localOperatorLight |
|---|---|---|
| Ineligible row NAME, sampled ink on the row's ground | `#aaa599` on `#322d21` = **5.58:1** | `#605f58` on `#fefcfb` = **6.27:1** |
| Ineligible row NAME, the role pair (`ink-muted` on `elevated`) | **7.24:1** | **8.78:1** |
| Ineligible reason line (`warning`), sampled | **7.39:1** | **8.70:1** |
| Chip label (`ink-muted` on `canvas`) | 8.6:1 | 7.66:1 |

The sampled figures are a **floor rather than the ink**: the most-distant pixel in a text box
is a partially covered edge pixel, so it reads lower than the role's own pair, which is why
both rows are here. **The design round's own defect is the cell this checks**: ineligible rows
first shipped `ink-disabled` on `elevated`, which measured **1.99:1 / 2.96:1** - below AA on
the one row whose whole job is to be read - and the correction to `ink-muted` is what these
frames render.

**The DOM-level checks the design round could not run** (`dom_audit.mjs` needs Playwright,
which is not in this repository's dependency tree) are covered here by what this machine does
have: the geometry above is `getBoundingClientRect` read from the live page over CDP
(`node --test`-free scratch rig), the interaction claims are the rig's own
`press`/`expectPresent` (which fail the run rather than the frame), and the accessible names
are asserted in `scripts/chat-device-model.test.mjs`. What is still **not** covered: target-size
checks across the theme matrix and clipping heuristics - those remain for the review and QA
rounds.

## Reproducing this set

```sh
# A private Storybook on a free port, then the sweep narrowed to this surface.
node_modules/.bin/storybook dev -p 6037 --no-open --quiet &
node scripts/capture-evidence.mjs http://localhost:6037 \
  --only=chat-device --themes=localOperatorDark,localOperatorLight
```

Two notes a re-run needs. The rig **refuses to capture while a Local Operator backend answers**
the origin the tree's `.env` names, and rightly: a live backend's replies would leak into the
frames. This worktree was pointed at a free port for the run (`VITE_LOCAL_OPERATOR_API_URL`,
untracked `.env`), so the guard's own question - "is the origin this tree would talk to
answering?" - was asked and answered honestly. And the two brand themes are named explicitly
rather than taking the twelve-theme sweep list, because they are the only two this change has
business pricing; a full sweep is unaffected.

**One local, uncommitted line was in the tree while these frames were taken**: a `viteFinal` in `.storybook/main.ts` honours `LO_EVIDENCE_VITE_CACHE` so a capture does not rewrite the shared `node_modules/.vite` this worktree borrows from a sibling lane's checkout. It moves Vite's cache directory and nothing else - no story renders differently - and it is not in the diff. The repository's own note for the `reactDocgen` workaround sets the precedent for reading a frame taken under a local config change.
