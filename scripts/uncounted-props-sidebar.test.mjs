import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE SIDEBAR'S BAND TOOLTIPS, rendered under a non-English locale with the
 * shipped catalogues. They used to be literals (`<Tooltip content="View options">`)
 * that the i18n scanner could not see because it counted four attributes only.
 *
 * WHAT IS MEASURED. The real `ChatSidebar` is mounted in jsdom and each of the four
 * band controls (search, view options, new agent or team, open agent) is focused,
 * which is how a keyboard user opens a Radix tooltip. The tooltip panel's text is
 * compared with the locale's REAL catalogue value, read from
 * `src/i18n/catalogues/<locale>/ui.chat.sidebar.json`, not typed here, so the
 * assertion cannot agree with a wrong key by accident. English is asserted too: the
 * source value must be character-identical to the literal the call site carried.
 *
 * THE NEGATIVE CONTROL IS EXECUTED. The bundle is rebuilt once with ONE call site
 * (the "View options" tooltip) reverted to its English literal, and the French
 * assertion is shown to fail against it. A test that cannot fail is not evidence.
 *
 * WHAT IT DOES NOT PROVE: pixels, placement or the hover delay (focus opens a
 * Radix tooltip at once). The stubs are `agents-offer-dismiss.test.mjs`'s; the
 * sidebar, its stores, the Tooltip primitive and `t()` are the shipped ones.
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
});
/*
 * jsdom's own constructors are FORCED onto the global - Node 26 defines `Event`
 * and `CustomEvent` itself, and a React tree whose events are built from Node's
 * classes fails inside the commit phase with an error that reads like a
 * component bug. The recipe is `typed-row-call-sites.test.mjs`'s, adopted by
 * `mark-all-read-control.test.mjs` and reused here.
 */
const FORCE_FROM_JSDOM = [
	"Event",
	"CustomEvent",
	"UIEvent",
	"MouseEvent",
	"PointerEvent",
	"KeyboardEvent",
	"FocusEvent",
	"InputEvent",
	"CompositionEvent",
	"HTMLElement",
	"Element",
	"Node",
	"DocumentFragment",
	"Range",
	"Selection",
	"DOMRect",
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(DOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = DOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of scope.
	}
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * THE FRAME LOOP THIS HARNESS OWNS, AND WHY IT QUEUES RATHER THAN RUNS.
 *
 * `toast.dismiss` does not remove a toast by itself: sonner's observer notifies
 * its subscribers from a `requestAnimationFrame`, and jsdom without
 * `pretendToBeVisual` has no frame at all - the globals promotion above assigns
 * `undefined`, so an effect that retires a toast threw `ReferenceError:
 * requestAnimationFrame is not defined` from inside a commit phase. The queue
 * answers the dependency without pretending to be a browser: frames are drained
 * when the harness says so (`frame()`, inside `settle`), so a case is never
 * racing a real frame clock.
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
/** Drain every queued frame, oldest first. */
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
};
// jsdom implements no layout, so no scrolling: the panel's own effects would
// throw on the first render otherwise.
DOM.window.Element.prototype.scrollIntoView = () => {};
/*
 * jsdom ships no `ResizeObserver`, and the sidebar needs one on every mount: it
 * measures its own column to derive the split's capacity. A no-op is the honest
 * stub here rather than a recording one - jsdom computes no layout, so a case
 * that wanted the capacity would be asserting against zeroes it invented.
 */
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
/*
 * `useMediaQuery` is a `useSyncExternalStore` over `window.matchMedia`, and
 * jsdom implements none. Set on the jsdom window rather than on `globalThis`
 * for the reason the hooks read it there.
 */
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});

/**
 * The store's persistence needs this, and the cases read it back: the point of
 * the dismissal is that it PERSISTS, so one case asserts the envelope the
 * shipped store writes rather than only the store's in-memory state.
 */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/* ------------------------------------------------------------- the catalogue */

/**
 * The six packaged profiles, as `profiles.list` reports them: `source` is
 * `"builtin"` and the user has not installed them. Only `name` is read by the
 * section under test; the row shape is the wire's.
 */
const BUILTINS = [
	{ name: "coder", kind: "role", source: "builtin" },
	{ name: "reviewer", kind: "role", source: "builtin" },
	{ name: "designer", kind: "role", source: "builtin" },
	{ name: "architect", kind: "role", source: "builtin" },
	{ name: "qa-tester", kind: "role", source: "builtin" },
	{ name: "manager", kind: "role", source: "builtin" },
];

/**
 * The signature the section should store for `BUILTINS`: sorted names, one per
 * line. Spelled here rather than imported so the assertion is about the STORED
 * FORMAT (what a future reader of the localStorage envelope sees), not about
 * agreeing with the function under test.
 */
const BUILTINS_SIGNATURE = [
	"architect",
	"coder",
	"designer",
	"manager",
	"qa-tester",
	"reviewer",
].join("\n");

/* --------------------------------------------------------------- the bridge */

/**
 * The transport below `desktopResult`, and the catalogue the hooks serve.
 *
 * `sessions.list` is answered on every path - the sidebar issues it on mount -
 * and everything else is a per-case handler, so an op a case did not expect
 * fails loudly here rather than surfacing as a missing element somewhere else.
 */
const defaultDesktop = async (request) => {
	if (request.op === "sessions.list") return { sessions: [], truncated: false };
	throw new Error(`unexpected desktop op in this test: ${request.op}`);
};
globalThis.__desktop = defaultDesktop;

const serveDesktop = (handler) => {
	globalThis.__desktop = async (request) => {
		if (request.op === "sessions.list")
			return { sessions: [], truncated: false };
		return handler(request);
	};
};

/* ------------------------------------------------------------------ stubs */

/**
 * The modules replaced wholesale, and the patterns the plugin matches them by.
 * The set is `mark-all-read-control.test.mjs`'s - the same sidebar graph - with
 * one difference that matters to this file: `useProfiles` reads its catalogue
 * off `globalThis.__profiles` at call time, because the re-arm case is ABOUT a
 * catalogue that changes and a frozen fixture could not express one.
 */
const STUB_PATHS = [
	"@shared/api/local-operator/desktop-hooks",
	"@shared/api/local-operator/profile-hooks",
	"@shared/api/local-operator/session-search",
	"@shared/hooks/use-desktop-feed",
	"@shared/api/local-operator/backend-error",
	"react-router-dom",
	"@shared/hooks/use-canonical-session",
	"@shared/api/local-operator/desktop-api",
	"@shared/hooks/use-connectivity-status",
	"@shared/themes",
];
const STUB_FILTERS = STUB_PATHS.map((path) => new RegExp(`^${path}$`));
/**
 * The namespace's load hook matches every path inside it, and it is a module
 * constant rather than an inline literal because `lint/performance/useTopLevelRegex`
 * (and `check-scripts-lint.mjs`, which treats that warning as not-lint-clean)
 * fails a literal created inside a callback.
 */
const ANY_PATH = /.*/;

const STUB_CONTENTS = {
	"@shared/api/local-operator/desktop-api": `export {DESKTOP_REFUSAL_PLACEHOLDER, DesktopControlError, UserFacingError, userFacingMessage, isRemoteReceiptDeferral, mediaError} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
export {DESKTOP_FOREGROUND_REQUIRED_CODE, DESKTOP_FOREGROUND_REQUIRED_MESSAGE} from ${JSON.stringify(
		`${process.cwd()}/src/shared/desktop-contract.ts`,
	)}
export const desktopResult = request => globalThis.__desktop(request);
/*
 * Agent pictures: the shipped sidebar/status graph now imports the avatar
 * hooks, which read the roster through desktopControlResponse and picture
 * bytes through desktopMedia. This fixture is not about pictures, so both
 * answer without IO (an empty roster means no picture, so no byte read is
 * attempted) and stay off the case's own request seam, which keeps the request
 * log about the control under test. mediaError is the shipped, pure one.
 */
export const desktopControlResponse = async () => new Response(JSON.stringify({ result: { agents: [] } }), { status: 200, headers: { "Content-Type": "application/json" } });
export const desktopMedia = async () => ({ status: 404, kind: "error", detail: "no media in this fixture" });`,
	/*
	 * Capabilities: the gate the section's own reads ride, so
	 * `session_catalogue: 2` is present as it is in `mark-all-read`'s harness,
	 * and `profile_catalogue` as the agents section needs.
	 */
	// The view menu imports the renderer i18n barrel, whose language-write seam
	// uses real query keys. Re-export those keys too: keep this partial hook
	// fixture compatible without inventing fake keys or suppressing link errors.
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled, desktopFeatureState, desktopKeys} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-hooks.ts`,
	)}
export const useDesktopCapabilities = () => ({
	data: { desktop_available: true, features: { session_catalogue: 2, profile_catalogue: 1, team_catalogue: 1 } },
	error: null,
	isLoading: false,
	refetch: async () => undefined,
});`,
	"@shared/api/local-operator/profile-hooks": `export const useProfiles = () => ({ data: globalThis.__profiles ?? [], error: null, isLoading: false, refetch: async () => undefined });
export const useTeams = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });`,
	"@shared/api/local-operator/session-search":
		"export const useChatSearch = () => ({ data: undefined, refused: false, isError: false, refetch: async () => undefined });",
	"@shared/hooks/use-desktop-feed":
		"export const useDesktopFeed = () => ({ available: false, connected: true, catalogueRevision: 0 });",
	"@shared/hooks/use-connectivity-status":
		"export const useServerHealth = () => ({ data: { online: true, snapshot: null } });",
	/*
	 * `backendLoadErrorMessage` joined this list with the sidebar's remote rows:
	 * their hover sentence resolves the network name through
	 * `features/mesh/mesh-store`, whose error path composes with the real
	 * helper - and a stub missing an export fails the BUNDLE, not an assertion
	 * (the same shape the R2-1 note above records).
	 */
	"@shared/api/local-operator/backend-error":
		"export const compatibilityBannerShown = () => false;\nexport const retryDesktopQuery = () => false;\nexport const backendLoadErrorMessage = (lead) => lead;",
	// `Link` as well as `useNavigate`: the hub mark draws the sign-in sentence as a
	// link, and a stub that exports only the hook fails the BUNDLE rather than an
	// assertion (agent review round 2, R2-1). `useLocation` for the same reason:
	// the row menu's Fork item reads the route to decide whether to navigate to
	// `/chat` (#739), and a missing export fails the bundle, not an assertion.
	"react-router-dom":
		'export const useNavigate = () => () => undefined;\nexport const useLocation = () => ({ pathname: "/chat" });\nexport const Link = ({ children }) => children;',
	"@shared/themes": `export const DEFAULT_THEME = "localOperatorDark";
export const isThemeName = (id) => id === "localOperatorDark";`,
	"@shared/hooks/use-canonical-session": `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "unseen";
export const paintPendingSend = () => undefined;
export const settlePendingSend = () => undefined;
export const hasPendingSend = () => false;
export const movePendingSendIdentity = () => undefined;
export const replacePendingSendText = () => undefined;
export const discardPendingSends = () => undefined;
export const pendingSendForView = () => null;
export const discardPendingEchoes = () => undefined;`,
};

/** The one call site the negative control reverts, and the English it becomes. */
const REVERT_SITE = {
	call: 'content={t("ui.chat.sidebar.header.view_options")}',
	literal: 'content="View options"',
};
const SIDEBAR_SOURCE = /features\/chat\/components\/chat-sidebar\.tsx$/;

const catalogue = (locale) =>
	JSON.parse(
		readFileSync(
			`${process.cwd()}/src/i18n/catalogues/${locale}/ui.chat.sidebar.json`,
			"utf8",
		),
	);

/** One bundle per variant; the revert variant carries the negative control. */
async function load(revert) {
	const result = await build({
		stdin: {
			contents: [
				'export { ChatSidebar } from "./src/renderer/src/features/chat/components/chat-sidebar";',
				'export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";',
				'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
				'export * as i18n from "./src/i18n";',
			].join("\n"),
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		mainFields: ["module", "main"],
		conditions: ["import"],
		alias: {
			"@shared": `${process.cwd()}/src/renderer/src/shared`,
			"@features": `${process.cwd()}/src/renderer/src/features`,
		},
		external: ["react", "react-dom", "react/jsx-runtime"],
		packages: "external",
		jsx: "automatic",
		plugins: [
			{
				name: "sidebar-fixture",
				setup(builder) {
					for (const [index, path] of STUB_PATHS.entries()) {
						builder.onResolve({ filter: STUB_FILTERS[index] }, () => ({
							path,
							namespace: "sidebar-fixture",
						}));
					}
					builder.onLoad(
						{ filter: ANY_PATH, namespace: "sidebar-fixture" },
						(args) => {
							const contents = STUB_CONTENTS[args.path];
							return contents === undefined
								? undefined
								: { contents, loader: "js", resolveDir: process.cwd() };
						},
					);
					if (revert) {
						builder.onLoad({ filter: SIDEBAR_SOURCE }, (args) => {
							const source = readFileSync(args.path, "utf8");
							assert.equal(
								source.split(REVERT_SITE.call).length - 1,
								1,
								"the negative control must revert exactly one call site",
							);
							return {
								contents: source.replace(REVERT_SITE.call, REVERT_SITE.literal),
								loader: "tsx",
							};
						});
					}
				},
			},
		],
	});
	const path = new URL(
		`._uncounted-props-sidebar.${revert ? "revert" : "base"}.bundle.mjs`,
		import.meta.url,
	);
	await writeFile(path, result.outputFiles[0].text);
	after(() => unlink(path).catch(() => {}));
	return import(path.href);
}

globalThis.__profiles = [];
globalThis.__desktop = defaultDesktop;
const { createRoot } = await import("react-dom/client");

/**
 * Mount the shipped sidebar, focus the control matching `selector` and return the
 * text of the tooltip panel Radix opens for it.
 */
async function tooltipFor(lib, selector) {
	lib.useCanonicalSessionsStore.setState({
		sessions: [],
		loading: false,
		error: null,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const queryClient = new lib.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	try {
		await act(async () => {
			root.render(
				React.createElement(
					lib.QueryClientProvider,
					{ client: queryClient },
					React.createElement(lib.ChatSidebar, {
						selectedConversation: undefined,
						onSelectConversation: () => undefined,
						onStageDraft: () => undefined,
					}),
				),
			);
		});
		const control = container.querySelector(selector);
		assert.ok(control, `${selector} did not render`);
		await act(async () => {
			control.focus();
			control.dispatchEvent(new DOM.window.FocusEvent("focus"));
			control.dispatchEvent(
				new DOM.window.FocusEvent("focusin", { bubbles: true }),
			);
		});
		const panel = document.querySelector("[data-lo-tooltip-panel]");
		return panel?.textContent ?? null;
	} finally {
		await act(async () => root.unmount());
		queryClient.clear();
		container.remove();
	}
}

/* The four band controls, their stable hooks and the catalogue keys they paint. */
const CONTROLS = [
	["[data-sidebar-search]", "ui.chat.sidebar.header.search"],
	["[data-sidebar-view-options]", "ui.chat.sidebar.header.view_options"],
	["[data-sidebar-create]", "ui.chat.sidebar.header.create"],
	["[data-sidebar-open-agent]", "ui.chat.sidebar.header.open_agent"],
];

/** The English the literals carried before keying; hoisted verbatim from the diff. */
const ENGLISH = {
	"ui.chat.sidebar.header.search": "Search chats and agents",
	"ui.chat.sidebar.header.view_options": "View options",
	"ui.chat.sidebar.header.create": "New agent or team",
	"ui.chat.sidebar.header.open_agent": "Open agent\u2026",
};

test("each band tooltip shows the shipped French catalogue value, not English", async () => {
	const lib = await load(false);
	const french = catalogue("fr");
	for (const [, key] of CONTROLS) {
		assert.ok(french[key], `${key} has no shipped French value to compare to`);
		assert.notEqual(french[key], ENGLISH[key], `${key} is untranslated in fr`);
	}
	lib.i18n.setLocale("fr");
	try {
		for (const [selector, key] of CONTROLS) {
			assert.equal(
				await tooltipFor(lib, selector),
				french[key],
				`${selector} tooltip is not the French catalogue value`,
			);
		}
	} finally {
		lib.i18n.setLocale("en");
	}
});

test("under English the same four tooltips read the original literals", async () => {
	const lib = await load(false);
	lib.i18n.setLocale("en");
	for (const [selector, key] of CONTROLS) {
		assert.equal(await tooltipFor(lib, selector), ENGLISH[key]);
	}
});

test("negative control: reverting one call site to its literal defeats the French assertion", async () => {
	const lib = await load(true);
	const french = catalogue("fr");
	lib.i18n.setLocale("fr");
	try {
		const shown = await tooltipFor(lib, "[data-sidebar-view-options]");
		assert.equal(shown, ENGLISH["ui.chat.sidebar.header.view_options"]);
		assert.notEqual(shown, french["ui.chat.sidebar.header.view_options"]);
		// A reverted site must not disturb its neighbours: the other three are
		// still French, so the failure above is the one site, not the harness.
		assert.equal(
			await tooltipFor(lib, "[data-sidebar-search]"),
			french["ui.chat.sidebar.header.search"],
		);
	} finally {
		lib.i18n.setLocale("en");
	}
});
