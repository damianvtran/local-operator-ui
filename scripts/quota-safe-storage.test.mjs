/**
 * `quota-safe-storage.ts` (PostHog D7: QuotaExceededError on
 * `conversation-input-store` and `canonical-sessions-storage`).
 *
 * The storage stub throws a real-shaped `QuotaExceededError` once the stored
 * text would pass a byte budget, the way Chromium's per-origin quota does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/shared/store/quota-safe-storage";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "neutral",
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function quotaStorage(budget) {
	const map = new Map();
	return {
		map,
		setItem(key, text) {
			let used = 0;
			for (const [k, v] of map) if (k !== key) used += v.length;
			if (used + text.length > budget) {
				const error = new Error("The quota has been exceeded.");
				error.name = "QuotaExceededError";
				error.code = 22;
				throw error;
			}
			map.set(key, text);
		},
		getItem: (key) => map.get(key) ?? null,
		removeItem: (key) => map.delete(key),
	};
}

const IMAGE = `data:image/png;base64,${"A".repeat(50_000)}`;
const drafts = () => ({
	state: {
		inputByConversation: {
			a: {
				currentInput: "my unsent question",
				attachments: [{ id: "1", path: IMAGE }],
			},
			b: { currentInput: "", attachments: [{ id: "2", path: IMAGE }] },
			c: { currentInput: "see data:text/plain,hi in my text", attachments: [] },
		},
	},
	version: 0,
});

test("a full value lands untouched while there is room", () => {
	const storage = quotaStorage(1_000_000);
	const value = drafts();
	assert.equal(mod.writeWithQuotaFallback(storage, "k", value), "full");
	assert.deepEqual(JSON.parse(storage.map.get("k")), value);
});

test("over quota: images leave the disk copy, typed text survives, memory is untouched", () => {
	const storage = quotaStorage(20_000);
	const value = drafts();
	const before = JSON.stringify(value);
	assert.equal(
		mod.writeWithQuotaFallback(storage, "k", value),
		"without_inline_data",
	);
	const disk = JSON.parse(storage.map.get("k"));
	assert.equal(
		disk.state.inputByConversation.a.currentInput,
		"my unsent question",
	);
	assert.deepEqual(disk.state.inputByConversation.a.attachments, []);
	// A data: string in the user's own text is their words, not a payload.
	assert.equal(
		disk.state.inputByConversation.c.currentInput,
		"see data:text/plain,hi in my text",
	);
	assert.equal(
		JSON.stringify(value),
		before,
		"the in-memory value is never mutated",
	);
});

test("the last resort runs only after both earlier writes were refused, then skip never throws", () => {
	// Between the image-free value (221 chars) and the last resort's (106).
	const storage = quotaStorage(150);
	const value = drafts();
	const shrunk = mod.writeWithQuotaFallback(storage, "k", value, (v) => ({
		...v,
		state: {
			inputByConversation: Object.fromEntries(
				Object.entries(v.state.inputByConversation)
					.filter(([, r]) => r.currentInput.trim())
					.slice(0, 1),
			),
		},
	}));
	assert.equal(shrunk, "shrunk");
	assert.deepEqual(
		Object.keys(JSON.parse(storage.map.get("k")).state.inputByConversation),
		["a"],
	);
	const tiny = quotaStorage(5);
	assert.equal(mod.writeWithQuotaFallback(tiny, "k", value), "skipped");
});

test("a non-quota storage error is not swallowed", () => {
	const storage = {
		setItem() {
			throw new TypeError("boom");
		},
	};
	assert.throws(() => mod.writeWithQuotaFallback(storage, "k", {}), TypeError);
});

test("the zustand storage never throws a quota error out of persist, and warns once per streak", () => {
	const storage = quotaStorage(10);
	const original = globalThis.localStorage;
	const warnings = [];
	const warn = console.warn;
	globalThis.localStorage = storage;
	console.warn = (m) => warnings.push(String(m));
	try {
		const persist = mod.quotaSafePersistStorage({
			storeName: "canonical-sessions-storage",
		});
		persist.setItem("canonical-sessions-storage", {
			state: { drafts: { x: { text: "hello world" } } },
		});
		persist.setItem("canonical-sessions-storage", {
			state: { drafts: { x: { text: "hello again" } } },
		});
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /localStorage is full/);
	} finally {
		globalThis.localStorage = original;
		console.warn = warn;
	}
	assert.equal(mod.isQuotaExceeded({ name: "QuotaExceededError" }), true);
	assert.equal(mod.isQuotaExceeded({ code: 1014 }), true);
	assert.equal(mod.isQuotaExceeded(new Error("x")), false);
});
