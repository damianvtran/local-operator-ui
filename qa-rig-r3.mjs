#!/usr/bin/env node
/**
 * QA round 3 rig for local-operator-ui PR #490 (round-2 rig + probe/merge-render hooks) (independent of the coder's rig).
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
			live_tool_started_at: {}, queued_steering: [], jobs: [], todos: [], wakes: [],
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
		const entry = { sid, at: now() - log.t0, limit, asked, beforeId: beforeId ?? null, mode: state.historyMode };
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

try {
	for (let i = 0; ; i++) { try { await connect(); break; } catch (e) { if (i > 90) throw e; await wait(1000); } }
	await wait(3000);
	await evaluate(`(() => { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "congratulations" }, version: 0 })); location.hash = "#/chat"; location.reload(); return 1; })()`).catch(() => {});
	await wait(4000);
	socket.close();
	await connect();
	summary.windowMode = appOut.split("\n").find((l) => l.includes("[window-mode]"));
	const beforeOpen = log.history.length;
	log.t0 = now();
	await evaluate(SAMPLER(2500));
	await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
	const timeline = [];
	let first = null;
	const deadline = now() + (scen.history === "hang" ? 20000 : 20000);
	while (now() < deadline) {
		const snap = await read();
		const t = tally(snap);
		timeline.push({ t: now() - log.t0, ...t, reads: log.history.length, answered: log.history.filter((h) => h.answeredAt !== undefined).length });
		if (!first && t.rows > 0) {
			first = { t: now() - log.t0, ...t, readsAnsweredYet: log.history.filter((h) => h.answeredAt !== undefined).length, sample: snap.rows.slice(0, 40) };
			summary.first = first;
			if (["a-labels", "a-counts", "d-fail", "d-hang"].includes(NAME)) {
				const target = NAME === "a-counts" ? "tool:toolu_01U3Y21CrbaP1HVMGcKMapJu" : snap.rows.find((r) => r.summary === "" || r.summary.startsWith("… "))?.id;
				if (target) { await evaluate(`(() => { document.querySelector('[data-record-id="${target}"]')?.scrollIntoView({ block: "center" }); return 1; })()`); await wait(150); }
				const shotRows = await read(); summary.firstShot = { file: await capture("01-first-frame"), target, targetRow: shotRows.rows.find((r) => r.id === target), editRows: shotRows.rows.filter((r) => /^(edit|write)/.test(r.name)).map((r) => ({ id: r.id, counts: r.counts, summary: r.summary.slice(0, 50) })), answeredYet: log.history.filter((h) => h.answeredAt !== undefined).length, ...tally(shotRows) };
			}
			if (NAME === "e2-bounce") {
				await wait(300);
				mark("bounce-to-B");
				await evaluate(`(() => { location.hash = "#/chat/${Object.keys(scen.sessions).find((k) => k !== scen.open)}"; return 1; })()`);
				await wait(600);
				mark("bounce-back-to-A");
				// Per-frame sampler: counts stand-ins/blank tool rows on every animation frame for 2 s.
				await evaluate(`(() => { window.__qaFrames = []; const t0 = performance.now(); const tick = () => { const rows = [...document.querySelectorAll('[data-record-kind="tool"]')]; let s = 0, b = 0; for (const r of rows) { const c = r.querySelectorAll("span.truncate")[1]?.textContent ?? ""; if (c.startsWith("… ")) s++; else if (c === "") b++; } window.__qaFrames.push([Math.round(performance.now() - t0), location.hash.slice(-4), rows.length, s, b]); if (performance.now() - t0 < 2000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); location.hash = "#/chat/${scen.open}"; return 1; })()`);
				const bt = [];
				const end = now() + 3 * DELAY + 2000;
				let shot = false;
				while (now() < end) {
					const sn = await read();
					const tt = tally(sn);
					const answeredA = log.history.filter((h) => h.sid === scen.open && h.answeredAt !== undefined).length;
					bt.push({ t: now() - log.t0, hash: sn.hash, ...tt, readsA: log.history.filter((h) => h.sid === scen.open).length, answeredA });
					if (!shot && sn.hash.endsWith(scen.open) && tt.standIns > 0 && answeredA === 1) { shot = true; await capture("bounce-standins-while-new-read-pending"); }
					await wait(100);
				}
				summary.bounce = bt;
				const fr = JSON.parse(await evaluate("JSON.stringify(window.__qaFrames)"));
				const runs = []; for (const f of fr) { const k = f.slice(1).join(","); if (!runs.length || runs.at(-1).k !== k) runs.push({ k, from: f[0], to: f[0], frames: 1 }); else { runs.at(-1).to = f[0]; runs.at(-1).frames++; } }
				summary.bounceFrames = runs;
			}
			if (NAME === "e-switch") {
				// Switch while the first read of A is still in flight.
				await wait(400);
				mark("switch-to-B", { inflight: log.history.filter((h) => h.answeredAt === undefined).length });
				await evaluate(`(() => { location.hash = "#/chat/${Object.keys(scen.sessions).find((k) => k !== scen.open)}"; return 1; })()`);
			}
		}
		/*
		 * A hung read's whole point is the moment the columns fall back, so stop the
		 * loop the moment that is observed rather than sampling to a fixed deadline.
		 * The 20 s ceiling is the round-1 control deadline (round 1 measured the
		 * fallback at t=40,061 ms, i.e. two of them).
		 */
		if (scen.history === "hang" && first && t.blank === 0 && t.standIns > 0) break;
		/*
		 * The delta scenarios drive themselves for a fixed window after the open, so
		 * their measurement is taken over a bounded interval rather than at the
		 * moment the app happens to go quiet (a walk that keeps retrying never does).
		 */
		if (FIXED_MS[NAME]) {
			if (now() - log.t0 > FIXED_MS[NAME]) break;
			await wait(100);
			continue;
		}
		const settled = log.history.length > 0 && log.history.every((h) => h.answeredAt !== undefined);
		if (first && scen.history === "ok" && settled && now() - log.t0 > DELAY * 2 + 2500 && NAME !== "e-switch" && NAME !== "e2-bounce") break;
		if (first && scen.history === "ok" && log.history.length === 0 && now() - log.t0 > 4000) break;
		if ((NAME === "e-switch" || NAME === "e2-bounce") && now() - log.t0 > DELAY * 2 + 3000) break;
		await wait(100);
	}
	summary.timeline = timeline;
	if (NAME !== "e2-bounce") summary.openFrames = await frameRuns().catch(() => null);
	summary.historyOnOpen = log.history.map((h) => ({ ...h }));
	summary.readsBeforeOpen = beforeOpen;
	const settled = await read();
	summary.settled = { ...tally(settled), hash: settled.hash, standInRows: settled.rows.filter((r) => r.summary.startsWith("… ")), blankRows: settled.rows.filter((r) => r.summary === "").map((r) => r.id) };
	if (NAME === "a-counts") { await evaluate(`(() => { document.querySelector('[data-record-id="tool:toolu_01U3Y21CrbaP1HVMGcKMapJu"]')?.scrollIntoView({ block: "center" }); return 1; })()`); await wait(300); }
	summary.settledShot = await capture("02-settled");
	summary.editRows = settled.rows.filter((r) => /^(edit|write)/.test(r.name)).map((r) => ({ id: r.id, name: r.name, summary: r.summary.slice(0, 80), counts: r.counts }));

	if (NAME === "g2-roundend") {
		// The running round becomes durable, then turn_end: the retry must label the
		// two rows WITHOUT blanking the stand-ins the reader already saw.
		const sj = scen.sessions[scen.open].journal;
		const t = sj.at(-1).ts;
		const ids = ["toolu_QA_running_01", "toolu_QA_running_02"];
		sj.push({ id: "qa0000000000000000000000000000a1", ts: t + 5, type: "message", payload: { kind: "message", role: "assistant", tool_calls: ids.map((id, k) => ({ id, name: "bash", arguments: { command: `echo QA-ROUNDEND-CMD-${k}`, i: "QA round end" } })) } });
		ids.forEach((id, k) => sj.push({ id: `qa0000000000000000000000000000b${k}`, ts: t + 5.1 + k / 10, type: "message", payload: { kind: "message", role: "tool", content: [{ text: `exit code: 0\n--- stdout ---\nQA-RUNNING-ROUND-OUTPUT-${k}` }], tool_call_id: id, tool_name: "bash", provider_payload: { duration_s: 0.1 } } }));
		scen.delay = 1500;
		const readsBefore = log.history.length;
		await evaluate(SAMPLER(4000));
		state.streams[scen.open].send({ type: "event", payload: { type: "turn_end" } });
		await wait(4500);
		summary.roundEndFrames = await frameRuns();
		summary.roundEndReads = log.history.slice(readsBefore);
		const after = await read();
		summary.roundEndRows = after.rows.filter((r) => ids.some((id) => r.id.endsWith(id)));
		summary.roundEndStandIns = after.rows.filter((r) => r.summary.startsWith("… ")).map((r) => ({ id: r.id, name: r.name, summary: r.summary.slice(0, 70) }));
		summary.roundEndAllIds = after.rows.map((r) => r.id);
		await capture("03-roundend");
	}
	if (NAME === "e3-return" || NAME === "e4-return-running" || NAME === "e4b-return-running") {
		await evaluate(`(() => { location.hash = "#/chat/${Object.keys(scen.sessions).find((k) => k !== scen.open)}"; return 1; })()`);
		await wait(2500);
		scen.delay = 3000;
		const readsBefore = log.history.length;
		await evaluate(SAMPLER(4500));
		await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
		await wait(1500);
		const mid = await read();
		const running = mid.rows.filter((r) => r.id.includes("QA_running"));
		if (running[0]) { await evaluate(`(() => { document.querySelector('[data-record-id="${running[0].id}"]')?.scrollIntoView({ block: "center" }); return 1; })()`); await wait(100); }
		summary.returnMid = { ...tally(mid), running };
		await capture("03a-returned-during-read");
		await wait(3500);
		summary.returnFrames = await frameRuns();
		summary.returnReads = log.history.slice(readsBefore);
		await capture("03-returned");
	}
	if (NAME === "e-switch") {
		summary.onB = { ...tally(settled), foreignRows: settled.rows.filter((r) => !r.id.startsWith("tool:toolu_B_")).map((r) => r.id).slice(0, 10) };
		// Wait for A's delayed read to land (after the switch) and check B again.
		await wait(DELAY + 1500);
		const later = await read();
		summary.onBLater = { ...tally(later), hash: later.hash, foreignRows: later.rows.filter((r) => !r.id.startsWith("tool:toolu_B_")).map((r) => r.id).slice(0, 10) };
		// Switch back to A with the stub answering immediately: rows must label, none held empty.
		scen.delay = 0;
		mark("switch-back-to-A");
		await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
		await wait(5000);
		const back = await read();
		summary.backOnA = { ...tally(back), hash: back.hash, blankIds: back.rows.filter((r) => r.summary === "").map((r) => r.id).slice(0, 10) };
		await capture("03-back-on-A");
	}

	if (NAME === "a-labels" || NAME === "a-counts") {
		// Freeze history and mount every painted row: what the OPEN left behind.
		state.historyMode = "hang";
		const opened = log.history.length;
		await scrollAll();
		const all = await read();
		summary.revealed = { ...tally(all), standInRows: all.rows.filter((r) => r.summary.startsWith("… ")).map((r) => ({ id: r.id, name: r.name, summary: r.summary.slice(0, 60) })), readsAfterOpen: log.history.length - opened };
		summary.revealedEdits = all.rows.filter((r) => /^(edit|write)/.test(r.name)).map((r) => ({ id: r.id, summary: r.summary.slice(0, 70), counts: r.counts }));
		await evaluate(`(() => { document.querySelector('[data-record-id]')?.scrollIntoView({ block: "start" }); return 1; })()`);
		await wait(400);
		await capture("03-revealed-oldest");
	}

	if (NAME === "g-live") {
		const push = (payload) => state.streams[scen.open].send({ type: "event", payload });
		const tsBase = Date.now() / 1000;
		mark("live-start");
		push({ type: "tool_execution_start", tool_call_id: "toolu_QA_live_bash", tool_name: "bash", args: { command: "echo QA-LIVE-COMMAND", i: "Running QA live command" }, intent: "Running QA live command", started_at_epoch: tsBase });
		await wait(600);
		const running = (await read()).rows.find((r) => r.id === "tool:toolu_QA_live_bash");
		push({ type: "tool_execution_end", tool_call_id: "toolu_QA_live_bash", tool_name: "bash", result: { content: [{ text: "exit code: 0\n--- stdout ---\nQA-LIVE-OUTPUT" }], details: null }, duration_s: 0.2, is_error: false, started_at_epoch: tsBase });
		push({ type: "tool_execution_start", tool_call_id: "toolu_QA_live_edit", tool_name: "edit", args: { path: "~/qa/live-file.py", edits: "[...]" }, started_at_epoch: tsBase + 1 });
		await wait(400);
		push({ type: "tool_execution_end", tool_call_id: "toolu_QA_live_edit", tool_name: "edit", result: { content: [{ text: "Edited ~/qa/live-file.py: 1 hunk(s)" }], details: { path: "~/qa/live-file.py", added: 7, removed: 3, diff: ["--- ", "+++ ", "@@ -1,3 +1,7 @@", "-a", "-b", "-c", "+1", "+2", "+3", "+4", "+5", "+6", "+7"] } }, duration_s: 0.02, is_error: false, started_at_epoch: tsBase + 1 });
		// A live end whose details were stripped, for a call that has no prior counts: must not invent any.
		push({ type: "tool_execution_start", tool_call_id: "toolu_QA_live_edit2", tool_name: "edit", args: { path: "~/qa/stripped.py", edits: "[...]" }, started_at_epoch: tsBase + 2 });
		await wait(200);
		push({ type: "tool_execution_end", tool_call_id: "toolu_QA_live_edit2", tool_name: "edit", result: { content: [{ text: "Edited ~/qa/stripped.py" }], details: null }, duration_s: 0.02, is_error: false, started_at_epoch: tsBase + 2 });
		await wait(1200);
		const after = await read();
		summary.live = { running, rows: after.rows.filter((r) => r.id.startsWith("tool:toolu_QA_live")), historyReadsTotal: log.history.length, blank: tally(after).blank, standIns: tally(after).standIns };
		await capture("03-live");
	}
	/*
	 * (1) Q1's fix, driven the way round 1 found the defect: leave a mid-turn
	 * conversation and come back, then do it again and again, quickly, with history
	 * FROZEN so no return's read can ever answer. Round 1 measured 2 rows BLANK for
	 * ~3.0 s on the first such return, 3 of 3 runs, on the pre-fix head. Nothing
	 * here may blank a row this window has already painted: the per-conversation
	 * bookkeeping means a return is not a first paint.
	 */
	if (NAME.startsWith("switch-loop")) {
		const other = Object.keys(scen.sessions).find((k) => k !== scen.open);
		await wait(1200); // the open's read has answered and the first paint settled
		state.historyMode = "hang"; // frozen from here: no later return can be labelled
		const readsBefore = log.history.length;
		await evaluate(SAMPLER(7000, "__qaSwitch"));
		const cycles = [];
		for (let i = 0; i < 6; i++) {
			await evaluate(`(() => { location.hash = "#/chat/${other}"; return 1; })()`);
			await wait(350);
			const b = await read();
			await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
			await wait(350);
			const a = await read();
			cycles.push({
				i,
				onOther: { hash: b.hash, ...tally(b) },
				backOnA: { hash: a.hash, ...tally(a) },
			});
		}
		await wait(2200);
		summary.switchLoop = { cycles, readsDuringCycles: log.history.length - readsBefore };
		summary.switchLoopFrames = await frameRuns("__qaSwitch");
		const fin = await read();
		summary.switchLoopSettled = { hash: fin.hash, ...tally(fin) };
		await capture("03-switch-loop");
	}

	/*
	 * (4') R1's other half: the depth floor a later label read inherits. The walk
	 * above (f-noargs) reaches 409 rows and labels nothing, so a round-end retry
	 * must NOT start at that depth. Durable rows for the unlabelable call are
	 * appended and `turn_end` sent, exactly as the g2 scenario does, and the retry's
	 * own read SIZES are what this measures.
	 */
	if (NAME === "f2-retry") {
		const s = scen.sessions[scen.open];
		const phantom = (s.live_events ?? []).find((e) => e.tool_call_id.includes("phantom"));
		const t = s.journal.at(-1).ts;
		s.journal.push({
			id: "qa0000000000000000000000000000c1",
			ts: t + 5,
			type: "message",
			payload: {
				kind: "message",
				role: "assistant",
				tool_calls: [{ id: phantom.tool_call_id, name: phantom.tool_name, arguments: { command: "echo QA-RETRY-CMD", i: "QA retry" } }],
			},
		});
		s.journal.push({
			id: "qa0000000000000000000000000000c2",
			ts: t + 5.1,
			type: "message",
			payload: {
				kind: "message",
				role: "tool",
				content: [{ text: "exit code: 0\n--- stdout ---\nQA-RETRY-OUTPUT" }],
				tool_call_id: phantom.tool_call_id,
				tool_name: phantom.tool_name,
				provider_payload: { duration_s: 0.1 },
			},
		});
		scen.delay = 200;
		const readsBefore = log.history.length;
		await evaluate(SAMPLER(6000));
		state.streams[scen.open].send({ type: "event", payload: { type: "turn_end" } });
		await wait(6000);
		summary.retryFrames = await frameRuns();
		summary.retryReads = log.history.slice(readsBefore);
		const after = await read();
		summary.retryRow = after.rows.find((r) => r.id.includes(phantom.tool_call_id));
		summary.retryRowsTotal = after.rows.length;
		await capture("03-retry");
	}

	/*
	 * (a) The round-2 reviewer's N1, driven in the shipped app: rows whose labels the
	 * EARLIER read FOUND and the reader has already seen must not be re-held when the
	 * pane is left and re-entered. `benign` is the controlled variable — the only
	 * difference between the two runs is one benign live frame arriving between the
	 * mounts, which is what a running turn sends. The reviewer measured 3 of 3
	 * targets re-held with the frame and 0 of 3 without it.
	 */
	if (NAME.startsWith("n1-refind")) {
		const other = Object.keys(scen.sessions).find((k) => k !== scen.open);
		const before = await read();
		const prevIds = before.rows
			.filter((r) => r.summary !== "" && !r.summary.startsWith("… "))
			.map((r) => r.id);
		summary.refindBefore = { ...tally(before), sample: before.rows.slice(0, 5), prevIds: prevIds.length };
		if (scen.benign) {
			const tsBase = Date.now() / 1000;
			const push = (payload) => state.streams[scen.open].send({ type: "event", payload });
			mark("benign-live-frame");
			push({ type: "tool_execution_start", tool_call_id: "toolu_QA_benign", tool_name: "bash", args: { command: "echo QA-BENIGN", i: "QA benign" }, intent: "QA benign", started_at_epoch: tsBase });
			await wait(500);
			push({ type: "tool_execution_end", tool_call_id: "toolu_QA_benign", tool_name: "bash", result: { content: [{ text: "exit code: 0\n--- stdout ---\nQA-BENIGN-OUTPUT" }], details: null }, duration_s: 0.1, is_error: false, started_at_epoch: tsBase });
			await wait(1200);
		}
		await evaluate(`(() => { location.hash = "#/chat/${other}"; return 1; })()`);
		await wait(1500);
		scen.delay = 3000; // the re-open read, so a re-hold is visible as a blank run
		await evaluate(SAMPLER(6500, "__qaRefind"));
		await evaluate(`(() => { location.hash = "#/chat/${scen.open}"; return 1; })()`);
		await wait(1300);
		const mid = await read();
		summary.refindMid = {
			...tally(mid),
			hash: mid.hash,
			heldPrevIds: mid.rows.filter((r) => prevIds.includes(r.id) && r.summary === "").length,
			sample: mid.rows.filter((r) => prevIds.includes(r.id)).slice(0, 4),
		};
		await capture("03a-return-during-read");
		await wait(6000);
		summary.refindFrames = await frameRuns("__qaRefind");
		const after = await read();
		summary.refindAfter = { ...tally(after),
			blankPrevIds: after.rows.filter((r) => prevIds.includes(r.id) && r.summary === "").map((r) => r.id) };
		await capture("03-return-settled");
	}

	/*
	 * (b) Can a row's object column be left empty PERMANENTLY? Leave and re-enter
	 * while the first paint's own read is still outstanding, twice, so the hold's
	 * backstop fires under a later generation than the one that armed it (the timer
	 * returns early when the generation has moved), then sit on the conversation and
	 * watch every frame to the end.
	 */
	if (NAME === "hold-across-switch") {
		const other = Object.keys(scen.sessions).find((k) => k !== scen.open);
		const go = async (id) => { await evaluate(`(() => { location.hash = "#/chat/${id}"; return 1; })()`); };
		await evaluate(SAMPLER(16000, "__qaHold"));
		const first = await read();
		summary.holdFirst = tally(first);
		await wait(250);
		await go(other);
		mark("away-1");
		await wait(450);
		await go(scen.open);
		mark("back-1");
		await wait(450);
		await go(other);
		mark("away-2");
		await wait(450);
		await go(scen.open);
		mark("back-2");
		await wait(11000);
		summary.holdFrames = await frameRuns("__qaHold");
		const fin = await read();
		summary.holdSettled = { ...tally(fin), blankIds: fin.rows.filter((r) => r.summary === "").map((r) => r.id) };
		await capture("03-hold-across-switch");
	}

	/*
	 * Round 3. `probe`: after the open has settled, report the named call rows'
	 * object column — for the tight-floor cases, whether the walk still found an
	 * assistant row journaled just before its call's own start instant. Reads made
	 * while mounting the row are counted separately from the open's.
	 */
	if (Array.isArray(scen.probe)) {
		summary.readsAtSettle = log.history.length;
		state.historyMode = "hang";
		const find = async () => JSON.parse(await evaluate(`JSON.stringify(${JSON.stringify(scen.probe)}.map((id) => { const el = document.querySelector('[data-record-id="tool:' + id + '"]'); if (!el) return { id, mounted: false }; const c = el.querySelectorAll("span.truncate"); return { id, mounted: true, name: c[0]?.textContent ?? "", summary: (c[1]?.textContent ?? "").slice(0, 60) }; }))`));
		let got = await find();
		if (got.some((g) => !g.mounted)) { await scrollAll(); got = await find(); }
		summary.probe = got;
		for (const g of got) if (g.mounted) { await evaluate(`(() => { document.querySelector('[data-record-id="tool:${g.id}"]')?.scrollIntoView({ block: "center" }); return 1; })()`); await wait(300); await capture("04-probe"); break; }
	}
	/*
	 * Round 3, row 6: the second fold auto-merged canonical-transcript.tsx. Drive
	 * what a bad merge would break as a RENDERING fault: an edit row's counts, its
	 * disclosure expanding to a diff body, and main's working line (its hunk in
	 * the same file) on a mid-turn conversation.
	 */
	if (scen.mergeRender) {
		const target = scen.mergeRender;
		await evaluate(`(() => { document.querySelector('[data-record-id="${target}"]')?.scrollIntoView({ block: "center" }); return 1; })()`);
		await wait(400);
		const pre = JSON.parse(await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); const b = el?.querySelector('button[aria-expanded]'); return JSON.stringify({ mounted: !!el, text: el?.innerText.slice(0, 120), expanded: b?.getAttribute("aria-expanded") ?? null, h: el?.getBoundingClientRect().height, working: document.querySelectorAll("[data-lo-working-line]").length, workingText: document.querySelector("[data-lo-working-line]")?.innerText.slice(0, 80) ?? null }); })()`));
		summary.mergeRender = { target, pre, dom: await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); return el ? el.outerHTML.slice(0, 1500) : "NOT MOUNTED; ids=" + [...document.querySelectorAll("[data-record-id]")].map((e) => e.getAttribute("data-record-id")).slice(-8).join(","); })()`) };
		await capture("04-merge-collapsed");
		const box = JSON.parse((await evaluate(`(() => { const b = document.querySelector('[data-record-id="${target}"] button[aria-expanded]'); if (!b) return "null"; const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + Math.min(40, r.width / 2), y: r.top + r.height / 2 }); })()`)) ?? "null");
		if (!box) throw new Error("merge-render: no expand button on " + target);
		for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
		await wait(700);
		const post = JSON.parse(await evaluate(`(() => { const el = document.querySelector('[data-record-id="${target}"]'); const b = el?.querySelector('button[aria-expanded]'); const lines = (el?.innerText ?? "").split(String.fromCharCode(10)); return JSON.stringify({ expanded: b?.getAttribute("aria-expanded") ?? null, h: el?.getBoundingClientRect().height, plusLines: lines.filter((l) => /^[+]/.test(l)).length, minusLines: lines.filter((l) => /^[-−]/.test(l)).length, hunk: lines.find((l) => l.startsWith("@@")) ?? null, head: lines.slice(0, 6) }); })()`));
		summary.mergeRender = { ...summary.mergeRender, post };
		await capture("04-merge-expanded");
	}

	summary.unknownRoutes = [...new Set(log.unknown)];
	summary.historyAll = log.history;
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
