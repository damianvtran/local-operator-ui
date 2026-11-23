import { useI18nLocale } from "@shared/i18n/use-locale";
import { memo, useId } from "react";
import { InlineSeriesChart } from "./inline-series-chart";
import type { CategoryChart, InlineUi, Scatter } from "./inline-ui-parts";

type Table = Extract<InlineUi, { columns: string[] }>;

function scale(values: number[]) {
	// Scale before subtracting so large finite values cannot overflow the domain.
	const magnitude = Math.max(...values.map(Math.abs)) || 1;
	const min = Math.min(...values);
	const max = Math.max(...values);
	const low = min / magnitude;
	const span = max / magnitude - low;
	return {
		min,
		max,
		fraction: (value: number) =>
			span === 0 ? 0.5 : (value / magnitude - low) / span,
	};
}

function InlineChart({ value }: { value: CategoryChart }) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const values = value.data.map(([, amount]) => amount);
	// Scale before subtracting so a finite model value cannot produce an
	// infinite domain (e.g. a range from -1e308 to 1e308).
	const magnitude = Math.max(...values.map(Math.abs)) || 1;
	const scaled = values.map((amount) => amount / magnitude);
	const low = Math.min(0, ...scaled);
	const high = Math.max(0, ...scaled);
	const position = (amount: number) =>
		((amount - low) / (high - low || 1)) * 100;
	const zero = position(0);
	const chartPoints = scaled.map((amount, index) => ({
		x: scaled.length === 1 ? 50 : 3 + (index / (scaled.length - 1)) * 94,
		y: 92 - position(amount) * 0.84,
	}));
	return (
		<figure
			className="min-w-0 border-hairline border-t pt-3"
			data-lo-inline-ui={value.type}
		>
			<figcaption className="mb-3 wrap-anywhere font-semibold text-ink">
				{value.title}
				{value.unit && (
					<span className="ms-2 font-normal text-ink-muted text-meta">
						{value.unit}
					</span>
				)}
			</figcaption>
			{value.type === "histogram" && (
				<div aria-hidden="true" className="mb-3 border-hairline border-b">
					<svg
						aria-hidden="true"
						className="block h-24 w-full fill-accent"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
					>
						{Array.from(scaled.entries(), ([index, amount]) => {
							const width = 100 / scaled.length;
							const height = position(amount);
							return (
								<rect
									key={`bin-${index}`}
									x={index * width}
									y={100 - height}
									width={width}
									height={height}
									className="stroke-canvas"
									strokeWidth="1"
									vectorEffect="non-scaling-stroke"
								/>
							);
						})}
					</svg>
				</div>
			)}
			{value.type === "line" && (
				<div aria-hidden="true" className="mb-3">
					<div className="relative">
						<svg
							aria-hidden="true"
							className="block h-24 w-full text-accent"
							viewBox="0 0 100 100"
							preserveAspectRatio="none"
						>
							<line
								className="stroke-hairline"
								x1="0"
								x2="100"
								y1={92 - zero * 0.84}
								y2={92 - zero * 0.84}
								vectorEffect="non-scaling-stroke"
							/>
							<polyline
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinejoin="round"
								strokeLinecap="round"
								vectorEffect="non-scaling-stroke"
								points={chartPoints.map(({ x, y }) => `${x},${y}`).join(" ")}
							/>
							{chartPoints.map(({ x, y }) => (
								<line
									key={x}
									x1={x}
									x2={x}
									y1={y}
									y2={y + 0.01}
									stroke="currentColor"
									strokeWidth="5"
									strokeLinecap="round"
									vectorEffect="non-scaling-stroke"
								/>
							))}
						</svg>
						{low < 0 && high > 0 && (
							<span
								className="absolute end-0 -translate-y-1/2 ps-1 text-ink-muted text-meta tabular-nums"
								style={{ top: `${92 - zero * 0.84}%` }}
							>
								{number.format(0)}
							</span>
						)}
					</div>
					<div
						dir="ltr"
						className="grid grid-cols-2 gap-2 text-ink-muted text-meta"
					>
						<bdi className="min-w-0 wrap-anywhere">{value.data[0][0]}</bdi>
						{value.data.length > 1 && (
							<bdi className="min-w-0 wrap-anywhere text-end">
								{value.data[value.data.length - 1][0]}
							</bdi>
						)}
					</div>
				</div>
			)}
			<dl className="m-0 grid gap-2 text-meta">
				{Array.from(value.data.entries(), ([index, [label, amount]]) => {
					const end = position(scaled[index]);
					return (
						<div
							key={`point-${index}`}
							className="grid min-w-0 grid-cols-2 gap-x-2 gap-y-1"
						>
							<dt className="min-w-0 wrap-anywhere text-ink-muted">{label}</dt>
							<dd className="m-0 min-w-0 wrap-anywhere text-end text-ink tabular-nums">
								{number.format(amount)}
							</dd>
							{value.type === "bar" && (
								<div
									aria-hidden="true"
									className="relative col-span-2 h-2 rounded-sm bg-hairline"
									dir="ltr"
								>
									<span
										className="absolute inset-y-0 rounded-sm bg-accent"
										style={{
											left: `${Math.min(zero, end)}%`,
											width: `${Math.abs(end - zero)}%`,
										}}
									/>
								</div>
							)}
						</div>
					);
				})}
			</dl>
		</figure>
	);
}

function accentFill(strength: number) {
	return `color-mix(in srgb, var(--color-accent) ${strength}%, var(--color-canvas))`; // i18n: ignore generated CSS color, not display copy.
}

function InlinePie({ value }: { value: CategoryChart }) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const percent = new Intl.NumberFormat(locale, {
		style: "percent",
		maximumSignificantDigits: 3,
	});
	// Normalization keeps the total finite even when each input is near MAX_VALUE.
	const max = Math.max(...value.data.map(([, amount]) => amount));
	const weights = value.data.map(([, amount]) => amount / max);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	let cursor = 0;
	const slices = Array.from(
		value.data.entries(),
		([index, [label, amount]]) => {
			const share = weights[index] / total;
			const start = cursor;
			const end = index === weights.length - 1 ? 1 : Math.min(1, start + share);
			cursor = end;
			const angle = Math.PI * (start + end);
			return {
				label,
				amount,
				share,
				start,
				end,
				color: accentFill([100, 46, 78, 25][index % 4]),
				x: 50 + 33 * Math.sin(angle),
				y: 50 - 33 * Math.cos(angle),
			};
		},
	);
	const background = slices
		.map(({ color, start, end }) => `${color} ${start * 100}% ${end * 100}%`)
		.join(", ");
	return (
		<figure
			className="min-w-0 border-hairline border-t pt-3"
			data-lo-inline-ui="pie"
		>
			<figcaption className="mb-3 wrap-anywhere font-semibold text-ink">
				{value.title}
				{value.unit && (
					<span className="ms-2 font-normal text-ink-muted text-meta">
						{value.unit}
					</span>
				)}
			</figcaption>
			<div className="grid min-w-0 items-center gap-4 @min-[24rem]/chatcol:grid-cols-[auto_minmax(0,1fr)]">
				<div
					aria-hidden="true"
					className="relative aspect-square w-36 max-w-full justify-self-center rounded-full border border-hairline"
					style={{
						background:
							slices.length === 1
								? slices[0].color
								: `conic-gradient(${background})`,
					}}
				>
					{Array.from(slices.entries(), ([index, { share, x, y }]) =>
						// A badge belongs inside its wedge; smaller slices remain in the legend.
						share < 0.08 ? null : (
							<span
								key={`marker-${index}`}
								className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink px-1.5 text-canvas text-meta tabular-nums"
								style={{
									left: `${share === 1 ? 50 : x}%`,
									top: `${share === 1 ? 50 : y}%`,
								}}
							>
								{number.format(index + 1)}
							</span>
						),
					)}
				</div>
				<dl className="m-0 grid min-w-0 gap-2 text-meta">
					{Array.from(
						slices.entries(),
						([index, { label, amount, share, color }]) => (
							<div
								key={`slice-${index}`}
								className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-2"
							>
								<dt className="flex min-w-0 items-baseline gap-2 text-ink-muted">
									<span
										aria-hidden="true"
										className="size-2 shrink-0 self-center rounded-full"
										style={{ backgroundColor: color }}
									/>
									<span aria-hidden="true" className="shrink-0 tabular-nums">
										{number.format(index + 1)}
									</span>
									<bdi className="min-w-0 wrap-anywhere">{label}</bdi>
								</dt>
								<dd className="m-0 min-w-0 wrap-anywhere text-end text-ink tabular-nums">
									{number.format(amount)}{" "}
									<span className="text-ink-muted">
										({percent.format(share)})
									</span>
								</dd>
							</div>
						),
					)}
				</dl>
			</div>
		</figure>
	);
}

function InlineScatter({ value }: { value: Scatter }) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const x = scale(value.data.map(([amount]) => amount));
	const y = scale(value.data.map(([, amount]) => amount));
	const titleId = useId();
	return (
		<figure
			className="min-w-0 border-hairline border-t pt-3"
			data-lo-inline-ui="scatter"
		>
			<figcaption
				id={titleId}
				className="mb-3 wrap-anywhere font-semibold text-ink"
			>
				{value.title}
			</figcaption>
			<div
				aria-hidden="true"
				className="mb-3 text-ink-muted text-meta tabular-nums"
			>
				<div className="mb-1 wrap-anywhere font-medium">{value.yLabel}</div>
				<div
					dir="ltr"
					className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2"
				>
					<div className="flex max-w-24 flex-col justify-between gap-2 text-end">
						<bdi className="wrap-anywhere">{number.format(y.max)}</bdi>
						{y.min !== y.max && (
							<bdi className="wrap-anywhere">{number.format(y.min)}</bdi>
						)}
					</div>
					<svg
						aria-hidden="true"
						className="block h-28 w-full border-hairline border-b border-l stroke-accent"
						viewBox="0 0 100 100"
						preserveAspectRatio="none"
					>
						{Array.from(value.data.entries(), ([index, [first, second]]) => {
							const px = 3 + x.fraction(first) * 94;
							const py = 97 - y.fraction(second) * 94;
							return (
								<line
									key={`point-${index}`}
									x1={px}
									x2={px}
									y1={py}
									y2={py + 0.01}
									strokeWidth="6"
									strokeLinecap="round"
									vectorEffect="non-scaling-stroke"
								/>
							);
						})}
					</svg>
					<div className="col-start-2 flex min-w-0 justify-between gap-2 pt-1">
						<bdi className="min-w-0 wrap-anywhere">{number.format(x.min)}</bdi>
						{x.min !== x.max && (
							<bdi className="min-w-0 wrap-anywhere text-end">
								{number.format(x.max)}
							</bdi>
						)}
					</div>
				</div>
				<div className="mt-1 wrap-anywhere text-end font-medium">
					{value.xLabel}
				</div>
			</div>
			<InlineDataGrid
				titleId={titleId}
				columns={[value.xLabel, value.yLabel]}
				rows={value.data}
			/>
		</figure>
	);
}

function InlineDataGrid({
	titleId,
	columns,
	rows,
	rowLabels,
	sheet,
	heat,
}: {
	titleId: string;
	columns: string[];
	rows: (string | number | null)[][];
	rowLabels?: string[];
	sheet?: boolean;
	heat?: ReturnType<typeof scale>;
}) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const hasRowHeader = rowLabels !== undefined || sheet;
	return (
		// Wide data stays in the figure, not the transcript's horizontal scroll.
		<section
			aria-labelledby={titleId}
			// biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to scroll wide tables.
			tabIndex={0}
			className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
		>
			<table aria-labelledby={titleId} className="w-full text-start text-meta">
				<thead className="border-hairline border-b text-ink-muted">
					<tr className={sheet ? "divide-x divide-hairline" : undefined}>
						{hasRowHeader && <td aria-hidden="true" />}
						{Array.from(columns.entries(), ([index, column]) => (
							<th
								key={`column-${index}`}
								scope="col"
								className="min-w-16 whitespace-nowrap px-2 py-1.5 text-start font-medium"
							>
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="divide-y divide-hairline text-ink">
					{Array.from(rows.entries(), ([index, row]) => (
						<tr
							key={`row-${index}`}
							className={hasRowHeader ? "divide-x divide-hairline" : undefined}
						>
							{hasRowHeader && (
								<th
									scope="row"
									className="whitespace-nowrap px-2 py-1.5 text-start font-medium text-ink-muted"
								>
									{rowLabels ? rowLabels[index] : number.format(index + 1)}
								</th>
							)}
							{Array.from(row.entries(), ([position, cell]) => {
								const numeric = typeof cell === "number";
								const fill =
									heat && numeric
										? accentFill(12 + 68 * heat.fraction(cell))
										: undefined;
								return (
									<td
										key={`cell-${position}`}
										className={
											numeric
												? "whitespace-nowrap px-2 py-1.5 text-end align-top tabular-nums"
												: "min-w-16 wrap-anywhere whitespace-pre-wrap px-2 py-1.5 align-top"
										}
									>
										{/* Never put exact values on a tint whose ink contrast varies. */}
										{fill && (
											<span
												aria-hidden="true"
												className="me-2 inline-block size-2 rounded-sm"
												style={{ backgroundColor: fill }}
											/>
										)}
										{numeric ? number.format(cell) : (cell ?? "—")}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}

function InlineTable({ value }: { value: Table }) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const titleId = useId();
	const amounts =
		value.type === "heatmap"
			? value.rows.flat().filter((cell) => cell !== null)
			: [];
	const heat = amounts.length ? scale(amounts) : undefined;
	return (
		<figure
			className="min-w-0 border-hairline border-t pt-3"
			data-lo-inline-ui={value.type}
		>
			<figcaption
				id={titleId}
				className="mb-3 wrap-anywhere font-semibold text-ink"
			>
				{value.title}
				{value.type === "heatmap" && value.unit && (
					<span className="ms-2 font-normal text-ink-muted text-meta">
						{value.unit}
					</span>
				)}
			</figcaption>
			{heat && heat.min !== heat.max && (
				<div
					className="mb-3 flex flex-wrap items-center gap-2 text-ink-muted text-meta tabular-nums"
					dir="ltr"
				>
					<bdi className="wrap-anywhere">{number.format(heat.min)}</bdi>
					<span
						aria-hidden="true"
						className="h-2 w-16 rounded-sm border border-hairline"
						style={{
							background: `linear-gradient(90deg, ${accentFill(12)}, ${accentFill(80)})`,
						}}
					/>
					<bdi className="wrap-anywhere">{number.format(heat.max)}</bdi>
				</div>
			)}
			<InlineDataGrid
				titleId={titleId}
				columns={value.columns}
				rows={value.rows}
				rowLabels={value.type === "heatmap" ? value.rowLabels : undefined}
				sheet={value.type === "spreadsheet"}
				heat={heat}
			/>
		</figure>
	);
}

export const InlineUiHost = memo(function InlineUiHost({
	value,
}: { value: InlineUi }) {
	switch (value.type) {
		case "bar":
		case "line":
		case "histogram":
			return <InlineChart value={value} />;
		case "pie":
			return <InlinePie value={value} />;
		case "scatter":
			return <InlineScatter value={value} />;
		case "series":
			return <InlineSeriesChart value={value} />;
		case "heatmap":
		case "spreadsheet":
		case "table":
			return <InlineTable value={value} />;
		default: {
			const exhaustive: never = value;
			return exhaustive;
		}
	}
});
