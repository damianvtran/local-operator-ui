#!/usr/bin/env node
/**
 * The Notifications surface's glass composition, as frames and as numbers, taken
 * from the BUILT APP.
 *
 *     node scripts/notifications-glass-evidence.mjs \
 *       --repo <built checkout> --out <dir> --label <name> --case <cell> \
 *       --config <isolated core config dir>
 *
 * WHY THE APP AND NOT A STORY. The first version of this rig drove the
 * `Notifications/Page` story through Storybook, and the frames it produced could
 * not show the defect the operator reported (design review round 1, D1): the
 * harness page paints its own opaque canvas, so a band at alpha 1.0 over it and a
 * band at the glass floor over it came out as the same picture - the pair was
 * byte-identical in three of nine cells. The claim under test is about
 * COMPOSITION over a translucent column, so the evidence has to be the real
 * window: the app's own shell, its own `<main>` backing at the user's alpha, its
 * own rows. That is what this drives.
 *
 * WHAT A FRAME HERE MAY STILL NOT CLAIM. A headless window has no compositor
 * backdrop, so the desktop behind it is the app's own black - these frames are
 * evidence about the composition the app paints (alphas, blur, geometry, the
 * step between the band and the page), never about macOS vibrancy behind a real
 * wallpaper. The native lane is QA's.
 *
 * THE BASE HALF IS A REAL BASE BUILD, not a guess: pass `--repo` a checkout of
 * the base commit and the same cells are captured from it. `--before-attributes`
 * additionally captures the same frame twice in ONE build with the two glass
 * attributes removed (`data-glass-plane` on the header, `data-glass-well` on the
 * switch track), which is what the base tree rendered for this surface - useful
 * as a control that the attributes, not some other difference, are the change.
 *
 * THE LANE NEEDS ROWS. A group header only exists when notifications do, so the
 * app must be pointed at a core config directory holding at least one
 * notification (`--config`; `LOCAL_OPERATOR_CONFIG_DIR`). This script fails with
 * the seeding recipe rather than photographing an empty page.
 *
 * NOTHING TOUCHES THE OPERATOR'S SCREEN. Electron runs `--window-mode=headless`
 * with a per-run `--user-data-dir`, `--use-mock-keychain` (a scratch profile must
 * never reach Keychain Services), the notification and telemetry switches, and
 * `HOME` redirected; `CMUX_*` and `XPC_FLAGS` are stripped. The process group is
 * reaped by exact pid through `app-tree-teardown.mjs` in a `finally`, on every
 * exit path.
 */

import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reapOnExit, stopAppTree } from "./app-tree-teardown.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const argOf = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : fallback;
};
const appRepo = resolve(argOf("repo", repoRoot));
const outDir = resolve(
	argOf("out", join(repoRoot, "docs", "pr-evidence", "notifications-glass")),
);
const label = argOf("label", "frame");
/* One cell per invocation (`--case`, the matrix runner's flag) or a subset
 * (`--only`). Both narrow the SAME list; a run that names no cell photographs the
 * whole matrix, which is what a bare invocation is for. */
const only = (argOf("case") ?? argOf("only"))?.split(",").filter(Boolean);
const configDir = argOf("config", null);
const keepBefore = process.argv.includes("--before-attributes");
/** The operator's own viewport, so a frame lines up with the reported screenshot. */
const VIEW = { width: 1024, height: 657 };
const ROUTE = "#/notifications";

/**
 * THE MATRIX: the two schemes at both ends of the shipped intensity slider, the
 * opaque fallback, and the scroll-under state with its 1:1 band crop.
 *
 * NO CONTRAST-PRESET CELL, and the reason is the product's, not the rig's: the v5
 * contrast field has no writer in the shipped app yet
 * (`src/renderer/src/shared/themes/appearance.ts` records the same status - "no
 * setting writes the v5 contrast/accent fields yet"), so a preset can only be
 * reached by seeding the store. That seed does compose (`data-theme` becomes
 * `lo-<hash>`), but it did not survive reliably in this headless lane, and a cell
 * that sometimes photographs Standard under a preset's name is worse than no
 * cell. The preset's numbers are carried by the derivation instead
 * (`src/shared/glass-derivation.mjs`, `deriveBandFloor`), which the README quotes.
 */
const CELLS = [
	{ name: "dark-80", theme: "localOperatorDark", intensity: 80 },
	{ name: "dark-50", theme: "localOperatorDark", intensity: 50 },
	{ name: "light-80", theme: "localOperatorLight", intensity: 80 },
	{ name: "light-50", theme: "localOperatorLight", intensity: 50 },
	{ name: "dark-80-glass-off", theme: "localOperatorDark", glass: false },
	{
		name: "dark-80-scrolled",
		theme: "localOperatorDark",
		intensity: 80,
		scroll: 48,
		crop: true,
	},
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
	new Promise((res) => {
		const srv = createServer();
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => res(port));
		});
	});
async function until(fn, ms, what) {
	const t = Date.now();
	for (;;) {
		let v;
		try {
			v = await fn();
		} catch {
			v = null;
		}
		if (v) return v;
		if (Date.now() - t > ms) throw new Error(`timeout: ${what}`);
		await wait(200);
	}
}

/** The page-side readback: every number a PNG cannot carry. */
const READBACK = `(() => {
  const alpha = (c) => {
    if (!c || c === "transparent") return 0;
    let m = c.match(/^rgba?\\(([^)]+)\\)$/);
    if (m) { const p = m[1].split(/[,\\/]\\s*|\\s+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; }
    m = c.match(/^color\\(srgb ([^)]+)\\)$/);
    if (m) { const p = m[1].split("/"); return p.length > 1 ? Number(p[1]) : 1; }
    return 1;
  };
  const root = getComputedStyle(document.documentElement);
  const v = (n) => { const raw = root.getPropertyValue(n).trim(); return raw === "" ? null : raw; };
  const page = document.querySelector("[data-notifications-page]");
  const header = document.querySelector('[data-notification-group] [role="row"]');
  const h = header ? getComputedStyle(header) : null;
  const label = header?.querySelector('[role="rowheader"]');
  const count = label?.querySelector("span.tabular-nums") ?? null;
  const track = page?.querySelector('[class~="bg-sunken"][data-glass-well]');
  const checked = track?.querySelector('[role="radio"][aria-checked="true"]');
  const t = track ? getComputedStyle(track) : null;
  const backing = document.querySelector('main[data-glass-region="canvas-backing"]');
  const b = backing ? getComputedStyle(backing) : null;
  const r = (el) => { if (!el) return null; const x = el.getBoundingClientRect(); return { x: Math.round(x.x), y: Math.round(x.y), w: Math.round(x.width), h: Math.round(x.height) }; };
  return {
    dpr: devicePixelRatio,
    viewport: { w: innerWidth, h: innerHeight },
    theme: document.documentElement.dataset.theme,
    /* What the profile ACTUALLY holds, so a cell that silently booted another
     * appearance is visible in the readback instead of only in its pixels. */
    prefs: (() => {
      try {
        const blob = JSON.parse(localStorage.getItem("ui-preferences-storage") || "null");
        return blob ? { version: blob.version, themeName: blob.state?.themeName ?? null, contrast: blob.state?.contrast ?? null } : null;
      } catch { return "unreadable"; }
    })(),
    glass: document.documentElement.dataset.glass ?? null,
    groups: document.querySelectorAll("[data-notification-group]").length,
    vars: {
      canvas: v("--lo-glass-a-canvas"),
      surface: v("--lo-glass-a-surface"),
      elevated: v("--lo-glass-a-elevated"),
      bandFloor: v("--lo-glass-a-band-floor"),
      field: v("--lo-glass-a-field"),
      selected: v("--lo-glass-a-row-selected"),
    },
    page: page ? { region: page.dataset.glassRegion ?? null, alpha: alpha(getComputedStyle(page).backgroundColor) } : null,
    backing: b ? { bg: b.backgroundColor, alpha: alpha(b.backgroundColor) } : null,
    header: header ? {
      bg: h.backgroundColor, alpha: alpha(h.backgroundColor),
      backdrop: h.backdropFilter || h.webkitBackdropFilter || "none",
      position: h.position, top: h.top, zIndex: h.zIndex, height: h.height,
      rect: r(header), text: (header.textContent || "").trim().slice(0, 60),
      countText: (count?.textContent || "").trim(),
      color: h.color,
      labelColor: label ? getComputedStyle(label).color : null,
      countColor: count ? getComputedStyle(count).color : null,
    } : null,
    track: t ? {
      bg: t.backgroundColor, alpha: alpha(t.backgroundColor), rect: r(track),
      checked: checked ? { alpha: alpha(getComputedStyle(checked).backgroundColor), bg: getComputedStyle(checked).backgroundColor, text: (checked.textContent || "").trim() } : null,
      unchecked: (() => { const u = track?.querySelector('[role="radio"][aria-checked="false"]'); return u ? { alpha: alpha(getComputedStyle(u).backgroundColor), text: (u.textContent || "").trim() } : null; })(),
    } : null,
  };
})()`;

/** What the base tree rendered for this surface: the two attributes removed. */
const DROP_MARKS = `(() => {
  document.querySelector('[data-notification-group] [role="row"]')?.removeAttribute("data-glass-plane");
  document.querySelector("[data-notifications-page] [data-glass-well]")?.removeAttribute("data-glass-well");
  return true;
})()`;

async function main() {
	const cells = CELLS.filter((c) => !only || only.includes(c.name));
	if (!cells.length) throw new Error(`no cell matched ${only?.join(",")}`);
	if (!configDir)
		throw new Error(
			"--config is required: point it at an ISOLATED core config directory holding at least one seeded notification (see the README's seeding snippet). A lane with no rows has no group header and photographs an empty page.",
		);
	mkdirSync(outDir, { recursive: true });
	/* Electron comes from the checkout being driven when it has its own modules (a
	 * base worktree shares the primary checkout's tree by symlink, so this is the
	 * same binary either way); the script's own repo is the fallback. */
	const electronRoot = existsSync(join(appRepo, "node_modules/electron"))
		? appRepo
		: repoRoot;
	const electronPath = (
		await import(join(electronRoot, "node_modules/electron/index.js"))
	).default;
	const shots = [];

	for (const cell of cells) {
		/* The scratch profile lives in the OS temp dir, not in the evidence
		 * directory: a crashed run would otherwise leave `--user-data-dir` trees
		 * inside the frames other people read. */
		const root = mkdtempSync(join(tmpdir(), "notif-glass-"));
		const userData = join(root, "ud");
		const home = join(root, "home");
		mkdirSync(userData, { recursive: true });
		mkdirSync(home, { recursive: true });

		const env = withNotificationsOff({
			...Object.fromEntries(
				Object.entries(process.env).filter(
					([k]) =>
						!k.startsWith("CMUX_") &&
						k !== "ELECTRON_RUN_AS_NODE" &&
						k !== "XPC_FLAGS",
				),
			),
			HOME: home,
			LOCAL_OPERATOR_CONFIG_DIR: configDir,
			LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
		});
		withTelemetryOff(env);

		const port = await freePort();
		const child = spawn(
			electronPath,
			[
				appRepo,
				"--window-mode=headless",
				`--window-size=${VIEW.width}x${VIEW.height}`,
				`--user-data-dir=${userData}`,
				`--remote-debugging-port=${port}`,
				...withMockKeychain([]),
			],
			{ env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
		);
		reapOnExit({ pid: child.pid, userData });
		child.stdout.on("data", () => {});
		child.stderr.on("data", () => {});
		try {
			let cdp = await connect(port);
			/*
			 * THE PALETTE AND THE CONTRAST AMOUNT, seeded the way the app itself keeps
			 * them: this document's OWN persisted blob is read back, the two fields the
			 * cell names are overwritten in it, and the document reloads onto that.
			 *
			 * NOT A HAND-WRITTEN BLOB, and that is a measured lesson rather than a
			 * preference: the first version of this rig wrote a `{state:{...},version:4}`
			 * object from scratch, the store's own schema had moved on to v5 (the
			 * appearance layers), the persisted value was therefore not the shape the
			 * migrator expected, and EVERY cell silently booted the DEFAULT dark palette -
			 * the light and contrast frames were byte-identical to the dark one. Patching
			 * the blob the app just wrote cannot drift that way, and the theme is then
			 * ASSERTED below instead of assumed.
			 */
			await until(
				() =>
					cdp.evSoft(
						"document.documentElement && document.documentElement.dataset.theme",
					),
				90_000,
				"first paint",
			);
			/*
			 * THE SEED RUNS ON EVERY NEW DOCUMENT, not once before a reload. The store
			 * writes its blob back on boot, so a patch applied from the live document
			 * races that write and is sometimes lost - measured: the same contrast cell
			 * came out Standard-composed on one run and composed on the next. A
			 * pre-document script merges the cell's fields in BEFORE the store
			 * rehydrates, which is the only ordering that cannot be overwritten.
			 */
			const seed = `try {
        const k = "ui-preferences-storage";
        const cur = JSON.parse(localStorage.getItem(k) || "null") || { state: {}, version: 0 };
        if (!cur.state) cur.state = {};
        cur.state.themeName = ${JSON.stringify(cell.theme)};
        cur.state.contrast = { dark: ${cell.contrast ?? 0}, light: ${cell.contrast ?? 0} };
        localStorage.setItem(k, JSON.stringify(cur));
      } catch {}`;
			const { identifier } = await cdp.send(
				"Page.addScriptToEvaluateOnNewDocument",
				{ source: seed },
			);
			await cdp.send("Page.reload", { ignoreCache: true });
			/*
			 * RE-ATTACH AFTER THE RELOAD, and never reuse the pre-reload socket: a
			 * reload tears the renderer's execution context down, and the old socket then
			 * answers every `Runtime.evaluate` with an error - which `evSoft` reads as
			 * "not ready yet", so a dead channel looks exactly like a slow boot.
			 */
			cdp = await connect(port);
			const appliedTheme = await until(
				() => cdp.evSoft("document.documentElement?.dataset?.theme ?? null"),
				90_000,
				"the appearance to apply",
			);
			/* The identifier belongs to the session that registered it, and the reload
			 * above re-attached on a new one - so this removal answers "Script not
			 * found" there. It is worth attempting (it keeps the seed off documents this
			 * page opens later) and worth not failing on: the seed only rewrites the
			 * cell's own two fields, so a second application changes nothing. */
			await cdp
				.send("Page.removeScriptToEvaluateOnNewDocument", { identifier })
				.catch(() => {});
			/*
			 * A COMPOSED APPEARANCE RENAMES THE DOCUMENT. At Standard (and with no
			 * accent) the built-in palette is the identity, so `data-theme` is its own
			 * id; any other contrast composes a palette and the id becomes `lo-<hash>`
			 * (`src/renderer/src/shared/themes/appearance.ts`, `resolveAppearance`).
			 * Asserting the palette name for a preset cell asserts the OPPOSITE of what
			 * the cell is for.
			 */
			const composed = appliedTheme !== cell.theme;
			if (cell.contrast && !composed)
				throw new Error(
					`${cell.name}: the contrast ${cell.contrast} did not compose - the document kept data-theme="${appliedTheme}", so this frame is Standard and cannot speak for the preset`,
				);
			if (!cell.contrast && composed)
				throw new Error(
					`${cell.name}: expected the built-in identity, got the composed id "${appliedTheme}"`,
				);
			await wait(2000);
			await cdp.ev(
				`window.api.windowGlass.set(${JSON.stringify({
					enabled: cell.glass !== false,
					coverage: "full",
					intensity: cell.intensity ?? 80,
					material: "window",
				})}).then(() => true)`,
			);
			await wait(1500);
			await cdp.ev(`location.hash = ${JSON.stringify(ROUTE)}`);
			await until(
				() => cdp.ev('!!document.querySelector("[data-notifications-page]")'),
				60_000,
				"notifications page",
			);
			const groups = await until(
				() =>
					cdp.ev(
						'document.querySelectorAll("[data-notification-group]").length',
					),
				45_000,
				"notification groups",
			);
			await wait(1200);
			if (cell.scroll) {
				await cdp.ev(`(async () => {
          const header = document.querySelector('[data-notification-group] [role="row"]');
          let sc = header?.parentElement;
          while (sc && sc.scrollHeight <= sc.clientHeight + 2) sc = sc.parentElement;
          if (sc) { sc.scrollTop = ${cell.scroll}; sc.dispatchEvent(new Event("scroll", { bubbles: true })); }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return sc ? sc.scrollTop : null;
        })()`);
				await wait(400);
			}

			const shot = async (suffix, clip) => {
				const shotResult = await cdp.send("Page.captureScreenshot", {
					format: "png",
					captureBeyondViewport: false,
					...(clip ? { clip: { ...clip, scale: 1 } } : {}),
				});
				const file = join(outDir, `${label}${suffix}.png`);
				writeFileSync(file, Buffer.from(shotResult.data, "base64"));
				return file;
			};
			const after = await shot("");
			const afterRead = await cdp.ev(READBACK);
			/*
			 * THE NEGATIVE CONTROL (`--negative-control`): take the page's own
			 * `data-glass-region` marker away and read the band again. It is the check
			 * that the arm painting the band is LIVE rather than a rule nothing matches -
			 * a stylesheet read cannot tell those apart, and a rule that has quietly
			 * stopped matching is exactly how a "fixed" surface regresses. With no
			 * marker the band must fall back to its flat `bg-canvas` (alpha 1.0) and
			 * return to the floor when the marker goes back.
			 */
			let negativeControl = null;
			if (process.argv.includes("--negative-control")) {
				negativeControl = await cdp.ev(`(() => {
          const alpha = (c) => {
            if (!c || c === "transparent") return 0;
            let m = c.match(/^rgba?\\(([^)]+)\\)$/);
            if (m) { const p = m[1].split(/[,\\/]\\s*|\\s+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; }
            m = c.match(/^color\\(srgb ([^)]+)\\)$/);
            if (m) { const p = m[1].split("/"); return p.length > 1 ? Number(p[1]) : 1; }
            return 1;
          };
          const page = document.querySelector("[data-notifications-page]");
          const header = document.querySelector('[data-notification-group] [role="row"]');
          if (!page || !header) return { error: "no page or header" };
          const band = () => alpha(getComputedStyle(header).backgroundColor);
          const withMarker = band();
          const was = page.getAttribute("data-glass-region");
          page.removeAttribute("data-glass-region");
          const withoutMarker = band();
          if (was) page.setAttribute("data-glass-region", was);
          const restored = band();
          return { withMarker, withoutMarker, restored };
        })()`);
			}
			/* The 1:1 crop of the band's own edge: the strip the operator reported,
			 * at native pixels, so the step between the band and the row passing
			 * under it is visible without a thumbnail's interpolation. */
			let crop = null;
			if (cell.crop && afterRead.header) {
				const h = afterRead.header.rect;
				crop = await shot("-band", {
					x: h.x,
					y: Math.max(0, h.y),
					width: Math.min(h.w, VIEW.width - h.x),
					height: Math.min(h.h * 3, VIEW.height - h.y),
				});
			}
			let beforeRead = null;
			let before = null;
			if (keepBefore) {
				await cdp.ev(DROP_MARKS);
				await wait(300);
				before = await shot("-before");
				beforeRead = await cdp.ev(READBACK);
			}
			shots.push({
				cell: cell.name,
				app: appRepo,
				groups,
				frames: { after, crop, before },
				after: afterRead,
				before: beforeRead,
				negativeControl,
			});
			console.log(
				`[notif-glass] ${label}/${cell.name}: band ${afterRead.header?.alpha ?? "absent"} (floor ${afterRead.vars.bandFloor}, elevated ${afterRead.vars.elevated}) ${afterRead.header?.backdrop ?? "none"} pinned ${afterRead.header?.position ?? "n/a"}; page ${afterRead.backing?.alpha ?? "n/a"}; track ${afterRead.track?.alpha ?? "absent"} checked ${afterRead.track?.checked?.alpha ?? "n/a"}; ${groups} groups${beforeRead ? `; BEFORE band ${beforeRead.header?.alpha} track ${beforeRead.track?.alpha}` : ""}${negativeControl ? `; NEGATIVE CONTROL band ${negativeControl.withMarker} -> ${negativeControl.withoutMarker} (restored ${negativeControl.restored})` : ""}`,
			);
			if (!afterRead.header)
				throw new Error(
					`${cell.name}: the page rendered but has no group header (0 notifications in ${configDir}). Seed rows first - the README carries the snippet.`,
				);
		} finally {
			await stopAppTree({
				pid: child.pid,
				userData,
				isExited: () => child.exitCode !== null,
			});
		}
		rmSync(root, { recursive: true, force: true });
	}

	writeFileSync(
		join(outDir, `${label}.readback.json`),
		`${JSON.stringify({ view: VIEW, route: ROUTE, app: appRepo, shots }, null, 2)}\n`,
	);
}

async function connect(port) {
	const target = await until(
		async () =>
			(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
				(t) => t.type === "page" && /index\.html|localhost/.test(t.url),
			),
		/* The boot is slow on this host: the page target appeared at ~44 s against
		 * a 40 s budget once, which read as "the app publishes none". */
		90_000,
		"cdp page target",
	);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((r) => ws.addEventListener("open", r));
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (m) => {
		const d = JSON.parse(m.data);
		if (d.id && pending.has(d.id)) {
			pending.get(d.id)(d);
			pending.delete(d.id);
		}
	});
	const send = (method, params = {}) =>
		new Promise((res, rej) => {
			const i = ++id;
			pending.set(i, (d) =>
				d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result),
			);
			ws.send(JSON.stringify({ id: i, method, params }));
		});
	const ev = async (expression) => {
		const r = await send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (r.exceptionDetails)
			throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
		return r.result.value;
	};
	const evSoft = async (expression) => {
		try {
			return await ev(expression);
		} catch {
			return null;
		}
	};
	return { send, ev, evSoft };
}

main().catch((error) => {
	console.error(`[notif-glass] ${error.stack ?? error}`);
	process.exitCode = 1;
});
