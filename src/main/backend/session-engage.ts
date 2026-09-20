/**
 * Starting a session's runtime again, through the path the app already uses to
 * open a session.
 *
 * WHY THIS IS NOT A `sessions.watch` AND A `sessions.warm` ON THEIR OWN, which
 * is what this replaced and why it never worked. Both routes carry a
 * PRECONDITION the caller has to satisfy for the call to mean anything, and the
 * old code satisfied neither:
 *
 * 1. **`sessions.watch` must be handed a subscription id the bridge KNOWS.**
 *    The route hands the id straight to `DesktopSessionBridge.watch`, which looks
 *    it up in the bridge's own subscriber table and raises `KeyError` when it is
 *    absent (`local_operator/server/utils/desktop_sessions.py`), which the route
 *    ladder answers as a 404. That table is populated by the bridge's `subscribe`
 *    - i.e. by an open events stream - and the id is minted SERVER-side, so it
 *    cannot be invented by the caller. The old code generated a fresh random id
 *    per engage, so every engage answered 404 and nothing was put back.
 * 2. **A warm only survives while something else holds the bridge.** The
 *    bridge is reference-counted by IN-FLIGHT REQUESTS; a warm issued while
 *    nothing holds the bridge is cancelled the moment its own request returns
 *    (`routes/desktop_sessions.py`, the `warm` route's own docstring). The
 *    renderer's panel works because the mounted panel holds an events stream for
 *    its whole life; a one-shot warm from main holds nothing and spawns nothing.
 *
 * So the way to start a runtime for a session this app no longer has one for is
 * to do what OPENING THE SESSION does: hold its events stream, take the
 * subscription id the stream's own `open` frame carries, lease that id with a
 * visible watch (a live visible lease is what CREATES residency for a cold
 * session - `DesktopSessionBridge.refresh_watch`: "a user looking at the session
 * is about to type"), and keep the stream open while the runtime comes up.
 *
 * WHY THE UPDATED CHECK IS A READ OF THE FLEET RATHER THAN A RECEIPT (review
 * round 2, R2-M1). Every route on this path answers 200 to a call it will not
 * act on - the warm says so in its own docstring, and the leash below is only
 * meaningful while an id is live - so a status code is not evidence that a
 * runtime exists. What the caller can see is the roster's own `live_state`, the
 * same reader the fleet gate uses. This module holds the stream until that read
 * says the session has a runtime again, and answers false when it never does,
 * which is a claim about the machine rather than about a receipt.
 *
 * SEQUENTIAL BY THE CALLER'S DESIGN. Nothing here fans out: one engage, one
 * stream, closed before the next. A burst of constructors on a machine an update
 * has just moved is the shape the host tool's own re-engage avoids.
 */

/**
 * How long the session's events stream may take to hand back its subscription id.
 *
 * The stream is a local HTTP request to the daemon serving this app, and the
 * `open` frame is the first frame it writes, so this is a generous bound for a
 * daemon that is up (which is a precondition of the caller: the re-engage runs
 * after the server answered its health check). It exists so a stream that never
 * opens cannot hold the re-engage open forever, not to pace the ordinary case.
 *
 * THE OPEN WAIT POLLS ON `beatMs`, NOT ON THIS (review round 3, R3-n1). With the
 * shipped pair (5 s beat against a 5 s bound) the loop's own condition is what
 * ends it, but a `beatMs` larger than `openMs` - the two are injectable, so a
 * caller may retune one alone - would make the `min` clamp on the sleep the only
 * thing keeping this bound. It does keep it, which is why this is a word in the
 * comment rather than a defect; it is the pair to keep in step.
 */
export const SESSION_ENGAGE_OPEN_MS = 5_000;

/**
 * How often the held lease is renewed while the runtime comes up.
 *
 * The renderer's own presence beat is 15 s against a 45 s lease TTL
 * (`WATCH_TTL`); this is faster because this hold is seconds long rather than
 * minutes, and a lease that lapsed mid-hold would withdraw the very intent the
 * hold exists to express. It is a renewal of the SAME intent, not a new one.
 */
export const SESSION_ENGAGE_BEAT_MS = 5_000;

/**
 * How long the stream is held while the runtime comes up.
 *
 * MEASURED, not guessed: a cold engage is ~1.1 s median on this machine
 * (`routes/desktop_sessions.py`'s own numbers) and the lease-driven warm retries
 * an attempt that was silently lost on the next pass. Twenty seconds covers a
 * slow spawn and a retry with room to spare, and it is the bound that matters
 * when the engage does NOT work: a session that will not come back costs this
 * once, and the re-engage reports it rather than keeping the press open.
 */
export const SESSION_ENGAGE_HOLD_MS = 20_000;

/** One frame off the session's events stream, as much as this module reads. */
type StreamEvent =
	| { kind: "data"; data: string }
	| { kind: "error"; detail: string }
	| { kind: "end" };

export type SessionEngageOutcome = {
	/** True when the session has a runtime again. */
	engaged: boolean;
	/**
	 * Why it does not, in the app's own words, for the caller's log. Absent on the
	 * successful arm.
	 */
	reason?: string;
	/** How many times the lease was renewed while the hold ran, for the log. */
	beats: number;
};

/**
 * The subscription id inside one event frame, or null when this frame is not the
 * `open` one.
 *
 * The id rides in the frame's PAYLOAD (`{"type":"open","payload":{"subscription_id":
 * ...}}`), which is the shape the renderer reads it from too - reading the top
 * level yields null, the lease is never leased, and the runtime stops counting
 * the view, which is the failure `scripts/submit-latency.test.mjs` records
 * measuring. A frame that is not JSON, or not an object, or carries no string id,
 * is not an open frame.
 */
const subscriptionIdIn = (frame: string): string | null => {
	try {
		const parsed: unknown = JSON.parse(frame);
		if (typeof parsed !== "object" || parsed === null) return null;
		const payload = (parsed as { payload?: unknown }).payload;
		if (typeof payload !== "object" || payload === null) return null;
		const id = (payload as { subscription_id?: unknown }).subscription_id;
		return typeof id === "string" && id !== "" ? id : null;
	} catch {
		return null;
	}
};

/**
 * Start one session's runtime through the app's own session stream, and say
 * whether it is there afterwards.
 *
 * Every effect it has is injected, so the rule is testable without a daemon and
 * the SHIPPED path is what the desktop suite drives: `subscribe` is the app's
 * own relay, `watch`/`warm` are the app's own desktop requests, and `hasRuntime`
 * is the roster read the fleet gate already makes.
 */
export async function engageSessionThroughStream(input: {
	/** The session to put a runtime back on. */
	sessionId: string;
	/**
	 * Open the session's events stream and report its frames, exactly as
	 * `DesktopStreamRelay.subscribe` does. The returned handle closes it.
	 */
	subscribe: (
		sessionId: string,
		emit: (event: StreamEvent) => void,
	) => { streamId: string };
	/** Close a stream this module opened. */
	unsubscribe: (streamId: string) => void;
	/**
	 * The renderer's own presence beat, on the id the STREAM handed back. The
	 * caller's transport answers the route's own refusal (404 for an id no stream
	 * holds) as a status.
	 */
	watch: (subscriptionId: string) => Promise<{ status: number }>;
	/** `sessions.warm`, the renderer's own explicit speculation. */
	warm: (sessionId: string) => Promise<{ status: number }>;
	/**
	 * Whether the session has a runtime right now. Null is a roster that could not
	 * be read, which is not evidence either way and so is polled again rather than
	 * read as an answer.
	 */
	hasRuntime: () => Promise<boolean | null>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	openMs?: number;
	beatMs?: number;
	holdMs?: number;
	/** Every line here is worth a reader's time when an engage does not work. */
	log?: (line: string) => void;
}): Promise<SessionEngageOutcome> {
	const openMs = input.openMs ?? SESSION_ENGAGE_OPEN_MS;
	const beatMs = input.beatMs ?? SESSION_ENGAGE_BEAT_MS;
	const holdMs = input.holdMs ?? SESSION_ENGAGE_HOLD_MS;
	const startedAt = input.now();
	let subscriptionId: string | null = null;
	let streamError: string | null = null;
	const handle = input.subscribe(input.sessionId, (event) => {
		if (event.kind === "data") {
			subscriptionId ??= subscriptionIdIn(event.data);
			return;
		}
		/*
		 * An error or an end before the open frame is the stream telling us why
		 * there is nothing to lease. Kept rather than folded into the generic
		 * "never opened" so the log names the transport's own sentence.
		 */
		if (event.kind === "error") streamError ??= event.detail;
		else streamError ??= "the session's events stream ended";
	});
	try {
		while (subscriptionId === null && input.now() - startedAt < openMs) {
			if (streamError !== null) break;
			await input.sleep(
				Math.min(beatMs, Math.max(1, openMs - (input.now() - startedAt))),
			);
		}
		/*
		 * NO INVENTED ID, EVER. This is the whole finding: an id this process made
		 * up is an id the bridge has never heard of, so the lease is refused one
		 * request before the warm and the engage reports a miss it could have
		 * predicted. Without the stream's own id there is nothing to lease.
		 */
		if (subscriptionId === null) {
			return {
				engaged: false,
				reason:
					streamError ??
					"the session's events stream never announced a subscription",
				beats: 0,
			};
		}
		const lease = await input.watch(subscriptionId);
		if (lease.status !== 200) {
			return {
				engaged: false,
				reason: `the lease answered ${lease.status}`,
				beats: 0,
			};
		}
		/*
		 * THE WARM IS SPECULATION ON TOP OF THE LEASE, and its refusal is not the
		 * engage's failure: a live visible lease creates residency on its own
		 * (`refresh_watch`), the warm is the renderer's own head start on the first
		 * keystroke, and the route answers a warming failure with 2xx by design.
		 * What decides the outcome is the roster read below.
		 */
		const warm = await input.warm(input.sessionId);
		if (warm.status !== 200) {
			input.log?.(
				`The warm for ${input.sessionId} answered ${warm.status}; the lease is still held while the runtime comes up`,
			);
		}
		let beats = 0;
		let cameUp = false;
		/*
		 * WHETHER THE LEASE IS STILL SOMETHING TO RENEW, and the second half of
		 * R3-m2 below: once the stream is gone the bridge no longer holds this
		 * subscription, so there is nothing left to keep alive.
		 */
		let leaseHeld = true;
		const leaseAt = input.now();
		while (input.now() - startedAt < openMs + holdMs) {
			const live = await input.hasRuntime();
			if (live === true) {
				cameUp = true;
				break;
			}
			await input.sleep(
				Math.min(
					beatMs,
					Math.max(1, openMs + holdMs - (input.now() - startedAt)),
				),
			);
			/*
			 * THE HOLD IS RE-CHECKED (review round 3, R3-m2). `streamError` used to be
			 * read on the way IN and never again, so a stream that dropped mid-hold - a
			 * second daemon bounce, a socket reset, the relay's own watchdog - left the
			 * bridge holding no subscription for this id while the loop went on renewing
			 * it: every renewal is then the 404 an unknown id meets, residency is
			 * withdrawn with nothing surfaced, and the miss below blamed the RUNTIME for
			 * a transport that died. The roster read stays the verdict, because a runtime
			 * that did come up is still a success whatever the stream did; what changes is
			 * that the dead lease is not renewed and the reason names the transport's own
			 * sentence.
			 */
			if (streamError !== null) {
				if (leaseHeld) {
					leaseHeld = false;
					input.log?.(
						`The lease for ${input.sessionId} was withdrawn when its stream ended (${streamError}); the roster read still decides whether a runtime came up`,
					);
				}
				continue;
			}
			/*
			 * RENEWED, because the lease is what expresses the intent: letting it
			 * lapse mid-hold would withdraw the residency request the stream is being
			 * held for, which is the failure mode this whole module exists to avoid.
			 */
			await input.watch(subscriptionId);
			beats += 1;
		}
		if (cameUp) return { engaged: true, beats };
		/*
		 * THE BOUND THAT RAN, NOT THE CONSTANT (review round 3, R3-m3). The loop is
		 * bounded by `openMs + holdMs` measured from the CALL, so the time actually
		 * spent holding after the lease is up to `holdMs + (openMs - openDuration)` -
		 * 25 s when the open frame is immediate, never the 20 s this used to print. It
		 * is the one line a reader gets when a session does not come back, so it
		 * reports the measured hold rather than a number the call may not have spent.
		 */
		const heldSeconds = Math.round((input.now() - leaseAt) / 1000);
		return {
			engaged: false,
			reason:
				streamError === null
					? `no runtime for ${input.sessionId} ${heldSeconds}s after the lease`
					: `the session's events stream ended ${heldSeconds}s into the hold (${streamError}), so the lease was withdrawn before the runtime could be asked for`,
			beats,
		};
	} finally {
		/*
		 * ALWAYS CLOSED. The stream is a real request against the daemon and the
		 * bridge's subscriber table is bounded (32 subscribers, `SUBSCRIBER_COUNT`),
		 * so a leaked stream on a failed engage is what would make the NEXT
		 * re-engage fail - a leak that would look like the daemon refusing.
		 */
		input.unsubscribe(handle.streamId);
	}
}
