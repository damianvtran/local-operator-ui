import { draftPrimary } from "@features/chat/chat-tag-groups";
import {
	TAG_REGISTRY_LIMIT,
	TAG_SELECTION_LIMIT,
	hasTagName,
	tagNameIssue,
	togglePickerTag,
} from "@features/chat/chat-tag-picker";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import {
	isTagsConflict,
	useSessionTagsStore,
} from "@shared/store/session-tags-store";
import { useEffect, useRef, useState } from "react";
import type { TagCategory, TagRef } from "../../../../shared/desktop-contract";

export type TagCommitFailure = "failed" | "conflict" | "remote" | "full";
export type TagToggleResult = {
	ok: boolean;
	primary: string | null;
	reason?: TagCommitFailure;
};
export type TagCreateResult = {
	created: TagCategory;
	assigned: boolean;
} | null;

/**
 * The single immediate-commit path for per-conversation tags.
 *
 * WHY A HOOK RATHER THAN DIALOG STATE: the tag dialog, the sidebar and a
 * `/tag` command all perform the same three operations — toggle a tag applied
 * or unapplied, clear all tags, create-and-assign in one action — against the
 * same optimistic store and the same revision contract. A second copy would
 * drift on rollback, on the 8/32 caps, or on the revision each write must carry.
 * UI shells own layout, focus and toasts; this owns state and writes.
 *
 * CALLER CONTRACT: the caller passes the conversation's committed assignment
 * when the surface mounts. Every listed action writes on the press; there is no
 * staged draft, so a surface must not offer Cancel/Escape as an undo. A failed
 * write restores the previous selection and leaves the surface open for the
 * next press, which is the retry.
 */
export function useChatTagAssignment({
	sessionId,
	tags,
	primary,
	revision,
}: {
	sessionId: string;
	tags?: TagRef[];
	primary: string | null;
	revision?: string | null;
}) {
	const {
		categories,
		loading,
		error: loadError,
		fetchCategories,
		replaceCategories,
		assignSessionTags,
	} = useSessionTagsStore();
	const [ids, setIds] = useState(() => tags?.map((tag) => tag.id) ?? []);
	const [held, setHeld] = useState(primary);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState("");
	// Our own writes move the revision, and every later write must carry the
	// revision its predecessor returned or the server answers 409.
	const currentRevision = useRef(revision ?? null);
	// Deleted categories cannot be resubmitted from a stale selection. Preserve
	// the assignment order so removing the primary previews server fallback.
	const selected =
		loading || loadError !== null
			? ids
			: ids.filter((id) => categories.some((tag) => tag.id === id));
	const effectivePrimary = draftPrimary(selected, held);
	useEffect(() => {
		if (loading || loadError) return;
		const surviving = ids.filter((id) =>
			categories.some((tag) => tag.id === id),
		);
		if (surviving.length === ids.length) return;
		// Keep the surviving assignment order, but never silently resubmit IDs
		// removed by another client while this surface was open.
		setIds(surviving);
		setHeld((current) => draftPrimary(surviving, current));
		setError(t("ui.chat.tags.registry_changed"));
	}, [categories, ids, loading, loadError]);

	const announce = (nextIds: string[], nextPrimary: string | null) =>
		setNotice(
			t("ui.chat.tags.selection_status", {
				count: String(nextIds.length),
				name:
					categories.find((tag) => tag.id === nextPrimary)?.name ??
					t("ui.chat.tags.untagged"),
			}),
		);

	const write = async (
		nextIds: string[],
		nextPrimary: string | null,
	): Promise<{ ok: true } | { ok: false; reason: TagCommitFailure }> => {
		if (pending) return { ok: false, reason: "failed" };
		const previous = { ids, primary: held };
		setPending(true);
		setError(null);
		try {
			const answer = await assignSessionTags(
				sessionId,
				nextIds,
				nextPrimary,
				currentRevision.current,
			);
			if (answer?.tags_revision !== undefined)
				currentRevision.current = answer.tags_revision;
			return { ok: true };
		} catch (caught) {
			setIds(previous.ids);
			setHeld(previous.primary);
			if (caught instanceof DesktopControlError && caught.status === 422)
				await fetchCategories();
			if (
				caught instanceof DesktopControlError &&
				caught.code === "session_is_remote"
			) {
				setError(t("ui.chat.tags.remote"));
				return { ok: false, reason: "remote" };
			}
			if (isTagsConflict(caught)) {
				await fetchCategories();
				setError(t("ui.chat.tags.changed_elsewhere"));
				return { ok: false, reason: "conflict" };
			}
			setError(t("ui.chat.tags.save_failed"));
			return { ok: false, reason: "failed" };
		} finally {
			setPending(false);
		}
	};

	/** Toggle one tag applied/unapplied and commit it. Returns the primary the
	 * caller should confirm in its own feedback channel (a toast, a status line).
	 */
	const toggle = async (id: string): Promise<TagToggleResult> => {
		if (pending)
			return { ok: false, primary: effectivePrimary, reason: "failed" };
		if (!selected.includes(id) && selected.length >= TAG_SELECTION_LIMIT) {
			setNotice(t("ui.chat.tags.selection_limit"));
			return { ok: false, primary: effectivePrimary, reason: "full" };
		}
		const next = togglePickerTag(selected, id);
		const fallback = draftPrimary(next, held);
		setIds(next);
		setHeld(fallback);
		announce(next, fallback);
		const result = await write(next, fallback);
		return {
			ok: result.ok,
			primary: fallback,
			reason: result.ok ? undefined : result.reason,
		};
	};

	const setPrimaryTag = async (id: string): Promise<TagToggleResult> => {
		if (pending || !selected.includes(id) || id === effectivePrimary)
			return { ok: false, primary: effectivePrimary };
		setHeld(id);
		announce(selected, id);
		const result = await write(selected, id);
		return {
			ok: result.ok,
			primary: id,
			reason: result.ok ? undefined : result.reason,
		};
	};

	const clear = async (): Promise<TagToggleResult> => {
		if (pending || !selected.length)
			return { ok: false, primary: effectivePrimary };
		setIds([]);
		setHeld(null);
		const result = await write([], null);
		if (result.ok) setNotice(t("ui.chat.tags.removed_all"));
		return {
			ok: result.ok,
			primary: null,
			reason: result.ok ? undefined : result.reason,
		};
	};

	/** Create a registry tag and assign it to this conversation as one action.
	 * Resolves the new tag from the write's own answer, not a later store read:
	 * a concurrent catalogue refresh could otherwise hide the tag that was just
	 * created. Returns null when the registry write itself failed.
	 */
	const createAndAssign = async (name: string): Promise<TagCreateResult> => {
		if (pending || loading || loadError) return null;
		const trimmed = name.trim();
		if (tagNameIssue(trimmed) || hasTagName(categories, trimmed)) {
			setError(
				tagNameIssue(trimmed) === "reserved"
					? t("ui.chat.tags.name_reserved")
					: tagNameIssue(trimmed) === "long"
						? t("ui.chat.tags.name_long")
						: t("ui.chat.tags.duplicate_name", { name: trimmed }),
			);
			return null;
		}
		if (categories.length >= TAG_REGISTRY_LIMIT) {
			setError(t("ui.chat.tags.registry_limit"));
			return null;
		}
		if (selected.length >= TAG_SELECTION_LIMIT) {
			setError(t("ui.chat.tags.selection_limit"));
			return null;
		}
		setPending(true);
		setError(null);
		let created: TagCategory | undefined;
		try {
			// A timeout/duplicate may have committed remotely. Refresh BEFORE every
			// attempt, not after submitting a stale full-registry replacement again.
			await fetchCategories();
			const fresh = useSessionTagsStore.getState();
			if (fresh.error) throw new Error();
			if (hasTagName(fresh.categories, trimmed)) {
				setError(t("ui.chat.tags.duplicate_name", { name: trimmed }));
				return null;
			}
			if (fresh.categories.length >= TAG_REGISTRY_LIMIT) {
				setError(t("ui.chat.tags.registry_limit"));
				return null;
			}
			const registry = await replaceCategories([
				...fresh.categories.map((tag) => ({ id: tag.id, name: tag.name })),
				{ name: trimmed },
			]);
			created = registry.find((tag) => tag.name === trimmed);
		} catch {
			// A response can be lost after commit. Re-read before claiming that
			// nothing was created, and never silently select a concurrent duplicate.
			await fetchCategories();
			const fresh = useSessionTagsStore.getState();
			if (fresh.error) setError(null);
			else if (hasTagName(fresh.categories, trimmed))
				setError(t("ui.chat.tags.duplicate_name", { name: trimmed }));
			else setError(t("ui.chat.tags.create_failed"));
			return null;
		} finally {
			setPending(false);
		}
		if (!created) {
			await fetchCategories();
			setError(t("ui.chat.tags.create_failed"));
			return null;
		}
		// The registry write above is durable even if this assignment fails; the
		// tag stays in the list so it can be selected, and the copy says exactly
		// that rather than inviting a duplicate Create retry.
		const next = [...selected, created.id];
		const fallback = draftPrimary(next, held);
		setIds(next);
		setHeld(fallback);
		setNotice(t("ui.chat.tags.created_name", { name: created.name }));
		const committed = await write(next, fallback);
		if (committed.ok) {
			setNotice(
				t("ui.chat.tag_dialogs.created_assigned", { name: created.name }),
			);
			return { created, assigned: true };
		}
		setError(
			t("ui.chat.tag_dialogs.assign_created_failed", { name: created.name }),
		);
		return { created, assigned: false };
	};

	return {
		categories,
		loading,
		loadError,
		fetchCategories,
		ids,
		selected,
		primary: effectivePrimary,
		pending,
		error,
		notice,
		toggle,
		setPrimaryTag,
		clear,
		createAndAssign,
	};
}
