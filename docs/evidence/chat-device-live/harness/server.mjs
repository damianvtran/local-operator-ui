/**
 * The scripted endpoint the round-2 drive talks to, on the port the built app's
 * `.env` names (24321).
 *
 * WHAT IT IS FOR. The claim this file exists to measure is on the WIRE: a pick on a
 * live conversation must address the destination by DEVICE ID (QA round 2, Q2-1), and
 * the receipt it comes back with decides which surface the pane paints. A server
 * that records the request bodies and answers the three mesh reads plus the transfer
 * route is enough to hold both halves, and it is honest about its own scope: the
 * receipts below are FIXTURES in the wire's own shape (`mesh-types.TransferReceipt`),
 * not a daemon's answer. The app's transport, its model, its picker and its receipt
 * handling are all the shipped ones.
 *
 * It is deliberately NOT a daemon: the installed runtime predates the `peer`
 * admission on `sessions.create`/`transfer` (the round-1 QA block still stands), so a
 * real daemon refuses this path before anything can be measured.
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.env.RIG_PORT ?? 24321);
const WIRE = process.env.RIG_WIRE ?? "/tmp/rig-wire.jsonl";
const HOLD_FILE = process.env.RIG_HOLD_FILE ?? "";
const SESSION = "c7ecaf735812";
const SELF = "d_peer_mbp0001";
const BUILD = "d_peer_buildbox";
const PIXEL = "d_peer_pixelbit";

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
		 * `session_catalogue: 2` IS THE SIDEBAR'S OWN MINIMUM
		 * (`chat-sidebar.tsx`'s `desktopFeatureState(…, "session_catalogue", 2)`), and the
		 * first run of this rig shipped `1` and photographed the gate's own
		 * "Update the backend to use canonical chats" sentence instead of a catalogue.
		 */
		session_catalogue: 2,
		projects: 1,
		session_pins: 1,
		skills: 1,
		commands: 1,
		providers: 1,
	},
};

const SESSIONS = [
	{
		id: SESSION,
		session_id: SESSION,
		name: "QA round 2, live arm",
		title: "QA round 2, live arm",
		cwd: "~",
		preview: "the conversation the pick is made on",
		live_state: "idle",
		active: false,
		pinned: false,
		archived: false,
		updated_at: 1789400000,
		created_at: 1789390000,
		mtime: 1789400000,
	},
];

const PEERS = {
	self_device_id: SELF,
	peers: [
		{ device_id: BUILD, name: "build-box", reachable: true, session_count: 3 },
		{ device_id: PIXEL, name: "pixel-8", reachable: true, session_count: 1 },
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
				member({ device_id: SELF, name: "damian-mbp", role: "admin" }),
				member({ device_id: BUILD, name: "build-box" }),
				member({ device_id: PIXEL, name: "pixel-8" }),
			],
		},
	],
};

/**
 * The receipt the transfer route answers with.
 *
 * `source_retired: true` on a remote locality is the `gone` state (the move
 * committed and this device's copy is deleted), which is the surface Q2-1 measured
 * as unreachable through the control: the pane can only paint it if the destination
 * it resolved is a device id the catalogue actually carries.
 */
const receipt = (to, keep) => ({
	locality: to === "local" ? "local" : "remote",
	owner_device: to === "local" ? SELF : to,
	source_retired: !keep,
	session_id: SESSION,
	new_session_id: SESSION,
	mode: keep ? "keep" : "move",
	phases: [
		{ phase: "prepared", peer: to, progress: 0.25 },
		{ phase: "copied", peer: to, progress: 0.75 },
		{ phase: "done", peer: to, progress: 1 },
	],
	replayed: false,
});

const record = (entry) => appendFileSync(WIRE, `${JSON.stringify(entry)}\n`);

/**
 * THE TRANSFER ANSWER IS HELD UNTIL THE DRIVE SAYS GO (`RIG_HOLD_FILE`).
 *
 * One run, two frames: the walk needs the move IN FLIGHT (the composer's hold strip
 * only exists between the confirm and the receipt) and then the landing, and a state
 * that lasts as long as a local socket round trip cannot be photographed. So the body
 * is recorded the moment it arrives - the wire reading is unaffected - and the answer
 * waits for a file, which the drive writes once its in-flight frame is on disk.
 */
const waitForRelease = async (path) => {
	if (!path) return;
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (existsSync(path)) return;
		await new Promise((r) => setTimeout(r, 150));
	}
};

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
		if (/\/v1\/desktop\/sessions\/[^/]+\/transfer$/.test(path)) {
			void waitForRelease(HOLD_FILE).then(() =>
				send({ result: receipt(parsed?.to ?? "", Boolean(parsed?.keep)) }),
			);
			return;
		}
		if (/\/v1\/desktop\/sessions\/[^/]+\/history$/.test(path))
			return send({ result: { messages: [], truncated: false } });
		if (/\/v1\/desktop\/sessions\/[^/]+$/.test(path) && req.method === "GET")
			return send({ result: { session: SESSIONS[0], messages: [] } });
		/*
		 * EVERY OTHER ROUTE ANSWERS EMPTY RATHER THAN FAILING, and the log is the
		 * reason: a 404 from this server would send a surface into its error arm and
		 * muddy the readings this drive is for. The wire log tells a reader exactly
		 * which routes the walk touched.
		 */
		return send({ result: null });
	});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`rig endpoint on http://127.0.0.1:${PORT} -> ${WIRE}`);
});
