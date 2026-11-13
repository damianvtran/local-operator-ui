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
 *   zsh 5.9           median 429.8 ms, max 791.2 ms — the operator's Mac, the
 *                     default login shell there, same pty.fork method (lopdev
 *                     manager session 79bddc262663, 2026-11-13)
 *
 * The cap is set well above the slowest observed max (3000 ms vs zsh's
 * 791.2 ms, about 3.8x) because an interactive zsh with a heavier framework
 * can be slower still, and the invariant above makes a generous cap cheap:
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

/**
 * HOW LONG A PRESS WAITS TO BE PICKED UP before the pane refuses it
 * (`ConsolePane`'s command effect; QA round 1 Q1, agent review round 1 m2).
 *
 * The bound is on PICKUP — press to the pane taking the intent — not on the
 * shell: the create and the readiness wait above both start after pickup, so
 * a slow zsh (791.2 ms max on the operator's Mac) never eats into it. It is
 * still set above that zsh max plus the measured pickup, so even a reading
 * that wrongly counted shell startup would land inside it.
 *
 * MEASURED (lopdev Linux rig, built app, Xvfb, 2026-11-13; press to the new
 * surface LISTED by main, which is an upper bound on pickup because pickup
 * happens before the create call):
 *
 *   in-conversation Open in terminal  n=10  median  62.3 ms  max  99.6 ms
 *   fleet press, cold pane in another
 *   conversation (open, load, pick up) n=5   median  74.0 ms  max  76.4 ms
 *
 * 5000 ms sits about 50x above that max and about 5.6x above zsh's max plus it
 * (791.2 + 99.6 = 890.8 ms). It errs long on purpose: a press dropped by this
 * bound opens an empty terminal with nothing typed, which is the worse failure
 * for a legitimate press, while a confirm made stale by LEAVING is already
 * dropped at once by the leave rule (`dropConsoleCommandOnLeave`) and a closed
 * ask is refused by the pickup guard regardless of age.
 */
export const CONSOLE_COMMAND_PICKUP_TTL_MS = 5000;

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
