import {
	type DesktopResponse,
	desktopEndpoint,
	desktopRequestByteBudget,
	desktopRequestDeadlineDetail,
	desktopRequestDeadlineMs,
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
 * state machine needs precisely that distinction: `recordTransportAnswer()` is
 * the app's proof that the connection is ALIVE, and stamping it from a request
 * that was never sent is how a daemon that refused the socket came to hold the
 * state at `degraded` forever, with the user reading "refused the connection
 * (ECONNREFUSED) ... the daemon answered a request 0s ago" and the app unable
 * to reach `detached` and so unable to re-discover (review round 1, F-1).
 *
 * The same split answers a second question the state machine keeps apart from
 * liveness, and {@link desktopAnswerProvesPairing} is where: an answer proves
 * the connection is alive, while only an answer the plane ADMITTED proves this
 * app is still PAIRED. A refusal is the first and never the second - see that
 * function for what a daemon replaced under the app answers with, and what
 * counting it as a pairing cost (measured 2026-09-18).
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
	/*
	 * This op's own budget, from the contract that declares the schemas - not one
	 * literal for every op. A ledger read's cost follows the ledger, and the 20 s
	 * control budget was cutting those reads off mid-scan and reporting it as a
	 * dead backend; see `desktopRequestDeadlineMs` for the measurements.
	 */
	const deadlineMs = desktopRequestDeadlineMs(request.op);
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
			signal: AbortSignal.timeout(deadlineMs),
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
	} catch (error) {
		/*
		 * Which failure this was decides what the user is told, so it is read off
		 * the error rather than collapsed into one sentence. `AbortSignal.timeout`
		 * rejects with a `TimeoutError` DOMException and a refused socket is a
		 * `TypeError`, and the difference is the whole point: one of them is this
		 * process giving up on a backend that is still working, the other is a
		 * backend that never answered. A 504 with its own code is the first; the
		 * 503 the second keeps is what the connectivity banner reads as
		 * "unreachable" (`backendErrorKind`), which is true for a refused socket and
		 * false for a slow read.
		 */
		if (deadlineExceeded(error)) {
			return {
				response: {
					status: 504,
					body: {
						detail: desktopRequestDeadlineDetail(request.op, deadlineMs),
					},
				},
				/*
				 * Carried through the same way as the 503 below, and it means the same
				 * thing here: an abort during the body read is an answer this process
				 * received and could not finish, which is still liveness evidence, while
				 * an abort that never got a response is not.
				 */
				answered,
			};
		}
		return {
			response: {
				status: 503,
				body: {
					detail:
						"The backend could not complete this request. Check its connection and try again.",
				},
			},
			/*
			 * `answered` survives the catch, and it is true here in exactly TWO cases,
			 * both of them a listener that answered: a body this process could not
			 * parse (the flag was set when `fetch` resolved, and a malformed answer is
			 * still an answer), and a failure DURING the body read - an abort that
			 * fired while the bytes were being pulled in lands here with `answered`
			 * already set. A timeout abort that never got a response does NOT:
			 * it throws out of `fetch` before the assignment, so it returns
			 * `answered: false`, like a refused socket (review round 2 MINOR-1, and
			 * review round 3 MINOR-1 which found the second case - the wording said
			 * "the ONE case" and the invariant it named was narrower than the code).
			 */
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

/**
 * Whether a transport failure was this process running out of its own budget.
 *
 * Both names are accepted because both are reachable: `AbortSignal.timeout`
 * rejects with `TimeoutError`, while an abort that arrives through the same
 * signal for any other reason arrives as `AbortError`. Reading the NAME rather
 * than `instanceof DOMException` keeps this correct across the runtimes this
 * file is bundled for (the desktop test runner evaluates it in bare Node), where
 * DOMException is present but is not always the same constructor the fetch
 * implementation raised.
 */
function deadlineExceeded(error: unknown): boolean {
	const name = (error as { name?: unknown } | null)?.name;
	return name === "TimeoutError" || name === "AbortError";
}

/**
 * The path prefix of every route the daemon's desktop plane has to ADMIT.
 *
 * The daemon's own routing table puts `require_desktop` on the `/v1/desktop/`
 * routers, so every route under this prefix refuses an unpaired caller with
 * `401`/`403` - or with `503` while the plane is shut ("Desktop controls
 * require a backend started by the desktop app"). Nothing OUTSIDE the prefix is
 * a pairing signal this predicate can read, and the families outside it are
 * gated unevenly - which is why the prefix, not the family, is what it keys on:
 *
 *  - `/v1/capabilities` admits nobody, by design, so a renderer can read the
 *    plane's posture (the op this app polls every 15 s while the plane is shut);
 *  - `/v1/auth/*` and `/v1/settings*` carry the dependency unconditionally, so
 *    on a daemon nobody has claimed they answer `503`, not `200`;
 *  - `/v1/agents`, `/v1/jobs`, `/v1/schedules`, `/v1/config`, `/v1/credentials`
 *    and `/v1/models` are gated by the boundary middleware ONLY while the plane
 *    is enabled, so the same `200` from one of them is either the daemon
 *    admitting an enabled plane's caller or an unclaimed daemon's ordinary
 *    reply - and the answer alone cannot say which.
 *
 * What follows from that is the predicate's error direction, and it is
 * deliberate: a 2xx on one of the gated legacy families an enabled plane
 * admitted is DISCARDED (a false NEGATIVE - evidence this predicate fails to
 * count), and no answer that the plane did not admit can ever be counted (no
 * false POSITIVE). The state machine is built to absorb the first, because the
 * ops under this prefix keep arriving - the presence beat every 15 s next to
 * every desktop read - and any one of their 2xx is the proof this predicate
 * wants.
 *
 * `/v1/desktop/claim` is under this prefix and is deliberately NOT gated - it is
 * the door the gate stands in front of - but no request op maps to it: a claim is
 * sent by `claimDesktopPlane`, which does not go through this transport.
 */
const ADMITTED_PATH_PREFIX = "/v1/desktop/";

/**
 * Whether one desktop answer proves this app is still PAIRED with the daemon.
 *
 * The state machine asks two different questions of the same answer, and
 * conflating them is what kept an unpaired app looking attached: "is the
 * connection alive?" (any answer, whatever its status) and "does this app's
 * credential still govern this daemon's plane?" (only an answer the plane let
 * THROUGH). This answers the second one, and it is narrow on purpose:
 *
 *  - the route must be one the plane has to admit
 *    ({@link ADMITTED_PATH_PREFIX}), so a `200` from the capability op - which
 *    the renderer re-asks every 15 s while the plane is shut, exactly to notice
 *    when it re-opens - can never stand in for a proven pairing;
 *  - the status must be a 2xx. A `401`/`403` is the plane refusing THIS app's
 *    bearer and a `503` is a plane that is shut, which is what a daemon REPLACED
 *    under the app answers with until the app claims the new process's plane.
 *    Counting one of those as a proven pairing is how a replaced daemon's
 *    refusals kept the app `attached` to a pid that was gone, cleared the
 *    identity-failure count on every pass, and left it reporting "not paired
 *    with the running Local Operator server" for 28 minutes instead of
 *    re-discovering and re-claiming (measured 2026-09-18).
 *
 * A request the schema refused, and one this app never sent (no token), prove
 * nothing and answer `false`.
 *
 * `response` is read for its status alone rather than typed as
 * `DesktopResponse`: this asks what the daemon DECIDED, not which body shape
 * carried the decision, so any answer object with a status answers it.
 */
export function desktopAnswerProvesPairing(
	input: unknown,
	response: { status: number },
): boolean {
	const parsed = desktopRequestSchema.safeParse(input);
	if (!parsed.success) return false;
	if (!desktopEndpoint(parsed.data).path.startsWith(ADMITTED_PATH_PREFIX))
		return false;
	return response.status >= 200 && response.status < 300;
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
