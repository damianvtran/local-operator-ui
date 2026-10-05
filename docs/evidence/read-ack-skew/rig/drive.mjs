#!/usr/bin/env node
/**
 * read-ack-skew rig drive — the dev app instance against the rig's two daemons.
 *
 * Forked from the meshcap rig's `wave2-chip-fix/tools/drive-live.mjs` (itself a
 * fork of `docs/evidence/chat-device-persist/harness/drive.mjs`): the built app,
 * scratch HOME/profile, mock keychain, reaped by exact pid, driven over CDP and
 * photographed with `Page.captureScreenshot`.
 *
 * Usage: node drive.mjs --arm before|after [--phase probe|flow|settle]
 *
 * Phases:
 *   probe  boot, skip onboarding, dump the sidebar rows + the window.api seam
 *          answer + the conversation view, capture `probe-*.webp`.
 *   flow   (later) drive the device move through the app, then the frames.
 *   settle (later) the upgraded-B settle.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const HOME = process.env.HOME;
const RIG = join(HOME, "workspace/read-ack-skew-rig");
const SCRATCH = process.env.LOCAL_OPERATOR_SCRATCHPAD ?? process.cwd();
const OUT = join(RIG, "frames");
const BACKEND = "http://127.0.0.1:41241";
const RECORDS = join(RIG, "homeA/.local-operator/run/serve");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? fallback : argv[at + 1];
};
const ARM = flag("arm", "after");
const PHASE = flag("phase", "probe");
const SESSION = flag("session", "d7c2d1e7b496");
const APPDIR = flag("appdir", "");
const WT =
	ARM === "before"
		? join(HOME, "local-operator-ui-worktrees/read-ack-skew-before")
		: join(HOME, "local-operator-ui-worktrees/read-ack-skew-tolerance");

const TOKEN = readFileSync(join(RIG, ARM === "before" ? "desktop.token" : "desktop.token"), "utf8").trim();
const RUN = join(SCRATCH, "read-ack-skew", ARM, "run");
const FRAMES = join(OUT, ARM);
const CONFIG = join(RUN, "config");
const report = { arm: ARM, phase: PHASE, steps: [], errors: [], probes: {} };
const step = (name, data) => {
	report.steps.push({ name, ...data });
	console.log(`[step] ${name}: ${JSON.stringify(data)}`);
};
const fail = (name, error) => {
	report.errors.push({ name, error: String(error) });
	console.log(`[error] ${name}: ${error}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
	new Promise((res, rej) => {
		const srv = createServer();
		srv.on("error", rej);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => res(port));
		});
	});

async function waitForCdp(port, ms = 90_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		try {
			const list = await (
				await fetch(`http://127.0.0.1:${port}/json/list`)
			).json();
			const page = list.find(
				(t) => t.type === "page" && String(t.url).includes("index.html"),
			);
			if (page && page.webSocketDebuggerUrl) return page;
		} catch {}
		await sleep(400);
	}
	throw new Error(`CDP target never appeared on ${port}`);
}

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.id = 0;
		this.pending = new Map();
		this.console = [];
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.method === "Runtime.consoleAPICalled") {
				const text = (msg.params.args ?? [])
					.map((a) => a.value ?? a.description ?? a.type)
					.join(" ");
				this.console.push({ type: msg.params.type, text: String(text).slice(0, 400) });
			}
			if (msg.id && this.pending.has(msg.id)) {
				const { res, rej } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((res, rej) => {
			this.pending.set(id, { res, rej });
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					rej(new Error(`${method} timed out`));
				}
			}, 120_000);
		});
	}
	async eval(expression) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: true,
		});
		if (r.exceptionDetails)
			throw new Error(
				`page: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`,
			);
		return r.result?.value;
	}
	async waitFor(expression, { timeout = 60_000, label = expression } = {}) {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			try {
				if (await this.eval(`!!(${expression})`)) return true;
			} catch {}
			await sleep(300);
		}
		throw new Error(`waitFor timed out: ${label}`);
	}
}

async function clickAt(cdp, selector, text = null) {
	const box = await cdp.eval(`(() => {
		const want = ${JSON.stringify(text)};
		const all = [...document.querySelectorAll(${JSON.stringify(selector)})];
		const el = want === null ? all[0] : all.find((n) => (n.textContent || "").includes(want));
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || "").trim().slice(0, 160) };
	})()`);
	if (!box)
		throw new Error(
			`no element for ${selector}${text ? ` containing ${text}` : ""}`,
		);
	for (const [type, buttons] of [
		["mouseMoved", 0],
		["mousePressed", 1],
		["mouseReleased", 0],
	]) {
		await cdp.send("Input.dispatchMouseEvent", {
			type,
			x: box.x,
			y: box.y,
			button: type === "mouseMoved" ? "none" : "left",
			buttons,
			clickCount: type === "mouseMoved" ? 0 : 1,
		});
	}
	return box;
}

async function shutter(cdp, state) {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 92,
	});
	mkdirSync(FRAMES, { recursive: true });
	const file = join(FRAMES, `${state}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	const size = statSync(file).size;
	console.log(`[frame] ${state} -> ${file} (${size} bytes)`);
	if (size < 4096) fail(`frame ${state}`, `suspiciously small (${size} bytes)`);
	return file;
}

/* ---- the driving helpers (the ack rig's shapes: scroll, re-read, press) -- */

const centre = (rect) => [rect.x + rect.width / 2, rect.y + rect.height / 2];
const sleep2 = sleep;
async function press(cdp, rect) {
	const [x, y] = centre(rect);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	await sleep(120);
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mousePressed",
		x,
		y,
		button: "left",
		clickCount: 1,
	});
	await cdp.send("Input.dispatchMouseEvent", {
		type: "mouseReleased",
		x,
		y,
		button: "left",
		clickCount: 1,
	});
	await sleep(700);
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 });
	await sleep(150);
}

const rectProbe = `(el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && r.height > 0 }; }`;

async function clickSelector(cdp, sel, label) {
	const found = await cdp.eval(`(() => {
		const el = document.querySelector(${JSON.stringify(sel)});
		if (!el) return null;
		el.scrollIntoView({ block: "center" });
		const rect = (${rectProbe})(el);
		return { rect, text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) };
	})()`);
	if (!found || !found.rect.visible)
		throw new Error(`clickSelector ${label}: ${sel} not found/visible`);
	await press(cdp, found.rect);
	return found.text;
}

async function clickText(cdp, scopeSel, matcher, label, controlSel = "button, [role=button], [role=menuitem], label") {
	const found = await cdp.eval(`(() => {
		const scope = document.querySelector(${JSON.stringify(scopeSel)}) || document;
		const rx = new RegExp(${JSON.stringify(matcher)}, "i");
		const all = [...scope.querySelectorAll(${JSON.stringify(controlSel)})];
		const hit = all.find((b) => {
			const t = (b.textContent || "").replace(/\\s+/g, " ").trim();
			return rx.test(t) && b.getBoundingClientRect().width > 0;
		});
		if (!hit) return { seen: all.map((b) => (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 70)) };
		hit.scrollIntoView({ block: "center" });
		const rect = (${rectProbe})(hit);
		return { rect, text: (hit.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120) };
	})()`);
	if (!found.rect)
		throw new Error(`clickText ${label}: no ${matcher} in ${scopeSel}; saw ${JSON.stringify(found.seen).slice(0, 500)}`);
	await press(cdp, found.rect);
	return found.text;
}

async function goto(cdp, hash) {
	await cdp.eval(`location.hash = ${JSON.stringify(hash)}`);
	for (let i = 0; i < 80; i += 1) {
		await sleep(250);
		const ok = await cdp.eval(
			`Boolean(document.querySelector('[data-session-row][aria-current="page"], [data-chat-row][aria-current="page"]'))`,
		);
		if (ok) return;
	}
	throw new Error(`no row is marked current on ${hash}`);
}

async function pressEnter(cdp) {
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Enter",
			code: "Enter",
			windowsVirtualKeyCode: 13,
			nativeVirtualKeyCode: 13,
		});
	}
	await sleep(400);
}

/* ---- the create: a draft placed on cloud-node-1 through the device chip --- */

async function runCreate(cdp) {
	const hasChip = await cdp.eval(`Boolean(document.querySelector("[data-device-chip]"))`);
	if (!hasChip) {
		step("new-chat", { action: "pressing cmd-N" });
		for (const type of ["keyDown", "keyUp"]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "n",
				code: "KeyN",
				modifiers: 4,
				windowsVirtualKeyCode: 78,
				nativeVirtualKeyCode: 78,
			});
		}
	}
	await cdp.waitFor(`document.querySelector("[data-device-chip]")`, {
		label: "the device chip",
		timeout: 90_000,
	});
	await sleep(1000);
	step("chip-draft", await cdp.eval(`(() => { const el = document.querySelector("[data-device-chip]"); return el ? (el.textContent || "").trim() : null; })()`));

	await clickSelector(cdp, "[data-device-chip]", "chip");
	await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
		label: "the picker",
		timeout: 30_000,
	});
	await sleep(500);
	step(
		"picker",
		await cdp.eval(`(() => {
			const panel = document.querySelector("[data-device-picker]");
			return [...panel.querySelectorAll("[data-device-row]")].map((row) => ({
				state: row.getAttribute("data-device-row"),
				text: (row.textContent || "").trim().slice(0, 140),
			}));
		})()`),
	);
	const rowText = await clickSelector(cdp, '[data-device-row="candidate"]', "candidate row");
	step("picked", { text: rowText });
	await cdp
		.waitFor(`(document.querySelector("[data-device-chip]")?.textContent || "").includes("New on")`, {
			label: "the chip naming the picked peer",
			timeout: 30_000,
		})
		.catch(() => step("chip-wait", { outcome: "no 'New on' text within 30s" }));
	await sleep(600);
	step("chip-after-pick", await cdp.eval(`(document.querySelector("[data-device-chip]")?.textContent || "").trim()`));
	await shutter(cdp, `create-draft-peer-${ARM}`);

	await clickSelector(cdp, '[data-tour-tag="chat-input-textarea"] textarea', "composer");
	await cdp.send("Input.insertText", { text: "Sweep the nightly audit for anomalies" });
	await sleep(500);
	await pressEnter(cdp);
	step("sent", { at: new Date().toISOString() });

	let newId = null;
	for (let i = 0; i < 90 && !newId; i += 1) {
		await sleep(1000);
		const hash = await cdp.eval("location.hash");
		const m = /#\/chat\/([A-Za-z0-9_:-]+)/.exec(hash || "");
		if (m && !["d7c2d1e7b496", "b3a7f9c2d1e4"].includes(m[1])) {
			newId = m[1];
			step("created", { id: newId, hashSeenAt: new Date().toISOString() });
		}
	}
	if (!newId) throw new Error("the send never re-pointed the URL to a fresh conversation");
	report.probes.newId = newId;

	/* The mark: poll the sidebar row's screen-reader texts for the new id. */
	let marked = null;
	for (let i = 0; i < 60; i += 1) {
		await sleep(2000);
		const read = await cdp.eval(`(() => {
			const w = document.querySelector('[data-session-row=${JSON.stringify(newId)}]');
			if (!w) return { found: false };
			const b = w.querySelector("[data-chat-row]");
			const srs = [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim());
			return { found: true, srs, text: (b ? b.textContent : "").slice(0, 200) };
		})()`);
		if (i % 5 === 0) step(`mark-${i * 2}s`, read);
		if (read.found && read.srs.some((s) => /unseen/i.test(s))) {
			marked = read;
			break;
		}
	}
	step("mark", marked ?? { verdict: "no unseen mark seen in 120s" });
	await shutter(cdp, `create-row-${ARM}`);
}

const ROW_READ = `(() => {
	const row = document.querySelector('[data-session-row=' + JSON.stringify(${JSON.stringify(SESSION)}) + ']');
	const button = row ? row.querySelector('[data-chat-row]') : null;
	const describedby = button ? button.getAttribute('aria-describedby') : null;
	const srs = row ? [...row.querySelectorAll('.sr-only')].map((s) => (s.textContent || '').replace(/\\s+/g, ' ').trim()) : [];
	const chip = document.querySelector('[data-device-chip]');
	const toasts = [...document.querySelectorAll('[data-sonner-toast]')].map((t) => (t.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240));
	return {
		rowText: button ? (button.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 240) : null,
		described: describedby ? (document.getElementById(describedby)?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 300) : null,
		srs,
		chipLabel: chip ? chip.getAttribute('aria-label') : null,
		toasts,
		hash: location.hash,
		hasFocus: document.hasFocus(),
	};
})()`;
const readRow = (cdp) => cdp.eval(ROW_READ);

/* ------------------------------------------------------------------ main -- */

async function main() {
	let app = null;
	let ws = null;
	let cdp = null;
	try {
		rmSync(RUN, { recursive: true, force: true });
		for (const d of ["home", "logs", "cwd", "userdata"]) mkdirSync(join(RUN, d), { recursive: true });
		mkdirSync(FRAMES, { recursive: true });
		mkdirSync(join(CONFIG, "run"), { recursive: true });
		try {
			const { symlinkSync } = await import("node:fs");
			symlinkSync(RECORDS, join(CONFIG, "run", "serve"));
		} catch (error) {
			step("serve-record-link", { error: String(error) });
		}
		writeFileSync(
			join(RUN, "cwd", ".env"),
			`VITE_LOCAL_OPERATOR_API_URL=${BACKEND}\n`,
		);
		const require = createRequire(import.meta.url);
		const electron = require(join(WT, "node_modules", "electron"));
		let mockKeychain = "--use-mock-keychain";
		try {
			const mod = await import(
				pathToFileURL(join(WT, "scripts/chrome-keychain.mjs")).href
			);
			if (mod.MOCK_KEYCHAIN_SWITCH) mockKeychain = mod.MOCK_KEYCHAIN_SWITCH;
		} catch {}
		const cleanEnv = { ...process.env };
		for (const key of Object.keys(cleanEnv)) {
			if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete cleanEnv[key];
		}
		const env = {
			...cleanEnv,
			PATH: process.env.PATH,
			HOME: join(RUN, "home"),
			LOCAL_OPERATOR_CONFIG_DIR: CONFIG,
			LOCAL_OPERATOR_LOG_DIR: join(RUN, "logs"),
			LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
			LOCAL_OPERATOR_UI_TELEMETRY: "off",
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			VITE_DISABLE_BACKEND_MANAGER: "true",
			TERM: "xterm-256color",
			LANG: "en_US.UTF-8",
		};
		const cdpPort = await freePort();
		app = spawn(
			electron,
			[
				APPDIR || WT,
				"--window-mode=headless",
				"--window-size=1380x900",
				`--user-data-dir=${join(RUN, "userdata")}`,
				`--remote-debugging-port=${cdpPort}`,
				mockKeychain,
				"--backend",
				BACKEND,
				"--backend-records",
				RECORDS,
				"--seed-onboarding-complete",
			],
			{ cwd: join(RUN, "cwd"), env, stdio: ["ignore", "pipe", "pipe"] },
		);
		const logs = [];
		app.stdout.on("data", (b) => logs.push(b.toString()));
		app.stderr.on("data", (b) => logs.push(b.toString()));
		step("boot", { pid: app.pid, cdpPort, wt: WT });
		writeFileSync(join(FRAMES, "app.log"), logs.join(""), { flag: "a" });

		const target = await waitForCdp(cdpPort);
		ws = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((res, rej) => {
			ws.addEventListener("open", res, { once: true });
			ws.addEventListener("error", rej, { once: true });
		});
		cdp = new Cdp(ws);
		await cdp.send("Page.enable");
		await cdp.send("Runtime.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 1380,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.waitFor('document.querySelectorAll("button").length > 5', {
			label: "the app's first paint",
			timeout: 120_000,
		});
		await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
			source:
				'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (error) {}',
		});
		await cdp.send("Page.reload", { ignoreCache: false });
		await sleep(2000);
		await cdp.waitFor('document.querySelectorAll("button").length > 5', {
			label: "the app after the onboarding seed",
			timeout: 90_000,
		});
		const wizard = await cdp.eval(`(() => {
			const skip = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Skip for now"));
			if (!skip) return "no wizard";
			skip.click();
			return "skipped wizard";
		})()`);
		step("onboarding", { outcome: wizard });
		await sleep(1500);

		if (PHASE === "move" || PHASE === "dig" || PHASE === "create" || PHASE === "create2") {
			await (PHASE === "move"
				? runMove(cdp)
				: PHASE === "dig"
					? runDig(cdp)
					: PHASE === "create"
						? runCreate(cdp)
						: runCreate2(cdp));
			writeFileSync(join(FRAMES, `report-${PHASE}.json`), JSON.stringify(report, null, 1));
			console.log(`[done] ${PHASE} complete`);
		} else {
		/* ---- the seam answer ------------------------------------------------ */
		const seam = await cdp.eval(`(() => {
			const out = {};
			const d = Object.getOwnPropertyDescriptor(window, "api");
			out.apiDescriptor = d ? { writable: d.writable, configurable: d.configurable, enumerable: d.enumerable, hasGetter: !!d.get, hasSetter: !!d.set } : null;
			out.hasDesktop = !!(window.api && window.api.desktop);
			const dd = window.api && window.api.desktop ? Object.getOwnPropertyDescriptor(window.api, "desktop") : null;
			out.desktopDescriptor = dd ? { writable: dd.writable, configurable: dd.configurable, hasGetter: !!dd.get, hasSetter: !!dd.set } : null;
			let assigned = null;
			try {
				const before = window.api;
				window.api = window.api;
				assigned = window.api === before;
			} catch (error) {
				assigned = "threw: " + String(error);
			}
			out.reassignSame = assigned;
			out.requestDescriptor = (() => {
				try {
					const r = Object.getOwnPropertyDescriptor(window.api.desktop, "request");
					return r ? { writable: r.writable, configurable: r.configurable, hasGetter: !!r.get, hasSetter: !!r.set } : null;
				} catch (error) {
					return String(error);
				}
			})();
			return out;
		})()`);
		step("seam", seam);
		report.probes.seam = seam;

		/* ---- the sidebar rows ----------------------------------------------- */
		await sleep(3500);
		const rows = await cdp.eval(`(() => {
			const rows = [...document.querySelectorAll("[data-chat-row]")].map((el) => ({
				id: el.getAttribute("data-session-row") || el.getAttribute("data-chat-row") || "",
				text: (el.textContent || "").trim().slice(0, 220),
			}));
			const body = (document.body.innerText || "");
			return { rows, hasSession: body.includes(${JSON.stringify(SESSION)}) || body.includes("Quarterly ledger") };
		})()`);
		step("sidebar", rows);
		report.probes.sidebar = rows;
		await shutter(cdp, `probe-sidebar-${ARM}`);
		/* A cold store may re-learn peer rows from a later poll; watch for 60 s. */
		for (let i = 1; i <= 6; i += 1) {
			await sleep(10_000);
			const later = await cdp.eval(`(() => {
				const rows = [...document.querySelectorAll("[data-session-row]")].map((w) => ({
					id: w.getAttribute("data-session-row"),
					srs: [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim()),
				}));
				return { rows };
			})()`);
			step(`sidebar-${i * 10}s`, later);
		}
		await shutter(cdp, `probe-sidebar-late-${ARM}`);

		writeFileSync(join(FRAMES, `report-${PHASE}.json`), JSON.stringify(report, null, 1));
		console.log("[done] probe complete");
		}
	} catch (error) {
		fail("main", error);
		writeFileSync(join(FRAMES, `report-${PHASE}.json`), JSON.stringify(report, null, 1));
		throw error;
	} finally {
		try {
			if (ws) ws.close();
		} catch {}
		try {
			if (app && app.pid) {
				process.kill(-app.pid, "SIGTERM");
			}
		} catch {}
		try {
			if (app && app.pid) process.kill(app.pid, "SIGTERM");
		} catch {}
	}
}

/* ---- the move: chip -> picker -> confirm dialog -> wait for the receipt --- */

async function runMove(cdp) {
	await goto(cdp, `#/chat/${SESSION}`);
	await sleep(2500);
	const chip0 = await readRow(cdp);
	step("chip-before", chip0);
	await shutter(cdp, `move-before-chip-${ARM}`);

	await clickSelector(cdp, "[data-device-chip]", "chip");
	await sleep(900);
	const picker = await cdp.eval(`(() => {
		const p = document.querySelector("[data-device-picker]");
		if (!p) return { open: false, dlg: (document.querySelector('[role=dialog]')||{}).textContent || null };
		const rows = [...p.querySelectorAll("[data-device-row]")].map((r) => ({
			state: r.getAttribute("data-device-row"),
			text: (r.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
		}));
		return { open: true, busy: p.hasAttribute("data-device-picker-busy"), rows };
	})()`);
	step("picker", picker);
	await shutter(cdp, `move-picker-${ARM}`);

	const candidate = await cdp.eval(`(() => {
		const rx = /cloud-node-1/i;
		const hit = [...document.querySelectorAll("[data-device-row]")].find((r) => rx.test((r.textContent || "")) && r.getAttribute("data-device-row") !== "ineligible");
		if (!hit) return null;
		hit.scrollIntoView({ block: "center" });
		const rect = (${rectProbe})(hit);
		return { rect, text: (hit.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160), state: hit.getAttribute("data-device-row") };
	})()`);
	if (!candidate) throw new Error(`no candidate row for cloud-node-1; picker saw ${JSON.stringify(picker)}`);
	step("candidate", { state: candidate.state, text: candidate.text });
	await press(cdp, candidate.rect);
	await sleep(1000);

	const dlg = await cdp.eval(`(() => {
		const d = document.querySelector('[role=dialog]');
		if (!d) return { open: false };
		return { open: true, text: (d.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 400), buttons: [...d.querySelectorAll("button")].map((b) => (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80)) };
	})()`);
	step("dialog", dlg);
	await shutter(cdp, `move-dialog-${ARM}`);
	if (!dlg.open) throw new Error("the confirm dialog did not open");

	const said = await clickText(cdp, "[role=dialog]", "Move it|Recall it|Move to", "confirm", "button");
	step("confirmed", { said });

	/* Wait for the receipt: the picker's busy flag and the chip's own sentence
	 * are both the app's answer, so the wait reads those and nothing else. */
	let settled = null;
	for (let i = 0; i < 200; i += 1) {
		await sleep(1500);
		const st = await cdp.eval(`(() => {
			const p = document.querySelector("[data-device-picker]");
			const d = document.querySelector('[role=dialog]');
			return {
				picker: !!p,
				busy: p ? p.hasAttribute("data-device-picker-busy") : null,
				dialog: !!d,
				inFlight: document.querySelectorAll("[data-device-in-flight]").length,
				body: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 2000),
			};
		})()`);
		if (i % 8 === 0) step(`wait-${Math.round((i * 1.5))}s`, { picker: st.picker, busy: st.busy, dialog: st.dialog, inFlight: st.inFlight });
		if (!st.busy && (st.inFlight > 0 || /moved to|moved|receipt/i.test(st.body) || i > 40)) {
			settled = st;
			break;
		}
	}
	step("settled", settled ? { busy: settled.busy, inFlight: settled.inFlight } : null);
	await sleep(1500);
	await shutter(cdp, `move-settled-${ARM}`);
	if (settled) {
		const receipt = await cdp.eval(`(() => {
			const rx = /moved|receipt|could not|refus|fail/i;
			const lines = (document.body.innerText || "").split("\\n").map((l) => l.trim()).filter((l) => rx.test(l));
			return lines.slice(0, 20);
		})()`);
		step("receipt-lines", receipt);
	}
	const rows = await readRow(cdp);
	step("row-after-move", rows);
	await shutter(cdp, `move-row-after-${ARM}`);
}

/* ---- the dig: open the moved chat, focus, and watch for the receipt's arm -- */

async function runDig(cdp) {
	await cdp.eval(`location.hash = ${JSON.stringify(`#/chat/${SESSION}`)}`);
	await sleep(3000);
	/* The open flow (history/events/watch over the peer bridge) does not need a
	 * sidebar row; wait for the pane, and watch whether a row materialises. */
	await cdp
		.waitFor(`document.querySelector("[data-device-chip]") || document.querySelector('[data-tour-tag="chat-input-textarea"]')`, {
			label: "the conversation pane",
			timeout: 90_000,
		})
		.catch(() => step("pane-wait", { outcome: "no pane within 90s" }));
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await sleep(400);
	const focus = await cdp.eval("document.hasFocus()");
	step("focus-emulation", { on: true, hasFocus: focus });

	const before = await cdp.eval(`(() => ({
		hash: location.hash,
		rows: [...document.querySelectorAll("[data-session-row]")].map((w) => ({
			id: w.getAttribute("data-session-row"),
			srs: [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim()),
		})),
		chip: (document.querySelector("[data-device-chip]")?.textContent || "").trim(),
		body: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 400),
	}))()`);
	step("row-at-open", before);

	for (let i = 0; i < 60; i += 1) {
		await sleep(2000);
		const st = await cdp.eval(`(() => ({
			hash: location.hash,
			rows: [...document.querySelectorAll("[data-session-row]")].map((w) => ({
				id: w.getAttribute("data-session-row"),
				srs: [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim()),
			})),
			toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240)),
			chip: (document.querySelector("[data-device-chip]")?.textContent || "").trim(),
		}))()`);
		if (i % 5 === 0) step(`dig-${i * 2}s`, st);
	}
	const consoleTail = cdp.console.slice(-40);
	step("renderer-console", { count: cdp.console.length, tail: consoleTail });
	await shutter(cdp, `dig-final-${ARM}`);
}

/* ---- the definitive flow: app-create on cloud-node-1, turn, mark, frames --- */

async function admitTurnViaRig(sessionId, text) {
	const token = readFileSync(join(RIG, "desktop.token"), "utf8").trim();
	const request_id = globalThis.crypto.randomUUID();
	const res = await fetch(`http://127.0.0.1:41241/v1/desktop/sessions/${sessionId}/messages`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ request_id, text, images: [], mode: "prompt" }),
	});
	return { status: res.status, body: (await res.text()).slice(0, 300) };
}

async function runCreate2(cdp) {
	const hasChip = await cdp.eval(`Boolean(document.querySelector("[data-device-chip]"))`);
	if (!hasChip) {
		step("new-chat", { action: "pressing cmd-N" });
		for (const type of ["keyDown", "keyUp"]) {
			await cdp.send("Input.dispatchKeyEvent", {
				type,
				key: "n",
				code: "KeyN",
				modifiers: 4,
				windowsVirtualKeyCode: 78,
				nativeVirtualKeyCode: 78,
			});
		}
	}
	await cdp.waitFor(`document.querySelector("[data-device-chip]")`, {
		label: "the device chip",
		timeout: 90_000,
	});
	await sleep(900);

	await clickSelector(cdp, "[data-device-chip]", "chip");
	await cdp.waitFor(`document.querySelector("[data-device-picker]")`, {
		label: "the picker",
		timeout: 30_000,
	});
	await sleep(500);
	await clickSelector(cdp, '[data-device-row="candidate"]', "candidate row");
	await sleep(800);
	step("chip-after-pick", await cdp.eval(`(document.querySelector("[data-device-chip]")?.textContent || "").trim()`));
	await shutter(cdp, `create2-draft-${ARM}`);

	await clickSelector(cdp, '[data-tour-tag="chat-input-textarea"] textarea', "composer");
	await cdp.send("Input.insertText", { text: "Sweep the nightly audit for anomalies" });
	await sleep(500);
	await pressEnter(cdp);
	step("sent", { at: new Date().toISOString() });

	/* The create lands in seconds; its immediate message may race the peer
	 * cache's 20 s TTL (a 404 the rig tolerates - the admission below is the
	 * turn, sent exactly as the app's transport sends it). */
	let newId = null;
	const seen = new Set(["d7c2d1e7b496", "b3a7f9c2d1e4", "aa4d9d53fd34", "f381b0c58db7"]);
	for (let i = 0; i < 120 && !newId; i += 1) {
		await sleep(1000);
		const ids = await cdp.eval(`[...document.querySelectorAll("[data-session-row]")].map((w) => w.getAttribute("data-session-row"))`);
		const fresh = (ids ?? []).find((id) => !seen.has(id));
		if (fresh) {
			newId = fresh;
			step("created", { id: newId, via: "sidebar row", at: new Date().toISOString() });
		}
	}
	if (!newId) throw new Error("no fresh row appeared after the create");
	report.probes.newId = newId;

	await sleep(25_000);
	const admit = await admitTurnViaRig(newId, "Sweep the nightly audit for anomalies");
	step("rig-admit", admit);

	await cdp.eval(`location.hash = ${JSON.stringify(`#/chat/${newId}`)}`);
	for (let i = 0; i < 45; i += 1) {
		await sleep(2000);
		const st = await cdp.eval(`(() => {
			const w = document.querySelector('[data-session-row=${JSON.stringify(newId)}]');
			const b = w ? w.querySelector("[data-chat-row]") : null;
			const srs = w ? [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim()) : [];
			return {
				current: b ? b.getAttribute("aria-current") : null,
				srs,
				chip: (document.querySelector("[data-device-chip]")?.textContent || "").trim(),
				hash: location.hash,
			};
		})()`);
		if (i % 5 === 0) step(`create2-${i * 2}s`, st);
		if (st.srs.some((s) => /unseen/i.test(s))) {
			step("mark", { at: `${i * 2}s`, srs: st.srs });
			break;
		}
	}
	await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
	await sleep(400);
	step("focus", { hasFocus: await cdp.eval("document.hasFocus()") });
	/* Watch for the receipt attempt's aftermath: toasts, the row description,
	 * and (via the daemon read done after the run) the POST /seen itself. */
	for (let i = 0; i < 45; i += 1) {
		await sleep(2000);
		const st = await cdp.eval(`(() => {
			const w = document.querySelector('[data-session-row=${JSON.stringify(newId)}]');
			const b = w ? w.querySelector("[data-chat-row]") : null;
			const describedby = b ? b.getAttribute("aria-describedby") : null;
			return {
				described: describedby ? (document.getElementById(describedby)?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300) : null,
				srs: w ? [...w.querySelectorAll(".sr-only")].map((s) => (s.textContent || "").replace(/\\s+/g, " ").trim()) : [],
				toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => (t.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 260)),
			};
		})()`);
		if (i % 4 === 0) step(`after-${i * 2}s`, { toasts: st.toasts, described: st.described, unread: st.srs.some((s) => /unseen/i.test(s)) });
		if (st.toasts.length > 0) {
			step("toast-seen", { toasts: st.toasts });
			await shutter(cdp, `toast-${ARM}`);
		}
	}
	await shutter(cdp, `create2-final-${ARM}`);
	const consoleTail = cdp.console.slice(-30);
	step("renderer-console", { count: cdp.console.length, tail: consoleTail });
}

try {
	await main();
	process.exit(0);
} catch (error) {
	console.error(String(error && error.stack ? error.stack : error));
	process.exit(1);
}
