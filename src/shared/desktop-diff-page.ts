/**
 * The most rows one full-diff page may ask for: the core's page cap, which is
 * also the inline preview's row budget, so a page never paints a longer body
 * than the preview the reader already knows.
 *
 * WHY ITS OWN DEPENDENCY-FREE MODULE. The transcript reducer (a condense parity
 * model source, bundled by `scripts/generate-condense-parity.mjs`) reads this
 * cap through `diff-history-model.ts`. Importing it from `desktop-contract.ts`
 * dragged that whole contract - and `agent-messages-contract.ts`,
 * `attachment-upload.ts`, `desktop-control-contract.ts`,
 * `journal-order-query.ts` and `link-preview.ts` with it - into the parity
 * bundle, so the pin's `modelSources` outgrew `PARITY_MODEL_SOURCES` and A27 in
 * `scripts/ci-scope.test.mjs` failed. A leaf module keeps the phone's parity
 * surface to the two files this feature actually adds. `desktop-contract.ts`
 * re-exports it, so the IPC schema and every existing importer are unchanged.
 */
export const DESKTOP_DIFF_PAGE_MAX_ROWS = 200;
