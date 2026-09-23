/**
 * A scripted session OWNER, standing in for `local-operator serve` while the
 * refusal arms beside these frames are photographed.
 *
 * Why a script rather than a real backend. The fact under evidence is what the
 * COMPOSER does with a refusal the owner raises before admission - which arm
 * holds the text, which hands it back, which repeats the request - and reaching
 * that state on a real daemon means driving a live session's runtime into a
 * build drain or a busy probe. That is not reproducible twice in one evening, so
 * the owner's VERDICT is substituted at the HTTP boundary and everything on this
 * side of it is the shipping code (see `app.vite.mjs`: the transport, the store,
 * the composer).
 *
 * The arms are named for the wire shape they answer with, and each sentence is
 * the one the backend composes today:
 *
 *   retiring        first send   409 `runtime_retiring`, then admission
 *   busy-exhausted  sends 1-4    503 `runtime_busy` (+`retryable`,
 *                                `retry_after_ms`), then admission - four because
 *                                the app spends three of its own repeats
 *                                (`BUSY_RESENDS`) before the composer sees one
 *   busy-internal   sends 1-2    503 `runtime_busy`, then admission - the arm the
 *                                operator should never see at all, because the
 *                                app's own repeats land it
 *   unreachable     every send   503 `runtime_unreachable` - the CONTROL: a hop
 *                                failure whose ack may be the only thing lost, so
 *                                it must keep the held claim in both halves
 *
 * `retry_after_ms` is small (60 ms) on purpose: the point of the frame is the
 * state the composer lands in, not the pause, and a real 2 s pace would only add
 * wall time to a run whose assertions are about prose.
 *
 * The wire log is the second half of the evidence. Every message request is
 * appended with its `request_id` and the answer it got, so the claim "the repeat
 * carries the SAME identity" is a measurement rather than a reading of our own
 * code.
 */
import { appendFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.OWNER_REFUSAL_PORT ?? 8791);
const LOG = process.env.OWNER_REFUSAL_LOG ?? "/tmp/owner-refusal-wire.log";
const ARM = process.env.OWNER_REFUSAL_ARM ?? "retiring";

/** The backend's own sentences, quoted from `session/errors.py` and the
 * `runtime_busy`/`runtime_unreachable` bodies in `desktop-contract.ts`. */
const SENTENCE = {
	retiring:
		"This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted - send it again once the new build is up.",
	busy: "This session's owner is busy with another request. Retry in a moment.",
	unreachable:
		"Session owner is unavailable. Reconnect and reconcile before retrying.",
};

const ARMS = {
	retiring: {
		refusals: 1,
		status: 409,
		code: "runtime_retiring",
		sentence: SENTENCE.retiring,
	},
	"busy-exhausted": {
		refusals: 4,
		status: 503,
		code: "runtime_busy",
		sentence: SENTENCE.busy,
		retryAfterMs: 60,
	},
	"busy-internal": {
		refusals: 2,
		status: 503,
		code: "runtime_busy",
		sentence: SENTENCE.busy,
		retryAfterMs: 60,
	},
	unreachable: {
		refusals: Number.POSITIVE_INFINITY,
		status: 503,
		code: "runtime_unreachable",
		sentence: SENTENCE.unreachable,
	},
};

const arm = ARMS[ARM];
if (!arm) throw new Error(`unknown arm ${ARM}`);
let messages = 0;

const CAPABILITIES = {
	desktop_available: true,
	version: 2,
	// Every negotiated feature at its version, so the canonical chat surface is
	// reachable rather than gated behind the "update the backend" wall.
	features: {
		auth: 1,
		settings: 1,
		commands: 1,
		catalogues: 1,
		profile_catalogue: 1,
		team_catalogue: 1,
		session_catalogue: 2,
		lifecycle: 1,
		mcp: 1,
		radient: 1,
	},
};

createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const body = Buffer.concat(chunks);
	const path = (req.url ?? "").split("?")[0];
	let payload = null;
	try {
		payload = body.length ? JSON.parse(body.toString("utf-8")) : null;
	} catch {
		// unparseable body: the route below still answers, and the log says so
	}
	const json = (status, value) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(value));
	};

	if (path === "/v1/desktop/sessions" && req.method === "POST") {
		// A twelve-character LOWER-CASE HEX id, because that is what the closed
		// request schema accepts for `sessionId`: anything else makes the app refuse
		// its own message locally (422, before a socket opens) and the frame then
		// shows the schema's refusal instead of the owner's.
		json(200, { result: { session_id: "abc123def456", binding: null } });
		return;
	}
	if (path.endsWith("/messages") && req.method === "POST") {
		messages += 1;
		const refused = messages <= arm.refusals;
		appendFileSync(
			LOG,
			`${new Date().toISOString()} POST ${path} attempt=${messages} request_id=${payload?.request_id} -> ${
				refused ? `${arm.status} ${arm.code}` : "200 admitted"
			}\n`,
		);
		if (refused) {
			json(arm.status, {
				detail: {
					code: arm.code,
					message: arm.sentence,
					// The body the desktop contract documents for the two owner
					// refusals: `retryable` states that nothing was admitted, and
					// `retry_after_ms` is the pace the app repeats at.
					retryable: true,
					...(arm.retryAfterMs ? { retry_after_ms: arm.retryAfterMs } : {}),
				},
			});
			return;
		}
		json(200, {
			result: {
				status: "admitted",
				command_id: payload?.request_id,
				duplicate: false,
				detail: "prompt admitted",
			},
		});
		return;
	}
	if (path.endsWith("/events") && req.method === "GET") {
		/*
		 * THE SESSION STREAM, OPEN AND EMPTY.
		 *
		 * It exists so the pane can settle: a session panel leaves its loading
		 * skeleton when its stream is subscribed, and this owner has nothing to
		 * report about a session whose message it never admitted - which is exactly
		 * the state these frames show. A stream that refuses instead would put the
		 * panel's own reconnect copy into the frame and make the picture about this
		 * stub rather than about the composer.
		 */
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
		});
		const beat = setInterval(() => res.write(": keep-alive\n\n"), 5_000);
		req.on("close", () => {
			clearInterval(beat);
			res.end();
		});
		return;
	}
	if (path === "/v1/capabilities") {
		json(200, { result: CAPABILITIES });
		return;
	}
	if (path === "/v1/config") {
		// The shell reads `values.hosting` on mount and throws without it; an
		// empty sidebar keeps unrelated state out of the frames.
		json(200, {
			result: {
				values: {
					hosting: "openrouter",
					model_name: "anthropic/claude-sonnet-4",
					conversation_length: 100,
					detail_length: 35,
					auto_save_conversation: false,
				},
			},
		});
		return;
	}
	if (path === "/v1/desktop/profiles") {
		// The shape each catalogue read destructures: an empty object here is a
		// query that resolved to `undefined`, which paints a query error over the
		// surface these frames are about.
		json(200, { result: { profiles: [] } });
		return;
	}
	if (path === "/v1/desktop/teams") {
		json(200, { result: { teams: [] } });
		return;
	}
	if (path === "/v1/desktop/sessions" || path.endsWith("/history")) {
		json(200, { result: { sessions: [], records: [], total: 0 } });
		return;
	}
	json(200, { result: {} });
}).listen(PORT, "127.0.0.1", () => {
	process.stdout.write(`scripted owner "${ARM}" on http://127.0.0.1:${PORT}\n`);
});
