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
	type PointerEvent as ReactPointerEvent,
	memo,
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
 * Width of `text` at the 12px meta step in `fontFamily`, from a real canvas
 * `measureText` wherever a document exists; the spec's 6.6px-per-character
 * estimate only where there is no canvas at all (server render, jsdom).
 *
 * Two traps this avoids (the relay shipped one of them): the canvas is built
 * lazily on the first measurement, which happens after mount, so a server
 * render that runs first must NOT cache "no canvas" for the client; and an
 * empty computed font family measures with the generic family instead of
 * silently falling back to the estimate. Every label width (x-label thinning,
 * y gutter, donut labels) goes through here, as do the tests' box checks.
 */
export function textWidth(text: string, fontFamily: string): number {
	if (measuringContext === undefined && typeof document !== "undefined") {
		try {
			measuringContext = document.createElement("canvas").getContext("2d");
		} catch {
			measuringContext = null;
		}
	}
	if (!measuringContext) return Array.from(text).length * 6.6;
	measuringContext.font = `12px ${fontFamily || "sans-serif"}`;
	return measuringContext.measureText(text).width;
}

/** Test seam: forget the cached canvas so the next measurement rebuilds it. */
export function resetTextMeasurer() {
	measuringContext = undefined;
}

/**
 * Compact tick formatting with as few decimals (0-3) as render every tick of
 * the axis EXACTLY, so no two ticks read the same.
 *
 * WHY. A fixed one decimal turned a tight high-magnitude line axis (the
 * near-zero rule means 10 050-10 300 keeps a step of 50) into
 * `10.1K 10.1K 10.2K 10.2K`, and 1 000 000-1 004 000 into five `1M`s (code
 * review R1). The decimals a tick needs are read from the locale's own compact
 * mantissa (`formatToParts` fraction digits), because compact scales differ by
 * locale (K/M in en, 万 in zh-CN, लाख in hi). Exact implies distinct; when a tick
 * would need more than 3 decimals, or labels still repeat, the axis falls back
 * to full grouped numbers. Returns null for that fallback.
 */
export function compactTickFormat(
	locale: string,
	ticks: number[],
): Intl.NumberFormat | null {
	const probe = new Intl.NumberFormat(locale, {
		notation: "compact",
		maximumFractionDigits: 20,
	});
	let decimals = 0;
	for (const tick of ticks) {
		const fraction = probe
			.formatToParts(tick)
			.find((part) => part.type === "fraction");
		decimals = Math.max(decimals, fraction?.value.length ?? 0);
	}
	if (decimals > 3) return null;
	const format = new Intl.NumberFormat(locale, {
		notation: "compact",
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	});
	const labels = ticks.map((tick) => format.format(tick));
	return new Set(labels).size === labels.length ? format : null;
}

export type ChartNumbers = {
	/** Exact as authored: full precision, grouping on, never compact. */
	exact: (value: number) => string;
	/** A share in percent with one decimal: `38.2%`. */
	share: (fraction: number) => string;
	/** A share rounded to a whole percent, for direct pie labels: `38%`. */
	shareShort: (fraction: number) => string;
	/**
	 * A pie share, everywhere a pie shows one (labels, legend, in-ring text,
	 * tooltip, centre readout): a whole percent, `<1%` under 0.5% so a real
	 * slice never reads `0%` (cross-surface decision X9), and `>99%` from 99.5%
	 * so a slice beside another never reads `100%` (R10).
	 */
	pieShare: (fraction: number) => string;
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
		// `<` is a mathematical sign, the same in every shipped locale; the
		// number beside it is the locale's own 1%.
		const underOne = `<${shareShort.format(0.01)}`; // i18n: ignore math sign + localized number, no words
		const overNinetyNine = `>${shareShort.format(0.99)}`; // i18n: ignore math sign + localized number, no words
		return {
			percentTick: (value) => percentTick.format(value / 100),
			exact: (value) => exact.format(value),
			share: (fraction) => share.format(fraction),
			shareShort: (fraction) => shareShort.format(fraction),
			/* `>99%` mirrors `<1%`: a 99.5-99.9% slice rounded to `100%` while a
			   neighbour read `<1%` (code review R10). A share below 1 always
			   has a non-zero sibling, since shares sum to the whole. */
			pieShare: (fraction) =>
				fraction > 0 && fraction < 0.005
					? underOne
					: fraction >= 0.995 && fraction < 1
						? overNinetyNine
						: shareShort.format(fraction),
			tick: (ticks) => {
				const format =
					(compactTicks(ticks) && compactTickFormat(locale, ticks.ticks)) ||
					new Intl.NumberFormat(locale, {
						minimumFractionDigits: Math.min(20, ticks.decimals),
						maximumFractionDigits: Math.min(20, ticks.decimals),
					});
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

/** A touch that moves further than this is a scroll or a scrub, not a tap. */
export const TAP_SLOP = 8;

/**
 * The active-mark state and its keyboard model (spec section 5): one tab stop,
 * focus activates mark 0, Left/Right move by category, Up/Down by series,
 * Home/End jump, Escape hides the tooltip and keeps focus.
 *
 * Touch (cross-surface decision X7): a tap pins a mark; tapping the same mark,
 * empty plot or anything outside the chart's figure dismisses it. The tap is
 * decided on pointer-UP within an 8px slop, never on pointer-down: a scroll
 * that merely starts on a chart must not pin it (UX review U1). When the
 * browser takes the gesture over for scrolling it sends `pointercancel`,
 * which drops the pending touch AND any pinned mark, so no tooltip or dimming
 * is left behind. Renderers that scrub (line/series) pass `scrub`: a touch
 * moving mostly horizontally past the slop follows the finger instead.
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
			/* The figure, not just the plot: the narrow donut's legend rows sit
			   outside the focus root, and tapping one must toggle its slice. */
			const scope = rootRef.current?.closest("figure") ?? rootRef.current;
			if (!scope?.contains(event.target as Node)) setState(null);
		};
		document.addEventListener("pointerdown", outside);
		return () => document.removeEventListener("pointerdown", outside);
	}, [pinned]);
	const point = useCallback((mark: Mark | null, pointerType: string) => {
		const source: Source = pointerType === "touch" ? "touch" : "pointer";
		setState((previous) => {
			if (!mark) return previous?.source === "pointer" ? null : previous;
			if (
				previous?.source === source &&
				previous.mark.category === mark.category &&
				previous.mark.series === mark.series
			)
				return previous;
			return { mark, source };
		});
	}, []);
	const leave = useCallback(() => {
		setState((previous) => (previous?.source === "pointer" ? null : previous));
	}, []);
	/* The touch in progress. A ref, not state: nothing shows until pointer-up
	   decides it was a tap (or the finger moves far enough to scrub). */
	const touch = useRef<{
		id: number;
		x: number;
		y: number;
		mark: Mark | null;
		moved: boolean;
		scrubbing: boolean;
	} | null>(null);
	const tap = useCallback((mark: Mark | null) => {
		setState((previous) => {
			const pinnedNow = previous?.source === "touch" ? previous : null;
			if (!mark) return pinnedNow ? null : previous;
			if (
				pinnedNow &&
				pinnedNow.mark.category === mark.category &&
				pinnedNow.mark.series === mark.series
			)
				return null;
			return { mark, source: "touch" };
		});
	}, []);
	const cancel = useCallback(() => {
		touch.current = null;
		setState((previous) => (previous?.source === "touch" ? null : previous));
	}, []);
	/**
	 * Pointer handlers for a mark layer. `locate` maps an event to the mark under
	 * it (or null for empty plot). Mouse and pen hover; touch taps (and, with
	 * `scrub`, drags horizontally).
	 */
	const pointerHandlers = useCallback(
		(
			locate: (event: ReactPointerEvent<Element>) => Mark | null,
			{ scrub = false }: { scrub?: boolean } = {},
		) => {
			const hover = (event: ReactPointerEvent<Element>) => {
				if (event.pointerType !== "touch")
					point(locate(event), event.pointerType);
			};
			return {
				onPointerEnter: hover,
				onPointerMove: (event: ReactPointerEvent<Element>) => {
					if (event.pointerType !== "touch") return hover(event);
					const current = touch.current;
					if (!current || current.id !== event.pointerId) return;
					const dx = event.clientX - current.x;
					const dy = event.clientY - current.y;
					if (!current.moved && Math.hypot(dx, dy) <= TAP_SLOP) return;
					if (!current.moved) {
						current.moved = true;
						current.scrubbing = scrub && Math.abs(dx) > Math.abs(dy);
					}
					if (current.scrubbing) {
						const mark = locate(event);
						if (mark) point(mark, "touch");
					}
				},
				onPointerDown: (event: ReactPointerEvent<Element>) => {
					if (event.pointerType !== "touch") return;
					touch.current = {
						id: event.pointerId,
						x: event.clientX,
						y: event.clientY,
						mark: locate(event),
						moved: false,
						scrubbing: false,
					};
				},
				onPointerUp: (event: ReactPointerEvent<Element>) => {
					if (event.pointerType !== "touch") return;
					const current = touch.current;
					touch.current = null;
					// A scrub leaves its last mark pinned; only a still touch taps.
					if (current && current.id === event.pointerId && !current.moved)
						tap(current.mark);
				},
				onPointerCancel: cancel,
				onPointerLeave: leave,
			};
		},
		[point, tap, cancel, leave],
	);
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
		pointerHandlers,
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
 * Where a tooltip is anchored, in the chart root's coordinates.
 *
 * - `x`, `y`: the point it sits 8px above (a bar top, the hovered segment's
 *   top, the highest line point).
 * - `below`: the mark's lower edge, where it flips to when above would cross
 *   the chart's top.
 * - `beside`: instead of above/below, sit 8px clear of the horizontal span
 *   `[left, right]` on `side` (1 right, -1 left), centred on `y`. The wide
 *   donut uses it so the tooltip never covers the ring or the centre readout
 *   (design review D1).
 */
export type TooltipAnchor = {
	x: number;
	y: number;
	below?: number;
	beside?: { left: number; right: number; side: 1 | -1 };
};

const TOOLTIP_INSET = 4;
const TOOLTIP_OFFSET = 8;
/** `max-w-64`: the shared tooltip's width cap. */
const TOOLTIP_MAX = 256;

/** The width a beside-placed tooltip may take on its roomier side. */
export function besideRoom(
	beside: NonNullable<TooltipAnchor["beside"]>,
	width: number,
) {
	const right = width - TOOLTIP_INSET - (beside.right + TOOLTIP_OFFSET);
	const left = beside.left - TOOLTIP_OFFSET - TOOLTIP_INSET;
	return { left, right };
}

/**
 * Tooltip placement, pure so it can be pinned by tests (cross-surface
 * decisions X4/X5). `w`/`h` are the tooltip's measured size, `width` the
 * chart box's width and `bottom` the lowest edge it may reach: the plot's
 * bottom, so it never covers the x-axis labels, and never the chart box's
 * bottom (the "Chart data" button sits right under it).
 *
 * Above the anchor first; below the mark when above crosses the top; then
 * clamped inside `[0, bottom]` (QA Q3: a flipped stacked tooltip used to run
 * 48px past the plot over the Chart data button). Horizontally clamped 4px
 * inside the box.
 */
export function placeTooltip({
	anchor,
	w,
	h,
	width,
	bottom,
}: {
	anchor: TooltipAnchor;
	w: number;
	h: number;
	width: number;
	bottom: number;
}): { left: number; top: number } {
	const clampTop = (top: number) =>
		Math.max(0, Math.min(top, Math.max(0, bottom - h)));
	if (anchor.beside) {
		const room = besideRoom(anchor.beside, width);
		const fits = (side: 1 | -1) => (side > 0 ? room.right : room.left) >= w;
		const preferred = anchor.beside.side;
		const side = fits(preferred)
			? preferred
			: fits(-preferred as 1 | -1)
				? (-preferred as 1 | -1)
				: room.right >= room.left
					? 1
					: -1;
		const left =
			side > 0
				? anchor.beside.right + TOOLTIP_OFFSET
				: anchor.beside.left - TOOLTIP_OFFSET - w;
		return { left, top: clampTop(anchor.y - h / 2) };
	}
	let top = anchor.y - TOOLTIP_OFFSET - h;
	if (top < 0) top = (anchor.below ?? anchor.y) + TOOLTIP_OFFSET;
	const left = Math.max(
		TOOLTIP_INSET,
		Math.min(anchor.x - w / 2, width - w - TOOLTIP_INSET),
	);
	return { left, top: clampTop(top) };
}

/**
 * The floating readout. The SAME visual contract as the shared tooltip
 * (`shared/components/ui/tooltip.tsx`): `data-lo-floating`, no border, the
 * elevated ground with one `shadow-overlay`, window glass via
 * `data-glass-overlay`, `max-w-64`, no entrance animation and never a pointer
 * target. It is absolutely positioned inside the chart box, so it never
 * changes layout; `placeTooltip` decides where.
 */
export function ChartTooltip({
	anchor,
	width,
	bottom,
	heading,
	rows,
}: {
	anchor: TooltipAnchor | null;
	width: number;
	/** Lowest edge the tooltip may reach (usually the plot's bottom). */
	bottom: number;
	heading?: string;
	rows: TooltipRow[];
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number }>();
	const content = JSON.stringify([heading, rows]);
	const beside = anchor?.beside;
	/* Beside the ring there may be less than 256px: cap the width BEFORE
	   measuring so the content wraps into the room it has, never onto the ring. */
	const maxWidth = beside
		? Math.max(
				0,
				Math.min(
					TOOLTIP_MAX,
					Math.max(
						besideRoom(beside, width).left,
						besideRoom(beside, width).right,
					),
				),
			)
		: undefined;
	useIsomorphicLayoutEffect(() => {
		const node = ref.current;
		if (!node || !anchor) {
			setPosition(undefined);
			return;
		}
		const next = placeTooltip({
			anchor,
			w: node.offsetWidth,
			h: node.offsetHeight,
			width,
			bottom,
		});
		setPosition((previous) =>
			previous?.left === next.left && previous.top === next.top
				? previous
				: next,
		);
	}, [
		anchor?.x,
		anchor?.y,
		anchor?.below,
		beside?.left,
		beside?.right,
		beside?.side,
		width,
		bottom,
		content,
	]);
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
				maxWidth,
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
			/* LTR on the root AND (in each renderer) the SVG: an inherited `rtl`
			   (ur) would flip every text-anchor and the tooltip's flow while the
			   geometry stays left-to-right (cross-surface decision X8). */
			dir="ltr"
			className={cn("relative mt-2 rounded-sm", className)}
			style={{ direction: "ltr", ...style }}
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
 *
 * Memoised (code review R5): it holds two copies of up to 32 x 5 cells, and
 * the chart re-renders on every active-mark change. Callers pass memoised
 * `columns`/`rows`, so a hover never re-renders the tables.
 */
export const ChartData = memo(function ChartData({
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
});

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
