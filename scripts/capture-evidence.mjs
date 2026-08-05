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

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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

/**
 * The stories that constitute the evidence set: story id plus the viewport it
 * is captured at.
 *
 * This list is the review surface. A story missing from it is a surface nobody
 * looks at, and round 2 caught exactly that: the set had shrunk to eight
 * stories drawn from four of fifteen story files, so the shell, the canvas,
 * agent-hub, schedules and the composer had no visual evidence at all and two
 * findings about them could not be judged. When you add a story file, add it
 * here.
 *
 * Viewports are the real shipped sizes, not whatever fits. The installer was
 * captured at 900x700 while its own story declares 1380x800 and the shipped
 * window is 1380x800, so the committed frame was a responsive fallback with
 * the brand mark clipped in half - evidence of a layout the user never sees.
 *
 * The shell is swept at four widths because two 220px rails at 800px consumed
 * 28.5% of the window before any content, and a single wide capture hides
 * exactly that class of defect.
 */
const STORIES = [
	["chat-trace--conversation", 1280, 900],
	["chat-trace--conversation-with-reasoning", 1280, 900],
	["chat-trace--question-callout", 1280, 900],
	["chat-trace--trace-states", 1280, 900],
	["chat-trace--security-notice-states", 1280, 900],
	["design-system-primitives--all-primitives", 1280, 1600],

	/* App shell, swept for the rail-width finding. */
	["shell-app-shell--agents", 1280, 800],
	["shell-app-shell--agents", 1000, 800],
	["shell-app-shell--agents", 900, 800],
	["shell-app-shell--agents", 800, 800],
	["shell-app-shell--settings", 1280, 800],
	["shell-app-shell--agents-empty", 1280, 800],
	["shell-app-shell--rail-collapsed", 1280, 800],

	/* Canvas: the second-largest surface, and the one with the data grids. */
	["canvas-workspace--markdown-document", 1280, 900],
	["canvas-workspace--spreadsheet", 1280, 900],
	["canvas-workspace--code", 1280, 900],
	["canvas-workspace--code-focused", 1280, 900],
	["canvas-workspace--files", 1280, 900],
	["canvas-workspace--variables", 1280, 900],
	["canvas-workspace--diff-review", 1280, 900],
	["canvas-workspace--edit-prompt", 1280, 900],

	["agent-hub-page--grid", 1280, 900],
	["schedules-page--list", 1280, 900],
	["schedules-page--picker-open", 1280, 900],
	["command-palette-commandpalette--default", 1280, 800],
	["command-palette-commandpalette--no-results", 1280, 800],

	["onboarding-onboardingmodal--default", 1280, 900],
	["onboarding-onboardingmodal--radient-sign-in", 1280, 900],
	["onboarding-onboardingmodal--create-agent", 1280, 900],
	["onboarding-onboardingmodal--congratulations", 1280, 900],

	/* 1380x800 is what the story declares and what the app window ships. */
	["installer-installercontent--default", 1380, 800],
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

/*
 * Teardown has to survive a throw.
 *
 * Chrome used to be killed only on the success path, so any failure exited
 * with the browser still running and its profile still on disk. That was
 * survivable while the script had almost no failure modes; adding the loud
 * gates - unknown story id, theme mismatch, story did not render - made the
 * leak reachable, and one aborted run left eighteen processes and a profile
 * behind on a machine already under memory pressure. Making a script fail
 * loudly obliges you to make it fail cleanly.
 */
let chrome = null;
let dataDir = null;

const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, { recursive: true, force: true });
		dataDir = null;
	}
};

const main = async () => {
	dataDir = join(tmpdir(), `lo-evidence-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(CHROME, [
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

	/*
	 * Every id in STORIES must exist before a single frame is taken.
	 *
	 * Storybook answers an unknown id with a rendered "not found" view rather
	 * than an error, and that view leaves the previous document's theme on the
	 * element - so a typo in an id surfaced as a confusing theme-mismatch
	 * failure on the FOLLOWING theme, pointing at the story system instead of
	 * at the id. Three ids in this list were wrong (they had been derived from
	 * a fixture filename rather than the story's own title) and this is what
	 * that cost. Checking the manifest first names the bad id directly.
	 */
	const index = await fetch(`${ORIGIN}/index.json`).then((r) => r.json());
	const known = new Set(Object.keys(index.entries ?? {}));
	const unknown = [...new Set(STORIES.map(([id]) => id))].filter(
		(id) => !known.has(id),
	);
	if (unknown.length > 0) {
		throw new Error(
			`unknown story id(s): ${unknown.join(", ")}. ` +
				`Check ${ORIGIN}/index.json for the real ids.`,
		);
	}
	rmSync(OUT, { recursive: true, force: true });

	/* zustand persist key for the UI preferences store. */
	const PREFS_KEY = "ui-preferences-storage";
	let seedScript = null;
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
			 * The theme is driven ONLY by the story arg.
			 *
			 * `.storybook/preview.tsx` wraps every story in one frame that reads
			 * `args.theme` and moves all three halves of the bridge together:
			 * the MUI theme object through context (MUI bakes palette values
			 * into Emotion classes as literal hexes when `createBaseTheme` runs,
			 * so it needs the object, not an attribute), `data-theme` plus the
			 * `dark` class on the document element for the Tailwind role
			 * utilities, and the preferences store for the components that read
			 * the palette from there. The arg is declared at preview level, so
			 * every story has it and none can ignore it.
			 *
			 * This used to be three mechanisms at once — seeding
			 * `ui-preferences-storage` before load, passing the arg, then poking
			 * `data-theme` and `dark` afterwards — because only eight of the
			 * fifteen story files implemented a theme decorator and the other
			 * seven rendered the default palette whatever was asked for. Two of
			 * those three could disagree, and did: the hardcoded light-theme
			 * list used by the last step had `dune` (a dark palette) in it and
			 * was missing `iceberg` (a light one), so every Dune and Iceberg
			 * frame was captured with the wrong `dark` class. One source cannot
			 * disagree with itself.
			 */
			await cdp.send("Page.navigate", { url: "about:blank" });
			await sleep(150);

			/*
			 * Seed the persisted preferences store before any app script runs.
			 *
			 * The theme arg drives the preview frame, but `useUiPreferencesStore`
			 * is a zustand store persisted to localStorage, and localStorage
			 * outlives the document. Components that read the theme from the
			 * store rather than from `data-theme` therefore rehydrated to
			 * whatever the previous frame left behind - the canvas surface stayed
			 * on the first theme captured while the attribute said otherwise, so
			 * every canvas frame after the first would have been named for a
			 * theme it was not showing.
			 *
			 * This runs on every new document, before app code, so the store's
			 * rehydration and the arg agree from the first paint instead of
			 * racing. It is re-registered per frame because the payload carries
			 * the theme.
			 */
			if (seedScript) {
				await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
					identifier: seedScript,
				});
			}
			({ identifier: seedScript } = await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{
					source: `try { localStorage.setItem(${JSON.stringify(PREFS_KEY)}, JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch {}`,
				},
			));

			await cdp.send("Page.navigate", {
				url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
			});
			await sleep(900);

			/* Assert the frame really is the theme this file is about to be
			   named after, rather than trusting the navigation. A mis-named
			   evidence file is worse than a missing one.

			   Polled rather than read once: the theme is applied by a decorator
			   effect, and a heavy story - the canvas mounts ag-grid and
			   CodeMirror - can still be mounting when a single read lands. A
			   fixed sleep long enough for the slowest story would be paid by
			   all 372 frames, so wait for the condition instead of for a
			   duration. The throw still fires if it never becomes true. */
			let applied = "";
			for (let attempt = 0; attempt < 40; attempt++) {
				const { result } = await cdp.send("Runtime.evaluate", {
					returnByValue: true,
					expression: "document.documentElement.dataset.theme || ''",
				});
				applied = result.value;
				if (applied === theme) break;
				await sleep(250);
			}
			if (applied !== theme) {
				throw new Error(
					`${story} @ ${theme}: document carries theme "${applied}" after 10s`,
				);
			}

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
			   whole evidence set was once captured that way.

			   Emptiness is measured in ELEMENTS, not characters. A text-length
			   threshold rejected the inline-edit story, which is legitimately
			   almost wordless - a textarea whose prompt lives in a placeholder,
			   and icon buttons. Placeholders are not innerText. An unrendered
			   story has no elements; an error page has plenty of text, which is
			   what the pattern test above is for. */
			const { result: sane } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const t = document.body.innerText || "";
					if (/Configuration validation failed|no stories|Story not found/i.test(t)) return "storybook-error";
					/* Count from body, not from #storybook-root: dialogs, sheets
					   and the command palette render through a portal appended to
					   body, so a root-only count reports a fully rendered modal as
					   empty. */
					if (document.body.querySelectorAll("*").length < 8) return "empty";
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
			/*
			 * A story captured at several widths writes one directory per width,
			 * so a sweep does not overwrite itself. Single-width stories keep the
			 * plain path, which keeps every existing frame reference valid.
			 */
			const widths = STORIES.filter(([s]) => s === story);
			const leaf =
				widths.length > 1
					? `${story.split("--")[1]}@${width}`
					: story.split("--")[1];
			const dir = join(OUT, story.split("--")[0], leaf);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, `${theme}.webp`), Buffer.from(data, "base64"));
			captured++;
		}
	}

	console.log(`Captured ${captured} frames into ${OUT}`);
};

/* Also covers Ctrl-C and a kill, which a try/finally alone does not. */
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => {
		teardown();
		process.exit(130);
	});
}

try {
	await main();
} catch (err) {
	console.error(err);
	process.exitCode = 1;
} finally {
	teardown();
}
