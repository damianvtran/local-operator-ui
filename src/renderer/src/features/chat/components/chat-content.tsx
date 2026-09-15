import type {
	AgentDetails,
	AgentExecutionRecord,
	JobStatus,
} from "@shared/api/local-operator/types";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import { TabPanel } from "@shared/components/ui";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import type { SendOutcome } from "@shared/hooks/use-message-input";
import { useCanvasStore } from "@shared/store/canvas-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import React, {
	type FC,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	CanonicalFrontendState,
	CanonicalModel,
} from "../../../../../shared/desktop-session-contract";
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
import { ChatHeader } from "./chat-header";
import { ChatOptionsSidebar } from "./chat-options-sidebar";
import {
	CHAT_TAB_IDS,
	CHAT_TAB_PANEL_IDS,
	type ChatTabValue,
	ChatTabs,
} from "./chat-tabs";
import type { DirectoryWritePath } from "./directory-indicator";
import {
	type ComposerSendError,
	MessageInput,
	type MessageInputHandle,
} from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";
import { type McpServerRow, type RunDetails, RunPanel } from "./run-details";
import type { McpRemedyControls } from "./run-details/use-mcp-remedy";
import type { SlashDispatchOutcome } from "./slash-dispatch";
import type { SlashCommandInvocation } from "./slash-submit";

const DEFAULT_MESSAGE_SUGGESTIONS = [
	"Go to my documents folder",
	"What's the latest news?",
	"Make me a research report on the latest trends in AI",
	"Make me a space invaders game",
	"Organize my desktop",
	"Create a presentation outline on climate change",
	"Train a classifier on the MPG dataset",
	"Search for quantum computing papers and download interesting ones to read later",
	"Download some recent papers on fusion energy",
	"Download some recent papers on cancer research",
	"Make me a brick breaker game",
	"Remove downloads that are more than a year old",
	"Put together a competitive analysis report on the agentic AI space",
	"Find me a royalty free gif of a cute cat",
	"Go to my downloads folder",
	"Organize my documents folder",
	"Make me a GDPR compliant privacy policy",
	"Look up trending stocks and put together an investment report",
	"Fetch the MNIST dataset and train a good classifier",
	"Look up interest rate trends and make a projection for the next 5 years",
	"Make a presentation with a dependency graph of genetic factors for Alzheimer's disease",
	"Do a buy/hold/sell and fundamentals analysis of Apple",
	"Do a technical analysis on NVDA over the last year",
	"What are the trending stocks on WallStreetBets?",
	"What stocks are trending right now?",
];

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
	isFetchingMore: boolean;
	isFarFromBottom: boolean;
	hasNewActivity?: boolean;
	jobStatus?: JobStatus | null;
	currentExecution?: AgentExecutionRecord | null;
	messagesContainerRef: React.RefObject<HTMLDivElement>;
	messagesEndRef: React.RefObject<HTMLDivElement>;
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
	) => SendOutcome | Promise<SendOutcome>;
	currentJobId: string | null;
	onCancelJob: (jobId: string) => void;
	agentData?: AgentDetails | null;
	refetch?: () => void;
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
	 * The dispatcher's own note surface, borrowed by the composer so a staged
	 * reassembly and an unanswerable name list can say what happened. Forwarded
	 * verbatim; see `MessageInputProps.onSlashNote`.
	 */
	onSlashNote?: (text: string) => void;
	/**
	 * Present when the conversation is a canonical backend session: the
	 * transcript is painted from the canonical stream and the legacy
	 * job/message list is not mounted. Absent on an old backend.
	 */
	canonical?: {
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
				missing: canonical.view.missing,
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
		isFetchingMore,
		isFarFromBottom,
		hasNewActivity = false,
		jobStatus,
		currentExecution,
		messagesContainerRef,
		messagesEndRef,
		scrollToBottom,
		rawInfoContent,
		onSendMessage,
		currentJobId,
		onCancelJob,
		onComposerInput,
		agentData,
		refetch,
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
		canonical,
		runDetails,
		mcpServers = [],
		mcpGrantRunning = false,
		mcpRemedy,
		childrenOpenable = false,
		pulses,
	}) => {
		const [isSmallView, setIsSmallView] = useState(false);
		const chatContainerRef = useRef<HTMLDivElement>(null);
		const canvasContainerRef = useRef<HTMLDivElement>(null);

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
		const restoreDefaultRunPanelWidth = useUiPreferencesStore(
			(s) => s.restoreDefaultRunPanelWidth,
		);
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
					setSelectedTab(
						conversationId,
						newTabs.length > 0 ? newTabs[0].id : null,
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
			<div className="relative flex h-full w-full flex-row overflow-hidden">
				<div className="relative h-full w-0 min-w-[220px] flex-1">
					{/*
					 * The working surface takes the PAGE ground, `canvas`, not the panel
					 * ground.
					 *
					 * The depth model this app is built on reads three planes left to
					 * right: the icon rail is `sunken`, the list panel beside it is
					 * `surface`, and the thing you are working on is `canvas`
					 * (sidebar-navigation.tsx states the model, and why the rail moved off
					 * `surface`). This column was the one main area in the app painted
					 * `surface`, and `surface` is exactly what the list panel next to it
					 * uses - measured in the running app, the boundary between them was
					 * ΔE00 0 in every sampled theme, so the two read as one slab with
					 * nothing between them: no rule (the divider is `w-0`), no border, no
					 * step. Settings and agents already root their main area at `canvas`;
					 * chat was contradicting the model, not extending it.
					 *
					 * The step this creates is deliberately the SLIGHT one of the two, and
					 * it is the only boundary between list panel and working surface - no
					 * rule, no border, no shadow, because elevation in this system is a
					 * lightness step (branding § 2). `check-themes` already asserts
					 * `canvas`/`surface` and `surface`/`sunken` as adjacent ground pairs:
					 * across the twelve palettes `surface`→`canvas` measures ΔE00 2.11
					 * (iceberg) to 6.56 (synth), against 3.75 (iceberg) to 14.94 (synth)
					 * for `surface`→`sunken`. The rail therefore keeps the clearly
					 * stronger separation, which is the relationship the report asked
					 * for.
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
						/>
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
									/* Messages container */
									canonical ? (
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
											missing={canonical.view.missing}
										/>
									) : (
										<MessagesView
											messages={messages}
											isLoading={isLoading}
											isLoadingMessages={isLoadingMessages}
											isFetchingMore={isFetchingMore}
											jobStatus={jobStatus}
											agentName={agentName}
											currentExecution={currentExecution}
											messagesContainerRef={messagesContainerRef}
											messagesEndRef={messagesEndRef}
											scrollToBottom={scrollToBottom}
											refetch={refetch}
											conversationId={agentId}
											isSmallView={isSmallView}
										/>
									),
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
												starting: canonical.starting === true,
												startingAfterId: canonical.startingAfterId ?? null,
												gate: canonical.view.frontend?.pending_gate ?? null,
												unavailable: canonicalSpeaking(canonical),
												records: canonical.view.transcript.records,
											}),
										),
								)}
								conversationId={agentId}
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
											canonicalSpeaking(canonical) ||
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
								unavailable={Boolean(canonical?.view.missing)}
								currentJobId={canonical ? null : currentJobId}
								onCancelJob={onCancelJob}
								canonicalStop={
									canonical?.stopAvailable
										? { active: canonical.busy, onStop: canonical.onStop }
										: undefined
								}
								/*
								 * The capability itself, not just its busy half: the composer
								 * reserves the control's SLOT whenever the backend negotiates
								 * it, so the dictation control cannot slide into the centre a
								 * reflex second press lands on (UX round 1's U1 / QA's Q1).
								 * Without the capability the slot is not reserved either - a
								 * gap that nothing will ever fill is not a reservation.
								 */
								canonicalStopAvailable={canonical?.stopAvailable ?? false}
								interruptNotice={canonical?.stopNotice ?? null}
								isFarFromBottom={isFarFromBottom}
								hasNewActivity={hasNewActivity}
								scrollToBottom={scrollToBottom}
								agentData={agentData}
								cwd={cwd}
								cwdWritePath={cwdWritePath}
								cwdPending={cwdPending}
								cwdPendingAccepted={cwdPendingAccepted}
								cwdReadOnlyReason={cwdReadOnlyReason}
								sendError={sendError}
								sessionStatus={sessionStatus}
								onSlashCommand={onSlashCommand}
								onSlashNote={onSlashNote}
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
								initialDocuments={files}
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
				 * divider, the pinned-width wrapper with the `border-l` seam, and a root
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
							sidebarWidth={effectiveRunPanelWidth}
							onSidebarWidthChange={setRunPanelWidth}
							minWidth={320}
							maxWidth={640}
							side="left"
							onDoubleClick={restoreDefaultRunPanelWidth}
							label="Resize run details"
						/>
						<div
							style={{
								minWidth: effectiveRunPanelWidth,
								width: effectiveRunPanelWidth,
							}}
							className="relative h-full overflow-hidden border-l border-hairline transition-[width] duration-base ease-out-quart"
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
								 * The pane's own width, in pixels, and the SAME value the
								 * wrapper's `width`/`minWidth` take above — not a second
								 * reading of the preference. The pane owns its width; the
								 * sections whose tallies are budgeted against it (`§ 8`)
								 * receive it rather than measuring themselves, so a section
								 * can never disagree with the pane it is drawn in at the
								 * window floor.
								 */
								paneWidth={effectiveRunPanelWidth}
								readerChildId={readerChildId}
								onReaderChildChange={setReaderChildId}
								onClose={() => setRunPanelOpen(false)}
							/>
						</div>
					</>
				)}
			</div>
		);
	},
);
