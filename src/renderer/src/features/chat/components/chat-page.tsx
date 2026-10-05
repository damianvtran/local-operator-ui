import {
	backendPaneSentence,
	compatibilityBannerShown,
} from "@shared/api/local-operator/backend-error";
import {
	UserFacingError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import {
	type MessageInputHandle,
	composerHoldsFocusUntouched,
} from "@shared/components/composer/message-input";
import {
	hasPendingSend,
	pendingSendForView,
	retainsPendingSend,
	retractLocalEcho,
	useCanonicalSessionStream,
} from "@shared/hooks/use-canonical-session";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import type { SendOutcome } from "@shared/hooks/use-message-input";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { isDictationActive } from "@shared/hooks/use-speech-to-text-manager";
import { useStableCallback } from "@shared/hooks/use-stable-callback";
import {
	useDraftWarmSession,
	useWarmSession,
} from "@shared/hooks/use-warm-session";
import { cn } from "@shared/lib/utils";
import { useAsideStore } from "@shared/store/aside-store";
import {
	ANSWER_NOT_SENT_CODE,
	ASIDE_NOT_ANSWERED_CODE,
	ASIDE_STILL_ANSWERING_CODE,
	SEND_FAILURE_COPY,
	SESSION_UNVALIDATED_CODE,
	SESSION_UNVALIDATED_MESSAGE,
	UNREADABLE_ATTACHMENT_CODE,
	admitChatDraft,
	isSessionUnvalidated,
	migrateHeldClaim,
	paneDraftKey,
	panelIdentityFor,
	panelSessionIdOfView,
	pressLockCopy,
	resynthesisePendingSend,
	sendFailureCopy,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showSuccessToast } from "@shared/utils/toast-manager";
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
import { DESKTOP_REFUSAL_CODE } from "../../../../../shared/desktop-contract";
import {
	asideAskBlockedReason,
	askAside,
	reportUncarriedAsideRefusal,
} from "../aside";
import {
	type AnswerOutcome,
	SECRET_ANSWER_DOCKED_MESSAGE,
	type SendLock,
	answerGateOption,
	answerGateSecret,
	answerQueuedAsk,
	answerReport,
	answerValue,
	approvalAnswerValue,
	createSendLock,
	declineQueuedAsk,
	gateIsSecret,
	reviseQueuedAsk,
} from "../ask-answer";
import {
	ASK_COMPOSER_PLACEHOLDER,
	type AskDraft,
	type AskOutcome,
	EMPTY_DRAFT,
	askAnswerMap,
	askClaimsEscape,
	askComposerAnswers,
	askQueueView,
	askRefusalIsOwner,
	askRefusalSentence,
	effectiveGate,
} from "../ask-queue";
import {
	ownerAnswered,
	stoppedAfterAdmission,
	turnStopped,
} from "../canonical/working-line-model";
import { useStripSpeaksConnection } from "../chat-status-presence";
import { catalogueTitleUpdate, resolveChatTitle } from "../chat-title";
import {
	caughtFailureNotice,
	composerNoticeFor,
	lockAnswerOutlived,
	retryOfferedForFailureCode,
} from "../composer-notice";
import { ChatDeviceHold } from "../device/chat-device-hold";
import { ChatDeviceNotice } from "../device/chat-device-notice";
import { ChatDeviceSlot } from "../device/chat-device-slot";
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
import { effortQueryModel } from "../session-status/session-model";
import type { Message } from "../types/message";
import { encodeImageAttachments } from "../utils/attachment-encode";
import {
	imageOverflowRefusal,
	unreadableAttachmentRefusal,
} from "../utils/attachment-read";
import { canvasDocumentForPath } from "../utils/canvas-document";
import { messageBudgetRefusal } from "../utils/message-budget";
import { ChatContent } from "./chat-content";
import type { HeaderIdentityData } from "./chat-header-identity";
import { headerIdentityControlsShown } from "./chat-header-identity-model";
import type { DirectoryWritePath } from "./directory-indicator";
import {
	deriveRunDetails,
	mcpErrorTexts,
	useMcpRemedy,
	useMonitorControls,
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

/** Each displayed identity owns its stream and composer. A candidate open is
 * prepared by the store first; changing rows never stops the outgoing runtime. */
/** The header's second line when nothing true can fill it; see the live arm. */
const HELD_DESCRIPTION_LINE = "\u00a0";

/** How a send held for the validation window ends; see `send`. */
type WindowOutcome = "ready" | "failed" | "gone" | "abandoned";

/**
 * Whether the chat view is still showing `sessionId` - the id this pane would be
 * handed if it were mounted now. Read through `panelSessionIdOfView`, the one
 * expression the pane's own key is computed from, so a held send and the pane
 * cannot disagree about which conversation the user is in.
 */
function viewIsOnThisSession(
	state: ReturnType<typeof useCanonicalSessionsStore.getState>,
	sessionId: string | undefined,
): boolean {
	const draft = state.activeDraftKey
		? state.drafts[state.activeDraftKey]
		: undefined;
	return (
		Boolean(sessionId) &&
		panelSessionIdOfView(
			state.activeDraftKey,
			draft?.sessionId,
			state.activeSessionId,
		) === sessionId
	);
}

function SessionPanel({
	identity,
	draftKey,
	sessionId,
}: {
	identity: string;
	draftKey: string | null;
	sessionId?: string;
}) {
	const draftIdentity = useCanonicalSessionsStore((state) =>
		paneDraftKey(draftKey, sessionId, state.drafts),
	);
	const draft = useCanonicalSessionsStore((state) =>
		draftIdentity ? state.drafts[draftIdentity] : undefined,
	);
	/*
	 * The id this pane's STREAM addresses: the session once it exists, the
	 * minted draft before that (`sessions.draft`'s id — a real bridge on the
	 * backend through the draft allow-list), and nothing at all for a fresh
	 * pane nobody has typed into. What the id is FOR is the same either way:
	 * the subscription is the bridge user that keeps a speculative warm alive
	 * across the wait, and it is the precondition the draft's warm checks before
	 * it fires (`useDraftWarmSession`). The identity that KEYS the panel stays
	 * `draftKey` until the create hop (`panelIdentityFor`): this changes which
	 * id the stream carries, never when the panel remounts.
	 */
	const streamId = sessionId ?? draft?.warmId;
	/*
	 * The third answer is the one only this pane can give: whether `streamId`
	 * names a session a page can be owed for, or a DRAFT's bridge subscription
	 * (`useCanonicalSessionStream`'s own note carries why the hook cannot tell
	 * them apart). A draft's stream is a bridge, not a page (UX round 1, U1).
	 */
	const canonical = useCanonicalSessionStream(
		streamId,
		Boolean(streamId),
		Boolean(sessionId),
		/*
		 * The identity the pane SHOWS, which is not `streamId`: a fresh draft's
		 * stream carries the minted warm (or nothing at all), while the row a press
		 * paints - and the registration the press needs - are addressed by
		 * `panelIdentityFor(draftKey, id)`. The hook's own parameter doc carries the
		 * rule; the value is the one this panel already computed for its key.
		 */
		identity,
	);
	useDesktopWatchLease(streamId, canonical.subscriptionId);
	// Read here rather than threaded from the page: the query is cached with a
	// 60 s staleTime, so this is a store read and not a second request.
	const panelCapabilities = useDesktopCapabilities();
	// Fired from the composer's first keystroke, never from this mount - see
	// `useWarmSession` for why browsing must not spawn runtimes.
	const warm = useWarmSession(sessionId, panelCapabilities.data);
	/*
	 * Publish the draft-warm capability the way the sidebar publishes
	 * `cataloguePageable`: the store refuses to mint on its own (it must not
	 * import this module's capability hook, see `setDraftWarmable`), so the
	 * mounted pane — which already resolves the capability — states the answer
	 * before the first keystroke can need it. Fail-closed by construction: an
	 * unanswered query leaves the flag false, which is exactly today's wiring
	 * against every daemon that predates the key.
	 */
	useEffect(() => {
		useCanonicalSessionsStore
			.getState()
			.setDraftWarmable(
				desktopFeatureEnabled(panelCapabilities.data, "session_draft_warm"),
			);
	}, [panelCapabilities.data]);
	/*
	 * The draft's warm, once its own subscription holds the bridge: the same
	 * policy `warm` applies to a session, addressed at the minted draft id.
	 * Nothing fires before the mint landed (there is no id), and nothing fires
	 * before the stream opened (`subscriptionId`) — see the hook for why an
	 * earlier warm would be cancelled without engaging anything.
	 */
	useDraftWarmSession(
		draft?.warmId,
		canonical.subscriptionId,
		panelCapabilities.data,
	);
	/*
	 * The composer's empty-to-non-empty edge, which is the app's one statement
	 * of intent to send: a session warms itself (`warm`), a draft MINTS the id
	 * its runtime will be warmed on (`ensureDraftWarm` — the warm itself fires
	 * from the hook above once the subscription is open). Both are
	 * fire-and-forget, both no-op where they cannot act, and nothing on the
	 * send path awaits either: this edge costs the keystroke nothing.
	 */
	const onComposerInput = useCallback(() => {
		if (sessionId) {
			warm();
			return;
		}
		if (draftKey)
			useCanonicalSessionsStore.getState().ensureDraftWarm(draftKey);
	}, [sessionId, warm, draftKey]);
	const input = useRef<MessageInputHandle>(null);
	const container = useRef<HTMLDivElement>(null);
	const cwd = useCanonicalSessionsStore((state) => state.cwd);
	// Read here rather than threaded from the page, for the same reason as
	// `panelCapabilities` above: the query is cached (`useServerHealth`'s staleTime),
	// so this is a store read and not a second request.
	const { data: serverHealth } = useServerHealth();
	/*
	 * WHETHER THE STRIP OWNS THE CONNECTION VOICE, read for the composer's notice
	 * below - the same predicate the sidebar's paragraphs and the pane's catalogue
	 * error yield to (R11), so the four surfaces cannot drift about which of them
	 * is speaking.
	 */
	const stripSpeaksConnection = useStripSpeaksConnection(
		serverHealth?.online === false,
	);
	/*
	 * A RECOVERED SERVER RE-SUBSCRIBES THE OPEN CONVERSATION (UX round 2, U19;
	 * QA round 2's Q3).
	 *
	 * The app can cross its own "the daemon is stopped" decision - main reports that
	 * after its 90 s line - and the later auto-attach clears the strip WITHOUT
	 * reopening this conversation's stream: the transcript keeps its LOST_CONNECTION
	 * notice and manual Reconnect, and everything behind them stays frozen. Measured
	 * by the UX round as a notice that "outlives the recovery", and by QA as a
	 * conversation that never re-subscribed: the walker waited 60 s past the revive
	 * and the pane was still waiting.
	 *
	 * EDGE-TRIGGERED on the server coming BACK, not level: a view that is
	 * `unavailable` while the server is already online is one whose own retry has
	 * just failed, or whose refusal is per-conversation, and re-pressing it on every
	 * render would be a reconnect loop with the reader's health as its budget. The
	 * press is the SAME door the notice's Reconnect uses (`canonical.view.retry`), so
	 * the automatic and manual routes cannot drift.
	 */
	const serverOnline = serverHealth?.online === true;
	const wasOnline = useRef(serverOnline);
	useEffect(() => {
		const recovered = serverOnline && !wasOnline.current;
		wasOnline.current = serverOnline;
		if (!recovered) return;
		if (canonical.status !== "unavailable") return;
		canonical.retry();
	}, [serverOnline, canonical]);
	const setCwd = useCanonicalSessionsStore((state) => state.setCwd);
	const markTurnStopped = useCanonicalSessionsStore(
		(state) => state.markTurnStopped,
	);
	const clearTurnStopped = useCanonicalSessionsStore(
		(state) => state.clearTurnStopped,
	);
	const [admitting, setAdmitting] = useState(false);
	/*
	 * The lock is created lazily and held in a ref, not in state: it has to be
	 * read and written synchronously in one run, and `useMemo` guarantees nothing
	 * about recomputation — a lock that a re-render may replace is not a lock.
	 */
	const sendLockRef = useRef<SendLock | null>(null);
	sendLockRef.current ??= createSendLock();
	const sendLock = sendLockRef.current;
	/*
	 * Whether a press is waiting for the session's read window (see `send`),
	 * held as a ref BESIDE the notice it renders: `answerLockedSend` has to read
	 * it synchronously on a second press, before React re-renders, and the muted
	 * sentence it gates is what makes the wait visible (task-17, U1/U2). No
	 * state: the sentence's own lifecycle is the notice's, and a second source
	 * for "is a press waiting" is a second thing that can drift.
	 */
	const queuedSend = useRef(false);
	/*
	 * The stream's latest answer, readable from inside an awaiting `send`, whose
	 * closure is the render it started in. Written during render on purpose: the
	 * value is only ever READ by async continuations, never by render.
	 */
	const streamRef = useRef(canonical);
	streamRef.current = canonical;
	/** Sends held until the validation window answers; see `send`. */
	const windowWaiters = useRef<Array<(outcome: WindowOutcome) => void>>([]);
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
		/**
		 * Whether a DEFINITE not-sent refusal leaves the kept value sendable again
		 * (`answerReport`'s classification, on the card arm). The secret card is
		 * the one reader: it releases its field for a retry on `true` and holds on
		 * `false`, because an unknowable outcome may have landed and a retry could
		 * send it twice (see `question-dock.tsx`).
		 */
		retryable: boolean;
		/**
		 * The arm's register, straight from `answerReport`: the retryable-busy
		 * refusal is a failure the app is absorbing and paints muted, every other
		 * arm is the user's to read as a failure (design round 1, D4).
		 */
		muted: boolean;
	} | null>(null);
	/**
	 * The queued-ask outcomes, keyed by ASK ID.
	 *
	 * A separate record from `answerState` rather than a second key in it, because
	 * the two are keyed by different identities: a gate's record is keyed by the
	 * gate (so the next question clears it by construction), while a queued ask IS
	 * the identity - it may be answered long after the frame that carried it, and
	 * the next ask is a different id rather than a new question of the same one.
	 * Folding them would leave a gate's stale key able to match an ask id and
	 * vice versa.
	 */
	const [askOutcomes, setAskOutcomes] = useState<Record<string, AskOutcome>>(
		{},
	);
	/*
	 * THE ASK COMPOSER'S OWN STATE (design §5.0, the operator's R7 amendment).
	 *
	 * A separate lane from everything the composer already does, and separate on
	 * purpose: this does NOT extend the skill selector's machine or the gate's
	 * swallow. The gate's swallow is the behaviour this feature replaces - it is
	 * why the old design turned the composer into the answer box unconditionally -
	 * so reusing its flag would carry the unconditional part along with it.
	 *
	 * `askExpanded` is the ONE flag the routing rule reads. While it is true the
	 * composer answers the ask; while it is false the composer is an ordinary
	 * conversation box. It is owned by the STORE (as `isAskDrawerOpen`, the right
	 * slot's fifth pane), rather than inside the drawer or here, for two reasons
	 * the design gives: the chip and the composer must not be able to disagree about
	 * which mode the user is in, and the drawer has to close the canvas when it opens
	 * (one right pane at a time, `claimRightSlot`) - a rule that cannot be kept by a
	 * `useState` in this component.
	 */
	const askDrawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	/*
	 * AND WHICH QUEUE IT IS SHOWING IS PART OF THAT ANSWER (fleet scope, design note
	 * §4.4). The drawer is ONE container in two scopes, and this component owns the
	 * session one: the composer answers ITS conversation's ask, so a fleet panel
	 * being open must not put this composer into answer mode — the fleet's rows
	 * belong to other conversations and its own cards are where they are answered.
	 * Reading the scope here is what makes that a construction rather than a promise:
	 * a fleet ask can never be answered by typing into an unrelated conversation's
	 * box, which is the misroute this split exists to prevent.
	 *
	 * THAT THE BOX STAYS ORDINARY UNDER THE FLEET PANE IS THE DECISION, NOT AN
	 * OVERSIGHT (UX round 1, U4). The alternative - flipping it into answer mode - is
	 * the misroute above; the legible half is that the two scopes never look alike:
	 * the fleet door's trigger takes the stacked-conversations glyph and names `All conversations`,
	 * the panel's bar says `All conversations · N`, and this
	 * chip keeps saying `this conversation's asks` (`askChipLabel`) and opens this
	 * conversation's own queue. A reader who types here is in the conversation they
	 * can see, not in the pane; the pane answers through its own cards' `Send
	 * answer`.
	 */
	const askDrawerScope = useUiPreferencesStore((s) => s.askDrawerScope);
	const askExpanded = askDrawerOpen && askDrawerScope === "session";
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	/*
	 * ANSWERING IS NOT THE SAME AS EXPANDED (UX round 2, U7).
	 *
	 * A settled-only queue can still be expanded - the history is worth reading -
	 * but there is nothing to answer into it, and the composer used to enter ask
	 * mode anyway: the sentence promised an answer the Enter key could not send, and
	 * the press left the text sitting in a box whose send control was painted in its
	 * live accent. `sendToAsk` refused correctly (nothing was misrouted), so the
	 * defect was the promise rather than the route.
	 *
	 * Derived from the SAME view the panel and the routing read, so the sentence,
	 * the control and the route cannot disagree about whether there is an ask to
	 * answer: with nothing answerable the box keeps the ordinary invitation and
	 * Enter goes to the conversation, which is the only thing it could mean.
	 */
	const asksView = useMemo(
		() => askQueueView(canonical.frontend),
		[canonical.frontend],
	);
	const askAnswering = askExpanded && askComposerAnswers(asksView);
	/*
	 * The two DRAFTS, kept apart (design §5.0's invariant).
	 *
	 * The composer holds one box and the user may be mid-sentence in either mode,
	 * so toggling has to swap buffers rather than share one: a chat draft must
	 * never become an answer and an answer must never be sent as chat. The chat
	 * buffer lives in the input store (where the composer already reads it) and
	 * the ask buffer lives beside this flag; the swap below moves each in and out
	 * of the box.
	 */
	const askBuffer = useRef("");
	const chatBuffer = useRef("");
	/*
	 * The in-flight answers, keyed by ask id then question id: ONE draft shared by
	 * the panel's ticks and the composer's typed answer. Two would mean a composer
	 * Enter discarding a ticked option, or a tick discarding what was typed.
	 */
	const [askDrafts, setAskDrafts] = useState<Record<string, AskDraft>>({});
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
	 * actually painting, so the arm can compare the live card's identity rather than
	 * the press's own.
	 *
	 * IT IS WRITTEN IN A `useLayoutEffect`, NOT IN THE RENDER BODY (agent review
	 * round 2, MINOR-3). The liveness the render-body write was protecting is real —
	 * an effect must not lag a commit — but `useLayoutEffect` runs INSIDE the commit,
	 * after the DOM is mutated and before paint, and the read that matters (the
	 * promise continuation below) can never interleave with a commit. So the layout
	 * effect keeps every bit of that liveness and drops the one hazard the
	 * render-body write has: React may render a state it then DISCARDS (this app
	 * runs under `<React.StrictMode>` and behind Suspense boundaries), and a write
	 * made in a discarded render still lands. The consequence is not symmetric — a
	 * leaked NEWER key while the committed tree still paints the pressed card would
	 * render the moved-on sentence for a question that is still on screen and still
	 * unanswered, which is a new false copy of the kind this branch exists to
	 * remove.
	 */
	const liveGateKey = useRef<string | null>(null);
	/*
	 * THE LIVE OWNER EPOCH, read the same way and for the same reason (code review
	 * round 1, MAJOR-1).
	 *
	 * A codeless `409` from the answer route is three different events and only one
	 * of them is a settlement; the epoch is what separates the rollover from the
	 * other two. The press carries `canonical.ownerEpoch` — a render-closure value
	 * — so comparing it against itself proves nothing, exactly as with the gate key
	 * above. This ref holds the epoch the app holds NOW, so the report can see that
	 * the runtime instance the press addressed is gone: a rollover mints a fresh
	 * epoch and the old one is refused with the question still pending and still
	 * answerable (measured — see `answerReport`'s note).
	 */
	const liveOwnerEpoch = useRef<string | null>(null);
	useLayoutEffect(() => {
		liveGateKey.current = gateKey;
		liveOwnerEpoch.current = canonical.ownerEpoch;
	});
	const answerForThisGate =
		pendingGate && answerState?.key === gateKey
			? {
					sending: answerState.sending,
					refused: answerState.refused,
					retryable: answerState.retryable,
					muted: answerState.muted,
				}
			: null;
	const lastCatalogueState = useRef("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [sendErrorCode, setSendErrorCode] = useState<string | undefined>();
	/*
	 * THE NOTICE'S TWO DECISIONS, kept beside the sentence they belong to.
	 *
	 * `retry` is whether a Retry control renders at all: a refusal whose remedy is
	 * something else, or one the far side will refuse again the instant it is
	 * pressed, is better served by Clear alone than by a button that fails
	 * (`withholdsRetryHint`, applied where the failure is classified). `muted` is the
	 * register: a failure is `danger` ink, and the two statements that are not
	 * failures - the send lock, and a message that turned out to have been
	 * delivered after all - are ink-muted.
	 */
	const [sendErrorRetry, setSendErrorRetry] = useState(false);
	const [sendErrorMuted, setSendErrorMuted] = useState(false);
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
	 * READ FROM THE REGISTRY, ADDRESSED BY THIS PANE'S OWN IDENTITY. That is
	 * what makes the claim exist BEFORE the session does: the paint happens at
	 * the press, under the identity this pane already has (the draft key), and
	 * `pendingSendForView` returns it until a mounted pane observes the owner's
	 * durable row - across the identity flip, a switch away and back, and the
	 * receipt (which deletes the draft ROW but resolves no entry).
	 *
	 * The LATCH remains, and it is a render-timing rule rather than state: the
	 * resolution pass runs in an effect AFTER the commit that paints the owner's
	 * row, so for that frame the registry can still answer "pending" while the
	 * transcript already holds the answer. The enders below clear the rung from
	 * the records themselves, and the latch is what keeps `starting` stable - a
	 * value read by the band, the pane's collapse and the working line - across
	 * every render in between. A ref, not state, because every transition that
	 * matters is already a store or transcript change that re-renders this panel;
	 * the write is idempotent, which is what makes it safe under a repeated
	 * render.
	 */
	const pendingNow = pendingSendForView(identity);
	const admitted = useRef<{
		requestId: string;
		/*
		 * THE PRESS ANCHOR TRAVELS WITH THE CLAIM (agent review round 1, MINOR).
		 * When the message POST's answer lands before the owner's `message_start`,
		 * `finishDraft` deletes the draft row and `draft?.submittedAt` goes with it
		 * while the latch correctly stays held - so `startingSince` moved `T ->
		 * undefined`, the line's withdrawal rule blanked the seconds, and the clock
		 * reappeared only when the owner painted something. Pre-change the rung kept
		 * a local zero through that gap; it must now keep the PRESS's number, which
		 * is the one the design's J5 is about. Snapshotted once per claim, so the
		 * row's deletion cannot take it.
		 */
		submittedAt?: number;
	} | null>(null);
	const outcomeAtAdmission = useRef<{
		requestId: string;
		anchor: string | null;
	} | null>(null);
	if (pendingNow) {
		// Keep the baseline after retirement too: the receipt may lag the
		// completion frame, leaving this same draft pending for another render.
		// Re-snapshotting then would turn the just-finished outcome into "old"
		// history and resurrect the wait we just cleared.
		if (outcomeAtAdmission.current?.requestId !== pendingNow.id) {
			outcomeAtAdmission.current = {
				requestId: pendingNow.id,
				anchor: canonical.frontend?.attention?.anchor_id ?? null,
			};
		}
		if (admitted.current?.requestId !== pendingNow.id) {
			admitted.current = {
				requestId: pendingNow.id,
				// The entry first: it is the copy that survives this mount (R2-5).
				submittedAt: pendingNow.submittedAt ?? draft?.submittedAt,
			};
		}
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
	/*
	 * The enders, from this panel's own state: the turn answered, the turn stopped,
	 * the row carrying a failure, or the claim RESOLVED AS UNDELIVERED. The failure
	 * term is what ends the wait for a send the store has already handed back to the
	 * composer - the transcript has nothing to say about it yet, and the rung must
	 * not outlive the flight.
	 *
	 * THE RESOLUTION IS THE THIRD SHAPE OF THE SAME FACT (design review round 1,
	 * D1). When the server's complete read does not name the message,
	 * `resolveHeldFromServer` clears `error`/`errorCode`/`errorRetry` and records
	 * `undelivered` - so the term above stops firing while the row it describes is
	 * still on screen, and the rung re-armed beside `Not delivered · Send again ·
	 * Edit`: one message both "not delivered" and "being waited on", measured on
	 * `after/reload` and `after/return` in the round-1 set. `undelivered` is the
	 * resolution's own record, so it ends the rung exactly as the live failure does.
	 *
	 * THE ENDER IS THE FIX, NOT A RETIREMENT OF THE ENTRY: the registry entry is
	 * the ROW's home (its retention is what re-seeds the row on a switch-away and
	 * a remount), so resolving the claim removes the WAIT and nothing else - the
	 * row stays on screen, and after a reload it is re-painted from `undelivered`
	 * (`resynthesisePendingSend`).
	 */
	if (
		admitted.current &&
		(answered ||
			stopped ||
			Boolean(draft?.error) ||
			/*
			 * SCOPED TO THIS CLAIM'S OWN ID, and the scoping is load-bearing rather than
			 * tidy: `undelivered` is a single slot on the row, and a NEW send on a
			 * conversation whose earlier message resolved leaves that record in place
			 * while it replaces the row's claim fields. Matched by id, the term ends the
			 * rung for the message the record names and for no other; matched by
			 * presence alone it withheld the rung from the NEXT message's whole flight -
			 * measured on the away step, where the second message's row sat on screen
			 * with no line over it (found while re-shooting the round-1 pair).
			 */
			(draft?.undelivered !== undefined &&
				draft.undelivered.recordId === admitted.current.requestId))
	)
		admitted.current = null;
	const starting = admitted.current !== null;
	/*
	 * WHICH HALF OF THE WAIT THIS IS, for the line's label (`starting the
	 * session` vs `waiting for the agent`): the create hop is the half where no
	 * session exists yet, and the draft row's `sessionId` is the fact that ends
	 * it - the SAME field the paint addressed the row by and the re-key moved it
	 * with, so the label cannot disagree with the identity the registry holds.
	 * The elapsed anchor travels beside it (`submittedAt`), because the number
	 * must cross this label change without restarting (see `startingSince`).
	 */
	const startingSession = starting && !(draft?.sessionId ?? sessionId);
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
	 *
	 * A DRAFT PANE GETS THAT SAME ANSWER (design review round 1, D2). The draft's
	 * own subscription makes a canonical frontend exist while the pane has no
	 * conversation, and the header grew the Run-details control over a run that
	 * cannot exist yet - a panel that could only open on nothing. A draft has no
	 * run to report, so the model stays null until the session exists; the trigger
	 * then arrives with the conversation, which is exactly when main draws it.
	 */
	const runDetails = useMemo(
		() =>
			sessionId && canonical.frontend
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
						/*
						 * The armed monitors ride the same derivation, which is what puts the
						 * composer's monitor chip, the pane's Monitors section and the section's
						 * trailing tally on ONE list — the wake wiring's own argument, one count
						 * over: a second read of the wire here would be a second source of truth
						 * for a count the user can see twice on one screen.
						 */
						monitors: canonical.frontend.monitors,
					})
				: null,
		[sessionId, canonical.frontend],
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
	/*
	 * The pane's monitor cancel, taken HERE beside the MCP remedies for their
	 * reason: this component owns the session identity, and the Monitors
	 * section's confirmation and refusal stay presentational props. The hook owns
	 * the retry policy and the canonical re-read (`use-monitor-controls.ts`).
	 */
	const monitorControls = useMonitorControls({ sessionId });
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
	 *      (`desktop-hooks.ts`'s `references` key). The composer therefore offers
	 *      the picker and paints the chips only on a backend that says it can carry
	 *      them, and withholds all of it otherwise, where the `@` is plain text —
	 *      which is what such a harness does with it. The key is CONDITIONAL on the
	 *      harness side rather than a build fact: a backend whose
	 *      `LOCAL_OPERATOR_AT_REFERENCES` kill switch is off advertises nothing, so
	 *      the absent key covers both an older backend and a current one that will
	 *      not expand, and this gate answers both the same way.
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
	 * AND WHETHER THE HARNESS WILL CARRY THE INPUT-MODE STAMP (arch §4.2).
	 *
	 * The same negotiation shape as `mentionsEnabled`, for the same reason: the
	 * field is metadata this app never renders, but an older harness validates
	 * the message body with `extra="forbid"` and would refuse a body that
	 * carried it - so the field rides only on a backend that advertises
	 * `features.input_mode`, and a backend that does not gets the legacy body
	 * (field absent). Read at the press, like the send it gates.
	 */
	const inputModeEnabled = desktopFeatureEnabled(
		capabilities.data,
		"input_mode",
	);
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
	 * available without the key is the only evidence the sentence may rest on, and
	 * that answer has two causes: a backend older than the key, and a current one
	 * whose `LOCAL_OPERATOR_AT_REFERENCES` kill switch is off.
	 *
	 * THE SENTENCE'S FIRST CLAUSE IS TRUE OF BOTH AND ITS REMEDY CLAUSE IS TRUE OF
	 * ONE, which is a deliberate asymmetry rather than an oversight. "This backend
	 * cannot carry file references" is the state in either case, and this page
	 * cannot tell them apart. "Update the backend and try again" is the way out of
	 * the OLDER-BACKEND case and does nothing for the kill switch — but the second
	 * cause is one the operator set themselves, it is not something the app can
	 * offer a remedy for, and a notice that stated both causes would be a sentence
	 * about an environment variable in the composer's own voice. The update is the
	 * cause a user can act on, so it is the one named. The two are not
	 * distinguishable from here, which is why the sentence names the state rather
	 * than a version.
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
	/*
	 * THE SPEC IS READ THROUGH THE HOLD - `frontend ?? heldFrontend` - the same
	 * fallback the readings strip and the destination pickers already paint from
	 * (task-17, F3). Reading only `frontend` made every GAP look like the
	 * unresolved -> resolved edge this effect exists for: a gap drops `frontend`
	 * to null (the authoritative snapshot is gone until its replacement lands),
	 * so the model read as `null` for the whole gap and the next snapshot
	 * restored it - a null -> model transition once per reconnect, each one
	 * invalidating the effort query and spending a `commands.entities` round
	 * trip to prove nothing had changed (measured: one refetch per gap->snapshot
	 * cycle). The hold is dropped by every terminal state and by a real session
	 * change, so the fallback cannot keep a stale model alive past the point
	 * where the pane stops describing a stream.
	 */
	const resolvedModel = effortQueryModel(
		canonical.frontend,
		canonical.heldFrontend,
	);
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
	 * WHETHER THE READINGS WERE DROPPED RATHER THAN NEVER ARRIVED (task-17, U4).
	 *
	 * The stream's terminal arms clear `heldFrontend` on purpose - a reading
	 * held past a spent retry budget is the one thing still claiming to describe
	 * a live stream - but the strip then vanishes with no word of its own, and
	 * the reader who was watching `$0.515` and `20.3%/1M` sees them go without
	 * an explanation of their own (the failure notice speaks for the STREAM).
	 * This remembers, per session, that readings were once painted, so the pane
	 * can tell "the readings were dropped" apart from "this pane never had
	 * any" - the first gets one sentence, the second stays silent. Keyed by the
	 * session the drop belongs to, so a session switch cannot inherit it.
	 */
	const readingsWereLive = useRef<string | null>(null);
	const [readingsDroppedFor, setReadingsDroppedFor] = useState<string | null>(
		null,
	);
	useEffect(() => {
		if (!sessionId) {
			setReadingsDroppedFor(null);
			return;
		}
		if (canonical.frontend || canonical.heldFrontend) {
			readingsWereLive.current = sessionId;
			setReadingsDroppedFor(null);
			return;
		}
		setReadingsDroppedFor(
			readingsWereLive.current === sessionId &&
				canonical.status === "unavailable" &&
				!canonical.missing
				? sessionId
				: null,
		);
	}, [
		sessionId,
		canonical.frontend,
		canonical.heldFrontend,
		canonical.status,
		canonical.missing,
	]);
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
	/*
	 * Retire whatever the composer's error line is holding.
	 *
	 * ONE IMPLEMENTATION FOR BOTH ITS CALLERS, because both are the same act: the
	 * page's own controls (the alert's dismiss, the held-claim controls) and the
	 * aside door below, which retires the line when it starts a new aside (design
	 * round 2, D7 - the line outlived the aside it described). It is a
	 * `useCallback` because the aside door hands it to `useSlashDispatch`, whose
	 * `dispatch` lists it as a dependency: a fresh identity per render would
	 * rebuild that callback on every render of this page, and the values it writes
	 * through are the two setters, which never change.
	 */
	const clearError = useCallback(() => {
		setSendError(null);
		setSendErrorCode(undefined);
	}, []);

	/*
	 * Whether the box is refusing an aside follow-up RIGHT NOW, as the one predicate
	 * both doors apply reads it.
	 *
	 * A BOOLEAN SUBSCRIPTION RATHER THAN THE STORE OBJECT, because both things this
	 * page does with it are edge-shaped: the line is raised with the refusal's own
	 * code, and it is retired the moment this flips false - which is the same moment
	 * the adopt control goes live beside the panel (UX round 2, U12; agent review
	 * round 5, R5-5; design round 3, D13). Every other error line on this surface is
	 * retired by the user's own next act; this one describes a state the app can see
	 * end, so it ends with it.
	 *
	 * The comparison rather than the value keeps the subscription's result a
	 * primitive, so a store write that does not move the gate cannot re-render this
	 * page: `asideAskBlockedReason` returns a SENTENCE, and a fresh one per call.
	 */
	const asideBusy = useAsideStore((state) =>
		sessionId ? asideAskBlockedReason(state, sessionId) !== null : false,
	);

	/*
	 * Raise the busy sentence, minted here so the `/btw` door can reach the same line.
	 *
	 * The sentence is the APP's refusal rather than the owner's, and it is stated on
	 * ONE line for both doors: this page owns the composer's error line, and the
	 * dispatcher owns none of it - the door used to write a permanent red TRANSCRIPT
	 * receipt for a state that lasts exactly as long as one answer, which is a record
	 * of something that is about to stop being true (UX round 2, U13).
	 */
	const noteAsideRefusal = useCallback((sentence: string) => {
		setSendError(sentence);
		setSendErrorCode(ASIDE_STILL_ANSWERING_CODE);
	}, []);

	/*
	 * THE BUSY LINE IS RETIRED WITH THE MOMENT IT DESCRIBES.
	 *
	 * It used to stay for the rest of the read dwell - measured: still reading "still
	 * answering" 9.4s after the answer had settled, with the now-live adopt control
	 * beside it, and cleared only by the next keystroke (UX round 2, U12; design round
	 * 3, D13). The condition is the predicate itself, so the line cannot outlive the
	 * state it names on either exit: the answer settles, or the panel closes and takes
	 * the turn with it.
	 *
	 * GATED ON THE CODE, because this surface carries every one of the composer's
	 * refusals and only this one is tied to a state the app can watch end. A store
	 * refusal beside it is the user's to clear, and `clearError` is not scoped.
	 */
	useEffect(() => {
		if (sendErrorCode !== ASIDE_STILL_ANSWERING_CODE) return;
		if (asideBusy) return;
		clearError();
	}, [asideBusy, clearError, sendErrorCode]);

	/*
	 * HOISTED AND MEMOISED for the composer's memo boundary (C1). This closure is a
	 * dependency of the dispatcher's `note`, which the page hands the composer as
	 * `onSlashNote`, and a prop rebuilt per render would re-render the whole
	 * composer once per stream flush. Frozen on `canonical.addNote`, which is
	 * stable in the stream hook: one `useCallback` over the view's single writer.
	 */
	const addMessage = useCallback(
		(message: Message) => canonical.addNote(message.message ?? ""),
		[canonical.addNote],
	);

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
		addMessage,
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
		 * The composer's line is retired by the door that starts an aside, whichever
		 * door that is (design round 2, D7). The `send` branch above retires it itself
		 * when the composer asks; this is the `/btw` door's half of the same rule, and
		 * the dispatcher cannot reach the setter on its own. A new attempt makes every
		 * line on that surface stale, which is the whole scope of the clear.
		 */
		clearAsideRefusal: clearError,

		/*
		 * The `/btw` door's half of the same line (UX round 2, U13). It has no composer
		 * error line of its own, so the page mints the sentence: one state, one surface,
		 * whatever door refused the press.
		 */
		noteAsideRefusal,

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
	 * A STABLE `dispatchFromControl` for the composer's memo boundary (C1): the
	 * dispatcher's own identity is rebuilt on every render — its dependency list
	 * reads the canonical handle, which the stream replaces per flush — and the
	 * composer takes this callback both as `onSlashCommand` and inside its session
	 * readings. The wrapper gives the boundary one identity while still running the
	 * most recently committed render's closure (see `useStableCallback` for the
	 * exact guarantee, including the same-commit window it does not cover).
	 */
	const stableDispatchFromControl = useStableCallback(dispatchFromControl);
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
		/*
		 * UNNAMED, AND THAT NOW MEANS THE HEAD PAGE (round 3, Q-1). This refresh used to
		 * take the store's default of `LEGACY_CATALOGUE_PAGE`, so every ordinary
		 * conversation open fired an unscoped `limit=500&include_archived=true` read - the
		 * multi-second answer this change exists to remove, and it also replaced the scoped
		 * membership with 500 rows. The default follows the capability now
		 * (`cataloguePageDefault`), and nothing else here changes.
		 */
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
	/*
	 * ONE CLASSIFIER AND ONE TABLE, for every failure a send can have.
	 *
	 * `sendFailureCopy` owns the sentence, whether Retry can help, and the code -
	 * so the composer renders the same words whichever door the failure came
	 * through, instead of the four hand-written copies that used to live between
	 * this page and the composer (the transport's, the guard's, the held
	 * paragraph's and the generic tail's).
	 */
	/*
	 * The FALLBACK for a failure the store wrote no row for - a throw before a draft
	 * existed. It classifies fact-less on purpose: the only fact the pane has at that
	 * point is the pre-send snapshot, which is the off-by-one review round 4 named
	 * (`caughtFailureNotice` carries the argument). Every failure the store DID
	 * classify is rendered from the row it wrote.
	 */
	const caughtFailureCopy = (error: unknown) =>
		sendFailureCopy(error, undefined, false);
	/*
	 * THE ROW IS THE CLASSIFICATION, SO THE PANE RENDERS IT RATHER THAN REPEATING IT
	 * (review round 4, M1). The store classifies every failure once, with the fact it
	 * actually used - `replay && previous?.admissionAttempted`, i.e. about the id the
	 * attempt carried - and writes the sentence, the code and the press onto the row.
	 * Classifying again here cannot be as right: `previous` at this point is the
	 * PRE-SEND row, so an edited payload (which rotates the request id in the same
	 * call) got the unknown-outcome sentence and a Retry over a body the daemon had
	 * just refused, while the row it was standing in for said the opposite - one
	 * failure rendering two ways, and only on screen.
	 *
	 * `composerNoticeFor` prefers this local copy over the row's, so reading the row
	 * here is what makes the two agree. `false` when the store wrote nothing (a
	 * failure before a draft existed), which leaves `reportFailure` below as the
	 * fallback rather than the rule.
	 */
	const reportCaughtFailure = (draftKey: string, error: unknown) => {
		const row = useCanonicalSessionsStore.getState().drafts[draftKey];
		const notice = caughtFailureNotice({
			rowError: row?.error,
			rowCode: row?.errorCode,
			rowRetry: row?.errorRetry,
			fallback: () => caughtFailureCopy(error),
		});
		setSendError(notice?.message ?? null);
		setSendErrorCode(notice?.code);
		setSendErrorRetry(notice?.retry === true);
		setSendErrorMuted(notice?.muted === true);
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
		/*
		 * How the composer's own box produced this message (§4.2), passed through
		 * from the composer's flags. `undefined` means either a door that does not
		 * track it (the suggestion grid) or a harness that has not advertised
		 * `features.input_mode`; both send the legacy body, and a replay pins
		 * whichever value the first attempt carried.
		 */
		inputMode?: "typed" | "dictated" | "mixed",
	): Promise<SendOutcome> => {
		/*
		 * THE ASK-MODE BRANCH, FIRST, and before every other door this function
		 * offers (design §5.0). While the ask surface is expanded the composer is
		 * the answer box, so nothing below this line may see the text: the slash
		 * planner would run a command the user meant as an answer, and the gate
		 * swallow would send it as a message. Enter and the Send button both land
		 * here because both are this function, which is what makes "Enter while the
		 * ask composer is focused follows the same routing" true by construction
		 * rather than by a second key handler that could drift from this one.
		 */
		if (askAnswering) return await sendToAsk(content);
		const store = useCanonicalSessionsStore.getState();
		// Same ROW the view reads, so a send can never address a different draft
		// than the one whose retained text and Discard control are shown. The
		// resolver rather than `draftIdentityFor` alone: a pane reached by the
		// session's own route derives a key the staged draft never wore, and the
		// replay rule has to find the row the failure was written to (UX round 2,
		// U5 - see `paneDraftKey`).
		const key = paneDraftKey(draftKey, sessionId, store.drafts);
		if (!key) return false;
		const previous = store.drafts[key];
		/*
		 * THE ANSWER TO A PRESS THIS SCREEN CANNOT TAKE YET, in the app's own words and
		 * register, chosen by the one rule (`pressLockCopy`). Both refusals below use
		 * it - this conversation's own send still out, and a lock held by another send
		 * - so the sentence cannot drift between them, and the composer's own answer to
		 * a press on a flight it can see reads the same helper.
		 */
		const answerLockedSend = (): false => {
			/*
			 * A SECOND PRESS WHILE THE FIRST IS QUEUED KEEPS THE QUEUE'S OWN
			 * SENTENCE (task-17, U2). The locked press is answered by the claim
			 * that is on screen - "your message will send as soon as the
			 * conversation is ready" - rather than by the send-lock copy, because
			 * "still sending" would contradict the mark the reader can see and
			 * overwrite the pending affordance with a claim about a different
			 * state. Both are muted statements of fact about the same flight, so
			 * the register does not move; only the sentence that is true does.
			 */
			setSendError(
				queuedSend.current
					? SEND_FAILURE_COPY.queuedSend
					: pressLockCopy(canonical.frontend?.pending_gate),
			);
			setSendErrorCode(undefined);
			setSendErrorRetry(false);
			setSendErrorMuted(true);
			return false;
		};
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
		 * the message does not exist on the far side; the class the failure lands in
		 * (`sendFailureClass`, which reads `isRefusedBeforeAdmission` inside the
		 * store) is what decides the sentence, and since S4 no failure arm RETURNS a
		 * payload to this box: a failure raised before the press painted a row stays
		 * composer-side with the text where the user left it, and one raised after
		 * it is stated by the row. The composer is deliberately NOT disabled:
		 * the panel has already told the user they are in the target, and the two
		 * can only disagree for a round trip.
		 */
		/*
		 * THE PRESS IS ANSWERED, NOT SWALLOWED (review round 3, U6).
		 *
		 * This returned `false` in silence: on a conversation whose own send was still
		 * out, the user's second press produced no line at all, which is
		 * indistinguishable from a broken key - and looking broken is what makes a user
		 * press again over a box that by then holds both messages. The design's own
		 * sentence for it exists ("Your last message is still sending."), so the
		 * refusal says it.
		 */
		if (previous?.pending) return answerLockedSend();
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
			/*
			 * MUTED, AND WITH NO CONTROLS. Nothing failed here: the press never became
			 * a send, the payload is still in the box exactly as the user left it, and
			 * the only useful thing to say is when the box will take a press again.
			 * Offering Retry over a lock would be a control that cannot work, which is
			 * the shape this whole change removes.
			 */
			return answerLockedSend();
		}
		setAdmitting(true);
		setSendError(null);
		setSendErrorCode(undefined);
		setSendErrorRetry(false);
		setSendErrorMuted(false);
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
			// The ONE derivation (agent review F3): the mirror rule is applied in
			// `effectiveGate`, so this door cannot answer a mirrored ask by index
			// while the ask lane is live.
			const gate = effectiveGate(canonical.frontend);
			if (gate && canonical.ownerEpoch && sessionId) {
				/*
				 * A SECRET GATE TAKES NO COMPOSER ANSWER, and this is the door that
				 * says so for every route that can still reach a send while one waits:
				 * the composer itself is refused input (`message-input.tsx`'s
				 * `secretAnswer` term closes typing, paste, dictation, the slash popup
				 * and the form's own submit), so what arrives here is a suggestion
				 * chip, the stopped-turn Retry, or a programmatic caller — and none of
				 * them may post a typed string as a credential's answer. It has to fire
				 * BEFORE the arms below, which would otherwise answer the gate with
				 * whatever text the door carried.
				 *
				 * The sentence and the code are the ones every refused answer uses, so
				 * the composer's alert offers no press that cannot work
				 * (`SECRET_ANSWER_DOCKED_MESSAGE` carries the reasoning). The read itself
				 * is `gateIsSecret` — the ONE predicate the dock's field arm, the
				 * composer's closure and the answer door share (agent review round 1,
				 * NIT-1), so no surface can mask while another stays open.
				 */
				if (gateIsSecret(gate))
					throw new UserFacingError(
						SECRET_ANSWER_DOCKED_MESSAGE,
						ANSWER_NOT_SENT_CODE,
					);
				if (gate.kind === "approval") {
					/*
					 * THE WORDS AND THE ORDINALS, resolved against the TYPED text for the
					 * same reason the ask branch below resolves there: with a staged reply
					 * `content` is wrapped in `<reply-to>…</reply-to>`, and a rule that had
					 * to parse that wrapper would be one payload change away from failing
					 * silently. `approvalAnswerValue` returns the strict boolean or `null`,
					 * and `null` renders the shipped sentence — the press sent nothing, so
					 * the box still holds the text.
					 *
					 * THE CLASS IS THE WHOLE OF THAT PROMISE (agent review round 1, MAJOR-1;
					 * UX round 1, U1). A plain `Error` carries no code, so `sendFailureCopy`
					 * classified the throw as an UNKNOWN outcome and the composer rendered
					 * "Couldn't confirm your message was sent." with a Retry that re-ran this
					 * same refusal — over a press that provably sent nothing.
					 * `UserFacingError` with `ANSWER_NOT_SENT_CODE` is the one shape the
					 * table renders as the authored sentence with `retry: false`: the user
					 * is told which answers work, and offered no press that cannot.
					 */
					const approved = approvalAnswerValue(typed ?? content);
					if (approved === null)
						throw new UserFacingError(
							"Reply yes or no to answer the approval request.",
							ANSWER_NOT_SENT_CODE,
						);
					await desktopResult({
						op: "sessions.answer",
						sessionId,
						epoch: canonical.ownerEpoch,
						requestId: gate.request_id,
						approved,
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
			const { images, unreadable, overflow } = await encodeImageAttachments(
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
				setSendErrorRetry(false);
				setSendErrorMuted(false);
				return false;
			}
			const overflowRefusal = imageOverflowRefusal(overflow);
			if (overflowRefusal) {
				/*
				 * The BUDGET arm's shape rather than the unreadable arm's: both are
				 * payload-shape refusals whose remedy is to change the draft, and
				 * neither is a store-raised failure for `withholdsRetryHint` to
				 * classify - a press just re-refuses the same chips, which is why the
				 * register is set here rather than told to a code.
				 */
				setSendError(overflowRefusal);
				setSendErrorCode(undefined);
				setSendErrorRetry(false);
				setSendErrorMuted(false);
				return false;
			}
			// Refuse BEFORE admission, where the sizes are still known and the
			// composer is still editable. A refusal from the transport arrives after
			// the draft has latched, so its "send it again" advice is then refused by
			// the unchanged-payload guard and the user cannot drop an image to fit.
			const refusal = messageBudgetRefusal(content, images);
			if (refusal) {
				/*
				 * Clear alone: the remedy is to change the payload (remove an image,
				 * split the text), so a Retry that re-sent the same bytes would be
				 * refused for the same reason.
				 */
				setSendError(refusal);
				setSendErrorCode(undefined);
				setSendErrorRetry(false);
				setSendErrorMuted(false);
				return false;
			}
			/*
			 * WHILE AN ASIDE IS ATTACHED THE COMPOSER ADDRESSES THE ASIDE.
			 *
			 * WHY HERE, BETWEEN THE REFUSALS ABOVE AND EVERYTHING BELOW. Above, because
			 * the two refusals this path already owns are about the PAYLOAD rather than
			 * about the surface it is addressed to — a message too large, or a file the
			 * app could not read, is refused the same way whoever it was meant for, and
			 * an aside path that skipped them would be the one route that does not (the
			 * interface note: an aside is an off-record ANSWER, not an exemption).
			 * Below, because every step after this point turns text into a TURN of the
			 * conversation — the stream wait, `admitChatDraft` — and an aside is
			 * precisely the exchange that must not become one.
			 *
			 * THE PENDING-GATE BRANCH ABOVE OUTRANKS IT, and the composer's placeholder
			 * is what names the winner (`message-input.tsx` puts `awaitingAnswer` ahead
			 * of the aside term for exactly this reason). A parked gate is the one thing
			 * the box must be able to answer — its card's buttons are the pointer path,
			 * and typing yes/no (or the 1/2 the card prints) into the box is the
			 * keyboard path a focused composer already has — so the aside can be left
			 * standing for as long as the user likes while the agent is parked on that
			 * gate; making the aside win would route the very keystrokes the gate needs
			 * to a different exchange, and a user with no pointer would have to close
			 * the panel to answer.
			 *
			 * THE QUESTION IS PAINTED BEFORE IT IS SENT, AND THE BOX IS HANDED BACK AT
			 * THE PRESS. `askAside` registers the turn in the store the panel renders
			 * from BEFORE it posts, so the panel shows the question and its thinking
			 * state in the same commit that clears the box — and this branch does NOT
			 * AWAIT the ask, which is what makes that commit the press rather than the
			 * answer. Awaiting it held the composer's own clear and its `admitting`
			 * state for the whole POST, so a question visibly being answered above sat
			 * in the box as well, and a follow-up typed meanwhile made the eventual
			 * clear a no-op — the next Enter then asked "q1q2" as a NEW turn. The
			 * `/btw` dispatcher's own branch states the same rule for its own door.
			 *
			 * A FAILED ASK DOES NOT PUT THE TEXT BACK, deliberately. The failure is
			 * unknowable in the way `SEND_HELD` describes — the ask was REGISTERED, so
			 * "nothing reached the owner" is false and the retry is not the box's to
			 * offer — and the only text a restore could write into is a box the user
			 * has since left alone, so whether it came back would depend on a race they
			 * cannot see.
			 *
			 * NOT AWAITING THE POST IS NOT THE SAME AS NOT HEARING IT, and the two
			 * things that depend on the ask's own answer ride its promise back to the
			 * composer rather than waiting here: the composer's PAYLOAD is retired only
			 * if the ask is answered and kept if it is refused (review round 2, F6,
			 * where a refusal must keep the staged reply and the credential map exactly
			 * as a refused send does), and a refusal the panel can no longer state is
			 * stated on the composer instead (F7, below).
			 */
			const aside = sessionId
				? useAsideStore.getState().attached[sessionId]
				: undefined;
			if (sessionId && aside) {
				if (attachments.length > 0) {
					/*
					 * An aside carries TEXT ONLY on the wire (the op's body is `text` and the
					 * exchange's own id), so a send with files would answer a question that
					 * silently omitted them — the one outcome worse than a refusal, because it
					 * looks like it worked. Stated through the composer's own error surface,
					 * where the chips that have to be removed are. `false` keeps both halves
					 * with the user.
					 */
					setSendError(
						"An aside answers text only. Remove the attached files to ask it.",
					);
					return false;
				}
				/*
				 * A FOLLOW-UP WHILE THE EXCHANGE IS STILL ANSWERING IS REFUSED HERE, WHILE THE
				 * QUESTION IS STILL IN THE BOX (UX round 1, U2). The composer is deliberately
				 * typable while an answer streams, and the box's placeholder invites the next
				 * question — so this press used to empty the box, paint the question and then
				 * fail 800ms later with "This aside is no longer available", because the owner
				 * refuses a continuation of an entry it is still running. `false` is the
				 * composer's own refusal-before-admission answer: the text stays where it is,
				 * and the sentence above says what to wait for. The gate is the same one the
				 * `/btw` door applies, from one predicate, so the two doors cannot disagree
				 * about when a question may leave.
				 */
				const busy = asideAskBlockedReason(useAsideStore.getState(), sessionId);
				if (busy) {
					/*
					 * THE CODE GOES WITH THE SENTENCE, and it is what keeps the composer's
					 * generic retry suffix off a line whose whole subject is that the retry is
					 * not available yet (UX round 2, U12; agent review round 5, R5-5). The box
					 * still holds the question, so the suffix was otherwise TRUE of the box
					 * and false of the situation, and it arrived directly under "wait".
					 */
					noteAsideRefusal(busy);
					return false;
				}
				/*
				 * THE SUBSCRIPTION TRAVELS WITH THE ASK. The stream is read by every
				 * attached viewer of this session, so an owner that routes `aside_delta`
				 * to the subscription that asked — rather than broadcasting it — needs to
				 * be told which one that is, and without it the panel degrades to the
				 * settled answer with no thinking state and no streaming. The id is the
				 * `open` frame's own (`use-canonical-session` keeps it on the view, which
				 * is also what the watch lease above leases it with), and it is absent
				 * only before the stream's first `open`.
				 *
				 * A WELL-FORMED ID THIS OWNER DOES NOT HOLD IS A DOCUMENTED LIMITATION, not
				 * a case with an answer here: the owner streams nothing for it and reports
				 * nothing back, so the panel paints its thinking state and then the settled
				 * answer in one piece, which reads as a slow model (QA round 1, Q3). The
				 * whole statement, and why no client-side change closes it, is on
				 * `askAside`'s own `subscriptionId` parameter — this branch is one of the
				 * two places the id is chosen, and it chooses the only value there is.
				 */
				/*
				 * A NEW ASK RETIRES THE LINE THAT DESCRIBED THE LAST ONE (design round 2,
				 * D7). The composer's aside refusal sat above a panel that had moved on — a
				 * fresh `/btw` still thinking, a new question in flight — and read as the
				 * verdict on THEM. Every line on this surface is about the last attempt, so a
				 * new attempt retires it; the alternative (matching the sentence to the ask it
				 * came from) is a bookkeeping the line does not need.
				 */
				setSendError(null);
				setSendErrorCode(undefined);
				const ask = askAside(
					sessionId,
					content,
					canonical.subscriptionId ?? undefined,
				);
				/*
				 * A PANEL THE USER CLOSED HAS NO TURN LEFT TO STATE A REFUSAL ON, and the
				 * question left the screen with it (review round 2, F7). The composer's
				 * error line is then the only surface that still knows the ask happened,
				 * so it says what became of it. Called in the same tick `askAside` returned
				 * in, which is what lets the helper name this ask's own turn and its
				 * question; the rule, and why the `/btw` command door shares it, is on the
				 * helper.
				 *
				 * THE CODE GOES WITH THE SENTENCE, and it is what keeps the false half of the
				 * error contract off this refusal: the box is empty by now (the press handed
				 * it back) and whatever the user types next is not the question that failed,
				 * so `ASIDE_NOT_ANSWERED_CODE` withholds the generic "Your message is still in
				 * the composer. Send it again." (UX round 1, U4).
				 */
				reportUncarriedAsideRefusal(ask, sessionId, (sentence) => {
					setSendError(sentence);
					setSendErrorCode(ASIDE_NOT_ANSWERED_CODE);
				});
				/*
				 * NOT AWAITED, so the box is handed back in the press's own commit (F1);
				 * the promise is nested rather than returned for the same reason (see
				 * `OffRecordAsk`).
				 */
				return { offRecord: ask };
			}
			/*
			 * A SEND PRESSED BEFORE THE STREAM HAS ANSWERED WAITS FOR IT, and then
			 * goes out (UX round 1, U1).
			 *
			 * The composer is usable from the click by design, so on a 2-3 s attach
			 * the normal path is "type, press Enter, the pane is not live yet". That
			 * used to be refused with a sentence that then retired silently, leaving
			 * the user to notice the chat had become ready and press send a second
			 * time. The press is the user's instruction, so it is held here - the
			 * text stays in the box and the composer shows its existing in-flight
			 * state (`admitting`) - until the stream decides:
			 *
			 *   - `ready`: THIS panel's stream went live and the first snapshot
			 *     closed the window; admit as normal.
			 *   - `abandoned`: the view moved to another conversation first; nothing
			 *     is sent anywhere, and the draft stays with this conversation.
			 *   - `failed`: the stream reached `unavailable` (retry budget or the
			 *     snapshot deadline). The refusal then states the STREAM's own
			 *     sentence - the same one the transcript shows with its Reconnect -
			 *     rather than "sending works once it is ready", which told the user
			 *     to wait on a panel that had already said the connection is lost
			 *     (design round 1, D3).
			 *   - `gone`: the stream's 404 tombstoned the conversation; the composer
			 *     is already read-only under its own notice, so the text just stays.
			 *
			 * It cannot hang: the hook bounds every connection by
			 * `STREAM_SNAPSHOT_DEADLINE_MS`, and an unmount (the user moved on)
			 * settles the wait as abandoned. The store's own refusal in
			 * `admitChatDraft` stays as the rule for every other caller.
			 */
			/*
			 * A SEND WHOSE CONVERSATION THE USER HAS ALREADY LEFT GOES NOWHERE
			 * (agent review round 2, R2-F1). Checked before the window, because by
			 * the time a press reaches here the switch may already have moved the
			 * window to the other conversation - and then this pane's session reads
			 * as not-in-a-window, the hold below is skipped, and the store's own
			 * refusal cannot catch it either (it refuses only the session the window
			 * names). Reproduced on the BUILT app with a real Enter and a real click
			 * on another row, when the message carried a pasted image: the send
			 * awaits the image decode above, the click lands in that gap, and the
			 * message went to the conversation just left - 1 POST and 1 journal row
			 * there, 3 of 3 runs. Without an attachment nothing yields before this
			 * point, so the press is decided in its own task (0 of 5 runs at 0-5 ms
			 * gaps). `session-switch-latency.mjs --held-leave` is the committed
			 * reproduction (press and switch in one task). `false` keeps the text
			 * with this conversation's draft, the same outcome as `abandoned`.
			 */
			if (
				sessionId &&
				!viewIsOnThisSession(useCanonicalSessionsStore.getState(), sessionId)
			)
				return false;
			if (
				sessionId &&
				isSessionUnvalidated(
					useCanonicalSessionsStore.getState().validatingSessionId,
					sessionId,
				)
			) {
				/*
				 * THE WAIT IS VISIBLE, AND THE PRESS IS ANSWERED IN ITS OWN
				 * COMMIT (task-17, U1/U2). A press made before the session's first
				 * page has landed - `Loading conversation…`, or `Reconnecting` with
				 * no page yet - is not refused: it is held here and delivered the
				 * moment the snapshot closes the window. What it must not be is
				 * SILENT, which is the state both were measured in: the Send
				 * control looked idle, nothing moved, and the only trace of the
				 * press was a POST seconds later (or the stream giving up, ~23 s
				 * out). So the press now states the queue immediately, in the
				 * muted register the send lock already uses - nothing failed, the
				 * message is with the app, and the delivery takes care of itself.
				 *
				 * THE REF, not only the state: `answerLockedSend` reads it
				 * synchronously on a second press, before React has re-rendered.
				 * The sentence is retired by the machinery that already owns
				 * muted flight claims (`lockAnswerOutlived` - `admitting` holds it
				 * for exactly this window), replaced by the failure's own sentence
				 * if the stream gives up, and never cleared by hand here.
				 */
				queuedSend.current = true;
				setSendError(SEND_FAILURE_COPY.queuedSend);
				setSendErrorCode(undefined);
				setSendErrorRetry(false);
				setSendErrorMuted(true);
				let outcome: WindowOutcome;
				try {
					outcome = await awaitWindow();
				} finally {
					queuedSend.current = false;
				}
				if (outcome !== "ready") {
					if (outcome === "failed") {
						setSendError(
							streamRef.current.failure?.statement ??
								SESSION_UNVALIDATED_MESSAGE,
						);
						setSendErrorCode(SESSION_UNVALIDATED_CODE);
						/*
						 * NO `setSendErrorRetry(true)` HERE (design round 11, D2): the read window
						 * is withheld by the classifier now - a window that answers "failed" the
						 * moment it is asked re-refuses the press - so a flag written true here is
						 * a verdict the notice no longer renders and state that would outlive it.
						 */
						setSendErrorMuted(false);
					}
					return false;
				}
			}
			const id = await admitChatDraft(
				key,
				{
					text: content,
					attachments,
					images,
					mode: busy ? "steer" : "prompt",
					cwd,
					/*
					 * The capability gate, applied HERE rather than at the composer: this
					 * function already reads the capability map for the `@` affordance,
					 * and one gate at the one seam every door passes is what keeps the
					 * suggestion grid's own sends (which pass no `inputMode`) on the
					 * legacy body by construction.
					 */
					inputMode: inputModeEnabled ? inputMode : undefined,
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
			/*
			 * THE BOUNDARY RULE, ON THE SURFACE THAT HAS TO OBEY IT: "a failure raised
			 * after the optimistic row was painted belongs to the row; before it, the
			 * composer."
			 *
			 * Everything the STORE rethrows came after the paint - the paint is the
			 * first thing `admitChatDraft` does - so the composer shows NO sentence for
			 * it: the row's own line carries the class's sentence and remedies
			 * (`undeliveredTurn` below reads the row the store wrote). That
			 * deliberately replaces #495's "keep a failed message in the composer" for
			 * post-paint failures - that arm left the message in two homes, and the
			 * box's copy was the one that could be sent twice.
			 *
			 * The failures THIS pane raises itself before admission - the gate answer,
			 * an unreadable attachment, the budget, the send lock - never painted
			 * anything, keep their composer copy unchanged, and are exactly what the
			 * `!painted` branch is for.
			 *
			 * The predicate is the registry, not a guess: an entry exists for the
			 * identity exactly when the press's paint ran, and the failure arm keeps
			 * it for every class until the row is resolved. The row's own `sessionId`
			 * is the identity's second half - the create's answer re-keys the entry to
			 * it, so a message failure after the flip is found there.
			 *
			 * AND IT ASKS MEMBERSHIP, NOT LIVENESS (round 2). A recorded failure now
			 * SETTLES the entry in the very catch this arm runs after (`admitChatDraft`,
			 * UX round 2's U5), so the liveness predicate would answer null for every
			 * post-paint failure and this pane would take its `else` branch - the
			 * composer alert over a row that already states the failure, which is the
			 * contradiction J4 forbids (measured on the re-shoot's first run).
			 * `hasPendingSend` asks the question this arm actually has: a row was
			 * painted for this send, wherever the claim has got to since.
			 */
			const row = useCanonicalSessionsStore.getState().drafts[key];
			const painted = hasPendingSend(
				panelIdentityFor(draftKey, row?.sessionId ?? sessionId),
				row?.admissionRequestId ?? "",
			);
			if (painted) {
				/*
				 * ONE FAILURE, ONE SENTENCE (J4): clear any composer copy an earlier
				 * attempt left, so only the row speaks. `reportCaughtFailure` is
				 * deliberately not called - its notice would be the second statement
				 * of this one.
				 */
				setSendError(null);
				setSendErrorCode(undefined);
				setSendErrorRetry(false);
				setSendErrorMuted(false);
			} else {
				// Only authored sentences reach the composer. `error.message` on a
				// runtime exception is a stack-trace fragment - with the backend
				// stopped this line rendered "TypeError: fetch failed" inside the
				// alert's own prose. See `userFacingMessage`.
				reportCaughtFailure(key, error);
			}
			/*
			 * `false` is "do not retire the draft": the hook must not clear the box
			 * (the row is the message's home now) and must not record this as a sent
			 * message. There is no second case to distinguish - the store acted on it
			 * before this line ran.
			 */
			return false;
		} finally {
			sendLock.release();
			setAdmitting(false);
		}
	};

	/*
	 * A STABLE `send` for the composer's memo boundary (C1). `send` is declared per
	 * render — a plain function over the whole page's state — and the composer takes
	 * it as `onSendMessage`; rebuilt per render it would re-render the composer once
	 * per stream flush. The wrapper invokes the latest closure on every call, the
	 * same semantics the fresh function had, and is the one identity the boundary
	 * sees; see `useStableCallback`. Internal callers below keep calling `send`
	 * directly.
	 */
	const stableSend = useStableCallback(send);
	/**
	 * One answer's report, applied to this panel's state — the shared tail of
	 * EVERY answer path (`answerWithOption`'s press and `answerWithSecret`'s
	 * submit), because the two are one machinery and a hand-copied second switch
	 * is how two verdicts for one outcome start.
	 *
	 * WHAT it reports and WHERE, from the answer's own outcome plus the live
	 * facts — see `answerReport`. Nothing here reads the gate's movement to
	 * decide whether the answer WON: an answer's own success is what removes its
	 * card, so that reading reported a win as a loss whenever the owner's state
	 * push painted before the answer's response landed, and the two channels have
	 * no ordering between them (`ask-answer.ts` carries the margin).
	 *
	 * The SENTENCE is the outcome's and the DESTINATION is the frame's, in that
	 * order (agent review round 2, UX U7 / QA Q1). Deciding the destination first
	 * meant this arm took the definite not-sent sentence for every failure, so an
	 * outcome the module calls unknowable — the deadline shape, which leaves the
	 * card up *precisely because* the request is still in flight — was told
	 * "your answer was not sent" and then denied it in the next clause.
	 *
	 * Every fact it reads is read LIVE, from the refs the layout effect keeps
	 * current, rather than from the closure the press started in — the closure is
	 * the one the press STARTED in, so a value read from it is the press
	 * compared with itself. That was the inert conjunct this branch deleted, and
	 * the replacements for it cannot be another closure. The identity half matters
	 * as much as the DOM half: a multi-question ask paints its next question's
	 * card in the same place under the same `aria-label` with a different key, so
	 * a query for "a card" answered true for a card that cannot carry this press's
	 * sentence — the sentence was written to a state no surface reads and the user
	 * was told nothing while a fresh question appeared where they had pressed.
	 *
	 * `cardOnScreen` asks about EITHER answer surface — the options band
	 * (`[aria-label="Answer options"]`) and the secret field's form
	 * (`[data-ask-secret]`) — because the question the probe exists for is "is
	 * this answer's own surface still on screen and able to carry its
	 * sentence", and a secret answer's surface is the field it was typed in.
	 *
	 * `onSent` is the caller's clause for the one state the two paths do not
	 * share: the approval press retires `1`-`yes.` from the composer (UX round 1,
	 * U4 — see the call site), while a secret submit has no composer draft to
	 * consume. Everything else is identical BY CONSTRUCTION, which is the point
	 * of the tail being here rather than twice beside its callers.
	 */
	const settleGateAnswer = (
		outcome: AnswerOutcome,
		pressedKey: string,
		onSent?: () => void,
	) => {
		const report = answerReport(outcome, {
			liveGateKey: liveGateKey.current,
			pressedGateKey: pressedKey,
			sentEpoch: canonical.ownerEpoch,
			liveEpoch: liveOwnerEpoch.current,
			cardOnScreen:
				document.querySelector(
					'[aria-label="Answer options"], [data-ask-secret]',
				) !== null,
		});
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
				setAnswerState({
					key: pressedKey,
					sending: false,
					refused: null,
					// A sent answer has nothing to retry: the secret field clears.
					retryable: false,
					muted: false,
				});
				onSent?.();
				return;
			case "card":
				// The sentence belongs on the surface the press was made on, where it
				// cannot be missed and cannot be repeated. It is the SAME string the
				// composer would have carried — the register is the outcome's — and
				// the hold lasts exactly as long as the outcome entitles it to
				// (UX round 2, U9: the composer arm used to release the hold while
				// leaving three live options under an unknowable outcome). A DEFINITE
				// not-sent refusal carries `retryable`, and the secret card spends it
				// by reopening its field: its composer is closed, so the hold would
				// strand the kept value with no surface able to send it (round 1's
				// D1/U1/Q-1 reunite here). An unknowable outcome keeps the hold — a
				// retry could send it twice.
				setAnswerState({
					key: pressedKey,
					sending: false,
					refused: report.refused,
					retryable: report.retryable,
					muted: report.muted,
				});
				return;
			case "composer":
				// The card is gone — or is not this press's any more — so the composer
				// carries it, in the register the outcome is entitled to: the settled
				// sentence where the live facts establish that another front end took
				// the question, the moved-on sentence where the ask advanced past it,
				// the not-knowable one where no response ever came back, and the
				// backend's own reason where it answered and refused. The code is
				// always the report's own, so the alert's hint and remedies are
				// functions of THIS failure rather than of the draft's last one
				// (design round 1, D2).
				setAnswerState(null);
				setSendError(report.message);
				setSendErrorCode(report.code);
				/*
				 * AND THE OTHER TWO FIELDS THE ALERT READS, set rather than left alone:
				 * they are the notice's register and its retry verdict, and a value left
				 * over from the last send would paint this press's sentence in the wrong
				 * ink or lay out a Retry control that sends the box (design round 1, D5).
				 */
				setSendErrorMuted(report.muted);
				setSendErrorRetry(report.retry);
				return;
		}
	};
	/**
	 * Answer the pending gate by pressing one of its options: an `ask` option's
	 * label, or an approval's Approve/Deny.
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
	 * AN APPROVAL IS NOT A SECOND PATH EITHER: its labels are the client's pair
	 * (`APPROVAL_OPTIONS`), `answerGateOption` turns one into the boolean the
	 * route takes, and a label outside the pair is refused THERE — nothing sent,
	 * nothing claimed — which is why the guard below admits both gate kinds and
	 * refuses neither here.
	 *
	 * The transport call itself lives in `answerGateOption`, which is where the
	 * one-answer-in-flight property and the request body are asserted - neither
	 * could be reached by a test while they lived inside this component (code
	 * review round 1). What stays here is what needs React: the busy flag, the
	 * card's own hold, and the two places a refusal can land.
	 */
	const answerWithOption = async (label: string) => {
		const gate = canonical.frontend?.pending_gate;
		if (!gate || !canonical.ownerEpoch || !sessionId) return;
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
		setAnswerState({
			key,
			sending: true,
			refused: null,
			retryable: false,
			muted: false,
		});
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
		settleGateAnswer(outcome, key, () => {
			/*
			 * AND THE BOX GOES WITH THE ANSWER (UX round 1, U4). A keyboard user
			 * answers `1` by typing it and then pressing an option; the press consumed
			 * the answer, but the keystrokes stayed in the composer — where focus
			 * already is — so the next Enter sent `1` as an ordinary message (measured:
			 * a real turn started with it). The press consumes the draft exactly as
			 * the typed path does, through a method that clears ONLY text which IS an
			 * approval answer (`1`, `yes.`), so a message somebody was writing is
			 * never wiped. Ask presses keep their inherited behaviour; this round did
			 * not change them.
			 */
			if (gate.kind === "approval") input.current?.consumeApprovalAnswerDraft();
		});
	};

	/**
	 * Answer the pending `secret` gate with the dock's typed value.
	 *
	 * THE SECRET FIELD'S SIBLING OF `answerWithOption`, and deliberately the same
	 * machinery: the same `sendLock` (so a submit and a typed send cannot both
	 * post for one question), the same `admitting` flag (which holds the field
	 * and the composer together while one answer is in flight), the same
	 * `settleGateAnswer` tail and the same two destinations a failure can land
	 * on. What differs is what reaches the gate: `answerGateSecret` takes the
	 * typed value and owns its own refusals (a non-secret gate, an empty value),
	 * which is why this handler does not re-ask what that path already answers.
	 *
	 * THE FOCUS HAND-OFF IS THE OPTION PATH'S, for the option path's reason: the
	 * field becomes `disabled` the moment the submit lands, so a keyboard user's
	 * focus drops to the document body without it (measured on the option path as
	 * `after-press: BODY`, UX round 3, U12). The restore effect below then puts
	 * it on the next question's field — or back in the composer — when the gate
	 * moves, by the same key-change trigger the option path arms.
	 *
	 * NO ECHO, like the option path and unlike a normal send: the transcript
	 * gains nothing from an answer, and for a secret that is the property that
	 * matters most (see `answerGateSecret`).
	 */
	const answerWithSecret = async (value: string) => {
		const gate = canonical.frontend?.pending_gate;
		if (!gate || !canonical.ownerEpoch || !sessionId) return;
		if (sendLock.held) return;
		const key = gateKeyOf(gate);
		const fromKeyboard =
			document.activeElement instanceof HTMLElement &&
			document.activeElement.closest("[data-ask-secret]") !== null;
		if (fromKeyboard) {
			restoreFocus.current = true;
			input.current?.focusInput();
		}
		setAdmitting(true);
		setAnswerState({
			key,
			sending: true,
			refused: null,
			retryable: false,
			muted: false,
		});
		setSendError(null);
		setSendErrorCode(undefined);
		let outcome: AnswerOutcome;
		try {
			outcome = await answerGateSecret(
				{
					gate,
					sessionId,
					epoch: canonical.ownerEpoch,
					value,
					lock: sendLock,
				},
				(request) => desktopResult(request),
			);
		} finally {
			setAdmitting(false);
		}
		settleGateAnswer(outcome, key);
	};
	/*
	 * THE QUEUED-ASK DOORS.
	 *
	 * Both post to the session's `/answers` route by `ask_id` and share the gate
	 * answer's lock, so one answer is in flight at a time across every surface of
	 * this session whichever shape it is - the property `answerGateOption`'s own
	 * note states as "one answer per question, whichever surface starts it".
	 *
	 * NO EPOCH, deliberately: a queued ask outlives the owner that queued it, and
	 * the route skips the epoch comparison for this shape (see `answerQueuedAsk`).
	 * Sending `canonical.ownerEpoch` here would not be harmless caution - it would
	 * be the one thing that breaks the feature's durability claim, because the
	 * client answering a reaped runtime's ask holds a stale epoch BY CONSTRUCTION.
	 *
	 * The refusal sentence is the OWNER's when it sent one. Every refusal in this
	 * family is a specific state (`expired`, `already answered by <surface>`,
	 * `already declined`) and only the backend can tell them apart, so this reads
	 * its words and falls back to the app's own sentence for the case where a
	 * refusal crossed the wire without one.
	 */
	/**
	 * Record what the owner said about an ask this panel just posted for.
	 *
	 * `changed` is the REVISION's own receipt (design round 1, D3; UX round 1, U3),
	 * and it is passed in rather than inferred here because only the caller knows
	 * which door the outcome came back through: a first answer, a decline and a
	 * revision share this function, the record and the refusal sentence, and the
	 * receipt is the one fact that belongs to the revision alone (a landed change
	 * leaves the row drawn from a frame the wire cannot mark — see `AskOutcome`).
	 */
	const settleAskOutcome = (
		taskId: string,
		outcome: AnswerOutcome,
		changed = false,
	) => {
		if (outcome.status === "failed") {
			setAskOutcomes((current) => ({
				...current,
				[taskId]: {
					sending: false,
					/*
					 * The OWNER's sentence when it sent one; the app's own, CHOSEN BY THE
					 * STATE the refusal reports, when it did not (agent review F5, QA rounds
					 * 1 and 2). The choice lives in `askRefusalSentence` because the
					 * fallback ARGUMENT of `userFacingMessage` is never consulted for a
					 * `DesktopControlError` - which is what made the first version dead.
					 */
					refused: askRefusalSentence(outcome.error),
					/*
					 * AND WHETHER THAT SENTENCE IS THE OWNER'S VERDICT, which is what may shut
					 * §10's change door (agent review round 2, minor): a transport failure
					 * reaches nothing, so it must not withdraw the affordance for the mount's
					 * life. Classified HERE, where the error is still in hand - the card and
					 * the chip only ever read the sentence.
					 */
					refusedByOwner: askRefusalIsOwner(outcome.error),
				},
			}));
			return;
		}
		setAskOutcomes((current) => ({
			...current,
			[taskId]: {
				sending: false,
				refused: null,
				...(changed ? { changed: true } : {}),
			},
		}));
	};
	const answerAsk = async (
		taskId: string,
		answers: Record<string, string[]>,
	) => {
		if (!sessionId || sendLock.held) return;
		setAdmitting(true);
		setAskOutcomes((current) => ({
			...current,
			[taskId]: { sending: true, refused: null },
		}));
		let outcome: AnswerOutcome;
		try {
			outcome = await answerQueuedAsk(
				{ taskId, answers, sessionId, lock: sendLock },
				(request) => desktopResult(request),
			);
		} finally {
			setAdmitting(false);
		}
		settleAskOutcome(taskId, outcome);
	};
	/*
	 * THE REVISION DOOR (design §10, #1936). A third sibling of the two above, sharing
	 * their lock and their outcome surface, because it is the SAME act on the SAME ask:
	 * the user is amending an answer that has not been delivered yet, so it must not
	 * race a first answer, a decline or another revision from any surface of this
	 * session.
	 *
	 * NO LOCAL WINDOW CHECK, deliberately. `delivered` is the wire's own hint and the
	 * response row is the real bound, so a client-side test would be a second opinion
	 * about a race this process cannot see - and §10 names the outcome that produces:
	 * accepted-and-then-dropped. The request goes, the owner answers, and its sentence
	 * (the delivered refusal is `already delivered — send a new message`) is what the
	 * card renders through `settleAskOutcome`, exactly like every other refusal here.
	 */
	const reviseAsk = async (
		taskId: string,
		answers: Record<string, string[]>,
	) => {
		if (!sessionId || sendLock.held) return;
		setAdmitting(true);
		setAskOutcomes((current) => ({
			...current,
			[taskId]: { sending: true, refused: null },
		}));
		let outcome: AnswerOutcome;
		try {
			outcome = await reviseQueuedAsk(
				{ taskId, answers, sessionId, lock: sendLock },
				(request) => desktopResult(request),
			);
		} finally {
			setAdmitting(false);
		}
		settleAskOutcome(taskId, outcome, outcome.status === "sent");
		/*
		 * THE RECEIPT (UX round 1, U3). The fleet pane already toasts this act
		 * (`Answer changed for <conversation>` — the conversation is the fact that
		 * surface alone knows); here the conversation is the one on screen, so the
		 * toast names the act and nothing else. Without it the two surfaces disagreed
		 * about confirming the SAME submit: the pane said so and the drawer said
		 * nothing, leaving the card's own receipt (below, in `AskPanel`) as the only
		 * trace on one side and a stale frame on the other.
		 */
		if (outcome.status === "sent") showSuccessToast("Answer changed");
	};
	const declineAsk = async (taskId: string) => {
		if (!sessionId || sendLock.held) return;
		setAdmitting(true);
		setAskOutcomes((current) => ({
			...current,
			[taskId]: { sending: true, refused: null },
		}));
		let outcome: AnswerOutcome;
		try {
			outcome = await declineQueuedAsk(
				{ taskId, sessionId, lock: sendLock },
				(request) => desktopResult(request),
			);
		} finally {
			setAdmitting(false);
		}
		settleAskOutcome(taskId, outcome);
	};
	/*
	 * THE MODE TOGGLE, and the draft swap it has to perform.
	 *
	 * The bar and the panel both call this rather than flipping a flag of their
	 * own, and the composer reads `askExpanded` - so there is one answer to "which
	 * mode is the user in" on the whole screen. The two buffers are the design's
	 * own invariant (§5.0): toggling preserves BOTH drafts, and neither may ever
	 * be sent into the other's channel. A chat draft that became an answer, or an
	 * answer sent as chat, is the accident this swap makes impossible rather than
	 * merely unlikely.
	 */
	/*
	 * MEMOISED, because it is a dependency of the Escape claim's effect below:
	 * a fresh closure per render would re-register the window listener on every
	 * render, and the claim would be a listener churn rather than a claim.
	 */
	/*
	 * THE SWAP FOLLOWS THE MODE, NOT THE TOGGLE (agent review round 3, F1).
	 *
	 * `askAnswering` - not `askExpanded` - is what the composer's mode means, and
	 * the buffers must exchange on THAT transition. Keying the swap on the toggle
	 * left a hole: when the last open ask settled under an OPEN panel (answered from
	 * the phone, declined, `late`), the mode silently flipped to chat, no swap ran,
	 * and the box still held the ask-buffer answer - so one Enter posted it to the
	 * conversation. That is the toggle's own stated invariant ("a chat draft must
	 * never become an answer and an answer must never be sent as chat") broken by the
	 * one path that did not go through the toggle.
	 *
	 * Every door - the bar, the panel's Escape, the queue emptying, a settle from
	 * another surface - now reaches the swap by moving this one flag.
	 *
	 * `setComposerText`, not `setCurrentInput`: only the revision-bumping writer
	 * makes the composer ADOPT store text (round 1's F1/Q-1/U1).
	 */
	const answeringRef = useRef(false);
	useEffect(() => {
		const was = answeringRef.current;
		answeringRef.current = askAnswering;
		if (was === askAnswering) return;
		const store = useConversationInputStore.getState();
		if (askAnswering) {
			chatBuffer.current = store.getCurrentInput(identity);
			store.setComposerText(identity, askBuffer.current);
		} else {
			askBuffer.current = store.getCurrentInput(identity);
			store.setComposerText(identity, chatBuffer.current);
		}
	}, [askAnswering, identity]);
	const toggleAskExpanded = useCallback(
		(next: boolean) => {
			if (next === askExpanded) return;
			setAskDrawerOpen(next, "session");
		},
		[askExpanded, setAskDrawerOpen],
	);
	/*
	 * THE COMPOSER'S ASK ROUTING (design §5.0).
	 *
	 * While the ask surface is expanded, what the user types in the composer is an
	 * ANSWER. It fills the FIRST unanswered question of the head ask and joins the
	 * draft the panel's own ticks write to, so the two doors cannot hold different
	 * versions of the same answer. The ask is submitted ATOMICALLY once every
	 * question has one: the wire refuses a partial map, and a partial submit that
	 * could only ever be refused is a control that lies.
	 *
	 * A SECRET question is SKIPPED. Its value is typed into the panel's masked
	 * field, which is the only place on this side a credential may live, so a
	 * composer Enter with one still open falls through to no send rather than
	 * putting a credential into an ordinary text box.
	 *
	 * Returns false WITHOUT sending when there is nothing to answer into, which
	 * leaves the user's text in the box - the alternative is swallowing a message
	 * they typed, which is the failure this whole feature exists to end.
	 */
	const sendToAsk = async (content: string): Promise<SendOutcome> => {
		const head = askQueueView(canonical.frontend).head;
		if (!head || !head.canAnswer) return false;
		const current = askDrafts[head.ask.ask_id] ?? EMPTY_DRAFT;
		const target = head.ask.questions.find(
			(question) =>
				!question.secret && (current[question.id] ?? []).length === 0,
		);
		if (!target) {
			/*
			 * EVERY QUESTION IS ANSWERED, so Enter does what `Send answer` does (UX
			 * round 3, U8). It used to be inert - the box kept the text and nothing
			 * was sent - which made the keyboard door quieter than the control beside
			 * it for the one state where there is nothing left to type.
			 */
			const complete = askAnswerMap(head.ask, current);
			if (complete === null) return false;
			await answerAsk(head.ask.ask_id, complete);
			return true;
		}
		const next = { ...current, [target.id]: [content] };
		setAskDrafts((drafts) => ({ ...drafts, [head.ask.ask_id]: next }));
		/*
		 * The box is consumed HERE rather than through the composer's echo seam:
		 * there is no echo, because nothing was sent to the conversation.
		 */
		askBuffer.current = "";
		useConversationInputStore.getState().setCurrentInput(identity, "");
		const answers = askAnswerMap(head.ask, next);
		// A question still unanswered: the draft is kept (the panel shows it) and
		// the ask is not submitted - the legacy incremental card's behaviour, with
		// the whole-ask body the new contract requires.
		if (answers === null) return true;
		await answerAsk(head.ask.ask_id, answers);
		return true;
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
	 * the next question takes focus — that question's first live option, or its
	 * masked field when the question is a secret one — and a gate that cleared
	 * hands it back to the composer.
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
			/*
			 * BOTH ANSWER SURFACES, ONE QUERY: a next question that is an ask takes
			 * focus on its first live option, and one that is a SECRET takes it on
			 * the masked field — the only control on such a card. The dock draws one
			 * surface or the other, never both, so this stays the "first live thing
			 * the next question offers" the option-only query was.
			 */
			'[aria-label="Answer options"] button:not([disabled]), [data-ask-secret] input:not([disabled])',
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
		/*
		 * THE PRESS'S OWN INSTANT, taken before the request leaves.
		 *
		 * It is what the reducer compares a killed call's `startedAt` against (`U7`),
		 * and the receipt's own arrival time would be the wrong clock: the round trip
		 * is tens of milliseconds on a healthy owner and seconds behind a busy one,
		 * while the interrupt acts on the press. A call that started inside that gap
		 * was killed by the press and would be missed by a receipt-stamped fact.
		 */
		const pressedAt = Date.now();
		/*
		 * WRITTEN AT THE PRESS, AND THE RECEIPT CAN ONLY TAKE IT BACK (UX round 2,
		 * U15).
		 *
		 * This fact is what the reducer reads when the killed call's END event lands
		 * (`killedByUserStop`), and that event is pushed by the daemon the moment the
		 * interrupt acts - while the receipt is the HTTP response to this request, which
		 * returns after the turn has wound down. Writing the fact from the receipt
		 * therefore loses a race the fact exists to survive: measured in the interrupt
		 * rig's Esc half, the ledger row read `Ran sleep 45 failed 0.1s` with
		 * `[data-stopped-turn]` already drawn beside it - the line proves the receipt
		 * did arrive `interrupted`, but the row's own classification had already been
		 * made, and the reducer never revisits a settled row.
		 *
		 * THE HONESTY CLAUSE IS THE RECEIPT'S OTHER ANSWER: a press the owner ran on a
		 * session that had nothing to interrupt must not reclassify the next genuine
		 * failure as the user's own doing, so an answer that is NOT `interrupted`
		 * clears the fact again. Between the press and that answer the fact stands - a
		 * window of one round trip, and the only window in which a call already running
		 * at the press can be told apart from one that failed on its own. A press that
		 * never gets an answer (`catch` below) leaves the fact until the next turn
		 * starts, which is the same door `clearTurnStopped` reads on `busy`.
		 *
		 * One visible consequence, stated rather than discovered: the Stop line and its
		 * Retry read this same fact, so they appear at the press rather than a round
		 * trip later, and vanish with the clear when the owner answers `idle`.
		 */
		markTurnStopped(sessionId, pressedAt);
		void interruptTurn(sessionId, crypto.randomUUID())
			.then((receipt) => {
				if (receipt.status !== "interrupted") clearTurnStopped(sessionId);
				setStopNotice(interruptNotice(receipt));
			})
			.catch((error) =>
				// Renders in the same composer alert as a failed send, so it takes the
				// same authored-copy rule. A receipt that never arrives is the one case
				// this control cannot report as a stop, so it does not: the turn is
				// still on screen and `busy` is still true, which is the honest state.
				setSendError(userFacingMessage(error, "Stop could not be confirmed.")),
			);
	}, [sessionId, interruptAvailable, markTurnStopped, clearTurnStopped]);
	/*
	 * The notice describes the LAST interrupt, so a turn that starts afterwards
	 * retires it: the sentence says a turn was stopped, and the next turn is not
	 * that turn. Cleared on `busy` becoming true rather than on a send, because a
	 * turn can also be started by an approval or a resume. While the interrupt is
	 * still settling `busy` is still true and this correctly does nothing.
	 */
	useEffect(() => {
		if (busy) {
			setStopNotice(null);
			/*
			 * AND THE STOPPED-TURN FACT GOES WITH IT (U7): the fact says "the turn you
			 * stopped ended this way", and the next turn is not that turn. Leaving it
			 * standing would classify the NEXT turn's killed-by-anything calls as the
			 * user's own stop.
			 */
			if (sessionId) clearTurnStopped(sessionId);
		}
	}, [busy, sessionId, clearTurnStopped]);
	/*
	 * ESCAPE MEANS COLLAPSE WHILE AN ASK IS EXPANDED, and this is where that claim
	 * is made (design §5.0's R7, agent review F2, UX round 1 U2).
	 *
	 * The composer's own sentence promises "Esc to collapse", and nothing claimed
	 * the key: the only Escape handler was on the panel's non-focusable div, which
	 * never sees a press made in the box. Worse, the press then fell through to the
	 * interrupt ladder - `ownsEscapeOutsideComposer` EXEMPTS the composer textarea,
	 * so `interruptEscapeApplies` was true and Esc in the box stopped the running
	 * turn while the panel stayed open. A queued ask exists precisely while a turn
	 * is live, so that was the common case, not an edge.
	 *
	 * THREE GUARDS, and each one answers a way the first version took a key that was
	 * not its to take (agent review N-2, UX round 2 U5):
	 *
	 *  - `pressLandsOnOverlay(event.target)` - the app's own predicate, imported
	 *    from `keyboard-scopes` rather than re-listed here, exactly as
	 *    `canvas/index.tsx` asks it for the same class of press. This is the
	 *    measured defect: with the panel expanded, Cmd-K then Escape collapsed the
	 *    ask panel and left the palette open, so the key fell to a surface that did
	 *    not have focus.
	 *  - `event.defaultPrevented` - the ladder's own claim signal. A surface that
	 *    already claimed the press keeps it.
	 *  - BUBBLE PHASE, not capture. Capture runs ahead of React's root listener and
	 *    of every element handler, so a React `onKeyDown` Escape (the aside panel,
	 *    the thread-search overlay) could never claim the key first; on the bubble
	 *    phase those run before this one and their `preventDefault()` is visible
	 *    here.
	 *
	 * `stopPropagation()` is GONE. On window it terminates the propagation path at
	 * the top, so nothing deeper ever saw the event - the shadowing in its purest
	 * form. It was never load-bearing for the ladder: the ladder stands down on
	 * `defaultPrevented` (it re-reads it one microtask after the dispatch), so
	 * `preventDefault()` alone is the whole claim.
	 *
	 * Collapsing is the only meaning: design §5.1 asks that Escape on a queued ask
	 * never carry an inherited blocking-card meaning, and stopping a turn stays
	 * available from the stop control while the panel is open.
	 */
	useEffect(() => {
		if (!askExpanded) return;
		const onKeyDown = (event: KeyboardEvent) => {
			/*
			 * The decision lives in `askClaimsEscape` so it can be exercised without a
			 * walk (agent review round 3, NIT-2): every guard in it is a defect this
			 * feature shipped, and it had only walk-through evidence.
			 */
			if (!askClaimsEscape(event)) return;
			event.preventDefault();
			toggleAskExpanded(false);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [askExpanded, toggleAskExpanded]);
	/*
	 * Escape is the control's accelerator, attached HERE because this component
	 * owns both halves the predicate reads - `busy` and `stop` - and the ladder it
	 * defers to is documented in the hook.
	 */
	useInterruptOnEscape({
		sessionId,
		busy,
		available: interruptAvailable,
		/*
		 * Rung 4's answer, read from the surfaces that record rather than
		 * inherited from `defaultPrevented` (UX round 1, U1): this listener runs
		 * before the composer's own claim, so the flag cannot be the guard on the
		 * trusted key path. `isDictationActive` is a live reader, so no re-render
		 * is needed when a recording starts.
		 */
		recording: isDictationActive,
		onInterrupt: stop,
	});
	/*
	 * THE READABLE FORM OF THE STARTING IDENTITY, and the lookup behind it.
	 *
	 * This is the target the two HUMAN sites on this pane read - the draft
	 * title (`New chat with …`) and the header's starting line - so a
	 * TEAM-sourced value resolves through the catalogue's label lookup while an
	 * agent name passes through untouched. The chain mirrors the raw one's
	 * precedence exactly (`||`, not `??`, keeps the wire's empty-string
	 * spelling of "unset" falling through) so the two can never name different
	 * profiles; only the words differ.
	 *
	 * The query is gated to the panes that can need it - a team draft, or a
	 * live stream that already named a team - and to the catalogue capability;
	 * everywhere else the slug is the string, which is exactly what these sites
	 * drew before labels existed.
	 */
	const draftTeamName =
		draft?.target?.kind === "team" ? draft.target.name : null;
	const liveTeamName = canonical.frontend?.active_team || null;
	const teamNames = useTeams(
		Boolean(draftTeamName || liveTeamName) &&
			desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	const teamLabelFor = useMemo(() => {
		const labels = new Map(
			(teamNames.data ?? []).map((row) => [row.name, teamDisplayName(row)]),
		);
		return (name: string) => labels.get(name) ?? name;
	}, [teamNames.data]);
	const loadedTargetDisplay =
		(liveTeamName ? teamLabelFor(liveTeamName) : "") ||
		canonical.frontend?.active_agent ||
		(draft?.target
			? draft.target.kind === "team"
				? teamLabelFor(draft.target.name)
				: draft.target.name
			: undefined);
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
	/*
	 * The name a conversation this window has DELETED wore when it went.
	 *
	 * The pane lands on its existing missing-session state for a deleted
	 * conversation (see `chat-content.tsx`), and that state still has to name WHICH
	 * conversation is gone - the row is out of the catalogue by then, so the store's
	 * tombstone is the only source left, and the alternative is a header reading
	 * "Untitled chat" over a delete (UX round 1, U1).
	 */
	const forgottenTitle = useCanonicalSessionsStore((state) =>
		sessionId ? state.forgotten[sessionId]?.title : undefined,
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
		draftTarget: loadedTargetDisplay,
		liveTitle: canonical.frontend?.conversation_title,
		// The row's own name, or - for a conversation this window has deleted - the
		// name that row wore when it went.
		catalogueTitle: boundRow?.title ?? forgottenTitle,
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
	 * WHETHER THE HEADER'S IDENTITY SLOT OFFERS THE TWO SWITCHERS, computed here
	 * because this is the component that owns the four facts the gate reads -
	 * the session identity, the canonical stream, the catalogue binding and the
	 * capabilities - and `headerIdentityControlsShown` states the rule once so
	 * the header never re-answers it from a subset.
	 *
	 * The live values and the binding ride along as ONE object: the header's
	 * controls and this pane's own fallback chain (see `loaded` above) must
	 * read the SAME two sources in the SAME precedence order, or the chip the
	 * user just left and the menu that replaced it could name different teams.
	 *
	 * `undefined` is the degradation path the brief names: a backend without
	 * `team_catalogue`, a draft, or a stream that never named an identity keeps
	 * today's plain description string - there is no half-built pair of dead
	 * controls in any of those states.
	 */
	const identityControls =
		sessionId &&
		headerIdentityControlsShown({
			hasSession: Boolean(sessionId),
			pending: identityPending,
			teamCatalogue: desktopFeatureEnabled(capabilities.data, "team_catalogue"),
			identityKnown: Boolean(loaded),
			streamLive: view.status === "live",
		})
			? ({
					sessionId,
					activeAgent: canonical.frontend?.active_agent ?? null,
					activeTeam: canonical.frontend?.active_team ?? null,
					boundAgent: boundRow?.binding?.agent ?? null,
					boundTeam: boundRow?.binding?.team ?? null,
				} satisfies HeaderIdentityData)
			: undefined;
	/*
	 * The failed send, assembled for the composer.
	 *
	 * Local state first, store second: `sendError` is this attempt's outcome and
	 * `draft.error` is the last one the store recorded, which survives a remount
	 * and so is what a user returning to the chat sees.
	 *
	 * THE DISCARD CONTROL AND THE CLAIM ARE BOTH GONE (review round 2, NIT). This
	 * comment described an `onDiscard` that was offered only while the store held a
	 * claim in `submittedText` - the released app's model, where a failed message was
	 * kept outside the composer and had to be restored or discarded. The proper
	 * version of that model is back (S4): a post-paint failure IS kept outside the
	 * composer - on the row the user can see, with its own sentence and remedies -
	 * so the control still has no subject (nothing to discard: `Edit` returns the
	 * payload, `Send again` replays it), and `submittedText` survives as the
	 * payload the row-line replays, not as something anybody has to release.
	 */
	/*
	 * THE PANE'S OWN `clearError` IS THE ONE ABOVE (main's `useCallback`, which the
	 * aside door hands to `useSlashDispatch`), and the copy that stood here was this
	 * branch's - the same two setters, a second identity. Removed by the fold: one
	 * page, one clearer, or the dispatch callback is rebuilt on every render.
	 *
	 * AND `activeError`/`activeErrorCode` ARE GONE WITH IT. They were main's (the
	 * composer alert read `sendErrorCode ?? draft.errorCode` through them), and in
	 * the merged flow nothing reads them: this branch classifies the failure once,
	 * in the store, and the pane renders the row's own copy.
	 */
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
	// Keyed on the LIVE binding only, never on `loadedTargetDisplay`: that falls back to
	// `draft?.target?.name`, which a draft staged from the agents page or `/agent`
	// already carries before any send is attempted. Reading it here made an
	// `unresolved_attachment` failure clear itself on the first render after the
	// failure - taking the explanation and both "Choose agent"/"Choose team"
	// remedies with it, on the very path where they are the only way out. A
	// pre-send intention is not evidence that the attachment resolved; only an
	// agent or team actually bound to the session is.
	const boundTarget =
		canonical.frontend?.active_team || canonical.frontend?.active_agent;
	/*
	 * The code the composer's notice classifies by - the LOCAL failure's when this
	 * pane raised one, the row's otherwise - stated once because two readers need it:
	 * the notice (`composerNoticeFor`) and the unresolved-attachment remedy below.
	 */
	const noticeCode = sendErrorCode ?? draft?.errorCode;
	const attachmentResolved =
		noticeCode === "unresolved_attachment" && Boolean(boundTarget);
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
	 * The validation window, and the notice that explains it.
	 *
	 * `validatingSessionId` is the stretch after a switch during which the
	 * target's existence is unconfirmed. The STORE owns the window and refuses a
	 * send inside it; these effects are the stream's half of that contract,
	 * because the store cannot see the stream - and since the click no longer
	 * issues a `sessions.get` guard read (see `openSession`), they are the ONLY
	 * bounds it has.
	 *
	 * - `confirmSessionLive` closes it on the stream's first snapshot, which is
	 *   the frame that paints the messages: the transcript and a composer that
	 *   sends arrive together, from one frame.
	 * - `confirmSessionMissing` closes it on the stream's 404, tombstoning the id
	 *   so the pane lands on the missing-session notice.
	 * - `windowOpen` is in the deps so a window opened over a stream that is
	 *   ALREADY live (the active row clicked while a draft is staged: the panel is
	 *   keyed on the session, so `canonical.status` does not change) is closed in
	 *   the same commit rather than left open with nothing to close it.
	 * - the refused send's notice retires on that same observable condition, the
	 *   way `attachmentResolved` retires its own: a sentence explaining a refusal
	 *   must not outlive the cause it names.
	 */
	const windowOpen = useCanonicalSessionsStore((state) =>
		isSessionUnvalidated(state.validatingSessionId, sessionId),
	);
	// A dependency of the held sends' settle effect below: leaving the
	// conversation is an answer for them (`abandoned`), and it has to be heard in
	// the commit that moves the view, not only when the pane unmounts.
	const viewOnThisSession = useCanonicalSessionsStore((state) =>
		viewIsOnThisSession(state, sessionId),
	);
	useEffect(() => {
		if (!sessionId || !windowOpen) return;
		const store = useCanonicalSessionsStore.getState();
		if (canonical.status === "live") store.confirmSessionLive(sessionId);
		else if (canonical.missing) store.confirmSessionMissing(sessionId);
	}, [sessionId, windowOpen, canonical.status, canonical.missing]);
	/*
	 * The held sends' side of the window (see `send`): each waiter is settled by
	 * the first observable answer - the window closing (`ready`, or `gone` when
	 * it was the 404 that closed it) or the stream giving up while it is still
	 * open (`failed`). Settled from an effect because that is where the stream's
	 * status becomes observable here; `awaitWindow` checks the same conditions
	 * synchronously first, so a waiter added after the answer cannot miss it.
	 */
	const settleWindowWaiters = (outcome: WindowOutcome) => {
		const waiters = windowWaiters.current.splice(0);
		for (const settle of waiters) settle(outcome);
	};
	/*
	 * `ready` is THIS PANEL'S OWN EVIDENCE, never merely "the window is no longer
	 * this session's" (agent review round 2, R2-F1). The two read the same while
	 * the user stays and differ exactly when they leave: `openSession(other)`
	 * moves `validatingSessionId` to `other`, which the old test read as this
	 * session being confirmed. On the measured orderings the unmount's
	 * `abandoned` won that race (`session-switch-latency.mjs --held-leave
	 * --leave-after=400`: 0 sends before and after this change), so this is the
	 * rule stated rather than a measured leak - the leak that DID reproduce is
	 * the one `send` guards before it reaches the window at all.
	 *
	 * So the view moving off this session settles the wait as `abandoned`
	 * without depending on which effect commits first, and `ready` additionally
	 * needs this panel's stream to be `live`, the frame `confirmSessionLive`
	 * closed the window on.
	 */
	const windowOutcome = (): WindowOutcome | null => {
		if (streamRef.current.missing) return "gone";
		if (!viewIsOnThisSession(useCanonicalSessionsStore.getState(), sessionId))
			return "abandoned";
		const status = streamRef.current.status;
		if (status === "unavailable") return "failed";
		if (
			isSessionUnvalidated(
				useCanonicalSessionsStore.getState().validatingSessionId,
				sessionId,
			)
		)
			return null;
		return status === "live" ? "ready" : null;
	};
	const awaitWindow = () => {
		const now = windowOutcome();
		if (now) return Promise.resolve(now);
		return new Promise<WindowOutcome>((resolve) => {
			windowWaiters.current.push(resolve);
		});
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: settles on the stream's answer, read through the ref
	useEffect(() => {
		if (windowWaiters.current.length === 0) return;
		const outcome = windowOutcome();
		if (outcome) settleWindowWaiters(outcome);
	}, [windowOpen, viewOnThisSession, canonical.status, canonical.missing]);
	// A held send whose pane unmounts (the user opened another conversation) is
	// abandoned rather than delivered into a conversation nobody is looking at.
	useEffect(() => {
		const waiters = windowWaiters.current;
		return () => {
			for (const settle of waiters.splice(0)) settle("abandoned");
		};
	}, []);
	useEffect(() => {
		if (windowOpen || sendErrorCode !== SESSION_UNVALIDATED_CODE) return;
		setSendError(null);
		setSendErrorCode(undefined);
	}, [windowOpen, sendErrorCode]);
	/*
	 * A MESSAGE THE PREVIOUS RELEASE HELD OUTSIDE THE COMPOSER COMES HOME.
	 *
	 * Run from the pane rather than from hydration, and once per row: the released
	 * app kept an unconfirmed message in a claim on the draft row with an explicit
	 * "Restore message" link, and an app that has removed that link must not strand
	 * one. Gated on the pane existing at all, which is what keeps a row for a
	 * DELETED conversation from resurrecting its draft into a live composer (risk
	 * R6) - a migration during hydration has no such fact available to it.
	 */
	useEffect(() => {
		if (!draftIdentity) return;
		migrateHeldClaim(draftIdentity, draft);
		/*
		 * AND THIS BUILD'S OWN FAILED ROW COMES BACK THE SAME WAY (S6).
		 *
		 * The registry is process state, so a reload has nothing retained, while
		 * the draft's claim fields - the request id, the text the row showed, the
		 * images - persist. Without this the conversation would be silently empty
		 * after a reload: the row was the message's home (S4), so it must be
		 * guaranteed to return. The released app's claim above still comes home to
		 * the COMPOSER - its rows carry no `errorRetry` and this build's adapter
		 * refuses them on exactly that fact.
		 */
		resynthesisePendingSend(draftIdentity, draft);
	}, [draftIdentity, draft]);

	/*
	 * THE AUTOMATIC RECONCILIATION: a message that was handed back turned out to
	 * have been delivered.
	 *
	 * The row the owner publishes is keyed by the request id (`appendPendingUser`
	 * says why), so a user record for that id that is NOT this app's own echo is
	 * the owner's - proof the message landed, whatever the app was told at the
	 * time. It arrives from any of the three routes the transcript has: the live
	 * stream, a reconnect replay, or the history page on the next open, which is
	 * what makes this work across a restart.
	 *
	 * Two answers, one comparison: a composer still holding exactly what was sent
	 * is emptied in silence (the user asked for it to go, and it went), and a
	 * composer edited since keeps every word of the edit and is told in one muted
	 * line that the earlier message arrived (see `reconcileDelivered`).
	 */
	const unresolvedRequestId =
		draft?.admissionAttempted && !draft.pending
			? draft.admissionRequestId
			: undefined;
	const settledByOwner = useCanonicalSessionsStore(() =>
		unresolvedRequestId
			? canonical.transcript.index.get(unresolvedRequestId)
			: undefined,
	);
	const ownerHasIt = useCanonicalSessionsStore(() => {
		if (!unresolvedRequestId) return false;
		const record = canonical.transcript.records[settledByOwner ?? -1];
		return record?.kind === "user" && !record.local;
	});
	useEffect(() => {
		if (!unresolvedRequestId || !ownerHasIt || !draftIdentity) return;
		useConversationInputStore.getState().reconcileDelivered(identity);
		/*
		 * AND THE PANE'S OWN NOTICE GOES WITH IT. Reconciliation is the app saying
		 * "that message arrived", so a "Couldn't confirm your message was sent."
		 * sentence still hanging over the composer is the app contradicting itself
		 * one line above the truth - measured in review round 1 (B4) as the notice
		 * that stayed up after the message was delivered, next to the Retry control
		 * whose press would then duplicate it.
		 */
		setSendError(null);
		setSendErrorCode(undefined);
		setSendErrorRetry(false);
		setSendErrorMuted(false);
		useCanonicalSessionsStore
			.getState()
			.finishDraft(draftIdentity, draft?.sessionId ?? sessionId ?? "");
	}, [
		unresolvedRequestId,
		ownerHasIt,
		draftIdentity,
		draft?.sessionId,
		sessionId,
		identity,
	]);

	/*
	 * The muted statement that a handed-back message was delivered after all. Read
	 * from the composer's OWN row rather than carried in local state, because the
	 * reconciliation that raises it can run while this pane is unmounted (a switch
	 * away and back, a restart): the row is the only place the fact survives, and
	 * without a reader here the sentence never rendered at all - which is how the
	 * live duplicate in review round 1 stayed invisible (B4).
	 */
	const lateDelivered = useConversationInputStore(
		(state) => state.inputByConversation[identity]?.lateDelivered,
	);
	/*
	 * THE PAYLOAD'S OTHER HOME, for U4: after `Edit` the text is back in the box,
	 * and the row's `Send again` would offer a second live press for the same
	 * message. Read from the same store `Edit` wrote to, so the comparison is
	 * against the box the user is looking at.
	 */
	const composerText = useConversationInputStore(
		(state) => state.inputByConversation[identity]?.currentInput ?? "",
	);
	/*
	 * §F3's PER-MESSAGE FAILURE STATE, addressed here because this page owns both
	 * halves of it: the row it is about (the draft's open claim, or the
	 * `undelivered` record a reconnect left behind) and the two doors its controls
	 * use - this component's `send`, and the composer handle.
	 *
	 * `recordId` is the address: the echo's own id, which is the id the durable
	 * row carries if the message ever lands, so the line can only attach to the
	 * row it is about. Whether that row is ON SCREEN is the pane's question
	 * (`chat-content.tsx` resolves it against the transcript).
	 *
	 * EVERY POST-PAINT FAILURE IS ONE OF THESE NOW (S4). The unknown class used to
	 * be the only one that kept its row (`unresolvedRequestId`); every class keeps
	 * it, and its `error` is the sentence the store classified while its
	 * `errorRetry` is the classifier's own verdict on whether a press can work -
	 * carried straight through, so the line and the table cannot drift.
	 */
	const deliveryTurn: {
		recordId: string;
		text: string;
		attachments: readonly string[];
		message?: string;
		retry?: boolean;
	} | null = !draft
		? null
		: draft.submittedText !== undefined &&
				(draft.error !== undefined || unresolvedRequestId !== undefined)
			? {
					recordId: unresolvedRequestId ?? draft.admissionRequestId,
					text: draft.submittedText,
					attachments: draft.submittedAttachments ?? [],
					message: draft.error,
					retry:
						draft.errorRetry ?? retryOfferedForFailureCode(draft.errorCode),
				}
			: (draft.undelivered ?? null);
	const undeliveredTurn = deliveryTurn
		? {
				recordId: deliveryTurn.recordId,
				message: deliveryTurn.message,
				retry: deliveryTurn.retry,
				/*
				 * DIMMED WHILE THE BOX HOLDS THIS EXACT PAYLOAD (UX round 1, U4): the row
				 * keeps its statement - the outcome may be unknowable - but one message
				 * does not get two live presses, and after `Edit` the composer's Send is
				 * the live one. Equality is against the same string `Edit` handed back, so
				 * the comparison is exact rather than trimmed: a box the user changed is a
				 * different message and the row's press is re-armed rather than dimmed.
				 */
				retryDisabled:
					composerText.trim().length > 0 && composerText === deliveryTurn.text,
				onSendAgain: () => {
					void send(deliveryTurn.text, [...deliveryTurn.attachments]);
				},
				onEdit: () => {
					/*
					 * The payload comes home, merged under the user's typing and refused while
					 * an attempt is in flight (`returnPayload`), so pressing Edit twice cannot
					 * double the message.
					 */
					useConversationInputStore.getState().returnPayload(identity, {
						text: deliveryTurn.text,
						attachments: [...deliveryTurn.attachments],
						replies: [],
					});
					/*
					 * AND A PROVABLY-NOT-DELIVERED ROW RETIRES WITH THE PAYLOAD. The user
					 * asked to edit the message, which means its row must go - otherwise the
					 * transcript shows it while the box shows the text to change. "Provable"
					 * is the store's own fact: `admissionAttempted` means "an admission was
					 * issued and its outcome is not known", so its absence is not_sent, or the
					 * ID itself being gone - classes the app knows never reached the session.
					 * An UNKNOWN outcome keeps its row deliberately: that message may have
					 * landed, and the row is its fate statement until the server resolves it.
					 *
					 * The retraction is LOCAL-ONLY (`retractLocalEcho`): if the owner's own
					 * row for this id arrived in between, it reports "owner" and removes
					 * nothing - the delivered-after-all race, lost gently.
					 */
					if (draft?.admissionAttempted !== true) {
						retractLocalEcho(identity, deliveryTurn.recordId);
						/*
						 * AND ITS SENTENCE GOES WITH IT (S6): the row was retracted, so the
						 * failure has no home left to state itself in - and the restart adapter
						 * re-synthesises exactly the rows that still carry one, so leaving it
						 * here would resurrect a row the user already retired on the next load.
						 *
						 * THE RESOLUTION'S OWN RECORD GOES WITH THEM (design review round 1,
						 * D2): `undelivered` names the row and the text, and the adapter now
						 * re-paints from it too - so an Edit that left it behind would
						 * resurrect the row on the next load by the same argument, one field
						 * further along.
						 */
						if (draftIdentity)
							useCanonicalSessionsStore.getState().updateDraft(draftIdentity, {
								error: undefined,
								errorCode: undefined,
								errorRetry: undefined,
								undelivered: undefined,
							});
					}
					input.current?.focusInput();
				},
			}
		: null;
	/*
	 * THE CLAIM ENDED, SO THE COMPOSER'S SENTENCE ABOUT IT ENDS (§F2's last
	 * bullet, UX round 1's U5b; restored with §F3's surface).
	 *
	 * Two things end a claim: the user's own press, and the SERVER's answer
	 * arriving through a reconnect. The first clears this component's state in
	 * its own handler; the second cannot - the re-subscribe writes the STORE,
	 * and this page only learns about it on the next render. Without this the
	 * notice kept stating a failure over a claim the server had already
	 * answered.
	 */
	const heldClaimLive =
		draft?.admissionAttempted === true && draft.pending !== true;
	const heldClaimWasLive = useRef(heldClaimLive);
	useEffect(() => {
		if (heldClaimWasLive.current && !heldClaimLive) {
			setSendError(null);
			setSendErrorCode(undefined);
			setSendErrorRetry(false);
			setSendErrorMuted(false);
		}
		heldClaimWasLive.current = heldClaimLive;
	}, [heldClaimLive]);
	/*
	 * AND THE LOCK'S OWN ANSWER GOES WHEN THE FLIGHT DOES (review round 4, M2 - also
	 * QA's Q4-1, the designer's D11 and UX's U16).
	 *
	 * The sentence a refused mid-flight press gets is a claim about a send that is
	 * still out, so it must not outlive the send. It used to be latched with nothing
	 * to retire it: the SUCCESS path deletes the draft row, so the reconciliation
	 * effect never runs, and the line stayed up under a transcript that already held
	 * the message - a screen telling the user their delivered message was still on
	 * its way. On a slow ordinary send (no failure, no hold long enough to trip the
	 * deadline) that stale claim is the common case, and it is what UX measured
	 * turning a follow-up into one glued row: with nothing saying the send finished,
	 * the next message was appended to the refused one and went out as a single row.
	 *
	 * Derived from the ROW's own `pending` rather than cleared per outcome, because
	 * the store already clears that on EVERY ending - a success (`finishDraft`
	 * removes the row), a failure, a delivery reconciled after the fact - so one
	 * condition covers them and a future ending cannot forget to retire the line.
	 */
	useEffect(() => {
		/*
		 * THE PREDICATE IS A FUNCTION, so it has a behavioural pin rather than a reading
		 * of this effect's source (review round 5, n5-2). The three terms are the three
		 * things that can hold a flight open: the row's `pending`, this pane's own
		 * `admitting` - which covers the window BEFORE an admission exists, where a press
		 * answered during image decode used to have its sentence retired in the same
		 * commit (m5-1) - and the approval gate, whose lock belongs to the question on
		 * screen rather than to any flight.
		 */
		if (
			!lockAnswerOutlived({
				rowPending: draft?.pending === true,
				admitting,
				gatePending: canonical.frontend?.pending_gate != null,
				muted: sendErrorMuted,
			})
		)
			return;
		setSendError(null);
		setSendErrorCode(undefined);
		setSendErrorRetry(false);
		setSendErrorMuted(false);
	}, [
		draft?.pending,
		admitting,
		canonical.frontend?.pending_gate,
		sendErrorMuted,
	]);
	/*
	 * MEMOISED FOR THE COMPOSER'S MEMO BOUNDARY (C1), with the registry read kept
	 * OUTSIDE the memo: `retainsPendingSend` reads a non-reactive registry, and the
	 * note below promises it is re-read every render — as a value it still is, and
	 * the memo only caches the notice object until one of those values moves.
	 * Without this the composer would take a fresh `sendError` object on every
	 * render of this page, which is once per stream flush.
	 */
	const pendingSendRetained = retainsPendingSend(identity);
	const notice = useMemo(
		() =>
			composerNoticeFor({
				error: sendError,
				code: sendErrorCode,
				retry: sendErrorRetry,
				muted: sendErrorMuted,
				/*
				 * THE ROW IS THE FAILURE'S HOME, SO THE COMPOSER DOES NOT RESTATE IT (S4).
				 * `retainsPendingSend` answers whether a ROW exists for this identity -
				 * MEMBERSHIP, not liveness, and the distinction is load-bearing since round
				 * 2: a recorded failure settles its claim in the store's own catch (U5),
				 * so the liveness predicate answers null for exactly the failures whose row
				 * is on screen, and this notice put the same sentence back over it
				 * ("Couldn't confirm your message was sent. Sending it again is safe.RetryClear"
				 * beside a row that already said it) - the contradiction J4 forbids,
				 * measured on the re-shoot's first run. The inputs go `undefined` rather
				 * than empty so `composerNoticeFor`'s own arms (the late-delivery note, the
				 * pre-paint copies) are untouched.
				 */
				rowError: pendingSendRetained ? undefined : draft?.error,
				rowCode: pendingSendRetained ? undefined : draft?.errorCode,
				rowRetry: pendingSendRetained ? undefined : draft?.errorRetry,
				lateDelivered,
			}),
		[
			sendError,
			sendErrorCode,
			sendErrorRetry,
			sendErrorMuted,
			pendingSendRetained,
			draft?.error,
			draft?.errorCode,
			draft?.errorRetry,
			lateDelivered,
		],
	);
	/*
	 * THE COMPOSER STANDS DOWN WHILE THE STRIP SPEAKS, for the one failure the
	 * strip's own sentence already covers (§F2's "one root cause, one Retry"; the
	 * same rule the sidebar's caption follows, D30). RESTORED WITH §F3
	 * (agent review round 4's R17, reconciling the connection-drop rig's
	 * single-voice checks with the composer rework): the failed message states its
	 * own fate ON ITS ROW (`Not delivered · Send again · Edit`) and its payload is
	 * in the box, so a "Couldn't reach Local Operator" sentence here was a second
	 * telling of the strip's own fact, with a second Retry repeating the row's
	 * `Send again`. Withheld for the TRANSPORT failure only - the arm whose
	 * sentence restates the connection. A refusal the daemon itself answered (the
	 * credential strip's state, D29's scene) keeps the composer's notice, because
	 * that sentence is about the app's attempt rather than the connection's
	 * absence, and its `Retry` is that state's own remedy.
	 */
	const composerSendError = useMemo(
		() =>
			notice &&
			!(
				stripSpeaksConnection &&
				notice.code === DESKTOP_REFUSAL_CODE.transportFailed
			)
				? {
						...notice,
						actions: undefined,
						/*
						 * The composer's Send, which is the whole of Retry: pressing it replays
						 * an unchanged payload under its own request id, and sends an edited one
						 * as a new message. See `admitChatDraft`'s replay rule.
						 *
						 * FOCUS COMES BACK TO THE BOX, because the control that was pressed is
						 * about to unmount: with the press accepted, the notice goes and the
						 * button that owned the focus goes with it, and the browser hands the
						 * caret to the document - measured in review round 1 (U5) as the next
						 * Enter collapsing a sidebar section, because the caret had landed on the
						 * sidebar's own toggle. Clear did this and Retry did not.
						 */
						onRetry: () => {
							input.current?.submitNow();
							input.current?.focusInput();
						},
						onClear: () => {
							if (identity)
								useConversationInputStore.getState().clearComposer(identity);
							clearError();
							if (draftIdentity)
								useCanonicalSessionsStore
									.getState()
									.discardDraft(draftIdentity);
							input.current?.focusInput();
						},
						/*
						 * Editing dismisses the notice, and must clear the STORE's copy too -
						 * `draft.error` outlives local state, so clearing only `sendError` would
						 * leave the message hanging over text the user has since fixed, which is
						 * the exact defect being replaced.
						 *
						 * It clears the SENTENCE and nothing else. The claim
						 * (`admissionAttempted`, the request id, the pinned payload) is a fact
						 * about a request that may already be executing on the owner, and a
						 * keystroke is not evidence about that: an edit followed by Send is a
						 * NEW message under a new id (the replay rule), and if the first one
						 * landed after all, the reconciliation says so.
						 */
						onDismiss: () => {
							clearError();
							if (draftIdentity && draft)
								useCanonicalSessionsStore
									.getState()
									.updateDraft(draftIdentity, {
										error: undefined,
										errorCode: undefined,
									});
						},
					}
				: undefined,
		[notice, stripSpeaksConnection, identity, draftIdentity, draft, clearError],
	);

	/*
	 * THE SESSION'S READINGS, MEMOISED (C1). The composer subtree is memoised and
	 * this page re-renders at stream-flush cadence, so the object handed to the
	 * composer as `sessionStatus` has to keep one identity across flushes that
	 * change nothing in it. Frozen on the values it is built from; the draft arms
	 * in the markup below stay inline, because a resolving preview rebuilds them
	 * and that is not the streaming-answer state this boundary exists for.
	 */
	const liveSessionStatus = useMemo(
		() =>
			sessionId
				? {
						/*
						 * The live snapshot when there is one, and otherwise the readings
						 * this pane was last told.
						 *
						 * A reconnect is answered with `open{gap}`, which drops the
						 * authoritative frontend by design, so `canonical.frontend` was
						 * null for the whole 1.5-4 s the replacement snapshot took to land
						 * - and a null frontend is exactly what makes the strip render
						 * nothing at all (its own first line). So all four readings
						 * blanked and came back at the stream's cadence, which reads as
						 * the conversation reloading from scratch.
						 *
						 * The fallback is honest rather than convenient: `heldFrontend`
						 * is dropped by every terminal state and by a real session change,
						 * so it can only be non-null here while a reconnect is genuinely
						 * in flight - and the pane already says so in its own words,
						 * because the same state publishes `status: "reconnecting"` and
						 * the transcript paints its Reconnecting line.
						 */
						frontend: canonical.frontend ?? canonical.heldFrontend,
						/*
						 * Whether those readings are the HELD ones, which is a
						 * different question from whether a frontend is present:
						 * a pane that has never had a snapshot and a pane drawing
						 * the one it was last told both arrive here with a null
						 * `canonical.frontend`, and only the second is a state the
						 * reader needs told about. So it is the fallback actually
						 * being the source, not the null.
						 */
						held:
							canonical.frontend === null && canonical.heldFrontend !== null,
						/*
						 * Whether the readings were DROPPED at a spent budget rather
						 * than never painted (task-17, U4): the strip leaves one
						 * sentence where it was, so the values the reader was
						 * watching do not vanish without one.
						 */
						readingsDropped: readingsDroppedFor === sessionId,
						/*
						 * The chosen-but-unconfirmed model, so the strip can paint the pick
						 * the moment it is made instead of waiting out a cold runtime bind
						 * (latency U1). Straight off the handle, which owns both the paint and
						 * its reconciliation with the authoritative frames.
						 */
						pendingModel: canonical.pendingModel,
						/*
						 * `dispatchFromControl`'s STABLE WRAPPER, not `dispatch`: a chip has no
						 * fallback path to report a failure the way typed text does, so an
						 * unconsumed outcome has to be surfaced here rather than dropped into a
						 * `void` (round 1, U2).
						 */
						onCommand: (invocation: SlashCommandInvocation) =>
							void stableDispatchFromControl(invocation),
						/*
						 * The SAME query `EffortPicker` renders from, by the
						 * same key, so React Query serves both from one cache
						 * entry and the chip cannot offer a rung the picker
						 * would then refuse (round 1, U3).
						 */
						effortEntities: effortEntities.data?.entities,
					}
				: undefined,
		[
			sessionId,
			canonical.frontend,
			canonical.heldFrontend,
			readingsDroppedFor,
			canonical.pendingModel,
			stableDispatchFromControl,
			effortEntities.data,
		],
	);

	/*
	 * THE DEVICE HOLD ELEMENT, MEMOISED — and it is load-bearing for the same
	 * reason the freezes above are (C1). This is an ELEMENT, and an inline
	 * `{<ChatDeviceHold .../>}` in the JSX below rebuilds its object once per
	 * render of this page — which is once per stream flush — so it would hand
	 * the composer's memo boundary a fresh prop per flush and re-render the
	 * whole box again. Frozen on the session it reads, the one thing this
	 * element's props change with; the child's own store subscriptions still
	 * repaint it on their own schedule.
	 */
	const deviceHold = useMemo(
		() => <ChatDeviceHold sessionId={sessionId ?? undefined} />,
		[sessionId],
	);

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
					/*
					 * THE DEVICE CONTROL'S TWO SURFACES, composed here because this is the one
					 * place that knows both halves of the pane's identity: the live `sessionId`
					 * and the `draftKey` a new chat is keyed on. Everything else they need -
					 * the draft's own destination, this pane's move outcome, the mesh's reads -
					 * is read inside them from the store that owns it.
					 */
					deviceSlot={
						<ChatDeviceSlot
							sessionId={sessionId ?? undefined}
							draftKey={draftKey ?? undefined}
						/>
					}
					deviceNotice={<ChatDeviceNotice sessionId={sessionId ?? undefined} />}
					deviceHold={deviceHold}
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
								? (loadedTargetDisplay ?? "Starting the session")
								: draft?.sessionId
									? canonical.frontend?.cwd || cwd || "Canonical chat"
									: /*
										 * A DRAFT WITH NO SESSION STATES WHERE IT WILL RUN, NOT WHAT IT
										 * WILL DO (§H, U23). This slot held "The session starts when you
										 * send your first message." - the same promise the deleted
										 * "Nothing starts until you send" made, on a screen that now has
										 * somewhere to type - and at 1380 it did not even survive: the
										 * header clipped it mid-word ("...tarts when you send your first
										 * message.", the launch frame of the empty-state set). The path is
										 * what the slot exists for: the pane's second surface answering
										 * "where am I" (the comment below says so for the live arm), and
										 * the composer's chip shows the same directory one line under it.
										 * With no directory known yet the slot says nothing - an empty string,
										 * which is what the header's `description` prop takes; `undefined`
										 * would fall back to the component's own default sentence.
										 */
										canonical.frontend?.cwd || cwd || ""
							: /*
								 * LIVE: the value the chip paints, not `canonical.frontend?.cwd`.
								 *
								 * The header is the second surface a user reads to answer "where am I",
								 * and while a move is in flight it is the chip that holds the pending
								 * value; reading the canonical stream here made the two disagree for the
								 * whole restart - the header on the old directory while the receipt in the
								 * transcript said the session had moved (UX review U3). `live.cwd` is
								 * `pending ?? stream`, so the two surfaces cannot disagree by construction.
								 *
								 * With no directory known the line is HELD BLANK rather than filled
								 * with "Canonical chat" (design round 1, D2). That fallback is an
								 * internal token, and it surfaced exactly where the header matters
								 * most: a stream that failed before its first snapshot, where
								 * `identityPending` lets go of the skeleton (a pulse over a failed
								 * pane would claim a load in progress) and the transcript below is
								 * already stating the connection loss with its Reconnect. A
								 * no-break space keeps the `text-body-sm` line box, so the title does
								 * not jump the 3.8 px the skeleton-to-text swap measured.
								 */
								live.cwd || HELD_DESCRIPTION_LINE)
					}
					descriptionPending={identityPending}
					identity={identityControls}
					/*
					 * THE INLINE RENAME'S SESSION (operator's report, 2026-09-26), on the
					 * same gate the old pencil-door had. The header runs the write path
					 * itself now (`sessions.command` `rename` through `useSessionCommand`,
					 * the same command `RenamePicker` submits), so the page hands it the
					 * session rather than a callback - while the door this replaced is
					 * still `/rename`'s for the surfaces that keep the picker: bare
					 * `/rename` is answered by the BACKEND's empty-args rule
					 * (`local_operator/server/routes/desktop_sessions.py` returns a
					 * `native_action` for the word with no arguments), and the
					 * dispatcher's `isNativeAction` branch mounts the registry's picker for
					 * that destination.
					 *
					 * `dispatchFromControl` stays this page's wrapper for the controls that
					 * still dispatch (the options row, the directory chip), which is what
					 * turns the commands-off `"not-a-command"` into the composer's own
					 * failure note; the header's editor reports failures through the app's
					 * toast channel instead (see `chat-header.tsx`). GATED on the command
					 * surface being enabled, so with that capability off the header omits
					 * the affordance instead of rendering it dead; omitted on a draft
					 * through the same `sessionId` test, because a conversation that does
					 * not exist yet has no name to change.
					 */
					renameSessionId={
						sessionId && desktopFeatureEnabled(capabilities.data, "commands")
							? sessionId
							: undefined
					}
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
					onSendMessage={stableSend}
					/*
					 * The SAME dispatcher the chips use, handed the planner's own answer (an
					 * invocation, never the draft) with its outcome handed back: the composer
					 * must know whether the command ran before deciding what the box holds
					 * afterwards, and a failure must report through this path's own note
					 * rather than a second copy of its sentence (round 2, Q-7's contract).
					 */
					onSlashCommand={stableDispatchFromControl}
					onSlashNote={slashNote}
					/*
					 * The pane's answer to the dispatcher's own question, handed to the
					 * composer so its arming copy and the popup's cannot promise a run this
					 * pane will refuse (UX U1 / design D3).
					 */
					paneHasSession={paneHasSession}
					sendError={composerSendError}
					undelivered={undeliveredTurn}
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
							? liveSessionStatus
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
										/*
										 * A MODEL IS RESOLVED FOR THIS DRAFT, and that is the fact the
										 * composer's send is gated on (UX round 1, U1): this branch is taken
										 * exactly when the preview's answer has arrived, and the branch below
										 * is the one that runs while it has not. One value, read by the strip
										 * as its readings and by the composer as its send gate, rather than
										 * two derivations of "has this draft a model" that can disagree.
										 * (The payload is deliberately not spelled out in a comment here:
										 * the composer suite proves it reaches the strip and nowhere else
										 * by reading every occurrence of its accessor, and a comment naming
										 * it would fail a guard that is doing its job.)
										 */
										draftResolved: true,
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
											/* No snapshot and no reading: the draft's model is NOT resolved. */
											draftResolved: false,
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
					onComposerInput={onComposerInput}
					mcpServers={mcpServers}
					mcpGrantRunning={mcpGrantRunning}
					mcpRemedy={mcpRemedy}
					monitorControls={monitorControls}
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
						startingSession,
						/*
						 * THE ROW'S ANCHOR, THEN THE ENTRY'S, THEN THE LATCH'S (agent review
						 * round 2, R2-5): the draft row is deleted at the receipt while the
						 * latch may still hold (round 1's MINOR), and a switch-away inside
						 * that gap remounts with NEITHER the old latch nor the row - so the
						 * retained entry carries the press's own number and the seconds
						 * survive that remount too.
						 */
						startingSince:
							draft?.submittedAt ??
							pendingNow?.submittedAt ??
							admitted.current?.submittedAt ??
							null,
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
						/*
						 * The secret field's own door, wired the same way and to the
						 * matching machinery (`answerWithSecret` -> `answerGateSecret`):
						 * the same lock, the same report, the same one-answer-in-flight
						 * property as the options above. Separate props because the two
						 * answer paths refuse different things; see `QuestionDockProps`
						 * for why the split is at the component boundary and not inside
						 * the dock.
						 */
						onAnswerSecret: (value: string) => void answerWithSecret(value),
						answer: answerForThisGate,
						/*
						 * The queued-ask doors. Forwarded by id, because that is the identity the
						 * panel addresses and the only one an ask keeps across a runtime restart
						 * (see `askOutcomes` above for why this is a record of its own).
						 */
						onAnswerAsk: (taskId: string, answers: Record<string, string[]>) =>
							void answerAsk(taskId, answers),
						onDeclineAsk: (taskId: string) => void declineAsk(taskId),
						onReviseAsk: (taskId: string, answers: Record<string, string[]>) =>
							void reviseAsk(taskId, answers),
						askOutcomes,
						/* The ask-mode lane: the flag, its door, the shared draft, and
						 * the composer's own sentence for the expanded state. */
						askExpanded,
						onAskToggle: toggleAskExpanded,
						askDrafts,
						onAskDraftChange: (askId: string, next: AskDraft) =>
							setAskDrafts((drafts) => ({ ...drafts, [askId]: next })),
						askComposerPlaceholder: askAnswering
							? ASK_COMPOSER_PLACEHOLDER
							: undefined,
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
	/*
	 * WHETHER THE STRIP OWNS THE CONNECTION VOICE, read here for the CATALOGUE
	 * error only (agent review round 2, R11).
	 *
	 * The pane states a lost server as the store's catalogue failure - the
	 * transport's own sentence, which is what the walker's before-run photographed
	 * as the bare alert at the top of the pane - and the strip, one element down in
	 * this very tree, states the same fact with the right copy and the one Retry.
	 * The shared predicate carries the strip's presence beside the copy condition
	 * (`chat-status-presence.ts`), so this stands down exactly where the strip has
	 * taken the voice.
	 */
	const stripSpeaksConnection = useStripSpeaksConnection(
		serverHealth?.online === false,
	);
	const pairingCause =
		serverHealth?.snapshot && !serverHealth.snapshot.pairing.available
			? (serverHealth.snapshot.pairing.cause ?? "unpaired")
			: null;
	const pairingSentence = backendPaneSentence(catalogueState, pairingCause);
	/*
	 * AND WHETHER THE COMPATIBILITY BANNER OWNS THE SAME FACT (QA round 1, Q-1).
	 * The strip is silent for the four causes the banner carries (§ 0.1), so in
	 * exactly those states the store's catalogue error had no stand-down left and
	 * came back beside the banner: measured in the successor walk, a replacement
	 * that refuses this app's credential rendered the pane's own sentence
	 * (`This app's credential … was refused …`) directly under the banner's
	 * successor sentence - one incident, two statements. The banner's own
	 * predicate is the one to read (it renders unless the plane is available and
	 * every feature is advertised), so the pane cannot drift from what the banner
	 * actually draws.
	 */
	const coveredByCompatibilityBanner = compatibilityBannerShown(
		capabilities.data,
		pairingCause,
	);
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
	/*
	 * THE ROW, RESOLVED BY BELONGING (UX round 2, U5): `draftKey` answers "is a
	 * staged draft the view" - it is null on a pane reached by the session's own
	 * route - while the failure's sentence and controls live on the row the send
	 * wrote, which on a refused first send is the staged `draft:<uuid>` the
	 * conversation began as. `paneDraftKey` is the same resolver `send` and
	 * `SessionPanel` read, so the row that renders and the row a retry replays
	 * cannot be two.
	 */
	const draftRow = useCanonicalSessionsStore((state) =>
		/*
		 * `active` rather than the derived `id` below: both answer the same when no
		 * draft is staged (this resolver's fallback arm is only reached then), and
		 * `id` is computed further down from the row this read is what finds.
		 */
		paneDraftKey(draftKey, state.activeSessionId, state.drafts),
	);
	const draft = useCanonicalSessionsStore((state) =>
		draftRow ? state.drafts[draftRow] : undefined,
	);
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
	/*
	 * THERE IS NO `select` HERE ANY MORE, and its absence is the change rather than
	 * an omission: the sidebar's rows used to call back into this route so that the
	 * route could clear its own sentence before switching. The one sidebar is
	 * mounted above the routes now (`app.tsx` -> `chat-layout.tsx` ->
	 * `sidebar-navigation.tsx`), so a row calls `openConversation` itself - the same
	 * function the command palette and the `/chat` rebind use - and the clearing it
	 * used to do is the route's own effect: it fires on the draft key and on the
	 * route identity, and a switch moves both.
	 */
	// Keyed on the SESSION once one exists, so admitting a draft does not unmount
	// the panel mid-send. The rule and its reasoning live in `panelIdentityFor`;
	// `panelSessionIdOfView` is the id this pane reads, extracted so a surface
	// that is NOT this pane - the command palette's close-time restore, which
	// yields when a pick moved the view - can ask for the same key without keeping
	// a second copy of the expression that computes it.
	const id = panelSessionIdOfView(draftKey, draft?.sessionId, active);
	const identity = panelIdentityFor(draftKey, id);
	return (
		<div className={cn("flex h-full min-h-0 flex-col")}>
			{/*
			 * ONE sentence above the panel: a legacy route that names no
			 * conversation, or a store failure the composer does not own. A
			 * switch no longer has a failure of its own to state here - the
			 * target pane speaks for its own stream (see `openSession`).
			 *
			 * TWO FAILURES, ONE REGION, AND ONLY ONE OF THEM YIELDS (§F2, R11).
			 *
			 * `routeError` is a NAV fact - this conversation is not on this machine,
			 * the route did not resolve - and the strip does not state it, so it always
			 * renders. `error` is the store's catalogue failure, which for a dead
			 * backend IS the connection fact the strip owns; while the strip speaks,
			 * this half stands down so one press of Retry is not offered twice for one
			 * root cause. AND WHERE THE STRIP IS SILENT BUT THE COMPATIBILITY BANNER IS
			 * UP (QA round 1's Q-1), the banner owns the fact instead: the store's
			 * sentence is the same incident the banner is stating, so this half stands
			 * down to it as well.
			 */}
			{(routeError ||
				(error && !stripSpeaksConnection && !coveredByCompatibilityBanner)) && (
				<p role="alert" className={cn("px-4 py-2 text-body-sm text-danger")}>
					{routeError || error}
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
						{/*
						 * THE LOADING SENTENCE CARRIES THE REASSURANCE (task-17, U3).
						 * This pane is the whole chat surface for the length of the
						 * capabilities handshake, composer included, so a reader with a
						 * conversation open and nowhere to type cannot tell "the app is
						 * dialling its server" from "your conversation is gone". The
						 * clause states the one fact true of the wait: the conversation
						 * itself is untouched while the backend is being reached.
						 */}
						{capabilities.isLoading
							? "Connecting to the backend… Your conversation is safe."
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
				/*
				 * THE "Start a chat" SCREEN IS DELETED (§H, U1 and U23), and what is left
				 * here is the residue rather than the screen: launch lands on the empty
				 * state with the composer docked and focused, because the store's own
				 * hydration seeds a draft when there is nothing to restore
				 * (`launchDraftSeed`), so a cold start has an identity before the first
				 * paint and never reaches this arm.
				 *
				 * The one state that still can is a LEGACY LINK (`/chat/:agentId`) whose
				 * conversation this machine does not have: the state effect above sets
				 * `routeError` and the sentence for it renders at the top of this pane, so
				 * the pane is not empty and re-staging a draft unasked would be the app
				 * answering a question the user did not ask while also clearing that
				 * sentence (the draft-key effect owns its lifetime). A bare `New chat`
				 * control remains, without the deleted heading or its promise - the
				 * affordance that state actually needs, and nothing else.
				 */
				<div className={cn("p-6")}>
					<button
						type="button"
						className={cn("rounded-md border border-control px-3 py-2")}
						onClick={() => stage(undefined, true)}
					>
						New chat
					</button>
				</div>
			)}
		</div>
	);
}
