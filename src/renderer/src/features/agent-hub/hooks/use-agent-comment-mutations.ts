import {
	createAgentComment,
	deleteAgentComment,
	updateAgentComment,
} from "@shared/api/radient/agents-api";
import type {
	CreateAgentCommentRequest,
	UpdateAgentCommentRequest,
} from "@shared/api/radient/types";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { t } from "../../../../../i18n/messages";
import { agentCommentsKeys } from "./use-agent-comments-query"; // Import query keys

/**
 * Hook for creating an agent comment mutation.
 */
export const useCreateAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { isAuthenticated } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: {
			agentId: string;
			data: CreateAgentCommentRequest;
		}) => {
			const { agentId, data } = variables;
			if (!isAuthenticated)
				throw new Error(t("ui.hub.comments.mutation.unauthorized"));
			return createAgentComment(agentId, data);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast(t("ui.hub.comments.mutation.posted"));
		},
		onError: (error) => {
			showErrorToast(
				t("ui.hub.comments.mutation.post_failed", { reason: error.message }),
			);
		},
	});
};

/**
 * Hook for updating an agent comment mutation.
 */
export const useUpdateAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { isAuthenticated } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: {
			agentId: string;
			commentId: string;
			data: UpdateAgentCommentRequest;
		}) => {
			const { agentId, commentId, data } = variables;
			if (!isAuthenticated)
				throw new Error(t("ui.hub.comments.mutation.unauthorized"));
			return updateAgentComment(agentId, commentId, data);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast(t("ui.hub.comments.mutation.updated"));
		},
		onError: (error) => {
			showErrorToast(
				t("ui.hub.comments.mutation.update_failed", { reason: error.message }),
			);
		},
	});
};

/**
 * Hook for deleting an agent comment mutation.
 */
export const useDeleteAgentCommentMutation = () => {
	const queryClient = useQueryClient();
	const { isAuthenticated } = useRadientAuth();

	return useMutation({
		mutationFn: async (variables: { agentId: string; commentId: string }) => {
			const { agentId, commentId } = variables;
			if (!isAuthenticated)
				throw new Error(t("ui.hub.comments.mutation.unauthorized"));
			return deleteAgentComment(agentId, commentId);
		},
		onSuccess: (_, variables) => {
			// Invalidate the comments list query for the specific agent to refetch
			queryClient.invalidateQueries({
				queryKey: agentCommentsKeys.list(variables.agentId),
			});
			showSuccessToast(t("ui.hub.comments.mutation.deleted"));
		},
		onError: (error) => {
			showErrorToast(
				t("ui.hub.comments.mutation.delete_failed", { reason: error.message }),
			);
		},
	});
};
