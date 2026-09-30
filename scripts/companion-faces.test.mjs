import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const motion = new dom.window.EventTarget();
window.matchMedia = () => motion;
const timers = new Map();
let timerId = 0;
window.setTimeout = (callback, delay) => {
	timers.set(++timerId, { callback, delay });
	return timerId;
};
window.clearTimeout = (id) => timers.delete(id);
let randomState;
const math = Object.create(Math);
const seededRandom = () => {
	randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
	return randomState / 2 ** 32;
};

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const bundle = buildSync({
	entryPoints: [`${rootPath}/src/renderer/src/companion-art.tsx`],
	bundle: true,
	format: "cjs",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${rootPath}/src/renderer/src/shared` },
	loader: { ".css": "empty", ".webp": "empty" },
	write: false,
});
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
	module,
	exports: module.exports,
	require: createRequire(import.meta.url),
	window,
	document,
	Math: math,
});
const { CompanionArt } = module.exports;
after(() => {
	dom.window.close();
	for (const key of [
		"window",
		"document",
		"HTMLElement",
		"IS_REACT_ACT_ENVIRONMENT",
	])
		delete globalThis[key];
});

async function fixture(callback, { hidden = false, reduced = false } = {}) {
	randomState = 0x12345678;
	math.random = seededRandom;
	motion.matches = reduced;
	Object.defineProperty(document, "hidden", {
		configurable: true,
		value: hidden,
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let props = {
		character: "sprout",
		mood: "idle",
		reaction: "rest",
		gaze: { x: 0, y: 0 },
	};
	const render = async (next = {}) => {
		props = { ...props, ...next };
		await act(() => root.render(React.createElement(CompanionArt, props)));
	};
	const emotion = () => host.querySelector("[data-emotion]")?.dataset.emotion;
	const visibility = async (value) =>
		act(() => {
			Object.defineProperty(document, "hidden", {
				configurable: true,
				value,
			});
			document.dispatchEvent(new dom.window.Event("visibilitychange"));
		});
	const reduceMotion = async (value) =>
		act(() => {
			motion.matches = value;
			motion.dispatchEvent(new dom.window.Event("change"));
		});
	const tick = async () => {
		assert.equal(timers.size, 1, "one face timer is active");
		const [id, timer] = timers.entries().next().value;
		timers.delete(id);
		await act(() => timer.callback());
		return emotion();
	};
	const step = async () => {
		await tick();
		assert.equal(
			host.querySelector(".companion-art").dataset.faceChanging,
			"true",
		);
		return tick();
	};
	await render();
	try {
		await callback({
			render,
			emotion,
			step,
			tick,
			host,
			visibility,
			reduceMotion,
			draw: (value) => {
				math.random = value === undefined ? seededRandom : () => value;
			},
		});
	} finally {
		await act(() => root.unmount());
		host.remove();
		assert.equal(timers.size, 0, "unmount clears the timer");
		await visibility(false);
		await reduceMotion(false);
		assert.equal(timers.size, 0, "unmount removes resume listeners");
	}
}

const silly = new Set([
	"left wink",
	"right wink",
	"goofy",
	"mischievous",
	"blep",
	"cross-eyed glance",
	"cheeky wink",
	"puffed cheeks",
	"one brow up",
	"shy nibble",
]);
const uncommon = new Set([
	"adoring",
	"starry",
	"skeptical",
	"amazed",
	"smitten",
	"giggle",
	"twinkle",
	"puzzled",
	"little pout",
	"wistful",
	"hmm",
	"whistling",
	...silly,
]);
const subdued = new Set([
	"skeptical",
	"amazed",
	"puzzled",
	"little pout",
	"wistful",
	"hmm",
]);
const attentive = new Set([
	"warm",
	"content",
	"curious",
	"cat smile",
	"proud",
	"soft smile",
	"quiet",
	"neutral",
	"little smile",
]);

test("a varied, mostly cheerful cycle bridges brief special faces with everyday ones", async () => {
	for (const character of ["sprout", "hoodie", "pixel", "inky"])
		await fixture(async ({ render, emotion, step }) => {
			await render({ character });
			const seen = new Set([emotion()]);
			const recent = [emotion()];
			let subduedCount = 0;
			let sillyCount = 0;
			let attentiveTime = 0;
			let totalTime = 0;
			for (let i = 0; i < 1600; i++) {
				const previous = emotion();
				const held = timers.values().next().value.delay;
				totalTime += held;
				if (attentive.has(previous)) attentiveTime += held;
				if (uncommon.has(previous))
					assert.ok(timers.values().next().value.delay <= 2800);
				if (silly.has(previous))
					assert.ok(timers.values().next().value.delay <= 1600);
				const next = await step();
				assert.ok(!recent.includes(next), "avoid the last four expressions");
				if (uncommon.has(previous)) assert.ok(!uncommon.has(next));
				if (silly.has(previous))
					assert.ok(
						attentive.has(next),
						"silly moments settle into a calm face",
					);
				if (subdued.has(next)) subduedCount++;
				if (silly.has(next)) sillyCount++;
				recent.push(next);
				if (recent.length > 4) recent.shift();
				seen.add(next);
			}
			assert.equal(
				seen.size,
				37,
				`${character} retains the full expression repertoire`,
			);
			assert.ok(
				seen.has("adoring") && seen.has("caret joy") && seen.has("starry"),
			);
			assert.ok(subduedCount < 192, "non-cheerful beats stay a small minority");
			assert.ok(sillyCount < 240, "silly faces are occasional surprises");
			assert.ok(
				attentiveTime / totalTime > 0.6,
				"most idle time is spent in gentle everyday faces",
			);
		});
});

test("each pet's silly face settles for reduced motion and yields to tasks or listening", async () => {
	for (const character of ["sprout", "hoodie", "pixel", "inky"])
		await fixture(async ({ render, emotion, step, reduceMotion }) => {
			await render({ character });
			for (let i = 0; !silly.has(emotion()) && i < 100; i++) await step();
			const before = emotion();
			assert.ok(silly.has(before));
			await reduceMotion(true);
			const settled = emotion();
			assert.ok(attentive.has(settled));
			assert.equal(timers.size, 0);
			for (const mood of ["working", "attention", "error"]) {
				await render({ mood });
				assert.equal(emotion(), undefined);
				assert.equal(timers.size, 0);
			}
			await render({ mood: "idle" });
			assert.equal(emotion(), settled);
			await render({ reaction: "listening" });
			assert.ok(attentive.has(emotion()));
			assert.equal(timers.size, 0);
			await reduceMotion(false);
			assert.ok(attentive.has(await step()));
		});
});

test("touch and task interruptions resume variety instead of resetting the face", async () => {
	await fixture(async ({ render, emotion, step }) => {
		for (let i = 0; i < 8; i++) await step();
		const before = emotion();
		assert.notEqual(before, "warm");
		for (const interruption of [
			{ reaction: "happy" },
			{ reaction: "grabbed" },
			{ reaction: "dozing" },
			{ reaction: "rest", mood: "working" },
			{ reaction: "rest", mood: "attention" },
			{ reaction: "rest", mood: "error" },
			{ reaction: "rest", mood: "offline" },
		]) {
			await render(interruption);
			assert.equal(timers.size, 0);
			await render({ mood: "idle", reaction: "rest" });
			assert.equal(emotion(), before);
			assert.equal(timers.size, 1);
		}
		assert.notEqual(await step(), before);
		await render({ character: "pixel" });
		assert.equal(emotion(), "warm");
		await step();
		assert.notEqual(emotion(), "warm");
		await render({ character: "sprout" });
		assert.equal(
			emotion(),
			"warm",
			"switching between pets with the same seed resets their expression",
		);
		await render({ character: "hoodie" });
		assert.equal(emotion(), "little smile");
		assert.equal(timers.size, 1);
	});
});

test("listening immediately replaces a dramatic face and stays in its attentive set", async () => {
	await fixture(async ({ render, emotion, step, draw }) => {
		draw(0);
		for (let i = 0; emotion() !== "adoring" && i < 100; i++) await step();
		assert.equal(emotion(), "adoring");
		await render({ reaction: "listening" });
		assert.ok(attentive.has(emotion()));
		const seen = new Set([emotion()]);
		for (let i = 0; i < 40; i++) {
			const previous = emotion();
			assert.ok(
				timers.values().next().value.delay >= 3800,
				"listening holds its expression longer",
			);
			const next = await step();
			assert.ok(attentive.has(next), next);
			assert.notEqual(
				next,
				previous,
				"forced attentive fallback joins history",
			);
			seen.add(next);
			if (i === 0) draw();
		}
		assert.ok(seen.size >= 6);
	});
});

test("hidden and reduced-motion faces have no timers and resume their last expression", async () => {
	for (const state of [{ hidden: true }, { reduced: true }]) {
		await fixture(async ({ emotion, step, visibility, reduceMotion }) => {
			assert.equal(timers.size, 0);
			await visibility(false);
			await reduceMotion(false);
			assert.equal(timers.size, 1);
			await step();
			const before = emotion();
			await visibility(true);
			await reduceMotion(true);
			assert.equal(timers.size, 0);
			await visibility(false);
			assert.equal(timers.size, 0);
			await reduceMotion(false);
			assert.equal(timers.size, 1);
			assert.equal(emotion(), before);
			assert.notEqual(await step(), before);
		}, state);
	}
});

test("pickup artwork readiness belongs to the loaded character", async () => {
	await fixture(async ({ render }) => {
		for (const character of ["inky", "hoodie", "inky"]) {
			await render({ character, reaction: "grabbed" });
			const art = document.querySelector(".companion-art");
			const source = art.querySelector(".companion-art-motion-source");
			assert.ok(source);
			assert.equal(art.dataset.motionReady, undefined);
			await act(() => source.dispatchEvent(new dom.window.Event("error")));
			assert.equal(art.dataset.motionReady, undefined);
			await act(() => source.dispatchEvent(new dom.window.Event("load")));
			assert.equal(art.dataset.motionReady, "true");
			await render({ reaction: "rest" });
			assert.equal(art.dataset.physical, undefined);
			await render({ reaction: "grabbed" });
			assert.equal(art.dataset.motionReady, "true");
		}
	});
});

test("expression changes blink first and interrupted blinks reopen without a stale swap", async () => {
	await fixture(
		async ({ emotion, step, tick, host, render, visibility, reduceMotion }) => {
			const changing = () =>
				host.querySelector(".companion-art").dataset.faceChanging;
			const eyes = host.querySelector(".companion-art-face-arrive");
			const before = emotion();
			await tick();
			assert.equal(
				emotion(),
				before,
				"old expression stays through eyelid closure",
			);
			assert.equal(changing(), "true");
			assert.equal(timers.values().next().value.delay, 100);
			await tick();
			assert.notEqual(emotion(), before);
			assert.equal(changing(), undefined);
			assert.equal(
				host.querySelector(".companion-art-face-arrive"),
				eyes,
				"eye transitions preserve their DOM node",
			);
			for (const pause of [
				() => visibility(true),
				() => reduceMotion(true),
				() => render({ reaction: "grabbed" }),
			]) {
				await tick();
				assert.equal(changing(), "true");
				await pause();
				assert.equal(changing(), undefined);
				assert.equal(timers.size, 0);
				await visibility(false);
				await reduceMotion(false);
				await render({ reaction: "rest" });
				assert.equal(changing(), undefined);
				await step();
			}
		},
	);
});
