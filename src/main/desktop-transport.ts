import {
	type DesktopResponse,
	desktopEndpoint,
	desktopRequestByteBudget,
	desktopRequestSchema,
	desktopRequestTooLargeDetail,
} from "../shared/desktop-contract";

/**
 * A desktop request in two parts that a caller must not conflate: what the app
 * will render, and whether the daemon was ever in a position to produce it.
 *
 * WHY these are separate values rather than one. `requestDesktop` resolves for
 * every failure it can produce - a refused socket, a reset, an expired budget,
 * and three refusals it makes BEFORE any byte leaves this process - so a
 * resolved promise says nothing about whether anything answered. The daemon
 * state machine needs precisely that distinction: `recordTransportSuccess()`
 * is the app's proof that the connection is ALIVE, and stamping it from a
 * request that was never sent is how a daemon that refused the socket came to
 * hold the state at `degraded` forever, with the user reading "refused the
 * connection (ECONNREFUSED) ... the daemon answered a request 0s ago" and the
 * app unable to reach `detached` and so unable to re-discover (review round 1,
 * F-1).
 *
 * `answered` is true exactly when `fetch` resolved - which is to say a process
 * wrote a status line for this request, whatever status it chose. A `401`, a
 * `403` or a `500` therefore counts: the daemon read the request and refused it,
 * which is the strongest liveness evidence this app has and is exactly what a
 * probe that ran out of its 2 s budget failed to establish. A `503` this
 * function SYNTHESISED does not count, and that is the whole of the fix: the
 * transport arm decides, not the status number.
 */
export type DesktopTransportOutcome = {
	response: DesktopResponse;
	/** Whether the daemon itself answered this request. */
	answered: boolean;
};

/**
 * The desktop request, with its liveness verdict kept beside the response.
 *
 * Callers that only render the answer want {@link requestDesktop}; the ONE
 * caller that reports the answer as evidence needs both halves, which is why
 * this exists rather than a field on `DesktopResponse` - that type crosses IPC
 * to the renderer, which has no use for this app's local liveness accounting.
 */
export async function requestDesktopOutcome(
	input: unknown,
	backendUrl: string,
	token: string | null,
): Promise<DesktopTransportOutcome> {
	const parsed = desktopRequestSchema.safeParse(input);
	if (!parsed.success) {
		// Zod errors can carry user input. IPC errors must never serialize a key.
		// Never sent: the schema refused it before a socket was opened.
		return {
			response: {
				status: 422,
				body: { detail: "Invalid desktop operation." },
			},
			answered: false,
		};
	}
	const request = parsed.data;
	if (request.op !== "capabilities" && !token) {
		// Never sent: this app has no credential to send.
		return {
			response: {
				status: 503,
				body: {
					detail:
						"Restart with a desktop-managed backend to use these controls.",
				},
			},
			answered: false,
		};
	}
	const target = desktopEndpoint(request);
	/*
	 * Set the moment `fetch` resolves, and read by the catch below. It is the
	 * whole content of the fix: everything after that line is a consequence of an
	 * answer, and everything before it is this process talking to itself -
	 * including a response whose JSON body fails to parse, which is a daemon that
	 * answered badly rather than one that did not answer.
	 */
	let answered = false;
	try {
		const body =
			target.body === undefined ? undefined : JSON.stringify(target.body);
		// Per-op, never one global literal: this guard once refused at 256 KiB for
		// every op, which is 29% of what the backend accepts and less than a single
		// pasted screenshot. The number now comes from the contract that declares
		// the schemas, so the pipe cannot silently disagree with the promise.
		//
		// This is the BACKSTOP, not the user-facing check. The renderer refuses an
		// oversize message before admission with copy that names the actual sizes;
		// by the time a body reaches here the op is untargeted, so the detail says
		// only what is true of any of them.
		if (
			body &&
			Buffer.byteLength(body) > desktopRequestByteBudget(request.op)
		) {
			// Names an action even though it cannot name a size: "too large" alone
			// told the user what happened but not what to do (review round 1, Q-3).
			// Scoped to the op because the remedy is surface-specific: advising a
			// user in the agent system-prompt editor to "remove an image" named
			// nothing that exists there (round 2, N4).
			return {
				response: {
					status: 413,
					body: { detail: desktopRequestTooLargeDetail(request.op) },
				},
				answered: false,
			};
		}
		const response = await fetch(new URL(target.path, backendUrl), {
			method: target.method,
			headers: {
				Accept: "application/json",
				...(body ? { "Content-Type": "application/json" } : {}),
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
			body,
			redirect: "error",
			signal: AbortSignal.timeout(20000),
		});
		answered = true;
		const result = response.status === 204 ? null : await response.json();
		if (request.op === "capabilities" && !token && result?.result) {
			// A backend may support the protocol while this app does not own its
			// lifetime capability. Never turn that into an unauthenticated fallback.
			result.result.desktop_available = false;
		}
		return {
			response: { status: response.status, body: result },
			answered: true,
		};
	} catch {
		return {
			response: {
				status: 503,
				body: {
					detail:
						"The backend could not complete this request. Check its connection and try again.",
				},
			},
			// `answered` survives the catch: a timeout ABORT or a body that failed
			// to parse still reached a listener, and saying otherwise would let a
			// slow daemon be detached as though it were absent.
			answered,
		};
	}
}

export async function requestDesktop(
	input: unknown,
	backendUrl: string,
	token: string | null,
): Promise<DesktopResponse> {
	return (await requestDesktopOutcome(input, backendUrl, token)).response;
}

export function trustedDesktopFrame(actual: string, expected: string): boolean {
	try {
		const current = new URL(actual);
		const trusted = new URL(expected);
		if (trusted.protocol === "file:") {
			return (
				current.protocol === "file:" && current.pathname === trusted.pathname
			);
		}
		return (
			["http:", "https:"].includes(trusted.protocol) &&
			current.origin === trusted.origin
		);
	} catch {
		return false;
	}
}
