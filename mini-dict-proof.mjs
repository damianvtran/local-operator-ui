#!/usr/bin/env node
/**
 * The mini view's dictated send, proven end to end on the BUILT app.
 *
 * WHAT IT DRIVES, headless and hidden: the app's own mini window (the
 * dev-driver exerciser's — `headlessExerciserAllowed`), against an ISOLATED
 * backend this rig owns (a worktree venv that carries #1733's `input_mode`
 * carriage AND the aida seat), through a recording proxy that captures the
 * send's wire body. The microphone is Chromium's synthetic device
 * (`--use-fake-device-for-media-stream`); the transcription relay answers from
 * a fake Radient upstream bound here. Flow:
 *
 *   1. summon the mini window (the real `mini-view:summoned` channel, from
 *      MAIN — a headless run has no OS chord to press);
 *   2. press the mic; wait for the recording state; release; wait for the
 *      transcript (the fake upstream's fixture text) to land in the draft;
 *   3. press Send; read the recorded `POST .../messages` body off the proxy —
 *      `input_mode: "dictated"` is the claim this rig exists for — and the
 *      daemon's own history row back.
 *
 * Run: LO_MINI_SERVE_BIN=<worktree venv local-operator> LO_MINI_TOKEN=<token> \
 *      LO_MINI_APP_ROOT=<built ui worktree> node mini-dict-proof.mjs <out-dir>
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createProbe } from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";

const OUT = process.argv[2];
if (!OUT) throw new Error("usage: mini-dict-proof.mjs <out-dir>");
const SERVE_BIN = process.env.LO_MINI_SERVE_BIN;
const TOKEN = process.env.LO_MINI_TOKEN;
const APP_ROOT = process.env.LO_MINI_APP_ROOT;
if (!SERVE_BIN || !TOKEN || !APP_ROOT)
	throw new Error("LO_MINI_SERVE_BIN, LO_MINI_TOKEN and LO_MINI_APP_ROOT are required");

const RADIENT_PORT = Number(process.env.LO_MINI_RADIENT_PORT ?? 8799);
const TRANSCRIBE_DELAY_MS = Number(process.env.LO_MINI_TRANSCRIBE_DELAY ?? 600);
const FIXTURE = "mini dictated line from the fake upstream.";
/*
 * WHICH HALF OF THE input_mode CONTRACT THIS RUN EXERCISES. `on` (default):
 * a backend that advertises `features.input_mode` — the send must carry the
 * stamp on the wire and in the durable row. `off`: a backend WITHOUT the key
 * (a pre-#1733 build) — the app's capability gate keeps the LEGACY body (the
 * key ABSENT, the shape an `extra="forbid"` backend validates) and the send
 * still lands. Two runs, two backends, one rig.
 */
const HALF = process.env.LO_MINI_HALF ?? "on";

mkdirSync(OUT, { recursive: true });
const report = { out: OUT, proxyRequests: 0, claims: [], steps: [], notes: [], wire: [], history: null };
const record = (step, value) => { report.steps.push({ step, ...value }); console.log(`${step}: ${JSON.stringify(value)}`); };
const verify = (step, hold, detail) => { record(step, { ok: hold === true, ...detail }); if (hold !== true) report.claims.push({ step, ...detail }); };
const note = (text) => { report.notes.push(text); console.log(`note: ${text}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const freePort = async () => {
	for (;;) {
		const candidate = 9500 + Math.floor(Math.random() * 400);
		const free = await new Promise((resolve) => {
			const probe = createProbe();
			probe.on("error", () => resolve(false));
			probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true)));
		});
		if (free) return candidate;
	}
};

/* ------------------------------------------------ the fake Radient upstream */
const radientCalls = [];
const radientUpstream = createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", async () => {
		radientCalls.push({ at: Date.now(), method: req.method, url: req.url });
		if (req.method === "POST" && req.url?.endsWith("/tools/transcriptions")) {
			await sleep(TRANSCRIBE_DELAY_MS);
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ result: { text: FIXTURE, provider: "fixture", status: "ok", error: null, duration: 1 }, error: null, msg: null }));
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ detail: "not found" }));
	});
});
await new Promise((resolve, reject) => { radientUpstream.once("error", reject); radientUpstream.listen(RADIENT_PORT, "127.0.0.1", resolve); });
record("rig.radientUpstream", { port: RADIENT_PORT, delayMs: TRANSCRIBE_DELAY_MS });

/* ------------------------------------------------------ the recording proxy */
let backendPort = null;
const backendBase = () => `http://127.0.0.1:${backendPort}`;
const proxyPort = Number(process.env.LO_MINI_PROXY_PORT ?? 8080);
const MESSAGES_POST = /\/messages$/;
const proxy = createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", async () => {
		report.proxyRequests += 1;
		const requestBody = Buffer.concat(chunks);
		const target = new URL(req.url ?? "/", backendBase());
		const headers = { ...req.headers };
		headers.host = target.host;
		headers["content-length"] = String(requestBody.length);
		try {
			const upstream = await fetch(target, {
				method: req.method,
				headers,
				body: req.method === "GET" || req.method === "HEAD" ? undefined : requestBody.length > 0 ? requestBody : undefined,
			});
			if (req.method === "POST" && MESSAGES_POST.test(target.pathname)) {
				let recorded = null;
				try { recorded = JSON.parse(requestBody.toString("utf8")); } catch { recorded = { unparsable: true }; }
				report.wire.push({ at: Date.now(), path: target.pathname, status: upstream.status, body: recorded });
			}
			const responseHeaders = {};
			for (const [key, value] of upstream.headers.entries()) {
				if (["content-length", "transfer-encoding", "content-encoding"].includes(key)) continue;
				responseHeaders[key] = value;
			}
			res.writeHead(upstream.status, responseHeaders);
			if (upstream.body) Readable.fromWeb(upstream.body).pipe(res);
			else res.end();
		} catch (error) {
			res.writeHead(502, { "content-type": "application/json" });
			res.end(JSON.stringify({ detail: `proxy could not reach upstream: ${error}` }));
		}
	});
});
await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(proxyPort, "127.0.0.1", resolve); });
record("rig.proxy", { port: proxyPort });

/* ---------------------------------------------------------------- isolation */
const HOME_DIR = join(OUT, "home");
const CONFIG_DIR = join(OUT, "config");
const LOG_DIR = join(OUT, "logs");
const USER_DATA = join(OUT, "user-data");
const APP_CWD = join(OUT, "cwd");
const FRAMES_DIR = join(OUT, "frames");
/*
 * THE BACKEND'S OWN ROOTS, SEPARATE FROM THE APP'S ON PURPOSE. The backend
 * writes a serve record under ITS config root; the app reads records from
 * ITS OWN. Sharing one root makes the app discover the backend DIRECTLY
 * (identity proven by the record) and bypass this rig's proxy entirely —
 * measured in run 1: "[discovery] picked http://127.0.0.1:9813" and the
 * proxy recorded nothing. With the app's root empty, discovery finds no
 * record and falls back to the configured origin — the proxy — which is the
 * whole point of the recording hop.
 */
const BACKEND_HOME = join(OUT, "backend-home");
const BACKEND_CONFIG = join(OUT, "backend-config");
const BACKEND_LOGS = join(OUT, "backend-logs");
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA, APP_CWD, FRAMES_DIR, BACKEND_HOME, BACKEND_CONFIG, BACKEND_LOGS]) rmSync(dir, { recursive: true, force: true });
for (const dir of [HOME_DIR, CONFIG_DIR, LOG_DIR, USER_DATA, APP_CWD, FRAMES_DIR, BACKEND_HOME, BACKEND_CONFIG, BACKEND_LOGS]) mkdirSync(dir, { recursive: true });

backendPort = Number(process.env.LO_MINI_BACKEND_PORT) || (await freePort());
const cdpPort = Number(process.env.LO_MINI_CDP_PORT) || (await freePort());
const inspectPort = Number(process.env.LO_MINI_INSPECT_PORT) || (await freePort());

const baseEnv = { ...process.env };
for (const key of Object.keys(baseEnv)) {
	if (key.startsWith("CMUX_") || key.startsWith("LOP_") || key === "XPC_FLAGS") delete baseEnv[key];
}

/* ------------------------------------------------------------- the backend */
writeFileSync(join(BACKEND_CONFIG, "config.yml"), [
	"values:",
	"  hosting: test",
	"  model_name: mock",
	"  tool_approval_mode: auto",
	"",
].join("\n"));
const serve = spawn(SERVE_BIN, ["serve", "--host", "127.0.0.1", "--port", String(backendPort), "--yolo"], {
		env: {
		...baseEnv,
		HOME: BACKEND_HOME,
		LOCAL_OPERATOR_CONFIG_DIR: BACKEND_CONFIG,
		LOCAL_OPERATOR_LOG_DIR: BACKEND_LOGS,
		LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
		RADIENT_API_BASE_URL: `http://127.0.0.1:${RADIENT_PORT}`,
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_NO_TERMINAL_TITLE: "1",
		PYTHONDONTWRITEBYTECODE: "1",
	},
	cwd: OUT,
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
});
const serveLog = [];
serve.stdout.on("data", (d) => serveLog.push(String(d)));
serve.stderr.on("data", (d) => serveLog.push(String(d)));

const api = async (method, path, body) => {
	const response = await fetch(`${backendBase()}${path}`, {
		method,
		headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, body: await response.json().catch(() => null) };
};

let capabilities = null;
{
	const started = Date.now();
	for (;;) {
		try {
			const answer = await api("GET", "/v1/capabilities");
			if (answer.status === 200 && answer.body?.result?.features) { capabilities = answer.body.result.features; break; }
		} catch { /* not up yet */ }
		if (Date.now() - started > 60_000) throw new Error(`backend never answered: ${serveLog.join("").split("\n").slice(-12).join("\n")}`);
		await sleep(300);
	}
}
record("rig.capabilities", { input_mode: capabilities.input_mode ?? null, aida: capabilities.aida ?? null });
verify(
	"the backend carries the seat this run needs, and the carriage the half expects",
	capabilities.aida === 1 &&
		(HALF === "on" ? capabilities.input_mode === 1 : capabilities.input_mode === undefined),
	{ half: HALF, input_mode: capabilities.input_mode ?? null, aida: capabilities.aida ?? null },
);
const seeded = await api("PATCH", "/v1/credentials", { key: "RADIENT_API_KEY", value: "placeholder-for-the-proof-rig" });
verify("the placeholder Radient key is seeded (the transcription relay reads it)", seeded.status === 200, { status: seeded.status });

/* ------------------------------------------------------------------ the app */
const appRequire = createRequire(join(APP_ROOT, "package.json"));
const electronBin = appRequire("electron");
writeFileSync(join(APP_CWD, ".env"), [
	"# Written by mini-dict-proof.mjs; the app loads this with dotenv override:true from its cwd.",
	`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${proxyPort}`,
	"VITE_DISABLE_BACKEND_MANAGER=true",
	"",
].join("\n"));

const app = spawn(electronBin, [
	APP_ROOT,
	`--user-data-dir=${USER_DATA}`,
	`--remote-debugging-port=${cdpPort}`,
	`--inspect=${inspectPort}`,
	"--window-mode=headless",
	"--window-size=1380x900",
	"--use-mock-keychain",
	"--use-fake-device-for-media-stream",
], {
	env: {
		...baseEnv,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
		VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${proxyPort}`,
		LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
		LOCAL_OPERATOR_UI_DEV_DRIVER: "1",
		LOCAL_OPERATOR_UI_DEV_DRIVER_OUT: FRAMES_DIR,
		LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
		LOCAL_OPERATOR_UI_TELEMETRY: "off",
	},
	cwd: APP_CWD,
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
});
const appLog = [];
app.stdout.on("data", (d) => appLog.push(String(d)));
app.stderr.on("data", (d) => appLog.push(String(d)));

/* -------------------------------------------------------------- CDP clients */
class Cdp {
	constructor(socket) { this.socket = socket; this.nextId = 1; this.pending = new Map(); socket.addEventListener("message", (event) => { let m = null; try { m = JSON.parse(event.data); } catch { return; } if (m.id !== undefined && this.pending.has(m.id)) { const settle = this.pending.get(m.id); this.pending.delete(m.id); settle(m); } }); }
	send(method, params = {}) {
		const id = this.nextId++;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolveReply, rejectReply) => {
			this.pending.set(id, (m) => (m.error ? rejectReply(new Error(`${method}: ${m.error.message}`)) : resolveReply(m.result)));
			setTimeout(() => { if (this.pending.delete(id)) rejectReply(new Error(`CDP ${method} timed out`)); }, 30_000);
		});
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`);
		return result.result.value;
	}
}
const attachPage = async (port, urlPart, timeoutMs = 90_000) => {
	const started = Date.now();
	for (;;) {
		const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
		const target = list.find((entry) => entry.type === "page" && entry.url.includes(urlPart));
		if (target) {
			const socket = new WebSocket(target.webSocketDebuggerUrl);
			await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", rejectOpen, { once: true }); });
			const client = new Cdp(socket);
			client.send("Runtime.enable").catch(() => {});
			return client;
		}
		if (Date.now() - started > timeoutMs) throw new Error(`no target for ${urlPart}: ${JSON.stringify(list.map((e) => ({ type: e.type, url: e.url })))}`);
		await sleep(250);
	}
};
const attachNode = async (port, timeoutMs = 90_000) => {
	const started = Date.now();
	for (;;) {
		let list = [];
		try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { list = []; }
		const target = list.find((entry) => entry.type === "node");
		if (target) {
			const socket = new WebSocket(target.webSocketDebuggerUrl);
			await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", rejectOpen, { once: true }); });
			const client = new Cdp(socket);
			client.send("Runtime.enable").catch(() => {});
			return client;
		}
		if (Date.now() - started > timeoutMs) throw new Error("no main-process inspector target");
		await sleep(250);
	}
};

/* --------------------------------------------------------------- the drive */
const settleAndReap = () => {
	writeFileSync(join(OUT, "mini-dict-proof.json"), `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(join(OUT, "app.log"), appLog.join(""));
	writeFileSync(join(OUT, "serve.log"), serveLog.join(""));
	try { process.kill(-app.pid, "SIGKILL"); } catch { app.kill("SIGKILL"); }
	try { process.kill(-serve.pid, "SIGKILL"); } catch { serve.kill("SIGKILL"); }
	try { spawn("pkill", ["-f", `user-data-dir=${USER_DATA}`], { stdio: "ignore" }); } catch { /* no match is the good case */ }
	try { proxy.close(); } catch {}
	try { radientUpstream.close(); } catch {}
};

try {
	// The main-process inspector and the mini window (created by the exerciser).
	const main = await attachNode(inspectPort);
	const findMini = [
		"(() => {",
		"\tconst electron = process.mainModule?.require(\"electron\") ?? globalThis.require?.(\"electron\");",
		"\tconst windows = electron.BrowserWindow.getAllWindows();",
		"\tconst miniWindow = windows.find((candidate) => (candidate.webContents.getURL() || '').endsWith('mini.html'));",
		"\tif (!miniWindow) return null;",
		"\tglobalThis.__miniWindow = miniWindow;",
		"\treturn { visible: miniWindow.isVisible(), focused: miniWindow.isFocused(), url: miniWindow.webContents.getURL() };",
		"})()",
	].join("\n");
	let owned = null;
	{
		const started = Date.now();
		for (;;) {
			owned = await main.evaluate(findMini).catch(() => null);
			if (owned) break;
			if (Date.now() - started > 90_000) throw new Error(`no mini window; log tail:\n${appLog.join("").split("\n").slice(-25).join("\n")}`);
			await sleep(500);
		}
	}
	verify("the app's own mini window exists, hidden", owned.visible === false && owned.focused === false, owned);
	record("app.bootLines", { mini: appLog.join("").split("\n").filter((l) => l.includes("mini-view:")).slice(0, 4) });

	// Summon over the real channel, from MAIN.
	const summoned = await main.evaluate([
		"(() => {",
		"\tconst channel = \"mini-view:summoned\";",
		"\tglobalThis.__miniWindow.webContents.send(channel, { at: Date.now() });",
		"\treturn globalThis.__miniWindow.isVisible();",
		"})()",
	].join("\n"));
	verify("the summoned mini window stayed hidden (headless presentation refuses)", summoned === false, { visible: summoned });

	const mini = await attachPage(cdpPort, "mini.html");
	// The app must be attached to the daemon before the drive: wait for the proxy
	// to have carried at least one request (the seat resolution rides it).
	{
		const started = Date.now();
		while (report.proxyRequests === 0) {
			if (Date.now() - started > 90_000) throw new Error("the app never reached the proxy");
			await sleep(400);
		}
	}
	record("rig.appConnected", { proxyRequests: report.proxyRequests });
	const waitFor = async (expression, ready, description, timeoutMs = 45_000) => {
		const started = Date.now();
		let value = null;
		for (;;) {
			value = await mini.evaluate(expression).catch(() => null);
			if (value !== null && ready(value)) return value;
			if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${description}; last: ${JSON.stringify(value)}`);
			await sleep(150);
		}
	};
	const select = (tag) => `document.querySelector('[data-tour-tag="${tag}"]')`;

	// The recordings', stop's and sent's sentences as the shipped copy spells them.
	const copySource = readFileSync(join(APP_ROOT, "src/renderer/src/mini-view/mini-copy.ts"), "utf8");
	const copySentence = (key) => {
		const marker = `${key}: "`;
		const start = copySource.indexOf(marker);
		if (start === -1) throw new Error(`mini-copy.ts has no ${key}`);
		return copySource.slice(start + marker.length, copySource.indexOf('"', start + marker.length));
	};
	const dictationStop = copySentence("dictationStop");
	const recordingSentence = copySentence("recording"); // eslint-disable-line no-unused-vars

	await waitFor(`${select("mini-composer-input")} !== null`, (v) => v === true, "the composer mounted");
	// The seat resolution runs off the summon; the app also polls the daemon, so
	// give the proxy a beat, then read the state.
	const clickAt = async (tag) => {
		const rect = await mini.evaluate(`(() => { const el = ${select(tag)}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.disabled === true }; })()`);
		if (rect === null || rect.disabled) throw new Error(`cannot press ${tag}: ${JSON.stringify(rect)}`);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await mini.send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
			await sleep(30);
		}
	};

	// 1. Mic on.
	await clickAt("mini-composer-mic");
	const recordingState = await waitFor(
		`(${select("mini-composer-mic")}?.getAttribute('aria-label') ?? '') + '|' + (${select("mini-composer-status")}?.textContent ?? '')`,
		(v) => typeof v === "string" && v.startsWith(dictationStop),
		"the recording state after the mic press",
	);
	record("mini.dictation.records", { state: recordingState });
	await sleep(1200);

	// 2. Mic off -> transcribing -> transcript lands.
	await clickAt("mini-composer-mic");
	const transcript = await waitFor(
		`(${select("mini-composer-input")}?.value ?? '')`,
		(v) => typeof v === "string" && v.includes("fake upstream"),
		"the transcript to land in the draft",
	);
	verify("the dictated transcript landed in the mini's draft", transcript === FIXTURE, { transcript });

	// One still of the dictated draft (best-effort; the mini scene's blank-retry rule).
	const shot = await main.evaluate([
		"(async () => {",
		"\tconst window = globalThis.__miniWindow;",
		"\tfor (let attempt = 1; attempt <= 3; attempt += 1) {",
		"\t\ttry {",
		"\t\t\tconst image = await window.webContents.capturePage();",
		"\t\t\tif (!image.isEmpty()) { const png = image.toPNG(); return { ok: true, bytes: png.length, base64: png.toString('base64') }; }",
		"\t\t} catch (error) { /* retry below */ }",
		"\t\tawait new Promise((resolve) => setTimeout(resolve, 250 * attempt));",
		"\t}",
		"\treturn { ok: false };",
		"})()",
	].join("\n"));
	if (shot?.ok) {
		writeFileSync(join(OUT, "01-dictated-draft.png"), Buffer.from(shot.base64, "base64"));
		note(`frame 01-dictated-draft.png captured (${shot.bytes} bytes)`);
	} else {
		note("the dictated-draft frame could not be captured on this run (recorded, not claimed)");
	}

	// 3. Send, and read the wire.
	await clickAt("mini-composer-send");
	const sentAt = Date.now();
	let wire = null;
	{
		const started = Date.now();
		for (;;) {
			wire = report.wire.find((entry) => entry.path.endsWith("/messages") && entry.body?.text === FIXTURE) ?? null;
			if (wire) break;
			if (Date.now() - started > 45_000) throw new Error(`no message reached the proxy; wire so far: ${JSON.stringify(report.wire)}`);
			await sleep(250);
		}
	}
	verify(
		HALF === "on"
			? "the mini's dictated send reached the wire with input_mode: dictated"
			: "the mini's dictated send reached the wire as the LEGACY body (no input_mode key)",
		HALF === "on"
			? wire.body.input_mode === "dictated" &&
					wire.body.mode === "prompt" &&
					wire.body.text === FIXTURE
			: !Object.hasOwn(wire.body, "input_mode") &&
					wire.body.mode === "prompt" &&
					wire.body.text === FIXTURE,
		{ half: HALF, status: wire.status, body: wire.body },
	);
	verify("the daemon admitted it (2xx)", wire.status >= 200 && wire.status < 300, { status: wire.status });

	// The durable row, read back from the daemon's own history.
	const sessionId = wire.path.split("/")[4];
	const history = await api("GET", `/v1/desktop/sessions/${sessionId}/history?limit=10`);
	const historyText = JSON.stringify(history.body ?? null);
	report.history = { sessionId, status: history.status, carriesText: historyText.includes(FIXTURE), carriesStamp: /"input_mode":\s*"dictated"/.test(historyText) };
	verify(
		"the daemon's own history carries the message" +
			(HALF === "on" ? ", stamped" : ", without the key"),
		report.history.carriesText &&
			(HALF === "on" ? report.history.carriesStamp : !report.history.carriesStamp),
		report.history,
	);

	// Hidden throughout.
	const stillHidden = await main.evaluate("({ visible: globalThis.__miniWindow.isVisible(), focused: globalThis.__miniWindow.isFocused() })");
	verify("the window was never shown or focused, start to finish", stillHidden.visible === false && stillHidden.focused === false, stillHidden);
	record("rig.radientCalls", { count: radientCalls.length, calls: radientCalls.slice(0, 3) });
	note(`send pressed at ${sentAt}; wire record at ${wire.at} (delta ${wire.at - sentAt} ms)`);
	note("synthetic microphone (Chromium fake device): macOS TCC is not in this path.");
} catch (error) {
	report.error = String(error);
	note(`run failed: ${String(error)}`);
} finally {
	settleAndReap();
}

const failed = report.claims.length > 0 || report.error;
console.log(failed ? `FAIL: ${JSON.stringify(report.claims)}` : "ALL CLAIMS HELD");
process.exit(failed ? 1 : 0);
