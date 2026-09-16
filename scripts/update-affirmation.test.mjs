import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/**
 * Contract checks for the lifetime of the update affirmation (QA round 1, Q1).
 *
 * The defect: `CheckForUpdatesButton` rendered the whole-check sentence from
 * its verdict's `affirmation` and never took it back. A check that positively
 * proved both channels current left "The application and server are up to date"
 * on screen for its six seconds, so the NEXT check - which found a server
 * release to offer - put that offer panel and the green sentence up together.
 * That is the reported contradiction, one check later, and an independent QA
 * pass reproduced it in a real browser two ways: a second manual check, and a
 * background `{silent:true}` server check whose offer event arrived with no
 * button pressed at all.
 *
 * These cases drive the SHIPPED component through the SHIPPED seams - the
 * `window.api.updater` bridge and the verdict the button's own invoke resolves -
 * so what is asserted is the component's own decision, not a re-implementation
 * of it. The three claims, in the order they were broken:
 *
 *   1. a new check retires the previous affirmation before it resolves;
 *   2. a check that did not earn the sentence does not leave the last one up;
 *   3. an offer event from ANY channel retires it, manual or background;
 *
 * plus the two edges the fix introduces: an older check resolving after a newer
 * one has started may not repaint its verdict, and an offer must not dismiss a
 * message that is NOT an affirmation (an error toast is not a currency claim).
 *
 * A third edge was added by review round 3 (R9), on QA round 2's O1: an offer
 * raised WHILE a check is in flight. The offer listeners retire the sentence, but
 * by then it is already retired, so the offer left no trace and that check's
 * affirming verdict painted over the panel it had raised. The guard is per check
 * window (`offerSinceCheckStartRef`), so a window with no offer still earns the
 * sentence - both halves are asserted below.
 *
 * A SECOND SUBJECT was added to this file with the operator's report of
 * 2026-09-15: the server-update panel that hung on "Updating server" for ever.
 * Same harness, same boundary - `UpdateNotification` is mounted against the
 * shipped `window.api.updater` bridge, an offer is emitted, "Update server" is
 * pressed through its own `onClick`, and the assertions are about which copy and
 * which toast the panel hands back. What that section adds over the button's own
 * cases is the exit from the in-flight state: the `backend-update-error` event,
 * and the invoke resolving `false` with no event at all, which is the shape the
 * hang came from and the one a `catch` alone cannot see.
 *
 * HOW THIS HARNESS STANDS IN FOR A DOM, and why that is the honest shape here:
 * this repo has no jsdom and no react-test-renderer and adding one changes the
 * lockfile, so React is a cell-per-hook stand-in (the same approach as
 * `reconnect-page-gap.test.mjs` and `attachment-url.test.mjs`) and
 * `createElement`/`jsx` build a plain tree of `{ type, props }`. Nothing
 * downstream of the button executes, which is exactly the boundary under test:
 * the props the button HANDS the alert are what decides whether the sentence is
 * on screen. What this cannot show is pixels - that is the rendered evidence's
 * job, and the QA round's browser pass is the independent check of it.
 */

/* --------------------------------------------------------------- react stand-in */

/**
 * A cell-per-hook React.
 *
 * One cell per hook call in order, a setter that re-renders, dep-gated effects,
 * and refs that survive renders. It does NOT model React's scheduler, batching
 * or commit timing, and nothing here asserts on a frame: every assertion is
 * about the element tree the component returns after a stated sequence.
 */
function makeRuntime() {
	const cells = [];
	let cursor = 0;
	let effects = [];
	const runtime = { render: () => null };
	const rerender = () => {
		cursor = 0;
		effects = [];
		const out = runtime.render();
		const flushed = effects;
		effects = [];
		// A setter may be called during a render pass (an effect below), so each
		// pass flushes the effects IT queued rather than a shared list.
		for (const fn of flushed) fn?.();
		return out;
	};
	runtime.rerender = rerender;
	/**
	 * Begin a fresh component. The store object itself is created ONCE, at module
	 * scope, because the icon and primitive packages reach for its identity half
	 * while they are being loaded (see `forwardRef` below) - before any test runs.
	 * What a mount resets is the per-render state: cells, effects, the unmounted
	 * flag.
	 */
	runtime.reset = () => {
		cells.length = 0;
		cursor = 0;
		effects = [];
		runtime.unmounted = false;
	};
	const slot = () => {
		const index = cursor++;
		if (!cells[index]) cells[index] = {};
		return cells[index];
	};
	const unchanged = (was, next) =>
		was !== undefined &&
		next !== undefined &&
		was.length === next.length &&
		was.every((value, index) => Object.is(value, next[index]));
	const store = {
		useState: (init) => {
			const cell = slot();
			if (!("state" in cell))
				cell.state = typeof init === "function" ? init() : init;
			return [
				cell.state,
				(value) => {
					const next = typeof value === "function" ? value(cell.state) : value;
					if (Object.is(next, cell.state)) return;
					cell.state = next;
					if (!runtime.unmounted) rerender();
				},
			];
		},
		useRef: (init) => {
			const cell = slot();
			if (!("ref" in cell)) cell.ref = { current: init };
			return cell.ref;
		},
		useCallback: (fn, deps) => {
			const cell = slot();
			if (!cell.fn || !unchanged(cell.deps, deps)) {
				cell.fn = fn;
				cell.deps = deps;
			}
			return cell.fn;
		},
		useMemo: (fn, deps) => {
			const cell = slot();
			if (!("value" in cell) || !unchanged(cell.deps, deps)) {
				cell.value = fn();
				cell.deps = deps;
			}
			return cell.value;
		},
		useEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useLayoutEffect: (fn, deps) => {
			const cell = slot();
			if (unchanged(cell.deps, deps)) return;
			cell.cleanup?.();
			cell.deps = deps;
			effects.push(() => {
				cell.cleanup = fn();
			});
		},
		useInsertionEffect: () => {},
		useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
		useDebugValue: () => {},
		/*
		 * The identity-shaped half of React, which the icon and primitive packages
		 * call at MODULE SCOPE. None of it can decide what the section renders, so
		 * each is the smallest faithful stand-in: `forwardRef` returns the render
		 * function unchanged (its ref is a prop the button never passes), `memo` is
		 * the identity, and a context hands back its default value.
		 */
		forwardRef: (render) => render,
		memo: (component) => component,
		createContext: (value) => ({
			Provider: null,
			Consumer: null,
			_currentValue: value,
		}),
		useContext: (context) => context?._currentValue,
		createRef: () => ({ current: null }),
		cloneElement: (element, props) => ({
			...element,
			props: { ...element.props, ...props },
		}),
		isValidElement: (value) =>
			Boolean(value && typeof value === "object" && "type" in value),
		Children: { map: (children, fn) => [children].flat().map(fn) },
		useId: () => "affirmation-test-id",
		useImperativeHandle: () => {},
		startTransition: (fn) => fn(),
		useDeferredValue: (value) => value,
		useTransition: () => [false, (fn) => fn()],
	};
	runtime.store = store;
	return runtime;
}

/*
 * One store, created before the bundle is imported.
 *
 * `globalThis.__affirmationReact` has to exist by the time a module in the
 * bundle calls a React function at LOAD time - `lucide-react` builds its icons
 * with `forwardRef` at module scope, and the renderer's store module is created
 * the same way. A store that only existed once a test mounted the component
 * would be undefined for both.
 */
const standIn = makeRuntime();
globalThis.__affirmationReact = standIn.store;

// The element builder, kept in the fixture rather than in the test body so a
// tree assertion cannot be satisfied by a hand-made object.
const reactStandIn = `const R = () => globalThis.__affirmationReact;
export const useState = (...a) => R().useState(...a);
export const useEffect = (...a) => R().useEffect(...a);
export const useLayoutEffect = (...a) => R().useLayoutEffect(...a);
export const useInsertionEffect = (...a) => R().useInsertionEffect(...a);
export const useRef = (...a) => R().useRef(...a);
export const useCallback = (...a) => R().useCallback(...a);
export const useMemo = (...a) => R().useMemo(...a);
export const useSyncExternalStore = (...a) => R().useSyncExternalStore(...a);
export const useDebugValue = (...a) => R().useDebugValue(...a);
export const forwardRef = (...a) => R().forwardRef(...a);
export const memo = (...a) => R().memo(...a);
export const createContext = (...a) => R().createContext(...a);
export const useContext = (...a) => R().useContext(...a);
export const createRef = (...a) => R().createRef(...a);
export const cloneElement = (...a) => R().cloneElement(...a);
export const isValidElement = (...a) => R().isValidElement(...a);
export const Children = { map: (children, fn) => [children].flat().map(fn) };
export const useId = () => "affirmation-test-id";
export const useImperativeHandle = () => {};
export const startTransition = (fn) => fn();
export const useDeferredValue = (value) => value;
export const useTransition = () => [false, (fn) => fn()];
export const Fragment = Symbol.for("react.fragment");
/*
 * Real React exports its own version, and a package that reads it at MODULE
 * SCOPE cannot be bundled without it: html-react-parser compares it against
 * 16 to decide how it maps custom attributes, and a read of .split on
 * undefined threw before any case ran. The value is the React the app itself
 * installs.
 */
export const version = "18.3.1";
/*
 * A real element shape, because the props the component hands its alert ARE
 * the assertion: dropping them would make every case below vacuous.
 */
export const createElement = (type, props, ...children) => ({
	type,
	props: {
		...(props ?? {}),
		/*
		 * The classic form passes children as arguments and the automatic runtime
		 * passes them inside props. Only the FIRST form may overwrite
		 * props.children; writing undefined over it would erase exactly the
		 * message these cases read.
		 */
		...(children.length > 0
			? { children: children.length > 1 ? children : children[0] }
			: {}),
	},
});
export const jsx = createElement;
export const jsxs = createElement;
export const jsxDEV = createElement;
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment, version, jsx, jsxs, jsxDEV, forwardRef, memo, createContext, useContext, createRef, cloneElement, isValidElement, Children, useId, useImperativeHandle, startTransition, useDeferredValue, useTransition };`;

const jsxRuntimeStandIn = `export { createElement, jsx, jsxs, jsxDEV, Fragment } from "react";`;

const reactDomStandIn = `export const createPortal = (node) => node;
export const flushSync = (fn) => fn();
export const render = () => {};
export default { createPortal, flushSync, render };`;

const bundle = await build({
	stdin: {
		contents: `
			export { CheckForUpdatesButton } from "./src/renderer/src/shared/components/common/check-for-updates-button";
			export { FloatingAlert } from "./src/renderer/src/shared/components/common/floating-alert";
			/*
			 * The same primitive symbol the fixture barrel hands the component, so the
			 * control is found in the tree by identity rather than by a string this
			 * file could get wrong.
			 */
			export { Button } from "@shared/components/ui";
			/*
			* The server-update panel is the other half of this file's subject and now
			* its own sibling cases' mount: the panel the operator's "Updating server"
			* hang lived in.
			*/
			export { UpdateNotification } from "./src/renderer/src/shared/components/common/update-notification";
			/*
			 * The failure panel's own container, so the sentence UNDER TEST is read from
			 * the panel rather than from whatever else on screen happens to say it -
			 * which surface holds it is the whole attribution question (R2-1, QA Q2).
			 */
			export { UpdateContainer } from "./src/renderer/src/shared/components/common/update-notification";
			/*
			 * The alert that carries an update-path failure's sentence. Exported so the
			 * harness can EXPAND it (below) rather than treat it as an opaque element:
			 * the message a user reads is rendered by this component, and the wrapper is
			 * deliberate - it is where the sentence and the machine's own words are kept
			 * in one place, so the app and the story cannot drift.
			 */
			export { UpdateErrorAlert } from "./src/renderer/src/shared/components/common/update-error-alert";
			export { PanelDetails } from "./src/renderer/src/shared/components/common/panel-details";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	/*
	 * The app's own JSX mode (`tsconfig.app.json`): esbuild would otherwise
	 * compile the classic `React.createElement` form and need a global `React`
	 * that a real renderer no longer imports either.
	 */
	jsx: "automatic",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	loader: { ".css": "empty" },
	plugins: [
		{
			name: "update-affirmation-fixture",
			setup(builder) {
				const stub = (namespace, contents) => {
					builder.onResolve({ filter: new RegExp(`^${namespace}$`) }, () => ({
						path: namespace,
						namespace: "affirmation-fixture",
					}));
					builder.onLoad(
						{ filter: /.*/, namespace: "affirmation-fixture" },
						() => ({
							contents,
							loader: "js",
							resolveDir: process.cwd(),
						}),
					);
				};
				// The dev-mode predicate reads `import.meta.env.DEV`, which is
				// undefined outside Vite; these cases are about the PRODUCTION
				// button, which is the only one that checks at all.
				builder.onResolve({ filter: /env-utils$/ }, () => ({
					path: "env-utils",
					namespace: "affirmation-env",
				}));
				builder.onLoad({ filter: /.*/, namespace: "affirmation-env" }, () => ({
					contents: "export const isDevelopmentMode = () => false;",
					loader: "js",
				}));
				/*
				 * The primitive barrel only. `Button` is what the control is made of and
				 * `Alert` is what the message is made of, and nothing about Q1 is decided
				 * inside either - the lifetime lived in the section component. Aliasing
				 * the barrel keeps this bundle to the files under test instead of pulling
				 * every Radix package in the app through it, with the element type still
				 * identity-comparable (`Button` is one symbol the fixture and the test
				 * share), which is what `press` finds the control by.
				 */
				builder.onResolve({ filter: /^@shared\/components\/ui$/ }, () => ({
					path: "ui",
					namespace: "affirmation-ui",
				}));
				builder.onLoad({ filter: /.*/, namespace: "affirmation-ui" }, () => ({
					contents: `export const Button = "Button";
						export const Alert = "Alert";
						export const Progress = "Progress";`,
					loader: "js",
				}));
				/*
				 * The deferred-updates store, narrowed to the two things this component
				 * asks of it. zustand's hook binding needs a real React renderer to
				 * subscribe through, and deferral is a sibling concern: what Q1 turns
				 * on is the alert's lifetime, and `clearDeferredUpdate` is the only
				 * member the section reads. Substituted rather than approximated, so a
				 * case here can never pass because the STORE did something.
				 */
				builder.onResolve({ filter: /deferred-updates-store$/ }, () => ({
					path: "deferred-updates-store",
					namespace: "affirmation-store",
				}));
				builder.onLoad(
					{ filter: /.*/, namespace: "affirmation-store" },
					() => ({
						contents: `export const UpdateType = { UI: "ui", BACKEND: "backend" };
export const useDeferredUpdatesStore = () => ({
	clearDeferredUpdate: () => {},
	/*
	 * The notification panel asks whether an offer is already deferred before it
	 * raises one, and defers on its own "Update later". Stubbed to the affirmative
	 * and to a no-op so a case here can never pass because the STORE decided.
	 */
	shouldShowUpdate: () => true,
	deferUpdate: () => {},
});`,
						loader: "js",
					}),
				);
				stub("react", reactStandIn);
				stub("react/jsx-runtime", jsxRuntimeStandIn);
				stub("react-dom", reactDomStandIn);
				stub("react-dom/client", reactDomStandIn);
			},
		},
	],
});

/*
 * Written to a real file rather than imported from a `data:` URL, for two
 * reasons the sibling suites already hit: a `data:` URL has no base for a
 * relative resolution, and a failure inside the bundle then reports as an
 * unreadable wall of base64 instead of the line that threw. Unlinked straight
 * after import, as `usage-container.test.mjs` does.
 */
const bundlePath = new URL("./_update-affirmation.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

/* ------------------------------------------------------------------- the bridge */

/**
 * The `window.api.updater` the component sees.
 *
 * Every subscription is recorded so a case can deliver exactly the event a real
 * main process would send; `checkForAllUpdates` is resolved by hand so the
 * mid-flight states (a check started but not answered) are exact rather than
 * timing-dependent.
 */
const updater = {
	handlers: new Map(),
	checks: [],
	/**
	 * Server-update attempts the panel started, each with its own resolver.
	 *
	 * `update-backend` is where the reported hang lived: it RESOLVES on failure, so
	 * a case has to be able to settle that promise by hand and see what the panel
	 * does with the answer it actually gets.
	 */
	backendUpdates: [],
	updateBackend(targetVersion) {
		return new Promise((resolve) => {
			updater.backendUpdates.push({ targetVersion, resolve });
		});
	},
	checkForAllUpdates(options) {
		return new Promise((resolve) => {
			updater.checks.push({ options, resolve });
		});
	},
	checkForBackendUpdates: async () => null,
	checkForUpdates(options) {
		return new Promise((resolve) => {
			updater.checks.push({ options, resolve });
		});
	},
	getLastInstallAttempt: async () => null,
	quitAndInstall: async () => false,
	quitForUpdateInstall: async () => {},
	downloadUpdate: async () => [],
	on(event) {
		return (handler) => {
			updater.handlers.set(event, [
				...(updater.handlers.get(event) ?? []),
				handler,
			]);
			return () => {
				updater.handlers.set(
					event,
					(updater.handlers.get(event) ?? []).filter((h) => h !== handler),
				);
			};
		};
	},
	emit(event, payload) {
		for (const handler of [...(updater.handlers.get(event) ?? [])])
			handler(payload);
	},
};

updater.onUpdateError = updater.on("update-error");
updater.onUpdateDevMode = updater.on("update-dev-mode");
updater.onBeforeQuitForUpdate = updater.on("before-quit-for-update");
updater.onBackendUpdateDevMode = updater.on("backend-update-dev-mode");
updater.onUpdateAvailable = updater.on("update-available");
updater.onUpdateNotAvailable = updater.on("update-not-available");
updater.onUpdateNpxAvailable = updater.on("update-npx-available");
updater.onUpdateDownloaded = updater.on("update-downloaded");
updater.onUpdateProgress = updater.on("update-progress");
updater.onBackendUpdateAvailable = updater.on("backend-update-available");
updater.onBackendUpdateNotAvailable = updater.on(
	"backend-update-not-available",
);
updater.onBackendUpdateCompleted = updater.on("backend-update-completed");
/*
 * Which phase a running update is in, announced as it changes: the in-flight panel
 * is one unchanging rectangle for a ~47 s install and a ~15 s restart without it
 * (UX U4).
 */
updater.onBackendUpdateProgress = updater.on("backend-update-progress");
/*
 * The channel the main process has always sent a failed server update on, and
 * which nothing subscribed to until the reported hang - so a case that does not
 * wire it would be modelling a renderer that cannot be fixed.
 */
updater.onBackendUpdateError = updater.on("backend-update-error");
updater.onBackendUpdateManualRequired = updater.on(
	"backend-update-manual-required",
);
updater.onUpdateInstallFailed = updater.on("update-install-failed");
updater.onUpdateInstallBlocked = updater.on("update-install-blocked");
updater.onUpdateInstallInFlight = updater.on("update-install-in-flight");

globalThis.window = {
	api: {
		updater,
		/*
		 * The version the panel prints beside an offer. A renderer always has this
		 * bridge, and the notification panel reads it on mount.
		 */
		systemInfo: { getAppVersion: async () => "0.25.2" },
		openExternal: async () => {},
	},
};

/*
 * Imported AFTER the bridge exists, because the store module this component
 * imports is created at module scope: it must find the `window` a renderer has
 * rather than the bare global a test process starts with.
 */
const {
	CheckForUpdatesButton,
	FloatingAlert,
	UpdateErrorAlert,
	PanelDetails,
	Button,
	UpdateContainer,
	UpdateNotification,
} = await import(bundlePath.href);
await unlink(bundlePath);

/*
 * Real timers are left alone. The component schedules one 2s reset of its
 * manual-check flag, which nothing here asserts on, and stubbing `setTimeout`
 * globally would also stub node:test's own timeouts - a harness that can hang
 * its runner to save two seconds is a bad trade.
 */
const realSetTimeout = globalThis.setTimeout;

/* ------------------------------------------------------------------- helpers */

const CURRENT = {
	app: "current",
	server: "current",
	affirmation: "The application and server are up to date",
};

const SERVER_OFFER = { app: "current", server: "available", affirmation: null };
const INCONCLUSIVE = {
	app: "current",
	server: "unavailable",
	affirmation: null,
};

/**
 * Mount the shipped button and return a handle that renders on demand.
 *
 * `rerender` re-runs the component with the SAME cells, so state written by a
 * setter is visible to the next read - which is how a case observes what the
 * user would be looking at after a sequence.
 */
function mount() {
	standIn.reset();
	/*
	 * A fresh bridge per mount. A case that leaves a check unanswered (the
	 * supersession case does) would otherwise hand its promise to the NEXT case's
	 * `answer`, which would then resolve into a component that is no longer
	 * mounted - a harness artefact that would read as a product failure.
	 */
	updater.checks.length = 0;
	standIn.render = () => CheckForUpdatesButton({});
	const handle = {
		runtime: standIn,
		tree: null,
		render() {
			handle.tree = standIn.rerender();
			return handle.tree;
		},
	};
	handle.render();
	return handle;
}

/**
 * Every node in the rendered tree, depth first.
 *
 * The stand-in React runtime builds ELEMENTS rather than rendering them, so a
 * component element is a node whose `type` is a function - which is what lets
 * `visible` find `FloatingAlert` by identity. `UpdateErrorAlert` is expanded
 * instead of returned, because it is a wrapper by design and the alert a user
 * reads is the one INSIDE it: without this, a wrapper that renders the message
 * would read as no message at all.
 */
function walk(node, out = []) {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, out);
		return out;
	}
	if (!node || typeof node !== "object") return out;
	if (node.type === UpdateErrorAlert) {
		walk(node.type(node.props ?? {}), out);
		return out;
	}
	/*
	 * `PanelDetails` is expanded for the same reason: since review round 1 (D4)
	 * the machine's words are rendered through the SAME labelled, copyable line
	 * the by-hand and install panels use, and a case that treated the wrapper as
	 * opaque would read a failure's detail as an empty string.
	 */
	if (node.type === PanelDetails) {
		walk(node.type(node.props ?? {}), out);
		return out;
	}
	out.push(node);
	if (node.props) walk(node.props.children, out);
	return out;
}

/**
 * The LINES a message renders, one entry per child element.
 *
 * The failure alert renders two of them - a sentence and the machine's own
 * words under it - so a case about the copy has to be able to say which line it
 * means. Everything that only cares what the message says joins them instead.
 */
function linesOf(value) {
	if (value == null) return [];
	if (Array.isArray(value)) return value.flatMap(linesOf);
	if (typeof value === "string") return [value];
	if (typeof value === "object" && value.props) {
		/*
		 * The machine line carries its words as a PROP rather than as children -
		 * `PanelDetails` is the labelled, copyable line the panels already use
		 * (review round 1, D4) - so a case about which line says what reads it from
		 * there.
		 */
		if (value.type === PanelDetails) return [String(value.props.detail ?? "")];
		return [textOf(value.props.children)];
	}
	return [];
}

/**
 * Every string under a subtree, joined - what a message actually says.
 *
 * The failure alert renders two lines (a sentence and the machine's own words),
 * so a message is a subtree rather than one string child.
 */
function textOf(value) {
	if (typeof value === "string" || typeof value === "number") {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.map(textOf).filter(Boolean).join(" ");
	}
	if (value && typeof value === "object" && value.props) {
		return textOf(value.props.children);
	}
	return "";
}

/**
 * What the user can see of the button's own messages right now.
 *
 * Both alerts are read by their own `open` prop, because a closed alert renders
 * nothing whatever its message says - the distinction the defect turned on.
 */
function visible(handle) {
	const nodes = walk(handle.tree);
	const shown = nodes.filter(
		(node) => node.type === FloatingAlert && node.props?.open === true,
	);
	return shown.map((node) => {
		const lines = linesOf(node.props.children);
		return {
			variant: node.props.variant ?? "info",
			lines,
			text: lines.join(" "),
		};
	});
}

/** The affirmation currently on screen, or null. */
function affirmationOnScreen(handle) {
	const success = visible(handle).filter(
		(alert) => alert.variant === "success",
	);
	return success.length > 0
		? success.map((alert) => alert.text).join(" | ")
		: null;
}

/** Resolve the pending check the button started, and let its `await` land. */
async function answer(handle, verdict) {
	const pending = updater.checks.shift();
	assert.ok(pending, "the button must have started a check to answer");
	pending.resolve(verdict);
	// Two turns: the component's `await` continuation, then its re-render.
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();
}

test("Q1: the sentence can be earned again after being taken back", async () => {
	const handle = mount();
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
	updater.emit("backend-update-available", {
		currentVersion: "0.54.43",
		latestVersion: "0.54.44",
	});
	handle.render();
	assert.equal(affirmationOnScreen(handle), null);
	// The user updates, checks again, and both channels are current: the
	// invalidation must not be a one-way latch.
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
});

test("Q1: unmounting mid-check cannot paint into a gone tree", async () => {
	const handle = mount();
	press(handle);
	handle.runtime.unmounted = true;
	const pending = updater.checks.shift();
	pending.resolve(CURRENT);
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	// The assertion is that this does not throw and that the tree is untouched;
	// React's own warning for a late `setState` is not observable here.
	assert.doesNotThrow(() => handle.render());
});

/**
 * R9 (QA round 2's O1): an offer raised WHILE a check is in flight.
 *
 * Here the two mechanisms disagree in TIME rather than in order. The manual check
 * retires the claim the moment it starts, so the offer that arrives mid-flight
 * calls `dismissAffirmation()` against an already-retired claim - a no-op - and
 * the offer is remembered nowhere. The verdict that follows then finds an
 * affirmation to paint and puts the sentence over the panel that offer raised,
 * which is the reported contradiction in miniature. QA measured the
 * service-level window at 1171 ms (`/tmp/pr172-qa2/race.mjs`) and it needs a
 * release published between the two checks' registry reads, which is narrow but
 * reachable: `checkForAllUpdates` takes no lock and the periodic `{silent:true}`
 * check overlaps the manual one by design.
 *
 * The second case is the same sequence with nothing raised in the window, and it
 * passes before the fix too: it is here so the guard cannot be satisfied by
 * refusing to paint the sentence at all.
 */
test("R9: an offer raised during a check keeps that check's verdict from affirming", async () => {
	const handle = mount();
	press(handle);
	handle.render();
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"a started check claims nothing yet",
	);

	// The background path's own event, delivered while the manual check is in
	// flight and with no button involved at all.
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		manual: false,
	});
	handle.render();

	// The manual check now proves both channels current - the verdict QA's race
	// produced inside the offer's window.
	await answer(handle, CURRENT);
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"the verdict must not paint over an offer raised during its check",
	);
});

test("R9: an offer before the check does not rob a later check of the sentence", async () => {
	const handle = mount();
	// The guard is the check's own window, not a latch on the session: an offer
	// that is already on screen when the next check starts does not stop that
	// check from earning the sentence (an earlier offer standing beside a
	// legitimately affirmed verdict is the separately recorded stale-panel case).
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		manual: false,
	});
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
});

/*
 * ------------------------------------------------- a failed server update
 *
 * The operator's report (2026-09-15): "Update server" in Settings put the panel
 * on "Updating server" and left it there forever. The server came back on the
 * old version, and the only thing that explains why - `backend-update-error`,
 * which every failing branch of `UpdateService.updateBackend` sends - reached no
 * listener, because the preload bridge never exposed it. The invoke RESOLVES
 * false rather than rejecting, and `updateBackend` cleared `checking` only in
 * its `catch`, so the panel had neither an event nor a rejection to leave on.
 *
 * These cases drive the SHIPPED panel through the SHIPPED bridge and assert what
 * the user is looking at: the in-flight panel is gone, and the reason is on the
 * standing failure panel that replaced it - the surface design round 1 asked for
 * (D1) and UX round 1 reached independently (U1), together with the two
 * properties those rounds turned on: a later offer supersedes the failure, and a
 * check's own failure is not read as an update's. What they cannot show is pixels
 * - that is the rendered evidence's job (`docs/evidence/common-updatenotification`),
 * and QA's browser pass is the independent check of it.
 */

/**
 * Mount the shipped notification panel, with its start-up check switched off.
 *
 * `autoCheck: false` is deliberate: the panel's mount-time check would put
 * "Checking for updates" up through a promise no case here holds, it re-runs with
 * the listener effect, and it re-issues the check behind every assertion - so the
 * states under test here are the ones an EVENT raises: the offer the main process
 * sends, a refusal, a failure. The parameter exists so a case that needs the check
 * in flight can ask for it, and the check-channel case prefers a check the user's
 * own control started for that same reason.
 */
function mountNotification({ autoCheck = false } = {}) {
	standIn.reset();
	updater.checks.length = 0;
	updater.backendUpdates.length = 0;
	/*
	 * A previous mount's subscriptions are dropped, so an event delivered below
	 * cannot be handled twice - by the panel under test and by an earlier case's.
	 */
	updater.handlers.clear();
	standIn.render = () => UpdateNotification({ autoCheck });
	const handle = {
		runtime: standIn,
		tree: null,
		render() {
			handle.tree = standIn.rerender();
			return handle.tree;
		},
	};
	handle.render();
	return handle;
}

/** Whether the panel is carrying this exact line of copy. */
function showsText(handle, text) {
	return walk(handle.tree).some((node) => node.props?.children === text);
}

/**
 * Every string of copy in the rendered tree, at any depth.
 *
 * `showsText` matches a line EXACTLY, which is right for copy the component owns
 * outright. It cannot express "no sentence here says Settings" or "this clause is
 * part of a longer paragraph", which is what the R3-2 assertions need.
 */
function allCopy(handle) {
	return walk(handle.tree)
		.filter((node) => typeof node.props?.children === "string")
		.map((node) => node.props.children);
}

/** Every danger toast on screen right now, by the props the panel hands it. */
function dangerToasts(handle) {
	return visible(handle).filter((alert) => alert.variant === "danger");
}

/**
 * The sentence the FAILURE PANEL is carrying, or null when none is up.
 *
 * Read from inside the failed container rather than from the tree at large,
 * because the same sentence can also be a toast's - and which of the two holds
 * it is the whole of the attribution question (review R2-1, QA Q2).
 */
function failurePanelReason(handle) {
	const failed = walk(handle.tree).find(
		(node) => node.type === UpdateContainer && node.props?.tone === "failed",
	);
	if (!failed) return null;
	const paragraph = walk(failed.props.children).find(
		(node) => node.type === "p" && typeof node.props?.children === "string",
	);
	return paragraph?.props.children ?? null;
}

/**
 * Every string of copy inside the panel's `failed` container, joined.
 *
 * Wider than `failurePanelReason` on purpose: the round-3 findings pinned here are
 * about what a failed panel does NOT say (the server panel names no durable
 * record) as much as what it does, and "this sentence appears nowhere in this
 * panel" is only checkable against all of it.
 */
function failedPanelCopy(handle) {
	const failed = walk(handle.tree).find(
		(node) => node.type === UpdateContainer && node.props?.tone === "failed",
	);
	if (!failed) return null;
	return walk(failed.props.children)
		.filter((node) => typeof node.props?.children === "string")
		.map((node) => node.props.children)
		.join(" ");
}

/** The toast the pinned box is showing right now, if any. */
function pinnedToast(handle) {
	return walk(handle.tree).find(
		(node) => node.type === FloatingAlert && node.props?.open === true,
	);
}

/** The panel's control for a given label, found in the tree it rendered. */
function control(handle, label) {
	const found = walk(handle.tree).find(
		(node) => node.type === Button && node.props?.children === label,
	);
	assert.ok(found, `the panel must render a "${label}" control`);
	return found;
}

/*
 * A report as the main process writes it: the sentence, and the PHASE that
 * produced it. The phase is what the renderer reads to decide the surface - an
 * attempt's reason belongs on the failure panel, a check's on the toast - so
 * these helpers name the producer rather than leaning on whether an attempt
 * happens to be running (review R2-1, QA Q2).
 */
const updateReport = (message) => ({ message, phase: "update" });
const checkReport = (message) => ({ message, phase: "check" });

/** The server offer the main process sends before it will run pip. */
const SERVER_UPDATE_OFFER = {
	currentVersion: "0.55.9",
	latestVersion: "0.55.10",
	updateCommand: "",
	canManageUpdate: true,
};

/** Press "Update server" and leave the panel in flight. */
function startServerUpdate(handle) {
	updater.emit("backend-update-available", SERVER_UPDATE_OFFER);
	handle.render();
	control(handle, "Update server").props.onClick();
	handle.render();
}

/** Settle the in-flight attempt the way the main process would. */
/**
 * Answer the check a component started, and let its continuation paint.
 *
 * The same two-turn settle `settleServerUpdate` uses, for the app-channel invoke
 * the failure card's own retry goes through: an `Error` outcome rejects it, a value
 * resolves it.
 */
async function settleCheck(handle, outcome) {
	const pending = updater.checks.shift();
	assert.ok(pending, "a check must be in flight to settle");
	pending.resolve(outcome instanceof Error ? Promise.reject(outcome) : outcome);
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();
}

async function settleServerUpdate(handle, outcome) {
	const pending = updater.backendUpdates.shift();
	assert.ok(pending, "the panel must have started a server update to settle");
	if (outcome instanceof Error) pending.resolve(Promise.reject(outcome));
	else pending.resolve(outcome);
	// Two turns: the component's `await` continuation, then its re-render.
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();
}

test("the server-update press carries the offered version and shows the in-flight panel", () => {
	const handle = mountNotification();
	startServerUpdate(handle);

	assert.equal(updater.backendUpdates.length, 1);
	// The version travels with the request: the main process pins the pip
	// requirement to it, so a stale index cannot satisfy the request with the
	// version already installed.
	assert.equal(updater.backendUpdates[0].targetVersion, "0.55.10");
	assert.ok(
		showsText(handle, "Updating server"),
		"the press must put the in-flight panel up",
	);
});

test("backend-update-error takes the in-flight panel down and says why", () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	assert.ok(showsText(handle, "Updating server"));

	// pip exited 0 having installed nothing, which is the operator's own log line.
	const reason =
		"The server update ran but the installed version did not change (still 0.55.9), so it is reported as failed.";
	updater.emit("backend-update-error", updateReport(reason));
	handle.render();

	assert.equal(
		showsText(handle, "Updating server"),
		false,
		"a reported failure must not leave the panel waiting",
	);
	/*
	 * The failure is a STANDING panel, not a toast (design D1, UX U1): measured
	 * against the toast, the same event ended in a 6-second message in the opposite
	 * corner whose only control was Dismiss, 625px below the panel slot, with the
	 * offer it replaced suppressed for the rest of the session.
	 */
	assert.ok(
		showsText(handle, "The server update didn't finish"),
		JSON.stringify(visible(handle)),
	);
	assert.ok(
		showsText(handle, reason),
		"the panel must carry main's own reason",
	);
	assert.equal(
		dangerToasts(handle).length,
		0,
		"one failure is one message, and it is the panel's",
	);
	// Both actions the finding asked for: an attempt the user can restart, and a
	// dismissal that defers the release.
	control(handle, "Try again");
	control(handle, "Update later");
});

test("a resolved false with no event still leaves the panel and says something", async () => {
	const handle = mountNotification();
	startServerUpdate(handle);

	// The shape the renderer has to survive: no event at all, just the resolved
	// value - `update-backend` reports every failure this way.
	await settleServerUpdate(handle, false);

	assert.equal(
		showsText(handle, "Updating server"),
		false,
		"the invoke settling is an outcome, not a reason to keep waiting",
	);
	// The backstop names the release it was updating to, which is the fact the
	// reader can check - and it does NOT send them to a log this app cannot open
	// (design D3).
	assert.ok(
		showsText(handle, "The server update to 0.55.10 did not complete."),
		JSON.stringify(visible(handle)),
	);
	assert.equal(dangerToasts(handle).length, 0);
});

/**
 * The failure is not sticky, and the offer takes the slot back.
 *
 * UX U1: after one failed update the offer was suppressed for the rest of the
 * session - a later check found the release, stored it, and painted nothing,
 * because only this component's own calls ever cleared the error state. The
 * designer's round measured the same end state independently (D1).
 */
test("a later offer supersedes the failure and repaints the offer panel", () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	updater.emit(
		"backend-update-error",
		updateReport("The server update failed to install."),
	);
	handle.render();
	assert.ok(showsText(handle, "The server update didn't finish"));

	// The 5-minute check finds the release again.
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		latestVersion: "0.55.11",
	});
	handle.render();

	assert.equal(
		showsText(handle, "The server update didn't finish"),
		false,
		"a fresh offer is newer news than the failure it supersedes",
	);
	assert.ok(showsText(handle, "Server update available"));
	control(handle, "Update server");
});

/**
 * `Try again` re-runs the attempt, which also clears the notice.
 *
 * Nothing about a failed update may be permanently sticky: the panel's own action
 * has to return the surface to the in-flight state it started in, or the notice
 * would sit there with a button that appears to do nothing.
 */
test("Try again starts a second attempt and clears the failure", () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	updater.emit(
		"backend-update-error",
		updateReport("The server update failed to install."),
	);
	handle.render();

	control(handle, "Try again").props.onClick();
	handle.render();

	assert.equal(showsText(handle, "The server update didn't finish"), false);
	assert.ok(showsText(handle, "Updating server"));
	assert.equal(
		updater.backendUpdates.length,
		2,
		"a second attempt was started",
	);
	assert.equal(
		updater.backendUpdates[1].targetVersion,
		"0.55.10",
		"the retry asks for the same release",
	);
});

/**
 * The check's own failure is not the update's (review R1-2).
 *
 * `backend-update-error` carries two different things: the failing branches of
 * `UpdateService.updateBackend`, and three branches of `checkForBackendUpdates`
 * ("Unable to determine backend version.") that fire on a check the user pressed.
 * Reading the second as an update outcome ended "Checking for updates" early and
 * marked an idle attempt terminal; the message still has to reach the user, so it
 * takes the toast.
 *
 * The check in flight here is one the user's own button started (the refusal panel's
 * own `Check for updates`), not the panel's mount check: the mount check re-runs
 * with the effect and would restart the check behind every assertion, which is a
 * property of this harness's stand-in React rather than of the component.
 */
test("a check-time failure does not end the check or claim an attempt", () => {
	const handle = mountNotification();
	// A refusal the user has to act on renders the panel whose own control starts
	// the check - reachable with `autoCheck` off, unlike the mount-time check.
	updater.emit("update-install-blocked", {
		code: "installed-bundle-not-sealed",
		version: "0.19.5",
		message: "The downloaded update did not pass its integrity check.",
		remedy: { text: "Download a fresh copy." },
	});
	handle.render();
	control(handle, "Check for updates").props.onClick();
	handle.render();
	assert.ok(showsText(handle, "Checking for updates"));

	updater.emit(
		"backend-update-error",
		checkReport("Unable to determine backend version."),
	);
	handle.render();

	assert.ok(
		showsText(handle, "Checking for updates"),
		"a check's failure is not an update outcome",
	);
	assert.equal(showsText(handle, "The server update didn't finish"), false);
	const toasts = dangerToasts(handle);
	assert.equal(toasts.length, 1, JSON.stringify(visible(handle)));
	assert.match(toasts[0].text, /Unable to determine backend version/);
});

/**
 * A check's failure cannot become the attempt's reason (review R2-1, QA Q2).
 *
 * A server update takes minutes and the sibling surfaces stay live, so a check
 * the user pressed elsewhere can fail inside one. Both reports arrive on the same
 * channel, and until the phase travelled with them the panel decided by asking
 * whether an attempt was in flight - which is true of the check as well - so the
 * check's "Unable to determine backend version." stood as the update's failure
 * while the update's own reason went to the toast. QA measured that this did not
 * self-correct: the wrong sentence stood until a later offer replaced the panel.
 */
test("a check's failure during an attempt cannot own the failure panel", () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	assert.ok(showsText(handle, "Updating server"));

	const checkFailure = "Unable to determine backend version.";
	updater.emit("backend-update-error", checkReport(checkFailure));
	handle.render();

	// The attempt is untouched, and the check's sentence is where a check's
	// failure has always gone.
	assert.ok(
		showsText(handle, "Updating server"),
		"a check's failure must not end the attempt",
	);
	assert.equal(
		failurePanelReason(handle),
		null,
		"a check's sentence must not stand as the update's failure",
	);
	const toasts = dangerToasts(handle);
	assert.equal(toasts.length, 1, JSON.stringify(visible(handle)));
	assert.match(toasts[0].text, /Unable to determine backend version/);

	// The attempt's own reason arrives, and THAT is what the panel carries.
	const attemptReason = "The server update ran but installed nothing.";
	updater.emit("backend-update-error", updateReport(attemptReason));
	handle.render();

	assert.equal(
		failurePanelReason(handle),
		attemptReason,
		"the panel must carry the attempt's own sentence",
	);
	assert.notEqual(failurePanelReason(handle), checkFailure);
});

/*
 * ------------------------------------------- the copy the panels claim (R3-2)
 *
 * Round 3 removed the server failure panel's "This is also recorded in Settings,
 * under Application updates." and added the in-flight panel's "The update can't be
 * interrupted." Neither was asserted anywhere - `grep` found only the two literals
 * - and `pnpm check-evidence` is DEFERRED on this machine (the sweep lease is
 * peer-held), so the re-captured frames are derived rather than sweep-certified
 * and are the only record of what the copy said. The same mis-copy could arrive
 * again with a green suite. These two cases pin the copy in code instead.
 */

test("the server failure panel names no record, while the install panel still does", () => {
	/*
	 * Both halves, because the defect was a sentence COPIED between the two panels:
	 * "recorded in Settings" is true on the install failure - `writePendingInstallMarker`
	 * writes it in the `quit-and-install` handler and the marker-recovery path, and
	 * `get-last-install-attempt` reads it back - and false on the server failure, where
	 * `updateBackend` writes nothing and the Settings card has no other failure source
	 * (UX U5). Asserting only the absence would let the sentence vanish from both.
	 */
	const install = mountNotification();
	updater.emit("update-install-failed", {
		targetVersion: "0.25.9",
		message: "The last update to version 0.25.9 didn't finish.",
		remedy: { text: "Download a fresh copy of the application." },
		attempts: 1,
	});
	install.render();
	assert.match(
		String(failedPanelCopy(install)),
		/This is also recorded in Settings, under Application updates\./,
	);

	const server = mountNotification();
	startServerUpdate(server);
	updater.emit(
		"backend-update-error",
		updateReport(
			"The server update to 0.55.10 did not take effect: the server is still on 0.55.9.",
		),
	);
	server.render();
	const copy = failedPanelCopy(server);
	assert.ok(copy, "the server failure panel must be up");
	assert.match(copy, /The server update didn't finish/);
	assert.doesNotMatch(copy, /Settings/);
});

test("the in-flight panel says the update cannot be interrupted", () => {
	/*
	 * The copy half of UX U2, and it is the whole of that half: there is no cancel
	 * control, so this sentence is what keeps a mis-press from reading as a dead end.
	 */
	const handle = mountNotification();
	startServerUpdate(handle);
	assert.ok(
		allCopy(handle).some((text) =>
			text.includes("The update can't be interrupted"),
		),
		JSON.stringify(allCopy(handle)),
	);

	/*
	 * And it is the UPDATE's clause, not a property of any wait panel: the check's
	 * own in-flight state must not carry it (QA R3-F10b).
	 */
	const checking = mountNotification({ autoCheck: true });
	checking.render();
	assert.ok(
		allCopy(checking).some((text) => text.includes("Checking for updates")),
		JSON.stringify(allCopy(checking)),
	);
	assert.equal(
		allCopy(checking).some((text) => text.includes("can't be interrupted")),
		false,
	);
});

test("a message with no panel to sit beside still renders the toast", () => {
	/*
	 * The regression this file's fix first introduced: with the toast folded into the
	 * panel branches, a message that belongs to NO panel state - a failed check, a
	 * rejected download - had no branch left to render it, and the component fell
	 * through to nothing at all. The toast is the only surface for those, so the
	 * fall-through carries it (and this case fails without that call).
	 *
	 * No attempt is in flight and nothing is on offer here, which is the state a
	 * failed background check leaves the panel in.
	 */
	const handle = mountNotification();
	updater.emit(
		"backend-update-error",
		checkReport("Unable to determine backend version."),
	);
	handle.render();

	const toasts = dangerToasts(handle);
	assert.equal(toasts.length, 1, JSON.stringify(visible(handle)));
	assert.match(toasts[0].text, /Unable to determine backend version/);
	assert.equal(showsText(handle, "The server update didn't finish"), false);
});

/**
 * One message in the pinned box, and the error is the half that takes it (UX U6).
 *
 * The offer panel carries its own `FloatingAlert`, and a failed check carries
 * another. Both are pinned to `right-4 bottom-4 z-50`, so the pair was one painted
 * over the other and which of them a reader saw came down to DOM order. The
 * precedence is now stated: while an error is set the box holds the error and the
 * branch's own notice is not rendered beside it (the notice repeats what the panel
 * already says), and closing the error clears it, so the box is free for the next
 * message rather than being held by one the reader has already dismissed.
 *
 * UX read the collision from the classes and the DOM and had no browser to see it
 * with, so this case is the driven one: it mounts the shipped panel and counts
 * what is pinned in that corner.
 */
/**
 * The skew notice speaks only when there IS a skew.
 *
 * The rig's own false alarm, caught end to end: the check that follows an
 * install which is already current carries `runningVersion` equal to `version`,
 * and the panel headed that machine "The server is on an older build than the
 * install" while both readings were 0.56.2 - and its remedy line said restart a
 * server that was already up to date. A notice built on two equal readings is not
 * a smaller version of the truth, it is a different statement.
 */
test("readings that agree raise no skew notice, and readings that differ do", () => {
	const handle = mountNotification();
	updater.emit("backend-update-not-available", {
		version: "0.56.2",
		runningVersion: "0.56.2",
		restartable: true,
	});
	handle.render();
	assert.equal(
		allCopy(handle).some((text) => /older build than the install/.test(text)),
		false,
		JSON.stringify(allCopy(handle)),
	);

	// The mirror, so the guard cannot pass by never rendering the notice at all.
	updater.emit("backend-update-not-available", {
		version: "0.56.2",
		runningVersion: "0.56.0",
		restartable: true,
	});
	handle.render();
	const copy = allCopy(handle);
	assert.ok(
		copy.some((text) => /older build than the install/.test(text)),
		JSON.stringify(copy),
	);
	assert.ok(
		copy.some((text) => /install is up to date \(0\.56\.2\)/.test(text)),
		JSON.stringify(copy),
	);
	assert.ok(
		copy.some((text) => /is still running 0\.56\.0/.test(text)),
		JSON.stringify(copy),
	);
	// And it tells the reader what to do about it, for a daemon the app owns.
	assert.ok(
		copy.some((text) => /Restart Local Operator/.test(text)),
		JSON.stringify(copy),
	);
});

/**
 * U9: the offer states the cost THIS machine pays, not the one the layout implies.
 *
 * The managed arm's sentence comes from the plan, and the plan is an install
 * classification: it cannot know whether the daemon serving this app is one the
 * app started. On a machine where discovery adopted a server the offer therefore
 * promised "restarts the server it started, so a turn that is in flight is
 * dropped" - a cost that cannot be incurred there, denied four minutes later by the
 * app's own completion notice. The event now carries `restartable`, and this case
 * pins both directions off the SAME payload: only the ownership reading differs.
 */
test("the offer names the restart cost only where the app may restart the server", () => {
	// The plan's own managed sentence, verbatim from `resolveGlobalInstallPlan`.
	const PLAN_MANAGED_SENTENCE =
		"The app updates this install and then restarts the server it started, so a turn that is in flight is dropped while the server comes back. This can take a minute or two.";

	const owned = mountNotification();
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		remedy: PLAN_MANAGED_SENTENCE,
		restartable: true,
	});
	owned.render();
	const ownedCopy = allCopy(owned).join(" ");
	assert.match(ownedCopy, /then restarts the server it started/, ownedCopy);
	assert.match(ownedCopy, /a turn that is in flight is dropped/, ownedCopy);

	const adopted = mountNotification();
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		remedy: PLAN_MANAGED_SENTENCE,
		restartable: false,
	});
	adopted.render();
	const adoptedCopy = allCopy(adopted).join(" ");
	assert.match(
		adoptedCopy,
		/keeps running the old build until it restarts/,
		adoptedCopy,
	);
	assert.match(adoptedCopy, /nothing in flight is dropped/, adoptedCopy);
	assert.equal(
		/restarts the server it started/.test(adoptedCopy),
		false,
		`an adopted daemon's offer must not promise a restart: ${adoptedCopy}`,
	);

	// An older main process sends no ownership reading at all. The app-owned
	// sentence is the one this offer was written for, so that is the fallback.
	const unstated = mountNotification();
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		remedy: PLAN_MANAGED_SENTENCE,
	});
	unstated.render();
	assert.match(
		allCopy(unstated).join(" "),
		/then restarts the server it started/,
	);
});

/**
 * R2-3: silence on SUCCESS is the one outcome this panel must not produce.
 *
 * The completion path routed every `restarted: false` arrival through the skew
 * funnel and returned past its toast - and the funnel declines when the running
 * reading is missing. So a successful install over an adopted daemon whose
 * `/health` read failed rendered nothing at all: no toast, no notice, no error,
 * and a panel that simply went idle. The funnel now reports whether it spoke.
 */
test("a completed install the notice declines still answers the press", () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	updater.emit("backend-update-completed", {
		installVersion: "0.56.2",
		// Adopted, and the read failed: the funnel has nothing to compare, so it
		// declines - correctly, because it cannot claim the server is behind.
		runningVersion: null,
		restarted: false,
		restartable: true,
	});
	handle.render();

	const shown = visible(handle);
	assert.equal(
		shown.length,
		1,
		`the press must be answered: ${JSON.stringify(shown)} ${JSON.stringify(allCopy(handle))}`,
	);
	assert.equal(shown[0].variant, "success");
	assert.match(shown[0].text, /Server update completed successfully/);
	// ... and it still must not claim the server moved.
	assert.equal(
		allCopy(handle).some((text) => /older build than the install/.test(text)),
		false,
		JSON.stringify(allCopy(handle)),
	);
});

/**
 * R2-5: the phase lives in the same cleanup as the flags that put the panel up.
 *
 * `updateBackend`'s `finally` clears `checking`/`updatingBackend` unconditionally
 * and deliberately not per-branch - and the phase added this round was reset only
 * by the two listeners that carry one, so an attempt answered through the
 * by-hand surface left `"installing"` set and the NEXT attempt's panel opened on
 * the previous attempt's sentence.
 */
/**
 * U13: the panel that follows the click carries the same reading as the offer.
 *
 * The offer learned to stop promising a restart it cannot perform (U9), and the
 * in-flight install panel went on making the same promise two seconds later, on
 * the same machine, from a constant chosen by the install's LAYOUT. Both ask
 * `serverRestartsWithInstall` now, so this case pins both arms of the SAME
 * payload, before and after the press.
 */
test("the in-flight install panel promises a restart only where one is coming", () => {
	const press = (restartable) => {
		const handle = mountNotification();
		updater.emit("backend-update-available", {
			...SERVER_UPDATE_OFFER,
			restartable,
		});
		handle.render();
		control(handle, "Update server").props.onClick();
		handle.render();
		return handle;
	};

	// Before any phase event: the panel's ambient sentence must not promise it
	// either - it is the one a pip update shows for its whole run.
	const ownedAmbient = press(true);
	const ownedAmbientCopy = allCopy(ownedAmbient).join(" ");
	assert.match(
		ownedAmbientCopy,
		/will temporarily go offline while it restarts/,
		ownedAmbientCopy,
	);

	const adoptedAmbient = press(false);
	const adoptedAmbientCopy = allCopy(adoptedAmbient).join(" ");
	assert.equal(
		/will temporarily go offline/.test(adoptedAmbientCopy),
		false,
		`an adopted server is not taken offline: ${adoptedAmbientCopy}`,
	);

	// And the install phase itself, which is where the reviewer found it.
	const owned = press(true);
	updater.emit("backend-update-progress", { phase: "installing" });
	owned.render();
	const ownedCopy = allCopy(owned).join(" ");
	assert.match(ownedCopy, /and it restarts once the install lands/, ownedCopy);

	const adopted = press(false);
	updater.emit("backend-update-progress", { phase: "installing" });
	adopted.render();
	const adoptedCopy = allCopy(adopted).join(" ");
	assert.equal(
		/restarts once the install lands/.test(adoptedCopy),
		false,
		`the panel must not re-promise the restart: ${adoptedCopy}`,
	);
	// The rest of the sentence still stands.
	assert.match(adoptedCopy, /keeps serving while this runs/, adoptedCopy);
	assert.match(
		adoptedCopy,
		/can't be interrupted once it has started/,
		adoptedCopy,
	);
});

/**
 * U14: the unattended notice speaks only when the readings differ.
 *
 * Its new `unattended && restartable` arm fired exactly when the app OWNED the
 * server it had just started from the landed install - so the headline asserted a
 * skew that did not exist and the advice told the reader to restart the app that
 * was painting the panel, with Settings reading the new version one second later.
 * The producer reads the serving daemon now, so the panel is silent unless there is
 * something to say - and the attempt is still accounted for.
 */
test("an unattended completion speaks only when the readings actually differ", () => {
	const completion = (runningVersion) => ({
		installVersion: "0.56.2",
		runningVersion,
		restarted: false,
		unattended: true,
		restartable: true,
	});

	// The ordinary path: the app came back and started its daemon from the landed
	// install. Both readings agree, so there is no skew to report - and the attempt
	// is not left silent either.
	const agreeing = mountNotification();
	startServerUpdate(agreeing);
	updater.emit("backend-update-completed", completion("0.56.2"));
	agreeing.render();
	const agreeingCopy = allCopy(agreeing).join(" ");
	assert.equal(
		/older build than the install/.test(agreeingCopy),
		false,
		`no skew exists here: ${agreeingCopy}`,
	);
	assert.equal(
		/once more/.test(agreeingCopy),
		false,
		`no restart is owed here: ${agreeingCopy}`,
	);
	assert.equal(
		visible(agreeing).length,
		1,
		`the attempt must still be accounted for: ${JSON.stringify(visible(agreeing))}`,
	);
	assert.match(
		visible(agreeing)[0].text,
		/Server update completed successfully/,
	);

	// The state the notice is for: the abandoned attempt landed and the daemon
	// serving this launch is genuinely still on the old build.
	const skew = mountNotification();
	startServerUpdate(skew);
	updater.emit("backend-update-completed", {
		...completion("0.56.0"),
		restartable: false,
	});
	skew.render();
	const skewCopy = allCopy(skew).join(" ");
	assert.match(skewCopy, /older build than the install/, skewCopy);
	assert.match(skewCopy, /finished while Local Operator was closed/, skewCopy);
	assert.match(skewCopy, /still reports 0\.56\.0/, skewCopy);
	assert.match(
		skewCopy,
		/It moves onto the new build when it restarts/,
		skewCopy,
	);
});

test("a phase from an attempt answered elsewhere cannot leak into the next", async () => {
	const handle = mountNotification();
	startServerUpdate(handle);
	updater.emit("backend-update-progress", { phase: "installing" });
	handle.render();
	assert.ok(
		allCopy(handle).some((text) =>
			/Installing the new server build/.test(text),
		),
		JSON.stringify(allCopy(handle)),
	);

	/*
	 * The attempt ends WITHOUT a completion and WITHOUT an error report - the shape
	 * main answers over the by-hand surface, and the one the phase was never cleared
	 * on: the two listeners that carry a phase are the completed event and an
	 * update-phase error report, so the flags came down in `updateBackend`'s
	 * `finally` and the phase stayed set.
	 */
	await settleServerUpdate(handle, true);

	// The next attempt opens on the generic sentence, not the last one's.
	startServerUpdate(handle);
	handle.render();
	const copy = allCopy(handle).join(" ");
	assert.equal(
		/Installing the new server build/.test(copy),
		false,
		`the new attempt must not open on the old attempt's phase: ${copy}`,
	);
	assert.match(copy, /Please wait while the server is being updated/, copy);
});

test("the pinned box holds one message, and the error takes it", () => {
	const handle = mountNotification();
	updater.emit("backend-update-available", SERVER_UPDATE_OFFER);
	handle.render();
	/*
	 * D6: this offer raises NO notice of its own. The panel already reads "Server
	 * version X is available", so the toast in the opposite corner was the same
	 * news twice in two spellings ("v0.55.10" against "0.55.10") - and it only ever
	 * appeared for the arm that manages the update, which is the arm whose panel the
	 * reader is looking at. The box therefore starts empty on this path.
	 */
	assert.equal(
		visible(handle).length,
		0,
		`the offer must not raise a notice of its own: ${JSON.stringify(visible(handle))}`,
	);
	assert.ok(showsText(handle, "Server update available"));

	// UX U6's own repro: a check the user pressed fails while the offer stands.
	updater.emit(
		"backend-update-error",
		checkReport(
			"Error checking for updates: getaddrinfo ENOTFOUND api.github.com",
		),
	);
	handle.render();

	const shown = visible(handle);
	assert.equal(
		shown.length,
		1,
		`the box holds one message: ${JSON.stringify(shown)}`,
	);
	assert.equal(shown[0].variant, "danger");
	/*
	 * The message is the app's own sentence about what happened and what to do,
	 * with the machine's words subordinate under it. It used to BE the machine's
	 * words: this report's real payload is a Node errno form, and the box read
	 * `Error checking for updates: getaddrinfo ENOTFOUND api.github.com` or, for
	 * the app channel, nothing but `net::ERR_INTERNET_DISCONNECTED` - the alert
	 * the operator saw over their chat screen on a machine that was online.
	 */
	const [sentence, ...rest] = shown[0].lines;
	assert.match(sentence, /could not reach the update server/i);
	assert.match(sentence, /connection/i);
	assert.equal(sentence.includes("getaddrinfo"), false, sentence);
	assert.equal(sentence.includes("ENOTFOUND"), false, sentence);
	/*
	 * And the machine's own words are still there, beneath it and on their own
	 * line, because the code is the part a bug report needs: `ENOTFOUND` is the
	 * finding, and the sentence is the account of what it means.
	 */
	assert.deepEqual(rest, ["getaddrinfo ENOTFOUND api.github.com"]);
	// The offer is a panel, not a toast: the box yielding its duplicate leaves the
	// offer itself on screen behind the message.
	assert.ok(showsText(handle, "Server update available"));

	// The error wins while it is UP, not for ever: closing it empties the box.
	pinnedToast(handle).props.onClose();
	handle.render();
	assert.equal(visible(handle).length, 0, "closing must free the box");

	// And the next offer raises nothing either, so the box STAYS empty while the
	// panel moves: there is no notice left on this branch to repaint.
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		latestVersion: "0.55.11",
	});
	handle.render();
	assert.equal(visible(handle).length, 0, JSON.stringify(visible(handle)));
	/*
	 * The panel is the carrier, and it is the thing that moved - matched by
	 * CONTAINMENT, because the sentence is now built from two readings in one `<p>`
	 * rather than being a lone text child (`showsText` matches exactly).
	 */
	assert.ok(
		allCopy(handle).some((text) =>
			/Server version 0\.55\.11 is available/.test(text),
		),
		`the panel is the carrier: ${JSON.stringify(allCopy(handle))}`,
	);
});

/**
 * The defer controls are closers too, and they have to clear the error (R3-1).
 *
 * The UX U6 case above drives the toast's own dismissal. The other two ways out
 * of the box are the panels' "Update later" controls, which closed it with a bare
 * `setSnackbarOpen(false)` - so the error stayed SET behind a closed box, and
 * `FloatingAlert` had already cancelled its auto-hide timer, so nothing would ever
 * clear it. The next message to raise the box then repainted the superseded error
 * in its place. The completion notice is the sharp end of that: it is the one
 * branch whose toast is its only carrier, so the stale error replaces the news
 * rather than joining it. This case is the reviewer's own repro, driven through
 * the shipped offer panel's control instead of the alert's `onClose`.
 */
test("the offer's defer control closes the box, so a stale error cannot repaint", () => {
	const handle = mountNotification();
	updater.emit("backend-update-available", SERVER_UPDATE_OFFER);
	handle.render();

	// A check the user pressed fails while the offer stands: the error takes the box.
	updater.emit(
		"backend-update-error",
		checkReport("Unable to determine backend version."),
	);
	handle.render();
	assert.equal(visible(handle)[0].variant, "danger");

	control(handle, "Update later").props.onClick();
	handle.render();
	assert.equal(visible(handle).length, 0, "deferring must close the box");

	updater.emit("backend-update-completed", undefined);
	handle.render();
	const shown = visible(handle);
	assert.equal(shown.length, 1, JSON.stringify(shown));
	assert.equal(shown[0].variant, "success");
	assert.match(shown[0].text, /Server update completed successfully/);
});

/**
 * The same invariant on the OTHER defer control (review R3-1).
 *
 * The UI offer's "Update later" has its own handler, so it had its own bare
 * `setSnackbarOpen(false)` and its own way to leave the error set. The next offer
 * is what surfaces it: with the error still set the box shows the superseded
 * failure message and the offer's own notice never renders.
 */
test("the UI offer's defer control closes the box too", () => {
	const handle = mountNotification();
	updater.emit("update-available", { version: "0.25.9" });
	handle.render();

	updater.emit("update-error", "Error checking for updates: boom");
	handle.render();
	assert.equal(visible(handle)[0].variant, "danger");

	control(handle, "Update later").props.onClick();
	handle.render();
	assert.equal(visible(handle).length, 0, "deferring must close the box");

	updater.emit("update-available", { version: "0.25.10" });
	handle.render();
	const shown = visible(handle);
	assert.equal(shown.length, 1, JSON.stringify(shown));
	assert.equal(shown[0].variant, "info");
	assert.match(shown[0].text, /0\.25\.10/);
});

test("the by-hand panel replaces the in-flight one without a second message", async () => {
	const handle = mountNotification();
	startServerUpdate(handle);

	/*
	 * A server the app does not own: the main process answers with the by-hand
	 * panel instead of running pip, and the `false` behind it is the SAME outcome -
	 * so the toast must not be raised as well.
	 */
	updater.emit("backend-update-manual-required", {
		message:
			"The server is installed outside the app, so use the tool you installed it with.",
		command: "uv tool upgrade local-operator",
		latestVersion: "0.55.10",
		currentVersion: "0.55.9",
		sourceBuild: false,
	});
	handle.render();
	assert.ok(showsText(handle, "The server needs updating by hand"));

	await settleServerUpdate(handle, false);
	assert.equal(
		dangerToasts(handle).length,
		0,
		"one failure is one message, and the panel already carries it",
	);
	assert.equal(showsText(handle, "The server update didn't finish"), false);
});

test("a rejected invoke leaves the in-flight panel too", async () => {
	const handle = mountNotification();
	startServerUpdate(handle);

	await settleServerUpdate(handle, new Error("channel closed"));

	assert.equal(showsText(handle, "Updating server"), false);
	assert.ok(
		showsText(handle, "The server update could not be started: channel closed"),
		JSON.stringify(visible(handle)),
	);
	assert.equal(dangerToasts(handle).length, 0);
});

/**
 * The alert a check the user ASKED FOR fails with, held and given an owner for
 * the retry its copy names (design round 1, D2/D3; UX U1/U3).
 *
 * Two defects in one surface, and a still could not show either: the alert had
 * `autoHideDuration={6000}` - written for the one-line machine string it used to
 * carry - and `closeSnackbar` clears the `error` with the box, so a failure the
 * user had asked for was gone with no trace; and its sentence says "then try
 * again" while the only control on it was the X.
 */
test("a failure the user asked for is held, and its retry is a button", () => {
	const handle = mountNotification();
	updater.emit("update-error", "net::ERR_CONNECTION_REFUSED");
	handle.render();

	const alert = pinnedToast(handle);
	assert.ok(alert, JSON.stringify(visible(handle)));
	assert.equal(
		alert.props.autoHideDuration,
		undefined,
		"nothing may take this off the screen on a timer",
	);
	assert.equal(alert.props.variant, "danger");

	const [sentence] = linesOf(alert.props.children);
	assert.match(sentence, /could not reach the update server/i);
	assert.equal(sentence.includes("net::ERR"), false, sentence);

	// The retry the sentence names, as a control rather than a promise.
	const retry = alert.props.action;
	assert.ok(retry, "the alert must offer the action its copy asks for");
	assert.equal(retry.props.children, "Try again");
	const before = updater.checks.length;
	retry.props.onClick();
	assert.equal(updater.checks.length, before + 1, "it runs a check");
	assert.equal(
		updater.checks.at(-1).options?.manual,
		true,
		"and it is a check the user asked for, so its failure would be reported",
	);

	// The machine's own words are still there, subordinate and labelled.
	assert.deepEqual(linesOf(alert.props.children).slice(1), [
		"net::ERR_CONNECTION_REFUSED",
	]);
});

/**
 * The other half of the operator's rule (QA round 1, Q1): the check the app runs
 * for itself reports nothing when it fails. The mount effect's check sends no
 * `manual`, so neither its rejection nor an error event may paint.
 */
test("the app's own start-up check reports nothing when it fails", async () => {
	const handle = mountNotification({ autoCheck: true });
	const pending = updater.checks.shift();
	assert.ok(pending, "the mount must have started the app's own check");
	assert.equal(
		pending.options,
		undefined,
		"and it is not one the user asked for",
	);

	pending.resolve(
		Promise.reject(
			new Error(
				"Error invoking remote method 'check-for-updates': Error: net::ERR_INTERNET_DISCONNECTED",
			),
		),
	);
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();

	assert.deepEqual(
		visible(handle),
		[],
		"a start-up check's failure is logged, never painted",
	);
});

/**
 * UX round 2, U7: the card the reader pressed `Try again` on must stay put while
 * that retry runs. It used to unmount for the app's own 1 s + 3 s ladder - the
 * component clears `error` before it awaits - so for four seconds nothing on
 * screen said a check was running, and with a working feed the card vanished and
 * never returned: "it is working" and "it is fixed" started identically.
 */
test("the failure card stays up while its own retry runs, and a success ends it", async () => {
	const handle = mountNotification();
	updater.emit("update-error", "net::ERR_CONNECTION_REFUSED");
	handle.render();

	const before = pinnedToast(handle);
	assert.ok(before, JSON.stringify(visible(handle)));
	const retry = before.props.action;
	assert.equal(retry.props.children, "Try again");

	retry.props.onClick();
	handle.render();

	/*
	 * STILL THERE, and saying what it is doing: the button the reader pressed is the
	 * one that carries the in-progress state (`retrying={checking}`), which could not
	 * be reached before because the card was gone by the time the check started.
	 */
	const during = pinnedToast(handle);
	assert.ok(during, "the card may not vanish under the reader's finger");
	assert.equal(
		during.props.action.props.children,
		"Checking...",
		"and the pressed control says so",
	);
	assert.equal(during.props.action.props.disabled, true);

	// The check the retry started, answered: a success is what ends the card.
	await settleCheck(handle, { isUpdateAvailable: false });

	assert.equal(
		pinnedToast(handle),
		undefined,
		"a retry that worked ends the failure it was answering",
	);
});

/**
 * QA round 3, Q-1/Q-2: ONE failure paints ONE box.
 *
 * Two components painted this event - the app-level `UpdateNotification` and, inside
 * the Settings tree, `CheckForUpdatesButton`. QA measured them two runs of two: the
 * same 400x192 rect at the same z-index, both `role="alert"`, each with its own
 * `Copy details` and `Try again`, each clearing only itself - so after a retry
 * SUCCEEDED one box cleared while the other stayed on screen still saying the app
 * could not reach the update server. The app-level alert owns the box now: it is
 * mounted wherever the button is, it holds until dismissed, it carries the retry, and
 * a successful check clears it. The Settings surface paints none of its own - only
 * its panels about the server and the bundle, which are a different subject.
 *
 * The first half of this case fails on the head before it: that tree paints a danger
 * alert for exactly this failure.
 */
test("one failure paints one box, and it is the app-level alert that owns it", async () => {
	const settings = mount();
	press(settings);
	settings.render();
	updater.emit("update-error", "net::ERR_CONNECTION_REFUSED");
	await settleCheck(settings, new Error("net::ERR_CONNECTION_REFUSED"));
	assert.deepEqual(
		dangerToasts(settings),
		[],
		"the Settings surface must not paint a second box for the failure the app-level alert owns",
	);

	const app = mountNotification();
	updater.emit("update-error", "net::ERR_CONNECTION_REFUSED");
	app.render();
	assert.equal(
		dangerToasts(app).length,
		1,
		"the failure is painted exactly once",
	);
	assert.ok(
		pinnedToast(app).props.action,
		"and the box that owns it is the one carrying the retry",
	);
});

/**
 * Press the section's own control, through its own `onClick`.
 *
 * The control is found in the rendered tree rather than called by name, so the
 * handler under test is the one the shipped section wires up. Two notes on
 * fidelity: a real DOM would refuse the click while `disabled` and this harness
 * does not (the double-press case below is the reachable version of that race,
 * where both clicks land in one tick before React commits `checking`), and the
 * handler returns a promise nobody awaits - the component's own async flow, not
 * a test-controlled one.
 */
function press(handle) {
	const control = walk(handle.tree).find(
		(node) => node.type === Button && typeof node.props?.onClick === "function",
	);
	assert.ok(control, "the section must render its check control");
	control.props.onClick();
}

/* --------------------------------------------------------------------- cases */

test("a check that proved both channels current shows the sentence", async () => {
	const handle = mount();
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"nothing is claimed before a check",
	);
	press(handle);
	handle.render();
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
});

test("Q1: the next check retires the sentence before it resolves", async () => {
	const handle = mount();
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);

	// The second press, WITH the check still unanswered: the claim is already
	// gone, because until the check answers there is nothing proving it.
	press(handle);
	handle.render();
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"a started check must retire the previous verdict's claim",
	);

	// And the offer that check produces does not bring it back: this is the
	// reported pair - offer panel plus "you are up to date" - one check later.
	await answer(handle, SERVER_OFFER);
	assert.equal(affirmationOnScreen(handle), null);
	assert.deepEqual(
		visible(handle),
		[],
		"a null affirmation shows no button message",
	);
});

test("Q1: a background offer retires the sentence with no press at all", async () => {
	const handle = mount();
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);

	// A real `{silent:true}` check emits its events even though the periodic
	// caller never applies its verdict to this button (QA's second repro).
	updater.emit("backend-update-available", {
		...SERVER_UPDATE_OFFER,
		manual: false,
	});
	handle.render();
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"an offer makes the whole-installation sentence false, whoever raised it",
	);
});

test("Q1: every offer channel retires the sentence, not just the server's", async () => {
	for (const [event, payload] of [
		["update-available", { version: "0.22.4" }],
		[
			"update-npx-available",
			{ currentVersion: "0.22.3", latestVersion: "0.22.4" },
		],
		/*
		 * The producer's own shape, not a two-field stand-in: `UpdateNotification`'s
		 * offer handler reads `updateCommand`, and a payload without it is a fixture the
		 * app never sends (the unguarded read that then throws is recorded in the
		 * handoff, not changed here).
		 */
		["backend-update-available", { ...SERVER_UPDATE_OFFER }],
	]) {
		const handle = mount();
		press(handle);
		await answer(handle, CURRENT);
		assert.equal(affirmationOnScreen(handle), CURRENT.affirmation, event);
		updater.emit(event, payload);
		handle.render();
		assert.equal(affirmationOnScreen(handle), null, `${event} must retire it`);
	}
});

test("Q1: an inconclusive or offered verdict leaves no sentence behind", async () => {
	for (const verdict of [
		SERVER_OFFER,
		INCONCLUSIVE,
		{ app: "available", server: "current", affirmation: null },
	]) {
		const handle = mount();
		press(handle);
		await answer(handle, CURRENT);
		assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
		press(handle);
		handle.render();
		await answer(handle, verdict);
		assert.equal(
			affirmationOnScreen(handle),
			null,
			`${JSON.stringify(verdict)} must not leave the earlier sentence up`,
		);
	}
});

test("Q1: an older check resolving late cannot repaint its verdict", async () => {
	const handle = mount();

	// Check A starts, then check B starts before A answers (a press can also be
	// followed by the periodic check's own resolve, and `checking` only guards
	// the button, not the ordering of resolves).
	press(handle);
	press(handle);
	handle.render();

	// A - the OLDER one - answers with the affirmation, after B has begun. It
	// must not paint: B owns the screen and has not spoken yet.
	const older = updater.checks[0];
	const newer = updater.checks[1];
	older.resolve(CURRENT);
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();
	assert.equal(
		affirmationOnScreen(handle),
		null,
		"the superseded check's affirmation arrived after a newer check started",
	);

	// B answers with the same verdict, and now the sentence is legitimate.
	newer.resolve(CURRENT);
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	await new Promise((resolve) => realSetTimeout(resolve, 0));
	handle.render();
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
});

test("Q1: an offer does not dismiss a message that is not the affirmation", async () => {
	/*
	 * MOUNTED ON THE COMPONENT THAT OWNS THE BOX (QA round 3, Q-1). This case used the
	 * Settings button's own error toast as its "message that is not the affirmation";
	 * that toast is gone, because one failure paints one box and the app-level alert is
	 * it - so the property is asserted where the box now lives.
	 */
	const handle = mountNotification();
	updater.emit("update-error", "Error checking for updates: boom");
	handle.render();
	assert.deepEqual(
		visible(handle).map((alert) => alert.variant),
		["danger"],
	);
	/*
	 * The producer's own shape, not a two-field stand-in: this component's offer
	 * handler reads `updateCommand`, and a payload without it is a fixture the app
	 * never sends (see the note in the handoff about that field being unguarded).
	 */
	updater.emit("backend-update-available", SERVER_UPDATE_OFFER);
	handle.render();
	assert.deepEqual(
		visible(handle).map((alert) => alert.variant),
		["danger"],
		"an unrelated offer must not close an error toast",
	);
});
