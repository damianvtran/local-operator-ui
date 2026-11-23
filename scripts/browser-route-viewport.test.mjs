import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { transformSync } from "esbuild";

const read = (path) => readFileSync(`src/renderer/src/${path}`, "utf8");
const require = createRequire(import.meta.url);

function compile(path, globals = {}) {
	const { code } = transformSync(read(path), { loader: "ts", format: "cjs" });
	return new Function(
		"module",
		"require",
		...Object.keys(globals),
		`${code}\nreturn module.exports;`,
	)({ exports: {} }, require, ...Object.values(globals));
}

const viewportPath = "features/browser/browser-route-viewport.ts";
const FRAME_RADIUS = /--workspace-frame-radius: ([\d.]+)px;/;
const NATIVE_INSET =
	/padding: calc\(var\(--workspace-frame-radius\) \* ([.\d]+)\);/;

function frameClock() {
	let id = 0;
	const callbacks = new Map();
	return {
		requestAnimationFrame: (callback) => {
			callbacks.set(++id, callback);
			return id;
		},
		cancelAnimationFrame: (key) => callbacks.delete(key),
		advance() {
			const ready = [...callbacks.values()];
			callbacks.clear();
			for (const callback of ready) callback();
			return ready.length;
		},
	};
}

test("the native DIPs stay strictly inside the shared rounded clip", () => {
	const css = read("styles/index.css");
	const radius = Number(css.match(FRAME_RADIUS)[1]);
	const ratio = Number(css.match(NATIVE_INSET)[1]);
	assert.ok(
		Math.SQRT2 * (1 - ratio) < 1,
		"the native corners fit inside the arc",
	);
	const { measureBrowserRouteRect } = compile(viewportPath);
	const pad = radius * ratio;
	const rect = {
		left: 8.25 + pad,
		top: 78.5 + pad,
		right: 692.75 - pad,
		bottom: 892.1 - pad,
	};
	const host = { getBoundingClientRect: () => rect };
	assert.deepEqual(measureBrowserRouteRect(host), {
		x: 12,
		y: 82,
		width: 677,
		height: 807,
	});
	for (const axis of ["right", "bottom"]) {
		const start = axis === "right" ? rect.left : rect.top;
		assert.equal(
			measureBrowserRouteRect({
				getBoundingClientRect: () => ({ ...rect, [axis]: start }),
			}),
			null,
		);
	}
});

test("the route reports motion without resize, shares overlay bounds, and clears on detach", () => {
	const clock = frameClock();
	const { measureBrowserRouteRect, trackBrowserRouteRect } = compile(
		viewportPath,
		{
			requestAnimationFrame: clock.requestAnimationFrame,
			cancelAnimationFrame: clock.cancelAnimationFrame,
		},
	);
	const { overlapsBrowserView, registerBrowserViewRect } = compile(
		"shared/browser-view-policy.ts",
	);
	const painted = [];
	let rect = { left: 10, top: 20, right: 110, bottom: 120 };
	const readRect = () =>
		measureBrowserRouteRect({ getBoundingClientRect: () => rect });
	const release = registerBrowserViewRect(readRect);
	const stop = trackBrowserRouteRect(readRect, (value) => painted.push(value));
	const overlay = { x: 7, y: 20, width: 3, height: 4 };
	try {
		assert.equal(
			overlapsBrowserView(overlay),
			false,
			"touching the native edge is not overlap",
		);
		assert.equal(clock.advance(), 1);
		assert.equal(
			painted.length,
			1,
			"an unchanged rectangle does not send an update",
		);
		rect = { ...rect, left: 9, right: 109 };
		assert.equal(clock.advance(), 1);
		assert.deepEqual(painted.at(-1), { x: 9, y: 20, width: 100, height: 100 });
		assert.equal(
			overlapsBrowserView(overlay),
			true,
			"an overlay reads the same moved bounds",
		);
		rect = { ...rect, right: 9 };
		clock.advance();
		assert.equal(
			painted.at(-1),
			null,
			"a zero-area dock withdraws the native view",
		);
		assert.equal(overlapsBrowserView(overlay), false);
		rect = { ...rect, right: 109 };
		clock.advance();
		assert.deepEqual(painted.at(-1), { x: 9, y: 20, width: 100, height: 100 });
	} finally {
		release();
		stop();
	}
	assert.equal(painted.at(-1), null, "unmount sends the hide synchronously");
	assert.equal(overlapsBrowserView(overlay), false);
	assert.equal(
		clock.advance(),
		0,
		"no stale tick can republish bounds after departure",
	);
});
