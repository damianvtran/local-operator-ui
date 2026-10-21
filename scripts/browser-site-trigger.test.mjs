import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The at-rest address trigger's two origin-specific rules (design round 1, D3
 * and D4, plus UX U9):
 *
 *   - the host is elided at the LEADING subdomain labels, because a CSS
 *     `truncate` throws away the registrable domain — the half that says whose
 *     page this is;
 *   - a loopback http origin gets a neutral glyph instead of the open padlock,
 *     while the CLASSIFICATION stays `not-secure` (the transport fact does not
 *     change; only the permanent warning glyph does);
 *   - the icon-only trigger at a narrow pane still names the host in its
 *     accessible name.
 *
 * The helpers are the shipped ones; the wiring half is a source guard because
 * the surface cannot be mounted in this suite.
 */

const bundle = await build({
	stdin: {
		contents:
			'export { compactHost, isLoopbackHost } from "./src/renderer/src/features/browser/model/site-info";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { compactHost, isLoopbackHost } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("compactHost drops leading labels, never the registrable domain", () => {
	assert.equal(
		compactHost("very-long-subdomain.example.com"),
		"example.com",
		"the tail is the part that identifies the site",
	);
	assert.equal(compactHost("a.very-long-subdomain.example.com"), "example.com");
	assert.equal(
		compactHost("127.0.0.1:51953"),
		"127.0.0.1:51953",
		"a host already inside the budget is untouched, port included",
	);
	assert.equal(
		compactHost("averyverylongsubdomain.example.com", 22),
		"example.com",
	);
	assert.equal(compactHost("example.com"), "example.com");
	// Short labels are a real case (punycode TLDs): still under budget, untouched.
	assert.equal(compactHost("xn--d1acufc.xn--p1ai"), "xn--d1acufc.xn--p1ai");
});

test("isLoopbackHost names the local-development addresses and nothing else", () => {
	for (const host of [
		"localhost",
		"LOCALHOST",
		"127.0.0.1",
		"127.1.2.3",
		"[::1]",
		"0.0.0.0",
	])
		assert.equal(isLoopbackHost(host), true, host);
	for (const host of [
		"128.0.0.1",
		"example.com",
		"127.0.0.1.example.com",
		"localhost.example.com",
	])
		assert.equal(isLoopbackHost(host), false, host);
});

test("the trigger uses both helpers and keeps the host in its accessible name", () => {
	const source = readFileSync(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	assert.match(source, /isLoopbackHost\(siteHost\) \?/);
	assert.match(source, /compactHost\(siteHost\)/);
	assert.match(source, /aria-label=\{[\s\S]{0,160}?siteHost/);
});
