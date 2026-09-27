/**
 * Which conversations each drawn device holds, and how many a node may show.
 *
 * THE QUESTION THIS FILE ANSWERS is the second half of the tab's own purpose -
 * "which session is on which device" - and it is a JOIN rather than a field,
 * exactly as the plan's §1 says a device's role is: a session's home is the row's
 * `locality`/`owner_device`, and the device it names is a NODE only if some
 * network's member table (or the peer catalogue) drew one. The two reads are
 * different cadences and different failure modes, so they are joined here, in one
 * pure function, rather than by either read's shape.
 *
 * WHY A CAP, AND WHY IT IS NOT COSMETIC. The session store on this machine holds
 * 12,363 directories and the catalogue page is 100 rows by default; a node that
 * rendered every conversation it holds would make the DOM size a function of that
 * store, which is the one thing the canvas's structural invariant forbids
 * (`scripts/mesh-canvas-bench.test.mjs` asserts the bound, and
 * `meshNodeCount` is the other half of it). So a device node shows a bounded
 * handful and says how many it is NOT showing: "showing 4 of 37" is a fact, while
 * a silent truncation is a claim that the device holds four.
 *
 * ORPHANS ARE COUNTED, NOT DROPPED. A remote row can name an owner that no read
 * drew - a device whose membership row has gone stale between the two reads, or a
 * peer the relay reported sessions for without a catalogue row. Filing those rows
 * under nothing is fine; LOSING them silently is not, because the number of
 * conversations the tab can see would then disagree with the chip counts on
 * screen with nothing to explain the gap. `orphans` is that explanation, and the
 * page states it.
 */

import type { MeshSessionRow } from "./mesh-types";

/**
 * How many chips one device node shows before it says "+N more".
 *
 * FOUR, and the number is a geometry decision rather than a taste one: a node is
 * `NODE_HEIGHT` tall with a title and one stat line, and four chips fit inside it
 * without the node growing - which matters, because a node that grew a row per
 * session would move every node below it on the next poll, the exact reshuffle
 * `mesh-positions.ts` exists to prevent. The cap is read by the stories, the
 * bench and the node together so the three cannot disagree about the bound.
 */
export const CHIP_LIMIT = 4;

export type DeviceSessions = {
	/** Every row this device holds, in the catalogue's own order. */
	rows: MeshSessionRow[];
	/** The ones a node draws: the first `CHIP_LIMIT`. */
	shown: MeshSessionRow[];
	/** How many are not drawn. `0` renders nothing. */
	hidden: number;
};

export type MeshedSessions = {
	/** Keyed by device id. Every drawn device has an entry, empty or not. */
	byDevice: Map<string, DeviceSessions>;
	/**
	 * Rows whose owner is not a device this tab is drawing, counted rather than
	 * filed - see this file's header.
	 */
	orphans: number;
};

/**
 * One row's owning device id.
 *
 * A LOCAL ROW ANSWERS THE EMPTY STRING and that is the wire's own shape rather
 * than a gap: `owner_device` is `""` on a row this device holds, because the
 * device that owns it is the one asking (`desktop_sessions.py`: "PRESENT WITH A
 * VALUE ON EVERY ROW, local ones included"). So the caller supplies this device's
 * id and the join happens here, once, instead of at each reader - the same reason
 * `mesh-types.ts` normalises where it reads.
 */
export function ownerOf(
	row: MeshSessionRow,
	selfDeviceId: string | null,
): string {
	return row.locality === "local" ? (selfDeviceId ?? "") : row.owner_device;
}

/**
 * The rows per drawn device, plus the count that belongs to no drawn device.
 *
 * `deviceIds` is what the canvas DREW (not what the reads returned): a device the
 * peer catalogue knows but no network claims is still a node, and a device that
 * only ever appeared in a stale membership row is not. Passing the drawn set in
 * keeps this function from having a second opinion about the layout.
 *
 * EVERY DRAWN DEVICE GETS AN ENTRY, including an empty one, so a caller can ask
 * "does this device hold anything" without distinguishing `undefined` from `[]` -
 * "we asked and it holds none" and "nobody asked" are different claims here, as
 * they are everywhere else in this feature.
 */
export function sessionsByDevice(
	rows: readonly MeshSessionRow[],
	selfDeviceId: string | null,
	deviceIds: Iterable<string>,
): MeshedSessions {
	const byDevice = new Map<string, DeviceSessions>();
	for (const deviceId of deviceIds) {
		byDevice.set(deviceId, { rows: [], shown: [], hidden: 0 });
	}
	let orphans = 0;
	for (const row of rows) {
		const owner = ownerOf(row, selfDeviceId);
		const held = owner ? byDevice.get(owner) : undefined;
		if (!held) {
			orphans += 1;
			continue;
		}
		held.rows.push(row);
	}
	for (const held of byDevice.values()) {
		held.shown = held.rows.slice(0, CHIP_LIMIT);
		held.hidden = Math.max(0, held.rows.length - held.shown.length);
	}
	return { byDevice, orphans };
}

/**
 * Whether a device's chip row can be read as complete.
 *
 * A device whose `sessionCount` (the peer catalogue's own count, "counted as a SET
 * OF IDS PER DEVICE") is larger than the rows this read returned is showing a
 * PAGE, not a census - and the difference must reach the screen, because "+1 more"
 * over 37 conversations nobody fetched is a wrong number rather than a rounded
 * one. The read's own `limit` is the other half of this; the page states the
 * result as "showing 4 of 37" either way, and this function is what decides
 * whether the second number is the catalogue's count or the rows in hand.
 */
export function deviceSessionTotal(
	held: DeviceSessions,
	catalogueCount: number | null,
): number {
	// `null` is "the relay did not name this device" and never zero: a device with
	// no catalogue row shows the rows in hand rather than claiming it holds none.
	if (catalogueCount === null) return held.rows.length;
	return Math.max(catalogueCount, held.rows.length);
}
