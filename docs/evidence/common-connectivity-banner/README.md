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

1024x300 asked for, 1024x333 returned: the capturer resizes the viewport to the
content, and the longest banner (two sentences) is what made the difference.

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
| `unattachable` | the same sentence + main's spawn-gate detail: the path taken (this app was not given the key to that server), that no second daemon was started, and that it keeps probing for one it can open | warning |
| `no-bridge` | nothing — **no banner renders**: with no desktop bridge the health query has no answer and the hook's own fallback reads the server as online (design round 2, D12) | — |
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

Eighteen frames, two palettes, nine stories.

- `attached` is byte-identical to `degraded`
  (`b03d4c15…` dark, `f705c0db…` light). **That identity is the claim**: a missed
  probe must not produce a banner, and the two frames being one picture is the
  measurement of it.
- **`no-bridge` shares that identity, and there it is a contradiction rather than
  a claim** (design round 2, D12): the pair is byte-identical to `attached` /
  `degraded` (`b03d4c15…` dark, `f705c0db…` light) because the state renders NO
  BANNER. With no desktop bridge the health query has no answer, and
  `useConnectivityStatus` falls back to `serverHealth?.online ?? true`, so
  `hasConnectivityIssue` is false, so `showBanner` never becomes true.
  The contract DOES carry the sentence for this state
  (`shared/backend-status.ts`'s `serverBannerCopy(null)`: "Not connected to a Local
  Operator server.", with a comment naming the weaker self-probed answer it stands
  for) and no surface can reach it while the gate reads an absent bridge as
  online - that is the inconsistency, and it is why the story's own `play` failed
  and why the capture came back as the no-banner ground. Which side should move -
  the hook's fallback, or the unreachable sentence - is a product question for the
  design round, not one this round decides; the frame, the table row and the play
  now agree on what ships.
- The other stories have their own bytes in both palettes:
  `identity-failed` `8a143ffa…` / `61759812…`, `no-spawn` `df00bab6…` /
  `89c6af28…`, `unclaimed` `9638ffdb…` / `eafeb7c3…`, `stopped` `7479dbae…` /
  `19edc379…`, `wedged` `791cda99…` / `f086b507…`, `unattachable` `e71a3016…` /
  `a6e0bc0e…`. This list is hand-maintained and every re-capture moves it, so
  refresh it in the pass that renews the frames or read the files themselves: two
  of its entries were stale when round 2 measured them (`wedged` and `no-bridge`),
  which is exactly the drift a hand-written list accumulates.
- `unattachable` was the story whose hashes this readback could not state while its
  copy was being corrected; it no longer is. The pair committed here carries the
  corrected sentence ("This app was not given the key to that server, so it did
  not start a second one. It keeps probing for a server it can open."), captured
  through this directory's own command, and its hashes are in the list above.
- The two-sentence states are visibly taller than the one-sentence ones, which is
  the second line being main's detail rather than a different sentence count.
- Two consecutive runs of this surface at this head produce all 18 frames byte for
  byte. The rig gained a pointer reset before every navigation while this set was
  being taken (a hover entry was leaving the pointer where it stopped, and a
  tooltip opened on a delay in a later frame); every hash above is from after it.

## The pair, and what it measures

`docs/evidence/common-connectivity-banner-baseline/` is the SAME viewport and
page ground, photographed on a detached worktree of unmodified `origin/main` at
`93f57894a` (main's head, the branch's merge target) with one scratch story file
added and nothing else changed: the banner in those frames is `main`'s own
`ConnectivityBanner`, which decided liveness with its own `/health` fetch from the
renderer document.

The pair is the finding:

- **before** (`de5da87d…` dark, `7e262895…` light): one sentence — *"The server is
offline. The interface will not function properly until the server is back
online."* — for a state that three different paths reach while a daemon is still
listening. Nothing is stubbed in the baseline frame: a Storybook origin cannot
read `/health` on the daemon's origin (that is the defect stated as a mechanism),
so main's banner reaches its offline branch on its own, and it says the same
bytes whether the server is up or gone.
- **after**: nine frames, six of which render a banner, `attached`, `degraded`
and `no-bridge` rendering none at all (the last one measured rather than
intended: D12 above), and no server sentence containing the word "offline"
anywhere. `wedged` and `unattachable` are the pair that says what the
title and the detail are each for: one title between them, because the
connection fact is the same, and two details, because the paths are not.

## What these frames do not prove

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
- **Not the before, in the same tree.** The before half lives in its own
declared set (`common-connectivity-banner-baseline`), captured from a worktree of
`origin/main` rather than from this tree: the copy it photographs no longer exists
here, which is the point of the pair. The manifest carries its recipe — including
the one scratch story file it needed — so it can be re-derived rather than taken
on trust.
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
