/**
 * The full-diff pager: one bounded page of a write/edit call's archived diff,
 * painted in the inline preview's own well.
 *
 * Why a pager and not "append forever": the archive can hold thousands of rows
 * (the core's budget is 8192), and the canonical transcript is one long
 * scroller. Appending pages would grow the DOM without bound and bury the
 * reader's place; replacing ONE page of at most 200 rows (the same budget the
 * preview already paints) keeps the DOM bounded while First/Prev/Next/Last
 * reach every row. Every row is reachable from First by Next alone, because
 * Next follows the route's own `next_start` cursor (pages are byte-bounded, so
 * `start + 200` would skip rows).
 *
 * Scope: the parent conversation or a contained child. The request carries
 * session (+ child) + call id only; the route proves the call belongs to that
 * transcript and resolves the artifact itself.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { cn } from "@shared/lib/utils";
import {
	type FC,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	DESKTOP_DIFF_PAGE_MAX_ROWS,
	type DiffFullNotice,
	type DiffPage,
	diffFullBackLabel,
	diffFullClippedLabel,
	diffFullClippedRowLabel,
	diffFullEmptyLabel,
	diffFullErrorLabel,
	diffFullFirstLabel,
	diffFullLastLabel,
	diffFullLoadingLabel,
	diffFullNavLabel,
	diffFullNextLabel,
	diffFullNoticeLabel,
	diffFullPrevLabel,
	diffFullRangeLabel,
	diffFullRetryLabel,
	diffPageLines,
	lastPageStart,
	pageEndingBefore,
	pageRange,
	parseDiffPage,
	previousPageStart,
} from "./diff-history-model";
import { KIND_INK } from "./diff-ink";

/** Parent (`childId: null`) or a contained child — `AttachmentScope`'s shape. */
export type DiffHistoryScope = { sessionId: string; childId: string | null };

/**
 * What the pager is doing. `error` remembers the ACTION that failed (its start
 * and mode), so Retry replays Last as Last and Previous as Previous instead of
 * re-fetching some other page (review round 1, R2/Q1).
 */
export type DiffHistoryState =
	| { kind: "loading" }
	| { kind: "error"; start: number; mode: DiffHistoryMode }
	| { kind: "notice"; notice: DiffFullNotice }
	| { kind: "page"; page: DiffPage };

/**
 * `exact`: the page at `start`. `last`: the page holding the final row.
 * `before`: the page that ends at row `start - 1`.
 */
export type DiffHistoryMode = "exact" | "last" | "before";

/**
 * The most `next_start` hops Last or Prev follows inside one row window.
 * STRUCTURAL, not tuned: both walk forward from at most 200 rows before their
 * target, and every hop advances by at least one row (the parser refuses a
 * cursor that does not move), so 200 hops always reach the target.
 */
const MAX_WINDOW_HOPS = DESKTOP_DIFF_PAGE_MAX_ROWS;

async function fetchDiffPage(
	scope: DiffHistoryScope,
	callId: string,
	start: number,
): Promise<DiffPage | "not_found"> {
	try {
		const result = await desktopResult<unknown>(
			scope.childId
				? {
						op: "subagents.diff",
						sessionId: scope.sessionId,
						childId: scope.childId,
						callId,
						start,
						limit: DESKTOP_DIFF_PAGE_MAX_ROWS,
					}
				: {
						op: "sessions.diff",
						sessionId: scope.sessionId,
						callId,
						start,
						limit: DESKTOP_DIFF_PAGE_MAX_ROWS,
					},
		);
		const page = parseDiffPage(result, start);
		if (!page) throw new Error("malformed diff page");
		return page;
	} catch (error) {
		// 404 is the route's single `diff_not_found` answer (unknown session,
		// uncontained child, unknown or non-write/edit call): a fact, not a
		// transient failure, so it is a notice with no retry.
		if (error instanceof DesktopControlError && error.status === 404) {
			return "not_found";
		}
		throw error;
	}
}

/**
 * The pager's state machine. A request token drops any answer that arrives
 * after a newer navigation (fast Next presses), and `trail` remembers the
 * starts the reader came through by Next so Prev returns to exactly the page
 * it left rather than a recomputed one.
 */
export function useDiffHistory(
	scope: DiffHistoryScope,
	callId: string,
): {
	state: DiffHistoryState;
	first: () => void;
	prev: () => void;
	next: () => void;
	last: () => void;
	retry: () => void;
	canPrev: boolean;
	canNext: boolean;
} {
	const [state, setState] = useState<DiffHistoryState>({ kind: "loading" });
	const token = useRef(0);
	const trail = useRef<number[]>([]);
	const { sessionId, childId } = scope;

	const show = useCallback(
		/*
		 * `exact`: the page at `start`. `last`: the page holding the final row.
		 * `before`: the page that ends at row `start - 1`, so Prev never skips
		 * rows — byte-bounded pages from `start - 200` can stop well short of
		 * `start`, so the walk follows `next_start` until it covers the gap, and
		 * the covering page is then cut to end at `start - 1`.
		 */
		async (start: number, mode: DiffHistoryMode) => {
			const mine = ++token.current;
			const owner = { sessionId, childId };
			setState({ kind: "loading" });
			try {
				const from = mode === "before" ? previousPageStart(start) : start;
				let answer = await fetchDiffPage(owner, callId, from);
				if (mode === "before") {
					let hops = 0;
					while (
						answer !== "not_found" &&
						answer.state === "archived" &&
						answer.nextStart !== null &&
						answer.nextStart < start &&
						hops < MAX_WINDOW_HOPS
					) {
						if (token.current !== mine) return;
						answer = await fetchDiffPage(owner, callId, answer.nextStart);
						hops += 1;
					}
					if (answer !== "not_found" && answer.state === "archived") {
						answer = pageEndingBefore(answer, start);
					}
				}
				if (mode === "last" && answer !== "not_found") {
					// Byte-bounded pages may stop short of the end: follow the route's
					// cursor, then ask for the final row itself.
					let hops = 0;
					while (
						answer !== "not_found" &&
						answer.state === "archived" &&
						answer.nextStart !== null &&
						hops < MAX_WINDOW_HOPS
					) {
						if (token.current !== mine) return;
						answer = await fetchDiffPage(owner, callId, answer.nextStart);
						hops += 1;
					}
					if (
						answer !== "not_found" &&
						answer.state === "archived" &&
						answer.nextStart !== null
					) {
						answer = await fetchDiffPage(
							owner,
							callId,
							Math.max(0, answer.totalRows - 1),
						);
					}
				}
				if (token.current !== mine) return;
				if (answer === "not_found") {
					setState({ kind: "notice", notice: "not_found" });
				} else if (answer.state !== "archived") {
					setState({ kind: "notice", notice: answer.state });
				} else {
					setState({ kind: "page", page: answer });
				}
			} catch {
				if (token.current !== mine) return;
				setState({ kind: "error", start, mode });
			}
		},
		[sessionId, childId, callId],
	);

	useEffect(() => {
		trail.current = [];
		void show(0, "exact");
		return () => {
			// Unmount (Back to preview, row scrolled away): no answer may land.
			token.current += 1;
		};
	}, [show]);

	const page = state.kind === "page" ? state.page : null;
	const total = page?.totalRows ?? 0;
	return {
		state,
		first: () => {
			trail.current = [];
			void show(0, "exact");
		},
		prev: () => {
			if (!page) return;
			const back = trail.current.pop();
			if (back !== undefined) void show(back, "exact");
			else void show(page.start, "before");
		},
		next: () => {
			if (!page || page.nextStart === null) return;
			trail.current.push(page.start);
			void show(page.nextStart, "exact");
		},
		last: () => {
			// The trail is a Next history; Last jumps, so Prev from the last page
			// walks to the page that ends just before it instead.
			trail.current = [];
			void show(lastPageStart(total), "last");
		},
		retry: () => {
			if (state.kind === "error") void show(state.start, state.mode);
			else void show(0, "exact");
		},
		canPrev: Boolean(page && page.start > 0),
		canNext: Boolean(page && page.nextStart !== null),
	};
}

/**
 * Text-button treatment shared with the preview's toggle (underline, dim ink).
 *
 * Unavailable actions are `aria-disabled`, not `disabled` (review round 1,
 * U1/R4): a `disabled` button that holds focus throws it to <body> — exactly
 * what happened when First/Previous greyed at the first page or every button
 * went inert while a page loaded. `aria-disabled` keeps the node focusable and
 * announced as unavailable; `act()` below makes the press a no-op. The ink is
 * the semantic `ink-disabled` token, never opacity (D2: opacity is off-brand
 * and measured 2.67:1 dark / 2.02:1 light).
 */
const NAV_BUTTON =
	"cursor-pointer text-ink-dim underline underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink aria-disabled:cursor-default aria-disabled:no-underline aria-disabled:text-ink-disabled aria-disabled:hover:text-ink-disabled focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export const DiffHistoryPager: FC<{
	scope: DiffHistoryScope;
	callId: string;
	/**
	 * Leading artifact rows the pager hides (the nameless `---`/`+++` pair,
	 * `namelessHeaderRows` of the preview): subtracted from the visible counts.
	 */
	headerRows?: number;
	onBack: () => void;
}> = ({ scope, callId, headerRows = 0, onBack }) => {
	const pager = useDiffHistory(scope, callId);
	const { state } = pager;
	const rootRef = useRef<HTMLDivElement>(null);
	const navRef = useRef<HTMLElement>(null);
	const anchorRef = useRef<{ scroller: HTMLElement; top: number } | null>(null);
	/*
	 * The last page painted, kept while the next one loads or fails so the bar
	 * keeps its controls (and the focused one stays in the DOM) and the range
	 * keeps saying where the reader is.
	 */
	const lastPageRef = useRef<DiffPage | null>(null);
	if (state.kind === "page") lastPageRef.current = state.page;
	else if (state.kind === "notice") lastPageRef.current = null;
	/** Set when an action began with focus inside the pager. */
	const holdFocus = useRef(false);

	const scrollerOf = () =>
		rootRef.current?.closest<HTMLElement>("[data-lo-canonical-transcript]") ??
		null;

	/*
	 * The canonical transcript is bottom-anchored (flex-col-reverse), so a page
	 * of a different height would otherwise move the pager bar under the
	 * reader's pointer. Same anchoring as the preview's expand toggle: remember
	 * the bar's viewport offset before navigating, restore it before paint.
	 */
	const captureAnchor = () => {
		const scroller = scrollerOf();
		if (scroller && navRef.current) {
			anchorRef.current = {
				scroller,
				top:
					navRef.current.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top,
			};
		}
	};
	const act = (enabled: boolean, action: () => void) => () => {
		if (!enabled) return;
		holdFocus.current = Boolean(
			rootRef.current?.contains(document.activeElement),
		);
		captureAnchor();
		action();
	};
	/*
	 * Entering full mode: bring the pager bar into view and hold it there while
	 * the first page arrives. Without this the reverse scroller keeps its TAIL
	 * when the page grows the well, so the reader lands on row ~170 with the
	 * bar (and its range label) scrolled off the top — measured in the first
	 * rendered frame of this story, before this anchor existed.
	 *
	 * Scoped to the transcript scroller (POLISH D5): `scrollIntoView` also
	 * scrolled every ancestor, the Storybook page included. Focus moves to the
	 * bar (U1): the "View full diff" control the reader pressed is gone.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
	useLayoutEffect(() => {
		const scroller = scrollerOf();
		const nav = navRef.current;
		if (scroller && nav) {
			const top =
				nav.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			if (top < 0 || top > scroller.clientHeight) scroller.scrollTop += top;
		}
		nav?.focus({ preventScroll: true });
		captureAnchor();
	}, []);
	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (anchor && state.kind !== "loading" && navRef.current) {
			anchorRef.current = null;
			const top =
				navRef.current.getBoundingClientRect().top -
				anchor.scroller.getBoundingClientRect().top;
			anchor.scroller.scrollTop += top - anchor.top;
		}
		/*
		 * The focused control can still leave the DOM (Retry is replaced by the
		 * loading sentence; the bar's buttons hide on a notice). Focus then
		 * falls to <body>, so hand it to the bar — a stable, labelled node —
		 * whenever an action started inside the pager and focus escaped it.
		 */
		if (
			holdFocus.current &&
			!rootRef.current?.contains(document.activeElement)
		) {
			navRef.current?.focus({ preventScroll: true });
		}
		if (state.kind !== "loading") holdFocus.current = false;
	}, [state]);

	const page = state.kind === "page" ? state.page : null;
	// While loading or after a failed move, keep showing the page the reader is on.
	const shown = page ?? (state.kind === "notice" ? null : lastPageRef.current);
	const range =
		shown && shown.rows.length > 0 ? pageRange(shown, headerRows) : null;
	const body = page ? diffPageLines(page) : null;
	const clippedCount = page?.clippedRows.length ?? 0;
	/*
	 * Paging controls only exist once there is something to page (D3): on a
	 * first load, an error with no page, a notice or an empty diff, four inert
	 * buttons would only obscure the one sentence that matters. Back stays.
	 */
	const paging = range !== null;
	const status =
		state.kind === "loading"
			? diffFullLoadingLabel()
			: state.kind === "error"
				? diffFullErrorLabel()
				: state.kind === "notice"
					? diffFullNoticeLabel(state.notice)
					: body && body.lines.length === 0
						? diffFullEmptyLabel()
						: "";

	return (
		<div
			ref={rootRef}
			data-diff-history=""
			aria-busy={state.kind === "loading"}
		>
			<nav
				ref={navRef}
				tabIndex={-1}
				aria-label={diffFullNavLabel()}
				className={cn(
					"flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink-dim focus:outline-none",
					/*
					 * Sticky inside the transcript scroller (D1): a full page is
					 * ~2900px of wrapped rows, so a bar that scrolls away leaves the
					 * reader at the last row with no way on but a long scroll back.
					 * The well is `overflow-x-clip` in full mode (no scroll container
					 * of its own), so `top-0` pins against the transcript viewport.
					 * Opaque `bg-sunken` plus negative margins reaching the well's
					 * `p-3` edges keep rows from showing through or beside it.
					 */
					"sticky top-0 z-10 -mx-3 -mt-3 mb-2 bg-sunken px-3 pt-3 pb-1",
				)}
			>
				{paging && (
					<>
						<button
							type="button"
							className={NAV_BUTTON}
							aria-disabled={!pager.canPrev}
							onClick={act(pager.canPrev, pager.first)}
						>
							{diffFullFirstLabel()}
						</button>
						<button
							type="button"
							className={NAV_BUTTON}
							aria-disabled={!pager.canPrev}
							onClick={act(pager.canPrev, pager.prev)}
						>
							{diffFullPrevLabel()}
						</button>
					</>
				)}
				<span data-diff-history-range="" aria-live="polite">
					{range
						? diffFullRangeLabel(range.first, range.last, range.total)
						: null}
				</span>
				{paging && (
					<>
						<button
							type="button"
							className={NAV_BUTTON}
							aria-disabled={!pager.canNext}
							onClick={act(pager.canNext, pager.next)}
						>
							{diffFullNextLabel()}
						</button>
						<button
							type="button"
							className={NAV_BUTTON}
							aria-disabled={!pager.canNext}
							onClick={act(pager.canNext, pager.last)}
						>
							{diffFullLastLabel()}
						</button>
					</>
				)}
				<button
					type="button"
					className={cn(NAV_BUTTON, "ms-auto")}
					onClick={onBack}
				>
					{diffFullBackLabel()}
				</button>
			</nav>
			{/*
			 * ONE persistent status region (U3): it exists from mount, so a
			 * loading, error, notice or empty sentence written into it is
			 * announced — a region inserted together with its text often is not.
			 * `<output>` carries the implicit `status` role (polite live region).
			 */}
			<output data-diff-history-status="" className="block text-ink-dim">
				{status}
			</output>
			{state.kind === "error" && (
				<button
					type="button"
					className={NAV_BUTTON}
					onClick={act(true, pager.retry)}
				>
					{diffFullRetryLabel()}
				</button>
			)}
			{body?.hunkHeader && (
				// The `@@` row this page starts inside, copied from the redacted
				// artifact by the route: line context for a mid-hunk start.
				<span data-diff-hunk-context="" className={cn(KIND_INK.hunk, "block")}>
					{body.hunkHeader}
				</span>
			)}
			{body?.lines.map((line) => (
				<span
					key={line.index}
					data-diff-line={line.index}
					className={cn(KIND_INK[line.kind], "block")}
				>
					{line.text}
					{line.clipped && (
						<span className="text-ink-dim" data-diff-clipped="">
							{" "}
							{diffFullClippedRowLabel()}
						</span>
					)}
				</span>
			))}
			{clippedCount > 0 && (
				<span className="mt-2 block text-ink-dim">
					{diffFullClippedLabel(clippedCount)}
				</span>
			)}
		</div>
	);
};
