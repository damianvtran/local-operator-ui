import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

const UNTRUSTED = /cannot change/;
const INVALID = /Invalid/;

const require = createRequire(import.meta.url);
const bundled = buildSync({
	stdin: {
		contents:
			'export { registerCompanionSettings } from "./src/main/companion-settings"; export { shouldOfferCompanion } from "./src/renderer/src/features/companion/companion-welcome-policy";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	write: false,
	platform: "node",
	format: "cjs",
	external: ["electron"],
}).outputFiles[0].text;

function fixture() {
	const handlers = new Map();
	const module = { exports: {} };
	runInNewContext(bundled, {
		module,
		exports: module.exports,
		URL,
		console,
		require: (name) =>
			name === "electron"
				? {
						ipcMain: {
							handle: (key, fn) => handlers.set(key, fn),
							removeHandler: (key) => handlers.delete(key),
						},
					}
				: require(name),
	});
	const frame = { url: "file:///app/index.html#/settings" };
	const contents = { mainFrame: frame };
	let owner = { webContents: contents, isDestroyed: () => false };
	const settings = {
		enabled: false,
		introduced: false,
		character: "sprout",
		characters: [],
	};
	let imports = 0;
	const changes = [];
	const dispose = module.exports.registerCompanionSettings(
		() => owner,
		"file:///app/index.html",
		{
			settings,
			updateSettings: (change) => changes.push(change),
			chooseCharacter: async () => {
				imports++;
			},
		},
	);
	return {
		handlers,
		changes,
		settings,
		dispose,
		imports: () => imports,
		replaceOwner: (next) => {
			owner = next;
		},
		trusted: { sender: contents, senderFrame: frame },
		policy: module.exports.shouldOfferCompanion,
	};
}

test("only the app's current main frame can read or change companion settings, even while hidden", async () => {
	const f = fixture();
	for (const channel of f.handlers.keys()) {
		for (const event of [
			{ sender: {}, senderFrame: f.trusted.senderFrame },
			{
				sender: f.trusted.sender,
				senderFrame: { url: "file:///app/index.html" },
			},
		])
			await assert.rejects(
				f.handlers.get(channel)(event, { enabled: true }),
				UNTRUSTED,
			);
	}
	assert.equal(
		await f.handlers.get("companion-settings:get")(f.trusted),
		f.settings,
	);
	await f.handlers.get("companion-settings:update")(f.trusted, {
		enabled: true,
	});
	assert.equal(f.changes.length, 1);
	await f.handlers.get("companion-settings:import")(f.trusted);
	assert.equal(f.imports(), 1);
	f.trusted.senderFrame.url = "https://example.com/";
	await assert.rejects(
		f.handlers.get("companion-settings:update")(f.trusted, { enabled: false }),
		UNTRUSTED,
	);
	f.replaceOwner(null);
	await assert.rejects(
		f.handlers.get("companion-settings:get")(f.trusted),
		UNTRUSTED,
	);
	f.dispose();
	assert.equal(f.handlers.size, 0);
});

test("settings refuses malformed or unsupported updates before they reach the controller", async () => {
	const f = fixture();
	const update = f.handlers.get("companion-settings:update");
	for (const change of [
		null,
		[],
		{},
		{ enabled: "true" },
		{ introduced: false },
		{ character: "" },
		{ character: "x".repeat(129) },
		{ enabled: true, position: { x: 0, y: 0 } },
		{ enabled: true, path: "/tmp/a.png" },
	]) {
		await assert.rejects(update(f.trusted, change), INVALID);
	}
	assert.deepEqual(f.changes, []);
	for (const change of [
		{ enabled: false },
		{ introduced: true },
		{ character: "inky" },
		{ enabled: true, character: "pixel", introduced: true },
	])
		await update(f.trusted, change);
	assert.equal(f.changes.length, 4);
});

test("the welcome waits for a returning user's quiet interaction and never follows skipped setup", () => {
	const { policy } = fixture();
	const ready = {
		decision: "returning",
		introduced: false,
		setupThisLaunch: false,
		onboardingActive: false,
		covered: false,
		visible: true,
		focused: true,
		editing: false,
	};
	assert.equal(policy(ready), true);
	for (const change of [
		{ decision: "pending" },
		{ decision: "first_time" },
		{ introduced: true },
		{ setupThisLaunch: true },
		{ onboardingActive: true },
		{ covered: true },
		{ visible: false },
		{ focused: false },
		{ editing: true },
	])
		assert.equal(
			policy({ ...ready, ...change }),
			false,
			JSON.stringify(change),
		);
});
