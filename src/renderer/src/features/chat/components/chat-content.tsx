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
import { useMentionedFiles } from "../canonical/use-mentioned-files";
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
import {
	type ComposerSendError,
	MessageInput,
	type MessageInputHandle,
} from "./message-input";
import { MessagesView } from "./messages-view";
import { RawInfoView } from "./raw-info-view";
import type { RunDetails } from "./run-details";

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
	"Is Apple buy/hold/sell?  Do a fundamentals analysis",
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
	/** Present only while the session is a draft; see `MessageInputProps`. */
	onChangeCwd?: (cwd: string) => void;
	/** A failed send, rendered against the composer; see `ComposerSendError`. */
	sendError?: ComposerSendError;
	/**
	 * The session's readings and the dispatcher that opens their pickers.
	 * Forwarded verbatim to the composer; see `MessageInputProps`.
	 */
	sessionStatus?: {
		frontend: CanonicalFrontendState | null;
		onCommand?: (line: string) => void;
		/** The rungs `/effort` accepts; see `SessionStatusStripProps`. */
		effortEntities?: readonly unknown[];
		/** A chosen model the owner has not confirmed; see `SessionStatusStripProps`. */
		pendingModel?: CanonicalModel | null;
	};
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
		onChangeCwd,
		sendError,
		sessionStatus,
		canonical,
		runDetails,
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
							onOpenOptions={onOpenOptions}
							runDetails={runDetails}
							fileCount={mentionedFileCount}
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
											error={canonical.view.error}
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
								awaitingReply={canonical?.starting === true}
								conversationId={agentId}
								messages={
									canonical
										? /*
											 * A send this pane has admitted counts as content here, and that is a
											 * correction rather than a nicety: with zero records the greeting's
											 * branch renders into the column and the transcript is left no
											 * height at all (`canonical-transcript.tsx`'s `collapsed`), so the
											 * rung existed in the DOM through the whole cold engage and never
											 * painted a pixel — the operator's dead-air window, unchanged
											 * (QA round 1, Q1). The pane is not empty once a message is on its
											 * way: "What can I help you with today?" and the suggestion chips
											 * are claims about a conversation that has already started.
											 */
											canonical.view.transcript.records.length > 0 ||
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
								isHydrating={
									canonical ? canonical.view.status === "connecting" : false
								}
								currentJobId={canonical ? null : currentJobId}
								onCancelJob={onCancelJob}
								canonicalStop={
									canonical
										? { active: canonical.busy, onStop: canonical.onStop }
										: undefined
								}
								isFarFromBottom={isFarFromBottom}
								hasNewActivity={hasNewActivity}
								scrollToBottom={scrollToBottom}
								agentData={agentData}
								cwd={cwd}
								onChangeCwd={onChangeCwd}
								sendError={sendError}
								sessionStatus={sessionStatus}
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
			</div>
		);
	},
);
