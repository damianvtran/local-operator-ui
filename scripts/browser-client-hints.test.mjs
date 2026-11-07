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

test("Windows keeps the runtime's behaviour: no truthful platformVersion", () => {
	assert.equal(
		hints.composeClientHints({ ...MAC, platform: "win32", arch: "x64" }),
		null,
	);
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

test("installClientHints owns both session header listeners and removes them", () => {
	const calls = [];
	const session = {
		webRequest: {
			onBeforeSendHeaders: (fn) => calls.push(["send", fn]),
			onHeadersReceived: (fn) => calls.push(["recv", fn]),
		},
	};
	const lines = [];
	const detach = hints.installClientHints(session, MAC, (l) => lines.push(l));
	const recv = calls.find(([k]) => k === "recv")[1];
	const send = calls.find(([k]) => k === "send")[1];

	recv(
		{
			url: "https://accounts.google.com/v3/signin",
			responseHeaders: { "accept-ch": ["Sec-CH-UA-Platform-Version"] },
		},
		() => {},
	);
	let sent;
	send({ url: "https://accounts.google.com/next", requestHeaders: {} }, (r) => {
		sent = r.requestHeaders;
	});
	assert.equal(sent["sec-ch-ua-platform-version"], '"27.2.0"');
	assert.equal(sent["sec-ch-ua"], '"Not:A-Brand";v="8", "Chromium";v="156"');

	// Drift: a runtime whose own brand list differs is reported once.
	send(
		{ url: "https://a.example/", requestHeaders: { "sec-ch-ua": "other" } },
		() => {},
	);
	send(
		{ url: "https://a.example/", requestHeaders: { "sec-ch-ua": "other" } },
		() => {},
	);
	assert.equal(lines.filter((l) => l.includes("drift")).length, 1);

	detach();
	assert.deepEqual(
		calls.slice(-2).map(([, fn]) => fn),
		[null, null],
	);
});
