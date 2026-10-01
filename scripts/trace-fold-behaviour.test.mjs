import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE FOLD'S BEHAVIOURS, driven through the SHIPPED component.
 *
 * `trace-fold-model.test.mjs` asserts the ARITHMETIC (what folds, what the
 * summary says, the span, the live clause). This file asserts what the pure
 * model cannot: when the fold is OPEN. Those are the rules the operator's two
 * reports are about, and the failure they guard against is exactly the kind
 * nobody sees in a still:
 *
 *   - a group that ARRIVES OPEN (the shipped defect: auto-opened for the newest
 *     turn and never closed, so a finished turn was a wall of expanded groups);
 *   - a fold that closes UNDER THE READER while its conversation updates -
 *     which is every close this component used to own. The 2026-09-27 report
 *     is the spec now: "they shouldn't be closed/contracted simply by state
 *     updates if they've been explicitly opened." The condense #537 shipped
 *     (close once, when the section stops being live) was written for the
 *     auto-open that no longer exists; with groups arriving condensed its
 *     remaining client was the READER'S OWN fold - measured on the rig closing
 *     at every turn end (`expanded true -> false`) - so the close is gone and
 *     the reader's press is the only one left, in BOTH directions: an
 *     explicitly-closed fold must not be re-opened by updates either.
 *
 * WHY A MOUNT AND NOT A FRAME. A frame says what the condensed and expanded
 * states LOOK like; it cannot say why a fold that was open is now closed, and
 * the closes this file polices are transitions with guards rather than states.
 * jsdom has no layout engine, so "the rows are visible" is asserted as the
 * component's own contract - the rows are in the DOM, and the collapsed state
 * unmounts them (`Disclosure` renders `isOpen && children`) - never as
 * geometry. Pixels live on the rig (`scripts/scroll-shift-evidence.mjs`) and in
 * `docs/evidence/scroll-shift/`.
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
// React 18's `act` refuses to work, and warns per call, unless the environment
// says it is a test one (`scripts/browser-file-transfer-row.test.mjs:48`'s
// rule); without it every act() below floods stderr (agent review R5).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

/**
 * Controlled the way the transcript drives it, so the mount exercises the
 * SHIPPED contract rather than a self-managed fold: `open` comes in, the
 * press is reported upward, and the harness keeps that state across
 * re-renders the way the transcript's registry does (`fold-open.ts`).
 */
const ControlledFold = ({ initialOpen = false, ...props }) => {
	const [open, setOpen] = React.useState(initialOpen);
	return createElement(
		TraceFold,
		{ ...props, open, onOpenChange: setOpen },
		createElement("span", { "data-testid": "fold-row" }, "row"),
	);
};

/** The running call the frames use: `wait` blocks for an hour, named in words. */
const LIVE = { verb: "Running", object: "pnpm vitest run" };

// Top-level (biome's `useTopLevelRegex`): the copy these assertions pin.
const SUMMARY_MIXED = /3 shell · 1 python/;
const SUMMARY_UPDATED = /4 shell · 1 python/;
const SUMMARY_GROWN = /5 shell · 1 python/;
const NEVER_A_ZERO = /0s/;
const LIVE_SPAN_SECONDS = /^4[45]s$/;

const element = (props) =>
	createElement(ControlledFold, {
		summary: "3 shell · 1 python",
		actionCount: 4,
		recordIds: ["t0"],
		...props,
	});

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

/*
 * The media is a stand-in here on purpose: this file bundles the FOLD, and the
 * real strip pulls this repository's MUI tree in through `CanonicalImage`,
 * which node's ESM resolver will not take (the same reason
 * `chat-image-expand.test.mjs` bundles its picture components its own way).
 * What this file asserts is the FOLD's half: the media is on screen while the
 * group is condensed, gone when the reader opens it, and the same node across
 * the live-to-settled transition.
 *
 * THE PICTURE'S OWN HALF IS NOT ASSERTED HERE, and that is now stated rather
 * than implied (agent review round 1, P2: the body claimed node identity on the
 * `[data-fold-media]` subtree's `<img>` while this file's media was a `<span>`,
 * so the claim had no assertion behind it in either file). The `<img>`'s survival
 * across the settle is asserted in `chat-image-expand.test.mjs`, which mounts the
 * real `TraceFold` + `FoldMedia` + `CanonicalImage` + `ImageAttachment` tree; the
 * name of that test says which node it holds. Anything this file says about a
 * picture is about the SLOT the fold reserves for one.
 */
const mediaStrip = () =>
	createElement("span", { "data-testid": "fold-media" }, "picture");

test("a condensed run keeps the pictures its rows would have drawn", async (t) => {
	/*
	 * The operator's report, as a behaviour: a group that has produced a picture
	 * is condensed, and the picture is on screen anyway. Before this, the only
	 * way to the artifact was the very press condensing exists to make
	 * unnecessary.
	 */
	const mounted = await mount(t, {
		span: null,
		live: null,
		sectionLive: false,
		condensedMedia: () => mediaStrip(),
	});
	assert.equal(rows(mounted), 0, "the group arrives condensed");
	assert.ok(
		mounted.container.querySelector('[data-testid="fold-media"]'),
		"and the picture it produced is on screen anyway",
	);

	/* Pressing is what puts the strip away - the rows draw the picture then. */
	await click(mounted);
	assert.equal(rows(mounted), 1);
	assert.equal(
		mounted.container.querySelector('[data-testid="fold-media"]'),
		null,
		"open, the rows draw their own media and the strip would double it",
	);
});

test("a run with no pictures is the group it was", async (t) => {
	/*
	 * The overwhelmingly common case: the fold must not grow a slot, a rule or an
	 * empty row for an image nobody produced. The wrapper's own child count is
	 * the claim - the disclosure, and nothing beside it.
	 */
	const mounted = await mount(t, {
		span: null,
		live: null,
		sectionLive: false,
		condensedMedia: undefined,
	});
	assert.equal(
		mounted.container.querySelector('[data-testid="fold-media"]'),
		null,
	);
	assert.equal(
		mounted.container.firstElementChild.childElementCount,
		1,
		"the condensed fold is its header and nothing else",
	);
});

test("the picture does not flicker at the settle transition", async (t) => {
	/*
	 * The manager's second question, as an assertion a still cannot make. The
	 * image a call wrote lands WHILE the run is live, and the group is condensed
	 * in both windows (a fold arrives condensed; only the reader opens it). The
	 * risk is not that the picture is missing - it is that the settle transition
	 * re-mounts it, which the eye reads as a flicker and which a fresh `img` pays
	 * for again in decode time.
	 */
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 11_000, running: true },
		live: LIVE,
		sectionLive: true,
		condensedMedia: () => mediaStrip(),
	});
	const liveNode = mounted.container.querySelector(
		'[data-testid="fold-media"]',
	);
	assert.ok(liveNode, "the picture is there while the run is still going");

	// The section ends and its last call settles: the one event that condenses.
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: null,
		sectionLive: false,
		condensedMedia: () => mediaStrip(),
	});
	assert.equal(
		mounted.container.querySelector('[data-testid="fold-media"]'),
		liveNode,
		"the same node survives the transition rather than a fresh one",
	);
	assert.equal(
		liveClause(mounted),
		null,
		"the header is the part that settles",
	);
});

test("a group arrives condensed and names the running call", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
	});
	assert.equal(rows(mounted), 0, "the rows are not on screen until asked for");
	assert.equal(liveClause(mounted), "Running pnpm vitest run");
	assert.equal(spanText(mounted), "22s", "first start to last completion");
	assert.match(mounted.container.textContent, SUMMARY_MIXED);
});

test("the reader's press opens it, and conversation updates leave it open", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
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
	});
	assert.equal(
		rows(mounted),
		1,
		"an update to a running section never closes the reader's fold",
	);
	assert.match(mounted.container.textContent, SUMMARY_UPDATED);
	/*
	 * THE LIVE-AND-IDLE WINDOW: the run's calls have all settled but the TURN is
	 * still finishing. Updates keep arriving here - the target of the operator's
	 * report - and the fold is the reader's throughout.
	 */
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: null,
	});
	assert.equal(
		rows(mounted),
		1,
		"a live section with nothing in flight does not close the reader's fold",
	);
	/*
	 * THE SECTION'S OWN END - the event the shipped condense closed on, and the
	 * close the 2026-09-27 report rules out for an explicitly-opened fold:
	 * "they shouldn't be closed/contracted simply by state updates if they've
	 * been explicitly opened." Measured on the rig before this change: the fold
	 * went `expanded true -> false` on this exact transition, at every turn end.
	 */
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: 45_000, running: false },
		live: null,
	});
	assert.equal(
		rows(mounted),
		1,
		"the section's end does not close a fold the reader opened",
	);
	// And the next turn's updates find it exactly as the reader left it.
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 46_000, endedAtMs: null, running: true },
		live: LIVE,
	});
	assert.equal(
		rows(mounted),
		1,
		"a fold the reader opened survives the next turn's updates too",
	);
});

test("the reader's own press is the only close, in both directions", async (t) => {
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: LIVE,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1);
	await click(mounted);
	assert.equal(rows(mounted), 0, "the reader can always put it back");
	/*
	 * BOTH DIRECTIONS (the report's own ask): a fold the reader CLOSED is as much
	 * theirs as one they opened, and no update may re-open it - the close is a
	 * decision, not a default.
	 */
	await mounted.render({
		summary: "5 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: null, running: true },
		live: LIVE,
	});
	assert.equal(
		rows(mounted),
		0,
		"a fold the reader closed is not re-opened by updates",
	);
	assert.match(mounted.container.textContent, SUMMARY_GROWN);
	// And their next press opens it again, for good.
	await click(mounted);
	await mounted.render({
		summary: "6 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: null, running: true },
		live: LIVE,
	});
	assert.equal(
		rows(mounted),
		1,
		"re-opening is the reader's, and stays open under updates",
	);
});

test("the section ending while the fold is open never closes it", async (t) => {
	/*
	 * THE TRANSITION THIS PINS: the section was LIVE and stops being so while the
	 * reader watches. On the unfixed tree that transition armed and fired the
	 * component's own condense (`!sectionLive && armed && live === null`) and shut
	 * the reader's fold; the fixed component has no condense to fire. `sectionLive`
	 * is not part of this component's contract any more - it rides along so THIS
	 * case can drive the old trigger on the base tree in a before/after swap.
	 */
	const mounted = await mount(t, {
		span: { startedAtMs: 1_000, endedAtMs: null, running: true },
		live: LIVE,
		sectionLive: true,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1, "the press is the one thing that opens it");
	await mounted.render({
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: null,
		sectionLive: false,
	});
	assert.equal(
		rows(mounted),
		1,
		"a section ending under the reader never closes their fold",
	);
});

test("a fold the reader opens after its section ended stays open", async (t) => {
	// The restored-history shape, and the failed-row jump's: the fold has never
	// been live in this mount, and nothing about its section's state changes
	// what the reader's press means.
	const mounted = await mount(t, {
		span: null,
		live: null,
	});
	await click(mounted);
	assert.equal(rows(mounted), 1);
	await mounted.render({ span: null, live: null });
	assert.equal(rows(mounted), 1, "its section ended before the reader arrived");
});

test("no stamps, no clock - and never a `0s`", async (t) => {
	const mounted = await mount(t, {
		span: null,
		live: null,
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
	});
	assert.equal(spanText(mounted), "0.3s");
});

test("a live span computes against now and keeps ticking", async (t) => {
	// Started 45s ago and still in flight: the header reads the elapsed span,
	// and the clock interval is armed while it runs.
	const mounted = await mount(t, {
		span: { startedAtMs: Date.now() - 45_000, endedAtMs: null, running: true },
		live: LIVE,
	});
	assert.match(spanText(mounted) ?? "", LIVE_SPAN_SECONDS);
});
