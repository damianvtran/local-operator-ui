/**
 * The API's 512-ID count limit is not an HTTP request-target budget. UUIDs and
 * percent-encoded Unicode already exceed the dev proxy's header parser before
 * reaching core. Keep the entire encoded target below 6 KiB, leaving 2 KiB of
 * an 8 KiB envelope for ordinary headers. This deliberately conservative bound
 * also applies to native and direct GETs; it is not a UUID-specific count.
 *
 * Only the prefix fitting this request is carried. Callers must retain omitted
 * cached identities and repair them in sequential same-domain reads; omission
 * is never source authority or proof that an entry does not exist.
 */
export const JOURNAL_ORDER_QUERY_BYTES = 6 * 1024;
export const JOURNAL_ORDER_ID_LIMIT = 512;

export function appendJournalOrderIds(
	query: URLSearchParams,
	path: string,
	ids: readonly string[],
): string[] {
	// URLSearchParams escapes Unicode and punctuation to ASCII. Measure that
	// actual serialization, including every fixed/cursor query field and path,
	// not the input string's character count or its unescaped UTF-8 bytes.
	let bytes = new TextEncoder().encode(
		`${path}${query.size ? `?${query}` : ""}`,
	).length;
	const selected: string[] = [];
	for (const id of ids) {
		if (selected.length === JOURNAL_ORDER_ID_LIMIT) break;
		const encoded = new URLSearchParams({ order_ids: id }).toString();
		const extra = encoded.length + 1; // '?' for the first field, '&' thereafter.
		if (bytes + extra > JOURNAL_ORDER_QUERY_BYTES) break;
		query.append("order_ids", id);
		selected.push(id);
		bytes += extra;
	}
	return selected;
}

/** Select without mutating the caller's fixed query; repair tracks these IDs. */
export function journalOrderIdBatch(
	ids: readonly string[],
	path: string,
	query: URLSearchParams,
): string[] {
	return appendJournalOrderIds(new URLSearchParams(query), path, ids);
}
