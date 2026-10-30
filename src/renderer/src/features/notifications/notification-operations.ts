import type {
	DesktopNotificationItem,
	DesktopNotificationToken,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../shared/desktop-control-contract";
import {
	type NotificationFilters,
	filterItems,
	isLiveAsk,
} from "./notifications-model";

export type NotificationVerb = "read" | "unread" | "dismiss" | "undismiss";
export type NotificationScope = { all: true } | { sessionId: string };
export type NotificationTarget =
	| { items: DesktopNotificationToken[] }
	| (NotificationScope & {
			throughSeq: number;
			observed: DesktopNotificationToken[];
	  });
export type PageRequest = {
	state: "unread" | "all";
	limit: number;
	throughSeq: number;
	sessionId?: string;
	source?: "notify";
	cursor?: string;
};
export type NotificationSnapshot = Readonly<{
	scope: Readonly<NotificationScope>;
	throughSeq: number;
	tokens: readonly Readonly<DesktopNotificationToken>[];
}>;

/**
 * ALL is the intended global inbox or whole conversation, not the current
 * filter or loaded page. Capture the rendered boundary and first waiting set
 * before any await. Enumerate notify pages below that boundary; later ask sets
 * and new/revised rows may not widen the gesture. The completed frozen snapshot
 * is what the confirmation owns (R2/Q2), including its exact count.
 */
export async function observeNotificationScope(
	readPage: (request: PageRequest) => Promise<DesktopNotificationsList>,
	input: {
		scope: NotificationScope;
		throughSeq: number;
		waiting: readonly DesktopNotificationToken[];
		verb: "read" | "dismiss";
	},
): Promise<NotificationSnapshot> {
	const scope = Object.freeze({ ...input.scope });
	const throughSeq = input.throughSeq;
	const tokens = new Map<string, Readonly<DesktopNotificationToken>>();
	if (input.verb === "read" && "all" in scope) {
		for (const token of input.waiting)
			tokens.set(token.id, Object.freeze({ ...token }));
	}
	let cursor: string | undefined;
	const cursors = new Set<string>();
	do {
		const page = await readPage({
			state: input.verb === "read" ? "unread" : "all",
			limit: 100,
			throughSeq,
			source: "notify",
			...("sessionId" in scope ? { sessionId: scope.sessionId } : {}),
			...(cursor ? { cursor } : {}),
		});
		// Observed is the server's assertion about this page, not a token list
		// synthesized from whichever refreshed query happens to be in React.
		for (const token of page.observed) {
			if (!token.id.startsWith("ask:") && !tokens.has(token.id))
				tokens.set(token.id, Object.freeze({ ...token }));
		}
		cursor = page.next_cursor || undefined;
		if (cursor && cursors.has(cursor))
			throw new Error("Notification cursor did not advance");
		if (cursor) cursors.add(cursor);
	} while (cursor);
	return Object.freeze({
		scope,
		throughSeq,
		tokens: Object.freeze([...tokens.values()]),
	});
}

export type OperationProgress = {
	changed: number;
	skipped: number;
	pending: number;
};
export type NotificationReceipt = {
	changed: DesktopNotificationToken[];
	skipped: DesktopNotificationsWriteResult["skipped"];
	pending: DesktopNotificationToken[];
	error?: unknown;
};
export const receiptProgress = (
	receipt: NotificationReceipt,
): OperationProgress => ({
	changed: receipt.changed.length,
	skipped: receipt.skipped.length,
	pending: receipt.pending.length,
});
/**
 * The only state that earns the word "Restored": every named token confirmed
 * changed, nothing skipped, nothing left unconfirmed. A partial inverse keeps
 * the three-way receipt on screen instead (R3/Q3).
 */
export const isCompleteInverse = (
	receipt: NotificationReceipt,
	expected: number,
): boolean =>
	receipt.changed.length === expected &&
	receipt.skipped.length === 0 &&
	receipt.pending.length === 0 &&
	receipt.error === undefined;

export const inverseNotificationVerb = (
	verb: NotificationVerb,
): NotificationVerb =>
	verb === "read"
		? "unread"
		: verb === "unread"
			? "read"
			: verb === "dismiss"
				? "undismiss"
				: "dismiss";

/**
 * One receipt ledger for pointer and keyboard Undo. Every request is bounded
 * to 500 tokens, and every inverse retains the ORIGINAL id/revision. On a lost
 * response do not retry silently (the server may have committed): stop, retain
 * confirmed successes, and name the remaining tokens "not confirmed". Never
 * manufacture inverse tokens by fetching a newer revision (R3/Q3).
 */
export async function applyNotificationOperation(
	send: (
		verb: NotificationVerb,
		target: NotificationTarget,
	) => Promise<DesktopNotificationsWriteResult>,
	verb: NotificationVerb,
	tokens: readonly Readonly<DesktopNotificationToken>[],
	snapshot?: NotificationSnapshot,
	onProgress?: (progress: OperationProgress) => void,
): Promise<NotificationReceipt> {
	const captured = [
		...new Map(tokens.map((token) => [token.id, { ...token }])).values(),
	];
	const receipt: NotificationReceipt = {
		changed: [],
		skipped: [],
		pending: captured,
	};
	const confirmed = new Set<string>();
	onProgress?.(receiptProgress(receipt));
	for (let index = 0; index < captured.length; index += 500) {
		const batch = captured.slice(index, index + 500);
		const byId = new Map(batch.map((token) => [token.id, token]));
		try {
			const result = await send(
				verb,
				snapshot
					? {
							...snapshot.scope,
							throughSeq: snapshot.throughSeq,
							observed: batch,
						}
					: { items: batch },
			);
			for (const id of result.changed) {
				const token = byId.get(id);
				if (token && !confirmed.has(id)) {
					receipt.changed.push(token);
					confirmed.add(id);
				}
			}
			for (const skip of result.skipped) {
				if (byId.has(skip.id) && !confirmed.has(skip.id)) {
					receipt.skipped.push(skip);
					confirmed.add(skip.id);
				}
			}
		} catch (error) {
			receipt.error = error;
		}
		receipt.pending = captured.filter((token) => !confirmed.has(token.id));
		onProgress?.(receiptProgress(receipt));
		if (receipt.error) break;
	}
	return receipt;
}

/** Server-owned frozen result; its size is independent of the loaded page. */

export type NotificationSelectionSubtotals = {
	eligible_count: number;
	eligible_unread_count: number;
	eligible_update_count?: number;
	eligible_unread_update_count?: number;
	eligible_ask_count?: number;
	eligible_unread_ask_count?: number;
};
export type NotificationSelectionPreview = NotificationSelectionSubtotals & {
	token: string;
	through_seq: number;
	expires_at: number;
	selection_version?: 1 | 2;
	session_counts: Record<string, NotificationSelectionSubtotals>;
	skipped_ask_count: number;
	operation_counts?: Record<
		NotificationVerb,
		{ eligible_count: number; skipped_ask_count: number }
	>;
};
export type FrozenNotificationSelection = {
	preview: NotificationSelectionPreview;
	/** Both the advertised capability and v2 receipt are needed for ask reads. */
	includeAskReads?: boolean;
	filters: NotificationFilters;
	state: "unread" | "all";
	/** Keep observed row facts so count subtraction does not change on refresh. */
	excluded: ReadonlyMap<string, DesktopNotificationItem>;
	asks: readonly DesktopNotificationItem[];
};

/** A new arrival or revised row never silently joins an earlier gesture. */
export function selectedBySnapshot(
	item: DesktopNotificationItem,
	selection: FrozenNotificationSelection,
): boolean {
	if (selection.excluded.has(item.id)) return false;
	if (isLiveAsk(item)) return selection.asks.some((ask) => ask.id === item.id);
	return (
		item.seq <= selection.preview.through_seq &&
		(selection.state === "all" || !item.read) &&
		filterItems([item], selection.filters).length === 1
	);
}

export const frozenReadsAsks = (
	selection: FrozenNotificationSelection,
): boolean =>
	selection.includeAskReads === true &&
	selection.preview.selection_version === 2;

export function frozenSelectionCounts(selection: FrozenNotificationSelection) {
	const excluded = [...selection.excluded.values()];
	const excludedAsks = excluded.filter(isLiveAsk);
	const updates = excluded.filter((item) => !isLiveAsk(item));
	const preview = selection.preview;
	const asks = Math.max(
		0,
		(preview.eligible_ask_count ?? preview.skipped_ask_count) -
			excludedAsks.length,
	);
	const eligible = Math.max(
		0,
		(preview.eligible_update_count ?? preview.eligible_count) - updates.length,
	);
	const updateUnread = Math.max(
		0,
		(preview.eligible_unread_update_count ?? preview.eligible_unread_count) -
			updates.filter((item) => !item.read).length,
	);
	const askUnread = Math.max(
		0,
		(preview.eligible_unread_ask_count ?? 0) -
			excludedAsks.filter((item) => !item.read).length,
	);
	return {
		count: eligible + asks,
		asks,
		eligible,
		updateUnread,
		askUnread,
		readable: eligible + (frozenReadsAsks(selection) ? asks : 0),
		unread: updateUnread + (frozenReadsAsks(selection) ? askUnread : 0),
	};
}

/** TOTAL projected deltas: the shared ledger subtracts its known-row contribution. */
export function notificationSelectionScope(
	selection: FrozenNotificationSelection,
	verb: "read" | "unread" | "dismiss",
) {
	const counts = frozenSelectionCounts(selection);
	const delta = (total: number, unread: number) =>
		verb === "unread" ? total - unread : -unread;
	const sessionUnreadDeltas: Record<string, number> = {};
	for (const [id, totals] of Object.entries(selection.preview.session_counts)) {
		const excluded = [...selection.excluded.values()].filter(
			(item) => item.source === "notify" && item.session.id === id,
		);
		const total = Math.max(
			0,
			(totals.eligible_update_count ?? totals.eligible_count) - excluded.length,
		);
		const unread = Math.max(
			0,
			(totals.eligible_unread_update_count ?? totals.eligible_unread_count) -
				excluded.filter((item) => !item.read).length,
		);
		sessionUnreadDeltas[id] = delta(total, unread);
	}
	return {
		throughSeq: selection.preview.through_seq,
		unreadDelta: delta(counts.eligible, counts.updateUnread),
		waitingUnreadDelta:
			frozenReadsAsks(selection) && verb !== "dismiss"
				? delta(counts.asks, counts.askUnread)
				: 0,
		sessionUnreadDeltas,
	};
}
