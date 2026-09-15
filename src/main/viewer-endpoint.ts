/**
 * The desktop app's viewer control endpoint: a loopback socket that lets
 * `lop resume-click` tell a running app "display session X and come forward".
 *
 * WHY A SOCKET AND NOT A DEEPLINK. The click handler is a short-lived process
 * macOS hands an activation, and it must find the app the user already has
 * open. A second launch cannot do that (the app refuses it by design —
 * `requestSingleInstanceLock`), a URL scheme would need a handler registration
 * the packaged app does not own, and AppleScript automation needs an
 * Accessibility grant nobody has granted. The viewer registry's whole design is
 * this socket plus a 0600 key under a 0700 directory, and routing already
 * prefers a live record, so implementing it here costs a listener and buys the
 * click its landing site.
 *
 * TWO OPS, AND DELIBERATELY NOT MORE. `resume_session` and `focus_window`, the
 * same two the TUI's endpoint serves, so one reader (`viewer_client.py`) speaks
 * to both surfaces and neither needs a protocol branch. The authorization story
 * is exactly one key, and it is sufficient *because* the surface is two ops a
 * user could perform with two keystrokes. Every op added is one a later reader
 * assumes was held to the same standard.
 *
 * The reader's own bounds govern the wire: a single `{"key": ...}` frame first
 * (anything wrong closes WITHOUT a reply — a port that answers bad keys with
 * errors is an oracle), then newline-delimited `{"op": ..., "req": n, ...}`
 * frames answered `{"op": "ack", "req": n, "detail": ...}` or
 * `{"op": "error", "req": n, "detail": ...}`. An unknown op is an ERROR frame
 * rather than a disconnect, because degrading against an older viewer is what
 * the reader already implements.
 */

import { timingSafeEqual } from "node:crypto";
import { type Server, type Socket, createServer } from "node:net";

/** The reader's own auth deadline, matched so neither side gives up first. */
const AUTH_TIMEOUT_MS = 5_000;

/** One control frame is a handful of fields; matches the backend's cap. */
const MAX_FRAME_BYTES = 64 * 1024;

/** A canonical session id, as the store addresses sessions. */
const SESSION_ID = /^[a-f0-9]{12}$/;

/**
 * What the endpoint needs from the app hosting it.
 *
 * Both are called OFF the app's own loop: this endpoint answers on its own
 * socket callbacks, so an implementation that must hop to the app (Electron
 * main is single-threaded but a switch can await a renderer round trip) is
 * expected to return a promise and is free to take as long as the reader's ack
 * timeout allows.
 */
export type ViewerEndpointHost = {
	/** Display `sessionId`, creating a window if none exists (B3). */
	resumeSession: (sessionId: string) => Promise<string> | string;
	/** Bring this app's window forward, as far as its window mode allows. */
	focusWindow: () => Promise<string> | string;
};

export class ViewerEndpoint {
	private server: Server | null = null;
	private port = 0;

	constructor(
		private readonly host: ViewerEndpointHost,
		private readonly key: string,
	) {}

	get boundPort(): number {
		return this.port;
	}

	/**
	 * Bind on loopback and answer the port.
	 *
	 * IDEMPOTENT, and that is load-bearing: a window can be recreated, and the
	 * app's own `activate` path runs again after every close. A second bind
	 * would leak a listener, and a leaked listener is worse than a leaked
	 * source because the record then advertises a port nothing reads.
	 */
	start(): Promise<number> {
		if (this.server) return Promise.resolve(this.port);
		return new Promise((resolve, reject) => {
			const server = createServer((socket) => this.onConnection(socket));
			server.on("error", reject);
			// Loopback only. The key authorizes, but binding to localhost means an
			// off-host attacker never reaches the auth check at all.
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (address === null || typeof address === "string") {
					server.close();
					reject(new Error("The viewer endpoint could not resolve its port."));
					return;
				}
				this.server = server;
				this.port = address.port;
				// The rejecting listener above is for the bind only; a later socket
				// error must not reach a settled promise.
				server.removeAllListeners("error");
				server.on("error", () => undefined);
				resolve(this.port);
			});
		});
	}

	/** Stop serving. Idempotent, and safe on a listener that never bound. */
	close(): void {
		const server = this.server;
		this.server = null;
		this.port = 0;
		if (!server) return;
		try {
			server.close();
		} catch {
			// A closed server is the ordinary case on a second call.
		}
	}

	private onConnection(socket: Socket): void {
		let authenticated = false;
		let buffer = "";
		let closed = false;
		/*
		 * Frames are dispatched ONE AT A TIME, in the order they arrived.
		 *
		 * Concurrent dispatch would let a `focus_window` overtake the
		 * `resume_session` behind it, and the reader's own contract says the switch
		 * comes first for a reason: raising the window before the switch shows the
		 * user the PREVIOUS conversation for as long as the switch takes. Replies
		 * are matched by `req` so the reader tolerates reordering, which is exactly
		 * why the order has to be enforced here rather than relied on.
		 */
		let chain: Promise<void> = Promise.resolve();
		const finish = () => {
			closed = true;
			socket.destroy();
		};
		const authTimer = setTimeout(() => {
			// A dialer that never presents a key must not hold a socket open.
			if (!authenticated) finish();
		}, AUTH_TIMEOUT_MS);

		socket.setEncoding("utf8");
		socket.on("error", finish);
		socket.on("close", () => clearTimeout(authTimer));
		socket.on("data", (chunk: string) => {
			if (closed) return;
			buffer += chunk;
			if (buffer.length > MAX_FRAME_BYTES) {
				// An oversized frame is a peer bug rather than an attack (the peer
				// already authenticated, or is about to and will be refused), and
				// closing is the answer that cannot be misread as a reply.
				finish();
				return;
			}
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) break;
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				chain = chain.then(() =>
					this.onLine(line, socket, {
						isAuthenticated: () => authenticated,
						markAuthenticated: () => {
							authenticated = true;
							clearTimeout(authTimer);
						},
						finish,
					}).catch(() => undefined),
				);
			}
		});
	}

	private async onLine(
		line: string,
		socket: Socket,
		state: {
			isAuthenticated: () => boolean;
			markAuthenticated: () => void;
			finish: () => void;
		},
	): Promise<void> {
		let frame: unknown;
		try {
			frame = JSON.parse(line);
		} catch {
			// Noise on a socket that is either authenticated or about to be
			// refused. Dropped rather than answered, because the reply protocol
			// is req-keyed and there is no req to answer.
			return;
		}
		if (typeof frame !== "object" || frame === null) return;
		const record = frame as Record<string, unknown>;

		if (!state.isAuthenticated()) {
			const key = typeof record.key === "string" ? record.key : "";
			if (!constantTimeEqual(key, this.key)) {
				// No reply, deliberately: an error frame here would make the port
				// an oracle for key guesses.
				state.finish();
				return;
			}
			state.markAuthenticated();
			return;
		}

		const op = typeof record.op === "string" ? record.op : "";
		const req = record.req;
		let reply: { op: string; req: unknown; detail: string };
		try {
			reply = { op: "ack", req, detail: await this.apply(op, record) };
		} catch (error) {
			// The error IS the answer, so an unknown op degrades to a refusal the
			// reader already handles rather than to a dropped connection.
			reply = {
				op: "error",
				req,
				detail: error instanceof Error ? error.message : "refused",
			};
		}
		try {
			socket.write(`${JSON.stringify(reply)}\n`);
		} catch {
			state.finish();
		}
	}

	private async apply(
		op: string,
		frame: Record<string, unknown>,
	): Promise<string> {
		if (op === "resume_session") {
			const sessionId = String(frame.session_id ?? "");
			// Validated here rather than at the far side: this id reaches the
			// renderer's navigation and the backend's route, and a scriptable
			// peer must not be able to address anything but a session.
			if (!SESSION_ID.test(sessionId)) {
				throw new Error("resume_session needs a session id");
			}
			return await this.host.resumeSession(sessionId);
		}
		if (op === "focus_window") {
			return await this.host.focusWindow();
		}
		throw new Error(`unknown viewer op: ${op || "(none)"}`);
	}
}

/**
 * Constant-time compare that still answers false for a length mismatch.
 *
 * `crypto.timingSafeEqual` throws on unequal lengths, and a thrown comparison
 * is not a comparison: it would turn "wrong key" into a crash the caller has to
 * catch. Length is leaked either way by the message framing, so the padding
 * below is about not throwing rather than about hiding a length.
 */
function constantTimeEqual(actual: string, expected: string): boolean {
	const a = Buffer.from(actual, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length) {
		// Compare a same-length buffer so the failure below costs the same as a
		// real mismatch instead of returning early on the length.
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}
