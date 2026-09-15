import { formatTokens } from "@features/chat/pickers/panels/formatters";
import { ChartFrame } from "@features/chat/pickers/panels/primitives/chart-frame";
import { Line, LineChart } from "recharts";

/**
 * The settings page and its isolated story render this exact production chart.
 * The account query stays in the page: a signed-in tenant is not a prerequisite
 * for proving its axis spelling, height, tooltip or mark treatment. Keeping the
 * props here prevents a plausible-looking story from evidencing a different UI.
 */
export function SettingsUsageChart({
	metric,
	data,
}: {
	metric: "credits" | "tokens";
	data: { bucket: string; value: number }[];
}) {
	return (
		<ChartFrame
			title=""
			heightClassName="h-62"
			yAxisWidth={48}
			unit={metric === "credits" ? "credits" : "tokens"}
			srSummary={`${metric === "credits" ? "Credits consumed" : "Tokens used"} over the last 30 days, plotted per day across ${data.length} days.`}
			xTickFormatter={(value) => value}
			yTickFormatter={(value) =>
				metric === "credits" ? `$${value.toFixed(2)}` : formatTokens(value)
			}
		>
			<LineChart data={data}>
				<Line
					type="monotone"
					dataKey="value"
					strokeWidth={2}
					dot={false}
					activeDot={{ r: 4, strokeWidth: 0 }}
					name={metric === "credits" ? "Credits consumed" : "Tokens used"}
				/>
			</LineChart>
		</ChartFrame>
	);
}
