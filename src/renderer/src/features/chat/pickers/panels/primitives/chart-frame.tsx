import { cn } from "@shared/lib/utils";
import {
	Children,
	type ReactElement,
	type ReactNode,
	cloneElement,
	isValidElement,
} from "react";
import {
	Bar,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { formatDayBucket, formatTokens } from "../formatters";

/**
 * The ONE place recharts' class names live.
 *
 * Recharts is styled from outside by descendant selectors rather than through
 * its colour props, and that is not a preference: those props land as SVG
 * presentation attributes, which cannot take a `var()`. A themed chart would
 * otherwise have to read palette hexes through a hook — the one thing the role
 * system exists to remove. A CSS rule beats a presentation attribute, so these
 * win, and the selectors are recharts' own documented class names.
 *
 * There is exactly one chart idiom in the app. `settings-page.tsx` spelled
 * this inline first; it is migrated onto this frame in the same change,
 * because a second styling path beside an established one is a defect rather
 * than a style choice — and the next reader would have to keep two of them in
 * step with the twelve themes.
 *
 * What it must not do: accept a colour, `stroke` or `fill` prop from a caller
 * (the hue is the contract's, not the call site's); draw with an empty data
 * array (the caller substitutes `PanelEmpty` — a `domain` of `[0, 0]` makes
 * recharts paint a flat mark at the top of an empty box, which reads as data);
 * or change a mark's fill on hover (the tooltip cursor is the hover affordance,
 * and there is no `chart-bar-hover` role in the contract).
 */

export type ChartFrameProps = {
	/**
	 * Sentence case heading; a chart is never unlabelled. An EMPTY title renders
	 * no heading row, which exists for one case: a caller whose surrounding
	 * section already carries the heading (and the control the frame has no slot
	 * for) would otherwise print the series name twice.
	 */
	title: string;
	meta?: string;
	/** A REAL height. ResponsiveContainer measures its box, so `h-full` renders nothing. */
	heightClassName?: string;
	/** Y-axis gutter; must fit the widest abbreviated label. */
	yAxisWidth?: number;
	/** Summary sentence for the accessibility tree. */
	srSummary: string;
	/**
	 * How a bucket on the X axis is labelled. Defaults to the daily rollup's
	 * own spelling (`Sep 13`), which is the only series this app plots today.
	 */
	xTickFormatter?: (value: string) => string;
	/**
	 * How a value is abbreviated on the Y axis AND in the tooltip.
	 *
	 * One prop for both because the two must agree: the panel has a single
	 * metric control (tokens or spend), so a frame whose axis said `1.2M` and
	 * whose tooltip said `1202k` would be two spellings of one quantity on one
	 * screen. The default is the token ladder, matching § 7's axis rule.
	 */
	yTickFormatter?: (value: number) => string;
	/** The quantity's unit, rendered beside the tooltip's value. */
	unit?: string;
	/**
	 * The single-series `<BarChart>` or `<LineChart>` to frame, whose `data` rows
	 * are {@link ChartBucket}s. The caller supplies the marks; the frame supplies
	 * everything around them.
	 */
	children: ReactNode;
};

/** One bucket of the one series a chart may draw. */
export type ChartBucket = {
	/** The bucket's own label, formatted by `xTickFormatter` for the axis. */
	bucket: string;
	/** The plotted quantity, formatted by `yTickFormatter`. */
	value: number;
};

const FRAME_CLASS = [
	"[&_.recharts-cartesian-grid_line]:stroke-hairline",
	"[&_.recharts-cartesian-axis-tick-value]:fill-ink-dim [&_.recharts-cartesian-axis-tick-value]:text-meta",
	"[&_.recharts-bar-rectangle]:fill-accent",
	"[&_.recharts-line-curve]:stroke-accent",
	"[&_.recharts-active-dot_circle]:fill-accent",
	"[&_.recharts-tooltip-cursor]:stroke-hairline",
];

type TooltipPayload = { value?: number | string; name?: string };

/**
 * The chart's own tooltip.
 *
 * Recharts configures its default panel through `contentStyle` / `itemStyle`
 * objects, which take literal colours and cannot read a role, so a custom
 * renderer is the only way to theme it. It also lets the panel use the same
 * anatomy as every other overlay in the app: `elevated` ground, `shadow-overlay`,
 * monospace for the number because a number is machine voice.
 */
const ChartTooltip = ({
	active,
	label,
	payload,
	format,
	unit,
}: {
	active?: boolean;
	label?: string;
	payload?: TooltipPayload[];
	format: (value: number) => string;
	unit?: string;
}) => {
	if (!active || !payload?.length) return null;
	const raw = payload[0]?.value;
	const value = typeof raw === "number" ? format(raw) : String(raw ?? "");
	return (
		<div
			className={cn(
				"rounded-md border border-hairline bg-elevated px-3 py-2 shadow-overlay",
			)}
		>
			<p className={cn("text-meta text-ink-dim")}>{label}</p>
			<p className={cn("font-mono text-ink")}>
				{value}
				{unit ? ` ${unit}` : ""}
			</p>
		</div>
	);
};

export const ChartFrame = ({
	title,
	meta,
	heightClassName = "h-56",
	yAxisWidth = 48,
	srSummary,
	xTickFormatter = formatDayBucket,
	yTickFormatter = formatTokens,
	unit,
	children,
}: ChartFrameProps) => {
	/*
	 * The axes, the grid and the tooltip are injected into the caller's chart
	 * element rather than passed as the caller's own children.
	 *
	 * Recharts requires them to be descendants of the chart element itself, so
	 * there is no way to render them "around" a `<BarChart>` — and leaving them
	 * to the call sites is exactly how a second styling path appears. Cloning
	 * the single child keeps the idiom in one file and keeps the call site to
	 * the two things it actually decides: the data and the mark.
	 *
	 * The grid goes first so it paints behind the marks, and the tooltip last.
	 */
	/*
	 * A non-element child renders as an empty fragment: the contract says this
	 * slot holds the recharts element, so there is no other shape to honour, and
	 * rendering `undefined` into `ResponsiveContainer` is a type error rather
	 * than a design decision.
	 */
	const chart: ReactElement = isValidElement(children) ? (
		(cloneElement(
			children as ReactElement<{
				children?: ReactNode;
				isAnimationActive?: boolean;
			}>,
			/*
			 * `isAnimationActive: false` on the chart element, not on each mark at
			 * each call site: § 7's "no motion on marks" is a rule about charts, so
			 * the chart idiom owns it. A mark that animated in would be an entrance
			 * on a surface whose numbers are already settled.
			 */
			{ isAnimationActive: false },
			[
				<CartesianGrid key="grid" strokeDasharray="3 3" vertical={false} />,
				<XAxis
					key="x"
					dataKey="bucket"
					tickLine={false}
					axisLine={false}
					tickFormatter={xTickFormatter}
				/>,
				<YAxis
					key="y"
					tickLine={false}
					axisLine={false}
					width={yAxisWidth}
					tickFormatter={yTickFormatter}
				/>,
				...Children.toArray(
					(children as ReactElement<{ children?: ReactNode }>).props.children,
				),
				<Tooltip
					key="tooltip"
					content={<ChartTooltip format={yTickFormatter} unit={unit} />}
				/>,
			],
		) as ReactElement)
	) : (
		<></>
	);

	return (
		<div className={cn("flex flex-col gap-2")}>
			{title ? (
				<div className={cn("flex items-baseline justify-between gap-3")}>
					<h3 className={cn("text-heading text-ink")}>{title}</h3>
					{meta ? <p className={cn("text-ink-dim text-meta")}>{meta}</p> : null}
				</div>
			) : null}
			{/*
			 * A chart is never the only carrier of a fact: every value on it also
			 * appears in a table or a stat. The SVG is hidden from the tree and the
			 * summary below is what a screen reader gets instead.
			 */}
			<p className="sr-only">{srSummary}</p>
			<div className={cn(FRAME_CLASS, heightClassName)} aria-hidden="true">
				<ResponsiveContainer width="100%" height="100%">
					{chart}
				</ResponsiveContainer>
			</div>
		</div>
	);
};

/** Re-exported so a panel's chart body reads as one import. */
export { Bar };
