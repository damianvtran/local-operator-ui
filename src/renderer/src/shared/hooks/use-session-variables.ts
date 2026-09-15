import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
/**
 * React Query bindings for a session's code memory.
 *
 * These are the panel's only route to the namespace. The reader polls while
 * the backend reports `busy` and does not retry anything else, and the
 * mutations own the user-facing sentence on both success and refusal, because
 * the backend's refusal `message` is written for a user and the surface that
 * shows it is a toast.
 */
import {
	createSessionVariable,
	deleteSessionVariable,
	listSessionVariables,
	sessionVariablesQueryKey,
	updateSessionVariable,
} from "@shared/api/local-operator/session-variables-api";
import type {
	SessionVariablesResult,
	VariableWrite,
} from "@shared/api/local-operator/session-variables-api";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Read a session's code memory.
 *
 * `enabled` is the caller's capabilities gate, and the query is also disabled
 * without a `sessionId`: a staged draft has no session, so there is nothing to
 * ask about and asking would be a call that can only 404. Neither condition is
 * an error state - the panel has honest copy for both.
 *
 * Polling is confined to `busy`, which means "a cell is running and the
 * namespace cannot be read right now". Anything else is a settled answer:
 * re-asking cannot change a 404, an `unsupported` runtime or an observed list,
 * and a retry in front of those would only delay the sentence the panel shows.
 */
export const useSessionVariables = (
	sessionId: string | undefined,
	enabled: boolean,
) =>
	useQuery<SessionVariablesResult, Error>({
		queryKey: sessionVariablesQueryKey(sessionId),
		queryFn: async () => {
			if (!sessionId) {
				throw new Error("A session id is required to read code memory.");
			}
			return listSessionVariables(sessionId);
		},
		enabled: enabled && Boolean(sessionId),
		refetchInterval: (query) =>
			query.state.data?.state === "busy" ? 1500 : false,
		/*
		 * Always re-read when the panel is opened, whatever the cache thinks.
		 *
		 * The app's default `staleTime` is five minutes, and a namespace is the
		 * one thing on this surface that a turn changes without any client
		 * action: opening the panel is the user asking "what is in there now",
		 * and answering it from a five-minute-old read is how the panel came to
		 * say "Nothing stored yet" about five values (UX round 2, U1). One GET.
		 */
		refetchOnMount: "always",
		retry: false,
	});

/**
 * The success sentence and the refusal sentence, in one place.
 *
 * A 409 from a write carries the backend's own reason (`reserved_name`,
 * `already_exists`, `no_kernel`, ...) as its `detail.message`, and that
 * sentence names the limit rather than restating the failure - so it is shown
 * verbatim and the local wording is only the fallback for a failure that was
 * never the backend's (a transport that never answered).
 */
const invalidateSessionVariables =
	(queryClient: ReturnType<typeof useQueryClient>) =>
	async (_data: unknown, _error: unknown, variables: { sessionId: string }) => {
		await queryClient.invalidateQueries({
			queryKey: sessionVariablesQueryKey(variables.sessionId),
		});
	};

/** Create a name in a session's namespace. */
export const useCreateSessionVariable = () => {
	const queryClient = useQueryClient();
	return useMutation<unknown, Error, { sessionId: string } & VariableWrite>({
		mutationFn: ({ sessionId, ...write }) =>
			createSessionVariable(sessionId, write),
		onSuccess: async () => {
			showSuccessToast("Variable created");
		},
		onError: (error) => {
			showErrorToast(
				userFacingMessage(error, "The variable could not be created."),
			);
		},
		onSettled: invalidateSessionVariables(queryClient),
	});
};

/** Replace an existing name's value and type. */
export const useUpdateSessionVariable = () => {
	const queryClient = useQueryClient();
	return useMutation<unknown, Error, { sessionId: string } & VariableWrite>({
		mutationFn: ({ sessionId, ...write }) =>
			updateSessionVariable(sessionId, write),
		onSuccess: async () => {
			showSuccessToast("Variable updated");
		},
		onError: (error) => {
			showErrorToast(
				userFacingMessage(error, "The variable could not be updated."),
			);
		},
		onSettled: invalidateSessionVariables(queryClient),
	});
};

/**
 * Forget a name.
 *
 * `onSettled` rather than `onSuccess` invalidation: a refusal that removed
 * nothing still needs the list re-read, because the refusal's own reason
 * (`not_found`) is a fact about the namespace the panel is showing.
 */
export const useDeleteSessionVariable = () => {
	const queryClient = useQueryClient();
	return useMutation<unknown, Error, { sessionId: string; key: string }>({
		mutationFn: ({ sessionId, key }) => deleteSessionVariable(sessionId, key),
		onSuccess: async () => {
			showSuccessToast("Variable deleted");
		},
		onError: (error) => {
			showErrorToast(
				userFacingMessage(error, "The variable could not be deleted."),
			);
		},
		onSettled: invalidateSessionVariables(queryClient),
	});
};
