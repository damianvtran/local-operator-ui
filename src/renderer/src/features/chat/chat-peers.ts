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
import { text } from "../../../../shared/mesh-shapes";
import { deviceLabel } from "./peers-store";

export const isRemoteRow = (row: CanonicalSessionRow): boolean =>
	row.locality === "remote";

/**
 * Whether a remote row can be FILED under a peer.
 *
 * The section key is the owner's device id, so a remote row whose producer left
 * `owner_device` empty cannot be keyed: grouping it put every such row in ONE
 * section headed `device …` (the round-1 review reproduced exactly that with two
 * rows from two devices). It is not dropped from the list - a conversation is
 * never hidden - it simply stays in the flat `All chats` list, still marked, where
 * the mark says it lives elsewhere without naming a device that was not sent
 * (round-1 review, M2).
 */
export const isFileableRemoteRow = (row: CanonicalSessionRow): boolean =>
	isRemoteRow(row) && text(row.owner_device) !== "";

/** The rows `Active chats`/`Previous chats` draw: this device's own. */
/**
 * The ` ago` suffix `shortAge` adds. Hoisted because biome's `useTopLevelRegex`
 * asks a regex literal not to be rebuilt inside a function.
 */
const TRAILING_AGO = / ago$/;

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
	// `text` because the wire is allowed to send `null` for either half (addendum
	// 2, B) and this string is rendered as a sentence in the flyout and the card.
	return text(peer?.unreachable_reason ?? row.unreachable_reason);
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
	/**
	 * The heading's TEXT, `label + suffix` - never a glyph. The locality mark's
	 * drawing is `ChatRemoteMark`'s alone, so the heading and the rows cannot drift
	 * into two drawings of one motif (design round 1, D2: the heading used the font
	 * glyph `⇄` while the rows used the lucide icon, which draws `⇆`).
	 */
	heading: string;
	/** The state suffix alone (` · unreachable`), appended after the name. */
	suffix: string;
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
function headingSuffix(reachable: boolean) {
	return reachable ? "" : " · unreachable";
}

/**
 * One section per peer THAT HAS CHATS, in the peer catalogue's order, then any
 * device the rows name that the catalogue does not (a cached row of a peer the
 * last catalogue read omitted still needs a home - dropping it would hide a
 * conversation).
 *
 * WHY ZERO-ROW PEERS GET NO SECTION (design round 1, D5). §2.4 gave a quiet peer
 * a section "because the count says which peer is quiet", but the `heading()`
 * primitive renders NO badge for a count of 0 - so the section drew an expanded
 * chevron over nothing, no count and no rows, which reads as broken rather than as
 * quiet. The `Peers` group already names every device with its state, its
 * last-seen and its chat count, so it is the single place a quiet peer is
 * described, and a section means exactly one thing: here are that peer's chats.
 *
 * Keyed on the DEVICE ID, never the label - two devices may share a human name,
 * and a section keyed on the label would merge them.
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
		if (!isFileableRemoteRow(row)) continue;
		const id = text(row.owner_device);
		const list = grouped.get(id);
		if (list) list.push(row);
		else grouped.set(id, [row]);
	}
	const order = [
		...peers.map((peer) => peer.device_id),
		...[...grouped.keys()].filter((id) => !byId.has(id)),
	];
	return (
		order
			// D5: a peer with no cached chats has nothing for a section to disclose.
			.filter((deviceId) => (grouped.get(deviceId)?.length ?? 0) > 0)
			.map((deviceId) => {
				const members = grouped.get(deviceId) ?? [];
				const peer = byId.get(deviceId);
				const reachable = peer
					? peer.reachable
					: members.every((row) => row.reachable !== false);
				const label = peer
					? deviceLabel(peer)
					: ownerLabel(members[0] ?? { owner_device: deviceId }, byId);
				const suffix = headingSuffix(reachable);
				return {
					deviceId,
					heading: `${label}${suffix}`,
					suffix,
					label,
					reachable,
					rows: members,
				};
			})
	);
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
export function peerTrailing(
	peer: PeerRow,
	/**
	 * The chat count, from the rows THIS SIDEBAR grouped - the same number the
	 * peer's section heading shows. Not `peer.session_count`: two counts for one
	 * fact, read from two sources, can disagree on one screen (design round 1, D1).
	 */
	chatCount: number,
	nowSeconds: number,
): string {
	if (!peer.reachable) {
		// SHORT, because this slot competes with the device's own name for a 240-360px
		// row: measured in the S4 frame, the long form left the name as `studio…` at
		// the clamp and cut the one fact that differs between peers (`last see…`) at
		// the default width. The full sentence is `peerTrailingTitle`'s, i.e. the row's
		// `title` (design round 1, D4).
		return peer.last_seen_at === null
			? "unreachable · never seen"
			: `unreachable · ${compactAge(nowSeconds - peer.last_seen_at)}`;
	}
	// NO LATENCY CLAUSE. The transport publishes no RTT producer, so the shipped
	// product would render `— · 2 chats` on every live peer, indefinitely: an em
	// dash in every row says nothing, and the frames that showed `24ms` were
	// evidence of a UI that cannot exist (design round 1, D1). The field stays in
	// the wire type; it is rendered again when something measures it.
	return `${chatCount} ${chatCount === 1 ? "chat" : "chats"}`;
}

/**
 * The same duration as `shortAge`, without the trailing `ago` - the form that fits
 * a 40%-capped slot beside a device's name (D4). `shortAge` itself is unchanged,
 * because the hover card's `Last seen` wants the sentence.
 */
function compactAge(seconds: number): string {
	return shortAge(seconds).replace(TRAILING_AGO, "");
}

/**
 * The `Peers` row's full sentence, for the row's `title` - the half
 * `peerTrailing` truncates on purpose (D4).
 */
export function peerTrailingTitle(
	peer: PeerRow,
	chatCount: number,
	nowSeconds: number,
): string {
	if (!peer.reachable) {
		return peer.last_seen_at === null
			? "unreachable · never seen"
			: // `shortAge` already ends in `ago`; the full sentence only adds `last seen`.
				`unreachable · last seen ${shortAge(nowSeconds - peer.last_seen_at)}`;
	}
	const chats = `${chatCount} ${chatCount === 1 ? "chat" : "chats"}`;
	/*
	 * THE LATENCY'S HOME, AND WHY IT IS HERE RATHER THAN IN THE ROW. `rtt_ms` is
	 * `null` on every peer by contract: the transport measures a dial only inside
	 * its own probe (addendum 3), so publishing a number would mean the backend
	 * dialling every peer on a 30 s poll to fill one field. Design round 1 (D1)
	 * settled what that means for the ROW - `— · 2 chats` on every live peer is an
	 * em dash that can never fill, so the row shows the count alone. The dash is not
	 * deleted as a convention, it is moved to where a measurement is read in
	 * context: the row's `title`, which says the count AND that nothing measured the
	 * round trip. When a producer exists, the number lands in the same cell.
	 */
	const latency =
		peer.rtt_ms === null ? " — latency not reported" : ` — ${peer.rtt_ms}ms`;
	return `${chats} on ${deviceLabel(peer)}${latency}`;
}
