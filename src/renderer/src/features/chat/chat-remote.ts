/**
 * The remote row's own facts, as pure functions: WHAT the row is called when the
 * list speaks about it (its device label, its network name), and the ONE
 * sentence both channels read (the flyout line and the accessible name).
 *
 * WHY ITS OWN MODULE: the sidebar is a nine-thousand-line component whose inner
 * helpers no suite can execute; these rules ARE the feature's copy and its
 * degradation ladder, so they live where `scripts/chat-remote.test.mjs` can hand
 * them rows with no DOM. The SENTENCE IS BUILT ONCE and read twice - a second
 * spelling beside the `sr-only` span is exactly how the two channels come to
 * disagree about which device a row is on.
 *
 * WHAT LEFT THIS MODULE (2026-10-08). It used to carry a third job - the
 * ORDER remote rows re-enter the list in (`mergeRemoteRowsByActivity`, a stable
 * insertion by `updated_at`) - because the wire appends the peer half after the
 * page and the old list drew the array as it stood. The arrangement now sorts
 * every row by the clock the reader chose (`chat-sidebar-view.ts`'s `pageOrder`,
 * applied to the list and the nested groups alike), so a remote row's position
 * is decided by the same key as every local row's and the merge had no reader
 * left: its rule - "a row with no usable time sorts last, not first", and a
 * zero stamp is no usable time - lives on in the arrangement's `byNewest` and
 * in the tests that moved with it.
 */
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { deviceName } from "./device/chat-device-model";
/** The device a remote row is spoken of by: the wire's own name when it carried
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
 * The location clause: `on <device> · <network>`, the network half omitted when
 * the networks read cannot name one (no name is no claim).
 *
 * THE SEPARATOR IS CROSS-SURFACE (design review round 1, D1): the TUI's
 * location line reads `on <device> · <network>` (`mesh-ui.md` §1.3.1,
 * `session_sidebar.py`'s tooltip), and this clause is the same fragment in the
 * desktop's register - one feature, one separator.
 *
 * LOWERCASE, because both readers use it inside a sentence the row already
 * starts: the flyout draws it as its own line under the status, and the
 * accessible name joins it as `, on <device> · <network>` - the same fragment in
 * both, so neither can drift from the other.
 */
export function remoteClause(
	row: CanonicalSessionRow,
	networkName: string | null | undefined,
): string {
	const label = remoteDeviceLabel(row);
	const network = (networkName ?? "").trim();
	return network ? `on ${label} · ${network}` : `on ${label}`;
}

/**
 * The unreachable row's own line: `unreachable · <reason>`, split from the
 * location clause onto its own line (design review round 1, D2, aligning with
 * the TUI's `unreachable · <gloss>` line): the device clause stays a terse noun
 * phrase like the rest of the family while the reason says what happened.
 *
 * THE REASON NEVER INVENTS A CAUSE: the wire's own sentence rides through when
 * it is there, and a row that has none says the TUI's shared gloss, `it did not
 * answer` (`peer_reason_words`'s own fallback at the sibling's source), never a
 * bare `unreachable`.
 *
 * WHAT IS DELIBERATELY NOT PORTED: the TUI's token gloss table
 * (`peer_reason_words`) - a wire reason that is a machine token
 * (`connect_failed:<class>`) is printed as the wire wrote it here. The table is
 * the runtime's vocabulary to keep; this surface names what arrived without
 * forking it (recorded for the sibling's vocabulary work).
 */
export function remoteUnreachableClause(row: CanonicalSessionRow): string {
	if (row.reachable !== false) return "";
	const reason =
		typeof row.unreachable_reason === "string"
			? row.unreachable_reason.trim()
			: "";
	return `unreachable · ${reason || "it did not answer"}`;
}
