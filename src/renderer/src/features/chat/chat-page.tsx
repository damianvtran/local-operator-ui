import { useAgent, useAgents } from "@hooks/use-agents";
import {
	conversationMessagesQueryKey,
	useConversationMessages,
} from "@hooks/use-conversation-messages";
import { useJobPolling } from "@hooks/use-job-polling";
import { useScrollToBottom } from "@hooks/use-scroll-to-bottom";
import { createLocalOperatorClient } from "@renderer/api/local-operator";
import { JobsApi } from "@renderer/api/local-operator/jobs-api";
import type { JobStatus } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useConfig } from "@renderer/hooks/use-config";
import { useAgentRouteParam } from "@renderer/hooks/use-route-params";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import { isDevelopmentMode } from "@renderer/utils/env-utils";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { useChatStore } from "@store/chat-store";
import { useQueryClient } from "@tanstack/react-query";
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
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import { ErrorView } from "./error-view";
import { PlaceholderView } from "./placeholder-view";
import type { Message } from "./types";

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
	// Get agent ID from URL parameters using custom hook
	const { agentId, navigateToAgent, clearAgentId } = useAgentRouteParam();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Get agent selection store functions
	const { setLastChatAgentId, getLastAgentId, clearLastAgentId } =
		useAgentSelectionStore();

	// Fetch all agents to check if the selected agent exists
	// Set up periodic refetch to check for new messages
	const { data: agents = [] } = useAgents(1, 50, 10000); // 10000ms = 10 seconds

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
	const { getMessages } = useChatStore();

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
	const { addMessage } = useChatStore();

	// Use the job polling hook
	const {
		currentJobId,
		setCurrentJobId,
		jobStatus,
		isLoading,
		setIsLoading,
		checkForActiveJobs,
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
	);

	// Create a ref for the messages end element (for backwards compatibility)
	const messagesEndRef = useRef<HTMLDivElement>(null);

	// Check if the selected agent exists in the list of agents
	useEffect(() => {
		if (effectiveAgentId && agents.length > 0) {
			const agentExists = agents.some((agent) => agent.id === effectiveAgentId);

			if (!agentExists) {
				// If the agent doesn't exist, clear the selection and navigate to the chat page without an agent
				// Use a timeout to break the render cycle and prevent infinite loops
				setTimeout(() => {
					clearLastAgentId("chat");
					clearAgentId("chat");
				}, 0);
			}
		}
	}, [effectiveAgentId, agents, clearLastAgentId, clearAgentId]);

	// Update the last selected agent ID when the agent ID changes
	// Force scroll to bottom only when switching to a new conversation
	useEffect(() => {
		if (agentId) {
			setLastChatAgentId(agentId);

			// Only scroll if we have a new conversation with loaded messages
			if (!isLoadingMessages && messages.length > 0) {
				const prevMessages = getMessages(agentId);
				if (!prevMessages || prevMessages.length === 0) {
					scrollToBottom();
				}
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

		// Scroll to bottom once after messages load
		if (
			!didAutoScrollRef.current &&
			agentId &&
			!isLoadingMessages &&
			messages.length > 0
		) {
			// Immediately scroll to bottom (scrollTop = 0 in column-reverse)
			if (messagesContainerRef.current) {
				messagesContainerRef.current.scrollTop = 0;
				didAutoScrollRef.current = true;
			}
		}
	}, [agentId, isLoadingMessages, messages.length]);

	// Reference to track previous conversation ID
	const previousConversationIdRef = useRef<string | undefined>(undefined);

	// Check for active jobs on initial page load
	useEffect(() => {
		if (conversationId) {
			// Check for active jobs for the current agent
			// The checkForActiveJobs function will update the loading state and set the current job ID if needed
			checkForActiveJobs(conversationId);
		}
	}, [conversationId, checkForActiveJobs]);

	// Refetch messages when the conversation ID changes
	useEffect(() => {
		if (conversationId) {
			// Refetch messages to ensure we have the latest conversation
			queryClient.invalidateQueries({
				queryKey: [...conversationMessagesQueryKey, conversationId],
			});
		}
	}, [conversationId, queryClient]);

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

			try {
				// Call the cancelJob API
				await JobsApi.cancelJob(apiConfig.baseUrl, jobId);

				// Clear the current job ID and loading state
				setCurrentJobId(null);
				setIsLoading(false);

				// Add a system message indicating the job was cancelled
				if (conversationId) {
					const cancelMessage: Message = {
						id: Date.now().toString(),
						role: "system",
						message: "Job cancelled by user.",
						timestamp: new Date(),
					};

					addMessage(conversationId, cancelMessage);
				}
			} catch (error) {
				console.error("Error cancelling job:", error);
				// Show error message if cancellation fails
				if (conversationId) {
					const errorMessage: Message = {
						id: Date.now().toString(),
						role: "system",
						message: "Failed to cancel job. Please try again.",
						timestamp: new Date(),
						status: "error",
					};

					addMessage(conversationId, errorMessage);
				}
			}
		},
		[addMessage, conversationId, setCurrentJobId, setIsLoading],
	);

	// Memoized function to handle sending a new message
	const { data: configData } = useConfig();

	const handleSendMessage = useCallback(
		async (content: string, attachments: string[]) => {
			if (!conversationId) return;

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
			scrollToBottom();

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
					title="No Agent Selected"
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
