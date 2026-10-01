/**
 * The scripted endpoint the create-success drive talks to, on the port the built
 * app's `.env` names (24323).
 *
 * WHAT IT IS FOR. The claim this file exists to measure is on the WIRE and in the
 * chip: a new chat aimed at a peer must reach `sessions.create` with that device
 * as its `peer`, and the chip must go on saying `On <device>` once the
 * conversation exists (the operator-reported revert to `On this device`). A
 * server that records the request bodies and answers the two mesh reads, the
 * catalogue, the create and the message routes is enough to hold both halves, and
 * it is honest about its own scope: it is NOT a daemon - the installed runtime
 * predates the `peer` admission on `sessions.create`, so a real one would refuse
 * this path before anything could be measured (the same disclosure
 * `chat-device-live/harness/server.mjs` carries for the transfer route). The
 * app's transport, its store, its chip and the create flow are the shipped ones.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

const PORT = Number(process.env.RIG_PORT ?? 24323);
const WIRE = process.env.RIG_WIRE ?? "/tmp/rig-wire.jsonl";
const SELF = "d_rig_self0001";
const NODE = "d_rig_node0001";
/*
 * THE PEER'S NAME IS THE RUN'S, so one rig can photograph the truncating chip
 * (design review round 2, D4's narrow variant): the fixture device carries
 * whatever label the drive's `--peer-name` asked for, in every place a name
 * appears (both reads, the picker, the receipt's resolution). Default = the
 * operator's own device, so the committed frames keep their reading.
 */
const PEER_NAME = process.env.RIG_PEER_NAME ?? "cloud-node-1";
/*
 * THE TRANSFER ANSWER IS HELD UNTIL THE DRIVE SAYS GO (`RIG_HOLD_FILE`), the
 * sibling rig's own mechanism (`chat-device-live`): the in-flight state lives
 * between the confirm and the receipt, and a state that lasts as long as a
 * local socket round trip cannot be photographed. The body is recorded the
 * moment it arrives (the wire reading is unaffected) and the answer waits for
 * a file the drive writes once its in-flight frame is on disk.
 */
const HOLD_FILE = process.env.RIG_HOLD_FILE ?? "";

/*
 * UNIQUE SESSION IDS PER CREATE (QA round 1, N1). The stub used to answer every
 * create with one constant, which was invisible while the rig created exactly
 * one conversation - and would have the second create upsert over the first
 * row the moment this set grew a local-send capture (D3). Daemon-minted ids
 * are unique; the stub now is too.
 */
let createSeq = 0;
const mintedId = () => `f47ac10b${(0x5800 + ++createSeq).toString(16)}`;

/*
 * THE WIRE'S OWN DIRECTORY FIRST - the sibling rig's lesson, kept: the harness
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

const CAPABILITIES = {
	desktop_contract: 12,
	desktop_available: true,
	desktop_auth: "bearer",
	features: {
		peers: 1,
		session_transfer: 1,
		/*
		 * `session_catalogue: 2` is the sidebar's own minimum (the neighbour rig
		 * shipped `1` first and photographed the gate's sentence instead of a
		 * catalogue).
		 */
		session_catalogue: 2,
		projects: 1,
		session_pins: 1,
		skills: 1,
		commands: 1,
		providers: 1,
		/*
		 * THE BANNER'S OWN LIST (`REQUIRED_BACKEND_FEATURES`): a capabilities answer
		 * missing any of these draws "The Local Operator server is missing ...
		 * support" across the pane, which would sit in every frame of this set and
		 * is not what this rig is measuring. The sibling rig predates the banner.
		 */
		auth: 1,
		settings: 1,
		catalogues: 1,
		lifecycle: 1,
		mcp: 1,
		radient: 1,
		/*
		 * REQUIRED FOR THE HEADER'S IDENTITY PAIR TO MOUNT at all
		 * (`headerIdentityControlsShown`): without it the header keeps the plain
		 * description and the alignment claim would have nothing to measure against.
		 */
		team_catalogue: 1,
	},
};

const PEERS = {
	self_device_id: SELF,
	peers: [
		{ device_id: NODE, name: PEER_NAME, reachable: true, session_count: 0 },
	],
};

const NETWORKS = {
	self_device_id: SELF,
	networks: [
		{
			network_id: "n_rig01",
			name: "home",
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
 * THE CATALOGUE IS EMPTY, deliberately: the scene starts at a NEW CHAT (the
 * draft the launch seeds), which is where the operator's report begins. The
 * conversation the send creates lives on the peer, so it is not this device's
 * catalogue row either - the chip's post-send reading comes from the app's own
 * store, not from a listing.
 */
const SESSIONS = [];

/**
 * The frame `sessions.preview` answers with: the draft pane's readings, in the
 * shape `draft-selection.test.mjs` itself uses (`{frontend: {snapshot: …}}`).
 * `null` models mean nothing is resolved, which is the ordinary un-picked draft.
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
 * The receipt the transfer route answers with, in the wire's own shape
 * (`TransferReceipt`): `locality`/`owner_device` are "where the session lives
 * NOW" - `local`/this device on a recall, `remote`/the peer on a move out -
 * and that pair is what the app's `settlePlacement` writes back onto the row
 * once the move lands (agent review round 1, F1's fix).
 */
const receipt = (to, keep, sessionId) => ({
	locality: to === "local" ? "local" : "remote",
	owner_device: to === "local" ? SELF : to,
	source_retired: !keep,
	session_id: sessionId,
	new_session_id: sessionId,
	mode: keep ? "keep" : "move",
	phases: [
		{ phase: "prepared", peer: to, progress: 0.25 },
		{ phase: "copied", peer: to, progress: 0.75 },
		{ phase: "done", peer: to, progress: 1 },
	],
	replayed: false,
});

/** The hold itself: the answer waits for the file the drive writes. */
const waitForRelease = async (path) => {
	if (!path) return;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (existsSync(path)) return;
		await new Promise((r) => setTimeout(r, 150));
	}
};

/**
 * The session stream, minimally: `open` then `snapshot`, then the socket held.
 *
 * WHY THE DRIVE NEEDS IT rather than tolerating a dead stream. The header's
 * identity pair only mounts once the pane is `live` (`headerIdentityControlsShown`
 * takes `streamLive`), and the alignment defect is about the DEVICE chip against
 * those two identity chips - a rig without a stream would photograph an empty
 * slot and prove nothing. The frames are built in the shape the app's own tests
 * build them (`scripts/frontend-replace.test.mjs`), because that shape is the
 * contract's, not this file's idea of it.
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
		const path = (req.url ?? "").split("?")[0];
		if (path === "/v1/capabilities") return send({ result: CAPABILITIES });
		if (path === "/v1/desktop/peers") return send({ result: PEERS });
		if (path === "/v1/desktop/networks") return send({ result: NETWORKS });
		if (path === "/v1/desktop/sessions" && req.method === "GET")
			return send({
				result: { sessions: SESSIONS, truncated: false, next_cursor: null },
			});
		if (path === "/v1/desktop/sessions" && req.method === "POST") {
			/*
			 * THE CREATE, WHATEVER IT NAMED. The drive's claim is the CHIP's after the
			 * answer, so the answer is the ordinary one - a minted id and the peer's
			 * binding (none) - and the request body (its `peer`, its `cwd`) is read
			 * back from the wire log by the drive itself. The id is MINTED PER CREATE
			 * (`mintedId`): the set creates twice since round 2 (the peer scene and
			 * the local-send control), and a constant would have the second create
			 * upsert over the first row (QA N1).
			 */
			return send({
				result: {
					session_id: mintedId(),
					binding: { agent: null, team: null },
				},
			});
		}
		if (path === "/v1/desktop/sessions/preview" && req.method === "POST")
			return send({ result: PREVIEW });
		if (
			/\/v1\/desktop\/sessions\/([^/]+)\/events$/.test(path) &&
			req.method === "GET"
		) {
			/*
			 * THE FRAME STREAM THE APP ACTUALLY READS, and the route it actually asks
			 * (measured, not assumed): the main-process relay opens `GET .../events`
			 * with `Accept: text/event-stream` (src/main/desktop-stream.ts), reads SSE
			 * `data:` records on blank-line terminators and forwards each to the
			 * renderer. The first version of this file modelled only the contract's
			 * `sessions.watch` POST and answered THIS route with the JSON catch-all -
			 * the pane then retried three times and parked on "Reconnecting", which is
			 * the state its frames showed. Two frames, then the connection is HELD
			 * (the relay's 45 s silence watchdog never fires inside a run this short).
			 */
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			for (const frame of streamFrames(
				path.match(/\/v1\/desktop\/sessions\/([^/]+)\/events$/)[1],
				"rig-events",
			)) {
				res.write(`data: ${JSON.stringify(frame)}\n\n`);
			}
			/*
			 * HELD OPEN UNTIL THE CLIENT LEAVES - AND NOT VIA `req`'s OWN 'close',
			 * which is the trap this file fell into first: since Node 16 that event
			 * fires when the REQUEST is complete, and a GET with no body is complete
			 * before this handler even runs, so `req.on("close", () => res.end())`
			 * truncated every stream to its first bytes (measured: curl read all 877
			 * bytes and EOF at 1.7 ms, and the app's relay reconnected five times with
			 * an advancing `after_seq` before parking the pane on "Reconnecting").
			 * Nothing needs to be attached here: the socket's teardown is Node's own,
			 * and the relay's 45 s silence watchdog never fires inside a run this
			 * short because the connection stays up.
			 */
			return;
		}
		if (
			/\/v1\/desktop\/sessions\/[^/]+\/watch$/.test(path) &&
			req.method === "POST"
		) {
			/*
			 * The watch LEASE (`sessions.watch`: visible/can_notify), not the frame
			 * stream: its answer is the ordinary JSON envelope.
			 */
			return send({ result: {} });
		}
		if (/\/v1\/desktop\/sessions\/([^/]+)\/transfer$/.test(path)) {
			/*
			 * THE TRANSFER, HELD WHEN THE RUN ASKS FOR IT. `sessions.transfer` is the
			 * one route the recall scene (and the moving capture) needs; the receipt
			 * names the session the path addressed, so a recall of the second-minted
			 * conversation settles THAT row and no other.
			 */
			const sid = path.match(/\/v1\/desktop\/sessions\/([^/]+)\/transfer$/)[1];
			void waitForRelease(HOLD_FILE).then(() =>
				send({ result: receipt(parsed?.to ?? "", Boolean(parsed?.keep), sid) }),
			);
			return;
		}
		if (
			/\/v1\/desktop\/sessions\/[^/]+\/messages$/.test(path) &&
			req.method === "POST"
		)
			return send({ result: {} });
		if (/\/v1\/desktop\/sessions\/[^/]+\/history$/.test(path))
			return send({ result: { messages: [], truncated: false } });
		if (/\/v1\/desktop\/sessions\/[^/]+$/.test(path) && req.method === "GET")
			return send({ result: { session: null, messages: [] } });
		/*
		 * EVERY OTHER ROUTE ANSWERS EMPTY RATHER THAN FAILING, the sibling rig's own
		 * rule: a 404 here would send a surface into its error arm and muddy the
		 * readings. The wire log tells a reader exactly which routes the walk touched
		 * (the session stream's `watch` is among them: it is not modelled, and the
		 * chip does not depend on it).
		 */
		return send({ result: null });
	});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`rig endpoint on http://127.0.0.1:${PORT} -> ${WIRE}`);
});
