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
 * THE BODIES ARE CAPTURED, NOT INVENTED, and they are captured from the real
 * ladder rather than from a literal. `capture-bodies.py` beside this file mounts
 * `server/routes/desktop_sessions.py::errors` (the ladder every desktop control
 * route runs inside) in a throwaway FastAPI app and raises each refusal inside
 * it, so the status, the JSON body and the headers below are what the shipping
 * backend composes. Against backend `origin/main` = `5bc34c90` (0.62.14):
 *
 *   409 `{"detail": "This session is switching to a newer build; the one it
 *       loaded is gone from disk. The message was not admitted - send it again
 *       once the new build is up."}`
 *       a STRING detail. `RuntimeRetiring` is a `ValueError` that does not
 *       qualify for the ladder's coded arm (attachment, profile registry,
 *       superseded token, deletion refused), so it falls to
 *       `raise HTTPException(409, str(error))` and carries NO `code` - which is
 *       why this arm lands in the HELD state in both halves: without a code the
 *       app cannot know it was not admitted. The coded body is the backend half
 *       of this change (design of record section 6 B2) and is not on the wire
 *       yet; the app's answer to the coded shape is pinned in
 *       `scripts/canonical-chat.test.mjs` instead of in a frame.
 *   503 `{"detail": {"code": "runtime_busy", "message": "Session owner is
 *       unavailable. Reconnect and reconcile before retrying.", "retryable":
 *       true, "retry_after_ms": 2000}}` with `Retry-After: 2`
 *       The message is the unchanged `RUNTIME_UNREACHABLE_MESSAGE` on purpose
 *       (the backend will not move user-visible text for apps that have not
 *       updated), which is why the arm's copy is that sentence and not a
 *       busy-flavoured one.
 *   503 `{"detail": {"code": "runtime_unreachable", "message": "Session owner is
 *       unavailable. Reconnect and reconcile before retrying."}}`
 *
 * The arms are named for the wire shape they answer with:
 *
 *   retiring        first send   409 string detail (no code), then admission
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
 * `retry_after_ms` is the backend's own 2000 ms rather than a shortened stand-in:
 * the pause IS part of what the operator experiences on this arm (the composer is
 * disabled while the app's repeats are in flight), so the frames are taken at
 * shipped pacing.
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

/** The backend's own sentences, quoted from the capture named in the header and
 * from `session/errors.py::RuntimeRetiring`. The em dash in the retiring
 * sentence is the backend's, not a rendering of one. */
const SENTENCE = {
	retiring:
		"This session is switching to a newer build; the one it loaded is gone from disk. The message was not admitted \u2014 send it again once the new build is up.",
	busy: "Session owner is unavailable. Reconnect and reconcile before retrying.",
	unreachable:
		"Session owner is unavailable. Reconnect and reconcile before retrying.",
};

/** Whether the arm's body is the coded one. Only `busy` and `unreachable` are
 * today: a retiring refusal arrives as a plain string `detail`. */
const CODED = new Set(["busy-exhausted", "busy-internal", "unreachable"]);

const ARMS = {
	retiring: {
		refusals: 1,
		status: 409,
		// The log line still names the refusal the operator met; the BODY is a
		// string, and the difference is the whole point of this arm.
		code: "runtime_retiring (string detail, no code)",
		sentence: SENTENCE.retiring,
	},
	"busy-exhausted": {
		refusals: 4,
		status: 503,
		code: "runtime_busy",
		sentence: SENTENCE.busy,
		retryAfterMs: 2000,
	},
	"busy-internal": {
		refusals: 2,
		status: 503,
		code: "runtime_busy",
		sentence: SENTENCE.busy,
		retryAfterMs: 2000,
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
			// TWO SHAPES, both captured: a coded body (the ladder's
			// `{"code", "message"}` arm) and a plain string `detail`
			// (`raise HTTPException(409, str(error))`). `retryable` and
			// `retry_after_ms` ride only where the capture found them.
			const headers = arm.retryAfterMs
				? {
						"Content-Type": "application/json",
						"Retry-After": String(Math.max(1, arm.retryAfterMs / 1000)),
					}
				: { "Content-Type": "application/json" };
			res.writeHead(arm.status, headers);
			res.end(
				JSON.stringify(
					CODED.has(ARM)
						? {
							detail: {
								code: arm.code,
								message: arm.sentence,
								...(arm.retryAfterMs
									? {
											// The captured body sets this on the busy arm only,
											// and it means "the same request may be resent" - it
											// is NOT a statement that anything was admitted.
											retryable: true,
											retry_after_ms: arm.retryAfterMs,
										}
									: {}),
							},
						}
						: { detail: arm.sentence },
				),
			);
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
