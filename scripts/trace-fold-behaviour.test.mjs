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
 * in `docs/evidence/chat-trace-fold/`.
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
		condensedMedia: mediaStrip(),
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
		condensedMedia: mediaStrip(),
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
		condensedMedia: mediaStrip(),
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
	/*
	 * THE LIVE-AND-IDLE WINDOW (agent review R1): the run's calls have all
	 * settled but the TURN is still finishing, so the section is live with no
	 * call to name. This is where a simplification - "close once the run's calls
	 * have settled" - would fold the reader's group out from under them, and no
	 * committed case covered it: `sectionLive: true` only ever appeared beside a
	 * running call. The reader's fold stays open here too; the close still comes
	 * from the section's end and only from there.
	 */
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: null,
		sectionLive: true,
	});
	assert.equal(
		rows(mounted),
		1,
		"a live section with nothing in flight does not close the reader's fold",
	);
	// And the latch is still armed: the section's own end is what closes it.
	await mounted.render({
		summary: "4 shell · 1 python",
		span: { startedAtMs: 1_000, endedAtMs: 23_000, running: false },
		live: null,
		sectionLive: false,
	});
	assert.equal(rows(mounted), 0, "the section's end finds the latch armed");
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
