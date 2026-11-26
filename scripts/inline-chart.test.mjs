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
	assert.equal(chart.tickTarget(180), 3);
	// Narrow: target 3, at most 4 ticks, still no 0.
	const narrow = chart.niceTicks(values, 180, "near");
	assert.ok(narrow.ticks.length <= 4, String(narrow.ticks));
	assert.ok(!narrow.ticks.includes(0));
	assert.ok(narrow.min <= 84.04 && narrow.max >= 153.66);
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

test("units: no space before %, ‰ and degrees, one space otherwise", () => {
	assert.equal(chart.withUnit("38.2", "%"), "38.2%");
	assert.equal(chart.withUnit("21", "°C"), "21°C");
	assert.equal(chart.withUnit("140.61", "USD"), "140.61 USD");
	assert.equal(chart.withUnit("7"), "7");
	assert.equal(chart.axisText("Nov 24 · rollout"), "Nov 24");
	assert.equal(chart.axisText("Nov 24"), "Nov 24");
});

test("label thinning: 32 labels at 360px never overlap and keep the first and last", () => {
	const labels = Array.from({ length: 32 }, (_, i) => `Day ${i + 1}`);
	const widths = labels.map((label) => label.length * 6.6);
	const plotWidth = 360 - 40 - 12;
	const slot = plotWidth / 31; // line: points on the plot edges
	const plan = chart.thinLabels(widths, slot);
	assert.equal(plan.shown[0], 0);
	assert.equal(plan.shown.at(-1), 31);
	// Boxes: first anchors start, last anchors end, the rest centre.
	const boxes = plan.shown.map((index, order) => {
		const x = index * slot;
		const w = Math.min(widths[index], plan.maxWidth);
		if (order === 0) return [x, x + w];
		if (index === 31) return [x - w, x];
		return [x - w / 2, x + w / 2];
	});
	for (let i = 1; i < boxes.length; i++)
		assert.ok(
			boxes[i][0] > boxes[i - 1][1],
			`labels ${i - 1} and ${i} overlap`,
		);
	// A stride that would land one short of the end drops the previous label.
	assert.deepEqual(chart.thinLabels([30, 30, 30, 30, 30], 21).shown, [0, 2, 4]);
	assert.deepEqual(chart.thinLabels([30, 30, 30, 30, 30], 15).shown, [0, 4]);
	assert.deepEqual(chart.thinLabels([10, 10, 10], 100).shown, [0, 1, 2]);
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

const svgOf = (container) => container.querySelector("svg[viewBox]");
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
