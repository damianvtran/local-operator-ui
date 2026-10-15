# EN-only i18n convergence handoff

No global keymap/chord changes; no existing key removed. Existing labels were moved/restyled, not pre-extracted from UI#1065.

- `ui.browser.chrome.accessible_tab`: `{title}{loading, select, yes{, loading} other{}}{failed, select, yes{, failed to load} other{}}{owner, select, agent{, agent-owned} shared{, shared with an agent} other{}}{waiting, select, none{} other{, request {waiting} waiting}}{restored, select, yes{, restored} other{}}`
- `ui.browser.chrome.duplicate`: `Duplicate tab`
- `ui.browser.chrome.duplicate_refused`: `Only web pages can be duplicated.`
- `ui.browser.chrome.error_title`: `Page failed to load`
- `ui.browser.chrome.invalid_action`: `Invalid browser tab action.`
- `ui.browser.chrome.invalid_order`: `Invalid browser tab order.`
- `ui.browser.chrome.move_left`: `Move tab left`
- `ui.browser.chrome.move_right`: `Move tab right`
- `ui.browser.chrome.operation_failed`: `{action, select, duplicate{The tab could not be duplicated. You can retry from its menu.} other{The tab could not be reloaded. You can retry from its menu.}}`
- `ui.browser.chrome.reload`: `Reload tab`
- `ui.browser.chrome.scroll_left`: `Scroll tabs left`
- `ui.browser.chrome.scroll_right`: `Scroll tabs right`
- `ui.browser.chrome.tab_gone`: `That browser tab is no longer open.`

## Exact overlap diffs vs baseline422df12175
- `src/renderer/src/features/browser/components/browser-tab-strip.tsx` — [patch](overlap-diffs/browser-tab-strip.tsx.patch)
- `src/renderer/src/features/browser/components/browser-url-bar.tsx` — [patch](overlap-diffs/browser-url-bar.tsx.patch)
- `src/renderer/src/features/browser/components/browser-surface.tsx` — [patch](overlap-diffs/browser-surface.tsx.patch)
- `src/renderer/src/features/browser/hooks/use-browser-chrome.ts` — [patch](overlap-diffs/use-browser-chrome.ts.patch)
