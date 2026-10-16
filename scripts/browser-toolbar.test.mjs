import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * LOH-13 slice A: the toolbar/address-bar gaps.
 *
 * WHAT IS UNDER TEST, and why these units: the site-info classification and
 * the page context menu's item rule are the two pieces of new LOGIC in the
 * slice. Both are pure, so they are bundled and driven directly — the same
 * shape as `browser-page-controls.test.mjs`. The renderer's icon/tooltip
 * choice and main's native `Menu.popup` are presentation of this output and
 * are covered by typecheck plus the source pins at the end of this file,
 * which fail if the wiring (Home intent, context-menu handler) is removed
 * while the models stay.
 *
 * The negative cases matter most: an http page must never read "secure", a
 * lookalike scheme must never read as a web origin, and Open-link must never
 * be enabled for a target the host would refuse.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { siteInfoForUrl } from "./src/renderer/src/features/browser/model/site-info";',
			'export { buildPageContextMenuItems, isOpenableLink } from "./src/main/browser/page-context-menu";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { siteInfoForUrl, buildPageContextMenuItems, isOpenableLink } =
	await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

test("site-info: https is secure and names the origin", () => {
	assert.deepEqual(siteInfoForUrl("https://example.com/path?q=1"), {
		kind: "secure",
		origin: "https://example.com",
	});
	assert.deepEqual(siteInfoForUrl("https://example.com:8443/a"), {
		kind: "secure",
		origin: "https://example.com:8443",
	});
});

test("site-info: http is not secure, never secure", () => {
	assert.deepEqual(siteInfoForUrl("http://example.com/"), {
		kind: "not-secure",
		origin: "http://example.com",
	});
});

test("site-info: internal and file origins are neither secure nor a web origin", () => {
	assert.deepEqual(siteInfoForUrl("about:blank"), {
		kind: "internal",
		origin: "",
	});
	assert.deepEqual(siteInfoForUrl(""), { kind: "internal", origin: "" });
	assert.deepEqual(siteInfoForUrl("file:///Users/someone/page.html"), {
		kind: "file",
		origin: "file://",
	});
});

test("site-info: lookalike and unparseable values do not read as web origins", () => {
	// Parsed, never prefix-matched: `httpsfoo:` is not https.
	assert.equal(siteInfoForUrl("httpsfoo://example.com").kind, "internal");
	assert.equal(siteInfoForUrl("not a url").kind, "internal");
	// Userinfo does not move the origin: the host is what is named.
	assert.equal(
		siteInfoForUrl("https://user@example.com@evil.test/").origin,
		"https://evil.test",
	);
});

test("context menu: without a link it is Back, Forward, Reload with history gating", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "",
		canGoBack: true,
		canGoForward: false,
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["back", true],
			["forward", false],
			["reload", true],
		],
	);
	for (const item of items) assert.ok(item.label.length > 0);
});

test("context menu: over an http(s) link it adds copy and open-in-new-tab", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "https://example.com/page",
		canGoBack: false,
		canGoForward: false,
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["back", false],
			["forward", false],
			["reload", true],
			["copy-link", true],
			["open-link", true],
		],
	);
});

test("context menu: copy stays available for a non-openable link, open does not", () => {
	for (const linkUrl of [
		"file:///etc/passwd",
		"javascript:void(0)",
		"not a url",
	]) {
		const items = buildPageContextMenuItems({
			linkUrl,
			canGoBack: false,
			canGoForward: false,
		});
		const byId = new Map(items.map((item) => [item.id, item.enabled]));
		assert.equal(byId.get("copy-link"), true, linkUrl);
		assert.equal(byId.get("open-link"), false, linkUrl);
		assert.equal(isOpenableLink(linkUrl), false, linkUrl);
	}
	assert.equal(isOpenableLink("http://example.com"), true);
});

test("wiring pins: Home intent and the native context-menu handler stay connected", async () => {
	const { readFile } = await import("node:fs/promises");
	const urlBar = await readFile(
		"src/renderer/src/features/browser/components/browser-url-bar.tsx",
		"utf8",
	);
	const surface = await readFile(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	const main = await readFile("src/main/browser/index.ts", "utf8");
	const host = await readFile("src/main/browser/host.ts", "utf8");
	// Home: surface -> chrome hook -> IPC -> host start state.
	assert.match(surface, /onHome=\{\(\) => void chrome\.home\(\)\}/);
	assert.match(urlBar, /data-site-info=\{siteInfo\.kind\}/);
	assert.match(urlBar, /data-tour-tag="browser-home"/);
	// The start state is the one allowed about: URL, in exactly one place.
	assert.match(host, /loadURL\("about:blank"\)/);
	assert.match(host, /async goHomeActive/);
	assert.match(host, /async openLinkInNewTab/);
	// The page menu is main's native menu, built from the pure rule.
	assert.match(main, /contents\.on\("context-menu"/);
	assert.match(main, /buildPageContextMenuItems/);
	assert.match(main, /Menu\.buildFromTemplate/);
	// No agent route was added: the loopback RPC surface is untouched by
	// this slice, and open-link is a user tab (no nonce is minted here).
	assert.doesNotMatch(
		host.slice(
			host.indexOf("async openLinkInNewTab"),
			host.indexOf("async openLinkInNewTab") + 900,
		),
		/nonce/,
	);
});
