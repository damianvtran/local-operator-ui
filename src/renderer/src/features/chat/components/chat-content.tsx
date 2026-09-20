import { BrowserPane } from "@features/browser/components/browser-pane";
import { useConversationApprovals } from "@features/browser/hooks/use-conversation-approvals";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { AgentDetails } from "@shared/api/local-operator/types";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import { TabPanel } from "@shared/components/ui";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { SendOutcome } from "@shared/hooks/use-message-input";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import {
	DEFAULT_RUN_PANEL_WIDTH,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
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
import type {
	CanonicalFrontendState,
	CanonicalModel,
} from "../../../../../shared/desktop-session-contract";
import { offerArchiveUndo } from "../archive-undo";
import { CanonicalTranscript } from "../canonical/canonical-transcript";
import { canonicalTranscriptSpeaks } from "../canonical/transcript-pane";
import { useMentionedFiles } from "../canonical/use-mentioned-files";
import {
	workingLineClaimed,
	workingLineInputFor,
} from "../canonical/working-line-model";
import type {
	DraftPickerDestination,
	DraftResolution,
} from "../draft-selection";
import type { Message } from "../types/message";
import { Canvas } from "./canvas";
import { documentsForCanvas } from "./canvas/document-buffers";
import { tabFollowingClose } from "./canvas/tab-selection";
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import {
	CHAT_TAB_IDS,
	CHAT_TAB_PANEL_IDS,
	type ChatTabValue,
	ChatTabs,
} from "./chat-tabs";
import { DEFAULT_MESSAGE_SUGGESTIONS } from "./composer-suggestions";
import { DeleteConversationDialog } from "./delete-conversation-dialog";
import type { DirectoryWritePath } from "./directory-indicator";
import {
	type ComposerSendError,
	MessageInput,
	type MessageInputHandle,
} from "./message-input";
import { RawInfoView } from "./raw-info-view";
import { type McpServerRow, type RunDetails, RunPanel } from "./run-details";
import type { McpRemedyControls } from "./run-details/use-mcp-remedy";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";

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
	 * The canonical session this pane paints from. Required, not optional: the
	 * legacy job/message list went with the socket transport, so there is no
	 * second transcript a pane could fall back to. `chat-page.tsx` supplies it
	 * for every mount, live conversation or draft alike.
	 */
	canonical: {
		view: CanonicalSessionHandle;
		busy: boolean;
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
		 * What `SessionPanel` knows about the gate it just answered. Passed through
		 * untouched: the card's hold and its refusal sentence are decided where the
		 * request and its failure are, not re-derived here.
		 */
		answer?: { sending: boolean; refused: string | null } | null;
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
 * The run pane's own contract floor, in pixels: the design's 320/420/640 range
 * (`docs/run-sidebar.md` § 8) starts at 320.
 *
 * ONE home for that number, because it is the floor of two different things: the
 * width the divider lets the user DRAG the pane's preference down to, and the
 * width flex may SHRINK the rendered pane down to when the row cannot host the
 * preference. Two literals here would drift the moment either moves, and the
 * second one is the whole of the fix below: a preference pinned as a floor is not
 * a floor, it is a promise the row cannot keep.
 */
const RUN_PANEL_MIN_PX = 320;

/**
 * The other end of that contract range: 640 is the widest the pane may ask for
 * (`docs/run-sidebar.md` § 8). Named here beside the floor because the divider's
 * range is now built from both, and because the ceiling is what a drag is
 * refused at once the row cannot host it.
 */
const RUN_PANEL_MAX_PX = 640;

/**
 * The chat column's own floor, in pixels, as a fallback for the measured one.
 *
 * The column declares it as `min-w-[220px]` on the element beside the pane, and
 * the measurement below reads it back from that element's computed style rather
 * than trusting this number — the floor is what tells the pane's own divider how
 * much room the ROW can give it, and a constant here that drifted from the class
 * would silently re-open the divergence the divider fix closes. This is the
 * fallback for a computed style that cannot be parsed, not a second source.
 */
const CHAT_COLUMN_MIN_PX = 220;

export const ChatContent: FC<ChatContentProps> = React.memo(
	({
		activeTab,
		onTabChange,
		agentName,
		description,
		descriptionPending,
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
		runDetails,
		mcpServers = [],
		mcpGrantRunning = false,
		mcpRemedy,
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
		const chatContainerRef = useRef<HTMLDivElement>(null);
		const canvasContainerRef = useRef<HTMLDivElement>(null);
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
		const gone = sessionGone || canonical?.view.missing === true;
		const setSessionArchived = useCanonicalSessionsStore(
			(state) => state.setSessionArchived,
		);
		/*
		 * The header's archive press, in the same register as the other two routes
		 * (UX round 1, U2): the pane's menu item, the row's control and a typed
		 * `/archive` are ONE act, so all three offer the same Undo when the press is
		 * accepted and the direction is the one that hides the conversation. The pane
		 * stays open either way - archiving hides, it does not close.
		 */
		const archiveFromHeader = useCallback(
			async (next: boolean) => {
				if (!sessionId) return;
				const accepted = await setSessionArchived(sessionId, next, agentName);
				if (!accepted || !next) return;
				offerArchiveUndo({ sessionId, title: agentName, archived: true });
			},
			[sessionId, agentName, setSessionArchived],
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

		const canvasPanelWidth = useUiPreferencesStore((s) => s.canvasWidth);
		const setCanvasPanelWidth = useUiPreferencesStore((s) => s.setCanvasWidth);
		const restoreDefaultCanvasPanelWidth = useUiPreferencesStore(
			(s) => s.restoreDefaultCanvasWidth,
		);

		// Get canvas state for the current conversation
		const conversationId = agentId; // assuming agentId is the conversation ID

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
		const runPanelWidth = useUiPreferencesStore((s) => s.runPanelWidth);
		const setRunPanelWidth = useUiPreferencesStore((s) => s.setRunPanelWidth);
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

		// No effect needed: always use the value from the store, or fallback to default if 0
		const effectiveCanvasPanelWidth =
			canvasPanelWidth === 0 ? 450 : canvasPanelWidth;
		// The run panel's own zero-fallback is its default rather than the canvas's
		// 450: the two panes are deliberately different widths, and an unset
		// preference should land the run panel on the design's 420.
		const effectiveRunPanelWidth = runPanelWidth === 0 ? 420 : runPanelWidth;

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
		const browserPanelWidth = useUiPreferencesStore((s) => s.browserPanelWidth);
		const setBrowserPanelWidth = useUiPreferencesStore(
			(s) => s.setBrowserPanelWidth,
		);
		const restoreDefaultBrowserPanelWidth = useUiPreferencesStore(
			(s) => s.restoreDefaultBrowserPanelWidth,
		);
		// Same zero-fallback shape as its neighbours above, and the same reason: an
		// unset preference should land the browser on the design's 640 (a page's room)
		// rather than on whichever pane's number happens to be first.
		const effectiveBrowserPanelWidth =
			browserPanelWidth === 0 ? 640 : browserPanelWidth;

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
		 * 220px floor — three inputs this component does not compute. A `ResizeObserver`
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
		 * THE DIVIDER'S CONTRACT, in one place: what the separator announces and
		 * accepts is what the pane renders.
		 *
		 * `runPanelResizable` is false when the row cannot host even the pane's own
		 * 320px contract floor — at 1024x673 with the rail expanded the row is 524px
		 * and the column's floor is 220 of them, so no preference the control is
		 * allowed to store (320..640) could render as itself: every one of them draws
		 * 304px. Resizing is then not a no-op that lies, it is not offered: the value
		 * below is the drawn width, the range collapses onto it, and a write is
		 * refused so the user's stored preference survives intact for a window that
		 * can honour it. Otherwise the range ends at the capacity, which is what makes
		 * the stored preference and the drawn width the same number after any drag.
		 */
		const runPanelResizable = runPanelCapacity >= RUN_PANEL_MIN_PX;
		const runPanelDividerValue = runPanelResizable
			? Math.min(
					Math.max(renderedRunPanelWidth, RUN_PANEL_MIN_PX),
					runPanelCapacity,
				)
			: renderedRunPanelWidth;
		const handleRunPanelWidthChange = useCallback(
			(width: number) => {
				if (runPanelCapacity < RUN_PANEL_MIN_PX) return;
				setRunPanelWidth(width);
			},
			[runPanelCapacity, setRunPanelWidth],
		);
		/*
		 * A RESET IS A DRAG to the design's default — the separator's double-click,
		 * and its Enter, both land here — so it goes through the SAME clamped write a
		 * drag does. The store's own reset writes the preference directly and knows
		 * nothing about the row, which is round 2's U6 on a different gesture: at
		 * 1024x673 with the rail expanded a reset would store 420 while the pane went
		 * on rendering 304, and the number the control hands back would be one the
		 * pane does not use. Routing the default through the clamp leaves the stored
		 * preference alone in that state — the same refusal a drag gets — and stores
		 * the default wherever the row can host it.
		 */
		const handleRunPanelWidthReset = useCallback(() => {
			handleRunPanelWidthChange(DEFAULT_RUN_PANEL_WIDTH);
		}, [handleRunPanelWidthChange]);

		const handleChangeActiveDocument = useCallback(
			(documentId: string) => setSelectedTab(conversationId, documentId),
			[conversationId, setSelectedTab],
		);

		const handleCloseCanvas = useCallback(() => {
			useUiPreferencesStore.getState().setCanvasOpen(false);
		}, []);

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
			 * a deliberate 220px floor. `min-w-0` would fight `min-w-[220px]` for the
			 * same property and `cn` drops one of them silently, so the base size is
			 * zeroed instead and `flex-1` grows it back from there - the floor
			 * survives and the content no longer votes on the width.
			 */
			<div
				ref={runPanelRowRef}
				className="relative flex h-full w-full flex-row overflow-hidden"
			>
				<div
					ref={chatColumnRef}
					className="relative h-full w-0 min-w-[220px] flex-1"
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
						 * `onSetArchived` is the same desired-state write the row's control makes,
						 * so the header and the row cannot drift about what a press means.
						 */}
						<ChatHeader
							agentName={agentName}
							description={description}
							descriptionPending={descriptionPending}
							onOpenOptions={onOpenOptions}
							runDetails={runDetails}
							fileCount={mentionedFileCount}
							mcpServers={mcpServers}
							listOnScreen={listOnScreen}
							readerChildId={readerChildId}
							onOpenBrowser={() => setBrowserPaneOpen(true)}
							browserAttentionCount={browserAttentionCount}
							archiveEnabled={archiveEnabled}
							archived={archived}
							onSetArchived={
								sessionId ? (next) => void archiveFromHeader(next) : undefined
							}
							deleteEnabled={deleteEnabled}
							onRequestDelete={
								sessionId ? () => requestSessionDelete(sessionId) : undefined
							}
						/>
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
										gate={canonical.view.frontend?.pending_gate ?? null}
										waiting={canonical.busy}
										starting={canonical.starting === true}
										startingAfterId={canonical.startingAfterId ?? null}
										loadingOlder={canonical.view.loadingOlder}
										onLoadOlder={canonical.view.loadOlder}
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
										onReconnect={canonical.view.retry}
										onAnswer={canonical.onAnswer}
										// The composer's own in-flight flag, reused: one
										// answer per question, whichever surface starts it.
										answering={Boolean(canonical.admitting)}
										// This panel's own record of the gate it pressed, so the
										// card holds itself disabled after an answer instead of
										// coming back live against a gate the owner already took.
										answer={canonical.answer ?? null}
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
						{/* Message input */}
						{(canonical || !(isLoadingMessages && messages.length === 0)) && (
							<MessageInput
								ref={messageInputRef}
								onSendMessage={onSendMessage}
								onComposerInput={onComposerInput}
								initialSuggestions={DEFAULT_MESSAGE_SUGGESTIONS}
								isLoading={
									canonical
										? Boolean(canonical.admitting || canonical.starting)
										: isLoading
								}
								/*
								 * Derived from the same expression the transcript's own line is, so
								 * the two surfaces cannot disagree about whether work is being
								 * claimed: a pending question and a dead transport both retire
								 * this hint with the line (review round 2, R2-3; design round
								 * 2, D5). Reading the latch directly is what let the composer
								 * keep saying "Waiting for the agent" 46px below a pane that had
								 * withdrawn exactly that claim.
								 */
								awaitingReply={Boolean(
									canonical &&
										workingLineClaimed(
											workingLineInputFor({
												waiting: canonical.busy,
												// The compacting pass is claimed from the same transcript the line
												// below reads, so the hint and the rung cannot disagree.
												compacting:
													canonical.view.transcript.compacting === true,
												compactingSince:
													canonical.view.transcript.compactingSince,
												starting: canonical.starting === true,
												startingAfterId: canonical.startingAfterId ?? null,
												gate: canonical.view.frontend?.pending_gate ?? null,
												unavailable: canonicalSpeaking(canonical, gone),
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
								awaitingAnswer={Boolean(canonical?.view.frontend?.pending_gate)}
								/*
								 * U3: the held-claim sentence offers the transcript as proof
								 * that the message exists somewhere ("its copy is in the
								 * transcript above"), which is only true when a copy is
								 * actually painted. On the draft path the pane held no rows at
								 * all, so the sentence pointed at a greeting (UX round 2, U3).
								 * Answered from the records this pane renders rather than
								 * assumed; `undefined` (no canonical stream, nothing held)
								 * leaves the clause out.
								 */
								heldCopyOnScreen={
									canonical && sendError?.heldText
										? canonical.view.transcript.records.some(
												(record) =>
													record.kind === "user" &&
													record.text === sendError.heldText,
											)
										: undefined
								}
								// A conversation the backend says is gone is a KNOWN
								// answer, so the composer refuses input rather than
								// accepting a message that can only 404. The pane above
								// carries the sentence and the way out (M6); this only
								// refuses the keystroke.
								unavailable={gone}
								currentJobId={canonical ? null : currentJobId}
								onCancelJob={onCancelJob}
								canonicalStop={
									canonical?.stopAvailable
										? { active: canonical.busy, onStop: canonical.onStop }
										: undefined
								}
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
						<ResizableDivider
							sidebarWidth={effectiveCanvasPanelWidth}
							onSidebarWidthChange={setCanvasPanelWidth}
							minWidth={400}
							maxWidth={1200}
							side="left"
							onDoubleClick={restoreDefaultCanvasPanelWidth}
							label="Resize canvas"
						/>
						<div
							ref={canvasContainerRef}
							/* Named for the geometry probe: the dock's measured width at
							 * the default 1380x900 window is the U1 regression check. */
							data-tour-tag="canvas-dock"
							style={{
								width: effectiveCanvasPanelWidth,
							}}
							/*
							 * No `minWidth`. A floor pinned at the dock's preferred width is what
							 * made the grid's fourth column unreachable at the app's own default
							 * window: the chat column has a 220px floor of its own, so
							 * 220 + 800 could not fit in an 880px row, the row's `overflow-hidden`
							 * clipped the rest, and no scroll container in between could reach it
							 * (measured at 1380x900: the dock ran to x=1520 in a 1380 window and 8 of
							 * 32 tiles had their right edge past it). With the floor gone, flex
							 * shrinks the dock into the space that is actually available and the
							 * grid reflows to the width it really has — which is the same rule the
							 * grid's own `auto-fill` tracks already follow.
							 */
							className="relative h-full shrink overflow-hidden border-l border-hairline transition-[width] duration-base ease-out-quart"
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
								onChangeActiveDocument={handleChangeActiveDocument}
								onClose={handleCloseCanvas}
								onCloseDocument={handleCloseDocument}
							/>
						</div>
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
				 * The width range is the design's (320/420/640), narrower than the canvas's
				 * because a roster and a prose transcript do not need a document pane's
				 * room, and the pane does NOT auto-hide at narrow widths: the operator
				 * asked for persistence, and a pane that disappears below a breakpoint is
				 * the defect this replaces in a new costume.
				 */}
				{isRunPanelOpen && runDetails && (
					<>
						<ResizableDivider
							sidebarWidth={runPanelDividerValue}
							onSidebarWidthChange={handleRunPanelWidthChange}
							minWidth={
								runPanelResizable ? RUN_PANEL_MIN_PX : runPanelDividerValue
							}
							maxWidth={
								runPanelResizable
									? Math.min(RUN_PANEL_MAX_PX, runPanelCapacity)
									: runPanelDividerValue
							}
							side="left"
							onDoubleClick={handleRunPanelWidthReset}
							label="Resize run details"
						/>
						<div
							ref={runPanelRef}
							style={{
								/*
								 * The preference is the `width`, and there is NO floor: `minWidth: 0`
								 * is what lets the flex item shrink below its own content minimum at
								 * all, which is the whole of the fix below. Pinning the preference as
								 * the floor is what put the pane's right edge - its close control and
								 * its scrollbar - past the window at any window the row could not
								 * host 420 in: measured 116px past at 1024x673 with the rail
								 * expanded and 340px at the app's 800x600 floor, with the row's
								 * `overflow-hidden` hiding the difference and no gesture that
								 * reaches it. The canvas dock one slot up dropped its own pinned
								 * floor for exactly this reason.
								 *
								 * A floor at the pane's own 320px contract minimum was measured too
								 * and is NOT enough: it still leaves 16px of the pane past the
								 * window at 1024x673 with the rail expanded (the close control's
								 * right edge, off-screen) and 68px at 800x600 with the rail
								 * collapsed, because the row's other floors - a 220px column and a
								 * 280px chat list, under a 48px or 220px rail - do not leave 320.
								 * With no floor the pane takes exactly the space the row has left,
								 * and the budgets below follow that measured width, so a narrow
								 * pane sheds and elides inside its own box instead of being cut by
								 * the window. `RUN_PANEL_MIN_PX` stays the DIVIDER's floor: the
								 * width the user may drag the preference down to.
								 */
								minWidth: 0,
								width: effectiveRunPanelWidth,
							}}
							className="relative h-full shrink overflow-hidden border-l border-hairline transition-[width] duration-base ease-out-quart"
						>
							<RunPanel
								details={runDetails}
								mcpServers={mcpServers}
								mcpGrantRunning={mcpGrantRunning}
								mcpRemedy={mcpRemedy}
								sessionId={canonical?.view.frontend?.session_id ?? null}
								pulses={pulses ?? EMPTY_PULSES}
								childrenOpenable={childrenOpenable}
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
						</div>
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
							sidebarWidth={effectiveBrowserPanelWidth}
							onSidebarWidthChange={setBrowserPanelWidth}
							minWidth={480}
							maxWidth={1200}
							side="left"
							onDoubleClick={restoreDefaultBrowserPanelWidth}
							label="Resize browser"
						/>
						<div
							/* Named for the geometry probe: the pane's measured width as it opens
							   is what shows the slot narrowed the conversation rather than
							   overlaying it. */
							data-tour-tag="browser-pane-slot"
							style={{ width: effectiveBrowserPanelWidth }}
							className="relative h-full overflow-hidden border-l border-hairline transition-[width] duration-base ease-out-quart"
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
						</div>
					</>
				)}
			</div>
		);
	},
);
