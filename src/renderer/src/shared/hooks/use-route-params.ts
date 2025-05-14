/**
 * Custom hook for working with route parameters
 *
 * Provides utilities for accessing and updating URL parameters
 */

import { getCurrentPath, pathIncludes } from "@shared/utils/path-utils";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Hook for working with agent ID in routes
 *
 * @returns Object with agent ID and functions to update it
 */
export const useAgentRouteParam = () => {
	const { agentId } = useParams<{ agentId?: string }>();
	const navigate = useNavigate();

	/**
	 * Get the current base path (chat or agents)
	 * Works with both hash and browser router
	 */
	const getCurrentBasePath = (): "chat" | "agents" => {
		const currentPath = getCurrentPath();
		return pathIncludes(currentPath, "/chat") ? "chat" : "agents";
	};

	/**
	 * Navigate to a specific agent
	 *
	 * @param id - Agent ID to navigate to
	 * @param path - Base path to use (defaults to current path)
	 */
	const navigateToAgent = (id: string, path?: "chat" | "agents") => {
		if (!id) return;

		const basePath = path || getCurrentBasePath();
		navigate(`/${basePath}/${id}`);
	};

	/**
	 * Clear the agent ID from the URL
	 *
	 * @param path - Base path to navigate to
	 */
	const clearAgentId = (path?: "chat" | "agents") => {
		const basePath = path || getCurrentBasePath();
		navigate(`/${basePath}`);
	};

	return {
		agentId,
		navigateToAgent,
		clearAgentId,
	};
};

/**
 * Hook for determining the current view from the URL
 *
 * @returns The current view based on the URL path ('chat', 'agents', 'agent-hub', 'settings')
 */
export const useCurrentView = ():
	| "chat"
	| "agents"
	| "agent-hub"
	| "settings"
	| "schedules" => {
	const currentPath = getCurrentPath();

	if (pathIncludes(currentPath, "/chat")) {
		return "chat";
	}

	if (pathIncludes(currentPath, "/agents")) {
		return "agents";
	}

	if (pathIncludes(currentPath, "/settings")) {
		return "settings";
	}

	if (pathIncludes(currentPath, "/agent-hub")) {
		return "agent-hub";
	}

	if (pathIncludes(currentPath, "/schedules")) {
		return "schedules";
	}

	// Default to chat if no match
	return "chat";
};
