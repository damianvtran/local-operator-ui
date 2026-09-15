import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The approval queue as the renderer understands it: which requests are still
 * live, what number each one has, how long it has left, and what just left the
 * list.
 * Design: docs/design/browser-approval-ux.md 3 (the object model), 5.2 (the
 * ordinal), 9's PR-1 interface list (item 2: a hook over the projection, not
 * page state).
 *
 * WHY THIS FILE EXISTS AT ALL, and it is the spec's central finding: the host
 * publishes `pendingConsent` and `expiresAt` (`host.ts:559-582`) but NOTHING in
 * main fires at expiry — `sweep` prunes the queue only when `requestAccess`
 * runs (`approvals.ts:429`) and every `onChanged()` call site is a user or agent
 * action. So a badge or a count derived from `pendingConsent.length` keeps
 * counting a request that expired minutes ago until something else happens to
 * change state (§1.2). Liveness therefore has to be DERIVED here, from a clock
 * the renderer owns.
 *
 * WHY ONE CLOCK, AND WHY IT IS ONE HOOK. Two surfaces computing liveness from
 * two clocks is how the badge and the tray disagree by one for a second (§3.3).
 * So the interval lives here, exactly one of them per mounted host, and the
 * tray, the dock, the tab chips and the badge all read the same `now` from the
 * same call. The pane in PR 2 mounts this same hook rather than its own copy.
 *
 * WHY THE TYPES ARE STRUCTURAL RATHER THAN IMPORTED. `PendingConsentView` and
 * `BrowserTabView` live in `../hooks/use-browser-chrome`, which imports this
 * module — importing them back would be a cycle for no benefit, and the two
 * shapes are the projection's own fields either way. The hook's parameters are
 * declared as the fields it actually reads, so a caller cannot pass something
 * with the right names and the wrong meaning.
 */

/** One pending request, as the host projects it (`PendingConsentView`). */
export interface ApprovalRequestInput {
	entryId: string;
	origin: string;
	authority: string;
	broad: { scope: "domain" | "host"; key: string } | null;
	expiresAt: number;
	requesterSessionId: string | null;
}

/** The tab fields the queue model reads. */
export interface ApprovalTabInput {
	tabId: number;
	url: string;
	/**
	 * The conversation a tab belongs to.
	 *
	 * `registry.ts` carries this per tab (`TabRecord.sessionId`, `:38-51`) and
	 * `snapshot()` returns it (`:556-585`), but `chromeState()` drops it
	 * (`host.ts:531-543`), so in PR 1 the field is absent from the projection and
	 * every tab reads as unattributed. PR 2 projects it (that is the whole of
	 * PR 2's main-process change), and this optional field is the interface that
	 * makes that one projection field enough: the filter below already answers
	 * "this conversation's tabs, or all of them", and a tab with no attribution
	 * appears only under `"all"` (design 7.3 — a restored tab, a tab never handed
	 * over and a tab handed back are all the user's, not a conversation's).
	 */
	sessionId?: string | null;
	/**
	 * Who opened the tab, which the waiting marker reads.
	 *
	 * Present in the projection already (`chromeState()` maps `owner`, and the strip
	 * has always drawn the `Agent` mark from it), so this is the same fact the strip
	 * uses rather than a new field. The chip is gated on it (UX round 1, U3): the
	 * marker says the tab is parked waiting for access, and a tab the USER opened to
	 * the same origin is not waiting for anything — their own navigation is ungated
	 * and the page loads.
	 */
	owner?: "user" | "agent";
}

/** Which tabs a browser surface is showing. PR 1 only ever passes `"all"`. */
export type SurfaceScope = "all" | { sessionId: string };

/** One live request, numbered and timed, as every surface renders it. */
export interface ApprovalRow {
	request: ApprovalRequestInput;
	/** Position in the live list, 1-based (§5.2). A position, not an identity. */
	ordinal: number;
	/** "expires in 9 minutes" — the tick, or `null` when it has already passed. */
	remaining: string | null;
}

/** A request the user was looking at that is no longer pending (§3.4). */
export interface ResolvedRow {
	/** Stable across renders: the entry id the host minted. */
	key: string;
	kind: "expired" | "withdrawn";
	origin: string;
	authority: string;
	/** When the renderer noticed, for the retention window below. */
	at: number;
}

/** Below a minute the copy stops counting (§3.3). Two names for the same
 * number on purpose: the threshold and the unit are separate facts, and the day
 * one moves the other must not follow it by accident. */
const UNDER_A_MINUTE_MS = 60_000;
const MINUTE_MS = 60_000;

/** How many resolved rows are kept, and for how long. Bounded on purpose:
 * nothing here is a durable history (the store is in-memory by design,
 * `approvals.ts:157-158`), it is the answer to "why did the count change"
 * for a user who is watching the list. */
export const RESOLVED_KEEP = 5;
export const RESOLVED_RETENTION_MS = 5 * MINUTE_MS;

/** The origin of a tab's live URL, or null when it has none.
 *
 * The scheme check is not decoration: `new URL("about:blank").origin` is the
 * STRING "null", which is truthy, so a blank tab would otherwise match a pending
 * request about an origin called `null` — and the waiting match has to be exact
 * for the tab chip to name the right tab. */
export function originOfUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.origin
			: null;
	} catch {
		return null;
	}
}

/** The live requests, in the order the host projected them (FIFO by `sequence`
 * — `liveQueue` sorts on it and `chromeState` preserves it, so the renderer adds
 * no ordering of its own). */
export function liveRequests(
	requests: ReadonlyArray<ApprovalRequestInput>,
	now: number,
): ApprovalRequestInput[] {
	return requests.filter((request) => now < request.expiresAt);
}

/** The remaining time, in words (§3.3): a user deciding whether to grant a
 * durable approval should know when the agent's own window closes. Rounded UP,
 * because "expires in 9 minutes" must not be said of 8m20s of remaining life. */
export function remainingLabel(expiresAt: number, now: number): string | null {
	const left = expiresAt - now;
	if (left <= 0) return null;
	if (left < UNDER_A_MINUTE_MS) return "expires in under a minute";
	const minutes = Math.ceil(left / MINUTE_MS);
	return minutes === 1
		? "expires in 1 minute"
		: `expires in ${minutes} minutes`;
}

/** The numbered, timed list every surface renders from (§5.2). */
export function approvalRows(
	requests: ReadonlyArray<ApprovalRequestInput>,
	now: number,
): ApprovalRow[] {
	return liveRequests(requests, now).map((request, index) => ({
		request,
		ordinal: index + 1,
		remaining: remainingLabel(request.expiresAt, now),
	}));
}

/** Which tabs are parked on an origin that is waiting, and at which number.
 *
 * Matching on the URL's origin rather than on a tab id is deliberate: the prompt
 * is raised by an agent's navigation, which may target a tab the user is not
 * looking at (`browser-page.tsx`'s own note). The map is built from the same
 * numbered rows as the tray, so `Request 2` in the strip and chip [2] in the
 * tray are the same request by construction.
 *
 * AGENT TABS ONLY, and that is a copy contract rather than a filter for taste
 * (UX round 1, U3): the chip says the tab is waiting for the agent's access, and
 * a tab the USER opened to the same origin is neither parked nor blocked — their
 * own navigation is ungated, the page loads, and a chip reading `Request 1` on it
 * describes something that is not happening to that tab. */
export function waitingOrdinals(
	rows: ReadonlyArray<ApprovalRow>,
	tabs: ReadonlyArray<ApprovalTabInput>,
): Record<number, number> {
	const byOrigin = new Map<string, number>();
	for (const row of rows) {
		// First writer wins, so a second request for the same origin does not
		// renumber the tab.
		if (!byOrigin.has(row.request.origin)) {
			byOrigin.set(row.request.origin, row.ordinal);
		}
	}
	const waiting: Record<number, number> = {};
	for (const tab of tabs) {
		if (tab.owner !== "agent") continue;
		const origin = originOfUrl(tab.url);
		if (!origin) continue;
		const ordinal = byOrigin.get(origin);
		if (ordinal !== undefined) waiting[tab.tabId] = ordinal;
	}
	return waiting;
}

/**
 * The rows a surface should show as just-gone, from its own memory of the last
 * projection (§3.4).
 *
 * The rule is narrow on purpose. An entry that was in the previous projection,
 * is absent from the current one, was not answered locally, and was past its
 * `expiresAt` has EXPIRED; the same with a future `expiresAt` was WITHDRAWN —
 * cancelled by the agent, or displaced at the queue cap. An answered request is
 * excluded because the user knows what happened to it; calling that "withdrawn"
 * would put a lie in the list at the exact moment the user is looking.
 *
 * WHY RENDERER-SIDE RATHER THAN A PROJECTION FIELD: publishing a resolved set
 * from main would add a second, expiring copy of state the store deliberately
 * does not keep.
 */
export function reconcileResolved(
	previous: ReadonlyArray<ApprovalRequestInput>,
	current: ReadonlyArray<ApprovalRequestInput>,
	resolved: ReadonlyArray<ResolvedRow>,
	answered: ReadonlySet<string>,
	now: number,
): ResolvedRow[] {
	const liveIds = new Set(current.map((request) => request.entryId));
	const fresh = previous
		.filter(
			(request) =>
				!liveIds.has(request.entryId) && !answered.has(request.entryId),
		)
		.map<ResolvedRow>((request) => ({
			key: request.entryId,
			// Past its TTL is an expiry; anything else left the queue by someone
			// else's action, and "withdrawn by the agent" is the honest reading of
			// that (it covers a cancel and a displacement at the cap alike).
			kind: request.expiresAt <= now ? "expired" : "withdrawn",
			origin: request.origin,
			authority: request.authority,
			at: now,
		}));
	/*
	 * AND THE ONES THAT DIE WHILE THE USER WATCHES (QA round 2, Q3; the reviewer's
	 * NIT-2). Main fires nothing at expiry, so an entry that runs out its ten minutes
	 * leaves the LIST on the renderer's own tick (`approvalRows` filters on `now`) and
	 * had no explanation until some unrelated change happened to push a projection -
	 * the count dropped and nothing said why. An entry still in the projection, past
	 * its `expiresAt` and not answered by this surface IS gone from the user's point
	 * of view, and its own TTL is the reason, so it resolves here. Same de-dupe and
	 * same retention as the departure half, so the two cannot disagree.
	 */
	const expired = current
		.filter(
			(request) => request.expiresAt <= now && !answered.has(request.entryId),
		)
		.map<ResolvedRow>((request) => ({
			key: request.entryId,
			kind: "expired",
			origin: request.origin,
			authority: request.authority,
			at: now,
		}));
	const known = new Set(resolved.map((row) => row.key));
	return [...fresh, ...expired]
		.filter((row) => !known.has(row.key))
		.concat(resolved)
		.filter((row) => now - row.at < RESOLVED_RETENTION_MS)
		.slice(0, RESOLVED_KEEP);
}

/** The scope labels the approvals dock's rows carry. Moved here from the Sites
 * sheet with its copy unchanged, so the list reads the same in its new host. */
export function approvalScopeLabel(
	scope: "origin" | "domain" | "host" | "deny" | "session",
): string {
	switch (scope) {
		case "origin":
			return "This site";
		case "domain":
			return "Whole domain";
		case "host":
			return "This host";
		case "deny":
			return "Denied";
		case "session":
			return "This session only";
	}
}

/**
 * The tabs a surface shows, for its scope.
 *
 * `"all"` is every tab. A conversation scope is tabs whose `sessionId` equals it,
 * and a tab with NO attribution is not any conversation's — it appears only
 * under `"all"`, with the this-conversation empty state saying so rather than
 * claiming no tabs are open behind a filter (design 7.2).
 */
export function tabsInScope<T extends ApprovalTabInput>(
	tabs: ReadonlyArray<T>,
	scope: SurfaceScope,
): T[] {
	if (scope === "all") return [...tabs];
	return tabs.filter((tab) => tab.sessionId === scope.sessionId);
}

export interface ApprovalQueueModel {
	/** The one clock every surface reads (§3.3). */
	now: number;
	rows: ApprovalRow[];
	resolved: ResolvedRow[];
	/** tabId -> the ordinal of the request its origin is parked on (§5.2). */
	waiting: Record<number, number>;
	/** The badge count: live requests, and nothing else (§3.3). */
	count: number;
	/** Tell the model a decision was sent for this entry, so the row it came from
	 * is not reported as expired or withdrawn once the projection drops it. */
	noteDecision: (entryId: string) => void;
}

/**
 * The queue model as a hook over the projection.
 *
 * The interval runs ONLY while something is pending: an idle browser route must
 * not wake the CPU once a second for a list that cannot change. Its identity is
 * keyed on the pending count rather than on the requests array, because the
 * array is a fresh object on every projection refresh and re-creating a 1s
 * interval on every refresh is a timer that never fires.
 */
export function useApprovalQueue(
	requests: ReadonlyArray<ApprovalRequestInput>,
	tabs: ReadonlyArray<ApprovalTabInput>,
): ApprovalQueueModel {
	const [now, setNow] = useState(() => Date.now());
	const previous = useRef<ReadonlyArray<ApprovalRequestInput>>([]);
	const [resolved, setResolved] = useState<ResolvedRow[]>([]);
	/** The entries this host answered. A ref, not state: the projection's next
	 * refresh reads it inside an effect, and a re-render is not wanted for it. */
	const answered = useRef<Set<string>>(new Set());

	/*
	 * THE GATE IS THE LIVE COUNT, not the projection's length (review round 1,
	 * finding 4). `pendingConsent` is main's queue filtered AT PROJECTION TIME and
	 * nothing in main fires at expiry, so after the last request expires the
	 * projection keeps its dead entries until some unrelated change arrives — the
	 * rows and the badge correctly fall to zero while this timer kept waking the
	 * route once a second for a list that cannot change, against the rule stated
	 * below.
	 */
	const live = liveRequests(requests, now).length;
	useEffect(() => {
		if (live === 0) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [live]);

	// A new projection is also a moment to re-read the clock: without this the
	// first render after an arrival could use a `now` up to a second stale, which
	// is exactly the one-second disagreement between badge and tray the single
	// clock exists to prevent.
	useEffect(() => {
		const at = Date.now();
		setNow(at);
		/*
		 * THE PREVIOUS ARRAY IS CAPTURED BEFORE THE REF MOVES, and that is the whole
		 * fix for the finding QA reproduced twice (round 1, Q2). The updater passed
		 * to `setResolved` runs LATER than this effect body, so reading
		 * `previous.current` inside it read the value line below had already written —
		 * `previous === requests` every time, `reconcileResolved`'s `fresh` therefore
		 * always empty, and the resolved list always `[]`. The state it feeds is the
		 * answer to "why did the count change", so the effect was carrying a feature
		 * that could never render.
		 */
		const was = previous.current;
		previous.current = requests;
		setResolved((current) =>
			reconcileResolved(was, requests, current, answered.current, at),
		);
	}, [requests]);

	/*
	 * THE CLOCK IS ALSO A TRIGGER, not only a reading (QA round 2, Q3). The effect
	 * above explains a DEPARTURE, and a departure is only observable when a new
	 * projection arrives; an entry that dies of its TTL while the user watches
	 * changes no projection at all, so the same reconcile has to run on the tick that
	 * already moves `now`. Nothing is paid for an idle route: that interval exists
	 * only while something is live, and the tick that empties the list is the one
	 * that resolves the last entry.
	 */
	/*
	 * `now` and `requests` ARE THE WHOLE INPUT, and the live set is derived from them:
	 * a tick that expires an entry moves `now`, a departure moves `requests`, so an
	 * explicit key on the derived ids would be a dependency the rule correctly reads as
	 * unnecessary. Kept as a comment rather than a `void` because that is what the rule
	 * was asking.
	 */
	useEffect(() => {
		setResolved((current) =>
			reconcileResolved(requests, requests, current, answered.current, now),
		);
	}, [now, requests]);

	// Leaving the surface drops the memory by construction: it is a reading of the
	// live list, not a history (spec 3.4), so there is nothing to clean up on
	// unmount — the state goes away with the component.

	const rows = approvalRows(requests, now);
	return {
		now,
		rows,
		resolved,
		waiting: waitingOrdinals(rows, tabs),
		count: rows.length,
		// Stable identity on purpose: the surface uses it inside a `useCallback` that
		// would otherwise be re-created on every render.
		noteDecision: useCallback((entryId: string) => {
			answered.current.add(entryId);
		}, []),
	};
}
