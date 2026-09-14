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
					const next =
						typeof value === "function" ? value(cell.state) : value;
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
		createContext: (value) => ({ Provider: null, Consumer: null, _currentValue: value }),
		useContext: (context) => context?._currentValue,
		createRef: () => ({ current: null }),
		cloneElement: (element, props) => ({ ...element, props: { ...element.props, ...props } }),
		isValidElement: (value) => Boolean(value && typeof value === "object" && "type" in value),
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
export default { useState, useEffect, useLayoutEffect, useInsertionEffect, useRef, useCallback, useMemo, useSyncExternalStore, useDebugValue, createElement, Fragment, jsx, jsxs, jsxDEV, forwardRef, memo, createContext, useContext, createRef, cloneElement, isValidElement, Children, useId, useImperativeHandle, startTransition, useDeferredValue, useTransition };`;

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
				builder.onLoad(
					{ filter: /.*/, namespace: "affirmation-env" },
					() => ({
						contents: "export const isDevelopmentMode = () => false;",
						loader: "js",
					}),
				);
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
						export const Alert = "Alert";`,
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
	checkForAllUpdates(options) {
		return new Promise((resolve) => {
			updater.checks.push({ options, resolve });
		});
	},
	getLastInstallAttempt: async () => null,
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
updater.onBackendUpdateDevMode = updater.on("backend-update-dev-mode");
updater.onUpdateAvailable = updater.on("update-available");
updater.onUpdateNotAvailable = updater.on("update-not-available");
updater.onUpdateNpxAvailable = updater.on("update-npx-available");
updater.onBackendUpdateAvailable = updater.on("backend-update-available");
updater.onBackendUpdateNotAvailable = updater.on("backend-update-not-available");
updater.onUpdateInstallFailed = updater.on("update-install-failed");

globalThis.window = { api: { updater } };

/*
 * Imported AFTER the bridge exists, because the store module this component
 * imports is created at module scope: it must find the `window` a renderer has
 * rather than the bare global a test process starts with.
 */
const { CheckForUpdatesButton, FloatingAlert, Button } = await import(
	bundlePath.href
);
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
const INCONCLUSIVE = { app: "current", server: "unavailable", affirmation: null };

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

/** Every node in the rendered tree, depth first. */
function walk(node, out = []) {
	if (Array.isArray(node)) {
		for (const child of node) walk(child, out);
		return out;
	}
	if (!node || typeof node !== "object") return out;
	out.push(node);
	if (node.props) walk(node.props.children, out);
	return out;
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
	return shown.map((node) => ({
		variant: node.props.variant ?? "info",
		text: String(node.props.children ?? ""),
	}));
}

/** The affirmation currently on screen, or null. */
function affirmationOnScreen(handle) {
	const success = visible(handle).filter(
		(alert) => alert.variant === "success",
	);
	return success.length > 0 ? success.map((alert) => alert.text).join(" | ") : null;
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
	assert.equal(affirmationOnScreen(handle), null, "nothing is claimed before a check");
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
	assert.deepEqual(visible(handle), [], "a null affirmation shows no button message");
});

test("Q1: a background offer retires the sentence with no press at all", async () => {
	const handle = mount();
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);

	// A real `{silent:true}` check emits its events even though the periodic
	// caller never applies its verdict to this button (QA's second repro).
	updater.emit("backend-update-available", {
		currentVersion: "0.54.43",
		latestVersion: "0.54.44",
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
		["update-npx-available", { currentVersion: "0.22.3", latestVersion: "0.22.4" }],
		["backend-update-available", { currentVersion: "0.54.43", latestVersion: "0.54.44" }],
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
	for (const verdict of [SERVER_OFFER, INCONCLUSIVE, { app: "available", server: "current", affirmation: null }]) {
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
	const handle = mount();
	/*
	 * The error listener is gated on `manualCheckRef` (the message answers a
	 * check the user asked for), so a press opens that window first - and the
	 * check is deliberately left unanswered, which is the state an error arrives
	 * in.
	 */
	press(handle);
	handle.render();
	updater.emit("update-error", "Error checking for updates: boom");
	handle.render();
	assert.deepEqual(
		visible(handle).map((alert) => alert.variant),
		["danger"],
	);
	updater.emit("backend-update-available", { currentVersion: "0.54.43", latestVersion: "0.54.44" });
	handle.render();
	assert.deepEqual(
		visible(handle).map((alert) => alert.variant),
		["danger"],
		"an unrelated offer must not close an error toast",
	);
});

test("Q1: the sentence can be earned again after being taken back", async () => {
	const handle = mount();
	press(handle);
	await answer(handle, CURRENT);
	assert.equal(affirmationOnScreen(handle), CURRENT.affirmation);
	updater.emit("backend-update-available", { currentVersion: "0.54.43", latestVersion: "0.54.44" });
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


