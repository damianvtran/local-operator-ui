import {
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { cn } from "@shared/lib/utils";
import {
	SEND_UNCONFIRMED_MESSAGE,
	UNCONFIRMED_SEND_CODE,
	admitChatDraft,
	draftIdentityFor,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DESKTOP_MESSAGE_BUDGET_BYTES } from "../../../../../shared/desktop-contract";
import { PickerOutlet } from "../pickers/picker-registry";
import { specUnresolved } from "../session-status/session-model";
import { type WireImage, boundImagesForBudget } from "../utils/bound-image";
import {
	messageBodyBytes,
	messageBudgetRefusal,
} from "../utils/message-budget";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import type { MessageInputHandle } from "./message-input";
import { useSlashDispatch } from "./slash-dispatch";

const SESSION_ID = /^[a-f0-9]{12}$/;
const IMAGE_MIME_BY_EXT: Record<
	string,
	"image/png" | "image/jpeg" | "image/gif" | "image/webp"
> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/**
 * Canonical admission carries images inline as `{data_b64, mime_type}`. The
 * composer holds attachments as paths or data URLs; only image types the
 * runtime accepts are encoded, anything else is left out rather than refused.
 *
 * The JSON transport budget for a message is 880,000 bytes - headroom under
 * the backend's real 900,000-byte control-frame limit, enforced by
 * `Prompt.nonempty` at
 * `local_operator/server/routes/desktop_sessions.py:101`. The earlier note
 * here claimed 256 KiB "see the backend contract", which the backend contract
 * contradicted: that number was an arbitrary transport literal 3.4x stricter
 * than what the server accepts, and one Retina screenshot exceeded it.
 *
 * Images are bounded CLIENT-SIDE before encoding, to the same 1024px long edge
 * the TUI applies (`bound-image.ts` cites the constants). Raising the budget
 * alone would not have been enough: unbounded screenshots are ~8.5 MB each, so
 * none of them fit at any budget this transport can offer.
 */
const IMAGE_DATA_URL = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/;
const FILE_SCHEME = /^file:\/\//;

async function encodeImageAttachments(attachments: string[], text: string) {
	const images: WireImage[] = [];
	for (const attachment of attachments) {
		const dataUrl = IMAGE_DATA_URL.exec(attachment);
		if (dataUrl) {
			images.push({
				data_b64: dataUrl[3],
				mime_type: dataUrl[1] as (typeof IMAGE_MIME_BY_EXT)[string],
			});
			continue;
		}
		const ext = attachment.split(".").pop()?.toLowerCase() ?? "";
		const mime = IMAGE_MIME_BY_EXT[ext];
		if (!mime || !window.api?.readFile) continue;
		const read = await window.api.readFile(
			attachment.replace(FILE_SCHEME, ""),
			"base64",
		);
		if (read.success) images.push({ data_b64: read.data, mime_type: mime });
	}
	// Bound per image first, then check the TOTAL and step the whole set down
	// until the message fits. Several individually legal screenshots that do not
	// collectively fit is the common case, and it is not visible to a per-image
	// rule.
	return boundImagesForBudget(
		images.slice(0, 8),
		DESKTOP_MESSAGE_BUDGET_BYTES,
		(candidate) => messageBodyBytes(text, candidate),
	);
}

/** Each displayed identity owns its stream and composer. A candidate open is
 * prepared by the store first; changing rows never stops the outgoing runtime. */
function SessionPanel({
	identity,
	draftKey,
	sessionId,
	pendingNavigation,
}: {
	identity: string;
	draftKey: string | null;
	sessionId?: string;
	pendingNavigation: boolean;
}) {
	const canonical = useCanonicalSessionStream(sessionId, Boolean(sessionId));
	useDesktopWatchLease(sessionId, canonical.subscriptionId);
	const input = useRef<MessageInputHandle>(null);
	const container = useRef<HTMLDivElement>(null);
	const end = useRef<HTMLDivElement>(null);
	const draftIdentity = draftIdentityFor(draftKey, sessionId);
	const draft = useCanonicalSessionsStore((state) =>
		draftIdentity ? state.drafts[draftIdentity] : undefined,
	);
	const cwd = useCanonicalSessionsStore((state) => state.cwd);
	const setCwd = useCanonicalSessionsStore((state) => state.setCwd);
	const [admitting, setAdmitting] = useState(false);
	const sendLock = useRef(false);
	const lastCatalogueState = useRef("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [sendErrorCode, setSendErrorCode] = useState<string | undefined>();
	const [options, setOptions] = useState(false);
	const [tab, setTab] = useState<"chat" | "raw">("chat");
	const { isFarFromBottom, scrollToBottom } = useScrollToBottom(
		50,
		container,
		canonical.transcript.records.length,
	);
	const busy = canonical.frontend?.streaming === true;
	const navigate = useNavigate();
	const rebind = (id: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(id)
			.then((ok) => {
				if (ok) navigate(`/chat/${id}`);
			});
	};
	/*
	 * The effort rungs the owner will accept, shared with `EffortPicker`.
	 *
	 * Same `queryKey` and same `queryFn` shape as the picker's own `useEntities`
	 * call, so this is one cache entry rather than a second source of truth -
	 * which is the entire point, since the two disagreeing is what the strip's
	 * chip advertised and the picker then denied. Disabled without a session for
	 * the same reason the strip itself is withheld then.
	 */
	const effortEntities = useQuery({
		queryKey: ["desktop", "entities", sessionId, "effort", ""],
		queryFn: () =>
			desktopResult<{ entities: { value: string }[]; current: unknown }>({
				op: "commands.entities",
				sessionId: sessionId as string,
				command: "effort",
			}),
		enabled: Boolean(sessionId),
		staleTime: 15_000,
	});
	/*
	 * Refetch the rung list the moment the owner's spec becomes KNOWN.
	 *
	 * The 15s `staleTime` is right for a list that rarely changes, but it is
	 * measured from the last fetch rather than from the last time the answer
	 * could have changed - and resolving the spec is exactly when it changes.
	 * Without this, the very act that gives the model its ladder leaves the
	 * picker serving the pre-resolution answer for up to 15s, so the chip reads
	 * `high` while the dialog it opens says the model has no adjustable effort
	 * (UX round 3, U13).
	 *
	 * Keyed on the resolved SELECTOR rather than on the spec object: the
	 * projection repaints on every token, and an object identity would refetch
	 * on each one. `specUnresolved` going false is the edge that matters, and it
	 * happens once per model.
	 */
	const queryClient = useQueryClient();
	const resolvedModel = specUnresolved(canonical.frontend?.effective_model)
		? null
		: (canonical.frontend?.effective_model?.model_id ?? null);
	/*
	 * Only an actual unresolved -> resolved TRANSITION invalidates.
	 *
	 * Gating on `resolvedModel` being truthy fired on mount too, so every warm
	 * session open - where the model is already resolved at first paint - spent
	 * a redundant `commands.entities` round trip on a query fetched
	 * milliseconds earlier and well inside its own staleTime
	 * (`invalidateQueries` refetches an active query regardless of freshness).
	 * The previous comment claimed this gated on an edge; it did not, and a
	 * mount with the value already settled is not one (round 4, R2).
	 */
	// `undefined` means "not observed yet". Distinct from `null` (observed, and
	// unresolved): the FIRST observation seeds the ref without invalidating,
	// because a query fetched on this same mount is already the answer. Keyed
	// per session so switching sessions re-arms rather than inheriting.
	const wasResolved = useRef<
		{ session: string | null; model: string | null } | undefined
	>(undefined);
	useEffect(() => {
		const previous = wasResolved.current;
		wasResolved.current = { session: sessionId ?? null, model: resolvedModel };
		if (!sessionId || !resolvedModel) return;
		const sameSession = previous?.session === sessionId;
		// Seed-only on first sight of this session, and no-op when the model has
		// not actually changed under us.
		if (!sameSession || previous?.model === resolvedModel) return;
		void queryClient.invalidateQueries({
			queryKey: ["desktop", "entities", sessionId, "effort", ""],
		});
	}, [sessionId, resolvedModel, queryClient]);
	const { dispatch, dispatchFromControl, picker } = useSlashDispatch({
		sessionId,
		canonical,
		rebind,
		addMessage: (message) => canonical.addNote(message.message ?? ""),
		focusComposer: () => input.current?.focusInput(),
	});
	useEffect(() => {
		if (draftKey) input.current?.focusInput();
	}, [draftKey]);
	useEffect(() => {
		if (!sessionId || !canonical.frontend) return;
		// Only metadata comes from the stream. Membership/order remain list-owned,
		// and attention merges by the durable revision rather than arrival time.
		const store = useCanonicalSessionsStore.getState();
		if (!store.sessions.some((row) => row.session_id === sessionId)) return;
		store.upsertSession({
			session_id: sessionId,
			title: canonical.frontend.conversation_title,
			attention: canonical.frontend.attention,
		});
	}, [sessionId, canonical.frontend]);
	useEffect(() => {
		const marker = JSON.stringify([
			sessionId,
			canonical.frontend?.streaming,
			canonical.frontend?.attention?.unseen,
			canonical.frontend?.active_agent,
			canonical.frontend?.active_team,
		]);
		if (!sessionId || marker === lastCatalogueState.current) return;
		lastCatalogueState.current = marker;
		void useCanonicalSessionsStore.getState().fetchSessions();
	}, [
		sessionId,
		canonical.frontend?.streaming,
		canonical.frontend?.attention?.unseen,
		canonical.frontend?.active_agent,
		canonical.frontend?.active_team,
	]);
	const send = async (
		content: string,
		attachments: string[],
	): Promise<boolean> => {
		const store = useCanonicalSessionsStore.getState();
		// Same identity the view reads, so a send can never address a different
		// draft than the one whose retained text and Discard control are shown.
		const key = draftIdentityFor(draftKey, sessionId);
		if (!key) return false;
		const previous = store.drafts[key];
		if (pendingNavigation || sendLock.current || previous?.pending)
			return false;
		sendLock.current = true;
		setAdmitting(true);
		setSendError(null);
		setSendErrorCode(undefined);
		try {
			// Three outcomes, not two. `consumed` retires the draft the way a sent
			// message does; `retained` means the line WAS a command and was refused
			// before it ran, so the composer must keep the text - returning false
			// here is what `use-message-input.ts:172` reads to leave it in place
			// (round 2, Q-7). Only `not-a-command` falls through to the model path.
			const dispatched = await dispatch(content);
			if (dispatched === "consumed") return true;
			if (dispatched === "retained") return false;
			if (!draftKey && !sessionId) return false;
			const gate = canonical.frontend?.pending_gate;
			if (gate && canonical.ownerEpoch && sessionId) {
				if (gate.kind === "approval") {
					const value = content.trim().toLowerCase();
					const yes = ["y", "yes", "approve", "ok", "allow"].includes(value);
					if (!yes && !["n", "no", "deny", "reject", "cancel"].includes(value))
						throw new Error("Reply yes or no to answer the approval request.");
					await desktopResult({
						op: "sessions.answer",
						sessionId,
						epoch: canonical.ownerEpoch,
						requestId: gate.request_id,
						approved: yes,
					});
				} else
					await desktopResult({
						op: "sessions.answer",
						sessionId,
						epoch: canonical.ownerEpoch,
						requestId: gate.request_id,
						value: content,
						questionIndex: gate.question_index,
					});
				return true;
			}
			const images = await encodeImageAttachments(attachments, content);
			// Refuse BEFORE admission, where the sizes are still known and the
			// composer is still editable. A refusal from the transport arrives after
			// the draft has latched, so its "send it again" advice is then refused by
			// the unchanged-payload guard and the user cannot drop an image to fit.
			const refusal = messageBudgetRefusal(content, images);
			if (refusal) {
				setSendError(refusal);
				return false;
			}
			const id = await admitChatDraft(
				key,
				{
					text: content,
					attachments,
					images,
					mode: busy ? "steer" : "prompt",
					cwd,
				},
				sessionId,
			);
			if (!id) return false;
			if (
				draftKey &&
				useCanonicalSessionsStore.getState().activeSessionId === id
			)
				navigate(`/chat/${id}`, { replace: true });
			void store.fetchSessions();
			return true;
		} catch (error) {
			// Only authored sentences reach the composer. `error.message` on a
			// runtime exception is a stack-trace fragment - with the backend
			// stopped this line rendered "TypeError: fetch failed" inside the
			// alert's own prose. See `userFacingMessage`.
			setSendError(userFacingMessage(error, SEND_UNCONFIRMED_MESSAGE));
			setSendErrorCode(
				error instanceof Error &&
					"code" in error &&
					typeof error.code === "string"
					? error.code
					: undefined,
			);
			return false;
		} finally {
			sendLock.current = false;
			setAdmitting(false);
		}
	};
	const stop = () => {
		if (sessionId)
			void desktopResult({
				op: "sessions.command",
				sessionId,
				requestId: crypto.randomUUID(),
				command: "stop",
			}).catch((error) =>
				// Renders in the same composer alert as a failed send, so it takes the
				// same authored-copy rule.
				setSendError(userFacingMessage(error, "Stop could not be confirmed.")),
			);
	};
	const loadedTarget =
		canonical.frontend?.active_team ||
		canonical.frontend?.active_agent ||
		draft?.target?.name;
	const title = draftKey
		? loadedTarget
			? `New chat with ${loadedTarget}`
			: "New chat"
		: canonical.frontend?.conversation_title || "Untitled chat";
	// active_agent/active_team come from the LIVE stream, so a cold session (no
	// running owner) reports nulls and the header fell back to the cwd, naming
	// nothing. The catalogue row's binding is the durable answer and is already
	// what the sidebar groups by, so it is the fallback rather than a second
	// source of truth: live values still win while an owner is attached.
	const boundRow = useCanonicalSessionsStore((state) =>
		sessionId
			? state.sessions.find((row) => row.session_id === sessionId)
			: undefined,
	);
	const loaded =
		[canonical.frontend?.active_agent, canonical.frontend?.active_team]
			.filter(Boolean)
			.join(" · ") ||
		[boundRow?.binding?.agent, boundRow?.binding?.team]
			.filter(Boolean)
			.join(" · ");
	const view = !sessionId
		? { ...canonical, status: "live" as const, error: null }
		: canonical;
	/*
	 * The failed send, assembled for the composer.
	 *
	 * Local state first, store second: `sendError` is this attempt's outcome and
	 * `draft.error` is the last one the store recorded, which survives a remount
	 * and so is what a user returning to the chat sees.
	 *
	 * `onDiscard` is offered only when the store is actually holding a claim
	 * (`submittedText`). Without one there is nothing for `discardDraft` to
	 * clear, and an always-present Discard would imply the app is retaining
	 * something it is not.
	 */
	const activeError = sendError || draft?.error;
	const activeErrorCode = sendErrorCode ?? draft?.errorCode;
	const clearError = () => {
		setSendError(null);
		setSendErrorCode(undefined);
	};
	/*
	 * A remedy that worked retires the message that asked for it.
	 *
	 * `unresolved_attachment` says this send has no agent or team behind it.
	 * Choosing one through the alert's own button binds the session - the header
	 * changes to "New chat with coder" and the picker confirms it - but the
	 * alert kept complaining, still offering the button, with nothing to tell
	 * the user whether the remedy had taken. The condition the code names is
	 * observable, so it is what clears the error rather than a keystroke.
	 *
	 * Only this code: the other remedy (`profile_registry_unavailable`) is about
	 * a registry being reachable, which a binding does not evidence.
	 */
	//
	// Keyed on the LIVE binding only, never on `loadedTarget`: that falls back to
	// `draft?.target?.name`, which a draft staged from the agents page or `/agent`
	// already carries before any send is attempted. Reading it here made an
	// `unresolved_attachment` failure clear itself on the first render after the
	// failure - taking the explanation and both "Choose agent"/"Choose team"
	// remedies with it, on the very path where they are the only way out. A
	// pre-send intention is not evidence that the attachment resolved; only an
	// agent or team actually bound to the session is.
	const boundTarget =
		canonical.frontend?.active_team || canonical.frontend?.active_agent;
	const attachmentResolved =
		activeErrorCode === "unresolved_attachment" && Boolean(boundTarget);
	useEffect(() => {
		if (!attachmentResolved) return;
		setSendError(null);
		setSendErrorCode(undefined);
		if (draftIdentity)
			useCanonicalSessionsStore.getState().updateDraft(draftIdentity, {
				error: undefined,
				errorCode: undefined,
			});
	}, [attachmentResolved, draftIdentity]);
	/*
	 * The claim, and whether the user can currently see what it holds.
	 *
	 * `admissionAttempted` with a `submittedText` means the store will refuse
	 * any send whose payload differs, and it survives clearing the textarea -
	 * deliberately, because a keystroke is not evidence about a request that may
	 * be executing on the owner. What it must not do is survive INVISIBLY: a
	 * user who selected-all-deleted saw nothing retained, typed something else,
	 * and was refused by a healthy backend with no link back to what they did.
	 *
	 * So the claim travels to the composer whenever it is held, error or no
	 * error. Whether it needs SAYING is the composer's call, not this one's: the
	 * answer depends on the live textarea value, which lives there. When the box
	 * already holds the exact payload the message is on screen, an unchanged
	 * retry is one keypress, and a notice would be noise.
	 */
	//
	// `!draft.pending` is load-bearing, not defensive. `admissionAttempted` is set
	// BEFORE the awaited request, so it is true for the whole in-flight window (up
	// to the 30s request timeout). Without this the notice and its abandon control
	// were live over a send whose outcome was still unknown, and abandoning there
	// deleted the row that the settling request then patched - reintroducing the
	// invisible-claim dead end one layer down. A request that may be executing is
	// not something to offer an escape from; the escapes appear once it settles.
	const heldText =
		draft?.admissionAttempted && !draft.pending
			? draft.submittedText
			: undefined;
	const releaseHeld = () => {
		if (draftIdentity)
			useCanonicalSessionsStore.getState().releaseClaim(draftIdentity);
		clearError();
	};
	const composerSendError =
		activeError || heldText !== undefined
			? {
					message: activeError ?? undefined,
					// The "what to do" half of the error contract travels with the
					// message. An unresolved attachment needs a profile chosen; an
					// unreachable registry needs the agents page. Any other code has no
					// specific remedy, so it offers none rather than a generic button.
					actions:
						// The unconfirmed-send guard's remedies are Restore and the abandon
						// control, both rendered by the composer from `heldText`. It must
						// not also offer a code-specific action, or the row carries two
						// answers to the same question.
						activeErrorCode === UNCONFIRMED_SEND_CODE
							? undefined
							: activeErrorCode === "unresolved_attachment"
								? [
										{
											label: "Choose agent",
											onClick: () => void dispatch("/agent"),
										},
										{
											label: "Choose team",
											onClick: () => void dispatch("/team"),
										},
									]
								: activeErrorCode === "profile_registry_unavailable"
									? [
											{
												label: "Manage agents",
												onClick: () => navigate("/agents"),
											},
										]
									: undefined,
					/*
					 * The held payload itself, so the composer can put it back.
					 *
					 * The guard demands a byte-identical retry of a message the user can
					 * no longer see - asking them to retype it is asking for the one
					 * thing they cannot do. Handing over the text turns "retry it
					 * unchanged" from an instruction into a control.
					 */
					heldText,
					onRestoreHeld:
						heldText !== undefined ? () => clearError() : undefined,
					/*
					 * Two different abandonments, because they lose different things.
					 *
					 * `onDiscard` drops the whole draft and is what the user wants when
					 * the message is finished with. `onReleaseHeld` drops only the claim
					 * and keeps the row - the composer picks it when the box holds text
					 * that is NOT the held payload, i.e. the user has already moved on and
					 * discarding would silently destroy what they just typed.
					 */
					// Same settled-send condition as `heldText`: discarding a draft whose
					// admission is still in flight is what manufactured the ghost row.
					onDiscard:
						draft?.submittedText && !draft.pending
							? () => {
									if (draftIdentity)
										useCanonicalSessionsStore
											.getState()
											.discardDraft(draftIdentity);
									clearError();
								}
							: undefined,
					onReleaseHeld: heldText !== undefined ? releaseHeld : undefined,
					/*
					 * Editing dismisses the alert, and must clear the STORE's copy too -
					 * `draft.error` outlives local state, so clearing only `sendError`
					 * would leave the message hanging over text the user has since
					 * fixed, which is the exact defect being replaced.
					 *
					 * It clears the error and nothing else. `submittedText` and
					 * `admissionAttempted` are a claim about a request that may already
					 * be executing on the owner, and a keystroke is not evidence about
					 * that - so the unchanged-send guard survives, and a genuinely
					 * different message still gets refused with its own message until
					 * the user discards. Discard is the only control that drops a claim.
					 */
					onDismiss: () => {
						clearError();
						// Unconditional: `errorCode` used to be cleared only when a
						// `draft.error` existed to clear alongside it, so a code recorded
						// by local state alone outlived the message that explained it.
						if (draftIdentity && draft)
							useCanonicalSessionsStore.getState().updateDraft(draftIdentity, {
								error: undefined,
								errorCode: undefined,
							});
					},
				}
			: undefined;
	return (
		<div className="flex h-full min-h-0 flex-col">
			{/*
			 * The working directory is edited on the composer's chip, not on a bar
			 * above the conversation. A full-width labelled input spanning the top
			 * of the chat gave a rarely-changed setting the most prominent slot on
			 * the screen, and it only ever appeared on drafts, so the chat shell
			 * changed shape between a new chat and a live one. */}
			{/*
			 * A failed send is surfaced ON the composer, not here. This block used
			 * to render the error, a read-only echo of the user's message and a
			 * discard link at the very top of the chat column - measured at 709px
			 * above the composer that already held that exact text, editable
			 * (docs/evidence/send-error). Two copies
			 * of one message, and the failure furthest on screen from the control
			 * that resolves it. `composerSendError` below carries all of it,
			 * remedies included, to the one place the user is already looking. */}
			{options && (
				<div
					className={cn(
						"flex flex-wrap gap-2 border-b border-hairline px-4 py-2 text-body-sm",
					)}
				>
					{[
						"model",
						"agent",
						"team",
						"rename",
						"resume",
						"fork",
						"new",
						"settings",
					].map((command) => (
						<button
							key={command}
							type="button"
							className={cn("rounded-md px-2 py-1 hover:bg-elevated")}
							onClick={() => {
								setOptions(false);
								void dispatch(`/${command}`);
							}}
						>
							{command === "agent"
								? "Choose agent"
								: command === "team"
									? "Choose team"
									: command.charAt(0).toUpperCase() + command.slice(1)}
						</button>
					))}
				</div>
			)}
			<div className={cn("min-h-0 flex-1")}>
				<ChatContent
					activeTab={tab}
					onTabChange={setTab}
					agentName={title}
					description={
						// `loaded` names the agent/team actually answering; without it an
						// opened chat showed only a cwd and the user could not tell which
						// profile was in force.
						loaded ||
						(draftKey
							? "The session starts when you send your first message."
							: canonical.frontend?.cwd || "Canonical chat")
					}
					onOpenOptions={() => setOptions((value) => !value)}
					isOptionsSidebarOpen={false}
					onCloseOptions={() => setOptions(false)}
					agentId={identity}
					/*
					 * Draft: the store's staged cwd, which `admitChatDraft` passes to
					 * `sessions.create`. Live: the directory the session actually runs
					 * in, reported by the canonical stream. `onChangeCwd` is supplied
					 * only in the first case, which is what makes the chip read-only
					 * once the session exists - there is no backend route that moves a
					 * live session, so an editable chip there would always fail.
					 */
					cwd={draftKey ? cwd : canonical.frontend?.cwd}
					onChangeCwd={
						draftKey && !draft?.sessionId && !admitting ? setCwd : undefined
					}
					messages={[]}
					isLoading={false}
					isLoadingMessages={false}
					isFetchingMore={canonical.loadingOlder}
					isFarFromBottom={isFarFromBottom}
					messagesContainerRef={container}
					messagesEndRef={end}
					scrollToBottom={scrollToBottom}
					rawInfoContent={JSON.stringify(canonical.frontend, null, 2)}
					onSendMessage={send}
					sendError={composerSendError}
					/*
					 * The session's readings, straight off the canonical stream, and
					 * the SAME dispatcher the composer submits through. Routing the
					 * chips' clicks here rather than mounting a picker directly is
					 * what keeps `/model` typed and `/model` clicked on one path:
					 * there is no second way to open a picker in this app.
					 *
					 * A draft has no session yet, so it has no readings and no owner
					 * to ask - `dispatch` itself answers "/model needs an open
					 * conversation" in that state, which is a worse way to learn it
					 * than not offering the control, so the strip is withheld until
					 * the session exists.
					 */
					sessionStatus={
						sessionId
							? {
									frontend: canonical.frontend,
									/*
									 * `dispatchFromControl`, not `dispatch`: a chip has no
									 * fallback path to report a failure the way typed text
									 * does, so an unconsumed outcome has to be surfaced here
									 * rather than dropped into a `void` (round 1, U2).
									 */
									onCommand: (line: string) => void dispatchFromControl(line),
									/*
									 * The SAME query `EffortPicker` renders from, by the
									 * same key, so React Query serves both from one cache
									 * entry and the chip cannot offer a rung the picker
									 * would then refuse (round 1, U3).
									 */
									effortEntities: effortEntities.data?.entities,
								}
							: undefined
					}
					currentJobId={null}
					onCancelJob={stop}
					messageInputRef={input}
					canonical={{
						view,
						busy,
						admitting: admitting || pendingNavigation,
						onStop: stop,
					}}
				/>
			</div>
			<PickerOutlet context={picker} />
		</div>
	);
}

export function ChatPage() {
	const { agentId: routeIdentity } = useParams<{ agentId?: string }>();
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const active = useCanonicalSessionsStore((state) => state.activeSessionId);
	const draftKey = useCanonicalSessionsStore((state) => state.activeDraftKey);
	const draft = useCanonicalSessionsStore((state) =>
		draftKey ? state.drafts[draftKey] : undefined,
	);
	const pending = useCanonicalSessionsStore((state) => state.pendingSessionId);
	const error = useCanonicalSessionsStore((state) => state.error);
	const [routeError, setRouteError] = useState<string | null>(null);
	useEffect(() => {
		if (!enabled || !routeIdentity) return;
		const store = useCanonicalSessionsStore.getState();
		const id = SESSION_ID.test(routeIdentity)
			? routeIdentity
			: store.sessionByAgent[routeIdentity];
		if (!id) {
			setRouteError(
				"This legacy link has no canonical chat. Its saved history is unchanged.",
			);
			return;
		}
		setRouteError(null);
		if (store.activeSessionId !== id || store.activeDraftKey)
			void store.openSession(id);
	}, [enabled, routeIdentity]);
	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				useCanonicalSessionsStore.getState().pendingSessionId
			) {
				event.preventDefault();
				useCanonicalSessionsStore.getState().cancelOpen();
			}
		};
		window.addEventListener("keydown", keydown);
		return () => window.removeEventListener("keydown", keydown);
	}, []);
	const stage = (target?: ChatTarget, fresh?: boolean) => {
		useCanonicalSessionsStore.getState().stageDraft(target, fresh);
		setRouteError(null);
		navigate("/chat");
	};
	const select = (id: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(id)
			.then((ok) => {
				if (ok) {
					setRouteError(null);
					navigate(`/chat/${id}`);
				}
			});
	};
	const id = draftKey ? draft?.sessionId : (active ?? undefined);
	const identity = draftKey ?? id;
	return (
		<ChatLayout
			sidebar={
				<ChatSidebar
					selectedConversation={active ?? undefined}
					onSelectConversation={select}
					onStageDraft={stage}
				/>
			}
			content={
				<div className={cn("flex h-full min-h-0 flex-col")}>
					{pending && (
						<p
							aria-live="polite"
							className={cn("px-4 py-2 text-body-sm text-info")}
						>
							Opening chat…{" "}
							<button
								type="button"
								onClick={() =>
									useCanonicalSessionsStore.getState().cancelOpen()
								}
							>
								Cancel
							</button>
						</p>
					)}
					{(routeError || error) && (
						<p
							role="alert"
							className={cn("px-4 py-2 text-body-sm text-danger")}
						>
							{routeError || error}
						</p>
					)}
					{!enabled ? (
						<div className={cn("p-6 text-body text-ink-muted")}>
							{capabilities.isLoading
								? "Connecting to the backend…"
								: capabilities.error
									? capabilities.error.message
									: "Update the backend to use canonical chats. Your existing histories are unchanged."}
							<button
								type="button"
								className={cn("ml-2 underline")}
								onClick={() => void capabilities.refetch()}
							>
								Retry
							</button>
						</div>
					) : identity ? (
						<div className={cn("min-h-0 flex-1")}>
							<SessionPanel
								key={identity}
								identity={identity}
								draftKey={draftKey}
								sessionId={id}
								pendingNavigation={Boolean(pending)}
							/>
						</div>
					) : (
						<div className={cn("p-6")}>
							<h1 className={cn("text-title")}>Start a chat</h1>
							<p className={cn("mt-2 text-body text-ink-muted")}>
								Choose an agent or team, or start a new chat. Nothing starts
								until you send.
							</p>
							<button
								type="button"
								className={cn(
									"mt-4 rounded-md border border-control px-3 py-2",
								)}
								onClick={() => stage(undefined, true)}
							>
								New chat
							</button>
						</div>
					)}
				</div>
			}
		/>
	);
}
