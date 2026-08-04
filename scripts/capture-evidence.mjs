#!/usr/bin/env node
/**
 * Captures visual evidence across all twelve themes from Storybook.
 *
 *     node scripts/capture-evidence.mjs [storybook-origin]   # default :6017
 *
 * Drives a PRIVATE headless Chromium over raw CDP (a fresh user-data-dir under
 * /tmp, killed on exit), with no browser-automation dependency in the repo —
 * Node's built-in WebSocket speaks the DevTools protocol directly. One
 * screenshot per theme per story, written to
 * `docs/evidence/<feature>/<story>/<theme>.webp`.
 *
 * Why this file exists. The review process for this app is visual: there is
 * no test runner, and the design contract (docs/branding.md) is judged by
 * looking at the surface in every theme, because a contrast or spacing defect
 * that hides in one theme is still a defect. A hand-taken screenshot set
 * cannot be reproduced or extended; this can, and the MR evidence comes from
 * the same tool the next reviewer will run.
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "evidence");
const ORIGIN = process.argv[2] ?? "http://localhost:6017";

const CHROME =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const THEMES = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
];

/** Light-mode themes, used only to set the `dark` class correctly. */
const LIGHT = new Set(["localOperatorLight", "sage", "dune"]);

/**
 * The stories that constitute the evidence set: story id plus the viewport it
 * is captured at. Chat surfaces are wide; the primitives sheet is tall.
 */
const STORIES = [
	["chat-trace--conversation", 1280, 900],
	["chat-trace--conversation-with-reasoning", 1280, 900],
	["chat-trace--question-callout", 1280, 900],
	["chat-trace--trace-states", 1280, 900],
	["chat-trace--security-notice-states", 1280, 900],
	["design-system-primitives--all-primitives", 1280, 1600],
	["onboarding-onboardingmodal--congratulations", 1280, 900],
	["installer-installercontent--default", 900, 700],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A minimal CDP client over the built-in WebSocket. The protocol is
 * JSON-RPC-ish: send {id, method, params}, receive {id, result|error} plus
 * unsolicited events. Only the three domains this script needs are used.
 */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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

const main = async () => {
	const dataDir = join(tmpdir(), `lo-evidence-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	const chrome = spawn(CHROME, [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]);

	// Chrome prints the DevTools websocket on stderr.
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});

	/* The debug port is chosen by Chrome (port 0), so derive the HTTP origin
	   from the websocket URL's own authority rather than assuming a port. */
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);

	await cdp.send("Page.enable");
	await cdp.send("Network.enable");

	rmSync(OUT, { recursive: true, force: true });

	let captured = 0;
	for (const [story, width, height] of STORIES) {
		for (const theme of THEMES) {
			await cdp.send("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story`,
			});
			// networkidle0 equivalent: wait for load plus a settle window.
			await sleep(1200);
			/* The story wrappers set data-theme themselves; force it here too so
			   the capture is honest about which palette it shows even for stories
			   that do not carry the wrapper. */
			await cdp.send("Runtime.evaluate", {
				expression: `
					document.documentElement.dataset.theme = ${JSON.stringify(theme)};
					document.documentElement.classList.toggle("dark", ${!LIGHT.has(theme)});
				`,
			});
			await sleep(500);
			const { data } = await cdp.send("Page.captureScreenshot", {
				format: "webp",
				quality: 88,
				captureBeyondViewport: true,
			});
			const dir = join(OUT, story.split("--")[0], story.split("--")[1]);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${theme}.webp`), Buffer.from(data, "base64"));
			captured++;
		}
	}

	chrome.kill("SIGKILL");
	rmSync(dataDir, { recursive: true, force: true });
	console.log(`Captured ${captured} frames into ${OUT}`);
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
