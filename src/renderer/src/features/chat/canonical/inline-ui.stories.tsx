import type { Meta, StoryObj } from "@storybook/react";
import { useRef } from "react";
import { CanonicalTranscript } from "./canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	applyEvent,
	applyHistoryPage,
} from "./transcript-reducer";

// This uses only the negotiated wire shape and production folds: no story
// supplies predecoded figures to the view or interprets a lop-ui fence.
const bar = {
	type: "bar",
	title: "Revenue by region",
	unit: "USD thousands",
	data: [
		["North America", 240],
		["Europe", 180],
		["Asia Pacific", 125],
	],
};
const line = {
	type: "line",
	title: "Month-over-month change",
	unit: "%",
	data: [
		["January", -4],
		["February", 2],
		["March", 1],
		["April", 8],
	],
};
const table = {
	type: "table",
	title: "Regional breakdown",
	columns: ["Region", "Revenue", "Renewals", "New accounts"],
	rows: [
		["North America", 240, 32, 18],
		["Europe", 180, 23, 12],
	],
};
const pie = {
	type: "pie",
	title: "Renewals by plan",
	unit: "accounts",
	data: [
		["Team", 42],
		["Individual", 28],
		["Enterprise", 18],
		["Education", 12],
	],
};
const scatter = {
	type: "scatter",
	title: "Response time by workload",
	xLabel: "Requests per second",
	yLabel: "Response time (ms)",
	data: [
		[8, 29],
		[15, 55],
		[21, 45],
		[28, 72],
		[36, 60],
		[42, 95],
	],
};
const heatmap = {
	type: "heatmap",
	title: "Support queue by shift",
	unit: "tickets",
	columns: ["Morning", "Afternoon", "Evening"],
	rowLabels: ["Monday", "Tuesday", "Wednesday"],
	rows: [
		[3, 18, 7],
		[6, 24, 12],
		[null, 15, 0],
	],
};
const spreadsheet = {
	type: "spreadsheet",
	title: "April reconciliation",
	columns: ["Department", "Budget (USD)", "Actual (USD)", "Reference note"],
	rows: [
		["Operations", 2400, 2312.5, "=SUM(B2:B4)"],
		["Support", 1850, null, "Pending invoice"],
		["Research", 900, 822, "Cleared"],
	],
};
const histogram = {
	type: "histogram",
	title: "Distribution of response times",
	unit: "requests",
	data: [
		["0–24 ms", 3],
		["25–49 ms", 14],
		["50–74 ms", 27],
		["75–99 ms", 8],
		["100–124 ms", 0],
	],
};

const series = {
	type: "series",
	labels: ["January", "February", "March", "April"],
	unit: "USD thousands",
	series: [
		{ label: "Direct", values: [24, 32, 48, 41] },
		{ label: "Partners", values: [35, 26, 21, 32] },
		{ label: "Online", values: [18, 25, 29, 30] },
	],
};
const grouped = { ...series, title: "Sales by channel", mode: "grouped" };
const stacked = {
	...series,
	title: "Monthly cash movements",
	mode: "stacked",
	series: [
		{ label: "Receipts", values: [50, 60, 70, 65] },
		{ label: "Refunds", values: [-12, -9, -18, -11] },
	],
};
const percent = {
	...series,
	title: "Channel mix",
	mode: "percent",
	unit: undefined,
};
const dual = {
	...series,
	title: "Revenue and order activity",
	mode: "dual",
	rightUnit: "orders",
	series: [
		{ label: "Revenue", axis: "left", values: [62, 80, 78, 92] },
		{ label: "Orders", axis: "right", values: [128, 170, 182, 155] },
	],
};
const id = "sample-assistant-row";
const ts = 1_760_000_000_000;
const sample =
	"**North America led the quarter.** Europe followed with 180 thousand dollars.\n\n";
const followup =
	"Compare the regional breakdown before planning next quarter.\n\n";
const example =
	'```lop-ui\n{"type":"bar","title":"Literal example","data":[["North",7]]}\n```';
const scenarios = {
	catalog: [
		sample,
		bar,
		followup,
		table,
		line,
		pie,
		scatter,
		histogram,
		heatmap,
		spreadsheet,
		grouped,
		stacked,
		percent,
		dual,
	],
	compact: [sample, dual, spreadsheet, followup],
	partial: [sample, bar, followup],
	settled: [sample, bar, followup, table],
	legacy: [sample, example],
};

function Fixture({
	scenario,
	width = 704,
	proseOnly = false,
	theme: _theme,
	glass: _glass,
	glassCoverage: _coverage,
}: {
	scenario: keyof typeof scenarios;
	width?: number;
	proseOnly?: boolean;
	// Consumed by Storybook's production-theme/glass decorator.
	theme?: "localOperatorLight" | "localOperatorDark";
	glass?: "on" | "off";
	glassCoverage?: "full" | "sidebars";
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	let text = "";
	const widgets = [];
	for (const part of scenarios[scenario]) {
		if (typeof part === "string") text += part;
		else {
			widgets.push({ offset: text.length, payload: part });
			text += "\n";
		}
	}
	const inline_ui =
		!proseOnly && widgets.length
			? { version: 1, messages: { [id]: { version: 1, text, widgets } } }
			: undefined;
	const content = [{ type: "text", text }];
	const message = { id, role: "assistant", content };
	const transcript =
		scenario === "partial"
			? applyEvent(
					EMPTY_TRANSCRIPT,
					{ type: "message_update", message, delta: "", inline_ui },
					ts,
				)
			: applyHistoryPage(EMPTY_TRANSCRIPT, {
					entries: [{ id, ts: ts / 1000, type: "message", payload: message }],
					has_more: false,
					cursor_missing: false,
					inline_ui,
				});
	return (
		<div className="flex h-screen max-w-full flex-col" style={{ width }}>
			<CanonicalTranscript
				transcript={transcript}
				frontend={null}
				gate={null}
				waiting={false}
				starting={false}
				loadingOlder={false}
				onLoadOlder={async () => true}
				containerRef={containerRef}
				isSmallView={width === 172}
				status="live"
				failure={null}
				awaitingHydration={false}
				onReconnect={() => {}}
			/>
		</div>
	);
}

const meta = {
	title: "Chat/Inline figures",
	component: Fixture,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Catalog: Story = { args: { scenario: "catalog" } };
export const Partial: Story = { args: { scenario: "partial" } };
export const Settled: Story = { args: { scenario: "settled" } };
export const Legacy: Story = { args: { scenario: "legacy" } };
export const GlassLight: Story = {
	args: {
		scenario: "settled",
		theme: "localOperatorLight",
		glass: "on",
		glassCoverage: "full",
	},
};
export const GlassDark: Story = {
	args: {
		scenario: "settled",
		theme: "localOperatorDark",
		glass: "on",
		glassCoverage: "full",
	},
};
export const OpaqueLight: Story = {
	args: { scenario: "settled", theme: "localOperatorLight", glass: "off" },
};
export const OpaqueDark: Story = {
	args: { scenario: "settled", theme: "localOperatorDark", glass: "off" },
};
const measureCompact: Story["play"] = ({ canvasElement }) => {
	const scroller = canvasElement.querySelector<HTMLElement>(
		"[data-lo-canonical-transcript]",
	);
	if (!scroller) throw new Error("Missing transcript scroller");
	const grids = [
		...scroller.querySelectorAll<HTMLElement>("[data-lo-inline-ui] section"),
	];
	const widths = grids
		.map(({ clientWidth, scrollWidth }) => `${clientWidth}/${scrollWidth}`)
		.join(", ");
	const reading = document.createElement("output");
	reading.classList.add("sr-only");
	reading.textContent = `Client / scroll widths: transcript ${scroller.clientWidth}/${scroller.scrollWidth}; grids ${widths || "none"}`;
	canvasElement.append(reading);
};
export const Compact: Story = {
	args: {
		scenario: "compact",
		theme: "localOperatorDark",
		glass: "on",
		glassCoverage: "full",
		width: 172,
	},
	play: measureCompact,
};
export const CompactProse: Story = {
	args: { ...Compact.args, proseOnly: true },
	play: measureCompact,
};
