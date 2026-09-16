/**
 * The Schedules page's reads and writes.
 *
 * Two questions, two sources, deliberately not merged:
 *
 * - the wake listing (`wakes.list`) answers "every conversation on this machine
 *   that has wakes", and is the page's primary list;
 * - `useListAllSchedules` (in `use-schedules-queries.ts`) answers "which rows are
 *   still on the older agent-schedule engine", and feeds the fenced legacy
 *   group. That engine is frozen but its rows keep running, so a page that showed
 *   only wakes would be lying about live automation.
 *
 * Both are invalidated after a write, and every write ALSO re-reads the affected
 * conversation's canonical snapshot: a wake created or cancelled here changes
 * what the chat pane's Wakes section and the composer's chip must say, and for a
 * cold session nothing pushes that change.
 */
import {
	type DesktopWakeCreateResponse,
	type DesktopWakesListResponse,
	type WakeCreateInput,
	type WakeEditInput,
	WakesApi,
} from "@shared/api/local-operator/wakes-api";
import { apiConfig } from "@shared/config/api-config";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import {
	type UseMutationResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";

/**
 * How often the listing re-reads, and why this number.
 *
 * Nothing PUSHES the wake index: the supervisor is a separate process writing
 * files, and the only event stream this app has is per session
 * (`sessions.watch`), so a machine-wide listing can only poll. The supervisor
 * itself re-reads the index every 10 s, so 30 s is at most three supervisor
 * passes of lag on a page the user is looking at, against a read that is one
 * small file per wake-carrying session.
 */
export const WAKES_POLL_MS = 30_000;

/** One cache entry for the whole listing: there is no per-query variant of it. */
export const WAKES_LIST_KEY = ["desktop", "wakes", "list"] as const;

export const useWakesListing = () => {
	const { baseUrl } = apiConfig;
	return useQuery<DesktopWakesListResponse, Error>({
		queryKey: WAKES_LIST_KEY,
		queryFn: () => WakesApi.list(),
		enabled: !!baseUrl,
		refetchInterval: WAKES_POLL_MS,
		// A window that was in the background while a wake fired (or while the CLI
		// armed one) shows the truth the moment it is looked at again.
		refetchOnWindowFocus: true,
	});
};

/**
 * Re-read everything a wake write can change, for one conversation.
 *
 * Exported rather than inlined into each mutation so the three of them cannot
 * drift: the listing is the page's own read, and the canonical snapshot is what
 * the chat pane and the composer's chip publish. `resyncCanonicalSession` is a
 * no-op when this window is not displaying that session, which is the common
 * case on this page.
 */
const invalidateAfterWrite = (
	queryClient: ReturnType<typeof useQueryClient>,
	sessionId: string | undefined,
): void => {
	void queryClient.invalidateQueries({ queryKey: WAKES_LIST_KEY });
	if (sessionId) resyncCanonicalSession(sessionId);
};

/** Create a scheduled task: the conversation (when new) and its first wake. */
export const useCreateScheduledTask = (): UseMutationResult<
	DesktopWakeCreateResponse,
	Error,
	WakeCreateInput
> => {
	const queryClient = useQueryClient();
	return useMutation<DesktopWakeCreateResponse, Error, WakeCreateInput>({
		mutationFn: (input) => WakesApi.create(input),
		onSuccess: (result) => invalidateAfterWrite(queryClient, result.session_id),
	});
};

/** Change an armed wake. The schedule's identity is the backend's to keep. */
export const useEditWake = (): UseMutationResult<
	void,
	Error,
	WakeEditInput
> => {
	const queryClient = useQueryClient();
	return useMutation<void, Error, WakeEditInput>({
		mutationFn: (input) => WakesApi.edit(input),
		onSuccess: (_, input) => invalidateAfterWrite(queryClient, input.sessionId),
	});
};

/** Cancel one wake. The conversation stays. */
export const useCancelWake = (): UseMutationResult<
	void,
	Error,
	{ sessionId: string; wakeId: string }
> => {
	const queryClient = useQueryClient();
	return useMutation<void, Error, { sessionId: string; wakeId: string }>({
		mutationFn: ({ sessionId, wakeId }) => WakesApi.remove(sessionId, wakeId),
		onSuccess: (_, { sessionId }) =>
			invalidateAfterWrite(queryClient, sessionId),
	});
};
