/**
 * WARM THE FIRST HISTORY PAGE BEFORE THE CLICK (bridge-instant-load S3).
 *
 * The operator's bar is "clicking into any conversation should feel
 * instantaneous". A conversation whose timeline entry is already in the query
 * cache paints in the first frame (`useTeamBridgeMessages` keeps
 * `staleTime`/`gcTime` for exactly that); a COLD one waits one history read
 * (measured 150-290 ms through the hub, architect n=12) behind skeleton rows.
 * This module turns the likely next clicks into warm entries ahead of time.
 *
 * INVARIANTS — each one is what makes the shortcut safe, not a tuning choice:
 *
 * - ONE QUERY PATH. Every prefetch goes through `teamBridgeMessagesQueryOptions`
 *   — the same key, the same `readForBridgeOwner` fence, the same write-time
 *   window merge — so a prefetched entry is byte-for-byte what the timeline
 *   would have fetched, and the two can never drift into separate caches.
 * - COLD ONLY. An entry that already holds data is never re-read here: the
 *   notification watcher refreshes an existing entry exactly when its row's
 *   `latest_seq` moves (`syncUnmountedConversations`), and the open timeline
 *   polls its own. A prefetcher that re-read warm entries would be a third,
 *   redundant traffic source against the hub's shared per-account bucket.
 * - BOUNDED. At most `TEAM_BRIDGE_PREFETCH_CONCURRENCY` reads in flight; a
 *   plan queues at most `TEAM_BRIDGE_PREFETCH_MAX` conversations AND no more
 *   than the free room under the channel cache's retention bound
 *   (`TEAM_BRIDGE_MAX_CONVERSATIONS`, 20). The sweep evicts never-opened
 *   entries first, so a plan past that room would warm entries the next sweep
 *   drops and the next list change re-reads (review R1); an entry the sweep
 *   did drop unseen is not planned again until the reader opens it. Hover
 *   reads spend a small rolling budget; a press always reads.
 * - FRONT OF THE QUEUE FOR INTENT. A row the reader points at, focuses or
 *   presses goes ahead of every planned guess.
 * - SCOPED TO THE PAGE. Queued guesses are dropped when the page unmounts or
 *   the account changes (`cancelTeamBridgePrefetch`).
 * - A 429 STOPS IT. The hub's `conversation-reads` bucket (120/min per account)
 *   is shared with every agent session reading as this account; the reader's
 *   own click matters more than any guess. The first rate-limit refusal drops
 *   that account's queue and holds its prefetches for at least the bucket's
 *   window (per account: the bucket is).
 * - NO RETRY. A prefetch is a guess; a failed guess costs the click one normal
 *   read, which is what it cost before this module existed.
 * - MEMORY ONLY. Bodies land in React Query's renderer memory like every other
 *   history read; nothing is persisted, and no screened/held/admitted state is
 *   derived here — the server's page is stored as served.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { TeamBridgeConversation } from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_HISTORY_GC_MS,
	TEAM_BRIDGE_HISTORY_STALE_MS,
	TEAM_BRIDGE_MAX_CONVERSATIONS,
	TEAM_BRIDGE_RATE_LIMIT_MAX_WAIT_MS,
	historyRateLimitWaitMs,
	historyReadRetry,
	historyReadRetryDelay,
	wasEvictedUnviewed,
} from "./team-bridge-channel-cache";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	isNotAMemberRefusal,
	isPreviewConversation,
} from "./team-bridge-model";
import { teamBridgeMessagesQueryOptions } from "./use-team-bridge";

/** The N most recently active conversations warmed per plan (operator target:
 * a daily-driver messenger's next click is almost always one of these). */
export const TEAM_BRIDGE_PREFETCH_RECENT = 8;
/** Reads in flight at once: enough to warm 8 rows in ~3 round trips without a
 * burst the size of the list hitting the shared bucket. */
export const TEAM_BRIDGE_PREFETCH_CONCURRENCY = 3;
/**
 * The most candidates one plan offers (unread plus recent). This bounds the
 * plan's size, NOT what the cache keeps: what actually gets queued is further
 * capped by the free room under the retention bound (`cacheHeadroom`), because
 * the channel cache evicts never-opened entries first (review R1) and a plan
 * that overfilled it would only warm entries the next sweep drops.
 */
export const TEAM_BRIDGE_PREFETCH_MAX = Math.min(
	12,
	TEAM_BRIDGE_MAX_CONVERSATIONS - 4,
);
/**
 * Hover/focus-originated reads allowed per rolling window (review R2).
 *
 * `pointerenter` fires for every row a pointer crosses, so a sweep down a long
 * rail would otherwise be one read per row. A reader choosing a row dwells on
 * one or two before clicking; 4 per 10 s covers that, while a pointer sweep
 * costs at most 4 reads (24/min if someone sweeps non-stop, a fifth of the
 * 120/min `conversation-reads` bucket). A PRESS never spends or respects this
 * budget: it is the reader's click arriving, and the timeline would issue the
 * same read a few ms later anyway.
 */
export const TEAM_BRIDGE_PREFETCH_INTENT_BUDGET = 4;
export const TEAM_BRIDGE_PREFETCH_INTENT_WINDOW_MS = 10_000;

/** What asked for a read. `plan` is a guess from the list; `hover` (pointer or
 * keyboard focus) a stronger one; `press` the click itself. */
export type TeamBridgePrefetchIntent = "hover" | "press";
type JobKind = "plan" | TeamBridgePrefetchIntent;

type Job = {
	key: string;
	conversationId: string;
	tenantId: string;
	accountId: string;
	kind: JobKind;
};

type Scheduler = {
	/** Not yet dispatched, front first. */
	queue: Job[];
	/** Keys queued OR in flight: the dedupe set. */
	queued: Set<string>;
	inFlight: number;
	/**
	 * Per account: `Date.now()` before which nothing is prefetched (set by a
	 * 429). Keyed by account because the hub's bucket is per account (review
	 * R4): account A's spent bucket says nothing about B's.
	 */
	heldUntil: Map<string, number>;
	/** Dispatch times of hover-originated reads inside the rolling window. */
	intentDispatches: number[];
};

/* One scheduler per QueryClient, so every caller shares one concurrency bound
 * and one 429 hold instead of each spending their own. */
const schedulers = new WeakMap<QueryClient, Scheduler>();

function schedulerFor(client: QueryClient): Scheduler {
	let scheduler = schedulers.get(client);
	if (!scheduler) {
		scheduler = {
			queue: [],
			queued: new Set(),
			inFlight: 0,
			heldUntil: new Map(),
			intentDispatches: [],
		};
		schedulers.set(client, scheduler);
	}
	return scheduler;
}

function isHeld(scheduler: Scheduler, accountId: string): boolean {
	return Date.now() < (scheduler.heldUntil.get(accountId) ?? 0);
}

/** Remove queued (never in-flight) jobs matching `drop`. */
function dropQueued(scheduler: Scheduler, drop: (job: Job) => boolean): void {
	scheduler.queue = scheduler.queue.filter((job) => {
		if (!drop(job)) return true;
		scheduler.queued.delete(job.key);
		return false;
	});
}

/**
 * How many more conversations the cache can take before the retention sweep
 * (`sweepTeamBridgeChannelCache`, 20 conversations) starts dropping entries.
 *
 * The sweep counts EVERY messages entry holding data and drops never-opened
 * ones first, so a plan must fit in what is left after the entries already
 * there and the reads already in flight (each lands one more entry). Planning
 * past this is what made review R1's loop: 12 reads, then 4 re-reads of
 * just-evicted entries on every list change, forever.
 */
function cacheHeadroom(client: QueryClient): number {
	/* A read in flight (a prefetch, or the click's own) lands one more entry,
	   so it is counted with the entries already holding data. Read from the
	   query cache rather than a counter: a counter decremented in `finally`
	   lags the data write, and would count a just-landed entry twice. */
	const taken = client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.messagesPrefix })
		.filter(
			(query) =>
				query.state.data !== undefined ||
				query.state.fetchStatus === "fetching",
		).length;
	return TEAM_BRIDGE_MAX_CONVERSATIONS - taken;
}

function intentBudgetLeft(scheduler: Scheduler): boolean {
	const since = Date.now() - TEAM_BRIDGE_PREFETCH_INTENT_WINDOW_MS;
	scheduler.intentDispatches = scheduler.intentDispatches.filter(
		(at) => at > since,
	);
	return scheduler.intentDispatches.length < TEAM_BRIDGE_PREFETCH_INTENT_BUDGET;
}

/**
 * Which rows to warm, in order: every unread conversation first (the reader is
 * most likely to open those), then the most recently active. Preview rows
 * (a discoverable channel the reader is not in) and archived rows are skipped:
 * their history read is refused or rare.
 */
export function teamBridgePrefetchCandidates(
	rows: readonly TeamBridgeConversation[],
	limits: { recent?: number; max?: number } = {},
): TeamBridgeConversation[] {
	const recent = limits.recent ?? TEAM_BRIDGE_PREFETCH_RECENT;
	const max = limits.max ?? TEAM_BRIDGE_PREFETCH_MAX;
	const readable = rows.filter(
		(row) => row.status !== "archived" && !isPreviewConversation(row),
	);
	// `?? ""`: the contract requires the field, but a cache entry seeded by hand
	// (a story, a test fixture) may lack it, and a sort must not throw in a
	// passive effect that also runs the banner watcher.
	const byRecency = [...readable].sort((a, b) =>
		(b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
	);
	const picked: TeamBridgeConversation[] = [];
	const seen = new Set<string>();
	const take = (row: TeamBridgeConversation) => {
		const id = `${row.tenant_id}\u0000${row.id}`;
		if (seen.has(id) || picked.length >= max) return;
		seen.add(id);
		picked.push(row);
	};
	for (const row of byRecency) if (row.unread_count > 0) take(row);
	for (const row of byRecency.slice(0, recent)) take(row);
	return picked;
}

function drain(client: QueryClient, scheduler: Scheduler): void {
	while (
		scheduler.inFlight < TEAM_BRIDGE_PREFETCH_CONCURRENCY &&
		scheduler.queue.length > 0
	) {
		const job = scheduler.queue.shift() as Job;
		const options = teamBridgeMessagesQueryOptions(
			client,
			job.conversationId,
			job.tenantId,
			job.accountId,
		);
		const state = client.getQueryState(options.queryKey);
		// Every condition is re-checked at dispatch, not only at enqueue: the
		// reader may have opened it (or the watcher warmed it), the cache may
		// have filled, or a 429 may have landed while the job waited its turn.
		// `fetchStatus === "fetching"`: the click's own read is already out, so
		// a prefetch would only join it while holding a slot.
		const skip =
			isHeld(scheduler, job.accountId) ||
			state?.data !== undefined ||
			state?.fetchStatus === "fetching" ||
			(job.kind === "plan" &&
				(cacheHeadroom(client) <= 0 || wasEvictedUnviewed(job.key))) ||
			(job.kind === "hover" && !intentBudgetLeft(scheduler));
		if (skip) {
			scheduler.queued.delete(job.key);
			continue;
		}
		if (job.kind === "hover") scheduler.intentDispatches.push(Date.now());
		scheduler.inFlight += 1;
		void client
			.fetchQuery({
				...options,
				staleTime: TEAM_BRIDGE_HISTORY_STALE_MS,
				// The entry outlives this call: it is built with the timeline's own
				// retention, not the app default, so an unobserved warm entry is still
				// there when the click comes.
				gcTime: TEAM_BRIDGE_HISTORY_GC_MS,
				retry: false,
			})
			.catch((error: unknown) => {
				const wait = historyRateLimitWaitMs(error);
				if (wait === null) return;
				// At least the bucket's whole window: one refusal means the bucket is
				// spent, and the agents sharing it are still reading.
				scheduler.heldUntil.set(
					job.accountId,
					Date.now() + Math.max(wait, TEAM_BRIDGE_RATE_LIMIT_MAX_WAIT_MS),
				);
				dropQueued(scheduler, (queued) => queued.accountId === job.accountId);
			})
			.finally(() => {
				scheduler.inFlight -= 1;
				scheduler.queued.delete(job.key);
				drain(client, scheduler);
			});
	}
}

/**
 * Queue first-page reads for `rows` that have no cached timeline yet, as many
 * as fit under the retention bound (`cacheHeadroom`), skipping any the sweep
 * already dropped unopened (`wasEvictedUnviewed`). With the cache full of
 * conversations the reader opened, a plan reads nothing: warming then could
 * only evict, or be evicted.
 *
 * The caller owns the read gate (the page's `readsEnabled`); every read still
 * passes `readForBridgeOwner` inside the shared query function, so a prefetch
 * can never warm a cache across an account or authority change.
 */
export function prefetchTeamBridgeConversations(
	client: QueryClient,
	accountId: string | undefined,
	rows: readonly Pick<TeamBridgeConversation, "id" | "tenant_id">[],
): void {
	if (!accountId) return;
	const scheduler = schedulerFor(client);
	if (isHeld(scheduler, accountId)) return;
	let room =
		cacheHeadroom(client) -
		scheduler.queue.filter((job) => job.kind === "plan").length;
	for (const row of rows) {
		if (room <= 0) break;
		const options = teamBridgeMessagesQueryOptions(
			client,
			row.id,
			row.tenant_id,
			accountId,
		);
		const key = JSON.stringify(options.queryKey);
		if (scheduler.queued.has(key)) continue;
		if (client.getQueryState(options.queryKey)?.data !== undefined) continue;
		if (wasEvictedUnviewed(key)) continue;
		scheduler.queued.add(key);
		scheduler.queue.push({
			key,
			conversationId: row.id,
			tenantId: row.tenant_id,
			accountId,
			kind: "plan",
		});
		room -= 1;
	}
	drain(client, scheduler);
}

/**
 * The reader is about to open one row: warm it NOW, at the FRONT of the queue
 * (review R2: a new intent row used to go behind the whole plan). The gap
 * between pointerdown and click is ~80-120 ms, most of a cold read.
 *
 * - `hover` (pointer over the row, or keyboard focus on it) spends the rolling
 *   intent budget, and replaces any hover still waiting: the pointer has moved
 *   on, so only the row under it now is worth a read.
 * - `press` always wins: no budget, never displaced by a hover, front of queue.
 *
 * Neither respects `cacheHeadroom`: the reader is pointing at this row, and the
 * click would read it regardless. Intent fires on gestures, not list changes,
 * so it cannot feed the plan's evict/re-read loop.
 */
export function prefetchTeamBridgeConversationNow(
	client: QueryClient,
	accountId: string | undefined,
	row: TeamBridgeConversation,
	intent: TeamBridgePrefetchIntent = "hover",
): void {
	if (!accountId || isPreviewConversation(row) || row.status === "archived")
		return;
	const scheduler = schedulerFor(client);
	if (isHeld(scheduler, accountId)) return;
	const options = teamBridgeMessagesQueryOptions(
		client,
		row.id,
		row.tenant_id,
		accountId,
	);
	const key = JSON.stringify(options.queryKey);
	if (scheduler.queued.has(key)) {
		// Queued: move it to the front (upgrading a press) rather than queueing a
		// second read. Not in the queue means already in flight: nothing to do.
		const at = scheduler.queue.findIndex((job) => job.key === key);
		if (at === -1) return;
		const [job] = scheduler.queue.splice(at, 1);
		if (intent === "press") job.kind = "press";
		scheduler.queue.unshift(job);
		drain(client, scheduler);
		return;
	}
	if (client.getQueryState(options.queryKey)?.data !== undefined) return;
	if (intent === "hover") {
		dropQueued(scheduler, (job) => job.kind === "hover");
		if (!intentBudgetLeft(scheduler)) return;
	}
	scheduler.queued.add(key);
	scheduler.queue.unshift({
		key,
		conversationId: row.id,
		tenantId: row.tenant_id,
		accountId,
		kind: intent,
	});
	drain(client, scheduler);
}

/**
 * Drop every queued (not yet dispatched) prefetch for `client` (review R3).
 *
 * The page calls this when it unmounts and when the signed-in account changes:
 * the guesses were for a rail nobody is looking at any more, and each would
 * still spend a read from the shared bucket. Reads already in flight finish
 * (they cannot be recalled without aborting a request the click may have
 * joined) and stay owner-fenced.
 */
/**
 * START THE LANDING CONVERSATION'S FIRST PAGE ALONGSIDE THE LIST
 * (bridge-instant-load, first open after launch).
 *
 * WHY. The timeline reads its conversation only once `selected` resolves, and
 * `selected` resolves from the LOADED conversation list. On a cold open that
 * put the list read (~200 ms in the instant-load bench) and the first history
 * read (~150 ms) back to back: 331.6 ms against the operator's 300 ms bar
 * (ui#1889, QA r4). When the page already knows where it will land - a
 * remembered view, a deep link, a notification click, or the default row of a
 * cached list - this starts that one read at the same time as the list.
 *
 * WHAT MAKES IT SAFE (each is load-bearing, not tuning):
 * - SAME ENTRY. It reads through `teamBridgeMessagesQueryOptions`, so the key
 *   (conversation, tenant, account) and the `readForBridgeOwner` fence are the
 *   timeline's own. When `selected` resolves, `useTeamBridgeMessages` adopts the
 *   in-flight read or the cached answer; it never issues a second request.
 * - DISPLAY IS NOT DECIDED HERE. This only fills a cache entry. Nothing renders
 *   it until the authoritative list (or archived read) confirms the selection,
 *   exactly as before; a conversation the reader was removed from, or one that
 *   was deleted, is simply never selected, and its entry ages out under the
 *   timeline's `gcTime` like any other unopened warm entry.
 * - SILENT ON REFUSAL. The retry policy is the timeline's own: it never retries
 *   a definite `not_a_member`, and it retries nothing while nobody observes the
 *   entry. A failed read that no timeline has adopted is removed, so a later
 *   selection starts clean - no error state is inherited and nothing is shown.
 * - COLD ONLY, ONCE. An entry holding data, or already being read, is left
 *   alone (the caller allows one call per open), and a rate-limit hold on the
 *   account is honoured, as for every other prefetch here.
 *
 * Answers whether a read was started, so the caller can spend its one call.
 */
export function prefetchTeamBridgeLanding(
	client: QueryClient,
	accountId: string | undefined,
	row: Pick<TeamBridgeConversation, "id" | "tenant_id">,
): boolean {
	if (!accountId || !row.id || !row.tenant_id) return false;
	const scheduler = schedulerFor(client);
	if (isHeld(scheduler, accountId)) return false;
	const options = teamBridgeMessagesQueryOptions(
		client,
		row.id,
		row.tenant_id,
		accountId,
	);
	const state = client.getQueryState(options.queryKey);
	if (state?.data !== undefined || state?.fetchStatus === "fetching")
		return false;
	void client
		.fetchQuery({
			...options,
			staleTime: TEAM_BRIDGE_HISTORY_STALE_MS,
			gcTime: TEAM_BRIDGE_HISTORY_GC_MS,
			retry: historyReadRetry(client, options.queryKey, isNotAMemberRefusal),
			retryDelay: (failures, error) => historyReadRetryDelay(failures, error),
		})
		.catch((error: unknown) => {
			const wait = historyRateLimitWaitMs(error);
			if (wait !== null)
				scheduler.heldUntil.set(
					accountId,
					Date.now() + Math.max(wait, TEAM_BRIDGE_RATE_LIMIT_MAX_WAIT_MS),
				);
			const query = client
				.getQueryCache()
				.find({ queryKey: options.queryKey, exact: true });
			if (
				query &&
				query.state.data === undefined &&
				query.getObserversCount() === 0
			)
				client.removeQueries({ queryKey: options.queryKey, exact: true });
		});
	return true;
}

export function cancelTeamBridgePrefetch(client: QueryClient): void {
	const scheduler = schedulers.get(client);
	if (scheduler) dropQueued(scheduler, () => true);
}

/** Tests only: forget the scheduler state for a client. */
export function resetTeamBridgePrefetch(client: QueryClient): void {
	schedulers.delete(client);
}
