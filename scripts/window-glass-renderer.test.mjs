/**
 * The renderer's convergence contract for the window glass, DRIVEN against the
 * shipped hook.
 *
 * WHY THIS EXISTS (QA round 2, Q-1). The launch gate is deliberately optimistic:
 * Electron reports `disabled_software` for the GPU until the first
 * `gpu-info-update`, so a window can be built translucent and main can drop the
 * capability BEFORE this document subscribes. A renderer that only listens for
 * pushes then paints glass forever while main answers `active:false` - measured
 * on the built app with `--disable-gpu-compositing`, `data-glass="sidebar canvas
 * pane"` indefinitely even after `get()` and `reportRenderer()` both returned
 * inactive.
 *
 * WHAT IT ASSERTS. With a stub bridge that NEVER pushes, `subscribeGlassPaint`
 * must converge on the authoritative state it can fetch: the document ends with
 * no `data-glass` and no `--lo-glass-*` variables, and the renderer's capability
 * report is actually sent. This is the deterministic half; the built-app path
 * (`window-glass-cdp.test.mjs`) covers the real launch timing.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/* The fake document element the hook paints; jsdom is unnecessary for this. */
function makeRoot() {
	const removed = [];
	const set = new Map();
	return {
		root: {
			dataset: {},
			classList: { contains: () => false },
			style: {
				setProperty: (name, value) => set.set(name, value),
				removeProperty: (name) => {
					removed.push(name);
					set.delete(name);
				},
			},
		},
		removed,
		set,
	};
}

const inactive = {
	capability: {
		supported: false,
		mechanism: "none",
		reason: "gpu-unavailable",
		materials: [],
		defaultMaterial: "window",
		liquid: false,
		defaultEnabled: false,
		liveToggle: false,
	},
	settings: {
		enabled: true,
		coverage: "full",
		intensity: 80,
		material: "window",
	},
	active: false,
	restartRequired: false,
};

test("R-1 a renderer that missed the drop converges on main's inactive state", async (t) => {
	const { root, removed, set } = makeRoot();
	globalThis.document = { documentElement: root };
	const calls = { get: 0, report: [], unsubscribed: false };
	globalThis.CSS = { supports: () => true };
	globalThis.window = {
		api: {
			windowGlass: {
				/* NO PUSH: exactly the defect's shape - the drop landed before this
				 * handler existed. */
				onState: () => () => {
					calls.unsubscribed = true;
				},
				get: async () => {
					calls.get += 1;
					return inactive;
				},
				reportRenderer: async (report) => {
					calls.report.push(report);
					return inactive;
				},
			},
		},
	};

	const bundle = await build({
		stdin: {
			contents: `export * from "./src/renderer/src/shared/hooks/use-window-glass";`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		loader: { ".json": "json" },
		/* React is imported for the Settings hook that shares this module; it is
		 * bundled (a data: URL module cannot resolve a bare specifier) and its
		 * runtime is not exercised here. */
	});
	const mod = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);

	/* The optimistic first paint: glass on, from the argv facts. */
	mod.applyGlassFacts({
		mechanism: "vibrancy",
		coverage: "full",
		intensity: 80,
		material: "window",
		scheme: "dark",
	});
	assert.equal(root.dataset.glass, "sidebar canvas pane");
	assert.ok(
		set.has("--lo-glass-a-canvas"),
		"the first paint carries the alphas",
	);

	const off = mod.subscribeGlassPaint();
	/* Two macrotasks let both promises (reportRenderer, get) settle. */
	await new Promise((r) => setTimeout(r, 20));

	assert.equal(calls.get, 1, "the hook asks for main's current state once");
	assert.deepEqual(
		calls.report,
		[{ backdropFilter: true }],
		"the renderer still reports its backdrop-filter capability",
	);
	assert.equal(
		root.dataset.glass,
		undefined,
		"no data-glass: the stale optimistic paint is cleared",
	);
	for (const name of removed)
		assert.ok(name.startsWith("--lo-glass-"), `cleared ${name}`);
	assert.equal(
		set.has("--lo-glass-a-canvas"),
		false,
		"no alpha variable survives the inactive state",
	);
	off();
	assert.equal(calls.unsubscribed, true, "the unsubscribe is returned");
});
