# sidebar-remote — remote sessions as first-class sidebar rows

The operator's report (2026-10-05), verbatim: *"make sure remote sessions on the
connected network(s) show up under Running, Today, Pinned, This Week, etc — it
should be listed seamlessly together with local sessions but just have an
icon/indicator to indicate that it's running on a remote device, and on hover it
will read out which remote device and network that session is on."* — with the
repro context that his open conversation's header read `On cloud-node-1` while
the sidebar listed only local rows.

This set photographs both halves. `before` is the base tree: the remote
sessions exist only in the federated answer (`sessions.list?include_peers=true`)
and the sidebar draws its local rows alone. `after` is the fixed tree: the same
fixture rows render in the sidebar's own bins — Running / Today / This week —
beside the local ones, each with the locality mark (`↗`, the elsewhere/external
arrow), and the hover reads `on cloud-node-1 · damian-mesh` — the cross-surface
` · ` separator (design review round 1, D1). One fixture row's owner did NOT
answer, and it draws the same arrow with ONE quiet stroke across it (`↛`) — the
design round's at-rest cue, same ink, same **reserved cell** (every row carries
it, so every title starts on the same x — D5), with the reason on the flyout's
own line, `unreachable · link down 4m ago` (D2). Every frame is the app
photographing itself (`Page.captureScreenshot`).

## The instrument

`harness/drive.mjs` boots the BUILT app (`out/main`, `--window-mode=headless`,
never shown or focused) with scratch HOME, config, log and profile roots, the
`CMUX_*`/`LOP_*` families stripped and the mock-keychain switch taken from its
one home. `harness/server.mjs` is the endpoint it talks to: the catalogue BOTH
ways — plain (local rows only) and with `include_peers=true` (the local rows
plus four fixture rows on `cloud-node-1`: one `approval` for RUNNING, one an
hour old, one five days old, and one two hours old whose owner did NOT answer,
`reachable: false` with the wire's own reason) — plus the two cheap mesh reads
and a minimal session stream, fixtures in the wire's own shape. The app's transport, store,
merge, mark, hover and bins are the shipped ones.

Each arm asserts its own readings, so the pair cannot pass by both being loose:
`before` checks the four remote titles are ABSENT, zero `[data-remote-mark]`
elements are drawn, and the wire shows NO federated read; `after` checks all
six titles are present, four marks are drawn with exactly ONE stroke and it on
the unreachable row, each remote row's own `[data-chat-section]` bin is
`running`/`today`/`week` as its clock says, the sections list contains no
remote-specific section, the flyout sentences match (`on cloud-node-1 ·
damian-mesh`, and the split `unreachable · link down 4m ago` on the stroked
row, re-verified up for its frame), a remote and a local title's own box start
at the SAME x (the reserved cell, measured 54 vs 54), the divider's keyboard
register takes the sidebar to its 220 px floor and back (the narrow frame), the
opened conversation's chip reads `On cloud-node-1`, and the wire shows the
federated read only at `limit=200` while every plain poll stays peer-free.

The `after` arm also holds for one full ambient cycle: it waits for the SECOND
federated read (measuring the interval), checks that plain catalogue polls ran
in between, and re-reads the list — which is the mechanism the store's suite
pins in isolation (`scripts/peers-catalogue.test.mjs`: a remote row survives
plain pages only because the federated answer wrote its placement fact), here
observed in the assembled app.

**Build mode, disclosed:** both arms were built with
`LOCAL_OPERATOR_UI_NO_BYTECODE=true` — the config's own npm-publish mode —
because the local V8-bytecode step cannot resolve its Babel plugin out of this
pnpm layout (`@babel/plugin-transform-arrow-functions` resolves from
`electron-vite`'s directory, and Babel resolves inline plugins from the cwd's
`node_modules`, where no pnpm tree links it). The renderer bundle is the code
under review either way, and both arms share the mode, so the pair is
like-for-like.

**What was and was not driven live.** The committed arms run against the set's
own fixture endpoint — no second real device exists in those runs (the same
disclosure the sibling sets carry). `harness/proxy.mjs` adds a pass-through in
front of a REAL daemon so a live arm can run read-only with the wire still
readable (`--arm live --expect-remote present|missing`, `--daemon`, and the
daemon's token file, passed only through the app's documented
`LOCAL_OPERATOR_DESKTOP_TOKEN` environment). That arm was run against the
operator's own pairing on 2026-10-05 (both builds; frames kept in the
scratchpad, not the repository, because they carry his real conversation
titles):

- `missing` (base `cb8bebd48b1`), 15 rows drawn, `[data-remote-mark]` 0; the
  wire carried ZERO `include_peers` reads before the Mesh tab was opened (the
  tab's own read is the first one, `limit=200`); a frame of the tab beside that
  sidebar shows `cloud-node-1` reachable with **14 conversations** the sidebar
  does not list;
- `present` (this branch), 15 rows drawn, `[data-remote-mark]` 4 — his most
  recent `cloud-node-1` sessions, both `Answer needed`, merged into RUNNING
  beside his local ones; the hover reads `on cloud-node-1 · damian-mesh`;
  opening one leaves the header chip reading `On cloud-node-1`; the wire: 1
  federated read (`limit=200`) and a dozen plain polls, none of them carrying
  `include_peers`.

## How to run

```sh
# THE BASE TREE — the operator's defect (remote rows exist, the sidebar cannot
# list them; the wire never asks for peers). Both arms need a build FIRST, from
# the tree under test:
LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build
node docs/evidence/sidebar-remote/harness/drive.mjs --arm before

# THE FIXED TREE — merged bins, the mark, the hover, the chip, and the hold
node docs/evidence/sidebar-remote/harness/drive.mjs --arm after

# THE LIVE ARM (read-only; frames land in the scratchpad)
node docs/evidence/sidebar-remote/harness/drive.mjs --arm live \
  --expect-remote present --daemon http://127.0.0.1:1111
```

```
sidebar-remote/before/sidebar/localOperatorDark.webp         the sidebar, local rows only
sidebar-remote/before/sidebar-detail/localOperatorDark.webp  the same, clipped to the panel
sidebar-remote/after/sidebar/localOperatorDark.webp          remote rows merged into the bins
sidebar-remote/after/sidebar-detail/localOperatorDark.webp   the same, clipped to the panel
sidebar-remote/after/hover/localOperatorDark.webp            the flyout: on cloud-node-1 · damian-mesh
sidebar-remote/after/hover-unreachable/…webp                 the stroked row's flyout: unreachable · link down 4m ago
sidebar-remote/after/sidebar-narrow/localOperatorDark.webp   the 220 px floor: marks survive the clip
sidebar-remote/after/open/localOperatorDark.webp             opened: header chip + the row in its bin
```

## Readings (this pass, `localOperatorDark`)

| reading | before (base) | after (this branch) |
| --- | --- | --- |
| sections drawn | today: 1 local; week: 1 local | running: 1 remote; today: 2 remote + 1 local; week: 1 local + 1 remote |
| `[data-remote-mark]` | 0 | 4 (`↗`), 4 at the 220 px floor too |
| stroke (`[data-remote-mark-stroke]`) | 0 | 1, on `Remote: incident log` only |
| title leading edge, remote vs local | — | 54 vs 54 — one column (D5) |
| separate remote section | none (nothing) | none — the sections are the one list's own |
| flyout sentence | — | `on cloud-node-1 · damian-mesh` |
| flyout on the stroked row | — | its own line: `unreachable · link down 4m ago` (D2) |
| sidebar at its 220 px floor | — | marks survive, titles clip clean (N2) |
| opened conversation's chip | — | `On cloud-node-1`, row still in its bin |
| federated reads | 0 | 2 (`limit=200`, 30008 ms apart) |
| plain catalogue polls | 2, none carrying `include_peers` | 10, none carrying `include_peers` |
| remote rows after plain polls | — | all six titles still listed |

## Not addressed here

- **The TUI's reason token-gloss table is not ported** (`peer_reason_words`):
  a wire reason that is a machine token (`connect_failed:<class>`) prints as
  written; the vocabulary is the runtime's to keep (recorded in
  `chat-remote.ts` for the sibling's vocabulary work).
- **The stroke's colour is the mark's own role** (`text-ink-dim`): the design
  round asked for "same ink, same cell" - a new colour role would have been a
  contract change, so none was added.
- **Pinned draws no remote row yet**, and that is the wire's honest state rather
  than a rendering choice: the pin index is device-local and prunes ids with no
  local session directory, so a remote row reads `pinned: false` until an
  owner's pins are forwarded (deferred; `settlePeerCatalogue`'s note records
  it). The live pass confirms it — four pinned rows, all local.
- **Pin/delete/archive pressed on a remote row** address the local daemon and
  are refused with its own sentence; the sidebar's merge does not change which
  daemon those routes reach. Out of this slice's scope.
- The fixture arms' `Account unavailable / Reconnect Radient` notice is the
  fixture endpoint not modelling the credits service; it is identical in both
  arms and outside the surfaces under test.
