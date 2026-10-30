/**
 * ONE UNREAD SOURCE for Team Bridge: the nav badge, the rail rows, the org
 * switcher and the All-organizations rows all read the numbers below.
 *
 * WHY THIS EXISTS (operator report, 2026-10-30: "the left-nav badge says unread
 * but no conversation in the sidebar shows a badge"). The numbers came from
 * three caches read on three cadences:
 *
 *  - the nav badge drew the ACCOUNT aggregate's `total` (`teamBridgeKeys.unread
 *    ("all")`, polled every 30 s by the shell watcher);
 *  - a rail row drew `unread_count` off whichever conversation-list page the
 *    rail rendered. In one organization's view that is the TENANT-scoped list,
 *    which nothing polls (15 s stale, refreshed only on focus or a write), so a
 *    message that arrived while the page was open raised the badge and left
 *    every row at zero;
 *  - the org switcher drew `organizations[].unread` off the aggregate.
 *
 * The SEMANTICS already agree - this is not a counting bug. The hub's tenant
 * unread (agent-server `unreadForTenant`) sums each OPEN, member conversation's
 * stored per-member `UnreadCount` unless muted; the account `total` is the sum
 * of those per organization; and the conversation list's `unread_count` is the
 * same stored counter. Thread replies the reader follows are folded into the
 * conversation's counter server-side, so a reply is visible on its
 * conversation's row and needs no per-thread field. Muted conversations show
 * their count on their row and are excluded from the badge, by design.
 *
 * WHAT THIS DOES. It merges every cached per-conversation answer this account
 * already holds - the tenant unread rows the watcher polls and every
 * conversation-list page - keeping, per conversation, the value from the most
 * recently UPDATED read. Organization counts are summed from those rows when the
 * organization's rows are complete (a tenant unread read covers every open
 * membership; a list page may be one page of many), and fall back to the
 * aggregate's own per-org number otherwise. The badge is the sum of the
 * organization counts. A row and the badge can therefore only disagree about a
 * conversation no cached page holds yet.
 *
 * NO NEW READS AND NO PARALLEL CACHE. Everything is derived from the existing
 * query entries; the writes below patch those same entries in place.
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useSyncExternalStore } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeConversationList,
	TeamBridgeUnread,
} from "../../../../shared/team-bridge-contract";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	asTeamBridgeTenantId,
	notificationPreference,
} from "./team-bridge-model";

/** One conversation's unread state, tagged with the organization it belongs to. */
export type TeamBridgeUnreadEntry = {
	tenantId: string;
	conversationId: string;
	unread: number;
	lastReadSeq: number;
	latestSeq: number;
	muted: boolean;
	/** `dataUpdatedAt` of the read this value came from: newest wins. */
	at: number;
};

export type TeamBridgeUnreadView = {
	/** Keyed by `teamBridgeUnreadKey`. */
	rows: ReadonlyMap<string, TeamBridgeUnreadEntry>;
	/** Badge-able (unmuted) unread per organization. */
	byTenant: ReadonlyMap<string, number>;
	/** The nav badge: the sum of `byTenant`. */
	total: number;
};

export const teamBridgeUnreadKey = (tenantId: string, conversationId: string) =>
	`${tenantId}\u0000${conversationId}`;

/** Owned keys end in `["account", accountId]` (see `readOwner`). */
const ownedBy = (key: QueryKey, accountId: string) =>
	key.at(-1) === accountId && key.at(-2) === "account";

const EMPTY_VIEW: TeamBridgeUnreadView = {
	rows: new Map(),
	byTenant: new Map(),
	total: 0,
};

/**
 * Build the view from the cache. Pure over `client` state; the hook below
 * memoises it on a signature so React sees a stable snapshot.
 */
export function teamBridgeUnreadView(
	client: QueryClient,
	accountId: string | undefined,
): TeamBridgeUnreadView {
	if (!accountId) return EMPTY_VIEW;
	const rows = new Map<string, TeamBridgeUnreadEntry>();
	const offer = (entry: TeamBridgeUnreadEntry) => {
		const key = teamBridgeUnreadKey(entry.tenantId, entry.conversationId);
		const previous = rows.get(key);
		if (!previous || entry.at >= previous.at) rows.set(key, entry);
	};
	/* Tenants whose EVERY open membership has a row (a tenant unread answer). */
	const complete = new Set<string>();
	for (const query of client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.conversationsPrefix })) {
		if (!ownedBy(query.queryKey, accountId)) continue;
		// The archived half never carries unread (the server zeroes it) and the
		// rail does not render it; reading it would only offer stale zeroes.
		if (query.queryKey.includes("archived")) continue;
		const data = query.state.data as TeamBridgeConversationList | undefined;
		for (const row of data?.conversations ?? []) {
			if (row.status === "archived") continue;
			offer({
				tenantId: row.tenant_id,
				conversationId: row.id,
				unread: row.unread_count,
				lastReadSeq: row.last_read_seq,
				latestSeq: row.latest_seq,
				muted: notificationPreference(row) === "mute",
				at: query.state.dataUpdatedAt,
			});
		}
	}
	let aggregate: TeamBridgeUnread | undefined;
	let aggregateAt = 0;
	for (const query of client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.unreadPrefix })) {
		if (!ownedBy(query.queryKey, accountId)) continue;
		const scope = query.queryKey[2];
		const data = query.state.data as TeamBridgeUnread | undefined;
		if (!data) continue;
		if (scope === TEAM_BRIDGE_ALL_SCOPE) {
			aggregate = data;
			aggregateAt = query.state.dataUpdatedAt;
			continue;
		}
		if (typeof scope !== "string" || !data.conversations) continue;
		complete.add(scope);
		for (const row of data.conversations)
			offer({
				tenantId: scope,
				conversationId: row.conversation_id,
				unread: row.unread_count,
				lastReadSeq: row.last_read_seq,
				latestSeq: row.latest_seq,
				muted: row.muted,
				at: query.state.dataUpdatedAt,
			});
	}
	const organizations = new Map(
		(aggregate?.organizations ?? []).map((row) => [row.tenant_id, row.unread]),
	);
	/*
	 * A NEWER "NOTHING WAITING" WINS OVER AN OLDER ROW. The watcher stops reading
	 * an organization's rows once the aggregate reports it at zero, so a row read
	 * before the reader caught up elsewhere would otherwise keep a stale count
	 * forever beside a zero badge - the same disagreement, the other way round.
	 */
	for (const [key, entry] of rows)
		if (organizations.get(entry.tenantId) === 0 && aggregateAt > entry.at)
			rows.set(key, { ...entry, unread: 0 });
	const byTenant = new Map<string, number>();
	for (const [tenantId, unread] of organizations) {
		let sum = 0;
		for (const entry of rows.values())
			if (entry.tenantId === tenantId && !entry.muted) sum += entry.unread;
		/*
		 * Complete rows ARE the count. Otherwise the rows may be one page of
		 * many, so the aggregate can be larger - but never smaller than what a
		 * row on screen claims: a list read that landed after the aggregate
		 * (the watcher stops reading an org the aggregate reports at zero) must
		 * not leave a row badge beside a zero nav badge.
		 */
		byTenant.set(
			tenantId,
			complete.has(tenantId) ? sum : Math.max(unread, sum),
		);
	}
	let total = 0;
	for (const count of byTenant.values()) total += count;
	// An aggregate that names no organization (an older server, or one that
	// sends `organizations: []`) gives nothing to sum: its own total is then the
	// only honest account-wide number, exactly what the badge drew before.
	if (aggregate && !aggregate.organizations?.length) total = aggregate.total;
	return { rows, byTenant, total };
}

/** The row's count/cursor as the shared view sees it. */
export function withSharedUnread(
	conversation: TeamBridgeConversation,
	view: TeamBridgeUnreadView,
): TeamBridgeConversation {
	const entry = view.rows.get(
		teamBridgeUnreadKey(conversation.tenant_id, conversation.id),
	);
	if (
		!entry ||
		(entry.unread === conversation.unread_count &&
			entry.lastReadSeq === conversation.last_read_seq)
	)
		return conversation;
	return {
		...conversation,
		unread_count: entry.unread,
		// The cursor only moves forward; a newer row never un-reads.
		last_read_seq: Math.max(entry.lastReadSeq, conversation.last_read_seq),
	};
}

/*
 * A cheap change detector over exactly the queries the view reads. It keys on
 * DATA IDENTITY, not `dataUpdatedAt`: the patches below deliberately keep each
 * entry's timestamp (see `patchKeepingTime`), so a timestamp signature would
 * miss exactly the optimistic read-clear this module exists to show at once.
 */
const dataIds = new WeakMap<object, number>();
let nextDataId = 1;
function dataId(data: unknown): number {
	if (!data || typeof data !== "object") return 0;
	let id = dataIds.get(data);
	if (id === undefined) {
		id = nextDataId++;
		dataIds.set(data, id);
	}
	return id;
}

function viewSignature(client: QueryClient, accountId: string | undefined) {
	if (!accountId) return "";
	const parts: string[] = [];
	for (const prefix of [
		teamBridgeKeys.conversationsPrefix,
		teamBridgeKeys.unreadPrefix,
	])
		for (const query of client.getQueryCache().findAll({ queryKey: prefix }))
			if (ownedBy(query.queryKey, accountId))
				parts.push(
					`${query.queryHash}@${query.state.dataUpdatedAt}:${dataId(query.state.data)}`,
				);
	return parts.join("|");
}

/** Subscribe to the shared view. Re-renders only when an input read changes. */
export function useTeamBridgeUnreadView(
	accountId: string | undefined,
): TeamBridgeUnreadView {
	const client = useQueryClient();
	const memo = useRef<{ signature: string; view: TeamBridgeUnreadView } | null>(
		null,
	);
	const subscribe = useCallback(
		(listener: () => void) => client.getQueryCache().subscribe(listener),
		[client],
	);
	const snapshot = useCallback(() => {
		const signature = `${accountId ?? ""}#${viewSignature(client, accountId)}`;
		if (memo.current?.signature !== signature)
			memo.current = {
				signature,
				view: teamBridgeUnreadView(client, accountId),
			};
		return memo.current.view;
	}, [client, accountId]);
	return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Exact entries a read cursor patch touched, for rollback. */
export type TeamBridgeUnreadSnapshot = ReadonlyArray<
	readonly [QueryKey, unknown]
>;

/*
 * Every patch below keeps the entry's own `dataUpdatedAt`: the merge above
 * attributes a value to the read it came from, and stamping a whole page "now"
 * because one row was patched would let that page's OTHER, older rows outrank
 * a fresher read.
 */
function patchKeepingTime<T>(
	client: QueryClient,
	key: QueryKey,
	update: (current: T) => T,
) {
	const state = client.getQueryState<T>(key);
	if (state?.data === undefined) return;
	client.setQueryData<T>(key, update(state.data), {
		updatedAt: state.dataUpdatedAt,
	});
}

/**
 * Patch conversation-list rows from tenant unread rows (the watcher's poll),
 * so a list page nobody polls stops claiming an old count.
 */
export function patchTeamBridgeListsFromUnread(
	client: QueryClient,
	accountId: string,
	tenantId: string,
	unread: NonNullable<TeamBridgeUnread["conversations"]>,
): void {
	const byId = new Map(unread.map((row) => [row.conversation_id, row]));
	for (const query of client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.conversationsPrefix })) {
		if (!ownedBy(query.queryKey, accountId)) continue;
		patchKeepingTime<TeamBridgeConversationList>(
			client,
			query.queryKey,
			(page) => {
				let changed = false;
				const conversations = page.conversations.map((row) => {
					const next = row.tenant_id === tenantId ? byId.get(row.id) : null;
					/*
					 * Counts and the read cursor only, NEVER `latest_seq`: the
					 * notification planner pairs a list row with an unread row only
					 * when their `latest_seq` agree, because the list's sender label
					 * and thread root describe the list's own snapshot. Copying the
					 * seq across would pair a new seq with an old sender.
					 */
					if (
						!next ||
						(next.unread_count === row.unread_count &&
							next.last_read_seq === row.last_read_seq)
					)
						return row;
					changed = true;
					return {
						...row,
						unread_count: next.unread_count,
						last_read_seq: Math.max(next.last_read_seq, row.last_read_seq),
					};
				});
				return changed ? { ...page, conversations } : page;
			},
		);
	}
}

/**
 * The reader advanced their read cursor: clear the conversation's unread in
 * every cache that renders it - list rows, the tenant unread row, and the
 * aggregate's org count and total - in one synchronous pass, so the row and the
 * badge drop in the same render. Returns the prior entries for rollback.
 */
export function applyTeamBridgeReadCursor(
	client: QueryClient,
	accountId: string,
	target: { tenantId: string; conversationId: string; seq: number },
): TeamBridgeUnreadSnapshot {
	const before = teamBridgeUnreadView(client, accountId).rows.get(
		teamBridgeUnreadKey(target.tenantId, target.conversationId),
	);
	/*
	 * How much leaves the badge. A cursor that reaches the conversation's newest
	 * seq clears it; one short of it (a reply arrived after the newest top-level
	 * message) leaves the server to recount, so the patch claims nothing.
	 */
	const clears = before !== undefined && target.seq >= before.latestSeq;
	if (!clears) return [];
	const removed = before.muted ? 0 : before.unread;
	const snapshot: Array<readonly [QueryKey, unknown]> = [];
	const record = (key: QueryKey) =>
		snapshot.push([key, client.getQueryData(key)] as const);
	for (const query of client
		.getQueryCache()
		.findAll({ queryKey: teamBridgeKeys.conversationsPrefix })) {
		if (!ownedBy(query.queryKey, accountId)) continue;
		const page = query.state.data as TeamBridgeConversationList | undefined;
		if (
			!page?.conversations.some(
				(row) =>
					row.id === target.conversationId && row.tenant_id === target.tenantId,
			)
		)
			continue;
		record(query.queryKey);
		patchKeepingTime<TeamBridgeConversationList>(
			client,
			query.queryKey,
			(current) => ({
				...current,
				conversations: current.conversations.map((row) =>
					row.id === target.conversationId && row.tenant_id === target.tenantId
						? {
								...row,
								unread_count: 0,
								last_read_seq: Math.max(row.last_read_seq, target.seq),
							}
						: row,
				),
			}),
		);
	}
	const tenantKey = teamBridgeKeys.unread(
		asTeamBridgeTenantId(target.tenantId),
		accountId,
	);
	if (client.getQueryData(tenantKey) !== undefined) {
		record(tenantKey);
		patchKeepingTime<TeamBridgeUnread>(client, tenantKey, (current) => ({
			...current,
			total: Math.max(0, current.total - removed),
			conversations: current.conversations?.map((row) =>
				row.conversation_id === target.conversationId
					? {
							...row,
							unread_count: 0,
							last_read_seq: Math.max(row.last_read_seq, target.seq),
						}
					: row,
			),
		}));
	}
	const accountKey = teamBridgeKeys.unread(TEAM_BRIDGE_ALL_SCOPE, accountId);
	if (removed > 0 && client.getQueryData(accountKey) !== undefined) {
		record(accountKey);
		patchKeepingTime<TeamBridgeUnread>(client, accountKey, (current) => ({
			...current,
			total: Math.max(0, current.total - removed),
			organizations: current.organizations?.map((row) =>
				row.tenant_id === target.tenantId
					? { ...row, unread: Math.max(0, row.unread - removed) }
					: row,
			),
		}));
	}
	return snapshot;
}

export function restoreTeamBridgeUnreadSnapshot(
	client: QueryClient,
	snapshot: TeamBridgeUnreadSnapshot,
): void {
	for (const [key, data] of snapshot) {
		const at = client.getQueryState(key)?.dataUpdatedAt;
		client.setQueryData(key, data, at ? { updatedAt: at } : undefined);
	}
}
