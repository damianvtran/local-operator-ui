/**
 * The parts every inline chart shares: measured width, number formats, the
 * active-mark model (pointer, touch and keyboard drive ONE state), the floating
 * tooltip, the screen-reader live region and the collapsed "Chart data" table.
 *
 * WHY SHARED. The operator asked to hover any data point and read its value,
 * on every chart type. Seven renderers each growing their own hover state,
 * tooltip and key handling is how the old charts ended up with three different
 * axes treatments; the spec (sections 5-6) defines one interaction model, so it
 * lives once, here, and each renderer only maps a pointer position to a mark.
 */
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { type Ticks, compactTicks } from "./inline-chart-model";

/* Server rendering (the transcript tests render static markup) has no layout;
   React 18 warns for a layout effect there, and nothing needs measuring. */
export const useIsomorphicLayoutEffect =
	typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Categorical slot inks, written out in full so Tailwind's scanner emits them.
 * Slot 1 is the accent; see `chart-palette.mjs` for how 2-7 are derived.
 */
export const SLOT_INK = [
	"text-chart-1",
	"text-chart-2",
	"text-chart-3",
	"text-chart-4",
	"text-chart-5",
	"text-chart-6",
	"text-chart-7",
] as const;
/** The folded "Other" pie slice: `ink-dim`, never a categorical slot. */
export const OTHER_INK = "text-ink-dim";

/** Non-active marks recede to this opacity while one is active (spec section 5). */
export const DIM = 0.35;
/** 120ms opacity step; instant under reduced motion. */
export const DIM_TRANSITION =
	"transition-opacity duration-[120ms] motion-reduce:transition-none";
/** One 180ms fade on mount (`.lo-chart-enter` in markdown.css), never again. */
export const ENTER = "lo-chart-enter";

/**
 * The chart's content-box width, measured BEFORE the first paint (layout
 * effect) and kept current with a ResizeObserver, so the SVG is drawn at its
 * real pixel size rather than a fixed viewBox stretched flat. The font family
 * is read once with it, for measuring axis labels.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
	const ref = useRef<T>(null);
	const [state, setState] = useState({ width: 0, font: "" });
	useIsomorphicLayoutEffect(() => {
		const node = ref.current;
		if (!node) return;
		const read = () => {
			const width = Math.floor(node.clientWidth);
			const font = getComputedStyle(node).fontFamily;
			setState((previous) =>
				previous.width === width && previous.font === font
					? previous
					: { width, font },
			);
		};
		read();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	return [ref, state.width, state.font] as const;
}

/** One stable callback ref feeding several ref objects (measure + focus root). */
export function useMergedRef<T>(
	...refs: { current: T | null }[]
): (node: T | null) => void {
	// biome-ignore lint/correctness/useExhaustiveDependencies: ref objects are stable.
	return useCallback((node: T | null) => {
		for (const ref of refs) ref.current = node;
	}, []);
}

let measuringContext: CanvasRenderingContext2D | null | undefined;
/**
 * Width of `text` at the 12px meta step in `fontFamily`. Canvas measurement
 * where it exists; otherwise the spec's 6.6px-per-character estimate.
 */
export function textWidth(text: string, fontFamily: string): number {
	if (measuringContext === undefined) {
		try {
			measuringContext =
				typeof document === "undefined"
					? null
					: document.createElement("canvas").getContext("2d");
		} catch {
			measuringContext = null;
		}
	}
	if (!measuringContext || !fontFamily) return Array.from(text).length * 6.6;
	measuringContext.font = `12px ${fontFamily}`;
	return measuringContext.measureText(text).width;
}

export type ChartNumbers = {
	/** Exact as authored: full precision, grouping on, never compact. */
	exact: (value: number) => string;
	/** A share in percent with one decimal: `38.2%`. */
	share: (fraction: number) => string;
	/** A share rounded to a whole percent, for direct pie labels: `38%`. */
	shareShort: (fraction: number) => string;
	/** A 0-100 percent-mode tick: `25%`. */
	percentTick: (value: number) => string;
	/** Tick labels for a domain: compact from 10 000, else the step's decimals. */
	tick: (ticks: Ticks) => (value: number) => string;
};

export function useChartNumbers(): ChartNumbers {
	const locale = useI18nLocale();
	return useMemo(() => {
		const exact = new Intl.NumberFormat(locale, {
			maximumSignificantDigits: 21,
		});
		const share = new Intl.NumberFormat(locale, {
			style: "percent",
			maximumFractionDigits: 1,
		});
		const shareShort = new Intl.NumberFormat(locale, {
			style: "percent",
			maximumFractionDigits: 0,
		});
		const percentTick = new Intl.NumberFormat(locale, { style: "percent" });
		return {
			percentTick: (value) => percentTick.format(value / 100),
			exact: (value) => exact.format(value),
			share: (fraction) => share.format(fraction),
			shareShort: (fraction) => shareShort.format(fraction),
			tick: (ticks) => {
				const format = new Intl.NumberFormat(
					locale,
					compactTicks(ticks)
						? { notation: "compact", maximumFractionDigits: 1 }
						: {
								minimumFractionDigits: Math.min(20, ticks.decimals),
								maximumFractionDigits: Math.min(20, ticks.decimals),
							},
				);
				return (value) => format.format(value);
			},
		};
	}, [locale]);
}

/** The screen-reader line for a mark: `Nov 18, Spend, 140.61 USD, 3 of 9`. */
export function useAnnounce() {
	const locale = useI18nLocale();
	return useMemo(() => {
		const list = new Intl.ListFormat(locale, { type: "unit", style: "short" });
		return (parts: (string | undefined)[], index: number, count: number) =>
			list.format([
				...parts.filter((part): part is string => Boolean(part)),
				t("ui.chat.inline_chart.position", { index: index + 1, count }),
			]);
	}, [locale]);
}

export type Mark = { category: number; series: number };
type Source = "pointer" | "touch" | "keyboard";

/**
 * The active-mark state and its keyboard model (spec section 5): one tab stop,
 * focus activates mark 0, Left/Right move by category, Up/Down by series,
 * Home/End jump, Escape hides the tooltip and keeps focus. Touch pins a mark
 * until the same mark or anything outside the chart is tapped.
 */
export function useActiveMark({
	categories,
	series,
}: {
	categories: number;
	series: number;
}) {
	const [state, setState] = useState<{ mark: Mark; source: Source } | null>(
		null,
	);
	const rootRef = useRef<HTMLDivElement>(null);
	const pinned = state?.source === "touch";
	useEffect(() => {
		if (!pinned) return;
		const outside = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setState(null);
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [pinned]);
	const point = useCallback(
		(mark: Mark | null, pointerType: string, tap = false) => {
			const source: Source = pointerType === "touch" ? "touch" : "pointer";
			setState((previous) => {
				if (!mark) return previous?.source === "pointer" ? null : previous;
				if (
					tap &&
					previous?.source === "touch" &&
					previous.mark.category === mark.category &&
					previous.mark.series === mark.series
				)
					return null;
				if (
					previous?.source === source &&
					previous.mark.category === mark.category &&
					previous.mark.series === mark.series
				)
					return previous;
				return { mark, source };
			});
		},
		[],
	);
	const leave = useCallback(() => {
		setState((previous) => (previous?.source === "pointer" ? null : previous));
	}, []);
	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent) => {
			const last = Math.max(0, categories - 1);
			const move = (mark: Mark) => {
				event.preventDefault();
				setState({ mark, source: "keyboard" });
			};
			const current = state?.mark ?? { category: 0, series: 0 };
			switch (event.key) {
				case "ArrowRight":
					return move({
						...current,
						category: state ? Math.min(last, current.category + 1) : 0,
					});
				case "ArrowLeft":
					return move({
						...current,
						category: state ? Math.max(0, current.category - 1) : 0,
					});
				case "ArrowDown":
					return move({
						...current,
						series: state ? Math.min(series - 1, current.series + 1) : 0,
					});
				case "ArrowUp":
					return move({
						...current,
						series: state ? Math.max(0, current.series - 1) : 0,
					});
				case "Home":
					return move({ ...current, category: 0 });
				case "End":
					return move({ ...current, category: last });
				case "Escape":
					if (state) {
						event.preventDefault();
						setState(null);
					}
					return;
				default:
					return;
			}
		},
		[categories, series, state],
	);
	const onFocus = useCallback(
		(event: { currentTarget: HTMLElement; target: EventTarget }) => {
			if (event.target !== event.currentTarget) return;
			let visible = true;
			try {
				visible = event.currentTarget.matches(":focus-visible");
			} catch {
				// An engine without :focus-visible treats every focus as keyboard focus.
			}
			if (visible)
				setState(
					(previous) =>
						previous ?? {
							mark: { category: 0, series: 0 },
							source: "keyboard",
						},
				);
		},
		[],
	);
	const onBlur = useCallback(() => {
		setState((previous) => (previous?.source === "keyboard" ? null : previous));
	}, []);
	return {
		active: state?.mark ?? null,
		source: state?.source ?? null,
		rootRef,
		point,
		leave,
		rootProps: { onKeyDown, onFocus, onBlur },
	};
}

export type TooltipRow = {
	/** Swatch ink class (`text-chart-N`); omitted for no swatch. */
	ink?: string;
	label?: string;
	value: string;
	/** Smaller, muted line under the value row (a share, an axis note). */
	note?: string;
};

/**
 * The floating readout. The SAME visual contract as the shared tooltip
 * (`shared/components/ui/tooltip.tsx`): `data-lo-floating`, no border, the
 * elevated ground with one `shadow-overlay`, window glass via
 * `data-glass-overlay`, `max-w-64`, no entrance animation and never a pointer
 * target. It is absolutely positioned inside the chart box, so it never
 * changes layout: 8px above the anchor, flipped below when it would cross the
 * chart's top edge, clamped 4px inside the left and right edges.
 */
export function ChartTooltip({
	anchor,
	width,
	heading,
	rows,
}: {
	anchor: { x: number; y: number; below?: number } | null;
	width: number;
	heading?: string;
	rows: TooltipRow[];
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number }>();
	const content = JSON.stringify([heading, rows]);
	useIsomorphicLayoutEffect(() => {
		const node = ref.current;
		if (!node || !anchor) {
			setPosition(undefined);
			return;
		}
		const w = node.offsetWidth;
		const h = node.offsetHeight;
		let top = anchor.y - 8 - h;
		if (top < 0) top = (anchor.below ?? anchor.y) + 8;
		const left = Math.max(4, Math.min(anchor.x - w / 2, width - w - 4));
		setPosition((previous) =>
			previous?.left === left && previous.top === top
				? previous
				: { left, top },
		);
	}, [anchor?.x, anchor?.y, anchor?.below, width, content]);
	if (!anchor) return null;
	return (
		<div
			ref={ref}
			aria-hidden="true"
			data-lo-floating=""
			data-glass-overlay=""
			data-lo-chart-tooltip=""
			className="pointer-events-none absolute z-10 w-max max-w-64 rounded-sm bg-elevated px-2 py-1 text-ink text-meta shadow-overlay"
			style={{
				left: position?.left ?? 0,
				top: position?.top ?? 0,
				visibility: position ? "visible" : "hidden",
			}}
		>
			{heading && (
				<div className="wrap-anywhere text-ink-muted">
					<bdi>{heading}</bdi>
				</div>
			)}
			<div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-2">
				{rows.map((row, index) => (
					<TooltipLine key={`${index}-${row.label}`} row={row} />
				))}
			</div>
		</div>
	);
}

function TooltipLine({ row }: { row: TooltipRow }) {
	return (
		<>
			<span
				aria-hidden="true"
				className={cn(
					"inline-block size-2 rounded-[2px]",
					row.ink ? cn(row.ink, "bg-current") : "invisible",
				)}
			/>
			<bdi className="min-w-0 truncate text-ink-muted">{row.label ?? ""}</bdi>
			<bdi className="text-end font-semibold text-ink tabular-nums">
				{row.value}
			</bdi>
			{row.note && (
				<span className="col-span-2 col-start-2 text-end text-ink-muted tabular-nums">
					{row.note}
				</span>
			)}
		</>
	);
}

/**
 * The chart's focus root: ONE tab stop (spec section 5), a `group` announced
 * with the "chart" role description, labelled by the title and described by
 * the data table. Arrow keys, Home/End and Escape come in through `keys`.
 * LTR always: a plot's x axis does not mirror in RTL locales.
 */
export function ChartRoot({
	rootRef,
	titleId,
	describedById,
	className,
	style,
	keys,
	children,
}: {
	rootRef: (node: HTMLDivElement | null) => void;
	titleId: string;
	describedById: string;
	className?: string;
	style?: CSSProperties;
	keys: ReturnType<typeof useActiveMark>["rootProps"];
	children: ReactNode;
}) {
	return (
		<div
			ref={rootRef}
			// biome-ignore lint/a11y/useSemanticElements: a chart is not a set of form controls; fieldset would add form semantics and a legend.
			role="group"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is keyboard-operable (arrow keys move the active mark).
			tabIndex={0}
			aria-roledescription={t("ui.chat.inline_chart.role")}
			aria-labelledby={titleId}
			aria-describedby={describedById}
			dir="ltr"
			className={cn("relative mt-2 rounded-sm", className)}
			style={style}
			{...keys}
		>
			{children}
		</div>
	);
}

/** The visually hidden live region the active mark is announced through. */
export function LiveRegion({ text }: { text: string }) {
	return (
		<div aria-live="polite" aria-atomic="true" className="sr-only">
			{text}
		</div>
	);
}

export type DataColumn = { label: string; numeric?: boolean };

function DataTable({
	columns,
	rows,
}: {
	columns: DataColumn[];
	rows: string[][];
}) {
	return (
		<table className="w-full min-w-max text-meta tabular-nums">
			<thead>
				<tr className="h-7 text-ink-muted">
					{columns.map((column, index) => (
						<th
							key={`${index}-${column.label}`}
							scope="col"
							className={cn(
								"whitespace-nowrap px-2 font-medium first:ps-0",
								column.numeric ? "text-end" : "text-start",
							)}
						>
							<bdi>{column.label}</bdi>
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row, rowIndex) => (
					<tr
						key={`${rowIndex}-${row[0]}`}
						className="h-7 border-hairline border-t"
					>
						{row.map((cell, index) =>
							index === 0 ? (
								<th
									key={`${index}-${cell}`}
									scope="row"
									className="whitespace-nowrap pe-2 text-start font-normal text-ink-muted"
								>
									<bdi>{cell}</bdi>
								</th>
							) : (
								<td
									key={`${index}-${cell}`}
									className={cn(
										"whitespace-nowrap px-2 text-ink",
										columns[index]?.numeric ? "text-end" : "text-start",
									)}
								>
									<bdi>{cell}</bdi>
								</td>
							),
						)}
					</tr>
				))}
			</tbody>
		</table>
	);
}

/**
 * Exact values, one click away (spec section 6). Collapsed by default under
 * the app's one disclosure idiom: hover, focus and tap already give any mark's
 * value, and the always-open list it replaces doubled the chart's height in
 * the answer. Every row is listed, including pie items folded into "Other".
 *
 * The shared `Disclosure` mounts its body only while open, so the chart's
 * `aria-describedby` points at a `hidden` copy (`describedById`): hidden
 * content a description references is still read, and the copy keeps the
 * description available while the visible table is collapsed.
 */
export function ChartData({
	describedById,
	columns,
	rows,
}: {
	describedById: string;
	columns: DataColumn[];
	rows: string[][];
}) {
	return (
		<div className="mt-3" data-lo-chart-data="">
			<Disclosure
				chevronClassName="text-ink-dim"
				triggerClassName="text-ink-muted text-meta"
				summary={t("ui.chat.inline_chart.data_toggle")}
			>
				<div className="max-w-full overflow-x-auto">
					<DataTable columns={columns} rows={rows} />
				</div>
			</Disclosure>
			<div id={describedById} hidden>
				<DataTable columns={columns} rows={rows} />
			</div>
		</div>
	);
}

/** Title, then the 16px unit/legend row (spec section 1, block rhythm). */
export function ChartHeader({
	title,
	titleId,
	start,
	end,
}: {
	title: string;
	titleId: string;
	start?: ReactNode;
	end?: ReactNode;
}) {
	return (
		<>
			<figcaption id={titleId} className="wrap-anywhere font-semibold text-ink">
				{title}
			</figcaption>
			{(start || end) && (
				<div className="mt-1 flex min-h-4 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-ink-muted text-meta leading-4">
					<div className="min-w-0 wrap-anywhere">{start}</div>
					{end && (
						<div className="flex min-w-0 flex-wrap justify-end gap-x-3 gap-y-1">
							{end}
						</div>
					)}
				</div>
			)}
		</>
	);
}

/** One legend entry; hovering it highlights its series like hovering a mark. */
export function LegendItem({
	ink,
	label,
	dashed,
	dim,
	onEnter,
	onLeave,
}: {
	ink: string;
	label: string;
	dashed?: boolean;
	dim?: boolean;
	onEnter?: () => void;
	onLeave?: () => void;
}) {
	return (
		<span
			className={cn("flex min-w-0 items-center gap-1.5", DIM_TRANSITION)}
			style={{ opacity: dim ? DIM : 1 }}
			onPointerEnter={onEnter}
			onPointerLeave={onLeave}
		>
			<svg
				aria-hidden="true"
				width="16"
				height="8"
				viewBox="0 0 16 8"
				className={cn("shrink-0", ink)}
			>
				{dashed ? (
					<path
						d="M0 4H16"
						stroke="currentColor"
						strokeWidth="2"
						strokeDasharray="6 4"
					/>
				) : (
					<rect x="4" width="8" height="8" rx="2" fill="currentColor" />
				)}
			</svg>
			<bdi className="min-w-0 truncate">{label}</bdi>
		</span>
	);
}
