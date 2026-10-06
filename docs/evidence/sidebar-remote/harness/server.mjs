/**
 * The scripted endpoint the sidebar-remote drive talks to, on the port the built
 * app's `.env` names (24325).
 *
 * WHAT IT IS FOR. The claim this pass exists to measure spans two surfaces and
 * one wire: a session another device holds must be LISTED in the sidebar's own
 * bins - under Running/Today/This week next to the local rows, with a locality
 * mark and a hover sentence naming its device and its network - while the
 * sidebar's own catalogue poll must never carry `include_peers`. A server that
 * answers the catalogue BOTH ways - plain (local rows only) and with
 * `include_peers=true` (local + the peer's rows, the route's own concatenation)
 * - is what makes both halves readable from one walk: one build, one session, and
 * the wire log says which read asked for what.
 *
 * The remote rows are fixtures in the wire's own shape (`SessionCatalogueRow` in
 * `src/shared/desktop-session-contract.ts` plus the flat
 * `locality`/`owner_device`/`owner_device_name`/`reachable` fields an
 * `include_peers` listing carries), each carrying the ordinary row fields too
 * (status, pinned, archived, binding) so the sidebar renders them through the
 * same row component as a local row. It is deliberately NOT a daemon: the
 * installed runtime's own peer admission is the live verification's subject, not
 * this instrument's, and a rig that needs a second real device would be a
 * two-daemon test rather than a frame source.
 *
 * EVERY ROUTE THE APP NEEDS to render the sidebar, open a conversation and hold
 * its stream is answered; every other route answers `{result:null}` rather than
 * failing, the sibling rigs' rule - a 404 would send a surface into its error arm
 * and muddy the readings, and the wire log tells a reader exactly which routes
 * the walk touched.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

const PORT = Number(process.env.RIG_PORT ?? 24325);
const WIRE = process.env.RIG_WIRE ?? "/tmp/rig-wire.jsonl";
const SELF = "d_rig_self0001";
const NODE = "d_rig_node0001";
/*
 * THE PEER'S AND NETWORK'S NAMES ARE THE OPERATOR'S OWN, so the frames and the
 * hover sentence keep the reading the report carried (`On cloud-node-1`,
 * network `damian-mesh`). Both are overridable so a variant can measure a long
 * label, the sibling rigs' `--peer-name` rule.
 */
const PEER_NAME = process.env.RIG_PEER_NAME ?? "cloud-node-1";
const NETWORK_NAME = process.env.RIG_NETWORK_NAME ?? "damian-mesh";

/*
 * THE WIRE'S OWN DIRECTORY FIRST (the sibling rigs' lesson, kept): the harness
 * spawns this endpoint before it creates its scratch tree, so on a fresh
 * scratchpad this truncate is the rig's first write and a missing directory
 * would kill the run here (ENOENT ... wire.jsonl) before the harness starts.
 */
mkdirSync(dirname(WIRE), { recursive: true });
writeFileSync(WIRE, "");

const member = (over) => ({
	role: "drive",
	capabilities: ["list", "view", "prompt", "steer", "stop", "slash", "move"],
	active: true,
	suspect: false,
	endpoints: [],
	last_seen_at: 1789400000,
	reachable: true,
	reason: "",
	...over,
});

/*
 * The capability set is the sibling rig's own (`chat-device-persist`), which is
 * the minimum that renders this exact app state: `session_catalogue: 2` opens
 * the sidebar's list, `peers` mounts the mesh surfaces, `team_catalogue` mounts
 * the header identity pair (so the frame is the real header, not a reduced one).
 */
const CAPABILITIES = {
	desktop_contract: 12,
	desktop_available: true,
	desktop_auth: "bearer",
	features: {
		peers: 1,
		session_transfer: 1,
		session_catalogue: 2,
		projects: 1,
		session_pins: 1,
		skills: 1,
		commands: 1,
		providers: 1,
		auth: 1,
		settings: 1,
		catalogues: 1,
		lifecycle: 1,
		mcp: 1,
		radient: 1,
		team_catalogue: 1,
	},
};

const PEERS = {
	self_device_id: SELF,
	peers: [
		{ device_id: NODE, name: PEER_NAME, reachable: true, session_count: 3 },
	],
};

const NETWORKS = {
	self_device_id: SELF,
	networks: [
		{
			network_id: "n_rig01",
			name: NETWORK_NAME,
			epoch: 4,
			trust: "operator",
			members: [
				member({ device_id: SELF, name: "rig-mac", role: "admin" }),
				member({ device_id: NODE, name: PEER_NAME }),
			],
		},
	],
};

/*
 * THE CLOCKS ARE THE RUN'S, computed once at boot: the bins are local-calendar
 * days and a rolling week, so a hard-coded mtime would file nothing under Today
 * on any other day. The five rows are chosen to span the bins the brief names:
 *
 *   - two LOCAL rows: one an hour old (Today), one three days old (This week) -
 *     the control half, present in both arms;
 *   - FOUR REMOTE rows on the peer: one an hour old (Today), one ten minutes
 *     old and `approval` (RUNNING on the status rung, where a remote row is the
 *     strongest reading of "listed seamlessly"), one five days old (This week),
 *     and one two hours old whose owner did NOT answer (`reachable: false` with
 *     the wire's own reason) - the at-rest stroke the design round made the
 *     unreachable state's cue, drawn in Today beside reachable rows so a frame
 *     carries both reads of the same mark.
 */
const NOW = Math.floor(Date.now() / 1000);
const DAY = 24 * 60 * 60;

const localRow = (id, name, mtime, over = {}) => ({
	id,
	name,
	mtime,
	preview: "a local conversation",
	live_state: "idle",
	pending: null,
	active: false,
	pinned: false,
	archived: false,
	degraded: [],
	subagents_running: null,
	subagents_queued: null,
	status: { code: "idle", label: "Idle" },
	binding: { agent: null, team: null },
	created_at: mtime,
	cwd: "~",
	...over,
});

const LOCAL = [
	localRow("aaaaaaaaaa01", "Local: renderer notes", NOW - 3600, {
		active: true,
	}),
	localRow("aaaaaaaaaa02", "Local: release checklist", NOW - 3 * DAY),
];

const remoteRow = (id, name, mtime, status, over = {}) => ({
	id,
	name,
	mtime,
	preview: "",
	pinned: false,
	archived: false,
	degraded: [],
	subagents_running: null,
	subagents_queued: null,
	locality: "remote",
	owner_device: NODE,
	owner_device_name: PEER_NAME,
	reachable: true,
	unreachable_reason: "",
	placement: null,
	origin: null,
	last_synced_at: null,
	active: false,
	status,
	binding: { agent: null, team: null },
	...over,
});

const REMOTE = [
	remoteRow("bbbbbbbbbb01", "Remote: deployment notes", NOW - 1800, {
		code: "idle",
		label: "Idle",
	}),
	remoteRow("bbbbbbbbbb02", "Remote: camera rig sync", NOW - 600, {
		code: "approval",
		label: "Approval needed",
	}),
	remoteRow("bbbbbbbbbb03", "Remote: weekly digest", NOW - 5 * DAY, {
		code: "idle",
		label: "Idle",
	}),
	remoteRow(
		"bbbbbbbbbb04",
		"Remote: incident log",
		NOW - 2 * 3600,
		{ code: "idle", label: "Idle" },
		{ reachable: false, unreachable_reason: "link down 4m ago" },
	),
];

/**
 * The frame `sessions.preview` answers with (the sibling rig's own fixture
 * shape): the draft pane's readings, so a pane that is not a conversation still
 * boots instead of erroring.
 */
const PREVIEW = {
	frontend: {
		state_version: 1,
		epoch: "rig",
		sequence: 0,
		snapshot: {
			session_id: "",
			selected_model: null,
			effective_model: null,
			context_tokens: null,
			context_window: 400_000,
		},
		live_cursor: null,
	},
};

const record = (entry) => appendFileSync(WIRE, `${JSON.stringify(entry)}\n`);

/**
 * The session stream, minimally: `open` then `snapshot`, then the socket held -
 * the sibling rig's own frames, because that shape is the contract's (built the
 * way `scripts/frontend-replace.test.mjs` builds them). The pane goes `live` on
 * it, which is what the header needs to mount the device chip the `open` frame
 * reads.
 */
const streamFrames = (sessionId, subscriptionId) => [
	{
		session_id: sessionId,
		epoch: "rig-bridge",
		seq: 1,
		type: "open",
		payload: {
			subscription_id: subscriptionId,
			gap: false,
			watch_ttl_seconds: 45,
		},
	},
	{
		session_id: sessionId,
		epoch: "rig-bridge",
		seq: 2,
		type: "snapshot",
		payload: {
			frontend: {
				state_version: 1,
				epoch: "rig-owner",
				sequence: 1,
				live_cursor: null,
				snapshot: {
					state_version: 1,
					session_id: sessionId,
					epoch: "rig-owner",
					sequence: 1,
					cwd: "~",
					conversation_title: "",
					conversation_title_user_set: false,
					conversation_title_forked: false,
					goal: "",
					active_agent: "",
					active_team: "",
					selected_model: null,
					effective_model: null,
					streaming: false,
					generation: 1,
					pending_gate: null,
					history_cursor: null,
					live_events: [],
					queued_steering: [],
					jobs: [],
					todos: [],
					wakes: [],
					monitors: [],
					mcp_servers: [],
				},
			},
			history: { entries: [], has_more: false, cursor_missing: false },
			cold: false,
		},
	},
];

/*
 * The session routes' matchers, at TOP LEVEL: the repository's own contract for
 * this tree's scripts treats an inline literal as a per-call allocation, and a
 * server that builds six regexes per request is a lint failure with a real cost
 * behind it.
 */
const SESSION_EVENTS = /^\/v1\/desktop\/sessions\/([^/]+)\/events$/;
const SESSION_WATCH = /^\/v1\/desktop\/sessions\/[^/]+\/watch$/;
const SESSION_MESSAGES = /^\/v1\/desktop\/sessions\/[^/]+\/messages$/;
const SESSION_HISTORY = /^\/v1\/desktop\/sessions\/[^/]+\/history$/;
const SESSION_ROW = /^\/v1\/desktop\/sessions\/[^/]+$/;

const server = createServer((req, res) => {
	let body = "";
	req.on("data", (chunk) => {
		body += chunk;
	});
	req.on("end", () => {
		const parsed = body ? JSON.parse(body) : null;
		record({
			at: Date.now(),
			method: req.method,
			path: req.url,
			body: parsed,
			authorized: Boolean(req.headers.authorization),
		});
		const send = (payload, status = 200) => {
			const text = JSON.stringify(payload);
			res.writeHead(status, { "content-type": "application/json" });
			res.end(text);
		};
		const url = new URL(req.url ?? "/", "http://rig.invalid");
		const path = url.pathname;
		if (path === "/v1/capabilities") return send({ result: CAPABILITIES });
		/*
		 * THE LEGACY AGENTS LIST AND THE TEAMS READ ARE ANSWERED EMPTY rather than
		 * left to the null catch-all: a null `result` is what the app renders as
		 * "Failed to fetch agents" and "Cannot read properties of null (reading
		 * 'teams')", and an error banner in the corner of every frame is noise a
		 * reviewer then has to be told to ignore.
		 */
		if (path === "/v1/agents")
			return send({
				status: 200,
				message: "ok",
				result: { total: 0, page: 1, per_page: 50, agents: [] },
			});
		if (path === "/v1/desktop/teams") return send({ result: { teams: [] } });
		if (path === "/v1/desktop/peers") return send({ result: PEERS });
		if (path === "/v1/desktop/networks") return send({ result: NETWORKS });
		if (path === "/v1/desktop/sessions" && req.method === "GET") {
			/*
			 * THE TWO ANSWERS, ONE ROUTE. `include_peers=true` appends the peer's
			 * rows the way the route itself concatenates them (page first, then the
			 * extras, then the peer half); a plain read answers the local rows only,
			 * which is the read the sidebar's own poll must keep making.
			 */
			const includePeers = url.searchParams.get("include_peers") === "true";
			const limit = Number(url.searchParams.get("limit") ?? 500);
			return send({
				result: {
					sessions: [...LOCAL, ...(includePeers ? REMOTE : [])],
					truncated: false,
					limit,
					degraded: [],
					next_cursor: null,
					cursor_missing: false,
					scope: null,
					counts: null,
				},
			});
		}
		if (path === "/v1/desktop/sessions/preview" && req.method === "POST")
			return send({ result: PREVIEW });
		if (SESSION_EVENTS.test(path) && req.method === "GET") {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			for (const frame of streamFrames(
				path.match(SESSION_EVENTS)[1],
				"rig-events",
			)) {
				res.write(`data: ${JSON.stringify(frame)}\n\n`);
			}
			/*
			 * HELD OPEN UNTIL THE CLIENT LEAVES - the sibling rig's own note: `req`'s
			 * 'close' fires when the REQUEST completes, so nothing is attached here;
			 * the socket's teardown is Node's, and the relay's 45 s silence watchdog
			 * never fires inside a run this short.
			 */
			return;
		}
		if (SESSION_WATCH.test(path) && req.method === "POST")
			return send({ result: {} });
		if (SESSION_MESSAGES.test(path) && req.method === "POST")
			return send({ result: {} });
		if (SESSION_HISTORY.test(path))
			return send({
				result: { entries: [], has_more: false, cursor_missing: false },
			});
		if (SESSION_ROW.test(path) && req.method === "GET")
			return send({ result: { session: null, messages: [] } });
		return send({ result: null });
	});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`rig endpoint on http://127.0.0.1:${PORT} -> ${WIRE}`);
});
