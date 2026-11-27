/** 16px of block padding plus the 19.5px body-sm line box. Both caps spend
 * complete rows; using the rounded-up line box would expose a sliver of the next. */
export const SUGGESTION_ROW_PITCH = 35.5;

/**
 * The composer owns one visual language for @ and /. Every inset is inline:
 * adding block gaps or list padding would spend space the whole-row caps did
 * not budget. Keep the active mark on the logical leading edge, separate from
 * the current-value and applied-tag markers inside the row.
 */
export const SUGGESTION_ROW =
	"relative mx-1 flex min-w-0 items-center gap-2 rounded-sm px-3 py-2 text-body-sm aria-selected:bg-accent-wash aria-selected:before:pointer-events-none aria-selected:before:absolute aria-selected:before:inset-s-1 aria-selected:before:inset-y-2.5 aria-selected:before:rounded-full aria-selected:before:border-s-2 aria-selected:before:border-ink-muted forced-colors:aria-selected:before:border-[Highlight]";

// Replace each full-bleed 1px rule with an inset divider without changing the
// chrome height, which the mention picker reserves before it budgets any rows.
export const SUGGESTION_HEADING =
	"relative px-4 pt-1 pb-[5px] text-meta font-semibold text-ink after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:divider-inset";

export const SUGGESTION_FOOTER =
	"relative px-4 pt-[5px] pb-1 text-meta text-ink-muted before:pointer-events-none before:absolute before:inset-x-4 before:top-0 before:h-px before:divider-inset";

export const SUGGESTION_NOTICE = "px-4 py-2 text-body-sm text-ink-muted";
