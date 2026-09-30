/**
 * How the chat sidebar's two regions are laid out: which are visible, how tall
 * the chats list is, which edge the boundary sits on, and whether the boundary
 * may be dragged at all.
 *
 * WHY this is a module of its own rather than conditions inside the component.
 * The same argument `sidebar-catalogue-gate.ts` and `sidebar-focus-hold.ts`
 * beside it already carry: a JSX condition is a decision no test can reach,
 * because `pnpm test:desktop` bundles the shipped TypeScript in memory rather
 * than rendering the component. Everything here is a pure function of numbers,
 * booleans and two persisted values that `localStorage` can hand back tampered,
 * so `scripts/sidebar-split.test.mjs` drives the SHIPPED module rather than a
 * description of it. The docstring's contract, in the form the gate module
 * states it: **this file says the decision is right, the frames say it looks
 * right.**
 *
 * WHO WRITES THE PERSISTED VALUES. Only the store's setters, and only from a
 * control the user pressed. zustand's `persist` rehydrates PAST the setters, so
 * a hand-edited `localStorage` never reaches them - which is why the parsers
 * below take `unknown` and are the only validation that exists, and why the
 * values are validated on READ rather than in the setter.
 *
 * WHAT THIS FILE DOES NOT DECIDE: the geometry of the boundary (which edge,
 * how wide the band is), the pixels of the restore row, and the measurement of
 * the panel. Those are the component's, and the two numbers it must agree with
 * are passed IN - `capacity` and `panelContentHeight` - so the arithmetic here
 * is drivable without a browser.
 *
 * THE ONE NUMBER THAT WOULD BE TEMPTING TO INVENT. There is no stored height
 * until the user drags, and in that state the region is drawn at its CONTENT's
 * height. This module cannot know that, so it never guesses: the caller
 * measures the region and passes it as `drawnListHeight`, and the divider
 * reports that measurement rather than a number this file made up. The same
 * rule covers the auto cap: `listMax` is returned so the component can apply
 * it, and `listHeight: null` is passed through untouched.
 */

import { clampRegion } from "@shared/components/common/resizable-divider-geometry";

export type SidebarRegions = "both" | "entities" | "chats";

/**
 * Which region is drawn first.
 *
 * The header row and the search field stay put; only the two regions trade
 * places, which is what makes "agents at the bottom, chats at the top" one
 * press rather than a drag - and why the follow-up to the split design is this
 * flag rather than drag-and-drop (`docs/design/sidebar-sections.md` S9).
 */
export type SidebarOrder = "entities-first" | "chats-first";

/**
 * A region's floor, in pixels: a heading row (28) plus a row (32) plus the
 * region's own rule and padding (8 + 1) is 69, and 72 is the next value on the
 * 4px ramp (`docs/branding.md` § 5). Both regions take the same floor, so
 * neither can be dragged to a state where its own header is unreachable.
 */
export const SIDEBAR_MIN_REGION_PX = 72;

/**
 * Below `2 * SIDEBAR_MIN_REGION_PX` the split is not OFFERED: the separator
 * reports the height it is drawn at as both its bounds and refuses a write, so
 * a preference the window cannot honour is never destroyed by a gesture the
 * window could not express.
 */
export const SIDEBAR_SPLIT_OFFERED_PX = SIDEBAR_MIN_REGION_PX * 2;

/**
 * The chats list's share of the panel under the AUTO rule (no dragged height).
 *
 * IT WAS 0.45 (the old list pane's `max-h-[45%]`), and it moved with the default
 * below: that fraction was written for a list pane that sat UNDER an agents tree
 * in a second column, where the tree was the pane's main content. In the one
 * sidebar the chats list is the column's main content and the agents + teams
 * section sits above it, so under the old fraction a fresh column gave the tree
 * 55% of the body and the chats 45% - the "agents push the chats down" shape the
 * one-sidebar merge exists to remove (design round 1, D1). 0.6 gives the chats
 * the larger share while the list is long, and the rule is still a CAP over the
 * content's height: a short list draws at its own height and the section above
 * fills the rest. A drag replaces all of this with the user's own number.
 */
export const SIDEBAR_AUTO_MAX_FRACTION = 0.6;

/**
 * The largest height the parser will believe, and it exists so a nonsense
 * value is DISCARDED rather than clamped.
 *
 * Clamping a tampered value would write a number the user never chose and make
 * it indistinguishable from one they did. 4000 is above any window this app
 * can draw (a 5K panel is 2880 CSS px tall), so a value past it is not a
 * preference that lost its window - it is not a preference at all.
 */
export const SIDEBAR_MAX_STORED_PX = 4_000;

/**
 * The regions a column that has never been touched draws: BOTH.
 *
 * The operator's call on the preview (2026-09-24): "make sure that we have
 * visible sections for agent+teams and chats ... but keep the UX of being able
 * to relatively size them in the sidebar". An earlier cut of the one-sidebar
 * merge defaulted this to "chats" (the agents tree behind the `Agents` row's
 * disclosure) so the tree could not push the chats below the fold; the operator
 * rejected hiding the section, so the fold problem is answered by the SPLIT
 * instead - the chats take the larger auto share (`SIDEBAR_AUTO_MAX_FRACTION`),
 * both sections keep a `SIDEBAR_MIN_REGION_PX` floor, and the boundary between
 * them is the draggable, persisted `chatSidebarListHeight`.
 *
 * It is also main's value, so a profile that already stored "both" and one that
 * stored nothing draw the same column.
 */
export const DEFAULT_SIDEBAR_REGIONS: SidebarRegions = "both";
export const DEFAULT_SIDEBAR_ORDER: SidebarOrder = "entities-first";

/** Which single region a restore row is offering to bring back. */
export type SidebarRegionName = "entities" | "chats";

/**
 * The three legal states, or the state that shows everything.
 *
 * `"both"` is the fallback for every value that is not one of the three, and
 * it is the right fallback for the same reason it is the default: a sidebar
 * that cannot read its own preference should look like a sidebar nobody has
 * configured, not like one configured to hide something.
 */
export function parseSidebarRegions(value: unknown): SidebarRegions {
	if (value === "both" || value === "entities" || value === "chats")
		return value;
	return DEFAULT_SIDEBAR_REGIONS;
}

/**
 * The order, or today's order.
 *
 * A tampered value falls back to `"entities-first"` for the reason the region
 * parser falls back to `"both"`: the fallback has to be the state that renders
 * the panel as the user last saw it, not the second guess of the two.
 */
export function parseSidebarOrder(value: unknown): SidebarOrder {
	if (value === "entities-first" || value === "chats-first") return value;
	return DEFAULT_SIDEBAR_ORDER;
}

/**
 * The stored list height, or `null` for "auto".
 *
 * `null` means TODAY'S RULE, not "unset": the region is drawn at its content's
 * height, capped. It is therefore a first-class state rather than a missing
 * value, which is why the parser returns it rather than substituting a number.
 *
 * NON-NUMBERS ARE DISCARDED, NEVER COERCED, and that includes the two that
 * look coercible: `"369"` and `"369px"` are what a hand-edited blob or a
 * previous version of this app might hold, and turning either into 369 would
 * render a height the user never chose from a value the app never wrote.
 */
export function parseSidebarListHeight(value: unknown): number | null {
	if (value === null) return null;
	if (typeof value !== "number") return null;
	if (!Number.isFinite(value)) return null;
	if (value <= 0) return null;
	if (value > SIDEBAR_MAX_STORED_PX) return null;
	return value;
}

/**
 * Hiding a region, from any of the three starting states.
 *
 * THE RESULT DOES NOT DEPEND ON `current`, and that is the whole of the
 * never-both-hidden invariant: "hide this one" is the singleton that hides it,
 * whatever was on screen a moment before. A consequence worth stating because
 * it is the case a user will meet: pressing "hide the chats list" while the
 * chats list is ALREADY hidden does the only sensible thing left - it shows
 * the region it was going to hide, i.e. it shows the entities - rather than
 * refusing, and the panel never reaches a state with no regions in it.
 *
 * The rejected alternative is two booleans, which have a fourth state meaning
 * "an empty column with a title, a search box and two restore rows". A state
 * that can be persisted is a state somebody will reach, so it is made
 * unrepresentable here rather than guarded against at the call site - the same
 * shape the store uses for its right slot (`ui-preferences-store.ts`).
 */
export function hideRegion(
	current: SidebarRegions,
	region: SidebarRegionName,
): SidebarRegions {
	// `current` is read for the invariant only: the answer is the singleton
	// that hides `region`, which is already one of the three legal states and
	// never "both" - so no reachable press can leave the panel empty.
	void current;
	return region === "entities" ? "chats" : "entities";
}

/** What a stored region state draws. */
export function regionVisibility(regions: SidebarRegions): {
	entityVisible: boolean;
	listVisible: boolean;
} {
	return {
		entityVisible: regions !== "chats",
		listVisible: regions !== "entities",
	};
}

/**
 * The cap the AUTO rule puts on the list region.
 *
 * Two terms, and the smaller wins. The first is `SIDEBAR_AUTO_MAX_FRACTION`, applied
 * to the PANEL'S OWN content box rather than to this region's container: those
 * are the same box in the shipped layout and not the same box once the two
 * regions live in a container of their own (the container is a fraction of a
 * panel shorter than the panel, and the cap would silently move by tens of px at a
 * 900px window - a change nobody asked for, on the arrangement this change is
 * required to leave alone). The second is the split's own floor: the list can
 * never be tall enough to squeeze the entity region below `SIDEBAR_MIN_REGION_PX`.
 */
export function autoRegionCap(
	panelContentHeight: number,
	capacity: number,
): number {
	return Math.max(
		0,
		Math.min(
			SIDEBAR_AUTO_MAX_FRACTION * panelContentHeight,
			capacity - SIDEBAR_MIN_REGION_PX,
		),
	);
}

export type SidebarSplitInput = {
	/** persisted, unvalidated: `localStorage` is not the setter's path out. */
	regions: unknown;
	listHeight: unknown;
	order: unknown;
	/** the catalogue gate's own output: with no catalogue there is no split. */
	showList: boolean;
	/** a query is active. It overrides the collapse and writes nothing. */
	query: boolean;
	/**
	 * The measured height of the box the two regions SHARE, px.
	 *
	 * Not the split container's own height: the boundary and the pin-failure line
	 * are flex children of that container too, and every number below is a claim
	 * about what the REGIONS get. Handing this the whole container is how the
	 * 72px floor was really 64px - the boundary's own 8px `mt-2` came out of the
	 * other region's 72 - so the caller measures the container and subtracts the
	 * children that are not regions (design round 1's D5, the architecture pass's
	 * m-1 and UX round 1's U3 were one defect seen three times).
	 */
	capacity: number;
	/** the list region's measured border-box height, px. `0` before it is known. */
	drawnListHeight: number;
	/**
	 * The panel's own content-box height, px: the box the shipped
	 * `max-h-[60%]` resolves against, and therefore the box `autoRegionCap`
	 * has to measure the fraction against too. `0` before it is known.
	 */
	panelContentHeight: number;
};

export type SidebarSplit = {
	/** What the stored state SAYS, echoed unchanged even when it is overridden. */
	regions: SidebarRegions;
	order: SidebarOrder;
	entityVisible: boolean;
	listVisible: boolean;
	/** Which edge of the LIST region the boundary sits on (S1's sign table). */
	side: "top" | "bottom";
	/** `null` means the auto rule, applied by the component (`max-h-[60%]`). */
	listHeight: number | null;
	/**
	 * The list region's inline max-height, px, or `null` for "no inline cap".
	 *
	 * `null` has two causes and both are the shipped layout rather than a
	 * missing measurement: the panel has not been measured yet (one frame, before
	 * the layout effect runs), or the list region is ALONE in the column - where
	 * it fills rather than being sized, and a cap left on it would draw a region
	 * at `SIDEBAR_AUTO_MAX_FRACTION` (0.6, not the 0.45 this sentence carried until
	 * agent review round 1's R7: the constant moved in this PR and two sibling
	 * references moved with it, leaving this one describing the opposite of the
	 * code it explains) of the panel with a third of the column empty under it.
	 * That second cause was a real defect in the first cut of this change, found by
	 * looking at the `chats-only` frame rather than by a test: the cap and the
	 * `flex-1` disagreed and the cap won.
	 */
	listMax: number | null;
	/**
	 * Whether the list region is drawn as a DEFINITE box of `listMax`.
	 *
	 * True only when the user has chosen a height and the split is on screen: a
	 * stored number is a box the user set, while the auto rule is a cap over
	 * whatever the content wants. A region alone in the column is neither - it is
	 * `flex-1` and fills.
	 */
	listFixed: boolean;
	/** which region's restore row renders, if any. */
	restore: SidebarRegionName | null;
	/** `null` when there is no boundary: one region is hidden, or the gate is shut. */
	divider: null | {
		value: number;
		min: number;
		max: number;
		resizable: boolean;
	};
};

/**
 * The split, from the persisted state and the panel's own measurements.
 *
 * ORDER OF PRECEDENCE, which is the part a reviewer should read first:
 * the catalogue gate is checked before the query, because with no catalogue
 * there are no rows for a query to find; the query is checked before the
 * stored collapse, because a search that promises to look in agents and then
 * cannot is the claim the field's own placeholder refuses (`chat-sidebar.tsx`'s
 * `heading()` applies the same rule to the per-section disclosures, and
 * `Search chats and agents` is only true while both regions render).
 *
 * Neither override is written back: the persisted value is echoed in `regions`
 * and `listHeight`, so clearing the query restores exactly the state the user
 * chose.
 */
export function resolveSidebarSplit({
	regions,
	listHeight,
	order,
	showList,
	query,
	capacity,
	drawnListHeight,
	panelContentHeight,
}: SidebarSplitInput): SidebarSplit {
	const stored = parseSidebarRegions(regions);
	const storedHeight = parseSidebarListHeight(listHeight);
	const storedOrder = parseSidebarOrder(order);
	const side: "top" | "bottom" =
		storedOrder === "entities-first" ? "top" : "bottom";

	/*
	 * The gate first: no catalogue means no regions to split, and the shipped
	 * withdrawn-gate DOM must gain no boundary. The region state is still
	 * echoed, because it is still what the user chose and the gate is not
	 * theirs.
	 */
	if (!showList) {
		return {
			regions: stored,
			order: storedOrder,
			entityVisible: true,
			listVisible: true,
			side,
			listHeight: storedHeight,
			listMax: null,
			listFixed: false,
			restore: null,
			divider: null,
		};
	}

	/*
	 * A query renders both regions and leaves the stored state alone. The
	 * override is what keeps the search field honest: with the entity region
	 * collapsed, `Search chats and agents` would otherwise be a promise the
	 * panel cannot keep, and a search that quietly stops looking inside agents
	 * is indistinguishable from one that found none.
	 */
	const effective: SidebarRegions = query ? "both" : stored;
	const { entityVisible, listVisible } = regionVisibility(effective);
	const restore: SidebarRegionName | null = query
		? null
		: !listVisible
			? "chats"
			: !entityVisible
				? "entities"
				: null;

	/*
	 * The live bounds. `max` is the capacity the layout can actually give the
	 * sized region, and it is `Math.max(SIDEBAR_MIN_REGION_PX, ...)` so a
	 * panel too short to host both floors cannot produce a range whose maximum
	 * is below its minimum - the separator would then announce an impossible
	 * range, which is the defect the collapsed range exists to avoid.
	 */
	const liveMax = Math.max(
		SIDEBAR_MIN_REGION_PX,
		capacity - SIDEBAR_MIN_REGION_PX,
	);
	const resizable = capacity >= SIDEBAR_SPLIT_OFFERED_PX;
	const rawValue = storedHeight ?? drawnListHeight;
	const value = clampRegion(
		Number.isFinite(rawValue) ? rawValue : SIDEBAR_MIN_REGION_PX,
		SIDEBAR_MIN_REGION_PX,
		liveMax,
	);

	/*
	 * TWO CAPS, and the render applies exactly one of them:
	 *   - auto: the fraction the shipped class carried, plus the split's floor;
	 *   - a stored height: the stored number, clamped to what this panel can
	 *     give it - and the stored value itself is never rewritten, so a window
	 *     that can honour it renders it again (S2's "the render clamps").
	 * With the panel unmeasured both are `null`, which leaves the shipped class
	 * in charge for the frame before the measurement lands. A region ALONE in
	 * the column has neither cap: it fills, and a stored height waits for the
	 * split to come back rather than shrinking it.
	 */
	const solo = !entityVisible;
	const measured = capacity > 0 && panelContentHeight > 0;
	const listMax =
		solo || !measured
			? null
			: storedHeight === null
				? autoRegionCap(panelContentHeight, capacity)
				: value;
	/*
	 * WHAT THE SEPARATOR ANNOUNCES, which is not always what a drag would write.
	 *
	 * When the range is live the announced value IS the height the region is
	 * drawn at: a stored height is a box, and the auto rule's number is the cap
	 * the render applies. When the range is collapsed (`resizable` false) the
	 * announced number must still be the drawn one, or the contract this module
	 * exists for - "the separator reports the height it is drawn at" - is broken
	 * exactly where it is hardest to check. In AUTO that means the SMALLER of the
	 * drawn height and the cap: at capacity 100 the cap is 28 and the region is
	 * drawn at 28 while `value` (the clamp of the drawn height to `[72, 72]`) is
	 * 72, so announcing `value` promises 44px the layout does not have (review
	 * round 1, m-3, probed at 100/140/143).
	 */
	const announced =
		resizable || !measured || storedHeight !== null
			? value
			: Math.min(drawnListHeight, listMax ?? drawnListHeight);

	return {
		regions: stored,
		order: storedOrder,
		entityVisible,
		listVisible,
		side,
		listHeight: storedHeight,
		listMax,
		listFixed: listMax !== null && storedHeight !== null,
		restore,
		divider: entityVisible
			? listVisible
				? resizable
					? { value, min: SIDEBAR_MIN_REGION_PX, max: liveMax, resizable: true }
					: // The range collapses onto what is DRAWN and a write is
						// refused, so a preference the window cannot host survives
						// for one that can (`chat-content.tsx`'s `runPanelResizable`).
						{
							value: announced,
							min: announced,
							max: announced,
							resizable: false,
						}
				: null
			: null,
	};
}

/*
 * Re-exported, and the reason is that this module is the sidebar's whole
 * surface for the split. The axis arithmetic is ONE rule with two consumers
 * (the vertical panes and this boundary), it lives beside the component that
 * implements it so the dependency runs component -> feature rather than the
 * other way round, and a caller - or `scripts/sidebar-split.test.mjs`, which
 * drives these against the same clamps this file computes - should not have to
 * know which of the two files a given function landed in. The design places
 * `growSign` in this module's API for the same reason it says "shared with the
 * divider".
 */
export {
	clampRegion,
	dragTarget,
	growSign,
	keyboardTarget,
} from "@shared/components/common/resizable-divider-geometry";
export type {
	DividerSide,
	KeyboardTargetInput,
} from "@shared/components/common/resizable-divider-geometry";
