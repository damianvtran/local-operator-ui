/**
 * Keeps a failed type-of-service hint from crashing the main process.
 *
 * WHAT HAPPENS WITHOUT IT. Electron 45 runs Node 24.22.1, whose bundled
 * `fetch` is undici 7.30.1. That undici's `writeH1` calls
 * `socket.setTypeOfService(request.typeOfService)` on every HTTP/1.1 request,
 * unguarded. When a connection is reset after `connect` and before the first
 * write, the `setsockopt` underneath fails and `Socket.setTypeOfService` THROWS
 * `EINVAL` synchronously from inside a socket event handler: an
 * `uncaughtException`, not a rejected `fetch`, so no caller's `try/catch` or
 * `.catch()` can reach it (nodejs/undici#5544, #6075).
 *
 * WHY IT MATTERS HERE MORE THAN MOST. The main process fetches a LOCAL daemon
 * that is routinely mid-start, mid-restart or mid-update - exactly the window in
 * which a connection gets reset before its first write - and posthog-node
 * fetches over the network beside it. This file's caller, `index.ts`, answers
 * any uncaught exception by stopping the owned backend and exiting the app, so
 * one dropped QoS hint used to take the whole desktop app and its server down.
 * PostHog, 30 days to 2026-11-17: 22 uncaught `setTypeOfService EINVAL` from 22
 * installs, 21 of them in one burst on 2026-10-25; every stack ends
 * `writeH1 -> Socket.setTypeOfService` inside `node:internal/deps/undici`.
 * Reproduced on this tree's Electron (`ELECTRON_RUN_AS_NODE=1`, a server that
 * resets every connection): 2 uncaught EINVAL in 300 fetches.
 *
 * WHY AT THE SOCKET, not around `fetch`. The throw happens on a socket event
 * after `fetch` has already returned its promise, so wrapping call sites cannot
 * work, and there are many of them (the daemon client, posthog-node, update
 * checks). Undici's own fix (#5547, "ignore type of service errors") is the same
 * move one layer up: a type-of-service mark is a best-effort QoS hint, and a
 * socket that cannot take it is either already dead - the request then fails
 * through its normal error path - or works without it.
 *
 * THE INVARIANT: only an error whose `syscall` is `setTypeOfService` is
 * swallowed. Any other exception from the original method (argument validation,
 * a future error class) still propagates, so this cannot hide a programming
 * error. Remove this once the bundled undici carries #5547 (undici >= 7.30.2 /
 * 8.x); `scripts/net-tos-guard.test.mjs` names the probe that shows it.
 */
import net from "node:net";

const GUARDED = Symbol.for("local-operator.net-tos-guard");

type TosSocket = net.Socket & {
	setTypeOfService?: (tos: number) => net.Socket;
};

/** Whether an error is the setsockopt failure the guard exists to absorb. */
export function isTypeOfServiceFailure(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { syscall?: unknown }).syscall === "setTypeOfService"
	);
}

/**
 * Wrap `net.Socket.prototype.setTypeOfService` once per process.
 *
 * Idempotent (a second call is a no-op), and a no-op on a runtime whose sockets
 * have no such method, so it is safe to call before anything else in `main`.
 *
 * @param onAbsorbed called with each absorbed error, for one log line; it must
 * not throw, and if it does the throw is dropped for the same reason as the error.
 * @returns whether the guard is installed after the call
 */
export function installTypeOfServiceGuard(
	onAbsorbed?: (error: unknown) => void,
): boolean {
	const proto = net.Socket.prototype as TosSocket & {
		[GUARDED]?: true;
	};
	const original = proto.setTypeOfService;
	if (typeof original !== "function") return false;
	if (proto[GUARDED]) return true;
	proto.setTypeOfService = function guardedSetTypeOfService(
		this: TosSocket,
		tos: number,
	): net.Socket {
		try {
			return original.call(this, tos);
		} catch (error) {
			if (!isTypeOfServiceFailure(error)) throw error;
			try {
				onAbsorbed?.(error);
			} catch {
				// A logging failure must not resurrect the crash this exists to stop.
			}
			// The method is chainable; keep that contract for undici's callers.
			return this;
		}
	};
	// Configurable so a test can restore the pristine prototype.
	Object.defineProperty(proto, GUARDED, { value: true, configurable: true });
	return true;
}
