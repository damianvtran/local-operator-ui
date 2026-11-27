/**
 * Pending passkey requests: a password manager's or the platform's prompt may
 * appear in an AGENT tab, and the agent KEEPS THE TAB.
 *
 * WHY THIS FILE EXISTS (operator requirement, 2026-11-23; it replaces the
 * "passkey custody" matrix of `scripts/passkey-custody.test.mjs`, whose model is
 * gone). Two failures in opposite directions had to be answered at once:
 *
 *   1. Passive 1Password inline autofill — `notification.html`'s "Sign in" card
 *      on any login form — used to put agent tabs into a WAITING row and refuse
 *      every agent action, on pages nobody was asked anything about. It must be
 *      a NON-EVENT: no notice, no row, no refusal, no pause.
 *   2. The correction of (1) refused every provider document in an agent tab, so
 *      a REAL 1Password passkey sign-in could not complete where it started
 *      (review R5 BLOCKER). A person who engages the tab must be able to finish
 *      in it.
 *
 * The matrix below pins the replacement, item by item:
 *   - ADMISSION: only a measured prompt document of an installed, loaded
 *     provider, only in a tab a person engaged, never as the tab's own document;
 *   - NOTHING BLANKET: `requireSurface`, page reads, screenshots, input and even
 *     navigation of OTHER tabs keep working while a request is live;
 *   - the TYPED, request-scoped refusal: exactly `close`, `navigate` and the
 *     provider's own prompt document, naming the request;
 *   - DISMISSAL is presentation only: no settle, no reload, no cancel;
 *   - CLEANUP on prompt end, tab close, ownership change and agent continuation;
 *   - the CAPTURE guard: a recording is discarded when a prompt frame loads,
 *     the one artefact that would outlive it.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/extensions/auth-request";',
			'export { CdpPool } from "./src/main/browser/cdp";',
			'export { TabRegistry, surfaceToken } from "./src/main/browser/registry";',
			'export { assertNotExtensionFrame } from "./src/main/browser/actions/frames";',
			'export { close as closeTab, goto } from "./src/main/browser/actions/tabs";',
			'export { discardRecordingForAuthPrompt, recordStart, recordStop } from "./src/main/browser/actions/recording";',
			'export { screenshot } from "./src/main/browser/actions/page";',
			'export { hover, press } from "./src/main/browser/actions/input";',
			'export { navigateView } from "./src/main/browser/actions/gate";',
			'export { TabEngagement } from "./src/main/browser/extensions/tab-engagement";',
			'export { PasskeyNotices } from "./src/main/browser/passkey-notice";',
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
	AUTH_REQUEST_REFUSAL_REASON,
	AuthRequests,
	CdpPool,
	PASSKEY_PROMPT_DOCUMENTS,
	TabRegistry,
	assertNotExtensionFrame,
	closeTab,
	discardRecordingForAuthPrompt,
	hover,
	navigateView,
	passkeyPromptKind,
	PasskeyNotices,
	press,
	recordStart,
	recordStop,
	screenshot,
	TabEngagement,
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
 * shape a sweep that needs no reload sees. Cases about a frame still loading
 * pass their own. */
const GONE = { isDestroyed: () => true };
const LIVE = { isDestroyed: () => false };

function rig(overrides = {}) {
	const events = [];
	let clock = 1_000;
	const requests = new AuthRequests({
		now: () => clock++,
		log: () => {},
		// REALISTIC DEFAULT (review B6): a committed tree with no provider frame.
		// The old default ("absent = assume yes") meant no sweep ever ended
		// anything here, which hid a native request expiring within a second.
		hasProviderFrame: () => false,
		onBegin: (view) => events.push(["begin", view.tabId]),
		onChange: (view) => events.push(["change", view.tabId, view.dismissed]),
		onEnd: (view) => events.push(["end", view.tabId]),
		...overrides,
	});
	return { requests, events };
}

/** The ceremony route: what a real passkey prompt arrives as. */
function ceremony(target = { webContentsId: 10, tabId: 1 }, overrides = {}) {
	return {
		webContentsId: target.webContentsId,
		tabId: target.tabId,
		url: USO,
		engaged: true,
		isInstalled: installed,
		frame: LIVE,
		...overrides,
	};
}

// ---- admission -------------------------------------------------------------

test("the measured 1Password prompt documents are the only admitted ones", () => {
	assert.deepEqual([...PASSKEY_PROMPT_DOCUMENTS.keys()], [ONEPASSWORD]);
	for (const url of [
		PROMPT,
		USO,
		"chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/inline/universal-sign-on/universal-sign-on.html",
	])
		assert.equal(passkeyPromptProvider(url), ONEPASSWORD, url);
	// The vault UI that is never a prompt: the autofill menu next to the field an
	// agent focused, and the modal, which carries no passkey route.
	for (const url of [MENU, MODAL, "https://login.example/", "about:blank"])
		assert.equal(passkeyPromptProvider(url), null, url);
	// Which documents are ceremonies on their own: only completion UI.
	assert.equal(passkeyPromptKind(USO), "ceremony");
	assert.equal(passkeyPromptKind(PROMPT), "quiet");
	assert.equal(passkeyPromptKind(MENU), null);
});

test("no admission without a PERSON's engagement, an installed provider, or a known document", () => {
	const { requests, events } = rig();
	assert.equal(
		requests.admit(ceremony(undefined, { engaged: false })),
		false,
		"an agent that reached the page by itself admits nothing",
	);
	assert.equal(
		requests.admit(ceremony(undefined, { isInstalled: () => false })),
		false,
		"an extension that is not loaded cannot be a prompt anyone is waiting for",
	);
	assert.equal(
		requests.admit(
			ceremony(undefined, {
				isInstalled: () => {
					throw new Error("no adapter");
				},
			}),
		),
		false,
		"an unanswerable install check refuses (fail closed)",
	);
	assert.equal(
		requests.admit(ceremony(undefined, { url: MENU })),
		false,
		"the autofill menu is never a prompt",
	);
	assert.equal(requests.hasRequests(), false);
	assert.deepEqual(events, [], "refusing raises nothing");
});

// ---- item 2: passive autofill is a non-event --------------------------------

test("POSITIVE CONTROL (the reported bug): a passive autofill card is admitted and records NOTHING", () => {
	const { requests, events } = rig();
	assert.equal(
		requests.admit(ceremony(undefined, { url: PROMPT, frame: LIVE })),
		true,
	);
	assert.equal(
		requests.hasRequests(),
		false,
		"no request: nothing to project, nothing to clear later",
	);
	assert.equal(requests.viewForTab(1), null, "no notice in the corner card");
	assert.deepEqual(events, [], "no begin/change/end: no WAITING row either");
	// And nothing it could refuse: every action, including closing the tab that
	// happens to show the card, is the agent's to take.
	for (const action of ["close", "navigate", "prompt_document"])
		assert.equal(requests.conflict(10, action), null, action);
});

// ---- item 3: the ceremony, request-scoped ----------------------------------

test("a passkey ceremony records ONE request and PROJECTS one notice — no lock", () => {
	const { requests, events } = rig();
	assert.equal(requests.admit(ceremony()), true);
	assert.deepEqual(events, [["begin", 1]], "the host is told once, to project");
	assert.deepEqual(requests.viewForTab(1), {
		requestId: "auth-1-1",
		tabId: 1,
		at: 1_000,
		kind: "ceremony",
		dismissed: false,
	});
	// Same request, another frame of the same document: still one request.
	assert.equal(requests.admit(ceremony(undefined, { frame: LIVE })), true);
	assert.equal(requests.viewForTab(1)?.requestId, "auth-1-1");
	assert.equal(requests.hasRequests(), true);
});

test("only the THREE interfering actions are refused, typed and request-scoped", () => {
	const { requests } = rig();
	requests.admit(ceremony());
	const view = requests.viewForTab(1);
	for (const action of ["close", "navigate", "prompt_document"]) {
		const refusal = requests.conflict(10, action);
		assert.ok(refusal, `${action} must be refused`);
		assert.equal(refusal.code, "owner_refused");
		assert.equal(refusal.data?.reason, AUTH_REQUEST_REFUSAL_REASON);
		assert.equal(
			refusal.data?.requestId,
			view?.requestId,
			"the refusal names THIS request, so the agent knows what is in the way",
		);
		assert.doesNotMatch(
			refusal.message,
			/another tab|use a human-owned tab/i,
			"the agent is not sent away from a tab it still owns",
		);
	}
	// Nothing else: a read, a screenshot, an input dispatch, a scroll and a
	// navigation of a DIFFERENT tab are all still the agent's.
	assert.equal(
		requests.conflict(11, "navigate"),
		null,
		"another view, untouched",
	);
	// A read, a screenshot, an input dispatch and a scroll never ask this module at
	// all: `ConflictingAction` is a closed union of the three above, so there is no
	// state in which "read" is even a question. The integration cases below drive
	// the real call sites (`requireSurface`, the CDP pool) to show that.
});

test("a nonblocking request does not survive its own prompt: settle, sweep, commit and forget", () => {
	const { requests, events } = rig();
	requests.admit(ceremony());
	assert.equal(requests.sweep(10), true, "a live frame keeps the request");
	// The provider removed the frame when the person answered, and nothing in the
	// committed tree holds one either.
	const ended = rig({ hasProviderFrame: () => false });
	ended.requests.admit(ceremony(undefined, { frame: GONE }));
	assert.equal(
		ended.requests.sweep(10),
		false,
		"the prompt closed: the request ends",
	);
	assert.deepEqual(ended.events, [
		["begin", 1],
		["end", 1],
	]);
	assert.equal(
		ended.requests.viewForTab(1),
		null,
		"and the notice clears with it",
	);
	// An UNREADABLE answer keeps it (fail closed): the person may still be there.
	const blind = rig({
		hasProviderFrame: () => {
			throw new Error("frame gone");
		},
	});
	blind.requests.admit(ceremony(undefined, { frame: GONE }));
	assert.equal(blind.requests.sweep(10), true);
	// A main-frame commit drops the placeholder a frame-less admission left.
	const placeholder = rig({ hasProviderFrame: () => false });
	placeholder.requests.admit(ceremony(undefined, { frame: undefined }));
	placeholder.requests.committed(10);
	assert.equal(
		placeholder.requests.hasRequests(),
		false,
		"the old document's frames went with it",
	);
	// The tab closing, or changing hands, drops it outright.
	const closing = rig();
	closing.requests.admit(ceremony());
	closing.requests.forget(10);
	assert.equal(closing.requests.hasRequests(), false);
	assert.deepEqual(closing.events, [
		["begin", 1],
		["end", 1],
	]);
	assert.equal(events.length, 1, "no assertion above touched this rig's state");
});

test("dismissal HIDES the notice and nothing else: no settle, no reload, no cancel", () => {
	const { requests, events } = rig();
	requests.admit(ceremony());
	const view = requests.viewForTab(1);
	assert.equal(requests.dismiss(1, "auth-1-9"), false, "a stale id is ignored");
	assert.equal(requests.dismiss(1, view.requestId), true);
	assert.equal(requests.dismiss(1, view.requestId), false, "already dismissed");
	assert.deepEqual(events, [
		["begin", 1],
		["change", 1, true],
	]);
	assert.equal(
		requests.hasRequests(),
		true,
		"the request is still live, so the interfering actions are still refused",
	);
	assert.ok(requests.conflict(10, "close"));
});

// ---- item 4: the deliberate human route, and provider isolation ------------

test("the provider's own prompt document is never an agent target, whatever the state", () => {
	assert.throws(
		() => assertNotExtensionFrame(MENU),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === "extension_frame",
	);
	// The route that admits it for a PERSON does not open it to the agent: the
	// frame guard is independent of any request.
	assert.throws(() => assertNotExtensionFrame(USO));
	assert.throws(() => assertNotExtensionFrame(PROMPT));
	assert.doesNotThrow(() =>
		assertNotExtensionFrame("https://login.example/frame"),
	);
	assert.doesNotThrow(() => assertNotExtensionFrame(undefined));
});

test("a native request (Apple platform passkeys) is the same typed, tab-scoped state", () => {
	const { requests, events } = rig();
	const view = requests.beginNative({
		engaged: true,
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-1",
	});
	assert.equal(view?.requestId, "webauthn-1");
	assert.deepEqual(events, [["begin", 1]]);
	assert.equal(
		requests.beginNative({
			engaged: true,
			webContentsId: 10,
			tabId: 1,
			requestId: "webauthn-2",
		}),
		null,
		"one request per tab: a second begin is the same projection",
	);
	// The host settles it (`WebauthnChooser.onSettled`) and the refusal goes away.
	assert.equal(requests.settleByRequestId("webauthn-9"), false, "not this one");
	assert.ok(requests.conflict(10, "navigate"));
	assert.equal(requests.settleByRequestId("webauthn-1"), true);
	assert.equal(requests.conflict(10, "navigate"), null);
	assert.deepEqual(events, [
		["begin", 1],
		["end", 1],
	]);
});

// ---- the CDP choke point ---------------------------------------------------

class FakeDebugger extends EventEmitter {
	constructor() {
		super();
		this.commands = [];
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

test("the pool refuses document-replacing AND capture commands; reads and input reach Chromium", async () => {
	const pool = new CdpPool();
	const contents = new FakeContents(10);
	await pool.attach(contents);
	const { requests } = rig();
	pool.setAuthRequestGate(requests);
	requests.admit(ceremony());
	const before = contents.debugger.commands.length;
	for (const method of [
		"Page.navigate",
		"Page.reload",
		"Page.navigateToHistoryEntry",
	]) {
		await assert.rejects(pool.send(contents, method, {}), (error) => {
			assert.equal(error.code, "owner_refused");
			assert.equal(error.data?.reason, AUTH_REQUEST_REFUSAL_REASON);
			return true;
		});
	}
	// THE CDP BACKSTOP (review S2/S3): a present provider frame refuses every
	// command that would hand the agent its pixels, typed as `capture`.
	for (const method of [
		"Page.captureScreenshot",
		"Page.startScreencast",
		"Page.startScreenRecording",
		"Page.captureSnapshot",
		"IO.read",
	]) {
		await assert.rejects(pool.send(contents, method, {}), (error) => {
			assert.equal(error.data?.reason, AUTH_REQUEST_REFUSAL_REASON, method);
			assert.equal(error.data?.action, "capture", method);
			return true;
		});
	}
	assert.equal(
		contents.debugger.commands.length,
		before,
		"nothing reached the debugger",
	);
	// POSITIVE CONTROL: the agent keeps the tab. Reads and input reach Chromium.
	const allowed = [
		"DOM.getDocument",
		"DOM.querySelector",
		"Accessibility.getFullAXTree",
		"CSS.getComputedStyleForNode",
		"Input.dispatchMouseEvent",
		"Runtime.evaluate",
		"Network.enable",
		"Page.stopScreencast",
	];
	for (const method of allowed) {
		const answer = await pool.send(contents, method, {});
		assert.deepEqual(answer, { data: "pixels" }, method);
	}
	assert.deepEqual(contents.debugger.commands.slice(before), allowed);
	// Another tab is untouched by this one's prompt: its capture goes through.
	const other = new FakeContents(11);
	await pool.attach(other);
	assert.deepEqual(await pool.send(other, "Page.captureScreenshot", {}), {
		data: "pixels",
	});
});

test("CDP events keep flowing while a request is live: the agent's own captures are work", async () => {
	const pool = new CdpPool();
	const contents = new FakeContents(10);
	await pool.attach(contents);
	const { requests } = rig();
	pool.setAuthRequestGate(requests);
	requests.admit(ceremony());
	const seen = [];
	const stop = pool.subscribe(10, (method) => seen.push(method));
	for (const method of [
		"Page.screencastFrame",
		"Runtime.consoleAPICalled",
		"Network.requestWillBeSent",
		"Fetch.requestPaused",
	])
		contents.debugger.emit("message", {}, method, {});
	stop();
	assert.deepEqual(seen, [
		"Page.screencastFrame",
		"Runtime.consoleAPICalled",
		"Network.requestWillBeSent",
		"Fetch.requestPaused",
	]);
});

// ---- the registry choke point ----------------------------------------------

class FakeView {
	constructor(id) {
		this.webContents = new FakeContents(id);
		this.webContents.executeJavaScriptInIsolatedWorld = async () => "page text";
	}
	setBounds() {}
	setVisible() {}
}

function registryWith(requests) {
	let id = 50;
	const registry = new TabRegistry(
		() => new FakeView(id++),
		() => {},
		() => {},
	);
	registry.setAuthRequestGate(requests);
	return registry;
}

test("requireSurface SERVES the tab while a request is live (no whole-tab lock)", () => {
	const { requests } = rig();
	const registry = registryWith(requests);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	const token = surfaceToken(agent);
	requests.admit(
		ceremony({ webContentsId: agent.view.webContents.id, tabId: agent.tabId }),
	);
	assert.equal(
		registry.requireSurface(token),
		agent,
		"the agent's own tab is still its own: query, read, screenshot all resolve here",
	);
	// The interfering actions answer the ONE typed refusal, naming the request.
	const view = requests.viewForTab(agent.tabId);
	for (const action of ["close", "navigate"]) {
		assert.throws(
			() =>
				registry.assertNoConflictingAuthRequest(
					agent.view.webContents.id,
					action,
				),
			(error) =>
				error.code === "owner_refused" &&
				error.data?.reason === AUTH_REQUEST_REFUSAL_REASON &&
				error.data?.requestId === view.requestId,
		);
	}
});

test("a handle-less close of the sole tab that hosts a request is refused; the tab stays open", async () => {
	const { requests } = rig();
	const registry = registryWith(requests);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	requests.admit(
		ceremony({ webContentsId: agent.view.webContents.id, tabId: agent.tabId }),
	);
	const ctx = {
		registry,
		approvals: { forgetDocument: () => {} },
		onChanged: () => {},
	};
	await assert.rejects(
		closeTab(ctx, {}),
		(error) =>
			error.code === "owner_refused" &&
			error.data?.reason === AUTH_REQUEST_REFUSAL_REASON,
	);
	await assert.rejects(closeTab(ctx, { tab: surfaceToken(agent) }), (error) => {
		assert.equal(error.data?.reason, AUTH_REQUEST_REFUSAL_REASON);
		return true;
	});
	assert.equal(registry.get(agent.tabId), agent, "the tab is still open");
	// Once the request ends, the same close goes through.
	requests.forget(agent.view.webContents.id);
	assert.deepEqual(await closeTab(ctx, { tab: surfaceToken(agent) }), {
		closed: surfaceToken(agent),
	});
});

test("the capture guard: a recording ends when a prompt frame loads, and nothing is published", () => {
	// `discardRecordingForAuthPrompt` has no recording to end here, so the call is
	// a no-op rather than a throw: the admission path must not depend on one.
	assert.doesNotThrow(() => discardRecordingForAuthPrompt(10));
});

// ---- host dispatch: the wiring in `index.ts` -------------------------------
//
// `index.ts` needs Electron, so its half is pinned by reading it (the same
// technique `browser-user-attention.test.mjs` uses for the no-raise rule). What
// is asserted here is the SHAPE of the dispatch, and every claim has a
// module-level case above that exercises the behaviour it wires.

const readSource = (path) => readFileSync(path, "utf8");

test("host dispatch: a provider document is admitted only after a person engaged, and the tab is never held", () => {
	const index = readSource("src/main/browser/index.ts");
	// The admission site, with every lock on the ambiguous document.
	assert.match(index, /authRequests\.admit\(\{/);
	assert.match(index, /engaged: engagement\.has\(tabId\)/);
	assert.match(index, /isInstalled: \(id\) => extensions\.isActive\(id\)/);
	assert.match(
		index,
		/!event\.isMainFrame &&/,
		"a provider document is never a tab's own document",
	);
	// The blanket refusals that the round-5 review blocked on are gone: no
	// "use a human-owned tab", and no whole-tab custody gate anywhere.
	assert.doesNotMatch(index, /use a human-owned tab/);
	assert.doesNotMatch(index, /assertNotInCustody/);
	assert.doesNotMatch(index, /setCustodyGate/);
	assert.doesNotMatch(readSource("src/main/browser/registry.ts"), /\bisHeld\(/);
	assert.doesNotMatch(readSource("src/main/browser/registry.ts"), /guardRead/);
	// Both enforcement points, installed together.
	assert.match(index, /registry\.setAuthRequestGate\(authRequests\)/);
	assert.match(index, /cdp\.setAuthRequestGate\(authRequests\)/);
	// The capture guard runs on admission — where a prompt frame is about to
	// exist — and nowhere else.
	assert.match(index, /discardRecordingForAuthPrompt\(view\.webContents\.id\)/);
});

test("host dispatch: one corner-card notice, and dismissing it settles nothing", () => {
	const index = readSource("src/main/browser/index.ts");
	// The provider request shares the approvals card's notice slot with a native
	// request; there is no second, full-width surface.
	assert.match(
		index,
		/passkeyNoticeFor\(active, authRequests, nativePasskeyNotice\)/,
	);
	assert.match(
		index,
		/approvalsOverlay\?\.setNotice\(/,
		"the card is the only notice surface",
	);
	// A dismissal from the card reaches the provider request too, and the only
	// thing it calls is `dismiss` (presentation). No settle, no reload, no cancel.
	assert.match(
		index,
		/dismissPasskeyNotice\(notice, authRequests, nativePasskeyNotice\)/,
	);
	assert.doesNotMatch(
		index,
		/dismiss[\s\S]{0,200}(reload\(|settleByRequestId|cancelForTab)/,
		"dismissing a notice must never act on the request it describes",
	);
	// No banner and no "Return to Agent" control anywhere in the product source.
	for (const path of [
		"src/main/browser/index.ts",
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"src/renderer/src/features/browser/hooks/use-browser-chrome.ts",
	])
		assert.doesNotMatch(
			readSource(path),
			/Return to Agent|returnToAgent/,
			path,
		);
});

test("host dispatch: a native request is the same state on an AGENT tab, and never on the user's", () => {
	const index = readSource("src/main/browser/index.ts");
	assert.match(
		index,
		/if \(authSource\?\.owner === "agent" && request\.tabId !== null\)/,
	);
	assert.match(index, /authRequests\.beginNative\(\{/);
	assert.match(
		index,
		/if \(authRequests\.settleByRequestId\(requestId\)\)/,
		"the chooser's settle is what ends it",
	);
	// A tab that closes, or changes hands, drops its request with it.
	assert.match(index, /authRequests\.forget\(webContentsId\)/);
	assert.match(
		index,
		/authRequests\.forget\(\s*record\.view\.webContents\.id,\s*"the tab changed hands",?\s*\)/,
	);
	// The host still projects a real request into the chrome, and does it by
	// asking THIS state rather than the deleted custody view.
	const host = readSource("src/main/browser/host.ts");
	assert.match(
		host,
		/pendingAuthRequest\?: \(tabId: number\) => PendingAuthRequestView/,
	);
	assert.doesNotMatch(host, /passkeyCustody/);
});

// ---- the two Storybook states (Reach Directory), as negative controls -------
//
// The reported acceptance case (desktop #2014): the loading and populated Reach
// Directory stories put agent-only navigation into a password-manager hold, so a
// screenshot and a close were refused. Both are reproduced here at the module
// and registry level: agent-only navigation (nobody clicked into the tab) admits
// NOTHING — neither the passive card nor a ceremony document — so no notice, no
// row and no refusal can exist, and the agent's own screenshot and close go
// through.
//
// SOURCE-MATCHED, NOT NATIVE: these are the production functions the host calls,
// with a synthetic provider frame. No Electron, no window, no network.

const REACH_LOADING = "https://reach.example/directory";
const REACH_POPULATED = "https://reach.example/directory?q=all&page=2";

/** An agent tab on a page with a provider frame trying to load, and nobody has
 * engaged it: exactly what the two stories are. */
function reachStory(pageUrl) {
	let id = 70;
	const requests = new AuthRequests({ log: () => {}, now: () => 7_000 });
	const registry = new TabRegistry(
		() => {
			const view = new FakeView(id++);
			view.webContents.getURL = () => pageUrl;
			return view;
		},
		() => {},
		() => {},
	);
	registry.setAuthRequestGate(requests);
	const pool = new CdpPool();
	pool.setAuthRequestGate(requests);
	const agent = registry.create({ owner: "agent", sessionId: "session:a" });
	return { requests, registry, pool, agent, pageUrl };
}

for (const [label, pageUrl] of [
	["loading", REACH_LOADING],
	["populated", REACH_POPULATED],
]) {
	test(`Reach Directory (${label}): agent-only navigation admits nothing and refuses nothing`, async () => {
		const { requests, registry, pool, agent } = reachStory(pageUrl);
		for (const url of [PROMPT, USO, MENU]) {
			assert.equal(
				requests.admit({
					webContentsId: agent.view.webContents.id,
					tabId: agent.tabId,
					url,
					engaged: false,
					isInstalled: installed,
					frame: LIVE,
				}),
				false,
				`${url}: nothing is admitted before a person engages the tab`,
			);
		}
		assert.equal(
			requests.hasRequests(),
			false,
			"no request, so no notice anywhere",
		);
		assert.equal(
			requests.viewForTab(agent.tabId),
			null,
			"and no WAITING projection",
		);
		// The agent keeps the tab it opened: the surface resolves, a capture
		// reaches Chromium with its answer delivered, and the close works.
		assert.equal(registry.requireSurface(surfaceToken(agent)), agent);
		const contents = new FakeContents(agent.view.webContents.id);
		await pool.attach(contents);
		assert.deepEqual(await pool.send(contents, "Page.captureScreenshot", {}), {
			data: "pixels",
		});
		assert.deepEqual(
			await closeTab(
				{
					registry,
					approvals: { forgetDocument: () => {} },
					onChanged: () => {},
				},
				{ tab: surfaceToken(agent) },
			),
			{
				closed: surfaceToken(agent),
			},
		);
	});
}

// ---- architect option A: presence-keyed quarantine, ceremony-keyed lifecycle -
//
// Review S1-S4 and B3-B7. Every case drives the production function with a
// synthetic provider frame and a scripted debugger: no Electron, no window.

/** A debugger whose answers are scripted per method, and which can run a hook
 * WHILE a command is in flight (the admission races). */
class ScriptedDebugger extends FakeDebugger {
	constructor(answers = {}, hooks = {}) {
		super();
		this.answers = answers;
		this.hooks = hooks;
	}
	sendCommand(method, params) {
		this.commands.push(method);
		this.hooks[method]?.(params);
		const answer = this.answers[method];
		return Promise.resolve(
			typeof answer === "function" ? answer(params) : (answer ?? {}),
		);
	}
}

/** One agent tab in a registry + pool wired to `requests`, as the host does. */
async function wired({ answers = {}, hooks = {}, overrides = {} } = {}) {
	const { requests, events } = rig(overrides);
	const registry = registryWith(requests);
	const pool = new CdpPool();
	pool.setAuthRequestGate(requests);
	const record = registry.create({ owner: "agent", sessionId: "session:a" });
	const contents = record.view.webContents;
	contents.debugger = new ScriptedDebugger(answers, hooks);
	contents.getTitle = () => "Sign in";
	await pool.attach(contents);
	const ctx = {
		registry,
		cdp: pool,
		log: () => {},
		onChanged: () => {},
		approvals: { forgetDocument: () => {} },
	};
	const target = { webContentsId: contents.id, tabId: record.tabId };
	return { requests, events, registry, pool, record, contents, ctx, target };
}

const PROMPT_IFRAME = {
	nodeName: "IFRAME",
	backendNodeId: 99,
	attributes: ["src", PROMPT],
};
/** The page's pierced DOM with 1Password's card in a closed shadow root, and
 * the card's border box at (100,100)-(300,200). */
const PROMPT_DOM = {
	"DOM.getDocument": {
		root: {
			nodeName: "#document",
			children: [
				{
					nodeName: "HTML",
					children: [
						{
							nodeName: "COM-1PASSWORD-NOTIFICATION",
							shadowRoots: [
								{ nodeName: "#document-fragment", children: [PROMPT_IFRAME] },
							],
						},
						{
							nodeName: "IFRAME",
							backendNodeId: 7,
							attributes: ["src", "https://captcha.example/"],
						},
					],
				},
			],
		},
	},
	"DOM.getBoxModel": ({ backendNodeId }) =>
		backendNodeId === 99
			? { model: { border: [100, 100, 300, 100, 300, 200, 100, 200] } }
			: { model: { border: [0, 0, 10, 0, 10, 10, 0, 10] } },
};

test("S2: screenshot is refused BEFORE any CDP call while a provider frame is present — passive card included", async () => {
	for (const url of [PROMPT, USO]) {
		const { requests, ctx, record, contents, target } = await wired();
		requests.admit(ceremony(target, { url }));
		const before = contents.debugger.commands.length;
		await assert.rejects(
			screenshot(ctx, { tab: surfaceToken(record) }),
			(error) => {
				assert.equal(error.code, "owner_refused");
				assert.equal(error.data?.reason, AUTH_REQUEST_REFUSAL_REASON);
				assert.equal(error.data?.action, "capture");
				assert.match(
					error.message,
					/query, read, snapshot, hit_test, styles, scroll/,
				);
				return true;
			},
		);
		assert.equal(
			contents.debugger.commands.length,
			before,
			`${url}: no CDP call`,
		);
		// Presence-keyed, so the passive card refuses capture but is still no
		// request: no notice, no WAITING row.
		if (url === PROMPT) assert.equal(requests.viewForTab(record.tabId), null);
	}
});

test("S2: a provider frame admitted WHILE the capture is in flight drops the image", async () => {
	const state = await wired({
		answers: { "Page.captureScreenshot": { data: "secret-pixels" } },
		hooks: {
			"Page.captureScreenshot": () =>
				state.requests.admit(ceremony(state.target, { url: PROMPT })),
		},
	});
	await assert.rejects(
		screenshot(state.ctx, { tab: surfaceToken(state.record) }),
		(error) => {
			assert.equal(error.data?.action, "capture");
			assert.doesNotMatch(JSON.stringify(error.data), /secret-pixels/);
			return true;
		},
	);
	// Even when the frame is already gone again by the time the capture
	// returns: the epoch, not presence alone, catches it.
	const gone = await wired({
		answers: { "Page.captureScreenshot": { data: "secret-pixels" } },
		hooks: {
			"Page.captureScreenshot": () =>
				gone.requests.admit(
					ceremony(gone.target, { url: PROMPT, frame: GONE }),
				),
		},
	});
	await assert.rejects(
		screenshot(gone.ctx, { tab: surfaceToken(gone.record) }),
		(error) => error.data?.action === "capture",
	);
});

test("S2 POSITIVE CONTROL: no prompt, or a prompt that closed, and the screenshot is delivered", async () => {
	const { ctx, record, requests, target } = await wired({
		answers: { "Page.captureScreenshot": { data: "pixels" } },
	});
	assert.equal(
		(await screenshot(ctx, { tab: surfaceToken(record) })).data,
		"pixels",
	);
	requests.admit(ceremony(target, { url: PROMPT, frame: GONE }));
	assert.equal(
		(await screenshot(ctx, { tab: surfaceToken(record) })).data,
		"pixels",
		"a destroyed frame with nothing in the committed tree is not present",
	);
});

test("presence fails CLOSED: an unreadable frame tree or frame counts as present", () => {
	const blind = rig({
		hasProviderFrame: () => {
			throw new Error("unreadable");
		},
	});
	assert.equal(blind.requests.promptPresent(10), true);
	assert.ok(blind.requests.quarantine(10, "capture"));
	const { requests } = rig();
	requests.admit(
		ceremony(undefined, {
			url: PROMPT,
			frame: {
				isDestroyed: () => {
					throw new Error("gone?");
				},
			},
		}),
	);
	assert.equal(requests.promptPresent(10), true);
	// A frame-less admission is a placeholder only a main-document commit ends.
	const placeholder = rig();
	placeholder.requests.admit(
		ceremony(undefined, { url: PROMPT, frame: undefined }),
	);
	assert.equal(placeholder.requests.promptPresent(10), true);
	placeholder.requests.committed(10);
	assert.equal(placeholder.requests.promptPresent(10), false);
	// The committed tree alone (no admission seen) is presence too.
	assert.equal(
		rig({ hasProviderFrame: () => true }).requests.promptPresent(10),
		true,
	);
});

test("S3: record_start is refused before any CDP call while a prompt is present (passive card and ceremony)", async () => {
	const path = `${tmpdir()}/auth-request-${process.pid}.mp4`;
	for (const url of [PROMPT, USO]) {
		const { requests, ctx: base, record, contents, target } = await wired();
		// An encoder service is present, so the high engine reaches the same
		// presence check rather than its own "no encoder" refusal.
		const ctx = { ...base, recordingEncoder: {} };
		requests.admit(ceremony(target, { url }));
		const before = contents.debugger.commands.length;
		for (const quality of [undefined, "high"]) {
			await assert.rejects(
				recordStart(
					ctx,
					{ tab: surfaceToken(record), path, ...(quality ? { quality } : {}) },
					"req-1",
				),
				(error) =>
					error.data?.reason === AUTH_REQUEST_REFUSAL_REASON &&
					error.data?.action === "capture",
				`${url} ${quality ?? "standard"}`,
			);
		}
		assert.equal(
			contents.debugger.commands.length,
			before,
			`${url}: no CDP call`,
		);
	}
});

test("S3: an admission DURING record_start discards the clip, with or without the host's discard", async () => {
	const path = `${tmpdir()}/auth-request-race-${process.pid}.mp4`;
	// (a) the host's admission path: admit, then discard (index.ts).
	const a = await wired({
		hooks: {
			"Page.startScreenRecording": () => {
				a.requests.admit(ceremony(a.target, { url: PROMPT }));
				discardRecordingForAuthPrompt(a.contents.id);
			},
		},
	});
	await assert.rejects(
		recordStart(a.ctx, { tab: surfaceToken(a.record), path }, "req-a"),
		(error) => error.data?.reason === "record_aborted",
	);
	// (b) presence that arrived without the discard reaching the start (the
	// committed tree shows a provider frame): the post-start re-check discards.
	let present = false;
	const b = await wired({
		overrides: { hasProviderFrame: () => present },
		hooks: {
			"Page.startScreenRecording": () => {
				present = true;
			},
		},
	});
	await assert.rejects(
		recordStart(b.ctx, { tab: surfaceToken(b.record), path }, "req-b"),
		(error) => error.data?.reason === "record_aborted",
	);
	assert.ok(
		b.contents.debugger.commands.includes("Page.stopScreenRecording"),
		"the recorder Chromium started is stopped, unread",
	);
	assert.ok(
		!b.contents.debugger.commands.includes("IO.read"),
		"nothing was read back",
	);
});

test("S3: a prompt admitted while a recording RUNS discards it; record_stop publishes nothing", async () => {
	const path = `${tmpdir()}/auth-request-stop-${process.pid}.mp4`;
	const { requests, ctx, record, contents, target } = await wired({
		answers: { "Page.startScreenRecording": {} },
	});
	await recordStart(ctx, { tab: surfaceToken(record), path }, "req-s");
	requests.admit(ceremony(target, { url: PROMPT }));
	discardRecordingForAuthPrompt(contents.id);
	await assert.rejects(
		recordStop(ctx, { tab: surfaceToken(record) }, "req-s"),
		(error) => /prompt/i.test(error.message),
	);
	assert.ok(
		!contents.debugger.commands.includes("IO.read"),
		"no bytes were read",
	);
});

test("S1: a hover whose point is inside the provider frame's rect is refused; outside it is dispatched", async () => {
	const { requests, ctx, record, contents, target } = await wired({
		answers: PROMPT_DOM,
	});
	requests.admit(ceremony(target, { url: PROMPT }));
	const tab = surfaceToken(record);
	await assert.rejects(hover(ctx, { tab, x: 150, y: 150 }), (error) => {
		assert.equal(error.data?.action, "input");
		return true;
	});
	assert.ok(
		!contents.debugger.commands.includes("Input.dispatchMouseEvent"),
		"nothing dispatched",
	);
	// Measured from the PAGE session (the pierced DOM + box model), never by
	// attaching to the provider frame.
	assert.ok(contents.debugger.commands.includes("DOM.getBoxModel"));
	assert.ok(!contents.debugger.commands.includes("Target.attachToTarget"));
	// POSITIVE CONTROL: a point outside the rect reaches Chromium.
	await hover(ctx, { tab, x: 400, y: 400 }).catch(() => undefined);
	assert.ok(contents.debugger.commands.includes("Input.dispatchMouseEvent"));
});

test("S1: an unmeasurable prompt refuses every positional dispatch (fail closed)", async () => {
	for (const answers of [
		{ "DOM.getDocument": () => Promise.reject(new Error("no document")) },
		{ "DOM.getDocument": { root: { nodeName: "#document", children: [] } } }, // owner not found
		{ ...PROMPT_DOM, "DOM.getBoxModel": {} }, // no box
		{
			// owner inside a nested document: another coordinate space
			"DOM.getDocument": {
				root: {
					nodeName: "#document",
					children: [
						{
							nodeName: "IFRAME",
							backendNodeId: 5,
							attributes: ["src", "/same"],
							contentDocument: {
								nodeName: "#document",
								children: [PROMPT_IFRAME],
							},
						},
					],
				},
			},
		},
	]) {
		const { requests, ctx, record, contents, target } = await wired({
			answers,
		});
		requests.admit(ceremony(target, { url: PROMPT }));
		await assert.rejects(
			hover(ctx, { tab: surfaceToken(record), x: 400, y: 400 }),
			(error) => error.data?.action === "input",
		);
		assert.ok(!contents.debugger.commands.includes("Input.dispatchMouseEvent"));
	}
	// And with no prompt present, not one measurement is taken.
	const quiet = await wired({ answers: PROMPT_DOM });
	await hover(quiet.ctx, {
		tab: surfaceToken(quiet.record),
		x: 150,
		y: 150,
	}).catch(() => undefined);
	assert.ok(!quiet.contents.debugger.commands.includes("DOM.getBoxModel"));
	assert.ok(
		quiet.contents.debugger.commands.includes("Input.dispatchMouseEvent"),
	);
});

test("B4: a targetless key is refused while the prompt holds focus or focus is unknowable", async () => {
	for (const focusedFrame of [
		{ url: PROMPT },
		undefined, // API absent: unknowable
		{
			get url() {
				throw new Error("destroyed");
			},
		},
	]) {
		const { requests, ctx, record, contents, target } = await wired();
		requests.admit(ceremony(target, { url: PROMPT }));
		Object.defineProperty(contents, "focusedFrame", {
			value: focusedFrame,
			configurable: true,
		});
		await assert.rejects(
			press(ctx, { tab: surfaceToken(record), key: "a" }),
			(error) => error.data?.action === "key",
		);
		assert.ok(!contents.debugger.commands.includes("Input.dispatchKeyEvent"));
	}
});

test("B4 POSITIVE CONTROL: page focus, no prompt, or a selector-targeted key all press", async () => {
	const { requests, ctx, record, contents, target } = await wired({
		answers: {
			"DOM.getDocument": { root: { nodeId: 1 } },
			"DOM.querySelector": { nodeId: 2 },
			"DOM.resolveNode": { object: { objectId: "o-1" } },
			"DOM.describeNode": { node: { nodeName: "INPUT" } },
			"Runtime.callFunctionOn": { result: { value: true } },
		},
	});
	requests.admit(ceremony(target, { url: PROMPT }));
	Object.defineProperty(contents, "focusedFrame", {
		value: { url: "https://login.example/" },
		configurable: true,
	});
	await press(ctx, { tab: surfaceToken(record), key: "a" });
	assert.equal(
		contents.debugger.commands.filter((m) => m === "Input.dispatchKeyEvent")
			.length,
		2,
	);
	// The prompt has focus, but the key is aimed at a page element.
	Object.defineProperty(contents, "focusedFrame", {
		value: { url: PROMPT },
		configurable: true,
	});
	await press(ctx, {
		tab: surfaceToken(record),
		key: "a",
		selector: "#user",
	}).catch((error) => {
		assert.notEqual(
			error.data?.action,
			"key",
			"a targeted key is never the prompt refusal",
		);
	});
	// Another tab with no prompt: its targetless key presses, focus unread.
	const other = await wired();
	await press(other.ctx, { tab: surfaceToken(other.record), key: "a" });
	assert.equal(
		other.contents.debugger.commands.filter(
			(m) => m === "Input.dispatchKeyEvent",
		).length,
		2,
	);
});

test("POSITIVE CONTROL: reads resolve while capture is refused, and another tab keeps its full action set", async () => {
	const { requests, ctx, record, pool, contents, target } = await wired();
	requests.admit(ceremony(target, { url: PROMPT }));
	assert.equal(ctx.registry.requireSurface(surfaceToken(record)), record);
	for (const method of [
		"DOM.getDocument", // query, read
		"Accessibility.getFullAXTree", // snapshot
		"DOM.getNodeForLocation", // hit_test
		"CSS.getComputedStyleForNode", // styles
		"Runtime.evaluate", // scroll
	])
		await pool.send(contents, method, {});
	await assert.rejects(pool.send(contents, "Page.captureScreenshot", {}));
	// ANOTHER TAB of the SAME registry, pool and request state: capture,
	// record_start's command, input, keys and navigate all go through.
	const other = ctx.registry.create({ owner: "agent", sessionId: "session:a" });
	const otherContents = other.view.webContents;
	assert.notEqual(otherContents.id, contents.id);
	otherContents.debugger = new ScriptedDebugger({
		"Page.captureScreenshot": { data: "pixels" },
	});
	otherContents.getTitle = () => "Other";
	await pool.attach(otherContents);
	assert.equal(
		(await screenshot(ctx, { tab: surfaceToken(other) })).data,
		"pixels",
	);
	for (const method of [
		"Page.startScreenRecording",
		"Input.dispatchMouseEvent",
		"Input.dispatchKeyEvent",
		"Page.navigate",
	])
		await pool.send(otherContents, method, {});
	assert.equal(requests.quarantine(otherContents.id, "capture"), null);
	assert.equal(requests.conflict(otherContents.id, "navigate"), null);
});

test("POSITIVE CONTROL: before engagement nothing is admitted, so there is no notice, no row and no refusal", async () => {
	const { requests, events, ctx, record, target } = await wired({
		answers: { "Page.captureScreenshot": { data: "pixels" } },
	});
	for (const url of [PROMPT, USO])
		assert.equal(
			requests.admit(ceremony(target, { url, engaged: false })),
			false,
		);
	assert.equal(requests.promptPresent(target.webContentsId), false);
	assert.deepEqual(events, []);
	assert.equal(requests.viewForTab(record.tabId), null);
	assert.equal(
		(await screenshot(ctx, { tab: surfaceToken(record) })).data,
		"pixels",
	);
	// A passive card after engagement: present (capture refused) but still no
	// notice and no row.
	requests.admit(ceremony(target, { url: PROMPT }));
	assert.deepEqual(events, []);
	assert.equal(requests.viewForTab(record.tabId), null);
	assert.equal(requests.hasRequests(), false);
});

test("S4/B3: engagement is a LIVE human signal — page press engages, CDP input does not, blur and deactivation end it", async () => {
	const engagement = new TabEngagement();
	const live = {
		synthetic: false,
		primary: true,
		windowFocused: true,
		active: true,
	};
	// A person clicking straight into the page of the already-selected tab.
	engagement.pagePressed(1, live);
	assert.equal(engagement.has(1), true);
	// Each condition alone refuses.
	for (const press of [
		{ ...live, synthetic: true },
		{ ...live, windowFocused: false },
		{ ...live, active: false },
	]) {
		const fresh = new TabEngagement();
		fresh.pagePressed(1, press);
		assert.equal(fresh.has(1), false, JSON.stringify(press));
	}
	// The person leaves the app: engagement ends (no 20-minute-old latch).
	engagement.windowBlurred();
	assert.equal(engagement.has(1), false);
	engagement.selected(1, true, true);
	engagement.activated(2);
	assert.equal(engagement.has(1), false, "another tab became active");
	// THE SIGNAL CDP RAISES TOO: Electron's `before-mouse-event` fires for
	// `Input.dispatchMouseEvent` (electron_api_web_contents.cc, OnMouseEvent via
	// AddMouseEventCallback). The pool's in-flight record is what marks it as
	// the agent's: observed from INSIDE the command, as Chromium's callback is.
	const pool = new CdpPool();
	const contents = new FakeContents(10);
	let seenDuring = null;
	contents.debugger = new ScriptedDebugger(
		{},
		{
			"Input.dispatchMouseEvent": () => {
				seenDuring = pool.isDispatchingInput(10);
			},
		},
	);
	await pool.attach(contents);
	assert.equal(
		pool.isDispatchingInput(10),
		false,
		"a person's press, no command in flight",
	);
	await pool.send(contents, "Input.dispatchMouseEvent", {
		type: "mousePressed",
	});
	assert.equal(
		seenDuring,
		true,
		"a CDP press is marked synthetic while it is in flight",
	);
	assert.equal(
		pool.isDispatchingInput(10),
		false,
		"and the mark is released after",
	);
	// Wiring: the host feeds exactly these facts and clears on window blur.
	const index = readSource("src/main/browser/index.ts");
	assert.match(
		index,
		/const gesture = \{\s*synthetic: cdp\.isDispatchingInput\(contents\.id\),[\s\S]*?engagement\.pagePressed\(tabId, gesture\);\s*else engagement\.pageReleased\(tabId, gesture\);/,
	);
	assert.match(index, /options\.window\.on\("blur", endEngagementOnBlur\)/);
	assert.match(index, /removeListener\("blur", endEngagementOnBlur\)/);
});

test("a primary page click that acquires focus can admit a provider frame at release", () => {
	const engagement = new TabEngagement();
	const { requests, events } = rig();
	const focused = {
		synthetic: false,
		primary: true,
		windowFocused: true,
		active: true,
	};
	const beforeFocus = { ...focused, windowFocused: false };
	const admit = (overrides) =>
		requests.admit(
			ceremony(undefined, {
				url: PROMPT,
				engaged: engagement.has(1),
				...overrides,
			}),
		);

	engagement.pagePressed(1, beforeFocus);
	assert.equal(admit(), false, "before focus the press grants nothing");
	engagement.activated(1); // a layout pass on the SAME tab isn't a switch
	assert.equal(engagement.has(1), false);
	engagement.pageReleased(1, focused);

	assert.equal(engagement.has(2), false, "another tab is not engaged");
	assert.equal(admit({ url: MENU }), false, "non-prompt UI remains refused");
	assert.equal(
		admit({ url: PROMPT.replace(ONEPASSWORD, "a".repeat(32)) }),
		false,
		"an unknown provider cannot use the same path",
	);
	assert.equal(admit({ isInstalled: () => false }), false, "disabled provider");
	assert.equal(admit(), true, "the known enabled provider frame may load");
	assert.deepEqual(
		events,
		[],
		"a generic autofill card is still not a request",
	);
});

test("a release cannot reuse missing, synthetic, or abandoned engagement evidence", () => {
	const focused = {
		synthetic: false,
		primary: true,
		windowFocused: true,
		active: true,
	};
	const beforeFocus = { ...focused, windowFocused: false };
	const negatives = [
		["no press", () => {}],
		[
			"synthetic press",
			(e) => e.pagePressed(1, { ...beforeFocus, synthetic: true }),
		],
		[
			"inactive press",
			(e) => e.pagePressed(1, { ...beforeFocus, active: false }),
		],
		[
			"non-primary press",
			(e) => e.pagePressed(1, { ...beforeFocus, primary: false }),
		],
		["different tab", (e) => e.pagePressed(2, beforeFocus)],
		[
			"synthetic release",
			(e) => e.pageReleased(1, { ...focused, synthetic: true }),
			true,
		],
		[
			"inactive release",
			(e) => e.pageReleased(1, { ...focused, active: false }),
			true,
		],
		["unfocused release", (e) => e.pageReleased(1, beforeFocus), true],
		[
			"non-primary release",
			(e) => e.pageReleased(1, { ...focused, primary: false }),
			true,
		],
		[
			"new press supersedes an abandoned one",
			(e) => e.pagePressed(1, { ...beforeFocus, synthetic: true }),
			true,
		],
		["pointer left before release", (e) => e.pagePointerLeft(1), true],
		["app blur", (e) => e.windowBlurred(), true],
		[
			"tab switch",
			(e) => {
				e.activated(2);
				e.activated(1);
			},
			true,
		],
		["renderer takes focus", (e) => e.clearAll(), true],
		["navigation or owner replacement", (e) => e.clear(1), true],
	];
	for (const [label, interrupt, seed] of negatives) {
		const engagement = new TabEngagement();
		if (seed) engagement.pagePressed(1, beforeFocus);
		interrupt(engagement);
		assert.equal(engagement.has(1), false, label);
		engagement.pageReleased(1, focused);
		assert.equal(engagement.has(1), false, label);
	}
});

test("B5: a generic prompt admitted BEFORE the passkey signal becomes the ceremony when it arrives", () => {
	const { requests, events } = rig();
	assert.equal(requests.admit(ceremony(undefined, { url: PROMPT })), true);
	assert.equal(requests.hasRequests(), false, "admitted as the passive card");
	assert.equal(requests.conflict(10, "navigate"), null);
	assert.equal(requests.corroborate(10), true);
	assert.deepEqual(events, [["begin", 1]], "one notice, now");
	assert.ok(
		requests.conflict(10, "navigate"),
		"and the request's lifecycle applies",
	);
	assert.equal(requests.corroborate(10), false, "idempotent");
	// A frame that is already gone is not reclassified.
	const gone = rig();
	gone.requests.admit(ceremony(undefined, { url: PROMPT, frame: GONE }));
	assert.equal(gone.requests.corroborate(10), false);
	assert.deepEqual(gone.events, []);
	const index = readSource("src/main/browser/index.ts");
	assert.match(
		index,
		/if \(passkeyNotices\.pendingFor\(tabId\)\)\s*authRequests\.corroborate\(contents\.id\)/,
	);
	assert.match(
		index,
		/corroborated: passkeyNotices\.pendingFor\(tabId\) !== null/,
	);
});

test("B5: a retained NotAllowedError notice is NOT a live request", () => {
	const now = 1_000;
	const notices = new PasskeyNotices({
		now: () => now,
		log: () => {},
		ownerOf: () => "agent",
	});
	const pending = {
		tabId: 1,
		origin: "https://login.example",
		embedded: false,
		kind: "get",
		at: now,
		ownerKind: "agent",
		suppressed: 0,
	};
	notices.tabs = new Map([
		[1, { notice: { ...pending, outcome: "not-allowed" } }],
	]);
	assert.ok(notices.viewFor(1), "still shown for its recovery copy");
	assert.equal(
		notices.pendingFor(1),
		null,
		"but not evidence of a live ceremony",
	);
	notices.tabs = new Map([[1, { notice: pending }]]);
	assert.ok(notices.pendingFor(1));
});

test("B6: a native request survives the sweep until its chooser settles or its document goes", () => {
	const { requests, events } = rig(); // hasProviderFrame: () => false
	requests.beginNative({
		engaged: true,
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-1",
	});
	requests.sweepAll();
	requests.sweep(10);
	assert.ok(requests.conflict(10, "close"), "no provider frame, still live");
	assert.equal(requests.settleByRequestId("webauthn-1"), true);
	assert.equal(requests.conflict(10, "close"), null);
	// Document teardown ends it too.
	const torn = rig();
	torn.requests.beginNative({
		engaged: true,
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-2",
	});
	torn.requests.committed(10);
	assert.equal(torn.requests.hasRequests(), false);
	assert.deepEqual(torn.events, [
		["begin", 1],
		["end", 1],
	]);
	assert.equal(events.length, 2);
});

test("B7: a ceremony admitted while navigate's gate is being set up refuses the loadURL", async () => {
	let loads = 0;
	const state = await wired({
		hooks: {
			"Page.getFrameTree": () => state.requests.admit(ceremony(state.target)),
		},
	});
	state.record.view.webContents.loadURL = async () => {
		loads += 1;
	};
	await assert.rejects(
		navigateView(
			state.ctx,
			state.record.view,
			new URL("https://elsewhere.example/"),
			"session:a",
			() => true,
			1_000,
		),
		(error) => error.data?.reason === AUTH_REQUEST_REFUSAL_REASON,
	);
	assert.equal(loads, 0, "the document the ceremony lives in was not replaced");
});

// ---- round 3 remediation ----------------------------------------------------

test("R8/U6/Q4: a native request on an UNENGAGED agent tab records nothing and refuses nothing", () => {
	const { requests, events } = rig();
	assert.equal(
		requests.beginNative({
			webContentsId: 10,
			tabId: 1,
			requestId: "webauthn-1",
			engaged: false,
		}),
		null,
	);
	assert.equal(requests.hasRequests(), false);
	assert.equal(requests.viewForTab(1), null, "no notice source");
	assert.equal(requests.conflict(10, "close"), null, "close allowed");
	assert.equal(requests.conflict(10, "navigate"), null, "navigate allowed");
	assert.deepEqual(events, [], "nothing projected");
	// Engaged: one request, and the refusals stay exactly as before.
	const view = requests.beginNative({
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-2",
		engaged: true,
	});
	assert.equal(view?.requestId, "webauthn-2");
	assert.deepEqual(events, [["begin", 1]]);
	assert.equal(
		requests.conflict(10, "close")?.data?.reason,
		AUTH_REQUEST_REFUSAL_REASON,
	);
	assert.equal(
		requests.conflict(10, "navigate")?.data?.reason,
		AUTH_REQUEST_REFUSAL_REASON,
	);
	// The host passes the person's live engagement, not a constant.
	assert.match(
		readSource("src/main/browser/index.ts"),
		/authRequests\.beginNative\(\{[\s\S]{0,200}engaged: engagement\.has\(record\.tabId\),/,
	);
});

test("Q3: a native request is never projected from AuthRequests (one notice identity per request)", () => {
	const { requests } = rig();
	requests.beginNative({
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-1",
		engaged: true,
	});
	assert.equal(requests.viewForTab(1)?.requestId, "webauthn-1");
	assert.equal(requests.providerViewForTab(1), null);
	const provider = rig();
	provider.requests.admit(ceremony());
	assert.equal(provider.requests.providerViewForTab(1)?.requestId, "auth-1-1");
});

test("U7/R12/Q6: blur mid-ceremony still admits the SAME provider's completion document in THAT tab only", () => {
	const OTHER =
		"chrome-extension://otherproviderid/inline/notification/notification.html";
	const { requests } = rig({ hasProviderFrame: () => true });
	// Engaged: the generic host is admitted (presence) and corroborated.
	assert.equal(
		requests.admit(ceremony(undefined, { url: PROMPT, corroborated: true })),
		true,
	);
	assert.equal(requests.hasRequests(), true);
	// The window blurs (Touch ID / 1Password unlock): engagement is gone.
	assert.equal(
		requests.admit(ceremony(undefined, { url: USO, engaged: false })),
		true,
		"the completion document of the same provider still loads",
	);
	// Another view (tab) with no presence of its own: still refused.
	assert.equal(
		requests.admit(
			ceremony({ webContentsId: 11, tabId: 2 }, { url: USO, engaged: false }),
		),
		false,
	);
	// A different provider in the same view: refused (no latch for it). Only a
	// known provider's document can be asked about, so the lock is checked on
	// the provider id: an unknown one never passes `passkeyPromptProvider`.
	assert.equal(
		requests.admit(ceremony(undefined, { url: OTHER, engaged: false })),
		false,
	);
});

test("U7: once the ceremony ends, an unengaged frame is refused again (no stale latch)", () => {
	let inTree = true;
	const frame = {
		gone: false,
		isDestroyed() {
			return this.gone;
		},
	};
	const { requests } = rig({ hasProviderFrame: () => inTree });
	requests.admit(ceremony(undefined, { frame }));
	assert.equal(requests.hasRequests(), true);
	frame.gone = true;
	inTree = false;
	requests.sweepAll();
	assert.equal(requests.hasRequests(), false, "the request ended");
	assert.equal(
		requests.admit(ceremony(undefined, { url: USO, engaged: false })),
		false,
		"a new frame after the request ended needs fresh engagement",
	);
	assert.equal(
		requests.admit(ceremony(undefined, { url: PROMPT, engaged: false })),
		false,
	);
});

test("U9: a frame-less admission stops quarantining once the committed tree shows its frame gone", () => {
	let inTree = false;
	const { requests } = rig({ hasProviderFrame: () => inTree });
	requests.admit(ceremony(undefined, { frame: null, url: PROMPT }));
	// Not committed yet: present (fail closed), refused.
	assert.equal(requests.promptPresent(10), true);
	assert.ok(requests.quarantine(10, "capture"));
	// Committed: still present.
	inTree = true;
	assert.equal(requests.promptPresent(10), true);
	// Verifiably gone from the committed tree: no longer present.
	inTree = false;
	assert.equal(requests.promptPresent(10), false);
	assert.equal(requests.quarantine(10, "capture"), null);
	assert.equal(requests.quarantine(10, "input"), null);
	// Unreadable keeps it present (fail closed).
	const unreadable = rig({
		hasProviderFrame: () => {
			throw new Error("tree unreadable");
		},
	});
	unreadable.requests.admit(ceremony(undefined, { frame: null, url: PROMPT }));
	assert.equal(unreadable.requests.promptPresent(10), true);
});

test("U9: an unmeasurable prompt rect is refused with copy that says so and names selector input", async () => {
	const { requests, ctx, record, target } = await wired({
		answers: {
			"DOM.getDocument": { root: { nodeName: "#document", children: [] } },
		},
	});
	requests.admit(ceremony(target, { url: PROMPT }));
	await assert.rejects(
		hover(ctx, { tab: surfaceToken(record), x: 400, y: 400 }),
		(error) => {
			assert.equal(error.data?.action, "input");
			assert.match(error.message, /could not be measured/);
			assert.match(error.message, /[Ss]elector- or ref-targeted/);
			assert.doesNotMatch(
				error.message,
				/inside the password manager's prompt/,
			);
			assert.doesNotMatch(error.message, /any point outside the prompt/);
			return true;
		},
	);
	// A measured point inside keeps the original copy.
	const measured = await wired({ answers: PROMPT_DOM });
	measured.requests.admit(ceremony(measured.target, { url: PROMPT }));
	await assert.rejects(
		hover(measured.ctx, { tab: surfaceToken(measured.record), x: 150, y: 150 }),
		(error) => /inside the password manager's prompt/.test(error.message),
	);
});

test("R10/Q5: the host ends a frame-less request on main-document commit", () => {
	const index = readSource("src/main/browser/index.ts");
	assert.match(
		index,
		/contents\.on\("did-navigate", \(_event, url\) => \{[\s\S]{0,1200}authRequests\.committed\(contents\.id\);/,
	);
	// And what that call does with a never-committed frame-less admission.
	const { requests } = rig({ hasProviderFrame: () => false });
	requests.admit(ceremony(undefined, { frame: null }));
	requests.sweepAll();
	assert.ok(requests.conflict(10, "close"), "placeholder keeps it live");
	requests.committed(10);
	assert.equal(requests.conflict(10, "close"), null);
	assert.equal(requests.promptPresent(10), false);
});

test("R11: an agent navigation ends the person's engagement of THAT tab", async () => {
	const { ctx, record, contents, registry } = await wired({
		answers: { "Page.getFrameTree": { frameTree: { frame: { id: "main" } } } },
	});
	const engagement = new TabEngagement();
	registry.setAgentNavigationListener((tabId) => engagement.clear(tabId));
	engagement.selected(record.tabId, true, true);
	assert.equal(engagement.has(record.tabId), true);
	contents.loadURL = async () => {
		contents.emit("did-stop-loading");
	};
	await navigateView(
		ctx,
		record.view,
		new URL("https://login.example/next"),
		"session:a",
		() => true,
		200,
	).catch(() => undefined);
	assert.equal(
		engagement.has(record.tabId),
		false,
		"the person engaged the old page, not the agent's next one",
	);
	// The host wires that listener to the engagement it admits on.
	assert.match(
		readSource("src/main/browser/index.ts"),
		/registry\.setAgentNavigationListener\(\(tabId\) => engagement\.clear\(tabId\)\)/,
	);
	assert.doesNotMatch(
		readSource("src/main/browser/extensions/tab-engagement.ts"),
		/when the person moves into the\s+\* app's own chrome or chat/,
	);
});
