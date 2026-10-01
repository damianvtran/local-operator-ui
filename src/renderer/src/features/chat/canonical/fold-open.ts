/**
 * The explicit-open registry for action-group folds (§E2).
 *
 * WHY THIS EXISTS AT ALL, and why the state cannot live on the fold (operator
 * report, 2026-09-27): "Expanded states of action groups should survive being
 * off screen and updates to the conversation ... they shouldn't be closed
 * simply by state updates if they've been explicitly opened."
 *
 * A `TraceFold`'s React identity IS its key - the first row of its run - and
 * that identity legitimately CHANGES while the reader has the fold open: the
 * transcript mounts only the newest 60 rows (`WINDOW`), and every row that
 * arrives drops the window's oldest row. When the window's leading edge walks
 * through a run (measured on `scripts/scroll-shift-evidence.mjs`, fold rounds:
 * a run `[t1..t4]` becomes `[t2..t4]` one incoming row at a time), the fold's
 * key changes, React unmounts it and mounts a fresh one - and `useState(false)`
 * on the new instance silently re-collapses a fold the reader had opened. That
 * is why a plain component-local `useState` cannot own this state: the state
 * must outlive every instance an incoming row can replace, and it must be
 * looked up by an identity that survives the instance's own churn.
 *
 * THE LOOKUP IDENTITY. Entries are keyed by a fold's CURRENT first-row id, and
 * a lookup for a fold whose first id has no entry falls back to ANY shared row
 * id: record ids are unique to one row, and a row belongs to one run, so any
 * overlap between a stored id set and the incoming one means the two describe
 * the same fold (the boundary case above - `[t1..t4]` stored, `[t2..t4]`
 * queried - shares three). A shared id MIGRATES the entry to the querying
 * fold's current key, so the registry always tracks the fold as it is now, and
 * a fold that walks two rows off the window in as many frames moves through
 * one entry rather than accumulating one per id shift.
 *
 * WHAT OWNS CLOSING. With the fold's condense event retired (the same report:
 * an explicitly-opened fold is the READER's), the reader is the only closer:
 * `write(ids, false)` on their press, and the conversation's own unmount on a
 * switch - which is why the caller keys the whole registry by conversation and
 * starts fresh, exactly the persistence the report allows ("they don't need to
 * persist between switching conversations").
 *
 * PURE, so the walk above is pinned by arithmetic in `fold-open.test.mjs`
 * rather than by a browser.
 */

export type FoldOpenEntry = {
	/** The fold's row ids, first to last, as they were at the last write. */
	ids: readonly string[];
	/** Whether the reader has this fold open. */
	open: boolean;
};

/**
 * Whether the reader has this fold open.
 *
 * Exact first-id match first (the common case: nothing has churned), then any
 * shared id (the window's edge moved). No entry at all is the shipped default:
 * a group arrives condensed and stays that way until the reader asks.
 */
export function foldOpenOf(
	entries: readonly FoldOpenEntry[],
	ids: readonly string[],
): boolean {
	if (ids.length === 0) return false;
	const exact = entries.find((entry) => entry.ids[0] === ids[0]);
	if (exact) return exact.open;
	const shared = entries.find((entry) =>
		entry.ids.some((id) => ids.includes(id)),
	);
	return shared?.open ?? false;
}

/**
 * The registry after the reader's press on this fold (or the app's retirement
 * of its entry), with the entry migrated to the fold's CURRENT id set.
 *
 * `keep` prunes entries that can no longer describe any live row - the caller
 * passes every record id the conversation still holds. It is the caller's set
 * rather than this module's judgement because "still live" is a fact about the
 * transcript, not about the registry; an entry whose rows are all gone can
 * never be looked up again, so keeping it is a leak and pruning it with the
 * wrong set is a silent state loss.
 */
export function withFoldOpen(
	entries: readonly FoldOpenEntry[],
	ids: readonly string[],
	open: boolean,
	keep: ReadonlySet<string>,
): FoldOpenEntry[] {
	if (ids.length === 0) return [...entries];
	const key = ids[0];
	const next: FoldOpenEntry[] = [];
	let wrote = false;
	for (const entry of entries) {
		const same =
			entry.ids[0] === key || entry.ids.some((id) => ids.includes(id));
		if (!same) {
			next.push(entry);
			continue;
		}
		// One visit writes the new entry; any further matches are the same fold
		// described twice (an older key beside the current one) and fold into it.
		if (!wrote) {
			next.push({ ids: [...ids], open });
			wrote = true;
		}
	}
	if (!wrote) next.push({ ids: [...ids], open });
	return next.filter((entry) => entry.ids.some((id) => keep.has(id)));
}
