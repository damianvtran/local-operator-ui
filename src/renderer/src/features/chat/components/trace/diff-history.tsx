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
	pageRange,
	parseDiffPage,
	previousPageStart,
} from "./diff-history-model";
import { KIND_INK } from "./diff-ink";

/** Parent (`childId: null`) or a contained child — `AttachmentScope`'s shape. */
export type DiffHistoryScope = { sessionId: string; childId: string | null };

export type DiffHistoryState =
	| { kind: "loading" }
	| { kind: "error"; start: number }
	| { kind: "notice"; notice: DiffFullNotice }
	| { kind: "page"; page: DiffPage };

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
		const page = parseDiffPage(result);
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
		 * `start`, so the walk follows `next_start` until it covers the gap.
		 */
		async (start: number, mode: "exact" | "last" | "before") => {
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
				setState({ kind: "error", start });
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
			void show(state.kind === "error" ? state.start : 0, "exact");
		},
		canPrev: Boolean(page && page.start > 0),
		canNext: Boolean(page && page.nextStart !== null),
	};
}

/** Text-button treatment shared with the preview's toggle (underline, dim ink). */
const NAV_BUTTON =
	"cursor-pointer text-ink-dim underline underline-offset-2 transition-colors duration-fast ease-out-quart hover:text-ink disabled:cursor-default disabled:no-underline disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export const DiffHistoryPager: FC<{
	scope: DiffHistoryScope;
	callId: string;
	onBack: () => void;
}> = ({ scope, callId, onBack }) => {
	const pager = useDiffHistory(scope, callId);
	const { state } = pager;
	const navRef = useRef<HTMLElement>(null);
	const anchorRef = useRef<{ scroller: HTMLElement; top: number } | null>(null);

	/*
	 * The canonical transcript is bottom-anchored (flex-col-reverse), so a page
	 * of a different height would otherwise move the pager bar under the
	 * reader's pointer. Same anchoring as the preview's expand toggle: remember
	 * the bar's viewport offset before navigating, restore it before paint.
	 */
	const captureAnchor = () => {
		const scroller = navRef.current?.closest<HTMLElement>(
			"[data-lo-canonical-transcript]",
		);
		if (scroller && navRef.current) {
			anchorRef.current = {
				scroller,
				top:
					navRef.current.getBoundingClientRect().top -
					scroller.getBoundingClientRect().top,
			};
		}
	};
	const navigate = (action: () => void) => () => {
		captureAnchor();
		action();
	};
	/*
	 * Entering full mode: bring the pager bar into view and hold it there while
	 * the first page arrives. Without this the reverse scroller keeps its TAIL
	 * when the page grows the well, so the reader lands on row ~170 with the
	 * bar (and its range label) scrolled off the top — measured in the first
	 * rendered frame of this story, before this anchor existed.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
	useLayoutEffect(() => {
		navRef.current?.scrollIntoView({ block: "nearest" });
		captureAnchor();
	}, []);
	useLayoutEffect(() => {
		const anchor = anchorRef.current;
		if (!anchor || state.kind === "loading" || !navRef.current) return;
		anchorRef.current = null;
		const top =
			navRef.current.getBoundingClientRect().top -
			anchor.scroller.getBoundingClientRect().top;
		anchor.scroller.scrollTop += top - anchor.top;
	}, [state]);

	const page = state.kind === "page" ? state.page : null;
	const range = page && page.rows.length > 0 ? pageRange(page) : null;
	const body = page ? diffPageLines(page) : null;
	const clippedCount = page?.clippedRows.length ?? 0;

	return (
		<div data-diff-history="" aria-busy={state.kind === "loading"}>
			<nav
				ref={navRef}
				aria-label={diffFullNavLabel()}
				className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink-dim"
			>
				<button
					type="button"
					className={NAV_BUTTON}
					disabled={!pager.canPrev}
					onClick={navigate(pager.first)}
				>
					{diffFullFirstLabel()}
				</button>
				<button
					type="button"
					className={NAV_BUTTON}
					disabled={!pager.canPrev}
					onClick={navigate(pager.prev)}
				>
					{diffFullPrevLabel()}
				</button>
				<span data-diff-history-range="" aria-live="polite">
					{range && page
						? diffFullRangeLabel(range.first, range.last, page.totalRows)
						: null}
				</span>
				<button
					type="button"
					className={NAV_BUTTON}
					disabled={!pager.canNext}
					onClick={navigate(pager.next)}
				>
					{diffFullNextLabel()}
				</button>
				<button
					type="button"
					className={NAV_BUTTON}
					disabled={!pager.canNext}
					onClick={navigate(pager.last)}
				>
					{diffFullLastLabel()}
				</button>
				<button
					type="button"
					className={cn(NAV_BUTTON, "ms-auto")}
					onClick={onBack}
				>
					{diffFullBackLabel()}
				</button>
			</nav>
			{state.kind === "loading" && (
				<span className="block text-ink-dim">{diffFullLoadingLabel()}</span>
			)}
			{state.kind === "error" && (
				<span className="block text-ink-dim">
					{diffFullErrorLabel()}{" "}
					<button type="button" className={NAV_BUTTON} onClick={pager.retry}>
						{diffFullRetryLabel()}
					</button>
				</span>
			)}
			{state.kind === "notice" && (
				<span className="block text-ink-dim">
					{diffFullNoticeLabel(state.notice)}
				</span>
			)}
			{body && body.lines.length === 0 && (
				<span className="block text-ink-dim">{diffFullEmptyLabel()}</span>
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
