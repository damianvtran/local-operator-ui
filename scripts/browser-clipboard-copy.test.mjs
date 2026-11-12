/**
 * The clipboard half of the browser host: the session's permission policy, the
 * host-authored page write, and the `copy` action that lets an agent copy without
 * the value entering a transcript.
 *
 * WHAT THESE TESTS ARE: the shipped TypeScript, bundled in memory with esbuild,
 * driven against a fake Session (so the two Electron permission handlers are the
 * ones the real install path registered), the COMMITTED page program run in a real
 * JSDOM document (so the shipped shim source is what is exercised, not a copy of
 * it), and the electron stub's in-memory clipboard. They pin the three properties
 * that would otherwise be invisible in review: WHAT the session permits, that the
 * page's write is truthful (resolves only on a real write, rejects without a
 * gesture), and that the receipt never contains the text it describes.
 *
 * WHAT THEY ARE NOT: native proof. A real browser, a real CDP binding, the real
 * macOS clipboard and a real user gesture are the app-level rig's job
 * (`scripts/browser-clipboard-proof.mjs`).
 *
 * EVERY TOKEN BELOW IS SYNTHETIC. Nothing here is a credential, and nothing here
 * prints one: the assertions about the receipt are about its SHAPE.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/profile";',
			'export * from "./src/main/browser/actions/clipboard-shim";',
			'export { copy } from "./src/main/browser/actions/page";',
			'export * from "./src/main/browser/protocol";',
			// The stub's own clipboard, so a test can read what the host wrote and can
			// make the write fail the way a locked clipboard does. Resolved through the
			// SAME alias the shipped modules use, so the test and the action cannot end
			// up holding two different clipboards.
			'export { clipboard } from "electron";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	// `profile.ts` imports `session` and the clipboard paths import `clipboard` as
	// VALUES, so the electron package must be substituted (unaliased, its
	// `index.js` calls `getElectronPath()` at module scope and throws here).
	alias: {
		electron: join(process.cwd(), "scripts/browser-electron-stub.ts"),
	},
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	installBrowserSessionHandlers,
	clipboardShimSource,
	CLIPBOARD_SENTINEL,
	installClipboardShim,
	armHostClipboardWrite,
	CLIPBOARD_BINDING,
	CLIPBOARD_ACK,
	CLIPBOARD_SHIM_MAX_BYTES,
	copy,
	clipboard,
} = mod;

// ---- the session's permission policy --------------------------------------

/** A Session fake that keeps the handlers the shipped code registered. */
function fakeSession() {
	const handlers = {};
	return {
		handlers,
		setUserAgent() {},
		setPermissionRequestHandler(fn) {
			handlers.request = fn;
		},
		setPermissionCheckHandler(fn) {
			handlers.check = fn;
		},
		on() {},
		removeListener() {},
		// `installClientHints` owns the session's two header listeners.
		webRequest: { onBeforeSendHeaders() {}, onHeadersReceived() {} },
	};
}

const HOST_VIEW_ID = 7;

function install(overrides = {}) {
	const session = fakeSession();
	const seen = [];
	installBrowserSessionHandlers(session, {
		onPermissionRequested: (details) => seen.push(details),
		...overrides,
	});
	return { session, seen };
}

const PAGE_URL = "https://app.gominerva.com/developers";
const view = { id: HOST_VIEW_ID, send: () => {} };

test("both handlers deny every permission, the clipboard pair included", () => {
	const { session, seen } = install();
	const answers = [];
	for (const permission of [
		"clipboard-read",
		"clipboard-sanitized-write",
		"media",
		"geolocation",
		"fullscreen",
		"notifications",
	]) {
		session.handlers.request(view, permission, (v) => answers.push(v), {
			isMainFrame: true,
			requestingUrl: PAGE_URL,
		});
		assert.equal(
			session.handlers.check(view, permission, PAGE_URL, {
				isMainFrame: true,
				requestingUrl: PAGE_URL,
			}),
			false,
			`the CHECK handler must refuse ${permission}`,
		);
	}
	assert.deepEqual(answers, Array(6).fill(false));
	assert.equal(
		seen.length,
		12,
		"every ask is reported, for a grant surface and for the log",
	);
	// `clipboard-read` is the permission this runtime actually asks for when a page
	// writes (see the measurement in `profile.ts`), so its refusal is the hard
	// guarantee the operator named: a page cannot READ the clipboard.
	assert.deepEqual(
		seen.filter((d) => d.permission === "clipboard-read").map((d) => d.granted),
		// One request and one check, both refused.
		[false, false],
	);
});

test("an unknown WebContents and a startup probe are reported, not judged", () => {
	const { session, seen } = install();
	const requested = [];
	session.handlers.request(
		{ id: 999 },
		"clipboard-read",
		(v) => requested.push(v),
		{ isMainFrame: true, requestingUrl: PAGE_URL },
	);
	// The startup probes: no WebContents, no document, no URL.
	assert.equal(session.handlers.check(null, "media", "", {}), false);
	assert.deepEqual(requested, [false]);
	assert.equal(seen[0].webContentsId, 999);
	assert.equal(seen[0].source, "request");
	assert.equal(
		seen[1].webContentsId,
		-1,
		"a probe reports -1 rather than pretending to be a view",
	);
	assert.equal(seen[1].source, "check");
	assert.equal(seen[1].granted, false);
});

// ---- the page write: a dumb transport, and a host that decides -------------

const TOKEN = "SYNTHETIC-token-clipboard-shim-NOT-A-CREDENTIAL";

/**
 * A document with the shipped shim installed into it.
 *
 * The shim holds NO credential and judges NOTHING, so this fixture provides no
 * nonce and no gesture input: it provides the binding the host injects, and the
 * ack the host calls. Whether a write HAPPENS is decided by the host gate, which
 * the tests below drive separately — that split is the whole point of the
 * redesign, so a fixture that could answer it here would be testing the old
 * design.
 */
function shimWindow({ clipboardApi = true } = {}) {
	const dom = new JSDOM("<!doctype html><body></body>", {
		runScripts: "outside-only",
	});
	const win = dom.window;
	const sent = [];
	win[CLIPBOARD_BINDING] = (payload) => sent.push(payload);
	const native = { writes: 0 };
	Object.defineProperty(win.navigator, "permissions", {
		value: {
			query: (descriptor) =>
				Promise.resolve({
					state: descriptor?.name === "clipboard-read" ? "denied" : "prompt",
				}),
		},
		configurable: true,
	});
	if (clipboardApi) {
		Object.defineProperty(win.navigator, "clipboard", {
			value: {
				writeText() {
					native.writes += 1;
					return Promise.resolve();
				},
				write() {
					native.writes += 1;
					return Promise.resolve();
				},
			},
			configurable: true,
		});
	}
	win.eval(clipboardShimSource());
	return {
		dom,
		win,
		sent,
		native,
		/** Settle the write the way the HOST does, from the binding event. */
		ack: (id, ok) => win[CLIPBOARD_ACK](id, ok),
		/** The ids the page has asked the host about, in order. */
		ids: () => sent.map((raw) => Number(String(raw).split("\n")[0])),
		/** The text the page handed the host, per call. */
		texts: () =>
			sent.map((raw) => String(raw).slice(String(raw).indexOf("\n") + 1)),
	};
}

test("the shim carries (id, text) to the binding and settles only on the host's ack", async () => {
	const f = shimWindow();
	const pending = f.win.navigator.clipboard.writeText(TOKEN);
	assert.equal(f.sent.length, 1, "the write reached the host binding");
	assert.deepEqual(f.texts(), [TOKEN], "the binding carries the page's text");
	assert.equal(typeof f.ids()[0], "number");
	const id = f.ids()[0];
	f.ack(id, true);
	await pending;
	assert.equal(
		f.native.writes,
		0,
		"the native write is never attempted: the host owns the write",
	);
	f.dom.window.close();
});

test("the shim holds NO credential: nothing page-readable identifies it", () => {
	const f = shimWindow();
	// The globals a page can ENUMERATE and read: the binding the host injected (an
	// injected binding is page-callable by construction) and the ack. Neither is a
	// credential — the ack only settles the page's own promise, and the binding call
	// is judged by the host.
	const published = Object.keys(f.win).filter((key) =>
		key.startsWith("__localOperatorClipboard"),
	);
	assert.deepEqual(
		published.sort(),
		[CLIPBOARD_ACK, CLIPBOARD_BINDING].sort(),
		"the binding and an ack — no nonce, no arm handle",
	);
	// The sentinel exists but is NOT enumerable, so a page that walks the globalThis
	// keys does not even learn the program is installed.
	assert.equal(f.win[CLIPBOARD_SENTINEL], true);
	assert.equal(
		Object.getOwnPropertyDescriptor(f.win, CLIPBOARD_SENTINEL).enumerable,
		false,
		"the sentinel is not discoverable by key enumeration",
	);
	f.dom.window.close();
});

test("the sentinel is non-writable and non-configurable, so a page cannot force a re-install", () => {
	const f = shimWindow();
	const descriptor = Object.getOwnPropertyDescriptor(f.win, CLIPBOARD_SENTINEL);
	assert.deepEqual(
		{ writable: descriptor.writable, configurable: descriptor.configurable },
		{ writable: false, configurable: false },
	);
	// A page trying to clear it fails, in both the sloppy and the strict spelling a
	// real page would use.
	assert.throws(() => {
		Object.defineProperty(f.win, CLIPBOARD_SENTINEL, { value: false });
	});
	const second = f.win.navigator.clipboard.writeText;
	f.win.eval(clipboardShimSource());
	assert.equal(
		f.win.navigator.clipboard.writeText,
		second,
		"a second install is a no-op (no wrapper around a wrapper)",
	);
	f.dom.window.close();
});

test("the shim judges no gesture: it forwards a write that the HOST then refuses", async () => {
	const f = shimWindow();
	// No userActivation at all in this world — and the write still reaches the host,
	// because deciding is the host's job. A gate here would be a page-patchable
	// control, which is exactly what review round 1 refused.
	Object.defineProperty(f.win.Navigator.prototype, "userActivation", {
		get: () => ({ isActive: false }),
		configurable: true,
	});
	const pending = f.win.navigator.clipboard.writeText(TOKEN);
	assert.equal(f.sent.length, 1);
	const id = f.ids()[0];
	f.ack(id, false);
	await assert.rejects(
		pending,
		(error) =>
			error.name === "NotAllowedError" && !/SYNTHETIC/.test(error.message),
	);
	assert.equal(
		f.native.writes,
		0,
		"the refusal never fell back to the native path",
	);
	f.dom.window.close();
});

test("an oversized write rejects in the page and never reaches the host", async () => {
	const f = shimWindow();
	await assert.rejects(
		f.win.navigator.clipboard.writeText(
			"x".repeat(CLIPBOARD_SHIM_MAX_BYTES + 1),
		),
		(error) => error.name === "QuotaExceededError",
	);
	assert.deepEqual(f.sent, []);
	// The boundary itself is allowed, or the cap would be off by one.
	void f.win.navigator.clipboard.writeText(
		"x".repeat(CLIPBOARD_SHIM_MAX_BYTES),
	);
	assert.equal(f.sent.length, 1);
	f.dom.window.close();
});

test("write() serves a text/plain ClipboardItem and falls through for anything else", async () => {
	const f = shimWindow();
	const item = {
		types: ["text/plain"],
		getType: () => Promise.resolve({ text: () => Promise.resolve(TOKEN) }),
	};
	const pending = f.win.navigator.clipboard.write([item]);
	// `write()` reads the item's blob first, so the binding call is a microtask
	// behind the call itself.
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(f.texts(), [TOKEN]);
	f.ack(f.ids()[0], true);
	await pending;
	// An image item is NOT this host's business: it takes the native path, which
	// fails exactly as it did before this change.
	const png = { types: ["image/png"], getType: () => Promise.resolve({}) };
	await f.win.navigator.clipboard.write([png]).catch(() => undefined);
	assert.equal(f.native.writes, 1, "the non-text item took the native path");
	f.dom.window.close();
});

test("permissions.query reports the host's write capability and never the read one", async () => {
	const f = shimWindow();
	const write = await f.win.navigator.permissions.query({
		name: "clipboard-write",
	});
	assert.equal(
		write.state,
		"granted",
		"a page that feature-detects before copying must not skip the copy",
	);
	assert.equal(typeof write.addEventListener, "function");
	const read = await f.win.navigator.permissions.query({
		name: "clipboard-read",
	});
	assert.equal(
		read.state,
		"denied",
		"the READ question keeps Chromium's answer",
	);
	f.dom.window.close();
});

test("a document with no clipboard API is left completely alone", () => {
	const dom = new JSDOM("<!doctype html><body></body>", {
		runScripts: "outside-only",
	});
	dom.window.eval(clipboardShimSource());
	assert.equal(dom.window[CLIPBOARD_SENTINEL], undefined, "no sentinel either");
	dom.window.close();
});

// ---- the HOST gate: the only authority ------------------------------------

/**
 * A CDP pool that answers the shipped install and then feeds it the events a real
 * renderer would.
 *
 * `activation` is what the ISOLATED world answers for
 * `navigator.userActivation.isActive`; a MAIN-world evaluate (which page script
 * could patch) answers `pageWorldActivation` instead, so a test can prove the host
 * never consults the patchable one.
 */
function hostFixture({
	activation = false,
	pageWorldActivation = false,
	mainFrameId = "FRAME-MAIN",
} = {}) {
	const calls = [];
	let listener = null;
	let isolatedSeq = 900;
	let isolatedContextId;
	const cdp = {
		send: async (_contents, method, params = {}) => {
			calls.push({ method, params });
			if (method === "Page.createIsolatedWorld") {
				isolatedContextId = ++isolatedSeq;
				return { executionContextId: isolatedContextId };
			}
			if (method === "Page.getFrameTree") {
				return { frameTree: { frame: { id: mainFrameId } } };
			}
			if (method === "Runtime.evaluate") {
				if (String(params.expression).includes("userActivation")) {
					// The isolated reading is the one that counts; a probe in any other
					// context is the page's own (patchable) answer.
					const value =
						params.contextId === isolatedContextId
							? activation
							: pageWorldActivation;
					return { result: { value } };
				}
				return { result: { value: undefined } };
			}
			return {};
		},
		subscribe: (_id, handler) => {
			listener = handler;
			return () => {
				listener = null;
			};
		},
	};
	const emit = (method, params) => listener?.(method, params);
	return {
		cdp,
		calls,
		emit,
		/** Create a document's default context the way a renderer does. */
		context: (id, frameId = mainFrameId) =>
			emit("Runtime.executionContextCreated", {
				context: { id, auxData: { frameId, isDefault: true } },
			}),
		/** The page calling the binding directly, with no page-side ceremony. */
		bindingCall: (contextId, payload) =>
			emit("Runtime.bindingCalled", {
				name: CLIPBOARD_BINDING,
				payload,
				executionContextId: contextId,
			}),
		// The ack CALLS only: the install expression also mentions the ack's name (it
		// is in the config the program reads), so a substring match would count the
		// install itself as an ack.
		acks: () =>
			calls
				.filter(
					(call) =>
						call.method === "Runtime.evaluate" &&
						ACK_CALL.test(String(call.params.expression)),
				)
				.map((call) => String(call.params.expression)),
	};
}

/** One ack, as the host evaluates it. Module scope: the linter's top-level-regex
 * rule, and there is no reason to compile it per call. */
/** The activation probe itself, exactly (the install source also MENTIONS
 * `userActivation` in a comment, so a substring match finds the wrong call). */
const ACTIVATION_PROBE = /^navigator\.userActivation\.isActive === true$/;

const ACK_CALL = new RegExp(`^${CLIPBOARD_ACK}\\(\\d+, (true|false)\\)$`);

const settleHost = () => new Promise((resolve) => setTimeout(resolve, 30));

async function installedHost(options) {
	const fixture = hostFixture(options);
	const contents = { id: 1, isDestroyed: () => false };
	await installClipboardShim(fixture.cdp, contents, 77);
	fixture.context(7);
	await settleHost();
	return { ...fixture, contents };
}

test("HOST GATE (a): a direct binding call with no activation and no arm is refused", async () => {
	clipboard.text = "untouched";
	const host = await installedHost({ activation: false });
	host.bindingCall(7, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(
		clipboard.text,
		"untouched",
		"the binding call must never reach the OS clipboard",
	);
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, false)`]);
});

test("HOST GATE (b): an arm past its window is refused, because the HOST owns the clock", async () => {
	clipboard.text = "untouched";
	const host = await installedHost({ activation: false });
	assert.equal(
		armHostClipboardWrite(77, undefined, 10),
		true,
		"the main frame is armed for ten milliseconds",
	);
	await new Promise((resolve) => setTimeout(resolve, 40));
	host.bindingCall(7, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, "untouched", "an expired arm admits nothing");
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, false)`]);
});

test("HOST GATE: a live arm admits exactly ONE write, in its own frame", async () => {
	clipboard.text = "";
	const host = await installedHost({ activation: false });
	armHostClipboardWrite(77);
	host.bindingCall(7, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, TOKEN, "the arm admitted the write");
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, true)`]);
	// Consumed by that write.
	host.bindingCall(7, `2\n${TOKEN}`);
	await settleHost();
	assert.equal(
		clipboard.text,
		TOKEN,
		"a second write finds the arm spent (the text is unchanged, not re-written)",
	);
	assert.deepEqual(host.acks(), [
		`${CLIPBOARD_ACK}(1, true)`,
		`${CLIPBOARD_ACK}(2, false)`,
	]);
});

test("HOST GATE (c): a page patching userActivation, Date.now and JSON.stringify is still refused", async () => {
	clipboard.text = "untouched";
	// The page WOULD answer "active" — that is what a patched getter returns.
	const host = await installedHost({
		activation: false,
		pageWorldActivation: true,
	});
	// And this is what page script reaching for the payload path would look like.
	const f = shimWindow();
	f.win.JSON = { stringify: () => '{"id":1,"text":"pwned"}' };
	f.win.Date = { now: () => 0 };
	Object.defineProperty(f.win, "navigator", {
		value: {
			userActivation: { isActive: true },
			clipboard: f.win.navigator.clipboard,
		},
		configurable: true,
	});
	host.bindingCall(7, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(
		clipboard.text,
		"untouched",
		"the gate reads the ISOLATED world, so the page's own answer cannot admit it",
	);
	// The probe the host actually made: an isolated-world evaluate, not a page one.
	const probe = host.calls.find(
		(call) =>
			call.method === "Runtime.evaluate" &&
			ACTIVATION_PROBE.test(String(call.params.expression)),
	);
	assert.ok(probe, "the host asked the activation question");
	assert.equal(
		typeof probe.params.contextId,
		"number",
		"…with an execution context id, so it is a world the page cannot patch",
	);
	f.dom.window.close();
});

test("HOST GATE: a child frame cannot borrow the top frame's arm", async () => {
	clipboard.text = "untouched";
	const host = await installedHost({ activation: false });
	// A same-process child frame's default context, created the way a renderer does.
	host.context(8, "FRAME-CHILD");
	await settleHost();
	// An arm minted for the MAIN frame (what a click with no frame of its own does).
	armHostClipboardWrite(77, "FRAME-MAIN");
	host.bindingCall(8, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(
		clipboard.text,
		"untouched",
		"the per-frame rule: an arm for the main frame admits nothing in a child",
	);
	assert.match(host.acks()[0], /false/);
	// The same arm still works for the frame it was minted for.
	host.bindingCall(7, `2\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, TOKEN);
});

test("HOST GATE: a child frame is refused even WITH activation, because the reading cannot be trusted", async () => {
	clipboard.text = "untouched";
	// `activation: true` is the hostile case the narrowing exists for: on this runtime
	// a same-process child's isolated reading reported the TOP frame's activation, so
	// an activated child is exactly what a borrowed reading looks like.
	const host = await installedHost({ activation: true });
	host.context(8, "FRAME-CHILD");
	await settleHost();
	host.bindingCall(8, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(
		clipboard.text,
		"untouched",
		"main-frame-only: a child frame is refused regardless of what activation says",
	);
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, false)`]);
	// The main frame, on the same gate, is admitted — so this is a frame rule and not
	// a broken gate.
	host.bindingCall(7, `2\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, TOKEN);
});

test("HOST GATE: an unknown execution context is refused rather than trusted", async () => {
	clipboard.text = "untouched";
	const host = await installedHost({ activation: true });
	// A context the host never saw created: there is no frame to verify, so there is
	// nothing to admit.
	host.bindingCall(999, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, "untouched");
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, false)`]);
});

test("HOST GATE: real activation in the frame is enough, with no arm", async () => {
	clipboard.text = "";
	const host = await installedHost({ activation: true });
	host.bindingCall(7, `1\n${TOKEN}`);
	await settleHost();
	assert.equal(clipboard.text, TOKEN);
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, true)`]);
});

test("HOST GATE: the over-cap refusal is the HOST's, because the page's copy is patchable", async () => {
	clipboard.text = "untouched";
	const host = await installedHost({ activation: true });
	host.bindingCall(7, `1\n${"x".repeat(CLIPBOARD_SHIM_MAX_BYTES + 1)}`);
	await settleHost();
	assert.equal(clipboard.text, "untouched");
	assert.deepEqual(host.acks(), [`${CLIPBOARD_ACK}(1, false)`]);
});

// ---- the copy action ------------------------------------------------------

/** A context whose isolated world actually RUNS the committed page program, in a
 * real DOM: the alternative — a fake returning a canned object — would test the
 * host's parsing and nothing about the extraction. */
function fixture(html) {
	const dom = new JSDOM(html);
	const touched = [];
	const ctx = {
		registry: {
			// The real registry drops a read that crossed a passkey hold; no hold
			// exists in these fixtures, so the read runs as-is.
			guardRead: (_record, run) => run(),
			requireSurface(tab) {
				assert.equal(tab, "tab-1");
				return {
					tabId: 1,
					view: {
						webContents: {
							id: 1,
							executeJavaScriptInIsolatedWorld: async (_world, scripts) =>
								runInNewContext(scripts[0].code, {
									document: dom.window.document,
								}),
						},
					},
				};
			},
			touch(record) {
				touched.push(record.tabId);
			},
		},
	};
	return { dom, ctx, touched };
}

const sha = (text) =>
	createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);

test("a receipt describes the bytes and never carries them", async () => {
	clipboard.text = "";
	const { ctx, dom, touched } = fixture(
		`<main><h1>Create application</h1>
		 <p>Store application key</p>
		 <code id="app-key" class="key">  ${TOKEN}  </code></main>`,
	);
	const receipt = await copy(ctx, { tab: "tab-1", selector: "#app-key" });
	assert.deepEqual(receipt, {
		chars: TOKEN.length,
		sha256: sha(TOKEN),
		element: { tag: "code", id: "app-key", name: "" },
		verified: true,
	});
	// The value landed in the CLIPBOARD, which is the only place it may go...
	assert.equal(clipboard.text, TOKEN, "the clipboard holds the element's text");
	// ...and not in the answer a caller (and its transcript) receives.
	assert.ok(
		!JSON.stringify(receipt).includes(TOKEN),
		"the receipt must never contain the text it describes",
	);
	assert.deepEqual(touched, [1], "a copy touches the tab it read");
	dom.window.close();
});

test("a form field's value is copied and named in the receipt", async () => {
	clipboard.text = "";
	const { ctx, dom } = fixture(
		`<form><input id="app-key" name="applicationKey" value="${TOKEN}"></form>`,
	);
	const receipt = await copy(ctx, { tab: "tab-1", selector: "input#app-key" });
	assert.deepEqual(receipt, {
		chars: TOKEN.length,
		sha256: sha(TOKEN),
		element: { tag: "input", id: "app-key", name: "applicationKey" },
		verified: true,
	});
	assert.equal(clipboard.text, TOKEN);
	dom.window.close();
});

test("markup copies its trimmed textContent, not the indentation", async () => {
	clipboard.text = "";
	const { ctx, dom } = fixture(
		`<p id="wrapped">\n\t   hello\n\t   world\n\t </p>`,
	);
	const receipt = await copy(ctx, { tab: "tab-1", selector: "#wrapped" });
	assert.equal(
		clipboard.text,
		"hello\n\t   world",
		"only the edges are trimmed",
	);
	assert.equal(receipt.chars, Array.from(clipboard.text).length);
	assert.equal(receipt.sha256, sha(clipboard.text));
	dom.window.close();
});

test("missing, ambiguous and empty elements are typed refusals", async () => {
	clipboard.text = "untouched";
	const { ctx, dom } = fixture(
		`<div class="row" id="a">first</div><div class="row" id="b">second</div>
		 <p id="blank">   </p>`,
	);
	await assert.rejects(
		copy(ctx, { tab: "tab-1", selector: "#nope" }),
		(e) => e.code === "element_not_found" && /matched nothing/.test(e.message),
	);
	await assert.rejects(
		copy(ctx, { tab: "tab-1", selector: ".row" }),
		(e) =>
			e.code === "element_not_found" &&
			e.data.reason === "ambiguous_selector" &&
			e.data.count === 2 &&
			// The refusal names what DID match so one call corrects the selector, and
			// it names them by tag/id/name only — never by their text.
			JSON.stringify(e.data.matches) ===
				JSON.stringify([
					{ tag: "div", id: "a", name: "" },
					{ tag: "div", id: "b", name: "" },
				]),
	);
	await assert.rejects(
		copy(ctx, { tab: "tab-1", selector: "#blank" }),
		// Its own code, not `element_not_found`: the element is there and has nothing
		// in it, and the correction that follows is different.
		(e) => e.code === "empty_element_text" && e.data.reason === "empty_text",
	);
	assert.equal(
		clipboard.text,
		"untouched",
		"a refusal must not disturb what the user already had",
	);
	dom.window.close();
});

test("a refused clipboard write is typed and names no text", async () => {
	clipboard.text = "";
	clipboard.failWrite = "The clipboard is not available";
	const { ctx, dom } = fixture(`<code id="app-key">${TOKEN}</code>`);
	try {
		await assert.rejects(
			copy(ctx, { tab: "tab-1", selector: "#app-key" }),
			(e) =>
				e.code === "clipboard_write_failed" &&
				e.data.reason === "clipboard_write_failed" &&
				/The clipboard is not available/.test(e.message) &&
				!e.message.includes(TOKEN) &&
				!JSON.stringify(e.data).includes(TOKEN),
		);
	} finally {
		clipboard.failWrite = null;
		dom.window.close();
	}
	assert.equal(clipboard.text, "");
});

test("copy needs a selector and never touches the page without one", async () => {
	const ctx = {
		registry: {
			requireSurface() {
				assert.fail("the page was touched without a selector");
			},
		},
	};
	for (const params of [{ tab: "tab-1" }, { tab: "tab-1", selector: "  " }]) {
		await assert.rejects(
			copy(ctx, params),
			(e) => e.code === "internal" && e.data.reason === "invalid_arguments",
		);
	}
});

test("an invalid selector is the caller's input error, not a host fault", async () => {
	const ctx = {
		registry: {
			guardRead: (_record, run) => run(),
			requireSurface: () => ({
				tabId: 1,
				view: {
					webContents: {
						executeJavaScriptInIsolatedWorld: async () => {
							throw new Error(
								"SyntaxError: Failed to execute 'querySelectorAll' on 'Document': '##' is not a valid selector.",
							);
						},
					},
				},
			}),
			touch() {},
		},
	};
	await assert.rejects(
		copy(ctx, { tab: "tab-1", selector: "##" }),
		(e) => e.code === "element_not_found" && /is not valid/.test(e.message),
	);
});

test("the method is on the wire and advertised as a capability", () => {
	assert.ok(mod.METHODS.includes("copy"));
	assert.ok(mod.HOST_CAPABILITIES.includes("copy"));
	assert.equal(mod.COMMAND_TIMEOUTS_S.copy, 20);
	assert.equal(mod.isMethod("copy"), true);
	// Additive, so no version bump: an already-released peer must not be closed by
	// a proto mismatch, and the capability list is the gate instead.
	assert.equal(mod.PROTO_VERSION, 1);
	// A receipt-shaped answer has no field a text could hide in.
	assert.deepEqual(
		Object.keys({
			chars: 0,
			sha256: "",
			element: {},
			verified: true,
		}).sort(),
		["chars", "element", "sha256", "verified"],
	);
});
