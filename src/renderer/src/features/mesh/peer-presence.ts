import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { t } from "../../../../i18n";

/** Request-stamped device facts outlive a failed sessions read without inventing idle. */
export type PeerDeviceFact = {
	reachable: boolean;
	last_seen_at: number | null;
	reason: string | null;
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
	if (!fact) return row;
	const linkDown = !fact.reachable;
	if (
		row.link_down === linkDown &&
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
		last_seen_at: fact.last_seen_at,
		link_down_reason: fact.reason,
	};
}

export function peerLinkDownLabel(
	row: CanonicalSessionRow,
	nowSeconds = Date.now() / 1000,
): string {
	const seen = typeof row.last_seen_at === "number" ? row.last_seen_at : null;
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
	const seen = typeof row.last_seen_at === "number" ? row.last_seen_at : null;
	return t("ui.presence.link_down_compact", {
		age: lastSeenAge(seen, nowSeconds),
	});
}
