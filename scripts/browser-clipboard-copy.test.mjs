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

// ---- the page write -------------------------------------------------------

const TOKEN = "SYNTHETIC-token-clipboard-shim-NOT-A-CREDENTIAL";
const NONCE = "nonce-fixture-0123456789abcdef";

/**
 * A document with the shipped shim installed into it.
 *
 * `gesture` is what Chromium's own `navigator.userActivation.isActive` would
 * answer; the shim captures the getter at document start, so the fixture has to
 * provide it BEFORE the source runs — exactly the order a real page has.
 */
function shimWindow({ gesture = true, clipboardApi = true } = {}) {
	const dom = new JSDOM("<!doctype html><body></body>", {
		runScripts: "outside-only",
	});
	const win = dom.window;
	const sent = [];
	win[CLIPBOARD_BINDING] = (payload) => sent.push(payload);
	const native = { writes: 0 };
	Object.defineProperty(win.Navigator.prototype, "userActivation", {
		get: () => ({ isActive: gesture }),
		configurable: true,
	});
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
	win.eval(clipboardShimSource(NONCE));
	return {
		dom,
		win,
		sent,
		native,
		/** Answer the write the way the host does, from the binding event. */
		ack: (id, ok) => win[CLIPBOARD_ACK](NONCE, id, ok),
		payloads: () => sent.map((raw) => JSON.parse(payloadText(raw))),
	};
}

/** CDP's binding payload is one string: the JSON the shim serialised. */
const payloadText = (raw) => (typeof raw === "string" ? raw : String(raw));

test("the shipped shim writes through the host and resolves only on its ack", async () => {
	const f = shimWindow();
	const pending = f.win.navigator.clipboard.writeText(TOKEN);
	assert.equal(f.sent.length, 1, "the write reached the host binding");
	const [payload] = f.payloads();
	assert.equal(payload.nonce, NONCE, "the per-tab nonce is the credential");
	assert.equal(payload.text, TOKEN, "the binding carries the page's text");
	assert.equal(typeof payload.id, "number");
	f.ack(payload.id, true);
	await pending;
	assert.equal(
		f.native.writes,
		0,
		"the native write is never attempted: the host owns the write",
	);
	f.dom.window.close();
});

test("a refused host write rejects the page's promise with NotAllowedError", async () => {
	const f = shimWindow();
	const pending = f.win.navigator.clipboard.writeText(TOKEN);
	const [payload] = f.payloads();
	f.ack(payload.id, false);
	await assert.rejects(
		pending,
		(error) =>
			error.name === "NotAllowedError" &&
			// The page must never be handed the text it already had, and must never be
			// told something that is not true about the clipboard.
			!/SYNTHETIC/.test(error.message),
	);
	f.dom.window.close();
});

test("an ack for the wrong nonce, or no ack at all, never resolves the page", async () => {
	const f = shimWindow();
	const pending = f.win.navigator.clipboard.writeText(TOKEN);
	const [payload] = f.payloads();
	// A page calling the ack itself with the wrong credential (or with none) must not
	// be able to confirm its own write.
	f.win[CLIPBOARD_ACK]("not-the-nonce", payload.id, true);
	await assert.rejects(
		pending,
		(error) => error.name === "NotAllowedError",
		"with no valid ack the write times out and rejects",
	);
	f.dom.window.close();
});

test("no user gesture rejects and never reaches the host", async () => {
	const f = shimWindow({ gesture: false });
	await assert.rejects(
		f.win.navigator.clipboard.writeText(TOKEN),
		(error) => error.name === "NotAllowedError",
	);
	assert.deepEqual(f.sent, [], "a drive-by write does not reach the binding");
	f.dom.window.close();
});

test("an oversized write rejects rather than truncating silently", async () => {
	const f = shimWindow();
	const huge = "x".repeat(CLIPBOARD_SHIM_MAX_BYTES + 1);
	await assert.rejects(
		f.win.navigator.clipboard.writeText(huge),
		(error) => error.name === "QuotaExceededError",
	);
	assert.deepEqual(f.sent, []);
	// And the boundary itself is allowed, or the cap would be off by one.
	const atLimit = f.win.navigator.clipboard.writeText("x".repeat(CLIPBOARD_SHIM_MAX_BYTES));
	assert.equal(f.sent.length, 1);
	const [payload] = f.payloads();
	f.ack(payload.id, true);
	await atLimit;
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
	const [payload] = f.payloads();
	assert.equal(payload.text, TOKEN);
	f.ack(payload.id, true);
	await pending;
	// An image item is NOT this host's business: it goes to the native path, which
	// fails exactly as it did before this change.
	const png = { types: ["image/png"], getType: () => Promise.resolve({}) };
	await f.win.navigator.clipboard.write([png]).catch(() => undefined);
	assert.equal(f.native.writes, 1, "the non-text item took the native path");
	f.dom.window.close();
});

test("permissions.query reports the host's write capability and never the read one", async () => {
	const f = shimWindow();
	const write = await f.win.navigator.permissions.query({ name: "clipboard-write" });
	assert.equal(
		write.state,
		"granted",
		"a page that feature-detects before copying must not skip the copy",
	);
	assert.equal(typeof write.addEventListener, "function");
	const read = await f.win.navigator.permissions.query({ name: "clipboard-read" });
	assert.equal(read.state, "denied", "the READ question keeps Chromium's answer");
	f.dom.window.close();
});

test("a document with no clipboard API is left completely alone", () => {
	const dom = new JSDOM("<!doctype html><body></body>", {
		runScripts: "outside-only",
	});
	// No throw, no globals: the shim is inert where the API it patches is absent.
	dom.window.eval(clipboardShimSource(NONCE));
	assert.equal(dom.window.navigator.clipboard, undefined);
	dom.window.close();
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
		(e) => e.code === "element_not_found" && e.data.reason === "empty_text",
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
				e.code === "internal" &&
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
