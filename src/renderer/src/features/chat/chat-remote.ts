/**
 * The remote row's own facts, as pure functions: WHAT the row is called when the
 * list speaks about it (its device label, its network name), the ONE sentence
 * both channels read (the flyout line and the accessible name), and the ORDER
 * the sidebar draws remote rows in.
 *
 * WHY ITS OWN MODULE: the sidebar is a nine-thousand-line component whose inner
 * helpers no suite can execute; these rules ARE the feature's copy and its
 * degradation ladder, so they live where `scripts/chat-remote.test.mjs` can hand
 * them rows with no DOM. The SENTENCE IS BUILT ONCE and read twice - a second
 * spelling beside the `sr-only` span is exactly how the two channels come to
 * disagree about which device a row is on.
 */
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { deviceName } from "./device/chat-device-model";

/** Epoch seconds, or 0. Local to this module so the chat feature owes the mesh
 * feature no runtime import for one coercion (its type import above is erased). */
const seconds = (value: unknown): number =>
	typeof value === "number" && Number.isFinite(value) ? value : 0;

/**
 * The device a remote row is spoken of by: the wire's own name when it carried
 * one, else the id's tail - `deviceName`'s ONE rule, shared with the header's
 * chip so two surfaces can never name one device two ways. `"another device"`
 * is the floor for a row whose wire carried neither; the canonical shape always
 * carries the id, so it is a guard rather than a state the backend produces.
 */
export function remoteDeviceLabel(row: CanonicalSessionRow): string {
	return (
		deviceName(
			typeof row.owner_device_name === "string" ? row.owner_device_name : "",
			typeof row.owner_device === "string" ? row.owner_device : "",
		) || "another device"
	);
}

/**
 * `device_id -> network name`, from the networks read's own topology.
 *
 * FIRST NETWORK WINS: a device the catalogue reports through several memberships
 * is still ONE device (the relay's own de-duplication rule, `peer_rows.py`), and
 * the sentence names one network - letting the walk's last membership win would
 * make the same row read differently depending on map insertion order.
 */
export function deviceNetworkNames(value: unknown): Map<string, string> {
	const names = new Map<string, string>();
	const networks = (value as { networks?: unknown } | null)?.networks;
	if (!Array.isArray(networks)) return names;
	for (const entry of networks) {
		if (entry === null || typeof entry !== "object") continue;
		const network = entry as { name?: unknown; members?: unknown };
		const name = typeof network.name === "string" ? network.name.trim() : "";
		if (!name || !Array.isArray(network.members)) continue;
		for (const member of network.members) {
			if (member === null || typeof member !== "object") continue;
			const deviceId = (member as { device_id?: unknown }).device_id;
			if (typeof deviceId !== "string" || deviceId === "") continue;
			if (!names.has(deviceId)) names.set(deviceId, name);
		}
	}
	return names;
}

/**
 * The one sentence: `on <device> (<network>)`, the network clause omitted when
 * the networks read cannot name one, the unreachable clause appended when the
 * row's own `reachable` says the owner did not answer the poll.
 *
 * LOWERCASE, because both readers use it inside a sentence the row already
 * starts: the flyout draws it as its own line under the status, and the
 * accessible name joins it as `, on <device> (<network>)` - the same fragment in
 * both, so neither can drift from the other.
 *
 * The unreachable half never invents a cause: the wire's own sentence rides
 * through when it is there, and a row that has none says `unreachable` alone.
 */
export function remoteClause(
	row: CanonicalSessionRow,
	networkName: string | null | undefined,
): string {
	const label = remoteDeviceLabel(row);
	const network = (networkName ?? "").trim();
	const host = network ? `on ${label} (${network})` : `on ${label}`;
	if (row.reachable !== false) return host;
	const reason =
		typeof row.unreachable_reason === "string"
			? row.unreachable_reason.trim()
			: "";
	return reason ? `${host} - unreachable: ${reason}` : `${host} - unreachable`;
}

/**
 * THE ORDER THE SIDEBAR DRAWS: remote rows re-enter the sequence where their own
 * clock says, instead of at the array's tail.
 *
 * WHY THIS IS NEEDED AT ALL. Remote rows arrive APPENDED - the wire concatenates
 * its page, its pinned extras and then the peer half, and the store preserves
 * that - and every plain catalogue poll re-sinks every held row after the page
 * (`headAnswerRows` keeps survivors in their own order AFTER the new page), so
 * the store's array order can never be what the list reads. Left alone, a remote
 * conversation from this morning would sit below two hundred local rows: outside
 * the sidebar's first page entirely, inside the same bin as rows it has nothing
 * to do with. The operator asked for one list; this is the merge that makes the
 * order read as one.
 *
 * THE RULE, exactly: a stable INSERTION, never a sort. Local rows keep their
 * relative order byte for byte; the remote rows are first ordered among
 * THEMSELVES (newest first - the wire's fan-out order is per-device, and two
 * devices' rows must not interleave by which relay answered first), then each
 * one is inserted before the first row whose clock it outranks. A row with no
 * usable time sorts last rather than first: "no clock" is not "now".
 */
export function mergeRemoteRowsByActivity(
	rows: readonly CanonicalSessionRow[],
): CanonicalSessionRow[] {
	const local: CanonicalSessionRow[] = [];
	const remote: CanonicalSessionRow[] = [];
	for (const row of rows)
		(row.locality === "remote" ? remote : local).push(row);
	if (remote.length === 0) return [...rows];
	remote.sort((a, b) => seconds(b.updated_at) - seconds(a.updated_at));
	const merged = [...local];
	for (const row of remote) {
		const at = merged.findIndex(
			(existing) => seconds(existing.updated_at) < seconds(row.updated_at),
		);
		if (at === -1) merged.push(row);
		else merged.splice(at, 0, row);
	}
	return merged;
}
