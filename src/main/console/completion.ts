import type { ConsoleHost, ConsoleHostOptions, SurfaceRuntime } from "./host";
import type { Osc133Mark } from "./osc133";
import type { ConsoleRegistry } from "./registry";

/**
 * The completion seam: what the console tells the app when something finishes,
 * and what the app does about it.
 *
 * Design: `docs/design/ui-console-tab.md` 12.1 (the completion ladder), 12.2 (the
 * blip), 12.3 (the banner, the click and the claim), 12.4 (the one kill switch).
 *
 * THREE CONSUMERS, ONE HOP. The renderer needs to know its view of the surfaces is
 * stale (the data plane is byte frames; this is the control plane's "refetch"), and
 * the app needs to raise a banner when nobody is looking at the surface. Both are
 * driven from the host's own callbacks rather than from a poll, because the host
 * already knows the moment each one happens.
 *
 * WHY THE RENDERER IS TOLD TO REFETCH RATHER THAN SENT THE STATE. `console-state`
 * is the projection (§10.2), it is already implementable in one place, and a second
 * push carrying half of it would be a second thing to keep in step with the first.
 * The declared-and-unused `console-state-changed` channel in `./ipc.ts` is exactly
 * this signal, so this module is what makes that declaration true rather than
 * adding a channel beside it.
 *
 * WHO DECIDES ABOUT THE BANNER. The host knows whether a pane is displaying the
 * surface (`displayed_surface`), and the notifier knows whether the window is
 * focused and how this run is allowed to present itself; neither can answer the
 * other's half, so the completion carries the host's half as data and the notifier
 * applies its own gate (§12.3's ladder). Nothing here decides to raise a window:
 * the only module allowed to do that is `window-raise.ts`, reached by the
 * notifier's own click path.
 */

/** The state-change signal, pinned to the namespace that declares it so a rename
 * in `./ipc.ts` breaks this build instead of silently pushing to nobody. */
/** One completion, as the notifier needs it. Declared here rather than imported
 * from the notifier so this module never has to know how a banner is raised. */
export interface ConsoleCompletionNotice {
	sessionId: string;
	surface: string;
	/** The surface's command, which is how the pane names it too (§6.5). */
	surfaceName: string;
	/** The process's exit code, or null for a command mark with no status. */
	exitCode: number | null;
	/** Whether main believes a pane is showing THIS surface (the host's own
	 * `displayed_surface`, never the renderer's opinion of itself). */
	displayed: boolean;
	/** This completion's one-shot key: the notifier claims it before delivering, so
	 * one completion banners once (§12.3). */
	key: string;
}

/** What this module needs from the notifier: one method, so a test or a rig can
 * hand it a recorder and assert the ladder without an Electron notification. */
export interface ConsoleCompletionNotifier {
	consoleCompletion(notice: ConsoleCompletionNotice): void;
}

export interface ConsoleCompletionDeps {
	/** The host, lazily: the callbacks are handed to the host's own constructor. */
	host: () => ConsoleHost | null;
	/** The registry, for the surface's command and session when a mark or an exit
	 * arrives. Read-only: nothing here creates, resizes or closes anything. */
	registry: ConsoleRegistry<SurfaceRuntime>;
	/** The app's notifier, or a getter for it: it is built before the host is. */
	notifier: () => ConsoleCompletionNotifier | null;
	log: (message: string) => void;
	now?: () => number;
}

/** How long after a command's own banner a process exit is the SAME completion
 * rather than a second one. See `exited` below for what this bounds. */
const SAME_COMPLETION_MS = 3_000;

/**
 * The host's completion callbacks.
 *
 * Returns them rather than registering anything itself, because they are passed as
 * the host's own options — the seam `./host.ts` declares.
 */
export function consoleCompletionHooks(
	deps: ConsoleCompletionDeps,
): Pick<ConsoleHostOptions, "onMark" | "onExit"> {
	const now = deps.now ?? (() => Date.now());
	/** Per-surface exits seen by THIS process, for the one case the host's own
	 * generation is not readable: see `exitKey`. */
	const exits = new Map<string, number>();

	/**
	 * The exit GENERATION, which is the design's own `exit_epoch` (§7.3) and now the
	 * host's: the retention layer bumps it through the sidecar's arithmetic, the
	 * host's listing projects it, and it survives a relaunch — which is what makes it
	 * the right key rather than a number this module counts for itself.
	 *
	 * It is read from the listing at the moment of the exit, and the ordering is what
	 * makes that correct: the host bumps the epoch BEFORE it calls the exit seams, so
	 * the value read here is this exit's own generation (`host.ts`, the exit path's
	 * own comment says the notifier dedupes on `(surface, exit_epoch)`).
	 *
	 * A COUNTER REMAINS AS THE FALLBACK, because this seam is also driven directly by
	 * tests and rigs with a host that answers no listing; `null` means "nobody could
	 * tell me", and the counter is then the honest answer rather than the epoch of
	 * some other surface.
	 */
	const exitKey = (surface: string): string => {
		const listing = deps.host()?.state() as
			| { surfaces?: Array<{ surface?: unknown; exit_epoch?: unknown }> }
			| undefined;
		const row = listing?.surfaces?.find((entry) => entry.surface === surface);
		const epoch =
			typeof row?.exit_epoch === "number" ? row.exit_epoch : undefined;
		const count = epoch ?? (exits.get(surface) ?? 0) + 1;
		exits.set(surface, count);
		return `console:exit:${surface}:${count}`;
	};
	/** The last banner per surface, and WHICH RUNG raised it, for the
	 * same-completion rule below: a mark followed by its own process's exit is one
	 * event, while two exits are two. */
	const lastBanner = new Map<string, { at: number; kind: "mark" | "exit" }>();

	const announce = (
		notice: ConsoleCompletionNotice,
		kind: "mark" | "exit",
	): void => {
		const notifier = deps.notifier();
		if (!notifier) return;
		lastBanner.set(notice.surface, { at: now(), kind });
		notifier.consoleCompletion(notice);
	};

	/** One surface's listing, for the fields a banner names. `find` rather than
	 * `require`: a mark or an exit can arrive after the surface is gone. */
	const describe = (surface: string) => {
		const entry = deps.registry.find(surface);
		if (!entry) return null;
		return {
			sessionId: entry.record.sessionId,
			command: entry.record.command.trim() || surface,
		};
	};

	/** Whether a pane is displaying this surface, by the host's own record. */
	const displayed = (surface: string): boolean => {
		const state = deps.host()?.state() as
			| { displayed_surface?: unknown }
			| undefined;
		return state?.displayed_surface === surface;
	};

	const completionFor = (
		surface: string,
		exitCode: number | null,
		key: string,
	): ConsoleCompletionNotice | null => {
		const described = describe(surface);
		if (!described) return null;
		return {
			sessionId: described.sessionId,
			surface,
			surfaceName: described.command,
			exitCode,
			displayed: displayed(surface),
			key,
		};
	};

	return {
		/*
		 * RUNG 2 OF THE LADDER (§12.1): a command finished inside a persistent shell,
		 * carried by the shell's own OSC 133 `D` mark.
		 *
		 * THE MARK IS ALSO WHAT THE BLIP RIDES, and the two are one signal rather
		 * than two: the renderer learns about it by refetching the listing the host
		 * has already updated (`last_mark`), and the banner is raised here only when
		 * the user is not looking at the surface at all. The blip is deliberately NOT
		 * computed here — a mark that the pane cleared when the user looked at it must
		 * not be re-marked by a later fetch, and only the renderer knows when the
		 * user was looking.
		 *
		 * WHAT THIS RUNG CANNOT SEE is named in the design and repeated so it is not
		 * mistaken for a bug: it needs the shell to emit prompt marks (the app ships a
		 * snippet the user may source, and never writes to their dotfiles), the parse
		 * is a byte scan rather than an emulator feature, and a program can spoof the
		 * sequence — whose worst case is one spurious banner.
		 */
		onMark: (surface: string, mark: Osc133Mark) => {
			// `command-finished` is the shell's own "a command finished, with this
			// status" (`ESC ] 133 ; D ; <status> ST`); the other three marks are its
			// prompt and its command boundaries and mean nothing on their own.
			if (mark.kind !== "command-finished") return;
			const notice = completionFor(
				surface,
				mark.exitCode,
				// The mark's own offset in the log is what makes two marks
				// distinguishable: a shell that runs the same command twice emits two
				// `D` marks with the same status, at two offsets.
				`console:mark:${surface}:${mark.offset}`,
			);
			if (notice) announce(notice, "mark");
		},

		/*
		 * RUNG 1: the surface's process exited — the one signal that is always
		 * available, exactly once per surface, carrying the exit code (§12.1).
		 *
		 * THE KEY IS `(surface, exit_epoch)`, the design's own pair, read from the
		 * host's listing (see `exitKey`). It is what the host's own comment expects the
		 * notifier to dedupe on, it survives a relaunch because the retention layer
		 * persists it, and it is what makes two exits two completions even with the
		 * same code.
		 *
		 * A MARK-AND-THEN-EXIT IS ONE COMPLETION. A shell that exits from a prompt
		 * emits its `D` mark and then the process exit, and both are the same thing
		 * happening once; a second banner for it would be the "notify twice" the
		 * claim discipline exists to prevent. The window is small and named rather
		 * than a guess about content.
		 */
		onExit: ({
			surface,
			exitCode,
		}: {
			surface: string;
			exitCode: number;
		}) => {
			const key = exitKey(surface);
			const previous = lastBanner.get(surface);
			// Only a MARK suppresses an exit, and only its own surface's: those two
			// are one shell action seen twice. Two exits are two events, however close
			// together, and the design's own claim is one banner per completion.
			if (
				previous !== undefined &&
				previous.kind === "mark" &&
				now() - previous.at < SAME_COMPLETION_MS
			) {
				deps.log(
					`[console] surface ${surface} exited ${exitCode} right after its own completion mark; one banner, not two`,
				);
				return;
			}
			const notice = completionFor(surface, exitCode, key);
			if (notice) announce(notice, "exit");
		},
	};
}
