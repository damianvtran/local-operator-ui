import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
const source = await readFile(
	new URL("./extension-api-diagnostic-preload.cjs", import.meta.url),
	"utf8",
);
test("diagnostic traces fixed API names while preserving receiver, promise identity and credential APIs", () => {
	const logs = [];
	const payload = { privateValue: "SYNTHETIC-NEVER-LOG" };
	const promise = Promise.resolve(payload);
	let receiver;
	let actualArgs;
	const sendMessage = function sendMessage(...args) {
		receiver = this;
		actualArgs = args;
		return promise;
	};
	const runtime = { sendMessage };
	const credentials = { get() {}, create() {} };
	const originalGet = credentials.get;
	vm.runInNewContext(source, {
		location: { href: "chrome-extension://synthetic/popup/index.html" },
		chrome: { runtime },
		navigator: { credentials },
		console: { debug: (name) => logs.push(name) },
		require: () => ({
			contextBridge: { executeInMainWorld: ({ func }) => func() },
		}),
	});
	assert.equal(runtime.sendMessage(payload), promise);
	assert.equal(receiver, runtime);
	assert.equal(actualArgs[0], payload);
	assert.equal(credentials.get, originalGet);
	assert.ok(logs.includes("LOP_API_CALL runtime.sendMessage"));
	assert.equal(JSON.stringify(logs).includes(payload.privateValue), false);
	assert.equal(runtime.sendMessage.name, sendMessage.name);
	assert.equal(runtime.sendMessage.length, sendMessage.length);
});
test("diagnostic preload does nothing on ordinary web pages", () => {
	let injection = 0;
	vm.runInNewContext(source, {
		location: { href: "https://example.test/" },
		require: () => ({
			contextBridge: {
				executeInMainWorld() {
					injection++;
				},
			},
		}),
	});
	assert.equal(injection, 0);
});
