/**
 * The window glass: the pure decisions behind the optional translucent window.
 *
 * WHAT THIS CAN AND CANNOT SEE. It asserts the platform matrix, the default-off
 * guarantee, the clamping, the per-role alpha floors and the argv round-trip over
 * the SHIPPED modules (bundled with esbuild, not re-implemented). It cannot see
 * pixels or a platform it is not running on: Windows 11 `backgroundMaterial` and
 * Linux are covered by their capability and option decisions here and by nothing
 * else - no CI job owns a display on either - so a green run is a statement about
 * the decisions, not about how Mica looks. The macOS pixels are the PR's own
 * evidence, captured from the real app.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

const bundleOf = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		loader: { ".json": "json" },
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

const glass = await bundleOf("./src/shared/window-glass");

/*
 * The main-process module is bundled too, with `electron` stubbed: `stateFor` and
 * `resolveLaunchWindowGlass` ARE the live master-switch semantics this file pins,
 * and reading their source would prove a spelling rather than a behaviour. The stub
 * is deliberately tiny: only the two symbols those functions touch at import time.
 */
const STUB = `
export const nativeTheme = { themeSource: "system", prefersReducedTransparency: false, on: () => {}, removeListener: () => {} };
export const ipcMain = { handle: () => {}, removeHandler: () => {} };
`;
const mainGlass = await (async () => {
	const bundle = await build({
		stdin: {
			contents: `export * from "./src/main/window-glass";`,
			resolveDir: ROOT,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		loader: { ".json": "json" },
		plugins: [
			{
				name: "electron-stub",
				setup(b) {
					b.onResolve({ filter: /^electron$/ }, () => ({
						path: "electron",
						namespace: "stub",
					}));
					b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
						contents: STUB,
						loader: "js",
					}));
				},
			},
		],
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
})();
const floorsFile = JSON.parse(
	readFileSync(`${ROOT}/src/shared/window-glass-floors.json`, "utf8"),
);

const MAC = {
	platform: "darwin",
	osVersion: "27.0.1",
	reducedTransparency: false,
};
const WIN11 = {
	platform: "win32",
	osVersion: "10.0.22631",
	reducedTransparency: false,
};
const ON = { ...glass.DEFAULT_GLASS_SETTINGS, enabled: true };

test("G-1 capability: one decision per platform, with a reason where it says no", () => {
	const mac = glass.glassCapabilityFor(MAC);
	assert.deepEqual(
		[mac.supported, mac.mechanism, mac.reason, mac.liveToggle],
		[true, "vibrancy", "ok", true],
	);
	assert.equal(
		mac.liquid,
		true,
		"macOS 26+ renders vibrancy with the Liquid Glass materials",
	);
	assert.equal(
		glass.glassCapabilityFor({ ...MAC, osVersion: "15.4" }).liquid,
		false,
		"macOS 15 has vibrancy but not the new materials: a label, never a gate",
	);
	assert.equal(
		glass.glassCapabilityFor({ ...MAC, osVersion: "15.4" }).supported,
		true,
	);

	const win = glass.glassCapabilityFor(WIN11);
	assert.deepEqual(
		[win.supported, win.mechanism, win.reason, win.liveToggle],
		[true, "background-material", "ok", false],
		"Windows builds the window with its material: the master switch needs a restart",
	);
	assert.deepEqual([...win.materials], ["mica", "acrylic", "tabbed"]);

	for (const build of ["10.0.19045", "10.0.22000", "10.0.22620"]) {
		const old = glass.glassCapabilityFor({ ...WIN11, osVersion: build });
		assert.deepEqual(
			[old.supported, old.mechanism, old.reason],
			[false, "none", "windows-too-old"],
			`${build}: Windows 10 and pre-22H2 Windows 11 have no working backgroundMaterial`,
		);
		assert.deepEqual([...old.materials], []);
	}
	assert.equal(
		glass.glassCapabilityFor({ ...WIN11, osVersion: "10.0.22621" }).supported,
		true,
		"22621 (22H2) is the first supported build",
	);
	assert.equal(
		glass.glassCapabilityFor({ ...WIN11, osVersion: "garbage" }).reason,
		"windows-too-old",
		"an unparseable version fails to the shipped look",
	);

	const linux = glass.glassCapabilityFor({
		platform: "linux",
		osVersion: "6.8.0",
		reducedTransparency: false,
	});
	assert.deepEqual(
		[linux.supported, linux.mechanism, linux.reason],
		[false, "none", "linux-no-native-blur"],
		"no native blur on Linux: the control is explained, not faked",
	);
	assert.equal(
		glass.glassCapabilityFor({
			platform: "freebsd",
			osVersion: "14",
			reducedTransparency: false,
		}).reason,
		"unsupported-platform",
	);
});

test("G-2 Reduce transparency wins on every platform", () => {
	for (const input of [MAC, WIN11]) {
		const cap = glass.glassCapabilityFor({
			...input,
			reducedTransparency: true,
		});
		assert.deepEqual(
			[cap.supported, cap.mechanism, cap.reason],
			[false, "none", "reduced-transparency"],
		);
		assert.deepEqual(
			glass.glassWindowOptions(ON, cap),
			{},
			"the OS accessibility switch drops the window to the shipped opaque ground",
		);
	}
});

test("G-3 DEFAULT OFF: an untouched launch contributes no window option at all", () => {
	for (const input of [MAC, WIN11]) {
		const cap = glass.glassCapabilityFor(input);
		assert.equal(
			glass.DEFAULT_GLASS_SETTINGS.enabled,
			false,
			"the master switch defaults OFF",
		);
		assert.deepEqual(
			glass.glassWindowOptions(glass.DEFAULT_GLASS_SETTINGS, cap),
			{},
			"not `vibrancy: undefined`, not a transparent background: the caller's own backgroundColor stands byte for byte",
		);
		assert.equal(glass.glassIsActive(glass.DEFAULT_GLASS_SETTINGS, cap), false);
	}
	/* The spread the main process does must leave the options object unchanged. */
	const before = { backgroundColor: "#22201c", titleBarStyle: "hidden" };
	const after = {
		...before,
		...glass.glassWindowOptions(
			glass.DEFAULT_GLASS_SETTINGS,
			glass.glassCapabilityFor(MAC),
		),
	};
	assert.deepEqual(after, before);
	assert.equal(
		JSON.stringify(after),
		JSON.stringify(before),
		"byte for byte, key order included",
	);
	/*
	 * The composition `index.ts` spreads into the BrowserWindow options: the palette
	 * ground, then the glass. Default off is the ground alone, byte for byte, key
	 * order included; an active glass overrides ONLY the ground it must.
	 */
	const ground = "#22201c";
	for (const input of [MAC, WIN11]) {
		const cap = glass.glassCapabilityFor(input);
		const off = glass.groundWithGlass(
			ground,
			glass.DEFAULT_GLASS_SETTINGS,
			cap,
		);
		assert.equal(
			JSON.stringify(off),
			JSON.stringify({ backgroundColor: ground }),
		);
		assert.equal(
			glass.groundWithGlass(ground, ON, cap).backgroundColor,
			"#00000000",
			"an active glass replaces the ground with the transparent one",
		);
	}
	assert.equal(
		glass.groundWithGlass(
			ground,
			ON,
			glass.glassCapabilityFor({ ...MAC, reducedTransparency: true }),
		).backgroundColor,
		ground,
		"Reduce transparency is the shipped opaque ground",
	);
});

test("G-4 enabled + supported: the constructor options per mechanism", () => {
	const mac = glass.glassWindowOptions(ON, glass.glassCapabilityFor(MAC));
	assert.deepEqual(mac, {
		backgroundColor: "#00000000",
		transparent: true,
		vibrancy: "under-window",
		visualEffectState: "active",
	});
	assert.equal(
		glass.glassWindowOptions(
			{ ...ON, material: "menu" },
			glass.glassCapabilityFor(MAC),
		).vibrancy,
		"menu",
	);
	assert.equal(
		glass.glassWindowOptions(
			{ ...ON, material: "popover" },
			glass.glassCapabilityFor(MAC),
		).vibrancy,
		"popover",
	);
	const win = glass.glassWindowOptions(
		{ ...ON, material: "acrylic" },
		glass.glassCapabilityFor(WIN11),
	);
	assert.deepEqual(win, {
		backgroundColor: "#00000000",
		backgroundMaterial: "acrylic",
	});
	assert.equal(
		"transparent" in win,
		false,
		"Windows must NOT build a transparent window: it could not be resized or maximised",
	);
	assert.equal(
		glass.glassWindowOptions(
			{ ...ON, material: "window" },
			glass.glassCapabilityFor(WIN11),
		).backgroundMaterial,
		"mica",
		"a macOS material id never reaches setBackgroundMaterial: it falls to the platform's own",
	);
	assert.deepEqual(
		glass.glassWindowOptions(
			ON,
			glass.glassCapabilityFor({
				platform: "linux",
				osVersion: "6",
				reducedTransparency: false,
			}),
		),
		{},
		"Linux: enabled in a persisted file from another machine still does nothing",
	);
});

test("G-5 sanitising an untrusted settings value", () => {
	const mac = glass.glassCapabilityFor(MAC);
	const win = glass.glassCapabilityFor(WIN11);
	assert.deepEqual(
		glass.sanitizeGlassSettings(undefined, mac),
		glass.DEFAULT_GLASS_SETTINGS,
	);
	assert.deepEqual(
		glass.sanitizeGlassSettings("nope", mac),
		glass.DEFAULT_GLASS_SETTINGS,
	);
	const merged = glass.sanitizeGlassSettings(
		{
			enabled: true,
			coverage: "full",
			intensity: 130.4,
			material: "popover",
		},
		mac,
	);
	assert.deepEqual(
		merged,
		{ enabled: true, coverage: "full", intensity: 100, material: "popover" },
		"intensity clamps to 0..100 and rounds",
	);
	/* The retired middle tier reads back as the nearest real one (design D1). */
	assert.equal(
		glass.sanitizeGlassSettings({ coverage: "chrome" }, mac).coverage,
		"sidebars",
		"a profile written by the three-tier build migrates 'chrome' to 'sidebars'",
	);
	assert.deepEqual(glass.GLASS_COVERAGES, ["sidebars", "full"], "two tiers");
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: -5 }, mac).intensity,
		0,
	);
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: Number.NaN }, mac).intensity,
		glass.DEFAULT_GLASS_SETTINGS.intensity,
	);
	assert.equal(
		glass.sanitizeGlassSettings({ intensity: "80" }, mac).intensity,
		glass.DEFAULT_GLASS_SETTINGS.intensity,
		"a string is not a number",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ enabled: "yes" }, mac).enabled,
		false,
		"only a real boolean enables it",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ coverage: "everything" }, mac).coverage,
		"full",
	);
	/* One bad field keeps its previous value and spares the rest. */
	assert.deepEqual(
		glass.sanitizeGlassSettings({ coverage: "bogus", enabled: true }, mac, {
			...ON,
			coverage: "sidebars",
		}),
		{ ...ON, coverage: "sidebars", enabled: true },
	);
	/* A material this platform does not offer never reaches Electron, which throws. */
	assert.equal(
		glass.sanitizeGlassSettings({ material: "mica" }, mac).material,
		"window",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ material: "popover" }, win).material,
		"mica",
	);
	assert.equal(
		glass.sanitizeGlassSettings({ material: "../../etc" }, win).material,
		"mica",
	);
});

test("G-6 alphas: monotone in intensity, ordered by role, never below the measured floor", () => {
	for (const mechanism of ["vibrancy", "background-material"]) {
		const materials =
			mechanism === "vibrancy"
				? glass.GLASS_MAC_MATERIALS
				: glass.GLASS_WIN_MATERIALS;
		for (const material of materials)
			for (const scheme of ["dark", "light"]) {
				const floors = glass.glassAlphaFloors(mechanism, material, scheme);
				let prev = null;
				for (let intensity = 0; intensity <= 100; intensity += 5) {
					const a = glass.glassAlphas({
						intensity,
						mechanism,
						material,
						scheme,
					});
					for (const role of ["canvas", "surface", "elevated"]) {
						assert.ok(
							a[role] >= floors[role] - 1e-9,
							`${material}/${scheme}/${role} at ${intensity}: ${a[role]} < floor ${floors[role]}`,
						);
						assert.ok(
							a[role] <=
								Math.max(glass.GLASS_ALPHA_CEILING, floors[role]) + 1e-9,
						);
						if (prev)
							assert.ok(
								a[role] <= prev[role] + 1e-9,
								"more see-through never raises an alpha",
							);
					}
					prev = a;
				}
				const end = glass.glassAlphas({
					intensity: 100,
					mechanism,
					material,
					scheme,
				});
				for (const role of ["canvas", "surface", "elevated"])
					assert.equal(
						end[role],
						floors[role],
						"100 is exactly the floor: as clear as text allows",
					);
				const start = glass.glassAlphas({
					intensity: 0,
					mechanism,
					material,
					scheme,
				});
				assert.equal(
					start.canvas,
					Math.max(glass.GLASS_ALPHA_CEILING, floors.canvas),
					"frosted is veiled, never solid unless the floor says so",
				);
			}
	}
	assert.deepEqual(
		glass.glassAlphas({
			intensity: 250,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		}),
		glass.glassAlphas({
			intensity: 100,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		}),
		"out-of-range intensity clamps",
	);
});

test("G-7 the committed floors cover every tier, scheme and role and are not hand-lowered", () => {
	for (const tier of ["under-window", "menu", "popover"])
		for (const scheme of ["dark", "light"])
			for (const role of ["canvas", "surface", "elevated"]) {
				const v = floorsFile.alphaFloor[tier][scheme][role];
				assert.ok(
					typeof v === "number" && v > 0 && v <= 1,
					`${tier}/${scheme}/${role}`,
				);
			}
	/* A denser material needs a higher floor: its tone is closer to the ink's. */
	for (const scheme of ["dark", "light"])
		for (const role of ["canvas", "surface", "elevated"])
			assert.ok(
				floorsFile.alphaFloor["under-window"][scheme][role] <=
					floorsFile.alphaFloor.popover[scheme][role],
				`${scheme}/${role}: the clearest material has the lowest floor`,
			);
});

test("G-8 paint: which kinds a coverage turns translucent, and the net alphas", () => {
	const paint = (coverage) =>
		glass.glassPaintFor({
			coverage,
			intensity: 60,
			mechanism: "vibrancy",
			material: "window",
			scheme: "dark",
		});
	assert.equal(paint("sidebars").kinds, "sidebar");
	assert.equal(paint("full").kinds, "sidebar canvas pane");
	assert.notEqual(
		paint("sidebars").kinds,
		paint("full").kinds,
		"the two tiers must paint different kinds, or one of them is a label for nothing",
	);
	const v = paint("full").vars;
	const a = (name) => Number(v[name]);
	assert.ok(a("--lo-glass-a-canvas") > 0 && a("--lo-glass-a-canvas") <= 1);
	/* Stacking: a surface over the canvas backing composites back to ITS target. */
	for (const [net, target] of [
		["--lo-glass-in-surface", "--lo-glass-a-surface"],
		["--lo-glass-in-elevated", "--lo-glass-a-elevated"],
	]) {
		const stacked = 1 - (1 - a(net)) * (1 - a("--lo-glass-a-canvas"));
		assert.ok(
			stacked >= a(target) - 0.011 &&
				stacked <= 1 &&
				(a(net) === 0 || Math.abs(stacked - a(target)) < 0.011),
			`${net}: stacked ${stacked.toFixed(3)} vs target ${a(target)}`,
		);
	}
	/* A target BELOW the backing's alpha clamps to 0: more opaque than the floor, never less. */
	const clear = glass.glassPaintFor({
		coverage: "full",
		intensity: 100,
		mechanism: "vibrancy",
		material: "window",
		scheme: "light",
	}).vars;
	assert.ok(Number(clear["--lo-glass-in-elevated"]) >= 0);
	/* Every var is a bare number the CSS multiplies by 100%. */
	for (const value of Object.values(v)) assert.match(value, /^\d(\.\d+)?$/);
});

test("G-9 argv round-trip: the first-frame fact fails closed", () => {
	const cap = glass.glassCapabilityFor(MAC);
	const state = {
		capability: cap,
		settings: { ...ON, coverage: "full", intensity: 35, material: "menu" },
		active: true,
		restartRequired: false,
	};
	const arg = glass.windowGlassArgument(state, "light");
	assert.equal(arg, "--lo-window-glass=vibrancy:full:35:menu:light");
	assert.deepEqual(glass.readWindowGlassArgument(["x", arg]), {
		mechanism: "vibrancy",
		coverage: "full",
		intensity: 35,
		material: "menu",
		scheme: "light",
	});
	assert.equal(
		glass.windowGlassArgument({ ...state, active: false }, "dark"),
		"--lo-window-glass=off",
	);
	for (const bad of [
		"--lo-window-glass=off",
		"--lo-window-glass=",
		"--lo-window-glass=vibrancy:full:35:menu",
		"--lo-window-glass=vibrancy:full:35:menu:light:extra",
		"--lo-window-glass=none:full:35:menu:light",
		"--lo-window-glass=vibrancy:full:101:menu:light",
		"--lo-window-glass=vibrancy:full:3.5:menu:light",
		"--lo-window-glass=vibrancy:chrome:35:bogus:light",
		"--lo-window-glass=vibrancy:all:35:menu:light",
		"--lo-window-glass=vibrancy:chrome:35:menu:light",
		"--lo-window-glass=vibrancy:full:35:menu:sepia",
	])
		assert.equal(glass.readWindowGlassArgument([bad]), null, bad);
	assert.equal(glass.readWindowGlassArgument([]), null, "no entry is off");
});

test("G-10 the master switch is live exactly for a window built with glass on", () => {
	const mac = glass.glassCapabilityFor(MAC);
	const win = glass.glassCapabilityFor(WIN11);
	assert.equal(glass.glassCapabilityFor(MAC).liveToggle, true);
	assert.equal(glass.glassCapabilityFor(WIN11).liveToggle, false);

	/* Launched with the persisted setting on: the window is built able to show it. */
	const launchedOn = mkdtempSync(join(tmpdir(), "glass-launch-on-"));
	writeFileSync(
		join(launchedOn, "window-glass.json"),
		JSON.stringify({ settings: ON, scheme: "dark" }),
	);
	try {
		const launch = mainGlass.resolveLaunchWindowGlass({
			userDataDir: launchedOn,
			...MAC,
		});
		assert.equal(launch.state.active, true);
		assert.equal(launch.state.restartRequired, false);
		/* Switching it off/below the switch stays live; no restart is ever demanded. */
		for (const next of [
			mainGlass.stateFor(ON, mac, true),
			mainGlass.stateFor({ ...ON, enabled: false }, mac, true),
			mainGlass.stateFor({ ...ON, intensity: 80 }, mac, true),
		]) {
			assert.equal(next.active, next.settings.enabled);
			assert.equal(next.restartRequired, false);
		}
	} finally {
		rmSync(launchedOn, { recursive: true, force: true });
	}

	/* Launched opaque: an enable on macOS cannot paint until the next launch. */
	const launchedOff = mkdtempSync(join(tmpdir(), "glass-launch-off-"));
	try {
		const launch = mainGlass.resolveLaunchWindowGlass({
			userDataDir: launchedOff,
			...MAC,
		});
		assert.equal(launch.state.active, false);
		assert.equal(launch.state.restartRequired, false);
		const enabled = mainGlass.stateFor(ON, mac, launch.state.active);
		assert.equal(
			enabled.active,
			false,
			"`transparent` is construction-only: an opaque window cannot gain see-through",
		);
		assert.equal(enabled.restartRequired, true);

		/* Windows has the same answer for a different reason (built with its material). */
		const winEnabled = mainGlass.stateFor(ON, win, false);
		assert.equal(winEnabled.active, false);
		assert.equal(winEnabled.restartRequired, true);
		assert.equal(mainGlass.stateFor(ON, win, true).active, true);
	} finally {
		rmSync(launchedOff, { recursive: true, force: true });
	}
});

test("G-11 every region the CSS names is a marker some component carries", async () => {
	const css = readFileSync(`${ROOT}/src/renderer/src/styles/index.css`, "utf8");
	const named = new Set(
		[...css.matchAll(/data-glass-region="([\w-]+)"/g)].map((m) => m[1]),
	);
	assert.ok(named.size >= 5);
	const { execFileSync } = await import("node:child_process");
	const files = execFileSync(
		"git",
		["grep", "-l", "data-glass-region=", "--", "src/renderer/src"],
		{ cwd: ROOT, encoding: "utf8" },
	)
		.split("\n")
		.filter(Boolean);
	const carried = new Set();
	for (const f of files) {
		if (f.endsWith(".css")) continue;
		for (const m of readFileSync(`${ROOT}/${f}`, "utf8").matchAll(
			/data-glass-region="([\w-]+)"/g,
		))
			carried.add(m[1]);
	}
	for (const region of named)
		assert.ok(
			carried.has(region),
			`CSS names "${region}" but no component carries it`,
		);
});
