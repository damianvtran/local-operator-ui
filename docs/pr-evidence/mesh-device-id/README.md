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
