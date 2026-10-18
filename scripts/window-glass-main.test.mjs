/**
 * The main-process half of the window glass, DRIVEN rather than read.
 *
 * WHY THIS FILE EXISTS. `window-glass.test.mjs` covers the pure decisions and used to
 * cover the main-process behaviour with regexes over source text, which proves a
 * spelling and not a behaviour: both defects the first review found here
 * (R1 - Reduce transparency left the vibrancy view on; R2 - a glass launch's first
 * ground was repainted opaque) were green under it. This bundles the REAL
 * `window-surface`, `window-glass` and `window-chrome` modules with `electron`
 * replaced by a recording stub and runs the real attach/apply/teardown path, so a
 * regression in ordering or in what a teardown undoes fails here.
 *
 * WHAT IT CANNOT SHOW: whether macOS actually removes the material (that is the
 * built-app CDP suite and the frames) - only that the right calls are made, in the
 * right order, against the right state.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();

/** The recording stub every `electron` import resolves to. */
const STUB = `
export const calls = [];
export const handlers = new Map();
export const listeners = [];
export const nativeTheme = {
	themeSource: "system",
	prefersReducedTransparency: false,
	on: (e, f) => listeners.push([e, f]),
	removeListener: () => {},
};
export const ipcMain = {
	handle: (c, f) => handlers.set(c, f),
	removeHandler: (c) => handlers.delete(c),
};
export const Menu = { getApplicationMenu: () => null };
export const emitNativeThemeUpdated = () => { for (const [e, f] of listeners) if (e === "updated") f(); };
export const makeWindow = (opts = {}) => {
	const w = {
		sender: {},
		isDestroyed: () => false,
		isFullScreen: () => false,
		isMaximized: () => false,
		isFocused: () => false,
		getPosition: () => [0, 0],
		on: () => {},
		removeListener: () => {},
		setTitleBarOverlay: () => {},
		setBackgroundColor: (c) => calls.push(["bg", c]),
		setVibrancy: (v) => calls.push(["vibrancy", v]),
		setBackgroundMaterial: (m) => calls.push(["material", m]),
		webContents: { send: (ch, p) => calls.push(["send", ch]) },
	};
	return w;
};
`;

const stubPlugin = {
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
};

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/main/window-surface";
			export * from "./src/main/window-glass";
			export * as electron from "electron";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	loader: { ".json": "json" },
	plugins: [stubPlugin],
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const { electron } = mod;

const MAC = {
	platform: "darwin",
	osVersion: "27.0.1",
	reducedTransparency: false,
};
const COLORS = {
	ground: "#22201c",
	symbol: "#ffffff",
	symbolInactive: "#999999",
};

/** A profile directory, optionally with a persisted glass file. */
function profile(settings) {
	const dir = mkdtempSync(join(tmpdir(), "glass-main-"));
	if (settings)
		writeFileSync(
			join(dir, "window-glass.json"),
			JSON.stringify({ settings, scheme: "dark" }),
		);
	return dir;
}

/** Boot the real surface attach against the stubbed Electron. */
function boot(
	dir,
	{ reduced = false, platform = "darwin", osVersion = "27.0.1" } = {},
) {
	electron.calls.length = 0;
	electron.nativeTheme.prefersReducedTransparency = reduced;
	electron.nativeTheme.themeSource = "system";
	electron.handlers.clear();
	electron.listeners.length = 0;
	const platformGlobals = Object.getOwnPropertyDescriptor(process, "platform");
	Object.defineProperty(process, "platform", { value: platform });
	const sys = process.getSystemVersion;
	process.getSystemVersion = () => osVersion;
	try {
		const glass = mod.resolveLaunchWindowGlass({
			userDataDir: dir,
			platform,
			osVersion,
			reducedTransparency: reduced,
		});
		const window = electron.makeWindow();
		const logs = [];
		const surface = mod.attachWindowSurface({
			window,
			glass,
			userDataDir: dir,
			chrome: {
				mode: "overlay",
				colors: COLORS,
				headless: true,
				log: (l) => logs.push(l),
			},
			log: (l) => logs.push(l),
		});
		return {
			window,
			surface,
			glass,
			logs,
			restore: () => {
				Object.defineProperty(process, "platform", platformGlobals);
				process.getSystemVersion = sys;
			},
		};
	} catch (e) {
		Object.defineProperty(process, "platform", platformGlobals);
		process.getSystemVersion = sys;
		throw e;
	}
}

const bgCalls = () =>
	electron.calls.filter((c) => c[0] === "bg").map((c) => c[1]);
const invoke = (channel, window, ...args) =>
	electron.handlers.get(channel)({ sender: window.webContents }, ...args);

test("M-1 a glass launch never paints the opaque ground over the transparent window (R2)", () => {
	const dir = profile({
		enabled: true,
		coverage: "full",
		intensity: 50,
		material: "window",
	});
	const b = boot(dir);
	try {
		assert.deepEqual(
			bgCalls(),
			["#00000000"],
			"the first and only ground painted at attach is the transparent one",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-2 a launch that never enabled glass paints the palette ground and touches no material", () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		assert.deepEqual(bgCalls(), [COLORS.ground]);
		assert.equal(
			electron.calls.filter((c) => c[0] === "vibrancy" || c[0] === "material")
				.length,
			0,
		);
		assert.equal(
			electron.nativeTheme.themeSource,
			"system",
			"no tone pin without glass",
		);
		/*
		 * darwin constructs this window with the inert `visualEffectState: "active"`
		 * (`glassWindowOptions`). It must remain inert: the controller is not active,
		 * no material is created, and the transparent ground is never painted.
		 */
		assert.equal(b.glass.state.active, false);
		assert.equal(b.surface.glass.isActive(), false);
		assert.ok(
			!bgCalls().includes("#00000000"),
			"the inert state never makes the ground transparent by itself",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-3 live enable and disable apply and undo the material, and a restart is never demanded on macOS", async () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		electron.calls.length = 0;
		const on = await invoke("window-glass:set", b.window, { enabled: true });
		assert.equal(on.active, true);
		assert.equal(on.restartRequired, false);
		assert.deepEqual(
			electron.calls.filter((c) => c[0] === "vibrancy" || c[0] === "bg"),
			[
				["bg", "#00000000"],
				["vibrancy", "under-window"],
			],
		);
		electron.calls.length = 0;
		const off = await invoke("window-glass:set", b.window, { enabled: false });
		assert.equal(off.active, false);
		assert.ok(
			electron.calls.some((c) => c[0] === "vibrancy" && c[1] === null),
			"disabling removes the vibrancy view",
		);
		assert.ok(
			bgCalls().includes(COLORS.ground),
			"and puts the palette ground back",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-4 Reduce transparency while glass is live tears the material down, and off brings the user's setting back, material included (R1, R4)", async () => {
	const dir = profile({
		enabled: true,
		coverage: "full",
		intensity: 50,
		material: "menu",
	});
	const b = boot(dir);
	try {
		electron.calls.length = 0;
		electron.nativeTheme.prefersReducedTransparency = true;
		electron.emitNativeThemeUpdated();
		assert.ok(
			electron.calls.some((c) => c[0] === "vibrancy" && c[1] === null),
			"the vibrancy view is removed when the capability drops to none",
		);
		assert.ok(
			bgCalls().includes(COLORS.ground),
			"and the opaque palette ground is restored",
		);
		assert.equal(
			electron.nativeTheme.themeSource,
			"system",
			"the tone pin is released",
		);

		const during = await invoke("window-glass:get", b.window);
		assert.equal(during.active, false);
		assert.equal(
			during.settings.material,
			"menu",
			"the stored material is kept while unsupported",
		);

		electron.calls.length = 0;
		electron.nativeTheme.prefersReducedTransparency = false;
		electron.emitNativeThemeUpdated();
		assert.deepEqual(
			electron.calls.filter((c) => c[0] === "vibrancy"),
			[["vibrancy", "menu"]],
			"turning it off re-applies the user's own material, not the default",
		);
		const after = await invoke("window-glass:get", b.window);
		assert.equal(after.active, true);
		assert.equal(after.settings.material, "menu");
		const persisted = JSON.parse(
			readFileSync(join(dir, "window-glass.json"), "utf8"),
		);
		assert.equal(persisted.settings.material, "menu");
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-5 a launch under Reduce transparency keeps the stored material for later", () => {
	const dir = profile({
		enabled: true,
		coverage: "full",
		intensity: 50,
		material: "popover",
	});
	const b = boot(dir, { reduced: true });
	try {
		assert.equal(b.glass.state.active, false);
		assert.equal(b.glass.settings.material, "popover");
		assert.deepEqual(
			bgCalls(),
			[COLORS.ground],
			"opaque launch: palette ground, no transparency",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-6 an unwritable profile is said once and the in-memory state still applies (R9)", async () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		/* Make the write fail: the profile path becomes a file. */
		rmSync(dir, { recursive: true, force: true });
		writeFileSync(dir, "not a directory");
		const state = await invoke("window-glass:set", b.window, { enabled: true });
		assert.equal(state.active, true, "this run still gets the glass");
		assert.ok(
			b.logs.some((l) => /could not be saved/.test(l)),
			"the failed save is logged, not swallowed",
		);
	} finally {
		b.restore();
		rmSync(dir, { force: true });
	}
});

test("M-7 Windows: a window launched with glass can go off and on again and the material is not hidden behind an opaque ground (R2-2)", async () => {
	const dir = profile({
		enabled: true,
		coverage: "full",
		intensity: 50,
		material: "mica",
	});
	const b = boot(dir, { platform: "win32", osVersion: "10.0.22621" });
	try {
		assert.equal(b.glass.capability.mechanism, "background-material");
		electron.calls.length = 0;
		await invoke("window-glass:set", b.window, { enabled: false });
		assert.ok(
			electron.calls.some((c) => c[0] === "material" && c[1] === "none"),
			"off removes the material",
		);
		assert.equal(
			bgCalls().at(-1),
			COLORS.ground,
			"and leaves the palette ground in place",
		);
		electron.calls.length = 0;
		await invoke("window-glass:set", b.window, { enabled: true });
		const order = electron.calls
			.filter((c) => c[0] === "bg" || c[0] === "material")
			.map((c) => c.join(":"));
		assert.deepEqual(
			order,
			["bg:#00000000", "material:mica"],
			"re-enable makes the ground transparent first, then applies the material",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});
