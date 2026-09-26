import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE FOLD'S FOUR BEHAVIOURS, driven through the SHIPPED component.
 *
 * `trace-fold-model.test.mjs` asserts the ARITHMETIC (what folds, what the
 * summary says, the span, the live clause). This file asserts what the pure
 * model cannot: when the fold is OPEN, and when the app is allowed to close it.
 * Those are the rules the operator's report is about - "have them collapse after
 * the section is done" with two carve-outs that exist so the app never fights
 * the reader - and the failure they guard against is exactly the kind nobody
 * sees in a still:
 *
 *   - a group that ARRIVES OPEN (the shipped defect: auto-opened for the newest
 *     turn and never closed, so a finished turn was a wall of expanded groups);
 *   - a group that closes UNDER a reader watching its live section;
 *   - a group that condenses while a call inside it is still running, which
 *     would hide a live clock behind a "finished" summary;
 *   - and the settle it must fire exactly ONCE, so a fold the reader opens after
 *     the section ended - the failed-row jump opens one this way - is theirs.
 *
 * WHY A MOUNT AND NOT A FRAME. A frame says what the condensed and expanded
 * states LOOK like; it cannot say why a fold that was open is now closed, and
 * the auto-close is a transition with guards rather than a state. jsdom has no
 * layout engine, so "the rows are visible" is asserted as the component's own
 * contract - the rows are in the DOM, and the collapsed state unmounts them
 * (`Disclosure` renders `isOpen && children`) - never as geometry. Pixels live
 * in `docs/evidence/action-fold/`.
 *
 * The harness is this repository's committed one for a rendered surface: esbuild
 * bundles the shipped component against the renderer's own aliases and React
 * stays external, so the mounted tree shares THIS process's `act`; the DOM is
 * jsdom with a real `react-dom/client` root, as `backend-settings-collapse.test.mjs`
 * does.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	// `useNowMs` arms `window.setInterval`, which jsdom only owns when it is
	// visual; the fold's clock is asserted below, so the window must have one.
	pretendToBeVisual: true,
});
/*
 * jsdom's window IS the DOM, but it is not the global environment the bundled
 * component runs in: components here reference `HTMLElement`/`Element` as bare
 * globals, which jsdom defines on its window and Node does not define at all.
 */
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context; the
		// ones the components need are plain constructors and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { TraceFold } from "./src/renderer/src/features/chat/components/trace/trace-fold";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports: two copies give the component a different dispatcher than the one
	// `act` drives. `packages: "external"` is what keeps react-dom's own CJS
	// internals out of an ESM bundle, where its `require("react")` cannot resolve.
	external: ["react", "react-dom", "react/jsx-runtime"],
	packages: "external",
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: modules resolved
// from a data: URL have no base path for the renderer's aliases.
const bundlePath = new URL(
	"./_trace-fold-behaviour.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const { TraceFold, createElement } = await import(bundlePath.href);

/** The running call the frames use: `wait` blocks for an hour, named in words. */
const LIVE = { verb: "Running", object: "pnpm vitest run" };

// Top-level (biome's `useTopLevelRegex`): the copy these assertions pin.
const SUMMARY_MIXED = /3 shell · 1 python/;
const SUMMARY_UPDATED = /4 shell · 1 python/;
const NEVER_A_ZERO = /0s/;
const LIVE_SPAN_SECONDS = /^4[45]s$/;

const element = (props) =>
	createElement(
		TraceFold,
		{
			summary: "3 shell · 1 python",
			actionCount: 4,
			failedCount: 0,
			recordIds: ["t0"],
			...props,
		},
		createElement("span", { "data-testid": "fold-row" }, "row"),
	);

const mount = async (t, props) => {
	/* Teardown is armed FIRST, so a throw anywhere in a body still unmounts. */
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			mounted.root?.unmount();
		});
		mounted.container?.remove();
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	mounted.render = async (next) => {
		await act(async () => {
			mounted.root.render(element(next));
		});
	};
	await act(async () => {
		mounted.root = createRoot(mounted.container);
		mounted.root.render(element(props));
	});
	return mounted;
};

const rows = (mounted) =>
	mounted.container.querySelectorAll('[data-testid="fold-row"]').length;
const liveClause = (mounted) =>
	mounted.container.querySelector("[data-fold-live]")?.textContent ?? null;
const spanText = (mounted) =>
	mounted.container.querySelector("[data-fold-span]")?.textContent ?? null;
const click = async (mounted) => {
	const trigger = mounted.container.querySelector("button");
	assert.ok(trigger, "the fold's trigger exists");
	await act(async () => {
		trigger.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
};

test("a group arrives condensed and names the running call", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
		sectionLive: true,
	});
	assert.equal(rows(mounted), 0, "the rows are not on screen until asked for");
	assert.equal(liveClause(mounted), "Running pnpm vitest run");
	assert.equal(spanText(mounted), "22s", "first start to last completion");
	assert.match(mounted.container.textContent, SUMMARY_MIXED);
});

test("the reader's press opens it, and a live section leaves it open", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
		sectionLive: true,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1, "the press is the one thing that opens it");
	assert.equal(
		liveClause(mounted),
		null,
		"the live clause yields to the live row it would restate",
	);
	// The section keeps running and the counts update: nothing may close it.
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: true },
		live: LIVE,
		sectionLive: true,
	});
	assert.equal(
		rows(mounted),
		1,
		"a live section never closes the reader's fold",
	);
	assert.match(mounted.container.textContent, SUMMARY_UPDATED);
});

test("the section's end condenses it once, and not a moment early", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
		sectionLive: true,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1);

	// The section is over but a call in the run has not settled: no condense.
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: true },
		live: LIVE,
		sectionLive: false,
	});
	assert.equal(
		rows(mounted),
		1,
		"nothing condenses while a call in the run is still running",
	);

	// Settled: the finished section condenses.
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 45_000, running: false },
		live: null,
		sectionLive: false,
	});
	assert.equal(rows(mounted), 0, "finished sections condense");
	assert.equal(liveClause(mounted), null);
	assert.equal(spanText(mounted), "44s");

	// And it fires ONCE: reopening a finished fold makes it the reader's again.
	await click(mounted);
	assert.equal(rows(mounted), 1);
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 45_000, running: false },
		live: null,
		sectionLive: false,
	});
	assert.equal(
		rows(mounted),
		1,
		"a fold the reader reopened is not closed a second time",
	);
});

test("a fold the reader opens after its section ended stays open", async (t) => {
	// The restored-history shape, and the failed-row jump's: the fold has never
	// been live in this mount, so there is no transition to condense on.
	const mounted = await mount(t, {
		span: null,
		live: null,
		sectionLive: false,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1);
	await mounted.render({ span: null, live: null, sectionLive: false });
	assert.equal(rows(mounted), 1, "its section ended before the reader arrived");
});

test("no stamps, no clock — and never a `0s`", async (t) => {
	const mounted = await mount(t, {
		span: null,
		live: null,
		sectionLive: false,
	});
	assert.equal(
		spanText(mounted),
		null,
		"a run that cannot date itself renders no duration at all",
	);
	assert.doesNotMatch(mounted.container.textContent, NEVER_A_ZERO);
	// A sub-second span reads in the rows' own tenths, never as `0s`.
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 1_300, running: false },
		live: null,
		sectionLive: false,
	});
	assert.equal(spanText(mounted), "0.3s");
});

test("a live span computes against now and keeps ticking", async (t) => {
	// Started 45s ago and still in flight: the header reads the elapsed span,
	// and the clock interval is armed while it runs.
	const mounted = await mount(t, {
		span: { startedAtMs: Date.now() - 45_000, endedAtMs: null, running: true },
		live: LIVE,
		sectionLive: true,
	});
	assert.match(spanText(mounted) ?? "", LIVE_SPAN_SECONDS);
});
