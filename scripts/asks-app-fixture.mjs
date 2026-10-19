import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
/* Loopback HTTP fixture for the PRODUCTION desktop transport. Nothing replaces
 * window.api, React, ChatLayout, store writers or native browser IPC. The wire
 * envelope follows shared/desktop-{contract,session-contract}; requests and
 * forbidden writes are retained so fixture traffic cannot masquerade as a turn.
 */
import { createServer } from "node:http";
import { join } from "node:path";

export const ASK_SESSION_IDS = ["fa1107000001", "fa1107000002"];
/*
 * THE FIXTURE'S MODES.
 *
 * `claimless` and `slow` model the RESUMED-conversation startup the operator's
 * "Asks unavailable" screenshot came from: the durable checkpoint carries no ask
 * claim (the backend strips `asks`/`asks_open` from the saved copy and the resumed
 * session republishes them from the ask log on its first refresh), while the
 * index-backed aggregate can answer immediately. `slow` adds a 1.5 s delay to the
 * aggregate so an app rig can hold the loading state and photograph it.
 *
 * `unsupported` is the OTHER resolved reading: the aggregate route answers 404 (a
 * backend that predates it), so the drawer must say the runtime does not support
 * queued asks. `error` stays the transient 503 the connection-error case uses;
 * the two must not be conflated (`fleet-asks.ts`'s capability split).
 */
const MODES = [
	"populated",
	"empty",
	"loading",
	"error",
	"claimless",
	"slow",
	"unsupported",
];
const CLAIMLESS_MODES = new Set(["claimless", "slow", "unsupported"]);
export function askFixture(now = Date.now()) {
	return {
		ask_id: "ci-ask",
		session_id: ASK_SESSION_IDS[0],
		status: "open",
		created_at: now,
		expires_at: now + 3600000,
		timeout_s: 3600,
		delivered: false,
		urgent: false,
		questions: [
			{
				id: "environment",
				question: "Synthetic CI: which environment?",
				multi_select: false,
				allow_other: true,
				recommended: 0,
				options: [
					{ label: "Staging", description: "Synthetic, never submitted" },
				],
			},
		],
	};
}
export function sessionSnapshot(id, ask, sequence = 1, claimless = false) {
	const index = ASK_SESSION_IDS.indexOf(id);
	const askless = index !== 0 || !ask;
	/*
	 * THE WIRE SHAPE, NOT THE STORED ONE (review R1-5). The checkpoint stores
	 * None, but the serializer POPS the null ask fields
	 * (`frontend_state.py:3548-3558`), so a claimless snapshot OMITS all three
	 * keys; a present-null frame is not a frame the app ever receives.
	 *
	 * THE ASKLESS CASE IS THE FIXTURE'S OWN SPELLING, not the wire's: it carries
	 * `asks: []` + `asks_open: 0` because that is the value this fixture has
	 * always modelled, and every reader treats it like the live-but-empty frame.
	 * The WIRE's live-but-empty shape is `asks` ABSENT with `asks_open: 0`
	 * (`ask-queue.ts`'s WIRE FIX note); changing this value is not necessary for
	 * the cases here and is deliberately left alone (review R2-1).
	 */
	const askClaim = askless
		? { asks: [], asks_open: 0, asks_truncated: false }
		: claimless
			? {}
			: { asks: [ask], asks_open: 1, asks_truncated: false };
	const frontend = {
		state_version: 1,
		session_id: id,
		epoch: "ci-asks",
		sequence,
		cwd: "/synthetic/ci",
		conversation_title: `Synthetic CI session ${index + 1}`,
		conversation_title_user_set: true,
		conversation_title_forked: false,
		goal: "",
		active_agent: "",
		active_team: "",
		selected_model: null,
		effective_model: null,
		streaming: false,
		generation: 0,
		pending_gate: null,
		...askClaim,
		history_cursor: null,
		live_events: [],
		queued_steering: [],
		jobs: [],
		todos: [],
		wakes: [],
		monitors: [],
		mcp_servers: [],
		tools: [],
		context: {},
		usage: {},
		accounting: {},
		subagents: [],
		awaiting_input: false,
	};
	return {
		session_id: id,
		epoch: "ci-asks",
		seq: sequence,
		type: "snapshot",
		payload: {
			frontend: {
				state_version: 1,
				snapshot: frontend,
				epoch: "ci-asks",
				sequence,
				live_cursor: null,
			},
			cold: true,
			cold_reason: "no-runtime",
			attaching: false,
			history: {
				entries: [],
				has_more: false,
				cursor_missing: false,
				next_cursor: null,
			},
		},
	};
}
export async function startAsksAppFixture({ root, port = 8080, token }) {
	if (!token || !root)
		throw new Error("Explicit isolated root and synthetic token required");
	const requests = [];
	const streams = new Set();
	const sockets = new Set();
	const instance = randomUUID();
	const now = Date.now();
	const ask = askFixture(now);
	let mode = "populated";
	let sequence = 1;
	const identity = {
		pid: process.pid,
		instance_id: instance,
		version: "0.73.1",
		prefix: root,
		install_kind: "uv-tool",
	};
	const sessions = ASK_SESSION_IDS.map((id, i) => ({
		id,
		name: `Synthetic CI session ${i + 1}`,
		mtime: now / 1000,
		created_at: now / 1000,
		preview: "Synthetic CI fixture",
		live_state: "idle",
		pending: null,
		active: false,
		pinned: false,
		asks_open: i === 0 ? 1 : 0,
		cwd: "/synthetic/ci",
		status: { code: "idle", label: "Idle" },
	}));
	/*
	 * The Radient operations this scene's own reads reach, and the synthetic answer
	 * each gets. Their shapes are the wire envelopes the renderer's Radient clients
	 * unwrap - `{msg, result}` inside the desktop result - so the app parses them
	 * exactly as it would parse the real control plane's.
	 *
	 * The set is deliberately this narrow: the fixture models the reads the asks
	 * scene performs (the model picker's quota notice) and refuses every other
	 * operation by name, so a new caller is visible as a named refusal rather than
	 * as an accidental pass. No operation here writes anything upstream.
	 */
	const READ_RADIENT_OPERATIONS = new Set(["quota.notice"]);
	const radientReadResult = (operation) => {
		if (operation === "quota.notice")
			return {
				provider: "radient",
				state: "ok",
				credit_balance: 2500,
				credit_limit: 5000,
				reset_at: 1_800_000_000,
				signup_resent_at: null,
			};
		throw new Error(`no synthetic radient answer for ${operation}`);
	};

	const envelope = (result) => ({
		status: 200,
		message: "Synthetic desktop result.",
		result,
	});
	function sendSnapshot(res, id) {
		const claimless = CLAIMLESS_MODES.has(mode);
		res.write(
			`data: ${JSON.stringify(sessionSnapshot(id, mode === "empty" ? null : ask, sequence, claimless))}\n\n`,
		);
	}
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		const path = url.pathname;
		requests.push({
			method: req.method,
			path,
			authenticated: req.headers.authorization === `Bearer ${token}`,
		});
		const json = (body, status = 200) => {
			res.writeHead(status, { "Content-Type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (path === "/health") return json(envelope(identity));
		if (path === "/qa-native-page") {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				"<!doctype html><title>Owned CI page</title><body style='background:#df2dc3'>Owned fixture, no remote navigation</body>",
			);
			return;
		}
		if (path === "/v1/capabilities")
			return json(
				envelope({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					language: "en",
					features: { session_catalogue: 2, queued_asks: 1 },
				}),
			);
		if (req.headers.authorization !== `Bearer ${token}`)
			return json({ detail: "Unauthorized synthetic fixture" }, 401);
		if (req.method === "POST" && path === "/__fixture/state") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const next = JSON.parse(Buffer.concat(chunks).toString()).mode;
			if (!MODES.includes(next))
				return json({ detail: "Bad fixture mode" }, 422);
			mode = next;
			sequence++;
			for (const stream of streams) {
				if (mode === "error") stream.res.end();
				else if (mode !== "loading") sendSnapshot(stream.res, stream.id);
			}
			return json(envelope({ mode }));
		}
		if (req.method === "POST" && path.endsWith("/watch"))
			return json(
				envelope({
					ok: true,
					subscription_id: "ci-watch",
					watch_ttl_seconds: 60,
				}),
			);
		/*
		 * The Radient proxy the renderer actually calls (`POST /v1/desktop/radient`,
		 * the control plane's narrow door to account/credits/usage/agents). It is a
		 * READ door for the operations this scene reaches - the quota notice's
		 * `quota.notice` and the credit census - so it is answered with a synthetic
		 * envelope rather than refused, which is what the 405 below would have done.
		 * Still no provider write: only the read operations are modelled, and any
		 * other operation is refused with the fixture's own words so a new caller
		 * shows up as a named refusal rather than as a silent success.
		 */
		if (req.method === "POST" && path === "/v1/desktop/radient") {
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const operation = JSON.parse(Buffer.concat(chunks).toString() || "{}")
				?.control?.operation;
			if (READ_RADIENT_OPERATIONS.has(operation))
				return json(
					envelope({
						data: {
							msg: "Synthetic radient read.",
							result: radientReadResult(operation),
						},
					}),
				);
			return json(
				{
					detail: `Fixture models no radient operation ${String(operation)}; turns, answers and provider writes stay forbidden`,
				},
				405,
			);
		}
		if (req.method !== "GET")
			return json(
				{ detail: "Fixture forbids turns, answers and provider writes" },
				405,
			);
		if (path === "/v1/desktop/asks") {
			if (mode === "error")
				return json({ detail: "Synthetic queue read failure" }, 503);
			/*
			 * 404, not 503: the RESOLVED unsupported reading. The route does not exist on
			 * this runtime, which is the only failure that may draw the drawer's
			 * permanent "doesn't support queued asks" sentence.
			 */
			if (mode === "unsupported")
				return json({ detail: "Synthetic: no asks aggregate route" }, 404);
			/*
			 * `slow` holds this answer for ~1.5 s so an app rig can photograph the
			 * session drawer BEFORE the aggregate lands: the frame is claimless, so the
			 * merged reading is `null` ("Reading the asks…") for exactly that window.
			 */
			if (mode === "slow")
				await new Promise((resumed) => setTimeout(resumed, 1500));
			return json(envelope({ asks: mode === "empty" ? [] : [ask] }));
		}
		if (path === "/v1/desktop/sessions")
			return json(
				envelope({
					sessions,
					truncated: false,
					limit: 200,
					degraded: [],
					total: 2,
				}),
			);
		const match =
			/^\/v1\/desktop\/sessions\/(fa110700000[12])(?:\/(events|history|children))?$/.exec(
				path,
			);
		if (match) {
			if (match[2] === "events") {
				if (mode === "error")
					return json({ detail: "Synthetic session stream failure" }, 503);
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				res.write(
					`data: ${JSON.stringify({ session_id: match[1], epoch: "ci-asks", seq: 0, type: "open", payload: { subscription_id: "ci-watch", gap: false, watch_ttl_seconds: 60 } })}\n\n`,
				);
				if (mode !== "loading") sendSnapshot(res, match[1]);
				const stream = { res, id: match[1] };
				streams.add(stream);
				req.on("close", () => streams.delete(stream));
				return;
			}
			if (match[2] === "history")
				return json(
					envelope({ entries: [], has_more: false, cursor_missing: false }),
				);
			if (match[2] === "children") return json(envelope({ children: [] }));
			return json(
				envelope(
					sessionSnapshot(
						match[1],
						mode === "empty" ? null : ask,
						sequence,
						CLAIMLESS_MODES.has(mode),
					),
				),
			);
		}
		if (path.endsWith("/profiles")) return json(envelope({ profiles: [] }));
		if (path.endsWith("/teams")) return json(envelope({ teams: [] }));
		if (path.endsWith("/agents")) return json(envelope({ agents: [] }));
		if (path.endsWith("/models")) return json(envelope({ models: [] }));
		return json({ detail: `No fixture for ${path}` }, 404);
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const actualPort = server.address().port;
	const records = join(root, "run", "serve");
	mkdirSync(records, { recursive: true });
	const record = join(records, `${process.pid}.json`);
	const heartbeat = () =>
		writeFileSync(
			record,
			JSON.stringify({
				...identity,
				host: "127.0.0.1",
				port: actualPort,
				source_ref: "ci-fixture",
				desktop: true,
				claim_key: "",
				started_at: now / 1000,
				heartbeat_at: Date.now() / 1000,
			}),
			{ mode: 0o600 },
		);
	heartbeat();
	const timer = setInterval(heartbeat, 1000);
	return {
		url: `http://127.0.0.1:${actualPort}`,
		records,
		requests,
		ask,
		setMode(next) {
			if (!MODES.includes(next)) throw new Error("Unknown fixture state");
			mode = next;
			sequence++;
			for (const stream of streams) sendSnapshot(stream.res, stream.id);
		},
		async close() {
			clearInterval(timer);
			for (const s of sockets) s.destroy();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
