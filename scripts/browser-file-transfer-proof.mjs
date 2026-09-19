#!/usr/bin/env node
/**
 * End-to-end proof for browser FILE TRANSFER on the desktop app's host: a real
 * download into the harness-composed directory, the refusals, and a real
 * multi-file upload to a real form.
 * Design: docs/design/browser-file-transfer.md §6.1, §9.2, §9.3, §10.3, §11.4,
 * §12.1, §12.3.
 *
 * WHY A COMMITTED RIG RATHER THAN A PASTED TRANSCRIPT. The claim this PR makes is
 * about a running application: that a page's download lands on disk at a path the
 * HARNESS chose, that an executable is refused before it lands, that an attach
 * puts real bytes into a real form, and that the row the user sees is driven by
 * those facts. `scripts/browser-host.test.mjs` proves the RULES against the
 * shipped TypeScript and never loads a page; this is the run that can falsify the
 * feature claim, and a transcript that cannot be re-run is a claim rather than
 * evidence.
 *
 * HOW THE FRAMES ARE MADE, and why nothing is screenshotted from the desktop: the
 * app's renderer is captured over CDP (`Page.captureScreenshot`), which is the
 * chrome band and everything the app paints; the driven page is captured by the
 * HOST's own `screenshot` action, the same call the agent's tool makes. They are
 * composited at the rectangle the renderer reports to main, so a frame shows what
 * the user's screen shows. NO browser engine is installed or scripted, and no
 * macOS `screencapture` is used — it photographs the frontmost window and would
 * require exactly the focus theft the window modes exist to remove.
 *
 * Isolation (each piece is load-bearing, and copied from
 * `scripts/browser-chrome-proof.mjs` for the reasons recorded there):
 *   - `HOME` AND `LOCAL_OPERATOR_CONFIG_DIR` are both redirected, so the run
 *     cannot read the operator's real config, secret store or quarantine;
 *   - `LOCAL_OPERATOR_LOG_DIR` is redirected too, because the app's logger takes
 *     its default from the OS ACCOUNT's home rather than the `HOME` variable;
 *   - the Electron profile root is a scratch `--user-data-dir`;
 *   - `--window-mode=headless`, and every `CMUX_*`/`LOP_*` variable is removed:
 *     the app must never take the operator's focus, and an inherited cmux
 *     workspace id has already renamed his real workspaces once.
 *
 * Usage: node scripts/browser-file-transfer-proof.mjs [--out <dir>] [--keep]
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";

const ROOT = process.cwd();
const ELECTRON_BIN = createRequire(import.meta.url)("electron");
const KEEP = process.argv.includes("--keep");
const OUT_DIR =
	argValue("--out") || join(tmpdir(), `lo-file-transfer-frames-${process.pid}`);
const SCRATCH = join(tmpdir(), `lo-file-transfer-proof-${process.pid}`);
const HOME_DIR = join(SCRATCH, "home");
const CONFIG_DIR = join(SCRATCH, "config");
const USER_DATA = join(SCRATCH, "userdata");
const LOG_DIR = join(SCRATCH, "logs");
/** The quarantine root the HARNESS composes: `<config>/browser/downloads/<stamp>-<session8>/`
 * (`browser_files.session_dir`). The rig composes the same shape rather than a
 * convenient temp dir, because "the host writes where the harness says" is only
 * shown if the harness's own path shape is the one used. */
const QUARANTINE = join(
	CONFIG_DIR,
	"browser",
	"downloads",
	"20260918-120000-proof",
);
const WINDOW_SIZE = { width: 1380, height: 900 };

function argValue(flag, fallback = "") {
	const index = process.argv.indexOf(flag);
	return index > -1 ? (process.argv[index + 1] ?? fallback) : fallback;
}

// ---- the transcript ---------------------------------------------------------

const transcript = [];

function record(label, body) {
	transcript.push({ label, body });
}

function say(line) {
	console.log(line);
}

/** One claim, with the evidence that decided it. A FAIL is never silent. */
function check(label, ok, detail = "") {
	record(label, `${ok ? "PASS" : "FAIL"}${detail ? ` — ${detail}` : ""}`);
	say(
		`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`,
	);
	if (!ok) failures.push(label);
	return ok;
}

function blocked(label, detail) {
	record(label, `BLOCKED — ${detail}`);
	say(`BLOCKED  ${label}\n        ${detail}`);
	blockedItems.push({ label, detail });
}

const failures = [];
const blockedItems = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll until `reading` answers truthy, so the rig waits on the PRODUCT rather than
 * on a sleep: a fixed wait is the flake, and a null answer here is reported by the
 * check that needed it. */
async function waitFor(reading, timeoutMs = 20_000) {
	const started = Date.now();
	for (;;) {
		try {
			const value = await reading();
			if (value) return value;
		} catch {
			// Evaluating against a document mid-render is a "not yet".
		}
		if (Date.now() - started > timeoutMs) return null;
		await sleep(200);
	}
}

// ---- the local site the proof drives ---------------------------------------

const PDF_BYTES = (index) =>
	Buffer.from(
		`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%% receipt ${index}\n`,
	);
const PE_BYTES = Buffer.from(
	"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00",
	"binary",
);
const EXE_NAME = "setup.exe";
const RECEIPTS = 7;
/** Over the per-file cap, declared so the host can refuse it BEFORE the write.
 * The body is never finished: the refusal happens at `will-download`. */
const OVER_CAP_BYTES = 256 * 1024 * 1024 + 1;
/** The same cap as a string, for the negative half of `C4`: the refusal must NOT
 * print the raw byte count beside a raw byte count any more (review round 1, D1). */
const CAPS_BYTES = String(256 * 1024 * 1024);
/** A name long enough that the refusal's own sentence cannot fit beside it, which is
 * the case D3 is about: the NAME must elide and the consequence must not. Measured
 * rather than guessed — see G8, which asserts which span is the clipped one. */
const LONG_EXE_NAME = `${"quarterly-financial-statements-and-notes-2026-q3-final".repeat(
	3,
)}.exe`;

let sitePort = 0;
/** What the upload endpoint actually received, so the proof can compare digests
 * SERVER-side: a filled-looking input is not evidence that bytes arrived (§12.1). */
const uploads = [];

function page(title, body) {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font:16px -apple-system,system-ui,sans-serif;background:#0f1b2a;color:#e8f1ff">
<div style="padding:32px">
<h1 style="margin:0 0 16px;font-size:28px">${title}</h1>
${body}
</div></body></html>`;
}

function startSite() {
	return new Promise((resolve) => {
		const server = createServer((request, response) => {
			const url = new URL(request.url, `http://127.0.0.1:${sitePort}`);
			const path = url.pathname;

			if (path === "/receipts") {
				// The 2026-09-18 case: seven receipts behind ONE control that starts
				// seven downloads, which is the shape §10.3's per-call cap exists for.
				const links = Array.from(
					{ length: RECEIPTS },
					(_, index) =>
						`<a id="receipt-${index + 1}" href="/receipt/${index + 1}.pdf" download>Receipt ${index + 1}</a>`,
				).join(" &middot; ");
				response.writeHead(200, { "Content-Type": "text/html" });
				response.end(
					page(
						"Receipts",
						`<p>${links}</p>
<button id="download-all" onclick="document.querySelectorAll('a[id^=receipt-]').forEach(a => a.click())">Download all</button>
<p><button id="nothing" type="button">Nothing</button></p>
<p><a id="exe-link" href="/setup.exe" download>${EXE_NAME}</a></p>
<p><a id="huge-link" href="/huge.pdf" download>huge.pdf</a></p>
<p><a id="long-exe-link" href="/long.exe" download>${LONG_EXE_NAME}</a></p>
<p><a id="stall-link" href="/stall.pdf" download>quarterly-accounts.pdf</a></p>
<p><a id="hung-link" href="/hung.pdf" download>never-finishes.pdf</a></p>
<p><a id="slow-a-link" href="/slow-a.pdf" download>slow-a.pdf</a></p>
<p><a id="slow-b-link" href="/slow-b.pdf" download>slow-b.pdf</a></p>
<p><a id="dup-link" href="#" onclick="document.getElementById('dup-a').click(); document.getElementById('dup-b').click(); return false">Two files named same.pdf</a></p>
<p hidden><a id="dup-a" href="/dup-a.pdf" download>dup a</a><a id="dup-b" href="/dup-b.pdf" download>dup b</a></p>`,
					),
				);
				return;
			}
			if (path.startsWith("/receipt/")) {
				const index = Number(path.split("/").pop().replace(".pdf", "")) || 1;
				const bytes = PDF_BYTES(index);
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(bytes.length),
					"Content-Disposition": `attachment; filename="receipt-${index}.pdf"`,
				});
				response.end(bytes);
				return;
			}
			if (path === "/setup.exe") {
				response.writeHead(200, {
					"Content-Type": "application/octet-stream",
					"Content-Length": String(PE_BYTES.length),
					"Content-Disposition": `attachment; filename="${EXE_NAME}"`,
				});
				response.end(PE_BYTES);
				return;
			}
			if (path === "/huge.pdf") {
				// Headers with a real Content-Length and a body that never arrives: the
				// host's pre-write cap reads the declared total, so the refusal is decided
				// before a byte is written, which is the whole point of capping here.
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(OVER_CAP_BYTES),
					"Content-Disposition": 'attachment; filename="huge.pdf"',
				});
				response.write(Buffer.alloc(1024));
				return;
			}
			if (path === "/stall.pdf") {
				// DECLARES 200 KB AND STOPS AFTER 100 KB (review round 1, U1): the shape the
				// round-1 walk found with NO row, `notes: []` and a partial file on disk under
				// a complete-looking name. The socket is aborted rather than ended cleanly, so
				// Chromium reports the write as `interrupted` rather than as a short file.
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(204_800),
					"Content-Disposition": 'attachment; filename="quarterly-accounts.pdf"',
				});
				response.write(Buffer.alloc(102_400, 7));
				setTimeout(() => response.destroy(), 50);
				return;
			}
			if (path === "/hung.pdf") {
				// DECLARES 5 MB AND NEVER ANSWERS: the write stays in flight for the whole
				// call, which is the deadline path (B1/M1).
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(5 * 1024 * 1024),
					"Content-Disposition": 'attachment; filename="never-finishes.pdf"',
				});
				return;
			}
			if (path === "/slow-a.pdf" || path === "/slow-b.pdf") {
				// 4 MB in chunks, so the row can be read and photographed WHILE it writes
				// (D6's in-progress state, U6's progress line) — and so a deadline can arrive
				// with bytes on disk, which is the case B1/M1 is about.
				const name = path.slice(1);
				const chunks = 64;
				const size = chunks * 64 * 1024;
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(size),
					"Content-Disposition": `attachment; filename="${name}"`,
				});
				let sent = 0;
				const timer = setInterval(() => {
					if (sent >= chunks) {
						clearInterval(timer);
						response.end();
						return;
					}
					sent += 1;
					response.write(Buffer.alloc(64 * 1024, 3));
				}, 40);
				response.on("close", () => clearInterval(timer));
				return;
			}
			if (path === "/dup-a.pdf" || path === "/dup-b.pdf") {
				// TWO DIFFERENT URLS, ONE FILENAME (review round 1, Q1): both accepted in one
				// call, both in flight, and the disk empty for both when each is probed.
				const body = Buffer.from(path.endsWith("a.pdf") ? "first" : "second");
				response.writeHead(200, {
					"Content-Type": "application/pdf",
					"Content-Length": String(body.length),
					"Content-Disposition": 'attachment; filename="same.pdf"',
				});
				response.end(body);
				return;
			}
			if (path === "/long.exe") {
				response.writeHead(200, {
					"Content-Type": "application/octet-stream",
					"Content-Length": String(PE_BYTES.length),
					"Content-Disposition": `attachment; filename="${LONG_EXE_NAME}"`,
				});
				response.end(PE_BYTES);
				return;
			}
			if (path === "/auto") {
				// A page that starts its OWN download, one and a half seconds after it
				// loads — which is the case the whole feature is designed around
				// (design §11.3: a page-initiated download needs no new permission and
				// no click from us) and the one the no-selector form of `download`
				// exists for. The delay is what makes the arm land FIRST; a page that
				// fired immediately would be racing the call that has to capture it.
				response.writeHead(200, { "Content-Type": "text/html" });
				response.end(
					page(
						"Auto download",
						`<p>The page starts a download by itself.</p>
<script>
	setTimeout(() => {
		const link = document.createElement('a');
		link.href = '/receipt/8.pdf';
		link.download = '';
		document.body.appendChild(link);
		link.click();
	}, 4000);
</script>`,
					),
				);
				return;
			}
			if (path === "/form") {
				response.writeHead(200, { "Content-Type": "text/html" });
				response.end(
					page(
						"Attach documents",
						`<form id="form" method="post" action="/echo" enctype="multipart/form-data">
<input id="files" type="file" name="files" multiple accept=".pdf,.pptx,.zip">
<button id="send" type="submit">Send</button>
</form>`,
					),
				);
				return;
			}
			if (path === "/echo" && request.method === "POST") {
				const chunks = [];
				request.on("data", (chunk) => chunks.push(chunk));
				request.on("end", () => {
					for (const part of parseMultipart(
						Buffer.concat(chunks),
						request.headers["content-type"],
					)) {
						uploads.push({
							name: part.filename,
							bytes: part.body.length,
							sha256: createHash("sha256").update(part.body).digest("hex"),
						});
					}
					const body = JSON.stringify({ received: uploads.length });
					response.writeHead(200, {
						"Content-Type": "application/json",
						"Content-Length": String(Buffer.byteLength(body)),
					});
					response.end(body);
				});
				return;
			}
			response.writeHead(200, { "Content-Type": "text/html" });
			response.end(page("Proof page", "Nothing here starts a download."));
		});
		server.listen(0, "127.0.0.1", () => {
			sitePort = server.address().port;
			resolve({ server, port: sitePort });
		});
	});
}

/** The parts of a multipart/form-data body, with the filename and the bytes. A
 * hand-rolled parser because this endpoint's whole job is to report what actually
 * arrived, and a framework's own parse would move that answer one layer away. */
function parseMultipart(body, contentType = "") {
	const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
	const boundary = match?.[1] ?? match?.[2];
	if (!boundary) return [];
	const parts = [];
	const separator = Buffer.from(`--${boundary}`);
	let index = body.indexOf(separator);
	while (index !== -1) {
		const next = body.indexOf(separator, index + separator.length);
		if (next === -1) break;
		const chunk = body.subarray(index + separator.length, next);
		const headerEnd = chunk.indexOf("\r\n\r\n");
		if (headerEnd !== -1) {
			const headers = chunk.subarray(0, headerEnd).toString("utf8");
			const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
			if (filename) {
				parts.push({
					filename,
					body: chunk.subarray(headerEnd + 4, chunk.length - 2),
				});
			}
		}
		index = next;
	}
	return parts;
}

const origin = () => `http://127.0.0.1:${sitePort}`;

// ---- the app ----------------------------------------------------------------

let app = null;
let devtoolsPort = 0;

async function freePort() {
	const { createServer: create } = await import("node:net");
	return await new Promise((resolve) => {
		const server = create();
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => resolve(port));
		});
	});
}

async function launchApp() {
	const env = withNotificationsOff({
		...process.env,
		HOME: HOME_DIR,
		LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR,
		LOCAL_OPERATOR_LOG_DIR: LOG_DIR,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	devtoolsPort = await freePort();
	const child = spawn(
		ELECTRON_BIN,
		// THE KEYCHAIN SWITCHES, and this app launch is exactly the shape the repo's own
		// keychain guard cannot see (review round 1, operator-safety item):
		// `chrome-keychain.test.mjs` classifies a launch by whether the command it starts
		// says "chrome", and an Electron rig boots the app rather than a browser - so the
		// argv below is invisible to the very scan that exists to keep this switch on
		// every launch. It is passed through `withMockKeychain` for the reason that helper
		// gives: `HOME` is redirected to a scratch tree here, that tree has no login
		// keychain, and Chromium asks macOS to CREATE one - the `Keychain Not Found`
		// dialog on the operator's screen, once per launch, from a rig he did not start.
		// `--password-store=basic` is the Linux half of the same switch, named here so the
		// rig's argv is honest wherever it runs.
		withMockKeychain([
			".",
				`--user-data-dir=${USER_DATA}`,
				`--remote-debugging-port=${devtoolsPort}`,
				`--window-size=${WINDOW_SIZE.width}x${WINDOW_SIZE.height}`,
			"--password-store=basic",
		]),
		{ env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
	);
	const stream = [];
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const logPath = join(SCRATCH, `app-${Date.now()}.log`);
	const flush = () => writeFileSync(logPath, stream.join(""));
	const timer = setInterval(flush, 500);
	child.on("exit", () => {
		clearInterval(timer);
		flush();
	});
	return {
		child,
		stream,
		flush,
		logPath,
		stop: () =>
			new Promise((resolve) => {
				child.once("exit", resolve);
				child.kill("SIGTERM");
				setTimeout(() => {
					try {
						child.kill("SIGKILL");
					} catch {
						/* already gone */
					}
					resolve();
				}, 8000);
			}),
	};
}

function stateFilePath() {
	return join(CONFIG_DIR, "run", "ui-browser", "host.json");
}

/** A host that is actually ALIVE: the record's pid must match the pid `/health`
 * answers with, because a superseded file names an exited process's port (design
 * 10.2, and the failure `browser-chrome-proof.mjs` records in full). */
async function hostIsLive(file) {
	if (!file?.port) return false;
	try {
		const response = await fetch(`http://127.0.0.1:${file.port}/health`, {
			signal: AbortSignal.timeout(1000),
		});
		if (!response.ok) return false;
		const body = await response.json();
		return (
			body?.host === "ui" &&
			(!file.pid || Number(body.pid) === Number(file.pid))
		);
	} catch {
		return false;
	}
}

async function waitForState(timeoutMs = 60_000) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (existsSync(stateFilePath())) {
			try {
				const parsed = JSON.parse(readFileSync(stateFilePath(), "utf8"));
				if (await hostIsLive(parsed)) return parsed;
			} catch {
				// staged write, or a file mid-rename: "not yet"
			}
		}
		await sleep(250);
	}
	throw new Error(`no LIVE host answered /health at ${stateFilePath()}`);
}

async function rpc(state, method, params = {}) {
	const response = await fetch(`http://127.0.0.1:${state.port}/rpc`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Bridge-Key": state.session_key,
		},
		body: JSON.stringify({
			id: `proof-${method}-${Math.random()}`,
			method,
			params,
		}),
	});
	const text = await response.text();
	let json = null;
	try {
		json = JSON.parse(text);
	} catch {
		/* the status is the fact */
	}
	return { status: response.status, text, json };
}

// ---- the renderer, over CDP -------------------------------------------------

let socket = null;
let nextId = 1;
const pendingCalls = new Map();

async function connectRenderer(timeoutMs = 60_000) {
	const started = Date.now();
	for (;;) {
		const list = await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)
			.then((response) => response.json())
			.catch(() => []);
		// The app's OWN renderer, by scheme: a driven browser tab is a `page` target
		// too, and attaching to one evaluates `window.api` inside a sandboxed page that
		// has none (the trap `browser-chrome-proof.mjs` records).
		const renderer = list.find(
			(target) =>
				target.type === "page" &&
				typeof target.url === "string" &&
				target.url.startsWith("file://") &&
				target.url.includes("index.html"),
		);
		if (renderer?.webSocketDebuggerUrl) {
			socket = new WebSocket(renderer.webSocketDebuggerUrl);
			await new Promise((resolve, reject) => {
				socket.addEventListener("open", resolve, { once: true });
				socket.addEventListener("error", reject, { once: true });
			});
			socket.addEventListener("message", (event) => {
				const message = JSON.parse(event.data);
				if (message.id !== undefined && pendingCalls.has(message.id)) {
					const { resolve, reject } = pendingCalls.get(message.id);
					pendingCalls.delete(message.id);
					if (message.error) reject(new Error(message.error.message));
					else resolve(message.result);
				}
			});
			return renderer.url;
		}
		if (Date.now() - started > timeoutMs) {
			throw new Error(
				"the app's renderer never appeared on the debugging port",
			);
		}
		await sleep(250);
	}
}

function send(method, params = {}) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pendingCalls.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
}

async function evaluate(expression) {
	const result = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			result.exceptionDetails.exception?.description ??
				result.exceptionDetails.text ??
				"the expression threw",
		);
	}
	return result.result?.value;
}

async function chromeState() {
	return JSON.parse(
		await evaluate("window.api.browser.state().then((s) => JSON.stringify(s))"),
	);
}

async function contentRect() {
	return await evaluate(`(() => {
		const el = document.querySelector('[data-tour-tag="browser-content"]');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
	})()`);
}

/** The transfer row, as the DOM actually holds it (#16.4's surface). */
async function rowReading() {
	return await evaluate(`(() => {
		const row = document.querySelector('[data-tour-tag="browser-file-transfer-row"]');
		if (!row) return { present: false };
		const r = row.getBoundingClientRect();
		return {
			present: true,
			text: row.innerText.replace(/\\s+/g, ' ').trim(),
			actions: [...row.querySelectorAll('button')].map((b) => b.innerText.trim()),
			names: [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
			rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
		};
	})()`);
}

/** The row's own spans, with the numbers that decide whether the CONSEQUENCE
 * survived the layout (review round 1, D3): a `truncate` span clips its own
 * content (`scrollWidth > clientWidth`), and a `shrink-0` span must not be pushed
 * past the paragraph's content box. Measuring this rather than reading the copy is
 * the difference between "the sentence was composed" and "the sentence is on
 * screen", and only the second is the claim the row makes. */
async function rowSpanReadings() {
	return await evaluate(`(() => {
		const row = document.querySelector('[data-tour-tag="browser-file-transfer-row"]');
		if (!row) return null;
		const p = row.querySelector('p');
		if (!p) return null;
		const box = p.getBoundingClientRect();
		return [...p.querySelectorAll('span')].map((s) => {
			const r = s.getBoundingClientRect();
			return {
				text: s.innerText.trim(),
				clipped: s.scrollWidth > s.clientWidth + 1,
				inside: r.right <= box.right + 1 && r.left >= box.left - 1,
				width: Math.round(r.width),
			};
		});
	})()`);
}

async function grabRenderer(name) {
	const shot = await send("Page.captureScreenshot", { format: "png" });
	const path = join(OUT_DIR, `${name}-chrome.png`);
	writeFileSync(path, Buffer.from(shot.data, "base64"));
	return path;
}

/** The driven page, as the HOST captures it: the same call the agent's `screenshot`
 * tool makes, so the pixels are the ones the feature ships. */
async function capturePage(state, token, name) {
	const shot = await rpc(state, "screenshot", { tab: token });
	const data = shot.json?.result?.data;
	if (typeof data !== "string") return null;
	const path = join(OUT_DIR, `${name}-page.png`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return path;
}

/** Composite the two layers at the rectangle the renderer reports. The scale is
 * DERIVED from the frame (device px per CSS px) rather than assumed: this display
 * is 2x, and compositing at CSS numbers paints the page into the top-left quarter
 * of where it belongs — a frame that reads as a layout bug in the app and is a bug
 * in the rig. */
async function compose(name, chromePath, pagePath, rect) {
	const path = join(OUT_DIR, `${name}.png`);
	if (!pagePath || !rect) {
		if (chromePath !== path) writeFileSync(path, readFileSync(chromePath));
		return path;
	}
	const meta = await sharp(chromePath).metadata();
	const viewport = await evaluate("window.innerWidth");
	const scale = (meta.width ?? WINDOW_SIZE.width) / viewport;
	const page = await sharp(pagePath)
		.resize(Math.round(rect.width * scale), Math.round(rect.height * scale), {
			fit: "fill",
		})
		.toBuffer();
	await sharp(chromePath)
		.composite([
			{
				input: page,
				left: Math.round(rect.x * scale),
				top: Math.round(rect.y * scale),
			},
		])
		.png()
		.toFile(path);
	return path;
}

async function frame(state, token, name) {
	const rect = await contentRect();
	const chromePath = await grabRenderer(name);
	const pagePath = token ? await capturePage(state, token, name) : null;
	const path = await compose(name, chromePath, pagePath, rect);
	record(`frame ${name}`, `${path} at ${JSON.stringify(rect)}`);
	say(`frame: ${path}`);
	return { path, rect };
}
/** Press a control the way a user does: a real CDP click at its centre. */
async function clickTag(tag) {
	return await evaluate(`(() => {
		const el = document.querySelector('[data-tour-tag="${tag}"]');
		if (!el) return 'missing';
		el.click();
		return 'clicked';
	})()`);
}

// ---- the run ----------------------------------------------------------------

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	mkdirSync(HOME_DIR, { recursive: true });
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(LOG_DIR, { recursive: true });

	const { server } = await startSite();
	say(`site: ${origin()}`);
	app = await launchApp();
	const state = await waitForState();
	await connectRenderer();
	say(`host: port ${state.port} pid ${state.pid}`);

	// THE /browser ROUTE, and this is the whole reason the rig does not need a backend:
	// the browser surface is a route of its own (`app.tsx`'s `/browser`), where the
	// chat pane's trigger would need a session catalogue from a live backend to exist
	// at all (`renderer-driver.mjs`'s `browser-pane` scene documents that gate). The
	// route renders the same surface, so the band, the strip and the download row are
	// the ones the user gets — with an isolated, backend-less boot that cannot touch
	// the operator's own app.
	await evaluate("window.location.hash = '#/browser'");
	const surface = await waitFor(() =>
		evaluate(
			"Boolean(document.querySelector('[data-tour-tag=\"browser-content\"]'))",
		),
	);
	check(
		"A0 the /browser route renders its surface",
		surface === true,
		String(surface),
	);

	// ---- A. capability advertisement (§6.3) --------------------------------
	const health = await fetch(`http://127.0.0.1:${state.port}/health`).then(
		(r) => r.json(),
	);
	check(
		"A1 /health advertises the two new methods",
		Array.isArray(health.capabilities) &&
			health.capabilities.includes("download") &&
			health.capabilities.includes("upload"),
		JSON.stringify(health.capabilities),
	);
	check(
		"A2 the discovery record carries the same list, so a harness can degrade without a socket",
		Array.isArray(state.capabilities) &&
			state.capabilities.includes("download") &&
			state.capabilities.includes("upload"),
		JSON.stringify(state.capabilities),
	);
	check(
		"A3 PROTO_VERSION is unchanged at 1",
		health.proto === 1 && state.proto === 1,
		`proto ${health.proto}`,
	);

	// ---- B. the motivating case: seven receipts from one page --------------
	await rpc(state, "request_access", {
		url: `${origin()}/receipts`,
		requester: "session:proof",
	});
	// WAIT ON THE BAND, not on a sleep: the prompt reaches the chrome through an IPC
	// push, and a click that beat the render is the flake this waits out.
	const consentReady = await waitFor(() =>
		evaluate(
			"Boolean(document.querySelector('[data-tour-tag=\"browser-consent-site\"]'))",
		),
	);
	const clicked = consentReady
		? await clickTag("browser-consent-site")
		: "missing";
	check(
		"B1 the origin consent is answered by a real click on the band",
		clicked === "clicked",
		`${clicked} (the prompt ${consentReady ? "rendered" : "never rendered"})`,
	);
	await waitFor(async () => (await chromeState()).pendingConsent.length === 0);
	const opened = await rpc(state, "open", {
		url: `${origin()}/receipts`,
		requester: "session:proof",
	});
	const token = opened.json?.result?.tab;
	check(
		"B2 an agent tab opens on the approved origin",
		typeof token === "string",
		JSON.stringify(opened.json?.result ?? opened.json?.error),
	);
	await waitFor(() =>
		evaluate(
			"Boolean(document.querySelector('[data-tour-tag=\"browser-content\"]'))",
		),
	);
	const beforeRect = await contentRect();
	const beforeRow = await rowReading();
	const before = await frame(state, token, "01-receipts-before");
	check(
		"B3 no download row before anything is downloaded, and the page area is the full height",
		beforeRow.present === false && beforeRect !== null && beforeRect.y > 0,
		JSON.stringify({ row: beforeRow, rect: beforeRect }),
	);

	const arm = await rpc(state, "download", {
		tab: token,
		selector: "#download-all",
		dir: QUARANTINE,
		timeout_s: 30,
		requester: "session:proof",
	});
	const result = arm.json?.result ?? {};
	const landed = existsSync(QUARANTINE) ? readdirSync(QUARANTINE).sort() : [];
	check(
		"B4 the host reports armed, with a file fact per receipt",
		arm.json?.ok === true &&
			result.armed === true &&
			Array.isArray(result.files) &&
			result.files.length === RECEIPTS,
		`armed=${result.armed} files=${result.files?.length} reason=${JSON.stringify(result.reason)} error=${JSON.stringify(arm.json?.error)}`,
	);
	check(
		"B5 seven files are on disk in the harness-composed directory",
		landed.length === RECEIPTS,
		landed.join(", "),
	);
	const bytesOf = (path) =>
		existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null;
	const digests =
		result.files?.map((fact) => ({
			name: fact.name,
			sha: createHash("sha256")
				.update(bytesOf(fact.path) ?? "")
				.digest("hex"),
			declared: fact.sha256,
			bytes: existsSync(fact.path) ? statSync(fact.path).size : -1,
			mode: existsSync(fact.path) ? statSync(fact.path).mode & 0o777 : -1,
			inDir: fact.path.startsWith(QUARANTINE),
		})) ?? [];
	check(
		"B6 every reported path is inside the quarantine dir, and its bytes are the server's",
		digests.length === RECEIPTS &&
			// MATCHED BY NAME, not by position: `files` is in COMPLETION order (seven
			// concurrent downloads finish in whatever order the server and the disk
			// decide), so pairing entry `i` with receipt `i+1` would compare the wrong
			// documents and read as a defect in the host.
			digests.every((entry) => {
				const index = Number(/receipt-(\d+)\.pdf/.exec(entry.name)?.[1] ?? 0);
				return (
					entry.inDir &&
					index >= 1 &&
					entry.sha ===
						createHash("sha256").update(PDF_BYTES(index)).digest("hex")
				);
			}),
		JSON.stringify(
			digests.map((entry) => [
				entry.name,
				entry.bytes,
				entry.mode,
				entry.inDir,
			]),
		),
	);
	check(
		"B7 the host reports NO sha256 — the digest is Python's to compute (§6.1)",
		digests.length === RECEIPTS &&
			digests.every((entry) => entry.declared === ""),
		JSON.stringify(digests.map((entry) => entry.declared)),
	);
	check(
		"B8 files are 0600 and the directory is 0700",
		existsSync(QUARANTINE) &&
			(statSync(QUARANTINE).mode & 0o777) === 0o700 &&
			digests.every((entry) => entry.mode === 0o600),
		`dir ${existsSync(QUARANTINE) ? (statSync(QUARANTINE).mode & 0o777).toString(8) : "absent"} files ${digests.map((d) => d.mode.toString(8)).join(",")}`,
	);
	const downloadsRoot = join(CONFIG_DIR, "browser", "downloads");
	check(
		"B9 nothing landed outside the quarantine dir",
		existsSync(downloadsRoot) && readdirSync(downloadsRoot).length === 1,
		existsSync(downloadsRoot)
			? readdirSync(downloadsRoot).join(", ")
			: "absent",
	);

	await sleep(800);
	const afterRow = await rowReading();
	const after = await frame(state, token, "02-receipts-after");
	check(
		"B10 the download row is on screen, naming the file the host just wrote",
		afterRow.present === true && /receipt-\d+\.pdf/.test(afterRow.text),
		JSON.stringify(afterRow),
	);
	check(
		"B11 the row's control is the user's own reveal, not an agent action",
		Array.isArray(afterRow.actions) && afterRow.actions.includes("Open folder"),
		JSON.stringify(afterRow.actions),
	);
	check(
		"B12 the row took its height from the page area, which reflowed rather than overlapped",
		before.rect !== null &&
			after.rect !== null &&
			after.rect.y - before.rect.y >= (afterRow.rect?.height ?? 0) - 1,
		`page area y ${before.rect?.y} -> ${after.rect?.y}, row height ${afterRow.rect?.height}`,
	);

	// ---- C. the refusals (§7.4, §10.2, §10.3) ------------------------------
	const exeArm = await rpc(state, "download", {
		tab: token,
		selector: "#exe-link",
		dir: join(QUARANTINE, "refusals"),
		timeout_s: 10,
		requester: "session:proof",
	});
	const exeResult = exeArm.json?.result ?? {};
	check(
		"C1 an executable NAME is refused before it lands, and the reason says why",
		exeResult.files?.length === 0 &&
			/executable\/script type/.test(exeResult.reason ?? ""),
		JSON.stringify(exeResult.reason),
	);
	check(
		"C2 nothing was written for the refused download",
		!existsSync(join(QUARANTINE, "refusals", EXE_NAME)),
		existsSync(join(QUARANTINE, "refusals"))
			? readdirSync(join(QUARANTINE, "refusals")).join(", ") || "(empty)"
			: "the refused directory was never created",
	);
	const refusedRow = await rowReading();
	await frame(state, token, "03-refused-exe");
	check(
		"C3 the row shows the refusal to the user, without repeating the name",
		refusedRow.present === true &&
			/executable\/script type/.test(refusedRow.text) &&
			(refusedRow.text.match(/setup\.exe/g) ?? []).length === 1,
		JSON.stringify(refusedRow.text),
	);

	const hugeArm = await rpc(state, "download", {
		tab: token,
		selector: "#huge-link",
		dir: join(QUARANTINE, "refusals"),
		timeout_s: 10,
		requester: "session:proof",
	});
	const hugeResult = hugeArm.json?.result ?? {};
	check(
		"C4 an over-cap download is refused pre-write, and the sentence names the RULE and the file's own size rather than two raw byte counts",
		hugeResult.files?.length === 0 &&
			/over the \d+ MiB per-file download limit/.test(hugeResult.reason ?? "") &&
			/it is \d+ bytes/.test(hugeResult.reason ?? "") &&
			!new RegExp(`over the ${CAPS_BYTES} byte`).test(hugeResult.reason ?? ""),
		JSON.stringify(hugeResult.reason),
	);
	check(
		"C5 the over-cap file is not on disk at all",
		!existsSync(join(QUARANTINE, "refusals", "huge.pdf")),
		existsSync(join(QUARANTINE, "refusals"))
			? readdirSync(join(QUARANTINE, "refusals")).join(", ") || "(empty)"
			: "the refused directory was never created",
	);

	// The CONTROL that starts nothing: a button with no handler. An anchor would
	// NAVIGATE, and the action's result is then correctly discarded as describing a
	// document the agent no longer has (`origin_not_allowed`, "the page navigated while
	// this action was running") — a real answer, but a different case from this one.
	const plainArm = await rpc(state, "download", {
		tab: token,
		selector: "#nothing",
		dir: join(QUARANTINE, "refusals"),
		timeout_s: 5,
		requester: "session:proof",
	});
	const plainResult = plainArm.json?.result ?? {};
	check(
		"C6 a page that starts no download answers with the no-download copy, not a timeout",
		plainArm.json?.ok === true &&
			plainResult.files?.length === 0 &&
			/no download started within/.test(plainResult.reason ?? ""),
		`${JSON.stringify(plainArm.json?.result ?? plainArm.json?.error)}`,
	);

	// ---- C2. the page starts its own download, with NO selector (§11.3) ------
	// The design's core case, and the reason `selector` is optional: a real page's
	// download need not be behind a control the agent can name. The arm is
	// registered on the SESSION for this tab, so a download the page starts is
	// captured without any click from us at all.
	await rpc(state, "goto", {
		tab: token,
		url: `${origin()}/auto`,
		requester: "session:proof",
	});
	const autoArm = await rpc(state, "download", {
		tab: token,
		dir: join(QUARANTINE, "auto"),
		timeout_s: 10,
		requester: "session:proof",
	});
	const autoResult = autoArm.json?.result ?? {};
	const autoLanded = existsSync(join(QUARANTINE, "auto"))
		? readdirSync(join(QUARANTINE, "auto"))
		: [];
	check(
		"C7 a page that starts its own download is captured with no selector at all",
		autoArm.json?.ok === true &&
			autoResult.files?.length === 1 &&
			autoLanded.length === 1,
		`files=${JSON.stringify(autoResult.files?.map((file) => file.name))} on-disk=${autoLanded.join(", ")} reason=${JSON.stringify(autoResult.reason)}`,
	);
	check(
		"C8 the captured file is the receipt the page asked for, by its bytes",
		autoResult.files?.length === 1 &&
			createHash("sha256")
				.update(readFileSync(autoResult.files[0].path))
				.digest("hex") ===
				createHash("sha256").update(PDF_BYTES(8)).digest("hex"),
		JSON.stringify(autoResult.files?.map((file) => [file.name, file.bytes])),
	);

	// ---- D. upload: bytes that actually arrive (§9.3, §12.1 E3) ------------
	await rpc(state, "request_access", {
		url: `${origin()}/form`,
		requester: "session:proof",
	});
	const formConsent = await waitFor(() =>
		evaluate(
			"Boolean(document.querySelector('[data-tour-tag=\"browser-consent-site\"]'))",
		),
	);
	if (formConsent) await clickTag("browser-consent-site");
	await waitFor(async () => (await chromeState()).pendingConsent.length === 0);
	await rpc(state, "goto", {
		tab: token,
		url: `${origin()}/form`,
		requester: "session:proof",
	});
	await waitFor(async () => (await chromeState()).url === `${origin()}/form`);
	const files = ["brief.pdf", "deck.pptx", "archive.zip"].map((name, index) => {
		const path = join(SCRATCH, name);
		writeFileSync(path, Buffer.alloc(1024 * (index + 1), 65 + index));
		return path;
	});
	const uploadCall = await rpc(state, "upload", {
		tab: token,
		selector: "#files",
		paths: files,
		requester: "session:proof",
	});
	const accepted = uploadCall.json?.result?.accepted ?? [];
	check(
		"D1 the host attaches every file and reports what the DOM holds",
		uploadCall.json?.ok === true && accepted.length === files.length,
		`inputs=${JSON.stringify(uploadCall.json?.result?.inputs)} accepted=${JSON.stringify(accepted.map((f) => [f.name, f.bytes]))} error=${JSON.stringify(uploadCall.json?.error)}`,
	);
	check(
		"D2 the read-back matches the files on disk by name and size",
		accepted.length === files.length &&
			accepted.every(
				(fact, index) => statSync(files[index]).size === fact.bytes,
			),
		JSON.stringify(accepted.map((fact) => [fact.name, fact.bytes])),
	);
	// THE ATTACHED STATE, photographed before the form is sent: the input's own
	// filename list is the visible half of the attach, and what the DOM holds is
	// asserted by the read-back above. Captured BEFORE the submit rather than after
	// because the page changes under it (`/echo` renders the browser's JSON viewer),
	// which made one run's frame a race between the two documents.
	const uploadFrame = await frame(state, token, "04-upload-form");
	check(
		"D4 the frame was written for the attached form",
		existsSync(uploadFrame.path),
		uploadFrame.path,
	);

	// Press Send THROUGH THE HOST, which is the only way to reach the driven page: it
	// is a native view the app's renderer cannot see (design §11.3), so an
	// `evaluate` here would look for `#send` in the app's own document and find
	// nothing. The host's `click` is the same action the agent's tool uses.
	const send = await rpc(state, "click", {
		tab: token,
		selector: "#send",
		requester: "session:proof",
	});
	check(
		"D5 the form's own Send control was pressed through the host",
		send.json?.ok === true,
		JSON.stringify(send.json?.result ?? send.json?.error),
	);
	await waitFor(async () => (await chromeState()).url.endsWith("/echo"));
	for (
		let attempt = 0;
		attempt < 40 && uploads.length < files.length;
		attempt += 1
	) {
		await sleep(250);
	}
	const expected = files.map((path) => ({
		name: path.split("/").pop(),
		sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
	}));
	check(
		"D6 the server received the files and its digests equal the local ones",
		uploads.length === files.length &&
			uploads.every((got, index) => got.sha256 === expected[index].sha256),
		JSON.stringify(uploads),
	);
	const receivedFrame = await frame(state, token, "05-upload-received");
	check(
		"D7 the frame was written for the page the server answered on",
		existsSync(receivedFrame.path),
		receivedFrame.path,
	);

	// D8. THE UPLOAD'S OWN LINE (U3). The round-1 walk found three files leaving the
	// machine with `notes: []`, no row and no toast — and the published frames showing
	// the strip narrate an unrelated DOWNLOAD refusal while they left. The row is read
	// here rather than the state file, because the claim is about what the user sees.
	const uploadRow = await rowReading();
	check(
		"D8 an upload leaves a line in the strip, naming how many files and where they went",
		uploadRow.present === true &&
			/were attached to/.test(uploadRow.text ?? "") &&
			(uploadRow.text ?? "").includes("127.0.0.1"),
		JSON.stringify({ row: uploadRow.text }),
	);

	// ---- E. the window never took the operator's focus ---------------------
	const focus = await evaluate(
		"({ hasFocus: document.hasFocus(), visibility: document.visibilityState })",
	);
	check(
		"E1 the run never held the operator's focus",
		focus.hasFocus === false,
		JSON.stringify(focus),
	);

	// ---- F. the policy refusals that belong to the HARNESS ------------------
	// The host does not decide whether a local file may leave (design §9.2: only the
	// harness can, on the RESOLVED path). This exercises Python's own check from the
	// harness tree so the refusal is shown rather than asserted in prose; it is
	// labelled as the harness's rule because that is whose rule it is.
	const harnessPython = join(
		process.env.HOME ?? "",
		"local-operator-worktrees/browser-file-transfer/.venv/bin/python",
	);
	if (!existsSync(harnessPython)) {
		blocked(
			"F1 a credential file is refused before it can be attached",
			`the harness venv is not at ${harnessPython}, so the policy authority could not be run from here`,
		);
	} else {
		const { execFileSync } = await import("node:child_process");
		const secretDir = join(HOME_DIR, ".ssh");
		mkdirSync(secretDir, { recursive: true });
		const key = join(secretDir, "id_rsa");
		writeFileSync(key, "-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic\n");
		const insideConfig = join(CONFIG_DIR, "config.yml");
		writeFileSync(insideConfig, "not a real secret\n");
		// An ordinary document, in the same scratch home, as the CONTROL: a policy
		// check that refused everything would pass the two assertions above and be
		// useless.
		const ordinary = join(HOME_DIR, "brief.pdf");
		writeFileSync(ordinary, "%PDF-1.4\n");
		const script = `
import json, sys
from pathlib import Path
from local_operator import browser_files as bf
paths = [${JSON.stringify(key)}, ${JSON.stringify(insideConfig)}, ${JSON.stringify(ordinary)}]
for raw in paths:
    resolved, reason = bf.check_upload(raw, cwd=${JSON.stringify(HOME_DIR)})
    print(json.dumps({"path": raw, "allowed": resolved is not None, "reason": reason}))
`;
		const output = execFileSync(harnessPython, ["-c", script], {
			cwd: join(
				process.env.HOME ?? "",
				"local-operator-worktrees/browser-file-transfer",
			),
			env: { ...process.env, LOCAL_OPERATOR_CONFIG_DIR: CONFIG_DIR },
			encoding: "utf8",
		});
		const rows = output
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		check(
			"F1 a credential file and a file under the config dir are both refused by the harness's own rule",
			rows[0]?.allowed === false &&
				rows[1]?.allowed === false &&
				rows[2]?.allowed === true,
			JSON.stringify(rows),
		);
		check(
			"F2 every refusal names its own rule rather than a generic error",
			rows[0]?.reason.length > 0 &&
				rows[1]?.reason.length > 0 &&
				rows[0].reason !== rows[1].reason,
			`${rows[0]?.reason} | ${rows[1]?.reason}`,
		);
	}

	// ---- G. the four round-1 streams, as facts about the running app -------
	// Each case below is a finding from round 1 and each is answered by a READING of
	// the running app — the row out of the DOM, the bytes off the disk, the host's own
	// projection over RPC — rather than by a sentence about the source. The isolated
	// quarantine directory is the harness-composed one, so these runs write where a
	// real call writes and nowhere near the operator's own downloads.

	// The tab is put back on the page that offers these fixtures FIRST: the upload case
	// above pressed the form's own Send, so the tab is on `/echo` and no selector below
	// would resolve. Navigation is part of the setup, not part of what is being proved.
	const back = await rpc(state, "goto", {
		tab: token,
		url: `${origin()}/receipts`,
		requester: "session:proof",
	});
	check(
		"G0 the tab is back on the fixture page before the round-1 cases run",
		back.json?.ok === true && /\/receipts/.test(back.json?.result?.url ?? ""),
		JSON.stringify(back.json?.result?.url ?? back.json?.error),
	);

	// G1. A WRITE THAT DIES MID-FLIGHT (U1). Declares 200 KB, sends 100 KB, then the
	// socket goes away, which is `interrupted` rather than a short file.
	const stallArm = await rpc(state, "download", {
		tab: token,
		selector: "#stall-link",
		dir: QUARANTINE,
		timeout_s: 20,
		requester: "session:proof",
	});
	await sleep(700);
	const stallRow = await rowReading();
	const stallFiles = existsSync(QUARANTINE) ? readdirSync(QUARANTINE) : [];
	check(
		"G1 a transfer that dies mid-flight leaves a row saying so, and no partial file under a complete-looking name",
		stallArm.json?.ok === true &&
			stallRow.present === true &&
			/Download refused/.test(stallRow.text ?? "") &&
			/partial file was discarded/.test(stallRow.text ?? "") &&
			!stallFiles.includes("quarterly-accounts.pdf"),
		JSON.stringify({
			row: stallRow.text,
			files: stallFiles,
			reason: stallArm.json?.result?.reason,
		}),
	);

	// G2/G3. A WRITE STILL IN FLIGHT (U6, D6): the row must say something other than
	// "still going", and the frame below is the in-progress state §12.3 asks for and
	// no earlier version of these frames showed.
	const slowArm = rpc(state, "download", {
		tab: token,
		selector: "#slow-a-link",
		dir: QUARANTINE,
		timeout_s: 30,
		requester: "session:proof",
	});
	await sleep(900);
	const progressRow = await rowReading();
	// THE CHROME HALF IS TAKEN IN FLIGHT AND THE PAGE HALF AFTER, and that is a property
	// of the host rather than a shortcut: `screenshot` is tab-scoped, so it takes the
	// tab's command lane — the SAME lane this `download` call is holding until it
	// answers, which is why asking for the page now would come back empty (the first
	// version of this case did exactly that and shipped a blank page area). The page
	// does not change while the transfer runs, so the composite is the same document;
	// the row's own pixels are the mid-flight ones.
	const inFlightRect = await contentRect();
	const inFlightChrome = await grabRenderer("06-downloading");
	const slowResult = await slowArm;
	await sleep(500);
	await compose(
		"06-downloading",
		inFlightChrome,
		await capturePage(state, token, "06-downloading"),
		inFlightRect,
	);
	const progressFrame = { path: join(OUT_DIR, "06-downloading.png") };
	check(
		"G2 a transfer in flight reports its progress rather than one static line",
		progressRow.present === true &&
			/Downloading/.test(progressRow.text ?? "") &&
			/(KiB|MiB|%)/.test(progressRow.text ?? ""),
		JSON.stringify({ row: progressRow.text, frame: progressFrame.path }),
	);
	check(
		"G3 the same transfer lands when it is given the time, so the cancel paths are not refusing ordinary downloads",
		slowResult.json?.ok === true &&
			(existsSync(QUARANTINE) ? readdirSync(QUARANTINE) : []).includes("slow-a.pdf"),
		JSON.stringify({
			files: existsSync(QUARANTINE) ? readdirSync(QUARANTINE) : [],
			reason: slowResult.json?.result?.reason,
		}),
	);

	// G4. THE DEADLINE, WITH BYTES ON DISK (B1/M1): the one case the harness cannot
	// describe honestly — Python takes its snapshot immediately after this answer, so
	// a write still going is either measured as a prefix or lands with nothing left to
	// classify it.
	const deadlineArm = await rpc(state, "download", {
		tab: token,
		selector: "#slow-b-link",
		dir: QUARANTINE,
		timeout_s: 2,
		requester: "session:proof",
	});
	await sleep(700);
	const deadlineRow = await rowReading();
	check(
		"G4 a transfer still writing at the deadline is cancelled, reported by name, and its partial discarded",
		/budget expired/i.test(deadlineArm.json?.result?.reason ?? "") &&
			// The row composes its own sentence from the rule (D1/D3), so it says what
			// happened rather than repeating the tool result's wording.
			/did not finish within \d+s and was cancelled/i.test(
				deadlineRow.text ?? "",
			) &&
			!(
				existsSync(QUARANTINE) ? readdirSync(QUARANTINE) : []
			).includes("slow-b.pdf"),
		JSON.stringify({
			row: deadlineRow.text,
			reason: deadlineArm.json?.result?.reason,
			files: existsSync(QUARANTINE) ? readdirSync(QUARANTINE) : [],
		}),
	);

	// G5. TWO SAME-NAMED TRANSFERS IN ONE CALL (Q1): the silent overwrite §11.4
	// forbids, with the result reporting two facts at one path.
	const dupDir = join(QUARANTINE, "dup");
	const dupArm = await rpc(state, "download", {
		tab: token,
		selector: "#dup-link",
		dir: dupDir,
		timeout_s: 20,
		requester: "session:proof",
	});
	await sleep(700);
	const dupFiles = (existsSync(dupDir) ? readdirSync(dupDir) : []).sort();
	const dupFacts = dupArm.json?.result?.files ?? [];
	check(
		"G5 two transfers of one name in ONE call land as two files, and the result names two paths",
		dupFiles.length === 2 &&
			new Set(dupFacts.map((fact) => fact.path)).size === dupFacts.length,
		JSON.stringify({ files: dupFiles, paths: dupFacts.map((f) => f.path) }),
	);

	// G6. WHERE THE FILE WENT (D4/U2), read off the row rather than off the state
	// file: the path is on screen and the controls are self-describing (D7).
	const savedRow = await rowReading();
	check(
		"G6 the row names the folder it wrote into, and its controls say what they do",
		(savedRow.text ?? "").includes(QUARANTINE) &&
			(savedRow.names ?? []).includes("Open downloads folder") &&
			(savedRow.names ?? []).includes("Dismiss download notice"),
		JSON.stringify({ row: savedRow.text, names: savedRow.names }),
	);

	// G7. THE DURABLE ROUTE (U2): the chrome keeps a control that opens the same
	// directory, so dismissing the row does not take the user's download away.
	const folderControl = await evaluate(
		'Boolean(document.querySelector(`[data-tour-tag="browser-downloads-folder"]`))',
	);
	check(
		"G7 the chrome carries a durable route to the download folder",
		folderControl === true,
		String(folderControl),
	);

	// G8. A LONG NAME'S REFUSAL (D3), and this is a LAYOUT measurement rather than a
	// copy one: the name span is the one that clips, and the consequence is not
	// clipped and sits inside the paragraph's content box.
	const longArm = await rpc(state, "download", {
		tab: token,
		selector: "#long-exe-link",
		dir: QUARANTINE,
		timeout_s: 10,
		requester: "session:proof",
	});
	await sleep(400);
	const longRow = await rowReading();
	const longSpans = (await rowSpanReadings()) ?? [];
	const longFrame = await frame(state, token, "08-long-name-refused");
	const nameSpan = longSpans.find((span) => span.text.startsWith("quarterly-financial"));
	const consequence = longSpans.find((span) =>
		span.text.startsWith("Nothing was saved"),
	);
	check(
		"G8 a long name's refusal clips the NAME, not the consequence (D3)",
		longArm.json?.result?.reason?.includes("executable/script type") === true &&
			nameSpan?.clipped === true &&
			consequence?.clipped === false &&
			consequence?.inside === true,
		JSON.stringify({ spans: longSpans, frame: longFrame.path }),
	);

	// G9. THE ROW STACKED WITH THE CONSENT BAND (D6): the composition worst case, and
	// the one arrangement the "it reflowed rather than overlapped" claim had not been
	// shown for. The prompt is raised on a DIFFERENT origin — `localhost` is not
	// `127.0.0.1`, so the grant above does not cover it.
	await rpc(state, "request_access", {
		url: `http://localhost:${sitePort}/other`,
		requester: "session:proof",
	});
	const bandReady = await waitFor(() =>
		evaluate(
			'Boolean(document.querySelector(`[data-tour-tag="browser-consent-request"]`))',
		),
	);
	const stackedRow = await rowReading();
	const stackedFrame = await frame(state, token, "07-row-and-band");
	await clickTag("browser-consent-deny");
	check(
		"G9 the row and the consent band stack in the same strip, and the page keeps its own area",
		bandReady === true && stackedRow.present === true,
		JSON.stringify({ row: stackedRow.text, frame: stackedFrame.path }),
	);

	// ---- the transcript ----------------------------------------------------
	writeFileSync(
		join(OUT_DIR, "transcript.json"),
		JSON.stringify({ transcript, failures, blocked: blockedItems }, null, 2),
	);
	say("");
	say(
		`${transcript.length} checks recorded in ${join(OUT_DIR, "transcript.json")}`,
	);
	say(`${failures.length} FAIL, ${blockedItems.length} BLOCKED`);
	for (const line of failures) say(`  FAIL ${line}`);
	say(`app log: ${app.logPath}`);
	say(`frames: ${OUT_DIR}`);
	server.close();
}

try {
	await main();
} catch (error) {
	say(`\nRIG FAILED: ${error?.stack ?? error}`);
	failures.push(`rig: ${error?.message ?? error}`);
} finally {
	if (app) {
		// Reaped by exact pid through the handle, never by pattern: the operator's own
		// app must not be touched, and a leaked Electron here is a window on his screen.
		await app.stop();
	}
	if (!KEEP) rmSync(SCRATCH, { recursive: true, force: true });
	say(
		failures.length === 0
			? "VERDICT: all checks passed"
			: `VERDICT: ${failures.length} check(s) failed`,
	);
	process.exit(failures.length === 0 ? 0 : 1);
}
