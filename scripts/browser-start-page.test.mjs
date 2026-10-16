import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement } from "react";

/*
 * THE START PAGE AFTER A REFUSED ADDRESS (LOH-13 B, F1 round 2).
 *
 * WHY THIS FILE EXISTS, AND WHY THE ASSERTION IS MADE HERE RATHER THAN IN
 * `browser-chrome.test.mjs`. That file renders with `renderToStaticMarkup`,
 * which runs no effects and holds no state — so it can never observe the thing
 * this finding is about: what the surface DOES after an intent is refused. QA
 * round 1 found the defect through a runtime reading on the START PAGE'S OWN
 * FIELD, and its reproduction is the one this file encodes: submit an invalid
 * address from that field and the surface must come BACK to the start page with
 * the address restored, rather than stranding a blank rectangle behind the band.
 *
 * WHAT IT DRIVES. The SHIPPED `BrowserSurface`, mounted under jsdom against a
 * fake bridge whose `navigate` rejects the way main does for an unparseable
 * address (the preload forwards main's refusal as a rejection), and whose
 * `state` answers the tab's own projection. The field is filled and submitted
 * through real DOM events, so the component's own submit path runs.
 *
 * WHAT IS AND IS NOT EVIDENCE. jsdom has no layout engine and no native view:
 * what this asserts is the DOM contract — which surface is on screen and what
 * the field holds. The native half (the view actually hidden and restored in
 * the running app) belongs to `scripts/browser-chrome-proof.mjs`.
 */

// React DOM feature-detects input events at import time, so the document has to
// exist before it is loaded. A real origin, not jsdom's opaque default.
const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{
		pretendToBeVisual: true,
		url: "http://localhost/",
	},
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
/*
 * zustand's persist middleware writes through storage on every `setState`, and
 * `useCanonicalSessionsStore` (which the surface reads for its group chips) is
 * persisted: without a storage object the write throws inside the middleware.
 * The same shim `browser-chrome.test.mjs` carries, for the same reason.
 */
const memory = new Map();
globalThis.localStorage = {
	getItem: (key) => (memory.has(key) ? memory.get(key) : null),
	setItem: (key, value) => void memory.set(key, String(value)),
	removeItem: (key) => void memory.delete(key),
	clear: () => memory.clear(),
	key: (index) => [...memory.keys()][index] ?? null,
	get length() {
		return memory.size;
	},
};
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// Accessors jsdom defines on the window take no new value; the DOM globals
		// this file needs are the ones already copied above.
	}
}
// jsdom implements neither, and the surface's own effects construct both.
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.Element.prototype.scrollIntoView = () => {};
/*
 * `:modal` IS A JSDOM LANDMINE (measured 2026-09-28, recorded in
 * `browser-tab-strip-focus.test.mjs`): floating-ui's ancestor probe calls
 * `matches(":modal")`, which jsdom 26.1.0 answers by delegating back into its
 * own selector engine and spinning. A browser without `:modal` answers a
 * SyntaxError, which is what floating-ui's own try/catch is written for, so the
 * probe is made to answer that way here.
 */
const nativeMatches = dom.window.Element.prototype.matches;
dom.window.Element.prototype.matches = function matches(selector) {
	if (String(selector).includes(":modal")) {
		throw new dom.window.DOMException(
			":modal is not supported here",
			"SyntaxError",
		);
	}
	return nativeMatches.call(this, selector);
};
// React 18 reads this to decide whether `act` is real; without it every effect
// flush warns instead of being batched with the render it belongs to.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// `act` is imported here and `createRoot` inside the ENTRY bundle (which renders
// the surface): the test process only needs to drive flushes.
const { act } = await import("react");
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});
/*
 * The entry module is generated rather than committed as a fixture because the
 * subject is a COMPONENT: it takes the surface's own props and drives the same
 * controls the app's do.
 */
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserSurface } from "./src/renderer/src/features/browser/components/browser-surface";

/**
 * Mount the surface over a fake bridge.
 *
 * THE BRIDGE MODELS MAIN. \"state\" answers the projection a real host would
 * publish — which is what makes this an end-to-end reading of the surface's own
 * gate rather than a unit test of a predicate. \"navigate\" REJECTS for an
 * unparseable address, exactly as the preload forwards main's \"nav_failed\"
 * ("that is not a URL", host.ts) for a stray string like "foo bar".
 *
 * The projection is FIXED at the start state: a refused navigation creates no
 * page, so this is the truth main would be publishing throughout — and it is
 * also the state that proves the fix, because the old gate hid the start page
 * against exactly this projection.
 */
export function mount(container) {
	const startState = {
		tabs: [
			{
				tabId: 1,
				title: "",
				url: "about:blank",
				owner: "user",
				sessionId: null,
				active: true,
				restored: false,
				handedOver: false,
				failed: false,
				loading: false,
			},
		],
		activeTabId: 1,
		url: "about:blank",
		title: "",
		loading: false,
		canGoBack: false,
		canGoForward: false,
		pendingConsent: [],
		approvals: [],
		navFailure: null,
	};
	let refused = [];
	/*
	 * A FAKE BRIDGE WIDE ENOUGH TO MOUNT THE REAL SURFACE. The surface is a large
	 * component and reads many of the browser bridge's members across its own
	 * effects (the rect reporter, the view-visibility policy, the chord reporter,
	 * the projection subscription), so enumerating them here would be a second,
	 * drifting copy of the preload contract — and each omission would surface as a
	 * thrown "TypeError" from inside an effect rather than as a test failure about
	 * this finding. The members that MATTER to this test are the explicit ones
	 * ("state", the subscriptions, "navigate"); everything else answers a resolved
	 * no-op, which is what a host on the start state would answer anyway.
	 */
	const explicit = {
		state: async () => startState,
		// The projection store subscribes on the 0 -> 1 consumer edge and stops on
		// the way back, so these have to answer an unsubscribe function.
		onStateChanged: () => () => {},
		onConsentChanged: () => () => {},
		onConsentAttention: () => () => {},
		// REJECTS for an unparseable address, exactly as the preload forwards main's
		// "nav_failed" ("that is not a URL", host.ts) for a stray string like
		// "foo bar".
		navigate: async (url) => {
			refused.push(url);
			throw new Error(
				"Error invoking remote method 'browser-navigate': Error: that is not a URL",
			);
		},
	};
	window.api = {
		browser: new Proxy(explicit, {
			get: (target, key) =>
				key in target ? target[key] : () => Promise.resolve(undefined),
		}),
	};
	const root = createRoot(container);
	root.render(
		createElement(BrowserSurface, {
			tabScope: "all",
			requestScope: "all",
			hostSessionId: null,
			surfaceTag: "browser-route",
			dockSurfaceTag: "browser-route-dock",
		}),
	);
	return { refused: () => refused };
}
`;

const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "start-page.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		// `@assets` carries the brand mark, which the start page imports as a `.png`:
		// without the alias and a loader for the binary, esbuild leaves the specifier
		// for Node to resolve and the bundle throws `ERR_MODULE_NOT_FOUND` at import.
		// The image has no assertion here, so it loads empty — the same choice `.css`
		// already made (and the same pair `browser-chrome.test.mjs` carries).
		"@assets": `${process.cwd()}/src/renderer/src/assets`,
	},
	loader: { ".css": "empty", ".png": "empty" },
	write: false,
});
const bundlePath = new URL(`./_start-page-${process.pid}.mjs`, import.meta.url);
let mount;
try {
	await writeFile(bundlePath, bundle.outputFiles[0].text);
	({ mount } = await import(bundlePath.href));
} finally {
	await unlink(bundlePath).catch(() => {});
}

/** What the surface is showing right now, read the way QA read it. */
function reading() {
	const field = document.querySelector(
		'[data-tour-tag="browser-start-page-address"]',
	);
	return {
		startPage: !!document.querySelector('[data-tour-tag="browser-start-page"]'),
		fieldValue: field ? field.value : null,
		// `textContent`, not `innerText`: jsdom implements the first and leaves the
		// second undefined, which is exactly how this reading came back empty.
		band: document.querySelector('[data-tour-tag="browser-error"]')
			? document.querySelector('[data-tour-tag="browser-error"]').textContent
			: "",
	};
}

async function flush() {
	// Two turns: the refusal resolves a promise chain (run -> then), and the
	// projection read that follows it is a second await. jsdom's microtask queue
	// drains between them.
	await act(async () => {
		await new Promise((resolve) => setImmediate(resolve));
	});
	await act(async () => {
		await new Promise((resolve) => setImmediate(resolve));
	});
}

test("an invalid address from the START PAGE's own field returns to the start page with the address restored", async () => {
	const container = document.getElementById("root");
	container.innerHTML = "";
	const handle = mount(container);
	await flush();

	assert.ok(
		reading().startPage,
		"the fresh tab shows the start page before anything is attempted",
	);
	assert.equal(
		reading().fieldValue,
		"",
		"and its field starts empty, so a restored value below is the fix rather than a leftover",
	);

	// Drive the page's OWN field: the path QA's first matrix missed, and the one
	// the finding is about.
	const field = document.querySelector(
		'[data-tour-tag="browser-start-page-address"]',
	);
	const setter = Object.getOwnPropertyDescriptor(
		dom.window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, "foo bar");
		field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await act(async () => {
		field
			.closest("form")
			.dispatchEvent(
				new dom.window.Event("submit", { bubbles: true, cancelable: true }),
			);
	});
	await flush();

	assert.deepEqual(
		handle.refused(),
		["foo bar"],
		"the typed address reached main through the surface's own navigate path",
	);
	const after = reading();
	assert.ok(
		after.startPage,
		`the start page comes back after the refusal, so the user has a surface to retry from (reading: ${JSON.stringify(after)})`,
	);
	assert.equal(
		after.fieldValue,
		"foo bar",
		`the refused address is restored into the field rather than lost with the unmount (reading: ${JSON.stringify(after)})`,
	);
	assert.ok(
		after.band.length > 0,
		`and the refusal is still stated in the band above (band: ${JSON.stringify(after.band)})`,
	);
});
