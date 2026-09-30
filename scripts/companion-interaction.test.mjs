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
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const motion = new dom.window.EventTarget();
motion.matches = false;
window.matchMedia = () => motion;
const timers = new Map();
let now = 0;
let timerId = 0;
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
const frames = new Map();
let frameId = 0;
globalThis.requestAnimationFrame = (callback) => {
	frames.set(++frameId, callback);
	return frameId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
const { createRoot } = await import("react-dom/client");
const bundle = await build({
	entryPoints: ["src/renderer/src/companion-interaction.ts"],
	bundle: true,
	packages: "external",
	platform: "node",
	format: "esm",
	write: false,
});
const path = new URL(
	`./_companion-interaction-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(path, bundle.outputFiles[0].text);
const { useCompanionInteraction } = await import(path.href);
await unlink(path);
after(() => {
	dom.window.close();
	for (const key of [
		"window",
		"document",
		"HTMLElement",
		"IS_REACT_ACT_ENVIRONMENT",
		"requestAnimationFrame",
		"cancelAnimationFrame",
	])
		delete globalThis[key];
});

async function fixture(callback, greet = true) {
	const getHours = Date.prototype.getHours;
	let hour = 12;
	Date.prototype.getHours = () => hour;
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	let mood = "idle";
	let chatOpen = false;
	let chatEngaged;
	let character = "sprout";
	let released;
	function Probe() {
		const interaction = useCompanionInteraction(
			mood,
			chatOpen,
			character,
			chatEngaged,
		);
		return React.createElement("button", {
			type: "button",
			...interaction.handlers,
			onClick: (event) => {
				if (event.detail === 0) interaction.tap();
			},
			onPointerUp: (event) => {
				released = interaction.handlers.onPointerUp(event, greet);
			},
			"data-engaged": interaction.isEngaged,
			"data-reaction": interaction.reaction,
			"data-gaze": JSON.stringify(interaction.gaze),
		});
	}
	await act(async () => root.render(React.createElement(Probe)));
	const button = host.querySelector("button");
	let captured = false;
	button.setPointerCapture = () => {
		captured = true;
	};
	button.hasPointerCapture = () => captured;
	button.releasePointerCapture = () => {
		captured = false;
	};
	button.getBoundingClientRect = () => ({
		left: 10,
		top: 20,
		width: 100,
		height: 100,
	});
	const event = async (type, options = {}) => {
		await act(async () => {
			const value = new dom.window.MouseEvent(type, {
				bubbles: true,
				cancelable: true,
				clientX: 60,
				clientY: 70,
				screenX: 100,
				screenY: 100,
				...options,
			});
			Object.defineProperty(value, "timeStamp", { value: now });
			Object.defineProperty(value, "pointerType", {
				value: options.pointerType ?? "mouse",
			});
			Object.defineProperty(value, "pointerId", {
				value: options.pointerId ?? 1,
			});
			Object.defineProperty(value, "isPrimary", {
				value: options.isPrimary ?? true,
			});
			button.dispatchEvent(value);
		});
	};
	const flush = async () =>
		act(async () => {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) callback(0);
		});
	try {
		await callback({
			button,
			event,
			flush,
			advance,
			hour: (value) => {
				hour = value;
			},
			reduceMotion: async (matches) =>
				act(async () => {
					motion.matches = matches;
					motion.dispatchEvent(new dom.window.Event("change"));
				}),
			released: () => released,
			mood: async (next) => {
				mood = next;
				await act(async () => root.render(React.createElement(Probe)));
			},
			chat: async (open, engaged) => {
				chatOpen = open;
				chatEngaged = engaged;
				await act(async () => root.render(React.createElement(Probe)));
			},
			character: async (next) => {
				character = next;
				await act(async () => root.render(React.createElement(Probe)));
			},
			visibility: async (hidden) =>
				act(async () => {
					Object.defineProperty(document, "hidden", {
						configurable: true,
						value: hidden,
					});
					document.dispatchEvent(new dom.window.Event("visibilitychange"));
				}),
			gaze: () => JSON.parse(button.dataset.gaze),
		});
	} finally {
		await act(async () => root.unmount());
		assert.equal(button.hasPointerCapture(1), false);
		Date.prototype.getHours = getHours;
		motion.matches = false;
		Reflect.deleteProperty(document, "hidden");
		host.remove();
	}
}

test("hover tracks bounded gaze once per frame and leaving returns to rest", async () => {
	await fixture(async ({ button, event, flush, gaze }) => {
		await event("pointerover", { clientX: 20, clientY: 30 });
		assert.equal(button.dataset.reaction, "curious");
		await event("pointermove", { clientX: 90, clientY: 50 });
		await event("pointermove", { clientX: 500, clientY: -500 });
		assert.equal(frames.size, 1);
		await flush();
		assert.deepEqual(gaze(), { x: 1, y: -1 });
		await event("pointerout");
		assert.equal(button.dataset.reaction, "rest");
		assert.deepEqual(gaze(), { x: 0, y: 0 });
	});
});

test("a tap is happy, a six-pixel move stays a tap, and dragging lands without a click", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerover");
		await event("pointerdown");
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 106 });
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointerup");
		assert.equal(released(), "tap");
		assert.equal(button.dataset.reaction, "happy");
		await event("pointermove");
		assert.equal(button.dataset.reaction, "happy");
		for (let i = 0; i < 6; i++) {
			await event("pointerdown");
			await event("pointerup");
			assert.equal(timers.size, 2);
		}
		await advance(1200);
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerdown");
		await event("pointermove", { screenX: 107 });
		assert.equal(button.dataset.reaction, "grabbed");
		await event("pointermove", { screenX: 100 });
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
		await event("lostpointercapture");
		assert.equal(button.dataset.reaction, "landing");
		await event("pointerup");
		assert.equal(released(), null);
		await advance(900);
		assert.equal(button.dataset.reaction, "curious");
	});
});

test("game taps consume their greeting while pickup still responds", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		for (let i = 0; i < 3; i++) {
			await event("pointerdown");
			await event("pointerup");
			assert.equal(released(), "tap");
			assert.equal(button.dataset.reaction, "rest");
		}
		await event("pointerdown");
		await advance(450);
		await event("pointerup");
		assert.equal(button.dataset.reaction, "rest");
		await event("pointerdown");
		await event("pointermove", { screenX: 110 });
		assert.equal(button.dataset.reaction, "grabbed");
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
	}, false);
});

test("three rapid taps show love with a shared cooldown and no extra timers", async () => {
	await fixture(async ({ button, event, advance }) => {
		const tap = async () => {
			await event("pointerdown");
			await event("pointerup");
		};
		await tap();
		assert.equal(button.dataset.reaction, "happy");
		await advance(200);
		await tap();
		await advance(200);
		await tap();
		assert.equal(button.dataset.reaction, "loved");
		for (let i = 0; i < 3; i++) await tap();
		assert.equal(button.dataset.reaction, "happy");
		assert.equal(timers.size, 2);
		await advance(2000);
		for (let i = 0; i < 3; i++) await tap();
		assert.equal(button.dataset.reaction, "loved");
		for (let i = 0; i < 3; i++) {
			await advance(1100);
			await tap();
			assert.equal(button.dataset.reaction, "happy");
		}
	});
});

test("engaged chat keeps the companion awake; waking yields immediately to a new grab", async () => {
	await fixture(async ({ button, event, advance, chat }) => {
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
		await chat(true);
		assert.equal(button.dataset.reaction, "waking");
		await advance(100_000);
		assert.equal(button.dataset.reaction, "rest");
		assert.equal(timers.size, 0);
		await chat(false);
		await advance(90_000);
		await event("pointerover");
		assert.equal(button.dataset.reaction, "dozing");
		await event("pointerdown");
		assert.equal(button.dataset.reaction, "pressed");
		await event("pointermove", { screenX: 120 });
		assert.equal(button.dataset.reaction, "grabbed");
		await advance(800);
		assert.equal(button.dataset.reaction, "dragging");
	});
});

test("an unattended retained chat sleeps without spontaneous stories and engagement wakes it", async () => {
	for (const state of ["idle", "complete"]) {
		await fixture(async ({ button, advance, chat, mood }) => {
			await mood(state);
			await chat(true);
			await advance(100_000);
			assert.equal(button.dataset.reaction, "rest");
			await act(async () => window.dispatchEvent(new dom.window.Event("blur")));
			await chat(true, false);
			assert.equal(timers.size, 1);
			await advance(28_000);
			assert.equal(button.dataset.reaction, "rest");
			await advance(38_000);
			assert.equal(button.dataset.reaction, "rest");
			await advance(23_999);
			assert.equal(button.dataset.reaction, "rest");
			await advance(1);
			assert.equal(button.dataset.reaction, "dozing");
			assert.equal(timers.size, 0);
			await act(async () =>
				window.dispatchEvent(new dom.window.Event("focus")),
			);
			assert.equal(button.dataset.reaction, "dozing");
			await chat(true, true);
			assert.equal(button.dataset.reaction, "waking");
			await advance(90_000);
			assert.equal(button.dataset.reaction, "rest");
			assert.equal(timers.size, 0);
		});
	}
});

test("quiet rests alternate one playful scene and one time-of-day gesture before sleeping", async () => {
	for (const [time, reaction] of [
		[5, "stretching"],
		[10, "stretching"],
		[11, "daydream"],
		[20, "daydream"],
		[21, "yawning"],
		[4, "yawning"],
	]) {
		await fixture(async ({ button, advance, hour, event, character }) => {
			await character("custom");
			hour(time);
			for (const [first, second, duration] of [
				["peekaboo", reaction, 4800],
				["playful", "daydream", 4000],
			]) {
				await advance(27_999);
				assert.equal(button.dataset.reaction, "rest");
				await advance(1);
				assert.equal(button.dataset.reaction, first);
				await advance(duration);
				assert.equal(button.dataset.reaction, "rest");
				await advance(38_000 - duration);
				assert.equal(button.dataset.reaction, second);
				assert.equal(timers.size, 2);
				await advance(2600);
				assert.equal(button.dataset.reaction, "rest");
				assert.equal(timers.size, 1);
				await advance(21_399);
				assert.equal(button.dataset.reaction, "rest");
				await advance(1);
				assert.equal(button.dataset.reaction, "dozing");
				assert.equal(timers.size, 0);
				await event("click");
			}
		});
	}
	await fixture(async ({ button, advance }) => {
		const [id, timer] = timers.entries().next().value;
		await act(async () => {
			timers.delete(id);
			now += 89_000;
			timer.callback();
		});
		assert.equal(button.dataset.reaction, "rest");
		await advance(1000);
		assert.equal(button.dataset.reaction, "dozing");
	});
});

test("Inky rotates discoveries without adding idle opportunities or delaying sleep", async () => {
	await fixture(async ({ button, advance, hour, event, character }) => {
		await character("inky");
		hour(23);
		for (const [first, second, firstDuration, secondDuration] of [
			["peekaboo", "bubbles", 4800, 4000],
			["yawning", "leafplay", 2600, 4000],
			["daydream", "shell", 2600, 4000],
			["yawning", "juggle", 2600, 5200],
			["daydream", "suction", 2600, 4800],
			["yawning", "camouflage", 2600, 6000],
			["daydream", "playful", 2600, 4000],
		]) {
			await advance(27_999);
			assert.equal(button.dataset.reaction, "rest");
			await advance(1);
			assert.equal(button.dataset.reaction, first);
			assert.equal(timers.size, 2);
			await advance(firstDuration - 1);
			assert.equal(button.dataset.reaction, first);
			await advance(1);
			assert.equal(button.dataset.reaction, "rest");
			await advance(38_000 - firstDuration);
			assert.equal(button.dataset.reaction, second);
			await advance(secondDuration);
			assert.equal(button.dataset.reaction, "rest");
			await advance(24_000 - secondDuration);
			assert.equal(button.dataset.reaction, "dozing");
			assert.equal(timers.size, 0);
			await event("click");
		}
		await advance(28_000);
		assert.equal(button.dataset.reaction, "peekaboo");
	});
});

test("character signatures appear in their first rest and later routines still finish before sleep", async () => {
	for (const [character, scene, duration, rests] of [
		["hoodie", "paperboat", 5200, 0],
		["hoodie", "relax", 6200, 1],
		["hoodie", "scarf", 5600, 2],
		["pixel", "lens", 4800, 0],
		["pixel", "balance", 4800, 1],
		["pixel", "firefly", 5200, 2],
		["sprout", "dew", 4800, 0],
		["sprout", "spin", 3600, 1],
		["sprout", "bloom", 5600, 2],
		["inky", "bubbles", 4000, 0],
		["inky", "leafplay", 4000, 1],
		["inky", "shell", 4000, 2],
		["inky", "juggle", 5200, 3],
		["inky", "suction", 4800, 4],
		["inky", "camouflage", 6000, 5],
	]) {
		const discover = async (f) => {
			await f.character(character);
			for (let i = 0; i < rests; i++) {
				await f.advance(90_000);
				await f.event("click");
			}
			await f.advance(66_000);
			assert.equal(f.button.dataset.reaction, scene);
		};
		await fixture(async (f) => {
			await discover(f);
			await f.advance(duration - 1);
			assert.equal(f.button.dataset.reaction, scene);
			await f.advance(1);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(24_000 - duration);
			assert.equal(f.button.dataset.reaction, "dozing");
			assert.equal(timers.size, 0);
		});
		await fixture(async (f) => {
			await discover(f);
			await f.advance(500);
			await f.event("pointerover");
			await f.event("pointermove", { screenX: 102 });
			assert.equal(f.button.dataset.reaction, scene);
			await f.advance(duration - 501);
			await f.event("pointermove", { screenX: 104 });
			assert.equal(f.button.dataset.reaction, scene);
			await f.advance(1);
			assert.equal(f.button.dataset.reaction, "curious");
			await f.event("pointerout");
			await f.advance(24_000 - duration);
			assert.equal(f.button.dataset.reaction, "dozing");
		});
		for (const interrupt of [
			(f) => f.mood("working"),
			(f) => f.chat(true),
			(f) => f.chat(true, false),
			(f) => f.reduceMotion(true),
			(f) => f.visibility(true),
		]) {
			await fixture(async (f) => {
				await discover(f);
				await interrupt(f);
				assert.equal(f.button.dataset.reaction, "rest");
				await f.advance(duration);
				assert.equal(f.button.dataset.reaction, "rest");
			});
		}
	}
});

test("direct engagement interrupts discoveries without resuming a queued scene", async () => {
	for (const interrupt of [
		(f) => f.event("click"),
		(f) => f.event("pointerdown"),
		async (f) => {
			await f.event("pointerdown");
			await f.event("pointermove", { screenX: 120 });
		},
	]) {
		await fixture(async (f) => {
			await f.character("inky");
			await f.advance(66_000);
			assert.equal(f.button.dataset.reaction, "bubbles");
			await interrupt(f);
			assert.notEqual(f.button.dataset.reaction, "bubbles");
			await f.event("pointerup");
			await f.advance(4000);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(24_000);
			assert.equal(f.button.dataset.reaction, "daydream");
		});
	}
	for (const [interrupt, resume, next] of [
		[(f) => f.mood("working"), (f) => f.mood("idle"), "daydream"],
		[(f) => f.chat(true), (f) => f.chat(false), "daydream"],
		[(f) => f.visibility(true), (f) => f.visibility(false), "daydream"],
		[(f) => f.character("hoodie"), (f) => f.character("inky"), "peekaboo"],
		[
			() => act(async () => window.dispatchEvent(new dom.window.Event("blur"))),
			() =>
				act(async () => window.dispatchEvent(new dom.window.Event("focus"))),
			"daydream",
		],
	]) {
		await fixture(async (f) => {
			await f.character("inky");
			await f.advance(66_000);
			assert.equal(f.button.dataset.reaction, "bubbles");
			await interrupt(f);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(4000);
			await resume(f);
			await f.advance(27_999);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(1);
			assert.equal(f.button.dataset.reaction, next);
			await f.advance(38_000);
			assert.equal(
				f.button.dataset.reaction,
				next === "daydream" ? "leafplay" : "bubbles",
			);
		});
	}
});

test("Inky cuddles alternate accepted affection while the rare reward keeps priority", async () => {
	await fixture(async ({ button, event, advance, character }) => {
		await character("inky");
		const love = async () => {
			for (let i = 0; i < 3; i++) await event("click");
		};
		await love();
		assert.equal(button.dataset.reaction, "loved");
		await love();
		assert.equal(button.dataset.reaction, "happy");
		await advance(2000);
		await love();
		assert.equal(button.dataset.reaction, "cuddle");
		assert.equal(timers.size, 2);
		await advance(3999);
		assert.equal(button.dataset.reaction, "cuddle");
		await advance(1);
		assert.equal(button.dataset.reaction, "rest");
		await love();
		assert.equal(button.dataset.reaction, "loved");
		await advance(2000);
		await love();
		assert.equal(button.dataset.reaction, "starstruck");
		await advance(2000);
		await love();
		assert.equal(button.dataset.reaction, "cuddle");
	});
});

test("Inky affection and carrying reset cleanly on interruptions and character changes", async () => {
	for (const [interrupt, resume] of [
		[(f) => f.mood("working"), (f) => f.mood("idle")],
		[(f) => f.chat(true), (f) => f.chat(false)],
		[(f) => f.visibility(true), (f) => f.visibility(false)],
		[(f) => f.character("pixel"), (f) => f.character("inky")],
		[
			() => act(async () => window.dispatchEvent(new dom.window.Event("blur"))),
			async () => {},
		],
	]) {
		await fixture(async (f) => {
			await f.character("inky");
			const love = async () => {
				for (let i = 0; i < 3; i++) await f.event("click");
			};
			await love();
			await f.advance(2000);
			await love();
			assert.equal(f.button.dataset.reaction, "cuddle");
			await interrupt(f);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(4000);
			await resume(f);
			await love();
			assert.equal(f.button.dataset.reaction, "loved");
		});
	}
	await fixture(async ({ button, event, character, released }) => {
		await character("inky");
		await event("pointerdown");
		await event("pointermove", { screenX: 120 });
		button.setPointerCapture(1);
		assert.equal(button.dataset.reaction, "grabbed");
		await character("sprout");
		assert.equal(button.hasPointerCapture(1), false);
		assert.equal(button.dataset.reaction, "rest");
		await event("pointerup");
		assert.equal(released(), null);
	});
});

test("reduced motion skips Inky discoveries and cuddles without losing sleep", async () => {
	await fixture(async ({ button, event, advance, character, reduceMotion }) => {
		await character("inky");
		await advance(66_000);
		assert.equal(button.dataset.reaction, "bubbles");
		await reduceMotion(true);
		assert.equal(button.dataset.reaction, "rest");
		for (let i = 0; i < 2; i++) {
			await advance(2000);
			for (let tap = 0; tap < 3; tap++) await event("click");
			assert.equal(button.dataset.reaction, "loved");
		}
		await advance(89_999);
		assert.equal(button.dataset.reaction, "rest");
		await advance(1);
		assert.equal(button.dataset.reaction, "dozing");
		assert.equal(timers.size, 0);
	});
});

test("ambient gestures yield to task changes, chat, hiding and reduced motion", async () => {
	for (const interrupt of [
		(f) => f.mood("working"),
		(f) => f.chat(true),
		(f) => f.visibility(true),
		(f) => f.reduceMotion(true),
	]) {
		await fixture(async (f) => {
			await f.advance(28_000);
			assert.equal(f.button.dataset.reaction, "peekaboo");
			await interrupt(f);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
			await f.advance(4800);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
		});
	}
	for (const engage of [
		(f) => f.event("pointerover"),
		(f) => act(async () => f.button.focus()),
		(f) => f.event("pointerdown"),
		(f) => f.reduceMotion(true),
	]) {
		await fixture(async (f) => {
			await engage(f);
			await f.advance(28_000);
			assert.notEqual(f.button.dataset.reaction, "peekaboo");
		});
	}
	assert.equal(timers.size, 0);
});

test("interrupting peekaboo leaves the signature available for the next rest", async () => {
	await fixture(async ({ button, advance, event }) => {
		await advance(28_000);
		assert.equal(button.dataset.reaction, "peekaboo");
		await event("pointerover");
		await event("pointerdown");
		await event("pointerup");
		await event("pointerout");
		await advance(28_000);
		assert.equal(button.dataset.reaction, "dew");
		await event("pointerover");
		await advance(36_000);
		assert.equal(button.dataset.reaction, "curious");
	});
});

test("approaching peekaboo invites a bounded peek; a deliberate tap reveals the pet", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await advance(28_000);
		await event("pointerover");
		assert.equal(button.dataset.reaction, "peeking");
		await advance(1000);
		await event("pointermove");
		await advance(1399);
		assert.equal(button.dataset.reaction, "peeking");
		await advance(1);
		assert.equal(button.dataset.reaction, "curious");
		assert.equal(released(), undefined);
	});
	for (const keyboard of [false, true]) {
		await fixture(async ({ button, event, advance, released }) => {
			await advance(28_000);
			await act(async () =>
				window.dispatchEvent(new dom.window.Event("focus")),
			);
			assert.equal(button.dataset.reaction, "peekaboo");
			if (keyboard) {
				await act(async () => button.focus());
				assert.equal(button.dataset.reaction, "peeking");
				await event("click");
			} else {
				await event("pointerover");
				await event("pointerdown");
				await act(async () => button.focus());
				await advance(450);
				assert.equal(button.dataset.reaction, "peeking");
				await event("pointermove", { screenX: 106 });
				await event("pointerup");
				assert.equal(released(), "tap");
			}
			assert.equal(button.dataset.reaction, "found");
			await event("pointermove");
			await advance(1199);
			assert.equal(button.dataset.reaction, "found");
			await advance(1);
			assert.equal(button.dataset.reaction, "curious");
		});
	}
});

test("finding yields immediately to pickup, task updates and chat", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await advance(28_000);
		await event("pointerdown");
		await event("pointermove", { screenX: 107 });
		assert.equal(button.dataset.reaction, "grabbed");
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
		await advance(1200);
		assert.equal(button.dataset.reaction, "rest");
	});
	for (const interrupt of [(f) => f.mood("working"), (f) => f.chat(true)]) {
		await fixture(async (f) => {
			await f.advance(28_000);
			await f.event("click");
			assert.equal(f.button.dataset.reaction, "found");
			await interrupt(f);
			assert.equal(f.button.dataset.reaction, "rest");
			await f.advance(1200);
			assert.equal(f.button.dataset.reaction, "rest");
			assert.equal(timers.size, 0);
		});
		await fixture(async (f) => {
			await f.advance(28_000);
			await f.event("pointerdown");
			assert.equal(f.button.dataset.reaction, "peeking");
			await interrupt(f);
			await f.event("pointerup");
			assert.notEqual(f.button.dataset.reaction, "found");
		});
	}
});

test("a rare reward needs four recent accepted loves and respects its cooldown", async () => {
	await fixture(async ({ button, event, advance }) => {
		const love = async () => {
			for (let i = 0; i < 3; i++) await event("click");
		};
		await love();
		for (let i = 0; i < 3; i++) await love();
		assert.equal(button.dataset.reaction, "happy");
		await advance(20_001);
		for (let i = 0; i < 4; i++) {
			if (i) await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, i === 3 ? "starstruck" : "loved");
		}
		assert.equal(timers.size, 2);
		await advance(1699);
		assert.equal(button.dataset.reaction, "starstruck");
		await advance(1);
		assert.equal(button.dataset.reaction, "rest");
		for (let i = 0; i < 4; i++) {
			await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, "loved");
		}
		await advance(60_000);
		for (let i = 0; i < 4; i++) {
			if (i) await advance(2000);
			await love();
			assert.equal(button.dataset.reaction, i === 3 ? "starstruck" : "loved");
		}
	});
});

test("carrying progresses on one clock even while the pointer keeps moving", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerdown");
		await event("pointermove", { screenX: 110 });
		assert.equal(button.dataset.reaction, "grabbed");
		assert.equal(timers.size, 2);
		await advance(200);
		await event("pointermove", { screenX: 120 });
		await advance(50);
		assert.equal(button.dataset.reaction, "dragging");
		assert.equal(timers.size, 2);
		await event("pointerup", { pointerId: 2 });
		assert.equal(released(), null);
		await advance(900);
		await event("pointermove", { screenX: 90 });
		await advance(50);
		assert.equal(button.dataset.reaction, "struggling");
		assert.equal(timers.size, 1);
		await event("pointerup");
		assert.equal(released(), "drag");
		assert.equal(button.dataset.reaction, "landing");
		await advance(900);
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("stationary holding pets the companion; unrelated pointers cannot release it", async () => {
	await fixture(async ({ button, event, advance, released }) => {
		await event("pointerdown");
		await advance(450);
		assert.equal(button.dataset.reaction, "happy");
		await event("pointermove", { pointerId: 2, screenX: 300 });
		await event("pointerup", { pointerId: 2 });
		assert.equal(released(), null);
		assert.equal(button.dataset.engaged, "true");
		await event("pointerup");
		assert.equal(released(), "tap");
		await advance(1200);
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("head rub reversals give bounded joy while idle or complete", async () => {
	await fixture(async ({ button, event, advance, mood }) => {
		const rub = async () => {
			for (const screenX of [100, 120, 100, 120, 100])
				await event("pointermove", { screenX, clientY: 40 });
		};
		await rub();
		assert.equal(button.dataset.reaction, "loved");
		assert.equal(timers.size, 2);
		await advance(1000);
		await rub();
		await advance(200);
		assert.equal(button.dataset.reaction, "rest");
		await mood("working");
		await advance(1800);
		await rub();
		assert.equal(button.dataset.reaction, "rest");
		for (const state of ["idle", "complete"]) {
			await mood(state);
			await advance(2000);
			await rub();
			assert.equal(button.dataset.reaction, "loved");
		}
	});
});

test("gentle continuous head rubs count, while pauses and taps end a stroke", async () => {
	await fixture(async ({ button, event, advance }) => {
		const stroke = (screenX) => event("pointermove", { screenX, clientY: 40 });
		for (const screenX of [100, 120, 100, 120, 100]) {
			await advance(600);
			await stroke(screenX);
		}
		assert.equal(button.dataset.reaction, "loved");
		await advance(2000);
		for (const screenX of [100, 120, 100, 120]) await stroke(screenX);
		await advance(901);
		await stroke(100);
		assert.equal(button.dataset.reaction, "rest");
		for (const screenX of [120, 100, 120]) await stroke(screenX);
		await event("pointerdown");
		await event("pointerup");
		await stroke(100);
		assert.equal(button.dataset.reaction, "happy");
		for (const screenX of [120, 100, 120, 100]) await stroke(screenX);
		assert.equal(button.dataset.reaction, "loved");
	});
});

test("idle and completed companions sleep, while live task states stay awake", async () => {
	await fixture(async ({ button, event, advance, mood, visibility }) => {
		await advance(89_999);
		assert.equal(button.dataset.reaction, "rest");
		await advance(1);
		assert.equal(button.dataset.reaction, "dozing");
		await event("pointerover");
		assert.equal(button.dataset.reaction, "dozing");
		await event("click");
		assert.equal(button.dataset.reaction, "waking");
		await advance(800);
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerout");
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
		for (const state of ["working", "attention", "error", "offline"]) {
			await mood(state);
			await advance(100_000);
			assert.equal(button.dataset.reaction, "rest");
			assert.equal(timers.size, 0);
		}
		await mood("complete");
		await advance(89_999);
		assert.equal(button.dataset.reaction, "rest");
		await advance(1);
		assert.equal(button.dataset.reaction, "dozing");
		await event("pointerover");
		await event("pointerdown");
		await event("pointerup");
		assert.equal(button.dataset.reaction, "waking");
		await advance(800);
		await event("pointerout");
		await mood("idle");
		await advance(90_000);
		await act(async () => button.focus());
		assert.equal(button.dataset.reaction, "waking");
		await visibility(true);
		await mood("working");
		await mood("idle");
		assert.equal(timers.size, 0);
		await visibility(false);
		await advance(90_000);
		assert.equal(button.dataset.reaction, "dozing");
	});
});

test("passing over or rubbing a sleeping pet leaves it asleep until an intentional greeting", async () => {
	await fixture(async ({ button, event, advance, gaze, released }) => {
		await advance(90_000);
		await event("pointerover");
		for (const screenX of [100, 120, 100, 120, 100])
			await event("pointermove", { screenX, clientY: 40 });
		await advance(5000);
		assert.equal(button.dataset.reaction, "dozing");
		assert.deepEqual(gaze(), { x: 0, y: 0 });
		assert.equal(timers.size, 0);
		assert.equal(frames.size, 0);
		await event("pointerout");
		await event("pointerdown");
		await event("pointermove", { screenX: 106 });
		await event("pointerup");
		assert.equal(released(), "tap");
		assert.equal(button.dataset.reaction, "waking");
		await advance(800);
		assert.equal(button.dataset.reaction, "rest");
	});
});

test("window activation before a click preserves the wake animation", async () => {
	for (const keyboard of [false, true]) {
		await fixture(async ({ button, event, advance }) => {
			await advance(90_000);
			await act(async () =>
				window.dispatchEvent(new dom.window.Event("focus")),
			);
			assert.equal(button.dataset.reaction, "dozing");
			if (keyboard) await act(async () => button.focus());
			else {
				await event("pointerdown");
				await act(async () => button.focus());
				await event("pointerup");
			}
			assert.equal(button.dataset.reaction, "waking");
			await advance(799);
			assert.equal(button.dataset.reaction, "waking");
			await advance(1);
			assert.equal(button.dataset.reaction, keyboard ? "curious" : "rest");
		});
	}
});

test("pointer focus yields to rest and keyboard use restores engagement without refocusing", async () => {
	await fixture(async ({ button, event, advance }) => {
		await event("pointerover");
		await event("pointerdown");
		await act(async () => button.focus());
		await event("pointerup");
		await event("pointerout");
		await advance(1200);
		assert.equal(document.activeElement, button);
		assert.equal(button.dataset.engaged, "false");
		assert.equal(button.dataset.reaction, "rest");
		await advance(26_800);
		assert.equal(button.dataset.reaction, "peekaboo");
		await advance(4800);
		await event("keydown");
		assert.equal(button.dataset.engaged, "true");
		assert.equal(button.dataset.reaction, "curious");
		await advance(57_200);
		assert.equal(button.dataset.reaction, "dozing");
		assert.equal(button.dataset.engaged, "false");
	});
});

test("returning focus after a pointer chat collapse does not block quiet opportunities", async () => {
	await fixture(async ({ button, chat, advance }) => {
		const matches = button.matches.bind(button);
		button.matches = (selector) =>
			selector === ":focus-visible" ? false : matches(selector);
		await chat(true);
		await chat(false);
		await act(async () => button.focus());
		assert.equal(document.activeElement, button);
		assert.equal(button.dataset.engaged, "false");
		await advance(28_000);
		assert.equal(button.dataset.reaction, "peekaboo");
	});
});

test("window deactivation preserves sleep even when element blur arrives first", async () => {
	for (const elementFirst of [false, true]) {
		await fixture(async ({ button, event, advance }) => {
			await act(async () => button.focus());
			await advance(90_000);
			assert.equal(button.dataset.reaction, "dozing");
			assert.equal(button.dataset.engaged, "false");
			const hasFocus = document.hasFocus;
			try {
				document.hasFocus = () => false;
				if (elementFirst) await act(async () => button.blur());
				await act(async () =>
					window.dispatchEvent(new dom.window.Event("blur")),
				);
				assert.equal(button.dataset.reaction, "dozing");
				assert.equal(timers.size, 0);
				await act(async () =>
					window.dispatchEvent(new dom.window.Event("focus")),
				);
				assert.equal(button.dataset.reaction, "dozing");
				if (elementFirst) {
					const matches = button.matches.bind(button);
					button.matches = (selector) =>
						selector === ":focus-visible" ? false : matches(selector);
					await act(async () => button.focus());
					assert.equal(button.dataset.reaction, "dozing");
				}
				await event("click");
				assert.equal(button.dataset.reaction, "waking");
			} finally {
				document.hasFocus = hasFocus;
			}
		});
	}
});

test("cancellation clears gestures and restarts sleep for visible companions", async () => {
	await fixture(async ({ button, event, advance, flush, released }) => {
		for (const [type, held] of [
			["pointercancel", 0],
			["lostpointercapture", 300],
			["blur", 1300],
		]) {
			await event("pointerdown");
			await event("pointermove", { screenX: 120 });
			await advance(held);
			button.setPointerCapture(1);
			if (type === "blur")
				await act(async () =>
					window.dispatchEvent(new dom.window.Event("blur")),
				);
			else await event(type);
			assert.equal(timers.size, 1);
			assert.equal(frames.size, 0);
			assert.equal(button.hasPointerCapture(1), false);
			await advance(100_000);
			await flush();
			await event("pointerup");
			assert.equal(released(), null);
			assert.equal(button.dataset.reaction, "dozing");
		}
	});
});

test("secondary, control-click and non-primary pointers never trigger press", async () => {
	await fixture(async ({ button, event }) => {
		for (const options of [
			{ button: 2 },
			{ button: 0, ctrlKey: true },
			{ button: 0, isPrimary: false },
		]) {
			await event("pointerdown", options);
			assert.equal(button.dataset.reaction, "rest");
		}
		await event("pointerover", { pointerType: "touch" });
		assert.equal(button.dataset.reaction, "rest");
		assert.equal(frames.size, 0);
	});
});

test("keyboard engagement survives pointer leave; unmount cancels queued tracking", async () => {
	await fixture(async ({ button, event }) => {
		await act(async () => button.focus());
		assert.equal(button.dataset.reaction, "curious");
		await event("pointerover");
		await event("pointerout");
		assert.equal(button.dataset.reaction, "curious");
		await act(async () => button.blur());
		assert.equal(button.dataset.reaction, "rest");
		await event("pointerdown");
		await event("pointermove", { screenX: 120 });
		button.setPointerCapture(1);
		assert.equal(frames.size, 1);
		assert.equal(timers.size, 2);
	});
	assert.equal(frames.size, 0);
	assert.equal(timers.size, 0);
});
