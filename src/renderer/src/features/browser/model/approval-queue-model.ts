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
	 * `snapshot()` returns it (`:556-585`); `chromeState()` now projects it too
	 * (`host.ts`'s `chromeState`, with the note on why the name travels and the
	 * nonce does not), which is the whole of this feature's main-process change.
	 * This optional field is the interface that makes one projection field enough:
	 * the filters below answer "this conversation's tabs, or all of them", and a tab
	 * with no attribution appears only under `"all"` (design 7.3 — a restored tab, a
	 * tab never handed over and a tab handed back are all the user's, not a
	 * conversation's). It stays OPTIONAL so a caller can model a projection that has
	 * no attribution at all, which is what the tests do for the `null` cases; a
	 * missing field and an explicit `null` behave identically here on purpose, since
	 * both mean "not this conversation's" and neither is a value the filter may
	 * treat as a match.
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

/**
 * Which tabs — and which requests — a browser surface is showing.
 *
 * `"all"` is the route's own, and a conversation scope is the pane's. TWO
 * FILTERS READ IT, and they are deliberately different keys for the same
 * question: `tabsInScope` matches a tab's `sessionId` and `requestsInScope`
 * matches a request's `requesterSessionId`. See each one for why.
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
 *
 * `reported` IS THE MEMORY RETENTION MUST NOT PRUNE (review round 3, MAJOR).
 * `resolved` is a bounded reading of the recent past — the retention filter drops
 * a row after `RESOLVED_RETENTION_MS` — so deriving the de-dupe set from it meant
 * an entry that is still IN the projection (main keeps dead entries until some
 * unrelated change arrives) was re-resolved, with a fresh `at`, every time the
 * window rolled off: once per five minutes, for as long as any other request kept
 * the clock alive, and re-announced every time because the surface renders these
 * rows inside `aria-live`. The caller owns a set that grows and is never pruned
 * for as long as the surface lives; that is the honest boundary, because "I have
 * already explained this one" is a fact about the session, not about the last
 * five minutes.
 */
export function reconcileResolved(
	previous: ReadonlyArray<ApprovalRequestInput>,
	current: ReadonlyArray<ApprovalRequestInput>,
	resolved: ReadonlyArray<ResolvedRow>,
	answered: ReadonlySet<string>,
	reported: ReadonlySet<string>,
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
	/*
	 * BOTH HALVES OF THE DE-DUPE, and the second one is why the bookkeeping could
	 * move out of the updater without reopening round 3's finding. `reported`
	 * survives retention's prune of the state; the rows in `resolved` are the same
	 * memory one render behind, so they cover the window before the recording
	 * effect below (in the hook, not in this function) has run — without them, two reconciles inside one commit could each
	 * produce the row.
	 */
	const known = new Set([...reported, ...resolved.map((row) => row.key)]);
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

/**
 * The requests a surface shows, for its scope — scoped BY REQUESTER, never by
 * matching a request's origin against a tab that happens to be in the list.
 *
 * WHY THE REQUESTER IS THE KEY (design 7.2, and the alternative is rejected there
 * — scoping a request by origin-matching a tab in the list — for exactly this
 * reason): a request belongs to a conversation because that
 * conversation's agent raised it (`requesterSessionId`, published by the host at
 * `host.ts:565-581`). Matching it against an origin that one of the scope's tabs
 * happens to be on would credit a request to a conversation that merely has a tab
 * open on the same site — a user's own tab, or another conversation's — and would
 * hide a request whose own tab is not in this scope's list yet. The requester
 * cannot be wrong about who asked.
 *
 * A requester that is NOT a session identity (`null` — a bare request id, or a
 * non-session actor) is therefore in no conversation's scope and appears only
 * under `"all"`, which is the same treatment an unattributed tab gets and for the
 * same reason: nothing in the projection says which conversation to show it in,
 * and inventing one is how a prompt ends up unanswered in a pane nobody is looking
 * at.
 *
 * THE SCOPE SWITCH DOES NOT APPLY TO THIS (design 7.2, and it is not an
 * oversight): the pane's tray shows this conversation's requests even while its
 * strip is showing All tabs, and says so in the tray's header. The switch chooses
 * which TABS are listed; a request is a demand on the user, and hiding one because
 * they were browsing every tab is the failure this whole feature exists to
 * prevent.
 */
export function requestsInScope<
	T extends { requesterSessionId: string | null },
>(requests: ReadonlyArray<T>, scope: SurfaceScope): T[] {
	if (scope === "all") return [...requests];
	return requests.filter(
		(request) => request.requesterSessionId === scope.sessionId,
	);
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
 * ONE CLOCK FOR THE WINDOW, not one per mounted surface.
 *
 * Spec 3.3 states the rule — "two surfaces computing liveness from two clocks is
 * how the badge and the tray disagree by one for a second" — and the first
 * implementation of it put a `setInterval` inside this hook, which made the rule
 * true only for as long as exactly one consumer was mounted. PR 2 gives the same
 * window a SECOND one: the chat header's trigger carries an attention badge
 * counting this conversation's live requests (spec 7.3) and it is mounted whether
 * or not the pane is, so a per-hook interval would put two clocks one second
 * apart on the same screen — the exact defect the rule names, with a count on one
 * side of it and a list on the other.
 *
 * So the value lives here, the timer is started by whoever has live work and
 * stopped when the last of them is done, and every consumer reads the same
 * number. The cost is one interval per window instead of one per surface, which is
 * also why `tick` publishes to every subscriber rather than the ticker owning a
 * `setState`.
 */
let clockNow = Date.now();
const clockSubscribers = new Set<(now: number) => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;
let clockHolders = 0;

function publishClock(now: number): void {
	clockNow = now;
	for (const notify of clockSubscribers) notify(now);
}

/**
 * Read the wall clock, move the shared value, and tell everyone.
 *
 * A NEW PROJECTION IS ALSO A MOMENT TO RE-READ THE CLOCK, which is why this is
 * exported rather than left to the ticker: without it the first render after an
 * arrival could use a `now` up to a second stale. It returns the value it just
 * published so a caller can stamp a reconcile with exactly the instant the rest of
 * the window is about to adopt.
 */
export function readApprovalClock(): number {
	publishClock(Date.now());
	return clockNow;
}

/** Run the shared interval while this caller has something live to count, and stop
 * it when the last caller is done — an idle app must not wake the CPU once a second
 * for a list that cannot change. Idempotent per holder: the caller's cleanup is the
 * only thing that releases it. */
function holdApprovalClock(): () => void {
	clockHolders += 1;
	if (clockTimer === null)
		clockTimer = setInterval(() => publishClock(Date.now()), 1000);
	return () => {
		clockHolders -= 1;
		if (clockHolders > 0 || clockTimer === null) return;
		clearInterval(clockTimer);
		clockTimer = null;
	};
}

/**
 * The queue model as a hook over the projection.
 *
 * The shared interval runs ONLY while something is pending — see the clock above,
 * which owns both the value and the decision to be running at all. The effect's
 * identity is keyed on the pending count rather than on the requests array, because
 * the array is a fresh object on every projection refresh and re-creating a 1s
 * interval on every refresh is a timer that never fires.
 */
export function useApprovalQueue(
	requests: ReadonlyArray<ApprovalRequestInput>,
	tabs: ReadonlyArray<ApprovalTabInput>,
): ApprovalQueueModel {
	const [now, setNow] = useState(() => clockNow);
	const previous = useRef<ReadonlyArray<ApprovalRequestInput>>([]);
	const [resolved, setResolved] = useState<ResolvedRow[]>([]);
	/** The entries this host answered. A ref, not state: the projection's next
	 * refresh reads it inside an effect, and a re-render is not wanted for it. */
	const answered = useRef<Set<string>>(new Set());
	/**
	 * Every entry this surface has already explained, for as long as it lives.
	 *
	 * NOT derived from `resolved`: retention prunes that state after five minutes,
	 * and an entry that is still in the projection while its row has aged out was
	 * then re-resolved with a fresh `at` on every retention window — a stale
	 * `expired` row re-announced inside `aria-live` once per five minutes, for as
	 * long as any other request kept the clock alive (review round 3, MAJOR).
	 *
	 * ITS BOUND IS THE SESSION, NOT THE QUEUE'S CAP (review round 4, NIT): the cap
	 * bounds LIVE entries, while this holds one key per entry the surface has ever
	 * resolved — a few dozen bytes each, growing with use and dropped with the
	 * surface, which is the same lifetime the memory's meaning has.
	 *
	 * IT IS WRITTEN OUTSIDE THE UPDATER, in the effect below (review round 4,
	 * MAJOR). An updater has to be pure because React may apply one update to the
	 * same base state more than once — `StrictMode` does exactly that, and `main.tsx`
	 * mounts the app strict — so a ref mutated inside it made the SECOND application
	 * de-dupe against a key the first one had just added and drop the resolved row
	 * for good: the one row this whole memory exists to show, permanently absent in
	 * every dev build.
	 */
	const reported = useRef<Set<string>>(new Set());
	/** The updater both arms share. PURE, which is the whole of the round-4 fix: it
	 * reads `reported` and never writes it, so applying it twice produces the same
	 * rows. */
	const reconcile = useCallback(
		(
			was: ReadonlyArray<ApprovalRequestInput>,
			next: ReadonlyArray<ApprovalRequestInput>,
			at: number,
		) =>
			setResolved((current) =>
				reconcileResolved(
					was,
					next,
					current,
					answered.current,
					reported.current,
					at,
				),
			),
		[],
	);

	/*
	 * THE COMMITTED ROWS ARE WHAT THE MEMORY IS ABOUT, so this is where they are
	 * recorded — after React has settled on a value, not while it is deciding. The
	 * effect cannot run between two applications of the same update, which is
	 * exactly why the bookkeeping works here and could not work in the updater.
	 */
	useEffect(() => {
		for (const row of resolved) reported.current.add(row.key);
	}, [resolved]);

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
		return holdApprovalClock();
	}, [live]);

	/** Follow the shared clock. `setNow` is stable, so this subscribes once. */
	useEffect(() => {
		clockSubscribers.add(setNow);
		return () => {
			clockSubscribers.delete(setNow);
		};
	}, []);

	// A new projection is also a moment to re-read the clock: without this the
	// first render after an arrival could use a `now` up to a second stale, which
	// is exactly the one-second disagreement between badge and tray the single
	// clock exists to prevent.
	useEffect(() => {
		const at = readApprovalClock();
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
		reconcile(was, requests, at);
	}, [requests, reconcile]);

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
		reconcile(requests, requests, now);
	}, [now, requests, reconcile]);

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
