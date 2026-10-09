import { BrowserPane } from "@features/browser/components/browser-pane";
import { useConversationApprovals } from "@features/browser/hooks/use-conversation-approvals";
import { ConsolePane } from "@features/console/components/console-pane";
import { useConsoleBlipPulse } from "@features/console/hooks/use-console-attention";
import { useProviderStatus } from "@features/providers/use-provider-status";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { BackendCompatibilityBanner } from "@shared/components/common/backend-compatibility-banner";
import { PaneSlot } from "@shared/components/common/pane-slot";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import {
	type ComposerSendError,
	MessageInput,
	type MessageInputHandle,
} from "@shared/components/composer/message-input";
import { PanelRail } from "@shared/components/navigation/panel-rail";
import { InPanelRailHost } from "@shared/components/navigation/panel-rail-host";
import { TabPanel } from "@shared/components/ui";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import type { SendOutcome } from "@shared/hooks/use-message-input";
/*
 * The mode-dependent classes on the canvas's wrapper below are the first
 * conditional class list in this file: every other one is a literal. `cn` rather
 * than a duplicated literal prefix, because the two modes share seven of their
 * eight classes and a copy is what drifts when one of them changes.
 */
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import {
	BROWSER_PANEL_MIN_PX,
	CONSOLE_PANEL_MIN_PX,
	DEFAULT_RIGHT_SLOT_WIDTH,
	EMPTY_RIGHT_SLOT_ROUTE,
	RUN_PANEL_MIN_PX,
	resolveRightSlotOccupied,
	resolveRightSlotWidth,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { useQueryClient } from "@tanstack/react-query";
import React, {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type CanonicalFrontendState,
	type CanonicalModel,
	goalCapability,
	goalPresent,
} from "../../../../../shared/desktop-session-contract";
import { gateIsSecret } from "../ask-answer";
import type { AskDraft, AskOutcome, AskScope } from "../ask-queue";
import {
	askComposerHoldsSecret,
	askQueueView,
	effectiveGate,
} from "../ask-queue";
import { CanonicalTranscript } from "../canonical/canonical-transcript";
import type { UndeliveredTurn } from "../canonical/canonical-transcript";
import {
	canonicalTranscriptSpeaks,
	canonicalTranscriptTerminal,
} from "../canonical/transcript-pane";
import { useMentionedFiles } from "../canonical/use-mentioned-files";
import {
	workingLineClaimed,
	workingLineInputFor,
} from "../canonical/working-line-model";
import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "../chat-measure";
import {
	CANVAS_PANE_MIN_PX,
	CHAT_PANE_MIN_PX,
	canvasDockWidth,
	canvasPaneMode,
	rightSlotDividerContract,
} from "../chat-sidebar-layout";
import type {
	DraftPickerDestination,
	DraftResolution,
} from "../draft-selection";
import { useFleetAsks } from "../fleet-asks";
import type { Message } from "../types/message";
import { useAskOpenPolicy } from "../use-ask-open-policy";
import { AskDrawer } from "./asks/ask-drawer";
import { Canvas } from "./canvas";
import { documentsForCanvas } from "./canvas/document-buffers";
import { tabFollowingClose } from "./canvas/tab-selection";
import { ChatHeader } from "./chat-header";
import type { HeaderIdentityData } from "./chat-header-identity";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import { ChatStatusStrip } from "./chat-status-strip";
import {
	CHAT_TAB_IDS,
	CHAT_TAB_PANEL_IDS,
	type ChatTabValue,
	ChatTabs,
} from "./chat-tabs";
import { DEFAULT_MESSAGE_SUGGESTIONS } from "./composer-suggestions";
import { DeleteConversationDialog } from "./delete-conversation-dialog";
import type { DirectoryWritePath } from "./directory-indicator";
import { RawInfoView } from "./raw-info-view";
import { type McpServerRow, type RunDetails, RunPanel } from "./run-details";
import type { McpRemedyControls } from "./run-details/use-mcp-remedy";
import type { MonitorControls } from "./run-details/use-monitor-controls";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";
import { QuestionDock } from "./trace/question-dock";

/**
 * Props for the ChatContent component
 */
type ChatContentProps = {
	activeTab: "chat" | "raw";
	onTabChange: (tab: "chat" | "raw") => void;
	agentName: string;
	description: string;
	/** Held, not filled, until some source names the identity; see `ChatHeaderProps`. */
	descriptionPending?: boolean;
	/**
	 * The live session's identity for the header's two switchers; see
	 * `ChatHeaderProps.identity`. Passed straight through from the page (which
	 * owns the gate and the canonical stream), so this component never derives
	 * an identity question it cannot answer.
	 */
	identity?: HeaderIdentityData | null;
	/**
	 * The chat header's device control, composed by the page that owns the session
	 * and the draft; see `ChatHeaderProps.deviceSlot`, which explains why the header
	 * takes a node rather than the facts behind it.
	 */
	deviceSlot?: React.ReactNode;
	/**
	 * What the last move did, in the row under the header's band.
	 *
	 * A SEPARATE SLOT BECAUSE IT IS A SEPARATE PLACE: the chip answers "where does
	 * this run" in the title block, and the outcome of one move is a line under the
	 * header, where the transcript begins. Both are composed from ONE store keyed by
	 * this pane, so the two cannot disagree about what happened.
	 */
	deviceNotice?: React.ReactNode;
	/**
	 * The composer's hold during a move (§2.4), composed by the page from the same
	 * store as `deviceNotice`: the notice says what the move is doing under the
	 * header, the hold says it in the one place a user is about to type.
	 */
	deviceHold?: React.ReactNode;
	/**
	 * The session the header's inline rename writes to; see
	 * `ChatHeaderProps.renameSessionId`. Passed straight through from the page
	 * (which owns the `commands` capability gate), so this component never
	 * answers a capability question it cannot see.
	 */
	renameSessionId?: string;
	onOpenOptions: () => void;
	isOptionsSidebarOpen: boolean;
	onCloseOptions: () => void;
	agentId: string;
	messages: Message[];
	isLoading: boolean;
	isLoadingMessages: boolean;
	isFarFromBottom: boolean;
	hasNewActivity?: boolean;
	messagesContainerRef: React.RefObject<HTMLDivElement>;
	scrollToBottom: () => void;
	rawInfoContent: string;
	onSendMessage: (
		content: string,
		attachments: string[],
		/** See `MessageInputProps.onSendMessage` - the echo seam's paint callback. */
		onEchoPainted?: () => void,
		/*
		 * Passed straight through to the page's `send`. See `MessageInputProps`
		 * for why the typed text travels beside the composed payload: the gate
		 * answer path must resolve an option ordinal against what the user typed,
		 * not against a payload a staged reply has already wrapped.
		 */
		typed?: string,
		/**
		 * See `MessageInputProps.onSendMessage` - the seam between the session
		 * being created and the message being admitted, which is where a
		 * credential handed over in a conversation's first message is stored.
		 */
		beforeAdmission?: (sessionId: string) => Promise<string | undefined>,
	) => SendOutcome | Promise<SendOutcome>;
	currentJobId: string | null;
	onCancelJob: (jobId: string) => void;
	agentData?: AgentDetails | null;
	messageInputRef?: React.Ref<MessageInputHandle>;
	/**
	 * The user has begun composing. Forwarded verbatim to the composer, which
	 * calls it on the textarea's own onChange; the POLICY of what that triggers
	 * (at most one speculative runtime warm per session) lives in
	 * `useWarmSession`, not here.
	 */
	onComposerInput?: () => void;
	/** Working directory for this conversation, shown on the composer's chip. */
	cwd?: string;
	/**
	 * The canonical session this pane is showing, or undefined for a draft.
	 *
	 * Threaded, not derived: the canvas's `conversationId` is its store key (the
	 * draft key before the session exists), while the code-memory panel needs
	 * the identity a backend route can resolve. See `CanvasProps.sessionId`.
	 */
	sessionId?: string;
	/**
	 * How many turns the canonical stream has seen end, forwarded to the canvas
	 * so the code-memory panel can re-read when a cell finishes; see
	 * `CanvasProps.turnTerminal`. Undefined on the legacy path, where there is no
	 * canonical stream to take the signal from.
	 */
	turnTerminal?: number;
	/** Present only while the session is a draft; see `MessageInputProps`. */
	/** How the chip's commit is applied; see `MessageInputProps.cwdWritePath`. */
	cwdWritePath?: DirectoryWritePath;
	/**
	 * A working-directory move is in flight for this session; see
	 * `MessageInputProps.cwdPending`.
	 *
	 * Threaded through here rather than read from a store because this component
	 * is a pure pass-through for the composer's props: the value belongs to the
	 * session pane that owns the move, and a second reader of it would be a second
	 * answer to "is this session's chip settled".
	 */
	cwdPending?: boolean;
	/**
	 * Whether the backend has accepted the move in flight; see
	 * `MessageInputProps.cwdPendingAccepted`.
	 */
	cwdPendingAccepted?: boolean;
	/** Why the chip is read-only here, per cause; see `MessageInputProps`. */
	cwdReadOnlyReason?: string;
	/** A failed send, rendered against the composer; see `ComposerSendError`. */
	sendError?: ComposerSendError;
	/**
	 * The session's readings and the dispatcher that opens their pickers.
	 * Forwarded verbatim to the composer; see `MessageInputProps`.
	 */
	sessionStatus?: {
		frontend: CanonicalFrontendState | null;
		onCommand?: (invocation: SlashCommandInvocation) => void;
		/** The rungs `/effort` accepts; see `SessionStatusStripProps`. */
		effortEntities?: readonly unknown[];
		/** A chosen model the owner has not confirmed; see `SessionStatusStripProps`. */
		pendingModel?: CanonicalModel | null;
		/** A draft pane's readings, which have no session behind them. */
		draft?: boolean;
		/**
		 * Whether this DRAFT pane's model is resolved (UX round 1, U1).
		 *
		 * `true` exactly when the pane is a draft and its `sessions.preview` answer
		 * has arrived; `false` while that answer is pending or failed; absent for a
		 * pane with a session behind it, where there is nothing to resolve.
		 */
		draftResolved?: boolean;
		/**
		 * Open a model or effort picker for this DRAFT pane's own selection.
		 *
		 * Forwards to `SessionStatusStripProps["onOpenDraftPicker"]`, and is absent
		 * unless the backend advertises the capability — which is what leaves the two
		 * readings inert with today's copy on a backend that cannot honour a pick.
		 */
		onOpenDraftPicker?: (destination: DraftPickerDestination) => void;
		/**
		 * Where a draft's resolution IS, while it has no reading yet; see
		 * `SessionStatusStripProps["draftResolution"]`.
		 */
		draftResolution?: DraftResolution;
		/**
		 * The readings are the last ones the session reported, held across a
		 * transient stream gap. Forwarded verbatim to the composer; see
		 * `SessionStatusStripProps["held"]`.
		 */
		held?: boolean;
		/**
		 * The readings were DROPPED at a spent retry budget rather than never
		 * painted. Forwarded verbatim to the composer; see
		 * `SessionStatusStripProps["readingsDropped"]` (task-17, U4).
		 */
		readingsDropped?: boolean;
	};
	/**
	 * The command dispatcher the composer splices an inline command into, with
	 * its outcome handed back. Forwarded verbatim; see
	 * `MessageInputProps.onSlashCommand` for why the outcome matters.
	 */
	onSlashCommand?: (
		invocation: SlashCommandInvocation,
	) => Promise<SlashDispatchOutcome>;
	/**
	 * Whether this pane can address a session — the dispatcher's own question,
	 * forwarded verbatim to the composer. See `MessageInputProps.paneHasSession`.
	 */
	paneHasSession?: boolean;
	/**
	 * The dispatcher's own note surface, borrowed by the composer so a staged
	 * reassembly and an unanswerable name list can say what happened. Forwarded
	 * verbatim; see `MessageInputProps.onSlashNote`.
	 */
	onSlashNote?: (text: string) => void;
	/**
	 * §F3's per-message failure state, computed by the page that owns the draft
	 * (it is the page that also owns the `send` door and the composer handle the
	 * two controls use).
	 *
	 * THIS PANE, NOT THE PAGE, decides whether the line is drawn: the address is
	 * a transcript record id, and only this component holds the transcript. The
	 * rule is the record's presence - a line addressed to a row that is not on
	 * screen is a claim about a message the reader cannot see, which is exactly
	 * the register §F3 exists to end.
	 */
	undelivered?: UndeliveredTurn | null;
	/**
	 * The canonical session this pane paints from. Required, not optional: the
	 * legacy job/message list went with the socket transport, so there is no
	 * second transcript a pane could fall back to. `chat-page.tsx` supplies it
	 * for every mount, live conversation or draft alike.
	 */
	canonical: {
		view: CanonicalSessionHandle;
		/**
		 * Whether the owner's turn is still ALIVE - read through the hold:
		 * `(frontend ?? heldFrontend)?.streaming`, defined once in the page that
		 * owns the prop (`chat-page.tsx`).
		 *
		 * WHY THE PAIR, and who reads it: a receipt gap nulls `frontend` and keeps
		 * the last reading in `heldFrontend` (both gap arms in
		 * `use-canonical-session.ts`), and for a busy session that recurs every
		 * ~1.5-4 s - so reading the raw field blanked the in-flight claim on every
		 * reconnect, and for the whole stretch of a flapping link, while the work
		 * on the far side ran the entire time (operator report, 2026-10-07).
		 * Round 1 measured where the split it shipped kept biting: through a gap
		 * the line claimed a running turn while Stop was absent, Esc sent nothing
		 * (three presses, zero `/interrupt` requests on the wire), and Enter sent
		 * the wire shape that PARKS a message sent during a live turn - so the
		 * claims, the controls and the send mode all read this one pair now, and
		 * the page's own note carries the worst case that accepts.
		 *
		 * The readers here: the transcript's working line and the composer's hint
		 * (the claims), the Stop control the composer draws from
		 * `canonicalStop.active`, the aside adopt gate, and the skew line on a
		 * backend that cannot interrupt.
		 */
		turnAlive: boolean;
		/**
		 * The Stop press's own window: `"pending"` from the press until its
		 * receipt or its bound; `"awaiting-end"` once a receipt confirmed the
		 * cancel but the stream has not yet shown the turn ending (the rung must
		 * not fall back to narrating `running bash` mid-teardown - design round
		 * 1's D1); `"unconfirmed"` when the press ended with no answer at all
		 * (the bound fired and the outcome is unknown); null otherwise.
		 *
		 * ONE fact with three phases rather than two booleans, because "pending
		 * and unconfirmed" is not a state: a receipt resolves the press, and only
		 * a lost answer leaves it unknown. The page owns the state machine
		 * (`chat-page.tsx`); the readers here are the working line's `stopping`
		 * rung and the stopped band's gate - a band must not claim a stopped turn
		 * from a press whose outcome was never confirmed.
		 */
		stopOutcome?: "pending" | "awaiting-end" | "unconfirmed" | null;
		/**
		 * True while the sentence standing in the composer is the DISPUTED idle
		 * one (UX round 2, U9): an `idle` receipt arrived while the pane's held
		 * claim still said a turn was alive, so the claim stays - the work may be
		 * real - but the rung withholds its clock for exactly as long as the pane
		 * is admitting it cannot vouch for a duration. The page folds this from
		 * the notice's own kind (`chat-page.tsx`), so the sentence and the
		 * withheld clock are one fact with one lifetime.
		 */
		idleDisputed?: boolean;
		admitting?: boolean;
		/**
		 * A send this conversation has admitted and that has produced nothing yet.
		 *
		 * Distinct from `admitting`, which is the composer-side window in which a
		 * send is being issued and the text is still the user's. This one spans the
		 * whole wait, from the send until the owner paints something, so it covers
		 * the cold engage the user actually waits through — and it is what the
		 * transcript's working line, the pane's own emptiness and the composer's
		 * placeholder all read. See `working-line-model.ts` for the copy rule.
		 */
		starting?: boolean;
		/**
		 * The record this send painted, which every clear measures from. Null only
		 * when no send is admitted.
		 */
		startingAfterId?: string | null;
		/**
		 * Whether the admitted send is still in its CREATE hop (no session yet), and
		 * when the claim began - the two facts the wait line's label and clock read.
		 * See `WorkingLineInput.startingSession`/`startingSince`; passed through
		 * untouched, because both readers below derive their state from one input
		 * builder and must not be handed different facts.
		 */
		startingSession?: boolean;
		startingSince?: number | null;
		onStop: () => void;
		/**
		 * Whether this backend can interrupt a turn (`session_interrupt`), as
		 * opposed to ending the session.
		 *
		 * Here rather than read from the capabilities hook again: the page that owns
		 * `onStop` owns the gate, and this pane's only job is to decide whether the
		 * control exists at all. FALSE means no Stop control and no Escape
		 * accelerator - never a fallback to the session-stop route, which kills the
		 * session the button does not promise to kill.
		 */
		stopAvailable: boolean;
		/**
		 * What the last interrupt left running, or null.
		 *
		 * Passed through untouched: the sentence is authored where the request and
		 * its receipt are (`chat-page.tsx` via `interrupt-turn.ts`), and re-deriving
		 * it here would be a second copy of the same wording.
		 */
		stopNotice: string | null;
		/**
		 * Answer the pending `ask` gate with an option's label.
		 *
		 * Travels beside `onStop` because it is the same kind of thing: a session
		 * action the transcript can trigger but does not own. `SessionPanel` holds
		 * the send lock and the error surface, so the answer has to be raised to
		 * it rather than posted from the row that was clicked.
		 */
		onAnswer?: (label: string) => void;
		/**
		 * Answer the pending `secret` gate with the dock's typed value.
		 *
		 * The secret field's sibling of `onAnswer`, raised to the same panel for
		 * the same reason: `SessionPanel` holds the send lock and the error
		 * surface, so the value has to reach it rather than post from the field.
		 * Absent where the surface cannot address an owner — the dock then
		 * renders the field disabled.
		 */
		onAnswerSecret?: (value: string) => void;
		/**
		 * What `SessionPanel` knows about the gate it just answered. Passed through
		 * untouched: the card's hold and its refusal sentence are decided where the
		 * request and its failure are, not re-derived here.
		 */
		answer?: { sending: boolean; refused: string | null } | null;
		/**
		 * Answer a QUEUED ask from a completed whole-ask draft (design §4/§5.2).
		 *
		 * The sibling of `onAnswer`, raised to `SessionPanel` for the same reason:
		 * the lock and the error surface live there, so the answer has to reach it
		 * rather than be posted from the panel that was clicked. It is a SEPARATE
		 * prop from `onAnswer` because the two bodies are different shapes on the
		 * wire - a gate answers one question by index + label, a queued ask answers
		 * the whole ask by id - and folding them would leave this pane deciding which
		 * machinery a payload belongs to from the ask it happens to render.
		 */
		onAnswerAsk?: (askId: string, answers: Record<string, string[]>) => void;
		/** "No answer — decide yourself" for a queued ask. */
		onDeclineAsk?: (taskId: string) => void;
		/**
		 * CHANGE a recorded-but-undelivered answer (design §10, #1936).
		 *
		 * Raised to `SessionPanel` beside its two siblings, and for their reason: the
		 * shared lock and the refusal surface live there, so a revision has to reach
		 * it rather than be posted from the card that was clicked. Its body is the
		 * whole ask map like `onAnswerAsk` — the wire takes the same payload for both
		 * doors, plus the intent — so a per-question shape here would be the amend post
		 * §10 rules out.
		 */
		onReviseAsk?: (askId: string, answers: Record<string, string[]>) => void;
		/**
		 * What `SessionPanel` knows about each queued ask it just answered, keyed by
		 * ask id: the sentence the owner refused with, or `null` while it is live - and,
		 * on a revision, whether one LANDED (`AskOutcome`'s own note: the wire cannot
		 * mark an accepted change, so the receipt is this surface's own record). The
		 * record also carries whether a refusal is the OWNER's verdict, which is what may
		 * shut §10's change door; a transport failure leaves that false and the door open
		 * (`AskOutcome.refusedByOwner`).
		 *
		 * Keyed rather than a single slot because a refusal belongs to ONE ask - a
		 * single slot would put the previous ask's sentence on the next one, which is
		 * the same defect the gate's per-question hold exists to avoid.
		 */
		askOutcomes?: Record<string, AskOutcome | undefined>;
		/*
		 * THE ASKS DRAWER'S LANE. `askExpanded` is the one flag the status-row chip, the
		 * header door and the drawer all read, and the page owns it rather than the ask
		 * surfaces so they cannot disagree about whether the drawer is open. It says
		 * nothing about the composer: the main box is an ordinary conversation box
		 * whether the drawer is open or not (the reversal of design §5.0, R7), so
		 * there is no sentence or mode to pass it. `askDrafts` is the panel's own draft.
		 */
		askExpanded?: boolean;
		onAskToggle?: (next: boolean) => void;
		askDrafts?: Record<string, AskDraft>;
		onAskDraftChange?: (askId: string, next: AskDraft) => void;
	};
	/**
	 * The session's derived subagent and to-do view model (`run-details.md` § 8),
	 * derived by the page that owns the canonical stream and handed down here so
	 * the header can place the trigger. OPTIONAL, and its absence is the whole
	 * gate for every path that has no canonical session: `ChatHeader` renders with
	 * no `runDetails` below, `RunDetailsTrigger` returns null for a null model, and
	 * so the legacy transcript grows no button and no reserved space.
	 */
	runDetails?: RunDetails | null;
	/**
	 * The session's configured MCP servers, for the panel's MCP section and the
	 * trigger's attention dot.
	 *
	 * Read by the page (`useRunPanelMcpServers`) rather than by either consumer,
	 * because the dot and the section must answer from ONE list: a trigger with
	 * its own copy could acknowledge a row the panel never drew. Empty when the
	 * capability is absent or nothing is configured, which is also what makes the
	 * section render as absence.
	 */
	mcpServers?: readonly McpServerRow[];
	/**
	 * Whether the read carries an operation that is still running.
	 *
	 * Threaded from the page (`use-mcp-servers.ts`) so the section can disable every
	 * other row's control while the backend's one grant runs. It comes off the
	 * document's `operations` rather than off the folded rows on purpose: a row
	 * exists only where the read carries a server, so an operation for a server that
	 * was removed or renamed still holds the lock while no row would show it (code
	 * review round 1, finding 5).
	 */
	mcpGrantRunning?: boolean;
	/**
	 * The panel's MCP remedy controls (`use-mcp-remedy.ts`).
	 *
	 * Read by the page, like the server list itself, and threaded down rather than
	 * taken inside the section: the controls address the ACTIVE session and write
	 * into the one query the trigger and the panel both read, so the page is the
	 * level that owns both facts.
	 */
	mcpRemedy: McpRemedyControls;
	/**
	 * The pane's monitor write controls (`use-monitor-controls.ts`), the same
	 * threading as `mcpRemedy`: the Monitors section's confirmation and refusal
	 * live in the section, and the write belongs to the level that owns the
	 * session identity.
	 */
	monitorControls: MonitorControls;
	/**
	 * Whether a child's row can be opened: the `subagent_transcript` capability
	 * (`§ 10.2`). False leaves the roster visible and quiet rather than lit and
	 * inert.
	 */
	childrenOpenable?: boolean;
	/**
	 * The composer's `@` affordance, folded by the page that owns both halves of
	 * the question (the harness's `references` capability and whether the next send
	 * is a steer) and forwarded verbatim to the composer. See
	 * `MessageInputProps.mentionsEnabled` for why it fails closed.
	 */
	mentionsEnabled?: boolean;
	/**
	 * Whether the connected harness is the reason the `@` affordance is absent, as
	 * opposed to a turn in flight — the two false states of the flag above.
	 *
	 * Forwarded verbatim to the composer, which is the only surface that can say it:
	 * see `MessageInputProps.mentionsUnsupported` for why the distinction has to come
	 * from the page that owns the capability answer (UX round 2, U12).
	 */
	mentionsUnsupported?: boolean;
	/**
	 * Per-child `subagent_*` pulse counters, from the canonical stream, for the
	 * reader's refresh cadence (`§ 5.3`).
	 */
	pulses?: Readonly<Record<string, number>>;
};

/**
 * ChatContent Component
 *
 * Displays the main chat content area with tabs, messages, and input
 */
// The composer only reads `messages.length` (to decide whether to show the
// first-run suggestions), so the canonical path hands it a stable sentinel
// rather than re-mapping every record into a legacy Message per token.
const EMPTY_MESSAGES: Message[] = [];
const CANONICAL_NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];
/** One shared empty map, so an absent pulse prop costs no render churn. */
const EMPTY_PULSES: Readonly<Record<string, number>> = {};
/**
 * The composer band's only question is whether anything is painted ABOVE it,
 * and a readable failure notice counts: while the transcript is saying why it
 * cannot be read (and offering a way back), letting the band grow would take the
 * free height for a greeting the app has no business showing, and would put the
 * notice and the composer in competition for the same space.
 *
 * The SAME predicate drives the transcript's own collapse stand-down, so the
 * pane and the band cannot disagree about whether the pane has something to
 * say (design round 1, D3 added the reconnecting window to it: during the whole
 * retry budget the pane was 0px tall and the "Reconnecting" line was clipped,
 * while the band was free to paint the greeting over a conversation nobody had
 * read).
 */
const canonicalSpeaking = (
	canonical?: ChatContentProps["canonical"],
	/*
	 * Whether the pane's conversation is one THIS WINDOW no longer has - the state
	 * a confirmed delete puts it in before any read can answer, which the band has
	 * the same business in as the transport states above (a greeting offered over a
	 * conversation the user just deleted is the same mistake the cached and
	 * vanished cases were).
	 */
	gone = false,
): boolean =>
	Boolean(
		canonical &&
			canonicalTranscriptSpeaks({
				status: canonical.view.status,
				failure: canonical.view.failure,
				// The two states a click can paint, which are the band's business for
				// the same reason they are the pane's: a cached or vanished conversation
				// must not have the greeting offered over it. The rest of the pane's view
				// is not this predicate's question, so it is not handed over.
				stale: canonical.view.stale,
				missing: canonical.view.missing || gone,
			}),
	);

/**
 * The same question asked for the WORKING CLAIM: is the pane's statement one
 * that ENDS a claim (a state the stream cannot revise), rather than the
 * reconnecting window, which does not?
 *
 * The composer's hint and the transcript's rung must yield to the SAME
 * statements (review round 2, R2-3 asked for exactly that agreement), so both
 * read `canonicalTranscriptTerminal` and neither re-derives the exclusion; see
 * its doc for why a reconnect is deliberately not among the states that stand
 * the claim down (operator incident, 2026-10-07).
 */
const canonicalTerminal = (
	canonical?: ChatContentProps["canonical"],
	gone = false,
): boolean =>
	Boolean(
		canonical &&
			canonicalTranscriptTerminal({
				status: canonical.view.status,
				failure: canonical.view.failure,
				stale: canonical.view.stale,
				missing: canonical.view.missing || gone,
			}),
	);

const defaultCanvasState = {
	isOpen: false,
	openTabs: [],
	selectedTabId: null,
	files: [],
	// Read by the panel head, the view switcher and the canvas button, so the
	// fallback has to carry the field rather than lean on `undefined`.
	mentionedFiles: [],
};

/**
 * The run pane's own contract floor, in pixels: the design's range
 * (`docs/run-sidebar.md` § 8) is 320..640 and starts at 320 (it used to carry a
 * 420 default between them; the slot's one default is 640 now).
 *
 * ONE home for that number, because it is the floor of THREE different things:
 * the width the divider lets the user DRAG the pane's preference down to, the
 * width flex may SHRINK the rendered pane down to when the row cannot host the
 * preference, and — since the #677 review round (D2) — the floor the slot's
 * RESOLVER holds the shared width to for this pane. The home is the STORE's
 * (`RUN_PANEL_MIN_PX`, beside `resolveRightSlotWidth`), because the resolver
 * needs it and the resolver cannot import this file; two literals would drift the
 * moment either moves, and the second thing above is the whole of the fix below:
 * a preference pinned as a floor is not a floor, it is a promise the row cannot
 * keep.
 */

/**
 * The other end of that contract range: 640 is the widest the pane may ask for
 * (`docs/run-sidebar.md` § 8). Named here beside the floor because the divider's
 * range is now built from both, and because the ceiling is what a drag is
 * refused at once the row cannot host it.
 *
 * EXPORTED for the shell story that mounts this arm's own pair
 * (`shell.stories.tsx`'s `ChatMeasureEdgesRunPanel`): a frame of the divider has
 * to carry the range the app gives it, and a literal restated in the story is
 * the drift this constant exists to prevent - a bound moved here would leave the
 * arm's claim true only by accident.
 */
export const RUN_PANEL_MAX_PX = 640;

/**
 * The drag ceilings the browser and console separators share: 1200, the range the
 * two draw-only panes have had since their dividers existed. Named beside the run
 * pane's 640 because the separator contract builds each pane's announced maximum
 * from its own ceiling and the row's capacity, so the number is read here rather
 * than restated at the call site.
 */
const BROWSER_PANEL_MAX_PX = 1200;
const CONSOLE_PANEL_MAX_PX = 1200;

/**
 * The chat column's own floor, in pixels, as a fallback for the measured one.
 *
 * The column declares it as `min-w-[480px]` on the element beside the pane (§B1's
 * chat-pane minimum, and the first of §I's three yielding steps), and the
 * measurement below reads it back from that element's computed style rather than
 * trusting this number — the floor is what tells the pane's own divider how much
 * room the ROW can give it, and a constant here that drifted from the class would
 * silently re-open the divergence the divider fix closes. This is the fallback for a
 * computed style that cannot be parsed, not a second source.
 *
 * IT WAS 220 UNTIL §I, and the difference is visible: at 220 the canvas could dock
 * in a row that left the transcript 320px wide, which is the window width the
 * redesign's audit measured the pane at. `chat-sidebar-layout.ts`'s own 880 comment
 * has done the arithmetic with 480 since the spec was written; this is the commit
 * that makes the class agree with it.
 */
const CHAT_COLUMN_MIN_PX = CHAT_PANE_MIN_PX;

export const ChatContent: FC<ChatContentProps> = React.memo(
	({
		activeTab,
		onTabChange,
		agentName,
		description,
		descriptionPending,
		identity,
		deviceSlot,
		deviceNotice,
		deviceHold,
		renameSessionId,
		onOpenOptions,
		isOptionsSidebarOpen,
		onCloseOptions,
		agentId,
		messages,
		isLoading,
		isLoadingMessages,
		isFarFromBottom,
		hasNewActivity = false,
		messagesContainerRef,
		scrollToBottom,
		rawInfoContent,
		onSendMessage,
		currentJobId,
		onCancelJob,
		onComposerInput,
		agentData,
		messageInputRef,
		cwd,
		sessionId,
		turnTerminal,
		cwdWritePath,
		cwdPending,
		cwdPendingAccepted,
		cwdReadOnlyReason,
		sendError,
		sessionStatus,
		onSlashCommand,
		onSlashNote,
		paneHasSession,
		canonical,
		undelivered = null,
		runDetails,
		mcpServers = [],
		mcpGrantRunning = false,
		mcpRemedy,
		monitorControls,
		childrenOpenable = false,
		/*
		 * The composer's `@` affordance, folded by the page that owns both halves of
		 * the question (the harness's capability and the turn's own state) and
		 * forwarded verbatim. Absent means the composer offers no picker and paints no
		 * chip, which is the fail-closed reading of a caller that did not ask.
		 */
		mentionsEnabled = false,
		mentionsUnsupported = false,
		pulses,
	}) => {
		const [isSmallView, setIsSmallView] = useState(false);
		/*
		 * THE COMPOSER'S TWO HOST SEAMS (the shared-composer lift). The credential
		 * probe and the credentials-cache invalidation used to live INSIDE
		 * `MessageInput`, as react-query reads - which made a provider a mount
		 * requirement for every document, and the shared composer must mount in
		 * the mini view's document, which carries none. The shell is the host for
		 * both: this component is always inside the app's provider, and the
		 * composer rendered below takes the answers as props, so a providerless
		 * consumer supplies its own instead.
		 */
		const recordingProbe = useRadientCredentialProbe();
		const queryClient = useQueryClient();
		const invalidateStoredCredentials = useCallback(
			(sessionId: string) =>
				queryClient.invalidateQueries({
					queryKey: desktopKeys.credentials(sessionId),
				}),
			[queryClient],
		);
		const chatContainerRef = useRef<HTMLDivElement>(null);
		const canvasContainerRef = useRef<HTMLDivElement>(null);
		/*
		 * WHETHER §F3's LINE IS ON SCREEN, which is one decision with two readers:
		 * the transcript (which draws it on the row it names) and the composer (which
		 * stands its own held paragraph down while the line speaks for the same
		 * failure). Computed once, here, because "the row exists" is a fact about
		 * this transcript and computing it twice is how the two surfaces drift.
		 */
		/*
		 * THE ONE GATE READING (agent review round 1, F3): with the legacy-mirror rule
		 * applied in ONE place, every reader below - the dock, the composer's two
		 * terms and the working line - sees the same value, so a mirrored ask cannot
		 * be drawn once, named as a gate, and answered by index all at the same time.
		 */
		const gate = effectiveGate(canonical?.view.frontend);
		const undeliveredOnScreen =
			undelivered !== null &&
			canonical.view.transcript.records.some(
				(record) =>
					record.kind === "user" && record.id === undelivered.recordId,
			)
				? undelivered
				: null;
		/*
		 * The conversation's own archive state, and the two capabilities that decide
		 * whether any of it is offered at all.
		 *
		 * Read HERE - the component that renders both the header and the dialog -
		 * rather than inside either of them, for the reason the header takes
		 * `fileCount` as a prop: the header is rendered by stories with fixtures and by
		 * the legacy path with nothing, and the store read has exactly one honest
		 * answer per session. `sessionId` is undefined on a draft, and a draft has no
		 * conversation to archive or delete, so every one of these is inert there.
		 */
		const capabilities = useDesktopCapabilities();
		// Whether to tell the user to connect a provider before they type; see
		// `useProviderStatus` for why this is false whenever it is not KNOWN.
		/*
		 * Both states, from the one rule: nothing connected at all, and a provider
		 * connected that this app cannot name a model for (UX round 5, U21).
		 */
		const { needsProvider, needsModel } = useProviderStatus();
		const archiveEnabled = desktopFeatureEnabled(
			capabilities.data,
			"session_archive",
		);
		const deleteEnabled = desktopFeatureEnabled(
			capabilities.data,
			"session_delete",
		);
		const archived = useCanonicalSessionsStore((state) =>
			sessionId
				? (state.archiveFacts[sessionId]?.archived ??
						state.sessions.find((row) => row.session_id === sessionId)
							?.archived) === true
				: false,
		);
		/*
		 * THE CONVERSATION THIS WINDOW HAS DELETED, read here rather than waited for
		 * from the wire.
		 *
		 * The pane's missing-session state used to arrive only as a 404 on the
		 * conversation's own stream, and a delete this window performed does not wait
		 * for one: the store knows (`forgotten`), and the pane therefore landed on an
		 * empty draft bound to an id that no longer exists - the header over `Untitled
		 * chat`, an enabled composer accepting a message that can only fail, and no
		 * statement anywhere that the conversation was deleted (UX round 1, U1). The
		 * state it lands on now is the ONE that already exists for this
		 * (`MISSING_SESSION_NOTICE_ID`), not a second one.
		 */
		const sessionGone = useCanonicalSessionsStore((state) =>
			sessionId ? state.forgotten[sessionId] !== undefined : false,
		);
		/*
		 * AND A CONVERSATION THE CATALOGUE CARRIES AGAIN IS NOT GONE, whatever an
		 * earlier read said (QA round 3, Q12).
		 *
		 * `canonical.view.missing` is a TRANSPORT state: it is raised by a 404 on this
		 * conversation's own stream and nothing on the wire takes it back - a resurrected
		 * conversation is not re-announced on the stream the 404 killed, because that
		 * stream is gone. So after a tombstone self-heals (the row comes back, which
		 * `forgotten` and the row's own presence both say) the pane the reader is
		 * ALREADY on kept drawing "This conversation is no longer on this machine" for
		 * as long as they stayed - QA measured it holding for 16s of samples and across
		 * a click on the row the route already names, and only the route change or a
		 * cold start cleared it.
		 *
		 * The catalogue's membership is this client's freshest claim about whether the
		 * conversation EXISTS, and it is the claim the row itself is drawn from: a row
		 * on screen beside a notice saying it is not on this machine is the app
		 * contradicting itself. Read here rather than folded into the view, because the
		 * view is about the TRANSPORT and this is about membership.
		 */
		const listedNow = useCanonicalSessionsStore((state) =>
			sessionId
				? state.sessions.some((row) => row.session_id === sessionId)
				: false,
		);
		/*
		 * TWO PREDICATES, BECAUSE THE TWO CONSUMERS WANT DIFFERENT ONES (agent review
		 * round 4, R4-2). The notice is about EXISTENCE and takes the catalogue's
		 * membership with it. The composer's refusal is about the STREAM: it exists to
		 * refuse a message that can only 404, so it keeps `view.missing` - the transport
		 * state - and the tombstone, and must not be cleared by a catalogue page that
		 * still lists an id whose own stream has 404'd.
		 */
		const gone =
			sessionGone || (canonical?.view.missing === true && !listedNow);
		const conversationUnavailable =
			sessionGone || canonical?.view.missing === true;
		/*
		 * A MEMOISED STOP, for the reason the credential probe above is memoised at
		 * its source: this object is handed to the composer, whose memo boundary
		 * compares props shallowly, and it used to be rebuilt inline on every
		 * render of this component - which is once per stream flush. Frozen on the
		 * values it is made of, so it is rebuilt exactly when one of them moves:
		 * `onStop` is the page's `stop` callback, stable since its own `useCallback`
		 * fix. It sits here, below `gone`, because one of its terms is the SAME
		 * terminal predicate the rung and the hint read (`canonicalTerminal`),
		 * which takes the membership half with it.
		 *
		 * THREE TERMS, each answering a round-1 finding: `stopAvailable` is the
		 * capability (absent means no control at all); `!terminalPane` is U6 - on
		 * a terminal pane (the failure notice, a conversation this machine no
		 * longer has, a cached page) the red square stayed an armed control that
		 * could only answer `nothing was running`, because the raw field kept
		 * painting while the frontend did - so the same
		 * `canonicalTranscriptTerminal` the rung and the hint yield to retires the
		 * control too; and `active` reads `turnAlive`, the pair (D2), so a gap
		 * no longer hides the control while the line claims the turn. `stopping`
		 * rides along for the composer's pressed-step placeholder (D6).
		 */
		const stoppingTurn =
			canonical?.stopOutcome === "pending" ||
			canonical?.stopOutcome === "awaiting-end";
		/*
		 * U10: the composer's `Stopping the turn` and the square's pressed hold
		 * yield the moment the FEED shows the turn over, not only at the receipt
		 * or the bound. Measured: with the receipt withheld, the line went and the
		 * band came up at +116 ms while the box kept saying `Stopping the turn`
		 * for the full 15 s - two surfaces in one viewport disagreeing, with the
		 * band's `Retry` directly above a box that claimed to still be stopping.
		 * The rung needs no such term (its overlay sits on a live state, and a
		 * live state cannot outlive the pair's fall); the placeholder has no live
		 * state of its own, so it takes the pair's own reading explicitly.
		 */
		const stoppingShown = stoppingTurn && canonical?.turnAlive === true;
		const terminalPane = canonicalTerminal(canonical, gone);
		const canonicalStop = useMemo(
			() =>
				canonical?.stopAvailable && !terminalPane
					? {
							active: canonical.turnAlive,
							stopping: stoppingShown,
							onStop: canonical.onStop,
						}
					: undefined,
			[
				canonical?.stopAvailable,
				terminalPane,
				canonical?.turnAlive,
				stoppingShown,
				canonical?.onStop,
			],
		);
		const setSessionArchived = useCanonicalSessionsStore(
			(state) => state.setSessionArchived,
		);
		const requestArchiveConfirm = useCanonicalSessionsStore(
			(state) => state.requestArchiveConfirm,
		);
		/*
		 * The header's archive press, in the same register as the other routes
		 * (UX round 1, U2): the pane's menu item, the row's control and a typed
		 * `/archive` are ONE act. The pane stays open either way - archiving hides, it
		 * does not close - and the Undo all three offer is raised by the STORE, in the
		 * update that settles the write (design round 8, D27): raising it here instead
		 * put the accepted departure and the band that answers it in two commits, and the
		 * commit between them is where the list's extent dips below the reader's position.
		 *
		 * AND THE ACT GAINED A QUESTION (2026-09-30, D1): the header's item STAGES the
		 * candidate now instead of writing, exactly as `/delete` stages one, so all five
		 * doors end in the pane's one `ArchiveConversationDialog`. The two halves of this
		 * callback are therefore different acts rather than one write with a flag: the
		 * RESTORE still writes straight through - unarchive never confirms, on this
		 * surface or any other - while the ARCHIVE only asks. `fromRow: false` is what
		 * says the reader was not standing in the list, so the caret goes back to the
		 * menu that shut rather than to a successor row.
		 */
		const archiveFromHeader = useCallback(
			(next: boolean) => {
				if (!sessionId) return;
				if (!next) {
					void setSessionArchived(sessionId, false, agentName);
					return;
				}
				requestArchiveConfirm({
					sessionId,
					fromRow: false,
					fromHeader: true,
					title: agentName,
				});
			},
			[sessionId, agentName, setSessionArchived, requestArchiveConfirm],
		);
		const requestSessionDelete = useCanonicalSessionsStore(
			(state) => state.requestSessionDelete,
		);

		useEffect(() => {
			if (!chatContainerRef.current) {
				return;
			}

			const resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					if (entry.contentRect.width < 550) {
						setIsSmallView(true);
					} else {
						setIsSmallView(false);
					}
				}
			});

			resizeObserver.observe(chatContainerRef.current);

			return () => {
				resizeObserver.disconnect();
			};
		}, []);

		/*
		 * THE RIGHT SLOT'S ONE WIDTH (#677), declared here because this is the
		 * first of the four panes to read it and every later cluster below reads
		 * the same value: one column, one width, whichever pane is on screen.
		 * `rightSlotWidth` in the store carries the rule (0 = unset, and unset opens
		 * every pane at the one `DEFAULT_RIGHT_SLOT_WIDTH`).
		 */
		const rightSlotWidth = useUiPreferencesStore((s) => s.rightSlotWidth);
		const setRightSlotWidth = useUiPreferencesStore((s) => s.setRightSlotWidth);
		const restoreDefaultRightSlotWidth = useUiPreferencesStore(
			(s) => s.restoreDefaultRightSlotWidth,
		);

		// Get canvas state for the current conversation
		const conversationId = agentId; // assuming agentId is the conversation ID

		/*
		 * THE TURN THE USER STOPPED (UX round 2, U7; spec §G3).
		 *
		 * `Esc` leaves one line where the turn ended — `Stopped`, at `text-meta`/`ink-dim`,
		 * with a retry — and never a failure-red row. The row-level half of that is the
		 * reducer's (`transcript-reducer.ts` reclassifies the call the interrupt killed, so
		 * the ledger's own row reads `interrupted` rather than `failed`); this is the
		 * sentence at the turn's end, which is what tells the reader the turn is over and
		 * gives them the one control that acts on it.
		 *
		 * THE FACT IS THE STORE'S and not this component's, because the press happens in
		 * `chat-page`'s interrupt handler and the receipt that confirms it is that
		 * handler's answer — see `stoppedTurns` for why the client has to record it at all
		 * and how long it lives.
		 */
		const stoppedTurnAt = useCanonicalSessionsStore((state) =>
			conversationId ? (state.stoppedTurns[conversationId] ?? null) : null,
		);
		/*
		 * WHAT A RETRY WOULD RE-SEND: the newest user turn on screen, or null when there
		 * is none.
		 *
		 * Read from the transcript rather than remembered at the press, because the press
		 * knows nothing the transcript does not: the turn being stopped is defined by the
		 * message that started it, and that message is a row. A turn stopped before any
		 * user row exists (an approval, a resume) therefore offers no retry rather than a
		 * retry that could send nothing — the honest half of §G3's control, and the same
		 * rule the rest of this pane applies to controls that would have no effect.
		 */
		const stoppedRetryText = useMemo(() => {
			if (stoppedTurnAt === null || !canonical) return null;
			const records = canonical.view.transcript.records;
			for (let at = records.length - 1; at >= 0; at -= 1) {
				const record = records[at];
				if (record.kind === "user") return record.text;
			}
			return null;
		}, [stoppedTurnAt, canonical]);

		/*
		 * The Files panel's producer, called exactly once and here because this is
		 * the only component that holds BOTH halves it needs: the canonical
		 * transcript (`records`, the full loaded list rather than the painted
		 * window) and the canvas-store key (`conversationId`, which is `agentId`
		 * for a live session and the draft key for a draft - they differ).
		 *
		 * `cwd` comes off the canonical frontend, read the same way the working
		 * directory chip reads it, and is what lets a relative path in a tool
		 * argument be resolved against the session rather than guessed at.
		 */
		const canvasState = useCanvasStore((s) => s.conversations[conversationId]);
		const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
		// The Files view is the only thing that drives the completeness scan: paging
		// the reader's own transcript is a visible side effect, and it happens
		// because the user asked to see every file rather than because a
		// conversation is mounted.
		const filesViewOpen =
			isCanvasOpen && (canvasState?.viewMode ?? "documents") === "files";

		/*
		 * The scan request, memoised on purpose. The hook's effect compares its
		 * dependencies by identity, and a fresh object literal per render (this
		 * component re-renders on every transcript delta) would re-run the scan
		 * effect on each of them.
		 */
		const scanRequest = useMemo(
			() =>
				filesViewOpen && canonical
					? {
							active: true,
							hasMore: canonical.view.transcript.hasMore,
							oldestId: canonical.view.transcript.oldestId,
							loadOlder: canonical.view.loadOlder,
							/*
							 * The reader's own paging state, passed through so the scan can tell
							 * its own page request apart from theirs: `loadOlder` answers both
							 * with the same `false`, and only one of them means the history is
							 * exhausted (round 2, R2-5).
							 */
							blocked: canonical.view.loadingOlder,
						}
					: null,
			[filesViewOpen, canonical],
		);

		const filesScan = useMentionedFiles({
			conversationId,
			records: canonical?.view.transcript.records ?? null,
			cwd: canonical?.view.frontend?.cwd,
			enabled: Boolean(canonical && agentId),
			scan: scanRequest,
		});
		const setOpenTabs = useCanvasStore((s) => s.setOpenTabs);
		const setSelectedTab = useCanvasStore((s) => s.setSelectedTab);
		const setFiles = useCanvasStore((s) => s.setFiles);

		/*
		 * `isCanvasOpen` is read once, above, by the Files view's own predicate; the run
		 * pane reads the same store field, so the rebase's duplicate of that line is
		 * dropped here rather than shadowing it (both sides had added the declaration
		 * for their own reason, which is what a union of the two sides has to settle).
		 */
		const isRunPanelOpen = useUiPreferencesStore((s) => s.isRunPanelOpen);
		const setRunPanelOpen = useUiPreferencesStore((s) => s.setRunPanelOpen);
		/*
		 * The pane's VIEW state — which of its two views is showing — and the reason it
		 * lives HERE rather than inside `RunPanel` (`§ 3.4`).
		 *
		 * The trigger's attention dot has to know whether the list is on screen, because
		 * a reader replaces the panel's body wholesale: acknowledging on "the panel is
		 * open" alone would mark a failure or a dropped MCP server as seen the moment it
		 * landed behind a reader the user was reading. This component renders BOTH the
		 * header (and therefore the trigger) and the pane, so it is the lowest point
		 * that can answer the question once for both.
		 */
		const [readerChildId, setReaderChildId] = useState<string | null>(null);
		const listOnScreen = isRunPanelOpen && readerChildId === null;
		/*
		 * Closing the pane drops the reader: the child belongs to one session's lineage,
		 * and a reader left set would acknowledge its row while nothing is on screen.
		 */
		useEffect(() => {
			if (!isRunPanelOpen) setReaderChildId(null);
		}, [isRunPanelOpen]);
		const openTabs = (canvasState ?? defaultCanvasState).openTabs;
		const selectedTabId = (canvasState ?? defaultCanvasState).selectedTabId;
		const files = (canvasState ?? defaultCanvasState).files;
		// The one number the panel, the view switcher and the canvas button all
		// state: how many files the agent has been seen to touch.
		const mentionedFileCount = (canvasState ?? defaultCanvasState)
			.mentionedFiles.length;

		// The slot's ONE default while nothing has been dragged
		// (`DEFAULT_RIGHT_SLOT_WIDTH`, #872 follow-up): the run panel opens at the
		// same width as the browser and the console, so switching panes does not
		// re-size the slot. Once any pane has been dragged, the shared width is
		// what every pane renders — that is #677 — held up to THIS pane's floor so
		// a width dragged from a smaller pane can never draw this one under its own
		// contract range (review round 1, D2). `resolveRightSlotWidth` reads the
		// same two inputs for the canvas and for the lane above the row.
		const effectiveRunPanelWidth = Math.max(
			RUN_PANEL_MIN_PX,
			rightSlotWidth === 0 ? DEFAULT_RIGHT_SLOT_WIDTH : rightSlotWidth,
		);

		/*
		 * The browser pane: the third occupant of the same slot
		 * (`docs/design/browser-approval-ux.md` 7.3).
		 *
		 * Read here, beside `isRunPanelOpen`, because this component is what renders the
		 * slot and the header's Globe trigger has to answer "is the pane up" from the
		 * same field the slot renders from — a second source would let the trigger and
		 * the pane disagree about what is on screen.
		 */
		const isBrowserPaneOpen = useUiPreferencesStore((s) => s.isBrowserPaneOpen);
		const setBrowserPaneOpen = useUiPreferencesStore(
			(s) => s.setBrowserPaneOpen,
		);
		// Same shape as the run panel's above, and the same one default — held up
		// to this pane's 480 floor: a shared width dragged down from the run pane's
		// 320 must never draw a page as a mobile column again (review round 1, D2),
		// and the separator below announces the same 480.
		const effectiveBrowserPanelWidth = Math.max(
			BROWSER_PANEL_MIN_PX,
			rightSlotWidth === 0 ? DEFAULT_RIGHT_SLOT_WIDTH : rightSlotWidth,
		);

		/*
		 * The console pane: the FOURTH occupant of the same slot (design 6.1), read
		 * here for the reason the browser pane's block above states — the header's
		 * trigger and the pane must answer "is it up" from ONE field, or the trigger
		 * and what is on screen can disagree.
		 *
		 * The default is that same shape and the same number: the slot's one 640
		 * (`DEFAULT_RIGHT_SLOT_WIDTH`), which at the shipped face is exactly 80
		 * columns of the console's grid. The design's 100-column default (796) is
		 * gone: it drew only at windows past ~1580px, where a row had the room, and
		 * a dragged width, once there is one, is the shared one every pane renders
		 * (#677) - so the user can still reach 100 columns by dragging.
		 */
		const isConsolePaneOpen = useUiPreferencesStore((s) => s.isConsolePaneOpen);
		/*
		 * THE ASKS DRAWER, the right slot's FIFTH occupant, read here for the reason the
		 * browser pane's block above states: the store owns the flag (the composer chip
		 * opens it, the composer's own routing reads it - see `chat-page.tsx`), and this
		 * component is what renders the slot it opens into. Reading it from the store
		 * rather than from the page's props is also what makes the slot's exclusion a
		 * construction: `setAskDrawerOpen` closes the canvas, this term closes the
		 * drawer when the canvas opens.
		 */
		const isAskDrawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
		/*
		 * WHICH QUEUE THIS ROUTE'S DRAWER SHOWS. The route renders the SESSION scope
		 * only: the fleet scope is the SHELL's (see `chat-layout.tsx`), because it spans
		 * conversations and its entry point is drawn on every route. One flag, two
		 * homes, and the scope is what decides which home paints — so exactly one
		 * drawer can ever be on screen, by construction rather than by a guard.
		 */
		const askDrawerScope = useUiPreferencesStore((s) => s.askDrawerScope);
		/*
		 * `sessionId` IS PART OF THE MOUNT, NOT ONLY OF THE SCOPE (remediation round 1,
		 * U1). This mount is the CONVERSATION's own, and a draft has no conversation: with
		 * the store flag alone the session pane followed the user onto `New chat` (\u2318N)
		 * and parked there, painting a 560px slot over a page with no subject, naming a
		 * scope it is not in and reading `Not read yet` forever - there is no frame on a
		 * draft to resolve, so nothing ever clears it. The flag is deliberately left
		 * alone: the drawer still follows the user back INTO a conversation, which is the
		 * behaviour the lane claims. A route with no session simply has no session pane to
		 * paint, and the shell's fleet mount is what a draft can show - which is the scope
		 * the draft's own door already opens.
		 */
		const sessionAsksOpen =
			isAskDrawerOpen && askDrawerScope === "session" && Boolean(sessionId);
		const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
		/*
		 * Whether a right-slot pane occupies the window's right edge, which is what
		 * decides whether the CHAT HEADER has to reserve the OS controls' corner (chat
		 * redesign §J4).
		 *
		 * IT READS THE STORE'S ONE DERIVATION rather than restating the flags (#868):
		 * the disjunction that used to live here was a second copy of
		 * `activeRightSlotPane`, and it disagreed with the resolver exactly when a
		 * flag outlived the route that could draw it - the header then reserved a
		 * corner for a pane that was not on screen, and the lane and the column
		 * followed the same stale answer. `resolveRightSlotOccupied` is the
		 * drawable-aware sibling of the width resolver, and the two read the same
		 * claim and the same route facts, so the header, the lane and the column
		 * cannot disagree.
		 *
		 * The header is the only candidate this component renders for that corner: a
		 * pane's own toolbar reserves it in its own row, which is why the truth of this
		 * expression is passed as the NEGATION above.
		 */
		const rightSlotOccupied = useUiPreferencesStore(resolveRightSlotOccupied);

		/*
		 * THE ROUTE'S HALF OF THE SLOT'S TRUTH (#868): every gate this component
		 * mounts a right-slot pane behind, published once so the store's derivation
		 * (the lane's stop, the column's width, the header's reservation) answers
		 * from what THIS route can actually draw rather than from a flag that
		 * outlived its route.
		 *
		 * `mounted` is this effect's own act of being here; `runDetails` and
		 * `session` are read from the same values the panes' own mount conditions
		 * read (the run panel's `runDetails` term, the session drawer's
		 * `Boolean(sessionId)` term), so the facts and the mounts cannot drift.
		 *
		 * IT IS A LAYOUT EFFECT because the readers are in OTHER components (the
		 * chrome lane belongs to the SHELL, above this one): a passive effect would
		 * paint one frame of the previous route's answer - the stale band this issue
		 * is about - before correcting it, and a layout effect's synchronous
		 * re-render lands before the frame.
		 */
		const setRightSlotRoute = useUiPreferencesStore((s) => s.setRightSlotRoute);
		/*
		 * THE BOOLEANS, NOT THE OBJECT, ARE THE EFFECT'S KEYS (agent review round 1,
		 * R1): `runDetails` is a `useMemo` over the canonical frame and takes a new
		 * identity on every `frontend.update`, so keying on it re-published
		 * identical facts on every frame of a live run. The facts are two booleans,
		 * and a boolean only changes when the answer does.
		 */
		const hasRunDetails = Boolean(runDetails);
		const hasSession = Boolean(sessionId);
		useLayoutEffect(() => {
			setRightSlotRoute({
				mounted: true,
				runDetails: hasRunDetails,
				session: hasSession,
			});
		}, [setRightSlotRoute, hasRunDetails, hasSession]);
		/*
		 * The unmount reset: a route with no chat surface draws none of the five.
		 *
		 * IT RESETS UNCONDITIONALLY, which assumes ONE ChatContent per window
		 * (`SessionPanel key={identity}` is the only mount, and React runs the old
		 * tree's layout cleanup before the new tree's publish, so a swap ends
		 * published). A second concurrent instance would have to compare the store's
		 * facts with its own before resetting, or its unmount would release the slot
		 * under the other one.
		 */
		useLayoutEffect(
			() => () => setRightSlotRoute(EMPTY_RIGHT_SLOT_ROUTE),
			[setRightSlotRoute],
		);
		/*
		 * THE HEADER'S ASKS DOOR (operator ask, 2026-10-05): the entry point the
		 * sidebar's `All asks` row used to be, moved into this conversation's header
		 * because the nav column was over-subscribed and a control that OPENS a surface
		 * belongs with the cluster that opens the window's other right panes.
		 *
		 * THE SCOPE IS THE OPERATOR'S OWN SPLIT: inside a conversation the door and its
		 * count are THAT conversation's; at the top level - a draft, with no
		 * `sessionId` - they are the whole fleet's. The two readings are one expression
		 * so the count and the queue the press opens can never disagree about which set
		 * they describe, and the scope rides the SAME store seam the drawer already
		 * reads (`setAskDrawerOpen(open, scope)`) rather than a second scope written for
		 * the header.
		 *
		 * THE SESSION COUNT IS THE DRAWER'S OWN VIEW (`askQueueView`), not a second
		 * tally: a badge counting one set over a pane drawing another is the
		 * two-numbers-for-one-payload class the chip and the drawer already had to fix.
		 * `published` IS THE DOOR'S GATE, AND `asks !== null` IS NOT (remediation round 1,
		 * R3/Q1). The old read is the one the WIRE FIX retired: `askQueuePublished` says
		 * the capability is the presence of `asks` OR `asks_open`, so a live-but-EMPTY
		 * queue (`asks` absent, `asks_open: 0`) is an engine this runtime runs and its door
		 * must be offered - without it, the very frame the drawer's empty state documents
		 * had no entry point at all, and the two scopes disagreed about whether an empty
		 * queue gets a door (the fleet half beside it is offered at zero by design).
		 * Reading this lane's own field here, rather than re-deriving the rule, is what
		 * makes `askQueuePublished` the ONE vocabulary point it claims to be.
		 */
		const sessionAsksView = useMemo(
			() => askQueueView(canonical?.view.frontend ?? null),
			[canonical?.view.frontend],
		);
		/*
		 * OPEN BY DEFAULT over pending asks (the open policy; `ask-open-policy.ts` states
		 * the six-rule contract it shares with the TUI, the relay and the native app).
		 *
		 * HERE, AND NOT IN `chat-page.tsx`, because this is the one mount that owns the
		 * drawer's lifetime: `sessionAsksOpen` below is what draws it, `handleCloseAskDrawer`
		 * is its close door, and this component is keyed by conversation (`SessionPanel
		 * key={identity}`), so a mount IS a "view" and coming back to a conversation is a
		 * new one. `chat-page.tsx` owns the composer's answer-mode routing, which this does
		 * not touch: the hook writes the same store flag a press on the chip writes, through
		 * the same writer, and nothing else. IT ALSO RETURNS the one sentence a policy open
		 * speaks to assistive tech (design review round 1, D1), rendered by the `<output>`
		 * the row mounts below - the hook owns both edges of it, so the region here is
		 * mounted before it ever has text and only its CONTENT changes.
		 */
		const asksAnnouncement = useAskOpenPolicy({
			sessionId,
			composerId: conversationId,
			view: sessionAsksView,
		});
		/*
		 * The same `FLEET_ASKS_QUERY_KEY` read the sidebar and the sessions list already
		 * make (react-query dedupes it), so the top-level count adds no second poll.
		 */
		const fleetAsks = useFleetAsks();
		const headerAsksSession = Boolean(sessionId);
		const headerAsksScope: AskScope = headerAsksSession ? "session" : "fleet";
		const headerAsksOffered = headerAsksSession
			? sessionAsksView.published
			: fleetAsks.answered;
		const headerAsksCount = headerAsksSession
			? sessionAsksView.open
			: fleetAsks.outstanding;
		const headerAsksOpen =
			isAskDrawerOpen && askDrawerScope === headerAsksScope;
		const setConsolePaneOpen = useUiPreferencesStore(
			(s) => s.setConsolePaneOpen,
		);
		const requestConsoleOpen = useUiPreferencesStore(
			(s) => s.requestConsoleOpen,
		);
		const effectiveConsolePanelWidth = Math.max(
			CONSOLE_PANEL_MIN_PX,
			rightSlotWidth === 0 ? DEFAULT_RIGHT_SLOT_WIDTH : rightSlotWidth,
		);

		/*
		 * How much THIS conversation's console has finished unseen, for the header's
		 * blip (design 12.2). Filtered by session because the trigger is in one
		 * conversation's header: a completion in another conversation's console must not
		 * light this one up.
		 *
		 * Read here rather than inside `ChatHeader` for the reason `browserAttentionCount`
		 * is: the marks are window state scoped to a conversation, and this component is
		 * where the conversation's identity lives.
		 */
		const consoleUnseenAll = useUiPreferencesStore((s) => s.consoleUnseen);
		const consoleUnseenMarks = useMemo(
			() =>
				sessionId === null
					? []
					: consoleUnseenAll.filter((mark) => mark.sessionId === sessionId),
			[consoleUnseenAll, sessionId],
		);
		const consoleUnseenPulsing = useConsoleBlipPulse(consoleUnseenMarks);

		/*
		 * How many approvals THIS conversation's agent is waiting on, for the header
		 * trigger's badge (spec 7.3).
		 *
		 * Read here rather than inside `ChatHeader` for the reason the header's own
		 * `listOnScreen` is passed in: the badge is a fact about the WINDOW's browser
		 * state scoped to this conversation, and this component is where the
		 * conversation's identity lives. It runs whether or not the pane is open, which is
		 * the point — a user who has never opened the pane is the one the badge is for.
		 *
		 * No session id means a draft, and a draft owns no requests: the hook answers 0
		 * rather than counting the whole app's queue for a conversation that does not
		 * exist yet.
		 */
		const browserAttentionCount = useConversationApprovals(sessionId ?? null);
		/*
		 * The run pane's RENDERED width, which is not always its preference.
		 *
		 * The wrapper below takes the preference as its `width` and NO floor, so flex
		 * shrinks it into the space the row actually has — the same rule the canvas
		 * dock follows one slot up, where a floor pinned at the dock's preferred width
		 * is what made the grid's fourth column unreachable. The pane's width-DERIVED
		 * layout (`tallyBudget`, and the section grammar the record measures at
		 * 320/420/640) has to be budgeted against the box it is drawn in: handed the
		 * preference, a shrunk pane sheds for a width it does not have and truncates at
		 * the width it does, which is the class of failure `tallyBudget`'s own docblock
		 * exists to prevent.
		 *
		 * Measured rather than derived: the pane's available width is what the ROW
		 * leaves it, and that depends on the rail, the chat list and the column's own
		 * 480px floor — three inputs this component does not compute. A `ResizeObserver`
		 * on the wrapper reports the box as it really is, including a drag of the
		 * divider, and a sub-pixel change is ignored so the pane cannot re-render in a
		 * loop against its own measurement.
		 */
		const runPanelRef = useRef<HTMLDivElement | null>(null);
		const runPanelRowRef = useRef<HTMLDivElement | null>(null);
		const chatColumnRef = useRef<HTMLDivElement | null>(null);
		const [renderedRunPanelWidth, setRenderedRunPanelWidth] = useState(
			effectiveRunPanelWidth,
		);
		/*
		 * How wide the pane COULD be drawn, as opposed to how wide it is.
		 *
		 * `renderedRunPanelWidth` says what the pane got; this says what the ROW can
		 * still give it, which is the row's width minus the chat column's own floor.
		 * The divider needs both, and the reason is round 2's U6: with the wrapper's
		 * floor gone, the pane's width is `min(preference, this)`, so a preference
		 * above this renders as this — the separator was announcing and accepting a
		 * number the pane was not drawn at, and a drag in a row that could not host it
		 * stored a width that only appeared later, out of context, when the rail or
		 * the window changed.
		 *
		 * The column's floor is READ from the element rather than assumed: it is a
		 * Tailwind class on the column beside the pane, and the one number this
		 * component must agree with is the one the browser actually applies.
		 */
		const [runPanelCapacity, setRunPanelCapacity] = useState(
			effectiveRunPanelWidth,
		);
		/*
		 * `useLayoutEffect`, not `useEffect`: the measured width FEEDS the pane's own
		 * budgets, so a passive effect would let the pane's first commit hand
		 * `tallyBudget` the 420px preference while the box on screen is 303px or 79px
		 * — the failure that budget exists to prevent, for one render. A non-discrete
		 * open (a reveal request consumed in an effect, a pane restored open on a
		 * session switch) does not get React's pre-paint passive flush, so this is the
		 * phase the measurement belongs in. `use-scroll-paging.ts` makes the same
		 * argument for the same reason.
		 */
		useLayoutEffect(() => {
			if (!isRunPanelOpen) return;
			const element = runPanelRef.current;
			if (!element) return;
			const measure = () => {
				const width = element.getBoundingClientRect().width;
				if (width <= 0) return;
				setRenderedRunPanelWidth((current) =>
					Math.abs(current - width) < 1 ? current : width,
				);
				const row = runPanelRowRef.current;
				const column = chatColumnRef.current;
				if (!row || !column) return;
				const columnFloor =
					Number.parseFloat(getComputedStyle(column).minWidth) ||
					CHAT_COLUMN_MIN_PX;
				const capacity = row.getBoundingClientRect().width - columnFloor;
				setRunPanelCapacity((current) =>
					Math.abs(current - capacity) < 1 ? current : capacity,
				);
			};
			measure();
			const observer = new ResizeObserver(measure);
			observer.observe(element);
			if (runPanelRowRef.current) observer.observe(runPanelRowRef.current);
			if (chatColumnRef.current) observer.observe(chatColumnRef.current);
			return () => observer.disconnect();
		}, [isRunPanelOpen]);
		/*
		 * THE ROW'S OWN WIDTH, which the canvas's mode is decided from (§I).
		 *
		 * Measured rather than computed from `window.innerWidth`: the row is the work area
		 * AFTER the sidebar has taken its width, and the sidebar is 0, 56 or 260 of those
		 * pixels depending on the band (`resolveSidebarLayout`) - so a window-width
		 * calculation here would re-derive a decision another module already owns, and
		 * would be wrong in exactly the two bands §I's order of yielding is about. The
		 * same idiom as the run panel's capacity above, for the same reason.
		 *
		 * It is measured whether or not the canvas is open: a resize while the pane is
		 * closed has to be accounted for by the time it opens, and the observer is one
		 * element.
		 */
		const [paneRowWidth, setPaneRowWidth] = useState(0);
		useLayoutEffect(() => {
			const row = runPanelRowRef.current;
			if (!row) return;
			const measure = () => setPaneRowWidth(row.getBoundingClientRect().width);
			measure();
			const observer = new ResizeObserver(measure);
			observer.observe(row);
			return () => observer.disconnect();
		}, []);
		/*
		 * §I's two canvas rules, from the one measured number: the pane DOCKED is
		 * `min(560, available - 480)`, and where that leaves less than the pane's own
		 * 400px floor it stops docking and draws at the leftover (`canvasPaneMode`
		 * states what the `overlay` literal draws today). `canvasDocked`
		 * is the mode (the divider and `data-canvas-mode` read it); the WIDTH is the
		 * slot resolver's own answer (`resolveRightSlotWidth`, `ui-preferences-store`),
		 * which is also what the chrome lane above the row calls — one number for the
		 * pane's leading edge rather than two that can disagree. The resolver's note
		 * carries the arithmetic, the stopped-dock case and the unmeasured frame, all
		 * three of which used to be restated here.
		 */
		const canvasDocked =
			canvasPaneMode(paneRowWidth || Number.MAX_SAFE_INTEGER) === "docked";
		const canvasWidth = useUiPreferencesStore((state) =>
			resolveRightSlotWidth(paneRowWidth, state),
		);
		/*
		 * THE DIVIDER'S CONTRACT, the shared one now (`rightSlotDividerContract`,
		 * `chat-sidebar-layout.ts`): what the separator announces and accepts is what
		 * the pane renders. The browser and console read the same function - they
		 * derive their capacity from the measured row where this pane measures it from
		 * its own elements - and their call sites record the defect it fixes there.
		 *
		 * `runDivider.resizable` is false when the row cannot host even the pane's own
		 * 320px contract floor — at 1024x673 with the rail expanded the row is 524px
		 * and the column's 480px floor leaves the pane 44px, so no preference the
		 * control is allowed to store (320..640) could render as itself. Resizing is
		 * then not a no-op that lies, it is not offered: the value is the drawn
		 * width, the range collapses onto it, and a write is refused so the user's
		 * stored preference survives intact for a window that can honour it.
		 * Otherwise the range ends at the capacity, which is what makes the stored
		 * preference and the drawn width the same number after any drag.
		 */
		const runDivider = rightSlotDividerContract({
			capacity: runPanelCapacity,
			min: RUN_PANEL_MIN_PX,
			max: RUN_PANEL_MAX_PX,
			drawn: renderedRunPanelWidth,
		});
		const handleRunPanelWidthChange = useCallback(
			(width: number) => {
				if (!runDivider.resizable) return;
				setRightSlotWidth(width);
			},
			[runDivider.resizable, setRightSlotWidth],
		);
		/*
		 * A RESET IS A DRAG, to the shared width's UNSET state — the separator's
		 * double-click, and its Enter, both land here — so it goes through the SAME
		 * clamped write a drag does. Since #677 the reset means "forget the shared
		 * width": every pane goes back to opening at the slot's one default, which is the
		 * only reading of "this pane back to how it opens" that does not hand this
		 * pane's default to its three siblings. The store's own reset writes the
		 * preference directly and knows nothing about the row, which is round 2's
		 * U6 on a different gesture: at 1024x673 with the rail expanded a direct
		 * write would unset the width while the pane went on rendering 304 and the
		 * number the control hands back would be one the pane does not use. Routing
		 * UNSET through the clamp leaves the stored preference alone in that state —
		 * the same refusal a drag gets — and forgets it wherever the row can host
		 * the pane's default.
		 */
		const handleRunPanelWidthReset = useCallback(() => {
			handleRunPanelWidthChange(0);
		}, [handleRunPanelWidthChange]);

		/*
		 * THE BROWSER'S AND CONSOLE'S SEPARATORS (D4), on the same contract as the
		 * block above. THE DEFECT THIS REPLACES: both separators were handed the
		 * PREFERENCE (`effectiveBrowserPanelWidth`) with `minWidth={480}
		 * maxWidth={1200}`, so at rows that cannot host the pane's floor - windows
		 * ~800-1024 once the panel rail takes its 44px - the separator announced
		 * aria-valuenow=640 / min 480 / max 1200 while the pane was drawn at 220.
		 * That is the round-2 U6 class the run panel fixed for itself; the contract
		 * hands over the DRAWN width and a range the row can honour, and the write
		 * (a drag or the reset) is refused where it cannot.
		 *
		 * The capacity is derived from the already-measured `paneRowWidth` - the same
		 * subtraction the run panel measures from its elements (row minus the
		 * conversation's floor) - and before the row's first measurement the pane's
		 * preference stands, the run panel's own convention (its capacity state
		 * starts there and the first measurement corrects it).
		 */
		const browserSlotCapacity =
			paneRowWidth > 0
				? Math.max(0, paneRowWidth - CHAT_PANE_MIN_PX)
				: effectiveBrowserPanelWidth;
		const browserDivider = rightSlotDividerContract({
			capacity: browserSlotCapacity,
			min: BROWSER_PANEL_MIN_PX,
			max: BROWSER_PANEL_MAX_PX,
			drawn: Math.min(effectiveBrowserPanelWidth, browserSlotCapacity),
		});
		const handleBrowserPanelWidthChange = useCallback(
			(width: number) => {
				if (!browserDivider.resizable) return;
				setRightSlotWidth(width);
			},
			[browserDivider.resizable, setRightSlotWidth],
		);
		const handleBrowserPanelWidthReset = useCallback(() => {
			handleBrowserPanelWidthChange(0);
		}, [handleBrowserPanelWidthChange]);

		const consoleSlotCapacity =
			paneRowWidth > 0
				? Math.max(0, paneRowWidth - CHAT_PANE_MIN_PX)
				: effectiveConsolePanelWidth;
		const consoleDivider = rightSlotDividerContract({
			capacity: consoleSlotCapacity,
			min: CONSOLE_PANEL_MIN_PX,
			max: CONSOLE_PANEL_MAX_PX,
			drawn: Math.min(effectiveConsolePanelWidth, consoleSlotCapacity),
		});
		const handleConsolePanelWidthChange = useCallback(
			(width: number) => {
				if (!consoleDivider.resizable) return;
				setRightSlotWidth(width);
			},
			[consoleDivider.resizable, setRightSlotWidth],
		);
		const handleConsolePanelWidthReset = useCallback(() => {
			handleConsolePanelWidthChange(0);
		}, [handleConsolePanelWidthChange]);

		const handleChangeActiveDocument = useCallback(
			(documentId: string) => setSelectedTab(conversationId, documentId),
			[conversationId, setSelectedTab],
		);

		const handleCloseCanvas = useCallback(() => {
			useUiPreferencesStore.getState().setCanvasOpen(false);
		}, []);

		/*
		 * The drawer's own dismiss door. It reports to the store rather than to local
		 * state because the flag it clears is the ask lane's one flag (the chip reads it,
		 * the composer's routing reads it), and closing by the X must be the same act as
		 * closing by Escape - `chat-page.tsx`'s window listener runs the same write.
		 */
		const handleCloseAskDrawer = useCallback(() => {
			setAskDrawerOpen(false, "session");
		}, [setAskDrawerOpen]);

		const handleCloseDocument = useCallback(
			(docId: string) => {
				// Remove from openTabs and files, update selectedTabId if needed
				const newTabs = openTabs.filter((tab) => tab.id !== docId);
				const newFiles = files.filter((file) => file.id !== docId);
				setOpenTabs(conversationId, newTabs);
				setFiles(conversationId, newFiles);
				if (selectedTabId === docId) {
					/*
					 * THE NEIGHBOUR, NOT THE OLDEST TAB (design review round 1, D1). This
					 * used to select `newTabs[0]`, so every close of a selected tab dropped
					 * the reader on the first document they ever opened - which breaks the
					 * repeated gesture the close is, and, because the strip scrolls the
					 * selection into view, slides the whole row back to the left under the
					 * pointer. The rule - following tab, or the preceding one when it was last
					 * - is `tabFollowingClose`, shared with the pane's own handler and with the
					 * strip's focus move so the three cannot disagree.
					 *
					 * Read off `files` rather than `openTabs` on purpose: `files` is the list
					 * the strip and the pane are drawn from, so its order - not `openTabs`' -
					 * is the one the reader sees and the one "neighbour" means.
					 */
					setSelectedTab(
						conversationId,
						tabFollowingClose(files, docId)?.id ?? null,
					);
				}
			},
			[
				conversationId,
				files,
				openTabs,
				selectedTabId,
				setFiles,
				setOpenTabs,
				setSelectedTab,
			],
		);

		// The tab strip is a development-only affordance, so the views only carry
		// tab semantics when it is on screen: in production there is no tablist,
		// and a `tabpanel` labelled by a tab that was never rendered is worse for
		// a screen reader than a plain region. Only the selected view is mounted,
		// which is why the strip puts `aria-controls` on the selected tab alone.
		const showTabs = isDevelopmentMode();
		const asTabPanel = (tab: ChatTabValue, view: ReactNode): ReactNode =>
			showTabs ? (
				<TabPanel id={CHAT_TAB_PANEL_IDS[tab]} labelledBy={CHAT_TAB_IDS[tab]}>
					{view}
				</TabPanel>
			) : (
				view
			);

		return (
			/*
			 * The chat column's height chain, stated once so it cannot drift back.
			 *
			 * A flex column only bounds its children if it can shrink below their
			 * content: `min-h-0` defeats the `min-height: auto` that flex items get
			 * by default, and `overflow-hidden` is what makes overflow CONTAINED
			 * rather than merely clipped several ancestors further up. Without both,
			 * the three children below over-declare their bases (84 + H + C against a
			 * container of H), the deficit is shared out by base size, and the header
			 * silently renders shorter than it declares - by a margin that MOVES with
			 * composer content. Measured in the running app before this fix: a header
			 * declaring 84px rendered 46.5px at 1380x872 and 61.4px at 1000x800.
			 *
			 * `w-0` on the column rather than `min-w-0`: the column must not be
			 * sized by its content (that is what lets a pinned-width canvas panel or
			 * a long unbroken token push it wider than its track), but it also keeps
			 * a deliberate 480px floor. `min-w-0` would fight `min-w-[480px]` for the
			 * same property and `cn` drops one of them silently, so the base size is
			 * zeroed instead and `flex-1` grows it back from there - the floor
			 * survives and the content no longer votes on the width.
			 */
			<div
				ref={runPanelRowRef}
				/*
				 * THE THREE BOXES §I IS WRITTEN ABOUT, addressable by name rather than by a
				 * scan: this row, the chat column inside it, and whichever pane occupies the
				 * slot beside it. The capture meter found the chat column by walking every
				 * element and matching its classes, which is how it missed the commit that
				 * HALVED the column and moved it to the right-hand third of the window (`x 900
				 * w 480`) while all of its other assertions passed; a named element is what the
				 * driver's `metrics` verb and that meter both read, and what a later rename
				 * cannot silently invalidate.
				 */
				data-tour-tag="pane-row"
				className="relative flex h-full w-full flex-row overflow-hidden"
			>
				{/*
				 * THE OPEN POLICY'S LIVE REGION (design review round 1, D1), and it is
				 * mounted HERE, on every commit of this pane, NOT inside `AskDrawer`: a
				 * region that mounts together with its content is frequently not
				 * announced, so the element exists with EMPTY text from the pane's first
				 * paint and only its CONTENT changes when the policy opens the drawer.
				 * The hook owns both edges (`useAskOpenPolicy`'s return): it writes one
				 * sentence on a policy open and clears it on close; a press on the chip
				 * or the header trigger - the reader's own act - writes neither, and a
				 * queue refresh is not an appearance. `sr-only`, so the visual surface
				 * is unchanged. On a draft (no `sessionId`) the hook waits forever and
				 * the sentence stays empty, which is correct: there is no conversation
				 * whose asks could open.
				 *
				 * `data-ask-open-announcer` NAMES THIS REGION FOR RIGS, the same way
				 * `data-condense-announcement` names the transcript's (its comment states
				 * the rule): `output[aria-live="polite"]` matches several regions on this
				 * route, so a rig reading "the first one" reads whichever happens to
				 * precede it and says nothing about this region (remediation round 1, D1).
				 */}
				<output
					data-ask-open-announcer=""
					className="sr-only"
					aria-live="polite"
				>
					{asksAnnouncement}
				</output>
				<div
					ref={chatColumnRef}
					data-tour-tag="chat-column"
					className="relative h-full w-0 min-w-[480px] flex-1"
				>
					{/*
					 * The working surface takes the PAGE ground, `canvas`, not the panel
					 * ground.
					 *
					 * The depth model this app is built on reads the planes left to
					 * right as CHROME and then the thing you are working on: the icon
					 * rail and the list panel beside it are both `surface`, and the
					 * working surface is `canvas`. The rail used to be the recessed
					 * `sunken` step; it is `surface` with a `border-r border-hairline`
					 * now, which is where the boundary its tonal step used to carry is
					 * DRAWN (`sidebar-navigation.tsx` states the model, and why the rail
					 * moved off the rung). This column was the one main area in the app
					 * painted `surface`, and `surface` is exactly what the list panel
					 * next to it uses - measured in the running app, the boundary
					 * between them was ΔE00 0 in every sampled theme, so the two read as
					 * one slab with nothing between them: no rule (the divider is
					 * `w-0`), no border, no step. Settings and agents already root their
					 * main area at `canvas`; chat was contradicting the model, not
					 * extending it.
					 *
					 * The step this creates is deliberately the SLIGHT one of the two,
					 * and it is the only boundary between list panel and working
					 * surface - no rule, no border, no shadow, because elevation in
					 * this system is a lightness step (branding § 2). `check-themes`
					 * already asserts `canvas`/`surface` and `surface`/`sunken` as
					 * adjacent ground pairs: across every palette `surface`→`canvas`
					 * measures ΔE00 2.05 (`sage`, the fleet's tightest) to 6.76
					 * (`radient`), against 3.96 (`iceberg`) to 14.88 (`synth`) for
					 * `surface`→`sunken`. The second of those is no longer a
					 * separation anything in the shell uses, because `sunken` is no
					 * longer a chrome ground: what separates chrome from WORK is the
					 * first, and the rail's own separation from the list panel beside
					 * it is the 1px rule it draws - `hairline` against the rail's
					 * `surface` measures ΔE00 7.13 on `localOperatorLight` and 5.37 at
					 * the fleet's tightest (`autumn`), a much stronger edge than this
					 * column's step. `hairline` owes perceptibility rather than a
					 * contrast floor (branding § 2), so that pair is measured here and
					 * read back from the frames in the row-states evidence README
					 * rather than asserted in `check-themes`.
					 *
					 * Everything inside this column that paints a ground of its own was
					 * sized against a `surface` column; the composer band and the legacy
					 * transcript scroller now inherit rather than name one, and the
					 * canonical user bubble carries a note. Each is annotated where it
					 * sits.
					 */}
					<div
						ref={chatContainerRef}
						className="flex h-full min-h-0 grow flex-col overflow-hidden rounded-none bg-canvas"
					>
						{/* Chat header */}
						{/*
						 * The conversation's own actions, offered only where they can act: a draft
						 * (`sessionId` undefined) has no conversation to archive and no route to
						 * delete with, so the menu and the pill are absent rather than disabled.
						 * `onSetArchived` is the row's own act reached from the header's door - one
						 * store path for both (see `archiveFromHeader`), so the header and the row
						 * cannot drift about what a press means - and since 2026-09-30 that path
						 * ASKS first for the archive half and writes straight through for the
						 * restore.
						 */}
						<ChatHeader
							agentName={agentName}
							description={description}
							descriptionPending={descriptionPending}
							identity={identity}
							deviceSlot={deviceSlot}
							renameSessionId={renameSessionId}
							/*
							 * THE COPY-SESSION-ID READ (#893): the same canonical id this component already
							 * carries as its own `sessionId` prop, passed on unchanged so the header's
							 * overflow menu copies what the pane is showing. Undefined on a draft, where
							 * the item is simply not drawn.
							 */
							sessionId={sessionId}
							onOpenOptions={onOpenOptions}
							runDetails={runDetails}
							/*
							 * EXACTLY ONE OWNER, DERIVED FROM THE STORE RATHER THAN MEASURED (chat
							 * redesign §J4). The right slot is exclusive - `claimRightSlot` clears the
							 * other panes when one opens - so either this header or an open pane's
							 * toolbar reaches the panel rail's left edge, and the two are never both
							 * true. That is the whole reason the reservation needs no measurement and
							 * no `ResizeObserver`: this component is the only one that renders both
							 * candidates, and the store already holds the fact. A pane's own toolbar
							 * reserves the corner in its own row (see the toolbars' note). The width
							 * reserved is what the OS buttons extend PAST the rail (#872), which the
							 * spacer's utility reads from the shell.
							 */
							reserveTrailingChrome={!rightSlotOccupied}
							/* THE PANELS' MENU DOOR: the four rail triggers moved to the panel rail
							   (rendered below through `InPanelRailHost`), and the header's `...` menu
							   keeps its four entries. The browser toggle is declared here for that
							   menu; the rail declares its own press from the same store field. */
							onToggleBrowser={() => setBrowserPaneOpen(!isBrowserPaneOpen)}
							/*
							 * THE ASKS DOOR: absent where the scope's backend offers no asks, and
							 * otherwise a toggle onto the drawer in the scope this conversation
							 * resolves to (see the block above). The press TOGGLES rather than only
							 * opening, so the control is the same door in both directions - the
							 * browser trigger's own idiom beside it.
							 */
							onToggleAsks={
								headerAsksOffered
									? () => setAskDrawerOpen(!headerAsksOpen, headerAsksScope)
									: undefined
							}
							asksAttentionCount={headerAsksCount}
							asksScope={headerAsksScope}
							asksOpen={headerAsksOpen}
							archiveEnabled={archiveEnabled}
							archived={archived}
							onSetArchived={
								sessionId ? (next) => archiveFromHeader(next) : undefined
							}
							deleteEnabled={deleteEnabled}
							onRequestDelete={
								sessionId ? () => requestSessionDelete(sessionId) : undefined
							}
							onOpenConsole={
								sessionId
									? () => {
											/*
											 * THE ONE PLACE A USER'S OPEN IS DECLARED, and the two facts are
											 * separate on purpose: claiming the slot is what shows the pane,
											 * and the request is what tells the pane this open came from the
											 * user — so it should run a first surface if the conversation has
											 * none and put the caret in the terminal either way (the store's
											 * `consoleOpenIntent` states the four ways this pane opens and why
											 * only this one means "I am about to type").
											 *
											 * THE REQUEST NAMES THIS CONVERSATION, because the pane is remounted
											 * on a session switch: a request still pending when the user switched
											 * would otherwise be answered by the next conversation's pane, which
											 * would run a shell nobody asked for there (agent review round 1, F-6).
											 *
											 * NEITHER IS DONE FOR THE OTHER TWO PATHS: a completion banner's
											 * click and main's `reveal` push both claim this slot from
											 * `app.tsx`, both already name a surface that exists, and the
											 * reveal is not the user's gesture at all — an agent's surface
											 * must not take the keyboard.
											 */
											setConsolePaneOpen(true);
											requestConsoleOpen(sessionId);
										}
									: /*
										 * OMITTED ON A DRAFT, as the archive and delete controls beside it are
										 * (`sessionId ? … : undefined`), and by the same house rule: the pane's
										 * only answer to a draft is "A console needs a conversation", so the
										 * trigger would be an offer the app cannot honour — a control that
										 * cannot act is not shown (design round 1, U3). The pane itself still
										 * opens on a draft from the restored preference, and its close control
										 * is there for that case.
										 */
										undefined
							}
						/>
						{/*
						 * WHAT THE LAST MOVE DID, directly under the header that issued it: the notice
						 * is about a request this pane made, so it belongs in the pane, above the
						 * transcript - not over the window's chrome, which belongs to the app.
						 */}
						{deviceNotice}
						{/*
						 * THE STATUS STRIP AND THE COMPATIBILITY BAND, IN THE PANE (§F2, D3).
						 *
						 * Both used to mount in the SHELL ROOT, above the window: the bands sat
						 * over the sidebar rail and under the traffic lights, spanning chrome
						 * that belongs to the app rather than to this conversation, and the
						 * same screen could state one connection fact twice. §F2's contract is
						 * that the strip lives INSIDE the conversation pane, under the top
						 * row, at most two lines, never spanning the sidebar.
						 *
						 * THE UPDATE FLOW KEEPS ITS OWN SURFACE, and this is the decision §F2
						 * leaves open rather than a quiet drop. `BackendCompatibilityBanner`
						 * owns a different fact - this backend's version, a pairing this app
						 * cannot make, and the UPDATE action that fixes it - and none of the
						 * four connection states in the strip has an update remedy. Folding it
						 * into the strip would either give the strip two root causes at once
						 * (the thing D3 is about) or lose the update control entirely. It is
						 * moved here instead: same component, same copy, same actions, now
						 * inside the pane beside the strip, so the pane owns every message
						 * about this conversation's backend and the window chrome owns none.
						 *
						 * The strip renders first, so a connection fault (which can stop a send)
						 * is above a setup fact (which cannot).
						 */}
						<ChatStatusStrip />
						<BackendCompatibilityBanner />
						{/*
						 * The one delete confirmation, rendered here because this component owns
						 * the conversation it asks about (`title`) and the run details whose
						 * children the copy has to mention. It renders nothing at all while no
						 * candidate is staged in the store, and BOTH callers - the header's menu
						 * and a typed `/delete` - reach it by staging one.
						 */}
						{deleteEnabled && (
							<DeleteConversationDialog
								title={agentName}
								hasSubagentRuns={(runDetails?.lineage.length ?? 0) > 0}
							/>
						)}
						{/*
						 * THE ARCHIVE CONFIRMATION IS NOT RENDERED HERE (UX round 1, U1). The
						 * row's control and `⌘⇧A` work on every route - the sidebar is on all of
						 * them - and this component exists only on `/chat`, so a dialog mounted
						 * here left a press from Settings staged with no host and then asked the
						 * question on the next visit to the chat. It is mounted once in
						 * `app.tsx`, beside the other app-wide dialogs; the two doors that start
						 * from this pane pass the pane's title on the candidate instead of as a
						 * prop.
						 */}
						{/* Chat Options Sidebar */}
						{!canonical && (
							<ChatOptionsSidebar
								open={isOptionsSidebarOpen}
								onClose={onCloseOptions}
								agentId={agentId}
							/>
						)}
						{/* Tabs for chat and raw - only shown in development mode */}
						{showTabs && (
							<ChatTabs activeTab={activeTab} onChange={onTabChange} />
						)}
						{/* In production, always show chat view. In development, respect the active tab */}
						{!showTabs || activeTab === "chat"
							? asTabPanel(
									"chat",
									/* Messages container: the canonical transcript is the only
									 * one there is. The legacy job/message list was reachable only
									 * through the socket transport, and the transport is gone. */
									<CanonicalTranscript
										frontend={canonical.view.frontend}
										transcript={canonical.view.transcript}
										undelivered={undeliveredOnScreen}
										/*
										 * THE ONE DERIVATION, here too (agent review
										 * round 2, N-1). This feeds the transcript's OWN
										 * working line and its liveness term, so reading
										 * the raw field left the one surface that DRAWS
										 * "the agent is parked on you" answering from the
										 * mirrored ask while the composer's term
										 * answered from `gate`.
										 */
										gate={gate}
										/*
										 * THE IN-FLIGHT CLAIM SURVIVES A RECEIPT GAP (operator
										 * incident, 2026-10-07): read through the pair, so the
										 * reconnects a busy session answers with do not blank the
										 * line - the same pair the controls and the send mode now
										 * read (round 1's D2; the prop's own note carries the
										 * decision).
										 */
										waiting={canonical.turnAlive}
										starting={canonical.starting === true}
										startingAfterId={canonical.startingAfterId ?? null}
										startingSession={canonical.startingSession === true}
										startingSince={canonical.startingSince ?? null}
										stopping={stoppingTurn}
										/*
										 * The disputed idle withholds the rung's clock (U9): the
										 * label stands - the work may be real - but the ticking
										 * number asserts a duration the pane just admitted it
										 * cannot vouch for. One fact with the sentence; see
										 * `idleDisputed` on the handle type.
										 */
										idleDisputed={canonical.idleDisputed === true}
										loadingOlder={canonical.view.loadingOlder}
										onLoadOlder={canonical.view.loadOlder}
										onLoadOlderOutcome={canonical.view.loadOlderDetailed}
										olderFailed={canonical.view.olderFailed}
										containerRef={messagesContainerRef}
										isSmallView={isSmallView}
										status={canonical.view.status}
										failure={canonical.view.failure}
										/*
										 * The reader's own question, and the same value the band
										 * below reads as `isHydrating`: the pane's hold and the
										 * band's claim are one decision with two readers, so
										 * they are handed one value rather than deriving it
										 * twice. `hydrated` is deliberately NOT that value: it
										 * answers "has a page been applied", which is false
										 * forever for a session-less draft - the pane held
										 * `Loading conversation…` over the splash that way.
										 */
										awaitingHydration={canonical.view.awaitingHydration}
										/*
										 * The end claim's PROOF, the sibling fact to the one above and
										 * needed beside it (remote-load-hydration): `awaitingHydration`
										 * ends the pane's wait, but `has_more: false` still needs a read
										 * that could SEE the conversation before "Start of conversation"
										 * is honest — a stored remote session's cold open answers from
										 * a facade with no owner, and the session hook refuses to count
										 * that answer as proof. `hydrated` is exactly that proof (a page
										 * has been applied) and stays false until one is; without it
										 * the slot renders "not loaded" and the retry below instead
										 * of the end copy.
										 */
										hydrationProven={canonical.view.hydrated}
										/*
										 * And whether a read is OUT right now (remote-load-hydration, UX
										 * round 1 U1): the retry arm's press must be acknowledged, so
										 * while the walk it fired is in flight the slot paints the
										 * pending row instead of repainting the identical "not loaded"
										 * row — and the session hook refuses a second walk while one
										 * is out, so a held press cannot stack reads either.
										 */
										historyReadPending={canonical.view.historyReadPending}
										/*
										 * And the retry that arm offers: the same history read the cold
										 * open fires, re-asked on the session handle — deliberately
										 * NOT the stream's `retry`, a heavier repair than this
										 * question needs (see `CanonicalSessionHandle.rehydrate`).
										 */
										onRetryHydration={canonical.view.rehydrate}
										/*
										 * The identity the composer BELOW is given as its
										 * `conversationId`, and deliberately the same local
										 * const rather than a second spelling of it: the
										 * conversation input store files a staged quote under
										 * this key and the composer reads its replies back out
										 * of it, so two derivations of "which conversation is
										 * this" is how a Quote press becomes a no-op that looks
										 * like a broken button (see the transcript's own note).
										 * That is why the composer's own `conversationId` and
										 * this one are both this const and not `agentId`
										 * written twice - they are equal today, and the point
										 * is that they cannot drift apart.
										 */
										conversationId={conversationId}
										labelPending={canonical.view.labelPending}
										labelHoldLate={canonical.view.labelHoldLate}
										labelMarked={canonical.view.labelMarked}
										onReconnect={canonical.view.retry}
										// The two states a notification click paints before the
										// owner answers: the rows may be this window's memory of
										// the conversation rather than the owner's, or the
										// conversation may not be on this machine at all.
										stale={canonical.view.stale}
										missing={gone}
									/>,
								)
							: asTabPanel(
									"raw",
									/* Raw information tab - only accessible in development mode */
									<RawInfoView content={rawInfoContent} />,
								)}
						{/*
						 * THE AGENT'S QUESTION, DOCKED at the composer's top edge (§F1).
						 * Outside the transcript's scroller on purpose: a card at the end of
						 * a long turn is off-screen, and the question is the one thing the
						 * agent is blocked on. It sits on the composer band's own inset and
						 * measure, so its edges are the composer's edges.
						 */}
						{/*
						 * THE QUEUED ASKS ARE NO LONGER MOUNTED HERE (design note §2: the side
						 * canvas). They used to be a column on this band, above the composer, with
						 * no chrome, no dismiss and no scroller of its own (D1/D2) - the panel is
						 * now the right slot's fifth occupant, below, where it shares the canvas
						 * family's chrome bar, scroller and width arithmetic. The BLOCKING dock
						 * stays on the band: it is a gate, not a queue, and §F1's argument for
						 * docking it at the composer's top edge still holds for it alone.
						 */}
						{/*
						 * THE BLOCKING DOCK, and the one rule a reader of both must know: once the
						 * queue is on the wire, an ask-shaped `pending_gate` is the backend's
						 * LEGACY MIRROR of an ask already in `asks[]`, so drawing it would show the
						 * same question twice (design §4, client rule N3). Approvals keep the
						 * single slot untouched - they have no queue to appear in.
						 */}
						{gate !== null && (
							<div
								className={cn(
									CHAT_COLUMN_CONTAINER,
									CHAT_COLUMN_INSET,
									"w-full shrink-0 pt-2",
								)}
							>
								<QuestionDock
									key={gate.request_id}
									className={CHAT_MEASURE}
									gate={gate}
									onAnswer={canonical.onAnswer}
									/*
									 * The secret field's own door, forwarded untouched like `onAnswer`:
									 * the dock decides WHEN a secret is answered from its field, and the
									 * panel owns the lock, the request and the report behind it.
									 */
									onAnswerSecret={canonical.onAnswerSecret}
									// The composer's own in-flight flag, reused: one answer per
									// question, whichever surface starts it.
									answering={Boolean(canonical.admitting)}
									// This panel's own record of the gate it pressed, so the card
									// holds itself disabled after an answer instead of coming back
									// live against a gate the owner already took.
									answer={canonical.answer ?? null}
								/>
							</div>
						)}
						{/*
						 * THE STOPPED TURN'S OWN LINE (§G3). Above the composer and below the transcript's
						 * own dock, which is where a turn that has ENDED can say so without being part of
						 * the conversation it ended: the transcript is the record of what was said, and
						 * this is the pane's statement about the run.
						 *
						 * IT TAKES THE CONVERSATION'S SHARED MEASURE, and the wrapper is what declares
						 * it: `CHAT_MEASURE`'s cap and centring are keyed to the named chatcol container
						 * (`@min-[750px]/chatcol`), so a row with no named container anywhere above it
						 * matches NEITHER variant - the line keeps `w-full` and paints at the column's
						 * 24px inset while every surface that does declare one centres into the measure.
						 * That is the operator's report of 2026-09-27: at a 1120px column the line sat at
						 * x=284 (column + inset) against the composer box's x=370 (column + 110), 86px
						 * apart. The dock above and the composer band below already declare the container
						 * for the same reason; this row is a third consumer and declares it the same way.
						 *
						 * The retry RE-SENDS THE TURN through the same door the composer uses
						 * (`onSendMessage` is the page's own `send`), so it carries the same admission,
						 * the same echo and the same failure handling as a press on Enter — a second send
						 * path would be the defect, not the fix.
						 */}
						{/*
						 * WHAT THE BAND IS GATED ON, and why each term is here (operator
						 * incident, 2026-10-07; the sibling trace's fix 1):
						 *
						 * - `stoppedTurnAt !== null` is the fact the press wrote, which
						 *   survives until the next turn so the reducer can classify a killed
						 *   call's end event (see `stoppedTurns`).
						 * - `!canonical.turnAlive` is the guarantee this band exists for:
						 *   "Stopped · Retry" says a turn ENDED, so it must not render while
						 *   the turn is still running. It reads the SAME pair the working
						 *   line reads, because during a receipt gap the raw reading is false
						 *   while the last reading still says "streaming" - the live-turn
						 *   case, not the ended one.
						 * - `canonical.stopOutcome !== "unconfirmed"` is the answer's own
						 *   end: a press whose response was lost leaves the fact standing
						 *   for classification but must not PAINT a stopped turn - nothing
						 *   ever confirmed this turn stopped, and the composer carries the
						 *   sentence saying so.
						 */}
						{stoppedTurnAt !== null &&
							!canonical.turnAlive &&
							canonical.stopOutcome !== "unconfirmed" && (
								<div
									className={cn(
										CHAT_COLUMN_CONTAINER,
										CHAT_COLUMN_INSET,
										"w-full shrink-0 pt-2",
									)}
								>
									<p
										data-stopped-turn
										className={cn(
											"flex items-center gap-2 text-ink-dim text-meta",
											CHAT_MEASURE,
										)}
									>
										<span>Stopped</span>
										{stoppedRetryText !== null && (
											<>
												<span aria-hidden="true">·</span>
												<button
													type="button"
													data-stopped-retry
													onClick={() =>
														void onSendMessage(stoppedRetryText, [])
													}
													className="rounded-sm text-ink-muted underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
												>
													Retry
												</button>
											</>
										)}
									</p>
								</div>
							)}
						{/* Message input */}
						{(canonical || !(isLoadingMessages && messages.length === 0)) && (
							<MessageInput
								ref={messageInputRef}
								onSendMessage={onSendMessage}
								onComposerInput={onComposerInput}
								initialSuggestions={DEFAULT_MESSAGE_SUGGESTIONS}
								noProvider={needsProvider}
								noModel={needsModel}
								deviceHold={deviceHold}
								/*
								 * THE WAY BACK TO THE FAILED ROW'S CONTROLS (UX round 1, U3): the
								 * line is on screen in this transcript, and the composer names it for
								 * the reader whose focus is in the box. Read from the SAME
								 * `undeliveredOnScreen` the transcript and the composer's own
								 * stand-down read, so the hint cannot outlive the line.
								 */
								deliveryRemediesReachable={undeliveredOnScreen !== null}
								/*
								 * The two host seams, straight from the reads above: the
								 * credential probe's answer and the callback that invalidates
								 * the credentials key the picker reads after a store. See
								 * `MessageInputProps.onCredentialsStored`/`recordingProbe`
								 * for why they live out here now.
								 */
								onCredentialsStored={invalidateStoredCredentials}
								recordingProbe={recordingProbe}
								/*
								 * NO ASK-MODE SENTENCE OR FLAG REACHES THIS BOX. It used to receive the
								 * answer-mode invitation (`placeholderOverride`) and an `askMode` flag
								 * while the drawer was open, because its Enter was routed into the ask
								 * (design §5.0, R7). The operator reversed that on 2026-10-07: this
								 * box keeps its own placeholder in every state and a send is a chat
								 * message. Do not re-add either prop here - the `Other` answer has its
								 * own field inside the card.
								 *
								 * THE ASK LANE'S DOOR, forwarded to the STATUS ROW rather than to the
								 * drawer: the trigger is a row item now, and the page owns the ONE flag that
								 * row and the drawer both read (`chat-page.tsx`'s `askExpanded`, the
								 * store's `isAskDrawerOpen`). Handing the same `canonical` pair to both keeps
								 * the row item's state and the drawer's state the same state - a second copy
								 * is the one thing that rule forbids.
								 */
								askExpanded={canonical?.askExpanded}
								onAskToggle={canonical?.onAskToggle}
								askOutcomes={canonical?.askOutcomes}
								isLoading={
									canonical
										? Boolean(canonical.admitting || canonical.starting)
										: isLoading
								}
								/*
								 * `isLoading` IS THE ONLY SEND FACT THIS COMPONENT PASSES. Whether a
								 * send for this conversation is still going out is NOT threaded from
								 * here: the composer derives it from the STORE's own row
								 * (`sendUnsettledForSession`), and review round 2's R2-1 is why. This
								 * component is mounted BY the panel the New-chat identity flip
								 * replaces, so a value it had to hand down would be as absent on the
								 * replacement as the panel's own state was - while the row is state of
								 * the conversation and every mount reads it.
								 */
								/*
								 * Derived from the same expression the transcript's own line is, so
								 * the two surfaces cannot disagree about whether work is being
								 * claimed: a pending question and a TERMINAL transport statement
								 * both retire this hint with the line (review round 2, R2-3;
								 * design round 2, D5) - and, like the transcript's rung, NOT a
								 * reconnect (operator incident, 2026-10-07: read raw, the hint
								 * went dark on every ~1.5-4 s gap while the turn ran). Reading
								 * the latch directly is what let the composer keep saying
								 * "Waiting for the agent" 46px below a pane that had withdrawn
								 * exactly that claim.
								 */
								awaitingReply={Boolean(
									canonical &&
										workingLineClaimed(
											workingLineInputFor({
												waiting: canonical.turnAlive,
												// The compacting pass is claimed from the same transcript the line
												// below reads, so the hint and the rung cannot disagree.
												compacting:
													canonical.view.transcript.compacting === true,
												compactingSince:
													canonical.view.transcript.compactingSince,
												starting: canonical.starting === true,
												startingAfterId: canonical.startingAfterId ?? null,
												startingSession: canonical.startingSession === true,
												startingSince: canonical.startingSince ?? null,
												// The same press window the rung reads (one expression, see
												// `stoppingTurn`), so a Stop press turns the hint into the
												// cancel statement (and never a restarting clock - the
												// rung's own test carries that rule).
												stopping: stoppingTurn,
												gate,
												unavailable: canonicalTerminal(canonical, gone),
												records: canonical.view.transcript.records,
											}),
										),
								)}
								conversationId={conversationId}
								messages={
									canonical
										? /*
											 * A send this pane has admitted counts as content here, and that is
											 * a correction rather than a nicety: with zero records the
											 * greeting's branch renders into the column and the transcript is
											 * left no height at all (`canonical-transcript.tsx`'s `collapsed`),
											 * so the rung existed in the DOM through the whole cold engage and
											 * never painted a pixel — the operator's dead-air window, unchanged
											 * (QA round 1, Q1). The pane is not empty once a message is on its
											 * way: "What can I help you with today?" and the suggestion chips
											 * are claims about a conversation that has already started.
											 *
											 * `canonicalSpeaking` is the other half of the same question, for
											 * the states where the pane speaks for itself (a failure notice, a
											 * reconnect) rather than answering anybody.
											 */
											canonical.view.transcript.records.length > 0 ||
											canonicalSpeaking(canonical, gone) ||
											canonical.starting
											? CANONICAL_NONEMPTY
											: messages.length > 0
												? messages
												: EMPTY_MESSAGES
										: messages
								}
								// A cold session's history is still being fetched while the
								// canonical stream is "connecting", and an empty record
								// list is indistinguishable from a settled empty
								// conversation -- so the app asserted "no messages yet"
								// before it knew, then repainted when history arrived
								// (design D7's hydration note). Passing the real state
								// lets the composer wait instead of guessing.
								//
								// The rule is NOT "the stream is connecting" any more. That
								// asked the transport a question the reader was asking about
								// the CONVERSATION: a stream that failed, or one whose
								// history read did, is not "connecting", so the composer
								// asserted the empty-conversation greeting over rows that
								// had existed the whole time.
								//
								// `awaitingHydration` is the reader's actual question -- is a
								// page for THIS session still owed -- so the loading state
								// holds until the app genuinely knows, whether that takes a
								// retry or not. It is composed by the canonical session
								// handle (see its docstring) rather than from `hydrated`
								// alone, because "no page has been applied" is equally true
								// of a New chat's draft, which has no session and therefore
								// no page to wait for -- the stuck skeleton this band showed
								// instead of the greeting and its suggestion chips.
								//
								// The statement term the pane's own hold grew alongside this
								// one (a pane already saying what went wrong is not "still
								// hydrating") is deliberately not repeated: it guards a state
								// this band cannot reach, because a speaking pane is handed
								// `CANONICAL_NONEMPTY` above, so the greeting is withheld
								// before this prop is read - and the refusal it stands down
								// for is a state in which a page IS owed, which is exactly
								// the claim this band makes.
								isHydrating={
									canonical ? canonical.view.awaitingHydration : false
								}
								/*
								 * U8: a pending question is answered in this box, so the box
								 * says so instead of inviting a message. The card above owns the
								 * question and the reply it expects; this only stops the
								 * composer reading "Ask me for help" over a turn that is waiting
								 * on the user (UX round 2, U8).
								 */
								awaitingAnswer={gate !== null}
								/*
								 * AND WHETHER THAT QUESTION TAKES A SECRET: the composer refuses
								 * input while one waits (`message-input.tsx` reads this as
								 * `secretAnswer`), because a credential must never be typed into a
								 * surface that cannot mask it — the answer belongs to the dock's own
								 * field. Through `gateIsSecret`, the ONE predicate every consumer of
								 * that reading shares (agent review round 1, NIT-1): the field arm,
								 * the page's send refusal and the answer door read it too, so a
								 * value the wire means as secret cannot be masked on one surface
								 * while this one stays open — the mix that re-opened the exposure.
								 */
								/*
								 * AND AN OPEN ASK THAT IS SECRET-ONLY REFUSES IT TOO (agent review
								 * round 3, F3). With `asks` on the wire the mirrored gate is
								 * suppressed, so this term was false while a secret ask waited, and
								 * the box would have stayed open while a credential was being asked
								 * for - which is where a typed credential becomes a chat message.
								 * The panel's masked field is the only door for it.
								 *
								 * THIS IS A CREDENTIAL-SAFETY RULE, NOT ROUTING. The composer no
								 * longer answers an ask in any state (design 5.0's R7, reversed on
								 * 2026-10-07), so nothing here says the box is "the answer box" or
								 * "not the ask mode": a secret-only ask simply must not leave an
								 * open box beside it. A question that is not secret leaves the box
								 * an ordinary chat field.
								 */
								secretAnswer={
									gateIsSecret(gate) ||
									askComposerHoldsSecret(askQueueView(canonical?.view.frontend))
								}
								// A conversation the backend says is gone is a KNOWN
								// answer, so the composer refuses input rather than
								// accepting a message that can only 404. The pane above
								// carries the sentence and the way out (M6); this only
								// refuses the keystroke.
								unavailable={conversationUnavailable}
								currentJobId={canonical ? null : currentJobId}
								onCancelJob={onCancelJob}
								canonicalStop={canonicalStop}
								/*
								 * The aside panel's two reads, handed down as the two facts they are rather
								 * than as a handle to re-derive them from: the SESSION the panel is keyed by
								 * (`sessionId` is the identity a backend route resolves, which is what
								 * `sessions.aside` addresses) and whether that session is mid-turn — the
								 * second term of the adopt gate, read from the same `canonical.turnAlive` the
								 * Stop control beside it uses so the two cannot disagree (both read the pair
								 * since round 1's D2). Undefined on a pane with no session, where no aside
								 * can be attached at all.
								 */
								asideSessionId={sessionId}
								asideStreaming={canonical.turnAlive}
								/*
								 * The capability itself, not just its busy half: the composer
								 * holds the control's SLOT while a turn runs and for a grace
								 * window after it ends, so the dictation control cannot take the
								 * centre a reflex second press lands on (UX round 1's U1 / QA's
								 * Q1) - and once the row has settled the slot is empty, so
								 * dictation sits beside Send rather than behind a standing gap
								 * (the operator's report on that fix). Without the capability
								 * there is nothing to hold either way: a gap that nothing will
								 * ever fill is not a reservation.
								 */
								canonicalStopAvailable={canonical?.stopAvailable ?? false}
								interruptNotice={canonical?.stopNotice ?? null}
								isFarFromBottom={isFarFromBottom}
								hasNewActivity={hasNewActivity}
								scrollToBottom={scrollToBottom}
								agentData={agentData}
								cwd={cwd}
								mentionsEnabled={mentionsEnabled}
								mentionsUnsupported={mentionsUnsupported}
								cwdWritePath={cwdWritePath}
								cwdPending={cwdPending}
								cwdPendingAccepted={cwdPendingAccepted}
								cwdReadOnlyReason={cwdReadOnlyReason}
								sendError={sendError}
								sessionStatus={sessionStatus}
								onSlashCommand={onSlashCommand}
								onSlashNote={onSlashNote}
								/*
								 * The pane's own answer, forwarded untouched: whether a command can address
								 * a session here is the dispatcher's question and only the page that built
								 * it can answer — the composer's `sessionStatus` and `conversationId` are
								 * both present on a draft pane (UX U1).
								 */
								paneHasSession={paneHasSession}
								/*
								 * The SAME derived model the header trigger and the pane read, handed
								 * to the composer so its status row states the plan's size without a
								 * second tally (spec § 3.2). `null` on every path with no canonical
								 * session, which is also what keeps the row off a legacy pane.
								 */
								runDetails={runDetails}
								isSmallView={isSmallView}
							/>
						)}
					</div>
				</div>

				{isCanvasOpen && (
					<>
						{/*
						 * THE DIVIDER EXISTS ONLY WHILE THE CANVAS DOCKS (§I). In the overlay mode
						 * there is nothing drawing a flow boundary to drag: the pane has stopped
						 * docking and draws at the slot's leftover (`canvasPaneMode` carries the
						 * mode's note), so a separator here would be a control for a layout that is
						 * not on screen.
						 */}
						{canvasDocked && (
							<ResizableDivider
								sidebarWidth={canvasWidth}
								onSidebarWidthChange={setRightSlotWidth}
								minWidth={CANVAS_PANE_MIN_PX}
								/*
								 * THE RANGE IS WHAT THE PANE RENDERS (review round 1, U2): the
								 * canvas draws `min(preference, dock cap)`, so a divider accepting up
								 * to 1200 let one drag store 660/760/960/1200 while the canvas stayed
								 * at its 560 cap — numbers the BROWSER pane then rendered, i.e. a drag
								 * that moved a pane that was not on screen. Capped at the same
								 * `canvasDockWidth` the resolver uses; before the row is measured the
								 * range collapses onto the floor until a row exists, the run
								 * divider's own shape.
								 */
								maxWidth={Math.max(
									CANVAS_PANE_MIN_PX,
									canvasDockWidth(paneRowWidth),
								)}
								side="left"
								onDoubleClick={restoreDefaultRightSlotWidth}
								label="Resize canvas. Double-click resets the shared pane width."
							/>
						)}
						<PaneSlot
							ref={canvasContainerRef}
							width={canvasWidth}
							tourTag="canvas-dock"
							/*
							 * THE MODE AS A FACT ON THE ELEMENT, rather than something a reader has to
							 * infer from a width. §I's two shapes - docked beside the chat, or stopped
							 * docking once the row cannot give it 400 - are what the driver scene and
							 * the capture meter assert against, and a mode reverse-engineered from a
							 * number is a mode a test gets subtly wrong.
							 */
							data-canvas-mode={canvasDocked ? "docked" : "overlay"}
						>
							<Canvas
								activeDocumentId={selectedTabId}
								/*
								 * THE BUFFER OWNER'S WORDS, WHERE IT STILL HAS SOME (this change's fix for
								 * the close). `files` is the list of OPEN documents and stays that list -
								 * this is a projection over it, not a second one: a document whose buffer
								 * holds words the write gate refused (the file moved on disk under the
								 * reader) is handed to the canvas as those words, at the mtime they were
								 * read, instead of as the file's bytes. Without it a close would drop them:
								 * closing a tab takes the document out of `files`, opening it again goes
								 * through the files grid and re-reads the FILE, and the editor mounts from
								 * whatever document it is handed. See `documentsForCanvas` for the promise
								 * (in-session, and why).
								 */
								initialDocuments={documentsForCanvas(files)}
								conversationId={conversationId}
								agentId={agentId}
								sessionId={sessionId}
								turnTerminal={turnTerminal}
								currentWorkingDirectory={cwd}
								fileCount={mentionedFileCount}
								scan={filesScan}
								/*
								 * The pane's goals come off the SAME canonical frontend the composer
								 * row reads, so the chip and the pane cannot describe one session's
								 * history differently.
								 *
								 * AND THE SAME PRESENCE CHECK, READ ONCE, HERE (UX round 1, U4):
								 * `goalCapability` is the chip's own gate — `typeof goal_status ===
								 * "string"` — called on the same snapshot and handed down as one
								 * boolean, so the pane's fourth segment cannot exist on a backend whose
								 * goal controls the chip refuses to render. An older backend publishes
								 * neither field, and the defaults below are then what a view this build
								 * does not offer would have read.
								 */
								goalCapable={goalCapability(canonical?.view.frontend)}
								/*
								 * The empty state's description is gated on whether a goal EXISTS at all,
								 * not on whether one has settled (design review round 2, D2): read off the
								 * same snapshot as the capability above, so the pane cannot tell a user to
								 * set a goal the chip two panes over is already showing.
								 */
								goalPresent={goalPresent(canonical?.view.frontend)}
								goalHistory={canonical?.view.frontend?.goal_history}
								goalHistoryTruncated={
									canonical?.view.frontend?.goal_history_truncated === true
								}
								onChangeActiveDocument={handleChangeActiveDocument}
								onClose={handleCloseCanvas}
								onCloseDocument={handleCloseDocument}
							/>
						</PaneSlot>
					</>
				)}

				{/*
				 * THE ASKS DRAWER (design note §2): the SAME slot as the canvas, and the same
				 * three pieces, because the container decision is that the ask queue must be a
				 * member of the canvas family rather than a second drawer idiom. What it fixes
				 * is structural rather than cosmetic: a 40px chrome bar with its own dismiss, a
				 * scroller of its own (D1 - the panel had none, so a long queue's last card was
				 * unreachable), and a width that is the family's arithmetic, so the card can no
				 * longer be the widest thing on the screen (D5) without a width rule of its own.
				 *
				 * ONE RIGHT PANE AT A TIME: `setAskDrawerOpen` closes the canvas and
				 * `setCanvasOpen` closes this, through the store's `claimRightSlot`, so only one
				 * of these blocks can ever be mounted and neither needs a guard against the
				 * other.
				 */}
				{sessionAsksOpen && (
					<>
						{/*
						 * The divider exists only while the drawer DOCKS, for the reason the canvas's
						 * own divider states: in the overlay mode there is no flow boundary to drag.
						 * Its range is the same `canvasDockWidth` the resolver caps the width at, so
						 * a drag cannot store a number the pane does not render.
						 */}
						{canvasDocked && (
							<ResizableDivider
								sidebarWidth={canvasWidth}
								onSidebarWidthChange={setRightSlotWidth}
								minWidth={CANVAS_PANE_MIN_PX}
								maxWidth={Math.max(
									CANVAS_PANE_MIN_PX,
									canvasDockWidth(paneRowWidth),
								)}
								side="left"
								onDoubleClick={restoreDefaultRightSlotWidth}
								label="Resize asks. Double-click resets the shared pane width."
							/>
						)}
						{/*
						 * `canvasWidth` here is the SLOT's width, not the canvas's: it is
						 * `resolveRightSlotWidth`, which answers for whichever pane the store has
						 * open - and the canvas and this drawer are exclusive, so one call serves
						 * both. A second derivation would be the two-answers-to-one-number defect
						 * the store's resolver exists to prevent.
						 */}
						<PaneSlot
							width={canvasWidth}
							tourTag="ask-drawer-slot"
							/*
							 * THE MODE THE SLOT RESOLVED FOR THIS DRAWER - `docked` beside the
							 * conversation, `overlay` when the row cannot host it - written for a rig to
							 * read, mirroring the canvas dock's own `data-canvas-mode` (read by
							 * `scripts/renderer-driver.mjs`'s canvas-dock probe). Its reader is
							 * `scripts/pane-slot-ground.test.mjs`, which pins both values on this call
							 * site (agent review round 1, N3); the frames under
							 * `docs/evidence/ask-drawer/after/dock-asks/` are the visual half.
							 */
							data-ask-mode={canvasDocked ? "docked" : "overlay"}
						>
							<AskDrawer
								frontend={canonical?.view.frontend ?? null}
								/*
								 * SESSION-SCOPED, because this mount is the conversation's own: its rows
								 * arrive on this session's frame and its answers go to this session.
								 * The fleet scope is the other half and lives in the SHELL
								 * (`chat-layout.tsx`) - it spans conversations, and its entry point
								 * (the header's asks trigger at the top level) is drawn on every route, so a
								 * mount here
								 * would leave that door opening nothing wherever the user happened to
								 * be. One container, two homes, one flag: the scope is what picks,
								 * which is why this block is gated on it above.
								 */
								scope="session"
								onClose={handleCloseAskDrawer}
								onAnswer={canonical?.onAnswerAsk}
								onDecline={canonical?.onDeclineAsk}
								onRevise={canonical?.onReviseAsk}
								answering={Boolean(canonical?.admitting)}
								outcomes={canonical?.askOutcomes}
								drafts={canonical?.askDrafts}
								onDraftChange={canonical?.onAskDraftChange}
							/>
						</PaneSlot>
					</>
				)}

				{/*
				 * The run panel: the SAME slot, mutually exclusive with the canvas by
				 * construction (`setRunPanelOpen`/`setCanvasOpen` each clear the other), so
				 * only one of these two blocks can ever be mounted and neither needs a
				 * guard against the other. It reuses the canvas's own three pieces — the
				 * divider, the shrinkable wrapper with the `border-l` seam, and a root
				 * element — because the pane mechanics are the slot's rather than either
				 * occupant's. The divider takes its own label: two separators named
				 * "Resize canvas" 8px apart are indistinguishable to a screen reader.
				 *
				 * The width range is the design's (320..640, opening at the slot's one
				 * default), narrower than the canvas's
				 * because a roster and a prose transcript do not need a document pane's
				 * room, and the pane does NOT auto-hide at narrow widths: the operator
				 * asked for persistence, and a pane that disappears below a breakpoint is
				 * the defect this replaces in a new costume.
				 */}
				{isRunPanelOpen && runDetails && (
					<>
						<ResizableDivider
							sidebarWidth={runDivider.value}
							onSidebarWidthChange={handleRunPanelWidthChange}
							minWidth={runDivider.minWidth}
							maxWidth={runDivider.maxWidth}
							side="left"
							onDoubleClick={handleRunPanelWidthReset}
							label="Resize run details. Double-click resets the shared pane width."
						/>
						<PaneSlot
							ref={runPanelRef}
							width={effectiveRunPanelWidth}
							tourTag="run-panel-dock"
						>
							<RunPanel
								details={runDetails}
								mcpServers={mcpServers}
								mcpGrantRunning={mcpGrantRunning}
								mcpRemedy={mcpRemedy}
								monitorControls={monitorControls}
								sessionId={canonical?.view.frontend?.session_id ?? null}
								pulses={pulses ?? EMPTY_PULSES}
								childrenOpenable={childrenOpenable}
								/*
								 * The session's own transport truth, and the SAME predicate the
								 * transcript above hands its own slot (`status !== "live"`). The
								 * child reader's page is a read-only GET with no stream of its
								 * own, so its older-history row can only know this by being told,
								 * and one transport must not be read two ways in one window
								 * (design round 1, D2). A window with no canonical session has
								 * no stream to be down — no child reader can be open in it —
								 * and reads as live.
								 */
								olderTransportDown={
									(canonical?.view.status ?? "live") !== "live"
								}
								/*
								 * The pane's own width, in pixels: the box it is actually drawn in
								 * (`renderedRunPanelWidth`, measured on the wrapper above), not the
								 * preference the wrapper asks for. The two differ whenever the row
								 * cannot host the preference — a narrow window, or a wide rail — and
								 * only the measured one is a width this pane has. The pane owns its
								 * width; the sections whose tallies are budgeted against it (`§ 8`)
								 * receive it rather than measuring themselves, so a section can
								 * never disagree with the pane it is drawn in at the window floor.
								 */
								paneWidth={renderedRunPanelWidth}
								readerChildId={readerChildId}
								onReaderChildChange={setReaderChildId}
								onClose={() => setRunPanelOpen(false)}
							/>
						</PaneSlot>
					</>
				)}

				{/*
				 * The conversation's browser: the THIRD occupant of this slot, mutually
				 * exclusive with the other two by construction (`claimRightSlot` clears the
				 * losing sides), so only one of the three blocks can ever be mounted and
				 * none needs a guard against another. It reuses the canvas's three pieces —
				 * the divider, the pinned-width wrapper with the `border-l` seam, and a root
				 * element — because the pane mechanics are the slot's rather than either
				 * occupant's.
				 *
				 * THE DIVIDER'S FLOOR IS 480 AND NOTHING ELSE ENFORCES IT: `maxWidth` matches
				 * the canvas's 1200 because a page is a document and wants a document's room,
				 * and the floor is the DRAG limit rather than a `minWidth` on this wrapper —
				 * the canvas's own note records what a pinned floor costs (it made a column
				 * unreachable at the app's default window, because a floor larger than the
				 * space available is clipped by the row and no scroll container in between can
				 * reach it). A page narrower than 480px is a mobile column with its layout
				 * broken, which is why the drag stops there rather than why the flex row must.
				 *
				 * NO AUTO-HIDE AT NARROW WIDTHS, for the reason the run panel states: the
				 * operator asked for persistence, and a pane that disappears below a
				 * breakpoint is the defect this replaces in a new costume.
				 */}
				{isBrowserPaneOpen && (
					<>
						<ResizableDivider
							sidebarWidth={browserDivider.value}
							onSidebarWidthChange={handleBrowserPanelWidthChange}
							minWidth={browserDivider.minWidth}
							maxWidth={browserDivider.maxWidth}
							side="left"
							onDoubleClick={handleBrowserPanelWidthReset}
							label="Resize browser. Double-click resets the shared pane width."
						/>
						<PaneSlot
							width={effectiveBrowserPanelWidth}
							tourTag="browser-pane-slot"
						>
							{/*
							 * The session id as a SCOPE rather than as a page: the pane renders the
							 * same surface the route does, scoped to this conversation (spec 7.1).
							 * `null` on a draft, where there is no set to scope to — the pane then
							 * shows All tabs with the conversation side disabled
							 * (`browser-pane.tsx` states why that is the honest reading).
							 */}
							<BrowserPane
								sessionId={sessionId ?? null}
								onClose={() => setBrowserPaneOpen(false)}
							/>
						</PaneSlot>
					</>
				)}
				{/*
				 * The console: the FOURTH occupant of this slot (§6.1), mutually exclusive
				 * with the other three by construction (`claimRightSlot`), and built from
				 * the same three pieces the browser pane reuses — the divider, the wrapper
				 * with the `border-l` seam, and a root element — because those mechanics
				 * belong to the slot rather than to any occupant.
				 *
				 * THE DIVIDER'S FLOOR IS 480, the browser pane's own (§6.1 asks for it by
				 * that number): a terminal pane narrower than its grid rows start wrapping
				 * into a soup, and the surface's 40-column floor is MAIN's, not this drag's
				 * (§8.5) — the pane crops horizontally rather than shrinking the grid below
				 * what a program can use.
				 */}
				{isConsolePaneOpen && (
					<>
						<ResizableDivider
							sidebarWidth={consoleDivider.value}
							onSidebarWidthChange={handleConsolePanelWidthChange}
							minWidth={consoleDivider.minWidth}
							maxWidth={consoleDivider.maxWidth}
							side="left"
							onDoubleClick={handleConsolePanelWidthReset}
							label="Resize console. Double-click resets the shared pane width."
						/>
						<PaneSlot
							width={effectiveConsolePanelWidth}
							tourTag="console-pane-slot"
						>
							<ConsolePane
								sessionId={sessionId ?? null}
								onClose={() => setConsolePaneOpen(false)}
							/>
						</PaneSlot>
					</>
				)}
				{/*
				 * THE PANEL RAIL (#872), rendered here and drawn at the window's edge. This
				 * component owns every input the four triggers need (the conversation, the
				 * run view model and its acknowledgement context, the approvals count, the
				 * console's unseen marks, the file count), and the shell owns the element
				 * that sits beside the measured column; the portal joins the two without
				 * either importing the other's tree. It renders NOTHING when no shell host
				 * is provided, so a story that mounts this component alone is unchanged.
				 *
				 * It is mounted with the chat surface and unmounts with it, which is also
				 * what the `mounted` route fact says (the shell sizes the host from it), so
				 * the host's width and the rail's presence cannot disagree.
				 */}
				<InPanelRailHost>
					<PanelRail
						sessionId={sessionId ?? null}
						runDetails={runDetails ?? null}
						mcpServers={mcpServers}
						listOnScreen={listOnScreen}
						readerChildId={readerChildId}
						browserAttentionCount={browserAttentionCount}
						consoleUnseenCount={consoleUnseenMarks.length}
						consoleUnseenPulsing={consoleUnseenPulsing}
						fileCount={mentionedFileCount}
					/>
				</InPanelRailHost>
			</div>
		);
	},
);
