/** Deterministic scheduling proof, NOT a browser timing claim. The real picker
 * still needs cold/warm click-to-visible frames with the actual canvas probe. */
import assert from "node:assert/strict";
import { after, beforeEach, describe, test } from "node:test";
import { build } from "esbuild";

const FONT_SEAM = /\.\/team-bridge-emoji-support$/;
const ANY_SEAM = /.*/;
const bundle = await build({
	entryPoints: [
		"src/renderer/src/features/team-bridge/team-bridge-emoji-support-scheduler.ts",
	],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "counted-font-boundary",
			setup(b) {
				b.onResolve({ filter: FONT_SEAM }, () => ({
					path: "font",
					namespace: "seam",
				}));
				b.onLoad({ filter: ANY_SEAM, namespace: "seam" }, () => ({
					contents: `
				export const cachedEmojiSupport = (emoji) => globalThis.__font.cache.get(emoji);
				export const canRenderEmoji = (emoji) => {
					const state = globalThis.__font;
					state.probes.push(emoji);
					state.time += state.cost;
					const supported = !state.unsupported.has(emoji);
					state.cache.set(emoji, supported);
					return supported;
				};
			`,
				}));
			},
		},
	],
});
const {
	scheduleEmojiSupport,
	EMOJI_SUPPORT_BATCH_SIZE,
	EMOJI_SUPPORT_BUDGET_MS,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

describe("emoji support scheduling", () => {
	after(() => {
		globalThis.__font = undefined;
	});
	beforeEach(() => {
		globalThis.__font = {
			cache: new Map(),
			probes: [],
			unsupported: new Set(),
			time: 0,
			cost: 0,
		};
	});

	function clock() {
		let id = 0;
		const frames = new Map();
		const tasks = new Map();
		const advance = (queue) => {
			const callbacks = [...queue.values()];
			queue.clear();
			for (const callback of callbacks) callback();
		};
		return {
			frames,
			tasks,
			frame: () => advance(frames),
			task: () => advance(tasks),
			host: {
				requestFrame: (fn) => {
					frames.set(++id, fn);
					return id;
				},
				cancelFrame: (key) => frames.delete(key),
				setTask: (fn) => {
					tasks.set(++id, fn);
					return id;
				},
				cancelTask: (key) => tasks.delete(key),
				now: () => globalThis.__font.time,
			},
		};
	}
	const corpus = () => Array.from({ length: 3963 }, (_, i) => `glyph-${i}`);

	test("cold discovery waits through the paint boundary, then spends a bounded slice", () => {
		const c = clock();
		let revisions = 0;
		const cancel = scheduleEmojiSupport(corpus(), () => revisions++, c.host);
		assert.equal(globalThis.__font.probes.length, 0);
		c.frame();
		assert.equal(
			globalThis.__font.probes.length,
			0,
			"first rAF runs before paint",
		);
		c.frame();
		assert.equal(
			globalThis.__font.probes.length,
			0,
			"even second rAF only queues work",
		);
		c.task();
		assert.equal(globalThis.__font.probes.length, EMOJI_SUPPORT_BATCH_SIZE);
		assert.equal(revisions, 1);
		assert.equal(c.tasks.size, 1);
		cancel();
		assert.equal(c.tasks.size + c.frames.size, 0);
	});

	test("a costly glyph yields at the time budget rather than finishing a full count batch", () => {
		const c = clock();
		globalThis.__font.cost = EMOJI_SUPPORT_BUDGET_MS;
		const cancel = scheduleEmojiSupport(corpus(), () => {}, c.host);
		c.frame();
		c.frame();
		c.task();
		assert.equal(globalThis.__font.probes.length, 1);
		cancel();
	});

	test("closing cancels work before paint, between frames, or between batches", () => {
		for (const stage of [0, 1, 2, 3]) {
			globalThis.__font.cache.clear();
			globalThis.__font.probes.length = 0;
			const c = clock();
			const cancel = scheduleEmojiSupport(corpus(), () => {}, c.host);
			if (stage >= 1) c.frame();
			if (stage >= 2) c.frame();
			if (stage >= 3) c.task();
			const count = globalThis.__font.probes.length;
			const stale = [...c.frames.values(), ...c.tasks.values()];
			cancel();
			for (const callback of stale) callback();
			c.frame();
			c.task();
			assert.equal(globalThis.__font.probes.length, count);
			assert.equal(c.frames.size + c.tasks.size, 0);
		}
	});

	test("warm reopen does no work and concurrent discovery reuses positive and negative cache entries", () => {
		const c = clock();
		globalThis.__font.unsupported.add("bad");
		let revisions = 0;
		scheduleEmojiSupport(["good", "bad", "good"], () => revisions++, c.host);
		scheduleEmojiSupport(["good", "bad"], () => revisions++, c.host);
		c.frame();
		c.frame();
		c.task();
		assert.deepEqual(globalThis.__font.probes, ["good", "bad"]);
		assert.equal(globalThis.__font.cache.get("bad"), false);
		assert.equal(revisions, 2, "both consumers see newly cached results");
		scheduleEmojiSupport(
			["good", "bad"],
			() => assert.fail("already warm"),
			c.host,
		);
		assert.equal(c.frames.size + c.tasks.size, 0);
	});

	test("progress cancellation cannot queue another slice", () => {
		const c = clock();
		const cancel = scheduleEmojiSupport(corpus(), () => cancel(), c.host);
		c.frame();
		c.frame();
		c.task();
		assert.equal(c.frames.size + c.tasks.size, 0);
	});
});
