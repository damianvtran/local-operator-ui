import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM("<!doctype html><body></body>", {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const motion = new dom.window.EventTarget();
motion.matches = false;
window.matchMedia = () => motion;
let now = 0;
let timerId = 0;
const timers = new Map();
window.performance.now = () => now;
window.setTimeout = (callback, delay) => {
	timers.set(++timerId, { callback, due: now + delay });
	return timerId;
};
window.clearTimeout = (id) => timers.delete(id);
const advance = async (ms) =>
	act(async () => {
		const end = now + ms;
		while (true) {
			const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
			if (!next || next[1].due > end) break;
			now = next[1].due;
			timers.delete(next[0]);
			next[1].callback();
		}
		now = end;
	});
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	entryPoints: ["src/renderer/src/companion-play.ts"],
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	write: false,
});
const path = new URL(`./_companion-play-${process.pid}.mjs`, import.meta.url);
await writeFile(path, bundle.outputFiles[0].text);
const { useCompanionPlay } = await import(path.href);
await unlink(path);
after(() => {
	dom.window.close();
	for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"])
		delete globalThis[key];
});

async function fixture(callback, reduced = false) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let available = true;
	let characterId = "sprout";
	let play;
	let mounted = true;
	motion.matches = reduced;
	const random = Math.random;
	Math.random = () => 0.25;
	function Probe() {
		play = useCompanionPlay(available, characterId);
		return null;
	}
	const render = () => act(async () => root.render(React.createElement(Probe)));
	const call = (callback) => act(async () => callback());
	await render();
	try {
		await callback({
			get play() {
				return play;
			},
			start: (kind) => call(() => play.start(kind)),
			discover: () => call(() => play.discover()),
			tap: (side) => call(() => play.tap(side)),
			cancel: () => call(() => play.cancel()),
			available: async (next) => {
				available = next;
				await render();
			},
			character: async (next) => {
				characterId = next;
				await render();
			},
			reduceMotion: (matches) =>
				call(() => {
					motion.matches = matches;
					motion.dispatchEvent(new dom.window.Event("change"));
				}),
			hidden: (hidden) =>
				call(() => {
					Object.defineProperty(document, "hidden", {
						configurable: true,
						value: hidden,
					});
					document.dispatchEvent(new dom.window.Event("visibilitychange"));
				}),
			blur: () =>
				call(() => window.dispatchEvent(new dom.window.Event("blur"))),
			escape: () =>
				call(() =>
					window.dispatchEvent(
						new dom.window.KeyboardEvent("keydown", { key: "Escape" }),
					),
				),
			unmount: async () => {
				await act(async () => root.unmount());
				mounted = false;
			},
		});
	} finally {
		if (mounted) await act(async () => root.unmount());
		assert.equal(timers.size, 0);
		Math.random = random;
		motion.matches = false;
		Reflect.deleteProperty(document, "hidden");
		host.remove();
	}
}

test("sharing a snack accepts one tap and ends without retaining a timer", async () => {
	await fixture(async (f) => {
		await f.start("snack");
		assert.equal(f.play.scene.phase, "offer");
		assert.equal(f.play.announcement, "Tap to share a snack.");
		await f.tap();
		assert.equal(f.play.scene.phase, "playing");
		await advance(1000);
		await f.tap();
		await advance(500);
		assert.equal(f.play.scene.phase, "finish");
		assert.equal(f.play.reaction, "loved");
		await advance(1400);
		assert.equal(f.play.scene, null);
		assert.equal(f.play.announcement, "");
		assert.equal(timers.size, 0);
	});
});

test("bounce counts spaced taps, ignores spam, and finishes on the fifth hit", async () => {
	await fixture(async (f) => {
		await f.start("bounce");
		await f.tap();
		await f.tap();
		await advance(299);
		await f.tap();
		assert.equal(f.play.scene.step, 1);
		await advance(1);
		await f.tap();
		assert.equal(f.play.scene.step, 2);
		for (let i = 0; i < 3; i++) {
			await advance(600);
			await f.tap();
		}
		assert.equal(f.play.scene.phase, "finish");
		assert.equal(f.play.scene.step, 5);
		assert.equal(f.play.announcement, "Five little bounces.");
		assert.equal(timers.size, 1);
		await advance(1400);
		assert.equal(f.play.scene, null);
	});
});

test("missed bounces settle quietly and unattended offers leave after twenty seconds", async () => {
	await fixture(async (f) => {
		await f.start("bounce");
		await f.tap();
		await advance(1799);
		assert.equal(f.play.scene.phase, "playing");
		assert.equal(f.play.announcement, "");
		await advance(1);
		assert.equal(f.play.scene.phase, "reveal");
		assert.equal(f.play.reaction, "happy");
		await advance(1000);
		assert.equal(f.play.scene, null);
		for (const kind of ["snack", "bounce", "guess"]) {
			await f.start(kind);
			await advance(20_000);
			assert.equal(f.play.scene, null);
			assert.equal(timers.size, 0);
		}
	});
});

test("guess requires a deliberate side and reveals both correct and other-paw choices", async () => {
	await fixture(async (f) => {
		await f.start("guess");
		assert.equal(f.play.scene.side, "left");
		await f.tap();
		assert.equal(f.play.scene.phase, "offer");
		await f.tap("right");
		assert.equal(f.play.scene.choice, "right");
		assert.equal(f.play.reaction, "happy");
		assert.equal(f.play.announcement, "There it is.");
		await f.tap("left");
		assert.equal(f.play.scene.choice, "right");
		await advance(2100);
		assert.equal(f.play.scene, null);
		await f.start("guess");
		await f.tap("left");
		assert.equal(f.play.reaction, "loved");
		await advance(700);
		assert.equal(f.play.scene.phase, "finish");
		await advance(1400);
		assert.equal(f.play.scene, null);
	});
});

test("reduced motion removes bounce timing pressure and responds to preference changes", async () => {
	await fixture(async (f) => {
		await f.start("bounce");
		assert.equal(f.play.announcement, "Tap the ball five times.");
		await f.tap();
		assert.equal(f.play.announcement, "1 of 5.");
		await advance(19_000);
		assert.equal(f.play.scene.phase, "playing");
		await f.tap();
		assert.equal(f.play.scene.step, 2);
		assert.equal(f.play.announcement, "2 of 5.");
		await f.reduceMotion(false);
		await advance(1000);
		await f.reduceMotion(true);
		await advance(19_999);
		assert.equal(f.play.scene.phase, "playing");
		await advance(1);
		assert.equal(f.play.scene.phase, "reveal");
	}, true);
});

test("only completed games earn one session sparkle, with no penalty for misses", async () => {
	await fixture(async (f) => {
		await f.start("guess");
		await f.tap("right");
		await advance(2100);
		await f.start("bounce");
		await f.tap();
		await advance(2800);
		for (let i = 1; i <= 4; i++) {
			await f.start("snack");
			await f.tap();
			await advance(1500);
			assert.equal(f.play.scene.shiny, i === 3);
			assert.equal(f.play.reaction, i === 3 ? "starstruck" : "loved");
			await advance(i === 3 ? 2200 : 1400);
		}
	});
});

test("task, character, visibility, blur, Escape, and explicit cancellation clear the round", async () => {
	await fixture(async (f) => {
		const interruptions = [
			() => f.available(false),
			() => f.character("hoodie"),
			() => f.hidden(true),
			f.blur,
			f.escape,
			f.cancel,
		];
		for (const interrupt of interruptions) {
			await f.start("snack");
			await f.tap();
			await interrupt();
			assert.equal(f.play.scene, null);
			assert.equal(f.play.announcement, "");
			assert.equal(timers.size, 0);
			await advance(30_000);
			assert.equal(f.play.scene, null);
			await f.available(true);
			await f.hidden(false);
		}
		await f.start("bounce");
		await f.tap();
		await f.unmount();
		assert.equal(timers.size, 0);
	});
});

test("unavailable or hidden companions and unknown activities never start a round", async () => {
	await fixture(async (f) => {
		await f.start("unknown");
		assert.equal(f.play.scene, null);
		await f.available(false);
		await f.start("snack");
		assert.equal(f.play.scene, null);
		await f.available(true);
		await f.hidden(true);
		await f.start("guess");
		assert.equal(f.play.scene, null);
		assert.equal(timers.size, 0);
	});
});

test("five curious pokes offer a toy without spending the revealing tap", async () => {
	await fixture(async (f) => {
		for (const kind of ["snack", "bounce", "guess", "snack"]) {
			for (let i = 0; i < 4; i++) {
				await f.discover();
				assert.equal(f.play.scene, null);
				await advance(400);
			}
			await f.discover();
			assert.equal(f.play.scene.kind, kind);
			assert.equal(f.play.scene.phase, "offer");
			assert.equal(f.play.scene.step, 0);
			for (let i = 0; i < 8; i++) await f.discover();
			assert.equal(
				f.play.scene.kind,
				kind,
				"a running game cannot uncover another toy",
			);
			await f.cancel();
			for (let i = 0; i < 6; i++) await f.discover();
			assert.equal(
				f.play.scene,
				null,
				"leave a quiet moment after a game ends",
			);
			await advance(2000);
		}
	});
});

test("casual visits and interrupted poke sequences never accumulate a surprise game", async () => {
	await fixture(async (f) => {
		for (const interrupt of [
			() => advance(1500),
			() => f.cancel(),
			() => f.blur(),
			() => f.escape(),
			async () => {
				await f.hidden(true);
				await f.hidden(false);
			},
			async () => {
				await f.available(false);
				for (let i = 0; i < 8; i++) await f.discover();
				await f.available(true);
			},
			async () => {
				await f.character("inky");
				await f.character("sprout");
			},
		]) {
			for (let i = 0; i < 4; i++) {
				await f.discover();
				await advance(200);
			}
			assert.equal(f.play.scene, null);
			await interrupt();
			await f.discover();
			assert.equal(f.play.scene, null);
			await f.cancel();
		}
	});
});

test("hidden games can be discovered with reduced motion and custom characters", async () => {
	await fixture(async (f) => {
		await f.character("custom-pet");
		for (let i = 0; i < 5; i++) {
			await f.discover();
			await advance(250);
		}
		assert.equal(f.play.scene.kind, "snack");
		await f.tap();
		assert.equal(f.play.scene.phase, "playing");
	}, true);
});
