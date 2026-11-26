/**
 * Inline chart geometry, palette and interaction (inline chart spec sections
 * 1-6), pinned the way the three surfaces share them.
 *
 * WHY THESE. The operator reported axes that were "not proper", a squashed
 * scale, a tiny pie labelled in separate rows, slices that differed only by
 * shade, and no way to read a point's value. Each test below pins one of the
 * spec's numbers or behaviours that answer that report, so a later refactor
 * cannot quietly bring the old behaviour back:
 *
 *  - nice ticks and the zero rule (the operator's 84-154 USD series reads 80-160),
 *  - x-label thinning (32 labels at 360px never overlap; first and last shown),
 *  - the derived chart palette's golden vectors (relay web and React Native pin
 *    the same four vectors) and its 3.05:1 floor on every built-in palette,
 *  - pie folding into "Other (n)",
 *  - the one-tab-stop keyboard model and the collapsed "Chart data" disclosure,
 *    mounted in jsdom against the production host component.
 *
 * Harness: `account-profile-editor-dom.test.mjs`'s esbuild bundle with React
 * external and jsdom installed before the bundle is evaluated.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import {
	CHART_SLOTS,
	chartDistance,
	chartGrounds,
	chartPalette,
} from "../src/shared/theme-engine/chart-palette.mjs";
import { ratio } from "../src/shared/theme-engine/color.mjs";
import { composeTheme } from "../src/shared/theme-engine/compose.mjs";
import { paletteBlock } from "../src/shared/theme-engine/css.mjs";
import { hexToOklch } from "../src/shared/theme-engine/oklch.mjs";
import { loadPalettes } from "./palette-source.mjs";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/inline-chart-model";',
			'export { InlineUiHost } from "./src/renderer/src/features/chat/canonical/inline-ui-host";',
			'export { compactTickFormat, placeTooltip, besideRoom, resetTextMeasurer, textWidth, TAP_SLOP } from "./src/renderer/src/features/chat/canonical/inline-chart-frame";',
			'export { heatFill, HEAT_FLOOR } from "./src/renderer/src/features/chat/canonical/inline-heatmap-chart";',
			'export { useEffect, useLayoutEffect, useState } from "react";',
			'export { setLocale } from "./src/renderer/src/shared/i18n";',
			'export { createElement } from "react";',
			'export { createRoot } from "react-dom/client";',
			'export { act } from "react";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_inline-chart-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

/* The DOM arrives before the bundle so react-dom sees a window when it is first
   evaluated (see account-profile-editor-dom.test.mjs for why that matters). */
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", { url: "http://localhost/" });
const { window } = dom;
// jsdom lays nothing out: every chart measures its box as 760px wide (the
// spec's wide reference width) unless a test sets `data-width` on a parent.
Object.defineProperty(window.HTMLElement.prototype, "clientWidth", {
	configurable: true,
	get() {
		const sized = this.closest?.("[data-width]");
		return sized ? Number(sized.getAttribute("data-width")) : 760;
	},
});
// No canvas in jsdom: the renderer falls back to its 6.6px-per-char estimate.
window.HTMLCanvasElement.prototype.getContext = () => null;
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
};
for (const key of [
	"Element",
	"Node",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
]) {
	if (key in window) shims[key] = window[key];
}
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
});

const chart = await import(bundlePath.href);
await unlink(bundlePath);
const { InlineUiHost, setLocale, createElement: h, createRoot, act } = chart;
setLocale("en");

const mounted = [];
const mount = async (value, width = 760) => {
	const container = document.createElement("div");
	container.setAttribute("data-width", String(width));
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => root.render(h(InlineUiHost, { value })));
	mounted.push(root);
	return container;
};
after(async () => {
	for (const root of mounted) await act(async () => root.unmount());
	window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

// The operator's Datadog spend series (screenshot, 2026-11-26).
const SPEND = {
	type: "line",
	title: "Datadog daily allocated spend through Nov 24 (UTC)",
	unit: "USD",
	data: [
		["Nov 16", 153.66],
		["Nov 17", 143.37],
		["Nov 18", 140.61],
		["Nov 19", 141.67],
		["Nov 20", 126.94],
		["Nov 21", 118.38],
		["Nov 22 · PDF ends", 109.2],
		["Nov 23", 124.37],
		["Nov 24 · rollout", 84.04],
	],
};

// ---- section 1-2: geometry -------------------------------------------------

test("plot height follows clamp(180, round(W x 0.34), 240)", () => {
	assert.equal(chart.plotHeight(760), 240);
	assert.equal(chart.plotHeight(360), 180);
	assert.equal(chart.plotHeight(600), 204);
	assert.equal(chart.plotHeight(2000), 240);
	assert.equal(chart.donutDiameter(760), 200);
	assert.equal(chart.donutDiameter(360), 180);
	assert.equal(chart.donutDiameter(190), 158);
});

test("nice ticks: the operator's 84-154 series reads 80-160 in steps of 20, without 0", () => {
	const values = SPEND.data.map(([, n]) => n);
	const wide = chart.niceTicks(values, 240, "near");
	assert.deepEqual(wide.ticks, [80, 100, 120, 140, 160]);
	assert.equal(wide.step, 20);
	assert.equal(chart.tickTarget(240), 5);
	// X1: the target never drops below 4, so the 180px narrow plot reads the
	// same 80-160 axis instead of 50-200 (design review D4).
	assert.equal(chart.tickTarget(180), 4);
	assert.equal(chart.tickTarget(120), 4);
	const narrow = chart.niceTicks(values, 180, "near");
	assert.deepEqual(narrow.ticks, [80, 100, 120, 140, 160]);
	assert.equal(narrow.step, 20);
});

test("tiny domains keep distinct ticks (no toFixed collapse to 0)", () => {
	const ticks = chart.niceTicks([1e-300, 2e-300], 240, "near");
	assert.equal(
		new Set(ticks.ticks).size,
		ticks.ticks.length,
		String(ticks.ticks),
	);
	assert.ok(ticks.min <= 1e-300 && ticks.max >= 2e-300);
	// Float noise still rounds away.
	assert.deepEqual(
		chart.niceTicks([0, 0.25, 0.4], 240, "always").ticks,
		[0, 0.1, 0.2, 0.3, 0.4],
	);
});

test("nice ticks: steps come from {1, 2, 2.5, 5} x 10^k and carry the step's decimals", () => {
	for (const [values, height] of [
		[[0.12, 0.93], 240],
		[[3, 17], 240],
		[[-42, 61], 180],
		[[1_234, 98_765], 240],
		[[0.0003, 0.0021], 200],
	]) {
		const ticks = chart.niceTicks(values, height, "always");
		const exponent = Math.floor(Math.log10(ticks.step));
		const mantissa = Number((ticks.step / 10 ** exponent).toFixed(6));
		assert.ok([1, 2, 2.5, 5].includes(mantissa), `${values}: ${ticks.step}`);
		assert.ok(ticks.ticks.length <= chart.tickTarget(height) + 1);
		assert.ok(ticks.min <= Math.min(0, ...values));
		assert.ok(ticks.max >= Math.max(0, ...values));
		for (const tick of ticks.ticks)
			assert.equal(
				Number(tick.toFixed(ticks.decimals)),
				tick,
				`${tick} carries more than ${ticks.decimals} decimals`,
			);
	}
	assert.equal(chart.niceTicks([0, 0.25, 0.4], 240, "always").step, 0.1);
	assert.equal(chart.niceTicks([0, 7.5], 240, "always").decimals, 0);
});

test("the zero rule: bars always include 0, lines only when 0 is within a third of the range", () => {
	assert.equal(chart.niceTicks([84, 154], 240, "always").min, 0);
	assert.ok(chart.niceTicks([84, 154], 240, "near").min > 0);
	// 0 lies within [min - range/3, max + range/3]: included.
	assert.equal(chart.niceTicks([20, 80], 240, "near").min, 0);
	// Negatives keep their own minimum.
	assert.ok(chart.niceTicks([-12, 30], 240, "always").min <= -12);
	// Flat data pads 10% of the value, or 1 at zero.
	const flat = chart.niceTicks([50, 50, 50], 240, "near");
	assert.ok(
		flat.min <= 45 && flat.max >= 55 && flat.min > 0,
		String(flat.ticks),
	);
	const zero = chart.niceTicks([0, 0], 240, "near");
	assert.ok(zero.min <= -1 && zero.max >= 1);
	assert.deepEqual(chart.PERCENT_TICKS.ticks, [0, 25, 50, 75, 100]);
});

test("a dual chart's right axis uses the left axis's tick count", () => {
	const left = chart.niceTicks([62, 92], 240, "near");
	const right = chart.fixedCountTicks([128, 182], left.ticks.length, "near");
	assert.equal(right.ticks.length, left.ticks.length);
	assert.ok(right.min <= 128 && right.max >= 182);
});

test("ticks go compact from 10 000; values never do", () => {
	assert.equal(
		chart.compactTicks(chart.niceTicks([0, 12_500], 240, "always")),
		true,
	);
	// The DOMAIN decides: 9 000 rounds out to a 10 000 top tick, so it is compact too.
	assert.equal(
		chart.compactTicks(chart.niceTicks([0, 9_000], 240, "always")),
		true,
	);
	assert.equal(
		chart.compactTicks(chart.niceTicks([0, 8_000], 240, "always")),
		false,
	);
});

test("compact tick labels are unique per axis: the fewest exact decimals, else full numbers", () => {
	const labelsOf = (values, locale = "en") => {
		const ticks = chart.niceTicks(values, 240, "near");
		const format = chart.compactTickFormat(locale, ticks.ticks);
		return format ? ticks.ticks.map((tick) => format.format(tick)) : null;
	};
	// Code review R1's repros: one decimal printed 10.1K twice and 1M five times.
	const tight = labelsOf([10_050, 10_300]);
	assert.deepEqual(tight, [
		"10.05K",
		"10.10K",
		"10.15K",
		"10.20K",
		"10.25K",
		"10.30K",
	]);
	const million = labelsOf([1_000_000, 1_004_000]);
	assert.deepEqual(million, ["1.000M", "1.001M", "1.002M", "1.003M", "1.004M"]);
	// Whole steps stay whole; a 2.5K step keeps its one decimal.
	assert.deepEqual(labelsOf([0, 4e12]), ["0", "1T", "2T", "3T", "4T"]);
	const quarters = [0, 2_500, 5_000, 7_500, 10_000];
	const quarterFormat = chart.compactTickFormat("en", quarters);
	assert.deepEqual(
		quarters.map((tick) => quarterFormat.format(tick)),
		["0.0", "2.5K", "5.0K", "7.5K", "10.0K"],
	);
	// More than 3 decimals of mantissa: full grouped numbers instead (null).
	assert.equal(chart.compactTickFormat("en", [1_000_000, 1_000_050]), null);
	// Locales with other compact scales stay unique too.
	for (const locale of ["zh-CN", "hi", "fr", "ru"])
		for (const values of [
			[10_050, 10_300],
			[1_000_000, 1_004_000],
		]) {
			const labels = labelsOf(values, locale);
			if (labels)
				assert.equal(
					new Set(labels).size,
					labels.length,
					`${locale}: ${labels}`,
				);
		}
});

test("units: no space before %, ‰ and degrees, one space otherwise", () => {
	assert.equal(chart.withUnit("38.2", "%"), "38.2%");
	assert.equal(chart.withUnit("21", "°C"), "21°C");
	assert.equal(chart.withUnit("140.61", "USD"), "140.61 USD");
	assert.equal(chart.withUnit("7"), "7");
	assert.equal(chart.axisText("Nov 24 · rollout"), "Nov 24");
	assert.equal(chart.axisText("Nov 24"), "Nov 24");
});

test("label planning: real anchored boxes keep 4px apart for any count and length", () => {
	const measure = (text) => Array.from(text).length * 6.6;
	const words = [
		"Q",
		"Nov 24",
		"2026-11-01",
		"Week 3 of the quarterly reporting period",
		"2025-11-16 14:00 UTC",
	];
	for (const width of [200, 360, 520, 760]) {
		const x0 = 40;
		const x1 = width - 12;
		for (let n = 1; n <= 32; n++) {
			for (const [w, word] of words.entries()) {
				const texts = Array.from({ length: n }, (_, i) =>
					`${word} ${(i * 7 + w) % 13}`.slice(0, 4 + ((i * 11 + w * 5) % 40)),
				);
				for (const line of [true, false]) {
					const slot = line ? (n > 1 ? (x1 - x0) / (n - 1) : 0) : (x1 - x0) / n;
					const xs = texts.map((_, i) =>
						line
							? n > 1
								? x0 + i * slot
								: (x0 + x1) / 2
							: x0 + (i + 0.5) * slot,
					);
					const anchors = texts.map((_, i) =>
						line && n > 1
							? i === 0
								? "start"
								: i === n - 1
									? "end"
									: "middle"
							: "middle",
					);
					const placed = chart.planXLabels({
						texts,
						xs,
						anchors,
						bounds: [0, width],
						measure,
					});
					const where = `W ${width} n ${n} ${word} ${line ? "line" : "bars"}`;
					assert.equal(placed[0].index, 0, `${where}: first shown`);
					if (n > 1 && width >= 200)
						assert.equal(placed.at(-1).index, n - 1, `${where}: last shown`);
					for (const label of placed) {
						const [left, right] = chart.labelBox(
							label.x,
							measure(label.text),
							label.anchor,
						);
						assert.ok(
							Math.abs(left - label.left) < 1e-9 &&
								Math.abs(right - label.right) < 1e-9,
						);
						const full = texts[label.index];
						assert.ok(
							label.text === full ||
								(label.text.endsWith("…") &&
									full.startsWith(label.text.slice(0, -1).trimEnd())),
							`${where}: ${label.text} is not ${full} or its truncation`,
						);
					}
					for (let i = 1; i < placed.length; i++)
						assert.ok(
							placed[i - 1].right + chart.LABEL_MIN_GAP <=
								placed[i].left + 1e-9,
							`${where}: labels ${placed[i - 1].index} and ${placed[i].index} overlap (${placed[i - 1].right} vs ${placed[i].left})`,
						);
				}
			}
		}
	}
	// Short labels at a roomy width all show.
	assert.deepEqual(
		chart
			.planXLabels({
				texts: ["A", "B", "C"],
				xs: [40, 200, 360],
				anchors: ["start", "middle", "end"],
				bounds: [0, 372],
				measure,
			})
			.map(({ index }) => index),
		[0, 1, 2],
	);
});

test("horizontal bars for many categories, long labels, or narrow and more than six", () => {
	const short = ["A", "B", "C"];
	assert.equal(chart.barsHorizontal(short, 760), false);
	assert.equal(chart.barsHorizontal(Array(13).fill("A"), 760), true);
	assert.equal(chart.barsHorizontal(["North America West"], 760), true);
	assert.equal(chart.barsHorizontal(Array(7).fill("A"), 400), true);
	assert.equal(chart.barsHorizontal(Array(7).fill("A"), 760), false);
});

// ---- section 3: pie folding ------------------------------------------------

test("pie: more than seven items fold the smallest into Other (n), last and colourless", () => {
	const data = Array.from({ length: 12 }, (_, i) => [`Item ${i + 1}`, 12 - i]);
	const slices = chart.pieSlices(
		[...data].reverse(),
		(count) => `Other (${count})`,
	);
	assert.equal(slices.length, 7);
	assert.deepEqual(
		slices.slice(0, 6).map((slice) => slice.label),
		["Item 1", "Item 2", "Item 3", "Item 4", "Item 5", "Item 6"],
	);
	assert.deepEqual(
		slices.map((slice) => slice.slot),
		[0, 1, 2, 3, 4, 5, null],
	);
	const other = slices[6];
	assert.equal(other.label, "Other (6)");
	assert.equal(other.amount, 6 + 5 + 4 + 3 + 2 + 1);
	assert.equal(other.folded.length, 6);
	const total = slices.reduce((sum, slice) => sum + slice.share, 0);
	assert.ok(Math.abs(total - 1) < 1e-12);
	assert.equal(slices[0].start, 0);
	assert.equal(slices.at(-1).end, Math.PI * 2);
	// Seven or fewer: no fold, sorted descending.
	const few = chart.pieSlices(
		[
			["a", 1],
			["b", 3],
			["c", 2],
		],
		() => "Other",
	);
	assert.deepEqual(
		few.map((slice) => slice.label),
		["b", "c", "a"],
	);
	assert.ok(few.every((slice) => slice.slot !== null));
});

test("label relaxation keeps order, an 18px gap and the bounds", () => {
	const ys = chart.relaxLabels([10, 12, 14, 200], 18, 8, 216);
	assert.deepEqual(ys.slice(0, 3), [10, 28, 46]);
	assert.equal(ys[3], 200);
	const squeezed = chart.relaxLabels([200, 205, 210], 18, 8, 216);
	assert.deepEqual(squeezed, [180, 198, 216]);
	assert.equal(chart.inRingInk("#FFFFFF"), "#000");
	assert.equal(chart.inRingInk("#1762B6"), "#fff");
	// Mid grey: black reaches 4.68:1, white 4.49:1, so black.
	assert.equal(chart.inRingInk("#777777"), "#000");
	assert.equal(chart.inRingInk("currentColor"), null);
});

// ---- section 4: colour -----------------------------------------------------

test("chart palette: golden vectors (shared with relay web and React Native)", () => {
	const golden = [
		[
			"localOperatorDark",
			["#1d1b17", "#26221c", "#2a261d"],
			"#38c96a",
			"#38C96A #92C1FD #17B6A8 #DCBC33 #AD87ED #FF96D3 #E18528",
		],
		[
			"localOperatorLight",
			["#f2ede3", "#f7f5ee", "#fcfbf7"],
			"#137742",
			"#137742 #1762B6 #059488 #9B3876 #977E0D #915006 #8F68CB",
		],
		[
			"highContrastLight",
			["#E6E6E6", "#F2F2F2", "#fafafa"],
			"#0846C1",
			"#0846C1 #756208 #159085 #9B3876 #CA5551 #107823 #8F68CB",
		],
		[
			"dracula",
			["#1D1F2B", "#232539", "#232539"],
			"#C096FC",
			"#C096FC #DCBC33 #17B6A8 #7BD77F #E18528 #FF96D3 #ED756E",
		],
	];
	for (const [name, grounds, accent, expected] of golden)
		assert.equal(chartPalette({ grounds, accent }).join(" "), expected, name);
});

const assertPalette = (name, palette) => {
	const grounds = chartGrounds(palette);
	const slots = chartPalette({ grounds, accent: palette.accent });
	assert.equal(slots.length, CHART_SLOTS, name);
	assert.equal(
		slots[0],
		palette.accent.toUpperCase(),
		`${name}: slot 1 is the accent`,
	);
	assert.equal(new Set(slots).size, CHART_SLOTS, `${name}: duplicate slot`);
	for (const slot of slots.slice(1))
		for (const ground of grounds)
			assert.ok(
				ratio(slot, ground) >= 3.05,
				`${name}: ${slot} on ${ground} is ${ratio(slot, ground).toFixed(2)}:1`,
			);
	// Distinct hues, not shades: derived slots sit on different base hues.
	const hues = slots.slice(1).map((slot) => Math.round(hexToOklch(slot).h));
	for (let i = 0; i < hues.length; i++)
		for (let j = i + 1; j < hues.length; j++) {
			const gap = Math.abs(hues[i] - hues[j]) % 360;
			assert.ok(Math.min(gap, 360 - gap) > 20, `${name}: hues ${hues}`);
		}
	return slots;
};

test("chart palette on every built-in palette: >= 3.05:1 on every ground, distinct hues", () => {
	const palettes = loadPalettes();
	assert.equal(palettes.length, 59);
	let minimumPair = Number.POSITIVE_INFINITY;
	for (const { id, palette } of palettes) {
		const slots = assertPalette(id, palette);
		for (let i = 0; i < slots.length; i++)
			for (let j = i + 1; j < slots.length; j++)
				minimumPair = Math.min(minimumPair, chartDistance(slots[i], slots[j]));
		// The emitter writes them, so built-ins get the tokens from the build.
		const block = paletteBlock(id, palette);
		for (let n = 1; n <= CHART_SLOTS; n++)
			assert.match(block, new RegExp(`--lo-chart-${n}: ${slots[n - 1]};`));
	}
	assert.ok(minimumPair > 0, String(minimumPair));
});

test("a composed palette (contrast preset + custom accent) derives its own chart slots", () => {
	const dark = loadPalettes().find(({ id }) => id === "localOperatorDark");
	const composed = composeTheme(dark.palette, {
		id: dark.id,
		contrast: 50,
		accent: { kind: "custom", hex: "#E0457B" },
	});
	assert.equal(composed.identity, false);
	const slots = assertPalette("composed", composed.palette);
	const block = paletteBlock(composed.id, composed.palette);
	assert.match(block, new RegExp(`--lo-chart-1: ${slots[0]};`));
	assert.notEqual(slots[0], "#38C96A");
	// A partial palette (no flat canvas/accent) emits no chart lines at all.
	assert.doesNotMatch(
		paletteBlock("partial", { mode: "dark", ink: "#ffffff" }),
		/--lo-chart-/,
	);
});

// ---- sections 1, 5, 6: the mounted renderer ---------------------------------

// The plot's SVG (inside the focus root), not a legend swatch's.
const svgOf = (container) =>
	container.querySelector("[role=group] svg[viewBox]");
const tabStops = (container) =>
	[...container.querySelectorAll("[tabindex]")].filter(
		(node) => node.getAttribute("tabindex") === "0",
	);
const press = async (node, key) =>
	act(async () => {
		node.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
const liveText = (container) =>
	container.querySelector('[aria-live="polite"]').textContent;

test("the line chart is drawn at its measured size: 240px plot at 760, 180 at 360", async () => {
	for (const [width, plot] of [
		[760, 240],
		[360, 180],
	]) {
		const container = await mount(SPEND, width);
		const svg = svgOf(container);
		const height = plot + 12 + 24;
		assert.equal(svg.getAttribute("viewBox"), `0 0 ${width} ${height}`);
		assert.equal(svg.getAttribute("width"), String(width));
		assert.equal(svg.getAttribute("height"), String(height));
		assert.notEqual(svg.getAttribute("preserveAspectRatio"), "none");
	}
});

test("the operator's series: ticks 80-160, USD once, annotated label cut on the axis", async () => {
	const container = await mount(SPEND);
	const texts = [...svgOf(container).querySelectorAll("text")].map(
		(node) => node.textContent,
	);
	for (const tick of ["80", "100", "120", "140", "160"])
		assert.ok(texts.includes(tick), `${tick} missing from ${texts}`);
	assert.ok(!texts.includes("0"));
	assert.ok(texts.includes("Nov 24"));
	assert.ok(!texts.some((text) => text.includes("rollout")));
	const visible = container.cloneNode(true);
	for (const hidden of visible.querySelectorAll("[hidden]")) hidden.remove();
	assert.equal(visible.textContent.split("USD").length - 1, 1);
});

test("one tab stop; arrows, Home/End and Escape drive the active mark and the live region", async () => {
	const container = await mount(SPEND);
	const stops = tabStops(container);
	assert.equal(stops.length, 1, "exactly one tab stop on the chart");
	const root = stops[0];
	assert.equal(root.getAttribute("role"), "group");
	assert.equal(root.getAttribute("aria-roledescription"), "chart");
	assert.ok(document.getElementById(root.getAttribute("aria-describedby")));
	await act(async () => root.focus());
	assert.equal(liveText(container), "Nov 16, 153.66 USD, 1 of 9");
	await press(root, "ArrowRight");
	await press(root, "ArrowRight");
	assert.equal(liveText(container), "Nov 18, 140.61 USD, 3 of 9");
	const tooltip = container.querySelector("[data-lo-chart-tooltip]");
	assert.ok(tooltip, "tooltip shows for the active mark");
	assert.ok(tooltip.hasAttribute("data-lo-floating"));
	assert.match(tooltip.className, /pointer-events-none/);
	assert.doesNotMatch(tooltip.className, /\bborder\b/);
	await press(root, "End");
	assert.equal(liveText(container), "Nov 24 · rollout, 84.04 USD, 9 of 9");
	assert.match(
		container.querySelector("[data-lo-chart-tooltip]").textContent,
		/Nov 24 · rollout/,
	);
	await press(root, "Home");
	assert.match(liveText(container), /1 of 9$/);
	await press(root, "Escape");
	assert.equal(container.querySelector("[data-lo-chart-tooltip]"), null);
	assert.equal(document.activeElement, root, "Escape keeps focus");
	await press(root, "ArrowLeft");
	assert.match(liveText(container), /^Nov 16/);
});

test("Up/Down move between series and the tooltip lists every series at that x", async () => {
	const container = await mount({
		type: "series",
		title: "Revenue and refunds",
		mode: "grouped",
		unit: "USD",
		labels: ["Q1", "Q2", "Q3"],
		series: [
			{ label: "Revenue", values: [62, 80, 78] },
			{ label: "Refunds", values: [-12, -9, -18] },
		],
	});
	const root = tabStops(container)[0];
	await act(async () => root.focus());
	await press(root, "ArrowDown");
	assert.equal(liveText(container), "Q1, Refunds, -12 USD, 1 of 3");
	const tooltip = container.querySelector("[data-lo-chart-tooltip]");
	assert.match(tooltip.textContent, /Revenue.*62 USD.*Refunds.*-12 USD/);
	await press(root, "ArrowUp");
	assert.match(liveText(container), /^Q1, Revenue, 62 USD/);
});

test("Chart data is collapsed by default and lists every row when expanded", async () => {
	const container = await mount(SPEND);
	const toggle = [...container.querySelectorAll("button")].find((button) =>
		button.textContent.includes("Chart data"),
	);
	assert.ok(toggle, "Chart data button");
	assert.equal(toggle.getAttribute("aria-expanded"), "false");
	const shown = () =>
		[...container.querySelectorAll("[data-lo-chart-data] table")].filter(
			(table) => !table.closest("[hidden]"),
		);
	assert.equal(shown().length, 0, "no visible table while collapsed");
	await act(async () => toggle.click());
	assert.equal(toggle.getAttribute("aria-expanded"), "true");
	const [table] = shown();
	assert.equal(table.querySelectorAll("tbody tr").length, 9);
	assert.match(table.textContent, /Nov 22 · PDF ends/);
	assert.match(table.textContent, /109\.2/);
	assert.match(table.querySelector("thead").textContent, /USD/);
});

test("a 12-item pie draws seven slices, Other last, and its table keeps all twelve", async () => {
	const data = Array.from({ length: 12 }, (_, i) => [
		`Plan ${i + 1}`,
		40 - i * 3,
	]);
	const container = await mount({ type: "pie", title: "Seats", data });
	const slices = svgOf(container).querySelectorAll("path[d]");
	assert.equal(slices.length, 7);
	assert.match(slices[6].getAttribute("class"), /text-ink-dim/);
	assert.match(slices[0].getAttribute("class"), /text-chart-1/);
	assert.match(slices[1].getAttribute("class"), /text-chart-2/);
	assert.match(svgOf(container).textContent, /Other \(6\)/);
	const described = document.getElementById(
		tabStops(container)[0].getAttribute("aria-describedby"),
	);
	assert.equal(described.querySelectorAll("tbody tr").length, 12);
	// The donut's SVG is the 200px ring plus 24 of label room at 760.
	assert.equal(svgOf(container).getAttribute("height"), "224");
	// Keyboard reaches the folded slice; its readout lists folded items.
	const root = tabStops(container)[0];
	await act(async () => root.focus());
	await press(root, "End");
	assert.match(liveText(container), /^Other \(6\)/);
	assert.match(
		container.querySelector("[data-lo-chart-tooltip]").textContent,
		/Plan 7/,
	);
});

test("heatmap: null cells hatch and read No data; arrows walk columns and rows", async () => {
	const container = await mount({
		type: "heatmap",
		title: "Requests by shift",
		unit: "requests",
		columns: ["Early", "Late"],
		rowLabels: ["Mon", "Tue"],
		rows: [
			[18, 50],
			[12, null],
		],
	});
	const cells = svgOf(container).querySelectorAll("rect");
	assert.equal(cells.length, 4);
	assert.match(cells[3].getAttribute("fill"), /^url\(#/);
	const root = tabStops(container)[0];
	await act(async () => root.focus());
	await press(root, "ArrowRight");
	await press(root, "ArrowDown");
	assert.equal(liveText(container), "Tue, Late, No data, 4 of 4");
});

test("the mounted axis never repeats a compact tick label", async () => {
	const container = await mount({
		type: "line",
		title: "Tight",
		data: [
			["a", 10_050],
			["b", 10_180],
			["c", 10_300],
		],
	});
	const ticks = [
		...svgOf(container).querySelectorAll("text[dominant-baseline]"),
	].map((node) => node.textContent);
	assert.ok(ticks.length >= 4, String(ticks));
	assert.equal(new Set(ticks).size, ticks.length, String(ticks));
});

// ---- round-1 remediation: mounted regressions --------------------------------

/* The drawn x labels as boxes, measured with the renderer's OWN `textWidth`
   (here, in jsdom, its 6.6px/char path, exactly what the planner used). */
const xLabelBoxes = (container) =>
	[...svgOf(container).querySelectorAll("text[data-lo-chart-xlabel]")].map(
		(node) => {
			const width = chart.textWidth(node.textContent, "");
			const [left, right] = chart.labelBox(
				Number(node.getAttribute("x")),
				width,
				node.getAttribute("text-anchor"),
			);
			return {
				category: Number(node.getAttribute("data-lo-chart-xlabel")),
				text: node.textContent,
				left,
				right,
			};
		},
	);
const assertDisjoint = (boxes, width, where) => {
	for (const box of boxes)
		assert.ok(
			box.left >= -1e-9 && box.right <= width + 1e-9,
			`${where}: ${box.text} leaves the chart`,
		);
	for (let i = 1; i < boxes.length; i++)
		assert.ok(
			boxes[i - 1].right + 4 <= boxes[i].left + 1e-9,
			`${where}: "${boxes[i - 1].text}" [${boxes[i - 1].left}, ${boxes[i - 1].right}] and "${boxes[i].text}" [${boxes[i].left}, ${boxes[i].right}] overlap`,
		);
};

test("x labels: long and timestamp labels never overlap at 360 or 760 (QA Q1, review R2)", async () => {
	const cases = {
		weeks: Array.from(
			{ length: 8 },
			(_, i) => `Week ${i + 1} of the quarterly reporting period`,
		),
		weeks32: Array.from(
			{ length: 32 },
			(_, i) => `Week ${i + 1} of the quarterly reporting period`,
		),
		stamps: [
			"2025-11-16 14:00 UTC",
			"2025-11-17 14:00 UTC",
			"2025-11-18 14:00 UTC",
		],
		stamps32: Array.from(
			{ length: 32 },
			(_, i) => `2025-11-${String((i % 30) + 1).padStart(2, "0")} 14:00 UTC`,
		),
		iso32: Array.from(
			{ length: 32 },
			(_, i) => `2026-11-${String((i % 30) + 1).padStart(2, "0")}`,
		),
		q4: Array.from({ length: 14 }, (_, i) => `Week ${i + 1} of Q4`),
	};
	for (const [name, labels] of Object.entries(cases))
		for (const width of [360, 760])
			for (const type of ["line", "bar"]) {
				if (type === "bar" && labels.length > 6) continue; // those go horizontal
				const container = await mount(
					{
						type,
						title: name,
						data: labels.map((label, i) => [label, 10 + (i % 5)]),
					},
					width,
				);
				if (container.querySelector("[data-lo-chart-kind=horizontal]"))
					continue;
				const boxes = xLabelBoxes(container);
				const where = `${name} ${type} @${width}`;
				assert.equal(boxes[0].category, 0, `${where}: first shown`);
				assert.equal(
					boxes.at(-1).category,
					labels.length - 1,
					`${where}: last shown`,
				);
				assertDisjoint(boxes, width, where);
			}
});

test("label widths come from a real canvas measureText once mounted", async () => {
	const calls = [];
	const fake = {
		font: "",
		measureText(text) {
			calls.push([this.font, text]);
			return { width: Array.from(text).length * 12 };
		},
	};
	const original = window.HTMLCanvasElement.prototype.getContext;
	window.HTMLCanvasElement.prototype.getContext = () => fake;
	chart.resetTextMeasurer();
	try {
		const labels = Array.from(
			{ length: 12 },
			(_, i) => `Label ${String(i + 1).padStart(2, "0")}`,
		);
		const container = await mount(
			{
				type: "line",
				title: "Measured",
				data: labels.map((label, i) => [label, i]),
			},
			360,
		);
		assert.ok(
			calls.some(([, text]) => text === "Label 01"),
			"axis labels went through measureText",
		);
		assert.ok(
			calls.every(([font]) => font.startsWith("12px ")),
			"measured at the 12px meta step",
		);
		// At 12px/char the shown boxes are disjoint; with the 6.6px estimate the
		// planner would have packed in more labels than fit, so this discriminates.
		const boxes = [
			...svgOf(container).querySelectorAll("text[data-lo-chart-xlabel]"),
		].map((node) => {
			const [left, right] = chart.labelBox(
				Number(node.getAttribute("x")),
				Array.from(node.textContent).length * 12,
				node.getAttribute("text-anchor"),
			);
			return { text: node.textContent, left, right };
		});
		assertDisjoint(boxes, 360, "canvas-measured");
	} finally {
		window.HTMLCanvasElement.prototype.getContext = original;
		chart.resetTextMeasurer();
	}
});

test("tooltip placement: clamped inside the plot; the donut's sits beside the ring", () => {
	// QA Q3: flipped below a stacked segment it used to run 48px past the plot.
	const flipped = chart.placeTooltip({
		anchor: { x: 300, y: 20, below: 200 },
		w: 140,
		h: 112,
		width: 760,
		bottom: 252,
	});
	assert.ok(
		flipped.top >= 0 && flipped.top + 112 <= 252,
		JSON.stringify(flipped),
	);
	const tall = chart.placeTooltip({
		anchor: { x: 10, y: 5 },
		w: 140,
		h: 300,
		width: 760,
		bottom: 252,
	});
	assert.equal(tall.top, 0);
	assert.equal(tall.left, 4);
	// Design D1: never inside the outer radius, on the slice's own side.
	const ring = { left: 280, right: 480 };
	const right = chart.placeTooltip({
		anchor: { x: 400, y: 12, beside: { ...ring, side: 1 } },
		w: 150,
		h: 180,
		width: 760,
		bottom: 224,
	});
	assert.equal(right.left, 488);
	assert.equal(right.top, 0);
	const left = chart.placeTooltip({
		anchor: { x: 300, y: 200, beside: { ...ring, side: -1 } },
		w: 150,
		h: 60,
		width: 760,
		bottom: 224,
	});
	assert.equal(left.left + 150, 272);
	assert.equal(left.top, 224 - 60);
	// No room on the slice's side: the other side, still off the ring.
	const swapped = chart.placeTooltip({
		anchor: { x: 360, y: 100, beside: { left: 170, right: 370, side: 1 } },
		w: 150,
		h: 60,
		width: 440,
		bottom: 224,
	});
	assert.equal(swapped.left + 150, 162);
	assert.deepEqual(chart.besideRoom({ left: 160, right: 360, side: 1 }, 520), {
		left: 148,
		right: 148,
	});
});

/* jsdom lays nothing out; give the tooltip a real size so placement runs. */
const withTooltipSize = async (w, h, body) => {
	const proto = window.HTMLElement.prototype;
	const saved = ["offsetWidth", "offsetHeight"].map((key) => [
		key,
		Object.getOwnPropertyDescriptor(proto, key),
	]);
	for (const [key, size] of [
		["offsetWidth", w],
		["offsetHeight", h],
	])
		Object.defineProperty(proto, key, {
			configurable: true,
			get() {
				return this.hasAttribute?.("data-lo-chart-tooltip") ? size : 0;
			},
		});
	try {
		return await body();
	} finally {
		for (const [key, descriptor] of saved)
			if (descriptor) Object.defineProperty(proto, key, descriptor);
			else delete proto[key];
	}
};

const CASH = {
	type: "series",
	title: "Monthly cash movements",
	mode: "stacked",
	unit: "USD thousands",
	labels: ["January", "February", "March", "April"],
	series: [
		{ label: "Receipts", values: [50, 60, 70, 65] },
		{ label: "Refunds", values: [-12, -9, -18, -11] },
	],
};

test("stacked: a negative segment's tooltip stays in the plot; mixed signs drop the share", async () => {
	await withTooltipSize(140, 112, async () => {
		const container = await mount(CASH);
		const root = tabStops(container)[0];
		await act(async () => root.focus());
		await press(root, "ArrowRight");
		await press(root, "ArrowRight");
		await press(root, "ArrowDown");
		assert.match(
			liveText(container),
			/^March, Refunds, -18 USD thousands, 3 of 4$/,
		);
		const tooltip = container.querySelector("[data-lo-chart-tooltip]");
		const plotBottom = Number(svgOf(container).getAttribute("height")) - 24;
		const top = Number.parseFloat(tooltip.style.top);
		assert.ok(
			top >= 0 && top + 112 <= plotBottom,
			`top ${top}, plot bottom ${plotBottom}`,
		);
		// D2/X6: 70 and -18 mix signs, so no "of total" beside the net Total.
		assert.doesNotMatch(tooltip.textContent, /of total/);
		assert.match(tooltip.textContent, /Total.*52 USD thousands/);
	});
	// All one sign: the share stays.
	const positive = await mount({
		...CASH,
		series: [CASH.series[0], { label: "Fees", values: [5, 6, 7, 8] }],
	});
	const root = tabStops(positive)[0];
	await act(async () => root.focus());
	assert.match(
		positive.querySelector("[data-lo-chart-tooltip]").textContent,
		/of total/,
	);
});

const PLANS = {
	type: "pie",
	title: "Seats",
	unit: "seats",
	data: Array.from({ length: 12 }, (_, i) => [`Plan ${i + 1}`, 40 - i * 3]),
};

test("wide donut: the tooltip sits beside the ring, never inside its outer radius (D1)", async () => {
	await withTooltipSize(150, 120, async () => {
		const container = await mount(PLANS, 760);
		const root = tabStops(container)[0];
		await act(async () => root.focus());
		const cx = 380;
		const outer = 100;
		for (let slice = 0; slice < 7; slice++) {
			const tooltip = container.querySelector("[data-lo-chart-tooltip]");
			const left = Number.parseFloat(tooltip.style.left);
			const top = Number.parseFloat(tooltip.style.top);
			assert.ok(
				left >= cx + outer + 8 || left + 150 <= cx - outer - 8,
				`slice ${slice}: left ${left}`,
			);
			assert.ok(top >= 0 && top + 120 <= 224, `slice ${slice}: top ${top}`);
			await press(root, "ArrowRight");
		}
	});
});

/* jsdom has no PointerEvent: a MouseEvent of the pointer type carrying the
   pointer fields React reads. */
const pointer = (
	target,
	type,
	{ x = 0, y = 0, pointerType = "touch", id = 1 } = {},
) =>
	act(async () => {
		const event = new window.MouseEvent(type, {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
		});
		Object.defineProperty(event, "pointerType", { value: pointerType });
		Object.defineProperty(event, "pointerId", { value: id });
		target.dispatchEvent(event);
	});
const opacities = (container) =>
	[...svgOf(container).querySelectorAll("path[d]")].map((node) =>
		node.getAttribute("opacity"),
	);

test("touch: tap decided on pointer-up within the slop; cancel and outside taps clear (X7, U1)", async () => {
	const container = await mount(PLANS, 760);
	const slices = svgOf(container).querySelectorAll("path[d]");
	const undimmed = () => opacities(container).every((value) => value === "1");
	// pointerdown alone pins nothing: a scroll may be starting.
	await pointer(slices[1], "pointerdown", { x: 10, y: 10 });
	assert.ok(undimmed(), "nothing active on pointerdown");
	await pointer(slices[1], "pointerup", { x: 13, y: 14 });
	assert.equal(opacities(container)[0], "0.35");
	assert.equal(opacities(container)[1], "1");
	assert.match(liveText(container), /^Plan 2/);
	// Touch on the wide donut: the centre readout is the tooltip (R4).
	assert.equal(container.querySelector("[data-lo-chart-tooltip]"), null);
	// Tapping the same slice dismisses.
	await pointer(slices[1], "pointerdown", { x: 10, y: 10 });
	await pointer(slices[1], "pointerup", { x: 10, y: 10 });
	assert.ok(undimmed(), "same-slice tap dismisses");
	// A drag past the slop is not a tap.
	await pointer(slices[2], "pointerdown", { x: 10, y: 10 });
	await pointer(slices[2], "pointermove", {
		x: 10,
		y: 10 + chart.TAP_SLOP + 12,
	});
	await pointer(slices[2], "pointerup", { x: 10, y: 30 });
	assert.ok(undimmed(), "a drag does not pin");
	// The browser taking over for a scroll clears a pinned mark and its dimming.
	await pointer(slices[2], "pointerdown");
	await pointer(slices[2], "pointerup");
	assert.equal(opacities(container)[0], "0.35");
	await pointer(slices[3], "pointerdown");
	await pointer(slices[3], "pointermove", { y: 40 });
	await pointer(slices[3], "pointercancel", { y: 40 });
	assert.ok(undimmed(), "pointercancel clears pinned state");
	assert.equal(liveText(container), "");
	// Tapping outside the chart dismisses.
	await pointer(slices[2], "pointerdown");
	await pointer(slices[2], "pointerup");
	assert.equal(opacities(container)[0], "0.35");
	await pointer(document.body, "pointerdown");
	assert.ok(undimmed(), "outside tap dismisses");
	// A mouse still hovers immediately.
	await pointer(slices[4], "pointermove", { pointerType: "mouse" });
	assert.equal(opacities(container)[0], "0.35");
});

test("touch on a line: a still tap pins; a horizontal drag scrubs", async () => {
	const container = await mount(SPEND, 760);
	const svg = svgOf(container);
	const dots = [...svg.querySelectorAll("circle")].map((node) =>
		Number(node.getAttribute("cx")),
	);
	await pointer(svg, "pointerdown", { x: dots[2], y: 100 });
	assert.equal(liveText(container), "");
	await pointer(svg, "pointerup", { x: dots[2] + 3, y: 102 });
	assert.match(liveText(container), /^Nov 18,/);
	await pointer(svg, "pointerdown", { x: dots[4], y: 100 });
	await pointer(svg, "pointermove", { x: dots[6], y: 101 });
	assert.match(liveText(container), /^Nov 22 · PDF ends,/);
	await pointer(svg, "pointerup", { x: dots[6], y: 101 });
	assert.match(
		liveText(container),
		/^Nov 22 · PDF ends,/,
		"a scrub leaves its last mark pinned",
	);
	await pointer(svg, "pointercancel");
	assert.equal(liveText(container), "");
});

test("RTL locales: chart root and SVG stay LTR, so anchors and geometry do not flip (X8)", async () => {
	document.documentElement.setAttribute("dir", "rtl");
	try {
		for (const value of [SPEND, PLANS, CASH]) {
			const container = await mount(value, 760);
			container.setAttribute("dir", "rtl");
			const root = tabStops(container)[0];
			assert.equal(root.getAttribute("dir"), "ltr");
			assert.equal(root.style.direction, "ltr");
			assert.equal(svgOf(container).getAttribute("direction"), "ltr");
		}
		const line = await mount(SPEND, 360);
		const boxes = xLabelBoxes(line);
		assert.equal(
			svgOf(line)
				.querySelector('text[data-lo-chart-xlabel="0"]')
				.getAttribute("text-anchor"),
			"start",
		);
		assert.ok(boxes[0].left < boxes.at(-1).left, "first label on the left");
	} finally {
		document.documentElement.removeAttribute("dir");
	}
});

test("pie shares: whole percent everywhere, <1% under half a percent (X9)", async () => {
	const value = {
		type: "pie",
		title: "Share",
		data: [
			["Big", 6_180],
			["Middle", 3_790],
			["Tiny", 20],
			["Speck", 10],
		],
	};
	const wide = await mount(value, 760);
	const text = svgOf(wide).textContent;
	assert.match(text, /Big 62%/);
	assert.match(text, /Middle 38%/);
	const also = wide.querySelector("p").textContent;
	assert.match(also, /Tiny <1%/);
	assert.match(also, /Speck <1%/);
	const root = tabStops(wide)[0];
	await act(async () => root.focus());
	await press(root, "End");
	assert.match(liveText(wide), /^Speck, 10, <1% of total, 4 of 4$/);
	assert.match(
		wide.querySelector("[data-lo-chart-tooltip]").textContent,
		/<1% of total/,
	);
	const narrow = await mount(value, 360);
	const legend = [...narrow.querySelectorAll("li")].map(
		(node) => node.textContent,
	);
	assert.deepEqual(legend, ["Big62%", "Middle38%", "Tiny<1%", "Speck<1%"]);
	// The exact-values table keeps one decimal.
	const described = document.getElementById(
		tabStops(narrow)[0].getAttribute("aria-describedby"),
	);
	assert.match(described.textContent, /61\.8%/);
});

test("narrow donut in-ring ink follows a theme switch that lands with the first measurement (QA Q2)", async () => {
	// Golden vectors (spec section 4) per data-theme, served as computed custom props.
	const palettes = {
		dark: [
			"#38C96A",
			"#92C1FD",
			"#17B6A8",
			"#DCBC33",
			"#AD87ED",
			"#FF96D3",
			"#E18528",
		],
		light: [
			"#137742",
			"#1762B6",
			"#059488",
			"#9B3876",
			"#977E0D",
			"#915006",
			"#8F68CB",
		],
	};
	const real = globalThis.getComputedStyle;
	globalThis.getComputedStyle = (node) => {
		const style = real(node);
		return new Proxy(style, {
			get(target, property) {
				if (property === "getPropertyValue")
					return (name) => {
						const slot = /^--color-chart-(\d)$/.exec(name);
						const theme =
							document.documentElement.getAttribute("data-theme") ?? "dark";
						return slot
							? palettes[theme][Number(slot[1]) - 1]
							: target.getPropertyValue(name);
					};
				const member = target[property];
				return typeof member === "function" ? member.bind(target) : member;
			},
		});
	};
	document.documentElement.setAttribute("data-theme", "dark");
	/* The provider's switch lands in a passive effect of the SAME commit that
	   first enables the colour read (a sibling before the chart, so it runs
	   before any effect the chart attaches in that commit). */
	const { useEffect, useLayoutEffect, useState } = chart;
	const value = {
		type: "pie",
		title: "Accounts",
		unit: "accounts",
		data: [
			["Team", 42],
			["Individual", 28],
			["Org", 18],
			["Edu", 12],
		],
	};
	function Setter({ ready }) {
		useEffect(() => {
			if (ready) document.documentElement.setAttribute("data-theme", "light");
		}, [ready]);
		return null;
	}
	function Harness() {
		const [ready, setReady] = useState(false);
		useLayoutEffect(() => setReady(true), []);
		return [
			h(Setter, { key: "setter", ready }),
			h(InlineUiHost, { key: "chart", value }),
		];
	}
	try {
		const container = document.createElement("div");
		container.setAttribute("data-width", "360");
		document.body.append(container);
		const root = createRoot(container);
		await act(async () => root.render(h(Harness)));
		mounted.push(root);
		await act(async () => {}); // deliver the MutationObserver record
		assert.equal(document.documentElement.getAttribute("data-theme"), "light");
		const ring = svgOf(container).querySelector("text[fill]");
		assert.equal(ring.textContent, "42%");
		// #137742 (light accent): white 5.61:1, black 3.75:1, so white.
		assert.equal(ring.getAttribute("fill"), "#fff");
	} finally {
		globalThis.getComputedStyle = real;
		document.documentElement.removeAttribute("data-theme");
	}
});

test("heatmap floor: a 0 cell is visibly off every ground in the reference themes (D3, X10)", () => {
	assert.equal(chart.HEAT_FLOOR, 28);
	assert.match(chart.heatFill(0), /var\(--color-accent\) 28%/);
	assert.match(chart.heatFill(1), /var\(--color-accent\) 100%/);
	assert.match(chart.heatFill(0.5), /var\(--color-accent\) 64%/);
});

test("tiny values render without duplicate tick keys (R6, X11)", async () => {
	const errors = [];
	const original = console.error;
	console.error = (...args) => errors.push(args.join(" "));
	try {
		const container = await mount({
			type: "line",
			title: "Tiny",
			data: [
				["a", 1e-300],
				["b", 2e-300],
			],
		});
		assert.ok(svgOf(container));
		await mount({
			type: "scatter",
			title: "Tiny",
			xLabel: "x",
			yLabel: "y",
			data: [
				[1e-300, 1e-300],
				[2e-300, 3e-300],
			],
		});
	} finally {
		console.error = original;
	}
	assert.deepEqual(
		errors.filter((line) => /same key/i.test(line)),
		[],
	);
});
