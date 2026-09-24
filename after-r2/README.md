# Round-2 frames — UI PR #491 (`feat/integrations-redesign`)

Frames for the round-2 remediation head `69de06a97` (the folded tip), taken from
Storybook at that tree with the session's own capture rig.

## How they were taken

- Storybook (`npx storybook dev --ci --quiet`) from the worktree at this head, on
  a private port, in the background, never taking the operator's focus.
- A private `--headless=new` Chrome on a session-unique `--user-data-dir`, with
  `--use-mock-keychain` (a scratch profile must never reach the keychain), driven
  over CDP; the process group was reaped by exact pid after each run.
- **Theme rides the URL argument**, `&args=theme:<name>` — never `globals=theme:`,
  which this preview ignores. Dark is `localOperatorDark`, light is
  `localOperatorLight`.
- Each frame is 1000x860 at DPR 1, driven to the state named by the story and the
  clicks, then captured with `Page.captureScreenshot`.

## What is here

`after-r2/` — the states the round-2 findings are about, at this head:

| frame | finding |
| --- | --- |
| `D12-add-key-{dark,light}` | the key dialog with a referenced key, the input focused (D12) |
| `D12-add-key-without-a-reference-{dark,light}` | the keyless dialog, the value field focused (D12, D16) |
| `D13-session-fallback-{dark,light}` | the session-route fallback: `Ready` rows' Connect weight (D13) |
| `D14-sign-in-no-browser-dark` | the copy control anchored to the URL line (D14) |
| `D15-sign-in-failed-{dark,light}` | the failed sign-in's next step, naming no key the row lacks (D15) |
| `D17-sign-in-done-{dark,light}` | the success phase, which had no rendered state (D17) |
| `U13-add-form-{dark,light}` | the add form's note, with no chat command and no mono (U13) |
| `n1n2-search-field-{dark,light}` | the search field over the integrations list (n1, n2) |
| `D18-no-sessions-at-all-{dark,light}` | the fallback's only control (D18) |

`before-r2/` — the same two dialog states with the pre-fix geometry (the D12
pair), so the ring can be compared rather than described.

**One missing frame, stated rather than implied:** `D14-sign-in-no-browser-light`
is absent. That story's flow (press Sign in, then Continue in browser, then the
dialog) did not reach the state on three consecutive attempts at this head on a
loaded host, and the dark frame plus the DOM reading below carry the finding.
No light frame is presented as a dark frame's twin.

## The D12 measurement, which is what the finding turns on

Sampled from the captured PNG, on the focused input's own mid row, counting pixels
of the element's computed `outline-color` within 6px either side of the input's
box edges — and read together with the geometry, because the number alone does not
say why:

| state | theme | room either side | outline | `:focus-visible` | accent px on the mid row |
| --- | --- | --- | --- | --- | --- |
| `add-key` before | dark | 0px | solid 2px | true | **0** |
| `add-key` before | light | 0px | solid 2px | true | **0** |
| `add-key` after | dark | 6px | solid 2px | true | **4** |
| `add-key` after | light | 6px | solid 2px | true | **4** |
| `add-key-without-a-reference` before | dark/light | 0px | solid 2px | true | **0** |
| `add-key-without-a-reference` after | dark/light | 6px | solid 2px | true | **4** |

"Room" is the distance from the control's border box to the scroll body's clip
edge. The ring is `outline-width: 2px` at `outline-offset: 2px`, so it occupies
the 4px outside the control: at 0px of room its left and right sides are clipped
and the mid row carries no accent at all, which is the reported regression. Four
pixels is two per side — the 2px-wide vertical segment of the ring.

## What these frames are not

They are renderer evidence from Storybook, not a live-backend walk: whether the
real backend serves these documents, and the flows that need it (a keyless save
end to end, a cancelled sign-in, a live Disconnect, a deleted chat folder, an app
reload), belong to the live scenarios and to QA's pass.
