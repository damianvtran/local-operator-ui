import type {
	DesktopNotificationItem,
	DesktopNotificationsList,
	DesktopNotificationsWriteResult,
} from "../../../../shared/desktop-control-contract";
import type { DesktopFeedFrame } from "../../../../shared/desktop-session-contract";
import type {
	NotificationTarget,
	NotificationVerb,
} from "./notification-operations";
import { type NotificationFilters, filterItems } from "./notifications-model";

/**
 * Stateful evidence fixture, never a production transport. It implements the
 * pinned core's observation/cursor/revision contract so an all-target no-op or
 * stale Undo cannot masquerade as a passing story (D2/U2/Q7). Tests drive this
 * same fixture through the shipped operation planner; native CI uses REAL core.
 */
export function createNotificationFixture(
	items: DesktopNotificationItem[],
	waiting: DesktopNotificationItem[],
) {
	let highWater = Math.max(0, ...items.map((item) => item.seq));
	let frameSeq = 0;
	let failNext = false;
	const listeners = new Set<(frame: DesktopFeedFrame) => void>();
	const requests: { op: string; [key: string]: unknown }[] = [];
	const counts = () => ({
		unread_count: items.filter((item) => !item.read && !item.dismissed).length,
		waiting_count: waiting.length,
		waiting_unread_count: waiting.filter((item) => !item.read).length,
		high_water: highWater,
	});
	const publish = () => {
		const frame: DesktopFeedFrame = {
			epoch: "notifications-fixture",
			seq: ++frameSeq,
			type: "notifications",
			payload: { ...counts(), revision: highWater },
		};
		for (const listener of listeners) listener(frame);
	};
	const list = (request: {
		state?: string;
		source?: string;
		sessionId?: string;
		throughSeq?: number;
		cursor?: string;
		limit?: number;
	}): DesktopNotificationsList => {
		const boundary = Math.min(highWater, request.throughSeq ?? highWater);
		const cursor = Number(request.cursor ?? Number.MAX_SAFE_INTEGER);
		const pool = items
			.filter(
				(item) =>
					item.seq <= boundary &&
					item.seq < cursor &&
					(request.state === "dismissed" ? item.dismissed : !item.dismissed) &&
					(request.state !== "unread" || !item.read) &&
					(!request.sessionId || item.session.id === request.sessionId) &&
					request.source !== "ask",
			)
			.sort((a, b) => b.seq - a.seq);
		const page = pool.slice(0, request.limit ?? 50);
		const pinned =
			request.cursor ||
			request.source === "notify" ||
			request.state === "dismissed"
				? undefined
				: waiting.filter(
						(item) =>
							!request.sessionId || item.session.id === request.sessionId,
					);
		return structuredClone({
			...counts(),
			high_water: boundary,
			items: page,
			waiting: pinned,
			observed: [...page, ...(pinned ?? [])].map(({ id, revision }) => ({
				id,
				revision,
			})),
			next_cursor: pool.length > page.length ? String(page.at(-1)?.seq) : null,
		});
	};
	const patch = (
		verb: NotificationVerb,
		target: NotificationTarget,
	): DesktopNotificationsWriteResult => {
		const tokens = "items" in target ? target.items : target.observed;
		if (!tokens || (!("items" in target) && target.throughSeq === undefined))
			throw new Error("bulk needs observations");
		const result: DesktopNotificationsWriteResult = {
			...counts(),
			changed: [],
			skipped: [],
		};
		for (const token of tokens) {
			const item = [...items, ...waiting].find((row) => row.id === token.id);
			let reason:
				| DesktopNotificationsWriteResult["skipped"][number]["reason"]
				| null = null;
			if (
				!item ||
				("sessionId" in target && item.session.id !== target.sessionId)
			)
				reason = "unknown";
			else if (
				item.revision !== token.revision ||
				(!("items" in target) &&
					item.source === "notify" &&
					item.seq > target.throughSeq)
			)
				reason = "stale_revision";
			else if (
				item.source === "ask" &&
				(verb === "dismiss" || verb === "undismiss")
			)
				reason = "live_ask";
			else if (
				(verb === "read" && item.read) ||
				(verb === "unread" && !item.read) ||
				(verb === "dismiss" && item.dismissed) ||
				(verb === "undismiss" && !item.dismissed)
			)
				reason = "already";
			if (reason) {
				result.skipped.push({ id: token.id, reason });
				continue;
			}
			if (!item) continue;
			if (verb === "read" || verb === "unread") {
				item.read = verb === "read";
				item.read_via = item.read ? "explicit" : null;
			} else item.dismissed = verb === "dismiss";
			item.seq = ++highWater;
			result.changed.push(item.id);
		}
		Object.assign(result, counts());
		publish();
		return structuredClone(result);
	};
	// Fixture-only server snapshots/journals. The renderer never receives the
	// captured rows: these model core's opaque-token route, including same-seq
	// fences and Undo refusing a later write rather than clobbering it.
	type Snapshot = {
		rows: DesktopNotificationItem[];
		asks: number;
		boundary: number;
		v2?: boolean;
		sessions: string[];
		signature?: string;
		receipt?: BulkReceipt;
	};
	type BulkReceipt = {
		selection_version?: 2;
		changed_update_count: number;
		changed_ask_count: number;
		waiting_unread_delta: number;
		counts_high_water: number;
		changed_count: number;
		skipped_count: number;
		skipped_ask_count: number;
		eligible_count: number;
		excluded_count: number;
		unread_delta: number;
		session_counts: Record<
			string,
			{
				changed_count: number;
				unread_delta: number;
				waiting_unread_delta: number;
				unread_count: number;
			}
		>;
		operation_token: string;
		through_seq: number;
		expires_at: number;
		replayed: boolean;
		unread_count: number;
		waiting_count: number;
		waiting_unread_count: number;
		high_water: number;
	};
	const snapshots = new Map<string, Snapshot>();
	const journals = new Map<
		string,
		{
			rows: { before: DesktopNotificationItem; postSeq: number }[];
			undone?: BulkReceipt;
			v2?: boolean;
		}
	>();
	const preview = (request: {
		state?: string;
		kind?: string;
		bulkPriority?: string;
		sessionId?: string;
		countSessionIds?: string[];
		includeAskReads?: boolean;
	}) => {
		const filters: NotificationFilters = {
			kind: (request.kind ?? "all") as NotificationFilters["kind"],
			priority: (request.bulkPriority ??
				"any") as NotificationFilters["priority"],
			from: request.sessionId ?? null,
		};
		const rows = filterItems(items, filters).filter(
			(row) => request.state !== "unread" || !row.read,
		);
		const askRows = filterItems(waiting, filters);
		const v2 = Boolean(request.includeAskReads);
		const token = `fixture-selection-${snapshots.size + 1}`;
		snapshots.set(token, {
			rows: structuredClone([...rows, ...(v2 ? askRows : [])]),
			asks: askRows.length,
			boundary: highWater,
			v2,
			sessions: request.countSessionIds ?? [],
		});
		const totals = (
			updates: DesktopNotificationItem[],
			asks: DesktopNotificationItem[],
		) => ({
			eligible_count: updates.length + (v2 ? asks.length : 0),
			eligible_unread_count:
				updates.filter((row) => !row.read).length +
				(v2 ? asks.filter((row) => !row.read).length : 0),
			...(v2
				? {
						eligible_update_count: updates.length,
						eligible_unread_update_count: updates.filter((row) => !row.read)
							.length,
						eligible_ask_count: asks.length,
						eligible_unread_ask_count: asks.filter((row) => !row.read).length,
					}
				: {}),
		});
		return {
			selection: {
				token,
				through_seq: highWater,
				expires_at: Date.now() + 600_000,
				...totals(rows, askRows),
				skipped_ask_count: v2 ? 0 : askRows.length,
				session_counts: Object.fromEntries(
					(request.countSessionIds ?? []).map((id) => [
						id,
						totals(
							rows.filter((row) => row.session.id === id),
							askRows.filter((row) => row.session.id === id),
						),
					]),
				),
				...(v2
					? {
							selection_version: 2,
							operation_counts: {
								read: {
									eligible_count: rows.length + askRows.length,
									skipped_ask_count: 0,
								},
								unread: {
									eligible_count: rows.length + askRows.length,
									skipped_ask_count: 0,
								},
								dismiss: {
									eligible_count: rows.length,
									skipped_ask_count: askRows.length,
								},
								undismiss: {
									eligible_count: rows.length,
									skipped_ask_count: askRows.length,
								},
							},
						}
					: {}),
			},
		};
	};
	const withReconciliation = (receipt: BulkReceipt, ids?: string[]) => ({
		...structuredClone(receipt),
		...counts(),
		...(ids
			? {
					reconciliation: {
						items: structuredClone(
							[...items, ...waiting].filter((row) => ids.includes(row.id)),
						),
						absent_ids: ids.filter(
							(id) => ![...items, ...waiting].some((row) => row.id === id),
						),
						high_water: highWater,
					},
				}
			: {}),
	});

	const bulkPatch = (
		verb: string,
		target: {
			selectionToken?: string;
			excludedIds?: string[];
			operationToken?: string;
			items?: { id: string; revision: number }[];
			throughSeq?: number;
			reconcileIds?: string[];
		},
	) => {
		const beforeCount = counts().unread_count;
		const beforeAskCount = counts().waiting_unread_count;
		let v2 = Boolean(target.reconcileIds);
		const session_counts: BulkReceipt["session_counts"] = {};
		const operationToken = `fixture-operation-${journals.size + 1}`;
		let skipped = 0;
		const changed: { before: DesktopNotificationItem; postSeq: number }[] = [];
		const apply = (
			row: DesktopNotificationItem,
			desired: DesktopNotificationItem,
		) => {
			const before = structuredClone(row);
			const unreadBefore = !row.read && !row.dismissed;
			row.read = desired.read;
			row.dismissed = desired.dismissed;
			row.read_via = row.read ? "explicit" : null;
			row.seq = ++highWater;
			changed.push({ before, postSeq: row.seq });
			const own = session_counts[row.session.id] ?? {
				changed_count: 0,
				unread_delta: 0,
				waiting_unread_delta: 0,
				unread_count: 0,
			};
			own.changed_count++;
			if (row.source === "ask")
				own.waiting_unread_delta += Number(!row.read) - Number(unreadBefore);
			else
				own.unread_delta +=
					Number(!row.read && !row.dismissed) - Number(unreadBefore);
			session_counts[row.session.id] = own;
		};
		let snapshot: Snapshot | undefined;
		let excluded = 0;
		let eligible = 0;
		if (verb === "undo") {
			const journal = journals.get(target.operationToken ?? "");
			if (!journal) throw new Error("unknown operation token");
			if (journal.undone)
				return withReconciliation(
					{ ...journal.undone, replayed: true },
					target.reconcileIds,
				);
			v2 ||= Boolean(journal.v2);
			eligible = journal.rows.length;
			for (const entry of journal.rows) {
				const row = [...items, ...waiting].find(
					(candidate) => candidate.id === entry.before.id,
				);
				if (
					!row ||
					row.seq !== entry.postSeq ||
					row.revision !== entry.before.revision
				) {
					skipped++;
					continue;
				}
				apply(row, entry.before);
			}
		} else {
			const exclusion = new Set(target.excludedIds ?? []);
			const signature = JSON.stringify([verb, [...exclusion].sort()]);
			snapshot = target.selectionToken
				? snapshots.get(target.selectionToken)
				: undefined;
			if (target.selectionToken && !snapshot)
				throw new Error("unknown selection token");
			if (snapshot?.receipt) {
				if (snapshot.signature !== signature)
					throw new Error("selection_operation_conflict");
				return withReconciliation(
					{ ...snapshot.receipt, replayed: true },
					target.reconcileIds,
				);
			}
			v2 ||= Boolean(snapshot?.v2);
			const captured =
				snapshot?.rows ??
				(target.items ?? [])
					.map((token) => {
						const row = [...items, ...waiting].find(
							(candidate) => candidate.id === token.id,
						);
						return row ? { ...row, revision: token.revision } : null;
					})
					.filter((row): row is DesktopNotificationItem => row !== null);
			for (const prior of captured) {
				if (exclusion.has(prior.id)) {
					excluded++;
					continue;
				}
				if (prior.source === "ask" && (!snapshot?.v2 || verb === "dismiss"))
					continue;
				eligible++;
				const row = [...items, ...waiting].find(
					(candidate) => candidate.id === prior.id,
				);
				if (
					!row ||
					row.revision !== prior.revision ||
					(prior.source === "ask"
						? row.seq !== prior.seq
						: row.seq > (snapshot?.boundary ?? target.throughSeq ?? 0))
				) {
					skipped++;
					continue;
				}
				const desired = {
					...row,
					read: verb === "read" ? true : verb === "unread" ? false : row.read,
					dismissed: verb === "dismiss" ? true : row.dismissed,
				};
				if (row.read === desired.read && row.dismissed === desired.dismissed) {
					skipped++;
					continue;
				}
				apply(row, desired);
			}
			if (snapshot) snapshot.signature = signature;
		}
		for (const id of new Set([
			...(snapshot?.sessions ?? []),
			...Object.keys(session_counts),
		])) {
			const own = session_counts[id] ?? {
				changed_count: 0,
				unread_delta: 0,
				waiting_unread_delta: 0,
				unread_count: 0,
			};
			own.unread_count = items.filter(
				(row) => row.session.id === id && !row.read && !row.dismissed,
			).length;
			session_counts[id] = own;
		}
		const receipt: BulkReceipt = {
			...(v2 ? { selection_version: 2 as const } : {}),
			changed_update_count: changed.filter(
				(row) => row.before.source === "notify",
			).length,
			changed_ask_count: changed.filter((row) => row.before.source === "ask")
				.length,
			waiting_unread_delta: counts().waiting_unread_count - beforeAskCount,
			counts_high_water: highWater,
			...counts(),
			changed_count: changed.length,
			skipped_count: skipped,
			skipped_ask_count:
				snapshot?.v2 && verb !== "dismiss" ? 0 : (snapshot?.asks ?? 0),
			eligible_count: eligible,
			excluded_count: excluded,
			unread_delta: counts().unread_count - beforeCount,
			session_counts,
			operation_token: operationToken,
			through_seq: highWater,
			expires_at: Date.now() + 600_000,
			replayed: false,
		};
		journals.set(operationToken, { rows: changed, v2 });
		if (snapshot) snapshot.receipt = receipt;
		if (verb === "undo") {
			const journal = journals.get(target.operationToken ?? "");
			if (journal) journal.undone = receipt;
		}
		publish();
		return withReconciliation(receipt, target.reconcileIds);
	};

	/**
	 * The FAILURE-capable send the planner is driven with: a fixture write error
	 * must stop a batch and report "not confirmed", never look like a no-op.
	 */
	const send = async (verb: NotificationVerb, target: NotificationTarget) => {
		if (failNext) {
			failNext = false;
			throw new Error("Fixture write failure; no write applied");
		}
		return patch(verb, target);
	};
	return {
		send,
		requests,
		counts,
		list,
		patch,
		publish,
		feed: {
			watchState(callback: (state: { connected: boolean }) => void) {
				callback({ connected: true });
				return () => {};
			},
			subscribe(callback: (frame: DesktopFeedFrame) => void) {
				listeners.add(callback);
				return () => {
					listeners.delete(callback);
				};
			},
		},
		/**
		 * A NEW row arrives (code round 5, R5-3). `revise` re-stamps an existing row;
		 * a real arrival is a different event - a new id, a new seq and a fresh unread
		 * row - and only this can show a count that grew.
		 */
		arrive(item: DesktopNotificationItem) {
			const next = { ...item, seq: ++highWater, read: false, dismissed: false };
			items.unshift(next);
			publish();
			return next;
		},
		arriveAsk(next: DesktopNotificationItem) {
			waiting.push(next);
			publish();
		},
		/** Ask changes intentionally preserve notify high-water (R1 regression). */
		replaceAsk(next: DesktopNotificationItem) {
			waiting.splice(0, waiting.length, next);
			publish();
		},
		revise(id: string) {
			const item = items.find((row) => row.id === id);
			if (item) {
				item.revision++;
				item.seq = ++highWater;
				item.updated_at = Date.now();
				item.read = false;
				publish();
			}
		},
		failNextWrite() {
			failNext = true;
		},
		request(request: { op: string; [key: string]: unknown }) {
			requests.push(structuredClone(request));
			if (request.op === "notifications.list")
				return {
					status: 200,
					body: {
						result: request.preview
							? preview(request as Parameters<typeof preview>[0])
							: list(request as Parameters<typeof list>[0]),
					},
				};
			if (request.op === "notifications.count")
				return { status: 200, body: { result: counts() } };
			if (
				request.op === "notifications.read" ||
				request.op === "notifications.dismiss"
			) {
				if (failNext) {
					failNext = false;
					return {
						status: 503,
						body: { detail: "Fixture write failure; no write applied" },
					};
				}
				return {
					status: 200,
					body: {
						result: (() => {
							const target = request.target as Parameters<
								typeof bulkPatch
							>[1] & { receipt?: boolean };
							return target.selectionToken ||
								target.operationToken ||
								target.receipt
								? bulkPatch(String(request.verb), target)
								: patch(
										request.verb as NotificationVerb,
										request.target as NotificationTarget,
									);
						})(),
					},
				};
			}
			return undefined;
		},
	};
}
