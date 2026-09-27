/**
 * The identity menu as VALUES: how the rows a catalogue answered with fall into
 * bands, what each band's heading says, and what the panel says about a list
 * that does not fit.
 *
 * WHY THIS IS ITS OWN MODULE, the same reason `chat-header-identity-model.ts` is:
 * the three rules below are the change's behavioural claim - the bound, the
 * recents band and the search's effect on it - and each is the kind of rule a
 * JSX edit breaks while every frame still "looks fine". A menu that quietly
 * dropped the 151st agent, or grew an empty "Recent agents" heading on a fresh
 * install, renders cleanly; as plain functions they are pinned by
 * `scripts/header-identity-menu.test.mjs` without a DOM, and the component only
 * maps the answers onto pixels.
 *
 * THE BOUND AND THE SEARCH ARE TWO ANSWERS TO ONE PROBLEM, and the division of
 * labour between them is the whole design:
 *
 * - the bound (`IDENTITY_MENU_MAX_HEIGHT`) is a SCROLL VIEWPORT, never a slice.
 *   Every row the catalogue answered with is in the DOM and reachable - by
 *   scrolling inside the bound, and by typing in the field. Nothing here caps
 *   the list, so there is no such thing as an item this menu cannot reach; a
 *   150-agent roster renders 150 rows inside a panel that never exceeds the
 *   window.
 * - the search is what makes a bounded list cheap rather than merely complete.
 *   Type three characters and the list is usually shorter than the bound, so
 *   the scroll stops being the way anyone navigates.
 * - the recents band is the third answer to the same problem, and it is the one
 *   that lives BETWEEN them: for the five profiles you actually switch between,
 *   neither scrolling nor typing is needed. It is a repeat of rows the "all"
 *   band also holds, never a filter of it - which is what keeps the band a
 *   shortcut rather than a way to hide something.
 *
 * The footer line is the honest half of the bound: a list that is cut by the
 * viewport must say so, or a scrollbar is the only evidence that rows exist
 * below the fold.
 */

import type { ProfileRecencyKind } from "../../../shared/store/ui-preferences-store";
import type { PickerOption } from "../pickers/picker-host";

/**
 * The panel's own ceiling, in CSS px - 22rem.
 *
 * An absolute length rather than a viewport fraction: the panel is anchored to a
 * 20px line near the top of a chat header, and what it must not do is run off the
 * window - `60vh` is most of a short window and a fifth of a tall one, which is
 * the same number meaning two different things. The arithmetic behind 352: the
 * panel's own padding (8px), the search row (40px - the app's 32px field plus 8
 * of padding), the footer line (29px) and the heading above the first band (28px,
 * when a band starts there) leave ~247px of rows. That is five of the app's
 * two-line picker rows (`PickerRow`: a label and a description, ~48px) or seven
 * one-line ones - enough of a 150-name roster to recognise where you are, not
 * enough to cover the conversation the menu is anchored to.
 *
 * It is a CEILING and not the bound: `IDENTITY_MENU_MAX_HEIGHT_CLASS` takes the
 * smaller of this and the space Radix found around the anchor, which is what
 * makes a menu opened near the bottom of the window shrink and scroll instead of
 * overflowing off-screen.
 */
export const IDENTITY_MENU_MAX_HEIGHT = 352;

/**
 * The class that applies the bound, as one string so the panel and its sibling
 * `max-h` cannot drift apart.
 *
 * `--radix-popover-content-available-height` is set by Radix's popper on the
 * content element (`avoidCollisions` defaults on) and is the height it computed
 * for a panel anchored where this one is - the same variable
 * `directory-indicator.tsx` already consumes for the composer's directory menu,
 * one Radix family over (`--radix-dropdown-menu-content-available-height`).
 * `min()` of the two is the whole rule: the panel is capped at the design's
 * height when there is room, and at the room that exists when there is not.
 */
export const IDENTITY_MENU_MAX_HEIGHT_CLASS =
	"max-h-[min(22rem,var(--radix-popover-content-available-height))]";

/** A band of rows under one heading. */
export type IdentityMenuBand = {
	/**
	 * `null` renders NO heading, which is the single-band case: a heading exists
	 * to say where one band ends and the next begins, so one band has nothing to
	 * say it with. This is what keeps a fresh install from growing an empty
	 * "Recent agents" line above the only list there is.
	 */
	heading: string | null;
	rows: PickerOption[];
};

export type IdentityMenuView = {
	bands: IdentityMenuBand[];
	/** Rows across every band, i.e. what the filter left of `total`. */
	matches: number;
	/** Rows the catalogue answered with, before the filter. */
	total: number;
	/** The query was non-empty and matched nothing. */
	noMatches: boolean;
};

/**
 * The two headings, per menu, in sentence case and plural - the rosters they
 * name are plurally titled in the app's own pickers ("No teams are registered",
 * "No profiles found").
 */
export function identityMenuHeadings(kind: ProfileRecencyKind): {
	recents: string;
	all: string;
} {
	return kind === "team"
		? { recents: "Recent teams", all: "All teams" }
		: { recents: "Recent agents", all: "All agents" };
}

/**
 * The bands, in render order.
 *
 * `rows` is the whole catalogue (unfiltered) and `matches` is the same list after
 * this picker's own filter, because two different questions are asked of it: the
 * recents band must resolve a remembered NAME against every row the catalogue
 * holds (`matches` would drop a recent the current query happens not to match),
 * while the "all" band must show what the filter left. The caller computes
 * `matches` with the app's one picker filter (`filterPickerOptions`), so this
 * function never states a second search rule - it only decides which band a row
 * lands in.
 *
 * THREE CASES, and each is a state the operator named:
 *
 * - a query is active: ONE band, no heading. The bands are a browsing
 *   affordance, and a search is not browsing - showing "Recent teams" above a
 *   filtered result would claim the matches are recent when they are merely
 *   matches, and would list a remembered row twice in a list the user narrowed
 *   to find one thing.
 * - no query, no recents (a fresh install, or a roster nobody has switched
 *   from): ONE band, no heading. This is the state that must not grow an empty
 *   band: there is nothing to separate, so nothing is said.
 * - no query, recents present: two bands, both headed, the remembered rows
 *   first. The recents band is deliberately a REPEAT - every remembered row is
 *   also in the "all" band, at its catalogue position - because the bands answer
 *   different questions ("what do I switch between" / "what exists") and a
 *   picker that hid a row from "all" to avoid repeating it would be the
 *   truncation this whole change is against.
 *
 * A remembered name the catalogue no longer offers is dropped rather than
 * rendered: the row a switch would send does not exist, so a row for it would be
 * an action that cannot succeed.
 */
export function identityMenuBands(input: {
	rows: PickerOption[];
	matches: PickerOption[];
	recents: readonly string[];
	kind: ProfileRecencyKind;
	query: string;
}): IdentityMenuView {
	const { rows, matches, recents, kind, query } = input;
	const headings = identityMenuHeadings(kind);
	const total = rows.length;
	const noMatches = query.trim() !== "" && matches.length === 0;

	if (query.trim() !== "") {
		return {
			bands: [{ heading: null, rows: matches }],
			matches: matches.length,
			total,
			noMatches,
		};
	}

	const remembered = recents
		.map((name) => rows.find((row) => row.value === name))
		.filter((row): row is PickerOption => row !== undefined);

	if (remembered.length === 0) {
		return {
			bands: [{ heading: null, rows }],
			matches: matches.length,
			total,
			noMatches,
		};
	}

	return {
		bands: [
			{ heading: headings.recents, rows: remembered },
			{ heading: headings.all, rows },
		],
		matches: matches.length,
		total,
		noMatches,
	};
}

/**
 * What the panel's footer says, or `null` for a list that fits.
 *
 * It is shown when there is something to say: the list overflows the bound
 * (`overflowing`, measured from the elements - content height against the
 * scroller's box, the rule `command-palette.tsx` states for its own fold), or a
 * filter is active and the count is the answer to the query the user just typed.
 *
 * The counts are exact and are the ROWS, not the profiles: a recents band repeats
 * rows, so summing the bands would say "8 agents" about five agents. "agents in
 * all" reads as the roster's size, which is the claim the footer is making.
 */
export function identityMenuFooter(input: {
	view: IdentityMenuView;
	kind: ProfileRecencyKind;
	query: string;
	overflowing: boolean;
}): string | null {
	const { view, kind, query, overflowing } = input;
	const noun = kind === "team" ? "teams" : "agents";
	const typed = query.trim();

	if (typed !== "") {
		if (view.matches === 0) return null;
		return view.matches === view.total
			? `${view.total} ${noun} match`
			: `${view.matches} of ${view.total} ${noun} match`;
	}
	if (!overflowing) return null;
	return `${view.total} ${noun} in all — scroll, or type to filter`;
}
