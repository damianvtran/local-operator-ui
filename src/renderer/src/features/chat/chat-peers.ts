/**
 * The sidebar's peer partition: which conversations are this device's, which are
 * a peer's, and what each peer's section heading says.
 *
 * A PURE MODULE, like `chat-sections.ts` beside it, so the partition can be
 * exercised by bundling this file and calling it (`chat-sidebar-peers.test.mjs`)
 * rather than by reading class strings off a render.
 *
 * THE GATE IS A PARAMETER, and "disabled" is the identity: with `features.peers`
 * absent every function here returns its input unchanged (the same array, not a
 * copy) or nothing at all. That is the whole of the no-regression promise for a
 * user without a network - the sidebar's own code paths then see exactly the
 * arrays they saw before this module existed.
 *
 * `locality` is READ, never derived (`mesh-ui.md` §2.6, spine §8). A row with no
 * `locality` is a local row: a pre-mesh backend sends none, and treating absence
 * as "remote" would file every conversation under a peer that does not exist.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import type { PeerRow } from "../../../../shared/desktop-session-contract";
import { deviceLabel } from "./peers-store";

export const isRemoteRow = (row: CanonicalSessionRow): boolean =>
	row.locality === "remote";

/** The rows `Active chats`/`Previous chats` draw: this device's own. */
export function localRows<T extends CanonicalSessionRow>(
	rows: T[],
	enabled: boolean,
): T[] {
	if (!enabled) return rows;
	return rows.filter((row) => !isRemoteRow(row));
}

/**
 * Whether a peer is reachable, as ONE predicate for the mark and the heading.
 *
 * The two read different fetches (the row from the session list, the heading from
 * the peer catalogue), and the design's rule is that they must agree in every
 * state (`mesh-ui.md` §2.5, S4) - a frame where the heading says unreachable and
 * the row's mark says live is a defect. So both ask this: the peer catalogue's
 * answer wins when it has one (it is the fresher, live probe), and the row's own
 * flag answers only for a device the catalogue does not list.
 */
export function peerReachable(
	row: Pick<CanonicalSessionRow, "owner_device" | "reachable">,
	peers: ReadonlyMap<string, PeerRow>,
): boolean {
	const peer = row.owner_device ? peers.get(row.owner_device) : undefined;
	if (peer) return peer.reachable;
	return row.reachable !== false;
}

/** The backend's sentence for why, from the catalogue first, else the row. */
export function peerReason(
	row: Pick<CanonicalSessionRow, "owner_device" | "unreachable_reason">,
	peers: ReadonlyMap<string, PeerRow>,
): string {
	const peer = row.owner_device ? peers.get(row.owner_device) : undefined;
	return (peer?.unreachable_reason || row.unreachable_reason || "").trim();
}

/** A remote row's owner, as the label every surface spells it. */
export function ownerLabel(
	row: Pick<CanonicalSessionRow, "owner_device" | "owner_device_name">,
	peers: ReadonlyMap<string, PeerRow>,
): string {
	const id = row.owner_device ?? "";
	const peer = id ? peers.get(id) : undefined;
	if (peer) return deviceLabel(peer);
	return deviceLabel({ device_id: id, name: row.owner_device_name ?? "" });
}

export type PeerSection = {
	/** The device id: the section's React key and disclosure key. */
	deviceId: string;
	/** The heading text, `⇄` included, with the state suffix when not live. */
	heading: string;
	/** The device's label alone, for sentences that name it. */
	label: string;
	reachable: boolean;
	rows: CanonicalSessionRow[];
};

/**
 * The heading's state suffix, in the design's copy (`mesh-ui.md` §2.4).
 *
 * `· unreachable` and `· draining` are the TWO states the heading names; the
 * reason itself is the tooltip's and S5's, not the heading's, because a sentence
 * in a `truncate` span at 240 px would be cut to a word.
 */
function headingSuffix(reachable: boolean, lifecycle: string | undefined) {
	if (!reachable) return " · unreachable";
	if (lifecycle === "draining" || lifecycle === "expiring")
		return " · draining";
	return "";
}

/**
 * One section per peer, in the peer catalogue's order, then any device the rows
 * name that the catalogue does not (a cached row of a peer the last catalogue read
 * omitted still needs a home - dropping it would hide a conversation).
 *
 * A catalogue peer with ZERO rows still gets its section: the count says which
 * peer is quiet, and there is no other place in the chats list to say it
 * (`mesh-ui.md` §2.4). Keyed on the DEVICE ID, never the label - two devices may
 * share a human name, and a section keyed on the label would merge them.
 */
export function peerSections(
	rows: CanonicalSessionRow[],
	peers: PeerRow[],
	enabled: boolean,
): PeerSection[] {
	if (!enabled) return [];
	const byId = new Map(peers.map((peer) => [peer.device_id, peer]));
	const grouped = new Map<string, CanonicalSessionRow[]>();
	for (const row of rows) {
		if (!isRemoteRow(row)) continue;
		const id = row.owner_device ?? "";
		const list = grouped.get(id);
		if (list) list.push(row);
		else grouped.set(id, [row]);
	}
	const order = [
		...peers.map((peer) => peer.device_id),
		...[...grouped.keys()].filter((id) => !byId.has(id)),
	];
	return order.map((deviceId) => {
		const members = grouped.get(deviceId) ?? [];
		const peer = byId.get(deviceId);
		const reachable = peer
			? peer.reachable
			: members.every((row) => row.reachable !== false);
		const label = peer
			? deviceLabel(peer)
			: ownerLabel(members[0] ?? { owner_device: deviceId }, byId);
		return {
			deviceId,
			heading: `⇄ ${label}${headingSuffix(reachable, peer?.lifecycle)}`,
			label,
			reachable,
			rows: members,
		};
	});
}

/**
 * A duration in the sidebar's register: `4m`, `2h`, `3d`. Coarse on purpose: the
 * `Peers` row's trailing slot is one short statement, and "last seen 4m 12s ago"
 * is precision nobody acts on.
 */
export function shortAge(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h}h ago`;
	return `${Math.floor(h / 24)}d ago`;
}

/**
 * The `Peers` row's trailing statement - its OWN slot (peers are a different list
 * from chats, so nothing competes for it): `24ms · 2 chats` for a live peer,
 * `unreachable · last seen 4m ago` for one that is not. `rtt_ms` null is `—`,
 * never `0ms` (§2.6).
 */
export function peerTrailing(peer: PeerRow, nowSeconds: number): string {
	const chats = `${peer.session_count} ${peer.session_count === 1 ? "chat" : "chats"}`;
	if (!peer.reachable) {
		return peer.last_seen_at === null
			? "unreachable · never seen"
			: `unreachable · last seen ${shortAge(nowSeconds - peer.last_seen_at)}`;
	}
	return `${peer.rtt_ms === null ? "—" : `${peer.rtt_ms}ms`} · ${chats}`;
}
