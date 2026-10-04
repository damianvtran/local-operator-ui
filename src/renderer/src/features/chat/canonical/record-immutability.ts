/**
 * THE DEV-ONLY RECORD-IMMUTABILITY GUARD (agent review round 2, M1r2).
 *
 * WHY IT EXISTS. The transcript's memoisation rests on one invariant, stated at
 * the top of `transcript-reducer.ts` and honoured by every shipped producer: a
 * record object is REPLACED when it changes and never MUTATED in place.
 * `shallowEqual`'s identity gate (the reducer's idempotence), every row memo, and
 * `collapseRowsKey`'s per-record signature WeakMap
 * (`turn-collapse-model.ts::recordSignature`) all read that contract as fact -
 * and until this guard nothing enforced it. For the signature the failure is
 * worse than for the others: it is SILENT. An in-place write leaves the cached
 * signature computed from the record's OLD contents, so the plan and the feet go
 * stale while `chatEntries` - keyed on `visible`, not on a signature - paints the
 * new value: a bar and a foot that disagree with the row beside them, with no
 * exception and no failing test. A `readonly` type would refuse the write at
 * compile time, but the harnesses here are plain JS, so the guard is a runtime
 * freeze that a test can actually exercise.
 *
 * WHAT IT DOES. In a development build a record is DEEP-FROZEN where the reducer
 * emits it (`transcript-reducer.ts`) and again where the plan first signs it
 * (`turn-collapse-model.ts`), so an in-place write - a field assignment, a new
 * own key, an `images.push` - throws at the write instead of going stale later.
 * Correct code is unaffected: records are immutable values here, so there is
 * nothing to freeze that was going to change.
 *
 * PRODUCTION DOES NOT PAY FOR IT. Vite inlines `import.meta.env.DEV`, so a
 * production build reads `false` and every call below returns immediately - no
 * walk, no `Object.freeze`, no runtime cost. A Node bundle (the
 * `scripts/*.test.mjs` harnesses) reads `import.meta.env` as `undefined`, and
 * the optional chain turns that into the same `false`, so no existing suite
 * changes behaviour; the suites that assert the throw build their bundle with
 * `DEV: true` (see `scripts/collapse-plan-per-pass.test.mjs` and
 * `scripts/transcript-reducer.test.mjs`).
 *
 * IT IS NOT `Object.freeze` ON THE RECORD ALONE, and that is load-bearing.
 * `images` is carried by the IDENTITY of its array, and the array is the record's
 * own field: a shallow freeze stops `record.images = [...]` but not
 * `record.images.push(...)`, which is exactly one of the in-place writes the
 * review constructed. The walk below reaches the array for that reason.
 */
export const RECORD_IMMUTABILITY_ENFORCED: boolean =
	import.meta.env?.DEV === true;

/**
 * Deep-freeze `value` in place and return it, so a call site can read as
 * `upsert(state, freezeRecordDeep({ ...record, text }))`.
 *
 * IDEMPOTENT AND BOUNDED. `Object.freeze` is a no-op on an already-frozen
 * object and the walk stops at the first frozen node, so a subtree frozen by an
 * earlier emit (the shared `EMPTY_IMAGES`, a record re-emitted unchanged) costs
 * one check rather than a second walk. A cycle is safe because a node is frozen
 * before its children are walked.
 */
export function freezeRecordDeep<T>(value: T): T {
	if (RECORD_IMMUTABILITY_ENFORCED) freezeValueGraph(value);
	return value;
}

function freezeValueGraph(value: unknown): void {
	// Primitives (and functions, which no record carries) are leaves: freezing a
	// function would reach into a shared module object, so it is deliberately not
	// walked.
	if (value === null || typeof value !== "object") return;
	const target = value as object;
	if (Object.isFrozen(target)) return;
	Object.freeze(target);
	for (const nested of Object.values(target)) freezeValueGraph(nested);
}
