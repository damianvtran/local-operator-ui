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
 */

import { subscribeDesktopStream } from "@shared/api/local-operator/desktop-api";
import { streamRetryDelayMs } from "@shared/hooks/use-canonical-session";
import {
	type VoiceTurnsInput,
	gateOfFrame,
	streamingOfFrame,
} from "./voice-turns";

export function subscribeVoiceStream(
	sessionId: string,
	onInput: (input: VoiceTurnsInput) => void,
): () => void {
	let cursor: { epoch: string; seq: number } | null = null;
	let dispose: (() => void) | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let attempt = 0;
	let closed = false;

	const open = () => {
		if (closed) return;
		dispose = subscribeDesktopStream(
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
					attempt = 0;
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
					attempt += 1;
					retry = setTimeout(open, streamRetryDelayMs(attempt));
				}
			},
		);
	};
	open();
	return () => {
		closed = true;
		if (retry) clearTimeout(retry);
		dispose?.();
	};
}
