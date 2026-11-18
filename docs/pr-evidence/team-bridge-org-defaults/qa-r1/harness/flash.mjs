/*
 * PR 1970 live-path QA rig (scratch, not committed). Built app from the PR
 * worktree, headless (named), scratch HOME/config/profile, stub daemon modelled
 * on scripts/team-bridge-bench.mjs (record discovery + claim + desktop routes),
 * CDP Page.captureScreenshot (in-app capture), exact-group teardown via the
 * repo's own scripts/app-tree-teardown.mjs.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const ROOT = "/Users/damian/local-operator-ui/.worktrees/tb-org-defaults";
const { stopAppTree, reapOnExit } = await import(`${ROOT}/scripts/app-tree-teardown.mjs`);
const { MOCK_KEYCHAIN_SWITCH } = await import(`${ROOT}/scripts/chrome-keychain.mjs`);
const SCRATCH = process.env.RIG_SCRATCH;
const OUT = join(SCRATCH, "frames");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[rig ${new Date().toISOString().slice(11, 23)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "a_qaself000000000001";
const PERG = { tenant_id: "t_qapergamon00000001", tenant_name: "Pergamon Labs", eligible: true, endpoint: null };
const MIN = { tenant_id: "t_qaminerva000000002", tenant_name: "Minerva", eligible: true, endpoint: null };
// Pergamon listed FIRST everywhere, so "first row" can never pass for the default.
const TENANTS = [PERG, MIN];
const MEMBERSHIP_DELAY_MS = Number(process.env.MEMBERSHIP_DELAY_MS ?? 1500);
const UNREAD = { [MIN.tenant_id]: 3, [PERG.tenant_id]: 2 };

const conv = (id, tenant, name, count, unread) => ({
	id, tenant_id: tenant.tenant_id, kind: "channel", name, visibility: "tenant",
	agent_capable: true, status: "open", created_by: ACCOUNT,
	last_message_at: new Date(Date.UTC(2026, 10, 17) + count * 60000).toISOString(),
	latest_seq: count,
	members: [{ account_id: ACCOUNT, kind: "human", display_label: "QA Self", role: "owner", state: "active" }],
	last_read_seq: count - unread, unread_count: unread, muted: false, can_administer: true,
});
const CONVS = [
	conv("c_qaperg0000000000001", PERG, "pergamon-research", 12, 2),
	conv("c_qaperg0000000000002", PERG, "pergamon-ops", 10, 0),
	conv("c_qamine0000000000001", MIN, "minerva-general", 14, 3),
	conv("c_qamine0000000000002", MIN, "minerva-eng", 11, 0),
];
const msgs = (cid, total) => {
	const out = [];
	for (let s = total; s >= 1; s--) out.push({
		id: `m_${s}_${cid.slice(-6)}`, conversation_id: cid, seq: s,
		sender: { account_id: "a_qahuman000000000001", kind: "human", display_label: "QA Teammate" },
		body: `Message ${s} in ${CONVS.find((c) => c.id === cid)?.name}`, origin: "human",
		created_at: new Date(Date.UTC(2026, 10, 17) + s * 60000).toISOString(),
	});
	return { messages: out, has_more: false };
};

let MODE = "eligible"; // or "ineligible" (surface A)
const seen = [];
function startStub(recordsDir) {
	const instanceId = randomUUID();
	const token = `qa-${randomUUID()}`;
	let claims = 0;
	const t0 = Date.now();
	const handle = (req, res) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		const path = url.pathname;
		seen.push({ t: Date.now() - t0, at: Date.now(), m: req.method, p: `${path}${url.search}` });
		const json = (code, body) => { const t = JSON.stringify(body); res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(t) }); res.end(t); };
		const send = (b) => json(200, b);
		if (path === "/health") return send({ result: { instance_id: instanceId, pid: process.pid, version: "qa", prefix: "", install_kind: "qa" } });
		if (path === "/v1/capabilities") return send({ result: { desktop_contract: 1, desktop_available: true, desktop_auth: "bearer", features: { team_bridge_conversations: 1, team_bridge_conversation_owner_guard: 1, team_bridge_thread_reads: 1, team_bridge_attachments: 1, radient: 1, peers: 1, session_transfer: 1, settings: 1, library: 1, notifications: 1 } } });
		if (path === "/v1/desktop/claim") { claims++; return send({ result: { token, desktop: true } }); }
		if (path === "/v1/desktop/radient") {
			let raw = ""; req.on("data", (c) => { raw += c; });
			req.on("end", () => {
				let op = "account";
				try { const b = JSON.parse(raw || "{}"); op = b?.control?.operation ?? b?.operation ?? "account"; } catch {}
				seen.push({ t: Date.now() - t0, at: Date.now(), m: "RADIENT", p: op });
				if (op === "memberships.list") {
					return setTimeout(() => {
						seen.push({ t: Date.now() - t0, at: Date.now(), m: "ANSWERED", p: "memberships.list" });
						send({ result: { data: { msg: "success", result: { memberships: TENANTS.map((t) => ({ tenant_id: t.tenant_id, tenant_name: t.tenant_name, role: "owner", status: "active", is_home: t === MIN, plan: { status: MODE === "eligible" ? "active" : "inactive", seats: 5 } })) } } } });
					}, MEMBERSHIP_DELAY_MS);
				}
				if (op !== "account") return json(400, { detail: { code: "qa_stub_refused", message: `unknown radient operation ${op}` } });
				return send({ result: { data: { msg: "success", result: { account: { id: ACCOUNT, tenant_id: MIN.tenant_id, email: "qa@qa.invalid", name: "QA Reader", role: "owner" }, identity: { id: ACCOUNT, email: "qa@qa.invalid", display_name: "QA Reader" }, verification: null } } } });
			});
			return;
		}
		if (path === "/v1/desktop/team-bridge/status") return send({ result: {
			capability: 1, consent_account_guard: true, state: "ready", account_id: ACCOUNT, tenant_id: MIN.tenant_id,
			surface_state: MODE === "eligible" ? "C" : "A",
			visibility: { settings: true, inbox: true, account_door: true, onboarding: true },
			update_required: false, read_only: false, local: { enabled: true, onboarding: "done", session: "qa" },
			status: { tenants: TENANTS.map((t) => ({ ...t, eligible: MODE === "eligible" })) },
			consent: null, error: null, state_note: null, delivery_hold: null,
			default_on: { in_force: false, notice_pending: false }, trial_ended: null } });
		if (path === "/v1/desktop/team-bridge/conversations") {
			const tenant = url.searchParams.get("tenant_id");
			const archived = url.searchParams.get("status") === "archived";
			const rows = CONVS.filter((r) => (tenant ? r.tenant_id === tenant : true)).filter((r) => (archived ? r.status === "archived" : true));
			return send({ result: { conversations: rows } });
		}
		let m = /^\/v1\/desktop\/team-bridge\/conversations\/([^/]+)\/messages$/.exec(path);
		if (m) { const c = CONVS.find((x) => x.id === decodeURIComponent(m[1])); return c ? send({ result: msgs(c.id, c.latest_seq) }) : json(404, { detail: { code: "not_found", message: "no conv" } }); }
		m = /^\/v1\/desktop\/team-bridge\/conversations\/([^/]+)\/read$/.exec(path);
		if (m) { const c = CONVS.find((x) => x.id === decodeURIComponent(m[1])); return send({ result: { conversation_id: m[1], last_read_seq: c?.last_read_seq ?? 0, unread_count: c?.unread_count ?? 0, muted: false } }); }
		if (path === "/v1/desktop/team-bridge/directory") return send({ result: { members: [] } });
		if (path === "/v1/desktop/team-bridge/unread") {
			const tenant = url.searchParams.get("tenant_id");
			const rows = CONVS.filter((r) => (tenant ? r.tenant_id === tenant : true));
			const orgs = TENANTS.filter((t) => (tenant ? t.tenant_id === tenant : true)).map((t) => ({ tenant_id: t.tenant_id, tenant_name: t.tenant_name, unread: UNREAD[t.tenant_id], eligible: true }));
			return send({ result: { total: orgs.reduce((s, o) => s + o.unread, 0), conversations: rows.map((r) => ({ conversation_id: r.id, unread_count: r.unread_count, last_read_seq: r.last_read_seq, latest_seq: r.latest_seq, muted: false })), organizations: orgs } });
		}
		if (path === "/v1/desktop/team-bridge/settings") return send({ result: { settings: { enabled: true, notify: "all" } } });
		if (path === "/v1/desktop/sessions") return send({ result: { sessions: [], degraded: [], truncated: false } });
		if (path === "/v1/desktop/peers") return send({ result: { peers: [], self_device_id: "d_qaself0000000000001", degraded: [] } });
		if (path === "/v1/desktop/networks") return send({ result: { networks: [], self_device_id: "d_qaself0000000000001" } });
		if (path === "/v1/credentials") return send({ result: { keys: ["RADIENT_API_KEY"] } });
		if (path === "/v1/settings") return send({ result: { settings: [] } });
		if (path === "/v1/config") return send({ result: { version: "qa", metadata: { schema_version: "1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, values: { conversation_length: 20, detail_length: 5, max_learnings_history: 50, hosting: "openrouter", model_name: "openai/gpt-4o-mini", auto_save_conversation: true } } });
		if (path === "/v1/desktop/asks") return send({ result: { asks: [] } });
		if (path === "/v1/desktop/notifications/count") return send({ result: { count: 0, unread: 0, items: [] } });
		if (path === "/v1/agents") return send({ result: { agents: [], total: 0, page: 1, per_page: 500 } });
		process.stderr.write(`[stub] unhandled ${req.method} ${path}\n`);
		return json(404, { detail: { code: "qa_stub_refused", message: `no route ${req.method} ${path}` } });
	};
	const server = createServer(handle);
	return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
		const port = server.address().port;
		const record = { pid: process.pid, host: "127.0.0.1", port, instance_id: instanceId, version: "qa", source_ref: "qa", prefix: "", install_kind: "qa", desktop: true, claim_key: token, started_at: Math.floor(Date.now() / 1000), heartbeat_at: Math.floor(Date.now() / 1000) };
		mkdirSync(recordsDir, { recursive: true, mode: 0o700 });
		const file = join(recordsDir, `${process.pid}.json`);
		const beat = () => writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
		beat();
		const timer = setInterval(() => { record.heartbeat_at = Math.floor(Date.now() / 1000); beat(); }, 5000);
		resolve({ port, claims: () => claims, close: () => new Promise((d) => { clearInterval(timer); rmSync(file, { force: true }); server.close(() => d()); }) });
	}));
}

function allowStubOrigin(stubPort) {
	const file = join(ROOT, "out", "renderer", "index.html");
	const html = readFileSync(file, "utf8");
	const tag = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/.exec(html);
	const policy = /(connect-src[^;"]*)/.exec(tag[0]);
	const origin = `http://127.0.0.1:${stubPort}`;
	const shipped = new Set(["http://localhost:1111", "http://127.0.0.1:1111", "http://localhost:8080", "http://127.0.0.1:8080"]);
	const loop = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/;
	const kept = policy[1].split(/\s+/).filter(Boolean).filter((t) => (loop.test(t) ? shipped.has(t) : true));
	const widened = `${kept.join(" ")} ${origin} ${origin.replace("127.0.0.1", "localhost")}`;
	writeFileSync(file, html.replace(tag[0], tag[0].replace(policy[1], widened)));
}
function restoreCsp() {
	const file = join(ROOT, "out", "renderer", "index.html");
	const html = readFileSync(file, "utf8");
	const tag = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/.exec(html);
	const policy = /(connect-src[^;"]*)/.exec(tag[0]);
	const shipped = new Set(["http://localhost:1111", "http://127.0.0.1:1111", "http://localhost:8080", "http://127.0.0.1:8080"]);
	const loop = /^http:\/\/(127\.0\.0\.1|localhost):(\d+)$/;
	const kept = policy[1].split(/\s+/).filter(Boolean).filter((t) => (loop.test(t) ? shipped.has(t) : true));
	writeFileSync(file, html.replace(tag[0], tag[0].replace(policy[1], kept.join(" "))));
}

let cdpPortSeq = 9700 + Math.floor(Math.random() * 200);
function launchApp(profileName) {
	const userData = join(SCRATCH, profileName);
	const home = join(SCRATCH, "home");
	mkdirSync(home, { recursive: true });
	const port = cdpPortSeq++;
	const env = { ...process.env, HOME: home, LOCAL_OPERATOR_CONFIG_DIR: join(SCRATCH, "config"), LOCAL_OPERATOR_LOG_DIR: join(SCRATCH, "logs"), LOCAL_OPERATOR_UI_WINDOW_MODE: "headless", LOCAL_OPERATOR_NO_NOTIFICATIONS: "1", LOCAL_OPERATOR_UI_TELEMETRY: "off", VITE_DISABLE_BACKEND_MANAGER: "true" };
	for (const k of Object.keys(env)) if (k.startsWith("CMUX_")) delete env[k];
	delete env.XPC_FLAGS;
	const args = [join(ROOT, "node_modules", "electron", "cli.js"), join(ROOT, "out", "main", "index.js"), "--window-mode=headless", "--window-size=1380x900", `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, MOCK_KEYCHAIN_SWITCH];
	const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
	let exited = false;
	child.on("exit", () => { exited = true; });
	const out = [];
	child.stdout.on("data", (c) => out.push(String(c)));
	child.stderr.on("data", (c) => out.push(String(c)));
	reapOnExit({ pid: child.pid, userData });
	log(`launched app pid=${child.pid} (group leader) profile=${profileName} cdp=${port}`);
	return { child, port, userData, isExited: () => exited, output: () => out.join("") };
}

async function cdp(port) {
	let target;
	for (let i = 0; i < 360 && !target; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			target = list.find((t) => t.type === "page" && /renderer\/index\.html/.test(t.url ?? ""));
		} catch {}
		if (!target) await sleep(250);
	}
	if (!target) throw new Error("no renderer target");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	const pending = new Map(); let id = 0; const consoleLines = [];
	const api = {};
	ws.addEventListener("message", (e) => {
		const msg = JSON.parse(String(e.data));
		if (msg.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
		if (msg.method && api.onEvent) api.onEvent(msg);
		const w = pending.get(msg.id); if (!w) return; pending.delete(msg.id);
		msg.error ? w.reject(new Error(JSON.stringify(msg.error))) : w.resolve(msg.result);
	});
	await new Promise((ok, bad) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", bad, { once: true }); });
	const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
	const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
	await send("Runtime.enable");
	return Object.assign(api, { send, evaluate, close: () => ws.close(), consoleLines });
}

let frameNo = 0;
async function shot(c, label) {
	const { data } = await c.send("Page.captureScreenshot", { format: "png" });
	const name = `${String(++frameNo).padStart(2, "0")}-${label}.png`;
	writeFileSync(join(OUT, name), Buffer.from(data, "base64"));
	return name;
}

/* Page-side recorder: every distinct (switcher title, gate text, rail rows) state with its time. */
const RECORDER = `(() => {
	if (window.__qa) return true;
	const qa = window.__qa = { t0: performance.now(), states: [] };
	const read = () => {
		const trig = [...document.querySelectorAll('button[aria-label^="Organization: "]')].map((b) => b.getAttribute('aria-label'))[0] ?? null;
		const text = document.body.innerText || '';
		const gate = (/Checking Team Bridge/.test(text) || document.querySelector('[aria-label^="Checking Team Bridge"], [title^="Checking Team Bridge"]')) ? 'checking' : (/requires a Radient Team plan/.test(text) ? 'plan' : null);
		const rows = [...document.querySelectorAll('[data-conversation-id]')].map((n) => (n.textContent || '').trim().slice(0, 30));
		return { hash: location.hash.slice(0, 40), trig, gate, rows: rows.join('|') };
	};
	let last = '';
	const tick = () => { const s = read(); const k = JSON.stringify(s); if (k !== last) { last = k; qa.states.push({ t: Math.round(performance.now() - qa.t0), at: Date.now(), ...s }); } };
	new MutationObserver(tick).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
	const raf = () => { tick(); requestAnimationFrame(raf); }; raf();
	return true;
})()`;
const resetRecorder = `(() => { window.__qa.navAt = Date.now(); window.__qa.t0 = performance.now(); window.__qa.states = []; return true; })()`;
const states = `({ navAt: window.__qa.navAt, states: window.__qa.states })`;
const storage = (acct) => `(() => ({ durable: localStorage.getItem('lo.teamBridge.scope.v1'), session: sessionStorage.getItem('lo.teamBridge.sessionScope.v1'), hash: location.hash }))()`;

async function waitShell(c, stub) {
	for (let i = 0; i < 360; i++) {
		const ok = await c.evaluate(`!!document.querySelector('#root, #app, [data-app-shell]') && document.body.innerText.length > 20`).catch(() => false);
		if (ok && stub.claims() > 0) { await sleep(2500); return; }
		await sleep(250);
	}
	throw new Error("shell never mounted");
}
async function burst(c, label, ms, every = 120) {
	const names = []; const end = Date.now() + ms;
	while (Date.now() < end) { names.push(await shot(c, `${label}-f${String(names.length + 1).padStart(2, "0")}`)); await sleep(every); }
	return names;
}
async function waitFor(c, expr, ms = 20000) {
	const end = Date.now() + ms;
	while (Date.now() < end) { if (await c.evaluate(expr).catch(() => false)) return true; await sleep(100); }
	return false;
}
async function center(c, expr) { return c.evaluate(`(() => { const n = ${expr}; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); }
async function pointerClick(c, pt) {
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1, pointerType: "mouse" });
}
const TRIGGER = `document.querySelector('button[aria-label^="Organization: "]')`;
const menuItem = (name) => `[...document.querySelectorAll('[role="menuitemradio"]')].find((n) => (n.textContent || '').trim().startsWith(${JSON.stringify(name)}))`;
async function openMenu(c) { await pointerClick(c, await center(c, TRIGGER)); return waitFor(c, `!!document.querySelector('[role="menu"]')`, 5000); }
async function pick(c, name) { await openMenu(c); await sleep(200); const pt = await center(c, menuItem(name)); await pointerClick(c, pt); await waitFor(c, `!document.querySelector('[role="menu"]')`, 5000); await sleep(800); }
const menuRead = `[...document.querySelectorAll('[role="menuitemradio"]')].map((n) => ({ text: (n.textContent || '').replace(/\\s+/g, ' ').trim(), checked: n.getAttribute('aria-checked') }))`;
const groupLabels = `[...document.querySelectorAll('[role="menu"] [role="group"], [role="menu"] div')].filter((n) => n.children.length === 0 && /Organizations|Communities|Organization/.test(n.textContent || '')).map((n) => n.textContent.trim())`;

async function quitGracefully(app) {
	try {
		const v = await (await fetch(`http://127.0.0.1:${app.port}/json/version`)).json();
		const ws = new WebSocket(v.webSocketDebuggerUrl);
		await new Promise((ok) => ws.addEventListener("open", ok, { once: true }));
		ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
	} catch (e) { log("Browser.close failed:", String(e)); }
	for (let i = 0; i < 100 && !app.isExited(); i++) await sleep(100);
	log(`graceful quit exited=${app.isExited()}`);
}
async function teardown(app) {
	const r = await stopAppTree({ pid: app.child.pid, userData: app.userData, isExited: app.isExited });
	let alive = true; try { process.kill(app.child.pid, 0); } catch { alive = false; }
	log(`teardown pid=${app.child.pid} clean=${r.clean} escalated=${r.escalated} reaped=${r.reaped.length} kill0_alive=${alive}`);
	return r.clean && !alive;
}


const results = { restarts: [], cold: [] };
const stub = await startStub(join(SCRATCH, "config", "run", "serve"));
allowStubOrigin(stub.port);
let allClean = true;
async function screencastOpen(c, label) {
	const frames = [];
	c.onEvent = (msg) => {
		if (msg.method === "Page.screencastFrame") {
			frames.push({ ts: Math.round(msg.params.metadata.timestamp * 1000), data: msg.params.data });
			c.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
		}
	};
	await c.send("Page.enable");
	await c.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
	await sleep(300);
	await c.evaluate(resetRecorder);
	await c.evaluate(`location.hash = '#/team-bridge'; true`);
	await sleep(Number(process.env.WINDOW_MS ?? 1500));
	await c.send("Page.stopScreencast");
	const st = await c.evaluate(states);
	const saved = [];
	frames.forEach((f, i) => {
		const rel = f.ts - st.navAt;
		if (rel < -50 || rel > Number(process.env.SAVE_MS ?? 600)) return;
		const name = `${label}-sc${String(i).padStart(3, "0")}-${rel >= 0 ? "+" : ""}${rel}ms.png`;
		writeFileSync(join(OUT, name), Buffer.from(f.data, "base64"));
		saved.push({ name, rel });
	});
	return { navAt: st.navAt, states: st.states.map((x) => ({ rel: x.at - st.navAt, trig: x.trig, gate: x.gate, rows: x.rows })), frames: saved, framesTotal: frames.length };
}
try {
	// Seed: fresh profile, cold open recorded, then pick Pergamon and quit.
	{
		const app = launchApp("profile-F");
		try {
			const c = await cdp(app.port);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			results.cold.push(await screencastOpen(c, "cold0"));
			await waitFor(c, `!!${TRIGGER}`);
			await pick(c, "Pergamon Labs");
			results.seed_storage = await c.evaluate(storage());
			c.close();
			await quitGracefully(app);
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	for (let n = 1; n <= Number(process.env.RESTARTS ?? 4); n++) {
		const app = launchApp("profile-F");
		try {
			const c = await cdp(app.port);
			await waitFor(c, `!!document.body`, 30000);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			const boot = await c.evaluate(storage());
			const r = await screencastOpen(c, `restart${n}`);
			r.boot = boot;
			results.restarts.push(r);
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	for (let n = 1; n <= Number(process.env.COLDS ?? 2); n++) {
		const app = launchApp(`profile-cold${n}`);
		try {
			const c = await cdp(app.port);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			results.cold.push(await screencastOpen(c, `cold${n}`));
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	if (process.env.INELIGIBLE === "1") {
		MODE = "ineligible";
		const app = launchApp("profile-inel");
		try {
			const c = await cdp(app.port);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			results.inel = await screencastOpen(c, "inel");
			await sleep(5000);
			results.inel.after6s = await c.evaluate(`({ plan: /requires a Radient Team plan/.test(document.body.innerText), checking: !!document.querySelector('[aria-label^="Checking Team Bridge"]') || /Checking Team Bridge/.test(document.body.innerText) })`);
			results.inel.memberships_answered_before_open = seen.some((r) => r.m === "ANSWERED" && r.at < (results.inel.navAt ?? Infinity));
			results.inel.shot = await shot(c, "inel-settled");
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
} catch (e) {
	results.error = String(e?.stack ?? e);
} finally {
	await stub.close();
	restoreCsp();
	results.allClean = allClean;
	results.requests = seen.filter((r) => /memberships|surface_open|\/read$/.test(r.p));
	writeFileSync(join(SCRATCH, "flash.json"), JSON.stringify(results, null, 2));
	log("done; allClean=", allClean, results.error ? `ERROR ${results.error}` : "");
}
