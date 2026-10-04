/**
 * The FLEET ask read model: every conversation's queued asks, and the second
 * subject the scope line can have.
 *
 * ## Why this is a second read rather than a widened session read
 *
 * A session's queue arrives on that session's own canonical frame, which is
 * scoped to the conversation being watched and is therefore SILENT about every
 * other conversation by construction (`ask-queue.ts`'s `sessionAsks` reads it).
 * "What is waiting anywhere in this app" is a question no per-session frame can
 * answer, so the fleet scope has its own source: `GET /v1/desktop/asks`, which
 * the backend answers from the DERIVED ask index - one directory scan, no
 * session opened and no runtime dialled, which is what makes it answerable while
 * nothing is running (`local_operator/asks/store.py`'s `index_asks`, the note on
 * `asks.list` in `desktop-contract.ts`).
 *
 * ## Absence is not emptiness, here as well
 *
 * `ask-queue.ts`'s first rule is that a backend which does not publish `asks`
 * must not grow an affordance that can never be satisfied. The aggregate route
 * is newer than the per-session field, so on a backend that predates it the read
 * FAILS (404) and this module answers `frontend: null` - the same value the
 * session lane uses for "this backend does not do queued asks" - which is what
 * keeps the top-level row and the drawer off rather than drawing a control whose
 * every press would 404. `answered` is the separate fact a caller needs when it
 * wants to know whether the route exists at all (an empty list is a legitimate
 * answer and renders an empty surface).
 *
 * ## Identity comes from the wire, never from display text
 *
 * A fleet answer targets ANOTHER conversation, so the row has to name its own
 * session. That identity is the aggregate's own `session_id` (the row-shape
 * addition `index_asks` documents), and `cwd` is the naming half - both are
 * fields the route already publishes rather than a second source minted here.
 * Nothing in this module keys on a display string: `ask_id` is the answer's
 * address everywhere else in the app and stays the address here.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { useQuery } from "@tanstack/react-query";
import type { PendingAsk } from "../../../../shared/desktop-session-contract";
import type { AskPresentation } from "./ask-queue";
import { askQueueView } from "./ask-queue";

/**
 * The aggregate read's cache key.
 *
 * ONE leaf, deliberately: the fleet view is the same document for every reader
 * (the top-level row's badge and the drawer's list are two lenses on one answer),
 * so an invalidation after an answer drops exactly the thing both read.
 */
export const FLEET_ASKS_QUERY_KEY = ["desktop", "asks"] as const;

/**
 * How often the fleet count re-asks while the window is open.
 *
 * WHY IT POLLS AT ALL. The count is an attention fact about conversations the
 * user is NOT looking at, and nothing else in the renderer announces it: the
 * per-session frames only exist for the conversation on screen. A badge that
 * only moved when the user happened to navigate would be the "it needs a
 * refresh" defect the capabilities watch records for its own read.
 *
 * WHY THIS CADENCE. Ten seconds is the order of the lane's own clock (the
 * countdown ticks at a second, a deadline's warning window is minutes) and it is
 * a bounded cost: one index scan per interval, off the event loop on the
 * backend's side, with no session opened and no runtime dialled. It deliberately
 * does NOT run in the background (`refetchIntervalInBackground` is left off,
 * unlike the capabilities watch): React Query's default focus refetch already
 * re-asks the moment the user comes back to the window, which is the only moment
 * a stale badge could mislead anyone, and an ask is answered by a person at the
 * screen rather than by a background process.
 */
export const FLEET_ASKS_POLL_MS = 10_000;

/**
 * The aggregate's rows, normalised - and the rows with no identity DROPPED.
 *
 * The route answers `{ asks: [...] }` where each row is the frozen `PendingAsk`
 * shape plus `session_id` and `cwd`. A row with no `ask_id` has no address to
 * answer and no `session_id` has no conversation to answer INTO, so neither can
 * be rendered as a fleet card: the answer would be addressed at nothing. They are
 * dropped rather than rendered inert - the same rule `mesh-approvals.ts`'s
 * `approvalRows` follows for a row missing its id or state.
 */
export function fleetAskRows(value: unknown): PendingAsk[] {
	const source = Array.isArray(value)
		? value
		: ((value as { asks?: unknown } | null)?.asks ?? []);
	if (!Array.isArray(source)) return [];
	const rows: PendingAsk[] = [];
	for (const raw of source) {
		if (raw === null || typeof raw !== "object") continue;
		const row = raw as PendingAsk;
		if (typeof row.ask_id !== "string" || row.ask_id.length === 0) continue;
		const sessionId = row.session_id;
		if (typeof sessionId !== "string" || sessionId.length === 0) continue;
		rows.push(row);
	}
	return rows;
}

/**
 * The OUTSTANDING count: what the top-level badge shows, and the same number the
 * session chip's badge states for one conversation.
 *
 * The backend's outstanding set folds `timed_out` in (`asks/store.py`), because
 * a late answer still reaches the agent - so this is the count of rows a control
 * on this surface can still do something about, which is exactly what a badge
 * promising "waiting on you" has to mean. Read from the rows rather than from a
 * published tally because the AGGREGATE route carries no tally and no cap: the
 * rows ARE the whole population here.
 */
export const fleetAsksOutstanding = (rows: readonly PendingAsk[]): number =>
	askQueueView({ asks: [...rows] }).rows.filter((row) => row.open).length;

/**
 * The view the drawer and the badge both read, or `null` when the route answered
 * something that is not a row list.
 *
 * `asks_open` is the derived outstanding count rather than an omitted field: the
 * aggregate is uncapped, so rows and tally agree by construction, and stating it
 * keeps the chip, the drawer's title and the announced name reading the same
 * number (`ask-queue.ts`'s "the louder number wins" rule exists for the frame
 * that disagrees - this one cannot, and says so with a real number rather than
 * leaning on the fallback).
 */
export type FleetAskFrontend = {
	asks: PendingAsk[];
	asks_open: number;
	asks_truncated: false;
};

export function fleetAskFrontend(
	rows: readonly PendingAsk[],
): FleetAskFrontend {
	return {
		asks: [...rows],
		asks_open: fleetAsksOutstanding(rows),
		asks_truncated: false,
	};
}

/**
 * The conversation an ask belongs to, in the reader's words - or `null` for a row
 * that names none, which is what keeps a session-scoped row from growing a label
 * it has no value for.
 *
 * `cwd` is the aggregate's own naming field (the directory the conversation runs
 * in), and its basename is the honest short name: it is the thing the user
 * recognises a conversation by, and it is already what the app prints for a
 * session's working directory elsewhere. The id is the FALLBACK rather than the
 * first choice - a raw 12-hex id is an identity, not a name, and printing only
 * that would leave the reader unable to tell two conversations apart. Its tail is
 * used because the tail is what every other surface's disambiguator spends
 * (`deviceLabel`'s rule) and because a truncated head is the half ids vary in.
 */
export function fleetAskConversationLabel(ask: PendingAsk): string | null {
	const cwd = typeof ask.cwd === "string" ? ask.cwd : "";
	const trimmed = cwd.replace(/[/\\]+$/, "");
	if (trimmed.length > 0) {
		const parts = trimmed.split(/[/\\]/);
		const last = parts[parts.length - 1];
		if (last && last.length > 0) return last;
	}
	const sessionId = ask.session_id;
	if (typeof sessionId !== "string" || sessionId.length === 0) return null;
	return `conversation ${sessionId.slice(-4)}`;
}

/**
 * The session an answer to `askId` must be posted to - the CORRECTNESS HEART of
 * the fleet scope (design note §4.4: the fleet panel answers into its own
 * conversation, never the one that happens to be open).
 *
 * Looked up from the rows the panel is PAINTING, by `ask_id`: the id the panel
 * already addresses its press with, so the surface and the answer cannot disagree
 * about which row was pressed. `null` for an id not in the list - which refuses
 * the press rather than guessing a session, the same honest failure
 * `answerQueuedAsk` takes for a missing `session_id`.
 */
export function fleetAskSessionFor(
	rows: readonly PendingAsk[],
	askId: string,
): string | null {
	const row = rows.find((candidate) => candidate.ask_id === askId);
	if (!row) return null;
	const sessionId = row.session_id;
	return typeof sessionId === "string" && sessionId.length > 0
		? sessionId
		: null;
}

/** What `useFleetAsks` answers: the rows, the badge count, and whether the route exists. */
export type FleetAsks = {
	/**
	 * The rows the surfaces paint, or `null` while the route has not answered
	 * (loading, refused, or a backend that predates it) - the value `askQueueView`
	 * reads as "no asks surface here". A backend that answers with an EMPTY list
	 * gives `[]`, which is a different fact and paints the empty surface.
	 */
	rows: PendingAsk[] | null;
	/** The outstanding count for the badge, 0 whenever `rows` is null. */
	outstanding: number;
	/** Whether the route has answered at all: the capability-by-answer gate. */
	answered: boolean;
	/** The drawer's own prop, `null` until the read answers. */
	frontend: FleetAskFrontend | null;
	/** One row, by id, with its own conversation - the answer path's lookup. */
	rowFor: (askId: string) => PendingAsk | null;
};

/**
 * Every conversation's queued asks, kept live by a bounded poll.
 *
 * The provider gate is `useOptionalQueryClient`'s, for the reason
 * `useDesktopCapabilities` states: `useQuery` throws without a client, and a
 * document that mounts none (the mini view) must read this as "no answer" rather
 * than fetch from a private fallback nothing else can see.
 */
export function useFleetAsks(): FleetAsks {
	const { client, provided } = useOptionalQueryClient();
	const query = useQuery(
		{
			enabled: provided,
			queryKey: FLEET_ASKS_QUERY_KEY,
			queryFn: async () =>
				fleetAskRows(await desktopResult({ op: "asks.list" })),
			/*
			 * NO STALE WINDOW: the previous answer is what the badge was showing, and
			 * the point of the poll is to move it. Zero here means a remount (a route
			 * change) re-asks rather than repainting a count that may be a whole
			 * interval old.
			 */
			staleTime: 0,
			retry: retryDesktopQuery,
			refetchInterval: FLEET_ASKS_POLL_MS,
		},
		client,
	);
	const rows = query.data ?? null;
	return {
		rows,
		outstanding: rows === null ? 0 : fleetAsksOutstanding(rows),
		answered: query.data !== undefined,
		frontend: rows === null ? null : fleetAskFrontend(rows),
		rowFor: (askId) =>
			rows === null ? null : (rows.find((row) => row.ask_id === askId) ?? null),
	};
}

/**
 * The panel's per-row conversation label, as a function the drawer can hand down.
 *
 * Exported from the model rather than spelled in the component so the fleet's
 * "which conversation is this?" rule has ONE expression, and typed against
 * `AskPresentation` because that is what a row arrives as.
 */
export const fleetAskRowConversation = (row: AskPresentation): string | null =>
	fleetAskConversationLabel(row.ask);
