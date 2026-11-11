/**
 * Passkey custody: a password manager's passkey prompt may appear in an AGENT
 * tab only while the agent is locked out of that tab.
 *
 * WHY THIS FILE EXISTS. Operator report 2026-11-11: Microsoft's sign-in
 * (`login.microsoft.com/consumers/fido/get`) hung on "Face, fingerprint, PIN or
 * security key" in an agent-driven tab while the same sign-in completed in a tab
 * the operator opened. `subframe-policy.ts` refused 1Password's prompt frame in
 * every agent tab. `extensions/passkey-custody.ts` now admits a known provider's
 * prompt document under a hold; these tests pin the hold's invariants:
 *   - the hold is in place BEFORE `admit` says yes (no readable frame first);
 *   - only installed providers' measured prompt documents are admitted (never the
 *     autofill menu, never an arbitrary extension, never an unanswerable check);
 *   - every agent path is refused while held: `requireSurface`, every CDP command
 *     but the origin gate's `Fetch` answers, results already in flight, CDP events
 *     (screencast/console/network), isolated-world reads, frame walks;
 *   - only a release ends it (no timer); a release with the frame still present
 *     reloads first and lifts on the new document's commit; a stale `at` is
 *     refused; a tab close drops the hold.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/extensions/passkey-custody";',
			'export { CdpPool } from "./src/main/browser/cdp";',
			'export { TabRegistry, surfaceToken } from "./src/main/browser/registry";',
			'export { assertNotExtensionFrame, listFrames } from "./src/main/browser/actions/frames";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["electron"],
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/");',
	},
});
const {
	CdpPool,
	PASSKEY_PROMPT_DOCUMENTS,
	PasskeyCustody,
	TabRegistry,
	assertNotExtensionFrame,
	passkeyPromptProvider,
	surfaceToken,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const ONEPASSWORD = "aeblfdkhhhdcdjpifhhbdiojplfjncoa";
const PROMPT = `chrome-extension://${ONEPASSWORD}/inline/notification/notification.html?language=en#type=notificationManager`;
const USO = `chrome-extension://${ONEPASSWORD}/inline/universal-sign-on/universal-sign-on.html?tabId=7`;
const MENU = `chrome-extension://${ONEPASSWORD}/inline/menu/menu.html`;
const MODAL = `chrome-extension://${ONEPASSWORD}/inline/modal/modal.html#x`;

const installed = () => true;

function custody(overrides = {}) {
	const events = [];
	let clock = 1_000;
	const instance = new PasskeyCustody({
		now: () => clock++,
		log: () => {},
		onBegin: (view) => events.push(["begin", view.tabId]),
		onEnd: (view) => events.push(["end", view.tabId]),
		...overrides,
	});
	return { custody: instance, events };
}

test("the measured 1Password prompt documents are the only admitted ones", () => {
	assert.deepEqual(
		[...PASSKEY_PROMPT_DOCUMENTS.keys()],
		[ONEPASSWORD],
		"a provider is added only with its own measurement",
	);
	assert.equal(passkeyPromptProvider(PROMPT), ONEPASSWORD);
	assert.equal(passkeyPromptProvider(USO), ONEPASSWORD);
	// The autofill menu renders vault items next to whatever field an agent
	// focused; the modal carries no passkey route in 8.12.44.33.
	assert.equal(passkeyPromptProvider(MENU), null);
	assert.equal(passkeyPromptProvider(MODAL), null);
	assert.equal(
		passkeyPromptProvider(
			"chrome-extension://abcdefghijklmnopabcdefghijklmnop/inline/notification/notification.html",
		),
		null,
		"another extension's document of the same path is not a known prompt",
	);
	assert.equal(
		passkeyPromptProvider(
			`https://${ONEPASSWORD}/inline/notification/notification.html`,
		),
		null,
	);
	assert.equal(passkeyPromptProvider("not a url"), null);
});

test("admit puts the hold in place before it answers yes, and brings the tab forward", () => {
	const seen = [];
	const { custody: instance } = custody({
		onBegin: (view) => seen.push(["begin", view.tabId, instance.isHeld(10)]),
	});
	assert.equal(instance.isHeld(10), false);
	const epoch = instance.epoch(10);
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: installed,
		}),
		true,
	);
	assert.equal(instance.isHeld(10), true);
	assert.equal(instance.epoch(10), epoch + 1);
	assert.deepEqual(
		seen,
		[["begin", 1, true]],
		"onBegin runs with the hold already set",
	);
	// A second prompt frame in the same hold does not start another.
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: USO,
			isInstalled: installed,
		}),
		true,
	);
	assert.equal(seen.length, 1);
	assert.equal(instance.viewForTab(1)?.providerId, ONEPASSWORD);
});

test("not installed, an unanswerable install check, or a non-prompt document is refused with no hold", () => {
	const { custody: instance, events } = custody();
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: () => false,
		}),
		false,
	);
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: () => {
				throw new Error("manager not built yet");
			},
		}),
		false,
		"an install check that throws fails closed",
	);
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: MENU,
			isInstalled: installed,
		}),
		false,
	);
	assert.equal(instance.isHeld(10), false);
	assert.deepEqual(events, []);
});

test("a hold that fails to bring the tab forward still holds", () => {
	const { custody: instance } = custody({
		onBegin: () => {
			throw new Error("window gone");
		},
	});
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: installed,
		}),
		true,
	);
	assert.equal(instance.isHeld(10), true);
});

test("only the user's release ends a hold; a stale or unknown one is refused", () => {
	const { custody: instance, events } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const { at } = instance.viewForTab(1);
	const noFrame = {
		hasProviderFrame: () => false,
		reload: () => assert.fail("no reload"),
	};
	assert.deepEqual(instance.release({ tabId: 1, at: at - 1, ...noFrame }), {
		ok: false,
		reason: "stale",
	});
	assert.deepEqual(instance.release({ tabId: 2, at, ...noFrame }), {
		ok: false,
		reason: "not_held",
	});
	assert.equal(instance.isHeld(10), true);
	// A main-frame commit (the sign-in's own redirect) does not end a hold the
	// user has not returned.
	instance.committed(10);
	assert.equal(instance.isHeld(10), true);
	assert.deepEqual(instance.release({ tabId: 1, at, ...noFrame }), {
		ok: true,
		reloaded: false,
	});
	assert.equal(instance.isHeld(10), false);
	assert.deepEqual(events, [
		["begin", 1],
		["end", 1],
	]);
});

test("a release with the provider frame still present reloads first and lifts only on commit", () => {
	const { custody: instance } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const { at } = instance.viewForTab(1);
	const reloads = [];
	assert.deepEqual(
		instance.release({
			tabId: 1,
			at,
			hasProviderFrame: () => true,
			reload: (id) => reloads.push(id),
		}),
		{ ok: true, reloaded: true },
	);
	assert.deepEqual(reloads, [10]);
	assert.equal(
		instance.isHeld(10),
		true,
		"still held until the new document commits",
	);
	instance.committed(10);
	assert.equal(instance.isHeld(10), false);
});

test("a frame check that throws reloads (fail closed); a reload that throws keeps the hold", () => {
	const { custody: instance } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const { at } = instance.viewForTab(1);
	assert.deepEqual(
		instance.release({
			tabId: 1,
			at,
			hasProviderFrame: () => {
				throw new Error("frame gone");
			},
			reload: () => {
				throw new Error("cannot reload");
			},
		}),
		{ ok: false, reason: "not_held" },
	);
	assert.equal(instance.isHeld(10), true);
	instance.committed(10);
	assert.equal(
		instance.isHeld(10),
		true,
		"a failed reload is not waiting for a commit",
	);
});

test("a prompt that reappears while a release waits for its reload cancels the release", () => {
	const { custody: instance } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const { at } = instance.viewForTab(1);
	instance.release({
		tabId: 1,
		at,
		hasProviderFrame: () => true,
		reload: () => {},
	});
	assert.equal(
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: installed,
		}),
		true,
	);
	instance.committed(10);
	assert.equal(instance.isHeld(10), true);
});

test("closing the tab drops the hold", () => {
	const { custody: instance, events } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	instance.forget(10);
	assert.equal(instance.isHeld(10), false);
	assert.deepEqual(events.at(-1), ["end", 1]);
});

// ---- the CDP choke point -------------------------------------------------

class FakeDebugger extends EventEmitter {
	constructor() {
		super();
		this.commands = [];
		this.pending = new Map();
		this.attached = false;
	}
	attach() {
		this.attached = true;
	}
	detach() {
		this.attached = false;
	}
	isAttached() {
		return this.attached;
	}
	sendCommand(method) {
		this.commands.push(method);
		if (this.hold === method) {
			return new Promise((resolve) => this.pending.set(method, resolve));
		}
		if (method === "Runtime.evaluate")
			return Promise.resolve({ result: { value: 1 } });
		return Promise.resolve({ data: "pixels" });
	}
}

class FakeContents extends EventEmitter {
	constructor(id) {
		super();
		this.id = id;
		this.debugger = new FakeDebugger();
	}
	isDestroyed() {
		return false;
	}
	getURL() {
		return "https://login.example/";
	}
	async executeJavaScript() {
		return undefined;
	}
}

async function attachedPool() {
	const pool = new CdpPool();
	const contents = new FakeContents(10);
	await pool.attach(contents);
	const { custody: instance } = custody();
	pool.setCustodyGate(instance);
	return { pool, contents, custody: instance };
}

test("a held view refuses every agent command before dispatch, but keeps the origin gate's Fetch answers", async () => {
	const { pool, contents, custody: instance } = await attachedPool();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const before = contents.debugger.commands.length;
	for (const method of [
		"Page.captureScreenshot",
		"DOM.getDocument",
		"Input.dispatchMouseEvent",
		"Runtime.evaluate",
		"Accessibility.getFullAXTree",
		"Page.startScreencast",
	]) {
		await assert.rejects(pool.send(contents, method, {}), (error) => {
			assert.equal(error.code, "owner_refused");
			assert.equal(error.data?.reason, "passkey_custody");
			return true;
		});
	}
	assert.equal(
		contents.debugger.commands.length,
		before,
		"nothing reached the debugger",
	);
	await pool.send(contents, "Fetch.continueRequest", { requestId: "r1" });
	await pool.send(contents, "Fetch.failRequest", { requestId: "r2" });
	assert.deepEqual(contents.debugger.commands.slice(before), [
		"Fetch.continueRequest",
		"Fetch.failRequest",
	]);
});

test("a screenshot already in flight when the hold begins is dropped, not delivered", async () => {
	const { pool, contents, custody: instance } = await attachedPool();
	contents.debugger.hold = "Page.captureScreenshot";
	const capture = pool.send(contents, "Page.captureScreenshot", {});
	await new Promise((resolve) => setImmediate(resolve));
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	contents.debugger.pending.get("Page.captureScreenshot")({
		data: "secret-pixels",
	});
	await assert.rejects(
		capture,
		(error) => error.data?.reason === "passkey_custody",
	);
	// Released before it lands still counts: the epoch moved.
	const { at } = instance.viewForTab(1);
	contents.debugger.pending.clear();
	const second = pool.send(contents, "Page.captureScreenshot", {});
	await assert.rejects(
		second,
		(error) => error.data?.reason === "passkey_custody",
	);
	instance.release({
		tabId: 1,
		at,
		hasProviderFrame: () => false,
		reload: () => {},
	});
	const third = pool.send(contents, "Page.captureScreenshot", {});
	await new Promise((resolve) => setImmediate(resolve));
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const { at: at2 } = instance.viewForTab(1);
	instance.release({
		tabId: 1,
		at: at2,
		hasProviderFrame: () => false,
		reload: () => {},
	});
	contents.debugger.pending.get("Page.captureScreenshot")({ data: "raced" });
	await assert.rejects(
		third,
		(error) => error.data?.reason === "passkey_custody",
	);
	// And after the hold, commands flow again.
	contents.debugger.hold = null;
	assert.deepEqual(await pool.send(contents, "Page.captureScreenshot", {}), {
		data: "pixels",
	});
});

test("while held, CDP events reach no subscriber except the origin gate's Fetch pauses", async () => {
	const { pool, contents, custody: instance } = await attachedPool();
	const seen = [];
	pool.subscribe(10, (method) => seen.push(method));
	const emit = (method) =>
		contents.debugger.emit("message", {}, method, { sessionId: undefined });
	emit("Page.screencastFrame");
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	emit("Page.screencastFrame");
	emit("Runtime.consoleAPICalled");
	emit("Network.requestWillBeSent");
	emit("Fetch.requestPaused");
	assert.deepEqual(seen, ["Page.screencastFrame", "Fetch.requestPaused"]);
});

// ---- the registry choke point and the frame walk ----------------------------

class FakeView {
	constructor(id) {
		this.webContents = new FakeContents(id);
		this.webContents.executeJavaScriptInIsolatedWorld = async () =>
			this.isolated ? this.isolated() : "page text";
	}
	setBounds() {}
	setVisible() {}
}

test("requireSurface refuses a held tab, and an isolated-world read that crossed the hold is dropped", async () => {
	let id = 50;
	const registry = new TabRegistry(
		() => new FakeView(id++),
		() => {},
		() => {},
	);
	const { custody: instance } = custody();
	registry.setCustodyGate(instance);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	const token = surfaceToken(agent);
	const wc = agent.view.webContents.id;
	assert.equal(registry.requireSurface(token), agent);
	instance.admit({
		webContentsId: wc,
		tabId: agent.tabId,
		url: PROMPT,
		isInstalled: installed,
	});
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === "passkey_custody",
	);
	const { at } = instance.viewForTab(agent.tabId);
	instance.release({
		tabId: agent.tabId,
		at,
		hasProviderFrame: () => false,
		reload: () => {},
	});
	assert.equal(registry.requireSurface(token), agent);

	let resolveRead;
	const read = registry.guardRead(
		agent,
		() =>
			new Promise((resolve) => {
				resolveRead = resolve;
			}),
	);
	instance.admit({
		webContentsId: wc,
		tabId: agent.tabId,
		url: PROMPT,
		isInstalled: installed,
	});
	resolveRead("page text");
	await assert.rejects(
		read,
		(error) => error.data?.reason === "passkey_custody",
	);
});

test("an extension's own document is never a frame an agent may enter", () => {
	assert.throws(
		() => assertNotExtensionFrame(MENU),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === "extension_frame",
	);
	assert.throws(() => assertNotExtensionFrame(PROMPT));
	assert.doesNotThrow(() =>
		assertNotExtensionFrame("https://login.example/frame"),
	);
	assert.doesNotThrow(() => assertNotExtensionFrame(undefined));
});
