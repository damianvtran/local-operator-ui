import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * LOH-13 operator report (2026-10-25): the tab actions menu is a NATIVE Electron
 * menu, so the page is never hidden behind a "paused" note.
 *
 * WHAT IS UNDER TEST, and why these three units:
 *  - the shared wire contract (`browser-tab-actions-menu.ts`): unknown or
 *    malformed items are refused BEFORE they reach `Menu.buildFromTemplate`, and
 *    the answer main sends back can only be a verb the strip implements;
 *  - the Electron template builder (`tab-actions-menu.ts`): order, labels and
 *    enabled flags survive the mapping, and a disabled item carries no handler;
 *  - the item RULE (`tab-actions-menu-model.ts`): which items exist for one tab,
 *    in which order, with the counted labels the destructive presses disclose.
 *
 * THE ITEM RULE LIVES IN A MODEL NOW rather than in the panel's JSX: a native
 * menu has no DOM, so a test cannot query it. The source pins at the end cover
 * what a model cannot: the strip no longer mounts a Radix dropdown for the tab
 * menu and registers no overlay suppression for it.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/shared/browser-tab-actions-menu";',
			'export { buildTabActionsMenuTemplate } from "./src/main/browser/tab-actions-menu";',
			'export { buildTabActionsMenuItems } from "./src/renderer/src/features/browser/model/tab-actions-menu-model";',
		].join("\n"),
		resolveDir: process.cwd(),
		sourcefile: "tab-actions-menu-test.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	write: false,
});
const {
	buildTabActionsMenuItems,
	buildTabActionsMenuTemplate,
	tabActionsMenuRequestOrThrow,
	tabActionsMenuSelectionOrNull,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const separator = { id: "separator", label: "", enabled: false };
const item = (id, label, enabled = true) => ({ id, label, enabled });

function request(overrides = {}) {
	return {
		tabId: 2,
		anchor: { x: 40, y: 60 },
		items: [
			item("watch", 'Watch "Tab 2"'),
			separator,
			item("close", 'Close "Tab 2"'),
		],
		...overrides,
	};
}

test("template: order, labels, enabled flags and separators survive the mapping", () => {
	const calls = [];
	const template = buildTabActionsMenuTemplate(
		[
			item("header", 'Actions for "Tab 2"', false),
			item("watch", 'Watch "Tab 2"'),
			separator,
			item("close", 'Close "Tab 2"'),
			item("close-others", "Close 2 other tabs", false),
		],
		(id) => calls.push(id),
	);
	assert.equal(template.length, 5);
	assert.deepEqual(
		template.map((entry) => entry.type ?? "normal"),
		["normal", "normal", "separator", "normal", "normal"],
	);
	assert.deepEqual(
		template.map((entry) => entry.label ?? null),
		[
			'Actions for "Tab 2"',
			'Watch "Tab 2"',
			null,
			'Close "Tab 2"',
			"Close 2 other tabs",
		],
	);
	assert.deepEqual(
		template.map((entry) => entry.enabled ?? true),
		[false, true, true, true, false],
	);
});

test("template: a press reaches the handler with the item id it named", () => {
	const calls = [];
	const template = buildTabActionsMenuTemplate(
		[item("duplicate", "Duplicate tab"), item("close", 'Close "Tab 2"')],
		(id) => calls.push(id),
	);
	template[0].click();
	template[1].click();
	assert.deepEqual(calls, ["duplicate", "close"]);
	// A disabled item is drawn disabled AND has no handler: Electron invokes a
	// click on some platforms even for a disabled native item.
	const disabled = buildTabActionsMenuTemplate(
		[item("close-others", "Close 2 other tabs", false)],
		(id) => calls.push(id),
	);
	assert.equal(disabled[0].enabled, false);
	assert.equal(disabled[0].click, undefined);
});

test("request: a well-formed list round-trips, separators may repeat", () => {
	const input = request({
		items: [
			item("watch", 'Watch "Tab 2"'),
			separator,
			item("close", 'Close "Tab 2"'),
			separator,
			item("copy-url", "Copy URL"),
		],
	});
	assert.deepEqual(tabActionsMenuRequestOrThrow(input), input);
});

test("request: an UNKNOWN item id rejects the whole request", () => {
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({
					items: [item("watch", "Watch"), item("rm-rf", "Do a thing")],
				}),
			),
		/Unknown menu item id: rm-rf/,
	);
});

test("request: duplicate ids, malformed labels and flags are refused", () => {
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({
					items: [item("watch", "Watch"), item("watch", "Watch again")],
				}),
			),
		/Duplicate menu item id: watch/,
	);
	assert.throws(
		() => tabActionsMenuRequestOrThrow(request({ items: [item("watch", "")] })),
		/needs a non-empty label/,
	);
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({ items: [item("watch", "Watch", "yes")] }),
			),
		/needs an enabled flag/,
	);
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({ items: [item("watch", "x".repeat(301))] }),
			),
		/at most 300 characters/,
	);
	// The two non-actions are labels, never controls.
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({ items: [item("header", 'Actions for "Tab 2"')] }),
			),
		/is a label, not a control/,
	);
	assert.throws(
		() =>
			tabActionsMenuRequestOrThrow(
				request({ items: [{ id: "separator", label: "nope", enabled: true }] }),
			),
		/is a label, not a control/,
	);
});

test("request: tab id, anchor and list bounds are validated", () => {
	for (const tabId of [0, -3, 1.5, "2", null]) {
		assert.throws(
			() => tabActionsMenuRequestOrThrow(request({ tabId })),
			/positive tab id/,
		);
	}
	for (const anchor of [
		{ x: Number.NaN, y: 0 },
		{ x: 0, y: Number.POSITIVE_INFINITY },
		{ x: 200_000, y: 0 },
		{ x: 0 },
		null,
	]) {
		assert.throws(() => tabActionsMenuRequestOrThrow(request({ anchor })));
	}
	assert.throws(() => tabActionsMenuRequestOrThrow(request({ items: [] })));
	assert.throws(() =>
		tabActionsMenuRequestOrThrow(
			request({
				items: Array.from({ length: 41 }, () => separator),
			}),
		),
	);
	assert.throws(() => tabActionsMenuRequestOrThrow(null));
});

test("selection: only a selectable, known item id comes back", () => {
	assert.equal(tabActionsMenuSelectionOrNull("close"), "close");
	assert.equal(tabActionsMenuSelectionOrNull("close-others"), "close-others");
	for (const value of [
		null,
		undefined,
		"header",
		"separator",
		"rm-rf",
		42,
		{ id: "close" },
	])
		assert.equal(tabActionsMenuSelectionOrNull(value), null);
});

/* The renderer item rule. One tab fixture per test keeps each expectation about
 * the item it names rather than about a fixture's accumulated state. */
function tab(overrides = {}) {
	return {
		tabId: 2,
		title: "Tab 2",
		url: "https://example.test/2",
		owner: "user",
		sessionId: null,
		active: false,
		restored: false,
		handedOver: false,
		failed: false,
		loading: false,
		...overrides,
	};
}

function facts(overrides = {}) {
	return {
		tab: tab(),
		label: "Tab 2",
		canMoveLeft: true,
		canMoveRight: true,
		canReorder: true,
		canTabAction: true,
		closeOthers: null,
		closeRight: null,
		closeFailed: null,
		conversationCount: 0,
		...overrides,
	};
}

const ids = (items) => items.map((entry) => entry.id);
const byId = (items, id) => items.find((entry) => entry.id === id);

test("items: the panel's order and copy, as data", () => {
	const items = buildTabActionsMenuItems(
		facts({
			tab: tab({ audible: true }),
			label: "\u2068Tab 2\u2069",
			closeOthers: 2,
			closeRight: 1,
			conversationCount: 2,
		}),
	);
	assert.deepEqual(ids(items), [
		"header",
		"watch",
		"hand-over",
		"move-left",
		"move-right",
		"mute",
		"duplicate",
		"reload",
		"separator",
		"close",
		"close-others",
		"close-right",
		"separator",
		"copy-url",
	]);
	assert.equal(byId(items, "header").label, 'Actions for "\u2068Tab 2\u2069"');
	assert.equal(byId(items, "watch").label, 'Watch "\u2068Tab 2\u2069"');
	assert.equal(
		byId(items, "hand-over").label,
		'Let an agent use "\u2068Tab 2\u2069"',
	);
	assert.equal(byId(items, "close").label, 'Close "\u2068Tab 2\u2069"');
	assert.equal(byId(items, "close-others").label, "Close 2 other tabs");
	assert.equal(byId(items, "close-right").label, "Close 1 tab to the right");
	assert.equal(byId(items, "move-left").label, "Move tab left");
	assert.equal(byId(items, "duplicate").label, "Duplicate tab");
	assert.equal(byId(items, "reload").label, "Reload tab");
	assert.equal(byId(items, "copy-url").label, "Copy URL");
	assert.equal(byId(items, "header").enabled, false);
});

test("items: the active tab is not offered Watch, and a hand-over reverses", () => {
	const active = buildTabActionsMenuItems(
		facts({ tab: tab({ active: true }) }),
	);
	assert.ok(!ids(active).includes("watch"));
	const handed = buildTabActionsMenuItems(
		facts({ tab: tab({ owner: "agent", handedOver: true }) }),
	);
	assert.ok(!ids(handed).includes("hand-over"));
	assert.equal(
		byId(handed, "revoke-hand-over").label,
		'Stop letting the agent use "Tab 2"',
	);
});

test("items: move availability follows the RENDERED neighbours", () => {
	const first = buildTabActionsMenuItems(
		facts({ canMoveLeft: false, canMoveRight: true }),
	);
	assert.equal(byId(first, "move-left").enabled, false);
	assert.equal(byId(first, "move-right").enabled, true);
	const last = buildTabActionsMenuItems(
		facts({ canMoveLeft: true, canMoveRight: false }),
	);
	assert.equal(byId(last, "move-left").enabled, true);
	assert.equal(byId(last, "move-right").enabled, false);
});

test("items: mute and unmute are one item, named by the tab's state", () => {
	const audible = buildTabActionsMenuItems(
		facts({ tab: tab({ audible: true }) }),
	);
	assert.equal(byId(audible, "mute").label, "Mute tab");
	const muted = buildTabActionsMenuItems(facts({ tab: tab({ muted: true }) }));
	assert.ok(!ids(muted).includes("mute"));
	assert.equal(byId(muted, "unmute").label, "Unmute tab");
	const silent = buildTabActionsMenuItems(facts());
	assert.ok(!ids(silent).includes("mute") && !ids(silent).includes("unmute"));
});

test("items: optional hands remove their items rather than offering dead controls", () => {
	const bare = buildTabActionsMenuItems(
		facts({ canReorder: false, canTabAction: false }),
	);
	assert.ok(!ids(bare).includes("move-left"));
	assert.ok(!ids(bare).includes("move-right"));
	assert.ok(!ids(bare).includes("duplicate"));
	assert.ok(!ids(bare).includes("reload"));
});

test("items: a count is offered only when the press would close something", () => {
	const items = buildTabActionsMenuItems(facts());
	assert.ok(!ids(items).includes("close-others"));
	assert.ok(!ids(items).includes("close-right"));
	assert.ok(!ids(items).includes("close-failed"));
	assert.ok(!ids(items).includes("close-conversation"));
	const oneConversationTab = buildTabActionsMenuItems(
		facts({ tab: tab({ sessionId: "conv-a" }), conversationCount: 1 }),
	);
	assert.ok(!ids(oneConversationTab).includes("close-conversation"));
	const two = buildTabActionsMenuItems(
		facts({
			tab: tab({ sessionId: "conv-a" }),
			conversationCount: 2,
			closeFailed: 1,
		}),
	);
	assert.equal(
		byId(two, "close-conversation").label,
		"Close all 2 tabs in this conversation",
	);
	assert.equal(byId(two, "close-failed").label, "Close 1 failed tab");
});

test("items: Copy URL is only offered for an http(s) page", () => {
	for (const url of [
		"about:blank",
		"file:///tmp/a.html",
		"data:text/html,x",
		"",
	]) {
		const items = buildTabActionsMenuItems(facts({ tab: tab({ url }) }));
		assert.ok(!ids(items).includes("copy-url"), url);
	}
	// The trailing rule is the panel's (D7's grouping), present even when the
	// item it introduces is absent; AppKit may collapse a trailing separator.
	const items = buildTabActionsMenuItems(
		facts({ tab: tab({ url: "about:blank" }) }),
	);
	assert.equal(items.at(-1).id, "separator");
});

/*
 * SOURCE PINS. The native menu's property is an ABSENCE in the renderer: no
 * Radix panel, and no suppression registration. A model test cannot see either,
 * so these read the shipped source. They are deliberately narrow - the exact
 * imports/registrations the change removed - rather than a general ban on
 * dropdowns, which other chrome still uses.
 */
test("pin: the strip mounts no Radix dropdown and registers no pause for the tab menu", async () => {
	const strip = await readFile(
		"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
		"utf8",
	);
	assert.ok(
		!strip.includes("@shared/components/ui/dropdown-menu"),
		"the tab strip must not import the Radix dropdown menu",
	);
	assert.ok(
		!strip.includes("useSuppressBrowserView"),
		"the tab strip must not register a browser-view suppression",
	);
	assert.ok(
		!strip.includes('data-tour-tag="browser-tab-actions"'),
		"the tab actions panel must not exist in the DOM",
	);
	assert.ok(
		strip.includes('aria-haspopup="menu"'),
		"the trigger must advertise the native menu it opens",
	);
	assert.ok(
		strip.includes("onShowTabActionsMenu"),
		"the trigger must go through the native-menu prop",
	);
});

test("pin: the surface hands the strip the native-menu bridge, and IPC owns the popup", async () => {
	const surface = await readFile(
		"src/renderer/src/features/browser/components/browser-surface.tsx",
		"utf8",
	);
	assert.ok(
		surface.includes("onShowTabActionsMenu={chrome.showTabActionsMenu}"),
	);
	const ipc = await readFile("src/main/browser/ipc.ts", "utf8");
	assert.ok(ipc.includes('ipcMain.handle("browser-tab-actions-menu"'));
	assert.ok(ipc.includes("menu.popup({"));
	assert.ok(ipc.includes("buildTabActionsMenuTemplate"));
});
