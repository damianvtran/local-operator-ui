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
 * fold dedupes by message id and gate id, which is what makes a replay safe. A
 * gap (a new epoch) re-reads the snapshot, whose `pending_gate` is folded like
 * any other.
 *
 * RETRY IS BOUNDED (review round 1, U5). Backoff follows the pane's own ladder
 * (`streamRetryDelayMs`) for `VOICE_STREAM_MAX_ATTEMPTS` consecutive failures,
 * then stops and reports `exhausted`; any frame resets the count. A 404 is the
 * session itself being gone (`unknown_session`), which no retry can change, so
 * it stops at once and reports `gone`.
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

export function subscribeVoiceStream(
	sessionId: string,
	onInput: (input: VoiceTurnsInput) => void,
	onStop: (reason: VoiceStreamStop) => void = () => undefined,
	deps: VoiceStreamDeps = realDeps,
): () => void {
	let cursor: { epoch: string; seq: number } | null = null;
	let dispose: (() => void) | null = null;
	let retry: unknown = null;
	let failures = 0;
	let closed = false;

	const stop = (reason: VoiceStreamStop) => {
		closed = true;
		dispose?.();
		dispose = null;
		onStop(reason);
	};

	const open = () => {
		if (closed) return;
		retry = null;
		dispose = deps.subscribe(
			{
				sessionId,
				...(cursor ? { epoch: cursor.epoch, afterSeq: cursor.seq } : {}),
			},
			(event) => {
				if (closed) return;
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
					if (
						typeof frame.epoch === "string" &&
						typeof frame.seq === "number"
					) {
						// A frame at or behind the cursor is a replay already folded.
						if (
							cursor &&
							cursor.epoch === frame.epoch &&
							frame.seq <= cursor.seq
						)
							return;
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
					if (gate !== undefined) onInput({ kind: "gate", gate });
					return;
				}
				if (event.kind === "error") {
					dispose?.();
					dispose = null;
					if (event.status === 404) {
						stop("gone");
						return;
					}
					failures += 1;
					if (failures >= VOICE_STREAM_MAX_ATTEMPTS) {
						stop("exhausted");
						return;
					}
					retry = deps.schedule(open, deps.delayMs(failures));
				}
			},
		);
	};
	open();
	return () => {
		closed = true;
		if (retry !== null) deps.cancel(retry);
		dispose?.();
	};
}
