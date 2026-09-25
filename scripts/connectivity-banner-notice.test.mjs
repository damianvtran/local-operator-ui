import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

import { daemonRecord, loadBackendComposers } from "./backend-composers.mjs";

/*
 * A DISMISSAL MUST NOT OUTLIVE THE NOTICE IT DISMISSED (agent round 2, R2-3).
 *
 * WHY THIS FILE EXISTS. The address-substitution notice is the one band in this app
 * that may be dismissed, and the flag behind that was a plain `useState(false)` with a
 * doc comment explaining that it is deliberately never reset. The comment was right
 * about the case it was defending - a re-render must not undo a control the operator
 * pressed - and wrong about the case next door, which no test covered: dismiss "back on
 * the configured address", let the app substitute again (that band carries no dismissal,
 * so it paints), and the SECOND return was swallowed by a flag about a notice that had
 * already been replaced. The operator's second return to their own address was silent,
 * which is the same invisibility design round 1's D1 exists to remove, one state over.
 *
 * WHY IT RENDERS RATHER THAN READING THE FLAG. The subject is a TRANSITION across three
 * snapshots that the component is mounted through - dismissed, replaced by another
 * notice, and back - and no assertion over the source can see it. `scripts/
 * connectivity-banner-copy.test.mjs` pins the copy table; this pins what a mounted
 * component does when main's snapshots move under it.
 *
 * NO REAL DAEMON, NO REAL CONFIG: the bridge is stubbed with the snapshots main
 * publishes for these states, and the config answer is the story file's own stub. The
 * repo's own rule for an isolated run (`AGENTS.md`) is why the harness builds its
 * fixture home under `mkdtemp`, and this file never reads or writes the operator's
 * config root.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>");
/*
 * jsdom's window IS the DOM, but it is not the global environment the bundled
 * component runs in: React and Radix reference `HTMLElement`-family constructors as
 * bare globals, which jsdom defines on its window and Node does not define at all. So
 * every property the window owns is promoted, not just `window` and `document` - the
 * same bootstrap `scripts/backend-settings-collapse.test.mjs` measured its way to.
 */
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few of jsdom's own accessors refuse to be read out of context; the
		// constructors the components need are plain and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
// React refuses to flush effects synchronously outside a test environment, and says so
// once per `act`; the flag is the whole of what it wants.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * jsdom's own `navigator` (the internet hook reads `navigator.onLine`): Node has a
 * global `navigator` too - without `onLine` on it - and it is defined as a getter with
 * no setter, so the promotion loop above skips it and a plain assignment throws.
 */
Object.defineProperty(globalThis, "navigator", {
	value: bootstrapDOM.window.navigator,
	configurable: true,
});
const { createRoot } = await import("react-dom/client");
after(() => {
	// The window is the module's, not a test's: closing it per test would leave the
	// second one rendering into a dead document.
	bootstrapDOM.window.close();
});

/** The snapshots main publishes, and the bridge that hands them to the renderer. */
const bridgeState = { snapshot: null, listeners: new Set() };
window.api = {
	backend: {
		getStatus: async () => bridgeState.snapshot,
		// Retry asks main to try; this file is not about the attempt.
		reconnect: async () => bridgeState.snapshot,
		onStatusChange: (listener) => {
			bridgeState.listeners.add(listener);
			return () => bridgeState.listeners.delete(listener);
		},
	},
	desktop: {
		request: async (request) =>
			request?.op === "config.get"
				? { status: 200, body: { result: { values: { hosting: "local" } } } }
				: { status: 404, body: { message: "not stubbed in this harness" } },
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ConnectivityBanner } from "./src/renderer/src/shared/components/common/connectivity-banner";
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
	// React stays external so the bundle shares ONE copy with this file's own imports:
	// two copies give the component a different dispatcher than the one `act` drives.
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	/*
	 * Vite's `import.meta.env` is read at IMPORT time by the app's config loader, which the
	 * banner pulls in through the connectivity hook: bundling for node leaves it
	 * undefined, the loader iterates it, and the module throws before a single test runs.
	 * The URL is dead on purpose - nothing in this file reaches a service, the bridge is a
	 * stub. Same trap, same fix as `scripts/browser-chrome.test.mjs` records.
	 */
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45998" };',
	},
	jsx: "automatic",
	write: false,
});

// Written to a real file rather than imported as a data: URL: modules resolved from a
// data: URL have no base path for the renderer's aliases.
const bundlePath = new URL(
	"./_connectivity-banner-notice.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
process.on("exit", () => {
	// Best effort; the assertion path below also unlinks it.
	unlink(bundlePath).catch(() => {});
});

const { QueryClient, QueryClientProvider, ConnectivityBanner, createElement } =
	await import(bundlePath.href);

const DARK = "http://127.0.0.1:1111";
const FALLBACK = "http://127.0.0.1:8080";

/*
 * The holder and act clauses are the COMPOSER'S OUTPUT, not a copy of it (agent round 4,
 * R4-2): this fixture used to carry the sentence by hand, so the round-3 change that
 * stopped the act rendering markdown delimiters never reached it - the copy here still
 * had the backticks, and the assertion that no shipped sentence carries one could not see
 * them. `refusals` is the same single daemon the story names.
 */
const { describeHolders, reclaimClause } = await loadBackendComposers();
const refusals = [daemonRecord()];

const snapshot = (over = {}) => ({
	state: "attached",
	reconnecting: false,
	owned: false,
	url: DARK,
	instanceId: "i".repeat(43),
	pid: 4242,
	version: "0.54.47",
	prefix: null,
	installKind: null,
	desktopAvailable: true,
	pairing: { available: true, cause: null },
	failures: 0,
	capabilityStatus: null,
	unanswered: 0,
	lastTransportAt: null,
	addressSubstitution: null,
	detail: `Connected to the daemon on ${DARK} (pid 4242, v0.54.47).`,
	updatedAt: Date.now(),
	...over,
});
const returned = () =>
	snapshot({
		addressSubstitution: {
			kind: "returned",
			configured: DARK,
			serving: FALLBACK,
		},
	});
const substituted = () =>
	snapshot({
		url: FALLBACK,
		addressSubstitution: {
			kind: "substituted",
			configured: DARK,
			serving: FALLBACK,
			holder: describeHolders(refusals),
			reclaim: reclaimClause(refusals),
		},
	});

/** What a person can read on the page. */
const text = () => document.body.textContent ?? "";

/**
 * Settle React, then the queries, until `check` holds or the budget runs out.
 *
 * A poll rather than a single `await`: the health answer arrives through a promise the
 * test does not own, and a fixed number of microtask turns is the kind of timing
 * assumption this repo's own guidance refuses.
 */
const until = async (check, what, budgetMs = 4_000) => {
	const deadline = Date.now() + budgetMs;
	for (;;) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		if (check()) return;
		if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
	}
};

/** Hand the renderer a new snapshot the way main does. */
const push = async (next) => {
	bridgeState.snapshot = next;
	await act(async () => {
		for (const listener of bridgeState.listeners) listener(next);
	});
};

const mount = async (t) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			try {
				mounted.root?.unmount();
			} finally {
				// React Query arms a garbage-collection timer per cached query, and the
				// default is five minutes: without this the timers outlive the assertions
				// and hold the event loop open after the last test.
				mounted.client?.clear();
			}
		});
		mounted.container?.remove();
		bridgeState.listeners.clear();
		await unlink(bundlePath).catch(() => {});
	});
	mounted.client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
		},
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	bridgeState.snapshot = returned();
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				// The 3 s poll is off: the stub answers the same snapshot forever, so
				// polling adds nothing but a race with the assertions.
				createElement(ConnectivityBanner, { autoCheck: false }),
			),
		);
	});
	return mounted;
};

const dismiss = async () => {
	const button = [...document.querySelectorAll("button")].find(
		(candidate) => candidate.getAttribute("aria-label") === "dismiss",
	);
	assert.ok(button, "the dismissible notice offers the control");
	await act(async () => {
		button.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

test("a dismissed return notice is re-armed when the app substitutes again", async (t) => {
	await mount(t);
	await until(
		() => text().includes("Back on"),
		"the return notice to be rendered",
	);
	await dismiss();
	await until(
		() => !text().includes("Back on"),
		"the dismissal to take effect",
	);

	/* The app moves to the fallback address again: that band carries no dismissal. */
	await push(substituted());
	await until(
		() => text().includes("Serving on"),
		"the fallback band after the substitution",
	);

	/*
	 * THE FIXTURE IS THE COMPOSER'S OUTPUT, AND THIS IS WHAT PROVES IT (agent round 1,
	 * M1). Until this assertion existed, this file took `holder`/`reclaim` from
	 * `describeHolders`/`reclaimClause` in NAME only: nothing here read them, so a change
	 * to the act clause - the round-3 removal of its markdown delimiters, for instance -
	 * moved the band and left this suite green, which is why the review found the binding
	 * here was not load-bearing. The rendered sentence is now compared against the
	 * composer in the same run that draws it.
	 */
	assert.ok(
		text().includes(reclaimClause(refusals)),
		"the band renders the composer's own act clause",
	);
	assert.ok(
		!text().includes("`"),
		"and no shipped sentence carries a backtick (design round 3, D18)",
	);

	/*
	 * THE ASSERTION THIS FILE EXISTS FOR. The second return is a NEW notice, not the one
	 * that was dismissed, so it must be shown - and under the old flag (never reset) it
	 * was swallowed for the life of the window.
	 */
	await push(returned());
	await until(
		() => text().includes("Back on"),
		"the SECOND return notice, which the first dismissal had been silencing",
	);
	assert.match(text(), /Back on http:\/\/127\.0\.0\.1:1111/);
});

test("a dismissal holds while the notice it dismissed is still the one on screen", async (t) => {
	await mount(t);
	await until(
		() => text().includes("Back on"),
		"the return notice to be rendered",
	);
	await dismiss();
	await until(
		() => !text().includes("Back on"),
		"the dismissal to take effect",
	);
	/*
	 * The other half of the rule, so the fix cannot be "reset on every snapshot": a
	 * re-render of the SAME notice must leave the operator's press alone. A snapshot that
	 * only moves the probe counters is exactly that.
	 */
	await push({ ...returned(), updatedAt: Date.now() + 1_000 });
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 50));
	});
	assert.doesNotMatch(
		text(),
		/Back on/,
		"a re-render of the notice it dismissed does not undo the press",
	);
});
