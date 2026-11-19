import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * A REGISTRY JUMP IS A LANDING: it moves the reader, takes the caret, and
 * FLASHES the row it arrived at — and a second Enter on the same result does it
 * again.
 *
 * Both halves of that sentence were false in the shipped surface and neither was
 * visible to the unit suites, because `paintJumpHighlight` is called from
 * `settings-search-jump.ts` for page and section rows while a registry row is
 * walked by the Backend section's OWN reveal loop (`backend-settings-section.tsx`),
 * which focused the row and never painted (QA round 1, Q2). The reveal's guards
 * were keyed on the setting key alone, so the nonce that exists to make a second
 * Enter repeat a jump could not re-arm them: the reveal effect's dependencies
 * were `[destinationReady, focusKey]`, neither of which changes for the same key
 * (QA round 1, Q1).
 *
 * The harness is this repository's committed one for the Backend section
 * (`backend-settings-collapse.test.mjs`): the shipped component, bundled against
 * the renderer's aliases, mounted in jsdom with the queries seeded. jsdom has no
 * layout engine, so "the row is on screen" is asserted as the component's own
 * contract — rendered, focus inside, wash attribute set by the shared helper —
 * and the pixel claim belongs to the committed frames.
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom's own accessors refuse to be read out of context; the component
		// needs only the constructors this promotes.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// The reveal loop's two jsdom holes, stubbed as the collapse suite stubs them.
globalThis.CSS = { escape: (value) => String(value) };
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

globalThis.window.api = {
	desktop: { request: async () => ({ status: 200, body: {} }) },
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { backendSettingsKeys, BackendSettingsSection } from "./src/renderer/src/features/settings/components/backend-settings-section";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
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
	"./_settings-search-registry-jump.bundle.mjs",
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
} = await import(bundlePath.href);

const payload = JSON.parse(
	readFileSync(
		"scripts/fixtures/backend-settings-registry-configured.json",
		"utf8",
	),
);

/** The row a registry result for `tui.theme` lands on. */
const THEME_KEY = "tui.theme";
const WASH = "data-jump-highlight";
const TEST_TIMEOUT_MS = 30_000;

const rowOf = (key) => document.querySelector(`[data-setting-key="${key}"]`);

/** Wait for the reveal loop's rAF frames, bounded rather than assumed. */
const settleReveal = async (key) => {
	for (let i = 0; i < 24; i++) {
		const row = rowOf(key);
		if (row?.contains(document.activeElement)) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 25));
		});
	}
};

const mount = async (t, props) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			try {
				mounted.root?.unmount();
			} finally {
				mounted.client?.clear();
			}
		});
		mounted.container?.remove();
	});
	mounted.client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
			gcTime: 0,
		},
	});
	mounted.client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	mounted.client.setQueryData(backendSettingsKeys.all, payload);
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(BackendSettingsSection, props),
			),
		);
	});
	return mounted;
};

/** Re-render the same root: how a second Enter arrives on a live page. */
const rerender = async (mounted, props) => {
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(BackendSettingsSection, props),
			),
		);
	});
};

test(
	"a registry jump lands with focus, a scroll, and the shared wash (QA round 1, Q2)",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const mounted = await mount(t, { focusKey: THEME_KEY, focusNonce: 1 });
		await settleReveal(THEME_KEY);
		const row = rowOf(THEME_KEY);
		assert.ok(row, "the named registry row is rendered");
		assert.ok(
			row.contains(document.activeElement),
			"the reveal puts the caret in the row it names",
		);
		assert.ok(
			row.hasAttribute(WASH),
			"and paints the landing wash the chat rail's jumps paint",
		);
		await rerender(mounted, { focusKey: THEME_KEY, focusNonce: 1 });
	},
);

test(
	"a second Enter on the same registry result re-flashes (QA round 1, Q1)",
	{ timeout: TEST_TIMEOUT_MS },
	async (t) => {
		const mounted = await mount(t, { focusKey: THEME_KEY, focusNonce: 1 });
		await settleReveal(THEME_KEY);
		const row = rowOf(THEME_KEY);
		assert.ok(row?.hasAttribute(WASH), "the first jump flashed");
		/*
		 * The wash is removed by its own timer, and the second jump has to be able to
		 * paint it AGAIN. Clearing it by hand stands in for that timer: what this
		 * asserts is that the reveal RUNS again for the same key, which is exactly
		 * what the guards made impossible.
		 */
		row.removeAttribute(WASH);
		await rerender(mounted, { focusKey: THEME_KEY, focusNonce: 2 });
		await settleReveal(THEME_KEY);
		assert.ok(
			rowOf(THEME_KEY)?.hasAttribute(WASH),
			"a NEW nonce on the same key re-runs the reveal and re-flashes",
		);
	},
);
