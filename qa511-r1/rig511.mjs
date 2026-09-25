#!/usr/bin/env node
/**
 * QA round 1 rig for local-operator-ui PR #511 (the PR-490 r7 rig's infrastructure, its scenario body replaced).
 *
 *   node qa-rig.mjs --tree <worktree> --label <head|base> --scen <file.json> --out <dir> [--port N]
 *
 * Boots <tree>'s BUILT app headless (--window-mode=headless, scratch HOME /
 * config / user-data-dir / cwd, CMUX and LOP variables never passed), against a stub
 * backend on a scratch port that serves the scenario's sessions over the real
 * desktop wire (SSE open+snapshot, /history with before_id-exclusive paging).
 * Every /history request is logged. The app process group is reaped by pid.
 *
 * Scenario keys: sessions{id:{journal,page_n,streaming,live_events,title}},
 * open, delay (ms before /history answers), history: ok|fail|hang,
 * switchTo (e-switch), live (g-live: push scripted live events after open).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, basename } from "node:path";

const arg = (n, d = null) => {
	const i = process.argv.indexOf(n);
	return i === -1 ? d : process.argv[i + 1];
};
const TREE = arg("--tree");
const LABEL = arg("--label");
const SCEN_FILE = arg("--scen");
const OUT = arg("--out");
const PORT = Number(arg("--port", "46511"));
const DEBUG_PORT = PORT + 1;
const scen = JSON.parse(readFileSync(SCEN_FILE, "utf8"));
const NAME = basename(SCEN_FILE, ".json");
const DELAY = Number(scen.delay ?? 300);
mkdirSync(OUT, { recursive: true });

const ROOT = mkdtempSync(join(process.env.LOCAL_OPERATOR_SCRATCHPAD, `qa490-${LABEL}-${NAME}-`));
const CONFIG_DIR = join(ROOT, "config");
const RUN_DIR = join(CONFIG_DIR, "run", "serve");
const PROFILE = join(ROOT, "profile");
const CWD = join(ROOT, "cwd");
for (const d of [RUN_DIR, PROFILE, CWD]) mkdirSync(d, { recursive: true });

const now = () => Date.now();
const log = { t0: now(), history: [], unknown: [], streams: [] };
const state = { historyMode: scen.history ?? "ok", streams: {} };

const frontend = (sid) => {
	const s = scen.sessions[sid];
	const page = s.journal.slice(-s.page_n);
	return {
		state_version: 1,
		epoch: "owner-epoch",
		sequence: 2,
		live_cursor: page.at(-1).id,
		snapshot: {
			epoch: "owner-epoch", sequence: 2, cwd: "~", conversation_title: s.title,
			conversation_title_user_set: true, conversation_title_forked: false, goal: "",
			active_agent: "", active_team: "", selected_model: null, effective_model: null,
			streaming: s.streaming, generation: 1, pending_gate: null,
			history_cursor: page.at(-1).id, live_events: s.live_events,
			live_tool_started_at: {}, queued_steering: [], jobs: s.jobs ?? [], subagents: s.subagents ?? [], todos: [], wakes: [],
			mcp_servers: [], model_catalogue: [], context_tokens: null, context_is_estimate: null,
			context_window: null, context_breakdown: null, cumulative_parent_cost: null,
			subagent_cost: null, cost_knowledge: "unknown", last_usage: null, attention: null,
		},
	};
};

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
	const p = url.pathname;
	const json = (st, body) => {
		res.writeHead(st, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	if (p === "/health")
		return json(200, { status: 200, result: { version: "0.62.17", instance_id: "qa490", pid: process.pid, prefix: "/tmp/qa490", install_kind: "uv-tool" } });
	if (p === "/v1/capabilities")
		return json(200, { status: 200, result: { desktop_available: true, features: { session_catalogue: 2, profile_catalogue: 1, team_catalogue: 1, auth: 1, settings: 1, commands: 1, catalogues: 1, lifecycle: 1, mcp: 1 } } });
	if (p === "/v1/desktop/claim") return json(200, { status: 200 });
	if (p === "/v1/config")
		return json(200, { status: 200, result: { version: "0.12.8", metadata: { created_at: "2025-06-18T11:02:00Z", last_modified: "2026-09-15T00:00:00Z", description: "qa490" }, values: { conversation_length: 100, detail_length: 15, max_learnings_history: 50, hosting: "openrouter", model_name: "anthropic/claude-sonnet-4", auto_save_conversation: true } } });
	if (p === "/v1/desktop/profiles") return json(200, { status: 200, result: { profiles: [] } });
	if (p === "/v1/desktop/teams") return json(200, { status: 200, result: { teams: [] } });
	if (p === "/v1/desktop/sessions")
		return json(200, { status: 200, result: { sessions: Object.entries(scen.sessions).map(([id, s], i) => ({ id, name: s.title, mtime: Math.floor(now() / 1000) - 30 - i, cwd: "~" })), truncated: false, limit: 500 } });
	const hm = p.match(/^\/v1\/desktop\/sessions\/([^/]+)\/history$/);
	if (hm && scen.sessions[hm[1]]) {
		const sid = hm[1];
		const s = scen.sessions[sid];
		const asked = Number(url.searchParams.get("limit") ?? 100);
		/*
		 * `page_cap` models an owner that answers a request for N rows with fewer and
		 * `has_more: true`. It is the shape the row bound alone cannot bound, which is
		 * what RECONCILE_WALK_MAX_REQUESTS exists for (round 1, R4).
		 */
		const limit = scen.page_cap ? Math.min(asked, Number(scen.page_cap)) : asked;
		const beforeId = url.searchParams.get("before_id");
		const entry = { sid, at: now() - log.t0, limit, asked, beforeId: beforeId ?? null, mode: state.historyMode, from_id: null, to_id: null, has_target: null, target_in_page: null };
		log.history.push(entry);
		if (state.historyMode === "hang") return; // never answered
		if (state.historyMode === "fail")
			return setTimeout(() => { entry.answeredAt = now() - log.t0; entry.status = 503; json(503, { detail: "qa: history unavailable" }); }, Number(scen.delay ?? 300));
		const end = beforeId ? s.journal.findIndex((r) => r.id === beforeId) : s.journal.length;
		const stop = end < 0 ? s.journal.length : end;
		const start = Math.max(0, stop - limit);
		setTimeout(() => {
			entry.answeredAt = now() - log.t0;
			entry.rows = stop - start;
			/* WHICH rows the page carried, so 'the app never held this call's arguments' is a
			 * wire reading rather than an inference from the read's size. */
			entry.from_id = s.journal[start]?.id ?? null;
			entry.to_id = s.journal[stop - 1]?.id ?? null;
			entry.rows_from = start + 1;
			entry.rows_to = stop;
			entry.has_target = (scen.settles ?? []).filter((id) =>
				s.journal.slice(start, stop).some((r) => (r.payload?.tool_calls ?? []).some((c) => c?.id === id)));
			entry.target_in_page = (scen.settles ?? []).filter((id) =>
				s.journal.slice(Math.max(0, stop - (scen.sessions[sid]?.page_n ?? 100)), stop).some((r) => (r.payload?.tool_calls ?? []).some((c) => c?.id === id)));
			json(200, { status: 200, result: { entries: s.journal.slice(start, stop), has_more: start > 0, cursor_missing: false } });
		}, Number(scen.delay ?? 300));
		return;
	}
	const em = p.match(/^\/v1\/desktop\/sessions\/([^/]+)\/events$/);
	if (em && scen.sessions[em[1]]) {
		const sid = em[1];
		const s = scen.sessions[sid];
		res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
		let seq = 0;
		const send = (frame) => res.write(`data: ${JSON.stringify({ session_id: sid, epoch: "bridge-epoch", seq: ++seq, ...frame })}\n\n`);
		log.streams.push({ sid, at: now() - log.t0 });
		send({ type: "open", payload: { subscription_id: `sub-${sid}`, gap: false, watch_ttl_seconds: 45 } });
		send({ type: "snapshot", payload: { frontend: frontend(sid), history: { entries: s.journal.slice(-s.page_n), has_more: s.journal.length > s.page_n, cursor_missing: false }, cold: false, ...(scen.legacy_snapshot ? {} : { cold_reason: null, attaching: false }) } });
		state.streams[sid] = { send };
		const keep = setInterval(() => res.write(": keep-alive\n\n"), 5000);
		req.on("close", () => { clearInterval(keep); if (state.streams[sid]?.send === send) delete state.streams[sid]; });
		return;
	}
	if (p === "/v1/auth/providers" || p === "/v1/auth/status") return json(200, { status: 200, result: { providers: [], accounts: [] } });
	log.unknown.push(`${req.method} ${p}`);
	json(404, { detail: "not part of this rig" });
});
server.listen(PORT, "127.0.0.1");

const writeRecord = () => writeFileSync(join(RUN_DIR, `${process.pid}.json`), JSON.stringify({ pid: process.pid, host: "127.0.0.1", port: PORT, instance_id: "qa490", version: "0.62.17", source_ref: "", prefix: "/tmp/qa490", install_kind: "uv-tool", desktop: false, claim_key: "a".repeat(64), started_at: now() / 1000 - 10, heartbeat_at: now() / 1000 }), { mode: 0o600 });
writeRecord();
const heartbeat = setInterval(writeRecord, 5000);

// Environment: an allow-list, so nothing CMUX_*/LOP_*/XPC_* is inherited.
const env = {};
for (const k of ["PATH", "LANG", "TERM"]) if (process.env[k]) env[k] = process.env[k];
Object.assign(env, {
	HOME: ROOT, TMPDIR: join(ROOT, "tmp"),
	LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR, LOCAL_OPERATOR_LOG_DIR: join(ROOT, "logs"),
	LOCAL_OPERATOR_UI_WINDOW_MODE: "headless", LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
	LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1", LOCAL_OPERATOR_UI_TELEMETRY: "off",
	VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PORT}`, VITE_DISABLE_BACKEND_MANAGER: "true",
});
mkdirSync(env.TMPDIR, { recursive: true });
const app = spawn(join(TREE, "node_modules/.bin/electron"), [TREE, "--window-mode=headless", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE}`, "--window-size=1380x900"], { cwd: CWD, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let appOut = "";
app.stdout.on("data", (d) => { appOut += d; });
app.stderr.on("data", (d) => { appOut += d; });
console.log(`# ${LABEL} ${NAME}: app pid ${app.pid} pgid ${app.pid}, scratch ${ROOT}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let socket = null, nextId = 0;
const pending = new Map();
async function connect() {
	const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
	const t = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl && !/^(about:blank|devtools:|chrome:)/.test(x.url ?? ""));
	if (!t) throw new Error("no page");
	socket = new WebSocket(t.webSocketDebuggerUrl);
	await new Promise((ok, ko) => { socket.addEventListener("open", ok, { once: true }); socket.addEventListener("error", ko, { once: true }); });
	socket.addEventListener("message", (ev) => {
		const msg = JSON.parse(ev.data);
		const w = pending.get(msg.id);
		if (!w) return;
		pending.delete(msg.id);
		msg.error ? w.ko(new Error(JSON.stringify(msg.error))) : w.ok(msg.result);
	});
}
function send(method, params = {}) {
	const id = ++nextId;
	socket.send(JSON.stringify({ id, method, params }));
	return new Promise((ok, ko) => { pending.set(id, { ok, ko }); setTimeout(() => { if (pending.delete(id)) ko(new Error(`${method} timed out`)); }, 20000); });
}
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
const capture = async (name) => {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	const f = join(OUT, `${LABEL}-${NAME}-${name}.png`);
	writeFileSync(f, shot.data, "base64");
	return f;
};
const READ_ROWS = `(() => {
	const rows = [...document.querySelectorAll('[data-record-kind="tool"]')];
	return JSON.stringify({ hash: location.hash, viewport: [innerWidth, innerHeight], rows: rows.map((row) => {
		const cells = row.querySelectorAll("span.truncate");
		return { id: row.getAttribute("data-record-id"), name: cells[0]?.textContent ?? "", summary: cells[1]?.textContent ?? "",
			counts: (row.innerText.match(/[+][0-9]+|[−-][0-9]+/g) ?? []).join(" ") };
	}) });
})()`;
const read = async () => JSON.parse(await evaluate(READ_ROWS));
const tally = (snap) => ({ rows: snap.rows.length, standIns: snap.rows.filter((r) => r.summary.startsWith("… ")).length, blank: snap.rows.filter((r) => r.summary === "").length });

const SAMPLER = (ms, key = "__qaFrames") => `(() => { window["${key}"] = []; const t0 = performance.now(); const tick = () => { const rows = [...document.querySelectorAll('[data-record-kind="tool"]')]; let s = 0, b = 0; for (const r of rows) { const c = r.querySelectorAll("span.truncate")[1]?.textContent ?? ""; if (c.startsWith("… ")) s++; else if (c === "") b++; } window["${key}"].push([Math.round(performance.now() - t0), location.hash.slice(-4), rows.length, s, b]); if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 1; })()`;
const frameRuns = async (key = "__qaFrames") => { const fr = JSON.parse(await evaluate(`JSON.stringify(window.${key})`)); const runs = []; for (const f of fr) { const k = f.slice(1).join(","); if (!runs.length || runs.at(-1).k !== k) runs.push({ k, from: f[0], to: f[0], frames: 1 }); else { runs.at(-1).to = f[0]; runs.at(-1).frames++; } } return runs; };
/*
 * Frame runs over the per-target sampler: one row per contiguous stretch in which
 * the SAME target states held, so a stand-in run that precedes a labelled run is
 * legible as two runs rather than as one blur.
 */
const frameRunsLike = (frames, targets) => {
	const runs = [];
	for (const f of frames) {
		const k = f.slice(1, 1 + targets).join(",");
		if (!runs.length || runs.at(-1).k !== k) runs.push({ k, from: f[0], to: f[0], frames: 1, rows: f[1 + targets] });
		else { runs.at(-1).to = f[0]; runs.at(-1).frames++; }
	}
	return runs;
};
const summary = { label: LABEL, scen: NAME, tree: TREE, events: [] };
/**
 * Scenarios whose measurement window is the clock rather than the app's quiet:
 * how long the open is allowed to run before the counts are read.
 */
const FIXED_MS = {
	"switch-loop": 9000,
	"switch-loop-r2": 9000,
	"switch-loop-r3": 9000,
	"j-firstround": 16000,
	"k-shortpages": 12000,
	"f2-retry": 10000,
	"n1-refind": 6000,
	"n1-refind-noframe": 6000,
	"n1-refind-big": 6000,
	"n1-refind-big-benign": 6000,
	"hold-across-switch": 500,
};
const mark = (what, extra = {}) => { const e = { t: now() - log.t0, what, ...extra }; summary.events.push(e); return e; };

async function scrollAll() {
	// Mount every painted row: real wheel input to the top (older-history paging is
	// whatever the stub answers; for (a) we freeze history first).
	const box = JSON.parse(await evaluate(`(() => { const row = document.querySelector('[data-record-id]'); let el = row?.parentElement; while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement; const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
	for (let i = 0; i < 40; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -1200 }); await wait(120); }
	await wait(800);
}
/* ---------------------------------------------------------------------------
 * QA round 1, PR 511 — the runner (scratch; never part of the repo).
 *
 * The measurement this round exists for: a LIVE SETTLE (a `tool_execution_end`
 * delivered over the stream while the turn runs) paints a row with no arguments,
 * and on the parent head it asks for nothing - the row keeps its
 * `outputFallbackLine` stand-in in the object column. On this head it is added to
 * the same bounded label-target set the snapshot's seed fills, so ONE read
 * arrives and the row becomes the command.
 *
 * Instruments, all in-page and frame-accurate:
 *   - `probeRow(id)` reads one row's object column by `data-record-id`, falling
 *     back to a substring scan when the row is painted under another id.
 *   - `SAMPLER_TARGETS` samples every target row's state on EVERY painted frame
 *     (0 absent, 1 blank, 2 output stand-in, 3 labelled), on the page's own clock,
 *     against the push instant recorded in the page - so "latency to labelled"
 *     is a frame measurement rather than a poll interval.
 *   - the stub logs every `/history` request with the row range it answered, so a
 *     read can be attributed to a row and the "was this call ever delivered?"
 *     question is answered from the wire rather than inferred.
 * ------------------------------------------------------------------------- */
const ROW = scen.row ?? "r1";
const SETTLES = scen.settles ?? [];
const SETTLE_FRAMES = scen.settle_frames ?? {};
const GAP_MS = Number(scen.gap_ms ?? 2000);
const HANG = scen.history === "hang";
const POLL_MS = 150;

const probeRow = async (id) =>
	JSON.parse(
		await evaluate(`(() => {
	const all = [...document.querySelectorAll('[data-record-id]')];
	const el = document.querySelector('[data-record-id="tool:' + ${JSON.stringify(id)} + '"]') ?? all.find((e) => (e.getAttribute("data-record-id") ?? "").includes(${JSON.stringify(id)}));
	if (!el) return JSON.stringify({ id: ${JSON.stringify(id)}, mounted: false, ids: all.map((e) => e.getAttribute("data-record-id")).filter((x) => x && x.includes(${JSON.stringify(id)})) });
	const cells = el.querySelectorAll("span.truncate");
	const summary = cells[1]?.textContent ?? "";
	return JSON.stringify({ id: ${JSON.stringify(id)}, mounted: true, name: cells[0]?.textContent ?? "", summary, standIn: summary.startsWith("\\u2026 "), blank: summary === "", labelled: summary !== "" && !summary.startsWith("\\u2026 "), counts: (el.innerText.match(/[+][0-9]+|[\\u2212-][0-9]+/g) ?? []).join(" "), text: el.innerText.slice(0, 160) });
})()`),
	);

const SAMPLER_TARGETS = (ids, ms, key = "__qaLive") => `(() => {
	window["${key}"] = []; window.__qaPushes = [];
	const ids = ${JSON.stringify(ids)};
	const t0 = performance.now();
	const state = (id) => {
		const all = [...document.querySelectorAll('[data-record-id]')];
		const el = document.querySelector('[data-record-id="tool:' + id + '"]') ?? all.find((e) => (e.getAttribute("data-record-id") ?? "").includes(id));
		if (!el) return 0;
		const s = el.querySelectorAll("span.truncate")[1]?.textContent ?? "";
		if (s === "") return 1;
		return s.startsWith("\\u2026 ") ? 2 : 3;
	};
	const tick = () => {
		window["${key}"].push([Math.round(performance.now()), ...ids.map(state), document.querySelectorAll('[data-record-kind="tool"]').length]);
		if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return 1;
})()`;

const pushSettle = async (id) => {
	const f = SETTLE_FRAMES[id] ?? {};
	const payload = {
		type: "tool_execution_end",
		tool_call_id: id,
		tool_name: f.name ?? "bash",
		result: { content: [{ text: f.text ?? "(no text on this frame)" }], details: f.details ?? null },
		duration_s: f.duration_s ?? 0.2,
		is_error: false,
	};
	// The wire's own shape: the backend copies the call's start instant onto the
	// retained end when it saw the start (frontend_state._fold_live_event), and
	// omits the key entirely when it did not.  `started_at_epoch: null` in the
	// scenario means "states no time".
	if (f.started_at_epoch !== undefined && f.started_at_epoch !== null) payload.started_at_epoch = f.started_at_epoch;
	await evaluate(`(() => { window.__qaPushes = window.__qaPushes || []; window.__qaPushes.push({ at: performance.now(), id: ${JSON.stringify(id)} }); return 1; })()`);
	state.streams[scen.open].send({ type: "event", payload });
	return payload;
};

const readsFrom = (n) => log.history.slice(n).map((h) => ({ at: h.at, limit: h.limit, before: h.beforeId, from: h.from_id, to: h.to_id, rows: h.rows, answeredAt: h.answeredAt, has_target: h.has_target }));

try {
	for (let i = 0; ; i++) {
		try {
			await connect();
			break;
		} catch (e) {
			if (i > 90) throw e;
			await wait(1000);
		}
	}
	await wait(3000);
	await evaluate(`(() => { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" }, version: 0 })); location.hash = "#/chat"; location.reload(); return 1; })()`).catch(() => {});
	await wait(4000);
	socket.close();
	await connect();
	summary.windowMode = appOut.split("\n").find((l) => l.includes("[window-mode]"));
	summary.urls = appOut.split("\n").filter((l) => /violates the following Content Security Policy|Connecting to /.test(l)).slice(0, 3);

	/* ---------------------------------------------------------------- the open */
	const beforeOpen = log.history.length;
	log.t0 = now();
	await evaluate(SAMPLER(6000));
	await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
	const timeline = [];
	let first = null;
	const deadline = now() + (HANG ? 20000 : 20000);
	while (now() < deadline) {
		const snap = await read();
		const t = tally(snap);
		timeline.push({ t: now() - log.t0, ...t, reads: log.history.length, answered: log.history.filter((h) => h.answeredAt !== undefined).length });
		if (!first && t.rows > 0) {
			first = { t: now() - log.t0, ...t, sample: snap.rows.slice(0, 60), ids: snap.rows.map((r) => r.id) };
			summary.first = first;
			summary.firstShot = { file: await capture("01-first-frame"), standIns: t.standIns, blank: t.blank, rows: t.rows };
		}
		if (HANG && first && t.blank === 0 && t.standIns > 0) break;
		if (!HANG && first) {
			const readsSettled = log.history.length > beforeOpen && log.history.every((h) => h.answeredAt !== undefined);
			const quiet = now() - log.t0 > 2500 && log.history.length === beforeOpen;
			if (readsSettled || quiet) {
				await wait(600);
				break;
			}
		}
		await wait(POLL_MS);
	}
	await wait(500);
	summary.openTimeline = timeline;
	summary.openFrames = await frameRuns();
	summary.openReads = readsFrom(beforeOpen);
	summary.readsAtOpen = log.history.length - beforeOpen;
	const settledOpen = await read();
	summary.settledOpen = { ...tally(settledOpen), standInRows: settledOpen.rows.filter((r) => r.summary.startsWith("… ")).map((r) => r.id).slice(0, 200) };
	summary.domAtOpen = JSON.parse(
		await evaluate(
			`JSON.stringify({ ids: [...document.querySelectorAll('[data-record-id]')].map((e) => e.getAttribute('data-record-id')), standIns: [...document.querySelectorAll('[data-record-kind="tool"]')].map((el) => { const c = el.querySelectorAll("span.truncate"); const s = c[1]?.textContent ?? ""; return s.startsWith("\\u2026 ") ? { id: el.getAttribute("data-record-id"), summary: s.slice(0, 60) } : null; }).filter(Boolean) })`,
		),
	);
	summary.settledShot = await capture("02-settled");

	/* -------------------------------------------------------------- row 4b: loop */
	if (ROW === "r4b") {
		const other = Object.keys(scen.sessions).find((k) => k !== scen.open);
		state.historyMode = "hang"; // frozen: no later return can be labelled
		const readsBefore = log.history.length;
		await evaluate(SAMPLER(9000, "__qaSwitch"));
		const cycles = [];
		for (let i = 0; i < 6; i++) {
			await evaluate(`(() => { location.hash = "#/chat/${other}"; return 1; })()`);
			await wait(350);
			const b = await read();
			await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
			await wait(350);
			const a = await read();
			cycles.push({ i, onOther: tally(b), backOnA: tally(a) });
		}
		await wait(3000);
		summary.switchLoop = { cycles, readsDuringCycles: log.history.length - readsBefore };
		summary.switchLoopFrames = await frameRuns("__qaSwitch");
		summary.switchLoopSettled = tally(await read());
		await capture("03-switch-loop");
	}

	/* ------------------------------------------------- rows 1/2/3/5: live settles */
	if (SETTLES.length > 0) {
		summary.preSettleRows = [];
		for (const id of SETTLES) summary.preSettleRows.push(await probeRow(id));
		/*
		 * Every settle is measured WITHOUT a scroll or a re-open: the sampler runs
		 * from before the first push, and the row is probed in the DOM as painted.
		 * Only after every settle has been measured does the run scroll (and it says
		 * so), so "the label arrived with no scroll" is a reading rather than a claim.
		 */
		const sampleMs = Math.max(6000, SETTLES.length * (GAP_MS + 3500));
		await evaluate(SAMPLER_TARGETS(SETTLES, sampleMs));
		summary.settleResults = [];
		for (let i = 0; i < SETTLES.length; i++) {
			const id = SETTLES[i];
			const readsBefore = log.history.length;
			const payload = await pushSettle(id);
			mark("settle-pushed", { id, i, readsBefore, started_at_epoch: payload.started_at_epoch ?? null });
			let row = await probeRow(id);
			const deadline = now() + 12000;
			while (now() < deadline) {
				if (row.labelled) break;
				await wait(100);
				row = await probeRow(id);
			}
			const res = {
				id,
				index: i,
				started_at_epoch: payload.started_at_epoch ?? null,
				labelled: row.labelled,
				row: { mounted: row.mounted, name: row.name, summary: (row.summary ?? "").slice(0, 90), counts: row.counts, ids: row.ids },
				readsAdded: readsFrom(readsBefore),
				readsWhileLabelPending: log.history.length - readsBefore,
				mountedAtPush: (await probeRow(id)).mounted,
			};
			summary.settleResults.push(res);
			if (i + 1 < SETTLES.length) await wait(GAP_MS);
		}
		await wait(1500);
		const frames = JSON.parse(await evaluate("JSON.stringify(window.__qaLive)"));
		const pushes = JSON.parse(await evaluate("JSON.stringify(window.__qaPushes)"));
		summary.latency = SETTLES.map((id, i) => {
			const push = pushes.find((p) => p.id === id);
			if (!push) return { id, push: null };
			const after = frames.filter((f) => f[0] >= push.at);
			const firstStandIn = after.find((f) => f[1 + i] >= 2);
			const firstLabelled = after.find((f) => f[1 + i] === 3);
			return {
				id,
				index: i,
				msToStandIn: firstStandIn ? firstStandIn[0] - push.at : null,
				msToLabelled: firstLabelled ? firstLabelled[0] - push.at : null,
				framesSampled: after.length,
			};
		});
		summary.settleFrames = await frameRunsLike(frames, SETTLES.length);
		summary.postSettleRows = [];
		for (const id of SETTLES) summary.postSettleRows.push(await probeRow(id));
		summary.standInsAfterSettle = JSON.parse(
			await evaluate(
				`JSON.stringify([...document.querySelectorAll('[data-record-kind="tool"]')].map((el) => { const c = el.querySelectorAll("span.truncate"); const s = c[1]?.textContent ?? ""; return s.startsWith("\\u2026 ") ? { id: el.getAttribute("data-record-id"), name: c[0]?.textContent ?? "", summary: s.slice(0, 70) } : null; }).filter(Boolean))`,
			),
		);
		summary.readsAfterSettle = log.history.length;
		await capture("03-after-settle");
		/* Only now, and only to mount rows the no-scroll reading could not see. */
		const unmounted = summary.postSettleRows.filter((r) => !r.mounted);
		if (unmounted.length > 0) {
			const readsBeforeScroll = log.history.length;
			await scrollAll();
			summary.postScroll = { readsFromScroll: readsFrom(readsBeforeScroll), rows: [] };
			for (const id of SETTLES) summary.postScroll.rows.push(await probeRow(id));
			await capture("04-post-scroll");
		}
	}

	/* --------------------------------------------------- row 4f: the edit row */
	if (ROW === "r4f") {
		const target = scen.mergeRender;
		summary.editRow = JSON.parse(
			await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); const b = el?.querySelector('button[aria-expanded]'); return JSON.stringify({ mounted: !!el, text: el?.innerText.slice(0, 120), expanded: b?.getAttribute("aria-expanded") ?? null, counts: (el?.innerText.match(/[+][0-9]+|[\\u2212-][0-9]+/g) ?? []).join(" "), h: el?.getBoundingClientRect().height }); })()`),
		);
		await capture("05-edit-collapsed");
		const box = JSON.parse(await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); const b = el?.querySelector('button[aria-expanded]'); if (!b) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }); })()`));
		if (box) {
			for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
			await wait(700);
			summary.editRowExpanded = JSON.parse(
				await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); const lines = (el?.innerText ?? "").split(String.fromCharCode(10)); return JSON.stringify({ expanded: el?.querySelector('button[aria-expanded]')?.getAttribute("aria-expanded") ?? null, h: el?.getBoundingClientRect().height, plusLines: lines.filter((l) => /^[+]/.test(l)).length, minusLines: lines.filter((l) => /^[-\\u2212]/.test(l)).length, hunk: lines.find((l) => l.startsWith("@@")) ?? null, counts: (el?.innerText.match(/[+][0-9]+|[\\u2212-][0-9]+/g) ?? []).join(" ") }); })()`),
			);
			await capture("06-edit-expanded");
		}
	}

	summary.unknownRoutes = [...new Set(log.unknown)];
	summary.historyAll = log.history;
	summary.streamsAll = log.streams;

} catch (e) {
	summary.error = String(e?.stack ?? e);
	summary.appTail = appOut.slice(-3000);
} finally {
	writeFileSync(join(OUT, `${LABEL}-${NAME}.json`), JSON.stringify(summary, null, 2));
	try { socket?.close(); } catch {}
	clearInterval(heartbeat);
	try { process.kill(-app.pid, "SIGTERM"); } catch {}
	await wait(2000);
	try { process.kill(-app.pid, "SIGKILL"); } catch {}
	server.close(); server.closeAllConnections?.();
	const h = summary.historyAll ?? summary.historyOnOpen ?? [];
	console.log(JSON.stringify({ label: LABEL, scen: NAME, error: summary.error?.slice(0, 400), first: summary.first && { t: summary.first.t, rows: summary.first.rows, standIns: summary.first.standIns, blank: summary.first.blank, answeredYet: summary.first.readsAnsweredYet }, history: h.map((x) => [x.sid?.slice(0, 4), x.at, x.limit, x.beforeId ? "before" : "tail", x.rows ?? x.status ?? "-", x.answeredAt ?? "pending"]), settled: summary.settled && { rows: summary.settled.rows, standIns: summary.settled.standIns, blank: summary.settled.blank }, probe: summary.probe, mergeRender: summary.mergeRender, switchLoopSettled: summary.switchLoopSettled, holdSettled: summary.holdSettled, refindMid: summary.refindMid && { rows: summary.refindMid.rows, blank: summary.refindMid.blank, heldPrevIds: summary.refindMid.heldPrevIds }, revealed: summary.revealed && { rows: summary.revealed.rows, standIns: summary.revealed.standIns, blank: summary.revealed.blank, reads: summary.revealed.readsAfterOpen } }));
	process.exit(0);
}
