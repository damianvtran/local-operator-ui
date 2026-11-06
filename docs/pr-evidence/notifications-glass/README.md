# Notifications glass — group headers and the read-state switch

Operator report, 2026-11-05: the group headers ("Waiting on you 1", "Today 1")
painted as solid dark bars across a glass panel, and the Unread/All switch was
equally opaque — "holes punched in the backdrop rather than layers on it".

## How these frames were taken

`scripts/notifications-glass-evidence.mjs`, driven through a Storybook this
session booted (`scripts/with-storybook.mjs`):

```
node scripts/with-storybook.mjs -- \
  node scripts/notifications-glass-evidence.mjs --out docs/pr-evidence/notifications-glass
```

The story is `Notifications/Page` (`populated` / `deep-scroll`), which renders the
shipped page against the same fixture data the design rounds use. The glass is the
APP's own paint path: Storybook's `glass`/`glassIntensity` args call
`applyGlassFacts` — the function main's launch fact reaches in the shipped app —
and the harness paints the measured under-window backdrop tone behind the story.
Frames are clipped to the story's own box, so no Storybook chrome appears in them.
Chrome ran `--headless=new` with its own `--user-data-dir` and `--use-mock-keychain`
and was reaped by exact process group; nothing was shown on the operator's screen.

**What a frame here may claim.** The COMPOSITION: what the app paints over the
backdrop it is given. A browser document has no OS material, so these frames are
not evidence about macOS vibrancy; the real window's compositing is QA's native
lane. `readback.json` is the DOM readback taken in the same instant as each PNG
(the alphas, the blur, the sticky position, the scroll offset), so the pixels and
the numbers describe one state.

**The `-before` half.** The surface's entire diff is two attributes
(`data-glass-plane="band-backdrop"` on the header, `data-glass-well` on the switch
track) plus the rules that match them. The `-before` frame is the SAME page, same
story, same args, with those attributes removed — which is what the base tree
rendered, because everything else (`bg-canvas`, `bg-sunken`, `bg-elevated`, the
sticky geometry) is unchanged. It is not a rebuild of `main`.

## The matrix

| frame | args | what it shows |
| --- | --- | --- |
| `dark-80.png` / `-before` | dark, 80 %, Full app | the reported view: headers and switch at the default intensity |
| `dark-50.png` / `-before` | dark, 50 % | the most transparent shipped intensity |
| `light-80.png` / `-before` | light, 80 % | the light scheme, same floors |
| `light-50.png` / `-before` | light, 50 % | the light scheme at the clear end |
| `dark-80-contrast-high.png` / `-before` | dark, 80 %, contrast +80 | a NON-STANDARD contrast preset: glass stays on, the band's floor is re-derived for the composed palette (0.81) |
| `dark-80-contrast-soft.png` / `-before` | dark, 80 %, contrast −80 | the other direction (floor 0.86) |
| `dark-80-glass-off.png` / `-before` | dark, translucency OFF | the opaque fallback: same classes, no glass, nothing half-applied |
| `light-80-glass-off.png` / `-before` | light, translucency OFF | the same in the light scheme |
| `dark-80-scrolled.png` | dark, 80 %, list scrolled 160 px | a row passing UNDER the pinned header: the header's top is unchanged while the row's title has gone beneath it |

`readback.json` carries, per frame: the band's computed alpha against
`--lo-glass-a-band-floor` and `--lo-glass-a-elevated`, its `backdrop-filter` and
`position`, the switch track's alpha against `--lo-glass-a-field`, the checked
segment's against `--lo-glass-a-row-selected`, and the scroll offset.

## Not in this set

- The real app window with macOS vibrancy behind it (native lane).
- The chat rail's updates drawer switch (`data-glass-well` added there too): the
  same rule composes it, and its track reads the pane's field overlay; it has no
  committed frame here because the drawer only renders over a live conversation.
- Any frame from a headless run of the APP itself: `scripts/window-glass-cdp.test.mjs`
  now covers this surface (see the PR), but this session's environment publishes no
  CDP page target for the built app (`/json` returns `[]` after 40 s), so that
  guard could not be executed here.
