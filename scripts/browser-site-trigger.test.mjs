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
	/*
	 * THE PORTED SPELLINGS (design round 2, D11). The trigger used to pass
	 * `new URL(origin).host` here, which includes `:5173`; the helper matches
	 * whole labels, so every dev server — the exact case the neutral glyph was
	 * added for — kept the warning padlock. The helper's contract is a HOST: the
	 * surface now feeds `hostname`, and this asserts both halves of that fact,
	 * including that the old spelling really was false (so the case cannot pass
	 * by accident if someone reverts it).
	 */
	for (const url of [
		"http://127.0.0.1:53505/",
		"http://localhost:5173/",
		"http://[::1]:3000/",
	]) {
		assert.equal(isLoopbackHost(new URL(url).hostname), true, url);
		assert.equal(
			isLoopbackHost(new URL(url).host),
			false,
			`${url} host-with-port must not be the classification input`,
		);
	}
	for (const host of [
		"128.0.0.1",
		"example.com",
		"127.0.0.1.example.com",
		"localhost.example.com",
	])
		assert.equal(isLoopbackHost(host), false, host);
	for (const host of ["128.0.0.1:8080", "example.com:443"])
		assert.equal(isLoopbackHost(host), false, host);
});

test("the trigger classifies the hostname, and keeps the ported host in its name", () => {
	const source = readFileSync(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	// The glyph test must see the port-less spelling (D11); the visible label and
	// the accessible name keep the port the user typed.
	assert.match(source, /new URL\(triggerSiteInfo\.origin\)\.hostname/);
	assert.match(source, /isLoopbackHost\(siteHostName\) \?/);
	assert.match(source, /compactHost\(siteHost\)/);
	assert.match(source, /aria-label=\{[\s\S]{0,160}?siteHost/);
});
