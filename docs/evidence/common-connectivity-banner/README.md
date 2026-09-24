# The connectivity banner, in every state the daemon connection can leave it in

This is the app-wide surface that used to say **"The server is offline. The
interface will not function properly until the server is back online."** — the
sentence the operator's report is about — and until this round the tree held **no
frame of it anywhere**. The rigs next door (`new-chat-row`, the reconnect-gap
pair) assert the banner's *absence*; nothing photographed its presence, so the one
surface whose trigger condition this work rewrote could not be looked at.

## What produced these frames

**Storybook on the branch's own tree, driven by `scripts/capture-evidence.mjs`.**

```
node node_modules/storybook/bin/index.cjs dev -p <port> --ci --quiet
node scripts/capture-evidence.mjs http://localhost:<port> \
  --only=common-connectivity-banner \
  --themes=localOperatorDark,localOperatorLight --allow-backend
```

`common-connectivity-banner.stories.tsx` mounts the production
`ConnectivityBanner` over a realistic page ground with `window.api.backend` stubbed
to the snapshot MAIN publishes for each state. Nothing else is faked: the copy
comes from `serverBannerCopy` in `shared/backend-status.ts`, the variant from the
component, and the Retry button is the real control.

Each story carries a `play` that waits for its own sentence to be on the page
before the shutter, so a frame cannot be a race between the query resolving and
the screenshot; `attached` and `degraded` wait for the *absence* of every offline
sentence instead, because their claim is that no banner renders at all.

1024x300 asked for, and the capturer resizes the viewport to the content: the
bandless states return **1024x333**, a title-plus-one-detail band **1024x401**, the
refusal bands (a title and one wrapped two-line detail) **1024x421**, the two-holder
and fallback bands **1024x440**, and the internet band **1024x420**. Those are this
tree's capturer on this machine, re-measured in the round-2 remediation pass, which
re-shot every frame in this directory in one PASS - which is two capturer runs, the
second of them under the baseline swap the "Re-taking the set" recipe spells out;
the copy-driven heights are the
band rows, not the document.

## The readback

| story | what the banner says | variant |
| --- | --- | --- |
| `attached` | nothing — **no banner renders** | — |
| `degraded` | nothing — a missed probe is not an outage | — |
| `identity-failed` | "Not connected to a Local Operator server. If one is still running, the app reconnects to it on its own." + main's detail: "Another process is answering at http://127.0.0.1:1111 (…)" | warning |
| `no-spawn` | the same sentence + "A local daemon may still be running, but could not be attached. Waiting without starting a duplicate." | warning |
| `unclaimed` | the same sentence + "A daemon is running at http://127.0.0.1:1111, but it refused this app's credential for its desktop plane. The daemon is running." | warning |
| `stopped` | "The Local Operator server stopped. The app keeps looking for one and attaches to it when it appears." + "The daemon's process is gone." | danger |
| `wedged` | "A Local Operator server is running on this machine and this app is not attached to it." + main's own sentence about the path taken | warning |
| `unattachable` | the same sentence + main's spawn-gate detail: **the holder first** (address, pid, install, version, and that this app holds no key to it), then that nothing was started over it, then the act that ends it, **with the holder's real pid** (`lop services reclaim 42411`), then the promise | warning |
| `both-addresses-held` | the two-holder form of the same: the class stated **once** ("are running Local Operator daemons this app has no key for") with both addresses listed under it, the second of them named by its **prefix's last segment** rather than the whole path (`local-operator`) - and the act in its plural form (`Stop them from the installs that own them`), because two holders are not `it` - the state the app used to QUIT in, and the one that had no frame anywhere in the tree before round 1 (D2/D6) | warning |
| `serving-on-fallback` | "Serving on http://127.0.0.1:8080, not the address this app is configured for." + main's holder clause for the configured address, the act that frees it **carried from main's own composer with the real pid** (agent round 2, R2-4; design round 2, D9), and where the app ends up - the state that was **byte-identical to `attached`** before it had a presentation (D1) | warning |
| `attached-elsewhere` | the same state **one launch later**: the app adopted the daemon on 8080 through its persisted credential, so no gate ran, no address was refused, and the band carries the two facts that are true - the address it is on, the address it is configured for - with **no holder clause and no act invented** (agent round 2, R2-1a). Before this round that launch painted nothing at all | warning |
| `returned-to-configured` | "Back on http://127.0.0.1:1111, the address this app is configured for." + the address it served on until it moved back - the transition OUT of the state above, and the only dismissible band here (D1) | **success** |
| `no-bridge` | nothing — **no banner renders**: with no desktop bridge the hook probes `/health` itself, and this fixture **pins that probe to an answer** so the frame is the tree's rather than the host's (design round 2, D8b) | — |
| `internet-offline-confirmed` | "You are offline." plus the app's own tail (the configured hosting provider named when main knows one, otherwise "This app's updates require an internet connection.") — and it paints only after the negative reading has persisted across its grace, never on the first unconfirmed sample (`@shared/utils/offline-confirmation`) | warning |

Three things the table is measuring, each of which was a finding in round 1:

- **A live daemon is never called offline again.** The old copy asserted a
  transport fact ("offline") for a *connection* state, and three separate paths
  reach `detached` while a process is still listening: three identity-failing
  probes, an attach the credential made impossible, and the no-spawn path. All
  three now read "Not connected … if one is still running, the app reconnects to
  it on its own", with main's own observed sentence on the second line naming
  which of the three it was. The word "offline" appears in no server sentence this
  banner can render.
- **`wedged` is not `detached`.** A daemon whose process is alive and whose
  heartbeat stopped is a third fact — it exists, this app deliberately did not
  attach to it, and it is not starting a second one — and it has its own sentence
  and its own state.
- **`reconnecting` and `stopped` are two sentences, not one.** Main distinguishes
  a detach it is still working on from one it has given up on (90 s,
  `DETACHED_AFTER_MS`), and the snapshot now carries that as `reconnecting`
  because a still cannot show a timer: `identity-failed`/`no-spawn`/`unclaimed`
  are inside the window and read differently from `stopped`.

The variant is part of the claim rather than decoration: a state the app is
expected to recover from on its own (reconnecting, offline-internet) is `warning`,
and so is a daemon that is RUNNING while this app is not attached to it (`wedged`,
`unattachable`) - that copy asserts the opposite of a failure, and painting it in
the danger triple said the opposite of what it said (design round 1, D6). `danger`
is left to the paths that ARE failures: the server stopped, or a connection that
is not coming back. What this leaves is the pair that has to be visibly
different - `identity-failed` and `stopped` - rather than the same red box with
different words.

`wedged` and `unattachable` share a title and differ in their detail, which is the
readback the two producers need: the title states the connection fact, true of
both, and the detail says which path reached it. The `wedged` title quoted here
used to assert one path ("has stopped publishing its own heartbeat"), which is a
false sentence for a daemon that is running and healthy and that this app merely
holds no credential for - the same class of mistake as calling a serving daemon
offline, one state over.

## The identities, measured

Twenty-eight frames, two palettes, fourteen stories, re-shot in ONE pass in the round-2
remediation (six of them moved, two are new). The hashes below are hand-maintained, so
they were re-derived in that pass in the same run that wrote the files.

- `attached`, `degraded` and `no-bridge` are byte-identical to each other
  (`e784c20a…` dark, `5149fc6f…` light, all three at 1024x333). **That identity is the
  claim**: a missed probe must not produce a banner, and now that the no-bridge fixture
  PINS the probe it is a claim about the tree rather than about the host the frames were
  taken on (D8b; the round-1 pass captured this state twice with two different answers
  and shipped one of them, which is what made the pairing incomparable).
- The other stories have their own bytes in both palettes:
  `identity-failed` `ca1ede73…` / `015e45f4…`, `no-spawn` `29c8d2dc…` /
  `d151c933…`, `unclaimed` `ca84aa0d…` / `ffef8975…`, `stopped` `0bcb0c4a…` /
  `60add571…`, `wedged` `647010a3…` / `5b731db7…`, `unattachable` `a08616b1…` /
  `c437c566…`, `both-addresses-held` `e8d6cfe2…` / `1ac6cb27…`,
  `serving-on-fallback` `cb32792b…` / `bcadaf69…`, `attached-elsewhere`
  `9431d646…` / `9266449a…`, `returned-to-configured` `a6056e54…` /
  `c6c62c32…`, `internet-offline-confirmed` `4b95ec86…` / `a02d9437…`.
- `unattachable` was the story whose hashes this readback could not state while its
  copy was being corrected; it no longer is. The pair committed here carries the
  sentence this tree ships - produced by `describeSpawnRefusal` and compared
  against the story fixture by `scripts/connectivity-banner-copy.test.mjs`, so the
  two cannot drift again (that drift is design round 1's D2).
- **The command is printed as PLAIN TEXT, with no backticks** (design round 3, D18). The
  composer used to write markdown delimiters around it (`\`lop services reclaim 42411\``)
  for a code span that does not exist: `AlertDescription` renders these sentences as
  plain text, so the operator saw a live grave accent in the same face as the prose -
  around the one sentence this change exists to make legible. The delimiters are gone and
  the three act-bearing bands are re-shot; `scripts/connectivity-banner-copy.test.mjs`
  asserts no shipped sentence carries one.
- The banded states are visibly taller than the bandless ones, and the difference
  is the band's own rows (64 for a title plus one detail line, 104 for four), not a
  different sentence count: the wash rows are what the copy costs.
- Two consecutive runs of this surface produce all 28 frames byte for byte. The rig
  gained a pointer reset before every navigation while this set was being taken (a hover
  entry was leaving the pointer where it stopped, and a tooltip opened on a delay in a
  later frame); every hash above is from after it.
- **`no-bridge` shares that identity, and the round-2 pass made it a claim instead of
  a coincidence** (design round 2, D8b). The state renders NO BANNER - with no desktop
  bridge to ask, `useConnectivityStatus` probes `/health` itself and falls back to
  `serverHealth?.online ?? true`, so `hasConnectivityIssue` is false and `showBanner`
  never becomes true - but WHICH branch it takes is the host's business, and the round-1
  pass captured both: once as the no-banner ground that was byte-identical to `attached`,
  once as a band, shipping the first. Its frame is now shot with the probe **pinned to an
  answer** (`pinAnsweringProbe` in the story file, and the WHY there), so the identity
  above is a property of the tree.
  The other branch is real and is not photographed: with a probe that FAILS the band
  paints the contract's own sentence for this state
  (`shared/backend-status.ts`'s `serverBannerCopy(null)`: "Not connected to a Local
  Operator server."). Whether a browser-hosted app should announce the absent bridge at
  all is still design round 1's D12 product question, and the fixture no longer answers
  it by accident.
- The other stories have their own bytes in both palettes - the list is above, and it is
  the ONLY one: the round-1 list that used to sit here (in sha256, from the pass before
  this one) was deleted in round 3 rather than relabelled, because three of its entries
  named bytes that are on no file in this tree and it omitted the states this pass moved
  and added (design round 3, D14). One table, with every value verified against the
  committed frames, is the whole of what this section needs.

## The pair, and what it measures

`docs/evidence/common-connectivity-banner-baseline/` holds the before half: the same
viewport, the same page ground and the same FIXTURE as the `wedged` frame beside it,
with main's own `ConnectivityBanner` and main's own copy table in place and nothing else
changed. It was re-shot in the round-2 remediation pass, on this tree, in ONE PASS with the
set above - two runs under one swap, which is what puts both halves on one canvas
(design round 2, D8a).

**What the pair used to claim, and why it could not stand.** The committed before half
was photographed on a detached worktree of `origin/main` at `93f57894a`, which this
README called "main's head, the branch's merge target". It was neither: `93f57894a` is
2026-09-14, **2,827 commits behind THE BRANCH'S MERGE TARGET** `cb9d97b79` (`origin/main`
has moved on since - its head was `deb1422f5` when round 3 measured this - so the count is
stated against what this branch actually merged, which is what `ef21c7118`'s second
parent is), and what this branch
actually merged was `ea8498aaf` (via `c019d1ecc`) and then `cb9d97b79` itself (via
`ef21c7118`). Its sentence - *"The server is offline. The interface will not function
properly until the server is back online."* - exists in **neither** tree today: the copy
table this branch ships is main's, and this branch's banner change on top of it is
ADDITIVE (the address-substitution arm). A before half from a tree that old is not a
measurement of this change in either direction, and it is why the two halves no longer
shared a canvas (#17130e against #22201c, ΔE00 4.01 dark / 0.84 light) - the second half
of D8a, fixed here by shooting both halves on one tree, one ground, one pass.

**What the pair measures now, and the null result stated rather than hidden:** for the
state both trees can render, the two halves are **byte-identical** (`647010a3…` dark,
`5b731db7…` light, 1024x421 in both directories). The copy this branch's banner work is
credited with for `wedged` / `unattachable` / `stopped` is already on main. What this
branch ADDS to this surface is the address-substitution state, which main's snapshot
contract has no field for and therefore no frame of: `serving-on-fallback`,
`attached-elsewhere` and `returned-to-configured`. The other half of the delta is
composed in main's backend rather than in this surface - the refusal sentence's holder
clause, its act with the real pid, and the local-time start fact - which the readback
above and `scripts/connectivity-banner-copy.test.mjs` pin to the composers themselves.

## What these frames do not prove

- **Not `Dismiss` surviving a reload** (design round 2, D13). The control on
  `returned-to-configured` is component state, not main's: reloading the window
  re-presents the notice, and nothing in the snapshot records that it was dismissed. It is
  re-armed when the notice it dismissed is replaced by another one, which is agent round
  2's R2-3 - before that, a second substitution-and-return in one session was silent.
- **Not the click on Retry.** Round 1's D3 was that the control was inert. It now
  calls `backend.reconnect()` over IPC, which asks main to re-discover *now*;
  a still cannot show a press, the push that follows it, or the state it lands on.
  What this set shows is the control's presence and its label in the states that
  offer it. The verb's own evidence is its handler and the effect on the state
  machine, which is where a reviewer should look.
- **Not a real daemon.** The bridge is stubbed with the snapshots main produces,
  so these frames are evidence about the renderer's copy and the states that
  trigger it — not that main observes those states correctly. That half is
  `scripts/daemon-discovery-evidence.mjs` (real spawns, real records) and
  `scripts/daemon-health-state.test.mjs` (the state machine, driven directly).
- **Not the start-time fact on a holder, and that one is deliberate** (design round 2,
  D11). A holder that published when it started renders it in the READER's locale and
  timezone (`describeOccupant` -> `describeStartedAt`), so a committed literal containing
  a clock time would document the machine that shot the frame rather than the tree -
  the same class of non-comparability D8b refused. The composer is pinned by
  `scripts/connectivity-banner-copy.test.mjs` instead (the fact renders, and never as the
  raw ISO-8601 instant with milliseconds it replaced). The OTHER half of D11 IS
  photographed: `both-addresses-held`'s second holder published no `install_kind`, so its
  install fact is the prefix's last segment (`local-operator`) rather than the 47-character
  home path, and that frame is the evidence for it.
- **Not the before, in a main worktree.** The before half lives in its own declared set
  (`common-connectivity-banner-baseline`), re-shot in the round-2 pass on THIS tree with
  main's own `ConnectivityBanner` and main's own copy table swapped in, so both halves
  share one ground (design round 2, D8a; the previous half came from a worktree of
  `93f57894a`, 2,827 commits behind the branch's merge target `cb9d97b79`, and showed a
  sentence that exists
  in neither tree today). The manifest carries its recipe - including the one scratch
  story file it needs, which is written, used and deleted rather than committed - so it
  can be re-derived rather than taken on trust.
- **Not the offline-internet banner, and not every path into a state.** The
  internet sentence is unchanged by this work and is not photographed here. The
  three paths into `detached` are each a frame (`identity-failed`, `no-spawn`,
  `unclaimed`), but the frames are fixtures: they show what each snapshot renders,
  not that main produces that snapshot on that path. That half is
  `scripts/daemon-health-state.test.mjs` (the state machine's rules) and the
  rejection list `scripts/daemon-discovery-evidence.mjs` prints.

## Re-taking the set

The command above is the whole procedure. A frame that already exists is not an
addition — the manifest's arithmetic distinguishes an added surface from a
refreshed one by exactly that — so delete this directory before re-running a
capture meant to be counted as a new surface.

The baseline set is taken differently, and only in its inputs: check out `origin/main`'s
`src/renderer/src/shared/components/common/connectivity-banner.tsx` and
`src/shared/backend-status.ts` into the tree, add the one scratch story the manifest's
recipe describes plus its temporary `STORIES` row, run the same command with
`--only=common-connectivity-banner-baseline`, then restore the two files and DELETE the
scratch pair. Re-running it without the swap photographs this branch's component twice,
which is the null result the pair section above reports rather than what the set is for.
