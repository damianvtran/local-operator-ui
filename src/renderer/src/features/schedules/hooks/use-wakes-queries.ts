import {
	type SessionRow,
	useSessionRows,
} from "@features/chat/pickers/destination-pickers";
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
 *
 * The third read is the create dialog's conversation picker, and it is
 * deliberately NOT the wake listing. The question it asks is "which
 * conversations exist", and the wake listing answers a different one: it is
 * keyed on conversations that already HAVE wakes, so a picker built on it can
 * only offer the conversations a user has already scheduled - which is the one
 * thing that branch is not for, since arming a wake in a conversation with none
 * is the common case. `sessions.list` is the app's own answer to the right
 * question (the same op and the same query key the stop picker reads), and the
 * wake listing is still consulted for the ceiling, where the count it carries is
 * exactly what is needed.
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
import {
	SCHEDULES_CONVERSATION_READ,
	retryWakeWrite,
} from "../scheduled-task-model";

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

/*
 * The write retry's policy lives in the model (`scheduled-task-model.ts`,
 * `retryWakeWrite`) rather than beside this hook, so a test can construct the
 * boundary instead of approximating it - round 2's M1, and the reason
 * `defaultQueryOptions` is exported for its own policy in `query-client.ts`.
 */

/** One cache entry for the whole listing: there is no per-query variant of it. */
export const WAKES_LIST_KEY = ["desktop", "wakes", "list"] as const;

/**
 * One conversation the picker can offer: the shared `SessionRow`, under the name
 * this feature reads it by - one type rather than two structural twins over one
 * cache entry (round 2, M3).
 *
 * `mtime` is the conversation's last activity in **epoch SECONDS**, which is
 * where this wire differs from the wake listing beside it (milliseconds) - named
 * here because the two are read by one dialog, and a caller that assumed the
 * other unit rendered a real conversation as "20691d ago" (measured, on the drive
 * against a live backend). `live_state` is the owner's state.
 */
export type ConversationChoice = SessionRow;

/**
 * The conversations a user could arm a wake in, newest first.
 *
 * Shared query key with the stop picker on purpose: one op, one read, one cache
 * entry - a second key would be a second request for the same answer.
 *
 * `enabled` is the DIALOG's open state, not a static `!!baseUrl`, and that is a
 * correction the live drive forced. The dialog is mounted for the page's whole
 * life, so with a always-on query the list was read once when the page loaded
 * and never again: the picker then offered the conversations that existed at
 * page load, and a conversation created since was missing from it - which is the
 * same defect the source change was made to fix, one layer down. Disabling while
 * closed and enabling on open makes the question "what exists NOW" get asked
 * when it is asked; the focus refetch covers a dialog left open across a
 * conversation made in another window.
 */
export const useConversationChoices = (enabled: boolean) => {
	const { baseUrl } = apiConfig;
	/*
	 * Through the shared read, not a second declaration of it: same op, same
	 * `limit`, same mapping and same cache entry as the stop picker, so the only
	 * thing this caller owns is the two options that differ (round 2, M3).
	 */
	return useSessionRows({
		enabled: enabled && !!baseUrl,
		...SCHEDULES_CONVERSATION_READ,
	});
};

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
		retry: retryWakeWrite,
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
		retry: retryWakeWrite,
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
		retry: retryWakeWrite,
		onSuccess: (_, { sessionId }) =>
			invalidateAfterWrite(queryClient, sessionId),
	});
};
