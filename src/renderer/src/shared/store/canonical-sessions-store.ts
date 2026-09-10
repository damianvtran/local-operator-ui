/** Canonical sessions are the only conversation identities. Profile names stage
 * drafts; the legacy agent mapping is retained only to resolve old deep links. */
import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
	type CompletionAttention,
	type SessionBinding,
	type SessionCatalogueStatus,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";

export type CanonicalSessionRow = {
	session_id: string;
	title?: string | null;
	cwd?: string | null;
	updated_at?: number | null;
	preview?: string | null;
	attention?: CompletionAttention;
	live_state?: string;
	pending?: string | null;
	active?: boolean;
	status?: SessionCatalogueStatus;
	binding?: SessionBinding;
	[key: string]: unknown;
};
type BackendSessionRow = Omit<CanonicalSessionRow, "session_id"> & {
	id: string;
	name: string;
	mtime: number;
};
export type ChatDraft = {
	key: string;
	target?: ChatTarget;
	createRequestId: string;
	admissionRequestId: string;
	sessionId?: string;
	pending?: boolean;
	error?: string;
	errorCode?: string;
	submittedText?: string;
	submittedAttachments?: string[];
	submittedImages?: ChatImage[];
	submittedMode?: "prompt" | "steer";
	/**
	 * True only once an admission request has actually been ISSUED, i.e. its
	 * outcome is genuinely unknown to us. This is what the unchanged-payload
	 * guard keys on: a send that failed BEFORE admission (session creation
	 * refused, provider unconfigured) admitted nothing, so holding the composer
	 * to that exact text would lock a conversation over a failure we know did
	 * not land. Only a request that may already be executing must be retried
	 * byte-for-byte.
	 */
	admissionAttempted?: boolean;
};
export type ChatImage = {
	data_b64: string;
	mime_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
};

/**
 * Which draft a chat view owns. A staged draft is keyed by its own key, but once
 * a session exists `draftKey` is null and the send draft lives under
 * `send:<id>` — reading only `draftKey` there left a failed send's retained text
 * unreachable. It lives here, beside the drafts it addresses, so the rule is
 * exercised by the store tests rather than duplicated in an untested component.
 */
export function draftIdentityFor(
	draftKey: string | null,
	sessionId: string | null | undefined,
): string | null {
	return draftKey ?? (sessionId ? `send:${sessionId}` : null);
}

/** Create and admission are intentionally separate receipts. A response lost
 * between them retains its exact IDs and payload; retry never reallocates or
 * deletes work that may already have been admitted by the owner. */
export async function admitChatDraft(
	key: string,
	input: {
		text: string;
		attachments: string[];
		images: ChatImage[];
		mode: "prompt" | "steer";
		cwd: string;
	},
	sessionId?: string,
): Promise<string | null> {
	const store = useCanonicalSessionsStore.getState();
	const previous = store.drafts[key];
	if (previous?.pending) return null;
	if (
		previous?.admissionAttempted &&
		previous.submittedText !== undefined &&
		(previous.submittedText !== input.text ||
			JSON.stringify(previous.submittedAttachments) !==
				JSON.stringify(input.attachments) ||
			// Images are payload identity too. Comparing only text/attachments let a
			// retry that added an image pass the guard and then silently send the
			// FIRST attempt's images, dropping the new one with no error.
			JSON.stringify(previous.submittedImages ?? []) !==
				JSON.stringify(input.images))
	) {
		throw new Error(
			"The previous send has not been confirmed. Retry it unchanged, or discard it to send something different.",
		);
	}
	const draft: ChatDraft = previous ?? {
		key,
		createRequestId: crypto.randomUUID(),
		admissionRequestId: crypto.randomUUID(),
	};
	// `mode` MUST be pinned once an admission has been issued, even though it
	// reads like a delivery instruction rather than payload. The server keys its
	// receipt on a sha256 of the WHOLE request body, `mode` included
	// (desktop_receipts.py), and raises ReceiptConflict -> HTTP 409 when a retry
	// of the same requestId hashes differently. So the lost-response case (turn
	// admitted, response never arrived, session now streaming, UI recomputes
	// busy=true) would retry as "steer", 409 forever, and report a failure for a
	// message that actually landed. Pinning keeps the retry an idempotent replay.
	const images = draft.admissionAttempted
		? (draft.submittedImages ?? input.images)
		: input.images;
	const mode = draft.admissionAttempted
		? (draft.submittedMode ?? input.mode)
		: input.mode;
	store.updateDraft(key, {
		...draft,
		pending: true,
		submittedText: input.text,
		submittedAttachments: input.attachments,
		submittedImages: images,
		submittedMode: mode,
		error: undefined,
	});
	try {
		let id = sessionId ?? draft.sessionId;
		if (!id) {
			id =
				(await store.createSession(
					input.cwd,
					draft.target,
					draft.createRequestId,
				)) ?? undefined;
			if (!id)
				throw new Error(
					useCanonicalSessionsStore.getState().error ?? "Chat could not start.",
				);
			store.updateDraft(key, { sessionId: id });
		}
		// From here the outcome is unknowable on failure: the owner may have
		// admitted the command before the response was lost.
		store.updateDraft(key, { admissionAttempted: true });
		await desktopResult({
			op: "sessions.message",
			sessionId: id,
			requestId: draft.admissionRequestId,
			text: input.text,
			images: images.length ? images : undefined,
			mode,
		});
		store.finishDraft(key, id);
		return id;
	} catch (error) {
		store.updateDraft(key, {
			pending: false,
			// 413 and 422 on this path are both OUR OWN refusals, raised before
			// `fetch` is ever called (`src/main/desktop-transport.ts`): 422 is the
			// `safeParse` of our own schema, which precedes the request, and 413 is
			// the byte-budget guard immediately after it. The backend can produce
			// neither - uvicorn enforces no body limit and the frame validator maps
			// its refusal to 409. So nothing was admitted and we know it with
			// certainty, which is exactly the case the flag's own contract above says
			// it must NOT cover.
			//
			// 422 is listed because the schema caps `text` in CHARACTERS while the
			// pre-flight weighs BYTES: a long ASCII paste can satisfy the byte budget
			// and still fail the schema, so a 422 reaches here for a message whose
			// only fault is length (round 1, R1). The pre-flight now refuses that
			// case up front, but the latch must not depend on one guard being
			// exhaustive - anything we refuse locally has admitted nothing.
			//
			// Latching here was a trap with no exit: the banner said "send it again",
			// the unchanged-payload guard then refused any edit, and images are part
			// of that identity check - so the one action that would make the message
			// fit, removing a screenshot, was the one action forbidden. The only way
			// out was discarding the message.
			...(error instanceof DesktopControlError &&
			(error.status === 413 || error.status === 422)
				? { admissionAttempted: false }
				: {}),
			errorCode:
				error instanceof Error &&
				"code" in error &&
				typeof error.code === "string"
					? error.code
					: undefined,
			error:
				error instanceof Error
					? error.message
					: "The send could not be confirmed.",
		});
		throw error;
	}
}
type CanonicalSessionsState = {
	sessions: CanonicalSessionRow[];
	activeSessionId: string | null;
	activeDraftKey: string | null;
	drafts: Record<string, ChatDraft>;
	sessionByAgent: Record<string, string>;
	pendingSessionId: string | null;
	loading: boolean;
	truncated: boolean;
	error: string | null;
	cwd: string;
	setCwd: (cwd: string) => void;
	fetchSessions: (limit?: number) => Promise<void>;
	createSession: (
		cwd: string,
		target?: ChatTarget,
		requestId?: string,
	) => Promise<string | null>;
	setActiveSession: (sessionId: string | null) => void;
	openSession: (sessionId: string) => Promise<boolean>;
	cancelOpen: () => void;
	stageDraft: (target?: ChatTarget, fresh?: boolean) => string;
	updateDraft: (key: string, patch: Partial<ChatDraft>) => void;
	finishDraft: (key: string, sessionId: string) => void;
	/**
	 * Abandon a stuck send. The retained payload is the user's own text, so the
	 * only safe owner of that decision is the user: we drop our claim that the
	 * next send must match it, and never touch the session or its transcript.
	 */
	discardDraft: (key: string) => void;
	bindSession: (legacyAgentId: string, sessionId: string) => void;
	upsertSession: (row: CanonicalSessionRow) => void;
};

function mergeRow(
	current: CanonicalSessionRow | undefined,
	incoming: CanonicalSessionRow,
): CanonicalSessionRow {
	return {
		...current,
		...incoming,
		attention: mergeCompletionAttention(
			current?.attention,
			incoming.attention,
			incoming.session_id,
		),
	};
}
/** Full list responses replace membership; a disappeared row is not immortal.
 * Stream updates use upsert separately and never imply a complete inventory. */
export function replaceSessionRows(
	current: CanonicalSessionRow[],
	incoming: CanonicalSessionRow[],
): CanonicalSessionRow[] {
	const byId = new Map(current.map((row) => [row.session_id, row]));
	return [
		...new Map(
			incoming.map((row) => [
				row.session_id,
				mergeRow(byId.get(row.session_id), row),
			]),
		).values(),
	];
}
let navigationGeneration = 0;
let refreshGeneration = 0;
export const useCanonicalSessionsStore = create<CanonicalSessionsState>()(
	persist(
		(set, get) => ({
			sessions: [],
			activeSessionId: null,
			activeDraftKey: null,
			drafts: {},
			sessionByAgent: {},
			pendingSessionId: null,
			loading: false,
			truncated: false,
			error: null,
			cwd: "~",
			setCwd: (cwd) => set({ cwd }),
			fetchSessions: async (limit = 500) => {
				const generation = ++refreshGeneration;
				set({ loading: true, error: null });
				try {
					const result = await desktopResult<{
						sessions: BackendSessionRow[];
						truncated?: boolean;
					}>({ op: "sessions.list", limit });
					if (generation !== refreshGeneration) return;
					const rows = result.sessions.map(({ id, name, mtime, ...rest }) => ({
						...rest,
						session_id: id,
						title: name,
						updated_at: mtime,
					}));
					set((state) => ({
						sessions: replaceSessionRows(state.sessions, rows),
						loading: false,
						truncated: result.truncated === true,
					}));
				} catch (error) {
					if (generation === refreshGeneration)
						set({
							loading: false,
							error:
								error instanceof Error
									? error.message
									: "Chats could not refresh. Retry to reconnect.",
						});
				}
			},
			createSession: async (cwd, target, requestId = crypto.randomUUID()) => {
				try {
					const result = await desktopResult<{
						session_id: string;
						binding: CanonicalSessionRow["binding"];
					}>({
						op: "sessions.create",
						requestId,
						cwd,
						...(target ? { target } : {}),
					});
					get().upsertSession({
						session_id: result.session_id,
						cwd,
						binding: result.binding,
					});
					return result.session_id;
				} catch (error) {
					set({
						error:
							error instanceof Error
								? error.message
								: "Chat could not start. Retry with the same draft.",
					});
					throw error;
				}
			},
			setActiveSession: (activeSessionId) => {
				++navigationGeneration;
				set({ activeSessionId, activeDraftKey: null, pendingSessionId: null });
			},
			openSession: async (sessionId) => {
				const generation = ++navigationGeneration;
				set({ pendingSessionId: sessionId, error: null });
				try {
					// A candidate read does not acknowledge output or switch the current view.
					// Only a successful latest intent commits; failed reads keep outgoing work.
					await desktopResult({ op: "sessions.get", sessionId });
					if (generation !== navigationGeneration) return false;
					set({
						activeSessionId: sessionId,
						activeDraftKey: null,
						pendingSessionId: null,
					});
					return true;
				} catch (error) {
					if (generation === navigationGeneration)
						set({
							pendingSessionId: null,
							error:
								error instanceof Error
									? error.message
									: "Chat could not open. Retry.",
						});
					return false;
				}
			},
			cancelOpen: () => {
				++navigationGeneration;
				set({ pendingSessionId: null });
			},
			stageDraft: (target, fresh = false) => {
				++navigationGeneration;
				const key =
					!fresh && target
						? `draft:${target.kind}:${target.name}`
						: `draft:${crypto.randomUUID()}`;
				const existing = get().drafts[key];
				set((state) => ({
					activeDraftKey: key,
					pendingSessionId: null,
					error: null,
					drafts: {
						...state.drafts,
						[key]: existing ?? {
							key,
							target,
							createRequestId: crypto.randomUUID(),
							admissionRequestId: crypto.randomUUID(),
						},
					},
				}));
				return key;
			},
			updateDraft: (key, patch) =>
				set((state) => ({
					drafts: {
						...state.drafts,
						[key]: { ...state.drafts[key], ...patch },
					},
				})),
			finishDraft: (key, sessionId) =>
				set((state) => {
					const drafts = { ...state.drafts };
					delete drafts[key];
					return {
						drafts,
						...(state.activeDraftKey === key
							? { activeDraftKey: null, activeSessionId: sessionId }
							: {}),
					};
				}),
			discardDraft: (key) =>
				set((state) => {
					const drafts = { ...state.drafts };
					delete drafts[key];
					return { drafts };
				}),
			bindSession: (_legacyAgentId, sessionId) =>
				get().setActiveSession(sessionId),
			upsertSession: (row) =>
				set((state) => {
					const present = state.sessions.some(
						(item) => item.session_id === row.session_id,
					);
					return {
						sessions: present
							? state.sessions.map((item) =>
									item.session_id === row.session_id
										? mergeRow(item, row)
										: item,
								)
							: [...state.sessions, row],
					};
				}),
		}),
		{
			name: "canonical-sessions-storage",
			partialize: (state) => ({
				sessionByAgent: state.sessionByAgent,
				activeSessionId: state.activeSessionId,
				activeDraftKey: state.activeDraftKey,
				cwd: state.cwd,
				drafts: Object.fromEntries(
					Object.entries(state.drafts).map(([key, draft]) => [
						key,
						{ ...draft, pending: false },
					]),
				),
			}),
		},
	),
);
