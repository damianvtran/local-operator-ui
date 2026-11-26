/**
 * Pure geometry for inline charts: sizes, nice ticks, label thinning, pie
 * folding and label relaxation.
 *
 * WHY A SEPARATE MODULE. The same rules ship on three surfaces (this desktop
 * renderer, relay web and React Native) from one design spec ("Inline charts -
 * design spec", sections 1-3), and every rule here is a number the spec pins:
 * the plot height formula, the {1, 2, 2.5, 5} x 10^k tick steps, the zero rule,
 * the label stride, the seven-slice pie fold. Keeping them free of React and the
 * DOM lets `scripts/inline-chart.test.mjs` pin them directly, so a renderer
 * refactor cannot drift a tick or a stride without a failing test.
 *
 * Nothing here formats for display; callers own `Intl` and i18n.
 */

/** Below this content width a chart uses its narrow layout (spec section 1). */
export const NARROW_WIDTH = 520;

/** Plot margins around the area inside the axes (spec section 1). */
export const PLOT_MARGIN = { top: 12, right: 12, bottom: 24, minLeft: 28 };

/** Horizontal bars: 16px bar plus a 12px gap per category. */
export const HORIZONTAL_ROW = 28;

/**
 * Cartesian plot height: `clamp(180, round(W x 0.34), 240)` - 240 at 760,
 * 180 at 360. The operator's report was a chart drawn into a fixed 320x128
 * viewBox and stretched flat; this ties height to the real width instead.
 */
export function plotHeight(width: number): number {
	return Math.min(240, Math.max(180, Math.round(width * 0.34)));
}

/** Donut outer diameter: 200 wide; `min(180, W - 32)` narrow (spec section 3). */
export function donutDiameter(width: number): number {
	return width >= NARROW_WIDTH ? 200 : Math.max(0, Math.min(180, width - 32));
}

/** Heatmap row height: 28 wide, 24 narrow (spec section 1). */
export function heatmapRowHeight(width: number): number {
	return width >= NARROW_WIDTH ? 28 : 24;
}

export type Ticks = {
	ticks: number[];
	min: number;
	max: number;
	step: number;
	decimals: number;
};

/**
 * How a domain treats zero. `always`: bars, histogram, grouped, stacked and
 * horizontal bars, whose length encodes the value. `near`: line and scatter,
 * which include 0 only when it lies within a third of the data's range of the
 * data - so the operator's 84-154 spend series is not squashed against a 0
 * baseline (it fits 80-160 instead).
 */
export type ZeroRule = "always" | "near";

const MULTIPLIERS = [1, 2, 2.5, 5];
// Floor/ceil on a quotient like 0.3 / 0.1 lands a hair off a whole number.
const EPSILON = 1e-9;

/** Target tick count `clamp(3, floor(plotHeight / 48), 6)`. */
export function tickTarget(height: number): number {
	return Math.min(6, Math.max(3, Math.floor(height / 48)));
}

function decimalsOf(multiplier: number, exponent: number): number {
	return Math.max(0, -exponent + (multiplier === 2.5 ? 1 : 0));
}

function extent(values: number[], zero: ZeroRule): [number, number] {
	let min = Math.min(...values);
	let max = Math.max(...values);
	const range = max - min;
	if (
		zero === "always" ||
		(0 >= min - range / 3 && 0 <= max + range / 3 && range > 0) ||
		(range === 0 && min === 0)
	) {
		min = Math.min(0, min);
		max = Math.max(0, max);
	}
	if (min === max) {
		// Flat data: pad by 10% of the value, or 1 at zero (spec section 2).
		const pad = min === 0 ? 1 : Math.abs(min) * 0.1;
		return [min - pad, max + pad];
	}
	return [min, max];
}

function ticksFor(
	min: number,
	max: number,
	multiplier: number,
	exponent: number,
	count?: number,
): Ticks {
	const step = multiplier * 10 ** exponent;
	const decimals = decimalsOf(multiplier, exponent);
	const low = Math.floor(min / step + EPSILON);
	const high =
		count === undefined ? Math.ceil(max / step - EPSILON) : low + count - 1;
	const ticks: number[] = [];
	for (let index = low; index <= high; index++)
		ticks.push(Number((index * step).toFixed(Math.min(20, decimals))));
	return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step, decimals };
}

function* candidateSteps(span: number): Generator<[number, number]> {
	// Start one decade below the span's own so the smallest qualifying step is
	// always reached; the caller stops at the first that fits.
	let exponent = Math.floor(Math.log10(span || 1)) - 2;
	for (;;) {
		for (const multiplier of MULTIPLIERS) yield [multiplier, exponent];
		exponent++;
	}
}

/**
 * Nice ticks: the smallest step of `{1, 2, 2.5, 5} x 10^k` yielding at most
 * `target + 1` ticks, with the domain extended outward to whole steps.
 */
export function niceTicks(
	values: number[],
	height: number,
	zero: ZeroRule,
): Ticks {
	const [min, max] = extent(values, zero);
	const limit = tickTarget(height) + 1;
	for (const [multiplier, exponent] of candidateSteps(max - min)) {
		const result = ticksFor(min, max, multiplier, exponent);
		if (result.ticks.length <= limit) return result;
	}
	/* c8 ignore next */
	throw new Error("unreachable");
}

/**
 * A second axis with a FIXED tick count, so a dual chart's right ticks land on
 * the gridlines drawn from the left axis (spec section 2, "Dual axis").
 */
export function fixedCountTicks(
	values: number[],
	count: number,
	zero: ZeroRule,
): Ticks {
	const [min, max] = extent(values, zero);
	const intervals = Math.max(1, count - 1);
	for (const [multiplier, exponent] of candidateSteps(
		(max - min) / intervals,
	)) {
		const result = ticksFor(min, max, multiplier, exponent, count);
		if (result.max >= max - EPSILON * Math.abs(max)) return result;
	}
	/* c8 ignore next */
	throw new Error("unreachable");
}

/** Percent mode: fixed 0/25/50/75/100 regardless of height. */
export const PERCENT_TICKS: Ticks = {
	ticks: [0, 25, 50, 75, 100],
	min: 0,
	max: 100,
	step: 25,
	decimals: 0,
};

/** Ticks use compact notation once the domain reaches 10 000 (`12K`). */
export function compactTicks(ticks: Ticks): boolean {
	return Math.max(Math.abs(ticks.min), Math.abs(ticks.max)) >= 10_000;
}

/** Map a value into a pixel position inside [top, bottom] for a domain. */
export function project(
	ticks: Pick<Ticks, "min" | "max">,
	top: number,
	bottom: number,
) {
	const span = ticks.max - ticks.min || 1;
	return (value: number) =>
		bottom - ((value - ticks.min) / span) * (bottom - top);
}

/** Pixel-snap a 1px horizontal rule so it paints one device row, not two. */
export const snap = (y: number) => Math.round(y) + 0.5;

/**
 * The axis half of an annotated label: `Nov 24 · rollout` shows `Nov 24` on the
 * axis; the full label stays in the tooltip and the data table.
 */
export function axisText(label: string): string {
	const cut = label.indexOf(" · ");
	return cut < 0 ? label : label.slice(0, cut);
}

const TIGHT_UNIT = /^(%|‰|°[CF]?)$/;
const FLAT_HEX = /^#[0-9a-f]{6}$/i;

/** Value + unit: no space before `%`, `‰`, `°`, `°C`, `°F`; one space otherwise. */
export function withUnit(value: string, unit?: string): string {
	if (!unit) return value;
	return TIGHT_UNIT.test(unit) ? `${value}${unit}` : `${value} ${unit}`;
}

export type LabelPlan = {
	/** Category indices whose label is drawn, ascending. */
	shown: number[];
	stride: number;
	/** Longest a drawn label may be before it truncates with an ellipsis. */
	maxWidth: number;
};

/**
 * X-label thinning (spec section 2): stride `k = ceil((maxLabelW + 12) / slotW)`,
 * show `0, k, 2k...` and always the last; when the last would collide with the
 * previous shown label, the previous one goes (never the first). Labels never
 * rotate; a shown label wider than `k x slotW - 8` truncates.
 */
export function thinLabels(widths: number[], slotWidth: number): LabelPlan {
	const count = widths.length;
	if (count === 0) return { shown: [], stride: 1, maxWidth: 0 };
	const widest = Math.max(...widths);
	const stride = Math.max(1, Math.ceil((widest + 12) / Math.max(1, slotWidth)));
	const shown: number[] = [];
	for (let index = 0; index < count; index += stride) shown.push(index);
	const last = count - 1;
	if (shown[shown.length - 1] !== last) {
		const previous = shown[shown.length - 1];
		if (previous !== 0 && last - previous < stride) shown.pop();
		shown.push(last);
	}
	return { shown, stride, maxWidth: Math.max(0, stride * slotWidth - 8) };
}

/** Truncate `text` with an ellipsis until `measure` fits `maxWidth`. */
export function truncateToWidth(
	text: string,
	maxWidth: number,
	measure: (value: string) => number,
): string {
	if (measure(text) <= maxWidth) return text;
	const chars = Array.from(text);
	for (let length = chars.length - 1; length > 0; length--) {
		const candidate = `${chars.slice(0, length).join("").trimEnd()}…`;
		if (measure(candidate) <= maxWidth) return candidate;
	}
	return "…";
}

/**
 * Bars run horizontal when there are many categories or long labels: `n > 12`,
 * the longest label over 12 characters, or narrow (`W < 520`) with `n > 6`.
 */
export function barsHorizontal(labels: string[], width: number): boolean {
	const longest = Math.max(...labels.map((label) => Array.from(label).length));
	return (
		labels.length > 12 ||
		longest > 12 ||
		(width < NARROW_WIDTH && labels.length > 6)
	);
}

export type PieSlice = {
	label: string;
	amount: number;
	share: number;
	/** 0-based colour slot; `null` for the folded "Other" slice (ink-dim). */
	slot: number | null;
	/** Rows folded into "Other", largest first. */
	folded?: [string, number][];
	/** Clockwise from 12 o'clock, radians. */
	start: number;
	end: number;
};

/** More slices than this fold the tail into "Other (k)" (spec section 3). */
export const PIE_MAX_SLICES = 7;
const PIE_KEEP = 6;

/**
 * Sort descending, fold the tail into one "Other" slice when there are more than
 * seven, and lay the slices clockwise from 12 o'clock. Shares are computed on
 * values normalised by the largest, so a sum of near-MAX_SAFE inputs stays finite.
 */
export function pieSlices(
	data: [string, number][],
	otherLabel: (count: number) => string,
): PieSlice[] {
	const sorted = Array.from(data.entries())
		.sort(([a, [, x]], [b, [, y]]) => y - x || a - b)
		.map(([, row]) => row);
	const peak = Math.max(...sorted.map(([, amount]) => amount)) || 1;
	const total = sorted.reduce((sum, [, amount]) => sum + amount / peak, 0);
	const kept: Omit<PieSlice, "start" | "end">[] =
		sorted.length > PIE_MAX_SLICES
			? [
					...sorted.slice(0, PIE_KEEP).map(([label, amount], slot) => ({
						label,
						amount,
						share: amount / peak / total,
						slot,
					})),
					(() => {
						const folded = sorted.slice(PIE_KEEP);
						const weight = folded.reduce(
							(sum, [, amount]) => sum + amount / peak,
							0,
						);
						return {
							label: otherLabel(folded.length),
							amount: folded.reduce((sum, [, amount]) => sum + amount, 0),
							share: weight / total,
							slot: null,
							folded,
						};
					})(),
				]
			: sorted.map(([label, amount], slot) => ({
					label,
					amount,
					share: amount / peak / total,
					slot,
				}));
	let cursor = 0;
	return kept.map((slice, index) => {
		const start = cursor;
		const end =
			index === kept.length - 1
				? Math.PI * 2
				: start + slice.share * Math.PI * 2;
		cursor = end;
		return { ...slice, start, end };
	});
}

/**
 * SVG path data from command tuples (`["M", x, y]`): machine syntax, built
 * from tokens rather than templates so it never reads as display copy.
 */
export function svgPath(...commands: (string | number)[][]): string {
	return commands.map((command) => command.join(" ")).join(" ");
}

/** Point on a circle, angle clockwise from 12 o'clock. */
export function polar(cx: number, cy: number, radius: number, angle: number) {
	return { x: cx + radius * Math.sin(angle), y: cy - radius * Math.cos(angle) };
}

/**
 * One donut slice as a path, with a constant 1.5px gap to its neighbours made
 * in GEOMETRY: a stroke of the ground colour would paint an opaque seam over
 * window glass. Each edge moves 0.75px along the ring at both radii, so the gap
 * keeps its width from the inner to the outer edge.
 */
export function donutSlicePath(
	cx: number,
	cy: number,
	inner: number,
	outer: number,
	start: number,
	end: number,
	gap = 1.5,
): string {
	if (end - start >= Math.PI * 2 - 1e-9) {
		// A whole ring: two half arcs per edge, opposite winding for the hole.
		const o1 = polar(cx, cy, outer, 0);
		const o2 = polar(cx, cy, outer, Math.PI);
		const i1 = polar(cx, cy, inner, 0);
		const i2 = polar(cx, cy, inner, Math.PI);
		return svgPath(
			["M", o1.x, o1.y],
			["A", outer, outer, 0, 1, 1, o2.x, o2.y],
			["A", outer, outer, 0, 1, 1, o1.x, o1.y, "Z"],
			["M", i1.x, i1.y],
			["A", inner, inner, 0, 1, 0, i2.x, i2.y],
			["A", inner, inner, 0, 1, 0, i1.x, i1.y, "Z"],
		);
	}
	const half = gap / 2;
	const outerPad = Math.min(half / outer, (end - start) / 2);
	const innerPad = Math.min(half / Math.max(1, inner), (end - start) / 2);
	const a0 = polar(cx, cy, outer, start + outerPad);
	const a1 = polar(cx, cy, outer, end - outerPad);
	const b1 = polar(cx, cy, inner, end - innerPad);
	const b0 = polar(cx, cy, inner, start + innerPad);
	const large = end - start > Math.PI ? 1 : 0;
	return svgPath(
		["M", a0.x, a0.y],
		["A", outer, outer, 0, large, 1, a1.x, a1.y],
		["L", b1.x, b1.y],
		["A", inner, inner, 0, large, 0, b0.x, b0.y, "Z"],
	);
}

/**
 * Relax label centres (sorted top to bottom) so neighbours are at least `gap`
 * apart and all stay inside [top, bottom]. A forward pass pushes down, a
 * backward pass pulls back up from the bottom bound; with enough room this
 * converges to the minimal displacement order-preserving layout.
 */
export function relaxLabels(
	ys: number[],
	gap: number,
	top: number,
	bottom: number,
): number[] {
	const out = [...ys];
	for (let index = 0; index < out.length; index++) {
		const floor = index === 0 ? top : out[index - 1] + gap;
		if (out[index] < floor) out[index] = floor;
	}
	for (let index = out.length - 1; index >= 0; index--) {
		const ceiling = index === out.length - 1 ? bottom : out[index + 1] - gap;
		if (out[index] > ceiling) out[index] = ceiling;
	}
	return out;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((index) => {
		const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The in-ring percent's ink on a narrow donut: black or white, whichever
 * contrasts more with the slice, and only when that reaches 4.5:1 - otherwise
 * `null` and the percent is omitted (spec section 3, "Narrow").
 */
export function inRingInk(fill: string): "#000" | "#fff" | null {
	if (!FLAT_HEX.test(fill)) return null;
	const l = luminance(fill);
	const black = (l + 0.05) / 0.05;
	const white = 1.05 / (l + 0.05);
	const best = Math.max(black, white);
	if (best < 4.5) return null;
	return black >= white ? "#000" : "#fff";
}
