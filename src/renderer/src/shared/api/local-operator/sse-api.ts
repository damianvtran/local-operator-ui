/**
 * Server-Sent Events transport for streaming message updates.
 *
 * ## Why this exists
 *
 * Everything the renderer needs from a running turn is server-to-client. The
 * only frame the socket client ever sent upstream was a keepalive `ping`;
 * cancellation is already an HTTP call (`JobsApi.cancelJob`). So SSE costs no
 * capability and buys three things the socket cannot:
 *
 * - **Resume with a cursor.** `EventSource` reconnects on its own and replays
 *   `Last-Event-ID`, so a dropped connection continues at the exact event
 *   instead of restarting the render. The socket had no sequence at all.
 * - **Plain HTTP.** No upgrade handshake, so proxies, the Vite dev server and
 *   ordinary HTTP tooling all work without special handling.
 * - **A server-driven keepalive.** The backend sends a comment every 15s, so
 *   there is no client ping timer to get wrong.
 *
 * ## Why it is shaped like `WebSocketClient`
 *
 * This class deliberately mirrors `WebSocketClient`'s emitter surface -
 * `status`, `update:<messageId>`, `error`, plus `connect`/`disconnect`/
 * `getStatus` - so {@link useWebSocketMessage} can hold either one behind the
 * same reference and nothing above it changes. The rAF coalescing, the equality
 * gate, the global registry and the store all keep working untouched, which is
 * what makes the fallback in `streaming-transport.ts` transparent rather than a
 * second rendering path to maintain.
 *
 * ## Compatibility
 *
 * `record.update` and `record.complete` carry the legacy `CodeExecutionResult`
 * dump verbatim, including the `message_id` and `connection_type` keys the
 * socket injected. This client republishes that object unchanged as
 * `update:<messageId>`, so the consumer cannot tell which transport delivered
 * it. The richer events the socket bridge discarded (`message.delta`,
 * `tool.*`, `turn.*`) are emitted separately for anything that wants them, and
 * ignoring them costs nothing.
 */

import type { AgentExecutionRecord } from "./types";

/** Trailing slashes on a configured base URL would double up in every path. */
const TRAILING_SLASHES = /\/+$/;
import { EventEmitter, type WebSocketConnectionStatus } from "./websocket-api";

/**
 * The event names the backend publishes. Mirrors `EventName` in
 * `local_operator/server/utils/sse.py`; the SSE `event:` name and the inner
 * `data.type` always agree, so switching on either is valid.
 */
export const SseEventName = {
	Open: "stream.open",
	Gap: "stream.gap",
	Terminal: "stream.terminal",
	Error: "error",
	RecordUpdate: "record.update",
	RecordComplete: "record.complete",
	MessageDelta: "message.delta",
	ToolStart: "tool.start",
	ToolDelta: "tool.delta",
	ToolEnd: "tool.end",
	TurnStart: "turn.start",
	TurnEnd: "turn.end",
	AgentStart: "agent.start",
	AgentEnd: "agent.end",
	Notice: "notice",
	JobStatus: "job.status",
	Keepalive: "keepalive",
} as const;

/** Body of `stream.open`: what you attached to, and the state as of attach. */
export type SseOpenPayload = {
	type: string;
	seq?: number;
	channel: string;
	transport: string;
	last_seq: number;
	resumed: boolean;
	snapshot: AgentExecutionRecord[];
	snapshot_count: number;
};

/** Body of a record frame. `record` is the legacy socket data frame verbatim. */
export type SseRecordPayload = {
	type: string;
	seq: number;
	channel: string;
	record: AgentExecutionRecord & {
		message_id: string;
		connection_type: string;
	};
	message_id: string;
	job_id?: string;
};

/** Body of `stream.gap`: frames were lost and the client must reconcile. */
export type SseGapPayload = {
	type: string;
	reason: "overflow" | "evicted" | string;
	reconcile: boolean;
	dropped?: number;
	expected_seq?: number;
};

export type SseClientOptions = {
	/** Reconnect hint passed through to the URL; the server also sends `retry:`. */
	autoReconnect?: boolean;
	/** Give up after this many consecutive failed opens. */
	maxReconnectAttempts?: number;
	/**
	 * Milliseconds of silence tolerated before the stream is treated as dead.
	 * The server heartbeats every 15s, so anything comfortably above that
	 * distinguishes "quiet turn" from "connection black-holed" - a case the
	 * socket client could not detect at all.
	 */
	stallTimeout?: number;
	/**
	 * Milliseconds to wait for the first open before treating the connection as
	 * black-holed (a proxy buffering the whole response, including headers - the
	 * exact failure the fallback exists for). The socket client has
	 * `connectionTimeout` for this; SSE needs the equivalent or `connect()` can
	 * hang with the stall timer never armed (review C-03).
	 */
	openTimeout?: number;
};

const DEFAULT_OPTIONS: Required<SseClientOptions> = {
	autoReconnect: true,
	maxReconnectAttempts: 5,
	stallTimeout: 45000,
	openTimeout: 8000,
};

/** Channel kinds. Prefer `job` for new work; see the note on `messageId`. */
export type SseChannelKind = "message" | "job";

/**
 * Streams one channel over SSE, presenting the same surface as
 * `WebSocketClient`.
 */
export class SseClient extends EventEmitter {
	private source: EventSource | null = null;
	private readonly baseUrl: string;
	private readonly channelId: string;
	private readonly channelKind: SseChannelKind;
	private readonly options: Required<SseClientOptions>;
	private status: WebSocketConnectionStatus = "disconnected";
	private failedOpens = 0;
	/**
	 * Highest sequence seen. `EventSource` sends `Last-Event-ID` itself, so this
	 * is only needed when a *manual* reconnect has to rebuild the URL - and as
	 * the signal that the stream produced something before it broke, which is
	 * what distinguishes "SSE is unusable here" from "the connection blipped".
	 */
	private lastSeq: number | null = null;
	private stallTimerId: number | null = null;
	private closedByServer = false;
	/** Set once the socket has opened; the open-timeout only fires before this. */
	private opened = false;
	private openTimerId: number | null = null;

	/**
	 * @param baseUrl - Base URL of the Local Operator API.
	 * @param channelId - Record id for a `message` channel, job id for a `job`
	 *   channel. The record id is only knowable after the turn starts producing,
	 *   which is the race the job channel exists to remove.
	 * @param options - Connection options.
	 * @param channelKind - Which channel namespace `channelId` belongs to.
	 */
	constructor(
		baseUrl: string,
		channelId: string,
		options: SseClientOptions = {},
		channelKind: SseChannelKind = "message",
	) {
		super();
		this.baseUrl = baseUrl.replace(TRAILING_SLASHES, "");
		this.channelId = channelId;
		this.channelKind = channelKind;
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	public getStatus(): WebSocketConnectionStatus {
		return this.status;
	}

	/**
	 * Highest sequence observed, or null if nothing arrived yet. A non-null
	 * value is the proof the transport selector needs that SSE demonstrably
	 * works on this connection, so a later failure is a blip to retry rather
	 * than a reason to fall back to the socket.
	 */
	public getLastSequence(): number | null {
		return this.lastSeq;
	}

	private url(): string {
		const path =
			this.channelKind === "job"
				? `/v1/sse/jobs/${encodeURIComponent(this.channelId)}`
				: `/v1/sse/messages/${encodeURIComponent(this.channelId)}`;
		// A manual reopen cannot set headers, so the cursor rides the query
		// string. The backend takes whichever of the two is furthest forward.
		const cursor = this.lastSeq !== null ? `?after_seq=${this.lastSeq}` : "";
		return `${this.baseUrl}${path}${cursor}`;
	}

	private setStatus(next: WebSocketConnectionStatus): void {
		if (this.status === next) return;
		this.status = next;
		this.emit("status", next);
	}

	/**
	 * A silent stream is a broken stream. The server heartbeats on a fixed
	 * interval, so absence of traffic past the tolerance means the connection is
	 * black-holed - typically a proxy that buffered it - and we should surface
	 * that rather than spin forever showing a live indicator.
	 */
	private armStallTimer(): void {
		this.clearStallTimer();
		this.stallTimerId = window.setTimeout(() => {
			this.emit(
				"error",
				new Error(
					`SSE stream stalled: no traffic for ${this.options.stallTimeout}ms`,
				),
			);
			this.setStatus("error");
			this.emit("stalled");
		}, this.options.stallTimeout);
	}

	private clearStallTimer(): void {
		if (this.stallTimerId !== null) {
			window.clearTimeout(this.stallTimerId);
			this.stallTimerId = null;
		}
	}

	private clearOpenTimer(): void {
		if (this.openTimerId !== null) {
			window.clearTimeout(this.openTimerId);
			this.openTimerId = null;
		}
	}

	public async connect(): Promise<void> {
		if (this.source) return;
		this.closedByServer = false;
		this.opened = false;
		this.setStatus("connecting");

		return new Promise<void>((resolve) => {
			let settled = false;
			const settle = () => {
				if (!settled) {
					settled = true;
					resolve();
				}
			};

			const source = new EventSource(this.url());
			this.source = source;

			// A proxy can hold the entire response (headers included), in which
			// case neither onopen nor onerror fires and the stall timer is never
			// armed. Bound the first open so that case degrades to the fallback
			// instead of hanging in `connecting` (review C-03).
			this.openTimerId = window.setTimeout(() => {
				if (this.opened) return;
				this.teardown();
				this.setStatus("error");
				this.emit(
					"error",
					new Error(`SSE open timed out after ${this.options.openTimeout}ms`),
				);
				settle();
			}, this.options.openTimeout);

			source.onopen = () => {
				this.opened = true;
				this.clearOpenTimer();
				this.failedOpens = 0;
				this.setStatus("connected");
				this.armStallTimer();
				settle();
			};

			source.onerror = () => {
				this.clearStallTimer();
				// A server-sent terminal frame closes the stream on purpose;
				// EventSource reports that as an error, which it is not.
				if (this.closedByServer) {
					this.teardown();
					this.setStatus("disconnected");
					settle();
					return;
				}
				// `CONNECTING` means EventSource is retrying by itself, which is
				// the behaviour we want; anything else is terminal for this source.
				if (source.readyState === EventSource.CONNECTING) {
					this.failedOpens += 1;
					if (
						!this.options.autoReconnect ||
						this.failedOpens > this.options.maxReconnectAttempts
					) {
						this.teardown();
						this.setStatus("failed");
						this.emit(
							"error",
							new Error(
								`SSE reconnect gave up after ${this.failedOpens} attempts`,
							),
						);
						settle();
						return;
					}
					this.setStatus("reconnecting");
					settle();
					return;
				}
				this.teardown();
				this.setStatus("error");
				this.emit("error", new Error("SSE connection closed unexpectedly"));
				settle();
			};

			// Named handlers rather than one `onmessage`: the backend always sets
			// `event:`, and binding by name keeps unknown future events from
			// being mistaken for records.
			source.addEventListener(SseEventName.Open, (event) => {
				this.armStallTimer();
				const payload = this.parse<SseOpenPayload>(event);
				if (!payload) return;
				this.lastSeq = payload.last_seq > 0 ? payload.last_seq : this.lastSeq;
				this.emit("open", payload);
				// Repainting from the snapshot is what makes a reconnect - and a
				// reported gap - self-healing: the records below are current
				// state, not history, so the reducer converges without a refetch.
				for (const record of payload.snapshot ?? []) {
					this.emitRecord(record as SseRecordPayload["record"]);
				}
				settle();
			});

			const onRecord = (event: MessageEvent) => {
				this.armStallTimer();
				const payload = this.parse<SseRecordPayload>(event);
				if (!payload?.record) return;
				this.noteSeq(event);
				this.emitRecord(payload.record);
			};
			source.addEventListener(SseEventName.RecordUpdate, onRecord);
			source.addEventListener(SseEventName.RecordComplete, onRecord);

			source.addEventListener(SseEventName.Terminal, (event) => {
				this.noteSeq(event);
				// The server has said there is nothing more. Closing here is what
				// stops a finished turn from holding a connection open - the socket
				// never closed on completion and left the client to infer it.
				this.closedByServer = true;
				this.clearStallTimer();
				this.emit("terminal", this.parse(event));
				this.teardown();
				this.setStatus("disconnected");
				settle();
			});

			source.addEventListener(SseEventName.Gap, (event) => {
				const payload = this.parse<SseGapPayload>(event);
				// Surfaced rather than swallowed: a consumer that knows it missed
				// frames can reconcile over REST, while one that does not renders
				// a hole forever. The snapshot on the next open usually repairs it
				// anyway, so this is a signal, not a failure.
				this.emit("gap", payload);
			});

			source.addEventListener(SseEventName.Error, (event) => {
				const payload = this.parse<{ error?: string; retryable?: boolean }>(
					event,
				);
				this.emit(
					"error",
					new Error(payload?.error ?? "SSE stream reported an error"),
				);
			});

			// Additive richer events. Forwarded by name so a consumer can opt in;
			// nothing in the current renderer requires them.
			for (const name of [
				SseEventName.MessageDelta,
				SseEventName.ToolStart,
				SseEventName.ToolDelta,
				SseEventName.ToolEnd,
				SseEventName.TurnStart,
				SseEventName.TurnEnd,
				SseEventName.AgentStart,
				SseEventName.AgentEnd,
				SseEventName.Notice,
				SseEventName.JobStatus,
			]) {
				source.addEventListener(name, (event) => {
					this.armStallTimer();
					this.noteSeq(event);
					this.emit(name, this.parse(event));
				});
			}

			// The liveness tick. It is a real event (not a comment) precisely so
			// this handler fires and re-arms the stall detector; a healthy quiet
			// turn must not read as a dead connection (review C-01).
			source.addEventListener(SseEventName.Keepalive, () => {
				this.armStallTimer();
			});
		});
	}

	/**
	 * Republish a record under the same event name and shape the socket used, so
	 * a consumer cannot tell the transports apart.
	 */
	private emitRecord(record: SseRecordPayload["record"]): void {
		const id = record.message_id ?? record.id;
		this.emit(`update:${id}`, record);
		// Also emit under the channel id: for a job channel the record ids differ
		// from the channel, and a consumer keyed on what it subscribed to would
		// otherwise never hear anything.
		if (id !== this.channelId) {
			this.emit(`update:${this.channelId}`, record);
		}
	}

	private noteSeq(event: MessageEvent): void {
		const raw = event.lastEventId;
		if (!raw) return;
		const seq = Number.parseInt(raw, 10);
		if (Number.isFinite(seq)) {
			this.lastSeq = seq;
		}
	}

	private parse<T>(event: Event): T | null {
		const data = (event as MessageEvent).data;
		if (typeof data !== "string") return null;
		try {
			return JSON.parse(data) as T;
		} catch {
			// Parity with the socket path, which only logs a bad frame: a parse
			// quirk must not flip the consumer into a visible error state (C-06).
			console.error("[sse] frame was not valid JSON");
			return null;
		}
	}

	private teardown(): void {
		this.clearStallTimer();
		this.clearOpenTimer();
		if (this.source) {
			this.source.close();
			this.source = null;
		}
	}

	public disconnect(): void {
		this.teardown();
		this.setStatus("disconnected");
	}
}
