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
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
export const appListeners = [];
/* Mutable GPU facts: a test flips them, emits the event, and watches main re-decide. */
export const gpuFacts = {
	acceleration: true,
	compositing: "enabled",
	rasterization: "enabled",
	disableGpu: false,
};
export const app = {
	commandLine: {
		hasSwitch: (name) => (name === "disable-gpu" ? gpuFacts.disableGpu : false),
	},
	isHardwareAccelerationEnabled: () => gpuFacts.acceleration,
	getGPUFeatureStatus: () => ({
		gpu_compositing: gpuFacts.compositing,
		rasterization: gpuFacts.rasterization,
	}),
	on: (e, f) => appListeners.push([e, f]),
	removeListener: () => {},
};
export const emitGpuInfoUpdate = () => {
	for (const [e, f] of appListeners) if (e === "gpu-info-update") f();
};
export const emitChildProcessGone = (details) => {
	for (const [e, f] of appListeners) if (e === "child-process-gone") f({}, details);
};
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
/* Listeners the MODULE registered at import (the GPU-readiness flag). `boot`
 * clears per-controller listeners; this is how many belong to the module. */
const MODULE_APP_LISTENERS = electron.appListeners.length;

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

/**
 * A profile directory, optionally with a persisted glass file.
 *
 * The default shape is the LEGACY one (no `explicit`): every field in it is
 * preserved, which is what the pre-flip tests meant by "this is the user's value".
 * A test about the flip's unset path passes `null` and gets a truly fresh profile;
 * one about the new schema passes `{ version: 2, explicit }`.
 */
function profile(settings, { version, explicit } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "glass-main-"));
	if (settings)
		writeFileSync(
			join(dir, "window-glass.json"),
			JSON.stringify({
				...(version ? { version } : {}),
				settings,
				...(explicit ? { explicit } : {}),
				scheme: "dark",
			}),
		);
	return dir;
}

/** Boot the real surface attach against the stubbed Electron. */
function boot(
	dir,
	{
		reduced = false,
		platform = "darwin",
		osVersion = "27.0.1",
		environment,
	} = {},
) {
	electron.calls.length = 0;
	electron.appListeners.length = MODULE_APP_LISTENERS;
	Object.assign(electron.gpuFacts, {
		acceleration: true,
		compositing: "enabled",
		rasterization: "enabled",
		disableGpu: false,
	});
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
			environment,
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

test("M-2 an explicitly-OFF launch paints the palette ground and touches no material", () => {
	const dir = profile(
		{ enabled: false, coverage: "full", intensity: 40, material: "window" },
		{ version: 2, explicit: ["enabled", "coverage", "intensity", "material"] },
	);
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
	const dir = profile(
		{ enabled: false, coverage: "full", intensity: 40, material: "window" },
		{ version: 2, explicit: ["enabled"] },
	);
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
	const dir = profile(
		{ enabled: false, coverage: "full", intensity: 40, material: "window" },
		{ version: 2, explicit: ["enabled"] },
	);
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

/*
 * WINDOWS IS GREYED NOW (unverified), so the shipped gate cannot reach the
 * background-material branch. The mechanism's mapping is driven at the pure level
 * (`window-glass.test.mjs`, G-4); what matters here is the SECOND enforcement:
 * a Windows profile that still says enabled:true must not make the window
 * transparent, and the state must report the unverified reason.
 */
test("M-7 Windows: a stale enabled value is inert and names the unverified gate", () => {
	const dir = profile({
		enabled: true,
		coverage: "full",
		intensity: 50,
		material: "mica",
	});
	const b = boot(dir, { platform: "win32", osVersion: "10.0.22631" });
	try {
		assert.equal(b.glass.capability.reason, "windows-unverified");
		assert.equal(b.glass.state.active, false);
		assert.equal(b.surface.glass.isActive(), false);
		assert.deepEqual(
			bgCalls(),
			[COLORS.ground],
			"the palette ground, never the transparent one",
		);
		assert.equal(
			electron.calls.filter((c) => c[0] === "material").length,
			0,
			"no background material is ever applied",
		);
		assert.equal(b.glass.settings.enabled, true, "the stored choice is kept");
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

/*
 * THE CONTRACT IS "RECORDS NO EXPLICIT CHOICE", not "writes no file": a light
 * palette makes the theme provider's scheme report persist
 * `{version:2, settings:<launch defaults>, explicit:[], scheme:"light"}` (QA
 * round 1, Q-3). This harness mounts no renderer, so on the dark path no file is
 * written at all; the assertion that matters is the empty `explicit` list.
 */
test("M-8 a fresh profile starts translucent at 80 and records no explicit choice", () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		assert.equal(b.glass.capability.defaultEnabled, true);
		assert.equal(b.glass.state.active, true);
		assert.equal(b.glass.settings.intensity, 80);
		assert.equal(b.glass.settings.enabled, true);
		assert.deepEqual(
			bgCalls(),
			["#00000000"],
			"the first paint is the transparent ground, not the palette one",
		);
		/*
		 * No renderer here, so the dark path writes nothing. A real light launch may
		 * write the scheme report; what must never happen is a non-empty `explicit`,
		 * because that would freeze today's default as a choice.
		 */
		assert.equal(
			existsSync(join(dir, "window-glass.json")),
			false,
			"no scheme report in this harness: the launch itself writes nothing",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-9 an explicit OFF survives a launch, and a later unrelated write does not re-enable it", async () => {
	const dir = profile(
		{ enabled: false, coverage: "full", intensity: 40, material: "window" },
		{ version: 2, explicit: ["enabled"] },
	);
	const b = boot(dir);
	try {
		assert.equal(b.glass.state.active, false);
		assert.deepEqual(bgCalls(), [COLORS.ground]);
		const after = await invoke("window-glass:set", b.window, { intensity: 50 });
		assert.equal(
			after.active,
			false,
			"moving the slider does not turn glass on",
		);
		assert.equal(after.settings.enabled, false);
		const persisted = JSON.parse(
			readFileSync(join(dir, "window-glass.json"), "utf8"),
		);
		assert.equal(persisted.version, 2);
		assert.deepEqual(
			[...persisted.explicit].sort(),
			["enabled", "intensity"],
			"only the fields the user actually set are recorded as chosen",
		);
		assert.equal(persisted.settings.enabled, false);
		assert.equal(persisted.settings.intensity, 50);
		/* The next launch keeps the explicit OFF and the chosen intensity. */
		const next = mod.resolveLaunchWindowGlass({
			userDataDir: dir,
			platform: "darwin",
			osVersion: "27.0.1",
			reducedTransparency: false,
		});
		assert.equal(next.settings.enabled, false);
		assert.equal(next.settings.intensity, 50);
		assert.equal(next.state.active, false);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-10 a GPU drop at runtime falls back to opaque, and its return brings the user's setting back", async () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		assert.equal(b.glass.state.active, true);
		electron.calls.length = 0;
		electron.gpuFacts.compositing = "unavailable_software";
		electron.emitGpuInfoUpdate();
		assert.ok(
			electron.calls.some((c) => c[0] === "vibrancy" && c[1] === null),
			"the vibrancy view is removed when compositing goes software-only",
		);
		assert.ok(
			bgCalls().includes(COLORS.ground),
			"and the opaque palette ground is restored",
		);
		const during = await invoke("window-glass:get", b.window);
		assert.equal(during.active, false);
		assert.equal(during.capability.reason, "gpu-unavailable");
		assert.equal(
			during.restartRequired,
			false,
			"an unsupported fallback is not a restart-pending change (Q-1/D2)",
		);

		electron.calls.length = 0;
		electron.gpuFacts.compositing = "enabled";
		electron.emitGpuInfoUpdate();
		assert.deepEqual(
			electron.calls.filter((c) => c[0] === "vibrancy"),
			[["vibrancy", "under-window"]],
			"the capability returning re-applies the user's material, with no restart",
		);
		const after = await invoke("window-glass:get", b.window);
		assert.equal(after.active, true);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-11 the renderer's backdrop-filter answer is part of the gate, live", async () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		assert.equal(b.glass.state.active, true);
		const refused = await invoke("window-glass:renderer", b.window, {
			backdropFilter: false,
		});
		assert.equal(refused.active, false);
		assert.equal(refused.capability.reason, "backdrop-filter-unavailable");
		assert.equal(
			refused.restartRequired,
			false,
			"the row must not tell the user to restart after the window already fell back",
		);
		assert.equal(b.surface.glass.isActive(), false);
		assert.ok(
			electron.calls.some((c) => c[0] === "vibrancy" && c[1] === null),
			"the material is torn down",
		);
		const restored = await invoke("window-glass:renderer", b.window, {
			backdropFilter: true,
		});
		assert.equal(restored.active, true);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-12 a launch default is re-derived when the capability returns (R1-3)", async () => {
	const dir = profile(null);
	const b = boot(dir, { reduced: true });
	try {
		assert.equal(b.glass.state.active, false);
		assert.equal(b.glass.settings.enabled, false);
		electron.calls.length = 0;
		electron.nativeTheme.prefersReducedTransparency = false;
		electron.emitNativeThemeUpdated();
		const after = await invoke("window-glass:get", b.window);
		assert.equal(
			after.settings.enabled,
			true,
			"an unset enabled follows the capability back on, without a relaunch",
		);
		assert.equal(after.active, true);
		assert.equal(after.restartRequired, false);
		assert.ok(
			electron.calls.some(
				(c) => c[0] === "vibrancy" && c[1] === "under-window",
			),
			"the material is applied on the returning capability",
		);
		assert.equal(
			existsSync(join(dir, "window-glass.json")),
			false,
			"the re-derivation did not turn today's default into an explicit choice",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-13 a GPU child-process death re-checks the capability (R1-5)", async () => {
	const dir = profile(null);
	const b = boot(dir);
	try {
		electron.emitGpuInfoUpdate();
		assert.equal(b.glass.state.active, true);
		electron.calls.length = 0;
		electron.gpuFacts.compositing = "unavailable_software";
		electron.emitChildProcessGone({ type: "Utility" });
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(
			(await invoke("window-glass:get", b.window)).active,
			true,
			"a non-GPU child exiting changes nothing",
		);
		electron.emitChildProcessGone({ type: "GPU" });
		await new Promise((r) => setTimeout(r, 10));
		const after = await invoke("window-glass:get", b.window);
		assert.equal(after.active, false);
		assert.equal(after.capability.reason, "gpu-unavailable");
		assert.ok(
			electron.calls.some((c) => c[0] === "vibrancy" && c[1] === null),
			"the GPU trigger runs the same teardown as gpu-info-update",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("M-14 an explicit OFF stays off when the capability returns (R2-1)", async () => {
	const dir = profile(
		{ enabled: false, coverage: "full", intensity: 40, material: "window" },
		{ version: 2, explicit: ["enabled"] },
	);
	const b = boot(dir, { reduced: true });
	try {
		assert.equal(b.glass.state.active, false);
		electron.calls.length = 0;
		electron.nativeTheme.prefersReducedTransparency = false;
		electron.emitNativeThemeUpdated();
		const after = await invoke("window-glass:get", b.window);
		assert.equal(
			after.settings.enabled,
			false,
			"the re-derivation must not overturn a chosen OFF",
		);
		assert.equal(after.active, false);
		assert.equal(
			electron.calls.filter((c) => c[0] === "vibrancy").length,
			0,
			"no material is applied over the explicit OFF",
		);
	} finally {
		b.restore();
		rmSync(dir, { recursive: true, force: true });
	}
});
