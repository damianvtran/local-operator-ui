// ExtensionManager lifecycle against a fake Electron session. The optional lane
// (EXTENSION_CRX = a genuine Chrome Web Store CRX of the official 1Password
// extension, obtained from the fixed store endpoint) drives the real verifier
// and extractor; the engine (loadExtension / service workers) is simulated.
// Ported from the single-vendor controller test; it never reads a profile.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const compiled = await build({
	stdin: {
		contents:
			'export * from "./src/main/browser/extensions/manager"; export { EXTENSION_STARTUP_DEADLINE_MS } from "./src/shared/browser-extensions";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["electron", "electron-chrome-extensions"],
	write: false,
});
const id = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const scope = `chrome-extension://${id}/`;
const REAL = process.env.EXTENSION_CRX;
const realCrx = REAL ? await readFile(REAL) : null;

async function fixture(t) {
	const root = await mkdtemp(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"extension-manager-test-",
		),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const state = {
		consent: true,
		removeConsent: true,
		prompts: [],
		removals: [],
		mode: "success",
		focused: true,
		visible: true,
		foregroundHuman: false,
		show: "focus",
		loads: 0,
		removed: [],
		cleared: [],
		fetches: 0,
		changed: 0,
		windows: [],
		options: null,
		fetcher: async () => new Response("not a signed package"),
	};
	class Window extends EventEmitter {
		constructor(options) {
			super();
			this.options = options;
			this.visible = false;
			this.focused = false;
			this.destroyed = false;
			this.url = "";
			this.webContents = Object.assign(new EventEmitter(), {
				getURL: () => this.url,
				setWindowOpenHandler: (callback) => {
					this.windowOpen = callback;
				},
			});
			state.windows.push(this);
		}
		async loadURL(url) {
			this.url = url;
		}
		isDestroyed() {
			return this.destroyed;
		}
		isVisible() {
			return this.visible;
		}
		isFocused() {
			return this.focused;
		}
		isMinimized() {
			return false;
		}
		show() {
			this.visible = true;
			this.focused = true;
		}
		showInactive() {
			this.visible = true;
		}
		hide() {
			this.visible = false;
		}
		restore() {}
		focus() {
			this.focused = true;
		}
		moveTop() {}
		close() {
			this.destroyed = true;
			this.visible = false;
			this.emit("closed");
		}
	}
	class Adapter {
		constructor(options) {
			state.options = options;
		}
		selectTab(contents) {
			state.mirrorSelections = state.mirrorSelections ?? [];
			state.mirrorSelections.push(contents.id);
		}
	}
	const workers = Object.assign(new EventEmitter(), {
		getInfoFromVersionID: () => ({ scope }),
		getAllRunning: () => (state.mode === "snapshot" ? { 1: { scope } } : {}),
		startWorkerForScope: async () => ({ scope }),
	});
	let loadStarted;
	const started = new Promise((yes) => {
		loadStarted = yes;
	});
	const loaded = new Map();
	const ses = {
		serviceWorkers: workers,
		clearStorageData: async (options) => {
			state.cleared.push({ ...options });
		},
		extensions: {
			removeExtension(extensionId) {
				state.removed.push(extensionId);
				loaded.delete(extensionId);
			},
			getExtension: (extensionId) => loaded.get(extensionId),
			async loadExtension(directory) {
				state.loads++;
				const manifest = JSON.parse(
					await readFile(join(directory, "manifest.json"), "utf8"),
				);
				loadStarted();
				queueMicrotask(() => {
					workers.emit("running-status-changed", {
						versionId: 1,
						runningStatus: "starting",
					});
					if (state.mode === "success")
						workers.emit("registration-completed", {}, { scope });
					if (state.mode === "failure")
						workers.emit("running-status-changed", {
							versionId: 1,
							runningStatus: "stopping",
						});
				});
				const extension = { id, manifest, path: directory };
				loaded.set(id, extension);
				return extension;
			},
		},
	};
	const module = { exports: {} };
	vm.runInNewContext(compiled.outputFiles[0].text, {
		module,
		exports: module.exports,
		process,
		Buffer,
		URL,
		performance,
		AbortController,
		AbortSignal,
		TextDecoder,
		TextEncoder,
		Response,
		setImmediate,
		clearImmediate,
		queueMicrotask,
		console,
		setTimeout: (fn, delay, ...args) => {
			state.deadline = { fn, delay };
			return setTimeout(fn, delay, ...args);
		},
		clearTimeout: (...args) => clearTimeout(...args),
		fetch: (...args) => {
			state.fetches++;
			return state.fetcher(...args);
		},
		require: (name) =>
			name === "electron"
				? {
						BrowserWindow: Window,
						screen: {
							getCursorScreenPoint: () => ({ x: 0, y: 0 }),
							getDisplayNearestPoint: () => ({
								workArea: { x: 0, y: 0, width: 1000, height: 1000 },
							}),
						},
					}
				: name === "electron-chrome-extensions"
					? { ElectronChromeExtensions: Adapter }
					: require(name),
	});
	const hooks = {
		root,
		backgroundThrottling: false,
		window: { isFocused: () => state.focused, isVisible: () => state.visible },
		get show() {
			return state.show;
		},
		confirmInstall: async (prompt) => {
			state.prompts.push(prompt);
			return state.consent;
		},
		confirmRemove: async (name) => {
			state.removals.push(name);
			return state.removeConsent;
		},
		changed: () => state.changed++,
		createTab: async (url, active) => {
			if (!state.allowTabs) throw new Error("No test navigation");
			state.created = state.created ?? [];
			state.created.push({ url, active });
			return { id: 23 };
		},
		selectTab(contents) {
			state.selections = state.selections ?? [];
			state.selections.push(contents.id);
		},
		activeTab: () => ({ id: 100 }),
		removeTab() {},
		mayPresentExtensionPopup: () => state.foregroundHuman,
	};
	const manager = new module.exports.ExtensionManager(ses, hooks);
	// The module runs in a vm context: project its arrays into this realm so
	// deepStrictEqual compares structure, not cross-realm prototypes.
	const list = manager.list.bind(manager);
	manager.list = () => JSON.parse(JSON.stringify(list()));
	t.after(() => manager.dispose());
	return {
		manager,
		state,
		root,
		workers,
		ses,
		started,
		hooks,
		module,
		exports: module.exports,
	};
}
const stateFile = async (root) =>
	JSON.parse(await readFile(join(root, "state.json"), "utf8"));

test("clean restore installs nothing; a cached CRX without a state entry is not consent", async (t) => {
	const { manager, state, root } = await fixture(t);
	await mkdir(join(root, id), { recursive: true });
	await writeFile(join(root, id, "official.crx"), "untrusted cached package");
	await manager.restore();
	assert.deepEqual(manager.list(), []);
	assert.equal(state.loads, 0);
	assert.equal(manager.storeStatus(id), "installable");
});

test("malformed state fails closed (not installed), never coerced into consent", async (t) => {
	const { manager, state, root } = await fixture(t);
	await writeFile(
		join(root, "state.json"),
		JSON.stringify({
			version: 1,
			extensions: { [id]: { enabled: "yes" }, "..": { enabled: true } },
		}),
	);
	await manager.restore();
	assert.deepEqual(manager.list(), []);
	assert.equal(state.loads, 0);
});

test("worker active:true and selectTab cannot replace the user's selected tab", async (t) => {
	const { state } = await fixture(t);
	state.allowTabs = true;
	await state.options.createTab({
		url: "https://example.test/welcome",
		active: true,
	});
	assert.equal(state.created[0].active, false);
	state.options.selectTab({ id: 23 });
	assert.deepEqual(state.selections ?? [], []);
	assert.deepEqual(state.mirrorSelections, [100]);
	// An unknown/not-installed extension's page never opens a window.
	await assert.rejects(
		state.options.createTab({
			url: `chrome-extension://${"b".repeat(32)}/x.html`,
		}),
	);
	assert.throws(() =>
		state.options.openActionPopup({
			extensionId: id,
			url: `${scope}popup.html`,
		}),
	);
	assert.equal(state.options.allowNativeMessaging, false);
	assert.equal(state.options.allowNotifications, false);
	assert.equal(await state.options.requestPermissions(), false);
});

test("late native tab/window callbacks are harmless after host detach", async (t) => {
	const { manager, state } = await fixture(t);
	await manager.dispose();
	assert.doesNotThrow(() => state.options.selectTab({ id: 1 }));
	assert.doesNotThrow(() => state.options.removeTab({ id: 1 }));
	assert.doesNotThrow(() =>
		state.options.removeWindow({
			isDestroyed: () => true,
			close() {
				throw new Error("dead native window");
			},
		}),
	);
	assert.equal(await manager.installFromStore(id), "install_in_progress");
});

test("download and signature failures never show a dialog or leave files", async (t) => {
	const { manager, state, root } = await fixture(t);
	state.fetcher = async () => {
		throw new Error("SYNTHETIC-PRIVATE-DATA");
	};
	assert.equal(await manager.installFromStore(id), "install_error");
	state.fetcher = async () => new Response("unsigned");
	assert.equal(await manager.installFromStore(id), "install_error");
	assert.equal(state.loads, 0);
	assert.deepEqual(state.prompts, []);
	assert.deepEqual(
		(await readdir(root)).filter((name) => name !== "state.json"),
		[],
	);
	assert.equal(await manager.installFromStore(".."), "invalid_id");
});

test("cancelling a stalled download aborts it and permits a new attempt", async (t) => {
	const { manager, state } = await fixture(t);
	let downloading;
	const begun = new Promise((yes) => {
		downloading = yes;
	});
	state.fetcher = (_url, options) =>
		new Promise((_yes, no) => {
			options.signal.addEventListener("abort", () => no(new Error("aborted")), {
				once: true,
			});
			downloading();
		});
	const pending = manager.installFromStore(id);
	await begun;
	assert.equal(await manager.installFromStore(id), "install_in_progress");
	manager.cancel(id);
	assert.equal(await pending, "user_cancelled");
	state.fetcher = async () => new Response("unsigned");
	assert.equal(await manager.installFromStore(id), "install_error");
});

const real = { skip: !REAL };

test(
	"store install: verified manifest drives the dialog; Cancel leaves nothing on disk",
	real,
	async (t) => {
		const { manager, state, root } = await fixture(t);
		state.fetcher = async () => new Response(realCrx);
		state.consent = false;
		assert.equal(await manager.installFromStore(id), "user_cancelled");
		assert.equal(state.prompts.length, 1);
		const [prompt] = state.prompts;
		assert.equal(prompt.kind, "install");
		assert.equal(prompt.id, id);
		assert.ok(!prompt.name.startsWith("__MSG_"));
		assert.match(prompt.version, /^\d+(\.\d+){1,3}$/);
		// 1Password's verified manifest asks for every site: stated explicitly.
		assert.equal(prompt.access.allSites, true);
		assert.equal(state.loads, 0);
		assert.deepEqual(await readdir(root), []);
		assert.deepEqual(manager.list(), []);
	},
);

test(
	"store install → popup policy → disable keeps data → restart → enable asks again → remove clears",
	real,
	async (t) => {
		const rig = await fixture(t);
		const { manager, state, root } = rig;
		state.fetcher = async () => new Response(realCrx);
		assert.equal(await manager.installFromStore(id), "success");
		assert.equal(await manager.installFromStore(id), "already_installed");
		let [row] = manager.list();
		assert.equal(row.status, "enabled");
		assert.equal(row.allSites, true);
		assert.ok((await readdir(join(root, id))).includes("official.crx"));
		const saved = await stateFile(root);
		assert.equal(saved.extensions[id].enabled, true);
		assert.equal(saved.extensions[id].consented.allSites, true);
		assert.equal(manager.storeStatus(id), "enabled");

		// A worker's action popup without a foreground user tab opens nothing.
		const popup = row.hasPopup ? manager.list()[0] : null;
		assert.ok(popup, "official package declares an action popup");
		const popupUrl = state.windows.length;
		state.options.openActionPopup({
			extensionId: id,
			url: `${scope}popup/index.html`,
		});
		await new Promise((yes) => setImmediate(yes));
		assert.equal(state.windows.length, popupUrl);
		assert.equal(await manager.openPopup(id), true);
		const window = state.windows.at(-1);
		assert.ok(window.url.startsWith(scope));
		assert.equal(window.options.webPreferences.sandbox, true);
		assert.equal(window.options.webPreferences.contextIsolation, true);
		assert.equal(window.options.webPreferences.nodeIntegration, false);
		// Navigation is confined to the extension's own origin.
		let prevented = false;
		window.webContents.emit(
			"will-navigate",
			{
				preventDefault: () => {
					prevented = true;
				},
			},
			`chrome-extension://${"b".repeat(32)}/x`,
		);
		assert.equal(prevented, true);

		await writeFile(
			join(root, id, "extension-owned-marker"),
			"synthetic storage",
		);
		assert.equal(await manager.setEnabled(id, false), true);
		assert.equal(manager.list()[0].status, "disabled");
		assert.equal(window.isDestroyed(), true);
		assert.ok(state.removed.includes(id));
		assert.equal(
			await readFile(join(root, id, "extension-owned-marker"), "utf8"),
			"synthetic storage",
		);
		assert.deepEqual(state.cleared, []);

		const restarted = await fixture(t);
		// Same root: copy the durable state into the second rig.
		for (const name of ["state.json"])
			await writeFile(
				join(restarted.root, name),
				await readFile(join(root, name)),
			);
		await mkdir(join(restarted.root, id), { recursive: true });
		await writeFile(join(restarted.root, id, "official.crx"), realCrx);
		await restarted.manager.restore();
		assert.equal(restarted.manager.list()[0].status, "disabled");
		assert.equal(restarted.state.loads, 0);
		restarted.state.consent = false;
		assert.equal(await restarted.manager.setEnabled(id, true), false);
		assert.equal(restarted.state.prompts.at(-1).kind, "enable");
		assert.equal(restarted.manager.list()[0].status, "disabled");
		restarted.state.consent = true;
		assert.equal(await restarted.manager.setEnabled(id, true), true);
		assert.equal(restarted.manager.list()[0].status, "enabled");

		restarted.state.removeConsent = false;
		assert.equal(await restarted.manager.uninstall(id), false);
		assert.equal(restarted.manager.list().length, 1);
		restarted.state.removeConsent = true;
		assert.equal(await restarted.manager.uninstall(id), true);
		assert.deepEqual(restarted.manager.list(), []);
		assert.deepEqual(restarted.state.cleared, [
			{ origin: `chrome-extension://${id}` },
		]);
		assert.deepEqual(
			(await readdir(restarted.root)).filter((name) => name !== "state.json"),
			[],
		);
		assert.deepEqual((await stateFile(restarted.root)).extensions, {});
		row = null;
	},
);

async function installedRig(t, mode, entry = {}) {
	const rig = await fixture(t);
	rig.state.mode = mode;
	await mkdir(join(rig.root, id), { recursive: true });
	await writeFile(join(rig.root, id, "official.crx"), realCrx);
	await writeFile(
		join(rig.root, "state.json"),
		JSON.stringify({
			version: 1,
			extensions: {
				[id]: {
					enabled: true,
					installedAt: 1,
					version: "8.12.44.33",
					name: "1Password",
					icon: null,
					// null = migrated consent, pinned to the verified manifest's
					// access on first load (so the rig matches the real package).
					consented: null,
					...entry,
				},
			},
		}),
	);
	return rig;
}

for (const mode of ["success", "snapshot"])
	test(
		`restore re-verifies the CRX and loads a fresh extraction: ${mode}`,
		real,
		async (t) => {
			const { manager, state, workers } = await installedRig(t, mode);
			await manager.restore();
			assert.equal(manager.list()[0].status, "enabled");
			assert.equal(state.loads, 1);
			assert.equal(workers.listenerCount("registration-completed"), 0);
			assert.equal(workers.listenerCount("running-status-changed"), 0);
		},
	);

test(
	"a worker that stops surfaces error:worker (loaded, not claimed working)",
	real,
	async (t) => {
		const { manager } = await installedRig(t, "failure");
		await manager.restore();
		const [row] = manager.list();
		assert.equal(row.status, "error");
		assert.equal(row.error, "worker");
	},
);

test(
	"a worker that never starts hits the measured deadline and reports error:worker",
	real,
	async (t) => {
		const rig = await installedRig(t, "hang");
		const restored = rig.manager.restore();
		await rig.started;
		await new Promise((yes) => setImmediate(yes));
		assert.equal(
			rig.state.deadline.delay,
			rig.exports.EXTENSION_STARTUP_DEADLINE_MS,
		);
		rig.state.deadline.fn();
		await restored;
		assert.equal(rig.manager.list()[0].error, "worker");
	},
);

test("a flipped CRX byte is error:verify and never loads", real, async (t) => {
	const { manager, state, root } = await installedRig(t, "success");
	const tampered = Buffer.from(realCrx);
	tampered[tampered.length - 1] ^= 1;
	await writeFile(join(root, id, "official.crx"), tampered);
	await manager.restore();
	assert.deepEqual(
		[manager.list()[0].status, manager.list()[0].error],
		["error", "verify"],
	);
	assert.equal(state.loads, 0);
});

test(
	"updates: equal version is refused; a newer one applies; more access waits for approval",
	real,
	async (t) => {
		const equal = await installedRig(t, "success");
		equal.state.fetcher = async () => new Response(realCrx);
		await equal.manager.restore();
		assert.equal(await equal.manager.checkUpdates(), 0);

		const older = await installedRig(t, "success", { version: "8.12.44.32" });
		older.state.fetcher = async () => new Response(realCrx);
		await older.manager.restore();
		assert.equal(await older.manager.checkUpdates(), 1);
		assert.equal(
			(await stateFile(older.root)).extensions[id].version,
			"8.12.44.33",
		);

		const narrower = await installedRig(t, "success", {
			version: "8.12.44.32",
			consented: { allSites: false, hosts: [], permissions: [] },
		});
		narrower.state.fetcher = async () => new Response(realCrx);
		await narrower.manager.restore();
		const loadsBefore = narrower.state.loads;
		assert.equal(await narrower.manager.checkUpdates(), 0);
		const [row] = narrower.manager.list();
		assert.equal(row.status, "needs-reconsent");
		assert.equal(row.pendingVersion, "8.12.44.33");
		assert.equal(row.version, "8.12.44.32");
		assert.equal(
			narrower.state.loads,
			loadsBefore,
			"old version keeps running",
		);
		assert.ok((await readdir(join(narrower.root, id))).includes("pending.crx"));
		// Approving shows the update dialog with the NEW access, then swaps.
		assert.equal(await narrower.manager.setEnabled(id, true), true);
		assert.equal(narrower.state.prompts.at(-1).kind, "update");
		assert.equal(narrower.state.prompts.at(-1).access.allSites, true);
		const after = narrower.manager.list()[0];
		assert.deepEqual(
			[after.status, after.version, after.pendingVersion],
			["enabled", "8.12.44.33", null],
		);
		assert.ok(
			!(await readdir(join(narrower.root, id))).includes("pending.crx"),
		);
	},
);

for (const [marker, expected] of [
	[true, "enabled"],
	[false, "disabled"],
	[null, null],
])
	test(
		`migration from the single-vendor layout keeps enabled=${marker}`,
		real,
		async (t) => {
			const { manager, root } = await fixture(t);
			await mkdir(join(root, "1password"), { recursive: true });
			await writeFile(join(root, "1password", "official.crx"), realCrx);
			await writeFile(
				join(root, "1password", "enabled.json"),
				JSON.stringify({ enabled: marker }),
			);
			await manager.restore();
			const rows = manager.list();
			if (expected === null) {
				assert.deepEqual(rows, []);
				return;
			}
			assert.equal(rows[0].status, expected);
			assert.deepEqual(
				await readdir(root).then((names) => names.includes("1password")),
				false,
			);
			if (marker)
				assert.equal(
					(await stateFile(root)).extensions[id].consented.allSites,
					true,
				);
		},
	);
