#!/usr/bin/env node
/**
 * Real-app QA rig for the page context menu's Undo/Redo items (U8).
 *
 * Boots the BUILT app in headless mode against a scratch profile, opens a real
 * browser tab on a local fixture, and drives a real right-click through CDP into
 * the driven page's WebContentsView. The app's own main process builds the menu
 * exactly as it does for a user; the only replacement is `Menu.popup` (suppressed
 * so no native menu is raised on the operator's desktop) while the template the
 * app built is recorded from the real handler. The template's own click callbacks
 * are then invoked, so `contents.undo()`/`contents.redo()` run against the real
 * page.
 *
 * Explicitly NOT measured: native NSMenu painting and a physical click on a menu
 * row. Those are OS-level and remain for independent QA / a human.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const ROOT = process.env.APP_ROOT ?? REPO_ROOT;
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const { MOCK_KEYCHAIN_SWITCH } = await import(pathToFileURL(join(ROOT, "scripts/chrome-keychain.mjs")).href);
const { withNotificationsOff } = await import(pathToFileURL(join(ROOT, "scripts/notifications-off.mjs")).href);
const { withTelemetryOff } = await import(pathToFileURL(join(ROOT, "scripts/telemetry-off.mjs")).href);
const ELECTRON_BIN = requireFromRepo("electron");
const OUT = process.env.QA_OUT ?? HERE;
const RUN = join(OUT, "run");
mkdirSync(RUN, { recursive: true });
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

class Cdp {
	constructor(socket) {
		this.socket = socket;
		this.nextId = 1;
		this.pending = new Map();
		socket.addEventListener("message", (message) => {
			const payload = JSON.parse(message.data);
			if (payload.id && this.pending.has(payload.id)) {
				const { resolve: done, reject } = this.pending.get(payload.id);
				this.pending.delete(payload.id);
				if (payload.error) reject(new Error(JSON.stringify(payload.error)));
				else done(payload.result);
			}
		});
	}
	send(method, params = {}, timeoutMs = 20_000) {
		const id = this.nextId++;
		return new Promise((done, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP ${method} timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => {
					clearTimeout(timer);
					done(value);
				},
				reject: (error) => {
					clearTimeout(timer);
					reject(error);
				},
			});
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}
}

async function connect(url) {
	const socket = new WebSocket(url);
	await new Promise((done, reject) => {
		socket.addEventListener("open", done, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	return new Cdp(socket);
}

async function targets(port) {
	const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
		signal: AbortSignal.timeout(5_000),
	});
	return response.json();
}

async function waitForTarget(port, predicate, timeoutMs = 30_000) {
	const deadline = Date.now() + timeoutMs;
	let last = [];
	while (Date.now() < deadline) {
		try {
			last = await targets(port);
			const match = last.find(predicate);
			if (match) return match;
		} catch {
			// not listening yet
		}
		await sleep(120);
	}
	throw new Error(
		`no target matched; last ${JSON.stringify(last.map((t) => ({ type: t.type, url: t.url })))}`,
	);
}

async function evaluate(cdp, expression) {
	const result = await cdp.send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (result.exceptionDetails) {
		throw new Error(
			`evaluate failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
		);
	}
	return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 15_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await evaluate(cdp, expression)) return true;
		await sleep(120);
	}
	return false;
}

function freePort() {
	return new Promise((done, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const port = server.address().port;
			server.close(() => done(port));
		});
	});
}

const rows = [];
function record(id, claim, status, evidence) {
	rows.push({ id, claim, status, evidence });
	console.log(`[${status}] ${id} ${claim}\n        ${JSON.stringify(evidence)}`);
}

async function startFixture() {
	const server = createHttpServer((request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(`<!doctype html><html><head><title>menu fixture</title>
<style>body{margin:24px;font:16px/1.5 sans-serif}input{width:320px;padding:8px;font:inherit}</style>
</head><body>
<h1>Page context menu fixture</h1>
<input id="field" aria-label="Editable field" />
<p id="plain">A non-editable paragraph. Right-click here for page navigation.</p>
<div id="editable" contenteditable="true" style="border:1px solid #ccc;padding:8px;width:320px">contenteditable text</div>
</body></html>`);
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	return { server, base: `http://127.0.0.1:${server.address().port}` };
}

async function boot() {
	const home = join(RUN, "home");
	const config = join(RUN, "config");
	const logs = join(RUN, "logs");
	const profile = join(RUN, "profile");
	const cwd = join(RUN, "cwd");
	for (const dir of [home, config, logs, profile, cwd])
		mkdirSync(dir, { recursive: true });
	const deadPort = await freePort();
	writeFileSync(
		join(cwd, ".env"),
		`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:${deadPort}\nVITE_DISABLE_BACKEND_MANAGER=true\n`,
	);
	const port = await freePort();
	const inspectPort = await freePort();
	const env = withNotificationsOff({
		...process.env,
		HOME: home,
		LOCAL_OPERATOR_CONFIG_DIR: config,
		LOCAL_OPERATOR_LOG_DIR: logs,
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		VITE_DISABLE_BACKEND_MANAGER: "true",
	});
	withTelemetryOff(env);
	for (const key of Object.keys(env)) {
		if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
	}
	const child = spawn(
		ELECTRON_BIN,
		[
			ROOT,
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${port}`,
			`--inspect=${inspectPort}`,
			"--window-mode=headless",
			"--window-size=1380x900",
			"--disable-backgrounding-occluded-windows",
			"--disable-renderer-backgrounding",
			"--disable-background-timer-throttling",
			MOCK_KEYCHAIN_SWITCH,
		],
		{ env, cwd, stdio: ["ignore", "pipe", "pipe"], detached: true },
	);
	const logPath = join(OUT, "app.log");
	const stream = [];
	const write = () => {
		if (stream.length === 0) return;
		writeFileSync(logPath, stream.join(""));
	};
	child.stdout.on("data", (chunk) => stream.push(chunk.toString()));
	child.stderr.on("data", (chunk) => stream.push(chunk.toString()));
	const timer = setInterval(write, 250);
	const exited = new Promise((done) => {
		child.once("exit", (code, signal) => {
			clearInterval(timer);
			write();
			done({ code, signal });
		});
	});
	return {
		child,
		port,
		inspectPort,
		exited,
		async stop() {
			if (child.exitCode !== null) return { code: child.exitCode };
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
			const stopped = await Promise.race([
				exited,
				sleep(10_000).then(() => ({ timeout: true })),
			]);
			if (stopped.timeout) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					/* already gone */
				}
			}
			return stopped;
		},
	};
}

const INSTALL_PROBE = `(() => {
	if (globalThis.__pageMenuProbe) return "already";
	const req = typeof require === "function"
		? require
		: process.mainModule.require.bind(process.mainModule);
	const { Menu } = req("electron");
	const original = Menu.buildFromTemplate.bind(Menu);
	let seq = 0;
	let current = null;
	Menu.buildFromTemplate = (template) => {
		const labels = template.map((item) =>
			item.type === "separator" ? "---" : item.label,
		);
		const isPageMenu =
			(labels.includes("Back") && labels.includes("Forward")) ||
			(labels.includes("Undo") && labels.includes("Redo") && labels.includes("Cut"));
		if (!isPageMenu) return original(template);
		seq += 1;
		current = template;
		return { popup() {} };
	};
	globalThis.__pageMenuProbe = {
		seq: () => seq,
		items: () => (current ?? []).map((item, index) => ({
			index,
			type: item.type ?? "normal",
			label: item.label ?? "",
			enabled: item.enabled !== false,
		})),
		click: (index) => {
			const item = current?.[index];
			if (!item || typeof item.click !== "function")
				return { clicked: false, index };
			item.click();
			return { clicked: true, index, label: item.label };
		},
	};
	return "installed";
})()`;

async function main() {
	const fixture = await startFixture();
	const booted = await boot();
	let failures = 0;
	try {
		const mainTarget = await waitForTarget(
			booted.inspectPort,
			(target) => target.webSocketDebuggerUrl,
		);
		const mainCdp = await connect(mainTarget.webSocketDebuggerUrl);
		const installed = await evaluate(mainCdp, INSTALL_PROBE);
		if (installed !== "installed" && installed !== "already")
			throw new Error(`probe not installed: ${installed}`);

		const appTarget = await waitForTarget(
			booted.port,
			(target) =>
				target.type === "page" && /\/index\.html(?:[?#].*)?$/.test(target.url),
		);
		const appCdp = await connect(appTarget.webSocketDebuggerUrl);
		const ready = await waitFor(
			appCdp,
			`!!window.api?.browser && !!document.querySelector('[data-tour-tag="browser-tab-strip"]')`,
			35_000,
		);
		if (!ready) {
			await evaluate(appCdp, `location.hash = "#/browser"`);
		}
		await evaluate(
			appCdp,
			`(async () => {
				const state = await window.api.browser.state();
				let tabId = state.activeTabId;
				if (tabId == null) {
					await window.api.browser.newTab(null);
					const next = await window.api.browser.state();
					tabId = next.activeTabId;
				}
				await window.api.browser.navigate(${JSON.stringify(fixture.base)}, tabId);
				for (let i = 0; i < 120; i += 1) {
					const current = await window.api.browser.state();
					if (current.url.startsWith(${JSON.stringify(fixture.base)}) && !current.loading)
						return current.url;
					await new Promise((done) => setTimeout(done, 100));
				}
				throw new Error("fixture never became the active page");
			})()`,
		);
		const pageTarget = await waitForTarget(
			booted.port,
			(target) => target.type === "page" && target.url.startsWith(fixture.base),
		);
		const pageCdp = await connect(pageTarget.webSocketDebuggerUrl);

		const point = (selector) =>
			evaluate(
				pageCdp,
				`(() => {
					const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
					return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
				})()`,
			);

		const rightClick = async (selector) => {
			const { x, y } = await point(selector);
			await pageCdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x,
				y,
			});
			await pageCdp.send("Input.dispatchMouseEvent", {
				type: "mousePressed",
				x,
				y,
				button: "right",
				buttons: 2,
				clickCount: 1,
			});
			await pageCdp.send("Input.dispatchMouseEvent", {
				type: "mouseReleased",
				x,
				y,
				button: "right",
				buttons: 0,
				clickCount: 1,
			});
			const before = await evaluate(mainCdp, `__pageMenuProbe.seq()`);
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const seq = await evaluate(mainCdp, `__pageMenuProbe.seq()`);
				if (seq > before) break;
				await sleep(100);
			}
			const items = await evaluate(mainCdp, `__pageMenuProbe.items()`);
			return items;
		};

		const byLabel = (items, label) =>
			items.find((item) => item.label === label) ?? null;
		const check = (id, claim, ok, evidence) => {
			if (!ok) failures += 1;
			record(id, claim, ok ? "PASS" : "FAIL", evidence);
		};

		// Q1: an empty field has no undo history: Undo/Redo are present but
		// disabled, and they lead the edit group above Cut.
		await pageCdp.send("Runtime.evaluate", {
			expression: `document.getElementById("field").focus()`,
		});
		const empty = await rightClick("#field");
		const emptyLabels = empty.map((item) => item.label || "---");
		check(
			"Q1",
			"an empty editable field shows Undo/Redo above Cut, disabled with no history",
			emptyLabels.slice(0, 4).join("|") === "Undo|Redo|---|Cut" &&
				byLabel(empty, "Undo")?.enabled === false &&
				byLabel(empty, "Redo")?.enabled === false &&
				byLabel(empty, "Cut")?.enabled === false,
			{ items: empty },
		);

		// Q2: a real insertion creates history; Undo becomes enabled and its own
		// click callback reverses the edit on the real page.
		await pageCdp.send("Input.insertText", { text: "abc" });
		await sleep(200);
		const typed = await evaluate(
			pageCdp,
			`document.getElementById("field").value`,
		);
		const afterTyping = await rightClick("#field");
		const undo = byLabel(afterTyping, "Undo");
		const redo = byLabel(afterTyping, "Redo");
		check(
			"Q2",
			"after a real edit Undo is enabled and Redo is disabled",
			typed === "abc" &&
				undo?.enabled === true &&
				redo?.enabled === false &&
				afterTyping[0]?.label === "Undo",
			{ value: typed, undo, redo },
		);
		const undoClick = await evaluate(
			mainCdp,
			`__pageMenuProbe.click(${undo.index})`,
		);
		await sleep(300);
		const afterUndo = await evaluate(
			pageCdp,
			`document.getElementById("field").value`,
		);
		check(
			"Q3",
			"the menu's Undo action reverses the real edit",
			undoClick.clicked === true && afterUndo === "",
			{ undoClick, value: afterUndo },
		);

		// Q4: after the undo, Redo is enabled and its own action restores the text.
		const afterUndoMenu = await rightClick("#field");
		const redoNow = byLabel(afterUndoMenu, "Redo");
		const redoClick = await evaluate(
			mainCdp,
			`__pageMenuProbe.click(${redoNow.index})`,
		);
		await sleep(300);
		const afterRedo = await evaluate(
			pageCdp,
			`document.getElementById("field").value`,
		);
		check(
			"Q4",
			"the menu's Redo action restores the undone edit",
			redoNow?.enabled === true &&
				redoClick.clicked === true &&
				afterRedo === "abc",
			{ redo: redoNow, redoClick, value: afterRedo },
		);

		// Q5: a non-editable page shows the navigation group and no edit items,
		// even though editFlags may still be present in the event.
		const plain = await rightClick("#plain");
		const plainLabels = plain.map((item) => item.label || "---");
		const editLabels = new Set([
			"Undo",
			"Redo",
			"Cut",
			"Copy",
			"Paste",
			"Select all",
		]);
		check(
			"Q5",
			"a non-editable page shows no edit items",
			plainLabels.join("|") === "Back|Forward|Reload|---|Copy page address" &&
				!plain.some((item) => editLabels.has(item.label)),
			{ items: plain },
		);

		// Q6: a contenteditable element is still an editable target.
		const contentEditable = await rightClick("#editable");
		const editableLabels = contentEditable.map((item) => item.label || "---");
		check(
			"Q6",
			"a contenteditable element also gets Undo/Redo and the edit group",
			editableLabels.slice(0, 4).join("|") === "Undo|Redo|---|Cut" &&
				!editableLabels.includes("Reload"),
			{ items: contentEditable },
		);

		writeFileSync(join(OUT, "facts.json"), JSON.stringify({ rows }, null, 2));
		writeFileSync(
			join(OUT, "matrix.md"),
			`| Row | Claim | Status | Actual |\n| --- | --- | --- | --- |\n${rows
				.map(
					(row) =>
						`| ${row.id} | ${row.claim} | ${row.status} | ${JSON.stringify(row.evidence).replaceAll("|", "\\|")} |`,
				)
				.join("\n")}\n`,
		);
	} finally {
		await booted.stop();
		fixture.server.close();
	}
	if (failures > 0) console.error(`[page-menu-qa] ${failures} row(s) failed`);
	// The inspector and app CDP sockets stay open by design; exit explicitly so a
	// completed run does not sit waiting for the debugger to disconnect.
	process.exit(failures > 0 ? 1 : 0);
}

main().catch((error) => {
	console.error("[page-menu-qa] FAILED", error);
	process.exitCode = 1;
});
