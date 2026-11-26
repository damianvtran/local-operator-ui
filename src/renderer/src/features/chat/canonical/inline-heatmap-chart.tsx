/**
 * `heatmap`: a grid of cells filling the width, coloured on ONE sequential
 * ramp from the surface toward the accent (inline chart spec section 4).
 *
 * WHY CELLS, NOT A TABLE WITH SWATCHES. The old renderer was a data table with
 * an 8px swatch beside each number, so the two-dimensional pattern a heatmap
 * exists to show was never drawn. Cells carry no text (a tint whose ink
 * contrast varies cannot hold exact values); hover, focus or tap reads a cell,
 * and the collapsed "Chart data" table keeps every value one click away.
 * Missing values are hatched, never painted as the ramp's low end.
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
	axisText,
	heatmapRowHeight,
	thinLabels,
	truncateToWidth,
	withUnit,
} from "./inline-chart-model";
import type { Heatmap } from "./inline-ui-parts";

const CELL_GAP = 2;
const CELL_RADIUS = 3;
const BOTTOM = 24;

/** The sequential fill at `fraction` of the domain: `t = 12 + 88 x fraction`. */
export function heatFill(fraction: number) {
	const strength = Math.round((12 + 88 * fraction) * 10) / 10;
	return `color-mix(in oklab, var(--color-accent) ${strength}%, var(--color-surface))`; // i18n: ignore generated CSS colour, not display copy.
}

export function InlineHeatmapChart({ value }: { value: Heatmap }) {
	const id = useId();
	const titleId = `${id}-title`; // i18n: ignore DOM id, never shown
	const dataId = `${id}-data`; // i18n: ignore DOM id, never shown
	// useId's colons are legal in an id but not worth testing inside url().
	const hatchId = `${id.replace(/:/g, "")}-hatch`; // i18n: ignore DOM id, never shown
	const numbers = useChartNumbers();
	const announce = useAnnounce();
	const [measureRef, width, font] = useMeasuredWidth<HTMLDivElement>();
	const columns = value.columns.length;
	const rowCount = value.rows.length;
	// Left/Right walk columns, Up/Down walk rows (spec section 5).
	const marks = useActiveMark({ categories: columns, series: rowCount });
	const rootRef = useMergedRef(measureRef, marks.rootRef);
	const active = marks.active;

	const domain = useMemo(() => {
		const cells = value.rows.flat().filter((cell) => cell !== null);
		if (!cells.length) return null;
		// Divide before subtracting so a wide finite range cannot overflow.
		const magnitude = Math.max(...cells.map(Math.abs)) || 1;
		const min = Math.min(...cells);
		const max = Math.max(...cells);
		const low = min / magnitude;
		const span = max / magnitude - low;
		return {
			min,
			max,
			fraction: (cell: number) =>
				span === 0 ? 1 : (cell / magnitude - low) / span,
		};
	}, [value.rows]);

	const layout = useMemo(() => {
		if (width <= 0) return null;
		const pitch = heatmapRowHeight(width);
		const measure = (text: string) => textWidth(text, font);
		const cap = Math.max(48, Math.floor(width * 0.3));
		const widest = Math.max(0, ...value.rowLabels.map(measure));
		const x0 = Math.min(cap, Math.ceil(widest)) + 8;
		const plotWidth = Math.max(1, width - x0);
		const slot = plotWidth / Math.max(1, columns);
		const plan = thinLabels(
			value.columns.map((c) => measure(axisText(c))),
			slot,
		);
		return {
			pitch,
			x0,
			slot,
			plotHeight: rowCount * pitch,
			svgHeight: rowCount * pitch + BOTTOM,
			rowLabels: value.rowLabels.map((label) =>
				truncateToWidth(label, x0 - 8, measure),
			),
			columnLabels: plan.shown.map((column) => ({
				column,
				text: truncateToWidth(
					axisText(value.columns[column]),
					plan.maxWidth,
					measure,
				),
			})),
		};
	}, [width, font, value.rowLabels, value.columns, columns, rowCount]);

	const locate = (event: ReactPointerEvent<SVGSVGElement>) => {
		if (!layout) return null;
		const box = event.currentTarget.getBoundingClientRect();
		const px = event.clientX - box.left;
		const py = event.clientY - box.top;
		const column = Math.floor((px - layout.x0) / layout.slot);
		const row = Math.floor(py / layout.pitch);
		if (column < 0 || column >= columns || row < 0 || row >= rowCount)
			return null;
		return { category: column, series: row };
	};

	const readout = (() => {
		if (!active || !layout) return null;
		const { category: column, series: row } = active;
		const cell = value.rows[row]?.[column];
		const text =
			cell === null || cell === undefined
				? t("ui.chat.inline_chart.no_data")
				: withUnit(numbers.exact(cell), value.unit);
		return {
			anchor: {
				x: layout.x0 + (column + 0.5) * layout.slot,
				y: row * layout.pitch,
				below: (row + 1) * layout.pitch - CELL_GAP,
			},
			heading: value.columns[column],
			rows: [{ label: value.rowLabels[row], value: text }],
			text: announce(
				[value.rowLabels[row], value.columns[column], text],
				row * columns + column,
				rowCount * columns,
			),
		};
	})();

	const legend = domain && domain.min !== domain.max && (
		<span className="flex items-center gap-2 tabular-nums" dir="ltr">
			<bdi>{withUnit(numbers.exact(domain.min), value.unit)}</bdi>
			<span
				aria-hidden="true"
				className="h-2 w-[120px] rounded-[4px]"
				style={{
					background: `linear-gradient(90deg, ${heatFill(0)}, ${heatFill(1)})`,
				}}
			/>
			<bdi>{withUnit(numbers.exact(domain.max), value.unit)}</bdi>
		</span>
	);

	return (
		<figure className="min-w-0" data-lo-inline-ui="heatmap">
			<ChartHeader
				title={value.title}
				titleId={titleId}
				end={legend || undefined}
			/>
			<ChartRoot
				rootRef={rootRef}
				titleId={titleId}
				describedById={dataId}
				keys={marks.rootProps}
				// Row pitch 28 wide / 24 narrow; the wide pitch is reserved until
				// the first measurement, so a narrow chart may only shrink once.
				style={{
					height: layout ? layout.svgHeight : rowCount * 28 + BOTTOM,
				}}
			>
				{layout && (
					<svg
						aria-hidden="true"
						width={width}
						height={layout.svgHeight}
						viewBox={`0 0 ${width} ${layout.svgHeight}`}
						className="block select-none"
						onPointerMove={(event) =>
							marks.point(locate(event), event.pointerType)
						}
						onPointerDown={(event) =>
							event.pointerType === "touch" &&
							marks.point(locate(event), "touch", true)
						}
						onPointerLeave={marks.leave}
					>
						<defs>
							{/* Missing values: a 45 degree hatch of hairline-strong,
							    1px every 4px, and no fill. */}
							<pattern
								id={hatchId}
								patternUnits="userSpaceOnUse"
								width="4"
								height="4"
								patternTransform="rotate(45)"
							>
								<line
									x1="0"
									y1="0"
									x2="0"
									y2="4"
									strokeWidth="1"
									className="stroke-hairline-strong"
								/>
							</pattern>
						</defs>
						{layout.rowLabels.map((label, row) => (
							<text
								key={`row-${row}-${label}`}
								x={layout.x0 - 8}
								y={row * layout.pitch + (layout.pitch - CELL_GAP) / 2}
								textAnchor="end"
								dominantBaseline="middle"
								className={cn("fill-ink-muted text-meta", DIM_TRANSITION)}
								opacity={active && active.series !== row ? DIM : 1}
							>
								{label}
							</text>
						))}
						{layout.columnLabels.map(({ column, text }) => (
							<text
								key={`column-${column}`}
								x={layout.x0 + (column + 0.5) * layout.slot}
								y={layout.plotHeight + 16}
								textAnchor="middle"
								className={cn("fill-ink-muted text-meta", DIM_TRANSITION)}
								opacity={active && active.category !== column ? DIM : 1}
							>
								{text}
							</text>
						))}
						<g className={ENTER}>
							{value.rows.map((cells, row) =>
								cells.map((cell, column) => {
									const isActive =
										active?.series === row && active.category === column;
									return (
										<rect
											// biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
											key={`cell-${row}-${column}`}
											x={layout.x0 + column * layout.slot + CELL_GAP / 2}
											y={row * layout.pitch}
											width={Math.max(0, layout.slot - CELL_GAP)}
											height={layout.pitch - CELL_GAP}
											rx={CELL_RADIUS}
											className={DIM_TRANSITION}
											fill={cell === null ? `url(#${hatchId})` : undefined}
											style={
												cell !== null && domain
													? { fill: heatFill(domain.fraction(cell)) }
													: undefined
											}
											opacity={active && !isActive ? DIM : 1}
										/>
									);
								}),
							)}
						</g>
					</svg>
				)}
				{readout && (
					<ChartTooltip
						anchor={readout.anchor}
						width={width}
						heading={readout.heading}
						rows={readout.rows}
					/>
				)}
				<LiveRegion text={readout?.text ?? ""} />
			</ChartRoot>
			<ChartData
				describedById={dataId}
				columns={[
					{ label: value.unit ?? "" },
					...value.columns.map((label) => ({ label, numeric: true })),
				]}
				rows={value.rows.map((cells, row) => [
					value.rowLabels[row],
					...cells.map((cell) => (cell === null ? "—" : numbers.exact(cell))),
				])}
			/>
		</figure>
	);
}
