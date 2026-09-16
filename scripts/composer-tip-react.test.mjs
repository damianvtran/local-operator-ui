import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// React DOM feature-detects input events at import time. Give it a document
// before loading it, rather than activating its legacy IE event polyfill.
const bootstrapDOM = new JSDOM("<!doctype html>");
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * THE TIP ROW'S BEHAVIOUR, which the pure modules cannot answer for.
 *
 * `composer-suggestions.test.mjs` bundles `composer-tips.ts` and can assert the
 * ring's order, its distinctness and the interval constant - all properties of
 * the values the module returns. What it cannot see is the CLOCK: that the row
 * advances on the interval, that a draft stops it, that
 * `prefers-reduced-motion` holds one entry, and that unmounting clears the
 * timer. Those are properties of the render and they live in
 * `composer-tip.tsx`, so they are tested by running the shipped component - the
 * harness its sibling surface already uses
 * (`scripts/suggestion-stack-react.test.mjs`).
 *
 * The clock is a REGISTRY rather than a faked global timer. The component calls
 * `window.setInterval`, which jsdom owns and `node:test`'s `mock.timers` would
 * not reach; a registry also makes two of the assertions sharper than a tick
 * would. The suspended and reduced-motion branches return BEFORE installing an
 * interval, so the honest assertion is that no clock exists (rather than that a
 * sentence happened not to change), and the unmount cleanup is the registry
 * emptying.
 *
 * What this file does NOT claim: that nothing moves on screen when the sentence
 * changes. jsdom has no layout engine, so the row's geometric inertness is a
 * measurement on a rendered frame (`scripts/composer-band-geometry.mjs`), not
 * something a DOM test can carry.
 */

const source = "src/renderer/src/features/chat/components/";
const bundle = await build({
	stdin: {
		contents: `
			export { ComposerTipRow } from "./${source}composer-tip";
			export { COMPOSER_TIPS, TIP_ROTATE_INTERVAL_MS } from "./${source}composer-tips";
		`,
		loader: "tsx",
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	write: false,
});
const bundlePath = new URL(
	`./_composer-tip-react-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { COMPOSER_TIPS, ComposerTipRow, TIP_ROTATE_INTERVAL_MS } = await import(
	bundlePath.href
);
await unlink(bundlePath);

const h = React.createElement;

/**
 * One mounted tip row, on a clock this file drives.
 *
 * `media` is the mutable answer to `prefers-reduced-motion`, read at mount the
 * way the hook reads it: `useMediaQuery` is a `useSyncExternalStore` over
 * `window.matchMedia`, and jsdom implements no `matchMedia` at all, so the stub
 * IS the environment here rather than a convenience.
 */
async function fixture(run) {
	const dom = new JSDOM("<div id='root'></div>", { pretendToBeVisual: true });
	const { window } = dom;
	const mediaState = { reduce: false };
	const intervals = new Map();
	let nextTimer = 1;
	let mounted = true;
	const originals = new Map();
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	window.matchMedia = (query) => ({
		media: query,
		matches: query.includes("prefers-reduced-motion")
			? mediaState.reduce
			: false,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	});
	window.setInterval = (fn, delay) => {
		const id = nextTimer++;
		intervals.set(id, { fn, delay });
		return id;
	};
	window.clearInterval = (id) => {
		intervals.delete(id);
	};

	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		/** The row's own clock, as `{fn, delay}` per live interval. */
		timers: () => [...intervals.values()],
		/** Fire every live interval once, i.e. one period elapsing. */
		tick: () => {
			for (const entry of [...intervals.values()]) entry.fn();
		},
		/** Set `prefers-reduced-motion` for the NEXT mount (the hook reads it at mount). */
		media: (reduce) => {
			mediaState.reduce = reduce;
		},
		row: () => window.document.querySelector("[data-lo-composer-tip]"),
		tip: () =>
			window.document.querySelector("[data-lo-composer-tip] span")?.textContent,
		render: async (suspended = false) => {
			await act(() =>
				root.render(
					h(React.StrictMode, null, h(ComposerTipRow, { suspended })),
				),
			);
		},
		/** The caller stops rendering the row, which is how the splash drops it. */
		unmount: async () => {
			mounted = false;
			await act(() => root.unmount());
		},
	};
	try {
		await run(api);
	} finally {
		if (mounted) await act(() => root.unmount());
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

test("the row opens on the pinned entry, on the TUI's interval, one step per period", async () => {
	await fixture(async (api) => {
		await api.render();
		assert.equal(
			api.tip(),
			COMPOSER_TIPS[0],
			"the opening frame is pinned, which is what makes a committed capture of a rotating row reproducible",
		);
		const timers = api.timers();
		assert.equal(
			timers.length,
			1,
			"one clock, including under StrictMode's double-invoked effect",
		);
		assert.equal(
			timers[0].delay,
			TIP_ROTATE_INTERVAL_MS,
			"the interval is the constant, not a literal that can drift away from it",
		);
		const seen = [api.tip()];
		for (let i = 1; i < COMPOSER_TIPS.length; i++) {
			await act(() => api.tick());
			seen.push(api.tip());
		}
		assert.equal(
			new Set(seen).size,
			COMPOSER_TIPS.length,
			"one turn covers the pool exactly once, so the ring the component walked is a permutation of it",
		);
		for (let i = 1; i < seen.length; i++) {
			assert.notEqual(
				seen[i],
				seen[i - 1],
				`tick ${i} repeated the previous tip`,
			);
		}
	});
});

test("a held draft stops the clock rather than merely not noticing it", async () => {
	await fixture(async (api) => {
		await api.render(true);
		assert.equal(
			api.timers().length,
			0,
			"the suspended branch returns before installing an interval, so there is no clock to fire",
		);
		const held = api.tip();
		assert.ok(
			held.length > 0,
			"the row keeps painting while the box holds a draft",
		);
		assert.equal(api.tip(), held);
		/*
		 * And it resumes: the effect re-arms on `suspended` going false, on a FRESH
		 * interval rather than carrying the elapsed time over - the live surface
		 * measured 11.62-11.98s to the first tick after the box emptied.
		 */
		await api.render(false);
		assert.equal(api.timers().length, 1);
		await act(() => api.tick());
		assert.notEqual(api.tip(), held, "the clock resumes when the box empties");
	});
});

test("prefers-reduced-motion holds one entry, and does not disable the row", async () => {
	await fixture(async (api) => {
		api.media(true);
		await api.render();
		const held = api.tip();
		assert.ok(held.length > 0);
		assert.equal(
			api.timers().length,
			0,
			"a media preference cannot be answered by a CSS variant when a JS timer is the motion, so the effect must not arm one",
		);
		assert.equal(api.tip(), held);
		/* The positive control: the same row with the preference off does turn. */
		api.media(false);
		await api.render();
		assert.equal(api.timers().length, 1);
		await act(() => api.tick());
		assert.notEqual(
			api.tip(),
			held,
			"the hold was the preference, not a dead timer",
		);
	});
});

test("unmounting clears the clock", async () => {
	await fixture(async (api) => {
		await api.render();
		assert.equal(api.timers().length, 1);
		await api.unmount();
		assert.equal(
			api.timers().length,
			0,
			"the effect's cleanup clears the interval, so an unmounted row cannot repaint or keep a timer alive",
		);
	});
});
