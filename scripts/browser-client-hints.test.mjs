import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The browser tab's client hints (`src/main/browser/client-hints.ts`). The
 * defect these pin: the tab claimed `Chrome/156` in its UA string and sent NO
 * `Sec-CH-UA*` on document requests, which no real Chromium browser does, and
 * Google's sign-in refused it as "may not be secure". The GREASE values are
 * pinned against headers real browsers sent, not against this module's own
 * output, because the header must match the runtime's `navigator.userAgentData`
 * byte for byte.
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/browser/client-hints";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["electron"],
	write: false,
});
const hints = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** No brand other than the engine's own may appear in any hint. */
const OTHER_PRODUCT = /Google Chrome|Electron|LocalOperator/;

const MAC = {
	chromeVersion: "156.0.8078.49",
	platform: "darwin",
	arch: "arm64",
	platformVersion: "27.2.0",
};

test("GREASE reproduces the brand lists real browsers sent", () => {
	// Measured 2026-11-07: Electron 45.1.0's own subresource header / JS brands.
	assert.equal(
		hints.brandHeader(hints.greasedBrandList(156, null)),
		'"Not:A-Brand";v="8", "Chromium";v="156"',
	);
	// Measured the same day: Google Chrome 156.0.8078.81 on this machine.
	assert.equal(
		hints.brandHeader(hints.greasedBrandList(156, null, "Google Chrome")),
		'"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
	);
	assert.equal(
		hints.brandHeader(
			hints.greasedBrandList(156, "156.0.8078.81", "Google Chrome"),
		),
		'"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.81", "Google Chrome";v="156.0.8078.81"',
	);
	// Published Chrome 120 and 124 headers: a different GREASE char, version and order.
	assert.equal(
		hints.brandHeader(hints.greasedBrandList(120, null, "Google Chrome")),
		'"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
	);
	assert.equal(
		hints.brandHeader(hints.greasedBrandList(124, null, "Google Chrome")),
		'"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
	);
});

test("the tab presents the engine's own identity, consistently", () => {
	const composed = hints.composeClientHints(MAC);
	assert.deepEqual(composed.lowEntropy, {
		"sec-ch-ua": '"Not:A-Brand";v="8", "Chromium";v="156"',
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": '"macOS"',
	});
	assert.equal(
		composed.highEntropy["sec-ch-ua-full-version-list"],
		'"Not:A-Brand";v="8.0.0.0", "Chromium";v="156.0.8078.49"',
	);
	assert.equal(composed.highEntropy["sec-ch-ua-arch"], '"arm"');
	assert.equal(composed.highEntropy["sec-ch-ua-bitness"], '"64"');
	assert.equal(composed.highEntropy["sec-ch-ua-platform-version"], '"27.2.0"');
	// No other brand is claimed anywhere.
	for (const value of Object.values({
		...composed.lowEntropy,
		...composed.highEntropy,
	})) {
		assert.doesNotMatch(value, OTHER_PRODUCT);
	}
});

test("Windows sends the low-entropy trio and omits only the platform version", () => {
	const win = hints.composeClientHints({
		...MAC,
		platform: "win32",
		arch: "x64",
	});
	assert.deepEqual(win.lowEntropy, {
		"sec-ch-ua": '"Not:A-Brand";v="8", "Chromium";v="156"',
		"sec-ch-ua-mobile": "?0",
		"sec-ch-ua-platform": '"Windows"',
	});
	assert.equal(win.highEntropy["sec-ch-ua-platform-version"], undefined);
	assert.equal(win.highEntropy["sec-ch-ua-arch"], '"x86"');
	assert.equal(win.highEntropy["sec-ch-ua-bitness"], '"64"');
});

test("a request gains only the hints it is missing, and only where Chrome sends them", () => {
	const composed = hints.composeClientHints(MAC);
	const doc = hints.withClientHints(
		"https://accounts.google.com/",
		{ "User-Agent": "ua" },
		composed,
		undefined,
	);
	assert.equal(doc["sec-ch-ua"], '"Not:A-Brand";v="8", "Chromium";v="156"');
	assert.equal(doc["sec-ch-ua-platform"], '"macOS"');
	assert.equal(doc["sec-ch-ua-arch"], undefined, "no opt-in, no high entropy");

	// The renderer's own header (any case) is the runtime's truth and wins.
	const sub = hints.withClientHints(
		"https://accounts.google.com/x",
		{ "Sec-CH-UA": "renderer" },
		composed,
		undefined,
	);
	assert.equal(sub["Sec-CH-UA"], "renderer");
	assert.equal(sub["sec-ch-ua"], undefined);

	const opted = hints.withClientHints(
		"https://accounts.google.com/",
		{},
		composed,
		hints.parseAcceptCh(["Sec-CH-UA-Arch, sec-ch-ua-full-version-list"]),
	);
	assert.equal(opted["sec-ch-ua-arch"], '"arm"');
	assert.ok(opted["sec-ch-ua-full-version-list"]);
	assert.equal(opted["sec-ch-ua-model"], undefined, "not asked for");

	// Chrome withholds hints from non-trustworthy URLs; loopback is trustworthy.
	assert.deepEqual(
		hints.withClientHints("http://example.com/", {}, composed, undefined),
		{},
	);
	for (const url of [
		"http://127.0.0.1:8080/",
		"http://localhost/",
		"http://app.localhost/",
		"wss://example.com/",
	]) {
		assert.ok(
			hints.withClientHints(url, {}, composed, undefined)["sec-ch-ua"],
			url,
		);
	}
});

/** A fake browser session with the two listeners captured. */
function installed() {
	const calls = [];
	const session = {
		webRequest: {
			onBeforeSendHeaders: (fn) => calls.push(["send", fn]),
			onHeadersReceived: (fn) => calls.push(["recv", fn]),
		},
	};
	const lines = [];
	const handle = hints.installClientHints(session, MAC, (l) => lines.push(l));
	const recv = calls.find(([k]) => k === "recv")[1];
	const sendFn = calls.find(([k]) => k === "send")[1];
	const receive = (url, resourceType, accept) =>
		recv(
			{
				url,
				resourceType,
				responseHeaders: accept ? { "Accept-CH": [accept] } : {},
			},
			() => {},
		);
	/** One request; `top` is the top-level document URL its frame reports. */
	const send = (url, resourceType, top, requestHeaders = {}) => {
		let sent;
		sendFn(
			{
				url,
				resourceType,
				requestHeaders,
				frame: top ? { top: { url: top } } : null,
			},
			(r) => {
				sent = r.requestHeaders;
			},
		);
		return sent;
	};
	return { session, calls, lines, handle, receive, send };
}

const HE = "Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch";
const GOOGLE = "https://accounts.google.com/v3/signin";

test("a top-level document opts its own origin in, and the next requests carry it", () => {
	const s = installed();
	s.receive(GOOGLE, "mainFrame", HE);
	const doc = s.send("https://accounts.google.com/next", "mainFrame", null);
	assert.equal(doc["sec-ch-ua-platform-version"], '"27.2.0"');
	assert.equal(doc["sec-ch-ua-arch"], '"arm"');
	assert.equal(doc["sec-ch-ua"], '"Not:A-Brand";v="8", "Chromium";v="156"');
	// Its own subresources, under it as top level, carry it too.
	const sub = s.send("https://accounts.google.com/x.js", "script", GOOGLE);
	assert.equal(sub["sec-ch-ua-arch"], '"arm"');
});

test("Accept-CH over plain http to a remote host is ignored", () => {
	const s = installed();
	s.receive("http://plain.example/", "mainFrame", HE);
	// Same host over https is a different origin and never opted in.
	const doc = s.send("https://plain.example/", "mainFrame", null);
	assert.equal(doc["sec-ch-ua-arch"], undefined);
	assert.ok(doc["sec-ch-ua"], "low entropy still goes to https");
});

test("Accept-CH on a subresource or iframe response opts nothing in", () => {
	const s = installed();
	s.receive("https://tracker.example/p.gif", "image", HE);
	s.receive("https://tracker.example/frame", "subFrame", HE);
	const doc = s.send("https://tracker.example/", "mainFrame", null);
	assert.equal(doc["sec-ch-ua-arch"], undefined);
	assert.equal(doc["sec-ch-ua-platform-version"], undefined);
});

test("an opted-in origin gets low entropy only when it is a third party", () => {
	const s = installed();
	s.receive(GOOGLE, "mainFrame", HE);
	// accounts.google.com embedded or fetched from another top-level site.
	for (const type of ["subFrame", "image", "xhr"]) {
		const third = s.send(
			"https://accounts.google.com/embed",
			type,
			"https://news.example/",
		);
		assert.equal(third["sec-ch-ua-arch"], undefined, type);
		assert.ok(third["sec-ch-ua"], type);
	}
	// And a third party under the opted-in top level gets low entropy only too.
	const pixel = s.send("https://tracker.example/p.gif", "image", GOOGLE);
	assert.equal(pixel["sec-ch-ua-arch"], undefined);
	assert.ok(pixel["sec-ch-ua"]);
	// No frame at all: unknown top level, so low entropy only.
	const orphan = s.send("https://accounts.google.com/y", "xhr", null);
	assert.equal(orphan["sec-ch-ua-arch"], undefined);
});

test("forget drops one origin's opt-in, or all of them", () => {
	const s = installed();
	s.receive(GOOGLE, "mainFrame", HE);
	s.receive("https://github.com/", "mainFrame", HE);
	hints.forgetClientHintOptIns(s.session, "https://accounts.google.com");
	assert.equal(
		s.send("https://accounts.google.com/", "mainFrame", null)["sec-ch-ua-arch"],
		undefined,
	);
	assert.equal(
		s.send("https://github.com/", "mainFrame", null)["sec-ch-ua-arch"],
		'"arm"',
	);
	s.handle.forget();
	assert.equal(
		s.send("https://github.com/", "mainFrame", null)["sec-ch-ua-arch"],
		undefined,
	);
	// Low entropy is not opt-in state and survives a forget.
	assert.ok(s.send("https://github.com/", "mainFrame", null)["sec-ch-ua"]);
});

test("the opt-in map is capped, dropping the oldest origin", () => {
	const s = installed();
	s.receive("https://first.example/", "mainFrame", HE);
	for (let i = 0; i < hints.MAX_OPTED_IN_ORIGINS; i++)
		s.receive(`https://o${i}.example/`, "mainFrame", HE);
	assert.equal(
		s.send("https://first.example/", "mainFrame", null)["sec-ch-ua-arch"],
		undefined,
	);
	assert.equal(
		s.send("https://o0.example/", "mainFrame", null)["sec-ch-ua-arch"],
		'"arm"',
	);
});

test("installClientHints owns both session header listeners and removes them", () => {
	const s = installed();
	// Drift: a runtime whose own brand list differs is reported once.
	s.send("https://a.example/", "image", "https://a.example/", {
		"sec-ch-ua": "other",
	});
	s.send("https://a.example/", "image", "https://a.example/", {
		"sec-ch-ua": "other",
	});
	assert.equal(s.lines.filter((l) => l.includes("drift")).length, 1);

	s.handle.detach();
	assert.deepEqual(
		s.calls.slice(-2).map(([, fn]) => fn),
		[null, null],
	);
	// A detached install is no longer reachable through the session.
	hints.forgetClientHintOptIns(s.session);
});
