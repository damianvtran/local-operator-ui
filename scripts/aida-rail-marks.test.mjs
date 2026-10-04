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
			export { aidaMissedMessages, aidaWorking, useCanonicalSessionsStore, useUiPreferencesStore, aidaStatusKey, desktopKeys, SidebarNavigation, ChatLayout, MemoryRouter, QueryClient, QueryClientProvider };
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
const mountRail = async ({ collapsed, row, name, feed = false }) => {
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
	useUiPreferencesStore.setState({ isSidebarCollapsed: collapsed });
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
		features: feed ? { aida: 1, desktop_feed: 1 } : { aida: 1 },
	});
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
const HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
const URL_BAR =
	"src/renderer/src/features/browser/components/browser-url-bar.tsx";
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
		nav.includes(
			'`${aidaName}, ${count} missed message${count === 1 ? "" : "s"}`',
		),
		"the name's sentence is hers, built on the payload's display name, with the plural handled",
	);
	/*
	 * AND THE BROWSER ROW KEEPS ITS OWN, byte for byte: the tag the tour and the
	 * harnesses address, and the `waiting` sentence `browser-chrome.test.mjs`
	 * asserts rendered. A shared field pair cannot come from one literal.
	 */
	assert.match(nav, /attentionTag: "nav-browser-badge",/);
	assert.ok(nav.includes("`Browser, ${count} waiting`"));
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
 * THE RAIL'S COUNTED REGISTER (operator ask, 2026-09-30): the rail badge is the
 * quiet mark — borderless, a subtle `elevated` disc, and the count family's own
 * muted numeral — while the bordered `attention` mark stays where the ring is
 * load-bearing (the chat header's globe, the URL bar). Both halves are pinned,
 * because the failure this test exists for is a later edit that "quietens" one
 * and takes the other with it, or that reaches for the quiet register where the
 * ring is what separates the mark from neighbouring glyphs.
 */
test("the rail draws the quiet register, and the bordered mark is left where the ring is load-bearing", () => {
	const nav = code(NAV);
	assert.match(
		nav,
		/variant="attentionQuiet"/,
		"the rail badge is the quiet register, not the bordered one",
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
	 * THE BORDERED MARK IS INTACT, byte for byte: the header's globe and the URL
	 * bar still wear it, and their ring (`ring-2 ring-canvas`) is what keeps a
	 * 16px mark legible against the glyph it overlaps. A change to that edge is
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
		[HEADER, "the chat header's globe"],
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
	assert.match(nav, /workingName: `\$\{aidaName\}, working`,/);
	assert.ok(
		nav.includes(
			'`${aidaName}, ${count} missed message${count === 1 ? "" : "s"}`',
		),
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
