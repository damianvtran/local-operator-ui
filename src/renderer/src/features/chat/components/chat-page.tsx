import { backendPaneSentence } from "@shared/api/local-operator/backend-error";
import {
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import { SEND_HELD, type SendOutcome } from "@shared/hooks/use-message-input";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { useWarmSession } from "@shared/hooks/use-warm-session";
import { cn } from "@shared/lib/utils";
import {
	SEND_UNCONFIRMED_MESSAGE,
	SESSION_UNVALIDATED_CODE,
	UNCONFIRMED_SEND_CODE,
	UNREADABLE_ATTACHMENT_CODE,
	admitChatDraft,
	draftIdentityFor,
	isRefusedBeforeAdmission,
	isSessionUnvalidated,
	panelIdentityFor,
	panelSessionIdOfView,
	refusedBeforeAdmissionAttachments,
	refusedBeforeAdmissionText,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { pairingHasRemedy } from "../../../../../shared/backend-status";
import { DESKTOP_MESSAGE_BUDGET_BYTES } from "../../../../../shared/desktop-contract";
import {
	type AnswerOutcome,
	type SendLock,
	answerGateOption,
	answerReport,
	answerValue,
	createSendLock,
	errorCodeOf,
} from "../ask-answer";
import {
	type AdmittedSend,
	admittedSendFor,
	ownerAnswered,
	stoppedAfterAdmission,
	turnStopped,
} from "../canonical/working-line-model";
import { catalogueTitleUpdate, resolveChatTitle } from "../chat-title";
import {
	type DraftResolution,
	type DraftSelectionTarget,
	draftPreviewQuery,
} from "../draft-selection";
import { useInterruptOnEscape } from "../hooks/use-interrupt-on-escape";
import {
	interruptNotice,
	interruptTurn,
	interruptUnavailableNotice,
	sessionInterruptEnabled,
} from "../interrupt-turn";
import {
	MOVE_NOT_READY_REASON,
	MOVE_UNAVAILABLE_REASON,
	sessionMoveEnabled,
	useSessionMove,
} from "../move-session";
import { openConversation } from "../open-conversation";
import { PickerOutlet } from "../pickers/picker-registry";
import { specUnresolved } from "../session-status/session-model";
import { unreadableAttachmentRefusal } from "../utils/attachment-read";
import { type WireImage, boundImagesForBudget } from "../utils/bound-image";
import { canvasDocumentForPath } from "../utils/canvas-document";
import {
	messageBodyBytes,
	messageBudgetRefusal,
} from "../utils/message-budget";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import type { DirectoryWritePath } from "./directory-indicator";
import {
	type MessageInputHandle,
	composerHoldsFocusUntouched,
} from "./message-input";
import {
	deriveRunDetails,
	mcpErrorTexts,
	useMcpRemedy,
	useRunPanelMcpServers,
} from "./run-details";
import { useSlashDispatch } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";

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
	/*
	 * The paths this send identified as images but could NOT read.
	 *
	 * Returned rather than dropped, because a dropped one is a file the user
	 * believes is in the message and is not - and on a draft restored from a
	 * refusal that file is one they already sent once. The send refuses before
	 * admission on a non-empty list (`unreadableAttachmentRefusal`), where the
	 * chip is still removable (code review round 8, MINOR-1).
	 */
	const unreadable: string[] = [];
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
		// Two skips that are NOT this send's failure, so neither is reported here: a
		// path that is not one of the four image types the runtime accepts is left
		// out of the body by design, for every send; and a renderer with no
		// `window.api.readFile` bridge cannot read any file at all, which is a fact
		// about the context rather than about this attachment (`attachment-read.ts`
		// states both limits where the sentence is built).
		if (!mime || !window.api?.readFile) continue;
		const read = await window.api.readFile(
			attachment.replace(FILE_SCHEME, ""),
			"base64",
		);
		if (read.success) images.push({ data_b64: read.data, mime_type: mime });
		else unreadable.push(attachment);
	}
	// Bound per image first, then check the TOTAL and step the whole set down
	// until the message fits. Several individually legal screenshots that do not
	// collectively fit is the common case, and it is not visible to a per-image
	// rule.
	return {
		images: await boundImagesForBudget(
			images.slice(0, 8),
			DESKTOP_MESSAGE_BUDGET_BYTES,
			(candidate) => messageBodyBytes(text, candidate),
		),
		unreadable,
	};
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
	/*
	 * THE PRESSED CARD'S IDENTITY, READ LIVE (code review round 1, m2; design
	 * round 1, D1).
	 *
	 * A press's report has to say whether the card it was made on is still the card
	 * on screen — not whether SOME `Answer options` card is. The value this file
	 * already computes, `gateKey`, cannot answer that from inside the press's own
	 * handler: it is a render closure, and the closure the handler resumes with is
	 * the one the press STARTED in, which is the same value `gate` was read from —
	 * comparing them compares the press with itself. That is exactly the inert
	 * conjunct this branch deleted (`stillThisGate`), and the replacement for it
	 * cannot be another closure. This ref carries the key of the card the app is
	 * actually painting, updated on every render, so the arm can compare the live
	 * card's identity rather than the press's own. It is assigned in the render
	 * body, not in an effect: an effect lags a commit, and the commit that matters
	 * here is the one that REPLACED the card (a multi-question ask advancing, or
	 * another front end settling the question while a press is in flight), which is
	 * precisely the render the press's handler has to see.
	 */
	const liveGateKey = useRef<string | null>(null);
	liveGateKey.current = gateKey;
	const answerForThisGate =
		pendingGate && answerState?.key === gateKey
			? { sending: answerState.sending, refused: answerState.refused }
			: null;
	const lastCatalogueState = useRef("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [sendErrorCode, setSendErrorCode] = useState<string | undefined>();
	/**
	 * What the last interrupt left running, for the composer's own notice.
	 *
	 * Held here rather than in the composer because this is where the request and
	 * its receipt are: `message-input.tsx` renders the sentence and decides
	 * nothing about it, which is the split the send error already uses.
	 */
	const [stopNotice, setStopNotice] = useState<string | null>(null);
	/*
	 * Whether this backend can stop a TURN, as opposed to a session.
	 *
	 * Read once and used for both the control's presence and the Escape
	 * accelerator's predicate, so the key and the button cannot be enabled by two
	 * different readings of the same capability. `useDesktopCapabilities` is
	 * cached by react-query, so this shares the page's one request.
	 */
	const interruptAvailable = sessionInterruptEnabled(panelCapabilities.data);
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
	const outcomeAtAdmission = useRef<{
		requestId: string;
		anchor: string | null;
	} | null>(null);
	if (admittedNow) {
		// Keep the baseline after retirement too: the receipt may lag the
		// completion frame, leaving this same draft pending for another render.
		// Re-snapshotting then would turn the just-finished outcome into "old"
		// history and resurrect the wait we just cleared.
		if (outcomeAtAdmission.current?.requestId !== admittedNow.requestId) {
			outcomeAtAdmission.current = {
				requestId: admittedNow.requestId,
				anchor: canonical.frontend?.attention?.anchor_id ?? null,
			};
		}
		admitted.current = admittedNow;
	}
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
	const stopped =
		turnStopped(canonical.transcript.records, admitted.current?.requestId) ||
		stoppedAfterAdmission(
			canonical.frontend?.attention,
			outcomeAtAdmission.current?.anchor ?? null,
		);
	if (admitted.current && (answered || stopped || Boolean(draft?.error)))
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
						/*
						 * The armed wake schedules ride the same derivation, which is what puts the
						 * composer's wake chip, the pane's Wakes section and the section's tally on
						 * ONE list: the chip is gated on `runDetails.wakes.length` and the section
						 * renders those same rows, so a second read of the wire here would be a
						 * second source of truth for a count the user can see twice on one screen.
						 */
						wakes: canonical.frontend.wakes,
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
	const { servers: mcpServers, grantRunning: mcpGrantRunning } =
		useRunPanelMcpServers({
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
	/*
	 * The panel's MCP remedies, taken HERE for the same reason the list is: this is
	 * the component that owns the session identity, and a press has to write the
	 * operation's result into the one cache entry both the trigger and the section
	 * read. The section receives them as props and stays presentational.
	 */
	const mcpRemedy = useMcpRemedy({ sessionId });
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
	/*
	 * Whether the composer may offer `@` at all, folded from the TWO facts that
	 * decide it and computed HERE because this is where each of them already is:
	 *
	 *   1. the connected harness advertises that it expands a mention
	 *      (`desktop-hooks.ts`'s `references` key). No released harness does — the
	 *      expansion is `local_operator/references.py`, which is not in any tag
	 *      through v0.56.8, and the half that adds it is PR #1220. So the composer
	 *      offers the picker and paints the chips only on a backend that says it can
	 *      carry them, and on today's installs the `@` is plain text, which is what
	 *      the harness does with it.
	 *   2. the send this draft would make is a PROMPT rather than a mid-turn STEER.
	 *      `busy` is the same expression the send path reads one screen down
	 *      (`mode: busy ? "steer" : "prompt"`), and a steer bypasses
	 *      `Session.prompt`, so an `@path` in one is left as inert prose. A chip
	 *      there would assert an expansion the harness will not perform, so the
	 *      affordance is withheld for the length of the turn instead.
	 *
	 * Both halves fail closed, and the fallback is not a lesser feature: the text is
	 * sent as written, which is exactly what the harness would do with it.
	 */
	const mentionsEnabled =
		desktopFeatureEnabled(capabilities.data, "references") && !busy;
	/*
	 * AND WHETHER THE HARNESS ITSELF IS THE REASON, which is a different fact from
	 * `mentionsEnabled`'s false (UX round 2, U12). That flag is false for a turn in
	 * flight over a backend that CAN expand a mention, and the composer's sentence
	 * for this state ("this backend cannot carry file references") would be a lie
	 * there — so only this page, which owns the capability answer, can hand down the
	 * half that names the harness.
	 *
	 * `isSuccess` AND `desktop_available` ARE BOTH LOAD-BEARING, and both are there
	 * to stop a FALSE claim rather than a missing one: `desktopFeatureEnabled` fails
	 * closed, so a capabilities read that is still in flight, errored or answered by
	 * nothing would otherwise be reported to the user as "this backend cannot carry
	 * file references" — a statement about the backend made on the strength of an
	 * answer the app never received. An answer that arrived and says the harness is
	 * available without the key is the only evidence the sentence may rest on, and it
	 * is exactly the state every released install is in today.
	 */
	const mentionsUnsupported =
		capabilities.isSuccess &&
		Boolean(capabilities.data?.desktop_available) &&
		!desktopFeatureEnabled(capabilities.data, "references");
	/*
	 * Moving a LIVE session's directory, which is the one composer control whose
	 * write path is a lifecycle operation rather than a draft field.
	 *
	 * `canMove` is the whole gate and it is deliberately three questions rather
	 * than one: a session must exist (a draft has its own staged-cwd write path),
	 * the pane must not still be a draft (`draftKey` is the store's own answer to
	 * "is this conversation created yet", and during admission the create is in
	 * flight, so a move would race the directory it is creating), and the backend
	 * must advertise the move CONTRACT this renderer implements - `session_move`
	 * at 2 (the exclusivity fence) AND `frontend_replace` (the replacement frame a
	 * move publishes to a viewer that is already mounted). `sessionMoveEnabled` is
	 * that pair, stated once and shared with the hook and the typed `/move` form.
	 *
	 * Against a backend that advertises less, the chip keeps the read-only branch
	 * it has always rendered. That is not merely politeness about a missing route:
	 * the cold half of a move publishes its accepted directory ONLY through the
	 * replacement frame, so a renderer that could not consume it would show the
	 * old directory beside a receipt claiming the move landed.
	 *
	 * `useSessionMove` owns the optimistic value and the per-session latch behind
	 * it; the chip reads `cwd` from here so that the value it PAINTS and the value
	 * the stream reports can never disagree about which is in force (see the
	 * hook's three rules).
	 */
	const canMove =
		Boolean(sessionId) && !draftKey && sessionMoveEnabled(capabilities.data);
	const live = useSessionMove({
		sessionId,
		canonical,
		capabilities: capabilities.data,
	});
	/*
	 * The chip's write path, which is one value because the two kinds answer
	 * differently: a draft STAGES the directory `sessions.create` will use, and a
	 * live session on a capable backend MOVES one, so what the chip may announce or
	 * remember follows the receipt rather than a client-side guess
	 * (`DirectoryWritePath`).
	 */
	const cwdWritePath: DirectoryWritePath | undefined = useMemo(
		() =>
			draftKey && !draft?.sessionId && !admitting
				? { kind: "stage", commit: setCwd }
				: canMove
					? { kind: "move", commit: live.moveTo }
					: undefined,
		// `live.moveTo` is a stable callback (the chip's own callbacks key off this
		// value, so rebuilding it per render would rebuild them per render).
		[draftKey, draft?.sessionId, admitting, canMove, setCwd, live.moveTo],
	);
	/*
	 * And the sentence for the case where there is none, PER CAUSE (agent review
	 * m1).
	 *
	 * `MOVE_UNAVAILABLE_REASON` is about the backend, so it is only true where the
	 * backend is the reason. The second case is a pane whose session is being
	 * created: `draftKey` survives admission by design (the pane is keyed on the
	 * session identity so it does not remount), and for that window a move would
	 * race the very directory `sessions.create` is creating - so the chip is
	 * read-only, but telling its user the backend cannot move a live session, that
	 * they should start a new chat and that updating would help would be three
	 * false statements at once.
	 */
	const cwdReadOnlyReason =
		draftKey && (Boolean(draft?.sessionId) || admitting)
			? MOVE_NOT_READY_REASON
			: canMove
				? undefined
				: MOVE_UNAVAILABLE_REASON;
	const navigate = useNavigate();
	const rebind = (id: string) => {
		/* The `/chat` slash finger on the switch; the rule is in `openConversation`. */
		void openConversation(navigate, id);
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
	 * negotiation above. Both are the same hook on the same component, so the single
	 * declaration BELOW this block serves both — two would be a redeclaration, and
	 * biome reads the earlier USE as a use-before-declaration (the rebase left
	 * exactly that pair here, and `pnpm check-types` reported it as TS2451).
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
	 *
	 * The key and the fetch live in `draft-selection.ts`, because the pickers that
	 * change this selection re-read the SAME entry through the same key: one
	 * question about the pane, answered once, read by the strip and by both
	 * dialogs. `placeholderData: keepPreviousData` (also there) is what keeps the
	 * previous reading on screen while a pick is re-resolved, so the cluster never
	 * unmounts and the composer's row never reflows under the click (R23).
	 *
	 * `draftTarget` carries the pane's MODEL as well as its directory and profile,
	 * which is what makes "the readings for the first turn" mean the CHOSEN model's
	 * once a chip has been used. Omitted when nothing was picked, so the request is
	 * the one this pane always sent.
	 */
	const draftTarget: DraftSelectionTarget = {
		cwd,
		...(draft?.target ? { target: draft.target } : {}),
		model: draft?.model ?? null,
	};
	/*
	 * A pure read, and only for a pane that has no session: once the first send
	 * creates one, the canonical stream is the only source and this query stops.
	 * The empty cwd is refused rather than sent: the contract requires 1..4096
	 * characters and a draft whose directory is not settled has nothing to preview
	 * ("known and empty" is a legal staged cwd - see the chip's notes).
	 */
	const draftPreviewOn =
		!sessionId &&
		cwd.length > 0 &&
		desktopFeatureEnabled(capabilities.data, "draft_preview");
	const preview = useQuery({
		...draftPreviewQuery(draftTarget),
		enabled: draftPreviewOn,
	});
	/*
	 * Where the resolution IS, for the two states in which the pane has no
	 * reading to print (UX U3).
	 *
	 * The strip's readings ARE this query's answer, so "not answered yet" and
	 * "never answered" were both rendered as the third state - a chip offering a
	 * first choice of model. `keepPreviousData` means a resolved answer stays
	 * painted while a pick re-resolves, so this is only ever the FIRST load or a
	 * failure with nothing behind it; `retry: false` on the query is why the
	 * failure needs a control of its own, since nothing else will ask again.
	 */
	const draftResolution: DraftResolution | undefined = draftPreviewOn
		? preview.data
			? undefined
			: preview.isError
				? { status: "failed", retry: () => void preview.refetch() }
				: { status: "pending" }
		: undefined;
	const draftPickable =
		!sessionId &&
		desktopFeatureEnabled(capabilities.data, "draft_selection") &&
		desktopFeatureEnabled(capabilities.data, "commands") &&
		desktopFeatureEnabled(capabilities.data, "catalogues");
	/*
	 * Whether a draft's chips may open their pickers.
	 *
	 * THREE things of the backend, and each is a real dependency rather than a
	 * conservative bundling:
	 *
	 *   - `draft_selection` — the capability itself: `sessions.preview` and
	 *     `sessions.create` accepting a `model`, so a pick can reach the session the
	 *     first send creates. Without it the chips stay inert with today's copy; a
	 *     control that opens a picker whose pick has nowhere to go is the dead
	 *     affordance R20 forbids.
	 *   - `commands` — the same gate a SESSION's chips already carry. The window,
	 *     the ladder and the cost are actionable only where the app's command
	 *     surface is on, and a draft pane must not behave differently from every
	 *     live pane beside it.
	 *   - `catalogues` — the picker's list. `models.catalogue` is where its rows come
	 *     from, and a picker that opens onto an empty list is a dead control wearing
	 *     a live one's clothes.
	 */
	const {
		dispatch,
		dispatchFromControl,
		picker,
		openDraftPicker,
		note: slashNote,
	} = useSlashDispatch({
		sessionId,
		canonical,
		rebind,
		addMessage: (message) => canonical.addNote(message.message ?? ""),
		focusComposer: () => input.current?.focusInput(),
		/*
		 * Where a bare `/move` lands. The destination resolves in the composer's own
		 * chip rather than in a dialog that hosted a copy of it - one control, one
		 * write path, and no popper inside a dialog (design § 5.2, settled by the
		 * measured menu clipping). Both this and `draftPicker` below are options on
		 * ONE dispatcher: the rebase onto `main` kept main's draft-picker hook and
		 * this branch's chip focus rather than choosing between them, because they
		 * answer different commands.
		 */
		focusCwdChip: () => input.current?.openWorkingDirectoryMenu(),
		moveSession: live.moveTo,
		/*
		 * Whether a move can be asked for AT ALL on this pane, which is the chip's own
		 * readiness rather than the backend's (agent review round 2, R-3).
		 *
		 * `canMove` is the chip's whole gate: a session, not a draft, and the
		 * capability pair. The typed `/move <path>` form and the bare form used to
		 * consult only the capability, so in the admission window - `draftKey` still
		 * set while `draft.sessionId` is already populated - the chip was read-only
		 * and said "its working directory can be moved as soon as it is live" while
		 * the typed form posted a move for the same session. One predicate, both
		 * surfaces.
		 */
		moveReady: !draftKey,

		/*
		 * The pane's own selection, handed to the dispatcher only where a pick can
		 * be honoured — and only once the preview has answered, because the
		 * pickers read the selection the pane is showing rather than a second
		 * resolution of their own.
		 */
		draftPicker:
			draftPickable && draftIdentity && preview.data
				? {
						target: draftTarget,
						select: (selection) =>
							useCanonicalSessionsStore
								.getState()
								.setDraftModel(draftIdentity, selection),
					}
				: undefined,
	});
	/*
	 * Whether a command can address a SESSION on this pane — the dispatcher's own
	 * question, stated ONCE beside the value it is asked of (`sessionId`, the only
	 * thing `useSlashDispatch` reads to answer "/x needs an open conversation").
	 *
	 * The composer consumes it because two of the sentences around the `/goal`
	 * arming are about what the NEXT Enter can do, and a second derivation is
	 * already on record: the composer read "does `sessionStatus` exist", which on a
	 * real New-chat pane is true — the page builds it from the preview's own
	 * SNAPSHOT, with `draft: true` — while `conversationId` is the PANE's identity,
	 * so the note promising the goal printed on exactly the pane whose next Enter
	 * is refused (UX U1). One answer, one owner. (The payload is named as "the
	 * preview's snapshot" rather than by its property path on purpose: this file's
	 * structural test asserts that EVERY read of that path is the strip's prop, and
	 * a prose mention inside this comment is a read as far as the scan can tell.)
	 */
	const paneHasSession = Boolean(sessionId);
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
		/*
		 * The composer's seam between `sessions.create` answering and the message
		 * being admitted: the one window in which a credential handed over in a
		 * conversation's FIRST message can still be stored into the session that
		 * send is creating. Threaded straight through to `admitChatDraft`, which
		 * explains why it exists and what its answer means; `undefined` on every
		 * other door through this function.
		 */
		beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
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
			/*
			 * No command check here, deliberately. The composer's planner already
			 * decided what this draft submits — whole-draft command, spliced command,
			 * prose — with the CARET in hand, and it runs every non-`send` verdict
			 * itself (`message-input.tsx:applyPlan`). Asking again, here or anywhere
			 * below, is the second decision this path used to make: a
			 * `SLASH_SUBMISSION` test against the RAW text read the newline in
			 * `/usage\nhello` as the command/argument separator, so line 1 claimed
			 * line 2, the box was emptied on `consumed` and nothing reached the model
			 * (QA round 2, Q4). Prose is prose: it goes to the model.
			 */
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
			const { images, unreadable } = await encodeImageAttachments(
				attachments,
				content,
			);
			/*
			 * An attachment the send could not read, reported before admission for the
			 * same reason as the budget refusal below: the file is not in the message
			 * the user thinks they are sending, and here the composer is still
			 * editable so the chip can be re-attached or removed (round 8, MINOR-1).
			 *
			 * The CODE travels with it and is what the composer's alert reads: this
			 * refusal cannot be answered by resending the same bytes, so the generic
			 * "Send it again" hint must not sit under a sentence whose remedy is
			 * "replace or remove the chip". Leaving the code unset would leave the hint
			 * to whatever `draft.errorCode` the conversation was last holding, which is
			 * how the same sentence was measured both with and without it (design
			 * round 4, D13; the predicate is `withholdsRetryHint`).
			 */
			const unreadableRefusal = unreadableAttachmentRefusal(unreadable);
			if (unreadableRefusal) {
				setSendError(unreadableRefusal);
				setSendErrorCode(UNREADABLE_ATTACHMENT_CODE);
				return false;
			}
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
				beforeAdmission,
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
			 * "Restore message" control. One predicate, exported from the
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
		 * WHERE the report goes, from the press's own outcome plus one fact about the
		 * render — see `answerReport`. Nothing here reads the gate's movement to
		 * decide whether the press WON: a press's own success is what removes its
		 * card, so that reading reported a win as a loss whenever the owner's state
		 * push painted before the answer's response landed, and the two channels have
		 * no ordering between them (`ask-answer.ts` carries the margin).
		 *
		 * `cardIsThisPress` is the live half, and it is TWO facts rather than one: an
		 * `Answer options` card is on screen AND it is the card this press was made
		 * on (`liveGateKey`, the value the app is painting with, against `key`, the
		 * press's own). The identity half is what closes the deterministic hole this
		 * arm used to have: a multi-question ask paints its next question's card in
		 * the same place under the same `aria-label` with a different key, so a query
		 * for "a card" answered true for a card that cannot render this refusal — the
		 * refusal was written to a state no surface reads, and the user was told
		 * nothing while a fresh question appeared where they had pressed. A card that
		 * is not this press's is not a surface this report can use, so the composer
		 * takes it, and the composer is the only surface that survives a gate change.
		 */
		const cardIsThisPress =
			document.querySelector('[aria-label="Answer options"]') !== null &&
			liveGateKey.current === key;
		const report = answerReport(outcome, cardIsThisPress);
		switch (report.to) {
			case "refused":
				// Nothing was sent and nothing is wrong: the lock was already held by a
				// typed send, or this request lost a race inside this window. The lock
				// holder reports, so this path stays quiet rather than stacking a second
				// message about the same question.
				setAnswerState(null);
				return;
			case "sent":
				/*
				 * The owner took this answer, and that is the whole of the report: the
				 * model is already acting on it, so a sentence here would be the bug this
				 * branch exists to remove. The card's hold is settled — it keeps its
				 * options disabled until the gate itself moves, which is what stops a
				 * second press from repeating an answer that already landed.
				 */
				setAnswerState({ key, sending: false, refused: null });
				return;
			case "card":
				// The refusal belongs on the surface the press was made on, where it
				// cannot be missed and cannot be repeated.
				setAnswerState({ key, sending: false, refused: report.refused });
				return;
			case "composer":
				// The card is gone — or is not this press's any more — so the composer
				// carries it: the question-moved-on sentence for the answer route's own
				// codeless refusal, the not-sent sentence for a transport failure, in
				// both cases in the outcome's language rather than the backend's (UX
				// round 1, U4; UX round 2, U9). The code is always the report's own, so
				// the alert's hint and remedies are functions of THIS failure rather
				// than of the draft's last one (design round 1, D2).
				setAnswerState(null);
				setSendError(report.message);
				setSendErrorCode(report.code);
				return;
		}
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
	/*
	 * `useCallback` rather than a fresh closure per render (reviewer round 1, NIT
	 * 2): this identity is an effect DEPENDENCY of the Escape hook, and the panel
	 * re-renders on every streaming delta - so an unstable `stop` unsubscribed and
	 * re-subscribed the window keydown listener several times a second for no
	 * reason. Both orders were measured safe, which is why this is churn rather
	 * than a defect: the predicate is unchanged, and the setter pair is stable.
	 */
	const stop = useCallback(() => {
		if (!sessionId || !interruptAvailable) return;
		/*
		 * A NEW press retires the previous notice before it can be overtaken by a
		 * new receipt: the sentence is a snapshot of one interrupt, and the second
		 * press's own outcome is the only current one.
		 */
		setStopNotice(null);
		void interruptTurn(sessionId, crypto.randomUUID())
			.then((receipt) => setStopNotice(interruptNotice(receipt)))
			.catch((error) =>
				// Renders in the same composer alert as a failed send, so it takes the
				// same authored-copy rule. A receipt that never arrives is the one case
				// this control cannot report as a stop, so it does not: the turn is
				// still on screen and `busy` is still true, which is the honest state.
				setSendError(userFacingMessage(error, "Stop could not be confirmed.")),
			);
	}, [sessionId, interruptAvailable]);
	/*
	 * The notice describes the LAST interrupt, so a turn that starts afterwards
	 * retires it: the sentence says a turn was stopped, and the next turn is not
	 * that turn. Cleared on `busy` becoming true rather than on a send, because a
	 * turn can also be started by an approval or a resume. While the interrupt is
	 * still settling `busy` is still true and this correctly does nothing.
	 */
	useEffect(() => {
		if (busy) setStopNotice(null);
	}, [busy]);
	/*
	 * Escape is the control's accelerator, attached HERE because this component
	 * owns both halves the predicate reads - `busy` and `stop` - and the ladder it
	 * defers to is documented in the hook.
	 */
	useInterruptOnEscape({
		sessionId,
		busy,
		available: interruptAvailable,
		onInterrupt: stop,
	});
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
	 *   `desktopResult` runs every desktop control under `withDeadline` at the
	 *   op's own derived deadline (`desktopRequestTimeoutMs` - 25 s for a
	 *   control, 95 s for a ledger read), so a read that never answers ends in
	 *   the rollback rather than in a panel that refuses sends forever - but a
	 *   whole budget of a panel that refuses every send is not a bound a user
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
	// to the op's derived request deadline). Without this the notice and its abandon control
	// were live over a send whose outcome was still unknown, and abandoning there
	// deleted the row that the settling request then patched - reintroducing the
	// invisible-claim dead end one layer down. A request that may be executing is
	// not something to offer an escape from; the escapes appear once it settles.
	const heldText =
		draft?.admissionAttempted && !draft.pending
			? draft.submittedText
			: undefined;
	/*
	 * The text a PRE-ADMISSION refusal owes the box.
	 *
	 * Its own field rather than `heldText`, because the two are opposite answers
	 * to opposite facts: `heldText` means the message may already be on the owner
	 * and the box must stay empty, this one means it provably never left the
	 * renderer and belongs back in the box. The composer puts this one back
	 * (`refusedBeforeAdmissionText` carries the why); what matters here is that the
	 * page cannot supply it from local state, because the refusal outlives the
	 * composer that sent it - on the created-session arm the panel is remounted
	 * under the id that very send minted, and the row is the only surviving copy
	 * (UX round 3 U14, QA round 3 Q7).
	 */
	const refusedText = refusedBeforeAdmissionText(draft);
	/*
	 * The other half of the same payload, carried the same way and for the same
	 * reason: the composer's chips live under the identity the send was made from,
	 * so the composer that mounts after the flip cannot reconstruct the file list
	 * the refused send was carrying. Restoring the text without it is a send that
	 * silently drops the user's file, and the row that recorded it is retired by
	 * the very resend that lost it (round 7, R17).
	 */
	const refusedAttachments = refusedBeforeAdmissionAttachments(draft);
	const releaseHeld = () => {
		if (draftIdentity)
			useCanonicalSessionsStore.getState().releaseClaim(draftIdentity);
		clearError();
	};
	const composerSendError =
		activeError || heldText !== undefined || refusedText !== undefined
			? {
					message: activeError ?? undefined,
					// The "what to do" half of the error contract travels with the
					// message. An unresolved attachment needs a profile chosen; an
					// unreachable registry needs the agents page. Any other code has no
					// specific remedy, so it offers none rather than a generic button.
					/*
					 * The CODE, not a pre-computed answer drawn from it.
					 *
					 * Two questions on this screen are answered by the store's own
					 * predicates and must not be answered twice: whether the composer's
					 * generic retry hint is true (`withholdsRetryHint` - the read window
					 * refuses the retry for exactly as long as its notice is on screen,
					 * UX round 3, U9; the leading-slash policy refuses this text forever,
					 * UX round 2, U13), and whether the held line may say the outcome is
					 * unknowable (`isStoreWriteRefusal` - a store that could not write
					 * KNOWS nothing was saved, and telling the operator to wait for a
					 * reply that cannot come contradicts the sentence above it, UX round
					 * 1, U4). Passing the code lets the composer ask both, in the one
					 * place that renders them; passing a boolean would put the second
					 * question's answer here as well, which is how two readers of one
					 * fact come to disagree about it.
					 */
					code: activeErrorCode,
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
											onClick: () => void dispatch({ name: "agent", args: "" }),
										},
										{
											label: "Choose team",
											onClick: () => void dispatch({ name: "team", args: "" }),
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
					/*
					 * The payload a PRE-ADMISSION refusal owes the box, on the same grounds as
					 * `heldText` above: the composer cannot reconstruct text it never kept, and
					 * on the created-session arm it is not even the same composer any more.
					 * The box rule that consumes it (`restoreSubmittedText`) only writes an
					 * EMPTY box, so the user's own typing still wins.
					 *
					 * Carried independently of `message`, which is why the payload also exists
					 * when `refusedText` is the only term: dismissing the alert clears the copy
					 * and the code, and a dismissal must not be what makes a two-line message
					 * unreachable again - the record ends when the draft does.
					 */
					refusedText,
					/*
					 * The files that go back with it. Same terms as `refusedText` above - the
					 * composer's own chip row is per-identity and was staged under the identity
					 * the flip replaced - and on the same refusal row, so the two arrive and are
					 * dropped together.
					 */
					refusedAttachments,
					/*
					 * The held payload's other half, on the same terms as `heldText` above and
					 * from the same row: the unchanged-payload guard compares text AND files
					 * AND images, so the composer's "the held message is back in the box" test
					 * needs the files as well as the text. Without them it said a box holding
					 * the text but one chip fewer was the held payload, and rendered
					 * "Send it again" over the guard that then refused every press (UX round
					 * 1, U2). The store records both in one update at admission, so the two
					 * travel together here too rather than one being inferable from the other.
					 */
					heldAttachments:
						heldText !== undefined ? draft?.submittedAttachments : undefined,
					/*
					 * The CLAIM's own verdict, from the row, and the reason the held line no
					 * longer reads `code` above.
					 *
					 * `code` is about the last ATTEMPT. The flow this PR exists for is
					 * refusal -> `Restore message` -> drop the file -> Enter, and the last
					 * attempt there is refused by the unchanged-payload GUARD, whose code is
					 * `unconfirmed_send`. A held line selected by that code reverted to
					 * "whether it reached the agent is not knowable ... send again only if no
					 * reply arrives" one screen after this app said "Nothing was saved",
					 * with the disk off the screen (UX round 2, U10). The guard throws before
					 * the row is written, so the store's verdict is still on the row - it was
					 * simply never recorded against the CLAIM, and `errorCode` is not it:
					 * `onDismiss` clears that one the moment the operator acknowledges the
					 * sentence, while the payload it describes is still held. `heldClaimCode`
					 * travels with the payload for exactly that reason.
					 *
					 * Gated on `heldText` like the fields above it: without a claim there is no
					 * verdict to state, and a stale one would describe a payload the composer
					 * is not holding.
					 */
					heldClaimCode:
						heldText !== undefined ? draft?.heldClaimCode : undefined,
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
								void dispatch({ name: command, args: "" });
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
								 *
								 * A THIRD state on the same slot: the send created its session
								 * and the refusal then stopped it before admission, so a session
								 * exists while nothing has been admitted into it. The instruction
								 * is false there, and visibly so - the composer's own footer on
								 * that very screen says the working directory is fixed BECAUSE
								 * the session has started, one line below a header announcing
								 * that it has not (UX round 4, U16), and the roster already
								 * lists the session. So the head describes the conversation that
								 * now exists, by its directory: the identity this header already
								 * falls back to for a live chat, and the one the TUI names a
								 * session by before it has a name (`cwd_label` - the terminal
								 * never asserts that a session has not started, because there one
								 * always has). The directory is also the exact thing the footer
								 * declares immutable, so the two lines now state one fact.
								 */
								starting
								? (loadedTarget ?? "Starting the session")
								: draft?.sessionId
									? canonical.frontend?.cwd || cwd || "Canonical chat"
									: "The session starts when you send your first message."
							: /*
								 * LIVE: the value the chip paints, not `canonical.frontend?.cwd`.
								 *
								 * The header is the second surface a user reads to answer "where am I",
								 * and while a move is in flight it is the chip that holds the pending
								 * value; reading the canonical stream here made the two disagree for the
								 * whole restart - the header on the old directory while the receipt in the
								 * transcript said the session had moved (UX review U3). `live.cwd` is
								 * `pending ?? stream`, so the two surfaces cannot disagree by construction.
								 */
								live.cwd || "Canonical chat")
					}
					descriptionPending={identityPending}
					onOpenOptions={() => setOptions((value) => !value)}
					isOptionsSidebarOpen={false}
					onCloseOptions={() => setOptions(false)}
					agentId={identity}
					turnTerminal={canonical.turnsCompleted}
					/*
					 * Draft: the store's staged cwd, which `admitChatDraft` passes to
					 * `sessions.create`. Live: the directory the session actually runs in,
					 * reported by the canonical stream - or, while a move is in flight, the
					 * value that move is settling on (`live.cwd` reads
					 * `pending ?? canonical.frontend?.cwd`).
					 *
					 * `cwdWritePath` is supplied in two cases, and the second one is the
					 * point of the capability gate: a draft stages a directory, and a live
					 * session on a backend that advertises `session_move` moves one. Every
					 * other combination leaves the chip read-only with a reason, which is
					 * what keeps a backend without the route inert rather than broken.
					 *
					 * `main` grew a draft-only `onChangeCwd` prop in parallel with this
					 * branch's single `cwdWritePath` value; the rebase keeps ONE, and it is
					 * this one, because it covers the draft case through its `stage` kind
					 * (the same `setCwd` write) and the live case through `move`. Two props
					 * for one write path is the defect the rebase would otherwise ship.
					 */
					/*
					 * `live.cwd` rather than `canonical.frontend?.cwd`: it IS the stream's
					 * directory with this session's in-flight move on top of it
					 * (`pending.target ?? pending.path ?? streamCwd`), which is the whole
					 * point of the chip - a value the backend has not confirmed yet has to
					 * be paintable, or the user watches a move they made not happen. The
					 * rebase onto `main` kept main's `sessionId` prop beside it; both are
					 * wanted and neither subsumes the other.
					 */
					cwd={draftKey ? cwd : live.cwd}
					cwdWritePath={cwdWritePath}
					cwdReadOnlyReason={cwdReadOnlyReason}
					/*
					 * The session the code-memory panel reads, passed as the identity the
					 * backend knows. It is NOT the same as `agentId` above, which is
					 * `identity` - a canvas-store key that is the draft key until the
					 * session exists - and the two must not be swapped: asking about code
					 * memory by draft key or by agent id is the bug this fixes.
					 */
					sessionId={sessionId}
					cwdPending={canMove && live.busy}
					/*
					 * Whether the backend has ACCEPTED the move in flight, so the chip's second
					 * pending sentence is the receipt's arrival rather than a clock (UX review
					 * round 2, U3). `live.accepted` is written only by `pendingAfterReceipt`.
					 */
					cwdPendingAccepted={canMove && live.accepted}
					messages={[]}
					isLoading={false}
					isLoadingMessages={false}
					isFarFromBottom={isFarFromBottom}
					messagesContainerRef={container}
					scrollToBottom={scrollToBottom}
					rawInfoContent={JSON.stringify(canonical.frontend, null, 2)}
					onSendMessage={send}
					/*
					 * The SAME dispatcher the chips use, handed the planner's own answer (an
					 * invocation, never the draft) with its outcome handed back: the composer
					 * must know whether the command ran before deciding what the box holds
					 * afterwards, and a failure must report through this path's own note
					 * rather than a second copy of its sentence (round 2, Q-7's contract).
					 */
					onSlashCommand={dispatchFromControl}
					onSlashNote={slashNote}
					/*
					 * The pane's answer to the dispatcher's own question, handed to the
					 * composer so its arming copy and the popup's cannot promise a run this
					 * pane will refuse (UX U1 / design D3).
					 */
					paneHasSession={paneHasSession}
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
									onCommand: (invocation: SlashCommandInvocation) =>
										void dispatchFromControl(invocation),
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
										 *
										 * The DRAFT opener is passed only where a pick can be
										 * honoured (`draftPickable`), which is what leaves the two
										 * readings inert with today's copy on a backend that cannot
										 * birth a conversation on a choice.
										 */
										frontend: preview.data.snapshot,
										draft: true,
										onOpenDraftPicker: draftPickable
											? openDraftPicker
											: undefined,
									}
								: draftResolution
									? {
											/*
											 * No snapshot, and a state worth saying: the pane renders the pending
											 * treatment, or the failure with its retry, instead of the absent
											 * cluster it used to render for both (UX U3). `frontend` is null
											 * rather than a blank snapshot: the strip asks for the readings
											 * it can still answer and claims none of the others.
											 */
											frontend: null,
											draft: true,
											draftResolution,
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
					mcpGrantRunning={mcpGrantRunning}
					mcpRemedy={mcpRemedy}
					childrenOpenable={childrenOpenable}
					mentionsEnabled={mentionsEnabled}
					mentionsUnsupported={mentionsUnsupported}
					pulses={canonical.subagentPulses}
					canonical={{
						view,
						busy,
						admitting,
						starting,
						startingAfterId: admitted.current?.requestId ?? null,
						onStop: stop,
						stopAvailable: interruptAvailable,
						/*
						 * The band carries ONE sentence, and which one is a fact about
						 * this build's pairing: a press that happened
						 * (`interruptNotice(receipt)`), or a turn that cannot be pressed
						 * at all because the paired backend predates the control
						 * (`interruptUnavailableNotice(busy, interruptAvailable)` - UX
						 * round 1's U4). They cannot both apply: no press is possible
						 * without the capability, so there is never a receipt to report
						 * beside a skew line.
						 */
						stopNotice:
							stopNotice ??
							interruptUnavailableNotice(busy, interruptAvailable),
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
	/*
	 * THE CAUSE, not only the boolean (design § 4).
	 *
	 * This pane used to render "Update the backend to use canonical chats" for
	 * every closed gate, including the one where this app holds no credential for a
	 * perfectly current server - the operator's own screenshot, where the pane told
	 * them their server was old while the sidebar called the server unreachable and
	 * the banner asked them to restart (design § 0(b)). The tri-state says WHICH
	 * condition closed the gate; the pairing sentence for that cause is the same one
	 * the banner renders, because it is the same fact.
	 */
	const catalogueState = desktopFeatureState(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const enabled = catalogueState === "enabled";
	const { data: serverHealth } = useServerHealth();
	const pairingCause =
		serverHealth?.snapshot && !serverHealth.snapshot.pairing.available
			? (serverHealth.snapshot.pairing.cause ?? "unpaired")
			: null;
	const pairingSentence = backendPaneSentence(catalogueState, pairingCause);
	/*
	 * NO CONTROL WHERE NO REMEDY EXISTS, asked of the ONE predicate that answers it
	 * (design round 3): this used to spell the two causes out again, which is a
	 * second copy of a rule that has three other readers, and a copy is how the
	 * pane and the band come to disagree about a cause one of them learns later.
	 */
	const offerRetry = pairingHasRemedy(pairingCause);
	/**
	 * The pane's one retry: the RECONNECT verb when this is a pairing state.
	 *
	 * `capabilities.refetch()` cannot change a pairing - the route is public and
	 * answers identically before and after - so the control was inert in exactly the
	 * states that offered it. Main's reconnect verb is the claim path, and for every
	 * other state (a failed query, a version gap) the refetch is still the right act
	 * and stays beside it (design § 2).
	 */
	const paneRetry = useCallback(async () => {
		if (catalogueState === "unpaired") await window.api?.backend?.reconnect?.();
		await capabilities.refetch();
	}, [catalogueState, capabilities]);
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
	 * A staged draft is a navigation, and the banner the user's LAST navigation
	 * raised has no business surviving it — `stage()` and `select()` below clear
	 * it by hand for their own paths. The New chat shortcut is a third way to
	 * move, bound in the shell (`app.tsx`) because it has to work on every route,
	 * so it cannot reach this component's state: the draft key is what tells this
	 * component the user has moved on. Keyed on the DRAFT rather than on the
	 * route, because `/chat` and `/chat/:agentId` hold one mounted component and
	 * a state blob left over from the previous route is precisely what made a
	 * deep link to a deleted chat read as two different failures.
	 *
	 * ONLY A CHANGE CLEARS IT, and the ref is what makes that true. The store
	 * persists `activeDraftKey`, so on a cold start this effect can see a draft on
	 * its FIRST pass — and the legacy-link effect above runs before it in the same
	 * commit, so clearing there would erase the sentence that effect had just
	 * written for a deep link this machine no longer has. A mount is not a
	 * navigation; a key that moved is.
	 */
	const settledDraftKey = useRef(draftKey);
	useEffect(() => {
		if (settledDraftKey.current === draftKey) return;
		settledDraftKey.current = draftKey;
		if (!draftKey) return;
		setRouteError(null);
	}, [draftKey]);
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
		/*
		 * The sidebar's finger on the switch. The rule - why the URL is written with
		 * the commit rather than behind the guard read, and why all three entrances
		 * share it - is in `openConversation`; all this one owns is its own screen
		 * state (the navigation sentence belongs to the route the user is leaving).
		 */
		setRouteError(null);
		void openConversation(navigate, id);
	};
	// Keyed on the SESSION once one exists, so admitting a draft does not unmount
	// the panel mid-send. The rule and its reasoning live in `panelIdentityFor`;
	// `panelSessionIdOfView` is the id this pane reads, extracted so a surface
	// that is NOT this pane - the command palette's close-time restore, which
	// yields when a pick moved the view - can ask for the same key without keeping
	// a second copy of the expression that computes it.
	const id = panelSessionIdOfView(draftKey, draft?.sessionId, active);
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
						/*
						 * A PANE-level state, presented as one: centred in the column, the shape the
						 * route's own Suspense fallback already uses, and - the reason it is not a
						 * bare `p-6` against the top edge - clear of the full-bleed bands.
						 *
						 * Both bands are `fixed` at the top of the window, so while one shows it
						 * covers the first ~30px of EVERY surface. Measured on the withdrawn frame
						 * (`docs/evidence/daemon-attach-live-app/after-gate-withdrawn.png`), this
						 * sentence's line box was laid out at y=24 with the pane empty below it, so
						 * the pane read as a single flat colour beside a sidebar that kept its
						 * rows: the node existed, was 880x70 and `checkVisibility()` was true, and
						 * the reader could not see it. Centring it in the pane also stops the
						 * sentence from being the pane's first 30 pixels, whatever the band does
						 * (design round 1, D2).
						 */
						<div
							className={cn(
								"flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6",
								"text-body text-ink-muted",
							)}
						>
							<p className={cn("text-center")}>
								{capabilities.isLoading
									? "Connecting to the backend…"
									: capabilities.error
										? userFacingMessage(
												capabilities.error,
												"The Local Operator server did not answer as expected.",
											)
										: (pairingSentence ??
											"Update the backend to use canonical chats. Your existing histories are unchanged.")}
							</p>
							{offerRetry && (
								<button
									type="button"
									className={cn("underline")}
									onClick={() => void paneRetry()}
								>
									Retry
								</button>
							)}
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
