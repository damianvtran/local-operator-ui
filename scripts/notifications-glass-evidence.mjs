#!/usr/bin/env node
/**
 * The Notifications surface's glass composition, as frames and as numbers.
 *
 *     node scripts/with-storybook.mjs -- \
 *       node scripts/notifications-glass-evidence.mjs --out <dir>
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT `capture-evidence.mjs`. The swept library
 * photographs a story once per theme from a fixed list of args. This run needs
 * three things that rig does not model: a matrix of glass-intensity x theme x
 * contrast ARGS per frame; the SAME frame twice - once as the tree paints it and
 * once with the two glass attributes removed, which is what the base tree
 * rendered, because those attributes are the whole diff on this surface; and one
 * frame scrolled so a row is passing under a pinned header. It writes PNGs plus a
 * readback JSON to the caller's directory and nothing else.
 *
 * WHAT IT MEASURES, and why a frame alone is not enough. "The header is a layer,
 * not a slab" is a claim about an alpha and a `backdrop-filter`; "the rows scroll
 * under it" is a claim about one rect that moves while another does not. Both
 * are read here from the same live DOM as the pixels.
 *
 * THE GLASS IS THE APP'S OWN PAINT PATH, not a rig invention: Storybook's `glass`
 * arg calls `applyGlassFacts` - the function main's launch fact reaches in the
 * shipped app - and the harness paints the measured under-window backdrop tone
 * behind it (`.storybook/preview.tsx`, "DOM proof, not native"). A browser
 * document has no OS material, so these frames are evidence about the
 * COMPOSITION (what the app paints over whatever it is given), never about macOS
 * vibrancy; the real window is QA's native lane.
 *
 * NOTHING TOUCHES THE OPERATOR'S SCREEN. Chrome runs `--headless=new` with its
 * own `--user-data-dir` and `--use-mock-keychain` (a scratch profile must never
 * reach Keychain Services), and the process group is reaped by exact pid through
 * `app-tree-teardown.mjs` in a `finally`, on every exit path.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopAppTree } from "./app-tree-teardown.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const argOf = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const outDir = argOf(
	"out",
	join(repoRoot, "docs", "pr-evidence", "notifications-glass"),
);
/** Narrow the matrix while iterating: `--only dark-80,dark-80-scrolled`. */
const only = argOf("only")?.split(",").filter(Boolean);
const origin = process.env.STORYBOOK_ORIGIN ?? "http://localhost:6017";
/** The reported frame's own size, so the pair lines up with the operator's
 * screenshot rather than only with itself. */
const VIEW = { width: 1024, height: 657 };
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const STORY = "notifications-page--populated";

/** A free loopback port, asked of the OS rather than picked by hand. */
const freePort = () =>
	new Promise((resolve) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});

/*
 * THE MATRIX. `glass` is Storybook's own arg, which calls `applyGlassFacts`;
 * `glassContrast` composes a NON-STANDARD contrast preset through the same
 * appearance store the Settings page writes (`AppearanceLayerFrame`), so the
 * "every contrast setting" half of the report is driven by the product's own
 * path rather than by a hand-set palette.
 */
const CELLS = [
	{ name: "dark-80", theme: "localOperatorDark", intensity: 80 },
	{ name: "dark-50", theme: "localOperatorDark", intensity: 50 },
	{ name: "light-80", theme: "localOperatorLight", intensity: 80 },
	{ name: "light-50", theme: "localOperatorLight", intensity: 50 },
	{
		name: "dark-80-contrast-high",
		theme: "localOperatorDark",
		intensity: 80,
		contrast: 80,
	},
	{
		name: "dark-80-contrast-soft",
		theme: "localOperatorDark",
		intensity: 80,
		contrast: -80,
	},
	{ name: "dark-80-glass-off", theme: "localOperatorDark", glass: "off" },
	{ name: "light-80-glass-off", theme: "localOperatorLight", glass: "off" },
	{
		name: "dark-80-scrolled",
		theme: "localOperatorDark",
		intensity: 80,
		scroll: 160,
	},
];

const urlFor = (cell) => {
	const args = [
		`theme:${cell.theme}`,
		`glass:${cell.glass ?? "on"}`,
		`glassIntensity:${cell.intensity ?? 80}`,
		/* ALWAYS, including the standard case: the appearance store PERSISTS the
		 * last composed contrast, so a cell that omitted the arg inherited the
		 * previous cell's preset and its re-derived floors (measured: `dark-80` read
		 * the 0.86 floor of a `-80` composition that had run two cells earlier). */
		`glassContrast:${cell.contrast ?? 0}`,
	].join(";");
	return `${origin}/?path=/story/${STORY}&viewMode=story&full=1&args=${args}`;
};

/** Everything the frames cannot show: the alphas, the blur, the geometry. */
const READBACK = `((frame) => {
	const alpha = (c) => {
		if (!c || c === "transparent") return 0;
		let m = c.match(/^rgba?\\(([^)]+)\\)$/);
		if (m) { const p = m[1].split(/[,\\/]\\s*|\\s+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; }
		m = c.match(/^color\\(srgb ([^)]+)\\)$/);
		if (m) { const p = m[1].split("/"); return p.length > 1 ? Number(p[1]) : 1; }
		return 1;
	};
	const document = frame.document;
	const root = frame.getComputedStyle(document.documentElement);
	const sheetVar = (n) => Number(root.getPropertyValue(n).trim() || "NaN");
	const band = document.querySelector('[data-glass-plane="band-backdrop"]');
	const port = document.querySelector("[data-notifications-list]");
	const track = document.querySelector('[role="radiogroup"][data-glass-well]');
	const selected = track?.querySelector('[role="radio"][aria-checked="true"]') ?? null;
	const rows = [...document.querySelectorAll("[data-notification-row]")];
	const bandRect = band?.getBoundingClientRect();
	const under = band && rows.find((r) => {
		const rb = r.getBoundingClientRect();
		const bb = band.getBoundingClientRect();
		return rb.top < bb.bottom - 1 && rb.bottom > bb.bottom + 1;
	});
	return {
		glass: document.documentElement.dataset.glass ?? null,
		theme: document.documentElement.dataset.theme ?? null,
		vars: {
			canvas: sheetVar("--lo-glass-a-canvas"),
			elevated: sheetVar("--lo-glass-a-elevated"),
			bandFloor: sheetVar("--lo-glass-a-band-floor"),
			field: sheetVar("--lo-glass-a-field"),
			selected: sheetVar("--lo-glass-a-row-selected"),
		},
		band: band ? {
			alpha: alpha(frame.getComputedStyle(band).backgroundColor),
			bg: frame.getComputedStyle(band).backgroundColor,
			backdropFilter: frame.getComputedStyle(band).backdropFilter,
			position: frame.getComputedStyle(band).position,
			height: Math.round(bandRect.height),
			top: Math.round(bandRect.top),
		} : null,
		port: port ? { top: Math.round(port.getBoundingClientRect().top), scrollTop: Math.round(port.scrollTop) } : null,
		track: track ? { alpha: alpha(frame.getComputedStyle(track).backgroundColor), bg: frame.getComputedStyle(track).backgroundColor } : null,
		selected: selected ? { alpha: alpha(frame.getComputedStyle(selected).backgroundColor), bg: frame.getComputedStyle(selected).backgroundColor } : null,
		rows: rows.length,
		underBand: under ? Math.round(under.getBoundingClientRect().top) : null,
		headerText: band ? (band.textContent || "").trim().slice(0, 40) : null,
	};
})(document.getElementById("storybook-preview-iframe").contentWindow)`;

/** Inside the preview iframe, like every other probe. */
const inFrame = (body) =>
	`((frame) => { const document = frame.document; ${body} })(document.getElementById("storybook-preview-iframe").contentWindow)`;
const dropGlassMarks = inFrame(
	`[...document.querySelectorAll('[data-glass-plane="band-backdrop"]')].forEach((n) => n.removeAttribute("data-glass-plane"));
	[...document.querySelectorAll('[data-glass-well]')].forEach((n) => n.removeAttribute("data-glass-well")); return true;`,
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(port) {
	let target = null;
	for (let i = 0; i < 200 && !target; i++) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
			target = list.find((t) => t.type === "page");
		} catch {
			/* not up yet */
		}
		if (!target) await wait(100);
	}
	if (!target) throw new Error("Chrome never exposed a page target");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r, { once: true }));
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (m) => {
		const data = JSON.parse(m.data);
		const resolve = pending.get(data.id);
		if (!resolve) return;
		pending.delete(data.id);
		resolve(data);
	});
	const send = (method, params = {}) =>
		new Promise((resolve) => {
			const n = ++id;
			pending.set(n, (data) =>
				data.error ? resolve({ __error: data.error }) : resolve(data.result),
			);
			ws.send(JSON.stringify({ id: n, method, params }));
		});
	const ev = async (expression) => {
		const r = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.__error) throw new Error(JSON.stringify(r.__error).slice(0, 300));
		if (r.exceptionDetails)
			throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
		return r.result?.value;
	};
	return { send, ev };
}

async function main() {
	mkdirSync(outDir, { recursive: true });
	const port = await freePort();
	const userDataDir = join(
		process.env.TMPDIR ?? "/tmp",
		`notif-glass-evidence-${process.pid}`,
	);
	const chrome = spawn(
		CHROME,
		[
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			"--use-mock-keychain",
			`--window-size=${VIEW.width},${VIEW.height}`,
			`--user-data-dir=${userDataDir}`,
			`--remote-debugging-port=${port}`,
			"about:blank",
		],
		{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
	);
	let reaped = null;
	try {
		const cdp = await connect(port);
		await cdp.send("Page.enable");
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			...VIEW,
			deviceScaleFactor: 1,
			mobile: false,
		});
		const shots = [];
		for (const cell of CELLS.filter((c) => !only || only.includes(c.name))) {
			console.log(`[notif-glass] ${cell.name}: driving ${urlFor(cell)}`);
			await cdp.send("Page.navigate", { url: urlFor(cell) });
			/* The story paints its glass in a layout effect; `data-glass` on the
			 * document element is that commit's own witness, so readiness is read
			 * from the surface rather than waited out. */
			let ready = false;
			for (let i = 0; i < 400 && !ready; i++) {
				/* The dev server rebuilds the manager after a stylesheet edit and the first
				 * visit can sit on Storybook's own loader; one hard reload at the halfway
				 * mark turns a slow rebuild into a frame instead of a run that fails. */
				if (i === 200) await cdp.send("Page.reload", { ignoreCache: true });
				/* THE STORY LIVES IN THE MANAGER'S PREVIEW IFRAME, and it is same-origin,
				 * so the preview's own document is reachable from this page: evaluate
				 * through it. (A bare `iframe.html` load waits for the manager's
				 * `setCurrentStory` forever - measured - so the manager URL is the only
				 * way a story mounts headless here.) The early probes land on the
				 * OUTGOING document, so readiness is asked defensively. */
				ready = await cdp
					.ev(
						`(() => {
							const f = document.getElementById("storybook-preview-iframe");
							const d = f && f.contentDocument;
							const framed = d && d.querySelector("[data-notifications-list]");
							/* The OFF cell is the OPAQUE look: data-glass is absent
							 * there by design, so its readiness is the page itself. */
							const painted = ${JSON.stringify(cell.glass)} === "off"
								? !!framed
								: !!framed && d.documentElement.dataset.glass !== undefined;
							return painted && f.getBoundingClientRect().height > 200;
						})()`,
					)
					.catch(() => false);
				if (!ready) await wait(150);
			}
			if (!ready) {
				const diag = await cdp
					.ev(
						`JSON.stringify({
							href: location.href,
							state: document.readyState,
							glass: document.documentElement?.dataset.glass ?? "<unset>",
							text: (document.body?.innerText ?? "").slice(0, 200),
							hasPage: !!document.querySelector("[data-notifications-page]"),
							hasList: !!document.querySelector("[data-notifications-list]"),
						})`,
					)
					.catch((error) => `probe failed: ${error.message}`);
				throw new Error(`${cell.name}: the story never painted :: ${diag}`);
			}
			await wait(400);
			if (cell.scroll)
				await cdp.ev(
					inFrame(
						`document.querySelector("[data-notifications-list]").scrollTo({ top: ${cell.scroll} }); return true;`,
					),
				);
			await wait(400);
			/* THE FRAME IS THE STORY, not the manager: the preview iframe's own box is the
			 * clip, so no Storybook chrome appears in a committed frame. */
			const clip = await cdp.ev(
				`(() => { const r = document.getElementById("storybook-preview-iframe").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), scale: 1 }; })()`,
			);
			const shot = async (suffix) => {
				const r = await cdp.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
					clip,
				});
				const file = join(outDir, `${cell.name}${suffix}.png`);
				writeFileSync(file, Buffer.from(r.data, "base64"));
				return file;
			};
			const after = await shot("");
			const afterRead = await cdp.ev(READBACK);
			/* The before half: the two glass attributes are the whole of the
			 * surface's diff, so removing them renders exactly what the base tree
			 * rendered at the same args - same build, same story, same frame. */
			await cdp.ev(dropGlassMarks);
			await wait(250);
			const before = await shot("-before");
			const beforeRead = await cdp.ev(READBACK);
			shots.push({
				cell: cell.name,
				url: urlFor(cell),
				frames: { after, before },
				after: afterRead,
				before: beforeRead,
			});
			console.log(
				`[notif-glass] ${cell.name}: band alpha ${afterRead.band?.alpha ?? "none"} (floor ${afterRead.vars.bandFloor}, elevated ${afterRead.vars.elevated}) blur ${afterRead.band?.backdropFilter ?? "none"} · track ${afterRead.track?.alpha ?? "none"} (field ${afterRead.vars.field}) · selected ${afterRead.selected?.alpha ?? "none"} (row-selected ${afterRead.vars.selected}) · before band ${beforeRead.band?.alpha ?? "none"} track ${beforeRead.track?.alpha ?? "none"}`,
			);
		}
		writeFileSync(
			join(outDir, "readback.json"),
			`${JSON.stringify({ view: VIEW, origin, shots }, null, 2)}\n`,
		);
	} finally {
		reaped = stopAppTree({
			pid: chrome.pid,
			userData: userDataDir,
			isExited: () => chrome.exitCode !== null,
		});
		await reaped;
	}
}

main().catch((error) => {
	console.error(`[notif-glass] ${error.stack ?? error}`);
	process.exitCode = 1;
});
