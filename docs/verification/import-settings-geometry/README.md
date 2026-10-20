# Import conversations: the three defects, measured

**Claim.** The import surface moved nothing when a preview was built, the
selected row reads as selected without relying on a 14px tick, and reaching an
enabled Import button takes two interactions instead of three.

**How it was measured.** `scripts/import-settings-geometry.mjs` drives
`scripts/import-settings-geometry.html` — the SHIPPED `SettingsPage` against a
stubbed desktop bridge — over raw CDP against a private headless Chrome, in
the app's own shell chain (`relative flex h-screen flex-col overflow-hidden` →
`flex min-h-0 flex-1 overflow-hidden` → `main.flex grow flex-col overflow-hidden`).
The numbers and the frames in this directory are ONE run: the frames are taken
from the same DOM the numbers are read from.

```
node scripts/import-settings-geometry.mjs --out=docs/verification/import-settings-geometry
```

**The rig has bite.** Run against the pre-fix build
(`1f285116b3:src/renderer/src/features/settings/components/import-settings-view.tsx`
and `…-section.tsx`), the same rig reports the shell root moving **237px** and
the flow taking **3** interactions - the defect the manager measured in the
built app. Against this branch it reports **0px** and **2**. The rig is not
reading a number that was always going to be zero.

## The numbers

Window 1380x900, `localOperatorDark`. `shell root` is the app's own clipped
root (`overflow: hidden`, `scrollHeight` 4725 against `clientHeight` 900 - the
3825px of hidden overflow the `sr-only` labels produce, which is why
`scrollIntoView` could reach it at all). `content` is the settings content
container (`[data-settings-content]`, `flex-1 overflow-y-auto`), the one box
that owns its reading position.

| | before | selected | after (preview built) |
| --- | --- | --- | --- |
| `window.scrollY` | 0 | 0 | **0** |
| `documentElement.scrollTop` | 0 | 0 | **0** |
| shell root `scrollTop` | 0 | 0 | **0** |
| content `scrollTop` | 6513 | 6513 | **6513** |
| session checkbox `data-state` | `unchecked` | `checked` | `checked` |
| Radix Indicator | absent | mounted | **mounted** |
| checkbox fill | `rgb(43, 39, 33)` | `rgb(56, 201, 106)` | **`rgb(56, 201, 106)`** |
| tick glyph | - | `rgb(22, 19, 14)` | `rgb(22, 19, 14)` |
| selected row | none | `bg-row-selected` | **`bg-row-selected`** |
| manual Preview button | absent | absent | **absent** |
| Import button enabled | no | no | yes, after the acknowledgement |

**Building the preview moved: shell root 0px, window 0px, content 0px.**

The `selected` column is the reading taken BETWEEN the selection and the
preview, while the debounced build was still pending. The difference between
it and `after` is exactly what building the preview moved, which is the
question the defect was about; reading only "before the selection" and "after
the preview" would charge the page's own loading to the preview.

## The flow

**2 interactions** to an enabled Import button: select a conversation, tick
the acknowledgement. The pre-fix build took **3**: select, scroll to a separate
section and press a button that read "Preview" under a heading that also read
"Preview", then tick a second, identically shaped empty square.

## The frames

- `before.png` — the section as it arrives: nothing selected, no preview, no
  manual Preview button.
- `after.png` — the preview built. The selected row carries the app's
  selected-row treatment (`bg-row-selected` plus an accent border) and the
  filled tick, the preview card shows the requested sessions' own counts, and
  the acknowledgement and the Import button sit in ONE bordered block.
- `flow-complete.png` — the flow finished: the acknowledgement ticked and the
  Import button live.

## What this rig cannot see

The bridge answers; whether the real backend serves that payload is QA's job
against a running app. Focus-dependent rendering (carets, `:focus-visible`
rings) is not measured - a headless window is never focused. The stub's
`imports.preview` counts the sessions actually requested, so the card's figures
are the selection's own; it is not a real count of what the core would copy.
