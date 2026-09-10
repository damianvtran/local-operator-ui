/** Canonical sessions are the only conversation identities. Profile names stage
 * drafts; the legacy agent mapping is retained only to resolve old deep links. */
import {
	DesktopControlError,
	UserFacingError,
	desktopResult,
	userFacingMessage,
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
 * The unconfirmed-send guard's category, so the composer can recognise its own
 * refusal and offer the two controls that actually resolve it (restore the held
 * payload, or discard the claim) instead of the generic "edit and send again"
 * tail, which is the one thing this guard refuses.
 *
 * A code rather than a string comparison on the message: the copy is expected
 * to be reworded, and matching on prose would silently stop matching.
 */
export const UNCONFIRMED_SEND_CODE = "unconfirmed_send";

/**
 * Shown when a send failed with nothing user-facing to say - a runtime
 * exception rather than a backend rejection. Stated once and shared, because
 * the page-level fallback and this one are the same sentence about the same
 * event and drifted apart when they were two literals.
 */
export const SEND_UNCONFIRMED_MESSAGE =
	"The send could not be confirmed. Retry this draft.";

/**
 * The one place a composer value becomes a send PAYLOAD.
 *
 * The unchanged-payload guard compares byte-for-byte, because a retry of a
 * request that may already be executing has to be an idempotent replay. The
 * composer meanwhile has to decide what to SAY about that guard - whether the
 * held message is on screen, whether Restore is worth offering, whether the
 * abandon control would destroy typed text. Those were two comparisons over two
 * different strings (`===` in the guard, `.trim() ===` in the composer), and a
 * whitespace-only edit fell into the gap between them: the guard refused the
 * send while the composer believed the box already held the payload, so it
 * suppressed BOTH escapes and left only the control that empties the box.
 * Trailing space, leading space and a trailing newline all reproduced it -
 * including the trailing-newline case the trim was originally written for.
 *
 * So the trim moves to the payload boundary instead of living in the copy
 * logic. Every send normalizes here, every stored `submittedText` is therefore
 * already normalized, and the composer compares normalized against normalized.
 * The guard and the copy cannot disagree about what "the same message" means,
 * because there is now only one string. Whitespace at the ends is not content
 * the owner needs preserved; the interior is untouched.
 */
export function normalizeSendText(text: string): string {
	return text.trim();
}

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
	// Normalized once, here, and used for the guard, the stored claim and the
	// wire alike - see `normalizeSendText`. Comparing or sending `input.text`
	// anywhere below would reopen the gap between what the guard enforces and
	// what the composer says about it.
	const text = normalizeSendText(input.text);
	if (
		previous?.admissionAttempted &&
		previous.submittedText !== undefined &&
		(previous.submittedText !== text ||
			JSON.stringify(previous.submittedAttachments) !==
				JSON.stringify(input.attachments) ||
			// Images are payload identity too. Comparing only text/attachments let a
			// retry that added an image pass the guard and then silently send the
			// FIRST attempt's images, dropping the new one with no error.
			JSON.stringify(previous.submittedImages ?? []) !==
				JSON.stringify(input.images))
	) {
		/*
		 * One action, and both remedies are controls rather than instructions.
		 *
		 * This used to read "Retry it unchanged, or discard it to send something
		 * different", which asked the user to reproduce a payload they could no
		 * longer see - the held text is not in the composer, that is precisely why
		 * this guard fired. Following it by hand is a loop: edit, send, refused,
		 * edit. So the sentence now states the situation only, and
		 * `UNCONFIRMED_SEND_CODE` lets the composer attach "Restore it" (puts the
		 * exact payload back, making an unchanged retry one keypress away) and
		 * discard. Copy never names an action the user has to perform blind.
		 */
		throw new UserFacingError(
			"The previous send has not been confirmed, and it does not match what is in the composer now.",
			UNCONFIRMED_SEND_CODE,
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
		submittedText: text,
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
				throw new UserFacingError(
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
			text,
			images: images.length ? images : undefined,
			mode,
		});
		store.finishDraft(key, id);
		// A send that landed retires every message about the send that did not.
		// `createSession` records its failure page-level and only `fetchSessions`/
		// `openSession` ever cleared it, so a successful retry left a stale "Chat
		// could not start." standing over a working conversation.
		useCanonicalSessionsStore.setState({ error: null });
		return id;
	} catch (error) {
		// One owner for one failure. `createSession` sets the page-level `error`
		// AND rethrows, so the same sentence rendered twice - once at the top of
		// the chat column and once at the composer. The composer's copy is the
		// actionable one (it sits on the text that failed and carries the
		// remedies), so the send takes the message over and clears the other.
		useCanonicalSessionsStore.setState({ error: null });
		store.updateDraft(key, {
			pending: false,
			// 413 and 422 on this path both mean the message was refused BEFORE
			// anything was admitted, which is exactly the case the flag's own
			// contract above says it must NOT cover.
			//
			// Ours are raised before `fetch` is ever called
			// (`src/main/desktop-transport.ts`): 422 is the `safeParse` of our own
			// schema, which precedes the request, and 413 is the byte-budget guard
			// immediately after it. 413 can ONLY be ours - uvicorn enforces no body
			// limit and the frame validator maps its own refusal to 409.
			//
			// 422 is different and the earlier claim here that the backend "can
			// produce neither" was FALSE: `desktop_sessions.py` raises 422 directly
			// (unknown command, invalid loop) and pydantic answers 422 for any
			// malformed body before the route runs - an empty message and a
			// 900,001-byte body both return one (round 2, Q-8). Un-latching is still
			// correct for those, because a validation refusal is decided before the
			// prompt is admitted to the session, so no work started either way. The
			// reason to un-latch is "nothing was admitted", not "the status could
			// only have come from us", and an inaccurate claim about a limit is how
			// the original bug survived review.
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
			error: userFacingMessage(error, SEND_UNCONFIRMED_MESSAGE),
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
	/**
	 * Drop the unchanged-payload claim while KEEPING the draft row.
	 *
	 * `discardDraft` deletes the whole row, which is right when the user
	 * abandons the message. It is wrong for the case that produced this: the
	 * user typed something else and wants that to send. Deleting the row there
	 * would also drop `sessionId` and the request ids, so the retry would create
	 * a second session for a conversation that already has one. This releases
	 * exactly the claim - `admissionAttempted` and the submitted payload - and
	 * leaves identity intact.
	 */
	releaseClaim: (key: string) => void;
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
				set((state) => {
					// A PARTIAL patch onto a row that is gone must not resurrect it.
					// This was a blind spread onto `state.drafts[key]`, so when a draft
					// was abandoned while its admission was still in flight, the settling
					// request's catch rebuilt the row from the patch alone - without
					// `key`, `createRequestId` or `admissionRequestId`. The next send
					// then went to the wire with `requestId: undefined`, which the closed
					// IPC schema rejects, and that refusal re-armed this store's own
					// unchanged-payload guard: every later send failed against a healthy
					// backend with no causal link to the click that caused it. Discard is
					// deliberate and outranks the outcome of the request it abandoned.
					//
					// The condition is identity, not existence, because this setter is
					// also the legitimate CREATE path: `admitChatDraft` opens a send for
					// an already-existing session by patching a `send:<id>` key that has
					// no row yet, and that patch carries the whole identity. So a patch
					// that can stand on its own as a draft may create one; a fragment
					// like `{pending, error}` may only ever update something already
					// there.
					const present = state.drafts[key];
					const complete =
						patch.key !== undefined &&
						patch.createRequestId !== undefined &&
						patch.admissionRequestId !== undefined;
					if (!present && !complete) return {};
					return {
						drafts: {
							...state.drafts,
							[key]: { ...state.drafts[key], ...patch },
						},
					};
				}),
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
					/*
					 * Clear the pointer as well as the draft, the way
					 * `finishDraft` does. Deleting only the entry leaves
					 * `activeDraftKey` naming a draft that no longer exists, and
					 * every consumer reads that pointer as "a draft is being
					 * composed": the sidebar's New chat row highlights itself with
					 * `aria-current="page"` for a discarded agent draft the user
					 * never opened, and the session rows keep suppressing their own
					 * highlight. Unlike `finishDraft` there is no session to become
					 * active - a discarded draft never became one - so the selection
					 * is left where it was.
					 */
					return {
						drafts,
						...(state.activeDraftKey === key ? { activeDraftKey: null } : {}),
					};
				}),
			releaseClaim: (key) =>
				set((state) => {
					const draft = state.drafts[key];
					if (!draft) return {};
					const {
						admissionAttempted: _attempted,
						submittedText: _text,
						submittedAttachments: _attachments,
						submittedImages: _images,
						submittedMode: _mode,
						error: _error,
						errorCode: _errorCode,
						...kept
					} = draft;
					return {
						drafts: {
							...state.drafts,
							// A fresh admission id with the claim: the abandoned one may
							// still be executing on the owner, and reusing it would make the
							// next (different) message an idempotent REPLAY of the old
							// payload - the server keys its receipt on the request id and
							// would answer with the first attempt's result.
							[key]: { ...kept, admissionRequestId: crypto.randomUUID() },
						},
					};
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
