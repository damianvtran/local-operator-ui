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

import type {
	CatalogueScopeCounts,
	CatalogueScopeState,
} from "@shared/store/canonical-sessions-store";

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
	state: "rows" | "loading" | "empty" | "error";
	/** The sentence to draw when `state` is not `rows`, or null for none. */
	sentence: string | null;
	/** Whether the group draws its own `Retry` beside the sentence. */
	retry: boolean;
	/** Whether the group draws the `Show more` row for its tail. */
	more: boolean;
	/**
	 * Whether the group is in the state that must never say "No chats yet":
	 * the census says it holds conversations and the client has none of them.
	 */
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
				forbidden: false,
			};
		}
		if (forbidden) {
			/*
			 * The census says this group holds conversations and this page returned
			 * none of them. That is not emptiness, and it is not an error either - it
			 * is a page that has not caught up with the store. See step 2 above.
			 */
			return {
				state: "loading",
				sentence: "Loading chats…",
				retry: false,
				more: false,
				forbidden: true,
			};
		}
		return {
			state: "empty",
			sentence: "No chats yet",
			retry: false,
			more: false,
			forbidden: false,
		};
	}
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

/** What the chat region's tail draws. */
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
