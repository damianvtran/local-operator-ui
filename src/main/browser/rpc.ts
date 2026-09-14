import {
	type IncomingMessage,
	type Server,
	type ServerResponse,
	createServer,
} from "node:http";
import { BrowserHostError, errorData } from "./errors";
import {
	ERROR_CODES,
	type ErrorCode,
	type HealthBody,
	PROTO_VERSION,
	type Response,
	isMethod,
} from "./protocol";
import { keysMatch } from "./state-file";

/**
 * The loopback RPC endpoint. Design: docs/design/ui-browser-tab.md 3(a), 10.1,
 * 11.7 (the trust boundary), and the wire shapes in `protocol.ts`.
 *
 * WHAT THIS IS: the app's first inbound network surface. `local-operator-ui`
 * now answers the SAME session-leg envelope the browser-extension bridge's
 * daemon answers, so the Python session client is reused unchanged — it reads a
 * different state file and POSTs to a different port, and nothing else about it
 * moves. That is the whole reason this is preferred over exposing CDP (rejected)
 * or attaching to the daemon as a second host role (rejected).
 *
 * THE FOUR RULES THAT MAKE IT SAFE, all enforced here rather than documented:
 *
 * 1. Bind `127.0.0.1`, never `0.0.0.0` and never IPv6-any. A browser-driving
 *    endpoint on a LAN interface is a remote-control surface for the agent's
 *    authenticated sessions.
 * 2. Require the key header on EVERY request, compare it in constant time, and
 *    answer 401 otherwise — never a partial response. The 0600 state file is the
 *    only place the key exists, so a local process that cannot read that file
 *    cannot use this endpoint.
 * 3. Send NO CORS headers, deliberately and as a load-bearing decision. The
 *    app's own renderer runs with `webSecurity: true`, so a `fetch` from the
 *    app's page to this port fails its preflight when no
 *    `Access-Control-Allow-Origin` comes back. That is the mechanism that keeps
 *    a page inside the app from driving the agent's browser, and it must not be
 *    "fixed" by adding a header.
 * 4. Expose no CDP. The `webContents.debugger` handle stays in the main process;
 *    this endpoint speaks only the `Request`/`Response` vocabulary.
 */

/** The one path that answers a command. Anything else is 404 — including `/`,
 * which keeps a stray browser or scanner from getting a helpful response. */
export const RPC_PATH = "/rpc";

/** The liveness probe a STALE state file is acquitted by (design 10.2). */
export const HEALTH_PATH = "/health";

/** The header the session client already sends. The name is the bridge's
 * (`X-Bridge-Key`, `backend.py:357-361`): reusing it is what makes the Python
 * transport a drop-in rather than a fork. */
export const KEY_HEADER = "x-bridge-key";

/** Largest body accepted. The envelope is small (a method, an id, params); a
 * body past this is a mistake or an attack, and buffering it is the mistake. */
export const MAX_BODY_BYTES = 1 << 20;

/** The one address this listener may bind (design 11.7, rule 1). Named rather
 * than spelled at the call site so the rule has a single home, and returned to
 * the caller so a test can assert the address the OS actually resolved instead
 * of re-reading the source line. */
export const LOOPBACK_HOST = "127.0.0.1";

export type RpcDispatcher = (
	method: string,
	params: Record<string, unknown>,
	requestId: string,
) => Promise<Record<string, unknown>>;

export interface RpcServerOptions {
	key: string;
	dispatch: RpcDispatcher;
	/** Called for anything worth putting in the app log. */
	log?: (message: string) => void;
}

export interface RpcServer {
	/** The address the socket is bound to, as the OS resolved it. Rule 1 is that
	 * this is `127.0.0.1` — a `0.0.0.0` bind turns this into a remote-control
	 * surface for the operator's authenticated jar — so it is published here for
	 * the unit suite and the proof to assert, rather than being a property only a
	 * reader of this file can vouch for (R3). */
	readonly address: string;
	readonly port: number;
	close(): Promise<void>;
}

function send(
	res: ServerResponse,
	status: number,
	body: unknown,
	contentType = "application/json",
): void {
	// The ONE place headers are written, so "no CORS headers" is a property of
	// this function rather than an absence a reviewer has to verify by reading
	// every branch. `Cache-Control: no-store` keeps a keyed response out of any
	// disk cache along the way.
	res.writeHead(status, {
		"Content-Type": contentType,
		"Cache-Control": "no-store",
	});
	res.end(typeof body === "string" ? body : JSON.stringify(body));
}

/** Read the body, bounded. A body over the cap is refused rather than buffered:
 * an unbounded read on an endpoint any local process can reach is how a
 * main-process OOM happens. */
function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** A `Response` error arm for a typed failure, with the code narrowed to one the
 * session client knows.
 *
 * WHY the narrowing exists: an unknown `ErrorCode` fails the session's own model
 * validation, which SILENTLY DROPS the frame — the command then hangs until it
 * times out, which is strictly worse than an `internal` the client understands.
 * So an unexpected value becomes `internal`, and the original is carried in
 * `data` where it is still legible in a log. */
function errorResponse(id: string, error: unknown): Response {
	if (error instanceof BrowserHostError) {
		const known = (ERROR_CODES as readonly string[]).includes(error.code);
		return {
			id,
			ok: false,
			error: {
				code: (known ? error.code : "internal") as ErrorCode,
				message: known
					? error.message
					: `${error.message} (unmapped code: ${error.code})`,
				data: errorData(error),
			},
		};
	}
	return {
		id,
		ok: false,
		error: {
			code: "internal",
			message: error instanceof Error ? error.message : String(error),
			data: {},
		},
	};
}

/**
 * Validate and dispatch one envelope.
 *
 * `extra="forbid"` semantics (the Python model's setting): an envelope with a
 * field this host does not know is REFUSED rather than ignored, so a version skew
 * fails at the boundary instead of having half its intent silently dropped.
 */
export function validateRequest(raw: unknown): {
	id: string;
	method: string;
	params: Record<string, unknown>;
} {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new BrowserHostError(
			"internal",
			"request envelope must be an object",
		);
	}
	const envelope = raw as Record<string, unknown>;
	for (const key of Object.keys(envelope)) {
		if (key !== "id" && key !== "method" && key !== "params") {
			throw new BrowserHostError("internal", `unknown envelope field '${key}'`);
		}
	}
	if (typeof envelope.id !== "string" || !envelope.id) {
		throw new BrowserHostError(
			"internal",
			"request envelope needs a string id",
		);
	}
	if (!isMethod(envelope.method)) {
		throw new BrowserHostError(
			"internal",
			`unknown method '${String(envelope.method)}'`,
		);
	}
	const params = envelope.params ?? {};
	if (typeof params !== "object" || params === null || Array.isArray(params)) {
		throw new BrowserHostError("internal", "params must be an object");
	}
	return {
		id: envelope.id,
		method: envelope.method,
		params: params as Record<string, unknown>,
	};
}

export async function startRpcServer(
	options: RpcServerOptions,
): Promise<RpcServer> {
	const server: Server = createServer((req, res) => {
		void handle(req, res, options);
	});

	const bound = await new Promise<{ address: string; port: number }>(
		(resolve, reject) => {
			server.once("error", reject);
			// 127.0.0.1 explicitly, and port 0 for an ephemeral port. The daemon's
			// fixed 4099 exists because the extension cannot read files; neither this
			// host nor Python has that limitation, so the port is read from the state
			// file and collisions with 4099 disappear (design 10.1).
			server.listen(0, LOOPBACK_HOST, () => {
				const address = server.address();
				if (address && typeof address === "object") {
					resolve({ address: address.address, port: address.port });
				} else reject(new Error("loopback listener has no port"));
			});
		},
	);

	return {
		address: bound.address,
		port: bound.port,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
				// `close()` waits for keep-alive connections; the session client uses
				// none, but a stale one must not delay app quit.
				server.closeAllConnections?.();
			}),
	};
}

async function handle(
	req: IncomingMessage,
	res: ServerResponse,
	options: RpcServerOptions,
): Promise<void> {
	const url = req.url ?? "";
	try {
		if (req.method === "GET" && url.split("?")[0] === HEALTH_PATH) {
			// `/health` is deliberately UNKEYED: its caller is Python deciding
			// whether a stale state file's port has been recycled, and it answers
			// only facts that identify this process (pid, proto) — never anything
			// readable from the jar. It still requires no CORS header, so a page
			// cannot even read the pid.
			const body: HealthBody = {
				host: "ui",
				proto: PROTO_VERSION,
				pid: process.pid,
			};
			send(res, 200, body);
			return;
		}
		if (req.method !== "POST" || url.split("?")[0] !== RPC_PATH) {
			send(res, 404, { detail: "not found" });
			return;
		}
		const presented = req.headers[KEY_HEADER];
		if (
			!keysMatch(
				Array.isArray(presented) ? presented[0] : presented,
				options.key,
			)
		) {
			// No detail beyond the status: a 401 that explains itself is a probe
			// oracle (wrong length vs wrong key), and there is nothing the caller
			// can do with the distinction.
			send(res, 401, { detail: "unauthorized" });
			return;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(await readBody(req));
		} catch {
			send(res, 422, { detail: "malformed request body" });
			return;
		}
		let request: {
			id: string;
			method: string;
			params: Record<string, unknown>;
		};
		try {
			request = validateRequest(raw);
		} catch (error) {
			// A malformed ENVELOPE is the caller's mistake, not a command failure,
			// so it is a transport status rather than a `Response` error arm. An
			// empty id is the honest answer here: there is no id to echo.
			send(res, 422, {
				detail: error instanceof Error ? error.message : "invalid envelope",
			});
			return;
		}
		let response: Response;
		try {
			const result = await options.dispatch(
				request.method,
				request.params,
				request.id,
			);
			response = { id: request.id, ok: true, result };
		} catch (error) {
			response = errorResponse(request.id, error);
		}
		send(res, 200, response);
	} catch (error) {
		options.log?.(
			`[browser] rpc handler failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		if (!res.headersSent) {
			send(res, 500, { detail: "internal error" });
		} else {
			res.end();
		}
	}
}
