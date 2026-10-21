/**
 * The sidebar destination rail's arrangement: one ordered list, cut at one fold.
 *
 * WHAT THIS MODULE IS, and what it deliberately is not. It is the pure model
 * behind customising the left column's destination rows (design contract
 * `docs/design/sidebar-customisation.md` § 1-§ 3): the nine stable ids, the
 * two-region layout they live in, the default arrangement, and the operations a
 * drag or the row menu performs on that layout. It imports nothing from React
 * and reads no state, so the same functions are exercised by
 * `scripts/sidebar-destinations.test.mjs` against the SHIPPED module and used by
 * the component - there is no test-only copy of the rules to drift.
 *
 * WHY ONE LIST AND A FOLD, not two independent containers. `visible ++ more` is
 * the single order the drag operates on. The boundary is `visible.length`, and
 * "Move to More" is an append across it rather than a move between arrays. Two
 * containers would need every operation to answer what "adjacent" means at the
 * seam; one list makes adjacency total, and the fold an index.
 *
 * WHY THE IDS COME FROM THE WIRE CONTRACT. A destination's id is the stable
 * spelling used in the request body and the stored file (`src/shared/
 * desktop-control-contract.ts`). Re-declaring the nine strings here would be a
 * second spelling of the allow-list the route validates against; a rename on
 * one side would then be a preference the other silently drops. The tuple is
 * re-exported so call sites keep importing the model rather than the DTO, and
 * the type predicate below narrows arbitrary input to it.
 *
 * UNAVAILABLE IDS KEEP THEIR STORED SLOT. A capability gate (Aida disabled,
 * Library below the backend version, not in a mesh, Team Bridge ineligible)
 * removes a row from the RENDER, never from the stored order: the preference
 * has to survive an app or backend update that temporarily hides a destination.
 * Every render-facing function therefore takes the set of ids that are
 * currently available and filters, rather than the layout being rewritten to
 * match today's capabilities. The move operations skip unavailable rows instead
 * of stepping over their stored positions.
 */
import {
	type DesktopSidebarLayout,
	SIDEBAR_DESTINATION_IDS,
	type SidebarDestinationId,
} from "../../../../../shared/desktop-control-contract";

/*
 * Re-exported rather than redeclared: call sites and the node:test harness
 * import the model, not the DTO file, and there must be one spelling of the
 * nine ids in the client. `SIDEBAR_DESTINATION_IDS` is the READONLY tuple in
 * default order, not a copy - a caller that sorted it would be sorting the wire
 * vocabulary.
 */
export { SIDEBAR_DESTINATION_IDS };
export type { SidebarDestinationId };

/** The two sides of the fold. `More` itself is not a region member. */
export type SidebarRegion = "visible" | "more";

/**
 * One stored arrangement. Both arrays together hold every known id exactly
 * once; `visible ++ more` is the render order.
 */
export type SidebarLayout = DesktopSidebarLayout;

/**
 * The default region of each destination, i.e. today's arrangement.
 *
 * Kept as a map rather than two literals so the default layout below is DERIVED
 * from the wire order instead of restating it. A destination's default region
 * is also the region it is re-inserted into when it is missing from a stored
 * layout - see `sanitizeSidebarLayout`.
 */
const DEFAULT_REGION_BY_ID: Record<SidebarDestinationId, SidebarRegion> = {
	aida: "visible",
	library: "visible",
	projects: "visible",
	agents: "visible",
	schedules: "visible",
	browser: "visible",
	"team-bridge": "more",
	"agent-hub": "more",
	mesh: "more",
};

/**
 * The default arrangement: Aida, Library, Projects, Agents, Schedules, Browser
 * visible, then Team Bridge, Agent Hub and Mesh folded into More.
 *
 * DERIVED from `SIDEBAR_DESTINATION_IDS` and `DEFAULT_REGION_BY_ID`, so the
 * default order and the id vocabulary are one fact. Treat it as immutable:
 * `sanitizeSidebarLayout` always returns fresh arrays, and every operation here
 * returns a new object, precisely so this constant can be handed out as a
 * fallback (the failed-read path returns it) without a caller's splice editing
 * every future layout.
 */
export const DEFAULT_SIDEBAR_LAYOUT: SidebarLayout = {
	visible: SIDEBAR_DESTINATION_IDS.filter(
		(id) => DEFAULT_REGION_BY_ID[id] === "visible",
	),
	more: SIDEBAR_DESTINATION_IDS.filter(
		(id) => DEFAULT_REGION_BY_ID[id] === "more",
	),
};

/** Default rank of an id in the wire order; the anchor for re-insertion. */
const DEFAULT_RANK_BY_ID: ReadonlyMap<SidebarDestinationId, number> = new Map(
	SIDEBAR_DESTINATION_IDS.map((id, index) => [id, index]),
);

const KNOWN_IDS: ReadonlySet<string> = new Set(SIDEBAR_DESTINATION_IDS);

/**
 * Whether `value` is one of the nine destination ids.
 *
 * A predicate rather than a throw or a cast because the input is the STORE's
 * content: an older file, a hand-edited preference or a future id this build
 * does not know all arrive here as `unknown`, and the sanitiser's job is to
 * answer them, not to crash a sidebar.
 */
export function isSidebarDestinationId(
	value: unknown,
): value is SidebarDestinationId {
	return typeof value === "string" && KNOWN_IDS.has(value);
}

/** Structural equality, ORDER INCLUDED. */
export function layoutEquals(a: SidebarLayout, b: SidebarLayout): boolean {
	if (a === b) return true;
	if (a.visible.length !== b.visible.length) return false;
	if (a.more.length !== b.more.length) return false;
	for (let index = 0; index < a.visible.length; index += 1) {
		if (a.visible[index] !== b.visible[index]) return false;
	}
	for (let index = 0; index < a.more.length; index += 1) {
		if (a.more[index] !== b.more[index]) return false;
	}
	return true;
}

/**
 * The region an id is stored in.
 *
 * An id stored in NEITHER region answers `"more"`. That is impossible for a
 * layout this module produced, but the function exists to be called on layouts
 * that crossed the store, and the fail-closed answer is the fold: claiming a
 * misplaced id is visible would render a row the stored preference does not
 * place there, while "more" at worst hides it behind the disclosure - the same
 * direction the whole feature fails in.
 */
export function regionOf(
	layout: SidebarLayout,
	id: SidebarDestinationId,
): SidebarRegion {
	return layout.visible.includes(id) ? "visible" : "more";
}

/**
 * The ids of one region that are currently available, in stored order.
 *
 * The rendered rail is `renderedRegion(visible)` followed by the More row and,
 * when open, `renderedRegion(more)`. Unavailable ids are filtered here once,
 * rather than the layout being rewritten to match a moment's capabilities.
 */
export function renderedRegion(
	layout: SidebarLayout,
	region: SidebarRegion,
	available: ReadonlySet<SidebarDestinationId>,
): SidebarDestinationId[] {
	return layout[region].filter((id) => available.has(id));
}

/**
 * Move an available id one RENDERED position up or down inside its own region.
 *
 * The move is expressed against the rendered order, so the unavailable rows
 * between two rendered neighbours stay exactly where they are stored: the id
 * and its neighbour SWAP stored positions, and everything between them keeps
 * its slot. Removing and re-inserting would instead shift the unavailable rows
 * one way and the neighbour the other, which is the silent reordering of a
 * preference the user cannot even see.
 *
 * Answers `null` when the move cannot happen - at the region's rendered
 * boundary, when the id is not available, or when it is stored in neither
 * region. A caller reads `null` as "this menu item is disabled" rather than as
 * an error, which is why a boundary and an invalid row share one answer.
 */
export function moveWithinRegion(
	layout: SidebarLayout,
	id: SidebarDestinationId,
	delta: -1 | 1,
	available: ReadonlySet<SidebarDestinationId>,
): SidebarLayout | null {
	if (!available.has(id)) return null;
	const region = regionOf(layout, id);
	const rendered = renderedRegion(layout, region, available);
	const position = rendered.indexOf(id);
	if (position < 0) return null;
	const target = position + delta;
	if (target < 0 || target >= rendered.length) return null;
	const neighbour = rendered[target];
	const stored = layout[region];
	const from = stored.indexOf(id);
	const to = stored.indexOf(neighbour);
	if (from < 0 || to < 0) return null;
	const next = stored.slice();
	next[from] = neighbour;
	next[to] = id;
	/*
	 * BOTH regions are copied, not spread: `{ ...layout }` would return the
	 * OTHER region by reference, and a caller that reordered the visible list
	 * would then hold a layout whose `more` array IS `DEFAULT_SIDEBAR_LAYOUT.more`
	 * (or the previous cache entry's). One accidental splice there would edit a
	 * document nobody asked this operation to touch.
	 */
	const result: SidebarLayout = {
		visible: layout.visible.slice(),
		more: layout.more.slice(),
	};
	result[region] = next;
	return result;
}

/**
 * Move an id to the end of `region` - the "Move to More" / "Show in sidebar"
 * command path.
 *
 * Appending, not inserting beside a neighbour: the design contract says the
 * command puts the row at the end of the target region, which is where the
 * user's eye lands when the fold opens. A caller compares the result with the
 * starting layout (`layoutEquals`) and writes nothing when the row was already
 * at the end, so the no-op drop rule holds for the menu too.
 */
export function moveToRegion(
	layout: SidebarLayout,
	id: SidebarDestinationId,
	region: SidebarRegion,
): SidebarLayout {
	const without: SidebarLayout = {
		visible: layout.visible.filter((entry) => entry !== id),
		more: layout.more.filter((entry) => entry !== id),
	};
	return { ...without, [region]: [...without[region], id] };
}

/**
 * Place an id at a chosen insertion point inside `region`, or `null` when the
 * point cannot be honoured.
 *
 * `beforeId` is the rendered row the pointer's indicator sits above; `null`
 * means the end of the region (a drop on the More row, or on the trailing
 * "Move to More" band). `available` validates that the insertion point is a row
 * the user could actually see: an unavailable id is never drawn, so a caller
 * naming one has crossed wires with a stale rendered list, and inventing a
 * position from it would place the row somewhere nobody pointed at.
 *
 * Only the insertion POINT is validated; the moved id is the caller's own row.
 * Dropping an id before itself is a no-op returning an equal layout (the
 * caller's `layoutEquals` check then writes nothing), rather than `null` - it
 * is a real gesture with no change, not an invalid one.
 */
export function placeInRegion(
	layout: SidebarLayout,
	id: SidebarDestinationId,
	region: SidebarRegion,
	beforeId: SidebarDestinationId | null,
	available: ReadonlySet<SidebarDestinationId>,
): SidebarLayout | null {
	if (beforeId === id) {
		return {
			visible: layout.visible.slice(),
			more: layout.more.slice(),
		};
	}
	if (beforeId !== null) {
		if (!available.has(beforeId)) return null;
		if (!layout[region].includes(beforeId)) return null;
	}
	const without: SidebarLayout = {
		visible: layout.visible.filter((entry) => entry !== id),
		more: layout.more.filter((entry) => entry !== id),
	};
	const next = without[region].slice();
	const at = beforeId === null ? next.length : next.indexOf(beforeId);
	if (at < 0) return null;
	next.splice(at, 0, id);
	return { ...without, [region]: next };
}

/**
 * Re-insert the ids missing from `region` at their default position relative to
 * the ids that remain in it.
 *
 * The search is by DEFAULT RANK among the region's current ids: after the
 * closest default predecessor when one remains, else before the closest default
 * successor, else at the end. That "closest remaining neighbour" rule is what
 * makes a partially known layout predictable - a stored custom order is left
 * alone except for the gap the missing id fills.
 *
 * WHY THE REGION IS THE ID'S DEFAULT REGION rather than the anchor's. This runs
 * on the read path (a corrupt file, an older store, a layout written by a build
 * that knew fewer ids). If a destination is absent entirely, the honest answer
 * is where it would have been before anyone customised anything; inheriting the
 * anchor's region would instead let one missing id's absence move the fold for
 * a different one. The all-missing case - an empty document - therefore reduces
 * to exactly `DEFAULT_SIDEBAR_LAYOUT`.
 *
 * Mutates `layout` in place; private to the sanitiser, which owns the object it
 * passes in.
 */
function insertMissingIntoRegion(
	layout: SidebarLayout,
	region: SidebarRegion,
): void {
	for (const id of SIDEBAR_DESTINATION_IDS) {
		if (DEFAULT_REGION_BY_ID[id] !== region) continue;
		if (layout.visible.includes(id) || layout.more.includes(id)) continue;
		const rank = DEFAULT_RANK_BY_ID.get(id) ?? 0;
		const list = layout[region];
		let insertAfter = -1;
		let predecessorRank = -1;
		let insertBefore = -1;
		let successorRank = Number.POSITIVE_INFINITY;
		for (let index = 0; index < list.length; index += 1) {
			const otherRank = DEFAULT_RANK_BY_ID.get(list[index]) ?? 0;
			if (otherRank < rank && otherRank > predecessorRank) {
				predecessorRank = otherRank;
				insertAfter = index;
			}
			if (otherRank > rank && otherRank < successorRank) {
				successorRank = otherRank;
				insertBefore = index;
			}
		}
		const at =
			insertAfter >= 0
				? insertAfter + 1
				: insertBefore >= 0
					? insertBefore
					: list.length;
		list.splice(at, 0, id);
	}
}

/**
 * Normalise whatever the store (or a caller's fixture) holds into a layout this
 * module guarantees: all nine ids, exactly once, in a stable order.
 *
 * The rules, and why each exists:
 *
 * - Unknown ids are dropped. A layout written by a newer build can name a
 *   destination this build cannot render, and keeping it would make every
 *   index and count in the renderer account for a row nobody can see.
 * - Duplicates are impossible: the FIRST occurrence wins, across the whole
 *   combined order (visible before more). A corrupted file that repeats an id
 *   must not draw the same row twice, and first-wins is the only rule that
 *   leaves the user's earlier arrangement intact.
 * - Missing ids are re-inserted by `insertMissingIntoRegion`, in the region
 *   they default to. This is the merge that lets a preference survive a
 *   capability gate or an older store.
 *
 * Always returns a NEW object with NEW arrays, even for an input that was
 * already valid: the result goes into a React Query cache entry, and handing
 * back the stored object would let a later operation mutate a shared document.
 */
export function sanitizeSidebarLayout(value: unknown): SidebarLayout {
	const layout: SidebarLayout = { visible: [], more: [] };
	const seen = new Set<SidebarDestinationId>();
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		for (const region of ["visible", "more"] as const) {
			const list = record[region];
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				if (!isSidebarDestinationId(entry)) continue;
				if (seen.has(entry)) continue;
				seen.add(entry);
				layout[region].push(entry);
			}
		}
	}
	insertMissingIntoRegion(layout, "visible");
	insertMissingIntoRegion(layout, "more");
	return layout;
}
