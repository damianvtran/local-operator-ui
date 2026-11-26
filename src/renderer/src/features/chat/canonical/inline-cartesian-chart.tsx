/**
 * Every chart with category and value axes: `bar` (vertical columns or
 * horizontal rows), `line`, `histogram` and `series` in all four modes.
 *
 * WHY ONE RENDERER. The operator reported axes that were "not proper" and a
 * scale that was "off": the old charts drew into a fixed 320x128 viewBox
 * stretched with `preserveAspectRatio="none"`, labelled only 0 or the ends,
 * and each type invented its own axis. This draws at the measured pixel size
 * with the spec's nice ticks, gridlines and thinned labels (inline chart spec
 * sections 1-2), and gives every type the same hover/keyboard readout
 * (section 5). The per-type differences are data: which zero rule, which
 * marks, how a pointer position maps to a mark.
 */
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type PointerEvent as ReactPointerEvent, useId, useMemo } from "react";
import {
	ChartData,
	ChartHeader,
	ChartRoot,
	ChartTooltip,
	DIM,
	DIM_TRANSITION,
	ENTER,
	LegendItem,
	LiveRegion,
	type Mark,
	SLOT_INK,
	type TooltipRow,
	textWidth,
	useActiveMark,
	useAnnounce,
	useChartNumbers,
	useMeasuredWidth,
	useMergedRef,
} from "./inline-chart-frame";
import {
	HORIZONTAL_ROW,
	PERCENT_TICKS,
	PLOT_MARGIN,
	type Ticks,
	axisText,
	barsHorizontal,
	fixedCountTicks,
	niceTicks,
	plotHeight,
	project,
	snap,
	svgPath,
	thinLabels,
	truncateToWidth,
	withUnit,
} from "./inline-chart-model";

export type CartesianSeries = {
	label: string;
	values: number[];
	axis?: "left" | "right";
};

export type CartesianInput = {
	type: "bar" | "line" | "histogram" | "series";
	mode?: "grouped" | "stacked" | "percent" | "dual";
	title: string;
	unit?: string;
	rightUnit?: string;
	labels: string[];
	series: CartesianSeries[];
};

type Kind = "line" | "bars" | "horizontal";

/** `Revenue (USD)`: the unit belongs in the column header, once. */
const withUnitHeader = (label: string, unit?: string) =>
	unit ? `${label} (${unit})` : label;

/* Bars: 30% of the slot is padding, a bar is never wider than 48, grouped bars
   sit 2px apart and stacked segments 1px apart (spec section 1). */
const BAND = 0.7;
const MAX_BAR = 48;
const GROUP_GAP = 2;
const STACK_GAP = 1;
const RADIUS = 3;
/* Histogram bins are contiguous intervals, so they keep a 1px seam rather than
   the 30% band padding that would make them read as separate categories
   (recorded under "Spec deviations" in the PR). */
const BIN_GAP = 1;

/** Shares of each category's positive total (percent mode), normalised by
 * the category's largest value so huge inputs cannot overflow the sum. */
function categoryShares(amounts: number[]) {
	const peak = Math.max(...amounts) || 1;
	const scaled = amounts.map((amount) => amount / peak);
	const total = scaled.reduce((sum, n) => sum + n, 0) || 1;
	return scaled.map((amount) => amount / total);
}

/**
 * A bar with its two value-end corners rounded. `base` is the zero side,
 * `tip` the value side; either order on screen.
 */
function barPath(
	x: number,
	width: number,
	base: number,
	tip: number,
	radius: number,
	horizontal = false,
): string {
	const length = Math.abs(tip - base);
	const r = Math.max(0, Math.min(radius, width / 2, length));
	if (horizontal) {
		// x axis is the value axis: base/tip are x positions, `x` is the top y.
		const dir = tip >= base ? 1 : -1;
		const y0 = x;
		const y1 = x + width;
		return svgPath(
			["M", base, y0],
			["H", tip - dir * r],
			["Q", tip, y0, tip, y0 + r],
			["V", y1 - r],
			["Q", tip, y1, tip - dir * r, y1],
			["H", base, "Z"],
		);
	}
	const dir = tip <= base ? -1 : 1;
	const x1 = x + width;
	return svgPath(
		["M", x, base],
		["V", tip - dir * r],
		["Q", x, tip, x + r, tip],
		["H", x1 - r],
		["Q", x1, tip, x1, tip - dir * r],
		["V", base, "Z"],
	);
}

type BarRect = {
	category: number;
	series: number;
	x: number;
	width: number;
	base: number;
	tip: number;
	/** Only the segment furthest from zero rounds its corners. */
	round: boolean;
};

export function InlineCartesianChart({ value }: { value: CartesianInput }) {
	const id = useId();
	const titleId = `${id}-title`; // i18n: ignore DOM id, never shown
	const dataId = `${id}-data`; // i18n: ignore DOM id, never shown
	const numbers = useChartNumbers();
	const announce = useAnnounce();
	const [measureRef, width, font] = useMeasuredWidth<HTMLDivElement>();
	const { labels, series, mode } = value;
	const percent = mode === "percent";
	const stacked = mode === "stacked";
	const dual = mode === "dual";
	const kind: Kind =
		value.type === "line" || dual
			? "line"
			: value.type === "bar" && width > 0 && barsHorizontal(labels, width)
				? "horizontal"
				: "bars";
	const marks = useActiveMark({
		categories: labels.length,
		series: series.length,
	});
	const active = marks.active;
	const rootRef = useMergedRef(measureRef, marks.rootRef);

	/* Values as plotted: percent mode plots each series' share of its
	   category's total, in percent. */
	const plotted = useMemo(() => {
		if (!percent) return series.map(({ values }) => values);
		const shares = labels.map((_, category) =>
			categoryShares(series.map(({ values }) => values[category])),
		);
		return series.map((_, index) =>
			labels.map((_, category) => shares[category][index] * 100),
		);
	}, [percent, series, labels]);

	const layout = useMemo(() => {
		if (width <= 0) return null;
		const height =
			kind === "horizontal"
				? labels.length * HORIZONTAL_ROW
				: plotHeight(width);
		const measure = (text: string) => textWidth(text, font);

		// ---- value domain(s) -------------------------------------------------
		const leftIndexes = series
			.map((entry, index) => ({ entry, index }))
			.filter(({ entry }) => !dual || entry.axis !== "right")
			.map(({ index }) => index);
		const rightIndexes = dual
			? series
					.map((entry, index) => ({ entry, index }))
					.filter(({ entry }) => entry.axis === "right")
					.map(({ index }) => index)
			: [];
		let ticks: Ticks;
		if (percent) ticks = PERCENT_TICKS;
		else if (stacked) {
			const ends = labels.flatMap((_, category) => {
				let positive = 0;
				let negative = 0;
				for (const values of plotted) {
					const n = values[category];
					if (n < 0) negative += n;
					else positive += n;
				}
				return [positive, negative];
			});
			ticks = niceTicks(ends, height, "always");
		} else if (kind === "line") {
			ticks = niceTicks(
				leftIndexes.flatMap((index) => plotted[index]),
				height,
				"near",
			);
		} else {
			/* Horizontal bars put the value axis across the width, where a tick
			   label is wider than tall: aim for one tick per ~96px of plot. */
			ticks = niceTicks(
				plotted.flat(),
				kind === "horizontal" ? Math.max(0, width - 120) / 2 : height,
				"always",
			);
		}
		const rightTicks = dual
			? fixedCountTicks(
					rightIndexes.flatMap((index) => plotted[index]),
					ticks.ticks.length,
					"near",
				)
			: null;
		// Percent mode ticks carry the sign: 0%, 25% ... 100% (spec section 2).
		const formatTick = percent ? numbers.percentTick : numbers.tick(ticks);
		const formatRight = rightTicks ? numbers.tick(rightTicks) : null;
		const tickLabels = ticks.ticks.map(formatTick);
		const rightLabels =
			rightTicks && formatRight ? rightTicks.ticks.map(formatRight) : [];

		// ---- margins -------------------------------------------------------
		let left: number;
		let categoryLabels: string[] = [];
		if (kind === "horizontal") {
			// The category column: as wide as the widest label, at most 40%.
			const cap = Math.max(48, Math.floor(width * 0.4));
			const widest = Math.max(...labels.map((l) => measure(axisText(l))));
			left = Math.min(cap, Math.ceil(widest)) + 8;
			categoryLabels = labels.map((label) =>
				truncateToWidth(axisText(label), left - 8, measure),
			);
		} else {
			left = Math.max(
				PLOT_MARGIN.minLeft,
				Math.ceil(Math.max(...tickLabels.map(measure))) + 8,
			);
		}
		const right = rightTicks
			? Math.ceil(Math.max(...rightLabels.map(measure))) + 8
			: PLOT_MARGIN.right;
		const x0 = left;
		const x1 = Math.max(x0 + 1, width - right);
		const y0 = PLOT_MARGIN.top;
		const y1 = y0 + height;
		const svgHeight = y1 + PLOT_MARGIN.bottom;
		const plotWidth = x1 - x0;

		// ---- category positions ---------------------------------------------
		const n = labels.length;
		const lineLike = kind === "line";
		const slot =
			kind === "horizontal"
				? HORIZONTAL_ROW
				: lineLike
					? n > 1
						? plotWidth / (n - 1)
						: plotWidth
					: plotWidth / n;
		const centre = (category: number) =>
			lineLike
				? n > 1
					? x0 + category * slot
					: (x0 + x1) / 2
				: x0 + (category + 0.5) * slot;
		const valueAt =
			kind === "horizontal"
				? (() => {
						const span = ticks.max - ticks.min || 1;
						return (v: number) => x0 + ((v - ticks.min) / span) * plotWidth;
					})()
				: project(ticks, y0, y1);
		const rightAt = rightTicks ? project(rightTicks, y0, y1) : null;

		// ---- x labels (vertical charts) ---------------------------------------
		const axisLabels = labels.map(axisText);
		const plan =
			kind === "horizontal" ? null : thinLabels(axisLabels.map(measure), slot);
		const xLabels = plan
			? plan.shown.map((category) => {
					const text = truncateToWidth(
						axisLabels[category],
						plan.maxWidth,
						measure,
					);
					const anchor: "start" | "middle" | "end" =
						lineLike && n > 1
							? category === 0
								? "start"
								: category === n - 1
									? "end"
									: "middle"
							: "middle";
					return { category, text, x: centre(category), anchor };
				})
			: [];

		// ---- bars -------------------------------------------------------------
		const bars: BarRect[] = [];
		if (kind !== "line") {
			const zero = valueAt(Math.min(Math.max(0, ticks.min), ticks.max));
			const groups = mode === "grouped" ? series.length : 1;
			const band =
				value.type === "histogram"
					? Math.max(1, slot - BIN_GAP)
					: Math.min(slot * BAND, MAX_BAR * groups + GROUP_GAP * (groups - 1));
			const barWidth =
				value.type === "histogram"
					? band
					: Math.min(MAX_BAR, (band - GROUP_GAP * (groups - 1)) / groups);
			const groupWidth = barWidth * groups + GROUP_GAP * (groups - 1);
			for (let category = 0; category < n; category++) {
				const start =
					kind === "horizontal"
						? y0 + category * HORIZONTAL_ROW + (HORIZONTAL_ROW - 16) / 2
						: centre(category) - groupWidth / 2;
				if (stacked || percent) {
					let positive = 0;
					let negative = 0;
					const order = plotted.map((values, index) => ({
						index,
						n: values[category],
					}));
					const lastPositive = order.filter(({ n }) => n > 0).pop()?.index;
					const lastNegative = order.filter(({ n }) => n < 0).pop()?.index;
					let firstPositive = true;
					let firstNegative = true;
					for (const { index, n: amount } of order) {
						if (amount === 0) continue;
						const from = amount < 0 ? negative : positive;
						const to = from + amount;
						if (amount < 0) negative = to;
						else positive = to;
						const first = amount < 0 ? firstNegative : firstPositive;
						if (amount < 0) firstNegative = false;
						else firstPositive = false;
						let base = valueAt(from);
						const tip = valueAt(to);
						/* A real 1px gap between segments, in geometry: a stroke of
						   the canvas colour would paint an opaque seam over glass. */
						if (!first) base += tip < base ? -STACK_GAP : STACK_GAP;
						bars.push({
							category,
							series: index,
							x: start,
							width: barWidth,
							base,
							tip,
							round: index === (amount < 0 ? lastNegative : lastPositive),
						});
					}
				} else {
					plotted.forEach((values, index) => {
						bars.push({
							category,
							series: index,
							x:
								kind === "horizontal"
									? start
									: start + index * (barWidth + GROUP_GAP),
							width: kind === "horizontal" ? 16 : barWidth,
							base: zero,
							tip: valueAt(values[category]),
							round: value.type !== "histogram",
						});
					});
				}
			}
		}

		// ---- lines ------------------------------------------------------------
		const lines =
			kind === "line"
				? plotted.map((values, index) => {
						const at =
							dual && series[index].axis === "right" && rightAt
								? rightAt
								: valueAt;
						return values.map((v, category) => ({
							x: centre(category),
							y: at(v),
						}));
					})
				: [];

		return {
			height,
			svgHeight,
			x0,
			x1,
			y0,
			y1,
			slot,
			centre,
			ticks,
			tickLabels,
			rightTicks,
			rightLabels,
			rightAt,
			valueAt,
			xLabels,
			categoryLabels,
			bars,
			lines,
		};
	}, [
		width,
		font,
		kind,
		labels,
		series,
		plotted,
		percent,
		stacked,
		dual,
		mode,
		numbers,
		value.type,
	]);

	// ---- pointer → mark --------------------------------------------------------
	const locate = (event: ReactPointerEvent<SVGSVGElement>): Mark | null => {
		if (!layout) return null;
		const box = event.currentTarget.getBoundingClientRect();
		const px = event.clientX - box.left;
		const py = event.clientY - box.top;
		const n = labels.length;
		if (kind === "horizontal") {
			const category = Math.floor((py - layout.y0) / HORIZONTAL_ROW);
			if (category < 0 || category >= n) return null;
			return { category, series: 0 };
		}
		if (px < layout.x0 - 4 || px > layout.x1 + 4) return null;
		if (kind === "line") {
			const category =
				n > 1
					? Math.max(
							0,
							Math.min(n - 1, Math.round((px - layout.x0) / layout.slot)),
						)
					: 0;
			let best = 0;
			let distance = Number.POSITIVE_INFINITY;
			layout.lines.forEach((points, index) => {
				const d = Math.abs(points[category].y - py);
				if (d < distance) {
					distance = d;
					best = index;
				}
			});
			return { category, series: best };
		}
		const category = Math.max(
			0,
			Math.min(n - 1, Math.floor((px - layout.x0) / layout.slot)),
		);
		const candidates = layout.bars.filter((bar) => bar.category === category);
		if (!candidates.length) return { category, series: 0 };
		if (mode === "grouped") {
			let best = candidates[0];
			for (const bar of candidates)
				if (
					Math.abs(bar.x + bar.width / 2 - px) <
					Math.abs(best.x + best.width / 2 - px)
				)
					best = bar;
			return { category, series: best.series };
		}
		// Stacked/percent: the segment under the pointer, else the nearest.
		let best = candidates[0];
		let distance = Number.POSITIVE_INFINITY;
		for (const bar of candidates) {
			const top = Math.min(bar.base, bar.tip);
			const bottom = Math.max(bar.base, bar.tip);
			const d = py < top ? top - py : py > bottom ? py - bottom : 0;
			if (d < distance) {
				distance = d;
				best = bar;
			}
		}
		return { category, series: best.series };
	};

	// ---- readout ------------------------------------------------------------
	const unitFor = (index: number) =>
		dual && series[index].axis === "right" ? value.rightUnit : value.unit;
	const multi = series.length > 1;
	const readout = (() => {
		if (!active || !layout) return null;
		const { category } = active;
		const raw = series.map(({ values }) => values[category]);
		const shares =
			percent || stacked
				? categoryShares(raw.map((n) => Math.abs(n)))
				: undefined;
		const rows: TooltipRow[] = series.map((entry, index) => ({
			ink: SLOT_INK[index],
			label: multi ? entry.label : undefined,
			value: withUnit(numbers.exact(raw[index]), unitFor(index)),
			note: shares
				? t("ui.chat.inline_chart.share_of_total", {
						share: numbers.share(shares[index]),
					})
				: undefined,
		}));
		if (stacked) {
			rows.push({
				label: t("ui.chat.inline_chart.total"),
				value: withUnit(
					numbers.exact(raw.reduce((sum, n) => sum + n, 0)),
					value.unit,
				),
			});
		}
		let anchor: { x: number; y: number; below?: number };
		if (kind === "line") {
			const ys = layout.lines.map((points) => points[category].y);
			anchor = {
				x: layout.centre(category),
				y: Math.min(...ys),
				below: Math.max(...ys),
			};
		} else {
			const bars = layout.bars.filter((bar) => bar.category === category);
			if (kind === "horizontal") {
				const bar = bars[0];
				anchor = {
					x: bar ? Math.max(bar.base, bar.tip) : layout.x0,
					y: bar ? bar.x : layout.y0,
					below: bar ? bar.x + bar.width : layout.y0,
				};
			} else {
				const target =
					mode === "grouped"
						? bars.find((bar) => bar.series === active.series)
						: undefined;
				const tops = bars.map((bar) => Math.min(bar.base, bar.tip));
				anchor = {
					x: target ? target.x + target.width / 2 : layout.centre(category),
					y: target
						? Math.min(target.base, target.tip)
						: tops.length
							? Math.min(...tops)
							: layout.y1,
					below: tops.length ? Math.max(...tops) : layout.y1,
				};
			}
		}
		const focus = Math.min(active.series, series.length - 1);
		const text = announce(
			[
				labels[category],
				multi ? series[focus].label : undefined,
				withUnit(numbers.exact(raw[focus]), unitFor(focus)),
				shares
					? t("ui.chat.inline_chart.share_of_total", {
							share: numbers.share(shares[focus]),
						})
					: undefined,
			],
			category,
			labels.length,
		);
		return { rows, anchor, text };
	})();

	// ---- data table ---------------------------------------------------------
	const columns = [
		{ label: "" },
		...series.map((entry, index) => ({
			// A single series is the title itself; its header carries the unit.
			label: multi
				? withUnitHeader(entry.label, unitFor(index))
				: (unitFor(index) ?? ""),
			numeric: true,
		})),
	];
	const rows = labels.map((label, category) => [
		label,
		...series.map(({ values }) => numbers.exact(values[category])),
	]);

	const activeSeries = active
		? Math.min(active.series, series.length - 1)
		: null;
	const dimSeries = (index: number) =>
		activeSeries !== null && multi && activeSeries !== index;
	const legend = multi
		? series.map((entry, index) => (
				<LegendItem
					key={`${index}-${entry.label}`}
					ink={SLOT_INK[index]}
					dashed={dual && entry.axis === "right"}
					label={
						dual && entry.axis === "right"
							? t("ui.chat.inline_chart.right_axis", { label: entry.label })
							: entry.label
					}
					dim={dimSeries(index)}
					onEnter={() =>
						marks.point(
							{ category: active?.category ?? 0, series: index },
							"mouse",
						)
					}
					onLeave={marks.leave}
				/>
			))
		: null;

	return (
		<figure
			className="@container/chart min-w-0"
			data-lo-inline-ui={value.type}
			data-series-mode={mode}
			data-lo-chart-kind={kind}
		>
			<ChartHeader
				title={value.title}
				titleId={titleId}
				start={
					percent ? undefined : value.unit ? <bdi>{value.unit}</bdi> : undefined
				}
				end={
					legend || dual ? (
						<>
							{legend}
							{dual && value.rightUnit && (
								<bdi className="text-ink-muted">{value.rightUnit}</bdi>
							)}
						</>
					) : undefined
				}
			/>
			<ChartRoot
				rootRef={rootRef}
				titleId={titleId}
				describedById={dataId}
				keys={marks.rootProps}
				className={cn(!layout && "h-[calc(clamp(180px,34cqw,240px)+36px)]")}
				style={layout ? { height: layout.svgHeight } : undefined}
			>
				{layout && (
					<svg
						aria-hidden="true"
						width={width}
						height={layout.svgHeight}
						viewBox={`0 0 ${width} ${layout.svgHeight}`}
						className="block touch-pan-y select-none overflow-visible"
						onPointerMove={(event) =>
							marks.point(locate(event), event.pointerType)
						}
						onPointerDown={(event) =>
							event.pointerType === "touch" &&
							marks.point(locate(event), "touch", true)
						}
						onPointerLeave={marks.leave}
					>
						{/* Gridlines and tick labels: no spine, no tick marks. */}
						{kind === "horizontal"
							? layout.ticks.ticks.map((tick, index) => {
									const x = Math.round(layout.valueAt(tick)) + 0.5;
									return (
										<g key={`grid-${tick}`}>
											<line
												x1={x}
												x2={x}
												y1={layout.y0}
												y2={layout.y1}
												className={
													tick === 0 && layout.ticks.min < 0
														? "stroke-hairline-strong"
														: "stroke-hairline"
												}
											/>
											<text
												x={x}
												y={layout.y1 + 16}
												textAnchor={
													index === 0
														? "start"
														: index === layout.ticks.ticks.length - 1
															? "end"
															: "middle"
												}
												className="fill-ink-muted text-meta tabular-nums"
											>
												{layout.tickLabels[index]}
											</text>
										</g>
									);
								})
							: layout.ticks.ticks.map((tick, index) => {
									const y = snap(layout.valueAt(tick));
									return (
										<g key={`grid-${tick}`}>
											<line
												x1={layout.x0}
												x2={layout.x1}
												y1={y}
												y2={y}
												className={
													tick === 0 && layout.ticks.min < 0
														? "stroke-hairline-strong"
														: "stroke-hairline"
												}
											/>
											<text
												x={layout.x0 - 8}
												y={y}
												textAnchor="end"
												dominantBaseline="middle"
												className="fill-ink-muted text-meta tabular-nums"
											>
												{layout.tickLabels[index]}
											</text>
											{layout.rightTicks && (
												<text
													x={layout.x1 + 8}
													y={snap(
														layout.rightAt?.(
															layout.rightTicks.ticks[index] ?? 0,
														) ?? y,
													)}
													textAnchor="start"
													dominantBaseline="middle"
													className="fill-ink-muted text-meta tabular-nums"
												>
													{layout.rightLabels[index]}
												</text>
											)}
										</g>
									);
								})}
						{kind === "horizontal"
							? layout.categoryLabels.map((text, category) => (
									<text
										key={`cat-${category}-${text}`}
										x={layout.x0 - 8}
										y={
											layout.y0 + category * HORIZONTAL_ROW + HORIZONTAL_ROW / 2
										}
										textAnchor="end"
										dominantBaseline="middle"
										className={cn("fill-ink-muted text-meta", DIM_TRANSITION)}
										opacity={active && active.category !== category ? DIM : 1}
									>
										{text}
									</text>
								))
							: layout.xLabels.map(({ category, text, x, anchor }) => (
									<text
										key={`x-${category}`}
										x={x}
										y={layout.y1 + 18}
										textAnchor={anchor}
										className="fill-ink-muted text-meta"
									>
										{text}
									</text>
								))}
						{kind === "line" && active && (
							<line
								x1={Math.round(layout.centre(active.category)) + 0.5}
								x2={Math.round(layout.centre(active.category)) + 0.5}
								y1={layout.y0}
								y2={layout.y1}
								className="stroke-hairline-strong"
							/>
						)}
						<g className={ENTER}>
							{layout.bars.map((bar) => {
								const isActive =
									active &&
									active.category === bar.category &&
									(mode === "grouped" || stacked || percent
										? active.series === bar.series
										: true);
								const single = series.length === 1;
								return (
									<path
										key={`bar-${bar.category}-${bar.series}`}
										d={barPath(
											bar.x,
											bar.width,
											bar.base,
											bar.tip,
											bar.round ? RADIUS : 0,
											kind === "horizontal",
										)}
										fill="currentColor"
										className={cn(
											DIM_TRANSITION,
											single && isActive
												? "text-chart-bar-hover"
												: SLOT_INK[bar.series],
										)}
										opacity={active && !isActive ? DIM : 1}
									/>
								);
							})}
							{layout.lines.map((points, index) => (
								<g
									key={`line-${series[index].label}-${index}`}
									className={cn(SLOT_INK[index], DIM_TRANSITION)}
									opacity={dimSeries(index) ? DIM : 1}
								>
									<polyline
										points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinejoin="round"
										strokeLinecap="round"
										strokeDasharray={
											dual && series[index].axis === "right" ? "6 4" : undefined
										}
									/>
									{labels.length <= 12 &&
										points.map(({ x, y }, category) => (
											<circle
												key={`dot-${labels[category]}-${x}`}
												cx={x}
												cy={y}
												r={2.5}
												fill="currentColor"
											/>
										))}
								</g>
							))}
						</g>
						{kind === "line" &&
							active &&
							layout.lines.map((points, index) => (
								<circle
									key={`active-${series[index].label}-${index}`}
									cx={points[active.category].x}
									cy={points[active.category].y}
									r={4}
									fill="currentColor"
									strokeWidth={2}
									className={cn(SLOT_INK[index], "stroke-canvas")}
								/>
							))}
					</svg>
				)}
				{readout && (
					<ChartTooltip
						anchor={readout.anchor}
						width={width}
						heading={labels[active?.category ?? 0]}
						rows={readout.rows}
					/>
				)}
				<LiveRegion text={readout?.text ?? ""} />
			</ChartRoot>
			<ChartData describedById={dataId} columns={columns} rows={rows} />
		</figure>
	);
}
