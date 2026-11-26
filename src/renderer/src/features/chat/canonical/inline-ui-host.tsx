import { useI18nLocale } from "@shared/i18n/use-locale";
import { memo, useId } from "react";
import { InlineCartesianChart } from "./inline-cartesian-chart";
import { InlineDonutChart } from "./inline-donut-chart";
import { InlineHeatmapChart } from "./inline-heatmap-chart";
import { InlineScatterChart } from "./inline-scatter-chart";
import { InlineSeriesChart } from "./inline-series-chart";
import type { InlineUi } from "./inline-ui-parts";

type Table = Extract<InlineUi, { type: "table" | "spreadsheet" }>;

function InlineDataGrid({
	titleId,
	columns,
	rows,
	sheet,
}: {
	titleId: string;
	columns: string[];
	rows: (string | number | null)[][];
	sheet?: boolean;
}) {
	const locale = useI18nLocale();
	const number = new Intl.NumberFormat(locale, {
		maximumSignificantDigits: 21,
	});
	const hasRowHeader = Boolean(sheet);
	return (
		// As with MarkdownTable, Chromium adds a keyboard stop only when
		// this box actually scrolls. Fitting grids stay out of the tab order.
		<section
			aria-labelledby={titleId}
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
									{number.format(index + 1)}
								</th>
							)}
							{Array.from(row.entries(), ([position, cell]) => {
								const numeric = typeof cell === "number";
								return (
									<td
										key={`cell-${position}`}
										className={
											numeric
												? "whitespace-nowrap px-2 py-1.5 text-end align-top tabular-nums"
												: "min-w-16 wrap-anywhere whitespace-pre-wrap px-2 py-1.5 align-top"
										}
									>
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

/** `table` and `spreadsheet`: exact values, so a grid rather than a chart.
 * Heatmaps moved to their own cell renderer (`inline-heatmap-chart.tsx`). */
function InlineTable({ value }: { value: Table }) {
	const titleId = useId();
	return (
		<figure className="min-w-0" data-lo-inline-ui={value.type}>
			<figcaption
				id={titleId}
				className="mb-2 wrap-anywhere font-semibold text-ink"
			>
				{value.title}
			</figcaption>
			<InlineDataGrid
				titleId={titleId}
				columns={value.columns}
				rows={value.rows}
				sheet={value.type === "spreadsheet"}
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
			return (
				<InlineCartesianChart
					value={{
						type: value.type,
						title: value.title,
						unit: value.unit,
						labels: value.data.map(([label]) => label),
						// One series: the chart's title names it, so the legend
						// and tooltip omit the series label.
						series: [
							{
								label: value.title,
								values: value.data.map(([, amount]) => amount),
							},
						],
					}}
				/>
			);
		case "pie":
			return <InlineDonutChart value={value} />;
		case "scatter":
			return <InlineScatterChart value={value} />;
		case "series":
			return <InlineSeriesChart value={value} />;
		case "heatmap":
			return <InlineHeatmapChart value={value} />;
		case "spreadsheet":
		case "table":
			return <InlineTable value={value} />;
		default: {
			const exhaustive: never = value;
			return exhaustive;
		}
	}
});
