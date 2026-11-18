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
	ws.addEventListener("message", (e) => {
		const msg = JSON.parse(String(e.data));
		if (msg.method === "Runtime.exceptionThrown") consoleLines.push(`exception: ${msg.params.exceptionDetails?.exception?.description}`);
		const w = pending.get(msg.id); if (!w) return; pending.delete(msg.id);
		msg.error ? w.reject(new Error(JSON.stringify(msg.error))) : w.resolve(msg.result);
	});
	await new Promise((ok, bad) => { ws.addEventListener("open", ok, { once: true }); ws.addEventListener("error", bad, { once: true }); });
	const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
	const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
	await send("Runtime.enable");
	return { send, evaluate, close: () => ws.close(), consoleLines };
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

const results = {};
const stub = await startStub(join(SCRATCH, "config", "run", "serve"));
allowStubOrigin(stub.port);
log(`stub on 127.0.0.1:${stub.port}, memberships delay ${MEMBERSHIP_DELAY_MS} ms`);
let allClean = true;
try {
	/* ---------------- Launch A: fresh profile, eligible two-org account ---------------- */
	{
		const app = launchApp("profile-A");
		try {
			const c = await cdp(app.port);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			results.A_boot = await c.evaluate(storage());
			await c.evaluate(resetRecorder);
			await c.evaluate(`location.hash = '#/team-bridge'; true`);
			results.A_open_frames = await burst(c, "R1-cold-open", 3600, 100);
			await waitFor(c, `!!${TRIGGER} && document.querySelectorAll('[data-conversation-id]').length > 0`);
			await sleep(800);
			results.A_open_states = await c.evaluate(states);
			results.A_open_settled = await shot(c, "R1-cold-open-settled");
			results.A_after_open_storage = await c.evaluate(storage());
			// Row 4: menu + All organizations.
			await openMenu(c); await sleep(400);
			results.A_menu = await c.evaluate(menuRead);
			results.A_menu_labels = await c.evaluate(`[...document.querySelectorAll('[role="menu"] *')].filter((n) => n.childElementCount === 0 && /^(Organizations|Organization|Communities.*|Browse communities…)$/.test((n.textContent||'').trim())).map((n) => n.textContent.trim())`);
			results.A_menu_shot = await shot(c, "R4-menu-open");
			await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await sleep(400);
			await pick(c, "All organizations");
			await waitFor(c, `document.querySelectorAll('[data-conversation-id]').length >= 4`, 8000);
			await sleep(600);
			results.A_all_trigger = await c.evaluate(`${TRIGGER}?.getAttribute('aria-label')`);
			results.A_all_rows = await c.evaluate(`[...document.querySelectorAll('[data-conversation-id]')].map((n) => n.textContent.replace(/\\s+/g,' ').trim().slice(0,60))`);
			results.A_all_shot = await shot(c, "R4-all-organizations");
			results.A_all_storage = await c.evaluate(storage());
			// Row 2: pick Pergamon, leave Team Bridge, come back.
			await pick(c, "Pergamon Labs");
			results.A_pick_trigger = await c.evaluate(`${TRIGGER}?.getAttribute('aria-label')`);
			results.A_pick_storage = await c.evaluate(storage());
			results.A_pick_shot = await shot(c, "R2-picked-pergamon");
			const navRows = await c.evaluate(`[...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href')).filter((h, i, all) => all.indexOf(h) === i)`);
			results.A_nav_links = navRows;
			const away = navRows.find((h) => /^#\/(chat|agents|schedules|settings)/.test(h)) ?? "#/";
			await c.evaluate(`(() => { const a = document.querySelector('a[href="${away}"]'); if (a) a.click(); else location.hash = '${away}'; return true; })()`);
			await sleep(1500);
			results.A_away_hash = await c.evaluate(`location.hash`);
			results.A_away_shot = await shot(c, "R2-away-tab");
			await c.evaluate(resetRecorder);
			const back = await c.evaluate(`(() => { const a = document.querySelector('a[href="#/team-bridge"]'); if (a) { a.click(); return 'rail-link'; } location.hash = '#/team-bridge'; return 'hash'; })()`);
			results.A_back_via = back;
			results.A_back_frames = await burst(c, "R2-back-to-bridge", 1500, 120);
			await sleep(800);
			results.A_back_states = await c.evaluate(states);
			results.A_back_trigger = await c.evaluate(`${TRIGGER}?.getAttribute('aria-label')`);
			results.A_back_storage = await c.evaluate(storage());
			results.A_back_shot = await shot(c, "R2-back-settled");
			results.A_exceptions = c.consoleLines;
			c.close();
			await quitGracefully(app);
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	/* ---------------- Launch B: restart, same profile ---------------- */
	{
		const app = launchApp("profile-A");
		try {
			const c = await cdp(app.port);
			await waitFor(c, `!!document.body`, 30000);
			await c.evaluate(RECORDER);
			results.B_boot_early = await c.evaluate(storage());
			await waitShell(c, stub);
			results.B_boot = await c.evaluate(storage());
			await c.evaluate(resetRecorder);
			if (!results.B_boot.hash.startsWith("#/team-bridge")) await c.evaluate(`location.hash = '#/team-bridge'; true`);
			results.B_open_frames = await burst(c, "R3-restart-open", 3600, 100);
			await waitFor(c, `!!${TRIGGER} && document.querySelectorAll('[data-conversation-id]').length > 0`);
			await sleep(800);
			results.B_open_states = await c.evaluate(states);
			results.B_open_trigger = await c.evaluate(`${TRIGGER}?.getAttribute('aria-label')`);
			results.B_open_storage = await c.evaluate(storage());
			results.B_open_shot = await shot(c, "R3-restart-settled");
			results.B_exceptions = c.consoleLines;
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	/* ---------------- Launch B2: restart again; memberships warmed by Agent Hub first ---------------- */
	{
		const app = launchApp("profile-A");
		try {
			const c = await cdp(app.port);
			await waitFor(c, `!!document.body`, 30000);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			results.B2_boot = await c.evaluate(storage());
			await c.evaluate(`location.hash = '#/agent-hub'; true`);
			const before = seen.filter((r) => r.p === "memberships.list" && r.m === "ANSWERED").length;
			for (let i = 0; i < 100; i++) { if (seen.filter((r) => r.p === "memberships.list" && r.m === "ANSWERED").length > before) break; await sleep(100); }
			results.B2_memberships_warmed = seen.filter((r) => r.p === "memberships.list" && r.m === "ANSWERED").length > before;
			await sleep(1000);
			results.B2_hub_shot = await shot(c, "R3b-agent-hub-first");
			await c.evaluate(resetRecorder);
			await c.evaluate(`location.hash = '#/team-bridge'; true`);
			results.B2_open_frames = await burst(c, "R3b-restart-open-warm", 1500, 60);
			await waitFor(c, `!!${TRIGGER} && document.querySelectorAll('[data-conversation-id]').length > 0`);
			await sleep(800);
			results.B2_open_states = await c.evaluate(states);
			results.B2_open_trigger = await c.evaluate(`${TRIGGER}?.getAttribute('aria-label')`);
			results.B2_open_storage = await c.evaluate(storage());
			results.B2_open_shot = await shot(c, "R3b-restart-warm-settled");
			results.B2_exceptions = c.consoleLines;
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
	/* ---------------- Launch C: ineligible two-org account, fresh profile ---------------- */
	{
		MODE = "ineligible";
		const app = launchApp("profile-C");
		try {
			const c = await cdp(app.port);
			await waitShell(c, stub);
			await c.evaluate(RECORDER);
			await c.evaluate(resetRecorder);
			await c.evaluate(`location.hash = '#/team-bridge'; true`);
			results.C_frames = await burst(c, "R5-ineligible-open", 2500, 150);
			results.C_plan = await waitFor(c, `/requires a Radient Team plan/.test(document.body.innerText)`, 20000);
			await sleep(4000);
			results.C_states = await c.evaluate(states);
			results.C_still_checking_after_6s = await c.evaluate(`/Checking Team Bridge/.test(document.body.innerText)`);
			results.C_shot = await shot(c, "R5-ineligible-settled");
			results.C_exceptions = c.consoleLines;
			c.close();
		} finally { allClean = (await teardown(app)) && allClean; }
	}
} catch (e) {
	results.error = String(e?.stack ?? e);
} finally {
	await stub.close();
	restoreCsp();
	results.allClean = allClean;
	results.requests = seen.filter((r) => /memberships|team-bridge\/(status|conversations|unread)|RADIENT|ANSWERED/.test(`${r.m} ${r.p}`));
	writeFileSync(join(SCRATCH, "results.json"), JSON.stringify(results, null, 2));
	log("done; results.json written; allClean=", allClean, results.error ? `ERROR ${results.error}` : "");
}
