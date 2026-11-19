import { t } from "@shared/i18n";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import {
	isTagsConflict,
	useSessionTagsStore,
} from "@shared/store/session-tags-store";
import {
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { movedTagAssignment } from "./chat-tag-drag";

/** All three entry points share the shipped optimistic assignment and the same
 * undo guard. Capture the write's response revision, never a later catalogue
 * refresh (which could already include somebody else's edit). */
export async function moveChatToTag(
	row: CanonicalSessionRow,
	target: string,
	announce: (message: string) => void,
): Promise<void> {
	const assignment = movedTagAssignment(row, target);
	if (!assignment) {
		// Close an armed gesture's announcement without inventing a successful write.
		announce("");
		return;
	}
	const store = useSessionTagsStore.getState();
	try {
		const result = await store.assignSessionTags(
			row.session_id,
			assignment.ids,
			assignment.primary,
			// The assignment was derived from this snapshot, not a newer canonical
			// row that may have changed while a menu or picker was open.
			row.tags_revision ?? null,
		);
		if (!result) return;
		const name =
			store.categories.find((tag) => tag.id === target)?.name ?? target;
		const message =
			target === "untagged"
				? t("ui.chat.tags.removed_all")
				: // A drop ADDS the tag and makes it primary (`movedTagAssignment`); the
					// other tags stay. "Moved to" read as if they had been replaced.
					t("ui.chat.tags.dropped_on", { name });
		announce(message);
		showSuccessToast(message, {
			action: {
				label: t("ui.chat.tags.undo"),
				onClick: () => {
					void store
						.assignSessionTags(
							row.session_id,
							(row.tags ?? []).map((tag) => tag.id),
							row.primary ?? null,
							result.tags_revision ?? null,
						)
						.then(() => {
							announce(t("ui.chat.tags.move_undone"));
						})
						.catch((error: unknown) => {
							const note = isTagsConflict(error)
								? t("ui.chat.tags.changed_elsewhere")
								: t("ui.chat.tags.move_failed");
							announce(note);
							showWarningToast(note);
						});
				},
			},
		});
	} catch (error) {
		const message = isTagsConflict(error)
			? t("ui.chat.tags.changed_elsewhere")
			: t("ui.chat.tags.move_failed");
		announce(message);
		showWarningToast(message);
		throw error;
	}
}
