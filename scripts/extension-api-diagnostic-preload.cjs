/* Diagnostic-only public API tracing for a fresh, credential-free extension
 * profile. Fixed method NAMES only: no arguments, results, callbacks, credentials
 * or navigator.credentials interception. Reflect.apply preserves the original
 * return object/promise and receiver. This is never registered by product code. */
const { contextBridge } = require("electron");
if (location.href.startsWith("chrome-extension://")) {
	contextBridge.executeInMainWorld({
		func: () => {
			const names = [
				"runtime.sendMessage",
				"runtime.connect",
				"runtime.connectNative",
				"runtime.sendNativeMessage",
				"runtime.getPlatformInfo",
				"tabs.query",
				"tabs.get",
				"tabs.getCurrent",
				"tabs.update",
				"tabs.create",
				"tabs.sendMessage",
				"windows.getCurrent",
				"windows.getLastFocused",
				"windows.getAll",
				"windows.create",
				"windows.update",
				"storage.local.get",
				"storage.local.set",
				"storage.session.get",
				"storage.session.set",
				"management.getSelf",
				"notifications.create",
			];
			for (const name of names) {
				const parts = name.split(".");
				const key = parts.pop();
				let owner = globalThis.chrome;
				for (const part of parts) owner = owner?.[part];
				const original = owner?.[key];
				if (typeof original !== "function") {
					console.debug(`LOP_API_UNAVAILABLE ${name}`);
					continue;
				}
				const traced = function (...args) {
					console.debug(`LOP_API_CALL ${name}`);
					return Reflect.apply(original, this, args);
				};
				try {
					Object.defineProperty(traced, "name", { value: original.name });
					Object.defineProperty(traced, "length", { value: original.length });
					Object.defineProperty(owner, key, {
						value: traced,
						configurable: true,
						writable: true,
						enumerable: true,
					});
				} catch {
					console.debug(`LOP_API_TRACE_UNAVAILABLE ${name}`);
				}
			}
		},
	});
}
