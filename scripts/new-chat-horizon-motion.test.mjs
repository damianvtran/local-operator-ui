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
const { projectHelix, trackNewChatHorizon } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

class Preference extends EventTarget {
	set(matches) {
		this.matches = matches;
		this.dispatchEvent(new Event("change"));
	}
}

function fixture({
	quiet = false,
	reduced = false,
	forced = false,
	hidden = false,
	preview = true,
} = {}) {
	const paper = new EventTarget();
	const canvas = new EventTarget();
	const document = new EventTarget();
	const view = new EventTarget();
	const motion = new Preference();
	const colors = new Preference();
	motion.matches = reduced;
	colors.matches = forced;
	const frames = new Map();
	const observers = new Set();
	let nextFrame = 0;
	let now = 0;
	let dots = [];
	let fills = [];
	let rectReads = 0;
	let colorReads = 0;
	let palette = { color: "near ink", outlineColor: "far ink" };
	const box = { left: 10, top: 50, width: 1280, height: 400 };
	const ctx = {
		clearRect() {
			dots = [];
			fills = [];
		},
		setTransform(dpr) {
			this.dpr = dpr;
		},
		beginPath() {},
		moveTo() {},
		arc(x, y, radius) {
			dots.push({
				x,
				y,
				radius,
				color: this.fillStyle,
				opacity: this.globalAlpha,
			});
		},
		fill() {
			fills.push(this.fillStyle);
		},
	};
	const observe = (name) =>
		class {
			constructor(callback) {
				this.name = name;
				this.callback = callback;
			}
			observe(target) {
				if (name === "intersection") assert.equal(target, canvas);
				observers.add(this);
			}
			disconnect() {
				observers.delete(this);
			}
		};
	Object.assign(view, {
		devicePixelRatio: 3,
		performance: { now: () => now },
		matchMedia(query) {
			if (query === "(prefers-reduced-motion: reduce)") return motion;
			assert.equal(query, "(forced-colors: active)");
			return colors;
		},
		ResizeObserver: observe("resize"),
		IntersectionObserver: observe("intersection"),
		MutationObserver: observe("palette"),
		getComputedStyle() {
			colorReads++;
			return palette;
		},
		requestAnimationFrame(callback) {
			const id = nextFrame++;
			frames.set(id, callback);
			return id;
		},
		cancelAnimationFrame(id) {
			frames.delete(id);
		},
	});
	Object.assign(canvas, {
		clientWidth: 900,
		clientHeight: 240,
		dataset: {},
		closest: () => null,
		getContext: () => ctx,
	});
	Object.assign(document, { defaultView: view, hidden, documentElement: {} });
	Object.assign(paper, {
		ownerDocument: document,
		getBoundingClientRect() {
			rectReads++;
			return box;
		},
	});
	const stop = preview
		? trackNewChatHorizon(paper, canvas, quiet, true)
		: trackNewChatHorizon(paper, canvas, quiet);
	const notify = (name, ...args) => {
		for (const observer of observers) {
			if (observer.name === name) observer.callback(...args);
		}
	};
	return {
		frames,
		motion,
		colors,
		canvas,
		ctx,
		stop,
		observers,
		dots: () => dots,
		fills: () => fills,
		state: () => canvas.dataset.loHorizonMotion,
		reads: () => [rectReads, colorReads],
		pointer(type, clientX, clientY, pointerType = "mouse") {
			const event = new Event(type);
			Object.assign(event, { pointerType, clientX, clientY });
			paper.dispatchEvent(event);
		},
		intersect(isIntersecting) {
			notify("intersection", [{ isIntersecting }]);
		},
		visibility(hidden) {
			document.hidden = hidden;
			document.dispatchEvent(new Event("visibilitychange"));
		},
		resize(width) {
			canvas.clientWidth = width;
			notify("resize");
		},
		theme(nextPalette) {
			palette = nextPalette;
			notify("palette");
		},
		flush(time) {
			assert.equal(frames.size, 1);
			const [id, callback] = frames.entries().next().value;
			frames.delete(id);
			now = time;
			callback(now);
		},
		preview(detail) {
			canvas.dispatchEvent(new CustomEvent("lo:horizon-preview", { detail }));
		},
	};
}

function pointAt(u, phase, pose) {
	const point = { u, phase, spread: 1, grain: 0, weight: 1, size: 1, speed: 1 };
	const result = {};
	projectHelix(point, pose, 900, result);
	return result;
}

test("advance transports individual grains and roll changes projection/depth without translating the sheet", () => {
	const still = { advance: 0, roll: 0, lift: 0 };
	const start = pointAt(0.2, 0, still);
	const advected = pointAt(0.2, 0, { ...still, advance: 0.1 });
	assert.ok(advected.x - start.x > 70);
	assert.notEqual(advected.y, start.y);
	const opposite = pointAt(0.2, Math.PI, still);
	const rolled = pointAt(0.2, 0, { ...still, roll: Math.PI });
	assert.ok(Math.abs(opposite.x - rolled.x) < 1e-10);
	assert.ok(Math.abs(opposite.y - rolled.y) < 1e-10);
	assert.equal(rolled.near, opposite.near);
	assert.notEqual(rolled.near, start.near);
	assert.notEqual(rolled.radius, start.radius);
	for (const phase of [0, Math.PI]) {
		const center = pointAt(0.5, phase, still);
		assert.equal(center.x, 450);
		assert.ok(Math.abs(center.y - 150) < 1e-10);
		assert.equal(center.alpha, 0);
		assert.ok(pointAt(0.48, phase, still).alpha > 0.25);
		assert.ok(pointAt(0.52, phase, still).alpha > 0.25);
		assert.equal(pointAt(0, phase, still).alpha, 0);
		assert.equal(pointAt(1, phase, still).alpha, 0);
	}
	const underHeading = pointAt(0.56, 0, still);
	assert.ok(underHeading.y > 200);
	assert.equal(underHeading.alpha, 0);
});

test("paints a complete bounded canvas on layout, plays once and seeks repeatably without an idle loop", () => {
	const h = fixture();
	const first = h.dots();
	assert.ok(first.length > 500);
	assert.equal(h.canvas.width, 1350);
	assert.equal(h.canvas.height, 360);
	assert.equal(h.ctx.dpr, 1.5);
	assert.equal(h.frames.size, 0, "no autoplay before confirmed intersection");
	h.intersect(true);
	assert.equal(h.state(), "running");
	h.flush(1000);
	assert.notDeepEqual(h.dots(), first);
	assert.deepEqual(
		h.reads(),
		[0, 1],
		"the frame must not query geometry or CSS",
	);
	h.flush(4499);
	assert.equal(h.frames.size, 1);
	h.flush(4500);
	assert.equal(h.frames.size, 0);
	assert.equal(h.state(), "still");
	const rest = h.dots();
	assert.ok(h.fills().length <= 16);
	assert.equal(h.fills().at(0), "far ink");
	assert.equal(h.fills().at(-1), "near ink");
	// Permit partial arcs at the sheet's edge, but don't batch off-sheet grains.
	assert.ok(rest.every(({ x, y }) => x > 0 && x < 900 && y >= -2 && y <= 242));
	assert.ok(
		Math.max(...rest.map(({ x }) => x)) - Math.min(...rest.map(({ x }) => x)) >
			750,
	);
	h.preview(0);
	assert.deepEqual(h.dots(), first);
	h.preview(4);
	assert.deepEqual(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.preview();
	h.flush(9000);
	assert.deepEqual(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.stop();
});

test("shipping configuration ignores preview seeks and replays", () => {
	const h = fixture({ preview: false });
	h.intersect(true);
	h.flush(4500);
	const rest = h.dots();
	h.preview(0);
	h.preview();
	assert.equal(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.stop();
});

test("mouse input eases to a clamped pose, repaints theme/resize, and rests after leaving", () => {
	const h = fixture();
	h.intersect(true);
	h.flush(4500);
	const rest = h.dots();
	h.pointer("pointermove", -1000, 9000, "touch");
	h.pointer("pointermove", -1000, 9000, "pen");
	assert.equal(h.frames.size, 0);
	h.pointer("pointermove", 10, 50);
	h.pointer("pointermove", -1000, 9000);
	assert.equal(h.frames.size, 1);
	assert.deepEqual(h.reads(), [1, 1]);
	h.flush(4800);
	const halfway = h.dots();
	assert.notDeepEqual(halfway, rest);
	h.flush(5120);
	assert.notDeepEqual(h.dots(), halfway);
	assert.equal(h.frames.size, 0);
	h.pointer("pointermove", 10, 450);
	assert.equal(h.frames.size, 0, "same clamped mouse target stays idle");
	h.pointer("pointercancel", 10, 450, "touch");
	assert.equal(h.frames.size, 0);
	h.pointer("pointerleave");
	h.flush(5740);
	assert.deepEqual(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.theme({ color: "new near", outlineColor: "new far" });
	assert.equal(h.fills().at(-1), "new near");
	assert.deepEqual(h.reads(), [1, 2]);
	h.resize(400);
	assert.equal(h.canvas.width, 600);
	assert.ok(h.dots().every(({ x }) => x < 400));
	assert.equal(h.frames.size, 0);
	h.stop();
});

test("late input has its own easing clock and does not snap the arrival", () => {
	const h = fixture();
	h.intersect(true);
	h.flush(4200);
	const unsteered = h.dots();
	h.pointer("pointermove", 1290, 450);
	h.flush(4200);
	assert.deepEqual(
		h.dots(),
		unsteered,
		"the new input starts from the painted roll",
	);
	h.flush(4500);
	assert.equal(h.frames.size, 1, "only the user-initiated burst remains");
	h.flush(4820);
	assert.equal(h.frames.size, 0);
	h.stop();
});

test("offscreen or hidden work is cancelled and never restarts itself", () => {
	const h = fixture();
	h.intersect(false);
	assert.equal(h.frames.size, 0);
	h.intersect(true);
	assert.equal(h.frames.size, 0);
	const rest = h.dots();
	h.preview();
	h.flush(900);
	h.intersect(false);
	h.preview();
	assert.equal(h.frames.size, 0);
	h.intersect(true);
	assert.deepEqual(h.dots(), rest);
	h.preview();
	h.visibility(true);
	assert.equal(h.frames.size, 0);
	h.visibility(false);
	assert.deepEqual(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.preview();
	assert.equal(h.frames.size, 1);
	h.stop();
	assert.equal(h.observers.size, 0);
	h.pointer("pointermove", 10, 50);
	h.preview();
	assert.equal(h.frames.size, 0);
	assert.equal(h.state(), "still");
});

test("reduced motion and onboarding keep a full static print; forced colors suppress particles", () => {
	for (const options of [
		{ reduced: true },
		{ quiet: true },
		{ hidden: true },
		{ forced: true },
	]) {
		const h = fixture(options);
		h.intersect(true);
		h.preview();
		h.pointer("pointermove", 10, 50);
		assert.equal(h.frames.size, 0);
		assert.equal(h.state(), "still");
		assert.equal(h.dots().length > 500, !options.forced && !options.hidden);
		h.stop();
	}
	const h = fixture();
	h.intersect(true);
	h.motion.set(true);
	assert.equal(h.frames.size, 0);
	const rest = h.dots();
	assert.ok(rest.length > 500);
	h.motion.set(false);
	assert.equal(h.frames.size, 0);
	h.preview();
	h.colors.set(true);
	assert.equal(h.frames.size, 0);
	assert.equal(h.dots().length, 0);
	h.colors.set(false);
	assert.deepEqual(h.dots(), rest);
	assert.equal(h.frames.size, 0);
	h.stop();
});
