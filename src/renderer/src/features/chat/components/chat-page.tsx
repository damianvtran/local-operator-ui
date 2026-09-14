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
import { SEND_HELD, type SendOutcome } from "@shared/hooks/use-message-input";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { useWarmSession } from "@shared/hooks/use-warm-session";
import { cn } from "@shared/lib/utils";
import {
	SEND_UNCONFIRMED_MESSAGE,
	SESSION_UNVALIDATED_CODE,
	UNCONFIRMED_SEND_CODE,
	admitChatDraft,
	draftIdentityFor,
	isRefusedBeforeAdmission,
	isSessionUnvalidated,
	panelIdentityFor,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DESKTOP_MESSAGE_BUDGET_BYTES } from "../../../../../shared/desktop-contract";
import type { CanonicalFrontendSync } from "../../../../../shared/desktop-session-contract";
import {
	type AnswerOutcome,
	type SendLock,
	answerGateOption,
	answerValue,
	createSendLock,
	errorCodeOf,
	lostAnswerMessage,
} from "../ask-answer";
import {
	type AdmittedSend,
	admittedSendFor,
	ownerAnswered,
} from "../canonical/working-line-model";
import { catalogueTitleUpdate, resolveChatTitle } from "../chat-title";
import { PickerOutlet } from "../pickers/picker-registry";
import { specUnresolved } from "../session-status/session-model";
import { type WireImage, boundImagesForBudget } from "../utils/bound-image";
import { canvasDocumentForPath } from "../utils/canvas-document";
import {
	messageBodyBytes,
	messageBudgetRefusal,
} from "../utils/message-budget";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import {
	type MessageInputHandle,
	composerHoldsFocusUntouched,
} from "./message-input";
import {
	deriveRunDetails,
	mcpErrorTexts,
	useRunPanelMcpServers,
} from "./run-details";
import { useSlashDispatch } from "./slash-dispatch";

const SESSION_ID = /^[a-f0-9]{12}$/;

/**
 * Which gate a press belongs to.
 *
 * `request_id` alone is not enough: a multi-question ask advances through its
 * questions under ONE request id, and the second question is a fresh thing to
 * answer even though the id is unchanged. Both fields together are what an
 * answer addresses, so both together are what the card's own state is keyed by.
 */
const gateKeyOf = (gate: { request_id: string; question_index: number }) =>
	`${gate.request_id}:${gate.question_index}`;

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
}: {
	identity: string;
	draftKey: string | null;
	sessionId?: string;
}) {
	const canonical = useCanonicalSessionStream(sessionId, Boolean(sessionId));
	useDesktopWatchLease(sessionId, canonical.subscriptionId);
	// Read here rather than threaded from the page: the query is cached with a
	// 60 s staleTime, so this is a store read and not a second request.
	const panelCapabilities = useDesktopCapabilities();
	// Fired from the composer's first keystroke, never from this mount - see
	// `useWarmSession` for why browsing must not spawn runtimes.
	const warm = useWarmSession(sessionId, panelCapabilities.data);
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
	/*
	 * The lock is created lazily and held in a ref, not in state: it has to be
	 * read and written synchronously in one run, and `useMemo` guarantees nothing
	 * about recomputation — a lock that a re-render may replace is not a lock.
	 */
	const sendLockRef = useRef<SendLock | null>(null);
	sendLockRef.current ??= createSendLock();
	const sendLock = sendLockRef.current;
	/* Set when an answer was pressed from the keyboard, so focus can be returned
	 * once the gate moves. See the effect below `answerWithOption`. */
	const restoreFocus = useRef(false);
	/*
	 * What this panel knows about the gate it just pressed, from the press on.
	 *
	 * Held here rather than in the store because it is true of this panel's
	 * session, not of the session: `pending_gate` on the wire is written only by
	 * the main process notifier, so it stays live for the round trip after the
	 * owner has already taken an answer. Without this the options come back
	 * enabled against an answered gate and a second press posts a second answer
	 * for a one-shot question (code review round 1, R-MINOR). Keyed by the gate
	 * itself, so the next gate or the next question clears it by construction.
	 */
	const [answerState, setAnswerState] = useState<{
		key: string;
		sending: boolean;
		refused: string | null;
	} | null>(null);
	/*
	 * The gate this panel is showing, and this panel's own record of having
	 * pressed it.
	 *
	 * Derived rather than reconciled: keying the record by the gate means the next
	 * gate — or the next question of a multi-question ask — clears the hold by
	 * construction, with no effect that has to notice the change and no window in
	 * which a stale hold disables a card that is genuinely answerable.
	 */
	const pendingGate = canonical.frontend?.pending_gate ?? null;
	const gateKey = pendingGate ? gateKeyOf(pendingGate) : null;
	const answerForThisGate =
		pendingGate && answerState?.key === gateKey
			? { sending: answerState.sending, refused: answerState.refused }
			: null;
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
	/*
	 * The send this pane ADMITTED and the owner has not answered.
	 *
	 * This is the app's own fact, not the owner's, and it is the only signal that
	 * exists for the window the user actually waits through: a cold session
	 * spends ~1.15 s inside the message request spawning its runtime
	 * (`use-warm-session.ts`), and until the first frame lands the transcript
	 * used to paint the user's own bubble and then nothing at all.
	 *
	 * Read from the STORE's draft row rather than from this component's
	 * `admitting`, and LATCHED rather than derived per render, for two reasons
	 * review round 1 measured:
	 *
	 * 1. On the New-chat path the identity flip remounts this panel while the
	 *    row is live - the panel that paints the rung is not the one the send
	 *    started in - so local state does not carry it and the row does.
	 * 2. `finishDraft` DELETES that row when the receipt arrives, and the receipt
	 *    can arrive before the owner's first frame (they land 3-6 ms apart when
	 *    the session is warm). Deriving `starting` from the row alone therefore
	 *    dropped the rung for a frame in that gap, which restarted its clock at
	 *    `0s` under the reader - the exact defect `working-line.tsx` documents as
	 *    impossible. The latch spans the whole wait, from the send until the
	 *    owner paints something.
	 *
	 * A ref, not state, because every transition that matters is already a store
	 * change that re-renders this panel: the row appearing, the row failing, and
	 * content arriving are all store updates, so there is nothing for a
	 * `setState` to schedule. The write is idempotent, which is what makes it
	 * safe under a repeated render.
	 */
	const admittedNow = admittedSendFor(sessionId, draft);
	const admitted = useRef<AdmittedSend | null>(null);
	if (admittedNow) admitted.current = admittedNow;
	/*
	 * What ends the wait, and what deliberately does not.
	 *
	 * CONTENT ends it, measured from this send's echo record rather than from the
	 * tail of the transcript: prose or a tool row is the owner answering, and a
	 * record that paints nothing (a `message_start` placeholder) does not count,
	 * which is the same predicate the transcript itself rows on
	 * (`ownerAnswered`). A FAILURE ends it too: the store records one on the row
	 * when the request throws, and the composer carries the remedy, so the rung
	 * must not keep claiming progress beside it.
	 *
	 * A pending gate and a dead stream only SUSPEND the rung, in
	 * `working-line-model.ts`: the send is still unanswered, so answering the
	 * gate has to bring the rung back rather than start a new wait.
	 *
	 * One corner is recorded rather than hidden: a message the user abandons
	 * while it is unconfirmed may still have landed on the owner, and the app
	 * cannot tell that from a lost one - so the rung stays until the owner paints
	 * something or the store records a failure. That is the app saying it is
	 * still waiting, which is true; it is not a claim that the turn is running.
	 */
	const answered = ownerAnswered(
		canonical.transcript.records,
		admitted.current?.requestId,
	);
	if (admitted.current && (answered || Boolean(draft?.error)))
		admitted.current = null;
	const starting = admitted.current !== null;
	/*
	 * The run-details view model (`docs/run-details.md` § 8), derived once per
	 * wire frame from the two lists the canonical stream already carries and
	 * currently drops on the floor: `frontend.jobs` -> the subagent roster,
	 * `frontend.todos` -> the plan. Derived, never stored: the popover reads this
	 * and `RunDetailsTrigger` keeps only what the reader has already SEEN.
	 *
	 * No `nowMs` is pinned and no clock is taken here, deliberately. The model's
	 * only time-dependent figure is a running child's elapsed label, and a tick
	 * in THIS component would re-render `ChatContent` and the transcript inside
	 * it once a second to move one number. That figure is re-measured where it
	 * is drawn instead - in the panel, at 1Hz, and only while a child is actually
	 * in flight (`run-details-clock.ts`).
	 *
	 * With no canonical frontend there is no model, which is what leaves the
	 * legacy path - `ChatContent`'s header without a canonical session - with no
	 * trigger at all rather than one that opens an empty panel.
	 */
	const runDetails = useMemo(
		() =>
			canonical.frontend
				? deriveRunDetails({
						jobs: canonical.frontend.jobs,
						todos: canonical.frontend.todos,
					})
				: null,
		[canonical.frontend],
	);
	/*
	 * The run panel's MCP half, read here for the reason the model is derived here:
	 * this is the component that owns the session identity and the capabilities, and
	 * the trigger's dot and the panel's section have to answer from ONE list.
	 *
	 * The read's own cadence (15s closed, 5s open, stopping on hidden/unfocused) is
	 * stated in `use-mcp-servers.ts`, which is also where the argument for polling a
	 * CLOSED panel at all is recorded: an expired MCP sign-in changes with no
	 * frontend frame, so a section wired to the canonical stream would show it only
	 * to someone already looking at that section — which is the failure the operator
	 * reported, not the fix.
	 */
	const mcpServers = useRunPanelMcpServers({
		sessionId,
		/*
		 * The accelerator (`§ 7.4`): a string that changes when the canonical
		 * `mcp_servers` projection changes. It is a SIGNAL and never a rendering
		 * source — the projection cannot build this section's row (no `tool_count`, no
		 * `owned_scope`) and can be minutes stale on an idle session — so it only
		 * invalidates the query when the backend PUBLISHES a transition, which is what
		 * makes a startup settle or a reconnect land in about a frame rather than
		 * within the next 15 s tick. `null` means "no canonical frontend", which
		 * disables the read entirely: a legacy chat grows no trigger and therefore no
		 * dot, so a poll there would be pure waste.
		 */
		accelerator: canonical.frontend
			? JSON.stringify(canonical.frontend.mcp_servers ?? null)
			: null,
		/*
		 * And the ONE field of that projection this pane renders: the runtime's own
		 * failure text, which the rendered read does not carry at all (`§ 7.2`; round
		 * 1, U1-8). `mcpErrorTexts` narrows it to the names that carry one, and the
		 * derivation only ever uses it on a row the rendered read calls a problem.
		 */
		errors: mcpErrorTexts(canonical.frontend?.mcp_servers),
	});
	const capabilities = useDesktopCapabilities();
	/*
	 * The child reader is the one part of the panel that needs a route an older
	 * backend does not have (`docs/run-sidebar.md` § 10.2), so it is the part that
	 * negotiates. Everything else in the pane ships with the renderer.
	 */
	const childrenOpenable = desktopFeatureEnabled(
		capabilities.data,
		"subagent_transcript",
	);
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
	/*
	 * ONE declaration for two readers, which is what the merge has to settle rather
	 * than what either side wrote: `main` added this call for the draft-preview
	 * readings below, and this branch added its own for the reader's capability
	 * negotiation above. Both are the same hook on the same component, so the one
	 * declaration higher up serves both — two would be a redeclaration, and biome
	 * reads the earlier USE as a use-before-declaration (the rebase left exactly
	 * that pair here, and `pnpm check-types` reported it as TS2451).
	 */
	/*
	 * The readings a NEW conversation WILL start with, resolved by the backend
	 * without creating anything.
	 *
	 * A draft pane has no session, so the canonical stream has nothing to say and
	 * the strip used to be withheld until the first send. The identity the first
	 * turn will use is real and knowable before then — from the same backend
	 * resolution a session gets, which is the point: composing it here from
	 * `config.get` + the model catalogue would move model resolution into the
	 * renderer and report nothing when the catalogue lacks the pair.
	 *
	 * `enabled` is the whole gate. A draft with no staged directory has nothing to
	 * preview; a backend that does not advertise `draft_preview` gets no strip in a
	 * draft, exactly as it used to (fail-closed, per `desktopFeatureEnabled`); and
	 * once the first send creates the session the stream takes over and this query
	 * switches off, so there is one source for the readings at any moment.
	 *
	 * The payload goes to the STRIP ONLY. It is never written into the canonical
	 * sessions store: that store's rows are sessions, and this is a projection of a
	 * configuration that has no session behind it (`snapshot.session_id` is empty).
	 */
	const preview = useQuery({
		// Keyed on the identity the answer depends on: the directory and the bound
		// profile. A draft re-staged onto another agent is a different question, and a
		// key that ignored the target would answer it with the previous agent's model.
		queryKey: [
			"desktop",
			"session-preview",
			cwd,
			draft?.target?.kind ?? null,
			draft?.target?.name ?? null,
		],
		queryFn: () =>
			desktopResult<{ frontend: CanonicalFrontendSync }>({
				op: "sessions.preview",
				requestId: crypto.randomUUID(),
				cwd,
				...(draft?.target ? { target: draft.target } : {}),
			}),
		// A pure read, and only for a pane that has no session: once the first send
		// creates one, the canonical stream is the only source and this query stops.
		// The empty cwd is refused rather than sent: the contract requires 1..4096
		// characters and a draft whose directory is not settled has nothing to
		// preview ("known and empty" is a legal staged cwd - see the chip's notes).
		enabled:
			!sessionId &&
			cwd.length > 0 &&
			desktopFeatureEnabled(capabilities.data, "draft_preview"),
		// The resolution is config state: it changes when the default model changes,
		// not between two paints of one pane.
		staleTime: 30_000,
		retry: false,
	});
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
		// The live title is the backend's JOURNALLED title, so it is blank for the
		// majority of a real store (see chat-title.ts). Writing it unconditionally
		// blanked the row this click came from until the next 5s list poll, and
		// re-blanked it on every frontend update. `catalogueTitleUpdate` returns a
		// partial row precisely so that "nothing to say" omits the key, which is
		// what leaves the catalogue's own name standing through the spread merge.
		store.upsertSession({
			session_id: sessionId,
			...catalogueTitleUpdate({
				liveTitle: canonical.frontend.conversation_title,
			}),
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
	/**
	 * The composer's ONE error surface.
	 *
	 * Both paths that can fail a send - typed text and a pressed option - report
	 * through this, because they were two hand-copied catches that disagreed: the
	 * typed path read `error.code` and the click path did not, so
	 * `activeErrorCode` (the composer alert's own switch for remedies such as
	 * "Restore it", and for self-clearing the `unresolved_attachment` notice)
	 * could never see a failure that came from pressing an option (code review
	 * round 1, R-MINOR).
	 */
	const reportFailure = (error: unknown, fallback: string) => {
		setSendError(userFacingMessage(error, fallback));
		setSendErrorCode(errorCodeOf(error));
	};
	const send = async (
		content: string,
		attachments: string[],
		/**
		 * Passed to `admitChatDraft` so the composer can clear itself at the moment
		 * the optimistic echo is painted rather than at the moment it submitted.
		 * On the New-chat path nothing clears a live composer - the identity flip
		 * replaces the one holding the text - so read `use-message-input.ts` for what
		 * this callback does and does not do there; the distinction is the whole of
		 * U1/U3.
		 */
		onEchoPainted?: () => void,
		/*
		 * What the user typed, before any staged-reply prefix. Defaults to
		 * `content` for the callers that compose no prefix (the suggestion grid),
		 * so the gate path reads one value whichever door the text came through.
		 */
		typed?: string,
	): Promise<SendOutcome> => {
		const store = useCanonicalSessionsStore.getState();
		// Same identity the view reads, so a send can never address a different
		// draft than the one whose retained text and Discard control are shown.
		const key = draftIdentityFor(draftKey, sessionId);
		if (!key) return false;
		const previous = store.drafts[key];
		/*
		 * The read window's refusal is the STORE's, not this function's: a send
		 * addressed to a session whose guard read has not answered is refused at
		 * admission (`admitChatDraft`), so the rule holds for every caller rather
		 * than for this screen's send button only.
		 *
		 * What this function owns is the ANSWER. The refusal arrives through the
		 * catch below as copy in the composer's own alert row, which is the visible
		 * half it never used to have - the user pressed Enter, nothing was sent, and
		 * nothing said so (UX round 2, U8).
		 *
		 * `false` is the right answer for it because nothing reached the owner, so
		 * the text belongs back in the box; `isRefusedBeforeAdmission` decides that,
		 * and knows this refusal's code. The composer is deliberately NOT disabled:
		 * the panel has already told the user they are in the target, and the two
		 * can only disagree for a round trip.
		 */
		if (previous?.pending) return false;
		if (!sendLock.tryAcquire()) {
			/*
			 * A send attempted while an answer (or another send) is in flight used to
			 * return false with no surface at all: the text stayed in the composer,
			 * nothing was sent, and no error appeared. The UX round measured a user
			 * typing a follow-up during a 9.1s answer, pressing Enter, and getting
			 * absolutely nothing back — indistinguishable from a broken key (UX round
			 * 1, U2).
			 *
			 * Refusing in language costs one sentence and keeps the text where the
			 * user can send it a moment later. The gate wording is specific because
			 * that is the case the user can see a reason for: the question above is
			 * visibly mid-answer.
			 */
			setSendError(
				canonical.frontend?.pending_gate
					? "Waiting for the answer to the question above. Your message was not sent — send it again in a moment."
					: "Still sending your last message. Your message was not sent — send it again in a moment.",
			);
			return false;
		}
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
						// A bare `1`-`9` typed against an options list is a pick, not a
						// literal answer: the card shows those numerals, so typing one is
						// the answer it invites. `answerValue` resolves it against the
						// TYPED text, never `content` — with a staged reply `content` is
						// already wrapped in `<reply-to>`, which is not a bare ordinal, so
						// resolving there sent the model the wrapped numeral as its answer.
						// It lives in `ask-answer.ts` so the decision is assertable in
						// every one of its three states (code review round 2, F1).
						value: answerValue(gate, typed, content),
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
				onEchoPainted,
			);
			if (!id) return false;
			/*
			 * The composer's own attachments, written to the Files panel here because
			 * this is the only place they exist. They are NOT on the wire: a canonical
			 * content block is text or image, so `attachments` never reaches the
			 * transcript and the transcript scan cannot recover them. This is the
			 * direct replacement for the `message.files` writer that the canonical
			 * cutover orphaned.
			 *
			 * Both keys, deliberately. A staged draft is keyed by `draftKey` while the
			 * live session is keyed by the session id it was admitted as, and the
			 * successful send navigates to `/chat/<id>` - writing only the draft key
			 * would orphan every attachment the moment the send succeeded, which is
			 * the exact moment the user looks at the panel. For an already-live session
			 * the two keys are equal and the second write is a dedupe no-op.
			 *
			 * A `data:` attachment is skipped: it is a pasted image, it has no path to
			 * probe or open, and the transcript's own image path already carries it.
			 */
			const sentFiles = attachments
				.filter((attachment) => !attachment.startsWith("data:"))
				.map((attachment) => canvasDocumentForPath(attachment));
			if (sentFiles.length > 0) {
				const canvas = useCanvasStore.getState();
				canvas.addMentionedFilesBatch(identity, sentFiles);
				canvas.addMentionedFilesBatch(id, sentFiles);
			}
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
			reportFailure(error, SEND_UNCONFIRMED_MESSAGE);
			/*
			 * TWO failures, and the composer acts differently on each.
			 *
			 * Refused before admission - 413/422, and every pre-transport refusal
			 * above: nothing reached the owner, so the text belongs back in the box
			 * (`false`).
			 *
			 * Anything else is UNKNOWABLE: the owner may have admitted the command
			 * before the response was lost, which is why the echo is deliberately
			 * left painted in the transcript. Putting the same text back in the box
			 * would then show one message twice, under copy that names only the box
			 * (design round 1's D1) - so the answer is `SEND_HELD`, the box stays
			 * empty, and the retry travels through the store's claim and its own
			 * "Restore unsent message" control. One predicate, exported from the
			 * store, so this cannot drift from the echo's retraction rule.
			 */
			return isRefusedBeforeAdmission(error) ? false : SEND_HELD;
		} finally {
			sendLock.release();
			setAdmitting(false);
		}
	};
	/**
	 * Answer the pending `ask` gate by pressing one of its options.
	 *
	 * This is `send`'s gate branch reached from a click instead of from the
	 * composer, and it deliberately reuses that path's machinery rather than
	 * growing a second one: the same `sendLock` (so a click and a typed send
	 * cannot both post an answer for one question), the same `admitting` flag
	 * (which is what disables the options and the composer together while one is
	 * in flight), and the same error-reporting helper (so a failed answer is
	 * reported with the same authored copy and the same error code as a failed
	 * send, instead of inventing a second error affordance on the card).
	 *
	 * The transport call itself lives in `answerGateOption`, which is where the
	 * one-answer-in-flight property and the request body are asserted - neither
	 * could be reached by a test while they lived inside this component (code
	 * review round 1). What stays here is what needs React: the busy flag, the
	 * card's own hold, and the two places a refusal can land.
	 */
	const answerWithOption = async (label: string) => {
		const gate = canonical.frontend?.pending_gate;
		if (!gate || gate.kind !== "ask" || !canonical.ownerEpoch || !sessionId)
			return;
		// The lock is checked here only to keep the busy flag honest; the claim
		// itself is `answerGateOption`'s, and between this read and that claim
		// there is no `await` for a handler to interleave in.
		if (sendLock.held) return;
		const key = gateKeyOf(gate);
		/*
		 * Whether the press came from the keyboard, so focus can be put back where
		 * a keyboard user left it. See the effect below.
		 */
		const fromKeyboard =
			document.activeElement instanceof HTMLElement &&
			document.activeElement.closest('[aria-label="Answer options"]') !== null;
		/*
		 * The pressed option is `disabled` the moment this press lands, and a
		 * disabled control cannot hold focus: the browser drops it to the document
		 * body, where it then stays for the WHOLE request, because the card is held
		 * mounted with every option disabled until the gate itself moves. Measured
		 * on the rig: `after-press: BODY`, and the body in 12/12 samples of an
		 * in-flight answer, so the keyboard user loses the focus ring everywhere and
		 * the next Tab restarts at the top of the app (UX round 3, U12).
		 *
		 * Handing focus to the composer instead is where the restore below puts it
		 * anyway when the gate CLEARS, and it is the one control this user can act in
		 * while they wait - the composer stays usable through a hold, so this is the
		 * control the draft was headed for. When the gate instead ADVANCES to its
		 * next question, the layout effect below still takes focus to that question's
		 * first option, because it treats a focused empty composer as ours to move
		 * (see `composerHoldsFocusUntouched`): a user who has typed a follow-up, or
		 * simply CLICKED into the box, has taken focus back and keeps it.
		 *
		 * The restore is ARMED here, at the press, and not after the POST settles
		 * where it used to be. The effect that spends this flag fires on the GATE
		 * KEY change, so setting it on the response left two asynchronous paths
		 * racing - whichever landed first decided where focus went, and a
		 * two-question gate moved focus to its next question on three traced runs
		 * out of five and left it in the composer on the other two (UX round 4,
		 * U14). Arming at the press makes the trigger independent of that race. The
		 * effect clears the flag as it spends it, so an answer that is refused or
		 * fails cannot leave a restore armed for a later gate.
		 */
		if (fromKeyboard) {
			restoreFocus.current = true;
			input.current?.focusInput();
		}
		setAdmitting(true);
		setAnswerState({ key, sending: true, refused: null });
		setSendError(null);
		setSendErrorCode(undefined);
		let outcome: AnswerOutcome;
		try {
			outcome = await answerGateOption(
				{
					gate,
					sessionId,
					epoch: canonical.ownerEpoch,
					label,
					lock: sendLock,
				},
				(request) => desktopResult(request),
			);
		} finally {
			setAdmitting(false);
		}
		/*
		 * The gate this press belonged to is still on screen, so the card owns the
		 * outcome: it is where the action was, it is still in view, and holding it
		 * disabled is what stops a second press repeating the same refusal (QA
		 * round 1, Q3). A gate that is gone cannot show anything, so that case falls
		 * through to the composer below.
		 */
		const currentGate = canonical.frontend?.pending_gate;
		const stillThisGate = currentGate != null && gateKeyOf(currentGate) === key;
		const cardOnScreen =
			document.querySelector('[aria-label="Answer options"]') !== null;
		/*
		 * Whether the press could still be the answer the ask took.
		 *
		 * Two halves, because neither alone is the user's situation:
		 *
		 * - **The card this press was made on is still on screen.** This is the
		 *   condition the report is about, and it has to be read from the DOM rather
		 *   than from `pending_gate`: on the wire that field is written by the
		 *   notifier and survives the round trip after the owner has taken an answer
		 *   (which is exactly why the card holds itself with `answerState`), so a
		 *   store-only test says "still pending" while the user is looking at a
		 *   transcript with no card on it. Measured on the committed rig: with the
		 *   store test alone the losing-answer race stayed silent, because the
		 *   `failed` branch wrote its refusal into a card that was no longer
		 *   rendered.
		 * - **The ask is still this ask.** A gate that has advanced to its next
		 *   question carries the same `request_id`, and that is what our own answer to
		 *   question N looks like, so it counts as the press having landed. Only a
		 *   gate that is gone, or one belonging to a different ask, means the press
		 *   lost.
		 */
		const pressStillStands =
			cardOnScreen &&
			currentGate != null &&
			(stillThisGate || currentGate.request_id === gate.request_id);
		if (outcome.status === "refused") {
			// Nothing was sent and nothing is wrong: either the lock was already
			// held by a typed send, or this answer lost a race to another front
			// end. The lock holder reports; this path stays quiet rather than
			// stacking a second message about the same question.
			setAnswerState(null);
			return;
		}
		/*
		 * The card owns the outcome only while the card is still ON SCREEN. Holding
		 * it disabled is what stops a repeat press, and the refusal belongs on the
		 * surface the press was made on — but a card that has already gone cannot
		 * show anything, and writing the refusal into `answerState` for it is how
		 * the losing-answer race lost its sentence: the state was set on a gate the
		 * panel no longer rendered, and nothing said so (QA round 2, F-A).
		 */
		if (outcome.status === "failed" && stillThisGate && cardOnScreen) {
			setAnswerState({
				key,
				sending: false,
				// Outcome first, cause second: the user's press did not take
				// effect, and that is the sentence they need before the reason.
				refused: `Your answer was not sent. ${userFacingMessage(
					outcome.error,
					"The request could not be completed.",
				)}`,
			});
			return;
		}
		/*
		 * Everything still open is an answer this press did not get to make, on a
		 * gate that had already moved: a rejection for a question no longer pending,
		 * or — the case that used to say nothing at all — a 200 for an answer
		 * another front end had already given. The card it referred to is gone, so
		 * the report goes to the composer, in the outcome's language rather than the
		 * backend's (UX round 1, U4; UX round 2, U9; QA round 2, F-A).
		 */
		const lost = lostAnswerMessage(outcome, pressStillStands);
		if (lost) {
			setAnswerState(null);
			setSendError(lost);
			setSendErrorCode(
				outcome.status === "failed" ? errorCodeOf(outcome.error) : undefined,
			);
			return;
		}
		setAnswerState({ key, sending: false, refused: null });
	};
	/*
	 * Put focus back after a keyboard answer.
	 *
	 * The pressed option unmounts when the gate clears, so focus falls to the
	 * document body and the next Tab starts at the top of the app — a user who
	 * wanted to follow their answer with "actually, do it differently" had to
	 * traverse the whole sidebar again (UX round 1, U3). This runs on the gate
	 * KEY rather than on the response, because the card is deliberately held
	 * mounted until the gate itself moves; at that point a gate that advanced to
	 * the next question takes focus, and a gate that cleared hands it back to the
	 * composer.
	 *
	 * A LAYOUT effect, not a passive one. Measured on the rig (UX round 2, U8;
	 * re-measured for this round): the disabled option loses focus at the press,
	 * and a passive effect leaves a window — up to a quarter of a second, and a
	 * whole painted frame — in which the card has gone and `document.activeElement`
	 * is the BODY. That window is what the reviewer sampled. Layout effects run
	 * in the commit that removes the card, before the browser paints, so no frame
	 * ever shows focus on the body.
	 *
	 * Guarded on the body being active so a keyboard user's focus is restored and
	 * nobody else's is moved. The guard passes after the press either way: the
	 * pressed option is `disabled` the moment the press lands, which is what the
	 * browser drops focus to the body for, and the press itself now hands focus to
	 * the composer so the body is not left holding it for the whole request (UX
	 * round 3, U12). Both halves are still `ours` rather than the user's - a
	 * composer the user has TYPED into or CLICKED into is not, which is what keeps
	 * the restore from moving focus off a follow-up they are writing, or off a
	 * caret they placed with a pointer, during the hold (UX round 4, U13).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the gate key is the trigger, not a value read in the body
	useLayoutEffect(() => {
		if (!restoreFocus.current) return;
		restoreFocus.current = false;
		if (
			document.activeElement !== document.body &&
			!composerHoldsFocusUntouched()
		)
			return;
		const next = document.querySelector<HTMLElement>(
			'[aria-label="Answer options"] button:not([disabled])',
		);
		if (next) next.focus();
		else input.current?.focusInput();
	}, [gateKey]);
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
	// The header names the conversation the user clicked, so it falls back to the
	// catalogue row's name for the same reason `loaded` falls back to its binding:
	// `conversation_title` is the journalled title only, and the row's name is
	// derived from the opening message when nothing is journalled. Deliberately a
	// READ — the stand-in is never written back, or the backend's naming errand
	// would be told this conversation already has a name it chose for itself.
	// See chat-title.ts for the TUI precedent both rules follow.
	const title = resolveChatTitle({
		draftKey,
		draftTarget: loadedTarget,
		liveTitle: canonical.frontend?.conversation_title,
		catalogueTitle: boundRow?.title,
	});
	const view = !sessionId
		? { ...canonical, status: "live" as const, error: null }
		: canonical;
	/*
	 * Nothing has named this session's identity yet, and the panel is waiting for
	 * the stream that will.
	 *
	 * Both sources are exhausted above: the live frontend has not arrived, and the
	 * catalogue row names no agent or team (a binding with both fields null is a
	 * legal row). The chain at the `description` prop then falls through to its
	 * last-resort sentence, which is what painted "Canonical chat" in the frame
	 * after the click and "operator" once the snapshot landed - a fallback string
	 * rendered as a fact, in front of the user, for the duration of the wait
	 * (design D3). So the slot is HELD instead: a skeleton is not a claim, and the
	 * identity replaces it the moment any source knows it.
	 *
	 * `connecting` rather than "no frontend": an `unavailable` stream never
	 * arrives, and a header that stays a skeleton forever would be worse than one
	 * that states what it has. `view` and not `canonical`, so this reads the same
	 * status the panel below it renders from.
	 */
	const identityPending = !loaded && !draftKey && view.status === "connecting";
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
	 * The read window, and the notice that explains it.
	 *
	 * `validatingSessionId` is the one round trip after a switch during which the
	 * target's existence is unconfirmed. The STORE owns the window and refuses a
	 * send inside it; these two effects are the stream's half of that contract,
	 * because the store cannot see the stream.
	 *
	 * - `confirmSessionLive` closes the window on a live frame from the session's
	 *   own stream. That is the EARLIER bound: it opens the gate on the first
	 *   proof rather than at the read's own end. The read is bounded too -
	 *   `desktopResult` runs every desktop control under `withDeadline` at
	 *   `DESKTOP_REQUEST_TIMEOUT_MS` (30 s), so a read that never answers ends in
	 *   the rollback rather than in a panel that refuses sends forever - but
	 *   thirty seconds of a panel that refuses every send is not a bound a user
	 *   can use, so the live term is kept for what it adds, not because the
	 *   alternative is unbounded.
	 * - the refused send's notice retires on that same observable condition, the
	 *   way `attachmentResolved` retires its own: a sentence explaining a refusal
	 *   must not outlive the cause it names.
	 */
	useEffect(() => {
		if (!sessionId || canonical.status !== "live") return;
		useCanonicalSessionsStore.getState().confirmSessionLive(sessionId);
	}, [sessionId, canonical.status]);
	const readWindowOpen = useCanonicalSessionsStore((state) =>
		isSessionUnvalidated(state.validatingSessionId, sessionId),
	);
	useEffect(() => {
		if (readWindowOpen || sendErrorCode !== SESSION_UNVALIDATED_CODE) return;
		setSendError(null);
		setSendErrorCode(undefined);
	}, [readWindowOpen, sendErrorCode]);
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
					/*
					 * The read window's refusal carries its own "what to do" half, so the
					 * composer's generic retry hint is withheld for it: the notice lives
					 * exactly as long as the window does, and the window refuses the retry for
					 * that same span, which makes "Send it again" an instruction to do the one
					 * thing that cannot succeed yet (UX round 3, U9). The sentence states the
					 * wait and its end instead.
					 */
					withholdRetryHint: activeErrorCode === SESSION_UNVALIDATED_CODE,
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
							? /*
								 * While a send is ADMITTED the head stops instructing and
								 * names what the send is being started with, which is the
								 * draft's own bound target - the same durable identity the
								 * header falls back to once the conversation is live. The
								 * instruction was true only before the send: it sat over the
								 * wait line telling the user to do the thing they had just
								 * done, which is precisely the "did my send register" doubt
								 * this change exists to remove (design round 2, D4; UX round
								 * 2, U2).
								 *
								 * ONE line either way, so the slot's height does not move at
								 * the instant of the send - the constraint the designer set on
								 * this fix, since a second line that disappears at that moment
								 * is a reflow the reader watches happen.
								 */
								starting
								? (loadedTarget ?? "Starting the session")
								: "The session starts when you send your first message."
							: canonical.frontend?.cwd || "Canonical chat")
					}
					descriptionPending={identityPending}
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
					 * A DRAFT pane has no session, so its readings come from
					 * `sessions.preview` instead — the same backend resolution the
					 * session will get, rendered inert (`draft: true`) because
					 * there is no session for a chip to command: `dispatch` itself
					 * answers "/model needs an open conversation" in that state,
					 * which is a worse way to learn it than a label that says so
					 * (R22). No `onCommand` is passed, and the strip is told which
					 * of the two reasons applies rather than inferring it from the
					 * absence.
					 */
					sessionStatus={
						sessionId
							? {
									frontend: canonical.frontend,
									/*
									 * The chosen-but-unconfirmed model, so the strip can paint the pick
									 * the moment it is made instead of waiting out a cold runtime bind
									 * (latency U1). Straight off the handle, which owns both the paint and
									 * its reconciliation with the authoritative frames.
									 */
									pendingModel: canonical.pendingModel,
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
							: preview.data
								? {
										/*
										 * `snapshot`, because the strip reads the canonical STATE
										 * and the preview answers in the wire shape the stream
										 * publishes (`CanonicalFrontendSync`). No `onCommand`,
										 * and `draft` so the strip knows WHY: a command needs a
										 * session to address, and a missing dispatcher alone
										 * already means a backend with commands off (R22).
										 */
										frontend: preview.data.frontend.snapshot,
										draft: true,
									}
								: undefined
					}
					currentJobId={null}
					onCancelJob={stop}
					messageInputRef={input}
					runDetails={runDetails}
					/*
					 * The composer's first keystroke warms the runtime (main's rule,
					 * `use-warm-session.ts`): this read is threaded from the panel rather
					 * than taken inside the content component, so the branch's new props
					 * sit BESIDE it rather than in its place.
					 */
					onComposerInput={warm}
					mcpServers={mcpServers}
					childrenOpenable={childrenOpenable}
					pulses={canonical.subagentPulses}
					canonical={{
						view,
						busy,
						admitting,
						starting,
						startingAfterId: admitted.current?.requestId ?? null,
						onStop: stop,
						onAnswer: (label: string) => void answerWithOption(label),
						answer: answerForThisGate,
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
	const error = useCanonicalSessionsStore((state) => state.error);
	/*
	 * The navigation failure is read here and not from `error`, which is the
	 * CATALOGUE's health: the catalogue refreshes on its own timer, and
	 * `fetchSessions` clears that field when it starts, so the rollback's own
	 * refetch used to erase the switch's failure sentence 4.5-8.1 ms after the
	 * rollback wrote it. The user's own navigation failing is not the list's
	 * health, and it is the sentence that must survive long enough to read.
	 */
	const navigationError = useCanonicalSessionsStore(
		(state) => state.navigationError,
	);
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
	/*
	 * The keyboard abort for a switch is gone with the pending banner it belonged
	 * to. The switch has no cancellable phase to abort any more: the commit IS the
	 * navigation, it lands in the click's own frame, and the only wait left is the
	 * panel's own hydration. A second click is the latest-wins exit and the store
	 * already implements it; an Escape that silently did nothing while looking
	 * armed is what this removes.
	 */
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
	// Keyed on the SESSION once one exists, so admitting a draft does not unmount
	// the panel mid-send. The rule and its reasoning live in `panelIdentityFor`.
	const identity = panelIdentityFor(draftKey, id);
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
					{/*
					 * ONE sentence, and it is the user's navigation that owns it. The
					 * catalogue's own failure is rendered where the remedy is (the
					 * sidebar's `Retry refresh`, which refreshes the LIST); a switch
					 * that failed has no list to refresh, so it is stated here, above the
					 * panel it failed to open, and holds until the user navigates again.
					 * It is deliberately NOT also painted in the sidebar: the same
					 * sentence in two places under a remedy that fixes neither is what
					 * made a deep link to a deleted chat read as two different failures.
					 */}
					{(routeError || navigationError || error) && (
						<p
							role="alert"
							className={cn("px-4 py-2 text-body-sm text-danger")}
						>
							{routeError || navigationError || error}
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
