#!/usr/bin/env node
/**
 * Captures the docs-library screenshot set from Storybook, one 2560x1800 png
 * per scene per theme.
 *
 *     node scripts/capture-docs-library.mjs [origin] \
 *         [--only=hero,teams] [--themes=light,dark] [--out=<dir>]
 *
 * Default origin is http://localhost:6129 (the capture checkout's own
 * Storybook). The default output directory is `docs-library-captures/` beside
 * the repository root.
 *
 * WHY THIS EXISTS, RATHER THAN REUSING `capture-evidence.mjs`. That tool
 * captures at `deviceScaleFactor: 1` with a per-story size table, because its
 * frames are review evidence at 1x. This set targets the marketing site and
 * both READMEs, which want the hero's own format - a 1280x900 viewport at
 * `deviceScaleFactor: 2`, i.e. a 2560x1800 png - for every scene. The
 * mechanics are the same ones that tool proved: a PRIVATE headless Chrome
 * (fresh `--user-data-dir`, `--use-mock-keychain`, a port Chrome picks), raw
 * CDP over Node's built-in WebSocket, `data-capture-pending` as the shutter
 * hold, `document.fonts.status` as the webfont gate, and an
 * `animation: none` freeze before the shot so a frame is a function of its
 * story rather than of the instant it was taken.
 *
 * THE THEME ARG IS THE ONLY SOURCE OF THEME. `.storybook/preview.tsx` reads
 * `args.theme` and moves MUI context, `data-theme` and the preferences store
 * together; this rig additionally seeds the preferences store's persisted blob
 * before app code runs, so a component that rehydrates from storage agrees
 * with the arg from the first paint. The key is DISCOVERED from the page
 * (the one key whose value parses as `{state:{themeName}}`) rather than
 * hardcoded, because a renamed store must not silently unseed every frame.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;

/** Scene name (used in file names) -> story id. */
const SCENES = [
	["hero", "docs-app-hero--scene"],
	["conversation-tools", "docs-library--conversation-tools"],
	["subagents", "docs-library--subagents"],
	["teams", "docs-library--teams"],
	["agents", "docs-library--agents"],
	["projects", "docs-library--projects"],
	["schedules", "docs-library--schedules"],
	["agent-hub", "docs-library--agent-hub"],
	["mesh", "docs-library--mesh"],
	["media-in-conversation", "docs-library--media-in-conversation"],
	["appearance", "docs-library--appearance"],
	["chat-trace", "docs-library--chat-trace"],
];

/** CLI alias -> the registry's palette id. */
const THEMES = { light: "localOperatorLight", dark: "localOperatorDark" };

const ARGS = process.argv.slice(2);
const flag = (name) => {
	const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : null;
};
const ORIGIN = ARGS.find((a) => !a.startsWith("--")) ?? "http://localhost:6129";
const ONLY = flag("only")?.split(",").filter(Boolean) ?? null;
const THEME_FILTER = flag("themes")?.split(",").filter(Boolean) ?? [
	"light",
	"dark",
];
const OUT = flag("out") ?? join(ROOT, "docs-library-captures");
const WIDTH = Number(flag("width") ?? 1280);
const HEIGHT = Number(flag("height") ?? 900);
const SCALE = Number(flag("scale") ?? 2);
/*
 * How long a story may take to become ready. The first load of each story
 * compiles its (large) module graph through vite's dev server, and this host
 * runs ~25 concurrent agent sessions, so a cold first load has been measured
 * above 60 s; a warm one finishes in ~15 s. 180 s is the cold budget.
 */
const WAIT_MS = Number(flag("wait-ms") ?? 180_000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal CDP client over the built-in WebSocket. */
class Cdp {
	#ws;
	#id = 0;
	#pending = new Map();
	constructor(ws) {
		this.#ws = ws;
		ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			const entry = this.#pending.get(message.id);
			if (!entry) return;
			this.#pending.delete(message.id);
			if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
			else entry.resolve(message.result ?? {});
		});
	}
	send(method, params = {}) {
		const id = ++this.#id;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#ws.send(JSON.stringify({ id, method, params }));
		});
	}
}

const evaluate = async (cdp, expression) => {
	const { result } = await cdp.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
	});
	return result?.value;
};

const main = async () => {
	const scenes = SCENES.filter(([name]) => !ONLY || ONLY.includes(name));
	const themes = THEME_FILTER.map((alias) => {
		const id = THEMES[alias];
		if (!id)
			throw new Error(`--themes names ${alias}, which is not light or dark`);
		return [alias, id];
	});
	if (scenes.length === 0) throw new Error("--only matched no scene");
	mkdirSync(OUT, { recursive: true });

	const dataDir = mkdtempSync(join(tmpdir(), "lo-docs-lib-"));
	const chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"--password-store=basic",
			"--no-first-run",
			"--no-default-browser-check",
			"about:blank",
		]),
		{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
	);

	/* Chrome prints the DevTools websocket on stderr; reading it there avoids
	   the DevToolsActivePort file race. */
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (chunk) => {
			buf += chunk.toString();
			const match = buf.match(DEBUG_PORT_LINE);
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
	const targets = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = targets.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");

	let seedScript = null;
	let prefsKey = null;
	const report = [];
	const failures = [];

	try {
		for (const [scene, story] of scenes) {
			for (const [themeAlias, theme] of themes) {
				const started = Date.now();
				try {
					await cdp.send("Emulation.setDeviceMetricsOverride", {
						width: WIDTH,
						height: HEIGHT,
						deviceScaleFactor: SCALE,
						mobile: false,
					});
					await cdp.send("Emulation.setFocusEmulationEnabled", {
						enabled: true,
					});
					/* Park the pointer, so a tooltip opened by the previous frame's
				   coordinates cannot leak into this one. */
					await cdp.send("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						x: WIDTH - 2,
						y: HEIGHT - 2,
						button: "none",
						buttons: 0,
						clickCount: 0,
						modifiers: 0,
						pointerType: "mouse",
					});

					if (prefsKey) {
						if (seedScript) {
							await cdp.send("Page.removeScriptToEvaluateOnNewDocument", {
								identifier: seedScript,
							});
						}
						({ identifier: seedScript } = await cdp.send(
							"Page.addScriptToEvaluateOnNewDocument",
							{
								source: `try { localStorage.clear(); localStorage.setItem(${JSON.stringify(prefsKey)}, JSON.stringify({ state: { themeName: ${JSON.stringify(theme)} }, version: 0 })); } catch {}`,
							},
						));
					}

					await cdp.send("Page.navigate", {
						url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
					});
					await sleep(700);

					/* The readiness gate: the story is drawn, no font is still
				   loading, the story is not showing Storybook's preparation
				   furniture, and any `data-capture-pending` hold is released.
				   Polled, never slept-for, because a heavy page varies by
				   seconds and a fixed sleep long enough for the slowest scene
				   would be paid by all 24 frames. */
					let probe = null;
					let ready = false;
					let waited = 0;
					for (; waited < WAIT_MS && !ready; waited += 250) {
						probe = await evaluate(
							cdp,
							`(() => {
							const loading = [...document.querySelectorAll(".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader")].some((el) => el.getBoundingClientRect().height > 0);
							const pending = Boolean(document.documentElement.dataset.capturePending);
							const fonts = document.fonts.status;
							const root = document.getElementById("storybook-root");
							const errorDisplay = document.querySelector(".sb-errordisplay");
							const errored = document.body.classList.contains("sb-show-errordisplay") || Boolean(errorDisplay && errorDisplay.getBoundingClientRect().height > 0);
							return {
								theme: document.documentElement.dataset.theme || "",
								loading, pending, fonts, errored,
								count: root ? root.querySelectorAll("*").length : 0,
								title: errored
									? (errorDisplay?.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 300)
									: null,
							};
						})()`,
						);
						if (probe?.errored) {
							throw new Error(
								`${scene} @ ${theme}: Storybook is showing its error display: ${probe.title}`,
							);
						}
						ready =
							probe &&
							!probe.loading &&
							!probe.pending &&
							probe.fonts === "loaded" &&
							probe.count > 2 &&
							probe.theme === theme;
						if (!ready) await sleep(250);
					}
					if (!ready) {
						throw new Error(
							`${scene} @ ${theme}: never became ready; last probe ${JSON.stringify(probe)}`,
						);
					}

					if (!prefsKey) {
						/* Discover the preferences store's persisted key for the
					   seed script: the one localStorage value shaped
					   `{state:{themeName}}`. */
						prefsKey = await evaluate(
							cdp,
							`(() => {
							for (const key of Object.keys(localStorage)) {
								try {
									const value = JSON.parse(localStorage.getItem(key));
									if (value && value.state && typeof value.state.themeName === "string") return key;
								} catch {}
							}
							return null;
						})()`,
						);
					}

					/* Two consecutive ready readings, then the freeze. The second
				   reading catches a scene whose hold drops and is then reset by
				   a follow-up effect (or a still-running play), and refuses the
				   frame when a scene's own hold timed out on a state it could not
				   stage (`data-capture-failed`). */
					await sleep(400);
					const settled = await evaluate(
						cdp,
						`(() => {
						const failed = document.documentElement.dataset.captureFailed || "";
						if (failed) return "failed: " + failed;
						return !Boolean(document.documentElement.dataset.capturePending) && document.fonts.status === "loaded" ? "ok" : "held";
					})()`,
					);
					if (settled !== "ok") {
						throw new Error(`${scene} @ ${theme}: not settled (${settled})`);
					}

					await evaluate(
						cdp,
						`(() => {
						const s = document.createElement("style");
						s.textContent = "*,*::before,*::after{animation:none !important;transition:none !important}*:not(textarea){caret-color:transparent !important}";
						document.head.appendChild(s);
					})()`,
					);
					await sleep(150);

					const { data } = await cdp.send("Page.captureScreenshot", {
						format: "png",
					});
					const file = join(OUT, `${scene}-${themeAlias}.png`);
					writeFileSync(file, Buffer.from(data, "base64"));
					const elapsed = Date.now() - started;
					report.push({ scene, theme: themeAlias, file, elapsed });
					console.log(
						`captured ${scene}-${themeAlias}.png  ${elapsed} ms  ${Buffer.byteLength(data, "base64")} bytes`,
					);
				} catch (error) {
					failures.push({ scene, theme: themeAlias, error: error.message });
					console.error(`FAILED ${scene} @ ${themeAlias}: ${error.message}`);
				}
			}
		}
		if (failures.length > 0) {
			console.error(`${failures.length} frame(s) FAILED:`);
			for (const failure of failures) {
				console.error(
					`  - ${failure.scene} @ ${failure.theme}: ${failure.error}`,
				);
			}
			process.exitCode = 1;
		}
	} finally {
		/* Teardown: the browser owns a process group (spawn detached), so the
		   whole tree goes down together; the profile is removed; and the
		   caller can assert `pgrep -f lo-docs-lib` is empty afterwards. */
		try {
			process.kill(-chrome.pid, "SIGTERM");
		} catch {}
		await sleep(1500);
		try {
			process.kill(-chrome.pid, "SIGKILL");
		} catch {}
		try {
			rmSync(dataDir, { recursive: true, force: true });
		} catch {}
	}

	console.log(`\n${report.length} frames -> ${OUT}`);
};

main().catch((error) => {
	console.error(`capture-docs-library: ${error.message}`);
	process.exitCode = 1;
});
