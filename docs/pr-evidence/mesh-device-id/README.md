# Mesh member identity evidence

Rendered before/after evidence for `fix(mesh): show device ids beside member names`.

## Source identity and method

- **After:** renderer source at `1a4f40685d9f53f7191379a987d34627379e3103`.
  Storybook 8.6.12 served this worktree through Vite on port 6006. Before the
  captures, the served `mesh-identity.tsx` module contained both
  `data-mesh-device-identity` and `compactDeviceId(deviceId)`; the worktree was
  clean at that implementation commit when it was committed and pushed.
- **Before:** `origin/main` at
  `b1ced21156f8628a1e9af1c6c0dd65f661ece147`, on port 6007. The baseline
  worktree added only the same member-list fixtures, with the new-expectation
  play assertions removed; production sources stayed at the baseline commit.
  `git show HEAD:.../mesh-list.tsx` was checked not to contain
  `MeshDeviceIdentity`.
- Both servers ran with fresh scratch `HOME`/`TMPDIR`, `env -i`,
  `STORYBOOK_DISABLE_TELEMETRY=1`, and `--no-open --ci`. The harness browser
  drove one background tab and captured every PNG at 1024x576 CSS pixels
  (2560x1440 source pixels). No second browser or browser dependency was used.
- Frames use `localOperatorDark`. These are fixture renders, not evidence that
  a live relay answered; independent live-path QA remains a separate gate.

Server command (port 6007 and `storybook-before` become 6006 and `storybook`
for the after run):

```sh
env -i HOME="$ISO/home" PATH="$PATH" TMPDIR="$ISO/tmp" \
  TERM=xterm-256color STORYBOOK_DISABLE_TELEMETRY=1 \
  LOCAL_OPERATOR_UI_TELEMETRY=off LOCAL_OPERATOR_NO_NOTIFICATIONS=1 \
  node_modules/.bin/storybook dev -p 6007 --no-open --ci
```

The five `Mesh/Member rows` stories use the real wire normalisers, graph join,
and `MeshList`. Their `@storybook/test` play functions assert the quoted name,
the full id, both in the same identity element, duplicate-id distinction, and
the absent-name marker. `OneMember` also asserts that the exact unquoted name
is absent (the harness negative control). The rendered DOM was queried for all
five states; that final OneMember run and the DevicePanel run had no browser
console errors.

## State pairs

| State | Before | After |
| --- | --- | --- |
| One member | `studio-mac`, no id | `"studio-mac"` beside the full id |
| Several members | three names, no ids | three quoted names, each beside its full id |
| Absent name | `device …abcdef` | unquoted `(unnamed device)` beside the full id |
| Duplicate names | indistinguishable `shared-node` rows | equal quoted names with visibly different full ids |
| Long name | unquoted long name, no id | quoted/truncated name with the complete 34-character id still visible |
| Canvas | names only | quoted/truncated names beside `d_` + eight hex digits + ellipsis |
| Detail panel | name only | quoted name beside the same stable compact id |

Files, in the same order:

- `before-one-member.png` / `after-one-member.png`
- `before-several-members.png` / `after-several-members.png`
- `before-absent-name.png` / `after-absent-name.png`
- `before-duplicate-names.png` / `after-duplicate-names.png`
- `before-long-name.png` / `after-long-name.png`
- `before-canvas-two-devices.png` / `after-canvas-two-devices.png`
- `before-device-panel.png` / `after-device-panel.png`

The first canvas abbreviation (`d_` + eight leading and six trailing hex
digits) was itself captured and rejected: it left only the opening quote of the
name. The shipped `after-canvas-two-devices.png` is the recapture after shortening
it to eight leading hex digits; both the name and compact id are now visible.
List rows never abbreviate the id. Compact ids have the full id in their tooltip,
and the list supplies the complete id when space allows.

For the long-name after frame, the identity flex box measured 645.55x19.5 px;
the full-id span measured 244.8x17.4 px at 12 px Geist Mono with
`text-overflow: clip`, `overflow: visible`, and its right edge inside the row.

## Review remediation — round 1

The remediation was originally based on reviewed head
`87c1b92f66aa40b3650c3dd8a104445603e39475`. GitHub then reported the PR DIRTY,
so the branch was rebased onto `origin/main`
`da1ebe36d1321d12ea536e9ebd06f72d48731d97`. Range-diff mapped the evidence and
remediation patches unchanged; the original identity patch differed only where
the generated key file was regenerated to preserve both upstream `miniView`
keys and `mesh_types.unnamed_device`. The original before/after captures above
remain attributed to their actual pre-rebase sources.

The eight remediation frames below were **recaptured after the rebase** from
renderer source `f8f0839bca79360b001e22bdbb74f25237498138`; the PR remediation
comment names the final commit, whose subsequent amendment updates only this
evidence record and its images. Seven frames are pixel-identical to their
pre-rebase versions. The tooltip frame differs only in a one-pixel-wide strip
outside the identity text and was inspected at full size. All eight exercise
the real `MeshPage`, wire normalisers, graph join, compact canvas, detail panel,
menus and dialogs. They are Storybook fixtures, not live-relay evidence.

The harness browser's outer viewport was 1280x720. A scratch static wrapper
embedded the real Storybook preview iframe at **1024x576 CSS pixels**; the
browser geometry read measured the iframe rect as exactly `0,0 1024x576`.
Each 2560x1440 source screenshot was cropped to that iframe's 2048x1152 source
pixels (2x device pixels), leaving a 1024x576 CSS-pixel evidence frame. No
second browser, browser dependency, build or live backend was used. The served
`mesh-identity.tsx` contained `compactDeviceId(deviceId, deviceIds)`, and the
Storybook index contained every remediation story before capture.

| Finding | Story | New frame and actual rendered result |
| --- | --- | --- |
| D1 compact absence | `mesh-tab--compact-absent-name` | `after-compact-absent-name.png`: unquoted `(unnam…` beside `d_bbbbbbbb…`; the full id remains in the id tooltip, and the summary carries the quoted self name plus full id. |
| D1 panel absence | `mesh-tab--compact-absent-name-panel` | `after-compact-absent-name-panel.png`: complete unquoted `(unnamed device)` beside the compact id in the real detail panel. |
| D1/F2 compact duplicates | `mesh-tab--compact-duplicate-names` | `after-compact-duplicate-names.png`: two equal `"share…` names remain distinguishable as `d_012345678…` and `d_012345679…`; the shared default prefix widened by one hex digit. |
| D1/F2 panel duplicates | `mesh-tab--compact-duplicate-names-panel` | `after-compact-duplicate-names-panel.png`: the detail panel carries `"shared-node"` and the widened id. |
| F1 action menus | `mesh-tab--compact-duplicate-name-actions` | `after-duplicate-name-actions.png`: two Move and two Copy labels all include the quoted name and their distinct widened ids. The play asserts both Move labels differ and exactly match the expected identities. |
| F1 invite dialog | `mesh-tab--compact-duplicate-name-invite-dialog` | `after-duplicate-name-invite-dialog.png`: the invitation sentence includes `"shared-node"` and the complete 34-character id. |
| F1 remove dialog | `mesh-tab--compact-duplicate-name-remove-dialog` | `after-duplicate-name-remove-dialog.png`: both the title and consequences include `"shared-node"` and the complete id. |
| D2 full-name recovery | `mesh-tab--compact-long-name-tooltip` | `after-long-name-tooltip.png`: hovering the truncated panel name opens the shared tooltip with the complete quoted stored name. |

Every story's own play assertions completed with no browser console errors.
The absent-name control initially rejected an incorrect test expectation that
required the full id inline; after correcting the fixture to expect the compact
id plus its full-id tooltip, the same real story passed and was captured. This
was a fixture correction, not a production fallback or a waived assertion.
