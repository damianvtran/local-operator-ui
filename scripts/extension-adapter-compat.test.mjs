// MV3 compatibility fixes carried in patches/electron-chrome-extensions@4.10.0.patch
// (the installed, patched dist is what runs here — not a copy):
// 1. Service workers: clients.matchAll defaults includeUncontrolled:true, because
//    Electron never puts extension pages under the worker's control. Without it
//    1Password's worker found no window clients and its popup stayed "Loading…"
//    (popup-hang lane, session 0808ecf0563b, op7-shim proof).
// 2. windows.getCurrent / getLastFocused never resolve null (MV3 workers threw
//    "Cannot read properties of null (reading 'id')" with no focused window).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const root = dirname(
	dirname(dirname(require.resolve("electron-chrome-extensions"))),
);
const preload = readFileSync(
	join(root, "dist/chrome-extension-api.preload.js"),
	"utf8",
);

function runPreload(type, href) {
	const seen = [];
	const clients = {
		matchAll(options) {
			seen.push(options);
			return Promise.resolve([]);
		},
	};
	const context = vm.createContext({
		require: () => electron,
		process: { type, contextIsolated: true },
		location: { href },
		clients,
		chrome: {
			i18n: { getMessage: () => "" },
			runtime: {
				id: "a".repeat(32),
				getManifest: () => ({ manifest_version: 3 }),
				onMessage: { addListener() {} },
			},
		},
		crypto: { randomUUID: () => "synthetic" },
		console: { log() {}, debug() {}, warn() {}, error() {} },
	});
	const ipcRenderer = Object.assign(new EventEmitter(), {
		send() {},
		invoke: async () => undefined,
	});
	const electron = {
		ipcRenderer,
		contextBridge: {
			exposeInMainWorld(name, value) {
				context[name] = value;
			},
			executeInMainWorld({ func }) {
				return vm.runInContext(`(${func.toString()})()`, context);
			},
		},
	};
	vm.runInContext(preload, context);
	return { context, seen };
}

test("extension worker: window-client queries include uncontrolled extension pages", async () => {
	const { context, seen } = runPreload(
		"service-worker",
		`chrome-extension://${"a".repeat(32)}/background.js`,
	);
	await context.clients.matchAll({ type: "window" });
	await context.clients.matchAll();
	// An explicit caller choice is respected.
	await context.clients.matchAll({
		type: "window",
		includeUncontrolled: false,
	});
	assert.deepEqual(JSON.parse(JSON.stringify(seen)), [
		{ type: "window", includeUncontrolled: true },
		{ includeUncontrolled: true },
		{ type: "window", includeUncontrolled: false },
	]);
});

test("extension pages (renderer) are left untouched", async () => {
	const { context, seen } = runPreload(
		"renderer",
		`chrome-extension://${"a".repeat(32)}/popup.html`,
	);
	await context.clients.matchAll({ type: "window" });
	assert.deepEqual(JSON.parse(JSON.stringify(seen)), [{ type: "window" }]);
});

function getLastFocusedFrom(file) {
	const source = readFileSync(join(root, file), "utf8");
	const match = /\n {2}getLastFocused\(event\) \{\n([\s\S]*?)\n {2}\}\n/.exec(
		source,
	);
	assert.ok(match, `getLastFocused not found in ${file}`);
	return new Function(
		"_WindowsAPI",
		`return function getLastFocused(event) {\n${match[1]}\n};`,
	)({
		WINDOW_ID_NONE: -1,
	});
}

for (const file of ["dist/cjs/index.js", "dist/esm/index.mjs"])
	test(`${file}: windows.getCurrent never resolves null`, () => {
		const getLastFocused = getLastFocusedFrom(file);
		const live = { id: 7, isDestroyed: () => false };
		const dead = { id: 6, isDestroyed: () => true };
		const api = (lastFocused, windows) => ({
			ctx: {
				store: {
					getLastFocusedWindow: () => lastFocused,
					windows: new Set(windows),
				},
			},
			getWindowDetails: (win) => ({ id: win.id }),
		});
		assert.deepEqual(getLastFocused.call(api(live, [live]), {}), { id: 7 });
		// Never focused (headless/background launch): fall back to a live window.
		assert.deepEqual(getLastFocused.call(api(null, [dead, live]), {}), {
			id: 7,
		});
		// No window at all: a WINDOW_ID_NONE stub, not null.
		const none = getLastFocused.call(api(null, [dead]), {});
		assert.equal(none.id, -1);
		assert.deepEqual(none.tabs, []);
	});

test("the pnpm patch ships policy-option declarations, not only locally edited installed types", () => {
	// A local .d.ts edit made the main typecheck pass while clean CI failed
	// TS2353 on allowNativeMessaging. The declarations must travel WITH the
	// runtime patch. Negative control: omitting the declaration diff fails even
	// when this developer's installed .d.ts already contains the fields.
	const patch = readFileSync(
		join(process.cwd(), "patches/electron-chrome-extensions@4.10.0.patch"),
		"utf8",
	);
	const declaration = patch.split(
		"diff --git a/dist/types/browser/index.d.ts b/dist/types/browser/index.d.ts",
	)[1];
	assert.ok(declaration, "clean-install declaration delta is present");
	for (const option of [
		"allowNativeMessaging",
		"allowNotifications",
		"openActionPopup",
	])
		assert.ok(declaration.includes(`+    ${option}?:`), option);
});
