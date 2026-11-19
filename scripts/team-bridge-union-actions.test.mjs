import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

/*
 * THE UNION VIEW'S ROW ACTIONS, CLICKED (review round 1, m1).
 *
 * `renderToStaticMarkup` cannot click, so the guarantee the operator cares about
 * most - "every action takes its organization from the ROW" - had no test that
 * exercised it. This suite mounts the real `TeamBridgePageView` in jsdom and
 * dispatches the same clicks a reader does, with spies on all three callbacks,
 * so two facts are asserted rather than read off the code:
 *
 *   1. a person/chief row switches the scope to ITS organization BEFORE it
 *      selects the target (the ORDER is asserted, not just presence - a switch
 *      that ran after the selection would compose against the previous tenant);
 *   2. that implicit switch never persists a preference; only the switcher's
 *      explicit pick calls `onChooseOrganization`.
 *
 * The harness is the sibling `team-bridge-directory.test.mjs` one: the rail's
 * `rowCurrent` import is stubbed (it drags the chat sidebar and MUI into a node
 * bundle), React stays external so this file and the bundle share ONE instance,
 * the bundle is written to a real module file so bare imports resolve the way
 * the app's bundler resolves them, and jsdom gets the observers Radix expects.
 */
const ROOT = process.cwd();

const chatSidebarSource = readFileSync(
	`${ROOT}/src/renderer/src/features/chat/components/chat-sidebar.tsx`,
	"utf8",
);
const rowCurrentLiteral = chatSidebarSource.match(
	/export const rowCurrent =\s*("[^"]+")/,
)?.[1];
if (!rowCurrentLiteral)
	throw new Error("rowCurrent literal not found in chat-sidebar.tsx");
/* Top-level, so the patterns are built once (biome: useTopLevelRegex). */
const CHAT_SIDEBAR_IMPORT = /chat\/components\/chat-sidebar$/;
const ANY_MODULE = /.*/;

const chatSidebarStub = {
	name: "chat-sidebar-stub",
	setup(pluginBuild) {
		pluginBuild.onResolve({ filter: CHAT_SIDEBAR_IMPORT }, () => ({
			path: "chat-sidebar-stub",
			namespace: "stub",
		}));
		pluginBuild.onLoad({ filter: ANY_MODULE, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${rowCurrentLiteral};`,
			loader: "js",
		}));
	},
};

/*
 * JSDOM BEFORE THE BUNDLE IS IMPORTED. Radix reads `document` and the observers
 * while its modules initialise, and `browserDraftStorage()` touches `window` as
 * soon as the page renders.
 */
const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{ url: "http://localhost/" },
);
class NoopObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
const observers = {
	ResizeObserver: NoopObserver,
	IntersectionObserver: NoopObserver,
	matchMedia: () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
	}),
	// Radix's menus dispatch PointerEvents; jsdom has none.
	PointerEvent: dom.window.MouseEvent,
};
/*
 * `window`, `document` and `navigator` are getter-only on node 24's globalThis
 * (and jsdom's own Window getters must not be reassigned), so these are DEFINED
 * rather than assigned, and `navigator` is left to node.
 */
for (const [key, value] of Object.entries({
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	Element: dom.window.Element,
	Node: dom.window.Node,
	Event: dom.window.Event,
	MouseEvent: dom.window.MouseEvent,
	KeyboardEvent: dom.window.KeyboardEvent,
	FocusEvent: dom.window.FocusEvent,
	CustomEvent: dom.window.CustomEvent,
	MutationObserver: dom.window.MutationObserver,
	getComputedStyle: dom.window.getComputedStyle,
	IS_REACT_ACT_ENVIRONMENT: true,
	...observers,
})) {
	Object.defineProperty(globalThis, key, {
		value,
		configurable: true,
		writable: true,
	});
}
for (const [key, value] of Object.entries(observers)) dom.window[key] = value;
dom.window.Element.prototype.hasPointerCapture = () => false;
dom.window.Element.prototype.setPointerCapture = () => {};
dom.window.Element.prototype.releasePointerCapture = () => {};
dom.window.Element.prototype.scrollIntoView = () => {};

const componentBundle = await build({
	stdin: {
		contents: `export { TeamBridgePageView } from "./src/renderer/src/features/team-bridge/team-bridge-page";`,
		resolveDir: ROOT,
		sourcefile: "team-bridge-union-actions.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	plugins: [chatSidebarStub],
	external: [
		"@tanstack/react-query",
		"react",
		"react-dom",
		"react-dom/client",
		"react-dom/server",
		"react-router-dom",
		"react/jsx-runtime",
	],
	jsx: "automatic",
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = {}; import { createRequire as __loCreateRequire } from "node:module"; const require = __loCreateRequire(import.meta.url);',
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	alias: {
		"@shared": `${ROOT}/src/renderer/src/shared`,
		"@features": `${ROOT}/src/renderer/src/features`,
		"@assets": `${ROOT}/src/renderer/src/assets`,
	},
	write: false,
});
const modulePath = new URL(
	`./_team-bridge-union-actions-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(modulePath, componentBundle.outputFiles[0].text);
process.on("exit", () => {
	try {
		unlinkSync(modulePath.pathname);
	} catch {
		// already gone
	}
});

const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
const { TeamBridgePageView } = await import(modulePath.href);

const SELF = "acct_self";
const MINERVA = "tnt_1";
const NORTHWIND = "tnt_2";

const org = (tenantId, name) => ({ tenantId, name, role: "member", unread: 0 });
const person = (accountId, label, patch = {}) => ({
	account_id: accountId,
	display_label: label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...patch,
});

const pageProps = ({ calls, ...patch }) => ({
	selfAccountId: SELF,
	conversations: [],
	target: null,
	messages: [],
	organizations: [org(MINERVA, "Minerva"), org(NORTHWIND, "Northwind")],
	scope: "all",
	totalUnread: 0,
	listState: "ready",
	messageState: "idle",
	people: [],
	peopleState: "ready",
	peopleIncomplete: false,
	directories: {
		[MINERVA]: [
			person("acct_bea", "Bea"),
			person("acct_ben", "Ben", {
				agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
			}),
		],
		[NORTHWIND]: [person("acct_inez", "Ines")],
	},
	directoryStates: { [MINERVA]: "ready", [NORTHWIND]: "ready" },
	onTarget: (next) => calls.push(["target", next]),
	onScopeChange: (next) => calls.push(["scope", next]),
	onChooseOrganization: (next) => calls.push(["choose", next]),
	onSend: () => {},
	onNewChannel: () => {},
	onRetry: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	onRetryPeople: () => {},
	onRetryMembers: () => {},
	...patch,
});

async function mount(patch = {}) {
	const calls = [];
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(TeamBridgePageView, pageProps({ calls, ...patch })),
			),
		);
	});
	return { calls, host, root };
}

const click = async (element) => {
	assert.ok(element, "the element under test is on screen");
	await act(async () => {
		element.dispatchEvent(
			new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};

test("a union person row switches to ITS organization before selecting", async () => {
	const { calls, root } = await mount();
	await click(document.querySelector('[data-team-bridge-person="acct_bea"]'));
	assert.deepEqual(calls, [
		["scope", MINERVA],
		["target", { type: "person", accountId: "acct_bea" }],
	]);
	await act(async () => root.unmount());
});

test("a union row switches to the SECOND organization too, not to the first", async () => {
	const { calls, root } = await mount();
	await click(document.querySelector('[data-team-bridge-person="acct_inez"]'));
	assert.deepEqual(calls, [
		["scope", NORTHWIND],
		["target", { type: "person", accountId: "acct_inez" }],
	]);
	await act(async () => root.unmount());
});

test("a row's scope switch never writes the stored preference", async () => {
	const { calls, root } = await mount();
	await click(document.querySelector('[data-team-bridge-person="acct_bea"]'));
	// Only an explicit switcher pick may persist a preference (spec 4.3).
	assert.equal(
		calls.some(([kind]) => kind === "choose"),
		false,
		"a row action wrote a scope preference",
	);
	await act(async () => root.unmount());
});

test("a chief row acts in the organization that owns the agent", async () => {
	const { calls, root } = await mount();
	await click(document.querySelector('[data-team-bridge-chief="acct_ben"]'));
	assert.deepEqual(calls, [
		["scope", MINERVA],
		["target", { type: "chief", accountId: "acct_ben" }],
	]);
	await act(async () => root.unmount());
});

test("the switcher's own pick DOES write the preference", async () => {
	const { calls, root } = await mount();
	const trigger = document.querySelector('[aria-haspopup="menu"]');
	assert.ok(trigger, "the organization switcher is on screen");
	await act(async () => {
		trigger.dispatchEvent(
			new dom.window.MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
	});
	const items = [...document.querySelectorAll('[role="menuitemradio"]')];
	assert.ok(items.length > 0, "the switcher menu opened");
	const target = items.find((item) => item.textContent?.includes("Northwind"));
	assert.ok(target, "Northwind is in the switcher menu");
	await click(target);
	assert.deepEqual(
		calls,
		[["choose", NORTHWIND]],
		"the switcher must write the preference and must not take the row path",
	);
	await act(async () => root.unmount());
});
