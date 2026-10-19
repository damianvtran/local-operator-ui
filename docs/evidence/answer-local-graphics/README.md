# Answer-local graphics disclosure

Captured 2026-10-19 through the harness **browser tool**, in one owned background tab on the existing desktop browser host; the tab was closed afterwards. No native app, operator session, standalone browser engine, or scratch dependency installation was used. The isolated Storybook server was reaped by its exact process group (95520). Coder model: `openai/gpt-6.1-sol`, temporary fallback after Anthropic quota exhaustion.

## Reach the states

From this worktree run `pnpm storybook -- --ci --no-open` (or `pnpm exec storybook dev -p 6017 --ci --no-open`), then open:

`http://localhost:6017/iframe.html?id=chat-turn-supplements--local-graphics-closed&args=theme:localOperatorDark&viewMode=story`

Use `theme:localOperatorLight` for light. Story IDs use `local-graphic-closed`, `local-graphic-open`, `local-graphics-closed`, `local-graphics-open`, `local-graphics-narrow`, `local-graphic-refused`, and `local-graphic-loading`. The open fixtures click the real shared disclosure after mount, not an initial-open override. The narrow fixture is a **360 CSS px story container**, not a narrow browser viewport.

The new fixtures deliberately use the answer's real ID as `supplement.anchor`. The older `FoldedCondensed*` fixtures use `m1` for the answer and a different supplement anchor; the current ownership check therefore leaves those older fixtures uncondensed. They were not used as proof of the new closed state, and the collapse model was not changed.

## Frames (all PNGs opened and visually inspected)

All captures: 1280×720 CSS viewport, 2560×1440 PNG (2× scale). Wide content: 810 CSS px; narrow block: 280 CSS px inside the 360px container. Light/dark use the actual localOperatorLight/localOperatorDark palettes, not recolored images.

| Frame | State and interpretation |
| --- | --- |
| `before-dark-closed.png` | Base `cd184a49d3` SupplementRow, dark: inert `2 graphics` below answer, closed work bar, no graphic. |
| `before-light-closed.png` | Same baseline in light. |
| `after-dark-closed.png` | Dark: leading shared chevron and `Show 2 graphics`, no graphic slots. |
| `after-light-closed.png` | Light counterpart, paired with the light baseline. |
| `after-dark-open.png` | Dark: locally opened `Hide 2 graphics` with one budgeted chart while work stays folded. |
| `after-light-open.png` | Light counterpart; chart mounted locally, work remains folded. |
| `after-dark-overflow.png` | Explicit `Show all 1 graphic` pressed: `Show fewer` and the second chart, scrolled into view by the browser click. Exactly two iframes measured. |
| `after-dark-narrow.png` | Dark, 360px container: wrapped answer and one local chart; no horizontal escape. |
| `after-light-narrow.png` | Light counterpart. |
| `after-dark-refused.png` | Open local singular control (`Hide 1 graphic`), ordinary `Couldn't render this graphic · Retry` fallback. |
| `after-light-loading.png` | Open local singular control and the retained reserved/shimmer box while the document promise remains pending. |

The baseline is an executable same-gallery control: only SupplementRow was temporarily supplied from `origin/main` at `cd184a49d3`, while the new owner-correct fixture and gallery plumbing remained identical. The modified row was saved in session scratch and restored before after-capture or final testing. A first mistakenly expanded baseline screenshot was discarded/overwritten after inspecting it; its owner mismatch prompted the fixture correction above. No frame from that incorrect state is presented as closed evidence.

## Execution observations

- Mounted shipped-row tests: closed has zero slots, zero iframes and zero media calls; local open mounts the budgeted head without changing `condensed`; explicit overflow mounts only its tail; identity replacement is closed before commit and does not fetch; returning to an old identity does not resurrect permission.
- Browser flow: clicked `Show 2 graphics`, then opened and reclosed the actual work bar. Expanded work had exactly one iframe and no local trigger; reclosed work again had `Hide 2 graphics` and exactly one iframe. The explicit local permission survived. The 790px-wide local iframe measured 370px high, within the unchanged host clamp. Expanded work's frame measured 810×379px. At narrow width the local frame measured 260×131px.
- Overflow browser flow: exactly two frames after explicit expansion, measured 790×370 and 770×361px; `Show fewer` remained the overflow control. The top-level Show copy is not a promise to auto-mount the off-budget tail.
- Shared Disclosure supplies a native button, leading chevron, `aria-expanded`/`aria-controls`, Enter/Space activation and the existing focus outline; no tooltip, new key binding, focus move or turn-expansion handler was added. Mounted tests check that focus stays on the trigger while opening and that `aria-expanded` changes false→true. Physical keyboard activation was not independently driven by this browser-tool pass.
- Document-loading and document-error states were observed through the real frame/slot path with the synthetic Storybook media bridge. This proves component mounting and chrome, not native protocol security or a live harness-generated chart. Existing chart fixtures were reused unchanged; the parallel harness chart fix is outside this PR.

Targeted command: `node --test scripts/supplement-disclosure.test.mjs scripts/supplement-row.test.mjs scripts/supplement-model.test.mjs` → **33 tests, 33 pass, 0 fail, 0 skipped**. Biome touched-file check exits 0, with the pre-existing unused `blockRecord` warning in supplement-model.test.mjs. Full automated coverage is delegated to CI, not duplicated locally; independent review/design/QA/UX rounds remain separate gates.
