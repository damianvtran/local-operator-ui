import type {
	DesktopNotificationToken,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../shared/desktop-control-contract";

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
