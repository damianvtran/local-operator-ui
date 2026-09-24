import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ConsoleSnapshot,
	EMPTY_SNAPSHOT,
	readConsoleSnapshot,
} from "../model/console-surfaces";

/**
 * The pane's read of the console, and every control it has over one.
 *
 * Design: `local-operator`'s
 * `docs/design/ui-console-tab.md` — that repository's file, not one in this tree. 6.3 (the registry is app-global and a
 * session's pane filters), 8.2 (the pane reports, main decides), 10.2 (the
 * renderer-facing ops), 10.3 (a signal to refetch, not a second copy of the state),
 * 12.2 (the blip's clearing rule).
 *
 * WHY THIS EXISTS AS A HOOK RATHER THAN A STORE. Exactly one component in the app
 * reads the surfaces while the pane is open: the pane. A second store would be a
 * second place for that read to go stale, and the store that DOES outlive the pane
 * is `ui-preferences-store`'s - the lens, the width and the blip marks, which are
 * the window's state rather than the console's.
 *
 * THE REFETCH IS COALESCED. Main pushes `console-state-changed` for every change it
 * makes, including a burst of them (a spawn sets a record, then resizes it, then
 * marks it displayed). Each one means "read the projection again", and a terminal
 * being typed into produces a handful in a row, so the read is scheduled on a short
 * timer instead of per signal. The window is small enough that the pane never shows
 * a state from before the signal that matters, and large enough that a burst is one
 * request.
 */
export interface ConsoleSessionApi {
	snapshot: ConsoleSnapshot;
	/** True until the first read answers, which is the pane's loading state. */
	loading: boolean;
	/** Why the last read failed, when it did. `null` while the last read worked. */
	error: string | null;
	/** Why the last CREATE failed, when it did; `null` while the last one worked or no
	 * create has been asked for.
	 *
	 * SEPARATE FROM `error` BECAUSE THE TWO ARE DIFFERENT SENTENCES AND DIFFERENT
	 * REMEDIES (design round 1, U2): a read that fails means the pane cannot see this
	 * session's surfaces at all, while a create that fails means the host is answering
	 * and refused THIS attempt — retry, not "the console is not available in this app".
	 * The first cut put both in `error`, so every refused create rendered the
	 * unavailable state with its "update the app" advice. */
	createError: string | null;
	/** Read the projection again. */
	refresh: () => void;
	/** Tell main a pane is showing this surface (it never resizes anything). */
	showSurface: (surface: string | null) => void;
	/** Report this pane's measurements for one surface (§8.2 step 1). */
	reportContent: (
		surface: string,
		report: {
			contentRect: { x: number; y: number; width: number; height: number };
			cellWidth: number;
			cellHeight: number;
			visible: boolean;
			theme: string;
		},
	) => void;
	/** Ask main for a surface the USER owns, with main's own defaults (§6.1).
	 *
	 * Resolves `true` when the answer left this conversation with a surface to show, and
	 * `false` when it did not (refused, or answered with nothing) — and that boolean is
	 * what the pane arms its caret request on, because a caret request stood up by a
	 * request that produced no terminal is a request with nowhere to land that a LATER
	 * surface would then inherit (agent review round 3, M1). It is not "did main accept
	 * the call": the listing is read inside this promise, so the answer is the listing
	 * after the create rather than the create's own reply.
	 *
	 * Returns when the request has been ANSWERED AND THE LISTING IS IN HAND, either way.
	 * The pane needs both halves of that: an open that creates a surface has to hold a
	 * state that is not the empty state until the answer lands, or a user looking at the
	 * pane sees a "No console in this session" and a `+` for the round trip it already
	 * asked for — and a second press in that window would make a second surface. The first
	 * cut awaited only the create's own answer, which left the pane holding no surface and
	 * no `creating` flag for the read that follows it (agent review round 1, F-3); the read
	 * is inside this promise so that window does not exist. The rejection is swallowed here
	 * rather than thrown: a failed create is what `createError` is for, and the pane's own
	 * create-failed state is what carries it. */
	createSurface: () => Promise<boolean>;
	/** Turn secure input on or off for one surface (§11.4). */
	setSecure: (surface: string, on: boolean) => void;
}

/** How long a burst of signals collapses into one read. */
const REFETCH_COALESCE_MS = 120;

export const useConsoleSession = (
	sessionId: string | null,
): ConsoleSessionApi => {
	const [snapshot, setSnapshot] = useState<ConsoleSnapshot>(EMPTY_SNAPSHOT);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const alive = useRef(true);

	/*
	 * The read RETURNS WHAT IT READ, not just whether it succeeded, because the create's
	 * promise needs the listing to answer with (agent review round 3, M1): "did the answer
	 * leave a surface to show" is a question about the listing, and the caller that asks it
	 * is the pane's caret request. An unmounted pane still gets an empty snapshot rather
	 * than `undefined`, so a caller cannot mistake "the pane is gone" for "there is
	 * nothing there".
	 */
	const read = useCallback(async (): Promise<ConsoleSnapshot> => {
		const api = window.api?.console;
		if (!api) {
			// The bridge is absent only in a renderer that has no preload, which is the
			// storybook and unit-test case: the console is genuinely unavailable there,
			// and saying so is better than an empty list that claims there are none.
			setLoading(false);
			setSnapshot({ ...EMPTY_SNAPSHOT });
			setError("This window cannot reach the console.");
			return { ...EMPTY_SNAPSHOT };
		}
		try {
			const state = await api.state(sessionId ?? undefined);
			if (!alive.current) return { ...EMPTY_SNAPSHOT };
			const listing = readConsoleSnapshot(state);
			setSnapshot(listing);
			setError(null);
			return listing;
		} catch (failure) {
			if (!alive.current) return { ...EMPTY_SNAPSHOT };
			setError(
				failure instanceof Error ? failure.message : String(failure ?? ""),
			);
			setSnapshot({ ...EMPTY_SNAPSHOT });
			return { ...EMPTY_SNAPSHOT };
		} finally {
			if (alive.current) setLoading(false);
		}
	}, [sessionId]);

	const schedule = useCallback(() => {
		if (timer.current) return;
		timer.current = setTimeout(() => {
			timer.current = null;
			void read();
		}, REFETCH_COALESCE_MS);
	}, [read]);

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
		};
	}, []);

	// The first read, and a re-read on every session change: the pane is scoped to
	// one session's surfaces (§6.3), so a switch is a different list.
	useEffect(() => {
		setLoading(true);
		void read();
	}, [read]);

	// Every change main makes, and nothing else: no poll, because the host already
	// knows the moment each one happens.
	useEffect(() => {
		const api = window.api?.console;
		if (!api) return;
		const off = api.onStateChanged?.(schedule);
		const offExit = api.onExit?.((payload) => {
			// An exit changes the listing (running, exit_code) as well as ending the
			// mirror's stream, so it is one more reason to re-read.
			if (payload.surface) schedule();
		});
		return () => {
			off?.();
			offExit?.();
		};
	}, [schedule]);

	const showSurface = useCallback((surface: string | null) => {
		const api = window.api?.console;
		if (!api) return;
		// Fire and forget: this is a FACT the app reports, and a failed report must
		// not stop the pane from painting the surface the user asked for.
		if (surface === null) void api.closePane().catch(() => {});
		else void api.openPane(surface).catch(() => {});
	}, []);

	const reportContent = useCallback<ConsoleSessionApi["reportContent"]>(
		(surface, report) => {
			const api = window.api?.console;
			if (!api) return;
			// The ANSWER is main's grid, and it is what the mirror applies (§8.2 step
			// 3 has no other source): this response is the pane's only way to learn a
			// grid, and ignoring it would leave the terminal at whatever size it was
			// born with.
			void api
				.setContentRect(surface, report)
				.then((state) => {
					if (alive.current) setSnapshot(readConsoleSnapshot(state));
				})
				.catch(() => {});
		},
		[],
	);

	const createSurface = useCallback((): Promise<boolean> => {
		const api = window.api?.console;
		if (!api || sessionId === null) return Promise.resolve(false);
		// Main owns the defaults (the login shell, the session's own cwd, the 100x30
		// grid, `reveal: "none"`): the pane asks for a surface and does not describe
		// one, which is what keeps a user's surface and an agent's the same object
		// (§6.1).
		//
		// The previous attempt's failure is cleared as this one starts, so the pane's
		// retry cannot paint the last attempt's reason under a state that is trying
		// again.
		setCreateError(null);
		return api
			.createSurface({ sessionId })
			.then(() =>
				// AWAITED, not fired and forgotten (agent review round 1, F-3): the create
				// has answered but the new surface is not in this pane's listing until the
				// read lands, and the pane is holding `creating` until this promise
				// resolves. A `void read()` here left one render with no surface, no
				// `creating` and no loading — the empty state with a live `+`.
				//
				// THE ANSWER IS THE LISTING, not the create's reply (round 3, M1): a call
				// main accepted but that left nothing to show is not an answer with a
				// terminal in it.
				read().then((listing) => listing.surfaces.length > 0),
			)
			.catch((failure: unknown) => {
				if (alive.current)
					setCreateError(
						failure instanceof Error ? failure.message : String(failure ?? ""),
					);
				return false;
			});
	}, [sessionId, read]);

	const setSecure = useCallback(
		(surface: string, on: boolean) => {
			const api = window.api?.console;
			if (!api) return;
			void api
				.setSecure(surface, on)
				.then(() => {
					void read();
				})
				.catch(() => {});
		},
		[read],
	);

	return {
		snapshot,
		loading,
		error,
		createError,
		refresh: () => void read(),
		showSurface,
		reportContent,
		createSurface,
		setSecure,
	};
};
