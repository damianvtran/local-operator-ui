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
	let paints = 0;
	let rectReads = 0;
	let colorReads = 0;
	let palette = { color: "near ink", outlineColor: "far ink" };
	const box = { left: 10, top: 50, width: 1280, height: 400 };
	const ctx = {
		clearRect() {
			paints++;
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
		paints: () => paints,
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

// Direct (noninterpolated) projection at the pinned tuned control. This
// oracle deliberately does not use the renderer's axial profile or clips.
function exactProjection(point, pose, width) {
	const unit = (n) => Math.min(1, Math.max(0, n));
	const feather = (n) => unit(n) ** 2 * (3 - 2 * unit(n));
	const tau = Math.PI * 2;
	const position = point.u + pose.advance * point.speed;
	const u = position - Math.floor(position);
	const axis = u - 0.5;
	const flank = feather(Math.abs(axis) / 0.16);
	const taper = feather(u / 0.25) * feather((1 - u) / 0.26);
	const open = feather(u / 0.145) * feather((1 - u) / 0.17);
	const squeeze = Math.min(1, width / 680);
	const phase =
		tau * (2.76 * axis + 0.031 * Math.sin(tau * axis)) +
		point.phase +
		pose.roll * (0.12 + 0.88 * flank);
	const depth = Math.cos(phase);
	const side = feather((axis + 0.24) / 0.53);
	const x = width * (0.5 + axis * 0.96) + depth * 9 * taper * squeeze * flank;
	const y =
		150 +
		squeeze *
			(-flank * (44 - 27 * side) +
				Math.sin(phase) *
					(91 - 20 * side + 10 * Math.sin(tau * u)) *
					taper *
					point.spread +
				point.grain * (0.33 + 0.67 * taper) +
				pose.lift * flank * taper);
	const recess = feather(
		(Math.hypot((x - width / 2) / 21, (y - 150) / 23) - 0.92) / 0.36,
	);
	const copySpace =
		1 - feather((y - 174) / 21) * feather((0.31 - Math.abs(axis)) / 0.17);
	const breakup = 0.9 + 0.1 * Math.cos(43 * u + point.phase * 1.3) ** 2;
	const front = (depth + 1) / 2;
	return {
		x,
		y,
		alpha:
			open ** 1.75 *
			recess *
			copySpace ** 2 *
			breakup *
			point.weight *
			(0.59 + 0.41 * front) *
			(0.88 + 0.12 * (1 - side)),
		radius: point.size * (0.72 + 0.28 * front) * (0.8 + 0.2 * squeeze),
		near: depth > -0.1,
	};
}

test("axial interpolation stays subpixel and inside one negligible slice of an ink step", () => {
	let seed = 0x93b1;
	const sample = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 0x100000000;
	};
	for (let i = 0; i < 12_000; i++) {
		const point = {
			u: sample(),
			phase: 6.28 * sample() - 3.14,
			spread: 0.64 + 0.52 * sample(),
			grain: 16 * sample() - 8,
			weight: 0.3 + 0.7 * sample(),
			size: 0.46 + 1.16 * sample(),
			speed: 0.87 + 0.26 * sample(),
		};
		const pose = {
			advance: 0.14 * sample(),
			roll: -2.17 + 2.49 * sample(),
			lift: 20 * sample() - 10,
		};
		const width = [180, 390, 680, 900][i % 4];
		const exact = exactProjection(point, pose, width);
		const actual = {};
		projectHelix(point, pose, width, actual);
		assert.ok(Math.abs(exact.x - actual.x) < 0.01);
		assert.ok(Math.abs(exact.y - actual.y) < 0.01);
		assert.ok(Math.abs(exact.radius - actual.radius) < 0.0001);
		assert.ok(Math.abs(exact.alpha - actual.alpha) < 0.001);
		assert.equal(exact.near, actual.near);
	}
});

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

test("60, 120 and 144 Hz displays all paint about 60 times a second", () => {
	for (const hz of [60, 120, 144]) {
		const h = fixture();
		h.intersect(true);
		const before = h.paints();
		const callbacks = (4500 / 1000) * hz;
		for (let i = 1; i < callbacks; i++) {
			// Small deterministic timestamp jitter must not halve actual 60 Hz.
			h.flush((i * 1000) / hz + (i % 2 === 0 ? -0.35 : 0.35));
		}
		h.flush(4500);
		const painted = h.paints() - before;
		assert.ok(Math.abs(painted - 270) <= 2, `${hz} Hz painted ${painted}`);
		assert.equal(h.frames.size, 0);
		h.stop();
	}
});

test("the exact rest pose is painted even before the next paint deadline", () => {
	const h = fixture();
	const still = fixture({ quiet: true });
	h.intersect(true);
	h.flush(4485);
	const before = h.paints();
	h.flush(4490);
	assert.equal(h.paints(), before);
	h.flush(4500);
	assert.equal(h.paints(), before + 1);
	assert.deepEqual(h.dots(), still.dots());
	assert.equal(h.frames.size, 0);
	h.stop();
	still.stop();
});

test("sustained late frames settle once and stop decorative work for the mounted splash", () => {
	const h = fixture();
	const still = fixture({ quiet: true });
	h.intersect(true);
	for (const now of [17, 50, 83, 116, 133]) h.flush(now);
	assert.equal(h.state(), "running", "an isolated delay streak recovers");
	h.pointer("pointermove", 1290, 450);
	for (const now of [166, 199, 232]) h.flush(now);
	const before = h.paints();
	h.flush(265);
	assert.equal(h.paints(), before + 1);
	assert.deepEqual(
		h.dots(),
		still.dots(),
		"the degraded pose is the exact unsteered rest pose",
	);
	assert.equal(h.state(), "still");
	h.pointer("pointermove", 10, 50);
	h.pointer("pointerleave");
	h.preview();
	assert.equal(h.frames.size, 0);
	assert.equal(h.paints(), before + 1);
	h.visibility(true);
	h.visibility(false);
	h.motion.set(true);
	h.motion.set(false);
	assert.equal(
		h.frames.size,
		0,
		"environment changes do not re-arm the degraded scene",
	);
	assert.deepEqual(h.dots(), still.dots());
	h.stop();
	still.stop();
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

test("light paper lifts only mid-ink levels and never changes grain geometry", () => {
	const h = fixture({ quiet: true });
	const dark = h.dots();
	h.theme({ color: "near ink", outlineColor: "far ink", colorScheme: "light" });
	const light = h.dots();
	assert.ok(dark.some(({ opacity }) => opacity > 0.115 && opacity < 0.92));
	assert.deepEqual(
		light,
		dark.map((dot) => ({
			...dot,
			opacity:
				dot.opacity > 0.115 && dot.opacity < 0.92
					? dot.opacity * 1.12
					: dot.opacity,
		})),
	);
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
