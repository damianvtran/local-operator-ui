import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The "Mark all N read" control's KEYBOARD behaviour, driven on the shipped
 * sidebar in a real DOM.
 *
 * Why this file exists. Agent review round 1 (R2) found that the control joined
 * the ↑/↓ walk `keyDown` performs over `[data-chat-row]` — a behaviour change no
 * test described — and UX round 1 (U2) walked the same flow with real key events
 * and found two dead ends at the end of it: activating the control dropped focus
 * to `<body>` for the length of the request (a `disabled` button is blurred by
 * the browser), and clearing the last mark unmounted the control under the
 * reader's cursor with focus following it out of the list. Source text cannot
 * answer any of that: the questions are "which element does the ring land on",
 * "where is focus while the request is open", and "where is it afterwards".
 *
 * What is faked, and only that: the four hook modules the sidebar reads for the
 * data of other surfaces (capabilities, the feed, profiles/teams, search), the
 * router hook, the compatibility banner, and the transport below the store. The
 * SIDEBAR, the STORE, the HEADING ROW, the `Button` primitive, `ChatSessionStatus`
 * and `cn` are the shipped ones, so the walk order and the focus behaviour under
 * test are the ones the app ships.
 *
 * What it is NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says the label fits, that the row sticks, or that the shed fires — those
 * are the frames' job (`docs/evidence/chat-sidebar-status-feed/`, captured at the
 * app's own 240/280/360 clamps).
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
});
/*
 * jsdom's own constructors are FORCED onto the global — Node 26 defines `Event`
 * and `CustomEvent` itself, and a React tree whose events are built from Node's
 * classes fails inside the commit phase with an error that reads like a
 * component bug. The recipe is `typed-row-call-sites.test.mjs`'s.
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
// jsdom implements no layout, so no scrolling: the panel's own effects would
// throw on the first render otherwise.
DOM.window.Element.prototype.scrollIntoView = () => {};

/** The store's persistence needs this, and the transport is the only fake. */
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

const SESSION = "a1b2c3d4e5f6";
const OTHER = "b2c3d4e5f6a7";
const TOKEN = "9f2c4a1e-6b3d-4c8a-9f10-1a2b3c4d5e6f";

/** One catalogue row, unread unless a case says otherwise. */
const unread = (sessionId, over = {}) => ({
	conversation_id: `session/${sessionId}`,
	completion_token: TOKEN,
	anchor_id: "result-1",
	kind: "complete",
	unseen: true,
	revision: [4, 3],
	...over,
});

/**
 * The derived status pair every wire row carries for a finished, unread turn
 * (`CatalogEntry.status_code`). It is part of the row rather than decoration:
 * `unreadMarkKind` reads it to decide what a row is DRAWING, so a fixture
 * without one is a row the backend cannot produce.
 */
const COMPLETE = { code: "complete", label: "Unseen completion" };

/**
 * The receipts each case stages, plus the request log the assertions read.
 *
 * `held` is a promise the case resolves by hand, which is how the in-flight
 * state is entered deterministically rather than by racing a timer.
 */
let held = null;
let requests = [];
const serve = (receipt) => {
	requests = [];
	globalThis.__ack = async (request) => {
		requests.push(request);
		return receipt;
	};
};
globalThis.__ack = async (request) => {
	requests.push(request);
	return { read: [], superseded: [], unknown: [] };
};

/*
 * The modules replaced wholesale, and the patterns the plugin matches them by.
 *
 * Built at module level rather than inside `setup` because biome's
 * `useTopLevelRegex` is right that a `RegExp` per registration is a per-call
 * allocation for no reason, which is why this file's other patterns are consts.
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
];
const STUB_FILTERS = STUB_PATHS.map((path) => new RegExp(`^${path}$`));

/**
 * What each stub exports.
 *
 * `desktop-api` is the load-bearing one and the only place this file fakes the
 * network: `desktopResult` is replaced with the case's own answer, while the
 * error classes and `userFacingMessage` are the SHIPPED ones, because the
 * store's error copy and the failure receipt both read them.
 */
const STUB_CONTENTS = {
	"@shared/api/local-operator/desktop-api": `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
/*
 * The REAL transport, under a second name, for the one case that has to drive a
 * refusal through it: the classification this file's last case asserts lives
 * inside it (desktopRequest), so a case that used the stub for that step would
 * be asserting the caller against an answer the caller never receives from the
 * app. Everything else here uses the stub, because the store's own error copy is
 * not what those cases are about.
 */
export {desktopResult as realDesktopResult} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
export {DESKTOP_FOREGROUND_REQUIRED_CODE, DESKTOP_FOREGROUND_REQUIRED_MESSAGE} from ${JSON.stringify(
		`${process.cwd()}/src/shared/desktop-contract.ts`,
	)}
export const desktopResult = request => globalThis.__ack(request);`,
	/*
	 * Capabilities: the one the CONTROL's own gate reads, so its key is present at
	 * 1 — the absent-capability state is a frame of its own rather than a case
	 * here. `desktopFeatureEnabled` is re-exported from the shipped module rather
	 * than re-implemented, so the gate under test is the app's own.
	 */
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-hooks.ts`,
	)}
export const useDesktopCapabilities = () => ({
	data: { desktop_available: true, features: { completion_ack_bulk: 1, session_catalogue: 2 } },
	error: null,
	isLoading: false,
	refetch: async () => undefined,
});`,
	// The other surfaces' data. None of it is what this file is about.
	"@shared/api/local-operator/profile-hooks": `export const useProfiles = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });
export const useTeams = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });`,
	"@shared/api/local-operator/session-search":
		"export const useChatSearch = () => ({ data: undefined, refused: false, isError: false, refetch: async () => undefined });",
	"@shared/hooks/use-desktop-feed":
		"export const useDesktopFeed = () => ({ available: false, connected: true, catalogueRevision: 0 });",
	"@shared/api/local-operator/backend-error":
		"export const compatibilityBannerShown = () => false;",
	"react-router-dom": "export const useNavigate = () => () => undefined;",
	"@shared/hooks/use-canonical-session": `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const discardPendingEchoes = () => undefined;`,
};

const bundle = await build({
	stdin: {
		contents:
			'export { ChatSidebar } from "./src/renderer/src/features/chat/components/chat-sidebar";' +
			' export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			/*
			 * The container that PAINTS a toast, for the one case about the sentence a
			 * reader gets: the control composes the copy but the app's own container is
			 * what renders it, so reading the sentence off the rendered toast is the
			 * whole chain rather than the half of it this harness stubs.
			 */
			' export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";' +
			' export { realDesktopResult, DESKTOP_FOREGROUND_REQUIRED_CODE, DESKTOP_FOREGROUND_REQUIRED_MESSAGE } from "@shared/api/local-operator/desktop-api";' +
			/*
			 * The query client, EXPORTED FROM THIS BUNDLE rather than imported by the
			 * harness on the side: the provider the harness renders has to be the same
			 * module instance as the one the sidebar's own tree reads, or React sees a
			 * different context and the provider may as well not be there.
			 *
			 * The harness needs one because the sidebar's agents section now mounts
			 * `InstallBuiltinAgents` in EVERY state, including the empty one this fixture
			 * is (no profiles, no built-ins to offer): the summary that component owns has
			 * to outlive the refresh that swaps which state is on screen, so it cannot be
			 * rendered conditionally. The app supplies the provider app-wide; a harness
			 * that mounts the shipped sidebar bare has to supply it itself.
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
					{ filter: /.*/, namespace: "sidebar-fixture" },
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
	"._mark-all-read-control.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	ChatSidebar,
	useCanonicalSessionsStore: store,
	ThemedToastContainer,
	realDesktopResult,
	DESKTOP_FOREGROUND_REQUIRED_CODE,
	DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/** Mount the shipped sidebar and return the handles a case drives it with. */
const mount = async (rows) => {
	store.setState({ sessions: rows, loading: false, error: null });
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
	const walkTo = (element) =>
		document.querySelector(`[data-tour-tag="${element}"]`);
	return {
		container,
		/** The control, by the hook the driver and the frames use too. */
		control: () => walkTo("mark-all-read"),
		/** The Active chats disclosure — the row above the control in the ring. */
		activeToggle: () =>
			[...document.querySelectorAll("[data-chat-row]")].find((row) =>
				row.textContent?.trim().startsWith("Active chats"),
			),
		/** The ring itself, in the order `keyDown` walks it. */
		ring: () => [...document.querySelectorAll("[data-chat-row]")],
		/** ArrowDown/ArrowUp as the panel's own handler takes them. */
		press: async (key) => {
			const target = document.activeElement ?? document.body;
			await act(async () => {
				target.dispatchEvent(
					new DOM.window.KeyboardEvent("keydown", {
						key,
						bubbles: true,
					}),
				);
			});
		},
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

const PILE = [
	{
		session_id: SESSION,
		title: "Reconcile the supplier ledger",
		active: true,
		status: COMPLETE,
		attention: unread(SESSION),
	},
	{
		session_id: OTHER,
		title: "Quarterly revenue model",
		active: true,
		status: COMPLETE,
		attention: unread(OTHER),
	},
];

test("the control is a stop in the ↑/↓ walk, between the section and its first row", async () => {
	const harness = await mount(PILE);
	try {
		const toggle = harness.activeToggle();
		assert.ok(toggle, "the Active chats disclosure is not in the ring");
		const ring = harness.ring();
		const at = (element) => ring.indexOf(element);
		assert.equal(
			at(harness.control()),
			at(toggle) + 1,
			"the control is not the stop immediately after its own section's toggle",
		);
		// And ArrowDown really moves there rather than only the DOM order saying so.
		toggle.focus();
		await harness.press("ArrowDown");
		assert.equal(
			document.activeElement,
			harness.control(),
			"ArrowDown from the toggle did not land on the control",
		);
		await harness.press("ArrowDown");
		assert.equal(
			document.activeElement,
			ring[at(harness.control()) + 1],
			"ArrowDown from the control did not reach the first conversation row",
		);
	} finally {
		await harness.unmount();
	}
});

test("the control keeps focus and its ring stop for the whole request", async () => {
	/*
	 * UX round 1 (U2) measured the defect this pins: with `disabled` on the button,
	 * pressing Enter blurred it to `<body>` for the length of the request and the
	 * next Tab restarted from the top of the panel. The shipped control is
	 * `aria-disabled` with an ignored re-entry instead, so focus never moves and the
	 * ring is never shorter than the DOM being walked.
	 */
	const harness = await mount(PILE);
	try {
		let resolveAck;
		globalThis.__ack = (request) => {
			requests.push(request);
			held = new Promise((resolve) => {
				resolveAck = resolve;
			});
			return held;
		};
		requests = [];
		const control = harness.control();
		control.focus();
		await harness.click(control);
		assert.equal(
			document.activeElement,
			harness.control(),
			"focus left the control while the request was open",
		);
		assert.equal(
			harness.control()?.getAttribute("aria-disabled"),
			"true",
			"the in-flight control does not announce itself as unavailable",
		);
		assert.equal(
			harness.control()?.hasAttribute("disabled"),
			false,
			"`disabled` would blur the focused control and leave the ring a stop short",
		);
		assert.ok(
			harness.ring().includes(harness.control()),
			"the control is not a ring stop while the request is open",
		);
		assert.equal(requests.length, 1, "the click did not send the batch");
		// A second activation while the promise is open is ignored rather than
		// queued: one gesture, one request.
		await harness.click(harness.control());
		assert.equal(requests.length, 1, "a re-entry sent a second request");
		await act(async () => {
			resolveAck({ read: [], superseded: [SESSION, OTHER], unknown: [] });
			await held;
		});
		assert.equal(
			store.getState().sessions.filter((row) => row.attention?.unseen).length,
			2,
			"the refused batch cleared marks",
		);
	} finally {
		await harness.unmount();
	}
});

test("clearing the last mark hands focus to the section, not to <body>", async () => {
	/*
	 * The other half of U2: when the count reaches zero the control unmounts, and a
	 * focused element that unmounts drops focus to `<body>` — the next Tab then
	 * restarts at the search field, outside the list. The reader who just cleared
	 * the pile is handed to the section's own disclosure instead.
	 */
	const harness = await mount(PILE);
	try {
		serve({
			read: PILE.map((row) => ({
				...unread(row.session_id),
				unseen: false,
				revision: [4, 4],
			})),
			superseded: [],
			unknown: [],
		});
		assert.ok(harness.activeToggle(), "the section toggle is missing");
		const control = harness.control();
		control.focus();
		await harness.click(control);
		// The receipt is applied synchronously enough that the control is already
		// gone; the effect that moves focus runs on the commit that removes it.
		assert.equal(
			harness.control(),
			null,
			"the control is still rendered with nothing left to clear",
		);
		assert.equal(
			document.activeElement,
			harness.activeToggle(),
			"focus did not land on the section's own disclosure",
		);
		assert.notEqual(
			document.activeElement,
			document.body,
			"focus was left on <body>, so the next Tab leaves the list",
		);
	} finally {
		await harness.unmount();
	}
});

test("a foreground refusal reads as a refusal, not as an unreachable backend", async () => {
	/*
	 * QA round 1 (Q2), measured in the built app: a click from a window main will
	 * not accept — the operator's own rule, and the reason that pass could not
	 * click this control at all — came back to the reader as "Desktop controls
	 * could not reach the backend process." That is a false sentence about a
	 * backend that was answering, and it names the wrong next move: there is
	 * nothing to retry, the window is what has to come forward.
	 *
	 * The chain driven here is the app's, with only the preload bridge standing in
	 * for Electron's: a rejection carrying main's refusal (wrapped the way Electron
	 * wraps it, so the classifier is handed the shape it really meets) → the
	 * shipped transport's classification → the shipped control's receipt → the
	 * app's own toast container, read off the DOM. The transport step is the REAL
	 * one under a second name (`realDesktopResult`), because the stub the other
	 * cases use would answer with an error the app never produced — and therefore
	 * would not test the classification at all.
	 *
	 * The second half of the case is what makes the first half mean something: a
	 * genuine transport failure still reads as one, so the two are distinguishable
	 * rather than one sentence having replaced the other.
	 */
	const harness = await mount(PILE);
	const toastHost = document.createElement("div");
	document.body.append(toastHost);
	const toastRoot = createRoot(toastHost);
	await act(async () => {
		toastRoot.render(React.createElement(ThemedToastContainer));
	});
	/** Every sentence on screen, so the assertion does not depend on the DOM
	 *  shape sonner happens to use. */
	const notices = () => document.body.textContent ?? "";
	try {
		globalThis.__ack = (request) => realDesktopResult(request);
		/*
		 * Only the RECEIPT is refused, so the sidebar keeps the populated state the
		 * control lives in: a stub that refused everything would photograph this
		 * case's copy over the catalogue read's own error panel instead.
		 */
		window.api = {
			desktop: {
				request: (request) =>
					request.op === "attention.seen"
						? Promise.reject(
								new Error(
									`Error invoking remote method 'desktop-request': Error: ${DESKTOP_FOREGROUND_REQUIRED_MESSAGE}`,
								),
							)
						: Promise.resolve({
								status: 200,
								body: { result: { sessions: PILE, truncated: false } },
							}),
			},
		};
		await harness.click(harness.control());
		assert.match(notices(), /foreground/, "the refusal was not named");
		assert.doesNotMatch(
			notices(),
			/could not reach the backend process/,
			"a reachable backend was reported as unreachable",
		);
		assert.equal(
			store.getState().sessions.filter((row) => row.attention?.unseen).length,
			PILE.length,
			"a refused batch cleared marks",
		);

		// The distinction, on the same control: a real transport failure keeps the
		// sentence that is true of it, so the refusal's copy did not simply replace
		// this one.
		window.api = {
			desktop: {
				request: (request) =>
					request.op === "attention.seen"
						? Promise.reject(
								new Error(
									"Error invoking remote method 'desktop-request': Error: net::ERR_CONNECTION_REFUSED",
								),
							)
						: Promise.resolve({
								status: 200,
								body: { result: { sessions: PILE, truncated: false } },
							}),
			},
		};
		await harness.click(harness.control());
		assert.match(
			notices(),
			/could not reach the backend process/,
			"a transport failure lost its own sentence",
		);
	} finally {
		await act(async () => toastRoot.unmount());
		toastHost.remove();
		await harness.unmount();
	}
});
