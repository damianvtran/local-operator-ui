import { moveTagPast } from "@features/chat/chat-tag-groups";
import {
	TAG_REGISTRY_LIMIT,
	tagNameIssue,
} from "@features/chat/chat-tag-picker";
import { t } from "@shared/i18n";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import { useState } from "react";
import type {
	DesiredTag,
	TagCategory,
} from "../../../../shared/desktop-contract";

/** Validation refusals keep their actionable sentence; transport failures use save_failed. */
class RegistryRefusal extends Error {}

/**
 * A refused edit: the sentence to show, never an exception for the caller.
 *
 * `retryable` is a stable reason code for the one behaviour the sentence used
 * to carry: whether pressing again can help. The header used to derive it by
 * comparing `error` against `t("ui.chat.tags.save_failed")`, so in every other
 * language a transport failure silently lost its retry control. Validation
 * refusals keep their actionable sentence; transport failures use save_failed.
 */
export type RegistryEditResult =
	| { ok: true }
	| { ok: false; error: string; retryable: boolean };

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
 * THE DESIRED STATE IS BUILT UNDER SHARED STORE OWNERSHIP. `tags.replace` is a
 * full-registry replacement, so a list captured at render would resubmit a tag
 * another client deleted, or undo its rename. The store calls each mutation
 * intent only after its preceding registry writer has settled; validation and
 * desired-state derivation run inside that ownership window, not before it.
 *
 * ONE WRITE AT A TIME, ACROSS THE REGISTRY (the store owns the queue). Local
 * `pending` only guards repeat presses in the SAME editor. A failure leaves the store's last committed registry untouched
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
	const current = (categories: readonly TagCategory[]): DesiredTag[] =>
		[...categories]
			.sort((a, b) => a.order - b.order)
			.map(({ id, name }) => ({ id, name }));
	const write = async (
		derive: (categories: readonly TagCategory[]) => DesiredTag[] | null,
	): Promise<RegistryEditResult> => {
		if (pending)
			return {
				ok: false,
				error: t("ui.chat.tags.save_failed"),
				retryable: true,
			};
		setPending(true);
		try {
			await replaceCategories(derive);
			return { ok: true };
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof RegistryRefusal
						? error.message
						: t("ui.chat.tags.save_failed"),
				retryable: !(error instanceof RegistryRefusal),
			};
		} finally {
			setPending(false);
		}
	};
	const refuse = (message: string): never => {
		throw new RegistryRefusal(message);
	};
	return {
		pending,
		create: (name: string) =>
			write((categories) => {
				const issue = registryNameIssue(name);
				if (issue) return refuse(issue);
				if (categories.length >= TAG_REGISTRY_LIMIT)
					return refuse(t("ui.chat.tags.registry_limit"));
				return [...current(categories), { name: name.trim() }];
			}),
		rename: (id: string, name: string) =>
			write((categories) => {
				const desired = current(categories);
				const tag = desired.find((entry) => entry.id === id);
				if (!tag) return refuse(t("ui.chat.tags.registry_changed"));
				if (tag.name === name.trim()) return null;
				const issue = registryNameIssue(name, id);
				if (issue) return refuse(issue);
				return desired.map((entry) =>
					entry.id === id ? { ...entry, name: name.trim() } : entry,
				);
			}),
		move: (id: string, neighbour: string, direction: "up" | "down") =>
			write((categories) => {
				const next = moveTagPast(categories, id, neighbour, direction);
				if (!next) return refuse(t("ui.chat.tags.registry_changed"));
				return next;
			}),
		remove: (id: string) =>
			write((categories) => {
				const desired = current(categories);
				if (!desired.some((entry) => entry.id === id))
					return refuse(t("ui.chat.tags.registry_changed"));
				return desired.filter((entry) => entry.id !== id);
			}),
	};
}
