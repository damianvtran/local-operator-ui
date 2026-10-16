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
 * RECONNECTS REPLAY. The subscription resumes from its last receipt cursor
 * (`epoch` + `after_seq`), so frames the backend still holds arrive again; the
 * fold dedupes by message id and gate id, which is what makes a replay safe.
 *
 * A SNAPSHOT IS STATE, NEVER A REPLAY (QA round 2, Q4). The server stamps the
 * subscription's `open` and the `snapshot` that follows it with the SAME
 * (epoch, seq) - measured: open@292, snapshot@292 - so a cursor rule that drops
 * "a frame at or behind the cursor" dropped every snapshot, and a card already
 * parked when the slot arrived never set `pendingApproval`: push-to-talk opened
 * the microphone for words the route then refused. A snapshot is therefore
 * always folded, and folded as STATE only (`snapshot: true` on the inputs it
 * produces): the gate it names is recorded but never announced, since it was
 * on screen before anything here armed a take.
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
 * A STOPPED WATCHER STATES NOTHING (N1). Whenever it stops - exhausted, gone, or
 * torn down - it folds `stopped`, which clears the pending approval and the
 * streaming flag: a gate it can no longer see clear must not keep refusing
 * takes, and a turn it can no longer see end must not be counted as running.
 * `retry()` on the returned handle starts a fresh ladder after `exhausted`; the
 * controller calls it on window focus, on a feed reconnect, and from the
 * notice's Reconnect action.
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

export type VoiceStreamStop = "exhausted" | "gone";

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
	onStop: (reason: VoiceStreamStop) => void = () => undefined,
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

	/** Tear down the current connection; the `end` it may emit is ours. */
	const drop = () => {
		connection += 1;
		const current = dispose;
		dispose = null;
		current?.();
	};

	const stop = (reason: VoiceStreamStop) => {
		state = reason;
		drop();
		onInput({ kind: "stopped" });
		onStop(reason);
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
					const snapshot = frame.type === "snapshot";
					if (
						typeof frame.epoch === "string" &&
						typeof frame.seq === "number"
					) {
						// A frame at or behind the cursor is a replay already folded -
						// except a snapshot, which is state (Q4: it shares the open's seq).
						if (
							!snapshot &&
							cursor &&
							cursor.epoch === frame.epoch &&
							frame.seq <= cursor.seq
						)
							return;
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
						onInput({ kind: "streaming", streaming });
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
			open();
		},
	};
}
