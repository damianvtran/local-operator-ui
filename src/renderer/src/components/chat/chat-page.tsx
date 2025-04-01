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
import { ChatLayout } from "@renderer/components/common/chat-layout";
import { apiConfig } from "@renderer/config";
import { useAgentRouteParam } from "@renderer/hooks/use-route-params";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import { isDevelopmentMode } from "@renderer/utils/env-utils";
import { useChatStore } from "@store/chat-store";
import { useQueryClient } from "@tanstack/react-query";
import React, { useState, useMemo, useEffect, useCallback } from "react";
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
	// Get agent ID from URL parameters using custom hook
	const { agentId, navigateToAgent, clearAgentId } = useAgentRouteParam();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// Get agent selection store functions
	const { setLastChatAgentId, getLastAgentId, clearLastAgentId } =
		useAgentSelectionStore();

	// Fetch all agents to check if the selected agent exists
	// Set up periodic refetch every 5 seconds to check for new messages
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
		messagesContainerRef,
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

	// Memoize the dependencies array to prevent unnecessary re-renders
	const scrollDependencies = useMemo(
		() => [messages.length, isLoading, currentJobId],
		[messages.length, isLoading, currentJobId],
	);

	// Use custom hook to scroll to bottom when messages change or when a new message is added
	// Only scrolls to bottom if user is already near the bottom
	const {
		ref: messagesEndRef,
		isFarFromBottom,
		scrollToBottom,
	} = useScrollToBottom(scrollDependencies, 100);

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
	// Also force scroll to bottom when changing agents
	// biome-ignore lint/correctness/useExhaustiveDependencies: messagesContainerRef.current is intentionally omitted to prevent infinite loops
	useEffect(() => {
		if (agentId) {
			setLastChatAgentId(agentId);

			// Force scroll to bottom when changing agents
			// Use requestAnimationFrame for smoother scrolling
			requestAnimationFrame(() => {
				if (messagesContainerRef.current) {
					messagesContainerRef.current.scrollTop =
						messagesContainerRef.current.scrollHeight;
				}
			});
		}
	}, [agentId, setLastChatAgentId]);

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
	// biome-ignore lint/correctness/useExhaustiveDependencies: messagesContainerRef.current is intentionally omitted to prevent infinite loops
	const handleSelectConversation = useCallback(
		(id: string) => {
			setLastChatAgentId(id);
			navigateToAgent(id, "chat");

			// Force scroll to bottom when selecting a conversation
			requestAnimationFrame(() => {
				if (messagesContainerRef.current) {
					messagesContainerRef.current.scrollTop =
						messagesContainerRef.current.scrollHeight;
				}
			});
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

			// Set loading state
			setIsLoading(true);

			try {
				// Send message to the API using processAgentChatAsync from AgentsApi
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

				const jobDetails = await apiClient.chat.processAgentChatAsync(
					conversationId,
					{
						hosting: agentData?.hosting || "openrouter", // Use agent's hosting or default
						model: agentData?.model || "google/gemini-2.0-flash-001", // Use agent's model or default
						prompt: content,
						persist_conversation: true, // Persist conversation history
						user_message_id: userMessage.id,
						options:
							Object.keys(filteredOptions).length > 0
								? filteredOptions
								: undefined,
						attachments: attachments.length > 0 ? attachments : undefined,
					},
				);

				// Store the job ID for polling
				// The API returns a CRUDResponse<JobDetails> where the actual job details are in the result property
				if (jobDetails.result?.id) {
					setCurrentJobId(jobDetails.result.id);
				} else {
					console.error("Job details missing ID:", jobDetails);
					throw new Error("Failed to get job ID from response");
				}

				// Note: We don't add the assistant message here
				// It will be added when the job completes (in the useJobPolling hook)
			} catch (error) {
				console.error("Error sending message:", error);

				// Extract error details
				let errorDetails = "Unknown error occurred";
				if (error instanceof Error) {
					errorDetails = `${error.message}\n${error.stack || ""}`;
				} else if (typeof error === "object" && error !== null) {
					errorDetails = JSON.stringify(error, null, 2);
				}

				// Add error message
				const errorMessage: Message = {
					id: Date.now().toString(),
					role: "assistant",
					message: "Sorry, there was an error processing your request.",
					stderr: errorDetails,
					timestamp: new Date(),
					status: "error",
				};

				// Add error message to chat store
				addMessage(conversationId, errorMessage);

				// Clear loading state
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
