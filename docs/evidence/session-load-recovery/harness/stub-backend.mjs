/**
 * A disposable stand-in for `local-operator serve`, used only to reproduce the
 * stream refusal this evidence set is about.
 *
 * It answers enough of the desktop vocabulary for the real renderer to boot
 * into a conversation, and it serves that conversation's stream under a policy
 * the capture chooses:
 *
 *   - `flaky`  refuses `GET .../events` with the backend's own 401 a few times
 *              and then serves a real snapshot. This is the operator's bug: a
 *              refusal the renderer was expected to recover from.
 *   - `down`   refuses forever, which is what the exhausted-retry state is.
 *
 * WHY a stub instead of the operator's backend. `SESSION_LOAD_BACKEND=real`
 * swaps in a real `local-operator serve`, but the plain path is a stub for the
 * same reason `docs/evidence/chat-title` and `docs/evidence/desktop-413` use
 * one: the interesting state is a refusal at one exact line, and a real backend
 * refuses only when a token rotates under it - which means restarting a process
 * this harness must not need to touch. Nothing here is asked to prove the
 * backend's behaviour; the regression test does that against real loopback HTTP.
 *
 * Every response is wrapped in the backend's own envelope (`{ "result": ... }`)
 * because that is what the real routes return and what the renderer's
 * transport unwraps.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.SESSION_LOAD_PORT ?? 8796);
const SESSION = process.env.SESSION_LOAD_SESSION ?? "92602660eb9e";
const SUBSCRIPTION = "a".repeat(32);
const EPOCH = "b".repeat(16);
const MODE = process.env.SESSION_LOAD_MODE ?? "flaky";
/** How many `events` attempts are refused before the stream is served. */
const REFUSALS = Number(process.env.SESSION_LOAD_REFUSALS ?? 2);
/**
 * `SESSION_LOAD_ROWS=0` serves the conversation with NO durable rows.
 *
 * That is the counter-case the fix has to keep working (design round 1, D5(b)):
 * a genuinely empty conversation must still END UP saying it is empty, rather
 * than being indistinguishable from one the app could not read and therefore
 * loading forever.
 */
const EMPTY = process.env.SESSION_LOAD_ROWS === "0";

let attempts = 0;

/** One durable row, in the wire shape `durableRecord` reads. */
const ROWS = [
	{
		id: "m-1",
		ts: 1_762_000_000,
		type: "message",
		payload: {
			role: "user",
			content: [{ type: "text", text: "Check the failing deploys for me." }],
		},
	},
	{
		id: "m-2",
		ts: 1_762_000_011,
		type: "message",
		payload: {
			role: "assistant",
			content: [
				{
					type: "text",
					text: "Three deploys failed in the last hour, all on the same job.",
				},
			],
			stop_reason: "endTurn",
		},
	},
];

const CONFIG = {
	result: {
		values: {
			hosting: "openrouter",
			model_name: "anthropic/claude-sonnet-4",
			conversation_length: 100,
			detail_length: 35,
			auto_save_conversation: false,
		},
	},
};

const CAPABILITIES = {
	result: {
		desktop_available: true,
		version: 2,
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
	},
};

const sessionRow = {
	id: SESSION,
	name: "Failing deploys",
	// NOW, not a fixed date: the sidebar's "Previous chats" section lists the
	// recent window, so a canned timestamp from months ago renders an EMPTY
	// sidebar and the capture has nothing to open.
	mtime: Date.now() / 1000,
	preview: EMPTY ? "" : "Three deploys failed in the last hour",
};

/** The durable rows this run serves: the conversation's history, or none. */
const rows = () => (EMPTY ? [] : ROWS);

const frontendSnapshot = () => ({
	state_version: 1,
	session_id: SESSION,
	epoch: EPOCH,
	sequence: 1,
	cwd: "~/workspace",
	conversation_title: "Failing deploys",
	conversation_title_user_set: true,
	conversation_title_forked: false,
	goal: "",
	active_agent: "",
	active_team: "",
	selected_model: { provider: "anthropic", name: "claude-sonnet-4" },
	effective_model: { provider: "anthropic", name: "claude-sonnet-4" },
	streaming: false,
	generation: 0,
	pending_gate: null,
	history_cursor: null,
	live_events: [],
	queued_steering: [],
	jobs: [],
	todos: [],
	wakes: [],
	mcp_servers: [],
	model_catalogue: [],
	context_tokens: 12_400,
	context_is_estimate: false,
	context_window: 200_000,
	context_breakdown: null,
	cumulative_parent_cost: 0.02,
	subagent_cost: 0,
	cost_knowledge: "exact",
});

const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`;

createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const raw = req.url ?? "";
	const path = raw.split("?")[0];
	if (process.env.SESSION_LOAD_LOG === "1")
		process.stdout.write(`${req.method} ${path}\n`);
	const json = (body, status = 200) => {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};

	if (path === "/health") return json({ status: "ok" });

	if (path.endsWith("/events")) {
		attempts += 1;
		const served = MODE === "down" ? false : attempts > REFUSALS;
		process.stdout.write(
			`events attempt ${attempts} -> ${served ? 200 : 401}\n`,
		);
		if (!served) {
			// The backend's own refusal for a bearer it does not hold.
			return json({ detail: "Unauthorized" }, 401);
		}
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
		});
		res.write(
			frame({
				type: "open",
				epoch: EPOCH,
				seq: 0,
				payload: { subscription_id: SUBSCRIPTION, gap: false },
			}),
		);
		res.write(
			frame({
				type: "snapshot",
				epoch: EPOCH,
				seq: 1,
				payload: {
					cold: false,
					history: { entries: rows(), has_more: false, cursor_missing: false },
					frontend: { epoch: EPOCH, snapshot: frontendSnapshot() },
				},
			}),
		);
	// A real stream stays open; the heartbeat keeps it alive without
		// touching anything the renderer paints.
		const beat = setInterval(() => res.write(": heartbeat\n\n"), 5_000);
		req.on("close", () => clearInterval(beat));
		return;
	}

	if (path === "/v1/capabilities") return json(CAPABILITIES);
	if (path === "/v1/desktop/profiles")
		return json({ result: { profiles: [], active: null } });
	if (path === "/v1/desktop/teams") return json({ result: { teams: [] } });
	if (path === "/v1/config") return json(CONFIG);
	if (path === "/v1/desktop/sessions" && req.method === "GET")
		return json({
			result: { sessions: [sessionRow], truncated: false, limit: 500 },
		});
	if (path === "/v1/desktop/sessions" && req.method === "POST")
		return json({ result: { session_id: SESSION, binding: null } });
	if (path.endsWith("/history"))
		return json({
			result: { entries: rows(), has_more: false, cursor_missing: false },
		});
	if (path.endsWith("/watch"))
		return json({ result: { lease_seconds: 45 } });
	if (path.endsWith("/refresh")) return json({ result: { refreshed: true } });
	if (/^\/v1\/desktop\/sessions\/[a-f0-9]{12}$/.test(path))
		return json({
			result: {
				session_id: SESSION,
				name: sessionRow.name,
				cwd: "~/workspace",
				has_more: false,
			},
		});

	// Anything else the shell reads on mount: an empty success, so unrelated
	// state stays out of the frames.
	return json({ result: {} });
}).listen(PORT, "127.0.0.1", () => {
	process.stdout.write(
		`stub backend on http://127.0.0.1:${PORT} (mode=${MODE}, session=${SESSION})\n`,
	);
});
