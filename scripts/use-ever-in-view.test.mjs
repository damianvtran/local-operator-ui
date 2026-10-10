import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { StrictMode, act, createElement } from "react";

/*
 * `use-ever-in-view` — the latch that decides whether a Files-grid row has been
 * near the viewport, executable.
 *
 * WHY THIS FILE EXISTS (agent review round 2, R2-1). The hook observes the row
 * and must disconnect on unmount. Its first version built the observer in the
 * ref callback and disconnected it from a mount effect, which is correct
 * wherever React runs one mount pass and wrong under `React.StrictMode` — the
 * mode the app mounts itself in (`main.tsx`): React 18 simulates a remount by
 * running every effect through mount → cleanup → mount, and it does NOT
 * re-invoke the ref callback for that simulated remount. The cleanup therefore
 * killed the only observer and nothing built another, so in `pnpm dev` every
 * Files-grid media row sat on its grey placeholder forever. A production build
 * has one mount pass and was unaffected, which is why the round-1 frames (from
 * a build) could not see it.
 *
 * REAL: the shipped `use-ever-in-view.ts`, bundled from source, mounted on a
 * real DOM under this tree's own `react`/`react-dom` (18.3.1) with `StrictMode`
 * and `act` — the harness `transcript-paging-hook.test.mjs` and
 * `browser-queue-expiry.test.mjs` already use for a hook.
 *
 * SUBSTITUTED: `IntersectionObserver`, which jsdom does not implement and whose
 * geometry is not what this file is about. The fake records every instance and
 * whether it still observes anything, so "is there a LIVE observer" is a
 * countable fact rather than an inference; entries are delivered through the
 * real callback the hook handed it, so the hook's own decision is what runs.
 */

const ROOT = resolve(import.meta.dirname, "..");

// React DOM feature-detects its host at import time, so the document has to
// exist before it is loaded (the bootstrap `browser-queue-expiry.test.mjs` uses).
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

after(() => {
	bootstrapDOM.window.close();
	// `Reflect.deleteProperty` rather than `delete`, which the lint contract
	// forbids: the property has to be genuinely gone, not set to `undefined`.
	Reflect.deleteProperty(globalThis, "window");
	Reflect.deleteProperty(globalThis, "document");
	Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	Reflect.deleteProperty(globalThis, "IntersectionObserver");
});

/** Every observer the mounts below created, oldest first. */
const created = [];

class FakeIntersectionObserver {
	constructor(callback) {
		this.callback = callback;
		this.observing = new Set();
		this.disconnected = false;
		created.push(this);
	}

	observe(element) {
		this.observing.add(element);
	}

	unobserve(element) {
		this.observing.delete(element);
	}

	disconnect() {
		this.disconnected = true;
		this.observing.clear();
	}

	/** Deliver an intersection as a real observer would, from outside React. */
	intersect() {
		const target = [...this.observing][0];
		act(() => {
			this.callback([{ isIntersecting: true, target }], this);
		});
	}
}

/** Observers that are still watching a node — what the hook's contract needs. */
const liveObservers = () =>
	created.filter(
		(observer) => !observer.disconnected && observer.observing.size,
	);

function installObserver() {
	created.length = 0;
	Object.defineProperty(globalThis, "IntersectionObserver", {
		configurable: true,
		writable: true,
		value: FakeIntersectionObserver,
	});
}

const PROBE = `
	import { useEffect, useState } from "react";
	import { useEverInView } from "./src/renderer/src/shared/hooks/use-ever-in-view";

	/*
	 * The hook under test on a real node. It reports every latch value it
	 * renders, and publishes its node-swap setter so a case can replace the
	 * observed element the way a conditionally rendered slot would — the ref is
	 * handed a node, null, then another node.
	 */
	export function renderEverInViewProbe(onSeen, publishSwap) {
		const Probe = () => {
			const [ref, seen] = useEverInView();
			const [swapped, setSwapped] = useState(false);
			useEffect(() => {
				publishSwap(setSwapped);
			}, [publishSwap]);
			useEffect(() => {
				onSeen(seen);
			}, [onSeen, seen]);
			return swapped ? (
				<span ref={ref} data-ever-in-view="swapped" />
			) : (
				<div ref={ref} data-ever-in-view="first" />
			);
		};
		return Probe;
	}
`;

const CACHE = join(ROOT, "node_modules", ".cache", "use-ever-in-view");
const bundled = await build({
	stdin: { contents: PROBE, resolveDir: ROOT, loader: "tsx" },
	bundle: true,
	format: "esm",
	platform: "node",
	// React stays the tree's own, so the mount below is a real one.
	packages: "external",
	jsx: "automatic",
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "use-ever-in-view.mjs");
writeFileSync(bundlePath, bundled.outputFiles[0].text);
const { renderEverInViewProbe } = await import(
	new URL(`file://${bundlePath}`).href
);

/**
 * Mount the probe, with or without `StrictMode`, and hand the case the latch
 * values it reported and the two moves a case makes: swap the node, unmount.
 */
async function mount({ strict }) {
	const reports = [];
	let swap = null;
	const host = bootstrapDOM.window.document.createElement("div");
	bootstrapDOM.window.document.body.appendChild(host);
	const root = createRoot(host);
	const Probe = renderEverInViewProbe(
		(seen) => reports.push(seen),
		(setter) => {
			swap = setter;
		},
	);
	const tree = strict
		? createElement(StrictMode, null, createElement(Probe))
		: createElement(Probe);
	await act(async () => {
		root.render(tree);
	});
	return {
		host,
		reports,
		seen: () => reports.at(-1),
		row: () => host.querySelector("[data-ever-in-view]"),
		swap: () =>
			act(async () => {
				swap((value) => !value);
			}),
		unmount: () =>
			act(async () => {
				root.unmount();
				host.remove();
			}),
	};
}

test("with no IntersectionObserver the answer is 'seen' at once, and nothing is built", async () => {
	Reflect.deleteProperty(globalThis, "IntersectionObserver");
	const mounted = await mount({ strict: false });
	assert.equal(
		mounted.seen(),
		true,
		"a host that cannot observe must not lose its thumbnails to the observer being absent",
	);
	assert.equal(created.length, 0, "and there is nothing to observe with");
	await mounted.unmount();
});

test("a row scrolls into view: one live observer, the latch, and it disconnects", async () => {
	installObserver();
	const mounted = await mount({ strict: false });
	assert.equal(
		mounted.seen(),
		false,
		"a row nobody has scrolled to must not report itself as read",
	);

	const live = liveObservers();
	assert.equal(live.length, 1, "exactly one live observer watches the row");
	assert.equal(
		live[0].observing.has(mounted.row()),
		true,
		"and it watches the row's own node",
	);

	live[0].intersect();
	assert.equal(mounted.seen(), true, "an intersection latches the answer");
	assert.equal(
		liveObservers().length,
		0,
		"and the observer is finished with: the latch is never revoked, so one answer is all it owes",
	);

	await mounted.unmount();
});

test("StrictMode's simulated remount leaves a live observer (R2-1)", async () => {
	installObserver();
	const mounted = await mount({ strict: true });
	assert.equal(
		mounted.seen(),
		false,
		"the latch starts unset in a strict mount too",
	);

	/*
	 * The regression, stated as the invariant rather than as a sequence: whatever
	 * the simulated remount's cleanup does, the row is observed when the mount
	 * settles. Pre-fix this read 0 - the cleanup disconnected the callback's
	 * observer and no second one was ever built - which is what left every
	 * Files-grid media row on its placeholder in `pnpm dev`.
	 */
	const live = liveObservers();
	assert.equal(
		live.length,
		1,
		"exactly one observer watches the row after the simulated remount",
	);
	assert.equal(
		live[0].observing.has(mounted.row()),
		true,
		"and it watches the row",
	);

	live[0].intersect();
	assert.equal(
		mounted.seen(),
		true,
		"so a row that scrolls into view under `pnpm dev` still reads its thumbnail",
	);
	assert.equal(liveObservers().length, 0, "the latch disconnects it");

	await mounted.unmount();
});

test("a row un-mounted before it is ever seen takes its observer with it", async () => {
	installObserver();
	const mounted = await mount({ strict: true });
	const watched = liveObservers();
	assert.equal(watched.length, 1, "the row is watched while it is mounted");

	await mounted.unmount();
	assert.equal(
		watched[0].disconnected,
		true,
		"the cleanup is real: nothing keeps observing a node that is gone",
	);
	assert.equal(liveObservers().length, 0);
});

test("a row whose element is replaced is watched on the new node", async () => {
	installObserver();
	const mounted = await mount({ strict: false });
	const first = liveObservers();
	assert.equal(first.length, 1, "the first element is watched");

	await mounted.swap();
	const second = liveObservers();
	assert.equal(second.length, 1, "the replacement gets its own observer");
	assert.notEqual(
		second[0],
		first[0],
		"which is not the one that was watching",
	);
	assert.equal(
		second[0].observing.has(mounted.row()),
		true,
		"and it watches the node that is on screen",
	);
	assert.equal(
		first[0].disconnected,
		true,
		"while the observer of the node that left is disconnected",
	);

	second[0].intersect();
	assert.equal(
		mounted.seen(),
		true,
		"a latch on the replaced node still answers",
	);

	await mounted.unmount();
});
