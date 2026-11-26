/**
 * `pie`, drawn as a donut with direct labels (inline chart spec section 3).
 *
 * WHY. The operator reported a pie that was "super small", labels "on separate
 * rows instead of properly highlighting each part" and slices that "just differ
 * by shades". The donut is 200px wide (180 narrow), each slice of 3% or more is
 * labelled beside the slice it names, slices take distinct categorical hues
 * (`chart-1..6`, see chart-palette.mjs), and the hole holds a readout - the
 * total at rest, the active slice on hover/focus/tap - which is also the touch
 * answer, where a floating tooltip would sit under the finger.
 */
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { useId, useMemo, useState } from "react";
import {
	ChartData,
	ChartHeader,
	ChartRoot,
	ChartTooltip,
	DIM,
	DIM_TRANSITION,
	ENTER,
	LiveRegion,
	OTHER_INK,
	SLOT_INK,
	type TooltipAnchor,
	type TooltipRow,
	textWidth,
	useActiveMark,
	useAnnounce,
	useChartNumbers,
	useIsomorphicLayoutEffect,
	useMeasuredWidth,
	useMergedRef,
} from "./inline-chart-frame";
import {
	NARROW_WIDTH,
	donutDiameter,
	donutSlicePath,
	inRingInk,
	pieSlices,
	polar,
	relaxLabels,
	truncateToWidth,
	withUnit,
} from "./inline-chart-model";
import type { CategoryChart } from "./inline-ui-parts";

/* Direct labels: slices of 3% or more (wide); in-ring percents: 8% (narrow). */
const LABEL_SHARE = 0.03;
const IN_RING_SHARE = 0.08;
/* Leader geometry: from radius + 4 to an elbow at radius + 16, then 12px
   across; labels on one side stay at least 18px apart. */
const LEADER_START = 4;
const LEADER_ELBOW = 16;
const LEADER_RUN = 12;
const LABEL_GAP = 18;
/* The "Other" tooltip names at most this many folded items, then `+n more`. */
const FOLDED_LISTED = 8;

/**
 * Resolved slot colours, re-read when the theme changes (a composed theme
 * swaps `data-theme`), for the narrow donut's in-ring percent contrast check.
 *
 * The observer is attached in a LAYOUT effect on mount, NOT gated on
 * `enabled` (QA Q2): `enabled` only turns true after the first width
 * measurement, and a theme switch landing between that commit's colour read
 * and a later-attached observer was never seen, so a cold-loaded light story
 * kept the dark palette's black in-ring text (3.75:1 on #137742).
 */
function useSlotColours(
	ref: { readonly current: HTMLElement | null },
	enabled: boolean,
) {
	const [colours, setColours] = useState<string[]>([]);
	const [theme, setTheme] = useState(0);
	useIsomorphicLayoutEffect(() => {
		if (typeof MutationObserver === "undefined") return;
		const observer = new MutationObserver(() => setTheme((n) => n + 1));
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "class"],
		});
		return () => observer.disconnect();
	}, []);
	useIsomorphicLayoutEffect(() => {
		const node = ref.current;
		if (!enabled || !node) return;
		const style = getComputedStyle(node);
		const next = SLOT_INK.map((_, index) =>
			style.getPropertyValue(`--color-chart-${index + 1}`).trim(),
		);
		setColours((previous) =>
			previous.join() === next.join() ? previous : next,
		);
	}, [enabled, ref, theme]);
	return colours;
}

export function InlineDonutChart({ value }: { value: CategoryChart }) {
	const id = useId();
	const titleId = `${id}-title`; // i18n: ignore DOM id, never shown
	const dataId = `${id}-data`; // i18n: ignore DOM id, never shown
	const numbers = useChartNumbers();
	const announce = useAnnounce();
	const [measureRef, width, font] = useMeasuredWidth<HTMLDivElement>();
	const slices = useMemo(
		() =>
			pieSlices(value.data, (count) =>
				t("ui.chat.inline_chart.other", { count }),
			),
		[value.data],
	);
	const marks = useActiveMark({ categories: slices.length, series: 1 });
	const rootRef = useMergedRef(measureRef, marks.rootRef);
	const active = marks.active?.category ?? null;
	const wide = width >= NARROW_WIDTH;
	const colours = useSlotColours(marks.rootRef, width > 0 && !wide);
	const total = value.data.reduce((sum, [, amount]) => sum + amount, 0);

	const layout = useMemo(() => {
		if (width <= 0) return null;
		const diameter = donutDiameter(width);
		const outer = diameter / 2;
		const inner = outer * 0.6;
		const svgWidth = wide ? width : diameter;
		const height = diameter + 24;
		const cx = svgWidth / 2;
		const cy = 12 + outer;
		const measure = (text: string) => textWidth(text, font);
		const labels: {
			index: number;
			side: 1 | -1;
			anchor: { x: number; y: number };
			elbow: { x: number; y: number };
			y: number;
			text: string;
			share: string;
		}[] = [];
		if (wide) {
			const room = width / 2 - outer - LEADER_ELBOW - LEADER_RUN - 8;
			for (const side of [1, -1] as const) {
				const own = slices
					.map((slice, index) => ({ slice, index }))
					.filter(
						({ slice }) =>
							slice.share >= LABEL_SHARE &&
							(Math.sin((slice.start + slice.end) / 2) >= 0 ? 1 : -1) === side,
					)
					.map(({ slice, index }) => {
						const mid = (slice.start + slice.end) / 2;
						const elbow = polar(cx, cy, outer + LEADER_ELBOW, mid);
						return {
							index,
							mid,
							elbow,
							anchor: polar(cx, cy, outer + LEADER_START, mid),
						};
					})
					.sort((a, b) => a.elbow.y - b.elbow.y);
				const ys = relaxLabels(
					own.map(({ elbow }) => elbow.y),
					LABEL_GAP,
					8,
					height - 8,
				);
				own.forEach(({ index, elbow, anchor }, order) => {
					const share = numbers.pieShare(slices[index].share);
					const shareWidth = measure(` ${share}`) + 4;
					labels.push({
						index,
						side,
						anchor,
						elbow: { x: elbow.x, y: ys[order] },
						y: ys[order],
						text: truncateToWidth(
							slices[index].label,
							Math.max(24, room - shareWidth),
							measure,
						),
						share,
					});
				});
			}
		}
		return { diameter, outer, inner, svgWidth, height, cx, cy, labels };
	}, [width, wide, font, slices, numbers]);

	const small = wide
		? slices
				.map((slice, index) => ({ slice, index }))
				.filter(({ slice }) => slice.share < LABEL_SHARE)
		: [];

	// Slices, their labels and legend rows: hover, or tap decided on pointer-up.
	const markHandlers = (index: number) =>
		marks.pointerHandlers(() => ({ category: index, series: 0 }));
	const inkOf = (index: number) => {
		const slot = slices[index].slot;
		return slot === null ? OTHER_INK : SLOT_INK[slot];
	};

	const readout = (() => {
		if (active === null || !layout) return null;
		const slice = slices[active];
		const amount = withUnit(numbers.exact(slice.amount), value.unit);
		const share = t("ui.chat.inline_chart.share_of_total", {
			share: numbers.pieShare(slice.share),
		});
		const rows: TooltipRow[] = [
			{ ink: inkOf(active), value: amount, note: share },
		];
		if (slice.folded) {
			for (const [label, folded] of slice.folded.slice(0, FOLDED_LISTED))
				rows.push({
					label,
					value: withUnit(numbers.exact(folded), value.unit),
				});
			if (slice.folded.length > FOLDED_LISTED)
				rows.push({
					value: t("ui.chat.inline_chart.more", {
						count: slice.folded.length - FOLDED_LISTED,
					}),
				});
		}
		const mid = (slice.start + slice.end) / 2;
		const cx = layout.cx + (wide ? 0 : (width - layout.svgWidth) / 2);
		const point = polar(cx, layout.cy, layout.outer + 8, mid);
		/* Beside the ring on the slice's own side, never inside the outer
		   radius: a flip-below used to drop a top slice's tooltip onto the hole,
		   where the glass let the centre readout ghost through (design review
		   D1, decision X5). Angles run clockwise from 12 o'clock, so sin > 0 is
		   the right half. */
		const anchor: TooltipAnchor = {
			x: point.x,
			y: point.y,
			beside: {
				left: cx - layout.outer,
				right: cx + layout.outer,
				side: Math.sin(mid) >= 0 ? 1 : -1,
			},
		};
		return {
			rows,
			amount,
			share: numbers.pieShare(slice.share),
			anchor,
			text: announce([slice.label, amount, share], active, slices.length),
		};
	})();

	const centre = layout && (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute flex flex-col items-center justify-center text-center text-meta leading-4"
			style={{
				left: (wide ? layout.cx : width / 2) - layout.inner * 0.8,
				top: layout.cy - layout.inner,
				width: layout.inner * 1.6,
				height: layout.inner * 2,
			}}
		>
			{readout && active !== null ? (
				<>
					<bdi className="w-full truncate text-ink-muted">
						{slices[active].label}
					</bdi>
					<span className="font-semibold text-ink tabular-nums">
						{readout.amount}
					</span>
					<span className="text-ink-muted tabular-nums">{readout.share}</span>
				</>
			) : (
				<>
					<span className="font-semibold text-ink tabular-nums">
						{withUnit(numbers.exact(total), value.unit)}
					</span>
					<span className="text-ink-muted">
						{t("ui.chat.inline_chart.total")}
					</span>
				</>
			)}
		</div>
	);

	// Memoised so a hover does not re-render the (memo) tables; review R5.
	const columns = useMemo(
		() => [
			{ label: "" },
			{ label: value.unit ?? "", numeric: true },
			{ label: "%", numeric: true },
		],
		[value.unit],
	);
	/* The table is the exact-values view, so it keeps one decimal; the
	   whole-percent rule (X9) is for the chart's own labels and readouts. */
	const rows = useMemo(() => {
		const peak = Math.max(...value.data.map(([, n]) => n)) || 1;
		const sum = value.data.reduce((acc, [, n]) => acc + n / peak, 0) || 1;
		return value.data.map(([label, amount]) => [
			label,
			numbers.exact(amount),
			numbers.share(amount / peak / sum),
		]);
	}, [value.data, numbers]);

	return (
		<figure className="min-w-0" data-lo-inline-ui="pie">
			<ChartHeader
				title={value.title}
				titleId={titleId}
				start={value.unit ? <bdi>{value.unit}</bdi> : undefined}
			/>
			<ChartRoot
				rootRef={rootRef}
				titleId={titleId}
				describedById={dataId}
				keys={marks.rootProps}
				className={cn(
					// Before the first measurement: the wide donut's height.
					!layout && "h-[224px]",
				)}
				style={layout ? { height: layout.height } : undefined}
			>
				{layout && (
					<svg
						aria-hidden="true"
						width={layout.svgWidth}
						height={layout.height}
						viewBox={`0 0 ${layout.svgWidth} ${layout.height}`}
						direction="ltr"
						className="mx-auto block select-none overflow-visible"
					>
						<g className={ENTER}>
							{slices.map((slice, index) => (
								<path
									key={`slice-${index}-${slice.label}`}
									d={donutSlicePath(
										layout.cx,
										layout.cy,
										layout.inner,
										layout.outer,
										slice.start,
										slice.end,
									)}
									fill="currentColor"
									fillRule="evenodd"
									className={cn(inkOf(index), DIM_TRANSITION)}
									opacity={active !== null && active !== index ? DIM : 1}
									{...markHandlers(index)}
								/>
							))}
						</g>
						{!wide &&
							slices.map((slice, index) => {
								if (slice.share < IN_RING_SHARE || slice.slot === null)
									return null;
								const ink = inRingInk(colours[slice.slot] ?? "");
								if (!ink) return null;
								const point = polar(
									layout.cx,
									layout.cy,
									(layout.inner + layout.outer) / 2,
									(slice.start + slice.end) / 2,
								);
								return (
									<text
										key={`ring-${index}-${slice.label}`}
										x={point.x}
										y={point.y}
										fill={ink}
										textAnchor="middle"
										dominantBaseline="middle"
										className="pointer-events-none text-meta tabular-nums"
									>
										{numbers.pieShare(slice.share)}
									</text>
								);
							})}
						{layout.labels.map((label) => {
							const end = label.elbow.x + label.side * LEADER_RUN;
							return (
								<g
									key={`label-${label.index}`}
									className={DIM_TRANSITION}
									opacity={active !== null && active !== label.index ? DIM : 1}
									{...markHandlers(label.index)}
								>
									<polyline
										points={`${label.anchor.x},${label.anchor.y} ${label.elbow.x},${label.y} ${end},${label.y}`}
										fill="none"
										strokeWidth={1}
										className="stroke-ink-muted"
										strokeOpacity={0.6}
									/>
									<text
										x={end + label.side * 4}
										y={label.y}
										textAnchor={label.side > 0 ? "start" : "end"}
										dominantBaseline="middle"
										className="text-meta"
									>
										<tspan className="fill-ink">{label.text}</tspan>
										<tspan className="fill-ink-muted tabular-nums">
											{` ${label.share}`}
										</tspan>
									</text>
								</g>
							);
						})}
					</svg>
				)}
				{centre}
				{/* Narrow or touch: the centre readout IS the tooltip (spec
				    section 5); a floating one would sit under the finger. */}
				{wide && marks.source !== "touch" && readout && (
					<ChartTooltip
						anchor={readout.anchor}
						width={width}
						bottom={layout?.height ?? 0}
						heading={slices[active ?? 0].label}
						rows={readout.rows}
					/>
				)}
				<LiveRegion text={readout?.text ?? ""} />
			</ChartRoot>
			{small.length > 0 && (
				<p className="mt-2 text-center text-ink-muted text-meta">
					{t("ui.chat.inline_chart.also")}{" "}
					{small.map(({ slice, index }, order) => (
						<span
							key={`small-${index}-${slice.label}`}
							className={cn(
								"whitespace-nowrap",
								DIM_TRANSITION,
								active === index && "text-ink",
							)}
							{...markHandlers(index)}
						>
							<bdi>{slice.label}</bdi>{" "}
							<span className="tabular-nums">
								{numbers.pieShare(slice.share)}
							</span>
							{order < small.length - 1 ? ", " : ""}
						</span>
					))}
				</p>
			)}
			{layout && !wide && (
				<ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-meta">
					{slices.map((slice, index) => (
						<li
							key={`legend-${index}-${slice.label}`}
							className={cn("flex min-w-0 items-center gap-2", DIM_TRANSITION)}
							style={{
								opacity: active !== null && active !== index ? DIM : 1,
							}}
							{...markHandlers(index)}
						>
							<span
								aria-hidden="true"
								className={cn(
									"size-2.5 shrink-0 rounded-[2px] bg-current",
									inkOf(index),
								)}
							/>
							<bdi className="min-w-0 flex-1 truncate text-ink">
								{slice.label}
							</bdi>
							<span className="text-ink-muted tabular-nums">
								{numbers.pieShare(slice.share)}
							</span>
						</li>
					))}
				</ul>
			)}
			<ChartData describedById={dataId} columns={columns} rows={rows} />
		</figure>
	);
}
