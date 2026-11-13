/**
 * TYPING A SUGGESTED COMMAND INTO A FRESH TERMINAL, as one pure-ish procedure.
 *
 * The ask card's Insert / Run… actions (`features/chat/ask-command.ts`) file a
 * one-shot `consoleCommandIntent`; the console pane answers it by creating a NEW
 * surface and handing it here. This module owns the two remaining decisions:
 * WHEN to write, and WHAT to write. It takes its clock, its output signal and
 * its console API as arguments so `scripts/ask-command.test.mjs` can drive it without a pty.
 *
 * ## When: after the shell has printed, or at the cap
 *
 * A login shell takes a moment to print its first prompt, and text typed before
 * then is echoed by the tty driver ahead of the prompt and redrawn by the line
 * editor — legible, but jumpy. So the write waits for the surface's first output
 * plus a short quiet window, and is CAPPED.
 *
 * THE INVARIANT THE CAP RESTS ON: the pty buffers typeahead. A write that lands
 * before the shell reads is still delivered to it, so the cap bounds LATENCY
 * only, never correctness — a slow `.zshrc` costs at most the cap, and the
 * command still arrives intact.
 *
 * WHERE "OUTPUT" IS READ: the pane's own mirror for the new surface reports
 * every chunk it receives — the subscribe REPLAY as well as live frames
 * (`ConsoleMirror`'s `onActivity`). Main sends `console-output` only to
 * subscribed surfaces (`host.ts` `broadcast` returns at `subscribers.size ===
 * 0`) and the mirror subscribes after it mounts, so a prompt printed before
 * then is only ever in the replay; a bare `onOutput` listener here would wait
 * for a frame that never comes. The listing's `last_activity` cannot tell
 * either, because the record stamps it at creation too and a first read can
 * land after the prompt. The mirror's two channels together are the one signal
 * that sees every byte.
 *
 * MEASURED, NOT GUESSED (guide://delivery "measure before you cap"): time from
 * spawn to first output byte of an interactive shell on a pty, spawned as the
 * host spawns it (`$SHELL`, no args), n=15 each, on the lopdev Linux rig
 * (2026-11-13, `shell_ttfo.py` in the PR evidence):
 *
 *   /bin/bash 5.2.15  median 28.4 ms, max 32.5 ms; first byte to last startup
 *                     byte <= 1.0 ms (the prompt arrives in one burst)
 *   /bin/sh           median  2.5 ms, max  3.2 ms
 *   zsh               not installed on the rig; the Mac reading (where zsh is
 *                     the default shell) comes with the real-Mac capture.
 *
 * The cap is set far above that observed max (3000 ms vs 32.5 ms) because the
 * operator's interactive zsh with a framework can be two orders of magnitude
 * slower than a bare bash, and the invariant above makes a generous cap cheap:
 * it only ever delays a write that the pty would have buffered anyway. The
 * quiet window (150 ms) is larger than the measured startup burst (<= 1 ms) so a
 * prompt drawn in several chunks (a two-line prompt, an instant-prompt redraw)
 * finishes before the text lands.
 *
 * ## What: the exact command, as a paste, then optionally Enter
 *
 * The text goes through `console.input` with `paste: true`, which main wraps in
 * bracketed-paste guards only when the shell enabled that mode (`host.ts`
 * `input`). The command itself never contains a newline (the card refuses Cc
 * characters), so INSERT can never submit. RUN adds a separate
 * `console.keys(["enter"])` — the named-key encoder, never a `\r` appended to
 * the text — and is only reachable through the confirmation dialog.
 */

export const CONSOLE_COMMAND_POLL_MS = 50;
export const CONSOLE_COMMAND_QUIET_MS = 150;
export const CONSOLE_COMMAND_READY_CAP_MS = 3000;

/** The slice of `window.api.console` this procedure uses. */
export type ConsoleCommandApi = {
	input: (
		surface: string,
		text: string,
		options?: { paste?: boolean },
	) => Promise<unknown>;
	keys: (surface: string, keys: string[]) => Promise<unknown>;
};

export type ConsoleCommandClock = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const realClock: ConsoleCommandClock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Resolve once the surface has printed and gone quiet, or at the cap.
 *
 * `lastOutputAt` answers when the surface last produced output (on `clock`'s
 * scale), or `null` while it has produced none. `ready` / `capped` names which
 * bound fired, for the caller's record; both are safe to write after.
 */
export async function waitForConsoleReady(
	lastOutputAt: () => number | null,
	clock: ConsoleCommandClock = realClock,
): Promise<"ready" | "capped"> {
	const start = clock.now();
	while (clock.now() - start < CONSOLE_COMMAND_READY_CAP_MS) {
		const last = lastOutputAt();
		if (last !== null && clock.now() - last >= CONSOLE_COMMAND_QUIET_MS) {
			return "ready";
		}
		await clock.sleep(CONSOLE_COMMAND_POLL_MS);
	}
	return "capped";
}

/**
 * Type `command` into `surface` (as a paste), and press Enter only when
 * `submit` — which the card sets only after its confirmation dialog.
 */
export async function deliverConsoleCommand(
	api: ConsoleCommandApi,
	request: {
		surface: string;
		command: string;
		submit: boolean;
		lastOutputAt: () => number | null;
	},
	clock: ConsoleCommandClock = realClock,
): Promise<"ready" | "capped"> {
	const readiness = await waitForConsoleReady(request.lastOutputAt, clock);
	await api.input(request.surface, request.command, { paste: true });
	if (request.submit) await api.keys(request.surface, ["enter"]);
	return readiness;
}
