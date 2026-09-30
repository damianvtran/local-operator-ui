/**
 * The reload picker's ending, executable.
 *
 *     node --test scripts/reload-picker-close.test.mjs
 *
 * Issue #679: submitting the "Reload this conversation" picker re-read the
 * session, re-attached the stream and painted a success receipt - and then left
 * the dialog open, still offering Reload and Done over the transcript it had just
 * replaced. Every neighbouring picker in the same file closes on pick, so the
 * cost was a mandatory extra press for no information.
 *
 * What this file drives is the shipped `ReloadPicker` in a real DOM, through the
 * real submit control, against a faked TRANSFER and nothing else:
 *
 *   - success: the picker closes, the stream is rebound once, and the receipt
 *     sentence survives as a toast;
 *   - failure: the dialog is still there, its inline error is readable, and
 *     NOTHING was rebound - a reload that did not happen must not tear down the
 *     stream it would have replaced.
 *
 * What this is NOT: evidence about pixels. jsdom has no layout engine; the frame
 * for this state is `docs/evidence/update-reload-ux/`.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const DOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/chat",
});
/*
 * Assigned through `globalise` rather than declared, because some of these names
 * are getters on modern Node's global object (`navigator` on 26): a plain
 * assignment throws there and takes the whole file with it. The set, and the
 * reasons for the two non-jsdom entries, are `picker-host-selection.test.mjs`'s -
 * this file mounts the same Radix dialog through the same host.
 */
const globalise = (name, value) => {
	try {
		globalThis[name] = value;
	} catch {
		Object.defineProperty(globalThis, name, { value, configurable: true });
	}
};
globalise("window", DOM.window);
globalise("document", DOM.window.document);
globalise("navigator", DOM.window.navigator);
globalise("localStorage", DOM.window.localStorage);
globalise("HTMLElement", DOM.window.HTMLElement);
globalise("HTMLInputElement", DOM.window.HTMLInputElement);
globalise("Element", DOM.window.Element);
globalise("Node", DOM.window.Node);
globalise("KeyboardEvent", DOM.window.KeyboardEvent);
globalise("MouseEvent", DOM.window.MouseEvent);
globalise("Event", DOM.window.Event);
/*
 * `CustomEvent` is the one Radix actually dispatches (its dismissable layer's
 * focus-outside event and `dispatchUpdate`), and Node has its own global of that
 * name: a Node-realm event on a jsdom document throws `parameter 1 is not of
 * type 'Event'` inside the dependency, which is a harness bug and not a finding.
 */
globalise("CustomEvent", DOM.window.CustomEvent);
globalise("FocusEvent", DOM.window.FocusEvent);
globalise("PointerEvent", DOM.window.PointerEvent ?? DOM.window.MouseEvent);
globalise("getComputedStyle", DOM.window.getComputedStyle);
globalise("MutationObserver", DOM.window.MutationObserver);
globalise("IS_REACT_ACT_ENVIRONMENT", true);
/*
 * jsdom ships no canvas backend, and its `getContext` THROWS rather than
 * answering null - so a module that measures a monospace cell at import time
 * (the app's console default width, reached through this module graph) takes the
 * whole test file down before a case runs. Null is the answer `measureCell`
 * already handles: it falls back to the em-derived cell, which is the value a
 * process with no DOM gets, and nothing here is a question about cell metrics.
 */
DOM.window.HTMLCanvasElement.prototype.getContext = () => null;
/*
 * THE FRAME CLOCK, AND WHY IT IS A REAL ONE.
 *
 * jsdom has no frame clock of its own (`requestAnimationFrame` is absent unless
 * `pretendToBeVisual` is asked for), and the promotion above then assigns
 * `undefined` to the global - so a dialog that mounts through Radix, whose
 * presence effects schedule their work on exactly that function, would be
 * scheduling into nothing.
 *
 * A frame on a macrotask is what `picker-host-selection.test.mjs` uses, and it is
 * the shape that was MEASURED to work here; two other answers were not. jsdom's
 * `pretendToBeVisual` drives its clock with a timer that outlives the cases, so
 * the file never finished, and a queue drained by hand left work pending across
 * a promise continuation that no case had a chance to drain.
 */
globalise("requestAnimationFrame", (callback) => setTimeout(callback, 0));
globalise("cancelAnimationFrame", (handle) => clearTimeout(handle));
/*
 * Two observers Radix's focus scope needs and jsdom lacks: it reads a media
 * query on mount and observes the DOM for layout. Stubbed here rather than left
 * to fail inside a dependency - the subject of this file is the picker's ending,
 * not Radix's observers.
 */
globalise("matchMedia", (query) => ({
	matches: false,
	media: String(query),
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
}));
globalise(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);
/*
 * jsdom implements no scrolling, and the picker host scrolls its list on mount
 * and to bring the active row into view. Both are real behaviour this file does
 * not measure, so the calls are stubbed rather than left to throw.
 */
DOM.window.Element.prototype.scrollTo = () => {};
DOM.window.Element.prototype.scrollIntoView = () => {};
/*
 * Closing the window is the teardown: the frames above are real timers, and a
 * window left open keeps the file's own task pending after every case has
 * passed.
 */
after(() => {
	DOM.window.close();
});

const ROOT = process.cwd();
const CACHE = join(ROOT, "node_modules/.cache/reload-picker-close");

/** The answer the faked transport gives for the NEXT `sessions.get`. */
let nextAnswer = () => Promise.reject(new Error("no answer installed"));
/** Every toast the shipped component raised, in order. */
const toasts = [];

/*
 * THE TWO SEAMS, AND WHY THEY ARE THE ONLY ONES. `desktopResult` is the transfer
 * itself - faking it is what lets a case choose the backend's answer, and there
 * is no way to drive a failure path without it. `showSuccessToast` is the
 * assertion surface for the receipt's survival past the dialog, and sonner's own
 * observer needs a frame clock this harness would otherwise have to fake twice.
 * Everything else - the picker, its host, its footer, `cn` - is the shipped code.
 */
const stubs = {
	"@shared/api/local-operator/desktop-api": `
		export * from "${resolve("src/renderer/src/shared/api/local-operator/desktop-api.ts")}";
		export const desktopResult = (request) => globalThis.__desktopResult(request);
	`,
	"@shared/utils/toast-manager": `
		export * from "${resolve("src/renderer/src/shared/utils/toast-manager.ts")}";
		export const showSuccessToast = (message) => globalThis.__successToast(message);
	`,
	/*
	 * `@shared/themes` is the BARREL, and the barrel reaches `theme-provider` and
	 * `base-theme` - the two modules that import `@mui/material/styles` as a bare
	 * directory specifier, which Node's ESM resolver refuses outright
	 * (`ERR_UNSUPPORTED_DIR_IMPORT`). Nothing about this case is a question about
	 * the theme registry, so the registry is the third seam: the picker's own
	 * appearance adapter reads it, and the reload picker never does.
	 */
	"@shared/themes": `
		export const DEFAULT_THEME = "localOperatorDark";
		export const themes = {};
	`,
};

const bundle = await build({
	stdin: {
		contents: `
			export { ReloadPicker, reloadReceipt } from "./src/renderer/src/features/chat/pickers/destination-pickers";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	// React stays OUT of the bundle so the module under test uses this process's
	// React - the one `createRoot` below is holding. A second bundled copy would
	// render a tree from a different React and quietly test nothing.
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	jsx: "automatic",
	loader: { ".css": "empty" },
	alias: {
		"@shared": resolve("src/renderer/src/shared"),
		"@features": resolve("src/renderer/src/features"),
		"@renderer": resolve("src/renderer/src"),
	},
	plugins: [
		{
			name: "picker-seams",
			setup(builder) {
				const names = Object.keys(stubs);
				builder.onResolve(
					{ filter: new RegExp(`^(${names.join("|")})$`) },
					(args) => ({
						path: args.path,
						namespace: "picker-seam",
					}),
				);
				builder.onLoad({ filter: /.*/, namespace: "picker-seam" }, (args) => ({
					contents: stubs[args.path],
					loader: "js",
					resolveDir: ROOT,
				}));
			},
		},
	],
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "reload-picker-close.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);

globalThis.__desktopResult = (request) => nextAnswer(request);
globalThis.__successToast = (message) => {
	toasts.push(message);
	return "toast-id";
};

const { ReloadPicker, reloadReceipt } = await import(`file://${bundlePath}`);
const React = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");

/* ------------------------------------------------------------------ harness */

const buttonByText = (text) =>
	[...document.querySelectorAll("button")].find(
		(button) => (button.textContent ?? "").trim() === text,
	);

/**
 * Mount the picker and press Reload.
 *
 * The press goes through the SHIPPED control - the footer's primary button,
 * whose `onClick` is what calls `submit` - rather than through a hand-called
 * handler, because "the dialog closed" is a fact about the tree and not about a
 * function's return value.
 */
const pressReload = async ({ cold = false, rows = 3, fail = false } = {}) => {
	document.body.innerHTML = "";
	toasts.length = 0;
	let closed = 0;
	const rebound = [];
	nextAnswer = async (request) => {
		assert.equal(request.op, "sessions.get", "the picker asks for a snapshot");
		assert.equal(request.sessionId, "session-1");
		if (fail) throw new Error("the owner is not running");
		return {
			payload: { cold, history: { entries: new Array(rows).fill({}) } },
		};
	};

	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	/*
	 * THE HARNESS PLAYS THE HOST, and that is the whole reason this case can say
	 * anything about "closed". `onClose` is not the picker hiding itself: the
	 * picker's OWNER stops rendering it, which is what the registry does for every
	 * picker in this file. A harness that only counted the calls would leave the
	 * dialog on screen and could not tell "closed" from "reported closed" - and
	 * "reported closed" is exactly the state the defect produced, so it would pass
	 * on the bug.
	 */
	const picker = () =>
		React.createElement(ReloadPicker, {
			sessionId: "session-1",
			onClose: () => {
				closed += 1;
			},
			rebind: (id) => {
				rebound.push(id);
			},
		});
	const render = () => root.render(closed > 0 ? null : picker());

	await act(async () => {
		render();
	});
	assert.ok(buttonByText("Reload"), "the picker offers its own submit control");

	await act(async () => {
		buttonByText("Reload").dispatchEvent(
			new DOM.window.MouseEvent("click", { bubbles: true }),
		);
		// The answer to a failure is synchronous-ish; to a success it lands on a
		// microtask, so the host's own re-render is asked for again below.
		render();
	});
	await act(async () => {
		await Promise.resolve();
		render();
	});

	return {
		container,
		closed: () => closed,
		rebound,
		root,
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
		},
	};
};

test("the receipt sentence is one spelling, exported for both readers", () => {
	assert.equal(
		reloadReceipt("session-1", false, 3),
		"Reopened session-1: live owner attached, 3 recent rows.",
	);
	assert.equal(
		reloadReceipt("session-1", true, 0),
		"Reopened session-1: cold (no owner running), 0 recent rows.",
	);
});

test("a successful reload closes the picker, rebinds once, and keeps the receipt", async () => {
	const run = await pressReload({ cold: false, rows: 3 });

	assert.equal(run.closed(), 1, "the dialog is dismissed once");
	assert.deepEqual(run.rebound, ["session-1"], "the stream is rebound once");
	assert.deepEqual(
		toasts,
		["Reopened session-1: live owner attached, 3 recent rows."],
		"the receipt survives the dialog as a toast",
	);
	/*
	 * And the dialog really is gone, not merely reported closed: the footer's own
	 * "Done" control is what a still-open dialog would still be offering. The
	 * dialog is PORTALLED to `document.body`, so the question is asked of the
	 * document - the harness's own container holds none of it.
	 */
	/*
	 * A BOOLEAN rather than the node itself. `assert.equal(node, undefined)`
	 * renders the node in the failure diff, and inspecting a jsdom element walks a
	 * graph big enough to hang the reporter outright - measured here as a file
	 * that never finished, reported as "Promise resolution is still pending" with
	 * no failing case ever printed. The question is presence, so ask it as one.
	 */
	assert.equal(
		buttonByText("Done") === undefined,
		true,
		"no dialog is left holding a Reload button over the reloaded transcript",
	);
	await act(async () => {
		run.root.unmount();
	});
});

test("a failed reload keeps the dialog and its own reason, and rebinds nothing", async () => {
	const run = await pressReload({ fail: true });

	assert.equal(run.closed(), 0, "the dialog stays open for a failure");
	assert.deepEqual(
		run.rebound,
		[],
		"a reload that did not happen tears down no stream",
	);
	assert.equal(toasts.length, 0, "and it does not claim success");
	assert.match(
		document.body.textContent ?? "",
		/The conversation could not be reopened: the owner is not running/,
		"the reason is still readable in the dialog",
	);
	assert.ok(buttonByText("Reload"), "and the action is still offered");
	await act(async () => {
		run.root.unmount();
	});
});
