import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The built-ins offer's DISMISS control, driven on the shipped sidebar in a real
 * DOM.
 *
 * Why this file exists. The control is the part of the offer a frame cannot hold
 * to account: "the block is gone", "the caret is on the create row", "a batch
 * mid-run is not dismissable", "the same catalogue stays dismissed across a
 * remount and a changed one re-arms" are all facts about DOM and STORE STATE
 * across time, not about a still. Source text cannot answer them either - the
 * answers live in effect ordering and a persisted store - so the cases below
 * mount the real `ChatSidebar`, press the real control, and read the results.
 *
 * What is faked, and only that: the surfaces' data hooks (capabilities,
 * profiles/teams, the feed, search, the status read), the router hook, and the
 * transport below `desktopResult` - the profile catalogue is a global the cases
 * vary, because the re-arm case is ABOUT a changed catalogue. The SIDEBAR, the
 * STORES (canonical sessions and UI preferences), the `Button` primitive and
 * `cn` are the shipped ones, so the conditions under test are the ones the app
 * ships.
 *
 * What it is NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says the control sits where it should or that it clears the contrast
 * floors; those are the frames' job (`docs/evidence/chat-sidebar-agents/`).
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
	"@shared/api/local-operator/desktop-api": `export {DESKTOP_REFUSAL_PLACEHOLDER, DesktopControlError, UserFacingError, userFacingMessage, isRemoteReceiptDeferral} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
export {DESKTOP_FOREGROUND_REQUIRED_CODE, DESKTOP_FOREGROUND_REQUIRED_MESSAGE} from ${JSON.stringify(
		`${process.cwd()}/src/shared/desktop-contract.ts`,
	)}
export const desktopResult = request => globalThis.__desktop(request);`,
	/*
	 * Capabilities: the gate the section's own reads ride, so
	 * `session_catalogue: 2` is present as it is in `mark-all-read`'s harness,
	 * and `profile_catalogue` as the agents section needs.
	 */
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled, desktopFeatureState} from ${JSON.stringify(
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
	"@shared/api/local-operator/backend-error":
		"export const compatibilityBannerShown = () => false;\nexport const retryDesktopQuery = () => false;",
	// `Link` as well as `useNavigate`: the hub mark draws the sign-in sentence as a
	// link, and a stub that exports only the hook fails the BUNDLE rather than an
	// assertion (agent review round 2, R2-1). `useLocation` for the same reason:
	// the row menu's Fork item reads the route to decide whether to navigate to
	// `/chat` (#739), and a missing export fails the bundle, not an assertion.
	"react-router-dom":
		'export const useNavigate = () => () => undefined;\nexport const useLocation = () => ({ pathname: "/chat" });\nexport const Link = ({ children }) => children;',
	"@shared/themes": `export const DEFAULT_THEME = "localOperatorDark";`,
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

const bundle = await build({
	stdin: {
		contents:
			'export { ChatSidebar } from "./src/renderer/src/features/chat/components/chat-sidebar";' +
			' export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";' +
			/*
			 * The query client, EXPORTED FROM THIS BUNDLE rather than imported on the
			 * side: the provider the harness renders has to be the same module
			 * instance as the one the sidebar's own tree reads, or React sees a
			 * different context and the provider may as well not be there.
			 */
			' export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
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
			},
		},
	],
});
const bundlePath = new URL(
	"._agents-offer-dismiss.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	ChatSidebar,
	useCanonicalSessionsStore,
	useUiPreferencesStore,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/* ---------------------------------------------------------------- the cases */

/** The persisted envelope the shipped store writes, parsed. */
const storedPreferences = () =>
	JSON.parse(values.get("ui-preferences-storage") ?? "null")?.state ?? {};

const buttonByText = (text) =>
	[...document.querySelectorAll("button")].find(
		(button) => (button.textContent ?? "").trim() === text,
	) ?? null;

/**
 * Mount the shipped sidebar and return the handles a case drives it with.
 *
 * The catalogue comes from `globalThis.__profiles`, read at render time; cases
 * change it BETWEEN mounts (after an unmount, before the next), which is what
 * the re-arm case needs and what keeps every other case's fixture stable.
 */
const mount = async () => {
	useCanonicalSessionsStore.setState({
		sessions: [],
		loading: false,
		error: null,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	/** One client per mount, and no retries: nothing here presses a query's control. */
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client: queryClient },
				React.createElement(ChatSidebar, {
					selectedConversation: undefined,
					onSelectConversation: () => undefined,
					onStageDraft: () => undefined,
				}),
			),
		);
	});
	return {
		container,
		box: () => document.querySelector('[data-testid="agents-sidebar-empty"]'),
		dismissControl: () =>
			document.querySelector('[data-testid="agents-offer-dismiss"]'),
		progress: () =>
			document.querySelector('[data-testid="install-builtins-progress"]'),
		summary: () =>
			document.querySelector('[data-testid="install-builtins-summary"]'),
		installAction: () => buttonByText("Install all built-in agents"),
		createRow: () => buttonByText("Create agent"),
		click: async (element) => {
			await act(async () => {
				element.dispatchEvent(
					new DOM.window.MouseEvent("click", { bubbles: true }),
				);
			});
		},
		unmount: async () => {
			await act(async () => root.unmount());
			container.remove();
		},
	};
};

/** Flush microtasks and effects until `predicate` holds, bounded. */
const settle = async (predicate, attempts = 60) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		await act(async () => {});
		await act(async () => frame());
		if (predicate()) return true;
	}
	return false;
};

/** Each case starts from the same place: nothing dismissed, six built-ins. */
const reset = () => {
	values.clear();
	globalThis.__profiles = [...BUILTINS];
	globalThis.__desktop = defaultDesktop;
	useUiPreferencesStore.setState({ dismissedBuiltinOfferSignature: "" });
};

test("the dismiss control hides the block, and the section keeps only its create row", async () => {
	reset();
	const harness = await mount();
	try {
		assert.ok(harness.box(), "the empty-state box did not render");
		const control = harness.dismissControl();
		assert.ok(control, "the dismiss control did not render beside the offer");
		assert.equal(
			control.getAttribute("aria-label"),
			"Dismiss built-in agents suggestion",
		);
		await harness.click(control);
		assert.equal(
			harness.box(),
			null,
			"the empty-state box survived the dismissal",
		);
		assert.equal(
			harness.dismissControl(),
			null,
			"the control survived its own press",
		);
		const text = document.body.textContent ?? "";
		assert.ok(
			!text.includes("No agents yet"),
			"the block's line is still painted after the dismissal",
		);
		assert.ok(
			!text.includes("ready to install"),
			"the offer sentence is still painted after the dismissal",
		);
		assert.ok(
			harness.createRow(),
			"the create row is not the thing the section is left with",
		);
	} finally {
		await harness.unmount();
	}
});

test("the press hands the caret to the control that survives it", async () => {
	reset();
	const harness = await mount();
	try {
		const control = harness.dismissControl();
		control.focus();
		assert.equal(
			document.activeElement,
			control,
			"the control cannot take focus, so this case proves nothing",
		);
		await harness.click(control);
		assert.notEqual(
			document.activeElement,
			document.body,
			"focus fell to <body> when the pressed control unmounted",
		);
		assert.equal(
			document.activeElement,
			harness.createRow(),
			"the caret did not land on the create row",
		);
	} finally {
		await harness.unmount();
	}
});

test("the dismissal persists the signature, and a fresh mount of the same catalogue starts dismissed", async () => {
	reset();
	let harness = await mount();
	try {
		await harness.click(harness.dismissControl());
	} finally {
		await harness.unmount();
	}
	assert.equal(
		storedPreferences().dismissedBuiltinOfferSignature,
		BUILTINS_SIGNATURE,
		"the shipped store did not persist the offer's signature",
	);
	/*
	 * The same catalogue in a DIFFERENT arrival order must still read as the
	 * same offer: the signature is sorted, not positional, and this remount is
	 * where that is falsifiable.
	 */
	globalThis.__profiles = [...BUILTINS].reverse();
	harness = await mount();
	try {
		assert.equal(
			harness.dismissControl(),
			null,
			"a dismissed offer came back on a fresh mount of the same catalogue",
		);
		assert.equal(
			harness.box(),
			null,
			"the dismissed block came back on a fresh mount",
		);
		assert.ok(
			harness.createRow(),
			"the create row went missing with the block",
		);
	} finally {
		await harness.unmount();
	}
});

test("a changed catalogue re-arms the offer", async () => {
	reset();
	let harness = await mount();
	try {
		await harness.click(harness.dismissControl());
		assert.equal(harness.dismissControl(), null, "the dismissal did not land");
	} finally {
		await harness.unmount();
	}
	globalThis.__profiles = [
		...BUILTINS,
		{ name: "auditor", kind: "role", source: "builtin" },
	];
	harness = await mount();
	try {
		assert.ok(
			harness.dismissControl(),
			"a catalogue that gained a built-in did not re-arm the offer",
		);
		assert.ok(
			harness.box(),
			"the re-armed offer has no box to be dismissed from",
		);
	} finally {
		await harness.unmount();
	}
});

test("a batch in flight is not dismissable, and Done returns the control while the section is still empty", async () => {
	reset();
	/*
	 * The first install is HELD, which is how the run is entered
	 * deterministically rather than by racing a timer; the rest answer
	 * immediately. The held promise is released inside the case, and once more
	 * in `finally` if an assertion failed before its normal completion, so a red
	 * run cannot hang here.
	 */
	let release = null;
	let heldPromise = null;
	const heldFirst = () => {
		let resolveHeld;
		heldPromise = new Promise((resolve) => {
			resolveHeld = resolve;
		});
		release = () => resolveHeld({ name: "coder" });
		return heldPromise;
	};
	serveDesktop((request) => {
		if (request.op !== "profiles.install") {
			throw new Error(`unexpected desktop op in this test: ${request.op}`);
		}
		return request.name === "coder"
			? heldFirst()
			: Promise.resolve({ name: request.name });
	});
	const harness = await mount();
	try {
		const action = harness.installAction();
		assert.ok(action, "the batch's action did not render");
		await harness.click(action);
		assert.ok(harness.progress(), "the batch is not reporting its progress");
		assert.equal(
			harness.dismissControl(),
			null,
			"the dismiss control exists while the batch is running",
		);
		await act(async () => {
			release();
			await heldPromise;
		});
		assert.ok(
			await settle(() => harness.summary() !== null),
			"the batch never reached its summary",
		);
		assert.equal(
			harness.dismissControl(),
			null,
			"the dismiss control exists while the summary is up",
		);
		await harness.click(buttonByText("Done"));
		assert.ok(
			await settle(() => harness.dismissControl() !== null),
			"the control did not return after the summary was dismissed",
		);
		assert.ok(harness.box(), "the empty state is gone after the batch");
	} finally {
		globalThis.__desktop = defaultDesktop;
		if (release && heldPromise) {
			release();
			await act(async () => {
				await heldPromise;
			});
		}
		await harness.unmount();
	}
});

test("no dismissal exists where there is no offer to dismiss", async () => {
	reset();
	/*
	 * The two states the control must stay out of by its own condition: no
	 * packaged profiles at all (the box still says "No agents yet"), and a user
	 * with agents of their own (the section renders the quiet row instead of the
	 * empty box).
	 */
	globalThis.__profiles = [];
	let harness = await mount();
	try {
		assert.ok(
			harness.box(),
			"the empty state without built-ins stopped rendering",
		);
		assert.equal(
			harness.dismissControl(),
			null,
			"a dismissal is offered with nothing to dismiss",
		);
	} finally {
		await harness.unmount();
	}
	globalThis.__profiles = [
		{ name: "my-helper", kind: "role", source: "custom" },
		...BUILTINS,
	];
	harness = await mount();
	try {
		assert.equal(
			harness.box(),
			null,
			"a user with agents of their own is in the empty state",
		);
		assert.equal(
			harness.dismissControl(),
			null,
			"a dismissal is offered in the populated state",
		);
		assert.ok(harness.createRow(), "the create row left the populated section");
	} finally {
		await harness.unmount();
	}
});
