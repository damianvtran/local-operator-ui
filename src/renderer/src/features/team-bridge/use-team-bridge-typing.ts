import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { useEffect, useRef, useState } from "react";
import {
	TYPING_BACKOFF_MS,
	TYPING_DEFAULT_POLL_MS,
	type TypingEntry,
	boundedInterval,
	nextTypingExpiry,
	transientTypingBackoffMs,
	typingEntries,
	typingRetryAfterMs,
} from "./team-bridge-typing-model";

export type TypingReaderApi = Pick<typeof TeamBridgeApi, "typing">;

/**
 * Is this window one a person is looking at AND working in?
 *
 * Stricter than the history poll on purpose (design §6): a window left
 * visible on a second monitor still gets messages at 8 s, but it is the
 * cheapest place to cut the 3 s typing read's load. Focus and visibility are
 * both events, so no timer is needed to notice either.
 */
const windowIsActive = () =>
	typeof document !== "undefined" &&
	document.visibilityState === "visible" &&
	document.hasFocus();

export function useWindowActive(): boolean {
	const [active, setActive] = useState(windowIsActive);
	useEffect(() => {
		const update = () => setActive(windowIsActive());
		window.addEventListener("focus", update);
		window.addEventListener("blur", update);
		document.addEventListener("visibilitychange", update);
		update();
		return () => {
			window.removeEventListener("focus", update);
			window.removeEventListener("blur", update);
			document.removeEventListener("visibilitychange", update);
		};
	}, []);
	return active;
}

/**
 * The hub predates the typing route (`outdated_hub`): no further read this
 * renderer session. Module state because it describes the paired backend.
 */
let readerOutdated = false;
/** `Date.now()` before which no read leaves, after a 429/503/flag-off answer. */
let readerBackoffUntil = 0;

/** Test seam: forget the session-wide refusals between cases. */
export function resetTypingReaderSessionForTests() {
	readerOutdated = false;
	readerBackoffUntil = 0;
}

export type TypingReaderOptions = {
	conversationId: string | null;
	tenantId: string | null;
	/**
	 * The conversation is open in this pane. With `false` (capability off, no
	 * selection, a preview, a new-DM draft) no request is made at all.
	 */
	enabled: boolean;
	/**
	 * The room's `message_seq` moved past the last one this reader saw: a new
	 * message exists. The host refetches history (and the open thread) NOW, so a
	 * typer's line clearing is followed by their message within one typing tick
	 * instead of up to the 8 s history poll (design §3, "One addition").
	 */
	onMessageSeqAdvance?: (seq: number) => void;
	api?: TypingReaderApi;
	/** Test seam for the focus/visibility gate. */
	windowActive?: boolean;
};

export type TypingReaderState = {
	entries: readonly TypingEntry[];
	/** The clock the entries were last filtered against; moves at each expiry. */
	now: number;
};

const EMPTY: readonly TypingEntry[] = [];

/**
 * The reader half of typing indicators (design §6, "Reader hook").
 *
 * A self-scheduling `setTimeout` loop rather than react-query's
 * `refetchInterval`: the back-off rules (server `poll_after_ms`, a 429's
 * `retry_after_ms`, `outdated_hub` for the session) have to survive a focus
 * change, and react-query refetches on mount/focus regardless of an interval -
 * which would turn every alt-tab during a 429 into another refused read. Here
 * the next read is scheduled only from the previous answer.
 *
 * One read serves both panes: entries carry `threadRootId` and each line
 * filters to its own scope. Each entry is kept until `fetchedAt +
 * expires_in_ms`, so a failed or slow poll can never freeze an indicator on
 * screen; a timer re-renders at the next deadline.
 */
export function useTeamBridgeTyping({
	conversationId,
	tenantId,
	enabled,
	onMessageSeqAdvance,
	api = TeamBridgeApi,
	windowActive,
}: TypingReaderOptions): TypingReaderState {
	const focused = useWindowActive();
	const active = windowActive ?? focused;
	/*
	 * Entries are held WITH the conversation they were read for, and only a match
	 * is returned: on a switch the old room's typers vanish on the very render
	 * that shows the new room, not one poll later (agent review round 1, R2).
	 */
	const key =
		conversationId && tenantId ? `${tenantId}\u0000${conversationId}` : "";
	const [held, setHeld] = useState<{
		key: string;
		entries: readonly TypingEntry[];
	}>({ key: "", entries: EMPTY });
	const entries = held.key === key ? held.entries : EMPTY;
	const [now, setNow] = useState(() => Date.now());
	const apiRef = useRef(api);
	apiRef.current = api;
	const advanceRef = useRef(onMessageSeqAdvance);
	advanceRef.current = onMessageSeqAdvance;
	/** The newest `message_seq` seen for the current conversation; reset on switch. */
	const seqRef = useRef<{ key: string; seq: number } | null>(null);
	/*
	 * The read cadence for the current conversation, kept across effect re-runs:
	 * a refocus re-runs the effect, and without this every alt-tab sent a GET at
	 * once, ignoring `poll_after_ms` and inviting a 429 (agent review round 1,
	 * R5). `nextAt` is when the next read is due; `failures` counts consecutive
	 * transient failures for the back-off (QA round 1, N1).
	 */
	const cadenceRef = useRef({
		key: "",
		nextAt: 0,
		pollMs: TYPING_DEFAULT_POLL_MS,
		failures: 0,
	});

	const running =
		enabled && active && Boolean(conversationId) && Boolean(tenantId);

	useEffect(() => {
		if (!running || !conversationId || !tenantId) {
			// Not looking: nothing shown, so a stale line never greets a returning eye.
			setHeld({ key: "", entries: EMPTY });
			return;
		}
		const key = `${tenantId}\u0000${conversationId}`;
		const setEntries = (entries: readonly TypingEntry[]) =>
			setHeld({ key, entries });
		if (seqRef.current?.key !== key) seqRef.current = null;
		const cadence = cadenceRef.current;
		if (cadence.key !== key) {
			// Another room is a fresh cadence: read it at once.
			cadence.key = key;
			cadence.nextAt = 0;
			cadence.pollMs = TYPING_DEFAULT_POLL_MS;
			cadence.failures = 0;
		}
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const schedule = (delay: number) => {
			if (cancelled) return;
			cadence.nextAt = Date.now() + Math.max(0, delay);
			timer = setTimeout(run, Math.max(0, delay));
		};
		const run = async () => {
			timer = null;
			if (readerOutdated) return;
			const wait = readerBackoffUntil - Date.now();
			if (wait > 0) {
				schedule(wait);
				return;
			}
			try {
				const answer = await apiRef.current.typing(conversationId, tenantId);
				if (cancelled) return;
				const fetchedAt = Date.now();
				const poll = boundedInterval(
					answer.poll_after_ms,
					TYPING_DEFAULT_POLL_MS,
				);
				cadence.pollMs = poll;
				cadence.failures = 0;
				if (!answer.enabled) {
					// The hub's typing flag is off: hide, and come back at its pace.
					setEntries(EMPTY);
					readerBackoffUntil = fetchedAt + poll;
					schedule(poll);
					return;
				}
				setEntries(typingEntries(answer.typers, fetchedAt));
				setNow(fetchedAt);
				const seq = answer.message_seq;
				if (seq !== undefined) {
					const held = seqRef.current;
					if (held && held.key === key && seq > held.seq)
						advanceRef.current?.(seq);
					if (!held || held.key !== key || seq > held.seq)
						seqRef.current = { key, seq };
				}
				schedule(poll);
			} catch (cause) {
				if (cancelled) return;
				setEntries(EMPTY);
				const error = cause as {
					code?: string;
					status?: number | null;
				};
				if (error?.code === "outdated_hub") {
					// Never again this session: the backend's hub has no typing route.
					readerOutdated = true;
					return;
				}
				let backoff: number;
				if (error?.status === 429) {
					backoff = boundedInterval(
						typingRetryAfterMs(cause),
						TYPING_BACKOFF_MS,
					);
				} else if (error?.status === 503) {
					// A dark hub said "not now" on purpose: the full minute.
					backoff = TYPING_BACKOFF_MS;
				} else {
					// A blip (502, dropped connection): retry at the poll pace, doubling.
					cadence.failures += 1;
					backoff = transientTypingBackoffMs(cadence.failures, cadence.pollMs);
				}
				readerBackoffUntil = Date.now() + backoff;
				schedule(backoff);
			}
		};
		// A refocus inside the interval waits out its remainder (R5).
		const due = cadence.nextAt - Date.now();
		if (due > 0) schedule(due);
		else void run();
		return () => {
			cancelled = true;
			if (timer !== null) clearTimeout(timer);
		};
	}, [running, conversationId, tenantId]);

	// Expire entries locally at their own deadlines, between polls.
	useEffect(() => {
		const next = nextTypingExpiry(entries, now);
		if (next === null) return;
		const timer = setTimeout(() => setNow(Date.now()), next - now);
		return () => clearTimeout(timer);
	}, [entries, now]);

	return { entries, now };
}
