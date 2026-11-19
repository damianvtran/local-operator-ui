/**
 * The passkey notice (src/main/browser/passkey-notice.ts): the shim's pass-through
 * contract, the main-side attribution and rate limit, and the open door.
 *
 * The shim is executed for real here, in a `node:vm` context that stands in for a
 * page, against a fake `CredentialsContainer` whose `create`/`get` return promises
 * this test controls - so "the call is passed through unchanged" is asserted on the
 * promise identity and on the arguments the original received, not on the source text.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/main/browser/passkey-notice";',
			'export * from "./src/shared/browser-passkey-notice";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	PASSKEY_NOTICE_MIN_GAP_MS,
	PASSKEY_NOTICE_TTL_MS,
	PASSKEY_PENDING_MS,
	PASSKEY_SIGNAL_SENTINEL,
	PasskeyNotices,
	continuePasskeyNoticeInUserTab,
	httpOrigin,
	openPasskeyNoticeInSystemBrowser,
	parsePasskeySignal,
	passkeyShimSource,
} = mod;

/** A page: a CredentialsContainer with controllable promises, a console that
 * records, and timers the test advances by hand. */
function page(
	nonce = "n-1",
	observePending = true,
	resultFactory = () => new Promise(() => {}),
) {
	const lines = [];
	const timers = [];
	const calls = [];
	const returned = [];
	class CredentialsContainer {}
	CredentialsContainer.prototype.create = function create(...args) {
		calls.push(["create", this, args]);
		const promise = resultFactory();
		returned.push(promise);
		return promise;
	};
	CredentialsContainer.prototype.get = function get(...args) {
		calls.push(["get", this, args]);
		const promise = resultFactory();
		returned.push(promise);
		return promise;
	};
	const context = vm.createContext({
		CredentialsContainer,
		console: { debug: (line) => lines.push(line) },
		setTimeout: (fn, ms) => {
			timers.push({ fn, ms });
			return timers.length;
		},
	});
	vm.runInContext(passkeyShimSource(nonce, observePending), context);
	return {
		container: new CredentialsContainer(),
		CredentialsContainer,
		context,
		lines,
		timers,
		calls,
		returned,
		// Runs the delay timers, then lets the shim's microtask hops finish: the
		// signal is decided after the page's promise has had a chance to settle.
		fire: async () => {
			for (const timer of timers.splice(0)) timer.fn();
			await new Promise((resolve) => setImmediate(resolve));
		},
	};
}

test("the shim passes create and get through UNCHANGED: same args, same this, same promise", () => {
	const p = page();
	const opts = { publicKey: { challenge: new Uint8Array(1) } };
	const signal = {};
	const created = p.container.create(opts, signal);
	const got = p.container.get(opts);
	assert.equal(p.calls.length, 2);
	assert.equal(p.calls[0][1], p.container, "this is preserved");
	assert.equal(p.calls[0][2][0], opts, "the options object is the page's own");
	assert.equal(p.calls[0][2][1], signal, "extra arguments are preserved");
	assert.equal(
		created,
		p.returned[0],
		"the promise is the original, not a wrapper",
	);
	assert.equal(got, p.returned[1]);
});

test("the shim never settles or derives from the page's promise", async () => {
	const p = page();
	const promise = p.container.create({ publicKey: {} });
	await p.fire();
	// Still pending after the signal: the shim did not resolve or reject it.
	const winner = await Promise.race([
		promise.then(() => "settled"),
		new Promise((resolve) => setImmediate(() => resolve("pending"))),
	]);
	assert.equal(winner, "pending");
	// A rejection stays the page's own: the shim returns the ORIGINAL promise (no
	// derived `.then` that would mark it handled), so the page observes it exactly
	// as it would without the shim.
	const rejecting = page();
	const failure = new Error("NotAllowedError");
	const original = Promise.reject(failure);
	rejecting.CredentialsContainer.prototype.create = function create() {
		return original;
	};
	// Re-run the shim over the replaced method: it wraps whatever is current.
	const reshimmed = page();
	reshimmed.CredentialsContainer.prototype.create = function create() {
		return original;
	};
	vm.runInContext(
		passkeyShimSource("n-2").replace(
			/Symbol\.for\("[^"]+"\)/,
			'Symbol("fresh")',
		),
		reshimmed.context,
	);
	const returned = reshimmed.container.create({ publicKey: {} });
	assert.equal(returned, original, "the rejected promise is returned as is");
	await assert.rejects(returned, failure);
});

test("the shim signals only after the delay, once per call, with the fixed shape", async () => {
	const p = page("abc");
	p.container.create({ publicKey: {} });
	assert.deepEqual(p.lines, [], "nothing is logged synchronously");
	assert.equal(p.timers.length, 1);
	assert.equal(p.timers[0].ms, PASSKEY_PENDING_MS);
	await p.fire();
	assert.deepEqual(p.lines, [`${PASSKEY_SIGNAL_SENTINEL}abc:create`]);
	p.container.get({ publicKey: {} });
	await p.fire();
	assert.deepEqual(p.lines.at(-1), `${PASSKEY_SIGNAL_SENTINEL}abc:get`);
});

test("settled calls distinguish success from optional NotAllowed recovery", async () => {
	const p = page("abc");
	const settled = Promise.resolve({ id: "cred" });
	const rejected = Promise.reject(new DOMException("x", "NotAllowedError"));
	rejected.catch(() => {});
	p.CredentialsContainer.prototype.get = function get() {
		return settled;
	};
	// Re-shim over the replaced method with a fresh marker (see the test below).
	vm.runInContext(
		passkeyShimSource("abc").replace(/Symbol\.for\("[^"]+"\)/, 'Symbol("m1")'),
		p.context,
	);
	p.container.get({ publicKey: {} });
	await p.fire();
	assert.deepEqual(p.lines, [], "a resolved call is not a hang");
	p.CredentialsContainer.prototype.create = function create() {
		return rejected;
	};
	vm.runInContext(
		passkeyShimSource("abc").replace(/Symbol\.for\("[^"]+"\)/, 'Symbol("m2")'),
		p.context,
	);
	p.container.create({ publicKey: {} });
	await p.fire();
	assert.deepEqual(
		p.lines,
		[`${PASSKEY_SIGNAL_SENTINEL}abc:create:not-allowed`],
		"a rejected call offers recovery without calling it pending",
	);
});

test("configured Touch ID observes rejection but never announces a pending native sheet", async () => {
	const pending = page("native", false);
	pending.container.get({ publicKey: {} });
	await pending.fire();
	assert.deepEqual(pending.lines, []);
	let reject;
	const failed = page(
		"native",
		false,
		() =>
			new Promise((_, no) => {
				reject = no;
			}),
	);
	const promise = failed.container.get({ publicKey: {} });
	promise.catch(() => {});
	await failed.fire();
	const cancellationOrMissingCredential = new DOMException(
		"private RP detail",
		"NotAllowedError",
	);
	reject(cancellationOrMissingCredential);
	await assert.rejects(promise, cancellationOrMissingCredential);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(failed.lines, [
		`${PASSKEY_SIGNAL_SENTINEL}native:get:not-allowed`,
	]);
	assert.equal(
		failed.lines.some((line) => line.includes("private")),
		false,
	);
});

test("abort, validation, and security errors remain silent; success remains unchanged", async () => {
	for (const name of [
		"AbortError",
		"SecurityError",
		"TypeError",
		"InvalidStateError",
	]) {
		const error = new DOMException("not exported", name);
		const p = page("abort", true, () => Promise.reject(error));
		await assert.rejects(p.container.get({ publicKey: {} }), error);
		await p.fire();
		assert.deepEqual(p.lines, [], name);
	}
	const credential = { id: "private", response: {} };
	const success = page("ok", false, () => Promise.resolve(credential));
	assert.equal(await success.container.get({ publicKey: {} }), credential);
	await success.fire();
	assert.deepEqual(success.lines, []);
});

test("an explicit aborted signal never produces recovery even for NotAllowedError", async () => {
	for (const pending of [true, false]) {
		const controller = new AbortController();
		const error = new DOMException("cancelled", "NotAllowedError");
		const p = page("cancel", pending, () => Promise.reject(error));
		await assert.rejects(
			p.container.get({ publicKey: {}, signal: controller.signal }),
			error,
		);
		controller.abort();
		await p.fire();
		assert.deepEqual(p.lines, []);
	}
});

test("page-controlled rejection metadata cannot make the observer throw", async () => {
	const error = Object.defineProperty({}, "name", {
		get() {
			throw new Error("page getter must not escape");
		},
	});
	const p = page("hostile", true, () => Promise.reject(error));
	await p.container
		.get({ publicKey: {} })
		.catch((actual) => assert.equal(actual, error));
	await p.fire();
	assert.deepEqual(p.lines, []);
});

test("the shim ignores what is not a passkey request, including conditional mediation", () => {
	const p = page();
	p.container.get({ password: true });
	p.container.create({ password: { id: "a" } });
	p.container.get(undefined);
	p.container.get({ publicKey: {}, mediation: "conditional" });
	assert.equal(p.timers.length, 0, "no timer, so no signal, for any of these");
	assert.equal(p.calls.length, 4, "every call still reached the original");
});

test("running the shim twice does not wrap the wrapper", () => {
	const p = page("dup");
	vm.runInContext(passkeyShimSource("dup"), p.context);
	p.container.create({ publicKey: {} });
	assert.equal(p.timers.length, 1, "one wrapper, one timer");
});

test("the shim survives a page that has no CredentialsContainer", () => {
	const context = vm.createContext({ console: { debug() {} } });
	assert.doesNotThrow(() => vm.runInContext(passkeyShimSource("x"), context));
});

const NONCE_A = "00000000-0000-4000-8000-000000000001";

test("a signal parses only in the exact shape, and says which nonce it carries", () => {
	const ok = `${PASSKEY_SIGNAL_SENTINEL}${NONCE_A}:create`;
	assert.deepEqual(parsePasskeySignal(ok), { nonce: NONCE_A, kind: "create" });
	assert.deepEqual(
		parsePasskeySignal(`${PASSKEY_SIGNAL_SENTINEL}${NONCE_A}:get`),
		{ nonce: NONCE_A, kind: "get" },
	);
	assert.equal(parsePasskeySignal(`${ok} extra`), null, "no smuggled suffix");
	assert.equal(parsePasskeySignal(`x${ok}`), null);
	assert.equal(
		parsePasskeySignal(`${PASSKEY_SIGNAL_SENTINEL}${NONCE_A}:delete`),
		null,
	);
	assert.equal(
		parsePasskeySignal(`${PASSKEY_SIGNAL_SENTINEL}guess:create`),
		null,
		"a nonce is a UUID",
	);
	assert.equal(parsePasskeySignal({ toString: () => ok }), null);
});

/** Notices wired to a table of live frames, standing in for `webFrameMain`. */
function notices(owner = "user", clock = { t: 1_000_000 }) {
	const log = [];
	const frames = new Map();
	return {
		clock,
		log,
		frames,
		n: new PasskeyNotices({
			now: () => clock.t,
			log: (line) => log.push(line),
			ownerOf: () => owner,
			frameFacts: (key) => frames.get(key) ?? null,
		}),
	};
}
const line = (nonce, kind = "create") =>
	`${PASSKEY_SIGNAL_SENTINEL}${nonce}:${kind}`;

test("a valid signal raises one notice attributed to the FRAME's origin, never page text", () => {
	const { n, frames } = notices();
	frames.set("1:8", { origin: "https://rp.example", embedded: false });
	const nonce = n.nonceFor(7, "1:8");
	assert.equal(n.observe(7, line(nonce)), true);
	const view = n.viewFor(7);
	assert.equal(view.origin, "https://rp.example");
	assert.equal(view.kind, "create");
	assert.equal(view.embedded, false);
	assert.equal(view.ownerKind, "user");
	assert.equal(view.tabId, 7);
});

test("NotAllowed recovery carries a distinct outcome through nonce and origin validation", () => {
	const { n, frames, log } = notices();
	frames.set("1:8", { origin: "https://rp.example", embedded: false });
	const nonce = n.nonceFor(7, "1:8");
	const signal = `${line(nonce, "get")}:not-allowed`;
	assert.deepEqual(parsePasskeySignal(signal), {
		nonce,
		kind: "get",
		outcome: "not-allowed",
	});
	assert.equal(parsePasskeySignal(`${signal}:not-allowed`), null);
	assert.equal(parsePasskeySignal(`${signal}:private text`), null);
	assert.equal(n.observe(8, signal), false, "a different tab cannot replay it");
	assert.equal(n.observe(7, signal), true);
	assert.equal(n.viewFor(7).outcome, "not-allowed");
	assert.equal(n.viewFor(7).origin, "https://rp.example");
	assert.match(log.at(-1), /not-allowed from/);
	assert.doesNotMatch(log.at(-1), /pending/);
});

test("an embedded cross-origin frame is attributed to ITSELF, not to the top frame", () => {
	const { n, frames } = notices();
	frames.set("1:8", { origin: "https://top.example", embedded: false });
	frames.set("1:9", { origin: "https://widget.example:8443", embedded: true });
	n.nonceFor(1, "1:8");
	const widget = n.nonceFor(1, "1:9");
	n.observe(1, line(widget, "get"));
	const view = n.viewFor(1);
	assert.equal(view.origin, "https://widget.example:8443");
	assert.equal(view.embedded, true);
});

test("a nonce is stable for its frame and distinct across frames and tabs", () => {
	const { n } = notices();
	assert.equal(n.nonceFor(1, "1:8"), n.nonceFor(1, "1:8"));
	assert.notEqual(n.nonceFor(1, "1:8"), n.nonceFor(1, "1:9"));
	assert.notEqual(n.nonceFor(1, "1:8"), n.nonceFor(2, "1:8"));
});

test("a line with a guessed nonce, another tab's nonce, a vanished frame or an opaque origin raises nothing", () => {
	const { n, frames, log } = notices();
	frames.set("1:8", { origin: "https://a.example", embedded: false });
	const nonce = n.nonceFor(1, "1:8");
	assert.equal(n.observe(1, line(NONCE_A)), false, "never issued");
	assert.equal(n.observe(2, line(nonce)), false, "issued to tab 1, not tab 2");
	assert.equal(n.observe(1, "console noise"), false);
	assert.equal(n.viewFor(1), null);
	frames.delete("1:8");
	assert.equal(n.observe(1, line(nonce)), false, "the frame is gone");
	for (const opaque of ["null", "about:blank", "file:///x", undefined]) {
		frames.set("1:8", { origin: opaque, embedded: false });
		assert.equal(n.observe(1, line(nonce)), false, String(opaque));
	}
	assert.equal(
		n.viewFor(1),
		null,
		"no notice for a frame with no nameable origin",
	);
	assert.ok(log.some((l) => l.includes("no nameable origin")));
});

test("the notice is rate limited per tab and counts what it dropped", () => {
	const { n, frames, clock } = notices();
	frames.set("1:8", { origin: "https://a.example", embedded: false });
	frames.set("1:9", { origin: "https://b.example", embedded: false });
	const a = n.nonceFor(1, "1:8");
	const b = n.nonceFor(1, "1:9");
	assert.equal(n.observe(1, line(a)), true);
	const first = n.viewFor(1);
	clock.t += 1000;
	assert.equal(n.observe(1, line(a)), false, "same tab inside the gap");
	assert.equal(
		n.observe(1, line(b)),
		false,
		"another FRAME of the same tab shares the budget",
	);
	assert.equal(n.viewFor(1).at, first.at, "the shown notice did not change");
	clock.t += PASSKEY_NOTICE_MIN_GAP_MS;
	assert.equal(n.observe(1, line(b)), true);
	assert.equal(n.viewFor(1).origin, "https://b.example");
	assert.equal(n.viewFor(1).suppressed, 2);
	frames.set("2:1", { origin: "https://c.example", embedded: false });
	assert.equal(
		n.observe(2, line(n.nonceFor(2, "2:1"))),
		true,
		"another tab has its own budget",
	);
});

test("an agent-driven tab says so, in the view and in the log", () => {
	const { n, frames, log } = notices("agent");
	frames.set("1:8", { origin: "https://rp.example", embedded: false });
	n.observe(3, line(n.nonceFor(3, "1:8")));
	assert.equal(n.viewFor(3).ownerKind, "agent");
	assert.ok(log.some((l) => l.includes("agent-driven tab 3")));
});

test("a closed tab (owner unknown) raises nothing", () => {
	const { n, frames } = notices(null);
	frames.set("1:8", { origin: "https://rp.example", embedded: false });
	assert.equal(n.observe(3, line(n.nonceFor(3, "1:8"))), false);
});

test("a notice ages out, clears on a new document, dismisses by identity, and forgets with the tab", () => {
	const { n, frames, clock } = notices();
	frames.set("1:8", { origin: "https://a.example", embedded: false });
	const nonce = n.nonceFor(1, "1:8");
	n.observe(1, line(nonce));
	const at = n.viewFor(1).at;
	assert.equal(
		n.dismiss(1, at + 1),
		false,
		"a stale identity dismisses nothing",
	);
	assert.notEqual(n.viewFor(1), null);
	clock.t += PASSKEY_NOTICE_TTL_MS + 1;
	assert.equal(n.viewFor(1), null, "aged out");
	clock.t += PASSKEY_NOTICE_MIN_GAP_MS;
	n.observe(1, line(nonce));
	n.clearNotice(1);
	assert.equal(n.viewFor(1), null, "navigation cleared it");
	clock.t += PASSKEY_NOTICE_MIN_GAP_MS;
	n.observe(1, line(nonce));
	assert.equal(n.dismiss(1, n.viewFor(1).at), true);
	assert.equal(n.viewFor(1), null);
	n.forget(1);
	assert.equal(
		n.observe(1, line(nonce)),
		false,
		"a forgotten tab's nonces are void",
	);
});

test("the frames remembered per tab are bounded, oldest first", () => {
	const { n, frames } = notices();
	const first = n.nonceFor(1, "1:0");
	frames.set("1:0", { origin: "https://a.example", embedded: false });
	for (let i = 1; i <= 64; i++) n.nonceFor(1, `1:${i}`);
	assert.equal(
		n.observe(1, line(first)),
		false,
		"the oldest frame was evicted",
	);
});

test("httpOrigin names only http(s) origins", () => {
	assert.equal(
		httpOrigin("https://a.example:8443/x?y"),
		"https://a.example:8443",
	);
	assert.equal(httpOrigin("http://localhost:3000"), "http://localhost:3000");
	for (const v of [
		"null",
		"",
		"about:blank",
		"file:///a",
		"data:text/html,x",
		5,
		undefined,
	])
		assert.equal(httpOrigin(v), null, String(v));
});

test("open-in-system-browser reads the URL in main and refuses a stale notice", async () => {
	const { n, frames } = notices();
	frames.set("1:8", { origin: "https://rp.example", embedded: false });
	n.observe(4, line(n.nonceFor(4, "1:8")));
	const at = n.viewFor(4).at;
	const opened = [];
	const deps = {
		notices: n,
		tabId: 4,
		at,
		currentUrl: () => "https://rp.example/login?next=%2F",
		openExternal: async (url) => {
			opened.push(url);
			return { ok: true };
		},
		log: () => {},
	};
	assert.deepEqual(await openPasskeyNoticeInSystemBrowser(deps), { ok: true });
	assert.deepEqual(opened, ["https://rp.example/login?next=%2F"]);
	const stale = await openPasskeyNoticeInSystemBrowser({ ...deps, at: at + 1 });
	assert.equal(stale.ok, false);
	const noPage = await openPasskeyNoticeInSystemBrowser({
		...deps,
		currentUrl: () => null,
	});
	assert.equal(noPage.ok, false);
	assert.equal(opened.length, 1, "refusals never reached the opener");
	// The door's own refusal travels back untouched.
	const refused = await openPasskeyNoticeInSystemBrowser({
		...deps,
		openExternal: async () => ({
			ok: false,
			reason: "URL names a loopback or private-network host",
		}),
	});
	assert.deepEqual(refused, {
		ok: false,
		reason: "URL names a loopback or private-network host",
	});
});

test("continue-in-your-own-tab: agent notice only, current notice only, ids only, dismissed on success", async () => {
	// An agent tab's notice from an embedded sign-in frame (App Store Connect's
	// idmsa.apple.com): the action carries the TAB id, never the frame's URL.
	let owner = "agent";
	const { n, frames, log } = notices("agent");
	frames.set("1:8", { origin: "https://idmsa.apple.com", embedded: true });
	n.observe(39, line(n.nonceFor(39, "1:8"), "get"));
	const at = n.viewFor(39).at;
	const opened = [];
	const deps = {
		notices: n,
		tabId: 39,
		at,
		ownerOf: () => owner,
		openUserTab: async (tabId) => {
			opened.push(tabId);
			return { ok: true, tabId: 40 };
		},
		log: (l) => log.push(l),
	};
	// A stale identity and a tab handed back to the user are refused before the
	// host is asked to open anything.
	assert.equal(
		(await continuePasskeyNoticeInUserTab({ ...deps, at: at + 1 })).ok,
		false,
	);
	owner = "user";
	assert.equal((await continuePasskeyNoticeInUserTab(deps)).ok, false);
	owner = null;
	assert.equal((await continuePasskeyNoticeInUserTab(deps)).ok, false);
	assert.deepEqual(opened, [], "refusals never reached the host");

	owner = "agent";
	// The host's own refusal travels back and leaves the notice in place.
	const refused = await continuePasskeyNoticeInUserTab({
		...deps,
		openUserTab: async () => ({ ok: false, reason: "no page" }),
	});
	assert.deepEqual(refused, { ok: false, reason: "no page" });
	assert.ok(n.viewFor(39), "a refused continue keeps the notice");

	assert.deepEqual(await continuePasskeyNoticeInUserTab(deps), { ok: true });
	assert.deepEqual(opened, [39], "the host was handed the agent tab's id");
	assert.equal(n.viewFor(39), null, "the agent tab's notice is dismissed");
	assert.ok(log.some((l) => l.includes("continued in user tab 40")));
	assert.ok(
		!log.some((l) => l.includes("continued") && l.includes("https://")),
		"the log line names tabs, not URLs",
	);
});

test("continue-in-your-own-tab is refused for a USER tab's notice", async () => {
	const { n, frames } = notices("user");
	frames.set("1:8", { origin: "https://github.com", embedded: false });
	n.observe(8, line(n.nonceFor(8, "1:8"), "get"));
	let asked = false;
	const outcome = await continuePasskeyNoticeInUserTab({
		notices: n,
		tabId: 8,
		at: n.viewFor(8).at,
		ownerOf: () => "user",
		openUserTab: async () => {
			asked = true;
			return { ok: true, tabId: 9 };
		},
		log: () => {},
	});
	assert.equal(outcome.ok, false);
	assert.equal(asked, false);
});

test("continue-in-your-own-tab: a second invoke while the first is loading is refused, so one tab opens (review R1/Q1)", async () => {
	const { n, frames } = notices("agent");
	frames.set("1:8", { origin: "https://idmsa.apple.com", embedded: true });
	n.observe(39, line(n.nonceFor(39, "1:8"), "get"));
	const at = n.viewFor(39).at;
	const opened = [];
	const finishers = [];
	const deps = {
		notices: n,
		tabId: 39,
		at,
		ownerOf: () => "agent",
		// The host awaits the copy's load: hold every load open so both invokes
		// overlap, the double click's timing.
		openUserTab: (tabId) => {
			opened.push(tabId);
			return new Promise((resolve) => {
				finishers.push(() => resolve({ ok: true, tabId: 40 + opened.length }));
			});
		},
		log: () => {},
	};
	const first = continuePasskeyNoticeInUserTab(deps);
	const second = continuePasskeyNoticeInUserTab(deps);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(opened, [39], "exactly one user tab was asked for");
	for (const finish of finishers) finish();
	assert.deepEqual(await second, {
		ok: false,
		reason: "Your own tab is already opening.",
	});
	assert.deepEqual(await first, { ok: true });
	assert.equal(n.viewFor(39), null);
});

test("continue-in-your-own-tab: a refused open releases the claim and keeps the notice for a retry", async () => {
	const { n, frames } = notices("agent");
	frames.set("1:8", { origin: "https://idmsa.apple.com", embedded: true });
	n.observe(39, line(n.nonceFor(39, "1:8"), "get"));
	const at = n.viewFor(39).at;
	let answer = { ok: false, reason: "The browser couldn’t open a new tab." };
	const deps = {
		notices: n,
		tabId: 39,
		at,
		ownerOf: () => "agent",
		openUserTab: async () => answer,
		log: () => {},
	};
	assert.deepEqual(await continuePasskeyNoticeInUserTab(deps), answer);
	assert.ok(n.viewFor(39));
	answer = { ok: true, tabId: 41 };
	assert.deepEqual(await continuePasskeyNoticeInUserTab(deps), { ok: true });
});

test("continue-in-your-own-tab refusals are localized full sentences, not English fragments (review R2/U3)", async () => {
	const { n, frames } = notices("agent");
	frames.set("1:8", { origin: "https://idmsa.apple.com", embedded: true });
	n.observe(39, line(n.nonceFor(39, "1:8"), "get"));
	const at = n.viewFor(39).at;
	const base = {
		notices: n,
		tabId: 39,
		at,
		ownerOf: () => "agent",
		openUserTab: async () => ({ ok: true, tabId: 40 }),
		log: () => {},
	};
	const stale = await continuePasskeyNoticeInUserTab({ ...base, at: at + 1 });
	assert.equal(stale.reason, "That passkey notice is no longer current.");
	const handedBack = await continuePasskeyNoticeInUserTab({
		...base,
		ownerOf: () => "user",
	});
	assert.equal(handedBack.reason, "An agent is no longer driving that tab.");
});
