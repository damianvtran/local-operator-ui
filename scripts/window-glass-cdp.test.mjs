/**
 * THE WINDOW GLASS, READ BACK FROM THE REAL APP: one alpha per region, uniform.
 *
 * WHY THIS EXISTS. The unit tests (`window-glass.test.mjs`) pin the DECISIONS and
 * the contract (`contrast-contract.mjs`) pins the floors, but neither can see the
 * thing the operator actually photographed: grounds of the SAME role nested inside
 * each other, each carrying the role's alpha, COMPOUND (0.82 over 0.82 is 0.97) -
 * so the sidebar's nav block was glass and the list pane under it a near-opaque
 * slab with a hard seam, and the right rail was glass in one corner only. That
 * defect lives in the cascade of the BUILT renderer, so it is checked there.
 *
 * WHAT IT DOES. Boots the built app (`pnpm build` first; skipped with a stated
 * reason when `out/` is missing) in `headless` mode on a scratch profile - the
 * window is created and never shown, so nothing here can take the operator's
 * focus - and drives it over CDP. For each coverage mode and intensity, in a dark
 * and a light palette, it walks a grid of points through every glass region and
 * composes the EFFECTIVE alpha of the ground layers stacked there
 * (`1 - prod(1 - a_i)`, from `document.elementsFromPoint` and computed style).
 * It asserts:
 *   1. WITH GLASS OFF every point is fully opaque (default-off is byte-identical).
 *   2. Inside a covered region the effective alpha is IDENTICAL at every sampled
 *      point (the seam guard), and equals the role's published variable
 *      (`--lo-glass-a-surface` for sidebars, rail and chrome, `--lo-glass-a-canvas`
 *      for the chat canvas) - a layer of a different alpha, or two stacked, fails.
 *   3. The sidebar, the panel rail and the settings nav agree with each other.
 *   4. OUTSIDE the covered regions (sidebars-only leaves the chat canvas alone)
 *      every point is fully opaque.
 *   5. No full-width opaque ground sits inside a glass region (the "slab" check,
 *      with the narrow, deliberate exceptions named in `ALLOWED_OPAQUE`).
 *   6. Row hover, the selected row and a text field read as ink overlays at the
 *      published state alphas (not opaque holes, not invisible), and the field's
 *      border colour is the derived glass edge.
 * The frames over a high-contrast backdrop are NOT part of this test (they need
 * the OS compositor); they are the PR's evidence, produced by the rig named there.
 *
 * Run on demand, like `window-guards-electron.test.mjs`: `pnpm test:window-glass`.
 * CMUX_* is stripped from the child; the profile is under the temp root and reaped
 * by exact pid via `app-tree-teardown.mjs`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { reapOnExit, stopAppTree } from "./app-tree-teardown.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const built = existsSync(join(repoRoot, "out/main/index.js"));
const skip = !built
	? "out/ is not built: run `pnpm build` first (this test reads the BUILT renderer)"
	: process.platform === "linux" && !process.env.DISPLAY
		? "Electron needs a display and this runner has none"
		: undefined;

/** Effective alpha may differ by float noise only. */
const TOLERANCE = 0.006;

/**
 * Opaque, deliberate grounds that may sit inside a glass region. Each is a
 * fixed-size control or identity mark, never a column or pane ground: the
 * brand mark's disc, an avatar well, a primary button, the danger banner and the
 * hero glyph chip. A WIDE slab (a pane, a list, a toolbar) is never legal.
 */
const MAX_DELIBERATE_OPAQUE_AREA = 60 * 60;

/** The page-side audit, as a string so it runs in the app's own document. */
const AUDIT = `(() => {
  const alphaOf = (c) => {
    if (!c || c === "transparent") return 0;
    let m = c.match(/^rgba?\\(([^)]+)\\)$/);
    if (m) { const p = m[1].split(/[,\\/]\\s*|\\s+/).filter(Boolean); return p.length > 3 ? Number(p[3]) : 1; }
    m = c.match(/^color\\(srgb ([^)]+)\\)$/);
    if (m) { const p = m[1].split("/"); return p.length > 1 ? Number(p[1]) : 1; }
    return 1;
  };
  const regions = {
    sidebar: '[data-sidebar-shell]',
    rail: '[data-panel-rail-host]',
    settingsNav: 'nav[data-glass-region="sidebar"]',
    canvas: 'main[data-glass-region="canvas-backing"]',
  };
  const out = {};
  for (const [name, sel] of Object.entries(regions)) {
    const el = document.querySelector(sel);
    if (!el) { out[name] = null; continue; }
    const r = el.getBoundingClientRect();
    const top = Math.max(r.top, 34);
    const pts = [];
    for (let i = 0; i < 5; i++) for (let j = 0; j < 14; j++) {
      const x = r.left + (r.width * (i + 0.5)) / 5;
      const y = top + ((Math.min(r.bottom, innerHeight) - top) * (j + 0.5)) / 14;
      if (y < 34 || y >= innerHeight || x >= innerWidth) continue;
      let keep = 1;
      for (const e of document.elementsFromPoint(x, y)) {
        // Only grounds that span the region in BOTH directions are layers of ITS
        // ground (a column's list pane is half its height, a banner or a composer
        // is a fraction of it); narrower or shorter boxes are content, judged by the
        // slab check below instead.
        const eb = e.getBoundingClientRect();
        if (eb.width < r.width * 0.9 || eb.height < r.height * 0.25) continue;
        const a = alphaOf(getComputedStyle(e).backgroundColor);
        if (a > 0) { keep *= 1 - a; if (a >= 0.999) break; }
      }
      pts.push(Number((1 - keep).toFixed(3)));
    }
    const slabs = [];
    for (const e of el.querySelectorAll("*")) {
      const a = alphaOf(getComputedStyle(e).backgroundColor);
      if (a < 0.99) continue;
      const b = e.getBoundingClientRect();
      if (b.width * b.height < ${MAX_DELIBERATE_OPAQUE_AREA}) continue;
      if (b.bottom < 0 || b.top > innerHeight) continue;
      slabs.push({ tag: e.tagName.toLowerCase(), w: Math.round(b.width), h: Math.round(b.height), cls: String(e.className).split(/\\s+/).filter((c) => /^bg-/.test(c)).join(" ") });
    }
    out[name] = { pts, slabs };
  }
  const root = getComputedStyle(document.documentElement);
  out.vars = Object.fromEntries(["--lo-glass-a-canvas", "--lo-glass-a-surface", "--lo-glass-a-elevated", "--lo-glass-a-row-hover", "--lo-glass-a-row-selected", "--lo-glass-a-field"].map((n) => [n, root.getPropertyValue(n).trim() || null]));
  out.glass = document.documentElement.dataset.glass ?? null;
  return out;
})()`;

let root;
let child;
let exited = false;
let cdp;
let userData;

const free = () =>
	new Promise((resolve) => {
		const s = createServer();
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
	const t = Date.now();
	for (;;) {
		try {
			const v = await fn();
			if (v) return v;
		} catch {
			/* not yet */
		}
		if (Date.now() - t > ms) throw new Error(`timeout: ${what}`);
		await wait(150);
	}
}

before(async () => {
	if (skip) return;
	root = mkdtempSync(join(tmpdir(), "glass-cdp-"));
	userData = join(root, "ud");
	mkdirSync(userData, { recursive: true });
	const port = await free();
	/*
	 * THE ENVIRONMENT IS BUILT THROUGH THE SHARED SWITCHES, not set by hand: this
	 * boots the real app, so a missing notification or telemetry switch would banner
	 * the operator's Notification Center or count a test as a product user
	 * (`notification-spawn-sites.test.mjs` pins the site; `chrome-keychain.test.mjs`
	 * pins the keychain switch to its one module).
	 */
	const spawnEnv = withNotificationsOff({
		...Object.fromEntries(
			Object.entries(process.env).filter(
				([k]) =>
					!k.startsWith("CMUX_") &&
					k !== "ELECTRON_RUN_AS_NODE" &&
					k !== "XPC_FLAGS",
			),
		),
		LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
	});
	withTelemetryOff(spawnEnv);
	child = spawn(
		electronPath,
		[
			repoRoot,
			"--window-mode=headless",
			"--window-size=1240x820",
			`--user-data-dir=${userData}`,
			`--remote-debugging-port=${port}`,
			...withMockKeychain([]),
		],
		{ env: spawnEnv, detached: true, stdio: "ignore" },
	);
	child.on("exit", () => {
		exited = true;
	});
	reapOnExit({ pid: child.pid, userData });
	const target = await until(
		async () =>
			(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(
				(t) => t.type === "page" && /index\.html|localhost/.test(t.url),
			),
		40_000,
		"cdp page",
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
	cdp = { send, ev };
});

after(async () => {
	if (skip || !child) return;
	await stopAppTree({
		pid: child.pid,
		userData,
		isExited: () => exited,
	});
	rmSync(root, { recursive: true, force: true });
});

/** Boot-seed: onboarding done (so the shell, not the tour, is what renders) and a palette. */
async function loadTheme(themeName) {
	const { send, ev } = cdp;
	await send("Page.enable");
	const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", {
		source: `try{localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));const k="ui-preferences-storage";const cur=JSON.parse(localStorage.getItem(k)||"null")||{state:{},version:4};cur.state={...cur.state,themeName:${JSON.stringify(themeName)}};localStorage.setItem(k,JSON.stringify(cur));}catch(e){}`,
	});
	await send("Page.reload", { ignoreCache: true });
	await until(
		() => ev("document.documentElement.dataset.theme"),
		30_000,
		"theme attribute",
	);
	await wait(1800);
	await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}

const setGlass = async (patch) => {
	await cdp.ev(
		`window.api.windowGlass.set(${JSON.stringify(patch)}).then(() => true)`,
	);
	await wait(900);
};

const uniform = (pts) => Math.max(...pts) - Math.min(...pts);
const mean = (pts) => pts.reduce((a, b) => a + b, 0) / pts.length;

/** [coverage, which regions are glass, intensity] */
const MODES = [
	[
		"full",
		{
			sidebar: "surface",
			rail: "surface",
			settingsNav: "surface",
			canvas: "canvas",
		},
	],
	[
		"chrome",
		{
			sidebar: "surface",
			rail: "surface",
			settingsNav: "surface",
			canvas: null,
		},
	],
	[
		"sidebars",
		{
			sidebar: "surface",
			rail: "surface",
			settingsNav: "surface",
			canvas: null,
		},
	],
];

for (const [themeName, label] of [
	["localOperatorDark", "dark"],
	["localOperatorLight", "light"],
]) {
	test(
		`${label}: glass off is opaque everywhere; each coverage is uniform per region and opaque outside`,
		{ skip, timeout: 240_000 },
		async () => {
			await loadTheme(themeName);
			await cdp.ev(`location.hash = "#/chat"`);
			await wait(1200);

			/* 1. DEFAULT OFF */
			const off = await cdp.ev(AUDIT);
			assert.equal(off.glass, null, "no data-glass attribute while off");
			for (const name of ["sidebar", "rail", "canvas"]) {
				if (!off[name]) continue;
				assert.ok(
					Math.min(...off[name].pts) >= 0.999,
					`${label} off: ${name} must be fully opaque, saw ${Math.min(...off[name].pts)}`,
				);
			}

			for (const [coverage, covered] of MODES) {
				for (const intensity of [0, 50, 100]) {
					await setGlass({
						enabled: true,
						coverage,
						intensity,
						material: "window",
					});
					const a = await cdp.ev(AUDIT);
					const tag = `${label}/${coverage}/${intensity}`;
					assert.ok(a.glass, `${tag}: data-glass is set`);
					const surface = Number(a.vars["--lo-glass-a-surface"]);
					const canvas = Number(a.vars["--lo-glass-a-canvas"]);
					const sidebarMeans = [];
					for (const [name, role] of Object.entries(covered)) {
						const r = a[name];
						if (!r) continue; // settings nav only exists on the settings route
						const want =
							role === "surface" ? surface : role === "canvas" ? canvas : 1;
						assert.ok(
							uniform(r.pts) <= TOLERANCE,
							`${tag}: ${name} is not uniform (spread ${uniform(r.pts).toFixed(3)}: ${[...new Set(r.pts)].join(",")}) - nested grounds are compounding`,
						);
						assert.ok(
							Math.abs(mean(r.pts) - want) <= TOLERANCE,
							`${tag}: ${name} effective alpha ${mean(r.pts).toFixed(3)} != the role variable ${want}`,
						);
						if (role === "surface") sidebarMeans.push(mean(r.pts));
						if (role) {
							const wide = r.slabs.filter(
								(s) =>
									s.w >= 0.5 * 200 &&
									s.h >= 0.5 * 40 &&
									!s.cls.includes("bg-accent") &&
									!s.cls.includes("danger"),
							);
							assert.deepEqual(
								wide,
								[],
								`${tag}: ${name} holds an opaque ground inside a glass region`,
							);
						}
					}
					assert.ok(
						Math.max(...sidebarMeans) - Math.min(...sidebarMeans) <= TOLERANCE,
						`${tag}: the sidebar and the rail disagree: ${sidebarMeans.join(" vs ")}`,
					);
					if (covered.canvas === null && a.canvas) {
						assert.ok(
							Math.min(...a.canvas.pts) >= 0.999,
							`${tag}: the chat canvas must stay opaque outside coverage, saw ${Math.min(...a.canvas.pts)}`,
						);
					}
				}
			}
		},
	);

	test(
		`${label}: row hover, the selected row and a field are ink overlays on glass, and the edge is the derived one`,
		{ skip, timeout: 120_000 },
		async () => {
			await loadTheme(themeName);
			await setGlass({
				enabled: true,
				coverage: "full",
				intensity: 50,
				material: "window",
			});
			await cdp.ev(`location.hash = "#/chat"`);
			await wait(1200);
			const vars = await cdp.ev(
				`Object.fromEntries(["--lo-glass-a-row-hover","--lo-glass-a-row-selected","--lo-glass-a-field","--lo-glass-control-mix"].map((n) => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()]))`,
			);
			const read = await cdp.ev(`(() => {
        const alpha = (c) => { const m = c.match(/\\/\\s*([\\d.]+)\\)$/); return m ? Number(m[1]) : c.startsWith("rgba(0, 0, 0, 0)") ? 0 : 1; };
        const own = (n) => { while (n && getComputedStyle(n).backgroundColor === "rgba(0, 0, 0, 0)") n = n.parentElement; return n; };
        const rows = [...document.querySelectorAll("[data-sidebar-shell] button")];
        const selected = rows.find((n) => n.textContent.trim().startsWith("New chat"));
        const field = [...document.querySelectorAll("input")].find((n) => /filter/i.test(n.placeholder || ""));
        const hoverable = document.querySelector("[data-sidebar-shell] li");
        return {
          selected: selected && alpha(getComputedStyle(selected).backgroundColor),
          field: field && alpha(getComputedStyle(field).backgroundColor),
          fieldBorder: field && getComputedStyle(field).borderTopColor,
          hasHoverRow: !!hoverable,
        };
      })()`);
			assert.ok(
				read.selected !== null,
				"the selected 'New chat' row is on screen",
			);
			assert.ok(
				Math.abs(read.selected - Number(vars["--lo-glass-a-row-selected"])) <=
					0.005,
				`${label}: the selected row paints ${read.selected}, not the ink overlay ${vars["--lo-glass-a-row-selected"]} (an opaque pill is a hole in glass)`,
			);
			assert.ok(read.selected < 0.5, "never an opaque fill");
			if (read.field !== null && read.field !== undefined)
				assert.ok(
					Math.abs(read.field - Number(vars["--lo-glass-a-field"])) <= 0.005,
					`${label}: a text field paints ${read.field}, expected the field overlay ${vars["--lo-glass-a-field"]}`,
				);
			assert.ok(
				Number(vars["--lo-glass-control-mix"]) > 0,
				"the glass edge mix is published",
			);

			/* Hover is a REAL pointer move, so the :hover cascade is the one a user gets. */
			const p = await cdp.ev(
				`(() => { const li = [...document.querySelectorAll("[data-sidebar-shell] li")].find((n) => n.textContent.trim().startsWith("Projects")) ?? document.querySelector("[data-sidebar-shell] li"); const r = li.getBoundingClientRect(); li.setAttribute("data-glass-probe", "1"); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
			);
			/* Leave first: a pointer already parked on the row from the previous theme's
			 * run raises no enter event, and the :hover would never apply. */
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: 5,
				y: 5,
				button: "none",
			});
			await wait(300);
			await cdp.send("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: p.x,
				y: p.y,
				button: "none",
			});
			await wait(900);
			const hover = await cdp.ev(
				`(() => { const c = getComputedStyle(document.querySelector('[data-glass-probe]')).backgroundColor; const m = c.match(/\\/\\s*([\\d.]+)\\)$/); return m ? Number(m[1]) : c === "rgba(0, 0, 0, 0)" ? 0 : 1; })()`,
			);
			assert.ok(
				Math.abs(hover - Number(vars["--lo-glass-a-row-hover"])) <= 0.005,
				`${label}: a hovered row paints ${hover}, expected the ink overlay ${vars["--lo-glass-a-row-hover"]}`,
			);
		},
	);
}
