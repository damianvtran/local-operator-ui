import {
	createAgentComment,
	deleteAgentComment,
	updateAgentComment,
} from "@shared/api/radient/agents-api";
import type {
	CreateAgentCommentRequest,
	UpdateAgentCommentRequest,
} from "@shared/api/radient/types";
import { apiConfig } from "@shared/config";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentCommentsKeys } from "./use-agent-comments-query"; // Import query keys

/**
 * Hook for creating an agent comment mutation.
 */
export const useCreateAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { sessionToken } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: {
			agentId: string;
			data: CreateAgentCommentRequest;
		}) => {
			const { agentId, data } = variables;
			if (!sessionToken) throw new Error("Authentication required.");
			return createAgentComment(
				apiConfig.radientBaseUrl,
				agentId,
				sessionToken,
				data,
			);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast("Comment posted successfully!");
		},
		onError: (error) => {
			showErrorToast(`Failed to post comment: ${error.message}`);
		},
	});
};

/**
 * Hook for updating an agent comment mutation.
 */
export const useUpdateAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { sessionToken } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: {
			agentId: string;
			commentId: string;
			data: UpdateAgentCommentRequest;
		}) => {
			const { agentId, commentId, data } = variables;
			if (!sessionToken) throw new Error("Authentication required.");
			return updateAgentComment(
				apiConfig.radientBaseUrl,
				agentId,
				commentId,
				sessionToken,
				data,
			);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast("Comment updated successfully!");
		},
		onError: (error) => {
			showErrorToast(`Failed to update comment: ${error.message}`);
		},
	});
};

/**
 * Hook for deleting an agent comment mutation.
 */
export const useDeleteAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { sessionToken } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: { agentId: string; commentId: string }) => {
			const { agentId, commentId } = variables;
			if (!sessionToken) throw new Error("Authentication required.");
			return deleteAgentComment(
				apiConfig.radientBaseUrl,
				agentId,
				commentId,
				sessionToken,
			);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast("Comment deleted successfully!");
		},
		onError: (error) => {
			showErrorToast(`Failed to delete comment: ${error.message}`);
		},
	});
};
