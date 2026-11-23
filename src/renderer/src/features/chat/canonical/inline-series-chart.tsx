import { useI18nLocale } from "@shared/i18n/use-locale";
import { useId, useMemo } from "react";
import type { InlineSeries } from "./inline-series";

const WIDTH = 320;
const HEIGHT = 128;
const y = (fraction: number) => 4 + (1 - fraction) * (HEIGHT - 8);
const SERIES_STYLES = [
	{ ink: "text-accent", dash: undefined, hatch: "" },
	{ ink: "text-ink-dim", dash: "7 3", hatch: "M0 8L8 0" },
	{ ink: "text-ink", dash: "2 3", hatch: "M0 3H8" },
	{ ink: "text-ink-muted", dash: "7 3 2 3", hatch: "M0 8L8 0M0 0L8 8" },
];

function categoryShares(amounts: number[]) {
	// The decoder guarantees a positive category. Normalize before adding
	// so very large inputs cannot overflow and tiny totals are still valid.
	const peak = Math.max(...amounts);
	const scaled = amounts.map((amount) => amount / peak);
	const total = scaled.reduce((sum, n) => sum + n, 0);
	return scaled.map((amount) => amount / total);
}

function barLayout(value: InlineSeries) {
	const { series, labels, mode } = value;
	const amounts = series.flatMap(({ values }) => values);
	const magnitude = Math.max(...amounts.map(Math.abs)) || 1;
	const step = WIDTH / labels.length;
	const groupWidth = step * 0.76;
	const width = mode === "grouped" ? groupWidth / series.length : groupWidth;
	let low = 0;
	let high = mode === "percent" ? 1 : 0;
	const bars = labels.flatMap((_, category) => {
		const amounts = series.map(({ values }) => values[category]);
		// A common scale for signed modes keeps stack totals finite.
		const scaled =
			mode === "percent"
				? categoryShares(amounts)
				: amounts.map((amount) => amount / magnitude);
		let positive = 0;
		let negative = 0;
		return scaled.map((n, index) => {
			const start = mode === "grouped" ? 0 : n < 0 ? negative : positive;
			const end = start + n;
			if (n < 0) negative = end;
			else positive = end;
			low = Math.min(low, end);
			if (mode !== "percent") high = Math.max(high, end);
			const groupStart = step * category + (step - groupWidth) / 2;
			const x = mode === "grouped" ? groupStart + width * index : groupStart;
			return { category, index, x, start, end };
		});
	});
	const project = (n: number) => y((n - low) / (high - low || 1));
	return { bars, project, width: mode === "grouped" ? width * 0.88 : width };
}

function BarPlot({
	value,
	id,
	zeroLabel,
}: { value: InlineSeries; id: string; zeroLabel: string }) {
	const { bars, project, width } = barLayout(value);
	const zero = project(0);
	return (
		<div aria-hidden="true" className="relative pl-8" dir="ltr">
			<svg
				aria-hidden="true"
				className="block h-32 w-full"
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				preserveAspectRatio="none"
			>
				<defs>
					{SERIES_STYLES.slice(1).map(({ ink, hatch }) => (
						<pattern
							key={ink}
							id={`${id}-${ink}`}
							className={ink}
							patternUnits="userSpaceOnUse"
							width="8"
							height="8"
						>
							<rect
								width="8"
								height="8"
								fill="currentColor"
								fillOpacity="0.32"
							/>
							<path
								d={hatch}
								stroke="currentColor"
								strokeWidth="2"
								fill="none"
							/>
						</pattern>
					))}
				</defs>
				{bars.map(({ category, index, x, start, end }) => {
					const { ink, hatch } = SERIES_STYLES[index];
					return (
						<rect
							key={`${category}-${index}`}
							className={ink}
							x={x}
							y={Math.min(project(start), project(end))}
							width={width}
							height={Math.abs(project(start) - project(end))}
							fill={hatch ? `url(#${id}-${ink})` : "currentColor"}
						/>
					);
				})}
				<line
					className="stroke-ink-muted"
					x1={0}
					x2={WIDTH}
					y1={zero}
					y2={zero}
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<span
				className="absolute left-0 -translate-y-1/2 pe-1 text-ink-muted text-meta tabular-nums"
				style={{ top: `${(zero / HEIGHT) * 100}%` }}
			>
				{zeroLabel}
			</span>
		</div>
	);
}

function axisScale(series: InlineSeries["series"], axis: "left" | "right") {
	const values = series
		.filter((entry) => entry.axis === axis)
		.flatMap(({ values }) => values);
	const low = Math.min(...values);
	const high = Math.max(...values);
	return {
		low,
		high,
		project(n: number) {
			if (high === low) return y(0.5);
			if (Number.isFinite(high - low)) return y((n - low) / (high - low));
			return y((n / 2 - low / 2) / (high / 2 - low / 2));
		},
	};
}

type Format = (n: number) => string;

function DualPlot({ value, format }: { value: InlineSeries; format: Format }) {
	const scales = {
		left: axisScale(value.series, "left"),
		right: axisScale(value.series, "right"),
	};
	return (
		<div dir="ltr">
			<div className="grid grid-cols-2 gap-2 text-ink-muted text-meta tabular-nums">
				<span className="min-w-0 wrap-anywhere">
					← <bdi>{value.unit}</bdi>
					<br />
					{format(scales.left.high)}
				</span>
				<span className="min-w-0 wrap-anywhere text-end">
					<bdi>{value.rightUnit}</bdi> →<br />
					{format(scales.right.high)}
				</span>
			</div>
			<svg
				aria-hidden="true"
				className="block h-32 w-full border-hairline border-x"
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
				preserveAspectRatio="none"
			>
				{[0, 0.5, 1].map((tick) => (
					<line
						key={tick}
						className="stroke-hairline"
						x1={0}
						x2={WIDTH}
						y1={y(tick)}
						y2={y(tick)}
						vectorEffect="non-scaling-stroke"
					/>
				))}
				{value.series.map(({ values, axis }, index) => {
					const { ink, dash } = SERIES_STYLES[index];
					const points = values.map((amount, category) => ({
						x: (WIDTH * (category + 0.5)) / values.length,
						y: scales[axis === "right" ? "right" : "left"].project(amount),
					}));
					return (
						<g
							key={ink}
							className={ink}
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<polyline
								points={points.map(({ x, y }) => `${x},${y}`).join(" ")}
								fill="none"
								strokeDasharray={dash}
								vectorEffect="non-scaling-stroke"
							/>
							{points.map(({ x, y }) => (
								<line
									key={x}
									x1={x}
									x2={x}
									y1={y}
									y2={y + 0.01}
									strokeWidth="4"
									vectorEffect="non-scaling-stroke"
								/>
							))}
						</g>
					);
				})}
			</svg>
			<div className="grid grid-cols-2 gap-2 text-ink-muted text-meta tabular-nums">
				<span className="min-w-0 wrap-anywhere">{format(scales.left.low)}</span>
				<span className="min-w-0 wrap-anywhere text-end">
					{format(scales.right.low)}
				</span>
			</div>
		</div>
	);
}

function AxisUnit({
	axis,
	value,
}: { axis: "left" | "right" | undefined; value: InlineSeries }) {
	return (
		<span dir="ltr" className="block font-normal">
			{axis === "right" ? (
				<>
					<bdi>{value.rightUnit}</bdi> →
				</>
			) : (
				<>
					← <bdi>{value.unit}</bdi>
				</>
			)}
		</span>
	);
}

export function InlineSeriesChart({ value }: { value: InlineSeries }) {
	const id = useId();
	const locale = useI18nLocale();
	const { format, percent } = useMemo(() => {
		const decimal = new Intl.NumberFormat(locale, {
			maximumSignificantDigits: 21,
		});
		const scientific = new Intl.NumberFormat(locale, {
			notation: "scientific",
			maximumSignificantDigits: 21,
		});
		const percent = new Intl.NumberFormat(locale, {
			style: "percent",
			maximumSignificantDigits: 6,
		});
		return {
			format: (n: number) => {
				const magnitude = Math.abs(n);
				return (
					magnitude >= 1e9 || (magnitude > 0 && magnitude < 1e-4)
						? scientific
						: decimal
				).format(n);
			},
			percent,
		};
	}, [locale]);
	const { labels, mode, series } = value;
	return (
		<figure
			className="@container/series min-w-0 border-hairline border-t pt-3"
			data-lo-inline-ui="series"
			data-series-mode={mode}
		>
			<figcaption
				id={`${id}-title`}
				className="mb-3 wrap-anywhere font-semibold text-ink"
			>
				{value.title}
				{mode !== "dual" && value.unit && (
					<>
						{" "}
						<span className="ms-2 font-normal text-ink-muted text-meta">
							<bdi>{value.unit}</bdi>
						</span>
					</>
				)}
			</figcaption>
			{mode === "dual" ? (
				<DualPlot value={value} format={format} />
			) : (
				<>
					{mode === "percent" && (
						<div
							aria-hidden="true"
							className="text-ink-muted text-meta"
							dir="ltr"
						>
							{percent.format(1)}
						</div>
					)}
					<BarPlot
						value={value}
						id={id}
						zeroLabel={mode === "percent" ? percent.format(0) : format(0)}
					/>
				</>
			)}
			<div
				aria-hidden="true"
				dir="ltr"
				className={`mt-1 flex gap-2 text-ink-muted text-meta ${mode !== "dual" ? "pl-8" : ""} ${labels.length <= 4 ? "@min-[20rem]/series:hidden" : ""}`}
			>
				<bdi
					title={labels[0]}
					className={`min-w-0 flex-1 truncate ${labels.length === 1 ? "text-center" : ""}`}
				>
					{labels[0]}
				</bdi>
				{labels.length > 1 && (
					<bdi
						title={labels[labels.length - 1]}
						className="min-w-0 flex-1 truncate text-end"
					>
						{labels[labels.length - 1]}
					</bdi>
				)}
			</div>
			{labels.length <= 4 && (
				<div
					aria-hidden="true"
					dir="ltr"
					className={`mt-1 hidden text-ink-muted text-meta @min-[20rem]/series:flex ${mode !== "dual" ? "pl-8" : ""}`}
				>
					{labels.map((label, index) => (
						<bdi
							title={label}
							key={`${index}-${label}`}
							className="min-w-0 flex-1 truncate px-0.5 text-center"
						>
							{label}
						</bdi>
					))}
				</div>
			)}
			{/* The key belongs to the plot, not the horizontally scrolling values. */}
			<div
				aria-hidden="true"
				className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-ink-muted text-meta"
			>
				{series.map(({ label, axis }, index) => {
					const { ink, dash, hatch } = SERIES_STYLES[index];
					return (
						<div key={ink} className="flex min-w-0 items-start gap-2">
							<svg
								aria-hidden="true"
								width="24"
								height="10"
								viewBox="0 0 24 10"
								className={`mt-1 shrink-0 ${ink}`}
							>
								{mode === "dual" ? (
									<path
										d="M0 5H24"
										stroke="currentColor"
										strokeWidth="2"
										strokeDasharray={dash}
									/>
								) : (
									<rect
										width="24"
										height="10"
										fill={hatch ? `url(#${id}-${ink})` : "currentColor"}
									/>
								)}
							</svg>
							<div className="min-w-0 wrap-anywhere">
								<bdi className="font-medium">{label}</bdi>
								{mode === "dual" && <AxisUnit axis={axis} value={value} />}
							</div>
						</div>
					);
				})}
			</div>
			<section
				aria-labelledby={`${id}-title`}
				className="mt-3 max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
			>
				<table className="w-full min-w-max text-meta tabular-nums">
					<thead>
						<tr className="align-top text-ink-muted">
							<td />
							{series.map(({ label, axis }, index) => (
								<th
									key={SERIES_STYLES[index].ink}
									scope="col"
									className="min-w-20 whitespace-nowrap px-2 pb-1 text-start font-medium"
								>
									<bdi>{label}</bdi>
									{mode === "dual" && <AxisUnit axis={axis} value={value} />}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{labels.map((label, category) => {
							const shares =
								mode === "percent"
									? categoryShares(series.map(({ values }) => values[category]))
									: null;
							return (
								<tr
									key={`${category}-${label}`}
									className="border-hairline border-t align-top"
								>
									<th
										scope="row"
										className="min-w-20 whitespace-nowrap py-1 pe-2 text-start font-normal text-ink-muted"
									>
										<bdi>{label}</bdi>
									</th>
									{series.map(({ values }, index) => (
										<td
											key={SERIES_STYLES[index].ink}
											className="whitespace-nowrap px-2 py-1 text-ink"
										>
											{shares && (
												<bdi className="block">
													{percent.format(shares[index])}
												</bdi>
											)}
											<bdi className={shares ? "text-ink-muted" : undefined}>
												{format(values[category])}
												{shares && value.unit ? ` ${value.unit}` : ""}
											</bdi>
										</td>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
			</section>
		</figure>
	);
}
