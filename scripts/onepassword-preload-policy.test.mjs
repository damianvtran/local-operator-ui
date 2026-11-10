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
const sentinel = "SYNTHETIC-SECRET-NEVER-LOG";
for (const type of ["renderer", "service-worker"]) {
	test(`${type}: denied native Port disconnects once and send rejects without payload logs`, async () => {
		const calls = [];
		const logs = [];
		const ipcRenderer = new EventEmitter();
		ipcRenderer.send = (...args) => calls.push(args);
		ipcRenderer.invoke = async (_channel, _extensionId, operation) => {
			calls.push([operation]);
			if (operation === "tabs.get")
				throw new Error("Unable to find tab SYNTHETIC-ERROR-PAYLOAD");
			if (operation === "notifications.create")
				return { notificationDenied: true };
			if (
				operation.startsWith("runtime.") &&
				operation !== "runtime.disconnectNative"
			)
				return { nativeMessagingDenied: true };
			return sentinel;
		};

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
		const nativeAlarms = { getAll: async () => "native-browser-promise" };
		const nativeEvent = { addListener() {} };
		const nativeManifest = () => ({
			manifest_version: 3,
			permissions: ["nativeMessaging", "tabs", "notifications"],
		});
		const nativeBrowser = {
			runtime: {
				id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				getManifest: nativeManifest,
				sendNativeMessage() {
					throw new Error("Native browser policy bypass");
				},
				connectNative() {
					throw new Error("Native browser policy bypass");
				},
			},
			alarms: nativeAlarms,
		};
		const context = vm.createContext({
			browser: nativeBrowser,
			require: () => electron,
			process: { type, contextIsolated: true },
			location: {
				href: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html",
			},
			chrome: {
				alarms: nativeAlarms,
				i18n: { getMessage: () => "" },
				runtime: {
					id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					getManifest: nativeManifest,
					onMessage: nativeEvent,
				},
			},
			crypto: { randomUUID: () => "synthetic-port" },
			console: Object.fromEntries(
				["log", "debug", "warn", "error"].map((name) => [
					name,
					(...args) => logs.push(args),
				]),
			),
		});
		let genuineLastError;
		Object.defineProperty(context.chrome.runtime, "lastError", {
			enumerable: true,
			configurable: false,
			get: () => genuineLastError,
		});
		vm.runInContext(preload, context);
		assert.equal(
			logs.length,
			0,
			logs.map((args) => args.map(String).join(" ")).join("\n"),
		);
		assert.equal(context.browser, context.chrome);
		assert.equal(context.browser.runtime.id, context.chrome.runtime.id);
		assert.equal(context.browser.runtime.getManifest, nativeManifest);
		assert.equal(context.browser.runtime.onMessage, nativeEvent);
		assert.equal(context.browser.alarms, nativeAlarms);
		assert.equal(
			await context.browser.alarms.getAll(),
			"native-browser-promise",
		);
		assert.equal(context.browser.windows.WINDOW_ID_NONE, -1);
		await assert.rejects(
			context.browser.runtime.sendNativeMessage("synthetic-native-app", {}),
			{ message: "Native messaging is disabled by browser policy" },
		);
		const runtime = context.chrome.runtime;
		let disconnects = 0;
		const port = runtime.connectNative(sentinel);
		let disconnectError;
		port.onDisconnect.addListener(() => {
			disconnects++;
			disconnectError = runtime.lastError?.message;
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(disconnects, 1);
		assert.equal(
			disconnectError,
			"Native messaging is disabled by browser policy",
		);
		port.disconnect();
		assert.equal(disconnects, 1);
		assert.equal(
			disconnectError,
			"Native messaging is disabled by browser policy",
		);
		assert.equal(ipcRenderer.listenerCount("crx-native-msg-synthetic-port"), 0);
		assert.equal(
			ipcRenderer.listenerCount("crx-native-msg-synthetic-port-disconnect"),
			0,
		);
		await assert.rejects(
			runtime.sendNativeMessage(sentinel, { secret: sentinel }),
			{ message: "Native messaging is disabled by browser policy" },
		);
		let lastError;
		await new Promise((resolve) =>
			runtime.sendNativeMessage(sentinel, {}, () => {
				lastError = runtime.lastError?.message;
				resolve();
			}),
		);
		assert.equal(lastError, "Native messaging is disabled by browser policy");
		assert.equal(runtime.lastError, undefined);
		await assert.rejects(
			context.chrome.notifications.create({ message: "SYNTHETIC-NOTICE" }),
			{ message: "Notifications are disabled by browser policy" },
		);
		let notificationError;
		await new Promise((resolve) =>
			context.chrome.notifications.create({}, () => {
				notificationError = runtime.lastError?.message;
				resolve();
			}),
		);
		assert.equal(
			notificationError,
			"Notifications are disabled by browser policy",
		);
		genuineLastError = { message: "Synthetic real native callback failure" };
		assert.equal(runtime.lastError, genuineLastError);
		genuineLastError = undefined;
		assert.equal(runtime.lastError, undefined);
		await context.chrome.tabs.query({ sentinel });
		assert.equal(JSON.stringify(logs).includes(sentinel), false);
		assert.equal(logs.length, 0);
		await context.chrome.tabs.get(999);
		assert.deepEqual(logs, [
			["Extension API request failed", "tabs.get", "tab-unavailable"],
		]);
		assert.equal(
			JSON.stringify(logs).includes("SYNTHETIC-ERROR-PAYLOAD"),
			false,
		);
		assert.ok(calls.some((call) => call[0] === "runtime.connectNative"));
	});
}
