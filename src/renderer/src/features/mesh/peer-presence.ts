import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { t } from "../../../../i18n";
import { deviceReach, reachWords } from "./mesh-reach";

/** Request-stamped device facts outlive a failed sessions read without inventing idle. */
export type PeerDeviceFact = {
	reachable: boolean;
	last_seen_at: number | null;
	session_count?: number | null;
	reason: string | null;
	/**
	 * The relay's redial verdict for a lost link (`PeerRow.redial.state`), or
	 * `null`/absent when it made none — an older backend, or a link that is up.
	 */
	redial_state?: "reconnecting" | "down" | null;
	at: number;
};

export function mergePeerDeviceFacts(
	held: Record<string, PeerDeviceFact>,
	incoming: Record<string, PeerDeviceFact>,
) {
	const next = { ...held };
	for (const [id, fact] of Object.entries(incoming)) {
		if (!next[id] || fact.at >= next[id].at) next[id] = fact;
	}
	return next;
}

export function applyPeerDeviceFact(
	row: CanonicalSessionRow,
	facts: Record<string, PeerDeviceFact>,
): CanonicalSessionRow {
	if (row.locality !== "remote" || typeof row.owner_device !== "string")
		return row;
	const fact = facts[row.owner_device];
	if (!fact) {
		// Removal lapses the old projection even when a newer placement protects the
		// row from pruning. Unknown is not an assertion that the owner became idle.
		return row.peer_reach || row.link_down
			? {
					...row,
					peer_reach: "unknown",
					link_down: false,
					link_reconnecting: false,
					reachable: false,
					link_down_reason: null,
					last_seen_at: null,
				}
			: row;
	}
	const reach = deviceReach({
		state: "unreachable",
		reachable: fact.reachable,
		reason: fact.reason ?? "",
		sessionCount: fact.session_count ?? null,
	});
	const linkDown = reach === "unanswered";
	// SOFTENED, NEVER HIDDEN: inside the relay's grace window the row is still
	// link-down for every guard, and only says so less loudly (2026-10-21: a
	// 14:45 drop read "Link down · unknown" on the first missed beat).
	const reconnecting = linkDown && fact.redial_state === "reconnecting";
	if (
		row.peer_reach === reach &&
		row.link_down === linkDown &&
		(row.link_reconnecting ?? false) === reconnecting &&
		row.reachable === fact.reachable &&
		row.last_seen_at === fact.last_seen_at &&
		row.link_down_reason === fact.reason
	)
		return row;
	// A held session's reachable=true predates the device answer. Keep its status and slot,
	// but never let that stale session claim beat a newer device-link observation.
	return {
		...row,
		reachable: fact.reachable,
		link_down: linkDown,
		link_reconnecting: reconnecting,
		peer_reach: reach,
		last_seen_at: fact.last_seen_at,
		link_down_reason: fact.reason,
	};
}

export function peerLinkDownLabel(
	row: CanonicalSessionRow,
	nowSeconds = Date.now() / 1000,
): string {
	const seen = typeof row.last_seen_at === "number" ? row.last_seen_at : null;
	if (row.link_reconnecting === true)
		// Two already-translated fragments joined by the row's own separator: a new
		// presence sentence would stale every audited ui.presence ledger entry and
		// grow the shrink-only coverage allowance (see the PR for the follow-up).
		return `${t("ui.chat.canonical.transcript.reconnecting")} · ${lastSeenAge(seen, nowSeconds)}`;
	return t("ui.presence.link_down_last_seen", {
		age: lastSeenAge(seen, nowSeconds),
	});
}

export function lastSeenAge(seen: number | null, nowSeconds: number): string {
	if (seen === null) return t("ui.presence.unknown");
	const seconds = Math.max(0, Math.floor(nowSeconds - seen));
	if (seconds < 60) return t("ui.presence.just_now");
	if (seconds < 3600)
		return t("ui.presence.minutes_ago", {
			count: Math.floor(seconds / 60),
		});
	if (seconds < 86400)
		return t("ui.presence.hours_ago", {
			count: Math.floor(seconds / 3600),
		});
	return t("ui.presence.days_ago", { count: Math.floor(seconds / 86400) });
}

/** The fixed trailing slot stays compact; the status mark/tooltip carry the full last-seen sentence. */
export function peerLinkDownVisibleLabel(
	row: CanonicalSessionRow,
	nowSeconds: number,
): string {
	if (row.link_reconnecting === true)
		return t("ui.chat.canonical.transcript.reconnecting");
	const seen = typeof row.last_seen_at === "number" ? row.last_seen_at : null;
	return t("ui.presence.link_down_compact", {
		age: lastSeenAge(seen, nowSeconds),
	});
}

/** A complete snapshot can remove facts, so its watermark also orders absent IDs.
 * Without it, a delayed pre-removal answer could resurrect a device we no longer share.
 */
export function reconcilePeerDeviceSnapshot(
	held: Record<string, PeerDeviceFact>,
	incoming: Record<string, PeerDeviceFact>,
	watermark: number,
	requestedAt: number,
): {
	facts: Record<string, PeerDeviceFact>;
	watermark: number;
	removed: string[];
} {
	if (requestedAt <= watermark) return { facts: held, watermark, removed: [] };
	const facts = Object.fromEntries(
		Object.entries(held).filter(([, fact]) => fact.at > requestedAt),
	);
	for (const [id, fact] of Object.entries(incoming)) {
		if (!facts[id] || fact.at >= facts[id].at) facts[id] = fact;
	}
	return {
		facts,
		watermark: requestedAt,
		removed: Object.keys(held).filter((id) => !facts[id]),
	};
}

export function peerUncertainLabel(row: CanonicalSessionRow): string | null {
	return row.peer_reach === "not-attempted" || row.peer_reach === "unknown"
		? reachWords(row.peer_reach)
		: null;
}
