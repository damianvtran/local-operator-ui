/**
 * The live roster's delta form (`frontend.update.payload.job_deltas`).
 *
 * WHY THIS EXISTS AS A PURE MODULE. The backend stopped re-sending the whole
 * job roster on every tick: a `frontend.update` now carries only what moved
 * (`upserted` / `removed` / `order`), because the roster is the largest
 * bounded part of the frontend payload and a long-lived session writes it on
 * every tick. Without folding the delta the pane keeps the roster it had at the
 * last snapshot - the measured symptom is a child roster that freezes after its
 * first tick while every other reading stays live.
 *
 * SNAPSHOTS ARE UNCHANGED. `changes.jobs` is still the full list on a snapshot,
 * and on an update that carries BOTH forms the full list wins: a producer that
 * sends the whole roster knows more than the delta does, and applying a delta
 * over it would silently drop rows the delta did not mention. The call site
 * enforces that precedence; this function only folds a delta.
 *
 * IDENTITY IS THE ROW'S `id`, COERCED TO A STRING. Job ids cross the wire as
 * strings, but a row built by a test or an older producer could carry a number;
 * comparing raw would make one job two. `order` is consulted the same way, and
 * it never DROPS a row: an id missing from the order is appended in its prior
 * order rather than erased, because `removed` is the only field that deletes.
 */

/** The delta shape the bridge publishes on a `frontend.update`. */
export type JobDelta = {
	/** Rows to insert or replace, in delta order. */
	upserted?: ReadonlyArray<Record<string, unknown>>;
	/** Row ids that left the roster. */
	removed?: ReadonlyArray<string>;
	/** The intended order of the ids the producer still holds. */
	order?: ReadonlyArray<string>;
	/**
	 * How many rows the producer holds. Read by the daemon's own consistency
	 * checks; the fold does not need it, and treating it as a bound would drop
	 * rows on an out-of-order arrival.
	 */
	roster_size?: number;
};

const idOf = (row: Record<string, unknown>): string | null => {
	const id = row.id;
	if (typeof id === "string") return id;
	if (typeof id === "number") return String(id);
	return null;
};

export function applyJobDeltas(
	jobs: ReadonlyArray<Record<string, unknown>>,
	deltas: JobDelta,
): Array<Record<string, unknown>> {
	// Coerced like the row ids: a numeric `removed` entry must name the same job a
	// numeric row id does (`idOf`'s rule).
	const removed = new Set((deltas.removed ?? []).map(String));
	const next = jobs.filter((row) => {
		const id = idOf(row);
		return id === null || !removed.has(id);
	});
	for (const row of deltas.upserted ?? []) {
		const id = idOf(row);
		if (id === null) {
			// A row with no id cannot address an existing one; appending is the only
			// honest fold, and the roster's own readers tolerate it.
			next.push(row);
			continue;
		}
		const at = next.findIndex((existing) => idOf(existing) === id);
		if (at === -1) next.push(row);
		else next[at] = row;
	}
	if (!deltas.order) return next;
	const byId = new Map<string, Record<string, unknown>>();
	for (const row of next) {
		const id = idOf(row);
		if (id !== null) byId.set(id, row);
	}
	const ordered: Array<Record<string, unknown>> = [];
	for (const raw of deltas.order) {
		const id = String(raw);
		const row = byId.get(id);
		if (!row) continue;
		ordered.push(row);
		byId.delete(id);
	}
	for (const row of next) {
		const id = idOf(row);
		if (id !== null && byId.has(id)) {
			ordered.push(row);
			byId.delete(id);
		} else if (id === null) {
			ordered.push(row);
		}
	}
	return ordered;
}
