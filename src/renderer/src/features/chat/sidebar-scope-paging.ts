/**
 * The chats sidebar's PAGED-CATALOGUE decisions: what an expanded group says,
 * what its badge counts, and when the flat list may extend itself.
 *
 * WHY A MODULE OF ITS OWN, on the rule `sidebar-catalogue-gate.ts` states: a
 * decision in a JSX condition is a decision no test can reach. The sidebar cannot
 * be rendered in this repository's suite - it reads the router, the canonical
 * sessions store and the desktop capability hooks - so the three claims this
 * change makes about a group (what it says while its page is in flight, what it
 * says when it has no rows, and when it may offer more) are asserted here rather
 * than against the component's source text.
 *
 * THE DEFECT THIS FILE EXISTS TO CLOSE, because it is the reported one. Before
 * paging, a group's rows were a filter of the ONE page the client held, and the
 * sentence for an empty group was chosen by `!rows.length` alone. So a group with
 * 434 conversations whose rows sat past a 500-row page drew "No chats yet", and
 * so did every group while the catalogue was still loading - the operator's own
 * screenshot. Both are FALSE statements about the store, and both are reachable
 * again the moment the head page is small, which is why the rule is an invariant
 * (`total > 0` can never render "No chats yet") rather than a condition.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not fetch, does not own a row list,
 * and does not decide ORDER. The order of a group's rows is the scope's own id
 * list, in the server's order, because the wire carries no rank and a client-side
 * re-sort would be a second ordering authority (`chat-sections.ts` states the
 * same rule for the sections).
 */

import {
	CATALOGUE_GROUP_PAGE,
	type CatalogueScopeCounts,
	type CatalogueScopeState,
} from "../../shared/store/canonical-sessions-store";

/**
 * How close to the bottom of the chat region a scroll has to come before the
 * flat list extends itself.
 *
 * ONE SCREEN IS NOT A NUMBER HERE, it is the argument: the extension is a fetch,
 * and the point of loading it "early" is that the rows are already in place by
 * the time the reader arrives at the bottom. A fixed small margin (a few hundred
 * pixels) means a fast scroll reaches the end of the list before the answer
 * lands, which is the stutter this exists to remove.
 */
const TAIL_EXTEND_MARGIN_SCREENS = 1;

/**
 * What an expanded group draws under its own row.
 *
 * `forbidden` is not a state the component can render; it is the invariant as a
 * returned fact so that a test can assert the absence of the sentence rather
 * than the presence of one particular string. See `groupChatsView`.
 */
export type GroupChatsView = {
	/** The rows the group draws, in the scope's order (empty off the paged path). */
	state: "rows" | "loading" | "empty" | "settled" | "error";
	/** The sentence to draw when `state` is not `rows`, or null for none. */
	sentence: string | null;
	/** Whether the group draws its own `Retry` beside the sentence. */
	retry: boolean;
	/** Whether the group draws the `Show more` row for its tail. */
	more: boolean;
	/**
	 * How many rows the `Show more` press will ADD, which is what its label says.
	 *
	 * WHY THE LABEL IS NOT THE PAGE SIZE (round 1, D7): a group holding 70 with 25
	 * drawn read `Show 25 more` with 45 still to come, and the row a reader presses
	 * should tell them what the press does. `remaining` comes from the census when
	 * there is one, and the last press is therefore EXACT - `min(page, remaining)` is
	 * also the `limit` the fetch is asked for, so a group with 5 left fetches 5
	 * rather than 25 and discarding 20.
	 */
	addCount: number;
	/** Whether the census says this group holds chats the panel cannot draw here. */
	forbidden: boolean;
};

/**
 * The group's own state, from the scope's page and the catalogue's census.
 *
 * THE PRECEDENCE, and each step is a decision rather than a fall-through:
 *
 * 1. **`pageable === false` is today, exactly.** A backend without
 *    `session_catalogue_page` expands groups client-side over the one 500-row
 *    page it answered, so the group's own sentence is the one this code has
 *    always drawn - `held === 0` and nothing else. There is no scope, no census
 *    and no cursor to reason about, and inventing states for a daemon that cannot
 *    have them would change the withdrawn render this whole change is gated on
 *    keeping byte-identical.
 * 2. **A contradiction is never reported as emptiness.** `total > 0` with no
 *    rows held is `forbidden`: the census is the store's own count of the scope,
 *    and a page that says otherwise is a page that has not caught up. It draws
 *    the loading register rather than "No chats yet", and it CONVERGES - the next
 *    head answer re-reads the census, and a scope that really is empty settles to
 *    "No chats yet" within one poll. (The same rule is what fixes the loading
 *    case: while the first page is in flight the census already says the group
 *    has rows, so the sentence was false for a whole network round trip.)
 * 3. **An error outranks the rows.** A page that failed after a successful one
 *    keeps its rows on screen - they are not withdrawn by a later failure - and
 *    the failure is drawn BELOW them, because the one thing the reader can act on
 *    is the retry for the page that did not arrive.
 * 4. **`more` is the cursor, not a count.** The group offers its tail when the
 *    daemon said there is one (`nextCursor !== null`), which is the only fact
 *    that can say so: a page that filled exactly to its limit may or may not have
 *    a next row, and the census total minus the rows held cannot tell a row that
 *    is missing from one that was deleted between the two reads.
 */
/**
 * The sentence a group draws when the census says it holds chats and the panel
 * can draw none of them.
 *
 * WHY IT HEDGES, and why it names a way forward (round 1, U3). The client cannot
 * know WHY a settled page came back empty: the census counts what the daemon can
 * see, the page counts what this scope may draw, and a conversation that is
 * archived is the ordinary reason the two disagree. What it CAN know is that it
 * is not loading, so it must not say so - and the reader's next move is named
 * rather than left to them.
 */
export const GROUP_WITHHELD_SENTENCE =
	"None of this group's chats can be drawn here - they may be archived. Search with Include archived to find them.";

export function groupChatsView(args: {
	/** Whether the daemon negotiates `session_catalogue_page`. */
	pageable: boolean;
	/** The group's own paging state, or undefined before its first fetch. */
	scope: CatalogueScopeState | undefined;
	/** How many rows the client holds for this group RIGHT NOW. */
	held: number;
	/** The census total for this scope, or null when the census is unknown. */
	total: number | null;
}): GroupChatsView {
	if (!args.pageable) {
		const empty = args.held === 0;
		return {
			state: empty ? "empty" : "rows",
			sentence: empty ? "No chats yet" : null,
			retry: false,
			more: false,
			addCount: 0,
			forbidden: false,
		};
	}
	const scope = args.scope;
	const forbidden = args.total !== null && args.total > 0 && args.held === 0;
	if (scope === undefined) {
		/*
		 * No answer yet: the disclosure has just been opened and the fetch is on its
		 * way (or has not been issued by this render yet). "Loading chats…" is the
		 * register the panel already uses for `Loading agents…`, and it is the
		 * sentence that replaces the false negative rather than a spinner, because
		 * the region is a text column and a spinner in it reads as a broken row.
		 */
		return {
			state: "loading",
			sentence: "Loading chats…",
			retry: false,
			more: false,
			addCount: 0,
			forbidden,
		};
	}
	if (scope.ids.length === 0) {
		/*
		 * THE ERROR IS ASKED FIRST, and the order is the rule rather than the shape of
		 * the code (evidence rig `sidebar-lazy-chats`, `--scoped-case error`). A
		 * failure of this group's read is a FACT about the request; "the page has not
		 * caught up with the store" is a guess drawn from a census that arrived at a
		 * different moment. Asked the other way round, a group whose read had PERMANENTLY
		 * failed read "Loading chats…" for ever - the sentence a reader waits on rather
		 * than acts on, and the census rule ("never say empty while the store says the
		 * group holds chats") had quietly become "never say anything else either".
		 */
		if (scope.error !== null) {
			return {
				state: "error",
				sentence: scope.error,
				retry: true,
				more: false,
				addCount: 0,
				forbidden: false,
			};
		}
		/*
		 * A SETTLED SCOPE IS NEVER DESCRIBED AS LOADING (round 1, U3).
		 *
		 * The order here is the whole finding. This branch used to claim "Loading
		 * chats…" whenever the census outran the page, regardless of `scope.loading` -
		 * so a group whose chats are all archived sat under a 70 badge reading
		 * "Loading chats…" FOR EVER, in ordinary store state with no daemon fault, and
		 * the sentence and `scope.loading` disagreed about the same fact. Now the
		 * loading sentence requires a page actually in flight, and a settled empty page
		 * says what it is.
		 */
		if (scope.loading) {
			return {
				state: "loading",
				sentence: "Loading chats…",
				retry: false,
				more: false,
				addCount: 0,
				forbidden,
			};
		}
		if (forbidden) {
			return {
				state: "settled",
				sentence: GROUP_WITHHELD_SENTENCE,
				retry: false,
				more: false,
				addCount: 0,
				forbidden: true,
			};
		}
		return {
			state: "empty",
			sentence: "No chats yet",
			retry: false,
			more: false,
			addCount: 0,
			forbidden: false,
		};
	}
	/*
	 * `remaining` is the census minus what is DRAWN, and only when the census is
	 * known: `total - held` cannot tell a row that is missing from one that was
	 * deleted between the two reads, so it is used only to make the press EXACT and
	 * never to decide whether a tail exists (`nextCursor` is that fact, above).
	 */
	const remaining =
		args.total === null
			? CATALOGUE_GROUP_PAGE
			: Math.max(args.total - args.held, 0);
	return {
		state: "rows",
		/*
		 * The failure sentence is drawn BESIDE the rows rather than instead of them,
		 * so `sentence` carries it while `state` still says `rows` - the group's
		 * order and its rows are what the reader came for, and a page that failed to
		 * extend does not invalidate the page that arrived.
		 */
		sentence: scope.error,
		retry: scope.error !== null,
		more: scope.nextCursor !== null,
		addCount:
			scope.nextCursor === null
				? 0
				: Math.max(1, Math.min(CATALOGUE_GROUP_PAGE, remaining)),
		forbidden: false,
	};
}

/**
 * The count a group's badge draws.
 *
 * THE CENSUS IS THE NUMBER, because it is the store's own count of the scope
 * rather than a count of whatever page the client happens to hold: the operator's
 * `lopdev` group holds 434 conversations and the 500-row page carried 283 of
 * them, so the badge under-reported by 151. Without a census (an older daemon, or
 * a request that did not ask) this is today's count of the group's own rows.
 *
 * A SEARCH OVERRIDES IT, and that is not a refinement - it is required for the
 * badge to be true. While a query is in force the group draws the rows the search
 * matched, so a census total beside them would count conversations the reader
 * cannot see and cannot reach from this panel. The same rule already governs the
 * clipped-search badge (`countBadge`'s `+`/`or more`), which is why this returns
 * the held count in that case rather than trying to intersect two answers.
 */
export function groupBadgeCount(args: {
	pageable: boolean;
	/** The census total for this scope, or null when the census is unknown. */
	total: number | null;
	/** How many rows the group is drawing. */
	held: number;
	/** Whether a search query is in force. */
	searching: boolean;
}): number {
	if (!args.pageable || args.searching || args.total === null) return args.held;
	return args.total;
}

/**
 * The census entry for one scope, or null.
 *
 * Looked up by `(kind, name)` rather than by the `${kind}:${name}` key, because
 * the wire's list carries the two fields separately and a group whose NAME
 * contains a colon (`team:op:dev` is a legal display name) would be read wrong by
 * a key that split on one.
 */
export function scopeCensusTotal(
	counts: CatalogueScopeCounts | null,
	kind: "team" | "agent",
	name: string,
): number | null {
	if (counts === null) return null;
	for (const entry of counts.scopes)
		if (entry.kind === kind && entry.name === name) return entry.total;
	return null;
}

/**
 * The label a group's census badge carries, for the accessible name and the
 * `title` (round 1, D1 + D5).
 *
 * WHY THE BADGE NEEDS TO SAY WHAT IT IS. The panel draws two kinds of number in
 * one 12px column: a SECTION heading's count of the rows it is drawing, and a
 * group's badge, which is the census for that scope. They look alike and mean
 * different things, and the census is the dimmer of the two - so the badge alone
 * reads as "how many are here" rather than "how many this group holds". The
 * sentence is also the only way the number reaches a screen reader: the badge sits
 * inside buttons whose own `aria-label`s replace their children, so the digit is
 * announced NOWHERE today. The component draws this sentence in an `sr-only` span
 * on the group's row and in the badge's `title`.
 */
export function groupBadgeLabel(badge: number): string {
	return `${badge} chats in this group`;
}

/**
 * The flat list's own total, on the paged path (round 1, R2 - and U1/D2 with it).
 *
 * WHY THE PAGED PATH NEEDS A TOTAL OF ITS OWN. The sentence the panel has always
 * drawn - "Showing up to 500 chats. Older chats remain available in the terminal."
 * - is a statement about a TRUNCATED read, and it is only true there. On a paged
 * backend the panel is not showing "up to" anything: it holds the head page plus
 * whatever the reader has extended, of a catalogue the census has counted, so the
 * honest sentence is `<Showing N of M chats>`. That is also the operator's own
 * confusion answered - the badge says a group HOLDS 70, and this says how many of
 * the whole catalogue are ON SCREEN.
 *
 * Null when the census is unknown (an older daemon, or a request that did not ask
 * for it): a total nobody counted is not a claim this panel may make.
 */
export function catalogueTotalSentence(args: {
	pageable: boolean;
	/** How many chats the panel is drawing. */
	shown: number;
	/** The census total, or null when it is unknown. */
	total: number | null;
}): string | null {
	if (!args.pageable || args.total === null) return null;
	return `Showing ${args.shown} of ${args.total} chats`;
}

/**
 * What the flat list says, politely, when its tail lands (round 1, U7).
 *
 * WHY THIS IS NEEDED AT ALL: the extension is triggered by SCROLL POSITION and
 * draws nothing of its own in the steady state, so rows appear under a reader
 * with no announcement at all - and a screen reader's user cannot see that the
 * list grew. One polite line names the event; the component clears it after a
 * moment, because a live region that keeps its last value says nothing new the
 * next time the same number of rows arrive.
 */
export function tailArrivalAnnouncement(added: number): string | null {
	if (added <= 0) return null;
	return added === 1 ? "1 more chat arrived." : `${added} more chats arrived.`;
}

/** What the chat region's tail draws. */
export type CatalogueTailView =
	| { kind: "none" }
	| { kind: "loading" }
	| { kind: "error"; sentence: string; retry: true };

/**
 * The flat chat list's tail.
 *
 * WHY THE FLAT LIST AUTO-EXTENDS AND A GROUP DOES NOT, in one sentence: this
 * region has ONE scroller and ONE scope in it, so "extend" has exactly one
 * meaning, while the ENTITY region is shared by every expanded group - a sentinel
 * near the fold there fires for whichever groups happen to sit at it, so the load
 * would become a function of scroll position rather than of intent, and N groups
 * would extend together. That is the amplification this change exists to remove,
 * reintroduced inside one container.
 *
 * `atBottom` is measured from the region's own geometry rather than observed with
 * an `IntersectionObserver`: the file already measures geometry in its existing
 * `onScroll` handler, and a second mechanism would be a second source of truth
 * for one question.
 */
export function catalogueTailView(args: {
	pageable: boolean;
	/** The head's cursor, or null when the catalogue is fully paged. */
	nextCursor: string | null;
	loading: boolean;
	error: string | null;
}): CatalogueTailView {
	// An older daemon has no cursor and no paging: its tail is today's
	// `Showing up to 500 chats` sentence, drawn by the component, untouched.
	if (!args.pageable) return { kind: "none" };
	if (args.loading) return { kind: "loading" };
	if (args.error !== null)
		return { kind: "error", sentence: args.error, retry: true };
	if (args.nextCursor === null) return { kind: "none" };
	/*
	 * NO EXPLICIT PRESS IN THE STEADY STATE. The extension is driven by the
	 * region's own scroll position (`tailExtendDue`), which is what the operator
	 * asked for, and a button at the bottom would be replaced mid-press by the
	 * rows its own press fetched. The one case that needs a press is a FAILED
	 * page, and that is the branch above: the reader asked once, the answer did
	 * not come, and nothing would ask again on its own.
	 */
	return { kind: "none" };
}

/**
 * Whether this scroll position is close enough to the bottom to extend.
 *
 * IT IS ALSO ASKED OF A REGION THAT CANNOT SCROLL, and that is deliberate rather
 * than a fallback. A region whose content is not taller than its box never emits
 * a scroll event, so a reader on a tall window would sit with a list that ends
 * one page in and no way to ask for more - the rows past the head page
 * unreachable, with nothing on screen saying so. Asked of such a region this
 * predicate is true (`scrollHeight - clientHeight` is at most zero), so the tail
 * fills until the list overflows, and then the reader's own scrolling takes over.
 * It converges for the same reason every other extension does: `loading` admits
 * one page at a time, and `nextCursor === null` is the end of the catalogue.
 */
export function tailExtendDue(args: {
	pageable: boolean;
	nextCursor: string | null;
	loading: boolean;
	error: string | null;
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
}): boolean {
	if (!args.pageable) return false;
	// A failed page is never retried by a scroll: the reader asked once, and
	// re-asking on every scroll tick would hammer a backend that just refused.
	if (args.error !== null || args.loading || args.nextCursor === null)
		return false;
	const remaining = args.scrollHeight - args.scrollTop - args.clientHeight;
	return remaining <= args.clientHeight * TAIL_EXTEND_MARGIN_SCREENS;
}
