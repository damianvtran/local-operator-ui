// Extension manager policy: consent access, version ordering, renderer IPC
// decoding, durable state parsing, and the Chrome Web Store bridge gate.
// Pure modules only (no Electron); the bridge is exercised with a fake ipcMain.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/shared/browser-extensions";',
			'export * from "./src/main/browser/extensions/policy";',
			'export * from "./src/main/browser/extensions/state";',
			'export * from "./src/main/browser/extensions/webstore";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	external: ["electron"],
	write: false,
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
	require,
	module,
	module.exports,
);
const {
	accessOf,
	accessGrew,
	compareExtensionVersions,
	isStrictUpgrade,
	decodeExtensionsRequest,
	readExtensionsState,
	isStoreSender,
	registerWebStoreBridge,
	WEBSTORE_CHANNELS,
} = module.exports;

const ID = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";

test("access comes from host_permissions, content-script matches and stray permission patterns", () => {
	assert.deepEqual(
		accessOf({
			permissions: ["storage", "tabs", "https://a.example/*"],
			host_permissions: ["https://b.example/*"],
			content_scripts: [{ matches: ["*://*.c.example/*"] }],
		}),
		{
			allSites: false,
			hosts: ["*.c.example", "a.example", "b.example"],
			permissions: ["storage", "tabs"],
		},
	);
	for (const pattern of ["<all_urls>", "*://*/*", "https://*/*", "http://*/*"])
		assert.equal(
			accessOf({ host_permissions: [pattern] }).allSites,
			true,
			pattern,
		);
	assert.equal(
		accessOf({ content_scripts: [{ matches: ["https://*/*"] }] }).allSites,
		true,
	);
	assert.deepEqual(accessOf({}), {
		allSites: false,
		hosts: [],
		permissions: [],
	});
});

test("growth in hosts, all-sites or permissions requires re-approval; shrink does not", () => {
	const base = {
		allSites: false,
		hosts: ["a.example"],
		permissions: ["storage"],
	};
	assert.equal(accessGrew(base, base), false);
	assert.equal(accessGrew(base, { ...base, hosts: [] }), false);
	assert.equal(
		accessGrew(base, { ...base, hosts: ["a.example", "b.example"] }),
		true,
	);
	assert.equal(
		accessGrew(base, { ...base, permissions: ["storage", "tabs"] }),
		true,
	);
	assert.equal(accessGrew(base, { ...base, allSites: true }), true);
	const all = { allSites: true, hosts: [], permissions: [] };
	assert.equal(accessGrew(all, { ...all, hosts: ["x.example"] }), false);
});

test("versions compare all four parts; equal and lower are never upgrades", () => {
	// electron-chrome-web-store compared 3 parts: this exact pair returned 0 there.
	assert.equal(compareExtensionVersions("8.12.44.33", "8.12.44.34"), -1);
	assert.equal(isStrictUpgrade("8.12.44.33", "8.12.44.34"), true);
	assert.equal(isStrictUpgrade("8.12.44.34", "8.12.44.34"), false);
	assert.equal(isStrictUpgrade("8.12.44.34", "8.12.44.33"), false);
	assert.equal(isStrictUpgrade("1.2", "1.2.0.1"), true);
	assert.equal(compareExtensionVersions("1.10", "1.9"), 1);
	for (const bad of ["", "1.2.3.4.5", "01.2", "1.-2", "1.2a", "70000", null, 3])
		assert.equal(isStrictUpgrade("1.0", bad), false, String(bad));
});

test("renderer IPC decoding: closed op set, exact fields, id regex", () => {
	assert.deepEqual(decodeExtensionsRequest({ op: "list" }), { op: "list" });
	assert.deepEqual(
		decodeExtensionsRequest({ op: "set-enabled", id: ID, enabled: false }),
		{
			op: "set-enabled",
			id: ID,
			enabled: false,
		},
	);
	for (const raw of [
		null,
		"list",
		[],
		{ op: "install", id: ID },
		{ op: "list", extra: 1 },
		{ op: "uninstall", id: ".." },
		{ op: "uninstall", id: "../x" },
		{ op: "uninstall", id: ID.toUpperCase() },
		{ op: "uninstall", id: ID, path: "/" },
		{ op: "set-enabled", id: ID, enabled: "true" },
		{ op: "open-popup" },
		// New ops (round-1 remediation) carry the same id rule and no URL.
		{ op: "retry", id: ".." },
		{ op: "open-listing", id: ID, url: "https://evil.example/" },
		{ op: "open-homepage" },
	])
		assert.equal(decodeExtensionsRequest(raw), null, JSON.stringify(raw));
	for (const op of ["retry", "open-listing", "open-homepage"])
		assert.deepEqual(decodeExtensionsRequest({ op, id: ID }), { op, id: ID });
});

test("state reader drops malformed entries instead of coercing them into consent", async (t) => {
	const root = await mkdtemp(
		join(
			process.env.LOCAL_OPERATOR_SCRATCHPAD ?? tmpdir(),
			"extension-state-test-",
		),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	const good = {
		enabled: true,
		installedAt: 1,
		version: "1.0",
		name: "Good",
		icon: null,
		consented: { allSites: false, hosts: [], permissions: [] },
	};
	await writeFile(
		join(root, "state.json"),
		JSON.stringify({
			version: 1,
			extensions: {
				[ID]: good,
				"..": good,
				[`${"b".repeat(32)}`]: { ...good, enabled: "yes" },
				[`${"c".repeat(32)}`]: { ...good, icon: "javascript:alert(1)" },
				[`${"d".repeat(32)}`]: { ...good, consented: { allSites: "no" } },
			},
		}),
	);
	assert.deepEqual(Object.keys(readExtensionsState(root).extensions), [ID]);
	await writeFile(join(root, "state.json"), "{not json");
	assert.deepEqual(readExtensionsState(root).extensions, {});
});

// ---- Chrome Web Store bridge ------------------------------------------------

const session = { id: "browser" };
function frameAt(url, origin = new URL(url).origin) {
	return {
		url,
		origin,
		isDestroyed: () => false,
		sent: [],
		send(channel, value) {
			this.sent.push([channel, value]);
		},
	};
}
function storeEvent(
	url = "https://chromewebstore.google.com/detail/x",
	options = {},
) {
	const mainFrame = frameAt(url, options.origin);
	const sender = {
		id: options.contentsId ?? 7,
		session: options.session ?? session,
		mainFrame,
	};
	return { sender, senderFrame: options.subframe ? frameAt(url) : mainFrame };
}

test("store sender gate: exact origin, main frame, browser session, registry tab", () => {
	const tab = () => true;
	assert.equal(isStoreSender(storeEvent(), session, tab), true);
	// A prefix check (upstream) accepted this look-alike origin.
	assert.equal(
		isStoreSender(
			storeEvent("https://chromewebstore.google.com.evil.example/"),
			session,
			tab,
		),
		false,
	);
	assert.equal(
		isStoreSender(
			storeEvent("http://chromewebstore.google.com/"),
			session,
			tab,
		),
		false,
	);
	assert.equal(
		isStoreSender(storeEvent(undefined, { subframe: true }), session, tab),
		false,
	);
	assert.equal(
		isStoreSender(
			storeEvent(undefined, { session: { id: "desktop" } }),
			session,
			tab,
		),
		false,
	);
	assert.equal(
		isStoreSender(storeEvent(), session, () => false),
		false,
	);
	// A frame whose reported origin disagrees with its URL is refused too.
	assert.equal(
		isStoreSender(
			storeEvent(undefined, { origin: "https://evil.example" }),
			session,
			tab,
		),
		false,
	);
});

function bridge(overrides = {}) {
	const handlers = new Map();
	const calls = [];
	const ipc = {
		handle: (channel, fn) => {
			assert.ok(!handlers.has(channel), `duplicate ${channel}`);
			handlers.set(channel, fn);
		},
		removeHandler: (channel) => handlers.delete(channel),
	};
	const installed = new Map();
	const manager = {
		installFromStore: async (id) => {
			calls.push(["install", id]);
			installed.set(id, { id, enabled: true, version: "1.0" });
			return overrides.result ?? "success";
		},
		storeStatus: (id) => (installed.has(id) ? "enabled" : "installable"),
		storeList: () => [...installed.values()],
	};
	const remove = registerWebStoreBridge({
		ipc,
		session,
		manager,
		isBrowserTab: () => true,
		mayInstallFrom: () => overrides.userTab ?? true,
	});
	const invoke = (channel, event, ...args) =>
		handlers.get(channel)(event, ...args);
	return { handlers, calls, invoke, remove, installed };
}

test("bridge: every channel refuses a look-alike origin before reading arguments", async () => {
	const { handlers, invoke, calls } = bridge();
	assert.deepEqual([...handlers.keys()].sort(), [...WEBSTORE_CHANNELS].sort());
	const evil = storeEvent("https://chromewebstore.google.com.evil.example/");
	for (const channel of handlers.keys())
		await assert.rejects(
			async () => invoke(channel, evil, { id: ID }, "{}"),
			/Refused/,
			channel,
		);
	assert.deepEqual(calls, []);
});

test("bridge: install from a user tab reaches the manager; agent tabs are told blocked_by_policy with a reason and no install (U5b)", async () => {
	const ok = bridge();
	const event = storeEvent();
	assert.deepEqual(
		await ok.invoke("chromeWebstore.beginInstall", event, {
			id: ID,
			manifest: "{}",
		}),
		{ result: "success" },
	);
	assert.deepEqual(ok.calls, [["install", ID]]);
	assert.deepEqual(event.senderFrame.sent, [
		[
			"chrome.management.onInstalled",
			{ id: ID, enabled: true, version: "1.0" },
		],
	]);
	assert.equal(
		await ok.invoke("chromeWebstore.getExtensionStatus", event, ID, "{}"),
		"enabled",
	);

	const agent = bridge({ userTab: false });
	assert.deepEqual(
		await agent.invoke("chromeWebstore.beginInstall", storeEvent(), { id: ID }),
		{
			result: "blocked_by_policy",
			message:
				"Extensions can only be added from your own tab while this app is in front.",
		},
	);
	assert.deepEqual(agent.calls, []);
	for (const id of ["..", "../x", ID.toUpperCase(), undefined])
		assert.deepEqual(
			await agent.invoke("chromeWebstore.beginInstall", storeEvent(), { id }),
			{ result: "invalid_id" },
		);
});

test("bridge: the page can neither uninstall nor toggle; MV2 claims read as deprecated", async () => {
	const { invoke, installed } = bridge();
	installed.set(ID, { id: ID, enabled: true, version: "1.0" });
	const event = storeEvent();
	// U6: refused, with a reason the shim reports as lastError.
	for (const target of [ID, ".."]) {
		const refusal = await invoke(
			"chrome.management.uninstall",
			event,
			target,
			{},
		);
		assert.match(refusal.error, /lop:\/\/extensions/);
	}
	assert.equal(
		await invoke("chrome.management.setEnabled", event, ID, false),
		false,
	);
	assert.ok(installed.has(ID));
	assert.equal(
		await invoke(
			"chromeWebstore.getExtensionStatus",
			event,
			"b".repeat(32),
			JSON.stringify({ manifest_version: 2 }),
		),
		"deprecated_manifest_version",
	);
	assert.deepEqual(await invoke("chrome.management.getAll", event), [
		{ id: ID, enabled: true, version: "1.0" },
	]);
});

test("bridge remover unregisters every channel so a restarted host can register again", () => {
	const first = bridge();
	first.remove();
	assert.equal(first.handlers.size, 0);
});
