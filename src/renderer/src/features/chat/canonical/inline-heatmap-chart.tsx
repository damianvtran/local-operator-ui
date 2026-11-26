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
	planXLabels,
	truncateToWidth,
	withUnit,
} from "./inline-chart-model";
import type { Heatmap } from "./inline-ui-parts";

const CELL_GAP = 2;
const CELL_RADIUS = 3;
const BOTTOM = 24;

/**
 * The ramp's low end: the accent's share of the mix at the domain minimum.
 *
 * WHY 28, NOT THE SPEC'S 12. The mix base is `surface`, which window glass
 * does not paint, so at 12% a 0 cell measured 1.02:1 against the rendered
 * dark glass ground: "0 tickets" read as empty ground and as "No data"
 * (design review D3, decision X10). At 28% the 0 cell is at least 1.39:1
 * against canvas, surface, message and the glass ground in localOperatorDark,
 * localOperatorLight, highContrastLight and dracula, and carries the accent's
 * hue, while the ramp still spans 28-100 as the spec's linear map.
 */
export const HEAT_FLOOR = 28;

/** The sequential fill at `fraction`: `t = 28 + 72 x fraction` (see HEAT_FLOOR). */
export function heatFill(fraction: number) {
	const strength =
		Math.round((HEAT_FLOOR + (100 - HEAT_FLOOR) * fraction) * 10) / 10;
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
		/* Column labels, planned on their real boxes (planXLabels). Inner
		   columns centre on their cell; the first and last anchor at the plot's
		   outer cell edges (start / end), the way line charts anchor theirs.
		   WHY: a centred edge label only has room for one slot inside the
		   chart, so on a dense heatmap (24 hourly columns) the last label
		   truncated to a bare `…` (code review R9, cross-surface C2). Anchored
		   at the edge it gets the whole plot width and the planner thins the
		   inner labels around it instead. A single column stays centred. */
		const last = columns - 1;
		const columnLabels = planXLabels({
			texts: value.columns.map(axisText),
			xs: value.columns.map((_, column) =>
				last > 0 && column === 0
					? x0
					: last > 0 && column === last
						? x0 + columns * slot
						: x0 + (column + 0.5) * slot,
			),
			anchors: value.columns.map((_, column) =>
				last > 0 && column === 0
					? ("start" as const)
					: last > 0 && column === last
						? ("end" as const)
						: ("middle" as const),
			),
			bounds: [0, width],
			measure,
		});
		return {
			pitch,
			x0,
			slot,
			plotHeight: rowCount * pitch,
			svgHeight: rowCount * pitch + BOTTOM,
			rowLabels: value.rowLabels.map((label) =>
				truncateToWidth(label, x0 - 8, measure),
			),
			columnLabels: columnLabels.map(({ index, text, x, anchor }) => ({
				column: index,
				text,
				x,
				anchor,
			})),
		};
	}, [width, font, value.rowLabels, value.columns, columns, rowCount]);

	const locate = (event: ReactPointerEvent<Element>) => {
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

	// Memoised so a hover does not re-render the (memo) tables; review R5.
	const dataColumns = useMemo(
		() => [
			{ label: value.unit ?? "" },
			...value.columns.map((label) => ({ label, numeric: true })),
		],
		[value.unit, value.columns],
	);
	const dataRows = useMemo(
		() =>
			value.rows.map((cells, row) => [
				value.rowLabels[row],
				...cells.map((cell) => (cell === null ? "—" : numbers.exact(cell))),
			]),
		[value.rows, value.rowLabels, numbers],
	);

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
						direction="ltr"
						className="block select-none"
						{...marks.pointerHandlers(locate)}
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
						{layout.columnLabels.map(({ column, text, x, anchor }) => (
							<text
								key={`column-${column}`}
								data-lo-chart-xlabel={column}
								x={x}
								y={layout.plotHeight + 16}
								textAnchor={anchor}
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
						bottom={layout?.plotHeight ?? 0}
						heading={readout.heading}
						rows={readout.rows}
					/>
				)}
				<LiveRegion text={readout?.text ?? ""} />
			</ChartRoot>
			<ChartData describedById={dataId} columns={dataColumns} rows={dataRows} />
		</figure>
	);
}
