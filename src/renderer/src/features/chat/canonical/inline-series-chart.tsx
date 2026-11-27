import { InlineCartesianChart } from "./inline-cartesian-chart";
import type { InlineSeries } from "./inline-series";

/**
 * `series` in every mode is a cartesian chart with up to four series: the
 * grouped/stacked/percent modes draw bars, `dual` draws lines against two
 * axes. The shared renderer owns axes, colour slots and the hover readout, so
 * a multi-series chart reads exactly like a single-series one.
 */
export function InlineSeriesChart({ value }: { value: InlineSeries }) {
	return (
		<InlineCartesianChart
			value={{
				type: "series",
				mode: value.mode,
				title: value.title,
				unit: value.unit,
				rightUnit: value.rightUnit,
				labels: value.labels,
				series: value.series,
			}}
		/>
	);
}
