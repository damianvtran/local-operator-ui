import { cn } from "@shared/lib/utils";
import {
	Children,
	type ReactElement,
	type ReactNode,
	cloneElement,
	isValidElement,
} from "react";
import {
	Area,
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	ResponsiveContainer,
	Scatter,
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
 * step with the theme set.
 *
 * What it must not do: accept a colour, `stroke` or `fill` prop from a caller
 * (the hue is the contract's, not the call site's); draw with an empty data
 * array (the caller substitutes `PanelEmpty` — a `domain` of `[0, 0]` makes
 * recharts paint a flat mark at the top of an empty box, which reads as data);
 * or leave the pointer with nothing to read. That last rule changed shape here:
 * a bar chart used to get recharts' own cursor — a full-height `Rectangle` over
 * the category band — and the highlight now lands on the BAR under the pointer
 * instead, because the band is not the thing the user is asking about (see
 * `withActiveBar` and the `Tooltip`'s own `cursor={false}` below).
 */

export type ChartFrameProps = {
	/**
	 * Sentence case heading; a chart is never unlabelled. ABSENT — not `""` — is
	 * how a caller with its own heading row says so: the settings section has one
	 * and it carries the metric toggle this frame has no slot for, and an
	 * optional prop cannot be silently empty by accident.
	 */
	title?: string;
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
	/*
	 * The ACTIVE bar's fill, and it has to be a rule HERE rather than a prop on
	 * the `<Bar>` for the reason this whole array exists: a presentation attribute
	 * cannot take a `var()`, and a CSS rule BEATS a presentation attribute — so a
	 * hover colour passed as `activeBar={{ fill: ... }}` would be silently
	 * overridden by the plain-rectangle rule above it.
	 *
	 * WHY THIS RULE WINS IS THE NESTING, not the source order (review round 1,
	 * F2). recharts wraps every rectangle in `<Layer
	 * className="recharts-bar-rectangle">` (`cartesian/Bar.js:94-96`) and, when a
	 * mark is active, renders the active shape inside its own `<Layer
	 * className="recharts-active-bar">` (`util/BarUtils.js:54` sets
	 * `activeClassName`, `util/ActiveShapeUtils.js:93-97` renders it) — so the
	 * active `<g>` is a DESCENDANT of the plain one. `fill` is an inherited SVG
	 * property, so the path takes its value from its nearest ancestor, which is the
	 * active wrapper. That is the mechanism a reorder of this array cannot change,
	 * and the reason the two rules do not need to be ordered at all.
	 *
	 * `chart-bar-hover` is a first-class palette role — the mark under the pointer —
	 * added in review round 1 (D1) because no existing role could express "more
	 * prominent" on a ground whose accent is already the palette's brightest value
	 * (`obsidian`), and because the button-hover role this used to borrow moves
	 * TOWARD the ground there. Branding § 5 is the rule it follows: hover is a
	 * colour step, and nothing lifts, scales or translates.
	 */
	"[&_.recharts-active-bar]:fill-chart-bar-hover",
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
/**
 * The mark TYPES that take the animation flag, and nothing else.
 *
 * `isAnimationActive` is read by the MARK in the installed recharts: 2.15.3's
 * `chart/generateCategoricalChart.js` — the module that builds `BarChart` and
 * `LineChart` — never mentions the prop, while `cartesian/Bar.js` and
 * `cartesian/Line.js` default it to `!Global.isSsr`, i.e. true in a browser.
 * Writing it on the chart element, which this frame used to do, is therefore a
 * prop nothing reads: every mark still animated in, so § 7's "no motion on
 * marks" was not delivered by the one file that exists to own it — and no
 * settled frame could show the difference.
 *
 * A whitelist rather than a blanket clone: this frame also injects `XAxis`,
 * `YAxis`, `CartesianGrid` and `Tooltip`, and recharts spreads some of those
 * props onto SVG nodes, where an unknown attribute warns. Rebuilding only the
 * marks with the flag keeps the rule in one file, applied to every chart the app
 * draws, rather than repeated at each call site where forgetting it would
 * reintroduce motion silently.
 */
const MARKS: unknown[] = [Bar, Line, Area, Scatter];

/**
 * Every mark below `nodes`, with its mount animation off.
 *
 * Exported so `scripts/panel-chart-motion.test.mjs` can bind the SHIPPED
 * function rather than reimplementing it — the failure this guards against (the
 * flag set where nothing reads it) is invisible in any rendered frame, since a
 * settled frame after the animation equals the frame before it.
 */
export const withoutMotion = (nodes: ReactNode): ReactNode =>
	Children.map(nodes, (node) => {
		if (!isValidElement(node)) return node;
		const element = node as ReactElement<{
			children?: ReactNode;
			isAnimationActive?: boolean;
		}>;
		const isMark = MARKS.includes(element.type as unknown);
		/*
		 * A leaf keeps its own props exactly. Cloning one with `children:
		 * undefined` would ADD a key it never had, and this frame injects axes and
		 * grids whose props recharts spreads onto SVG nodes — an attribute nobody
		 * asked for is exactly what the whitelist above exists to avoid.
		 */
		if (
			element.props.children === undefined ||
			element.props.children === null
		) {
			return isMark
				? cloneElement(element, { isAnimationActive: false })
				: element;
		}
		const children = withoutMotion(element.props.children);
		return isMark
			? cloneElement(element, { isAnimationActive: false, children })
			: cloneElement(element, { children });
	});

/**
 * The hover affordance on a bar: `<Bar activeBar>`.
 *
 * recharts reaches a mark's active state only when the mark declares an active
 * SHAPE — `generateCategoricalChart.js:1391` computes `hasActive = ... &&
 * (activeDot || activeBar || activeShape)` before it passes the tooltip's
 * `activeIndex` down, and `activeBar` defaults to `false`
 * (`cartesian/Bar.js:89`). Without it every rectangle is the same rectangle and
 * the frame's only hover affordance would be the cursor band this change removes.
 *
 * Set by the FRAME rather than by each call site for the reason the frame exists:
 * it owns the chart idiom, both charts in the app render through it, and a call
 * site that had to remember a prop would be a second hover rule — the settings
 * chart, which uses a `<LineChart>`, would keep the old one.
 *
 * Written on the MARK because that is where recharts reads it, so this clones the
 * same way `withoutMotion` does and walks for the same reason (a chart may nest
 * its marks); the two are siblings, one prop each, rather than one helper with a
 * flag.
 */
export const withActiveBar = (nodes: ReactNode): ReactNode =>
	Children.map(nodes, (node) => {
		if (!isValidElement(node)) return node;
		const element = node as ReactElement<{
			children?: ReactNode;
			activeBar?: boolean;
		}>;
		const isBar = element.type === Bar;
		/*
		 * A leaf keeps its own props exactly, like its sibling: cloning one with
		 * `children: undefined` would ADD a key it never had, and this frame also
		 * injects axes whose props recharts spreads onto SVG nodes.
		 */
		if (
			element.props.children === undefined ||
			element.props.children === null
		) {
			return isBar ? cloneElement(element, { activeBar: true }) : element;
		}
		const children = withActiveBar(element.props.children);
		return isBar
			? cloneElement(element, { activeBar: true, children })
			: cloneElement(element, { children });
	});

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
	/*
	 * A BAR chart's cursor is switched OFF; a line chart's is left alone.
	 *
	 * recharts' cursor for a `BarChart` is a `Rectangle` covering the whole
	 * category band (`component/Cursor.js` → `util/cursor/getCursorRectangle.js`),
	 * so the highlight the pointer produces is the band rather than the bar the
	 * question is about — and it is drawn OVER the marks, which is why the bar
	 * under the pointer could not be seen at all. The bar's affordance is the
	 * active rectangle instead (`withActiveBar` above).
	 *
	 * A LINE chart keeps its cursor, and not by omission: there the cursor IS the
	 * affordance — a vertical guide at the hovered bucket, styled
	 * `[&_.recharts-tooltip-cursor]:stroke-hairline` — and there is no mark for a
	 * highlight to land on. Switching it off for both would trade one chart's
	 * defect for the other's.
	 *
	 * Guarded by `isValidElement`, because this slot is documented to tolerate a
	 * non-element child (it renders as an empty fragment below) and reading `.type`
	 * off a `null` child would throw before that rule could apply.
	 */
	const isBarChart = isValidElement(children) && children.type === BarChart;
	const chart: ReactElement = isValidElement(children) ? (
		(cloneElement(
			children as ReactElement<{
				children?: ReactNode;
			}>,
			/*
			 * Nothing is set on the chart element itself: the animation flag belongs
			 * to the marks (see `withoutMotion`), and the axes, the grid and the
			 * tooltip are injected as children below.
			 */
			{},
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
				/*
				 * The caller's marks, with the frame's two mark-level rules applied: the
				 * mount animation off (`withoutMotion`) and the bar's hover handle on
				 * (`withActiveBar`).
				 *
				 * Both passes answer with a LIST — the same `Children.map` shape — so this
				 * flattens them into ONE, because the marks have to be the chart's own
				 * children: recharts finds its graphical items by walking them, and a
				 * nested array still renders but stops being findable.
				 */
				...Children.toArray(
					withoutMotion(
						(children as ReactElement<{ children?: ReactNode }>).props.children,
					),
				).flatMap((mark) => Children.toArray(withActiveBar(mark))),
				<Tooltip
					key="tooltip"
					/*
					 * `cursor={false}` disables recharts' own cursor where the frame
					 * replaced it (see `isBarChart` above); `undefined` keeps the default
					 * for the line chart, which has no active mark to highlight.
					 */
					cursor={isBarChart ? false : undefined}
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
