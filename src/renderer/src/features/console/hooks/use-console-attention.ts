import {
	CONSOLE_BLIP_PULSE_MS,
	type ConsoleUnseenMark,
	consoleBlipPulsing,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { useEffect, useRef, useState } from "react";
import {
	type ConsoleSurface,
	readConsoleSnapshot,
} from "../model/console-surfaces";

/**
 * The blip: a surface finished something while the user was not looking at it.
 *
 * Design: `docs/design/ui-console-tab.md` 12.1 (the ladder: a process exit, and an
 * OSC 133 command mark), 12.2 (what the mark is, when it clears, and why it
 * survives a switch and a relaunch), 12.4 ("`console-state` exposes the attention
 * mark as data, so an e2e cell asserts the blip while notifications are off").
 *
 * WHY THIS IS AT THE APP'S ROOT AND NOT IN THE PANE. A completion that arrives
 * while the pane is closed is the whole point of R14, and the pane is unmounted
 * then. So the watcher lives where the window lives, reads the projection main
 * publishes, and writes ONE thing: the marks the header and the pane's rows paint.
 *
 * WHY IT READS A LISTING RATHER THAN SUBSCRIBING TO EVENTS. Main's push says "the
 * state changed"; the state IS the projection, and the two facts a completion is
 * made of are both in it — `running`/`exit_code` for a process exit, and
 * `last_mark` for a command the shell marked. A second event channel carrying the
 * same facts in a different shape is the drift this avoids; the push carries no
 * payload for exactly that reason.
 *
 * THE DIFF IS WHAT MAKES IT A COMPLETION, and the fields chosen for the
 * comparison matter. `last_activity` moves on every byte the program prints, so it
 * cannot be the signal — treating it as one would light the blip on every line of
 * a build log. What counts is a transition to not-running, or a NEW `D` mark (the
 * shell's "a command finished, with this status"): the two rungs of the design's
 * ladder, and nothing else.
 *
 * THE FIRST SIGHTING IS NOT A COMPLETION. The watcher seeds its table from the
 * first read, so a surface this app has just learned about — including every
 * surface restored from history at launch, which ended before this process
 * existed — starts unmarked. A blip is news, and the app has no claim on news it
 * was not there for.
 */
export const useConsoleAttention = (): void => {
	const mark = useUiPreferencesStore((state) => state.markConsoleUnseen);
	/** The last completion-relevant reading per surface. A ref rather than state:
	 * nothing renders from it, and a re-render per read would be the whole app
	 * committing on every console event. */
	const readings = useRef<Map<string, Reading>>(new Map());
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const api = window.api?.console;
		if (!api) return;
		let alive = true;

		const read = async () => {
			let state: unknown;
			try {
				state = await api.state();
			} catch {
				// No console in this run (the kill switch, or node-pty missing): there is
				// nothing to watch, and the pane is where that is said.
				return;
			}
			if (!alive) return;
			const snapshot = readConsoleSnapshot(state);
			const seen = readings.current;
			const present = new Set<string>();
			for (const surface of snapshot.surfaces) {
				present.add(surface.surface);
				const previous = seen.get(surface.surface);
				const next: Reading = {
					running: surface.running,
					exitCode: surface.exitCode,
					mark: markKey(surface),
				};
				seen.set(surface.surface, next);
				if (!previous) continue;
				if (!completed(previous, next)) continue;
				// The clearing rule, applied at the moment of the completion rather than
				// later: if the pane is displayed on THIS surface and the window is
				// focused, the user is looking at it and there is nothing to mark (§12.2).
				const preferences = useUiPreferencesStore.getState();
				const looking =
					preferences.isConsolePaneOpen &&
					preferences.consoleActiveSurface === surface.surface &&
					typeof document !== "undefined" &&
					document.hasFocus();
				if (!looking) mark(surface.sessionId, surface.surface);
			}
			// A surface that is gone cannot carry an uncleared mark for ever: the
			// entry is dropped here and its blip with it. The MARK is left to the
			// store's own clearing, because a surface can be closed while its
			// completion is still unread, and the conversation's header is the only
			// thing that could have cleared it.
			for (const surface of [...seen.keys()])
				if (!present.has(surface)) seen.delete(surface);
		};

		/** Coalesced, like the pane's own refetch: a spawn makes several changes in a
		 * row, and each one means "read the projection again". */
		const schedule = () => {
			if (timer.current) return;
			timer.current = setTimeout(() => {
				timer.current = null;
				void read();
			}, 120);
		};

		const offState = api.onStateChanged?.(schedule);
		const offExit = api.onExit?.(() => schedule());
		// One read at mount: seeding the table is what stops a restored surface's
		// long-finished history from arriving as news.
		void read();

		return () => {
			alive = false;
			offState?.();
			offExit?.();
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
		};
	}, [mark]);
};

/** The completion-relevant reading of one surface. */
interface Reading {
	running: boolean;
	exitCode: number | null;
	/** The shell's own last completion mark, as an identity rather than as a value:
	 * two commands with the same exit status are two marks, distinguished by the
	 * byte offset the host records them at. */
	mark: string;
}

const markKey = (surface: ConsoleSurface): string => {
	const last = surface.lastMark;
	if (!last) return "";
	return `${last.kind ?? ""}:${last.offset ?? ""}`;
};

/**
 * Whether a set of blip marks is still fresh enough to pulse.
 *
 * A HOOK RATHER THAN A CALL TO `consoleBlipPulsing`, because the answer changes
 * with the clock and nothing else re-renders when it does: a mark is painted as a
 * pulse in the accent and has to SETTLE into the resting dot on its own (§12.2's
 * two states), or a user who leaves the window open watches a completion pulse
 * until the next unrelated commit. The timeout is armed for the moment the newest
 * mark ages out, which is the only instant the answer can change.
 */
export const useConsoleBlipPulse = (
	marks: readonly ConsoleUnseenMark[],
): boolean => {
	const [pulsing, setPulsing] = useState(() => consoleBlipPulsing(marks));
	useEffect(() => {
		const now = Date.now();
		setPulsing(consoleBlipPulsing(marks, now));
		const newest = marks.reduce((latest, mark) => Math.max(latest, mark.at), 0);
		if (newest === 0) return;
		const remaining = newest + CONSOLE_BLIP_PULSE_MS - now;
		if (remaining <= 0) return;
		const timer = setTimeout(() => setPulsing(false), remaining);
		return () => clearTimeout(timer);
	}, [marks]);
	return pulsing;
};

/** Whether the step from one reading to the next is a completion. */
const completed = (previous: Reading, next: Reading): boolean => {
	if (previous.running && !next.running) return true;
	return next.mark !== "" && next.mark !== previous.mark;
};
