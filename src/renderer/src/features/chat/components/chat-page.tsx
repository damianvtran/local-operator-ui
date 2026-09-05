import { createLocalOperatorClient } from "@shared/api/local-operator";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { JobsApi } from "@shared/api/local-operator/jobs-api";
import type { JobStatus } from "@shared/api/local-operator/types";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { apiConfig } from "@shared/config";
import { useAgent } from "@shared/hooks/use-agents";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { useConfig } from "@shared/hooks/use-config";
import { useConversationMessages } from "@shared/hooks/use-conversation-messages";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import { useJobPolling } from "@shared/hooks/use-job-polling";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { terminateStreamingMessages } from "@shared/hooks/use-streaming-message";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useChatStore } from "@shared/store/chat-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { showErrorToast } from "@shared/utils/toast-manager";
import React, {
	useState,
	useMemo,
	useEffect,
	useCallback,
	useRef,
} from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import { PickerOutlet } from "../pickers/picker-registry";
import type { Message } from "../types/message";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import { ErrorView } from "./error-view";
import type { MessageInputHandle } from "./message-input";
import { PlaceholderView } from "./placeholder-view";
import { useSlashDispatch } from "./slash-dispatch";

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
 * runtime accepts are encoded, anything else is left out rather than
 * refused (the JSON transport budget is 256 KiB, see the backend contract).
 */
const IMAGE_DATA_URL = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/;
const FILE_SCHEME = /^file:\/\//;

async function encodeImageAttachments(attachments: string[]) {
	const images: {
		data_b64: string;
		mime_type: (typeof IMAGE_MIME_BY_EXT)[string];
	}[] = [];
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
	return images.slice(0, 8);
}

/**
 * Props for the ChatPage component
 * No props needed as we use React Router hooks internally
 */
type ChatProps = Record<string, never>;

/**
 * Chat Page Component
 *
 * Displays the chat interface with a sidebar for agent selection and a main area for messages
 * Uses React Router for navigation and state management
 */
export const ChatPage: FC<ChatProps> = () => {
	const didAutoScrollRef = React.useRef(false);
	const messageInputRef = useRef<MessageInputHandle>(null);
	// Get agent ID from URL parameters using custom hook
	const { agentId, navigateToAgent } = useAgentRouteParam();
	const navigate = useNavigate();
	const isCanvasOpen = useUiPreferencesStore((state) => state.isCanvasOpen);
	const setCanvasOpen = useUiPreferencesStore((state) => state.setCanvasOpen);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.key === "c" &&
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey
			) {
				event.preventDefault();
				setCanvasOpen(!isCanvasOpen);
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isCanvasOpen, setCanvasOpen]);

	// Get agent selection store functions
	const setLastChatAgentId = useAgentSelectionStore(
		(state) => state.setLastChatAgentId,
	);
	const getLastAgentId = useAgentSelectionStore(
		(state) => state.getLastAgentId,
	);

	// Use the agent ID from URL or the last selected agent ID
	const effectiveAgentId = agentId || getLastAgentId("chat");
	const conversationId = effectiveAgentId || undefined;
	const selectedConversation = effectiveAgentId || undefined;

	// Canonical session identity. The agent id is a profile reference; the
	// conversation the backend runs is a canonical 12-hex session id. Each
	// agent maps to one canonical session that is created once and reopened
	// on every later visit, so identity survives restarts and the watcher.
	const capabilities = useDesktopCapabilities();
	const canonicalEnabled =
		desktopFeatureEnabled(capabilities.data, "commands") &&
		desktopFeatureEnabled(capabilities.data, "lifecycle");
	const sessionByAgent = useCanonicalSessionsStore(
		(state) => state.sessionByAgent,
	);
	const createSession = useCanonicalSessionsStore(
		(state) => state.createSession,
	);
	const setActiveSession = useCanonicalSessionsStore(
		(state) => state.setActiveSession,
	);
	const bindSession = useCanonicalSessionsStore((state) => state.bindSession);
	const canonicalSessionId = conversationId
		? sessionByAgent[conversationId]
		: undefined;

	// In production mode, always use "chat" tab
	const [activeTab, setActiveTab] = useState<"chat" | "raw">("chat");

	// Force "chat" tab in production mode
	useEffect(() => {
		if (!isDevelopmentMode() && activeTab !== "chat") {
			setActiveTab("chat");
		}
	}, [activeTab]);
	const [isOptionsSidebarOpen, setIsOptionsSidebarOpen] = useState(false);

	// Initialize the API client (memoized to prevent recreation on every render)
	const apiClient = useMemo(
		() => createLocalOperatorClient(apiConfig.baseUrl),
		[],
	);

	// Get the chat store functions
	const getMessages = useChatStore((state) => state.getMessages);

	// Fetch agent details for the current conversation
	const { data: agentData } = useAgent(conversationId);

	// Bind the agent to a canonical session once its working directory is
	// known. Creation is idempotent per agent through the store's mapping;
	// re-mounting reopens the same identity rather than minting another.
	const creatingSessionRef = useRef<string | null>(null);
	useEffect(() => {
		if (!canonicalEnabled || !conversationId || !agentData) return;
		if (canonicalSessionId) {
			setActiveSession(canonicalSessionId);
			return;
		}
		if (creatingSessionRef.current === conversationId) return;
		creatingSessionRef.current = conversationId;
		const cwd = agentData.current_working_directory || "~";
		void createSession(cwd, conversationId).finally(() => {
			if (creatingSessionRef.current === conversationId) {
				creatingSessionRef.current = null;
			}
		});
	}, [
		canonicalEnabled,
		conversationId,
		agentData,
		canonicalSessionId,
		createSession,
		setActiveSession,
	]);

	// Canonical stream over the authenticated relay, plus the watch lease it
	// keys off. A terminal canonical event is what resolves the legacy
	// "Waiting to start" latch: the job poller can miss a fast failure, but
	// the canonical stream always reports the turn boundary.
	const canonical = useCanonicalSessionStream(
		canonicalSessionId,
		canonicalEnabled && Boolean(canonicalSessionId),
	);
	useDesktopWatchLease(canonicalSessionId, canonical.subscriptionId);

	// Only fetch messages if we have a valid conversation ID
	const {
		messages,
		isLoading: isLoadingMessages,
		isError,
		error,
		isFetchingMore,
		hasMoreMessages,
		messagesContainerRef, // Get the ref from the hook
		refetch,
	} = useConversationMessages(conversationId);

	// Get the addMessage function from the chat store
	const addMessage = useChatStore((state) => state.addMessage);

	// Use the job polling hook
	const {
		currentJobId,
		setCurrentJobId,
		jobStatus,
		isLoading,
		setIsLoading,
		currentExecution,
	} = useJobPolling({
		conversationId,
		addMessage,
	});

	// Canonical transcript mode: once the agent is bound to a canonical
	// session and the stream is live, the conversation is painted from the
	// backend's durable history + live events and prompts are admitted through
	// `sessions.message`. The legacy job/message path below stays only for a
	// backend that predates the desktop contract (capabilities fail closed).
	const canonicalMode = canonicalEnabled && Boolean(canonicalSessionId);
	const canonicalBusy =
		canonicalMode &&
		(canonical.frontend?.streaming === true ||
			canonical.transcript.records.some(
				(record) =>
					(record.kind === "assistant" && record.streaming) ||
					(record.kind === "tool" && record.phase !== "done"),
			));
	// Admission pending: the composer disables between POST and the owner's
	// `message_start` echo so a double Enter cannot admit twice.
	const [admitting, setAdmitting] = useState(false);

	// Resolve the busy latch from the canonical stream. Each terminal event
	// is consumed once (tracked by generation) so an old terminal does not
	// clear a later turn's loading state.
	const lastTerminalRef = useRef<string | null>(null);
	useEffect(() => {
		const marker = canonical.terminal
			? `${canonical.receipt?.epoch ?? ""}:${canonical.receipt?.seq ?? 0}:${canonical.terminal}`
			: null;
		if (!marker || marker === lastTerminalRef.current) return;
		lastTerminalRef.current = marker;
		if (
			canonical.terminal === "agent_end" ||
			canonical.terminal === "turn_end"
		) {
			setIsLoading(false);
		}
	}, [canonical.terminal, canonical.receipt, setIsLoading]);

	// Use custom hook to track scroll position and show/hide scroll button
	// Pass the messagesContainerRef to the hook to ensure it tracks the correct container
	const { isFarFromBottom, scrollToBottom } = useScrollToBottom(
		50,
		messagesContainerRef,
		messages.length,
	);

	// Create a ref for the messages end element (for backwards compatibility)
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// "New activity" instead of autoscroll: when messages grow while the
	// reader is scrolled up, flag it and let them choose to jump. Cleared
	// the moment they are back near the bottom.
	const [hasNewActivity, setHasNewActivity] = useState(false);
	const seenMessageCountRef = useRef(messages.length);
	useEffect(() => {
		if (messages.length > seenMessageCountRef.current && isFarFromBottom) {
			setHasNewActivity(true);
		}
		seenMessageCountRef.current = messages.length;
	}, [messages.length, isFarFromBottom]);
	useEffect(() => {
		if (!isFarFromBottom) setHasNewActivity(false);
	}, [isFarFromBottom]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on conversation change only
	useEffect(() => {
		// A new conversation starts with nothing unread.
		setHasNewActivity(false);
		seenMessageCountRef.current = 0;
	}, [conversationId]);

	// Update the last selected agent ID when the agent ID changes
	// Force scroll to bottom only when switching to a new conversation
	// Also, focus the input if the agentId has changed (intentional navigation)
	useEffect(() => {
		if (agentId) {
			const previousAgentId = previousConversationIdRef.current;
			setLastChatAgentId(agentId);

			// Only scroll if we have a new conversation with loaded messages
			if (!isLoadingMessages && messages.length > 0) {
				const prevMessages = getMessages(agentId);
				if (!prevMessages || prevMessages.length === 0) {
					scrollToBottom();
				}
			}

			// Focus input if agentId changed and it's not the initial load
			if (previousAgentId && previousAgentId !== agentId) {
				Promise.resolve().then(() => {
					messageInputRef.current?.focusInput();
				});
			}
		}
	}, [
		agentId,
		setLastChatAgentId,
		isLoadingMessages,
		messages.length,
		scrollToBottom,
		getMessages,
	]);

	// Reset auto-scroll flag when conversation changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: only trigger on agentId change
	useEffect(() => {
		didAutoScrollRef.current = false;
	}, [agentId]);

	// Scroll to bottom when switching conversations or when messages load
	// biome-ignore lint/correctness/useExhaustiveDependencies: messagesContainerRef.current is used but we don't want to re-run on every ref change
	useEffect(() => {
		// Reset auto-scroll flag when conversation changes
		if (agentId !== previousConversationIdRef.current) {
			didAutoScrollRef.current = false;
			previousConversationIdRef.current = agentId;
		}

		// Scroll to bottom once after messages load and focus input
		if (
			!didAutoScrollRef.current &&
			agentId &&
			!isLoadingMessages &&
			messages.length > 0
		) {
			// Immediately scroll to bottom (scrollTop = 0 in column-reverse)
			if (messagesContainerRef.current) {
				messagesContainerRef.current.scrollTop = 0;
			}
			// Focus the input after messages are loaded and scrolled
			Promise.resolve().then(() => {
				messageInputRef.current?.focusInput();
			});
			didAutoScrollRef.current = true; // Mark that auto scroll and focus has happened
		}
	}, [agentId, isLoadingMessages, messages.length, scrollToBottom]); // Added scrollToBottom as it's used indirectly via didAutoScrollRef logic

	// Reference to track previous conversation ID
	const previousConversationIdRef = useRef<string | undefined>(undefined);

	const handleOpenOptions = useCallback(() => {
		setIsOptionsSidebarOpen(true);
	}, []);

	const handleCloseOptions = useCallback(() => {
		setIsOptionsSidebarOpen(false);
	}, []);

	// Handle selecting a conversation
	const handleSelectConversation = useCallback(
		(id: string) => {
			setLastChatAgentId(id);
			navigateToAgent(id, "chat");
		},
		[setLastChatAgentId, navigateToAgent],
	);

	// Handle navigating to agent settings
	const handleNavigateToAgentSettings = useCallback(
		(agentId: string) => {
			navigate(`/agents/${agentId}`);
		},
		[navigate],
	);

	// Handle job cancellation
	const handleCancelJob = useCallback(
		async (jobId: string) => {
			if (!jobId) return;

			let cancelError: unknown = null;
			try {
				await JobsApi.cancelJob(apiConfig.baseUrl, jobId);
			} catch (error) {
				console.error("Error cancelling job:", error);
				cancelError = error;
			}

			// The local teardown runs whether or not the backend accepted the
			// cancel. The user asked to stop, so the UI has to read as stopped:
			// bailing out on a rejected request left the stream armed, which kept
			// the composer disabled and the reconnect effect re-firing every
			// 1600ms for the rest of the session with no way for the user back
			// out — the cancel button appeared to do nothing, permanently.
			//
			// The backend no longer sends frames for a cancelled job, but nothing
			// tells the client the stream was over: the store never marks it
			// complete and the socket stays open. Marking the stream finished is
			// what actually stops it — it stands the reconnect guard down, closes
			// the socket, and lets the message settle into its final rendered
			// state.
			if (conversationId) {
				terminateStreamingMessages(conversationId);
			}

			// Clear the current job ID and loading state
			setCurrentJobId(null);
			setIsLoading(false);

			if (cancelError) {
				// Said plainly rather than as a clean cancel: the local stream is
				// down but the server never acknowledged, so the agent may still
				// be working and the user needs to know that before they retry.
				showErrorToast(
					`Stopped locally, but the server did not confirm the cancellation: ${
						cancelError instanceof Error ? cancelError.message : "unknown error"
					}. The agent may still be running.`,
				);
			}

			// Record the outcome in the transcript so it survives the toast.
			if (conversationId) {
				const outcomeMessage: Message = {
					id: Date.now().toString(),
					role: "system",
					message: cancelError
						? "Stopped by user. The server did not confirm the cancellation, so the agent may still be running."
						: "Job cancelled by user.",
					timestamp: new Date(),
					status: cancelError ? "error" : undefined,
				};

				addMessage(conversationId, outcomeMessage);
			}
		},
		[addMessage, conversationId, setCurrentJobId, setIsLoading],
	);

	// Memoized function to handle sending a new message
	const { data: configData } = useConfig();

	// Slash submissions are dispatched to the desktop command control, never
	// admitted as model chat. The backend rejects slash text on /messages with
	// 422 — intercepting here is what makes `/settings` navigate instead of
	// failing against a missing model key one API round-trip later.
	const rebindSession = useCallback(
		(nextSessionId: string) => {
			if (!conversationId) return;
			bindSession(conversationId, nextSessionId);
		},
		[conversationId, bindSession],
	);
	const { dispatch: handleSlashDispatch, picker } = useSlashDispatch({
		sessionId: canonicalSessionId,
		addMessage: (message) => {
			if (conversationId) addMessage(conversationId, message);
		},
		canonical,
		rebind: rebindSession,
	});

	const handleSendMessage = useCallback(
		async (content: string, attachments: string[]) => {
			if (!conversationId) return;

			// A leading slash is a command, full stop. Dispatch consumes it and
			// nothing below (model job creation) runs for it.
			if (await handleSlashDispatch(content)) return;

			if (canonicalMode && canonicalSessionId) {
				// Canonical admission. 200 means the owner ADMITTED the prompt, not
				// that the model answered: the transcript paints the user row from
				// the owner's own `message_start` echo (keyed by this request id),
				// so nothing optimistic is inserted here to be deduplicated later.
				// A pending gate is answered through the answers route instead of
				// being admitted as a new prompt the owner would queue.
				const gate = canonical.frontend?.pending_gate ?? null;
				const requestId = uuidv4();
				setAdmitting(true);
				try {
					if (gate && canonical.ownerEpoch) {
						const trimmed = content.trim().toLowerCase();
						if (gate.kind === "approval") {
							const yes = ["y", "yes", "approve", "ok", "allow"].includes(
								trimmed,
							);
							const no = ["n", "no", "deny", "reject", "cancel"].includes(
								trimmed,
							);
							if (!yes && !no) {
								addMessage(conversationId, {
									id: uuidv4(),
									role: "system",
									message: "Reply yes or no to answer the approval request.",
									timestamp: new Date(),
									status: "error",
								});
								return;
							}
							await desktopResult({
								op: "sessions.answer",
								sessionId: canonicalSessionId,
								epoch: canonical.ownerEpoch,
								requestId: gate.request_id,
								approved: yes,
							});
						} else {
							await desktopResult({
								op: "sessions.answer",
								sessionId: canonicalSessionId,
								epoch: canonical.ownerEpoch,
								requestId: gate.request_id,
								value: content,
								questionIndex: gate.question_index,
							});
						}
						return;
					}
					const images = await encodeImageAttachments(attachments);
					await desktopResult({
						op: "sessions.message",
						sessionId: canonicalSessionId,
						requestId,
						text: content,
						images: images.length > 0 ? images : undefined,
						// Steer rather than queue when the owner is mid-turn: that is
						// what typing during a turn means in the terminal too.
						mode: canonicalBusy ? "steer" : "prompt",
					});
					requestAnimationFrame(() => scrollToBottom());
				} catch (error) {
					addMessage(conversationId, {
						id: uuidv4(),
						role: "system",
						message: `The message was not sent: ${
							error instanceof Error ? error.message : "the backend refused it"
						}`,
						timestamp: new Date(),
						status: "error",
					});
				} finally {
					setAdmitting(false);
				}
				return;
			}

			// Create a new user message
			const userMessage: Message = {
				id: uuidv4(),
				role: "user",
				message: content,
				timestamp: new Date(),
				files: attachments.length > 0 ? attachments : undefined,
			};

			// Add user message to chat store
			addMessage(conversationId, userMessage);

			// Scroll to bottom immediately after adding the message
			// This ensures the user sees their message right away
			requestAnimationFrame(() => {
				scrollToBottom();
			});

			// Set loading state
			setIsLoading(true);

			try {
				// Prepare options from agent settings
				const options = {
					temperature: agentData?.temperature,
					top_p: agentData?.top_p,
					top_k: agentData?.top_k,
					max_tokens: agentData?.max_tokens,
					stop: agentData?.stop,
					frequency_penalty: agentData?.frequency_penalty,
					presence_penalty: agentData?.presence_penalty,
					seed: agentData?.seed,
				};

				// Filter out undefined values
				const filteredOptions = Object.fromEntries(
					Object.entries(options).filter(
						([_, value]) => value !== undefined && value !== null,
					),
				);

				const resolvedHosting =
					!agentData?.hosting ||
					agentData.hosting === "default" ||
					agentData.hosting.trim() === ""
						? configData?.values.hosting || ""
						: agentData.hosting;

				const resolvedModel =
					!agentData?.model ||
					agentData.model === "default" ||
					agentData.model.trim() === ""
						? configData?.values.model_name || ""
						: agentData.model;

				const jobDetails = await apiClient.chat.processAgentChatAsync(
					conversationId,
					{
						hosting: resolvedHosting,
						model: resolvedModel,
						prompt: content,
						persist_conversation: true,
						user_message_id: userMessage.id,
						options:
							Object.keys(filteredOptions).length > 0
								? filteredOptions
								: undefined,
						attachments: attachments.length > 0 ? attachments : undefined,
					},
				);

				if (jobDetails.result?.id) {
					setCurrentJobId(jobDetails.result.id);
				} else {
					console.error("Job details missing ID:", jobDetails);
					throw new Error("Failed to get job ID from response");
				}
			} catch (error) {
				console.error("Error sending message:", error);

				let errorDetails = "Unknown error occurred";
				if (error instanceof Error) {
					errorDetails = `${error.message}\n${error.stack || ""}`;
				} else if (typeof error === "object" && error !== null) {
					errorDetails = JSON.stringify(error, null, 2);
				}

				const errorMessage: Message = {
					id: Date.now().toString(),
					role: "assistant",
					message: "Sorry, there was an error processing your request.",
					stderr: errorDetails,
					timestamp: new Date(),
					status: "error",
				};

				addMessage(conversationId, errorMessage);
				setIsLoading(false);
			}
		},
		[
			conversationId,
			addMessage,
			setIsLoading,
			agentData,
			apiClient,
			setCurrentJobId,
			configData,
			scrollToBottom,
			handleSlashDispatch,
			canonicalMode,
			canonicalSessionId,
			canonicalBusy,
			canonical.frontend?.pending_gate,
			canonical.ownerEpoch,
		],
	);

	// `/stop`-equivalent for the composer's stop button in canonical mode: the
	// canonical stop control ends the session's current work through the
	// owner's own protocol (never the legacy job cancel).
	const handleCanonicalStop = useCallback(async () => {
		if (!canonicalSessionId || !conversationId) return;
		try {
			const result = await desktopResult<{
				data: { results?: { session_id: string; status: string }[] };
			}>({
				op: "sessions.stop",
				requestId: uuidv4(),
				targets: [canonicalSessionId],
				confirmed: true,
			});
			const status = result.data?.results?.[0]?.status ?? "stop_requested";
			addMessage(conversationId, {
				id: uuidv4(),
				role: "system",
				message:
					status === "already_stopped"
						? "Nothing was running."
						: "Stop requested. The session ends its current work.",
				timestamp: new Date(),
			});
		} catch (error) {
			addMessage(conversationId, {
				id: uuidv4(),
				role: "system",
				message: `Stop was not accepted: ${
					error instanceof Error ? error.message : "the backend refused it"
				}`,
				timestamp: new Date(),
				status: "error",
			});
		}
	}, [canonicalSessionId, conversationId, addMessage]);

	// Memoize the raw information content to prevent re-rendering
	const rawInfoContent = useMemo(() => {
		if (!conversationId) return "";

		return `Conversation ID: ${conversationId}
Messages count: ${messages.length}
Has more messages: ${hasMoreMessages ? "Yes" : "No"}
Loading more: ${isFetchingMore ? "Yes" : "No"}
Current job ID: ${currentJobId || "None"}
Job status: ${jobStatus || "None"}
Is loading: ${isLoading ? "Yes" : "No"}
Store messages: ${JSON.stringify(getMessages(conversationId || ""), null, 2)}`;
	}, [
		conversationId,
		messages.length,
		hasMoreMessages,
		isFetchingMore,
		currentJobId,
		jobStatus,
		isLoading,
		getMessages,
	]);

	// Handle tab change - only allow changing tabs in development mode
	const handleTabChange = useCallback((newTab: "chat" | "raw") => {
		if (isDevelopmentMode()) {
			setActiveTab(newTab);
		}
	}, []);

	// Render the appropriate content based on the state
	const renderContent = () => {
		if (!conversationId) {
			return (
				<PlaceholderView
					title="No agent selected"
					description="Select an agent from the sidebar to start a conversation."
					directionText="Choose an agent from the list"
				/>
			);
		}

		if (isError) {
			return <ErrorView message={error?.message || ""} />;
		}

		return (
			<ChatContent
				activeTab={activeTab}
				onTabChange={handleTabChange}
				agentName={agentData?.name || ""}
				description={agentData?.description || "Conversation with this agent"}
				onOpenOptions={handleOpenOptions}
				isOptionsSidebarOpen={isOptionsSidebarOpen}
				onCloseOptions={handleCloseOptions}
				agentId={conversationId}
				messages={messages}
				isLoading={isLoading}
				isLoadingMessages={isLoadingMessages}
				isFetchingMore={isFetchingMore}
				isFarFromBottom={isFarFromBottom}
				hasNewActivity={hasNewActivity}
				jobStatus={jobStatus as JobStatus | null}
				currentExecution={currentExecution}
				messagesContainerRef={messagesContainerRef}
				messagesEndRef={messagesEndRef}
				scrollToBottom={scrollToBottom}
				rawInfoContent={rawInfoContent}
				onSendMessage={handleSendMessage}
				currentJobId={currentJobId}
				onCancelJob={handleCancelJob}
				agentData={agentData}
				refetch={refetch}
				messageInputRef={messageInputRef}
				canonical={
					canonicalMode
						? {
								view: canonical,
								busy: canonicalBusy || admitting,
								onStop: handleCanonicalStop,
							}
						: undefined
				}
			/>
		);
	};

	return (
		<>
			<ChatLayout
				sidebar={
					<ChatSidebar
						selectedConversation={selectedConversation}
						onSelectConversation={handleSelectConversation}
						onNavigateToAgentSettings={handleNavigateToAgentSettings}
					/>
				}
				content={renderContent()}
			/>
			{/* The one picker host for slash destinations; null when idle. */}
			<PickerOutlet context={picker} />
		</>
	);
};
