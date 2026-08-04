import type { Meta, StoryObj } from "@storybook/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	getStreamingRegistryStats,
	terminateStreamingMessages,
} from "../../../shared/hooks/use-streaming-message";
import "../../../styles/index.css";
import { StreamingMessage } from "./message-item/streaming-message";

/**
 * Lifecycle fixture — the streaming path exercised end to end without a backend.
 *
 * The websocket is the only thing that is fake: a scripted fake socket replays
 * cumulative frames — the exact protocol shape the backend uses, where every
 * frame carries the whole record — through the real client, the real hook
 * chain and the real store. Two buttons demonstrate the two regressions this
 * ticket fixes:
 *
 * - **Unmount message** after a stream. The registry entry count must return
 *   to zero — the old code kept one full record per streamed message for the
 *   whole session, because its deletion was gated on a flag the only call site
 *   always passed as false.
 * - **Cancel the job** mid-stream. Calls `terminateStreamingMessages` exactly
 *   the way the chat page's stop button now does; the stream settles, the
 *   socket closes, and no reconnect loop re-arms every 1600ms against a job
 *   that no longer exists.
 */

const FRAME_COUNT = 40;
const CONVERSATION_ID = "fixture-conversation";
const MESSAGE_ID = "fixture-message";

type FrameRecord = {
	id: string;
	code: string;
	stdout: string;
	stderr: string;
	logging: string;
	message: string;
	formatted_print: string;
	role: string;
	status: string;
	timestamp: string;
	files: string[];
	execution_type: string;
	task_classification: string;
	is_complete: boolean;
	is_streamable: boolean;
};

const buildBaseRecord = (): FrameRecord => ({
	id: MESSAGE_ID,
	code: "",
	stdout: "",
	stderr: "",
	logging: "",
	message: "",
	formatted_print: "",
	role: "assistant",
	status: "success",
	timestamp: new Date().toISOString(),
	files: [],
	execution_type: "response",
	task_classification: "conversation",
	is_complete: false,
	is_streamable: true,
});

/**
 * Quacks like the browser WebSocket closely enough for `WebSocketClient`:
 * it opens, sends a `connection_established` handshake, then emits update
 * frames carrying the whole accumulated record each time — the cumulative
 * protocol the real backend uses.
 */
class FakeSocket {
	static instances: FakeSocket[] = [];

	readonly url: string;
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;

	private timer: ReturnType<typeof setTimeout> | null = null;
	private frameIndex = 0;
	private text = "";

	constructor(url: string) {
		this.url = url;
		FakeSocket.instances.push(this);
		// A real WebSocket opens by itself; the client never calls `connect()`.
		// Defer the handshake past the current task so the client has attached
		// its handlers first, exactly like a network round-trip.
		setTimeout(() => {
			this.readyState = 1;
			this.onopen?.();
			this.onmessage?.({
				data: JSON.stringify({ type: "connection_established" }),
			});
			this.scheduleNext();
		}, 0);
	}

	private scheduleNext() {
		this.timer = setTimeout(() => this.emitNext(), 40);
	}

	private emitNext() {
		if (this.readyState !== 1 || this.frameIndex >= FRAME_COUNT) return;

		this.frameIndex += 1;
		this.text += `Word ${this.frameIndex} is appended to the growing answer. `;

		this.onmessage?.({
			data: JSON.stringify({
				...buildBaseRecord(),
				message: this.text,
				is_complete: false,
				type: "update",
				message_id: MESSAGE_ID,
			}),
		});
		this.scheduleNext();
	}

	finishNow() {
		if (this.readyState !== 1) return;
		this.frameIndex = FRAME_COUNT;
		this.onmessage?.({
			data: JSON.stringify({
				...buildBaseRecord(),
				message: this.text,
				is_complete: true,
				type: "update",
				message_id: MESSAGE_ID,
			}),
		});
	}

	send(): void {}

	close() {
		this.readyState = 3;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.onclose?.();
	}
}

const installFakeSocket = () => {
	const original = window.WebSocket;
	// `window.WebSocket` is read-only per its DOM type, so swap it through
	// defineProperty. The runtime client code only constructs and listens — it
	// never calls any method the fake lacks.
	Object.defineProperty(window, "WebSocket", {
		value: FakeSocket,
		configurable: true,
	});
	return () => {
		Object.defineProperty(window, "WebSocket", {
			value: original,
			configurable: true,
		});
	};
};

type LogLine = { at: string; text: string };

const LifecycleProbe = () => {
	const [log, setLog] = useState<LogLine[]>([]);
	const [mounted, setMounted] = useState(false);
	const restoreRef = useRef<(() => void) | null>(null);

	const record = useCallback((text: string) => {
		setLog((previous) => [
			...previous,
			{ at: new Date().toISOString().slice(11, 23), text },
		]);
	}, []);

	useEffect(() => {
		FakeSocket.instances = [];
		restoreRef.current = installFakeSocket();
		setMounted(true);
		record("fixture mounted; fake socket installed");

		return () => {
			restoreRef.current?.();
			FakeSocket.instances = [];
		};
	}, [record]);

	// Watch the registry from outside, the way the leak manifests: entries
	// whose records are no longer needed but never go away.
	useEffect(() => {
		const interval = setInterval(() => {
			const { size, entries } = getStreamingRegistryStats();
			const detail = entries.map((entry) => entry.messageId).join(", ");
			const text = `registry entries: ${size}${detail ? ` (${detail})` : ""}`;
			setLog((previous) => {
				const last = previous[previous.length - 1];
				return last?.text === text
					? previous
					: [...previous, { at: new Date().toISOString().slice(11, 23), text }];
			});
		}, 400);
		return () => clearInterval(interval);
	}, []);

	const completeNow = () => {
		record("asking the fake socket to complete the stream");
		for (const socket of FakeSocket.instances) socket.finishNow();
	};

	const cancelNow = () => {
		record("cancelling the job (as the stop button does)");
		const terminated = terminateStreamingMessages(CONVERSATION_ID);
		record(`terminateStreamingMessages returned ${JSON.stringify(terminated)}`);
	};

	const unmountNow = () => {
		record("unmounting the streaming message");
		setMounted(false);
	};

	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="text-body-sm">
				{mounted ? (
					<StreamingMessage
						messageId={MESSAGE_ID}
						conversationId={CONVERSATION_ID}
					/>
				) : (
					<p className="text-ink-muted">streaming message unmounted</p>
				)}
			</div>
			<div className="flex flex-wrap gap-2">
				<button
					type="button"
					onClick={completeNow}
					className="rounded-sm bg-accent px-3 py-1.5 text-body-sm text-on-accent"
				>
					Complete the stream now
				</button>
				<button
					type="button"
					onClick={cancelNow}
					className="rounded-sm border border-danger-border bg-danger-wash px-3 py-1.5 text-body-sm text-ink"
				>
					Cancel the job
				</button>
				<button
					type="button"
					onClick={unmountNow}
					className="rounded-sm border border-control px-3 py-1.5 text-body-sm text-ink-muted"
				>
					Unmount message
				</button>
			</div>
			<pre
				id="fixture-log"
				className="max-h-64 overflow-auto rounded-sm bg-sunken p-3 text-mono-sm"
			>
				{log.map((line) => `${line.at}  ${line.text}`).join("\n")}
			</pre>
		</div>
	);
};

const meta: Meta<typeof LifecycleProbe> = {
	title: "Chat/Streaming lifecycle",
	component: LifecycleProbe,
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj<typeof LifecycleProbe>;

/** Full lifecycle: stream, complete, unmount — registry must end empty. */
export const StreamToCompletion: Story = {};

/** Cancel mid-stream — the store completes, the socket closes, no reconnect loop. */
export const CancelMidStream: Story = {};
