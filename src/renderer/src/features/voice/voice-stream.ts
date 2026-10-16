/**
 * The slot holder's own session stream, read for the speak trigger only
 * (`docs/design/session-voice.md`: "the turn trigger stays on the existing
 * per-session stream").
 *
 * A SECOND SUBSCRIPTION, deliberately, rather than a tap on the pane's: the pane
 * subscribes only while its conversation is on screen, and voice must keep
 * answering while the operator reads another conversation or the settings page.
 * It costs one of the bridge's subscriber seats (32 per session) and paints
 * nothing - its frames go to `voice-turns.ts` and nowhere else.
 *
 * RECONNECTS REPLAY, AND THE SERVER'S ORDER IS WHAT THE CURSOR RULE IS BUILT ON.
 * A subscription resumes from its last receipt cursor (`epoch` + `after_seq`).
 * The server then sends, in this order (`desktop_sessions.py`, the stream
 * generator): `open` stamped `seq = cutoff`; every frame it still holds with
 * `after_seq < seq <= cutoff`; then `snapshot@cutoff`; then live frames.
 *
 * - `open` DOES NOT MOVE THE CURSOR (review round 3, R3-M1). It carries the
 *   cutoff, which is AHEAD of the replay behind it; moving the cursor there
 *   dropped every replayed frame as "already seen", so a spoken turn's
 *   `message_end`/`agent_end` that landed during a drop were lost, the take
 *   stayed armed, and the NEXT turn - typed - was read aloud instead.
 * - Event and frontend frames advance the cursor and are dropped only when at
 *   or below it: a true duplicate of something this watcher already folded,
 *   including anything at or below the `after_seq` it asked to resume from.
 * - A SNAPSHOT IS STATE, NEVER A REPLAY (QA round 2, Q4). It shares the open's
 *   seq on a fresh subscription (measured: open@292, snapshot@292) and must not
 *   be dropped by the rule above, or a card already parked when the slot
 *   arrived never sets the pending card and push-to-talk opens the microphone
 *   for words the route then refuses. It is always folded, as STATE only
 *   (`snapshot: true` on the inputs it produces): the gate it names is recorded
 *   but never announced. It advances the cursor like any receipt. Its
 *   `streaming` flag carries `snapshot: true` too, because an idle snapshot is
 *   how a turn that ended while the stream was away is learned (R4-M1, path H).
 * - CONTINUITY LOST IS SAID OUT LOUD (review round 4, R4-M1; QA Q6). A resume
 *   answered with `open{gap:true}`, or on a new epoch (a cut longer than the
 *   server's 20 s RECONNECT_DWELL_S, or a daemon restart), replays nothing: the
 *   frames in between are gone. The watcher folds `reset`, which disarms any
 *   take, so a later turn is never mistaken for its answer (paths E and F).
 *
 * THE INVARIANT ALL OF THIS SERVES: a turn nobody spoke into is never spoken. A
 * take whose answering turn ended while the stream was away is dropped silently,
 * never carried into the next turn. The fold also dedupes by message id and gate
 * id, so a frame that slipped past the cursor rule cannot be spoken twice.
 *
 * RETRY IS BOUNDED (review round 1, U5) AND AN UNASKED END IS A FAILURE (review
 * round 2, N1). Backoff follows the pane's own ladder (`streamRetryDelayMs`) for
 * `VOICE_STREAM_MAX_ATTEMPTS` consecutive failures, then stops and reports
 * `exhausted`; any frame resets the count. An `end` this watcher did not cause
 * (the bridge closing the stream under it) is retried exactly like an `error`
 * - left alone it was a watcher that had gone deaf without saying so. The `end`
 * its OWN teardown provokes (the dev transport emits one from `dispose`) is
 * ignored. A 404 is the session itself being gone (`unknown_session`), which no
 * retry can change, so it stops at once and reports `gone`.
 *
 * A STOPPED WATCHER STATES NOTHING (N1, R4-M1). Whenever it stops - exhausted,
 * gone, or torn down - it folds `stopped`, which clears the pending card, the
 * streaming flag AND any armed take: a card it can no longer see clear must not
 * keep refusing takes, a turn it can no longer see end must not be counted as
 * running, and a take it can no longer match to its turn must not answer a later
 * one (path I).
 * `retry()` on the returned handle starts a fresh ladder after `exhausted`; the
 * controller calls it on window focus, on a feed reconnect, and from the
 * notice's Reconnect action. The first frame after such a retry reports
 * `recovered` (review round 3, R3-m1), so the "lost" notice is taken back by
 * whichever path brought the stream back.
 */

import { subscribeDesktopStream } from "@shared/api/local-operator/desktop-api";
import { streamRetryDelayMs } from "@shared/hooks/use-canonical-session";
import {
	type VoiceTurnsInput,
	gateOfFrame,
	streamingOfFrame,
} from "./voice-turns";

/** Consecutive failed connections before the watcher gives up. */
export const VOICE_STREAM_MAX_ATTEMPTS = 6;

/** `exhausted`/`gone`: the watcher stopped. `recovered`: a retry got a frame. */
export type VoiceStreamStatus = "exhausted" | "gone" | "recovered";

/** The seams a test drives; production uses the real ones. */
export type VoiceStreamDeps = {
	subscribe: typeof subscribeDesktopStream;
	delayMs: (attempt: number) => number;
	schedule: (run: () => void, ms: number) => unknown;
	cancel: (handle: unknown) => void;
};

const realDeps: VoiceStreamDeps = {
	subscribe: subscribeDesktopStream,
	delayMs: streamRetryDelayMs,
	schedule: (run, ms) => setTimeout(run, ms),
	cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type VoiceStreamHandle = {
	/** Tear the watcher down for good. */
	dispose: () => void;
	/**
	 * Start a fresh retry ladder after the watcher gave up (`exhausted`). A no-op
	 * while it is connected or retrying, and after `gone` or `dispose`: a session
	 * that no longer exists is not one a focus event can bring back.
	 */
	retry: () => void;
};

export function subscribeVoiceStream(
	sessionId: string,
	onInput: (input: VoiceTurnsInput) => void,
	onStatus: (status: VoiceStreamStatus) => void = () => undefined,
	deps: VoiceStreamDeps = realDeps,
): VoiceStreamHandle {
	let cursor: { epoch: string; seq: number } | null = null;
	/** The live subscription's own disposer, or null between connections. */
	let dispose: (() => void) | null = null;
	let retry: unknown = null;
	let failures = 0;
	/** `exhausted`: waiting for `retry()`. `gone`/`closed`: final. */
	let state: "live" | "exhausted" | "gone" | "closed" = "live";
	/** Which connection is current, so a late event from an old one is dropped. */
	let connection = 0;
	/** A `retry()` after `exhausted` is waiting for its first frame. */
	let recovering = false;

	/** Tear down the current connection; the `end` it may emit is ours. */
	const drop = () => {
		connection += 1;
		const current = dispose;
		dispose = null;
		current?.();
	};

	const stop = (reason: "exhausted" | "gone") => {
		state = reason;
		recovering = false;
		drop();
		onInput({ kind: "stopped" });
		onStatus(reason);
	};

	const fail = (status: number | undefined) => {
		drop();
		if (status === 404) {
			stop("gone");
			return;
		}
		failures += 1;
		if (failures >= VOICE_STREAM_MAX_ATTEMPTS) {
			stop("exhausted");
			return;
		}
		retry = deps.schedule(open, deps.delayMs(failures));
	};

	const open = () => {
		if (state !== "live") return;
		retry = null;
		connection += 1;
		const mine = connection;
		dispose = deps.subscribe(
			{
				sessionId,
				...(cursor ? { epoch: cursor.epoch, afterSeq: cursor.seq } : {}),
			},
			(event) => {
				// An event from a connection this watcher already dropped - including
				// the `end` its own teardown provokes - is not about the live one.
				if (state !== "live" || mine !== connection) return;
				if (event.kind === "data" && event.data) {
					let frame: {
						type?: unknown;
						epoch?: unknown;
						seq?: unknown;
						payload?: unknown;
					};
					try {
						frame = JSON.parse(event.data);
					} catch {
						return;
					}
					failures = 0;
					if (recovering) {
						recovering = false;
						onStatus("recovered");
					}
					/*
					 * `open` is metadata stamped with the cutoff, ahead of the replay that
					 * follows it: it never moves the cursor (R3-M1). On a RESUME (a cursor
					 * exists) it is also where the server says continuity was lost: `gap`,
					 * or a new epoch after a long cut or a daemon restart. The frames in
					 * between are gone, so the fold is told to disarm (R4-M1, paths E/F).
					 */
					if (frame.type === "open") {
						const payload = frame.payload as { gap?: unknown } | undefined;
						if (
							cursor &&
							(payload?.gap === true ||
								(typeof frame.epoch === "string" &&
									frame.epoch !== cursor.epoch))
						)
							onInput({ kind: "reset" });
						return;
					}
					const snapshot = frame.type === "snapshot";
					if (
						typeof frame.epoch === "string" &&
						typeof frame.seq === "number"
					) {
						// At or below the cursor is a duplicate already folded - except a
						// snapshot, which is state (Q4: it can share a seq it follows).
						if (
							!snapshot &&
							cursor &&
							cursor.epoch === frame.epoch &&
							frame.seq <= cursor.seq
						)
							return;
						// A receipt on a new epoch without the open that should announce it.
						if (cursor && cursor.epoch !== frame.epoch)
							onInput({ kind: "reset" });
						if (
							!cursor ||
							cursor.epoch !== frame.epoch ||
							frame.seq > cursor.seq
						)
							cursor = { epoch: frame.epoch, seq: frame.seq };
					}
					if (
						frame.type === "event" &&
						frame.payload &&
						typeof frame.payload === "object"
					) {
						onInput({
							kind: "event",
							event: frame.payload as Record<string, unknown>,
						});
						return;
					}
					const streaming = streamingOfFrame(frame);
					if (streaming !== undefined)
						onInput({ kind: "streaming", streaming, snapshot });
					const gate = gateOfFrame(frame);
					if (gate !== undefined) onInput({ kind: "gate", gate, snapshot });
					return;
				}
				if (event.kind === "error" || event.kind === "end") {
					// An `end` nobody asked for is the bridge closing the stream (N1).
					fail(event.kind === "error" ? event.status : undefined);
				}
			},
		);
	};
	open();
	return {
		dispose: () => {
			if (state === "closed") return;
			const wasLive = state === "live";
			state = "closed";
			if (retry !== null) deps.cancel(retry);
			retry = null;
			drop();
			// A watcher that stopped earlier already folded `stopped`.
			if (wasLive) onInput({ kind: "stopped" });
		},
		retry: () => {
			if (state !== "exhausted") return;
			state = "live";
			failures = 0;
			recovering = true;
			open();
		},
	};
}
