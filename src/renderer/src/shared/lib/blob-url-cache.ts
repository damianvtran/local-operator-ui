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
 * 3. **The last `release` revokes.** Bytes are immutable and cheap to refetch;
 *    parking every URL a long session has ever shown is the larger cost.
 *
 * The KEY is the caller's: a content digest for a transcript attachment (which
 * recurs across rows and sessions), `path:mtime` for a file (so an edited file
 * is a different entry rather than a stale picture).
 */

/** key -> { url, refs }. Module-level because surviving an unmount is the point. */
const cache = new Map<string, { url: string; refs: number }>();

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
	return entry.url;
}

/** Publish a freshly created URL under `key`, at zero references. */
export function publish(key: string, url: string): void {
	cache.set(key, { url, refs: 0 });
}

/** Give a reference back, revoking the URL when the last holder leaves. */
export function release(key: string): void {
	const entry = cache.get(key);
	if (!entry) return;
	entry.refs -= 1;
	if (entry.refs > 0) return;
	URL.revokeObjectURL(entry.url);
	cache.delete(key);
}
