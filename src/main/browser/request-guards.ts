/**
 * Integer guards for the browser IPC boundary.
 *
 * WHY A SEPARATE MODULE: these are pure checks, and the boundary test that pins
 * them must not drag Electron (or the host) into a Node test process just to
 * call a two-line predicate. `ipc.ts` keeps the channel wiring and imports the
 * guards from here.
 */

export function numberOrThrow(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`${name} must be an integer.`);
	}
	return value;
}

/** A tab id is a HOST-MINTED positive integer. `numberOrThrow` answers the
 * integer question; this adds the sign, because 0 and negatives name no tab and
 * a request carrying one is a mistake rather than a tab that happens to be gone. */
export function tabIdOrThrow(value: unknown, name: string): number {
	const id = numberOrThrow(value, name);
	if (id <= 0) throw new Error(`${name} must be a positive tab id.`);
	return id;
}
