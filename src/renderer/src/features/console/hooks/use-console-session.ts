import { useCallback, useEffect, useRef, useState } from "react";
import {
	type ConsoleSnapshot,
	EMPTY_SNAPSHOT,
	readConsoleSnapshot,
} from "../model/console-surfaces";

/**
 * The pane's read of the console, and every control it has over one.
 *
 * Design: `docs/design/ui-console-tab.md` 6.3 (the registry is app-global and a
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
	/** Ask main for a surface the USER owns, with main's own defaults (§6.1). */
	createSurface: () => void;
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
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const alive = useRef(true);

	const read = useCallback(async () => {
		const api = window.api?.console;
		if (!api) {
			// The bridge is absent only in a renderer that has no preload, which is the
			// storybook and unit-test case: the console is genuinely unavailable there,
			// and saying so is better than an empty list that claims there are none.
			setLoading(false);
			setSnapshot({ ...EMPTY_SNAPSHOT });
			setError("This window cannot reach the console.");
			return;
		}
		try {
			const state = await api.state(sessionId ?? undefined);
			if (!alive.current) return;
			setSnapshot(readConsoleSnapshot(state));
			setError(null);
		} catch (failure) {
			if (!alive.current) return;
			setError(
				failure instanceof Error ? failure.message : String(failure ?? ""),
			);
			setSnapshot({ ...EMPTY_SNAPSHOT });
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

	const createSurface = useCallback(() => {
		const api = window.api?.console;
		if (!api || sessionId === null) return;
		// Main owns the defaults (the login shell, the session's own cwd, the 100x30
		// grid, `reveal: "open"`): the pane asks for a surface and does not describe
		// one, which is what keeps a user's surface and an agent's the same object
		// (§6.1).
		void api
			.createSurface({ sessionId })
			.then(() => {
				void read();
			})
			.catch((failure: unknown) => {
				if (alive.current)
					setError(
						failure instanceof Error ? failure.message : String(failure ?? ""),
					);
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
		refresh: () => void read(),
		showSurface,
		reportContent,
		createSurface,
		setSecure,
	};
};
