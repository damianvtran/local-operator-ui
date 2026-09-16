/**
 * The tab index: which conversation a tab belongs to, in what order a pooled
 * strip lists them, what a conversation's row summarises, and what the bulk
 * closes mean.
 * Design: docs/design/sidebar-conversation-browser.md 3 (R3 grouping, R5 the
 * bulk closes, R6-A this module), 6.2 (its tests), and
 * docs/design/browser-approval-ux.md 7.2 (scope).
 *
 * WHY THIS EXISTS AS ITS OWN MODULE, rather than as more of
 * `approval-queue-model.ts`: the pane, the route's strip and the sidebar's
 * per-conversation mark all have to answer "which tabs are this
 * conversation's, and what are they doing" — and the design's one structural
 * rule is that NO SECOND PLACE decides a tab's conversation. The scope helpers
 * were already in `approval-queue-model.ts`; they moved here so the three hosts
 * read them from the module that owns the question, and `approval-queue-model`
 * keeps the request queue, which is a different question (what is waiting on
 * the user).
 *
 * WHY THE INPUT TYPES ARE DECLARED HERE rather than imported: the same reason
 * `approval-queue-model.ts` declares its own (`:35`, `:45`) — importing
 * `use-browser-chrome`'s view types back into a model would be a cycle for no
 * benefit, and these functions read a handful of fields. Every caller's real
 * type (`BrowserTabView`, `ApprovalTabInput`) is structurally assignable, so
 * the declarations cost nothing and the whole module is testable without a
 * window — which is what `scripts/browser-chrome.test.mjs` does with it.
 *
 * WHY THE INPUT FIELDS ARE OPTIONAL: a caller that has no projection — a test,
 * or a host that renders marks for a state with no tabs — should be able to pass
 * `{ tabId }` and get a truthful answer. A missing field and an explicit `null`
 * both mean "not this conversation's" for `sessionId`, and both mean "not
 * loading"/"has not failed" for the two flags, so the optionality is a
 * statement about the input rather than a leniency in the rules.
 */

/**
 * Which tabs — and which requests — a browser surface is showing.
 *
 * `"all"` is the route's own, and a conversation scope is the pane's. TWO
 * FILTERS READ IT, and they are deliberately different keys for the same
 * question: `tabsInScope` (below) matches a tab's `sessionId` and
 * `requestsInScope` (`approval-queue-model.ts`) matches a request's
 * `requesterSessionId`. See each one for why.
 *
 * BOTH SIDES OF THE COMPARISON ARE THE APP'S OWN SESSION ID SPELLING — the bare
 * one the chat routes carry and the session list publishes — because that is what
 * the host stores and projects (`registry.ts` stores `sessionIdOf(identity)`, and
 * `chromeState` projects the record's own field). So the pane hands
 * `chromeState`'s own vocabulary back to it, and nothing here has to normalise a
 * `session:` prefix in one place and not the other.
 */
export type SurfaceScope = "all" | { sessionId: string };

/**
 * The scope's identity as a PRIMITIVE.
 *
 * WHY A SCOPE NEEDS A KEY AT ALL, and it is a defect this fixed rather than a
 * convenience: everything that consumes a scope keys on its IDENTITY — the
 * surface's tab and request memos, and the queue model's effects, one of which
 * publishes the shared clock and so re-renders the surface. A host that builds its
 * scope object inside its render body (the pane does: `{ sessionId }`) hands down a
 * new object every render, so a memo keyed on the object recomputes every render,
 * the model's effect re-runs, the clock publishes, and the surface re-renders — a
 * loop whose period is the microsecond it takes to run, on a surface that still
 * paints and therefore looks perfectly fine in a frame.
 *
 * So the value — `"all"`, or the session id, both strings — is what the surface
 * keys on, and the object is rebuilt from it inside the surface rather than trusted
 * from the caller. A host cannot trip it, which is the right place for that
 * guarantee: this model owns the rule.
 *
 * INJECTIVE, and that is a correctness property rather than a nicety (review round
 * 1, NIT A): keying a session scope as its bare session id made a session literally
 * named `all` indistinguishable from the all-tabs scope, so the strip would show
 * every conversation's tabs while the switch read "This conversation". Session ids
 * come from the daemon, so the collision was theoretical — but a key that is only
 * USUALLY injective is the kind of thing that holds until the day it does not.
 *
 * THE ENCODING IS THIS PAIR'S OWN BUSINESS: `scopeFromKey` below is the only thing
 * that reads it, so no caller takes the string apart, and a session id containing a
 * prefix of its own cannot confuse it.
 */
const ALL_SCOPE_KEY = "all";
const SESSION_SCOPE_PREFIX = "session:";

export function scopeKey(scope: SurfaceScope): string {
	return scope === "all"
		? ALL_SCOPE_KEY
		: `${SESSION_SCOPE_PREFIX}${scope.sessionId}`;
}

/** The scope a key names. The inverse of `scopeKey`, and the only reader of its
 * encoding. A key that is neither the all-scope nor prefixed is still a session
 * key: the tolerant reading is the one that cannot silently truncate an id. */
export function scopeFromKey(key: string): SurfaceScope {
	if (key === ALL_SCOPE_KEY) return "all";
	return {
		sessionId: key.startsWith(SESSION_SCOPE_PREFIX)
			? key.slice(SESSION_SCOPE_PREFIX.length)
			: key,
	};
}

/** The tab fields every function here reads. See the module docstring on why
 * they are declared here and why each is optional. */
export interface TabInput {
	tabId: number;
	/** The conversation a tab belongs to, or `null`/absent for none. */
	sessionId?: string | null;
	/** Who opened it. Only `summariseConversations` reads it today, through the
	 * callers' own types; the index itself is owner-agnostic. */
	owner?: "user" | "agent";
	/** This tab is loading right now (per tab, `chromeState().tabs[].loading`). */
	loading?: boolean;
	/** This tab's last navigation was refused (`chromeState().tabs[].failed`). */
	failed?: boolean;
}

/** The request fields `summariseConversations` reads. */
export interface RequestInput {
	entryId: string;
	requesterSessionId: string | null;
	expiresAt: number;
}

/** One conversation's tabs, under the order `groupTabsBySession` defines. */
export interface ConversationTabGroup<T extends TabInput = TabInput> {
	/** The conversation, or `null` for the unattributed run. */
	sessionId: string | null;
	tabs: T[];
}

/**
 * The tabs a surface shows, for its scope.
 *
 * `"all"` is every tab. A conversation scope is tabs whose `sessionId` equals it,
 * and a tab with NO attribution is not any conversation's — it appears only
 * under `"all"`, with the this-conversation empty state saying so rather than
 * claiming no tabs are open behind a filter (design 7.2).
 */
export function tabsInScope<T extends TabInput>(
	tabs: readonly T[],
	scope: SurfaceScope,
): T[] {
	if (scope === "all") return [...tabs];
	return tabs.filter((tab) => tab.sessionId === scope.sessionId);
}

/**
 * The pool as conversation groups.
 *
 * ORDER: groups by their FIRST tab, tabs within a group in the order they
 * arrived (which is the registry's own creation order, `registry.ts:276-278`),
 * and the unattributed run LAST.
 *
 * WHY BLOCKS AND NOT CONTIGUOUS RUNS (design R3, and this is the one ordering
 * decision worth arguing): runs never move a tab, but three conversations
 * interleaved by creation give a strip that reads `A B A C A` — the same
 * conversation labelled three times — and "see all the tabs opened by that
 * session" stops being answerable by looking at one place. The cost of blocks is
 * that a hand-over can move a tab between groups; that is a change the user
 * caused, and the `Shared`/`Agent` chip already announces it. Blocks are also
 * the only order that keeps the pane's conversation scope (one group, so no
 * labels) byte-identical to what it renders today.
 *
 * WHY UNATTRIBUTED IS LAST: conversations are the organising idea, and the tail
 * is the miscellaneous set — the restored tabs, the ones never handed over and
 * the ones handed back (`registry.ts:231`, `:386`), which are the user's own
 * tabs rather than any conversation's. Open question 8 settled it that way.
 *
 * GROUPING IS A PRESENTATION OF THE POOL and lives here rather than in the
 * registry: `snapshot()`'s `tabId` order is what the host-proof harnesses assert
 * on (`scripts/browser-chrome-proof.mjs:1239,1319`), so the registry's order is
 * left exactly where it is.
 */
export function groupTabsBySession<T extends TabInput>(
	tabs: readonly T[],
): ConversationTabGroup<T>[] {
	/** Attributed session ids in first-appearance order. A Map alone cannot give
	 * this: its iteration order is insertion order, which is the same thing — but
	 * only because nothing deletes, and the unattributed run must be able to land
	 * last regardless. An explicit list states the rule. */
	const order: string[] = [];
	const bySession = new Map<string, T[]>();
	const unattributed: T[] = [];
	for (const tab of tabs) {
		const sessionId = tab.sessionId ?? null;
		if (sessionId === null) {
			unattributed.push(tab);
			continue;
		}
		const run = bySession.get(sessionId);
		if (run) run.push(tab);
		else {
			bySession.set(sessionId, [tab]);
			order.push(sessionId);
		}
	}
	const groups: ConversationTabGroup<T>[] = order.map((sessionId) => ({
		sessionId,
		// Non-null by construction: the id is in `order` because this key was set.
		tabs: bySession.get(sessionId) as T[],
	}));
	if (unattributed.length) groups.push({ sessionId: null, tabs: unattributed });
	return groups;
}

/**
 * The pool in the order the grouped strip renders it: `groupTabsBySession`
 * flattened.
 *
 * DERIVED FROM THE GROUPING rather than a second pass with its own comparison,
 * so "the order shown" and "the order the groups are in" cannot drift — which
 * matters because a bulk close's label counts the tabs in this order
 * (`closeToTheRightIntent`) and the user counts them by looking at the strip.
 */
export function pooledTabs<T extends TabInput>(tabs: readonly T[]): T[] {
	return groupTabsBySession(tabs).flatMap((group) => group.tabs);
}

/** The attributed tabs, by conversation. Unattributed tabs are in no entry:
 * they are not any conversation's, which is the same rule `tabsInScope` applies
 * and the reason this is not simply a `groupTabsBySession` keyed differently. */
export function tabsBySession<T extends TabInput>(
	tabs: readonly T[],
): Map<string, T[]> {
	const index = new Map<string, T[]>();
	for (const tab of tabs) {
		const sessionId = tab.sessionId ?? null;
		if (sessionId === null) continue;
		const run = index.get(sessionId);
		if (run) run.push(tab);
		else index.set(sessionId, [tab]);
	}
	return index;
}

/**
 * What one conversation's sidebar row draws: how many tabs it has, what they are
 * doing, and whether anything is waiting on the user.
 *
 * `pendingApprovals` is an ASK and the rest are FACTS, which is why the mark
 * gives it the accent badge and the count a quiet number (design R2, 5.1).
 */
export interface ConversationBrowserSummary {
	tabCount: number;
	loadingCount: number;
	failedCount: number;
	pendingApprovals: number;
}

/**
 * One summary per conversation, keyed by session id, for the sidebar's rows.
 *
 * KEYED FROM THE TAB SIDE (design R2): the map is built from the tabs'
 * `sessionId` plus the requests' `requesterSessionId`, NOT from the session
 * list — so a row rendered from a search answer for a conversation that has no
 * tabs, or whose session is not in the current list, still shows its true mark,
 * and a conversation with nothing to say is absent rather than present-and-zero.
 *
 * ENTRY-WISE IDENTITY REUSE, and it is the property that makes this usable at
 * sidebar scale rather than a nicety: the sidebar renders every row in one
 * scroll container with no virtualisation, so a new `Map` of new objects on every
 * `browser-state-changed` event would re-render all forty rows for a change that
 * touched one. An unchanged conversation therefore keeps the object it had, and a
 * consumer that compares an entry to the previous one by identity — which is what
 * `React.memo`, a `useMemo` dependency and an effect key all do — sees no change.
 *
 * WHY `now` IS A PARAMETER (a delta from the design's sketch, and the reason is
 * the feature's own central finding): `approval-queue-model.ts` exists because
 * main fires NOTHING at a request's expiry, so a count derived from
 * `pendingConsent.length` goes on showing a request that expired minutes ago
 * until some unrelated action happens to change state. The sidebar's badge is
 * the same kind of surface as the header's, so it has to apply the same rule —
 * and the rule needs the clock. The caller passes the one clock it already
 * reads (`useApprovalQueue`'s `now`), not a second one.
 */
export function summariseConversations(
	tabs: readonly TabInput[],
	requests: readonly RequestInput[],
	now: number,
	previous?: ReadonlyMap<string, ConversationBrowserSummary>,
): Map<string, ConversationBrowserSummary> {
	/** The zero entry, by value rather than by reference: it is spread into a new
	 * object on every tally, so a shared constant could never be mutated by mistake. */
	const ZERO: ConversationBrowserSummary = {
		tabCount: 0,
		loadingCount: 0,
		failedCount: 0,
		pendingApprovals: 0,
	};
	const drafts = new Map<string, ConversationBrowserSummary>();
	/** Count one tab, one field at a time: every field is a count, so widening an
	 * entry is the only mutation any of these loops performs. */
	const tally = (
		sessionId: string,
		key: keyof ConversationBrowserSummary,
	): void => {
		const current = drafts.get(sessionId) ?? ZERO;
		drafts.set(sessionId, { ...current, [key]: current[key] + 1 });
	};

	for (const tab of tabs) {
		const sessionId = tab.sessionId ?? null;
		if (sessionId === null) continue;
		tally(sessionId, "tabCount");
		if (tab.loading === true) tally(sessionId, "loadingCount");
		if (tab.failed === true) tally(sessionId, "failedCount");
	}
	for (const request of requests) {
		// Expired entries are not pending, and nothing in main prunes them, so the
		// clock is the only thing that can say. Same rule as `liveRequests` in
		// `approval-queue-model.ts`, applied here so a badge cannot outlive its ask.
		if (now >= request.expiresAt) continue;
		const sessionId = request.requesterSessionId;
		if (sessionId === null) continue;
		tally(sessionId, "pendingApprovals");
	}

	// The reuse pass. Identity is decided by VALUE, so a conversation whose four
	// counts are unchanged hands back the object it had; only a changed one is new.
	const summaries = new Map<string, ConversationBrowserSummary>();
	for (const [sessionId, draft] of drafts) {
		const before = previous?.get(sessionId);
		summaries.set(
			sessionId,
			before && sameSummary(before, draft) ? before : draft,
		);
	}
	return summaries;
}

/** Whether two summaries say the same thing, field by field. */
function sameSummary(
	a: ConversationBrowserSummary,
	b: ConversationBrowserSummary,
): boolean {
	return (
		a.tabCount === b.tabCount &&
		a.loadingCount === b.loadingCount &&
		a.failedCount === b.failedCount &&
		a.pendingApprovals === b.pendingApprovals
	);
}

/**
 * A bulk close, as the renderer asks for it.
 *
 * TWO MODES RATHER THAN ONE LIST, because one of the two things the user can
 * press cannot be expressed as a list without racing (design R5):
 *
 * - `ids` is positional — "these tabs, the ones I could see" — and main closes
 *   exactly those, skipping any that are already gone. The tab the user
 *   addressed is closed because it was NAMED, so a tab that appeared after the
 *   press is not in the list and survives, which is honest.
 * - `conversation` is the group item, and it is resolved at EXECUTION time in
 *   main. A list computed from a projection the renderer read up to seconds ago
 *   — the band stays open while the user reads it — would miss a tab an agent
 *   opened in that conversation in the meantime, and the press said "all".
 *
 * A SEPARATE DECLARATION FROM MAIN'S OWN, deliberately, and the pattern is the
 * repo's existing one for a cross-process shape (`ContentRect` is declared in
 * `registry.ts` and again in `use-browser-chrome.ts`). Main does not import
 * renderer modules, and the IPC boundary VALIDATES the intent it is given rather
 * than trusting a type from the other side of the process — which is exactly what
 * makes the two declarations the same shape without one of them being authority.
 */
export type CloseTabsIntent =
	| { mode: "ids"; tabIds: number[] }
	| { mode: "conversation"; sessionId: string };

/**
 * `Close N other tabs`: every tab in the pool except the one the menu is on.
 *
 * THE WHOLE POOL, NOT THE HOST'S VISIBLE LIST (design R5). In the pane, scoped
 * to two tabs of eight, the item reads `Close 7 other tabs` — the truth about
 * what it does. `paneApprovalHeaderLabel`'s sibling rule applies: the words have
 * to agree with the scope, and a count in the label is the disclosure.
 *
 * `null` when there is nothing to close, so the item is not offered at all rather
 * than offered and inert.
 */
export function closeOthersIntent(
	allTabs: readonly TabInput[],
	keepTabId: number,
): CloseTabsIntent | null {
	const tabIds = pooledTabs(allTabs)
		.map((tab) => tab.tabId)
		.filter((tabId) => tabId !== keepTabId);
	return tabIds.length ? { mode: "ids", tabIds } : null;
}

/**
 * `Close N tabs to the right`: the tabs AFTER the anchor in the order the strip
 * is showing.
 *
 * THE RENDERED ORDER IS THE ARGUMENT, not the registry's: the words say "to the
 * right", and what is to the right of a tab is a fact about the grouped strip the
 * user is looking at — so the caller passes `pooledTabs(...)`. A tab an agent
 * creates after the press is not to the right of anything the user saw and
 * survives, which the strip then shows honestly.
 *
 * `null` for the last tab in the order (nothing is to its right) and for an
 * anchor that is not in the list at all.
 */
export function closeToTheRightIntent(
	orderedTabs: readonly TabInput[],
	anchorTabId: number,
): CloseTabsIntent | null {
	const at = orderedTabs.findIndex((tab) => tab.tabId === anchorTabId);
	if (at < 0) return null;
	const tabIds = orderedTabs.slice(at + 1).map((tab) => tab.tabId);
	return tabIds.length ? { mode: "ids", tabIds } : null;
}

/** `Close all tabs in this conversation`: the group item, resolved in main at
 * execution time rather than by the renderer holding a list. */
export function closeConversationIntent(sessionId: string): CloseTabsIntent {
	return { mode: "conversation", sessionId };
}

/**
 * How a conversation is named in front of a user: its title, or its id.
 *
 * THE ONE RULE, extracted rather than reimplemented (design R3). It was
 * `requesterLabel`'s own two lines (`browser-consent-request.tsx`) and the
 * hand-over dialog's, and the grouped strip would have been a third: a
 * conversation that has no title, or whose title is whitespace, is its id, which
 * is the app's existing treatment for a session the user has not named
 * (`session.title || session.session_id`). `title?.trim() || session_id` is
 * deliberately not `title ?? session_id`: an empty or blank title is not a name,
 * and rendering one leaves the user with a blank label where a fact belongs.
 */
export function sessionDisplayName(
	sessionId: string,
	sessions: ReadonlyArray<{ session_id: string; title?: string | null }>,
): string {
	const title = sessions.find(
		(session) => session.session_id === sessionId,
	)?.title;
	return title?.trim() || sessionId;
}
