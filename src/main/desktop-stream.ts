/**
 * Authenticated SSE relay for canonical session events.
 *
 * The renderer cannot carry the desktop bearer — EventSource has no header
 * channel — so main fetches `GET /v1/desktop/sessions/{id}/events` itself and
 * forwards each SSE `data:` frame over IPC, scoped to the stream ID of the
 * one window that asked. Frames are never buffered across the renderer: main
 * parses them line by line and pushes each complete record the moment its
 * blank-line terminator arrives, so a streamed token's paint latency is the
 * backend's, not a relay's.
 *
 * The token never crosses IPC: not in the subscribe arguments, not in a
 * frame, not in an error string.
 */

import { randomBytes } from "node:crypto";
import { DESKTOP_STREAM_DETAIL } from "../shared/desktop-stream-notice";

const SESSION_ID = /^[a-f0-9]{12}$/;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
/**
 * The one distinguishable fetch failure worth naming.
 *
 * `ECONNREFUSED` is the only transport error that tells the app something it
 * did not already know: NOTHING is listening on the backend's origin, i.e. the
 * managed backend is not running. That is Q-2's state - a backend child that
 * exited is terminal, so the reader must be told the server is gone rather than
 * that "the stream ended", which names the wrong thing and implies the app is
 * still attached to something. Every other exception stays generic, because an
 * exception string can carry the URL (and, in a misconfigured future, a
 * credential).
 */
function transportFailureDetail(error: unknown): string {
	if (error instanceof Error && error.name === "AbortError") {
		return DESKTOP_STREAM_DETAIL.ended;
	}
	const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
	if (code === "ECONNREFUSED") return DESKTOP_STREAM_DETAIL.serverDown;
	return DESKTOP_STREAM_DETAIL.connectionFailed;
}

/** Relay frame cap, matching the backend's per-frame bound. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type RelaySubscribeArgs = {
	sessionId: string;
	epoch?: string;
	afterSeq?: number;
};

export type RelayEvent =
	| { streamId: string; kind: "data"; data: string }
	| { streamId: string; kind: "error"; detail: string }
	| { streamId: string; kind: "end" };

export type DesktopStreamHandle = {
	streamId: string;
};

export class DesktopStreamRelay {
	private readonly streams = new Map<string, AbortController>();
	/** Frame observer for main-owned side effects (notifications). It sees
	 * every parsed frame before the renderer does, on the same subscription. */
	private observer: ((sessionId: string, data: string) => void) | null = null;

	constructor(
		private readonly backendUrl: string,
		private readonly token: string | null,
	) {}

	observe(observer: ((sessionId: string, data: string) => void) | null): void {
		this.observer = observer;
	}

	/** True when this relay can authenticate; a false answer is why the UI
	 * shows the pairing/setup state rather than a dead transcript. */
	get available(): boolean {
		return Boolean(this.token);
	}

	subscribe(
		args: RelaySubscribeArgs,
		emit: (event: RelayEvent) => void,
	): DesktopStreamHandle {
		if (!SESSION_ID.test(args.sessionId)) {
			throw new Error("Invalid session for streaming.");
		}
		if (args.epoch !== undefined && !SAFE_ID.test(args.epoch)) {
			throw new Error("Invalid stream epoch.");
		}
		if (
			args.afterSeq !== undefined &&
			(!Number.isInteger(args.afterSeq) || args.afterSeq < 0)
		) {
			throw new Error("Invalid stream cursor.");
		}
		if (!this.token) {
			// A refusal, NOT a throw. The caller is an IPC handler whose rejection
			// the renderer never observes (its `streamIdPromise` has no rejection
			// path it awaits), so throwing here produced exactly the reported
			// symptom: the consumer stays at "connecting" forever with no open
			// frame, no error and nothing to act on. Emitted as an ordinary error
			// frame on a real stream id instead, so it reaches the one consumer
			// that asked and is scoped to it like every other frame.
			//
			// The detail is the module's own constant: it never carries the URL,
			// the token or an exception string.
			const streamId = randomBytes(16).toString("hex");
			queueMicrotask(() => {
				emit({
					streamId,
					kind: "error",
					detail: DESKTOP_STREAM_DETAIL.notPaired,
				});
			});
			return { streamId };
		}

		const streamId = randomBytes(16).toString("hex");
		const controller = new AbortController();
		this.streams.set(streamId, controller);

		const query = new URLSearchParams();
		if (args.epoch) query.set("epoch", args.epoch);
		if (args.afterSeq !== undefined)
			query.set("after_seq", String(args.afterSeq));
		const suffix = query.size > 0 ? `?${query}` : "";
		const url = new URL(
			`/v1/desktop/sessions/${args.sessionId}/events${suffix}`,
			this.backendUrl,
		);

		void this.pump(
			streamId,
			args.sessionId,
			url,
			controller.signal,
			emit,
		).finally(() => {
			this.streams.delete(streamId);
		});

		return { streamId };
	}

	private async pump(
		streamId: string,
		sessionId: string,
		url: URL,
		signal: AbortSignal,
		emit: (event: RelayEvent) => void,
	): Promise<void> {
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${this.token}`,
				},
				redirect: "error",
				signal,
			});
			if (!response.ok || !response.body) {
				emit({
					streamId,
					kind: "error",
					detail: DESKTOP_STREAM_DETAIL.refused(response.status),
				});
				return;
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				// SSE records terminate on a blank line. Everything before it is
				// flushed record-by-record; a partial record stays in the buffer.
				for (;;) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary < 0) {
						if (buffer.length > MAX_FRAME_BYTES) {
							emit({
								streamId,
								kind: "error",
								detail: DESKTOP_STREAM_DETAIL.frameBudget,
							});
							reader.cancel().catch(() => undefined);
							return;
						}
						break;
					}
					const record = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					for (const line of record.split("\n")) {
						if (line.startsWith("data:")) {
							const data = line.slice(5).replace(/^ /, "");
							this.observer?.(sessionId, data);
							emit({ streamId, kind: "data", data });
						}
						// Comments (heartbeats) and id:/event:/retry: lines are
						// transport metadata; the backend's heartbeat records arrive as
						// data frames and pass through like any other.
					}
				}
			}
			emit({ streamId, kind: "end" });
		} catch (error) {
			if (signal.aborted) {
				emit({ streamId, kind: "end" });
				return;
			}
			// Deliberately generic: an exception string can carry the URL (and
			// with it, in a misconfigured future, a credential).
			emit({
				streamId,
				kind: "error",
				detail: transportFailureDetail(error),
			});
		}
	}

	unsubscribe(streamId: string): void {
		if (!/^[a-f0-9]{32}$/.test(streamId)) return;
		this.streams.get(streamId)?.abort();
		this.streams.delete(streamId);
	}

	dispose(): void {
		for (const controller of this.streams.values()) controller.abort();
		this.streams.clear();
	}
}
