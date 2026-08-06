/**
 * Transport selection: prefer SSE, fall back to WebSockets, decide once.
 *
 * ## The problem this solves
 *
 * A given renderer build may face a backend that predates the SSE surface, and
 * a given backend may sit behind a proxy that breaks `text/event-stream` even
 * though the route exists. Those are different failures and both must degrade to
 * the socket without the consumer noticing:
 *
 * - **Backend too old** — `GET /v1/sse/capabilities` 404s. Detected once per
 *   backend URL and cached, so the probe costs one request per session rather
 *   than one per streamed message.
 * - **Transport broken in transit** — capabilities answered, but the stream
 *   never delivers a frame (a buffering proxy, a blocked EventSource). Detected
 *   per connection: if the first attempt produces no frame, this falls back to a
 *   socket for that message and remembers the failure so subsequent messages in
 *   the session skip the doomed attempt.
 *
 * Both clients expose the same emitter surface (`status`, `update:<id>`,
 * `error`, plus `connect`/`disconnect`/`getStatus`), so the wrapper below is a
 * router, not an adapter — there is no second rendering path to maintain.
 *
 * ## Why the failure is remembered rather than retried per message
 *
 * The renderer opens one client per streaming message. Retrying a transport that
 * has already proven broken would add a stall to the start of every message the
 * user sends, which is worse than using the working transport immediately.
 * `resetTransportCache()` exists so a settings change or a reconnect to a
 * different backend can re-probe.
 */

import {
	type SseChannelKind,
	SseClient,
	type SseClientOptions,
} from "./sse-api";
import {
	EventEmitter,
	WebSocketClient,
	type WebSocketConnectionOptions,
	type WebSocketConnectionStatus,
	WebsocketConnectionType,
} from "./websocket-api";

/** Trailing slashes on a configured base URL would double up in every path. */
const TRAILING_SLASHES = /\/+$/;

/** What a backend said it supports. */
export type StreamingCapabilities = {
	transports: string[];
	preferred: string;
	sse?: {
		version: number;
		channels: Record<string, string>;
		resume: {
			last_event_id: boolean;
			query_param: string;
			replay_buffer: number;
		};
		heartbeat_interval_s: number;
		retry_hint_ms: number;
		events: string[];
		legacy_record_frames: boolean;
	};
	websocket?: { channels: Record<string, string>; deprecated?: boolean };
};

/** Which transport a client ended up using, for diagnostics and tests. */
export type StreamingTransportKind = "sse" | "websocket";

type ProbeState = {
	/** Resolved capabilities, or null when the backend has no SSE surface. */
	capabilities: StreamingCapabilities | null;
	/** Set once SSE was tried and produced nothing usable on this backend. */
	sseProvenBroken: boolean;
};

const probes = new Map<string, Promise<ProbeState>>();
const states = new Map<string, ProbeState>();

/** Probe timeout. Long enough for a cold local backend, short enough that a
 *  hung probe does not delay the first render behind it. */
const PROBE_TIMEOUT_MS = 2500;

/**
 * Ask a backend what it supports, once per base URL.
 *
 * A 404 is the expected answer from an older backend and is not an error; any
 * other failure is treated the same way, because the only safe interpretation of
 * "cannot determine" is "use the transport that has always existed".
 */
export const probeStreamingCapabilities = (
	baseUrl: string,
): Promise<ProbeState> => {
	const key = baseUrl.replace(TRAILING_SLASHES, "");
	const existing = probes.get(key);
	if (existing) return existing;

	const probe = (async (): Promise<ProbeState> => {
		const controller = new AbortController();
		const timeoutId = window.setTimeout(
			() => controller.abort(),
			PROBE_TIMEOUT_MS,
		);
		try {
			const response = await fetch(`${key}/v1/sse/capabilities`, {
				signal: controller.signal,
			});
			if (!response.ok) {
				return { capabilities: null, sseProvenBroken: false };
			}
			const capabilities = (await response.json()) as StreamingCapabilities;
			const supported = capabilities?.transports?.includes("sse") ?? false;
			return {
				capabilities: supported ? capabilities : null,
				sseProvenBroken: false,
			};
		} catch {
			return { capabilities: null, sseProvenBroken: false };
		} finally {
			window.clearTimeout(timeoutId);
		}
	})();

	probes.set(key, probe);
	probe.then((state) => states.set(key, state)).catch(() => undefined);
	return probe;
};

/**
 * Forget what we learned about a backend.
 *
 * Needed when the API URL changes or a backend restarts with a different build:
 * a cached "no SSE here" would otherwise outlive the condition that caused it.
 */
export const resetTransportCache = (baseUrl?: string): void => {
	if (baseUrl) {
		const key = baseUrl.replace(TRAILING_SLASHES, "");
		probes.delete(key);
		states.delete(key);
		return;
	}
	probes.clear();
	states.clear();
};

export type StreamingClientOptions = {
	/** Passed to whichever transport is chosen. */
	websocket?: WebSocketConnectionOptions;
	sse?: SseClientOptions;
	/** Channel namespace for SSE. The socket only has message channels. */
	channelKind?: SseChannelKind;
	/** Force a transport, bypassing the probe. For tests and diagnostics. */
	force?: StreamingTransportKind;
};

/**
 * One streaming connection, routed to whichever transport works.
 *
 * Listeners attached before {@link connect} are re-attached to the transport
 * actually chosen — including across a mid-flight fallback — so a consumer
 * subscribes once and never learns which transport delivered its events.
 */
export class StreamingClient extends EventEmitter {
	private readonly baseUrl: string;
	private readonly channelId: string;
	private readonly options: StreamingClientOptions;
	private active: SseClient | WebSocketClient | null = null;
	private kind: StreamingTransportKind | null = null;
	private disposed = false;
	/** True once any frame arrived, so a later error is a blip, not a verdict. */
	private delivered = false;

	constructor(
		baseUrl: string,
		channelId: string,
		options: StreamingClientOptions = {},
	) {
		super();
		this.baseUrl = baseUrl.replace(TRAILING_SLASHES, "");
		this.channelId = channelId;
		this.options = options;
	}

	/** Which transport is in use, or null before the first connect. */
	public getTransport(): StreamingTransportKind | null {
		return this.kind;
	}

	public getStatus(): WebSocketConnectionStatus {
		return this.active?.getStatus() ?? "disconnected";
	}

	public async connect(): Promise<void> {
		if (this.disposed || this.active) return;

		const forced = this.options.force;
		let useSse = forced === "sse";
		if (!forced) {
			const state = await probeStreamingCapabilities(this.baseUrl);
			useSse = state.capabilities !== null && !state.sseProvenBroken;
		}

		if (useSse) {
			await this.startSse();
			return;
		}
		await this.startWebSocket();
	}

	private async startSse(): Promise<void> {
		const client = new SseClient(
			this.baseUrl,
			this.channelId,
			this.options.sse,
			this.options.channelKind ?? "message",
		);
		this.active = client;
		this.kind = "sse";
		this.bind(client);

		// A stream that opens and then goes silent is the proxy-buffering case.
		// Treat it as "SSE does not work here" exactly once, then switch - but
		// only if nothing was ever delivered, because a mid-turn blip on a
		// working stream should reconnect, not change transport.
		client.on("stalled", () => {
			if (!this.delivered)
				void this.fallback("stream stalled before any frame");
		});
		client.on("status", (next: unknown) => {
			if ((next === "failed" || next === "error") && !this.delivered) {
				void this.fallback(`sse status became ${String(next)}`);
			}
		});

		await client.connect();
	}

	private async startWebSocket(): Promise<void> {
		const client = new WebSocketClient(
			this.baseUrl,
			this.channelId,
			this.options.websocket,
			WebsocketConnectionType.MESSAGE,
		);
		this.active = client;
		this.kind = "websocket";
		this.bind(client);
		await client.connect();
	}

	/**
	 * Re-emit everything the active transport produces.
	 *
	 * A wildcard forward is not available on this emitter, so the event names are
	 * listed. `update:<channelId>` is the one the renderer consumes; the rest are
	 * forwarded so diagnostics and future consumers see the same stream on either
	 * transport.
	 */
	private bind(client: SseClient | WebSocketClient): void {
		const forwarded = [
			"status",
			"error",
			`update:${this.channelId}`,
			"open",
			"terminal",
			"gap",
			"message.delta",
			"tool.start",
			"tool.delta",
			"tool.end",
			"turn.start",
			"turn.end",
			"agent.start",
			"agent.end",
			"notice",
			"job.status",
		];
		for (const name of forwarded) {
			client.on(name, (...args: unknown[]) => {
				if (name === `update:${this.channelId}`) {
					this.delivered = true;
				}
				this.emit(name, ...args);
			});
		}
	}

	/**
	 * Abandon SSE for the socket, once, and remember it for this backend.
	 *
	 * Deliberately silent to the consumer beyond a status change: a transport
	 * downgrade is an infrastructure detail, and surfacing it as an error would
	 * make a recoverable condition look like a failed turn.
	 */
	private async fallback(reason: string): Promise<void> {
		if (this.disposed || this.kind !== "sse") return;
		const key = this.baseUrl;
		const state = states.get(key);
		if (state) {
			state.sseProvenBroken = true;
		} else {
			states.set(key, { capabilities: null, sseProvenBroken: true });
			probes.set(
				key,
				Promise.resolve({ capabilities: null, sseProvenBroken: true }),
			);
		}
		console.warn(`[streaming] falling back to websocket: ${reason}`);

		if (this.active) {
			this.active.removeAllListeners();
			this.active.disconnect();
			this.active = null;
		}
		this.kind = null;
		await this.startWebSocket();
	}

	public disconnect(): void {
		this.disposed = true;
		if (this.active) {
			this.active.removeAllListeners();
			this.active.disconnect();
			this.active = null;
		}
	}
}
