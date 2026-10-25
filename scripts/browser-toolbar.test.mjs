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
			'export { siteInfoForUrl, isSecurityLoadFailure } from "./src/renderer/src/features/browser/model/site-info";',
			'export { buildPageContextMenuItems, isOpenableLink } from "./src/main/browser/page-context-menu";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const {
	siteInfoForUrl,
	isSecurityLoadFailure,
	buildPageContextMenuItems,
	isOpenableLink,
} = await import(
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

test("site-info U1: a certificate-failed https page does NOT read secure", () => {
	// The discriminating case: scheme says https, the load outcome says the
	// certificate was refused. The register must follow the outcome.
	assert.deepEqual(
		siteInfoForUrl("https://example.com/", {
			url: "https://example.com/",
			description: "ERR_CERT_AUTHORITY_INVALID",
		}),
		{ kind: "unverified", origin: "https://example.com" },
	);
	assert.equal(
		isSecurityLoadFailure({
			url: "https://example.com/",
			description: "ERR_CERT_DATE_INVALID",
		}),
		true,
	);
	assert.equal(
		isSecurityLoadFailure({
			url: "https://example.com/",
			description: "ERR_SSL_PROTOCOL_ERROR",
		}),
		true,
	);
	// Any recorded failure of THIS origin bars "secure", cert or not: a load
	// that never completed verified nothing.
	assert.equal(
		siteInfoForUrl("https://example.com/", {
			url: "https://example.com/",
			description: "ERR_CONNECTION_REFUSED",
		}).kind,
		"unverified",
	);
	assert.equal(
		isSecurityLoadFailure({
			url: "https://example.com/",
			description: "ERR_CONNECTION_REFUSED",
		}),
		false,
	);
});

test("site-info U1: a failure for another origin does not downgrade the page on screen", () => {
	assert.deepEqual(
		siteInfoForUrl("https://good.example/page", {
			url: "https://bad.example/",
			description: "ERR_CERT_AUTHORITY_INVALID",
		}),
		{ kind: "secure", origin: "https://good.example" },
	);
	// Ordinary https with no recorded failure still reads secure, and http
	// with a failure record stays plain not-secure.
	assert.equal(siteInfoForUrl("https://example.com/", null).kind, "secure");
	assert.equal(
		siteInfoForUrl("http://example.com/", {
			url: "http://example.com/",
			description: "ERR_CONNECTION_REFUSED",
		}).kind,
		"not-secure",
	);
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

test("context menu: without a link it is Back, Forward, Reload, then Copy page address", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/current",
		canGoBack: true,
		canGoForward: false,
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["back", true],
			["forward", false],
			["reload", true],
			["separator", false],
			["copy-page", true],
		],
	);
	for (const item of items) {
		if (item.id !== "separator") assert.ok(item.label.length > 0);
	}
	// No page address to copy: nav group alone, no dangling separator.
	assert.deepEqual(
		buildPageContextMenuItems({
			linkUrl: "",
			pageUrl: "",
			canGoBack: false,
			canGoForward: false,
		}).map((item) => item.id),
		["back", "forward", "reload"],
	);
});

test("context menu: over an http(s) link it adds copy and open-in-new-tab", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "https://example.com/page",
		pageUrl: "https://example.com/current",
		canGoBack: false,
		canGoForward: false,
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["back", false],
			["forward", false],
			["reload", true],
			["separator", false],
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
			pageUrl: "https://example.com/current",
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

test("context menu D2/U8: an editable target gets edit history, the edit group, and no navigation", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/form",
		canGoBack: true,
		canGoForward: true,
		isEditable: true,
		editFlags: {
			canUndo: false,
			canRedo: true,
			canCut: true,
			canCopy: true,
			canPaste: false,
		},
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["undo", false],
			["redo", true],
			["separator", false],
			["cut", true],
			["copy", true],
			["paste", false],
			["select-all", true],
		],
		"undo/redo lead, above the clipboard actions, and follow editFlags",
	);
	for (const item of items) {
		if (item.id !== "separator") assert.ok(item.label.length > 0);
	}
	// Unknown availability enables rather than lies disabled. A separator is
	// never an actionable item, so its own `enabled` stays false.
	const unknown = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/form",
		canGoBack: false,
		canGoForward: false,
		isEditable: true,
	});
	assert.deepEqual(
		unknown.map((item) => item.id),
		["undo", "redo", "separator", "cut", "copy", "paste", "select-all"],
	);
	assert.ok(
		unknown
			.filter((item) => item.id !== "separator")
			.every((item) => item.enabled),
	);
});

test("context menu U8: a page selection offers Copy, without losing its navigation group", () => {
	const items = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/page",
		canGoBack: true,
		canGoForward: false,
		isEditable: false,
		selectionText: "selected words",
	});
	assert.deepEqual(
		items.map((item) => [item.id, item.enabled]),
		[
			["back", true],
			["forward", false],
			["reload", true],
			["separator", false],
			["copy", true],
			["separator", false],
			["copy-page", true],
		],
		"Copy is the page's own selection action; navigation and Copy page address stay",
	);
	// An empty selection is not an item, and editFlags cannot smuggle one in:
	// Chromium reports selectionText only when the user actually selected text.
	const none = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/page",
		canGoBack: true,
		canGoForward: false,
		isEditable: false,
		selectionText: "",
		editFlags: { canCopy: true },
	});
	assert.equal(
		none.some((item) => item.id === "copy"),
		false,
	);
});

test("context menu U8: a non-editable page shows no edit items", () => {
	// editFlags describe a field that is not there; they must not leak an
	// Undo/Redo/Cut/Paste item onto a page right-click.
	const items = buildPageContextMenuItems({
		linkUrl: "",
		pageUrl: "https://example.com/page",
		canGoBack: true,
		canGoForward: false,
		isEditable: false,
		editFlags: {
			canUndo: true,
			canRedo: true,
			canCut: true,
			canCopy: true,
			canPaste: true,
			canSelectAll: true,
		},
	});
	const ids = items.map((item) => item.id);
	assert.deepEqual(ids, [
		"back",
		"forward",
		"reload",
		"separator",
		"copy-page",
	]);
	for (const id of ["undo", "redo", "cut", "copy", "paste", "select-all"]) {
		assert.equal(ids.includes(id), false, `${id} needs an editable target`);
	}
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
	// U1/D1/m1-U2: failure reaches the register, warnings step to text-ink,
	// and the mark is keyboard-reachable while staying read-only.
	assert.match(surface, /loadFailure=\{state\?\.navFailure \?\? null\}/);
	assert.match(urlBar, /siteInfoForUrl\(url, loadFailure\)/);
	assert.match(urlBar, /siteInfoWarns \? "text-ink" : "text-ink-muted"/);
	assert.doesNotMatch(
		urlBar,
		/tabIndex=\{0\}/,
		"the site mark is described from the field, not a tab stop (U4)",
	);
	assert.match(urlBar, /const siteDescId = `\$\{listId\}-site`/);
	assert.match(urlBar, /browser_url_bar\.home"\)/);
	// D2/U3/U8: main passes the editable facts and the page address through,
	// and every edit action the rule can emit has a contents method behind it.
	assert.match(main, /isEditable: params\.isEditable/);
	assert.match(main, /selectionText: params\.selectionText/);
	assert.match(main, /editFlags: params\.editFlags/);
	assert.match(main, /pageUrl: contents\.getURL\(\)/);
	assert.match(main, /contents\.undo\(\)/);
	assert.match(main, /contents\.redo\(\)/);
	assert.match(main, /contents\.cut\(\)/);
	assert.match(main, /item\.id === "separator"/);
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
