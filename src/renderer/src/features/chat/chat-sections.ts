/**
 * The `Pinned chats` section's partition, as a decision rather than a JSX
 * condition.
 *
 * WHY a module of its own. This repository's rule, stated in
 * `sidebar-catalogue-gate.ts`: a decision in a JSX condition is one no test can
 * reach. The sidebar cannot be rendered in this repo's test suite - it reads the
 * router, the canonical-sessions store and the desktop capability hooks - so the
 * section's three claims (which rows are pinned, which are left for the sections
 * below, and what a backend without the capability renders) are asserted here
 * rather than against the component's source text.
 *
 * WHAT IT IS: a PARTITION, in the same sense the TUI's `_section_of` partitions
 * its window (`local_operator/tui/widgets/session_sidebar.py`) - pinned is
 * section 0 and outranks active, so a pinned row is drawn ONCE, in the pinned
 * section, and is absent from `Active chats` / `Previous chats` / the flat
 * `All chats` list. The alternative - lift a copy up and leave the original -
 * paints one conversation twice in one scroll region.
 *
 * WHAT IT DELIBERATELY DOES NOT DO, each for the reason it is stated:
 *
 * - **No re-sort.** The order is the catalogue's own, passed through untouched
 *   (`filter`, never `sort`). The TUI's `★ Pinned` section is drawn in the
 *   catalogue's order too (`session_sidebar.py` sorts by section key alone, so
 *   the catalog's own order survives inside each section), and a UI that ordered
 *   its Pinned section by pin recency would order one list two ways across two
 *   surfaces. That is why the wire carries no rank or timestamp beside `pinned`.
 * - **No lifting a pinned row out of its agent group.** Sections and groups are
 *   two different axes, and the panel already shows one row in two places on two
 *   axes (a chat appears in `Active chats` AND under its agent when expanded).
 *   The entity lists therefore read the unpartitioned list; only the section
 *   lists below use `unpinnedRows`.
 * - **No empty section.** An empty `pinned` array means the component renders no
 *   heading and no section at all, which matches the TUI's own rule that an
 *   empty section contributes no header.
 */

/**
 * The rows the `Pinned chats` section draws.
 *
 * `enabled` is the capability gate (`desktopFeatureEnabled(capabilities.data,
 * "session_pins")`) and it is a parameter rather than something the caller checks
 * around the call, for the reason the whole file exists: "no affordance and no
 * section" has to be one testable decision. A backend without the pin store
 * advertises no key, so this returns nothing and the panel is byte-identical to
 * the one that never knew about pins.
 */
export function pinnedRows<T extends { pinned?: boolean }>(
	rows: T[],
	enabled: boolean,
): T[] {
	if (!enabled) return [];
	return rows.filter((row) => row.pinned === true);
}

/**
 * The rows left for `Active chats`, `Previous chats` and the flat list.
 *
 * `enabled` is here for a failure the caller cannot see, and it is not
 * cosmetic. The client's row merge is `{...current, ...incoming}` under the rule
 * "an absent key is not a claim", so a row this app pinned optimistically keeps
 * `pinned: true` until a list read settles it - and a capability that withdrew
 * between the press and the read (or a backend that answered a `pinned` flag
 * while advertising no pin store) would leave that flag on a row this function
 * partitioned out. The row would then be drawn NOWHERE: no pin slot to unpin it
 * from, and no section to be absent from either. So when the gate is shut the
 * partition does not run at all and every row is returned, which is what makes
 * the withdrawn render byte-identical to the pre-change one rather than merely
 * similar.
 */
export function unpinnedRows<T extends { pinned?: boolean }>(
	rows: T[],
	enabled: boolean,
): T[] {
	// The SAME array, not a copy: with the gate shut this must be a pass-through
	// that cannot change what the panel draws.
	if (!enabled) return rows;
	return rows.filter((row) => row.pinned !== true);
}
