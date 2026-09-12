/**
 * `/usage` — provider quota as a table, not as JSON.
 *
 * This view answers one question: can I keep working, and if not, when does
 * that change. The TUI's `usage_panel.py` already answers it; the rules are
 * ported in `usage-view-model.ts` and this file only arranges them. Anything
 * numeric or textual that looks like a decision belongs there, so a reviewer
 * can check it against the Python without reading JSX.
 *
 * Split in two on purpose:
 *
 *   `UsageReports` is presentational — `(reports, source, fetchedAt, now)` in,
 *   pixels out, no fetching and no clock of its own. That is what the stories
 *   render, so every state (stale, unavailable, dead grant, unmeasurable) can
 *   be photographed without a backend and without waiting for one to misbehave.
 *
 *   `UsageView` is the container the picker registry mounts: it owns the
 *   `usage.get` query and the "fetch live" action, and nothing else.
 *
 * Design contract (`docs/branding.md`): roles never colours, every `className`
 * through `cn`, radius/spacing off the ramp, monospace only for machine voice.
 * The dialog ground is `elevated`, so a provider block takes `surface` (the
 * step down that reads as a card) and the bar track takes `sunken` (a third,
 * clearly recessed step).
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Button } from "@shared/components/ui/button";
import { Skeleton } from "@shared/components/ui/skeleton";
import { cn } from "@shared/lib/utils";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import type { PickerContext } from "./destination-pickers";
import { PickerHost } from "./picker-host";
import {
	type LimitRow,
	NOT_REPORTED,
	type ProviderBlock,
	type StatusTone,
	type UsagePayload,
	type UsageReport,
	collectStats,
	describeSource,
	newestConfirmedMs,
	providerBlocks,
	statsTerms,
	statusTone,
} from "./usage-view-model";
import { errorText } from "./use-picker-backend";

/**
 * Tint per tone. Roles, never colours — the theme decides what `success` is.
 *
 * Keyed by TONE rather than by status: a vendor may publish a status word this
 * view has never heard of, and `statusTone` maps every such word to `dim`,
 * exactly as `_status_color()`'s `.get(status, dim)` does. The word itself
 * survives — it is spoken and counted — but it is never painted in a semantic
 * colour the view cannot justify.
 *
 * `dim` has no fill at all: an unmeasurable window renders an outlined circle
 * and the words "not reported", because an empty filled dot is a claim that
 * nothing has been spent (SPEC rule 4).
 */
const DOT_CLASS: Record<StatusTone, string> = {
	ok: "bg-success",
	warning: "bg-warning",
	exhausted: "bg-danger",
	dim: "border border-ink-dim",
};

const TINT_CLASS: Record<StatusTone, string> = {
	ok: "text-success",
	warning: "text-warning",
	exhausted: "text-danger",
	dim: "text-ink-dim",
};

/**
 * The fill, which keeps its quota tint even on a degraded block: the number
 * still means what it measures, only the confidence in its freshness changed.
 * `dim` is unreachable by construction — a row with no fraction renders the
 * dotted rule instead of a track — and is kept only so the record is total.
 */
const BAR_CLASS: Record<StatusTone, string> = {
	ok: "bg-success",
	warning: "bg-warning",
	exhausted: "bg-danger",
	dim: "bg-transparent",
};

/** Spoken status for a screen reader; tint is a second channel, never the only one. */
const STATUS_WORD: Record<StatusTone, string> = {
	ok: "within limit",
	warning: "near limit",
	exhausted: "exhausted",
	dim: "not reported",
};

/**
 * What a screen reader hears for one row's status.
 *
 * An unrecognised vendor word is spoken VERBATIM rather than flattened to
 * "not reported": the view has no colour for `throttled`, but it does have
 * words, and dropping the vendor's own answer is what made a throttled account
 * read as healthy. `unknown` is the derived value and keeps its phrase.
 */
const KNOWN_WORD: Record<string, string> = {
	ok: STATUS_WORD.ok,
	warning: STATUS_WORD.warning,
	exhausted: STATUS_WORD.exhausted,
	unknown: STATUS_WORD.dim,
};

/**
 * What a row whose status is merely UNMEASURED says when it prints a number.
 *
 * `not reported` is right for a row with no number at all, and wrong for a
 * balance row: both account-balance fetchers report a remaining figure and no
 * limit, so the row printed `519.86 USD left` and a screen reader said
 * `519.86 USD left, not reported` — the spoken status contradicting the
 * printed number (UX U10). What is missing there is the LIMIT, not the report.
 */
const NO_LIMIT_WORD = "no limit reported";

/**
 * The spoken status for one row.
 *
 * Takes the row rather than the status alone because the honest phrase depends
 * on whether a number was printed beside it. A vendor's own word is still
 * spoken verbatim — only the DERIVED `unknown` is refined, since that is the
 * one this view invented and therefore the one it can get wrong.
 */
const statusWord = (row: LimitRow): string => {
	if (row.status === "unknown" && row.amount !== NOT_REPORTED)
		return NO_LIMIT_WORD;
	return KNOWN_WORD[row.status] ?? row.status;
};

/**
 * The column template every window row in every block shares.
 *
 * ONE table, not one per provider (SPEC rule 9): the widths are declared here
 * rather than measured per block, so the labels form one left edge and the
 * amounts and countdowns form one right edge across every report. Measured per
 * provider, two blocks would each be internally aligned and misaligned with
 * each other, which reads as two tables that happen to be stacked.
 *
 * The bar is the only flexible column, and that ordering is the layout rule:
 * an amount is exact and a countdown is words, while a bar is a redundant
 * picture of a number already on the row — so it is what a narrow frame takes
 * space from first, exactly as `_measure_columns` gives it whatever is left.
 * `11rem` fits the widest real amount (`12.40 USD / 40.00 USD`) and `7.5rem`
 * the widest real countdown (`resets in 2d11h`) without wrapping; a wrapped
 * countdown costs the row two lines and breaks the scan.
 */
const ROW_GRID =
	"grid grid-cols-[0.375rem_minmax(3rem,11rem)_minmax(1.5rem,1fr)_11rem_7.5rem] items-center gap-x-2";

/**
 * The amount and countdown column widths, as utilities, for the block heading.
 *
 * The heading is not in the grid — it is one flex row above it — but its
 * binding percentage and countdown have to land in the SAME two columns as the
 * rows beneath, or the number jumps horizontally from block to block. `w-44` is
 * `11rem` and `w-30` is `7.5rem`, matching `ROW_GRID`'s last two tracks; the
 * `gap-x-2` between them matches too. Change one and change the other.
 */
const AMOUNT_COLUMN = "w-44";
const COUNTDOWN_COLUMN = "w-30";

/** One window: dot, label, bar, amount, countdown. */
const LimitRowView: FC<{ row: LimitRow; degraded: boolean }> = ({
	row,
	degraded,
}) => {
	const tone = statusTone(row.status);
	return (
		<li className={cn(ROW_GRID, "py-0.5")}>
			<span
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					// A healthy-green dot on a two-hour-old meter is the highest-contrast
					// element in the block saying "fine" while the note says otherwise, so
					// a degraded block's marks drop to the dim ramp. The BAR keeps its
					// quota tint: the fill still means what it measures.
					degraded && tone !== "dim" ? "bg-ink-dim" : DOT_CLASS[tone],
				)}
			/>
			<span
				className={cn(
					"min-w-0 truncate text-body-sm",
					// A per-model cap is subordinate: indented and dimmer, so a 100%
					// family cap never reads as a dead account (SPEC rule 8).
					row.subordinate ? "pl-3 text-ink-dim" : "text-ink-muted",
				)}
			>
				{row.limit.label}
			</span>
			{row.fraction === null ? (
				// An unmeasurable window gets a DOTTED rule, not an empty track: an
				// empty track is pixel-identical to a bar at zero, which is a claim
				// that nothing has been spent (SPEC rule 4). The TUI draws dots here
				// for the same reason (`usage_bar`'s `BAR_UNKNOWN` branch).
				//
				// `ink-dim`, not `ink-disabled`. This rule is the WHOLE distinction
				// between "reports nothing" and "at zero", which § 2's own test
				// ("would removing it lose information?") makes structural and so
				// subject to the 3:1 floor — and `ink-disabled` is the one role
				// exempt from a floor, measuring 2.00:1 on card in the light brand
				// palette. `ink-dim` is the status dot's own role and clears 4.5:1
				// on every ground in all twelve palettes.
				<span
					className={cn("border-ink-dim border-t border-dotted")}
					aria-hidden="true"
				/>
			) : (
				// The track is bounded by `border-control`, the role floored at 3:1,
				// because without a perceivable container the meter stops reading as a
				// meter at BOTH extremes: `sunken` on `surface` is 1.11:1 in the dark
				// brand palette, so a 0% row rendered as blank card and a 100% row as a
				// bare coloured rule with no container around it.
				//
				// This is the STRUCTURAL weight rather than `hairline`, and the § 2
				// test is why: the track is the reference the fill is measured
				// against, so removing it loses the information the bar carries. A
				// hairline is capped BELOW 2:1 by the contrast contract's own ceiling
				// — measured on a re-captured frame it moved the track from 1.11:1 to
				// only 1.15:1, which is not a fix.
				//
				// `h-1.5` rather than `h-1` so the 1px border does not eat half the
				// meter: the interior keeps the original 4px, and the bar's height on
				// the row is unchanged in effect.
				<span
					className={cn(
						"h-1.5 overflow-hidden rounded-xs border border-control bg-sunken",
					)}
					aria-hidden="true"
				>
					<span
						className={cn("block h-full", BAR_CLASS[tone])}
						// A non-zero fraction always fills at least a sliver: a bar that
						// rounds 1% away draws empty for an account that HAS started
						// spending, which is the one reading the bar exists to prevent.
						style={{
							width: `${Math.max(row.fraction * 100, row.fraction > 0 ? 1 : 0)}%`,
						}}
					/>
				</span>
			)}
			<span
				className={cn(
					"truncate text-right font-mono text-mono-sm tabular-nums",
					row.fraction === null ? "text-ink-dim" : "text-ink-muted",
				)}
			>
				{row.amount}
				<span className={cn("sr-only")}>, {statusWord(row)}</span>
			</span>
			{/* A window with no countdown still occupies its cell, so the rows that do
			    have one stay in a column rather than starting wherever their numbers
			    happened to end.

			    `resets in` is PROSE and stays in the proportional face; only the
			    countdown is machine voice. Branding § 4 forbids mono for prose, and
			    the column still aligns because `tabular-nums` is on the numeral,
			    which is where it was always doing the work. */}
			<span className={cn("truncate text-right text-ink-dim text-meta")}>
				{row.countdown ? (
					<>
						resets in{" "}
						<span className={cn("font-mono text-mono-sm tabular-nums")}>
							{row.countdown}
						</span>
					</>
				) : (
					""
				)}
			</span>
		</li>
	);
};

/** One provider: heading, the window that binds, any note, then every window. */
const ProviderBlockView: FC<{ block: ProviderBlock }> = ({ block }) => (
	<section className="rounded-md border border-hairline bg-surface px-3 py-2.5">
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<h3 className="font-medium text-body-sm text-ink">
				{block.report.provider}
			</h3>
			{block.report.identity && (
				<span className="truncate text-ink-muted text-meta">
					{block.report.identity}
				</span>
			)}
			{/* The binding window is stated on the block's FIRST row because "can I
			    keep working" is the question the view is opened to answer; leaving
			    it to be found among equals is what the TUI's header fixed.

			    The percentage and the countdown take the SAME fixed widths as the
			    rows' amount and countdown columns. Right-aligning the cluster as a
			    unit landed the percentage at a different x in every block — and in
			    a block with no countdown it slid into the countdown column
			    entirely — so reading down the first line of each block, the number
			    jumped horizontally and once changed which column it was in. That
			    undercuts the one-table scan the layout is built for. */}
			{block.binding && (
				<span className={cn("ml-auto flex items-baseline gap-x-2")}>
					<span
						className={cn(
							AMOUNT_COLUMN,
							"truncate text-right text-meta",
							TINT_CLASS[statusTone(block.binding.status)],
						)}
					>
						{block.binding.label}{" "}
						<span className={cn("font-mono text-mono-sm tabular-nums")}>
							{block.binding.percent}
						</span>
					</span>
					<span
						className={cn(
							COUNTDOWN_COLUMN,
							"truncate text-right text-ink-dim text-meta",
						)}
					>
						{block.binding.countdown ? (
							<>
								resets in{" "}
								<span className={cn("font-mono text-mono-sm tabular-nums")}>
									{block.binding.countdown}
								</span>
							</>
						) : (
							""
						)}
					</span>
				</span>
			)}
			{/* With no meters at all there is no binding window to protect, so the
			    heading may carry the probe failure itself. */}
			{!block.binding && block.report.state === "unavailable" && (
				<span className={cn("ml-auto text-ink-dim text-meta")}>
					Usage unavailable
				</span>
			)}
		</div>
		{block.note && (
			<p
				className={cn(
					"pt-1 text-meta",
					// A dead grant names a remedy the user can act on, so it is the one
					// note that earns the danger role; staleness is a fact, not a fault.
					block.report.state === "reauth_required"
						? "text-danger"
						: "text-ink-dim",
				)}
			>
				{block.note}
			</p>
		)}
		{block.rows.length > 0 ? (
			<ul className={cn("pt-1.5")}>
				{block.rows.map((row) => (
					<LimitRowView
						key={row.limit.id}
						row={row}
						degraded={block.degraded}
					/>
				))}
			</ul>
		) : (
			/* A block holding only its heading reads as a rendering defect rather
			   than as an answer, which is why the TUI prints the same line. */
			<p className={cn("pt-1.5 text-ink-dim text-meta")}>{block.emptyNote}</p>
		)}
	</section>
);

export type UsageReportsProps = {
	reports: UsageReport[];
	/** `cached` or `live`, as the response labelled itself. */
	source: string;
	/** The clock countdowns are measured from. Pinned by stories and tests. */
	now: number;
};

/**
 * The report table. Pure: no query, no clock, no state.
 *
 * One table rather than one per provider (SPEC rule 9): the amount and
 * countdown columns are fixed-width and right-aligned across every block, so
 * the blocks scan as one table instead of several that happen to be stacked.
 */
export const UsageReports: FC<UsageReportsProps> = ({ reports, now }) => {
	// The baseline blocks are aged against is the set's newest CONFIRMATION, not
	// the response's stamp. See `newestConfirmedMs` for what the difference cost.
	const blocks = providerBlocks(reports, now, newestConfirmedMs(reports, now));
	return (
		<div className={cn("flex flex-col gap-2")}>
			{blocks.map((block, index) => (
				<ProviderBlockView
					// Provider is NOT unique: one provider can hold several logged-in
					// accounts, and a real cached response on this machine carried five
					// `anthropic` reports at once. Keying by provider alone collapsed
					// them into one React child. Identity disambiguates them where the
					// vendor supplies one, and the index is the backstop for the
					// providers that report none (openrouter sends `identity: null`).
					key={`${block.report.provider}:${block.report.identity ?? index}`}
					block={block}
				/>
			))}
		</div>
	);
};

/**
 * The toolbar's left half: the window tally.
 *
 * Renders nothing at all when there are no windows to count — `statsTerms`
 * returns an empty list for an empty set, and an empty element still occupies
 * a line box, which leaves the loading and empty states with a blank strip
 * above the body that reads as a missing element rather than an absent one.
 *
 * The COUNTS are monospace and the words are not. This is a ~50-character
 * sentence carrying about 8 numerals, and setting the whole of it in mono is
 * what made the toolbar read as console output beside the proportional button
 * on the same row (branding § 4: monospace is machine voice, never prose).
 */
export const UsageTally: FC<{ reports: UsageReport[] }> = ({ reports }) => {
	const terms = statsTerms(collectStats(reports));
	if (terms.length === 0) return null;
	return (
		<span className={cn("text-ink-dim text-meta")}>
			{terms.map((term, index) => (
				<span key={term.label}>
					{index > 0 ? " · " : ""}
					<span className={cn("font-mono text-mono-sm tabular-nums")}>
						{term.count}
					</span>{" "}
					{term.label}
				</span>
			))}
		</span>
	);
};

/**
 * The loading body: rows shaped like the blocks that will replace them.
 *
 * A bare "Loading" in a large empty body reads thin rather than deliberate,
 * and this view is a list, which is exactly what the repository's `Skeleton`
 * primitive is for. Three blocks because that is the common account count;
 * the shapes match `ProviderBlockView`'s heading-plus-rows so the transition
 * to real content is not a relayout the eye reads as a jump.
 *
 * `aria-hidden` with a live region beside it: a screen reader should hear
 * "loading provider usage" once, not a description of eleven grey rectangles.
 */
const UsageSkeleton: FC = () => (
	<div className={cn("flex flex-col gap-2")}>
		<output className={cn("sr-only")}>Loading provider usage.</output>
		{[0, 1, 2].map((block) => (
			<section
				key={block}
				className={cn(
					"rounded-md border border-hairline bg-surface px-3 py-2.5",
				)}
				aria-hidden="true"
			>
				<Skeleton className={cn("h-3.5 w-40")} />
				<div className={cn("flex flex-col gap-2 pt-3")}>
					{[0, 1].map((row) => (
						<div key={row} className={cn(ROW_GRID)}>
							<Skeleton className={cn("size-1.5 rounded-full")} />
							<Skeleton className={cn("h-3 w-24")} />
							<Skeleton className={cn("h-1.5")} />
							<Skeleton className={cn("h-3 w-20 justify-self-end")} />
							<Skeleton className={cn("h-3 w-16 justify-self-end")} />
						</div>
					))}
				</div>
			</section>
		))}
	</div>
);

export type UsageDialogProps = {
	onClose: () => void;
	/** The payload, or null while it is loading or has failed. */
	payload: UsagePayload | null;
	loading?: boolean;
	/** The query's own message; rendered in place of the table. */
	error?: string | null;
	/** A live fetch is in flight: the action says so instead of spinning. */
	fetching?: boolean;
	/** Whether live numbers have been asked for at least once. */
	asked?: boolean;
	onFetchLive: () => void;
	/**
	 * What the last completed ask did, or null before the first one settles.
	 *
	 * A repeat ask that returns the same numbers changes nothing on screen, so
	 * without a receipt the button is indistinguishable from the inert one it
	 * replaced — the user cannot tell "asked and nothing changed" from "the
	 * click did nothing". This is also the only place a failed ask is reported
	 * once there are cached numbers to keep rendering behind it.
	 */
	outcome?: { tone: "info" | "error"; text: string } | null;
	/** The clock ages and countdowns are measured from. Pinned by stories. */
	now: number;
};

/**
 * The whole `/usage` dialog, with no data fetching in it.
 *
 * This is the component the stories render, and it is the SHIPPED dialog
 * rather than a story-only imitation of one — `UsageView` below adds a query
 * and nothing else. A story that rebuilt the chrome would be evidence about
 * the story, so every state a reviewer has to judge (loading, empty, error,
 * stale, unavailable, a dead grant) is reachable here from fixtures alone.
 */
export const UsageDialog: FC<UsageDialogProps> = ({
	onClose,
	payload,
	loading = false,
	error = null,
	fetching = false,
	asked = false,
	onFetchLive,
	outcome = null,
	now,
}) => {
	const reports = payload?.reports ?? [];
	const actionRef = useRef<HTMLButtonElement>(null);
	const bodyRef = useRef<HTMLElement>(null);

	/*
	 * The loading body is for a first paint with nothing to show, never for a
	 * refresh over data already on screen. Both halves matter:
	 *
	 * - With a payload in hand the table STAYS UP while a live ask is out. It
	 *   used to be replaced by the word `Loading` for the whole multi-second
	 *   provider probe, taking the tally with it.
	 * - The empty-state copy ("No usage reports. Sign in to a provider…") must
	 *   never render for a query that has data. During a failed ask's retry
	 *   backoff the container reports neither loading nor fetching, and the body
	 *   fell through to that copy in front of a user who plainly has reports —
	 *   not a sparse state but a false statement about their situation.
	 */
	const showSkeleton = loading && !payload;

	/*
	 * Keep focus in the dialog when the action disables itself mid-flight.
	 *
	 * A disabled element cannot hold focus, so activating the button dropped
	 * focus to `<body>` and a keyboard user's next Tab restarted from the top of
	 * the document. The scroll region is the right catcher rather than the
	 * dialog frame: it is the thing the user most likely wants next, and it is
	 * where the numbers they just asked to refresh will appear.
	 */
	useEffect(() => {
		if (!fetching) return;
		const active = document.activeElement;
		if (active && active !== document.body && active !== actionRef.current)
			return;
		bodyRef.current?.focus();
	}, [fetching]);

	return (
		<PickerHost
			open
			onClose={onClose}
			title="Provider usage"
			wide
			// At four or more accounts the table is taller than the body, which is
			// the DEFAULT state for anyone with several logins rather than an edge
			// case, so the fold needs to read as a fold.
			bodyScrolls
			result={outcome}
			description={
				payload
					? // Aged from the newest CONFIRMATION in the set, not from the
						// response's own stamp: the route stamps a cached response with
						// the server clock at response time, so ageing it against itself
						// made this line structurally `Cached report, just now.` above
						// blocks the same frame dated `1h ago`.
						describeSource(
							payload.source,
							newestConfirmedMs(reports, payload.fetched_at),
							now,
						)
					: "Quota and usage as the providers report it."
			}
			toolbar={
				// `ml-auto` on the action rather than `justify-between` on the row:
				// the tally renders nothing when there are no windows, and with
				// `justify-between` its absence left the button sitting at the left
				// edge of the toolbar instead of staying where it always is.
				<div className="flex items-center gap-3">
					<UsageTally reports={reports} />
					{/* Named for what it does to the world, not for the widget: the
					    button reaches every signed-in provider's usage endpoint, which
					    is slow and rate-limited, so "ask" is the honest verb. In-flight
					    state is the label, not a spinner — there is nothing to watch.

					    The in-flight label distinguishes the two fetches this view
					    makes, because only one of them is an ask. Opening the dialog
					    reads the backend's CACHE, and labelling that `Asking providers`
					    claimed a live provider probe the user never requested — harmless
					    when the read is fast, misleading for exactly as long as it is
					    slow, which is when the label is actually read (UX U9). */}
					<Button
						ref={actionRef}
						className={cn("ml-auto")}
						variant="ghost"
						size="sm"
						type="button"
						onClick={onFetchLive}
						disabled={fetching}
					>
						{fetching
							? asked
								? "Asking providers"
								: "Reading cached usage"
							: asked
								? "Ask providers again"
								: "Ask providers now"}
					</Button>
				</div>
			}
			body={
				/*
				 * A labelled, focusable scroll region.
				 *
				 * The rows are plain `li`s with nothing focusable in them, so without
				 * `tabIndex` the container could not receive focus and PageDown / End /
				 * arrows did nothing at all — at real-account density roughly two
				 * thirds of the content sits below the fold, which locked it behind a
				 * mouse wheel. `role="region"` with a name is what makes the tab stop
				 * announce itself as something rather than as an unlabelled group.
				 *
				 * The name describes the REGION, not the screen it is on: named
				 * `Provider usage` it duplicated the dialog title, so a screen reader
				 * read "Provider usage region" inside "Provider usage dialog" and the
				 * tab stop said nothing new about where focus had landed (UX U11).
				 *
				 * Esc is unaffected: the dialog's handler is on the Radix content
				 * element above this, and nothing here stops propagation.
				 */
				<section
					ref={bodyRef}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop IS the fix; a labelled scroll container with no focusable descendant has to be focusable or a keyboard user cannot reach its content at all.
					tabIndex={0}
					aria-label="Report list"
					className={cn("block rounded-sm")}
				>
					{showSkeleton ? (
						<UsageSkeleton />
					) : error ? (
						<p className={cn("text-body-sm text-danger")}>{error}</p>
					) : /*
					 * The empty state is a claim about the ANSWER, so it requires one.
					 *
					 * `reports.length === 0` alone is also true when no response has
					 * arrived at all, and every branch above it is about a state that
					 * has a payload or an error — so a load that had neither fell
					 * through to here and told a user whose backend was merely down
					 * that they should go sign in to a provider (UX U8, second
					 * consequence). Requiring the payload makes the copy say only what
					 * it can know: the providers answered, and reported nothing.
					 */
					payload && reports.length === 0 ? (
						<p className={cn("text-body-sm text-ink-muted")}>
							No usage reports. Sign in to a provider that publishes quota, then
							ask providers for live numbers.
						</p>
					) : reports.length === 0 ? (
						/* No answer yet and nothing to show: the in-flight state, which the
						   toolbar label is already reporting. Never the empty-state copy. */
						<UsageSkeleton />
					) : (
						<UsageReports
							reports={reports}
							source={payload?.source ?? "cached"}
							now={now}
						/>
					)}
				</section>
			}
		/>
	);
};

/**
 * How often an open dialog re-reads the clock.
 *
 * `now` is read once per render and nothing else re-renders this tree, so
 * without a tick a dialog left open froze: a countdown kept saying `resets in
 * 1m` an hour after the window had rolled over, pointing at a past event. The
 * TUI repaints on a timer for the same reason.
 *
 * 30s rather than 1s because every value on screen is rendered at
 * minute-or-coarser resolution (`format_countdown`, `format_age`), so a
 * faster tick would re-render the tree without changing a single character.
 */
const CLOCK_TICK_MS = 30_000;

/**
 * The `usage.get` query, exactly as the container issues it.
 *
 * Exported as options rather than inlined so the wiring is assertable: the two
 * majors this view shipped with were both about what the query does over time
 * (a key switch blanking the table, an ask that never re-asked), which a test
 * can only attack by driving these real options through react-query.
 *
 * `live` is part of the key so the cached and live answers never overwrite each
 * other in the store, and `refresh: live` is what forces the backend past its
 * own cache.
 */
export const usageQueryOptions = (
	provider: string | undefined,
	live: boolean,
) =>
	({
		queryKey: ["desktop", "usage", provider ?? "", live] as const,
		queryFn: () =>
			desktopResult<UsagePayload>({
				op: "usage.get",
				provider,
				live,
				refresh: live,
			}),
		/*
		 * Keep the cached table on screen while the live key loads.
		 *
		 * Because `live` is in the key, asking for live numbers starts a query
		 * with no cached entry: `data` was `undefined` and `isLoading` true for
		 * the whole multi-second, every-provider, rate-limited probe, and the body
		 * replaced the table with the word `Loading`. The TUI paints cached
		 * reports while the fetch runs behind them (`UsagePanel.show_cached`), and
		 * the dialog already renders that state from `payload` + `fetching` — this
		 * is the wiring that lets the container produce it.
		 */
		placeholderData: keepPreviousData,
		/*
		 * The failure contract, owned here rather than inherited.
		 *
		 * `query-client.ts` sets `retry: 1` for the whole app, which is right for a
		 * cheap idempotent read and wrong for this one. A live `usage.get` fans out
		 * to every signed-in provider's usage endpoint — slow, rate-limited, and
		 * already retried per-account inside the backend's own `ProviderController`
		 * — so a second attempt from the renderer re-probes every provider a second
		 * time and mostly earns a 429 for it. The user also has an explicit retry in
		 * front of them: the action button is right there and says `Ask providers
		 * again`.
		 *
		 * Stating it here is the point, not the value. Inherited, the global default
		 * put a silent ~1s window between the click and any settled state, during
		 * which the query reported neither loading nor error and the view had
		 * nothing true to say — which is how a failed ask came to show no receipt at
		 * all. The receipt below now speaks for the in-between explicitly, and this
		 * makes the window it has to speak for a decision rather than an accident.
		 */
		retry: 0,
	}) as const;

/**
 * `/usage` as the registry mounts it.
 *
 * The cached report is what opens — no network round trip to read numbers the
 * backend already holds — and asking for live numbers flips both `live` and
 * `refresh`, which is what forces the backend past its own cache. `live` is
 * part of the cache key so the two answers never overwrite each other in
 * react-query's store, and the provider scope comes from the slash line's
 * argument.
 */
export const UsageView: FC<PickerContext> = ({ onClose, action }) => {
	const [live, setLive] = useState(false);
	const provider = action.args.trim() || undefined;
	const usage = useQuery(usageQueryOptions(provider, live));

	/*
	 * Ask again, and mean it.
	 *
	 * `setLive(true)` alone was inert once `live` was already `true`: React bails
	 * out on an identical state value, the query key does not change, and a
	 * still-fresh query does not refetch — so the only recovery from a failed
	 * ask was Esc and reopen. `refetch()` is the explicit form and re-probes,
	 * because the query already carries `refresh: live`.
	 */
	const { refetch } = usage;
	/*
	 * The receipt for the ask, so a repeat that returns identical numbers is
	 * still visibly an ask that happened rather than a dead click.
	 */
	const [outcome, setOutcome] = useState<{
		tone: "info" | "error";
		text: string;
	} | null>(null);
	const askLive = useCallback(() => {
		setOutcome(null);
		if (!live) {
			// The key change is itself the fetch; its outcome is reported by the
			// effect below, which sees every settle including this first one.
			setLive(true);
			return;
		}
		void refetch();
	}, [live, refetch]);

	/*
	 * Report each settled ask once. Keyed on `dataUpdatedAt`/`errorUpdatedAt`,
	 * which react-query moves on every settle even when the payload is
	 * byte-identical — that is exactly the case a receipt exists for.
	 *
	 * `failureCount`/`failureReason` are read alongside the settled state
	 * because a settle is not the only thing the user needs told about. An
	 * attempt that has failed but not yet settled — the retry window, and the
	 * whole of it under any `retry` above 0 — leaves `errorUpdatedAt` at 0 while
	 * `failureCount` is already 1. Reading only the settled transition made that
	 * window indistinguishable from a request still in its first attempt, which
	 * is how a failed ask showed no receipt at all (UX U8). These two fields are
	 * the only ones that speak for it.
	 */
	const {
		dataUpdatedAt,
		errorUpdatedAt,
		isError,
		error,
		failureCount,
		failureReason,
	} = usage;
	const settledAt = Math.max(dataUpdatedAt, errorUpdatedAt);
	const askedRef = useRef(false);
	if (live) askedRef.current = true;
	useEffect(() => {
		if (!askedRef.current) return;
		if (isError) {
			setOutcome({ tone: "error", text: errorText(error) });
			return;
		}
		/*
		 * An attempt failed and another is queued. Said in the present tense and
		 * with the reason attached, so "still trying" is never mistaken for
		 * "failed" — nor for silence, which is what it used to be. Unreachable at
		 * this view's own `retry: 0` and kept because the contract above is a
		 * decision that can be revisited, and the receipt must stay honest if it
		 * is.
		 */
		if (failureCount > 0) {
			setOutcome({
				tone: "error",
				text: `${errorText(failureReason)} Retrying…`,
			});
			return;
		}
		if (!settledAt) return;
		setOutcome({ tone: "info", text: "Providers answered." });
	}, [settledAt, isError, error, failureCount, failureReason]);

	/*
	 * The last payload that actually arrived, kept so a failed ask cannot blank
	 * the table the user is reading.
	 *
	 * `placeholderData` covers the request and its retry backoff, but on the
	 * FINAL error react-query drops the placeholder: `data` goes undefined and
	 * the numbers the user was looking at a second ago disappear, replaced by an
	 * error where their table was. Nothing about a failed probe makes the
	 * previous answer untrue — it is last-known, which is a state this view
	 * already knows how to render honestly — so the numbers stay and the
	 * failure is reported in the action's receipt instead.
	 */
	const lastGood = useRef<UsagePayload | null>(null);
	if (usage.data) lastGood.current = usage.data;
	const payload = usage.data ?? lastGood.current;

	/* The failure that has nothing to hide behind, so it becomes the body. */
	const bodyError = usage.isError && !payload ? errorText(usage.error) : null;

	/*
	 * A clock that moves, so an open dialog's countdowns stay true. State rather
	 * than a ref because the point is to re-render; the interval is cleared on
	 * unmount, which for this component is when the picker closes.
	 */
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
		return () => clearInterval(timer);
	}, []);

	return (
		<UsageDialog
			onClose={onClose}
			payload={payload}
			// `isLoading` is false while placeholder data stands in, so the body's
			// own guard (`loading && !payload`) is what decides; this stays the
			// honest report of "no data of this key's own yet".
			loading={usage.isLoading}
			// An error with numbers still on screen is reported by the action's
			// receipt, not by replacing the table the user is reading. With nothing
			// to show, the error IS the body.
			error={bodyError}
			// react-query dedupes a second click, but the label has to say so too.
			fetching={usage.isFetching}
			asked={live}
			onFetchLive={askLive}
			// A previous round's receipt is suppressed while a fetch is out: the
			// button already says "Asking providers", and the old receipt beside it
			// would be reporting a round that is no longer the current one.
			//
			// A receipt about the CURRENT round survives, because during a retry
			// window the fetch is still out and the failure it reports is the live
			// fact — suppressing it there is what left a failed ask with nothing on
			// screen at all (UX U8).
			//
			// It is also suppressed when the same failure is ALREADY the body: with
			// no payload to keep on screen the error is the body, and a receipt
			// beneath it printed the provider's sentence twice in a row.
			outcome={
				(usage.isFetching && usage.failureCount === 0) ||
				(bodyError !== null && outcome?.tone === "error")
					? null
					: outcome
			}
			// One clock reading per render, shared by every countdown and age on
			// screen, so two rows in the same frame cannot disagree about the time.
			now={now}
		/>
	);
};
