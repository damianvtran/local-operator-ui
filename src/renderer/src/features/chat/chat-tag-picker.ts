/** Picker constraints mirror the shipped API, not the density of a filtered list.
 * Count Unicode code points like the server; do not normalize the reader's name.
 * Client equivalence is a convenience only: uniqueness remains server-authoritative.
 */
export const TAG_REGISTRY_LIMIT = 32;
export const TAG_SELECTION_LIMIT = 8;
export function tagNameIssue(
	value: string,
): "blank" | "reserved" | "long" | null {
	const name = value.trim();
	if (!name) return "blank";
	if (name.toLowerCase() === "untagged") return "reserved";
	return Array.from(name).length > 24 ? "long" : null;
}
export function matchingTags<T extends { name: string }>(
	tags: readonly T[],
	query: string,
): T[] {
	return tags.filter((tag) =>
		tag.name.toLowerCase().includes(query.trim().toLowerCase()),
	);
}
export function hasTagName(
	tags: readonly { name: string }[],
	query: string,
): boolean {
	return tags.some(
		(tag) => tag.name.trim().toLowerCase() === query.trim().toLowerCase(),
	);
}
/** Append rather than registry-sort so removing primary follows assignment age. */
export function togglePickerTag(ids: readonly string[], id: string): string[] {
	return ids.includes(id)
		? ids.filter((held) => held !== id)
		: ids.length < TAG_SELECTION_LIMIT
			? [...ids, id]
			: [...ids];
}
export function pickerActiveIndex(
	index: number,
	delta: number,
	count: number,
): number {
	return count ? Math.max(0, Math.min(count - 1, index + delta)) : -1;
}
