import type { Meta, StoryObj } from "@storybook/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	StreamingClient,
	type StreamingTransportKind,
	resetTransportCache,
} from "../../../shared/api/local-operator/streaming-transport";
import "../../../styles/index.css";

/**
 * Transport fixture — SSE, resume, and the WebSocket fallback, no backend.
 *
 * Only the network is fake. A scripted `EventSource` stand-in replays the exact
 * frames the backend emits (`stream.open` with a folded snapshot, `record.*`,
 * `message.delta`, `stream.terminal`) through the real `StreamingClient`, so
 * what these buttons prove is what the app does.
 *
 * Three behaviours are visible here, and each is something the socket could not
 * do:
 *
 * - **Stream over SSE.** Records arrive under `update:<id>` in the legacy socket
 *   shape, so every consumer above the transport is unchanged.
 * - **Resume after a drop.** The reconnect carries `after_seq`, and the reopened
 *   stream continues at the next sequence rather than replaying the turn. The
 *   socket had no sequence at all and simply lost whatever arrived while away.
 * - **Fall back.** With no `/v1/sse/capabilities` (an older backend) or a stream
 *   that opens and then goes silent (a buffering proxy), the client switches to
 *   the WebSocket and the consumer never learns it happened.
 */

const MESSAGE_ID = "fixture-sse-message";
const BASE_URL = "http://fixture.invalid";

type Frame = { name: string; id?: number; data: unknown };

/** The frame script, in the shape and order the backend actually emits. */
const buildFrames = (): Frame[] => {
	const record = (message: string, complete: boolean) => ({
		id: MESSAGE_ID,
		message,
		code: "",
		stdout: "",
		stderr: "",
		logging: "",
		content: "",
		formatted_print: "",
		role: "assistant",
		status: complete ? "success" : "in_progress",
		timestamp: new Date().toISOString(),
		files: [],
		execution_type: "response",
		task_classification: "conversation",
		is_complete: complete,
		is_streamable: true,
		message_id: MESSAGE_ID,
		connection_type: "message",
	});

	const words = ["Streaming", " over", " SSE", " with", " resume."];
	const frames: Frame[] = [
		{
			name: "stream.open",
			data: {
				type: "stream.open",
				channel: `message:${MESSAGE_ID}`,
				transport: "sse",
				last_seq: 0,
				resumed: false,
				snapshot: [],
				snapshot_count: 0,
			},
		},
	];
	let text = "";
	let seq = 0;
	for (const word of words) {
		text += word;
		seq += 1;
		frames.push({
			name: "message.delta",
			id: seq,
			data: { type: "message.delta", seq, delta: word, message_id: MESSAGE_ID },
		});
		seq += 1;
		frames.push({
			name: "record.update",
			id: seq,
			data: {
				type: "record.update",
				seq,
				record: record(text, false),
				message_id: MESSAGE_ID,
			},
		});
	}
	seq += 1;
	frames.push({
		name: "record.complete",
		id: seq,
		data: {
			type: "record.complete",
			seq,
			record: record(text, true),
			message_id: MESSAGE_ID,
		},
	});
	seq += 1;
	frames.push({
		name: "stream.terminal",
		id: seq,
		data: { type: "stream.terminal", seq, status: "complete" },
	});
	return frames;
};

type FakeMode = "stream" | "drop-midway" | "silent";

/**
 * Scripted `EventSource`. Faithful about the parts the client depends on:
 * named events, `lastEventId`, `readyState`, `onopen`/`onerror`, and the
 * `CONNECTING` state that distinguishes a deliberate close from a failure.
 */
class FakeEventSource {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;
	static mode: FakeMode = "stream";
	static urls: string[] = [];

	readyState = FakeEventSource.CONNECTING;
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	private readonly listeners = new Map<
		string,
		Array<(event: { data: string; lastEventId: string }) => void>
	>();
	private timers: number[] = [];
	private closed = false;

	constructor(readonly url: string) {
		FakeEventSource.urls.push(url);
		this.timers.push(
			window.setTimeout(() => {
				if (this.closed) return;
				this.readyState = FakeEventSource.OPEN;
				this.onopen?.();
				if (FakeEventSource.mode !== "silent") this.play();
			}, 10),
		);
	}

	addEventListener(
		name: string,
		fn: (event: { data: string; lastEventId: string }) => void,
	): void {
		const existing = this.listeners.get(name);
		if (existing) existing.push(fn);
		else this.listeners.set(name, [fn]);
	}

	private play(): void {
		// A reconnect carries `after_seq`; honouring it is what makes the resume
		// visible - the reopened stream sends only what follows the cursor.
		const cursor = Number.parseInt(
			new URL(this.url, "http://x").searchParams.get("after_seq") ?? "0",
			10,
		);
		const frames = buildFrames().filter(
			(frame) => frame.id === undefined || frame.id > cursor,
		);
		const cut =
			FakeEventSource.mode === "drop-midway"
				? Math.ceil(frames.length / 2)
				: frames.length;

		frames.slice(0, cut).forEach((frame, index) => {
			this.timers.push(
				window.setTimeout(
					() => {
						if (this.closed) return;
						for (const fn of this.listeners.get(frame.name) ?? []) {
							fn({
								data: JSON.stringify(frame.data),
								lastEventId: frame.id ? String(frame.id) : "",
							});
						}
					},
					60 + index * 70,
				),
			);
		});

		if (FakeEventSource.mode === "drop-midway") {
			this.timers.push(
				window.setTimeout(
					() => {
						if (this.closed) return;
						// Spec behaviour for a dropped connection: stay CONNECTING so
						// the client treats it as retryable.
						this.readyState = FakeEventSource.CONNECTING;
						this.onerror?.();
					},
					60 + cut * 70,
				),
			);
		}
	}

	close(): void {
		this.closed = true;
		this.readyState = FakeEventSource.CLOSED;
		for (const timer of this.timers) window.clearTimeout(timer);
		this.timers = [];
	}
}

/** Minimal socket stand-in, so the fallback path has something to land on. */
class FakeSocket {
	static instances: FakeSocket[] = [];
	readyState = 1;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(readonly url: string) {
		FakeSocket.instances.push(this);
		window.setTimeout(() => this.onopen?.(), 5);
	}
	send(): void {}
	close(): void {
		this.readyState = 3;
		this.onclose?.();
	}
}

/**
 * Swap the network globals. `EventSource` and `WebSocket` are read-only per
 * their DOM types, so they go through `defineProperty`; `fetch` decides what the
 * capability probe sees, which is what selects the transport.
 */
const installFakes = (sseAvailable: boolean): (() => void) => {
	const originalEventSource = window.EventSource;
	const originalSocket = window.WebSocket;
	const originalFetch = window.fetch;

	Object.defineProperty(window, "EventSource", {
		value: FakeEventSource,
		configurable: true,
	});
	Object.defineProperty(window, "WebSocket", {
		value: FakeSocket,
		configurable: true,
	});
	window.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes("/v1/sse/capabilities")) {
			// A backend without the SSE surface answers 404 - that 404 is the
			// entire fallback signal, not an error to report.
			if (!sseAvailable) return new Response("", { status: 404 });
			return new Response(
				JSON.stringify({
					transports: ["sse", "websocket"],
					preferred: "sse",
					sse: {
						version: 1,
						channels: {},
						resume: {
							last_event_id: true,
							query_param: "after_seq",
							replay_buffer: 256,
						},
						heartbeat_interval_s: 15,
						retry_hint_ms: 1000,
						events: [],
						legacy_record_frames: true,
					},
					websocket: { channels: {}, deprecated: true },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("{}", { status: 200 });
	}) as typeof window.fetch;

	return () => {
		Object.defineProperty(window, "EventSource", {
			value: originalEventSource,
			configurable: true,
		});
		Object.defineProperty(window, "WebSocket", {
			value: originalSocket,
			configurable: true,
		});
		window.fetch = originalFetch;
	};
};

type Observed = {
	transport: StreamingTransportKind | null;
	text: string;
	complete: boolean;
	events: string[];
	urls: string[];
};

const TransportFixture = () => {
	const [observed, setObserved] = useState<Observed>({
		transport: null,
		text: "",
		complete: false,
		events: [],
		urls: [],
	});
	const clientRef = useRef<StreamingClient | null>(null);

	const stop = useCallback(() => {
		clientRef.current?.disconnect();
		clientRef.current = null;
	}, []);

	useEffect(() => stop, [stop]);

	const run = useCallback(
		async (mode: FakeMode, sseAvailable: boolean) => {
			stop();
			const restore = installFakes(sseAvailable);
			FakeEventSource.mode = mode;
			FakeEventSource.urls = [];
			resetTransportCache();
			setObserved({
				transport: null,
				text: "",
				complete: false,
				events: [],
				urls: [],
			});

			const client = new StreamingClient(BASE_URL, MESSAGE_ID, {
				sse: { stallTimeout: 600, maxReconnectAttempts: 1 },
			});
			clientRef.current = client;

			const seen: string[] = [];
			client.on("status", (status) => {
				seen.push(`status:${String(status)}`);
			});
			client.on("message.delta", () => seen.push("message.delta"));
			client.on("terminal", () => seen.push("terminal"));
			client.on(`update:${MESSAGE_ID}`, (update) => {
				const record = update as { message?: string; is_complete?: boolean };
				setObserved((previous) => ({
					...previous,
					text: record.message ?? previous.text,
					complete: record.is_complete ?? previous.complete,
				}));
			});

			await client.connect();
			setObserved((previous) => ({
				...previous,
				transport: client.getTransport(),
			}));

			window.setTimeout(() => {
				setObserved((previous) => ({
					...previous,
					events: [...seen],
					urls: [...FakeEventSource.urls],
					transport: client.getTransport(),
				}));
				restore();
			}, 2200);
		},
		[stop],
	);

	return (
		<div className="flex flex-col gap-4 p-6 text-sm">
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					className="rounded border px-3 py-1"
					onClick={() => void run("stream", true)}
				>
					Stream over SSE
				</button>
				<button
					type="button"
					className="rounded border px-3 py-1"
					onClick={() => void run("drop-midway", true)}
				>
					Drop mid-stream, then resume
				</button>
				<button
					type="button"
					className="rounded border px-3 py-1"
					onClick={() => void run("stream", false)}
				>
					Old backend, no SSE
				</button>
				<button
					type="button"
					className="rounded border px-3 py-1"
					onClick={() => void run("silent", true)}
				>
					SSE advertised but silent
				</button>
			</div>

			<dl className="grid grid-cols-[10rem_1fr] gap-1">
				<dt>transport</dt>
				<dd data-testid="transport">{observed.transport ?? "—"}</dd>
				<dt>complete</dt>
				<dd data-testid="complete">{String(observed.complete)}</dd>
				<dt>message</dt>
				<dd data-testid="message">{observed.text || "—"}</dd>
				<dt>stream urls</dt>
				<dd data-testid="urls">
					{observed.urls.length ? (
						<ul>
							{observed.urls.map((url) => (
								<li key={url}>{url.replace(BASE_URL, "")}</li>
							))}
						</ul>
					) : (
						"—"
					)}
				</dd>
				<dt>events</dt>
				<dd data-testid="events">{observed.events.join(", ") || "—"}</dd>
			</dl>
		</div>
	);
};

const meta = {
	title: "Chat/SSE transport",
	component: TransportFixture,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TransportFixture>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Press each button in turn.
 *
 * - *Stream over SSE* — transport `sse`, the message fills in, `complete` true,
 *   one stream URL with no cursor.
 * - *Drop mid-stream, then resume* — two stream URLs, the second carrying
 *   `?after_seq=<n>`, and the message still completes.
 * - *Old backend, no SSE* — transport `websocket`, no stream URL at all.
 * - *SSE advertised but silent* — opens, produces nothing, and the stall
 *   detector switches to `websocket`.
 */
export const Fixture: Story = {};
