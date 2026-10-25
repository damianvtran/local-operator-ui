# A revoked membership is not a device that failed to answer

The operator's Mesh tab read `damian-mesh · 3 devices · 2 revoked` over **two full
device cards**, both named `cloud-node-1`, both saying *conversations not reported*
and *no answer*, beside their Mac. Those two were **revoked members**: the relay
keeps a membership row with `active: false` as an audit tombstone — the device id
is burned and is never admitted again, and the relay prunes the row after 90 days
on its own. There is no CLI verb to delete one, by design.

The tab built a device node for every membership, live or revoked, so a tombstone
was drawn as a peer that had not answered. That is a claim the wire never made:
nothing dials a revoked id.

The frames are the same scene (`--scene mesh-tab`) against the same daemon, on two
source trees. The scene asks `/v1/desktop/networks` and `/v1/desktop/peers` for
the rows the app renders, derives the live and tombstone ids, **refuses a mesh
with no revoked membership**, and holds the DOM to the daemon's own answer.

Daemon census for both runs: 4 member device ids — 2 live (`damians-MacBook-Pro`,
`ip-172-31-18-0.ca-central-1.compute.internal`) and 2 revoked (`cloud-node-1`,
`cloud-node-1`), all four in one network (`damian-mesh`).

| frame | source | reading |
| --- | --- | --- |
| `before-canvas-dark.png` | base tree, `--mesh-expect tombstones` | **4 device nodes.** Two dashed-edged `cloud-node-1` cards read *conversations not reported · no answer*; census `1 network · 4 devices · 1 reached · 2 no answer` |
| `before-list-dark.png` | base tree | **4 rows.** The two tombstone rows carry the words *revoked membership · drive · revoked* — and are still laid out as devices: *Conversations (unknown) · Link down · it did not answer*, with *Invite to a network…* |
| `after-canvas-dark.png` | this branch, `--mesh-expect collapsed` | **2 device nodes**, both live, solid edges. The lane reads `2 devices · 2 revoked`; the census ends `· 2 revoked ›` |
| `after-list-dark.png` | this branch | **2 rows**, both live members. The network heading keeps `active · 2 devices · 2 revoked`; the census carries the one disclosure |
| `after-revoked-open-dark.png` | this branch, count pressed with a real pointer | The disclosure opens into two audit rows: network, recorded name, **the burned device id**, and the role the membership held |

The count is the number the lane and heading already printed — no fact was
dropped. What changed is that a tombstone is no longer dressed as a device that
stayed silent.

## Reproducing the pair

Both runs used the rig's isolated daemon on `127.0.0.1:8977` (v0.86.2), its
scratch profile and token — never the operator's own backend on 1111. The
renderer was built against that URL:

```bash
VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8977 \
VITE_DISABLE_BACKEND_MANAGER=true LOCAL_OPERATOR_UI_NO_BYTECODE=true pnpm build

DISPLAY=:99 LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat /tmp/rig/token)" \
  node scripts/renderer-driver.mjs --scene mesh-tab \
  --mesh-expect collapsed --backend http://127.0.0.1:8977 \
  --seed-onboarding-complete --theme localOperatorDark --out /tmp/frames-mesh/after
```

The before run is the same command with `--mesh-expect tombstones` over the base
tree's product sources (only the driver's `data-mesh-presentation` hook was
carried across, because the scene presses the List control; it changes nothing
the tab draws). `--mesh-expect` is required to be one of the two values: a run
under the wrong name would photograph the wrong half as evidence.

The before run's own checks state the defect:

```
[PASS] the base tree draws every member id as a device node
[PASS] the base tree draws a revoked tombstone as a peer that did not answer
        d_38361e…: cloud-node-1–conversations not reported◉no answer | d_428cb3…: cloud-node-1–conversations not reported◉no answer
```

The after run passes, in order: the device nodes are exactly the live member ids;
no tombstone is a node; the census names the revoked count; one affordance exists;
the list files one row per live membership and none for a tombstone; and the
pressed count names every revoked membership with its burned id.

## What these frames cannot prove

- **One palette only.** Every frame is `localOperatorDark`. The disclosure uses
  the census line's own role inks (`text-ink-dim`, `text-ink`) on the canvas
  ground; the 59 palettes' floors are enforced by `pnpm check-themes`, but no
  light or alternative-palette frame was captured for this pair.
- **Tombstone creation.** The daemon's two revoked memberships predate the run;
  this change does not create or delete a revocation, and the scene reads rows it
  did not author.
- **The relay's 90-day pruning.** Nothing here exercises retention; the frames
  show the row the relay leaves behind and the tab's handling of it.
- **A clean mesh.** The scene refuses to run without a revoked membership, so it
  says nothing about a mesh that has none (beyond the absent count).
