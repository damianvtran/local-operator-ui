/**
 * Hook for fetching and managing agents from the Local Operator API
 *
 * This hook is gated by connectivity checks to ensure the server is online
 * and the user has internet connectivity if required by the hosting provider.
 */

import { createLocalOperatorClient } from "@renderer/api/local-operator";
import type { AgentDetails } from "@renderer/api/local-operator/types";
import { apiConfig } from "@renderer/config";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "react-toastify";
import { useConnectivityGate } from "./use-connectivity-gate";

/**
 * Query key for agents
 */
export const agentsQueryKey = ["agents"];

/**
 * Hook for fetching agents from the Local Operator API
 *
 * @param page - Page number (default: 1)
 * @param perPage - Number of agents per page (default: 50)
 * @param refetchInterval - Interval in milliseconds to refetch agents (default: 0, no refetch)
 * @param name - Optional name query to search agents by name
 * @returns Query result with agents data, loading state, error state, and refetch function
 */
export const useAgents = (
	page = 1,
	perPage = 50,
	refetchInterval = 0,
	name?: string,
) => {
	// Use the connectivity gate to check if the query should be enabled
	const { shouldEnableQuery, getConnectivityError } = useConnectivityGate();

	// Get the connectivity error if any
	const connectivityError = getConnectivityError();

	// Log connectivity error if present
	useEffect(() => {
		if (connectivityError) {
			console.error("Agents connectivity error:", connectivityError.message);
		}
	}, [connectivityError]);

	return useQuery({
		// Only enable the query if connectivity checks pass
		enabled: shouldEnableQuery(),
		queryKey: [...agentsQueryKey, page, perPage, name],
		queryFn: async () => {
			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.agents.listAgents(page, perPage, name);

				if (response.status >= 400) {
					throw new Error(response.message || "Failed to fetch agents");
				}

				return response.result?.agents || [];
			} catch (error) {
				const errorMessage =
					error instanceof Error
						? error.message
						: "An unknown error occurred while fetching agents";

				toast.error(errorMessage);
				throw error;
			}
		},
		// Prevent automatic refetches on window focus
		refetchOnWindowFocus: false,
		// Set refetch interval if provided
		refetchInterval: refetchInterval,
		// Enable background refetching if interval is set
		refetchIntervalInBackground: refetchInterval > 0,
		// Prevent stale time to avoid unnecessary refetches
		staleTime: 5000,
	});
};

/**
 * Hook for fetching a single agent by ID
 *
 * @param agentId - ID of the agent to fetch
 * @returns Query result with agent data, loading state, error state, and refetch function
 */
export const useAgent = (agentId: string | undefined) => {
	// Use the connectivity gate to check if the query should be enabled
	const { shouldEnableQuery, getConnectivityError } = useConnectivityGate();

	// Get the connectivity error if any
	const connectivityError = getConnectivityError();

	// Log connectivity error if present
	useEffect(() => {
		if (connectivityError) {
			console.error("Agent connectivity error:", connectivityError.message);
		}
	}, [connectivityError]);

	return useQuery({
		// Only enable the query if connectivity checks pass and agentId is provided
		enabled: shouldEnableQuery() && !!agentId,
		queryKey: [...agentsQueryKey, agentId],
		queryFn: async (): Promise<AgentDetails | null> => {
			if (!agentId) return null;

			try {
				// Use the properly typed client
				const client = createLocalOperatorClient(apiConfig.baseUrl);
				const response = await client.agents.getAgent(agentId);

				if (response.status >= 400) {
					throw new Error(
						response.message || `Failed to fetch agent ${agentId}`,
					);
				}

				return response.result as AgentDetails;
			} catch (error) {
				// Check if this is a 404 error (agent not found)
				// This can happen when an agent is deleted while it's selected
				const is404Error =
					error instanceof Error &&
					(error.message.includes("404") ||
						error.message.includes("not found"));

				if (!is404Error) {
					// Only show toast for non-404 errors
					const errorMessage =
						error instanceof Error
							? error.message
							: `An unknown error occurred while fetching agent ${agentId}`;

					toast.error(errorMessage);
				}

				throw error;
			}
		},
	});
};
