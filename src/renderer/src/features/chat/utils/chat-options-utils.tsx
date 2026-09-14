/**
 * Utility functions for chat options
 */

import type {
	AgentDetails,
	AgentUpdate,
} from "@shared/api/local-operator/types";
import type { UseMutationResult } from "@tanstack/react-query";

/**
 * Updates an agent setting and handles local state
 *
 * @param field - The field name to update
 * @param value - The new value
 * @param agentId - The agent ID
 * @param updateAgentMutation - The mutation function
 * @param setLocalAgent - Function to update local agent state
 * @param refetchAgent - Function to refetch agent data
 * @param setSavingField - Function to set the currently saving field
 * @returns A promise that resolves when the update is complete
 */
export const updateAgentSetting = async <T,>(
	field: string,
	value: T,
	agentId: string,
	updateAgentMutation: UseMutationResult<
		AgentDetails | undefined,
		Error,
		{ agentId: string; update: AgentUpdate },
		unknown
	>,
	setLocalAgent: React.Dispatch<React.SetStateAction<AgentDetails | null>>,
	refetchAgent: (() => Promise<unknown>) | undefined,
	setSavingField: React.Dispatch<React.SetStateAction<string | null>>,
): Promise<void> => {
	setSavingField(field);
	try {
		// Create update object with dynamic field
		const update: AgentUpdate = { [field]: value } as unknown as AgentUpdate;

		await updateAgentMutation.mutateAsync({
			agentId,
			update,
		});

		// Update local state immediately
		setLocalAgent((prev) =>
			prev
				? {
						...prev,
						[field]: value,
					}
				: null,
		);

		// Also refresh the agent data
		if (refetchAgent) {
			await refetchAgent();
		}
	} catch (_error) {
		// Error is already handled in the mutation
	} finally {
		setSavingField(null);
	}
};
