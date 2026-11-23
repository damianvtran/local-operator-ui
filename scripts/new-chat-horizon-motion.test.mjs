import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: [
		fileURLToPath(
			new URL(
				"../src/renderer/src/shared/components/composer/new-chat-horizon-motion.ts",
				import.meta.url,
			),
		),
	],
	format: "esm",
	bundle: true,
	write: false,
});
const { trackNewChatHorizon } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

class Preference extends EventTarget {
	matches = false;
	set(matches) {
		this.matches = matches;
		this.dispatchEvent(new Event("change"));
	}
}

function fixture({ forcedColors = false } = {}) {
	const splash = new EventTarget();
	const reduced = new Preference();
	const forced = new Preference();
	forced.matches = forcedColors;
	const frames = new Map();
	let nextFrame = 0;
	let resized;
	let reads = 0;
	let box = { left: 10, top: 50, width: 200, height: 100 };
	const style = {
		transform: "",
		removeProperty(name) {
			assert.equal(name, "transform");
			this.transform = "";
		},
	};
	splash.getBoundingClientRect = () => {
		reads += 1;
		return box;
	};
	splash.ownerDocument = {
		defaultView: {
			matchMedia(query) {
				if (query === "(prefers-reduced-motion: reduce)") return reduced;
				assert.equal(query, "(forced-colors: active)");
				return forced;
			},
			ResizeObserver: class {
				constructor(callback) {
					resized = callback;
				}
				observe(element) {
					assert.equal(element, splash);
				}
				disconnect() {
					resized = undefined;
				}
			},
			requestAnimationFrame(callback) {
				const id = nextFrame++;
				frames.set(id, callback);
				return id;
			},
			cancelAnimationFrame(id) {
				frames.delete(id);
			},
		},
	};
	const stop = trackNewChatHorizon(splash, { style });
	return {
		frames,
		forced,
		reduced,
		stop,
		style,
		reads: () => reads,
		pointer(type, clientX, clientY, pointerType = "mouse") {
			const event = new Event(type);
			Object.assign(event, { pointerType, clientX, clientY });
			splash.dispatchEvent(event);
		},
		resize(nextBox) {
			box = nextBox;
			resized();
		},
		flush() {
			const [id, callback] = [...frames.entries()][0];
			frames.delete(id);
			callback();
		},
	};
}

// Drive the shipped event/resize/frame path, not a second copy of its math.
test("coalesces local mouse moves, caches geometry, and clamps the highlight sweep", () => {
	const h = fixture();
	assert.equal(h.frames.size, 0);
	h.pointer("pointermove", 900, -100);
	h.pointer("pointermove", -900, 900);
	assert.equal(h.frames.size, 1);
	assert.equal(h.reads(), 0);
	h.flush();
	assert.equal(h.style.transform, "translate3d(-32.00px, 7.00px, 0)");
	assert.equal(h.frames.size, 0);
	h.pointer("pointermove", 110, 100);
	h.flush();
	assert.equal(h.style.transform, "translate3d(0.00px, 0.00px, 0)");
	assert.equal(h.reads(), 1);
	h.resize({ left: 110, top: 100, width: 200, height: 100 });
	h.pointer("pointermove", 110, 100);
	h.flush();
	assert.equal(h.style.transform, "translate3d(-32.00px, -7.00px, 0)");
	assert.equal(h.reads(), 2);
	h.stop();
});

test("ignores touch and pen; exit resets and discards a pending frame", () => {
	const h = fixture();
	h.pointer("pointermove", 10, 50, "touch");
	h.pointer("pointermove", 10, 50, "pen");
	assert.equal(h.frames.size, 0);
	h.pointer("pointermove", 10, 50);
	h.flush();
	assert.notEqual(h.style.transform, "");
	h.pointer("pointermove", 210, 150);
	h.pointer("pointerleave");
	assert.equal(h.frames.size, 0);
	assert.equal(h.style.transform, "");
	h.pointer("pointermove", 210, 150);
	h.flush();
	assert.equal(h.style.transform, "translate3d(32.00px, 7.00px, 0)");
	assert.equal(h.reads(), 2);
	h.pointer("pointercancel", 210, 150, "touch");
	assert.notEqual(h.style.transform, "");
	h.pointer("pointermove", 10, 50);
	h.pointer("pointercancel");
	assert.equal(h.frames.size, 0);
	assert.equal(h.style.transform, "");
	h.stop();
});

test("motion preferences and cleanup turn off input and cancel pending work", () => {
	const h = fixture({ forcedColors: true });
	h.pointer("pointermove", 10, 50);
	assert.equal(h.frames.size, 0);
	h.forced.set(false);
	h.pointer("pointermove", 10, 50);
	h.flush();
	assert.notEqual(h.style.transform, "");
	h.pointer("pointermove", 210, 150);
	h.reduced.set(true);
	assert.equal(h.frames.size, 0);
	assert.equal(h.style.transform, "");
	h.pointer("pointermove", 10, 50);
	assert.equal(h.frames.size, 0);
	h.reduced.set(false);
	h.pointer("pointermove", 10, 50);
	assert.equal(h.frames.size, 1);
	h.stop();
	h.forced.set(true);
	h.forced.set(false);
	h.pointer("pointermove", 10, 50);
	assert.equal(h.frames.size, 0);
});
