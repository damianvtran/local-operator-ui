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
 *   - it ends on its own once the prompt is gone (no admitted frame alive AND
 *     no provider frame in the committed tree), never by a timer and never with
 *     a reload; a tab close drops it.
 *
 * 2026-11-17 (operator report: the passive 1Password autofill card paused agents
 * and raised "Password manager needs you" rows on every login page):
 *   - admission happens only in a tab a PERSON engaged (`tab-engagement.ts`);
 *   - `notification.html` alone is a QUIET hold (lock, no notice, no WAITING
 *     row); `universal-sign-on.html` or corroboration makes it a CEREMONY;
 *   - dismissing a ceremony's notice hides it and releases/reloads nothing.
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
			'export { close as closeTab } from "./src/main/browser/actions/tabs";',
			'export { CustodyHandoffs } from "./src/renderer/src/shared/browser-passkey-custody-handoff";',
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
	CustodyHandoffs,
	closeTab,
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
/** A prompt frame the provider has already removed (the user answered it): the
 * shape a release that needs no reload sees. Cases about a frame still loading
 * or unknown pass their own (review R3). */
const GONE = { isDestroyed: () => true };

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

test("admit puts the hold in place before it answers yes, then tells the host it began", () => {
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
			frame: GONE,
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
			frame: GONE,
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
			frame: GONE,
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
			frame: GONE,
		}),
		true,
	);
	assert.equal(instance.isHeld(10), true);
});

test("a hold ends on its own once the prompt frame is gone and none is committed, with no reload", () => {
	let providerFrame = true;
	const { custody: instance, events } = custody({
		hasProviderFrame: () => providerFrame,
	});
	const frame = {
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		},
	};
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame,
	});
	assert.equal(instance.isHeld(10), true);
	// The admitted frame is gone but the committed tree still shows one: held.
	frame.destroyed = true;
	assert.equal(instance.sweep(10), true);
	assert.equal(instance.isHeld(10), true);
	// Nothing left anywhere: the agent's next action finds the tab free.
	providerFrame = false;
	assert.equal(instance.isHeld(10), false);
	assert.deepEqual(events, [
		["begin", 1],
		["end", 1],
	]);
	assert.equal(
		"release" in instance,
		false,
		"there is no release (and so no reload) path any more",
	);
});

test("sweep fails closed: a live admitted frame, an unknown frame or an unreadable check keeps the hold", () => {
	for (const [frame, hasProviderFrame] of [
		[{ isDestroyed: () => false }, () => false],
		[undefined, () => false],
		[
			{
				isDestroyed: () => {
					throw new Error("gone?");
				},
			},
			() => false,
		],
		[
			GONE,
			() => {
				throw new Error("tree unreadable");
			},
		],
	]) {
		const { custody: instance } = custody({ hasProviderFrame });
		instance.admit({
			webContentsId: 10,
			tabId: 1,
			url: PROMPT,
			isInstalled: installed,
			frame,
		});
		instance.sweepAll();
		assert.equal(instance.isHeld(10), true);
	}
});

test("a main-frame commit drops an unknown frame's placeholder and lets the sweep end the hold", () => {
	const { custody: instance } = custody({ hasProviderFrame: () => false });
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	assert.equal(instance.isHeld(10), true, "unknown frame: fail closed");
	instance.committed(10);
	assert.equal(instance.isHeld(10), false);
});

test("notification.html alone is a QUIET hold: locked, but nothing for the WAITING row", () => {
	const { custody: instance } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame: GONE,
	});
	assert.equal(
		instance.isHeld(10),
		true,
		"the agent is still kept off the card",
	);
	assert.equal(instance.viewForTab(1).kind, "quiet");
	assert.deepEqual(waitingRows(instance), []);
});

test("universal-sign-on, or a corroborated notification, is a CEREMONY: exactly one WAITING row", () => {
	for (const request of [{ url: USO }, { url: PROMPT, corroborated: true }]) {
		const { custody: instance, events } = custody();
		for (let i = 0; i < 3; i++)
			instance.admit({
				webContentsId: 10,
				tabId: 1,
				isInstalled: installed,
				frame: GONE,
				...request,
			});
		assert.equal(instance.viewForTab(1).kind, "ceremony");
		assert.equal(
			waitingRows(instance).length,
			1,
			"repeated admission, one row",
		);
		assert.equal(events.filter(([kind]) => kind === "begin").length, 1);
	}
});

test("a quiet hold is promoted by a later ceremony document or by promote(); same hold, one row", () => {
	const changes = [];
	const { custody: instance } = custody({
		onChange: (view) => changes.push(view.kind),
	});
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame: GONE,
	});
	const { at } = instance.viewForTab(1);
	assert.equal(
		instance.promote(2),
		false,
		"another tab's evidence promotes nothing",
	);
	assert.equal(instance.promote(1), true);
	assert.equal(instance.promote(1), false, "already a ceremony");
	assert.equal(instance.viewForTab(1).at, at, "the same hold");
	assert.deepEqual(changes, ["ceremony"]);
	const second = custody({
		onChange: (view) => changes.push(view.kind),
	}).custody;
	second.admit({
		webContentsId: 11,
		tabId: 2,
		url: PROMPT,
		isInstalled: installed,
		frame: GONE,
	});
	second.admit({
		webContentsId: 11,
		tabId: 2,
		url: USO,
		isInstalled: installed,
		frame: GONE,
	});
	assert.equal(second.viewForTab(2).kind, "ceremony");
	assert.equal(waitingRows(second).length, 1);
});

test("dismiss hides the notice and the row only: the hold stays, nothing reloads or releases", () => {
	const ended = [];
	const { custody: instance } = custody({
		onEnd: (view) => ended.push(view.tabId),
		hasProviderFrame: () => true,
	});
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: USO,
		isInstalled: installed,
		frame: { isDestroyed: () => false },
	});
	const { at } = instance.viewForTab(1);
	assert.equal(
		instance.dismiss(1, at - 1),
		false,
		"a stale notice dismisses nothing",
	);
	assert.equal(instance.dismiss(2, at), false);
	assert.equal(waitingRows(instance).length, 1);
	assert.equal(instance.dismiss(1, at), true);
	assert.equal(instance.viewForTab(1).dismissed, true);
	assert.deepEqual(waitingRows(instance), []);
	assert.equal(instance.isHeld(10), true, "the prompt is still the person's");
	assert.deepEqual(ended, [], "no release");
});

// This legacy state-machine fixture is not the host's WAITING projection.
function waitingRows(instance) {
	return instance
		.views()
		.filter((view) => view.kind === "ceremony" && !view.dismissed);
}

test("closing the tab drops the hold", () => {
	const { custody: instance, events } = custody();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame: GONE,
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
		frame: GONE,
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
		frame: GONE,
	});
	contents.debugger.pending.get("Page.captureScreenshot")({
		data: "secret-pixels",
	});
	await assert.rejects(
		capture,
		(error) => error.data?.reason === "passkey_custody",
	);
	// Released before it lands still counts: the epoch moved.
	contents.debugger.pending.clear();
	const second = pool.send(contents, "Page.captureScreenshot", {});
	await assert.rejects(
		second,
		(error) => error.data?.reason === "passkey_custody",
	);
	// The prompt closed (the self-release's own end path).
	instance.forget(10, "the prompt closed");
	const third = pool.send(contents, "Page.captureScreenshot", {});
	await new Promise((resolve) => setImmediate(resolve));
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame: GONE,
	});
	instance.forget(10, "the prompt closed");
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
		frame: GONE,
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
		frame: GONE,
	});
	assert.throws(
		() => registry.requireSurface(token),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === "passkey_custody",
	);
	instance.forget(wc, "the prompt closed");
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
		frame: GONE,
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

// ---- remediation round 1 (PR #1868) ---------------------------------------

test("the capture discard runs synchronously at hold begin, before onBegin, even when onBegin throws", () => {
	const order = [];
	const instance = new PasskeyCustody({
		now: () => 5,
		log: () => {},
		onHold: (id) => order.push(["hold", id, instance.isHeld(id)]),
		onBegin: () => {
			order.push(["begin"]);
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
	assert.deepEqual(order, [["hold", 10, true], ["begin"]]);
	// A second admission inside the same hold is the same identity: no second
	// discard, no second attention.
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: USO,
		isInstalled: installed,
	});
	assert.equal(order.length, 2);
});

test("R3: the self-release never fires while a newly admitted frame is still committing", () => {
	const { custody: instance } = custody({ hasProviderFrame: () => false });
	const first = {
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		},
	};
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
		frame: first,
	});
	// The user answered; 1Password removed that frame...
	first.destroyed = true;
	// ...and is swapping in its completion frame, still navigating: the committed
	// frame tree does not show it yet.
	const pending = {
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		},
	};
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: USO,
		isInstalled: installed,
		frame: pending,
	});
	assert.equal(
		instance.isHeld(10),
		true,
		"never unlocked before the pending frame is gone",
	);
	pending.destroyed = true;
	assert.equal(instance.isHeld(10), false);
});

test("R1/R2: under custody the pool lets capture TEARDOWN through and nothing that reads or captures", async () => {
	const { pool, contents, custody: instance } = await attachedPool();
	instance.admit({
		webContentsId: 10,
		tabId: 1,
		url: PROMPT,
		isInstalled: installed,
	});
	const before = contents.debugger.commands.length;
	for (const method of [
		"Page.stopScreenRecording",
		"IO.close",
		"Emulation.clearDeviceMetricsOverride",
		"Page.disable",
		"Page.stopScreencast",
	]) {
		await pool.send(contents, method, {});
	}
	assert.deepEqual(contents.debugger.commands.slice(before), [
		"Page.stopScreenRecording",
		"IO.close",
		"Emulation.clearDeviceMetricsOverride",
		"Page.disable",
		"Page.stopScreencast",
	]);
	for (const method of [
		"IO.read",
		"Page.startScreenRecording",
		"Page.startScreencast",
		"Page.screencastFrameAck",
		"Emulation.setDeviceMetricsOverride",
	]) {
		await assert.rejects(
			pool.send(contents, method, {}),
			(error) => error.data?.reason === "passkey_custody",
		);
	}
	assert.equal(
		contents.debugger.commands.length,
		before + 5,
		"no capture reached the debugger",
	);
});

test("Q3: a handle-less close of the sole tab is refused while the user holds it", async () => {
	let id = 70;
	const registry = new TabRegistry(
		() => new FakeView(id++),
		() => {},
		() => {},
	);
	const { custody: instance } = custody();
	registry.setCustodyGate(instance);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	instance.admit({
		webContentsId: agent.view.webContents.id,
		tabId: agent.tabId,
		url: PROMPT,
		isInstalled: installed,
	});
	const ctx = {
		registry,
		approvals: { forgetDocument: () => {} },
		onChanged: () => {},
	};
	await assert.rejects(
		closeTab(ctx, {}),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === "passkey_custody",
	);
	await assert.rejects(
		closeTab(ctx, { tab: surfaceToken(agent) }),
		(error) => error.data?.reason === "passkey_custody",
	);
	assert.equal(registry.get(agent.tabId), agent, "the tab is still open");
});

// ---- the renderer's handoff and give-back (U1/D3) ---------------------------

const viewB = {
	pathname: "/chat",
	activeSessionId: "session:b",
	activeDraftKey: null,
	browserPaneOpen: false,
};
const toA = { kind: "conversation", sessionId: "session:a" };

test("U1: the user is given back their conversation and route when still on the handoff view", () => {
	const handoffs = new CustodyHandoffs();
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, viewB);
	assert.deepEqual(handoff, {
		pathname: "/chat",
		activeSessionId: "session:a",
		activeDraftKey: null,
		browserPaneOpen: true,
	});
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		session: "session:b",
	});
	const fromSettings = { ...viewB, pathname: "/settings" };
	const again = handoffs.begin({ tabId: 1, at: 6 }, toA, fromSettings);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 6 }, again), {
		session: "session:b",
		navigate: "/settings",
	});
});

test("U1: a deliberate move during the hold is kept (conversation, route, pane closed)", () => {
	for (const moved of [
		{ activeSessionId: "session:c" },
		{ pathname: "/browser" },
		{ browserPaneOpen: false },
		{ activeDraftKey: "draft-1" },
	]) {
		const handoffs = new CustodyHandoffs();
		const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, viewB);
		assert.equal(
			handoffs.end({ tabId: 1, at: 5 }, { ...handoff, ...moved }),
			null,
			JSON.stringify(moved),
		);
	}
});

test("U1: same conversation with its pane closed: only the pane the handoff opened is closed", () => {
	const handoffs = new CustodyHandoffs();
	const before = { ...viewB, activeSessionId: "session:a" };
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, before);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		closeBrowserPane: true,
	});
	const open = { ...before, browserPaneOpen: true };
	const none = handoffs.begin({ tabId: 1, at: 7 }, toA, open);
	assert.equal(
		handoffs.end({ tabId: 1, at: 7 }, none),
		null,
		"nothing moved, nothing to give back",
	);
});

test("U1: a draft and the browser route come back; a repeat attention for the same hold moves nothing", () => {
	const handoffs = new CustodyHandoffs();
	const drafting = {
		...viewB,
		activeSessionId: null,
		activeDraftKey: "draft-9",
	};
	const handoff = handoffs.begin({ tabId: 1, at: 5 }, toA, drafting);
	assert.equal(
		handoffs.begin({ tabId: 1, at: 5 }, toA, handoff),
		null,
		"same identity: no second move",
	);
	assert.deepEqual(handoffs.end({ tabId: 1, at: 5 }, handoff), {
		openDraft: "draft-9",
	});
	const browser = handoffs.begin(
		{ tabId: 2, at: 8 },
		{ kind: "browser" },
		viewB,
	);
	assert.deepEqual(handoffs.end({ tabId: 2, at: 8 }, browser), {
		navigate: "/chat",
	});
	assert.equal(
		handoffs.end({ tabId: 2, at: 8 }, browser),
		null,
		"an ended hold gives back once",
	);
});
