import type { TagCategory, TagRef } from "../../../../shared/desktop-contract";

export const TAG_DRAG_HOLD_MS = 180;
export const TAG_DRAG_SLOP_PX = 5;
export const TAG_DRAG_EDGE_PX = 32;
export const TAG_DRAG_SCROLL_PX = 12;

/** One threshold decision serves the timer and pointer path: movement before
 * the hold belongs to scrolling/selection and must never become a late drag. */
export function tagDragPhase(
	elapsed: number,
	distance: number,
): "pending" | "armed" | "cancelled" {
	if (distance > TAG_DRAG_SLOP_PX) return "cancelled";
	return elapsed >= TAG_DRAG_HOLD_MS ? "armed" : "pending";
}

/** Keep grouping and reorder membership identical even while a registry reload
 * leaves an assignment referring to a deleted or unknown category. */
export function chatTagBucket(
	row: { primary?: string | null; tags?: TagRef[] },
	categories: readonly TagCategory[],
): string {
	return row.primary &&
		categories.some((tag) => tag.id === row.primary) &&
		row.tags?.some((tag) => tag.id === row.primary)
		? row.primary
		: "untagged";
}

/** A move changes the primary, not assignment age or section membership. */
export function movedTagAssignment(
	row: { primary?: string | null; tags?: TagRef[] },
	target: string,
): { ids: string[]; primary: string | null } | null {
	const ids = [...new Set((row.tags ?? []).map((tag) => tag.id))];
	if (target === "untagged")
		return ids.length || row.primary ? { ids: [], primary: null } : null;
	if (row.primary === target && ids.includes(target)) return null;
	return {
		ids: ids.includes(target) ? ids : [...ids, target],
		primary: target,
	};
}

/** The brand wash falls below the panel field floor in several palettes. Reuse
 * the already-contracted selected-row ground and ink for both drag entry paths;
 * the accent outline states the transient drop intent without a faint wash. */
export const TAG_DROP_PREVIEW_CLASSES = [
	"bg-row-selected",
	"text-ink!",
	"outline",
	"outline-1",
	"outline-accent",
] as const;
