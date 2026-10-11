/*
 * The language row: the one settings control whose write renegotiates what the
 * interface is rendered in.
 *
 * The slice's contract (RFC 2.5): one backend setting, written identically by
 * config.yml, the TUI's /settings and this row; every surface reads its effect
 * through the capabilities chain; and the row itself SHOWS the effect - the
 * `In effect:` line under its picker reads the same i18n store every formatter
 * and message lookup reads.
 *
 * What this file proves, in the three cases below: the line follows the store
 * and appears on no other row; a write to the language key is followed by a
 * capabilities renegotiation, and the line moves once the answer lands; and a
 * write to any other key renegotiates nothing, because no other key changes
 * what the interface is rendered in.
 *
 * What it cannot claim: jsdom has no layout engine, so "the row is on screen"
 * is DOM presence and ancestry, not geometry (the geometry rigs own that). The
 * backend hop is staged at the desktop bridge (`window.api`) below;
 * the op sequence and the store, not the Python, are what is asserted.
 *
 * The harness is `backend-settings-collapse.test.mjs`'s, deliberately: esbuild
 * bundles the shipped section against the renderer's own aliases, the DOM is
 * jsdom with a real `react-dom/client` root, the desktop transport is aliased
 * to a scripted bridge, and both queries are seeded so only the interactions under test
 * reach the wire.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time, so give it a document
// before loading it rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
/*
 * jsdom's window IS the DOM, but it is not the global environment the bundled
 * component runs in: Radix's primitives reference `HTMLFormElement` /
 * `HTMLSelectElement` as bare globals, which jsdom defines on its window and
 * Node does not define at all. Every property the window owns is promoted, not
 * just `window` and `document` (the collapse suite's measured rule).
 */
/*
 * `Event` and friends exist in Node (>= 15), so the promotion loop below would
 * SKIP them and Radix would then dispatch a NODE-realm event onto jsdom's
 * document (`ERR_INVALID_ARG_TYPE` from `dispatchEvent`, measured here on the
 * dismissable layer). These constructors are therefore forced from jsdom even
 * where a same-named global exists - the sibling suite's measured list.
 */
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
	"DOMRectReadOnly",
	"getComputedStyle",
	"requestAnimationFrame",
	"cancelAnimationFrame",
];
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis && !FORCE_FROM_JSDOM.includes(key)) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of context; the ones the
		// components need (`HTML*Element`, `Event`, `getComputedStyle`) do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
/*
 * The reveal effect's two jsdom holes (`Element.scrollIntoView` and a bare
 * `CSS.escape`), stubbed exactly as the sibling DOM-driven suites stub them.
 */
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The scripted transport, AT THE BRIDGE.
 *
 * `window.api.desktop.request` is the seam every desktop op crosses - the
 * section's writes AND the capabilities chain's refetch, which `desktop-hooks`
 * reaches through a RELATIVE import a module alias cannot see. Scripting the
 * bridge instead of the module therefore covers both import forms with ONE
 * replacement, and keeps the real `desktop-api` (deadline, error mapping) and
 * `desktop-hooks` (keys, gating) in the graph.
 *
 * Bodies carry `desktopResult`'s `{ result }` envelope - the decode the real
 * module performs, so nothing here re-implements its unwrapping.
 *
 * The capabilities answer is STATEFUL on purpose: `setCapabilitiesLanguage`
 * stages "the backend accepted the write and now serves the new language",
 * which is the backend hop a jsdom run cannot otherwise cross. Everything else
 * answers the way the routes do.
 */
const apiCalls = [];
let capabilitiesLanguage = "en";
const setCapabilitiesLanguage = (language) => {
	capabilitiesLanguage = language;
};

/**
 * The configured fixture, with the language row moved off its default.
 *
 * A non-default row is what renders `Use default`, which is this harness's
 * write path: an enum draft cannot be driven through Radix's portal in jsdom,
 * and `settings.reset` is the SAME `renegotiateIfLanguage` call site the save
 * path uses - both write the one backend setting, through the one helper.
 */
const settingsPayload = () => {
	const payload = JSON.parse(
		readFileSync(
			"scripts/fixtures/backend-settings-registry-configured.json",
			"utf8",
		),
	);
	for (const setting of payload.settings) {
		if (setting.key === "language") {
			setting.value = "en";
			setting.is_default = false;
		}
	}
	return payload;
};

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			apiCalls.push({ ...request });
			if (request?.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: { settings: 1, i18n: 1 },
							language: capabilitiesLanguage,
						},
					},
				};
			}
			if (request?.op === "settings.list") {
				return { status: 200, body: { result: settingsPayload() } };
			}
			return { status: 200, body: { result: {} } };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: [
			'import { createElement } from "react";',
			'export { QueryClient, QueryClientProvider } from "@tanstack/react-query";',
			'export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";',
			'export { backendSettingsKeys, BackendSettingsSection } from "./src/renderer/src/features/settings/components/backend-settings-section";',
			'export { useI18nLocaleSync } from "./src/renderer/src/shared/i18n/locale-sync";',
			'export { applyCapabilities, currentLocale } from "./src/renderer/src/shared/i18n";',
			/*
			 * The stub is observed FROM the bundle, not from a second direct
			 * import: a separate import would be a second module instance with
			 * its own `calls` array, and the assertions would read an empty log
			 * while the component talked to the other copy.
			 */
			"export { createElement };",
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions;
	// the desktop transport is scripted at `window.api` above.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React stays external so the bundle shares ONE copy with this file's own
	// imports: two copies give the component a different dispatcher than the one
	// `act` drives.
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL(
	"./_settings-language-row.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	backendSettingsKeys,
	desktopKeys,
	BackendSettingsSection,
	useI18nLocaleSync,
	applyCapabilities,
	currentLocale,
} = await import(bundlePath.href);

/** The store is module state: every case starts from the same resolved value. */
const resetStore = () => applyCapabilities(null);

const LANGUAGE_ROW = '[data-setting-key="language"]';
const TIME_FORMAT_ROW = '[data-setting-key="display.time_format"]';
const HOSTING_ROW = '[data-setting-key="hosting"]';

const rowFor = (selector) => document.querySelector(selector);

/** The row's own note, by its full text - the picker's value spans must not match. */
const noteOf = (selector) => {
	const row = rowFor(selector);
	if (!row) return null;
	return (
		[...row.querySelectorAll("span")].find((el) =>
			el.textContent.startsWith("In effect:"),
		)?.textContent ?? null
	);
};

/** The row's own `Use default`, the write path this harness can drive. */
const resetButton = (selector) => {
	const row = rowFor(selector);
	if (!row) return null;
	return [...row.querySelectorAll("button")].find((el) =>
		el.textContent.includes("Use default"),
	);
};

/**
 * Poll a condition under `act`, which is what lets the interaction's async
 * chain (op -> invalidation -> refetch -> store -> render) finish: every sleep
 * runs inside `act`, so React's effects and the query cache's notifications
 * flush between checks instead of warning about updates outside it.
 */
const settle = async (cond, note, ms = 4000) => {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (cond()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
	assert.ok(cond(), note);
};

const mount = async (t) => {
	const mounted = { client: null, root: null, container: null };
	t.after(async () => {
		try {
			await act(async () => {
				mounted.root?.unmount();
			});
		} finally {
			// React Query arms a garbage-collection timer per cached query; a
			// mounted query with `gcTime: 0` drops on unmount, and `clear` is
			// the belt to that braces - without either, the timers outlive the
			// assertions and hold the event loop open.
			mounted.client?.clear();
		}
		mounted.container?.remove();
	});
	mounted.client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			gcTime: 0,
		},
	});
	/*
	 * Both queries are seeded: this file is about the interaction's effect on
	 * what renders and which ops the invalidation emits, not about the initial
	 * wire. `invalidateQueries` refetches ACTIVE queries regardless of
	 * `staleTime`, so the language write still reaches the bridge.
	 */
	mounted.client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1, i18n: 1 },
		language: "en",
	});
	mounted.client.setQueryData(backendSettingsKeys.all, settingsPayload());
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	const render = (props) =>
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(
					React.Fragment,
					null,
					createElement(BackendSettingsSection, props),
					createElement(LocaleSync, null),
				),
			),
		);
	mounted.render = render;
	await act(async () => {
		render({});
	});
	return mounted;
};

/*
 * The renderer's app-level binding (`app.tsx` mounts this once): the hook that
 * mirrors every capabilities answer into the i18n store. Mounted here because
 * the store following the refetch IS the contract under test - without it the
 * invalidation would refetch and nothing observable would move.
 */
const LocaleSync = () => {
	useI18nLocaleSync();
	return null;
};

const rerender = async (mounted, props) => {
	await act(async () => {
		mounted.render(props);
	});
};

const click = async (el, note) => {
	assert.ok(el, note);
	await act(async () => {
		el.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};

/*
 * Node's runner sets NO default per-test timeout, so a body that never settles
 * parks the run instead of failing it. The green path measures 0.1-25s on a
 * fleet-loaded host (the last case carries the others' teardown sleep), so 60s
 * turns a hang into a failure while leaving real work room.
 */
const TEST_TIMEOUT_MS = 60_000;

test(
	"the language row shows the store's active locale, and only that row does",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		resetStore();
		const mounted = await mount(t);
		// The row arrives by deep link, the way the palette's jump does; the
		// appearance section is closed on arrival, so without the reveal the
		// row's controls never mount.
		await rerender(mounted, { focusKey: "language" });
		await settle(
			() => noteOf(LANGUAGE_ROW) === "In effect: en",
			"the language row must show the store's locale (en, from the seeded capabilities answer)",
		);
		/*
		 * The note's semantics (round-1 U2): the live region carries an id, and
		 * the picker's describedby names it - the relationship a screen reader
		 * needs, and the one a later refactor could silently drop.
		 */
		{
			const row = rowFor(LANGUAGE_ROW);
			const note = row.querySelector("#setting-effective-language");
			assert.ok(note, "the note must carry its own id");
			assert.equal(note.getAttribute("aria-live"), "polite");
			const trigger = row.querySelector('[role="combobox"]');
			assert.ok(trigger, "the picker must be a combobox");
			assert.ok(
				(trigger.getAttribute("aria-describedby") ?? "").includes(
					"setting-effective-language",
				),
				"the picker must point at the note",
			);
		}
		// A second locale proves the line FOLLOWS the store rather than being
		// the picker's default restated.
		await act(async () => {
			setCapabilitiesLanguage("fr");
			await mounted.client.refetchQueries({
				queryKey: desktopKeys.capabilities,
			});
		});
		await settle(
			() => noteOf(LANGUAGE_ROW) === "In effect: fr",
			"a new capabilities answer must move the line to the new locale",
		);
		// And no other row carries the note: the enum above it in the same
		// section is the closest neighbour and gets none.
		await rerender(mounted, { focusKey: "display.time_format" });
		await settle(
			() => Boolean(rowFor(TIME_FORMAT_ROW)),
			"the time-format row must render",
		);
		assert.ok(
			noteOf(TIME_FORMAT_ROW) === null,
			"a non-language row must not carry the effective-language note",
		);
	},
);

test(
	"a write to the language key renegotiates the capabilities chain",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		resetStore();
		const mounted = await mount(t);
		await rerender(mounted, { focusKey: "language" });
		await settle(
			() => Boolean(resetButton(LANGUAGE_ROW)),
			"the language row is seeded off its default, so `Use default` must render",
		);
		/*
		 * The backend's next answer carries the new language: the reset returns
		 * the setting to `auto`, whose effect is the device-chosen locale - the
		 * same shape as a save. The stub is what stages the accepted write.
		 */
		setCapabilitiesLanguage("fr");
		const before = apiCalls.length;
		await click(resetButton(LANGUAGE_ROW), "the reset button must exist");
		await settle(
			() =>
				apiCalls
					.slice(before)
					.some(
						(call) => call.op === "settings.reset" && call.key === "language",
					),
			"the reset must reach the wire with the language key",
		);
		await settle(
			() => apiCalls.slice(before).some((call) => call.op === "capabilities"),
			"a language write must renegotiate the capabilities chain",
		);
		await settle(
			() => currentLocale() === "fr",
			"the store must resolve to the language the new answer carries",
		);
		await settle(
			() => rowFor(LANGUAGE_ROW)?.textContent.includes("In effect: fr"),
			"the row's line must follow the store to the new locale",
		);
		assert.ok(
			apiCalls.slice(before).findIndex((call) => call.op === "settings.reset") <
				apiCalls.slice(before).findIndex((call) => call.op === "capabilities"),
			"the renegotiation must follow the write, not precede it",
		);
	},
);

test(
	"a write to any other key renegotiates nothing",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		resetStore();
		const mounted = await mount(t);
		await rerender(mounted, { focusKey: "hosting" });
		await settle(
			() => Boolean(resetButton(HOSTING_ROW)),
			"the hosting row is off its default in the configured fixture",
		);
		const before = apiCalls.length;
		await click(resetButton(HOSTING_ROW), "the reset button must exist");
		await settle(
			() =>
				apiCalls
					.slice(before)
					.some(
						(call) => call.op === "settings.reset" && call.key === "hosting",
					),
			"the hosting reset must reach the wire",
		);
		// The refetch the save path always performs is the settings list; give
		// the chain a beat to show any capabilities call it would make.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 150));
		});
		assert.equal(
			apiCalls.slice(before).filter((call) => call.op === "capabilities")
				.length,
			0,
			"only the language key may renegotiate the capabilities chain",
		);
	},
);
