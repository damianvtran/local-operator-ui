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
/*
 * THE FRAME LOOP THIS HARNESS OWNS, AND WHY IT QUEUES RATHER THAN RUNS.
 *
 * `toast.dismiss` does not remove a toast by itself: sonner's observer notifies its
 * subscribers from a `requestAnimationFrame`, and jsdom without `pretendToBeVisual`
 * has no frame at all - the globals promotion above assigns `undefined`, so the
 * receipt's own retirement threw `ReferenceError: requestAnimationFrame is not
 * defined` from inside a commit phase. jsdom's VISUAL frame is deliberately not
 * used: it is a real loop, and floating-ui's `autoUpdate` keeps one running for as
 * long as a tooltip trigger is mounted, which leaves the process holding a pending
 * frame so `node:test` never exits. The callbacks are QUEUED and a test asks for a
 * frame (`frame()`, inside `settleFrames`), which is `composer-tabs.test.mjs`'s own
 * answer to the same two facts.
 */
const queuedFrames = [];
globalThis.requestAnimationFrame = (callback) => {
	queuedFrames.push(callback);
	return queuedFrames.length;
};
globalThis.cancelAnimationFrame = () => {};
const frame = () => {
	for (const callback of queuedFrames.splice(0)) callback(0);
};
/**
 * One frame, three times over: the two state hops a dismissal takes - the store's
 * notify and the Toaster's render - plus the removal mark itself.
 */
const settleFrames = async () => {
	for (let round = 0; round < 3; round += 1) {
		await act(async () => {});
		await act(async () => frame());
	}
};
// jsdom implements no layout, so no scrolling: the panel's own effects would
// throw on the first render otherwise.
DOM.window.Element.prototype.scrollIntoView = () => {};
/*
 * jsdom ships no `ResizeObserver`, and the sidebar now needs one on every mount:
 * it measures its own column to derive the split's capacity, and the list region
 * is only sometimes mounted, so the observer is rebuilt when the layout changes
 * shape. A no-op is the honest stub here rather than a recording one - jsdom
 * computes no layout, so a case that wanted the capacity would be asserting
 * against zeroes it invented. The classes below are about the bulk-read
 * control, which never reads a height.
 */
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
/*
 * `useMediaQuery` is a `useSyncExternalStore` over `window.matchMedia`, and jsdom
 * implements none. The row's title now reads `prefers-reduced-motion` at mount
 * (the pan it gates is javascript rather than a stylesheet, so it has to ask),
 * which puts a media query on every row this fixture renders. Nothing matches -
 * the honest answer for a DOM with no such API, and this machine's own default
 * for that query - and the pan itself is never exercised here, because jsdom
 * dispatches no pointer. The stub is set on the jsdom window rather than on
 * `globalThis` for the reason the hooks read it there.
 */
DOM.window.matchMedia = (query) => ({
	media: query,
	matches: false,
	addEventListener: () => {},
	removeEventListener: () => {},
	dispatchEvent: () => false,
});

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
 * The two derived pairs a row that is NOT drawing a mark carries here, spelled the
 * way `CatalogEntry.status_code` publishes them: live state and a parked gate each
 * outrank an unread completion, so a row that is busy or waiting on the reader never
 * carries `complete`, however unread it is.
 */
const BUSY = { code: "busy", label: "Working" };
const APPROVAL = { code: "approval", label: "Approval needed" };

/**
 * The receipts each case stages, plus the request log the assertions read.
 *
 * `held` is a promise the case resolves by hand, which is how the in-flight
 * state is entered deterministically rather than by racing a timer.
 */
let held = null;
let requests = [];
const defaultAck = async (request) => {
	requests.push(request);
	return { read: [], superseded: [], unknown: [] };
};
const serve = (receipt) => {
	requests = [];
	globalThis.__ack = async (request) => {
		requests.push(request);
		return receipt;
	};
};
globalThis.__ack = defaultAck;

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
	"@shared/hooks/use-connectivity-status",
	/*
	 * The theme registry barrel, stubbed to the ONE constant the bundled graph
	 * reads from it.
	 *
	 * WHY THIS IS HERE AT ALL: the sidebar persists its split in
	 * `ui-preferences-store`, whose `DEFAULT_THEME` comes from the barrel, and the
	 * barrel imports every palette plus `base-theme`/`theme-provider`, which
	 * import `@mui/material/styles`. `packages: "external"` leaves that to Node,
	 * and Node refuses a directory import - `ERR_UNSUPPORTED_DIR_IMPORT` on
	 * `node_modules/@mui/material/styles` - so bundling the sidebar at all
	 * requires the barrel to be answered by this harness rather than by MUI. The
	 * constant is a default theme NAME and nothing here asserts on it: the real
	 * default is `localOperatorDark` in `shared/themes/index.ts`, and this keeps
	 * the store itself real rather than faking the thing under test.
	 */
	"@shared/themes",
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
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled, desktopFeatureState} from ${JSON.stringify(
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
	/*
	 * The sidebar's status read is stubbed like the rest of the surfaces' data - it
	 * is where main's pairing record arrives (`DaemonStatusSnapshot.pairing`), and
	 * these cases are about the control's own copy, not about the record. Without
	 * this stub the graph pulls the real hook, and with it the renderer's config
	 * module and a `backend-error` export the stub below does not carry: measured as
	 * a build failure rather than a failing assertion.
	 */
	"@shared/hooks/use-connectivity-status":
		"export const useServerHealth = () => ({ data: { online: true, snapshot: null } });",
	"@shared/api/local-operator/backend-error":
		"export const compatibilityBannerShown = () => false;",
	"react-router-dom": "export const useNavigate = () => () => undefined;",
	"@shared/themes": `export const DEFAULT_THEME = "localOperatorDark";`,
	"@shared/hooks/use-canonical-session": `export const echoPendingUser = () => undefined;
export const retractPendingUser = () => undefined;
export const retractLocalEcho = () => "retracted";
export const peekLocalEcho = () => "unseen";
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
			 * THE WORDS THEMSELVES, from the module that owns them, the REFUSAL CLASS the
			 * receipt's sentence is keyed on, and SONNER's own `toast` object: the
			 * receipt's announcement is asserted where it is COMPOSED and where it is
			 * REQUESTED, not only where it is painted (QA round 2's Q2-2 - sonner's paint
			 * in jsdom is asynchronous, so a case that reads it straight after the publish
			 * passes on ordering rather than on the fact).
			 */
			' export { readAckNoticeSentence, READ_ACK_NOTICE_CLAUSE, READ_ACK_NOTICE_DESCRIPTION } from "./src/renderer/src/features/chat/read-ack-notice";' +
			' export { DesktopControlError } from "@shared/api/local-operator/desktop-api";' +
			' export { toast as sonnerToast } from "sonner";' +
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
	readAckNoticeSentence,
	READ_ACK_NOTICE_DESCRIPTION,
	DesktopControlError,
	sonnerToast,
	DESKTOP_FOREGROUND_REQUIRED_CODE,
	DESKTOP_FOREGROUND_REQUIRED_MESSAGE,
	QueryClient,
	QueryClientProvider,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/*
 * WHAT THE LANE WAS ASKED TO SAY, rather than what it has finished painting.
 *
 * Sonner paints through its own portal on its own schedule - in this jsdom harness
 * a message read immediately after the publish was absent in three runs of four -
 * so a case that only reads the DOM is asserting a race it happens to win. These
 * record the CALLS the panel makes on the shipped `toast` object (a monkey patch on
 * the object the app's own `showWarningToast`/`dismissToast` hold, which is the
 * same module instance this bundle resolved), and the cases assert BOTH halves: the
 * call, synchronously, and the paint, by waiting for the sentence to arrive or
 * leave. QA round 2, Q2-2 named exactly this shape.
 */
const toastCalls = { warnings: [], dismissals: [] };
const originalWarning = sonnerToast.warning;
const originalDismiss = sonnerToast.dismiss;
sonnerToast.warning = (message, options) => {
	const id = originalWarning.call(sonnerToast, message, options);
	toastCalls.warnings.push({ id, message, options });
	return id;
};
sonnerToast.dismiss = (id) => {
	toastCalls.dismissals.push(id);
	return originalDismiss.call(sonnerToast, id);
};

/**
 * Wait until a sentence is in the lane, bounded by the EVENT and not by a sleep.
 *
 * The bound is generous because the host this runs on carries a fleet: what it may
 * not be is a fixed sleep, which would pass on a quiet machine and fail on a busy
 * one - the shape QA round 1's Q1 recorded against `flyoutLines`. A toast that has
 * been retired is still IN the document with `data-removed="true"` until sonner's
 * exit animation ends, and jsdom runs no animations, so the lane is read as the
 * toasts that are still LIVE - `composer-tabs.test.mjs`'s own rule for the same
 * channel.
 */
const liveToasts = () =>
	[...document.querySelectorAll("[data-sonner-toast]")].filter(
		(node) => node.getAttribute("data-removed") !== "true",
	);
const laneText = () =>
	liveToasts()
		.map((node) => node.textContent ?? "")
		.join(" ");
const waitForSentence = async (message) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (laneText().includes(message)) return true;
		await settleFrames();
	}
	return false;
};

/** The same wait, for a sentence that has been retired and must leave the lane. */
const waitForGone = async (message) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (!laneText().includes(message)) return true;
		await settleFrames();
	}
	return false;
};

/**
 * The row's FLYOUT, read from the mounted row - the pointer channel, since the
 * row-space change deleted the native `title` attribute it used to be (design D7).
 *
 * The facts are the app's own `Tooltip` content now, and Radix mounts that in a
 * portal only while it is OPEN, so the read opens it the way a keyboard user does:
 * focus the row, let the primitive commit, then read the two lines it draws - the
 * title (with its binding) and the status line whose tail these cases are about.
 * Read as LINES rather than as one string because the flyout draws two `block`
 * spans: their textContent concatenates with no separator between them, and a
 * single-string read would compare `ledgerUnseen` against `ledger Unseen`.
 */
async function flyoutLines(button) {
	if (!button) return null;
	button.dispatchEvent(new DOM.window.FocusEvent("focusin", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 40));
	const tip = document.querySelector('[role="tooltip"]');
	if (!tip) return null;
	return [...tip.children].map((line) => line.textContent?.trim() ?? "");
}

/**
 * The ring, named for a failure message. A bare count ("2 !== 0") says neither
 * which stops preceded the control nor that the count moved with a change
 * somewhere else in the sidebar, so a red run here prints what the walk held:
 * each stop's hook - its tour tag, section key, draft key or session id - or a
 * slice of its text for anything with no hook at all.
 */
const describeRing = (ring) =>
	ring
		.map((element, index) => {
			const hook =
				element.getAttribute("data-tour-tag") ??
				element.getAttribute("data-chat-section") ??
				element.getAttribute("data-draft-row") ??
				element
					.closest("[data-session-row]")
					?.getAttribute("data-session-row") ??
				element.textContent?.trim().slice(0, 24) ??
				element.tagName.toLowerCase();
			return `${index}:${hook}`;
		})
		.join(", ");

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
		/**
		 * The section's LABEL row — the element above the control in the panel.
		 *
		 * It is not a disclosure any more (§C1; design round 1, D1/U22: a heading a
		 * press can collapse is the accident the operator reported), so it is not a
		 * `[data-chat-row]` stop and it cannot be focused. What is left of the old
		 * pair is the control's place in the ring, which is what the test below
		 * asserts against the rows themselves.
		 */
		sectionLabelRow: () =>
			document.querySelector("[data-chat-section] > div") ?? null,
		/**
		 * The control's own section's FIRST conversation row - the stop the walk
		 * boundary is about.
		 *
		 * Read from the control's `[data-chat-section]` rather than from the ring's
		 * index 1, which was the old spelling: index 1 is the walk's second stop
		 * OVERALL, and it stops being this row the moment any other region of the
		 * sidebar contributes a stop above the list (it currently contributes two -
		 * the Agents and Teams entity disclosures). The first `[data-chat-row]` in
		 * the section after the control is the row the boundary is made of,
		 * wherever the walk's earlier stops move to.
		 */
		sectionFirstRow: () => {
			const control = walkTo("mark-all-read");
			const section = control?.closest("[data-chat-section]");
			if (!section) return null;
			return (
				[...section.querySelectorAll("[data-chat-row]")].find(
					(row) => row !== control,
				) ?? null
			);
		},
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

test("the control is a stop in the ↑/↓ walk, before the section's first row", async () => {
	/*
	 * THE CONTRACT IS ABOUT THE WALK, NOT ABOUT A COUNT. The tight form this
	 * replaces (`indexOf(control) === 0`) measured the stops OTHER regions of the
	 * sidebar put in front of the list: it fails on plain `origin/main` (control
	 * at 5), and the same count moved under our own section-header work - each
	 * time reading as a failure of this control rather than of the layout above
	 * it. What the finding (agent review R2, UX round 1 U2) is about: the control
	 * IS a stop in the ↑/↓ walk, and it precedes the section's own first
	 * conversation row, which one ArrowDown from it lands on. Presence plus
	 * order, so a walk re-based around the control fails HERE by name while a
	 * stop added elsewhere in the sidebar cannot.
	 *
	 * OPEN QUESTION, RECORDED RATHER THAN ACTED ON: whether the entity
	 * disclosures above the list - which are what puts the control at 2 rather
	 * than at 0 today - belong in this ring at all (they are destinations, not
	 * chat rows). Moving them is a walk-wide decision with its own review to
	 * run, so it is recorded and not taken here.
	 */
	const harness = await mount(PILE);
	try {
		assert.ok(harness.sectionLabelRow(), "the section label is missing");
		const ring = harness.ring();
		const control = harness.control();
		const controlIndex = ring.indexOf(control);
		assert.ok(
			controlIndex >= 0,
			`the control is not a stop in the ↑/↓ walk at all - it carries no \`data-chat-row\`, so no arrow press can land on it. The ring was ${describeRing(ring)}`,
		);
		const firstRow = harness.sectionFirstRow();
		assert.ok(
			firstRow,
			"the ring holds no conversation row in the control's own section, so the walk below proves nothing",
		);
		const firstRowIndex = ring.indexOf(firstRow);
		assert.ok(
			controlIndex < firstRowIndex,
			`the control does not precede its section's first row (control at ${controlIndex}, first row at ${firstRowIndex}). The ring was ${describeRing(ring)}`,
		);
		// And ArrowDown really moves there rather than only the DOM order saying so.
		control.focus();
		await harness.press("ArrowDown");
		assert.equal(
			document.activeElement,
			firstRow,
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
	let resolveAck;
	let heldAck;
	try {
		globalThis.__ack = (request) => {
			requests.push(request);
			heldAck = new Promise((resolve) => {
				resolveAck = resolve;
			});
			held = heldAck;
			return heldAck;
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
			/*
			 * The held transport is one-shot. Restore a resolving responder before its
			 * completion can trigger a coalesced catalogue read, so that read cannot join
			 * another never-resolving copy of this mock.
			 */
			globalThis.__ack = defaultAck;
			await heldAck;
		});
		assert.equal(
			store.getState().sessions.filter((row) => row.attention?.unseen).length,
			2,
			"the refused batch cleared marks",
		);
	} finally {
		// Also release the one-shot request if an assertion failed before its normal completion.
		globalThis.__ack = defaultAck;
		if (resolveAck && heldAck) {
			resolveAck({ read: [], superseded: [], unknown: [] });
			await heldAck;
		}
		held = null;
		await harness.unmount();
	}
});

test("clearing the last mark hands focus to the list, not to <body>", async () => {
	/*
	 * The other half of U2: when the count reaches zero the control unmounts, and a
	 * focused element that unmounts drops focus to `<body>` — the next Tab then
	 * restarts at the top of the document, outside the list. The reader who just
	 * cleared the pile is handed to the list's first row instead, which is the stop
	 * the control sat in front of.
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
		/*
		 * The stop the control sat in front of - the section's own first conversation
		 * row, read the way the walk case above reads it. The app's own hand-off
		 * targets exactly this element: the first `[data-chat-row]` of the list
		 * panel once the control has unmounted.
		 */
		const firstRow = harness.sectionFirstRow();
		assert.ok(firstRow, "the list's first conversation row is missing");
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
			firstRow,
			"focus did not land on the list's first row",
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

test("the row tooltip's `, unread` tail follows the mark the row draws, not `unseen`", async () => {
	/*
	 * THE THIRD VISIBLE SURFACE: the row's own flyout. It was a native `title`
	 * attribute when this test was written and the row-space change deleted that
	 * attribute (design D7), so the read now opens the app's tooltip - see
	 * `flyoutLines` - and the tail it composes is unchanged: `chat-sidebar.tsx`
	 * derives it from `unreadMarkKind`, so a row that is busy or parked on a gate —
	 * carrying `unseen` and a token, with nothing drawn — must not claim ", unread".
	 * That is a REMOVAL of copy from the channel the operator's own report reaches by
	 * hovering, which is exactly the kind of edit a reviewer should be able to run
	 * rather than take on trust (design D2).
	 *
	 * One roster, three rows, the same attention state, differing only in the derived
	 * pair the backend published: the pair is what decides, so the mark row and the
	 * two no-mark rows are asserted together.
	 */
	const NESTED = "c3d4e5f6a7b8";
	/*
	 * THE ROSTER IS STAGED THROUGH THE APP'S OWN READ as well as the store. The
	 * sidebar issues a `sessions.list` on mount, and the stub answers EVERY op with
	 * the bulk receipt by default — so a case that only calls `mount` gets its roster
	 * REPLACED by one junk row (measured: `session_id null`, `title null`) before a
	 * title can be read. Answering the read with the same rows is what every other
	 * case here that reads rendered row text does.
	 */
	const rows = [
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
			status: BUSY,
			attention: unread(OTHER),
		},
		{
			session_id: NESTED,
			title: "Migrate the deploy script",
			active: true,
			status: APPROVAL,
			attention: unread(NESTED),
		},
	];
	globalThis.__ack = (request) =>
		request.op === "sessions.list"
			? Promise.resolve({
					status: 200,
					body: { result: { sessions: rows, truncated: false } },
				})
			: Promise.resolve({ read: [], superseded: [], unknown: [] });
	const harness = await mount(rows);
	try {
		const titleOf = async (name) =>
			(
				await flyoutLines(
					harness.ring().find((row) => row.textContent?.includes(name)),
				)
			)?.join(" | ") ?? null;
		// The mark: the level is named, because the row is drawing it.
		assert.equal(
			await titleOf("Reconcile the supplier ledger"),
			"Reconcile the supplier ledger | Unseen completion, unread",
		);
		// The spinner and the gate: `unseen` is true on both, and neither says it.
		assert.equal(
			await titleOf("Quarterly revenue model"),
			"Quarterly revenue model | Working",
		);
		assert.equal(
			await titleOf("Migrate the deploy script"),
			"Migrate the deploy script | Approval needed",
		);
	} finally {
		await harness.unmount();
	}
});

/*
 * THE STORE'S OWN ERROR VALUE, which is where the daemon's prose used to become
 * this app's diagnosis (review round 2 U1/D14, and round 3's note that the fix was
 * credited to a test that does not cover it).
 *
 * The window measured in the built app was 18.3 s, and its shape was: a re-pair
 * replaces the daemon, the app's catalogue read is refused with the NEW daemon's
 * 503 prose, and the sidebar and the pane render the stored `error` verbatim. So
 * the assertion is on the VALUE the store stores - not on a frame, and not on the
 * transport in isolation.
 */
test("the store composes the refusal's own sentence instead of storing the server's", async () => {
	try {
		const prose =
			"Desktop controls require a backend started by the desktop app.";
		window.api = {
			desktop: {
				/*
				 * A DesktopControlError, because that is what the transport throws for a
				 * refusal: the store keeps the message of anything else (its own "Unknown
				 * session." is not a refusal), so a plain Error here would test the wrong
				 * branch.
				 */
				request: () => Promise.reject(new DesktopControlError(503, prose)),
			},
		};
		await store.getState().fetchSessions({ silent: true });
		const stored = store.getState().error;
		assert.ok(stored, "a refused catalogue read must store an error");
		assert.doesNotMatch(
			String(stored),
			/started by the desktop app/,
			"the server's own sentence about itself is not this app's diagnosis",
		);
		assert.doesNotMatch(String(stored), /503|request failed/);
		/*
		 * THE OTHER HALF LIVES IN `session-switch`, and deliberately: a rejection at
		 * the BRIDGE is turned into a transport error by the client before the store
		 * ever sees it, so a domain error cannot be produced from here. What proves
		 * the distinction is the pair of suites together - a `DesktopControlError`
		 * composed into our sentence here, and a domain error keeping its own
		 * ("Unknown session.") in `session-switch`'s three cases, which failed when
		 * `storeErrorMessage` was not there.
		 */
	} finally {
		window.api = undefined;
	}
});

test("a not-answering row's remedy is reachable by focus, and only on that row", async () => {
	const SILENT = "d4e5f6a7b8c9";
	const FAILED = "e5f6a7b8c9d0";
	const rows = [
		{
			session_id: SILENT,
			title: "Quiet owner (stale beat)",
			active: true,
			status: {
				code: "wedged",
				label: "Not answering · process alive (last heartbeat 4m ago)",
			},
		},
		{
			session_id: FAILED,
			title: "Failed turn",
			active: true,
			status: { code: "error", label: "Failed" },
		},
	];
	/*
	 * Staged through the app's own read as well as the store: the sidebar issues
	 * `sessions.list` on mount and the stub answers every other op with the bulk
	 * receipt, so a case that only calls `mount` gets its roster replaced by one
	 * junk row before an attribute can be read.
	 */
	globalThis.__ack = (request) =>
		request.op === "sessions.list"
			? Promise.resolve({
					status: 200,
					body: { result: { sessions: rows, truncated: false } },
				})
			: Promise.resolve({ read: [], superseded: [], unknown: [] });
	const harness = await mount(rows);
	try {
		const row = (name) =>
			harness.ring().find((element) => element.textContent?.includes(name));
		const silent = row("Quiet owner (stale beat)");
		const failed = row("Failed turn");
		assert.ok(silent, "the not-answering row did not render");
		assert.ok(failed, "the failed row did not render");
		// The pointer channel: the composed flyout ends with the clause, so the row
		// itself still carries it where a pointer lands.
		assert.match(
			(await flyoutLines(silent))?.at(-1) ?? "",
			/· \/stop if it stays silent\.$/,
		);
		// The keyboard channel: the row POINTS at the sentence, which is what
		// makes it announced on focus when the name is read.
		const id = silent.getAttribute("aria-describedby");
		assert.ok(id, "the not-answering row points at no remedy");
		const clause = document.getElementById(id);
		assert.ok(
			clause,
			`aria-describedby names "${id}", which rendered nothing — a description that resolves to nothing is worse than none`,
		);
		assert.equal(clause.textContent, "/stop if it stays silent.");
		assert.ok(
			clause.textContent && !clause.textContent.includes("·"),
			"the description kept the tooltip's separator, which is read aloud as punctuation",
		);
		/*
		 * AND THE TARGET IS OUTSIDE THE ROW, which is the half that decides whether the
		 * clause is ALSO in the accessible name (review round 2's MAJOR 2, measured in
		 * Chromium's tree by all four roles). A button takes its name from its contents,
		 * so an `sr-only` span inside it is collected into the name as well as pointed at
		 * by the description — the reader heard the advice twice, and the name stopped
		 * being the state's sentence. This harness has no accessibility tree, so it
		 * asserts the STRUCTURAL fact the property rests on rather than the property:
		 * the named element is not a descendant of the named element's owner. The tree
		 * reading itself is in the round's evidence, and `directory-indicator.tsx` places
		 * its own sentence the same way.
		 */
		assert.equal(
			silent.querySelector(`#${id}`),
			null,
			"the remedy is inside the row button, so name-from-content collects it into the accessible name as well",
		);
		assert.ok(
			silent.parentElement?.querySelector(`#${id}`),
			"the remedy is not beside the row either — `aria-describedby` resolves by id, so it has to render somewhere",
		);
		// The control: the state next door offers no stop.
		assert.equal(failed.getAttribute("aria-describedby"), null);
		assert.doesNotMatch(failed.getAttribute("title") ?? "", /\/stop/);
	} finally {
		globalThis.__ack = undefined;
		await harness.unmount();
	}
});

test("the give-up sentence is this app's own, keyed on the class of refusal", () => {
	/*
	 * DESIGN ROUND 1's D1 (UX round 2's U3 reached the same defect from the code
	 * path), asserted at the composer rather than in a frame - this is the half a
	 * frame cannot check, because a frame shows one arm and this is the rule all of
	 * them follow.
	 *
	 * The sentence used to open with the refusal painted verbatim through
	 * `userFacingMessage`, and the refusal is the store ladder's copy, written for
	 * whichever caller the store serves: the contention arm ends "Try again in a
	 * moment", and the full-volume arm is an instruction about a volume (the receipt
	 * route composes its own, `receipts_refusal` in the sibling's
	 * `desktop_sessions.py`) beside this app's own instruction. Rendered: two
	 * instructions per toast, up to 248 characters and six lines.
	 *
	 * WHAT REPLACES IT SAYS WHICH CLASS OF REFUSAL THE APP MET, and the classes are
	 * the transport's - not the prose's (agent review round 3, MAJOR 1). The
	 * refusals below are the BACKEND's own recorded literals for the store arms
	 * (`scripts/store-refusal-copy.mjs` pins the send path's, which is the same
	 * classifier the receipt route keys on) and the app's OWN sentences for the two
	 * arms where no store was reached: a dead preload bridge and a backend that has
	 * no `sessions.seen` both raise a `DesktopControlError` of the same shape, and
	 * filing either as a store refusal made this panel state a cause it never met.
	 */
	const sentence = (reason) =>
		readAckNoticeSentence({
			sessionId: SESSION,
			kind: "unsettled",
			revision: 1,
			reason,
		});
	const busy = sentence(
		new DesktopControlError(
			503,
			"Read state is busy right now, so nothing was written. Try again in a moment.",
			undefined,
			"store_busy",
		),
	);
	const outOfSpace = sentence(
		new DesktopControlError(
			507,
			"This computer is out of disk space, so nothing was written. Free some space on the volume holding /Users/example/Library/Application Support/local-operator, then try again.",
			undefined,
			"store_out_of_space",
		),
	);
	const unavailable = sentence(
		new DesktopControlError(
			500,
			"The session store could not be read or written.",
			undefined,
			"store_unavailable",
		),
	);
	// THE TRANSPORT'S OWN REFUSALS, with no store code and no store reached. Both
	// shapes are the app's own copy, taken from the sites that raise them
	// (`desktop-api.ts`): the IPC/fetch/deadline arm carries no status, and an
	// incompatible backend carries one.
	const unreachable = sentence(
		new DesktopControlError(
			null,
			"Desktop controls could not reach the backend process.",
		),
	);
	const incompatible = sentence(
		new DesktopControlError(
			400,
			"Desktop controls need a compatible backend connection.",
		),
	);
	// The hook's own arm: a 200 whose body did not settle the completion reaches
	// `unresolved` with a reason no transport produced.
	const unreported = sentence(
		new Error("answer did not settle the rendered completion"),
	);
	assert.equal(
		busy,
		"The read state is busy, so the unread mark was not cleared. Click the chat to try again.",
	);
	assert.equal(
		outOfSpace,
		"The read state could not be written, so the unread mark was not cleared. Click the chat to try again.",
	);
	assert.equal(unavailable, outOfSpace);
	assert.equal(
		unreachable,
		"Desktop controls could not reach the backend process. The unread mark was not cleared. Click the chat to try again.",
	);
	assert.equal(
		incompatible,
		"Desktop controls need a compatible backend connection. The unread mark was not cleared. Click the chat to try again.",
	);
	assert.equal(
		unreported,
		"The unread mark was not cleared. Click the chat to try again.",
	);
	/*
	 * THE RULE MAJOR 1 FILED: a refusal the store never saw may not be drawn as the
	 * store refusing. This is the assertion that fails on the classification that
	 * gated `refused` on "not `store_busy`" - the transport raises both of these by
	 * construction, and a stalled backend or an old one ends in that toast with the
	 * unread completion's mark still on the row.
	 */
	for (const one of [unreachable, incompatible]) {
		assert.doesNotMatch(
			one,
			/read state could not be written/i,
			`a refusal the store never saw was drawn as the store refusing: ${one}`,
		);
	}
	/*
	 * And the properties every arm shares: ONE instruction, the state named once,
	 * and not one word of the store ladder's copy - which is what the store arms and
	 * the unreported arm must also be free of, including the word "backend", since
	 * none of them can see one.
	 */
	for (const one of [busy, outOfSpace, unreported]) {
		assert.equal(
			(one.match(/try again/gi) ?? []).length,
			1,
			`more than one instruction in: ${one}`,
		);
		assert.match(one, /unread mark was not cleared\./);
		assert.doesNotMatch(
			one,
			/It will catch up on its own|Try again in a moment|send it again|disk space|the message|backend|Free some space/i,
			`the refusal's own words were re-emitted: ${one}`,
		);
	}
	for (const one of [unreachable, incompatible]) {
		assert.equal(
			(one.match(/try again/gi) ?? []).length,
			1,
			`more than one instruction in: ${one}`,
		);
		assert.match(one, /unread mark was not cleared\./);
		assert.doesNotMatch(
			one,
			/read state|Free some space|disk space|the message/i,
			`a store's words reached a refusal the store never saw: ${one}`,
		);
	}
});
test("the receipt's own state is drawn on its own row, and the give-up arm is announced once", async () => {
	/*
	 * UX round 1's U1 and U2, on the PANEL's half of the fix. The loop that knows
	 * what the receipt is doing lives in the transcript
	 * (`useCompletionView`, asserted in `scripts/completion-view-ack.test.mjs`);
	 * what this case drives is where the operator meets it - the row's flyout
	 * clause, the `sr-only` sentence its `aria-describedby` names (the keyboard
	 * channel, and the one the receipt's copy did not have at all), and the single
	 * announcement the give-up arm makes in the panel's own toast lane.
	 *
	 * Read through the SHIPPED row and the SHIPPED toast container: the states are
	 * staged the way the loop stages them (`readAckNotice` is one record on the
	 * store), so what is asserted is the rendering the app ships for them.
	 */
	globalThis.__ack = (request) =>
		request.op === "sessions.list"
			? Promise.resolve({
					status: 200,
					body: { result: { sessions: PILE, truncated: false } },
				})
			: Promise.resolve({ read: [], superseded: [], unknown: [] });
	const harness = await mount(PILE);
	const toastHost = document.createElement("div");
	document.body.append(toastHost);
	const toastRoot = createRoot(toastHost);
	await act(async () => {
		toastRoot.render(React.createElement(ThemedToastContainer));
	});
	/*
	 * THIS CASE'S OWN CALLS, cleared so the earlier cases' toasts cannot be counted
	 * here: the recorder is module-level because the patch is on the shipped `toast`
	 * object, and every case in this file that raises one clears it first.
	 */
	toastCalls.warnings.length = 0;
	toastCalls.dismissals.length = 0;
	const warnings = toastCalls.warnings;
	const dismissals = toastCalls.dismissals;
	/** The state the loop publishes, staged exactly as it publishes it. */
	const publish = async (kind, revision, reason) => {
		await act(async () => {
			store.setState({
				readAckNotice: { sessionId: SESSION, kind, revision, reason },
			});
		});
	};
	try {
		/**
		 * The row's flyout lines for the CURRENT state.
		 *
		 * `flyoutLines` sleeps a fixed 40 ms and reads the first `[role="tooltip"]` in
		 * the document, which on a busy host is the previous row's tooltip - the flake
		 * QA round 1 recorded against it, and the reason this case reads one row three
		 * times with the flyout CLOSED in between (the primitive keeps any other open
		 * tooltip's content mounted while it opens a new one, so a second read without
		 * this would compare the previous state's sentence). It waits for the event
		 * rather than for the clock: the tooltip whose own text names the row.
		 */
		const receiptFlyout = async (button, title) => {
			button.dispatchEvent(
				new DOM.window.FocusEvent("focusout", { bubbles: true }),
			);
			await new Promise((resolve) => setTimeout(resolve, 60));
			for (let attempt = 0; attempt < 40; attempt += 1) {
				button.dispatchEvent(
					new DOM.window.FocusEvent("focusin", { bubbles: true }),
				);
				await new Promise((resolve) => setTimeout(resolve, 50));
				const tip = [...document.querySelectorAll('[role="tooltip"]')].find(
					(element) => element.textContent?.includes(title),
				);
				if (tip) {
					return [...tip.children].map(
						(line) => line.textContent?.trim() ?? "",
					);
				}
			}
			return null;
		};

		const row = harness
			.ring()
			.find((element) =>
				element.textContent?.includes("Reconcile the supplier ledger"),
			);
		const other = harness
			.ring()
			.find((element) =>
				element.textContent?.includes("Quarterly revenue model"),
			);
		assert.ok(row && other, "the rows did not render");

		// IN FLIGHT: the mark stays and the clause says the receipt is being tried.
		await publish("pending", 1);
		assert.match(
			(await receiptFlyout(row, "Reconcile the supplier ledger"))?.at(-1) ?? "",
			/marking read$/,
			"the in-flight cue is not on the row",
		);
		// The other conversation is told nothing at all: no clause on its flyout,
		// and nothing for its description to name.
		assert.equal(
			other.getAttribute("aria-describedby"),
			null,
			"another conversation was handed this receipt's clause",
		);
		assert.equal(
			warnings.length,
			0,
			"an in-flight receipt was announced as a failure",
		);

		// THE PRESS THAT CANNOT SUCCEED: the reason, and the move that works.
		await publish("offscreen", 2);
		assert.match(
			(await receiptFlyout(row, "Reconcile the supplier ledger"))?.at(-1) ?? "",
			/· scroll to the result to mark this chat read$/,
			"the off-screen refusal is not named on the row",
		);
		const id = row.getAttribute("aria-describedby");
		assert.ok(id, "the row points at no receipt clause");
		const clause = document.getElementById(id);
		assert.ok(
			clause,
			`aria-describedby names "${id}", which rendered nothing - a description that resolves to nothing is worse than none`,
		);
		assert.equal(
			clause.textContent,
			"Scroll to the result to mark this chat read.",
		);
		assert.ok(
			row.parentElement?.querySelector(`#${id}`),
			"the clause is not rendered outside the row, so it is collected into its name",
		);

		/*
		 * THE GIVE-UP ARM.
		 *
		 * The row's clause is the REMEDY ALONE (design round 1, D2). The state is on
		 * the same line four words earlier - the mark glyph and the `, unread` tail
		 * are both drawn from `unreadMarkKind` - so a clause spelling "not marked
		 * read" beside it is the same fact twice, and `SILENT_REMEDY`, the clause
		 * this one is shaped after, carries the remedy and nothing else.
		 *
		 * The description is a SENTENCE OF ITS OWN (D4): `aria-describedby` may name
		 * two elements and the browser joins them with a single space, so the clause
		 * form read as one utterance when a wedged row's remedy came first.
		 */
		await publish("unsettled", 3, new Error("the store refused"));
		assert.match(
			(await receiptFlyout(row, "Reconcile the supplier ledger"))?.at(-1) ?? "",
			/· click the chat to try again$/,
			"the deferred state is not named on the row",
		);
		assert.doesNotMatch(
			(await receiptFlyout(row, "Reconcile the supplier ledger"))?.at(-1) ?? "",
			/not marked read/,
			"the clause restates the row's own `, unread` flag instead of naming the remedy",
		);
		const deferredId = row.getAttribute("aria-describedby");
		assert.ok(deferredId, "the row points at no receipt clause");
		assert.equal(
			document.getElementById(deferredId)?.textContent,
			"Not marked read. Click the chat to try again.",
			"the description is not a sentence of its own, so a composed description runs on",
		);
		for (const description of Object.values(READ_ACK_NOTICE_DESCRIPTION)) {
			assert.match(
				description,
				/^[A-Z].*\.$/,
				`a description that is not a sentence: ${description}`,
			);
		}

		/*
		 * THE ANNOUNCEMENT, ASSERTED WHERE IT IS REQUESTED (QA round 2, Q2-2: sonner's
		 * jsdom paint is asynchronous, so reading the lane immediately after the
		 * publish passes on ordering rather than on the fact).
		 *
		 * One warning call, carrying the sentence this app COMPOSED for the state -
		 * read back off the module rather than spelled out here, so a rewording cannot
		 * leave the case asserting yesterday's words - and carrying this lane's own
		 * lifetime rather than sonner's four-second default (design round 1, D3: the
		 * longest sentence in the panel had the shortest life of anything in its lane,
		 * while the archive offers one control away already arm eight and ten seconds
		 * for exactly this shape).
		 */
		assert.equal(
			warnings.length,
			1,
			"the give-up arm was not announced exactly once",
		);
		assert.equal(
			warnings[0].message,
			readAckNoticeSentence({
				sessionId: SESSION,
				kind: "unsettled",
				revision: 3,
				reason: new Error("the store refused"),
			}),
			"the announcement is not the sentence this app composes for an unreported refusal",
		);
		assert.equal(
			warnings[0].options?.duration,
			10_000,
			"the give-up announcement did not take the lane's own lifetime",
		);
		// AND IT PAINTS: the half that goes through sonner, read by waiting for the
		// sentence rather than by reading straight after the publish.
		assert.ok(
			await waitForSentence(warnings[0].message),
			"the composed sentence never reached the lane",
		);
		// The same statement seen again - a re-render, or the loop's next tick - is
		// not a second event.
		await act(async () => {
			store.setState({ sessions: [...store.getState().sessions] });
		});
		assert.equal(
			warnings.length,
			1,
			"the same receipt statement was announced twice",
		);

		/*
		 * AND THE SENTENCE GOES WHEN THE FACT DOES (UX round 2, U4).
		 *
		 * The reader presses the row this sentence names; the receipt lands on the next
		 * tick; `clearNotice` retires the row's clause and the mark clears - and the
		 * announcement, which said the mark was NOT cleared, went on saying it. The
		 * retirement is asserted at the call (the id the warning returned) AND in the
		 * lane, because those are two different failures: a sentence dismissed but
		 * never painted, and one painted but never dismissed.
		 */
		await act(async () => {
			store.setState({ readAckNotice: null });
		});
		// The lane's id, and it is the LAST dismissal: the effect dismisses this
		// id on every pass that finds no standing sentence, because the id is the
		// lane's rather than this instance's and dismissing an id nothing is using
		// is a no-op (round 3's MINOR 1 is the shape that made that necessary).
		assert.equal(
			dismissals.at(-1),
			warnings[0].id,
			"the give-up announcement was not retired when the receipt landed",
		);
		assert.ok(
			await waitForGone(warnings[0].message),
			"the retired sentence is still in the lane",
		);
		assert.equal(
			row.getAttribute("aria-describedby"),
			null,
			"the row still describes a receipt that has landed",
		);
	} finally {
		globalThis.__ack = undefined;
		await act(async () => toastRoot.unmount());
		toastHost.remove();
		await harness.unmount();
	}
});

test("a remount cannot leave the receipt's sentence standing", async () => {
	/*
	 * UX round 3's U7, which is agent review round 3's MINOR 1 seen from the flow:
	 * the give-up sentence lives in the app-level lane and outlives any one panel
	 * mount, and the id it was raised under used to live in a component ref. A route
	 * change off `/chat` and back (or a remount by the region controls) gave the panel
	 * a fresh ref while the sentence stood, and the fresh instance's "the fact has
	 * gone" branch was a no-op - so nothing left in the app could retire a sentence
	 * that says the mark was not cleared, after the mark cleared.
	 *
	 * The id is the LANE'S now (one constant, `READ_ACK_TOAST_ID`, the shape the
	 * archive lane in the same file uses), so the dismissal needs no handle and any
	 * instance can make it. What this case asserts is the CALL and the id it carries,
	 * which is exactly what the ref shape could not produce - no dismissal call at all
	 * after a remount. The lane's pixels for the raise-and-retire path are asserted in
	 * the case above, where the container that receives the toast is the one this file
	 * mounted; this case deliberately owns no lane, because a later case cannot rely on
	 * being the container sonner routes to.
	 */
	globalThis.__ack = (request) =>
		request.op === "sessions.list"
			? Promise.resolve({
					status: 200,
					body: { result: { sessions: PILE, truncated: false } },
				})
			: Promise.resolve({ read: [], superseded: [], unknown: [] });
	toastCalls.warnings.length = 0;
	toastCalls.dismissals.length = 0;
	const warnings = toastCalls.warnings;
	const dismissals = toastCalls.dismissals;
	const first = await mount(PILE);
	const second = { unmount: async () => undefined };
	try {
		// The give-up arm, raised on the first instance - the notice is cleared first,
		// because the store's publish is identity-preserving on an unchanged
		// (session, kind) pair and a case earlier in this file can leave that pair
		// standing.
		await act(async () => {
			store.setState({ readAckNotice: null });
		});
		await act(async () => {
			store.setState({
				readAckNotice: {
					sessionId: SESSION,
					kind: "unsettled",
					revision: 1,
					reason: new Error("the store refused"),
				},
			});
		});
		assert.equal(warnings.length, 1, "the give-up arm was not announced");
		// THE ROUTE CHANGE: the panel unmounts and comes back with the sentence still
		// standing, which is the state a ref-shaped id cannot reach.
		await first.unmount();
		second.unmount = (await mount(PILE)).unmount;
		assert.equal(
			warnings.length,
			1,
			"the remount re-announced a sentence the reader has already been given",
		);
		// And the receipt lands while the SECOND instance is the mounted one.
		await act(async () => {
			store.setState({ readAckNotice: null });
		});
		assert.ok(
			dismissals.includes(warnings[0].id),
			`a remount left the sentence with nothing able to retire it (dismissals: ${JSON.stringify(dismissals)})`,
		);
	} finally {
		globalThis.__ack = undefined;
		await second.unmount();
	}
});
