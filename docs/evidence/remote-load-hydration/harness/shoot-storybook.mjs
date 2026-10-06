#!/usr/bin/env node
/**
 * Shoot the slot's rendered states, from a running Storybook, into this set.
 *
 * WHY A RIG OF ITS OWN rather than `scripts/capture-evidence.mjs`: that sweep
 * writes the canonical `<surface>/<leaf>/<theme>.webp` layout and records a
 * `partialCapture` in the main manifest; this lane's frames are hand-driven
 * PNGs under `docs/evidence/remote-load-hydration/frames/` (the
 * `remote-turn-order` precedent), so the capture has to land HERE. Everything
 * else is the repo's own shape: ONE headless Chrome for the whole run with the
 * mock-keychain switch taken from its one home (`withMockKeychain`), a scratch
 * profile under the session scratchpad (never /tmp), CDP for sizing and the
 * shutter, and a teardown by exact pid.
 *
 * Usage:
 *   LOCAL_OPERATOR_SCRATCHPAD=<scratch> node shoot-storybook.mjs \
 *     --origin http://localhost:6006 --out <dir> [--report <file>]
 *
 * The surfaces shot are the slot's copy change and the every-state board; each
 * carries its own viewport, matching the `scripts/capture-evidence.mjs` rows
 * registered for the same stories, so a frame here and a sweep there describe
 * one layout.
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withMockKeychain } from "../../../../scripts/chrome-keychain.mjs";

const ARGS = process.argv.slice(2);
const argValue = (name, fallback) => {
	const at = ARGS.indexOf(`--${name}`);
	return at === -1 ? fallback : ARGS[at + 1];
};
const ORIGIN = argValue("origin", "http://localhost:6006");
const OUT = argValue("out");
if (!OUT) {
	console.error("need --out <dir>");
	process.exit(2);
}
const REPORT = argValue("report", join(OUT, "shoot-report.json"));
const SCRATCH = process.env.LOCAL_OPERATOR_SCRATCHPAD || process.cwd();
mkdirSync(OUT, { recursive: true });

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/**
 * The two surfaces, at the rows' own viewports. `in-transcript-unproven` is
 * the honest-copy change (the retry-able "not loaded" arm over real rows,
 * never "Start of conversation"); `every-state` is the board where the fixed
 * height is falsifiable — six arms between two rules after the `unproven` arm
 * joined it.
 *
 * The theme is named the way the repo's other rigs name it (`args=theme:...`),
 * against the dark palette every frame in this set is taken in.
 */
const SURFACES = [
	["chat-older-history-slot--in-transcript-unproven", 900, 520, "storybook-unproven-end"],
	["chat-older-history-slot--every-state", 900, 520, "storybook-every-state"],
];
const THEME = "localOperatorDark";

/** Chrome's own line naming the debugging endpoint, hoisted (lint rule). */
const DEBUG_PORT = /DevTools listening on (ws:\/\/[^\s]+)/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
}

const dataDir = join(SCRATCH, "storybook-shoot", `profile-${process.pid}`);
mkdirSync(dataDir, { recursive: true });
let chrome = null;
const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	try {
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	} catch {
		/* a leavened profile under the session scratch is harmless */
	}
};

const report = { origin: ORIGIN, theme: THEME, surfaces: [] };
try {
	chrome = spawn(
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
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (data) => {
			buf += data.toString();
			const match = buf.match(DEBUG_PORT);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener("open", resolve, { once: true });
		socket.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(socket);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");

	for (const [story, width, height, name] of SURFACES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(150);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${THEME}`,
		});
		/*
		 * READY IS THREE THINGS. Storybook's "preparing" wrapper can sit inside
		 * an otherwise-ready document; fonts decide the glyphs; and the story's
		 * own text has to be in the DOM (an empty body is a story that never
		 * mounted). The marker is the arm's own sentence, at the full spelling
		 * both surfaces render at these widths (the short one only appears below
		 * 260px).
		 */
		const marker = "Earlier history not loaded";
		let ready = false;
		for (let attempt = 0; attempt < 200 && !ready; attempt += 1) {
			const outcome = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const text = document.body.innerText || "";
					return {
						fonts: !document.fonts || document.fonts.status === "loaded",
						preparing: /preparing/i.test(text),
						marker: text.includes(${JSON.stringify(marker)}),
						hasStart: text.includes("Start of conversation"),
					};
				})()`,
			});
			const state = outcome.result?.value ?? {};
			if (state.fonts && !state.preparing && state.marker) ready = true;
			else await sleep(150);
		}
		// Two rAFs plus a calm beat, so the shutter reads a settled paint.
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression:
				"new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 400))))",
		});
		const probe = await cdp.send("Runtime.evaluate", {
			returnByValue: true,
			expression:
				"({ text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400) })",
		});
		const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
		const file = join(OUT, `${name}.png`);
		writeFileSync(file, Buffer.from(shot.data, "base64"));
		report.surfaces.push({
			story,
			width,
			height,
			file,
			ready,
			text: probe.result?.value?.text ?? "",
		});
		console.log(`shot ${file} ready=${ready}`);
		if (!ready) console.error(`WARNING: ${story} never reached its marker`);
	}
} finally {
	teardown();
}
writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`report ${REPORT}`);
process.exit(0);
