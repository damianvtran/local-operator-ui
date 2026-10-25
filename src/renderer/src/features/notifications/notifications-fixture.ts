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
					body: { result: list(request as Parameters<typeof list>[0]) },
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
						result: patch(
							request.verb as NotificationVerb,
							request.target as NotificationTarget,
						),
					},
				};
			}
			return undefined;
		},
	};
}
