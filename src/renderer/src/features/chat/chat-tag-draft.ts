import type { DesiredTag, TagRef } from "../../../../shared/desktop-contract";

/** Registry replacement reuses an existing ID for a name-only entry. A draft
 * cannot therefore both confirm deletion of that ID and recreate its name:
 * the server would keep its assignments, contradicting the delete confirmation.
 * Require two explicit Apply operations instead of silently keeping the ID.
 */
export function deletedTagNameReused(
	categories: readonly TagRef[],
	draft: readonly DesiredTag[],
): string | null {
	const retained = new Set(draft.flatMap((tag) => (tag.id ? [tag.id] : [])));
	const removedNames = new Set(
		categories
			.filter((tag) => !retained.has(tag.id))
			.map((tag) => tag.name.trim().toLocaleLowerCase()),
	);
	return (
		draft.find(
			(tag) => !tag.id && removedNames.has(tag.name.trim().toLocaleLowerCase()),
		)?.name ?? null
	);
}
