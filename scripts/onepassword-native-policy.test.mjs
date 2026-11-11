import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const require = createRequire(import.meta.url);
const packageRequire = createRequire(
	require.resolve("electron-chrome-extensions"),
);
const root = dirname(
	dirname(dirname(require.resolve("electron-chrome-extensions"))),
);
const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sentinel = "SYNTHETIC-SECRET-DO-NOT-LOG";
function ipc() {
	const emitter = new EventEmitter();
	emitter.handlers = new Map();
	emitter.handle = (name, fn) => emitter.handlers.set(name, fn);
	return emitter;
}
async function adapter(
	format,
	allowed,
	permissions = ["nativeMessaging"],
	extra = {},
) {
	const handlers = ipc();
	const logs = [];
	let hostAccess = 0;
	const extension = {
		id: extensionId,
		manifest: {
			permissions,
			manifest_version: 3,
			action: { default_popup: "popup/index.html" },
		},
		url: `chrome-extension://${extensionId}/`,
		path: "/synthetic",
	};
	const ses = Object.assign(new EventEmitter(), {
		extensions: Object.assign(new EventEmitter(), {
			getExtension: () => extension,
			getAllExtensions: () => [extension],
		}),
		serviceWorkers: new EventEmitter(),
		cookies: new EventEmitter(),
		registerPreloadScript() {},
		getPreloads: () => [],
		isPersistent: () => true,
		protocol: { handle() {} },
	});
	const electron = {
		app: Object.assign(new EventEmitter(), {
			getPath: () => "/synthetic",
			isReady: () => true,
		}),
		ipcMain: handlers,
		session: { defaultSession: ses },
		nativeTheme: new EventEmitter(),
		webContents: { getAllWebContents: () => [] },
	};
	const file = join(
		root,
		"dist",
		format === "cjs" ? "cjs/index.js" : "esm/index.mjs",
	);
	let code = readFileSync(file, "utf8");
	if (format === "esm")
		code = (await transform(code, { format: "cjs", platform: "node" })).code;
	const module = { exports: {} };
	vm.runInNewContext(code, {
		module,
		exports: module.exports,
		__dirname: dirname(file),
		__filename: file,
		process,
		Buffer,
		URL,
		fetch,
		Response,
		setTimeout,
		clearTimeout,
		queueMicrotask,
		console: Object.fromEntries(
			["log", "warn", "error", "debug"].map((name) => [
				name,
				(...args) => logs.push(args),
			]),
		),
		require: (id) => {
			if (id === "electron") return electron;
			if (id === "debug")
				return Object.assign(
					() =>
						(...args) =>
							logs.push(args),
					{ formatters: {} },
				);
			if (id === "node:child_process")
				return {
					spawn() {
						hostAccess++;
						throw new Error("synthetic spawn reached");
					},
				};
			if (id === "node:fs")
				return {
					...require(id),
					promises: {
						...require(id).promises,
						async readFile() {
							hostAccess++;
							throw Object.assign(new Error("synthetic host lookup reached"), {
								code: "ENOENT",
							});
						},
					},
				};
			return packageRequire(id);
		},
	});
	const options = { session: ses, modulePath: root, ...extra };
	if (allowed !== undefined) options.allowNativeMessaging = allowed;
	const instance = new module.exports.ElectronChromeExtensions(options);
	return {
		ses,
		handlers,
		logs,
		instance,
		electron,
		extension,
		hostAccess: () => hostAccess,
	};
}
for (const format of ["cjs", "esm"]) {
	test(`${format}: native notifications default deny before construction with explicit true synthetic control`, async () => {
		for (const allowed of [undefined, false, true]) {
			const rig = await adapter(
				format,
				false,
				["notifications"],
				allowed === undefined ? {} : { allowNotifications: allowed },
			);
			let constructed = 0;
			let shown = 0;
			rig.electron.Notification = class extends EventEmitter {
				constructor() {
					super();
					constructed++;
				}
				show() {
					shown++;
				}
			};
			const sender = {
				session: rig.ses,
				getURL: () => `${rig.extension.url}popup/index.html`,
			};
			const result = await rig.handlers.handlers.get("crx-msg")(
				{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
				extensionId,
				"notifications.create",
				{
					type: "basic",
					iconUrl: "data:image/png;base64,AA==",
					title: "SYNTHETIC-NOTIFICATION-TITLE",
					message: "SYNTHETIC-NOTIFICATION-BODY",
				},
			);
			assert.equal(constructed, allowed === true ? 1 : 0);
			assert.equal(shown, allowed === true ? 1 : 0);
			if (allowed !== true) assert.equal(result.notificationDenied, true);
			assert.equal(
				JSON.stringify(rig.logs).includes("SYNTHETIC-NOTIFICATION-BODY"),
				false,
			);
		}
	});
	test(`${format}: public action popup override prevents dependency owned window creation`, async () => {
		const requests = [];
		const rig = await adapter(format, false, ["nativeMessaging"], {
			openActionPopup: (details) => requests.push(details),
		});
		let nativeWindows = 0;
		const parent = Object.assign(new EventEmitter(), {
			id: 7,
			isDestroyed: () => false,
			isFocused: () => true,
			getSize: () => [1280, 720],
			getBounds: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
			getPosition: () => [0, 0],
			isAlwaysOnTop: () => false,
			isFullScreen: () => false,
			isMinimized: () => false,
			isMaximized: () => false,
		});
		const tab = Object.assign(new EventEmitter(), {
			id: 10,
			session: rig.ses,
			isDestroyed: () => false,
			isCurrentlyAudible: () => false,
			isLoading: () => false,
			getTitle: () => "Synthetic",
			getURL: () =>
				"https://example.test/sign-in?code=SYNTHETIC-URL-QUERY#SYNTHETIC-URL-FRAGMENT",
			getType: () => "window",
		});
		rig.electron.BrowserWindow = class {
			constructor() {
				nativeWindows++;
				throw new Error("Uncontrolled native popup");
			}
			static getAllWindows() {
				return [parent];
			}
			static getFocusedWindow() {
				return parent;
			}
		};
		rig.electron.webContents.fromId = (id) => (id === tab.id ? tab : undefined);
		rig.instance.addTab(tab, parent);
		rig.ses.extensions.emit("extension-loaded", {}, rig.extension);
		const event = {
			type: "frame",
			sender: {
				session: rig.ses,
				getURL: () => `${rig.extension.url}popup/index.html`,
			},
			senderFrame: { url: `${rig.extension.url}popup/index.html` },
		};
		await rig.handlers.handlers.get("crx-msg")(
			event,
			extensionId,
			"browserAction.openPopup",
			{ windowId: parent.id },
		);
		assert.equal(nativeWindows, 0);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].extensionId, extensionId);
		assert.equal(requests[0].url, `${rig.extension.url}popup/index.html`);
		assert.equal(requests[0].parent, parent);
		const frame = { parent: null, processId: 1, routingId: 2 };
		frame.top = frame;
		tab.emit("did-start-navigation", {
			url: tab.getURL(),
			isSameDocument: false,
			frame,
		});
		const background = Object.assign(new EventEmitter(), {
			session: rig.ses,
			getType: () => "backgroundPage",
			getURL: tab.getURL,
		});
		rig.electron.app.emit("web-contents-created", {}, background);
		assert.equal(
			JSON.stringify(rig.logs).includes("SYNTHETIC-URL-QUERY"),
			false,
		);
		assert.equal(
			JSON.stringify(rig.logs).includes("SYNTHETIC-URL-FRAGMENT"),
			false,
		);
	});
	for (const allowed of [undefined, false]) {
		test(`${format}: native host access denied by default and explicit false`, async () => {
			const rig = await adapter(format, allowed);
			for (const type of ["frame", "service-worker"]) {
				const sender = {
					session: rig.ses,
					getURL: () => `chrome-extension://${extensionId}/popup.html`,
					send() {},
					isDestroyed: () => false,
				};
				const worker = {
					...sender,
					scope: `chrome-extension://${extensionId}/`,
					ipc: ipc(),
				};
				rig.ses.serviceWorkers.getWorkerFromVersionID = () => worker;
				rig.ses.serviceWorkers.emit("running-status-changed", {
					runningStatus: "starting",
					versionId: 1,
				});
				const route = type === "frame" ? rig.handlers : worker.ipc;
				const event = {
					type,
					sender,
					senderFrame: { url: sender.getURL() },
					session: rig.ses,
					serviceWorker: worker,
				};
				for (let attempt = 0; attempt < 2; attempt++) {
					for (const [operation, args] of [
						["runtime.connectNative", ["connection", `../../${sentinel}`]],
						[
							"runtime.sendNativeMessage",
							[`../../${sentinel}`, { secret: sentinel }],
						],
					]) {
						const result = await route.handlers.get("crx-msg")(
							event,
							extensionId,
							operation,
							...args,
						);
						assert.equal(result.nativeMessagingDenied, true);
					}
				}
			}
			assert.equal(rig.hostAccess(), 0);
			assert.equal(JSON.stringify(rig.logs).includes(sentinel), false);
		});
	}
	test(`${format}: explicit true reaches synthetic native lookup negative control`, async () => {
		const rig = await adapter(format, true);
		const sender = {
			session: rig.ses,
			getURL: () => `chrome-extension://${extensionId}/popup.html`,
			ipc: ipc(),
			send() {},
		};
		await rig.handlers.handlers.get("crx-msg")(
			{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
			extensionId,
			"runtime.connectNative",
			"synthetic-connection",
			"synthetic-app",
		);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(rig.hostAccess() > 0);
	});
	test(`${format}: missing nativeMessaging permission still rejected`, async () => {
		const rig = await adapter(format, false, []);
		const sender = {
			session: rig.ses,
			getURL: () => `chrome-extension://${extensionId}/popup.html`,
		};
		await assert.rejects(
			rig.handlers.handlers.get("crx-msg")(
				{ type: "frame", sender, senderFrame: { url: sender.getURL() } },
				extensionId,
				"runtime.sendNativeMessage",
				"app",
				{},
			),
		);
		assert.equal(rig.hostAccess(), 0);
	});
}
