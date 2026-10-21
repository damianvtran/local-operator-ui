import { moveTagPast } from "@features/chat/chat-tag-groups";
import {
	TAG_REGISTRY_LIMIT,
	tagNameIssue,
} from "@features/chat/chat-tag-picker";
import { t } from "@shared/i18n";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { useState } from "react";
import type { DesiredTag } from "../../../../shared/desktop-contract";

/** A refused edit: the sentence to show, never an exception for the caller. */
export type RegistryEditResult = { ok: true } | { ok: false; error: string };

/**
 * Why a registry name is refused, or null when it may be written. Duplicates are
 * checked against the STORE, not a render snapshot, and case-insensitively with
 * `toLocaleLowerCase` (the Manage dialog's rule, kept); `except` is the tag being
 * renamed, so renaming "Review" to "review" is a case change, not a duplicate.
 */
export function registryNameIssue(
	value: string,
	except?: string,
): string | null {
	const issue = tagNameIssue(value);
	if (issue === "reserved") return t("ui.chat.tags.name_reserved");
	if (issue === "long" || issue === "blank") return t("ui.chat.tags.name_long");
	const name = value.trim().toLocaleLowerCase();
	const taken = useSessionTagsStore
		.getState()
		.categories.some(
			(tag) => tag.id !== except && tag.name.toLocaleLowerCase() === name,
		);
	return taken
		? t("ui.chat.tags.duplicate_name", { name: value.trim() })
		: null;
}

/**
 * The registry edits the sidebar's group headers and tag footer make in place
 * (sidebar tags v3, D2/D3): create, rename, move and delete. They replace the
 * Manage tags dialog, whose write model they keep exactly.
 *
 * THE DESIRED STATE IS BUILT FROM THE STORE AT PRESS TIME. `tags.replace` is a
 * full-registry replacement, so a list captured at render would resubmit a tag
 * another client deleted, or undo its rename. Every edit therefore reads
 * `useSessionTagsStore.getState()` when it runs, the way the dialog's
 * `beginDelete` already did.
 *
 * ONE WRITE AT A TIME, PER SURFACE. `pending` refuses a second edit while one is
 * in flight; a failure leaves the store's last committed registry untouched
 * (the store only writes on an answer) and returns the sentence, so the caller
 * keeps its editor open and the next press is the retry. There is no undo: a
 * deleted tag's assignments cannot be restored by id, which is why deleting a
 * tag that carries conversations asks first.
 */
export function useChatTagRegistry() {
	const replaceCategories = useSessionTagsStore(
		(state) => state.replaceCategories,
	);
	const [pending, setPending] = useState(false);
	const current = (): DesiredTag[] =>
		[...useSessionTagsStore.getState().categories]
			.sort((a, b) => a.order - b.order)
			.map(({ id, name }) => ({ id, name }));
	const write = async (desired: DesiredTag[]): Promise<RegistryEditResult> => {
		if (pending) return { ok: false, error: t("ui.chat.tags.save_failed") };
		setPending(true);
		try {
			await replaceCategories(desired);
			return { ok: true };
		} catch {
			return { ok: false, error: t("ui.chat.tags.save_failed") };
		} finally {
			setPending(false);
		}
	};
	const refuse = (error: string): RegistryEditResult => ({ ok: false, error });
	return {
		pending,
		create: async (name: string): Promise<RegistryEditResult> => {
			const issue = registryNameIssue(name);
			if (issue) return refuse(issue);
			const desired = current();
			if (desired.length >= TAG_REGISTRY_LIMIT)
				return refuse(t("ui.chat.tags.registry_limit"));
			return write([...desired, { name: name.trim() }]);
		},
		rename: async (id: string, name: string): Promise<RegistryEditResult> => {
			const desired = current();
			const tag = desired.find((entry) => entry.id === id);
			if (!tag) return refuse(t("ui.chat.tags.registry_changed"));
			// An unchanged name is not an edit: committing it would spend a write
			// and a catalogue refresh on nothing.
			if (tag.name === name.trim()) return { ok: true };
			const issue = registryNameIssue(name, id);
			if (issue) return refuse(issue);
			return write(
				desired.map((entry) =>
					entry.id === id ? { ...entry, name: name.trim() } : entry,
				),
			);
		},
		move: async (
			id: string,
			neighbour: string,
			direction: "up" | "down",
		): Promise<RegistryEditResult> => {
			const next = moveTagPast(
				useSessionTagsStore.getState().categories,
				id,
				neighbour,
				direction,
			);
			if (!next) return refuse(t("ui.chat.tags.registry_changed"));
			return write(next);
		},
		remove: async (id: string): Promise<RegistryEditResult> => {
			const desired = current();
			if (!desired.some((entry) => entry.id === id))
				return refuse(t("ui.chat.tags.registry_changed"));
			return write(desired.filter((entry) => entry.id !== id));
		},
	};
}
