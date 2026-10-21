import {
	DesktopControlError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { t } from "@shared/i18n";
import { create } from "zustand";
import type {
	DesiredTag,
	SessionTags,
	TagCategory,
	TagRegistry,
} from "../../../../shared/desktop-contract";
import { useCanonicalSessionsStore } from "./canonical-sessions-store";

// A later press owns the row. A failed older request must never roll back a newer
// assignment, just as setSessionPin guards its optimistic write with a stamp.
const writes = new Map<string, symbol>();
type State = {
	categories: TagCategory[];
	loading: boolean;
	error: string | null;
	fetchCategories: () => Promise<void>;
	/** Returns the registry the server acknowledged, so a caller can resolve a
	 * tag it just created without racing an unrelated catalogue refresh. */
	replaceCategories: (desired: DesiredTag[]) => Promise<TagCategory[]>;
	assignSessionTags: (
		sessionId: string,
		tagIds: string[],
		primary: string | null,
		expectedRevision?: string | null,
	) => Promise<SessionTags | undefined>;
};

export const useSessionTagsStore = create<State>((set, get) => ({
	categories: [],
	loading: false,
	error: null,
	fetchCategories: async () => {
		set({ loading: true, error: null });
		try {
			const result = await desktopResult<TagRegistry>({ op: "tags.list" });
			set({ categories: result.tags, loading: false });
		} catch (error) {
			set({
				error: userFacingMessage(error, t("ui.chat.tags.load_failed")),
				loading: false,
			});
		}
	},
	replaceCategories: async (tags) => {
		// Write failures belong to the invoking dialog, not the catalogue load
		// state: replacing that state would hide its still-editable draft.
		set({ error: null });
		const result = await desktopResult<TagRegistry>({
			op: "tags.replace",
			tags,
		});
		set({ categories: result.tags });
		// Only the catalogue knows assignment age and primary deletion fallback.
		void useCanonicalSessionsStore.getState().fetchSessions();
		return result.tags;
	},
	assignSessionTags: async (sessionId, tags, primary, expectedRevision) => {
		const canonical = useCanonicalSessionsStore;
		const before = canonical
			.getState()
			.sessions.find((row) => row.session_id === sessionId);
		// Undefined uses the canonical snapshot. Explicit null keeps old-core
		// moves/undo unconditional rather than fabricating a revision after refresh.
		const revision =
			expectedRevision === undefined ? before?.tags_revision : expectedRevision;
		const stamp = Symbol(sessionId);
		writes.set(sessionId, stamp);
		const refs = tags.flatMap((id) => {
			const tag = get().categories.find((entry) => entry.id === id);
			return tag ? [{ id: tag.id, name: tag.name }] : [];
		});
		canonical.setState((state) => ({
			sessions: state.sessions.map((row) =>
				row.session_id === sessionId ? { ...row, tags: refs, primary } : row,
			),
		}));
		try {
			const answer = await desktopResult<SessionTags>({
				op: "sessions.tags",
				sessionId,
				tags,
				primary,
				...(typeof revision === "string"
					? { expected_revision: revision }
					: {}),
			});
			if (writes.get(sessionId) !== stamp) return;
			canonical.setState((state) => ({
				sessions: state.sessions.map((row) =>
					row.session_id === sessionId
						? {
								...row,
								tags: answer.tags,
								primary: answer.primary,
								...(answer.tags_revision === undefined
									? {}
									: { tags_revision: answer.tags_revision }),
							}
						: row,
				),
			}));
			void canonical.getState().fetchSessions();
			void get().fetchCategories();
			return answer;
		} catch (error) {
			if (writes.get(sessionId) === stamp && before) {
				canonical.setState((state) => ({
					sessions: state.sessions.map((row) =>
						row.session_id === sessionId
							? { ...row, tags: before.tags, primary: before.primary }
							: row,
					),
				}));
			}
			if (isTagsConflict(error)) await canonical.getState().fetchSessions();
			throw error;
		} finally {
			if (writes.get(sessionId) === stamp) writes.delete(sessionId);
		}
	},
}));

/** A conflict is not a retry: reload authoritative assignments before another edit. */
export function isTagsConflict(error: unknown): boolean {
	return (
		error instanceof DesktopControlError &&
		error.status === 409 &&
		error.code === "tags_conflict"
	);
}
