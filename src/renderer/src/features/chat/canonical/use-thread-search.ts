import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ThreadFindAnswer,
	ThreadFindHit,
} from "../../../../../shared/desktop-contract";
import { findThreadMessages } from "./thread-search-client";
import {
	type ThreadSearchState,
	threadSearchActiveHit,
	threadSearchAnswerState,
	threadSearchCursorMove,
	threadSearchWantsFollowUp,
} from "./thread-search-model";

/**
 * The in-thread search overlay's data half: a debounced ask, the state ladder
 * an answer resolves to, and the ONE follow-up a building index earns.
 *
 * ## Why the ask is driven by the box rather than by a stored "settled" query
 *
 * The request's input and the debounce's output are the same string here. A
 * settled-query state beside the box would be a second copy of the question —
 * and the copy is what drifts: the sidebar's search kept both once and gated
 * on one while sending the other (review round 7, R37). The effect below
 * re-arms its timer on every keystroke (a trailing debounce) and asks for the
 * trimmed box value; nothing else in this hook knows the query.
 *
 * ## What "ignore a stale response" means, concretely
 *
 * Two counters. `epoch` identifies the generation of the search surface —
 * bumped when it opens or closes, when the conversation changes, and when the
 * box is cleared — and `askSeq` identifies one request. An answer applies iff
 * BOTH match the values captured when it was sent: an answer to a question the
 * reader has moved on from cannot land, and an answer for a previous
 * conversation cannot land into this one. There is nothing to abort at the
 * transport (an IPC `invoke` has no cancellation), so ignoring is the whole
 * mechanism, and it is the one `loadOlder` documents for a page that resolves
 * into a transcript no longer on screen.
 *
 * ## The loading ladder
 *
 * `idle` (empty box, or closed) → `loading` (the debounce is running, or a
 * request is in flight) → `ready` / `building` / `unsupported` / `error` (the
 * wire's own state, mapped by the model). The list KEEPS the previous answer's
 * hits while the next request runs — the sidebar's `keepPreviousData`, in
 * miniature — because a list that blanks on every keystroke reads as slower
 * than it is; the answer that lands replaces it wholesale, and the cursor
 * resets to the best-ranked row because rank order is the reason row one
 * exists. An empty box is the one transition that drops the answer
 * IMMEDIATELY rather than a debounce later: results for a question the reader
 * deleted must not sit under an empty field.
 *
 * ## The building follow-up, and why it is exactly one
 *
 * A cold or stale index answers `building` inside the backend's first-paint
 * budget while a background scan runs (`sessions.find`'s own contract), so one
 * re-ask after a short delay is what turns a reader who paused into a reader
 * who sees the index's result. It is ONE per question and never a poll: the
 * scan's own ceiling is the rail's 45 s, and a find box that re-asked into
 * that would be minutes of requests the reader cannot see the point of. After
 * the follow-up the panel says the index is still catching up and offers the
 * retry as a gesture (`refresh`, wired to Enter and the Try again control) —
 * user-driven, so the floor on requests is the reader's own.
 */

/**
 * How long the box waits after the last keystroke before asking.
 *
 * Within the range the design allows (150-250 ms) and on the slow half of it
 * deliberately: a find over one conversation's index is a server-side scan
 * whose cost is paid per character typed, and the debounce exists to keep a
 * fast typist from queueing a scan per keystroke rather than to hide a cost
 * nobody sees — the backend answers a warm index in single-digit milliseconds.
 */
export const THREAD_SEARCH_DEBOUNCE_MS = 200;

/**
 * The delay before the ONE re-ask a `building` answer earns.
 *
 * Short of the index's own scan ceiling and past the first-paint budget: the
 * follow-up is for the reader who paused, so it should land after the scan has
 * plausibly moved, not beat it. It runs once and is never re-armed by its own
 * answer (see `apply`).
 */
export const THREAD_SEARCH_FOLLOW_UP_MS = 1500;

export type UseThreadSearchOptions = {
	/** The conversation to search, or `null` on a surface with no session. */
	sessionId: string | null;
	/**
	 * Whether the panel is open. Closed means idle: no request, no timer, and
	 * nothing kept from the last time it was open — the box starts empty on
	 * every open, so a reader never re-spends a search they did not ask for.
	 */
	enabled: boolean;
};

export type UseThreadSearchResult = {
	query: string;
	setQuery: (next: string) => void;
	state: ThreadSearchState;
	hits: ThreadFindHit[];
	/** The hit list was cut at the request's limit. */
	truncated: boolean;
	/** The hits came from a previous scan while the index catches up. */
	partial: boolean;
	/** Index into `hits`; `-1` when there is nothing to point at. */
	cursor: number;
	moveCursor: (delta: -1 | 1) => void;
	/** The hit the cursor names, or `null`. */
	activeHit: ThreadFindHit | null;
	/** Re-ask the box's current value now (Enter while idle, Try again). */
	refresh: () => void;
};

export function useThreadSearch({
	sessionId,
	enabled,
}: UseThreadSearchOptions): UseThreadSearchResult {
	const [query, setQuery] = useState("");
	const [state, setState] = useState<ThreadSearchState>("idle");
	const [hits, setHits] = useState<ThreadFindHit[]>([]);
	const [truncated, setTruncated] = useState(false);
	const [partial, setPartial] = useState(false);
	const [cursor, setCursor] = useState(-1);

	/**
	 * The search surface's generation: bumped whenever the answer to "what is
	 * this box searching" changes (open/close, conversation, a cleared box).
	 * Anything captured under an older generation is not this surface's to
	 * apply.
	 */
	const epoch = useRef(0);
	/** The request counter: only the newest ask's answer may land. */
	const askSeq = useRef(0);
	/** How many rows the cursor arithmetic may point at. */
	const hitCount = useRef(0);
	/** The generation string the current refs were configured for. */
	const generation = useRef("");
	/** The query the armed follow-up belongs to; one follow-up per question. */
	const followUpFor = useRef<string | null>(null);
	const followUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/** Warn lines this generation has already printed, keyed by sentence. */
	const logged = useRef(new Set<string>());

	const sessionRef = useRef(sessionId);
	sessionRef.current = sessionId;

	const cancelFollowUp = useCallback(() => {
		if (followUpTimer.current !== null) {
			clearTimeout(followUpTimer.current);
			followUpTimer.current = null;
		}
	}, []);

	const logOnce = useCallback((message: string, error: unknown) => {
		if (logged.current.has(message)) return;
		logged.current.add(message);
		console.warn(message, error);
	}, []);

	/** Forget the answer and everything armed for it. */
	const dropAnswer = useCallback(() => {
		epoch.current += 1;
		cancelFollowUp();
		followUpFor.current = null;
		hitCount.current = 0;
		setState("idle");
		setHits((current) => (current.length === 0 ? current : []));
		setTruncated(false);
		setPartial(false);
		setCursor(-1);
	}, [cancelFollowUp]);

	/*
	 * The ask and the follow-up are mutually recursive (a building answer arms
	 * the timer that calls the ask), so they live behind a ref: neither can name
	 * the other in a dependency array, and the assignment below keeps it current
	 * every render — `use-checkpoints.ts` documents the same shape for its
	 * load/poll pair.
	 */
	const askRef = useRef<
		(askedQuery: string, mode: "fresh" | "follow-up") => void
	>(() => {});

	const apply = useCallback(
		(askedQuery: string, answer: ThreadFindAnswer) => {
			const next = threadSearchAnswerState(answer.state);
			setState(next);
			/*
			 * `building` may carry the previous scan's hits (`partial`): they are
			 * real messages that matched, so they render; `unsupported` and `error`
			 * carry none by contract, and a stray one is dropped rather than shown
			 * under a state that says the search did not happen.
			 */
			const keepHits = next === "ready" || next === "building";
			const list = keepHits ? answer.hits : [];
			hitCount.current = list.length;
			setHits(list);
			setTruncated(keepHits && answer.truncated);
			setPartial(next === "building" && answer.partial);
			// Rank order is the reason row one exists: each answer re-points the
			// cursor at the best-ranked row rather than carrying an index across
			// two different rankings.
			setCursor(list.length > 0 ? 0 : -1);
			if (next === "building" && threadSearchWantsFollowUp(answer)) {
				/*
				 * ONE follow-up per question: the timer is armed only when this
				 * question has not spent one, so its own answer (building again)
				 * falls through here without re-arming. A fresh ask of the same
				 * text — a retry — resets the latch, because that is the reader
				 * asking again rather than this hook asking itself.
				 */
				if (followUpFor.current !== askedQuery) {
					followUpFor.current = askedQuery;
					const epochNow = epoch.current;
					followUpTimer.current = setTimeout(() => {
						followUpTimer.current = null;
						if (epoch.current !== epochNow) return;
						askRef.current(askedQuery, "follow-up");
					}, THREAD_SEARCH_FOLLOW_UP_MS);
				}
			} else {
				cancelFollowUp();
			}
		},
		[cancelFollowUp],
	);

	const ask = useCallback(
		(askedQuery: string, mode: "fresh" | "follow-up") => {
			const session = sessionRef.current;
			if (!session) return;
			const epochNow = epoch.current;
			const seq = ++askSeq.current;
			if (mode === "fresh") {
				// A fresh ask resets the one-follow-up latch: the reader asked.
				cancelFollowUp();
				followUpFor.current = null;
				setState("loading");
			}
			void findThreadMessages({ sessionId: session, query: askedQuery })
				.then((answer) => {
					if (seq !== askSeq.current || epoch.current !== epochNow) return;
					apply(askedQuery, answer);
				})
				.catch((error) => {
					if (seq !== askSeq.current || epoch.current !== epochNow) return;
					/*
					 * The panel states this failure itself (it is a rendered state,
					 * unlike the rail's silent degradation), and the warn is for the
					 * console log once per generation: without the latch a follow-up
					 * and a retry would each repeat the same sentence.
					 */
					logOnce("thread search could not be answered:", error);
					cancelFollowUp();
					followUpFor.current = null;
					hitCount.current = 0;
					// The list goes with the answer: rows that matched a question the
					// error is not about would read as results for it.
					setHits([]);
					setTruncated(false);
					setPartial(false);
					setCursor(-1);
					setState("error");
				});
		},
		[apply, cancelFollowUp, logOnce],
	);
	askRef.current = ask;

	/*
	 * The one effect the box is wired through: it re-arms the debounce on every
	 * keystroke, drops the answer when the box empties, and re-bases everything
	 * when the surface's generation changes (open/close, conversation switch).
	 */
	useEffect(() => {
		const next = `${enabled ? "1" : "0"}:${sessionId ?? ""}`;
		if (generation.current !== next) {
			generation.current = next;
			logged.current = new Set();
			dropAnswer();
			// A question must not cross into another conversation, and a closed
			// panel must not leave one behind: the box starts empty either way.
			setQuery((current) => (current === "" ? current : ""));
			if (!enabled || !sessionId) return;
		}
		if (!enabled || !sessionId) {
			// Sitting closed: nothing armed, nothing kept.
			dropAnswer();
			return;
		}
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			dropAnswer();
			return;
		}
		const epochNow = epoch.current;
		const timer = setTimeout(() => {
			if (epoch.current !== epochNow) return;
			askRef.current(trimmed, "fresh");
		}, THREAD_SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, enabled, sessionId, dropAnswer]);

	// A timer outliving the surface would ask into nothing.
	useEffect(() => () => cancelFollowUp(), [cancelFollowUp]);

	const moveCursor = useCallback((delta: -1 | 1) => {
		setCursor((current) =>
			threadSearchCursorMove(current, delta, hitCount.current),
		);
	}, []);

	const refresh = useCallback(() => {
		const trimmed = query.trim();
		if (!enabled || !sessionId || trimmed.length === 0) return;
		askRef.current(trimmed, "fresh");
	}, [enabled, sessionId, query]);

	return {
		query,
		setQuery,
		state,
		hits,
		truncated,
		partial,
		cursor,
		moveCursor,
		activeHit: threadSearchActiveHit(hits, cursor),
		refresh,
	};
}
