/**
 * Refcounted object URLs, shared by every surface that shows a file it fetched
 * itself.
 *
 * This is the discipline `use-attachment-url.ts` already had, lifted out
 * because a second consumer arrived: the canvas viewers read a local file's
 * bytes over IPC and show them from a blob URL, and a second copy of a
 * refcounted `URL.createObjectURL` cache is exactly the kind of duplication
 * where both copies look right and only one holds the invariants. A blob URL
 * that is revoked too early blanks a picture that is still on screen; one
 * revoked too late is memory that outlives the thing that asked for it, and
 * neither shows up until it does.
 *
 * The three rules, in the order they matter:
 *
 * 1. **`peek` is a read and MUST be safe in a render.** A `useState`
 *    initializer is deliberately double-invoked under `StrictMode` (`main.tsx`),
 *    so an initializer that retained would add a reference no unmount could pay
 *    back. Peeking lets a warm mount paint on its first frame while the effect
 *    owns every reference.
 * 2. **`retain` and `release` come in pairs, and only an effect may call them**,
 *    because only an effect can also run the cleanup that pays the reference
 *    back.
 * 3. **The last `release` revokes - at the end of the task, and not at all if
 *    a `retain` lands first.** Bytes are immutable and cheap to refetch, so
 *    nothing is parked: the deferral is one microtask, and it exists so a fold
 *    can hand a blob from one holder to another INSIDE one commit instead of
 *    re-reading bytes that were on screen a moment ago (see `release`).
 *
 * The KEY is the caller's: a content digest for a transcript attachment (which
 * recurs across rows and sessions), `path:mtime` for a file (so an edited file
 * is a different entry rather than a stale picture).
 */

/**
 * key -> { url, refs, revoking }. Module-level because surviving an unmount is
 * the point. `revoking` is the deferred-release flag: true while a revoke for
 * this entry is queued and still cancellable (rule 3).
 */
const cache = new Map<
	string,
	{ url: string; refs: number; revoking: boolean }
>();

/** Build a blob URL for bytes. The caller decides the key it is filed under. */
export function createBlobUrl(bytes: BlobPart, mimeType: string): string {
	return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** The cached URL without taking a reference. Safe in a render. */
export function peek(key: string): string | null {
	return cache.get(key)?.url ?? null;
}

/**
 * Take a reference on a cached URL, or `null` when the key is not cached.
 *
 * `null` is the caller's instruction to fetch; a caller that fetches must
 * retain again once the bytes land, because the reference has to reflect
 * holders rather than requesters.
 */
export function retain(key: string): string | null {
	const entry = cache.get(key);
	if (!entry) return null;
	entry.refs += 1;
	// The cancelling half of rule 3: this may be a queued-revoke entry whose
	// last holder left within the same task (the fold swap), and handing it to
	// the new holder is exactly what the deferral is for.
	entry.revoking = false;
	return entry.url;
}

/**
 * Publish a freshly created URL under `key`, at zero references.
 *
 * An entry that already exists is KEPT and the new URL is revoked. Two readers
 * on one key can both miss `retain` and both fetch; overwriting would leave the
 * first URL unreachable and never revoked, and the next `release` would then
 * delete the entry the surviving holder is still rendering — a blank surface,
 * from a cache whose whole point is that it cannot blank one. Keeping the
 * incumbent makes `retain` immediately after `publish` the caller's way to
 * join it, which is what `use-file-blob-url` does.
 */
export function publish(key: string, url: string): void {
	const entry = cache.get(key);
	if (entry) {
		URL.revokeObjectURL(url);
		return;
	}
	cache.set(key, { url, refs: 0, revoking: false });
}

/**
 * Give a reference back, revoking the URL when the last holder leaves.
 *
 * WHY THE REVOKE IS DEFERRED RATHER THAN IMMEDIATE. A fold swap hands one
 * picture from one holder to another inside ONE React commit: opening a
 * condensed group or a bar unmounts the strip that showed a digest and mounts
 * the rows that show it again, and the departing holder's `release` runs
 * before the incoming holder's `retain` in the same effect flush. Revoking
 * synchronously at zero therefore revoked bytes that were about to be
 * re-shown, and every fold flip re-read them over IPC - measured as one
 * digest, three reads across condense -> open -> close, with the reserved box
 * painted for the fetch's duration (agent review round 1, M1; QA's Q1). A
 * microtask is the whole window this needs: the handoff happens within one
 * task's flush, and a microtask runs after it. A `retain` in that window
 * cancels the revoke, so the entry is handed over rather than dropped.
 *
 * The cost stays bounded: only URLs released within the last microtask
 * linger, so "the last release revokes" still holds on every human timescale
 * - this is a handover, not a parking lot.
 */
export function release(key: string): void {
	const entry = cache.get(key);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs > 0) return;
	if (entry.revoking) return;
	entry.revoking = true;
	queueMicrotask(() => {
		// A retain between the release and this callback means the entry has
		// changed hands - the swap this exists for. Leave it to its new holder.
		if (!entry.revoking || entry.refs > 0) return;
		URL.revokeObjectURL(entry.url);
		// The key may have been re-published since this revoke was queued
		// (a fresh fetch landing for a digest that had gone cold): only this
		// ENTRY's URL is revoked, and the map is only cleared while it still
		// holds that entry.
		if (cache.get(key) === entry) cache.delete(key);
	});
}
