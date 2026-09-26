/**
 * THE CREATE TAP: a one-hop delay in front of a throwaway backend, for the
 * conversation-start frames.
 *
 * WHY IT EXISTS. The press frame (T1) is the state the operator reported as dead
 * air: the user has pressed Enter, the message is on the conversation, and
 * `sessions.create` has not answered yet. On a warm local backend that window is
 * a few milliseconds and no capture can land inside it; the design asks for "a
 * stubbed slow create or a cold backend", and this is the first: one route is
 * delayed, everything else is passed through byte-for-byte.
 *
 * WHAT IT DELAYS, exactly. `POST /v1/desktop/sessions` - the route
 * `sessions.create` maps to (`src/shared/desktop-contract.ts`), NOT the
 * `sessions.draft` mint beside it, so the pane's keystroke mint, its warm and its
 * stream are untouched and only the press's own hop is slowed.
 *
 * WHAT IT DELAYS FOR. `CREATE_DELAY_MS` (default 2500, the design's "past 2 s").
 * The delay is a property of the RUN, not of the scene: the scene captures on a
 * timer while this holds the answer, and the flip frame is the same press's later
 * moment.
 *
 * IT LOGS EVERY REQUEST it forwards (method, path, timestamp) to
 * `TAP_LOG` when that is set, which is the wire record beside the frames: one
 * create and one message per press is a claim the scene makes about the wire, and
 * this is the wire.
 *
 * Usage:
 *   TAP_TARGET=http://127.0.0.1:7392 CREATE_DELAY_MS=2500 TAP_LOG=/path/wire.log \
 *     node docs/evidence/conversation-start/harness/create-tap.mjs
 * (listens on TAP_PORT, default 7391)
 */
import { appendFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";

const PORT = Number(process.env.TAP_PORT ?? 7391);
const TARGET = new URL(process.env.TAP_TARGET ?? "http://127.0.0.1:7392");
const DELAY_MS = Number(process.env.CREATE_DELAY_MS ?? 2500);
const LOG = process.env.TAP_LOG ?? null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(line) {
	if (!LOG) return;
	appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
}

/**
 * How many message POSTs the tap should refuse, armed through its control door.
 *
 * WHY THE TAP OWNS THIS ARM. The failure frame is a POST-PAINT failure: the row
 * exists, the owner refuses the message after it, and the sentence belongs to the
 * row. Raising it at the wire - rather than by staging a DOM state - is what
 * makes the frame a picture of the app's real path, and the tap is already the
 * wire's one seam in this rig.
 */
let failMessages = 0;

/**
 * How long the tap should hold the next message POSTs, armed through the same
 * control door.
 *
 * The switch-away frame needs a send that is genuinely IN FLIGHT while the run
 * leaves and comes back; holding the message POST is what keeps it so, and the
 * hold is a delay in front of the forwarding rather than a response (the same
 * shape the create hold below uses, for the same reason).
 */
let holdMessages = { count: 0, ms: 0 };

/** The owner's own captured body for a hop failure, from `stub-owner.mjs`'s set. */
const UNREACHABLE_BODY = {
	detail: {
		code: "runtime_unreachable",
		message:
			"Session owner is unavailable. Reconnect and reconcile before retrying.",
	},
};

const server = createServer((req, res) => {
	/*
	 * THE CONTROL DOOR, before anything is proxied: `POST /__tap/fail-messages`
	 * with `{"count": n}` arms the arm for the next n message POSTs. It lives on
	 * the tap's own namespace so no app route can reach it by accident.
	 */
	if (req.method === "POST" && req.url === "/__tap/hold-messages") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			try {
				const parsed = JSON.parse(body);
				holdMessages = {
					count: Math.max(0, Number(parsed.count) || 0),
					ms: Math.max(0, Number(parsed.ms) || 0),
				};
			} catch {
				holdMessages = { count: 0, ms: 0 };
			}
			log(
				`POST /__tap/hold-messages <- armed ${holdMessages.count} at ${holdMessages.ms}ms`,
			);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(holdMessages));
		});
		return;
	}
	if (req.method === "POST" && req.url === "/__tap/fail-messages") {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			let count = 1;
			try {
				count = Number(JSON.parse(body).count) || 0;
			} catch {
				/* a malformed body arms nothing rather than guessing */
			}
			failMessages = Math.max(0, count);
			log(`POST /__tap/fail-messages <- armed ${failMessages}`);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ armed: failMessages }));
		});
		return;
	}
	const isMessage =
		req.method === "POST" && /^\/v1\/desktop\/sessions\/[^/]+\/messages$/.test(req.url);
	if (isMessage && failMessages > 0) {
		failMessages -= 1;
		log(`POST ${req.url} <- answered 503 runtime_unreachable (tap arm)`);
		res.writeHead(503, { "content-type": "application/json" });
		res.end(JSON.stringify(UNREACHABLE_BODY));
		return;
	}
	const isCreate = req.method === "POST" && req.url === "/v1/desktop/sessions";
	const holdThisMessage = isMessage && holdMessages.count > 0;
	if (holdThisMessage)
		holdMessages = { count: holdMessages.count - 1, ms: holdMessages.ms };
	log(
		`${req.method} ${req.url}${isCreate ? ` <- held ${DELAY_MS}ms` : ""}${holdThisMessage ? ` <- held ${holdMessages.ms}ms (message hold)` : ""}`,
	);

	const proxy = httpRequest(
		{
			hostname: TARGET.hostname,
			port: TARGET.port,
			path: req.url,
			method: req.method,
			headers: req.headers,
		},
		(upstream) => {
			res.writeHead(upstream.statusCode ?? 502, upstream.headers);
			// Piped, not buffered: the session event streams are SSE and must not
			// be waited on.
			upstream.pipe(res);
		},
	);
	proxy.on("error", (error) => {
		log(`upstream error: ${error.message}`);
		res.writeHead(502);
		res.end();
	});
	/*
	 * The hold. It delays the request's FORWARDING, which is what makes the create
	 * itself slow; nothing is buffered beyond the request body's own few hundred
	 * bytes, and the response streams back as soon as the backend answers.
	 */
	if (isCreate) setTimeout(() => req.pipe(proxy), DELAY_MS);
	else if (holdThisMessage)
		setTimeout(() => req.pipe(proxy), holdMessages.ms || 4000);
	else req.pipe(proxy);
});

server.listen(PORT, "127.0.0.1", () => {
	log(`tap listening on 127.0.0.1:${PORT} -> ${TARGET.origin} (create held ${DELAY_MS}ms)`);
	console.log(
		`create-tap: 127.0.0.1:${PORT} -> ${TARGET.origin}, POST /v1/desktop/sessions held ${DELAY_MS}ms${LOG ? `, log ${LOG}` : ""}`,
	);
});
