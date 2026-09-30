/**
 * @file auth-operation.ts
 * @description
 * The one implementation of "poll a backend auth operation until it settles",
 * shared by every surface that starts a sign-in.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED. A sign-in is a backend operation with
 * a browser leg the user completes outside this app, so every surface that
 * starts one — the provider detail panel, and the session issue's Radient
 * re-authentication — needs the same three things: the terminal-state set, the
 * poll cadence, and the rule that a poll that FAILS is not a login that failed.
 * A second copy is how two surfaces come to disagree about when to stop asking
 * and about what a lost poll means, with the one nobody was looking at being
 * the wrong one. `provider-detail.tsx` used to carry this privately, which is
 * why it reads as a move rather than a new idiom.
 */

import { DesktopControlError, desktopResult } from "./desktop-api";
import type { AuthOperation } from "./desktop-api";

/**
 * Optional behaviour for {@link pollAuthOperation}.
 *
 * `onGone` is the one failure a retry cannot repair: the backend answered 404,
 * which means it no longer holds this operation at all (it restarted, or the
 * operation aged out of its bounded table). Polling it again asks a question
 * with a fixed answer forever, and the surface above it sits on "waiting" for a
 * flow nobody is running any more. A caller that passes `onGone` gets the poll
 * STOPPED and is told once; a caller that does not keeps the historical
 * keep-asking behaviour, so the Radient session issue is unchanged by this.
 *
 * `read` exists for tests: it replaces the desktop op so the poll's rules can
 * be exercised in Node without the IPC bridge.
 */
export type PollAuthOperationOptions = {
	onGone?: () => void;
	read?: (id: string) => Promise<AuthOperation>;
};

/**
 * How often an unsettled operation is re-read.
 *
 * Deliberately not a React Query interval: this poll belongs to a flow the
 * BACKEND is running (it owns PKCE, the state nonce and the loopback callback
 * port), and it stops the moment the operation reports a terminal state rather
 * than when a component decides it is no longer interested.
 */
export const AUTH_OPERATION_POLL_MS = 1500;

/** Terminal states after which polling an auth operation must stop. */
export function isTerminalAuthState(state: AuthOperation["state"]): boolean {
	return (
		state === "succeeded" ||
		state === "failed" ||
		state === "cancelled" ||
		state === "expired"
	);
}

/**
 * Poll a backend auth operation until it settles. Returns a stop function;
 * a closed poll is NOT a cancellation — only the explicit Cancel button
 * deletes the operation, because closing a status view must not tear down
 * a flow the user may still be completing in their browser.
 */
export function pollAuthOperation(
	id: string,
	onUpdate: (operation: AuthOperation) => void,
	options: PollAuthOperationOptions = {},
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const read =
		options.read ??
		((operationId: string) =>
			desktopResult<AuthOperation>({ op: "auth.status", id: operationId }));
	const tick = async () => {
		if (stopped) return;
		try {
			const operation = await read(id);
			// A stop that landed while the read was in flight wins: the surface
			// that asked has moved on, and handing it a late snapshot would repaint
			// a flow it already left (a superseded operation, a closed panel).
			if (stopped) return;
			onUpdate(operation);
			// The callback may have stopped the poll itself (a caller that reads
			// a dead flow from more than `state`, e.g. `sign-in-flow.ts`).
			if (stopped) return;
			if (!isTerminalAuthState(operation.state)) {
				timer = setTimeout(tick, AUTH_OPERATION_POLL_MS);
			}
		} catch (error) {
			if (stopped) return;
			if (
				options.onGone &&
				error instanceof DesktopControlError &&
				error.status === 404
			) {
				stopped = true;
				options.onGone();
				return;
			}
			// A lost poll is a lost status read, not a failed login; keep polling
			// so a transient network blip does not strand a waiting browser flow.
			timer = setTimeout(tick, AUTH_OPERATION_POLL_MS * 2);
		}
	};
	void tick();
	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}
