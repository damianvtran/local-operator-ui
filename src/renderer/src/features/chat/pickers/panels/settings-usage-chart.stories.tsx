/**
 * The settings usage chart's FRAME, over a fixture.
 *
 * The live settings surface cannot be photographed in an isolated store: its
 * usage rollup needs a signed-in Radient tenant, so a capture of
 * `shell-app-shell--settings` is BLOCKED rather than merely slow (QA round 1).
 * What CAN be shown is the thing § 15.5 changed — the chart's frame — rendering
 * the same production `ChartFrame` the settings page passes its data into, over
 * a settings-shaped fixture: thirty day buckets, the shared day formatter (so
 * `Sep 7` here and on the panels is one spelling), and the settings page's own
 * "Usage (last 30 days)" heading with its metric control beside it.
 *
 * It is titled under `panels-settings` so this PR's own capture set carries it
 * (`--only=panels-`), which is why it lives beside the panels rather than in a
 * settings story file of its own.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { formatDayBucket } from "@features/chat/pickers/panels/formatters";
import { ChartFrame } from "@features/chat/pickers/panels/primitives/chart-frame";
import { format, parseISO, subDays } from "date-fns";
import { Line, LineChart } from "recharts";
import "../../../../styles/index.css";

/** Thirty days of a plausible rollup, ending today. */
const series = (metric: "tokens" | "credits") =>
	Array.from({ length: 30 }, (_, index) => {
		const day = subDays(new Date("2026-09-14T12:00:00Z"), 29 - index);
		const wave = Math.max(0, Math.sin(index / 3.1) * 0.6 + 0.5);
		return {
			bucket: formatDayBucket(format(day, "yyyy-MM-dd")),
			value:
				metric === "tokens"
					? Math.round(120_000 + wave * 1_480_000)
					: Number((0.4 + wave * 12.6).toFixed(2)),
		};
	});

const Chart = ({ metric }: { metric: "tokens" | "credits" }) => (
	<div className="bg-canvas p-6">
		<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<h3 className="text-heading text-ink">Usage (last 30 days)</h3>
			<fieldset className="m-0 w-fit border-0 p-0">
				<legend className="sr-only">Usage metric</legend>
				<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
					<span
						className={
							metric === "tokens"
								? "rounded-sm bg-surface px-2 text-body-sm text-ink"
								: "px-2 text-body-sm text-ink-muted"
						}
					>
						Tokens
					</span>
					<span
						className={
							metric === "credits"
								? "rounded-sm bg-surface px-2 text-body-sm text-ink"
								: "px-2 text-body-sm text-ink-muted"
						}
					>
						Credits
					</span>
				</div>
			</fieldset>
		</div>
		<ChartFrame
			title=""
			xTickFormatter={(bucket) => bucket}
			yTickFormatter={
				metric === "tokens"
					? (value) => `${Math.round(value / 1000)}k`
					: (value) => `$${value.toFixed(2)}`
			}
			srSummary={`Usage over the last 30 days: ${series(metric)
				.map((point) => `${point.bucket} ${point.value}`)
				.join(", ")}.`}
		>
			<LineChart data={series(metric)}>
				<Line type="monotone" dataKey="value" dot={false} strokeWidth={2} />
			</LineChart>
		</ChartFrame>
	</div>
);

const meta: Meta<typeof Chart> = {
	title: "panels-settings",
	component: Chart,
	parameters: { layout: "fullscreen" },
};
export default meta;

export const UsageChartTokens: StoryObj<typeof Chart> = {
	args: { metric: "tokens" },
};

export const UsageChartCredits: StoryObj<typeof Chart> = {
	args: { metric: "credits" },
};
