# Import conversations: the three defects, measured

**Claim.** Building a preview moves nothing in the app's frame, a selected row
reads as selected without relying on a 14px tick, the preview is built from the
selection, its failure is stated beside the controls it disables, and reaching an
enabled Import button takes two interactions instead of three.

**How it was measured.** `scripts/import-settings-geometry.mjs` drives
`scripts/import-settings-geometry.html` — the SHIPPED `SettingsPage` against a
stubbed desktop bridge — over raw CDP against a private headless Chrome, in the
app's own shell chain (`relative flex h-screen flex-col overflow-hidden` →
`flex min-h-0 flex-1 overflow-hidden` → `main.flex grow flex-col overflow-hidden`).
Every number below is read from the DOM of the same page the matching frame was
captured from, in one run.

```
node scripts/import-settings-geometry.mjs --out=docs/verification/import-settings-geometry
```

## The rig has bite

`before-prefix.png` is a REAL pre-fix capture, not a reconstruction. The two
components were checked out from `eaed1edffaa21f61f9d394c17fb3cf141077b57e`,
the rig was run with `--no-states` (the extra states need fixtures that build
cannot render), and the resulting post-Preview frame was committed unchanged:

| pre-fix run (`before-prefix-numbers.json`) | value |
| --- | --- |
| shell root `scrollTop` after the preview | **237** |
| content `scrollTop` after the preview | **6819** |
| `window.scrollY` after the preview | **0** |
| flow steps | **3**: select → press the Preview button → tick the acknowledgement |
| manual Preview button | **present** |
| selected row classes | `border-hairline bg-surface hover:bg-sunken` (no selected treatment) |

The frame shows what those numbers mean: the sidebar starts at "Integrations",
the top of the page is cut off, and a large empty band fills the bottom third of
the window — the app's own clipped root has been scrolled and cannot be scrolled
back. Against this branch the same rig reports `0` and two interactions.

## The numbers — the fixed build

Window 1380x900, `localOperatorDark`. `shell root` is the app's own clipped root
(`overflow: hidden`, `scrollHeight` 4725 against `clientHeight` 900 — the hidden
overflow the `sr-only` labels produce, which is why `scrollIntoView` could reach
it at all). `content` is the settings content container (`[data-settings-content]`,
`flex-1 overflow-y-auto`), the one box that owns its reading position.

| | before | selected | after (preview built) |
| --- | --- | --- | --- |
| `window.scrollY` | 0 | 0 | **0** |
| `documentElement.scrollTop` | 0 | 0 | **0** |
| shell root `scrollTop` | 0 | 0 | **0** |
| shell `scrollHeight` / `clientHeight` | 4725 / 900 | 4725 / 900 | **4725 / 900** |
| content `scrollTop` | 6513 | 6513 | **6513** |
| session checkbox `data-state` | `unchecked` | `checked` | **`checked`** |
| Radix Indicator | absent | mounted | **mounted** |
| checkbox fill | `rgb(43, 39, 33)` | `rgb(43, 39, 33)` | **`rgb(56, 201, 106)`** |
| selected row | none | present | **present** |
| manual Preview button | absent | absent | **absent** |
| Import button enabled | no | no | no (the acknowledgement is the last step) |

**Building the preview moved: shell root 0px, window 0px, content 0px.**

Why the two fill cells differ: the checkbox transitions its ground over 120ms.
The `selected` reading is taken immediately after the click, inside that
transition, so it reports the ground the transition started FROM; the `after`
reading is taken 400ms later and reports the settled fill. Both are what the
file says — the table is not a summary of it.

## The flow

**2 interactions** to an enabled Import button: select a conversation, tick the
acknowledgement. The pre-fix build took **3**. The manual Preview button is gone
entirely, which is what makes the old two-things-called-Preview defect
impossible rather than merely renamed.

## The states round-1 review asked for

Each row is a fresh page in its own configuration, measured and captured in the
same run. All of them report `window.scrollY = 0`, `documentElement.scrollTop = 0`
and shell root `scrollTop = 0`.

| state | frame | what it shows | numbers |
| --- | --- | --- | --- |
| pending | `pending.png` | the debounce window: the spinner is the only thing saying a build is coming | spinner `true`, checkbox `checked`, row selected |
| settled | `settled.png` | the preview landed in place | spinner `false`, fill `rgb(56, 201, 106)`, content `6513` |
| preview failure | `failure.png` | the reason and its Retry INSIDE the block that holds the disabled acknowledgement and Import | inline `true`, retry in that block `true`, spinner `false` |
| completion | `completion.png` | the result and the "Import more conversations" CTA | CTA `true`, result heading `true`, content `6458` |
| glass on | `glass.png` | the app's own paint: `data-glass="sidebar canvas pane"`, canvas alpha `0.66`, row-selected alpha `0.08` | selected row present, fill `rgb(56, 201, 106)` |
| narrow | `narrow.png` | 1000x900: the nav collapses to an icon rail, the column holds | content `6513`, row selected |
| light | `light.png` | `localOperatorLight`, scheme `light` | fill `rgb(19, 119, 66)`, row selected |

`retryPresent` reads `true` in every state because another settings section
renders its own Retry control; the claim this rig makes is `retryInGate`, which
is `true` only in the failure state — the button is inside the block that holds
the controls it explains.

The glass frame is the rig's own ground under the app's real glass CSS. It is
NOT a macOS backdrop composition: a headless Chrome window has no desktop behind
it, so this frame judges the selected row's treatment on the translucent ground
the operator's palette produces, not the OS material.

## The frames

- `before.png` — the fixed build at rest: nothing selected, no preview, no
  manual Preview button.
- `before-prefix.png` — the pre-fix build after pressing its manual Preview: the
  237px shift, the empty band, the manual Preview button.
- `pending.png`, `settled.png`, `failure.png`, `completion.png`, `glass.png`,
  `narrow.png`, `light.png` — as tabulated above.
- `after.png` — the preview built and the acknowledgement/Import block in view.
- `flow-complete.png` — the acknowledgement ticked and the Import button live.
- `numbers.json` — every cell above, plus the intermediate `selected` reading.

## What this rig cannot see

The bridge answers; whether the real backend serves that payload is QA's job
against a running app. Focus-dependent rendering (carets, `:focus-visible` rings)
is not measured — a headless window is never focused. The stub's
`imports.preview` counts the sessions actually requested, so the card's figures
are the selection's own; it is not a real count of what the core would copy. The
completion state is a fixture that carries a `result`; a real job that ends
without one would not reach that CTA.
