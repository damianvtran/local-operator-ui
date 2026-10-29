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
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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
	/** The primary the caller should confirm; only meaningful with `assigned`. */
	primary: string | null;
} | null;

/**
 * The single immediate-commit path for per-conversation tags.
 *
 * WHY A HOOK RATHER THAN SURFACE STATE: the sidebar's Tags popover and the
 * composer's `/tag` list shell the same operations — toggle a tag applied or unapplied, clear
 * all tags, create-and-assign in one action — against the same optimistic store
 * and the same revision contract. A second copy would drift on rollback, on the
 * 8/32 caps, or on the revision each write must carry. UI shells own layout,
 * focus and toasts; this owns state and writes.
 *
 * CALLER CONTRACT: the caller passes the conversation's committed assignment
 * when the surface mounts. Every listed action writes on the press; there is no
 * staged draft, so a surface must not offer Cancel/Escape as an undo. A failed
 * write restores the previous selection and leaves the surface open: for an
 * ordinary failure the next press is the retry, and a 409 re-seeds selection and
 * revision from the canonical refresh first, so the next press is a deliberate
 * retry against what the server now holds rather than a replay of the refused edit.
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

	/*
	 * ADOPT AUTHORITATIVE CHANGES WHILE THIS HOOK STAYS MOUNTED.
	 *
	 * The dialog mounts per invocation, so its props are a snapshot and the
	 * caller contract above says so. The composer's `/tag` list is the other
	 * shape: it lives for as long as the composer does, across conversation
	 * switches, external assignments and a catalogue that another client edits
	 * while the list is open. Seeding only in `useState` would leave that list
	 * writing the tags it saw at mount over tags it never read.
	 *
	 * The revision is the trigger because it moves exactly when the server has
	 * acknowledged an assignment. A pending write is never re-seeded underneath
	 * itself: the rollback in `write` owns that window, and the effect re-reads
	 * once it settles. A session SWITCH always re-seeds even mid-write, because
	 * the in-flight ids belong to the conversation that is no longer on screen.
	 */
	const seededSession = useRef(sessionId);
	const seededRevision = useRef(revision ?? null);
	/** A conversation switch seeds even when both revisions are null. */
	const seedPending = useRef(false);
	useEffect(() => {
		const switched = seededSession.current !== sessionId;
		const moved = (revision ?? null) !== seededRevision.current;
		if (switched) {
			seededSession.current = sessionId;
			seedPending.current = true;
			/*
			 * WHY THE RECEIPT AND THE ERROR LINE ARE RETIRED HERE (review round 2,
			 * F4 residual): a switch can land while a write is still pending, and the
			 * reseed below is deliberately deferred until that write settles (the
			 * rollback owns that window). Clearing only in the reseed pass left the
			 * previous conversation's "selected, grouped under" sentence over the new
			 * one for the whole write — and the deferred pass could not repair it, because
			 * the session ref above had already moved, so it read `switched === false`.
			 * The SELECTION stays deferred; only the sentence about it does not.
			 *
			 * A revision move is deliberately different: our own successful write moves
			 * the revision and the reseed runs right after it, so clearing then would
			 * erase the receipt before the user can read it.
			 */
			setError(null);
			setNotice("");
		}
		if (pending) return;
		if (!switched && !moved && !seedPending.current) return;
		seededRevision.current = revision ?? null;
		seedPending.current = false;
		const nextIds = tags?.map((tag) => tag.id) ?? [];
		setIds(nextIds);
		setHeld(draftPrimary(nextIds, primary));
		currentRevision.current = revision ?? null;
	}, [sessionId, revision, pending, tags, primary]);

	const announce = (nextIds: string[], nextPrimary: string | null) =>
		setNotice(
			t("ui.chat.tags.selection_status", {
				/*
				 * A numeric STRING, because the key's shape is derived from English's
				 * `{count}` placeholder (`count: string` in the generated key map).
				 * The Hindi catalogue renders that argument through
				 * `{count, plural, ...}`, and ICU coerces a numeric string there - so
				 * `String(nextIds.length)` above is what keeps it from rendering NaN.
				 * A future caller passing anything that is not digits must use a
				 * different key, not this one (review round 1, F3).
				 */
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
			/*
			 * A write that settles after the surface moved to another conversation
			 * belongs to the OLD one. Its store rollback already ran; touching this
			 * hook's selection, revision or error line here would paint the previous
			 * conversation's answer over the one on screen.
			 */
			if (seededSession.current !== sessionId)
				return { ok: false, reason: "failed" };
			setIds(previous.ids);
			setHeld(previous.primary);
			// The optimistic announcement described the selection this failure just
			// rolled back; withdraw it rather than leaving a polite live region
			// asserting a state that no longer holds.
			setNotice("");
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
				/*
				 * The row this surface mounted with is a SNAPSHOT, and the store has just
				 * awaited a canonical refresh for this conflict. Consume it here: without
				 * re-seeding the revision, every later press repeats the same stale
				 * revision and 409s forever; without re-seeding the selection, the retry
				 * would write our pre-conflict tags over the other client's edit.
				 */
				const fresh = useCanonicalSessionsStore
					.getState()
					.sessions.find((row) => row.session_id === sessionId);
				if (fresh) {
					const freshIds = fresh.tags?.map((tag) => tag.id) ?? [];
					if (fresh.tags_revision !== undefined)
						currentRevision.current = fresh.tags_revision;
					setIds(freshIds);
					setHeld(draftPrimary(freshIds, fresh.primary ?? null));
				}
				setError(t("ui.chat.tag_dialogs.changed_elsewhere"));
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

	/**
	 * Add the tag if this conversation does not carry it yet, then make it the
	 * group the conversation is shown under - in ONE write (sidebar tags v3, D5).
	 * It is the popover's keyboard/pointer twin of dropping a row on a header, so
	 * it shares that act's rule: whatever was dropped on is primary. Two writes
	 * (toggle, then promote) would show the row regrouping twice and could leave
	 * it half-applied if the second refused.
	 */
	const showUnder = async (id: string): Promise<TagToggleResult> => {
		if (pending) return { ok: false, primary: effectivePrimary };
		if (selected.includes(id)) return setPrimaryTag(id);
		if (selected.length >= TAG_SELECTION_LIMIT) {
			setNotice(t("ui.chat.tags.selection_limit"));
			return { ok: false, primary: effectivePrimary, reason: "full" };
		}
		const next = [...selected, id];
		setIds(next);
		setHeld(id);
		announce(next, id);
		const result = await write(next, id);
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
			const registry = await replaceCategories((current) => {
				// Picker creation shares the headers/footer's registry queue. The
				// refresh above is discovery, not ownership: a preceding rename or
				// create may settle while queued, so revalidate and derive HERE.
				if (
					hasTagName(current, trimmed) ||
					current.length >= TAG_REGISTRY_LIMIT
				)
					throw new Error(
						"Registry changed before creation acquired ownership",
					);
				return [
					...current.map((tag) => ({ id: tag.id, name: tag.name })),
					{ name: trimmed },
				];
			});
			created = registry.find((tag) => tag.name === trimmed);
		} catch {
			// A response can be lost after commit. Re-read before claiming that
			// nothing was created, and never silently select a concurrent duplicate.
			await fetchCategories();
			const fresh = useSessionTagsStore.getState();
			if (fresh.error) setError(null);
			else if (hasTagName(fresh.categories, trimmed))
				setError(t("ui.chat.tags.duplicate_name", { name: trimmed }));
			else if (fresh.categories.length >= TAG_REGISTRY_LIMIT)
				setError(t("ui.chat.tags.registry_limit"));
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
			return { created, assigned: true, primary: fallback };
		}
		setError(
			t("ui.chat.tag_dialogs.assign_created_failed", { name: created.name }),
		);
		return { created, assigned: false, primary: effectivePrimary };
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
		showUnder,
		clear,
		createAndAssign,
	};
}
