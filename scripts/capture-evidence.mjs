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
			/*
			 * Set the theme through the app's OWN persisted store, before the
			 * page loads, rather than by poking `data-theme` afterwards.
			 *
			 * This is not a style preference, it is the only correct way during
			 * the migration. The bridge has two halves that are populated at
			 * different times: MUI bakes palette values into Emotion classes as
			 * literal hexes when `createBaseTheme` runs, while Tailwind reads
			 * `--lo-*` live off `data-theme`. Setting the attribute alone moves
			 * only the Tailwind half, so every still-MUI-styled element keeps the
			 * previous palette's colour — which renders as dark ink on light
			 * paper and looks exactly like a contrast bug in the product. The
			 * real ThemeProvider moves both together because it reads this store;
			 * driving the store is what reproduces that.
			 */
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(150);
			await cdp.send("Page.navigate", { url: `${ORIGIN}/iframe.html` });
			await sleep(400);
			await cdp.send("Runtime.evaluate", {
				expression: `localStorage.setItem(
					"ui-preferences-storage",
					JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })
				);`,
			});
			/*
			 * Pass the theme as a story ARG as well as through the store.
			 *
			 * Some stories own their own theme — the primitives sheet has a
			 * `theme` control and sets `data-theme` from it in a layout effect,
			 * which runs after navigation and overwrites anything set from
			 * outside. Without this the capture produced twelve files named for
			 * twelve themes that were all the story's default, which is worse
			 * than no evidence because the filenames assert something false.
			 * Storybook ignores an `args` key a story does not declare, so this
			 * is safe for the stories that take their theme from the store.
			 */
			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
			});
			await sleep(900);
			/* Belt and braces for stories that mount no ThemeProvider of their
			   own: the attribute still has to be right for Tailwind utilities. */
			await cdp.send("Runtime.evaluate", {
				expression: `
					document.documentElement.dataset.theme = ${JSON.stringify(theme)};
					document.documentElement.classList.toggle("dark", ${!LIGHT.has(theme)});
				`,
			});
			await sleep(250);

			/*
			 * Settle animations before the shutter.
			 *
			 * Entrance fades are real product behaviour, but a screenshot taken
			 * mid-fade records a half-opacity paragraph and reads as a contrast
			 * defect — which cost a full review cycle here. Removing the
			 * animation outright (rather than pausing it) is safe precisely
			 * because the system requires every animated element's RESTING state
			 * to be the visible one: `animation: none` drops the element back to
			 * its own `opacity: 1`. If this ever leaves something invisible, the
			 * animation was violating that rule and the evidence should show it.
			 */
			await cdp.send("Runtime.evaluate", {
				expression: `(() => {
					const s = document.createElement("style");
					s.textContent = "*,*::before,*::after{animation:none !important;transition:none !important}";
					document.head.appendChild(s);
				})()`,
			});
			await sleep(120);

			/* Assert the capture is of a rendered story, not Storybook's own
			   error page. A screenshot of "Configuration validation failed" is
			   indistinguishable from a real frame in a directory listing, and a
			   whole evidence set was once captured that way. */
			const { result: sane } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const t = document.body.innerText || "";
					if (/Configuration validation failed|no stories|Story not found/i.test(t)) return "storybook-error";
					if (t.trim().length < 20) return "empty";
					return "ok";
				})()`,
			});
			if (sane.value !== "ok") {
				throw new Error(
					`${story} @ ${theme}: story did not render (${sane.value})`,
				);
			}
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
