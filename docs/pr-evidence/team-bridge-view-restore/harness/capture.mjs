// Capture driver for the Team Bridge leave-and-return story. Modelled on
// scripts/click-proof.mjs: private --headless=new Chrome, scratch profile,
// --use-mock-keychain (via withMockKeychain), raw CDP, exact-pid reap.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.REPO;
const { withMockKeychain } = await import(
	pathToFileURL(join(REPO, "scripts/chrome-keychain.mjs")).href
);
const ORIGIN = process.env.STORYBOOK_ORIGIN;
const OUT = process.env.OUT;
const LABEL = process.env.LABEL; // "before" | "after"
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dataDir = mkdtempSync(join(tmpdir(), "tb-restore-"));
const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]),
	{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
);
console.error(`chrome pid=${chrome.pid}`);
const reap = () => {
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {}
	try {
		rmSync(dataDir, { recursive: true, force: true });
	} catch {}
};
process.on("exit", reap);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
try {
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("no debug port")), 30000);
		chrome.stderr.on("data", (d) => {
			buf += d;
			const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
	});
	const ws = new WebSocket(wsUrl);
	await new Promise((r) => (ws.onopen = r));
	let id = 1;
	const pending = new Map();
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data);
		if (m.id && pending.has(m.id)) {
			const p = pending.get(m.id);
			pending.delete(m.id);
			m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
		}
	};
	const raw = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const n = id++;
			pending.set(n, { resolve, reject });
			ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await raw("Target.attachToTarget", { targetId, flatten: true });
	const send = (m, p) => raw(m, p, sessionId);
	await send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 800,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await send("Page.enable");
	await send("Runtime.enable");
	// The iframe document of the story, opened through the manager URL so the
	// server channel token is present; we then evaluate in the preview frame.
	await send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=team-bridge-leave-and-return-live-flow--live-flow&viewMode=story`,
	});
	const frameEval = async (expr) => {
		const r = await send("Runtime.evaluate", {
			expression: `(() => (${expr}))()`,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval");
		return r.result.value;
	};
	const until = async (expr, label, ms = 60000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			try {
				if (await frameEval(`Boolean(${expr})`)) return;
			} catch {}
			await wait(150);
		}
		const top = await send("Runtime.evaluate", { expression: "location.href + ' | ' + document.title + ' | ' + (document.querySelector('#storybook-preview-iframe')?.src ?? 'no iframe')", returnByValue: true });
		let inner = null;
		try { inner = await frameEval("document.body ? document.body.innerText.slice(0, 600) : 'nobody'"); } catch (e) { inner = String(e); }
		throw new Error(`timed out: ${label} :: ${top.result.value} :: ${inner}`);
	};
	const selected = `(document.querySelector('[aria-current="page"][data-conversation-id]')?.getAttribute('data-conversation-id') ?? (document.querySelector('[aria-current="page"][data-team-bridge-person]') ? 'person:' + document.querySelector('[aria-current="page"][data-team-bridge-person]').getAttribute('data-team-bridge-person') : null))`;
	const shoot = async (name) => {
		const { data } = await send("Page.captureScreenshot", { format: "png" });
		const path = join(OUT, `${LABEL}-${name}.png`);
		writeFileSync(path, Buffer.from(data, "base64"));
		const state = await frameEval(selected);
		log.push({ frame: path, selected: state });
		console.log(`${path} selected=${state}`);
	};
	const click = async (sel) => {
		await until(`document.querySelector(${JSON.stringify(sel)})`, `clickable ${sel}`);
		await frameEval(`(document.querySelector(${JSON.stringify(sel)}).click(), true)`);
	};
	// Sample the selection on every animation frame while the page mounts, so a
	// one-frame #general flash on return is recorded rather than missed.
	const startSampling = () =>
		frameEval(`(window.__tbSamples = [], (function tick(){ const s = ${selected}; if (window.__tbSamples.at(-1) !== s) window.__tbSamples.push(s); if (window.__tbSamples.length < 400) window.requestAnimationFrame(tick); })(), true)`);
	const samples = () => frameEval(`window.__tbSamples`);

	await until(`document.querySelector('[data-rig="away"]') || document.querySelector('[aria-current="page"]')`, "story mounted");
	await frameEval(`(localStorage.removeItem("lo.teamBridge.view.v1"), localStorage.removeItem("lo.teamBridge.scope.v1"), true)`);
	await click('[data-rig="restart"]');
	await until(`${selected} !== null`, "landed");
	await wait(600);
	await shoot("01-first-open");
	// Pick the DM with Ben (switch to Minerva first: two orgs open in the union).
	await frameEval(`(document.querySelector('button[aria-label^="Organization:"]').dispatchEvent(new window.PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'})), true)`);
	await until(`[...document.querySelectorAll('[role="menuitemradio"]')].some(e => e.textContent.trim().startsWith('Minerva'))`, "menu open");
	await frameEval(`([...document.querySelectorAll('[role="menuitemradio"]')].find(e => e.textContent.trim().startsWith('Minerva')).click(), true)`);
	await until(`document.querySelector('[data-team-bridge-person="acct_ben"]')`, "Minerva rail");
	await click('[data-team-bridge-person="acct_ben"]');
	await until(`${selected} === 'person:acct_ben'`, "DM selected");
	await wait(600);
	await shoot("02-dm-selected");
	await click('[data-rig="chat"]');
	await wait(500);
	await until(`document.querySelector('[data-rig="away"]')`, "left");
	await shoot("03-away-in-chat");
	await startSampling();
	await click('[data-rig="bridge"]');
	await until(`${selected} !== null`, "returned");
	await wait(800);
	log.push({ returnSamples: await samples() });
	await shoot("04-returned");
	await startSampling();
	await click('[data-rig="restart"]');
	await until(`${selected} !== null`, "restarted");
	await wait(800);
	log.push({ restartSamples: await samples() });
	await shoot("05-after-restart");
	// Per-org: switch to Northwind, pick #ops, switch back to Minerva, then Northwind.
	const choose = async (name) => {
		await frameEval(`(document.querySelector('button[aria-label^="Organization:"]').dispatchEvent(new window.PointerEvent('pointerdown', {bubbles: true, button: 0, pointerType: 'mouse'})), true)`);
		await until(`[...document.querySelectorAll('[role="menuitemradio"]')].some(e => e.textContent.trim().startsWith(${JSON.stringify(name)}))`, `menu ${name}`);
		await frameEval(`([...document.querySelectorAll('[role="menuitemradio"]')].find(e => e.textContent.trim().startsWith(${JSON.stringify(name)})).click(), true)`);
	};
	await choose("Northwind");
	await until(`${selected} !== null && ${selected}.endsWith('northwind') || ${selected} === 'ops'`, "northwind landed");
	await click('[data-conversation-id="ops"]');
	await until(`${selected} === 'ops'`, "ops selected");
	await wait(400);
	await shoot("06-northwind-ops");
	await choose("Minerva");
	await until(`${selected} !== null && ${selected} !== 'ops'`, "minerva landed");
	await wait(800);
	await shoot("07-switch-back-to-minerva");
	await choose("Northwind");
	await until(`${selected} !== null && ${selected} !== 'person:acct_ben'`, "northwind again");
	await wait(800);
	await shoot("08-switch-back-to-northwind");
	writeFileSync(join(OUT, `${LABEL}-log.json`), JSON.stringify(log, null, 2));
	console.log(JSON.stringify(log.filter((e) => !e.frame)));
	ws.close();
} catch (error) {
	writeFileSync(join(OUT, `${LABEL}-log.json`), JSON.stringify({ error: String(error), log }, null, 2));
	console.error("FAILED", error);
	process.exitCode = 1;
} finally {
	reap();
	await wait(300);
	try {
		process.kill(chrome.pid, 0);
		console.error(`chrome ${chrome.pid} STILL ALIVE`);
	} catch {
		console.error(`chrome ${chrome.pid} reaped`);
	}
}
