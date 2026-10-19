import type { TagCategory, TagRef } from "../../../../shared/desktop-contract";

export type TagGroup<T> = { id: string; name: string; rows: T[] };

/** Subdivide a section, never the catalogue: pin/running membership stays authoritative.
 * Returning null preserves the exact existing flat render path (including ordering).
 * Unknown/deleted primaries are untagged until the authoritative catalogue settles.
 */
export function groupChatsByTag<
	T extends { tags?: TagRef[]; primary?: string | null },
>(
	rows: readonly T[],
	categories: readonly TagCategory[],
	enabled: boolean,
): TagGroup<T>[] | null {
	if (!enabled || categories.length === 0) return null;
	const ordered = [...categories].sort((a, b) => a.order - b.order);
	const known = new Set(ordered.map((tag) => tag.id));
	const buckets = new Map<string, T[]>();
	let tagged = false;
	for (const row of rows) {
		const id =
			row.primary &&
			known.has(row.primary) &&
			row.tags?.some((tag) => tag.id === row.primary)
				? row.primary
				: "untagged";
		if (id !== "untagged") tagged = true;
		const bucket = buckets.get(id) ?? [];
		bucket.push(row);
		buckets.set(id, bucket);
	}
	if (!tagged) return null;
	return [
		...ordered.map(({ id, name }) => ({ id, name })),
		{ id: "untagged", name: "Untagged" },
	].flatMap(({ id, name }) => {
		const bucket = buckets.get(id);
		return bucket?.length ? [{ id, name, rows: bucket }] : [];
	});
}

/** Draft order is assignment age order, not registry display order. Removing the
 * primary therefore previews the same oldest-surviving fallback as the backend.
 */
export function draftPrimary(
	ids: readonly string[],
	primary: string | null,
): string | null {
	return primary !== null && ids.includes(primary) ? primary : (ids[0] ?? null);
}
