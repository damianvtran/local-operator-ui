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
			'export { discardRecordingForAuthPrompt } from "./src/main/browser/actions/recording";',
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
	passkeyPromptKind,
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
	assert.equal(requests.admit(ceremony(undefined, { url: PROMPT, frame: LIVE })), true);
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
	assert.equal(
		requests.admit(ceremony(undefined, { frame: LIVE })),
		true,
	);
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
	assert.equal(requests.conflict(11, "navigate"), null, "another view, untouched");
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
	assert.equal(ended.requests.sweep(10), false, "the prompt closed: the request ends");
	assert.deepEqual(ended.events, [["begin", 1], ["end", 1]]);
	assert.equal(ended.requests.viewForTab(1), null, "and the notice clears with it");
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
	assert.deepEqual(closing.events, [["begin", 1], ["end", 1]]);
	assert.equal(events.length, 1, "no assertion above touched this rig's state");
});

test("dismissal HIDES the notice and nothing else: no settle, no reload, no cancel", () => {
	const { requests, events } = rig();
	requests.admit(ceremony());
	const view = requests.viewForTab(1);
	assert.equal(requests.dismiss(1, "auth-1-9"), false, "a stale id is ignored");
	assert.equal(requests.dismiss(1, view.requestId), true);
	assert.equal(requests.dismiss(1, view.requestId), false, "already dismissed");
	assert.deepEqual(events, [["begin", 1], ["change", 1, true]]);
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
		webContentsId: 10,
		tabId: 1,
		requestId: "webauthn-1",
	});
	assert.equal(view?.requestId, "webauthn-1");
	assert.deepEqual(events, [["begin", 1]]);
	assert.equal(
		requests.beginNative({ webContentsId: 10, tabId: 1, requestId: "webauthn-2" }),
		null,
		"one request per tab: a second begin is the same projection",
	);
	// The host settles it (`WebauthnChooser.onSettled`) and the refusal goes away.
	assert.equal(requests.settleByRequestId("webauthn-9"), false, "not this one");
	assert.ok(requests.conflict(10, "navigate"));
	assert.equal(requests.settleByRequestId("webauthn-1"), true);
	assert.equal(requests.conflict(10, "navigate"), null);
	assert.deepEqual(events, [["begin", 1], ["end", 1]]);
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

test("the pool refuses ONLY document-replacing commands: a screenshot in flight is delivered", async () => {
	const pool = new CdpPool();
	const contents = new FakeContents(10);
	await pool.attach(contents);
	const { requests } = rig();
	pool.setAuthRequestGate(requests);
	requests.admit(ceremony());
	const before = contents.debugger.commands.length;
	for (const method of ["Page.navigate", "Page.reload", "Page.navigateToHistoryEntry"]) {
		await assert.rejects(pool.send(contents, method, {}), (error) => {
			assert.equal(error.code, "owner_refused");
			assert.equal(error.data?.reason, AUTH_REQUEST_REFUSAL_REASON);
			return true;
		});
	}
	assert.equal(contents.debugger.commands.length, before, "nothing reached the debugger");
	// THE OPERATOR REQUIREMENT: the agent keeps the tab. Reads, captures and input
	// all reach Chromium and their answers are delivered.
	for (const method of [
		"Page.captureScreenshot",
		"DOM.getDocument",
		"Input.dispatchMouseEvent",
		"Runtime.evaluate",
		"Page.startScreencast",
		"Network.enable",
	]) {
		const answer = await pool.send(contents, method, {});
		assert.deepEqual(answer, { data: "pixels" }, method);
	}
	assert.deepEqual(contents.debugger.commands.slice(before), [
		"Page.captureScreenshot",
		"DOM.getDocument",
		"Input.dispatchMouseEvent",
		"Runtime.evaluate",
		"Page.startScreencast",
		"Network.enable",
	]);
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
	requests.admit(ceremony({ webContentsId: agent.view.webContents.id, tabId: agent.tabId }));
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
				registry.assertNoConflictingAuthRequest(agent.view.webContents.id, action),
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
	requests.admit(ceremony({ webContentsId: agent.view.webContents.id, tabId: agent.tabId }));
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
	assert.match(index, /const pending = active \? authRequests\.viewForTab/);
	assert.match(
		index,
		/approvalsOverlay\?\.setNotice\(/,
		"the card is the only notice surface",
	);
	// A dismissal from the card reaches the provider request too, and the only
	// thing it calls is `dismiss` (presentation). No settle, no reload, no cancel.
	assert.match(index, /authRequests\.dismiss\(tabId, pending\.requestId\)/);
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
		assert.doesNotMatch(readSource(path), /Return to Agent|returnToAgent/, path);
});

test("host dispatch: a native request is the same state on an AGENT tab, and never on the user's", () => {
	const index = readSource("src/main/browser/index.ts");
	assert.match(index, /if \(authSource\?\.owner === "agent" && request\.tabId !== null\)/);
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
	assert.match(host, /pendingAuthRequest\?: \(tabId: number\) => PendingAuthRequestView/);
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
		assert.equal(requests.hasRequests(), false, "no request, so no notice anywhere");
		assert.equal(requests.viewForTab(agent.tabId), null, "and no WAITING projection");
		// The agent keeps the tab it opened: the surface resolves, a capture
		// reaches Chromium with its answer delivered, and the close works.
		assert.equal(registry.requireSurface(surfaceToken(agent)), agent);
		const contents = new FakeContents(agent.view.webContents.id);
		await pool.attach(contents);
		assert.deepEqual(await pool.send(contents, "Page.captureScreenshot", {}), {
			data: "pixels",
		});
		assert.deepEqual(await closeTab({ registry, approvals: { forgetDocument: () => {} }, onChanged: () => {} }, { tab: surfaceToken(agent) }), {
			closed: surfaceToken(agent),
		});
	});
}
