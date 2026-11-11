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
 * - BOUNDED. At most `TEAM_BRIDGE_PREFETCH_CONCURRENCY` reads in flight and
 *   `TEAM_BRIDGE_PREFETCH_MAX` conversations per plan, kept under the channel
 *   cache's retention bound (`TEAM_BRIDGE_MAX_CONVERSATIONS`, 20) so warming
 *   never evicts what the reader actually opened.
 * - A 429 STOPS IT. The hub's `conversation-reads` bucket (120/min per account)
 *   is shared with every agent session reading as this account; the reader's
 *   own click matters more than any guess. The first rate-limit refusal drops
 *   the queue and holds every prefetch for at least the bucket's window.
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
} from "./team-bridge-channel-cache";
import { isPreviewConversation } from "./team-bridge-model";
import { teamBridgeMessagesQueryOptions } from "./use-team-bridge";

/** The N most recently active conversations warmed per plan (operator target:
 * a daily-driver messenger's next click is almost always one of these). */
export const TEAM_BRIDGE_PREFETCH_RECENT = 8;
/** Reads in flight at once: enough to warm 8 rows in ~3 round trips without a
 * burst the size of the list hitting the shared bucket. */
export const TEAM_BRIDGE_PREFETCH_CONCURRENCY = 3;
/** Recent plus unread, capped well under the retention bound (20) so warming
 * cannot push a conversation the reader opened out of the cache. */
export const TEAM_BRIDGE_PREFETCH_MAX = Math.min(
	12,
	TEAM_BRIDGE_MAX_CONVERSATIONS - 4,
);

type Job = {
	key: string;
	conversationId: string;
	tenantId: string;
	accountId: string;
};

type Scheduler = {
	queue: Job[];
	queued: Set<string>;
	inFlight: number;
	/** `Date.now()` before which nothing is prefetched (set by a 429). */
	heldUntil: number;
};

/* One scheduler per QueryClient, so the page and the app-wide watcher share
 * one concurrency bound and one 429 hold instead of each spending their own. */
const schedulers = new WeakMap<QueryClient, Scheduler>();

function schedulerFor(client: QueryClient): Scheduler {
	let scheduler = schedulers.get(client);
	if (!scheduler) {
		scheduler = { queue: [], queued: new Set(), inFlight: 0, heldUntil: 0 };
		schedulers.set(client, scheduler);
	}
	return scheduler;
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
		if (Date.now() < scheduler.heldUntil) {
			scheduler.queue.length = 0;
			scheduler.queued.clear();
			return;
		}
		const job = scheduler.queue.shift() as Job;
		const options = teamBridgeMessagesQueryOptions(
			client,
			job.conversationId,
			job.tenantId,
			job.accountId,
		);
		// Re-checked at dispatch, not at enqueue: the reader may have opened it
		// (or the watcher warmed it) while it waited its turn.
		if (client.getQueryState(options.queryKey)?.data !== undefined) {
			scheduler.queued.delete(job.key);
			continue;
		}
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
				scheduler.heldUntil =
					Date.now() + Math.max(wait, TEAM_BRIDGE_RATE_LIMIT_MAX_WAIT_MS);
				scheduler.queue.length = 0;
				scheduler.queued.clear();
			})
			.finally(() => {
				scheduler.inFlight -= 1;
				scheduler.queued.delete(job.key);
				drain(client, scheduler);
			});
	}
}

/**
 * Queue first-page reads for `rows` that have no cached timeline yet.
 *
 * The caller owns the read gate (the page's `readsEnabled`, the watcher's
 * `active`); every read still passes `readForBridgeOwner` inside the shared
 * query function, so a prefetch can never warm a cache across an account or
 * authority change.
 */
export function prefetchTeamBridgeConversations(
	client: QueryClient,
	accountId: string | undefined,
	rows: readonly Pick<TeamBridgeConversation, "id" | "tenant_id">[],
): void {
	if (!accountId) return;
	const scheduler = schedulerFor(client);
	if (Date.now() < scheduler.heldUntil) return;
	for (const row of rows) {
		const options = teamBridgeMessagesQueryOptions(
			client,
			row.id,
			row.tenant_id,
			accountId,
		);
		const key = JSON.stringify(options.queryKey);
		if (scheduler.queued.has(key)) continue;
		if (client.getQueryState(options.queryKey)?.data !== undefined) continue;
		scheduler.queued.add(key);
		scheduler.queue.push({
			key,
			conversationId: row.id,
			tenantId: row.tenant_id,
			accountId,
		});
	}
	drain(client, scheduler);
}

/**
 * A pointer over (or pressing) one row: warm it NOW, ahead of the queue. The
 * gap between pointerdown and click is ~80-120 ms, most of a cold read.
 */
export function prefetchTeamBridgeConversationNow(
	client: QueryClient,
	accountId: string | undefined,
	row: TeamBridgeConversation,
): void {
	if (!accountId || isPreviewConversation(row) || row.status === "archived")
		return;
	const scheduler = schedulerFor(client);
	const options = teamBridgeMessagesQueryOptions(
		client,
		row.id,
		row.tenant_id,
		accountId,
	);
	const key = JSON.stringify(options.queryKey);
	if (scheduler.queued.has(key)) {
		// Move it to the front rather than queueing a second read.
		const at = scheduler.queue.findIndex((job) => job.key === key);
		if (at > 0) scheduler.queue.unshift(...scheduler.queue.splice(at, 1));
		return;
	}
	prefetchTeamBridgeConversations(client, accountId, [row]);
}

/** Tests only: forget the scheduler state for a client. */
export function resetTeamBridgePrefetch(client: QueryClient): void {
	schedulers.delete(client);
}
