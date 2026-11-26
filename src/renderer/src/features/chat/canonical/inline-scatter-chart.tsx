/**
 * `scatter`: two numeric axes with nice ticks and gridlines both ways (inline
 * chart spec section 2), dots at r 4 in `chart-1`, and the nearest point within
 * 24px as the hover target (section 5). The old renderer labelled only the two
 * extremes of each axis inside a stretched 100x100 viewBox, so a reader could
 * not tell what any one point was worth.
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
	LiveRegion,
	textWidth,
	useActiveMark,
	useAnnounce,
	useChartNumbers,
	useMeasuredWidth,
	useMergedRef,
} from "./inline-chart-frame";
import {
	PLOT_MARGIN,
	niceTicks,
	plotHeight,
	project,
	snap,
} from "./inline-chart-model";
import type { Scatter } from "./inline-ui-parts";

/* Pointer reach for the nearest point (web; RN uses 32dp). */
const REACH = 24;

export function InlineScatterChart({ value }: { value: Scatter }) {
	const id = useId();
	const titleId = `${id}-title`; // i18n: ignore DOM id, never shown
	const dataId = `${id}-data`; // i18n: ignore DOM id, never shown
	const numbers = useChartNumbers();
	const announce = useAnnounce();
	const [measureRef, width, font] = useMeasuredWidth<HTMLDivElement>();
	/* Keyboard order runs left to right (then bottom to top), so arrow keys
	   walk the cloud the way the eye reads it, whatever the authored order. */
	const order = useMemo(
		() =>
			Array.from(value.data.keys()).sort(
				(a, b) =>
					value.data[a][0] - value.data[b][0] ||
					value.data[a][1] - value.data[b][1] ||
					a - b,
			),
		[value.data],
	);
	const marks = useActiveMark({ categories: order.length, series: 1 });
	const rootRef = useMergedRef(measureRef, marks.rootRef);
	const activePoint = marks.active ? order[marks.active.category] : null;

	const layout = useMemo(() => {
		if (width <= 0) return null;
		const height = plotHeight(width);
		const measure = (text: string) => textWidth(text, font);
		const yTicks = niceTicks(
			value.data.map(([, y]) => y),
			height,
			"near",
		);
		// The x axis uses the same nice-tick rule (spec section 2).
		const xTicks = niceTicks(
			value.data.map(([x]) => x),
			height,
			"near",
		);
		const formatY = numbers.tick(yTicks);
		const formatX = numbers.tick(xTicks);
		const yLabels = yTicks.ticks.map(formatY);
		const xLabels = xTicks.ticks.map(formatX);
		const x0 = Math.max(
			PLOT_MARGIN.minLeft,
			Math.ceil(Math.max(...yLabels.map(measure))) + 8,
		);
		// Room for half of the last x tick label past the plot's right edge.
		const lastHalf = measure(xLabels[xLabels.length - 1] ?? "") / 2;
		const x1 = Math.max(
			x0 + 1,
			width - Math.max(PLOT_MARGIN.right, Math.ceil(lastHalf)),
		);
		const y0 = PLOT_MARGIN.top;
		const y1 = y0 + height;
		const toY = project(yTicks, y0, y1);
		const xSpan = xTicks.max - xTicks.min || 1;
		const toX = (x: number) => x0 + ((x - xTicks.min) / xSpan) * (x1 - x0);
		const points = value.data.map(([x, y]) => ({ x: toX(x), y: toY(y) }));
		return {
			x0,
			x1,
			y0,
			y1,
			svgHeight: y1 + PLOT_MARGIN.bottom,
			yTicks,
			xTicks,
			yLabels,
			xLabels,
			toX,
			toY,
			points,
		};
	}, [width, font, value.data, numbers]);

	const locate = (event: ReactPointerEvent<Element>) => {
		if (!layout) return null;
		const box = event.currentTarget.getBoundingClientRect();
		const px = event.clientX - box.left;
		const py = event.clientY - box.top;
		let best = -1;
		let distance = REACH;
		layout.points.forEach(({ x, y }, index) => {
			const d = Math.hypot(x - px, y - py);
			if (d <= distance) {
				distance = d;
				best = index;
			}
		});
		return best < 0 ? null : { category: order.indexOf(best), series: 0 };
	};

	// Memoised so a hover does not re-render the (memo) tables; review R5.
	const dataColumns = useMemo(
		() => [
			{ label: value.xLabel, numeric: true },
			{ label: value.yLabel, numeric: true },
		],
		[value.xLabel, value.yLabel],
	);
	const dataRows = useMemo(
		() => value.data.map(([x, y]) => [numbers.exact(x), numbers.exact(y)]),
		[value.data, numbers],
	);

	const readout = (() => {
		if (activePoint === null || !layout || !marks.active) return null;
		const [x, y] = value.data[activePoint];
		const point = layout.points[activePoint];
		const xText = numbers.exact(x);
		const yText = numbers.exact(y);
		return {
			anchor: { x: point.x, y: point.y - 6, below: point.y + 6 },
			rows: [
				{ label: value.xLabel, value: xText },
				{ label: value.yLabel, value: yText },
			],
			text: announce(
				[
					t("ui.chat.inline_chart.pair", { label: value.xLabel, value: xText }),
					t("ui.chat.inline_chart.pair", { label: value.yLabel, value: yText }),
				],
				marks.active.category,
				order.length,
			),
		};
	})();

	return (
		<figure className="@container/chart min-w-0" data-lo-inline-ui="scatter">
			<ChartHeader
				title={value.title}
				titleId={titleId}
				start={<bdi>{value.yLabel}</bdi>}
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
						direction="ltr"
						className="block select-none overflow-visible"
						{...marks.pointerHandlers(locate)}
					>
						{layout.yTicks.ticks.map((tick, index) => {
							const y = snap(layout.toY(tick));
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional; values may repeat (X11).
								<g key={`y-${index}`}>
									<line
										x1={layout.x0}
										x2={layout.x1}
										y1={y}
										y2={y}
										className={
											tick === 0 && layout.yTicks.min < 0
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
										{layout.yLabels[index]}
									</text>
								</g>
							);
						})}
						{layout.xTicks.ticks.map((tick, index) => {
							const x = Math.round(layout.toX(tick)) + 0.5;
							return (
								// biome-ignore lint/suspicious/noArrayIndexKey: ticks are positional; values may repeat (X11).
								<g key={`x-${index}`}>
									<line
										x1={x}
										x2={x}
										y1={layout.y0}
										y2={layout.y1}
										className={
											tick === 0 && layout.xTicks.min < 0
												? "stroke-hairline-strong"
												: "stroke-hairline"
										}
									/>
									<text
										x={x}
										y={layout.y1 + 18}
										textAnchor="middle"
										className="fill-ink-muted text-meta tabular-nums"
									>
										{layout.xLabels[index]}
									</text>
								</g>
							);
						})}
						<g className={cn(ENTER, "text-chart-1")}>
							{layout.points.map(({ x, y }, index) => (
								<circle
									key={`point-${index}-${x}-${y}`}
									cx={x}
									cy={y}
									r={activePoint === index ? 6 : 4}
									fill="currentColor"
									fillOpacity={0.85}
									className={DIM_TRANSITION}
									opacity={
										activePoint !== null && activePoint !== index ? DIM : 1
									}
								/>
							))}
						</g>
					</svg>
				)}
				{readout && (
					<ChartTooltip
						anchor={readout.anchor}
						width={width}
						bottom={layout?.y1 ?? 0}
						rows={readout.rows}
					/>
				)}
				<LiveRegion text={readout?.text ?? ""} />
			</ChartRoot>
			<div className="mt-1 wrap-anywhere text-end text-ink-muted text-meta">
				<bdi>{value.xLabel}</bdi>
			</div>
			<ChartData describedById={dataId} columns={dataColumns} rows={dataRows} />
		</figure>
	);
}
