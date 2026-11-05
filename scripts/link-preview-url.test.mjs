/**
 * URL normalisation and the SSRF guard, asserted against the shipped source.
 *
 * WHAT IS REAL HERE. The half of the security story that can be proven without a
 * socket:
 *
 *  1. NORMALISATION - two spellings of one page share one cache key, and two
 *     different pages never do. A cache that conflated them would serve one page's
 *     card under another page's link.
 *  2. THE ADDRESS GUARD - every private/loopback/link-local/CGNAT/ULA/metadata
 *     address is refused, and a refused URL never reaches the transport. The
 *     resolver and the hop are stubs that record whether they were called, so "no
 *     connection was attempted" is an assertion rather than a claim.
 *
 * WHAT IS NOT HERE. The real socket (`http-transport.ts`) needs a network and is
 * exercised by driving the app.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleMainModules } from "./link-preview-bundle.mjs";

const url = await import(
	await bundleMainModules("link-preview-url", [
		"src/main/link-preview/url.ts",
		"src/main/link-preview/ssrf.ts",
	])
);

/** The URL module's own result shape, asserted as a successful normalisation. */
function keyOf(raw) {
	const result = url.normaliseLinkUrl(raw);
	assert.equal(result.ok, true, raw);
	return result.key;
}

function refusalOf(raw) {
	const result = url.normaliseLinkUrl(raw);
	assert.equal(result.ok, false, raw);
	return result.reason;
}

test("tracking parameters, fragments and parameter order do not split the key", () => {
	const a = keyOf(
		"https://Example.COM/a/b?utm_source=x&b=2&a=1&fbclid=abc#frag",
	);
	const b = keyOf("https://example.com/a/b?a=1&b=2");
	assert.equal(a, b);
	assert.equal(a, "https://example.com/a/b?a=1&b=2");
	assert.ok(!a.includes("#"));
	assert.ok(!a.includes("utm_"));
	assert.ok(!a.includes("fbclid"));
});

test("a default port is dropped, a different default or explicit port is kept", () => {
	assert.equal(keyOf("https://example.com:443/x"), "https://example.com/x");
	assert.equal(keyOf("http://example.com:80/x"), "http://example.com/x");
	assert.equal(
		keyOf("https://example.com:8443/x"),
		"https://example.com:8443/x",
	);
});

test("distinct URLs stay distinct", () => {
	const raws = [
		"https://example.com/a",
		"https://example.com/A",
		"https://example.com/a?x=1",
		"https://example.com/a?x=2",
		"https://sub.example.com/a",
		"http://example.com/a",
		"https://example.com/b",
	];
	const keys = raws.map(keyOf);
	assert.equal(new Set(keys).size, raws.length);
});

test("a query value that contains an encoded separator does not collide", () => {
	// `URLSearchParams` hands back DECODED values, so joining them with `&` and `=`
	// made `?a=x%26b%3D1` (one parameter whose value is `x&b=1`) indistinguishable
	// from `?a=x&b=1` (two parameters). The second URL would then be served the
	// first one's card - a card pointing at a URL the reader never pasted.
	const encoded = keyOf("https://example.com/?a=x%26b%3D1");
	const plain = keyOf("https://example.com/?a=x&b=1");
	assert.notEqual(encoded, plain);
	assert.equal(encoded, "https://example.com/?a=x%26b%3D1");
	assert.equal(plain, "https://example.com/?a=x&b=1");

	// A value that merely looks like another parameter stays one parameter, and the
	// key survives a round trip through the normaliser.
	const once = keyOf("https://example.com/?q=a%3Db%26c%3Dd");
	assert.equal(once, "https://example.com/?q=a%3Db%26c%3Dd");
	assert.equal(keyOf(once), once);
});

test("non-http schemes and unusable input are unsupported-scheme", () => {
	for (const raw of [
		"",
		"not a url",
		"file:///etc/passwd",
		"data:text/html,<h1>x</h1>",
		"javascript:alert(1)",
		"ftp://example.com/x",
	]) {
		assert.equal(refusalOf(raw), "unsupported-scheme", raw);
	}
});

test("credentials in the URL are blocked-host", () => {
	for (const raw of [
		"http://user:pass@example.com/",
		"https://user@example.com/",
	]) {
		assert.equal(refusalOf(raw), "blocked-host", raw);
	}
});

/** Every address the guard must refuse, with the reason it must name. */
const SSRF_TABLE = [
	["http://127.0.0.1/", "127.0.0.1"],
	["http://localhost/", "127.0.0.1"],
	["http://[::1]/", "::1"],
	["http://10.0.0.5/", "10.0.0.5"],
	["http://172.16.4.4/", "172.16.4.4"],
	["http://192.168.1.1/", "192.168.1.1"],
	["http://169.254.169.254/latest/meta-data/", "169.254.169.254"],
	["http://100.64.0.1/", "100.64.0.1"],
	["http://[fd00::1]/", "fd00::1"],
	["http://0.0.0.0/", "0.0.0.0"],
	["http://[fe80::1]/", "fe80::1"],
	["http://[::ffff:127.0.0.1]/", "::ffff:127.0.0.1"],
	["http://224.0.0.1/", "224.0.0.1"],
	["http://198.18.0.9/", "198.18.0.9"],
];

test("the SSRF table: every private address is refused, and no hop is attempted", async () => {
	const { createLinkPreviewService } = await import(
		await bundleMainModules("link-preview-ssrf-service", [
			"src/main/link-preview/resolve.ts",
			"src/main/link-preview/cache.ts",
		])
	);
	const { createLinkPreviewCache } = await import(
		await bundleMainModules("link-preview-ssrf-cache", [
			"src/main/link-preview/cache.ts",
		])
	);
	for (const [raw, address] of SSRF_TABLE) {
		const hopped = [];
		const looked = [];
		const service = createLinkPreviewService({
			cache: createLinkPreviewCache({
				directory: await mkdtemp(join(tmpdir(), "link-preview-ssrf-")),
			}),
			// The resolver answers the address under test - the point is that the
			// GUARD refuses it, not that DNS cannot find it.
			lookup: async (hostname) => {
				looked.push(hostname);
				return [{ address, family: address.includes(":") ? 6 : 4 }];
			},
			hop: async () => {
				hopped.push(raw);
				return {
					status: 200,
					location: null,
					contentType: "text/html",
					body: new TextEncoder().encode("<!doctype html><title>x</title>"),
					truncated: false,
				};
			},
		});
		const result = await service.resolve({ url: raw, index: 0 });
		assert.equal(result.kind, "absent", raw);
		assert.equal(result.reason, "local-or-private", raw);
		assert.deepEqual(hopped, [], `no connection attempted for ${raw}`);
		assert.equal(
			looked.length,
			1,
			`the resolver was consulted once for ${raw}`,
		);
	}
});

test("a scheme or credential refusal never reaches the resolver either", async () => {
	const { createLinkPreviewService } = await import(
		await bundleMainModules("link-preview-refusal-service", [
			"src/main/link-preview/resolve.ts",
			"src/main/link-preview/cache.ts",
		])
	);
	const { createLinkPreviewCache } = await import(
		await bundleMainModules("link-preview-refusal-cache", [
			"src/main/link-preview/cache.ts",
		])
	);
	for (const [raw, reason] of [
		["file:///etc/passwd", "unsupported-scheme"],
		["data:text/html,<h1>x</h1>", "unsupported-scheme"],
		["javascript:alert(1)", "unsupported-scheme"],
		["http://user:pass@example.com/", "blocked-host"],
	]) {
		const calls = [];
		const service = createLinkPreviewService({
			cache: createLinkPreviewCache({
				directory: await mkdtemp(join(tmpdir(), "link-preview-refusal-")),
			}),
			lookup: async (hostname) => {
				calls.push(`lookup:${hostname}`);
				return [{ address: "93.184.216.34", family: 4 }];
			},
			hop: async () => {
				calls.push("hop");
				return {
					status: 200,
					location: null,
					contentType: "text/html",
					body: new Uint8Array(),
					truncated: false,
				};
			},
		});
		const result = await service.resolve({ url: raw, index: 0 });
		assert.equal(result.kind, "absent", raw);
		assert.equal(result.reason, reason, raw);
		assert.deepEqual(calls, [], `nothing was dialled or resolved for ${raw}`);
	}
});
