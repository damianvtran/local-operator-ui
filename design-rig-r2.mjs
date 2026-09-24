#!/usr/bin/env node
/**
 * Real-app evidence for the seed label gap / stripped counts fix.
 *
 *   node seed-label-rig.mjs --tree <worktree> --label <before|after> --moment <labels|counts> --out <dir>
 *
 * Boots the BUILT app of <tree> headless (never shown), against a stub backend on
 * a scratch port that serves conversation 70ddfaaf163a as the runtime would to a
 * viewer joining mid-turn: an `open` + `snapshot` SSE frame whose page is the
 * journal's newest 100 entries and whose `live_events` seed is the fixture's
 * (bounded by the backend's own `_bound_live_events_in_place`), and a
 * `/history` route with the backend reader's semantics (no cursor = tail,
 * `before_id` exclusive, `has_more`). Every history request is logged with its
 * time, `limit` and `before_id`. Tail/walk reads answer after HISTORY_DELAY_MS so
 * the first frame (before any read lands) can be photographed.
 *
 * Isolation: scratch HOME, config dir, user-data-dir, log dir and cwd; CMUX_/LOP_
 * stripped; notifications + telemetry off; backend manager disabled. The app is
 * stopped by process group and the scratch profile reaped at the end.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const arg = (name, fallback = null) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? fallback : process.argv[at + 1];
};
const TREE = arg("--tree");
const LABEL = arg("--label");
const MOMENT = arg("--moment", "labels");
const OUT = arg("--out");
const PORT = Number(arg("--port", "46377"));
const DEBUG_PORT = PORT + 1;
const HISTORY_DELAY_MS = Number(arg("--delay", "1500"));
const SESSION = "70ddfaaf163a";
const THEME = arg("--theme", "localOperatorDark");
const SIZE = arg("--size", "1380x900");
/*
 * Round-2 additions. `--hang` holds every durable (tail/walk) read unanswered
 * for the whole run — the request that never settles, which is the case the 3 s
 * backstop (`LABEL_HOLD_MAX_MS`) exists for. `--shots` names absolute
 * milliseconds after the open at which a frame is taken, so the two sides of the
 * 3 000 ms release can be photographed. `--scene switchback` leaves the
 * conversation (by changing the session id in the hash, which unmounts the pane)
 * and returns, sampling what the return paints.
 */
const HANG = process.argv.includes("--hang");
const FAIL = process.argv.includes("--fail");
const FAIL_MS = Number(arg("--fail-ms", "60"));
const SCENE = arg("--scene", "open");
const SHOTS = (arg("--shots", "") || "").split(",").filter(Boolean).map(Number);
const LOOP_MS = Number(arg("--loop-ms", "100"));
const RUN_MS = Number(arg("--run-ms", HANG ? "6500" : "9000"));
mkdirSync(OUT, { recursive: true });

const fixture = JSON.parse(
	readFileSync(
		join(
			process.env.FIXTURE_TREE ?? TREE,
			"scripts/fixtures/seed-label-gap.json",
		),
		"utf8",
	),
);
const moment = fixture.moments[MOMENT];
const durable = fixture.journal.slice(0, moment.journal_rows);
const page = durable.slice(-100);

const ROOT = mkdtempSync(
	join(process.env.LOCAL_OPERATOR_SCRATCHPAD, `rig-${LABEL}-${MOMENT}-`),
);
const CONFIG_DIR = join(ROOT, "config");
const RUN_DIR = join(CONFIG_DIR, "run", "serve");
const PROFILE = join(ROOT, "profile");
const CWD = join(ROOT, "cwd");
for (const dir of [RUN_DIR, PROFILE, CWD]) mkdirSync(dir, { recursive: true });
writeFileSync(join(PROFILE, "desktop-token"), "b".repeat(64), { mode: 0o600 });

const log = { history: [], unknown: [], t0: 0 };
const now = () => Date.now();
const state = { frozen: false, seq: 0 };

const frontend = () => ({
	state_version: 1,
	epoch: "owner-epoch",
	sequence: 2,
	live_cursor: page.at(-1).id,
	snapshot: {
		epoch: "owner-epoch",
		sequence: 2,
		cwd: "~/local-operator-worktrees/subagent-perf",
		conversation_title: "Subagent performance",
		conversation_title_user_set: true,
		conversation_title_forked: false,
		goal: "",
		active_agent: "",
		active_team: "",
		selected_model: null,
		effective_model: null,
		streaming: true,
		generation: 1,
		pending_gate: null,
		history_cursor: page.at(-1).id,
		live_events: moment.live_events,
		live_tool_started_at: {},
		queued_steering: [],
		jobs: [],
		todos: [],
		wakes: [],
		mcp_servers: [],
		model_catalogue: [],
		context_tokens: null,
		context_is_estimate: null,
		context_window: null,
		context_breakdown: null,
		cumulative_parent_cost: null,
		subagent_cost: null,
		cost_knowledge: "unknown",
		last_usage: null,
		attention: null,
	},
});

const server = createServer((request, response) => {
	const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
	const path = url.pathname;
	const json = (status, body) => {
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(JSON.stringify(body));
	};
	if (path === "/health")
		return json(200, {
			status: 200,
			result: {
				version: "0.62.17",
				instance_id: "seed-label-rig",
				pid: process.pid,
				prefix: "/tmp/seed-label-rig",
				install_kind: "uv-tool",
			},
		});
	if (path === "/v1/capabilities")
		return json(200, {
			status: 200,
			result: {
				desktop_available: true,
				features: {
					session_catalogue: 2,
					profile_catalogue: 1,
					team_catalogue: 1,
					auth: 1,
					settings: 1,
					commands: 1,
					catalogues: 1,
					lifecycle: 1,
					mcp: 1,
				},
			},
		});
	if (path === "/v1/desktop/claim") return json(200, { status: 200 });
	if (path === "/v1/config")
		return json(200, {
			status: 200,
			result: {
				version: "0.12.8",
				metadata: {
					created_at: "2025-06-18T11:02:00Z",
					last_modified: "2026-09-15T00:00:00Z",
					description: "seed label rig",
				},
				values: {
					conversation_length: 100,
					detail_length: 15,
					max_learnings_history: 50,
					hosting: "openrouter",
					model_name: "anthropic/claude-sonnet-4",
					auto_save_conversation: true,
				},
			},
		});
	if (path === "/v1/desktop/profiles")
		return json(200, { status: 200, result: { profiles: [] } });
	if (path === "/v1/desktop/teams")
		return json(200, { status: 200, result: { teams: [] } });
	if (path === "/v1/desktop/sessions")
		return json(200, {
			status: 200,
			result: {
				sessions: [
					{
						id: SESSION,
						name: "Subagent performance",
						mtime: Math.floor(now() / 1000) - 30,
						cwd: "~",
					},
				],
				truncated: false,
				limit: 500,
			},
		});
	if (path === `/v1/desktop/sessions/${SESSION}/history`) {
		const limit = Number(url.searchParams.get("limit") ?? 100);
		const beforeId = url.searchParams.get("before_id");
		const entry = {
			at: now() - log.t0,
			limit,
			beforeId: beforeId ?? null,
			frozen: state.frozen,
		};
		log.history.push(entry);
		// After the open has settled, reads are held: this photographs the
		// transcript BEFORE a reader's own scroll-up paging backfills anything.
		if (state.frozen) return;
		/*
		 * `--hang`: the durable read is accepted and never answered. This is the
		 * wedged owner the backstop covers — not a refused connection, which the
		 * transport's own retry would resolve, but a request that stays open.
		 */
		if (HANG) return;
		/*
		 * `--fail`: the durable read FAILS, fast. A settle is a settle to the
		 * hold, so this is the case where the release is the earliest possible
		 * one — the read is over before the first frame is a second old.
		 */
		if (FAIL) {
			setTimeout(() => {
				entry.answeredAt = now() - log.t0;
				entry.failed = true;
				response.writeHead(500, { "Content-Type": "application/json" });
				response.end(JSON.stringify({ detail: "rig: the durable read failed" }));
			}, FAIL_MS);
			return;
		}
		const end = beforeId
			? durable.findIndex((row) => row.id === beforeId)
			: durable.length;
		const stop = end < 0 ? durable.length : end;
		const start = Math.max(0, stop - limit);
		setTimeout(() => {
			entry.answeredAt = now() - log.t0;
			entry.rows = stop - start;
			json(200, {
				status: 200,
				result: {
					entries: durable.slice(start, stop),
					has_more: start > 0,
					cursor_missing: false,
				},
			});
		}, HISTORY_DELAY_MS);
		return;
	}
	if (path === `/v1/desktop/sessions/${SESSION}/events`) {
		response.writeHead(200, {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache",
		});
		const send = (frame) =>
			response.write(`data: ${JSON.stringify(frame)}\n\n`);
		log.snapshotAt = now() - log.t0;
		send({
			session_id: SESSION,
			epoch: "bridge-epoch",
			seq: 1,
			type: "open",
			payload: {
				subscription_id: "sub-1",
				gap: false,
				watch_ttl_seconds: 45,
			},
		});
		send({
			session_id: SESSION,
			epoch: "bridge-epoch",
			seq: 2,
			type: "snapshot",
			payload: {
				frontend: frontend(),
				history: { entries: page, has_more: true, cursor_missing: false },
				cold: false,
			},
		});
		const keep = setInterval(() => response.write(": keep-alive\n\n"), 5_000);
		request.on("close", () => clearInterval(keep));
		return;
	}
	if (path === "/v1/auth/providers" || path === "/v1/auth/status")
		return json(200, { status: 200, result: { providers: [], accounts: [] } });
	log.unknown.push(`${request.method} ${path}`);
	json(404, { detail: "not part of this rig" });
});
server.listen(PORT, "127.0.0.1");

const writeRecord = () =>
	writeFileSync(
		join(RUN_DIR, `${process.pid}.json`),
		JSON.stringify({
			pid: process.pid,
			host: "127.0.0.1",
			port: PORT,
			instance_id: "seed-label-rig",
			version: "0.62.17",
			source_ref: "",
			prefix: "/tmp/seed-label-rig",
			install_kind: "uv-tool",
			desktop: false,
			claim_key: "a".repeat(64),
			started_at: now() / 1000 - 10,
			heartbeat_at: now() / 1000,
		}),
		{ mode: 0o600 },
	);
writeRecord();
const heartbeat = setInterval(writeRecord, 5_000);

const env = {};
for (const key of ["PATH", "TMPDIR", "LANG", "LC_ALL", "TERM"])
	if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
	HOME: ROOT,
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
	LOCAL_OPERATOR_LOG_DIR: join(ROOT, "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
	LOCAL_OPERATOR_UI_TELEMETRY: "off",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PORT}`,
	VITE_DISABLE_BACKEND_MANAGER: "true",
});
const app = spawn(
	join(TREE, "node_modules/.bin/electron"),
	[
		TREE,
		"--window-mode=headless",
		`--remote-debugging-port=${DEBUG_PORT}`,
		`--user-data-dir=${PROFILE}`,
		`--window-size=${SIZE}`,
	],
	{ cwd: CWD, env, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
let appOut = "";
app.stdout.on("data", (d) => {
	appOut += d;
});
app.stderr.on("data", (d) => {
	appOut += d;
});
console.log(`# app pid ${app.pid}, scratch ${ROOT}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function findPage() {
	const list = await (
		await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
	).json();
	const pageTarget = list.find(
		(t) =>
			t.type === "page" &&
			t.webSocketDebuggerUrl &&
			!/^(about:blank|devtools:|chrome:)/.test(t.url ?? ""),
	);
	if (!pageTarget) throw new Error("no page");
	return pageTarget;
}
let socket = null;
let nextId = 0;
const pending = new Map();
async function connect() {
	const target = await findPage();
	socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	socket.addEventListener("message", (event) => {
		const message = JSON.parse(event.data);
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
		else waiter.resolve(message.result);
	});
}
function send(method, params = {}) {
	const id = ++nextId;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		setTimeout(() => {
			if (pending.delete(id)) reject(new Error(`${method} timed out`));
		}, 20_000);
	});
}
const evaluate = async (expression) =>
	(
		await send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
		})
	).result.value;
async function capture(name) {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(join(OUT, `${LABEL}-${MOMENT}-${THEME}-${SIZE}-${name}.png`), shot.data, "base64");
}

/** Every painted tool row: its call id, object column, and counters. */
const READ_ROWS = `(() => {
	const rows = [...document.querySelectorAll('[data-record-kind="tool"]')];
	return JSON.stringify({
		viewport: [innerWidth, innerHeight],
		rows: rows.map((row) => {
			const cells = row.querySelectorAll("span.truncate");
			const summary = cells[1]?.textContent ?? "";
			return {
				id: row.getAttribute("data-record-id"),
				name: cells[0]?.textContent ?? "",
				summary,
				counts: (row.innerText.match(/[+][0-9]+|[−-][0-9]+/g) ?? []).join(" "),
			};
		}),
	});
})()`;

const GEOM = `(() => {
	const rows = [...document.querySelectorAll('[data-record-kind="tool"]')];
	const out = [];
	for (const row of rows) {
		const r = row.getBoundingClientRect();
		if (r.bottom < 0 || r.top > innerHeight) continue;
		const cells = row.querySelectorAll("span.truncate");
		const s = cells[1];
		const sr = s?.getBoundingClientRect();
		out.push({ id: row.getAttribute("data-record-id"), top: Math.round(r.top*10)/10, h: Math.round(r.height*10)/10, left: Math.round(r.left), w: Math.round(r.width), cx: sr ? Math.round(sr.left) : null, cw: sr ? Math.round(sr.width) : null, sumW: s ? Math.round(sr.width) : null, text: (s?.textContent ?? "").slice(0, 30) });
	}
	let el = rows[0]?.parentElement;
	while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
	const er = el?.getBoundingClientRect();
	return JSON.stringify({ st: el?.scrollTop, sh: el?.scrollHeight, box: er ? [Math.round(er.left), Math.round(er.top), Math.round(er.width), Math.round(er.height)] : null, rows: out });
})()`;
const summary = { label: LABEL, moment: MOMENT, tree: TREE, frames: [] };
try {
	for (let i = 0; ; i++) {
		try {
			await connect();
			break;
		} catch (error) {
			if (i > 90) throw error;
			await wait(1_000);
		}
	}
	await wait(3_000);
	await evaluate(`(() => {
		localStorage.setItem("onboarding-storage", JSON.stringify({
			state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" },
			version: 0,
		}));
		localStorage.setItem("ui-preferences-storage", JSON.stringify({ state: { themeName: ${JSON.stringify(THEME)} }, version: 0 }));
		location.hash = "#/chat";
		location.reload();
		return "seeded";
	})()`).catch(() => {});
	await wait(4_000);
	socket.close();
	await connect();
	summary.windowMode = appOut.split("\n").find((l) => l.includes("[window-mode]"));

	// Open the conversation, the way a sidebar click does (the hash route).
	log.t0 = now();
	await evaluate(`(() => { performance.clearMarks(); location.hash = "#/chat/${SESSION}"; return 1; })()`);
	/*
	 * Poll the DOM every 100 ms: the first frame that paints tool rows is
	 * captured, then one frame per history response, then the settled frame.
	 * `standIns` counts painted rows whose object column holds the output
	 * stand-in ("… " prefix).
	 */
	const timeline = [];
	/**
	 * Per painted row: the class of its object column over time.
	 *
	 * `blank` is the held state (the column the pending hold leaves empty),
	 * `standin` the output fallback ("… " prefix) and `label` a real argument
	 * string. `arrival` buckets the FIRST time a row entered `standin` or
	 * `label`, in 50 ms bins: one bin holding every row is the mass appearance
	 * this round asks about, a spread of bins is per-row arrival.
	 */
	const trace = new Map();
	const arrival = { standin: {}, label: {} };
	const noteArrival = (cls, t) => {
		if (cls === "blank") return;
		const bucket = String(Math.round(t / 50) * 50);
		arrival[cls][bucket] = (arrival[cls][bucket] ?? 0) + 1;
	};
	const classify = (summary) =>
		summary === "" ? "blank" : summary.startsWith("… ") ? "standin" : "label";
	const sample = (rows, t) => {
		for (const r of rows) {
			const cls = classify(r.summary);
			const prev = trace.get(r.id);
			if (!prev) {
				trace.set(r.id, { first: cls, firstT: t, lastCls: cls, lastT: t, changes: 1, text: r.summary.slice(0, 40) });
				noteArrival(cls, t);
				continue;
			}
			if (prev.lastCls !== cls) {
				prev.lastCls = cls;
				prev.lastT = t;
				prev.changes += 1;
				noteArrival(cls, t);
			}
			prev.text = r.summary.slice(0, 40);
		}
	};
	const taken = new Set();
	const shots = [];
	let firstShot = false;
	let answered = 0;
	let lastState = "";
	let changeFrames = 0;
	const deadline = now() + RUN_MS;
	while (now() < deadline) {
		const snap = JSON.parse(await evaluate(READ_ROWS));
		const standIns = snap.rows.filter((r) => r.summary.startsWith("… ")).length;
		const blank = snap.rows.filter((r) => r.summary === "").length;
		const t = now() - log.t0;
		const g = firstShot ? JSON.parse(await evaluate(GEOM)) : null;
		timeline.push({ t, rows: snap.rows.length, standIns, blank, geom: g });
		if (firstShot) sample(snap.rows, t);
		if (!firstShot && snap.rows.length > 0) {
			firstShot = true;
			await capture("01-first-frame");
			summary.frames.push({ name: "01-first-frame", t, standIns, blank, rows: snap.rows.length, sample: snap.rows });
			/*
			 * The same first paint, scrolled (programmatically: the paging hook
			 * ignores scrollTop writes) to the seeded rows the page could not
			 * label — still before any read has answered.
			 */
			const target = MOMENT === "counts"
				? "tool:toolu_01U3Y21CrbaP1HVMGcKMapJu"
				: snap.rows.find((r) => r.summary === "")?.id;
			if (target) {
				await evaluate(`(() => { document.querySelector('[data-record-id="${target}"]')?.scrollIntoView({ block: "center" }); return 1; })()`);
				await wait(120);
				const pre = log.history.every((h) => h.answeredAt === undefined);
				await capture("01b-first-frame-seed-rows");
				summary.frames.push({ name: "01b-first-frame-seed-rows", t: now() - log.t0, target, beforeReadAnswered: pre });
			}
		}
		/*
		 * A frame at every STATE CHANGE of the object column, which is how the
		 * two sides of the 3 s release get photographed without knowing when the
		 * release fires. Bounded, so a walk that labels rows page by page cannot
		 * fill the output directory.
		 */
		const state = `${blank}b${standIns}s`;
		if (firstShot && state !== lastState) {
			lastState = state;
			if (changeFrames < 12) {
				changeFrames += 1;
				await capture(`state-${String(t).padStart(5, "0")}-${state}`);
				summary.frames.push({ name: `state-${String(t).padStart(5, "0")}-${state}`, t, blank, standIns, rows: snap.rows.length });
			}
		}
		for (const shot of SHOTS)
			if (t >= shot && !taken.has(shot)) {
				taken.add(shot);
				await capture(`cap-${String(shot).padStart(5, "0")}`);
				shots.push({ shot, t, blank, standIns, rows: snap.rows.length, sample: snap.rows });
			}
		const done = log.history.filter((h) => h.answeredAt !== undefined).length;
		if (firstShot && done > answered) {
			answered = done;
			await wait(250);
			const after = JSON.parse(await evaluate(READ_ROWS));
			const name = `02-after-read-${done}`;
			await capture(name);
			summary.frames.push({
				name,
				t: now() - log.t0,
				standIns: after.rows.filter((r) => r.summary.startsWith("… ")).length,
				rows: after.rows.length,
			});
		}
		if (firstShot && (HANG ? t > RUN_MS - 800 : done > 0 && t > HISTORY_DELAY_MS + 1_200))
			break;
		await wait(LOOP_MS);
	}
	summary.timeline = timeline;
	summary.trace = [...trace.entries()].map(([id, v]) => ({
		id,
		first: v.first,
		firstT: v.firstT,
		lastCls: v.lastCls,
		lastT: v.lastT,
		changes: v.changes,
		text: v.text,
	}));
	summary.arrival = arrival;
	summary.shots = shots;
	if (MOMENT === "counts") {
		await evaluate(`(() => { document.querySelector('[data-record-id="tool:toolu_01U3Y21CrbaP1HVMGcKMapJu"]')?.scrollIntoView({ block: "center" }); return 1; })()`);
		await wait(300);
	}
	await capture("03-settled");
	const settled = JSON.parse(await evaluate(READ_ROWS));
	summary.settled = settled;

	if (SCENE === "switchback") {
		/*
		 * Leave the conversation and come back. The session id in the hash
		 * changes, so the chat pane UNMOUNTS and re-mounts — the case the
		 * per-conversation gap bookkeeping (`labelGaps`) exists for: a remount
		 * must not re-hold rows this window has already painted.
		 */
		const settledText = new Map(settled.rows.map((r) => [r.id, r.summary]));
		summary.switchback = { away: [], back: [], firstPaint: null, differences: [] };
		/*
		 * The scroll offset an open leaves behind is not the one a remount
		 * restores, so a whole-frame pixel comparison needs the two frames at
		 * the SAME offset or it measures the offset rather than the content.
		 */
		summary.switchback.settledGeom = JSON.parse(await evaluate(GEOM));
		await evaluate(`(() => { location.hash = "#/chat/000000000000"; return 1; })()`);
		for (let i = 0; i < 12; i++) {
			await wait(120);
			summary.switchback.away.push(JSON.parse(await evaluate(READ_ROWS)).rows.length);
		}
		await capture("05-away");
		await evaluate(`(() => { location.hash = "#/chat/${SESSION}"; return 1; })()`);
		const backT0 = now();
		let stable = 0;
		let last = "";
		let early = false;
		for (let i = 0; i < 80; i++) {
			const snap = JSON.parse(await evaluate(READ_ROWS));
			const blank = snap.rows.filter((r) => r.summary === "").length;
			const standIns = snap.rows.filter((r) => r.summary.startsWith("… ")).length;
			const t = now() - backT0;
			summary.switchback.back.push({ t, rows: snap.rows.length, blank, standIns });
			if (!early && snap.rows.length > 0) {
				early = true;
				summary.switchback.firstPaint = { t, rows: snap.rows.length, blank, standIns };
				await capture("06-switchback-first-paint");
			}
			const stateKey = `${snap.rows.length}:${blank}:${standIns}`;
			stable = stateKey === last ? stable + 1 : 0;
			last = stateKey;
			if (t > 2_500 && stable > 8) break;
			await wait(100);
		}
		await capture("07-switchback-settled");
		const returned = JSON.parse(await evaluate(READ_ROWS));
		summary.switchback.returned = returned;
		summary.switchback.blankSamples = summary.switchback.back.filter((s) => s.blank > 0).length;
		summary.switchback.backSamples = summary.switchback.back.length;
		for (const r of returned.rows) {
			const was = settledText.get(r.id);
			if (was !== undefined && was !== r.summary)
				summary.switchback.differences.push({
					id: r.id,
					was: was.slice(0, 40),
					now: r.summary.slice(0, 40),
				});
		}
		summary.switchback.returnedGeom = JSON.parse(await evaluate(GEOM));
		/*
		 * Align the return to the offset the open settled at, then photograph it,
		 * so `03-settled` and `08-return-aligned` differ by content alone.
		 */
		const target = summary.switchback.settledGeom.st;
		await evaluate(`(() => {
			const row = document.querySelector('[data-record-id]');
			let el = row?.parentElement;
			while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
			if (el) el.scrollTop = ${target};
			return 1;
		})()`);
		await wait(600);
		summary.switchback.alignedGeom = JSON.parse(await evaluate(GEOM));
		await capture("08-return-aligned");
	}

	// Now hold every further read (a reader's own scroll-up paging) and reveal
	// the whole painted transcript, to count what the OPEN left unlabelled.
	if (SCENE === "open") {
	state.frozen = true;
	const opened = log.history.length;
	/*
	 * A reader's own scroll-up, as real wheel input (the paging hook listens to
	 * `wheel`, not to scrollTop writes). The stub is FROZEN now: any durable
	 * page this triggers is logged and held unanswered, so what is counted below
	 * is what the OPEN left behind, not what scroll-up paging would backfill.
	 */
	summary.reveal = [];
	const box = JSON.parse(await evaluate(`(() => {
		const row = document.querySelector('[data-record-id]');
		let el = row?.parentElement;
		while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
		const r = el.getBoundingClientRect();
		return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
	})()`));
	for (let i = 0; i < 40; i++) {
		await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -1200 });
		await wait(150);
		if (i % 5 === 4)
			summary.reveal.push(JSON.parse(await evaluate(`(() => {
				const row = document.querySelector('[data-record-id]');
				let el = row?.parentElement;
				while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
				const hit = document.elementFromPoint(${box.x}, ${box.y});
				return JSON.stringify({ rows: document.querySelectorAll('[data-record-kind]').length, st: el?.scrollTop, sh: el?.scrollHeight, ch: el?.clientHeight, dir: el && getComputedStyle(el).flexDirection, hitInside: Boolean(el && hit && el.contains(hit)) });
			})()`)));
	}
	await wait(800);
	const all = JSON.parse(await evaluate(READ_ROWS));
	summary.revealed = {
		rows: all.rows.length,
		standIns: all.rows.filter((r) => r.summary.startsWith("… ")),
		readsAfterOpen: log.history.length - opened,
	};
	// A frame at the oldest stand-ins, if any, so the reported rows are on screen.
	const first = summary.revealed.standIns[0]?.id;
	if (first) {
		await evaluate(`(() => { document.querySelector('[data-record-id="${first}"]').scrollIntoView({ block: "start" }); return 1; })()`);
		await wait(500);
	} else {
		await evaluate(`(() => { const row = document.querySelector('[data-record-id]'); row?.scrollIntoView({ block: "start" }); return 1; })()`);
		await wait(500);
	}
	await capture("04-revealed-oldest");
	}
	summary.history = log.history;
	summary.snapshotAt = log.snapshotAt;
	summary.unknownRoutes = [...new Set(log.unknown)];
	summary.marks = JSON.parse(
		await evaluate(`JSON.stringify(performance.getEntriesByType("measure").filter((m) => m.name.startsWith("lop:")).length)`),
	);
} catch (error) {
	summary.error = String(error?.stack ?? error);
	console.error(error);
	console.error(appOut.slice(-3000));
} finally {
	writeFileSync(join(OUT, `${LABEL}-${MOMENT}-${THEME}-${SIZE}.json`), JSON.stringify(summary, null, 2));
	try {
		socket?.close();
	} catch {}
	clearInterval(heartbeat);
	try {
		process.kill(-app.pid, "SIGTERM");
	} catch {}
	await wait(2_000);
	try {
		process.kill(-app.pid, "SIGKILL");
	} catch {}
	const literal = PROFILE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	spawnSync("pkill", ["-f", `user-data-dir=${literal}`], { stdio: "ignore" });
	server.close();
	server.closeAllConnections?.();
	console.log(
		JSON.stringify({
			label: LABEL,
			moment: MOMENT,
			historyRequests: summary.history?.map((h) => [h.at, h.limit, h.beforeId ? "before" : "tail", h.rows, h.answeredAt]),
			firstFrame: summary.frames?.[0] && { standIns: summary.frames[0].standIns, blank: summary.frames[0].blank, rows: summary.frames[0].rows },
			revealed: summary.revealed && { rows: summary.revealed.rows, standIns: summary.revealed.standIns.length, reads: summary.revealed.readsAfterOpen },
			reveal: summary.reveal,
			unknownRoutes: summary.unknownRoutes,
			error: summary.error?.slice(0, 300),
		}),
	);
	process.exit(0);
}
