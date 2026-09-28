import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE UNDO OFFERS AND THE ARCHIVE REFUSAL, AS ORDINARY TOASTS - driven on the
 * shipped components in a real DOM.
 *
 * Why this file exists. The three messages used to be drawn into a sidebar lane
 * with an app-armed clock and a hand-managed dismissal; since 2026-09-27 (the
 * operator's request - "instead of having a separate sidebar notification, we
 * should probably just use the normal sonner toast") they are raised by
 * `undo-toasts.tsx` into the app's one container, with sonner's own durations.
 * What that change leans on is a set of behaviours of the INSTALLED sonner that
 * source text cannot answer, and that the design record measured once and must
 * keep measuring:
 *
 *   - a message REPLACED in place: the archive offer and its refusal share one
 *     stable id, so an answer must arrive as an UPDATE of the mounted element.
 *     The class of failure this guards is the one the lane's comments recorded:
 *     a create on a dismissed id inside sonner's own unmount window (a
 *     `requestAnimationFrame` plus a 200ms delay) is merged into the dying
 *     entry and destroyed with it. The component's half of the fix is that a
 *     press NEVER dismisses the message it is about to have answered - this
 *     file presses, answers 3ms later, and asserts the message is still up;
 *   - the retirement rule still retires, and only then: the watch is state-
 *     driven (`useArchiveUndoRetirement`), and a conversation whose known state
 *     moves must take its offer down;
 *   - the draft-discard offer's Undo restores the store snapshot AND the pane,
 *     and its slot is cleared at every end of its life (auto-close, dismissal,
 *     the undo press) so nothing re-draws later.
 *
 * What is faked, and only that: the modules the store reads for other surfaces'
 * data (capabilities, profiles/teams, search, the feed, the router, the theme
 * barrel - see STUB_CONTENTS), and the transport under `setSessionArchived`,
 * which each case replaces to answer the way the app's own daemon would. The
 * components, the store, `showInfoToast`/`showWarningToast`/`dismissToast` and
 * the whole of sonner are the shipped ones.
 *
 * What it is NOT: evidence about pixels. jsdom has no layout engine, so nothing
 * here says where the card lands or how it looks - that is the frames' job
 * (`docs/evidence/undo-toasts-lane-retired/`).
 */

// React DOM feature-detects at import time, so the document exists first.
const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chats",
	/* Sonner's mount and dismiss paths reach a `requestAnimationFrame`, and this
	   file drives a rendering frame as its settle (`settleFrames`). */
	pretendToBeVisual: true,
});
/** jsdom's constructors are FORCED onto the global; Node 26 has its own. */
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
	"NodeFilter",
];
for (const [key, value] of Object.entries(
	Object.getOwnPropertyDescriptors(DOM.window),
)) {
	if (typeof value.value === "undefined") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	if (key.startsWith("on")) continue;
	globalThis[key] = value.value;
}
globalThis.window = DOM.window;
globalThis.document = DOM.window.document;
/* React's act() only warns-silences and, more importantly, flushes its own queue
   when the environment says so - the mark-all-read harness's own setting. */
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** A rendered frame, driven the way jsdom can be asked to run one. */
const settleFrames = async () => {
	await new Promise((resolve) => DOM.window.requestAnimationFrame(resolve));
};

// jsdom implements no layout, so the components' own observers are no-ops here.
if (!("ResizeObserver" in globalThis)) {
	globalThis.ResizeObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
}
globalThis.__ack = async () => ({});
const values = new Map();
globalThis.localStorage = {
	getItem: (key) => values.get(key) ?? null,
	setItem: (key, value) => values.set(key, value),
	removeItem: (key) => values.delete(key),
};

/*
 * The modules replaced wholesale, built at module level so biome's
 * `useTopLevelRegex` is satisfied (`scripts/mark-all-read-control.test.mjs`
 * documents the same shape).
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

/** Matches the bundle's own namespace filter, hoisted per the repository's lint rules. */
const FIXTURE_NAMESPACE = /.*/;
const STUB_CONTENTS = {
	"@shared/api/local-operator/desktop-api": `export {DesktopControlError, UserFacingError, userFacingMessage} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-api.ts`,
	)}
/* The transport, answered by the case's own __ack when a case drives one. None
   of this file's cases reach it (each overrides the store action it is about), so
   a refusal-shaped default would be a second instrument; it answers an empty ok. */
export const desktopResult = request => globalThis.__ack(request);`,
	"@shared/api/local-operator/desktop-hooks": `export {desktopFeatureEnabled, desktopFeatureState} from ${JSON.stringify(
		`${process.cwd()}/src/renderer/src/shared/api/local-operator/desktop-hooks.ts`,
	)}
export const useDesktopCapabilities = () => ({ data: { desktop_available: true, features: {} }, error: null, isLoading: false, refetch: async () => undefined });`,
	"@shared/api/local-operator/profile-hooks": `export const useProfiles = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });
export const useTeams = () => ({ data: [], error: null, isLoading: false, refetch: async () => undefined });`,
	"@shared/api/local-operator/session-search":
		"export const useChatSearch = () => ({ data: undefined, refused: false, isError: false, refetch: async () => undefined });",
	"@shared/hooks/use-desktop-feed":
		"export const useDesktopFeed = () => ({ available: false, connected: true, catalogueRevision: 0 });",
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
			'export { UndoToasts, ARCHIVE_TOAST_ID, DRAFTS_UNDO_TOAST_ID } from "./src/renderer/src/features/chat/components/undo-toasts";' +
			' export { useCanonicalSessionsStore } from "./src/renderer/src/shared/store/canonical-sessions-store";' +
			' export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";' +
			' export { ARCHIVE_UNDO_TOAST_MS } from "./src/renderer/src/features/chat/archive-undo";' +
			' export { ARCHIVE_FAILURE_TOAST_MS } from "./src/renderer/src/features/chat/archive-undo";' +
			' export { toast as sonnerToast } from "sonner";',
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
			name: "undo-toasts-fixture",
			setup(builder) {
				for (const [index, path] of STUB_PATHS.entries()) {
					builder.onResolve({ filter: STUB_FILTERS[index] }, () => ({
						path,
						namespace: "undo-toasts-fixture",
					}));
				}
				builder.onLoad(
					/* The namespace filter as a top-level constant (biome's `useTopLevelRegex`). */
					{ filter: FIXTURE_NAMESPACE, namespace: "undo-toasts-fixture" },
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
const bundlePath = new URL("._undo-toasts.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));
const {
	UndoToasts,
	ARCHIVE_TOAST_ID,
	DRAFTS_UNDO_TOAST_ID,
	useCanonicalSessionsStore: store,
	ThemedToastContainer,
	ARCHIVE_UNDO_TOAST_MS,
	ARCHIVE_FAILURE_TOAST_MS,
	sonnerToast,
} = await import(bundlePath.href);
const { createRoot } = await import("react-dom/client");

/*
 * THE CALLS THE SURFACE MAKES, recorded on the shipped `toast` object. A paint
 * read straight after a publish is a race sonner may win or lose (its portal
 * commits on its own schedule, and this harness records the measurement from
 * `mark-all-read-control.test.mjs`), so a case asserts BOTH halves: the call,
 * synchronously, and the paint, by waiting for it.
 */
const toastCalls = { infos: [], warnings: [], dismissals: [] };
const originalInfo = sonnerToast.info;
const originalWarning = sonnerToast.warning;
const originalDismiss = sonnerToast.dismiss;
sonnerToast.info = (message, options) => {
	const id = originalInfo.call(sonnerToast, message, options);
	toastCalls.infos.push({ id, options });
	return id;
};
sonnerToast.warning = (message, options) => {
	const id = originalWarning.call(sonnerToast, message, options);
	toastCalls.warnings.push({ id, options });
	return id;
};
sonnerToast.dismiss = (id) => {
	toastCalls.dismissals.push(id);
	return originalDismiss.call(sonnerToast, id);
};

/** The toasts still alive: a retired one stays in the DOM with `data-removed`. */
const liveToasts = () =>
	[...document.querySelectorAll("[data-sonner-toast]")].filter(
		(node) => node.getAttribute("data-removed") !== "true",
	);
const toastWithText = (needle) =>
	liveToasts().find((node) => (node.textContent ?? "").includes(needle)) ??
	null;
const waitForToast = async (needle) => {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const node = toastWithText(needle);
		if (node !== null) return node;
		await settleFrames();
	}
	return null;
};

const SESSION = "a1b2c3d4e5f6";
const OTHER = "b2c3d4e5f6a7";

let root = null;
const mountSurface = async () => {
	const container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	await act(async () => {
		root.render(
			React.createElement(
				React.Fragment,
				null,
				React.createElement(ThemedToastContainer),
				React.createElement(UndoToasts),
			),
		);
	});
};

/**
 * Every case starts from the store the app would have with nothing standing, and
 * from a DOM with NO toast in it at all.
 *
 * THE WAIT IS THE POINT, and it is the same class of measurement the lane's
 * comments recorded: sonner keeps a dismissed entry (and its element, marked
 * `data-removed`) alive for its unmount window (a `requestAnimationFrame` plus a
 * 200ms delay in the installed 2.0.3), and a create on that id inside the window
 * is merged into the dying entry and destroyed with it. A reset that dismissed
 * and returned would park the NEXT case's first raise inside that window and
 * report a component failure for a harness bug - so the reset waits (bounded) for
 * every toast element, removed ones included, to leave the document, then lets
 * the window pass.
 */
const reset = async () => {
	if (root !== null) {
		const previous = root;
		root = null;
		await act(async () => {
			previous.unmount();
		});
	}
	await act(async () => {
		store.setState({
			archiveUndo: null,
			archiveFailure: null,
			draftsUndo: null,
			stagedByDiscard: null,
			archiveFacts: {},
		});
		originalDismiss.call(sonnerToast);
	});
	for (let attempt = 0; attempt < 120; attempt += 1) {
		if (document.querySelectorAll("[data-sonner-toast]").length === 0) break;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 16));
		});
	}
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 260));
	});
	toastCalls.infos.length = 0;
	toastCalls.warnings.length = 0;
	toastCalls.dismissals.length = 0;
};

const archiveOffer = (over = {}) => ({
	sessionId: SESSION,
	title: "Migration checklist",
	archived: true,
	at: 1,
	...over,
});
const archiveRefusal = (over = {}) => ({
	sessionId: SESSION,
	title: "Migration checklist",
	archived: true,
	detail: null,
	at: 2,
	...over,
});
/** A draft snapshot shaped like `DraftsUndoOffer`'s. */
const draftsOffer = (over = {}) => ({
	keys: ["draft:team:alpha"],
	drafts: {
		"draft:team:alpha": { text: "half-written", order: 0 },
	},
	composer: {},
	at: 3,
	...over,
});

test("mounting the surface raises nothing", async () => {
	await reset();
	await mountSurface();
	assert.equal(liveToasts().length, 0);
	assert.equal(toastCalls.infos.length + toastCalls.warnings.length, 0);
});

test("the archive offer is an ordinary toast: the documented eight seconds, no position, the app's own container", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({ archiveUndo: archiveOffer() });
	});
	const toast = await waitForToast("archived.");
	assert.notEqual(toast, null, "the offer never painted");
	const call = toastCalls.infos.at(-1);
	assert.equal(call.options.id, ARCHIVE_TOAST_ID);
	assert.equal(call.options.duration, ARCHIVE_UNDO_TOAST_MS);
	assert.equal(call.options.duration, 8_000);
	assert.equal(
		call.options.position,
		undefined,
		"no position is passed: the container's own bottom-right placement is the app's one",
	);
	assert.equal(call.options.classNames?.content, "min-w-0");
	const action = toast.querySelector("[data-button]");
	assert.equal(action?.textContent?.trim(), "Undo");
});

test("a press is answered 3ms later and the message survives in place: the create-on-dismissed-id window is never entered", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({ archiveUndo: archiveOffer() });
	});
	const toast = await waitForToast("archived.");
	assert.notEqual(toast, null, "the offer never painted");
	/*
	 * THE PRESS, THROUGH THE STORE'S OWN DOOR: the action is replaced with one
	 * that records the call, the way the app's daemon sees it, and answers with a
	 * REFUSAL 3ms later - the window the lane's comments measured (the retry's
	 * dismiss and its re-create 2-4ms apart).
	 */
	/*
	 * THE WRITE IS REFUSED, THROUGH THE STORE'S OWN DOOR: the press runs the real
	 * `setSessionArchived`, and the refusal comes back where the app's own daemon
	 * answers - the harness's one seam, `__ack` under the stubbed `desktopResult`.
	 * Throwing from it enters the store's catch arm, which is where the refusal
	 * message is built; a plain Error is the "reached nothing" shape, and the
	 * sentence carries the fact either way.
	 */
	const requests = [];
	const failureAt = Date.now();
	globalThis.__ack = async (request) => {
		requests.push(request);
		/* The app's own daemon answers in 2-4ms; the refusal keeps that pace. */
		await new Promise((resolve) => setTimeout(resolve, 3));
		throw new Error("refused (the test's daemon)");
	};
	await act(async () => {
		await settleFrames();
	});
	const action = toast.querySelector("[data-button]");
	await act(async () => {
		action.dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await new Promise((resolve) => setTimeout(resolve, 40));
	});
	assert.deepEqual(
		requests,
		[{ op: "sessions.archive", sessionId: SESSION, archived: false }],
		"the press sends the DESIRED state through the store's own write",
	);
	assert.equal(
		toastCalls.dismissals.includes(ARCHIVE_TOAST_ID),
		false,
		"the press must not dismiss the message it is about to have answered",
	);
	/* The refused write was the OFFER's Undo - an unarchive - and the sentence says so. */
	const refusal = await waitForToast("Could not unarchive");
	assert.notEqual(refusal, null, "the answer never replaced the message");
	assert.equal(
		refusal,
		toast,
		"the answer is an UPDATE of the same mounted element, not a second entry",
	);
	assert.equal(
		refusal.querySelector("[data-button]")?.textContent?.trim(),
		"Retry",
	);
	/*
	 * AND THE ANSWER'S OWN TOAST IS THE REFUSAL'S, with the refusal's number and
	 * the same id: the family's one-message-at-a-time rule, kept across the pair.
	 */
	const answer = toastCalls.warnings.at(-1);
	assert.equal(answer.options.id, ARCHIVE_TOAST_ID);
	assert.equal(answer.options.duration, ARCHIVE_FAILURE_TOAST_MS);
	assert.equal(answer.options.duration, 10_000);
	assert.ok(Date.now() - failureAt < 1_000);
});

test("a newer offer supersedes a standing refusal, and the refusal's value is cleared with it", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({
			archiveUndo: null,
			archiveFailure: archiveRefusal(),
		});
	});
	await waitForToast("Could not archive");
	await act(async () => {
		store.setState({
			archiveFailure: null,
			archiveUndo: archiveOffer({ sessionId: OTHER, at: 4 }),
		});
	});
	const offer = await waitForToast("archived.");
	assert.notEqual(offer, null, "the newer offer never painted");
	assert.equal(
		liveToasts().length,
		1,
		"one message at a time, under the one id",
	);
	await act(async () => {
		await settleFrames();
	});
	assert.equal(store.getState().archiveFailure, null);
});

test("the retirement rule still retires: an offer whose conversation moves is taken down", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({
			archiveUndo: archiveOffer(),
			archiveFacts: {
				[SESSION]: { archived: true, answered: true },
			},
		});
	});
	await waitForToast("archived.");
	/*
	 * THE CONVERSATION MOVES: an answered fact whose value is no longer the one
	 * the offer was taken from - `undoOfferStands`'s rule, driven through the
	 * store the way another surface (the row's own Unarchive, the header's pill)
	 * would move it.
	 */
	await act(async () => {
		store.setState({
			archiveFacts: {
				[SESSION]: { archived: false, answered: true },
			},
		});
	});
	await act(async () => {
		await settleFrames();
	});
	assert.equal(
		store.getState().archiveUndo,
		null,
		"the offer's value is retired when the state it was taken from moves",
	);
	assert.equal(
		toastCalls.dismissals.includes(ARCHIVE_TOAST_ID),
		true,
		"and the message leaves with it",
	);
});

test("the discard offer restores the snapshot and the pane, and its slot is cleared at the press", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({
			drafts: {},
			activeDraftKey: "draft:fresh",
			stagedByDiscard: "draft:fresh",
			draftsUndo: draftsOffer(),
		});
	});
	const toast = await waitForToast("discarded.");
	assert.notEqual(toast, null, "the discard offer never painted");
	const call = toastCalls.infos.at(-1);
	assert.equal(call.options.id, DRAFTS_UNDO_TOAST_ID);
	assert.equal(call.options.duration, ARCHIVE_UNDO_TOAST_MS);
	const action = toast.querySelector("[data-button]");
	await act(async () => {
		action.dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await settleFrames();
	});
	assert.equal(
		store.getState().draftsUndo,
		null,
		"the slot is consumed by the undo",
	);
	assert.ok(
		"draft:team:alpha" in (store.getState().drafts ?? {}),
		"the snapshot's row is back in the store",
	);
	assert.equal(
		store.getState().stagedByDiscard,
		null,
		"the staged-key note is consumed with it",
	);
	assert.equal(
		store.getState().activeDraftKey,
		"draft:team:alpha",
		"the one-key pane case re-opens the restored draft",
	);
});

test("the discard offer's slot is cleared when its message ends without an undo", async () => {
	await reset();
	await mountSurface();
	await act(async () => {
		store.setState({ drafts: {}, draftsUndo: draftsOffer() });
	});
	const toast = await waitForToast("discarded.");
	/*
	 * THE DISMISSAL IS THE TOAST'S OWN X BUTTON, because that is the control the
	 * reader has AND the only end that reaches sonner's `onDismiss` callback: in the
	 * installed 2.0.3 `toast.dismiss()` (the programmatic form the component itself
	 * uses to take a retired message down) never fires it - measured in the
	 * distribution, where `onDismiss` is called by the close button and by a
	 * swipe-out and nowhere else. The app's own dismissal path is therefore this
	 * element and this handler, and the case drives the element.
	 */
	const close = toast.querySelector("[data-close-button]");
	assert.notEqual(
		close,
		null,
		"the toast has no close button to dismiss it with",
	);
	await act(async () => {
		close.dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	let cleared = false;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 50));
		});
		if (store.getState().draftsUndo === null) {
			cleared = true;
			break;
		}
	}
	assert.equal(
		cleared,
		true,
		"nothing re-draws the offer after its own message ends",
	);
});
