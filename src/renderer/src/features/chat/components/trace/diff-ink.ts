import type { DiffLineKind } from "./tool-row-model";

/**
 * The line's ink, by the line's kind.
 *
 * Roles only, per `docs/branding.md` § 1: `success`/`danger` are the same two
 * roles the row's counters use, `ink-muted` is the TUI's `tool.diff.hunk` and
 * `ink-dim` its `tool.diff.context`. `success` and `danger` as text on a
 * `sunken` ground are asserted on every theme by
 * `scripts/contrast-contract.mjs` (`AS_TEXT` against `canvas`/`surface`/
 * `sunken`), so the pairs this block introduces — coloured text in a sunken
 * well — are measured pairs rather than a new token. Shared by the inline
 * preview (`diff-block.tsx`) and the full-diff pager (`diff-history.tsx`) so
 * both bodies paint one classifier's kinds in the same inks. The two tightest are
 * 4.58 and 4.73 on sage; see the file header for the full reading.
 */
export const KIND_INK: Record<DiffLineKind, string> = {
	hunk: "text-ink-muted",
	added: "text-success",
	removed: "text-danger",
	context: "text-ink-dim",
};
