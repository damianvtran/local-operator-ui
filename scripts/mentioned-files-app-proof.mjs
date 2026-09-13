/*
 * Prove the Files panel's producer fires in the REAL app.
 *
 * Why this exists as a script rather than as a paragraph in a PR: the claim it
 * checks - "a file the agent mentioned now appears in the panel" - is a claim
 * about a running application. Unit tests cover the extractor and the grid's
 * view model, but nothing in `test:desktop` can show that a real transcript
 * becomes a real tile, and the panel's producer has a history of being dead in
 * exactly the way a green suite cannot see.
 *
 * What it does: runs the BUILT app (`out/`, from `pnpm build`) with
 * `LOCAL_OPERATOR_UI_WINDOW_MODE=headless` against a live backend, in an
 * ISOLATED user-data-dir so the operator's own UI state is untouched. Then it
 * drives the app over raw CDP - no dependency, the built-in WebSocket is the
 * transport - navigates to a real session, opens the canvas, switches to the
 * Files view, reads what the panel contains, clicks the PDF tile, and reads the
 * frame that appeared. Two screenshots land in the output directory.
 *
 * It never sends a turn and never writes to the backend: the run reads a
 * session's durable history and paints it.
 *
 * PAIRING, and the trap in it. A second instance of the app did not start the
 * backend, so it holds no bearer and every session control answers 503 - the
 * panel renders, empty, and a run that does not check for this reports zero
 * mentions as though that were a result. Hand it the bearer the running backend
 * was started with. The token lives in the BACKEND process, which is the one
 * listening on the port; the app process does not carry it, and asking the app
 * is how this recipe silently produced nothing the first time it was written:
 *
 *   export LO_PROOF_TOKEN=$(ps eww -p "$(lsof -nP -iTCP:1111 -sTCP:LISTEN -t | head -1)" \
 *     | tr ' ' '\n' | grep -m1 '^LOCAL_OPERATOR_DESKTOP_TOKEN=' | cut -d= -f2)
 *
 * The value is read from the environment and never printed, logged, or written
 * into the report - which is also why this script takes it as an env var rather
 * than as an argument that would land in a shell history.
 *
 * Usage: node scripts/mentioned-files-app-proof.mjs <session-id> [out-dir]
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const SESSION = process.argv[2] ?? "225326399eed";
const OUT = process.argv[3] ?? "/tmp/lo-producer-proof";
const PORT = 9333;
const DEADLINE_MS = 90_000;

mkdirSync(OUT, { recursive: true });
const log = [];

const app = spawn(
	"./node_modules/.bin/electron",
	[".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/user-data`],
	{
		env: {
			...process.env,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			// The operator's backend is already live on :1111; this app must not
			// try to manage or spawn one.
			VITE_DISABLE_BACKEND_MANAGER: "true",
			// Pairing: this app did not start the backend, so it must be handed the
			// bearer the running one was started with. Passed in by the caller so
			// the value is never written down here.
			LOCAL_OPERATOR_DESKTOP_TOKEN: process.env.LO_PROOF_TOKEN ?? undefined,
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);
app.stdout.on("data", (d) => log.push(`[app] ${d}`));
app.stderr.on("data", (d) => log.push(`[app:err] ${d}`));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
	try {
		const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
		return await response.json();
	} catch {
		return [];
	}
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			if (message.id !== undefined && this.pending.has(message.id)) {
				const { resolve, reject } = this.pending.get(message.id);
				this.pending.delete(message.id);
				message.error
					? reject(new Error(message.error.message))
					: resolve(message.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
	async evaluate(expression) {
		const result = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (result.exceptionDetails)
			throw new Error(
				`evaluate failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails)}`,
			);
		return result.result.value;
	}
}

const deadline = Date.now() + DEADLINE_MS;
let page = null;
while (Date.now() < deadline) {
	page = (await targets()).find((target) => target.type === "page");
	if (page) break;
	await sleep(500);
}
if (!page) {
	console.error(`no renderer target appeared; log:\n${log.join("")}`);
	process.exit(1);
}

if (!process.env.LO_PROOF_TOKEN) {
	// Fail here rather than reporting an empty panel as a finding. An unpaired
	// instance renders the Files view with nothing in it, which looks exactly
	// like a producer that did not fire.
	console.error(
		"LO_PROOF_TOKEN is unset, so this instance would hold no bearer and no session would load. See the header for how to read it from the running backend.",
	);
	app.kill("SIGKILL");
	process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve);
	ws.addEventListener("error", reject);
});
const cdp = new Cdp(ws);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

const report = { session: SESSION, out: OUT };

// Assert the pairing before reading anything else: every claim below depends on
// the app having been allowed to talk to the backend.
const capabilities = await cdp.evaluate(
	`(async () => { try { const r = await window.api.desktop.request({ op: "capabilities" }); return JSON.stringify(r.body?.result ?? r); } catch (e) { return "THREW: " + e.message; } })()`,
);
report.capabilities = capabilities;
if (!String(capabilities).includes('"desktop_available":true')) {
	console.error(
		`the app is not paired with the backend (capabilities: ${capabilities}); nothing below would be meaningful`,
	);
	ws.close();
	app.kill("SIGKILL");
	process.exit(3);
}

// 0. Record any CSP violation the PDF path causes. The design's probe found
//    that the `<embed>` variant of a blob PDF is blocked by our own CSP, so the
//    frame must be an `<iframe>` and a violation here would be the regression.
await cdp.evaluate(`(() => {
	window.__cspViolations = [];
	document.addEventListener("securitypolicyviolation", (event) => {
		window.__cspViolations.push(event.violatedDirective + " " + event.blockedURI);
	});
	return true;
})()`);

// 1. Navigate to the real session. HashRouter, so the hash is the route.
await cdp.evaluate(`location.hash = "#/chat/${SESSION}"; true`);

// 2. Wait for the producer to have written the store. The canvas store is a
//    zustand `persist` store, so what the panel will render is exactly what
//    localStorage holds - and reading it proves the producer ran, not just that
//    a component mounted.
let stored = null;
while (Date.now() < deadline) {
	stored = await cdp.evaluate(`localStorage.getItem("canvas-store")`);
	if (stored?.includes(SESSION)) break;
	await sleep(1000);
}
const parsed = stored ? JSON.parse(stored) : null;
const conversation = parsed?.state?.conversations?.[SESSION] ?? null;
report.mentionedFilesWritten = conversation?.mentionedFiles?.length ?? 0;
report.mentionedFilesSample = (conversation?.mentionedFiles ?? [])
	.slice(0, 8)
	.map((document) => ({
		path: document.path,
		type: document.type,
		availability: document.availability ?? null,
		sizeBytes: document.sizeBytes ?? null,
		contentLength: document.content?.length ?? 0,
	}));

// 3. Open the canvas and switch to the Files view.
report.openedCanvas = await cdp.evaluate(`(() => {
	const button = document.querySelector('[data-tour-tag="open-canvas-button"]');
	if (!button) return false;
	button.click();
	return true;
})()`);
await sleep(700);
report.switchedToFiles = await cdp.evaluate(`(() => {
	const button = document.querySelector('button[aria-label="Files view"]');
	if (!button) return false;
	button.click();
	return true;
})()`);
await sleep(2500);

// 4. What the grid actually renders.
report.filesGrid = await cdp.evaluate(`(() => {
	const tiles = [...document.querySelectorAll("button")].filter((button) =>
		button.querySelector("span span, span"),
	);
	const grid = document.querySelector(".grid");
	const texts = grid
		? [...grid.querySelectorAll("button")].map((b) => b.innerText.trim())
		: [];
	return { tileCount: texts.length, texts };
})()`);

await cdp.evaluate(
	`document.querySelector('[aria-label="Files view"]')?.scrollIntoView()`,
);
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/files-panel.png`, Buffer.from(shot.data, "base64"));

// 5. Click the PDF tile and read the frame the viewer created. This is the
//    "prove the producer fires AND the viewer opens it" half.
report.pdfTileClicked = await cdp.evaluate(`(() => {
	const grid = document.querySelector(".grid");
	if (!grid) return false;
	const tile = [...grid.querySelectorAll("button")].find((button) =>
		button.innerText.toLowerCase().includes(".pdf"),
	);
	if (!tile) return false;
	tile.click();
	return true;
})()`);
await sleep(2500);
report.pdfFrame = await cdp.evaluate(`(() => {
	const frame = document.querySelector('iframe[src^="blob:"]');
	const chromeBar = document.querySelector(".border-hairline.border-b.bg-surface span");
	return {
		framePresent: Boolean(frame),
		frameSrcScheme: frame ? frame.src.split(":")[0] : null,
		frameTitle: frame ? frame.getAttribute("title") : null,
		chromeBarText: chromeBar ? chromeBar.textContent : null,
		cspViolations: window.__cspViolations ?? null,
		panelText: document.body.innerText.includes("Not found"),
	};
})()`);
const shot2 = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync(`${OUT}/pdf-viewer.png`, Buffer.from(shot2.data, "base64"));

report.appLogTail = log.slice(-8);
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

ws.close();
app.kill("SIGTERM");
await sleep(1000);
app.kill("SIGKILL");
