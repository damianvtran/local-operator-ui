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
// tags.replace replaces the WHOLE registry. Queue mutation intents, not already
// derived snapshots: two different headers (or picker creation) must each read
// the registry acknowledged by the previous owner before deriving their edit.
// Releasing in finally keeps a refused write from poisoning later ownership.
let registryWriteTail: Promise<void> = Promise.resolve();
// A list already in flight before a registry acknowledgement cannot replace
// that acknowledgement with its older snapshot before the next queued intent.
let registryGeneration = 0;
type State = {
	categories: TagCategory[];
	loading: boolean;
	error: string | null;
	fetchCategories: () => Promise<void>;
	/** Returns the registry the server acknowledged, so a caller can resolve a
	 * tag it just created without racing an unrelated catalogue refresh. */
	replaceCategories: (
		derive: (current: readonly TagCategory[]) => DesiredTag[] | null,
	) => Promise<TagCategory[]>;
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
		const generation = registryGeneration;
		set({ loading: true, error: null });
		try {
			const result = await desktopResult<TagRegistry>({ op: "tags.list" });
			set({
				...(generation === registryGeneration
					? { categories: result.tags }
					: {}),
				loading: false,
			});
		} catch (error) {
			if (generation !== registryGeneration) {
				set({ loading: false });
				return;
			}
			set({
				error: userFacingMessage(error, t("ui.chat.tags.load_failed")),
				loading: false,
			});
		}
	},
	replaceCategories: async (derive) => {
		const previous = registryWriteTail;
		let release!: () => void;
		// Acquire a place synchronously, before the first await and BEFORE deriving
		// desired state. A per-hook pending flag cannot serialize sibling editors.
		registryWriteTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			const tags = derive(get().categories);
			if (tags === null) return get().categories;
			// Failures belong to the editor, not the catalogue load state: keep its
			// still-editable draft and the last acknowledged registry visible.
			set({ error: null });
			const result = await desktopResult<TagRegistry>({
				op: "tags.replace",
				tags,
			});
			registryGeneration++;
			set({ categories: result.tags });
			void useCanonicalSessionsStore.getState().fetchSessions();
			return result.tags;
		} finally {
			release();
		}
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
