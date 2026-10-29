import type { TagCategory, TagRef } from "../../../../shared/desktop-contract";
import { chatTagBucket } from "./chat-tag-drag";

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
	const buckets = new Map<string, T[]>();
	for (const row of rows) {
		const id = chatTagBucket(row, categories);
		const bucket = buckets.get(id) ?? [];
		bucket.push(row);
		buckets.set(id, bucket);
	}
	// Even an all-Untagged section needs its bucket wrapper: row drag arming
	// reads it, and the v3 footer's unused-tag slots must accept the FIRST tag
	// assignment, not only assignments after some occupied group exists.
	return [
		...ordered.map(({ id, name }) => ({ id, name })),
		{ id: "untagged", name: "Untagged" },
	].flatMap(({ id, name }) => {
		const bucket = buckets.get(id);
		return bucket?.length ? [{ id, name, rows: bucket }] : [];
	});
}

/**
 * Tags no conversation carries: they have no group header (only occupied buckets
 * render), so without the sidebar footer's "Unused tags" list they would be
 * reachable only through a dialog - the v3 spec's P7, and the reason the footer
 * exists. Registry order, so the footer reads in the same order headers do.
 */
export function unusedTags(categories: readonly TagCategory[]): TagCategory[] {
	return [...categories]
		.filter((tag) => tag.conversations === 0)
		.sort((a, b) => a.order - b.order);
}

/**
 * The desired registry after moving `id` one place relative to a VISIBLE
 * neighbour (v3 spec D2), or null when there is nothing to do.
 *
 * WHY THE NEIGHBOUR AND NOT THE REGISTRY INDEX: headers render per time section
 * and only for occupied buckets, so the tag drawn above a header is often not
 * its registry predecessor. A plain swap with the registry neighbour can move a
 * tag past tags that are not on screen, and the header the user pressed "Move
 * up" on would not move at all. Repositioning just before (up) or after (down)
 * the neighbour the user can SEE always moves the header past it.
 */
export function moveTagPast(
	categories: readonly TagCategory[],
	id: string,
	neighbour: string,
	direction: "up" | "down",
): { id: string; name: string }[] | null {
	const ordered = [...categories].sort((a, b) => a.order - b.order);
	const moving = ordered.find((tag) => tag.id === id);
	if (!moving || id === neighbour) return null;
	const rest = ordered.filter((tag) => tag.id !== id);
	const at = rest.findIndex((tag) => tag.id === neighbour);
	if (at < 0) return null;
	rest.splice(direction === "up" ? at : at + 1, 0, moving);
	return rest.map((tag) => ({ id: tag.id, name: tag.name }));
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

/** Reorder only within the visual bucket. The flat fallback is intentional:
 * tags disabled, no occupied tags, and search must retain the shipped order. */
export function tagBucketRowIds<
	T extends { session_id: string; tags?: TagRef[]; primary?: string | null },
>(
	rows: readonly T[],
	categories: readonly TagCategory[],
	enabled: boolean,
	id: string,
): string[] {
	const groups = groupChatsByTag(rows, categories, enabled);
	return (
		groups?.find((group) => group.rows.some((row) => row.session_id === id))
			?.rows ?? rows
	).map((row) => row.session_id);
}
