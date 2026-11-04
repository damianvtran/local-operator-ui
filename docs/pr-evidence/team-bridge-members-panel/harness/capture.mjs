// Capture driver for the members-panel PR. Modelled on
// docs/pr-evidence/team-bridge-view-restore/harness/capture.mjs: private
// --headless=new Chrome, scratch profile, --use-mock-keychain (via
// withMockKeychain), raw CDP, process-group reap by exact pid on exit.
//
//   REPO=$PWD OUT=<dir> LABEL=<before|after> SHOTS=<json file> \
//     node scripts/with-storybook.mjs -- node <this file>
//
// SHOTS is a JSON array of { name, story, theme, locale?, width?, height?, action? }.
// `action` is one of: "hover:<css>", "focus-kbd:<css>" (focus, then a
// Shift+Tab/Tab pair so :focus-visible paints), "click:<css>", or absent.
import { spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = process.env.REPO;
const { withMockKeychain } = await import(
	pathToFileURL(join(REPO, "scripts/chrome-keychain.mjs")).href
);
const ORIGIN = process.env.STORYBOOK_ORIGIN;
const OUT = process.env.OUT;
const LABEL = process.env.LABEL ?? "after";
const SHOTS = JSON.parse(readFileSync(process.env.SHOTS, "utf8"));
mkdirSync(OUT, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dataDir = mkdtempSync(join(tmpdir(), "tb-members-"));
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
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
	process.on(signal, () => process.exit(1));
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
			m.error
				? p.reject(new Error(JSON.stringify(m.error)))
				: p.resolve(m.result);
		}
	};
	const raw = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const n = id++;
			pending.set(n, { resolve, reject });
			ws.send(
				JSON.stringify({
					id: n,
					method,
					params,
					...(sessionId ? { sessionId } : {}),
				}),
			);
		});
	const { targetId } = await raw("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await raw("Target.attachToTarget", {
		targetId,
		flatten: true,
	});
	const send = (m, p) => raw(m, p, sessionId);
	await send("Page.enable");
	await send("Runtime.enable");
	const evaluate = async (expr) => {
		const r = await send("Runtime.evaluate", {
			expression: `(() => (${expr}))()`,
			returnByValue: true,
			awaitPromise: true,
		});
		if (r.exceptionDetails)
			throw new Error(r.exceptionDetails.exception?.description ?? "eval");
		return r.result.value;
	};
	const until = async (expr, label, ms = 90000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			try {
				if (await evaluate(`Boolean(${expr})`)) return;
			} catch {}
			await wait(200);
		}
		throw new Error(`timed out: ${label}`);
	};
	const centre = (css) =>
		evaluate(
			`(() => { const r = document.querySelector(${JSON.stringify(css)})?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`,
		);
	const key = async (keyName, code, keyCode, modifiers = 0) => {
		for (const type of ["keyDown", "keyUp"])
			await send("Input.dispatchKeyEvent", {
				type,
				key: keyName,
				code,
				windowsVirtualKeyCode: keyCode,
				modifiers,
			});
	};
	for (const shot of SHOTS) {
		const width = shot.width ?? 1280;
		const height = shot.height ?? 760;
		await send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${shot.story}&viewMode=story&args=theme:${shot.theme}${shot.locale ? `;locale:${shot.locale}` : ""}`,
		});
		await until(
			`document.documentElement.getAttribute('data-theme') === ${JSON.stringify(shot.theme)} && document.querySelector('#storybook-root')?.children.length > 0`,
			`${shot.name} render`,
		);
		await wait(900);
		if (shot.action) {
			const [verb, css] = [
				shot.action.slice(0, shot.action.indexOf(":")),
				shot.action.slice(shot.action.indexOf(":") + 1),
			];
			await until(`document.querySelector(${JSON.stringify(css)})`, css);
			const at = await centre(css);
			if (verb === "hover" || verb === "click") {
				await send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: at.x,
					y: at.y,
				});
				if (verb === "click") {
					for (const type of ["mousePressed", "mouseReleased"])
						await send("Input.dispatchMouseEvent", {
							type,
							x: at.x,
							y: at.y,
							button: "left",
							clickCount: 1,
						});
				}
			} else if (verb === "focus-kbd") {
				await evaluate(
					`document.querySelector(${JSON.stringify(css)}).focus()`,
				);
				await key("Tab", "Tab", 9, 8);
				await key("Tab", "Tab", 9);
			}
			await wait(600);
		}
		const { data } = await send("Page.captureScreenshot", { format: "png" });
		const path = join(OUT, `${shot.name}__${LABEL}.png`);
		writeFileSync(path, Buffer.from(data, "base64"));
		const facts = await evaluate(
			`({ theme: document.documentElement.getAttribute('data-theme'), active: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName, panel: Boolean(document.querySelector('aside[aria-label="Members"]')), countButton: document.querySelector('button[aria-label^="View "]')?.getAttribute('aria-label') ?? null, rows: document.querySelectorAll('aside[aria-label="Members"] li').length, dialog: document.querySelector('[role="dialog"] h2')?.textContent ?? null })`,
		);
		log.push({ ...shot, frame: path, facts });
		console.error(`shot ${shot.name} ${JSON.stringify(facts)}`);
	}
} finally {
	writeFileSync(join(OUT, `${LABEL}-log.json`), JSON.stringify(log, null, 2));
	reap();
}
