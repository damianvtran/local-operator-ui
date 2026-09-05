/**
 * Canonical desktop session store.
 *
 * Conversations in this app are canonical session records (12-hex session
 * IDs) owned by the backend's desktop session API, not agent profiles. An
 * agent ID is a profile reference a session may carry; it is never the
 * session identity. The store keeps the list, the active session, and the
 * agent->session mapping so list/create/open/reopen preserve identity across
 * restarts and watcher updates never invent a second row for the same
 * session.
 *
 * Rows are merged by session_id: a watcher refresh that returns the same
 * session must update the existing row in place, never append a duplicate,
 * and must not steal the active selection or scroll a reading user.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { create } from "zustand";

export type CanonicalSessionRow = {
	session_id: string;
	title?: string | null;
	cwd?: string | null;
	updated_at?: number | null;
	agent_id?: string | null;
	[key: string]: unknown;
};

/** Backend list row: `{id, name, mtime, ...}` (extra fields allowed). */
type BackendSessionRow = {
	id: string;
	name: string;
	mtime: number;
	[key: string]: unknown;
};

function fromBackend(row: BackendSessionRow): CanonicalSessionRow {
	const { id, name, mtime, ...rest } = row;
	return { ...rest, session_id: id, title: name, updated_at: mtime };
}

type CanonicalSessionsState = {
	sessions: CanonicalSessionRow[];
	activeSessionId: string | null;
	/** Agent profile -> canonical session mapping, so reopening an agent's
	 * conversation resumes the same session identity instead of creating a
	 * new one per launch. */
	sessionByAgent: Record<string, string>;
	loading: boolean;
	error: string | null;
	fetchSessions: () => Promise<void>;
	createSession: (cwd: string, agentId?: string) => Promise<string | null>;
	setActiveSession: (sessionId: string | null) => void;
	/** Merge one row from a watcher/stream update without duplicating or
	 * reordering the list. */
	upsertSession: (row: CanonicalSessionRow) => void;
};

function mergeRows(
	current: CanonicalSessionRow[],
	incoming: CanonicalSessionRow[],
): CanonicalSessionRow[] {
	const byId = new Map(current.map((row) => [row.session_id, row]));
	for (const row of incoming) {
		byId.set(row.session_id, { ...byId.get(row.session_id), ...row });
	}
	// Preserve the incoming order for rows the backend returned; rows it did
	// not return keep their previous relative order at the tail.
	const ordered: CanonicalSessionRow[] = [];
	const seen = new Set<string>();
	for (const row of incoming) {
		const merged = byId.get(row.session_id);
		if (merged && !seen.has(row.session_id)) {
			ordered.push(merged);
			seen.add(row.session_id);
		}
	}
	for (const row of current) {
		if (!seen.has(row.session_id)) ordered.push(row);
	}
	return ordered;
}

export const useCanonicalSessionsStore = create<CanonicalSessionsState>()(
	(set, get) => ({
		sessions: [],
		activeSessionId: null,
		sessionByAgent: {},
		loading: false,
		error: null,

		fetchSessions: async () => {
			set({ loading: true, error: null });
			try {
				const result = await desktopResult<{
					sessions: BackendSessionRow[];
				}>({ op: "sessions.list" });
				set((state) => ({
					sessions: mergeRows(
						state.sessions,
						(result.sessions ?? []).map(fromBackend),
					),
					loading: false,
				}));
			} catch (error) {
				set({
					loading: false,
					error:
						error instanceof Error
							? error.message
							: "The conversation list could not be loaded.",
				});
			}
		},

		createSession: async (cwd, agentId) => {
			try {
				const result = await desktopResult<{ session_id: string }>({
					op: "sessions.create",
					requestId: crypto.randomUUID(),
					cwd,
				});
				const row: CanonicalSessionRow = {
					session_id: result.session_id,
					cwd,
					agent_id: agentId ?? null,
				};
				set((state) => ({
					sessions: mergeRows(state.sessions, [row]),
					activeSessionId: result.session_id,
					sessionByAgent: agentId
						? { ...state.sessionByAgent, [agentId]: result.session_id }
						: state.sessionByAgent,
				}));
				return result.session_id;
			} catch (error) {
				set({
					error:
						error instanceof Error
							? error.message
							: "The conversation could not be created.",
				});
				return null;
			}
		},

		setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

		upsertSession: (row) => {
			const { sessions, activeSessionId } = get();
			const existing = sessions.find(
				(candidate) => candidate.session_id === row.session_id,
			);
			// A watcher update for the already-active session must not disturb
			// selection; a new row is appended without becoming active.
			set({
				sessions: mergeRows(sessions, [row]),
				activeSessionId: existing ? activeSessionId : activeSessionId,
			});
		},
	}),
);
