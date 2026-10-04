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
 * backend's side, with no session opened and no runtime dialled.
 *
 * THE POPULATION THE SCAN COVERS IS UNCAPPED, AND THE POLL IS NOT, which is the
 * one asymmetry worth stating rather than discovering later. The route is
 * deliberately unfiltered and un-truncated (`asks/store.py`'s `index_asks` reads
 * every session's index under the config dir and caps nothing, because a frame
 * may not silently drop a session's question), and the backend's own note says it
 * "WOULD need one before it ever feeds a frame" - this read is not a frame, so
 * that requirement does not bind it. The cost is therefore O(sessions) every ten
 * seconds on a host that runs many; it is still the cheaper half of the two, since
 * the alternative (a per-session subscription) is O(sessions) frames, and the
 * count is a fact about conversations the user is NOT looking at, which nothing
 * else in the renderer announces. A cap belongs on the route, not on this poll,
 * and lands with the first caller that needs to bound a frame.
 *
 * It deliberately does NOT run in the background (`refetchIntervalInBackground` is left off,
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
 * The same outstanding set, COUNTED PER CONVERSATION - what the sidebar's own row
 * marks read.
 *
 * ## Why the rows come from here rather than from the row's own field
 *
 * `SessionCatalogueRow.asks_open` is declared in the shared contract and read by
 * `chat-session-status.tsx`'s mark, but the desktop catalogue route never fills
 * it (the backend's row model carries no such field), so a mark sourced from the
 * row itself draws nothing on every desktop install - the operator's report,
 * verbatim: the session's sidebar row showed nothing while the composer chip
 * beside it read "1 question waiting". The aggregate route is the only read that
 * answers for conversations the user is not looking at, and it is uncapped, so
 * the per-row count and the top-level badge are two lenses on ONE population
 * (design `ask-nonblocking.md` §5.0: "the row marks the session, the top-level
 * count sums them") rather than two derivations that can disagree.
 *
 * The predicate is `fleetAsksOutstanding`'s, deliberately: `askQueueView`'s
 * `open` folds `timed_out` in, because a late answer still reaches the agent -
 * so a row keeps its mark while its question is still answerable and loses it
 * when the last one is answered or passes out of the answerable set. A second
 * predicate here is how the row and the badge would start disagreeing, which is
 * the defect class this module exists to prevent.
 *
 * Sessions with nothing outstanding are ABSENT from the map, not present with
 * `0`: every reader asks `get` and treats a miss as "draw nothing", so a zero
 * entry would be a claim no caller ever wants and one more shape to keep true.
 */
export function fleetAsksBySession(
	rows: readonly PendingAsk[],
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of askQueueView({ asks: [...rows] }).rows) {
		if (!row.open) continue;
		const sessionId = row.ask.session_id;
		if (typeof sessionId !== "string" || sessionId.length === 0) continue;
		counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
	}
	return counts;
}

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
 * The conversation a row belongs to, in the reader's words - the SAME name the
 * sessions list gives it, with the directory as the stated fallback.
 *
 * WHY THE TITLE FIRST. `chat-sidebar.tsx` names every conversation by
 * `row.title`, so a fleet card that named the same conversation by its `cwd`
 * basename gave ONE conversation TWO names - and, worse, printed the identical
 * label for two conversations opened in one repository, where the reader's next
 * act is to answer one of them. The title is the name the product already uses,
 * and the catalogue that holds it (`CanonicalSessionRow.title`) is the same one
 * the list reads; `titleOf` is that catalogue's answer for this row's
 * `session_id`, passed in so this module stays a pure function of its arguments
 * and a test needs no store.
 *
 * WHY THE DIRECTORY IS THE FALLBACK RATHER THAN THE LIST'S PLACEHOLDER. The list
 * prints `Untitled chat` for an empty title, which is a place-holder that names
 * nothing - a second `Untitled chat` card is no more distinguishable than the
 * first, so the directory (the one thing a row always carries) is the better
 * second choice. The row's conversation may also not be in the loaded catalogue
 * at all (an archived or un-paged conversation), and the aggregate route is the
 * only source guaranteed to have it.
 *
 * `null` for a row that names nothing at all - no title, no directory, no
 * session id - which is what keeps a session-scoped row from growing a label it
 * has no value for.
 */
export function fleetAskConversationLabel(
	ask: PendingAsk,
	titleOf?: FleetAskTitleLookup,
): string | null {
	const sessionId = typeof ask.session_id === "string" ? ask.session_id : "";
	const title = titleOf === undefined ? null : titleOf(sessionId);
	if (typeof title === "string" && title.trim().length > 0) return title.trim();
	const cwd = typeof ask.cwd === "string" ? ask.cwd : "";
	const trimmed = cwd.replace(/[/\\]+$/, "");
	if (trimmed.length > 0) {
		const parts = trimmed.split(/[/\\]/);
		const last = parts[parts.length - 1];
		if (last && last.length > 0) return last;
	}
	if (sessionId.length === 0) return null;
	return `conversation ${sessionId.slice(-4)}`;
}

/**
 * EVERY VISIBLE ROW'S NAME, resolved together so the collision can be handled
 * rather than hidden.
 *
 * A per-row function cannot know that another row resolved to the same string,
 * and that is exactly the state that misleads: two speakers named `minervaai` (a
 * title that was never auto-generated, or two conversations in one repository)
 * leave the reader picking between identical cards. So the naming is a function
 * of the LIST: a name shared by more than one CONVERSATION gains the session id's
 * tail - the same disambiguator every other surface spends (`deviceLabel`'s rule,
 * and `fleetAskConversationLabel`'s own last resort) - and the tail is appended
 * rather than substituted so the name the list uses is still what the card
 * leads with. The count is per `session_id` rather than per row, because several
 * asks from ONE conversation are the ordinary case and are not a collision.
 *
 * THE COMPARISON IS CASE-INSENSITIVE but the printed name is not normalised: two
 * spellings of one directory are still one ambiguous label to a reader, while
 * rewriting the author's capitalisation would be this module editing a name it
 * only meant to distinguish.
 */
export function fleetAskConversationLabels(
	asks: readonly PendingAsk[],
	titleOf?: FleetAskTitleLookup,
): Map<string, string> {
	const named = asks.map((ask) => ({
		ask,
		label: fleetAskConversationLabel(ask, titleOf),
	}));
	/*
	 * COUNTED PER CONVERSATION, NOT PER ROW. A conversation's queue can hold many
	 * asks - the ordinary case is several from one - and a per-row tally read those
	 * as a collision and appended a tail to a name nothing else shared (the first
	 * capture of this set shipped exactly that: three cards of one conversation
	 * came out `Migrate the billing schema · cdef`). What has to be unique is the
	 * name a reader sees for each CONVERSATION on screen, so the tally is over
	 * `session_id`s.
	 */
	const sessions = new Map<string, Set<string>>();
	for (const entry of named) {
		if (entry.label === null) continue;
		const sessionId = entry.ask.session_id;
		const key = entry.label.toLocaleLowerCase();
		const seen = sessions.get(key) ?? new Set<string>();
		if (typeof sessionId === "string" && sessionId.length > 0) {
			seen.add(sessionId);
		}
		sessions.set(key, seen);
	}
	const labels = new Map<string, string>();
	for (const entry of named) {
		if (entry.label === null) continue;
		const sessionId = entry.ask.session_id;
		/*
		 * A name is ambiguous only when TWO CONVERSATIONS share it. A row with no
		 * session id has no disambiguator to spend, so it keeps its name.
		 */
		const shared =
			(sessions.get(entry.label.toLocaleLowerCase())?.size ?? 0) > 1 &&
			typeof sessionId === "string" &&
			sessionId.length > 0;
		labels.set(
			entry.ask.ask_id,
			shared ? `${entry.label} · ${sessionId.slice(-4)}` : entry.label,
		);
	}
	return labels;
}

/**
 * The catalogue lookup the drawer hands in: one conversation's title by session
 * id, or `null`/`undefined` when the catalogue does not hold it.
 */
export type FleetAskTitleLookup = (
	sessionId: string,
) => string | null | undefined;

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
 * The panel's per-row conversation label, for a caller that has a single row and
 * no catalogue to consult.
 */
export const fleetAskRowConversation = (row: AskPresentation): string | null =>
	fleetAskConversationLabel(row.ask);
