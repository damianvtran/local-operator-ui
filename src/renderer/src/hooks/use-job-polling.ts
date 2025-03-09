import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { JobDetails, JobStatus } from "@renderer/api/local-operator/types";
import type { Message } from "@renderer/components/chat/types";
import { apiConfig } from "@renderer/config";
import { useChatStore } from "@renderer/store/chat-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
/**
 * Custom hook for polling job status using React Query
 * Handles polling for job status and provides state for tracking job progress
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { agentsQueryKey } from "./use-agents";
import { convertToMessage } from "./use-conversation-messages";
import { conversationMessagesQueryKey } from "./use-conversation-messages";

type UseJobPollingParams = {
	conversationId?: string;
	addMessage: (conversationId: string, message: Message) => void;
};

type UseJobPollingResult = {
	currentJobId: string | null;
	setCurrentJobId: (jobId: string | null) => void;
	jobStatus: JobStatus | null;
	isLoading: boolean;
	setIsLoading: (isLoading: boolean) => void;
	checkForActiveJobs: (agentId: string) => Promise<boolean>;
};

/**
 * Custom hook for polling job status using React Query
 *
 * @param params - Parameters for the hook
 * @returns Job polling state and functions
 */
export const useJobPolling = ({
	conversationId,
	addMessage,
}: UseJobPollingParams): UseJobPollingResult => {
	const [currentJobId, setCurrentJobId] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const queryClient = useQueryClient();
	const { getMessages, setMessages } = useChatStore();
	const lastProcessedJobDataRef = useRef<string | null>(null);
	const client = createLocalOperatorClient(apiConfig.baseUrl);
	const previousConversationIdRef = useRef<string | undefined>(conversationId);

	/**
	 * Check if an agent has any active jobs
	 *
	 * @param agentId - The agent ID to check for active jobs
	 * @returns Promise that resolves to true if the agent has active jobs, false otherwise
	 */
	const checkForActiveJobs = useCallback(
		async (agentId: string): Promise<boolean> => {
			if (!agentId) return false;

			try {
				// Get active jobs for this agent (pending or processing)
				const pendingResponse = await client.jobs.listJobs(agentId, "pending");
				const processingResponse = await client.jobs.listJobs(
					agentId,
					"processing",
				);

				const pendingJobs = pendingResponse.result?.jobs || [];
				const processingJobs = processingResponse.result?.jobs || [];

				// If there are any active jobs, update the current job ID and loading state
				const activeJobs = [...pendingJobs, ...processingJobs];

				if (activeJobs.length > 0) {
					// Use the most recent job
					const mostRecentJob = activeJobs.sort((a, b) => {
						const dateA = new Date(a.created_at || 0);
						const dateB = new Date(b.created_at || 0);
						return dateB.getTime() - dateA.getTime();
					})[0];

					// Only update if this is a different job than we're currently tracking
					if (mostRecentJob.id !== currentJobId) {
						setCurrentJobId(mostRecentJob.id);
						setIsLoading(true);
					}

					return true;
				}

				return false;
			} catch (error) {
				console.error("Error checking for active jobs:", error);
				return false;
			}
		},
		[client.jobs, currentJobId],
	);

	// Reset loading state and job ID when switching agents
	useEffect(() => {
		// If the conversation ID has changed, reset the loading state and job ID
		if (conversationId !== previousConversationIdRef.current) {
			// Reset the loading state and job ID
			setIsLoading(false);
			setCurrentJobId(null);

			// If we have a new conversation ID, check for active jobs
			if (conversationId) {
				// We need to check for active jobs for the new agent
				const checkNewAgentJobs = async () => {
					try {
						// Get active jobs for this agent (pending or processing)
						const pendingResponse = await client.jobs.listJobs(
							conversationId,
							"pending",
						);
						const processingResponse = await client.jobs.listJobs(
							conversationId,
							"processing",
						);

						const pendingJobs = pendingResponse.result?.jobs || [];
						const processingJobs = processingResponse.result?.jobs || [];

						// If there are any active jobs, update the current job ID and loading state
						const activeJobs = [...pendingJobs, ...processingJobs];

						if (activeJobs.length > 0) {
							// Use the most recent job
							const mostRecentJob = activeJobs.sort((a, b) => {
								const dateA = new Date(a.created_at || 0);
								const dateB = new Date(b.created_at || 0);
								return dateB.getTime() - dateA.getTime();
							})[0];

							// Set the current job ID and loading state
							setCurrentJobId(mostRecentJob.id);
							setIsLoading(true);
						}
					} catch (error) {
						console.error("Error checking for active jobs:", error);
					}
				};

				checkNewAgentJobs();
			}
		}

		// Update the ref
		previousConversationIdRef.current = conversationId;
	}, [conversationId, client.jobs]);

	/**
	 * Update conversation messages from execution history
	 *
	 * @param agentId - The agent ID to fetch execution history for
	 * @returns Promise that resolves when the update is complete
	 */
	const updateConversationMessages = useCallback(
		async (agentId: string) => {
			if (!agentId) return;

			try {
				// Create a client instance to use the properly typed API
				const client = createLocalOperatorClient(apiConfig.baseUrl);

				// Fetch the execution history for the agent
				const response = await client.agents.getAgentExecutionHistory(
					agentId,
					1, // First page
					50, // Get a reasonable number of executions
				);

				if (response.status >= 400 || !response.result) {
					throw new Error(
						response.message || "Failed to fetch execution history",
					);
				}

				// Get the execution records from the API response
				const executionRecords = response.result.history || [];

				// Get existing messages from the store
				const existingMessages = getMessages(agentId);

				// Convert API execution records to UI messages
				const apiMessages = executionRecords.map(convertToMessage);

				// Find new messages that don't exist in the store
				// We'll consider a message new if we don't have a message with the same ID
				const existingIds = new Set(existingMessages.map((m) => m.id));
				const newMessages = apiMessages.filter((m) => !existingIds.has(m.id));

				if (newMessages.length > 0) {
					// Add new messages to the store
					const updatedMessages = [...existingMessages, ...newMessages];
					setMessages(agentId, updatedMessages);

					// Invalidate the conversation messages query to trigger a refetch
					queryClient.invalidateQueries({
						queryKey: [...conversationMessagesQueryKey, agentId],
					});

					// Invalidate the agents query to update the sidebar with the latest message
					queryClient.invalidateQueries({
						queryKey: agentsQueryKey,
					});
				}

				return true;
			} catch (error) {
				console.error("Error fetching execution history:", error);
				return false;
			}
		},
		[getMessages, setMessages, queryClient],
	);

	// Handle job completion
	// biome-ignore lint/correctness/useExhaustiveDependencies: queryClient.invalidateQueries is intentionally omitted to prevent infinite loops
	const handleJobCompletion = useCallback(
		async (job: JobDetails) => {
			if (!conversationId) return;

			// If job is completed, process the result
			if (job.status === "completed" && job.result) {
				// Try to update messages from execution history
				const updated = await updateConversationMessages(conversationId);

				// If we couldn't update from execution history, fallback to just adding the assistant message
				if (!updated && job.result.response) {
					const assistantMessage: Message = {
						id: Date.now().toString(),
						role: "assistant",
						message: job.result.response,
						timestamp: new Date(),
					};

					// Add assistant message to chat store
					addMessage(conversationId, assistantMessage);
				}
			}
			// If job failed, show error message
			else if (job.status === "failed") {
				const errorMessage: Message = {
					id: Date.now().toString(),
					role: "assistant",
					message:
						"Sorry, there was an error processing your request. The job failed.",
					timestamp: new Date(),
				};

				addMessage(conversationId, errorMessage);
			}

			// Invalidate the agents query to update the sidebar with the latest message
			queryClient.invalidateQueries({
				queryKey: agentsQueryKey,
			});

			// Clear job tracking
			setCurrentJobId(null);
			setIsLoading(false);
		},
		[conversationId, addMessage, updateConversationMessages],
	);

	// Use React Query to poll for job status
	const {
		data: jobData,
		error,
		dataUpdatedAt,
	} = useQuery({
		queryKey: ["job", currentJobId],
		queryFn: async () => {
			if (!currentJobId) return null;

			// Create a client instance to use the properly typed API
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const response = await client.jobs.getJobStatus(currentJobId);
			return response.result;
		},
		// Only run the query if we have a job ID
		enabled: !!currentJobId,
		// Poll every 1 second while job is active
		refetchInterval: currentJobId ? 1000 : false,
		// Force refetch on interval regardless of window focus
		refetchIntervalInBackground: true,
		// Don't refetch on window focus while polling
		refetchOnWindowFocus: false,
		// Don't cache the result
		gcTime: 0,
		staleTime: 0,
		// Retry failed requests to ensure polling continues
		retry: true,
		retryDelay: 1000,
	});

	// Process job data when it changes
	useEffect(() => {
		if (!jobData || !conversationId) return undefined;

		// Create a unique identifier for the current job data to detect changes
		const jobDataSignature = `${jobData.id}-${jobData.status}-${dataUpdatedAt}`;

		// Only process if this is new data
		if (jobDataSignature !== lastProcessedJobDataRef.current) {
			// Update the reference to the last processed job data
			lastProcessedJobDataRef.current = jobDataSignature;

			// Update messages on each poll to show real-time progress, but with debounce
			// to prevent too frequent updates that cause flickering
			if (jobData.status === "processing") {
				// Use a debounced update to prevent flickering
				const debounceTimeout = setTimeout(() => {
					updateConversationMessages(conversationId);
				}, 500); // 500ms debounce

				// Clean up timeout if component unmounts or job data changes again
				return () => clearTimeout(debounceTimeout);
			}

			// If job is completed or failed, handle it immediately
			if (jobData.status === "completed" || jobData.status === "failed") {
				handleJobCompletion(jobData);
			}
		}

		return undefined;
	}, [
		jobData,
		dataUpdatedAt,
		handleJobCompletion,
		conversationId,
		updateConversationMessages,
	]);

	// Log any errors
	useEffect(() => {
		if (error) {
			console.error("Error polling job status:", error);
			// Force refetch on error to ensure polling continues
			if (currentJobId) {
				queryClient.invalidateQueries({ queryKey: ["job", currentJobId] });
			}
		}
	}, [error, currentJobId, queryClient]);

	return {
		currentJobId,
		setCurrentJobId,
		jobStatus: jobData?.status || null,
		isLoading,
		setIsLoading,
		checkForActiveJobs,
	};
};
