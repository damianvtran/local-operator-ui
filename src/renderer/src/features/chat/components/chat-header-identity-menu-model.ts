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
 * Whether the panel is showing its LIST.
 *
 * The panel's other branch is the three non-list states (loading, refused, an
 * empty roster), and both of the things that ask about the listbox use THIS
 * answer: the panel's own render gate, and the two `aria-controls` references
 * (the control's and the field's), which may name the list only while it
 * exists - a dangling `aria-controls` points a screen reader at nothing (UX
 * round 1, U4). One function rather than two conditions, so the reference and
 * the box it names cannot drift.
 */
export function identityMenuShowsList(input: {
	loading: boolean;
	loadError: string | null;
	rowCount: number;
}): boolean {
	return !input.loading && input.loadError === null && input.rowCount > 0;
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
 * FOUR CASES, and each is a state the operator named:
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
 * - no query, and the ring covers the WHOLE catalogue - the operator's own team
 *   roster shape (two teams, both remembered): ONE band, no heading, the list
 *   in catalogue order. Every row the band would hold is the entire list
 *   already, so the band adds nothing a reader cannot see one line below; two
 *   headings over a verbatim repeat is what "two groups" degrades into
 *   (design round 1, D1). A ring that leaves even one row out is the third
 *   case and keeps its band.
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
		.filter((row): row is PickerOption => row !== undefined)
		/*
		 * THE RECENTS BAND IS A SHORTCUT, NOT THE ROSTER (review round 1, U6).
		 * A remembered row the team's rule refuses is dropped HERE, and only
		 * here: All agents keeps every row with its reason on it, because the
		 * roster's completeness is the contract there. The band's own contract is
		 * one-pick speed, and on a team-led chat the ring is full of leaves, so
		 * unfiltered the band is a wall of refusals the user must read past to
		 * reach anything - the measured `recents-agent-open` frame, where every
		 * band row was refused and `coder` appeared twice. Collapsing the band
		 * entirely when nothing settable remains (the empty case below) is the
		 * same judgment: an empty `Recent agents` heading reads as a fault.
		 */
		.filter((row) => !row.disabled);

	if (remembered.length === 0 || remembered.length === rows.length) {
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
 * Where the highlight starts, and where a filter re-places it (review round 1,
 * D2/U1).
 *
 * `picker-host` seeds row zero and walks from there; on this panel row zero is
 * routinely a row the team's rule refuses, so the panel opened on the one row
 * Enter cannot act on - and a filter keystroke re-placed it there again ("type
 * rev, one refused hit, Enter does nothing"). The rule here: the CURRENT row
 * when it is settable (the identity is where the eye already is), else the
 * first settable row, and only when NOTHING settable exists does the highlight
 * fall back to the top - which is exactly when the footer carries the way out
 * (see `identityMenuFooter`).
 */
export function identityMenuSeedActive(rows: readonly PickerOption[]): number {
	const current = rows.findIndex((row) => row.current && !row.disabled);
	if (current !== -1) return current;
	const settable = rows.findIndex((row) => !row.disabled);
	return settable === -1 ? 0 : settable;
}

/**
 * What the panel SAYS when Enter lands on a row the rule refuses (review
 * round 1, D2/U1). The sentence is deliberately short: the row's own reason is
 * already in its accessible name (the description slot), and the way out is
 * the footer's sentence whenever no settable row is in view - so the
 * announcement adds the one fact neither of those carries, that the refusal
 * just happened to a specific row.
 */
export function identityMenuRefusalAnnouncement(label: string): string {
	return `${label} cannot take the seat.`;
}

/*
 * The footer's two resolutions, for a list where nothing is settable (review
 * round 1, D1). Candidates for the design round's copy pass, like the caption:
 * what must survive review is that each sentence NAMES an exit that exists -
 * the search is editable, and the team picker is one control over - and that
 * neither promises the `No team` detach, which is the core half's verb and not
 * this app's yet. The untyped variant is an edge (a roster carrying no manager
 * row at all), but it is reachable, so it states the one exit that remains.
 */
export const IDENTITY_MENU_NO_SETTABLE_TYPED =
	"No profile here can take the seat — clear the search, or switch the team.";
export const IDENTITY_MENU_NO_SETTABLE =
	"No profile can take the seat — switch the team.";

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
	/** Whether any row in the visible list is settable (issue #861's rule). */
	hasSettable: boolean;
}): string | null {
	const { view, kind, query, overflowing, hasSettable } = input;
	const noun = kind === "team" ? "teams" : "agents";
	const typed = query.trim();

	if (typed !== "") {
		if (view.matches === 0) return null;
		/*
		 * A FILTERED VIEW WITH NO WAY OUT SAYS SO, INSTEAD OF THE COUNT (review
		 * round 1, D1): "4 of 150 agents match" is a count over a list where
		 * nothing can be picked, and the count is not the answer the user needs.
		 * The resolution names the exits that exist; see the constants above.
		 */
		if (!hasSettable) return IDENTITY_MENU_NO_SETTABLE_TYPED;
		return view.matches === view.total
			? `${view.total} ${noun} match`
			: `${view.matches} of ${view.total} ${noun} match`;
	}
	if (!overflowing) return null;
	/* The untyped edge: the whole visible roster is refused. See above. */
	if (!hasSettable) return IDENTITY_MENU_NO_SETTABLE;
	return `${view.total} ${noun} in all — scroll, or type to filter`;
}

/*
 * ---------------------------------------------------------- the team's
 * constraint on the agent slot (issue #861)
 *
 * A team-bound chat is run by the team's MANAGER, so the agent slot is not
 * free: it may hold the team's manager, or a profile that can delegate
 * (`delegate === true`). Anything else is a persona the manager brief
 * contradicts. The rule is the runtime's own acceptance predicate, which the
 * core half (damianvtran/local-operator#2014) enforces on its side: it refuses
 * an incompatible pick, and normalises an incompatible pairing at attach time.
 * The UI mirrors the predicate - it does not get a second opinion about it,
 * and both the panel's per-row marks and the header's cue come through the
 * functions below so the two surfaces cannot drift.
 *
 * WHY THE PREDICATE IS ONE FUNCTION. `settable(name) = name === teamRow.manager
 * || row.delegate === true`, in one place, because two copies of it would
 * eventually disagree in exactly the case the rule exists for (the delegating
 * profile - legal to hold the seat, and the case a name-inequality test gets
 * wrong).
 *
 * WHAT THE COPY IS A CANDIDATE FOR. The caption and the per-row reason are
 * written to be self-explaining and are marked as copy for the design round to
 * weigh against the core half's refusal wording - the predicate is frozen here,
 * not the prose.
 */

/**
 * The acceptance predicate: whether `name` may hold the agent seat of a chat
 * whose team is run by `manager`.
 *
 * The team's manager is ALWAYS settable, whatever its own flag reads - the
 * manager runs the team, so the manager can always take its own seat. A
 * `delegate === true` profile is settable beside it. Everything else - an
 * explicit `false`, or a row whose catalogue did not carry the field at all -
 * is not, which is the `delegate !== true` half of the rule stated as one
 * comparison.
 *
 * `manager` is a plain string comparison and is deliberately NOT defaulted
 * here: a caller that does not know the team's manager must not constrain at
 * all (see `identityAgentConstraint`), rather than compare against an invented
 * default. A null/undefined manager therefore yields "delegate-only", which no
 * caller in this tree applies without knowing the manager first.
 */
export function identityAgentSettable(input: {
	name: string;
	manager: string | null | undefined;
	delegate: boolean | null | undefined;
}): boolean {
	return input.name === input.manager || input.delegate === true;
}

/**
 * The bound team's acceptance rule, as the panel states and applies it.
 *
 * `manager` is the row's own manager (or the runtime's documented default,
 * `DEFAULT_TEAM_MANAGER`, when the row carries none) and `caption` is the
 * sentence the agent panel shows above its list. `null` when the manager is
 * not KNOWN - no team bound, or a catalogue that has not answered yet - which
 * is what keeps a constraint from being applied (or explained) against data
 * this app does not have; a wrong "only these profiles" mark is worse than a
 * missing one, because it is a claim about a team rather than about a load.
 */
export type IdentityAgentConstraint = {
	/** The profile the team's manager owns: always settable. */
	manager: string;
	/** The rule, in the register the panel's own sentences use. */
	caption: string;
};

/**
 * The rule sentence, with the team's own NAME (its label when it has one,
 * the slug otherwise - the same string the chip shows).
 *
 * Copy is a candidate for the design round (see the section note); the shape
 * to keep is that the sentence NAMES the team and states both halves of the
 * rule - led by the manager, and the manager and delegating profiles may also
 * take the seat. The vocabulary is `profiles that can delegate` rather than
 * the first draft's `coordinating profiles` (review round 1, U5/N2): the
 * product labels rows `role`/`specialist` and the field behind the rule is
 * `delegate`, and nothing in this app says "coordinating".
 */
export function identityAgentConstraintCaption(teamLabel: string): string {
	return `${teamLabel} is led by its manager; only the manager and profiles that can delegate may take this seat.`;
}

/**
 * The per-row reason a constrained row is not settable, shown in the row's
 * description slot so the disable is never silent (`PickerOption.disabled`'s
 * own contract: "still listed so the reason is visible").
 *
 * A candidate for the design round, like the caption - and SHORT on purpose
 * (review round 1, D4/U3): the first draft repeated the caption verbatim and
 * the row's description slot clips at ~43 characters, so the rendered line cut
 * off exactly the half that says who can take the seat, and it also displaced
 * the row's own description. This sentence survives the clip and adds what the
 * caption does not - what THIS row would need - while the rule itself keeps
 * one home, the caption.
 */
export const IDENTITY_AGENT_NOT_SETTABLE_REASON =
	"Needs a delegating profile here.";

/**
 * The constraint a bound team puts on the agent panel, or `null` when there is
 * nothing to apply: no team, or a manager that is not known yet.
 *
 * `manager` arrives as the team row's own value; a row that carries none is
 * normalised by the caller (the view resolves it to the runtime's default
 * before this). `teamLabel` is the name the sentence uses - `No team` never
 * reaches the caption because a null manager short-circuits first.
 */
export function identityAgentConstraint(input: {
	teamLabel: string;
	manager: string | null;
}): IdentityAgentConstraint | null {
	if (input.manager === null) return null;
	return {
		manager: input.manager,
		caption: identityAgentConstraintCaption(input.teamLabel),
	};
}
