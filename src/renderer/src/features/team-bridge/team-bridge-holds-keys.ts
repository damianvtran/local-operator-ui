/**
 * Query keys for Team Bridge held messages, and what a decision refreshes.
 *
 * Kept free of React so `scripts/team-bridge-holds.test.mjs` can drive the
 * real invalidation against a real `QueryClient` and count hub reads.
 *
 * WHY A DECISION REFRESHES SO LITTLE (review r2 M2). Every per-hold detail
 * lookup is an owner-audit history read that core proxies to the hub, and the
 * hub charges each one to the person's shared `conversation-reads` budget
 * (120/min, the same bucket chat, inbox and badges draw from). Invalidating
 * the whole `holds` prefix after each Deliver/Discard re-read EVERY held
 * message's details: 36 holds and three decisions cost 144 reads in a minute.
 * Only two things change when one hold is decided: the hold list (its
 * `decision`) and, at most, that one message. The other bodies did not move,
 * and the daemon's `snapshot_stale` check still refuses a decision bound to a
 * body that changed in the meantime.
 */
import type { QueryClient } from "@tanstack/react-query";
import { teamBridgeKeys } from "./team-bridge-keys";

export const holdsKey = (accountId?: string) =>
	[...teamBridgeKeys.all, "holds", accountId ?? "unresolved-owner"] as const;

/** One owner-audit lookup for one held message (see the details hook). */
export const holdDetailKey = (
	accountId: string | undefined,
	item: {
		conversation_id: string;
		message_id: string;
		seq: number | null;
		thread_root_id?: string | null;
		discard_receipt?: string | null;
	},
	tenantIds: readonly string[],
) =>
	[
		...holdsKey(accountId),
		"detail",
		item.conversation_id,
		item.message_id,
		item.seq,
		// A core upgrade that starts serving the root must re-read, not reuse
		// the timeline miss cached under the same key.
		item.thread_root_id ?? null,
		tenantIds.join(","),
		// A replacement hold with the same message coordinates needs its own
		// settled audit proof; never borrow the previous revision's read.
		item.discard_receipt ?? null,
	] as const;

/** The local hash of one held message's shown body. */
export const holdBindingKey = (
	accountId: string | undefined,
	messageId: string,
	bodyHash: string | null,
	body: string | null,
) => [...holdsKey(accountId), "binding", messageId, bodyHash, body] as const;

/**
 * After one decision: the hold list, plus that message's own lookup and
 * binding. Nothing else under the prefix is touched.
 */
export function invalidateAfterDecision(
	client: Pick<QueryClient, "invalidateQueries">,
	accountId: string | undefined,
	messageId: string,
) {
	const base = holdsKey(accountId);
	return Promise.all([
		client.invalidateQueries({ queryKey: base, exact: true }),
		client.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				if (key.length <= base.length) return false;
				if (!base.every((part, index) => key[index] === part)) return false;
				const kind = key[base.length];
				// detail: [...base, "detail", conversation, message, ...]
				// binding: [...base, "binding", message, ...]
				return (
					(kind === "detail" && key[base.length + 2] === messageId) ||
					(kind === "binding" && key[base.length + 1] === messageId)
				);
			},
		}),
	]);
}
