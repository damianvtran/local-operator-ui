import { createLocalOperatorClient } from "@shared/api/local-operator";
import { JobsApi } from "@shared/api/local-operator/jobs-api";
import type { JobStatus } from "@shared/api/local-operator/types";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { apiConfig } from "@shared/config";
import { useAgent } from "@shared/hooks/use-agents";
import { useConfig } from "@shared/hooks/use-config";
import { useConversationMessages } from "@shared/hooks/use-conversation-messages";
import { useJobPolling } from "@shared/hooks/use-job-polling";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { terminateStreamingMessages } from "@shared/hooks/use-streaming-message";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
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
import type { Message } from "../types/message";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import { ErrorView } from "./error-view";
import type { MessageInputHandle } from "./message-input";
import { PlaceholderView } from "./placeholder-view";
import { useSlashDispatch } from "./slash-dispatch";

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

	// Use custom hook to track scroll position and show/hide scroll button
	// Pass the messagesContainerRef to the hook to ensure it tracks the correct container
	const { isFarFromBottom, scrollToBottom } = useScrollToBottom(
		50,
		messagesContainerRef,
		messages.length,
	);

	// Create a ref for the messages end element (for backwards compatibility)
	const messagesEndRef = useRef<HTMLDivElement>(null);

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
	const handleSlashDispatch = useSlashDispatch({
		sessionId: conversationId,
		addMessage: (message) => {
			if (conversationId) addMessage(conversationId, message);
		},
	});

	const handleSendMessage = useCallback(
		async (content: string, attachments: string[]) => {
			if (!conversationId) return;

			// A leading slash is a command, full stop. Dispatch consumes it and
			// nothing below (model job creation) runs for it.
			if (await handleSlashDispatch(content)) return;

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
		],
	);

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
			/>
		);
	};

	return (
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
	);
};
