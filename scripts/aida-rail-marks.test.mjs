#!/usr/bin/env node
/**
 * Aida's rail-row marks: the missed-messages badge and the working mark - the
 * rules behind each, and the row that draws them.
 *
 * WHAT ONE RECEIPT COUNTS, and why the number is 0 or 1. The count is the
 * attention/receipts system's unacknowledged completion receipts for HER
 * conversation - the same durable state the sidebar's own unread mark draws
 * from - and that system exposes ONE current completion plus `unseen`, a LEVEL,
 * per conversation (`local_operator/session/attention.py`'s `_state_many_once`
 * reports the conversation's NEWEST completion; the older rows above the
 * watermark are stored but not served as a count), so the largest number this
 * client can derive per session is 1: the receipt a `/seen` can name and clear.
 * The selector narrows a second time to the app's own ackable set
 * (`unreadAckableRows`: a drawn mark AND a completion token) so the rail cannot
 * show a number viewing her conversation cannot take off it.
 *
 * THE WORKING MARK is the row's other reading, and it is ONE code:
 * `status.code === "busy"`, a turn in flight - the user's or a proactive wake's.
 * That is the code the chat sidebar draws its spinning `LoaderCircle` for, and
 * nothing else is "working": a parked gate (`approval` / `answer`) owns the
 * alert ring, `delegating` the share glyph. It is a store subscription like the
 * count, so it is true for her CLOSED conversation - which is when a wake runs -
 * and the two marks cannot coexist: a busy row draws no unread mark, so the
 * slot shows one fact at a time.
 *
 * HOW THIS FILE DRIVES IT. The selector is bundled and EXECUTED - the count
 * under test is the shipped count, not a restatement. The ROW is driven through
 * a REAL client mount (JSDOM; the recipe `agent-hub-queries.test.mjs` carries),
 * with the capabilities answer, her route answer and her catalogue row written
 * into a real `QueryClient` and the real store, so the badge, its number and the
 * control's accessible name are read off the markup a screen gets. A static
 * render could not serve here and the failure is instructive: zustand v5 hands
 * React `getInitialState` as the server snapshot, so a `renderToStaticMarkup`
 * of the rail reads the store as it was CREATED - measured, the same selector
 * answered 1 against `getState()` and 0 inside a static render. The wiring is
 * pinned as source text, the idiom `aida-sidebar.test.mjs` and
 * `browser-chrome.test.mjs` use.
 *
 * WHAT THIS FILE DOES NOT PROVE: that the badge appears LIVE when the feed
 * publishes her completion (the driver frames' subject), or that a real `/seen`
 * from a real view clears it (QA's subject, on an interactive machine). It pins
 * the rules those runs lean on.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Node has no `localStorage`, and the stores this file writes (sessions,
 * UI preferences) are persisted: zustand's persist middleware writes through
 * storage on every `setState`. The three methods the browser provides are enough
 * for the store's real interface - the same shim `browser-chrome.test.mjs` and
 * `composer-tabs.test.mjs` carry, for the same reason.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => void memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};

/*
 * ONE IN-MEMORY BUILD, so the executed selector and the rendered row are the
 * shipped pair. `SidebarNavigation` is bundled through its real module graph -
 * the same graph `browser-chrome.test.mjs` already proves builds for a node
 * render - and the preview/components the cases need ride along.
 */
const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { MemoryRouter } from "react-router-dom";
			import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			import { SidebarNavigation } from "./src/renderer/src/shared/components/navigation/sidebar-navigation";
			import { ChatLayout } from "./src/renderer/src/shared/components/common/chat-layout";
			import { aidaMissedMessages } from "./src/renderer/src/features/aida/use-aida-missed-messages";
			import { aidaWorking } from "./src/renderer/src/features/aida/use-aida-working";
			import { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";
			import { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
			import { aidaStatusKey } from "./src/renderer/src/features/aida/use-aida-target";
			import { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			import { sidebarLayoutKeys } from "./src/renderer/src/shared/api/local-operator/sidebar-layout";
			import { DEFAULT_SIDEBAR_LAYOUT } from "./src/renderer/src/shared/components/navigation/sidebar-destinations";
			export { aidaMissedMessages, aidaWorking, useCanonicalSessionsStore, useUiPreferencesStore, aidaStatusKey, desktopKeys, sidebarLayoutKeys, DEFAULT_SIDEBAR_LAYOUT, SidebarNavigation, ChatLayout, MemoryRouter, QueryClient, QueryClientProvider };
			export const el = createElement;
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	/*
	 * The renderer's path aliases by hand (esbuild cannot read tsconfig paths -
	 * `browser-chrome.test.mjs` and `composer-tabs.test.mjs` record the same),
	 * React kept external so the bundle shares ONE copy with the server
	 * renderer, `import.meta.env` defined because the app's config loader reads
	 * it at import time, and `.css`/`.png` loaded empty because a stylesheet and
	 * the rail's logo carry no assertion here - the full recipe
	 * `browser-chrome.test.mjs` states.
	 */
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	mainFields: ["module", "main"],
	conditions: ["import"],
	/*
	 * REACT STAYS EXTERNAL, and that is the mount's one hard requirement: the
	 * component is rendered by THIS process's `react-dom`, and a bundled second
	 * copy of React would give it a different hook dispatcher - an invalid hook
	 * call. Everything else is bundled, because node's ESM resolver cannot load
	 * what the graph reaches through bare specifiers (measured: an external
	 * `@mui/material/styles` - a directory import - dies with
	 * `ERR_UNSUPPORTED_DIR_IMPORT` before a test runs), and nothing else needs to
	 * be shared: the test drives react-query and react-router-dom through THIS
	 * bundle's exports, so the rail and the harness hold the same instances
	 * either way.
	 */
	external: ["react", "react/jsx-runtime", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	loader: { ".css": "empty", ".png": "empty" },
	jsx: "automatic",
});
/*
 * Written to a real file rather than imported as a data: URL: the bundle
 * imports React by bare specifier (external), and a data: URL has no base path
 * for module resolution. Removed again as soon as it is imported.
 */
const bundlePath = new URL("./_aida-badge.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	aidaMissedMessages,
	aidaWorking,
	useCanonicalSessionsStore,
	useUiPreferencesStore,
	aidaStatusKey,
	desktopKeys,
	sidebarLayoutKeys,
	DEFAULT_SIDEBAR_LAYOUT,
	SidebarNavigation,
	ChatLayout,
	MemoryRouter,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
await unlink(bundlePath);

/* --------------------------------------------------------------- the selector */

const AIDA_ID = "f37a9d713040";
const TOKEN = "5d6a1e2f-3b4c-4d5e-8f90-a1b2c3d4e5f6";

/** Her catalogue row as the store holds it, in the one state under test. */
const herRow = (attention) => ({
	session_id: AIDA_ID,
	title: "Aida",
	name: "Aida",
	preview: "",
	mtime: 1790603304.9248078,
	updated_at: 1790603304.9248078,
	pinned: true,
	archived: false,
	active: false,
	live_state: "",
	pending: null,
	binding: { agent: "aida", team: null },
	opened_by: null,
	status: { code: "complete", label: "Unseen completion" },
	attention,
});

const unseen = (over = {}) => ({
	conversation_id: `session/${AIDA_ID}`,
	completion_token: TOKEN,
	anchor_id: "629f859db46345348aadbe1cd2edb21a",
	kind: "complete",
	unseen: true,
	revision: [1, 0],
	...over,
});

/**
 * Her row mid-turn: the one state that draws the busy mark AND no unread mark
 * (the app's precedence keeps them exclusive, which is what lets the rail's
 * trailing slot show one fact at a time).
 */
const busy = (over = {}) => {
	const row = herRow(unseen(over));
	row.status = { code: "busy", label: "Working" };
	return row;
};

test("an unread completion receipt for HER session counts as one missed message", () => {
	assert.equal(aidaMissedMessages([herRow(unseen())], AIDA_ID), 1);
});

test("the count is per session: another conversation's unread receipt is not hers", () => {
	const other = { ...herRow(unseen()), session_id: "2d5ad5da0025" };
	assert.equal(aidaMissedMessages([other], AIDA_ID), 0);
	assert.equal(aidaMissedMessages([herRow(unseen()), other], AIDA_ID), 1);
});

test("a receipt that is not unread counts nothing", () => {
	assert.equal(
		aidaMissedMessages([herRow(unseen({ unseen: false }))], AIDA_ID),
		0,
	);
});

test("a row whose live state has taken it over draws no mark, so it counts nothing", () => {
	/*
	 * The store's ONE predicate, not a second one: `unreadMarkKind` reads the
	 * status code, so a session that finished a turn and then started another
	 * draws a spinner rather than the check, and a number on the rail for it
	 * would claim a mark the sidebar is not drawing anywhere.
	 */
	const busy = herRow(unseen());
	busy.status = { code: "busy", label: "Working" };
	assert.equal(aidaMissedMessages([busy], AIDA_ID), 0);
});

test("a mark no gesture can clear is not counted", () => {
	/*
	 * The ackable half of the predicate: an acknowledgement names a token, so a
	 * drawn mark with no token cannot be cleared by viewing her conversation -
	 * and a count that a view cannot take off the rail is a promise nothing can
	 * keep (the same rule the bulk control's own label states).
	 */
	assert.equal(
		aidaMissedMessages([herRow(unseen({ completion_token: null }))], AIDA_ID),
		0,
	);
});

test("error and interrupted receipts draw marks and count, like the sidebar says", () => {
	/*
	 * The receipts vocabulary is `complete` / `error` / `interrupted`, and the
	 * app's unread predicate draws a mark for all three (the sidebar glyph, the
	 * name's `, unread` tail and the bulk count all read `unreadMarkKind`).
	 * Narrowing this count to `complete` alone would fork that predicate; the
	 * badge follows the app's own reading, and one view clears them together.
	 */
	for (const kind of ["error", "interrupted"]) {
		const row = herRow(unseen({ kind }));
		row.status = { code: kind, label: kind };
		assert.equal(aidaMissedMessages([row], AIDA_ID), 1, kind);
	}
});

test("no row, and no session id, both count zero rather than throwing", () => {
	assert.equal(aidaMissedMessages([], AIDA_ID), 0);
	assert.equal(aidaMissedMessages([herRow(unseen())], null), 0);
	assert.equal(aidaMissedMessages([herRow(unseen())], undefined), 0);
});

/* ------------------------------------------------------------ the working mark */

test("a busy row is working; resting, gated and delegating codes are not", () => {
	assert.equal(aidaWorking([busy()], AIDA_ID), true);
	/*
	 * The app's ONE code, pinned: `approval` and `answer` are parked gates (the
	 * sidebar draws the alert ring, not the spinner), `delegating` owns the share
	 * glyph, `wedged` its own waves, and the completion codes are at rest - none
	 * of them says "she is on it", and folding any in would claim activity about
	 * a row that is in fact waiting on the user.
	 */
	for (const code of [
		"complete",
		"error",
		"interrupted",
		"approval",
		"answer",
		"delegating",
		"wedged",
		"scheduled",
	]) {
		const row = herRow(unseen());
		row.status = { code, label: code };
		assert.equal(aidaWorking([row], AIDA_ID), false, code);
	}
});

test("the working mark is per session, and answerless inputs count false", () => {
	const other = { ...busy(), session_id: "2d5ad5da0025" };
	assert.equal(aidaWorking([other], AIDA_ID), false);
	assert.equal(aidaWorking([busy(), other], AIDA_ID), true);
	assert.equal(aidaWorking([], AIDA_ID), false);
	assert.equal(aidaWorking([busy()], null), false);
	assert.equal(aidaWorking([busy()], undefined), false);
});

/* ------------------------------------------------------------------- the row */

/*
 * The rows are driven through a REAL client mount, and the store is why: see the
 * header - zustand v5's server snapshot is `getInitialState`, so the static
 * render this harness used first read the store as CREATED and answered 0 for a
 * count the same module answered 1 for, however the fixtures were written.
 *
 * JSDOM is the repo's own rig for mounts; the recipe below mirrors
 * `agent-hub-queries.test.mjs`: the `IS_REACT_ACT_ENVIRONMENT` flag (without it
 * React only warns and waits for `act` to absentmindedly flush effects - a mount
 * test that passes locally and hangs in CI), one React shared with the mounted
 * bundle through `packages: "external"`, and `client.clear()` plus
 * `dom.window.close()` on teardown because a react-query client left holding its
 * `gcTime` timer keeps the node test runner alive for ten minutes. Each case
 * gets a FRESH window, and the store is written through the bundle's own module
 * instance - the one the rail renders from.
 */
/*
 * `layout` (optional) is a stored sidebar layout, answered as a successful read
 * of a backend advertising `sidebar_layout` v1 - the only way the rail honours a
 * layout rather than its shipped default - and `moreOpen` the persisted state of
 * the More group. The More cases fold Aida into More with them, because her
 * count is the one this harness can raise through a real data path.
 */
const mountRail = async ({
	collapsed,
	row,
	name,
	feed = false,
	layout,
	moreOpen = false,
}) => {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		pretendToBeVisual: true,
		/*
		 * The rail reads the route from the HASH (`path-utils.ts` handles both
		 * formats), which is why the url carries one - the stub window this
		 * harness used for its static render had to answer for the same fact.
		 */
		url: "http://localhost/#/chat",
	});
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		act: globalThis.IS_REACT_ACT_ENVIRONMENT,
	};
	globalThis.window = dom.window;
	globalThis.document = dom.window.document;
	/*
	 * `defineProperty`, not assignment: node's own `navigator` global is an
	 * accessor with no setter, so `globalThis.navigator = ...` throws in strict
	 * mode - the mount needs the DOM's navigator (the rail asks for the platform
	 * to pick its shortcut glyphs).
	 */
	Object.defineProperty(globalThis, "navigator", {
		value: dom.window.navigator,
		configurable: true,
	});
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	/*
	 * The two DOM APIs jsdom does not ship and this mounted tree reaches: MUI's
	 * `useMediaQuery` (the rail's own conversation rows still carry an MUI-era
	 * component) and `ResizeObserver`, read by a layout effect. Stubbed at the
	 * boundary and left empty - nothing here asserts a measured rect - because
	 * the alternative is a crash inside React's effect commit.
	 */
	dom.window.matchMedia = (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	});
	const previousResizeObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	/*
	 * The DOM's constructors and frame callbacks reachable as BARE globals - jsdom
	 * puts them on the window only, and the mounted tree's instance checks read
	 * them unqualified (measured: `holdFocusedRow` asks for `HTMLElement`). The
	 * frame callbacks come from the window so schedule and cancel stay one pair.
	 */
	const bridged = [
		["HTMLElement", dom.window.HTMLElement],
		["Element", dom.window.Element],
		["Node", dom.window.Node],
		["MutationObserver", dom.window.MutationObserver],
		[
			"requestAnimationFrame",
			dom.window.requestAnimationFrame?.bind(dom.window),
		],
		["cancelAnimationFrame", dom.window.cancelAnimationFrame?.bind(dom.window)],
	];
	const previousBridged = bridged.map(([name]) => [name, globalThis[name]]);
	for (const [name, value] of bridged) {
		Object.defineProperty(globalThis, name, {
			value,
			configurable: true,
			writable: true,
		});
	}
	/*
	 * The frame is decided by the viewport (`docked at >= 1024`), and jsdom's
	 * default width - 1024 - sits exactly on the boundary; 1380 is the app's own
	 * default window and the width this repo's frames are captured at.
	 */
	Object.defineProperty(dom.window, "innerWidth", {
		value: 1380,
		configurable: true,
	});

	useCanonicalSessionsStore.setState({ sessions: [row] });
	useUiPreferencesStore.setState({
		isSidebarCollapsed: collapsed,
		sidebarOverflowExpanded: moreOpen,
	});
	/*
	 * The desktop feed bridge, when the case asks for it: the strip's keeper
	 * mounts `useDesktopFeed`, whose subscription is what merges frames into
	 * the store. The counter is the assertion surface - nothing here delivers
	 * frames, because what the keeper must prove is that the SUBSCRIPTION
	 * exists at all in the width whose list is not drawn.
	 */
	let feedSubscribes = 0;
	if (feed) {
		dom.window.api = {
			desktop: {
				feed: {
					subscribe: () => {
						feedSubscribes += 1;
						return () => {
							feedSubscribes -= 1;
						};
					},
					watchState: () => () => {},
				},
			},
		};
	}
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: {
			aida: 1,
			...(feed ? { desktop_feed: 1 } : {}),
			...(layout ? { sidebar_layout: 1 } : {}),
		},
	});
	if (layout) client.setQueryData(sidebarLayoutKeys.layout, layout);
	client.setQueryData(aidaStatusKey, {
		enabled: true,
		session_id: AIDA_ID,
		paused: false,
		greeted: false,
		...(name === undefined ? {} : { name }),
	});

	/*
	 * react-dom/client feature-detects the DOM at import time, so it is imported
	 * here - after the document exists - rather than at module scope.
	 */
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.window.document.getElementById("root"));
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(
					MemoryRouter,
					null,
					React.createElement(ChatLayout, {
						sidebar: React.createElement(SidebarNavigation),
						content: null,
					}),
				),
			),
		);
	});
	// A second flush so the queries the rail starts (their refusals settle as
	// errors with `retry: false`) land inside `act` rather than after it.
	await act(async () => {});
	return {
		markup: dom.window.document.body.innerHTML,
		feedSubscribes: () => feedSubscribes,
		teardown: async () => {
			await act(async () => root.unmount());
			client.clear();
			dom.window.close();
			globalThis.window = previous.window;
			globalThis.document = previous.document;
			Object.defineProperty(globalThis, "navigator", {
				value: previous.navigator,
				configurable: true,
			});
			globalThis.ResizeObserver = previousResizeObserver;
			for (const [name, value] of previousBridged) {
				if (value === undefined) {
					Reflect.deleteProperty(globalThis, name);
				} else {
					Object.defineProperty(globalThis, name, {
						value,
						configurable: true,
						writable: true,
					});
				}
			}
			globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
		},
	};
};

/** The Aida row's own markup, so a mark elsewhere in the rail cannot answer. */
const aidaRow = (markup) =>
	markup.slice(
		markup.indexOf('data-tour-tag="nav-item-aida"'),
		markup.indexOf('data-tour-tag="nav-item-agents"'),
	);

test("expanded: an unread receipt draws HER badge, the number is on it, and the name states it", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: false,
		row: herRow(unseen()),
	});
	try {
		assert.ok(
			markup.includes('data-tour-tag="nav-aida-badge"'),
			"the row draws its own badge (its own tag, not the browser row's)",
		);
		const at = markup.indexOf('data-tour-tag="nav-aida-badge"');
		assert.match(
			markup.slice(at, at + 240),
			/data-tour-tag="nav-aida-badge"[^>]*>\s*1\s*</,
			"and the count is the number on it",
		);
		assert.ok(
			markup.includes('aria-label="Aida, 1 missed message"'),
			"the name carries the number, singular",
		);
	} finally {
		await teardown();
	}
});

test("expanded and clear: NO badge at all, and no count words anywhere", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: false,
		row: herRow(unseen({ unseen: false })),
	});
	try {
		assert.ok(
			!markup.includes("nav-aida-badge"),
			"zero draws nothing (the honest rendering of an item with no badge)",
		);
		assert.ok(
			!markup.includes("missed message"),
			"and no sentence claims a count that is not drawn",
		);
		assert.ok(
			markup.includes('data-tour-tag="nav-item-aida"'),
			"the row itself is unchanged",
		);
		assert.ok(
			!aidaRow(markup).includes("lucide-loader-circle"),
			"and no working mark: the row is at rest",
		);
	} finally {
		await teardown();
	}
});

test("collapsed: the badge is drawn in the strip too, and the name still carries the number", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: true,
		row: herRow(unseen()),
	});
	try {
		assert.ok(
			markup.includes('data-tour-tag="nav-aida-badge"'),
			"the strip draws it (the browser badge's collapsed behaviour, mirrored)",
		);
		assert.ok(
			markup.includes('aria-label="Aida, 1 missed message"'),
			"and the collapsed control is named with the count, because there is no visible label to carry it",
		);
	} finally {
		await teardown();
	}
});

/*
 * WHERE THE COUNT SITS, per width (#1083). JSDOM lays nothing out, so the
 * placement is read from the structure that decides it: collapsed, the mark is
 * an ABSOLUTE child of a `relative` anchor that holds the glyph, so the glyph is
 * the button's only in-flow content and `justify-center` centres it in the
 * strip; expanded, the mark stays in flow at the row's trailing edge. The live
 * geometry (glyph centred on x=28 in the 56px strip, the mark on its corner) is
 * the `approval-badges` driver scene's reading, not this file's.
 */
const classesOf = (element) =>
	(element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

const badgePlacement = (markup) => {
	const doc = new JSDOM(markup).window.document;
	const button = doc.querySelector('[data-tour-tag="nav-item-aida"]');
	const badge = button?.querySelector('[data-tour-tag="nav-aida-badge"]');
	const slot = badge?.parentElement ?? null;
	return { button, slot, anchor: slot?.parentElement ?? null };
};

test("collapsed: the count is a corner mark on the icon, not a pill beside it (#1083)", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: true,
		row: herRow(unseen()),
	});
	try {
		const { button, slot, anchor } = badgePlacement(markup);
		assert.ok(slot, "the strip draws her badge");
		assert.ok(
			classesOf(slot).includes("absolute"),
			`the mark is pinned out of flow, not laid out beside the glyph (slot classes: ${classesOf(slot).join(" ")})`,
		);
		assert.notEqual(
			anchor,
			button,
			"the mark is not a flex sibling of the icon in the button's own row",
		);
		assert.ok(
			classesOf(anchor).includes("relative") && anchor?.querySelector("svg"),
			"its anchor is the glyph's own `relative` box",
		);
		assert.equal(
			button.children.length,
			1,
			"the glyph's anchor is the button's only in-flow child, so the strip centres the icon",
		);
	} finally {
		await teardown();
	}
});

test("expanded: the count keeps an in-flow trailing slot, after the menu lane (the #1083 fix is the strip's alone)", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: false,
		row: herRow(unseen()),
	});
	try {
		const doc = new JSDOM(markup).window.document;
		const row = doc.querySelector('[data-sidebar-row="aida"]');
		const button = row?.querySelector('[data-tour-tag="nav-item-aida"]');
		const badge = row?.querySelector('[data-tour-tag="nav-aida-badge"]');
		const slot = badge?.parentElement ?? null;
		assert.ok(
			row !== null && button !== null && slot !== null,
			"the expanded row draws its count",
		);
		/*
		 * DESIGN ROUND 1, D1 moved the mark OUT of the main button and behind the
		 * ellipsis lane: inside the button it sat 26px in from the row's edge, in a
		 * second trailing column from More's chevron. The intent of the #1083 pin
		 * is unchanged - the expanded count is an in-flow mark at the row's
		 * trailing edge - so it is read at its new address.
		 */
		assert.equal(
			slot.closest("button"),
			null,
			"the mark sits outside the main button",
		);
		assert.notEqual(
			button.compareDocumentPosition(slot) & 4,
			0,
			"and after it in the row's flow",
		);
		assert.equal(
			row.lastElementChild,
			slot,
			"and it is the row's LAST child - after the ellipsis lane, which this harness cannot draw because it mounts without the layout capability",
		);
		assert.ok(
			classesOf(slot).includes("pe-2"),
			"at the same 8px inset the More chevron takes",
		);
		assert.ok(
			!classesOf(slot).includes("ml-auto") &&
				!classesOf(slot).includes("mr-auto"),
			"and not to a physical side, which would strand the count on the wrong edge in RTL",
		);
		assert.ok(!classesOf(slot).includes("absolute"), "and in flow");
	} finally {
		await teardown();
	}
});

test("collapsed and clear: the strip row keeps its plain name", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: true,
		row: herRow(unseen({ unseen: false })),
	});
	try {
		assert.ok(!markup.includes("nav-aida-badge"));
		assert.ok(
			markup.includes('aria-label="Aida"'),
			"the collapsed row still states what it is",
		);
		assert.ok(
			!aidaRow(markup).includes("lucide-loader-circle"),
			"and no working mark: the row is at rest",
		);
	} finally {
		await teardown();
	}
});

test("expanded, working: the busy mark is drawn, the name states it, and no badge sits beside it", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: false,
		row: busy(),
	});
	try {
		const row = aidaRow(markup);
		assert.match(
			row,
			/lucide-loader-circle/,
			"the sidebar's own working glyph, at rail scale",
		);
		assert.ok(
			row.includes("motion-safe:animate-spin"),
			"moving only where motion is allowed; under reduced motion the same glyph stands still",
		);
		assert.ok(
			row.includes('aria-label="Aida, working"'),
			"the name states the state",
		);
		assert.ok(
			!row.includes("nav-aida-badge"),
			"and no count badge: a busy row draws no unread mark, so the slot shows one fact at a time",
		);
	} finally {
		await teardown();
	}
});

test("the strip keeps the desktop feed alive (her marks are store-sourced)", async () => {
	const { feedSubscribes, teardown } = await mountRail({
		collapsed: true,
		row: herRow(unseen()),
		feed: true,
	});
	try {
		assert.equal(
			feedSubscribes(),
			1,
			"the strip mounts the feed subscription itself - without it the collapsed rail has no consumer for the frames that paint her marks",
		);
	} finally {
		await teardown();
	}
});

test("a configured display name is what the row shows, and the marks' sentences use it", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: false,
		row: herRow(unseen()),
		name: "Jarvis",
	});
	try {
		const row = aidaRow(markup);
		assert.ok(
			row.includes(">Jarvis<"),
			"the visible label is the configured name, not a hard-coded one",
		);
		assert.ok(
			row.includes('aria-label="Jarvis, 1 missed message"'),
			"and the count's sentence wears it too",
		);
	} finally {
		await teardown();
	}
});

test("collapsed, working: the strip carries the mark too", async () => {
	const { markup, teardown } = await mountRail({
		collapsed: true,
		row: busy(),
	});
	try {
		const row = aidaRow(markup);
		assert.match(row, /lucide-loader-circle/);
		assert.ok(
			row.includes('aria-label="Aida, working"'),
			"there is no visible label in the strip, so the name is the only place the state can be stated",
		);
	} finally {
		await teardown();
	}
});

/* ------------------------------------------------------------------- the wiring */

const source = (path) => readFileSync(path, "utf8");
/** The file with comment lines removed, for pins that match code. */
const code = (path) =>
	source(path)
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim();
			return !(
				trimmed.startsWith("//") ||
				trimmed.startsWith("*") ||
				trimmed.startsWith("/*")
			);
		})
		.join("\n");

const NAV =
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx";
/**
 * The bordered mark's own other hosts, named here so the claim the test below makes
 * about them is FALSIFIABLE rather than prose (review round 1, F4): the comment said
 * they "still wear" the bordered mark while nothing read them. Each is asserted by
 * matching the `variant="attention"` pass in the file that renders it.
 */
const PANEL_RAIL =
	"src/renderer/src/shared/components/navigation/panel-rail.tsx";
const URL_BAR =
	"src/renderer/src/features/browser/components/browser-surface.tsx";
const APPROVALS_DOCK =
	"src/renderer/src/features/browser/components/browser-approvals-dock.tsx";
const BADGE = "src/renderer/src/shared/components/ui/badge.tsx";
const MISSED = "src/renderer/src/features/aida/use-aida-missed-messages.ts";
const WORKING = "src/renderer/src/features/aida/use-aida-working.ts";

test("the row reads the count through the selector, on HER resolved session id", () => {
	const nav = code(NAV);
	assert.match(
		nav,
		/const aidaMissed = useAidaMissedMessages\(aida\.data\?\.session_id\);/,
		"the count is a store subscription keyed on the id her route answered with",
	);
});

test("the row's own fields carry the count, its handle and its words", () => {
	const nav = code(NAV);
	assert.match(nav, /attention: aidaMissed,/);
	assert.match(nav, /attentionTag: "nav-aida-badge",/);
	assert.ok(
		nav.includes('t("ui.shell.sidebar_navigation.aida_missed",'),
		"the name's sentence is hers, built on the payload's display name, with the plural handled",
	);
	/*
	 * AND THE BROWSER ROW KEEPS ITS OWN, byte for byte: the tag the tour and the
	 * harnesses address, and the `waiting` sentence `browser-chrome.test.mjs`
	 * asserts rendered. A shared field pair cannot come from one literal.
	 */
	assert.match(nav, /attentionTag: "nav-browser-badge",/);
	assert.ok(nav.includes('t("ui.shell.sidebar_navigation.browser_waiting",'));
});

test("the primitive takes the ROW's tag, and the name reads the ROW's words", () => {
	const nav = code(NAV);
	assert.match(
		nav,
		/data-tour-tag=\{item\.attentionTag\}/,
		"one badge primitive, addressed per row",
	);
	/*
	 * THE SUBJECT MOVED, SO THE MATCHER MOVED WITH IT (PR #825, review round 2 F1).
	 * The row's sentence is now derived in `rowName(item)` - ONE derivation serving
	 * both the expanded name and the collapsed tooltip, which is what UX round 1's
	 * U3 asked for - so the guard's local reads `count`, not `attention`. Rather than
	 * pin the local's spelling again, the assertion anchors on the row's own callback
	 * being BOTH the guard and the source, which is what it was always testing.
	 */
	assert.match(
		nav,
		/> 0 && item\.attentionName\s*\? item\.attentionName\(/,
		"the name's sentence comes from the row's own callback, never a hardcoded noun",
	);
});

/*
 * THE RAIL'S COUNTED REGISTER. It was the quiet mark (operator ask,
 * 2026-09-30), then Notifications alone went loud (decisions D5, 2026-10-25);
 * on 2026-10-28 the operator reversed D5 and EVERY rail attention count became
 * the shared accent `AttentionBadge` (`emphasis`: accent fill, on-accent digit,
 * no border). `sidebar-attention-badge.test.mjs` pins the wiring and renders the
 * component; this test keeps the primitive halves - the quiet variant still
 * exists for non-count marks (Team Bridge's preview chip, the team avatar
 * bubble) and the bordered `attention` mark stays where the ring is
 * load-bearing (the chat header's globe, the URL bar). Both halves are pinned,
 * because the failure this test exists for is a later edit that changes one
 * register and takes another with it.
 */
test("the rail draws the shared accent badge, and the bordered mark is left where the ring is load-bearing", () => {
	const nav = code(NAV);
	assert.match(
		nav,
		/<AttentionBadge\b/,
		"the rail badge is the shared accent badge, not a per-row register",
	);
	assert.doesNotMatch(
		nav,
		/variant="attentionQuiet"/,
		"no rail count falls back to the quiet register",
	);
	const badge = code(BADGE);
	const quiet = badge.match(/attentionQuiet:\s*"([^"]+)"/)?.[1] ?? "";
	assert.ok(quiet.length > 0, "the quiet variant exists on the primitive");
	assert.match(quiet, /border-0/, "borderless: the ring is gone");
	assert.match(quiet, /bg-elevated/, "a subtle ground step, not a wash");
	assert.match(quiet, /text-ink-dim/, "the muted numeral the count lines wear");
	assert.match(quiet, /text-meta-sm/, "and the smaller numeral");
	assert.match(quiet, /font-normal/, "at the quieter weight");
	/*
	 * THE BORDERED MARK IS INTACT, byte for byte: the panel rail's browser item
	 * (the header's globe until #872) and the URL bar still wear it, and their ring
	 * (`ring-2 ring-surface` on the rail, `ring-canvas` on the URL bar) is what
	 * keeps a 16px mark legible against the glyph it overlaps. A change to that edge is
	 * a different change, and this is where it would show up.
	 */
	assert.match(
		badge,
		/attention:\s*"border-ink-muted bg-warning-wash text-ink"/,
		"the attention variant still carries its edge and its wash",
	);
	/*
	 * ...AND SO DO ITS HOSTS. The variant existing is not the same claim as the
	 * hosts still asking for it: an edit that moved one of these three to
	 * `attentionQuiet` would leave the primitive pin green and the screen wrong.
	 */
	for (const [path, what] of [
		[PANEL_RAIL, "the panel rail's browser item"],
		[URL_BAR, "the browser route's URL bar"],
		[APPROVALS_DOCK, "the browser approvals dock"],
	]) {
		assert.match(
			code(path),
			/variant="attention"/,
			`${what} still passes the bordered mark`,
		);
	}
});

test("zero draws no mark of either kind, and the name states one only when it is drawn", () => {
	const nav = code(NAV);
	assert.match(nav, /\{attention > 0 && \(/, "zero draws no badge");
	assert.match(nav, /\{item\.working && \(/, "and zero draws no working mark");
	assert.match(
		nav,
		/aria-label=\{\s*expanded && markLabel === item\.label \? undefined : markLabel,?\s*\}/,
		"the accessible name states whichever mark is drawn, in BOTH widths, and only when one is",
	);
});

test("the selector narrows to the app's own ackable predicate, not a second derivation", () => {
	const missed = code(MISSED);
	assert.match(
		missed,
		/unreadAckableRows\(\s*sessions\.filter\(\(row\) => row\.session_id === sessionId\)\)/,
		"the count reads the store's one predicate over HER row",
	);
	assert.ok(
		missed.includes("useCanonicalSessionsStore"),
		"and the hook is what keeps it live (the feed raises it; the read receipt clears it)",
	);
});

test("the working state comes through its own selector, on the same resolved id", () => {
	const nav = code(NAV);
	assert.match(
		nav,
		/const aidaWorking = useAidaWorking\(aida\.data\?\.session_id\);/,
		"the mark is a store subscription, keyed on the id her route answered",
	);
});

test("the working mark wears the sidebar row's own glyph and ink", () => {
	const nav = code(NAV);
	assert.match(nav, /working: aidaWorking,/);
	assert.match(nav, /<StripFeedKeeper \/>/);
	assert.match(nav, /if \(!expanded\) \{[\s\S]{0,900}?<StripFeedKeeper \/>/);
	assert.match(
		nav,
		/const StripFeedKeeper: FC = \(\) => \{\s*const feed = useDesktopFeed\(\);/,
	);
	/*
	 * And the keeper's own wiring, each pin one of the list's behaviours it
	 * mirrors (review round 1, F1/F2): the pageability publish, the page-sized
	 * read, the capability gate, and the invalidation trigger.
	 */
	assert.match(nav, /setCataloguePageable\(pageable\)/);
	assert.match(nav, /pageable \? CATALOGUE_HEAD_PAGE : LEGACY_CATALOGUE_PAGE/);
	assert.match(nav, /if \(!ready\) return;/);
	assert.match(nav, /\[ready, refreshCatalogue, feed\.catalogueRevision\]/);
	assert.match(nav, /const aidaName = aida\.data\?\.name \?\? "Aida";/);
	assert.match(nav, /label: aidaName,/);
	assert.match(
		nav,
		/workingName: t\("ui\.shell\.sidebar_navigation\.aida_working",\s*\{\s*name: aidaName,?\s*\}\),/,
	);
	assert.ok(
		nav.includes('t("ui.shell.sidebar_navigation.aida_missed",'),
		"both sentences are hers, built from the payload's name with the shipped fallback",
	);
	assert.match(
		nav,
		/<LoaderCircle/,
		"the same glyph the sidebar's row draws for the code",
	);
	assert.ok(
		nav.includes('"text-accent motion-safe:animate-spin"'),
		"and the busy ink and motion byte for byte, so reduced motion keeps the static glyph",
	);
});

test("the working selector reads the one busy code, not a second working rule", () => {
	const working = code(WORKING);
	assert.match(working, /row\.status\?\.code === "busy"/);
	assert.ok(
		working.includes("useCanonicalSessionsStore"),
		"live by subscription, the same shape the count owns",
	);
});

/* ------------------------------------------- More's aggregate, open vs closed */

/*
 * MORE'S SUM IS DRAWN ONLY WHILE THE GROUP IS CLOSED (design follow-up to #1465,
 * D2). Aida is folded into More through a stored layout, so her one missed
 * message is the hidden count: closed, More carries it; open, her own row does
 * and More draws nothing - the same attention is never drawn twice. The
 * control's NAME keeps the count in both states, because it describes what the
 * group holds, not what is painted on it. Checked at both widths: the expanded
 * row and the collapsed strip are separate render branches.
 */
const aidaInMore = () => ({
	visible: DEFAULT_SIDEBAR_LAYOUT.visible.filter((id) => id !== "aida"),
	more: ["aida", ...DEFAULT_SIDEBAR_LAYOUT.more],
});

const moreControl = (markup) =>
	new JSDOM(markup).window.document.querySelector("[data-sidebar-more]");

for (const collapsed of [false, true]) {
	const width = collapsed ? "collapsed" : "expanded";

	test(`${width}, More closed: More carries the hidden count, and Aida's row is not drawn`, async () => {
		const { markup, teardown } = await mountRail({
			collapsed,
			row: herRow(unseen()),
			layout: aidaInMore(),
			moreOpen: false,
		});
		try {
			const more = moreControl(markup);
			assert.ok(more, "the More control is drawn");
			assert.equal(more.getAttribute("aria-expanded"), "false");
			const badge = more.querySelector('[data-tour-tag="nav-more-badge"]');
			assert.ok(badge, "More draws the summed badge while closed");
			assert.equal(badge.textContent, "1");
			assert.ok(
				!markup.includes('data-tour-tag="nav-aida-badge"'),
				"her row is folded away, so its own badge is not drawn",
			);
		} finally {
			await teardown();
		}
	});

	test(`${width}, More open: the hidden row carries the count and More draws none, but keeps it in its name`, async () => {
		const closed = await mountRail({
			collapsed,
			row: herRow(unseen()),
			layout: aidaInMore(),
			moreOpen: false,
		});
		const closedName = moreControl(closed.markup)?.getAttribute("aria-label");
		await closed.teardown();

		const { markup, teardown } = await mountRail({
			collapsed,
			row: herRow(unseen()),
			layout: aidaInMore(),
			moreOpen: true,
		});
		try {
			const more = moreControl(markup);
			assert.ok(more, "the More control is drawn");
			assert.equal(more.getAttribute("aria-expanded"), "true");
			assert.equal(
				more.querySelector("[data-attention-badge]"),
				null,
				"More draws no badge while open",
			);
			assert.ok(
				markup.includes('data-tour-tag="nav-aida-badge"'),
				"the revealed row draws its own badge",
			);
			assert.match(
				closedName ?? "",
				/1/,
				`the closed control's name states the count (${closedName})`,
			);
			assert.equal(
				more.getAttribute("aria-label"),
				closedName,
				"and the open control's name is the same sentence",
			);
		} finally {
			await teardown();
		}
	});
}

/*
 * ZERO DRAWS NO NODE AT THE CALL SITE (design follow-up to #1465, D3). The
 * component's own zero rule is pinned in `sidebar-attention-badge.test.mjs`;
 * this pins the CALL SITES, so a future `count ?? 0` or a wrapper that always
 * renders cannot bring back a column of empty or `0` marks. Both widths, More
 * closed (the state in which More would carry a sum), nothing waiting anywhere.
 */
for (const collapsed of [false, true]) {
	test(`${collapsed ? "collapsed" : "expanded"}, nothing waiting: no badge node anywhere in the rail, More included`, async () => {
		const { markup, teardown } = await mountRail({
			collapsed,
			row: herRow(unseen({ unseen: false })),
			layout: aidaInMore(),
			moreOpen: false,
		});
		try {
			const doc = new JSDOM(markup).window.document;
			assert.ok(doc.querySelector("[data-sidebar-more]"), "More is drawn");
			assert.equal(
				doc.querySelectorAll("[data-attention-badge]").length,
				0,
				"no attention badge node at all",
			);
			assert.equal(doc.querySelector('[data-tour-tag="nav-more-badge"]'), null);
		} finally {
			await teardown();
		}
	});
}
